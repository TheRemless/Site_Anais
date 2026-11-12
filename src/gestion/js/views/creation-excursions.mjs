// Création d'un dossier de Secret ou Taxi en une fois : le client, le dossier, la facture et une réservation par service.
// Partagé par l'écran « Nouveau dossier » et par la fenêtre « Coller une demande », qui crée sans passer par l'écran.
import { etat, inserer, modifier, reglages, nomPartenaire, numeroSuivant } from "../etat.mjs";
import { estTaxi, lignesSurPlace } from "../taxi-calc.mjs";
import { aujourdhui, nouvelleRef, sequenceRef, refDepuisNumero } from "../calc.mjs";
import { CONTENU_DEFAUT } from "../defauts.mjs";
import { descriptionService } from "../operations-calc.mjs";
import { creerReservations } from "./reservations.mjs";

// Les documents de Secret sont en anglais : les libellés anglais des prestations sont pris quand ils existent.
export const langueDocuments = (regl = reglages()) => (estTaxi(regl) || /invoice/i.test((regl.libelles && regl.libelles.facture) || "") ? "en" : "");

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
// `parService` : [{ ligneIds, heure, lieu, bebes, dropoff, vol, bagages, personnes }], un par service avec les identifiants de ses lignes : chaque réservation prend
// ce qui concerne SON service (dates, heures et lieux différents dans un même dossier). Sans lui, `reservation` vaut pour toutes.
// `silencieux` : pas de message de réussite (l'écran « Nouveau voucher », en thaï, dit lui-même ce qui s'est passé).
export async function creerDossierExcursions({ client, lignes: brutes, notes = "", ref, reservation = {}, parService = null, silencieux = false }) {
  const regl = reglages();
  // `titre` : le nom court du service, qui sert aux réservations (une ligne adulte et sa ligne enfant en font une seule).
  // Taxi : tout est payé au chauffeur, quelle que soit la ligne (même une course saisie à la main, sans partenaire).
  const lignes = (estTaxi(regl) ? lignesSurPlace(brutes) : brutes).map((l) => (l.titre || l.kind === "texte" ? l : { ...l, titre: l.libelle }));
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
  await creerReservations(doc, { silencieux });
  // Heure, lieu de pickup, dépose, vol, bagages et bébés donnés par le client : posés sur les réservations qui viennent d'être créées
  // (la dépose, le vol et les bagages sont les champs du voucher de transfert).
  const patch = (r, { heure = "", lieu = "", bebes = 0, dropoff = "", vol = "", bagages = 0, personnes = null, zonePickup = null }) => {
    // `zonePickup` : la zone de l'hôtel choisie sur la grille du partenaire, gardée pour proposer la même zone au prochain séjour dans cet hôtel.
    const details = { ...(dropoff ? { drop_off: dropoff } : {}), ...(vol ? { vol } : {}), ...(bagages ? { bagages: String(bagages) } : {}), ...(zonePickup ? { pickup_zone: zonePickup } : {}) };
    const dejaDesGens = (r.personnes || {}).adultes || (r.personnes || {}).enfants;
    return {
      ...(heure ? { heure_pickup: heure } : {}),
      ...(lieu ? { lieu_pickup: lieu } : {}),
      ...(bebes || personnes ? { personnes: { ...(r.personnes || {}), ...(personnes && !dejaDesGens ? { adultes: personnes.adultes, enfants: personnes.enfants } : {}), ...(bebes ? { bebes } : {}) } } : {}),
      ...(Object.keys(details).length ? { details: { ...(r.details || {}), ...details } } : {}),
    };
  };
  const reservations = etat.db.reservations.filter((x) => x.dossier_id === d.id);
  for (const r of reservations) {
    const lies = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])]);
    const propre = parService ? parService.find((sv) => sv.ligneIds.some((id) => lies.has(id))) : reservation;
    const champs = propre ? patch(r, propre) : {};
    if (Object.keys(champs).length) await modifier("reservations", r.id, champs);
  }
  return d;
}
