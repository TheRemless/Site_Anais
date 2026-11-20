// Crédit de l'assistant (plafond, alertes, crédit épuisé) et apprentissages de l'agent (corrections gardées, masquées, relues en cache).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { alertesBudget, debutMois, destinatairesBudget, estCreditEpuise, etatBudget, messageBudget, plafondRetenu, reprise } from "../supabase/functions/assistant/budget.js";
import { blocApprentissages, choisirAppris, parametres } from "../supabase/functions/agent/prompt.js";
import { anonymiser, apparier, correctionsDepuisCarte, dossierDeLaCarte } from "../src/gestion/js/agent-apprendre.mjs";
import { etatCredit } from "../src/gestion/js/assistant-suivi-calc.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const NOV = Date.parse("2026-11-20T05:00:00Z");

test("budget : début du mois et reprise à l'heure de Bangkok", () => {
  assert.equal(debutMois(NOV), "2026-10-31T17:00:00.000Z");
  // Le 30 novembre à 23 h à Bangkok, c'est encore novembre ; le 1er décembre à 1 h, c'est décembre.
  assert.equal(reprise(Date.parse("2026-11-30T16:00:00Z")), "2026-12-01");
  assert.equal(reprise(Date.parse("2026-11-30T18:00:00Z")), "2027-01-01");
  assert.equal(reprise(Date.parse("2026-12-15T00:00:00Z")), "2027-01-01");
});

test("budget : plafond lu en base, sinon le secret, sinon 50 $ ; seuil 80 % par défaut", () => {
  assert.deepEqual(plafondRetenu(null, undefined), { plafond: 50, seuil: 80 });
  assert.deepEqual(plafondRetenu(null, "40"), { plafond: 40, seuil: 80 });
  assert.deepEqual(plafondRetenu({ plafond_mois_usd: "75.00", seuil_alerte_pct: 90 }, "40"), { plafond: 75, seuil: 90 });
  assert.deepEqual(plafondRetenu({ plafond_mois_usd: 5000, seuil_alerte_pct: 20 }, ""), { plafond: 1000, seuil: 80 });
});

test("budget : alerte à 80 %, arrêt à 100 %, une clé par mois, niveau et plafond", () => {
  assert.deepEqual(alertesBudget({ cout: 39.99, plafond: 50, maintenant: NOV }), []);
  assert.deepEqual(alertesBudget({ cout: 40, plafond: 50, maintenant: NOV }), [{ cle: "2026-11:80:50", niveau: "seuil" }]);
  assert.deepEqual(alertesBudget({ cout: 50, plafond: 50, maintenant: NOV }), [{ cle: "2026-11:100:50", niveau: "plafond" }]);
  // Plafond relevé : une nouvelle alerte peut partir à 80 % du nouveau montant.
  assert.deepEqual(alertesBudget({ cout: 80, plafond: 100, maintenant: NOV }), [{ cle: "2026-11:80:100", niveau: "seuil" }]);
  assert.deepEqual(alertesBudget({ cout: 1, plafond: 50, creditEpuise: true, maintenant: NOV }), [{ cle: "credit:2026-11-20", niveau: "credit" }]);
  const e = etatBudget({ cout: 41.237, plafond: 50 });
  assert.equal(e.pct, 82);
  assert.equal(e.cout, 41.24);
  assert.equal(e.alerte, true);
  assert.equal(e.atteint, false);
});

test("budget : notification sans nom de client, en français ou en anglais", () => {
  const fr = messageBudget("seuil", { cout: 41.2, plafond: 50, pct: 82, maintenant: NOV });
  assert.match(fr.title, /82 % du plafond/);
  assert.match(fr.body, /41,20 \$ dépensés ce mois-ci sur 50,00 \$/);
  assert.match(fr.body, /jusqu'au 01\.12/);
  assert.ok(!/, et /.test(fr.body));
  const en = messageBudget("plafond", { cout: 50.1, plafond: 50, pct: 100, langue: "en", maintenant: NOV });
  assert.match(en.title, /cap reached/);
  assert.match(messageBudget("credit", { cout: 0, plafond: 50, pct: 0 }).body, /console Anthropic/);
});

test("budget : crédit épuisé reconnu (402, billing_error, ancien message), pas les autres erreurs", () => {
  assert.equal(estCreditEpuise({ status: 402, message: "402" }), true);
  assert.equal(estCreditEpuise({ status: 400, error: { type: "error", error: { type: "billing_error", message: "x" } } }), true);
  assert.equal(estCreditEpuise({ status: 400, message: "Your credit balance is too low to access the Anthropic API." }), true);
  assert.equal(estCreditEpuise({ status: 429, message: "rate limit" }), false);
  assert.equal(estCreditEpuise({ status: 400, message: "tools.3.input_schema: invalid" }), false);
  assert.equal(estCreditEpuise(null), false);
});

test("budget : l'alerte va aux administratrices générales et aux rôles qui règlent et lisent le journal", () => {
  const profils = [
    { user_id: "jeremy", actif: true, super_admin: true },
    { user_id: "anais", actif: true, super_admin: false },
    { user_id: "mook", actif: true, super_admin: false },
    { user_id: "ancienne", actif: false, super_admin: false },
  ];
  const roles = [{ id: "admin", tous_droits: true, permissions: [] }, { id: "editeur", permissions: ["dossiers.ecrire", "reglages.ecrire"] }, { id: "adm2", permissions: ["reglages.ecrire", "journal.voir"] }];
  const membres = [{ user_id: "anais", role_id: "admin" }, { user_id: "mook", role_id: "editeur" }, { user_id: "ancienne", role_id: "adm2" }];
  assert.deepEqual(destinatairesBudget({ profils, membres, roles }).sort(), ["anais", "jeremy"]);
});

test("budget : l'agent et l'assistant refusent au plafond, avec la dépense et la date de reprise", () => {
  const agent = lire("supabase/functions/agent/index.ts");
  assert.match(agent, /plafondRetenu\(budget\.error \? null : budget\.data/);
  assert.match(agent, /depense: acces\.depense, reprise: reprise\(\)/);
  assert.match(agent, /estCreditEpuise\(err\)\) statut = "credit_epuise"/);
  // L'alerte part en tâche de fond (EdgeRuntime.waitUntil) avant la fermeture du flux : la réponse n'attend pas, la fonction reste en vie.
  assert.match(agent, /EdgeRuntime\?\.waitUntil\(tache\)/);
  assert.match(agent, /alerterEnFond\([^)]*\);\s*await envoyer\(\{ t: "fin"/);
  assert.ok(!/await alerterBudget\(\{\}\)/.test(agent));
  const assistant = lire("supabase/functions/assistant/index.ts");
  assert.match(assistant, /erreur: "plafond_du_mois", plafond, depense/);
  assert.match(assistant, /estCreditEpuise\(err\)/);
  const rappels = lire("supabase/functions/rappels/index.ts");
  assert.match(rappels, /if \(type === "budget"\)/);
  assert.match(rappels, /from\("assistant_alertes"\)\.upsert\([\s\S]{0,120}ignoreDuplicates: true/);
});

test("écran : crédit du mois pour les administratrices", () => {
  assert.equal(etatCredit(null), null);
  const C = etatCredit({ cout_mois: "45.5", plafond: "50", seuil: 80, peut_regler: true });
  assert.equal(C.pct, 91);
  assert.equal(C.alerte, true);
  assert.equal(C.atteint, false);
  assert.equal(C.reste, 4.5);
  assert.equal(C.peutRegler, true);
  assert.equal(etatCredit({ cout_mois: 50, plafond: 50, seuil: 80 }).atteint, true);
});

// ---- Apprentissages ----------------------------------------------------------------------------------------------------------

const carteDossier = {
  id: "c1",
  genre: "dossier",
  donnees: {
    client: { nom: "Tom Martin", telephone: "+66 81 234 5678", hotel: "Jai Tiki" },
    services: [
      { libelle: "Jai Tiki → Krabi Nakharin", de: "Jai Tiki", vers: "Krabi Nakharin", date: "2026-11-22", heure_pickup: "12:55", lieu_pickup: "Jai Tiki", prix: 2500, offre: null },
      { libelle: "Krabi Nakharin → Krabi Airport", date: "2026-11-22", heure_pickup: "17:00", prix: 1200, offre: null },
    ],
  },
};

test("apprendre : pickup et prix corrigés sur un dossier créé, libellé de l'écran ignoré", () => {
  const reservations = [
    { libelle: "Private transfer Krabi Nakharin → Krabi Airport", date_service: "2026-11-22", heure_pickup: "17:00:00", montant_vente: 1200 },
    { libelle: "Private transfer Jai Tiki → Krabi Nakharin", date_service: "2026-11-22", heure_pickup: "12:40:00", montant_vente: 2200, lieu_pickup: "Jai Tiki" },
  ];
  const l = correctionsDepuisCarte(carteDossier, { reservations });
  assert.deepEqual(
    l.map((x) => [x.genre, x.avant, x.apres]),
    [
      ["pickup", "12:55", "12:40"],
      ["prix", "2500", "2200"],
    ]
  );
  assert.match(l[0].contexte, /Jai Tiki → Krabi Nakharin/);
  // L'écran de création pose lui-même le lieu (hôtel du client) et le prix d'une offre du catalogue : pas une correction.
  const avecOffre = { ...carteDossier, donnees: { ...carteDossier.donnees, services: [{ ...carteDossier.donnees.services[0], offre: { genre: "trajet", id: "t1" }, lieu_pickup: "Hôpital" }] } };
  assert.deepEqual(correctionsDepuisCarte(avecOffre, { reservations: [{ ...reservations[1], heure_pickup: "12:55", lieu_pickup: "Jai Tiki" }] }), []);
  // Rien de changé : rien à apprendre.
  assert.deepEqual(correctionsDepuisCarte(carteDossier, { reservations: [{ ...reservations[1], heure_pickup: "12:55", montant_vente: 2500 }, reservations[0]] }), []);
});

test("apprendre : service ajouté avec un libellé corrigé, modification d'heure corrigée", () => {
  const carte = { genre: "reservation", donnees: { dossier_id: "d1", service: { libelle: "Transfert", heure_pickup: "08:00", prix: null } } };
  const l = correctionsDepuisCarte(carte, { reservation: { libelle: "Transfert privé Ko Lanta → Krabi Airport", heure_pickup: "07:45", montant_vente: 1800 } });
  assert.deepEqual(l.map((x) => x.genre), ["pickup", "libelle"]);
  assert.equal(dossierDeLaCarte(carte), "d1");
  assert.equal(dossierDeLaCarte(carte, { dossierId: "d2" }), "d2");
  const modif = { genre: "modification", donnees: { reservation_id: "r1", dossier_id: "d1", libelle: "4 îles", champ: "heure_pickup", avant: "08:30", valeur: "08:15" } };
  assert.deepEqual(correctionsDepuisCarte(modif, { reservation: { heure_pickup: "08:00:00" } }).map((x) => [x.genre, x.avant, x.apres]), [["pickup", "08:15", "08:00"]]);
  assert.deepEqual(correctionsDepuisCarte(modif, { reservation: { heure_pickup: "08:15" } }), []);
});

test("apprendre : réponse retouchée gardée par ses phrases changées, client masqué", () => {
  const carte = { genre: "reponse", donnees: { langue: "en", message: "Hello Tom,\nYour pickup is at 12:55 at Jai Tiki.\nThe price is 2,500 THB." } };
  const l = correctionsDepuisCarte(carte, { message: "Hello Tom,\nYour driver will pick you up at 12:40 at Jai Tiki.\nThe price is 2,500 THB.\nCall +66 81 234 5678 or tom@mail.com." }, { noms: ["Tom", "Martin"] });
  assert.equal(l.length, 1);
  assert.equal(l[0].genre, "reponse");
  assert.equal(l[0].avant, "Your pickup is at 12:55 at Jai Tiki.");
  assert.match(l[0].apres, /driver will pick you up at 12:40/);
  assert.ok(!/Tom|tom@|234 5678/.test(JSON.stringify(l)), JSON.stringify(l));
  // Copiée telle quelle : rien.
  assert.deepEqual(correctionsDepuisCarte(carte, { message: carte.donnees.message }), []);
});

test("apprendre : jamais un net, une commission ni une banque", () => {
  const carte = { genre: "reponse", donnees: { message: "Le prix est 2 500 THB." } };
  assert.deepEqual(correctionsDepuisCarte(carte, { message: "Le prix est 2 500 THB, net 1 800 pour nous." }), []);
  assert.deepEqual(correctionsDepuisCarte(carte, { message: "Le prix est 2 500 THB. IBAN CH93 0076 2011 6238 5295 7." }), []);
  const modif = { genre: "reservation", donnees: { service: { libelle: "Bateau", prix: 1000 } } };
  assert.deepEqual(correctionsDepuisCarte(modif, { reservation: { libelle: "Bateau commission 20 %", montant_vente: 1000 } }), []);
});

test("apprendre : la marge d'un pickup s'apprend, la marge commerciale non", () => {
  const carte = { genre: "reponse", donnees: { message: "Pickup à 12:55." } };
  assert.equal(correctionsDepuisCarte(carte, { message: "Pickup à 12:40 pour garder une marge avec le ferry." }).length, 1);
  assert.deepEqual(correctionsDepuisCarte(carte, { message: "Pickup à 12:40, marge commerciale de 300." }), []);
});

test("apprendre : masquer noms, e-mail, téléphone et lien, garder dates et heures", () => {
  assert.equal(anonymiser("Bonjour Léa, appelez le 081 234 5678 le 20.11.2026 à 12:40", ["Léa Dupont"]), "Bonjour {client}, appelez le {téléphone} le 20.11.2026 à 12:40");
  assert.equal(anonymiser("Hello Sarah, see https://x.y/z or sarah@a.com"), "Hello {prénom}, see {lien} or {e-mail}");
  assert.equal(anonymiser("Pickup 2 500 THB"), "Pickup 2 500 THB");
});

test("apprendre : appariement par date puis par libellé", () => {
  const s = [{ libelle: "A vers B", date: "2026-11-22" }, { libelle: "Bateau 4 îles", date: "2026-11-23" }];
  const r = [{ id: 1, libelle: "4 islands boat", date_service: "2026-11-23" }, { id: 2, libelle: "Transfer A vers B", date_service: "2026-11-22" }];
  assert.deepEqual(apparier(s, r).map((x) => x && x.id), [2, 1]);
});

test("prompt : bloc des corrections choisi par le premier message, stable, en cache, sans net", () => {
  const lignes = [
    { id: "1", genre: "pickup", contexte: "Jai Tiki → Krabi Nakharin", avant: "12:55", apres: "12:40", cree_le: "2026-11-18T01:00:00Z" },
    { id: "2", genre: "prix", contexte: "Long tail 4 îles", avant: "2500", apres: "2200", cree_le: "2026-11-19T01:00:00Z" },
    { id: "3", genre: "reponse", contexte: "réponse en anglais", avant: "Your pickup is at 8.", apres: "Your driver comes at 8.", cree_le: "2026-11-19T02:00:00Z" },
    { id: "4", genre: "prix", contexte: "Bateau", avant: "1000", apres: "net 800", cree_le: "2026-11-19T03:00:00Z" },
  ];
  const b = blocApprentissages(lignes, { qui: "Nani", premierMessage: "Course samedi depuis Jai Tiki vers l'hôpital Krabi Nakharin" });
  assert.match(b, /Corrections récentes de Nani/);
  assert.match(b, /Heure de pickup \(Jai Tiki → Krabi Nakharin\) : tu avais proposé « 12:55 », Nani a mis « 12:40 »/);
  assert.ok(!/net 800/.test(b));
  assert.ok(!/, et /.test(b));
  assert.equal(b, blocApprentissages([...lignes].reverse(), { qui: "Nani", premierMessage: "Course samedi depuis Jai Tiki vers l'hôpital Krabi Nakharin" }));
  assert.equal(blocApprentissages([], {}), "");
  // Au plus quatre du même genre, dix en tout.
  const beaucoup = Array.from({ length: 20 }, (_, i) => ({ id: String(i), genre: "pickup", contexte: `c${i}`, avant: "10:00", apres: "09:45", cree_le: `2026-11-${String(10 + (i % 9)).padStart(2, "0")}T00:00:00Z` }));
  assert.equal(choisirAppris(beaucoup).length, 4);
  const p = parametres({ systeme: "S", appris: b, contexte: "C", messages: [] });
  assert.equal(p.system.length, 3);
  assert.deepEqual(p.system[1].cache_control, { type: "ephemeral" });
  assert.equal(p.system[2].text, "C");
  assert.equal(parametres({ systeme: "S", contexte: "C", messages: [] }).system.length, 2);
});

test("agent : les corrections lues avant l'ouverture de la conversation, dans l'entreprise", () => {
  const agent = lire("supabase/functions/agent/index.ts");
  assert.match(agent, /from\("agent_apprentissages"\)\.select\("id, genre, contexte, avant, apres, cree_le"\)\.eq\("entite_id", entiteId\)\.lte\("cree_le", conv!\.cree_le/);
  assert.match(agent, /tourner\(\{ anthropic, modele, systeme, appris, contexte/);
});

test("écran : la carte se valide après l'enregistrement seulement, la conversation se relie au dossier", () => {
  const v = lire("src/gestion/js/views/agent.mjs");
  assert.match(v, /async \(res\) => \{\s*ferme\(\);\s*if \(!res\) return;/);
  // Validation d'un geste ou « Vérifier avant » (20.11.2026) : toujours par noterReussite, avec l'id du dossier créé ou touché.
  assert.match(v, /apresValidation\(c, \{ dossierId: \(dossier && dossier\.id\) \|\| \(res && res\.dossier_id\) \|\| null/);
  assert.match(v, /apresValidation\(c, \{ enregistre: \{ message: texte \} \}\)/);
  assert.match(v, /if \(id && conv && !conv\.dossier_id\)/);
  const d = lire("src/gestion/js/views/demande.mjs");
  assert.match(d, /depuisItineraire && depuisItineraire\.surCree/);
  const f = lire("src/gestion/js/views/dossier.mjs");
  assert.match(f, /agentConversationsDuDossier\(d\.id\)/);
});

test("migration 54 : plafond, alertes et apprentissages", () => {
  const m = lire("docs/gestion/migration-54-agent-credit-apprentissages.sql");
  assert.match(m, /plafond_mois_usd numeric\(8, 2\) not null default 50/);
  assert.match(m, /seuil_alerte_pct smallint not null default 80/);
  assert.match(m, /if not est_super_admin\(\) then raise exception/);
  assert.match(m, /revoke all on assistant_alertes from public, anon, authenticated/);
  assert.match(m, /create policy "supprimer un apprentissage de l'agent"[\s\S]{0,200}reglages\.ecrire[\s\S]{0,60}journal\.voir/);
});
