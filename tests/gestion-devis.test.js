// « Calculer le devis » sur la carte du dossier (22.11.2026) : véhicules écrits par Nani, sinon suggérés, sinon 1 ; prix de vente seulement ; prix accepté
// dans la conversation avant le catalogue (PR 306 et 307), réponse anglaise sans signature. Calcul en code, sans IA.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { devisPossible, calculerDevis, reponseDevis, netsDuDevis, motVehicule, remarquesDuDevis, vehiculesEcrits, textesDeNani, nombreVehicules, genreVehicule } from "../src/gestion/js/devis-calc.mjs";
import { resteBloque } from "../src/gestion/js/agent-calc.mjs";

const ici = path.dirname(fileURLToPath(import.meta.url));
const lire = (f) => fs.readFileSync(path.join(ici, "..", "src", "gestion", "js", f), "utf8");

const partenaires = [{ id: "pa1", nom: "Transports Démo", actif: true }];
const prestations = [
  { id: "van", partenaire_id: "pa1", famille: "transfert", groupe: "Private minivan", libelle: "Minivan privé Krabi Airport → Koh Lanta", libelle_en: "Private minivan: Krabi Airport → Koh Lanta", prix_vente: 2500, unite: "veh", details: { capacite: "1 to 9 people" }, actif: true },
  { id: "van-retour", partenaire_id: "pa1", famille: "transfert", groupe: "Private minivan", libelle: "Minivan privé Koh Lanta → Krabi Airport", libelle_en: "Private minivan: Koh Lanta → Krabi Airport", prix_vente: 2300, unite: "veh", details: {}, actif: true },
  { id: "van-note", partenaire_id: "pa1", famille: "transfert", groupe: "Private minivan", libelle: "Minivan privé Koh Lanta → Phuket Airport", libelle_en: "Private minivan: Koh Lanta → Phuket Airport", prix_vente: 4500, unite: "veh", details: { note: "Child seat provided free. Price for 1 to 2 guests. Ferry crossing included up to 4 people, 60 per person from the 5th." }, actif: true },
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

test("véhicules suggérés : 11 personnes font 2 minivans (8 au plus, selon les bagages) au prix de vente", () => {
  const d = carte([service({ offre: { genre: "prestation", id: "van" }, libelle: "Minivan privé", adultes: 11, prix: 2500, origine_prix: "catalogue" })]);
  const devis = calculerDevis(d, contexte);
  assert.equal(devis.complet, true);
  assert.deepEqual([devis.lignes[0].vehicules, devis.lignes[0].vehiculesOrigine, devis.lignes[0].bagages], [2, "suggestion", true]);
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
  assert.doesNotMatch(texte, /luggage|bagages/, "la note des bagages reste sur la carte");
  // 8 personnes tiennent dans un minivan : un seul, sans multiplication dans le texte.
  const huit = calculerDevis(carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 6, enfants: 2 })]), contexte);
  assert.equal(huit.lignes[0].vehicules, 1);
  assert.match(reponseDevis(huit), /Price: THB 2,500$/m);
  // Taxi ou voiture : 4 au plus. Bateau : pas de suggestion, 1 par défaut.
  assert.deepEqual(nombreVehicules({ groupe: "Private Taxi", unite: "veh" }, 9), { n: 3, origine: "suggestion", bagages: false });
  assert.deepEqual(nombreVehicules({ libelle: "Voiture privée", unite: "veh" }, 4), { n: 1, origine: "suggestion", bagages: false });
  const bateau = calculerDevis(carte([service({ offre: { genre: "prestation", id: "bateau" }, adultes: 8 })]), contexte);
  assert.deepEqual([bateau.lignes[0].vehicules, bateau.lignes[0].vehiculesOrigine, bateau.total], [1, "defaut", 6500]);
  assert.deepEqual(nombreVehicules({ groupe: "Transfert", unite: "veh" }, 30), { n: 1, origine: "defaut", bagages: false });
  // Aucune capacité au catalogue : la remarque et le texte « Capacité » ne sont jamais lus.
  assert.equal(calculerDevis(carte([service({ offre: { genre: "prestation", id: "van-note" }, adultes: 4 })]), contexte).lignes[0].vehicules, 1);
  // Les tarifs à la personne ou au groupe : prix × quantité, sans véhicules.
  assert.equal(calculerDevis(carte([service({ offre: { genre: "prestation", id: "join" }, adultes: 3 })]), contexte).total, 3600);
  const groupe = calculerDevis(carte([service({ offre: { genre: "prestation", id: "groupe" }, adultes: 12 })]), contexte);
  assert.deepEqual([groupe.total, groupe.lignes[0].vehicules], [18000, null]);
});

test("véhicules écrits par Nani : repris avant la suggestion ; le choix fait sur la carte passe avant tout", () => {
  assert.deepEqual(vehiculesEcrits(["We will send 2 minivans", "two taxis for you", "Deux voitures"]), { minivan: 2, taxi: 2 });
  assert.deepEqual(vehiculesEcrits(["3 vehicles"]), { tous: 3 });
  assert.deepEqual(vehiculesEcrits(["1 car seat for the baby", "we are 11 people", "50 vans"]), {}, "siège, personnes, nombre absurde : rien");
  assert.deepEqual(vehiculesEcrits(["2 minivans", "finally 3 minivans"]), { minivan: 3 }, "le plus récent gagne");
  const d = carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 11 })]);
  const ecrit = calculerDevis(d, contexte, { textes: ["OK, it will be 3 minivans because of the surfboards"] });
  assert.deepEqual([ecrit.lignes[0].vehicules, ecrit.lignes[0].vehiculesOrigine, ecrit.total], [3, "conversation", 7500]);
  // Un nombre écrit pour un autre genre de véhicule ne compte pas ; « vehicles » compte pour tous.
  assert.equal(calculerDevis(d, contexte, { textes: ["2 taxis"] }).lignes[0].vehiculesOrigine, "suggestion");
  assert.equal(calculerDevis(d, contexte, { textes: ["4 vehicles"] }).lignes[0].vehicules, 4);
  // Nani change le nombre d'un geste sur la carte : le total suit.
  const choisi = calculerDevis(d, contexte, { textes: ["3 minivans"], choix: { 0: 1 } });
  assert.deepEqual([choisi.lignes[0].vehicules, choisi.lignes[0].vehiculesOrigine, choisi.total], [1, "choix", 2500]);
  // Les textes de Nani : ce qu'elle tape et ses lignes d'un échange WhatsApp joint, jamais celles du client.
  const messages = [
    { role: "user", contenu: [{ type: "text", text: "Prépare le devis" }] },
    { role: "user", contenu: [{ type: "text", text: "<conversation>\n[Client 22.11.2026 09:00] We need 4 vans\n[Nani 22.11.2026 09:05] For 11 people we take 2 minivans\n</conversation>" }] },
    { role: "assistant", contenu: [{ type: "text", text: "5 minivans" }] },
  ];
  assert.deepEqual(textesDeNani(messages), ["Prépare le devis", "For 11 people we take 2 minivans"]);
  assert.deepEqual(vehiculesEcrits(textesDeNani(messages)), { minivan: 2 });
  assert.equal(genreVehicule({ groupe: "Private longtail" }), "bateau");
});

test("aller-retour : deux services, chacun calculé avec ses véhicules, total des deux", () => {
  const d = carte([
    service({ offre: { genre: "prestation", id: "van" }, date: "2026-12-03", adultes: 11 }),
    service({ offre: { genre: "prestation", id: "van-retour" }, date: "2026-12-10", adultes: 11 }),
  ]);
  const devis = calculerDevis(d, contexte);
  assert.equal(devis.complet, true);
  assert.deepEqual(devis.lignes.map((l) => [l.vehicules, l.total]), [[2, 5000], [2, 4600]]);
  // Nani a écrit 3 minivans : les deux sens en prennent 3.
  assert.deepEqual(calculerDevis(d, contexte, { textes: ["3 minivans"] }).lignes.map((l) => l.vehicules), [3, 3]);
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
  assert.match(agent, /import \{ blocDevis, donneesAvecDevis \} from "\.\/devis-carte\.mjs";/);
  assert.match(agent, /if \(c\.statut === "proposee"\) corps\.push\(blocDevis\(du, \{ id: c\.id, textes: \(\) => textesDeNani\(fil\.messages\) \}\)\);/);
  const vue = lire("views/devis-carte.mjs");
  assert.match(vue, /if \(!devisPossible\(donnees\)\) return null;/);
  assert.match(vue, /bouton\.addEventListener\("click"/);
  const calc = lire("devis-calc.mjs");
  for (const s of [vue, calc]) assert.doesNotMatch(s, /fetch\(|functions\/|anthropic|invoke\(/i);
});

test("catalogue Taxi : le libellé « destination » prend le groupe et le trajet de la carte, le véhicule s'appelle un taxi", () => {
  const taxi = { id: "kbv", partenaire_id: "pa1", famille: "transfert", groupe: "Private Taxi", libelle: "Krabi Airport", libelle_en: "", prix_vente: 2300, unite: "veh", details: {}, actif: true };
  const ctx = { ...contexte, prestations: [taxi] };
  const devis = calculerDevis(carte([service({ offre: { genre: "prestation", id: "kbv" }, de: "Lanta Sand", vers: "Krabi Airport", adultes: 8 }), service({ offre: { genre: "prestation", id: "kbv" }, adultes: 2 })]), ctx);
  assert.deepEqual(devis.lignes.map((l) => l.libelle), ["Private Taxi: Lanta Sand → Krabi Airport", "Private Taxi: Krabi Airport"]);
  assert.match(reponseDevis(devis), /Price: 2 taxis × THB 2,300 = THB 4,600/);
});

test("revue : bébés comptés dans la suggestion, date impossible refusée, prix accepté sans ligne du catalogue", () => {
  // 8 adultes et 1 bébé : 9 places, 2 minivans suggérés ; le bébé ne paie pas.
  const bebe = calculerDevis(carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 8 })], { bebes: 1 }), contexte);
  assert.equal(bebe.lignes[0].vehicules, 2);
  assert.match(reponseDevis(bebe), /People: 8 adults\n/);
  assert.equal(devisPossible(carte([service({ offre: { genre: "prestation", id: "van" }, date: "2026-02-31" })])), false);
  const masque = calculerDevis(carte([service({ offre: { genre: "prestation", id: "efface" }, adultes: 2, prix: 3900, origine_prix: "saisi" })]), contexte);
  assert.equal(masque.complet, true);
  assert.equal(masque.total, 3900);
});

test("aucune migration ni champ du catalogue : la capacité n'existe pas dans le tarif", () => {
  assert.equal(fs.existsSync(path.join(ici, "..", "docs", "gestion", "migration-90-places-vehicule.sql")), false);
  assert.doesNotMatch(lire("views/partenaires.mjs"), /places_vehicule|Personnes au plus par véhicule/);
  for (const f of ["devis-calc.mjs", "views/devis-carte.mjs"]) assert.doesNotMatch(lire(f), /places_vehicule|capacite_inconnue|details\.capacite\)/);
  // Le nombre de véhicules se change d'un geste sur la carte.
  const vue = lire("views/devis-carte.mjs");
  assert.match(vue, /"aria-label": tr\("Un véhicule de moins"\)/);
  assert.match(vue, /"aria-label": tr\("Un véhicule de plus"\)/);
  assert.match(vue, /selon les bagages/);
});

test("dossier = devis : 11 personnes et 2 minivans au devis donnent 2 véhicules et le même total dans le dossier", async () => {
  const { propositionDepuisCarte } = await import("../src/gestion/js/agent-calc.mjs");
  const { propositionVersDemande, offresRecalculees, lignesAuPrixCarte } = await import("../src/gestion/js/assistant-calc.mjs");
  const { ligneDepuisPrestation } = await import("../src/gestion/js/partenaires-calc.mjs");
  const { appliquerDevis, resumeDevis } = await import("../src/gestion/js/devis-calc.mjs");
  const totalLignes = (lignes) => lignes.reduce((t, l) => t + Number(l.unite) * Number(l.qte), 0);
  const d = carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 11, prix: 2500, origine_prix: "catalogue" })]);
  const devis = calculerDevis(d, contexte);
  assert.equal(devis.total, 5000);
  // « Créer le dossier » : la carte avec le devis, puis la fiche de création habituelle.
  const avec = appliquerDevis(d, resumeDevis(devis));
  const { services } = propositionVersDemande(propositionDepuisCarte(avec), contexte);
  const offre = services[0].offres[0];
  assert.equal(offre.vehicules, 2);
  assert.equal(offre.total, devis.total);
  const lignes = lignesAuPrixCarte([ligneDepuisPrestation(offre.source, null, { qte: offre.vehicules, uid: () => "x" })], offre.prixCarte);
  assert.deepEqual(lignes.map((l) => [l.qte, l.unite]), [[2, 2500]]);
  assert.equal(totalLignes(lignes), devis.total);
  // Le formulaire recalcule pour les mêmes personnes : rien ne change. D'autres personnes : le catalogue, avec l'avertissement.
  assert.equal(offresRecalculees([offre], { adultes: 11, enfants: 0 }, contexte)[0].total, 5000);
  const autres = offresRecalculees([offre], { adultes: 4, enfants: 0 }, contexte)[0];
  assert.deepEqual([autres.total, autres.vehicules, autres.avertissement], [2500, undefined, "prix_carte_personnes"]);
  // Prix accepté (4 800 pour 2 minivans) : le dossier garde 4 800, réparti sur les 2 véhicules.
  const accepte = carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 11, prix: 4800, origine_prix: "saisi" })]);
  const devisAccepte = calculerDevis(accepte, contexte);
  const oA = propositionVersDemande(propositionDepuisCarte(appliquerDevis(accepte, resumeDevis(devisAccepte))), contexte).services[0].offres[0];
  const lA = lignesAuPrixCarte([ligneDepuisPrestation(oA.source, null, { qte: oA.vehicules, uid: () => "x" })], oA.prixCarte);
  assert.deepEqual([oA.total, lA[0].qte, totalLignes(lA)], [4800, 2, 4800]);
  // Sans devis calculé, rien ne change (un véhicule, comme avant) ; un devis incomplet n'est pas repris.
  assert.equal(propositionVersDemande(propositionDepuisCarte(d), contexte).services[0].offres[0].vehicules, undefined);
  assert.equal(resumeDevis(calculerDevis(carte([service({ texte: "", de: "Lanta Sand", vers: "Ao Nang", adultes: 4 })]), contexte)), null);
  // Le nombre choisi sur la carte (3 minivans) passe au dossier.
  const trois = calculerDevis(d, contexte, { choix: { 0: 3 } });
  const o3 = propositionVersDemande(propositionDepuisCarte(appliquerDevis(d, resumeDevis(trois))), contexte).services[0].offres[0];
  assert.deepEqual([o3.vehicules, o3.total], [3, 7500]);
  // Un service changé depuis le devis (autres personnes) n'est pas touché.
  const change = { ...d, services: [{ ...d.services[0], adultes: 5 }] };
  assert.equal(appliquerDevis(change, resumeDevis(devis)).services[0].vehicules, undefined);
});

test("dossier = devis : la carte, la validation et la fiche de création reprennent le devis", () => {
  const agent = lire("views/agent.mjs");
  assert.match(agent, /const donneesCarte = \(c\) => donneesAvecDevis\(c\.id,/);
  assert.match(agent, /preparation\(\{ \.\.\.c, donnees: donneesCarte\(c\) \}\)/);
  assert.match(agent, /blocDevis\(du, \{ id: c\.id, textes: \(\) => textesDeNani\(fil\.messages\) \}\)/);
  assert.match(lire("views/demande.mjs"), /qte: offre\.vehicules \|\| \(offre\.enfant/);
  assert.match(lire("views/devis-carte.mjs"), /noter\(CLE_DEVIS, id, resumeDevis\(devis\)\)/);
});

test("remarque du tarif : montrée à Nani, jamais dans la réponse ; masquée si elle cite un partenaire, un net ou un coût", () => {
  const avecNote = (id, note) => ({ ...prestations.find((p) => p.id === "van"), id, details: { note } });
  const ctx = { ...contexte, prestations: [...prestations, avecNote("n1", "Price for 1 to 2 guests. 60 per person from the 5th."), avecNote("n2", "Pickup by Transports Démo"), avecNote("n3", "Ask for 2,250 first"), avecNote("n4", "Commission paid monthly")] };
  const devis = calculerDevis(carte(["n1", "n2", "n3", "n4", "n1"].map((id) => service({ offre: { genre: "prestation", id }, adultes: 4 }))), ctx);
  const r = remarquesDuDevis(devis, { nets: [2250], noms: ["Transports Démo"] });
  assert.deepEqual(r.map((x) => x.texte), ["Price for 1 to 2 guests. 60 per person from the 5th.", null, null, null], "une seule fois par tarif");
  assert.doesNotMatch(reponseDevis(devis), /60 per person|guests|Transports|Commission/);
  assert.deepEqual(remarquesDuDevis(calculerDevis(carte([service({ offre: { genre: "prestation", id: "van" }, adultes: 2 })]), contexte)), [], "pas de remarque, rien");
  const vue = lire("views/devis-carte.mjs");
  assert.match(vue, /tr\("Remarque du tarif à vérifier dans le catalogue"\)/);
  assert.match(vue, /tr\("Remarque du tarif à vérifier : \{remarque\}", \{ remarque: r\.texte \}\)/);
});
