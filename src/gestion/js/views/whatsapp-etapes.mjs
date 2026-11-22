// Écran WhatsApp, étapes des conversations de clients (migration 105, 22.11.2026) : à part de views/whatsapp.mjs, qui l'appelle pour le
// filtre, la ligne de la liste et l'en-tête de la conversation. Aucun appel à l'IA : whatsapp-etapes-calc.mjs combine les faits gardés par
// la fonction « whatsapp » avec les dossiers, les réservations et les vouchers. Secret et Taxi partagent le numéro : une étape par
// entreprise, plus « Nouvelle demande » tant que l'entreprise n'est pas connue. Rien ne part au client ni au prestataire.
import { etat, modifier } from "../etat.mjs";
import { h, toast, modal } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { aujourdhui } from "../calc.mjs";
import { marqueEntite } from "../whatsapp-calc.mjs";
import { ETAPES, libelleEtape, etapesConversation, conversationClient, aEtape, patchEtapeManuelle } from "../whatsapp-etapes-calc.mjs";

const entiteDe = (id) => ((etat.brut && etat.brut.entites) || []).find((e) => e.id === id) || null;
const marqueDe = (id) => marqueEntite(entiteDe(id));
// Le filtre et les pastilles n'arrivent qu'avec la migration 105 (colonnes relues par store-supabase.mjs).
export const etapesDisponibles = () => !!(etat.brut && etat.brut.whatsapp_etapes_disponible);
export { conversationClient };
export const etapesDe = (c) =>
  etapesConversation(c, { dossiers: etat.brut.dossiers || [], clients: etat.brut.clients || [], reservations: etat.brut.reservations || [], marqueDe, aujourdhui: aujourdhui() });

// Les filtres d'étape (« etape:pret »…), dans l'ordre des étapes ; seulement ceux qui ont des conversations, et celui qui est choisi.
export const PREFIXE = "etape:";
export function filtresEtapes(conversations, choisi) {
  const nombres = {};
  for (const c of conversations) for (const e of new Set(etapesDe(c).map((x) => x.etape))) nombres[e] = (nombres[e] || 0) + 1;
  return ETAPES.filter((e) => nombres[e.valeur] || choisi === PREFIXE + e.valeur).map((e) => ({ valeur: PREFIXE + e.valeur, libelle: e.libelle, nombre: nombres[e.valeur] || 0 }));
}
export const estFiltreEtape = (f) => typeof f === "string" && f.startsWith(PREFIXE);
export const filtrerParEtape = (liste, f) => liste.filter((c) => aEtape(etapesDe(c), f.slice(PREFIXE.length)));
// Secret ou Taxi : la conversation rangée là, ou un client qui a une étape chez elle.
export const dansEntreprise = (c, marque) => (c.entite_id && marqueDe(c.entite_id) === marque) || etapesDe(c).some((e) => e.entreprise === marque);
// « À trier » disparaît pour les clients : seuls les contacts qui ne sont pas des clients restent à trier.
export const aTrierNonClient = (c) => !c.entite_id && !conversationClient(c);

const nomCourt = (cle) => (cle === "secret" ? "Secret" : cle === "taxi" ? "Taxi" : "");
function pastille(e) {
  const nom = nomCourt(e.entreprise);
  return h(
    "span",
    { class: `wa-marque wa-etape ${e.entreprise || "aucune"}${e.manuel ? " manuelle" : ""}`, title: e.manuel ? tr("Étape choisie à la main") : null },
    nom ? `${nom} · ${tr(libelleEtape(e.etape))}` : tr(libelleEtape(e.etape))
  );
}
// Dans la ligne de la liste, à la place de l'entreprise : une pastille par entreprise ; rien si le client n'a pas encore d'étape.
export function pastillesEtapes(c) {
  const etapes = etapesDe(c);
  return etapes.length ? h("span", { class: "wa-etapes" }, etapes.map(pastille)) : null;
}

// Dans l'en-tête de la conversation : les étapes et « Changer l'étape » (sauf en lecture seule).
export function blocEtapes(c, { lectureSeule = false, rafraichir = () => {} } = {}) {
  const etapes = etapesDe(c);
  return h(
    "div",
    { class: "wa-etapes-bloc", "data-pas-saisie": "" },
    etapes.length ? h("span", { class: "wa-etapes" }, etapes.map(pastille)) : h("span", { class: "wa-sans" }, tr("Pas encore d'étape")),
    lectureSeule ? null : h("button", { class: "lien", type: "button", onclick: () => choisirEtape(c, etapes, rafraichir) }, tr("Changer l'étape"))
  );
}

// Nani force une étape pour une entreprise ; « Calcul automatique » efface son choix. Son choix l'emporte jusqu'au prochain événement.
function choisirEtape(c, etapes, rafraichir) {
  const manuel = c.etape_manuelle && typeof c.etape_manuelle === "object" ? c.etape_manuelle : {};
  let cle = (etapes.find((e) => e.entreprise) || {}).entreprise || "aucune";
  let fermer;
  const corps = h("div", { class: "modal-corps wa-choix-etape" });
  const ecrire = async (etape) => {
    const patch = patchEtapeManuelle(c, cle, etape);
    if (!patch) return;
    try {
      await modifier("whatsapp_conversations", c.id, patch);
      fermer();
      rafraichir();
    } catch (err) {
      toast(err.message, true);
    }
  };
  const dessiner = () => {
    const actuelle = etapes.find((e) => (e.entreprise || "aucune") === cle);
    // replaceChildren écrirait « null » : seulement les nœuds présents.
    const enfants = [
      h("p", { class: "aide" }, tr("Votre choix reste jusqu'au prochain événement qui fait avancer la conversation (prix, réponse du client, dossier, voucher).")),
      h(
        "div",
        { class: "barre-modal wa-choix-entreprise", role: "group", "aria-label": tr("Entreprise") },
        ["secret", "taxi", "aucune"].map((k) => h("button", { type: "button", class: k === cle ? "principal petit" : "secondaire petit", "aria-pressed": k === cle ? "true" : "false", onclick: () => ((cle = k), dessiner()) }, k === "aucune" ? tr("Sans entreprise") : nomCourt(k)))
      ),
      h(
        "div",
        { class: "wa-choix-etapes" },
        ETAPES.map((e) => h("button", { type: "button", class: actuelle && actuelle.etape === e.valeur ? "principal" : "secondaire", onclick: () => ecrire(e.valeur) }, tr(e.libelle)))
      ),
      manuel[cle] ? h("button", { class: "lien", type: "button", onclick: () => ecrire(null) }, tr("Revenir au calcul automatique")) : null,
    ];
    corps.replaceChildren(...enfants.filter(Boolean));
  };
  dessiner();
  fermer = modal(tr("Étape de la conversation"), corps, { protege: false });
}
