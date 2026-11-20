// Agent de l'onglet « Assistant » : partenaires, nets et commissions selon les droits (décision de Jérémy du 20.11.2026, « L'IA voit tout »),
// et le garde-fou qui les tient hors de toute réponse au client. Données fictives, aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OUTILS, outilsPour, executer, memoDepuis, controlerReponse, commissionPrevue, collecterInternes, partenairesCites, refDe } from "../supabase/functions/agent/outils.js";
import { consignes, parametres } from "../supabase/functions/agent/prompt.js";
import { commissionPrevue as commissionPrevueEcran } from "../src/gestion/js/operations-calc.mjs";
import { bloquantsReponse, resteBloque, montantsDuTexte as montantsEcran } from "../src/gestion/js/agent-calc.mjs";
import { montantsDuTexte as montantsServeur } from "../supabase/functions/agent/outils.js";

const ENT = "11111111-1111-4111-8111-111111111111";
const PA = "aaaaaaaa-0000-4000-8000-000000000001"; // réglé chez nous
const PB = "bbbbbbbb-0000-4000-8000-000000000002"; // payé sur place, commission 20 % du prix de vente
const D = "d1000000-0000-4000-8000-000000000001";
const R1 = "e1000000-0000-4000-8000-000000000001";
const R2 = "e2000000-0000-4000-8000-000000000002";
const R3 = "e3000000-0000-4000-8000-000000000003";
const donnees = {
  partenaires: [
    { id: PA, nom: "Blue Ocean Speedboat", actif: true, regles: {} },
    { id: PB, nom: "Lazy Day Tours", actif: true, regles: { mode_reglement: "sur_place" } },
  ],
  partenaires_prives: [{ partenaire_id: PB, commission_regle: { type: "pourcent_vente", valeur: 20 }, commissions: ["Payée en fin de mois"] }],
  prestations: [
    { id: "a1000000-0000-4000-8000-000000000001", famille: "excursion", groupe: "4 Islands", libelle: "4 îles", libelle_en: "4 Islands tour", prix_vente: 1500, unite: "pp", partenaire_id: PA, actif: true },
    { id: "a2000000-0000-4000-8000-000000000002", famille: "excursion", groupe: "4 Islands", libelle: "4 îles", libelle_en: "4 Islands tour", prix_vente: 1600, unite: "pp", partenaire_id: PB, actif: true },
  ],
  prestations_nets: [
    { prestation_id: "a1000000-0000-4000-8000-000000000001", net: 1100, net_enfant: 800 },
    { prestation_id: "a2000000-0000-4000-8000-000000000002", net: 1250 },
  ],
  trajets: [
    { id: "f1000000-0000-4000-8000-000000000001", de: "Koh Lanta", vers: "Koh Phi Phi", mode: "speedboat", depart: "09:00", arrivee: "10:00", duree: "1 h", prix_adulte: 1200, prix_enfant: 900, partenaire_id: PA, actif: true, fenetres: [] },
  ],
  trajets_nets: [{ trajet_id: "f1000000-0000-4000-8000-000000000001", net_adulte: 1000, net_enfant: 750 }],
  clients: [{ id: "c1000000-0000-4000-8000-000000000001", prenom: "Claire", nom: "Martin", telephone: "+41 79 000 00 00" }],
  dossiers: [{ id: D, ref: "2026-0142", client_id: "c1000000-0000-4000-8000-000000000001", date_depart: "2026-11-21", date_retour: "2026-11-28", annule: false }],
  reservations: [
    { id: R1, dossier_id: D, libelle: "Transfert Lanta → Phi Phi", date_service: "2026-11-22", heure_pickup: "08:30", lieu_pickup: "Hotel Sunset", personnes: { adultes: 2 }, statut: "confirme", montant_vente: 2400, partenaire_id: PA, paye_sur_place: false },
    { id: R2, dossier_id: D, libelle: "4 Islands tour", date_service: "2026-11-23", heure_pickup: "08:00", lieu_pickup: "Hotel Sunset", personnes: { adultes: 2 }, statut: "confirme", montant_vente: 3200, partenaire_id: PB, paye_sur_place: true },
    { id: R3, dossier_id: D, libelle: "Kayak", date_service: "2026-11-24", heure_pickup: "09:00", lieu_pickup: "Hotel Sunset", personnes: { adultes: 2 }, statut: "confirme", montant_vente: 2000, partenaire_id: PB, paye_sur_place: true },
  ],
  reservations_nets: [
    { reservation_id: R1, net_prevu: 2000, net_paye: 2000, paye_le: "2026-11-22" },
    { reservation_id: R2, net_prevu: null, commission_prevue: 640, commission_recue: 600, commission_recue_le: "2026-11-25", commission_recue_moyen: "virement", commission_ecart_motif: "rabais", commission_ecart_note: "40 de rabais au client" },
    { reservation_id: R3, commission_prevue: 400, commission_recue: 150, commission_partielle_le: "2026-11-25" },
  ],
};
const TOUS = ["partenaires.lire", "partenaires.nets", "dossiers.lire", "dossiers.ecrire"];
const ctxDe = (permissions = []) => ({ permissions, charger: async (nom) => donnees[nom] || [], reglages: {} });
const memoNeuf = () => memoDepuis([], { prestataires: donnees.partenaires.map((p) => p.nom), entreprise: "Secret Travel & Tour" });
const texteDe = (x) => JSON.stringify(x);

test("sans droit sur les partenaires : ni nom, ni net, ni commission, et les outils ne les annoncent pas", async () => {
  const ctx = ctxDe(["dossiers.lire"]);
  for (const [nom, e] of [["chercher_catalogue", { recherche: "4 islands", famille: "tout" }], ["horaires_trajet", { de: "Koh Lanta", vers: "Koh Phi Phi", date: "2026-11-22", adultes: 2, enfants: 0 }], ["lire_dossier", { dossier: refDe("D", D) }]]) {
    const t = texteDe((await executer(nom, e, ctx, memoNeuf())).contenu);
    for (const x of ["Blue Ocean", "Lazy Day", "1100", "1250", "net", "marge", "commission", "gain", PA, PB]) assert.ok(!t.includes(x), `${nom} : fuite de « ${x} »`);
  }
  assert.deepEqual(outilsPour(["dossiers.lire"]), OUTILS);
});

test("avec « partenaires.lire » seulement (Mook) : le partenaire, aucun chiffre interne", async () => {
  const ctx = ctxDe(["partenaires.lire", "dossiers.lire"]);
  const cat = (await executer("chercher_catalogue", { recherche: "4 islands", famille: "tout" }, ctx, memoNeuf())).contenu;
  assert.deepEqual(cat.lignes.map((l) => l.partenaire).sort(), ["Blue Ocean Speedboat", "Lazy Day Tours"]);
  const dos = (await executer("lire_dossier", { dossier: refDe("D", D) }, ctx, memoNeuf())).contenu;
  assert.deepEqual(dos.services.map((s) => s.partenaire), ["Blue Ocean Speedboat", "Lazy Day Tours", "Lazy Day Tours"]);
  for (const t of [texteDe(cat), texteDe(dos)]) for (const x of ["1100", "1250", "net", "marge", "commission", "gain", "reglement"]) assert.ok(!t.includes(x), `fuite de « ${x} »`);
  const outils = outilsPour(["partenaires.lire"]);
  const desc = outils.find((o) => o.name === "chercher_catalogue").description;
  assert.match(desc, /partenaire/);
  assert.doesNotMatch(desc, /net|commission|marge/);
});

test("avec « partenaires.nets » : net, marge, commission de la règle et gain ; « lequel rapporte le plus » se lit sur le gain", async () => {
  const ctx = ctxDe(TOUS);
  const cat = (await executer("chercher_catalogue", { recherche: "4 islands", famille: "excursion" }, ctx, memoNeuf())).contenu;
  const chezNous = cat.lignes.find((l) => l.partenaire === "Blue Ocean Speedboat");
  const surPlace = cat.lignes.find((l) => l.partenaire === "Lazy Day Tours");
  assert.equal(chezNous.reglement, "chez_nous");
  assert.equal(chezNous.net, 1100);
  assert.equal(chezNous.net_enfant, 800);
  assert.equal(chezNous.marge, 400);
  assert.equal(chezNous.gain, 400);
  assert.equal(surPlace.reglement, "sur_place");
  assert.equal(surPlace.commission, 320); // 20 % de 1600
  assert.equal(surPlace.gain, 320);
  assert.match(surPlace.regle_commission, /20/);
  assert.match(surPlace.regle_commission, /fin de mois/);
  // Le drapeau « recommande » ne change pas : meilleure marge vente moins net (1600 − 1250 = 350 < 400).
  assert.equal(chezNous.recommande, true);
  const desc = outilsPour(TOUS).find((o) => o.name === "lire_dossier").description;
  assert.match(desc, /commission prévue, reçue/);
});

test("horaires avec les nets : marge, commission et gain pour le groupe demandé", async () => {
  const r = (await executer("horaires_trajet", { de: "Koh Lanta", vers: "Koh Phi Phi", date: "2026-11-22", adultes: 2, enfants: 1 }, ctxDe(TOUS), memoNeuf())).contenu;
  const d = r.departs[0];
  assert.equal(d.partenaire, "Blue Ocean Speedboat");
  assert.equal(d.net_groupe, 2750); // 2 × 1000 + 750
  assert.equal(d.marge_groupe, 550); // 2 × 200 + 150
  assert.equal(d.gain_groupe, 550);
});

test("dossier avec les nets : marge chez nous, commission attendue, reçue, partielle, écart et son motif, totaux", async () => {
  const r = (await executer("lire_dossier", { dossier: refDe("D", D) }, ctxDe(TOUS), memoNeuf())).contenu;
  const [s1, s2, s3] = r.services;
  assert.equal(s1.reglement, "chez_nous");
  assert.equal(s1.marge, 400);
  assert.equal(s1.net_paye_le, "2026-11-22");
  assert.equal(s2.reglement, "sur_place");
  assert.equal(s2.commission_etat, "reglee");
  assert.equal(s2.commission_ecart, -40);
  assert.equal(s2.commission_ecart_motif, "rabais");
  assert.equal(s2.commission_moyen, "virement");
  assert.equal(s3.commission_etat, "partielle");
  assert.equal(r.total_vente, 7600);
  assert.equal(r.marge_chez_nous, 400);
  assert.equal(r.commission_attendue, 1040);
  assert.equal(r.commission_recue, 750);
  assert.equal(r.commission_reste, 290);
  assert.equal(r.commission_etat, "en_cours");
});

test("garde-fou : un net, une marge ou une commission et le nom d'un partenaire dans une réponse au client sont signalés avec leur valeur", async () => {
  const ctx = ctxDe(TOUS);
  const memo = memoNeuf();
  await executer("chercher_catalogue", { recherche: "4 islands", famille: "excursion" }, ctx, memo);
  await executer("lire_dossier", { dossier: refDe("D", D) }, ctx, memo);
  assert.ok(memo.internes.has(1100) && memo.internes.has(320) && memo.internes.has(1040));
  const message = "Hello Claire,\n\nThe 4 Islands tour is 1,500 THB per person with Lazy Day Tours (we keep 320).\nOur cost is 1100.";
  const r = await executer("proposer_reponse", { titre: "Réponse", langue: "en", message }, ctx, memo);
  assert.ok(r.carte.avertissements.includes("montant_interne:320,1100"), r.carte.avertissements.join(" | "));
  assert.ok(r.carte.avertissements.includes("nom_prestataire:Lazy Day Tours"));
  // Le prix de vente de l'outil reste permis, sans « montant_non_source » en double pour les montants internes.
  assert.ok(!r.carte.avertissements.some((a) => a.startsWith("montant_non_source")));
  // Un montant interne égal à un prix de vente rendu par un outil n'est pas signalé : rien ne permet de dire lequel est cité.
  const egal = controlerReponse("Price: 1,600 THB", { internes: new Set([1600]), ventes: new Set([1600]), permisPrix: new Set([1600]) });
  assert.deepEqual(egal.avertissements, []);
  // L'historique enregistré redonne les montants internes au message suivant.
  const relu = memoDepuis([{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: JSON.stringify({ lignes: [{ prix_vente: 1500, net: 1100, commission: 320 }] }) }] }]);
  assert.ok(relu.internes.has(1100) && relu.internes.has(320) && !relu.internes.has(1500) && relu.prix.has(1500));
});

test("noms de partenaires : mots entiers, accents et casse ignorés", () => {
  assert.deepEqual(partenairesCites("Booked with LAZY day tours tomorrow", ["Lazy Day Tours", "Ann"]), ["Lazy Day Tours"]);
  assert.deepEqual(partenairesCites("Annual pass", ["Ann"]), []);
  assert.deepEqual(partenairesCites("Chez Écume", ["Ecume"]), ["Ecume"]);
});

test("écran : la copie reste bloquée tant que le texte contient un montant interne ou le partenaire", () => {
  const b = bloquantsReponse(["signature_retiree", "montant_interne:320,1100", "nom_prestataire:Lazy Day Tours"]);
  assert.deepEqual(b, { montants: [320, 1100], noms: ["Lazy Day Tours"] });
  assert.deepEqual(resteBloque("Tour 1,500 THB with Lazy Day Tours, we keep 320.", b), ["320", "Lazy Day Tours"]);
  assert.deepEqual(resteBloque("Tour 1,500 THB per person, pickup at 08:00.", b), []);
  // Même lecture des montants que la fonction.
  for (const t of ["1,200 THB et ฿900, le 2026-11-21 à 13:20", "CHF 1'250 ou 3 200 baht, +66 81 234 5678"]) assert.deepEqual(montantsEcran(t), montantsServeur(t));
  const vue = readFileSync(new URL("../src/gestion/js/views/agent.mjs", import.meta.url), "utf8");
  assert.match(vue, /resteBloque\(zone\.value, bloquants\)\.length \? null : copier\(c, zone\.value\)/);
  assert.match(vue, /bouton\.disabled = reste\.length > 0/);
});

test("commission : même règle côté fonction et côté écran", () => {
  const regles = [null, { type: "pourcent_vente", valeur: 20 }, { type: "pourcent_net", valeur: 10 }, { type: "fixe_personne", valeur: 150 }, { type: "fixe_reservation", valeur: 300 }, { type: "vente_moins_net" }, { type: "pourcent_vente", valeur: "" }];
  const cas = [{ vente: 1600, net: 1250, adultes: 2 }, { vente: null, net: 1000, adultes: 1 }, { vente: 1000, net: 1200, adultes: 0 }, {}];
  for (const r of regles) for (const c of cas) assert.equal(commissionPrevue(r, c), commissionPrevueEcran(r, c), `${JSON.stringify(r)} ${JSON.stringify(c)}`);
});

test("consignes : la section des chiffres internes suit les droits, et rien ne va au client", () => {
  const sans = consignes({ entreprise: "Secret Travel & Tour", reglages: {}, prenomEquipe: "Nani" });
  assert.doesNotMatch(sans, /Partenaires, nets et commissions/);
  const lecture = consignes({ entreprise: "Secret Travel & Tour", reglages: {}, prenomEquipe: "Nani", partenaires: true });
  assert.match(lecture, /chez quel partenaire/);
  assert.match(lecture, /ne vois ni les nets ni les commissions/);
  const nets = consignes({ entreprise: "Secret Travel & Tour", reglages: {}, prenomEquipe: "Nani", partenaires: true, nets: true });
  assert.match(nets, /compare le champ « gain »/);
  assert.match(nets, /bloque la copie d'une réponse/);
  assert.match(nets, /Jamais de prix d'achat, de net, de marge, de commission, de nom de prestataire/);
  assert.match(nets, /prix d'achat au client\./);
  assert.doesNotMatch(nets, /ni à Nani ni au client/);
  // Les outils annoncés suivent les droits.
  assert.equal(parametres({ systeme: "x", contexte: "y", messages: [], outils: outilsPour(TOUS) }).tools.find((o) => o.name === "horaires_trajet").description.includes("marge"), true);
});

test("fonction : nets lus avec la session et seulement avec le droit, repli sans la migration 57", () => {
  const src = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
  assert.match(src, /const droitsNets = \(perms\.data \|\| \[\]\)\.includes\("partenaires\.lire"\) && \(perms\.data \|\| \[\]\)\.includes\("partenaires\.nets"\)/);
  assert.match(src, /if \(ids\.length && droitsNets\)/);
  assert.match(src, /sb\.from\("reservations_nets"\)/);
  assert.doesNotMatch(src, /admin\.from\("(?:reservations_nets|prestations_nets|trajets_nets|partenaires_prives)"\)/);
  assert.match(src, /42703/);
  assert.match(src, /partenaires: droits\.includes\("partenaires\.lire"\), nets: droits\.includes\("partenaires\.lire"\) && droits\.includes\("partenaires\.nets"\)/);
  const boucle = readFileSync(new URL("../supabase/functions/agent/boucle.js", import.meta.url), "utf8");
  assert.match(boucle, /outils: outilsPour\(\(ctx && ctx\.permissions\) \|\| \[\]\)/);
  void ENT;
  void collecterInternes;
});
