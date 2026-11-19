// Demande de prix et d'horaires d'un itinéraire (20.11.2026) : lecture des étapes, situation des hôtels par recherche web, choix des départs à
// la meilleure marge (dans l'outil), faits envoyés pour rédiger (sans net ni compagnie), contrôle de la réponse, création du dossier.
// Réponses de Claude simulées : aucun appel réel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { USAGES, controlerAcces, coutEstime, ligneJournal, parametresAppel } from "../supabase/functions/assistant/calc.js";
import {
  promptItineraire,
  SCHEMA_ITINERAIRE,
  validerItineraire,
  lieuxDuCatalogue as lieuxServeur,
  nomPourRecherche,
  promptSituer,
  parametresSituer,
  lireSituer,
  validerSituer,
  verifierFaitsItineraire,
  promptReponseItineraire,
  validerReponseItineraire,
  OUTIL_SITUER,
} from "../supabase/functions/assistant/itineraire.js";
import {
  cleLieu,
  lieuxDuCatalogue,
  trajetsEntreEtapes,
  margeDepart,
  departsDuTrajet,
  faitsReponse,
  servicesDepuisChoix,
  hotelsAChercher,
  completerEtape,
  ligneHotel,
  hotelConnu,
  simulerItineraire,
  simulerSituer,
  simulerReponse,
} from "../src/gestion/js/itineraire-calc.mjs";
import { zoneProposee } from "../src/gestion/js/pickup-calc.mjs";

const E = "11111111-1111-4111-8111-111111111111";
const AJD = "2026-11-19";
const MESSAGE =
  "Bonjour, vous pouvez nous envoyer tarifs et horaires ? Nos hôtels : du 18 au 21 janvier Krabi Front Bay Resort, du 21 au 25 Breizh Cape Beach Bungalows, du 25 au 28 Paradise Resort Phi Phi, du 28 au 31 Koo Mook Sunrise Beach, du 31 janvier au 3 février Dugong Libong Resort. Merci, Claire";

// Catalogue : Lanta → Phi Phi chez deux compagnies (marges 200/200 et 200/100), Phi Phi → Mook à marge égale, pas de Mook → Libong.
const PARTENAIRES = [
  { id: "satun", nom: "Satun Pakbara", actif: true },
  { id: "bundhaya", nom: "Bundhaya", actif: true },
  { id: "ferry", nom: "Ferry du sud", actif: true },
  { id: "masque", nom: "Ancien", actif: false },
];
const T = (id, partenaire_id, de, vers, depart, arrivee, prix_adulte, prix_enfant, extra = {}) => ({ id, partenaire_id, de, vers, depart, arrivee, mode: "Speedboat", duree: "1 h", prix_adulte, prix_enfant, actif: true, fenetres: [], ...extra });
const TRAJETS = [
  T("s1", "satun", "Koh Lanta", "Koh Phi Phi", "09:30", "11:00", 900, 700),
  T("s2", "satun", "Koh Lanta", "Koh Phi Phi", "13:30", "15:00", 900, 700),
  T("b1", "bundhaya", "Koh Lanta", "Koh Phi Phi", "10:30", "11:30", 900, 700),
  T("m1", "masque", "Koh Lanta", "Koh Phi Phi", "08:00", "09:00", 500, 400),
  T("p1", "satun", "Phi Phi", "Koh Mook", "11:30", "13:00", 1500, 1100),
  T("p2", "ferry", "Koh Phi Phi", "Koh Mook", "13:30", "16:00", 1300, 1000, { mode: "Ferry", duree: "2 h 30" }),
  T("h1", "satun", "Koh Lanta", "Koh Lipe", "10:30", "13:30", 1900, 1500, { fenetres: [["2026-11-01", "2026-12-31"]] }),
];
const NETS = { s1: [700, 500], s2: [700, 500], b1: [700, 600], m1: [100, 100], p1: [1100, 800], p2: [900, 700], h1: [1500, 1200] };
const netDe = (t) => (NETS[t.id] ? { net_adulte: NETS[t.id][0], net_enfant: NETS[t.id][1] } : null);
const nomPartenaire = (id) => (PARTENAIRES.find((p) => p.id === id) || {}).nom || "";
const ADMIN = ["clients.lire", "clients.ecrire", "dossiers.lire", "dossiers.ecrire", "partenaires.lire", "partenaires.nets"];

// ---- Droits, coût ----------------------------------------------------------------------------------------------------------------------

test("droits : les trois usages demandent la base de prix et la création de dossier, comme la lecture", () => {
  for (const usage of ["itineraire", "situer", "repondre_itineraire"]) {
    assert.ok(USAGES[usage], usage);
    assert.deepEqual(controlerAcces({ usage, entiteId: E, permissions: ADMIN, reglages: { assistant_ia: true }, appelsDuJour: 0 }), { ok: true });
    assert.equal(controlerAcces({ usage, entiteId: E, permissions: ADMIN, reglages: {}, appelsDuJour: 0 }).erreur, "assistant_eteint");
    assert.deepEqual(controlerAcces({ usage, entiteId: E, permissions: ["partenaires.lire"], reglages: { assistant_ia: true }, appelsDuJour: 0 }).manque, ["dossiers.ecrire"]);
    assert.equal(controlerAcces({ usage, entiteId: E, permissions: ADMIN, reglages: { assistant_ia: true }, appelsDuJour: 40 }).erreur, "limite_du_jour", "chaque appel compte dans la limite du jour");
  }
});

test("coût : une recherche web compte 0,01 $ en plus des jetons, et le journal la reprend", () => {
  const u = { input_tokens: 10000, output_tokens: 1000, server_tool_use: { web_search_requests: 3 } };
  assert.equal(Math.round(coutEstime(u, "claude-haiku-5-5") * 1e6) / 1e6, Math.round((10000 * 0.1 + 1000 * 0.5) / 1e6 * 1e6 + 0.03 * 1e6) / 1e6);
  const l = ligneJournal({ userId: "u", entiteId: E, usage: "situer", statut: "ok", message: { model: "claude-haiku-5-5", usage: u }, dureeMs: 12 });
  assert.equal(l.usage, "situer");
  assert.ok(l.cout_estime_usd > 0.03 && l.cout_estime_usd < 0.032);
});

// ---- 1. Lire l'itinéraire ----------------------------------------------------------------------------------------------------------------

test("itinéraire : le prompt n'envoie que le message et la date, sans catalogue ; sortie JSON imposée", () => {
  const p = promptItineraire({ aujourdhui: AJD, message: MESSAGE, lieu: "Koh Lanta (Thaïlande)" });
  assert.match(p.messages[0].content, /2026-11-19 \(jeudi\)/);
  assert.match(p.messages[0].content, /<message_client>/);
  assert.doesNotMatch(JSON.stringify(p), /Catalogue|Satun|net_/i);
  const params = parametresAppel("itineraire", p, SCHEMA_ITINERAIRE);
  assert.equal(params.model, "claude-haiku-5-5");
  assert.equal(params.output_config.format.type, "json_schema");
  assert.equal(params.output_config.effort, "medium");
});

test("itinéraire : un hôtel ou un prénom absent du message est retiré, les dates invalides vidées, les étapes rangées", () => {
  const v = {
    prenom: "Claire",
    langue: "fr",
    adultes: 2,
    enfants: 0,
    ages_enfants: [],
    bebes: 0,
    etapes: [
      { hotel: "Paradise Resort Phi Phi", lieu_ecrit: "", du: "2027-01-25", au: "2027-01-28" },
      { hotel: "Breizh Cape Beach Bungalows", lieu_ecrit: "", du: "2027-01-21", au: "2027-01-25" },
      { hotel: "Hilton Phuket", lieu_ecrit: "", du: "2027-01-28", au: "2027-01-31" },
      { hotel: "Koo Mook Sunrise Beach", lieu_ecrit: "Koh Mook", du: "2027-02-30", au: "2027-01-31" },
    ],
    remarques: "",
  };
  const r = validerItineraire(v, { message: MESSAGE, aujourdhui: AJD });
  assert.equal(r.ok, true);
  assert.equal(r.itineraire.prenom, "Claire");
  assert.deepEqual(r.itineraire.etapes.map((e) => e.hotel), ["Breizh Cape Beach Bungalows", "Paradise Resort Phi Phi", "Koo Mook Sunrise Beach"], "rangées par date, l'hôtel inventé retiré, l'étape sans date gardée à la fin");
  assert.equal(r.itineraire.etapes[2].du, "", "le 30 février n'existe pas");
  assert.equal(r.itineraire.etapes[2].lieu_ecrit, "", "« Koh Mook » n'est pas écrit tel quel dans le message");
  assert.ok(r.avertissements.includes("hotel_non_cite"));
  assert.ok(r.avertissements.includes("date_illisible"));
  assert.equal(validerItineraire({ prenom: "Jean" , etapes: [] }, { message: MESSAGE, aujourdhui: AJD }).itineraire.prenom, "", "un prénom absent du message est retiré");
  assert.equal(validerItineraire(null, { message: MESSAGE, aujourdhui: AJD }).ok, false);
});

// ---- 2. Situer les hôtels ------------------------------------------------------------------------------------------------------------

test("situer : la liste des lieux vient des trajets actifs, sans prestataire masqué, une fois chacun", () => {
  const l = lieuxServeur({ trajets: [...TRAJETS, T("x", "masque", "Koh Ngai", "Koh Kradan", "", "", 1, 1), T("y", "satun", "Trang", "Koh Lanta", "", "", 1, 1, { actif: false })], partenaires: PARTENAIRES });
  assert.deepEqual(l, ["Koh Lanta", "Koh Lipe", "Koh Mook", "Koh Phi Phi", "Phi Phi"]);
  assert.deepEqual(lieuxDuCatalogue(TRAJETS, PARTENAIRES), ["Koh Lanta", "Koh Lipe", "Koh Mook", "Koh Phi Phi"], "côté outil, « Phi Phi » et « Koh Phi Phi » ne font qu'un lieu");
});

test("situer : seul le nom de l'hôtel part, sans téléphone ni e-mail collés avec lui", () => {
  assert.equal(nomPourRecherche("Paradise Resort Phi Phi +66 81 234 5678 claire@exemple.fr\nchambre 12"), "Paradise Resort Phi Phi");
  const p = promptSituer({ hotels: ["Paradise Resort Phi Phi"], lieux: ["Koh Lanta", "Koh Phi Phi"], lieu: "Koh Lanta (Thaïlande)" });
  assert.match(p.messages[0].content, /<hotels>\n- Paradise Resort Phi Phi\n<\/hotels>/);
  assert.doesNotMatch(JSON.stringify(p), /Claire|2027|janvier/);
});

test("situer : recherche web de base (Haiku 5.5), deux recherches par hôtel au plus, résultats orientés Thaïlande, outil strict", () => {
  const params = parametresSituer(promptSituer({ hotels: ["A", "B", "C"], lieux: ["Koh Lanta"] }), 3);
  const web = params.tools.find((t) => t.name === "web_search");
  assert.equal(web.type, "web_search_20250305");
  assert.equal(web.max_uses, 7);
  assert.deepEqual(web.user_location, { type: "approximate", country: "TH", timezone: "Asia/Bangkok" });
  assert.equal(params.tools.find((t) => t.name === "situer_hotels").strict, true);
  assert.deepEqual(params.tool_choice, { type: "auto" });
  assert.equal(params.output_config.format, undefined, "pas de sortie JSON imposée avec la recherche web : l'outil strict tient ce rôle");
  assert.equal(parametresSituer(promptSituer({ hotels: Array(8).fill("x"), lieux: ["a"] }), 8).tools[0].max_uses, 12);
});

const reponseRecherche = (input, extra = {}) => ({
  stop_reason: "tool_use",
  content: [
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Paradise Resort Phi Phi" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://exemple.test/paradise", title: "Paradise Resort, Phi Phi Don" }] },
    { type: "server_tool_use", id: "s2", name: "web_search", input: { query: "Breizh Cape" } },
    { type: "web_search_tool_result", tool_use_id: "s2", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
    { type: "tool_use", id: "t1", name: OUTIL_SITUER.name, input },
  ],
  ...extra,
});

test("situer : la réponse donne l'appel de l'outil et les adresses des vrais résultats ; une erreur de recherche n'en donne aucune", () => {
  const lu = lireSituer(reponseRecherche({ hotels: [] }));
  assert.equal(lu.ok, true);
  assert.deepEqual(lu.sources, [{ url: "https://exemple.test/paradise", titre: "Paradise Resort, Phi Phi Don" }]);
  assert.equal(lireSituer({ stop_reason: "pause_turn", content: [] }).statut, "pause");
  assert.equal(lireSituer({ stop_reason: "refusal", content: [] }).statut, "refus");
  assert.equal(lireSituer({ stop_reason: "end_turn", content: [{ type: "text", text: "Je ne sais pas." }] }).statut, "sans_reponse");
});

test("situer : un lieu sans source vérifiable, hors liste ou non tranché n'est pas proposé", () => {
  const lieux = ["Koh Lanta", "Koh Phi Phi", "Koh Mook"];
  const hotels = ["Paradise Resort Phi Phi", "Breizh Cape Beach Bungalows", "Koo Mook Sunrise Beach", "Dugong Libong Resort"];
  const v = {
    hotels: [
      { nom: "paradise resort  phi phi", lieu: "koh phi phi", zone: "Tonsai Bay", localite: "Koh Phi Phi Don", source_url: "https://exemple.test/paradise", certitude: "sure", explication: "La page de l'hôtel le place à Tonsai." },
      { nom: "Breizh Cape Beach Bungalows", lieu: "Koh Lanta", zone: "Relax Bay", localite: "Koh Lanta", source_url: "https://inventee.test/breizh", certitude: "sure", explication: "" },
      { nom: "Koo Mook Sunrise Beach", lieu: "Koh Muk", zone: "", localite: "Koh Mook", source_url: "https://exemple.test/paradise", certitude: "probable", explication: "" },
    ],
  };
  const r = validerSituer(v, { hotels, lieux, sources: [{ url: "https://exemple.test/paradise", titre: "Paradise" }] });
  const [a, b, c, d] = r.hotels;
  assert.equal(a.lieu, "Koh Phi Phi", "le lieu est recopié sous sa forme du catalogue");
  assert.equal(a.certitude, "sure");
  assert.equal(a.zone, "Tonsai Bay");
  assert.deepEqual(a.source, { url: "https://exemple.test/paradise", titre: "Paradise" });
  assert.equal(b.lieu, "", "une source qui n'est pas un résultat de la recherche ne compte pas");
  assert.equal(b.certitude, "inconnue");
  assert.equal(b.zone, "", "sans source, rien de ce que l'assistant affirme n'est gardé");
  assert.equal(c.lieu, "", "« Koh Muk » n'est pas un lieu de la liste");
  assert.equal(c.localite, "Koh Mook", "la localité en clair reste montrée à Anaïs");
  assert.equal(d.certitude, "inconnue", "un hôtel oublié par l'assistant reste à situer");
});

// ---- 3. Trajets, marge ---------------------------------------------------------------------------------------------------------------

const ETAPES = [
  { hotel: "Krabi Front Bay Resort", du: "2027-01-18", au: "2027-01-21", lieu: "" },
  { hotel: "Breizh Cape Beach Bungalows", du: "2027-01-21", au: "2027-01-25", lieu: "Koh Lanta" },
  { hotel: "Paradise Resort Phi Phi", du: "2027-01-25", au: "2027-01-28", lieu: "Koh Phi Phi" },
  { hotel: "Koo Mook Sunrise Beach", du: "2027-01-28", au: "2027-01-31", lieu: "Koh Mook" },
  { hotel: "Dugong Libong Resort", du: "2027-01-31", au: "2027-02-03", lieu: "Koh Libong" },
];

test("trajets : un par changement d'hôtel, le jour de l'arrivée suivante ; lieu manquant, même lieu, dates qui ne se suivent pas", () => {
  const legs = trajetsEntreEtapes(ETAPES);
  assert.equal(legs.length, 4);
  assert.deepEqual(legs.map((l) => [l.date, l.de, l.vers]), [["2027-01-21", "", "Koh Lanta"], ["2027-01-25", "Koh Lanta", "Koh Phi Phi"], ["2027-01-28", "Koh Phi Phi", "Koh Mook"], ["2027-01-31", "Koh Mook", "Koh Libong"]]);
  assert.equal(legs[0].incomplet, true);
  assert.equal(legs[1].deHotel, "Breizh Cape Beach Bungalows");
  const deux = trajetsEntreEtapes([{ hotel: "A", lieu: "Lanta", du: "2027-01-01", au: "2027-01-03" }, { hotel: "B", lieu: "Koh Lanta", du: "2027-01-04", au: "2027-01-06" }]);
  assert.equal(deux[0].memeLieu, true);
  assert.equal(deux[0].ecartDates, true);
  assert.equal(cleLieu("Koh Phi Phi Island"), cleLieu("Phi Phi"));
  assert.notEqual(cleLieu("Krabi"), cleLieu("Krabi Airport"));
});

test("marge : vente moins net, pour le groupe ; sans net, pas de classement", () => {
  assert.deepEqual(margeDepart(TRAJETS[0], netDe(TRAJETS[0]), { adultes: 2, enfants: 1 }), { adulte: 200, enfant: 200, groupe: 600 });
  assert.deepEqual(margeDepart(TRAJETS[2], netDe(TRAJETS[2]), {}), { adulte: 200, enfant: 100, groupe: 200 }, "sans personnes connues : un adulte");
  assert.equal(margeDepart(TRAJETS[0], null, { adultes: 2 }), null);
  assert.equal(margeDepart(TRAJETS[0], { net_adulte: 700, net_enfant: null }, { adultes: 2, enfants: 1 }), null, "un enfant sans net enfant : marge inconnue");
});

test("départs : Lanta → Phi Phi, Satun l'emporte pour une famille (marge enfant), ses deux horaires sont proposés, Bundhaya reste visible pour Anaïs", () => {
  const leg = trajetsEntreEtapes(ETAPES)[1];
  const r = departsDuTrajet(leg, { trajets: TRAJETS, partenaires: PARTENAIRES, netDe, nomPartenaire, adultes: 2, enfants: 1 });
  assert.deepEqual(r.retenus.map((c) => c.trajet.id), ["s1", "s2"], "les deux horaires de la meilleure marge, rangés par heure");
  assert.deepEqual(r.autres.map((a) => a.nom), ["Bundhaya"]);
  assert.ok(!r.candidats.some((c) => c.trajet.id === "m1"), "un prestataire masqué ne se propose jamais");
  assert.deepEqual(r.meilleure, { adulte: 200, enfant: 200, groupe: 600 });
  // Deux adultes seuls : 200 par adulte des deux côtés, tous les horaires des deux compagnies.
  const adultes = departsDuTrajet(leg, { trajets: TRAJETS, partenaires: PARTENAIRES, netDe, nomPartenaire, adultes: 2 });
  assert.deepEqual(adultes.retenus.map((c) => c.trajet.id), ["s1", "b1", "s2"], "à marge égale, tous les horaires");
  assert.equal(adultes.autres.length, 0);
});

test("départs : marge égale entre deux compagnies (Phi Phi → Mook, lieux écrits autrement), sans nets, hors catalogue, hors saison", () => {
  const legs = trajetsEntreEtapes(ETAPES);
  const mook = departsDuTrajet(legs[2], { trajets: TRAJETS, partenaires: PARTENAIRES, netDe, adultes: 2 });
  assert.deepEqual(mook.retenus.map((c) => c.trajet.id), ["p1", "p2"]);
  const sansNets = departsDuTrajet(legs[1], { trajets: TRAJETS, partenaires: PARTENAIRES, netDe: () => null, adultes: 2 });
  assert.equal(sansNets.sansMarge, true);
  assert.equal(sansNets.retenus.length, 3, "sans le droit de lire les nets, tous les horaires");
  assert.deepEqual(departsDuTrajet(legs[3], { trajets: TRAJETS, partenaires: PARTENAIRES, netDe }).retenus, [], "Mook → Libong n'est pas au catalogue");
  const lipe = { index: 0, date: "2027-01-10", de: "Koh Lanta", vers: "Koh Lipe" };
  assert.equal(departsDuTrajet(lipe, { trajets: TRAJETS, partenaires: PARTENAIRES, netDe }).retenus.length, 0, "hors de sa fenêtre de circulation, le trajet ne se propose pas");
});

// ---- Faits pour la réponse : jamais un net, une marge ni une compagnie ----------------------------------------------------------------

const propositionsDe = (etapes, pax) => trajetsEntreEtapes(etapes).map((leg) => ({ leg, departs: departsDuTrajet(leg, { trajets: TRAJETS, partenaires: PARTENAIRES, netDe, nomPartenaire, ...pax }) }));

test("faits : dates, lieux, horaires et prix de vente seulement ; un groupe par prix ; ce qui manque est signalé", () => {
  const etapes = ETAPES.slice(1);
  const f = faitsReponse({ itineraire: { prenom: "Claire", adultes: 2, enfants: 0 }, propositions: propositionsDe(etapes, { adultes: 2 }), devise: "THB", langue: "fr" });
  const texte = JSON.stringify(f);
  for (const interdit of ["Satun", "Bundhaya", "Ferry du sud", "net", "marge", "partenaire", "satun", "bundhaya"]) assert.ok(!texte.includes(interdit), interdit);
  assert.deepEqual(f.trajets.map((t) => [t.date, t.de, t.vers, t.au_catalogue, t.prix_adulte]), [
    ["2027-01-25", "Koh Lanta", "Koh Phi Phi", true, 900],
    ["2027-01-28", "Koh Phi Phi", "Koh Mook", true, 1500],
    ["2027-01-28", "Koh Phi Phi", "Koh Mook", true, 1300],
    ["2027-01-31", "Koh Mook", "Koh Libong", false, null],
  ]);
  assert.deepEqual(f.trajets[0].horaires, [{ depart: "09:30", arrivee: "11:00" }, { depart: "10:30", arrivee: "11:30" }, { depart: "13:30", arrivee: "15:00" }]);
  const v = verifierFaitsItineraire(f);
  assert.equal(v.ok, true, "la fonction accepte exactement ces faits");
  assert.equal(v.faits.trajets[3].horaires.length, 0);
});

test("faits : la fonction refuse toute clé en plus (net, compagnie), même cachée dans un horaire", () => {
  const base = { langue: "fr", prenom: "", adultes: 2, enfants: 0, bebes: 0, devise: "THB", trajets: [{ date: "2027-01-25", de: "Koh Lanta", vers: "Koh Phi Phi", au_catalogue: true, mode: "Speedboat", duree: "1 h", horaires: [{ depart: "09:30", arrivee: "11:00" }], prix_adulte: 900, prix_enfant: 700, a_payer_sur_place: false }] };
  assert.equal(verifierFaitsItineraire(base).ok, true);
  assert.deepEqual(verifierFaitsItineraire({ ...base, trajets: [{ ...base.trajets[0], net_adulte: 700 }] }).cles, ["net_adulte"]);
  assert.deepEqual(verifierFaitsItineraire({ ...base, trajets: [{ ...base.trajets[0], horaires: [{ depart: "09:30", compagnie: "Satun" }] }] }).cles, ["compagnie"]);
  assert.deepEqual(verifierFaitsItineraire({ ...base, marge: 1 }).cles, ["marge"]);
  assert.equal(verifierFaitsItineraire({ ...base, trajets: [] }).ok, false);
  const absent = verifierFaitsItineraire({ ...base, trajets: [{ ...base.trajets[0], au_catalogue: false }] }).faits.trajets[0];
  assert.deepEqual([absent.prix_adulte, absent.horaires.length, absent.mode], [null, 0, ""], "un trajet hors catalogue ne porte aucun prix ni horaire");
});

test("réponse : prompt avec la voix de l'entreprise et la règle « je peux me renseigner » ; contrôle des montants, heures et mots internes", () => {
  const faits = verifierFaitsItineraire(faitsReponse({ itineraire: { adultes: 2 }, propositions: propositionsDe(ETAPES.slice(1), { adultes: 2 }), langue: "fr" })).faits;
  const p = promptReponseItineraire({ faits, voix: { fr: "Voix de {entreprise}.", en: "" }, responsable: "Nani", entreprise: "Secret Travel & Tour" });
  assert.match(p.system[0].text, /Voix de Secret Travel & Tour\./);
  assert.match(p.system[0].text, /nous ne proposons pas ce trajet, mais que tu peux te renseigner/);
  assert.match(p.system[0].text, /Jamais de nom de compagnie/);
  assert.match(p.messages[0].content, /Langue de la réponse : français/);
  const bon = validerReponseItineraire({ message: "Bonjour,\n25 janvier, Koh Lanta → Koh Phi Phi : 09:30 ou 13:30, 900 THB par adulte.\nNous ne proposons pas Koh Mook → Koh Libong, mais je peux me renseigner 😊", prix_cites: [900], manques: [] }, faits);
  assert.deepEqual(bon.avertissements, []);
  const mauvais = validerReponseItineraire({ message: "Total 1 800 THB, départ 08:15 avec la meilleure marge.", prix_cites: [], manques: [] }, faits);
  assert.deepEqual(mauvais.avertissements, ["montant_hors_base:1800", "heure_hors_base:08:15", "mot_interne:marge"]);
  assert.equal(validerReponseItineraire({ message: "" }, faits).ok, false);
});

// ---- 4. Hôtels gardés, création du dossier ---------------------------------------------------------------------------------------------

test("hôtels gardés : un hôtel déjà situé ne se cherche plus ; non tranché, il peut être relancé ; le lieu écrit par le client sert", () => {
  const lignes = [ligneHotel({ nom: "Paradise Resort Phi Phi", lieu: "Koh Phi Phi", zone: "Tonsai", source: { url: "https://exemple.test/p", titre: "P" }, certitude: "sure" }), ligneHotel({ nom: "Koo Mook Sunrise Beach", certitude: "inconnue" })];
  assert.equal(lignes[0].cle, "paradise resort phi phi");
  assert.ok(hotelConnu("PARADISE  Resort, Phi-Phi", lignes));
  const etapes = [{ hotel: "Paradise Resort Phi Phi" }, { hotel: "Koo Mook Sunrise Beach" }, { hotel: "Dugong Libong Resort" }, { hotel: "Lanta Sand", lieu: "Koh Lanta" }];
  assert.deepEqual(hotelsAChercher(etapes, lignes), ["Koo Mook Sunrise Beach", "Dugong Libong Resort"]);
  const c = completerEtape({ hotel: "Paradise Resort Phi Phi", du: "2027-01-25" }, { lignes, lieux: ["Koh Phi Phi"] });
  assert.equal(c.lieu, "Koh Phi Phi");
  assert.equal(c.origine, "table");
  assert.deepEqual(c.source, { url: "https://exemple.test/p", titre: "P" });
  assert.equal(completerEtape({ hotel: "Inconnu", lieu_ecrit: "Lanta" }, { lieux: ["Koh Lanta"] }).lieu, "Koh Lanta");
  assert.equal(completerEtape({ hotel: "Inconnu", lieu_ecrit: "Lanta" }, { lieux: ["Koh Lanta"] }).origine, "message");
  assert.equal(ligneHotel({ nom: "x", certitude: "certaine" }).certitude, "inconnue");
});

test("zone de pickup : la zone notée pour l'hôtel est proposée quand ni la mémoire ni l'adresse ne disent rien", () => {
  const grilles = [{ index: 0, titre: "Pickup à Lanta", colonnes: ["Bateau 10h30"], zones: [{ cle: "0:0", nom: "Klong Dao", heures: ["09:40"] }, { cle: "0:1", nom: "Relax Bay", heures: ["09:20"] }] }];
  assert.deepEqual(zoneProposee("Breizh Cape Beach Bungalows", grilles, [], "Relax Bay"), { cle: "0:1", origine: "fiche" });
  assert.equal(zoneProposee("Breizh Cape Beach Bungalows", grilles, [], ""), null);
  assert.deepEqual(zoneProposee("Klong Dao Resort", grilles, [], "Relax Bay"), { cle: "0:0", origine: "adresse" }, "l'adresse passe avant la fiche");
});

test("création : un service par trajet choisi, avec l'hôtel de la veille comme lieu de pickup", () => {
  const legs = trajetsEntreEtapes(ETAPES);
  const { d, services } = servicesDepuisChoix({ itineraire: { prenom: "Claire", adultes: 2, enfants: 1, langue: "fr", remarques: "Bagages : deux valises." }, legs, choix: { 1: "s2", 2: "p1" } });
  assert.deepEqual(services.map((s) => [s.date, s.offres[0].id, s.hotelDepart, s.adultes, s.enfants]), [["2027-01-25", "s2", "Breizh Cape Beach Bungalows", 2, 1], ["2027-01-28", "p1", "Paradise Resort Phi Phi", 2, 1]]);
  assert.equal(d.nom, "Claire");
  assert.equal(d.hotel, "Breizh Cape Beach Bungalows");
  assert.equal(d.remarquesIA, "Bagages : deux valises.");
  assert.equal(servicesDepuisChoix({ itineraire: {}, legs, choix: {} }).services.length, 0);
});

// ---- Démonstration -------------------------------------------------------------------------------------------------------------------

test("démo : le message de référence donne ses cinq étapes, les hôtels dont le nom dit le lieu sont situés, la réponse suit les faits", () => {
  const r = simulerItineraire(MESSAGE, AJD);
  assert.deepEqual(r.itineraire.etapes.map((e) => [e.hotel, e.du, e.au]), [
    ["Krabi Front Bay Resort", "2027-01-18", "2027-01-21"],
    ["Breizh Cape Beach Bungalows", "2027-01-21", "2027-01-25"],
    ["Paradise Resort Phi Phi", "2027-01-25", "2027-01-28"],
    ["Koo Mook Sunrise Beach", "2027-01-28", "2027-01-31"],
    ["Dugong Libong Resort", "2027-01-31", "2027-02-03"],
  ]);
  assert.equal(r.itineraire.langue, "fr");
  const s = simulerSituer(["Paradise Resort Phi Phi", "Breizh Cape Beach Bungalows"], ["Koh Lanta", "Koh Phi Phi"]);
  assert.equal(s.hotels[0].lieu, "Koh Phi Phi");
  assert.equal(s.hotels[1].certitude, "inconnue");
  const faits = faitsReponse({ itineraire: { adultes: 2 }, propositions: propositionsDe(ETAPES.slice(1), { adultes: 2 }), langue: "fr" });
  const rep = simulerReponse(faits);
  assert.match(rep.message, /Nous ne proposons pas ce trajet, mais je peux me renseigner\./);
  assert.deepEqual(validerReponseItineraire({ message: rep.message, prix_cites: [] }, verifierFaitsItineraire(faits).faits).avertissements, [], "le brouillon simulé passe le même contrôle que celui de l'assistant");
});
