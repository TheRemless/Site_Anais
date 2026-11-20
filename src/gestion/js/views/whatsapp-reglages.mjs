// Réglages, bloc « WhatsApp » (migration 58) : l'interrupteur de réception, l'état du compte et l'heure du dernier message reçu.
// Visible seulement pour un administrateur de Secret ou de Taxi (whatsapp_admin). L'interrupteur s'enregistre tout de suite, à part du
// bouton « Enregistrer les réglages » : il vit dans whatsapp_reglages, pas dans les réglages de l'entreprise.
import { etat, entiteActive, estSuperAdmin, permissionsDe, voitToutDans, ecranVoucherSeul, organisationActiveId } from "../etat.mjs";
import { h, toast, confirmer } from "../ui.mjs";
import { tr, localeActive } from "../i18n.mjs";
import { lecteurWhatsApp, etatCompte, numeroAffiche } from "../whatsapp-calc.mjs";

const date = (iso) => (iso ? new Date(iso).toLocaleString(localeActive(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "");

export function blocReglagesWhatsApp() {
  if (!etat.brut || etat.brut.whatsapp_disponible !== true) return null;
  if (!lecteurWhatsApp({ entite: entiteActive(), superAdmin: estSuperAdmin(), permissions: permissionsDe(etat.entiteId), voitTout: voitToutDans(etat.entiteId), voucherSeul: ecranVoucherSeul() })) return null;
  const org = organisationActiveId();
  const r = (etat.brut.whatsapp_reglages || []).find((x) => x.organisation_id === org) || (etat.brut.whatsapp_reglages || [])[0] || null;
  if (!r) return h("fieldset", null, h("legend", null, tr("WhatsApp")), h("p", { class: "aide" }, tr("Le numéro WhatsApp n'est pas encore relié à cette organisation.")));
  const compte = etatCompte(r.etat_compte);
  const caseReception = h("input", {
    id: "wa-reception",
    type: "checkbox",
    checked: r.reception_active !== false,
    onchange: async (e) => {
      const actif = e.target.checked;
      if (!actif && !(await confirmer(tr("Couper la réception ? Les messages des clients continuent d'arriver dans l'app de Nani mais plus dans Gestion, sans réponse préparée ni notification."), tr("Couper la réception"), true))) return void (e.target.checked = true);
      e.target.disabled = true;
      try {
        const ligne = await etat.store.whatsappReception(r.organisation_id, actif);
        Object.assign(r, ligne || { reception_active: actif });
        toast(actif ? tr("Réception WhatsApp rallumée.") : tr("Réception WhatsApp coupée."));
      } catch (err) {
        e.target.checked = !actif;
        toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
      } finally {
        e.target.disabled = false;
      }
    },
  });
  return h(
    "fieldset",
    { "data-pas-saisie": "" },
    h("legend", null, tr("WhatsApp")),
    h("label", { class: "case", for: "wa-reception" }, caseReception, tr("Recevoir les messages WhatsApp")),
    h("p", { class: "aide" }, tr("Le numéro de Secret et de VIP Taxi Lanta. Chaque message arrive dans l'écran WhatsApp avec une réponse préparée. Cette case s'enregistre tout de suite.")),
    h(
      "dl",
      { class: "wa-reglages-etat" },
      r.numero ? [h("dt", null, tr("Numéro")), h("dd", null, numeroAffiche(r.numero))] : null,
      h("dt", null, tr("Compte")),
      h("dd", { class: `wa-compte ${compte.cle}` }, tr(compte.libelle, compte.vars), r.etat_le ? h("span", { class: "aide" }, ` ${date(r.etat_le)}`) : null),
      h("dt", null, tr("Dernier message reçu")),
      h("dd", null, r.dernier_evenement_le ? date(r.dernier_evenement_le) : tr("Aucun pour l'instant"))
    )
  );
}
