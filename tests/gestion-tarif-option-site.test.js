// Demande collée venue de secrettravelandtour.com : le tarif proposé en premier est celui de l'option cochée sur le site (18.11.2026).
// Avant, il était deviné par recouvrement de mots : « Koh Rok & Koh Haa – Day trip » proposait le Lazy Day à 3 900 au lieu du Day trip à 2 000.
// Les messages sont ceux que fabrique le code du site (src/js/booking.js, origin/main 953d173) ; les tarifs sont ceux de la base (identifiant,
// libellé, unité et prix de vente, publics sur le site), sans aucun net ni aucune commission.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lireMessage, decouperServices, proposerOffres, tarifsDuSite } from "../src/gestion/js/demande-calc.mjs";
import { PRODUITS_SITE } from "../src/gestion/js/site-produits.mjs";
import { ligneDepuisPrestation } from "../src/gestion/js/partenaires-calc.mjs";
import fs from "node:fs";

const AJD = "2026-11-18";
const RATTANA = "p-rattana";
const LONGTAIL = "p-lanta-longtail";
const MONKEY = "p-monkey";
const KAYAK = "p-lanta-kayaking";
const t = (id, partenaire_id, groupe, libelle, unite, prix_vente, extra = {}) => ({ id, partenaire_id, famille: "excursion", groupe, libelle, libelle_en: libelle, unite, prix_vente, actif: true, sur_place: false, details: {}, ...extra });
const JOIN = "Shared speedboat excursions (join trip)";
const LAZY = "Lazy Day sunset trips (small group)";
const SUNSET = "Sunset island trips";
const PRESTATIONS = [
  t("971339f0-28fc-5ce8-a9a8-4483b4c38b49", RATTANA, JOIN, "One Day Trip Koh Phi Phi + Bamboo Island", "pp", 2000),
  t("264bc47b-67a7-5261-ad0f-275187939068", RATTANA, JOIN, "One Day Trip Koh Phi Phi + Bamboo Island, child (4-11)", "ch", 1000),
  // Sorties au coucher du soleil du flyer du 22.11.2026 ; les tarifs Lazy Day et l'ancienne affiche Rok Haa à 2 500 restent en base, inactifs.
  t("133fe67c-74c4-4b4b-a8a9-a1e7aa927d1e", RATTANA, SUNSET, "Phi Phi Bamboo Island + Sunset", "pp", 2900),
  t("ef164c6d-7244-4f59-8c3e-59d8563e18d0", RATTANA, SUNSET, "Phi Phi Bamboo Island + Sunset, child (4-11)", "ch", 1900),
  t("c0a0922b-e30c-44bc-b029-a131f65e36ba", RATTANA, LAZY, "Lazy Day Sunset Trip Koh Phi Phi + Bamboo Island", "pp", 3900, { actif: false }),
  t("5f4e4bfa-7bd3-4fef-9b82-c76d419ec1d6", RATTANA, LAZY, "Lazy Day Sunset Trip Koh Phi Phi + Bamboo Island, child (4-11)", "ch", 2900, { actif: false }),
  t("e54ec997-a2bf-5bb1-ac02-9531e46d1e25", RATTANA, JOIN, "One Day Trip Koh Rok + Koh Ha", "pp", 2000),
  t("a3f959f0-e598-5c91-a841-9136130fc652", RATTANA, JOIN, "One Day Trip Koh Rok + Koh Ha, child (4-11)", "ch", 1000),
  t("494841cb-8693-46c4-8dcc-1a7ba51a4b1e", RATTANA, SUNSET, "Rok Haa Island + Sunset", "pp", 2900),
  t("5a90e9ef-a6c4-4dd3-9ca4-59a68df5716a", RATTANA, SUNSET, "Rok Haa Island + Sunset, child (4-11)", "ch", 1900),
  t("2cad3d50-b06d-5859-acb6-c532055059f4", RATTANA, JOIN, "One Day Trip Koh Rok + Koh Ha Sunset", "pp", 2500, { actif: false }),
  t("75b3030a-afa1-530b-a670-75adfe1d149f", RATTANA, JOIN, "One Day Trip Koh Rok + Koh Ha Sunset, child (4-11)", "ch", 1800, { actif: false }),
  t("2558da12-6885-45f5-8d1a-3737389b1183", RATTANA, LAZY, "Lazy Day Sunset Trip Koh Rok + Koh Haa", "pp", 3900, { actif: false }),
  t("44294cf2-7e04-4b1b-8c3c-273c9f917187", RATTANA, LAZY, "Lazy Day Sunset Trip Koh Rok + Koh Haa, child (4-11)", "ch", 2900, { actif: false }),
  t("9523ba29-29a0-5869-a6b7-a3ede00eea18", RATTANA, "Private speedboat charter rate grid (1 to 75 pax)", "Koh Rok or 4 Islands or Koh Phi Phi", "grp", 20000),
  t("a3e3ba75-0b57-5acb-ae24-f37507f277ea", RATTANA, JOIN, "One Day Trip 4 Islands (Koh Chueak, Mook Emerald Cave, Kradan, Ngai)", "pp", 2000),
  t("d0e6ae78-4dc6-5119-acaf-9cafe2504d7b", RATTANA, JOIN, "One Day Trip 4 Islands (Koh Chueak, Mook Emerald Cave, Kradan, Ngai), child (4-11)", "ch", 1000),
  t("0711f191-fe3b-587f-a28a-db415fd235e7", MONKEY, "Private Koh Phi Phi charter", "Private Koh Phi Phi by longtail (Phi Phi Leh, Bamboo Island, Phi Phi Don)", "grp", 9400),
  t("0e1f1b13-07a1-5496-ab02-02068d7f428b", LONGTAIL, "Private Koh Rok (snorkelling paradise)", "Private Koh Rok (Koh Rok Nok & Koh Rok Nai)", "grp", 7400),
  t("1961d3a3-783e-5c91-af21-2b93561cbc59", LONGTAIL, "Private Koh Rok (snorkelling paradise)", "Private Koh Rok (Koh Rok Nok & Koh Rok Nai)", "grp", 7900),
  t("4f5c45c4-0000-4000-8000-000000000001", LONGTAIL, "Private Koh Rok (snorkelling paradise)", "Private Koh Rok (Koh Rok Nok & Koh Rok Nai)", "grp", 8400, { actif: false }),
  t("f7a3e657-dcc7-567c-a79d-fb8ea9a1f15c", LONGTAIL, "Group excursions (join tour)", "4 Islands (Koh Chuek, Koh Mook Emerald Cave, Koh Ngai, Koh Maa)", "pp", 1000),
  t("437c5bb2-dbb0-5beb-ab43-6fdfaf363dad", LONGTAIL, "Group excursions (join tour)", "4 Islands (Koh Chuek, Koh Mook Emerald Cave, Koh Ngai, Koh Maa), child (4-11)", "ch", 600),
  t("86089978-5c93-5713-aae4-5231d9be8f3c", LONGTAIL, "Private 4 Islands charter", "Private 4 Islands (Koh Mook, Koh Ngai, Koh Chuek, Koh Maa)", "grp", 5900),
  t("71b95917-0c36-58fe-a833-0cc27c17c101", LONGTAIL, "Private 4 Islands charter", "Private 4 Islands (Koh Mook, Koh Ngai, Koh Chuek, Koh Maa)", "grp", 6400),
  t("1e3a5589-f9ee-56f7-acb4-387caf77167d", LONGTAIL, "Private 4 Islands charter", "Private 4 Islands (Koh Mook, Koh Ngai, Koh Chuek, Koh Maa)", "grp", 7400),
  t("a766a679-79ad-5c5c-ab72-794e4537d220", LONGTAIL, "Private 4 Islands charter", "Koh Kradan extension on the private 4 Islands tour", "boat", 500),
  t("86d5ed6c-4939-50a8-a52e-1ff9f4b21218", KAYAK, "Kayak and mangrove", "Programme 4: Mangrove boat trip with lunch", "ad", 1000),
  t("6d52c104-e022-5ea8-ab9a-920bc8837da5", KAYAK, "Kayak and mangrove", "Programme 4: Mangrove boat trip with lunch, child (4-11)", "ch", 700),
  t("34cdcbc5-dc5a-5e34-af84-1439d8a16ad2", KAYAK, "Kayak and mangrove", "Programme 6: Mangrove boat trip + Old Town + viewpoint", "ad", 1300),
  t("470fd427-99da-54ef-a452-02672bb28e0e", KAYAK, "Kayak and mangrove", "Programme 6: Mangrove boat trip + Old Town + viewpoint, child (4-11)", "ch", 900),
  t("89756dda-6910-56c4-a290-71788ee9b990", KAYAK, "Kayak and mangrove", "Programme 7: Mangrove tour (kayak or longtail) + fishing park", "ad", 1800),
  t("e2cf8b3f-536c-5d16-acbf-8d8610cd91a2", KAYAK, "Kayak and mangrove", "Programme 7: Mangrove tour (kayak or longtail) + fishing park, child (4-11)", "ch", 1200),
  t("ce8219f2-a2d6-5ccd-a3b8-017f5202c345", KAYAK, "Kayak and mangrove", "Programme 5: Mangrove kayaking trip with lunch", "ad", 1000),
];
const CONTEXTE = { prestations: PRESTATIONS, trajets: [], partenaires: [], nomPartenaire: () => "" };

// Le message tel que le site l'écrit (booking.js, buildMessage) : la première ligne dit le produit et l'option, la dernière le total estimé.
const message = (titre, gens, total) => `Booking request: ${titre}\nDate: Wed 25 Nov 2026\nGuests: ${gens}\nPickup: Lanta Sand Resort\nName: Anna Keller\nEstimated total: ${total}`;
const FAMILLE = "2 adults, 1 child (age 7)";
const premiere = (texte, contexte = CONTEXTE) => {
  const d = lireMessage(texte, AJD);
  const [service] = decouperServices(texte, d, contexte, AJD);
  return { d, offre: service.offres[0] || null, offres: service.offres };
};

// La correspondance attendue (entreprise Secret, partenaire Rattana), avec le tarif enfant de chaque option.
const ATTENDU = [
  ["Koh Phi Phi – Day trip", "One Day Trip Koh Phi Phi + Bamboo Island", 2000, "264bc47b-67a7-5261-ad0f-275187939068", "5,000 THB"],
  ["Koh Phi Phi – Sunset trip", "Phi Phi Bamboo Island + Sunset", 2900, "ef164c6d-7244-4f59-8c3e-59d8563e18d0", "7,700 THB"],
  ["Koh Rok & Koh Haa – Day trip", "One Day Trip Koh Rok + Koh Ha", 2000, "a3f959f0-e598-5c91-a841-9136130fc652", "5,000 THB"],
  ["Koh Rok & Koh Haa – Sunset trip", "Rok Haa Island + Sunset", 2900, "5a90e9ef-a6c4-4dd3-9ca4-59a68df5716a", "7,700 THB"],
];

for (const [titre, libelle, prix, enfant, total] of ATTENDU) {
  test(`option du site « ${titre} » : ${libelle} (${prix}) en premier, son tarif enfant, le total du site`, () => {
    const { offre } = premiere(message(titre, FAMILLE, total));
    assert.ok(offre, "aucune offre");
    assert.equal(offre.titre, libelle);
    assert.equal(Number(offre.source.prix_vente), prix);
    assert.equal(offre.enfant && offre.enfant.id, enfant);
    // 2 adultes et 1 enfant : le total de l'offre est celui que le site a annoncé au client.
    assert.equal(offre.total, Number(total.replace(/\D/g, "")));
  });
}

test("autres pages à options proches : 4 Islands, Mangroves, longtails privés (taille du groupe), toujours le tarif de l'option cochée", () => {
  const cas = [
    ["4 Islands – Join-in longtail", FAMILLE, "f7a3e657-dcc7-567c-a79d-fb8ea9a1f15c", 2600],
    ["4 Islands – Join-in speedboat", FAMILLE, "a3e3ba75-0b57-5acb-ae24-f37507f277ea", 5000],
    ["4 Islands – Private longtail", "4 adults", "71b95917-0c36-58fe-a833-0cc27c17c101", 6400],
    ["Mangroves by longtail – Half day by longtail, with lunch", FAMILLE, "86d5ed6c-4939-50a8-a52e-1ff9f4b21218", 2700],
    ["Mangroves by longtail – Longtail through the mangrove, then Old Town and a viewpoint", FAMILLE, "34cdcbc5-dc5a-5e34-af84-1439d8a16ad2", 3500],
    ["Mangroves by longtail – Mangrove by kayak or longtail, then a fishing park", FAMILLE, "89756dda-6910-56c4-a290-71788ee9b990", 4800],
    ["Koh Phi Phi – Private longtail", "4 adults", "0711f191-fe3b-587f-a28a-db415fd235e7", 9400],
    ["Koh Rok & Koh Haa – Private longtail", "4 adults", "1961d3a3-783e-5c91-af21-2b93561cbc59", 7900],
    ["Koh Rok & Koh Haa – Private longtail", "2 adults", "0e1f1b13-07a1-5496-ab02-02068d7f428b", 7400],
  ];
  for (const [titre, gens, id, total] of cas) {
    const { offre } = premiere(message(titre, gens, `${total.toLocaleString("en-US")} THB`));
    assert.equal(offre && offre.id, id, titre);
    assert.equal(offre.total, total, titre);
  }
});

test("options à plusieurs lignes de prix : la ligne choisie sur le site (cours, kart, quad) passe devant, l'enfant suit la même ligne", () => {
  const P = [
    t("74a7cce0-0000-4000-8000-000000000001", "p-dive", "Courses", "Advanced Open Water (2 days, 5 dives)", "pp", 14000),
    t("c17460d1-0000-4000-8000-000000000001", "p-dive", "Courses", "Open Water Diver (18 m, 3 days, 4 dives)", "pp", 14000),
    t("65a7e434-0000-4000-8000-000000000001", "p-kart", "Electric go-karting", "15 min · Large single seat", "veh", 699),
    t("8518f7b6-0000-4000-8000-000000000001", "p-kart", "Electric go-karting", "15 min · Small single seat", "veh", 499),
    // Quad du nouveau partenaire (22.11.2026) : « 1 hour to Lung Sod Beach », tarifs T2.
    t("656886ad-0000-4000-8000-000000000001", "p-atv", "All-terrain quad", "T2: ATV 1 hour (Koh Lanta Noi, Lung Sod Beach), driver", "ad", 1800),
    t("34e877a6-0000-4000-8000-000000000001", "p-atv", "All-terrain quad", "T2: ATV 1 hour (Koh Lanta Noi, Lung Sod Beach), passenger", "ad", 1300),
    t("696bcf75-0000-4000-8000-000000000001", "p-atv", "All-terrain quad", "T2: ATV 1 hour (Koh Lanta Noi, Lung Sod Beach), driver child (5-12)", "ch", 1500),
    t("f6bb9c2f-0000-4000-8000-000000000001", "p-atv", "All-terrain quad", "T2: ATV 1 hour (Koh Lanta Noi, Lung Sod Beach), passenger child (3-12)", "ch", 1000),
  ];
  // Identifiants inventés : les tarifs se retrouvent par leur libellé, seul à le porter.
  const ctx = { ...CONTEXTE, prestations: P };
  const plongee = "Booking request: Scuba diving – Courses\nCourse: Advanced Open Water Diver, 2 days, 5 dives\nDate: Wed 25 Nov 2026\nGuests: 1 adult\nPickup: Lanta Sand Resort\nName: Anna Keller\nEstimated total: 14,000 THB";
  assert.equal(premiere(plongee, ctx).offre.titre, "Advanced Open Water (2 days, 5 dives)");
  const kart = "Booking request: Electric go-kart – 15 minutes\nKarts: 1 × Large single seat\nDate: Wed 25 Nov 2026\nPickup: Lanta Sand Resort\nName: Anna Keller\nEstimated total: 699 THB";
  assert.equal(premiere(kart, ctx).offre.titre, "15 min · Large single seat");
  const quad = "Booking request: ATV (quad bike) – 1 hour to Lung Sod Beach\nRiders and passengers: 2 × Adult passenger\nDate: Wed 25 Nov 2026\nPickup: Lanta Sand Resort\nName: Anna Keller\nEstimated total: 2,600 THB";
  assert.equal(premiere(quad, ctx).offre.titre, "T2: ATV 1 hour (Koh Lanta Noi, Lung Sod Beach), passenger");
  // Message envoyé avant le changement de partenaire (ancien titre « 1 hour, forest and viewpoint ») : même tarif.
  const ancien = quad.replace("1 hour to Lung Sod Beach", "1 hour, forest and viewpoint");
  assert.equal(premiere(ancien, ctx).offre.titre, "T2: ATV 1 hour (Koh Lanta Noi, Lung Sod Beach), passenger");
  // Passager adulte avec un enfant : le tarif enfant est celui du passager, pas celui du pilote.
  const d = { ...lireMessage(quad, AJD), adultes: 1, enfants: 1, ages: [8] };
  const [passager] = tarifsDuSite(d, ctx);
  assert.equal(passager.enfantSite.id, "f6bb9c2f-0000-4000-8000-000000000001");
});

test("location : le véhicule cité donne son tarif ; sans véhicule, rien n'est imposé (pas le modèle le plus cher de la liste)", () => {
  const P = [
    { ...t("bb013c90-1a2b-4c3d-8e4f-000000000001", "p-rent", "Scooters", "Honda PCX 160", "day", 550), famille: "location" },
    { ...t("a64e2400-1a2b-4c3d-8e4f-000000000001", "p-rent", "Scooters", "Honda Click 125", "day", 250), famille: "location" },
  ];
  const ctx = { ...CONTEXTE, prestations: P };
  const avec = "Rental request: Scooters and small bikes\nVehicle: Honda PCX 160\nVehicles: 1\nFrom: Wed 25 Nov 2026\nTo: Fri 27 Nov 2026\nName: Anna Keller\nPrice: Honda PCX 160: 550 THB per 24 hours";
  const d = lireMessage(avec, AJD);
  assert.deepEqual(tarifsDuSite(d, ctx).map((o) => o.titre), ["Honda PCX 160"]);
  const sans = lireMessage("Rental request: Scooters and small bikes\nVehicles: 1\nFrom: Wed 25 Nov 2026\nTo: Fri 27 Nov 2026\nName: Anna Keller", AJD);
  assert.deepEqual(tarifsDuSite(sans, ctx), []);
});

test("liste de sorties du site : la sortie lue garde le tarif de son option", () => {
  const texte = "Trip list: 2 trips\nGuests: 2 adults, 1 child (age 7)\nPickup: Lanta Sand Resort\nName: Anna Keller\n\nWed 25 Nov 2026\nKoh Rok & Koh Haa – Sunset trip\nEstimated total: 7,700 THB\n\nFri 27 Nov 2026\nKoh Phi Phi – Sunset trip\nEstimated total: 7,700 THB\n\nEstimated total, all trips: 15,400 THB";
  const { offre } = premiere(texte);
  assert.equal(offre.id, "494841cb-8693-46c4-8dcc-1a7ba51a4b1e");
  assert.equal(offre.total, 7700);
});

test("message envoyé avant le changement de nom des options (PR 50 du site) : l'ancien titre donne le même tarif", () => {
  assert.equal(premiere(message("Koh Rok & Koh Haa – Join-in speedboat", FAMILLE, "5,000 THB")).offre.id, "e54ec997-a2bf-5bb1-ac02-9531e46d1e25");
  // L'option « Sunset trip » de Koh Rok garde ses anciens titres : un vieux message donne le tarif actuel (flyer du 22.11.2026).
  assert.equal(premiere(message("Koh Rok & Koh Haa – Later trip, back at sunset", FAMILLE, "6,800 THB")).offre.id, "494841cb-8693-46c4-8dcc-1a7ba51a4b1e");
  // L'option Lazy Day (« Small group, back at sunset », puis « Full-day sunset trip ») est retirée du site le 22.11.2026 : plus d'ancien titre.
  assert.ok(!PRODUITS_SITE.some((p) => p.options.some((o) => (o.anciens || []).includes("Small group, back at sunset"))));
});

test("le tarif de l'option passe devant, les autres tarifs du produit restent proposés derrière", () => {
  const { offres } = premiere(message("Koh Rok & Koh Haa – Day trip", FAMILLE, "5,000 THB"));
  assert.equal(offres[0].id, "e54ec997-a2bf-5bb1-ac02-9531e46d1e25");
  assert.ok(offres.length > 1);
  assert.equal(new Set(offres.map((o) => o.id)).size, offres.length, "un tarif proposé deux fois");
  // Jamais un tarif enfant seul en tête ni ailleurs : il suit son tarif adulte.
  assert.ok(offres.every((o) => o.source.unite !== "ch"));
});

test("tarif introuvable par son identifiant (démonstration, tarif recréé) : retrouvé par son libellé s'il est seul à le porter", () => {
  const copies = PRESTATIONS.map((p) => ({ ...p, id: `copie-${p.id}` }));
  const ctx = { ...CONTEXTE, prestations: copies };
  const { offre } = premiere(message("Koh Rok & Koh Haa – Day trip", FAMILLE, "5,000 THB"), ctx);
  assert.equal(offre.id, "copie-e54ec997-a2bf-5bb1-ac02-9531e46d1e25");
  assert.equal(offre.enfant.id, "copie-a3f959f0-e598-5c91-a841-9136130fc652");
  // Deux tarifs actifs au même libellé (longtail privé de Koh Rok à 7 400 et 7 900) : le libellé ne suffit pas, rien n'est imposé.
  const d = lireMessage(message("Koh Rok & Koh Haa – Private longtail", "4 adults", "7,900 THB"), AJD);
  assert.deepEqual(tarifsDuSite(d, ctx), []);
});

test("tarif masqué, inactif ou d'un partenaire masqué : jamais proposé par l'option du site", () => {
  const sansDay = PRESTATIONS.map((p) => (p.id === "e54ec997-a2bf-5bb1-ac02-9531e46d1e25" ? { ...p, actif: false } : p));
  const { offres } = premiere(message("Koh Rok & Koh Haa – Day trip", FAMILLE, "5,000 THB"), { ...CONTEXTE, prestations: sansDay });
  assert.ok(!offres.some((o) => o.id === "e54ec997-a2bf-5bb1-ac02-9531e46d1e25"));
  const d = lireMessage(message("Koh Phi Phi – Day trip", FAMILLE, "5,000 THB"), AJD);
  assert.deepEqual(tarifsDuSite(d, { ...CONTEXTE, partenaires: [{ id: RATTANA, actif: false }] }), []);
});

test("message libre : le recouvrement de mots reste la seule voie (aucune option du site à lire)", () => {
  const d = lireMessage("Hello, we would like the Koh Rok day trip on 25 November for 2 adults", AJD);
  assert.equal(d.libre, true);
  assert.deepEqual(tarifsDuSite(d, CONTEXTE), []);
});

test("option inconnue du site (titre jamais porté) : pas de tarif imposé, on retombe sur le recouvrement", () => {
  const d = lireMessage(message("Koh Rok & Koh Haa – Custom day", FAMILLE, "5,000 THB"), AJD);
  assert.deepEqual(tarifsDuSite(d, CONTEXTE), []);
  assert.ok(proposerOffres(d, CONTEXTE).length > 0);
});

test("site-produits.mjs : chaque ligne de prix reliée porte un identifiant de tarif et un libellé, jamais un prix ni un net", () => {
  let n = 0;
  for (const p of PRODUITS_SITE) {
    for (const o of p.options) {
      for (const x of o.tarifs || []) {
        n++;
        // `ages` : les âges que la ligne déclare sur le site ({ min, max }, structurés), pas un prix ni un net.
        assert.deepEqual(Object.keys(x).filter((k) => k !== "ages").sort(), ["libelle", "ligne", "prestation"], `${p.id} ${o.id}`);
        if (x.ages) assert.ok(Object.keys(x.ages).every((k) => (k === "min" || k === "max") && Number.isFinite(x.ages[k])), `${p.id} ${o.id} : ages`);
        assert.match(x.prestation, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, `${p.id} ${o.id}`);
        assert.ok(x.ligne && x.libelle, `${p.id} ${o.id}`);
      }
      for (const a of o.anciens || []) assert.ok(!p.options.some((q) => q.titre === a), `${p.id} : ancien titre « ${a} » porté par une option actuelle`);
    }
  }
  assert.ok(n >= 100, `${n} lignes reliées seulement`);
  const rok = PRODUITS_SITE.find((p) => p.id === "koh-rok-koh-haa");
  assert.deepEqual(rok.options.map((o) => o.titre), ["Day trip", "Sunset trip", "Private longtail", "Private speedboat"]);
});

// ---- Options sans prix sur le site (« Price on WhatsApp », PR 51 et 52 du site) ------------------------------------------
// docs/gestion/cles-options-site.json relie l'option elle-même (« slug|identifiant ») aux tarifs de Gestion, recopiée dans site-produits.mjs.
const OCTOPUSEA = t("e1c1818e-ead0-4b8c-bc68-364fb9cf0007", "p-octopusea", "Private speedboat (custom day)", "Private speedboat OctopuSea, custom day", "grp", null, { libelle_en: "Private speedboat, custom day" });
const AVEC_SPEEDBOAT = { ...CONTEXTE, prestations: [...PRESTATIONS, OCTOPUSEA] };
const surDemande = (titre, gens = "4 adults, 1 child (age 6)") => `Booking request: ${titre}\nDate: Wed 25 Nov 2026\nGuests: ${gens}\nPickup: Lanta Sand Resort\nName: Anna Keller`;

test("longtail privé sans prix sur le site : le tarif privé de la base, à la tranche qui contient le groupe", () => {
  const cas = [
    ["4 Islands – Private longtail", "4 adults, 1 child (age 6)", "1e3a5589-f9ee-56f7-acb4-387caf77167d", 7400],
    ["4 Islands – Private longtail", "2 adults", "86089978-5c93-5713-aae4-5231d9be8f3c", 5900],
    ["Koh Phi Phi – Private longtail", "4 adults, 1 child (age 6)", "0711f191-fe3b-587f-a28a-db415fd235e7", 9400],
    ["Koh Rok & Koh Haa – Private longtail", "4 adults, 1 child (age 6)", "1961d3a3-783e-5c91-af21-2b93561cbc59", 7900],
    ["Koh Rok & Koh Haa – Private longtail", "2 adults, 1 child (age 2)", "0e1f1b13-07a1-5496-ab02-02068d7f428b", 7400],
  ];
  for (const [titre, gens, id, total] of cas) {
    const { offre } = premiere(surDemande(titre, gens), AVEC_SPEEDBOAT);
    assert.equal(offre && offre.id, id, `${titre}, ${gens}`);
    assert.equal(offre.total, total, `${titre}, ${gens}`);
  }
});

test("longtail privé, groupe plus grand que toutes les tranches actives : la plus grande tranche devant, avec un avertissement", () => {
  const { offre } = premiere(surDemande("4 Islands – Private longtail", "8 adults"), AVEC_SPEEDBOAT);
  assert.equal(offre.id, "1e3a5589-f9ee-56f7-acb4-387caf77167d");
  assert.equal(offre.avertissement, "groupe_hors_tranche");
  // Un groupe qui tient dans une tranche n'a pas d'avertissement.
  assert.equal(premiere(surDemande("4 Islands – Private longtail", "4 adults"), AVEC_SPEEDBOAT).offre.avertissement, "");
});

test("speedboat privé (PR 52 du site) : le tarif OctopuSea sans prix, sur les trois pages, prix vide à saisir sans erreur", () => {
  for (const page of ["4 Islands", "Koh Phi Phi", "Koh Rok & Koh Haa"]) {
    const { offre, offres } = premiere(surDemande(`${page} – Private speedboat`), AVEC_SPEEDBOAT);
    assert.equal(offre && offre.id, "e1c1818e-ead0-4b8c-bc68-364fb9cf0007", page);
    assert.equal(offre.titre, "Private speedboat, custom day");
    // Sans prix de vente : pas de total, aucun enfant ni supplément ajouté, et jamais un autre tarif à la place.
    assert.equal(offre.total, null, page);
    assert.equal(offre.enfant, undefined);
    assert.ok(offres.length >= 1);
  }
  // La ligne de facture garde le prix vide (à saisir), une quantité de 1 et le tarif : pas de NaN ni de 0 inventé.
  const ligne = ligneDepuisPrestation(OCTOPUSEA, null, { langue: "en", date: "2026-11-25", qte: 1, uid: () => "l1" });
  assert.equal(ligne.unite, null);
  assert.equal(ligne.qte, 1);
  assert.equal(ligne.prestation_id, OCTOPUSEA.id);
  assert.equal(ligne.offert, undefined);
});

test("cles-options-site.json : chaque clé vise une option du site sans ligne de prix, des tarifs au bon format, ni prix ni net", () => {
  const cles = JSON.parse(fs.readFileSync(new URL("../docs/gestion/cles-options-site.json", import.meta.url), "utf8"));
  for (const [cle, tarifs] of Object.entries(cles)) {
    if (cle.startsWith("_")) continue;
    const [slug, id] = cle.split("|");
    const option = (PRODUITS_SITE.find((p) => p.id === slug) || { options: [] }).options.find((o) => o.id === id);
    assert.ok(option, `${cle} : option absente de site-produits.mjs`);
    assert.deepEqual(option.tarifs, tarifs, `${cle} : site-produits.mjs à régénérer`);
    for (const x of tarifs) {
      assert.deepEqual(Object.keys(x).sort(), ["libelle", "ligne", "prestation"], cle);
      assert.match(x.prestation, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, cle);
    }
  }
});

