// Partenaires et catalogue, lot A de l'audit d'autonomie (16.11.2026, décisions de Jérémy du 17.11.2026).
// Chaque test rejoue un piège de l'audit : son numéro est entre parenthèses.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { filtrerTrajets, proposable, partenaireInactif, lireFenetres, deplacer, utilisations, uniteInitiale, familleInitiale, ligneDepuisPrestation, netDeLigne } from "../src/gestion/js/partenaires-calc.mjs";
import { prestationEnfant, prestationEnfantSeparee, prixEnfantDe, completerEnfant, proposerOffres, lireDemande } from "../src/gestion/js/demande-calc.mjs";
import { PERMISSIONS, TOUTES_PERMISSIONS, DEPENDANCES, ROLES_SYSTEME } from "../src/gestion/js/defauts.mjs";

const lire = (f) => fs.readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");
const AJD = "2026-11-17";

// ---- Partenaire masqué : plus rien de lui n'est proposé (n° 16), mais il se retrouve (n° 5, 6) --------------------------------
const partenaires = [{ id: "actif", nom: "Longtail", actif: true }, { id: "masque", nom: "Old Boat", actif: false }];
const trajets = [
  { id: "t1", partenaire_id: "actif", de: "Koh Lanta", vers: "Koh Phi Phi", depart: "08:00", prix_adulte: 600, actif: true },
  { id: "t2", partenaire_id: "masque", de: "Koh Lanta", vers: "Koh Phi Phi", depart: "09:00", prix_adulte: 500, actif: true },
  { id: "t3", partenaire_id: "actif", de: "Koh Lanta", vers: "Koh Phi Phi", depart: "13:00", prix_adulte: 600, actif: false },
];

test("partenaire masqué : ses trajets et ses tarifs ne se proposent plus (n° 16)", () => {
  assert.equal(partenaireInactif("masque", partenaires), true);
  assert.equal(partenaireInactif("actif", partenaires), false);
  assert.equal(partenaireInactif(null, partenaires), false, "sans partenaire (frais de parc) : rien à masquer");
  assert.equal(proposable({ actif: true, partenaire_id: "masque" }, partenaires), false);
  assert.equal(proposable({ actif: true, partenaire_id: null }, partenaires), true);
  assert.equal(proposable({ actif: false, partenaire_id: "actif" }, partenaires), false);
  assert.deepEqual(filtrerTrajets(trajets, { partenaires }).map((t) => t.id), ["t1"]);
});

test("écran Trajets : la case « Afficher les masqués » rend les trajets masqués et ceux d'un partenaire masqué (n° 6)", () => {
  assert.deepEqual(filtrerTrajets(trajets, { partenaires, avecInactifs: true }).map((t) => t.id), ["t1", "t2", "t3"]);
  const vue = lire("views/trajets.mjs");
  assert.match(vue, /avecInactifs: masques\.checked/);
  assert.match(vue, /class: masque\(t\) \? "inactif" : null/, "les lignes masquées sont grisées");
});

test("liste des partenaires : case « Afficher les partenaires masqués », cartes grisées, réactivation depuis la fiche (n° 5)", () => {
  const vue = lire("views/partenaires.mjs");
  assert.match(vue, /id: "voir-masques"/);
  assert.match(vue, /masque \? "carte inactif" : "carte"/);
  assert.match(vue, /basculerPartenaire\(p, true, rafraichir\)/, "un bouton réactive le partenaire");
  assert.match(lire("views/tarifs.mjs"), /\{nom\} \(masqué\)/, "le filtre Tarifs garde les partenaires masqués, marqués");
});

test("demande collée : un partenaire masqué n'est plus proposé (n° 16)", () => {
  const prestations = [
    { id: "a", partenaire_id: "actif", famille: "excursion", libelle: "4 Islands by longtail", prix_vente: 1200, unite: "pp", actif: true },
    { id: "b", partenaire_id: "masque", famille: "excursion", libelle: "4 Islands by longtail", prix_vente: 900, unite: "pp", actif: true },
  ];
  const d = lireDemande("Hi Secret Travel & Tour!\nI'm interested in a boat tour: 4 Islands by longtail.\nAdults: 2", AJD);
  const ids = (o) => o.map((x) => x.id);
  assert.ok(ids(proposerOffres(d, { prestations, trajets: [] })).includes("b"), "sans la liste des partenaires, comme avant");
  assert.deepEqual(ids(proposerOffres(d, { prestations, trajets: [], partenaires })), ["a"]);
  assert.match(lire("views/demande.mjs"), /partenaires: etat\.db\.partenaires, nomPartenaire/, "l'écran passe les partenaires");
});

// ---- Formulaires ----------------------------------------------------------------------------------------------------
test("« sans unité » reste « sans unité » à la réouverture ; Taxi : transfert par véhicule pour une nouvelle course (n° 11, 20)", () => {
  assert.equal(uniteInitiale({ id: "x", unite: "" }), "", "la prestation « sans unité » ne repasse pas en « par personne »");
  assert.equal(uniteInitiale({ id: "x", unite: null }), "");
  assert.equal(uniteInitiale({ id: "x", unite: "boat" }), "boat");
  assert.equal(uniteInitiale({}), "pp");
  assert.equal(uniteInitiale({}, true), "veh");
  assert.equal(uniteInitiale({ unite: "day" }, true), "day");
  assert.equal(familleInitiale({}), "excursion");
  assert.equal(familleInitiale({}, true), "transfert");
  assert.equal(familleInitiale({ famille: "location" }, true), "location");
});

test("fenêtres de circulation : deux dates par ligne, une erreur dite au lieu d'une ligne ignorée (n° 47)", () => {
  assert.deepEqual(lireFenetres([["2026-11-01", "2027-05-04"], ["", ""]]), { fenetres: [["2026-11-01", "2027-05-04"]], erreur: "", ligne: -1 });
  assert.deepEqual(lireFenetres([]), { fenetres: [], erreur: "", ligne: -1 }, "aucune fenêtre : toute l'année");
  assert.equal(lireFenetres([["2026-11-01", ""]]).erreur, "incomplete");
  assert.equal(lireFenetres([["2026-11-01", "2026-12-01"], ["2027-05-04", "2026-11-01"]]).erreur, "ordre");
  assert.equal(lireFenetres([["2026-11-01", "2026-12-01"], ["2027-05-04", "2026-11-01"]]).ligne, 1);
  assert.equal(lireFenetres([["1 nov", "2026-12-01"]]).erreur, "date");
  assert.match(lire("views/trajets.mjs"), /type: "date"/);
});

test("ordre des tarifs : monter et descendre dans le groupe, anciens ordres égaux renumérotés (n° 82)", () => {
  const g = [{ id: "a", ordre: 3 }, { id: "b", ordre: 4 }, { id: "c", ordre: 5 }];
  assert.deepEqual(deplacer(g, "c", -1), [{ id: "c", ordre: 4 }, { id: "b", ordre: 5 }]);
  assert.deepEqual(deplacer(g, "a", -1), [], "le premier ne monte pas");
  assert.deepEqual(deplacer(g, "c", 1), [], "le dernier ne descend pas");
  const egaux = [{ id: "a", ordre: 0 }, { id: "b", ordre: 0 }, { id: "c" }];
  assert.deepEqual(deplacer(egaux, "a", 1), [{ id: "a", ordre: 1 }, { id: "c", ordre: 2 }], "b garde 0, a passe à 1, c à 2");
});

test("dupliquer une prestation ou un trajet (n° 82)", () => {
  assert.match(lire("views/partenaires.mjs"), /tr\("Dupliquer"\)/);
  assert.match(lire("views/trajets.mjs"), /tr\("Dupliquer"\)/);
});

test("partenaire obligatoire, champs vides, partenaire masqué gardé (n° 17, 60)", () => {
  const p = lire("views/partenaires.mjs");
  assert.match(p, /h\("option", \{ value: "" \}, tr\("Choisir le partenaire"\)\)/);
  assert.match(p, /p\.actif !== false \|\| p\.id === x\.partenaire_id/, "le partenaire masqué de la prestation reste dans le menu");
  const t = lire("views/trajets.mjs");
  assert.match(t, /h\("option", \{ value: "" \}, tr\("Choisir la compagnie"\)\)/);
  assert.match(t, /p\.actif !== false \|\| p\.id === t\.partenaire_id/);
  assert.doesNotMatch(t, /value: t\.mode \|\| "Speedboat"/, "plus de « Speedboat » par défaut");
  assert.doesNotMatch(t, /cie\.firstChild/, "plus de premier partenaire alphabétique par défaut");
});

test("fiche prestation : durée, bateau, frais de parc, moteur, pour qui, tarifs thaïs, prix enfant (n° 7, 18)", () => {
  const p = lire("views/partenaires.mjs");
  for (const id of ["x-duree", "x-bateau", "x-parc", "x-moteur", "x-qui", "x-thai-ad", "x-thai-enf", "x-montant-thai", "x-prix-enf"]) assert.match(p, new RegExp(`"${id}"`), id);
  assert.match(p, /duree: duree\.value\.trim\(\)/);
  assert.match(p, /enfant: nombreOuNul\(prixEnfant\.value\)/);
});

test("téléphones : une ligne par numéro et une vraie case WhatsApp (n° 56)", () => {
  const p = lire("views/partenaires.mjs");
  assert.match(p, /whatsapp: wa\.checked/);
  assert.doesNotMatch(p, /\/whatsapp\|wa\/i\.test/, "plus de lecture du mot « whatsapp » dans une ligne de texte");
});

test("mode de règlement masqué en Taxi, libellé « Masquer » juste (n° 55, 59)", () => {
  const p = lire("views/partenaires.mjs");
  assert.match(p, /taxi \? null : champ\(tr\("Règlement par les clients"\)/);
  assert.match(p, /mode_reglement: taxi \? r\.mode_reglement :/, "le mode enregistré ne change pas en Taxi");
  assert.match(p, /tr\("Proposé pour les nouvelles saisies"\)/);
  assert.doesNotMatch(p, /Proposé dans les factures, les vouchers et les listes/);
});

test("grilles de pickup et points d'embarquement modifiables, heures illisibles refusées (n° 8)", () => {
  const p = lire("views/partenaires.mjs");
  assert.match(p, /export function formulaireEmbarquementPickup/);
  assert.match(p, /regles: \{ \.\.\.r, points_embarquement, pickups \}/);
  assert.match(p, /!heureDeGrille\(v\)/, "une case illisible bloque l'enregistrement");
});

// ---- Prix enfant (décision 7) et net enfant (n° 18, 19) --------------------------------------------------------------
const tour = { id: "tour", partenaire_id: "actif", famille: "excursion", groupe: "Group tours", libelle: "Koh Rok, full day", libelle_en: "Koh Rok, full day", prix_vente: 2000, unite: "pp", actif: true, details: { enfant: 1400 } };
const net = { prestation_id: "tour", net: 1500, net_enfant: 1000 };

test("prix enfant sur la prestation : un tarif enfant à ce prix, même prestation, net enfant utilisé (n° 18, 19)", () => {
  assert.equal(prixEnfantDe(tour), 1400);
  assert.equal(prixEnfantDe({ details: { enfant: "" } }), null);
  assert.equal(prixEnfantDe({ details: { enfant: 0 } }), 0, "0 : enfant gratuit, un vrai prix");
  const e = prestationEnfant(tour, [tour]);
  assert.equal(e.id, "tour", "la même prestation : la réservation garde son tarif");
  assert.equal(e.enfant_de, "tour");
  assert.equal(e.unite, "ch");
  assert.equal(e.prix_vente, 1400);
  const ligne = ligneDepuisPrestation(e, net, { qte: 2 });
  assert.equal(ligne.unite, 1400);
  assert.equal(ligne.net, 1000, "la ligne enfant prend le net enfant, plus le net adulte");
  assert.equal(ligneDepuisPrestation(tour, net, { qte: 2 }).net, 1500, "la ligne adulte garde le net adulte");
  assert.equal(netDeLigne(e, { net: 1500, net_enfant: null }), null, "pas de net enfant connu : pas de net, plutôt que le net adulte");
});

test("prix enfant : le total de l'offre compte les enfants à leur prix ; « par adulte » sans prix enfant est signalé (n° 18)", () => {
  const offre = { genre: "prestation", source: tour, total: 2000 * 3 };
  assert.equal(completerEnfant(offre, { adultes: 2, enfants: 1 }, [tour]).total, 2000 * 2 + 1400);
  const parAdulte = { ...tour, unite: "ad", details: {} };
  assert.equal(completerEnfant({ genre: "prestation", source: parAdulte, total: 4000 }, { adultes: 2, enfants: 1 }, [parAdulte]).avertissement, "enfant_non_compte");
  assert.match(lire("views/demande.mjs"), /enfant_non_compte: N_\(/, "l'avertissement a son texte");
});

test("prix enfant : les prestations enfant séparées existantes continuent de marcher (décision 7)", () => {
  const adulte = { ...tour, details: {} };
  const enfant = { id: "tour-enf", partenaire_id: "actif", famille: "excursion", groupe: "Group tours", libelle: "Koh Rok, child", prix_vente: 1200, unite: "ch", actif: true };
  assert.equal(prestationEnfant(adulte, [adulte, enfant]).id, "tour-enf");
  assert.equal(prestationEnfantSeparee(adulte, [adulte, enfant]).id, "tour-enf");
  assert.equal(prestationEnfant(tour, [tour, enfant]).id, "tour", "le champ « Prix enfant » l'emporte quand il est rempli");
  assert.equal(prestationEnfant({ ...tour, sur_place: true }, [tour]), null, "un frais réglé sur place garde son prix enfant dans sa note");
  assert.equal(prestationEnfant({ ...tour, unite: "boat" }, [tour]), null, "pas de tarif enfant pour un prix au bateau");
});

// ---- Suppression : refusée si utilisée, droit séparé (n° 14, 15) ----------------------------------------------------
test("utilisations : services d'un partenaire, directs ou par ses tarifs et trajets (n° 14, 15)", () => {
  const db = {
    prestations: [{ id: "p1", partenaire_id: "A" }, { id: "p2", partenaire_id: "B" }],
    trajets: [{ id: "t1", partenaire_id: "A" }],
    reservations: [{ id: "r1", partenaire_id: null, prestation_id: "p1" }, { id: "r2", partenaire_id: "A" }, { id: "r3", trajet_id: "t1" }, { id: "r4", prestation_id: "p2", partenaire_id: "B" }],
  };
  assert.equal(utilisations({ partenaire: { id: "A" } }, db), 3);
  assert.equal(utilisations({ partenaire: { id: "C" } }, db), 0);
  assert.equal(utilisations({ prestation: { id: "p1" } }, db), 1);
  assert.equal(utilisations({ trajet: { id: "t1" } }, db), 1);
  assert.equal(utilisations({ prestation: { id: "p9" } }, db), 0);
});

test("droit « partenaires.supprimer » : séparé, dans Administrateur, pas dans l'Éditeur (n° 14, décision 3)", () => {
  assert.ok(PERMISSIONS.some((p) => p.code === "partenaires.supprimer"));
  assert.ok(TOUTES_PERMISSIONS.includes("partenaires.supprimer"));
  assert.deepEqual(DEPENDANCES["partenaires.supprimer"], ["partenaires.lire", "partenaires.ecrire"]);
  assert.ok(ROLES_SYSTEME.find((r) => r.nom === "Administrateur").permissions.includes("partenaires.supprimer"));
  assert.ok(!ROLES_SYSTEME.find((r) => r.nom === "Éditeur").permissions.includes("partenaires.supprimer"));
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-31-partenaires-supprimer.sql", import.meta.url), "utf8");
  for (const t of ["partenaires", "prestations", "trajets"]) assert.match(sql, new RegExp(`on ${t} as restrictive for delete to authenticated using \\(a_permission\\(entite_id, 'partenaires\\.supprimer'\\)\\)`));
});

test("suppression : bouton réservé au droit, refusée si utilisée avec « Masquer » proposé, confirmation qui dit tout (n° 14, 15)", () => {
  const p = lire("views/partenaires.mjs");
  assert.match(p, /peut\("partenaires\.supprimer"\) \? h\("button", \{ class: "lien danger-texte"/);
  assert.match(p, /x\.id && peut\("partenaires\.supprimer"\) \? h\("button", \{ class: "danger"/);
  assert.doesNotMatch(p, /Les devis déjà créés ne changent pas/, "l'ancienne confirmation trompeuse a disparu");
  assert.match(p, /utilisations\(\{ partenaire: p \}, etat\.db\)/);
  assert.match(p, /utilisations\(\{ prestation: x \}, etat\.db\)/);
  const t = lire("views/trajets.mjs");
  assert.match(t, /t\.id && peut\("partenaires\.supprimer"\)/);
  assert.match(t, /utilisations\(\{ trajet: t \}, etat\.db\)/);
});

test("choix des services : tarifs masqués écartés, « prix à saisir » marqué (n° 16, 21)", () => {
  const c = lire("views/choix-prestation.mjs");
  assert.match(c, /proposable\(x, etat\.db\.partenaires\)/);
  assert.match(c, /partenaires: etat\.db\.partenaires \}\)/, "les trajets aussi");
  assert.match(c, /tr\("prix à saisir"\)/);
});
