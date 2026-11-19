// tests/gestion-noms-marques.test.js : noms et marques à l'écran (migration 44, 18.11.2026).
// Pour chaque texte sorti du code : le rendu pour Anaïs (réglages remplis par la migration 44) est identique à celui d'avant, relevé
// dans fixtures/noms-marques-avant.json avant toute modification ; le rendu pour une entreprise fictive ne contient aucun nom d'Anaïs.
// fixtures/noms-marques-reglages.json est écrit par docs/gestion/verif-noms-marques.mjs depuis la base après la migration (même source).
const test = require("node:test");
const assert = require("node:assert/strict");
const AVANT = require("./fixtures/noms-marques-avant.json");
const ANAIS = require("./fixtures/noms-marques-reglages.json");

const js = (f) => import(`../src/gestion/js/${f}`);
const NOMS_ANAIS = /Anaïs|อานาอิส|Zwald|VIP TAXI|VIP Taxi|Secret Travel|Koh Lanta|TAT|Administratrice générale/;

const FAITS = { entreprise: "VIP Taxi Lanta", prenom: "Anna", devise: "THB", total: 3000, telephone_entreprise: "+66", services: [{ libelle: "Krabi Airport → Koh Lanta", date: "2026-12-01", heure: "10:00", prix: 1800 }, { libelle: "Koh Lanta → Phuket", date: "2026-12-05", heure: "", prix: 1200 }] };
// L'entreprise fictive : créée par le modèle « Transferts et taxi », avec un administrateur.
async function fictive() {
  const { reglagesModele } = await js("modeles-metier.mjs");
  const { completerReglages } = await js("defauts.mjs");
  const r = completerReglages(reglagesModele("transfers", { nom: "Andaman Rides" }));
  const donnees = { entiteId: "e1", profils: [{ user_id: "u1", nom: "Somchai Prasert", created_at: "2026-01-01" }], membres: [{ user_id: "u1", entite_id: "e1", role_id: "r1" }], roles: [{ id: "r1", entite_id: "e1", tous_droits: true, permissions: [] }] };
  return { r, donnees };
}
const reglagesAnais = async (cle) => (await js("defauts.mjs")).completerReglages(ANAIS[cle]);

test("écran « Nouveau voucher » de l'assistante : identique pour Anaïs, le prénom du responsable ailleurs", async () => {
  const { TH } = await js("voucher-rapide-calc.mjs");
  const { appliquerTextesThai, ECRANS_THAI } = await js("textes-thai.mjs");
  const { responsableDe, remplirResponsable } = await js("noms-calc.mjs");
  const resp = responsableDe(await reglagesAnais("taxi"));
  appliquerTextesThai(null, resp);
  for (const [cle, avant] of Object.entries(AVANT.voucherRapide)) assert.equal(TH[cle], avant, `thaï ${cle}`);
  const lignes = ECRANS_THAI.find((e) => e.id === "voucher").lignes;
  for (const [cle, avant] of Object.entries(AVANT.voucherRapideFr)) assert.equal(remplirResponsable(lignes.find((l) => l.cle === cle).fr, resp), avant, `français ${cle}`);

  const { r, donnees } = await fictive();
  const autre = responsableDe(r, donnees);
  assert.equal(autre.prenom, "Somchai", "par défaut : la première administratrice de l'entreprise");
  appliquerTextesThai(null, autre);
  for (const cle of Object.keys(AVANT.voucherRapide)) {
    assert.doesNotMatch(TH[cle], NOMS_ANAIS, cle);
    assert.match(TH[cle], /Somchai/, cle);
  }
  assert.equal(remplirResponsable(lignes.find((l) => l.cle === "ouvrir_chat").fr, autre), "Ouvrir la conversation de Somchai");
  // Personne de connu (l'assistante ne lit pas les profils) : le mot thaï pour la personne qui gère.
  appliquerTextesThai(null, responsableDe(r, {}));
  assert.equal(TH.creer, "สร้างและส่งให้ ผู้ดูแล");
  // Un texte thaï enregistré avant, avec le prénom écrit en toutes lettres, reste utilisé.
  appliquerTextesThai({ voucher: { creer: "สร้างแล้วส่งให้ Anaïs" } }, resp);
  assert.equal(TH.creer, "สร้างแล้วส่งให้ Anaïs");
  appliquerTextesThai(null, null);
});

test("écran de la fiduciaire : thaï et français identiques pour Anaïs, sans son nom ailleurs", async () => {
  const { TH } = await js("fiduciaire-textes.mjs");
  const { appliquerTextesThai } = await js("textes-thai.mjs");
  const { responsableDe } = await js("noms-calc.mjs");
  appliquerTextesThai(null, responsableDe(await reglagesAnais("secret")));
  for (const [cle, avant] of Object.entries(AVANT.fiduciaire)) assert.deepEqual(TH[cle], avant, cle);
  const { r, donnees } = await fictive();
  appliquerTextesThai(null, responsableDe(r, donnees));
  for (const cle of Object.keys(AVANT.fiduciaire)) {
    assert.doesNotMatch(TH[cle].th + TH[cle].fr, NOMS_ANAIS, cle);
    assert.match(TH[cle].fr, /prévenez Somchai/, cle);
  }
  appliquerTextesThai(null, null);
});

test("Booking confirmation : pied identique pour Taxi d'Anaïs, nom de l'entreprise ailleurs", async () => {
  const { textesVoucher } = await js("textes-voucher.mjs");
  const { avecMarque } = await js("noms-calc.mjs");
  const tA = textesVoucher(await reglagesAnais("taxi"));
  for (const [cle, avant] of Object.entries(AVANT.booking)) assert.equal(avecMarque(tA(cle), "VIP Taxi Lanta"), avant, cle);
  const tS = textesVoucher(await reglagesAnais("secret"));
  assert.equal(tS("licence"), AVANT.booking.licence, "vouchers de Secret : « TAT licence »");

  const { r } = await fictive();
  const t = textesVoucher(r);
  assert.equal(avecMarque(t("b_merci"), "Andaman Rides"), "Thank you for choosing Andaman Rides, we look forward to driving you to your destination!");
  const neutre = textesVoucher({});
  assert.equal(avecMarque(neutre("b_signature"), "Andaman Rides"), "ANDAMAN RIDES Team", "défaut : {ENTREPRISE} en capitales");
  assert.equal(neutre("b_lieu"), "", "défaut : pas de lieu");
  assert.equal(neutre("licence"), "Licence");
  for (const cle of Object.keys(AVANT.booking)) assert.doesNotMatch(avecMarque(neutre(cle), "Andaman Rides") + avecMarque(t(cle), "Andaman Rides"), NOMS_ANAIS, cle);
});

test("devis et factures : « Licence TAT » pour Anaïs, « Licence » ailleurs", async () => {
  const { libelleLicence } = await js("noms-calc.mjs");
  const e = (await reglagesAnais("ztp")).emetteur;
  assert.equal(`${libelleLicence(e, false)}: 12/3456`, "Licence TAT: 12/3456", "document en français, comme avant");
  assert.equal(`${libelleLicence(e, true)}: 12/3456`, "TAT licence: 12/3456", "document au client anglais, comme avant");
  const { r } = await fictive();
  assert.equal(libelleLicence(r.emetteur, false), "Licence");
  assert.equal(libelleLicence(r.emetteur, true), "Licence");
  assert.equal(libelleLicence({ licence_libelle: "Licence TAT" }, true), "Licence TAT", "sans libellé anglais : le français");
});

test("rôle d'administration : « Administratrice générale » chez Anaïs, libellé neutre ailleurs", async () => {
  const { libelleAdmin } = await js("noms-calc.mjs");
  assert.equal(libelleAdmin({ libelle_admin: "Administratrice générale" }), "Administratrice générale");
  assert.equal(libelleAdmin({ libelle_admin: null }), "Administration de l'organisation");
  assert.equal(libelleAdmin(null), "Administration de l'organisation");
});

test("assistant IA : prompts identiques pour Anaïs (ZTP, Secret, Taxi), sans son nom ni Koh Lanta ailleurs", async () => {
  const { promptLecture, promptRedaction, reglagesAssistant } = await import("../supabase/functions/assistant/calc.js");
  const S = reglagesAssistant(ANAIS.secret);
  const Z = reglagesAssistant(ANAIS.ztp);
  const T = reglagesAssistant(ANAIS.taxi);
  assert.deepEqual(promptLecture({ entreprise: "Secret Travel & Tour", catalogue: "P1 | Kayak", aujourdhui: "2026-11-18", message: "kayak tomorrow", lieu: S.lieu, responsable: S.responsable }), AVANT.lecture);
  assert.deepEqual(promptRedaction({ faits: { ...FAITS, entreprise: "Zwald Travel Planner" }, langue: "fr", consigne: "plus court", ...Z }), AVANT.redaction.ztp_fr);
  assert.deepEqual(promptRedaction({ faits: { ...FAITS, entreprise: "Secret Travel & Tour" }, langue: "en", ...S }), AVANT.redaction.secret_en);
  assert.deepEqual(promptRedaction({ faits: FAITS, langue: "en", ...T }), AVANT.redaction.taxi_en);
  assert.deepEqual(promptRedaction({ faits: FAITS, langue: "fr", ...T }), AVANT.redaction.taxi_fr);

  const { r } = await fictive();
  const F = reglagesAssistant(r);
  const lecture = promptLecture({ entreprise: "Andaman Rides", catalogue: "P1 | Kayak", aujourdhui: "2026-11-18", message: "kayak tomorrow", lieu: F.lieu, responsable: F.responsable });
  const faits = { ...FAITS, entreprise: "Andaman Rides", services: [{ libelle: "Airport transfer", date: "2026-12-01", heure: "", prix: 1800 }] };
  const tous = [lecture, promptRedaction({ faits, langue: "fr", consigne: "plus court", ...F }), promptRedaction({ faits, langue: "en", ...F })].map((p) => JSON.stringify(p)).join("\n");
  assert.doesNotMatch(tous, NOMS_ANAIS);
  assert.match(tous, /Have a nice day, Andaman Rides/);
  assert.match(tous, /Demande de l'équipe pour ce brouillon/);
  assert.match(tous, /Date du jour : 2026-11-18/);
  // Lieu et responsable réglés : insérés tels quels.
  const p = promptLecture({ entreprise: "x", catalogue: "", aujourdhui: "2026-11-18", message: "m", lieu: "Phuket (Thaïlande)", responsable: "Mook" });
  assert.match(p.system[0].text, /transferts à Phuket \(Thaïlande\), par WhatsApp/);
  assert.match(p.system[0].text, /ce que Mook doit vérifier/);
  assert.match(p.messages[0].content, /^Date du jour à Phuket : /);
});

test("assistant en démo : signature d'Anaïs identique, celle du responsable ailleurs", async () => {
  const { simulerRedaction } = await js("assistant-calc.mjs");
  assert.equal(simulerRedaction(FAITS, "fr", "Anaïs").message, AVANT.simulation.fr);
  assert.equal(simulerRedaction(FAITS, "en", "Anaïs").message, AVANT.simulation.en);
  assert.match(simulerRedaction({ ...FAITS, entreprise: "Andaman Rides" }, "en").message, /Have a lovely day, Andaman Rides$/);
});

test("messages types : défauts neutres, ceux d'Anaïs enregistrés chez elle mot pour mot", async () => {
  const { MESSAGES_TAXI, MESSAGES_DEFAUT } = await js("defauts.mjs");
  // Taxi : la marque devient {entreprise}, et la signature perd « by Mr. Brown » (Taxi d'Anaïs a ses messages enregistrés en base).
  const conf = AVANT.messagesTaxi.find((m) => m.id === "taxi-confirmation-en");
  assert.equal(MESSAGES_TAXI.find((m) => m.id === conf.id).corps.replaceAll("{entreprise}", "VIP TAXI LANTA"), conf.corps);
  const avis = AVANT.messagesTaxi.find((m) => m.id === "taxi-avis-en");
  assert.equal(MESSAGES_TAXI.find((m) => m.id === avis.id).corps.replace(/\{entreprise\}$/, "{entreprise} by Mr. Brown").replaceAll("{entreprise}", "VIP TAXI LANTA"), avis.corps);
  assert.ok(!MESSAGES_TAXI.concat(MESSAGES_DEFAUT).some((m) => NOMS_ANAIS.test(m.corps) || /Mr\. Brown/.test(m.corps)), "aucun nom d'Anaïs ni de partenaire dans les défauts");
  // ZTP n'avait aucun message enregistré : la migration enregistre ceux d'avant (« À bientôt à Koh Lanta »).
  assert.match(ANAIS.ztp.messages.find((m) => m.id === "avis-fr").corps, /À bientôt à Koh Lanta,\n\{entreprise\}$/);
  assert.match(ANAIS.ztp.messages.find((m) => m.id === "avis-en").corps, /See you again in Koh Lanta,\n\{entreprise\}$/);
  assert.match(MESSAGES_DEFAUT.find((m) => m.id === "avis-fr").corps, /À bientôt,\n\{entreprise\}$/);
});

test("Booking confirmation : logo et photo de Taxi d'Anaïs enregistrés, aucune image de marque par défaut", async () => {
  assert.equal(ANAIS.taxi.apparence.logo, "assets/logo-vip-taxi.webp");
  assert.equal(ANAIS.taxi.voucher.bandeau, "assets/taxi-bandeau.webp", "la photo d'avant, écrite par la migration");
  assert.equal(ANAIS.secret.voucher.bandeau, "assets/secret-bandeau.webp");
  const { readFileSync } = require("node:fs");
  for (const f of ["views/voucher-taxi.mjs", "views/voucher-secret.mjs"]) {
    const code = readFileSync(require("node:path").join(__dirname, "../src/gestion/js", f), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /logo-vip-taxi|taxi-bandeau|logo-secret|secret-bandeau/, f);
  }
});

test("documents envoyés : le libellé de licence est figé avec l'émetteur", async () => {
  const { figerReglages } = await js("documents-calc.mjs");
  const { completerReglages } = await js("defauts.mjs");
  const r = completerReglages({ emetteur: { nom: "Zwald", licence: "12/3456", licence_libelle: "Licence TAT", licence_libelle_en: "TAT licence" } });
  const f = figerReglages(r, {});
  assert.equal(f.emetteur.licence_libelle, "Licence TAT");
  assert.equal(f.emetteur.licence_libelle_en, "TAT licence");
});

test("personne responsable choisie dans l'équipe : son prénom, même sans lire les profils", async () => {
  const { responsableDe } = await js("noms-calc.mjs");
  const equipe = [{ user_id: "u2", nom: "Mook Srisuk", email: "mook@x.test" }, { user_id: "u3", nom: "", email: "lek@x.test" }];
  const admins = { entiteId: "e1", profils: [{ user_id: "u1", nom: "Bea", super_admin: true }], membres: [], roles: [] };
  assert.equal(responsableDe({ responsable: { user_id: "u2", prenom: "" } }, { ...admins, equipe }).prenom, "Mook", "le prénom vient de equipe_de");
  assert.equal(responsableDe({ responsable: { user_id: "u3" } }, { equipe }).prenom, "Lek", "nom vide : la partie de l'e-mail");
  assert.equal(responsableDe({ responsable: { user_id: "u9" } }, admins).prenom, "", "personne choisie inconnue : jamais une autre administratrice");
  assert.equal(responsableDe({ responsable: { user_id: "u2", prenom: "Nok" } }, { equipe }).prenom, "Nok", "un prénom saisi passe avant");
});

test("bandeau du site : la page du taxi porte le nom de l'entreprise qui publie", async () => {
  const { libelleLien, nomSection, ligneBandeau } = await js("bandeau-calc.mjs");
  assert.equal(libelleLien("/taxi/", { taxi: "VIP Taxi Lanta" }), "See VIP Taxi Lanta", "Anaïs : comme avant");
  assert.equal(libelleLien("/taxi/", { taxi: "Andaman Rides" }), "See Andaman Rides");
  assert.equal(nomSection("taxi", { taxi: "VIP Taxi Lanta" }), "VIP Taxi Lanta");
  assert.equal(nomSection("taxi"), "Taxi");
  const l = ligneBandeau({ modele: "new-trip", valeurs: { trip: "x" }, marques: ["taxi"], cible: "tout", sections: [], produits: [], lien: "page", lien_page: "/taxi/" }, "2026-11-18", { taxi: "VIP Taxi Lanta" });
  assert.equal(l.valeurs.lien_libelle, "See VIP Taxi Lanta");
});

test("élision et responsable par défaut", async () => {
  const { deNom, queNom, prenomDe, responsableDe, administrateursDe } = await js("noms-calc.mjs");
  assert.equal(deNom("Anaïs"), "d'Anaïs");
  assert.equal(deNom("Mook"), "de Mook");
  assert.equal(queNom("Anaïs"), "qu'Anaïs");
  assert.equal(prenomDe({ nom: "Anaïs Zwald" }), "Anaïs");
  assert.equal(prenomDe({ nom: "", email: "mook@exemple.test" }), "Mook");
  const donnees = {
    entiteId: "e1",
    profils: [{ user_id: "a", nom: "Ana", created_at: "2026-03-01" }, { user_id: "b", nom: "Bea", created_at: "2026-02-01", super_admin: true }, { user_id: "c", nom: "Cid", created_at: "2026-01-01" }],
    membres: [{ user_id: "a", entite_id: "e1", role_id: "admin" }, { user_id: "c", entite_id: "e1", role_id: "lecteur" }],
    roles: [{ id: "admin", entite_id: "e1", permissions: ["reglages.ecrire"] }, { id: "lecteur", entite_id: "e1", permissions: ["dossiers.lire"] }],
  };
  assert.deepEqual(administrateursDe(donnees).map((p) => p.user_id), ["b", "a"], "les administrateurs, du plus ancien au plus récent, sans le lecteur");
  assert.equal(responsableDe({}, donnees).prenom, "Bea");
  assert.equal(responsableDe({ responsable: { prenom: "Cid" } }, donnees).prenom, "Cid", "le choix des réglages passe avant");
  assert.equal(responsableDe({ responsable: { prenom: "Anaïs" } }).prenom_th, "Anaïs", "sans prénom thaï : le prénom tel quel");
});
