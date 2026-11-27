// Réglages, bloc « WhatsApp » (migration 58) : l'interrupteur de réception, l'état du compte et l'heure du dernier message reçu.
// Visible seulement pour un administrateur de Secret ou de Taxi (whatsapp_admin). L'interrupteur s'enregistre tout de suite, à part du
// bouton « Enregistrer les réglages » : il vit dans whatsapp_reglages, pas dans les réglages de l'entreprise.
// Ligne « Réception » (migration 64) : les messages reçus mais pas encore rangés (en erreur, abandonnés après 5 essais, en retard), lus par
// whatsapp_etat_reception() à l'ouverture des Réglages, avec « Relancer » pour les abandonnés.
// « Message de nuit » (migration 132) : le message d'absence envoyé par Gestion à la place de l'app de Nani en mode avion, activé ou non, son
// texte et ses heures (Bangkok). Enregistré à part par whatsapp_regler_nuit, qui contrôle les droits côté serveur.
import { etat, entiteActive, estSuperAdmin, permissionsDe, voitToutDans, ecranVoucherSeul, organisationActiveId } from "../etat.mjs";
import { h, toast, confirmer } from "../ui.mjs";
import { tr, N_, localeActive } from "../i18n.mjs";
import { lecteurWhatsApp, etatCompte, numeroAffiche } from "../whatsapp-calc.mjs";
import { resumeReception } from "../whatsapp-fiabilite-calc.mjs";
import { reglageNuit, lireReglageNuit, TEXTE_NUIT } from "../whatsapp-nuit-calc.mjs";

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
      h("dd", null, r.dernier_evenement_le ? date(r.dernier_evenement_le) : tr("Aucun pour l'instant")),
      ligneReception()
    ),
    blocMessageNuit(r)
  );
}

// Les erreurs du formulaire (whatsapp-nuit-calc.mjs, copie de la fonction « whatsapp » qui ne connaît pas tr) : marquées ici pour la traduction.
N_("Le message ne peut pas être vide.");
N_("Le message est trop long pour WhatsApp (4 096 octets au plus).");
N_("Indiquez les heures au format 22:00.");
N_("L'heure de début et l'heure de fin doivent être différentes.");
N_("La plage dure plus de 12 heures : le message partirait aussi le jour. Vérifiez l'heure de début et l'heure de fin.");

// « Message de nuit » : rien tant que la migration 132 manque (les colonnes ne sont pas lues).
function blocMessageNuit(r) {
  const n = reglageNuit(r);
  if (!n.disponible || !etat.store.whatsappMessageNuit) return null;
  const caseNuit = h("input", { id: "wa-nuit-active", type: "checkbox", checked: n.active });
  const texte = h("textarea", { id: "wa-nuit-texte", rows: 9 }, n.texte);
  const debut = h("input", { id: "wa-nuit-debut", type: "time", step: 60, value: n.debut, required: true });
  const fin = h("input", { id: "wa-nuit-fin", type: "time", step: 60, value: n.fin, required: true });
  const erreur = h("p", { class: "erreur-form", role: "alert", hidden: true });
  const enregistrer = h("button", { class: "principal", type: "button" }, tr("Enregistrer le message de nuit"));
  const reprendre = h("button", { class: "secondaire", type: "button" }, tr("Reprendre le texte d'origine"));
  reprendre.addEventListener("click", () => {
    texte.value = TEXTE_NUIT;
    texte.focus();
  });
  enregistrer.addEventListener("click", async () => {
    const lu = lireReglageNuit({ active: caseNuit.checked, texte: texte.value, debut: debut.value, fin: fin.value });
    // La date lue avec le réglage (ou celle du dernier enregistrement ici) : la base refuse si quelqu'un l'a changé entre-temps.
    if (lu.ok) lu.valeurs.luLe = reglageNuit(r).modifieLe;
    erreur.hidden = !lu.erreur;
    if (lu.erreur) return void (erreur.textContent = tr(lu.erreur));
    enregistrer.disabled = true;
    try {
      const ligne = await etat.store.whatsappMessageNuit(r.organisation_id, lu.valeurs);
      Object.assign(r, ligne || {});
      toast(lu.valeurs.active ? tr("Message de nuit enregistré.") : tr("Message de nuit coupé."));
    } catch (err) {
      erreur.hidden = false;
      erreur.textContent = tr("Enregistrement impossible : {message}", { message: err.message });
    } finally {
      enregistrer.disabled = false;
    }
  });
  return h(
    "div",
    { class: "wa-nuit" },
    h("h3", null, tr("Message de nuit")),
    h("label", { class: "case", for: "wa-nuit-active" }, caseNuit, tr("Répondre automatiquement la nuit")),
    h("p", { class: "aide" }, tr("Quand le téléphone de Nani est en mode avion, Gestion envoie ce message à un client ou à un inconnu qui écrit pendant ces heures (heure de Thaïlande). Une seule fois par personne et par nuit, jamais à un Contact personnel, un partenaire ou un apporteur, ni si l'équipe a déjà répondu cette nuit-là.")),
    h(
      "div",
      { class: "wa-nuit-heures" },
      h("label", { for: "wa-nuit-debut" }, tr("De"), debut),
      h("label", { for: "wa-nuit-fin" }, tr("À"), fin)
    ),
    h("label", { for: "wa-nuit-texte" }, tr("Texte envoyé"), texte),
    h("p", { class: "aide" }, tr("Envoyé tel quel, emojis compris. Il apparaît dans la conversation, marqué « Message automatique de nuit ». Ni nom de partenaire ni net : il part chez tous les clients.")),
    erreur,
    h("div", { class: "wa-nuit-actions" }, enregistrer, reprendre)
  );
}

// « Réception » : lue à part (une requête à l'ouverture), la ligne se remplit quand la réponse arrive. Rien tant que la migration 64 manque.
function ligneReception() {
  if (!etat.store.whatsappEtatReception) return null;
  const dt = h("dt", { hidden: true }, tr("Réception"));
  const dd = h("dd", { class: "wa-reception", hidden: true });
  const remplir = (e) => {
    const res = resumeReception(e);
    if (!res) return;
    const relancer = h("button", { class: "lien", type: "button" }, tr("Relancer"));
    relancer.addEventListener("click", async () => {
      relancer.disabled = true;
      try {
        const n = await etat.store.whatsappRelancerEvenements();
        toast(n ? tr("{n} message(s) remis en file : repris dans les 5 minutes.", { n }) : tr("Rien à relancer."));
        remplir(await etat.store.whatsappEtatReception());
      } catch (err) {
        toast(err.message, true);
        relancer.disabled = false;
      }
    });
    dd.className = `wa-reception ${res.niveau}`;
    // replaceChildren écrirait « null » en texte : seulement les morceaux présents.
    dd.replaceChildren(...[
      h("span", null, tr(res.texte, res.vars)),
      e.derniere_erreur && res.niveau !== "ok" ? h("span", { class: "aide", title: e.derniere_erreur }, tr("Dernière erreur : {message}", { message: String(e.derniere_erreur).slice(0, 80) })) : null,
      res.envois ? h("span", { class: "aide" }, tr("{n} envoi(s) depuis Gestion à vérifier dans WhatsApp.", { n: res.envois })) : null,
      res.relancer ? relancer : null
    ].filter(Boolean));
    dt.hidden = dd.hidden = false;
  };
  etat.store.whatsappEtatReception().then(remplir, () => {});
  return [dt, dd];
}
