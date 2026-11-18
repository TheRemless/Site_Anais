// Voucher de VIP Taxi Lanta : la « Booking confirmation » d'Anaïs reproduite d'après son modèle (12.11.2026).
// Même chemin que les vouchers de Secret (image pour WhatsApp, PDF sur ordinateur) : renderVoucher() passe la main ici en mode taxi.
// Toujours en anglais. Les textes sont ceux du modèle, mot pour mot, et se règlent dans Réglages > Booking confirmation (textes-voucher.mjs).
// La photo du bandeau se téléverse dans les mêmes réglages (`voucher.bandeau`).
import { h } from "../ui.mjs";
import { champsBooking, lignesEnPlus } from "../taxi-calc.mjs";
import { textesVoucher } from "../textes-voucher.mjs";
import { avecMarque } from "../noms-calc.mjs";

// Plus d'image de marque par défaut (migration 44) : sans logo ni photo dans les réglages, la Booking confirmation n'en montre pas.
// Taxi d'Anaïs a son logo et sa photo enregistrés (la migration y écrit la photo d'avant).

// La photo du bandeau en arrière-plan « cover » : html2canvas, qui fabrique l'image envoyée, ignore `object-fit` et étirait une <img> dans son
// cadre (photo aplatie, 18.11.2026). Un arrière-plan garde ses proportions partout (aperçu, image, impression), quelle que soit la photo
// téléversée dans les réglages.
export const photoBandeau = (src) => h("div", { class: "vt-photo", role: "presentation", style: `background-image: url("${String(src).replace(/["\\\n]/g, encodeURIComponent)}")` });

// La page A4 doit garder son pied (paiement, signature, contact) quel que soit le contenu. Le resserrement estimé d'après le nombre de
// caractères (serre, plus bas) ne suffit pas toujours : la police de Secret est plus grande, une remarque ou un programme long passent sur
// trois lignes (18.11.2026, signature de Secret coupée). Une fois la page posée dans le document, on mesure : tant que le dernier texte du pied
// dépasse le bas de la page, on resserre d'un cran (vt-serre, vt-serre-fort, vt-serre-max, vt-serre-ultra). Sert à l'image et à l'impression.
const CRANS = ["vt-serre", "vt-serre-fort", "vt-serre-max", "vt-serre-ultra"];
export const depassement = (v) => {
  const derniers = [v.querySelector(".vt-pied > :last-child"), v.querySelector(".vt-contact > :last-child")].filter(Boolean);
  if (!derniers.length) return 0;
  return Math.max(...derniers.map((e) => e.getBoundingClientRect().bottom)) - v.getBoundingClientRect().bottom;
};
export function ajusterBooking(racine) {
  const pages = racine && racine.classList && racine.classList.contains("voucher-taxi") ? [racine] : [...((racine && racine.querySelectorAll && racine.querySelectorAll(".voucher-taxi")) || [])];
  for (const v of pages) {
    for (const cran of CRANS) {
      if (depassement(v) <= 0.5) break;
      v.classList.add(cran);
    }
  }
  return racine;
}
// Pour l'impression : la page est mesurée hors de l'écran (à la largeur A4 de l'image), puis rendue telle quelle.
export function ajusterHorsEcran(noeud) {
  if (typeof document === "undefined" || !document.body) return noeud;
  const hote = h("div", { class: "hote-image", "aria-hidden": "true" }, noeud);
  document.body.append(hote);
  try {
    ajusterBooking(noeud);
  } finally {
    hote.remove();
  }
  return noeud;
}

// `regl` : réglages de l'entreprise ; le reste vient de renderVoucher (pickup et dépose déjà déduits de la réservation).
// `retour` : { programme, duree } pour un retour au point de départ (16.11.2026), sinon null.
export function renderBookingConfirmation({ regl, client = {}, r, pickup = "", dropoff = "", bagages = "", devise = "THB", whatsapp = "", email = "", adresse = "", retour = null, nomSociete = "" }) {
  const v = regl.voucher || {};
  // {ENTREPRISE} : le nom de l'entreprise du voucher en capitales (pied de page, migration 44).
  const textes = textesVoucher(regl);
  const t = (cle) => avecMarque(textes(cle), nomSociete);
  const nom = [client.prenom, client.nom].filter(Boolean).join(" ");
  const dt = r.details || {};
  const champs = champsBooking({ nom, date: r.date_service, pickup, heure: r.heure_pickup, dropoff, personnes: r.personnes || {}, bagages, sieges: dt.sieges, vol: dt.vol, montant: r.montant_vente, devise, retour, remarques: dt.remarques, t });
  const valeur = (c) =>
    c.date ? [`${c.date.mois} ${c.date.jour}`, h("sup", null, c.date.suffixe), ` ${c.date.annee}`] : c.valeur;
  const logo = (regl.apparence && regl.apparence.logo) || "";
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
      h("div", { class: "vt-bandeau" }, v.bandeau ? photoBandeau(v.bandeau) : null, h("div", { class: "vt-vague", "aria-hidden": "true" })),
      logo ? h("div", { class: "vt-sceau" }, h("img", { src: logo, alt: nomSociete || "" })) : null
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
