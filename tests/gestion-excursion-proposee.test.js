// tests/gestion-excursion-proposee.test.js : « Proposer une excursion » de Gestion (22.11.2026). Après un transfert, pour un séjour de
// plusieurs jours, une ou deux excursions du catalogue de Secret et un message en anglais que Nani relit. Logique dans
// src/gestion/js/excursion-proposee-calc.mjs, écran dans views/proposer-excursion.mjs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const load = () => import("../src/gestion/js/excursion-proposee-calc.mjs");
const lire = (f) => fs.readFileSync(`src/gestion/js/${f}`, "utf8");
const presta = (id, x = {}) => ({ id, famille: "excursion", groupe: "Group tours", partenaire_id: "p1", libelle: id, prix_vente: 1000, unite: "pp", actif: true, ordre: 1, ...x });

test("familles : la page du site d'abord, sinon le libellé", async () => {
  const { familleDe } = await load();
  // Identifiants réels du catalogue, reliés aux pages par site-produits.mjs.
  assert.equal(familleDe({ id: "fee7ddc1-7d15-5a89-a328-b5d5f4f8ab7f", libelle: "P1: ATV 30 mins (safe track), driver" }), "quad");
  assert.equal(familleDe({ id: "x1", libelle: "4 Islands by longtail, full day" }), "iles");
  assert.equal(familleDe({ id: "x2", libelle: "Elephant sanctuary, half day" }), "elephants");
  assert.equal(familleDe({ id: "x3", libelle: "Thai cooking class" }), "cuisine");
  assert.equal(familleDe({ id: "x4", libelle: "Mangrove kayaking, half day" }), "kayak");
  assert.equal(familleDe({ id: "x5", libelle: "Sunset dinner raft" }), "radeau");
  assert.equal(familleDe({ id: "x6", libelle: "Batik painting" }), "autre");
});

test("proposable : prix de vente par personne, ni enfant, ni privé, ni location, ni nom de partenaire", async () => {
  const { proposable } = await load();
  assert.equal(proposable(presta("4 Islands by longtail, full day")), true);
  assert.equal(proposable(presta("4 Islands, child (4-11)", { unite: "ch" })), false);
  assert.equal(proposable(presta("Private 4 Islands", { unite: "boat" })), false);
  assert.equal(proposable(presta("Private speedboat OctopuSea, custom day", { unite: "pp" })), false);
  assert.equal(proposable(presta("Scooter rental", { famille: "location" })), false);
  assert.equal(proposable(presta("Transfer Krabi Airport", { famille: "transfert" })), false);
  assert.equal(proposable(presta("Sunset trip", { prix_vente: null })), false);
  assert.equal(proposable(presta("Sunset trip", { actif: false })), false);
  assert.equal(proposable(presta("Sunset trip by Rattana"), { noms: ["Rattana"] }), false);
  assert.equal(proposable(presta("ATV 30 mins, passenger")), false);
  // Plongée : seulement la journée de découverte.
  assert.equal(proposable(presta("Discover Basic Diver (from age 10, 2 dives)", { famille: "activite" })), true);
  assert.equal(proposable(presta("Open Water Diver (18 m, 3 days, 4 dives)", { famille: "activite" })), false);
});

test("possibilités : familles pas encore réservées, îles d'abord, un même nom une seule fois ; deux familles différentes par défaut", async () => {
  const { possibilites, choixParDefaut } = await load();
  const P = [
    presta("Thai cooking class", { famille: "activite", ordre: 1 }),
    presta("4 Islands by longtail, full day", { ordre: 2 }),
    presta("Koh Rok + Koh Haa day trip", { ordre: 3 }),
    presta("Elephant sanctuary, half day", { famille: "activite", ordre: 4 }),
    presta("Electric go-kart", { famille: "activite", ordre: 5 }),
    presta("Electric go-kart", { famille: "activite", ordre: 6, id: "kart-2" }),
  ];
  P[5].libelle = "Electric go-kart";
  const liste = possibilites(P);
  assert.deepEqual(liste.map((x) => x.famille), ["iles", "iles", "elephants", "cuisine", "autre"]);
  assert.deepEqual(choixParDefaut(liste), ["4 Islands by longtail, full day", "Elephant sanctuary, half day"]);
  const deja = { prestations: new Set(["Thai cooking class"]), familles: new Set(["iles"]) };
  assert.deepEqual(possibilites(P, { deja }).map((x) => x.famille), ["elephants", "autre"]);
});

test("prix : de vente seulement, adulte et enfant du catalogue ; quad par conducteur", async () => {
  const { possibilites, prixTexte } = await load();
  const P = [presta("4 Islands by longtail, full day", { prix_vente: 1200 }), presta("4 Islands by longtail, child (4-11)", { unite: "ch", prix_vente: 900 })];
  const [x] = possibilites(P, { enfants: 1 });
  assert.equal(prixTexte(x), "1,200 THB per adult, 900 THB per child aged 4 to 11");
  // Sans enfant dans le groupe, pas de prix enfant.
  assert.equal(prixTexte(possibilites(P)[0]), "1,200 THB per person");
  // Le prix enfant du champ « Prix enfant » (details.enfant), comme le devis.
  const [y] = possibilites([presta("Koh Phi Phi day trip", { prix_vente: 2000, details: { enfant: 1000 } })], { enfants: 2 });
  assert.equal(prixTexte(y), "2,000 THB per adult, 1,000 THB per child");
  const [z] = possibilites([presta("ATV 30 mins, driver", { prix_vente: 1500 }), presta("ATV 30 mins, driver child (6-12)", { unite: "ch", prix_vente: 1000 })], { enfants: 1 });
  assert.equal(prixTexte(z), "1,500 THB per driver");
});

test("séjour : un transfert qui nomme l'île, au moins deux nuits, pas fini", async () => {
  const { sejour } = await load();
  const t = (date, libelle = "Private minivan: Krabi Airport → Koh Lanta") => ({ date_service: date, libelle });
  const o = { ile: "Koh Lanta", ajd: "2026-11-22" };
  assert.deepEqual(sejour([t("2026-11-23"), t("2026-11-28", "Koh Lanta → Phuket Airport")], o), { arrivee: "2026-11-23", depart: "2026-11-28", nuits: 5 });
  assert.deepEqual(sejour([t("2026-11-23")], o), { arrivee: "2026-11-23", depart: null, nuits: null });
  assert.equal(sejour([t("2026-11-23"), t("2026-11-24", "Koh Lanta → Krabi")], o), null);
  assert.equal(sejour([t("2026-11-23", "Krabi Airport → Ao Nang")], o), null);
  assert.equal(sejour([t("2026-11-10"), t("2026-11-20", "Koh Lanta → Krabi")], o), null);
  assert.equal(sejour([t("2026-10-01")], o), null);
  assert.equal(sejour([], o), null);
});

test("sens du transfert : arrivée vers l'île, départ depuis l'île, ni l'un ni l'autre pour une journée ou un trajet sans l'île", async () => {
  const { sensTransfert } = await load();
  const ile = "Koh Lanta";
  assert.equal(sensTransfert({ libelle: "Private minivan: Krabi Airport → Koh Lanta" }, { ile }), "arrivee");
  assert.equal(sensTransfert({ libelle: "Koh Lanta → Phuket Airport" }, { ile }), "depart");
  assert.equal(sensTransfert({ libelle: "Hat Yai to Koh Lanta" }, { ile }), "arrivee");
  assert.equal(sensTransfert({ libelle: "x" }, { trajet: { de: "Koh Lanta", vers: "Koh Phi Phi" }, ile }), "depart");
  assert.equal(sensTransfert({ libelle: "Krabi Airport → Ao Nang" }, { ile }), null);
  assert.equal(sensTransfert({ libelle: "Private day trip from Koh Lanta to Krabi" }, { ile }), null);
  assert.equal(sensTransfert({ libelle: "Krabi Airport", details: { type_trajet: "retour_depart" } }, { ile }), null);
  // Course de zone (Taxi) : le lieu de prise en charge décide.
  assert.equal(sensTransfert({ libelle: "Krabi Airport", lieu_pickup: "Krabi Airport, arrivals hall", details: { drop_off: "Hotel Sunset" } }, { ile }), "arrivee");
  assert.equal(sensTransfert({ libelle: "Krabi Airport", lieu_pickup: "Hotel Sunset, Klong Dao", details: { drop_off: "Krabi Airport" } }, { ile }), "depart");
});

test("séjour par le sens : un départ seul ne fait pas une arrivée, seuils de la règle d'avant gardés", async () => {
  const { sejour, sensTransfert } = await load();
  const ile = "Koh Lanta";
  const o = { ile, ajd: "2026-11-22", sens: (r) => sensTransfert(r, { ile }) };
  const t = (date, libelle) => ({ date_service: date, libelle });
  // Départ seul : le client est déjà sur l'île, le séjour finit ce jour-là (la règle d'avant en faisait une arrivée).
  assert.deepEqual(sejour([t("2026-11-28", "Koh Lanta → Phuket Airport")], o), { arrivee: null, depart: "2026-11-28", nuits: null });
  assert.deepEqual(sejour([t("2026-11-28", "Koh Lanta → Phuket Airport")], { ile, ajd: "2026-11-22" }), { arrivee: "2026-11-28", depart: null, nuits: null });
  assert.deepEqual(sejour([t("2026-11-23", "Krabi Airport → Koh Lanta"), t("2026-11-28", "Koh Lanta → Phuket Airport")], o), { arrivee: "2026-11-23", depart: "2026-11-28", nuits: 5 });
  // Une journée aller-retour au milieu ne coupe pas le séjour.
  assert.deepEqual(sejour([t("2026-11-23", "Krabi Airport → Koh Lanta"), t("2026-11-25", "Private day trip from Koh Lanta to Krabi"), t("2026-11-28", "Koh Lanta → Phuket Airport")], o), { arrivee: "2026-11-23", depart: "2026-11-28", nuits: 5 });
  // Deux nuits au moins, quatorze jours sans départ connu, rien pour un séjour fini.
  assert.equal(sejour([t("2026-11-23", "Krabi Airport → Koh Lanta"), t("2026-11-24", "Koh Lanta → Krabi Town")], o), null);
  assert.deepEqual(sejour([t("2026-11-09", "Krabi Airport → Koh Lanta")], o), { arrivee: "2026-11-09", depart: null, nuits: null });
  assert.equal(sejour([t("2026-11-07", "Krabi Airport → Koh Lanta")], o), null);
  assert.equal(sejour([t("2026-11-20", "Koh Lanta → Phuket Airport")], o), null);
});

test("jours libres : de demain à la veille du départ, sans les jours où une sortie est réservée", async () => {
  const { joursLibres } = await load();
  const ajd = "2026-11-22";
  assert.deepEqual(joursLibres({ arrivee: "2026-11-21", depart: "2026-11-26" }, { ajd, occupes: ["2026-11-24"] }), ["2026-11-23", "2026-11-25"]);
  assert.deepEqual(joursLibres({ arrivee: "2026-11-24", depart: "2026-11-27" }, { ajd }), ["2026-11-25", "2026-11-26"]);
  assert.deepEqual(joursLibres({ arrivee: null, depart: "2026-11-24" }, { ajd }), ["2026-11-23"]);
  assert.deepEqual(joursLibres({ arrivee: "2026-11-21", depart: "2026-11-24" }, { ajd, occupes: ["2026-11-23"] }), []);
  assert.equal(joursLibres({ arrivee: "2026-11-21", depart: null }, { ajd }).at(-1), "2026-12-05");
});

test("dossier lié : lu chez Secret ou Taxi, dossier lié ZTP ignoré", async () => {
  const { reservationsDuDossierLie } = await load();
  const marques = { "e-secret": "secret", "e-taxi": "taxi", "e-ztp": null };
  const marqueDe = (id) => marques[id] || null;
  const taxi = { id: "d-taxi", entite_id: "e-taxi", dossier_lie_id: "d-lie" };
  const reservations = [
    { id: "r1", dossier_id: "d-lie", date_service: "2026-11-24", statut: "confirme" },
    { id: "r2", dossier_id: "d-lie", date_service: "2026-11-25", statut: "annule" },
    { id: "r3", dossier_id: "d-autre", date_service: "2026-11-26", statut: "confirme" },
  ];
  const lu = (entite_id, extra = {}) => reservationsDuDossierLie(taxi, { dossiers: [{ id: "d-lie", entite_id, ...extra }], reservations, marqueDe }).map((r) => r.id);
  assert.deepEqual(lu("e-secret"), ["r1"]);
  assert.deepEqual(lu("e-taxi"), ["r1"]);
  // Dossier lié ZTP ignoré : chaque entreprise garde ses éléments, seuls Secret et Taxi partagent leurs clients.
  assert.deepEqual(lu("e-ztp"), []);
  assert.deepEqual(lu("e-inconnue"), []);
  assert.deepEqual(lu("e-secret", { annule: true }), []);
  assert.deepEqual(reservationsDuDossierLie({ id: "d-seul", entite_id: "e-taxi" }, { dossiers: [], reservations, marqueDe }), []);
  // L'écran passe bien par cette règle.
  assert.match(lire("views/proposer-excursion.mjs"), /const lie = reservationsDuDossierLie\(dossier, \{/);
});

test("enfants et saison : pas de plongée avec des enfants, Koh Rok d'octobre à avril seulement", async () => {
  const { possibilites } = await load();
  const P = [
    presta("Koh Rok + Koh Haa day trip", { ordre: 1 }),
    presta("Discover Basic Diver (from age 10, 2 dives)", { famille: "activite", ordre: 2 }),
  ];
  assert.deepEqual(possibilites(P).map((x) => x.famille), ["iles", "plongee"]);
  assert.deepEqual(possibilites(P, { enfants: 1 }).map((x) => x.famille), ["iles"]);
  assert.deepEqual(possibilites(P, { jours: ["2026-06-10", "2026-06-11"] }).map((x) => x.famille), ["plongee"]);
  assert.deepEqual(possibilites(P, { jours: ["2026-04-29", "2026-05-01"] }).map((x) => x.famille), ["iles", "plongee"]);
  // Par la page du site aussi (identifiant du catalogue relié à la page Koh Rok & Koh Haa).
  const { PRODUITS_SITE } = await import("../src/gestion/js/site-produits.mjs");
  const tarif = PRODUITS_SITE.find((p) => p.id === "koh-rok-koh-haa").options[0].tarifs[0];
  assert.deepEqual(possibilites([presta(tarif.prestation, { libelle: tarif.libelle })], { jours: ["2026-07-01"] }), []);
});

test("transfert : trajet, prestation transfert, ou toute course de Taxi ; jamais un service annulé", async () => {
  const { estTransfert } = await load();
  assert.equal(estTransfert({ trajet_id: "t1" }), true);
  assert.equal(estTransfert({}, { prestation: { famille: "transfert" } }), true);
  assert.equal(estTransfert({}, { taxi: true }), true);
  assert.equal(estTransfert({}, { prestation: { famille: "excursion" } }), false);
  assert.equal(estTransfert({ statut: "annule" }, { taxi: true }), false);
});

test("message : anglais, prénom, service, prix, page du site ; famille devinée sans phrase ; aucune signature", async () => {
  const { possibilites, messageExcursions } = await load();
  // Sans page du site : le libellé du catalogue, sans lien, et aucune phrase (famille devinée d'après le libellé : fait non sourcé).
  const P = [presta("cd-x", { libelle: "Elephant sanctuary, half day", famille: "activite", prix_vente: 2500 })];
  const [x] = possibilites(P);
  const texte = messageExcursions([x], { prenom: "Mark" });
  assert.equal(
    texte,
    [
      "Hello Mark, since you're staying a few days, here is an idea for a day out.",
      "*Elephant sanctuary, half day*\n2,500 THB per person",
      "If it tempts you, tell me which day and how many people, and I'll check availability 😊",
    ].join("\n\n")
  );
  assert.doesNotMatch(texte, /Nani|Anaïs|Best|Regards|Cheers|net|commission/i);
});

test("question 7 : client de Taxi, le texte de Jérémy mot pour mot, deux ou trois exemples avec leur prix ; ni prénom ni signature", async () => {
  const { possibilites, messageExcursions, choixParDefaut, MODELES } = await load();
  const liste = possibilites([presta("4 Islands by longtail", { prix_vente: 1000 }), presta("Thai cooking class", { famille: "activite", prix_vente: 1650 }), presta("Elephant sanctuary, half day", { famille: "activite", prix_vente: 1800 })]);
  const choisis = liste.filter((x) => choixParDefaut(liste, 3).includes(x.prestation.id));
  assert.equal(choisis.length, 3);
  const texte = messageExcursions(choisis, { prenom: "Ben", taxi: true });
  assert.equal(
    texte,
    [
      "By the way, do you have any day trips or boat tours planned during your stay? We organise those too. A few ideas:",
      "- 4 Islands by longtail: 1,000 THB per person",
      "- Elephant sanctuary, half day: 1,800 THB per person",
      "- Thai cooking class: 1,650 THB per person",
      "All our tours: https://secrettravelandtour.com/tours/",
      "If one of them interests you, send me the day and the number of people and I'll check availability 😊",
    ].join("\n")
  );
  // Le message part juste après le voucher : ni « Hello » ni prénom, même quand il est connu.
  assert.doesNotMatch(texte, /Hello|Ben|Nani|Anaïs|Best|Regards|Cheers|net|commission|Secret Travel/i);
  assert.doesNotMatch(JSON.stringify(MODELES.taxi), /[—–]|\{prenom\}/);
  assert.equal(messageExcursions(choisis.slice(0, 2), { taxi: true }).split("\n").length, 5);
});

test("question 7 : chez Taxi, le bouton n'apparaît qu'une fois le voucher du transfert envoyé au client ; Secret ne change pas", async () => {
  const { voucherEnvoye } = await load();
  assert.equal(voucherEnvoye({ details: { envois: { client: "2026-11-21" } } }), true);
  assert.equal(voucherEnvoye({ details: { envois: { prestataire: "2026-11-21" } } }), false);
  assert.equal(voucherEnvoye({ details: {} }), false);
  assert.equal(voucherEnvoye(null), false);
  const vue = lire("views/proposer-excursion.mjs");
  assert.match(vue, /if \(marque === "taxi" && !transferts\.some\(voucherEnvoye\)\) return null;/);
  assert.match(vue, /const max = taxi \? MAX_TAXI : MAX;/);
  assert.match(vue, /const MAX_TAXI = 3;/);
});

test("question 3 : radeaux proposés, prix du radeau, de la personne en plus et de l'enfant lus dans le catalogue", async () => {
  const { possibilites, prixTexte, messageExcursions, MODELES } = await load();
  const { PRODUITS_SITE } = await import("../src/gestion/js/site-produits.mjs");
  const page = PRODUITS_SITE.find((p) => p.id === "sunset-dinner-raft");
  const [base, extra, enfant] = page.options[0].tarifs;
  const P = [
    presta(base.prestation, { libelle: base.libelle, prix_vente: 3900, unite: "grp" }),
    presta(extra.prestation, { libelle: extra.libelle, prix_vente: 1800, unite: "pp" }),
    presta(enfant.prestation, { libelle: enfant.libelle, prix_vente: 1500, unite: "ch" }),
  ];
  const liste = possibilites(P, { enfants: 1 });
  assert.equal(liste.length, 1, "seule la ligne du radeau se propose");
  assert.equal(liste[0].famille, "radeau");
  assert.equal(prixTexte(liste[0]), "3,900 THB for 1 or 2 people, 1,800 THB for each extra person, 1,500 THB per child aged 3 to 9");
  // Sans enfant dans le groupe : pas de prix enfant.
  assert.equal(prixTexte(possibilites(P)[0]), "3,900 THB for 1 or 2 people, 1,800 THB for each extra person");
  // Ligne en plus sans prix au catalogue : on ne l'écrit pas.
  assert.equal(prixTexte(possibilites([P[0], { ...P[1], prix_vente: null }])[0]), "3,900 THB for 1 or 2 people");
  assert.match(messageExcursions(liste, { prenom: "Lea" }), new RegExp(MODELES.familles.radeau.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // Un radeau sans page du site n'est pas proposé (lignes illisibles).
  assert.deepEqual(possibilites([presta("Private raft at sunrise, for 1 to 2 people", { unite: "grp" })]), []);
});

test("question 8 : radeau pour 3 personnes, 3 900 pour le radeau puis 1 800 par personne en plus, soit 5 700 (lecture du site)", async () => {
  const { completerSupplement } = await import("../src/gestion/js/demande-calc.mjs");
  const base = { id: "raft-base", partenaire_id: "p-raft", famille: "excursion", groupe: "Rafts", libelle: "Program C: Sunset dinner raft, for 1 to 2 people", unite: "grp", prix_vente: 3900, actif: true };
  const plus = { id: "raft-plus", partenaire_id: "p-raft", famille: "excursion", groupe: "Rafts", libelle: "Program C: Sunset dinner raft, extra person", unite: "sup", prix_vente: 1800, actif: true };
  const offre = (pax) => completerSupplement({ genre: "prestation", source: base, total: 3900 }, pax, [base, plus]);
  assert.equal(offre({ adultes: 3, enfants: 0 }).total, 5700);
  assert.deepEqual(offre({ adultes: 3, enfants: 0 }).supplement.qte, 1);
  assert.equal(offre({ adultes: 2, enfants: 0 }).total, 3900);
  assert.equal(offre({ adultes: 4, enfants: 0 }).total, 7500);
  // Le message garde la lecture du site.
  const { prixTexte } = await load();
  assert.equal(prixTexte({ prestation: base, radeau: { extra: plus, enfant: null }, enfant: null }), "3,900 THB for 1 or 2 people, 1,800 THB for each extra person");
});

test("question 4 : le cours de cuisine dit ses jours et ses heures (registre)", async () => {
  const { MODELES, possibilites, messageExcursions } = await load();
  assert.match(MODELES.familles.cuisine, /Classes run on Monday, Wednesday and Saturday, from 9am to 2pm\./);
  const { PRODUITS_SITE } = await import("../src/gestion/js/site-produits.mjs");
  const t = PRODUITS_SITE.find((p) => p.id === "cooking-class").options.find((o) => o.id === "partner-chef").tarifs[0];
  const [x] = possibilites([presta(t.prestation, { libelle: t.libelle, famille: "activite", prix_vente: 1650 })]);
  assert.match(messageExcursions([x], { prenom: "Mark" }), /Monday, Wednesday and Saturday/);
});

test("page du site : nom de la page et de l'option, lien vers la page", async () => {
  const { possibilites, messageExcursions } = await load();
  const { PRODUITS_SITE } = await import("../src/gestion/js/site-produits.mjs");
  const page = PRODUITS_SITE.find((p) => p.id === "4-islands");
  const tarif = page.options[0].tarifs[0];
  const [x] = possibilites([presta(tarif.prestation, { libelle: tarif.libelle })]);
  const texte = messageExcursions([x], { prenom: "Lea" });
  assert.match(texte, new RegExp(`\\*4 Islands: ${page.options[0].titre}\\*`));
  assert.match(texte, /https:\/\/secrettravelandtour\.com\/tours\/4-islands\//);
});

test("modèles : chaque famille en a un, sans tiret d'incise, sans fait hors registre connu", async () => {
  const { MODELES, FAMILLES_EXCURSION } = await load();
  for (const f of FAMILLES_EXCURSION) assert.ok(f in MODELES.familles, f);
  const tous = JSON.stringify(MODELES);
  assert.doesNotMatch(tous, /[—–]/);
  assert.doesNotMatch(tous, /stunning|breathtaking|unforgettable|paradise|hidden gem|must-see/i);
});

test("revue n° 1 : whatsapp-envoi contrôle Secret et Taxi ensemble pour une conversation de l'une ou de l'autre", async () => {
  const { entitesControlees } = await import("../supabase/functions/whatsapp-envoi/calc.js");
  const paire = [{ id: "e-secret", slug: "secret" }, { id: "e-taxi", slug: "taxi" }];
  assert.deepEqual(entitesControlees({ entite_id: "e-taxi" }, paire), ["e-secret", "e-taxi"]);
  assert.deepEqual(entitesControlees({ entite_id: "e-secret" }, paire), ["e-secret", "e-taxi"]);
  assert.deepEqual(entitesControlees({ entite_id: null }, paire), ["e-secret", "e-taxi"]);
  assert.deepEqual(entitesControlees({ entite_id: "e-autre" }, paire), ["e-autre"]);
  assert.deepEqual(entitesControlees({ entite_id: "e-taxi" }, [{ id: "x", slug: "ztp" }, ...paire]), ["e-secret", "e-taxi"]);
  const idx = fs.readFileSync("supabase/functions/whatsapp-envoi/index.ts", "utf8");
  assert.match(idx, /const ids: string\[\] = entitesControlees\(conv, paire \|\| \[\]\);/);
  assert.match(idx, /if \(errE\) return ferme;/, "liste illisible : rien ne part");
  assert.doesNotMatch(idx, /conv\.entite_id \? \[conv\.entite_id\] : \[\]/);
});

test("revue n° 2 : après un refus contenu_interne, copie, lien et envoi éteints jusqu'à ce que le texte change", () => {
  const vue = lire("views/proposer-excursion.mjs");
  assert.match(vue, /if \(code === "contenu_interne" \|\| code === "montant_a_confirmer"\) refuse = texte;/);
  assert.match(vue, /const aRefaire = refuse !== null && texte === refuse;/);
  assert.match(vue, /const ok = !!texte && !noms_\.length && !aRefaire;/);
  assert.match(vue, /copier\.disabled = !ok \|\| !charges;/);
  assert.match(vue, /const lien = ok && charges \? lienWhatsApp\(telephone, texte\) : null;/);
});

test("revue n° 3 : saisie rapide et zones Taxi, « vers », « Ko Lanta », lieux hors de l'île", async () => {
  const { sensTransfert, surIle, lieuxExterieurs } = await load();
  const ile = "Koh Lanta";
  const exterieurs = lieuxExterieurs(["Krabi Airport", "Ao Nang", "Phuket Airport and town", "Trang (town, airport, station)", "Hatyai (town and airport)"]);
  const o = { ile, exterieurs };
  assert.equal(sensTransfert({ libelle: "Krabi Airport → Hotel Sunset" }, o), "arrivee");
  assert.equal(sensTransfert({ libelle: "Hotel Sunset -> Phuket Airport" }, o), "depart");
  assert.equal(sensTransfert({ libelle: "Krabi Airport vers Ko Lanta" }, o), "arrivee");
  assert.equal(sensTransfert({ libelle: "Hotel Palm to Trang" }, o), "depart");
  // Zone Taxi : l'hôtel en prise en charge, c'est un départ ; l'aéroport, une arrivée ; sinon le lieu de dépose.
  assert.equal(sensTransfert({ libelle: "Krabi Airport", lieu_pickup: "Hotel Sunset, Klong Dao" }, o), "depart");
  assert.equal(sensTransfert({ libelle: "Krabi Airport", lieu_pickup: "Krabi Airport, arrivals" }, o), "arrivee");
  assert.equal(sensTransfert({ libelle: "Ao Nang", details: { drop_off: "Hotel Sunset" } }, o), "arrivee");
  assert.equal(sensTransfert({ libelle: "x" }, { ...o, prestation: { libelle: "Hatyai (town and airport)" } }), null, "ni prise en charge ni dépose");
  // Le libellé de la réservation (saisie rapide) passe avant le tarif de zone.
  assert.equal(sensTransfert({ libelle: "Krabi Airport → Hotel Sunset" }, { ...o, prestation: { libelle: "Krabi Airport" } }), "arrivee");
  assert.equal(surIle("Saladan", o), true);
  assert.equal(surIle("Koh Lanta Pier", o), true);
  assert.equal(surIle("Ao Nang", o), false);
  assert.equal(surIle("Rassada Pier", o), false);
  assert.equal(surIle("Koh Phi Phi", o), false);
  assert.equal(surIle("", o), null);
});

test("revue n° 4 : course sur l'île ignorée, séjour avec arrivée d'abord, jour d'arrivée pris, départ seul plafonné, saison sur les vrais jours libres", async () => {
  const { sejour, sensTransfert, joursLibres, possibilites } = await load();
  const ile = "Koh Lanta";
  const o = { ile, ajd: "2026-11-22", sens: (r) => sensTransfert(r, { ile }) };
  const t = (date, libelle) => ({ date_service: date, libelle });
  assert.equal(sensTransfert({ libelle: "Old Town → Saladan" }, { ile }), null);
  // Une course sur l'île entre l'arrivée et le départ ne coupe rien.
  assert.deepEqual(sejour([t("2026-11-23", "Krabi Airport → Hotel Sunset"), t("2026-11-25", "Old Town → Saladan"), t("2026-11-28", "Hotel Sunset → Krabi Airport")], o), { arrivee: "2026-11-23", depart: "2026-11-28", nuits: 5 });
  // Un départ seul puis une arrivée plus tard : le séjour qui a une arrivée passe d'abord.
  assert.deepEqual(sejour([t("2026-11-24", "Hotel Sunset → Krabi Airport"), t("2026-11-30", "Krabi Airport → Hotel Palm")], o), { arrivee: "2026-11-30", depart: null, nuits: null });
  // Le jour d'arrivée n'est jamais libre ; un départ seul : au plus 14 jours avant lui.
  assert.equal(joursLibres({ arrivee: "2026-11-25", depart: "2026-11-29" }, { ajd: "2026-11-22" })[0], "2026-11-26");
  const loin = joursLibres({ arrivee: null, depart: "2026-12-30" }, { ajd: "2026-11-22" });
  assert.equal(loin[0], "2026-12-16");
  assert.equal(loin.length, 14);
  // Saison jugée sur les jours libres réels : un séjour d'avril qui finit le 30 sans jour libre en avril n'a pas Koh Rok.
  const rok = [presta("Koh Rok + Koh Haa day trip")];
  const libres = joursLibres({ arrivee: "2027-04-30", depart: "2027-05-05" }, { ajd: "2027-04-20" });
  assert.equal(libres[0], "2027-05-01");
  assert.deepEqual(possibilites(rok, { jours: libres }), []);
  assert.equal(possibilites(rok, { jours: joursLibres({ arrivee: "2027-04-27", depart: "2027-05-05" }, { ajd: "2027-04-20" }) }).length, 1);
});

test("revue n° 5 : une phrase seulement pour un produit relié à une page du site, jamais pour le programme D des éléphants", async () => {
  const { possibilites, messageExcursions, MODELES, phraseDe } = await load();
  const { PRODUITS_SITE } = await import("../src/gestion/js/site-produits.mjs");
  const page = PRODUITS_SITE.find((p) => p.id === "elephant-sanctuary");
  const ligne = (opt) => page.options.find((o) => o.id === opt).tarifs[0];
  const a = ligne("programme-a");
  const d = ligne("programme-d");
  const [xa] = possibilites([presta(a.prestation, { libelle: a.libelle, famille: "activite" })]);
  const [xd] = possibilites([presta(d.prestation, { libelle: d.libelle, famille: "activite" })]);
  assert.equal(phraseDe(xa), MODELES.familles.elephants);
  assert.equal(phraseDe(xd), "");
  assert.doesNotMatch(messageExcursions([xd], { prenom: "Lea" }), /no riding/);
  // Cours de cuisine deviné d'après le libellé, sans page : pas de phrase.
  const [xc] = possibilites([presta("cuisine-x", { libelle: "Dinner class, Single Chef", famille: "activite" })]);
  assert.equal(xc.famille, "cuisine");
  assert.equal(phraseDe(xc), "");
});

test("revue n° 6 : noms sans « co, ltd, tour, travel », jamais le client ni un contact personnel ; copie éteinte si les noms ne sont pas chargés", async () => {
  const { nomsInterdits } = await load();
  const { resteBloque } = await import("../src/gestion/js/agent-calc.mjs");
  const noms = nomsInterdits({
    partenaires: [{ nom: "Blue Ocean Co., Ltd" }, { nom: "Sunny Travel" }],
    conversations: [{ nom: "Mr Brown", type_contact: "partenaire" }, { nom: "Lea", type_contact: "personnel" }, { nom: "Paul", type_contact: "client" }, { nom: "Jade", type_contact: "apporteur" }],
    client: { prenom: "Jade", nom: "Moreau" },
  });
  assert.ok(noms.includes("blue ocean"));
  assert.ok(noms.includes("sunny"));
  assert.deepEqual(resteBloque("Our boat with Blue Ocean leaves at 8", { noms }), ["blue ocean"]);
  assert.ok(!noms.includes("Lea"), "contact personnel");
  assert.ok(!noms.includes("Paul"), "client");
  assert.ok(!noms.includes("Jade"), "le client à qui l'on écrit, même s'il est aussi apporteur");
  assert.deepEqual(resteBloque("Hello Jade, here is an idea", { noms }), []);
  const vue = lire("views/proposer-excursion.mjs");
  assert.match(vue, /nomsInterdits\(\{ partenaires: etat\.brut\.partenaires, conversations: etat\.brut\.whatsapp_conversations, client \}\)/);
  assert.match(vue, /\[secret, taxi\]\.every\(\(e\) => permissionsDe\(e\.id\)\.includes\("partenaires\.lire"\)\)/);
  assert.match(vue, /!Array\.isArray\(etat\.brut\.partenaires\) \|\| !Array\.isArray\(etat\.brut\.whatsapp_conversations\)/);
});

test("revue n° 7 : âges du prix enfant lus dans la ligne enfant seulement", async () => {
  const { possibilites, prixTexte, agesDe } = await load();
  // Prix enfant du champ « Prix enfant » : le libellé adulte n'a pas d'âges d'enfant, même avec des nombres.
  const [x] = possibilites([presta("Program A, 1 hr 30 min to 2 hours", { prix_vente: 1800, details: { enfant: 900 } })], { enfants: 1 });
  assert.equal(prixTexte(x), "1,800 THB per adult, 900 THB per child");
  // Ligne enfant séparée sans âges : « per child ».
  const [y] = possibilites([presta("Mangrove trip", { prix_vente: 1200 }), presta("Mangrove trip, child", { unite: "ch", prix_vente: 800 })], { enfants: 1 });
  assert.equal(prixTexte(y), "1,200 THB per adult, 800 THB per child");
  assert.equal(agesDe({ libelle: "Mangrove trip, child (4-11)" }), "4 to 11");
  assert.equal(agesDe({ libelle: "Trip 2 to 3 hours", enfant_de: "p" }), "");
});

test("revue n° 8 : bouton seulement pour qui écrit dans WhatsApp, jamais Mook ni la lecture seule", () => {
  const vue = lire("views/proposer-excursion.mjs");
  assert.match(vue, /if \(!adminsWhatsApp\(\)\.includes\(dossier\.entite_id\)\) return null;/);
  // adminsWhatsApp : administrateur de Secret ou de Taxi (reglages.ecrire et toute l'entreprise), jamais vouchers.seul.
  assert.match(lire("views/voucher-whatsapp.mjs"), /lecteurWhatsApp\(\{ entite: e, superAdmin: estSuperAdmin\(\), permissions: permissionsDe\(e\.id\), voitTout: voitToutDans\(e\.id\), voucherSeul: permissionsDe\(e\.id\)\.includes\("vouchers\.seul"\) \}\)/);
});

test("noms interdits : partenaires et contacts WhatsApp typés, jamais un client", async () => {
  const { nomsInterdits } = await load();
  assert.deepEqual(nomsInterdits({ partenaires: [{ nom: "Rattana" }, { nom: "AB" }], conversations: [{ nom: "Mr Brown", type_contact: "partenaire" }, { nom: "Lea", type_contact: "client" }, { nom: "Desk", partenaire_id: "p" }] }), ["Rattana", "Mr Brown", "Desk"]);
});

test("écran : bouton sur la fiche du dossier et sur la carte WhatsApp, rien n'est envoyé sans geste, aucun net lu", () => {
  const vue = lire("views/proposer-excursion.mjs");
  assert.match(lire("views/dossier.mjs"), /boutonProposerExcursion\(\{ dossier: d, classe: "secondaire" \}\)/);
  // Jamais en lecture seule (revue de la PR 310, n° 8).
  assert.match(lire("views/whatsapp.mjs"), /dossier && !lectureSeule \? boutonProposerExcursion\(\{ dossier, conversation: c \}\) : null/);
  assert.match(vue, /tr\("Proposer une excursion"\)/);
  // L'envoi part seulement du clic sur « Envoyer dans la conversation », par whatsapp-envoi.
  assert.match(vue, /envoyer\.addEventListener\("click", \(\) => partir\(\)\)/);
  assert.equal((vue.match(/whatsappEnvoyer\(/g) || []).length, 1);
  assert.doesNotMatch(vue + lire("excursion-proposee-calc.mjs"), /_nets|netPrestation|netReservation|\.net\b/);
  // La copie et le lien wa.me sont bloqués tant qu'un nom interdit reste dans le texte.
  assert.match(vue, /resteBloque\(texte, \{ noms \}\)/);
});
