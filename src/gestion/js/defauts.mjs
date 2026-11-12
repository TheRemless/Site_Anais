// Valeurs de départ, textes types et données de démonstration.
// Les vraies coordonnées (téléphone, e-mail, banque) ne sont pas dans ce fichier car il est servi publiquement :
// elles viennent de la table « reglages » (voir docs/gestion/schema.sql).

import { enrichirDemoStats } from "./demo-stats.mjs";
import { N_ } from "./i18n.mjs";

export const uid = () => crypto.randomUUID();

// Catalogue des droits : chaque rôle est un ensemble de ces codes. Le même catalogue sert à la base (schema.sql)
// et à l'écran des rôles, pour qu'ils ne puissent pas diverger.
export const PERMISSIONS = [
  { code: "clients.lire", groupe: N_("Clients"), libelle: N_("Voir les clients") },
  { code: "clients.ecrire", groupe: N_("Clients"), libelle: N_("Créer et modifier les clients") },
  { code: "clients.supprimer", groupe: N_("Clients"), libelle: N_("Supprimer un client") },
  { code: "dossiers.lire", groupe: N_("Dossiers"), libelle: N_("Voir les dossiers") },
  { code: "dossiers.ecrire", groupe: N_("Dossiers"), libelle: N_("Créer et modifier les dossiers") },
  { code: "dossiers.supprimer", groupe: N_("Dossiers"), libelle: N_("Supprimer un dossier") },
  { code: "documents.ecrire", groupe: N_("Devis et factures"), libelle: N_("Créer et modifier les devis et factures") },
  { code: "documents.supprimer", groupe: N_("Devis et factures"), libelle: N_("Supprimer un devis ou une facture") },
  { code: "finances.voir", groupe: N_("Finances"), libelle: N_("Voir les montants : devis, factures et paiements"), aide: N_("Sans ce droit, la personne voit les clients et les dossiers mais aucun chiffre.") },
  { code: "paiements.ecrire", groupe: N_("Finances"), libelle: N_("Enregistrer et corriger les paiements") },
  { code: "taches.ecrire", groupe: N_("Tâches"), libelle: N_("Créer et modifier les tâches et rappels"), aide: N_("Chacun peut toujours cocher comme faites les tâches qui lui sont confiées.") },
  { code: "catalogue.ecrire", groupe: N_("Catalogue"), libelle: N_("Modifier le catalogue de formules et de prix") },
  { code: "partenaires.lire", groupe: N_("Partenaires"), libelle: N_("Voir les partenaires, leurs tarifs et leurs trajets") },
  { code: "partenaires.ecrire", groupe: N_("Partenaires"), libelle: N_("Modifier les partenaires, les tarifs et les trajets") },
  { code: "partenaires.nets", groupe: N_("Partenaires"), libelle: N_("Voir les prix nets, les marges et les coordonnées bancaires des partenaires"), aide: N_("Sans ce droit, la personne voit les prix de vente mais ni les nets ni les marges.") },
  { code: "reglages.ecrire", groupe: N_("Administration"), libelle: N_("Modifier les réglages de l'entreprise (coordonnées bancaires comprises)") },
  { code: "exports.faire", groupe: N_("Administration"), libelle: N_("Exporter et sauvegarder les données") },
  { code: "analytics.voir", groupe: N_("Administration"), libelle: N_("Voir le tableau analytique") },
  { code: "journal.voir", groupe: N_("Administration"), libelle: N_("Voir le journal d'activité") },
];
export const TOUTES_PERMISSIONS = PERMISSIONS.map((p) => p.code);

// Un droit en suppose d'autres : on ne peut pas modifier ce qu'on ne peut pas voir.
export const DEPENDANCES = {
  "clients.ecrire": ["clients.lire"],
  "clients.supprimer": ["clients.lire"],
  "dossiers.ecrire": ["dossiers.lire", "clients.lire"],
  "dossiers.supprimer": ["dossiers.lire"],
  "documents.ecrire": ["dossiers.lire", "finances.voir"],
  "documents.supprimer": ["dossiers.lire", "finances.voir"],
  "paiements.ecrire": ["dossiers.lire", "finances.voir"],
  "analytics.voir": ["finances.voir"],
  "taches.ecrire": ["dossiers.lire"],
  "partenaires.ecrire": ["partenaires.lire"],
  "partenaires.nets": ["partenaires.lire"],
};

// Rôles créés avec chaque entreprise. Ils se modifient ensuite librement dans l'écran Administration.
export const ROLES_SYSTEME = [
  { nom: N_("Administrateur"), description: N_("Tous les droits dans l'entreprise."), portee: "toute", permissions: TOUTES_PERMISSIONS },
  { nom: N_("Éditeur"), description: N_("Clients, dossiers, devis, factures et paiements. Ni réglages ni suppression."), portee: "toute", permissions: ["clients.lire", "clients.ecrire", "dossiers.lire", "dossiers.ecrire", "documents.ecrire", "finances.voir", "paiements.ecrire", "taches.ecrire", "catalogue.ecrire", "partenaires.lire", "partenaires.ecrire"] },
  { nom: N_("Lecteur"), description: N_("Consultation seulement, montants visibles."), portee: "toute", permissions: ["clients.lire", "dossiers.lire", "finances.voir", "analytics.voir", "partenaires.lire"] },
];

export const LIBELLES_FR = {
  devis: "DEVIS",
  facture: "FACTURE",
  facture_locale: "",
  ref_devis: "Devis: réf.",
  ref_facture: "Facture: réf.",
  date_emission: "Date d'émission:",
  unite: "UNITÉ",
  qte: "QTÉ",
  total: "TOTAL",
  colonne_montant: "",
  total_final: "",
  sous_total: "SOUS-TOTAL",
  remise: "Remise",
  montant_recu: "Montant reçu",
  equivalent: "Équivalent indicatif :",
  conditions: "CONDITIONS DE PAIEMENT",
  signature_1: "NOM, PRENOM, DATE ET SIGNATURE DU CLIENT",
  signature_2: "précédé de la mention “Bon pour accord”",
  coordonnees: "COORDONNÉES",
  infos_paiement: "INFORMATIONS DE PAIEMENT",
  pied_court: "voir les instructions de paiement transmises par e-mail.",
  qr_titre: "",
  facture_a: "",
  prestataire: "Prestataire :",
  note_devise: "",
  pied_note: "",
  cgv: "Le client reconnaît avoir pris connaissance des [Conditions Générales de Vente]({cgv_url}) de {entreprise} et les accepter sans réserve. La signature du présent devis vaut acceptation des CGV et engagement contractuel.",
};

export const LIBELLES_EN = {
  devis: "QUOTE",
  facture: "INVOICE",
  facture_locale: "",
  ref_devis: "Quote: ref.",
  ref_facture: "Invoice: ref.",
  date_emission: "Date of issue:",
  unite: "UNIT",
  qte: "QTY",
  total: "TOTAL",
  colonne_montant: "",
  total_final: "",
  sous_total: "SUBTOTAL",
  remise: "Discount",
  montant_recu: "Amount received",
  equivalent: "Indicative equivalent:",
  conditions: "PAYMENT TERMS",
  signature_1: "FULL NAME, DATE AND SIGNATURE OF THE CLIENT",
  signature_2: "preceded by the words “Approved”",
  coordonnees: "CONTACT",
  infos_paiement: "PAYMENT DETAILS",
  pied_court: "see the payment instructions sent by e-mail.",
  qr_titre: "",
  facture_a: "",
  prestataire: "Service provider:",
  note_devise: "",
  pied_note: "",
  cgv: "The client acknowledges having read the [Terms and Conditions]({cgv_url}) of {entreprise} and accepts them in full. Signing this quote constitutes acceptance of the Terms and Conditions and a binding commitment.",
};

export const MOYENS_DEFAUT = [
  { id: "virement", label: N_("Virement bancaire") },
  { id: "wise", label: N_("Wise") },
  { id: "paypal", label: N_("PayPal") },
  { id: "twint", label: N_("TWINT") },
  { id: "postfinance", label: N_("PostFinance") },
  { id: "especes", label: N_("Espèces") },
  { id: "autre", label: N_("Autre") },
];

// Texte de départ jusqu'au 8 novembre 2026 (taux de change écrit en dur, « de la facture » sur un devis) : reconnu pour proposer la version anglaise.
const ANCIEN_COND_QR = `Un acompte de {acompte}% de la facture (non-remboursable) est demandé à la signature du devis, payable à {delai} jours, le reste du montant est à verser à la réception du carnet de voyage.
Modes de paiement :
- Virement bancaire en CHF.
- Paiement en EUR (1 CHF = 1,10€) possible sur demande (via PayPal ou virement bancaire)
- **Paiement facile avec un compte Wise** : scannez le QR code et réglez dans votre devise habituelle (CHF ou Euro). Je pourrai alors le changer en THB pour moi, sans frais supplémentaires pour vous.`;

export const COND_QR = `Un acompte de {acompte} % du montant total ({acompte_chf}) est demandé à la signature du devis. Il n'est pas remboursable et doit être réglé dans un délai de {delai} jours. Le solde est à verser à la réception du carnet de voyage.
Modes de paiement :
- Virement bancaire en CHF.
- Paiement en EUR possible sur demande{indicatif}, par PayPal ou par virement bancaire.
- **Paiement par Wise** : scannez le QR code et réglez en CHF ou en EUR.`;

export const COND_EMAIL = `Un acompte de {acompte} % du montant total est demandé à la signature du devis. Cet acompte est **non remboursable** et doit être réglé dans un délai de {delai} jours suivant l'acceptation du devis.
Le solde de {solde} % est à régler à la réception du carnet de voyage final.

Le montant total de la prestation s'élève à **{total}**{indicatif}.
Afin d'éviter les frais liés aux virements internationaux, le paiement peut être effectué facilement via **Wise**, en CHF ou en EUR, selon votre préférence.
_Les coordonnées de paiement Wise sont indiquées dans l'e-mail accompagnant le devis._`;

// Versions anglaises des deux conditions de départ. Un document en anglais les prend quand la variante n'a pas de version anglaise à elle
// ET que son texte français est resté celui de départ : sinon elle retomberait en français sur un document anglais.
export const COND_QR_EN = `A deposit of {acompte}% of the total amount ({acompte_chf}) is required when the quote is signed. It is non-refundable and must be paid within {delai} days. The balance is due when the travel booklet is delivered.
Payment methods:
- Bank transfer in CHF.
- Payment in EUR on request{indicatif}, by PayPal or bank transfer.
- **Pay with Wise**: scan the QR code and pay in CHF or EUR.`;
export const COND_EMAIL_EN = `A deposit of {acompte} % of the total amount is required when the quote is signed. This deposit is **non-refundable** and must be paid within {delai} days of acceptance.
The remaining {solde} % is due when the final travel booklet is delivered.

The total price of the services is **{total}**{indicatif}.
To avoid international transfer fees, you can pay through **Wise**, in CHF or EUR, as you prefer.
_The Wise payment details are in the e-mail that came with the quote._`;
export const CLOTURE_EN = "Thank you for choosing us!\nPlease contact us with any question or additional request.\nKind regards,";
const CLOTURES_FR_DEFAUT = ["Merci pour votre confiance !\nJe reste à votre disposition pour toute question ou demande supplémentaire.\nCordialement,", "Merci pour votre confiance !\nNous restons à votre disposition pour toute question ou demande supplémentaire.\nCordialement,"];
const DEFAUTS_CONDITIONS = {
  qr: { fr: [COND_QR, ANCIEN_COND_QR], en: COND_QR_EN },
  email: { fr: [COND_EMAIL], en: COND_EMAIL_EN },
};

// Conditions de paiement d'un document : le texte et la clôture à imprimer, et `manqueEn` quand le document est en anglais mais que les
// réglages n'ont pas de version anglaise (le texte français s'imprimerait alors tel quel : l'éditeur le signale).
export function conditionsDocument(reglages, contenu, en) {
  const variantes = (reglages.textes && reglages.textes.variantes) || [];
  const perso = contenu.variante === "perso";
  const choisie = perso ? { corps: contenu.conditions_corps || "", cloture: contenu.conditions_cloture || "" } : variantes.find((v) => v.id === contenu.variante) || variantes[0] || { corps: "", cloture: "" };
  if (!en || perso) return { corps: choisie.corps, cloture: choisie.cloture, manqueEn: false };
  const defaut = DEFAUTS_CONDITIONS[choisie.id];
  const corpsDefaut = defaut && defaut.fr.includes(choisie.corps) ? defaut.en : "";
  const clotureDefaut = CLOTURES_FR_DEFAUT.includes(choisie.cloture) ? CLOTURE_EN : "";
  const corps = choisie.corps_en || corpsDefaut;
  const cloture = choisie.cloture_en || clotureDefaut;
  return { corps: corps || choisie.corps, cloture: cloture || choisie.cloture, manqueEn: !corps || (!cloture && !!choisie.cloture) };
}

// Mention de TVA : celle des réglages en anglais, sinon « VAT not applicable » si la mention française est restée « TVA non applicable ».
export function mentionTva(conditions, en) {
  if (!en) return conditions.tva_mention;
  return conditions.tva_mention_en || (conditions.tva_mention === "TVA non applicable" ? "VAT not applicable" : conditions.tva_mention);
}

// Messages types proposés au départ, modifiables dans l'écran Messages. Variables : {client}, {prenom}, {date}, {hotel},
// {heure}, {a_heure} (« à 08:00 », vide sans heure), {personnes}, {prestation}, {partenaire}, {reference}, {entreprise}, {telephone}.
// Les textes thaïs sont des propositions à faire relire par une personne qui lit le thaï avant usage réel.
// Messages types de départ. `pour` : « client » ou « partenaire », la fenêtre « Copier un message » ne propose que
// ceux du destinataire. Les clients reçoivent du français ou de l'anglais, les partenaires de l'anglais ou du thaï.
export const MESSAGES_DEFAUT = [
  { id: "confirmation-fr", pour: "client", cle: "confirmation", titre: "Confirmation au client", langue: "fr", corps: "Bonjour {prenom},\n\nVotre réservation est confirmée :\n• {prestation}\n• Date : {date}\n• {personnes}\n• Prise en charge : {hotel}{a_heure}\n\nSi quelque chose change, écrivez-nous ici. Merci d'avoir réservé avec {entreprise}, à très bientôt !\n{telephone}" },
  { id: "confirmation-en", pour: "client", cle: "confirmation", titre: "Confirmation to the client", langue: "en", corps: "Hello {prenom},\n\nYour booking is confirmed:\n• {prestation}\n• Date: {date}\n• {personnes}\n• Pickup: {hotel}{a_heure}\n\nIf anything changes, just message us here. Thank you for booking with {entreprise}, see you soon!\n{telephone}" },
  { id: "rappel-fr", pour: "client", cle: "rappel", titre: "Rappel de la veille", langue: "fr", corps: "Bonjour {prenom},\n\nPetit rappel pour demain : {prestation}.\nPrise en charge à {heure} à {hotel}. Merci d'être prêt quelques minutes avant, avec votre voucher sur votre téléphone.\nPensez à l'eau, à la crème solaire et à des espèces pour les éventuels frais de parc national.\n\nBonne journée,\n{entreprise}" },
  { id: "rappel-en", pour: "client", cle: "rappel", titre: "Reminder for tomorrow", langue: "en", corps: "Hello {prenom},\n\nA quick reminder for tomorrow: {prestation}.\nPickup at {heure} from {hotel}. Please be ready a few minutes early, with your voucher on your phone.\nBring water, sunscreen and some cash for any national park fees.\n\nHave a great day,\n{entreprise}" },
  { id: "avis-fr", pour: "client", cle: "avis", titre: "Demande d'avis après le voyage", langue: "fr", corps: "Bonjour {prenom},\n\nNous espérons que {prestation} vous a plu ! Si vous avez deux minutes, un avis Google nous aiderait beaucoup :\n{lien_avis}\nMerci d'avance.\n\nÀ bientôt à Koh Lanta,\n{entreprise}" },
  { id: "avis-en", pour: "client", cle: "avis", titre: "Review request after the trip", langue: "en", corps: "Hello {prenom},\n\nWe hope you enjoyed {prestation}! If you have two minutes, a Google review would help us a lot:\n{lien_avis}\nThank you in advance.\n\nSee you again in Koh Lanta,\n{entreprise}" },
  { id: "meteo-fr", pour: "client", cle: "meteo", titre: "Météo, report ou annulation", langue: "fr", corps: "Bonjour {prenom},\n\nLa météo du {date} ne permet pas de maintenir {prestation} en toute sécurité. Nous pouvons reporter à une autre date ou vous rembourser intégralement. Dites-nous ce que vous préférez.\n\nDésolés pour ce contretemps,\n{entreprise}" },
  { id: "meteo-en", pour: "client", cle: "meteo", titre: "Weather, postponement or cancellation", langue: "en", corps: "Hello {prenom},\n\nThe weather on {date} does not allow us to run {prestation} safely. We can move it to another date or refund you in full. Let us know what you prefer.\n\nSorry for the inconvenience,\n{entreprise}" },
  { id: "reponse-fr", pour: "client", cle: "reponse", titre: "Réponse à une demande", langue: "fr", corps: "{bonjour}\n\nMerci pour votre message. Voici ce que nous pouvons vous proposer :\n\n{services}\n\nTotal : {total}\n\nSouhaitez-vous que je réserve ?\n{entreprise}" },
  { id: "reponse-en", pour: "client", cle: "reponse", titre: "Reply to a request", langue: "en", corps: "{bonjour}\n\nThank you for your message. Here is what we can offer:\n\n{services}\n\nTotal: {total}\n\nWould you like me to book it?\n{entreprise}" },
  { id: "partenaire-en", pour: "partenaire", cle: "partenaire", titre: "Booking request", langue: "en", corps: "Hello {partenaire},\n\nBooking request from {entreprise}:\n• {prestation}\n• Date: {date}\n• {personnes}\n• Pickup: {hotel}{a_heure}\n• Guest: {client}\n• Our ref: {reference}\n\nCould you please confirm availability and the pickup time? Thank you!" },
  { id: "relance-en", pour: "partenaire", cle: "relance", titre: "Follow-up, no answer yet", langue: "en", corps: "Hello {partenaire},\n\nJust following up on our booking request {reference}: {prestation} on {date}, {personnes}, guest {client}.\nCould you confirm? Thank you!" },
  { id: "modification-en", pour: "partenaire", cle: "modification", titre: "Change on a booking", langue: "en", corps: "Hello {partenaire},\n\nChange on our booking {reference} ({client}):\n• {prestation}\n• Date: {date}\n• {personnes}\n• Pickup: {hotel}{a_heure}\n\nPlease confirm the change. Thank you!" },
  { id: "annulation-en", pour: "partenaire", cle: "annulation", titre: "Cancellation", langue: "en", corps: "Hello {partenaire},\n\nPlease cancel our booking {reference}: {prestation} on {date}, guest {client}.\nSorry for the inconvenience, and thank you!" },
  { id: "partenaire-th", pour: "partenaire", cle: "partenaire", titre: "ขอจอง (à relire)", langue: "th", corps: "สวัสดีค่ะ {partenaire}\n\nขอจองจาก {entreprise} ค่ะ\n• {prestation}\n• วันที่ {date}\n• {personnes}\n• รับที่ {hotel}{a_heure}\n• ชื่อลูกค้า: {client}\n• เลขอ้างอิง: {reference}\n\nรบกวนยืนยันที่ว่างและเวลารับด้วยนะคะ ขอบคุณค่ะ" },
  { id: "relance-th", pour: "partenaire", cle: "relance", titre: "ติดตามการจอง (à relire)", langue: "th", corps: "สวัสดีค่ะ {partenaire}\n\nขอติดตามการจอง {reference} ค่ะ: {prestation} วันที่ {date} {personnes} ลูกค้า {client}\nรบกวนยืนยันด้วยนะคะ ขอบคุณค่ะ" },
  { id: "modification-th", pour: "partenaire", cle: "modification", titre: "แก้ไขการจอง (à relire)", langue: "th", corps: "สวัสดีค่ะ {partenaire}\n\nขอแก้ไขการจอง {reference} ({client}) ค่ะ\n• {prestation}\n• วันที่ {date}\n• {personnes}\n• รับที่ {hotel}{a_heure}\n\nรบกวนยืนยันการแก้ไขด้วยนะคะ ขอบคุณค่ะ" },
  { id: "annulation-th", pour: "partenaire", cle: "annulation", titre: "ยกเลิกการจอง (à relire)", langue: "th", corps: "สวัสดีค่ะ {partenaire}\n\nขอยกเลิกการจอง {reference} ค่ะ: {prestation} วันที่ {date} ลูกค้า {client}\nขออภัยในความไม่สะดวกนะคะ ขอบคุณค่ะ" },
];

// Messages types de VIP Taxi Lanta (mode taxi). Les deux messages aux clients sont les textes de Jérémy du 12.11.2026, mot pour mot
// (le lien d'avis passe par {lien_avis}, réglé dans Réglages). Les messages à Mr. Brown suivent le même ton, en anglais et en thaï ;
// les textes thaïs sont à faire relire avant usage réel. {contact} = la personne du partenaire, {dropoff} et {prix} = ceux de la course.
export const MESSAGES_TAXI = [
  { id: "taxi-confirmation-en", pour: "client", cle: "confirmation", titre: "Booking confirmation sent", langue: "en", corps: "Thank you for choosing VIP TAXI LANTA. ✨\n\nPlease see the attached confirmation and show it to the driver at pick-up.\nLet us know if everything is correct\n\nPayment will be collected in cash directly by the driver (or you can pay through Wise before your transfer (3% fee), please let us know before.)\n\nIf you have any changes, please inform us as soon as possible.\n\nHave a nice day ☀️\nVIP TAXI LANTA 🌴" },
  { id: "taxi-avis-en", pour: "client", cle: "avis", titre: "Review request the day after", langue: "en", corps: "Thank you again for choosing VIP TAXI LANTA today.\n\nWe hope you had a comfortable journey and that everything went smoothly with the driver and the transfer.\n\nIf you were satisfied with our service, we would truly appreciate it if you could leave us a review on Google. It really helps us grow and allows other travelers to discover our service 😊 ✨\n\nYou can leave your review here:\n{lien_avis}\n\nThank you very much for your trust, and we hope to drive you again in the future!\n\nSafe travels ✨🌴\nVIP TAXI LANTA by Mr. Brown" },
  { id: "taxi-partenaire-en", pour: "partenaire", cle: "partenaire", titre: "New transfer", langue: "en", corps: "Hello {contact},\n\nNew transfer:\n• {prestation}\n• Date: {date}\n• Pickup: {hotel}{a_heure}\n• Drop-off: {dropoff}\n• {personnes}\n• Guest: {client}\n• Price: {prix}, paid to the driver\n• Ref: {reference}\n\nCan you confirm? Thank you 🙏" },
  { id: "taxi-relance-en", pour: "partenaire", cle: "relance", titre: "Follow-up, no answer yet", langue: "en", corps: "Hello {contact},\n\nJust checking on transfer {reference}: {prestation} on {date}, {personnes}, guest {client}.\nCan you confirm? Thank you 🙏" },
  { id: "taxi-modification-en", pour: "partenaire", cle: "modification", titre: "Change on a transfer", langue: "en", corps: "Hello {contact},\n\nChange on transfer {reference} ({client}):\n• {prestation}\n• Date: {date}\n• Pickup: {hotel}{a_heure}\n• Drop-off: {dropoff}\n• {personnes}\n\nCan you confirm the change? Thank you 🙏" },
  { id: "taxi-annulation-en", pour: "partenaire", cle: "annulation", titre: "Cancellation", langue: "en", corps: "Hello {contact},\n\nPlease cancel transfer {reference}: {prestation} on {date}, guest {client}.\nSorry for the change, thank you 🙏" },
  { id: "taxi-commission-en", pour: "partenaire", cle: "commission", titre: "Commission for yesterday's transfer", langue: "en", corps: "Hello {contact},\n\nAbout yesterday's transfer: {prestation} on {date}, guest {client} ({prix}).\nHow much is the commission for this one?\n\nThank you 🙏" },
  { id: "taxi-partenaire-th", pour: "partenaire", cle: "partenaire", titre: "งานใหม่ (à relire)", langue: "th", corps: "สวัสดีค่ะ {contact}\n\nมีงานรับส่งใหม่ค่ะ\n• {prestation}\n• วันที่ {date}\n• รับที่: {hotel}{a_heure}\n• ส่งที่: {dropoff}\n• {personnes}\n• ลูกค้า: {client}\n• ราคา: {prix} ลูกค้าจ่ายคนขับ\n• เลขอ้างอิง: {reference}\n\nช่วยยืนยันด้วยนะคะ ขอบคุณค่ะ 🙏" },
  { id: "taxi-relance-th", pour: "partenaire", cle: "relance", titre: "ติดตามงาน (à relire)", langue: "th", corps: "สวัสดีค่ะ {contact}\n\nขอติดตามงาน {reference} ค่ะ: {prestation} วันที่ {date} {personnes} ลูกค้า {client}\nช่วยยืนยันด้วยนะคะ ขอบคุณค่ะ 🙏" },
  { id: "taxi-modification-th", pour: "partenaire", cle: "modification", titre: "แก้ไขงาน (à relire)", langue: "th", corps: "สวัสดีค่ะ {contact}\n\nขอแก้ไขงาน {reference} ({client}) ค่ะ\n• {prestation}\n• วันที่ {date}\n• รับที่: {hotel}{a_heure}\n• ส่งที่: {dropoff}\n• {personnes}\n\nช่วยยืนยันด้วยนะคะ ขอบคุณค่ะ 🙏" },
  { id: "taxi-annulation-th", pour: "partenaire", cle: "annulation", titre: "ยกเลิกงาน (à relire)", langue: "th", corps: "สวัสดีค่ะ {contact}\n\nขอยกเลิกงาน {reference} ค่ะ: {prestation} วันที่ {date} ลูกค้า {client}\nขอโทษด้วยนะคะ ขอบคุณค่ะ 🙏" },
  { id: "taxi-commission-th", pour: "partenaire", cle: "commission", titre: "ค่าคอมมิชชั่นงานเมื่อวาน (à relire)", langue: "th", corps: "สวัสดีค่ะ {contact}\n\nงานเมื่อวาน: {prestation} วันที่ {date} ลูกค้า {client} ({prix})\nค่าคอมมิชชั่นงานนี้เท่าไหร่คะ\n\nขอบคุณค่ะ 🙏" },
];
// Messages de départ d'une entreprise selon sa façon de travailler : ceux de Taxi en mode taxi, sinon les messages généraux.
// Taxi garde aussi la « réponse à une demande » en anglais (bouton « Répondre au client » de la demande collée).
export const messagesDefautPour = (reglages) => (reglages && reglages.fonctionnement === "taxi" ? [...MESSAGES_TAXI, ...MESSAGES_DEFAUT.filter((m) => m.id === "reponse-en")] : MESSAGES_DEFAUT);

// Réglages d'une entreprise nouvellement créée : aucun fait propre à une entreprise réelle.
export const REGLAGES_NEUTRE = {
  messages: MESSAGES_DEFAUT,
  // Écrans propres à l'entreprise : null = automatique (Partenaires dès qu'il y a un partenaire, Réservations et Messages
  // avec Partenaires, Catalogue toujours), true = affiché, false = masqué.
  modules: { partenaires: null, reservations: null, messages: null, catalogue: null },
  // « sur_mesure » : voyages sur mesure avec devis, acompte et facture (Zwald). « excursions » : excursions et transferts
  // facturés directement, puis vouchers pour le client et le prestataire (Secret Travel & Tour).
  fonctionnement: "sur_mesure",
  // Assistant IA (Claude) dans « Coller une demande » : éteint tant que l'entreprise ne l'allume pas dans Réglages > Écrans.
  assistant_ia: false,
  // Vouchers (mode excursions) : en-tête et textes fixes, en anglais.
  voucher: { nom: "", sous_titre: "", adresse: "", whatsapp: "", email: "", licence: "", merci: "Thank you for booking with {entreprise}!\nWe wish you a wonderful day.", merci_transfert: "Thank you for booking with {entreprise}!\nWe wish you a wonderful journey.", note_transfert: "Your driver will be waiting for you at the meeting point.\nIf your plan changes, please let us know as soon as possible." },
  emetteur: { nom: "", sous_titre: "", adresse: "", telephone: "", licence: "", contact: "" },
  paiement: { texte: "", nom: "", autres: [] },
  devise: "",
  conditions: { acompte_pct: 0, delai_jours: 10, relance_jours: 7, tva_mention: "", tva_mention_en: "", cgv_url: "" },
  taux: { eur: 1.058, thb: 40.54 },
  numerotation: { mode: "sequence", prefixe: "", chiffres: 4 },
  dossier: { modele_bandeau: "{PAYS} - {PERIODE}", libelle_pays: "Pays" },
  listes: { pays: [], civilites: ["Madame", "Monsieur", "Mademoiselle"], moyens: MOYENS_DEFAUT, devises: ["CHF", "EUR", "THB", "USD"] },
  apparence: { couleur: "#0b9999", couleur_clair: "#53b7b7", entete: "classique", logo: "", titre_image: "", type_images: null, titre_texte: "", qr_image: "", qr_pseudo: "" },
  libelles: LIBELLES_FR,
  libelles_en: LIBELLES_EN,
  textes: { variantes: [{ id: "standard", nom: "Standard", corps: "", cloture: "" }] },
};

// Informations de paiement proposées pour un document : celles de l'entreprise (avec le QR code des réglages), puis les autres.
export function modesPaiement(r) {
  const principal = { id: "", nom: r.paiement.nom || "Principal", texte: r.paiement.texte, qr_image: r.apparence.qr_image, qr_pseudo: r.apparence.qr_pseudo };
  const autres = (r.paiement.autres || []).map((m) => ({ id: m.id, nom: m.nom || "Sans nom", texte: m.texte || "", qr_image: m.qr_image || "", qr_pseudo: m.qr_pseudo || "" }));
  return [principal, ...autres];
}
export const modePaiement = (r, id) => modesPaiement(r).find((m) => m.id === (id || "")) || modesPaiement(r)[0];

const estObjet = (v) => v && typeof v === "object" && !Array.isArray(v);
function fusion(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) out[k] = estObjet(v) && estObjet(base[k]) ? fusion(base[k], v) : v;
  return out;
}

// Complète des réglages enregistrés avec les valeurs neutres et reprend l'ancien format (coordonnées en champs séparés).
// Phrase sur les conditions générales. Sur un devis, celle des réglages. Sur une facture, une phrase propre à la facture : « la
// signature du devis » n'a rien à faire sur une facture, et Secret n'a pas de devis. Sans lien dans les réglages, le texte entre
// crochets reste du texte simple (pas de « [texte]() » brut sur le document).
export const CGV_FACTURE = {
  fr: "Cette facture est établie selon les [Conditions Générales de Vente]({cgv_url}) de {entreprise}.",
  en: "This invoice is issued under the [Terms and Conditions]({cgv_url}) of {entreprise}.",
};
export function phraseCgv(lb, { estFacture = false, en = false, cgvUrl = "" } = {}) {
  if (!lb.cgv) return "";
  const anglais = en || /invoice/i.test(lb.facture || "");
  const phrase = estFacture ? lb.cgv_facture || CGV_FACTURE[anglais ? "en" : "fr"] : lb.cgv;
  return cgvUrl ? phrase : phrase.replace(/\[([^\]]+)\]\(\{cgv_url\}\)/g, "$1");
}

export function completerReglages(brut) {
  const r = structuredClone(brut || {});
  const p = r.paiement || {};
  if (p.texte === undefined && (p.banque || p.iban)) {
    p.texte = [p.banque && `Banque: ${p.banque}`, p.iban && `IBAN: ${p.iban}`, p.swift && `Swift: ${p.swift}`, p.titulaire, p.ville_titulaire].filter(Boolean).join("\n");
    r.paiement = p;
  }
  r.apparence = { ...(r.apparence || {}) };
  if (r.apparence.qr_pseudo === undefined && p.wise_pseudo) r.apparence.qr_pseudo = p.wise_pseudo;
  const e = r.emetteur || {};
  if (e.contact === undefined && (e.contact_nom || e.whatsapp || e.email)) r.emetteur = { ...e, contact: [e.contact_nom, e.whatsapp, e.email].filter(Boolean).join("\n") };
  return fusion(REGLAGES_NEUTRE, r);
}

// Ce qu'il manque pour que les documents d'une entreprise soient présentables.
export function reglagesIncomplets(r) {
  const manque = [];
  if (!r.emetteur.nom.trim()) manque.push("le nom de l'entreprise");
  if (!r.emetteur.adresse.trim()) manque.push("l'adresse");
  if (!r.devise.trim()) manque.push("la devise");
  if (!r.emetteur.contact.trim()) manque.push("les coordonnées du pied de page");
  // Taxi n'émet aucune facture : ni informations de paiement ni conditions à fournir (le client paie le chauffeur).
  if (r.fonctionnement === "taxi") return manque;
  if (!r.paiement.texte.trim() && !r.apparence.qr_image) manque.push("les informations de paiement");
  if (!r.textes.variantes.some((v) => v.corps.trim())) manque.push("les conditions de paiement");
  return manque;
}

export const CONTENU_DEFAUT = () => ({
  bandeau: "",
  colonnes: "total",
  lignes: [],
  equivalents: { actif: false },
  pied: "qr",
  variante: "",
  langue: "",
  prestataire: "",
  tva: true,
  montant_recu: null,
});

export function nouvelleLigne(kind, props = {}) {
  return { id: uid(), kind, libelle: "", intro: "", puces: [], unite: null, qte: null, montant: null, pct: null, ...props };
}

// ---------------------------------------------------------------------------------------------
// Démonstration : trois entreprises fictives, deux utilisateurs, des dossiers à tous les statuts.
// ---------------------------------------------------------------------------------------------
const REGLAGES_DEMO_AGENCE = completerReglages({
  emetteur: { nom: "Agence démo", adresse: "1 rue de l'Exemple\n00000 Ville", telephone: "+00 00 000 00 00", licence: "00/00000", contact: "Prénom Nom\n+00 00 000 00 00 (WhatsApp)\ncontact@exemple.com" },
  paiement: { texte: "Banque: Banque démo\nIBAN: CH00 0000 0000 0000 0000 0\nSwift: XXXXXXXXXXX\nPrénom Nom\n0000 Ville", },
  devise: "CHF",
  conditions: { acompte_pct: 50, delai_jours: 10, relance_jours: 7, tva_mention: "TVA non applicable", cgv_url: "" },
  numerotation: { mode: "initiales", prefixe: "" },
  dossier: { modele_bandeau: "VOYAGE EN {PAYS} - {PERIODE}", libelle_pays: "Pays" },
  listes: { pays: ["Thaïlande", "Indonésie", "Vietnam"] },
  apparence: { logo: "assets/logo.png", titre_image: "assets/title.png", type_images: { devis: "assets/devis.png", facture: "assets/facture.png" }, qr_image: "assets/qr-wise.png", qr_pseudo: "@pseudo-wise" },
  libelles: { qr_titre: "WISE - virements internationaux" },
  textes: {
    variantes: [
      { id: "qr", nom: "Avec QR Wise dans le pied de page", corps: COND_QR, cloture: "Merci pour votre confiance !\nJe reste à votre disposition pour toute question ou demande supplémentaire.\nCordialement," },
      { id: "email", nom: "Coordonnées de paiement envoyées par e-mail", corps: COND_EMAIL, cloture: "Merci pour votre confiance !\nNous restons à votre disposition pour toute question ou demande supplémentaire.\nCordialement," },
    ],
  },
});

const REGLAGES_DEMO_TOURS = completerReglages({
  emetteur: { nom: "Excursions démo", adresse: "2 chemin de la Plage\n00000 Ville", telephone: "+00 00 000 00 01", licence: "00/00001", contact: "Équipe démo\ncontact@exemple.com" },
  paiement: { texte: "Banque: Banque démo\nNuméro de compte: 000-0-00000-0\nTitulaire: Excursions démo" },
  devise: "THB",
  conditions: { acompte_pct: 0, delai_jours: 5, relance_jours: 7, tva_mention: "", cgv_url: "" },
  numerotation: { mode: "sequence", prefixe: "EX" },
  fonctionnement: "excursions",
  voucher: { licence: "11/00000", email: "contact@exemple.com" },
  dossier: { modele_bandeau: "{PAYS} - {PERIODE}", libelle_pays: "Service" },
  listes: { pays: ["Excursion", "Transfert"] },
  libelles: LIBELLES_EN,
  textes: { variantes: [{ id: "standard", nom: "Standard", corps: "Payment is due on the day of the service.\nBank transfer or cash accepted.", cloture: "Thank you for your trust!" }] },
});

const REGLAGES_DEMO_TAXI = completerReglages({
  emetteur: { nom: "Taxi démo", adresse: "3 route de l'Aéroport\n00000 Ville", telephone: "+00 00 000 00 02", contact: "Taxi démo\ncontact@exemple.com" },
  paiement: { texte: "Paiement en espèces ou par virement." },
  devise: "THB",
  conditions: { acompte_pct: 0, delai_jours: 5, relance_jours: 7, tva_mention: "", cgv_url: "" },
  numerotation: { mode: "sequence", prefixe: "TX" },
  fonctionnement: "taxi",
  messages: MESSAGES_TAXI,
  voucher: { whatsapp: "+00 00 000 00 02", email: "contact@exemple.com" },
  dossier: { modele_bandeau: "{PAYS} - {PERIODE}", libelle_pays: "Trajet" },
  listes: { pays: ["Aéroport", "Hôtel", "Excursion"] },
  libelles: LIBELLES_EN,
  textes: { variantes: [{ id: "standard", nom: "Standard", corps: "Payment on arrival.", cloture: "Thank you!" }] },
});

export function donneesDemo(ajd, ajouterJours) {
  const j = (n) => ajouterJours(ajd, n);
  const e1 = { id: uid(), created_at: j(-90), slug: "agence", nom: "Agence démo", actif: true, ordre: 1 };
  const e2 = { id: uid(), created_at: j(-90), slug: "excursions", nom: "Excursions démo", actif: true, ordre: 2 };
  const e3 = { id: uid(), created_at: j(-90), slug: "taxi", nom: "Taxi démo", actif: true, ordre: 3 };
  const admin = { user_id: uid(), email: "admin@demo.local", nom: "Administratrice démo", super_admin: true, actif: true };
  const assistante = { user_id: uid(), email: "assistante@demo.local", nom: "Assistante démo", super_admin: false, actif: true };
  const stagiaire = { user_id: uid(), email: "stagiaire@demo.local", nom: "Stagiaire démo", super_admin: false, actif: true };
  const comptable = { user_id: uid(), email: "comptable@demo.local", nom: "Comptable démo", super_admin: false, actif: true };
  const roles = [];
  const roleDe = {};
  for (const e of [e1, e2, e3]) {
    for (const r of ROLES_SYSTEME) {
      const ro = { id: uid(), created_at: j(-90), entite_id: e.id, nom: r.nom, description: r.description, portee: r.portee, permissions: [...r.permissions], systeme: true };
      roles.push(ro);
      roleDe[`${e.id}:${r.nom}`] = ro.id;
    }
  }
  const rSans = { id: uid(), created_at: j(-30), entite_id: e3.id, nom: "Sans chiffres", description: "Voit les clients et les dossiers, jamais les montants.", portee: "toute", permissions: ["clients.lire", "dossiers.lire"], systeme: false };
  const rSes = { id: uid(), created_at: j(-30), entite_id: e2.id, nom: "Ses dossiers", description: "Travaille uniquement sur les dossiers dont elle est responsable.", portee: "mes_dossiers", permissions: ["clients.lire", "clients.ecrire", "dossiers.lire", "dossiers.ecrire", "documents.ecrire", "finances.voir", "paiements.ecrire"], systeme: false };
  roles.push(rSans, rSes);
  const membres = [
    { user_id: assistante.user_id, entite_id: e2.id, role_id: roleDe[`${e2.id}:Éditeur`] },
    { user_id: assistante.user_id, entite_id: e3.id, role_id: roleDe[`${e3.id}:Éditeur`] },
    { user_id: stagiaire.user_id, entite_id: e2.id, role_id: rSes.id },
    { user_id: comptable.user_id, entite_id: e3.id, role_id: rSans.id },
  ];
  const reglages = { [e1.id]: REGLAGES_DEMO_AGENCE, [e2.id]: REGLAGES_DEMO_TOURS, [e3.id]: REGLAGES_DEMO_TAXI };

  const clients = [];
  const dossiers = [];
  const documents = [];
  const paiements = [];
  const catalogue = [];
  const client = (e, civilite, prenom, nom, adresse, tel) => {
    const c = { id: uid(), created_at: j(-30), entite_id: e.id, civilite, prenom, nom, adresse, telephone: tel, email: "", notes: "" };
    clients.push(c);
    return c;
  };
  const contenu = (bandeau, lignes, colonnes, extra = {}) => ({ ...CONTENU_DEFAUT(), bandeau, colonnes, lignes, variante: extra.variante || "", ...extra });
  const ligne = (libelle, montant) => nouvelleLigne("ligne", { libelle, montant });
  const bloc = (libelle, puces, unite, qte) => nouvelleLigne("bloc", { libelle, intro: "comprenant:", puces, unite, qte });
  const ajoute = (e, c, creeLe, pays, bandeau, extra, devis, facture, pais) => {
    const rg = reglages[e.id];
    const initiales = `${c.prenom[0]}${c.nom[0]}`;
    const ref = rg.numerotation.mode === "sequence" ? `${rg.numerotation.prefixe}-${creeLe.slice(0, 4)}-${String(dossiers.filter((d) => d.entite_id === e.id).length + 1).padStart(4, "0")}` : `${initiales}${creeLe.replaceAll("-", "")} ${pays}`;
    const d = { id: uid(), created_at: creeLe, entite_id: e.id, ref, client_id: c.id, pays, bandeau, date_depart: null, date_retour: null, accepte_le: null, annule: false, notes: "", ...extra };
    dossiers.push(d);
    if (devis) documents.push({ id: uid(), created_at: creeLe, updated_at: creeLe, entite_id: e.id, dossier_id: d.id, type: "devis", date_emission: creeLe, envoye_le: null, ...devis });
    if (facture) documents.push({ id: uid(), created_at: j(0), updated_at: j(0), entite_id: e.id, dossier_id: d.id, type: "facture", date_emission: ajd, envoye_le: null, ...facture });
    (pais || []).forEach((p) => paiements.push({ id: uid(), created_at: p.date, entite_id: e.id, dossier_id: d.id, type: "acompte", moyen: "virement", origine_montant: null, origine_devise: "", note: "", ...p }));
  };

  // Entreprise 1 : cinq dossiers à tous les statuts
  const c1 = client(e1, "Madame", "Hélène", "Marchand", "Rue du Lac 12\n1204 Genève, Suisse", "+41 79 000 00 01");
  const c2 = client(e1, "Monsieur", "Julien", "Rochat", "Chemin des Vignes 4\n1004 Lausanne, Suisse", "+41 79 000 00 02");
  const c3 = client(e1, "Madame", "Sophie", "Perrin", "12 rue des Fleurs\n74000 Annecy, FR", "+33 6 00 00 00 03");
  const c4 = client(e1, "Monsieur", "Marc", "Delaye", "Rue Centrale 8\n1700 Fribourg, Suisse", "+41 79 000 00 04");
  const regions = (l) => [bloc("Formule “par région”", ["création de l'itinéraire personnalisé", "sélection d'hébergements par région", "carnet de voyage personnalisé"]), ...l.map(([n, m]) => ligne(n, m))];
  const duo = (jours) => [bloc("Formule complète DUO", ["conception de l'itinéraire sur mesure", "sélection d'hébergements par ville", "carnet de voyage personnalisé"], 40, jours)];
  const b = (m) => `VOYAGE EN THAÏLANDE - ${m}`;
  ajoute(e1, c1, j(-1), "Thaïlande", b("DÉCEMBRE 2026"), {}, { contenu: contenu(b("DÉCEMBRE 2026"), regions([["Bangkok", 120], ["Chiang Mai", 120], ["Koh Lanta", 150]]), "total", { variante: "qr" }) });
  ajoute(e1, c2, j(-9), "Thaïlande", b("JANVIER 2027"), {}, { envoye_le: j(-9), contenu: contenu(b("JANVIER 2027"), duo(12), "detail", { variante: "qr" }) });
  ajoute(e1, c3, j(-20), "Thaïlande", b("FÉVRIER 2027"), { accepte_le: j(-14), date_depart: j(95) }, { envoye_le: j(-20), contenu: contenu(b("FÉVRIER 2027"), regions([["Bangkok", 120], ["Koh Lanta", 150]]), "total", { variante: "qr" }) });
  ajoute(e1, c4, j(-50), "Thaïlande", b("NOVEMBRE 2026"), { accepte_le: j(-45), date_depart: j(18), date_retour: j(32) }, { envoye_le: j(-50), contenu: contenu(b("NOVEMBRE 2026"), duo(14), "detail", { variante: "qr" }) }, { contenu: contenu(b("NOVEMBRE 2026"), duo(14), "detail", { variante: "qr" }) }, [{ date: j(-40), montant: 280 }]);
  ajoute(e1, c1, j(-80), "Thaïlande", b("SEPTEMBRE 2026"), { accepte_le: j(-75), date_depart: j(-20), date_retour: j(-6) }, { envoye_le: j(-80), contenu: contenu(b("SEPTEMBRE 2026"), regions([["Chiang Mai", 120], ["Koh Lanta", 150]]), "total", { variante: "qr" }) }, null, [{ date: j(-70), montant: 135 }, { date: j(-25), montant: 135, type: "solde" }]);
  [["formule", "Formule “par région”", null], ["formule", "Formule complète DUO", 40], ["region", "Bangkok", 120], ["region", "Chiang Mai", 120], ["region", "Koh Lanta", 150]].forEach(([kind, libelle, prix], i) => {
    catalogue.push({ id: uid(), created_at: j(-90), entite_id: e1.id, kind, libelle, intro: kind === "formule" ? "comprenant:" : "", puces: kind === "formule" ? ["création de l'itinéraire personnalisé", "carnet de voyage personnalisé"] : [], prix, ordre: i + 1, actif: true });
  });

  // Entreprise 2 : excursions, facturation directe en bahts
  const c5 = client(e2, "Monsieur", "Ben", "Walker", "Hotel Sunset, Room 12\nKoh Lanta", "+44 7000 000000");
  const c6 = client(e2, "Madame", "Anna", "Keller", "Hotel Palm, Bungalow 3\nKoh Lanta", "+49 160 0000000");
  ajoute(e2, c5, j(-6), "Excursion", "Excursion - 4 îles", { accepte_le: j(-6), responsable_id: assistante.user_id }, null, { envoye_le: j(-6), contenu: contenu("Excursion - 4 îles", [nouvelleLigne("ligne", { libelle: "Tour des 4 îles, par personne", unite: 1200, qte: 2 })], "detail") });
  ajoute(e2, c6, j(-2), "Transfert", "Transfert aéroport", { accepte_le: j(-2), responsable_id: stagiaire.user_id }, null, { contenu: contenu("Transfert aéroport", [ligne("Transfert Krabi aéroport, Koh Lanta", 1500)], "total") }, [{ date: j(-1), montant: 1500, type: "solde", moyen: "especes" }]);
  [["region", "Tour des 4 îles", 1200], ["region", "Transfert aéroport", 1500]].forEach(([kind, libelle, prix], i) => catalogue.push({ id: uid(), created_at: j(-90), entite_id: e2.id, kind, libelle, intro: "", puces: [], prix, ordre: i + 1, actif: true }));

  // Entreprise 3 : taxi (mode taxi : pas de facture montrée, tout payé au chauffeur). Les réservations sont ajoutées plus bas.
  const c7 = client(e3, "Madame", "Lea", "Moreau", "Hotel Sea, Koh Lanta", "+33 6 00 00 00 07");
  const c8 = client(e3, "Monsieur", "Tom", "Becker", "Villa Demo, Klong Nin", "+49 170 0000008");
  const course = (libelle, montant) => nouvelleLigne("ligne", { libelle, unite: montant, qte: 1, paye_sur_place: true });
  const lc7 = course("Private minivan: Krabi Airport → Koh Lanta", 1800);
  const lc8 = course("Private minivan: Koh Lanta → Phuket Airport", 2700);
  ajoute(e3, c7, j(-3), "", "Private minivan: Krabi Airport → Koh Lanta", { accepte_le: j(-3), date_depart: j(-1), responsable_id: assistante.user_id }, null, { contenu: contenu("", [{ ...lc7, date_service: j(-1) }], "detail", { langue: "en" }) });
  ajoute(e3, c8, j(-1), "", "Private minivan: Koh Lanta → Phuket Airport", { accepte_le: j(-1), date_depart: j(1) }, null, { contenu: contenu("", [{ ...lc8, date_service: j(1) }], "detail", { langue: "en" }) });

  // Entreprise 2 : quatre partenaires fictifs avec leurs tarifs, leurs nets et les trajets de deux compagnies de bateaux.
  const partenaires = [];
  const partenaires_prives = [];
  const prestations = [];
  const prestations_nets = [];
  const trajets = [];
  const trajets_nets = [];
  const partenaire = (nom, categorie, groupe, role, extra = {}) => {
    const p = { id: uid(), created_at: j(-90), updated_at: j(-90), entite_id: e2.id, nom, nom_thai: "", categorie, groupe, role, contact: {}, regles: {}, contrat: {}, notes: "", ordre: partenaires.length + 1, actif: true, ...extra };
    partenaires.push(p);
    return p;
  };
  const prestation = (p, famille, groupe, libelle, prix, unite, net, details = {}, extra = {}) => {
    const x = { id: uid(), created_at: j(-90), updated_at: j(-90), entite_id: e2.id, partenaire_id: p ? p.id : null, famille, groupe, libelle, libelle_en: "", details, prix_vente: prix, unite, sur_place: false, ordre: prestations.length + 1, actif: true, ...extra };
    prestations.push(x);
    if (net != null) prestations_nets.push({ id: uid(), entite_id: e2.id, prestation_id: x.id, net, net_enfant: null, note: "" });
    return x;
  };
  const trajet = (p, de, vers, mode, depart, arrivee, duree, ad, adn, ch, chn, fenetres = [], periode = "Toute la période du contrat") => {
    const t = { id: uid(), created_at: j(-90), entite_id: e2.id, partenaire_id: p.id, numero: trajets.length + 1, de, vers, mode, depart, arrivee, duree, prix_adulte: ad, prix_enfant: ch, bebe: "Gratuit", periode, fenetres, actif: true };
    trajets.push(t);
    trajets_nets.push({ id: uid(), entite_id: e2.id, trajet_id: t.id, net_adulte: adn, net_enfant: chn });
    return t;
  };
  const longtail = partenaire("Longtail démo", "Excursions bateaux", "mer", "Excursions en longtail, 4 îles et Koh Rok (groupe et privé)", {
    contact: { personne: "M. Démo", telephones: [{ numero: "081-000-0001", libelle: "Réservations", whatsapp: true }], emails: ["longtail@demo.local"], adresse: "66 Moo 2, Koh Lanta", embarcadere: "Old Town Pier", guichets: [] },
    regles: { annulation: "Plus de 24 h avant le départ, sans frais. Ensuite 100 %.", enfants: ["3 à 9 ans, tarif enfant. Moins de 3 ans gratuit."] },
    contrat: { statut: "Tarifs nets confirmés", etat: "ok", saison: "Octobre 2026 à mai 2027", validite: "Oct 2026 – Mai 2027", fin: j(45), documents: ["Contrat Longtail démo.pdf"], evenements: [] },
    notes: "Petit-déjeuner léger offert sur les tours en groupe.",
  });
  partenaires_prives.push({ id: uid(), entite_id: e2.id, partenaire_id: longtail.id, banque: { banque: "Banque démo", compte: "000-0-00000-0", titulaire: "Longtail démo" }, paiement: "Virement local après chaque tour.", commissions: ["Net fixe par personne, frais de parc jamais inclus."] });
  const speed = partenaire("Speedboat démo", "Ferries et speedboats", "mer", "Liaisons en speedboat entre Lanta, Phi Phi, Lipe et Phuket", {
    contact: { personne: "Équipe réservations", telephones: [{ numero: "088-000-0002", libelle: "", whatsapp: true }], emails: ["info@speedboat.demo"], guichets: [{ lieu: "Saladan Pier", adresse: "Koh Lanta", telephones: ["075-000-000"], line: "", email: "" }] },
    regles: { annulation: "Plus de 24 h avant, sans frais. No show 100 %.", enfants: ["3 à 9 ans, tarif enfant. Moins de 3 ans gratuit sur les genoux."], checkin: ["Ouverture 45 min avant le départ, fermeture 15 min avant."], points_embarquement: [{ lieu: "Koh Lanta", ou: "Saladan Pier" }, { lieu: "Koh Phi Phi", ou: "Tonsai Bay, derrière le 7-11" }], pickups: [{ titre: "Pickup à Lanta", colonnes: ["Bateau 10h30", "Bateau 13h00"], lignes: [["Klong Dao", "09:40", "12:10"], ["Long Beach", "09:30", "12:00"], ["Old Town", "09:00", "11:30"]] }] },
    contrat: { statut: "Tarifs agents reçus", etat: "ok", saison: "Haute saison 2026-2027", validite: "15 oct 2026 – 20 mai 2027", fin: "2027-05-20", documents: [], evenements: [{ date: "15 oct 2026", libelle: "Début de la haute saison", genre: "debut" }] },
  });
  const ferry = partenaire("Ferry démo", "Ferries et speedboats", "mer", "Ferry lent entre Lanta et Phi Phi", { contact: { telephones: [{ numero: "089-000-0003", libelle: "", whatsapp: false }] }, contrat: { statut: "Sans contrat, tarifs publics", etat: "attention", fin: null } });
  const taxi = partenaire("Transferts démo", "Transferts terrestres et taxis", "transport", "Minivans privés depuis et vers les aéroports", { contact: { telephones: [{ numero: "083-000-0004", libelle: "", whatsapp: true }] }, contrat: { statut: "Accord oral", etat: "attention", fin: j(-5) } });
  partenaires_prives.push({ id: uid(), entite_id: e2.id, partenaire_id: taxi.id, banque: {}, paiement: "", commissions: ["Marge de 10 % en attendant un accord."] });
  prestation(longtail, "excursion", "Excursions en groupe", "4 îles en longtail, journée", 1200, "pp", 800, { horaires: "08h00 - 15h30 (départ 09h00)", inclus: "Pickup à l'hôtel, déjeuner, masque et tuba, fruits.", parc: "Frais de parc 200 ฿ par adulte, à payer sur place.", conditions: "Selon la météo." });
  prestation(longtail, "excursion", "Excursions en groupe", "4 îles en longtail, enfant 3 à 9 ans", 900, "ch", 600, {});
  prestation(longtail, "excursion", "Privatisation", "Koh Rok en longtail privé, 1 à 6 personnes", 6500, "boat", 5000, { capacite: "1 à 6 personnes", inclus: "Bateau, skipper, déjeuner, matériel de snorkeling." });
  prestation(null, "frais", "Frais de parc national", "Koh Rok et Koh Ha", 400, "ad", null, { enfant: 200, thai_adulte: 40, thai_enfant: 20, note: "À payer en espèces au garde sur l'île." }, { sur_place: true });
  prestation(null, "frais", "Frais de parc national", "4 îles", 200, "ad", null, { enfant: 100, note: "À payer en espèces sur place." }, { sur_place: true });
  prestation(taxi, "transfert", "Minivan privé", "Aéroport de Krabi → Koh Lanta", 2500, "veh", 2250, { note: "Jusqu'à 9 personnes, bagages compris." });
  prestation(taxi, "transfert", "Minivan privé", "Koh Lanta → Aéroport de Phuket", 4500, "veh", 4050, {});
  prestation(taxi, "transfert", "Taxi local", "Saladan → Klong Dao", 80, "pp", null, { note: "Grille de l'association des taxis." });
  prestation(longtail, "activite", "Sortie coucher de soleil", "Coucher de soleil en longtail, 2 h", 700, "pp", 500, { duree: "17h00 - 19h00" });
  trajet(speed, "Koh Lanta", "Koh Phi Phi", "Speedboat", "10:30", "11:30", "1 h", 900, 700, 700, 500);
  trajet(speed, "Koh Lanta", "Koh Phi Phi", "Speedboat", "13:00", "14:00", "1 h", 900, 700, 700, 500);
  trajet(speed, "Koh Phi Phi", "Koh Lanta", "Speedboat", "15:00", "16:00", "1 h", 900, 700, 700, 500);
  trajet(speed, "Koh Lanta", "Koh Lipe", "Speedboat", "10:30", "13:30", "3 h", 1900, 1500, 1500, 1200, [[j(10), j(190)]], "Haute saison seulement");
  trajet(speed, "Koh Lanta", "Phuket", "Speedboat", "10:30", "13:00", "2 h 30", 1700, 1300, 1300, 1000);
  trajet(ferry, "Koh Lanta", "Koh Phi Phi", "Ferry", "11:00", "12:30", "1 h 30", 800, 650, 600, 500);
  trajet(ferry, "Koh Phi Phi", "Koh Lanta", "Ferry", "14:30", "16:00", "1 h 30", 800, 650, 600, 500);

  // Réservations auprès des partenaires pour les dossiers de l'entreprise 2.
  const reservations = [];
  const reservations_nets = [];
  const reservation = (dossier, x, libelle, date, extra, nets) => {
    const r = { id: uid(), created_at: j(-2), updated_at: j(-2), entite_id: e2.id, dossier_id: dossier.id, ligne_id: "", prestation_id: x ? x.id : null, trajet_id: null, partenaire_id: x ? x.partenaire_id : null, libelle, date_service: date, heure_pickup: "", lieu_pickup: "", personnes: { adultes: 2, enfants: 0, bebes: 0 }, statut: "a_demander", reference_partenaire: "", montant_vente: null, notes: "", details: {}, cree_par: admin.user_id, ...extra };
    reservations.push(r);
    if (nets) reservations_nets.push({ id: uid(), entite_id: e2.id, reservation_id: r.id, net_prevu: null, net_paye: null, paye_le: null, ...nets });
    return r;
  };
  reservation(dossiers[5], prestations[0], "4 îles en longtail, journée", j(1), { heure_pickup: "08:00", lieu_pickup: "Hotel Sunset, Klong Dao", statut: "confirme", reference_partenaire: "LT-2211", montant_vente: 2400 }, { net_prevu: 1600 });
  reservation(dossiers[5], prestations[3], "Koh Rok et Koh Ha, frais de parc", j(1), { statut: "confirme", personnes: { adultes: 2, enfants: 0, bebes: 0 }, notes: "À payer en espèces sur l'île." }, null);
  reservation(dossiers[6], prestations[5], "Aéroport de Krabi → Koh Lanta", j(0), { heure_pickup: "14:30", lieu_pickup: "Aéroport de Krabi, vol FD3217", statut: "demande", montant_vente: 2500, personnes: { adultes: 1, enfants: 1, bebes: 0 } }, { net_prevu: 2250 });
  reservation(dossiers[5], prestations[8], "Coucher de soleil en longtail, 2 h", j(3), { montant_vente: 1400 }, { net_prevu: 1000 });
  // Taxi : une course hier (la carte « Hier » propose l'avis et la commission) et une demain.
  const dossiersTaxi = dossiers.filter((d) => d.entite_id === e3.id);
  const chauffeurs = { id: uid(), created_at: j(-90), updated_at: j(-90), entite_id: e3.id, nom: "Chauffeurs démo", nom_thai: "", categorie: "Transferts terrestres et taxis", groupe: "transport", role: "Minivans privés", contact: { personne: "M. Démo", telephones: [{ numero: "083-000-0009", libelle: "", whatsapp: true }] }, regles: { mode_reglement: "sur_place" }, contrat: {}, notes: "", ordre: 1, actif: true };
  partenaires.push(chauffeurs);
  const courseTaxi = (dossier, ligneC, date, extra) => reservations.push({ id: uid(), created_at: j(-2), updated_at: j(-2), entite_id: e3.id, dossier_id: dossier.id, ligne_id: ligneC.id, prestation_id: null, trajet_id: null, partenaire_id: chauffeurs.id, libelle: ligneC.libelle, date_service: date, heure_pickup: "", lieu_pickup: "", personnes: { adultes: 2, enfants: 0, bebes: 0 }, statut: "confirme", reference_partenaire: "", montant_vente: ligneC.unite, paye_sur_place: true, notes: "", details: {}, ...extra });
  courseTaxi(dossiersTaxi[0], lc7, j(-1), { heure_pickup: "11:00", lieu_pickup: "Krabi Airport, arrivals hall", personnes: { adultes: 4, enfants: 0, bebes: 0 }, details: { drop_off: "Hotel Sea, Koh Lanta", bagages: "oui" } });
  courseTaxi(dossiersTaxi[1], lc8, j(1), { heure_pickup: "06:30", lieu_pickup: "Villa Demo, Klong Nin", personnes: { adultes: 2, enfants: 1, bebes: 1 }, statut: "demande", details: { drop_off: "Phuket Airport", bagages: "3" } });
  reservation(dossiers[6], prestations[6], "Koh Lanta → Aéroport de Phuket", j(-20), { statut: "confirme", heure_pickup: "06:00", lieu_pickup: "Hotel Palm", montant_vente: 4500 }, { net_prevu: 4050, net_paye: 4050, paye_le: j(-15) });

  const tache = (e, titre, jours, assignee, dossier, extra = {}) => ({ id: uid(), created_at: j(-3), entite_id: e.id, dossier_id: dossier ? dossier.id : null, partenaire_id: null, titre, description: "", echeance: jours === null ? null : j(jours), assignee_id: assignee ? assignee.user_id : null, fait: false, fait_le: null, fait_par: null, cree_par: admin.user_id, ...extra });
  const taches = [
    tache(e1, "Relancer Julien Rochat pour son devis", 0, admin, dossiers[1]),
    tache(e1, "Envoyer le carnet de voyage de Marc Delaye", 6, admin, dossiers[3]),
    tache(e1, "Mettre à jour les prix de la haute saison", null, null, null),
    tache(e2, "Confirmer l'heure de prise en charge", 1, assistante, dossiers[5]),
    tache(e2, "Envoyer la facture du transfert", -1, stagiaire, dossiers[6]),
    tache(e2, "[À vérifier] Obtenir le contrat signé de Longtail démo", null, null, null, { partenaire_id: longtail.id, description: "Le contrat du dossier n'est pas contresigné." }),
    tache(e3, "Vérifier le planning de la semaine", 2, assistante, null),
  ];
  // Treize mois d'activité fictive pour les statistiques (demo-stats.mjs).
  return enrichirDemoStats({ entites: [e1, e2, e3], profils: [admin, assistante, stagiaire, comptable], roles, membres, reglages, clients, dossiers, documents, paiements, catalogue, taches, partenaires, partenaires_prives, prestations, prestations_nets, trajets, trajets_nets, reservations, reservations_nets, pieces: [], fichiers: {}, journal: [] }, { ajd, ajouterJours, uid, contenu, nouvelleLigne });
}
