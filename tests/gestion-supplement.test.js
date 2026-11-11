import test from "node:test";
import assert from "node:assert/strict";
import { quantiteParDefaut, personnesSupplementaires, ligneDepuisPrestation, libelleUnite, uniteDepuisTexte } from "../src/gestion/js/partenaires-calc.mjs";
import { prixPrestation, proposerOffresLibres, proposerOffres } from "../src/gestion/js/demande-calc.mjs";
import { reservationsDepuisDocument, ecartReservation, contenuAvecReservation, commissionPrevue } from "../src/gestion/js/operations-calc.mjs";
import { totaux } from "../src/gestion/js/calc.mjs";

// Lacha Ru, programme B : 3 500 pour 1 ou 2 personnes, puis 1 500 par personne en plus. Nets 3 100 et 1 200.
const base = { id: "b", partenaire_id: "L", famille: "excursion", groupe: "Radeaux", libelle: "Programme B : Private Fishing & Seafood, Base 1-2 pers", libelle_en: "Program B : Private Fishing & Seafood, base 1-2 people", unite: "grp", prix_vente: 3500, actif: true };
const sup = { id: "s", partenaire_id: "L", famille: "excursion", groupe: "Radeaux", libelle: "Programme B : Private Fishing & Seafood, Personne supplémentaire", libelle_en: "Program B : Private Fishing & Seafood, extra person", unite: "sup", prix_vente: 1500, actif: true };
const autre = { ...base, id: "c", libelle: "Programme C : Luxury Sunset Dinner, Base 1-2 pers", libelle_en: "Program C : Luxury Sunset Dinner, base 1-2 people", prix_vente: 3900 };
const PRESTATIONS = [base, sup, autre];

test("quantité par défaut : le supplément vaut les personnes au-delà de deux, jamais moins que zéro", () => {
  const q = (a, e = 0) => quantiteParDefaut("sup", { adultes: a, enfants: e });
  assert.deepEqual([q(0), q(1), q(2), q(3), q(4), q(2, 1), q(1, 3)], [0, 0, 0, 1, 2, 1, 2]);
  assert.equal(personnesSupplementaires({ adultes: 5, enfants: 0 }), 3);
  // Les autres unités ne changent pas.
  assert.equal(quantiteParDefaut("pp", { adultes: 3, enfants: 1 }), 4);
  assert.equal(quantiteParDefaut("ad", { adultes: 3, enfants: 1 }), 3);
  assert.equal(quantiteParDefaut("ch", { adultes: 3, enfants: 0 }), 1, "au moins un, comme avant");
  assert.equal(quantiteParDefaut("grp", { adultes: 3, enfants: 1 }), 1);
  assert.equal(libelleUnite("sup", false), "par personne supplémentaire");
  assert.equal(uniteDepuisTexte("Personne supplémentaire"), "sup");
});

test("prix proposé : base pour 1 ou 2 personnes, supplément pour chaque personne en plus, 3 puis 4 personnes", () => {
  const demande = (adultes) => ({ prestation: "Programme B Private Fishing Seafood", adultes, enfants: 0, mode: "" });
  const total = (a) => proposerOffres(demande(a), { prestations: PRESTATIONS })[0];
  assert.equal(total(1).total, 3500);
  assert.equal(total(2).total, 3500);
  assert.equal(total(3).total, 5000, "3 500 + 1 500");
  assert.equal(total(4).total, 6500, "3 500 + 2 × 1 500");
  assert.equal(total(2).supplement, undefined);
  assert.deepEqual([total(3).supplement.source.id, total(3).supplement.qte, total(4).supplement.qte], ["s", 1, 2]);
  // Le supplément ne se propose jamais seul, et le programme C ne prend pas le supplément du B.
  assert.ok(!proposerOffres(demande(3), { prestations: PRESTATIONS }).some((o) => o.id === "s"));
  assert.equal(prixPrestation(sup, { adultes: 4, enfants: 0 }), 3000);
  const libre = proposerOffresLibres({ adultes: 3, enfants: 0 }, "Programme B Private Fishing Seafood pour 3", { prestations: PRESTATIONS });
  assert.equal(libre[0].total, 5000);
  assert.ok(!libre.some((o) => o.id === "s"));
  // Sans prix de supplément : l'offre le dit au lieu de sous-estimer.
  const sansPrix = proposerOffres(demande(3), { prestations: [base, { ...sup, prix_vente: null }] })[0];
  assert.equal(sansPrix.avertissement, "supplement_a_definir");
  assert.equal(sansPrix.total, 3500);
});

test("ligne de supplément : la quantité est le nombre de personnes en plus, zéro possible", () => {
  const l = ligneDepuisPrestation(sup, { net: 1200 }, { qte: 2, devise: "THB" });
  assert.equal(l.qte, 2); assert.equal(l.unite, 1500); assert.equal(l.net, 1200);
  assert.equal(l.intro, "(par personne supplémentaire)");
  assert.equal(ligneDepuisPrestation(sup, null, { qte: 0 }).qte, 0);
  assert.equal(ligneDepuisPrestation(base, null, { qte: 0 }).qte, 1, "les autres unités gardent au moins un");
});

const lignesDe = (a, place = false) => {
  const b = ligneDepuisPrestation(base, { net: 3100 }, { qte: 1, date: "2026-12-01" });
  const l = [{ ...b, id: "lb", partenaire_id: "L" }];
  const n = a - 2;
  if (n > 0) l.push({ ...ligneDepuisPrestation(sup, { net: 1200 }, { qte: n, date: "2026-12-01" }), id: "ls", partenaire_id: "L" });
  return place ? l.map((x) => ({ ...x, paye_sur_place: true })) : l;
};

test("facture et réservation : une seule réservation, avec le bon nombre de personnes, le bon prix et la bonne commission (vente moins net)", () => {
  const regle = { type: "vente_moins_net" };
  for (const [a, vente, net] of [[2, 3500, 3100], [3, 5000, 4300], [4, 6500, 5500]]) {
    const r = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes: lignesDe(a, true) } }, { uid: () => "R", regleDe: () => regle });
    assert.equal(r.length, 1, `${a} personnes : une réservation`);
    assert.equal(r[0].reservation.montant_vente, vente);
    // À deux personnes ou moins il n'y a que la ligne de base : son prix de groupe ne dit pas combien elles sont (une personne par défaut, à corriger à la main).
    if (a > 2) assert.equal(r[0].reservation.personnes.adultes, a);
    assert.equal(r[0].reservation.libelle, "Programme B : Private Fishing & Seafood");
    assert.equal(r[0].net, net);
    assert.equal(commissionPrevue(regle, { vente, net }), vente - net);
    assert.equal(r[0].commission_prevue, vente - net, `${a} personnes : commission`);
    assert.equal(totaux({ lignes: lignesDe(a), colonnes: "total" }).net, vente);
    // Aucun faux écart entre la réservation et sa facture.
    assert.equal(ecartReservation({ ...r[0].reservation, ligne_id: "lb", details: { lignes_ids: a > 2 ? ["lb", "ls"] : [] } }, { contenu: { lignes: lignesDe(a, true) } }), null, `${a} personnes : pas d'écart`);
  }
});

test("réservation vers facture : passer de 3 à 4 personnes ajoute un supplément, sans toucher à la base", () => {
  const r = { ligne_id: "lb", details: { lignes_ids: ["lb", "ls"] } };
  const x = contenuAvecReservation({ lignes: lignesDe(3) }, r, { personnes: { adultes: 3, enfants: 0 } }, { personnes: { adultes: 4, enfants: 0 } });
  assert.deepEqual(x.contenu.lignes.map((l) => l.qte), [1, 2]);
  assert.deepEqual(x.reste, []);
  assert.equal(totaux({ lignes: x.contenu.lignes, colonnes: "total" }).net, 6500);
  // Un enfant compte comme une personne ; une quantité réglée à la main n'est pas devinée.
  const y = contenuAvecReservation({ lignes: lignesDe(3) }, r, { personnes: { adultes: 2, enfants: 1 } }, { personnes: { adultes: 2, enfants: 2 } });
  assert.equal(y.contenu.lignes[1].qte, 2);
  const manuel = lignesDe(3).map((l) => (l.id === "ls" ? { ...l, qte: 5 } : l));
  const z = contenuAvecReservation({ lignes: manuel }, r, { personnes: { adultes: 3, enfants: 0 } }, { personnes: { adultes: 4, enfants: 0 } });
  assert.equal(z.contenu, null);
  assert.equal(z.reste[0].cle, "adultes");
});

test("libellés de la vraie base : base, supplément et enfant d'un programme n'ont pas la même suite après la virgule, ils se regroupent quand même", () => {
  const A = { id: "a", partenaire_id: "L", famille: "excursion", groupe: "Radeaux", libelle: "Programme A : Sunrise View (Lever de soleil dans la mangrove), Base 1-2 pers", unite: "grp", prix_vente: 3500, actif: true };
  const As = { id: "as", partenaire_id: "L", famille: "excursion", groupe: "Radeaux", libelle: "Programme A : Sunrise View, Personne supplémentaire", unite: "sup", prix_vente: 1500, actif: true };
  const B = { ...A, id: "b", libelle: "Programme B : Private Fishing & Fresh Seafood Lunch (4 heures), Base 1-2 pers", prix_vente: 3900 };
  const Bs = { ...As, id: "bs", libelle: "Programme B : Private Fishing & Seafood, Personne supplémentaire", prix_vente: 1800 };
  const o = proposerOffres({ prestation: "Programme B Private Fishing Fresh Seafood Lunch", adultes: 4, enfants: 0 }, { prestations: [A, As, B, Bs] });
  assert.equal(o[0].id, "b");
  assert.equal(o[0].supplement.source.id, "bs", "le supplément du B, pas celui du A");
  assert.equal(o[0].total, 3900 + 2 * 1800);
  const lignes = [{ ...ligneDepuisPrestation(B, null, { qte: 1, date: "2026-12-01" }), id: "x1", partenaire_id: "L" }, { ...ligneDepuisPrestation(Bs, null, { qte: 2, date: "2026-12-01" }), id: "x2", partenaire_id: "L" }];
  const r = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes } }, { uid: () => "R" });
  assert.equal(r.length, 1);
  assert.equal(r[0].reservation.personnes.adultes, 4);
  assert.equal(r[0].reservation.montant_vente, 3900 + 3600);
});

test("dans une facture réelle l'intro est vidée et le libellé décrit le service : le drapeau `supplement` et le titre suffisent", () => {
  const dans = (l, id, desc) => ({ ...l, id, partenaire_id: "L", titre: l.libelle, libelle: desc, intro: "" });
  const lignes = [dans(ligneDepuisPrestation(base, null, { qte: 1, date: "2026-12-05" }), "d1", "Programme B (base), 1 passenger, 5 December 2026"), dans(ligneDepuisPrestation(sup, null, { qte: 2, date: "2026-12-05" }), "d2", "Programme B, 2 passengers, 5 December 2026")];
  assert.equal(lignes[1].supplement, true);
  const r = reservationsDepuisDocument({ dossier_id: "D", contenu: { lignes } }, { uid: () => "R" });
  assert.equal(r.length, 1);
  assert.equal(r[0].reservation.personnes.adultes, 4);
  assert.equal(r[0].reservation.montant_vente, 3500 + 3000);
  assert.equal(ecartReservation({ ...r[0].reservation, ligne_id: "d1", details: { lignes_ids: ["d1", "d2"] } }, { contenu: { lignes } }), null);
  const x = contenuAvecReservation({ lignes }, { ligne_id: "d1", details: { lignes_ids: ["d1", "d2"] } }, { personnes: { adultes: 4, enfants: 0 } }, { personnes: { adultes: 5, enfants: 0 } });
  assert.deepEqual(x.contenu.lignes.map((l) => l.qte), [1, 3]);
});
