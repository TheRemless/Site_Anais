// Demandes et bandeau du site secrettravelandtour.com (migration 30) : fonction publique, boîte « Demandes du site », bandeau.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { origineAdmise, lireOrigines, ORIGINES_DEFAUT, lireDemande, dateValide, adresseIP, notification, destinataires, REPONSES, reponseInvalide, TAILLE_MAX } from "../supabase/functions/demande-site/calc.js";
import { reponsePublique, bandeauPublic, choisirBandeau, enLigne } from "../supabase/functions/bandeau-site/calc.js";
import { texteDemande, changements, reponseConfirmation, reponseRefus, imposerTotal, chiffresDemandes, trierDemandes, dateAnglaise, montantAnglais, cheminPage, titreOption, nomProduit } from "../src/gestion/js/demandes-site-calc.mjs";
import { MODELES, texteBandeau, verifierBandeau, finProposee, etiquetteCarte, ligneBandeau, etatBandeau, libelleLien, pagesLien, TEXTE_MAX } from "../src/gestion/js/bandeau-calc.mjs";
import { PRODUITS_SITE } from "../src/gestion/js/site-produits.mjs";
import { lireMessage } from "../src/gestion/js/demande-calc.mjs";

const AJD = "2026-11-16";
const corps = (o) => JSON.stringify({ brand: "secret", product_id: "4-islands", product: "4 Islands", option: "join-in-longtail", option_label: "Join-in longtail", date: "2026-11-18", adults: 2, children: 1, pickup: "Lanta Sand Resort", name: "Anna Keller", estimated_total: 3000, currency: "THB", ref: "FOUR-7K3Q", page_url: "https://secrettravelandtour.com/tours/4-islands/", message: "Booking request: 4 Islands – Join-in longtail\nDate: Wed 18 Nov 2026\nGuests: 2 adults, 1 child (age 7)\nName: Anna Keller", ...o });
const erreurDe = (f) => { try { f(); return null; } catch (e) { return { code: e.code, champ: e.champ }; } };

test("demande-site : seul le site (et la machine de développement) est une origine admise", () => {
  assert.ok(origineAdmise("https://secrettravelandtour.com"));
  assert.ok(origineAdmise("https://www.secrettravelandtour.com"));
  assert.ok(origineAdmise("http://localhost:8080"));
  assert.ok(origineAdmise("http://127.0.0.1:3000"));
  for (const o of [null, "", "https://secrettravelandtour.com.evil.example", "http://secrettravelandtour.com", "https://evil.example", "http://localhost.evil.example", "null"]) assert.equal(origineAdmise(o), false, o);
});

test("demande-site : une demande correcte donne la ligne à écrire, rien de plus", () => {
  const l = lireDemande(corps({ extra: "ignoré", ip_empreinte: "x", statut: "confirmee", entite_id: "y" }), { aujourdhui: AJD });
  assert.deepEqual(Object.keys(l).sort(), ["adultes", "date_service", "devise", "enfants", "heure", "marque", "message", "nom", "option_id", "option_titre", "page_url", "pickup", "produit", "produit_id", "ref", "total_estime"].sort());
  assert.equal(l.marque, "secret");
  assert.equal(l.date_service, "2026-11-18");
  assert.equal(l.adultes, 2);
  assert.equal(l.total_estime, 3000);
  assert.equal(l.message.split("\n").length, 4, "le message garde ses lignes");
  assert.equal(lireDemande(corps({ brand: "taxi", product_id: "krabi-airport-koh-lanta", time: "14:30" }), { aujourdhui: AJD }).heure, "14:30");
});

test("demande-site : formats, tailles et types sont contrôlés", () => {
  const o = { aujourdhui: AJD };
  // La forme seulement : l'existence de la marque (entreprise de l'organisation qui publie sur le site) est vérifiée dans la base.
  for (const brand of ["Secret", "../x", "a b", "x".repeat(41), 42, ["secret"]]) assert.deepEqual(erreurDe(() => lireDemande(corps({ brand }), o)), { code: "marque", champ: "brand" }, String(brand));
  assert.equal(lireDemande(corps({ brand: "ride-co" }), o).marque, "ride-co", "une marque d'un autre client passe le contrôle de forme");
  assert.deepEqual(erreurDe(() => lireDemande(corps({ product_id: "../etc" }), o)), { code: "produit", champ: "product_id" });
  assert.deepEqual(erreurDe(() => lireDemande(corps({ date: "2026-02-30" }), o)), { code: "date", champ: "date" });
  assert.deepEqual(erreurDe(() => lireDemande(corps({ date: "2028-01-01" }), o)), { code: "date", champ: "date" }, "plus de 400 jours");
  assert.deepEqual(erreurDe(() => lireDemande(corps({ time: "25:00" }), o)), { code: "format", champ: "time" });
  assert.deepEqual(erreurDe(() => lireDemande(corps({ adults: 2.5 }), o)), { code: "nombre", champ: "adults" });
  assert.deepEqual(erreurDe(() => lireDemande(corps({ adults: 500 }), o)), { code: "nombre", champ: "adults" });
  assert.deepEqual(erreurDe(() => lireDemande(corps({ estimated_total: -1 }), o)), { code: "nombre", champ: "estimated_total" });
  assert.deepEqual(erreurDe(() => lireDemande(corps({ name: "x".repeat(101) }), o)), { code: "trop_long", champ: "name" });
  assert.deepEqual(erreurDe(() => lireDemande(corps({ name: { a: 1 } }), o)), { code: "type", champ: "name" });
  assert.deepEqual(erreurDe(() => lireDemande(corps({ ref: "four<script>" }), o)), { code: "format", champ: "ref" });
  assert.equal(erreurDe(() => lireDemande("{pas du json", o)).code, "json");
  assert.equal(erreurDe(() => lireDemande("[1,2]", o)).code, "json");
  assert.equal(erreurDe(() => lireDemande("x".repeat(TAILLE_MAX + 1), o)).code, "trop_gros");
  // Caractères de contrôle et d'inversion de sens retirés, espaces resserrés.
  assert.equal(lireDemande(corps({ name: "  Anna\u0000\u202e  Keller " }), o).nom, "Anna Keller");
  // Une adresse de page hors du site n'est pas gardée.
  assert.equal(lireDemande(corps({ page_url: "https://evil.example/tours/" }), o).page_url, null);
  assert.equal(lireDemande(corps({ page_url: "javascript:alert(1)" }), o).page_url, null);
});

test("demande-site : le champ piège rempli par un robot donne « ok » sans rien écrire", () => {
  assert.deepEqual(lireDemande(corps({ website: "http://spam.example" }), { aujourdhui: AJD }), { piege: true });
});

test("demande-site : date valide entre hier et 400 jours ; IP posée par Cloudflare avant celle que le client peut écrire", () => {
  assert.ok(dateValide("2026-11-15", AJD));
  assert.ok(!dateValide("2026-11-14", AJD));
  assert.equal(adresseIP(new Map([["x-forwarded-for", "203.0.113.5, 10.0.0.1"]])), "203.0.113.5");
  assert.equal(adresseIP(new Map([["x-forwarded-for", "1.2.3.4"], ["cf-connecting-ip", "198.51.100.7"]])), "198.51.100.7");
  assert.equal(adresseIP(new Map([["x-forwarded-for", "1.2.3.4"], ["x-real-ip", "198.51.100.8"]])), "198.51.100.8");
  assert.equal(adresseIP(new Map()), "");
});

test("demande-site : la notification dit la sortie, les personnes et le jour, jamais le nom ni l'hôtel", () => {
  const l = lireDemande(corps(), { aujourdhui: AJD });
  const n = notification(l, AJD);
  assert.equal(n.titre, "Nouvelle demande du site");
  assert.equal(n.corps, "4 Islands (Join-in longtail), 2 adultes, 1 enfant, mercredi 18");
  assert.ok(!/Anna|Keller|Lanta Sand/.test(JSON.stringify(n)));
  assert.equal(notification({ ...l, date_service: AJD }, AJD).corps.endsWith("aujourd'hui"), true);
  assert.match(notification({ ...l, date_service: "2027-01-05", option_titre: null }, AJD).corps, /mardi 5 janvier$/);
  assert.equal(notification({ marque: "taxi", produit_id: "x", produit: "Krabi Airport to Koh Lanta", adultes: 1, date_service: "2026-11-17" }, AJD, "VIP Taxi Lanta").titre, "Nouvelle demande VIP Taxi Lanta");
  assert.equal(notification({ marque: "ride-co", produit_id: "x", adultes: 1 }, AJD, "Ride Co").titre, "Nouvelle demande Ride Co", "le titre vient du nom de l'entreprise, pas de la marque");
});

test("demande-site : la notification va à qui lit les demandes de l'entreprise, jamais à l'écran voucher seul", () => {
  const roles = [{ id: "ed", portee: "toute", permissions: ["dossiers.lire", "dossiers.ecrire"] }, { id: "mes", portee: "mes_dossiers", permissions: ["dossiers.lire"] }, { id: "vs", portee: "toute", permissions: ["dossiers.lire", "vouchers.seul"] }];
  const profils = [{ user_id: "anais", actif: true }, { user_id: "stag", actif: true }, { user_id: "mook", actif: true }, { user_id: "root", actif: true, super_admin: true }, { user_id: "parti", actif: false, super_admin: true }, { user_id: "ztp", actif: true }];
  const membres = [{ user_id: "anais", entite_id: "S", role_id: "ed" }, { user_id: "stag", entite_id: "S", role_id: "mes" }, { user_id: "mook", entite_id: "S", role_id: "vs" }, { user_id: "ztp", entite_id: "Z", role_id: "ed" }];
  assert.deepEqual(destinataires({ entiteId: "S", profils, membres, roles }), ["anais", "root"]);
});

test("demande-site : réponses courtes, sans détail interne", () => {
  assert.deepEqual(REPONSES.ok, { status: 202, corps: { ok: true } });
  assert.deepEqual(reponseInvalide({ code: "date", champ: "date" }), { status: 400, corps: { ok: false, error: "invalid", field: "date" } });
  for (const r of Object.values(REPONSES)) assert.ok(!/stack|sql|supabase/i.test(JSON.stringify(r.corps)));
});

// ---- Boîte « Demandes du site » -------------------------------------------------------------------------------------------
const D = { id: "d1", marque: "secret", statut: "nouvelle", ref: "FOUR-7K3Q", produit_id: "4-islands", produit: "4 Islands", option_id: "join-in-longtail", option_titre: "Join-in longtail", date_service: "2026-11-18", adultes: 2, enfants: 1, pickup: "Lanta Sand Resort", nom: "Anna Keller", total_estime: 3000, devise: "THB", page_url: "https://secrettravelandtour.com/tours/4-islands/?x=1", message: "Booking request: 4 Islands – Join-in longtail\nDate: Wed 18 Nov 2026\nGuests: 2 adults, 1 child (age 7)\nPickup: Lanta Sand Resort\nName: Anna Keller\nEstimated total: 3,000 THB", created_at: "2026-11-16T03:00:00Z" };

test("texteDemande : le message du site, relu tel quel par « Coller une demande »", () => {
  const lu = lireMessage(texteDemande(D), AJD);
  assert.equal(lu.date, "2026-11-18");
  assert.equal(lu.adultes, 2);
  assert.equal(lu.enfants, 1);
  assert.equal(lu.nom, "Anna Keller");
});

test("une ligne « Ref: » ajoutée au message du site ne change rien à la lecture", () => {
  const sans = lireMessage(texteDemande(D), AJD);
  const avec = lireMessage(`${texteDemande(D)}\nRef: FOUR-7K3Q`, AJD);
  for (const k of ["date", "adultes", "enfants", "nom", "hotel", "option", "prixSite"]) assert.deepEqual(avec[k], sans[k], k);
});

test("texteDemande : les changements de « Modifier » sont posés sur le message", () => {
  const t = texteDemande(D, { date: "2026-11-19", heure: "08:30", option_titre: "Private longtail" });
  assert.match(t, /^Booking request: 4 Islands – Private longtail$/m);
  assert.match(t, /^Date: Thu 19 Nov 2026$/m);
  assert.match(t, /^Pickup time: 08:30$/m);
  const lu = lireMessage(t, AJD);
  assert.equal(lu.date, "2026-11-19");
  assert.equal(lu.heure, "08:30");
});

test("texteDemande : sans message (ancien site), le message est reconstruit au format du site", () => {
  const t = texteDemande({ ...D, message: null });
  assert.equal(t.split("\n")[0], "Booking request: 4 Islands – Join-in longtail");
  const lu = lireMessage(t, AJD);
  assert.equal(lu.date, "2026-11-18");
  assert.equal(lu.adultes, 2);
  const taxi = texteDemande({ ...D, marque: "taxi", produit: "Krabi Airport to Koh Lanta", option_titre: null, option_id: null, heure: "14:30", message: "" });
  assert.match(taxi, /^Transfer request: Krabi Airport to Koh Lanta$/m);
  assert.match(taxi, /^Pickup time: 14:30$/m);
});

test("changements : ce qui diffère de la demande ; une heure que le site n'a pas demandée n'en est pas un", () => {
  const final = { date: "2026-11-19", heure: "08:30", option_titre: "Join-in longtail", adultes: 2, enfants: 1, total: 3200 };
  assert.deepEqual(changements(D, final).map((c) => c.champ), ["date", "prix"]);
  assert.deepEqual(changements(D, { ...final, date: D.date_service, total: 3000 }), []);
  assert.deepEqual(changements({ ...D, heure: "14:30" }, { ...final, date: D.date_service, total: 3000, heure: "15:00" }).map((c) => c.champ), ["heure"]);
});

test("réponse de confirmation : anglais, récapitulatif, référence, changements dits", () => {
  const sans = reponseConfirmation(D, { date: "2026-11-18", heure: "08:30", adultes: 2, enfants: 1, total: 3000, devise: "THB" }, { aujourdhui: AJD });
  assert.equal(sans, ["Hi Anna,", "", "Your booking is confirmed.", "", "4 Islands – Join-in longtail", "Wednesday 18 November, pickup 08:30", "2 adults, 1 child", "Pickup: Lanta Sand Resort", "Total: 3,000 THB", "", "Reference: FOUR-7K3Q"].join("\n"));
  const avec = reponseConfirmation(D, { date: "2026-11-19", adultes: 2, enfants: 1, total: 3200, devise: "THB" }, { aujourdhui: AJD });
  assert.match(avec, /confirmed with these changes:\nDate: Thursday 19 November instead of Wednesday 18 November\nPrice: 3,200 THB instead of 3,000 THB/);
  const taxi = reponseConfirmation({ ...D, marque: "taxi", produit: "Krabi Airport to Koh Lanta", option_titre: null, option_id: null }, { date: "2026-11-18", heure: "14:30", adultes: 2, enfants: 1, total: null }, { aujourdhui: AJD });
  assert.match(taxi, /Your transfer is confirmed\./);
  assert.match(taxi, /Payment in cash to the driver on the day\./);
  assert.ok(!/Total:/.test(taxi), "pas de total inventé");
  assert.ok(!/wa\.me|http/.test(sans + avec + taxi), "aucun lien : le numéro du client n'est pas connu");
});

test("réponse de confirmation à plusieurs services : chacun sa ligne, aucun faux changement", () => {
  const final = { services: [{ titre: "4 Islands", date: "2026-11-18", heure: "08:30", adultes: 2 }, { titre: "Koh Rok", date: "2026-11-20", adultes: 2 }], date: "2026-11-18", adultes: 2, total: 5000, devise: "THB" };
  assert.deepEqual(changements(D, final), []);
  const r = reponseConfirmation(D, final, { aujourdhui: AJD });
  assert.match(r, /Your booking is confirmed\.\n\n4 Islands, Wednesday 18 November, pickup 08:30, 2 adults\nKoh Rok, Friday 20 November, 2 adults\nPickup: Lanta Sand Resort\nTotal: 5,000 THB/);
});

test("réponse de refus : motif, autre date ou autre sortie, référence", () => {
  const r = reponseRefus(D, { motif: "mer", alternative: { date: "2026-11-20", produit_id: "koh-phi-phi" } }, { aujourdhui: AJD });
  assert.match(r, /^Hi Anna,\n\nThank you for your request for 4 Islands on Wednesday 18 November\.\nUnfortunately the sea is too rough for this trip that day\.\nWe can offer Koh Phi Phi on Friday 20 November instead\.\nWould that work for you\?\n\nReference: FOUR-7K3Q$/);
  assert.match(reponseRefus({ ...D, nom: "", ref: null }, {}, { aujourdhui: AJD }), /^Hi,\n[\s\S]*We hope to see you another time\.$/);
});

test("imposerTotal : le prix convenu devient le total des lignes, l'écart sur la première ligne chiffrée", () => {
  const lignes = [{ id: "a", kind: "ligne", unite: 1200, qte: 2 }, { id: "t", kind: "texte" }, { id: "b", kind: "ligne", unite: 900, qte: 1 }];
  const somme = (ls) => ls.filter((l) => l.kind !== "texte").reduce((s, l) => s + l.unite * l.qte, 0);
  assert.equal(somme(imposerTotal(lignes, 3500)), 3500);
  assert.equal(imposerTotal(lignes, 3500)[0].qte, 2, "division juste : la quantité reste");
  assert.equal(imposerTotal(lignes, 3301)[0].unite, 1200.5, "au centime près, la quantité reste");
  assert.equal(Math.round(somme(imposerTotal(lignes, 3300.01)) * 100) / 100, 3300.01);
  assert.equal(imposerTotal(lignes, 3300.01)[0].qte, 1, "division non juste : une ligne au total");
  assert.equal(imposerTotal(lignes, 3300), lignes, "même total : rien ne change");
  assert.equal(imposerTotal(lignes, null), lignes);
});

test("chiffres : reçues, confirmées, refusées par sortie et par page, sans les classées", () => {
  const ds = [D, { ...D, id: "2", statut: "confirmee" }, { ...D, id: "3", statut: "refusee", produit_id: "koh-phi-phi", produit: "Koh Phi Phi", page_url: "https://secrettravelandtour.com/" }, { ...D, id: "4", statut: "classee" }, { ...D, id: "5", statut: "confirmee", created_at: "2026-01-01T00:00:00Z" }];
  const c = chiffresDemandes(ds, { depuis: "2026-10-17" });
  assert.equal(c.recues, 3);
  assert.equal(c.confirmees, 1);
  assert.equal(c.refusees, 1);
  assert.equal(c.taux, 50);
  assert.deepEqual(c.parProduit.map((p) => [p.nom, p.recues]), [["4 Islands", 2], ["Koh Phi Phi", 1]]);
  assert.deepEqual(c.parPage.map((p) => p.cle), ["/tours/4-islands/", "/"]);
  assert.equal(chiffresDemandes(ds).recues, 4);
  assert.equal(chiffresDemandes([]).taux, null);
});

test("liste : les demandes à traiter d'abord, les plus récentes en tête", () => {
  const ds = [{ id: "a", statut: "confirmee", created_at: "2026-11-16T05:00:00Z" }, { id: "b", statut: "nouvelle", created_at: "2026-11-15T05:00:00Z" }, { id: "c", statut: "nouvelle", created_at: "2026-11-16T04:00:00Z" }];
  assert.deepEqual(trierDemandes(ds).map((d) => d.id), ["c", "b", "a"]);
});

test("utilitaires : dates et montants en anglais, chemin de page, nom et option repris du site", () => {
  assert.equal(dateAnglaise("2026-11-18", AJD), "Wednesday 18 November");
  assert.equal(dateAnglaise("2027-01-05", AJD), "Tuesday 5 January 2027");
  assert.equal(montantAnglais(12500), "12,500 THB");
  assert.equal(cheminPage("https://secrettravelandtour.com/taxi/x/?a=1"), "/taxi/x/");
  assert.equal(cheminPage("pas une adresse"), "");
  assert.equal(nomProduit({ produit_id: "koh-phi-phi" }), "Koh Phi Phi");
  assert.equal(titreOption({ produit_id: "4-islands", option_id: "private-longtail" }), "Private longtail");
});

// ---- Bandeau -------------------------------------------------------------------------------------------------------------
test("produits du site : identifiants uniques, marques et sections connues, adresses du site", () => {
  const ids = PRODUITS_SITE.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of PRODUITS_SITE) {
    assert.ok(["secret", "taxi"].includes(p.marque), p.id);
    assert.ok(["islands", "activities", "transfers", "rental", "taxi"].includes(p.section), p.id);
    assert.match(p.url, /^\/[a-z0-9/-]*$/, p.id);
    assert.match(p.id, /^[a-z0-9-]{1,60}$/);
  }
  assert.ok(PRODUITS_SITE.some((p) => p.marque === "taxi") && PRODUITS_SITE.some((p) => p.id === "4-islands"));
});

test("modèles : chaque texte tient en 140 caractères avec la sortie au nom le plus long et des dates lointaines", () => {
  const long = [...PRODUITS_SITE].sort((a, b) => b.nom.length - a.nom.length)[0];
  const opt = [...PRODUITS_SITE].flatMap((p) => p.options.map((o) => ({ p, o }))).sort((a, b) => b.o.titre.length - a.o.titre.length)[0];
  for (const m of MODELES.filter((x) => x.id !== "libre")) {
    const valeurs = { trip: m.champs.includes("option") ? opt.p.id : long.id, option: opt.o.id, date: "2026-12-30", date2: "2026-12-31", de: "08:00", a: "20:00" };
    const { texte, manque } = texteBandeau(m.id, valeurs, AJD);
    assert.deepEqual(manque, [], m.id);
    assert.ok(texte.length <= TEXTE_MAX, `${m.id} : ${texte.length} caractères`);
    assert.ok(!/\{\w+\}/.test(texte), `${m.id} : variable restée`);
  }
});

test("texte du bandeau : modèle rempli, dates proches lisibles, champs manquants signalés", () => {
  assert.equal(texteBandeau("sea-today", {}, AJD).texte, "Rough sea today: island trips are moved to tomorrow.");
  assert.equal(texteBandeau("season-until", { trip: "sunset-dinner-raft", date: "2026-12-01" }, AJD).texte, "Sunset dinner raft does not run until 1 December.");
  assert.equal(texteBandeau("sea-trip-date", { trip: "4-islands", date: "2026-11-17" }, AJD).texte, "Rough sea: 4 Islands does not run tomorrow.");
  assert.equal(texteBandeau("sea-trip-moved", { trip: "koh-phi-phi", date: "2026-11-19", date2: "2026-11-20" }, AJD).texte, "Rough sea: Koh Phi Phi on Thursday 19 November is moved to Friday 20 November.");
  assert.equal(texteBandeau("new-option", { trip: "4-islands", option: "private-longtail" }, AJD).texte, "New on 4 Islands: Private longtail.");
  assert.equal(texteBandeau("info-full", { trip: "koh-rok-koh-haa", date: "2027-02-02" }, AJD).texte, "Koh Rok & Koh Haa is fully booked on 2 February 2027.");
  assert.deepEqual(texteBandeau("season-until", {}, AJD).manque, ["trip", "date"]);
});

test("vérification du bandeau : texte trop long, cible vide, lien hors du site, dates à l'envers", () => {
  const base = { modele: "sea-today", valeurs: {}, marques: ["secret"], cible: "tout", sections: [], produits: [], lien: "aucun", debut: "2026-11-16T01:00:00Z", fin: null };
  assert.deepEqual(verifierBandeau(base, AJD), []);
  assert.equal(verifierBandeau({ ...base, modele: "libre", valeurs: { texte: "x".repeat(141) } }, AJD)[0].code, "trop_long");
  assert.equal(verifierBandeau({ ...base, marques: [] }, AJD)[0].code, "marque");
  assert.equal(verifierBandeau({ ...base, cible: "produits" }, AJD)[0].code, "produits");
  assert.equal(verifierBandeau({ ...base, lien: "page", lien_page: "https://evil.example/" }, AJD)[0].code, "lien");
  assert.equal(verifierBandeau({ ...base, fin: "2026-11-16T00:00:00Z" }, AJD)[0].code, "dates");
  // Dates en fuseaux différents : la comparaison se fait sur l'instant, pas sur le texte.
  assert.equal(verifierBandeau({ ...base, debut: "2026-11-16T20:00:00.000Z", fin: "2026-11-17T00:00:00+07:00" }, AJD)[0].code, "dates");
  assert.deepEqual(verifierBandeau({ ...base, debut: "2026-11-16T15:00:00.000Z", fin: "2026-11-16T23:59:59+07:00" }, AJD), []);
  assert.equal(verifierBandeau({ ...base, modele: "season-until", valeurs: {} }, AJD)[0].code, "champ_vide");
});

test("fin automatique : fin de journée à Bangkok, veille d'une réouverture, rien pour une nouveauté", () => {
  assert.equal(finProposee("sea-today", {}, AJD), "2026-11-16T23:59:59+07:00");
  assert.equal(finProposee("sea-trip-moved", { date: "2026-11-19", date2: "2026-11-20" }, AJD), "2026-11-20T23:59:59+07:00");
  assert.equal(finProposee("season-until", { date: "2026-12-01" }, AJD), "2026-12-01T00:00:00+07:00");
  assert.equal(finProposee("new-trip", { trip: "atv" }, AJD), null);
  assert.equal(etiquetteCarte("season-until", { date: "2026-12-01" }), "From 1 Dec");
  assert.equal(etiquetteCarte("sea-today", {}), "Rough sea");
  assert.equal(etiquetteCarte("new-trip", {}), "");
});

test("ligne enregistrée, puis JSON public : texte, lien, cible, étiquette ; rien d'interne", () => {
  const b = { modele: "season-until", valeurs: { trip: "sunset-dinner-raft", date: "2026-12-01" }, marques: ["secret"], cible: "produits", sections: [], produits: ["sunset-dinner-raft"], lien: "page", lien_page: "/tours/sunset-dinner-raft/", debut: "2026-11-16T01:00:00.000Z", fin: finProposee("season-until", { date: "2026-12-01" }, AJD), fermable: true, priorite: 2 };
  const ligne = { id: "b1", entite_id: "SECRET", cree_par: "u1", actif: true, ...ligneBandeau(b, AJD) };
  assert.equal(ligne.type, "season");
  assert.equal(ligne.texte, "Sunset dinner raft does not run until 1 December.");
  assert.equal(ligne.valeurs.lien_libelle, "See Sunset dinner raft");
  const pub = bandeauPublic(ligne);
  assert.deepEqual(pub, { id: "b1", brands: ["secret"], type: "season", text: "Sunset dinner raft does not run until 1 December.", link: { kind: "page", href: "/tours/sunset-dinner-raft/", label: "See Sunset dinner raft" }, target: { kind: "products", products: ["sunset-dinner-raft"] }, closable: true, priority: 2, starts_at: "2026-11-16T01:00:00.000Z", ends_at: "2026-11-30T17:00:00.000Z", card_label: "From 1 Dec" });
  assert.ok(!/SECRET|u1|entite|cree_par|valeurs/.test(JSON.stringify(pub)));
  assert.deepEqual(bandeauPublic({ ...ligne, lien: "whatsapp", lien_page: null }).link, { kind: "whatsapp", label: "Ask on WhatsApp", text: "Hi, I have a question about this: Sunset dinner raft does not run until 1 December." });
});

test("en ligne : allumé, commencé, pas fini ; la réponse publique ne garde que ceux-là, triés", () => {
  const t = Date.parse("2026-11-16T05:00:00Z");
  const b = (id, o) => ({ id, marques: ["secret"], type: "info", texte: id, cible: "tout", debut: "2026-11-16T00:00:00Z", fin: null, actif: true, priorite: 2, ...o });
  const lignes = [b("eteint", { actif: false }), b("futur", { debut: "2026-11-17T00:00:00Z" }), b("fini", { fin: "2026-11-16T04:00:00Z" }), b("info"), b("urgent", { type: "urgent" }), b("haute", { priorite: 1, type: "new" })];
  assert.ok(enLigne(lignes[3], t) && !enLigne(lignes[0], t) && !enLigne(lignes[1], t) && !enLigne(lignes[2], t));
  const r = reponsePublique(lignes, t);
  assert.equal(r.version, 1);
  assert.deepEqual(r.banners.map((x) => x.id), ["haute", "urgent", "info"]);
});

test("un seul bandeau par page : marque, cible, priorité, puis gravité ; un bandeau fermé par le visiteur ne revient pas", () => {
  const t = Date.parse("2026-11-16T05:00:00Z");
  const p = (id, o) => ({ id, brands: ["secret"], type: "info", text: id, link: null, target: { kind: "all" }, closable: true, priority: 2, starts_at: "2026-11-16T00:00:00Z", ends_at: null, card_label: null, ...o });
  const liste = [p("tout"), p("taxi", { brands: ["taxi"], type: "urgent" }), p("mer-4i", { type: "sea", target: { kind: "products", products: ["4-islands"] } }), p("iles", { type: "season", target: { kind: "sections", sections: ["islands"] } })];
  assert.equal(choisirBandeau(liste, { brand: "secret", section: "islands", product: "4-islands" }, t).id, "mer-4i");
  assert.equal(choisirBandeau(liste, { brand: "secret", section: "islands", product: "koh-phi-phi" }, t).id, "iles");
  assert.equal(choisirBandeau(liste, { brand: "secret", section: "activities", product: "atv" }, t).id, "tout");
  assert.equal(choisirBandeau(liste, { brand: "taxi", section: "taxi" }, t).id, "taxi");
  assert.equal(choisirBandeau(liste, { brand: "secret", section: "islands", product: "4-islands", fermes: ["mer-4i"] }, t).id, "iles");
  assert.equal(choisirBandeau([p("x", { closable: false })], { brand: "secret", fermes: ["x"] }, t).id, "x", "un bandeau non fermable reste");
  assert.equal(choisirBandeau([p("fini", { ends_at: "2026-11-16T04:00:00Z" })], { brand: "secret" }, t), null, "le site respecte aussi la fin (cache)");
});

test("état et liens : en ligne, programmé, terminé, éteint ; pages proposées selon les marques", () => {
  const t = Date.parse("2026-11-16T05:00:00Z");
  assert.equal(etatBandeau({ actif: true, debut: "2026-11-16T00:00:00Z" }, t), "en_ligne");
  assert.equal(etatBandeau({ actif: true, debut: "2026-11-17T00:00:00Z" }, t), "programme");
  assert.equal(etatBandeau({ actif: true, debut: "2026-11-15T00:00:00Z", fin: "2026-11-16T01:00:00Z" }, t), "termine");
  assert.equal(etatBandeau({ actif: false, debut: "2026-11-16T00:00:00Z" }, t), "eteint");
  assert.equal(libelleLien("/tours/4-islands/"), "See 4 Islands");
  assert.equal(libelleLien("/taxi/"), "See VIP Taxi Lanta");
  assert.ok(pagesLien(["taxi"]).every((p) => p.href.startsWith("/taxi/")));
  assert.ok(!pagesLien(["secret"]).some((p) => p.href.startsWith("/taxi/")));
});

test("migration 30 : le public n'a aucun droit d'écriture, l'outil ne modifie que le traitement", () => {
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-30-site.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on demandes_site, bandeaux_site from anon, authenticated;/);
  assert.match(sql, /grant update \(statut, dossier_id, decision\) on demandes_site to authenticated;/);
  assert.ok(!/grant[^;]*insert[^;]*on demandes_site/i.test(sql), "aucune insertion de demande hors de la fonction");
  assert.ok(!/to anon/i.test(sql.replace(/from anon/g, "")), "rien n'est accordé à anon");
});

test("contrats du site : les deux documents existent et donnent l'adresse des fonctions", () => {
  const demandes = fs.readFileSync(new URL("../docs/gestion/demandes-site.md", import.meta.url), "utf8");
  const bandeau = fs.readFileSync(new URL("../docs/gestion/bandeau-site.md", import.meta.url), "utf8");
  assert.match(demandes, /functions\/v1\/demande-site/);
  assert.match(demandes, /keepalive: true/);
  assert.match(bandeau, /functions\/v1\/bandeau-site/);
});

test("demande-site : les adresses du site viennent de SITE_ORIGINES, celui d'Anaïs sans réglage", () => {
  assert.deepEqual(lireOrigines(undefined), ORIGINES_DEFAUT);
  assert.deepEqual(lireOrigines("http://ride.example, https://ride.example/chemin, javascript:x"), ORIGINES_DEFAUT, "rien de valable");
  const o = lireOrigines(" https://Ride.example/ ,https://www.ride.example,https://ride.example");
  assert.deepEqual(o, ["https://ride.example", "https://www.ride.example"]);
  assert.ok(origineAdmise("https://ride.example", o));
  assert.ok(origineAdmise("http://localhost:8080", o), "la machine de développement reste admise");
  assert.equal(origineAdmise("https://secrettravelandtour.com", o), false, "un client ne reçoit pas les demandes du site d'Anaïs");
  const page = (url, origines) => lireDemande(corps({ page_url: url }), { aujourdhui: AJD, origines }).page_url;
  assert.equal(page("https://ride.example/tours/a/?x=1", o), "https://ride.example/tours/a/?x=1");
  assert.equal(page("https://ride.example.evil.example/", o), null);
  assert.equal(page("https://secrettravelandtour.com/tours/", o), null);
  assert.equal(page("https://secrettravelandtour.com/tours/"), "https://secrettravelandtour.com/tours/");
});
