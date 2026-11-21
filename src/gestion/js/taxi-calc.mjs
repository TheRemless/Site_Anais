// VIP Taxi Lanta dans Gestion (12.11.2026) : la logique pure du mode taxi, sans DOM, testée dans tests/gestion-taxi.test.js.
// Un dossier de Taxi suit le chemin des excursions de Secret (client, dossier, réservations, voucher) avec trois différences :
// pas de facture montrée ni envoyée, tout est payé au chauffeur (ou par Wise avant, 3 % de frais), aucune commission par défaut.
// Le prix de la course reste sur un document interne du dossier (type « facture », jamais affiché) : statuts, statistiques et
// commissions se calculent ainsi comme pour Secret, sans rien changer à la base.

import { textesVoucher, DEFAUTS_TEXTES } from "./textes-voucher.mjs";

export const FONCTIONNEMENT_TAXI = "taxi";
export const estTaxi = (reglages) => !!reglages && reglages.fonctionnement === FONCTIONNEMENT_TAXI;

// Toute course de Taxi est payée sur place : le chauffeur encaisse, rien ne passe par Anaïs.
export const lignesSurPlace = (lignes) => (lignes || []).map((l) => (l && l.kind === "ligne" ? { ...l, paye_sur_place: true } : l));

// ---- Voucher « Booking confirmation » ------------------------------------------------------------------------------
// Booking confirmation de Secret Travel & Tour (Jérémy, 18.11.2026) : le voucher d'un transfert payé au chauffeur sans partenaire (taxi indépendant,
// voucher de Mook sous le logo de Secret, ou course saisie ainsi par Anaïs). Les autres transferts de Secret gardent le « Transfer Voucher ».
export const estBookingSecret = (r, type, reglages) => !!r && !!reglages && reglages.fonctionnement === "excursions" && type === "transfert" && !!r.paye_sur_place && !r.partenaire_id;
// Le voucher s'appelle « Booking confirmation » (nom du fichier, libellés) : toujours dans Taxi, et pour ces transferts de Secret.
export const estBookingConfirmation = (r, type, reglages) => estTaxi(reglages) || estBookingSecret(r, type, reglages);
const MOIS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function suffixeOrdinal(n) {
  const d = n % 100;
  if (d >= 11 && d <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
}
// « November 12th 2026 », en morceaux pour mettre le suffixe en exposant comme sur le modèle d'Anaïs.
export function dateBooking(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return null;
  const jour = Number(m[3]);
  return { mois: MOIS_EN[Number(m[2]) - 1], jour: String(jour), suffixe: suffixeOrdinal(jour), annee: m[1] };
}
export const dateBookingTexte = (iso) => {
  const d = dateBooking(iso);
  return d ? `${d.mois} ${d.jour}${d.suffixe} ${d.annee}` : "";
};

// « 11 am », « 2:30 pm », « 12 pm » ; un texte qui n'est pas une heure (« after the flight ») reste tel quel.
export function heureBooking(texte) {
  const t = String(texte || "").trim();
  const m = /^(\d{1,2})[:h.](\d{2})$/.exec(t) || /^(\d{1,2})$/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return t;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

const nombreDe = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
// « 4 adults + luggage », « 2 adults, 1 child, 1 baby », d'après les personnes de la réservation et ses bagages.
// Les sièges enfant ou bébé suivent les personnes : « 2 adults, 1 child (1 child seat) + 3 pieces of luggage ».
export function passagersBooking(personnes = {}, bagages = "", sieges = 0) {
  const a = Number(personnes.adultes) || 0;
  const e = Number(personnes.enfants) || 0;
  const b = Number(personnes.bebes) || 0;
  const liste = [a ? nombreDe(a, "adult", "adults") : "", e ? nombreDe(e, "child", "children") : "", b ? nombreDe(b, "baby", "babies") : ""].filter(Boolean).join(", ");
  const s = Math.max(0, Math.floor(Number(sieges) || 0));
  const siege = s ? nombreDe(s, "child seat", "child seats") : "";
  const gens = liste && siege ? `${liste} (${siege})` : liste || siege;
  const sac = String(bagages || "").trim();
  // Un nombre de bagages s'écrit « + 3 pieces of luggage », un oui sans nombre « + luggage » comme sur le modèle.
  const bag = !sac || sac === "0" ? "" : /^\d+$/.test(sac) ? `${sac} ${Number(sac) > 1 ? "pieces" : "piece"} of luggage` : /^(oui|yes|y|x|true)$/i.test(sac) ? "luggage" : sac;
  return [gens, bag].filter(Boolean).join(" + ");
}

// La ligne LUGGAGE de la Booking confirmation (Jérémy, 18.11.2026) : « 3 pieces », « 1 piece », « Yes » pour un oui sans nombre, le texte saisi
// sinon (« 2 big bags »). Vide quand il n'y a pas de bagages : la ligne ne s'imprime pas, jamais « no luggage ».
export function bagagesBooking(bagages = "") {
  const sac = String(bagages ?? "").trim();
  if (!sac || /^(0|no|non|none|aucun|-|—)$/i.test(sac)) return "";
  if (/^\d+$/.test(sac)) return `${Number(sac)} ${Number(sac) > 1 ? "pieces" : "piece"}`;
  return /^(oui|yes|y|x|true)$/i.test(sac) ? "Yes" : sac;
}

// « 2'700 THB (all fees included) » : l'apostrophe des milliers du modèle. Sans prix, rien (la ligne reste à remplir).
// `t` : les textes de la Booking confirmation (textesVoucher), « (all fees included) » se règle dans Réglages.
export function prixBooking(montant, devise = "THB", t = textesVoucher(null)) {
  if (montant === null || montant === undefined || montant === "" || !Number.isFinite(Number(montant))) return "";
  const n = Math.round(Number(montant) * 100) / 100;
  const [ent, dec] = n.toFixed(2).split(".");
  const milliers = ent.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${milliers}${dec === "00" ? "" : `.${dec}`} ${devise || "THB"} ${t("b_tous_frais")}`.trim();
}

// Ce que dit le voucher, champ par champ. `pickup` et `dropoff` viennent de la réservation (ou du trajet), jamais devinés.
// Le numéro de vol ou de bateau rejoint le lieu qui est un aéroport ou un port (« Krabi Airport, flight FD3217 »), sinon la prise en charge.
const PORT = /\b(pier|port|ferry|jetty|harbou?r)\b|ท่าเรือ/i;
const AEROPORT = /airport|aéroport|aeroport|สนามบิน/i;
// Le numéro est déjà écrit dans ce lieu, aux espaces, tirets et majuscules près (« Krabi Airport, flight FD 3217 » et « FD3217 »), comme un
// mot entier : « FD321 » n'est pas dans « FD3217 ».
const ALNUM = "a-z0-9\\u0e00-\\u0e7f";
export function volDejaDans(lieu, vol) {
  const signes = [...String(vol || "").toLowerCase().replace(/[^a-z0-9\u0e00-\u0e7f]/g, "")];
  if (!signes.length) return false;
  return new RegExp(`(?<![${ALNUM}])${signes.join("[\\s.\\-/]?")}(?![${ALNUM}])`, "i").test(String(lieu || ""));
}
export function lieuxAvecVol(pickup = "", dropoff = "", vol = "") {
  const v = String(vol || "").trim();
  if (!v) return { pickup, dropoff };
  // Déjà écrit dans l'un des deux lieux (tapé à la main) : pas une seconde fois.
  if (volDejaDans(pickup, v) || volDejaDans(dropoff, v)) return { pickup, dropoff };
  const avec = (lieu) => {
    const mot = PORT.test(lieu) && !AEROPORT.test(lieu) ? "boat" : "flight";
    return [String(lieu || "").trim(), `${mot} ${v}`].filter(Boolean).join(", ");
  };
  const ici = (lieu) => AEROPORT.test(lieu) || PORT.test(lieu);
  if (!ici(pickup) && ici(dropoff)) return { pickup, dropoff: avec(dropoff) };
  return { pickup: avec(pickup), dropoff };
}

// `retour` : { programme, duree } pour un retour au point de départ (16.11.2026). Le lieu devient « PICK UP AND RETURN », le drop-off laisse
// la place au programme (« PLAN ») et à la durée (« DURATION », seulement si elle est donnée). Jamais « From X to X ».
// `remarques` : le champ « Remarks » de la course (lot B du 17.11.2026), imprimé en dernier seulement s'il est rempli.
// `t` : les textes réglables (textesVoucher) ; sans réglages, ceux du modèle d'Anaïs.
export function champsBooking({ nom = "", date = "", pickup = "", heure = "", dropoff = "", personnes = {}, bagages = "", sieges = 0, vol = "", montant = null, devise = "THB", retour = null, remarques = "", t = textesVoucher(null) }) {
  ({ pickup, dropoff } = lieuxAvecVol(pickup, retour ? "" : dropoff, vol));
  const rem = String(remarques || "").trim();
  return [
    { cle: t("b_nom"), valeur: nom },
    { cle: t("b_date"), valeur: dateBookingTexte(date), date: dateBooking(date) },
    { cle: retour ? t("b_pickup_retour") : t("b_pickup"), valeur: pickup },
    { cle: t("b_heure"), valeur: heureBooking(heure) },
    ...(retour ? [{ cle: t("b_programme"), valeur: retour.programme || "" }, ...(retour.duree ? [{ cle: t("b_duree"), valeur: retour.duree }] : [])] : [{ cle: t("b_dropoff"), valeur: dropoff }]),
    // Les personnes (et leurs sièges enfant), puis les bagages sur leur propre ligne, seulement s'il y en a (18.11.2026).
    { cle: t("b_passagers"), valeur: passagersBooking(personnes, "", sieges) },
    ...(bagagesBooking(bagages) ? [{ cle: t("b_bagages"), valeur: bagagesBooking(bagages) }] : []),
    { cle: t("b_prix"), valeur: prixBooking(montant, devise, t) },
    ...(rem ? [{ cle: t("b_remarques"), valeur: rem }] : []),
  ];
}

// Lignes ajoutées par les valeurs trop longues pour leur colonne (96 mm : 40 caractères mesurés en 14,5 pt, 38 par prudence) : de quoi resserrer la page.
export const lignesEnPlus = (valeurs, parLigne = 38) => (valeurs || []).reduce((n, v) => n + Math.max(0, Math.ceil(String(v || "").length / parLigne) - 1), 0);

// Pied du voucher, mot pour mot d'après le modèle d'Anaïs (12.11.2026). Les textes vivent dans textes-voucher.mjs (clés « b_… ») et se
// règlent dans Réglages > Booking confirmation ; cet objet garde les défauts pour qui les lit encore ainsi.
export const PIED_BOOKING = Object.fromEntries(["intro", "paiement", "paiement_wise", "attente", "changement", "merci", "salutation", "signature", "lieu"].map((k) => [k, DEFAUTS_TEXTES[`b_${k}`]]));

// ---- Commissions à demander -----------------------------------------------------------------------------------------
// Courses passées (sur place, non annulées) dont la commission n'est pas encore saisie : un jour sans ouvrir Gestion ne fait plus perdre
// la commission (audit du 13.11.2026, point 7). Les courses d'hier déjà saisies restent affichées avec leur montant, pour voir ce qui vient
// d'être fait. Triées de la plus ancienne à la plus récente.
// `jours` : la fenêtre, en jours. Sans limite par défaut (audit du 16.11.2026, n° 46 : passé 14 jours, une commission jamais demandée sortait de
// la liste sans alerte) ; Réglages > Booking confirmation peut en poser une (`reglages.taxi.jours_commission`, voir joursCommission).
// `netDe(r)` : la ligne privée de la réservation ({ commission_prevue, commission_recue, commission_recue_le }) ou null.
export const JOURS_COMMISSION = null;
// La fenêtre réglée : un nombre entier de jours supérieur à 0, sinon pas de limite (null).
export const joursCommission = (reglages) => {
  const n = Number(reglages && reglages.taxi && reglages.taxi.jours_commission);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const jourAvant = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
export function commissionsADemander(reservations, ajd, { ecartes = new Set(), netDe = () => null, jours = JOURS_COMMISSION } = {}) {
  const hier = jourAvant(ajd, 1);
  const depuis = jours ? jourAvant(ajd, jours) : "";
  return (reservations || [])
    .filter((r) => r.date_service && r.date_service < ajd && r.date_service >= depuis && r.statut !== "annule" && r.paye_sur_place && !ecartes.has(r.dossier_id))
    .map((r) => {
      const n = netDe(r) || {};
      const saisie = n.commission_prevue !== null && n.commission_prevue !== undefined;
      return { reservation: r, saisie, montant: saisie ? Number(n.commission_prevue) : null, recue: !!n.commission_recue_le, demandeLe: (r.details && r.details.commission_demandee_le) || null };
    })
    .filter((x) => !x.saisie || x.reservation.date_service === hier)
    .sort((a, b) => (a.reservation.date_service < b.reservation.date_service ? -1 : a.reservation.date_service > b.reservation.date_service ? 1 : 0));
}

// Un seul message par chauffeur (point 8) : les commissions à demander groupées par partenaire, dans l'ordre de la liste.
// `aDemander` : les courses sans montant saisi et pas encore demandées, celles que le message liste.
export function commissionsParChauffeur(liste) {
  const groupes = new Map();
  for (const x of liste || []) {
    const cle = x.reservation.partenaire_id || "";
    const g = groupes.get(cle) || { partenaireId: x.reservation.partenaire_id || null, courses: [], aDemander: [] };
    g.courses.push(x);
    if (!x.saisie && !x.demandeLe) g.aDemander.push(x);
    groupes.set(cle, g);
  }
  return [...groupes.values()];
}

// Une ligne du message groupé : « • 12 November · Krabi Airport → Koh Lanta · Lea Moreau · 1,800 THB ». Les morceaux viennent de
// variablesMessage (date dans la langue du message), un morceau vide est omis.
export const ligneCommission = (v) => `• ${[v.date, v.prestation, v.client, v.prix].filter((x) => String(x || "").trim()).join(" · ")}`;
// Variables du message « commissions » : {contact} (Mr. Brown) et {courses}, une ligne par course. `parCourse` : les variablesMessage de chaque course.
export const varsCommissions = (parCourse) => ({ contact: (parCourse[0] && parCourse[0].contact) || "", courses: parCourse.map(ligneCommission).join("\n") });

// Valeurs à enregistrer quand Anaïs saisit la commission annoncée par Mr. Brown. `recue` : il l'a déjà donnée.
export function valeursCommission(texte, { recue = false, date = "" } = {}) {
  const n = Number(String(texte ?? "").replace(/[\s'’]/g, "").replace(",", "."));
  if (String(texte ?? "").trim() === "" || !Number.isFinite(n) || n < 0) return null;
  const montant = Math.round(n * 100) / 100;
  return recue ? { commission_prevue: montant, commission_recue: montant, commission_recue_le: date } : { commission_prevue: montant };
}

// ---- Le prix interne suit la course ------------------------------------------------------------------------------
// Le document interne d'un dossier de Taxi n'est jamais montré : il reprend sans question la date, le prix et le paiement au chauffeur
// de la course quand celle-ci change. La première ligne liée porte le prix (une course = un véhicule), les autres lignes liées disparaissent.
// Renvoie le nouveau contenu, ou null quand rien ne change ou que la course n'est pas sur le document.
export function contenuCourse(contenu, r) {
  const ids = [r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean);
  const lignes = (contenu && contenu.lignes) || [];
  const premiere = lignes.find((l) => ids.includes(l.id));
  if (!premiere) return null;
  const prix = r.montant_vente === null || r.montant_vente === undefined || r.montant_vente === "" ? null : Number(r.montant_vente);
  const nouvelle = { ...premiere, date_service: r.date_service || premiere.date_service || null, paye_sur_place: true, ...(prix !== null && Number.isFinite(prix) ? { unite: prix, qte: 1 } : {}) };
  const suite = lignes.filter((l) => l.id === premiere.id || !ids.includes(l.id)).map((l) => (l.id === premiere.id ? nouvelle : l));
  const pareil = suite.length === lignes.length && ["date_service", "paye_sur_place", "unite", "qte"].every((k) => (premiere[k] ?? null) === (nouvelle[k] ?? null));
  return pareil ? null : { ...contenu, lignes: suite };
}

// Une course saisie à la main (« Réservation à la main ») entre aussi dans le prix interne : sa ligne, payée au chauffeur.
export const ligneCourse = (r, id) => ({ id, kind: "ligne", libelle: r.libelle || "", intro: "", puces: [], unite: Number(r.montant_vente) || 0, qte: 1, montant: null, pct: null, date_service: r.date_service || null, partenaire_id: r.partenaire_id || null, paye_sur_place: true });

// ---- Demande collée ----------------------------------------------------------------------------------------------
// Une demande de transfert privé venue de la page /taxi/ du site (« Transfer request: … », lue par lireSite) appartient à VIP Taxi Lanta.
// Le minivan partagé et le speedboat, eux aussi des « transferts » pour la lecture, restent à Secret.
// Le retour au point de départ (« Round trip, back to the pickup place », pages /taxi/ et /taxi/songthaew/, 16.11.2026) aussi.
export const demandeDeTaxi = (texte, d) => !!d && d.type === "transfer" && d.mode !== "shared" && d.vehicule !== "speedboat" && /^\s*(?:transfer request:|round trip,?\s*back to (?:the )?pick-?up place)/im.test(String(texte || ""));
// L'entreprise en mode taxi vers laquelle basculer, parmi celles que la personne peut ouvrir (null si aucune, ou si c'est déjà l'active).
export const entrepriseTaxi = (entites, reglagesDe, activeId) => entites.find((e) => e.id !== activeId && estTaxi(reglagesDe(e.id))) || null;
