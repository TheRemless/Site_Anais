// Réservations auprès des partenaires : liste, formulaire, section d'un dossier, messages.
import { etat, dossiersAnnules, peut, inserer, modifier, supprimer, naviguer, nomClient, nomPartenaire, partenaireDe, privePartenaire, netReservation, enregistrerLie, chargerDossier, reglages, entiteActive, modeExcursions } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, num } from "../ui.mjs";
import { formatMontant, formatDate, aujourdhui, totaux, modeReglement, SUR_PLACE } from "../calc.mjs";
import { STATUTS_RESERVATION, reservationsDepuisDocument, variablesMessage, personnesTexte, dateTexte, typeVoucher, CHAMPS_VOUCHER, TITRES_VOUCHER, datesDepuisReservations, descriptionService, cleMessageClient, ecartReservation, contenuSansReservation, contenuAvecSurPlace, modeParDefaut, commissionPrevue as commissionPrevue_ } from "../operations-calc.mjs";
import { choisirPrestation } from "./choix-prestation.mjs";
import { CONTENU_DEFAUT } from "../defauts.mjs";
import { vide } from "./commun.mjs";
import { ouvrirMessage } from "./messages.mjs";
import { prix, voitNets } from "./partenaires.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { telWhatsApp, commissionsPartenaire } from "../partenaires-calc.mjs";
import { puceMode, regleCommissionDe } from "./mode-reglement.mjs";
import { ouvrirFeuilleDuJour } from "./feuille-jour.mjs";

export const pastilleReservation = (code) => h("span", { class: `statut r-${code}` }, h("span", { class: "point", "aria-hidden": "true" }), (STATUTS_RESERVATION[code] ? tr(STATUTS_RESERVATION[code]) : code));
const dossierDe = (r) => etat.db.dossiers.find((d) => d.id === r.dossier_id) || null;
const clientDe = (r) => { const d = dossierDe(r); return d ? etat.db.clients.find((c) => c.id === d.client_id) || null : null; };
const entreprise = () => ({ nom: reglages().emetteur.nom || entiteActive().nom, telephone: reglages().emetteur.telephone || "" });

export function messagePartenaire(r) {
  const p = partenaireDe(r.partenaire_id);
  const langue = "en";
  ouvrirMessage({ titre: p ? tr("Message à {nom}", { nom: p.nom }) : tr("Message au partenaire"), pour: "partenaire", cle: "partenaire", langue, telephone: telWhatsApp(p), vars: variablesMessage({ reservation: r, client: clientDe(r) || {}, dossier: dossierDe(r) || {}, partenaire: p || {}, entreprise: entreprise(), langue }) });
}
export function messageClient(r, cle = "confirmation") {
  const c = clientDe(r) || {};
  // Les clients de Secret reçoivent leurs documents en anglais : le message est proposé en anglais aussi.
  const langue = /invoice/i.test((reglages().libelles && reglages().libelles.facture) || "") ? "en" : "fr";
  ouvrirMessage({ titre: tr("Message à {nomClient}", { nomClient: nomClient(c) }), pour: "client", cle, langue, telephone: c.telephone || "", vars: variablesMessage({ reservation: r, client: c, dossier: dossierDe(r) || {}, partenaire: partenaireDe(r.partenaire_id) || {}, entreprise: entreprise(), langue }) });
}

// Changer le statut d'une réservation d'un geste, sans ouvrir le formulaire complet.
function selecteurStatut(r, apres) {
  const s = h("select", { class: `statut-choix r-${r.statut}`, "aria-label": tr("Statut de la réservation « {libelle} »", { libelle: r.libelle }), onchange: async () => {
    try {
      await modifier("reservations", r.id, { statut: s.value });
      apres();
    } catch (err) {
      s.value = r.statut;
      toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    }
  } }, Object.entries(STATUTS_RESERVATION).map(([v, l]) => h("option", { value: v }, tr(l))));
  s.value = r.statut;
  return s;
}

// Texte d'un écart entre la réservation et la facture : « Date : 12 déc. sur la réservation, 14 déc. sur la facture ».
function texteEcart(c, devise) {
  const v = (x) => (c.cle === "date_service" ? (x ? formatDate(x) : tr("à fixer")) : c.cle === "personnes" ? personnesTexte(x) || "0" : c.cle === "paye_sur_place" ? (x ? tr("sur place") : tr("chez nous")) : formatMontant(x, devise));
  const nom = c.cle === "date_service" ? tr("Date") : c.cle === "personnes" ? tr("Personnes") : c.cle === "paye_sur_place" ? tr("Paiement") : tr("Montant vendu");
  return tr("{nom} : {reservation} sur la réservation, {document} sur la facture", { nom, reservation: v(c.reservation), document: v(c.document) });
}

// Remet la réservation d'après les lignes de la facture : date, adultes et enfants (les bébés restent), montant vendu.
async function aligner(r, ecart, apres) {
  const a = ecart.attendu;
  try {
    await modifier("reservations", r.id, { date_service: a.date_service, personnes: { ...(r.personnes || {}), adultes: a.personnes.adultes, enfants: a.personnes.enfants }, ...(a.montant_vente === null ? {} : { montant_vente: a.montant_vente }), paye_sur_place: a.paye_sur_place });
    await synchroniserDatesDossier(r.dossier_id);
    toast(tr("Réservation alignée sur la facture."));
    apres();
  } catch (err) {
    toast(tr("Alignement impossible : {message}", { message: err.message }), true);
  }
}

export function carteReservation(r, { avecDossier = true, apres = () => {}, ecart = null } = {}) {
  const c = clientDe(r);
  const d = dossierDe(r);
  const n = voitNets() ? netReservation(r) : null;
  const ecrit = peut("dossiers.ecrire");
  const e = ecart && r.statut !== "annule" ? ecart(r) : null;
  return h(
    "div",
    { class: "carte-lien statique" },
    h("span", { class: "carte-titre" }, r.libelle),
    h("span", { class: "carte-droite" }, h("strong", null, r.date_service ? formatDate(r.date_service) : tr("Date à fixer")), r.heure_pickup ? h("span", null, tr("pickup {heure_pickup}", { heure_pickup: r.heure_pickup })) : null),
    h("span", { class: "carte-sous" }, [avecDossier && c ? nomClient(c) : "", nomPartenaire(r.partenaire_id), personnesTexte(r.personnes), r.lieu_pickup].filter(Boolean).join(" · ")),
    r.notes ? h("span", { class: "carte-sous" }, r.notes) : null,
    !e
      ? null
      : e.retiree
        ? h("div", { class: "ecart-facture", role: "status" }, tr("La ligne de cette réservation a été retirée du document."))
        : h("div", { class: "ecart-facture", role: "status" }, h("ul", null, e.champs.map((c) => h("li", null, texteEcart(c, ((etat.db.documents.find((x) => x.dossier_id === r.dossier_id && x.type === "facture") || {}).contenu || {}).devise || reglages().devise || "")))), ecrit ? h("button", { class: "secondaire petit", type: "button", onclick: () => aligner(r, e, apres) }, tr("Aligner sur la facture")) : null),
    h(
      "span",
      { class: "carte-pied" },
      h("span", null, ecrit ? selecteurStatut(r, apres) : pastilleReservation(r.statut), r.reference_partenaire ? h("span", { class: "tag" }, r.reference_partenaire) : null, n && n.net_prevu != null ? h("span", { class: "tag" }, n.net_paye != null ? tr("net {prix}, payé", { prix: prix(n.net_prevu) }) : tr("net {prix}", { prix: prix(n.net_prevu) })) : null, avecDossier && d ? h("a", { class: "tag", href: `#/dossier/${d.id}` }, d.ref) : null),
      h("span", { class: "carte-actions" }, r.partenaire_id ? h("button", { class: "secondaire petit", type: "button", onclick: () => messagePartenaire(r) }, tr("Message partenaire")) : null, c ? h("button", { class: "secondaire petit", type: "button", onclick: () => messageClient(r, cleMessageClient(r.date_service, aujourdhui())) }, tr("Message client")) : null, ecrit ? h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal(tr("Réservation"), formulaireReservation(r, () => (fermer(), apres()))); } }, tr("Modifier")) : null)
    )
  );
}

export const listeReservations = (rs, opts) => h("ul", { class: "cartes" }, rs.map((r) => h("li", { class: "carte" }, carteReservation(r, opts))));

// Supprime une réservation. En mode excursions la facture est la source du dossier : les lignes du service en sortent aussi, sinon elles
// resteraient facturées et affichées (date, prestataire, note sur place) pour un service qui n'existe plus. Renvoie true si c'est fait.
async function supprimerReservation(r) {
  const factures = modeExcursions() ? etat.db.documents.filter((x) => x.dossier_id === r.dossier_id && (x.type === "facture" || x.type === "facture_locale")) : [];
  const changements = factures.map((doc) => ({ doc, suite: contenuSansReservation(doc.contenu, r, { nomPartenaire }) })).filter((x) => x.suite);
  const principale = changements.find((x) => x.doc.type === "facture");
  // Sans le droit de modifier les factures, on ne supprime pas à moitié : la facture garderait le service.
  if (changements.length && !peut("documents.ecrire")) return toast(tr("Ce service figure sur la facture, et votre rôle ne permet pas de la modifier : la réservation n'est pas supprimée."), true), false;
  const phrases = [tr("Supprimer la réservation « {libelle} » ?", { libelle: r.libelle })];
  if (principale) {
    const devise = principale.doc.contenu.devise || reglages().devise;
    phrases.push(tr("Ses lignes sont aussi retirées de la facture, dont le total passe de {avant} à {apres}.", { avant: formatMontant(totaux(principale.doc.contenu).net, devise), apres: formatMontant(totaux(principale.suite.contenu).net, devise) }));
    if (principale.doc.envoye_le) phrases.push(tr("La facture a été envoyée au client le {date} : il faudra lui renvoyer la nouvelle version.", { date: formatDate(principale.doc.envoye_le) }));
  }
  if (changements.some((x) => x.doc.type === "facture_locale")) phrases.push(tr("La facture locale est mise à jour aussi."));
  if (!(await confirmer(phrases.join(" "), tr("Supprimer"), true))) return false;
  try {
    for (const { doc, suite } of changements) await modifier("documents", doc.id, { contenu: suite.contenu, updated_at: new Date().toISOString() });
    await supprimer("reservations", r.id);
    await synchroniserDatesDossier(r.dossier_id);
    return true;
  } catch (err) {
    toast(tr("Suppression impossible : {message}", { message: err.message }), true);
    return false;
  }
}

export function formulaireReservation(r, apres) {
  const nets = voitNets() && peut("dossiers.ecrire");
  const n = r.id && nets ? netReservation(r) : null;
  const p = r.personnes || {};
  const libelle = h("input", { id: "r-lib", value: r.libelle || "", required: true });
  const partenaire = h("select", { id: "r-part" }, h("option", { value: "" }, tr("Sans partenaire")), etat.db.partenaires.filter((x) => x.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom)).map((x) => h("option", { value: x.id }, x.nom)));
  partenaire.value = r.partenaire_id || "";
  const date = h("input", { id: "r-date", type: "date", value: r.date_service || "" });
  const heure = h("input", { id: "r-heure", type: "time", value: r.heure_pickup || "" });
  const lieu = h("input", { id: "r-lieu", value: r.lieu_pickup || "", placeholder: tr("Hôtel, chambre, vol") });
  const adultes = h("input", { id: "r-ad", type: "number", min: "0", step: "1", value: p.adultes ?? 1, inputmode: "numeric" });
  const enfants = h("input", { id: "r-enf", type: "number", min: "0", step: "1", value: p.enfants ?? 0, inputmode: "numeric" });
  const bebes = h("input", { id: "r-beb", type: "number", min: "0", step: "1", value: p.bebes ?? 0, inputmode: "numeric" });
  const statut = h("select", { id: "r-statut" }, Object.entries(STATUTS_RESERVATION).map(([v, l]) => h("option", { value: v }, tr(l))));
  statut.value = r.statut || "a_demander";
  const reference = h("input", { id: "r-ref", value: r.reference_partenaire || "", placeholder: tr("Numéro donné par le partenaire") });
  const vente = h("input", { id: "r-vente", type: "number", min: "0", step: "1", value: r.montant_vente ?? "", inputmode: "numeric" });
  const netPrevu = h("input", { id: "r-net", type: "number", min: "0", step: "1", value: n && n.net_prevu != null ? n.net_prevu : "", inputmode: "numeric" });
  const netPaye = h("input", { id: "r-paye", type: "number", min: "0", step: "1", value: n && n.net_paye != null ? n.net_paye : "", inputmode: "numeric" });
  const payeLe = h("input", { id: "r-paye-le", type: "date", value: (n && n.paye_le) || "" });
  // Service payé directement au prestataire : pas de net à lui verser, c'est lui qui reverse une commission. Quand la réservation vient d'une ligne
  // de facture, la case change aussi les lignes du document (avec confirmation du nouveau total).
  const lieeFacture = !!(r.ligne_id || (r.details && r.details.lignes_ids && r.details.lignes_ids.length));
  const surPlace = puceMode({ id: "r-place", valeur: modeReglement(r), onchange: () => (majCommission(), proposerCommission()) });
  const estSurPlace = () => surPlace.valeur() === SUR_PLACE;
  const commissionPrevue = h("input", { id: "r-com", type: "number", min: "0", step: "any", value: n && n.commission_prevue != null ? n.commission_prevue : "", inputmode: "decimal" });
  const commissionRecue = h("input", { id: "r-com-recue", type: "number", min: "0", step: "any", value: n && n.commission_recue != null ? n.commission_recue : "", inputmode: "decimal" });
  const commissionLe = h("input", { id: "r-com-le", type: "date", value: (n && n.commission_recue_le) || "" });
  const regleCommission = h("span", null);
  // La commission attendue se calcule d'après la règle chiffrée du partenaire tant qu'on ne l'a pas saisie soi-même.
  let commissionSaisie = commissionPrevue.value !== "";
  commissionPrevue.addEventListener("input", () => (commissionSaisie = commissionPrevue.value !== ""));
  const proposerCommission = () => {
    if (!nets || !estSurPlace() || commissionSaisie) return;
    const c = commissionPrevue_(regleCommissionDe(partenaire.value || null), { vente: num(vente.value), net: num(netPrevu.value), adultes: num(adultes.value) || 0, enfants: num(enfants.value) || 0 });
    if (c !== null) commissionPrevue.value = String(c);
  };
  const majCommission = () => {
    const p = partenaireDe(partenaire.value);
    const regle = p && nets ? commissionsPartenaire(p, privePartenaire(p), true).join(" ") : "";
    const chiffree = nets && regleCommissionDe(partenaire.value || null);
    regleCommission.textContent = chiffree ? tr("Calculée d'après la règle de ce partenaire. Vous pouvez la corriger.") : regle ? tr("Règle de la fiche partenaire : {regle}", { regle }) : tr("Ce que le prestataire reversera après la prestation.");
    blocCommission.style.display = estSurPlace() ? "" : "none";
  };
  const blocCommission = h("div", { class: "grille-form compacte" }, champ(tr("Commission prévue"), commissionPrevue, regleCommission), champ(tr("Commission reçue"), commissionRecue), champ(tr("Reçue le"), commissionLe));
  partenaire.addEventListener("change", () => {
    // Une nouvelle réservation prend le mode habituel de son partenaire.
    if (!r.id) surPlace.definir(modeParDefaut(partenaireDe(partenaire.value || null)));
    majCommission();
    proposerCommission();
  });
  for (const x of [vente, adultes, enfants, netPrevu]) x.addEventListener("input", proposerCommission);
  majCommission();
  proposerCommission();
  const notes = h("textarea", { id: "r-notes", rows: 2 });
  notes.value = r.notes || "";
  // Ce qui figure sur le voucher et que la réservation seule ne dit pas.
  const dt = r.details || {};
  const chambre = h("input", { id: "v-chambre", value: dt.chambre || "" });
  const dropOff = h("input", { id: "v-drop", value: dt.drop_off || "", placeholder: tr("Hôtel, embarcadère, aéroport") });
  const vol = h("input", { id: "v-vol", value: dt.vol || "", placeholder: tr("FD 3217") });
  const bagages = h("input", { id: "v-bagages", value: dt.bagages || "", placeholder: tr("2 valises, 1 sac") });
  const typeTour = h("select", { id: "v-tour" }, h("option", { value: "" }, tr("Automatique d'après la prestation")), h("option", { value: "join" }, tr("Join tour")), h("option", { value: "prive" }, tr("Private tour")));
  typeTour.value = dt.type_tour || "";
  const typeTransfert = h("select", { id: "v-transfert" }, h("option", { value: "" }, tr("Automatique d'après la prestation")), h("option", { value: "taxi" }, tr("Private taxi")), h("option", { value: "minivan" }, tr("Private minivan")), h("option", { value: "partage" }, tr("Shared minivan")));
  typeTransfert.value = dt.type_transfert || "";
  const parc = h("select", { id: "v-parc" }, h("option", { value: "" }, tr("Automatique d'après la prestation")), h("option", { value: "inclus" }, tr("Included")), h("option", { value: "non" }, tr("Not included")), h("option", { value: "aucun" }, tr("Ne rien afficher")));
  parc.value = dt.parc || "";
  const parcTexte = h("input", { id: "v-parc-texte", value: dt.parc_texte || "", placeholder: tr("400 THB per adult, 200 THB per child, cash on the island") });
  const remarques = h("textarea", { id: "v-remarques", rows: 2, placeholder: tr("Vu par le client et le prestataire, en anglais") });
  remarques.value = dt.remarques || "";
  const remarquesPaiement = h("input", { id: "v-rem-paiement", value: dt.remarques_paiement || "", placeholder: tr("Deposit 1,000 THB received, balance at the pier") });
  const heureService = h("input", { id: "v-heure-service", value: dt.heure_service || "", placeholder: "10:00 - 12:00" });
  const retourDate = h("input", { id: "v-retour-date", type: "date", value: dt.retour_date || "" });
  const retourHeure = h("input", { id: "v-retour-heure", type: "time", value: dt.retour_heure || "" });
  const permis = h("input", { id: "v-permis", value: dt.permis || "", placeholder: tr("International driving licence shown") });
  const caution = h("input", { id: "v-caution", value: dt.caution || "", placeholder: tr("3,000 THB, returned at drop-off") });
  const embarquement = h("input", { id: "v-embarquement", value: dt.embarquement || "", placeholder: tr("Saladan Pier") });
  const checkin = h("textarea", { id: "v-checkin", rows: 2, placeholder: tr("Check-in at the pier 45 minutes before departure…") });
  checkin.value = dt.checkin || "";
  const bateau = h("input", { id: "v-bateau", value: dt.bateau || "", placeholder: tr("Longtail, speedboat") });
  const programme = h("input", { id: "v-programme", value: dt.programme || "", placeholder: tr("Program A, 10 min session") });
  const details = () => ({ ...dt, chambre: chambre.value.trim(), drop_off: dropOff.value.trim(), vol: vol.value.trim(), bagages: bagages.value.trim(), type_tour: typeTour.value, type_transfert: typeTransfert.value, parc: parc.value, parc_texte: parcTexte.value.trim(), remarques: remarques.value.trim(), remarques_paiement: remarquesPaiement.value.trim(), heure_service: heureService.value.trim(), retour_date: retourDate.value || "", retour_heure: retourHeure.value, permis: permis.value.trim(), caution: caution.value.trim(), embarquement: embarquement.value.trim(), checkin: checkin.value.trim(), bateau: bateau.value.trim(), programme: programme.value.trim() });
  // Le bloc Voucher ne montre que les champs du modèle de cette prestation.
  const prestation = r.prestation_id ? etat.db.prestations.find((p) => p.id === r.prestation_id) || null : null;
  const type = typeVoucher(r, prestation, partenaireDe(r.partenaire_id));
  const CHAMPS = {
    chambre: () => champ(tr("Chambre"), chambre, tr("Sinon celle de l'adresse du client.")),
    drop_off: () => champ(tr("Drop-off"), dropOff),
    vol: () => champ(tr("Numéro de vol"), vol),
    bagages: () => champ(tr("Bagages"), bagages),
    type_tour: () => champ(tr("Type de tour"), typeTour),
    type_transfert: () => champ(tr("Type de transfert"), typeTransfert),
    parc: () => champ(tr("Frais de parc"), parc),
    parc_texte: () => champ(tr("Texte des frais de parc"), parcTexte),
    heure_service: () => champ(tr("Horaire de l'activité"), heureService, tr("Imprimé après la date.")),
    retour_date: () => champ(tr("Date de retour"), retourDate),
    retour_heure: () => champ(tr("Heure de retour"), retourHeure),
    permis: () => champ(tr("Permis de conduire"), permis),
    caution: () => champ(tr("Caution"), caution),
    embarquement: () => champ(tr("Embarcadère ou point de check-in"), embarquement, tr("Sinon celui de la compagnie pour le lieu de départ.")),
    checkin: () => champ(tr("Consigne de check-in"), checkin, tr("Sinon celle de la compagnie, en anglais.")),
    bateau: () => champ(tr("Bateau"), bateau, tr("Sinon celui de la prestation.")),
    programme: () => champ(tr("Programme ou option"), programme, tr("Sinon le groupe de la prestation.")),
    remarques: () => champ(tr("Remarques sur le voucher"), remarques),
    remarques_paiement: () => champ(tr("Remarque de paiement"), remarquesPaiement),
  };
  const blocVoucher = type
    ? h("fieldset", null, h("legend", null, TITRES_VOUCHER[type]), h("p", { class: "aide" }, tr("Ce qui s'imprime sur ce voucher en plus de la réservation. En automatique, le type et les frais de parc sont déduits de la prestation.")), h("div", { class: "grille-form" }, (CHAMPS_VOUCHER[type] || []).filter((c) => !["remarques", "remarques_paiement", "checkin"].includes(c)).map((c) => CHAMPS[c]())), (CHAMPS_VOUCHER[type] || []).filter((c) => ["checkin", "remarques", "remarques_paiement"].includes(c)).map((c) => CHAMPS[c]()))
    : null;
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        const valeurs = { libelle: libelle.value.trim(), partenaire_id: partenaire.value || null, date_service: date.value || null, heure_pickup: heure.value, lieu_pickup: lieu.value.trim(), personnes: { adultes: num(adultes.value) || 0, enfants: num(enfants.value) || 0, bebes: num(bebes.value) || 0 }, statut: statut.value, reference_partenaire: reference.value.trim(), montant_vente: num(vente.value), paye_sur_place: estSurPlace(), notes: notes.value.trim(), details: details() };
        try {
          // Le paiement sur place change le total de la facture : on montre le nouveau total avant d'enregistrer.
          const changements = [];
          if (lieeFacture && r.id && estSurPlace() !== !!r.paye_sur_place) {
            await chargerDossier(r.dossier_id);
            for (const doc of etat.db.documents.filter((x) => x.dossier_id === r.dossier_id)) {
              const suite = contenuAvecSurPlace(doc.contenu, r, estSurPlace());
              if (suite) changements.push({ doc, suite });
            }
            if (changements.length && !peut("documents.ecrire")) return toast(tr("Ce service figure sur la facture, et votre rôle ne permet pas de la modifier : le réglage n'est pas changé."), true);
            const principale = changements.find((x) => x.doc.type !== "devis") || changements[0];
            if (principale) {
              const devise = principale.doc.contenu.devise || reglages().devise;
              const phrase = tr("Les lignes de ce service passent sur la facture {sens}, dont le total passe de {avant} à {apres}.", { sens: estSurPlace() ? tr("« sur place »") : tr("« chez nous »"), avant: formatMontant(totaux(principale.doc.contenu).net, devise), apres: formatMontant(totaux(principale.suite).net, devise) });
              // Une facture qui n'est pas encore partie se met à jour sans question. Une facture déjà envoyée demande confirmation : le client doit recevoir la nouvelle version.
              if (principale.doc.envoye_le) {
                if (!(await confirmer(`${phrase} ${tr("La facture a été envoyée au client le {date} : il faudra lui renvoyer la nouvelle version.", { date: formatDate(principale.doc.envoye_le) })}`, tr("Enregistrer")))) return;
              } else toast(phrase);
            }
          }
          for (const { doc, suite } of changements) await modifier("documents", doc.id, { contenu: suite, updated_at: new Date().toISOString() });
          const res = r.id ? await modifier("reservations", r.id, { ...valeurs, updated_at: new Date().toISOString() }) : await inserer("reservations", { dossier_id: r.dossier_id, ligne_id: r.ligne_id || "", prestation_id: r.prestation_id || null, trajet_id: r.trajet_id || null, ...valeurs });
          if (res && res.id && res.details === undefined) res.details = valeurs.details;
          if (nets && (netPrevu.value !== "" || netPaye.value !== "" || payeLe.value || commissionPrevue.value !== "" || commissionRecue.value !== "" || commissionLe.value || n)) await enregistrerLie("reservations_nets", "reservation_id", res.id, { net_prevu: num(netPrevu.value), net_paye: num(netPaye.value), paye_le: payeLe.value || null, commission_prevue: num(commissionPrevue.value), commission_recue: num(commissionRecue.value), commission_recue_le: commissionLe.value || null });
          toast(tr("Réservation enregistrée."));
          apres(res);
        } catch (err) {
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    champ(tr("Prestation"), libelle),
    h("div", { class: "grille-form" }, champ(tr("Partenaire"), partenaire), champ(tr("Statut"), statut), champ(tr("Référence du partenaire"), reference)),
    h("div", { class: "grille-form compacte" }, champ(tr("Date du service"), date), champ(tr("Heure de pickup"), heure), champ(tr("Lieu de pickup"), lieu)),
    h("div", { class: "grille-form compacte" }, champ(tr("Adultes"), adultes), champ(tr("Enfants"), enfants), champ(tr("Bébés"), bebes), peut("finances.voir") ? champ(tr("Vendu au client"), vente) : null),
    h("div", { class: "champ champ-mode" }, h("span", { class: "etiquette" }, tr("Règlement")), surPlace, h("p", { class: "aide" }, tr("« Sur place » : le client paie le prestataire, qui reverse une commission. Rien à verser au prestataire ni à encaisser."))),
    nets ? h("div", { class: "grille-form compacte" }, champ(tr("Net prévu"), netPrevu, tr("Ce que le partenaire facturera. Sans objet pour un service payé sur place.")), champ(tr("Net payé"), netPaye), champ(tr("Payé le"), payeLe)) : null,
    nets ? blocCommission : null,
    champ(tr("Notes internes"), notes, tr("Jamais sur le voucher.")),
    blocVoucher,
    h("div", { class: "actions" }, r.id && peut("dossiers.ecrire") ? h("button", { class: "danger", type: "button", onclick: async () => { if (await supprimerReservation(r)) apres(null); } }, tr("Supprimer")) : null, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
  );
}

// Crée une réservation par ligne de partenaire du document qui n'en a pas encore.
export async function creerReservations(doc) {
  const existantes = etat.db.reservations.filter((r) => r.dossier_id === doc.dossier_id);
  const nouvelles = reservationsDepuisDocument(doc, { existantes, regleDe: regleCommissionDe });
  if (!nouvelles.length) return toast(tr("Toutes les lignes de partenaires ont déjà leur réservation."));
  let n = 0;
  for (const { reservation, net, commission_prevue } of nouvelles) {
    try {
      const { id, ...sansId } = reservation;
      const res = await inserer("reservations", sansId);
      if ((net !== null || commission_prevue !== undefined) && voitNets() && peut("dossiers.ecrire")) await enregistrerLie("reservations_nets", "reservation_id", res.id, { net_prevu: net, net_paye: null, paye_le: null, ...(commission_prevue !== undefined ? { commission_prevue } : {}) });
      n++;
    } catch (err) {
      toast(tr("Une réservation n'a pas pu être créée : {message}", { message: err.message }), true);
    }
  }
  await synchroniserDatesDossier(doc.dossier_id);
  toast(pluriel(n, N_("{n} réservation créée, à demander aux partenaires."), N_("{n} réservations créées, à demander aux partenaires.")));
}

// En mode excursions, les dates du dossier sont celles de ses réservations : première et dernière date de service.
export async function synchroniserDatesDossier(dossierId) {
  if (!modeExcursions()) return;
  const d = etat.db.dossiers.find((x) => x.id === dossierId);
  if (!d) return;
  const dates = datesDepuisReservations(etat.db.reservations.filter((r) => r.dossier_id === dossierId));
  if (dates.date_depart !== (d.date_depart || null) || dates.date_retour !== (d.date_retour || null)) await modifier("dossiers", dossierId, dates);
}

// Ajouter des services à un dossier existant : les lignes vont dans la facture (créée si besoin), puis chacune a sa réservation.
export function ajouterServices(d, doc, apres) {
  const regl = reglages();
  const langue = /invoice/i.test((regl.libelles && regl.libelles.facture) || "") ? "en" : "";
  let cibleId = doc ? doc.id : null;
  // La fenêtre reste ouverte pour enchaîner les ajouts : un à la fois, chacun sur la version courante de la facture.
  let file = Promise.resolve();
  async function ajouter(nouvelles) {
    try {
      const lignes = nouvelles.map((l) => ({ ...l, titre: l.kind === "texte" ? undefined : l.libelle, libelle: l.kind === "texte" ? l.libelle : descriptionService(l, langue), intro: "" }));
      let cible = cibleId ? etat.db.documents.find((x) => x.id === cibleId) : null;
      if (!cible) {
        cible = await inserer("documents", { dossier_id: d.id, type: "facture", date_emission: aujourdhui(), envoye_le: null, updated_at: new Date().toISOString(), contenu: { ...CONTENU_DEFAUT(), colonnes: "total", langue, variante: (regl.textes.variantes[0] || {}).id || "", equivalents: { actif: false }, lignes: [] } });
        cibleId = cible.id;
      }
      const contenu = structuredClone(cible.contenu);
      contenu.lignes = [...(contenu.lignes || []), ...lignes];
      const partenaires = [...new Set(contenu.lignes.map((l) => nomPartenaire(l.partenaire_id)).filter(Boolean))];
      if (partenaires.length) contenu.prestataire = partenaires.join(", ");
      const maj = await modifier("documents", cible.id, { contenu, updated_at: new Date().toISOString() });
      await creerReservations(maj);
      apres();
    } catch (err) {
      toast(tr("Ajout impossible : {message}", { message: err.message }), true);
    }
  }
  choisirPrestation({ langue, devise: regl.devise, sansCompagnie: true, dossierId: d.id, onAjout: (nouvelles) => (file = file.then(() => ajouter(nouvelles))) });
}

export function sectionReservationsDossier(d, doc) {
  const rs = etat.db.reservations.filter((r) => r.dossier_id === d.id).sort((a, b) => (a.date_service || "9999").localeCompare(b.date_service || "9999"));
  const ecrit = peut("dossiers.ecrire");
  const rafraichir = () => naviguer(location.hash);
  const manquantes = doc ? reservationsDepuisDocument(doc, { existantes: rs }).length : 0;
  return h(
    "section",
    null,
    h(
      "div",
      { class: "entete petit-entete" },
      h("h2", null, tr("Réservations auprès des partenaires")),
      ecrit
        ? h("div", { class: "entete-actions" }, manquantes ? h("button", { class: "principal petit", type: "button", onclick: async () => (await creerReservations(doc), rafraichir()) }, (doc.type === "devis" ? pluriel(manquantes, N_("Créer {n} réservation depuis le devis"), N_("Créer {n} réservations depuis le devis")) : pluriel(manquantes, N_("Créer {n} réservation depuis la facture"), N_("Créer {n} réservations depuis la facture")))) : null, modeExcursions() ? h("button", { class: "principal petit", type: "button", onclick: () => ajouterServices(d, doc, rafraichir) }, tr("Ajouter un service")) : null, h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal(tr("Nouvelle réservation"), formulaireReservation({ dossier_id: d.id, date_service: d.date_depart || "" }, () => (fermer(), rafraichir()))); } }, modeExcursions() ? tr("Réservation à la main") : tr("Nouvelle réservation")))
        : null
    ),
    rs.length ? listeReservations(rs, { avecDossier: false, apres: rafraichir, ecart: doc ? (r) => ecartReservation(r, doc) : null }) : h("p", { class: "vide-court" }, doc && manquantes ? tr("Les lignes de partenaires du document peuvent devenir des réservations en un clic.") : modeExcursions() ? tr("Aucune réservation. « Ajouter un service » met la prestation sur la facture et crée sa réservation.") : tr("Aucune réservation. Elles se créent depuis les lignes de partenaires du devis, ou à la main."))
  );
}

// ---- Écran Réservations -------------------------------------------------------------------------------------
export function vueReservations() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const ajd = aujourdhui();
  const periode = h("select", { id: "f-periode", onchange: () => dessiner() }, h("option", { value: "avenir" }, tr("À venir et sans date")), h("option", { value: "passees" }, tr("Passées")), h("option", { value: "toutes" }, tr("Toutes")));
  periode.value = params.get("periode") || "avenir";
  const statut = h("select", { id: "f-statut", onchange: () => dessiner() }, h("option", { value: "" }, tr("Tous les statuts")), h("option", { value: "ouvertes" }, tr("À demander ou demandées")), Object.entries(STATUTS_RESERVATION).map(([v, l]) => h("option", { value: v }, tr(l))));
  statut.value = params.get("statut") || "";
  const partenaire = h("select", { id: "f-part", onchange: () => dessiner() }, h("option", { value: "" }, tr("Tous les partenaires")), etat.db.partenaires.filter((p) => etat.db.reservations.some((r) => r.partenaire_id === p.id)).sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => h("option", { value: p.id }, p.nom)));
  partenaire.value = params.get("partenaire") || "";
  const q = h("input", { id: "f-q", type: "search", placeholder: tr("Client, prestation, hôtel, référence"), oninput: () => dessiner() });
  const corps = h("div");
  const rafraichir = () => naviguer(location.hash);
  const sans = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function dessiner() {
    const p = new URLSearchParams();
    for (const [k, v] of [["periode", periode.value], ["statut", statut.value], ["partenaire", partenaire.value]]) if (v && !(k === "periode" && v === "avenir")) p.set(k, v);
    history.replaceState(null, "", `#/reservations${p.toString() ? `?${p}` : ""}`);
    const mots = sans(q.value).split(/\s+/).filter(Boolean);
    // Une réservation d'un dossier annulé s'affiche comme annulée, même si on ne l'a pas encore marquée.
    const annules = dossiersAnnules();
    const rs = etat.db.reservations
      .map((r) => (annules.has(r.dossier_id) && r.statut !== "annule" ? { ...r, statut: "annule" } : r))
      .filter((r) => (periode.value === "toutes" ? true : periode.value === "passees" ? r.date_service && r.date_service < ajd : !r.date_service || r.date_service >= ajd))
      .filter((r) => (!statut.value ? true : statut.value === "ouvertes" ? r.statut === "a_demander" || r.statut === "demande" : r.statut === statut.value))
      .filter((r) => !partenaire.value || r.partenaire_id === partenaire.value)
      .filter((r) => { const c = clientDe(r); const t = sans(`${r.libelle} ${c ? nomClient(c) : ""} ${r.lieu_pickup} ${r.reference_partenaire} ${nomPartenaire(r.partenaire_id)}`); return mots.every((m) => t.includes(m)); })
      .sort((a, b) => (periode.value === "passees" ? -1 : 1) * ((a.date_service || "9999").localeCompare(b.date_service || "9999") || (a.heure_pickup || "99").localeCompare(b.heure_pickup || "99")));
    corps.replaceChildren();
    if (!rs.length) return corps.append(vide(tr("Aucune réservation ne correspond"), etat.db.reservations.length ? tr("Changez la période, le statut ou le partenaire.") : tr("Les réservations se créent depuis la fiche d'un dossier, à partir des lignes de partenaires du devis.")));
    const jours = [...new Set(rs.map((r) => r.date_service || ""))];
    for (const jour of jours) {
      const du = rs.filter((r) => (r.date_service || "") === jour);
      const titre = jour === "" ? tr("Sans date") : jour === ajd ? tr("Aujourd'hui, {dateTexte}", { dateTexte: dateTexte(jour) }) : jour === ajouter(ajd, 1) ? tr("Demain, {dateTexte}", { dateTexte: dateTexte(jour) }) : dateTexte(jour);
      corps.append(h("section", { class: "jour" }, h("h2", { class: "jour-titre" }, titre, h("span", { class: "tag" }, du.length)), listeReservations(du, { apres: rafraichir })));
    }
  }
  dessiner();
  return h(
    "div",
    { "data-titre": tr("Réservations") },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Réservations")), h("p", { class: "sous" }, tr("Ce qui est à demander, demandé ou confirmé auprès des partenaires, jour par jour."))), h("div", { class: "entete-actions" }, h("button", { class: "secondaire", type: "button", onclick: ouvrirFeuilleDuJour }, tr("Feuille du jour")), h("a", { class: "bouton secondaire", href: "#/messages" }, tr("Messages types")))),
    h("div", { class: "barre-outils chercheur" }, h("div", { class: "champ" }, h("label", { for: "f-periode" }, tr("Période")), periode), h("div", { class: "champ" }, h("label", { for: "f-statut" }, tr("Statut")), statut), h("div", { class: "champ" }, h("label", { for: "f-part" }, tr("Partenaire")), partenaire), h("div", { class: "champ recherche" }, h("label", { for: "f-q" }, tr("Rechercher")), q)),
    corps
  );
}

const ajouter = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
export { formatMontant };
