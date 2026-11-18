// Vouchers de Secret Travel & Tour : une page A4 par réservation, remise au client et au prestataire une fois payé.
// Cinq modèles d'après les documents d'Anaïs : Boat Ticket, Boat Tour, Transfer, Activity & Tour, Rental. Toujours en anglais.
// Les intitulés se règlent dans Réglages > Vouchers (textes-voucher.mjs). Ce qui a été envoyé se fige (operations-calc.mjs, voucherFige) :
// le numéro, le modèle et ce que le voucher lisait dans la prestation, le trajet et la fiche du partenaire ne changent plus avec le catalogue.
import { etat, reglages, entiteActive, imprimer, nomPartenaire, partenaireDe, resumeDossier } from "../etat.mjs";
import { h } from "../ui.mjs";
import { formatDate, formatNombre, aujourdhui } from "../calc.mjs";
import { typeVoucherDeduit, modeleChoisi, numeroVoucher, numerosVouchers, statutPaiementVoucher, prixParPersonneVoucher, empreinteVoucher, voucherFige, valeursFigees, SANS_VOUCHER, estPrive, fraisDeParc, typeTransfert, hotelEtChambre, dateTexte, remplirGabarit, embarcadereFiche, consigneCheckinFiche, estPickupHotel, bateauEtQuai, horairesTexte, dureeTexte, concerneUnVol, nbJoursLocation, categorieVehicule, moteurTexte, siegesVoucher, pickupDepuisLibelle, dropOffDepuisLibelle } from "../operations-calc.mjs";
import { libelleClient, modeEn } from "../partenaires-calc.mjs";
import { estTaxi, estBookingSecret, estBookingConfirmation } from "../taxi-calc.mjs";
import { estRetourDepart, dureeAnglais } from "../trajet-calc.mjs";
import { textesVoucher } from "../textes-voucher.mjs";
import { prestationEnfant } from "../demande-calc.mjs";
import { renderBookingConfirmation } from "./voucher-taxi.mjs";
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
const extraitPartenaire = (p) => (p ? { nom: p.nom || "", contact: { embarcadere: (p.contact && p.contact.embarcadere) || "" }, regles: { points_embarquement: (p.regles && p.regles.points_embarquement) || [], checkin_voucher: (p.regles && p.regles.checkin_voucher) || "" } } : null);

// Les sources d'un voucher : celles figées au premier envoi quand la réservation porte encore le même service, sinon celles de la base.
function sourcesVoucher(r, prestationLive) {
  const live = { prestation: prestationLive || null, trajet: r.trajet_id ? etat.db.trajets.find((t) => t.id === r.trajet_id) || null : null, partenaire: partenaireDe(r.partenaire_id) || null, modele: null };
  const f = valeursFigees(r);
  if (!f) return live;
  return { prestation: "prestation" in f ? f.prestation : live.prestation, trajet: "trajet" in f ? f.trajet : live.trajet, partenaire: "partenaire" in f ? f.partenaire : live.partenaire, modele: f.modele || null };
}

// Modèle du voucher : celui choisi sur la réservation, sinon celui figé à l'envoi, sinon la déduction. Taxi : toujours la Booking confirmation.
function modeleDe(r, sources, taxi) {
  const choisi = modeleChoisi(r);
  if (choisi) return choisi === SANS_VOUCHER ? null : choisi;
  return sources.modele || typeVoucherDeduit(r, sources.prestation, sources.partenaire) || (taxi ? "transfert" : null);
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
function empreinteDuDossier(d) {
  let ctx = null;
  return (r) => {
    if (!ctx) {
      const res = d ? resumeDossier(d.id) : null;
      ctx = { client: (d && etat.db.clients.find((c) => c.id === d.client_id)) || {}, res, devise: (res && res.devise) || reglages().devise || "THB" };
    }
    return empreinteVoucher({ reservation: r, client: ctx.client, statut: statutPaiementVoucher({ ...(ctx.res || {}), surPlace: !!r.paye_sur_place }), devise: ctx.devise });
  };
}

// La trace à poser sur la réservation quand son voucher part (premier envoi ou renvoi) : `x` vient de vouchersDuDossier.
export function figerVoucher(x, date = aujourdhui()) {
  const r = etat.db.reservations.find((y) => y.id === x.reservation.id) || x.reservation;
  const taxi = estTaxi(reglages());
  const src = sourcesVoucher(r, x.prestation);
  const modele = src.modele || typeVoucherDeduit(r, src.prestation, src.partenaire) || (taxi ? "transfert" : null);
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
  const titrePrestation = p && p.libelle_en && [p.libelle, p.libelle_en].some((x) => brut(x) === brut(r.libelle)) ? p.libelle_en : libelleClient(r.libelle);
  // Billet : ce qui est saisi sur la réservation passe avant le trajet de la base ; sans trajet (partenaire ajouté à la main), seulement la saisie
  // et un libellé « A → B ». L'heure de pickup n'est jamais prise pour l'heure de départ du bateau quand le pickup s'imprime à part.
  const dBillet = { de: libelleClient(dt.de || (trajet && trajet.de) || pickupDepuisLibelle(r, p, trajet)), vers: libelleClient(dt.vers || (trajet && trajet.vers) || dropOffDepuisLibelle(r, p)), depart: dt.depart || (trajet && trajet.depart) || (trajet ? r.heure_pickup || "" : ""), arrivee: dt.arrivee || (trajet && trajet.arrivee) || "", mode: dt.bateau || (trajet && trajet.mode ? modeEn(trajet.mode) : "") };
  // Embarcadère et check-in : la saisie, puis la fiche de la compagnie (audit n° 48), puis les consignes écrites dans l'outil.
  const embarquement = dt.embarquement || embarcadereFiche(compagnie, dBillet.de) || (trajet ? r.lieu_pickup || "" : "");
  const pickupInclus = !!(r.heure_pickup || r.lieu_pickup) && (!!trajet || !!r.lieu_pickup);
  // Quand la compagnie vient chercher le client à l'hôtel, pas de comptoir : il doit être prêt dans le hall.
  const checkin = dt.checkin || (estPickupHotel(embarquement) || (!trajet && !embarquement && r.lieu_pickup) ? t("lobby") : consigneCheckinFiche(compagnie || { nom: nomPartenaire(r.partenaire_id) }, dBillet));
  const bq = bateauEtQuai(p);
  const bateauTexte = dt.bateau || bq.bateau;
  // La capacité du bateau ne s'imprime plus sur le voucher (Jérémy, 13.11.2026) : elle reste dans la fiche de la prestation.
  const horaires = horairesTexte(p && p.details && p.details.horaires);
  const duree = dureeTexte(p && p.details && p.details.duree);
  // Le programme ne s'imprime que s'il a été saisi : le groupe de la base (« Cours de cuisine ») n'apprend rien au client.
  const programme = dt.programme || "";
  const devise = (res && res.devise) || regl.devise || "THB";
  const nomClient = [client.prenom, client.nom].filter(Boolean).join(" ");
  const auto = hotelEtChambre(client, r);
  const hotel = auto.hotel;
  const chambre = dt.chambre || auto.chambre;
  const statut = statutPaiementVoucher({ ...(res || {}), surPlace: !!r.paye_sur_place });
  const parcAuto = fraisDeParc(p);
  const parc = dt.parc === "aucun" ? { inclus: null, texte: "" } : dt.parc === "inclus" ? { inclus: true, texte: dt.parc_texte || "" } : dt.parc === "non" ? { inclus: false, texte: dt.parc_texte || parcAuto.texte } : { ...parcAuto, texte: dt.parc_texte || parcAuto.texte };
  const prive = dt.type_tour ? dt.type_tour === "prive" : estPrive(p, r);
  const transfert = dt.type_transfert || typeTransfert(p, r);
  const pers = r.personnes || {};
  const a = Number(pers.adultes) || 0;
  const en_ = Number(pers.enfants) || 0;
  const operateur = libelleClient(compagnie ? compagnie.nom : nomPartenaire(r.partenaire_id));
  // Course d'un taxi indépendant vendue sous le logo de Secret (voucher rapide, 18.11.2026) : pas de partenaire, pas de ligne « Operator » vide.
  const ligneOperateur = dt.taxi_independant && !operateur ? null : ligne(t("operateur"), operateur);
  // La référence du partenaire s'imprime dans Remarks : l'aide du champ le dit (audit n° 61).
  const remarques = [dt.remarques, r.reference_partenaire ? `${t("ref_operateur")} ${r.reference_partenaire}` : ""].filter(Boolean).join(" · ");
  const dropOff = libelleClient(dt.drop_off || dropOffDepuisLibelle(r, p, trajet));
  // Un transfert « Pakbara Pier → Hat Yai Airport » part du quai, pas de l'hôtel du client.
  // Les tarifs par zone des taxis de Saladan n'ont pas de départ fixe : Anaïs remplit le pickup et le drop-off.
  const tarifZone = !!p && /saladan/i.test(p.groupe || "") && !(p.libelle || "").includes("→");
  // Retour au point de départ : jamais le premier bout d'un libellé « A → B » (un aéroport où le client ne sera pas), sinon l'hôtel du client.
  const pickupTransfert = r.lieu_pickup || (estRetourDepart(r) ? hotel : libelleClient(pickupDepuisLibelle(r, p, trajet)) || (tarifZone ? "" : hotel));
  // Retour au point de départ (16.11.2026) : « Pickup and return », le programme et la durée à la place du drop-off, jamais « From X to X ».
  const retourDepart = estRetourDepart(r);
  const programmeTrajet = retourDepart ? String(dt.programme_trajet || "").trim() : "";
  const dureeTrajet = retourDepart ? dureeAnglais(dt.duree_h) : "";
  const vol = dt.vol ? [dt.vol] : null; // jamais déduit des notes internes : « Payé 1200 THB » n'est pas un vol
  const avecVol = !!dt.vol || concerneUnVol(r.libelle, dropOff, pickupTransfert, r.notes);
  const bagages = dt.bagages || "";
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
  if (estBookingSecret(r, type, regl)) return renderBookingSecret({ regl, client, r, pickup: pickupTransfert, dropoff: dropOff, bagages, devise, whatsapp, nomSociete, retour: retourDepart ? { programme: programmeTrajet, duree: dureeTrajet } : null });
  if (estTaxi(regl)) return renderBookingConfirmation({ regl, client, r, pickup: pickupTransfert, dropoff: dropOff, bagages, devise, whatsapp, email, adresse, nomSociete, retour: retourDepart ? { programme: programmeTrajet, duree: dureeTrajet } : null });

  const cle = (texte) => h("span", { class: "v-cle" }, `${texte}: `);
  const espace = () => h("span", { class: "v-espace" });
  const passagers = (libelle, avecBebes = false) => ligne(libelle, "", cle(t("adultes")), nbp(a), espace(), cle(t("enfants")), nbp(en_), ...(avecBebes ? [espace(), cle(t("bebes")), nbp(pers.bebes)] : []));
  // Statut du paiement : les trois cases du modèle d'Anaïs ; « Payment Pending » s'ajoute seulement quand c'est le cas (rien reçu, pas payé sur place).
  const statutPaiement = (paye, surPlace) => h("p", { class: "v-ligne" }, cle(t("statut_paiement")), case_(statut === "paye", paye), " ", case_(statut === "acompte", t("acompte")), " ", case_(statut === "sur_place", surPlace), ...(statut === "en_attente" ? [" ", case_(true, t("en_attente"))] : []));

  const booking =
    type === "billet"
      ? [ligne(t("route"), [dBillet.de, dBillet.vers].some(Boolean) ? `${dBillet.de} → ${dBillet.vers}` : ""), ligne(t("date_trajet"), dateTexte(r.date_service, "en")), ligne(t("heure_depart"), dBillet.depart, ...cleEnLigne(t("heure_arrivee"), dBillet.arrivee)), ligneSi(t("bateau"), dBillet.mode), ligne(t("compagnie"), operateur), ligneSi(t("embarcadere"), embarquement), pickupInclus ? ligne(t("pickup_hotel"), [r.lieu_pickup, r.heure_pickup ? `${t("a_heure")} ${r.heure_pickup}` : ""].filter(Boolean).join(" ")) : null, passagers(t("passagers"), Number(pers.bebes) > 0 || sansPersonnes), ligneSi(t("bagages"), bagages), ligneSi(t("remarques"), remarques)]
      : type === "bateau"
      ? [ligne(t("nom_tour"), titrePrestation), ligne(t("date"), dateTexte(r.date_service, "en")), horaires ? ligne(t("horaires"), horaires) : null, bateauTexte ? ligne(t("bateau"), bateauTexte) : null, bq.quai ? ligne(t("quai"), bq.quai) : null, ligne(t("heure_pickup"), r.heure_pickup), ligne(t("lieu_pickup"), r.lieu_pickup || hotel), passagers(t("passagers")), h("p", { class: "v-ligne" }, cle(t("type_tour")), case_(!prive, t("join")), " ", case_(prive, t("prive"))), ligneOperateur, ligneSi(t("remarques"), remarques)]
      : type === "transfert"
        ? [ligne(t("date"), dateTexte(r.date_service, "en")), ligne(t("heure_pickup"), r.heure_pickup), ...(retourDepart ? [ligne(t("pickup_retour"), pickupTransfert), ligne(t("programme_trajet"), programmeTrajet), ligneSi(t("duree"), dureeTrajet)] : [ligne(t("lieu_pickup"), pickupTransfert), ligne(t("drop_off"), dropOff)]), avecVol ? ligne(t("vol"), vol ? vol[0] : "") : null, ligne(t("passagers"), "", cle(t("adultes")), nbp(a), espace(), cle(t("enfants")), nbp(en_), siegesVoucher(dt.sieges), ...cleEnLigne(t("bagages"), bagages)), h("p", { class: "v-ligne" }, cle(t("type_transfert")), ...[["taxi", t("taxi_prive")], ["minivan", t("minivan_prive")], ["partage", t("minivan_partage")]].flatMap(([k, l]) => [case_(transfert === k, l), " "])), ligneOperateur, ligneSi(t("remarques"), remarques)]
        : type === "location"
          ? [ligne(t("vehicule"), titrePrestation), typeVehicule ? ligne(t("type_moteur"), typeVehicule) : null, ligne(t("prise"), [dateTexte(r.date_service, "en"), r.heure_pickup].filter(Boolean).join(", ")), ligne(t("lieu_pickup"), r.lieu_pickup || hotel), ligne(t("retour"), [dateTexte(dt.retour_date, "en"), dt.retour_heure].filter(Boolean).join(", ")), ligne(t("lieu_retour"), dt.retour_lieu || r.lieu_pickup || hotel), jours ? ligne(t("duree_location"), `${jours} ${jours > 1 ? t("jours") : t("jour")}`) : null, ligne(t("conducteur"), nomClient), ligneSi(t("permis"), dt.permis), ligneSi(t("equipement"), dt.equipement), ligneOperateur, ligneSi(t("remarques"), remarques)]
          : [ligne(t("activite"), titrePrestation), programme ? ligne(t("programme"), programme) : null, ligne(t("date_heure"), [dateTexte(r.date_service, "en"), dt.heure_service || horaires].filter(Boolean).join(", ")), duree ? ligne(t("duree"), duree) : null, ligneSi(t("heure_pickup"), r.heure_pickup), ligneSi(t("lieu_pickup"), r.lieu_pickup || hotel), passagers(t("invites")), ligneOperateur, ligneSi(t("remarques"), remarques)];

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
  imprimer(renderVoucher(x), `${estBookingConfirmation(x.reservation, x.type, reglages()) ? "Booking confirmation" : "Voucher"} ${x.numero || numeroVoucher(d.ref || "", x.index)} - ${(client.nom || "client").split(/\s+/)[0]}`);
}

export function imprimerTousLesVouchers(dossierId) {
  const liste = vouchersDuDossier(dossierId);
  const d = etat.db.dossiers.find((y) => y.id === dossierId) || {};
  if (!liste.length) return;
  imprimer(h("div", { class: "vouchers" }, liste.map((x) => renderVoucher(x))), `${estTaxi(reglages()) ? "Booking confirmations" : "Vouchers"} ${d.ref || ""}`);
}

// Voucher d'exemple pour l'aperçu des réglages : il suit les champs en cours de modification.
export function voucherExemple(reglagesEnCours, type = "bateau") {
  const r = { libelle: type === "billet" ? "Speedboat transfer: Koh Lanta → Koh Lipe" : type === "transfert" ? "Private minivan: Krabi Airport → Koh Lanta" : type === "location" ? "Honda Click 125" : type === "activite" ? "Thai cooking class, market visit and lunch" : "4 Islands by longtail, full day", date_service: "2026-12-10", heure_pickup: "08:00", lieu_pickup: "Hotel Example, Klong Dao", personnes: { adultes: 2, enfants: 1, bebes: 0 }, statut: "confirme", reference_partenaire: "", montant_vente: 3600, notes: "", details: type === "transfert" ? { drop_off: "Hotel Example, Klong Dao", vol: "FD 3217", bagages: "3 suitcases" } : type === "billet" ? { embarquement: "Saladan Pier", bagages: "2 suitcases" } : {} };
  if (type === "location") Object.assign(r, { montant_vente: 750, details: { retour_date: "2026-12-13", retour_heure: "10:00", retour_lieu: "Hotel Example, Klong Dao" } });
  if (type === "billet") Object.assign(r, { heure_pickup: "09:30", lieu_pickup: "Hotel Example, Klong Dao", trajet_id: "exemple" });
  return renderVoucher({ reservation: r, prestation: type === "bateau" ? { famille: "excursion", groupe: "Join tour", details: { parc: "400 THB per adult, 200 THB per child, cash on the island", bateau: "Longtail" } } : type === "location" ? { famille: "location", groupe: "Scooters", libelle: "Honda Click 125", unite: "day", details: { moteur: "125 cc" } } : null, type, index: 1 }, { reglages: reglagesEnCours, trajet: type === "billet" ? { de: "Koh Lanta", vers: "Koh Lipe", depart: "10:30", arrivee: "13:30", mode: "Speedboat" } : null, dossier: { ref: "INV-2026-001" }, client: { prenom: "Jane", nom: "Example", telephone: "+44 7000 000000", adresse: "Hotel Example, Room 12" }, resume: { total: 3600, recu: 3600 } });
}
