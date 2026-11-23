// Un message collé qui vient d'une page du carnet (guides de Koh Samui, d'Ao Nang et de Koh Lanta). La page écrit sa référence dans le message (« Ref: AON-AB12 » en anglais, « Réf : SAM-AB12 »
// dans le récapitulatif français du WhatsApp) : le préfixe désigne le guide (REFS_CARNET, une seule table, carnet-produits.mjs). Avec ce préfixe, le message se lit comme une demande de la page :
// la sortie se retrouve par le nom écrit dans le message, l'option par son titre (carnet-ages.mjs, resoudreSortie), et les règles du carnet s'appliquent (âge des enfants, seuil de groupe, extras).
// Un message sans préfixe de la table (un client qui écrit librement) ou avec un préfixe inconnu n'est jamais pris pour une demande du carnet. Un nom de sortie qui ne se reconnaît pas non plus :
// on ne devine rien. Module léger : il ne dépend que des modules de données et de demandes-site-calc.mjs.
import { REFS_CARNET, PRODUITS_CARNET, SORTIES_KOH_LANTA } from "./carnet-produits.mjs";
import { PRODUITS_SITE } from "./site-produits.mjs";
import { cleTexte, resoudreSortie, lireInvitesFrancais } from "./carnet-ages.mjs";
import { lignesDuRecapitulatif, invitesAnglais, dateDuSite, montantAnglais } from "./demandes-site-calc.mjs";

// La ligne de référence (« Ref: AON-AB12 », « Réf : SAM-AB12 ») et ce qui la précède : un message n'est une demande de la page que s'il COMMENCE par sa ligne de demande (précédée, pour le
// WhatsApp français, de la phrase d'accueil de la page) et s'il FINIT par la référence. Un client qui répond librement en citant l'ancien message, ou en écrivant après lui, a un message libre.
const LIGNE_REF = /^R[ée]f\s*:\s*(([A-Z]{3})-[A-Z0-9]{3,})$/i;
const LIGNE_DEMANDE = /^(?:Booking request:|Demande de réservation\s*:)/i;
const ACCUEIL = /^Bonjour Anaïs, voici ma demande de réservation\.?$/i;
// Le bloc de la page : { lignes (de la ligne de demande à la référence), ref, prefixe }, ou null.
function blocDeLaPage(texte) {
  const lignes = String(texte || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const debut = lignes.length && ACCUEIL.test(lignes[0]) ? 1 : 0;
  const ref = lignes.length ? LIGNE_REF.exec(lignes[lignes.length - 1]) : null;
  if (!ref || lignes.length - debut < 2 || !LIGNE_DEMANDE.test(lignes[debut])) return null;
  return { lignes: lignes.slice(debut), ref: ref[1], prefixe: ref[2].toUpperCase() };
}
// Le guide que désigne la référence du message (« koh-samui », « aonang », « koh-lanta »), ou null : message qui n'est pas le bloc de la page, ou préfixe qui n'est pas dans la table.
export function guideDeLaRef(texte) {
  const bloc = blocDeLaPage(texte);
  return bloc && Object.prototype.hasOwnProperty.call(REFS_CARNET, bloc.prefixe) ? REFS_CARNET[bloc.prefixe] : null;
}
// Les sorties d'un guide : celles du carnet, ou (Koh Lanta) celles du site Secret que le guide propose.
const sortiesDuGuide = (guide) => (guide === "koh-lanta" ? SORTIES_KOH_LANTA.map((id) => PRODUITS_SITE.find((p) => p.id === id)).filter((p) => p && p.marque === "secret") : PRODUITS_CARNET.filter((p) => p.guide === guide));

// Un montant écrit par la page ou à la main, en THB : « 5 000 », « 1 250,50 », « 1.250 » (point ou virgule suivis de trois chiffres : milliers), « 250.5 » (décimale). 0 si illisible.
export function montantFrancais(v) {
  const t = String(v ?? "").replace(/[\s\u00a0\u202f'\u2019]/g, "");
  if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(t)) {
    const decimale = /[.,]\d{1,2}$/.exec(t);
    const entier = decimale ? t.slice(0, decimale.index) : t;
    return Number(`${entier.replace(/[.,]/g, "")}${decimale ? `.${decimale[0].slice(1)}` : ""}`);
  }
  return /^\d+([.,]\d{1,2})?$/.test(t) ? Number(t.replace(",", ".")) : 0;
}
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const dateFrancaise = (v) => {
  const m = /(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i.exec(v || "");
  const mois = m ? MOIS.indexOf(m[2].toLowerCase()) : -1;
  return mois < 0 ? "" : `${m[3]}-${String(mois + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
};
// Le récapitulatif français de la page (le WhatsApp du client) écrit au format du site, que la lecture des demandes comprend : mêmes lignes que le message refait d'une demande du carnet
// (demandes-site-calc.mjs, texteDemande). Sans les lignes d'avant « Demande de réservation » (« Bonjour Anaïs, … »).
function anglaisDuRecapitulatif(texte, produit, option, ref) {
  const lire = (re) => ((re.exec(texte) || [])[1] || "").trim();
  const iso = dateFrancaise(lire(/^Date\s*:\s*(.+)$/im));
  const personnes = lire(/^Personnes\s*:\s*(.+)$/im);
  const total = montantFrancais((/^Estimation\s*:\s*([\d\s\u00a0\u202f'\u2019.,]+?)\s*THB/im.exec(texte) || [])[1]);
  const pickup = lire(/^Prise en charge\s*:\s*(.+)$/im);
  const nom = lire(/^Nom\s*:\s*(.+)$/im);
  return [
    `Booking request: ${produit.nom}${option ? ` – ${option}` : ""}`,
    iso ? `Date: ${dateDuSite(iso)}` : "",
    personnes ? `Guests: ${invitesAnglais(lireInvitesFrancais(personnes))}` : "",
    pickup ? `Pickup: ${pickup}` : "",
    nom ? `Name: ${nom}` : "",
    total ? `Estimated total: ${montantAnglais(total)}` : "",
    ...lignesDuRecapitulatif(texte),
    `Ref: ${ref}`,
  ].filter(Boolean).join("\n");
}
// Le contexte du carnet que porte un message collé, ou null : { guide, carnet: { produit, option }, texte }. `texte` est le message à lire (celui qui est collé, à partir de sa première ligne
// de demande ; le récapitulatif français est récrit au format du site). `carnet` est le même objet que celui d'une demande du site (identifiant de la sortie et de l'option).
export function carnetDuMessage(texte) {
  const bloc = blocDeLaPage(texte);
  const guide = guideDeLaRef(texte);
  if (!bloc || !guide) return null;
  const sorties = sortiesDuGuide(guide);
  const demande = bloc.lignes[0];
  const en = /^Booking request:\s*(.+)$/i.exec(demande);
  const fr = en ? null : /^Demande de réservation\s*:\s*(.+)$/i.exec(demande);
  let produit = null;
  let titre = "";
  if (en) {
    const [nom, ...option] = en[1].split(/\s+[–—]\s+/);
    produit = sorties.find((p) => cleTexte(p.nom) === cleTexte(nom)) || null;
    titre = option.join(" – ").trim();
  } else if (fr) {
    produit = sorties.find((p) => p.nomPage && cleTexte(p.nomPage) === cleTexte(fr[1])) || null;
    titre = ((/^Formule\s*:\s*(.+)$/im.exec(bloc.lignes.join("\n")) || [])[1] || "").trim();
  }
  if (!produit) return null;
  const r = resoudreSortie({ carnet: { produit: produit.id, option: "" }, option: titre });
  const carnet = { produit: produit.id, option: r ? r.option.id : "" };
  return { guide, carnet, texte: en ? bloc.lignes.join("\n") : anglaisDuRecapitulatif(bloc.lignes.join("\n"), produit, r ? r.option.titre : titre, bloc.ref) };
}
