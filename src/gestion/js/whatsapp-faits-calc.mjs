// Fiche « faits du client » en haut d'une conversation WhatsApp (lot 2 des audits du 20.11.2026, usage n° 2). Nani répond vite et court depuis
// son app : ce qui l'aide, c'est d'avoir sous le pouce le dossier, les dates, l'hôtel, le prochain pickup et son heure, les prix déjà donnés
// et ce qui reste à payer, chacun copiable d'un tap. Uniquement des données de Gestion, aucun appel à l'IA.
// Jamais de net, de commission ni de nom de partenaire : seulement le prix de vente des services (montant_vente) et le reste à payer du client.
// Logique pure, testée par tests/gestion-whatsapp-faits.test.js.
import { N_ } from "./i18n.mjs";

const actives = (reservations = []) => (reservations || []).filter((r) => r && r.statut !== "annule" && !r.annule);
const cleNum = (v) => {
  const n = String(v || "").replace(/\D/g, "");
  return n.length >= 8 ? n.slice(-9) : "";
};

// Le client de la conversation : celui qui est relié, sinon une fiche au même numéro (9 derniers chiffres) parmi `clients`. Une conversation
// à trier retrouve ainsi un client déjà connu sans être rangée.
export function clientPourFaits(conv, clients = []) {
  if (!conv) return null;
  if (conv.client_id) return clients.find((c) => c.id === conv.client_id) || null;
  const k = cleNum(conv.telephone);
  if (!k) return null;
  return clients.find((c) => cleNum(c.telephone) === k) || null;
}

// Le dossier montré : celui qui est relié ; sinon, parmi ceux du client (non annulés), le prochain à venir, puis le plus récent passé.
export function dossierPourFaits({ conv, client = null, dossiers = [], reservations = [], aujourdhui = "" }) {
  if (conv && conv.dossier_id) {
    const d = dossiers.find((x) => x.id === conv.dossier_id);
    if (d) return d;
  }
  if (!client) return null;
  const siens = dossiers.filter((d) => d.client_id === client.id && !d.annule);
  if (!siens.length) return null;
  // Les dates de chaque dossier, calculées une fois (pas dans le tri).
  const ids = new Set(siens.map((d) => d.id));
  const datesPar = new Map();
  for (const r of actives(reservations)) if (ids.has(r.dossier_id) && r.date_service) datesPar.set(r.dossier_id, [...(datesPar.get(r.dossier_id) || []), r.date_service]);
  const bornes = new Map(siens.map((d) => {
    const dates = (datesPar.get(d.id) || []).sort();
    const debut = dates[0] || d.date_depart || String(d.created_at || "").slice(0, 10);
    return [d.id, { debut, fin: dates[dates.length - 1] || d.date_retour || debut }];
  }));
  const debut = (d) => bornes.get(d.id).debut;
  const fin = (d) => bornes.get(d.id).fin;
  const aVenir = siens.filter((d) => fin(d) >= aujourdhui).sort((a, b) => debut(a).localeCompare(debut(b)));
  if (aVenir.length) return aVenir[0];
  return [...siens].sort((a, b) => fin(b).localeCompare(fin(a)))[0];
}

// Le prochain service : le premier à venir (date puis heure de pickup), sinon le dernier passé.
export function prochainService(reservations = [], aujourdhui = "") {
  const tries = actives(reservations).filter((r) => r.date_service).sort((a, b) => `${a.date_service} ${a.heure_pickup || "99"}`.localeCompare(`${b.date_service} ${b.heure_pickup || "99"}`));
  return tries.find((r) => r.date_service >= aujourdhui) || tries[tries.length - 1] || null;
}

// Les lignes de la fiche, dans l'ordre où Nani en a besoin. Chaque ligne : { cle, libelle, valeur, vars?, copie }. `valeur` est le texte
// affiché et copié tel quel. `jour(iso)` met une date en clair dans la langue de l'écran, `montant(n, devise)` est formatMontant.
// `resume` : le résumé du dossier (calc.mjs, resume) pour le reste à payer ; `taxi` : VIP Taxi Lanta (tout se paie au chauffeur, pas de facture).
// `intervalle(a, b)` : « 22 nov. au 25 nov. » dans la langue de l'écran (jamais de tiret).
export function faitsClient({ dossier = null, reservations = [], resume = null, aujourdhui = "", taxi = false, jour = (x) => x, montant = (n, d) => `${d || ""} ${n}`.trim(), intervalle = (a, b) => `${a} au ${b}` }) {
  if (!dossier) return [];
  const siennes = actives(reservations.filter((r) => r.dossier_id === dossier.id));
  const lignes = [];
  const dates = siennes.map((r) => r.date_service).filter(Boolean).sort();
  const debut = dates[0] || dossier.date_depart || null;
  const fin = dates[dates.length - 1] || dossier.date_retour || debut;
  if (debut) lignes.push({ cle: "dates", libelle: N_("Dates"), valeur: fin && fin !== debut ? intervalle(jour(debut), jour(fin)) : jour(debut) });
  const prochain = prochainService(siennes, aujourdhui);
  const hotel = (prochain && prochain.lieu_pickup) || (siennes.find((r) => r.lieu_pickup) || {}).lieu_pickup || "";
  if (hotel) lignes.push({ cle: "hotel", libelle: N_("Hôtel"), valeur: hotel });
  if (prochain) {
    const quand = [jour(prochain.date_service), prochain.heure_pickup || null].filter(Boolean).join(", ");
    lignes.push({ cle: "pickup", libelle: prochain.date_service >= aujourdhui ? N_("Prochain pickup") : N_("Dernier pickup"), valeur: quand, sousTitre: prochain.libelle || "", aFixer: !prochain.heure_pickup });
  }
  const devise = (resume && resume.devise) || dossier.devise || null;
  const avecPrix = siennes.filter((r) => Number(r.montant_vente) > 0);
  for (const r of avecPrix.slice(0, 3)) lignes.push({ cle: `prix-${r.id}`, libelle: N_("Prix donné"), valeur: montant(Number(r.montant_vente), devise), sousTitre: r.libelle || "" });
  if (avecPrix.length > 1) lignes.push({ cle: "total", libelle: N_("Total des services"), valeur: montant(avecPrix.reduce((s, r) => s + Number(r.montant_vente), 0), devise) });
  // Ce qui reste à payer : le reste du dossier (factures et paiements) ; ce qui se paie sur place est dit à part. Taxi : tout au chauffeur.
  const surPlace = siennes.filter((r) => r.paye_sur_place && Number(r.montant_vente) > 0).reduce((s, r) => s + Number(r.montant_vente), 0);
  if (!taxi && resume && Number(resume.total) > 0) lignes.push({ cle: "reste", libelle: N_("Reste à payer"), valeur: Number(resume.reste) > 0 ? montant(Number(resume.reste), devise) : null, paye: !(Number(resume.reste) > 0) });
  if (surPlace > 0) lignes.push({ cle: "sur_place", libelle: taxi ? N_("À payer au chauffeur") : N_("À payer sur place"), valeur: montant(surPlace, devise) });
  return lignes;
}
