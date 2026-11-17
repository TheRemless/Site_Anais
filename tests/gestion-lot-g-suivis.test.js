// Lot G (17.11.2026) : feuille du jour, « À vérifier », rappels sur téléphone. Les écrans (tâches, journal) se vérifient en démo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { feuilleJour, alertesFeuille, texteFeuillePartage } from "../src/gestion/js/feuille-calc.mjs";
import { construireCopie } from "../src/gestion/js/feuille-hors-ligne-calc.mjs";
import { aVerifier, reglageAVerifier, CONTROLES, REGLAGE_A_VERIFIER } from "../src/gestion/js/a-verifier-calc.mjs";
import { rappelVeille, rappelLendemain, heuresRappels, entitesDuRappel, restreindre, heureBangkok, HEURES_DEFAUT } from "../supabase/functions/rappels/calc.js";
import { heuresRappels as heuresOutil, HEURES_RAPPELS } from "../src/gestion/js/rappels-etat.mjs";

// ---- Feuille du jour (audit n° 29) ----------------------------------------------------------------------------
const clients = { c1: { prenom: "Emma", nom: "Moreau", telephone: "+41 79", adresse: "Hotel Sunset, Room 12" }, c2: { prenom: "Ben", nom: "Walker", telephone: "", adresse: "" } };
const dossierDe = { d1: "c1", d2: "c2", d3: "c1" };
const contexte = { client: (r) => clients[dossierDe[r.dossier_id]] || null, partenaire: (id) => ({ p1: "Van démo", p2: "Scooters démo" })[id] || "" };
const resas = [
  { id: "t1", dossier_id: "d1", partenaire_id: "p1", libelle: "Airport → Lanta", date_service: "2026-11-20", heure_pickup: "08:00", lieu_pickup: "Krabi Airport", personnes: { adultes: 2 }, statut: "confirme", details: { drop_off: "Hotel Sunset", vol: "FD 3217" } },
  { id: "t2", dossier_id: "d2", partenaire_id: "p1", libelle: "Round trip from Saladan: Old Town", date_service: "2026-11-20", heure_pickup: "10:00", lieu_pickup: "Saladan", personnes: { adultes: 1 }, statut: "confirme", details: { type_trajet: "retour_depart", programme_trajet: "Old Town", drop_off: "ne doit pas sortir" } },
  { id: "l1", dossier_id: "d1", partenaire_id: "p2", libelle: "Scooter 125cc", date_service: "2026-11-20", heure_pickup: "09:00", lieu_pickup: "", personnes: { adultes: 1 }, statut: "confirme", details: { retour_date: "2026-11-23", retour_heure: "17:00", retour_lieu: "Shop Saladan" } },
  { id: "l2", dossier_id: "d2", partenaire_id: "p2", libelle: "Scooter sans heure de retour", date_service: "2026-11-21", heure_pickup: "", lieu_pickup: "", personnes: { adultes: 1 }, statut: "confirme", details: { retour_date: "2026-11-22" } },
  { id: "x1", dossier_id: "d3", partenaire_id: "p2", libelle: "Location d'un dossier annulé", date_service: "2026-11-19", personnes: { adultes: 1 }, statut: "confirme", details: { retour_date: "2026-11-25" } },
  { id: "x2", dossier_id: "d1", partenaire_id: "p2", libelle: "Location annulée", date_service: "2026-11-19", personnes: { adultes: 1 }, statut: "annule", details: { retour_date: "2026-11-25" } },
];
const annules = new Set(["d3"]);
const lignes = (date) => feuilleJour(resas, date, contexte, annules).flatMap((g) => g.lignes.map((l) => ({ ...l, groupe: g.nom })));

test("feuille : un transfert garde son drop-off et son vol ; un retour au point de départ n'a pas de drop-off", () => {
  const l = lignes("2026-11-20");
  const t1 = l.find((x) => x.id === "t1");
  assert.equal(t1.sorte, "pickup");
  assert.equal(t1.precision, "Drop-off: Hotel Sunset · Flight FD 3217");
  assert.equal(l.find((x) => x.id === "t2").precision, "", "le programme est déjà dans « trajet »");
  const texte = texteFeuillePartage(feuilleJour(resas, "2026-11-20", contexte, annules).find((g) => g.nom === "Van démo"), "2026-11-20");
  assert.match(texte, /08:00 · Airport → Lanta · Emma Moreau · \+41 79 · Krabi Airport · Drop-off: Hotel Sunset · Flight FD 3217 · 2 adults/);
  assert.doesNotMatch(texte, /ne doit pas sortir/);
});

test("feuille : une location de plusieurs jours paraît chaque jour, avec une ligne « Return » le jour du retour", () => {
  assert.equal(lignes("2026-11-20").find((x) => x.id === "l1").precision, "Return 23 November 2026 17:00", "le jour de la prise, la date de retour");
  const j2 = lignes("2026-11-21").find((x) => x.id === "l1");
  assert.equal(j2.sorte, "en_cours");
  assert.equal(j2.precision, "Ongoing rental, day 2 of 4, return 23 November 2026");
  assert.equal(lignes("2026-11-22").find((x) => x.id === "l1").sorte, "en_cours");
  const retour = lignes("2026-11-23").find((x) => x.id === "l1");
  assert.deepEqual([retour.sorte, retour.heure, retour.hotel, retour.groupe], ["retour", "17:00", "Shop Saladan", "Scooters démo"]);
  assert.equal(lignes("2026-11-24").find((x) => x.id === "l1"), undefined, "après le retour, plus rien");
  // Sans lieu de retour : celui de la prise (ici l'hôtel du client, faute de lieu de pickup).
  const l2 = lignes("2026-11-22").find((x) => x.id === "l2");
  assert.deepEqual([l2.sorte, l2.heure, l2.hotel], ["retour", "", ""]);
  assert.equal(lignes("2026-11-23").find((x) => x.id === "l1").chambre, "");
});

test("feuille : dossiers annulés et services annulés restent dehors, même pendant leur location", () => {
  for (const d of ["2026-11-19", "2026-11-21", "2026-11-25"]) assert.ok(!lignes(d).some((x) => x.id === "x1" || x.id === "x2"), d);
});

test("feuille : le retour et les jours de location ne sont pas des pickups à compléter ; le texte dit RETURN et ne compte pas 0 passager", () => {
  const groupes = feuilleJour(resas, "2026-11-22", contexte, annules);
  assert.deepEqual(alertesFeuille(groupes), [], "l2 (retour sans heure) et l1 (en cours) ne sont pas des pickups");
  const texte = texteFeuillePartage(groupes.find((g) => g.nom === "Scooters démo"), "2026-11-22").split("\n");
  assert.equal(texte[0], "Scooters démo: 22 November 2026");
  assert.ok(texte.includes("time TBC · RETURN · Scooter sans heure de retour · Ben Walker · place TBC · 1 adult"), texte.join("\n"));
  assert.ok(texte.some((l) => l.startsWith("Scooter 125cc · Emma Moreau · +41 79 · Ongoing rental, day 3 of 4")), texte.join("\n"));
  // Le jour de la prise, l2 sans heure est bien un pickup à compléter.
  assert.deepEqual(alertesFeuille(feuilleJour(resas, "2026-11-21", contexte, annules)).map((a) => a.id), ["l2"]);
});

test("feuille hors ligne : le retour et la précision partent sur le téléphone, toujours sans montant", () => {
  const brut = {
    clients: [{ id: "c1", prenom: "Emma", nom: "Moreau", adresse: "Hotel Sunset" }],
    dossiers: [{ id: "d1", entite_id: "e1", client_id: "c1", annule: false }],
    partenaires: [],
    reservations: [{ id: "l1", entite_id: "e1", dossier_id: "d1", libelle: "Scooter", date_service: "2026-11-19", personnes: { adultes: 1 }, statut: "confirme", montant_vente: 900, details: { retour_date: "2026-11-21", retour_heure: "16:00" } }],
  };
  const c = construireCopie({ brut, entites: [{ id: "e1", nom: "Secret" }], utilisateur: "u", aujourdhui: "2026-11-20" });
  const [auj, dem] = c.entreprises[0].jours;
  assert.deepEqual([auj.groupes[0].lignes[0].sorte, auj.groupes[0].lignes[0].precision], ["en_cours", "Ongoing rental, day 2 of 3, return 21 November 2026"]);
  assert.deepEqual([dem.groupes[0].lignes[0].sorte, dem.groupes[0].lignes[0].heure], ["retour", "16:00"]);
  assert.ok(!JSON.stringify(c).includes("900"));
  assert.match(fs.readFileSync("src/gestion/hors-ligne.mjs", "utf8"), /l\.precision/, "la page hors connexion affiche la précision");
});

test("feuille du jour : plus d'envoi vers le prestataire (décision du 17.11.2026)", () => {
  const vue = fs.readFileSync("src/gestion/js/views/feuille-jour.mjs", "utf8");
  assert.doesNotMatch(vue, /lienWhatsApp|telWhatsApp|Envoyer à/);
});

// ---- « À vérifier » (audit n° 45, 52, section 2) --------------------------------------------------------------
const base = () => ({
  partenaires: [{ id: "p1", nom: "Van démo", actif: true, contact: { telephones: [{ numero: "+66 81 000 0001", whatsapp: true }] } }],
  dossiers: [
    { id: "d1", ref: "S-1", client_id: "c1", responsable_id: "u", annule: false },
    { id: "d2", ref: "S-2", client_id: "c2", responsable_id: "u", annule: false },
    { id: "d3", ref: "S-3", client_id: "c1", responsable_id: "u", annule: true },
  ],
  clients: [
    { id: "c1", prenom: "Emma", nom: "Moreau", telephone: "+41 79 123 45 67", email: "", adresse: "Hotel Sunset" },
    { id: "c2", prenom: "Ben", nom: "Walker", telephone: "", email: "ben@x.ch", adresse: "" },
    { id: "c3", prenom: "Emma", nom: "MOREAU", telephone: "079 123 45 67", email: "", adresse: "" },
    { id: "c4", prenom: "B.", nom: "W", telephone: "", email: "Ben@X.ch ", adresse: "" },
    { id: "c5", prenom: "", nom: "Seule", telephone: "", email: "seule@x.ch", adresse: "" },
  ],
  reservations: [
    { id: "r1", dossier_id: "d1", partenaire_id: "p1", libelle: "Complet", date_service: "2026-11-18", heure_pickup: "08:00", lieu_pickup: "", montant_vente: 1000, statut: "confirme" },
    { id: "r2", dossier_id: "d2", partenaire_id: "p1", libelle: "Sans rien", date_service: "2026-11-19", heure_pickup: "", lieu_pickup: "", montant_vente: null, statut: "confirme" },
    { id: "r3", dossier_id: "d2", partenaire_id: "p1", libelle: "Offert et payé sur place", date_service: "2026-11-20", heure_pickup: "09:00", lieu_pickup: "Pier", montant_vente: 0, paye_sur_place: true, statut: "confirme" },
    { id: "r4", dossier_id: "d2", partenaire_id: "p1", libelle: "Loin", date_service: "2026-12-30", heure_pickup: "", lieu_pickup: "", montant_vente: 500, statut: "confirme" },
    { id: "r5", dossier_id: "d2", partenaire_id: "p1", libelle: "Passé", date_service: "2026-11-10", heure_pickup: "", montant_vente: null, statut: "confirme" },
    { id: "r6", dossier_id: "d3", partenaire_id: "p1", libelle: "Dossier annulé", date_service: "2026-11-19", heure_pickup: "", montant_vente: null, statut: "confirme" },
    { id: "r7", dossier_id: "d2", partenaire_id: "p1", libelle: "Service annulé", date_service: "2026-11-19", heure_pickup: "", montant_vente: null, statut: "annule" },
    { id: "r8", dossier_id: "d2", partenaire_id: null, libelle: "Frais de parc", date_service: "2026-11-19", heure_pickup: "", montant_vente: null, statut: "confirme" },
    { id: "r9", dossier_id: "d2", partenaire_id: null, libelle: "Service de l'agence", date_service: "2026-11-19", heure_pickup: "07:00", lieu_pickup: "Office", montant_vente: 300, statut: "confirme" },
  ],
  reservations_nets: [{ reservation_id: "r1", net_prevu: 700 }, { reservation_id: "r3", net_prevu: null, commission_prevue: null }, { reservation_id: "r4", net_prevu: 400 }],
});
const tous = { partenaires: true, dossiers: true, clients: true, nets: true };
const ids = (l, cle) => ((l.find((c) => c.cle === cle) || { elements: [] }).elements).map((x) => x.id);

test("à vérifier : services à venir sans heure ou lieu (jours proches), sans prix (tous), hors annulés, passés et frais de parc", () => {
  const l = aVerifier(base(), { droits: tous, aujourdhui: "2026-11-17" });
  assert.deepEqual(ids(l, "services_sans_heure"), ["r2"], "r4 est au-delà de 7 jours ; r5 passé, r6 dossier annulé, r7 annulé, r8 frais de parc");
  assert.deepEqual(ids(l, "services_sans_lieu"), ["r2"], "r1 prend l'hôtel de la fiche client");
  assert.deepEqual(ids(l, "services_sans_prix"), ["r2"], "un prix à 0 (offert) n'est pas un prix vide");
  const loin = aVerifier(base(), { droits: tous, aujourdhui: "2026-11-17", reglage: { horizon_jours: 60 } });
  assert.deepEqual(ids(loin, "services_sans_heure"), ["r2", "r4"]);
  const el = l.find((c) => c.cle === "services_sans_heure").elements[0];
  assert.equal(el.lien, "#/dossier/d2");
  assert.match(el.texte, /^S-2 · Sans rien$/);
  assert.match(el.detail, /19 .*2026 · Ben Walker/);
});

test("à vérifier : net si payé chez nous, commission si payé sur place, jamais sans partenaire, ni en Taxi, ni sans le droit « nets »", () => {
  const l = aVerifier(base(), { droits: tous, aujourdhui: "2026-11-17" });
  assert.deepEqual(ids(l, "services_sans_net"), ["r2"], "r1 et r4 ont un net ; r9 n'a pas de partenaire");
  assert.deepEqual(ids(l, "services_sans_commission"), ["r3"]);
  for (const opts of [{ droits: { ...tous, nets: false } }, { droits: tous, taxi: true }]) {
    const x = aVerifier(base(), { ...opts, aujourdhui: "2026-11-17" });
    assert.ok(!x.some((c) => c.cle === "services_sans_net" || c.cle === "services_sans_commission"));
  }
  assert.ok(!JSON.stringify(l).includes("700"), "aucun net dans ce qui s'affiche");
});

test("à vérifier : clients en double par téléphone (indicatif ou non), e-mail ou nom, à relire", () => {
  const l = aVerifier(base(), { droits: tous, aujourdhui: "2026-11-17" });
  const doubles = l.find((c) => c.cle === "clients_en_double");
  assert.equal(doubles.aRelire, true);
  assert.deepEqual(doubles.elements.map((e) => e.texte).sort(), ["B. W / Ben Walker".split(" / ").reverse().join(" / "), "Emma Moreau / Emma MOREAU"].sort());
  assert.match(doubles.elements.find((e) => e.id === "c1").detail, /même téléphone, même nom/);
  assert.equal(doubles.elements.find((e) => e.id === "c2").detail, "même e-mail");
  assert.ok(!aVerifier(base(), { droits: { ...tous, clients: false }, aujourdhui: "2026-11-17" }).some((c) => c.cle === "clients_en_double"));
});

test("à vérifier : les réglages coupent un contrôle et changent les seuils ; une valeur absente ou fausse reprend le défaut", () => {
  assert.deepEqual(reglageAVerifier(undefined), REGLAGE_A_VERIFIER);
  assert.deepEqual(reglageAVerifier({ ecart_duree_min: "45", chiffres_telephone: 0, lignes_max: "abc", horizon_jours: 3, desactives: ["services_sans_lieu", "inconnu"] }), { ecart_duree_min: 45, chiffres_telephone: 6, lignes_max: 100, horizon_jours: 3, desactives: ["services_sans_lieu"] });
  const l = aVerifier(base(), { droits: tous, aujourdhui: "2026-11-17", reglage: { desactives: ["services_sans_lieu", "clients_en_double"] } });
  assert.ok(!l.some((c) => c.cle === "services_sans_lieu" || c.cle === "clients_en_double"));
  assert.ok(l.some((c) => c.cle === "services_sans_heure"));
  // Seuil de l'écart de durée : 60 minutes d'écart passent sous un seuil de 90.
  const trajets = { ...base(), trajets: [{ id: "t", de: "A", vers: "B", depart: "10:00", arrivee: "12:00", duree: "1 h", prix_adulte: 1, actif: true }] };
  assert.deepEqual(ids(aVerifier(trajets, { droits: tous, aujourdhui: "2026-11-17" }), "trajets_duree"), ["t"]);
  assert.deepEqual(ids(aVerifier(trajets, { droits: tous, aujourdhui: "2026-11-17", reglage: { ecart_duree_min: 90 } }), "trajets_duree"), []);
  // Chaque contrôle calculé figure dans la liste réglable, et chacun a son titre à l'écran.
  const vue = fs.readFileSync("src/gestion/js/views/a-verifier.mjs", "utf8");
  for (const c of CONTROLES) assert.match(vue, new RegExp(`^\\s+${c}: \\[N_\\(`, "m"), c);
  assert.match(fs.readFileSync("src/gestion/js/a-verifier-calc.mjs", "utf8"), /prestations_sur_place_hors_frais[\s\S]*notes_sur_place_hors_frais[\s\S]*factures_differentes_reservation/, "les trois contrôles de la PR 203 restent");
});

test("à vérifier : l'aide des partenaires sans WhatsApp ne parle plus du message de demande", () => {
  assert.doesNotMatch(fs.readFileSync("src/gestion/js/views/a-verifier.mjs", "utf8"), /message de demande/);
});

// ---- Rappels (audit n° 76, section 2) -------------------------------------------------------------------------
const R = [
  { entite_id: "S", dossier_id: "d1", statut: "confirme", heure_pickup: "08:00", lieu_pickup: "Pier", date_service: "2026-11-10" },
  { entite_id: "S", dossier_id: "d2", statut: "confirme", heure_pickup: "", lieu_pickup: "", adresse_client: "Hotel Sunset", date_service: "2026-11-10" },
  { entite_id: "T", dossier_id: "d3", statut: "confirme", heure_pickup: "09:00", lieu_pickup: " ", adresse_client: "", date_service: "2026-11-10" },
  { entite_id: "T", dossier_id: "d4", statut: "confirme", heure_pickup: "09:00", date_service: "2026-11-09" },
];

test("rappel de la veille : sans heure et sans lieu (l'hôtel du client compte comme lieu), en français ou en anglais", () => {
  assert.equal(rappelVeille(R, "2026-11-10", { entiteIds: ["S"] }).corps, "1 sans heure de pickup.", "d2 a l'hôtel du client");
  assert.equal(rappelVeille(R, "2026-11-10", { entiteIds: ["T"] }).corps, "1 sans lieu de pickup.", "un lieu fait d'espaces est vide");
  const en = rappelVeille(R, "2026-11-10", { entiteIds: null, langue: "en", nomEntite: (id) => id });
  assert.equal(en.titre, "3 services tomorrow");
  assert.equal(en.corps, "S 2, T 1. 1 without a pickup time, 1 without a pickup place.");
  assert.equal(rappelVeille(R, "2026-11-10", { entiteIds: ["S"], ecartes: new Set(["d2"]), langue: "en" }).corps, "Every pickup has a time and a place.");
  assert.equal(rappelLendemain(R, "2026-11-09", { entiteIds: null, langue: "en" }).titre, "1 client to contact again");
  assert.equal(rappelLendemain(R, "2026-11-09", { entiteIds: null, langue: "xx" }).titre, "1 client à recontacter", "langue inconnue : français");
});

test("heures des rappels : 18 h et 9 h par défaut, réglables par entreprise, coupées avec null", () => {
  assert.deepEqual(HEURES_DEFAUT, { veille: 18, lendemain: 9 });
  assert.deepEqual(heuresRappels(undefined), { veille: 18, lendemain: 9 });
  assert.deepEqual(heuresRappels({ veille: 19, lendemain: null }), { veille: 19, lendemain: null });
  assert.deepEqual(heuresRappels({ veille: 24, lendemain: "7" }), { veille: 18, lendemain: 7 }, "hors limites : le défaut");
  const reglages = { S: { veille: 19 }, T: { veille: null }, Z: undefined };
  assert.deepEqual(entitesDuRappel("veille", 19, ["S", "T", "Z"], reglages), ["S"]);
  assert.deepEqual(entitesDuRappel("veille", 18, ["S", "T", "Z"], reglages), ["Z"]);
  assert.deepEqual(entitesDuRappel("lendemain", 9, ["S", "T", "Z"], reglages), ["S", "T", "Z"]);
  assert.deepEqual(entitesDuRappel("veille", null, ["S", "T", "Z"], reglages), ["S", "Z"], "envoi forcé : toutes sauf celles où le rappel est coupé");
  assert.deepEqual(restreindre(null, ["S"]), ["S"]);
  assert.deepEqual(restreindre(["S", "T"], ["T", "Z"]), ["T"]);
  assert.equal(heureBangkok(new Date("2026-11-09T11:00:00Z")), 18);
  assert.equal(heureBangkok(new Date("2026-11-09T17:30:00Z")), 0);
});

test("heures des rappels : l'outil et la fonction lisent le réglage de la même façon", () => {
  assert.deepEqual(HEURES_RAPPELS, HEURES_DEFAUT);
  for (const r of [undefined, null, {}, { veille: 0 }, { veille: null, lendemain: 23 }, { veille: "x", lendemain: -1 }, { veille: false }, { veille: "" }]) assert.deepEqual(heuresOutil(r), heuresRappels(r), JSON.stringify(r));
});

test("fonction rappels : appel horaire « auto », lieu et langue lus, entreprises restreintes", () => {
  const index = fs.readFileSync("supabase/functions/rappels/index.ts", "utf8");
  assert.match(index, /demande\.type !== "auto"/);
  assert.match(index, /lieu_pickup/);
  assert.match(index, /super_admin, langue/);
  assert.match(index, /\.in\("entite_id", retenues\)/);
});

// ---- Tâches, contrats, journal (audit n° 58, 77, 78, 83) : écrans, vérifiés aussi en démo -------------------------
test("tâches : un dossier annulé sort des listes de travail ; une tâche se modifie en place", () => {
  const vue = fs.readFileSync("src/gestion/js/views/taches.mjs", "utf8");
  assert.match(vue, /export const tacheActive = \(t, annules\) => !t\.fait && !\(t\.dossier_id && annules\.has\(t\.dossier_id\)\)/);
  assert.match(vue, /function modifierTache\(t\)/);
  assert.match(vue, /modifier\("taches", t\.id, \{ titre: .*description: .*echeance: .*assignee_id: /);
});

test("rappel « Contrats à renouveler » : jamais en Taxi", () => {
  assert.match(fs.readFileSync("src/gestion/js/views/dashboard.mjs", "utf8"), /moduleActif\("partenaires"\) && !modeTaxi\(\) \? contratsAEcheance/);
});

test("journal : réservations, partenaires, prestations, trajets, et nets seulement avec le droit", () => {
  const vue = fs.readFileSync("src/gestion/js/views/journal.mjs", "utf8");
  for (const t of ["reservations", "reservations_nets", "partenaires", "prestations", "trajets"]) assert.match(vue, new RegExp(`\\["${t}", N_\\(`));
  assert.match(vue, /"reservations_nets" \? moduleActif\("partenaires"\) && peut\("partenaires\.nets"\)/);
  const sql = fs.readFileSync("docs/gestion/migration-37-journal-nets.sql", "utf8");
  assert.match(sql, /create trigger journaliser after insert or update or delete on reservations_nets/);
  assert.match(sql, /table_name <> 'reservations_nets' or a_permission\(entite_id, 'partenaires\.nets'\)/);
});

test("à vérifier : les contrôles sortent dans l'ordre de l'écran de réglage", () => {
  const l = aVerifier(base(), { droits: tous, aujourdhui: "2026-11-17" }).map((c) => CONTROLES.indexOf(c.cle));
  assert.deepEqual(l, [...l].sort((a, b) => a - b));
  assert.equal(aVerifier(base(), { droits: tous, aujourdhui: "2026-11-17" })[0].cle, "services_sans_heure");
});
