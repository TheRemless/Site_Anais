// Notation du jeu d'essai de l'assistant IA (scripts/eval-assistant/run-eval.mjs). Fonctions pures, sans réseau, testées par
// tests/gestion-assistant-eval.test.js : chaque usage reçoit { exact, score } et la liste des contrôles ratés.
//   exact  1 si tous les contrôles du cas passent, sinon 0 (le chiffre qu'on suit) ;
//   score  part des contrôles réussis (montre de combien on rate).
// Les contrôles portent sur ce que l'outil affiche, c'est-à-dire la sortie déjà passée par les contrôles de la fonction (validerLecture…),
// sauf la signature et les mots interdits, contrôlés aussi sur le texte brut de Claude.
import { sansAccents, montantsDuTexte } from "../../supabase/functions/assistant/calc.js";
import { retirerSignature } from "../../supabase/functions/assistant/itineraire.js";

export const norm = (s) => sansAccents(s).replace(/[^a-z0-9]+/g, " ").trim();
const chiffres = (s) => String(s || "").replace(/\D/g, "");
const liste = (x) => (Array.isArray(x) ? x : [x]);

// Un ensemble de contrôles nommés : { nom: booléen }. Rend la note et les noms ratés.
export function bilan(controles) {
  const noms = Object.keys(controles);
  const rates = noms.filter((n) => !controles[n]);
  return { grade: { exact: rates.length ? 0 : 1, score: noms.length ? (noms.length - rates.length) / noms.length : 1 }, rates };
}

// Hôtel : vide attendu et vide rendu, ou l'un contient l'autre une fois normalisés (« Cocolanta Resort » / « Cocolanta Resort Koh Lanta »).
export function hotelOk(rendu, acceptables) {
  const r = norm(rendu);
  return liste(acceptables).some((a) => {
    const x = norm(a);
    if (!x) return !r;
    return !!r && (r === x || r.includes(x) || x.includes(r));
  });
}
export const telephoneOk = (rendu, attendu) => (attendu ? chiffres(rendu).length >= 8 && chiffres(rendu).slice(-8) === chiffres(attendu).slice(-8) : !rendu);
export const nomOk = (rendu, attendu) => (attendu ? !!norm(rendu) && (norm(rendu) === norm(attendu) || norm(rendu).includes(norm(attendu))) : !rendu);

// La ligne du catalogue choisie : « hors_catalogue », « aucun » (ni ligne ni transfert libre) ou un motif { libelle, groupe } cherché dans
// la prestation (libellés, groupe) ou le trajet (« de → vers », mode).
export function catalogueOk(service, acceptables, { prestations = [], trajets = [] } = {}) {
  const o = service.offre;
  return liste(acceptables).some((a) => {
    if (a === "hors_catalogue") return !!service.hors_catalogue;
    if (a === "aucun") return !o && !service.hors_catalogue;
    if (!o) return false;
    const ligne = o.genre === "trajet" ? trajets.find((t) => t.id === o.id) : prestations.find((p) => p.id === o.id);
    if (!ligne) return false;
    const libelle = o.genre === "trajet" ? `${ligne.de} → ${ligne.vers}` : `${ligne.libelle_en || ""} | ${ligne.libelle || ""}`;
    const groupe = o.genre === "trajet" ? ligne.mode || "" : ligne.groupe || "";
    return (!a.libelle || norm(libelle).includes(norm(a.libelle))) && (!a.groupe || norm(groupe).includes(norm(a.groupe)));
  });
}

// Associe chaque service attendu à un service rendu (même date acceptable), dans l'ordre, sans réutiliser un service rendu.
function associer(attendus, rendus) {
  const pris = new Set();
  return attendus.map((a) => {
    const i = rendus.findIndex((r, k) => !pris.has(k) && liste(a.date).includes(r.date || ""));
    if (i < 0) return null;
    pris.add(i);
    return rendus[i];
  });
}

// ---- lire ---------------------------------------------------------------------------------------------------------------------------
// `p` : la proposition validée ({ client, services }), `att` : cas.lire.
export function noterLire(p, att, catalogue) {
  const c = (p && p.client) || {};
  const services = (p && p.services) || [];
  const ac = att.client;
  const k = {
    nom: nomOk(c.nom, ac.nom),
    telephone: telephoneOk(c.telephone, ac.telephone),
    hotel: hotelOk(c.hotel, ac.hotel),
    langue: (c.langue || "") === ac.langue,
    adultes: c.adultes === ac.adultes,
    enfants: c.enfants === ac.enfants,
    bebes: (c.bebes || 0) === (ac.bebes || 0),
    nombre_services: services.length >= att.services.length && services.length <= (att.services_max || att.services.length),
  };
  associer(att.services, services).forEach((s, i) => {
    const a = att.services[i];
    const n = `s${i + 1}`;
    k[`${n}_date`] = !!s;
    k[`${n}_heure`] = !!s && liste(a.heure).includes(s.heure || "");
    k[`${n}_personnes`] = !!s && liste(a.adultes).includes(s.adultes) && s.enfants === a.enfants;
    k[`${n}_catalogue`] = !!s && catalogueOk(s, a.catalogue, catalogue);
  });
  return bilan(k);
}

// ---- itineraire ---------------------------------------------------------------------------------------------------------------------
export function noterItineraire(it, att) {
  const etapes = (it && it.etapes) || [];
  const obligatoires = att.etapes.filter((e) => !e.optionnelle);
  const k = {
    prenom: nomOk(it && it.prenom, att.prenom),
    langue: ((it && it.langue) || "") === att.langue,
    adultes: (it && it.adultes) === att.adultes,
    enfants: (it && it.enfants) === att.enfants,
    nombre_etapes: etapes.length >= obligatoires.length && etapes.length <= att.etapes.length,
  };
  att.etapes.forEach((a, i) => {
    const e = etapes[i];
    if (a.optionnelle && !e) return;
    const n = `e${i + 1}`;
    k[`${n}_hotel`] = !!e && (a.hotel ? hotelOk(e.hotel, a.hotel) : hotelOk(e.hotel || e.lieu_ecrit, [a.lieu_ecrit || "", ""]));
    k[`${n}_du`] = !!e && (e.du || "") === a.du;
    k[`${n}_au`] = !!e && (e.au || "") === (a.au || "");
  });
  return bilan(k);
}

// ---- réponses rédigées (repondre_itineraire, rediger) ---------------------------------------------------------------------------------
// Même liste que la fonction (itineraire.js) : « partenaire » n'y est pas, la voix de l'entreprise le dit au client (décision du 19.11.2026).
const INTERNE = /\b(marges?|margins?|commissions?|nets?|prix d'achat|net price)\b/i;
const TUTOIEMENT = /\b(tu|te|toi|ton|ta|tes|t')\b/i;
const langueDe = (t) => {
  const s = ` ${norm(t)} `;
  const fr = [" bonjour ", " merci ", " vous ", " votre ", " pour ", " les "].filter((m) => s.includes(m)).length;
  const en = [" hello ", " thank ", " you ", " your ", " for ", " the "].filter((m) => s.includes(m)).length;
  return fr > en ? "fr" : "en";
};
// Les heures écrites dans un texte, en HH:MM (« 9:30 », « 09h30 », « 2pm » non compté : les faits sont en HH:MM).
const heuresDuTexte = (t) => [...String(t).matchAll(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g)].map((m) => `${m[1].padStart(2, "0")}:${m[2]}`);

// `brut` : le texte rendu par Claude, `valide` : ce que la fonction en garde ({ message, avertissements }), `faits` : les faits envoyés.
// `attendus` : { prix: [n], heures: ["HH:MM"], langue, signature_interdite, compagnies: [noms interdits], interdits: [mots] }.
export function noterReponse(brut, valide, attendus) {
  const message = String(brut || "");
  const avert = (valide && valide.avertissements) || [];
  const montants = new Set(montantsDuTexte(message));
  const heures = new Set(heuresDuTexte(message));
  const n = norm(message);
  const k = {
    montants_des_faits: !avert.some((a) => a.startsWith("montant_hors_base")),
    heures_des_faits: !avert.some((a) => a.startsWith("heure_hors_base")),
    aucun_mot_interne: !INTERNE.test(message),
    aucune_compagnie: !(attendus.compagnies || []).some((c) => norm(c).length > 2 && ` ${n} `.includes(` ${norm(c)} `)),
    aucun_mot_interdit: !(attendus.interdits || []).some((m) => ` ${n} `.includes(` ${norm(m)} `)),
    sans_signature: !attendus.signature_interdite || !retirerSignature(message.trim(), attendus.entreprise || "").retire,
    tous_les_prix: (attendus.prix || []).every((p) => montants.has(p) || p < 100),
    tous_les_horaires: (attendus.heures || []).every((h) => heures.has(h)),
    langue: langueDe(message) === attendus.langue,
    vouvoiement: attendus.langue !== "fr" || !TUTOIEMENT.test(message),
  };
  return bilan(k);
}

// ---- trier --------------------------------------------------------------------------------------------------------------------------
// `tri` : la sortie validée ({ types, nom, date_service, nouveau }), `cas` : le cas (type acceptables, nom, date_service, changement).
export function noterTrier(tri, cas) {
  const types = (tri && tri.types) || [];
  const k = {
    type: cas.type.includes(types[0]),
    // Le bon type est parmi les choix montrés : Nani le voit d'un coup d'œil.
    type_dans_les_choix: types.some((t) => cas.type.includes(t)),
  };
  if (cas.nom !== undefined) k.nom = nomOk(tri && tri.nom, cas.nom);
  if (cas.date_service) k.date_service = (tri && tri.date_service) === cas.date_service;
  if (cas.changement) {
    const nv = (tri && tri.nouveau) || {};
    k.nouvelle_date = (nv.date || "") === cas.changement.date;
    k.nouvelle_heure = (nv.heure || "") === cas.changement.heure;
    k.nouvelles_personnes = (nv.adultes || 0) === cas.changement.adultes && (nv.enfants || 0) === cas.changement.enfants;
  }
  return bilan(k);
}

// ---- futur assistant conversationnel (champ « agent » des cas) --------------------------------------------------------------------------
// Note la réponse en texte libre d'un agent : planification juste et rien d'inventé.
//   departs_admissibles / departs_exclus  au moins un départ qui arrive à temps est proposé, aucun qui arrive trop tard ;
//   heure_pickup ""                        aucune heure inventée : seules les heures données (heures_autorisees, départs) apparaissent ;
//   montants_interdits                     un prix de catalogue qui ne s'applique pas (2 300 pour une course à arrêts) n'apparaît pas ;
//   doit_demander                          les informations manquantes sont demandées (personnes, bagages, heure du vol).
const DEMANDES = {
  personnes: /\b(how many|number of (people|guests|passengers)|combien de personnes|nombre de personnes|combien (êtes|etes)-vous)\b/i,
  bagages: /\b(bags?|luggage|suitcases?|bagages?|valises?)\b/i,
  "heure du vol": /\b(flight|vol)\b/i,
};
export function noterAgent(texte, att) {
  const heures = new Set(heuresDuTexte(texte));
  const montants = new Set(montantsDuTexte(texte));
  const k = {};
  if (att.departs_admissibles) k.un_depart_a_temps = att.departs_admissibles.some((h) => heures.has(h));
  // Une heure d'arrivée (« arriving 14:30 », « arrivée 14h30 », « 13:30 → 14:30 ») n'est pas un départ proposé.
  const departs = new Set(heuresDuTexte(String(texte).replace(/(?:arriv\w*|→|->|–|-)\s*(?:at|à|vers|around)?\s*\d{1,2}[:h]\d{2}/gi, " ")));
  if (att.departs_exclus) k.aucun_depart_trop_tard = !att.departs_exclus.some((h) => departs.has(h));
  if (att.heure_pickup === "") {
    const permises = new Set([...(att.heures_autorisees || []), ...(att.departs_admissibles || [])]);
    k.aucune_heure_inventee = [...heures].every((h) => permises.has(h));
  }
  if (att.montants_interdits) k.aucun_prix_inapplicable = !att.montants_interdits.some((m) => montants.has(m));
  for (const q of att.doit_demander || []) k[`demande_${q.replace(/\s+/g, "_")}`] = !!DEMANDES[q] && DEMANDES[q].test(texte);
  return bilan(k);
}
