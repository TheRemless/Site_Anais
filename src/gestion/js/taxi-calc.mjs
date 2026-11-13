// VIP Taxi Lanta dans Gestion (12.11.2026) : la logique pure du mode taxi, sans DOM, testée dans tests/gestion-taxi.test.js.
// Un dossier de Taxi suit le chemin des excursions de Secret (client, dossier, réservations, voucher) avec trois différences :
// pas de facture montrée ni envoyée, tout est payé au chauffeur (ou par Wise avant, 3 % de frais), aucune commission par défaut.
// Le prix de la course reste sur un document interne du dossier (type « facture », jamais affiché) : statuts, statistiques et
// commissions se calculent ainsi comme pour Secret, sans rien changer à la base.

export const FONCTIONNEMENT_TAXI = "taxi";
export const estTaxi = (reglages) => !!reglages && reglages.fonctionnement === FONCTIONNEMENT_TAXI;

// Toute course de Taxi est payée sur place : le chauffeur encaisse, rien ne passe par Anaïs.
export const lignesSurPlace = (lignes) => (lignes || []).map((l) => (l && l.kind === "ligne" ? { ...l, paye_sur_place: true } : l));

// ---- Voucher « Booking confirmation » ------------------------------------------------------------------------------
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

// « 2'700 THB (all fees included) » : l'apostrophe des milliers du modèle. Sans prix, rien (la ligne reste à remplir).
export function prixBooking(montant, devise = "THB") {
  if (montant === null || montant === undefined || montant === "" || !Number.isFinite(Number(montant))) return "";
  const n = Math.round(Number(montant) * 100) / 100;
  const [ent, dec] = n.toFixed(2).split(".");
  const milliers = ent.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${milliers}${dec === "00" ? "" : `.${dec}`} ${devise || "THB"} (all fees included)`;
}

// Ce que dit le voucher, champ par champ. `pickup` et `dropoff` viennent de la réservation (ou du trajet), jamais devinés.
// Le numéro de vol ou de bateau rejoint le lieu qui est un aéroport ou un port (« Krabi Airport, flight FD3217 »), sinon la prise en charge.
const PORT = /\b(pier|port|ferry|jetty|harbou?r)\b|ท่าเรือ/i;
const AEROPORT = /airport|aéroport|aeroport|สนามบิน/i;
export function lieuxAvecVol(pickup = "", dropoff = "", vol = "") {
  const v = String(vol || "").trim();
  if (!v) return { pickup, dropoff };
  const avec = (lieu) => {
    // Déjà écrit dans le lieu (« Krabi Airport, flight FD3217 » tapé à la main) : pas une seconde fois.
    if (String(lieu || "").toLowerCase().includes(v.toLowerCase())) return lieu;
    const mot = PORT.test(lieu) && !AEROPORT.test(lieu) ? "boat" : "flight";
    return [String(lieu || "").trim(), `${mot} ${v}`].filter(Boolean).join(", ");
  };
  const ici = (lieu) => AEROPORT.test(lieu) || PORT.test(lieu);
  if (!ici(pickup) && ici(dropoff)) return { pickup, dropoff: avec(dropoff) };
  return { pickup: avec(pickup), dropoff };
}

export function champsBooking({ nom = "", date = "", pickup = "", heure = "", dropoff = "", personnes = {}, bagages = "", sieges = 0, vol = "", montant = null, devise = "THB" }) {
  ({ pickup, dropoff } = lieuxAvecVol(pickup, dropoff, vol));
  return [
    { cle: "NAME", valeur: nom },
    { cle: "DATE", valeur: dateBookingTexte(date), date: dateBooking(date) },
    { cle: "PICK UP LOCATION", valeur: pickup },
    { cle: "PICK UP TIME", valeur: heureBooking(heure) },
    { cle: "DROP OFF LOCATION", valeur: dropoff },
    { cle: "PASSENGERS", valeur: passagersBooking(personnes, bagages, sieges) },
    { cle: "TOTAL PRICE", valeur: prixBooking(montant, devise) },
  ];
}

// Lignes ajoutées par les valeurs trop longues pour leur colonne (96 mm : 40 caractères mesurés en 14,5 pt, 38 par prudence) : de quoi resserrer la page.
export const lignesEnPlus = (valeurs, parLigne = 38) => (valeurs || []).reduce((n, v) => n + Math.max(0, Math.ceil(String(v || "").length / parLigne) - 1), 0);

// Pied du voucher, mot pour mot d'après le modèle d'Anaïs (12.11.2026). `{entreprise}` = nom en capitales sur le modèle.
export const PIED_BOOKING = {
  intro: "We’re happy to confirm your booking details as follows:",
  paiement: "Payment will be collected in cash by the driver directly",
  paiement_wise: "(or you can pay through Wise with a 3% fee, please inform us before)",
  attente: "Your driver will be waiting for you at the meeting point.",
  changement: "If your plan changes, please let us know as soon as possible.",
  merci: "Thank you for choosing VIP TAXI LANTA – we look forward to driving you safely and comfortably to your destination! 🚐✨",
  salutation: "Kind regards,",
  signature: "VIP TAXI LANTA Team",
  lieu: "Koh Lanta, Krabi, Thailand",
};

// ---- Commissions à demander -----------------------------------------------------------------------------------------
// Courses passées (sur place, non annulées) dont la commission n'est pas encore saisie, sur les `jours` derniers jours : un jour
// sans ouvrir Gestion ne fait plus perdre la commission (audit du 13.11.2026, point 7). Les courses d'hier déjà saisies restent
// affichées avec leur montant, pour voir ce qui vient d'être fait. Triées de la plus ancienne à la plus récente.
// `netDe(r)` : la ligne privée de la réservation ({ commission_prevue, commission_recue, commission_recue_le }) ou null.
export const JOURS_COMMISSION = 14;
const jourAvant = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
export function commissionsADemander(reservations, ajd, { ecartes = new Set(), netDe = () => null, jours = JOURS_COMMISSION } = {}) {
  const hier = jourAvant(ajd, 1);
  const depuis = jourAvant(ajd, jours);
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
export const demandeDeTaxi = (texte, d) => !!d && d.type === "transfer" && d.mode !== "shared" && d.vehicule !== "speedboat" && /^\s*transfer request:/im.test(String(texte || ""));
// L'entreprise en mode taxi vers laquelle basculer, parmi celles que la personne peut ouvrir (null si aucune, ou si c'est déjà l'active).
export const entrepriseTaxi = (entites, reglagesDe, activeId) => entites.find((e) => e.id !== activeId && estTaxi(reglagesDe(e.id))) || null;
