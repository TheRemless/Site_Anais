// Suppression d'un devis ou d'une facture. Le dossier, ses paiements, ses réservations et ses vouchers ne bougent pas : seul le document part.
// (La base en garde une copie 90 jours dans l'historique des documents.)
import { etat, supprimer } from "../etat.mjs";
import { toast, confirmer } from "../ui.mjs";
import { formatDate } from "../calc.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

const TITRES = { devis: N_("Supprimer le devis {ref} ?"), facture: N_("Supprimer la facture {ref} ?"), facture_locale: N_("Supprimer la facture locale {ref} ?") };

export async function supprimerDocument(doc, apres = () => {}) {
  const dossier = etat.db.dossiers.find((d) => d.id === doc.dossier_id) || {};
  const phrases = [tr(TITRES[doc.type] || TITRES.facture, { ref: dossier.ref || "" })];
  if (doc.envoye_le) phrases.push(tr("Envoi au client enregistré le {date}.", { date: formatDate(doc.envoye_le) }));
  const paiements = etat.db.paiements.filter((p) => p.dossier_id === doc.dossier_id).length;
  if (paiements) phrases.push(pluriel(paiements, N_("{n} paiement enregistré reste dans le dossier."), N_("{n} paiements enregistrés restent dans le dossier.")));
  phrases.push(tr("Le dossier, ses réservations et ses vouchers ne sont pas touchés."));
  if (!(await confirmer(phrases.join(" "), tr("Supprimer"), true))) return false;
  try {
    await supprimer("documents", doc.id);
  } catch (err) {
    toast(tr("Suppression impossible : {message}", { message: err.message }), true);
    return false;
  }
  toast(tr("Document supprimé."));
  apres();
  return true;
}
