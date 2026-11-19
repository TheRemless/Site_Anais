import { test } from "node:test";
import assert from "node:assert/strict";
import { reservationsDepuisDocument, rattachementsDepuisDocument, rolesDuService, attenduDepuisFacture, ecartReservation, contenuAvecService } from "../src/gestion/js/operations-calc.mjs";

// Jérémy, 19.11.2026 : « quand je veux mettre un passenger pour les ATV, ça me fait une autre prestation et du coup ça fait 2 vouchers ».
const base = { kind: "ligne", partenaire_id: "atv", date_service: "2026-11-21", intro: "" };
const conducteur = { ...base, id: "l1", prestation_id: "p-driver", titre: "P3: ATV 1h + Kayak 1h Thung Yee Peng, driver", libelle: "P3: ATV 1h + Kayak 1h Thung Yee Peng, driver, 1 passenger, 21 November 2026", unite: 2800, qte: 1, net: null };
const passager = { ...base, id: "l2", prestation_id: "p-passenger", titre: "P3: ATV 1h + Kayak 1h Thung Yee Peng, passenger", libelle: "P3: ATV 1h + Kayak 1h Thung Yee Peng, passenger, 1 passenger, 21 November 2026", unite: 2000, qte: 1, net: null };
const passagerEnfant = { ...base, id: "l3", prestation_id: "p-passenger-ch", titre: "P3: ATV 1h + Kayak 1h Thung Yee Peng, passenger child (4-12)", libelle: "P3: ATV 1h + Kayak 1h Thung Yee Peng, passenger child (4-12), 1 child, 21 November 2026", unite: 1700, qte: 1, net: null };

test("ATV : conducteur et passager font une seule réservation, donc un seul voucher", () => {
  const res = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: [conducteur, passager, passagerEnfant] } }, { uid: () => "R" });
  assert.equal(res.length, 1);
  const r = res[0].reservation;
  assert.equal(r.libelle, "P3: ATV 1h + Kayak 1h Thung Yee Peng");
  assert.deepEqual(r.personnes, { adultes: 2, enfants: 1, bebes: 0 }, "le passager enfant compte comme enfant");
  assert.equal(r.montant_vente, 6500);
  assert.deepEqual(r.details.lignes_ids, ["l1", "l2", "l3"]);
  assert.equal(r.details.roles, "1 driver + 2 passengers");
  assert.equal(r.prestation_id, "p-driver", "le tarif de la réservation est celui du conducteur");
});

test("ATV : deux dates ou deux partenaires restent deux réservations", () => {
  const res = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: [conducteur, { ...passager, date_service: "2026-11-22" }] } }, { uid: () => "R" });
  assert.equal(res.length, 2);
});

test("ATV : la réservation créée n'est pas un écart avec sa facture", () => {
  const doc = { contenu: { lignes: [conducteur, passager] } };
  const [{ reservation }] = reservationsDepuisDocument({ dossier_id: "D", ...doc }, { uid: () => "R" });
  assert.equal(ecartReservation(reservation, doc), null);
});

test("ATV : un passager ajouté après coup rejoint la réservation du conducteur", () => {
  const [{ reservation }] = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: [conducteur] } }, { uid: () => "R" });
  const existante = { ...reservation, id: "R", statut: "confirme" };
  const doc = { dossier_id: "D", contenu: { lignes: [conducteur, passager] } };
  const rattachements = rattachementsDepuisDocument(doc, [existante]);
  assert.equal(rattachements.length, 1);
  assert.equal(rattachements[0].reservation.id, "R");
  assert.deepEqual(rattachements[0].lignes_ids, ["l1", "l2"]);
  // Une fois rattachée, la ligne n'est plus une réservation à créer, et la facture dit 2 personnes et 4 800.
  const apres = { ...existante, details: { ...existante.details, lignes_ids: rattachements[0].lignes_ids } };
  assert.equal(reservationsDepuisDocument(doc, { existantes: [apres] }).length, 0);
  const attendu = attenduDepuisFacture(apres, doc);
  assert.deepEqual(attendu.personnes, { adultes: 2, enfants: 0 });
  assert.equal(attendu.montant_vente, 4800);
});

test("Deux lignes identiques sans variante ou une réservation annulée ne se rattachent pas", () => {
  const tour = { kind: "ligne", id: "t1", partenaire_id: "b", date_service: "2026-11-21", prestation_id: "x", titre: "4 Islands", libelle: "4 Islands", unite: 1500, qte: 2 };
  const [{ reservation: rt }] = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: [tour] } }, { uid: () => "R" });
  assert.deepEqual(rattachementsDepuisDocument({ contenu: { lignes: [tour, { ...tour, id: "t2" }] } }, [{ ...rt, id: "R" }]), [], "un deuxième service identique garde le comportement d'avant");
  const [{ reservation }] = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: [conducteur] } }, { uid: () => "R" });
  assert.deepEqual(rattachementsDepuisDocument({ contenu: { lignes: [conducteur, passager] } }, [{ ...reservation, id: "R", statut: "annule" }]), []);
  // Un deuxième ATV (deuxième conducteur) ajouté après coup rejoint le même voucher.
  assert.deepEqual(rattachementsDepuisDocument({ contenu: { lignes: [conducteur, { ...conducteur, id: "l9" }] } }, [{ ...reservation, id: "R" }])[0].lignes_ids, ["l1", "l9"]);
});

test("Un deuxième passager ajouté à un service déjà réuni ne double aucune ligne", () => {
  const [{ reservation }] = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: [conducteur, passager] } }, { uid: () => "R" });
  const [r] = rattachementsDepuisDocument({ contenu: { lignes: [conducteur, passager, { ...passager, id: "l4" }] } }, [{ ...reservation, id: "R" }]);
  assert.deepEqual(r.lignes_ids, ["l1", "l2", "l4"]);
});

test("Un enfant ajouté après coup rejoint aussi son service", () => {
  const adulte = { kind: "ligne", id: "a", partenaire_id: "rattana", date_service: "2026-11-25", prestation_id: "x", titre: "Lazy Day Sunset Trip Koh Rok + Koh Haa", libelle: "Lazy Day Sunset Trip Koh Rok + Koh Haa", unite: 3900, qte: 2 };
  const enfant = { ...adulte, id: "e", prestation_id: "y", titre: "Lazy Day Sunset Trip Koh Rok + Koh Haa, child (4-11)", libelle: "Lazy Day Sunset Trip Koh Rok + Koh Haa, child (4-11)", unite: 2900, qte: 1 };
  const [{ reservation }] = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: [adulte] } }, { uid: () => "R" });
  const [r] = rattachementsDepuisDocument({ contenu: { lignes: [adulte, enfant] } }, [{ ...reservation, id: "R" }]);
  assert.deepEqual(r.lignes_ids, ["a", "e"]);
});

test("rolesDuService : rien sans rôle, français sur demande", () => {
  assert.equal(rolesDuService([{ titre: "4 Islands", qte: 2 }]), "");
  assert.equal(rolesDuService([{ ...conducteur, qte: 2 }, passager], "fr"), "2 conducteurs + 1 passager");
});

test("ATV : renommer le service garde « driver » et « passenger » sur les lignes", () => {
  const contenu = { langue: "en", lignes: [conducteur, passager] };
  const [{ reservation }] = reservationsDepuisDocument({ dossier_id: "D", contenu }, { uid: () => "R" });
  const { contenu: c } = contenuAvecService(contenu, reservation, { libelle: "ATV 1h + Kayak" });
  assert.deepEqual(c.lignes.map((l) => l.titre), ["ATV 1h + Kayak, driver", "ATV 1h + Kayak, passenger"]);
});

test("Une réservation ancienne nommée « …, driver » n'affiche pas d'écart de libellé", () => {
  const doc = { contenu: { lignes: [conducteur] } };
  const ancienne = { id: "R", ligne_id: "l1", libelle: "P3: ATV 1h + Kayak 1h Thung Yee Peng, driver", date_service: "2026-11-21", personnes: { adultes: 1, enfants: 0 }, montant_vente: 2800, paye_sur_place: false, partenaire_id: "atv", details: {} };
  assert.equal(ecartReservation(ancienne, doc), null);
  assert.equal(ecartReservation({ ...ancienne, libelle: "Autre chose" }, doc).champs[0].cle, "libelle", "un vrai changement de nom reste signalé");
});
