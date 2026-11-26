// Téléphone coupé (INV-2026-055, 26.11.2026). Un numéro copié depuis WhatsApp sur iPhone, « +1 (555) 010-4477 (trait d’union insécable) » avec un trait d'union
// insécable (U+2011) entre des marques de sens, était lu « +1555010 » et enregistré sans un mot. La carte de l'Assistant n'avait pas de
// téléphone et la conversation WhatsApp du client est restée sans client ni dossier.
// Ici : la lecture des numéros (outil), le numéro de la conversation repris pour la carte, puis les chemins réels de la démo (carte « dossier »
// d'un geste et « Vérifier avant », dans Secret et dans Taxi) jusqu'à la fiche client écrite. Numéros et noms inventés.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { installerDom } from "./aides-dom.mjs";
import { normaliserTelephone, nettoyerTelephone } from "../src/gestion/js/partenaires-calc.mjs";
import { verifierTelephoneClient, verifierNouveauClient, messageTelephone } from "../src/gestion/js/client-calc.mjs";
import { telephoneDepuisWhatsApp } from "../src/gestion/js/telephone-carte-calc.mjs";
import { telephoneValide, donneesVoucher, valeursVides } from "../src/gestion/js/voucher-rapide-calc.mjs";
import { EN } from "../src/gestion/js/i18n-en.mjs";
import fs from "node:fs";

const U = (code) => String.fromCharCode(code);
// Le numéro tel que WhatsApp sur iPhone le copie : marques de sens autour, trait d'union insécable avant les quatre derniers chiffres.
const COPIE_IPHONE = `${U(0x202a)}+1 (555) 010${U(0x2011)}4477${U(0x202c)}`;
const COMPLET = "+15550104477";

test("lecture : le numéro copié depuis un iPhone est lu en entier, jamais coupé", () => {
  assert.equal(normaliserTelephone(COPIE_IPHONE).numero, COMPLET);
  assert.deepEqual(verifierTelephoneClient(COPIE_IPHONE), { ok: true, valeur: COMPLET, raison: "" });
  // Les autres caractères qu'un téléphone glisse : tiret cadratin, moins, espace insécable et fine, chiffres pleine chasse, points.
  assert.equal(verifierTelephoneClient(`+41${U(0x00a0)}79${U(0x202f)}123${U(0x2013)}45${U(0x2212)}67`).valeur, "+41791234567");
  assert.equal(verifierTelephoneClient(`${U(0xff0b)}${U(0xff16)}${U(0xff16)} 81 234 5678`).valeur, "+66812345678");
  assert.equal(verifierTelephoneClient("+1 555.010.4477").valeur, COMPLET);
  assert.equal(verifierTelephoneClient("+41 (0)79 123 45 67").valeur, "+41791234567", "le (0) ne se compose pas depuis l'étranger");
  assert.equal(nettoyerTelephone(COPIE_IPHONE), "+1 (555) 010-4477");
});

test("lecture : un numéro coupé, en double ou de mauvaise longueur est refusé avec un message clair", () => {
  // Le cas réel, rendu fictif : sept chiffres seulement.
  assert.equal(verifierTelephoneClient("+1555010").ok, false);
  // Un caractère inconnu qui coupe le numéro : les chiffres d'après ne sont pas perdus en silence.
  const coupe = verifierTelephoneClient(`+1 (555) 010${U(0x2063)}x4477`);
  assert.equal(coupe.ok, false);
  assert.equal(coupe.raison, "illisible");
  assert.equal(verifierTelephoneClient("+41 79 123 45 67 / +33 6 12 34 56 78").raison, "illisible", "deux numéros dans le champ");
  assert.equal(verifierTelephoneClient("+1 555 010 447").raison, "longueur", "Amérique du Nord : 11 chiffres");
  assert.equal(verifierTelephoneClient("+33 6 12 34 56 7").raison, "longueur");
  assert.equal(verifierTelephoneClient("+41 79 123 45 678").raison, "longueur");
  assert.equal(verifierTelephoneClient("+66 81 234 567").raison, "longueur");
  assert.equal(verifierTelephoneClient("+49 30 1234567").ok, true, "un pays sans règle fixe garde 8 à 15 chiffres");
  assert.equal(verifierTelephoneClient("+49 30 1234 5678 9012 3").raison, "longueur");
  // Rien ne change pour un ancien numéro inchangé ni pour la règle de l'indicatif.
  assert.equal(verifierTelephoneClient("079 123 45 67", "079 123 45 67").ok, true);
  assert.equal(verifierTelephoneClient("079 123 45 67").raison, "sans_indicatif");
  assert.equal(verifierNouveauClient({ nom: "Exemple", telephone: "+1555010" }).champ, "telephone");
  for (const r of ["sans_indicatif", "longueur", "illisible", "trop_court", "vide"]) assert.ok(messageTelephone(r).length > 10, r);
});

test("voucher rapide de Taxi : le numéro collé depuis un iPhone est accepté et enregistré en caractères ordinaires", () => {
  assert.equal(telephoneValide(COPIE_IPHONE), true);
  const x = donneesVoucher({ ...valeursVides(), nom: "Client Exemple", telephone: COPIE_IPHONE, date: "2026-12-03", pickup: "Resort Exemple", heure: "09:00", trajet: "aller", dropoff: "Krabi Airport", prix: "1500" });
  assert.equal(x.telephone, "+1 (555) 010-4477");
});

// ---- Le numéro de la conversation WhatsApp ---------------------------------------------------------------------------------------
const ENT = "e-secret";
const conv = (o = {}) => ({ id: "w1", telephone: COMPLET, nom: "Abby", entite_id: null, client_id: null, type_contact: null, partenaire_id: null, reponses: "auto", dernier_message_le: "2026-11-25T16:25:00Z", ...o });

test("conversation liée : son numéro complet remplace un champ vide ou coupé, jamais un autre numéro tapé", () => {
  const base = { conversations: [], nomClient: "Abby Exemple", entites: [ENT], aujourdhui: "2026-11-26" };
  assert.deepEqual(telephoneDepuisWhatsApp({ ...base, saisi: "", liee: conv() }), { telephone: COMPLET, whatsappId: "w1", candidats: [] });
  assert.equal(telephoneDepuisWhatsApp({ ...base, saisi: "+1555010", liee: conv() }).telephone, COMPLET, "un début du numéro est complété");
  assert.equal(telephoneDepuisWhatsApp({ ...base, saisi: "+44 7700 900123", liee: conv() }).telephone, "+44 7700 900123", "un autre numéro est le choix de la personne");
  // Un partenaire, un apporteur ou un contact personnel ne donne jamais son numéro au client.
  for (const autre of [{ type_contact: "partenaire" }, { type_contact: "apporteur" }, { partenaire_id: "p1" }, { reponses: "jamais" }]) assert.equal(telephoneDepuisWhatsApp({ ...base, saisi: "", liee: conv(autre) }).telephone, "", JSON.stringify(autre));
});

test("sans conversation liée : les conversations au nom du client sont proposées, jamais reprises seules", () => {
  const conversations = [
    conv(),
    conv({ id: "w2", nom: "Abby", telephone: "+447700900123", client_id: "c-autre" }), // déjà reliée à une autre fiche
    conv({ id: "w3", nom: "Abby", telephone: "+447700900124", entite_id: "e-ztp" }), // rangée dans une autre entreprise
    conv({ id: "w4", nom: "Abby", telephone: "+447700900125", dernier_message_le: "2026-09-01T10:00:00Z" }), // trop ancienne
    conv({ id: "w5", nom: "Abby", telephone: "+447700900126", type_contact: "partenaire" }),
    conv({ id: "w6", nom: "Bob", telephone: "+447700900127" }),
    conv({ id: "w7", nom: "Abby Exemple", telephone: "+66812345678", entite_id: ENT, dernier_message_le: "2026-11-24T08:00:00Z" }),
  ];
  const r = telephoneDepuisWhatsApp({ saisi: "", liee: null, conversations, nomClient: "Abby Exemple", entites: [ENT], aujourdhui: "2026-11-26" });
  assert.equal(r.telephone, "", "rien n'est repris sans un geste");
  assert.equal(r.whatsappId, null);
  assert.deepEqual(r.candidats.map((c) => c.id), ["w1", "w7"], "la plus récente d'abord");
  // Un numéro déjà tapé, coupé : seule la conversation qui le complète reste proposée.
  assert.deepEqual(telephoneDepuisWhatsApp({ saisi: "+1555010", conversations, nomClient: "Abby Exemple", entites: [ENT], aujourdhui: "2026-11-26" }).candidats.map((c) => c.id), ["w1"]);
  assert.deepEqual(telephoneDepuisWhatsApp({ saisi: "", conversations, nomClient: "", entites: [ENT] }).candidats, [], "sans nom, rien");
});

test("textes anglais des nouveaux messages", () => {
  for (const k of ["Ce numéro n'a pas le bon nombre de chiffres pour son pays : vérifiez qu'il est complet.", "Numéro coupé ou en double : laissez un seul numéro, complet, avec son indicatif.", "Téléphone du client : {message}", "Numéro repris de la conversation WhatsApp « {nom} » : {telephone}", "Conversation WhatsApp « {nom} » : {telephone}", "Reprendre ce numéro"]) assert.ok(EN[k], k);
});

test("migration 129 : la base refuse aussi un numéro international coupé, contrôlée en CI", () => {
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-129-telephone-client.sql", import.meta.url), "utf8");
  assert.match(sql, /before insert or update of telephone on clients/);
  assert.match(sql, /current_user not in \('authenticated', 'anon'\)/, "les fonctions de la base (fusion, restauration) ne sont pas bloquées");
  assert.match(fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"), /verif-telephone-client/);
});

// ---- Chemins réels de la démo : carte « dossier » → fiche client ---------------------------------------------------------------
const dom = installerDom();
globalThis.location.search = "?demo";
const E = await import("../src/gestion/js/etat.mjs");
await E.init();
const { executer } = await import("../supabase/functions/agent/outils.js");
const { tempsSimule } = await import("../supabase/functions/agent/planifier.js");
const V = await import("../src/gestion/js/views/agent-valider.mjs");
const { ouvrirDemande } = await import("../src/gestion/js/views/demande.mjs");
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

const entite = (slug) => E.etat.brut.entites.find((e) => e.slug === slug);
const dans = (slug) => E.changerEntite(entite(slug).id, { naviguer: false });
const ctx = () => ({ charger: async (n) => E.etat.db[n] || [], reglages: E.reglages(), simule: tempsSimule });
const memo = () => ({ prix: new Set(), heures: new Set(), tapes: new Set([2500]), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes: ["2500 THB"] });
let n = 0;
async function carte(telephone) {
  const transfert = await E.inserer("prestations", { famille: "transfert", groupe: "Taxi", libelle: "Ao Nang", libelle_en: "Ao Nang", prix_vente: 2500, unite: "veh", actif: true });
  const { refDe } = await import("../supabase/functions/agent/outils.js");
  const nom = `Abby Exemple${++n}`;
  const r = await executer("proposer_dossier", { titre: "Dossier", client_nom: nom, client_telephone: telephone, hotel: "", langue: "en", adultes: 2, enfants: 0, bebes: 0, services: [{ texte: "Taxi to Ao Nang", ref: refDe("P", transfert.id), date: "2026-12-03", heure_pickup: "09:15", lieu_pickup: "Resort Exemple", de: "Resort Exemple", vers: "Ao Nang", adultes: 2, enfants: 0, prix: 2500 }], apporteur: "" }, ctx(), memo());
  assert.ok(r.carte, JSON.stringify(r.contenu || r));
  return { carte: { id: `carte-${n}`, ...r.carte, statut: "proposee" }, nom };
}
const clientDu = (dossier) => E.etat.brut.clients.find((c) => c.id === dossier.client_id);

for (const slug of ["excursions", "taxi"]) {
  test(`${slug} : carte validée d'un geste, téléphone vide, conversation liée → la fiche a le numéro complet`, async () => {
    dans(slug);
    const { carte: c } = await carte("");
    let recu = null;
    const r = await ouvrirDemande(null, V.preparation(c), { auto: true, titre: c.titre, surCree: (x) => (recu = x), whatsappLie: conv({ id: "wa-lie" }) });
    assert.equal(r.ok, true, r.motif);
    assert.equal(clientDu(r.dossier).telephone, COMPLET);
    assert.equal(recu.whatsappId, "wa-lie", "la conversation liée sera reliée au client et au dossier");
  });

  test(`${slug} : carte au numéro coupé (début de celui de la conversation liée) → complété`, async () => {
    dans(slug);
    const { carte: c } = await carte("+1555010");
    const r = await ouvrirDemande(null, V.preparation(c), { auto: true, titre: c.titre, surCree: () => {}, whatsappLie: conv({ id: "wa-lie" }) });
    assert.equal(r.ok, true, r.motif);
    assert.equal(clientDu(r.dossier).telephone, COMPLET);
  });

  test(`${slug} : carte au numéro copié depuis un iPhone, sans conversation → la fiche a le numéro entier`, async () => {
    dans(slug);
    const { carte: c } = await carte(COPIE_IPHONE);
    const r = await ouvrirDemande(null, V.preparation(c), { auto: true, titre: c.titre, surCree: () => {} });
    assert.equal(r.ok, true, r.motif);
    assert.equal(clientDu(r.dossier).telephone, COMPLET);
  });

  test(`${slug} : deux numéros dans la carte → refusé, rien n'est écrit`, async () => {
    dans(slug);
    const { carte: c } = await carte("+41 79 123 45 67 / +33 6 12 34 56 78");
    const avant = E.etat.brut.clients.length;
    const r = await ouvrirDemande(null, V.preparation(c), { auto: true, titre: c.titre, surCree: () => {} });
    assert.equal(r.ok, false);
    assert.equal(E.etat.brut.clients.length, avant, "aucune fiche créée");
  });
}

test("Vérifier avant (Secret) : la conversation au nom du client est proposée, « Reprendre ce numéro » la reprend et la reliera", async () => {
  dans("excursions");
  const { carte: c, nom } = await carte("");
  const prenom = nom.split(" ")[0];
  E.etat.brut.whatsapp_conversations = [...(E.etat.brut.whatsapp_conversations || []), conv({ id: "wa-nom", nom: `${prenom} Exemple${n}`, dernier_message_le: new Date().toISOString() })];
  let recu = null;
  ouvrirDemande(null, V.preparation(c), { titre: c.titre, surCree: (x) => (recu = x) });
  const fenetre = document.body.querySelector(".demande-wa") ? document.body : null;
  assert.ok(fenetre, "la proposition est affichée");
  const bouton = [...document.body.querySelectorAll(".demande-wa button")].find((b) => b.textContent === "Reprendre ce numéro");
  assert.ok(bouton, "un bouton pour reprendre le numéro");
  bouton.click();
  assert.equal(document.getElementById("dem-tel").value, COMPLET);
  const creer = [...document.body.querySelectorAll("button.principal")].find((b) => /^Créer le dossier/.test(b.textContent));
  creer.click();
  for (let i = 0; i < 50 && !recu; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(recu, "le dossier est créé");
  assert.equal(clientDu(recu.dossier).telephone, COMPLET);
  assert.equal(recu.whatsappId, "wa-nom");
});
