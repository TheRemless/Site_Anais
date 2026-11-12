// Chaque entreprise ses éléments : noms de fichiers, message joint au voucher, langue client, réponse à une demande, remise des modèles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nomFichierVoucher, messageVoucher, gabaritConfirmationVoucher, langueClient, gabaritsRemis, variablesMessage } from "../src/gestion/js/operations-calc.mjs";
import { nomFichier } from "../src/gestion/js/calc.mjs";
import { langueReponse } from "../src/gestion/js/demande-calc.mjs";
import { MESSAGES_DEFAUT, messagesDefautPour } from "../src/gestion/js/defauts.mjs";

test("nom du fichier du voucher : « Booking confirmation » en taxi, « Voucher » ailleurs", () => {
  assert.equal(nomFichierVoucher("TX-2026-0001-1", "Tom Smith", { taxi: true }), "Booking confirmation TX-2026-0001-1 - Tom.png");
  assert.equal(nomFichierVoucher("EX-2026-0003-1", "Anna Keller", { taxi: false }), "Voucher EX-2026-0003-1 - Anna.png");
  assert.equal(nomFichierVoucher("EX-2026-0003-1", "Anna Keller"), "Voucher EX-2026-0003-1 - Anna.png", "sans option : comme avant");
});

test("message joint au voucher : le modèle « confirmation » en anglais de l'entreprise, le texte écrit en dur seulement en secours", () => {
  const taxi = messagesDefautPour({ fonctionnement: "taxi" });
  const gabaritTaxi = gabaritConfirmationVoucher([], taxi);
  assert.match(gabaritTaxi, /Thank you for choosing VIP TAXI LANTA/, "Taxi : taxi-confirmation-en");
  assert.equal(messageVoucher({ pour: "client", prenom: "Tom", gabarit: gabaritTaxi }), gabaritTaxi.trim());

  // Un modèle propre à l'entreprise passe avant le modèle par défaut, et ses variables sont remplies.
  const propre = [{ id: "x", pour: "client", cle: "confirmation", langue: "en", titre: "Mine", corps: "Hi {prenom}, see you on {date} with {entreprise}." }];
  const gabarit = gabaritConfirmationVoucher(propre, MESSAGES_DEFAUT);
  const vars = variablesMessage({ reservation: { date_service: "2026-12-10" }, client: { prenom: "Anna", nom: "Keller" }, entreprise: { nom: "Secret Travel & Tour" }, langue: "en" });
  assert.equal(messageVoucher({ pour: "client", prenom: "Anna", gabarit, vars }), "Hi Anna, see you on 10 December 2026 with Secret Travel & Tour.");

  // Secret sans modèle en base : son modèle par défaut confirmation-en, jamais le français.
  assert.match(gabaritConfirmationVoucher([], MESSAGES_DEFAUT), /^Hello \{prenom\}/);
  // Aucun modèle : le texte de secours.
  assert.equal(messageVoucher({ pour: "client", prenom: "Anna", gabarit: gabaritConfirmationVoucher([], []) }), "Hello Anna, here is your booking confirmation for your program. We wish you an excellent day!");
});

test("nom du PDF : « Invoice » et « Quote » pour un document en anglais", () => {
  const dossier = { ref: "INV-2026-001" };
  const client = { nom: "Keller" };
  assert.equal(nomFichier("facture", { contenu: { langue: "en" } }, dossier, client), "Invoice INV-2026-001 - Keller");
  assert.equal(nomFichier("devis", { contenu: { langue: "en" } }, dossier, client), "Quote INV-2026-001 - Keller");
  assert.equal(nomFichier("facture", { contenu: { langue: "" } }, dossier, client), "Facture INV-2026-001 - Keller");
  assert.equal(nomFichier("devis", { contenu: {} }, dossier, client), "Devis INV-2026-001 - Keller");
});

test("langue client : d'après le mode de l'entreprise, jamais d'après le libellé de facture", () => {
  assert.equal(langueClient({ fonctionnement: "excursions", libelles: { facture: "FACTURE" } }), "en");
  assert.equal(langueClient({ fonctionnement: "taxi" }), "en");
  assert.equal(langueClient({ fonctionnement: "sur_mesure", libelles: { facture: "INVOICE" } }), "fr");
  assert.equal(langueClient(null), "fr");
});

test("réponse à une demande collée : toujours en anglais en excursions, la langue du client ailleurs", () => {
  const fr = "Bonjour, nous voudrions le tour des 4 îles pour demain, merci";
  assert.equal(langueReponse(fr, true), "en");
  assert.equal(langueReponse(fr, false), "fr");
  assert.equal(langueReponse("Hello, we would like the 4 islands tour", false), "en");
});

test("« Remettre ceux de départ » : les modèles créés par l'entreprise restent, les modèles d'origine reprennent leur texte", () => {
  const defauts = [
    { id: "confirmation-en", pour: "client", cle: "confirmation", langue: "en", titre: "Confirmation", corps: "Hello {prenom}" },
    { id: "avis-en", pour: "client", cle: "avis", langue: "en", titre: "Review", corps: "Review {lien_avis}" },
  ];
  const stockes = [
    { id: "confirmation-en", pour: "client", cle: "confirmation", langue: "en", titre: "Confirmation", corps: "Texte modifié" },
    { id: "propre", pour: "client", cle: "meteo", langue: "en", titre: "Weather", corps: "Rain tomorrow" },
  ];
  const r = gabaritsRemis(stockes, defauts);
  assert.equal(r.remis, 1);
  assert.equal(r.gardes, 1);
  assert.equal(r.ajoutes, 1);
  assert.equal(r.liste.find((m) => m.id === "confirmation-en").corps, "Hello {prenom}", "le modèle d'origine reprend son texte");
  assert.equal(r.liste.find((m) => m.id === "propre").corps, "Rain tomorrow", "le modèle de l'entreprise n'est pas effacé");
  assert.ok(r.liste.some((m) => m.id === "avis-en"), "le modèle manquant est ajouté");
  // Un modèle créé à part pour un usage déjà couvert garde la place : le modèle par défaut du même usage n'est pas ajouté en double.
  const avecPropreAvis = gabaritsRemis([{ id: "u1", pour: "client", cle: "avis", langue: "en", titre: "Mon avis", corps: "Leave us a review" }], defauts);
  assert.equal(avecPropreAvis.liste.filter((m) => m.cle === "avis").length, 1);
  assert.equal(avecPropreAvis.liste.find((m) => m.cle === "avis").corps, "Leave us a review");
});
