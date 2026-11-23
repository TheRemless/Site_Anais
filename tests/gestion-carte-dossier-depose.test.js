// Carte « dossier » de l'Assistant jusqu'à la réservation (23.11.2026) : un service du catalogue validé par une carte « dossier » gardait le
// pickup et les bagages mais perdait sa dépose (`vers`), que le voucher imprime (details.drop_off). La carte « reservation » la reprenait
// depuis la PR 330. Ici, une carte complète passe par tout le chemin (fonction, propositionDepuisCarte, propositionVersDemande, fiche de
// création, creerDossierExcursions) et chaque champ est comparé à ce que donne la carte « reservation » pour le même service.
// Données inventées : aucun client, hôtel ni partenaire réel.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executer, refDe } from "../supabase/functions/agent/outils.js";
import { tempsSimule } from "../supabase/functions/agent/planifier.js";
import { propositionDepuisCarte, reservationDepuisCarte } from "../src/gestion/js/agent-calc.mjs";
import { propositionVersDemande } from "../src/gestion/js/assistant-calc.mjs";
import { serviceDeLecture, saisieInitiale, entreeParService, champsReservation, boutsDuTrajet } from "../src/gestion/js/creation-voucher-calc.mjs";
import { siegesDemande } from "../src/gestion/js/demande-calc.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const lire = (f) => fs.readFileSync(path.join(ici, "..", f), "utf8");

const PR = "a3000000-0000-4000-8000-000000000031";
const PR2 = "a3000000-0000-4000-8000-000000000032";
const catalogue = {
  partenaires: [],
  prestations: [
    { id: PR, famille: "transfert", groupe: "Taxi", libelle: "Ville Exemple", libelle_en: "Ville Exemple", prix_vente: 2500, unite: "veh", actif: true },
    { id: PR2, famille: "excursion", groupe: "Tour", libelle: "Tour Exemple", libelle_en: "Tour Exemple", prix_vente: 1500, unite: "pp", actif: true },
  ],
  trajets: [],
  clients: [],
  dossiers: [],
  reservations: [],
};
const ctx = (fonctionnement) => ({ charger: async (n) => catalogue[n] || [], reglages: { fonctionnement }, simule: tempsSimule });
const memo = () => ({ prix: new Set(), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes: ["Flight FD3217 tomorrow, drop at Hotel Plage Exemple https://maps.app.goo.gl/exemple1"] });
const REMARQUE = "Driver waits in the lobby with a name sign.";
// Le service du cas réel du 23.11.2026, rendu fictif : un service du catalogue, une dépose d'hôtel (avec le lien Maps lu), 2 bagages.
const service = (o = {}) => ({ texte: "Taxi to Ville Exemple", ref: refDe("P", PR), date: "2026-12-03", heure_pickup: "09:15", lieu_pickup: "Villa Exemple", de: "Koh Exemple", vers: "Hotel Plage Exemple https://maps.app.goo.gl/exemple1", adultes: 2, enfants: 1, sieges: 1, sieges_bebe: 1, sans_siege: false, bagages: 2, prix_saisi: "", vol: "FD3217", remarque_voucher: REMARQUE, note_interne: "", ...o });
const dossierCarte = (services) => ({ titre: "Dossier", client_nom: "Client Exemple", client_telephone: "+41790000000", hotel: "", langue: "en", adultes: 2, enfants: 1, bebes: 1, services, apporteur: "" });
const contexte = { prestations: catalogue.prestations, trajets: [], partenaires: [] };

// Tout le chemin d'une carte « dossier » validée : la fiche (cachée ou « Vérifier avant ») et la réservation créée.
// `bouts` : les deux bouts du trajet du catalogue, que la fiche de Taxi pose dans les champs vides (boutsDuTrajet).
function chemin(donnees, { excursions, taxi = false, bouts = null }) {
  const { d, services } = propositionVersDemande(propositionDepuisCarte(donnees), contexte);
  return services.map((t) => {
    const sv = serviceDeLecture({ ...t, offresIA: t.offres });
    const saisie = saisieInitiale(sv, { d, excursions, sd: siegesDemande(d) });
    if (taxi && bouts) boutsDuTrajet(saisie, bouts, { lieu: true });
    const r = { personnes: { adultes: 2, enfants: 1 }, details: {} };
    return { sv, saisie, reservation: { ...r, ...champsReservation(r, entreeParService(sv, saisie, { garderVol: true })) } };
  });
}

for (const [nom, fonctionnement, excursions, taxi] of [
  ["Taxi", "taxi", true, true],
  ["Secret", "excursions", true, false],
  ["ZTP", "sur_mesure", false, false],
]) {
  test(`${nom} : une carte « dossier » complète arrive champ par champ sur la réservation, comme une carte « reservation »`, async () => {
    const carte = (await executer("proposer_dossier", dossierCarte([service()]), ctx(fonctionnement), memo())).carte;
    const s = carte.donnees.services[0];
    assert.equal(s.vers, "Hotel Plage Exemple", "la fonction retire déjà le lien");
    assert.deepEqual(s.offre, { genre: "prestation", id: PR });
    const [{ saisie, reservation: r }] = chemin(carte.donnees, { excursions, taxi, bouts: { pickup: "Koh Exemple", dropoff: "Ville Exemple" } });
    // « Vérifier avant » : la fiche montre la dépose, le vol, les bagages et la remarque déjà remplis.
    assert.equal(saisie.details.drop_off, "Hotel Plage Exemple");
    assert.equal(saisie.lieu, "Villa Exemple");
    const ajout = reservationDepuisCarte({ ...carte.donnees, service: s });
    // Les sièges ne vont jamais chez ZTP (ses vouchers n'en impriment pas) ; tout le reste, partout.
    const attendu = excursions ? ajout.details : (({ sieges, sieges_bebe, ...reste }) => reste)(ajout.details);
    assert.deepEqual(attendu, { drop_off: "Hotel Plage Exemple", vol: "FD3217", bagages: "2", remarques: REMARQUE, ...(excursions ? { sieges: 1, sieges_bebe: 1 } : {}) });
    for (const cle of ["drop_off", "vol", "bagages", "remarques", "sieges", "sieges_bebe", "sans_siege"]) assert.equal(r.details[cle], attendu[cle], `details.${cle}`);
    assert.equal(r.heure_pickup, ajout.heure_pickup, "heure");
    assert.equal(r.lieu_pickup, ajout.lieu_pickup, "lieu de pickup");
    assert.equal(r.personnes.bebes, 1);
    assert.doesNotMatch(JSON.stringify(r.details), /https?:|goo\.gl|maps\.app/, "aucun lien");
  });
}

test("transfert hors catalogue : la dépose, le pickup précis et les autres champs arrivent aussi sur la réservation", async () => {
  const carte = (await executer("proposer_dossier", dossierCarte([service({ ref: "", texte: "Private transfer" })]), ctx("taxi"), memo())).carte;
  const s = carte.donnees.services[0];
  assert.equal(s.offre, null);
  const [{ sv, reservation: r }] = chemin(carte.donnees, { excursions: true, taxi: true });
  assert.deepEqual(sv.transfertLibre, { de: "Villa Exemple", vers: "Hotel Plage Exemple" }, "le pickup de la carte n'est plus remplacé par la zone de départ");
  const ajout = reservationDepuisCarte({ ...carte.donnees, service: s });
  for (const cle of ["drop_off", "vol", "bagages", "remarques", "sieges", "sieges_bebe"]) assert.equal(r.details[cle], ajout.details[cle], `details.${cle}`);
  assert.equal(r.lieu_pickup, ajout.lieu_pickup);
  assert.equal(r.heure_pickup, ajout.heure_pickup);
});

test("sans lieu de pickup, le départ lu (« de ») devient le pickup ; une ancienne carte avec un lien garde la dépose sans le lien", () => {
  const donnees = { client: { nom: "Client Exemple" }, adultes: 2, services: [{ texte: "Taxi", offre: { genre: "prestation", id: PR }, date: "2026-12-03", heure_pickup: "10:00", lieu_pickup: "", de: "Resort Exemple", vers: "Hotel Plage Exemple https://maps.app.goo.gl/exemple2 www.exemple.test", adultes: 2 }] };
  const [{ saisie, reservation: r }] = chemin(donnees, { excursions: true, taxi: true, bouts: { pickup: "Koh Exemple", dropoff: "Ville Exemple" } });
  assert.equal(saisie.lieu, "Resort Exemple");
  assert.equal(r.details.drop_off, "Hotel Plage Exemple");
  assert.equal(r.lieu_pickup, "Resort Exemple");
  // Sans dépose sur la carte, Taxi garde le bout du trajet du catalogue, comme avant.
  const [{ reservation: r2 }] = chemin({ ...donnees, services: [{ ...donnees.services[0], vers: "" }] }, { excursions: true, taxi: true, bouts: { pickup: "Koh Exemple", dropoff: "Ville Exemple" } });
  assert.equal(r2.details.drop_off, "Ville Exemple");
});

test("carte mixte : chaque dossier lié reçoit la dépose de ses propres services", async () => {
  const carte = (await executer("proposer_dossier", dossierCarte([service(), service({ ref: refDe("P", PR2), texte: "Tour", vers: "Marina Exemple", vol: "", bagages: 0 })]), ctx("excursions"), memo())).carte;
  // L'espace unifié prépare chaque dossier avec ses services (views/agent.mjs, `sous`) : la même fiche, le même chemin.
  assert.match(lire("src/gestion/js/views/agent.mjs"), /const sous = \(e\) => \(\{ \.\.\.c, donnees: \{ \.\.\.donnees, services: e\.services \} \}\);/);
  const [a, b] = carte.donnees.services.map((x) => chemin({ ...carte.donnees, services: [x] }, { excursions: true })[0].reservation);
  assert.equal(a.details.drop_off, "Hotel Plage Exemple");
  assert.equal(b.details.drop_off, "Marina Exemple");
  assert.equal(b.details.vol, undefined);
});

test("la fiche de création passe par les fonctions testées ici", () => {
  const demande = lire("src/gestion/js/views/demande.mjs");
  assert.match(demande, /nouveauService\(serviceDeLecture\(t\)\)/);
  assert.match(demande, /sv\.saisie = saisieInitiale\(sv, \{ d, excursions: modeExcursions\(\), sd: siegesDemande\(d\) \}\);/);
  assert.match(demande, /return entreeParService\(sv, sv\.saisie \|\| saisieVide\(\), \{/);
  assert.match(lire("src/gestion/js/views/creation-excursions.mjs"), /const champs = propre \? champsReservation\(r, propre\) : \{\};/);
});
