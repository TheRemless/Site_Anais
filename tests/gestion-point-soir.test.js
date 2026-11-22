// tests/gestion-point-soir.test.js : point du soir de Gestion (22.11.2026). Pickups et messages de demain, vouchers à envoyer, clients
// WhatsApp sans réponse depuis 12 h. Logique dans src/gestion/js/point-soir-calc.mjs, écran dans views/point-soir.mjs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const load = () => import("../src/gestion/js/point-soir-calc.mjs");
const lire = (f) => fs.readFileSync(`src/gestion/js/${f}`, "utf8");

const DEMAIN = "2026-11-23";
const resa = (x = {}) => ({ id: "r1", dossier_id: "d1", entite_id: "e-secret", date_service: DEMAIN, heure_pickup: "09:30", lieu_pickup: "Pimalai Resort", libelle: "4 Islands by longtail, full day", statut: "reserve", details: {}, ...x });

test("la section entre dans l'accueil à 17h, pas avant", async () => {
  const { pointSoirVisible, HEURE_POINT_SOIR } = await load();
  assert.equal(HEURE_POINT_SOIR, 17);
  assert.equal(pointSoirVisible(16), false);
  assert.equal(pointSoirVisible(17), true);
  assert.equal(pointSoirVisible(23), true);
  assert.equal(pointSoirVisible(NaN), false);
});

test("pickups de demain : hors annulés, dossiers annulés et frais de parc ; sans heure en dernier", async () => {
  const { pickupsDuJour } = await load();
  const liste = pickupsDuJour(
    [
      resa({ id: "a", heure_pickup: "" }),
      resa({ id: "b", heure_pickup: "08:00" }),
      resa({ id: "c", statut: "annule" }),
      resa({ id: "d", dossier_id: "annule" }),
      resa({ id: "e", libelle: "National park fee", partenaire_id: null }),
      resa({ id: "f", date_service: "2026-11-24" }),
      resa({ id: "g", heure_pickup: "09:30" }),
    ],
    DEMAIN,
    { ecartes: new Set(["annule"]) }
  );
  assert.deepEqual(liste.map((r) => r.id), ["b", "g", "a"]);
});

test("heure du message : 9:30 en anglais, 9h30 en français", async () => {
  const { heureMessage } = await load();
  assert.equal(heureMessage("09:30"), "9:30");
  assert.equal(heureMessage("14:05", "en"), "14:05");
  assert.equal(heureMessage("09:30", "fr"), "9h30");
  assert.equal(heureMessage("vers midi"), "vers midi");
});

test("message de Secret : anglais, heure et lieu, sans signature ni prix", async () => {
  const { messagePickup } = await load();
  const { texte } = messagePickup({ reservation: resa({ montant_vente: 1200 }), client: { prenom: "Mark" }, langue: "en", mode: "excursions" });
  assert.equal(texte, "Hello Mark, see you tomorrow for 4 Islands by longtail, full day. Pickup at 9:30 at Pimalai Resort.");
  assert.doesNotMatch(texte, /1200|1,200|Nani|Secret|Travel/);
});

test("message de Taxi : le transfert, le pickup et la dépose", async () => {
  const { messagePickup } = await load();
  const { texte } = messagePickup({ reservation: resa({ libelle: "Transfer Koh Lanta - Krabi Airport", details: { drop_off: "Krabi Airport" } }), client: { prenom: "Lena" }, langue: "en", mode: "taxi" });
  assert.equal(texte, "Hello Lena, your transfer tomorrow: pickup at 9:30 at Pimalai Resort, drop-off at Krabi Airport.");
});

test("message de ZTP : en français, au vouvoiement de la fiche de voix, sans signature", async () => {
  const { messagePickup } = await load();
  const { texte } = messagePickup({ reservation: resa({ libelle: "Transfert vers Krabi" }), client: { prenom: "Claire" }, langue: "fr", mode: "voyages" });
  assert.equal(texte, "Bonjour Claire, demain, Transfert vers Krabi : prise en charge à 9h30 à Pimalai Resort.");
});

test("sans heure ou sans lieu : aucun message, le service est signalé", async () => {
  const { messagePickup } = await load();
  assert.deepEqual(messagePickup({ reservation: resa({ heure_pickup: "" }) }), { texte: null, raison: "heure" });
  assert.deepEqual(messagePickup({ reservation: resa({ lieu_pickup: "" }), client: {} }), { texte: null, raison: "lieu" });
});

test("sans lieu sur la réservation, l'hôtel de la fiche du client (sans la chambre)", async () => {
  const { messagePickup } = await load();
  const { texte } = messagePickup({ reservation: resa({ lieu_pickup: "" }), client: { prenom: "Mark", adresse: "Lanta Sand Resort, Room 12", entite_id: "e-secret" }, langue: "en" });
  assert.match(texte, /at Lanta Sand Resort\.$/);
  assert.doesNotMatch(texte, /Room 12/);
});

test("aucun nom de partenaire vers le client : lieu bloqué, libellé retiré, dépose retirée", async () => {
  const { messagePickup } = await load();
  const noms = ["Rattana", "Mr. Brown"];
  assert.deepEqual(messagePickup({ reservation: resa({ lieu_pickup: "Rattana Pier" }), noms }), { texte: null, raison: "lieu_partenaire" });
  const t1 = messagePickup({ reservation: resa({ libelle: "Transfert par Mr. Brown" }), client: { prenom: "Mark" }, noms }).texte;
  assert.equal(t1, "Hello Mark, see you tomorrow. Pickup at 9:30 at Pimalai Resort.");
  const t2 = messagePickup({ reservation: resa({ details: { drop_off: "Rattana Pier" } }), client: {}, mode: "taxi", noms }).texte;
  assert.equal(t2, "Hello, your transfer tomorrow: pickup at 9:30 at Pimalai Resort.");
});

test("envoi d'un geste : direct dans la fenêtre de 24 h, sinon wa.me, sinon rien", async () => {
  const { moyenEnvoi } = await load();
  const conv = { id: "c1", telephone: "+66812345678" };
  assert.deepEqual(moyenEnvoi({ conversation: conv, fenetre: { ouverte: true }, texte: "Hello" }), { genre: "direct", conversation_id: "c1" });
  assert.deepEqual(moyenEnvoi({ conversation: conv, fenetre: { ouverte: false }, texte: "Hello Mark" }), { genre: "lien", lien: "https://wa.me/66812345678?text=Hello%20Mark" });
  assert.deepEqual(moyenEnvoi({ conversation: null, telephone: "+41 79 123 45 67", texte: "Hi" }), { genre: "lien", lien: "https://wa.me/41791234567?text=Hi" });
  assert.equal(moyenEnvoi({ conversation: null, telephone: "", texte: "Hi" }), null);
  assert.equal(moyenEnvoi({ conversation: conv, fenetre: { ouverte: true }, texte: "  " }), null);
});

test("fenêtre lue sur la conversation quand son dernier message est du client, sinon null", async () => {
  const { fenetreDepuisConversation } = await load();
  const maintenant = Date.parse("2026-11-22T12:00:00Z");
  assert.deepEqual(fenetreDepuisConversation({ dernier_sens: "entrant", dernier_message_le: "2026-11-22T01:00:00Z" }, maintenant), { ouverte: true });
  assert.deepEqual(fenetreDepuisConversation({ dernier_sens: "entrant", dernier_message_le: "2026-11-21T01:00:00Z" }, maintenant), { ouverte: false });
  assert.equal(fenetreDepuisConversation({ dernier_sens: "sortant", dernier_message_le: "2026-11-22T01:00:00Z" }, maintenant), null);
});

test("la trace de l'envoi garde les autres détails de la réservation", async () => {
  const { detailsAvecAnnonce, annonceDe } = await load();
  const d = detailsAvecAnnonce({ envois: { client: "2026-11-20" }, vol: "FD3217" }, { le: "2026-11-22T11:05:00Z", par: "direct" });
  assert.deepEqual(d, { envois: { client: "2026-11-20" }, vol: "FD3217", pickup_annonce: { le: "2026-11-22T11:05:00Z", par: "direct" } });
  assert.equal(detailsAvecAnnonce({}, { le: "x", par: "autre" }).pickup_annonce.par, "lien");
  assert.deepEqual(annonceDe({ details: d }), d.pickup_annonce);
  assert.equal(annonceDe({ details: {} }), null);
});

test("vouchers à envoyer : demain et après-demain, jamais envoyés ou modifiés depuis l'envoi", async () => {
  const { envoisAFaire } = await load();
  const v = (id, date, envoi, statut = "reserve", heure = "09:00") => ({ reservation: { id, date_service: date, statut, heure_pickup: heure }, envoi });
  const liste = envoisAFaire(
    [
      v("envoye", DEMAIN, { le: "2026-11-20", modifie: false }),
      v("jamais", "2026-11-24", { le: null }),
      v("modifie", DEMAIN, { le: "2026-11-20", modifie: true }, "reserve", "10:00"),
      v("tot", DEMAIN, { le: null }, "reserve", "07:00"),
      v("annule", DEMAIN, { le: null }, "annule"),
      v("loin", "2026-11-26", { le: null }),
    ],
    [DEMAIN, "2026-11-24"]
  );
  assert.deepEqual(liste.map((x) => x.reservation.id), ["tot", "modifie", "jamais"]);
});

test("WhatsApp sans réponse depuis plus de 12 h : clients de l'entreprise et à trier, jamais un contact personnel ni un partenaire", async () => {
  const { sansReponse } = await load();
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
      conv("taxi", { entite_id: "e-taxi" }),
      conv("a-trier", { entite_id: null }),
      conv("merci", { tri: { preparer: false, motif: "remerciement" } }),
    ],
    entiteId: "e-secret",
    maintenant,
  });
  assert.deepEqual(liste.map((x) => x.conversation.id), ["vieux", "seize-heures", "a-trier"]);
  assert.equal(liste[1].attente, "16 h");
  assert.equal(liste[2].aTrier, true);
});

test("écran : accueil à 17h, route #/soir, menu « Point du soir », rien ne sonne et aucun modèle Meta", () => {
  const vue = lire("views/point-soir.mjs");
  assert.match(lire("views/dashboard.mjs"), /pointSoirMaintenant\(\) \? sectionPointSoir\(\) : null/);
  assert.match(lire("app.mjs"), /\[\/\^#\\\/soir\$\/, "soir", vers\(\(\) => import\("\.\/views\/point-soir\.mjs"\), "vuePointSoir"\)\]/);
  assert.match(lire("app.mjs"), /href: "#\/soir", libelle: tr\("Point du soir"\)/);
  // L'envoi direct passe par whatsapp-envoi (etat.store.whatsappEnvoyer), sinon wa.me : ni notification, ni modèle payant.
  assert.match(vue, /etat\.store\.whatsappEnvoyer\(\{ conversation_id: moyen\.conversation_id, texte \}\)/);
  assert.doesNotMatch(vue, /type: "template"|template_name|new Notification|pushManager|showNotification|functions\/v1\/rappels/);
  // Les nets ne sont jamais lus par l'écran.
  assert.doesNotMatch(vue + lire("point-soir-calc.mjs"), /_nets|netReservation|netPrestation|commission/);
});

test("la fonction « rappels » (18h et H-1) n'est pas touchée par le point du soir", () => {
  const rappels = fs.readFileSync("supabase/functions/rappels/index.ts", "utf8");
  assert.doesNotMatch(rappels, /point.du.soir|point-soir/i);
});

test("noms interdits : partenaires et contacts WhatsApp typés, jamais un client", async () => {
  const { nomsInterdits, messagePickup } = await load();
  const noms = nomsInterdits({
    partenaires: [{ nom: "Rattana" }, { nom: "AB" }],
    conversations: [{ nom: "Pimalai front desk", type_contact: "hotel" }, { nom: "Lea", type_contact: "client" }, { nom: "Mr Brown", partenaire_id: "p1" }, { nom: "Tom" }],
  });
  assert.deepEqual(noms, ["Rattana", "Pimalai front desk", "Mr Brown"]);
  assert.equal(messagePickup({ reservation: resa({ lieu_pickup: "Pimalai front desk" }), noms }).raison, "lieu_partenaire");
});

test("un envoi direct déjà fait se confirme avant de repartir", () => {
  const vue = lire("views/point-soir.mjs");
  assert.match(vue, /deja\.par === "direct" && !\(await confirmer\(/);
});
