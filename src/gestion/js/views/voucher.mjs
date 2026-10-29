// Vouchers de Secret Travel & Tour : une page A4 par réservation, remise au client et au prestataire une fois payé.
// Trois modèles d'après les documents d'Anaïs : Boat Tour, Transfer, Activity & Tour. Toujours en anglais.
import { etat, reglages, entiteActive, imprimer, nomPartenaire, resumeDossier } from "../etat.mjs";
import { h } from "../ui.mjs";
import { formatDate, formatNombre } from "../calc.mjs";
import { typeVoucher, numeroVoucher, statutPaiementVoucher, estPrive, fraisDeParc, typeTransfert, hotelEtChambre, dateTexte, personnesTexte, remplirGabarit } from "../operations-calc.mjs";

const TITRES = { bateau: "Boat Tour Voucher", transfert: "Transfer Voucher", activite: "Activity & Tour Voucher" };
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

export function renderVoucher({ reservation: r, prestation: p, type, index }) {
  const regl = reglages();
  const d = etat.db.dossiers.find((x) => x.id === r.dossier_id) || {};
  const client = etat.db.clients.find((c) => c.id === d.client_id) || {};
  const res = d.id ? resumeDossier(d.id) : null;
  const e = regl.emetteur;
  const v = regl.voucher || {};
  const devise = (res && res.devise) || regl.devise || "THB";
  const nomClient = [client.prenom, client.nom].filter(Boolean).join(" ");
  const { hotel, chambre } = hotelEtChambre(client, r);
  const statut = statutPaiementVoucher(res || {});
  const trajet = r.trajet_id ? etat.db.trajets.find((t) => t.id === r.trajet_id) : null;
  const parc = fraisDeParc(p);
  const pers = r.personnes || {};
  const a = Number(pers.adultes) || 0;
  const en_ = Number(pers.enfants) || 0;
  const operateur = nomPartenaire(r.partenaire_id);
  const remarques = [r.notes, r.reference_partenaire ? `Operator ref. ${r.reference_partenaire}` : ""].filter(Boolean).join(" · ");
  const dropOff = trajet ? trajet.vers : ((p && p.libelle) || r.libelle).includes("→") ? ((p && p.libelle) || r.libelle).split("→").pop().trim() : "";
  const vol = (r.notes || "").match(/\b[A-Z]{2}\s?\d{2,4}\b/);
  const prixPersonne = a + en_ > 0 && r.montant_vente ? Math.round((Number(r.montant_vente) / (a + en_)) * 100) / 100 : p ? p.prix_vente : null;

  const booking =
    type === "bateau"
      ? [ligne("Tour Name", r.libelle), ligne("Date", dateTexte(r.date_service, "en")), ligne("Pickup Time", r.heure_pickup), ligne("Pickup Location", r.lieu_pickup || hotel), ligne("Number of Passengers", "", h("span", { class: "v-cle" }, "Adults: "), a || "", h("span", { class: "v-espace" }), h("span", { class: "v-cle" }, "Children: "), en_ || ""), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "Tour Type: "), case_(!estPrive(p, r), "Join Tour"), " ", case_(estPrive(p, r), "Private Tour")), ligne("Company / Operator", operateur), ligne("Remarks", remarques)]
      : type === "transfert"
        ? [ligne("Date", dateTexte(r.date_service, "en")), ligne("Pickup Time", r.heure_pickup), ligne("Pickup Location", r.lieu_pickup || hotel), ligne("Drop-off Location", dropOff), ligne("Flight Number (if applicable)", vol ? vol[0] : ""), ligne("Number of Passengers", "", h("span", { class: "v-cle" }, "Adults: "), a || "", h("span", { class: "v-espace" }), h("span", { class: "v-cle" }, "Children: "), en_ || "", h("span", { class: "v-espace" }), h("span", { class: "v-cle" }, "Luggage: ")), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "Transfer Type: "), ...[["taxi", "Private Taxi"], ["minivan", "Private Minivan"], ["partage", "Shared Minivan"]].flatMap(([k, l]) => [case_(typeTransfert(p, r) === k, l), " "])), ligne("Company / Operator", operateur), ligne("Remarks", remarques)]
        : [ligne("Activity / Tour", r.libelle), ligne("Date & Time", [dateTexte(r.date_service, "en"), (p && p.details && p.details.horaires) || ""].filter(Boolean).join(", ")), ligne("Pickup Time", r.heure_pickup), ligne("Pickup Location", r.lieu_pickup || hotel), ligne("Number of Guests", "", h("span", { class: "v-cle" }, "Adults "), a || "", h("span", { class: "v-espace" }), h("span", { class: "v-cle" }, "Children "), en_ || ""), ligne("Company / Operator", operateur), ligne("Remarks", remarques)];

  const paiement =
    type === "bateau"
      ? [ligne("Total Price", prix(r.montant_vente, devise)), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "National Park Fee: "), case_(parc.inclus === true, "Included"), " ", case_(parc.inclus === false, "Not Included"), parc.inclus === false ? `: ${parc.texte}` : ""), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "Payment Status: "), case_(statut === "paye", "Paid"), " ", case_(statut === "acompte", "Deposit Paid"), " ", case_(statut === "sur_place", "Pay at Pier / Provider")), ligne("Remarks", "")]
      : type === "transfert"
        ? [ligne("Total Price", prix(r.montant_vente, devise)), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "Payment Status: "), case_(statut === "paye", "Paid"), " ", case_(statut === "acompte", "Deposit Paid"), " ", case_(statut === "sur_place", "Pay Driver Directly")), ligne("Remarks", "")]
        : [ligne("Price per Person", prix(prixPersonne, devise)), ligne("Total Amount", prix(r.montant_vente, devise)), h("p", { class: "v-ligne" }, h("span", { class: "v-cle" }, "Payment Status: "), case_(statut === "paye", "Paid in Full"), " ", case_(statut === "acompte", "Deposit Paid"), " ", case_(statut === "sur_place", "Pay on Arrival")), ligne("Remarks", "")];

  const merci = remplirGabarit(v.merci || "Thank you for booking with {entreprise}!\nWe wish you a wonderful day.", { entreprise: e.nom || entiteActive().nom });
  return h(
    "div",
    { class: "voucher" },
    h("div", { class: "v-tete" }, h("span", null, `Voucher No.: ${numeroVoucher(d.ref || "", index)}`), h("span", null, `Date: ${formatDate(new Date().toISOString())}`)),
    h(
      "div",
      { class: "v-entete" },
      regl.apparence.logo ? h("img", { class: "v-logo", src: regl.apparence.logo, alt: "" }) : null,
      h("div", { class: "v-societe" }, h("p", { class: "v-nom" }, e.nom || entiteActive().nom), e.sous_titre ? h("p", { class: "v-par" }, e.sous_titre) : null, h("p", null, (e.adresse || "").split("\n").filter(Boolean).join(", ")), h("p", null, `TAT licence: ${v.licence || ""}`), h("p", null, `Whatsapp: ${e.telephone || ""}`), v.email ? h("p", null, `E-mail: ${v.email}`) : null)
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
