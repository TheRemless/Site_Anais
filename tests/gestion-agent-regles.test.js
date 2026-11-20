// Règles de réponse au client de l'agent (20.11.2026) : modifiables par entreprise, préremplies chez Secret et Taxi avec le paiement d'avance
// des bateaux demandé par Jérémy. Données fictives, aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGLE_BATEAUX, reglesReponse, lireReglages, proposerReglage, REGLAGES_PERMIS } from "../supabase/functions/agent/ameliorer.js";
import { REGLE_BATEAUX as REGLE_ECRAN, reglesReponse as reglesEcran } from "../src/gestion/js/defauts.mjs";
import { reglageApplique } from "../src/gestion/js/agent-calc.mjs";
import { consignes } from "../supabase/functions/agent/prompt.js";
import { paiementAvance } from "../scripts/eval-agent/notes.mjs";

const SECRET = { fonctionnement: "excursions", assistant_voix: { lieu: "Koh Lanta", fr: "", en: "" } };
const TAXI = { fonctionnement: "taxi" };
const ZTP = { fonctionnement: "sur_mesure" };

test("règle des bateaux : préremplie chez Secret et Taxi, absente chez ZTP, un texte enregistré l'emporte (vide compris)", () => {
  assert.equal(reglesReponse(SECRET), REGLE_BATEAUX);
  assert.equal(reglesReponse(TAXI), REGLE_BATEAUX);
  assert.equal(reglesReponse(ZTP), "");
  assert.equal(reglesReponse({ ...SECRET, assistant_voix: { regles_reponse: "" } }), "");
  assert.equal(reglesReponse({ ...ZTP, assistant_voix: { regles_reponse: " Toujours vouvoyer. " } }), "Toujours vouvoyer.");
  // Le même texte et la même règle côté fonction et côté écran.
  assert.equal(REGLE_ECRAN, REGLE_BATEAUX);
  for (const r of [SECRET, TAXI, ZTP, null, { ...SECRET, assistant_voix: { regles_reponse: "" } }]) assert.equal(reglesEcran(r), reglesReponse(r));
  // Le contenu demandé par Jérémy : confirmée après paiement, à l'avance, trois moyens, aucune coordonnée inventée.
  for (const m of [/confirmée qu'après paiement/, /à l'avance/, /Wise/, /virement international/, /cash à notre office/, /détails de paiement/, /ne les invente pas/]) assert.match(REGLE_BATEAUX, m);
  assert.doesNotMatch(REGLE_BATEAUX, /, et /);
});

test("consignes : les règles de l'entreprise entrent dans la réponse au client", () => {
  const s = consignes({ entreprise: "Secret Travel & Tour", reglages: SECRET, prenomEquipe: "Nani" });
  const section = s.slice(s.indexOf("Réponse au client (proposer_reponse)"));
  assert.match(section, /Règles de l'entreprise, à appliquer chaque fois/);
  assert.match(section, /  - Ferry ou speedboat : dis que la réservation n'est confirmée qu'après paiement/);
  assert.doesNotMatch(consignes({ entreprise: "Zwald Travel Planner", reglages: ZTP, prenomEquipe: "Anaïs" }), /Règles de l'entreprise/);
  const deux = consignes({ entreprise: "Secret", reglages: { ...SECRET, assistant_voix: { regles_reponse: "- Règle un\n\n• Règle deux" } } });
  assert.match(deux, /  - Règle un\n  - Règle deux/);
});

test("réglage sans code : lu, proposé et appliqué avec la valeur par défaut comme « avant »", async () => {
  assert.ok(REGLAGES_PERMIS["assistant_voix.regles_reponse"]);
  const lu = lireReglages({ sujet: "reglages" }, { reglages: SECRET }).resultat.reglages["assistant_voix.regles_reponse"];
  assert.equal(lu.valeur, REGLE_BATEAUX);
  const ctx = { reglages: SECRET, permissions: ["reglages.ecrire"] };
  const nouvelle = `${REGLE_BATEAUX}\nToujours rappeler le numéro de vol.`;
  const carte = await proposerReglage({ titre: "Règle", sujet: "reglage", champ: "assistant_voix.regles_reponse", cle: "", valeur: nouvelle, libelle: "", langue: "", raison: "Demande de Nani" }, ctx);
  assert.equal(carte.donnees.avant, REGLE_BATEAUX);
  const applique = reglageApplique(SECRET, carte.donnees);
  assert.equal(applique.ok, true);
  assert.equal(applique.valeur.assistant_voix.regles_reponse, nouvelle);
  assert.equal(applique.valeur.assistant_voix.lieu, "Koh Lanta");
  // Vider les règles est permis : plus aucune règle.
  const vide = await proposerReglage({ titre: "Sans règle", sujet: "reglage", champ: "assistant_voix.regles_reponse", cle: "", valeur: "", libelle: "", langue: "", raison: "" }, ctx);
  assert.equal(vide.donnees.valeur, "");
  assert.equal(reglesReponse(reglageApplique(SECRET, vide.donnees).valeur), "");
  // Seule une administratrice.
  assert.equal((await proposerReglage({ titre: "x", sujet: "reglage", champ: "assistant_voix.regles_reponse", cle: "", valeur: "x", libelle: "", langue: "", raison: "" }, { reglages: SECRET, permissions: [] })).erreur, "reserve_admin");
});

test("eval : la réponse ferry dit paiement d'avance et les trois moyens, sans coordonnées", () => {
  const bonne = "Hi Claire,\n\nThe speedboat from Koh Lanta to Koh Phi Phi leaves at 09:00, 1,500 THB per adult.\nThe booking is confirmed once payment is received, so payment is made in advance: by Wise, international bank transfer or cash at our office. We'll send you the payment details.";
  assert.ok(paiementAvance(bonne));
  assert.ok(!paiementAvance("Hi Claire,\n\nThe speedboat leaves at 09:00, 1,500 THB per adult. See you soon."));
  assert.ok(!paiementAvance(`${bonne}\nIBAN TH12 3456 7890 1234`));
  assert.ok(!paiementAvance("Please confirm your choice. You can pay by Wise, international bank transfer or cash at our office."));
  assert.ok(!paiementAvance(`${bonne}\nPay here: https://wise.com/pay/r/abc`));
});
