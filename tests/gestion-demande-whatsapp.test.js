// Numéro WhatsApp et nom complet dans les demandes du site (migration 41, 17.11.2026). La base est vérifiée par docs/gestion/verif-site.mjs ;
// ici la mise au format E.164 par la fonction « demande-site », l'affichage d'une demande avec ou sans numéro, le lien wa.me, la réponse
// « Il n'a pas écrit » et la démo, où chaque entreprise ne voit que ses demandes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lireDemande, telephoneE164, notification } from "../supabase/functions/demande-site/calc.js";
import { numeroWhatsApp, lienWhatsAppClient, numeroAffiche, reponseSansMessage, reponseConfirmation, E164 } from "../src/gestion/js/demandes-site-calc.mjs";

const AJD = "2026-11-17";
const corps = (o) => JSON.stringify({ brand: "secret", product_id: "4-islands", product: "4 Islands", date: "2026-11-18", adults: 2, name: "Anna Keller", ref: "FOUR-7K3Q", ...o });
const source = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("numéro : espaces, tirets, points, parenthèses, 00 et (0) donnent le même E.164", () => {
  for (const saisi of ["+41 79 123 45 67", "+41-79-123-45-67", "+41.79.123.45.67", "0041 79 123 45 67", "00 41 79 123 45 67", "+41 (0)79 123 45 67", "(+41) 79 123 45 67", " +41791234567 ", "tel:+41791234567", "+41 79 123 45 67"]) {
    assert.deepEqual(telephoneE164(saisi), { telephone: "+41791234567", telephone_saisi: null }, saisi);
  }
});

test("numéro : un 0 de tête n'est lu qu'avec l'indicatif du pays ; l'Italie garde son 0", () => {
  assert.equal(telephoneE164("079 123 45 67", "41").telephone, "+41791234567");
  assert.equal(telephoneE164("079 123 45 67", "+41").telephone, "+41791234567");
  assert.equal(telephoneE164("081-234-5678", "66").telephone, "+66812345678");
  assert.equal(telephoneE164("06 12 34 56 78", "0033").telephone, "+33612345678");
  assert.equal(telephoneE164("347 123 4567", "39").telephone, "+393471234567");
  assert.equal(telephoneE164("06 1234 5678", "39").telephone, "+390612345678");
  assert.equal(telephoneE164("+44 7700 900123", "41").telephone, "+447700900123", "un numéro international garde son propre indicatif");
  // Sans indicatif, on ne devine pas le pays : rien d'inventé, ce qui a été tapé est gardé pour Anaïs.
  assert.deepEqual(telephoneE164("079 123 45 67"), { telephone: null, telephone_saisi: "079 123 45 67" });
  assert.deepEqual(telephoneE164("41791234567"), { telephone: null, telephone_saisi: "41791234567" });
  assert.deepEqual(telephoneE164("079 123 45 67", "abc"), { telephone: null, telephone_saisi: "079 123 45 67" });
});

test("numéro illisible : la demande n'est jamais perdue, la saisie est gardée (40 caractères)", () => {
  for (const saisi of ["call me", "+41 79", "+0 791234567", "+1234567890123456", "+41 79 123 45 67 ext 2"]) {
    const r = telephoneE164(saisi);
    assert.equal(r.telephone, null, saisi);
    assert.equal(r.telephone_saisi, saisi);
  }
  assert.equal(telephoneE164("9".repeat(80)).telephone_saisi.length, 40);
  const emoji = telephoneE164("x".repeat(39) + "📞📞").telephone_saisi;
  assert.equal(Array.from(emoji).length, 40, "coupé par caractère");
  assert.ok(emoji.isWellFormed(), "jamais un émoji coupé en deux (texte invalide pour la base)");
  assert.deepEqual(telephoneE164("  \u0000‮ "), { telephone: null, telephone_saisi: null });
  for (const vide of [undefined, null, "", { a: 1 }, ["+41791234567"]]) assert.deepEqual(telephoneE164(vide), { telephone: null, telephone_saisi: null });
  const l = lireDemande(corps({ whatsapp: "pas de numéro !" }), { aujourdhui: AJD });
  assert.equal(l.produit_id, "4-islands", "la demande est lue quand même");
  assert.equal(l.telephone, null);
  assert.equal(l.telephone_saisi, "pas de numéro !");
  assert.ok(E164.test(lireDemande(corps({ whatsapp: "+66 81 234 5678" }), { aujourdhui: AJD }).telephone));
});

test("fonction : le numéro et le nom complet arrivent dans la ligne ; sans numéro (page en cache) la demande passe", () => {
  const l = lireDemande(corps({ name: "Anna Maria Keller-Schmid", whatsapp: "0041 79 123 45 67" }), { aujourdhui: AJD });
  assert.equal(l.nom, "Anna Maria Keller-Schmid");
  assert.equal(l.telephone, "+41791234567");
  assert.equal(l.telephone_saisi, null);
  assert.equal(lireDemande(corps({ whatsapp: "079 123 45 67", whatsapp_country: "41" }), { aujourdhui: AJD }).telephone, "+41791234567");
  const ancienne = lireDemande(corps({}), { aujourdhui: AJD });
  assert.equal(ancienne.telephone, null);
  assert.equal(ancienne.telephone_saisi, null);
  assert.equal(lireDemande(corps({ name: "x".repeat(120) }), { aujourdhui: AJD }).nom.length, 120, "120 caractères passent");
  // La notification passe par Apple et Google : ni le nom ni le numéro.
  const n = notification(l, AJD);
  assert.doesNotMatch(JSON.stringify(n), /Keller|41791234567|\+41/);
});

test("fonction : le numéro n'est écrit dans aucun journal", () => {
  const index = source("supabase/functions/demande-site/index.ts");
  for (const appel of index.match(/console\.(log|error|warn|info)\([^\n]*\)/g) || []) assert.doesNotMatch(appel, /ligne|telephone|corps\b|whatsapp/, appel);
});

test("demande sans numéro (avant le 17.11) : pas de lien, la carte le dit, la réponse reste à copier", () => {
  const ancienne = { marque: "secret", produit: "4 Islands", nom: "Anna Keller", date_service: "2026-11-18", ref: "FOUR-7K3Q" };
  assert.equal(numeroWhatsApp(ancienne), "");
  assert.equal(lienWhatsAppClient(ancienne, "Hi"), "");
  assert.equal(numeroWhatsApp({ telephone: "079 123 45 67" }), "", "seul un numéro E.164 donne un lien");
  assert.equal(numeroWhatsApp({ telephone: "javascript:alert(1)" }), "");
  assert.match(reponseConfirmation(ancienne, { date: "2026-11-18" }, { aujourdhui: AJD }), /Reference: FOUR-7K3Q/);
  const vue = source("src/gestion/js/views/demandes-site.mjs");
  assert.match(vue, /tr\("Pas de numéro WhatsApp"\)/);
  assert.match(vue, /tr\("Numéro à vérifier : \{saisi\}", \{ saisi: d\.telephone_saisi \}\)/);
  assert.match(vue, /if \(!numeroWhatsApp\(d\)\) return null;/, "pas de bouton WhatsApp sans numéro");
  assert.match(vue, /numeroWhatsApp\(d\) \? h\("button"[^\n]*ouvrirSansMessage/, "« Il n'a pas écrit » seulement avec un numéro");
});

test("lien wa.me : chiffres seuls, texte encodé, rien d'envoyé par l'outil", () => {
  const d = { telephone: "+41791234567" };
  assert.equal(lienWhatsAppClient(d), "https://wa.me/41791234567");
  assert.equal(lienWhatsAppClient(d, "Hi Anna,\n\nYour booking is confirmed & paid? 100%"), "https://wa.me/41791234567?text=Hi%20Anna%2C%0A%0AYour%20booking%20is%20confirmed%20%26%20paid%3F%20100%25");
  assert.equal(numeroAffiche("+41791234567"), "+41 791234567");
  assert.equal(numeroAffiche("+447700900123"), "+44 7700900123");
  assert.equal(numeroAffiche("+12025550143"), "+1 2025550143");
  assert.equal(numeroAffiche("+353861234567"), "+353 861234567");
  // Un lien que l'on touche, jamais un envoi : pas d'appel réseau vers WhatsApp dans l'écran.
  const vue = source("src/gestion/js/views/demandes-site.mjs");
  assert.doesNotMatch(vue, /fetch\(|sendBeacon|window\.open\(/);
  assert.match(vue, /h\("a", \{ class: "bouton principal dsite-wa", target: "_blank", rel: "noopener", href: lienWhatsAppClient\(d, zone\.value\)/);
});

test("« Il n'a pas écrit » : un mot poli en anglais au client, avec la sortie, le jour et la référence", () => {
  const d = { marque: "secret", produit: "4 Islands", nom: "Anna Keller", date_service: "2026-11-18", ref: "FOUR-7K3Q" };
  assert.equal(reponseSansMessage(d, { aujourdhui: AJD }), "Hi Anna,\n\nWe received your booking request from our website for 4 Islands on Wednesday 18 November, but your WhatsApp message didn't reach us.\nIs it still on? Just reply here and we'll take care of it.\n\nReference: FOUR-7K3Q");
  const taxi = reponseSansMessage({ marque: "taxi", produit: "Krabi Airport to Koh Lanta", nom: "", date_service: "2026-11-18" }, { aujourdhui: AJD });
  assert.match(taxi, /^Hi,\n\nWe received your transfer request from our website for Krabi Airport to Koh Lanta on Wednesday 18 November/);
  assert.doesNotMatch(taxi, /Reference/);
  assert.doesNotMatch(reponseSansMessage({ marque: "secret", produit_id: "4-islands", nom: "Anna" }, { aujourdhui: AJD }), / on (Mon|Tue|Wed|Thu|Fri|Sat|Sun)/, "sans date, pas de jour inventé");
});

test("« Coller une demande » reprend le numéro du site pour la fiche du client", () => {
  const vue = source("src/gestion/js/views/demande.mjs");
  assert.match(vue, /if \(depuisSite && depuisSite\.telephone && !d\.telephone\) d\.telephone = depuisSite\.telephone;/);
  assert.match(source("src/gestion/js/views/demandes-site.mjs"), /telephone: numeroWhatsApp\(d\),/);
});

test("migration 41 : colonnes au format E.164, nom à 120, rien d'autre ne change", () => {
  const sql = source("docs/gestion/migration-41-demande-whatsapp.sql");
  assert.match(sql, /add column if not exists telephone text;/);
  assert.match(sql, /check \(telephone is null or telephone ~ '\^\\\+\[1-9\]\[0-9\]\{7,14\}\$'\)/);
  assert.match(sql, /check \(length\(nom\) <= 120\)/);
  assert.doesNotMatch(sql, /grant |policy|update demandes_site set|insert into/i, "ni droit, ni règle, ni donnée touchés");
});

test("démo : chaque personne ne voit que les demandes des entreprises où elle lit tous les dossiers", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  globalThis.location = { origin: "http://localhost", pathname: "/gestion/", search: "?demo", hash: "" };
  try {
    const { creer } = await import("../src/gestion/js/store-local.mjs");
    const store = creer();
    const qui = (re) => store.utilisateursDemo().find((u) => re.test(u.nom));
    const vues = async (u) => {
      store.changerUtilisateurDemo(u.id);
      const d = await store.charger();
      return { slugs: new Set(d.demandes_site.map((x) => d.entites.find((e) => e.id === x.entite_id).slug)), demandes: d.demandes_site };
    };
    const admin = await vues(qui(/^Administratrice/));
    assert.deepEqual([...admin.slugs].sort(), ["excursions", "taxi"]);
    assert.ok(admin.demandes.some((x) => x.telephone) && admin.demandes.some((x) => !x.telephone && !x.telephone_saisi) && admin.demandes.some((x) => x.telephone_saisi), "la démo montre les trois cas");
    assert.ok(admin.demandes.every((x) => x.telephone === null || E164.test(x.telephone)));
    const compta = await vues(qui(/^Comptable/));
    assert.deepEqual([...compta.slugs], ["taxi"], "membre de Taxi seulement : aucune demande de Secret");
    assert.equal((await vues(qui(/^Stagiaire/))).demandes.length, 0, "un rôle limité à ses dossiers ne voit aucun numéro");
  } finally {
    delete globalThis.localStorage;
    delete globalThis.location;
  }
});
