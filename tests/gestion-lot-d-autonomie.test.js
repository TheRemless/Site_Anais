// tests/gestion-lot-d-autonomie.test.js : lot D de l'autonomie (17.11.2026), équipe, réglages et messages.
// Comptes (invitation, mot de passe), Administrateur calculé, prix de vente réservé (décision 3), archives au lieu de suppressions,
// historique des réglages, textes thaïs de l'écran de Mook, usages des messages, solde ZTP réglable.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const js = (f) => import(`../src/gestion/js/${f}`);
const source = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "gestion", "js", f), "utf8");
const invitationCalc = () => import("../supabase/functions/invitation/calc.js");
const ORIGINE = "https://gestion.zwaldtravelplanner.com";
const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;

// ---- Droits ------------------------------------------------------------------------------------------------------------------------
test("n° 4 : l'Administrateur a tous les droits calculés, même avec une liste enregistrée vide ou ancienne", async () => {
  const { permissionsDans, droitsDuRole } = await js("droits.mjs");
  const { TOUTES_PERMISSIONS, ROLES_SYSTEME } = await js("defauts.mjs");
  const admin = { id: "r1", entite_id: "e1", tous_droits: true, permissions: [] };
  const ctx = { profil: { user_id: "u1", actif: true, super_admin: false }, membres: [{ user_id: "u1", entite_id: "e1", role_id: "r1" }], roles: [admin] };
  assert.deepEqual(permissionsDans(ctx, "e1"), TOUTES_PERMISSIONS);
  assert.deepEqual(droitsDuRole({ permissions: ["clients.lire"] }), ["clients.lire"]);
  assert.equal(ROLES_SYSTEME.find((r) => r.nom === "Administrateur").tous_droits, true);
  assert.ok(!ROLES_SYSTEME.find((r) => r.nom === "Éditeur").tous_droits);
  // Un rôle « tous les droits » ne reçoit jamais le droit d'interface « écran simple ».
  assert.ok(!TOUTES_PERMISSIONS.includes("vouchers.seul"));
});

test("décision 3 : « partenaires.prix » existe, dépend de la modification, l'Éditeur l'a, le rôle de Mook en démo ne l'a pas", async () => {
  const { PERMISSIONS, DEPENDANCES, TOUTES_PERMISSIONS, ROLES_SYSTEME, donneesDemo } = await js("defauts.mjs");
  const { ajouterJours } = await js("calc.mjs");
  assert.ok(PERMISSIONS.some((p) => p.code === "partenaires.prix"));
  assert.ok(TOUTES_PERMISSIONS.includes("partenaires.prix") && TOUTES_PERMISSIONS.includes("clients.fusionner") && TOUTES_PERMISSIONS.includes("partenaires.supprimer"));
  assert.deepEqual(DEPENDANCES["partenaires.prix"], ["partenaires.lire", "partenaires.ecrire"]);
  assert.ok(ROLES_SYSTEME.find((r) => r.nom === "Éditeur").permissions.includes("partenaires.prix"));
  const demo = donneesDemo("2026-11-17", ajouterJours);
  const mook = demo.roles.find((r) => r.nom === "Éditeur + factures fiduciaire");
  assert.ok(mook.permissions.includes("partenaires.ecrire") && mook.permissions.includes("fiduciaire.preparer"));
  assert.ok(!mook.permissions.includes("partenaires.prix") && !mook.permissions.includes("partenaires.supprimer"));
  assert.ok(demo.roles.filter((r) => r.nom === "Administrateur").every((r) => r.tous_droits));
});

test("n° 40 : les droits retirés sont nommés, l'écran simple compris", async () => {
  const { droitsRetires } = await js("droits.mjs");
  const avant = ["clients.lire", "clients.ecrire", "dossiers.lire", "vouchers.seul"];
  assert.deepEqual(droitsRetires(avant, ["clients.lire", "dossiers.lire"]).map((p) => p.code), ["clients.ecrire", "vouchers.seul"]);
  assert.deepEqual(droitsRetires(avant, avant), []);
});

test("décision 3 : sans le droit, les formulaires figent les prix et la démo refuse comme la base", () => {
  assert.match(source("views/partenaires.mjs"), /const prixFige = !peut\("partenaires\.prix"\)/);
  assert.match(source("views/trajets.mjs"), /const prixFige = !peut\("partenaires\.prix"\)/);
  assert.match(source("store-local.mjs"), /garderPrix\(table, null, ligne\)/);
  assert.match(source("store-local.mjs"), /garderPrix\(table, ligne, \{ \.\.\.ligne, \.\.\.patch \}\)/);
});

test("décision 3 : la démo garde les prix de Mook, laisse le reste", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  globalThis.location = { origin: "http://localhost", pathname: "/gestion/", search: "?demo", hash: "" };
  try {
    const { creer } = await import("../src/gestion/js/store-local.mjs");
    const store = creer();
    const mook = store.utilisateursDemo().find((u) => /vouchers et factures/.test(u.nom));
    store.changerUtilisateurDemo(mook.id);
    const donnees = await store.charger();
    const secret = donnees.entites.find((e) => e.slug === "excursions");
    const p = donnees.prestations.find((x) => x.entite_id === secret.id && x.prix_vente != null);
    await assert.rejects(store.modifier("prestations", p.id, { prix_vente: Number(p.prix_vente) + 100 }), /prix de vente est réservé/);
    await store.modifier("prestations", p.id, { libelle: `${p.libelle} (B)`, prix_vente: p.prix_vente });
    await assert.rejects(store.inserer("prestations", { entite_id: secret.id, libelle: "Copie", prix_vente: 500 }), /prix de vente est réservé/);
    const sans = await store.inserer("prestations", { entite_id: secret.id, libelle: "Sans prix", prix_vente: null });
    assert.equal(sans.prix_vente, null);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.location;
  }
});

// ---- Comptes -----------------------------------------------------------------------------------------------------------------------
test("n° 2 : retour d'un lien d'invitation, de mot de passe ou expiré", async () => {
  const { lireRetourLien } = await js("compte-calc.mjs");
  assert.deepEqual(lireRetourLien("#access_token=x&refresh_token=y&type=recovery"), { type: "recovery", erreur: null });
  assert.deepEqual(lireRetourLien("#access_token=x&type=invite"), { type: "invite", erreur: null });
  assert.deepEqual(lireRetourLien("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"), { type: null, erreur: "expire" });
  assert.deepEqual(lireRetourLien("#error=server_error"), { type: null, erreur: "refuse" });
  assert.deepEqual(lireRetourLien("#/dossiers"), { type: null, erreur: null });
  assert.deepEqual(lireRetourLien("#access_token=x&type=magiclink"), { type: null, erreur: null });
});

test("n° 2 : contrôle du nouveau mot de passe", async () => {
  const { erreurMotDePasse } = await js("compte-calc.mjs");
  assert.equal(erreurMotDePasse("court", "court"), "Au moins 8 caractères.");
  assert.equal(erreurMotDePasse("assez long", "assez lonG"), "Les deux mots de passe ne sont pas identiques.");
  assert.equal(erreurMotDePasse(" espaces ", " espaces "), "Pas d'espace au début ni à la fin.");
  assert.equal(erreurMotDePasse("Lanta-2026!", "Lanta-2026!"), null);
});

test("n° 1 : message d'invitation dans la langue de la personne, accès choisis", async () => {
  const { messageLien, accesChoisis, messageInvitation } = await js("compte-calc.mjs");
  const fr = messageLien({ lien: "https://x/l", langue: "fr", type: "invite", nom: "Mook" });
  assert.match(fr, /^Bonjour Mook,/);
  assert.match(fr, /https:\/\/x\/l/);
  assert.match(messageLien({ lien: "https://x/l", langue: "en", type: "recovery" }), /^Hello,\n\nOpen this link to choose a new password/);
  assert.deepEqual(accesChoisis([{ entite_id: "a", role_id: "r" }, { entite_id: "b", role_id: "" }]), [{ entite_id: "a", role_id: "r" }]);
  assert.match(messageInvitation("deja_inscrit"), /déjà un compte/);
  assert.match(messageInvitation("code_inconnu"), /n'a pas abouti/);
});

test("fonction invitation : la demande est contrôlée avant tout", async () => {
  const { lireDemande, redirectionAutorisee } = await invitationCalc();
  const o = { origines: [ORIGINE] };
  assert.ok(redirectionAutorisee(`${ORIGINE}/`, [ORIGINE]));
  assert.ok(!redirectionAutorisee("https://exemple.com/gestion/", [ORIGINE]));
  assert.ok(!redirectionAutorisee(`https://user:pw@gestion.zwaldtravelplanner.com/`, [ORIGINE]));
  assert.deepEqual(lireDemande({ action: "inviter", email: "Mook@Example.com ", nom: " Mook ", langue: "en", acces: [{ entite_id: U(1), role_id: U(2) }], retour: `${ORIGINE}/` }, o), { ok: true, action: "inviter", email: "mook@example.com", nom: "Mook", langue: "en", acces: [{ entite_id: U(1), role_id: U(2) }], retour: `${ORIGINE}/` });
  assert.equal(lireDemande({ action: "inviter", email: "pas-une-adresse", retour: `${ORIGINE}/` }, o).erreur, "email_invalide");
  assert.equal(lireDemande({ action: "inviter", email: "a@b.ch", retour: "https://pirate.example/" }, o).erreur, "retour_refuse");
  assert.equal(lireDemande({ action: "inviter", email: "a@b.ch", retour: `${ORIGINE}/`, acces: [{ entite_id: U(1), role_id: U(2) }, { entite_id: U(1), role_id: U(3) }] }, o).erreur, "acces_invalide");
  assert.equal(lireDemande({ action: "inviter", email: "a@b.ch", langue: "th", retour: `${ORIGINE}/` }, o).langue, null);
  assert.equal(lireDemande({ action: "supprimer", user_id: "x" }, o).erreur, "personne_invalide");
  assert.deepEqual(lireDemande({ action: "supprimer", user_id: U(4) }, o), { ok: true, action: "supprimer", userId: U(4) });
  assert.equal(lireDemande({ action: "lien_mot_de_passe", user_id: U(4), retour: `${ORIGINE}/` }, o).action, "lien_mot_de_passe");
  assert.equal(lireDemande({ action: "effacer_tout" }, o).erreur, "action_inconnue");
  assert.equal(lireDemande(null, o).erreur, "demande_invalide");
});

test("fonction invitation : rôles cohérents, suppression bornée", async () => {
  const { accesCoherents, suppressionPermise, dejaInscrit } = await invitationCalc();
  const roles = [{ id: U(2), entite_id: U(1) }];
  assert.ok(accesCoherents([{ entite_id: U(1), role_id: U(2) }], roles));
  assert.ok(!accesCoherents([{ entite_id: U(3), role_id: U(2) }], roles));
  assert.equal(suppressionPermise({ appelant: U(1), cible: { user_id: U(1) }, superAdminsActifs: 2 }).erreur, "soi_meme");
  assert.equal(suppressionPermise({ appelant: U(1), cible: { user_id: U(2), super_admin: true, actif: true }, superAdminsActifs: 1 }).erreur, "derniere_administratrice");
  assert.ok(suppressionPermise({ appelant: U(1), cible: { user_id: U(2), super_admin: false, actif: true }, superAdminsActifs: 1 }).ok);
  assert.equal(suppressionPermise({ appelant: U(1), cible: null, superAdminsActifs: 1 }).erreur, "personne_inconnue");
  assert.ok(dejaInscrit("A user with this email address has already been registered"));
  assert.ok(!dejaInscrit("Database error"));
});

test("fonction invitation : la clé de service n'est utilisée qu'après le contrôle de l'administratrice générale", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", "invitation", "index.ts"), "utf8");
  assert.ok(src.indexOf('sb.rpc("est_super_admin")') > 0);
  // Chaque usage de la clé de service suit un contrôle : est_plateforme() pour créer un client (éditeur, migration 42), est_super_admin() sinon.
  const controle = (i) => Math.max(src.lastIndexOf('sb.rpc("est_super_admin")', i), src.lastIndexOf('sb.rpc("est_plateforme")', i));
  for (let i = src.indexOf("SUPABASE_SERVICE_ROLE_KEY"); i >= 0; i = src.indexOf("SUPABASE_SERVICE_ROLE_KEY", i + 1)) assert.ok(controle(i) > 0, `clé de service sans contrôle avant (position ${i})`);
  assert.ok(src.indexOf('sb.rpc("est_plateforme")') < src.indexOf('sb.rpc("creer_organisation"'));
  assert.match(fs.readFileSync(path.join(__dirname, "..", "supabase", "config.toml"), "utf8"), /\[functions\.invitation\]\nverify_jwt = true/);
  assert.doesNotMatch(source("store-supabase.mjs"), /SERVICE_ROLE/);
});

// ---- Réglages ----------------------------------------------------------------------------------------------------------------------
test("n° 39 : l'historique dit quels groupes de réglages diffèrent", async () => {
  const { groupesModifies, nomGroupe } = await js("reglages-calc.mjs");
  const a = { emetteur: { nom: "A", adresse: "x" }, devise: "THB", libelles: { total: "TOTAL" } };
  const b = { emetteur: { adresse: "x", nom: "B" }, devise: "THB", libelles: { total: "TOTAL" }, textes_thai: { voucher: { titre: "x" } } };
  assert.deepEqual(groupesModifies(a, b), ["emetteur", "textes_thai"]);
  assert.deepEqual(groupesModifies(a, structuredClone(a)), []);
  assert.deepEqual(groupesModifies({ x: { b: 1, a: 2 } }, { x: { a: 2, b: 1 } }), []);
  assert.equal(nomGroupe("paiement"), "Informations de paiement");
});

test("n° 37 : une variante s'archive en fin de liste, jamais la dernière active ; un document garde la sienne", async () => {
  const { archiverVariante, reactiverVariante, variantesProposees, variantesActives } = await js("reglages-calc.mjs");
  const v = [{ id: "qr" }, { id: "email" }];
  const archivees = archiverVariante(v, "qr");
  assert.deepEqual(archivees.map((x) => [x.id, !!x.archive]), [["email", false], ["qr", true]]);
  assert.equal(archiverVariante(archivees, "email"), null);
  assert.deepEqual(variantesProposees(archivees, "email").map((x) => x.id), ["email"]);
  assert.deepEqual(variantesProposees(archivees, "qr").map((x) => x.id), ["email", "qr"]);
  assert.equal(variantesActives(reactiverVariante(archivees, "qr")).length, 2);
  const { conditionsDocument } = await js("defauts.mjs");
  assert.equal(conditionsDocument({ textes: { variantes: [{ id: "email", corps: "E" }, { id: "qr", corps: "Q", archive: true }] } }, { variante: "qr" }, false).corps, "Q");
});

test("n° 37 : d'autres informations de paiement archivées restent imprimées pour qui les utilise", async () => {
  const { modesPaiement, modePaiement } = await js("defauts.mjs");
  const r = { paiement: { nom: "Principal", texte: "IBAN", autres: [{ id: "thb", nom: "Banque THB", texte: "SCB", archive: true }, { id: "wise", nom: "Wise", texte: "W" }] }, apparence: {} };
  assert.deepEqual(modesPaiement(r).map((m) => m.id), ["", "wise"]);
  assert.deepEqual(modesPaiement(r, { garder: "thb" }).map((m) => m.id), ["", "thb", "wise"]);
  assert.equal(modePaiement(r, "thb").texte, "SCB");
});

test("n° 75 : un moyen de paiement renommé garde son identifiant, un nouveau n'en prend jamais un existant", async () => {
  const { identifiantMoyen, moyensActifs, nomMoyen } = await js("reglages-calc.mjs");
  const { slug } = { slug: (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") };
  const moyens = [{ id: "especes", label: "Cash" }, { id: "wise", label: "Wise", archive: true }];
  assert.equal(identifiantMoyen("Wise", moyens, slug), "wise-2");
  assert.equal(identifiantMoyen("Carte bancaire", moyens, slug), "carte-bancaire");
  assert.deepEqual(moyensActifs(moyens).map((m) => m.id), ["especes"]);
  assert.deepEqual(moyensActifs(moyens, "wise").map((m) => m.id), ["especes", "wise"]);
  assert.equal(nomMoyen(moyens, "especes"), "Cash");
  assert.equal(nomMoyen(moyens, "inconnu"), "inconnu");
  // L'écran Réglages ne recalcule plus l'identifiant depuis le nom (ancien bug : renommer créait un nouveau code).
  assert.doesNotMatch(source("views/reglages.mjs"), /anciens\.get\(label\.toLowerCase\(\)\) \|\| slug\(label\)/);
});

test("section 2 : solde ZTP relevé selon le réglage, 30 jours par défaut", async () => {
  const { echeanceSolde, joursSolde, aFaire } = await js("calc.mjs");
  assert.equal(joursSolde({}), 30);
  assert.equal(joursSolde({ solde_jours: "" }), 30);
  assert.equal(joursSolde({ solde_jours: 45 }), 45);
  assert.equal(joursSolde({ solde_jours: -2 }), 30);
  assert.deepEqual(echeanceSolde({ date_depart: "2026-12-20" }), { date: "2026-11-20", source: "depart" });
  assert.deepEqual(echeanceSolde({ date_depart: "2026-12-20" }, { conditions: { solde_jours: 45 } }), { date: "2026-11-05", source: "depart" });
  const resume = { statut: "acompte", reste: 500, total: 1000, recu: 500, dossier: { date_depart: "2026-12-27" } };
  const regl = (j) => ({ conditions: { acompte_pct: 30, delai_jours: 10, relance_jours: 7, solde_jours: j } });
  assert.equal(aFaire([resume], "2026-11-17", regl(30)).filter((x) => x.type === "solde_proche").length, 0);
  assert.equal(aFaire([resume], "2026-11-17", regl(45)).filter((x) => x.type === "solde_proche").length, 1);
});

test("n° 72 : masquer Partenaires ne masque plus Réservations ni Messages", () => {
  const src = source("etat.mjs");
  assert.doesNotMatch(src, /if \(nom === "reservations" \|\| nom === "messages"\) return moduleActif\("partenaires"\)/);
});

test("n° 74 : « Texte devant le numéro » remplace « Début de la référence »", () => {
  const src = source("views/reglages.mjs");
  assert.match(src, /\["ref_facture", N_\("Texte devant le numéro \(facture\)"\)\]/);
  assert.doesNotMatch(src, /Début de la référence/);
});

test("n° 3 et 38 : l'onglet Compte quitte Réglages, la garde de sortie est posée", () => {
  const src = source("views/reglages.mjs");
  assert.doesNotMatch(src, /\["compte", tr\("Compte"\)\]/);
  assert.match(src, /etat\.garde = garde/);
  assert.match(source("app.mjs"), /async function peutQuitter\(\)/);
});

// ---- Textes thaïs de l'écran de Mook -------------------------------------------------------------------------------------------------
test("section 2 : textes thaïs modifiables, français en regard, variables gardées", async () => {
  const { ECRANS_THAI, ecransThaiPour, appliquerTextesThai, texteValide } = await js("textes-thai.mjs");
  const { TH } = await js("voucher-rapide-calc.mjs");
  const { TH: FID } = await js("fiduciaire-textes.mjs");
  assert.deepEqual(ecransThaiPour("taxi").map((e) => e.id), ["voucher", "fiduciaire"]);
  assert.deepEqual(ecransThaiPour("excursions").map((e) => e.id), ["fiduciaire"]);
  assert.deepEqual(ecransThaiPour("sur_mesure"), []);
  assert.ok(ECRANS_THAI.every((e) => e.lignes.every((l) => l.fr && l.depart)), "chaque texte a son français");
  const depart = TH.titre;
  appliquerTextesThai({ voucher: { titre: "ใหม่" }, fiduciaire: { cree: "ใบ {numero} แล้ว", creees: "ไม่มีตัวแปร" } });
  assert.equal(TH.titre, "ใหม่");
  assert.equal(FID.cree.th, "ใบ {numero} แล้ว");
  assert.notEqual(FID.creees.th, "ไม่มีตัวแปร", "un texte qui perd {n} n'est pas utilisé");
  appliquerTextesThai(null);
  assert.equal(TH.titre, depart);
  assert.equal(texteValide("{n} ใบ", "   "), null);
  assert.equal(texteValide("{n} ใบ", "ใบ {n}"), "ใบ {n}");
});

// ---- Messages ------------------------------------------------------------------------------------------------------------------------
test("n° 41 : un message désactivé n'est pas proposé et le modèle de départ ne revient pas", async () => {
  const { gabaritsPropose } = await js("operations-calc.mjs");
  const defauts = [{ id: "rappel-en", pour: "client", cle: "rappel", langue: "en", corps: "Défaut", titre: "R" }];
  const stockes = [{ id: "a", pour: "client", cle: "rappel", langue: "en", corps: "Le mien", titre: "R", actif: false }];
  assert.equal(gabaritsPropose(stockes, defauts, { pour: "client", langue: "en", cle: "rappel" }).choisi, null);
  assert.equal(gabaritsPropose([], defauts, { pour: "client", langue: "en", cle: "rappel" }).choisi.corps, "Défaut");
  assert.equal(gabaritsPropose([{ ...stockes[0], actif: true }], defauts, { pour: "client", langue: "en", cle: "rappel" }).choisi.corps, "Le mien");
});

test("n° 41 et 51 : usages en liste fermée, rien vers le prestataire sauf la commission de Taxi", () => {
  const src = source("views/messages.mjs");
  assert.match(src, /export const USAGES = \[/);
  const usages = [...src.slice(src.indexOf("export const USAGES"), src.indexOf("];", src.indexOf("export const USAGES"))).matchAll(/cle: "(\w+)", pour: "(\w+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(usages.filter(([, pour]) => pour === "partenaire").map(([c]) => c), ["commission", "commissions"]);
  assert.doesNotMatch(src, /Au partenaire : demande, relance, modification, annulation/);
  assert.match(src, /gabaritsRemis\(tous\.filter\(visible\), defautsEntreprise\(\)\.filter\(visible\)\)/);
  assert.doesNotMatch(src, /list: "m-cles"/);
});

// ---- Corrections de la revue (PR 214) -------------------------------------------------------------------------------------------------
test("revue : sans le droit, les prix repartent comme en base ; l'onglet thaï n'écrit rien sans saisie", () => {
  assert.match(source("views/partenaires.mjs"), /if \(prixFige && x\.id\) \{\n\s+valeurs\.prix_vente = x\.prix_vente \?\? null;/);
  assert.match(source("views/trajets.mjs"), /prixFige \? \{ prix_adulte: t\.prix_adulte \?\? null, prix_enfant: t\.prix_enfant \?\? null \}/);
  assert.match(source("views/reglages.mjs"), /champThai\.addEventListener\("input", \(\) => \(enregistrer\(\), maj\(\), marque\(\)\)\)/);
  assert.match(source("etat.mjs"), /\(!r\.erreur \|\| r\.user_id\)/);
});
