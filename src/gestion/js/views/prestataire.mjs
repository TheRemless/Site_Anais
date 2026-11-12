// Demander un service au prestataire et suivre sa réponse, depuis la carte d'une réservation : un tap ouvre WhatsApp avec le message prêt,
// la réservation passe à « Demandée » toute seule, puis un tap note la réponse (confirmée, refusée, autre heure) ou relance.
import { etat, modifier, partenaireDe, reglages, entiteActive } from "../etat.mjs";
import { h, champ, modal, toast } from "../ui.mjs";
import { aujourdhui, formatDate } from "../calc.mjs";
import { variablesMessage, champsConfirmation } from "../operations-calc.mjs";
import { telWhatsApp } from "../partenaires-calc.mjs";
import { attente, detailsDemande, detailsRelance, detailsRefus, refusee } from "../prestataire-calc.mjs";
import { ouvrirMessage } from "./messages.mjs";
import { tr, pluriel, N_ } from "../i18n.mjs";

const dossierDe = (r) => etat.db.dossiers.find((d) => d.id === r.dossier_id) || null;
const clientDe = (r) => {
  const d = dossierDe(r);
  return d ? etat.db.clients.find((c) => c.id === d.client_id) || null : null;
};

// Message au prestataire : modèle « demande » ou « relance », en anglais, relu et modifiable avant l'envoi. `surEnvoi` s'exécute quand il part.
function messageAuPrestataire(r, cle, surEnvoi) {
  const p = partenaireDe(r.partenaire_id);
  const langue = "en";
  const emetteur = reglages().emetteur || {};
  ouvrirMessage({ titre: p ? tr("Message à {nom}", { nom: p.nom }) : tr("Message au partenaire"), pour: "partenaire", cle, langue, telephone: telWhatsApp(p), surEnvoi, vars: variablesMessage({ reservation: r, client: clientDe(r) || {}, dossier: dossierDe(r) || {}, partenaire: p || {}, entreprise: { nom: emetteur.nom || entiteActive().nom, telephone: emetteur.telephone || "" }, langue }) });
}

// Renvoie true si c'est enregistré. La réservation relue ici est la version courante : une synchronisation peut avoir changé la carte affichée.
const courante = (r) => etat.db.reservations.find((x) => x.id === r.id) || r;
const enregistrer = async (r, champs, apres, message) => {
  try {
    await modifier("reservations", r.id, typeof champs === "function" ? champs(courante(r)) : champs);
    if (message) toast(message);
    apres();
    return true;
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    return false;
  }
};

// Au retour de WhatsApp (l'appli repasse au premier plan après avoir été cachée), on demande si le message est vraiment parti : la réservation est
// marquée « Demandée » dès le tap, avant l'envoi réel. Fermer la fenêtre sans répondre ne change rien.
function questionAuRetour(r, apres) {
  // Armé avant l'enregistrement : sur iPhone, WhatsApp peut déjà être passé au premier plan pendant qu'on enregistre.
  let parti = document.visibilityState === "hidden";
  let minuteur = null;
  const ecoute = () => {
    if (document.visibilityState === "hidden") return void (parti = true);
    if (!parti) return;
    document.removeEventListener("visibilitychange", ecoute);
    clearTimeout(minuteur);
    if (courante(r).statut !== "demande") return;
    const p = partenaireDe(r.partenaire_id);
    const fermer = modal(
      tr("Le message est-il parti ?"),
      h(
        "div",
        { class: "modal-corps" },
        h("p", null, tr("La réservation « {libelle} » est notée « Demandée »{nom}. Si WhatsApp s'est fermé sans envoyer, remettez-la à demander.", { libelle: r.libelle, nom: p ? tr(" chez {nom}", { nom: p.nom }) : "" })),
        h("div", { class: "actions" }, h("button", { class: "secondaire", type: "button", onclick: () => (fermer(), courante(r).statut === "demande" && pasEnvoyee(r, apres)) }, tr("Pas envoyée")), h("button", { class: "principal", type: "button", onclick: () => fermer() }, tr("Oui, il est parti")))
      ),
      { protege: false }
    );
  };
  document.addEventListener("visibilitychange", ecoute);
  minuteur = setTimeout(() => document.removeEventListener("visibilitychange", ecoute), 10 * 60 * 1000);
}

const demander = (r, apres) =>
  messageAuPrestataire(r, "partenaire", async () => {
    questionAuRetour(r, apres);
    await enregistrer(r, (c) => ({ statut: "demande", details: detailsDemande(c, aujourdhui()) }), apres, tr("Marquée comme demandée."));
  });
const relancer = (r, apres) => messageAuPrestataire(r, "relance", () => enregistrer(r, (c) => ({ details: detailsRelance(c, aujourdhui()) }), apres, tr("Relance notée.")));
// « Confirmée » : l'heure de pickup (qu'il confirme souvent dans sa réponse) et sa référence se notent tout de suite, mais restent facultatives.
function confirmee(r, apres) {
  const heure = h("input", { id: "cf-heure", type: "time", value: r.heure_pickup || "" });
  const reference = h("input", { id: "cf-ref", value: r.reference_partenaire || "", autocomplete: "off", placeholder: tr("Numéro donné par le prestataire") });
  const fermer = modal(
    tr("Confirmée par le prestataire"),
    h(
      "form",
      { class: "modal-corps reponse-prestataire", onsubmit: (e) => { e.preventDefault(); fermer(); enregistrer(r, champsConfirmation(courante(r), { heure: heure.value, reference: reference.value }), apres, tr("Confirmée par le prestataire.")); } },
      h("p", { class: "aide" }, r.libelle),
      h("div", { class: "grille-form compacte" }, champ(tr("Heure de pickup"), heure, r.heure_pickup ? "" : tr("Facultative : la réponse du prestataire la donne souvent.")), champ(tr("Référence du prestataire"), reference)),
      h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Confirmer")))
    ),
    { protege: false }
  );
}
const pasEnvoyee = (r, apres) => enregistrer(r, (c) => ({ statut: "a_demander", details: { ...(c.details || {}), demande_le: null, relance_le: null, relances: 0 } }), apres);

// Autre réponse : le prestataire refuse, ou propose une autre heure.
function autreReponse(r, apres) {
  const heure = h("input", { id: "ar-heure", type: "time", value: r.heure_pickup || "" });
  const fermer = modal(
    tr("Réponse du prestataire"),
    h(
      "div",
      { class: "modal-corps reponse-prestataire" },
      h("p", { class: "aide" }, r.libelle),
      h("div", { class: "champ" }, h("label", { for: "ar-heure" }, tr("Il propose une autre heure")), heure),
      h("button", { class: "principal", type: "button", onclick: () => {
        if (!heure.value) return heure.focus();
        fermer();
        enregistrer(r, { statut: "confirme", heure_pickup: heure.value }, apres, tr("Heure de pickup mise à jour : prévenez le client."));
      } }, tr("Enregistrer l'heure et confirmer")),
      h("button", { class: "secondaire danger-texte", type: "button", onclick: () => {
        fermer();
        enregistrer(r, (c) => ({ statut: "a_demander", details: detailsRefus(c, aujourdhui()) }), apres, tr("Refus noté : la réservation est à redemander."));
      } }, tr("Il refuse"))
    ),
    { protege: false }
  );
}

// Changer le jour, l'heure, le lieu ou les personnes sans ouvrir tout le formulaire. Sur une réservation déjà demandée au prestataire, on peut
// enregistrer et le prévenir d'un tap : le message « modification » s'ouvre et la réservation repasse à « Demandée ».
export function changerReservation(r, apres) {
  const p = r.personnes || {};
  const date = h("input", { id: "ch-date", type: "date", value: r.date_service || "" });
  const heure = h("input", { id: "ch-heure", type: "time", value: r.heure_pickup || "" });
  const lieu = h("input", { id: "ch-lieu", value: r.lieu_pickup || "", autocomplete: "off", placeholder: tr("Hôtel, chambre, vol") });
  const adultes = h("input", { id: "ch-ad", type: "number", min: "0", step: "1", inputmode: "numeric", value: p.adultes ?? 0 });
  const enfants = h("input", { id: "ch-enf", type: "number", min: "0", step: "1", inputmode: "numeric", value: p.enfants ?? 0 });
  const nombre = (i) => Math.max(0, Math.floor(Number(i.value) || 0));
  const champs = () => ({ date_service: date.value || null, heure_pickup: heure.value, lieu_pickup: lieu.value.trim(), personnes: { ...p, adultes: nombre(adultes), enfants: nombre(enfants) } });
  const prevenir = r.partenaire_id && (r.statut === "confirme" || r.statut === "demande");
  const fermer = modal(
    tr("Changer la réservation"),
    h(
      "div",
      { class: "modal-corps changer-reservation" },
      h("p", { class: "aide" }, r.libelle),
      h("div", { class: "grille-form compacte" }, champ(tr("Date du service"), date), champ(tr("Heure de pickup"), heure)),
      champ(tr("Lieu de pickup"), lieu),
      h("div", { class: "grille-form compacte" }, champ(tr("Adultes"), adultes), champ(tr("Enfants"), enfants)),
      h("p", { class: "aide" }, tr("La facture n'est pas modifiée : un écart avec la facture est signalé sur la réservation.")),
      h("div", { class: "actions" },
        h("button", { class: prevenir ? "secondaire" : "principal", type: "button", onclick: () => (fermer(), enregistrer(r, champs(), apres, tr("Réservation modifiée."))) }, tr("Enregistrer")),
        prevenir ? h("button", { class: "principal", type: "button", onclick: async () => {
          fermer();
          const nouveau = { ...r, ...champs() };
          const fait = await enregistrer(r, (c) => ({ ...champs(), statut: "demande", details: detailsDemande(c, aujourdhui()) }), apres);
          if (fait) messageAuPrestataire(nouveau, "modification");
        } }, tr("Enregistrer et prévenir le prestataire")) : null
      )
    ),
    { protege: false }
  );
}

const TEXTES_ATTENTE = {
  jour: N_("Demandée aujourd'hui"),
  hier: N_("Demandée hier"),
};

// Ligne d'état et boutons de la carte : ce qui est en cours et le geste suivant.
export function actionsPrestataire(r, { apres }) {
  if (!r.partenaire_id || r.statut === "annule") return null;
  const changer = h("button", { class: "lien", type: "button", onclick: () => changerReservation(r, apres) }, tr("Changer le jour, l'heure ou les personnes"));
  if (r.statut === "a_demander") {
    return h(
      "div",
      { class: "prestataire-actions" },
      refusee(r) ? h("p", { class: "prestataire-etat refus" }, tr("Refusée par le prestataire le {date}. À redemander ailleurs ou à une autre date.", { date: formatDate(r.details.refus_le) })) : null,
      h("button", { class: "principal petit", type: "button", onclick: () => demander(r, apres) }, tr("Demander au prestataire")),
      changer
    );
  }
  if (r.statut === "confirme") return h("div", { class: "prestataire-actions" }, changer);
  if (r.statut !== "demande") return null;
  const a = attente(r, aujourdhui());
  const texte = !a || a.jours === null ? tr("Demandée, en attente") : a.jours === 0 ? tr(TEXTES_ATTENTE.jour) : a.jours === 1 ? tr(TEXTES_ATTENTE.hier) : tr("En attente depuis {n} jours", { n: a.jours });
  return h(
    "div",
    { class: "prestataire-actions" },
    h("p", { class: `prestataire-etat${a && a.relancer ? " long" : ""}` }, texte, a && a.relances ? ` · ${pluriel(a.relances, N_("{n} relance"), N_("{n} relances"))}` : "", ),
    // Le jour même, un vrai bouton (et non un lien) : le message a pu ne pas partir de WhatsApp.
    a && a.jours === 0 ? h("button", { class: "secondaire petit pas-envoyee", type: "button", onclick: () => pasEnvoyee(r, apres) }, tr("Le message n'est pas parti ? Remettre à demander")) : null,
    h("button", { class: "principal petit", type: "button", onclick: () => confirmee(r, apres) }, tr("Confirmée")),
    h("button", { class: "secondaire petit", type: "button", onclick: () => autreReponse(r, apres) }, tr("Autre réponse")),
    h("button", { class: a && a.relancer ? "principal petit" : "secondaire petit", type: "button", onclick: () => relancer(r, apres) }, tr("Relancer")),
    changer
  );
}
