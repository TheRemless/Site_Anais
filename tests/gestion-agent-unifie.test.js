// Agent de l'onglet « Assistant » : espace unifié Secret Travel & Tour et VIP Taxi Lanta (migration 63, demande de Jérémy du 20.11.2026).
// L'agent cherche dans les deux catalogues, marque chaque ligne et chaque service de son entreprise, et les chiffres internes d'une ligne
// suivent les droits dans l'entreprise de cette ligne. ZTP ne change pas. Données fictives, aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OUTILS, OUTILS_UNIFIES, executer, memoDepuis, normaliserEntree, outilsDuContexte, outilsPour, refDe, controlerReponse } from "../supabase/functions/agent/outils.js";
import { modeUnifie, modeUnifieSansDroits, permissionsOutils, estUnifie } from "../supabase/functions/agent/unifie.js";
import { consignes } from "../supabase/functions/agent/prompt.js";
import { REGLE_BATEAUX } from "../supabase/functions/agent/ameliorer.js";
import { outilsWhatsapp, promptPreparation } from "../supabase/functions/whatsapp/proposer.js";

const ORG = "00000000-0000-0000-0000-00000000a000";
const SECRET = { id: "5ec00000-0000-4000-8000-000000000001", slug: "secret", nom: "Secret Travel & Tour", organisation_id: ORG };
const TAXI = { id: "7a000000-0000-4000-8000-000000000002", slug: "taxi", nom: "VIP Taxi Lanta", organisation_id: ORG };
const ZTP = { id: "2e000000-0000-4000-8000-000000000003", slug: "ztp", nom: "Zwald Travel Planner", organisation_id: ORG };
const PS = "aaaaaaaa-0000-4000-8000-000000000001"; // partenaire de Secret
const PT = "bbbbbbbb-0000-4000-8000-000000000002"; // chauffeur partenaire de Taxi
const P_TOUR = "a1000000-0000-4000-8000-000000000001";
const P_TRANSFERT = "a2000000-0000-4000-8000-000000000002";
const T_FERRY = "f1000000-0000-4000-8000-000000000001";
const D_SECRET = "d1000000-0000-4000-8000-000000000001";
const D_TAXI = "d2000000-0000-4000-8000-000000000002";
const R_TAXI = "e2000000-0000-4000-8000-000000000002";
const donnees = {
  partenaires: [
    { id: PS, nom: "Blue Ocean Speedboat", actif: true, regles: {}, entite_id: SECRET.id },
    { id: PT, nom: "Mr. Brown Transport", actif: true, regles: {}, entite_id: TAXI.id },
  ],
  partenaires_prives: [],
  prestations: [
    { id: P_TOUR, famille: "excursion", groupe: "4 Islands", libelle: "4 îles", libelle_en: "4 Islands tour", prix_vente: 1500, unite: "pp", partenaire_id: PS, actif: true, entite_id: SECRET.id },
    { id: P_TRANSFERT, famille: "transfert", groupe: "Airport", libelle: "Transfert aéroport de Krabi", libelle_en: "Krabi Airport transfer", prix_vente: 2500, unite: "", partenaire_id: PT, actif: true, entite_id: TAXI.id },
  ],
  prestations_nets: [
    { prestation_id: P_TOUR, net: 1100, entite_id: SECRET.id },
    { prestation_id: P_TRANSFERT, net: 1900, entite_id: TAXI.id },
  ],
  trajets: [{ id: T_FERRY, de: "Koh Lanta", vers: "Koh Phi Phi", mode: "ferry", depart: "08:00", arrivee: "09:30", duree: "1 h 30", prix_adulte: 900, prix_enfant: 600, partenaire_id: PS, actif: true, fenetres: [], entite_id: SECRET.id }],
  trajets_nets: [{ trajet_id: T_FERRY, net_adulte: 700, net_enfant: 450, entite_id: SECRET.id }],
  clients: [{ id: "c1000000-0000-4000-8000-000000000001", prenom: "Claire", nom: "Martin", telephone: "+41 79 000 00 00", entite_id: SECRET.id }],
  dossiers: [
    { id: D_SECRET, ref: "S-2026-0001", client_id: "c1000000-0000-4000-8000-000000000001", date_depart: "2026-11-21", date_retour: "2026-11-28", annule: false, entite_id: SECRET.id },
    { id: D_TAXI, ref: "T-2026-0001", client_id: "c1000000-0000-4000-8000-000000000001", date_depart: "2026-11-28", date_retour: "", annule: false, entite_id: TAXI.id },
  ],
  reservations: [{ id: R_TAXI, dossier_id: D_TAXI, libelle: "Lanta → Krabi Airport", date_service: "2026-11-28", heure_pickup: "09:00", lieu_pickup: "Hotel Sunset", personnes: { adultes: 2 }, statut: "confirme", montant_vente: 2500, partenaire_id: PT, paye_sur_place: false, entite_id: TAXI.id }],
  reservations_nets: [{ reservation_id: R_TAXI, net_prevu: 1900, entite_id: TAXI.id }],
};
const TOUS = ["partenaires.lire", "partenaires.nets", "dossiers.lire", "dossiers.ecrire"];
const SANS_NETS = ["partenaires.lire", "dossiers.lire", "dossiers.ecrire"];
const charger = async (nom) => donnees[nom] || [];
// Le contexte en mode unifié, tel que la fonction le construit (index.ts) : entreprise active d'abord.
const ctxUnifie = (permSecret = TOUS, permTaxi = TOUS) => ({ permissions: permSecret, ...modeUnifie({ active: SECRET, autre: TAXI, permissions: permSecret, permissionsAutre: permTaxi }), charger, reglages: {} });
// ZTP, ou une personne sans droits dans l'autre entreprise : le contexte d'avant.
const ctxSimple = (permissions = TOUS) => ({ permissions, charger, reglages: {} });
const memoNeuf = (o = {}) => memoDepuis([], { prestataires: donnees.partenaires.map((p) => p.nom), entreprise: SECRET.nom, ...o });
const service = (o) => ({ texte: "", ref: "", date: "2026-11-28", heure_pickup: "", lieu_pickup: "Hotel Sunset", de: "", vers: "", adultes: 2, enfants: 0, prix_saisi: "", remarque: "", ...o });

test("détection : Secret ou Taxi actif, droits partenaires.lire et dossiers.ecrire dans l'autre ; sinon rien ne change", () => {
  const u = modeUnifie({ active: SECRET, autre: TAXI, permissions: TOUS, permissionsAutre: SANS_NETS });
  assert.deepEqual(u.entites, [{ id: SECRET.id, slug: "secret", nom: SECRET.nom }, { id: TAXI.id, slug: "taxi", nom: TAXI.nom }]);
  assert.deepEqual(u.permissionsPar, { [SECRET.id]: TOUS, [TAXI.id]: SANS_NETS });
  // Depuis Taxi aussi : la conversation reste sous l'entreprise active, mise en premier.
  assert.equal(modeUnifie({ active: TAXI, autre: SECRET, permissions: TOUS, permissionsAutre: TOUS }).entites[0].slug, "taxi");
  // Droits manquants dans l'autre entreprise.
  assert.equal(modeUnifie({ active: SECRET, autre: TAXI, permissions: TOUS, permissionsAutre: ["partenaires.lire", "dossiers.lire"] }), null);
  assert.equal(modeUnifie({ active: SECRET, autre: TAXI, permissions: TOUS, permissionsAutre: ["dossiers.ecrire"] }), null);
  assert.equal(modeUnifie({ active: SECRET, autre: TAXI, permissions: TOUS, permissionsAutre: null }), null);
  // ZTP n'entre jamais, ni deux fois la même entreprise, ni une autre organisation.
  assert.equal(modeUnifie({ active: ZTP, autre: SECRET, permissions: TOUS, permissionsAutre: TOUS }), null);
  assert.equal(modeUnifie({ active: SECRET, autre: ZTP, permissions: TOUS, permissionsAutre: TOUS }), null);
  assert.equal(modeUnifie({ active: SECRET, autre: { ...SECRET, id: TAXI.id }, permissions: TOUS, permissionsAutre: TOUS }), null);
  assert.equal(modeUnifie({ active: SECRET, autre: { ...TAXI, organisation_id: "autre" }, permissions: TOUS, permissionsAutre: TOUS }), null);
  // La boîte WhatsApp : aucune personne, aucun droit.
  assert.deepEqual(modeUnifieSansDroits({ active: TAXI, autre: SECRET }).permissionsPar, { [TAXI.id]: [], [SECRET.id]: [] });
  assert.equal(modeUnifieSansDroits({ active: ZTP, autre: SECRET }), null);
  assert.equal(estUnifie(ctxSimple()), false);
  assert.equal(estUnifie(ctxUnifie()), true);
});

test("catalogue et horaires : chaque ligne porte son entreprise, Secret ou Taxi", async () => {
  const ctx = ctxUnifie();
  const cat = (await executer("chercher_catalogue", { recherche: "", famille: "tout" }, ctx, memoNeuf())).contenu;
  const par = Object.fromEntries(cat.lignes.map((l) => [l.ref, l.entreprise]));
  assert.deepEqual(par, { [refDe("P", P_TOUR)]: "Secret", [refDe("P", P_TRANSFERT)]: "Taxi", [refDe("T", T_FERRY)]: "Secret" });
  const h = (await executer("horaires_trajet", { de: "Koh Lanta", vers: "Koh Phi Phi", date: "2026-11-22", adultes: 2, enfants: 0 }, ctx, memoNeuf())).contenu;
  assert.equal(h.departs[0].entreprise, "Secret");
  // L'identifiant de l'entreprise ne part jamais chez Claude.
  for (const t of [JSON.stringify(cat), JSON.stringify(h)]) for (const id of [SECRET.id, TAXI.id]) assert.ok(!t.includes(id));
  // Les clients et les dossiers des deux entreprises, chacun avec la sienne.
  const cl = (await executer("chercher_clients", { recherche: "Martin" }, ctx, memoNeuf())).contenu;
  assert.deepEqual(cl.clients[0].dossiers.map((d) => d.entreprise).sort(), ["Secret", "Taxi"]);
  const dos = (await executer("lire_dossier", { dossier: refDe("D", D_TAXI) }, ctx, memoNeuf())).contenu;
  assert.equal(dos.entreprise, "Taxi");
});

test("service du catalogue : l'entreprise de sa ligne ; hors catalogue : celle écrite par le modèle, une course chez Taxi", async () => {
  const ctx = ctxUnifie();
  const r = await executer(
    "proposer_dossier",
    { titre: "Dossier Martin", client_nom: "Claire Martin", client_telephone: "", hotel: "Hotel Sunset", langue: "en", adultes: 2, enfants: 0, bebes: 0, services: [service({ texte: "4 Islands", ref: refDe("P", P_TOUR), entreprise: "taxi" }), service({ texte: "Course Lanta → Trang", entreprise: "taxi", prix_saisi: "" })] },
    ctx,
    memoNeuf()
  );
  const [tour, course] = r.carte.donnees.services;
  // La ligne du catalogue l'emporte sur ce que le modèle a écrit.
  assert.equal(tour.entreprise, "secret");
  assert.equal(tour.entite_id, SECRET.id);
  assert.equal(course.entreprise, "taxi");
  assert.equal(course.entite_id, TAXI.id);
  assert.deepEqual(course.avertissements, []);
  // Ce qui repart chez Claude dit l'entreprise retenue pour chaque service.
  assert.deepEqual(r.contenu.prix.map((p) => p.entreprise), ["secret", "taxi"]);
});

test("hors catalogue sans entreprise sûre : « entreprise_a_choisir » sur le service et sur la carte", async () => {
  const r = await executer("proposer_dossier", { titre: "Dossier", client_nom: "", client_telephone: "", hotel: "", langue: "", adultes: 2, enfants: 0, bebes: 0, services: [service({ texte: "Quelque chose à Koh Ngai", entreprise: "" })] }, ctxUnifie(), memoNeuf());
  const s = r.carte.donnees.services[0];
  assert.equal(s.entreprise, "");
  assert.equal(s.entite_id, null);
  assert.ok(s.avertissements.includes("entreprise_a_choisir"));
  assert.deepEqual(r.carte.avertissements, ["entreprise_a_choisir"]);
  assert.deepEqual(r.contenu.avertissements, ["entreprise_a_choisir"]);
  assert.deepEqual(r.carte.donnees.entreprises, []);
  // Une valeur hors liste est refusée à l'entrée, comme tout champ d'une liste fermée.
  assert.equal(normaliserEntree("proposer_dossier", { titre: "x", services: [{ texte: "x", entreprise: "ztp" }] }, { unifie: true }), null);
});

test("carte mixte : deux entreprises en résumé, un service par entreprise", async () => {
  const r = await executer(
    "proposer_dossier",
    { titre: "Tour et transfert", client_nom: "Claire", client_telephone: "", hotel: "", langue: "en", adultes: 2, enfants: 0, bebes: 0, services: [service({ texte: "Transfert aéroport", ref: refDe("P", P_TRANSFERT) }), service({ texte: "Ferry Lanta → Phi Phi", ref: refDe("T", T_FERRY) })] },
    ctxUnifie(),
    memoNeuf()
  );
  assert.deepEqual(r.carte.donnees.entreprises, ["secret", "taxi"]);
  assert.deepEqual(r.carte.donnees.services.map((s) => [s.entreprise, s.prix]), [["taxi", 2500], ["secret", 1800]]);
  assert.equal(r.carte.avertissements, undefined);
});

test("ajout et modification : l'entreprise du dossier visé", async () => {
  const ctx = { ...ctxUnifie(), parRef: async (table, ref) => (table === "dossiers" ? donnees.dossiers : donnees.reservations).filter((x) => refDe(table === "dossiers" ? "D" : "R", x.id) === ref) };
  const ajout = await executer("proposer_reservation", { titre: "Retour", dossier: refDe("D", D_TAXI), service: service({ texte: "Retour à l'hôtel", entreprise: "secret" }) }, ctx, memoNeuf());
  assert.equal(ajout.carte.donnees.entreprise, "taxi");
  assert.equal(ajout.carte.donnees.service.entreprise, "taxi");
  assert.equal(ajout.carte.donnees.service.entite_id, TAXI.id);
  // Un tarif de Secret dans un dossier de Taxi : signalé.
  const autre = await executer("proposer_reservation", { titre: "Tour", dossier: refDe("D", D_TAXI), service: service({ texte: "4 Islands", ref: refDe("P", P_TOUR) }) }, ctx, memoNeuf());
  assert.deepEqual(autre.carte.avertissements, ["catalogue_autre_entreprise"]);
  const modif = await executer("proposer_modification", { titre: "Heure", reservation: refDe("R", R_TAXI), champ: "heure_pickup", valeur: "08:30", raison: "Vol avancé" }, ctx, memoNeuf());
  assert.equal(modif.carte.donnees.entreprise, "taxi");
  assert.equal(modif.carte.donnees.entite_id, TAXI.id);
});

test("nets d'une ligne masqués sans le droit dans SON entreprise", async () => {
  // Nets chez Secret, partenaires seulement chez Taxi.
  const ctx = ctxUnifie(TOUS, SANS_NETS);
  const cat = (await executer("chercher_catalogue", { recherche: "", famille: "tout" }, ctx, memoNeuf())).contenu;
  const tour = cat.lignes.find((l) => l.ref === refDe("P", P_TOUR));
  const transfert = cat.lignes.find((l) => l.ref === refDe("P", P_TRANSFERT));
  assert.equal(tour.net, 1100);
  assert.equal(tour.partenaire, "Blue Ocean Speedboat");
  assert.equal(transfert.partenaire, "Mr. Brown Transport");
  for (const k of ["net", "marge", "commission", "gain", "reglement"]) assert.equal(k in transfert, false, `${k} chez Taxi`);
  assert.ok(!JSON.stringify(transfert).includes("1900"));
  // Le dossier de Taxi : pas de net non plus, même si la table en rend un.
  const dos = (await executer("lire_dossier", { dossier: refDe("D", D_TAXI) }, ctx, memoNeuf())).contenu;
  assert.equal(dos.services[0].partenaire, "Mr. Brown Transport");
  assert.ok(!("net_prevu" in dos.services[0]) && !("marge_chez_nous" in dos));
  // Sans aucun droit sur les partenaires dans une entreprise : ni nom ni chiffre pour ses lignes.
  const sansTaxi = { ...ctxUnifie(), permissionsPar: { [SECRET.id]: TOUS, [TAXI.id]: ["dossiers.ecrire"] } };
  const t2 = (await executer("chercher_catalogue", { recherche: "airport", famille: "tout" }, sansTaxi, memoNeuf())).contenu.lignes[0];
  assert.deepEqual(Object.keys(t2).filter((k) => ["partenaire", "net", "marge", "gain"].includes(k)), []);
  // Une ligne d'une entreprise inconnue : fermé.
  const inconnue = { ...ctx, charger: async (nom) => (nom === "prestations" ? [{ ...donnees.prestations[0], entite_id: ZTP.id }] : donnees[nom] || []) };
  const t3 = (await executer("chercher_catalogue", { recherche: "4 islands", famille: "tout" }, inconnue, memoNeuf())).contenu.lignes[0];
  assert.ok(!("partenaire" in t3) && !("net" in t3) && !("entreprise" in t3));
  // Les outils annoncent les nets dès qu'un droit les montre quelque part ; la réponse au client les bloque toujours.
  assert.match(outilsDuContexte(ctx).find((o) => o.name === "chercher_catalogue").description, /net/);
  const memo = memoNeuf({ entreprises: [TAXI.nom] });
  await executer("chercher_catalogue", { recherche: "", famille: "tout" }, ctx, memo);
  const rep = await executer("proposer_reponse", { titre: "R", langue: "en", message: "Hello,\n\nThe tour is 1,500 THB with Blue Ocean Speedboat, our cost 1100.\n\nVIP Taxi Lanta" }, ctx, memo);
  assert.ok(rep.carte.avertissements.includes("montant_interne:1100"));
  assert.ok(rep.carte.avertissements.includes("nom_prestataire:Blue Ocean Speedboat"));
  // La signature de l'autre entreprise est retirée aussi.
  assert.ok(rep.carte.avertissements.includes("signature_retiree"));
  assert.ok(!rep.carte.donnees.message.includes("VIP Taxi Lanta"));
  assert.equal(controlerReponse("Hi\n\nVIP Taxi Lanta", { entreprise: SECRET.nom }).message, "Hi\n\nVIP Taxi Lanta");
});

test("consignes : les deux entreprises, leurs règles sous leur nom, la voix de l'entreprise active", () => {
  const unifie = { entreprises: [{ nom: SECRET.nom, slug: "secret", reglages: { fonctionnement: "excursions" } }, { nom: TAXI.nom, slug: "taxi", reglages: { fonctionnement: "taxi", assistant_voix: { regles_reponse: "- Toujours demander le nombre de bagages." } } }] };
  const s = consignes({ entreprise: SECRET.nom, reglages: { fonctionnement: "excursions" }, prenomEquipe: "Nani", partenaires: true, unifie });
  assert.match(s, /pour Secret Travel & Tour \(une agence d'excursions, de bateaux et de transferts\) et VIP Taxi Lanta \(un service de taxi/);
  assert.match(s, /Deux entreprises : Secret Travel & Tour et VIP Taxi Lanta/);
  assert.match(s, /« taxi » pour une course, un taxi ou un transfert privé à prix libre/);
  assert.match(s, /Si tu hésites, laisse "" et demande à Nani/);
  assert.match(s, /deux dossiers liés/);
  assert.match(s, /La réponse au client reste UNIQUE/);
  const reponse = s.slice(s.indexOf("Réponse au client (proposer_reponse)"));
  assert.match(reponse, /Règles de chaque entreprise, à appliquer aux services de cette entreprise/);
  assert.ok(reponse.includes(`  - Secret Travel & Tour :\n    - ${REGLE_BATEAUX}`));
  assert.ok(reponse.includes("  - VIP Taxi Lanta :\n    - Toujours demander le nombre de bagages."));
  assert.doesNotMatch(reponse, /Règles de l'entreprise, à appliquer/);
  // Sans signature, voix de Secret ; plus de renvoi vers l'Assistant de Taxi.
  assert.match(reponse, /Sans aucune signature/);
  assert.match(s, /La voix de la réponse au client reste celle de Secret Travel & Tour/);
  assert.doesNotMatch(s, /Transfer request/);
  // Réglages de l'autre entreprise illisibles : les règles par défaut de son métier.
  const sansReglages = consignes({ entreprise: SECRET.nom, reglages: { fonctionnement: "excursions" }, prenomEquipe: "Nani", unifie: { entreprises: [unifie.entreprises[0], { nom: TAXI.nom, slug: "taxi", reglages: null }] } });
  assert.ok(sansReglages.includes(`  - VIP Taxi Lanta :\n    - ${REGLE_BATEAUX}`));
  // La boîte WhatsApp reçoit les mêmes consignes, et les outils des deux catalogues.
  const p = promptPreparation({ entreprise: SECRET.nom, reglages: { fonctionnement: "excursions" }, messages: [], aujourdhui: "2026-11-20", unifie });
  assert.match(p.systeme, /Deux entreprises : Secret Travel & Tour et VIP Taxi Lanta/);
  assert.match(outilsWhatsapp({ unifie: true }).find((o) => o.name === "chercher_catalogue").description, /deux catalogues/);
});

test("ZTP et personne sans droits dans l'autre entreprise : tout comme avant", async () => {
  const ctx = ctxSimple();
  const cat = (await executer("chercher_catalogue", { recherche: "", famille: "tout" }, ctx, memoNeuf())).contenu;
  assert.ok(cat.lignes.every((l) => !("entreprise" in l)));
  const r = await executer("proposer_dossier", { titre: "D", client_nom: "", client_telephone: "", hotel: "", langue: "", adultes: 2, enfants: 0, bebes: 0, services: [service({ texte: "Course", entreprise: "taxi" })] }, ctx, memoNeuf());
  const s = r.carte.donnees.services[0];
  assert.ok(!("entreprise" in s) && !("entite_id" in s) && !("entreprises" in r.carte.donnees));
  assert.deepEqual(s.avertissements, []);
  assert.equal(r.carte.avertissements, undefined);
  assert.ok(r.contenu.prix.every((p) => !("entreprise" in p)));
  // Les outils et leurs schémas sont ceux d'avant : le champ « entreprise » n'existe qu'en mode unifié.
  assert.deepEqual(outilsDuContexte(ctx), outilsPour(TOUS));
  assert.deepEqual(outilsDuContexte({ permissions: [] }), OUTILS);
  assert.equal("entreprise" in OUTILS.find((o) => o.name === "proposer_dossier").input_schema.properties.services.items.properties, false);
  assert.equal("entreprise" in OUTILS_UNIFIES.find((o) => o.name === "proposer_dossier").input_schema.properties.services.items.properties, true);
  assert.equal("entreprise" in normaliserEntree("proposer_reservation", { titre: "x", dossier: "D-1", service: { texte: "x", entreprise: "taxi" } }).service, false);
  assert.deepEqual(permissionsOutils(ctx), TOUS);
  // Les consignes de ZTP ne bougent pas (le paramètre absent ou nul revient au même).
  const ztp = { fonctionnement: "sur_mesure" };
  assert.equal(consignes({ entreprise: ZTP.nom, reglages: ztp, prenomEquipe: "Anaïs" }), consignes({ entreprise: ZTP.nom, reglages: ztp, prenomEquipe: "Anaïs", unifie: null }));
  assert.doesNotMatch(consignes({ entreprise: ZTP.nom, reglages: ztp, prenomEquipe: "Anaïs" }), /Deux entreprises/);
  assert.doesNotMatch(consignes({ entreprise: SECRET.nom, reglages: { fonctionnement: "excursions" }, prenomEquipe: "Nani" }), /Deux entreprises/);
});

test("fonctions : droits de l'autre entreprise lus avec la session, deux entreprises au plus, WhatsApp sans aucun droit", () => {
  const idx = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
  assert.match(idx, /sb\.from\("entites"\)\.select\("id, slug, nom, organisation_id"\)\.eq\("organisation_id", ent\.data\.organisation_id\)\.in\("slug", ENTREPRISES_UNIFIEES\)/);
  assert.match(idx, /sb\.rpc\("permissions_dans", \{ e: autre\.id \}\)/);
  assert.match(idx, /modeUnifie\(\{ active: \{ id: entiteId, \.\.\.ent\.data \}, autre, permissions: perms\.data \|\| \[\], permissionsAutre: pa\.data \|\| \[\] \}\)/);
  assert.ok(idx.indexOf("if (!acces.ok)") < idx.indexOf("modeUnifie("), "les droits de l'entreprise active d'abord");
  assert.doesNotMatch(idx, /admin\.from\("(?:entites|prestations|trajets|partenaires|clients|dossiers|reservations)/);
  // La conversation reste rangée sous l'entreprise active.
  assert.match(idx, /from\("agent_conversations"\)\.insert\(\{ entite_id: entiteId,/);
  assert.match(idx, /ligneJournal\(\{ userId, entiteId,/);
  const wa = readFileSync(new URL("../supabase/functions/whatsapp/reponse.ts", import.meta.url), "utf8");
  assert.match(wa, /reglagesAutre\.agent_ia === true \? modeUnifieSansDroits\(\{ active: ent, autre \}\)/);
  assert.match(wa, /permissions: \[\], \.\.\.\(unifie \? \{ entites: unifie\.entites, permissionsPar: unifie\.permissionsPar \} : \{\}\)/);
  assert.match(wa, /outils: outilsWhatsapp\(\{ unifie: !!unifie \}\)/);
});
