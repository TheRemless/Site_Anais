// Voucher de VIP Taxi Lanta : la « Booking confirmation » d'Anaïs reproduite d'après son modèle (12.11.2026).
// Même chemin que les vouchers de Secret (image pour WhatsApp, PDF sur ordinateur) : renderVoucher() passe la main ici en mode taxi.
// Toujours en anglais. Les textes sont ceux du modèle, mot pour mot, et se règlent dans Réglages > Booking confirmation (textes-voucher.mjs).
// La photo du bandeau se téléverse dans les mêmes réglages (`voucher.bandeau`).
import { h } from "../ui.mjs";
import { champsBooking, lignesEnPlus } from "../taxi-calc.mjs";
import { textesVoucher } from "../textes-voucher.mjs";

const LOGO_DEFAUT = "assets/logo-vip-taxi.webp";

// La photo du bandeau en arrière-plan « cover » : html2canvas, qui fabrique l'image envoyée, ignore `object-fit` et étirait une <img> dans son
// cadre (photo aplatie, 18.11.2026). Un arrière-plan garde ses proportions partout (aperçu, image, impression), quelle que soit la photo
// téléversée dans les réglages.
export const photoBandeau = (src) => h("div", { class: "vt-photo", role: "presentation", style: `background-image: url("${String(src).replace(/["\\\n]/g, encodeURIComponent)}")` });
const BANDEAU_DEFAUT = "assets/taxi-bandeau.webp";

// `regl` : réglages de l'entreprise ; le reste vient de renderVoucher (pickup et dépose déjà déduits de la réservation).
// `retour` : { programme, duree } pour un retour au point de départ (16.11.2026), sinon null.
export function renderBookingConfirmation({ regl, client = {}, r, pickup = "", dropoff = "", bagages = "", devise = "THB", whatsapp = "", email = "", adresse = "", retour = null }) {
  const v = regl.voucher || {};
  const t = textesVoucher(regl);
  const nom = [client.prenom, client.nom].filter(Boolean).join(" ");
  const dt = r.details || {};
  const champs = champsBooking({ nom, date: r.date_service, pickup, heure: r.heure_pickup, dropoff, personnes: r.personnes || {}, bagages, sieges: dt.sieges, vol: dt.vol, montant: r.montant_vente, devise, retour, remarques: dt.remarques, t });
  const valeur = (c) =>
    c.date ? [`${c.date.mois} ${c.date.jour}`, h("sup", null, c.date.suffixe), ` ${c.date.annee}`] : c.valeur;
  const logo = (regl.apparence && regl.apparence.logo) || LOGO_DEFAUT;
  const lieu = adresse || t("b_lieu");
  // La page A4 est pleine (en-tête du modèle) : une valeur qui passe à la ligne resserre les rangs pour que le pied reste visible.
  // Un rang de plus que le modèle (le programme et la durée d'un retour au départ) compte comme une ligne de plus.
  const serre = lignesEnPlus(champs.map((c) => (c.date ? "" : c.valeur))) + Math.max(0, champs.length - 7);
  return h(
    "div",
    { class: `voucher voucher-taxi${serre >= 1 ? " vt-serre" : ""}${serre >= 3 ? " vt-serre-fort" : ""}` },
    h(
      "div",
      { class: "vt-haut" },
      h("div", { class: "vt-bandeau" }, photoBandeau(v.bandeau || BANDEAU_DEFAUT), h("div", { class: "vt-vague", "aria-hidden": "true" })),
      h("div", { class: "vt-sceau" }, h("img", { src: logo, alt: "VIP Taxi Lanta, Mr. Brown" }))
    ),
    h("h1", { class: "vt-titre" }, t("b_titre_1"), h("br"), t("b_titre_2")),
    h("p", { class: "vt-intro" }, t("b_intro")),
    h(
      "div",
      { class: "vt-cadre" },
      champs.map((c) => h("div", { class: "vt-rang" }, h("p", { class: "vt-cle" }, c.cle), h("p", { class: "vt-valeur" }, valeur(c))))
    ),
    h(
      "div",
      { class: "vt-bas" },
      h(
        "div",
        { class: "vt-pied" },
        h("p", null, t("b_paiement"), " ", h("em", null, t("b_paiement_wise")), h("br"), t("b_attente"), h("br"), t("b_changement")),
        h("p", null, t("b_merci")),
        h("p", null, t("b_salutation")),
        h("p", null, t("b_signature"), h("br"), lieu)
      ),
      h("div", { class: "vt-contact" }, h("p", { class: "vt-contact-titre" }, t("b_contact")), whatsapp ? h("p", null, whatsapp) : null, email ? h("p", null, email) : null)
    )
  );
}
