// Réservations auprès des partenaires : liste, formulaire, section d'un dossier, messages.
import { etat, dossiersAnnules, peut, inserer, modifier, modifierProtege, supprimer, naviguer, nomClient, nomPartenaire, partenaireDe, privePartenaire, netReservation, enregistrerLie, chargerDossier, reglages, entiteActive, modeExcursions, modeTaxi } from "../etat.mjs";
import { blocZonesPickup } from "./pickup-zones.mjs";
import { champsVoucher, champsCourts, champsLongs } from "./champs-voucher.mjs";
import { heureAPoser } from "../pickup-calc.mjs";
import { h, champ, modal, confirmer, toast, num, saisie, erreurChamp, focusPremiereErreur, icone } from "../ui.mjs";
import { formatMontant, formatDate, aujourdhui, totaux, modeReglement, SUR_PLACE } from "../calc.mjs";
import { STATUTS_RESERVATION, reservationsDepuisDocument, variablesMessage, personnesTexte, dateTexte, typeVoucher, CHAMPS_VOUCHER, TITRES_VOUCHER, datesDepuisReservations, descriptionService, ecartReservation, contenuSansReservation, contenuAvecSurPlace, contenuAvecReservation, contenuAvecServiceDuplique, attenduDepuisFacture, modeParDefaut, commissionPrevue as commissionPrevue_, lieuParDefaut, notePasseport, alerteAvantVeille, dateFinService, locationEnCours, cleMessageReservation, langueClient } from "../operations-calc.mjs";
import { choisirPrestation } from "./choix-prestation.mjs";
import { demanderArbitrage } from "./conflit.mjs";
import { CONTENU_DEFAUT } from "../defauts.mjs";
import { vide, barreFiltres, lienDossier } from "./commun.mjs";
import { ouvrirMessage } from "./messages.mjs";
import { prix, voitNets } from "./partenaires.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { telWhatsApp, commissionsPartenaire } from "../partenaires-calc.mjs";
import { puceMode, regleCommissionDe } from "./mode-reglement.mjs";
import { rattacherCourseTaxi, lieeFacture, texteEcart, suivreFacture, appliquerChangements, questionAnnulation, proposerDePrevenir, synchroniserDatesDossier } from "./suivi-facture.mjs";
export { synchroniserDatesDossier };
import { ouvrirFeuilleDuJour } from "./feuille-jour.mjs";
import { gestesPrestataire, messageAuPrestataire as prevenirPrestataire } from "./prestataire.mjs";
import { vouchersDuDossier } from "./voucher.mjs";
import { envoyerVoucher } from "./voucher-envoi.mjs";
import { gestePrincipal, entreesMenu } from "../carte-reservation-calc.mjs";
import { commissionARecalculer, recalculerUneCommission, ecartCommissionRecue } from "./recalcul-commission.mjs";

export const pastilleReservation = (code) => h("span", { class: `statut r-${code}` }, h("span", { class: "point", "aria-hidden": "true" }), (STATUTS_RESERVATION[code] ? tr(STATUTS_RESERVATION[code]) : code));
const dossierDe = (r) => etat.db.dossiers.find((d) => d.id === r.dossier_id) || null;
const clientDe = (r) => { const d = dossierDe(r); return d ? etat.db.clients.find((c) => c.id === d.client_id) || null : null; };
const entreprise = () => ({ nom: reglages().emetteur.nom || entiteActive().nom, telephone: reglages().emetteur.telephone || "", lien_avis: (reglages().emetteur.lien_avis || "").trim(), devise: reglages().devise || "" });

export function messagePartenaire(r) {
  const p = partenaireDe(r.partenaire_id);
  // Mr. Brown (Taxi) ne lit pas l'anglais : le thaï est proposé d'abord. Le choix fait pour un numéro reste mémorisé.
  const langue = modeTaxi() ? "th" : "en";
  ouvrirMessage({ titre: p ? tr("Message à {nom}", { nom: p.nom }) : tr("Message au partenaire"), pour: "partenaire", cle: "partenaire", langue, telephone: telWhatsApp(p), vars: variablesMessage({ reservation: r, client: clientDe(r) || {}, dossier: dossierDe(r) || {}, partenaire: p || {}, entreprise: entreprise(), langue }) });
}
// `surEnvoi` : appelée quand le message part (WhatsApp ouvert) ou est copié, par exemple pour noter que l'avis a été demandé.
export function messageClient(r, cle = "confirmation", { surEnvoi = null } = {}) {
  const c = clientDe(r) || {};
  // Taxi n'a pas de rappel de la veille ni de message météo : le message d'envoi de la confirmation est proposé à la place.
  if (modeTaxi() && cle !== "avis" && !(reglages().messages || []).some((m) => m.cle === cle)) cle = "confirmation";
  // Les clients de Secret et de Taxi reçoivent tout en anglais (d'après le mode de l'entreprise) : le message est proposé en anglais aussi.
  const langue = langueClient(reglages());
  // Trajet vers ou depuis Langkawi : la confirmation et le rappel portent la note du passeport et du check-in (en anglais, comme les vouchers).
  const trajet = r.trajet_id ? etat.db.trajets.find((t) => t.id === r.trajet_id) : null;
  const suite = langue === "en" && (cle === "confirmation" || cle === "rappel") ? notePasseport({ de: trajet && trajet.de, vers: trajet && trajet.vers, libelle: r.libelle, compagnie: nomPartenaire(r.partenaire_id) }) : "";
  ouvrirMessage({ titre: tr("Message à {nomClient}", { nomClient: nomClient(c) }), pour: "client", cle, langue, telephone: c.telephone || "", surEnvoi, suite, vars: variablesMessage({ reservation: r, client: c, dossier: dossierDe(r) || {}, partenaire: partenaireDe(r.partenaire_id) || {}, entreprise: entreprise(), langue }) });
}

// Le service a eu lieu : il sort des retards et des à confirmer (confirmée, avec la date de ce constat).
async function serviceFait(r, apres) {
  try {
    await modifier("reservations", r.id, { statut: "confirme", details: { ...(r.details || {}), fait_le: aujourdhui() } });
    toast(tr("Noté : le service s'est bien passé."));
    apres();
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
  }
}

// Changer le statut d'une réservation d'un geste, sans ouvrir le formulaire complet.
// Annuler un service d'un geste : la facture est mise à jour (ou laissée telle quelle, au choix) et le prestataire peut être prévenu. Renvoie true si c'est fait.
async function annulerService(r, apres) {
  try {
    let retirer = false;
    if (lieeFacture(r)) {
      await chargerDossier(r.dossier_id);
      const choix = await questionAnnulation(r, etat.db.documents.filter((x) => x.dossier_id === r.dossier_id));
      if (choix === null) return false;
      retirer = choix === "retirer";
    }
    if (retirer) {
      const suivi = await suivreFacture(r, { statut: "annule" }, { avant: {}, apres: {}, retirer: true, dejaConfirme: true });
      if (!suivi) return false;
      await appliquerChangements(suivi.changements);
    }
    await modifier("reservations", r.id, { statut: "annule" });
    await synchroniserDatesDossier(r.dossier_id);
    apres();
    proposerDePrevenir(r, "annulation", prevenirPrestataire);
    return true;
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    return false;
  }
}

// Change le statut d'une réservation. Annuler passe par le parcours complet (facture, prestataire). Renvoie true si c'est fait.
async function appliquerStatut(r, valeur, apres) {
  if (valeur === r.statut) return true;
  if (valeur === "annule") return annulerService(r, apres);
  try {
    await modifier("reservations", r.id, { statut: valeur });
    apres();
    return true;
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    return false;
  }
}

// Feuille de choix du statut : la réservation suit d'habitude le geste principal de sa carte, ce choix sert aux corrections.
function choisirStatut(r, apres) {
  const fermer = modal(
    tr("Statut de la réservation « {libelle} »", { libelle: r.libelle }),
    h(
      "div",
      { class: "modal-corps menu-gestes" },
      Object.entries(STATUTS_RESERVATION).map(([v, l]) =>
        h("button", { class: `secondaire menu-geste${v === r.statut ? " courant" : ""}`, type: "button", "aria-current": v === r.statut ? "true" : "false", onclick: () => (fermer(), appliquerStatut(r, v, apres)) }, pastilleReservation(v))
      )
    ),
    { feuille: true, protege: false }
  );
}

// Fenêtre de modification complète de la réservation.
function ouvrirModification(r, apres) {
  const fermer = modal(tr("Réservation"), formulaireReservation(r, () => (fermer(), apres())), { brouillon: `reservation:${r.id}` });
}

// Menu « … » d'une carte : les gestes qui ne sont pas le geste principal.
function ouvrirMenu(r, entrees) {
  const fermer = modal(
    r.libelle,
    h("div", { class: "modal-corps menu-gestes" }, entrees.map(([libelle, fait]) => h("button", { class: "secondaire menu-geste", type: "button", onclick: () => (fermer(), fait()) }, libelle))),
    { feuille: true, protege: false }
  );
}

// L'autre sens : la facture reprend la date, les personnes et le mode de règlement de la réservation (le montant, lui, reste celui de la facture).
async function alignerFacture(r, ecart, apres) {
  const a = ecart.attendu;
  try {
    const suivi = await suivreFacture(r, {}, { avant: { date_service: a.date_service, personnes: a.personnes }, apres: { date_service: r.date_service, personnes: r.personnes }, mode: !!r.paye_sur_place !== a.paye_sur_place ? { surPlace: !!r.paye_sur_place } : null });
    if (!suivi) return;
    await appliquerChangements(suivi.changements);
    toast(tr("Facture alignée sur la réservation."));
    apres();
  } catch (err) {
    toast(tr("Alignement impossible : {message}", { message: err.message }), true);
  }
}

// Remet la réservation d'après les lignes de la facture : date, adultes et enfants (les bébés restent), montant vendu.
async function aligner(r, ecart, apres) {
  const a = ecart.attendu;
  try {
    await modifier("reservations", r.id, { date_service: a.date_service, personnes: { ...(r.personnes || {}), adultes: a.personnes.adultes, enfants: a.personnes.enfants }, ...(a.montant_vente === null ? {} : { montant_vente: a.montant_vente }), paye_sur_place: a.paye_sur_place, ...(a.jours ? { details: { ...(r.details || {}), jours: a.jours } } : {}) });
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
  const cc = r.statut !== "annule" && r.paye_sur_place ? commissionARecalculer(r) : null;
  const er = r.statut !== "annule" && r.paye_sur_place ? ecartCommissionRecue(r) : null;
  // Bundhaya se paie d'avance : à reverser au prestataire avant la veille du départ (traversées qui ne partent pas de Koh Lanta).
  const trajetBateau = r.trajet_id ? etat.db.trajets.find((t) => t.id === r.trajet_id) : null;
  const enCours = r.statut !== "annule" && locationEnCours(r, aujourdhui());
  const avantVeille = alerteAvantVeille(r, { partenaire: nomPartenaire(r.partenaire_id), trajet: trajetBateau, paye: !!(n && n.net_prevu !== null && n.net_prevu !== undefined && Number(n.net_paye || 0) >= Number(n.net_prevu)) });
  // Un seul geste principal par carte (l'étape suivante) ; le reste est dans le menu « … ».
  const gestes = ecrit ? gestesPrestataire(r, { apres }) : { etat: null, faire: {}, relancer: false, jourDeDemande: false };
  // Le geste « Envoyer le voucher » n'existe qu'en excursions et en taxi : ZTP n'a pas de voucher.
  const vx = modeExcursions() && r.statut === "confirme" ? vouchersDuDossier(r.dossier_id).find((x) => x.reservation.id === r.id) || null : null;
  const voucherEnvoye = !!(vx && r.details && r.details.envois && r.details.envois.client);
  const ctx = { statut: r.statut, ecrit, aPartenaire: !!r.partenaire_id, aClient: !!c, passee: !!(r.date_service && dateFinService(r) < aujourdhui()), relancer: gestes.relancer, jourDeDemande: gestes.jourDeDemande, voucher: vx ? { envoye: voucherEnvoye } : null, liee: modeExcursions() && lieeFacture(r) };
  const GESTES = {
    fait: [tr("S'est bien passé"), () => serviceFait(r, apres)],
    demander: [tr("Demander au prestataire"), gestes.faire.demander],
    confirmer: [tr("Confirmée"), gestes.faire.confirmer],
    relancer: [tr("Relancer"), gestes.faire.relancer],
    autre_reponse: [tr("Autre réponse"), gestes.faire.autre_reponse],
    pas_envoyee: [tr("Le message n'est pas parti ? Remettre à demander"), gestes.faire.pas_envoyee],
    changer: [tr("Changer le jour, l'heure ou les personnes"), gestes.faire.changer],
    message_partenaire: [tr("Message partenaire"), () => messagePartenaire(r)],
    message_client: [tr("Message client"), () => messageClient(r, cleMessageReservation(r, aujourdhui()))],
    modifier: [tr("Modifier"), () => ouvrirModification(r, apres)],
    dupliquer: [tr("Dupliquer"), () => dupliquerService(r, apres)],
    voucher: [voucherEnvoye ? tr("Renvoyer le voucher") : tr("Envoyer le voucher"), () => vx && envoyerVoucher(vx)],
    statut: [tr("Changer le statut"), () => choisirStatut(r, apres)],
  };
  const principal = gestePrincipal(ctx);
  const menu = entreesMenu(ctx);
  const barre = principal || menu.length
    ? h(
        "div",
        { class: principal ? "carte-barre" : "carte-barre seul" },
        principal ? h("button", { class: "principal", type: "button", onclick: GESTES[principal][1] }, GESTES[principal][0]) : null,
        menu.length ? h("button", { class: "secondaire bouton-menu", type: "button", "aria-haspopup": "dialog", "aria-label": tr("Plus d'actions : {libelle}", { libelle: r.libelle }), title: tr("Plus d'actions"), onclick: () => ouvrirMenu(r, menu.map((k) => GESTES[k])) }, icone("ellipsis", 22)) : null
      )
    : null;
  return h(
    "div",
    { class: "carte-lien statique" },
    h("span", { class: "carte-titre" }, avecDossier ? lienDossier(r.libelle, r.dossier_id) : r.libelle),
    h("span", { class: "carte-droite" }, h("strong", null, r.date_service ? formatDate(r.date_service) : tr("Date à fixer")), r.heure_pickup ? h("span", null, tr("pickup {heure_pickup}", { heure_pickup: r.heure_pickup })) : null),
    h("span", { class: "carte-sous" }, [avecDossier && c ? nomClient(c) : "", nomPartenaire(r.partenaire_id), personnesTexte(r.personnes), r.lieu_pickup].filter(Boolean).join(" · ")),
    r.notes ? h("span", { class: "carte-sous" }, r.notes) : null,
    // Une location commencée et pas encore rendue : ni en retard ni à confirmer, l'avis et la commission attendent le retour.
    enCours ? h("div", { class: "etat-en-cours", role: "status" }, dateFinService(r) === aujourdhui() ? tr("Location en cours, retour aujourd'hui") : tr("Location en cours jusqu'au {date}", { date: formatDate(dateFinService(r)) })) : null,
    !e
      ? null
      : e.retiree
        ? h("div", { class: "ecart-facture", role: "status" }, tr("La ligne de cette réservation a été retirée du document."))
        : h("div", { class: "ecart-facture", role: "status" }, h("ul", null, e.champs.map((c) => h("li", null, texteEcart(c, ((etat.db.documents.find((x) => x.dossier_id === r.dossier_id && x.type === "facture") || {}).contenu || {}).devise || reglages().devise || "")))), ecrit ? h("div", { class: "actions gauche" }, h("button", { class: "secondaire petit", type: "button", onclick: () => aligner(r, e, apres) }, tr("Aligner sur la facture")), peut("documents.ecrire") && e.champs.some((c) => ["date_service", "personnes", "paye_sur_place"].includes(c.cle)) ? h("button", { class: "secondaire petit", type: "button", onclick: () => alignerFacture(r, e, apres) }, tr("Mettre la facture comme la réservation")) : null) : null),
    avantVeille ? h("div", { class: "ecart-facture", role: "status" }, tr("À payer au prestataire avant le {date} (la veille du départ) : Bundhaya peut annuler si ce n'est pas payé.", { date: formatDate(avantVeille.avant) })) : null,
    er ? h("div", { class: "ecart-facture", role: "status" }, tr("Commission reçue {recue} (prévue {prevue}), mais la règle du partenaire donne {attendue}. Les montants reçus ne sont pas modifiés : vérifiez le net du tarif ou la règle.", { recue: prix(er.recue === null ? er.prevue : er.recue), prevue: prix(er.prevue), attendue: prix(er.attendue) })) : null,
    cc ? h("div", { class: "recalcul-commission", role: "status" }, h("span", null, cc.avant === null ? tr("Commission prévue : aucune. La règle du partenaire donne {apres}.", { apres: prix(cc.apres) }) : tr("Commission prévue : {avant}. La règle du partenaire donne {apres}.", { avant: prix(cc.avant), apres: prix(cc.apres) })), h("button", { class: "secondaire petit", type: "button", onclick: () => recalculerUneCommission(r, apres) }, tr("Recalculer la commission"))) : null,
    h(
      "span",
      { class: "carte-pied" },
      h("span", null, pastilleReservation(r.statut), r.reference_partenaire ? h("span", { class: "tag" }, r.reference_partenaire) : null, r.paye_sur_place ? h("span", { class: "tag" }, tr("Sur place")) : null, !r.paye_sur_place && n && n.net_prevu != null ? h("span", { class: "tag" }, n.net_paye != null ? tr("net {prix}, payé", { prix: prix(n.net_prevu) }) : tr("net {prix}", { prix: prix(n.net_prevu) })) : null, voucherEnvoye ? h("span", { class: "tag" }, tr("Voucher envoyé")) : null, avecDossier && d ? h("a", { class: "tag", href: `#/dossier/${d.id}` }, d.ref) : null)
    ),
    gestes.etat,
    barre
  );
}


// Dupliquer un service : une fenêtre demande le jour du double, puis ses lignes sont copiées sur la facture (ou le devis qui les porte) avec ce jour, et sa
// réservation est une copie de l'originale (même prestataire, pickup, net et commission prévus), à redemander, avec les personnes et le prix que portent
// les lignes copiées : la facture et la réservation du double sont d'accord dès le départ.
export async function dupliquerService(r, apres) {
  await chargerDossier(r.dossier_id);
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  const doc = [...etat.db.documents.filter((x) => x.dossier_id === r.dossier_id)].sort((a, b) => (a.type === "facture" ? 0 : 1) - (b.type === "facture" ? 0 : 1)).find((x) => (x.contenu.lignes || []).some((l) => ids.has(l.id)));
  if (!doc) return toast(tr("Ce service ne figure sur aucun document : utilisez « Réservation à la main »."), true);
  if (!peut("documents.ecrire")) return toast(tr("Ce service figure sur la facture, et votre rôle ne permet pas de la modifier."), true);
  const jour = h("input", { id: "dup-jour", type: "date", value: r.date_service || "" });
  const faire = async () => {
    const copie = contenuAvecServiceDuplique(doc.contenu, r);
    if (!copie) return toast(tr("Ce service ne figure sur aucun document : utilisez « Réservation à la main »."), true);
    const nouvellesLignes = copie.contenu.lignes.map((l) => (copie.ids.includes(l.id) ? { ...l, date_service: jour.value || null } : l));
    copie.contenu = { ...copie.contenu, lignes: nouvellesLignes };
    const attendu = attenduDepuisFacture({ ligne_id: copie.ids[0], details: copie.ids.length > 1 ? { lignes_ids: copie.ids } : {} }, { contenu: copie.contenu });
    if (doc.envoye_le && !(await confirmer(tr("Dupliquer « {libelle} » ajoute des lignes à un document déjà envoyé le {date} : il faudra renvoyer la nouvelle version au client.", { libelle: r.libelle, date: formatDate(doc.envoye_le) }), tr("Dupliquer")))) return;
    let nouvelle = null;
    try {
      // La réservation d'abord : si le document ne suit pas, on la retire et rien ne reste facturé sans réservation.
      nouvelle = await inserer("reservations", {
        dossier_id: r.dossier_id, ligne_id: copie.ids[0], prestation_id: r.prestation_id || null, trajet_id: r.trajet_id || null, partenaire_id: r.partenaire_id || null,
        libelle: r.libelle, date_service: jour.value || null, heure_pickup: r.heure_pickup || "", lieu_pickup: r.lieu_pickup || "",
        personnes: { ...(r.personnes || {}), adultes: attendu.personnes.adultes, enfants: attendu.personnes.enfants },
        statut: "a_demander", reference_partenaire: "", montant_vente: attendu.montant_vente ?? r.montant_vente ?? null, notes: "", paye_sur_place: !!r.paye_sur_place,
        details: copie.ids.length > 1 ? { lignes_ids: copie.ids } : {},
      });
      try {
        await modifier("documents", doc.id, { contenu: copie.contenu, updated_at: new Date().toISOString() });
      } catch (err) {
        await supprimer("reservations", nouvelle.id).catch(() => {});
        throw err;
      }
      const n = voitNets() && peut("dossiers.ecrire") ? netReservation(r) : null;
      if (n && (n.net_prevu != null || n.commission_prevue != null)) await enregistrerLie("reservations_nets", "reservation_id", nouvelle.id, { net_prevu: n.net_prevu ?? null, net_paye: null, paye_le: null, commission_prevue: n.commission_prevue ?? null, commission_recue: null, commission_recue_le: null });
      await synchroniserDatesDossier(r.dossier_id);
      toast(tr("Service dupliqué."));
      apres();
    } catch (err) {
      toast(tr("Duplication impossible : {message}", { message: err.message }), true);
    }
  };
  const fermer = modal(
    tr("Dupliquer le service"),
    h(
      "div",
      { class: "modal-corps" },
      h("p", { class: "aide" }, r.libelle),
      champ(tr("Jour du double"), jour),
      h("p", { class: "aide" }, tr("Les lignes du service sont copiées sur le document, et sa réservation est à redemander au prestataire.")),
      h("div", { class: "actions" }, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Annuler")), h("button", { class: "principal", type: "button", onclick: () => (fermer(), faire()) }, tr("Dupliquer")))
    ),
    { protege: false }
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

// Nombre saisi au clavier du téléphone : la virgule décimale est acceptée.
const nb = (v) => num(String(v ?? "").trim().replace(",", "."));

// Deux personnes sur la même réservation : les champs changés d'un seul côté se gardent, un champ changé des deux côtés est soumis au choix.
const ETIQUETTES_RESERVATION = { libelle: N_("Prestation"), partenaire_id: N_("Partenaire"), statut: N_("Statut"), reference_partenaire: N_("Référence du partenaire"), date_service: N_("Date du service"), heure_pickup: N_("Heure de pickup"), lieu_pickup: N_("Lieu de pickup"), personnes: N_("Personnes"), notes: N_("Notes"), montant_vente: N_("Montant vendu"), paye_sur_place: N_("Paiement") };
const arbitrerReservation = (r) => ({ conflits, courante, par }) =>
  demanderArbitrage({
    conflits, par, titreFiche: tr("La réservation « {libelle} »", { libelle: r.libelle || "" }),
    etiquettes: Object.fromEntries(Object.entries(ETIQUETTES_RESERVATION).map(([k, v]) => [k, tr(v)])),
    format: (cle, v) => (cle === "partenaire_id" ? (v ? nomPartenaire(v) : tr("Sans partenaire")) : cle === "statut" ? (STATUTS_RESERVATION[v] ? tr(STATUTS_RESERVATION[v]) : v) : cle === "date_service" ? (v ? formatDate(v) : tr("Date à fixer")) : cle === "paye_sur_place" ? (v ? tr("sur place") : tr("chez nous")) : cle.startsWith("personnes.") ? (v === null || v === undefined ? "0" : String(v)) : null),
  });

export function formulaireReservation(r, apres) {
  const nets = voitNets() && peut("dossiers.ecrire");
  const n = r.id && nets ? netReservation(r) : null;
  const p = r.personnes || {};
  const libelle = h("input", { id: "r-lib", value: r.libelle || "", "aria-required": "true", autocomplete: "off" });
  const partenaire = h("select", { id: "r-part" }, h("option", { value: "" }, tr("Sans partenaire")), etat.db.partenaires.filter((x) => x.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom)).map((x) => h("option", { value: x.id }, x.nom)));
  partenaire.value = r.partenaire_id || "";
  const date = h("input", { id: "r-date", type: "date", value: r.date_service || "" });
  const heure = h("input", { id: "r-heure", type: "time", value: r.heure_pickup || "" });
  const lieu = h("input", { id: "r-lieu", value: r.lieu_pickup || "", placeholder: tr("Hôtel, chambre, vol") });
  const adultes = saisie(h("input", { id: "r-ad", value: p.adultes ?? 1 }), "entier");
  const enfants = saisie(h("input", { id: "r-enf", value: p.enfants ?? 0 }), "entier");
  const bebes = saisie(h("input", { id: "r-beb", value: p.bebes ?? 0 }), "entier");
  const statut = h("select", { id: "r-statut" }, Object.entries(STATUTS_RESERVATION).map(([v, l]) => h("option", { value: v }, tr(l))));
  statut.value = r.statut || "a_demander";
  const reference = h("input", { id: "r-ref", value: r.reference_partenaire || "", placeholder: tr("Numéro donné par le partenaire") });
  const vente = saisie(h("input", { id: "r-vente", value: r.montant_vente ?? "" }), "montant");
  const venteInitiale = vente.value;
  const netPrevu = saisie(h("input", { id: "r-net", value: n && n.net_prevu != null ? n.net_prevu : "" }), "montant");
  const netPaye = saisie(h("input", { id: "r-paye", value: n && n.net_paye != null ? n.net_paye : "" }), "montant");
  const payeLe = h("input", { id: "r-paye-le", type: "date", value: (n && n.paye_le) || "" });
  // Service payé directement au prestataire : pas de net à lui verser, c'est lui qui reverse une commission. Quand la réservation vient d'une ligne
  // de facture, la case change aussi les lignes du document (avec confirmation du nouveau total).
  const lieeFacture = !!(r.ligne_id || (r.details && r.details.lignes_ids && r.details.lignes_ids.length));
  const surPlace = puceMode({ id: "r-place", valeur: modeReglement(r), onchange: () => (majCommission(), proposerCommission()) });
  const estSurPlace = () => surPlace.valeur() === SUR_PLACE;
  const commissionPrevue = saisie(h("input", { id: "r-com", value: n && n.commission_prevue != null ? n.commission_prevue : "" }), "montant");
  const commissionRecue = saisie(h("input", { id: "r-com-recue", value: n && n.commission_recue != null ? n.commission_recue : "" }), "montant");
  const commissionLe = h("input", { id: "r-com-le", type: "date", value: (n && n.commission_recue_le) || "" });
  const regleCommission = h("span", null);
  // La commission attendue se calcule d'après la règle chiffrée du partenaire tant qu'on ne l'a pas saisie soi-même.
  let commissionSaisie = commissionPrevue.value !== "";
  commissionPrevue.addEventListener("input", () => (commissionSaisie = commissionPrevue.value !== ""));
  const proposerCommission = () => {
    if (!nets || !estSurPlace() || commissionSaisie) return;
    const c = commissionPrevue_(regleCommissionDe(partenaire.value || null), { vente: nb(vente.value), net: nb(netPrevu.value), adultes: nb(adultes.value) || 0, enfants: nb(enfants.value) || 0 });
    if (c !== null) commissionPrevue.value = String(c);
  };
  const majCommission = () => {
    const p = partenaireDe(partenaire.value);
    const regle = p && nets ? commissionsPartenaire(p, privePartenaire(p), true).join(" ") : "";
    const chiffree = nets && regleCommissionDe(partenaire.value || null);
    regleCommission.textContent = chiffree ? tr("Calculée d'après la règle de ce partenaire. Vous pouvez la corriger.") : regle ? tr("Règle de la fiche partenaire : {regle}", { regle }) : tr("Ce que le prestataire reversera après la prestation.");
    blocCommission.style.display = estSurPlace() ? "" : "none";
    blocNets.style.display = estSurPlace() ? "none" : "";
  };
  // Un service payé sur place ne doit rien au prestataire : le net n'a pas lieu d'être saisi.
  const blocNets = h("div", { class: "grille-form compacte" }, champ(tr("Net prévu"), netPrevu, tr("Ce que le partenaire facturera à l'agence.")), champ(tr("Net payé"), netPaye), champ(tr("Payé le"), payeLe));
  const blocCommission = h("div", { class: "grille-form compacte" }, champ(tr("Commission prévue"), commissionPrevue, regleCommission), champ(tr("Commission reçue"), commissionRecue), champ(tr("Reçue le"), commissionLe));
  partenaire.addEventListener("change", () => {
    // Une nouvelle réservation prend le mode habituel de son partenaire.
    if (!r.id) surPlace.definir(modeParDefaut(partenaireDe(partenaire.value || null)));
    majCommission();
    proposerCommission();
  });
  for (const x of [vente, adultes, enfants, netPrevu]) x.addEventListener("input", proposerCommission);
  // Une erreur disparaît dès que le champ est corrigé.
  for (const x of [libelle, adultes, enfants, bebes, vente, netPrevu, netPaye, commissionPrevue, commissionRecue]) x.addEventListener("input", () => erreurChamp(x, null));
  majCommission();
  proposerCommission();
  const notes = h("textarea", { id: "r-notes", rows: 2 });
  notes.value = r.notes || "";
  // Ce qui figure sur le voucher et que la réservation seule ne dit pas.
  const dt = r.details || {};
  const cv = champsVoucher({ details: dt, prefixe: "v", dateService: () => date.value, dateInitiale: r.date_service });
  // Zone de l'hôtel sur la grille de pickup du partenaire : la zone et le départ remplissent l'heure, sans écraser une heure tapée à la main.
  let heureDeGrille = "";
  const zonesPickup = blocZonesPickup({
    id: "r-zones",
    partenaire: () => partenaireDe(partenaire.value || null),
    hotel: () => lieu.value,
    gardee: dt.pickup_zone || null,
    trajet: () => etat.db.trajets.find((t) => t.id === r.trajet_id) || null,
    surChoix: ({ heure: h2 }) => {
      const n = heureAPoser({ actuelle: heure.value, derniereGrille: heureDeGrille, nouvelle: h2 });
      if (n !== null) (heure.value = n), (heureDeGrille = n);
    },
  });
  // L'heure enregistrée est celle de la grille tant qu'elle lui est égale : un autre choix de zone la remplace, une heure tapée à la main reste.
  if (zonesPickup.valeur() && zonesPickup.heure() === heure.value) heureDeGrille = heure.value;
  partenaire.addEventListener("change", () => zonesPickup.rafraichir());
  lieu.addEventListener("change", () => zonesPickup.rafraichir());
  const zoneGardee = () => (zonesPickup.valeur() ? { pickup_zone: zonesPickup.valeur() } : {});
  const details = () => ({ ...Object.fromEntries(Object.entries(dt).filter(([k]) => k !== "pickup_zone")), ...zoneGardee(), ...cv.valeurs() });
  // Le bloc Voucher ne montre que les champs du modèle de cette prestation.
  const prestation = r.prestation_id ? etat.db.prestations.find((p) => p.id === r.prestation_id) || null : null;
  const type = typeVoucher(r, prestation, partenaireDe(r.partenaire_id));
  date.addEventListener("change", cv.majJours);
  const CHAMPS = cv.CHAMPS;
  // Une location : la prise et le retour se lisent côte à côte, juste sous la date de départ.
  const RETOUR = ["retour_date", "retour_heure", "retour_lieu"];
  // Le bloc voucher n'existe qu'en excursions (Secret) ; Taxi n'a que ce qui s'imprime sur sa Booking confirmation (dépose, vol, bagages et sièges,
  // voir renderBookingConfirmation) ; ZTP n'en a aucun.
  const avecVoucher = modeExcursions() && !modeTaxi();
  const blocRetour = avecVoucher && type === "location" ? h("div", { class: "grille-form compacte" }, RETOUR.map((c) => CHAMPS[c]())) : null;
  const blocVoucher = modeTaxi()
    ? h("fieldset", null, h("legend", null, "Booking confirmation"), h("p", { class: "aide" }, tr("Ce qui s'imprime sur la Booking confirmation en plus de la course.")), h("div", { class: "grille-form" }, CHAMPS.drop_off(), CHAMPS.vol(), CHAMPS.bagages(), CHAMPS.sieges()))
    : avecVoucher && type
    ? h("fieldset", null, h("legend", null, TITRES_VOUCHER[type]), h("p", { class: "aide" }, tr("Ce qui s'imprime sur ce voucher en plus de la réservation. En automatique, le type et les frais de parc sont déduits de la prestation.")), h("div", { class: "grille-form" }, champsCourts(CHAMPS_VOUCHER[type] || [], type === "location" ? RETOUR : []).map((c) => CHAMPS[c]())), champsLongs(CHAMPS_VOUCHER[type] || []).map((c) => CHAMPS[c]()))
    : null;
  return h(
    "form",
    {
      class: "modal-corps formulaire-reservation",
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        // Les erreurs s'affichent sous le champ concerné, le premier champ en erreur prend le focus.
        const champsNombres = [adultes, enfants, bebes, vente, netPrevu, netPaye, commissionPrevue, commissionRecue];
        for (const c of [libelle, ...champsNombres]) erreurChamp(c, null);
        if (!libelle.value.trim()) erreurChamp(libelle, tr("Indiquez la prestation."));
        for (const c of champsNombres) {
          if (c.value.trim() === "") continue;
          const v = nb(c.value);
          if (v === null) erreurChamp(c, tr("Saisissez un nombre."));
          else if (v < 0) erreurChamp(c, tr("Le nombre ne peut pas être négatif."));
        }
        if (focusPremiereErreur(e.target)) return;
        const valeurs = { libelle: libelle.value.trim(), partenaire_id: partenaire.value || null, date_service: date.value || null, heure_pickup: heure.value, lieu_pickup: lieu.value.trim(), personnes: { adultes: nb(adultes.value) || 0, enfants: nb(enfants.value) || 0, bebes: nb(bebes.value) || 0 }, statut: statut.value, reference_partenaire: reference.value.trim(), montant_vente: nb(vente.value), paye_sur_place: estSurPlace(), notes: notes.value.trim(), details: details() };
        try {
          // La facture suit la réservation (mode de règlement, date, personnes, annulation) par le chemin commun : total montré, confirmation si elle est partie.
          const modeChange = estSurPlace() !== !!r.paye_sur_place;
          const dateChangee = (valeurs.date_service || null) !== (r.date_service || null);
          const annulee = !!r.id && valeurs.statut === "annule" && r.statut !== "annule";
          let retirer = false;
          if (annulee && lieeFacture(r)) {
            await chargerDossier(r.dossier_id);
            const choix = await questionAnnulation(r, etat.db.documents.filter((x) => x.dossier_id === r.dossier_id));
            if (choix === null) return;
            retirer = choix === "retirer";
          }
          const suivi = await suivreFacture(r, valeurs, { avant: { date_service: r.date_service, personnes: r.personnes }, apres: { date_service: valeurs.date_service, personnes: valeurs.personnes }, mode: modeChange ? { surPlace: estSurPlace() } : null, retirer, dejaConfirme: retirer, montantSuit: vente.value === venteInitiale });
          if (!suivi) return;
          const { changements, ecartRestant } = suivi;
          if (suivi.montantVente !== null) valeurs.montant_vente = suivi.montantVente;
          await appliquerChangements(changements);
          const res = r.id ? await modifierProtege("reservations", r.id, valeurs, { base: r, arbitrer: arbitrerReservation(r) }) : await inserer("reservations", { dossier_id: r.dossier_id, ligne_id: r.ligne_id || "", prestation_id: r.prestation_id || null, trajet_id: r.trajet_id || null, ...valeurs });
          if (res && res.id && res.details === undefined) res.details = valeurs.details;
          if (!r.id) await rattacherCourseTaxi(res);
          if (nets && (netPrevu.value !== "" || netPaye.value !== "" || payeLe.value || commissionPrevue.value !== "" || commissionRecue.value !== "" || commissionLe.value || n)) await enregistrerLie("reservations_nets", "reservation_id", res.id, { net_prevu: nb(netPrevu.value), net_paye: nb(netPaye.value), paye_le: payeLe.value || null, commission_prevue: nb(commissionPrevue.value), commission_recue: nb(commissionRecue.value), commission_recue_le: commissionLe.value || null });
          if (r.id && (dateChangee || annulee)) await synchroniserDatesDossier(r.dossier_id);
          toast(ecartRestant && ecartRestant.length ? `${tr("Réservation enregistrée.")} ${tr("La facture garde l'ancienne valeur, à corriger dans la facture :")} ${ecartRestant.join(" ; ")}` : tr("Réservation enregistrée."));
          apres(res);
          if (annulee) proposerDePrevenir(r, "annulation", prevenirPrestataire);
        } catch (err) {
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    champ(tr("Prestation"), libelle),
    h("div", { class: "grille-form" }, champ(tr("Partenaire"), partenaire), champ(tr("Statut"), statut), champ(tr("Référence du partenaire"), reference)),
    h("div", { class: "grille-form compacte" }, champ(type === "location" ? tr("Date de départ") : tr("Date du service"), date), champ(type === "location" ? tr("Heure de départ") : tr("Heure de pickup"), heure), champ(type === "location" ? tr("Lieu de départ ou de livraison") : tr("Lieu de pickup"), lieu)),
    zonesPickup.noeud,
    blocRetour,
    // Une location se compte en jours : ni adultes ni enfants à demander (les nombres déjà saisis sont conservés). Les bébés ne figurent que sur les billets de bateau.
    h("div", { class: "grille-form compacte" }, type === "location" ? null : champ(tr("Adultes"), adultes), type === "location" ? null : champ(tr("Enfants"), enfants), type === null || type === "billet" ? champ(tr("Bébés"), bebes) : null, peut("finances.voir") ? champ(tr("Vendu au client"), vente) : null),
    h("div", { class: "champ champ-mode" }, h("span", { class: "etiquette" }, tr("Règlement")), surPlace, h("p", { class: "aide" }, tr("« Sur place » : le client paie le prestataire, qui reverse une commission. Rien à verser au prestataire ni à encaisser."))),
    nets ? blocNets : null,
    nets ? blocCommission : null,
    champ(tr("Notes internes"), notes, tr("Jamais sur le voucher.")),
    blocVoucher,
    // Supprimer à part, loin d'Enregistrer : un geste destructeur ne se tape pas par erreur en validant.
    r.id && peut("dossiers.ecrire") ? h("div", { class: "actions gauche" }, h("button", { class: "danger", type: "button", onclick: async () => { if (await supprimerReservation(r)) apres(null); } }, tr("Supprimer"))) : null,
    h("div", { class: "actions" }, h("button", { class: "secondaire", type: "button", onclick: () => apres(null) }, tr("Annuler")), h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
  );
}

// Crée une réservation par ligne de partenaire du document qui n'en a pas encore.
export async function creerReservations(doc, { silencieux = false } = {}) {
  const existantes = etat.db.reservations.filter((r) => r.dossier_id === doc.dossier_id);
  const nouvelles = reservationsDepuisDocument(doc, { existantes, regleDe: regleCommissionDe });
  const dossier = etat.db.dossiers.find((d) => d.id === doc.dossier_id);
  const clientDuDossier = (dossier && etat.db.clients.find((c) => c.id === dossier.client_id)) || {};
  if (!nouvelles.length) return toast(tr("Toutes les lignes de partenaires ont déjà leur réservation."));
  let n = 0;
  for (const { reservation, net, commission_prevue } of nouvelles) {
    try {
      const { id, ...sansId } = reservation;
      // Le lieu de pickup du dossier est repris (dernier service, sinon adresse du client) : un service ajouté ne part pas sans lieu.
      sansId.lieu_pickup = sansId.lieu_pickup || lieuParDefaut([...existantes, ...etat.db.reservations.filter((x) => x.dossier_id === doc.dossier_id && !existantes.includes(x))], clientDuDossier);
      const res = await inserer("reservations", sansId);
      if ((net !== null || commission_prevue !== undefined) && voitNets() && peut("dossiers.ecrire")) await enregistrerLie("reservations_nets", "reservation_id", res.id, { net_prevu: net, net_paye: null, paye_le: null, ...(commission_prevue !== undefined ? { commission_prevue } : {}) });
      n++;
    } catch (err) {
      toast(tr("Une réservation n'a pas pu être créée : {message}", { message: err.message }), true);
    }
  }
  await synchroniserDatesDossier(doc.dossier_id);
  if (!silencieux) toast(pluriel(n, N_("{n} réservation créée, à demander aux partenaires."), N_("{n} réservations créées, à demander aux partenaires.")));
}


// Ajouter des services à un dossier existant : les lignes vont dans la facture (créée si besoin), puis chacune a sa réservation.
export function ajouterServices(d, doc, apres) {
  const regl = reglages();
  const langue = langueClient(regl) === "en" ? "en" : "";
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
        ? h("div", { class: "entete-actions" }, manquantes ? h("button", { class: "principal petit", type: "button", onclick: async () => (await creerReservations(doc), rafraichir()) }, (doc.type === "devis" ? pluriel(manquantes, N_("Créer {n} réservation depuis le devis"), N_("Créer {n} réservations depuis le devis")) : pluriel(manquantes, N_("Créer {n} réservation depuis la facture"), N_("Créer {n} réservations depuis la facture")))) : null, modeExcursions() ? h("button", { class: "principal petit", type: "button", onclick: () => ajouterServices(d, doc, rafraichir) }, tr("Ajouter un service")) : null, h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal(tr("Nouvelle réservation"), formulaireReservation({ dossier_id: d.id, date_service: d.date_depart || "" }, () => (fermer(), rafraichir())), { brouillon: `reservation-nouvelle:${d.id}` }); } }, modeExcursions() ? tr("Réservation à la main") : tr("Nouvelle réservation")))
        : null
    ),
    rs.length ? listeReservations(rs, { avecDossier: false, apres: rafraichir, ecart: doc && !modeTaxi() ? (r) => ecartReservation(r, doc) : null }) : h("p", { class: "vide-court" }, doc && manquantes ? tr("Les lignes de partenaires du document peuvent devenir des réservations en un clic.") : modeExcursions() ? tr("Aucune réservation. « Ajouter un service » met la prestation sur la facture et crée sa réservation.") : tr("Aucune réservation. Elles se créent depuis les lignes de partenaires du devis, ou à la main."))
  );
}

// ---- Écran Réservations -------------------------------------------------------------------------------------
export function vueReservations() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const ajd = aujourdhui();
  // Recherche collante, période en puces, statut et partenaire dans la feuille « Filtrer » (à plat sur ordinateur).
  const filtre = { periode: params.get("periode") || "avenir", statut: params.get("statut") || "", partenaire: params.get("partenaire") || "", q: "" };
  const barre = barreFiltres({
    recherche: { valeur: "", placeholder: tr("Client, prestation, hôtel, référence"), libelle: tr("Rechercher") },
    puces: { options: [{ valeur: "avenir", libelle: tr("À venir et sans date") }, { valeur: "passees", libelle: tr("Passées") }, { valeur: "toutes", libelle: tr("Toutes") }], valeur: filtre.periode, libelle: tr("Période") },
    filtres: [
      { cle: "statut", libelle: tr("Statut"), type: "select", neutre: "", valeur: filtre.statut, options: [{ valeur: "", libelle: tr("Tous les statuts") }, { valeur: "ouvertes", libelle: tr("À demander ou demandées") }, ...Object.entries(STATUTS_RESERVATION).map(([v, l]) => ({ valeur: v, libelle: tr(l) }))] },
      { cle: "partenaire", libelle: tr("Partenaire"), type: "select", neutre: "", valeur: filtre.partenaire, options: [{ valeur: "", libelle: tr("Tous les partenaires") }, ...etat.db.partenaires.filter((p) => etat.db.reservations.some((r) => r.partenaire_id === p.id)).sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => ({ valeur: p.id, libelle: p.nom }))] },
    ],
    onchange: (v) => {
      Object.assign(filtre, { periode: v.puces, statut: v.statut, partenaire: v.partenaire, q: v.recherche });
      dessiner();
    },
  });
  const corps = h("div");
  const rafraichir = () => naviguer(location.hash);
  const sans = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function dessiner() {
    const p = new URLSearchParams();
    for (const [k, v] of [["periode", filtre.periode], ["statut", filtre.statut], ["partenaire", filtre.partenaire]]) if (v && !(k === "periode" && v === "avenir")) p.set(k, v);
    history.replaceState(null, "", `#/reservations${p.toString() ? `?${p}` : ""}`);
    const mots = sans(filtre.q).split(/\s+/).filter(Boolean);
    // Une réservation d'un dossier annulé s'affiche comme annulée, même si on ne l'a pas encore marquée.
    const annules = dossiersAnnules();
    const rs = etat.db.reservations
      .map((r) => (annules.has(r.dossier_id) && r.statut !== "annule" ? { ...r, statut: "annule" } : r))
      .filter((r) => (filtre.periode === "toutes" ? true : filtre.periode === "passees" ? r.date_service && dateFinService(r) < ajd : !r.date_service || dateFinService(r) >= ajd))
      .filter((r) => (!filtre.statut ? true : filtre.statut === "ouvertes" ? r.statut === "a_demander" || r.statut === "demande" : r.statut === filtre.statut))
      .filter((r) => !filtre.partenaire || r.partenaire_id === filtre.partenaire)
      .filter((r) => { const c = clientDe(r); const t = sans(`${r.libelle} ${c ? nomClient(c) : ""} ${r.lieu_pickup} ${r.reference_partenaire} ${nomPartenaire(r.partenaire_id)}`); return mots.every((m) => t.includes(m)); })
      .sort((a, b) => (filtre.periode === "passees" ? -1 : 1) * ((a.date_service || "9999").localeCompare(b.date_service || "9999") || (a.heure_pickup || "99").localeCompare(b.heure_pickup || "99")));
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
    barre.noeud,
    corps
  );
}

const ajouter = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
export { formatMontant };
