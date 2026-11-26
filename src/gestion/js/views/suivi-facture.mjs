// La facture suit la réservation : un seul chemin pour la date, les personnes, le mode de règlement et l'annulation.
// Le formulaire de réservation, « Changer le jour » du prestataire, l'annulation par le sélecteur et l'alignement sur la facture passent tous par ici :
// le nouveau total est montré avant d'enregistrer, une facture déjà envoyée demande confirmation, et le prestataire peut être prévenu.
import { etat, chargerDossier, peut, reglages, nomPartenaire, modifier, inserer, modeExcursions, modeTaxi, netPrestation, netTrajet } from "../etat.mjs";
import { contenuCourse, ligneCourse } from "../taxi-calc.mjs";
import { uid, CONTENU_DEFAUT } from "../defauts.mjs";
import { h, modal, confirmer, toast } from "../ui.mjs";
import { formatMontant, formatDate, totaux, montantSurPlace } from "../calc.mjs";
import { langueClient, contenuAvecSurPlace, contenuAvecReservation, contenuAvecService, contenuSansReservation, attenduDepuisFacture, ecartReservation, personnesTexte, datesDepuisReservations, descriptionService } from "../operations-calc.mjs";
import { prestationEnfant, prixEnfantDe } from "../demande-calc.mjs";
import { contenuAvecEnfants, lignesIdsAvec } from "../dossier-gestes-calc.mjs";
import { tr, langueActive } from "../i18n.mjs";
import { suitePrixDocument } from "../encaisser-calc.mjs";

export const lieeFacture = (r) => !!(r.ligne_id || (r.details && r.details.lignes_ids && r.details.lignes_ids.length));

// Texte d'un écart entre la réservation et la facture : « Date : 12 déc. sur la réservation, 14 déc. sur la facture ».
export function texteEcart(c, devise) {
  const v = (x) => (c.cle === "date_service" ? (x ? formatDate(x) : tr("à fixer")) : c.cle === "personnes" ? personnesTexte(x, langueActive()) || "0" : c.cle === "paye_sur_place" ? (x ? tr("sur place") : tr("chez nous")) : c.cle === "libelle" ? `« ${x} »` : c.cle === "partenaire_id" ? (x ? nomPartenaire(x) : tr("sans partenaire")) : formatMontant(x, devise));
  const nom = c.cle === "date_service" ? tr("Date") : c.cle === "personnes" ? tr("Personnes") : c.cle === "paye_sur_place" ? tr("Paiement") : c.cle === "libelle" ? tr("Prestation") : c.cle === "partenaire_id" ? tr("Partenaire") : tr("Montant vendu");
  return tr("{nom} : {reservation} sur la réservation, {document} sur la facture", { nom, reservation: v(c.reservation), document: v(c.document) });
}

// Ce qui suit sur la facture, en mots : « le libellé, le partenaire et le prix ».
const NOMS_SERVICE = { libelle: () => tr("le libellé"), partenaire_id: () => tr("le partenaire"), prestation_id: () => tr("le tarif"), montant_vente: () => tr("le prix"), options: () => tr("les options") };
const listeService = (cles) => {
  const noms = [...new Set(cles.map((k) => (k === "trajet_id" ? "prestation_id" : k)))].filter((k) => NOMS_SERVICE[k]).map((k) => NOMS_SERVICE[k]());
  return noms.length > 1 ? tr("{debut} et {fin}", { debut: noms.slice(0, -1).join(", "), fin: noms[noms.length - 1] }) : noms[0] || "";
};
// Les options de contenuAvecService tirées de la base en mémoire.
// Le tarif enfant (prix enfant de la prestation, ou prestation enfant séparée) donne le net des lignes enfant (contrôle du 17.11.2026, D4).
// `langueDoc` : la langue des documents de l'entreprise (anglais chez Secret et Taxi), pour une option ajoutée sur la facture.
const optionsService = (personnes) => ({ langueDoc: langueClient(reglages()) === "en" ? "en" : "", prestationDe: (id) => etat.db.prestations.find((p) => p.id === id) || null, netDe: (p) => { const n = netPrestation(p); return n ? n.net : undefined; }, tarifEnfantDe: (pid) => tarifEnfantCatalogue({ prestation_id: pid }), personnes, nomPartenaire });

// Les documents du dossier (devis, factures) avec leur contenu une fois ce service retiré. Vide quand le service n'est sur aucun document.
export function documentsSansService(documents, r) {
  return documents.filter((x) => x.dossier_id === r.dossier_id).map((doc) => ({ doc, suite: (contenuSansReservation(doc.contenu, r, { nomPartenaire }) || {}).contenu })).filter((x) => x.suite);
}

// La facture (et le devis) suivent une modification de la réservation.
//   `avant`, `apres` : { date_service, personnes: { adultes, enfants } } : ce que disait la facture (ou la réservation avant), puis la nouvelle valeur.
//   `mode` : { surPlace } quand le mode de règlement change ; `retirer` : le service quitte la facture (annulation) ;
//   `dejaConfirme` : la personne vient de voir le nouveau total (question d'annulation), inutile de le redemander ;
//   `montantSuit` : le montant vendu de la réservation suit la facture tant qu'on ne l'a pas saisi soi-même.
//   `service` : { libelle, partenaire_id, prestation_id, trajet_id, montant_vente }, ce qui a changé dans la réservation et que les lignes suivent (16.11.2026).
// Renvoie null quand la personne renonce (ou ne peut pas), sinon { changements, ecartRestant, montantVente } : à l'appelant d'enregistrer les documents.
export async function suivreFacture(r, valeurs, { avant, apres, mode = null, retirer = false, montantSuit = false, dejaConfirme = false, service = {} }) {
  const resultat = { changements: [], ecartRestant: null, montantVente: null };
  if (modeTaxi()) return suivreCourseTaxi(r, valeurs, retirer, resultat, service);
  const dateChangee = (apres.date_service || null) !== (avant.date_service || null);
  const pa = avant.personnes || {};
  const pb = apres.personnes || {};
  const personnesChangees = (Number(pb.adultes) || 0) !== (Number(pa.adultes) || 0) || (Number(pb.enfants) || 0) !== (Number(pa.enfants) || 0);
  const modeChange = !!mode;
  const clesService = Object.keys(service || {}).filter((k) => service[k] !== undefined);
  if (!(lieeFacture(r) && r.id && (retirer || modeChange || dateChangee || personnesChangees || clesService.length))) return resultat;
  await chargerDossier(r.dossier_id);
  const documents = etat.db.documents.filter((x) => x.dossier_id === r.dossier_id);
  if (retirer) resultat.changements = documentsSansService(documents, r).filter((x) => x.doc.type === "facture" || x.doc.type === "facture_locale");
  else {
    const s = suitesDocuments(documents, r, { avant, apres, mode, service: clesService.length ? service : null });
    resultat.changements = s.changements;
    resultat.restes = s.restes;
    // Enfant ajouté : la ligne enfant créée sur la facture devient une ligne de cette réservation (sinon elle paraîtrait en écart).
    if (s.ajoutees.length || s.retirees.length) {
      resultat.detailsAvant = { avait: "details" in valeurs, valeur: valeurs.details };
      let ids = null;
      for (const id of s.ajoutees) ids = lignesIdsAvec({ ...r, details: { ...(r.details || {}), ...(ids ? { lignes_ids: ids } : {}) } }, id);
      // Une option retirée de la facture quitte aussi la réservation.
      const actuels = ids || (r.details && r.details.lignes_ids) || [];
      valeurs.details = { ...(valeurs.details || r.details || {}), lignes_ids: actuels.filter((id) => !s.retirees.includes(id)) };
      resultat.details = valeurs.details;
    }
    resultat.raisonEnfant = s.raisonEnfant;
    resultat.enfantAjoute = !!s.enfantAjoute;
  }
  // Sans le droit de modifier les factures : le mode et l'annulation ne se font pas à moitié, mais la date et les personnes s'enregistrent et l'écart reste signalé.
  let factureNonSuivie = false;
  if (resultat.changements.length && !peut("documents.ecrire")) {
    // Les options vivent sur la facture : sans le droit de la modifier, elles ne changent pas (relecture de la PR 359).
    if (modeChange || retirer || (service && service.options)) return void toast(tr("Ce service figure sur la facture, et votre rôle ne permet pas de la modifier : la modification n'est pas enregistrée."), true);
    resultat.changements.length = 0;
    factureNonSuivie = true;
    // La ligne enfant n'est pas écrite : la réservation ne la compte pas.
    if (resultat.details) {
      if (resultat.detailsAvant.avait) valeurs.details = resultat.detailsAvant.valeur;
      else delete valeurs.details;
      resultat.details = null;
    }
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
    if (resultat.details && resultat.enfantAjoute) phrases.push(tr("La ligne enfant est ajoutée au tarif enfant du catalogue."));
    if (resultat.raisonEnfant) phrases.push(texteRaisonEnfant(resultat.raisonEnfant));
    if (clesService.length && !retirer) {
      // Seulement ce que la facture a vraiment pris : un prix réparti sur plusieurs lignes reste à corriger, il est signalé après l'enregistrement.
      const restants = new Set(((ecartReservation({ ...r, ...valeurs }, { contenu: principale.suite }) || {}).champs || []).map((c) => c.cle));
      // Le tarif n'est pas un écart affiché : il est « suivi » seulement si la ligne porte bien le tarif demandé.
      const apres = attenduDepuisFacture(r, { contenu: principale.suite });
      if (apres && !apres.retiree && ((service.prestation_id !== undefined && apres.prestation_id !== (service.prestation_id || null)) || (service.trajet_id !== undefined && apres.trajet_id !== (service.trajet_id || null)))) restants.add("prestation_id");
      const quoi = listeService(clesService.filter((k) => !restants.has(k)));
      if (quoi) phrases.push(tr("Sur la facture, ce service prend aussi {quoi} de la réservation.", { quoi }));
    }
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
  // Seulement ce que cette modification devait faire suivre (date, personnes, et ce qui a changé dans le service).
  const suivis = new Set(["date_service", "personnes", ...clesService]);
  resultat.ecartRestant = ecart && ecart.champs.length ? ecart.champs.filter((c) => suivis.has(c.cle)).map((c) => texteEcart(c, deviseEcart)) : null;
  // Ce qui reste après l'alignement se lit sur la facture (ou la facture locale), même quand seul le devis a changé : la facture telle qu'elle
  // sera enregistrée, sinon telle qu'elle est. L'alignement dit ce qui n'a pas suivi et pourquoi.
  const chFacture = resultat.changements.find((x) => x.doc.type !== "devis") || null;
  const facture = chFacture ? chFacture.doc : documents.find((x) => x.type !== "devis") || null;
  const contenuFacture = chFacture ? chFacture.suite : facture && facture.contenu;
  const ecartFacture = !retirer && contenuFacture ? ecartReservation({ ...r, ...valeurs }, { contenu: contenuFacture }) : null;
  const deviseFacture = (contenuFacture && contenuFacture.devise) || reglages().devise;
  resultat.nonAlignes = ecartFacture && ecartFacture.champs.length ? ecartFacture.champs.filter((c) => suivis.has(c.cle)).map((c) => ({ cle: c.cle, texte: texteEcart(c, deviseFacture) })) : [];
  resultat.resteFacture = (resultat.restes && facture && resultat.restes.get(facture)) || [];
  resultat.lignesService = contenuFacture ? lignesDuService(contenuFacture, r) : 0;
  resultat.documentId = (facture && facture.id) || null;
  resultat.factureChangee = !!chFacture;
  if (factureNonSuivie) toast(tr("La facture n'a pas suivi : votre rôle ne permet pas de la modifier."), true);
  // Rien n'a changé sur la facture mais l'enfant n'y est pas : la raison est dite (avant, aucun total ni message ne s'affichait).
  else if (!principale && resultat.raisonEnfant) toast(texteRaisonEnfant(resultat.raisonEnfant), resultat.raisonEnfant !== "prix_global");
  return resultat;
}

// Le nombre de lignes de prix du service sur un document (adulte, enfant, supplément).
function lignesDuService(contenu, r) {
  const ids = new Set([r.ligne_id, ...((r.details && r.details.lignes_ids) || [])].filter(Boolean));
  return ((contenu && contenu.lignes) || []).filter((l) => ids.has(l.id) && l.kind !== "texte" && l.kind !== "remise").length;
}

// Ce que « Mettre la facture comme la réservation » n'a pas pu faire, et pourquoi, en phrases pour Nani (23.11.2026 : un prix qui ne suivait
// pas restait sans un mot). `nonAlignes` : [{ cle, texte }] (écarts restants) ; `reste` : ce que contenuAvecService a laissé ; `lignes` : lignes du service.
// Renvoie { ecarts: [texte], raisons: [texte] } ; vide quand tout est aligné.
export function raisonsNonAlignees({ nonAlignes = [], reste = [], lignes = 0, raisonEnfant = "" } = {}) {
  const cles = new Set([...nonAlignes.map((c) => c.cle), ...reste.map((x) => (x.cle === "trajet_id" ? "prestation_id" : x.cle))]);
  const raisons = [];
  if (cles.has("montant_vente")) raisons.push(lignes > 1 ? tr("Le prix de ce service est réparti sur {n} lignes de la facture (adulte, enfant ou supplément). Gestion ne devine pas la part de chaque ligne. Corrigez les prix dans la facture, ou alignez la réservation sur la facture.", { n: lignes }) : tr("Le prix de la facture n'a pas pu suivre. Corrigez-le dans la facture, ou alignez la réservation sur la facture."));
  if (cles.has("libelle")) raisons.push(tr("Le nom de la ligne a été réécrit dans la facture. Corrigez-le dans la facture."));
  // Partenaire changé : les options de l'ancien partenaire ont quitté le service (relecture de la PR 359).
  if (cles.has("options")) raisons.push(tr("Les options de l'ancien partenaire ont été retirées de la facture : ajoutez celles du nouveau partenaire dans la réservation."));
  if (cles.has("prestation_id")) raisons.push(tr("Ce service a plusieurs lignes adultes sur la facture. Choisissez le tarif de chaque ligne dans la facture."));
  if (cles.has("personnes") && raisonEnfant) raisons.push(texteRaisonEnfant(raisonEnfant));
  if ((cles.has("personnes") && !raisonEnfant) || cles.has("date_service") || cles.has("partenaire_id")) raisons.push(tr("Corrigez ce qui reste dans la facture, ou alignez la réservation sur la facture."));
  // Le tarif ne s'affiche pas en écart : il est dit à part.
  const ecarts = [...nonAlignes.map((c) => c.texte), ...(cles.has("prestation_id") && !nonAlignes.some((c) => c.cle === "prestation_id") ? [tr("Tarif : celui de la réservation n'est pas sur la facture")] : [])];
  return { ecarts, raisons: [...new Set(raisons)] };
}

// Pourquoi la facture ne prend pas l'enfant ajouté à la réservation.
export function texteRaisonEnfant(raison) {
  if (raison === "sans_tarif") return tr("Ce service n'a pas de tarif enfant dans le catalogue : la facture garde ses lignes. Ajoutez le prix enfant à la prestation, ou comptez l'enfant comme adulte.");
  if (raison === "prix_global") return tr("Ce service a un prix par véhicule ou au forfait : l'enfant ne change pas la facture.");
  if (raison === "plusieurs_lignes") return tr("Ce service a plusieurs lignes adultes sur la facture : ajoutez la ligne enfant dans la facture.");
  return "";
}

// Tarif enfant d'une ligne de service, pris dans le catalogue : prix enfant de la prestation (champ « Prix enfant »), sinon la prestation enfant
// séparée du même partenaire (ancienne façon, toujours valable), sinon le prix enfant du trajet. Le net enfant suit quand on le connaît.
export function tarifEnfantCatalogue(l) {
  const vide = (x) => x === null || x === undefined || x === "";
  if (l.trajet_id) {
    const t = etat.db.trajets.find((x) => x.id === l.trajet_id);
    if (!t || vide(t.prix_enfant)) return null;
    const n = netTrajet(t);
    return { unite: Number(t.prix_enfant), net: n && !vide(n.net_enfant) ? Number(n.net_enfant) : null };
  }
  if (!l.prestation_id) return null;
  const p = etat.db.prestations.find((x) => x.id === l.prestation_id);
  if (!p) return null;
  // Champ « Prix enfant » du lot A (`details.enfant`, lu par prixEnfantDe) : le net enfant de la même prestation suit. Un frais réglé sur place n'a pas de ligne enfant.
  const prix = p.sur_place ? null : prixEnfantDe(p);
  if (prix !== null) {
    const n = netPrestation(p);
    return { unite: Number(prix), net: n && !vide(n.net_enfant) ? Number(n.net_enfant) : null };
  }
  const e = prestationEnfant(p, etat.db.prestations);
  if (!e || vide(e.prix_vente)) return null;
  const n = netPrestation(e);
  return { unite: Number(e.prix_vente), net: n && !vide(n.net) ? Number(n.net) : null, prestation_id: e.id };
}

// Ce que deviennent les documents du dossier quand la réservation change : date, personnes (ligne enfant comprise), mode de règlement, service.
// Sans effet de bord : sert à l'enregistrement comme à l'aperçu du nouveau total. Renvoie { changements, ajoutees, raisonEnfant }.
function suitesDocuments(documents, r, { avant, apres, mode = null, service = null }) {
  const dateChangee = (apres.date_service || null) !== (avant.date_service || null);
  const pa = avant.personnes || {};
  const pb = apres.personnes || {};
  const personnesChangees = (Number(pb.adultes) || 0) !== (Number(pa.adultes) || 0) || (Number(pb.enfants) || 0) !== (Number(pa.enfants) || 0);
  // `restes` : par document, ce que contenuAvecService n'a pas pu reporter ([{ cle, reservation, facture }]).
  const out = { changements: [], ajoutees: [], retirees: [], raisonEnfant: "", restes: new Map() };
  for (const doc of documents) {
    let suite = doc.contenu;
    if (mode) suite = contenuAvecSurPlace(suite, r, mode.surPlace) || suite;
    if (dateChangee || personnesChangees) suite = contenuAvecReservation(suite, r, avant, apres, { tarifEnfant: tarifEnfantCatalogue }).contenu || suite;
    if (personnesChangees) {
      const langue = suite.langue === "en" ? "en" : "";
      const e = contenuAvecEnfants(suite, r, avant, apres, { tarifEnfant: tarifEnfantCatalogue, uid, langue, decrire: (l) => descriptionService(l, langue || "fr") });
      if (e.contenu) suite = e.contenu;
      if (e.ajoutee) (out.ajoutees.push(e.ajoutee), (out.enfantAjoute = true));
      if (e.raison && doc.type !== "devis" && !out.raisonEnfant) out.raisonEnfant = e.raison;
    }
    if (service) {
      const s = contenuAvecService(suite, r, service, optionsService(apres.personnes));
      suite = s.contenu || suite;
      if (s.reste.length) out.restes.set(doc, s.reste);
      // Options ajoutées ou retirées (26.11.2026) : les mêmes identifiants sur la facture et le devis, comptés une fois.
      for (const id of s.ajoutees || []) if (!out.ajoutees.includes(id)) out.ajoutees.push(id);
      for (const id of s.retirees || []) if (!out.retirees.includes(id)) out.retirees.push(id);
    }
    if (suite !== doc.contenu) out.changements.push({ doc, suite });
  }
  return out;
}

// Aperçu du nouveau total pendant la saisie (« Changer la réservation ») : ce que deviendrait la facture, sans rien enregistrer.
// Renvoie null quand le service n'est sur aucune facture chargée (ou en Taxi), sinon { avant, apres, devise, raison }.
export function apercuFacture(r, valeurs) {
  // Seul le prix change (correction depuis À encaisser) : l'aperçu du prix, avec ce que chaque facture peut suivre ou non.
  if (valeurs && valeurs.montant_vente !== undefined && valeurs.date_service === undefined && valeurs.personnes === undefined) return apercuPrix(r, Number(valeurs.montant_vente));
  if (modeTaxi() || !lieeFacture(r)) return null;
  const documents = etat.db.documents.filter((x) => x.dossier_id === r.dossier_id && x.type === "facture");
  if (!documents.length) return null;
  const s = suitesDocuments(documents, r, { avant: { date_service: r.date_service, personnes: r.personnes }, apres: { date_service: valeurs.date_service, personnes: valeurs.personnes } });
  // La même facture que celle dont suivreFacture annonce le total : la première qui change, sinon la première du dossier.
  const ch = s.changements[0];
  const doc = ch ? ch.doc : documents[0];
  const suite = ch ? ch.suite : doc.contenu;
  const devise = doc.contenu.devise || reglages().devise;
  // Ce que le client paie sur place au prestataire (contrôle du 17.11.2026, D9) : le total de la facture n'en dit rien, cet aperçu le montre aussi.
  return { avant: totaux(doc.contenu).net, apres: totaux(suite).net, placeAvant: montantSurPlace(doc.contenu), placeApres: montantSurPlace(suite), devise, raison: s.raisonEnfant, enfantAjoute: s.ajoutees.length > 0 };
}

// Le prix d'un service change seul : les documents du dossier qui le portent (devis, facture, facture locale), ce que chacun devient et pourquoi
// une facture garderait l'ancien prix. Taxi : le prix interne de la course, jamais montré. Sans effet de bord.
// Renvoie null quand le service n'est sur aucun document chargé, sinon { avant, apres, devise, envoye, type, suit, restants, changements, taxi, droit } :
//   `changements` : [{ doc, suite }] à écrire ; `restants` : [{ type, raison, lignes, qte }] pour les factures qui gardent l'ancien prix.
function apercuPrix(r, montant) {
  if (!lieeFacture(r) || !Number.isFinite(montant)) return null;
  const taxi = modeTaxi();
  const docs = etat.db.documents.filter((x) => x.dossier_id === r.dossier_id && (taxi ? x.type === "facture" : ["facture", "facture_locale", "devis"].includes(x.type)));
  if (!docs.length) return null;
  const options = optionsService(r.personnes);
  const suites = docs.map((doc) => ({ doc, ...suitePrixDocument(doc, r, montant, { taxi, options }) }));
  const factures = suites.filter((x) => x.doc.type !== "devis");
  const principale = factures.find((x) => x.contenu) || factures[0] || null;
  const devise = ((principale && principale.doc.contenu) || {}).devise || reglages().devise;
  return {
    avant: principale ? totaux(principale.doc.contenu).net : null,
    apres: principale ? totaux(principale.contenu || principale.doc.contenu).net : null,
    // Payé sur place chez le prestataire : le total facturé ne bouge pas, c'est la part sur place qui change.
    placeAvant: principale ? montantSurPlace(principale.doc.contenu) : null,
    placeApres: principale ? montantSurPlace(principale.contenu || principale.doc.contenu) : null,
    devise,
    envoye: principale && principale.contenu ? principale.doc.envoye_le || null : null,
    type: principale ? principale.doc.type : null,
    suit: !!(principale && principale.contenu),
    restants: factures.filter((x) => x.raison).map((x) => ({ type: x.doc.type, raison: x.raison, lignes: x.lignes, qte: x.qte })),
    changements: suites.filter((x) => x.contenu).map((x) => ({ doc: x.doc, suite: x.contenu })),
    taxi,
    droit: peut("documents.ecrire"),
  };
}

// Taxi : pas de facture montrée, le prix interne suit la course en silence (date, prix, paiement au chauffeur, annulation), ainsi que le libellé,
// le chauffeur et le tarif (le prix, lui, est déjà suivi par contenuCourse).
async function suivreCourseTaxi(r, valeurs, retirer, resultat, service = {}) {
  if (!lieeFacture(r) || !r.id) return resultat;
  await chargerDossier(r.dossier_id);
  const documents = etat.db.documents.filter((x) => x.dossier_id === r.dossier_id && x.type === "facture");
  const { montant_vente, ...sansPrix } = service || {};
  if (retirer) resultat.changements = documentsSansService(documents, r);
  else for (const doc of documents) {
    let suite = contenuCourse(doc.contenu, { ...r, ...valeurs }) || doc.contenu;
    if (Object.keys(sansPrix).length) suite = contenuAvecService(suite, r, sansPrix, optionsService(valeurs.personnes)).contenu || suite;
    if (suite !== doc.contenu) resultat.changements.push({ doc, suite });
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


// En mode excursions, les dates du dossier sont celles de ses réservations : première et dernière date de service.
export async function synchroniserDatesDossier(dossierId) {
  if (!modeExcursions()) return;
  const d = etat.db.dossiers.find((x) => x.id === dossierId);
  if (!d) return;
  const dates = datesDepuisReservations(etat.db.reservations.filter((r) => r.dossier_id === dossierId));
  if (dates.date_depart !== (d.date_depart || null) || dates.date_retour !== (d.date_retour || null)) await modifier("dossiers", dossierId, dates);
}
