// Voucher de VIP Taxi Lanta : la « Booking confirmation » d'Anaïs reproduite d'après son modèle (12.11.2026).
// Même chemin que les vouchers de Secret (image pour WhatsApp, PDF sur ordinateur) : renderVoucher() passe la main ici en mode taxi.
// Toujours en anglais. Les textes du pied sont ceux du modèle, mot pour mot (taxi-calc.mjs).
import { h } from "../ui.mjs";
import { champsBooking, PIED_BOOKING, lignesEnPlus } from "../taxi-calc.mjs";

const LOGO_DEFAUT = "assets/logo-vip-taxi.webp";
const BANDEAU_DEFAUT = "assets/taxi-bandeau.webp";

// `regl` : réglages de l'entreprise ; le reste vient de renderVoucher (pickup et dépose déjà déduits de la réservation).
export function renderBookingConfirmation({ regl, client = {}, r, pickup = "", dropoff = "", bagages = "", devise = "THB", whatsapp = "", email = "", adresse = "" }) {
  const v = regl.voucher || {};
  const nom = [client.prenom, client.nom].filter(Boolean).join(" ");
  const champs = champsBooking({ nom, date: r.date_service, pickup, heure: r.heure_pickup, dropoff, personnes: r.personnes || {}, bagages, montant: r.montant_vente, devise });
  const valeur = (c) =>
    c.date ? [`${c.date.mois} ${c.date.jour}`, h("sup", null, c.date.suffixe), ` ${c.date.annee}`] : c.valeur;
  const logo = (regl.apparence && regl.apparence.logo) || LOGO_DEFAUT;
  const lieu = adresse || PIED_BOOKING.lieu;
  // La page A4 est pleine (en-tête du modèle) : une valeur qui passe à la ligne resserre les rangs pour que le pied reste visible.
  const serre = lignesEnPlus(champs.map((c) => (c.date ? "" : c.valeur)));
  return h(
    "div",
    { class: `voucher voucher-taxi${serre >= 1 ? " vt-serre" : ""}${serre >= 3 ? " vt-serre-fort" : ""}` },
    h(
      "div",
      { class: "vt-haut" },
      h("div", { class: "vt-bandeau" }, h("img", { class: "vt-photo", src: v.bandeau || BANDEAU_DEFAUT, alt: "" }), h("div", { class: "vt-vague", "aria-hidden": "true" })),
      h("div", { class: "vt-sceau" }, h("img", { src: logo, alt: "VIP Taxi Lanta, Mr. Brown" }))
    ),
    h("h1", { class: "vt-titre" }, "BOOKING", h("br"), "CONFIRMATION"),
    h("p", { class: "vt-intro" }, PIED_BOOKING.intro),
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
        h("p", null, PIED_BOOKING.paiement, " ", h("em", null, PIED_BOOKING.paiement_wise), h("br"), PIED_BOOKING.attente, h("br"), PIED_BOOKING.changement),
        h("p", null, PIED_BOOKING.merci),
        h("p", null, PIED_BOOKING.salutation),
        h("p", null, PIED_BOOKING.signature, h("br"), lieu)
      ),
      h("div", { class: "vt-contact" }, h("p", { class: "vt-contact-titre" }, "CONTACT US:"), whatsapp ? h("p", null, whatsapp) : null, email ? h("p", null, email) : null)
    )
  );
}
