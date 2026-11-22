// Relecture d'un dossier Taxi par Jérémy (22.11.2026), quatre défauts de l'Assistant :
//   1. la dépose : un lien Google Maps de la conversation devient le nom de l'établissement, jamais le lien, et la dépose de la carte arrive
//      dans details.drop_off de la réservation ;
//   2. la remarque du voucher ne redit rien de ce que le voucher imprime et ne porte aucun lien ; la note interne tient en une ligne ;
//   3. « Prêt à réserver » sort quand le service est créé depuis le prix, même dans un dossier plus ancien ; il revient sur un nouveau prix ;
//   4. une course de Taxi ajoutée par carte reçoit le chauffeur de l'entreprise.
// Dépôt public : noms, lieux, liens et messages inventés.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as M from "../supabase/functions/agent/maps.js";
import { executer, refDe, remarqueSansDoublons, noteCourte, NOTE_MAX, lieuxDuService, avecLieuxMaps } from "../supabase/functions/agent/outils.js";
import { tempsSimule } from "../supabase/functions/agent/planifier.js";
import { reservationDepuisCarte, chauffeurCarte } from "../src/gestion/js/agent-calc.mjs";
import { etatPret, reserveDepuis } from "../supabase/functions/whatsapp/pret.js";
import { faitsAvancee } from "../supabase/functions/whatsapp/etapes.js";
import { pretAReserver, serviceCree } from "../src/gestion/js/whatsapp-pret-calc.mjs";
import { etapesConversation } from "../src/gestion/js/whatsapp-etapes-calc.mjs";
import { partenaireDeTaxi } from "../src/gestion/js/voucher-rapide-calc.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const COURT = "https://maps.app.goo.gl/ExempleLienCourt1?g_st=ic";
const NOM_TH = "ร้านตัวอย่าง";
const Q = `${NOM_TH} 12 3 ต.ตัวอย่าง เมือง Krabi 81000, Thailand`;
// Un faux fetch : le lien court répond 302 vers maps.google.com?q=…, rien d'autre n'est appelé.
const appels = [];
const fauxFetch = (table) => async (url, opts) => {
  appels.push({ url, opts });
  const loc = table[url];
  if (loc instanceof Error) throw loc;
  return { status: loc ? 302 : 200, headers: new Map(loc ? [["location", loc]] : []), body: null };
};

// ---- 1. Dépose : liens Google Maps -------------------------------------------------------------------------------------------------
test("maps : seuls les hôtes de Google sont reconnus (pas de SSRF), la ponctuation finale ne compte pas", () => {
  assert.deepEqual(M.liensMaps(`I think it's here ${COURT}. Or https://www.google.com/maps/place/Hotel+Exemple/@7.5,99.0,17z !`), [COURT, "https://www.google.com/maps/place/Hotel+Exemple/@7.5,99.0,17z"]);
  for (const u of ["https://maps.app.goo.gl.evil.example/x", "https://google.com.evil.example/maps", "https://maps.google.com@evil.example/", "https://evil.example/?u=https://maps.app.goo.gl/x", "http://127.0.0.1/maps", "https://goo.gl/abc", "https://maps.google.com:8443/x"]) {
    assert.equal(M.hoteGoogle(u), false, u);
  }
  assert.equal(M.hoteGoogle("https://maps.google.co.th/?q=x"), true);
  assert.deepEqual(M.liensMaps("Booking: https://www.booking.com/hotel/th/exemple.html"), [], "un lien Booking n'est pas un lien Maps");
});

test("maps : le nom est la partie avant le numéro et l'adresse ; virgule, repère thaï, place/ et coordonnées", () => {
  assert.deepEqual(M.nomEtAdresse(Q), { nom: NOM_TH, adresse: "12 3 ต.ตัวอย่าง เมือง Krabi 81000, Thailand" });
  assert.equal(M.nomEtAdresse("Resort Exemple, 99 Moo 2, Saladan").nom, "Resort Exemple");
  assert.equal(M.nomEtAdresse("7-Eleven Exemple 45 Moo 3").nom, "7-Eleven Exemple", "le premier mot n'est jamais coupé");
  assert.equal(M.nomEtAdresse("ร้านทดสอบ ต.ศาลาด่าน").nom, "ร้านทดสอบ");
  assert.equal(M.nomEtAdresse("7.5312,99.0421"), null);
  assert.equal(M.lieuDepuisUrl("https://www.google.com/maps/place/Villa+Exemple/@7.5,99.0,17z").nom, "Villa Exemple");
  assert.equal(M.lieuDepuisUrl(`https://maps.google.com?q=${encodeURIComponent(Q)}&ftid=0x1`).nom, NOM_TH);
});

test("maps : le lien court se lit par sa redirection, sans la suivre, avec un délai ; un échec ne lève jamais", async () => {
  appels.length = 0;
  const r = await M.resoudreLienMaps(COURT, { fetchImpl: fauxFetch({ [COURT]: `https://maps.google.com?q=${encodeURIComponent(Q)}` }) });
  assert.deepEqual([r.nom, r.url], [NOM_TH, COURT]);
  assert.equal(appels.length, 1);
  assert.equal(appels[0].opts.redirect, "manual");
  assert.ok(appels[0].opts.signal, "un délai court");
  assert.equal(appels[0].opts.credentials, "omit");
  // Redirection hors de Google : rien n'est appelé ensuite.
  appels.length = 0;
  assert.equal((await M.resoudreLienMaps(COURT, { fetchImpl: fauxFetch({ [COURT]: "https://evil.example/?q=Hotel" }) })).nom, null);
  assert.equal(appels.length, 1);
  // Réseau en panne, délai dépassé, réponse sans Location : null.
  assert.equal((await M.resoudreLienMaps(COURT, { fetchImpl: fauxFetch({ [COURT]: new Error("timeout") }) })).nom, null);
  assert.equal((await M.resoudreLienMaps(COURT, { fetchImpl: fauxFetch({}) })).nom, null);
  // Une adresse longue se lit sans réseau.
  appels.length = 0;
  assert.equal((await M.resoudreLienMaps("https://www.google.com/maps/place/Hotel+Exemple/@7,99,17z", { fetchImpl: fauxFetch({}) })).nom, "Hotel Exemple");
  assert.equal(appels.length, 0);
});

test("maps : le lien est remplacé par l'établissement dans ce que lit le modèle (message et lire_conversation)", async () => {
  const opts = { fetchImpl: fauxFetch({ [COURT]: `https://maps.google.com?q=${encodeURIComponent(Q)}` }) };
  const { texte, lieux } = await M.annoterLiensMaps(`[Nani] I think it's here ${COURT}`, opts);
  assert.doesNotMatch(texte, /goo\.gl/);
  assert.match(texte, new RegExp(`établissement « ${NOM_TH} »`));
  assert.equal(lieux[0].nom, NOM_TH);
  assert.match((await M.annoterLiensMaps(`here ${COURT}`, { fetchImpl: fauxFetch({}) })).texte, /lien Google Maps non lu/);
  // lire_conversation : seuls les messages avec un lien changent ; memo.lieuxMaps garde les lieux lus.
  const memo = {};
  const lu = await avecLieuxMaps({ messages: [{ de: "client", texte: "Thanks" }, { de: "Nani", texte: `here ${COURT}` }] }, { lieuxMaps: (t) => M.annoterLiensMaps(t, opts) }, memo);
  assert.equal(lu.messages[0].texte, "Thanks");
  assert.doesNotMatch(lu.messages[1].texte, /goo\.gl/);
  assert.equal(memo.lieuxMaps[0].nom, NOM_TH);
  // Branché dans la fonction : le message de la personne et les lectures de la boîte.
  const index = lire("supabase/functions/agent/index.ts");
  assert.match(index, /const maps = message \? await lieuxMaps\(message\)/);
  assert.match(index, /\.lieuxMaps = maps\.lieux;/);
  assert.match(index, /moteur, lieuxMaps, maintenant/);
  assert.match(lire("supabase/functions/agent/outils.js"), /resultat: await avecLieuxMaps\(lireConversation\(/);
});

test("dépose : un lien recopié dans un lieu devient l'établissement, sinon il est retiré avec un avertissement", () => {
  const lieux = [{ url: COURT, nom: NOM_TH, adresse: "" }];
  const a = [];
  assert.deepEqual(lieuxDuService({ lieu_pickup: "Resort Exemple", de: "Koh Lanta", vers: COURT }, { lieuxMaps: lieux }, a), { lieu_pickup: "Resort Exemple", de: "Koh Lanta", vers: NOM_TH });
  assert.deepEqual(a, []);
  const b = [];
  assert.equal(lieuxDuService({ vers: "Krabi Town: https://maps.app.goo.gl/Inconnu2" }, { lieuxMaps: [] }, b).vers, "Krabi Town");
  assert.deepEqual(b, ["lieu_a_verifier"]);
  // Un lien Maps lu mais pas résolu : la dépose d'un transfert est à vérifier.
  const c = [];
  lieuxDuService({ de: "Koh Lanta", vers: "Krabi Town" }, { lieuxMaps: [{ url: COURT, nom: null }] }, c);
  assert.deepEqual(c, ["lieu_a_verifier"]);
});

// La carte et la réservation, comme dans le cas réel (rendu fictif) : ajout d'une course à un dossier Taxi existant.
const DOS = "d3000000-0000-4000-8000-000000000003";
const PA = "aaaaaaaa-0000-4000-8000-000000000003";
const donnees = { partenaires: [{ id: PA, nom: "Chauffeur Exemple", actif: true, taxi_defaut: true }], prestations: [], trajets: [], clients: [{ id: "c3", prenom: "Exemple", nom: "Client" }], dossiers: [{ id: DOS, ref: "2026-0099", client_id: "c3", annule: false }], reservations: [] };
const ctx = () => ({ charger: async (n) => donnees[n] || [], reglages: { fonctionnement: "taxi" }, simule: tempsSimule });
const memo = (extra = {}) => ({ prix: new Set(), heures: new Set(), tapes: new Set(["2500"].map(Number)), durees: new Set(), estimations: new Map(), signer: false, prestataires: ["Chauffeur Exemple"], entreprise: "Test", textes: [], ...extra });
const SERVICE = {
  texte: "transfert privé minivan Resort Exemple → Krabi Town",
  ref: "",
  date: "2026-11-24",
  heure_pickup: "10:00",
  lieu_pickup: "Resort Exemple",
  de: "Resort Exemple",
  vers: `Krabi Town ${COURT}`,
  adultes: 4,
  enfants: 0,
  sieges: 0,
  sieges_bebe: 0,
  sans_siege: false,
  bagages: 0,
  prix_saisi: "2500",
  vol: "",
  remarque_voucher: `Private minivan. Ferry tickets included for all passengers. Cash payment to the driver. Drop-off at the guests' accommodation in Krabi Town: ${COURT}`,
  note_interne: "Prix 2500 donné par Nani pour 4 pers. (2700 annoncé d'abord pour 8). Adresse de dépose déduite du lien envoyé par Nani, à confirmer avec le client avant le jour du transfert.",
};

test("dépose : la carte porte l'établissement du lien et la réservation le reçoit dans details.drop_off", async () => {
  const carte = await executer("proposer_reservation", { titre: "Ajout", dossier: refDe("D", DOS), service: SERVICE }, ctx(), memo({ lieuxMaps: [{ url: COURT, nom: `${NOM_TH} / Exemple`, adresse: "" }] }));
  const s = carte.carte.donnees.service;
  assert.equal(s.vers, `Krabi Town ${NOM_TH} / Exemple`);
  assert.doesNotMatch(JSON.stringify(carte.carte), /goo\.gl|https?:/, "aucun lien dans la carte");
  const r = reservationDepuisCarte(carte.carte.donnees);
  assert.equal(r.details.drop_off, s.vers, "la dépose de la carte n'est plus perdue");
  assert.equal(reservationDepuisCarte({ dossier_id: DOS, service: { vers: `Hotel ${COURT}` } }).details.drop_off, "Hotel", "l'écran retire aussi un lien");
  assert.equal(reservationDepuisCarte({ dossier_id: DOS, service: { vers: "" } }).details, undefined, "rien quand rien n'est dit");
});

// ---- 2. Remarque du voucher et note interne -----------------------------------------------------------------------------------------
test("remarque : rien de ce que le voucher imprime déjà, aucun lien ; vide par défaut", async () => {
  assert.equal(remarqueSansDoublons(SERVICE.remarque_voucher), "", "la remarque du cas réel (vidée par Anaïs) part vide");
  for (const t of ["Cash payment to the driver.", "Payment in cash on arrival.", "Private taxi.", "Private minivan for 4 people.", "Pick-up at 10:00 from the lobby.", "4 passengers.", "All fees included.", "Including ferry fee."]) assert.equal(remarqueSansDoublons(t), "", t);
  assert.equal(remarqueSansDoublons("Meet at the pier exit, the driver holds a name sign. See https://example.org/plan"), "Meet at the pier exit, the driver holds a name sign. See");
  assert.equal(remarqueSansDoublons("One surfboard. Cash payment to the driver."), "One surfboard.");
  const carte = await executer("proposer_reservation", { titre: "Ajout", dossier: refDe("D", DOS), service: SERVICE }, ctx(), memo());
  assert.equal(carte.carte.donnees.service.remarque_voucher, "");
  assert.equal(reservationDepuisCarte(carte.carte.donnees).details.remarques, undefined);
  // Une modification de la remarque passe par la même garde.
  const donneesMod = { ...donnees, reservations: [{ id: "e3000000-0000-4000-8000-000000000003", dossier_id: DOS, libelle: "Course", statut: "confirme", personnes: { adultes: 2 } }] };
  const mod = await executer("proposer_modification", { titre: "Remarque", reservation: refDe("R", "e3000000-0000-4000-8000-000000000003"), champ: "remarque_voucher", valeur: `One surfboard. ${COURT}`, raison: "" }, { ...ctx(), charger: async (n) => donneesMod[n] || [] }, memo());
  assert.equal(mod.carte.donnees.valeur, "One surfboard.");
});

test("note interne : une ligne au plus, sans l'histoire de la conversation", async () => {
  const n = noteCourte(SERVICE.note_interne);
  assert.ok(n.length <= NOTE_MAX, n);
  assert.doesNotMatch(n, /\n/);
  assert.equal(noteCourte("Net 1800.\nPartner to call."), "Net 1800. Partner to call.");
  const carte = await executer("proposer_reservation", { titre: "Ajout", dossier: refDe("D", DOS), service: SERVICE }, ctx(), memo());
  assert.ok(carte.carte.donnees.service.note_interne.length <= NOTE_MAX);
  // Les consignes et la définition de l'outil le disent.
  const prompt = lire("supabase/functions/agent/prompt.js");
  assert.doesNotMatch(prompt, /dans « remarque_voucher », en anglais, l'heure d'arrivée prévue, « ferry included », le paiement en espèces/);
  assert.match(prompt, /« remarque_voucher » reste donc vide par défaut/);
  const outils = lire("supabase/functions/agent/outils.js");
  assert.doesNotMatch(outils, /« Ferry included\. Cash payment to the driver\./);
  assert.match(outils, /remarque_voucher: S\("\\"\\" par défaut\./);
});

// ---- 3. Prêt à réserver après la création du service --------------------------------------------------------------------------------
// Le déroulé du cas réel, rendu fictif : prix, oui du client, nouveau prix, service créé par la carte à 13:51, voucher et confirmation à 13:55.
const M3 = (sens, texte, le, extra = {}) => ({ id: `m${le}`, sens, type: "text", texte, medias: [], envoye_le: `2026-11-22T${le}:00+00:00`, supprime_le: null, ...extra });
const MESSAGES = [
  M3("entrant", "Hello, can we have a ride from Resort Exemple to Krabi Town on Tuesday 10:00?", "08:37"),
  M3("sortant", "Hello! The total price for a private minivan is 2,700 THB. Would you like to book?", "08:38"),
  M3("entrant", "Sorry it's only for 4 people", "09:31"),
  M3("entrant", "Yeah please book it :)", "09:31"),
  M3("sortant", "Ok then 2500 THB", "09:32"),
  M3("sortant", "Thank you for choosing us. Please see the attached confirmation and show it to the driver at pick-up.", "13:55"),
];
const CONV = { id: "w3", reponses: "auto", type_contact: null, partenaire_id: null, client_id: "c3", dossier_id: DOS, tri: { motif: "demande_client" } };
const SERVICE_CREE = { id: "r-nouveau", dossier_id: DOS, statut: "confirme", created_at: "2026-11-22T13:51:49+00:00" };

test("prêt : un service créé depuis le prix retire « prêt », même dans un dossier d'avant le prix ; la confirmation d'après ne le refait pas", () => {
  assert.equal(etatPret(CONV, MESSAGES, "2026-11-22T14:00:00Z").pret, true, "(témoin) sans les services, la confirmation fait « prêt »");
  const d = etatPret(CONV, MESSAGES, "2026-11-22T14:00:00Z", { reservations: [SERVICE_CREE, { statut: "confirme", created_at: "2026-11-16T12:38:42+00:00" }] });
  assert.deepEqual([d.pret, d.motif, d.reserve_le], [false, "reserve", SERVICE_CREE.created_at]);
  assert.equal(etatPret(CONV, MESSAGES, "2026-11-22T14:00:00Z", { reservations: [{ ...SERVICE_CREE, statut: "annule" }] }).pret, true, "un service annulé ne compte pas");
  assert.equal(reserveDepuis([{ created_at: "2026-11-16T12:00:00Z" }], "2026-11-22T09:32:00Z"), null, "un service d'avant le prix ne compte pas");
  // Une nouvelle demande du client après le service, un nouveau prix et un oui : de nouveau prête.
  const suite = [...MESSAGES, M3("entrant", "Can we also go back on Friday?", "15:00"), M3("sortant", "Yes, 2,500 THB as well. Would you like to book?", "15:05"), M3("entrant", "Yes please", "15:06")];
  const e = etatPret(CONV, suite, "2026-11-22T16:00:00Z", { reservations: [SERVICE_CREE] });
  assert.equal(e.pret, true);
  assert.equal(e.depuis, "2026-11-22T15:05:00+00:00");
  // Les faits des étapes suivent la même règle.
  assert.equal(faitsAvancee(CONV, MESSAGES, "2026-11-22T14:00:00Z", { reservations: [SERVICE_CREE] }).pret, null);
});

test("prêt : la fonction lit les services des dossiers du client chez Secret et Taxi seulement, et les passe aux deux calculs", () => {
  const ts = lire("supabase/functions/whatsapp/pret.ts");
  assert.match(ts, /\.from\("entites"\)\.select\("id"\)\.eq\("organisation_id", conv\.organisation_id\)\.in\("slug", \["secret", "taxi"\]\)/);
  assert.match(ts, /\.from\("dossiers"\)\.select\("id"\)\.in\("entite_id", ids\)\.eq\("annule", false\)/);
  assert.match(ts, /etatPret\(conv, messages, undefined, \{ reservations \}\)/);
  assert.match(ts, /faitsAvancee\(conv, messages, undefined, \{ reservations \}\)/);
});

test("prêt (écran) : une décision gardée « prêt » sort dès que le service existe, sans attendre un message ; jamais un dossier ZTP", () => {
  const p = etatPret(CONV, MESSAGES, "2026-11-22T14:00:00Z");
  const c = { ...CONV, pret_reserver: p };
  const marqueDe = (id) => ({ taxi: "taxi", ztp: null })[id] ?? null;
  const dossiers = [{ id: DOS, client_id: "c3", entite_id: "taxi", annule: false, created_at: "2026-11-16T12:38:41Z" }];
  assert.ok(pretAReserver(c, { dossiers, reservations: [], marqueDe }), "(témoin) dossier relié d'avant le prix, aucun service");
  assert.equal(pretAReserver(c, { dossiers, reservations: [SERVICE_CREE], marqueDe }), null);
  assert.equal(serviceCree(c, { dossiers, reservations: [SERVICE_CREE], marqueDe }).id, "r-nouveau");
  // Un dossier ZTP du client ne compte jamais.
  const ztp = [{ id: "dz", client_id: "c3", entite_id: "ztp", annule: false, created_at: "2026-11-16T12:38:41Z" }];
  assert.ok(pretAReserver({ ...c, dossier_id: null }, { dossiers: ztp, reservations: [{ ...SERVICE_CREE, dossier_id: "dz" }], marqueDe }));
  assert.match(lire("src/gestion/js/views/whatsapp-pret.mjs"), /reservations: \(etat\.brut && etat\.brut\.reservations\) \|\| \[\]/);
  // Les étapes : le service ajouté au dossier répond au prix, l'étape vient du dossier et plus de « Prêt à réserver ».
  const avec = { ...c, avancee: faitsAvancee(CONV, MESSAGES, "2026-11-22T14:00:00Z") };
  const etapes = etapesConversation(avec, { dossiers, reservations: [SERVICE_CREE], marqueDe, maintenant: Date.parse("2026-11-22T14:00:00Z"), aujourdhui: "2026-11-22" });
  assert.equal(etapes.find((x) => x.entreprise === "taxi").etape, "reserve");
});

// ---- 4. Le chauffeur de la course Taxi ----------------------------------------------------------------------------------------------
test("partenaire : une course de Taxi ajoutée par carte reçoit le chauffeur réglé ; jamais hors Taxi ; la ligne du catalogue l'emporte", () => {
  const defaut = partenaireDeTaxi(donnees.partenaires, null);
  assert.equal(chauffeurCarte({ offre: null }, { taxi: true, defaut }), PA);
  assert.equal(chauffeurCarte({ offre: null }, { taxi: false, defaut }), null, "Secret : taxi indépendant, aucun partenaire");
  assert.equal(chauffeurCarte({ offre: { genre: "trajet", id: "t1" } }, { taxi: true, defaut, trajets: [{ id: "t1", partenaire_id: "autre" }] }), "autre");
  assert.equal(chauffeurCarte({ offre: { genre: "prestation", id: "p1" } }, { taxi: true, defaut, prestations: [{ id: "p1", partenaire_id: null }] }), PA);
  assert.equal(reservationDepuisCarte({ dossier_id: DOS, service: {} }, { partenaireId: PA }).partenaire_id, PA);
  assert.equal("partenaire_id" in reservationDepuisCarte({ dossier_id: DOS, service: {} }), false);
  // Les deux chemins de l'écran (valider d'un geste, « Vérifier avant ») passent le chauffeur, calculé dans l'entreprise du dossier.
  const vue = lire("src/gestion/js/views/agent.mjs");
  assert.equal((vue.match(/reservationDepuisCarte\(c\.donnees, \{ partenaireId: chauffeurDeLaCarte\(c\) \}\)/g) || []).length, 2);
  assert.match(vue, /chauffeurCarte\(\(c\.donnees \|\| \{\}\)\.service, \{ taxi: modeTaxi\(\), defaut: modeTaxi\(\) \? partenaireDeTaxi\(etat\.db\.partenaires, chauffeurRegle\(reglages\(\)\)\) : null/);
});
