// « Calculer le devis » sur la carte du dossier (22.11.2026) : véhicules selon la capacité du catalogue, prix de vente seulement, prix accepté
// dans la conversation avant le catalogue (PR 306 et 307), réponse anglaise sans signature. Calcul en code, sans IA.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { devisPossible, calculerDevis, reponseDevis, capaciteDe, netsDuDevis, motVehicule } from "../src/gestion/js/devis-calc.mjs";
import { resteBloque } from "../src/gestion/js/agent-calc.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const lire = (f) => fs.readFileSync(path.join(ici, "..", "src", "gestion", "js", f), "utf8");

const partenaires = [{ id: "pa1", nom: "Transports Démo", actif: true }];
const prestations = [
  { id: "van", partenaire_id: "pa1", famille: "transfert", groupe: "Private minivan", libelle: "Minivan privé Krabi Airport → Koh Lanta", libelle_en: "Private minivan: Krabi Airport → Koh Lanta", prix_vente: 2500, unite: "veh", details: { capacite: "1 to 9 people" }, actif: true },
  { id: "van-retour", partenaire_id: "pa1", famille: "transfert", groupe: "Private minivan", libelle: "Minivan privé Koh Lanta → Krabi Airport", libelle_en: "Private minivan: Koh Lanta → Krabi Airport", prix_vente: 2300, unite: "veh", details: { capacite: "Up to 9 people" }, actif: true },
  { id: "van-sans-cap", partenaire_id: "pa1", famille: "transfert", groupe: "Private minivan", libelle: "Minivan privé Koh Lanta → Phuket Airport", libelle_en: "Private minivan: Koh Lanta → Phuket Airport", prix_vente: 4500, unite: "veh", details: { note: "Child seat provided free. Price for 1 to 2 guests. Ferry crossing included up to 4 people, 60 per person from the 5th." }, actif: true },
  { id: "bateau", partenaire_id: "pa1", famille: "excursion", groupe: "Private longtail", libelle: "Koh Rok en longtail privé", libelle_en: "Koh Rok by private longtail", prix_vente: 6500, unite: "boat", details: { capacite: "1 à 6 personnes" }, actif: true },
  { id: "groupe", partenaire_id: "pa1", famille: "excursion", groupe: "Private speedboat", libelle: "Speedboat privé, journée", libelle_en: "Private speedboat, custom day", prix_vente: 18000, unite: "grp", details: { capacite: "10 passengers plus crew" }, actif: true },
  { id: "join", partenaire_id: "pa1", famille: "excursion", groupe: "Join tour", libelle: "4 îles en groupe", libelle_en: "4 Islands join tour", prix_vente: 1200, unite: "pp", details: {}, actif: true },
];
const trajets = [{ id: "ferry", partenaire_id: "pa1", de: "Koh Lanta", vers: "Koh Lipe", mode: "Speedboat", depart: "08:00", prix_adulte: 1900, prix_enfant: 1400, actif: true }];
const contexte = { prestations, trajets, partenaires, nomPartenaire: (id) => (partenaires.find((p) => p.id === id) || {}).nom || "" };
const nets = { prestations_nets: [{ prestation_id: "van", net: 2250 }, { prestation_id: "van-retour", net: 2000 }], trajets_nets: [{ trajet_id: "ferry", net_adulte: 1500, net_enfant: 1100 }] };

const service = (x) => ({ texte: "transfert", date: "2026-12-03", adultes: 0, enfants: 0, prix: null, origine_prix: "a_fixer", ...x });
const carte = (services, plus = {}) => ({ client: { nom: "Anna Meier" }, adultes: 11, enfants: 0, services, ...plus });

test("le bouton n'apparaît qu'avec le trajet ou l'excursion, les personnes et la date de chaque service", () => {
  assert.equal(devisPossible(carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 2 })])), true);
  // Les personnes de la carte servent quand le service n'en donne pas.
  assert.equal(devisPossible(carte([service({ offre: { genre: "prestation", id: "van" } })])), true);
  assert.equal(devisPossible(carte([service({ offre: { genre: "prestation", id: "van" }, date: "" })])), false, "sans date");
  assert.equal(devisPossible(carte([service({ offre: { genre: "prestation", id: "van" } })], { adultes: 0 })), false, "sans personnes");
  assert.equal(devisPossible(carte([service({ texte: "", libelle: "" })])), false, "sans trajet");
  assert.equal(devisPossible(carte([service({ offre: { genre: "prestation", id: "van" } }), service({ offre: { genre: "prestation", id: "van" }, date: "" })])), false, "un service sur deux sans date");
  assert.equal(devisPossible(carte([])), false);
  // Un trajet hors catalogue connu par son départ et son arrivée : le bouton est là, le calcul dira qu'il manque au catalogue.
  assert.equal(devisPossible(carte([service({ texte: "", de: "Lanta Sand", vers: "Ao Nang" })])), true);
});

test("capacité : 11 personnes pour un minivan de 9 places font 2 minivans au prix de vente", () => {
  const d = carte([service({ offre: { genre: "prestation", id: "van" }, libelle: "Minivan privé", adultes: 11, prix: 2500, origine_prix: "catalogue" })]);
  const devis = calculerDevis(d, contexte);
  assert.equal(devis.complet, true);
  assert.equal(devis.lignes[0].vehicules, 2);
  assert.equal(devis.lignes[0].vehicule, "minivans");
  assert.equal(devis.lignes[0].unitaire, 2500);
  assert.equal(devis.total, 5000);
  const texte = reponseDevis(devis, { client: d.client, devise: "THB" });
  assert.match(texte, /^Hello Anna,/);
  assert.match(texte, /Price: 2 minivans × THB 2,500 = THB 5,000/);
  assert.match(texte, /Date: 3 December 2026/);
  assert.match(texte, /People: 11 adults/);
  assert.match(texte, /Would you like me to book it\?$/, "aucune signature après la question");
  assert.doesNotMatch(texte, /2,250|2250/, "jamais le net");
  assert.doesNotMatch(texte, /Transports Démo/, "jamais le partenaire");
  // 9 personnes tiennent dans un minivan : un seul, sans multiplication dans le texte.
  const neuf = calculerDevis(carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 7, enfants: 2 })]), contexte);
  assert.equal(neuf.lignes[0].vehicules, 1);
  assert.match(reponseDevis(neuf), /Price: THB 2,500$/m);
  // Un bateau privé de 6 places pour 8 personnes : 2 bateaux.
  const bateau = calculerDevis(carte([service({ offre: { genre: "prestation", id: "bateau" }, adultes: 8 })]), contexte);
  assert.equal(bateau.total, 13000);
  assert.equal(bateau.lignes[0].vehicule, "longtail boats");
});

test("capacité absente ou dépassée : pas de calcul, motif clair, aucune réponse", () => {
  const inconnue = calculerDevis(carte([service({ offre: { genre: "prestation", id: "van-sans-cap" }, adultes: 4 })]), contexte);
  assert.equal(inconnue.complet, false);
  assert.deepEqual(inconnue.manquants.map((m) => m.motif), ["capacite_inconnue"]);
  assert.equal(inconnue.total, null);
  assert.equal(reponseDevis(inconnue), "");
  // Un tarif de groupe au-delà de la capacité écrite : la sortie ne prend pas tout le monde.
  const groupe = calculerDevis(carte([service({ offre: { genre: "prestation", id: "groupe" }, adultes: 12 })]), contexte);
  assert.deepEqual(groupe.manquants.map((m) => [m.motif, m.capacite]), [["capacite_depassee", 10]]);
  // Dans la capacité, le prix du groupe.
  assert.equal(calculerDevis(carte([service({ offre: { genre: "prestation", id: "groupe" }, adultes: 10 })]), contexte).total, 18000);
});

test("lecture de la capacité : seulement le champ Capacité du tarif, jamais la remarque ni le libellé", () => {
  assert.equal(capaciteDe({ unite: "boat", details: { capacite: "1 à 6 personnes" } }), 6);
  assert.equal(capaciteDe({ unite: "grp", details: { capacite: "20 passengers plus crew" } }), 20);
  assert.equal(capaciteDe({ unite: "veh", details: { capacite: "Up to 9 people" } }), 9);
  assert.equal(capaciteDe({ unite: "veh", details: { capacite: "max 10" } }), 10);
  // La remarque de Taxi dit une tranche de prix et un billet de ferry, pas les places du minivan.
  assert.equal(capaciteDe({ unite: "veh", details: { note: "Price for 1 to 2 guests. Ferry crossing included up to 4 people." } }), null);
  // « Base 1-2 pers » est la tranche de prix d'un tarif de groupe ; « 1 to 8 people » dans un libellé n'est pas lu non plus.
  assert.equal(capaciteDe({ unite: "grp", details: {}, libelle: "Programme B : Private Fishing, Base 1-2 pers" }), null);
  assert.equal(capaciteDe({ unite: "boat", details: {}, libelle_en: "Private boat to Turtle Island, 1 to 8 people" }), null);
  assert.equal(capaciteDe({ unite: "veh", details: {} }), null);
  assert.equal(motVehicule({ libelle: "Speedboat privé", unite: "boat" }, 1), "speedboat");
});

test("aller-retour : deux services, chacun calculé avec ses véhicules, total des deux", () => {
  const d = carte([
    service({ offre: { genre: "prestation", id: "van" }, date: "2026-12-03", adultes: 11 }),
    service({ offre: { genre: "prestation", id: "van-retour" }, date: "2026-12-10", adultes: 11 }),
  ]);
  const devis = calculerDevis(d, contexte);
  assert.equal(devis.complet, true);
  assert.deepEqual(devis.lignes.map((l) => [l.vehicules, l.total]), [[2, 5000], [2, 4600]]);
  assert.equal(devis.total, 9600);
  const texte = reponseDevis(devis, { client: d.client });
  assert.match(texte, /Here are the prices for your request:/);
  assert.match(texte, /Private minivan: Krabi Airport → Koh Lanta\nDate: 3 December 2026/);
  assert.match(texte, /Private minivan: Koh Lanta → Krabi Airport\nDate: 10 December 2026/);
  assert.match(texte, /Total: THB 9,600/);
  // Un aller-retour en bateau régulier : prix adulte et enfant du trajet, à chaque sens.
  const ferry = calculerDevis(carte([service({ offre: { genre: "trajet", id: "ferry" }, adultes: 2, enfants: 1 }), service({ offre: { genre: "trajet", id: "ferry" }, date: "2026-12-06", adultes: 2, enfants: 1 })]), contexte);
  assert.equal(ferry.total, 2 * (2 * 1900 + 1400));
  assert.equal(ferry.lignes[0].vehicules, null);
  assert.match(reponseDevis(ferry), /Speedboat: Koh Lanta → Koh Lipe, 08:00/);
});

test("prix accepté dans la conversation : il passe avant le catalogue (PR 306 et 307)", () => {
  // Prix donné par Nani (origine « saisi ») : pas de multiplication par les véhicules, le prix vaut pour le service.
  const nani = calculerDevis(carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 11, prix: 4800, origine_prix: "saisi" })]), contexte);
  assert.equal(nani.total, 4800);
  assert.equal(nani.lignes[0].origine, "saisi");
  assert.equal(nani.lignes[0].vehicules, 2);
  assert.match(reponseDevis(nani), /Price: THB 4,800 for 2 minivans/);
  // Prix du client que Nani n'a pas corrigé (PR 307).
  const client = calculerDevis(carte([service({ offre: { genre: "prestation", id: "join" }, adultes: 2, prix: 2000, origine_prix: "client_non_corrige" })]), contexte);
  assert.equal(client.total, 2000);
  assert.equal(client.lignes[0].origine, "client_non_corrige");
  // Un prix « catalogue » de la carte se recalcule (il ne comptait qu'un véhicule).
  assert.equal(calculerDevis(carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 11, prix: 2500, origine_prix: "catalogue" })]), contexte).total, 5000);
  // Prix du client refusé par la fonction (sous le net, égal à un net) : la carte n'a pas de prix, le catalogue sert.
  assert.equal(calculerDevis(carte([service({ offre: { genre: "prestation", id: "join" }, adultes: 2, prix: null, origine_prix: "a_fixer" })]), contexte).total, 2400);
  // Hors catalogue avec un prix accepté : ce prix fait le devis.
  const libre = calculerDevis(carte([service({ texte: "", de: "Lanta Sand", vers: "Ao Nang", adultes: 3, prix: 3500, origine_prix: "saisi" })]), contexte);
  assert.equal(libre.complet, true);
  assert.equal(libre.total, 3500);
  assert.match(reponseDevis(libre), /Lanta Sand → Ao Nang\n/);
});

test("trajet absent du catalogue : pas de calcul, message clair, aucune réponse", () => {
  const d = carte([service({ texte: "", de: "Lanta Sand", vers: "Ao Nang", adultes: 3 })]);
  const devis = calculerDevis(d, contexte);
  assert.equal(devis.complet, false);
  assert.deepEqual(devis.manquants, [{ index: 0, libelle: "Lanta Sand → Ao Nang", motif: "hors_catalogue" }]);
  assert.equal(devis.total, null);
  assert.equal(reponseDevis(devis, { client: d.client }), "");
  // Un service calculable et un absent : aucune réponse partielle.
  const mixte = calculerDevis(carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 2 }), service({ texte: "", de: "Lanta Sand", vers: "Ao Nang", adultes: 2 })]), contexte);
  assert.equal(mixte.lignes.length, 1);
  assert.equal(mixte.complet, false);
  assert.equal(reponseDevis(mixte), "");
  // Une référence disparue ou masquée, un service d'une autre entreprise.
  assert.equal(calculerDevis(carte([service({ offre: { genre: "prestation", id: "efface" }, adultes: 2 })]), contexte).manquants[0].motif, "introuvable");
  assert.equal(calculerDevis(carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 2, entite_id: "taxi" })]), contexte, { activeId: "secret" }).manquants[0].motif, "autre_entreprise");
  // Le message dit à Nani ce qui se passe.
  assert.match(lire("views/devis-carte.mjs"), /hors_catalogue: N_\("Ce trajet n'est pas au catalogue : aucun calcul\./);
});

test("contrôle de la copie : un net ou un nom de partenaire tapé dans la réponse la bloque", () => {
  const devis = calculerDevis(carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 11 })]), contexte);
  const montants = netsDuDevis(devis, nets);
  assert.deepEqual(montants.sort((a, b) => a - b), [2250, 4500]);
  const texte = reponseDevis(devis, { client: { nom: "Anna" } });
  const bloquants = { montants, noms: partenaires.map((p) => p.nom) };
  assert.deepEqual(resteBloque(texte, bloquants), []);
  assert.deepEqual(resteBloque(`${texte}\nNet 2,250`, bloquants), ["2250"]);
  assert.deepEqual(resteBloque(`${texte}\nwith Transports Démo`, bloquants), ["Transports Démo"]);
  const ferry = calculerDevis(carte([service({ offre: { genre: "trajet", id: "ferry" }, adultes: 2 })]), contexte);
  assert.deepEqual(netsDuDevis(ferry, nets).sort((a, b) => a - b), [1100, 1500, 3000]);
});

test("écran : le bouton est sur la carte « Nouveau dossier » en attente, le calcul ne part qu'au clic et sans IA", () => {
  const agent = lire("views/agent.mjs");
  assert.match(agent, /import \{ blocDevis \} from "\.\/devis-carte\.mjs";/);
  assert.match(agent, /if \(c\.statut === "proposee"\) corps\.push\(blocDevis\(du\)\);/);
  const vue = lire("views/devis-carte.mjs");
  assert.match(vue, /if \(!devisPossible\(donnees\)\) return null;/);
  assert.match(vue, /bouton\.addEventListener\("click"/);
  const calc = lire("devis-calc.mjs");
  for (const s of [vue, calc]) assert.doesNotMatch(s, /fetch\(|functions\/|anthropic|invoke\(/i);
});

test("catalogue Taxi : le libellé « destination » prend le groupe et le trajet de la carte, le véhicule s'appelle un taxi", () => {
  const taxi = { id: "kbv", partenaire_id: "pa1", famille: "transfert", groupe: "Private Taxi", libelle: "Krabi Airport", libelle_en: "", prix_vente: 2300, unite: "veh", details: { capacite: "1 to 9 people" }, actif: true };
  const ctx = { ...contexte, prestations: [taxi] };
  const devis = calculerDevis(carte([service({ offre: { genre: "prestation", id: "kbv" }, de: "Lanta Sand", vers: "Krabi Airport", adultes: 11 }), service({ offre: { genre: "prestation", id: "kbv" }, adultes: 2 })]), ctx);
  assert.deepEqual(devis.lignes.map((l) => l.libelle), ["Private Taxi: Lanta Sand → Krabi Airport", "Private Taxi: Krabi Airport"]);
  assert.match(reponseDevis(devis), /Price: 2 taxis × THB 2,300 = THB 4,600/);
});
