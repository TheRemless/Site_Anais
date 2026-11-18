// Participants d'un service distincts de la quantité facturée (Jérémy, 18.11.2026) : un « Full day tour - Tuk Tuk » à 1 200 pour le groupe,
// 2 adultes et 2 enfants, donnait « 1 passenger » ; avec la quantité 4, « 4 passengers » et un total de 4 800.
import { test } from "node:test";
import assert from "node:assert/strict";
import { descriptionService, reservationsDepuisDocument, attenduDepuisFacture, ecartReservation, contenuAvecReservation, avecDescription, participantsDuService } from "../src/gestion/js/operations-calc.mjs";
import { ligneLibre, ligneDepuisPrestation, lignesDepuisTrajet } from "../src/gestion/js/partenaires-calc.mjs";
import { servicesCreation } from "../src/gestion/js/creation-voucher-calc.mjs";

let n = 0;
const uid = () => `id${++n}`;
const tuk = (par, extra = {}) => ligneLibre({ libelle: "Full day tour - Tuk Tuk", prix: 1200, qte: extra.qte ?? 4, date: "2026-11-22", par, personnes: { adultes: 2, enfants: 2 } }, { uid });
const total = (lignes) => lignes.reduce((s, l) => s + Number(l.unite) * Number(l.qte), 0);
const doc = (lignes) => ({ dossier_id: "d1", contenu: { lignes, langue: "en" } });

test("tuk-tuk par groupe : quantité 1, total 1 200, libellé des vrais participants", () => {
  const l = tuk("grp");
  assert.equal(l.qte, 1, "par groupe : la quantité saisie n'est pas reprise");
  assert.equal(total([l]), 1200);
  assert.deepEqual(l.personnes, { adultes: 2, enfants: 2 });
  assert.equal(descriptionService(l, "en"), "Full day tour - Tuk Tuk, 2 adults, 2 children, 22 November 2026");
  assert.equal(descriptionService(l, "fr"), "Full day tour - Tuk Tuk, 2 adultes, 2 enfants, 22 novembre 2026");
});

test("prix par personne : quantité = participants, total prix × quantité, libellé des participants", () => {
  const l = tuk("pp");
  assert.equal(l.qte, 4);
  assert.equal(total([l]), 4800);
  assert.equal(descriptionService(l, "en"), "Full day tour - Tuk Tuk, 2 adults, 2 children, 22 November 2026");
  // Quantité changée à la main : le libellé garde les participants, le prix suit la quantité.
  const trois = tuk("pp", { qte: 3 });
  assert.equal(total([trois]), 3600);
  assert.equal(descriptionService(trois, "en"), "Full day tour - Tuk Tuk, 2 adults, 2 children, 22 November 2026");
});

test("singulier et pluriel anglais : 1 adult, 1 child, 3 adults", () => {
  const un = ligneLibre({ libelle: "Cooking class", prix: 900, par: "grp", personnes: { adultes: 1, enfants: 0 } }, { uid });
  assert.equal(descriptionService(un, "en"), "Cooking class, 1 adult");
  const mixte = ligneLibre({ libelle: "Cooking class", prix: 900, par: "grp", personnes: { adultes: 3, enfants: 1 } }, { uid });
  assert.equal(descriptionService(mixte, "en"), "Cooking class, 3 adults, 1 child");
  // Sans participants (champ vide) : seulement le nom et la date, jamais « 1 passenger » pour un prix de groupe.
  const vide = ligneLibre({ libelle: "Cooking class", prix: 900, par: "grp", date: "2026-11-22" }, { uid });
  assert.equal(vide.personnes, undefined);
  assert.equal(descriptionService(vide, "en"), "Cooking class, 22 November 2026");
});

test("tarifs du catalogue : leur unité reste, le libellé suit les participants", () => {
  const p = { adultes: 2, enfants: 2 };
  // Par groupe ou par véhicule : prix inchangé (quantité 1), participants au libellé.
  const grp = { ...ligneDepuisPrestation({ id: "x1", libelle: "Private longtail", unite: "grp", prix_vente: 3500 }, null, { langue: "en", qte: 1 }), personnes: p, intro: "" };
  assert.equal(grp.qte, 1);
  assert.equal(descriptionService(grp, "en"), "Private longtail, 2 adults, 2 children");
  // Par personne sans prix enfant (quantité = 4 personnes) : les participants, pas « 4 passengers ».
  const pp = { ...ligneDepuisPrestation({ id: "x2", libelle: "4 Islands", unite: "pp", prix_vente: 1000 }, null, { langue: "en", qte: 4 }), personnes: p };
  assert.equal(descriptionService(pp, "en"), "4 Islands, 2 adults, 2 children");
  // Par personne avec une ligne enfant : chaque ligne dit ce qu'elle facture.
  const adulte = { ...pp, qte: 2 };
  const enfant = { ...pp, id: "e", qte: 2, intro: "(per child)", libelle: "4 Islands, child" };
  assert.equal(descriptionService(adulte, "en"), "4 Islands, 2 adults");
  assert.equal(descriptionService(enfant, "en"), "4 Islands, child, 2 children");
  // Trajet : ligne adulte et ligne enfant.
  const [ta, te] = lignesDepuisTrajet({ id: "t1", de: "Koh Lanta", vers: "Koh Lipe", depart: "08:00", mode: "Speedboat", prix_adulte: 1500, prix_enfant: 1000 }, null, { langue: "en", adultes: 1, enfants: 1 }).map((l) => ({ ...l, personnes: { adultes: 1, enfants: 1 } }));
  assert.match(descriptionService(ta, "en"), /, 1 adult$/);
  assert.match(descriptionService(te, "en"), /, 1 child$/);
  // Location par jour : les jours, pas les personnes.
  const jours = { ...ligneDepuisPrestation({ id: "x3", libelle: "Scooter", unite: "day", prix_vente: 250 }, null, { langue: "en", qte: 3 }), personnes: p };
  assert.equal(descriptionService(jours, "en"), "Scooter, 3 days");
});

test("ancienne ligne sans participants : libellé et lecture d'avant, rien de réécrit", () => {
  const ancienne = { id: "old", kind: "ligne", libre: true, libelle: "Full day tour - Tuk Tuk", titre: "Full day tour - Tuk Tuk", intro: "", unite: 1200, qte: 4, date_service: "2026-11-22" };
  assert.equal(descriptionService(ancienne, "en"), "Full day tour - Tuk Tuk, 4 passengers, 22 November 2026");
  assert.equal(descriptionService({ ...ancienne, qte: 1 }, "en"), "Full day tour - Tuk Tuk, 1 passenger, 22 November 2026");
  // Total et personnes de la réservation inchangés.
  assert.equal(total([ancienne]), 4800);
  const [{ reservation: r }] = reservationsDepuisDocument(doc([ancienne]), { uid });
  assert.deepEqual(r.personnes, { adultes: 4, enfants: 0, bebes: 0 });
  // Un libellé enregistré à la main reste tel quel quand la ligne change.
  const ecrit = { ...ancienne, libelle: "Tuk tuk tour for the Martin family" };
  assert.equal(avecDescription(ecrit, { ...ecrit, date_service: "2026-11-23" }, "en").libelle, "Tuk tuk tour for the Martin family");
});

test("la réservation (voucher, Booking confirmation) prend les participants, jamais la quantité facturée", () => {
  const [{ reservation: g, participants }] = reservationsDepuisDocument(doc([tuk("grp")]), { uid });
  assert.deepEqual(g.personnes, { adultes: 2, enfants: 2, bebes: 0 });
  assert.equal(participants, true, "les personnes du dossier ne remplacent pas celles de la ligne");
  assert.equal(g.montant_vente, 1200);
  const [{ reservation: p }] = reservationsDepuisDocument(doc([tuk("pp", { qte: 3 })]), { uid });
  assert.deepEqual(p.personnes, { adultes: 2, enfants: 2, bebes: 0 });
  assert.equal(p.montant_vente, 3600);
  // Écran de création : le bloc du voucher montre les mêmes participants.
  const [sv] = servicesCreation([{ ...tuk("grp"), titre: "Full day tour - Tuk Tuk" }], { prestations: [], partenaires: [], trajets: [] });
  assert.deepEqual({ adultes: sv.personnes.adultes, enfants: sv.personnes.enfants }, { adultes: 2, enfants: 2 });
});

test("pas d'écart facture et réservation pour un prix par groupe", () => {
  const l = tuk("grp");
  const d = doc([l]);
  const [{ reservation: r }] = reservationsDepuisDocument(d, { uid });
  const a = attenduDepuisFacture(r, d);
  assert.deepEqual(a.personnes, { adultes: 2, enfants: 2 });
  assert.equal(ecartReservation(r, d), null);
  // Lignes adulte et enfant séparées : la lecture par quantités reste (pas de participants d'une ligne seule).
  assert.equal(participantsDuService([{ ...l, par: "pp", libre: false, qte: 2 }, { ...l, id: "e", intro: "(per child)", qte: 2 }]), null);
});

test("changer la réservation : les participants suivent, le prix de groupe ne bouge pas, le prix par personne suit", () => {
  const grp = { ...tuk("grp"), titre: "Full day tour - Tuk Tuk" };
  grp.libelle = descriptionService({ ...grp, libelle: grp.titre }, "en");
  const r = { ligne_id: grp.id, details: {} };
  const avant = { date_service: "2026-11-22", personnes: { adultes: 2, enfants: 2 } };
  const apres = { date_service: "2026-11-22", personnes: { adultes: 3, enfants: 2 } };
  const { contenu, reste } = contenuAvecReservation({ langue: "en", lignes: [grp] }, r, avant, apres);
  const [g2] = contenu.lignes;
  assert.equal(g2.qte, 1);
  assert.equal(total([g2]), 1200);
  assert.deepEqual(g2.personnes, { adultes: 3, enfants: 2 });
  assert.equal(g2.libelle, "Full day tour - Tuk Tuk, 3 adults, 2 children, 22 November 2026");
  assert.deepEqual(reste, []);
  const pp = { ...tuk("pp"), titre: "Full day tour - Tuk Tuk" };
  pp.libelle = descriptionService({ ...pp, libelle: pp.titre }, "en");
  const [p2] = contenuAvecReservation({ langue: "en", lignes: [pp] }, { ligne_id: pp.id, details: {} }, avant, apres).contenu.lignes;
  assert.equal(p2.qte, 5);
  assert.equal(total([p2]), 6000);
  assert.equal(p2.libelle, "Full day tour - Tuk Tuk, 3 adults, 2 children, 22 November 2026");
});
