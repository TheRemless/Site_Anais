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

test("message : anglais, prénom, service, prix, modèle de la famille, page du site ; aucune signature", async () => {
  const { possibilites, messageExcursions, MODELES } = await load();
  // Sans page du site : le libellé du catalogue, sans lien.
  const P = [presta("cd-x", { libelle: "Elephant sanctuary, half day", famille: "activite", prix_vente: 2500 })];
  const [x] = possibilites(P);
  const texte = messageExcursions([x], { prenom: "Mark" });
  assert.equal(
    texte,
    [
      "Hello Mark, since you're staying a few days, here is an idea for a day out.",
      `*Elephant sanctuary, half day*\n2,500 THB per person\n${MODELES.familles.elephants}`,
      "If it tempts you, tell me which day and how many people, and I'll check availability 😊",
    ].join("\n\n")
  );
  assert.doesNotMatch(texte, /Nani|Anaïs|Best|Regards|Cheers|net|commission/i);
});

test("message pour un client de Taxi : Secret se présente avec son site, deux idées", async () => {
  const { possibilites, messageExcursions, choixParDefaut } = await load();
  const liste = possibilites([presta("4 Islands by longtail"), presta("Thai cooking class", { famille: "activite" })]);
  const texte = messageExcursions(liste.filter((x) => choixParDefaut(liste).includes(x.prestation.id)), { prenom: "Ben", taxi: true });
  assert.match(texte, /^Hello Ben, we also organise day trips and activities through Secret Travel & Tour \(secrettravelandtour\.com\)\. Since you're staying a few days, here are two ideas\./);
  assert.match(texte, /If one of them tempts you/);
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

test("noms interdits : partenaires et contacts WhatsApp typés, jamais un client", async () => {
  const { nomsInterdits } = await load();
  assert.deepEqual(nomsInterdits({ partenaires: [{ nom: "Rattana" }, { nom: "AB" }], conversations: [{ nom: "Mr Brown", type_contact: "chauffeur" }, { nom: "Lea", type_contact: "client" }, { nom: "Desk", partenaire_id: "p" }] }), ["Rattana", "Mr Brown", "Desk"]);
});

test("écran : bouton sur la fiche du dossier et sur la carte WhatsApp, rien n'est envoyé sans geste, aucun net lu", () => {
  const vue = lire("views/proposer-excursion.mjs");
  assert.match(lire("views/dossier.mjs"), /boutonProposerExcursion\(\{ dossier: d, classe: "secondaire" \}\)/);
  assert.match(lire("views/whatsapp.mjs"), /dossier \? boutonProposerExcursion\(\{ dossier, conversation: c \}\) : null/);
  assert.match(vue, /tr\("Proposer une excursion"\)/);
  // L'envoi part seulement du clic sur « Envoyer dans la conversation », par whatsapp-envoi.
  assert.match(vue, /envoyer\.addEventListener\("click", \(\) => partir\(\)\)/);
  assert.equal((vue.match(/whatsappEnvoyer\(/g) || []).length, 1);
  assert.doesNotMatch(vue + lire("excursion-proposee-calc.mjs"), /_nets|netPrestation|netReservation|\.net\b/);
  // La copie et le lien wa.me sont bloqués tant qu'un nom interdit reste dans le texte.
  assert.match(vue, /resteBloque\(texte, \{ noms \}\)/);
});
