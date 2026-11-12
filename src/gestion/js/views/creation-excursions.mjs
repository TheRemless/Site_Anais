// Création d'un dossier de Secret ou Taxi en une fois : le client, le dossier, la facture et une réservation par service.
// Partagé par l'écran « Nouveau dossier » et par la fenêtre « Coller une demande », qui crée sans passer par l'écran.
import { etat, inserer, modifier, reglages, nomPartenaire, numeroSuivant } from "../etat.mjs";
import { aujourdhui, nouvelleRef, sequenceRef, refDepuisNumero } from "../calc.mjs";
import { CONTENU_DEFAUT } from "../defauts.mjs";
import { descriptionService } from "../operations-calc.mjs";
import { creerReservations } from "./reservations.mjs";

// Les documents de Secret sont en anglais : les libellés anglais des prestations sont pris quand ils existent.
export const langueDocuments = (regl = reglages()) => (/invoice/i.test((regl.libelles && regl.libelles.facture) || "") ? "en" : "");

// Numéro de facture proposé pour le prochain dossier de l'entreprise.
export const refProposee = (regl = reglages()) => nouvelleRef({ numerotation: regl.numerotation, prenom: "", nom: "", dateIso: aujourdhui(), pays: "", refsExistantes: etat.db.dossiers.map((d) => d.ref) }) || "";

// Vrai si ce numéro est déjà pris par un autre dossier.
export const refExiste = (ref) => etat.db.dossiers.some((d) => d.ref === String(ref).trim());

// Numéro définitif : s'il n'a pas été modifié à la main, il vient de la base, qui ne le redonne jamais.
export async function refDefinitive(ref, propose, regl = reglages()) {
  if (ref !== propose || regl.numerotation.mode !== "sequence") return ref;
  const s = sequenceRef({ numerotation: regl.numerotation, dateIso: aujourdhui(), refsExistantes: etat.db.dossiers.map((x) => x.ref) });
  return refDepuisNumero(regl.numerotation, s.debut, await numeroSuivant(s.annee, s.dernier));
}

// `client` : { id } pour un client existant, sinon { prenom, nom, telephone, hotel, chambre } pour en créer un.
// `lignes` : lignes de facture (avec `description` et `description_fixe` éventuels, comme dans l'écran de création).
// `reservation` : { heure, lieu, bebes } posés sur chaque réservation créée (ce que le client a écrit, sans champ propre sur la facture).
export async function creerDossierExcursions({ client, lignes: brutes, notes = "", ref, reservation = {} }) {
  const regl = reglages();
  // `titre` : le nom court du service, qui sert aux réservations (une ligne adulte et sa ligne enfant en font une seule).
  const lignes = brutes.map((l) => (l.titre || l.kind === "texte" ? l : { ...l, titre: l.libelle }));
  const langue = langueDocuments(regl);
  let clientId = client.id;
  if (!clientId) {
    const adresse = [(client.hotel || "").trim(), (client.chambre || "").trim() ? `Room ${client.chambre.trim()}` : ""].filter(Boolean).join(", ");
    const c = await inserer("clients", { civilite: "", prenom: (client.prenom || "").trim(), nom: (client.nom || "").trim(), adresse, telephone: (client.telephone || "").trim(), email: "", notes: "" });
    clientId = c.id;
  }
  const dates = lignes.map((l) => l.date_service).filter(Boolean).sort();
  const services = lignes.filter((l) => l.kind !== "texte");
  const partenaires = [...new Set(services.map((l) => nomPartenaire(l.partenaire_id)).filter(Boolean))];
  const d = await inserer("dossiers", { ref: ref.trim(), client_id: clientId, pays: "", bandeau: services.filter((l) => !/,\s*(child|enfant)\b/i.test(l.libelle)).map((l) => l.libelle).join(" · ").slice(0, 120), date_depart: dates[0] || null, date_retour: dates.length > 1 ? dates[dates.length - 1] : null, accepte_le: aujourdhui(), annule: false, notes: notes.trim() });
  const contenu = { ...CONTENU_DEFAUT(), bandeau: "", colonnes: "total", langue, prestataire: partenaires.join(", "), variante: (regl.textes.variantes[0] || {}).id || "", equivalents: { actif: false }, lignes: lignes.map(({ description, description_fixe, ...l }) => ({ ...l, titre: l.kind === "texte" ? undefined : l.titre, libelle: l.kind === "texte" ? l.libelle : (description_fixe && description.trim()) || descriptionService({ ...l, libelle: l.titre }, langue), intro: "" })) };
  const doc = await inserer("documents", { dossier_id: d.id, type: "facture", date_emission: aujourdhui(), envoye_le: null, updated_at: new Date().toISOString(), contenu });
  await creerReservations(doc);
  // Heure, lieu de pickup, dépose, vol, bagages et bébés donnés par le client : posés sur les réservations qui viennent d'être créées
  // (la dépose, le vol et les bagages sont les champs du voucher de transfert).
  const { heure = "", lieu = "", bebes = 0, dropoff = "", vol = "", bagages = 0, personnes = null } = reservation;
  const details = { ...(dropoff ? { drop_off: dropoff } : {}), ...(vol ? { vol } : {}), ...(bagages ? { bagages: String(bagages) } : {}) };
  if (heure || lieu || bebes || personnes || Object.keys(details).length) {
    for (const r of etat.db.reservations.filter((x) => x.dossier_id === d.id)) {
      await modifier("reservations", r.id, { ...(heure ? { heure_pickup: heure } : {}), ...(lieu ? { lieu_pickup: lieu } : {}), ...(bebes || personnes ? { personnes: { ...(r.personnes || {}), ...(personnes && !((r.personnes || {}).adultes || (r.personnes || {}).enfants) ? { adultes: personnes.adultes, enfants: personnes.enfants } : {}), ...(bebes ? { bebes } : {}) } } : {}), ...(Object.keys(details).length ? { details: { ...(r.details || {}), ...details } } : {}) });
    }
  }
  return d;
}
