// Agent de Gestion : un contact WhatsApp de type « apporteur » (migration 68, PR D du 21.11.2026, décision de Jérémy). Une travel planner
// envoie des clients à Nani, souvent plusieurs dans un même message, sans aucun accord : l'apporteur ne touche rien. Logique pure, sans
// dépendance : la fonction « agent » (index.ts) lit les lignes avec la session de la personne ; les tests (tests/gestion-cartes-apporteur.test.js)
// passent des tableaux.
//
// Ce que l'agent sait quand la conversation de l'Assistant est liée à une conversation WhatsApp d'apporteur :
//   - la consigne (blocApporteur) : un dossier par client, au nom du client, jamais d'accord ni de commission, jamais un mot de l'apporteur au client ;
//   - une seule référence de fiche (« A-1a2b3c4d »), à passer dans le champ « apporteur » de proposer_dossier. Ni le nom de la fiche, ni ses
//     numéros, ni aucune donnée privée des partenaires ne partent chez Anthropic.
// Les fiches : celle reliée à la conversation (partenaire_id, toujours dans l'entreprise de la conversation, whatsapp_type_coherent) et, pour
// l'autre entreprise de l'espace unifié, la fiche « apporteur » de cette entreprise au même numéro que la conversation (un nom seul ne suffit pas). Une par entreprise au plus ;
// sans fiche dans une entreprise, rien n'est posé sur ses dossiers (le déclencheur controler_apporteur_dossier refuse une fiche d'ailleurs).
import { cleNumero } from "./whatsapp-lecture.js";

export const CATEGORIE_APPORTEUR = "apporteur";
// Exactement la catégorie que contrôle la base (controler_apporteur_dossier, migration 68).
export const estFicheApporteur = (p) => !!p && typeof p === "object" && p.categorie === CATEGORIE_APPORTEUR && !!p.id && !!p.entite_id;
export const refApporteur = (id) => `A-${String(id || "").replace(/-/g, "").slice(0, 8).toLowerCase()}`;
const LIBELLES = { secret: "Secret", excursions: "Secret", taxi: "Taxi" };
const libelle = (e) => (e ? LIBELLES[e.slug] || String(e.nom || "") : "");

// Le contact de la conversation WhatsApp liée est-il un apporteur ? Un contact personnel (réponses « jamais ») ne l'est jamais : rien de lui
// ne part, pas même son type.
export const contactApporteur = (conv) => !!conv && typeof conv === "object" && conv.reponses !== "jamais" && conv.type_contact === CATEGORIE_APPORTEUR;

// Les numéros d'une fiche (contact.telephones : liste ou texte), en clés de 9 chiffres comme la boîte (cleNumero).
function telephonesDe(p) {
  const t = p && p.contact ? p.contact.telephones : null;
  const liste = Array.isArray(t) ? t : typeof t === "string" ? t.split(/[,;/\n]|\s{2,}/) : [];
  const out = new Set();
  for (const x of liste) {
    const v = typeof x === "string" ? x : x && typeof x === "object" ? x.numero || x.telephone || x.valeur || "" : "";
    for (const morceau of String(v).match(/\+?\d[\d\s.\-()]{6,}\d/g) || []) {
      const k = cleNumero(morceau);
      if (k) out.add(k);
    }
  }
  return out;
}

// Ce que l'agent sait de l'apporteur. `conv` : la conversation WhatsApp (telephone) ; `reliee` : la fiche reliée (partenaire_id), lue avec
// la session ; `candidats` : les fiches « apporteur » des entreprises, lues avec la session ; `entites` : [{ id, slug, nom }], l'entreprise
// active d'abord (les deux en espace unifié, sinon l'active seule).
// Rend { nom, ref, fiches: [{ id, entite_id, entreprise }], entites } : `ref` est la référence de la fiche reliée (sinon de la première
// trouvée), null sans aucune fiche. Hors de la fiche reliée, seulement une fiche au numéro de la conversation ; plusieurs : aucune (Nani choisit).
export function infoApporteur({ conv = null, reliee = null, candidats = [], entites = [] } = {}) {
  const base = estFicheApporteur(reliee) ? reliee : null;
  // Revue de la PR 298 : la fiche d'une autre entreprise exige le numéro de la conversation. Un nom seul ne suffit pas (« pas de fiche »).
  const tel = cleNumero(conv && conv.telephone);
  const propres = (entites || []).filter((e) => e && e.id).map((e) => ({ id: e.id, slug: e.slug || "", nom: String(e.nom || "") }));
  const fiches = [];
  for (const e of propres) {
    let choix = null;
    if (base && base.entite_id === e.id) choix = base;
    else {
      const ici = (candidats || []).filter((p) => estFicheApporteur(p) && p.entite_id === e.id && p.actif !== false && (!base || p.id !== base.id));
      const parTel = tel ? ici.filter((p) => telephonesDe(p).has(tel)) : [];
      choix = parTel.length === 1 ? parTel[0] : null;
    }
    if (choix) fiches.push({ id: choix.id, entite_id: e.id, entreprise: e.slug, nom: String(choix.nom || "").slice(0, 80) });
  }
  const principale = (base && fiches.find((f) => f.id === base.id)) || fiches[0] || null;
  return { nom: principale ? principale.nom : "", ref: principale ? refApporteur(principale.id) : null, fiches, entites: propres };
}

// La consigne de l'agent, ajoutée au prompt système de chaque échange de la conversation liée. Ni le nom ni le numéro de la fiche : la
// référence seulement.
export function blocApporteur(info, { qui = "Nani", unifie = false } = {}) {
  if (!info) return "";
  const manque = (info.entites || []).filter((e) => !(info.fiches || []).some((f) => f.entite_id === e.id)).map(libelle).filter(Boolean);
  const fiche = info.ref
    ? `- Sur chaque carte proposer_dossier, passe apporteur « ${info.ref} » pour le confirmer : l'outil note l'apporteur sur chaque dossier, dans chaque entreprise où il a une fiche${manque.length ? ` (aucune fiche chez ${manque.join(" ni chez ")} : le dossier s'y crée sans apporteur, ${qui} pourra créer la fiche plus tard)` : ""}. Ne pose aucune question à ce sujet.`
    : `- Aucune fiche apporteur ne correspond à ce contact : laisse apporteur vide, ${qui} pourra créer la fiche plus tard.`;
  return `

Apporteur d'affaires (le contact de cette conversation WhatsApp)
- Ce contact est un apporteur d'affaires : une travel planner ou une agence qui envoie des clients à ${qui}. Il n'y a aucun accord : l'apporteur ne touche rien.
- Chaque client qu'il envoie est un dossier à part, au nom du client : une carte proposer_dossier par client, jamais un seul dossier pour tout le monde. Plusieurs clients dans cette conversation, c'est normal : c'est l'exception à « un client par conversation ».
- Le client du dossier est le client final : le prénom, le nom et le WhatsApp que l'apporteur donne pour lui. L'apporteur n'est jamais le client : ni son nom ni son numéro dans client_nom ou client_telephone ; sans numéro donné pour un client, laisse client_telephone vide.${
    unifie
      ? `
- Chaque client va dans sa bonne entreprise : une excursion chez Secret, un taxi chez Taxi. Un client qui a les deux reçoit une seule carte, qui donnera deux dossiers liés.`
      : ""
  }
${fiche}
- Ne demande jamais d'accord ni de commission et n'en parle jamais, ni à ${qui} ni à l'apporteur.
- Ne parle jamais de l'apporteur au client : ni dans une réponse, ni dans un dossier, ni sur un document.
- Une réponse préparée ici (proposer_reponse) dit à qui elle va : destinataire « apporteur » quand elle s'adresse à l'apporteur, « client » pour un message destiné au client final. Le nom de l'apporteur n'est permis que vers l'apporteur.`;
}

// L'apporteur d'une carte proposer_dossier. Posé d'office quand la conversation est liée à un contact apporteur (`info`, lu avec la session) :
// chaque entreprise reçoit SA fiche, jamais celle d'une autre (clé : l'entreprise de la fiche elle-même), même si le modèle oublie le champ.
// Le champ du modèle (`ref`) ne sert qu'à confirmer : une référence qui n'est pas celle d'une fiche du contact est ignorée, sans
// avertissement. Hors de ce contexte (aucune fiche), rien n'est posé ; une référence donnée quand même donne « apporteur_inconnu ».
// `entitesCarte` : les entreprises des services de la carte (l'entreprise active hors espace unifié).
// Rend { apporteur?, resume?, avertissement? } :
//   apporteur : { nom, fiches: { [entite_id]: partenaire_id } } dans la carte (jamais renvoyé chez Anthropic) ;
//   resume    : { note_chez, sans_fiche_chez } (libellés Secret ou Taxi), ce qui repart chez Anthropic.
export function apporteurDeCarte(ref, info, { entitesCarte = [] } = {}) {
  const r = String(ref || "").trim().toLowerCase();
  const fiches = info && Array.isArray(info.fiches) ? info.fiches.filter((f) => f && f.id && f.entite_id) : [];
  // Revue de la PR 298 : avec les fiches du contexte, la référence n'est qu'une confirmation, jamais un avertissement.
  if (!fiches.length) return r ? { avertissement: "apporteur_inconnu" } : {};
  const par = {};
  for (const f of fiches) if (!par[f.entite_id]) par[f.entite_id] = f.id;
  const nom = String(info.nom || fiches[0].nom || "").slice(0, 80);
  const entites = (info.entites || []).filter((e) => e && e.id);
  const ids = [...new Set((entitesCarte || []).filter(Boolean))];
  const nomDe = (id) => libelle(entites.find((e) => e.id === id)) || "";
  return {
    apporteur: { nom, fiches: par },
    resume: { note_chez: ids.filter((id) => par[id]).map(nomDe).filter(Boolean), sans_fiche_chez: ids.filter((id) => !par[id]).map(nomDe).filter(Boolean) },
  };
}

// ---- Une réponse adressée à l'apporteur lui-même (PR D, revue du 21.11.2026) ---------------------------------------------------------
// Le contrôle des noms de partenaires (controlerReponse, « nom_prestataire » ; whatsapp-envoi, « contenu_interne ») bloque tout nom de fiche
// dans une réponse. Une réponse à Jade, dans SA conversation, peut pourtant dire « Hi Jade ». Seules ses propres fiches sortent de la liste :
// la fiche reliée à la conversation, et seulement quand le contact de cette conversation est de type « apporteur » (jamais un contact
// personnel), plus ses fiches « apporteur » des autres entreprises au numéro de la conversation (la même personne). Tout autre partenaire ou
// apporteur reste bloqué ; dans la conversation d'un client, le nom de Jade aussi.
// `conv` : { type_contact, reponses, partenaire_id, telephone } ; `partenaires` : [{ id, nom, categorie, contact }]. Rend un Set d'identifiants.
export function fichesDuContact(conv, partenaires = []) {
  if (!contactApporteur(conv) || !conv.partenaire_id) return new Set();
  const reliee = (partenaires || []).find((p) => p && p.id === conv.partenaire_id && estFicheApporteur(p));
  if (!reliee) return new Set();
  // Revue de la PR 298 : seulement le numéro de la conversation, jamais les autres numéros de la fiche ni le nom.
  const tel = cleNumero(conv.telephone);
  const memes = tel ? (partenaires || []).filter((p) => estFicheApporteur(p) && p.id !== reliee.id && telephonesDe(p).has(tel)) : [];
  return new Set([reliee.id, ...memes.map((p) => p.id)]);
}
// Les noms de partenaires à bloquer dans une réponse : tous, sauf ceux des fiches `exemptes` (fichesDuContact, ou les fiches de l'apporteur
// connues de l'agent). Un même nom porté par une autre fiche reste bloqué.
export function nomsABloquer(partenaires = [], exemptes = new Set()) {
  const ids = exemptes instanceof Set ? exemptes : new Set(exemptes || []);
  return (partenaires || []).filter((p) => p && !ids.has(p.id)).map((p) => String(p.nom || "").trim()).filter((x) => x.length > 2);
}
