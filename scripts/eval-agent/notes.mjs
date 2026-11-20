// Notation des cas de l'agent (jeu d'essai, 19.11.2026). Tout est vérifié par du code, sans juge : outils appelés, questions posées,
// heures et montants tous sourcés (résultat d'outil ou message de la personne), verdict du vol, cartes conformes (prix, signature).
import { montantsDuTexte, sansAccents } from "../../supabase/functions/agent/outils.js";

const DEMANDES = {
  vol: /\bvol\b|flight/i,
  personnes: /personnes|passagers|combien (?:de|d')|people|passengers|pax/i,
  bagages: /bagages?|valises?|luggage|bags?|suitcases?/i,
  duree: /dur[ée]e|temps de (?:route|trajet)|combien de temps|how long/i,
};
const FIN_SIGNEE = /(?:belle|bonne) (?:journée|soirée)|have an? (?:nice|lovely|great|good) (?:day|evening)|best regards|kind regards|cordialement/i;
const heuresDe = (t) => [...String(t).matchAll(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g)].map((m) => `${m[1].padStart(2, "0")}:${m[2]}`);

export const paiementAvance = (m) =>
  /\b(?:pay|payment|paid|paiement|payer|régl)/i.test(m) &&
  /in advance|advance payment|beforehand|à l'avance|d'avance/i.test(m) &&
  /confirm/i.test(m) &&
  /\bwise\b/i.test(m) &&
  /(?:international|bank) (?:bank )?transfer|virement/i.test(m) &&
  /\bcash\b|espèces/i.test(m) &&
  /office|bureau|agence/i.test(m) &&
  !/\biban\b|\bswift\b|account (?:number|no)|numéro de compte|\b\d{8,}\b|wise\.com\/pay|https?:\/\//i.test(m);

// `t` : ce que le tour a produit { outils, textes, cartes, plannings, tapes } ; `memo` : la mémoire de la conversation après le tour.
// `contexte` : { prestataires, prenoms }. Rend { verifs: { nom: booléen }, score }.
export function noterTour(att = {}, t, memo, contexte = {}) {
  const v = {};
  const reponses = t.cartes.filter((c) => c.genre === "reponse").map((c) => c.donnees.message);
  const tout = [t.textes, ...reponses].join("\n");
  for (const o of att.outils || []) v[`outil_${o}`] = t.outils.includes(o);
  for (const q of att.doit_demander || []) v[`demande_${q}`] = DEMANDES[q].test(t.textes);
  if (att.heures_sourcees) {
    const permises = new Set([...memo.heures, ...heuresDe(t.tapes)]);
    const libres = heuresDe(tout).filter((h) => !permises.has(h));
    v.heures_sourcees = !libres.length;
  }
  if (att.aucun_montant) v.aucun_montant = !montantsDuTexte(tout).length;
  if (att.montants_sources) v.montants_sources = montantsDuTexte(tout).every((n) => memo.prix.has(n) || memo.tapes.has(n));
  const plan = t.plannings[t.plannings.length - 1] || null;
  if (att.pickup_du_planning) v.pickup_du_planning = !!plan && t.textes.includes(plan.pickup.heure);
  if (att.verdict_vol) v.verdict_vol = !!plan && !!plan.vol && plan.vol.verdict === att.verdict_vol;
  if (att.dit_pas_tenable) v.dit_pas_tenable = /pas tenable|n'est pas tenable|impossible|trop tard|trop juste|not feasible|won't make it/i.test(t.textes);
  if (att.propose_autre_conversation) v.autre_conversation = /autre conversation|nouvelle conversation|conversation (?:à part|séparée|distincte|dédiée)|new conversation|separate conversation/i.test(t.textes);
  if (att.sans_remise) v.sans_remise = !reponses.some((m) => /\b50\s?%|discount|remise|réduction/i.test(m));
  const c = att.cartes || {};
  if (c.dossier_sans_prix) {
    const d = t.cartes.filter((x) => x.genre === "dossier");
    v.dossier_propose = d.length > 0;
    v.dossier_sans_prix_invente = d.every((x) => x.donnees.services.every((s) => s.offre || s.prix === null || s.origine_prix === "saisi"));
  }
  if (c.reponse_sans_signature) v.reponse_sans_signature = reponses.every((m) => !FIN_SIGNEE.test(m) && !(contexte.prenoms || []).some((p) => new RegExp(`\\b${sansAccents(p)}\\b`).test(sansAccents(m))));
  if (c.reponse_sans_prestataire) v.reponse_sans_prestataire = reponses.every((m) => !(contexte.prestataires || []).some((p) => p.length > 3 && sansAccents(m).includes(sansAccents(p))));
  // Bateau (ferry, speedboat) : la réservation se confirme après paiement, à l'avance, par Wise, virement international ou cash à l'office ;
  // jamais de coordonnées bancaires ni d'adresse inventées (règle de réponse de Secret et Taxi, 20.11.2026).
  if (c.paiement_avance) v.paiement_avance = reponses.length > 0 && reponses.every(paiementAvance);
  if (c.reponse_vouvoiement) v.reponse_vouvoiement = reponses.length > 0 && reponses.every((m) => /\bvous\b/i.test(m) && !/\btu\b|\bte\b|\bton\b|\bta\b/i.test(m));
  if (att.ferry_en_trois) v.ferry_en_trois = !!plan && plan.trajets.some((x) => Array.isArray(x.morceaux) && x.morceaux.length === 3) && /ferry/i.test(t.textes);
  if (att.source_duree) v.source_duree = !!plan && plan.trajets.every((x) => x.source === att.source_duree);
  if (att.carte_temps) v.carte_temps = t.cartes.some((x) => x.genre === "temps" && x.donnees.duree_min === att.carte_temps);
  if (att.modification) v.modification = t.cartes.some((x) => x.genre === "modification" && x.donnees.champ === att.modification.champ && x.donnees.valeur === att.modification.valeur);
  const n = Object.values(v);
  return { verifs: v, score: n.length ? n.filter(Boolean).length / n.length : 1 };
}

// Cas « agent » du jeu du lot 1 (cas.json, champ « agent ») : une demande de client collée, notée sur les départs et les heures.
export function noterCasLot1(att = {}, t, memo) {
  const v = {};
  const reponses = t.cartes.filter((c) => c.genre === "reponse").map((c) => c.donnees.message);
  const tout = [t.textes, ...reponses].join("\n");
  const heures = new Set(heuresDe(tout));
  if (att.departs_admissibles) v.un_depart_a_temps = att.departs_admissibles.some((h) => heures.has(h));
  const departs = new Set(heuresDe(tout.replace(/(?:arriv\w*|→|->|–|-)\s*(?:at|à|vers|around)?\s*\d{1,2}[:h]\d{2}/gi, " ")));
  if (att.departs_exclus) v.aucun_depart_trop_tard = !att.departs_exclus.some((h) => departs.has(h));
  // Une heure de pickup n'est admise que si elle sort d'un outil (planning) ou de la demande : jamais devinée.
  const permises = new Set([...memo.heures, ...heuresDe(t.tapes), ...(att.heures_autorisees || [])]);
  v.heures_sourcees = [...heures].every((h) => permises.has(h));
  for (const q of att.doit_demander || []) if (DEMANDES[q]) v[`demande_${q}`] = DEMANDES[q].test(t.textes);
  const n = Object.values(v);
  return { verifs: v, score: n.length ? n.filter(Boolean).length / n.length : 1 };
}
