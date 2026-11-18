// Booking confirmation de Secret Travel & Tour (Jérémy, 18.11.2026), d'après le modèle « Minivan Booking Confirmation » : le voucher d'un transfert
// payé au chauffeur sans partenaire (taxi indépendant, voucher de Mook sous le logo de Secret). Même mise en page que celle de VIP Taxi Lanta
// (voucher-taxi.mjs : photo, vague, sceau, cadre doré), aux couleurs et dans la police du modèle, avec son propre pied. Toujours en anglais.
// Les rubriques et leurs valeurs viennent de champsBooking (taxi-calc.mjs) ; les textes fixes de textes-voucher.mjs (clés « bs_… »), réglables
// dans Réglages > Vouchers ; le logo, la photo et le WhatsApp des réglages de l'entreprise.
import { h } from "../ui.mjs";
import { champsBooking, lignesEnPlus } from "../taxi-calc.mjs";
import { textesVoucher } from "../textes-voucher.mjs";
import { photoBandeau } from "./voucher-taxi.mjs";

const LOGO_DEFAUT = "assets/logo-secret.png";
const BANDEAU_DEFAUT = "assets/secret-bandeau.webp";

// L'icône WhatsApp du bloc « CONTACT US: » (tracé simple, sans dépendance).
const NS = "http://www.w3.org/2000/svg";
function iconeWhatsapp() {
  if (typeof document.createElementNS !== "function") return null;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "vs-wa");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("fill", "currentColor");
  p.setAttribute("d", "M12 2a10 10 0 00-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1012 2zm0 1.8a8.2 8.2 0 016.9 12.6l-.2.3.8 2.9-3-.8-.3.2A8.2 8.2 0 1112 3.8zm-3.3 4.3c-.2 0-.5 0-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3 2.4 1 2.9.8 3.4.7.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3l-1.9-.9c-.3-.1-.5-.1-.7.1l-.9 1.1c-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.8-.8-1.4-1.7-1.6-2-.1-.3 0-.4.1-.6l.4-.5.3-.5v-.5l-.9-2.1c-.2-.5-.4-.5-.6-.5h-.6z");
  svg.append(p);
  return svg;
}

// `regl` : réglages de l'entreprise ; le reste vient de renderVoucher (pickup et dépose déjà déduits de la réservation).
// `nomSociete` : le nom de l'entreprise (bloc Vouchers des réglages, sinon l'émetteur) ; `retour` : { programme, duree } ou null.
export function renderBookingSecret({ regl, client = {}, r, pickup = "", dropoff = "", bagages = "", devise = "THB", whatsapp = "", nomSociete = "", retour = null }) {
  const v = regl.voucher || {};
  const textes = textesVoucher(regl);
  // Le modèle de Secret n'écrit rien après le prix (pas de « (all fees included) »).
  const t = (cle) => (cle === "b_tous_frais" ? "" : textes(cle));
  const marque = String(nomSociete || "").trim().toUpperCase();
  const remplir = (s) => String(s || "").replaceAll("{ENTREPRISE}", marque);
  const nom = [client.prenom, client.nom].filter(Boolean).join(" ");
  const dt = r.details || {};
  const champs = champsBooking({ nom, date: r.date_service, pickup, heure: r.heure_pickup, dropoff, personnes: r.personnes || {}, bagages, sieges: dt.sieges, vol: dt.vol, montant: r.montant_vente, devise, retour, remarques: dt.remarques, t });
  const valeur = (c) => (c.date ? [`${c.date.mois} ${c.date.jour}`, h("sup", null, c.date.suffixe), ` ${c.date.annee}`] : c.valeur);
  const logo = (regl.apparence && regl.apparence.logo) || LOGO_DEFAUT;
  const serre = lignesEnPlus(champs.map((c) => (c.date ? "" : c.valeur))) + Math.max(0, champs.length - 7);
  const lignes = (s) => remplir(s).split("\n").flatMap((l, i) => (i ? [h("br"), l] : [l]));
  return h(
    "div",
    { class: `voucher voucher-taxi voucher-secret${serre >= 1 ? " vt-serre" : ""}${serre >= 3 ? " vt-serre-fort" : ""}` },
    h("img", { class: "vs-lignes", src: "assets/secret-lignes.png", alt: "" }),
    h(
      "div",
      { class: "vt-haut" },
      h("div", { class: "vt-bandeau" }, photoBandeau(v.bandeau || BANDEAU_DEFAUT), h("div", { class: "vt-vague", "aria-hidden": "true" })),
      h("div", { class: "vt-sceau" }, h("img", { src: logo, alt: nomSociete || "" }))
    ),
    h("h1", { class: "vt-titre" }, t("b_titre_1"), h("br"), t("b_titre_2")),
    h("p", { class: "vt-intro" }, t("bs_intro")),
    h("div", { class: "vt-cadre" }, champs.map((c) => h("div", { class: "vt-rang" }, h("p", { class: "vt-cle" }, c.cle), h("p", { class: "vt-valeur" }, valeur(c))))),
    h(
      "div",
      { class: "vt-bas" },
      h(
        "div",
        { class: "vt-pied" },
        h("p", { class: "vs-info" }, t("bs_info")),
        h("ul", { class: "vs-points" }, ["bs_paiement", "bs_rencontre", "bs_assistance"].map((k) => h("li", null, remplir(t(k))))),
        h("p", null, ...lignes(t("bs_merci"))),
        h("p", null, remplir(t("bs_signature")))
      ),
      h("div", { class: "vt-contact" }, h("p", { class: "vt-contact-titre" }, t("b_contact")), whatsapp ? h("p", { class: "vs-tel" }, iconeWhatsapp(), whatsapp) : null)
    )
  );
}
