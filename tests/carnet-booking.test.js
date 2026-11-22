// Feuille de réservation des pages de carnet : estimation par palier, contrôle des champs, corps envoyé à Gestion.
// Aucun appel réseau : fetch est remplacé par un faux, la fonction de production n'est jamais jointe.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const B = require("../src/js/carnet-booking.js");
const privees = require("./noms-prives.js");
const data = require("../src/carnet/koh-samui-excursions-bateau.11tydata.js");
const config = data.eleventyComputed.carnetConfig({ business: { telephone: "+66958683846" } });
const offers = config.offres;
const root = path.join(__dirname, "..");

// 22.11.2026, midi à Bangkok. Dimanche 20.12, mardi 22.12, mercredi 23.12 sont postérieurs à la réouverture d'Ang Thong (16.12).
const NOW = Date.parse("2026-11-22T05:00:00Z");
const VALID = { variante: "", date: "2026-12-22", creneau: "matin", adults: 2, ages: [], pickup: "Hôtel d’essai", transfert: false, name: "Anna Keller", whatsapp: "+41 79 123 45 67", message: "", website: "" };
const total = (id, state) => B.estimate(offers[id], state);

function fakeFetch(result) {
  const calls = [];
  const f = (url, opts) => { calls.push({ url, opts }); return result instanceof Error ? Promise.reject(result) : Promise.resolve(result); };
  f.calls = calls;
  return f;
}

test("carnet : 9 offres, aucune donnée interne dans la configuration envoyée au navigateur", () => {
  assert.equal(Object.keys(offers).length, 9);
  const json = JSON.stringify(config);
  assert.doesNotMatch(json, /commission|partenaire|source|secret/i);
  assert.ok(!json.includes("<"), "rien qui puisse fermer la balise <script>");
  assert.equal(config.whatsapp, "66958683846", "numéro de business.js");
  assert.equal(config.reglages.ouvrirWhatsApp, true);
  assert.ok(config.reglages.delaiMinimalMs >= 1000);
  const f = config.reglages.fermetureAngThong;
  assert.deepEqual([f.debut, f.fin, f.anneeConfirmee], ["11-01", "12-15", 2026], "fermeture annuelle, une seule définition");
  assert.equal(f.message, "Le parc national est fermé du 1er novembre au 15 décembre.");
  assert.equal(f.messageAnnee, "Le parc national est fermé jusqu’au 15 décembre 2026.");
  assert.equal(config.reglages.ouvertureAngThong, undefined, "plus de date unique");
});

test("estimation : big boat, deux formules, enfant 4 à 11 ans, plus âgé au tarif adulte", () => {
  assert.equal(total("ang-thong-big-boat", { adults: 2, ages: [6], variante: "avec-kayak" }).total, 2 * 1850 + 1000);
  assert.equal(total("ang-thong-big-boat", { adults: 2, ages: [6], variante: "sans-kayak" }).total, 2 * 1300 + 700);
  assert.equal(total("ang-thong-big-boat", { adults: 1, ages: [11], variante: "sans-kayak" }).total, 1300 + 700, "11 ans : encore enfant");
  assert.equal(total("ang-thong-big-boat", { adults: 1, ages: [12], variante: "sans-kayak" }).total, 1300 + 1300, "12 ans : tarif adulte");
  const petit = total("ang-thong-big-boat", { adults: 2, ages: [3], variante: "avec-kayak" });
  assert.equal(petit.total, 3700, "moins de 4 ans : non compté");
  assert.equal(petit.partial, 1, "estimation partielle");
  assert.equal(total("ang-thong-big-boat", { adults: 2, ages: [], variante: "" }).ok, false, "formule obligatoire");
});

test("estimation : speedboat en groupe, enfant 4 à 10 ans", () => {
  assert.equal(total("ang-thong-speedboat-groupe", { adults: 2, ages: [10] }).total, 4400 + 1700);
  assert.equal(total("ang-thong-speedboat-groupe", { adults: 2, ages: [11] }).total, 4400 + 2200);
});

test("estimation : petit groupe, adulte dès 10 ans 4 400, enfant 3 à 9 ans 2 700, gratuit avant 3 ans", () => {
  assert.equal(total("ang-thong-petit-groupe-speedboat", { adults: 2, ages: [9] }).total, 2 * 4400 + 2700);
  assert.equal(total("ang-thong-petit-groupe-speedboat", { adults: 2, ages: [3] }).total, 2 * 4400 + 2700);
  assert.equal(total("ang-thong-petit-groupe-speedboat", { adults: 2, ages: [2] }).total, 2 * 4400, "bébé gratuit");
  assert.equal(total("ang-thong-petit-groupe-speedboat", { adults: 2, ages: [10] }).total, 3 * 4400);
});

test("estimation : speedboat privé d'Ang Thong, 20 000 THB par bateau de 1 à 9 personnes", () => {
  for (const pax of [1, 5, 9]) assert.equal(total("ang-thong-speedboat-prive", { adults: pax, ages: [] }).total, 20000);
  assert.equal(total("ang-thong-speedboat-prive", { adults: 9, ages: [1] }).ok, false, "10 personnes");
  assert.match(total("ang-thong-speedboat-prive", { adults: 9, ages: [1] }).error, /9 personnes au plus/);
});

test("estimation : longtail privé, chaque palier, 4 h puis 5 h", () => {
  const t4 = [[1, 3500], [2, 3500], [3, 3500], [4, 4500], [5, 4500], [6, 5500], [7, 5500], [8, 6500], [9, 6500], [10, 6500], [11, 7500], [12, 7500]];
  const t5 = [[1, 5000], [3, 5000], [4, 5500], [5, 5500], [6, 6500], [8, 6500], [9, 7500], [10, 7500], [11, 8500], [12, 8500]];
  for (const [pax, prix] of t4) assert.equal(total("pig-island-longtail-prive-4h", { adults: pax, ages: [] }).total, prix, `4 h, ${pax} personnes`);
  for (const [pax, prix] of t5) assert.equal(total("pig-island-longtail-prive-5h", { adults: pax, ages: [] }).total, prix, `5 h, ${pax} personnes`);
  assert.equal(total("pig-island-longtail-prive-4h", { adults: 13, ages: [] }).ok, false, "la tranche 11-13 est plafonnée à 12");
  assert.equal(total("pig-island-longtail-prive-4h", { adults: 4, ages: [5, 7] }).total, 5500, "les enfants comptent dans les personnes du bateau");
});

test("estimation : speedboats privés de Pig Island, 11 500 et 13 500 THB", () => {
  assert.equal(total("pig-island-speedboat-prive-4h", { adults: 4, ages: [] }).total, 11500);
  assert.equal(total("pig-island-speedboat-prive-5h", { adults: 9, ages: [] }).total, 13500);
  assert.equal(total("pig-island-speedboat-prive-5h", { adults: 10, ages: [] }).ok, false);
});

test("estimation : Pig Island en groupe, enfant 4 à 10 ans", () => {
  assert.equal(total("pig-island-groupe", { adults: 2, ages: [5] }).total, 4000);
  assert.equal(total("pig-island-groupe", { adults: 2, ages: [10] }).total, 4000);
  assert.equal(total("pig-island-groupe", { adults: 2, ages: [11] }).total, 4500);
  assert.equal(total("pig-island-groupe", { adults: 2, ages: [3] }).total, 3000);
});

test("estimation : le transfert depuis l'hôtel ajoute 1 500 THB aux seules offres privées", () => {
  assert.equal(total("pig-island-longtail-prive-4h", { adults: 2, ages: [], transfert: true }).total, 3500 + 1500);
  assert.equal(total("ang-thong-speedboat-prive", { adults: 2, ages: [], transfert: true }).total, 21500);
  assert.equal(offers["ang-thong-big-boat"].transfert, undefined);
  assert.equal(total("pig-island-groupe", { adults: 2, ages: [], transfert: true }).total, 3000, "pas de transfert en option sur un groupe");
});

test("entrée du parc : seuils du parc séparés de ceux de l'excursion, hors estimation", () => {
  const fee = (id, adults, ages) => B.parkFee(offers[id], { adults, ages });
  assert.equal(fee("ang-thong-big-boat", 2, []).amount, 600);
  assert.equal(fee("ang-thong-big-boat", 2, [2]).amount, 600, "moins de 3 ans : gratuit");
  assert.equal(fee("ang-thong-big-boat", 2, [3]).amount, 750, "3 ans : tarif enfant");
  // 12 ans : excursion au tarif ADULTE (speedboat, enfant jusqu'à 10 ans), parc au tarif ENFANT (3 à 14 ans)
  assert.equal(total("ang-thong-speedboat-groupe", { adults: 2, ages: [12] }).total, 3 * 2200);
  assert.equal(fee("ang-thong-speedboat-groupe", 2, [12]).amount, 2 * 300 + 150);
  assert.equal(fee("ang-thong-speedboat-groupe", 2, [14]).amount, 750);
  assert.equal(fee("ang-thong-speedboat-groupe", 2, [15]).amount, 900, "dès 15 ans : tarif adulte");
  for (const id of ["ang-thong-big-boat", "ang-thong-speedboat-groupe", "ang-thong-petit-groupe-speedboat", "ang-thong-speedboat-prive"]) assert.ok(offers[id].parc, id);
  for (const id of ["pig-island-groupe", "pig-island-longtail-prive-4h", "pig-island-speedboat-prive-5h"]) assert.equal(B.parkFee(offers[id], { adults: 2, ages: [] }), null, id);
  const est = total("ang-thong-petit-groupe-speedboat", { adults: 2, ages: [5] });
  assert.equal(est.total, 2 * 4400 + 2700, "l'entrée du parc n'est pas dans le total");
});

test("contrôle : date passée, jour de départ, parc d'Ang Thong fermé cette année jusqu'au 15 décembre 2026", () => {
  const today = B.bangkokToday(NOW);
  const check = (id, patch) => B.validate(offers[id], { ...VALID, ...patch }, today, config.reglages.fermetureAngThong);
  assert.equal(today, "2026-11-22");
  assert.deepEqual(check("pig-island-longtail-prive-4h", {}), {});
  assert.match(check("pig-island-longtail-prive-4h", { date: "2026-11-21" }).date, /passée/);
  assert.ok(check("pig-island-longtail-prive-4h", { date: "" }).date);
  // Pig Island en groupe : mardi, jeudi, samedi, dimanche
  assert.deepEqual(check("pig-island-groupe", { date: "2026-12-22" }), {});
  assert.deepEqual(check("pig-island-groupe", { date: "2026-12-20" }), {});
  assert.match(check("pig-island-groupe", { date: "2026-12-23" }).date, /mardi.*jeudi.*samedi.*dimanche/);
  // Ang Thong : refusé avant le 16 décembre, accepté après ; Pig Island jamais concerné
  const err = check("ang-thong-speedboat-prive", { date: "2026-12-15", creneau: "journee" }).date;
  assert.match(err, /fermé jusqu’au 15 décembre 2026/);
  assert.match(err, /mercredi 16 décembre 2026/);
  assert.equal(config.reglages.fermetureAngThong.anneeConfirmee, 2026);
  assert.deepEqual(check("ang-thong-speedboat-prive", { date: "2026-12-16", creneau: "journee" }), {});
  assert.deepEqual(check("pig-island-longtail-prive-4h", { date: "2026-12-01" }), {}, "Pig Island réservable pendant la fermeture du parc");
  assert.match(check("ang-thong-big-boat", { date: "2026-12-10", variante: "avec-kayak" }).date, /fermé/);
});

test("contrôle : champs obligatoires, âge de chaque enfant, capacité, numéro WhatsApp international", () => {
  const today = B.bangkokToday(NOW);
  const check = (id, patch) => B.validate(offers[id], { ...VALID, ...patch }, today, null);
  assert.ok(check("pig-island-longtail-prive-4h", { adults: 0 }).adults);
  assert.ok(check("pig-island-longtail-prive-4h", { pickup: " " }).pickup);
  assert.ok(check("pig-island-longtail-prive-4h", { name: "Anna" }).name, "nom complet : prénom et nom");
  assert.ok(check("pig-island-longtail-prive-4h", { creneau: "" }).creneau, "créneau à choisir quand il y en a deux");
  assert.deepEqual(Object.keys(check("pig-island-longtail-prive-4h", { ages: ["", "4", ""] })).sort(), ["age-0", "age-2"]);
  assert.ok(check("pig-island-longtail-prive-4h", { adults: 12, ages: ["5"] }).pax, "13 personnes sur un bateau de 12");
  assert.ok(check("ang-thong-big-boat", { variante: "" }).variante);
  for (const bad of ["", "079 123 45 67", "+41", "+41 abc", "+0123456789", "+1234567890123456"]) assert.ok(check("pig-island-groupe", { whatsapp: bad }).whatsapp, bad);
  for (const [raw, e164] of [["+41 79 123 45 67", "+41791234567"], ["0041-79-123-45-67", "+41791234567"], ["+41 (0)79 123 45 67", "+41791234567"], ["+66 95 868 38 46", "+66958683846"]]) assert.equal(B.phoneE164(raw), e164, raw);
  assert.equal(B.phoneE164("079 123 45 67"), "", "numéro national : l'indicatif n'est pas deviné");
});

test("envoi : un seul appel à la fonction de Gestion, text/plain, keepalive, corps du contrat", async () => {
  const f = fakeFetch({ ok: true, status: 202 });
  const raw = { ...VALID, ages: ["6"], transfert: true, message: "Merci", openedAt: NOW - 20000 };
  const res = B.submitRequest(config, "pig-island-longtail-prive-4h", raw, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/#haut", rand: () => 0 });
  assert.equal(res.ok, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, B.DEMANDE_URL);
  assert.equal(f.calls[0].opts.method, "POST");
  assert.equal(f.calls[0].opts.keepalive, true);
  assert.equal(f.calls[0].opts.headers["Content-Type"], "text/plain;charset=UTF-8");
  assert.equal(f.calls[0].opts.credentials, "omit");
  const body = JSON.parse(f.calls[0].opts.body);
  assert.deepEqual(Object.keys(body).sort(), ["adults", "brand", "children", "currency", "date", "estimated_total", "message", "name", "option", "option_label", "page_url", "pickup", "product", "product_id", "ref", "time", "website", "whatsapp"]);
  assert.equal(body.brand, B.BRAND);
  assert.equal(body.product_id, "pig-island-longtail-prive-4h");
  assert.equal(body.option, "matin");
  assert.equal(body.time, "09:00");
  assert.equal(body.date, "2026-12-22");
  assert.equal(body.adults, 2);
  assert.equal(body.children, 1);
  assert.equal(body.pickup, "Hôtel d’essai");
  assert.equal(body.whatsapp, "+41791234567");
  assert.equal(body.estimated_total, 3500 + 1500);
  assert.equal(body.currency, "THB");
  assert.match(body.ref, /^SAM-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(body.page_url, "https://zwaldtravelplanner.com/carnet/x-abc123/", "sans ancre");
  assert.equal(body.website, "");
  assert.ok(Buffer.byteLength(f.calls[0].opts.body) <= 4096);
  assert.ok(body.message.length <= 2000);
  assert.match(body.message, /Demande de réservation : Pig Island et Koh Tan en longtail privé, 4 h/);
  assert.match(body.message, /Réf : SAM-/);
  assert.doesNotMatch(JSON.stringify(body), /commission|secret ?travel/i);
  for (const re of privees.motifs() || []) assert.ok(!re.test(JSON.stringify(body)), "nom de la liste privée dans le corps envoyé");
  assert.equal(await res.sent, true);
  assert.match(res.whatsappUrl, /^https:\/\/wa\.me\/66958683846\?text=Bonjour%20Ana%C3%AFs/);
});

test("envoi : récapitulatif avec l'entrée du parc à part pour Ang Thong", () => {
  const f = fakeFetch({ ok: true });
  const raw = { ...VALID, creneau: "journee", ages: ["12"], openedAt: NOW - 20000 };
  const res = B.submitRequest(config, "ang-thong-speedboat-groupe", raw, { fetch: f, now: NOW });
  assert.equal(res.ok, true);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.equal(body.estimated_total, 3 * 2200, "excursion au tarif adulte pour 12 ans");
  assert.match(body.message, /Estimation : 6.600.THB, à payer sur place après confirmation/);
  assert.match(body.message, /Entrée du parc à payer sur place : 750.THB/);
  assert.doesNotMatch(body.message, /entrée[^\n]{0,30}incluse/i);
});

test("envoi : champ piège testé AVANT le contrôle, envoi trop rapide : même confirmation, rien d'envoyé, aucun seuil révélé", async () => {
  const f = fakeFetch({ ok: true });
  // Champ piège rempli sur une feuille vide et invalide : confirmation neutre (pas d'erreur de champ), rien d'envoyé, jamais href="#".
  const bot = B.submitRequest(config, "pig-island-groupe", { website: "http://spam.example", openedAt: NOW - 20 }, { fetch: f, now: NOW, rand: () => 0 });
  assert.equal(bot.ok, true);
  assert.equal(bot.silent, true);
  assert.match(bot.ref, /^SAM-[A-HJ-NP-Z2-9]{4}$/);
  assert.match(bot.recap, /Réf : SAM-/);
  assert.match(bot.whatsappUrl, /^https:\/\/wa\.me\/66958683846\?text=/);
  assert.doesNotMatch(String(bot.whatsappUrl), /^#/);
  assert.equal(await bot.sent, true);
  // Envoi trop rapide sur une feuille valide : même confirmation qu'une vraie (le message WhatsApp porte tout le détail), mais pas de copie.
  const rapide = B.submitRequest(config, "pig-island-groupe", { ...VALID, openedAt: NOW - 500 }, { fetch: f, now: NOW });
  assert.equal(rapide.ok, true);
  assert.equal(rapide.dropped, true);
  assert.equal(rapide.tooFast, undefined, "aucun indicateur de seuil");
  assert.match(rapide.recap, /Réf : SAM-/);
  assert.match(rapide.whatsappUrl, /^https:\/\/wa\.me\//);
  assert.equal(await rapide.sent, true);
  // Feuille invalide, même trop vite : les vraies erreurs de champ, jamais un message sur le délai
  const vide = B.submitRequest(config, "pig-island-groupe", { ...VALID, name: "", openedAt: NOW - 500 }, { fetch: f, now: NOW });
  assert.equal(vide.ok, false);
  assert.deepEqual(Object.keys(vide.errors), ["name"]);
  const faux = B.submitRequest(config, "pig-island-groupe", { ...VALID, date: "2026-12-23", openedAt: NOW - 20000 }, { fetch: f, now: NOW });
  assert.equal(faux.ok, false);
  assert.ok(faux.errors.date);
  assert.equal(B.submitRequest(config, "offre-inconnue", VALID, { fetch: f, now: NOW }).ok, false);
  assert.equal(f.calls.length, 0, "aucun appel réseau");
  const js = fs.readFileSync(path.join(root, "src/js/carnet-booking.js"), "utf8");
  const corps = js.slice(js.indexOf("function submitRequest"), js.indexOf("// ---------- Navigateur"));
  assert.ok(corps.indexOf("clean(raw.website)") < corps.indexOf("validate("), "le pot de miel est testé avant validate()");
  assert.doesNotMatch(js, /tooFast: true|Relisez votre demande/, "plus de message propre au délai");
});

test("envoi : une erreur réseau ou un refus ne bloque jamais, WhatsApp reste proposé", async () => {
  for (const result of [new Error("réseau"), { ok: false, status: 403 }]) {
    const f = fakeFetch(result);
    const res = B.submitRequest(config, "pig-island-groupe", { ...VALID, openedAt: NOW - 20000 }, { fetch: f, now: NOW });
    assert.equal(res.ok, true);
    assert.match(res.whatsappUrl, /^https:\/\/wa\.me\//);
    assert.equal(await res.sent, false);
  }
  assert.equal(await B.sendCopy({ a: 1 }, () => { throw new Error("synchrone"); }), false);
  assert.equal(await B.sendCopy({ a: 1 }, null, null), false);
});

test("carnet : une seule adresse de fonction dans le script, jamais appelée par les tests", () => {
  const js = fs.readFileSync(path.join(root, "src/js/carnet-booking.js"), "utf8");
  assert.equal((js.match(/https:\/\/[a-z0-9]+\.supabase\.co/g) || []).length, 1);
  assert.equal(B.DEMANDE_URL, "https://lkxqcmzeidlyssoqmqkh.supabase.co/functions/v1/demande-site");
  assert.doesNotMatch(js, /turnstile_token/, "pas de Turnstile pour l'instant");
});

test("carnet : la page construite porte tous les champs de la feuille", () => {
  const doc = fs.readFileSync(path.join(root, "_site/carnet/koh-samui-excursions-bateau-xc8do3/index.html"), "utf8");
  for (const id of ["cg-sheet", "cg-date", "cg-adults", "cg-children", "cg-pickup", "cg-name", "cg-whatsapp", "cg-message", "cg-website"]) assert.match(doc, new RegExp(`id="${id}"`), id);
  for (const name of ['data-cg="variantes"', 'data-cg="creneaux"', 'data-cg="transfert"', 'data-cg="ages"', 'data-cg="estimate"', 'name="website"']) assert.ok(doc.includes(name), name);
  assert.match(doc, /type="tel"/);
  assert.match(doc, /<dialog class="cg-sheet"/);
  // Sans JavaScript : un seul bouton qui marche par offre (le lien WhatsApp du noscript) ; les boutons « Réserver » sont créés par le script.
  assert.equal((doc.match(/data-cg-slot="/g) || []).length, 9, "un emplacement de bouton par offre");
  assert.equal((doc.match(/<noscript><a class="btn btn-teal cg-reserver" href="https:\/\/wa\.me\/66958683846\?text=/g) || []).length, 9, "un lien WhatsApp de repli par offre");
  assert.doesNotMatch(doc, /<button[^>]*cg-reserver/, "aucun bouton Réserver écrit dans le HTML");
  assert.match(fs.readFileSync(path.join(root, "src/js/carnet-booking.js"), "utf8"), /querySelectorAll\("\[data-cg-slot\]"\)/);
  assert.match(doc, /<script type="application\/json" id="cg-data">/);
  assert.match(doc, /Vous envoyez une demande\. Anaïs vous confirme votre réservation après avoir vérifié la disponibilité\. Rien n’est payé en ligne/);
  assert.doesNotMatch(doc, /sous \d+ ?(h|heures|minutes|jours)/i, "aucun délai inventé");
});

test("carnet : les deux speedboats privés de Pig Island disparaissent avec un seul réglage", () => {
  assert.equal(data.reglages.afficherSpeedboatsPigIsland, true);
  assert.ok(Object.values(data.eleventyComputed.offres()).filter((o) => o.isole).length === 2);
});

test("WhatsApp : ouverture sans noopener dans les features, lien coupé ensuite, alerte seulement si le navigateur a bloqué", () => {
  const calls = [];
  const win = { opener: "page" };
  assert.equal(B.openWhatsApp("https://wa.me/1", (...a) => { calls.push(a); return win; }), "opened");
  assert.deepEqual(calls[0], ["https://wa.me/1", "_blank"], "ni noopener ni autre feature (elle ferait toujours renvoyer null)");
  assert.equal(win.opener, null);
  assert.equal(B.openWhatsApp("u", () => null), "blocked");
  assert.equal(B.openWhatsApp("u", () => { throw new Error("bloqué"); }), "blocked");
  assert.equal(B.openWhatsApp("u", () => ({ get opener() { return null; }, set opener(v) { throw new Error("autre origine"); } })), "opened", "un opener non modifiable n'est pas un blocage");
  const js = fs.readFileSync(path.join(root, "src/js/carnet-booking.js"), "utf8");
  assert.doesNotMatch(js, /window\.open\([^)]*noopener/, "aucun window.open avec noopener en feature");
});

test("confirmation : une réponse tardive ne touche que la demande qui l'a créée", async () => {
  const t = B.makeTracker();
  const a = t.next();
  assert.equal(t.isCurrent(a), true);
  const b = t.next();
  assert.equal(t.isCurrent(a), false, "la première confirmation est dépassée");
  assert.equal(t.isCurrent(b), true);
  t.next(); // réouverture de la feuille
  assert.equal(t.isCurrent(b), false);
  const js = fs.readFileSync(path.join(root, "src/js/carnet-booking.js"), "utf8");
  // La feuille remet à zéro les deux alertes à chaque ouverture et à chaque confirmation, et passe par le jeton.
  const reset = js.slice(js.indexOf("function resetDone()"), js.indexOf("function resetDone()") + 200);
  assert.match(reset, /done-popup/);
  assert.match(reset, /done-warning/);
  assert.match(js.slice(js.indexOf("function showDone")), /resetDone\(\);/);
  assert.match(js.slice(js.indexOf("function open(")), /resetDone\(\);/);
  assert.match(js, /res\.sent\.then\(function \(ok\) \{ if \(!ok && tracker\.isCurrent\(token\)\)/);
});

test("date minimale : recalculée à chaque ouverture de la feuille, fuseau de Bangkok", () => {
  const js = fs.readFileSync(path.join(root, "src/js/carnet-booking.js"), "utf8");
  const open = js.slice(js.indexOf("function open("), js.indexOf("function close()"));
  assert.match(open, /today = bangkokToday\(\);/);
  assert.match(open, /refreshClosure\(\);/);
  assert.equal(B.bangkokToday(Date.parse("2026-12-31T17:30:00Z")), "2027-01-01", "00:30 le lendemain à Bangkok");
  assert.equal(B.bangkokToday(Date.parse("2026-12-31T16:30:00Z")), "2026-12-31");
});

test("limites : hôtel 200 caractères, message 500, nom 120 : refusés à la saisie, récapitulatif jamais tronqué", () => {
  const today = B.bangkokToday(NOW);
  const check = (patch) => B.validate(offers["pig-island-groupe"], { ...VALID, ...patch }, today, null);
  assert.ok(check({ pickup: "h".repeat(201) }).pickup);
  assert.deepEqual(check({ pickup: "h".repeat(200) }), {});
  assert.ok(check({ message: "m".repeat(501) }).message);
  assert.deepEqual(check({ message: "é".repeat(500) }), {});
  assert.ok(check({ name: "Anna " + "k".repeat(120) }).name);
  // Pire cas accepté : tout au maximum, 12 enfants de moins d'un an, offre au titre le plus long
  const worst = { ...VALID, adults: 40, ages: Array(12).fill("0"), pickup: "é".repeat(200), message: "é".repeat(500), name: "Anna " + "k".repeat(110), openedAt: NOW - 20000 };
  assert.deepEqual(B.validate(offers["pig-island-groupe"], worst, today, null), {});
  for (const id of Object.keys(offers)) {
    const offer = offers[id];
    const raw = { ...worst, variante: offer.variantes ? offer.variantes[0].id : "", creneau: (offer.creneaux || [{ id: "" }])[0].id, transfert: true, date: offer.jours ? "2026-12-22" : "2026-12-22" };
    const adults = offer.type === "bateau" ? Math.max(1, offer.capacite - 12) : 40;
    const state = { ...raw, adults, ages: offer.type === "bateau" && adults + 12 > offer.capacite ? [] : raw.ages };
    const f = fakeFetch({ ok: true });
    const res = B.submitRequest(config, id, state, { fetch: f, now: NOW });
    assert.equal(res.ok, true, id + " " + JSON.stringify(res.errors));
    const body = JSON.parse(f.calls[0].opts.body);
    assert.ok(body.message.length <= 2000, id + " : message de " + body.message.length);
    assert.ok(Buffer.byteLength(f.calls[0].opts.body) <= 4096, id + " : corps de " + Buffer.byteLength(f.calls[0].opts.body) + " octets");
    assert.match(body.message.split("\n").pop(), /^Réf : SAM-/, id + " : la ligne Réf est la dernière");
    assert.ok(body.message.includes("Prise en charge : " + body.pickup), "pickup identique dans le champ et dans le texte");
    assert.ok(body.message.includes("Nom : " + body.name));
    assert.ok(body.message.includes("Message : " + "é".repeat(500)), "message complet");
  }
});

test("numéro WhatsApp : écritures courantes suisse, française, thaïlandaise", () => {
  const ok = {
    "+41791234567": ["+41 79 123 45 67", "0041 79 123 45 67", "+41 (0)79 123 45 67", "0041 (0)79 123 45 67", "+41 079 123 45 67", "(+41) 79 123 45 67", "+41.79.123.45.67", "+41-79-123-45-67", "  +41 79 123 45 67  ", "+41 ( 0 ) 79 123 45 67"],
    "+33612345678": ["+33 6 12 34 56 78", "0033 6 12 34 56 78", "+33 (0)6 12 34 56 78", "0033 (0)6 12 34 56 78", "+33 06 12 34 56 78", "+33612345678"],
    "+66812345678": ["+66 81 234 5678", "+66 8 1234 5678", "0066 81 234 5678", "+66 (0)81 234 5678", "+66 081 234 5678", "+66-81-234-5678"],
    "+66958683846": ["+66 95 868 38 46", "+66 (0) 95 868 38 46"],
    "+393123456789": ["+39 312 345 6789"],
    "+447700900123": ["+44 7700 900123", "+44 (0)7700 900123", "0044 7700 900123"]
  };
  for (const [e164, writings] of Object.entries(ok)) for (const w of writings) {
    assert.equal(B.phoneE164(w), e164, w);
    assert.equal(B.phoneError(w), "", w);
  }
  // Numéros nationaux : l'indicatif n'est pas deviné, message clair
  for (const national of ["079 123 45 67", "06 12 34 56 78", "08 1234 5678", "081 234 5678"]) {
    assert.equal(B.phoneE164(national), "", national);
    assert.match(B.phoneError(national), /indicatif/, national);
  }
  assert.match(B.phoneError(""), /Ajoutez votre numéro/);
  assert.match(B.phoneError("+41 abc"), /chiffres/);
  assert.match(B.phoneError("+41"), /8 à 15 chiffres/);
});

test("confirmation : formule neutre quand la copie n'est pas confirmée, jamais « renvoyez »", () => {
  const html = fs.readFileSync(path.join(root, "src/_includes/carnet-booking.njk"), "utf8");
  const warning = html.match(/data-cg="done-warning"[^>]*>([^<]+)</)[1];
  assert.match(warning, /Votre message WhatsApp contient tout le détail de votre demande ; Anaïs vous répond dessus/);
  assert.doesNotMatch(warning, /renvoy|à nouveau|réessay|recommenc|n’a pas abouti|échou/i);
  const popup = html.match(/data-cg="done-popup"[^>]*>([^<]+)</)[1];
  assert.doesNotMatch(popup, /renvoy|à nouveau|réessay|recommenc/i);
  assert.match(html, /data-cg="done-ref"/, "la référence reste affichée");
});

const rule = config.reglages.fermetureAngThong;
test("fermeture annuelle d'Ang Thong : toute année, du 1er novembre au 15 décembre inclus", () => {
  const juin = Date.parse("2026-06-01T05:00:00Z");
  const juin27 = Date.parse("2027-06-01T05:00:00Z"); // les dates de 2027 se réservent en 2027 (un an à l'avance au plus)
  const check = (id, date, now = juin) => B.validate(offers[id], { ...VALID, date, creneau: "journee", variante: "avec-kayak" }, B.bangkokToday(now), rule);
  assert.deepEqual(check("ang-thong-speedboat-prive", "2026-10-30"), {}, "30 octobre : réservable");
  assert.deepEqual(check("ang-thong-speedboat-prive", "2026-10-31"), {});
  assert.match(check("ang-thong-speedboat-prive", "2026-11-01").date, /fermé/, "1er novembre : refusé");
  assert.match(check("ang-thong-speedboat-prive", "2026-12-15").date, /fermé/, "15 décembre : refusé (inclus)");
  assert.deepEqual(check("ang-thong-speedboat-prive", "2026-12-16"), {}, "16 décembre : réservable");
  assert.match(check("ang-thong-speedboat-prive", "2027-11-01").date, /fermé/, "1er novembre 2027 : refusé");
  assert.match(check("ang-thong-speedboat-prive", "2027-12-15").date, /fermé/);
  assert.deepEqual(check("ang-thong-speedboat-prive", "2027-12-16", juin27), {});
  assert.match(check("ang-thong-big-boat", "2026-11-20").date, /fermé jusqu’au 15 décembre 2026/, "année confirmée : message daté");
  assert.match(check("ang-thong-big-boat", "2027-11-20").date, /fermé du 1er novembre au 15 décembre\./, "année suivante : message général");
  assert.doesNotMatch(check("ang-thong-big-boat", "2027-11-20").date, /2026|2027 /);
  assert.match(check("ang-thong-big-boat", "2027-11-20").date, /jeudi 16 décembre 2027/);
  for (const id of ["ang-thong-big-boat", "ang-thong-speedboat-groupe", "ang-thong-petit-groupe-speedboat", "ang-thong-speedboat-prive"]) {
    assert.ok(offers[id].angThong, id);
    assert.match(check(id, "2026-12-01").date, /fermé/, id);
  }
  // Pig Island, Koh Tan et Koh Rap : réservables pendant la fermeture
  for (const id of ["pig-island-longtail-prive-4h", "pig-island-longtail-prive-5h", "pig-island-speedboat-prive-4h", "pig-island-speedboat-prive-5h"]) {
    assert.deepEqual(B.validate(offers[id], { ...VALID, date: "2026-12-01" }, B.bangkokToday(juin), rule), {}, id);
    assert.deepEqual(B.validate(offers[id], { ...VALID, date: "2027-11-15" }, B.bangkokToday(juin27), rule), {}, id);
  }
  assert.equal(B.inClosure("2026-11-01", rule), true);
  assert.equal(B.inClosure("2026-12-16", rule), false);
  assert.equal(B.afterClosure("2027-11-20", rule), "2027-12-16");
  assert.equal(B.closureText("2026-11-01", rule), rule.messageAnnee);
  assert.equal(B.closureText("2028-11-01", rule), rule.message);
  assert.equal(B.inClosure("2026-11-01", null), false);
  // Une seule définition dans les données, rappelée dans aConfirmer
  assert.equal((fs.readFileSync(path.join(root, "src/carnet/koh-samui-excursions-bateau.11tydata.js"), "utf8").match(/debut: "11-01"/g) || []).length, 1);
  assert.ok(data.aConfirmer.some((t) => /reglages\.fermetureAngThong/.test(t)));
});

test("estimation partielle : un enfant sans tarif écrit rend le total non définitif, dit dans l'estimation et dans le récapitulatif", async () => {
  // 3 ans sur une sortie dont le barème commence à 4 ans
  const a = total("ang-thong-big-boat", { adults: 2, ages: [3], variante: "avec-kayak" });
  assert.equal(a.partial, 1);
  assert.equal(B.partialMessage(a.partial), "Estimation partielle : le tarif de 1 enfant est à confirmer avec Anaïs");
  // enfant plus âgé que la limite, sans règle adulte écrite (speedboat en groupe : enfant jusqu'à 10 ans)
  assert.equal(total("ang-thong-speedboat-groupe", { adults: 2, ages: [11] }).partial, 1);
  assert.equal(total("pig-island-groupe", { adults: 2, ages: [3, 12] }).partial, 2);
  assert.equal(B.partialMessage(2), "Estimation partielle : le tarif de 2 enfants est à confirmer avec Anaïs");
  // pas partielle : tarifs écrits (enfant dans la fourchette, bébé gratuit, adulte « dès 10 ans »), bateau privé
  assert.equal(total("ang-thong-big-boat", { adults: 2, ages: [4, 11], variante: "avec-kayak" }).partial, 0);
  assert.equal(total("ang-thong-petit-groupe-speedboat", { adults: 2, ages: [2, 5, 10, 16] }).partial, 0, "petit groupe : adulte dès 10 ans écrit");
  assert.equal(total("pig-island-longtail-prive-4h", { adults: 2, ages: [1, 15] }).partial, 0);
  assert.equal(total("pig-island-groupe", { adults: 2, ages: [] }).partial, 0);
  // récapitulatif envoyé à Gestion et à WhatsApp
  const f = fakeFetch({ ok: true });
  const res = B.submitRequest(config, "ang-thong-big-boat", { ...VALID, date: "2027-01-05", variante: "avec-kayak", creneau: "", ages: ["3"], openedAt: NOW - 20000 }, { fetch: f, now: NOW });
  assert.equal(res.ok, true);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.match(body.message, /Estimation : 3.700.THB, à payer sur place après confirmation\nEstimation partielle : le tarif de 1 enfant est à confirmer avec Anaïs/);
  assert.ok(decodeURIComponent(res.whatsappUrl).includes("Estimation partielle : le tarif de 1 enfant est à confirmer avec Anaïs"));
  const complet = B.submitRequest(config, "ang-thong-big-boat", { ...VALID, date: "2027-01-05", variante: "avec-kayak", creneau: "", ages: ["5"], openedAt: NOW - 20000 }, { fetch: fakeFetch({ ok: true }), now: NOW });
  assert.doesNotMatch(complet.recap, /partielle/);
  // et dans l'estimation affichée
  const js = fs.readFileSync(path.join(root, "src/js/carnet-booking.js"), "utf8");
  assert.match(js, /est\.partial \? "Estimation partielle" : "Estimation"/);
  assert.match(js, /partialMessage\(est\.partial\) \+ "\."/);
});

test("mémoire de page : nom, WhatsApp et hôtel gardés d'une offre à l'autre, vidés après l'envoi ; le fond de la feuille ne ferme pas une saisie en cours", () => {
  const m = B.makeMemory();
  assert.equal(m.get("name"), "");
  m.set("name", "Anna Keller"); m.set("whatsapp", "+41 79 123 45 67"); m.set("pickup", "Hôtel d’essai");
  assert.deepEqual([m.get("name"), m.get("whatsapp"), m.get("pickup")], ["Anna Keller", "+41 79 123 45 67", "Hôtel d’essai"]);
  m.clear();
  assert.deepEqual([m.get("name"), m.get("whatsapp"), m.get("pickup")], ["", "", ""]);
  assert.equal(B.shouldCloseOnBackdrop(false), true);
  assert.equal(B.shouldCloseOnBackdrop(true), false, "formulaire modifié : le fond ne ferme pas");
  const js = fs.readFileSync(path.join(root, "src/js/carnet-booking.js"), "utf8");
  const render = js.slice(js.indexOf("function render(offer)"), js.indexOf("function render(offer)") + 600);
  assert.match(render, /form\.reset\(\)/);
  assert.match(render, /\$\("name"\)\.value = memory\.get\("name"\)/);
  assert.match(render, /\$\("whatsapp"\)\.value = memory\.get\("whatsapp"\)/);
  assert.match(render, /\$\("pickup"\)\.value = memory\.get\("pickup"\)/);
  assert.match(js, /e\.target === dialog && shouldCloseOnBackdrop\(dirty && !form\.hidden\)/);
  // envoi réussi : mémoire vidée avant l'écran de confirmation
  const submit = js.slice(js.indexOf("function onSubmit"));
  assert.ok(submit.indexOf("memory.clear()") > -1 && submit.indexOf("memory.clear()") < submit.indexOf("showDone(res);", submit.indexOf("memory.clear()")));
  assert.match(js, /if \(key\) memory\.set\(key, e\.target\.value\)/);
});

test("numéro WhatsApp : un pays qui garde son 0 initial n'est jamais amputé ; les autres perdent le zéro national", () => {
  const cas = {
    // Italie : le 0 des fixes fait partie du numéro
    "+390212345678": ["+39 02 1234 5678", "0039 02 1234 5678", "+39 (0)2 1234 5678", "+39 0212345678"],
    "+393123456789": ["+39 312 345 6789", "0039 312 345 6789"],
    // Suisse, France, Thaïlande, Royaume-Uni, Allemagne, Belgique, Pays-Bas
    "+41791234567": ["+41 79 123 45 67", "+41 079 123 45 67", "+41 (0)79 123 45 67"],
    "+33612345678": ["+33 6 12 34 56 78", "+33 06 12 34 56 78"],
    "+66812345678": ["+66 81 234 5678", "+66 081 234 5678"],
    "+447700900123": ["+44 7700 900123", "+44 07700 900123"],
    "+4915112345678": ["+49 151 1234 5678", "+49 0151 1234 5678", "+49 (0)151 1234 5678"],
    "+493012345678": ["+49 30 1234 5678", "+49 030 1234 5678"],
    "+32470123456": ["+32 470 12 34 56", "+32 0470 12 34 56", "+32 (0)470 12 34 56"],
    "+31612345678": ["+31 6 12345678", "+31 06 12345678", "+31 (0)6 12345678"]
  };
  for (const [e164, ecritures] of Object.entries(cas)) for (const w of ecritures) assert.equal(B.phoneE164(w), e164, w);
  // Pays sans zéro national (Portugal, Espagne, Danemark, Norvège, Luxembourg) : un 0 saisi après l'indicatif n'est pas touché
  assert.equal(B.phoneE164("+351 912 345 678"), "+351912345678");
  assert.equal(B.phoneE164("+34 612 345 678"), "+34612345678");
  assert.equal(B.phoneE164("+45 12 34 56 78"), "+4512345678");
  assert.equal(B.phoneE164("+47 912 34 567"), "+4791234567");
  assert.equal(B.phoneE164("+352 621 123 456"), "+352621123456");
});
