// Création d'une course payée au chauffeur en une fois (client, dossier, ligne de prix interne, réservation, voucher), dans l'entreprise active.
// Commune à l'écran « Nouveau voucher » de Mook (voucher-rapide.mjs) et à « Coller une confirmation » (confirmation.mjs, 18.11.2026).
// `x` : la course telle que donneesVoucher (voucher-rapide-calc.mjs) la rend. Taxi : le chauffeur réglé (Mr. Brown) ; Secret : un taxi
// indépendant, sans partenaire (décision de Jérémy, 18.11.2026), jamais un partenaire de Secret deviné par son nom.
import { etat, inserer, modifier, reglages, chargerDossier, modeTaxi, clientParId, clientEtranger } from "../etat.mjs";
import { uid } from "../defauts.mjs";
import { ligneVoucher, reservationVoucher, reservationApercu, partenaireDeTaxi, chauffeurRegle } from "../voucher-rapide-calc.mjs";
import { creerDossierExcursions, refProposee, refDefinitive } from "./creation-excursions.mjs";
import { vouchersDuDossier } from "./voucher.mjs";
import { nomARemplacer } from "../confirmation-calc.mjs";

export const partenaireCourse = () => (modeTaxi() ? partenaireDeTaxi(etat.db.partenaires, chauffeurRegle(reglages())) : null);
const independant = () => !modeTaxi();

// Le voucher d'un dossier tel que l'outil le numérote, avec son dossier et son client (la course voulue, sinon la dernière).
export function courseDuDossier(dossierId, reservationId = null) {
  const d = etat.db.dossiers.find((y) => y.id === dossierId) || {};
  const liste = vouchersDuDossier(dossierId);
  const v = (reservationId && liste.find((y) => y.reservation.id === reservationId)) || liste[liste.length - 1] || { reservation: null, index: 1 };
  const client = etat.db.clients.find((c) => c.id === d.client_id) || {};
  return { ...v, dossier: d, client, entite_id: d.entite_id || null };
}

// Le nom et le WhatsApp saisis passent sur la fiche du client ; un WhatsApp laissé vide n'efface pas celui qu'Anaïs a noté.
export async function majClientCourse(id, x) {
  const c = clientParId(id) || {};
  // Une fiche partagée par une autre entreprise (ZTP) garde son prénom et son nom : la confirmation écrit souvent « Mr Martin ».
  const patch = {
    // Un nom collé plus court (« Varrin » pour la fiche « Jean Varrin ») ne la renomme pas non plus.
    ...(!clientEtranger(c) && nomARemplacer([c.prenom, c.nom].filter(Boolean).join(" "), x.nom) ? { prenom: "", nom: x.nom } : {}),
    ...(x.telephone && x.telephone !== (c.telephone || "") ? { telephone: x.telephone } : {}),
  };
  if (Object.keys(patch).length) await modifier("clients", id, patch);
}

// Création en une fois. Le client (un client déjà connu, `x.clientId`, sinon un nouveau avec son WhatsApp s'il est donné), puis le dossier,
// sont gardés dans `essai` dès qu'ils existent : si la suite échoue, un second essai reprend là au lieu de créer des doublons.
// `notes` : la note interne du dossier (jamais imprimée). Renvoie courseDuDossier du dossier créé.
export async function creerCourse(x, essai, { notes = "" } = {}) {
  if (!essai.clientId && x.clientId && clientParId(x.clientId)) essai.clientId = x.clientId;
  if (!essai.clientId) essai.clientId = (await inserer("clients", { civilite: "", prenom: "", nom: x.nom, adresse: "", telephone: x.telephone, email: "", notes: "" })).id;
  else await majClientCourse(essai.clientId, x);
  const p = partenaireCourse();
  if (!essai.dossierId) {
    const propose = refProposee();
    const ref = await refDefinitive(propose, propose);
    essai.dossierId = (await creerDossierExcursions({ client: { id: essai.clientId }, lignes: [ligneVoucher(x, { id: uid(), partenaireId: p ? p.id : null })], notes, ref, parService: null, reservation: reservationVoucher(x, { independant: independant() }), silencieux: true })).id;
  } else if (!courseDuDossier(essai.dossierId).reservation) {
    // Dossier créé mais réservation refusée au premier essai : on ne pose que la réservation, liée à la ligne du prix interne.
    await chargerDossier(essai.dossierId);
    const doc = etat.db.documents.find((y) => y.dossier_id === essai.dossierId && y.type === "facture");
    const ligne = doc && (doc.contenu.lignes || []).find((l) => l.kind === "ligne");
    const r = reservationApercu(x, { independant: independant() });
    await inserer("reservations", { dossier_id: essai.dossierId, ligne_id: ligne ? ligne.id : null, prestation_id: null, trajet_id: null, partenaire_id: p ? p.id : null, libelle: r.libelle, date_service: r.date_service, heure_pickup: r.heure_pickup, lieu_pickup: r.lieu_pickup, personnes: r.personnes, statut: r.statut, reference_partenaire: "", montant_vente: r.montant_vente, notes: "", paye_sur_place: true, details: r.details });
  }
  const v = courseDuDossier(essai.dossierId);
  // creerReservations n'arrête pas la création quand la réservation échoue : on ne dit pas « créé » à tort.
  if (!v.reservation) throw new Error("reservation");
  return v;
}
