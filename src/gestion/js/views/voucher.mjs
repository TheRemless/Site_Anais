// Vouchers de Secret Travel & Tour : une page A4 par réservation, remise au client et au prestataire une fois payé.
// Cinq modèles d'après les documents d'Anaïs : Boat Ticket, Boat Tour, Transfer, Activity & Tour, Rental. Toujours en anglais.
// Les intitulés se règlent dans Réglages > Vouchers (textes-voucher.mjs). Ce qui a été envoyé se fige (operations-calc.mjs, voucherFige) :
// le numéro, le modèle et ce que le voucher lisait dans la prestation, le trajet et la fiche du partenaire ne changent plus avec le catalogue.
import { etat, reglages, entiteActive, imprimer, nomPartenaire, partenaireDe, resumeDossier, organisationActiveId } from "../etat.mjs";
import { voucherExempleDonnees } from "../exemples.mjs";
import { h } from "../ui.mjs";
import { formatDate, formatNombre, aujourdhui } from "../calc.mjs";
import { rolesDuService, optionsVoucher, typeVoucherDeduit, modeleChoisi, numeroVoucher, numerosVouchers, statutPaiementVoucher, prixParPersonneVoucher, hebergementVoucher, empreinteVoucher, voucherFige, valeursFigees, SANS_VOUCHER, estPrive, fraisDeParc, typeTransfert, dateTexte, remplirGabarit, embarcadereFiche, consigneCheckinFiche, estTarifZone, estPickupHotel, bateauEtQuai, horairesTexte, dureeTexte, nbJoursLocation, categorieVehicule, moteurTexte, siegesVoucher, pickupDepuisLibelle, dropOffDepuisLibelle } from "../operations-calc.mjs";
import { libelleClient, modeEn } from "../partenaires-calc.mjs";
import { estTaxi, estBookingSecret, estBookingConfirmation, bagagesBooking, volDejaDans } from "../taxi-calc.mjs";
import { estRetourDepart, dureeAnglais } from "../trajet-calc.mjs";
import { textesVoucher } from "../textes-voucher.mjs";
import { prestationEnfant } from "../demande-calc.mjs";
import { renderBookingConfirmation, ajusterHorsEcran } from "./voucher-taxi.mjs";
import { renderBookingSecret } from "./voucher-secret.mjs";

const case_ = (coche, libelle) => h("span", { class: `v-case${coche ? " cochee" : ""}` }, h("span", { class: "v-carre", "aria-hidden": "true" }, coche ? "☒" : "☐"), ` ${libelle}`);
const ligne = (libelle, valeur, ...suite) => h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, `${libelle}: `), valeur === null || valeur === undefined ? "" : String(valeur), ...suite);
// Une ligne facultative ne s'imprime que remplie (Jérémy, 14.11.2026 : « si des champs sont vides, ils ne doivent pas apparaître, sauf les
// champs obligatoires pour la prestation »). Les obligatoires gardent `ligne` et restent à compléter à la main s'ils sont vides.
const rempli = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const ligneSi = (libelle, valeur, ...suite) => (rempli(valeur) ? ligne(libelle, valeur, ...suite) : null);
const cleEnLigne = (libelle, valeur) => (rempli(valeur) ? [h("span", { class: "v-espace" }), h("span", { class: "v-cle" }, `${libelle}: `), String(valeur)] : []);
const prix = (n, devise) => (n === null || n === undefined || n === "" ? "" : `${devise} ${formatNombre(n)}`);

// ---- Ce que le voucher lit hors de la réservation ---------------------------------------------------------------------------------
// La prestation, le trajet et la fiche du partenaire, réduits à ce qui s'imprime (jamais de net) : ce qui se fige à l'envoi.
const sansNets = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !/net|commission/i.test(k)));
const extraitPrestation = (p) => (p ? { libelle: p.libelle || "", libelle_en: p.libelle_en || "", famille: p.famille || "", groupe: p.groupe || "", unite: p.unite || "", prix_vente: p.prix_vente ?? null, details: sansNets(p.details) } : null);
const extraitTrajet = (t) => (t ? { de: t.de || "", vers: t.vers || "", depart: t.depart || "", arrivee: t.arrivee || "", mode: t.mode || "" } : null);
// Règles de la fiche (migration 43) : la consigne « passeport » et les tarifs par zone se figent avec le reste.
const extraitPartenaire = (p) => (p ? { nom: p.nom || "", contact: { embarcadere: (p.contact && p.contact.embarcadere) || "" }, regles: { points_embarquement: (p.regles && p.regles.points_embarquement) || [], checkin_voucher: (p.regles && p.regles.checkin_voucher) || "" }, checkin_passeport: p.checkin_passeport || "", tarif_zone: !!p.tarif_zone } : null);
// Fiche figée avant la migration 43 : ses consignes venaient alors du nom de la compagnie. Elle prend celles que la migration a écrites sur
// la fiche actuelle (consigne de check-in quand la figée était vide, consigne « passeport », tarifs par zone) : le voucher renvoyé reste le même.
export const completerFigee = (fige, live) => {
  if (!fige || "checkin_passeport" in fige || !live) return fige;
  const l = extraitPartenaire(live);
  return { ...fige, regles: { ...(fige.regles || {}), checkin_voucher: (fige.regles && fige.regles.checkin_voucher) || l.regles.checkin_voucher }, checkin_passeport: l.checkin_passeport, tarif_zone: l.tarif_zone };
};

// Les sources d'un voucher : celles figées au premier envoi quand la réservation porte encore le même service, sinon celles de la base.
export function sourcesVoucher(r, prestationLive) {
  const live = { prestation: prestationLive || null, trajet: r.trajet_id ? etat.db.trajets.find((t) => t.id === r.trajet_id) || null : null, partenaire: partenaireDe(r.partenaire_id) || null, modele: null };
  const f = valeursFigees(r);
  if (!f) return live;
  return { prestation: "prestation" in f ? f.prestation : live.prestation, trajet: "trajet" in f ? f.trajet : live.trajet, partenaire: "partenaire" in f ? completerFigee(f.partenaire, live.partenaire) : live.partenaire, modele: f.modele || null };
}

// Modèle du voucher : celui choisi sur la réservation, sinon celui figé à l'envoi, sinon la déduction. Taxi : toujours la Booking confirmation.
function modeleDe(r, sources, taxi) {
  const choisi = modeleChoisi(r);
  if (choisi) return choisi === SANS_VOUCHER ? null : choisi;
  return sources.modele || typeVoucherDeduit(r, sources.prestation, sources.partenaire, sources.trajet) || (taxi ? "transfert" : null);
}

// Les réservations qui ont un voucher, dans l'ordre de création. Le numéro (1, 2, 3 après la référence du dossier) se calcule avant d'écarter
// les annulées, et un numéro déjà envoyé ne change plus (audit n° 25). Un dossier annulé n'a plus de voucher à proposer (audit n° 28).
// Chaque voucher porte `envoi` : { le, modifie, empreinte } (modifié : ce qu'il imprime a changé depuis l'envoi, audit n° 24).
export function vouchersDuDossier(dossierId) {
  const d = etat.db.dossiers.find((x) => x.id === dossierId) || null;
  if (d && d.annule) return [];
  const taxi = estTaxi(reglages());
  const base = etat.db.reservations
    .filter((r) => r.dossier_id === dossierId)
    .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "") || a.libelle.localeCompare(b.libelle))
    .map((r) => {
      const prestation = r.prestation_id ? etat.db.prestations.find((p) => p.id === r.prestation_id) || null : null;
      return { reservation: r, prestation, type: modeleDe(r, sourcesVoucher(r, prestation), taxi) };
    })
    .filter((x) => x.type);
  const indexFige = (r) => (r.details && r.details.voucher_fige && r.details.voucher_fige.index) || null;
  // Un numéro envoyé reste pris même si son service n'a plus de voucher (« Pas de voucher » choisi après l'envoi) : il n'est jamais redonné.
  const horsListe = etat.db.reservations.filter((r) => r.dossier_id === dossierId && indexFige(r) && !base.some((x) => x.reservation.id === r.id)).map((r) => ({ fige: indexFige(r) }));
  const index = numerosVouchers([...base.map((x) => ({ fige: indexFige(x.reservation) })), ...horsListe]);
  // L'empreinte ne se calcule que pour les vouchers déjà envoyés : la liste des réservations appelle cette fonction pour chaque carte.
  const empreinteDe = empreinteDuDossier(d);
  return base
    .map((x, i) => {
      const r = x.reservation;
      const fige = (r.details && r.details.voucher_fige) || null;
      const le = (r.details && r.details.envois && r.details.envois.client) || null;
      const empreinte = le && fige ? empreinteDe(r) : null;
      return { ...x, index: index[i], numero: (fige && fige.numero) || numeroVoucher((d && d.ref) || "", index[i]), envoi: { le, empreinte, modifie: !!(empreinte && fige.empreinte && fige.empreinte !== empreinte) } };
    })
    .filter((x) => x.reservation.statut !== "annule");
}

// L'empreinte d'un voucher du dossier `d` : le client et le résumé (statut de paiement, devise) ne se lisent qu'une fois, au premier besoin.
// Les lignes de facture d'un service (ses options comprises), et le texte « Options » que son voucher imprime. Le même texte entre dans
// l'empreinte : une option ajoutée, retirée, offerte ou échangée fait repasser le voucher « à renvoyer » (relecture de la PR 359).
function lignesDuVoucher(r) {
  const ids = new Set([r.ligne_id, ...(((r.details || {}).lignes_ids) || [])].filter(Boolean));
  return r.dossier_id && etat.db ? (etat.db.documents || []).filter((x) => x.dossier_id === r.dossier_id && x.type !== "devis").flatMap((x) => (x.contenu && x.contenu.lignes) || []).filter((l) => ids.has(l.id)) : [];
}
function extrasDuVoucher(r, lignes = lignesDuVoucher(r)) {
  const prestationDe = (id) => (etat.db ? etat.db.prestations.find((x) => x.id === id) : null) || null;
  const deLignes = optionsVoucher(lignes, prestationDe);
  // Un service ajouté par une carte « reservation » n'a pas de ligne de facture : ses options sont sur la réservation (details.options).
  return (deLignes.length ? deLignes : (Array.isArray((r.details || {}).options) ? r.details.options : []).map((o) => ((prestationDe(o.prestation_id) || {}).libelle_en || libelleClient(o.libelle || "")))).filter(Boolean).join(", ");
}
// Ce qui, des options, change le voucher : leur nom (imprimé) et leur prix (une option offerte ou échangée au même total).
function empreinteOptions(r) {
  const lignes = lignesDuVoucher(r).filter((l) => l.option_de && l.kind !== "texte");
  const deDetails = Array.isArray((r.details || {}).options) ? r.details.options : [];
  if (!lignes.length && !deDetails.length) return "";
  return `${extrasDuVoucher(r)}|${[...lignes.map((l) => `${l.prestation_id}:${l.unite ?? ""}:${l.qte ?? ""}:${l.montant ?? ""}`), ...deDetails.map((o) => `${o.prestation_id}:${o.prix ?? ""}`)].join(",")}`;
}
function empreinteDuDossier(d) {
  let ctx = null;
  return (r) => {
    if (!ctx) {
      const res = d ? resumeDossier(d.id) : null;
      ctx = { client: (d && etat.db.clients.find((c) => c.id === d.client_id)) || {}, res, devise: (res && res.devise) || reglages().devise || "THB" };
    }
    return empreinteVoucher({ reservation: r, client: ctx.client, statut: statutPaiementVoucher({ ...(ctx.res || {}), surPlace: !!r.paye_sur_place }), devise: ctx.devise, options: empreinteOptions(r) });
  };
}

// La trace à poser sur la réservation quand son voucher part (premier envoi ou renvoi) : `x` vient de vouchersDuDossier.
export function figerVoucher(x, date = aujourdhui()) {
  const r = etat.db.reservations.find((y) => y.id === x.reservation.id) || x.reservation;
  const taxi = estTaxi(reglages());
  const src = sourcesVoucher(r, x.prestation);
  const modele = src.modele || typeVoucherDeduit(r, src.prestation, src.partenaire, src.trajet) || (taxi ? "transfert" : null);
  const valeurs = { modele, prestation: extraitPrestation(src.prestation), trajet: extraitTrajet(src.trajet), partenaire: extraitPartenaire(src.partenaire) };
  const d = etat.db.dossiers.find((y) => y.id === r.dossier_id) || null;
  return voucherFige({ reservation: r, index: x.index, numero: x.numero, empreinte: empreinteDuDossier(d)(r), valeurs, date, avant: (r.details && r.details.voucher_fige) || null });
}

// `contexte` (facultatif) : réglages, dossier, client et résumé à utiliser à la place de la base, pour l'aperçu des réglages.
export function renderVoucher({ reservation: r, prestation: pLive, type, index, numero: numeroFige }, contexte = {}) {
  const regl = contexte.reglages || reglages();
  const t = textesVoucher(regl);
  const d = contexte.dossier || etat.db.dossiers.find((x) => x.id === r.dossier_id) || {};
  const client = contexte.client || etat.db.clients.find((c) => c.id === d.client_id) || {};
  const res = contexte.resume !== undefined ? contexte.resume : d.id ? resumeDossier(d.id) : null;
  const e = regl.emetteur;
  const v = regl.voucher || {};
  // En-tête : les champs du bloc Vouchers des réglages, sinon ceux de l'entreprise.
  const nomSociete = v.nom || e.nom || entiteActive().nom;
  const sousTitre = v.sous_titre || e.sous_titre || "";
  const adresse = (v.adresse || e.adresse || "").split("\n").map((l) => l.trim()).filter(Boolean).join(", ");
  const whatsapp = v.whatsapp || e.telephone || "";
  const email = v.email || ((e.contact || "").match(/[\w.+-]+@[\w.-]+\.\w+/) || [""])[0];
  // Les détails saisis sur la réservation passent avant ce que l'on déduit de la prestation, du trajet et de la fiche du partenaire (figés à l'envoi).
  const dt = r.details || {};
  const src = contexte.reglages && !r.id ? { prestation: pLive, trajet: null, partenaire: null } : sourcesVoucher(r, pLive);
  const p = src.prestation;
  const trajet = contexte.trajet || src.trajet;
  const compagnie = src.partenaire;
  // Voucher en anglais : le libellé anglais de la prestation quand la réservation porte encore le nom d'origine de la base (français ou déjà traduit),
  // sinon le nom saisi sur la réservation, passé par la traduction.
  const brut = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  // Un service à rôles (ATV) dit au partenaire combien de conducteurs et de passagers : « P3: ATV 1h + Kayak 1h, 1 driver + 1 passenger » (19.11.2026).
  const nomService = p && p.libelle_en && [p.libelle, p.libelle_en].some((x) => brut(x) === brut(r.libelle)) ? p.libelle_en : libelleClient(r.libelle);
  // La composition se relit sur la facture (une ligne de passager retirée ou changée la suit), sinon celle gardée à la création.
  const lignesService = lignesDuVoucher(r);
  // Les rôles (conducteur, passager) se lisent sur les lignes du service, jamais sur ses options.
  const lignesRoles = lignesService.filter((l) => !l.option_de);
  const roles = lignesRoles.length ? rolesDuService(lignesRoles) : dt.roles || "";
  const titrePrestation = roles && !brut(nomService).includes(brut(roles)) ? `${nomService}, ${roles}` : nomService;
  // Les options du service (26.11.2026) : une ligne « Options » en anglais, sans prix ni partenaire (le prix total les comprend).
  // Un service ajouté par une carte « reservation » n'a pas de ligne de facture : ses options sont sur la réservation (details.options).
  const extras = extrasDuVoucher(r, lignesService);
  const ligneOptions = ligneSi(t("options"), extras);
  // Billet : ce qui est saisi sur la réservation passe avant le trajet de la base ; sans trajet (partenaire ajouté à la main), seulement la saisie
  // et un libellé « A → B ». L'heure de pickup n'est jamais prise pour l'heure de départ du bateau quand le pickup s'imprime à part.
  const dBillet = { de: libelleClient(dt.de || (trajet && trajet.de) || pickupDepuisLibelle(r, p, trajet)), vers: libelleClient(dt.vers || (trajet && trajet.vers) || dropOffDepuisLibelle(r, p)), depart: dt.depart || (trajet && trajet.depart) || (trajet ? r.heure_pickup || "" : ""), arrivee: dt.arrivee || (trajet && trajet.arrivee) || "", mode: dt.bateau || (trajet && trajet.mode ? modeEn(trajet.mode) : "") };
  // Embarcadère et check-in : la saisie, puis la fiche de la compagnie (audit n° 48), puis les consignes écrites dans l'outil.
  const embarquement = dt.embarquement || embarcadereFiche(compagnie, dBillet.de) || (trajet ? r.lieu_pickup || "" : "");
  const pickupInclus = !!(r.heure_pickup || r.lieu_pickup) && (!!trajet || !!r.lieu_pickup);
  // Quand la compagnie vient chercher le client à l'hôtel, pas de comptoir : il doit être prêt dans le hall.
  const checkin = dt.checkin || (estPickupHotel(embarquement) || (!trajet && !embarquement && r.lieu_pickup) ? t("lobby") : consigneCheckinFiche(compagnie || partenaireDe(r.partenaire_id), dBillet, regl.destinations_passeport));
  const bq = bateauEtQuai(p);
  const bateauTexte = dt.bateau || bq.bateau;
  // La capacité du bateau ne s'imprime plus sur le voucher (Jérémy, 13.11.2026) : elle reste dans la fiche de la prestation.
  const horaires = horairesTexte(p && p.details && p.details.horaires);
  const duree = dureeTexte(p && p.details && p.details.duree);
  // Le programme ne s'imprime que s'il a été saisi : le groupe de la base (« Cours de cuisine ») n'apprend rien au client.
  const programme = dt.programme || "";
  const devise = (res && res.devise) || regl.devise || "THB";
  const nomClient = [client.prenom, client.nom].filter(Boolean).join(" ");
  // L'hébergement du client : saisi sur la réservation, sinon la fiche client ; jamais le lieu de pickup (hebergementVoucher).
  // Fiche partagée par une autre entreprise (ZTP sur un service de Secret ou de Taxi, PR 234) : son adresse est postale, jamais un hôtel.
  // L'entreprise du service : celle de la réservation, sinon du dossier, sinon l'entreprise ouverte.
  const { hotel, chambre } = hebergementVoucher(client, { ...r, entite_id: r.entite_id || d.entite_id || etat.entiteId });
  const statut = statutPaiementVoucher({ ...(res || {}), surPlace: !!r.paye_sur_place });
  const parcAuto = fraisDeParc(p);
  const parc = dt.parc === "aucun" ? { inclus: null, texte: "" } : dt.parc === "inclus" ? { inclus: true, texte: dt.parc_texte || "" } : dt.parc === "non" ? { inclus: false, texte: dt.parc_texte || parcAuto.texte } : { ...parcAuto, texte: dt.parc_texte || parcAuto.texte };
  const prive = dt.type_tour ? dt.type_tour === "prive" : estPrive(p, r);
  // Un trajet du catalogue vendu à la place : « Shared minivan » d'office (typeTransfert), sauf choix posé sur la réservation.
  const transfert = dt.type_transfert || typeTransfert(p, r, trajet);
  const pers = r.personnes || {};
  const a = Number(pers.adultes) || 0;
  const en_ = Number(pers.enfants) || 0;
  const operateur = libelleClient(compagnie ? compagnie.nom : nomPartenaire(r.partenaire_id));
  // Course d'un taxi indépendant vendue sous le logo de Secret (voucher rapide, 18.11.2026) : pas de partenaire, pas de ligne « Operator » vide.
  // Sans partenaire ni compagnie, pas de ligne « Company / Operator » vide (INV-2026-035, 18.11.2026), comme pour un taxi indépendant.
  const ligneOperateur = ligneSi(t("operateur"), operateur);
  // La référence du partenaire s'imprime dans Remarks : l'aide du champ le dit (audit n° 61).
  const remarques = [dt.remarques, r.reference_partenaire ? `${t("ref_operateur")} ${r.reference_partenaire}` : ""].filter(Boolean).join(" · ");
  const dropOff = libelleClient(dt.drop_off || dropOffDepuisLibelle(r, p, trajet));
  // Un transfert « Pakbara Pier → Hat Yai Airport » part du quai, pas de l'hôtel du client.
  // Tarifs par zone (case de la fiche du partenaire) : pas de départ fixe, le pickup et le drop-off se remplissent à la main.
  const tarifZone = estTarifZone(p, (pLive && partenaireDe(pLive.partenaire_id)) || compagnie || partenaireDe(r.partenaire_id));
  // Retour au point de départ : jamais le premier bout d'un libellé « A → B » (un aéroport où le client ne sera pas), sinon l'hôtel du client.
  const pickupTransfert = r.lieu_pickup || (estRetourDepart(r) ? hotel : libelleClient(pickupDepuisLibelle(r, p, trajet)) || (tarifZone ? "" : hotel));
  // Un trajet du catalogue : son heure de départ s'imprime sur une ligne à part (« Departure Time »), jamais à la place de l'heure de
  // pickup (contre-relecture de la PR 337 : INV-2026-047 partait à 08:00 avec un pickup à 07:15). Sans heure saisie, « Pickup Time » reste
  // vide et la fiche le signale.
  const departTrajet = r.trajet_id && trajet && trajet.depart ? trajet.depart : "";
  // Retour au point de départ (16.11.2026) : « Pickup and return », le programme et la durée à la place du drop-off, jamais « From X to X ».
  const retourDepart = estRetourDepart(r);
  const programmeTrajet = retourDepart ? String(dt.programme_trajet || "").trim() : "";
  const dureeTrajet = retourDepart ? dureeAnglais(dt.duree_h) : "";
  // Le numéro de vol (21.11.2026) : imprimé seulement s'il est rempli, et pas une seconde fois s'il est déjà écrit dans le pickup ou le
  // drop-off (« Krabi Airport, flight FD3217 »). Jamais déduit des notes internes, plus de ligne vide parce que le libellé parle d'aéroport.
  const volTexte = String(dt.vol || "").trim();
  const avecVol = !!volTexte && !volDejaDans(pickupTransfert, volTexte) && !volDejaDans(retourDepart ? "" : dropOff, volTexte);
  const bagages = dt.bagages || "";
  // Sur les vouchers de Secret, la même lecture que la ligne LUGGAGE de la Booking confirmation : « 3 pieces », « Yes », jamais « yes ».
  const bagagesTexte = bagagesBooking(bagages);
  const remarquesPaiement = dt.remarques_paiement || "";
  // Prix par personne : seulement s'il n'y a qu'un tarif connu (audit n° 27), jamais une moyenne.
  // Tarif enfant : celui de la prestation (prix enfant) ou une ancienne prestation enfant séparée, cherchée sur la prestation de la base.
  const tarifEnfant = en_ > 0 && p && ["pp", "ad"].includes(p.unite) ? prestationEnfant(pLive && pLive.unite === p.unite ? pLive : p, etat.db.prestations) : null;
  const prixPersonne = prixParPersonneVoucher({ prestation: p, montant: r.montant_vente, adultes: a, enfants: en_, tarifEnfant });
  const nb = (n) => String(Number(n) || 0);
  // Aucune personne connue (un bateau, un véhicule ou un groupe facturé à la pièce) : les cases restent à remplir, pas de « 0 » ni de nombre inventé.
  const sansPersonnes = a + en_ + (Number(pers.bebes) || 0) === 0;
  const nbp = (n) => (sansPersonnes ? "" : nb(n));
  // Location : jours (saisis par les dates de prise et de retour, sinon la quantité de la facture), catégorie et cylindrée de la prestation, tarif du jour.
  const jours = type === "location" ? nbJoursLocation(r.date_service, dt.retour_date) || Number(dt.jours) || null : null;
  const typeVehicule = type === "location" ? [categorieVehicule(p), moteurTexte(p)].filter(Boolean).join(", ") : "";
  const tarifJour = jours && Number(r.montant_vente) > 0 ? Math.round((Number(r.montant_vente) / jours) * 100) / 100 : null;

  // VIP Taxi Lanta : la « Booking confirmation » de son modèle, pas les vouchers de Secret.
  // Secret : un transfert payé au chauffeur sans partenaire (taxi indépendant) a sa propre Booking confirmation (18.11.2026).
  if (estBookingSecret(r, type, regl)) return renderBookingSecret({ regl, client, r, options: extras, pickup: pickupTransfert, dropoff: dropOff, bagages, devise, whatsapp, nomSociete, retour: retourDepart ? { programme: programmeTrajet, duree: dureeTrajet } : null });
  if (estTaxi(regl)) return renderBookingConfirmation({ regl, client, r, options: extras, pickup: pickupTransfert, dropoff: dropOff, bagages, devise, whatsapp, email, adresse, nomSociete, retour: retourDepart ? { programme: programmeTrajet, duree: dureeTrajet } : null });

  const cle = (texte) => h("span", { class: "v-cle" }, `${texte}: `);
  const espace = () => h("span", { class: "v-espace" });
  const passagers = (libelle, avecBebes = false) => ligne(libelle, "", cle(t("adultes")), nbp(a), espace(), cle(t("enfants")), nbp(en_), ...(avecBebes ? [espace(), cle(t("bebes")), nbp(pers.bebes)] : []));
  // Statut du paiement : les trois cases du modèle d'Anaïs ; « Payment Pending » s'ajoute seulement quand c'est le cas (rien reçu, pas payé sur place).
  const statutPaiement = (paye, surPlace) => h("p", { class: "v-ligne" }, cle(t("statut_paiement")), case_(statut === "paye", paye), " ", case_(statut === "acompte", t("acompte")), " ", case_(statut === "sur_place", surPlace), ...(statut === "en_attente" ? [" ", case_(true, t("en_attente"))] : []));

  const booking =
    type === "billet"
      ? [ligne(t("route"), [dBillet.de, dBillet.vers].some(Boolean) ? `${dBillet.de} → ${dBillet.vers}` : ""), ligneOptions, ligne(t("date_trajet"), dateTexte(r.date_service, "en")), ligne(t("heure_depart"), dBillet.depart, ...cleEnLigne(t("heure_arrivee"), dBillet.arrivee)), ligneSi(t("bateau"), dBillet.mode), ligne(t("compagnie"), operateur), ligneSi(t("embarcadere"), embarquement), pickupInclus ? ligne(t("pickup_hotel"), [r.lieu_pickup, r.heure_pickup ? `${t("a_heure")} ${r.heure_pickup}` : ""].filter(Boolean).join(" ")) : null, passagers(t("passagers"), Number(pers.bebes) > 0 || sansPersonnes), ligneSi(t("bagages"), bagagesTexte), ligneSi(t("remarques"), remarques)]
      : type === "bateau"
      ? [ligne(t("nom_tour"), titrePrestation), ligneOptions, ligne(t("date"), dateTexte(r.date_service, "en")), horaires ? ligne(t("horaires"), horaires) : null, bateauTexte ? ligne(t("bateau"), bateauTexte) : null, bq.quai ? ligne(t("quai"), bq.quai) : null, ligne(t("heure_pickup"), r.heure_pickup), ligne(t("lieu_pickup"), r.lieu_pickup || hotel), passagers(t("passagers")), h("p", { class: "v-ligne" }, cle(t("type_tour")), case_(!prive, t("join")), " ", case_(prive, t("prive"))), ligneOperateur, ligneSi(t("remarques"), remarques)]
      : type === "transfert"
        ? [ligne(t("date"), dateTexte(r.date_service, "en")), ligneOptions, ligne(t("heure_pickup"), r.heure_pickup), ligneSi(t("heure_depart"), departTrajet), ...(retourDepart ? [ligne(t("pickup_retour"), pickupTransfert), ligne(t("programme_trajet"), programmeTrajet), ligneSi(t("duree"), dureeTrajet)] : [ligne(t("lieu_pickup"), pickupTransfert), ligne(t("drop_off"), dropOff)]), avecVol ? ligne(t("vol"), volTexte) : null, ligne(t("passagers"), "", cle(t("adultes")), nbp(a), espace(), cle(t("enfants")), nbp(en_), siegesVoucher(dt), ...cleEnLigne(t("bagages"), bagagesTexte)), h("p", { class: "v-ligne" }, cle(t("type_transfert")), ...[["taxi", t("taxi_prive")], ["minivan", t("minivan_prive")], ["partage", t("minivan_partage")]].flatMap(([k, l]) => [case_(transfert === k, l), " "])), ligneOperateur, ligneSi(t("remarques"), remarques)]
        : type === "location"
          ? [ligne(t("vehicule"), titrePrestation), ligneOptions, typeVehicule ? ligne(t("type_moteur"), typeVehicule) : null, ligne(t("prise"), [dateTexte(r.date_service, "en"), r.heure_pickup].filter(Boolean).join(", ")), ligne(t("lieu_pickup"), r.lieu_pickup || hotel), ligne(t("retour"), [dateTexte(dt.retour_date, "en"), dt.retour_heure].filter(Boolean).join(", ")), ligne(t("lieu_retour"), dt.retour_lieu || r.lieu_pickup || hotel), jours ? ligne(t("duree_location"), `${jours} ${jours > 1 ? t("jours") : t("jour")}`) : null, ligne(t("conducteur"), nomClient), ligneSi(t("permis"), dt.permis), ligneSi(t("equipement"), dt.equipement), ligneOperateur, ligneSi(t("remarques"), remarques)]
          : [ligne(t("activite"), titrePrestation), ligneOptions, programme ? ligne(t("programme"), programme) : null, ligne(t("date_heure"), [dateTexte(r.date_service, "en"), dt.heure_service || horaires].filter(Boolean).join(", ")), duree ? ligne(t("duree"), duree) : null, ligneSi(t("heure_pickup"), r.heure_pickup), ligneSi(t("lieu_pickup"), r.lieu_pickup || hotel), passagers(t("invites")), ligneOperateur, ligneSi(t("remarques"), remarques)];

  const paiement =
    type === "billet"
      ? [ligne(t("prix_total"), prix(r.montant_vente, devise)), statutPaiement(t("paye"), t("sur_place_billet")), ligneSi(t("remarques"), remarquesPaiement)]
      : type === "bateau"
      ? [ligne(t("prix_total"), prix(r.montant_vente, devise)), parc.inclus === null || parc.inclus === undefined ? null : h("p", { class: "v-ligne" }, cle(t("parc")), case_(parc.inclus === true, t("parc_inclus")), " ", case_(parc.inclus === false, t("parc_non_inclus")), parc.inclus === false && parc.texte ? `: ${parc.texte}` : ""), statutPaiement(t("paye"), t("sur_place_bateau")), ligneSi(t("remarques"), remarquesPaiement)]
      : type === "transfert"
        ? [ligne(t("prix_total"), prix(r.montant_vente, devise)), statutPaiement(t("paye"), t("sur_place_transfert")), ligneSi(t("remarques"), remarquesPaiement)]
        : type === "location"
          ? [tarifJour ? ligne(t("tarif_jour"), prix(tarifJour, devise)) : null, ligne(t("prix_total"), prix(r.montant_vente, devise)), ligneSi(t("caution"), dt.caution), statutPaiement(t("paye"), t("sur_place_activite")), ligneSi(t("remarques"), remarquesPaiement)]
          : [prixPersonne !== null ? ligne(t("prix_personne"), prix(prixPersonne, devise)) : null, ligne(t("montant_total"), prix(r.montant_vente, devise)), statutPaiement(t("paye_tout"), t("sur_place_activite")), ligneSi(t("remarques"), remarquesPaiement)];

  const merci = remplirGabarit(((type === "transfert" || type === "billet") && v.merci_transfert) || v.merci || "Thank you for booking with {entreprise}!\nWe wish you a wonderful day.", { entreprise: nomSociete });
  const numero = numeroFige || numeroVoucher(d.ref || "", index);
  return h(
    "div",
    { class: "voucher" },
    h("div", { class: "v-tete" }, h("span", null, `${t("numero")}: ${numero}`), h("span", null, `${t("date_emission")}: ${formatDate(aujourdhui())}`)),
    h(
      "div",
      { class: "v-entete" },
      regl.apparence.logo ? h("img", { class: "v-logo", src: regl.apparence.logo, alt: "" }) : null,
      h("div", { class: "v-societe" }, h("p", { class: "v-nom" }, nomSociete), sousTitre ? h("p", { class: "v-par" }, sousTitre) : null, h("p", null, adresse), (v.licence || e.licence) ? h("p", null, `${t("licence")}: ${v.licence || e.licence}`) : null, h("p", null, `${t("whatsapp")}: ${whatsapp}`), h("p", null, `${t("email")}: ${email}`))
    ),
    h("h1", { class: "v-titre" }, t(`titre_${type}`)),
    h("section", null, h("h2", null, t("rubrique_client")), ligne(t("nom_client"), nomClient), ligneSi(t("telephone"), client.telephone), type === "transfert" || type === "billet" ? null : rempli(hotel) || rempli(chambre) ? ligne(t("hotel"), hotel, ...cleEnLigne(t("chambre"), chambre)) : null),
    h("section", null, h("h2", null, t("rubrique_reservation")), ...booking),
    h("section", null, h("h2", null, t("rubrique_paiement")), ...paiement),
    type === "transfert" && v.note_transfert ? h("p", { class: "v-note" }, ...v.note_transfert.split("\n").flatMap((l, i) => (i ? [h("br"), l] : [l]))) : null,
    type === "billet" && checkin ? h("p", { class: "v-note" }, h("strong", null, `${t("checkin")}: `), checkin) : null,
    type === "location" && dt.conditions ? h("p", { class: "v-note" }, h("strong", null, `${t("conditions_location")}: `), dt.conditions) : null,
    h("p", { class: "v-merci" }, ...merci.split("\n").flatMap((l, i) => (i ? [h("br"), l] : [l])))
  );
}

export function imprimerVoucher(x) {
  const d = etat.db.dossiers.find((y) => y.id === x.reservation.dossier_id) || {};
  const client = etat.db.clients.find((c) => c.id === d.client_id) || {};
  imprimer(ajusterHorsEcran(renderVoucher(x)), `${estBookingConfirmation(x.reservation, x.type, reglages()) ? "Booking confirmation" : "Voucher"} ${x.numero || numeroVoucher(d.ref || "", x.index)} - ${(client.nom || "client").split(/\s+/)[0]}`);
}

export function imprimerTousLesVouchers(dossierId) {
  const liste = vouchersDuDossier(dossierId);
  const d = etat.db.dossiers.find((y) => y.id === dossierId) || {};
  if (!liste.length) return;
  imprimer(ajusterHorsEcran(h("div", { class: "vouchers" }, liste.map((x) => renderVoucher(x)))), `${estTaxi(reglages()) ? "Booking confirmations" : "Vouchers"} ${d.ref || ""}`);
}

// Voucher d'exemple pour l'aperçu des réglages : il suit les champs en cours de modification.
export function voucherExemple(reglagesEnCours, type = "bateau") {
  const x = voucherExempleDonnees(organisationActiveId());
  const r = { libelle: type === "billet" ? x.billet : type === "transfert" ? x.transfert : type === "location" ? x.location : type === "activite" ? x.activite : x.bateau, date_service: "2026-12-10", heure_pickup: "08:00", lieu_pickup: x.hotel, personnes: { adultes: 2, enfants: 1, bebes: 0 }, statut: "confirme", reference_partenaire: "", montant_vente: 3600, notes: "", details: type === "transfert" ? { drop_off: x.hotel, vol: x.vol, bagages: "3 suitcases" } : type === "billet" ? { embarquement: x.embarquement, bagages: "2 suitcases" } : {} };
  if (type === "location") Object.assign(r, { montant_vente: 750, details: { retour_date: "2026-12-13", retour_heure: "10:00", retour_lieu: x.hotel } });
  if (type === "billet") Object.assign(r, { heure_pickup: "09:30", lieu_pickup: x.hotel, trajet_id: "exemple" });
  return renderVoucher({ reservation: r, prestation: type === "bateau" ? { famille: "excursion", groupe: "Join tour", details: { parc: x.parc, bateau: x.typeBateau } } : type === "location" ? { famille: "location", groupe: "Scooters", libelle: x.location, unite: "day", details: { moteur: "125 cc" } } : null, type, index: 1 }, { reglages: reglagesEnCours, trajet: type === "billet" ? { de: x.de, vers: x.vers, depart: "10:30", arrivee: "13:30", mode: "Speedboat" } : null, dossier: { ref: "INV-2026-001" }, client: { prenom: "Jane", nom: "Example", telephone: "+44 7000 000000", adresse: "Hotel Example, Room 12" }, resume: { total: 3600, recu: 3600 } });
}
