// La facture suit la réservation : un seul chemin pour la date, les personnes, le mode de règlement et l'annulation.
// Le formulaire de réservation, « Changer le jour » du prestataire, l'annulation par le sélecteur et l'alignement sur la facture passent tous par ici :
// le nouveau total est montré avant d'enregistrer, une facture déjà envoyée demande confirmation, et le prestataire peut être prévenu.
import { etat, chargerDossier, peut, reglages, nomPartenaire, modifier, inserer, modeExcursions, modeTaxi } from "../etat.mjs";
import { contenuCourse, ligneCourse } from "../taxi-calc.mjs";
import { uid, CONTENU_DEFAUT } from "../defauts.mjs";
import { h, modal, confirmer, toast } from "../ui.mjs";
import { formatMontant, formatDate, totaux } from "../calc.mjs";
import { contenuAvecSurPlace, contenuAvecReservation, contenuSansReservation, attenduDepuisFacture, ecartReservation, personnesTexte, datesDepuisReservations } from "../operations-calc.mjs";
import { tr } from "../i18n.mjs";

export const lieeFacture = (r) => !!(r.ligne_id || (r.details && r.details.lignes_ids && r.details.lignes_ids.length));

// Texte d'un écart entre la réservation et la facture : « Date : 12 déc. sur la réservation, 14 déc. sur la facture ».
export function texteEcart(c, devise) {
  const v = (x) => (c.cle === "date_service" ? (x ? formatDate(x) : tr("à fixer")) : c.cle === "personnes" ? personnesTexte(x) || "0" : c.cle === "paye_sur_place" ? (x ? tr("sur place") : tr("chez nous")) : formatMontant(x, devise));
  const nom = c.cle === "date_service" ? tr("Date") : c.cle === "personnes" ? tr("Personnes") : c.cle === "paye_sur_place" ? tr("Paiement") : tr("Montant vendu");
  return tr("{nom} : {reservation} sur la réservation, {document} sur la facture", { nom, reservation: v(c.reservation), document: v(c.document) });
}

// Les documents du dossier (devis, factures) avec leur contenu une fois ce service retiré. Vide quand le service n'est sur aucun document.
export function documentsSansService(documents, r) {
  return documents.filter((x) => x.dossier_id === r.dossier_id).map((doc) => ({ doc, suite: (contenuSansReservation(doc.contenu, r, { nomPartenaire }) || {}).contenu })).filter((x) => x.suite);
}

// La facture (et le devis) suivent une modification de la réservation.
//   `avant`, `apres` : { date_service, personnes: { adultes, enfants } } : ce que disait la facture (ou la réservation avant), puis la nouvelle valeur.
//   `mode` : { surPlace } quand le mode de règlement change ; `retirer` : le service quitte la facture (annulation) ;
//   `dejaConfirme` : la personne vient de voir le nouveau total (question d'annulation), inutile de le redemander ;
//   `montantSuit` : le montant vendu de la réservation suit la facture tant qu'on ne l'a pas saisi soi-même.
// Renvoie null quand la personne renonce (ou ne peut pas), sinon { changements, ecartRestant, montantVente } : à l'appelant d'enregistrer les documents.
export async function suivreFacture(r, valeurs, { avant, apres, mode = null, retirer = false, montantSuit = false, dejaConfirme = false }) {
  const resultat = { changements: [], ecartRestant: null, montantVente: null };
  if (modeTaxi()) return suivreCourseTaxi(r, valeurs, retirer, resultat);
  const dateChangee = (apres.date_service || null) !== (avant.date_service || null);
  const pa = avant.personnes || {};
  const pb = apres.personnes || {};
  const personnesChangees = (Number(pb.adultes) || 0) !== (Number(pa.adultes) || 0) || (Number(pb.enfants) || 0) !== (Number(pa.enfants) || 0);
  const modeChange = !!mode;
  if (!(lieeFacture(r) && r.id && (retirer || modeChange || dateChangee || personnesChangees))) return resultat;
  await chargerDossier(r.dossier_id);
  const documents = etat.db.documents.filter((x) => x.dossier_id === r.dossier_id);
  if (retirer) resultat.changements = documentsSansService(documents, r).filter((x) => x.doc.type === "facture" || x.doc.type === "facture_locale");
  else
    for (const doc of documents) {
      let suite = doc.contenu;
      if (modeChange) suite = contenuAvecSurPlace(suite, r, mode.surPlace) || suite;
      if (dateChangee || personnesChangees) suite = contenuAvecReservation(suite, r, avant, apres).contenu || suite;
      if (suite !== doc.contenu) resultat.changements.push({ doc, suite });
    }
  // Sans le droit de modifier les factures : le mode et l'annulation ne se font pas à moitié, mais la date et les personnes s'enregistrent et l'écart reste signalé.
  let factureNonSuivie = false;
  if (resultat.changements.length && !peut("documents.ecrire")) {
    if (modeChange || retirer) return void toast(tr("Ce service figure sur la facture, et votre rôle ne permet pas de la modifier : la modification n'est pas enregistrée."), true);
    resultat.changements.length = 0;
    factureNonSuivie = true;
  }
  const principale = resultat.changements.find((x) => x.doc.type !== "devis") || resultat.changements[0];
  if (principale) {
    const devise = principale.doc.contenu.devise || reglages().devise;
    const total0 = formatMontant(totaux(principale.doc.contenu).net, devise);
    const total1 = formatMontant(totaux(principale.suite).net, devise);
    const phrases = [];
    if (retirer) phrases.push(tr("Les lignes de ce service sont retirées de la facture, dont le total passe de {avant} à {apres}.", { avant: total0, apres: total1 }));
    else if (modeChange) phrases.push(tr("Les lignes de ce service passent sur la facture {sens}, dont le total passe de {avant} à {apres}.", { sens: mode.surPlace ? tr("« sur place »") : tr("« chez nous »"), avant: total0, apres: total1 }));
    else if (total0 !== total1) phrases.push(tr("La facture suit cette modification, et son total passe de {avant} à {apres}.", { avant: total0, apres: total1 }));
    else phrases.push(tr("La facture suit cette modification."));
    if (modeChange && (dateChangee || personnesChangees)) phrases.push(tr("La date et les personnes de ce service y sont aussi mises à jour."));
    const phrase = phrases.join(" ");
    // Le montant vendu suit la facture tant qu'on ne l'a pas saisi soi-même.
    const attendu = attenduDepuisFacture({ ...r, ...valeurs }, { contenu: principale.suite });
    if (montantSuit && (dateChangee || personnesChangees) && attendu && !attendu.retiree && attendu.montant_vente !== null) resultat.montantVente = attendu.montant_vente;
    // Une facture qui n'est pas encore partie se met à jour sans question. Une facture déjà envoyée demande confirmation : le client doit recevoir la nouvelle version.
    if (principale.doc.envoye_le && !dejaConfirme) {
      if (!(await confirmer(`${phrase} ${tr("La facture a été envoyée au client le {date} : il faudra lui renvoyer la nouvelle version.", { date: formatDate(principale.doc.envoye_le) })}`, tr("Enregistrer")))) return null;
    } else if (!dejaConfirme) toast(phrase);
  }
  // Ce que la facture garde en l'état (prix de groupe, montant fixe, enfants sans ligne enfant, rôle sans droit) reste signalé, et visible sur la carte.
  const refDoc = principale ? { contenu: principale.suite } : documents.find((x) => x.type !== "devis");
  const ecart = !retirer && refDoc ? ecartReservation({ ...r, ...valeurs }, refDoc) : null;
  const deviseEcart = (refDoc && refDoc.contenu.devise) || reglages().devise;
  resultat.ecartRestant = ecart && ecart.champs.length ? ecart.champs.filter((c) => c.cle === "date_service" || c.cle === "personnes").map((c) => texteEcart(c, deviseEcart)) : null;
  if (factureNonSuivie) toast(tr("La facture n'a pas suivi : votre rôle ne permet pas de la modifier."), true);
  return resultat;
}

// Taxi : pas de facture montrée, le prix interne suit la course en silence (date, prix, paiement au chauffeur, annulation).
async function suivreCourseTaxi(r, valeurs, retirer, resultat) {
  if (!lieeFacture(r) || !r.id) return resultat;
  await chargerDossier(r.dossier_id);
  const documents = etat.db.documents.filter((x) => x.dossier_id === r.dossier_id && x.type === "facture");
  if (retirer) resultat.changements = documentsSansService(documents, r);
  else for (const doc of documents) {
    const suite = contenuCourse(doc.contenu, { ...r, ...valeurs });
    if (suite) resultat.changements.push({ doc, suite });
  }
  return resultat;
}

// Taxi : une course créée sans ligne (à la main) est ajoutée au prix interne du dossier, qui est créé s'il n'existe pas encore.
export async function rattacherCourseTaxi(r) {
  if (!modeTaxi() || !r || !r.id || lieeFacture(r) || r.statut === "annule") return;
  await chargerDossier(r.dossier_id);
  const id = uid();
  const doc = etat.db.documents.find((x) => x.dossier_id === r.dossier_id && x.type === "facture");
  if (doc) await modifier("documents", doc.id, { contenu: { ...doc.contenu, lignes: [...(doc.contenu.lignes || []), ligneCourse(r, id)] }, updated_at: new Date().toISOString() });
  else await inserer("documents", { dossier_id: r.dossier_id, type: "facture", date_emission: r.date_service || new Date().toISOString().slice(0, 10), envoye_le: null, updated_at: new Date().toISOString(), contenu: { ...CONTENU_DEFAUT(), colonnes: "total", langue: "en", lignes: [ligneCourse(r, id)] } });
  await modifier("reservations", r.id, { ligne_id: id, paye_sur_place: true });
}

export async function appliquerChangements(changements) {
  for (const { doc, suite } of changements) await modifier("documents", doc.id, { contenu: suite, updated_at: new Date().toISOString() });
}

// Annuler un service : trois issues. Retirer aussi ses lignes de la facture (le total baisse), garder la facture telle quelle, ou renoncer.
// Renvoie « retirer », « garder » ou null.
export function questionAnnulation(r, documents) {
  // Taxi : une course annulée sort du prix interne, sans question (aucune facture n'existe aux yeux de la cliente).
  if (modeTaxi()) return Promise.resolve("retirer");
  const sans = documentsSansService(documents, r);
  const principale = sans.find((x) => x.doc.type !== "devis") || sans[0];
  if (!principale) return Promise.resolve("garder");
  const devise = principale.doc.contenu.devise || reglages().devise;
  const phrases = [tr("« {libelle} » figure sur la facture.", { libelle: r.libelle }), tr("En retirant ses lignes, le total passe de {avant} à {apres}.", { avant: formatMontant(totaux(principale.doc.contenu).net, devise), apres: formatMontant(totaux(principale.suite).net, devise) })];
  if (principale.doc.envoye_le) phrases.push(tr("La facture a été envoyée au client le {date} : il faudra lui renvoyer la nouvelle version.", { date: formatDate(principale.doc.envoye_le) }));
  return new Promise((resolve) => {
    let choix = null;
    const fin = (c) => { choix = c; fermer(); };
    const fermer = modal(
      tr("Annuler ce service ?"),
      h(
        "div",
        { class: "modal-corps" },
        h("p", null, phrases.join(" ")),
        h("div", { class: "actions colonne" },
          peut("documents.ecrire") ? h("button", { class: "principal", type: "button", onclick: () => fin("retirer") }, tr("Annuler et retirer de la facture")) : null,
          h("button", { class: "secondaire", type: "button", onclick: () => fin("garder") }, tr("Annuler seulement la réservation")),
          h("button", { class: "lien", type: "button", onclick: () => fin(null) }, tr("Ne pas annuler"))
        )
      ),
      { protege: false, ferme: () => resolve(choix) }
    );
  });
}

// Prévenir le prestataire après un changement : « Prévenir » ouvre le message prêt (modification ou annulation), « Plus tard » ne fait rien.
export function proposerDePrevenir(r, cle, ouvrirMessagePrestataire) {
  if (!r.partenaire_id || !(r.statut === "demande" || r.statut === "confirme")) return;
  const fermer = modal(
    cle === "annulation" ? tr("Prévenir le prestataire de l'annulation ?") : tr("Prévenir le prestataire du changement ?"),
    h(
      "div",
      { class: "modal-corps" },
      h("p", null, cle === "annulation" ? tr("« {libelle} » était déjà demandé : le prestataire doit savoir qu'il est annulé.", { libelle: r.libelle }) : tr("« {libelle} » était déjà demandé : le prestataire doit connaître le changement.", { libelle: r.libelle })),
      h("div", { class: "actions" }, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Plus tard")), h("button", { class: "principal", type: "button", onclick: () => (fermer(), ouvrirMessagePrestataire(r, cle)) }, tr("Prévenir le prestataire")))
    ),
    { protege: false }
  );
}

// En mode excursions, les dates du dossier sont celles de ses réservations : première et dernière date de service.
export async function synchroniserDatesDossier(dossierId) {
  if (!modeExcursions()) return;
  const d = etat.db.dossiers.find((x) => x.id === dossierId);
  if (!d) return;
  const dates = datesDepuisReservations(etat.db.reservations.filter((r) => r.dossier_id === dossierId));
  if (dates.date_depart !== (d.date_depart || null) || dates.date_retour !== (d.date_retour || null)) await modifier("dossiers", dossierId, dates);
}
