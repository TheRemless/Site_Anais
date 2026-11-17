// Rappel une heure avant chaque service (migration 31) : fenêtre, fuseau de Bangkok, un seul envoi, destinataires, texte au client.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as F from "../supabase/functions/rappels/calc.js";
import * as G from "../src/gestion/js/rappel-h1-calc.mjs";
import * as E from "../src/gestion/js/rappels-etat.mjs";

const R = (o = {}) => ({ id: "r1", entite_id: "S", dossier_id: "d1", libelle: "4 Islands", date_service: "2026-11-17", heure_pickup: "08:00", lieu_pickup: "Hotel Sunset", personnes: { adultes: 2 }, statut: "confirme", partenaire_id: "p1", details: {}, ...o });
const bkk = (iso) => Date.parse(`${iso}+07:00`); // heure de Bangkok écrite à la main → instant

test("heure du service : pickup, sinon heure de l'activité ou départ du billet ; « TBC » n'est pas une heure", () => {
  assert.equal(F.heureService(R({ heure_pickup: "8:00" })), "08:00");
  assert.equal(F.heureService(R({ heure_pickup: "08.30" })), "08:30");
  assert.equal(F.heureService(R({ heure_pickup: "9h15" })), "09:15");
  assert.equal(F.heureService(R({ heure_pickup: "08:00 (landing)" })), "08:00");
  assert.equal(F.heureService(R({ heure_pickup: "", details: { heure_service: "14:00" } })), "14:00");
  assert.equal(F.heureService(R({ heure_pickup: "", details: { depart: "10:30" } })), "10:30");
  for (const sans of ["", "TBC", "time TBC", "25:00", "8:75", "800"]) assert.equal(F.heureService(R({ heure_pickup: sans })), null, sans);
});

test("début du service à l'heure de Bangkok (UTC+7), y compris juste après minuit", () => {
  assert.equal(new Date(F.debutService(R())).toISOString(), "2026-11-17T01:00:00.000Z");
  assert.equal(new Date(F.debutService(R({ date_service: "2026-11-17", heure_pickup: "00:30" }))).toISOString(), "2026-11-16T17:30:00.000Z");
  assert.equal(F.debutService(R({ date_service: null })), null);
  assert.equal(F.debutService(R({ heure_pickup: "TBC" })), null);
});

test("fenêtre : 60 à 55 minutes au passage normal, rattrapage jusqu'à 40 si une exécution a manqué, rien avant ni après", () => {
  const s = R();
  const a = (heure) => F.servicesH1([s], bkk(`2026-11-17T${heure}`)).map((x) => x.minutes);
  assert.deepEqual(a("07:00"), [60]);
  assert.deepEqual(a("07:05"), [55]);
  assert.deepEqual(a("06:59"), [], "61 minutes : trop tôt");
  assert.deepEqual(a("07:20"), [40], "deux passages manqués : encore rattrapé");
  assert.deepEqual(a("07:21"), [], "39 minutes : trop tard pour un rappel utile");
  assert.deepEqual(a("08:00"), []);
});

test("autour de minuit : un service à 00:30 se trouve depuis 23:30 la veille, les dates chargées couvrent le lendemain", () => {
  const s = R({ date_service: "2026-11-18", heure_pickup: "00:30" });
  const maintenant = bkk("2026-11-17T23:30");
  assert.deepEqual(F.datesH1(maintenant), ["2026-11-17", "2026-11-18"]);
  assert.deepEqual(F.servicesH1([s], maintenant).map((x) => x.minutes), [60]);
  // À 23:30 le 31 décembre, le lendemain est le 1er janvier.
  assert.deepEqual(F.datesH1(bkk("2026-12-31T23:30")), ["2026-12-31", "2027-01-01"]);
});

test("pas de rappel : service annulé, dossier annulé, frais de parc, service sans heure", () => {
  const t = bkk("2026-11-17T07:00");
  assert.deepEqual(F.servicesH1([R({ statut: "annule" })], t), []);
  assert.deepEqual(F.servicesH1([R()], t, { ecartes: new Set(["d1"]) }), []);
  assert.deepEqual(F.servicesH1([R({ partenaire_id: null, libelle: "National park fees" })], t), []);
  assert.deepEqual(F.servicesH1([R({ heure_pickup: "" })], t), []);
});

test("une heure changée donne un autre début, donc une autre clé de marquage (un nouveau rappel)", () => {
  const avant = F.debutService(R());
  const apres = F.debutService(R({ heure_pickup: "09:00" }));
  assert.notEqual(avant, apres);
  // La table rappels_h1_envois a pour clé (reservation_id, debut) : verif-rappel-h1.mjs vérifie le « une seule fois » sur Postgres.
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-31-rappel-h1.sql", import.meta.url), "utf8");
  assert.match(sql, /primary key \(reservation_id, debut\)/);
  const fonction = fs.readFileSync(new URL("../supabase/functions/rappels/index.ts", import.meta.url), "utf8");
  assert.match(fonction, /onConflict: "reservation_id,debut", ignoreDuplicates: true/);
});

test("réglage de l'entreprise : allumé par défaut partout ; Secret et Taxi rappellent chaque service, ZTP le départ", () => {
  for (const [actif, mode] of [[F.rappelAvantActif, F.modeRappel], [G.rappelAvantActif, G.modeRappel]]) {
    assert.equal(actif({ fonctionnement: "excursions" }), true);
    assert.equal(actif({ fonctionnement: "taxi" }), true);
    assert.equal(actif({ fonctionnement: "sur_mesure" }), true);
    assert.equal(actif({}), true);
    assert.equal(actif({ fonctionnement: "taxi", rappels: { h1: false } }), false);
    assert.equal(mode({ fonctionnement: "excursions" }), "service");
    assert.equal(mode({ fonctionnement: "taxi" }), "service");
    assert.equal(mode({ fonctionnement: "sur_mesure" }), "depart");
    assert.equal(mode({}), "depart");
  }
  // La fonction ne cherche les services une heure avant que dans les entreprises de services : ZTP n'en reçoit pas.
  const fonction = fs.readFileSync(new URL("../supabase/functions/rappels/index.ts", import.meta.url), "utf8");
  assert.match(fonction, /rappelAvantActif\(l\.valeur\) && modeRappel\(l\.valeur\) === "service"/);
  // Le départ de demain (ZTP) : choisi par entitesDuDepart, au passage de la veille.
  assert.match(fonction, /const departs = t === "veille" \? entitesDuDepart\(heure, ids, valeurs\) : \[\]/);
});

test("destinataires : ceux qui voient toute l'entreprise, sans l'écran voucher seul ni qui a coupé son rappel ; chaque entreprise les siens", () => {
  const roles = [{ id: "ed", portee: "toute", permissions: ["dossiers.lire"] }, { id: "mes", portee: "mes_dossiers", permissions: ["dossiers.lire"] }, { id: "vs", portee: "toute", permissions: ["dossiers.lire", "vouchers.seul"] }];
  const profils = [
    { user_id: "anais", actif: true }, { user_id: "stag", actif: true }, { user_id: "mook", actif: true }, { user_id: "ztp", actif: true },
    { user_id: "root", actif: true, super_admin: true }, { user_id: "coupe", actif: true, rappel_h1: false }, { user_id: "parti", actif: false },
  ];
  const membres = [
    { user_id: "anais", entite_id: "S", role_id: "ed" }, { user_id: "anais", entite_id: "T", role_id: "ed" }, { user_id: "stag", entite_id: "S", role_id: "mes" },
    { user_id: "mook", entite_id: "T", role_id: "vs" }, { user_id: "ztp", entite_id: "Z", role_id: "ed" }, { user_id: "coupe", entite_id: "S", role_id: "ed" }, { user_id: "parti", entite_id: "S", role_id: "ed" },
  ];
  assert.deepEqual(F.destinatairesH1({ profils, membres, roles }, "S"), ["anais", "root"]);
  assert.deepEqual(F.destinatairesH1({ profils, membres, roles }, "T"), ["anais", "root"]);
  assert.deepEqual(F.destinatairesH1({ profils, membres, roles }, "Z"), ["ztp", "root"]);
});

test("notification : « Dans 1 h : client, service », personnes, pickup et lieu ; un tap ouvre la réservation", () => {
  const [x] = F.servicesH1([R({ personnes: { adultes: 2, enfants: 1 } })], bkk("2026-11-17T07:00"));
  const m = F.messageH1(x, { client: F.nomClient({ prenom: "Sarah", nom: "Miller" }) });
  assert.deepEqual(m, { titre: "Dans 1 h : Sarah Miller, 4 Islands", corps: "2 adultes, 1 enfant, pickup 08:00, Hotel Sunset", tag: "h1-r1", url: "/gestion/#/reservation/r1?entite=S" });
  assert.equal(F.messageH1({ ...x, minutes: 45 }).titre, "Dans 45 min : 4 Islands", "sans client connu, le service seul");
  assert.equal(F.messageH1(x, { entreprise: "VIP Taxi Lanta" }).corps.startsWith("VIP Taxi Lanta, "), true);
});

test("ZTP : la veille exacte du départ, un voyage accepté ; rien pour un voyage annulé, sans suite, pas accepté ou un autre jour", () => {
  const D = (o = {}) => ({ id: "v1", entite_id: "Z", ref: "FD20261201", client_id: "c1", bandeau: "VOYAGE EN THAÏLANDE - DÉCEMBRE 2026", pays: "Thaïlande", date_depart: "2026-12-01", accepte_le: "2026-10-02", annule: false, sans_suite_le: null, ...o });
  // Le passage de 18h le 30 novembre cherche les départs du 1er décembre (dateCible « veille »).
  assert.equal(F.dateCible("veille", "2026-11-30"), "2026-12-01");
  assert.deepEqual(F.departsDemain([D()], "2026-12-01").map((d) => d.id), ["v1"]);
  assert.deepEqual(F.departsDemain([D({ date_depart: "2026-12-02" })], "2026-12-01"), [], "départ déplacé au 2 : rien le 30, le rappel part le 1er");
  assert.deepEqual(F.departsDemain([D({ date_depart: "2026-12-02" })], "2026-12-02").map((d) => d.id), ["v1"]);
  assert.deepEqual(F.departsDemain([D({ annule: true })], "2026-12-01"), [], "voyage annulé");
  assert.deepEqual(F.departsDemain([D({ sans_suite_le: "2026-11-10" })], "2026-12-01"), [], "devis classé sans suite");
  assert.deepEqual(F.departsDemain([D({ accepte_le: null })], "2026-12-01"), [], "devis jamais accepté");
  const m = F.messageDepart(D(), { client: "Famille Dupont" });
  assert.deepEqual(m, { titre: "Demain : départ de Famille Dupont", corps: "Thaïlande - décembre 2026, FD20261201", tag: "depart-v1", url: "/gestion/#/dossier/v1?entite=Z" });
  // Marquage par dossier et par date de départ : une date changée donne un nouveau rappel (verif-rappel-h1.mjs le vérifie sur Postgres).
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-31-rappel-h1.sql", import.meta.url), "utf8");
  assert.match(sql, /primary key \(dossier_id, date_depart\)/);
});

test("envoi forcé d'un service : même message que le cron, hors fenêtre, mêmes refus ; jamais sans secret, clé de service ou administratrice", () => {
  const regl = { fonctionnement: "excursions" };
  const t = bkk("2026-11-17T08:10");
  const ok = F.serviceForce(R(), t, { reglages: regl });
  assert.equal(ok.service.minutes, -10, "déjà commencé : envoyé quand même");
  assert.deepEqual(F.messageH1(ok.service, { client: "Sarah Miller" }), { titre: "Commencé il y a 10 min : Sarah Miller, 4 Islands", corps: "2 adultes, pickup 08:00, Hotel Sunset", tag: "h1-r1", url: "/gestion/#/reservation/r1?entite=S" });
  assert.equal(F.serviceForce(R(), bkk("2026-11-17T07:00"), { reglages: regl }).service.minutes, 60);
  assert.deepEqual(F.serviceForce(null, t, { reglages: regl }), { erreur: "service_introuvable" });
  assert.deepEqual(F.serviceForce(R({ statut: "annule" }), t, { reglages: regl }), { erreur: "service_annule" });
  assert.deepEqual(F.serviceForce(R(), t, { reglages: regl, dossierAnnule: true }), { erreur: "service_annule" });
  assert.deepEqual(F.serviceForce(R({ heure_pickup: "TBC" }), t, { reglages: regl }), { erreur: "service_sans_heure" });
  assert.deepEqual(F.serviceForce(R(), t, { reglages: { fonctionnement: "sur_mesure" } }), { erreur: "entreprise_sans_rappel_h1" });
  assert.deepEqual(F.serviceForce(R(), t, { reglages: { fonctionnement: "taxi", rappels: { h1: false } } }), { erreur: "rappel_eteint" });
  assert.deepEqual(F.serviceForce(R({ partenaire_id: null, libelle: "Park fee" }), t, { reglages: regl }), { erreur: "frais_de_parc" });
  // Le libellé de l'heure : celui du cron dans la fenêtre, lisible en dehors.
  assert.deepEqual([60, 55, 54, 61, 125, 0, -10].map(F.quandH1), ["Dans 1 h", "Dans 1 h", "Dans 54 min", "Dans 1 h 01", "Dans 2 h 05", "Maintenant", "Commencé il y a 10 min"]);
  const fonction = fs.readFileSync(new URL("../supabase/functions/rappels/index.ts", import.meta.url), "utf8");
  assert.match(fonction, /if \(!qui\) return json\(\{ erreur: "non autorisé" \}, 401\)/, "aucun appel anonyme");
  assert.match(fonction, /if \(type === "h1" && demande\.force\) return rappelForce\(demande, qui === "admin" \? await organisationAppelant\(fourni\) : null\)/);
  assert.match(fonction, /ent\.data\.organisation_id !== organisation\) return json\(\{ erreur: "service_introuvable" \}, 404\)/, "une administratrice ne force que les services de son organisation");
  assert.match(fonction, /if \(qui === "admin"\) return json/, "une administratrice connectée n'a que l'envoi forcé");
  assert.match(fonction, /moi\.data && moi\.data\.super_admin && moi\.data\.actif \? "admin" : null/);
  assert.match(fonction, /rappels_h1_envois"\)\.upsert/, "le service forcé est marqué : le cron n'enverra pas de doublon");
  assert.ok(!/messageTest|\[TEST\]/.test(fonction), "plus de notification test");
});

test("l'outil et la fonction lisent l'heure et le début de la même façon", () => {
  const cas = ["08:00", "8:00", "08.30", "9h15", "23:59", "00:00", "TBC", "", "24:00", "7:5"].flatMap((heure) => ["2026-11-17", "2026-12-31", "", null].map((date_service) => R({ heure_pickup: heure, date_service })));
  cas.push(R({ heure_pickup: "", details: { heure_service: "14:00" } }), R({ heure_pickup: "", details: { depart: "10:30" } }));
  for (const r of cas) {
    assert.equal(G.heureService(r), F.heureService(r), JSON.stringify(r.heure_pickup));
    assert.equal(G.debutService(r), F.debutService(r), JSON.stringify([r.date_service, r.heure_pickup]));
  }
});

test("accueil : les services des deux prochaines heures, triés, sans annulés ni frais de parc", () => {
  const t = bkk("2026-11-17T07:00");
  const liste = G.prochainsServices([R({ id: "a", heure_pickup: "08:30" }), R({ id: "b", heure_pickup: "07:30" }), R({ id: "c", heure_pickup: "09:30" }), R({ id: "d", statut: "annule" }), R({ id: "e", heure_pickup: "06:50" }), R({ id: "f", heure_pickup: "06:30" }), R({ id: "g", partenaire_id: null, libelle: "Park fee" })], t);
  assert.deepEqual(liste.map((x) => [x.reservation.id, x.minutes]), [["e", -10], ["b", 30], ["a", 90]]);
});

test("rappel au client : heure, lieu, personnes, et ce qu'il faut prévoir seulement quand la base le dit", () => {
  const r = R({ libelle: "4 Islands by longtail, full day", personnes: { adultes: 2, enfants: 1 }, details: { remarques: "Bring a towel." } });
  const prevoir = G.aPrevoir(r, { prestation: { details: { parc: "Adulte étranger: 400 ฿" } } });
  assert.deepEqual(prevoir, ["National park fee not included: Adult 400 THB, cash on the day.", "Bring a towel."]);
  const t = G.texteRappelClient(r, { prenom: "Anna", lieu: "Hotel Sunset", entreprise: "Secret Travel & Tour", prevoir });
  assert.equal(t, ["Hello Anna,", "", "A quick reminder for today: 4 Islands by longtail, full day.", "Pickup at 08:00 from Hotel Sunset. Please be ready a few minutes early.", "For 2 adults, 1 child.", "National park fee not included: Adult 400 THB, cash on the day.", "Bring a towel.", "", "See you soon,", "Secret Travel & Tour"].join("\n"));
  assert.deepEqual(G.aPrevoir(R(), {}), [], "rien d'inventé quand la base ne dit rien");
  assert.match(G.aPrevoir(R({ libelle: "Koh Lanta → Langkawi" }), { partenaire: { nom: "Satun Pakbara" }, trajet: { de: "Koh Lanta", vers: "Langkawi" } })[0], /passport/);
  assert.match(G.texteRappelClient(R(), { langue: "fr", prenom: "Marc", entreprise: "Zwald" }), /^Bonjour Marc,\n\nPetit rappel pour tout à l'heure : 4 Islands\.\nPrise en charge à 08:00\./);
});

test("partenaire : seulement les détails utiles, jamais un message rédigé (règle du 14.11.2026)", () => {
  const p = G.detailsPartenaire(R(), { nom: "Longtail démo", contact: { personne: "M. Démo", telephones: [{ numero: "081-000-0001", whatsapp: true }, "", { numero: " " }] } });
  assert.deepEqual(Object.keys(p).sort(), ["date", "heure", "lieu", "nom", "personne", "personnes", "service", "telephones"]);
  assert.deepEqual(p.telephones.map((t) => t.numero), ["081-000-0001"]);
  assert.equal(G.detailsPartenaire(R(), null), null);
  const vue = fs.readFileSync(new URL("../src/gestion/js/views/reservation-rappel.mjs", import.meta.url), "utf8");
  assert.ok(!/wa\.me\/\$\{[^}]*partenaire|ouvrirMessage|pour: "partenaire"/.test(vue), "aucun message ni lien de message au partenaire");
});

test("cases « rappel envoyé » : gardées dans la réservation, lues pour l'accueil", () => {
  assert.deepEqual(G.etatRappel(R({ details: { rappel_client_le: "2026-11-17T00:05:00Z" } })), { client: "2026-11-17T00:05:00Z", partenaire: null });
  assert.deepEqual(G.etatRappel({}), { client: null, partenaire: null });
});

test("départ de demain (ZTP) : avec le passage de la veille, à l'heure réglée ; 18 h si la veille est coupée ; jamais Secret ni Taxi", () => {
  const ids = ["Z", "Z2", "Z3", "S", "T", "Zoff"];
  const valeurs = {
    Z: { fonctionnement: "sur_mesure" },
    Z2: { fonctionnement: "sur_mesure", rappels: { veille: 20, lendemain: 9 } },
    Z3: { fonctionnement: "sur_mesure", rappels: { veille: null } },
    S: { fonctionnement: "excursions" },
    T: { fonctionnement: "taxi" },
    Zoff: { fonctionnement: "sur_mesure", rappels: { h1: false } },
  };
  // Envoi forcé de la veille (cron de 18 h d'avant le lot G) : toutes les entreprises ZTP où le rappel du départ est allumé, comme avant.
  assert.deepEqual(F.entitesDuDepart(null, ids, valeurs), ["Z", "Z2", "Z3"]);
  // Appel horaire : chacune à son heure.
  assert.deepEqual(F.entitesDuDepart(18, ids, valeurs), ["Z", "Z3"]);
  assert.deepEqual(F.entitesDuDepart(20, ids, valeurs), ["Z2"]);
  assert.deepEqual(F.entitesDuDepart(9, ids, valeurs), []);
  // Une entreprise sans ligne de réglages : pas de rappel du départ (comme avant la fusion) ; une ligne sans heures : 18 h.
  assert.deepEqual(F.entitesDuDepart(18, ["X"], {}), []);
  assert.deepEqual(F.entitesDuDepart(18, ["X"], { X: {} }), ["X"]);
  // L'outil et la fonction donnent la même heure au départ.
  for (const r of [undefined, {}, { veille: 20 }, { veille: null }, { veille: 0 }, { veille: "x" }]) assert.equal(E.heureDepart(r), F.heureDepart(r), JSON.stringify(r));
});

test("fenêtre Rappels : changer les heures garde l'interrupteur « Rappel 1 h avant » de l'entreprise (rappels.h1)", () => {
  const vue = fs.readFileSync(new URL("../src/gestion/js/views/rappels.mjs", import.meta.url), "utf8");
  assert.match(vue, /rappels: \{ \.\.\.\(reglages\(\)\.rappels \|\| \{\}\), veille: lire\(veille\), lendemain: lire\(lendemain\) \}/);
});

test("fenêtre Rappels : jamais « null » dans la fenêtre d'une personne qui n'est pas administratrice", () => {
  const vue = fs.readFileSync(new URL("../src/gestion/js/views/rappels.mjs", import.meta.url), "utf8");
  // replaceChildren(null) écrit le texte « null » : le bloc des heures s'ajoute par un tableau, vide pour les autres.
  assert.ok(!/estAdmin\(\) \? reglageHeures\(dessiner\) : null/.test(vue));
  assert.equal((vue.match(/\.\.\.\(estAdmin\(\) \? \[reglageHeures\(dessiner\)\] : \[\]\)/g) || []).length, 2);
  // En démonstration aussi, les heures viennent avant « Fermer ».
  assert.ok(vue.indexOf("...(estAdmin() ? [reglageHeures(dessiner)] : []), h(\"div\", { class: \"actions gauche\" }") > 0);
});
