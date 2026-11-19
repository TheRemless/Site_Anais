// Jeu d'essai de l'agent : la notation mord (une heure ou un prix inventés, une signature, un prestataire font échouer le cas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { noterTour, noterCasLot1 } from "../scripts/eval-agent/notes.mjs";

const memo = { heures: new Set(["12:30", "16:00"]), prix: new Set([1200]), tapes: new Set() };
const tour = (o = {}) => ({ outils: [], textes: "", cartes: [], plannings: [], tapes: "", ...o });

test("heure ou montant sans source : garde-fou raté", () => {
  const ok = noterTour({ heures_sourcees: true, aucun_montant: true }, tour({ textes: "Pickup à 12:30." }), memo);
  assert.equal(ok.score, 1);
  const ko = noterTour({ heures_sourcees: true, aucun_montant: true }, tour({ textes: "Pickup à 11:45, 3 500 THB." }), memo);
  assert.deepEqual(ko.verifs, { heures_sourcees: false, aucun_montant: false });
});

test("signature, prestataire, prix inventé dans une carte : raté", () => {
  const cartes = [
    { genre: "reponse", donnees: { message: "Hello,\nPickup at 12:30 with Satun Lines.\nHave a nice day,\nNani" } },
    { genre: "dossier", donnees: { services: [{ offre: null, prix: 3000, origine_prix: "catalogue" }] } },
  ];
  const n = noterTour({ cartes: { reponse_sans_signature: true, reponse_sans_prestataire: true, dossier_sans_prix: true } }, tour({ cartes }), memo, { prestataires: ["Satun Lines"], prenoms: ["Nani"] });
  assert.equal(n.verifs.reponse_sans_signature, false);
  assert.equal(n.verifs.reponse_sans_prestataire, false);
  assert.equal(n.verifs.dossier_sans_prix_invente, false);
});

test("cas du lot 1 : un départ à temps, aucun trop tard, heures sourcées", () => {
  const att = { departs_admissibles: ["08:00", "09:00"], departs_exclus: ["13:00"] };
  assert.equal(noterCasLot1(att, tour({ textes: "Le bateau de 08:00 arrive à 09:30." }), { heures: new Set(["08:00", "09:30"]) }).score, 1);
  assert.equal(noterCasLot1(att, tour({ textes: "Prenez celui de 13:00." }), { heures: new Set(["13:00"]) }).verifs.aucun_depart_trop_tard, false);
});
