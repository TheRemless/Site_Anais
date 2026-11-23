// Un message collé qui vient d'une page du carnet (guides de Koh Samui, d'Ao Nang et de Koh Lanta). La page écrit sa référence dans le message (« Ref: AON-AB12 » en anglais, « Réf : SAM-AB12 »
// dans le récapitulatif français du WhatsApp) : le préfixe désigne le guide (REFS_CARNET, une seule table, carnet-produits.mjs). Avec ce préfixe, le message se lit comme une demande de la page :
// la sortie se retrouve par le nom écrit dans le message, l'option par son titre (carnet-ages.mjs, resoudreSortie), et les règles du carnet s'appliquent (âge des enfants, seuil de groupe, extras).
// Un message sans préfixe de la table (un client qui écrit librement) ou avec un préfixe inconnu n'est jamais pris pour une demande du carnet. Un nom de sortie qui ne se reconnaît pas non plus :
// on ne devine rien. Module léger : il ne dépend que des modules de données et de demandes-site-calc.mjs.
import { REFS_CARNET, PRODUITS_CARNET, SORTIES_KOH_LANTA } from "./carnet-produits.mjs";
import { PRODUITS_SITE } from "./site-produits.mjs";
import { cleTexte, resoudreSortie, lireInvitesFrancais } from "./carnet-ages.mjs";
import { lignesDuRecapitulatif, invitesAnglais, dateDuSite, montantAnglais } from "./demandes-site-calc.mjs";

const REF = /^\s*R[ée]f\s*:\s*([A-Z]{3})-[A-Z0-9]{3,}\s*$/im;
// Le guide que désigne la référence du message (« koh-samui », « aonang », « koh-lanta »), ou null.
export function guideDeLaRef(texte) {
  const m = REF.exec(texte || "");
  return m && Object.prototype.hasOwnProperty.call(REFS_CARNET, m[1]) ? REFS_CARNET[m[1]] : null;
}
// Les sorties d'un guide : celles du carnet, ou (Koh Lanta) celles du site Secret que le guide propose.
const sortiesDuGuide = (guide) => (guide === "koh-lanta" ? SORTIES_KOH_LANTA.map((id) => PRODUITS_SITE.find((p) => p.id === id)).filter((p) => p && p.marque === "secret") : PRODUITS_CARNET.filter((p) => p.guide === guide));

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const dateFrancaise = (v) => {
  const m = /(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i.exec(v || "");
  const mois = m ? MOIS.indexOf(m[2].toLowerCase()) : -1;
  return mois < 0 ? "" : `${m[3]}-${String(mois + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
};
// Le récapitulatif français de la page (le WhatsApp du client) écrit au format du site, que la lecture des demandes comprend : mêmes lignes que le message refait d'une demande du carnet
// (demandes-site-calc.mjs, texteDemande). Sans les lignes d'avant « Demande de réservation » (« Bonjour Anaïs, … »).
function anglaisDuRecapitulatif(texte, produit, option, ligneRef) {
  const lire = (re) => ((re.exec(texte) || [])[1] || "").trim();
  const iso = dateFrancaise(lire(/^Date\s*:\s*(.+)$/im));
  const personnes = lire(/^Personnes\s*:\s*(.+)$/im);
  const total = /^Estimation\s*:\s*([\d\s  .,]+?)\s*THB/im.exec(texte);
  const pickup = lire(/^Prise en charge\s*:\s*(.+)$/im);
  const nom = lire(/^Nom\s*:\s*(.+)$/im);
  return [
    `Booking request: ${produit.nom}${option ? ` – ${option}` : ""}`,
    iso ? `Date: ${dateDuSite(iso)}` : "",
    personnes ? `Guests: ${invitesAnglais(lireInvitesFrancais(personnes))}` : "",
    pickup ? `Pickup: ${pickup}` : "",
    nom ? `Name: ${nom}` : "",
    total && Number(total[1].replace(/\D/g, "")) ? `Estimated total: ${montantAnglais(Number(total[1].replace(/\D/g, "")))}` : "",
    ...lignesDuRecapitulatif(texte),
    ligneRef,
  ].filter(Boolean).join("\n");
}
// Le contexte du carnet que porte un message collé, ou null : { guide, carnet: { produit, option }, texte }. `texte` est le message à lire (celui qui est collé, à partir de sa première ligne
// de demande ; le récapitulatif français est récrit au format du site). `carnet` est le même objet que celui d'une demande du site (identifiant de la sortie et de l'option).
export function carnetDuMessage(texte) {
  const guide = guideDeLaRef(texte);
  if (!guide) return null;
  const sorties = sortiesDuGuide(guide);
  const depuis = (re) => { const i = texte.search(re); return i < 0 ? texte : texte.slice(i); };
  const en = /^Booking request:\s*(.+)$/im.exec(texte);
  const fr = en ? null : /^Demande de réservation\s*:\s*(.+)$/im.exec(texte);
  let produit = null;
  let titre = "";
  if (en) {
    const [nom, ...option] = en[1].split(/\s+[–—]\s+/);
    produit = sorties.find((p) => cleTexte(p.nom) === cleTexte(nom)) || null;
    titre = option.join(" – ").trim();
  } else if (fr) {
    produit = sorties.find((p) => p.nomPage && cleTexte(p.nomPage) === cleTexte(fr[1])) || null;
    titre = ((/^Formule\s*:\s*(.+)$/im.exec(texte) || [])[1] || "").trim();
  }
  if (!produit) return null;
  const r = resoudreSortie({ carnet: { produit: produit.id, option: "" }, option: titre });
  const carnet = { produit: produit.id, option: r ? r.option.id : "" };
  if (en) return { guide, carnet, texte: depuis(/^Booking request:/im) };
  return { guide, carnet, texte: anglaisDuRecapitulatif(texte, produit, r ? r.option.titre : titre, (/^\s*R[ée]f\s*:\s*(\S+)\s*$/im.exec(texte) || [])[1] ? `Ref: ${/^\s*R[ée]f\s*:\s*(\S+)\s*$/im.exec(texte)[1]}` : "") };
}
