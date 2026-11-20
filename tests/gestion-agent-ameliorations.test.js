// Faire évoluer Gestion depuis l'Assistant (20.11.2026) : cartes « reglage » et « amelioration » de l'agent, contrôle du texte public de
// l'issue, suivi GitHub, application des réglages dans l'écran, garde-fous du workflow et de la migration. Données fictives, aucun réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OUTILS, executer, memoDepuis, entreeValide, OUTILS_PROPOSITION } from "../supabase/functions/agent/outils.js";
import { aUnePieceJointe, nomsVus, lireReglages } from "../supabase/functions/agent/ameliorer.js";
import { consignes } from "../supabase/functions/agent/prompt.js";
import { controlerTexte, controlerDemande, corpsIssue, titreIssue, nettoyerTexte, texteDemande, lireSuivi, changement, notification, AUTEUR_ACTION } from "../supabase/functions/ameliorations/calc.js";
import { reglageApplique, prestationModifiee, listeAmeliorations } from "../src/gestion/js/agent-calc.mjs";

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const ENT = "11111111-1111-4111-8111-111111111111";
const P1 = "a1000000-0000-4000-8000-000000000001";
const ADMIN = ["partenaires.lire", "dossiers.ecrire", "reglages.ecrire", "catalogue.ecrire"];
const reglages = {
  fonctionnement: "excursions",
  agent_ia: true,
  assistant_voix: { lieu: "Koh Lanta", fr: "", en: "Warm and short." },
  messages: [
    { id: "reponse-en", pour: "client", titre: "Reply to a request", langue: "en", corps: "Hello {client}," },
    { id: "taxi-partenaire-en", pour: "partenaire", titre: "New transfer", langue: "en", corps: "Hello {contact}" },
  ],
  conditions: { delai_jours: 10, relance_jours: 7, solde_jours: 30, acompte_pct: 0 },
  modules: { partenaires: null, reservations: true, messages: null, catalogue: null },
  voucher: { merci: "Thank you!", merci_transfert: "", note_transfert: "Driver waits." },
  paiement: { texte: "IBAN CH00 0000", nom: "PostFinance" },
};
const ctxDe = (extra = {}) => ({
  permissions: ADMIN,
  reglages,
  entreprise: "Secret Travel & Tour",
  historique: [],
  charger: async (t) => ({ prestations: [{ id: P1, libelle: "4 îles en long-tail", libelle_en: "4 Islands", prix_vente: 1500, actif: true }], partenaires: [{ id: "p", nom: "Blue Ocean Speedboat", actif: true }] })[t] || [],
  ...extra,
});
const memo = (textes = []) => memoDepuis(textes.map((t) => ({ role: "user", content: [{ type: "text", text: t }] })));

// ---- Outils --------------------------------------------------------------------------------------------------------------------

test("les trois outils sont déclarés avec des schémas fermés ; les propositions sont des cartes", () => {
  for (const n of ["lire_reglages", "proposer_reglage", "proposer_amelioration"]) {
    const o = OUTILS.find((x) => x.name === n);
    assert.ok(o, n);
    assert.equal(o.input_schema.additionalProperties, false, n);
  }
  assert.ok(OUTILS_PROPOSITION.includes("proposer_reglage") && OUTILS_PROPOSITION.includes("proposer_amelioration"));
  assert.ok(entreeValide("lire_reglages", {}));
  assert.ok(!entreeValide("proposer_reglage", { sujet: "droits" }));
});

test("lire_reglages : voix, textes types pour le client, réglages permis ; jamais le paiement", async () => {
  const r = lireReglages({ sujet: "tout" }, { reglages });
  const s = JSON.stringify(r);
  assert.ok(!s.includes("IBAN") && !s.includes("PostFinance"));
  assert.deepEqual(r.resultat.messages.map((m) => m.id), ["reponse-en"]);
  assert.equal(r.resultat.voix.fr, "(voix par défaut)");
  assert.equal(r.resultat.reglages["modules.reservations"].valeur, "oui");
  assert.equal(r.resultat.reglages["conditions.delai_jours"].valeur, 10);
  // Les libellés des réglages ne passent pas pour des noms de clients.
  assert.deepEqual(nomsVus([{ role: "user", content: [{ type: "tool_result", content: JSON.stringify(r.resultat) }] }]), []);
});

test("proposer_reglage : voix, texte type, réglage et catalogue donnent une carte avec l'avant et l'après", async () => {
  const voix = await executer("proposer_reglage", { titre: "Voix", sujet: "voix", champ: "en", cle: "", valeur: "Warm, short, no emoji.", libelle: "", langue: "", raison: "Nani veut moins d'emoji." }, ctxDe(), memo());
  assert.equal(voix.carte.genre, "reglage");
  assert.deepEqual([voix.carte.donnees.avant, voix.carte.donnees.valeur], ["Warm and short.", "Warm, short, no emoji."]);

  const msg = await executer("proposer_reglage", { titre: "Message", sujet: "message", champ: "corps", cle: "reponse-en", valeur: "Hi {client},", libelle: "", langue: "", raison: "" }, ctxDe(), memo());
  assert.equal(msg.carte.donnees.avant, "Hello {client},");

  const delai = await executer("proposer_reglage", { titre: "Délai", sujet: "reglage", champ: "conditions.delai_jours", cle: "", valeur: "14", libelle: "", langue: "", raison: "" }, ctxDe(), memo());
  assert.deepEqual([delai.carte.donnees.avant, delai.carte.donnees.valeur], ["10", "14"]);

  const ecran = await executer("proposer_reglage", { titre: "Écran", sujet: "reglage", champ: "modules.partenaires", cle: "", valeur: "non", libelle: "", langue: "", raison: "" }, ctxDe(), memo());
  assert.deepEqual([ecran.carte.donnees.avant, ecran.carte.donnees.valeur], ["auto", "non"]);

  // Un prix vient seulement d'un montant tapé par la personne.
  const sansPrix = await executer("proposer_reglage", { titre: "Prix", sujet: "catalogue", champ: "prix_vente", cle: "P-a1000000", valeur: "1800", libelle: "", langue: "", raison: "" }, ctxDe(), memo(["mets les 4 îles à 1700"]));
  assert.equal(sansPrix.contenu.erreur, "prix_non_tape");
  const prix = await executer("proposer_reglage", { titre: "Prix", sujet: "catalogue", champ: "prix_vente", cle: "P-a1000000", valeur: "1 800", libelle: "", langue: "", raison: "" }, ctxDe(), memo(["mets les 4 îles à 1800"]));
  assert.equal(prix.carte.donnees.cible_id, P1);
  assert.deepEqual([prix.carte.donnees.avant, prix.carte.donnees.valeur], ["1500", "1800"]);
});

test("proposer_reglage refuse : sans droit, réglage hors liste, rien ne change, français chez Secret", async () => {
  const lecteur = ctxDe({ permissions: ["partenaires.lire", "dossiers.ecrire"] });
  assert.equal((await executer("proposer_reglage", { titre: "x", sujet: "voix", champ: "fr", cle: "", valeur: "Bonjour", libelle: "", langue: "", raison: "" }, lecteur, memo())).contenu.erreur, "reserve_admin");
  assert.equal((await executer("proposer_reglage", { titre: "x", sujet: "catalogue", champ: "libelle", cle: "P-a1000000", valeur: "4 îles", libelle: "", langue: "", raison: "" }, lecteur, memo())).contenu.erreur, "reserve_admin");
  assert.equal((await executer("proposer_reglage", { titre: "x", sujet: "reglage", champ: "paiement.texte", cle: "", valeur: "IBAN", libelle: "", langue: "", raison: "" }, ctxDe(), memo())).contenu.erreur, "champ_inconnu");
  assert.equal((await executer("proposer_reglage", { titre: "x", sujet: "reglage", champ: "conditions.delai_jours", cle: "", valeur: "10", libelle: "", langue: "", raison: "" }, ctxDe(), memo())).contenu.erreur, "rien_ne_change");
  assert.equal((await executer("proposer_reglage", { titre: "x", sujet: "message", champ: "nouveau", cle: "", valeur: "Bonjour", libelle: "Accueil", langue: "fr", raison: "" }, ctxDe(), memo())).contenu.erreur, "anglais_seulement");
  const nouveau = await executer("proposer_reglage", { titre: "x", sujet: "message", champ: "nouveau", cle: "", valeur: "Hello {client}, see you!", libelle: "Welcome", langue: "en", raison: "" }, ctxDe(), memo());
  assert.equal(nouveau.carte.donnees.champ, "nouveau");
});

const demande = { titre: "Champ numéro de vol dans un transfert", besoin: "Noter le numéro de vol du client pour les transferts vers l'aéroport.", ecran: "fiche d'une réservation", changements: ["Un champ « Numéro de vol » sous l'heure de pickup", "Le numéro apparaît sur le voucher"], portee: "cette_entreprise" };

test("proposer_amelioration : carte avec un texte assemblé, pour l'entreprise, sans données", async () => {
  const r = await executer("proposer_amelioration", demande, ctxDe(), memo());
  assert.equal(r.carte.genre, "amelioration");
  assert.match(r.carte.donnees.texte, /^Besoin : Noter le numéro de vol/);
  assert.match(r.carte.donnees.texte, /- Le numéro apparaît sur le voucher/);
  assert.match(r.carte.donnees.texte, /Concerne : Secret Travel & Tour seulement \(mode excursions et transferts\)/);
  assert.ok(r.contenu.carte_affichee);
});

test("proposer_amelioration refuse : pas administratrice, pièce jointe, client ou prestataire cité, montant", async () => {
  assert.equal((await executer("proposer_amelioration", demande, ctxDe({ permissions: ["partenaires.lire", "dossiers.ecrire"] }), memo())).contenu.erreur, "reserve_admin");
  const avecPhoto = [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "x" } }, { type: "text", text: "regarde" }] }];
  assert.ok(aUnePieceJointe(avecPhoto));
  assert.equal((await executer("proposer_amelioration", demande, ctxDe({ historique: avecPhoto }), memo())).contenu.erreur, "piece_jointe");
  assert.ok(aUnePieceJointe([{ role: "user", content: [{ type: "fichier", id: "f", nom: "brochure.pdf" }] }]), "la forme gardée en base compte aussi");
  assert.equal((await executer("proposer_amelioration", demande, ctxDe({ fichiers: [{ id: "f", nom: "brochure.pdf" }] }), memo())).contenu.erreur, "piece_jointe");
  const vu = [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: JSON.stringify({ clients: [{ client: "C-1", nom: "Marie Dupontel" }] }) }] }];
  const client = await executer("proposer_amelioration", { ...demande, besoin: "Comme pour Dupontel, noter le vol." }, ctxDe({ historique: vu }), memo());
  assert.equal(client.contenu.erreur, "texte_refuse");
  assert.match(client.contenu.conseil, /nom_propre/);
  assert.equal((await executer("proposer_amelioration", { ...demande, besoin: "Afficher le nom Blue Ocean Speedboat sur le voucher." }, ctxDe(), memo())).contenu.erreur, "texte_refuse");
  assert.equal((await executer("proposer_amelioration", { ...demande, changements: ["Remise de 500 THB automatique"] }, ctxDe(), memo())).contenu.erreur, "texte_refuse");
  assert.equal((await executer("proposer_amelioration", { ...demande, changements: [] }, ctxDe(), memo())).contenu.erreur, "demande_incomplete");
});

test("consignes : les deux niveaux, le texte public et la décision humaine", () => {
  const c = consignes({ entreprise: "Secret Travel & Tour", reglages, lieu: "Koh Lanta", prenomEquipe: "Nani" });
  assert.match(c, /Faire évoluer l'outil/);
  assert.match(c, /sans code/);
  assert.match(c, /proposer_amelioration/);
  assert.match(c, /public sur GitHub/);
  assert.match(c, /Seule une administratrice/);
  assert.ok(!/,\s+et\b/.test(c.split("Faire évoluer l'outil")[1].split("Réponse au client")[0]), "pas de virgule avant « et »");
});

// ---- Texte public et issue -----------------------------------------------------------------------------------------------------

test("controlerTexte : refuse e-mail, téléphone, lien, montant, accès, nom ; signale l'argent interne ; laisse passer une vraie demande", () => {
  const ok = controlerTexte("Ajouter un champ numéro de vol dans la fiche d'un transfert, visible sur le voucher. 3 jours avant le départ.");
  assert.deepEqual([ok.ok, ok.erreurs], [true, []]);
  const cas = { "écrire à marie@example.com": "courriel", "appeler le +66 81 234 5678": "telephone", "voir https://exemple.org": "lien", "prix 1 500": "montant", "à 900 baht": "montant", "le mot de passe du compte": "acces", "l'IBAN sur la facture": "acces" };
  for (const [t, e] of Object.entries(cas)) assert.ok(controlerTexte(t).erreurs.includes(e), t);
  assert.ok(controlerTexte("pour Somchai Jaidee", { noms: ["Somchai"] }).erreurs.includes("nom_propre"));
  // Une date et une année ne sont pas des montants ni des téléphones.
  assert.ok(controlerTexte("Depuis le 2026-11-20 et en 2027").ok);
  const net = controlerTexte("Ajouter une colonne commission dans les statistiques");
  assert.ok(net.ok);
  assert.deepEqual(net.avertissements, ["mot_interne:commission"]);
});

test("titre et corps de l'issue : repère, sans crochets ni mention ni commentaire HTML", () => {
  assert.equal(titreIssue("[preview] Champ @vol"), "Gestion : preview Champ vol");
  assert.equal(titreIssue("   "), "");
  const t = nettoyerTexte("Bonjour @claude\n\n\n\n<!-- gestion-pr url=x -->fin  ");
  assert.ok(!t.includes("<!--") && !t.includes("@claude") && !t.includes("\n\n\n"));
  const corps = corpsIssue({ id: "abc", texte: "Besoin : x", entreprise: "Secret Travel & Tour", fonctionnement: "excursions", date: "2026-11-20" });
  assert.ok(corps.startsWith("<!-- gestion-amelioration id=abc -->"));
  assert.match(corps, /## Demande\n\nBesoin : x/);
  assert.match(corps, /ne fusionne rien, ne déploie rien et n'applique aucune migration/);
  assert.match(texteDemande({ besoin: "b", portee: "toutes" }), /toutes les entreprises/);
});

test("controlerDemande : administratrice, carte à elle, plafond du jour, texte public", () => {
  const carte = { genre: "amelioration", statut: "proposee", entite_id: ENT };
  const base = { permissions: ADMIN, carte, entiteId: ENT, titre: "Champ vol", texte: "Besoin : noter le vol." };
  assert.ok(controlerDemande(base).ok);
  assert.equal(controlerDemande({ ...base, permissions: ["dossiers.ecrire"] }).erreur, "reserve_admin");
  assert.equal(controlerDemande({ ...base, carte: { ...carte, entite_id: "autre" } }).erreur, "carte_introuvable");
  assert.equal(controlerDemande({ ...base, carte: { ...carte, genre: "reponse" } }).erreur, "carte_introuvable");
  assert.equal(controlerDemande({ ...base, carte: { ...carte, statut: "validee" } }).erreur, "deja_decidee");
  assert.equal(controlerDemande({ ...base, demandesDuJour: 3 }).erreur, "limite_du_jour");
  assert.equal(controlerDemande({ ...base, titre: "[]" }).erreur, "titre_vide");
  const r = controlerDemande({ ...base, texte: "Appeler le 081 234 5678" });
  assert.deepEqual([r.erreur, r.motifs], ["texte_refuse", ["telephone", "montant"]]);
});

// ---- Suivi GitHub ----------------------------------------------------------------------------------------------------------------

const PR = "https://github.com/TheRemless/Site_Anais/pull/301";
const bot = (body) => ({ user: { login: AUTEUR_ACTION }, body });

test("lireSuivi : PR prête, échec, en ligne, refusée ; un commentaire d'inconnu ou un lien étranger ne compte pas", () => {
  const ouverte = { state: "open" };
  assert.equal(lireSuivi(ouverte, []).statut, "envoyee");
  const prete = lireSuivi(ouverte, [bot(`PR prête : ${PR}<!-- gestion-pr url=${PR} sensible=1 tests=ok -->`)]);
  assert.deepEqual([prete.statut, prete.pr_url, prete.sensible, prete.tests], ["pr_prete", PR, true, "ok"]);
  assert.equal(lireSuivi(ouverte, [{ user: { login: "inconnu" }, body: `<!-- gestion-pr url=${PR} sensible=0 tests=ok -->` }]).statut, "envoyee");
  assert.equal(lireSuivi(ouverte, [bot("<!-- gestion-pr url=https://evil.example/pull/1 sensible=0 tests=ok -->")]).statut, "envoyee");
  assert.equal(lireSuivi(ouverte, [bot("<!-- gestion-echec -->")]).statut, "echec");
  // Un échec puis une PR (relance réussie) : la PR l'emporte.
  assert.equal(lireSuivi(ouverte, [bot("<!-- gestion-echec -->"), bot(`<!-- gestion-pr url=${PR} sensible=0 tests=ok -->`)]).statut, "pr_prete");
  assert.equal(lireSuivi({ state: "closed", state_reason: "completed" }, []).statut, "en_ligne");
  assert.equal(lireSuivi({ state: "closed", state_reason: "not_planned" }, []).statut, "refusee");
});

test("changement et notification : Jérémy pour relire, l'autrice pour le sort final, sans nom de client", () => {
  const ligne = { id: "x", titre: "Champ vol", statut: "envoyee", pr_url: null, sensible: false };
  const ch = changement(ligne, { statut: "pr_prete", pr_url: PR, sensible: true, tests: "ok" });
  assert.deepEqual(ch, { patch: { statut: "pr_prete", pr_url: PR, sensible: true }, prevenir: "administration" });
  assert.equal(changement({ ...ligne, statut: "pr_prete", pr_url: PR, sensible: true }, { statut: "pr_prete", pr_url: PR, sensible: true }), null);
  assert.equal(changement({ ...ligne, statut: "pr_prete", pr_url: PR }, { statut: "en_ligne", pr_url: PR, sensible: false }).prevenir, "autrice");
  const n = notification("pr_prete", { ...ligne, pr_url: PR, sensible: true }, { tests: "echec" });
  assert.deepEqual([n.titre, n.url, n.tag], ["Amélioration prête à relire", PR, "amelioration-x"]);
  assert.match(n.corps, /à relire de près · tests en échec/);
  assert.equal(notification("refusee", ligne, { langue: "en" }).titre, "Improvement not kept");
  assert.equal(notification("envoyee", ligne), null);
});

test("sw.js : un lien GitHub s'ouvre à part, aucune autre adresse extérieure", () => {
  const sw = lire("src/gestion/sw.js");
  assert.match(sw, /url\.startsWith\("https:\/\/github\.com\/"\)/);
  assert.match(sw, /if \(externe && !url\.startsWith\("https:\/\/github\.com\/"\)\) url = racine;/);
});

// ---- Écran -----------------------------------------------------------------------------------------------------------------------

test("reglageApplique : voix, texte type, réglage ; refuse une carte périmée", () => {
  const v = reglageApplique(reglages, { sujet: "voix", champ: "en", avant: "Warm and short.", valeur: "Short." });
  assert.equal(v.valeur.assistant_voix.en, "Short.");
  assert.equal(reglages.assistant_voix.en, "Warm and short.", "les réglages d'origine ne bougent pas");
  assert.equal(reglageApplique(reglages, { sujet: "voix", champ: "en", avant: "Autre", valeur: "Short." }).erreur, "change");
  const m = reglageApplique(reglages, { sujet: "message", champ: "corps", cle: "reponse-en", avant: "Hello {client},", valeur: "Hi {client}," });
  assert.equal(m.valeur.messages[0].corps, "Hi {client},");
  const n = reglageApplique(reglages, { sujet: "message", champ: "nouveau", libelle: "Welcome", langue: "en", valeur: "Hello!" }, { nouvelId: "perso-1" });
  assert.deepEqual(n.valeur.messages.at(-1), { id: "perso-1", pour: "client", titre: "Welcome", langue: "en", corps: "Hello!" });
  assert.equal(reglageApplique(reglages, { sujet: "reglage", champ: "conditions.delai_jours", avant: "10", valeur: "14" }).valeur.conditions.delai_jours, 14);
  assert.equal(reglageApplique(reglages, { sujet: "reglage", champ: "modules.partenaires", avant: "auto", valeur: "non" }).valeur.modules.partenaires, false);
  assert.equal(reglageApplique(reglages, { sujet: "reglage", champ: "modules.reservations", avant: "auto", valeur: "non" }).erreur, "change");
  assert.equal(reglageApplique(reglages, { sujet: "reglage", champ: "paiement.texte", avant: "", valeur: "x" }).erreur, "inconnu");
  assert.equal(reglageApplique(reglages, { sujet: "reglage", champ: "conditions.acompte_pct", avant: "0", valeur: "150" }).erreur, "inconnu");
});

test("prestationModifiee et listeAmeliorations", () => {
  const p = { id: P1, libelle: "4 îles", prix_vente: 1500, actif: true };
  assert.deepEqual(prestationModifiee(p, { champ: "prix_vente", avant: "1500", valeur: "1800" }).patch, { prix_vente: 1800 });
  assert.deepEqual(prestationModifiee(p, { champ: "actif", avant: "oui", valeur: "non" }).patch, { actif: false });
  assert.equal(prestationModifiee(p, { champ: "prix_vente", avant: "1400", valeur: "1800" }).erreur, "change");
  assert.equal(prestationModifiee(null, {}).erreur, "introuvable");
  const l = listeAmeliorations([
    { id: "a", statut: "en_ligne", cree_le: "2026-11-21" },
    { id: "b", statut: "envoyee", cree_le: "2026-11-19" },
    { id: "c", statut: "pr_prete", cree_le: "2026-11-20" },
  ]);
  assert.deepEqual(l.map((x) => x.id), ["c", "b", "a"]);
});

test("les règles de l'amélioration existent en deux exemplaires identiques (fonctions et écran)", () => {
  assert.equal(lire("supabase/functions/ameliorations/calc.js"), lire("src/gestion/js/ameliorations-calc.mjs"));
});

// ---- Migration et workflow -----------------------------------------------------------------------------------------------------

test("migration 55 : table lisible par les administratrices seulement, écrite par les fonctions ; genres de cartes", () => {
  const sql = lire("docs/gestion/migration-55-ameliorations.sql");
  assert.match(sql, /alter table ameliorations enable row level security/);
  assert.match(sql, /revoke all on ameliorations from anon, authenticated/);
  assert.match(sql, /grant select on ameliorations to authenticated;/);
  assert.ok(!/grant[^;]*(insert|update|delete)[^;]*on ameliorations/.test(sql));
  assert.match(sql, /a_permission\(entite_id, 'reglages\.ecrire'\)/);
  assert.match(sql, /'reglage', 'amelioration'/);
  assert.match(sql, /create unique index if not exists ameliorations_carte on ameliorations \(carte_id\)/);
});

test("workflow : Claude en lecture seule, plafonds, aucun secret sauf la clé Anthropic, jamais de fusion", () => {
  const y = lire(".github/workflows/amelioration-gestion.yml");
  assert.match(y, /^permissions: \{\}$/m);
  assert.match(y, /anthropics\/claude-code-action@v1\.0\.\d+/);
  const impl = y.split("  implementer:")[1].split("  ouvrir-pr:")[0];
  assert.match(impl, /contents: read/);
  assert.ok(!/: write/.test(impl), "le job de Claude n'a aucun droit d'écriture");
  assert.match(impl, /persist-credentials: false/);
  for (const a of ["--max-turns 60", "--max-budget-usd 5", "--permission-mode acceptEdits", "Bash(git push:*)", "Bash(gh:*)", "Bash(supabase:*)", "Bash(npx:*)"]) assert.ok(impl.includes(a), a);
  assert.match(impl, /timeout-minutes: 40/);
  const secrets = [...y.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(secrets)], ["ANTHROPIC_API_KEY"]);
  assert.ok(!/gh pr merge|--admin|supabase db|functions deploy|netlify deploy/.test(y));
  assert.match(y, /gh pr create[^\n]*--draft/);
  assert.match(y, /a-relire-de-pres/);
  assert.match(y, /\^\(\\\.github\/\|/, "les fichiers interdits sont contrôlés");
  const pr = y.split("  ouvrir-pr:")[1].split("  echec:")[0];
  assert.ok(!/npm (ci|test|run)/.test(pr), "le job qui pousse n'exécute aucun code du dépôt");
  assert.match(pr, /core\.hooksPath \/dev\/null/);
  assert.ok(!/cut -c/.test(pr), "aucune coupe en octets du titre");
  assert.match(impl, /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"/);
  assert.match(impl, /npm test >> /, "build et tests dans le job en lecture seule");
  // L'Action ne part que pour une issue du propriétaire, avec le label et le repère de la fonction.
  assert.match(y, /github\.event\.issue\.user\.login == github\.repository_owner/);
  assert.match(y, /"<!-- gestion-amelioration id="\*\)/);
});
