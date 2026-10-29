// Vouchers de Secret Travel & Tour : une page A4 par réservation, remise au client et au prestataire une fois payé.
// Trois modèles d'après les documents d'Anaïs : Boat Tour, Transfer, Activity & Tour. Toujours en anglais.
import { etat, reglages, entiteActive, imprimer, nomPartenaire, resumeDossier } from "../etat.mjs";
import { h, modal } from "../ui.mjs";
import { apercuA4 } from "./commun.mjs";
import { formatDate, formatNombre } from "../calc.mjs";
import { typeVoucher, numeroVoucher, statutPaiementVoucher, estPrive, fraisDeParc, typeTransfert, hotelEtChambre, dateTexte, personnesTexte, remplirGabarit, TITRES_VOUCHER } from "../operations-calc.mjs";
import { libelleClient } from "../partenaires-calc.mjs";

const TITRES = TITRES_VOUCHER;
const case_ = (coche, libelle) => h("span", { class: `v-case${coche ? " cochee" : ""}` }, h("span", { class: "v-carre", "aria-hidden": "true" }, coche ? "☒" : "☐"), ` ${libelle}`);
const ligne = (libelle, valeur, ...suite) => h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, `${libelle}: `), valeur === null || valeur === undefined ? "" : String(valeur), ...suite);
const prix = (n, devise) => (n === null || n === undefined || n === "" ? "" : `${devise} ${formatNombre(n)}`);

// Les réservations qui ont un voucher, dans l'ordre de création, numérotées 1, 2, 3 après la référence du dossier.
export function vouchersDuDossier(dossierId) {
  return etat.db.reservations
    .filter((r) => r.dossier_id === dossierId && r.statut !== "annule")
    .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "") || a.libelle.localeCompare(b.libelle))
    .map((r) => ({ reservation: r, prestation: r.prestation_id ? etat.db.prestations.find((p) => p.id === r.prestation_id) || null : null }))
    .map((x) => ({ ...x, type: typeVoucher(x.reservation, x.prestation) }))
    .filter((x) => x.type)
    .map((x, i) => ({ ...x, index: i + 1 }));
}

// `contexte` (facultatif) : réglages, dossier, client et résumé à utiliser à la place de la base, pour l'aperçu des réglages.
export function renderVoucher({ reservation: r, prestation: p, type, index }, contexte = {}) {
  const regl = contexte.reglages || reglages();
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
  const titrePrestation = libelleClient(r.libelle);
  const devise = (res && res.devise) || regl.devise || "THB";
  const nomClient = [client.prenom, client.nom].filter(Boolean).join(" ");
  // Les détails saisis sur la réservation passent avant ce que l'on déduit de la prestation.
  const dt = r.details || {};
  const auto = hotelEtChambre(client, r);
  const hotel = auto.hotel;
  const chambre = dt.chambre || auto.chambre;
  const statut = statutPaiementVoucher(res || {});
  const trajet = r.trajet_id ? etat.db.trajets.find((t) => t.id === r.trajet_id) : null;
  const parcAuto = fraisDeParc(p);
  const parc = dt.parc === "aucun" ? { inclus: null, texte: "" } : dt.parc === "inclus" ? { inclus: true, texte: dt.parc_texte || "" } : dt.parc === "non" ? { inclus: false, texte: dt.parc_texte || parcAuto.texte } : { ...parcAuto, texte: dt.parc_texte || parcAuto.texte };
  const prive = dt.type_tour ? dt.type_tour === "prive" : estPrive(p, r);
  const transfert = dt.type_transfert || typeTransfert(p, r);
  const pers = r.personnes || {};
  const a = Number(pers.adultes) || 0;
  const en_ = Number(pers.enfants) || 0;
  const operateur = nomPartenaire(r.partenaire_id);
  const remarques = [dt.remarques, r.reference_partenaire ? `Operator ref. ${r.reference_partenaire}` : ""].filter(Boolean).join(" · ");
  const dropOff = dt.drop_off || (trajet ? trajet.vers : ((p && p.libelle) || r.libelle).includes("→") ? ((p && p.libelle) || r.libelle).split("→").pop().trim() : "");
  const vol = dt.vol ? [dt.vol] : (r.notes || "").match(/\b[A-Z]{2}\s?\d{2,4}\b/);
  const bagages = dt.bagages || "";
  const remarquesPaiement = dt.remarques_paiement || "";
  const prixPersonne = a + en_ > 0 && r.montant_vente ? Math.round((Number(r.montant_vente) / (a + en_)) * 100) / 100 : p ? p.prix_vente : null;

  const booking =
    type === "bateau"
      ? [ligne("Tour Name", titrePrestation), ligne("Date", dateTexte(r.date_service, "en")), ligne("Pickup Time", r.heure_pickup), ligne("Pickup Location", r.lieu_pickup || hotel), ligne("Number of Passengers", "", h("span", { class: "v-cle" }, "Adults: "), a || "", h("span", { class: "v-espace" }), h("span", { class: "v-cle" }, "Children: "), en_ || ""), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "Tour Type: "), case_(!prive, "Join Tour"), " ", case_(prive, "Private Tour")), ligne("Company / Operator", operateur), ligne("Remarks", remarques)]
      : type === "transfert"
        ? [ligne("Date", dateTexte(r.date_service, "en")), ligne("Pickup Time", r.heure_pickup), ligne("Pickup Location", r.lieu_pickup || hotel), ligne("Drop-off Location", dropOff), ligne("Flight Number (if applicable)", vol ? vol[0] : ""), ligne("Number of Passengers", "", h("span", { class: "v-cle" }, "Adults: "), a || "", h("span", { class: "v-espace" }), h("span", { class: "v-cle" }, "Children: "), en_ || "", h("span", { class: "v-espace" }), h("span", { class: "v-cle" }, "Luggage: "), bagages), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "Transfer Type: "), ...[["taxi", "Private Taxi"], ["minivan", "Private Minivan"], ["partage", "Shared Minivan"]].flatMap(([k, l]) => [case_(transfert === k, l), " "])), ligne("Company / Operator", operateur), ligne("Remarks", remarques)]
        : type === "location"
          ? [ligne("Vehicle", titrePrestation), ligne("Pickup Date & Time", [dateTexte(r.date_service, "en"), r.heure_pickup].filter(Boolean).join(", ")), ligne("Return Date & Time", [dateTexte(dt.retour_date, "en"), dt.retour_heure].filter(Boolean).join(", ")), ligne("Pickup Location", r.lieu_pickup || hotel), ligne("Driver's Name", nomClient), ligne("Driving Licence", dt.permis || ""), ligne("Company / Operator", operateur), ligne("Remarks", remarques)]
          : [ligne("Activity / Tour", titrePrestation), ligne("Date & Time", [dateTexte(r.date_service, "en"), dt.heure_service || (p && p.details && p.details.horaires) || ""].filter(Boolean).join(", ")), ligne("Pickup Time", r.heure_pickup), ligne("Pickup Location", r.lieu_pickup || hotel), ligne("Number of Guests", "", h("span", { class: "v-cle" }, "Adults "), a || "", h("span", { class: "v-espace" }), h("span", { class: "v-cle" }, "Children "), en_ || ""), ligne("Company / Operator", operateur), ligne("Remarks", remarques)];

  const paiement =
    type === "bateau"
      ? [ligne("Total Price", prix(r.montant_vente, devise)), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "National Park Fee: "), case_(parc.inclus === true, "Included"), " ", case_(parc.inclus === false, "Not Included"), parc.inclus === false ? `: ${parc.texte}` : ""), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "Payment Status: "), case_(statut === "paye", "Paid"), " ", case_(statut === "acompte", "Deposit Paid"), " ", case_(statut === "sur_place", "Pay at Pier / Provider")), ligne("Remarks", remarquesPaiement)]
      : type === "transfert"
        ? [ligne("Total Price", prix(r.montant_vente, devise)), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "Payment Status: "), case_(statut === "paye", "Paid"), " ", case_(statut === "acompte", "Deposit Paid"), " ", case_(statut === "sur_place", "Pay Driver Directly")), ligne("Remarks", remarquesPaiement)]
        : type === "location"
          ? [ligne("Total Price", prix(r.montant_vente, devise)), ligne("Security Deposit", dt.caution || ""), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "Payment Status: "), case_(statut === "paye", "Paid"), " ", case_(statut === "acompte", "Deposit Paid"), " ", case_(statut === "sur_place", "Pay on Pickup")), ligne("Remarks", remarquesPaiement)]
          : [ligne("Price per Person", prix(prixPersonne, devise)), ligne("Total Amount", prix(r.montant_vente, devise)), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "Payment Status: "), case_(statut === "paye", "Paid in Full"), " ", case_(statut === "acompte", "Deposit Paid"), " ", case_(statut === "sur_place", "Pay on Arrival")), ligne("Remarks", remarquesPaiement)];

  const merci = remplirGabarit((type === "transfert" && v.merci_transfert) || v.merci || "Thank you for booking with {entreprise}!\nWe wish you a wonderful day.", { entreprise: nomSociete });
  return h(
    "div",
    { class: "voucher" },
    h("div", { class: "v-tete" }, h("span", null, `Voucher No.: ${numeroVoucher(d.ref || "", index)}`), h("span", null, `Date: ${formatDate(new Date().toISOString())}`)),
    h(
      "div",
      { class: "v-entete" },
      regl.apparence.logo ? h("img", { class: "v-logo", src: regl.apparence.logo, alt: "" }) : null,
      h("div", { class: "v-societe" }, h("p", { class: "v-nom" }, nomSociete), sousTitre ? h("p", { class: "v-par" }, sousTitre) : null, h("p", null, adresse), h("p", null, `TAT licence: ${v.licence || ""}`), h("p", null, `Whatsapp: ${whatsapp}`), h("p", null, `E-mail: ${email}`))
    ),
    h("h1", { class: "v-titre" }, TITRES[type]),
    h("section", null, h("h2", null, "CUSTOMER DETAILS"), ligne("Guest Name", nomClient), ligne("WhatsApp / Phone", client.telephone), type === "transfert" ? null : ligne("Hotel / Accommodation", hotel, h("span", { class: "v-espace" }), h("span", { class: "v-cle" }, "Room No: "), chambre)),
    h("section", null, h("h2", null, "BOOKING DETAILS"), ...booking),
    h("section", null, h("h2", null, "PAYMENT DETAILS"), ...paiement),
    type === "transfert" && v.note_transfert ? h("p", { class: "v-note" }, ...v.note_transfert.split("\n").flatMap((l, i) => (i ? [h("br"), l] : [l]))) : null,
    h("p", { class: "v-merci" }, ...merci.split("\n").flatMap((l, i) => (i ? [h("br"), l] : [l])))
  );
}

export function imprimerVoucher(x) {
  const d = etat.db.dossiers.find((y) => y.id === x.reservation.dossier_id) || {};
  const client = etat.db.clients.find((c) => c.id === d.client_id) || {};
  imprimer(renderVoucher(x), `Voucher ${numeroVoucher(d.ref || "", x.index)} - ${(client.nom || "client").split(/\s+/)[0]}`);
}

export function imprimerTousLesVouchers(dossierId) {
  const liste = vouchersDuDossier(dossierId);
  const d = etat.db.dossiers.find((y) => y.id === dossierId) || {};
  if (!liste.length) return;
  imprimer(h("div", { class: "vouchers" }, liste.map(renderVoucher)), `Vouchers ${d.ref || ""}`);
}

// Aperçu à l'écran, à l'échelle de la fenêtre, avant d'imprimer.
export function apercuVoucher(x) {
  const { zone } = apercuA4(() => renderVoucher(x));
  modal(`Voucher ${numeroVoucher((etat.db.dossiers.find((d) => d.id === x.reservation.dossier_id) || {}).ref || "", x.index)}`, h("div", { class: "modal-corps apercu-voucher" }, zone, h("div", { class: "actions" }, h("button", { class: "principal", type: "button", onclick: () => imprimerVoucher(x) }, "Voucher PDF"))), { large: true });
}

// Voucher d'exemple pour l'aperçu des réglages : il suit les champs en cours de modification.
export function voucherExemple(reglagesEnCours, type = "bateau") {
  const r = { libelle: type === "transfert" ? "Speedboat transfer: Koh Lanta → Koh Phi Phi" : type === "location" ? "Honda Click 125" : type === "activite" ? "Thai cooking class, market visit and lunch" : "4 Islands by longtail, full day", date_service: "2026-12-10", heure_pickup: "08:00", lieu_pickup: "Hotel Example, Klong Dao", personnes: { adultes: 2, enfants: 1, bebes: 0 }, statut: "confirme", reference_partenaire: "", montant_vente: 3600, notes: "", details: type === "transfert" ? { drop_off: "Tonsai Pier, Koh Phi Phi", vol: "", bagages: "3 suitcases" } : {} };
  return renderVoucher({ reservation: r, prestation: type === "bateau" ? { famille: "excursion", groupe: "Join tour", details: { parc: "400 THB per adult, 200 THB per child, cash on the island" } } : null, type, index: 1 }, { reglages: reglagesEnCours, dossier: { ref: "INV-2026-001" }, client: { prenom: "Jane", nom: "Example", telephone: "+44 7000 000000", adresse: "Hotel Example, Room 12" }, resume: { total: 3600, recu: 3600 } });
}
