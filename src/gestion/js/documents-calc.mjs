// Devis et factures envoyés : ce qui part chez le client se fige à l'envoi (décision de Jérémy du 17.11.2026).
// - À l'envoi, le document garde une copie de l'émetteur, des informations de paiement, de la devise et de l'acompte (`contenu.fige`),
//   et une trace de chaque envoi avec l'empreinte du document tel qu'il est parti (`contenu.envois`).
// - Une modification après l'envoi se voit (« modifié depuis l'envoi ») et se renvoie ; la facture n'est jamais redessinée avec les réglages du jour.
// - Une ligne sans prix bloque l'envoi d'une facture ; une ligne « Offert » compte 0 et s'imprime comme offerte.
// Logique pure, sans navigateur, testée par node --test.
import { modePaiement, MESSAGES_DEFAUT } from "./defauts.mjs";
import { sommePaiements, arrondi, acomptePct, joursRelance, periodeTexte, lignesEquivalents } from "./calc.mjs";
export { acomptePct, joursRelance };

const estNombre = (v) => v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v));

// ---- Empreinte du document ------------------------------------------------------------------------------------------
// JSON aux clés triées : deux copies du même document donnent la même empreinte, quel que soit l'ordre des champs.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
// FNV-1a 32 bits, en hexadécimal : suffisant pour voir qu'un document a changé (ce n'est pas une signature).
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
// Ce que voit le client : le contenu et la date d'émission. Les traces d'envoi, la copie figée et la source d'une facture locale n'en font pas partie.
// Les nets ne comptent pas (seules les personnes qui ont le droit « nets » les reçoivent dans les lignes), ni la forme des équivalents que
// l'éditeur remet au format actuel à l'ouverture : seuls les équivalents affichés comptent.
export function empreinteDocument(doc) {
  const c = { ...((doc && doc.contenu) || {}) };
  delete c.fige;
  delete c.envois;
  delete c.source;
  if (Array.isArray(c.lignes)) c.lignes = c.lignes.map((l) => (l && typeof l === "object" && "net" in l ? (({ net, ...reste }) => reste)(l) : l));
  const eq = c.equivalents;
  c.equivalents = eq && eq.actif ? { actif: true, lignes: (lignesEquivalents(eq) || []).map((x) => ({ code: x.code, taux: x.taux ?? "" })) } : undefined;
  return fnv(stable({ c, d: (doc && doc.date_emission) || "" }));
}

// ---- Ce qui se fige à l'envoi ---------------------------------------------------------------------------------------
const choisir = (o, cles) => Object.fromEntries(cles.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
export function figerReglages(reglages, contenu) {
  const mode = modePaiement(reglages, contenu.paiement);
  return {
    emetteur: choisir(reglages.emetteur, ["nom", "sous_titre", "adresse", "telephone", "licence", "contact"]),
    paiement: { texte: mode.texte || "", qr_image: mode.qr_image || "", qr_pseudo: mode.qr_pseudo || "" },
    devise: contenu.devise || reglages.devise || "",
    acompte_pct: Number(reglages.conditions && reglages.conditions.acompte_pct) || 0,
    delai_jours: reglages.conditions ? reglages.conditions.delai_jours : undefined,
  };
}

// Réglages avec lesquels dessiner un document : ceux du jour, sauf ce qui a été figé à son envoi.
export function reglagesDuDocument(reglages, contenu) {
  const f = contenu && contenu.fige;
  if (!f) return reglages;
  return {
    ...reglages,
    emetteur: { ...reglages.emetteur, ...(f.emetteur || {}) },
    conditions: { ...reglages.conditions, acompte_pct: f.acompte_pct ?? reglages.conditions.acompte_pct, ...(f.delai_jours !== undefined ? { delai_jours: f.delai_jours } : {}) },
    devise: f.devise || reglages.devise,
  };
}
// Informations de paiement du pied de page : celles figées à l'envoi, sinon celles choisies dans les réglages du jour.
export const paiementDuDocument = (reglages, contenu) => (contenu && contenu.fige && contenu.fige.paiement ? contenu.fige.paiement : modePaiement(reglages, contenu && contenu.paiement));

// Les réglages du jour diffèrent-ils de ceux figés sur le document (banque, adresse, acompte…) ? « Renvoyer » prendrait ceux du jour.
export function reglagesChanges(reglages, contenu) {
  const f = contenu && contenu.fige;
  if (!f) return false;
  const actuel = figerReglages(reglages, { ...contenu, devise: f.devise });
  return stable({ ...actuel, delai_jours: undefined }) !== stable({ ...f, delai_jours: undefined });
}

// ---- État d'envoi ---------------------------------------------------------------------------------------------------
// `envois` : [{ le, empreinte }] du plus ancien au plus récent. Un document envoyé avant cette version de l'outil n'a que `envoye_le`.
export function etatEnvoi(doc) {
  const c = (doc && doc.contenu) || {};
  const envois = Array.isArray(c.envois) ? c.envois : [];
  const dernier = envois[envois.length - 1] || null;
  return {
    envoye: !!(doc && doc.envoye_le),
    le: (doc && doc.envoye_le) || null,
    envois,
    // Modifié depuis l'envoi : seulement quand l'empreinte du dernier envoi est connue (pas de fausse alerte sur les anciens documents).
    modifie: !!(doc && doc.envoye_le && dernier && dernier.empreinte && dernier.empreinte !== empreinteDocument(doc)),
  };
}

// Ce qu'on écrit en marquant le document envoyé (premier envoi ou renvoi) : date, copie figée, trace de l'envoi, devise toujours écrite.
// `recu` : le montant reçu à imprimer sur une facture (null : le garder tel quel, ou le figer d'après les paiements s'il n'est pas encore figé).
export function patchEnvoi(doc, reglages, { date, paiements = [], recu = null } = {}) {
  const contenu = structuredClone(doc.contenu || {});
  contenu.devise = contenu.devise || reglages.devise;
  if (doc.type === "facture") {
    if (recu !== null) contenu.montant_recu = arrondi(recu);
    else if (contenu.montant_recu == null) contenu.montant_recu = sommePaiements(paiements);
  }
  contenu.fige = figerReglages(reglages, contenu);
  const avecDate = { ...doc, contenu, envoye_le: date };
  contenu.envois = [...(Array.isArray(contenu.envois) ? contenu.envois : []), { le: date, empreinte: empreinteDocument(avecDate) }];
  return { envoye_le: date, contenu };
}

// Retirer la date d'envoi (noté envoyé par erreur) : le dernier envoi est oublié ; sans envoi restant, la copie figée part aussi.
export function patchRetraitEnvoi(doc) {
  const contenu = structuredClone(doc.contenu || {});
  const envois = Array.isArray(contenu.envois) ? contenu.envois.slice(0, -1) : [];
  if (envois.length) contenu.envois = envois;
  else {
    delete contenu.envois;
    delete contenu.fige;
  }
  if (doc.type === "facture") contenu.montant_recu = null;
  const precedent = envois[envois.length - 1];
  return { envoye_le: precedent ? precedent.le : null, contenu };
}

// Au renvoi d'une facture : le montant reçu imprimé n'est plus celui des paiements enregistrés ? Renvoie { imprime, paiements } ou null.
export function ecartRecu(doc, paiements) {
  if (!doc || doc.type !== "facture" || doc.contenu.montant_recu == null) return null;
  const imprime = arrondi(doc.contenu.montant_recu);
  const total = sommePaiements(paiements);
  return imprime === total ? null : { imprime, paiements: total };
}

// ---- Lignes sans prix, lignes offertes -----------------------------------------------------------------------------
// Une ligne a un prix quand on peut le calculer (prix × quantité, ou montant), quand elle est « Offert », ou quand un texte remplace le montant
// (« inclus »). Un bloc de formule peut rester sans prix (le prix est sur les lignes suivantes) ; remises et notes ne sont pas concernées.
export function ligneSansPrix(l) {
  if (!l || l.kind !== "ligne" || l.offert) return false;
  if ((l.texte_montant || "").trim()) return false;
  if (estNombre(l.unite) && estNombre(l.qte)) return false;
  return !estNombre(l.montant);
}
export const lignesSansPrix = (contenu) => ((contenu && contenu.lignes) || []).filter(ligneSansPrix);
// Une facture ne part pas avec une ligne sans prix (décision 8). Un devis peut partir.
export const envoiBloque = (doc) => !!doc && (doc.type === "facture" || doc.type === "facture_locale") && lignesSansPrix(doc.contenu).length > 0;

// Texte imprimé à la place du montant d'une ligne offerte.
export const texteOffert = (en) => (en ? "Complimentary" : "Offert");

// ---- Numéro du document ---------------------------------------------------------------------------------------------
// Le même numéro partout : en-tête du PDF, message, objet de l'e-mail, nom du fichier.
export const numeroDocument = (doc, dossier) => (((doc && doc.contenu && doc.contenu.numero) || "").trim() || (dossier && dossier.ref) || "");

// Le numéro (référence du dossier ou numéro affiché) d'un document déjà envoyé ne se change plus sans confirmation de l'administratrice.
export const numeroVerrouille = (documents) => (documents || []).some((d) => d && d.envoye_le && (d.type === "devis" || d.type === "facture"));

// ---- Facture locale -------------------------------------------------------------------------------------------------
// La facture locale garde l'empreinte de la facture copiée : un écart dit que la facture a été corrigée depuis.
export const sourceLocale = (facture, taux) => ({ facture_id: facture.id, empreinte: empreinteDocument(facture), taux });
export function localeEnRetard(locale, facture) {
  const s = locale && locale.contenu && locale.contenu.source;
  if (!s || !facture || s.facture_id !== facture.id) return false;
  return s.empreinte !== empreinteDocument(facture);
}

// ---- Bandeau de période ---------------------------------------------------------------------------------------------
export const periode = periodeTexte;
// Le document change de langue : la période du bandeau suit, le reste du titre (écrit par la personne) ne bouge pas.
export function bandeauDansLangue(bandeau, dossier, langue) {
  if (!bandeau || !dossier || !dossier.date_depart) return bandeau;
  const vers = periode(dossier.date_depart, dossier.date_retour, langue);
  const depuis = periode(dossier.date_depart, dossier.date_retour, langue === "en" ? "" : "en");
  return depuis && bandeau.includes(depuis) ? bandeau.replace(depuis, vers) : bandeau;
}

// ---- Devises --------------------------------------------------------------------------------------------------------
// Nom imprimé ({devise_nom} des conditions) et symbole des équivalents. Les réglages (`devises_noms`) complètent ou remplacent ces valeurs.
export const DEVISES_DEFAUT = { CHF: { nom: "Swiss Franc", symbole: "CHF" }, EUR: { nom: "Euro", symbole: "€" }, THB: { nom: "Thai Baht", symbole: "THB" }, USD: { nom: "US Dollar", symbole: "$" }, GBP: { nom: "Pound Sterling", symbole: "GBP" } };
export function infoDevise(reglages, code) {
  const perso = ((reglages && reglages.devises_noms) || {})[code] || {};
  const base = DEVISES_DEFAUT[code] || {};
  return { nom: (perso.nom || "").trim() || base.nom || code, symbole: (perso.symbole || "").trim() || base.symbole || code };
}
// « CHF | Swiss Franc | CHF » par ligne, dans les deux sens.
export function lireDevisesNoms(texte) {
  const out = {};
  for (const ligne of String(texte || "").split("\n")) {
    const [code, nom = "", symbole = ""] = ligne.split("|").map((x) => x.trim());
    if (!code) continue;
    out[code.toUpperCase()] = { nom, symbole };
  }
  return out;
}
export const ecrireDevisesNoms = (o) => Object.entries(o || {}).map(([code, v]) => [code, v.nom || "", v.symbole || ""].join(" | ")).join("\n");

// ---- Message et objet de l'envoi ------------------------------------------------------------------------------------
// Modèles par défaut dans MESSAGES_DEFAUT (defauts.mjs), modifiables dans l'écran Messages : usages « envoi_devis », « envoi_facture »,
// « objet_devis », « objet_facture ». Sans modèle, le texte de secours ci-dessous (le même que les modèles par défaut).
const USAGES_ENVOI = ["envoi_devis", "envoi_facture", "objet_devis", "objet_facture"];
export const SECOURS_ENVOI = Object.fromEntries(["fr", "en"].map((langue) => [langue, Object.fromEntries(USAGES_ENVOI.map((cle) => [cle, (MESSAGES_DEFAUT.find((m) => m.cle === cle && m.langue === langue) || {}).corps || ""]))]));
// Usage du message et de l'objet pour un document.
export const usagesEnvoi = (type) => (type === "devis" ? { message: "envoi_devis", objet: "objet_devis" } : { message: "envoi_facture", objet: "objet_facture" });
// Variables du message d'envoi : {bonjour} (« Hello Anna, »), {prenom}, {numero}, {client}, {entreprise}, {total}.
export const varsEnvoi = ({ en, prenom = "", numero = "", client = "", entreprise = "", total = "" }) => ({ bonjour: `${en ? "Hello" : "Bonjour"}${prenom ? ` ${prenom}` : ""},`, prenom, numero, client, entreprise, total });
