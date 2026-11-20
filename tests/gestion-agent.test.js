// Agent de l'onglet « Assistant » : calcul des heures, outils, garde-fous (aucun net ni prestataire chez Claude, aucun prix inventé,
// pas de signature chez Secret et Taxi), consignes et coût. Données fictives, aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planifierCourse, tempsSimule, reglagesPlanning, versHeure } from "../supabase/functions/agent/planifier.js";
import { dureeEntre, ligneDeLaTable, zoneDuLieu, minutesDe, dureesTapees, lignesDuSite, lignesDesBateaux, lignesDesZones, lignesNouvelles, clePaire, lireItineraire, lireGeocode, corpsItineraire, parametresGeocode } from "../supabase/functions/agent/temps.js";
import { lireEstimation } from "../supabase/functions/agent/estimation.js";
import { dureeAvecFerry as dureeAvecFerryDe } from "../supabase/functions/agent/temps.js";
import { OUTILS, executer, entreeValide, memoDepuis, refDe, trouverRef, controlerReponse, montantsTapes } from "../supabase/functions/agent/outils.js";
import { consignes, controlerAcces, parametres, ligneJournal, coutEchange, historique, titreDepuis, signe } from "../supabase/functions/agent/prompt.js";

const ENT = "11111111-1111-4111-8111-111111111111";
const PA = "aaaaaaaa-0000-4000-8000-000000000001";
const PB = "bbbbbbbb-0000-4000-8000-000000000002";
const donnees = {
  partenaires: [
    { id: PA, nom: "Blue Ocean Speedboat", actif: true },
    { id: PB, nom: "Satun Lines", actif: true },
  ],
  prestations: [
    { id: "a1000000-0000-4000-8000-000000000001", famille: "excursion", groupe: "4 Islands", libelle: "4 îles en long-tail", libelle_en: "4 Islands long-tail", prix_vente: 1500, unite: "pers", partenaire_id: PA, actif: true },
    { id: "a2000000-0000-4000-8000-000000000002", famille: "excursion", groupe: "4 Islands", libelle: "4 îles en long-tail", libelle_en: "4 Islands long-tail", prix_vente: 1500, unite: "pers", partenaire_id: PB, actif: true },
    { id: "a3000000-0000-4000-8000-000000000003", famille: "frais", groupe: "4 Islands", libelle: "Frais de parc", prix_vente: 400, unite: "pers", partenaire_id: PA, actif: true },
  ],
  prestations_nets: [
    { prestation_id: "a1000000-0000-4000-8000-000000000001", net: 1100 },
    { prestation_id: "a2000000-0000-4000-8000-000000000002", net: 900 },
  ],
  trajets: [
    { id: "f1000000-0000-4000-8000-000000000001", de: "Koh Lanta", vers: "Koh Phi Phi", mode: "Blue Ocean Speedboat", depart: "09:00", arrivee: "10:00", duree: "1 h", prix_adulte: 1200, prix_enfant: 900, partenaire_id: PA, actif: true, fenetres: [] },
    { id: "f2000000-0000-4000-8000-000000000002", de: "Koh Lanta", vers: "Koh Phi Phi", mode: "ferry", depart: "08:00", arrivee: "09:30", duree: "1 h 30", prix_adulte: 1200, prix_enfant: 900, partenaire_id: PB, actif: true, fenetres: [] },
    { id: "f3000000-0000-4000-8000-000000000003", de: "Koh Lanta", vers: "Koh Phi Phi", mode: "ferry", depart: "13:00", arrivee: "14:30", duree: "1 h 30", prix_adulte: 1200, prix_enfant: 900, partenaire_id: PB, actif: true, fenetres: [["2026-11-01", "2027-04-30"]] },
  ],
  trajets_nets: [
    { trajet_id: "f1000000-0000-4000-8000-000000000001", net_adulte: 1000, net_enfant: 800 },
    { trajet_id: "f2000000-0000-4000-8000-000000000002", net_adulte: 800, net_enfant: 600 },
    { trajet_id: "f3000000-0000-4000-8000-000000000003", net_adulte: 800, net_enfant: 600 },
  ],
  hotels_lieux: [{ cle: "paradise resort phi phi", nom: "Paradise Resort Phi Phi", lieu: "Koh Phi Phi", zone: "Loh Dalum", localite: "Koh Phi Phi", source_url: "https://exemple.test", certitude: "sure", verifie: true }],
  clients: [{ id: "c1000000-0000-4000-8000-000000000001", prenom: "Claire", nom: "Martin", telephone: "+41 79 000 00 00" }],
  dossiers: [{ id: "d1000000-0000-4000-8000-000000000001", ref: "2026-0142", client_id: "c1000000-0000-4000-8000-000000000001", date_depart: "2026-11-21", date_retour: "2026-11-28", annule: false }],
  reservations: [{ id: "e1000000-0000-4000-8000-000000000001", dossier_id: "d1000000-0000-4000-8000-000000000001", libelle: "Transfert Lanta → Krabi Airport", date_service: "2026-11-28", heure_pickup: "09:00", lieu_pickup: "Hotel Sunset", personnes: { adultes: 2 }, statut: "confirme", montant_vente: 2800 }],
};
const ctxDe = (extra = {}) => ({ charger: async (nom) => donnees[nom] || [], reglages: {}, simule: tempsSimule, ...extra });
const nouveauMemo = (o = {}) => ({ prix: new Set(), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), signer: false, prestataires: donnees.partenaires.map((p) => p.nom), entreprise: "VIP Taxi Lanta", ...o });
// Ce qui repart chez Claude, en texte : aucune trace d'un net ni d'un nom de prestataire.
const sansFuite = (contenu) => {
  const t = JSON.stringify(contenu);
  for (const n of ["Blue Ocean", "Satun", "1100", "net", "marge", PA, PB]) assert.ok(!t.includes(n), `fuite de « ${n} » dans ${t.slice(0, 200)}`);
};

// ---- Planning ----------------------------------------------------------------------------------------------------------------

test("cas Jai Tiki : pickup à rebours, rendez-vous à 16:00, une heure d'attente, aéroport", () => {
  const p = planifierCourse({
    date: "2026-11-21",
    points: [{ lieu: "Jai Tiki Retreat, Koh Lanta" }, { lieu: "Krabi Nakharin International Hospital", arrivee_voulue: "16:00", attente_min: 60 }, { lieu: "Krabi International Airport" }],
    trajets: [{ duree_min: 160, ferry: true, source: "google" }, { duree_min: 25, ferry: false, source: "google" }],
  });
  assert.equal(p.ok, true);
  // 160 min de route + 30 d'attente au ferry + 16 de marge = 206 : 16:00 − 3 h 26 = 12:34, arrondi à 12:30.
  assert.equal(p.pickup.heure, "12:30");
  assert.equal(p.etapes[1].arrivee_prevue.heure, "15:40");
  assert.equal(p.etapes[1].depart.heure, "17:00");
  assert.equal(p.etapes[2].arrivee_prevue.heure, "17:25");
  assert.equal(p.etapes[2].arrivee_au_plus_tard.heure, "17:35");
  assert.deepEqual(p.alertes, []);
  assert.ok(p.hypotheses.some((h) => h.includes("ferry")));
});

test("vol : tenable, juste ou pas tenable selon l'avance demandée", () => {
  const base = { date: "2026-11-21", points: [{ lieu: "A, Koh Lanta" }, { lieu: "Hôpital", arrivee_voulue: "16:00", attente_min: 60 }, { lieu: "Aéroport" }], trajets: [{ duree_min: 160, ferry: true }, { duree_min: 25 }] };
  assert.equal(planifierCourse({ ...base, vol: { heure: "20:00", international: false } }).vol.verdict, "tenable");
  assert.equal(planifierCourse({ ...base, vol: { heure: "19:30", international: false } }).vol.verdict, "juste");
  const pas = planifierCourse({ ...base, vol: { heure: "19:00", international: false } });
  assert.equal(pas.vol.verdict, "pas_tenable");
  assert.ok(pas.alertes.includes("vol_pas_tenable"));
  assert.equal(planifierCourse({ ...base, vol: { heure: "20:00", international: true } }).vol.verdict, "pas_tenable");
});

test("planning vers l'avant depuis un pickup fixé, et pickup la veille signalé", () => {
  const p = planifierCourse({ date: "2026-11-21", points: [{ lieu: "Hôtel", depart_voulu: "08:00" }, { lieu: "Aéroport" }], trajets: [{ duree_min: 150, ferry: true }] });
  assert.equal(p.pickup.heure, "08:00");
  assert.equal(p.etapes[1].arrivee_prevue.heure, "11:00");
  assert.equal(p.etapes[1].arrivee_au_plus_tard.heure, "11:15");
  const tot = planifierCourse({ date: "2026-11-21", points: [{ lieu: "Hôtel" }, { lieu: "Aéroport", arrivee_voulue: "01:00" }], trajets: [{ duree_min: 150, ferry: false }] });
  assert.equal(tot.pickup.date, "2026-11-20");
  assert.ok(tot.alertes.includes("pickup_la_veille"));
});

test("planning refusé sans durée, sans heure ou sans date ; réglages bornés", () => {
  assert.equal(planifierCourse({ date: "2026-11-21", points: [{ lieu: "A" }, { lieu: "B", arrivee_voulue: "10:00" }], trajets: [{ duree_min: 0 }] }).erreur, "duree_inconnue");
  assert.equal(planifierCourse({ date: "2026-11-21", points: [{ lieu: "A" }, { lieu: "B" }], trajets: [{ duree_min: 30 }] }).erreur, "heure_manquante");
  assert.equal(planifierCourse({ date: "", points: [], trajets: [] }).erreur, "date_manquante");
  assert.deepEqual(reglagesPlanning({ agent_planning: { marge_pct: 500, ferry_attente_min: "x" } }).marge_pct, 50);
  assert.equal(reglagesPlanning({ agent_planning: { ferry_attente_min: "x" } }).ferry_attente_min, 30);
});

test("openrouteservice : corps de l'itinéraire, lecture de la durée et du ferry, géocodage du seul nom de lieu", () => {
  assert.deepEqual(corpsItineraire({ lon: 99.1, lat: 7.5 }, { lon: 98.9, lat: 8.1 }), { coordinates: [[99.1, 7.5], [98.9, 8.1]], extra_info: ["waycategory"] });
  const r = lireItineraire({ routes: [{ summary: { duration: 9300, distance: 104500 }, extras: { waycategory: { values: [[0, 10, 0], [10, 12, 8]] } } }] });
  assert.deepEqual(r, { duree_min: 155, distance_km: 104.5, ferry: true });
  assert.equal(lireItineraire({ routes: [] }), null);
  assert.equal(parametresGeocode("Jai Tiki Retreat, Koh Lanta").get("boundary.country"), "TH");
  assert.deepEqual(lireGeocode({ features: [{ geometry: { coordinates: [99.05, 7.55] }, properties: { label: "Jai Tiki, Koh Lanta, TH", confidence: 0.8 } }] }), { lon: 99.05, lat: 7.55, label: "Jai Tiki, Koh Lanta, TH", confiance: 0.8 });
  assert.equal(versHeure("2026-11-21", 25 * 60).date, "2026-11-22");
});

test("table de temps : zone la plus précise, aller et retour, hôtel connu par sa zone", () => {
  const lignes = [
    { de: "Koh Lanta", vers: "Krabi Airport", duree_min: 150, ferry: true, a_verifier: false },
    { de: "Koh Lanta", vers: "Krabi Town", duree_min: 165, ferry: true, a_verifier: true },
  ];
  const zones = ["Koh Lanta", "Krabi Airport", "Krabi Town", "Krabi"];
  assert.equal(zoneDuLieu("Krabi International Airport", zones), "Krabi Airport");
  assert.equal(zoneDuLieu("Krabi town centre", zones), "Krabi Town");
  assert.equal(ligneDeLaTable("Krabi Airport", "Lanta Sand Resort, Koh Lanta", lignes).duree_min, 150);
  const hotels = [{ cle: "jai tiki retreat", lieu: "Koh Lanta", zone: "Klong Nin" }];
  assert.equal(ligneDeLaTable("Jai Tiki Retreat", "Krabi Airport", lignes, hotels).duree_min, 150);
  assert.equal(ligneDeLaTable("Phuket", "Krabi Airport", lignes), null);
});

test("ordre des durées (Jérémy, 19.11.2026) : OpenStreetMap d'abord, puis la table, puis la table à vérifier, puis rien ; jamais inventée", async () => {
  const lignes = [{ de: "Koh Lanta", vers: "Krabi Airport", duree_min: 150, ferry: true, marge_min: 20, a_verifier: false }, { de: "Koh Lanta", vers: "Krabi Town", duree_min: 180, ferry: true, a_verifier: true }];
  const ors = async () => ({ duree_min: 140, distance_km: 110, ferry: false, de_trouve: "Koh Lanta, TH", vers_trouve: "Krabi, TH" });
  const o = await dureeEntre("Koh Lanta", "Krabi Airport", { lignes, ors });
  assert.equal(o.source, "ors");
  assert.equal(o.duree_min, 140);
  assert.equal(o.marge_min, 20, "la marge conseillée de la table s'ajoute à OpenStreetMap");
  assert.equal(o.ferry, true, "le ferry de la ligne de la table aussi");
  assert.equal(o.de_trouve, "Koh Lanta, TH");
  assert.equal((await dureeEntre("Koh Lanta", "Krabi Airport", { lignes, ors: async () => null })).source, "table");
  assert.equal((await dureeEntre("Koh Lanta", "Krabi Town", { lignes, ors: async () => null })).source, "table_a_verifier");
  assert.equal(await dureeEntre("Phuket", "Hat Yai", { lignes, ors: async () => null }), null);
});

test("ports du ferry de Lanta en thaï : variantes de recherche et île reconnue", async () => {
  const { variantesLieu, liaisonPour } = await import("../supabase/functions/agent/temps.js");
  assert.deepEqual(variantesLieu("ท่าเรือคลองหมาก (Khlong Mak Pier), Koh Lanta Noi"), ["ท่าเรือคลองหมาก (Khlong Mak Pier), Koh Lanta Noi", "ท่าเรือคลองหมาก, Koh Lanta Noi", "Khlong Mak Pier, Koh Lanta Noi", "ท่าเรือคลองหมาก (Khlong Mak Pier), Ko Lanta Noi", "ท่าเรือคลองหมาก, Ko Lanta Noi", "Khlong Mak Pier, Ko Lanta Noi"]);
  assert.deepEqual(variantesLieu("ท่าเรือกระบี่-เกาะลันตา, Krabi"), ["ท่าเรือกระบี่-เกาะลันตา, Krabi"]);
  const l = { nom: "Ferry de Koh Lanta", cote_ile: "Koh Lanta", port_ile: "ท่าเรือคลองหมาก (Khlong Mak Pier), Koh Lanta Noi", port_continent: "ท่าเรือกระบี่-เกาะลันตา, Krabi", duree_min: 60 };
  // Le port côté continent n'est pas sur l'île, celui de Khlong Mak l'est.
  assert.equal(liaisonPour(l.port_continent, "Krabi Airport", [l]), null);
  assert.equal(liaisonPour(l.port_ile, "Jai Tiki Retreat, Koh Lanta", [l]), null);
  assert.equal(liaisonPour("Jai Tiki Retreat, Koh Lanta", "Krabi Airport", [l]).depuisIle, true);
});

test("durées écrites : fourchette à sa borne haute, durées tapées par la personne", () => {
  assert.equal(minutesDe("about 2 to 3 hours"), 180);
  assert.equal(minutesDe("about 1h30 to 2 hours"), 120);
  assert.equal(minutesDe("1 h 30"), 90);
  assert.equal(minutesDe("50 min"), 50);
  assert.equal(minutesDe("about 45 minutes"), 45);
  assert.equal(minutesDe("à voir"), null);
  assert.deepEqual([...dureesTapees(["Compte 2h30 jusqu'à l'hôpital, puis 25 min"])].sort(), [150, 25]);
  assert.deepEqual([...dureesTapees(["Vol à 20h00, rendez-vous vers 16h, compte 3h"])], [180]);
});

test("pré-remplissage : pages taxi, durées des bateaux, grilles de pickup, toutes à vérifier, sans écraser la table", () => {
  const site = lignesDuSite([{ from: "Krabi Airport", to: "Koh Lanta", drive: "about 2 to 3 hours" }, { from: "Krabi Airport", to: "Khao Lak", drive: null }]);
  assert.deepEqual(site.map((l) => [l.duree_min, l.ferry, l.a_verifier, l.origine]), [[180, true, true, "site"]]);
  const bateaux = lignesDesBateaux(donnees.trajets);
  assert.equal(bateaux.length, 1);
  assert.equal(bateaux[0].duree_min, 90);
  assert.ok(!JSON.stringify(bateaux).includes("Blue Ocean"));
  const zones = lignesDesZones([{ colonnes: ["Bateau 10h30"], zones: [{ nom: "Klong Dao", heures: ["09:40"] }, { nom: "Klong Nin", heures: ["09:10"] }] }], "Koh Lanta");
  assert.deepEqual(zones.map((l) => [l.de, l.vers, l.duree_min]), [["Klong Dao", "Embarcadère, Koh Lanta", 50], ["Klong Nin", "Embarcadère, Koh Lanta", 80]]);
  const nouvelles = lignesNouvelles(site, [{ de: "Koh Lanta", vers: "Krabi Airport", mode: "route" }]);
  assert.equal(nouvelles.length, 0, "une ligne déjà dans la table (dans un sens ou l'autre) n'est pas reprise");
  assert.equal(clePaire("Krabi Airport", "Koh Lanta"), clePaire("Lanta", "aéroport de Krabi"));
});

test("estimation web : gardée seulement avec une source tirée de la recherche, durée plausible", () => {
  const base = { stop_reason: "tool_use", content: [{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://x.test/route", title: "Lanta to Trang" }] }] };
  const avec = (input) => ({ ...base, content: [...base.content, { type: "tool_use", name: "rendre_duree", input }] });
  assert.equal(lireEstimation(avec({ duree_min: 180, ferry: true, source_url: "https://x.test/route", explication: "3 h" })).duree_min, 180);
  assert.equal(lireEstimation(avec({ duree_min: 180, ferry: true, source_url: "https://invente.test", explication: "" })), null);
  assert.equal(lireEstimation(avec({ duree_min: 0, ferry: false, source_url: "", explication: "" })), null);
});

// ---- Outils ------------------------------------------------------------------------------------------------------------------

test("définitions : strictes, tous les champs requis, sans bornes non prises en charge", () => {
  for (const o of OUTILS) {
    assert.equal(o.strict, true, o.name);
    const verifier = (s) => {
      assert.ok(!("minimum" in s) && !("maxLength" in s) && !("minItems" in s), o.name);
      if (s.type === "object") {
        assert.equal(s.additionalProperties, false, o.name);
        assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), o.name);
        Object.values(s.properties).forEach(verifier);
      }
      if (s.type === "array") verifier(s.items);
    };
    verifier(o.input_schema);
  }
  assert.equal(entreeValide("horaires_trajet", { de: "Lanta", vers: "Phi Phi", date: "", adultes: 2, enfants: 0 }), true);
  assert.equal(entreeValide("horaires_trajet", { de: "Lanta", vers: "Phi Phi" }), false);
  assert.equal(entreeValide("horaires_trajet", { de: "Lanta", vers: "Phi Phi", date: "", adultes: -1, enfants: 0, x: 1 }), false);
});

test("catalogue : prix de vente et drapeau « recommande », jamais un net ni un prestataire", async () => {
  const memo = nouveauMemo();
  const r = await executer("chercher_catalogue", { recherche: "4 islands", famille: "tout" }, ctxDe(), memo);
  sansFuite(r.contenu);
  // Les frais de parc ne se proposent pas seuls.
  assert.equal(r.contenu.nombre, 2);
  const reco = r.contenu.lignes.filter((l) => l.recommande);
  assert.equal(reco.length, 1);
  assert.equal(reco[0].ref, refDe("P", "a2000000-0000-4000-8000-000000000002"));
  assert.ok(memo.prix.has(1500));
});

test("catalogue sans droit aux nets : aucune recommandation", async () => {
  const r = await executer("chercher_catalogue", { recherche: "4 islands", famille: "excursion" }, ctxDe({ charger: async (n) => (n.endsWith("_nets") ? [] : donnees[n] || []) }), nouveauMemo());
  assert.ok(r.contenu.lignes.every((l) => !l.recommande));
});

test("horaires : départs du jour, compagnie à la meilleure marge mise en avant, noms retirés", async () => {
  const memo = nouveauMemo();
  const r = await executer("horaires_trajet", { de: "Lanta", vers: "Phi Phi Island", date: "2026-12-05", adultes: 2, enfants: 0 }, ctxDe(), memo);
  sansFuite(r.contenu);
  assert.equal(r.contenu.trouve, true);
  assert.deepEqual(r.contenu.departs.filter((d) => d.recommande).map((d) => d.depart), ["08:00", "13:00"]);
  assert.equal(r.contenu.departs.find((d) => d.depart === "09:00").mode, "");
  assert.ok(memo.heures.has("08:00"));
  // Hors de la fenêtre de circulation, le départ de 13:00 disparaît.
  const ete = await executer("horaires_trajet", { de: "Koh Lanta", vers: "Koh Phi Phi", date: "2027-06-01", adultes: 1, enfants: 0 }, ctxDe(), nouveauMemo());
  assert.deepEqual(ete.contenu.departs.map((d) => d.depart).sort(), ["08:00", "09:00"]);
  const rien = await executer("horaires_trajet", { de: "Koh Lanta", vers: "Koh Libong", date: "", adultes: 0, enfants: 0 }, ctxDe(), nouveauMemo());
  assert.equal(rien.contenu.trouve, false);
  assert.ok(rien.contenu.lieux_connus.includes("Koh Phi Phi"));
});

test("hôtels : connus dans la table, sinon recherche web, sinon à demander", async () => {
  let cherches = null;
  const r = await executer("situer_hotels", { noms: ["Paradise Resort Phi Phi", "Jai Tiki Retreat"] }, ctxDe({ situerWeb: async (n) => ((cherches = n), [{ nom: "Jai Tiki Retreat", lieu: "Koh Lanta", zone: "Klong Nin", localite: "Koh Lanta", certitude: "sure", source: { url: "https://x.test" } }]) }), nouveauMemo());
  assert.deepEqual(cherches, ["Jai Tiki Retreat"]);
  assert.equal(r.contenu.hotels[0].certitude, "verifie");
  assert.equal(r.contenu.hotels[1].lieu, "Koh Lanta");
  const sans = await executer("situer_hotels", { noms: ["Inconnu Resort"] }, ctxDe(), nouveauMemo());
  assert.equal(sans.contenu.hotels[0].certitude, "inconnue");
});

test("planifier_course : temps de route lus, heures calculées en code et retenues pour le contrôle", async () => {
  const memo = nouveauMemo();
  const r = await executer("planifier_course", { date: "2026-11-21", points: [{ lieu: "Jai Tiki Retreat, Koh Lanta", arrivee_voulue: "", attente_min: 0, duree_vers_suivant_min: 0, source_duree: "" }, { lieu: "Krabi Nakharin International Hospital", arrivee_voulue: "16:00", attente_min: 60, duree_vers_suivant_min: 0, source_duree: "" }, { lieu: "Krabi Airport", arrivee_voulue: "", attente_min: 0, duree_vers_suivant_min: 0, source_duree: "" }], heure_depart: "", heure_vol: "", vol_international: false }, ctxDe(), memo);
  assert.equal(r.contenu.ok, true);
  assert.equal(r.contenu.pickup.heure, "12:30");
  assert.ok(r.contenu.alertes.includes("temps_simules"));
  assert.ok(memo.heures.has("12:30") && memo.heures.has("17:25"));
  const sansTemps = await executer("planifier_course", { date: "2026-11-21", points: [{ lieu: "Nulle part", arrivee_voulue: "", attente_min: 0, duree_vers_suivant_min: 0, source_duree: "" }, { lieu: "Ailleurs", arrivee_voulue: "10:00", attente_min: 0, duree_vers_suivant_min: 0, source_duree: "" }], heure_depart: "", heure_vol: "", vol_international: false }, ctxDe({ simule: null }), nouveauMemo());
  assert.equal(sansTemps.contenu.erreur, "temps_indisponible");
  // Une durée tapée par la personne passe ; une durée qu'elle n'a pas écrite est refusée.
  const pts = (d) => [{ lieu: "Nulle part", arrivee_voulue: "", attente_min: 0, duree_vers_suivant_min: d, source_duree: "personne" }, { lieu: "Ailleurs", arrivee_voulue: "10:00", attente_min: 0, duree_vers_suivant_min: 0, source_duree: "" }];
  const donnee = await executer("planifier_course", { date: "2026-11-21", points: pts(150), heure_depart: "", heure_vol: "", vol_international: false }, ctxDe({ simule: null }), nouveauMemo({ durees: new Set([150]) }));
  assert.equal(donnee.contenu.pickup.heure, "07:15");
  const inventee = await executer("planifier_course", { date: "2026-11-21", points: pts(120), heure_depart: "", heure_vol: "", vol_international: false }, ctxDe({ simule: null }), nouveauMemo({ durees: new Set([150]) }));
  assert.equal(inventee.contenu.erreur, "duree_sans_source");
  assert.equal(sansTemps.contenu.erreur, "temps_indisponible");
  assert.equal(sansTemps.erreur, true);
});

test("clients et dossiers : recherche par nom ou téléphone, services sans prestataire", async () => {
  const c = await executer("chercher_clients", { recherche: "martin" }, ctxDe(), nouveauMemo());
  assert.equal(c.contenu.clients[0].dossiers[0].reference, "2026-0142");
  const t = await executer("chercher_clients", { recherche: "079 000 00 00" }, ctxDe(), nouveauMemo());
  assert.equal(t.contenu.nombre, 1);
  const d = await executer("lire_dossier", { dossier: c.contenu.clients[0].dossiers[0].dossier }, ctxDe(), nouveauMemo());
  assert.equal(d.contenu.services[0].heure_pickup, "09:00");
  assert.ok(!JSON.stringify(d.contenu).includes("partenaire"));
  assert.equal((await executer("lire_dossier", { dossier: "2026-0142" }, ctxDe(), nouveauMemo())).contenu.reference, "2026-0142");
});

// ---- Propositions ------------------------------------------------------------------------------------------------------------

const service = (o = {}) => ({ texte: "Transfert", ref: "", date: "2026-11-21", heure_pickup: "12:30", lieu_pickup: "Jai Tiki Retreat", de: "Koh Lanta", vers: "Krabi Airport", adultes: 2, enfants: 0, prix_saisi: "", remarque: "", ...o });

test("dossier proposé : prix du catalogue par la référence, vide pour un transfert privé, jamais celui du modèle", async () => {
  const memo = nouveauMemo();
  const r = await executer("proposer_dossier", { titre: "Dossier test", client_nom: "Claire", client_telephone: "", hotel: "Jai Tiki Retreat", langue: "en", adultes: 2, enfants: 0, bebes: 0, services: [service(), service({ ref: refDe("T", "f2000000-0000-4000-8000-000000000002"), texte: "Ferry" }), service({ prix_saisi: "9999" })] }, ctxDe(), memo);
  const s = r.carte.donnees.services;
  assert.equal(r.carte.genre, "dossier");
  assert.equal(s[0].prix, null);
  assert.equal(s[0].origine_prix, "a_fixer");
  assert.equal(s[1].prix, 2400);
  assert.equal(s[1].origine_prix, "catalogue");
  assert.equal(s[2].prix, null);
  assert.deepEqual(s[2].avertissements, ["prix_non_tape"]);
  assert.equal(r.contenu.carte_affichee, true);
});

test("prix tapé par la personne : accepté seulement s'il est dans la conversation", async () => {
  const memo = nouveauMemo({ tapes: montantsTapes(["Mets 3 500 pour la course stp"]) });
  const r = await executer("proposer_reservation", { titre: "Ajout", dossier: refDe("D", "d1000000-0000-4000-8000-000000000001"), service: service({ prix_saisi: "3500" }) }, ctxDe(), memo);
  assert.equal(r.carte.donnees.service.prix, 3500);
  assert.equal(r.carte.donnees.service.origine_prix, "saisi");
});

test("modification proposée : ancienne et nouvelle valeur, valeur contrôlée", async () => {
  const ref = refDe("R", "e1000000-0000-4000-8000-000000000001");
  const r = await executer("proposer_modification", { titre: "Pickup plus tôt", reservation: ref, champ: "heure_pickup", valeur: "08:30", raison: "Vol avancé" }, ctxDe(), nouveauMemo());
  assert.equal(r.carte.donnees.avant, "09:00");
  assert.equal(r.carte.donnees.valeur, "08:30");
  const faux = await executer("proposer_modification", { titre: "x", reservation: ref, champ: "heure_pickup", valeur: "demain", raison: "" }, ctxDe(), nouveauMemo());
  assert.equal(faux.contenu.erreur, "valeur_invalide");
});

test("réponse au client chez Taxi : signature retirée, montant et heure non sourcés signalés, prestataire signalé", async () => {
  const memo = nouveauMemo({ heures: new Set(["12:30"]), prix: new Set([2400]) });
  const message = "Hello Claire,\n\nPickup at 12:30 at Jai Tiki. The price is 3,200 THB with Satun Lines at 13:15.\n\nHave a nice day,\nNani";
  const r = await executer("proposer_reponse", { titre: "Réponse", langue: "en", message }, ctxDe(), memo);
  assert.ok(!r.carte.donnees.message.includes("Nani"));
  assert.ok(r.carte.avertissements.includes("signature_retiree"));
  assert.ok(r.carte.avertissements.includes("montant_non_source:3200"));
  assert.ok(r.carte.avertissements.includes("heure_non_source:13:15"));
  assert.ok(r.carte.avertissements.includes("nom_prestataire"));
  const propre = controlerReponse("Hello Claire,\n\nPickup at 12:30, 2,400 THB for the transfer 😊", { permisPrix: new Set([2400]), permisHeures: new Set(["12:30"]) });
  assert.deepEqual(propre.avertissements, []);
  // Chez Zwald Travel Planner, la signature d'Anaïs reste.
  assert.ok(controlerReponse("Bonjour,\n\nMerci.\n\nBelle journée, Anaïs", { signer: true }).message.endsWith("Anaïs"));
});

test("mémoire de la conversation : prix et heures des outils, montants et heures tapés", () => {
  const msgs = [
    { role: "user", content: [{ type: "text", text: "Vol à 19:30, mets 3500" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "x", name: "horaires_trajet", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: JSON.stringify({ departs: [{ depart: "08:00", prix_adulte: 1200 }] }) }] },
  ];
  const m = memoDepuis(msgs);
  assert.ok(m.prix.has(1200) && m.heures.has("08:00") && m.heures.has("19:30") && m.tapes.has(3500));
});

test("références courtes : retrouvent la ligne, refusent le reste", () => {
  assert.equal(trouverRef("T-f2000000", donnees.trajets).depart, "08:00");
  assert.equal(trouverRef("T-zzz", donnees.trajets), null);
});

// ---- Consignes, accès, coût --------------------------------------------------------------------------------------------------

test("consignes : Nani sans signature chez Secret et Taxi, Anaïs signe chez ZTP, règles de prix et de planning", () => {
  const taxi = consignes({ entreprise: "VIP Taxi Lanta", reglages: { fonctionnement: "taxi" }, prenomEquipe: "Nani" });
  assert.ok(taxi.includes("Sans aucune signature"));
  assert.ok(taxi.includes("planifier_course"));
  assert.ok(taxi.includes("Ne l'estime jamais"));
  assert.ok(!/Belle journée, Nani/.test(taxi));
  const ztp = consignes({ entreprise: "Zwald Travel Planner", reglages: { fonctionnement: "sur_mesure" }, prenomEquipe: "Anaïs" });
  assert.ok(ztp.includes("Belle journée, Anaïs, Zwald Travel Planner"));
  assert.equal(signe({ fonctionnement: "excursions" }), false);
});

test("paramètres : Opus 5.5 réflexion adaptative, effort explicite, repli, cache, outils", () => {
  const p = parametres({ systeme: "S", contexte: "C", messages: [{ role: "user", content: "x" }] });
  assert.equal(p.model, "claude-opus-5-5");
  assert.deepEqual(p.thinking, { type: "adaptive" });
  assert.equal(p.output_config.effort, "medium");
  assert.equal(p.fallbacks, "default");
  assert.deepEqual(p.tool_choice, { type: "auto" });
  assert.equal(p.system[0].cache_control.type, "ephemeral");
  assert.ok(!("budget_tokens" in p.thinking) && !("temperature" in p));
  const h = parametres({ modele: "claude-haiku-5-5", systeme: "S", contexte: "C", messages: [] });
  assert.ok(!("fallbacks" in h));
});

test("accès : agent allumé à part, droits, limite du jour et plafond du mois", () => {
  const base = { entiteId: ENT, permissions: ["partenaires.lire", "dossiers.ecrire"], reglages: { agent_ia: true }, echangesDuJour: 0, coutDuMois: 0 };
  assert.equal(controlerAcces(base).ok, true);
  assert.equal(controlerAcces({ ...base, reglages: { assistant_ia: true } }).erreur, "agent_eteint");
  assert.equal(controlerAcces({ ...base, permissions: ["partenaires.lire"] }).erreur, "droit_manquant");
  assert.equal(controlerAcces({ ...base, echangesDuJour: 60 }).erreur, "limite_du_jour");
  assert.equal(controlerAcces({ ...base, coutDuMois: 40 }).erreur, "plafond_du_mois");
});

test("journal : usage « agent », jetons additionnés, coût par modèle, aucun contenu", () => {
  const appels = [
    { usage: { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0 }, modele: "claude-opus-5-5" },
    { usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modele: "claude-haiku-5-5" },
  ];
  const l = ligneJournal({ userId: "u", entiteId: ENT, statut: "ok", appels, dureeMs: 1234 });
  assert.equal(l.usage, "agent");
  assert.equal(l.jetons_entree, 3000);
  // Opus : 2000 × 4 + 500 × 20 + 8000 × 0,2 = 19 600 ; Haiku : 1000 × 0,1 + 200 × 0,5 = 200 ; en millionièmes de dollar.
  assert.equal(l.cout_estime_usd, 0.0198);
  assert.equal(coutEchange([]), 0);
  assert.deepEqual(Object.keys(l).sort(), ["cout_estime_usd", "duree_ms", "entite_id", "jetons_cache_ecrits", "jetons_cache_lus", "jetons_entree", "jetons_sortie", "modele", "statut", "usage", "user_id"]);
});

test("historique et titre", () => {
  assert.deepEqual(historique([{ role: "user", contenu: [{ type: "text", text: "a" }] }, { role: "x", contenu: [] }]), [{ role: "user", content: [{ type: "text", text: "a" }] }]);
  assert.equal(titreDepuis("  Pickup Jai Tiki samedi  "), "Pickup Jai Tiki samedi");
  assert.ok(titreDepuis("x ".repeat(60)).endsWith("…"));
});

test("le calcul des heures est le même fichier côté fonction et côté écran", () => {
  for (const [f, g] of [["planifier.js", "agent-planifier.mjs"], ["temps.js", "agent-temps.mjs"]]) {
    const a = readFileSync(new URL(`../supabase/functions/agent/${f}`, import.meta.url), "utf8");
    const b = readFileSync(new URL(`../src/gestion/js/${g}`, import.meta.url), "utf8");
    assert.equal(a, b, f);
  }
});

test("migration 52 : RLS par personne et entreprise, messages sans modification, journal « agent »", () => {
  const sql = readFileSync(new URL("../docs/gestion/migration-52-agent-conversations.sql", import.meta.url), "utf8");
  for (const t of ["agent_conversations", "agent_messages", "agent_cartes"]) assert.ok(sql.includes(`alter table ${t} enable row level security`), t);
  assert.ok(sql.includes("user_id = auth.uid() and a_permission(entite_id, 'dossiers.ecrire')"));
  assert.ok(!/grant[^;]*update[^;]*on agent_messages/.test(sql));
  assert.ok(sql.includes("'agent'"));
  assert.ok(sql.includes("purger_agent_conversations"));
});

test("réponse chez Secret ou Taxi : un prénom de l'équipe dans le message est signalé, pas chez ZTP", () => {
  const msg = "Hello Claire,\n\nI'm Anaïs and I'll arrange it.";
  assert.ok(controlerReponse(msg, { prenoms: ["Anaïs"] }).avertissements.includes("prenom_equipe"));
  assert.deepEqual(controlerReponse(msg, { signer: true, prenoms: ["Anaïs"] }).avertissements, []);
});

test("revue : unités de la base, Krabi distinct de Krabi Airport, montants tapés sans années ni références, historique coupé", async () => {
  const { debutValide } = await import("../supabase/functions/agent/prompt.js");
  const ref = refDe("P", "a1000000-0000-4000-8000-000000000001");
  const r = await executer("proposer_dossier", { titre: "t", client_nom: "", client_telephone: "", hotel: "", langue: "en", adultes: 2, enfants: 1, bebes: 0, services: [service({ ref, adultes: 2, enfants: 1 })] }, ctxDe({ charger: async (n) => (n === "prestations" ? [{ ...donnees.prestations[0], unite: "pp" }] : donnees[n] || []) }), nouveauMemo());
  assert.equal(r.carte.donnees.services[0].prix, 4500);
  const krabi = { ...donnees, trajets: [{ ...donnees.trajets[0], vers: "Krabi Airport" }] };
  const h = await executer("horaires_trajet", { de: "Koh Lanta", vers: "Krabi", date: "", adultes: 1, enfants: 0 }, ctxDe({ charger: async (n) => krabi[n] || [] }), nouveauMemo());
  assert.equal(h.contenu.trouve, false);
  assert.deepEqual([...montantsTapes(["dossier T2026-0207, en 2026, mets 3 500"])], [3500]);
  const lignes = [{ role: "user", contenu: [{ type: "tool_result" }] }, { role: "assistant", contenu: [] }, { role: "user", contenu: [{ type: "text", text: "a" }] }];
  assert.equal(debutValide(lignes).length, 1);
});

// Règle de Jérémy (19.11.2026) : un trajet avec ferry se calcule en trois morceaux, route jusqu'au port, ferry 1 h fixe, route depuis le
// port en face, puis la marge. Exemple : Jai Tiki → port de Lanta 25 min, ferry 1 h, port en face → Krabi Nakharin 1 h 10, marge 20 min.
test("ferry en trois morceaux : Jai Tiki → Krabi Nakharin pour 16:00, détail montré à Nani", async () => {
  const liaison = { nom: "Ferry de Koh Lanta", cote_ile: "Koh Lanta", port_ile: "Embarcadère du ferry de Koh Lanta Noi", port_continent: "Embarcadère du ferry, côté continent", port_ile_coord: "", port_continent_coord: "", duree_min: 60, a_verifier: false };
  const lignes = [
    { de: "Jai Tiki", vers: "Embarcadère du ferry de Koh Lanta Noi", mode: "route", duree_min: 25, ferry: false, marge_min: 0, a_verifier: false },
    { de: "Embarcadère du ferry, côté continent", vers: "Krabi", mode: "route", duree_min: 70, ferry: false, marge_min: 20, a_verifier: false },
    // Une ligne directe avec ferry ne sert plus : la règle des trois morceaux l'emporte.
    { de: "Koh Lanta", vers: "Krabi", mode: "route", duree_min: 180, ferry: true, marge_min: 0, a_verifier: false },
  ];
  const ctx = ctxDe({ simule: null, charger: async (n) => ({ temps_trajets: lignes, liaisons_ferry: [liaison] })[n] || donnees[n] || [] });
  const point = (lieu, rdv = "") => ({ lieu, arrivee_voulue: rdv, attente_min: 0, duree_vers_suivant_min: 0, source_duree: "" });
  const r = await executer("planifier_course", { date: "2026-11-21", points: [point("Jai Tiki Retreat, Koh Lanta"), point("Krabi Nakharin International Hospital, Krabi", "16:00")], heure_depart: "", heure_vol: "", vol_international: false }, ctx, nouveauMemo());
  const t = r.contenu.trajets[0];
  assert.deepEqual(t.morceaux.map((m) => [m.genre, m.duree_min]), [["route", 25], ["ferry", 60], ["route", 70]]);
  assert.equal(t.route_min, 95);
  assert.equal(t.ferry_attente_min, 60, "le ferry compte sa durée fixe, traversée et attente comprises");
  assert.equal(t.marge_min, 20);
  // 25 + 60 + 70 + 20 = 175 min avant 16:00.
  assert.equal(r.contenu.pickup.heure, "13:05");
  assert.equal(t.detail, "Jai Tiki Retreat, Koh Lanta → Embarcadère du ferry de Koh Lanta Noi : 25 min, ferry : 1 h, Embarcadère du ferry, côté continent → Krabi Nakharin International Hospital, Krabi : 1 h 10, marge 20 min");
  // Dans l'autre sens, les ports s'inversent ; sur l'île seulement, pas de ferry.
  const retour = await executer("temps_de_route", { de: "Krabi Nakharin International Hospital, Krabi", vers: "Jai Tiki Retreat, Koh Lanta" }, ctx, nouveauMemo());
  assert.equal(retour.contenu.ferry_min, 60);
  assert.match(retour.contenu.detail, /^Krabi Nakharin International Hospital, Krabi → Embarcadère du ferry, côté continent : 1 h 10, ferry : 1 h, Embarcadère du ferry de Koh Lanta Noi → Jai Tiki Retreat, Koh Lanta : 25 min$/);
  // Un morceau sans durée est nommé, pour que l'agent le demande.
  const sansPort = await executer("planifier_course", { date: "2026-11-21", points: [point("Lanta Sand Resort, Koh Lanta"), point("Krabi Nakharin International Hospital, Krabi", "16:00")], heure_depart: "", heure_vol: "", vol_international: false }, ctx, nouveauMemo());
  assert.equal(sansPort.contenu.erreur, "temps_indisponible");
  assert.equal(sansPort.contenu.trajet, "Lanta Sand Resort, Koh Lanta → Embarcadère du ferry de Koh Lanta Noi");
});

test("OSRM public et Nominatim (organisation de Lanta) : adresses, lecture, cadence d'une requête par seconde", async () => {
  const t = await import("../supabase/functions/agent/temps.js");
  assert.equal(t.cheminOsrm({ lon: 98.9058189, lat: 8.0807978 }, { lon: 99.0992049, lat: 7.6930427 }), "/route/v1/driving/98.9058189,8.0807978;99.0992049,7.6930427?overview=false");
  assert.deepEqual(t.lireOsrm({ code: "Ok", routes: [{ duration: 4380, distance: 74000 }] }), { duree_min: 73, distance_km: 74, ferry: false });
  assert.equal(t.lireOsrm({ code: "NoRoute", routes: [] }), null);
  assert.equal(t.parametresNominatim("Krabi Nakharin International Hospital, Krabi").get("countrycodes"), "th");
  assert.deepEqual(t.lireNominatim([{ lat: "8.0807978", lon: "98.9058189", display_name: "โรงพยาบาลกระบี่นครินทร์" }]), { lon: 98.9058189, lat: 8.0807978, label: "โรงพยาบาลกระบี่นครินทร์", confiance: null });
  assert.equal(t.lireNominatim([]), null);
  const derniers = new Map();
  assert.equal(t.delaiAvant(derniers, "router.project-osrm.org", 1000), 0);
  assert.equal(t.delaiAvant(derniers, "router.project-osrm.org", 1500), 600);
  assert.equal(t.delaiAvant(derniers, "nominatim.openstreetmap.org", 1500), 0);
  assert.ok(t.ORGANISATIONS_OSRM.includes("00000000-0000-0000-0000-00000000a000"));
  // Un hôtel absent d'OpenStreetMap se cherche aussi par sa plage connue, jamais par l'île seule.
  assert.deepEqual(t.variantesLieu("Jai Tiki Retreat, Koh Lanta", [{ cle: "jai tiki retreat", zone: "Klong Nin", lieu: "Koh Lanta" }]), ["Jai Tiki Retreat, Koh Lanta", "Jai Tiki Retreat, Ko Lanta", "Klong Nin"]);
});

test("ferry de Lanta : les coordonnées OpenStreetMap des ports passent à l'itinéraire, pas de recherche par nom", async () => {
  const { LIAISON_LANTA } = await import("../src/gestion/js/temps-site.mjs");
  const vus = [];
  const ors = async (de, vers, coords) => (vus.push(coords), { duree_min: de.includes("Jai") ? 35 : 73, distance_km: 1, ferry: false, de_trouve: de, vers_trouve: vers, moteur: "osrm" });
  const r = await dureeAvecFerryDe("Jai Tiki Retreat, Koh Lanta", "Krabi Nakharin International Hospital, Krabi", { liaisons: [LIAISON_LANTA], ors });
  assert.deepEqual(vus, [{ vers: { lat: 7.6823683, lon: 99.0900688 } }, { de: { lat: 7.6930427, lon: 99.0992049 } }]);
  assert.deepEqual(r.morceaux.map((m) => m.duree_min), [35, 60, 73]);
  assert.equal(r.moteur, "osrm");
});
