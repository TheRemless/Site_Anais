// Facture locale (ZTP) : copie de la facture du client dans la devise du pays, pour la comptabilité thaïlandaise.
// Elle garde l'empreinte de la facture copiée (`contenu.source`) : si la facture est corrigée ensuite, l'écart se voit et la copie se recrée.
import { modifier } from "../etat.mjs";
import { confirmer, toast } from "../ui.mjs";
import { convertirContenu } from "../calc.mjs";
import { uid } from "../defauts.mjs";
import { sourceLocale } from "../documents-calc.mjs";
import { tr } from "../i18n.mjs";

// Contenu d'une facture locale tiré de la facture : montants convertis, informations de paiement, numéro et langue choisis.
export function contenuLocale(facture, { taux, devise, paiement, numero, langue }) {
  const contenu = convertirContenu(facture.contenu, taux, devise);
  contenu.lignes = contenu.lignes.map((l) => ({ ...l, id: uid() }));
  delete contenu.fige;
  delete contenu.envois;
  contenu.paiement = paiement;
  contenu.numero = numero;
  contenu.langue = langue;
  contenu.source = sourceLocale(facture, taux);
  return contenu;
}

// Recrée la facture locale depuis la facture actuelle, avec le même taux, la même devise, le même numéro et les mêmes informations de paiement.
export async function regenererLocale(locale, facture) {
  const s = (locale.contenu && locale.contenu.source) || {};
  if (!facture || !Number(s.taux)) {
    toast(tr("Taux de la facture locale inconnu : supprimez-la puis créez-la de nouveau depuis le dossier."), true);
    return false;
  }
  if (!(await confirmer(tr("Recréer la facture locale d'après la facture actuelle (taux {taux}) ? Les corrections faites à la main sur la facture locale seront remplacées. La version actuelle reste dans « Versions ».", { taux: s.taux }), tr("Recréer depuis la facture")))) return false;
  const c = locale.contenu;
  try {
    await modifier("documents", locale.id, { contenu: contenuLocale(facture, { taux: Number(s.taux), devise: c.devise, paiement: c.paiement, numero: c.numero, langue: c.langue }), date_emission: facture.date_emission, updated_at: new Date().toISOString() });
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    return false;
  }
  toast(tr("Facture locale recréée."));
  return true;
}
