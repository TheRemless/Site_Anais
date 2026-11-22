// tests/gestion-point-soir.test.js : point du soir de Gestion (22.11.2026). Pickups et rappels de demain, vouchers à envoyer, clients
// WhatsApp sans réponse depuis 12 h. Logique dans src/gestion/js/point-soir-calc.mjs, écran dans views/point-soir.mjs.
// Noms et numéros inventés : le dépôt est public.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const load = () => import("../src/gestion/js/point-soir-calc.mjs");
const ops = () => import("../src/gestion/js/operations-calc.mjs");
const defauts = () => import("../src/gestion/js/defauts.mjs");
const lire = (f) => fs.readFileSync(`src/gestion/js/${f}`, "utf8");

const AJD = "2026-11-22";
const DEMAIN = "2026-11-23";
const resa = (x = {}) => ({ id: "r1", dossier_id: "d1", entite_id: "e-secret", date_service: DEMAIN, heure_pickup: "09:30", lieu_pickup: "Pimalai Resort", libelle: "4 Islands by longtail, full day", statut: "reserve", details: {}, ...x });
const RAPPEL = "Hello {prenom}, see you on {date} for {prestation}. Pickup{a_heure} from {hotel}.";
// Le message d'un pickup, avec les variables de la réservation comme l'écran (variablesMessage).
async function message(r, { client = {}, mode = "excursions", langue = "en", modele = RAPPEL, noms = [] } = {}) {
  const { variablesMessage } = await ops();
  const { messagePickup } = await load();
  const vars = variablesMessage({ reservation: r, client, langue, entreprise: { nom: "Agence test" } });
  return messagePickup({ reservation: r, client, mode, langue, modele, vars, noms });
}

test("la section entre dans l'accueil à 17h et y reste jusqu'à 6h", async () => {
  const { pointSoirVisible } = await load();
  assert.equal(pointSoirVisible(16), false);
  assert.equal(pointSoirVisible(17), true);
  assert.equal(pointSoirVisible(23), true);
  assert.equal(pointSoirVisible(0), true);
  assert.equal(pointSoirVisible(5), true);
  assert.equal(pointSoirVisible(6), false);
  assert.equal(pointSoirVisible(NaN), false);
});

test("point 10 : heures libres normalisées et triées en vraies heures", async () => {
  const { heureNormalisee, minutesDe, pickupsDuPoint } = await load();
  assert.equal(heureNormalisee("8h"), "08:00");
  assert.equal(heureNormalisee("9.30"), "09:30");
  assert.equal(heureNormalisee("14h05"), "14:05");
  assert.equal(heureNormalisee("09:30"), "09:30");
  assert.equal(heureNormalisee("vers midi"), "");
  assert.equal(heureNormalisee("25:00"), "");
  assert.ok(minutesDe("8h") < minutesDe("10:00"));
  const liste = pickupsDuPoint([resa({ id: "dix", heure_pickup: "10:00" }), resa({ id: "huit", heure_pickup: "8h" }), resa({ id: "sans", heure_pickup: "" }), resa({ id: "neuf", heure_pickup: "9.15" })], [DEMAIN]);
  assert.deepEqual(liste.map((r) => r.id), ["huit", "neuf", "dix", "sans"]);
});

test("point 10 : entre minuit et 6h, les pickups du matin même comptent aussi, sauf ceux déjà passés", async () => {
  const { joursDuPoint, pickupsDuPoint } = await load();
  assert.deepEqual(joursDuPoint(AJD, DEMAIN, 2), [AJD, DEMAIN]);
  assert.deepEqual(joursDuPoint(AJD, DEMAIN, 19), [DEMAIN]);
  const liste = pickupsDuPoint([resa({ id: "passe", date_service: AJD, heure_pickup: "01:00" }), resa({ id: "matin", date_service: AJD, heure_pickup: "07:30" }), resa({ id: "demain" })], [AJD, DEMAIN], { ajd: AJD, minuteMaintenant: 2 * 60 });
  assert.deepEqual(liste.map((r) => r.id), ["matin", "demain"]);
});

test("pickups : hors annulés, dossiers annulés et frais de parc", async () => {
  const { pickupsDuPoint } = await load();
  const liste = pickupsDuPoint([resa({ id: "ok" }), resa({ id: "annule", statut: "annule" }), resa({ id: "dossier", dossier_id: "x" }), resa({ id: "parc", libelle: "National park fee", partenaire_id: null })], [DEMAIN], { ecartes: new Set(["x"]) });
  assert.deepEqual(liste.map((r) => r.id), ["ok"]);
});

test("point 7 : le message reprend le modèle « rappel » de l'entreprise, rempli d'après la réservation", async () => {
  const m = await message(resa({ heure_pickup: "8h" }), { client: { prenom: "Noah" } });
  assert.equal(m.texte, "Hello Noah, see you on 23 November 2026 for 4 Islands by longtail, full day. Pickup at 08:00 from Pimalai Resort.");
});

test("point 7 : modèle stocké d'abord, sinon celui par défaut ; « confirmation » le matin même, Taxi toujours « rappel »", async () => {
  const { modeleDuPickup, messagePickup } = await load();
  const { MESSAGES_DEFAUT, MESSAGES_TAXI } = await defauts();
  const stocke = { id: "m1", pour: "client", cle: "rappel", langue: "en", corps: "Stocké {prenom}", actif: true };
  assert.equal(modeleDuPickup({ stockes: [stocke], defauts: MESSAGES_DEFAUT, langue: "en", jour: DEMAIN, demain: DEMAIN }), "Stocké {prenom}");
  assert.equal(modeleDuPickup({ stockes: [], defauts: MESSAGES_DEFAUT, langue: "en", jour: DEMAIN, demain: DEMAIN }), MESSAGES_DEFAUT.find((m) => m.id === "rappel-en").corps);
  assert.equal(modeleDuPickup({ stockes: [], defauts: MESSAGES_DEFAUT, langue: "en", jour: AJD, demain: DEMAIN }), MESSAGES_DEFAUT.find((m) => m.id === "confirmation-en").corps);
  const taxi = MESSAGES_TAXI.find((m) => m.id === "taxi-rappel-en");
  assert.equal(modeleDuPickup({ stockes: [], defauts: MESSAGES_TAXI, langue: "en", mode: "taxi", jour: AJD, demain: DEMAIN }), taxi.corps);
  assert.doesNotMatch(taxi.corps, /\{entreprise\}|tomorrow/, "rappel Taxi daté, sans signature");
  assert.deepEqual(messagePickup({ reservation: resa(), modele: "" }), { texte: null, raison: "modele" });
});

test("point 7 : le bouton WhatsApp de « Demain » partage la trace du point du soir et y renvoie après 17h", () => {
  const d = lire("views/dashboard.mjs");
  assert.match(d, /wa && demain && pointSoirMaintenant\(\)\s*\? h\("a", \{ class: "bouton secondaire petit", href: "#\/soir"/);
  assert.match(d, /if \(demain && !\(await confirmerNouvelEnvoi\(r\)\)\) return;/);
  assert.match(d, /demain \? \{ surEnvoi: \(\) => noterAnnonce\(r, "lien"\) \} : \{\}/);
  assert.match(d, /listeServices\(ag\.demain, \{ demain: true \}\)/);
  // Taxi : le bouton de l'accueil propose aussi le modèle « rappel » par défaut, plus la confirmation.
  assert.match(lire("views/reservations.mjs"), /\.\.\.messagesDefautPour\(reglages\(\)\)\]\.some\(\(m\) => m\.cle === cle\)\) cle = "confirmation";/);
});

test("point 1 : ZTP n'utilise jamais l'adresse postale de la fiche comme lieu", async () => {
  const client = { prenom: "Sofia", adresse: "Rue du Lac 5\n1000 Lausanne", entite_id: "e-ztp" };
  const m = await message(resa({ lieu_pickup: "", entite_id: "e-ztp" }), { client, mode: "voyages", langue: "fr", modele: "Bonjour {prenom}, prise en charge{a_heure} à {hotel}." });
  assert.deepEqual(m, { texte: null, raison: "lieu" });
  const { lieuPickup } = await load();
  assert.equal(lieuPickup(resa({ lieu_pickup: "" }), client, "voyages"), "");
});

test("point 2 : Taxi sans lieu saisi est signalé, jamais l'hôtel de la fiche", async () => {
  const client = { prenom: "Mia", adresse: "Lanta Sand Resort", entite_id: "e-taxi" };
  const m = await message(resa({ lieu_pickup: "", entite_id: "e-taxi", details: { drop_off: "Lanta Sand Resort" } }), { client, mode: "taxi" });
  assert.deepEqual(m, { texte: null, raison: "lieu" });
  // Secret (excursions) garde l'hôtel de la fiche en repli, sans la chambre.
  const s = await message(resa({ lieu_pickup: "" }), { client: { prenom: "Noah", adresse: "Lanta Sand Resort, Room 12", entite_id: "e-secret" } });
  assert.match(s.texte, /from Lanta Sand Resort\.$/);
  // Un lieu saisi avec la chambre : la chambre ne part pas.
  const { lieuPickup } = await load();
  assert.equal(lieuPickup(resa({ lieu_pickup: "Hotel Sunset, Room 6" }), {}, "taxi"), "Hotel Sunset");
});

test("point 8 : retour au point de départ, la dépose dit « back to the pickup place »", async () => {
  const m = await message(resa({ details: { type_trajet: "retour_depart" } }), { client: { prenom: "Mia" }, mode: "taxi", modele: "Hello {prenom}, pickup{a_heure} at {hotel}, drop-off: {dropoff}." });
  assert.equal(m.texte, "Hello Mia, pickup at 09:30 at Pimalai Resort, drop-off: back to the pickup place.");
});

test("une variable du modèle restée vide signale le service au lieu d'une phrase cassée", async () => {
  const m = await message(resa(), { client: { prenom: "Mia" }, mode: "taxi", modele: "Hello {prenom}, drop-off at {dropoff}." });
  assert.deepEqual(m, { texte: null, raison: "variables", manque: ["dropoff"] });
});

test("sans heure lisible : aucun message, le service est signalé", async () => {
  assert.deepEqual(await message(resa({ heure_pickup: "" })), { texte: null, raison: "heure" });
  assert.deepEqual(await message(resa({ heure_pickup: "vers midi" })), { texte: null, raison: "heure" });
});

test("aucun nom de partenaire vers le client : lieu, service ou dépose bloquent le message", async () => {
  const noms = ["Sea Star", "Driver Somchai"];
  const client = { prenom: "Noah" };
  assert.deepEqual(await message(resa({ lieu_pickup: "Sea Star Pier" }), { client, noms }), { texte: null, raison: "nom_partenaire" });
  assert.deepEqual(await message(resa({ libelle: "Transfert par Driver Somchai" }), { client, noms }), { texte: null, raison: "nom_partenaire" });
  assert.deepEqual(await message(resa({ details: { drop_off: "Sea Star Pier" } }), { client, noms, modele: "{prenom}{a_heure}, drop-off {dropoff}" }), { texte: null, raison: "nom_partenaire" });
  // Un modèle qui citerait le partenaire ou son contact : ces variables restent vides vers le client.
  const m = await message(resa({ partenaire_id: "p1" }), { client: { prenom: "Noah" }, noms, modele: "{prenom}|{partenaire}|{contact}|{a_heure}" });
  assert.equal(m.texte, "Noah||| at 09:30");
});

test("point 3 : numéro normalisé comme les vouchers ; sans indicatif, pas de lien et « numéro à corriger »", async () => {
  const { moyenEnvoi } = await load();
  assert.deepEqual(moyenEnvoi({ telephone: "79 123 45 67", texte: "Hi" }), { genre: null, raison: "numero" });
  assert.deepEqual(moyenEnvoi({ telephone: "079 123 45 67", texte: "Hi" }), { genre: null, raison: "numero" });
  assert.deepEqual(moyenEnvoi({ telephone: "0041 79 123 45 67", texte: "Hi" }), { genre: "lien", lien: "https://wa.me/41791234567?text=Hi" });
  assert.deepEqual(moyenEnvoi({ telephone: "+41 79 123 45 67", texte: "Hi Noah" }), { genre: "lien", lien: "https://wa.me/41791234567?text=Hi%20Noah" });
  assert.deepEqual(moyenEnvoi({ telephone: "", texte: "Hi" }), { genre: null, raison: "numero" });
  assert.deepEqual(moyenEnvoi({ conversation: { id: "c1", telephone: "+66812345678" }, fenetre: { ouverte: true }, texte: "Hi" }), { genre: "direct", conversation_id: "c1" });
  assert.equal(moyenEnvoi({ texte: "  " }), null);
  assert.deepEqual(moyenEnvoi({ telephone: "41 79 123 45 67", texte: "Hi" }), { genre: null, raison: "numero" });
  assert.match(lire("point-soir-calc.mjs"), /export const numeroClient = \(tel\) => e164\(tel\) \|\| "";/);
});

test("point 4 : trace « incertain » qui bloque le bouton, et toute trace demande confirmation avant un nouvel envoi", async () => {
  const { detailsAvecAnnonce, annonceDe, etatAnnonce } = await load();
  const d = detailsAvecAnnonce({ envois: { client: "2026-11-20" } }, { le: "2026-11-22T11:05:00Z", par: "incertain" });
  assert.deepEqual(d, { envois: { client: "2026-11-20" }, pickup_annonce: { le: "2026-11-22T11:05:00Z", par: "incertain" } });
  assert.deepEqual(etatAnnonce(annonceDe({ details: d })), { bloque: true, aConfirmer: true });
  assert.deepEqual(etatAnnonce({ le: "x", par: "lien" }), { bloque: false, aConfirmer: true });
  assert.deepEqual(etatAnnonce(null), { bloque: false, aConfirmer: false });
  assert.equal(detailsAvecAnnonce({}, { le: "x", par: "autre" }).pickup_annonce.par, "lien");
  const vue = lire("views/point-soir.mjs");
  // Résultat inconnu : trace « incertain ». Trace pas écrite : « incertain » gardé sur l'appareil.
  assert.match(vue, /if \(envoiIncertain\(code\)\) \{\s*\/\/[^\n]*\n\s*await noterAnnonce\(r, "incertain"\);/);
  assert.match(vue, /tracesLocales\.set\(r\.id, \{ le, par: par === "lien" \? "lien" : "incertain" \}\)/);
  // Bouton éteint tant que la trace est incertaine ; « Renvoyer quand même » et tout envoi après une trace passent par la confirmation.
  assert.match(vue, /disabled: bloque \|\| autre/);
  assert.match(vue, /if \(!dejaConfirme && !\(await confirmerNouvelEnvoi\(r\)\)\) return;/);
  assert.match(vue, /if \(await confirmerNouvelEnvoi\(r\)\) partir\(\{ dejaConfirme: true \}\)/);
  // Après « WhatsApp ouvert », le lien aussi se confirme.
  assert.match(vue, /if \(!a\) return void noterAnnonce\(r, "lien"\)\.then\(refaire\);\s*e\.preventDefault\(\);\s*if \(!\(await confirmerNouvelEnvoi\(r\)\)\) return;/);
});

test("point 5 : le destinataire est affiché avant l'envoi direct, un autre numéro que la fiche se coche", () => {
  const vue = lire("views/point-soir.mjs");
  assert.match(vue, /tr\("À : \{nom\}", \{ nom: nomConversation\(conversation, client\) \}\)/);
  assert.match(vue, /autre \? conversation\.telephone : numeroMasque\(conversation\.telephone\)/);
  assert.match(vue, /const autre = numeroDifferent\(conversation\.telephone, fiche\);/);
  assert.match(vue, /if \(caseNumero && !caseNumero\.checked\) return;/);
});

test("point 6 : la fenêtre de 24 h se lit sur le seul dernier message du client", async () => {
  const { fenetreDepuis } = await load();
  const maintenant = Date.parse("2026-11-22T12:00:00Z");
  assert.deepEqual(fenetreDepuis("2026-11-22T01:00:00Z", maintenant), { ouverte: true });
  assert.deepEqual(fenetreDepuis("2026-11-21T01:00:00Z", maintenant), { ouverte: false });
  assert.deepEqual(fenetreDepuis(null, maintenant), { ouverte: false });
  const store = fs.readFileSync("src/gestion/js/store-supabase.mjs", "utf8");
  assert.match(store, /async whatsappDernierEntrant\(conversationId\) \{\s*const r = await sb\.from\("whatsapp_messages"\)\.select\("envoye_le"\)\.eq\("conversation_id", conversationId\)\.eq\("sens", "entrant"\)\.order\("envoye_le", \{ ascending: false \}\)\.limit\(1\);/);
  assert.match(lire("store-local.mjs"), /async whatsappDernierEntrant\(conversationId\)/);
  const vue = lire("views/point-soir.mjs");
  assert.match(vue, /etat\.store\.whatsappDernierEntrant\(conversation\.id\)/);
  assert.doesNotMatch(vue, /whatsappMessages\(/);
});

test("vouchers à envoyer : jours du point, jamais envoyés ou modifiés depuis l'envoi, en vraies heures", async () => {
  const { envoisAFaire } = await load();
  const v = (id, date, envoi, statut = "reserve", heure = "09:00") => ({ reservation: { id, date_service: date, statut, heure_pickup: heure }, envoi });
  const liste = envoisAFaire(
    [v("envoye", DEMAIN, { le: "2026-11-20", modifie: false }), v("jamais", "2026-11-24", { le: null }), v("modifie", DEMAIN, { le: "2026-11-20", modifie: true }, "reserve", "10:00"), v("tot", DEMAIN, { le: null }, "reserve", "7h"), v("annule", DEMAIN, { le: null }, "annule"), v("loin", "2026-11-26", { le: null })],
    [DEMAIN, "2026-11-24"]
  );
  assert.deepEqual(liste.map((x) => x.reservation.id), ["tot", "modifie", "jamais"]);
});

test("point 9 : WhatsApp sans réponse depuis 12 h, ni contact personnel, ni partenaire typé ou relié à une fiche", async () => {
  const { sansReponse, estContactPartenaire } = await load();
  const maintenant = Date.parse("2026-11-22T12:00:00Z");
  const conv = (id, x = {}) => ({ id, entite_id: "e-secret", dernier_sens: "entrant", attend_depuis: "2026-11-21T20:00:00Z", dernier_message_le: "2026-11-21T21:00:00Z", ...x });
  const liste = sansReponse({
    conversations: [
      conv("vieux", { attend_depuis: "2026-11-21T08:00:00Z" }),
      conv("seize-heures"),
      conv("onze-heures", { attend_depuis: "2026-11-22T01:00:00Z" }),
      conv("repondu", { dernier_sens: "sortant", attend_depuis: null }),
      conv("perso", { reponses: "jamais" }),
      conv("partenaire", { type_contact: "partenaire" }),
      conv("fiche-partenaire", { partenaire_id: "p1" }),
      conv("taxi", { entite_id: "e-taxi" }),
      conv("a-trier", { entite_id: null }),
      conv("merci", { tri: { preparer: false, motif: "remerciement" } }),
    ],
    entiteId: "e-secret",
    maintenant,
  });
  assert.deepEqual(liste.map((x) => x.conversation.id), ["vieux", "seize-heures", "a-trier"]);
  assert.equal(liste[1].attente, "16 h");
  assert.equal(estContactPartenaire({ partenaire_id: "p1" }), true);
  assert.equal(estContactPartenaire({ type_contact: "client" }), false);
});

test("noms interdits : partenaires et conversations de partenaires (type ou fiche reliée), jamais un client", async () => {
  const { nomsInterdits } = await load();
  const noms = nomsInterdits({
    partenaires: [{ nom: "Sea Star" }, { nom: "AB" }],
    conversations: [{ nom: "Front desk test", type_contact: "hotel" }, { nom: "Ava", type_contact: "client" }, { nom: "Driver Somchai", partenaire_id: "p1" }, { nom: "Tom" }],
  });
  assert.deepEqual(noms, ["Sea Star", "Front desk test", "Driver Somchai"]);
});

test("écran : accueil de 17h à 6h, route #/soir, menu « Point du soir », rien ne sonne, aucun modèle Meta, aucun net", () => {
  const vue = lire("views/point-soir.mjs");
  assert.match(lire("views/dashboard.mjs"), /pointSoirMaintenant\(\) \? sectionPointSoir\(\) : null/);
  assert.match(lire("app.mjs"), /\[\/\^#\\\/soir\$\/, "soir", vers\(\(\) => import\("\.\/views\/point-soir\.mjs"\), "vuePointSoir"\)\]/);
  assert.match(lire("app.mjs"), /href: "#\/soir", libelle: tr\("Point du soir"\)/);
  assert.match(vue, /etat\.store\.whatsappEnvoyer\(\{ conversation_id: moyen\.conversation_id, texte \}\)/);
  assert.doesNotMatch(vue, /type: "template"|template_name|new Notification|pushManager|showNotification|functions\/v1\/rappels/);
  assert.doesNotMatch(vue + lire("point-soir-calc.mjs"), /_nets|netReservation|netPrestation|commission/);
});

test("la fonction « rappels » (18h et H-1) n'est pas touchée par le point du soir", () => {
  const rappels = fs.readFileSync("supabase/functions/rappels/index.ts", "utf8");
  assert.doesNotMatch(rappels, /point.du.soir|point-soir|pickup_annonce/i);
});
