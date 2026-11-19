// Annuler un dossier : le geste de la fiche (« Annuler ou supprimer » > « Marquer comme annulé ») et la question posée quand le dernier
// service actif du dossier vient d'être annulé. Le dossier annulé garde ses paiements et reste consultable ; rien n'est envoyé au prestataire.
import { etat, modifier, peut, chargerDossier, resumeDossier } from "../etat.mjs";
import { confirmer, toast } from "../ui.mjs";
import { formatMontant } from "../calc.mjs";
import { dossierSansServiceActif } from "../dossier-gestes-calc.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

// Marque le dossier annulé (après la confirmation de qui l'appelle). Ses réservations encore actives sont proposées à l'annulation avec lui.
export async function marquerDossierAnnule(d) {
  const aAnnuler = etat.db.reservations.filter((x) => x.dossier_id === d.id && x.statut !== "annule");
  await modifier("dossiers", d.id, { annule: true });
  // Les réservations d'un dossier annulé ne comptent déjà plus dans l'agenda ni dans le dû ; on propose de les marquer aussi, pour que la liste et les vouchers soient justes.
  if (aAnnuler.length && (await confirmer(pluriel(aAnnuler.length, N_("Ce dossier a {n} réservation active. La marquer aussi comme annulée ? Le prestataire n'est pas prévenu par l'outil."), N_("Ce dossier a {n} réservations actives. Les marquer aussi comme annulées ? Les prestataires ne sont pas prévenus par l'outil.")), tr("Marquer les réservations annulées"), true))) {
    try {
      // La marque permet de les proposer à la réactivation du dossier (et pas celles annulées une à une avant).
      for (const x of aAnnuler) await modifier("reservations", x.id, { statut: "annule", details: { ...(x.details || {}), annule_avec_dossier: true } });
    } catch (err) {
      toast(tr("Une réservation n'a pas pu être annulée : {message}", { message: err.message }), true);
    }
  }
}

// Le service `r` vient d'être annulé. S'il était le dernier actif du dossier, propose d'annuler aussi le dossier (même geste que la fiche).
// Rien n'est proposé à qui ne peut pas modifier un dossier. Renvoie true si le dossier a été annulé.
export async function proposerAnnulationDossier(r) {
  if (!r || !peut("dossiers.ecrire")) return false;
  const d = etat.db.dossiers.find((x) => x.id === r.dossier_id);
  if (!dossierSansServiceActif(etat.db.reservations, d)) return false;
  // Le service est déjà annulé quand on arrive ici : une erreur de la proposition ne doit pas le faire passer pour un échec.
  try {
    await chargerDossier(d.id);
    const resume = peut("finances.voir") ? resumeDossier(d.id) : null;
    const phrases = [tr("« {libelle} » était le dernier service actif de ce dossier.", { libelle: r.libelle }), tr("Annuler aussi le dossier ? Il sortira des totaux à encaisser mais restera consultable.")];
    if (resume && resume.recu > 0) phrases.push(tr("{montant} ont déjà été encaissés et restent enregistrés sur le dossier. Si vous les rendez, enregistrez un remboursement dans les paiements.", { montant: formatMontant(resume.recu, resume.devise) }));
    if (!(await confirmer(phrases.join(" "), tr("Annuler aussi le dossier"), true, tr("Garder le dossier ouvert")))) return false;
    await marquerDossierAnnule(d);
    toast(tr("Le dossier est annulé."));
    return true;
  } catch (err) {
    toast(tr("Le dossier n'a pas pu être annulé : {message}", { message: err.message }), true);
    return false;
  }
}
