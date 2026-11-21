// Contre-vérification de la PR 306 (commit 5bfa1b4) : texte long, séparateurs restants, levée par n'importe quel prix, mots du net,
// valeur d'un montant interne sans le droit de la voir. Cas repris des sondes du relecteur (sonde.mjs, sonde2.mjs, sonde3.mjs). Données
// fictives, aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { controlerReponse, executer, memoDepuis, montantsDuTexte, montantsTapes, refDe, TEXTE_CONTROLE_MAX, sha256 } from "../supabase/functions/agent/outils.js";
import { controleEnvoi, refusEnvoi } from "../supabase/functions/whatsapp-envoi/calc.js";
import { bloquantsReponse, resteBloque, montantsDuTexte as montantsEcran, MONTANT_MASQUE, sha256 as sha256Ecran, empreinteMontant } from "../src/gestion/js/agent-calc.mjs";
import { libelleAvertissement } from "../src/gestion/js/whatsapp-calc.mjs";
import { createHash } from "node:crypto";

const lire = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const P = "11111111-0000-4000-8000-000000000000";
const nets = [{ montant: 1000, prestation_id: P }];
const refs = new Set([refDe("P", P)]);
const ctx = { permissions: [], charger: async () => [], reglages: {} };
const ctxNets = { ...ctx, permissions: ["partenaires.lire", "partenaires.nets"] };

// ---- 1. Texte long -----------------------------------------------------------------------------------------------------------------
test("texte long : un net ou un nom placé après le 4000e caractère est contrôlé (sonde 3)", async () => {
  for (const n of [3990, 4001, 4090]) {
    const fin = "x".repeat(n - 19) + " Minivan 1,000 THB";
    assert.deepEqual(controleEnvoi(fin, { nets, refs }).a_retirer, ["montant_interne:1000"], String(n));
    assert.deepEqual(controleEnvoi("x".repeat(n) + " Lazy Day picks you up", { prestataires: ["Lazy Day"] }).a_retirer, ["nom_prestataire:Lazy Day"], String(n));
  }
  // Au-delà de la limite contrôlée : fermé.
  assert.deepEqual(controleEnvoi("x".repeat(TEXTE_CONTROLE_MAX + 1), {}).a_retirer, ["controle_impossible"]);
  // L'Assistant : une réponse de plus de 4000 caractères est refusée à l'entrée (aucune carte) ; jusqu'à 4000, tout est contrôlé.
  const memo = memoDepuis([]);
  memo.nets = nets;
  memo.refs = refs;
  const long = await executer("proposer_reponse", { titre: "t", langue: "en", message: "x".repeat(4100) + " 1,000 THB", destinataire: "client" }, ctxNets, memo);
  assert.equal(long.contenu.erreur, "entree_invalide");
  assert.equal(long.carte, undefined);
  const r = await executer("proposer_reponse", { titre: "t", langue: "en", message: "x".repeat(3985) + " 1,000 THB", destinataire: "client" }, ctxNets, memo);
  assert.ok(r.carte.avertissements.includes("montant_interne:1000"), r.carte.avertissements.join(" | "));
  assert.doesNotMatch(lire("supabase/functions/agent/outils.js"), /String\(message\)\.trim\(\)\.slice\(0, 4000\)/);
});

// ---- 2. Séparateurs ----------------------------------------------------------------------------------------------------------------
test("séparateurs : chiffres thaïs et pleine largeur, toute espace, ·, _, ˙, 1.2k ; un signe inconnu rend le montant illisible", () => {
  const cas = { "1 200 THB": 1200, "1 200 THB": 1200, "1·200 THB": 1200, "1_200 THB": 1200, "1˙200 THB": 1200, "๑,๒๐๐ บาท": 1200, "１，２００ THB": 1200, "1.2k THB": 1200, "1,2k": 1200, "1​200 THB": 1200, "1’250": 1250, "1.250 THB": 1250, "1 250 THB": 1250, "5k": 5000 };
  for (const [t, n] of Object.entries(cas)) {
    assert.deepEqual(montantsDuTexte(t), [n], t);
    assert.deepEqual(montantsEcran(t), [n], t);
    assert.deepEqual([...montantsTapes([t])], [n], t);
  }
  // A2 et A3.
  assert.deepEqual(controlerReponse("The tour is 1 200 THB", { internes: new Set([1200]) }).avertissements, ["montant_interne:1200"]);
  assert.deepEqual(controlerReponse("The tour is 1.2k THB", { internes: new Set([1200]) }).avertissements, ["montant_interne:1200"]);
  // Deux groupes de chiffres séparés par un signe inconnu : illisible, la copie reste bloquée tant qu'il est là.
  for (const t of ["1•200 THB", "1¤200 THB", "1⁂200 THB"]) {
    const a = controlerReponse(t, {}).avertissements;
    assert.ok(a.includes("montant_illisible:0"), `${t} : ${a.join(" | ")}`);
    assert.deepEqual(resteBloque(t, bloquantsReponse(a)), ["0"], t);
  }
  // Ni une date, ni une heure, ni « 5km », ni des zéros seuls.
  assert.deepEqual(montantsDuTexte("20.11.2026 at 9:30, 5km, room 000"), []);
});

// ---- 3. Levée par un prix d'un service de la demande -------------------------------------------------------------------------------
test("levée : seul le prix de vente d'un service de la demande en cours lève un net, pas n'importe quel prix (sonde H)", async () => {
  const essai = async (prep) => {
    const memo = memoDepuis([]);
    memo.internes.add(2000);
    prep(memo);
    return (await executer("proposer_reponse", { titre: "t", langue: "en", message: "Total 2,000 THB", destinataire: "client" }, ctxNets, memo)).carte.avertissements;
  };
  // Un prix rendu sans service (un total de dossier) : ne lève rien.
  assert.ok((await essai((m) => m.prix.add(2000))).includes("montant_interne:2000"));
  // Le prix d'un service rendu avec sa référence, ou d'une réservation du dossier relié : lève.
  assert.ok(!(await essai((m) => (m.prix.add(2000), m.prixServices.add(2000)))).some((a) => a.startsWith("montant_interne")));
  assert.ok(!(await essai((m) => (m.ventesDossier = [2000]))).some((a) => a.startsWith("montant_interne")));
  // Les prix des services se lisent dans les résultats d'outils (ligne avec « ref ») et dans l'historique.
  const hist = [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "chercher_catalogue", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ lignes: [{ ref: refDe("P", P), prix_vente: 2000 }], total_vente: 3000 }) }] }];
  const m = memoDepuis(hist);
  assert.deepEqual([...m.prixServices], [2000]);
  assert.ok(m.prix.has(3000) && !m.prixServices.has(3000));
  assert.match(lire("supabase/functions/agent/index.ts"), /memo\.ventesDossier = \[\.\.\.relie\.ventes, \.\.\.\(relieWa\?\.ventes \?\? \[\]\)\];/);
  assert.match(lire("supabase/functions/whatsapp/reponse.ts"), /memo\.ventesDossier = relie\.ventes;/);
});

// ---- 5. Valeur d'un montant interne sans le droit ----------------------------------------------------------------------------------
test("sans partenaires.nets : montant_interne sans sa valeur, avec une empreinte salée ; l'écran bloque sans afficher le chiffre", async () => {
  // L'empreinte : le même SHA-256 des deux côtés.
  for (const x of ["", "abc", "a1b2c3d4e5f60718:1000", "é".repeat(80)]) {
    assert.equal(sha256(x), createHash("sha256").update(x).digest("hex"));
    assert.equal(sha256Ecran(x), sha256(x));
  }
  const a = controlerReponse("Tour 1,000 THB, pickup included.", { internes: new Set([1000]), masquerNets: true, sel: "a1b2c3d4e5f60718" }).avertissements;
  assert.deepEqual(a, [`montant_interne:#a1b2c3d4e5f60718:${empreinteMontant("a1b2c3d4e5f60718", 1000)}`]);
  assert.doesNotMatch(JSON.stringify(a), /1000|1,000/);
  const b = bloquantsReponse(a);
  assert.deepEqual(resteBloque("Tour 1,000 THB, pickup included.", b), [MONTANT_MASQUE]);
  assert.deepEqual(resteBloque("Tour 1’000 THB", b), [MONTANT_MASQUE], "réécrit autrement : toujours bloqué");
  assert.deepEqual(resteBloque("Tour 1,500 THB", b), []);
  assert.doesNotMatch(libelleAvertissement(a[0]).texte, /\{valeur\}|#/);
  // Un sel par réponse : deux réponses n'ont pas la même empreinte.
  const deux = controlerReponse("Tour 1,000 THB", { internes: new Set([1000]), masquerNets: true }).avertissements[0];
  const trois = controlerReponse("Tour 1,000 THB", { internes: new Set([1000]), masquerNets: true }).avertissements[0];
  assert.notEqual(deux, trois);
  // Sonde G : dans l'Assistant sans le droit ; avec le droit, rien ne change.
  const memo = memoDepuis([]);
  memo.internes.add(1000);
  const sans = (await executer("proposer_reponse", { titre: "t", langue: "en", message: "Tour 1,000 THB", destinataire: "client" }, ctx, memo)).carte.avertissements;
  assert.ok(sans.some((x) => x.startsWith("montant_interne:#")) && !JSON.stringify(sans).includes("1000"));
  const avec = (await executer("proposer_reponse", { titre: "t", langue: "en", message: "Tour 1,000 THB", destinataire: "client" }, ctxNets, memo)).carte.avertissements;
  assert.ok(avec.includes("montant_interne:1000"));
  // Sonde F5 : à l'envoi, 422 sans la valeur.
  const e = controleEnvoi("Minivan 1,000 THB", { nets, refs, masquer: true });
  assert.ok(e.a_retirer[0].startsWith("montant_interne:#"));
  const refus = refusEnvoi(e, []);
  assert.equal(refus.status, 422);
  assert.doesNotMatch(JSON.stringify(refus.corps), /1000/);
  assert.deepEqual(resteBloque("Minivan 1,000 THB", bloquantsReponse(refus.corps.a_retirer)), [MONTANT_MASQUE]);
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  assert.match(vue, /x === MONTANT_MASQUE \? tr\("un montant égal à un net interne"\) : x/);
});

test("services: forgé par la carte, quelle que soit la casse, est retiré (sonde E)", async () => {
  const { avertissementsSurs, servicesDeProposition } = await import("../supabase/functions/whatsapp/proposer.js");
  assert.deepEqual(avertissementsSurs(["services:P-aaaaaaaa", "Services:P-bbbbbbbb", " SERVICES:P-cccccccc", "montant_non_source:5"]), ["montant_non_source:5"]);
  assert.deepEqual([...servicesDeProposition(["Services:P-bbbbbbbb", "services:P-AAAAAAAA,P-cccccccc"])], ["P-cccccccc"]);
});
