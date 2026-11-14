// Fiche client et vouchers de Secret (14.11.2026) : le numéro de chambre de la fiche client passe sur les vouchers quand le pickup est à son hôtel,
// et un billet de bateau saisi sans trajet de la base demande son départ, son arrivée et ses horaires.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hotelEtChambre, champsVoucherDe, CHAMPS_VOUCHER } from "../src/gestion/js/operations-calc.mjs";
import { chambreDeLAdresse, adresseAvecChambre } from "../src/gestion/js/client-calc.mjs";
import { champsCreation } from "../src/gestion/js/creation-voucher-calc.mjs";

test("la chambre de la fiche client passe au voucher quand le pickup est à son hôtel", () => {
  const client = { adresse: "Baiyok Hotel, Room 6\nKlong Dao" };
  assert.deepEqual(hotelEtChambre(client, { lieu_pickup: "Baiyok Hotel" }), { hotel: "Baiyok Hotel", chambre: "6" });
  assert.deepEqual(hotelEtChambre(client, { lieu_pickup: "baiyok hotel, klong dao" }), { hotel: "baiyok hotel, klong dao", chambre: "6" });
  assert.deepEqual(hotelEtChambre(client, {}), { hotel: "Baiyok Hotel", chambre: "6" });
  // Un autre lieu (aéroport, autre hôtel) n'hérite pas de la chambre.
  assert.deepEqual(hotelEtChambre(client, { lieu_pickup: "Krabi Airport" }), { hotel: "Krabi Airport", chambre: "" });
  // La chambre saisie dans le lieu de pickup reste prioritaire.
  assert.deepEqual(hotelEtChambre(client, { lieu_pickup: "Baiyok Hotel, Room 12" }), { hotel: "Baiyok Hotel", chambre: "12" });
});

test("fiche client : la chambre se lit et s'écrit en fin de première ligne de l'adresse", () => {
  assert.deepEqual(chambreDeLAdresse("Baiyok Hotel, Room 6\nKlong Dao"), { adresse: "Baiyok Hotel\nKlong Dao", chambre: "6" });
  assert.deepEqual(chambreDeLAdresse("Baiyok Hotel"), { adresse: "Baiyok Hotel", chambre: "" });
  assert.deepEqual(chambreDeLAdresse(""), { adresse: "", chambre: "" });
  assert.equal(adresseAvecChambre("Baiyok Hotel\nKlong Dao", "6"), "Baiyok Hotel, Room 6\nKlong Dao");
  assert.equal(adresseAvecChambre("Baiyok Hotel", "Room A12"), "Baiyok Hotel, Room A12");
  assert.equal(adresseAvecChambre("Baiyok Hotel", ""), "Baiyok Hotel");
  assert.equal(adresseAvecChambre("", "6"), "Room 6");
  // Aller-retour sans perte : ce qui est écrit se relit pareil.
  for (const [a, c] of [["Pimalai Resort\nKantiang Bay", "105"], ["Lanta Sand", "B4"]]) assert.deepEqual(chambreDeLAdresse(adresseAvecChambre(a, c)), { adresse: a, chambre: c });
});

test("billet sans trajet : départ, arrivée, horaires et bateau se demandent ; avec un trajet de la base, non", () => {
  assert.deepEqual(champsVoucherDe("billet").slice(0, 5), ["de", "vers", "depart", "arrivee", "bateau"]);
  assert.ok(!champsVoucherDe("billet", { trajet: true }).some((c) => ["de", "vers", "depart", "arrivee", "bateau"].includes(c)));
  assert.deepEqual(champsVoucherDe("bateau", { trajet: true }), CHAMPS_VOUCHER.bateau, "le bateau d'une excursion reste demandé");
  assert.ok(champsCreation({ type: "billet", trajet: false }).includes("vers"));
  assert.ok(!champsCreation({ type: "billet", trajet: true }).includes("vers"));
});
