// Les infos de la réservation sur le voucher, pas dans les notes internes (Jérémy, 22.11.2026) : « Pourquoi les bagages ne se mettent pas
// dans le champ bagages ? Ils se mettent dans les notes internes, ça ne sert à rien. […] Toutes les informations doivent être dans le
// voucher, parce qu'il sert autant au client qu'aux chauffeurs. » Bagages, sièges par type (child seat, baby seat, aucun siège) et remarque
// du voucher suivent chaque chemin de l'Assistant jusqu'à la Booking confirmation ; seul l'interne reste en note. Données fictives.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executer, refDe, OUTILS, remarqueInterne } from "../supabase/functions/agent/outils.js";
import { tempsSimule } from "../supabase/functions/agent/planifier.js";
import { propositionDepuisCarte, reservationDepuisCarte, reservationModifiee, siegesAChoisir } from "../src/gestion/js/agent-calc.mjs";
import { propositionVersDemande } from "../src/gestion/js/assistant-calc.mjs";
import { champsBooking, passagersBooking } from "../src/gestion/js/taxi-calc.mjs";
import { siegesVoucher } from "../src/gestion/js/operations-calc.mjs";
import { lignesCourse, siegesTh, TH } from "../src/gestion/js/courses-partenaire-calc.mjs";
import { siegesLus, siegesAnglais, detailsAvecSieges, siegesAChoisir as aChoisir } from "../src/gestion/js/sieges-calc.mjs";
import { siegesIncomplets } from "../src/gestion/js/creation-voucher-calc.mjs";
import { textesVoucher } from "../src/gestion/js/textes-voucher.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const lire = (f) => fs.readFileSync(path.join(ici, "..", f), "utf8");

const PA = "aaaaaaaa-0000-4000-8000-000000000002";
const RES = "e2000000-0000-4000-8000-000000000002";
const DOS = "d2000000-0000-4000-8000-000000000002";
const donnees = {
  partenaires: [{ id: PA, nom: "Navette Exemple", actif: true }],
  prestations: [
    { id: "a2000000-0000-4000-8000-000000000002", famille: "transfert", groupe: "Private minivan", libelle: "Minivan privé", libelle_en: "Private minivan", prix_vente: 2500, unite: "veh", partenaire_id: PA, actif: true },
    { id: "b2000000-0000-4000-8000-000000000003", famille: "excursion", groupe: "Island tour", libelle: "Tour des îles", libelle_en: "Island tour", prix_vente: 1500, unite: "pp", partenaire_id: PA, actif: true },
  ],
  trajets: [],
  clients: [{ id: "c2000000-0000-4000-8000-000000000002", prenom: "Exemple", nom: "Client" }],
  dossiers: [{ id: DOS, ref: "2026-0002", client_id: "c2000000-0000-4000-8000-000000000002", annule: false }],
  reservations: [{ id: RES, dossier_id: DOS, libelle: "Transfer Lanta → Krabi Airport", date_service: "2026-12-03", heure_pickup: "09:00", lieu_pickup: "Hotel Exemple", personnes: { adultes: 2, enfants: 1 }, statut: "confirme", sieges: "1", bagages: "2", remarques_voucher: "Call on arrival" }],
};
const ctx = (extra = {}) => ({ charger: async (n) => donnees[n] || [], reglages: {}, simule: tempsSimule, ...extra });
const memo = (extra = {}) => ({ prix: new Set(), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), signer: false, prestataires: ["Navette Exemple"], entreprise: "Test", textes: ["Flight FD3217 tomorrow"], ...extra });
// Le service d'une course de l'exemple du 22.11.2026 (rendu fictif) : 2 bagages, ferry inclus, espèces au chauffeur, heure d'arrivée.
const REMARQUE = "Ferry included. Cash payment to the driver. Expected arrival 13:26 (latest 13:36).";
const service = (o = {}) => ({ texte: "Transfert", ref: "", date: "2026-12-03", heure_pickup: "09:00", lieu_pickup: "Hotel Exemple", de: "Koh Lanta", vers: "Krabi Airport", adultes: 2, enfants: 1, sieges: 0, sieges_bebe: 0, sans_siege: false, bagages: 2, prix_saisi: "", vol: "FD3217", remarque_voucher: REMARQUE, note_interne: "", ...o });
const dossierCarte = (services, o = {}) => ({ titre: "Dossier", client_nom: "", client_telephone: "", hotel: "", langue: "en", adultes: 2, enfants: 1, bebes: 0, services, apporteur: "", ...o });
const T = textesVoucher(null);
// La Booking confirmation d'une réservation, champ par champ, comme renderBookingConfirmation et renderBookingSecret la lisent.
const booking = (r) => {
  const dt = r.details || {};
  return Object.fromEntries(champsBooking({ nom: "Exemple Client", date: r.date_service, pickup: r.lieu_pickup, heure: r.heure_pickup, dropoff: "Krabi Airport", personnes: r.personnes || {}, bagages: dt.bagages || "", sieges: siegesLus(dt), vol: dt.vol, montant: 2500, remarques: dt.remarques, t: T }).map((c) => [c.cle, c.valeur]));
};

test("schéma de l'Assistant : bagages, sièges par type, aucun siège, remarque du voucher et note interne ; plus de « remarque » fourre-tout", () => {
  for (const nom of ["proposer_dossier", "proposer_reservation"]) {
    const outil = OUTILS.find((o) => o.name === nom).input_schema.properties;
    const p = (outil.services ? outil.services.items : outil.service).properties;
    for (const k of ["bagages", "sieges", "sieges_bebe", "sans_siege", "remarque_voucher", "note_interne"]) assert.ok(p[k], `${nom} : ${k}`);
    assert.equal(p.remarque, undefined, `${nom} : l'ancienne remarque partait dans les notes`);
    assert.match(p.remarque_voucher.description, /EN ANGLAIS/);
  }
  const champs = OUTILS.find((o) => o.name === "proposer_modification").input_schema.properties.champ.enum;
  for (const k of ["bagages", "sieges", "sieges_bebe", "sans_siege", "remarque_voucher", "note_interne"]) assert.ok(champs.includes(k), `proposer_modification : ${k}`);
  assert.ok(!champs.includes("remarque"));
  // La consigne : poser la question des sièges, tout l'utile sur le voucher.
  const consignes = lire("supabase/functions/agent/prompt.js");
  assert.match(consignes, /« sieges_a_choisir » et ne se valide pas/);
  assert.match(consignes, /Seul ce qui est vraiment interne .* va dans « note_interne »/);
});

test("contrôle : chaque champ voucher saisi par l'Assistant arrive sur la Booking confirmation (ajout à un dossier, puis dossier)", async () => {
  // Ajout à un dossier existant (carte « reservation »), puis la réservation telle que la fiche l'ouvre.
  const ajout = await executer("proposer_reservation", { titre: "Ajout", dossier: refDe("D", DOS), service: service({ sieges: 1, sieges_bebe: 1, enfants: 2 }) }, ctx(), memo());
  const s = ajout.carte.donnees.service;
  assert.deepEqual([s.bagages, s.sieges, s.sieges_bebe, s.sans_siege, s.remarque_voucher, s.note_interne], [2, 1, 1, false, REMARQUE, ""]);
  const r = { ...reservationDepuisCarte(ajout.carte.donnees), date_service: "2026-12-03" };
  assert.deepEqual(r.details, { vol: "FD3217", bagages: "2", remarques: REMARQUE, sieges: 1, sieges_bebe: 1 });
  assert.equal(r.notes, "", "rien de tout cela dans les notes internes");
  const b = booking(r);
  assert.equal(b[T("b_bagages")], "2 pieces");
  assert.match(b[T("b_passagers")], /2 adults, 2 children \(1 child seat, 1 baby seat\)/);
  assert.equal(b[T("b_remarques")], REMARQUE);
  assert.match(b[T("b_pickup")] + b[T("b_dropoff")], /FD3217/);
  // Nouveau dossier (carte « dossier ») : jusqu'au service de la fiche de création, dans le bloc du voucher.
  const carte = await executer("proposer_dossier", dossierCarte([service({ sans_siege: true })]), ctx(), memo());
  const prop = propositionDepuisCarte(carte.carte.donnees);
  assert.equal(prop.remarques, "", "les notes du dossier restent vides");
  const { services } = propositionVersDemande(prop, { prestations: [], trajets: [], partenaires: [] });
  assert.deepEqual(services[0].voucherCarte, { sans_siege: true, bagages: "2", remarques: REMARQUE });
  assert.equal(services[0].vol, "FD3217");
  assert.equal(services[0].siegesRequis, true);
  // La fiche pose voucherCarte dans la saisie du service, que la création écrit dans `details` (creation-excursions.mjs, nonVides).
  const demande = lire("src/gestion/js/views/demande.mjs");
  assert.match(demande, /voucherCarte: t\.voucherCarte \|\| null/);
  assert.match(demande, /if \(sv\.voucherCarte\) \{/);
  const details = detailsAvecSieges({ vol: "FD3217", bagages: "2", remarques: REMARQUE }, siegesLus(services[0].voucherCarte));
  assert.match(booking({ date_service: "2026-12-03", personnes: { adultes: 2, enfants: 1 }, details })[T("b_passagers")], /1 child \(no child seat needed\)/);
  // Les deux rendus de la Booking confirmation lisent bien ces clés de la réservation.
  for (const f of ["src/gestion/js/views/voucher-taxi.mjs", "src/gestion/js/views/voucher-secret.mjs"]) assert.match(lire(f), /sieges: siegesLus\(dt\), vol: dt\.vol, montant: r\.montant_vente, .*remarques: dt\.remarques/);
  assert.match(lire("src/gestion/js/views/voucher.mjs"), /const bagages = dt\.bagages \|\| "";/);
});

test("remarques : ce qui cite un net, une commission, un montant interne ou un partenaire reste en note interne, jamais sur le voucher", async () => {
  assert.equal(remarqueInterne(REMARQUE, memo()), false);
  assert.equal(remarqueInterne("Net 1800 for the driver", memo()), true);
  assert.equal(remarqueInterne("Boat by Navette Exemple", memo()), true);
  assert.equal(remarqueInterne("Pay 1,750 THB", memo({ internes: new Set([1750]) })), true);
  assert.equal(remarqueInterne("Pay 2,500 THB to the driver", memo({ controleImpossible: true })), true, "nets illisibles : un montant reste interne");
  assert.equal(remarqueInterne("Pay 2,500 THB to the driver", memo()), false, "un prix de vente passe");
  assert.equal(remarqueInterne("Ferry cost included.", memo()), false, "« cost » sans montant reste sur le voucher (relecture)");
  assert.equal(remarqueInterne("Cost 900 for the boat", memo()), true, "un montant près d'un mot de coût reste interne");
  const carte = await executer("proposer_dossier", dossierCarte([service({ sans_siege: true, remarque_voucher: "Commission 300 to the hotel", note_interne: "Rappeler la veille" })]), ctx(), memo());
  const s = carte.carte.donnees.services[0];
  assert.equal(s.remarque_voucher, "");
  assert.equal(s.note_interne, "Rappeler la veille Commission 300 to the hotel");
  assert.ok(carte.carte.avertissements.includes("remarque_voucher_interne"), "la carte le dit à Nani");
  const r = reservationDepuisCarte({ dossier_id: DOS, service: s });
  assert.equal((r.details || {}).remarques, undefined);
  assert.equal(r.notes, "Rappeler la veille Commission 300 to the hotel");
  // La carte « Modification » refuse une remarque de voucher interne : le modèle doit utiliser note_interne.
  const m = await executer("proposer_modification", { titre: "x", reservation: refDe("R", RES), champ: "remarque_voucher", valeur: "Net 900", raison: "" }, ctx(), memo());
  assert.equal(m.contenu.erreur, "remarque_interne_utiliser_note_interne");
  // Une ancienne carte (« remarque » seule, d'avant le 22.11.2026) reste une note interne, comme avant.
  assert.equal(reservationDepuisCarte({ dossier_id: DOS, service: { texte: "Transfert", remarque: "ancienne" } }).notes, "ancienne");
  assert.equal(propositionDepuisCarte({ services: [{ texte: "Transfert", remarque: "ancienne" }] }).remarques, "ancienne");
});

test("sièges : avec un enfant ou un bébé sur un transfert, la carte ne se valide pas tant que le choix n'est pas fait", async () => {
  const sans = await executer("proposer_dossier", dossierCarte([service()]), ctx(), memo());
  assert.ok(sans.carte.avertissements.includes("sieges_a_choisir"), "la fonction le dit au modèle, qui pose la question");
  assert.equal(siegesAChoisir(sans.carte), true);
  for (const choix of [{ sieges: 1 }, { sieges_bebe: 1 }, { sans_siege: true }]) {
    const avec = await executer("proposer_dossier", dossierCarte([service(choix)]), ctx(), memo());
    assert.ok(!(avec.carte.avertissements || []).includes("sieges_a_choisir"), JSON.stringify(choix));
    assert.equal(siegesAChoisir(avec.carte), false);
  }
  // Un bébé seul (au niveau du dossier) compte ; sans enfant ni bébé, rien à choisir.
  const bebe = await executer("proposer_dossier", dossierCarte([service({ enfants: 0 })], { enfants: 0, bebes: 1 }), ctx(), memo());
  assert.equal(siegesAChoisir(bebe.carte), true);
  const adultes = await executer("proposer_dossier", dossierCarte([service({ enfants: 0 })], { enfants: 0 }), ctx(), memo());
  assert.equal(siegesAChoisir(adultes.carte), false);
  // Une excursion (pas un transfert) n'a pas de sièges à choisir.
  const tour = await executer("proposer_dossier", dossierCarte([service({ ref: refDe("P", donnees.prestations[1].id), vol: "" })]), ctx(), memo());
  assert.equal(siegesAChoisir(tour.carte), false);
  // « Aucun » ne vaut qu'en l'absence de siège ; jamais validé d'un geste ; la fiche de création et celle de la réservation l'exigent.
  const deux = await executer("proposer_reservation", { titre: "Ajout", dossier: refDe("D", DOS), service: service({ sieges: 1, sans_siege: true }) }, ctx(), memo());
  assert.equal(deux.carte.donnees.service.sans_siege, false);
  assert.match(lire("src/gestion/js/views/agent.mjs"), /else if \(siegesAChoisir\(c\)\) r = \{ ok: false, motif:/);
  assert.deepEqual(siegesIncomplets([{ ligneIds: ["l1"], siegesRequis: true, personnes: { adultes: 2, enfants: 1 }, bebes: 0, sieges: 0, details: {} }]), { index: 0, ligneIds: ["l1"], champ: "sieges", code: "e_sieges_choix" });
  assert.equal(siegesIncomplets([{ siegesRequis: true, personnes: { adultes: 2, enfants: 1 }, sieges: 0, details: { sans_siege: true } }]), null);
  assert.equal(siegesIncomplets([{ siegesRequis: false, personnes: { adultes: 2, enfants: 1 }, sieges: 0, details: {} }]), null, "ZTP ou excursion : pas de champ, rien d'exigé");
  assert.match(lire("src/gestion/js/views/reservations.mjs"), /else if \(siegesAChoisir\(\{ enfants: nb\(enfants\.value\) \|\| 0, bebes: nb\(bebes\.value\) \|\| 0, sieges: siegesSaisisTypes\(\) \}\) && siegesExiges\(base, petits\)\) erreurChamp/);
  // Relecture : une réservation d'avant sans choix s'enregistre encore (une carte « Modification » de l'heure passe d'un geste) ; le choix
  // est exigé pour un nouveau service, quand les enfants ou bébés changent, ou quand un choix posé est effacé.
  const { siegesExiges } = await import("../src/gestion/js/views/reservations.mjs");
  const ancienne = { id: RES, personnes: { adultes: 2, enfants: 1 }, details: {} };
  assert.equal(siegesExiges(ancienne, 1), false);
  assert.equal(siegesExiges(ancienne, 2), true, "un enfant de plus");
  assert.equal(siegesExiges({ ...ancienne, details: { sans_siege: true } }, 1), true, "un choix effacé");
  assert.equal(siegesExiges({ personnes: { enfants: 1 } }, 1), true, "un nouveau service");
  assert.equal(aChoisir({ enfants: 1, sieges: siegesLus({ sans_siege: "true" }) }), false, "la colonne lue en texte vaut aussi");
});

test("impression des sièges par type : voucher de Secret, Booking confirmation, écran thaï du chauffeur et de Mook ; l'ancien nombre reste un child seat", () => {
  assert.equal(siegesAnglais(siegesLus({ sieges: 1, sieges_bebe: 1 })), "1 child seat, 1 baby seat");
  assert.equal(siegesAnglais(siegesLus({ sieges_bebe: 2 })), "2 baby seats");
  assert.equal(siegesAnglais(siegesLus({ sans_siege: true })), "no child seat needed");
  assert.equal(siegesAnglais(siegesLus({ sieges: 2, sans_siege: true })), "2 child seats", "un siège l'emporte sur « aucun »");
  assert.equal(siegesAnglais(siegesLus({})), "");
  assert.equal(siegesVoucher({ sieges: 1, sieges_bebe: 1 }), " (1 child seat, 1 baby seat)");
  assert.equal(siegesVoucher({ sans_siege: true }), " (no child seat needed)");
  assert.equal(siegesVoucher(2), " (2 child seats)", "ancienne forme");
  assert.equal(passagersBooking({ adultes: 2, enfants: 1, bebes: 1 }, "", { enfant: 1, bebe: 1, aucun: false }), "2 adults, 1 child, 1 baby (1 child seat, 1 baby seat)");
  assert.equal(passagersBooking({ adultes: 2, enfants: 1 }, "", 1), "2 adults, 1 child (1 child seat)", "ancienne forme");
  // Écran du chauffeur (Mr. Brown) et de Mook, en thaï.
  assert.equal(siegesTh({ sieges: 1, sieges_bebe: 1 }), `${TH.sieges} 1 · ${TH.sieges_bebe} 1`);
  assert.equal(siegesTh({ sans_siege: true }), TH.sans_siege);
  const l = lignesCourse({ id: "x", adultes: 2, enfants: 1, details: { sans_siege: true } });
  assert.ok(l.essentiel.some((x) => x.cle === "personnes" && x.valeur.includes(TH.sans_siege)));
  // La liste blanche SQL du chauffeur reçoit les deux nouvelles clés (migration 118).
  const sql = lire("docs/gestion/migration-118-sieges-par-type.sql");
  assert.match(sql, /'sieges', 'sieges_bebe', 'sans_siege'/);
});

test("carte « Modification » : bagages, sièges bébé, aucun siège, remarque du voucher et note interne vont chacun à leur place", async () => {
  const ref = refDe("R", RES);
  const lu = await executer("lire_dossier", { dossier: "2026-0002" }, ctx(), memo());
  assert.deepEqual([lu.contenu.services[0].sieges, lu.contenu.services[0].bagages], [1, "2"]);
  const avant = async (champ, valeur) => (await executer("proposer_modification", { titre: "x", reservation: ref, champ, valeur, raison: "" }, ctx(), memo())).carte.donnees.avant;
  assert.equal(await avant("bagages", "3"), "2");
  assert.equal(await avant("sieges_bebe", "1"), "0");
  assert.equal(await avant("remarque_voucher", "Meet at gate 3"), "Call on arrival");
  for (const [champ, v] of [["bagages", "trois"], ["sans_siege", "non"], ["sieges_bebe", "10"]]) assert.equal((await executer("proposer_modification", { titre: "x", reservation: ref, champ, valeur: v, raison: "" }, ctx(), memo())).contenu.erreur, "valeur_invalide", `${champ} ${v}`);
  const r = { id: RES, notes: "Interne", personnes: { adultes: 2, enfants: 1 }, details: { vol: "FD3217", sieges: 1, remarques: "Call on arrival" } };
  assert.deepEqual(reservationModifiee(r, { champ: "bagages", valeur: "3" }).details, { vol: "FD3217", sieges: 1, remarques: "Call on arrival", bagages: "3" });
  assert.deepEqual(reservationModifiee(r, { champ: "sieges_bebe", valeur: "1" }).details, { vol: "FD3217", remarques: "Call on arrival", sieges: 1, sieges_bebe: 1 });
  assert.deepEqual(reservationModifiee(r, { champ: "sans_siege", valeur: "oui" }).details, { vol: "FD3217", remarques: "Call on arrival", sans_siege: true }, "« aucun » retire les sièges");
  assert.deepEqual(reservationModifiee({ ...r, details: { sans_siege: true } }, { champ: "sieges", valeur: "1" }).details, { sieges: 1 }, "un siège retire « aucun »");
  assert.equal(reservationModifiee(r, { champ: "remarque_voucher", valeur: "Meet at gate 3" }).details.remarques, "Call on arrival\nMeet at gate 3");
  assert.equal(reservationModifiee(r, { champ: "remarque_voucher", valeur: "Meet at gate 3" }).notes, "Interne", "la note interne ne bouge pas");
  assert.equal(reservationModifiee(r, { champ: "note_interne", valeur: "Rappeler" }).notes, "Interne\nRappeler");
  assert.equal(reservationModifiee(r, { champ: "note_interne", valeur: "Rappeler" }).details.remarques, "Call on arrival");
  // La fonction lit les nouvelles clés de `details`.
  assert.match(lire("supabase/functions/agent/index.ts"), /sieges_bebe:details->>sieges_bebe, sans_siege:details->>sans_siege, bagages:details->>bagages, remarques_voucher:details->>remarques/);
});

test("carte de l'Assistant : les deux colonnes « Sur le voucher » et « Interne », et les sièges par type", () => {
  const agent = lire("src/gestion/js/views/agent.mjs");
  assert.match(agent, /h\("strong", null, tr\("Sur le voucher"\)\)/);
  assert.match(agent, /h\("strong", null, tr\("Interne"\)\)/);
  assert.match(agent, /siegesTexte\(s, d\), bagagesTexte\(s\)/);
  assert.match(agent, /sieges_a_choisir: N_\(/);
});
