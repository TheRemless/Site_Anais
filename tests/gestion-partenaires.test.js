import { test } from "node:test";
import assert from "node:assert/strict";
import { marge, trajetDisponible, filtrerTrajets, meilleursNets, resumeParCompagnie, uniteDepuisTexte, contratsAEcheance, correspond } from "../src/gestion/js/partenaires-calc.mjs";
import { convertir, dateIso } from "../docs/gestion/import-partenaires.mjs";

test("marge : montant et pourcentage, null quand il manque un prix", () => {
  assert.deepEqual(marge(1000, 600), { montant: 400, pct: 40 });
  assert.deepEqual(marge("280", "250"), { montant: 30, pct: 11 });
  assert.equal(marge(1000, null), null);
  assert.equal(marge(null, 600), null);
  assert.deepEqual(marge(0, 0), { montant: 0, pct: 0 });
});

test("unité devinée d'après le texte de la brochure", () => {
  assert.equal(uniteDepuisTexte("Par personne"), "pp");
  assert.equal(uniteDepuisTexte("Par enfant (3-9 ans)"), "ch");
  assert.equal(uniteDepuisTexte("Par adulte sup."), "ad");
  assert.equal(uniteDepuisTexte("Par bateau"), "boat");
  assert.equal(uniteDepuisTexte("4 à 6 personnes"), "grp");
  assert.equal(uniteDepuisTexte("Tout public"), "pp");
  assert.equal(uniteDepuisTexte(""), "");
});

const T = [
  { id: "a", partenaire_id: "B", de: "Koh Lanta", vers: "Koh Lipe", depart: "10:30", mode: "Speedboat", fenetres: [["2026-11-01", "2027-05-04"]], prix_adulte: 1900 },
  { id: "b", partenaire_id: "S", de: "Koh Lanta", vers: "Koh Lipe", depart: "13:00", mode: "Speedboat", fenetres: [], prix_adulte: 1800 },
  { id: "c", partenaire_id: "B", de: "Koh Lanta", vers: "Phuket", depart: "08:00", mode: "Ferry", fenetres: [["2026-10-15", "2026-10-31"], ["2027-04-19", "2027-05-20"]], prix_adulte: 1700 },
  { id: "d", partenaire_id: "S", de: "Phuket", vers: "Koh Lanta", depart: "11:00", mode: "Speedboat", fenetres: [], prix_adulte: 1700, actif: false },
];
const nets = { a: 1500, b: 1400, c: 1300 };

test("un trajet sans fenêtre circule toujours, sinon la date doit tomber dedans", () => {
  assert.equal(trajetDisponible(T[1], "2026-07-01"), true);
  assert.equal(trajetDisponible(T[0], "2026-10-20"), false);
  assert.equal(trajetDisponible(T[0], "2026-11-01"), true);
  assert.equal(trajetDisponible(T[2], "2027-04-19"), true);
  assert.equal(trajetDisponible(T[2], "2027-01-10"), false);
  assert.equal(trajetDisponible(T[0], ""), true);
});

test("filtre des trajets : départ, arrivée, date, compagnie, texte, inactifs exclus, tri par trajet puis heure", () => {
  assert.deepEqual(filtrerTrajets(T, { de: "Koh Lanta", vers: "Koh Lipe" }).map((t) => t.id), ["a", "b"]);
  assert.deepEqual(filtrerTrajets(T, { de: "Koh Lanta", vers: "Koh Lipe", date: "2026-10-20" }).map((t) => t.id), ["b"]);
  assert.deepEqual(filtrerTrajets(T, { partenaireId: "B" }).map((t) => t.id), ["a", "c"]);
  assert.deepEqual(filtrerTrajets(T, { q: "ferry" }).map((t) => t.id), ["c"]);
  assert.deepEqual(filtrerTrajets(T, { q: "satun", nomPartenaire: (id) => (id === "S" ? "Satun Pakbara" : "Bundhaya") }).map((t) => t.id), ["b"]);
  assert.ok(!filtrerTrajets(T, {}).some((t) => t.id === "d"));
});

test("meilleur net seulement quand les compagnies n'ont pas le même minimum", () => {
  const netDe = (t) => nets[t.id] ?? null;
  assert.deepEqual([...meilleursNets(T.slice(0, 2), netDe)], ["b"]);
  assert.equal(meilleursNets([T[0]], netDe).size, 0);
  assert.equal(meilleursNets([T[0], { ...T[1], id: "e" }], (t) => 1500).size, 0);
});

test("résumé par compagnie : départs, heures, prix et net les plus bas", () => {
  const r = resumeParCompagnie(T.slice(0, 3), (t) => nets[t.id]);
  assert.deepEqual(r.find((x) => x.partenaire_id === "B"), { partenaire_id: "B", departs: 2, heures: ["08:00", "10:30"], vente: 1700, net: 1300 });
});

test("contrats à échéance dans les 30 jours, les passés en premier", () => {
  const P = [
    { id: 1, nom: "A", contrat: { fin: "2026-11-10" } },
    { id: 2, nom: "B", contrat: { fin: "2026-10-20" } },
    { id: 3, nom: "C", contrat: { fin: "2027-05-20" } },
    { id: 4, nom: "D", contrat: {} },
  ];
  const r = contratsAEcheance(P, "2026-10-29");
  assert.deepEqual(r.map((x) => [x.partenaire.nom, x.passe]), [["B", true], ["A", false]]);
});

test("recherche sans accents, tous les mots", () => {
  assert.equal(correspond("Koh Lanta → Aéroport de Krabi", "aeroport krabi"), true);
  assert.equal(correspond("Koh Lanta → Aéroport de Krabi", "phuket"), false);
});

test("dates des contrats : « 21 avr 2026 », « Juin 2027 »", () => {
  assert.equal(dateIso("21 avr 2026"), "2026-04-21");
  assert.equal(dateIso("Juin 2027"), "2027-06-30");
  assert.equal(dateIso("n'importe quoi"), null);
});

test("conversion de la base partenaires : nets et banque à part, trajets, alertes en tâches", () => {
  const D = {
    partners: [
      { id: "P01", name: "Lanta Longtail Tour", thai: "ลันตา", cat: "Excursions bateaux", grp: "mer", role: "Longtail", person: "M. Sarawut", phones: [{ n: "081-9789025", l: "Principal", wa: true }], email: ["a@b.c"], address: "66 Moo 2", pier: "Old Town Pier", bank: { bank: "SCB", account: "123" }, payment: "Virement", cancel: "24 h", status: "ok", statusKind: "ok", validity: "Oct 2026 – Juin 2027", notes: ["Note 1"], todo: ["Contrat à signer"] },
      { id: "P03", name: "Bundhaya Speed Boat", cat: "Ferries et speedboats", grp: "mer", phones: [], email: [], bank: null, statusKind: "warn" },
    ],
    excursions: [{ partner: "Lanta Longtail Tour", section: "LANTA LONGTAIL TOUR, EXCURSIONS EN GROUPE (JOIN TOUR)", formule: "Join", prog: "4 Îles, Adulte", boat: "Longtail", pax: "Par personne", time: "08h00", sale: 1000, net: 600, incl: "Déjeuner", park: "200 ฿", cond: "" }],
    activities: [],
    rentals: [],
    taxis: [],
    routes: [{ co: "B", no: 1, frm: "Phuket", to: "Koh Phi Phi", mode: "Speedboat", dur: "1 h", dep: "08:30", arr: "09:30", ad: 800, adn: 600, ch: 600, chn: 400, inf: "Gratuit", per: "Toute la période du contrat", win: [] }],
    parkFees: [{ site: "Koh Rok et Koh Ha", ad: 400, ch: 200, tad: 40, tch: 20, partners: "Longtail" }],
    children: [{ p: "Bundhaya", child: "3 à 9 ans", inf: "Moins de 3 ans gratuit", other: "" }],
    commissions: [],
    checkins: [{ p: "Bundhaya (Langkawi)", t: "90 min avant", extra: "Passeport." }],
    checkpoints: { bundhaya: [["Phuket", "Rassada Pier"]], satun: [] },
    pickups_bundhaya: [{ zone: "Old Town", thai: "โอลทาวน์", t: ["08:40 AM", "01:40 PM"] }],
    offices: [{ co: "Bundhaya", place: "Phuket", addr: "77 Tilok", ph: ["088"], line: "b", email: "e" }],
    timeline: [["11 juin 2026", "Date du fichier de tarifs agents Bundhaya", "contrat"]],
    alerts: [{ id: "A01", level: "critique", title: "Frais de parc jamais inclus", pids: ["P01"], text: "Texte", action: "Écrire sur le devis", src: "Brochures" }],
  };
  let n = 0;
  const r = convertir(D, "E1", () => `id-${++n}`, "2026-10-29T00:00:00Z");
  assert.equal(r.partenaires.length, 2);
  const longtail = r.partenaires[0];
  assert.equal(longtail.contrat.fin, "2027-06-30");
  assert.equal(longtail.contact.telephones[0].whatsapp, true);
  assert.ok(!("bank" in longtail) && !JSON.stringify(longtail).includes("123"), "la banque ne reste pas sur la fiche publique");
  assert.deepEqual(r.partenaires_prives.map((p) => p.partenaire_id), [longtail.id]);
  assert.equal(r.partenaires_prives[0].banque.account, "123");
  const bund = r.partenaires[1];
  assert.deepEqual(bund.regles.enfants, ["3 à 9 ans. Moins de 3 ans gratuit"]);
  assert.equal(bund.regles.checkin[0], "Langkawi : 90 min avant Passeport.");
  assert.equal(bund.contact.guichets.length, 1);
  assert.deepEqual(bund.regles.pickups[0].lignes[0], ["Old Town (โอลทาวน์)", "08:40", "13:40"]);
  assert.equal(bund.contrat.evenements.length, 1);
  assert.equal(r.prestations.length, 2, "une excursion et des frais de parc");
  const exc = r.prestations[0];
  assert.equal(exc.famille, "excursion");
  assert.equal(exc.groupe, "Excursions en groupe (join tour)");
  assert.equal(exc.unite, "pp");
  assert.ok(!("net" in exc));
  assert.deepEqual(r.prestations_nets.map((x) => [x.prestation_id, x.net]), [[exc.id, 600]]);
  assert.equal(r.prestations[1].sur_place, true);
  assert.equal(r.prestations[1].partenaire_id, null);
  assert.equal(r.trajets.length, 1);
  assert.equal(r.trajets[0].partenaire_id, bund.id);
  assert.deepEqual(r.trajets_nets[0], { id: r.trajets_nets[0].id, created_at: "2026-10-29T00:00:00Z", entite_id: "E1", trajet_id: r.trajets[0].id, net_adulte: 600, net_enfant: 400 });
  assert.deepEqual(r.taches.map((t) => t.titre), ["Contrat à signer", "[Critique] Frais de parc jamais inclus"]);
  assert.equal(r.taches[1].partenaire_id, longtail.id);
  assert.ok(r.taches[1].description.includes("À faire : Écrire sur le devis"));
  assert.ok(r.partenaires.concat(r.prestations, r.trajets).every((x) => x.entite_id === "E1"));
});
