// Taxi, après une course : demander la commission à Mr. Brown, puis la saisir (aucune commission par défaut, décision du 12.11.2026).
// Depuis le 13.11.2026 : toutes les courses des 14 derniers jours sans commission saisie, et un seul message par chauffeur.
// La commission saisie est la « commission prévue » de la réservation : l'écran À encaisser la suit ensuite comme pour Secret.
// Saisie par le partenaire lui-même (migration 115) : la carte le dit (« Commission annoncée par Mr. Brown »).
import { etat, modifier, enregistrerLie, nomClient, partenaireDe, dossiersAnnules, reglages, entiteActive, peut } from "../etat.mjs";
import { h, icone, toast, confirmer } from "../ui.mjs";
import { aujourdhui, formatMontant, formatDate } from "../calc.mjs";
import { commissionsADemander, commissionsParChauffeur, valeursCommission, varsCommissions, joursCommission } from "../taxi-calc.mjs";
import { variablesMessage } from "../operations-calc.mjs";
import { telWhatsApp } from "../partenaires-calc.mjs";
import { ouvrirMessage } from "./messages.mjs";
import { lienDossier } from "./commun.mjs";
import { commissionDuPartenaire } from "../courses-partenaire-calc.mjs";
import { tr } from "../i18n.mjs";

const netDe = (r) => etat.db.reservations_nets.find((n) => n.reservation_id === r.id) || null;
// Les courses dont la commission a été saisie depuis l'ouverture de l'outil restent à l'écran avec « Modifier » : une faute de frappe se corrige
// tout de suite, même pour une course d'avant-hier que la liste ne montrerait plus une fois saisie.
const saisiesRecentes = new Set();
// Une course saisie (ou dont la commission est déjà connue) telle que la liste la décrit.
const commeSaisie = (r) => {
  const n = netDe(r) || {};
  return { reservation: r, saisie: true, montant: Number(n.commission_prevue), recue: !!n.commission_recue_le, recueLe: n.commission_recue_le || null, demandeLe: (r.details && r.details.commission_demandee_le) || null };
};
const nomContact = (p) => (p && ((p.contact || {}).personne || "").trim()) || (p && p.nom) || tr("le partenaire");

export function sectionCommissionsHier(rafraichir) {
  // La commission vit dans les données privées des réservations : seule une personne qui voit les nets peut la saisir.
  if (!peut("partenaires.nets")) return null;
  const ajd = aujourdhui();
  // Toute course passée sans commission saisie, sur 14 jours : un jour sans ouvrir Gestion ne fait plus perdre la commission.
  const liste = commissionsADemander(etat.db.reservations, ajd, { ecartes: dossiersAnnules(), netDe, jours: joursCommission(reglages()) }).map((x) => (x.saisie ? { ...x, recueLe: (netDe(x.reservation) || {}).commission_recue_le || null } : x));
  const deja = new Set(liste.map((x) => x.reservation.id));
  for (const id of saisiesRecentes) {
    const r = etat.db.reservations.find((y) => y.id === id);
    const n = r && netDe(r);
    if (r && !deja.has(id) && n && n.commission_prevue !== null && n.commission_prevue !== undefined) liste.push(commeSaisie(r));
  }
  liste.sort((a, b) => String(a.reservation.date_service).localeCompare(String(b.reservation.date_service)));
  if (!liste.length) return null;
  const devise = reglages().devise || "THB";
  const entreprise = { nom: reglages().emetteur.nom || entiteActive().nom, devise };
  const dossierDe = (r) => etat.db.dossiers.find((y) => y.id === r.dossier_id) || {};
  const clientDe = (d) => etat.db.clients.find((c) => c.id === d.client_id) || {};
  // Un seul message par chauffeur : il liste toutes ses courses encore à demander, puis on saisit les montants à la suite.
  const demander = (g, p) =>
    ouvrirMessage({
      titre: tr("Commissions à demander à {nom}", { nom: nomContact(p) }),
      pour: "partenaire",
      cle: "commissions",
      langue: "th",
      telephone: telWhatsApp(p),
      vars: (langue) => varsCommissions(g.aDemander.map((x) => { const d = dossierDe(x.reservation); return variablesMessage({ reservation: x.reservation, client: clientDe(d), dossier: d, partenaire: p || {}, entreprise, langue }); })),
      surEnvoi: async () => {
        for (const x of g.aDemander) {
          const actuelle = etat.db.reservations.find((y) => y.id === x.reservation.id) || x.reservation;
          await modifier("reservations", actuelle.id, { details: { ...(actuelle.details || {}), commission_demandee_le: ajd } });
        }
        rafraichir();
      },
    });
  const carte = (x, p) => {
    const r = x.reservation;
    const d = dossierDe(r);
    const client = clientDe(d);
    const li = h("li", { class: "carte", "data-reservation": r.id });
    const entete = () => [
      h("span", { class: "carte-titre" }, lienDossier(nomClient(client), d.id)),
      h("span", { class: "carte-sous" }, [formatDate(r.date_service), r.libelle, r.montant_vente != null ? formatMontant(r.montant_vente, devise) : ""].filter(Boolean).join(" · ")),
    ];
    // Le formulaire : vide pour une course à saisir, prérempli pour une commission à modifier. « Déjà reçue » demande la date de réception.
    const formulaire = (edition) => {
      const montant = h("input", { id: `com-${r.id}`, inputmode: "decimal", autocomplete: "off", placeholder: devise, value: edition ? String(x.montant) : "", "aria-label": tr("Commission en {devise}", { devise }) });
      const recue = h("input", { id: `com-recue-${r.id}`, type: "checkbox", checked: edition && x.recue });
      const date = h("input", { id: `com-le-${r.id}`, type: "date", value: (edition && x.recueLe) || ajd, max: ajd, "aria-label": tr("Reçue le") });
      const champDate = h("label", { class: "taxi-commission-champ", hidden: !recue.checked }, h("span", null, tr("Reçue le")), date);
      recue.addEventListener("change", () => (champDate.hidden = !recue.checked));
      const enregistrer = async (e) => {
        e.preventDefault();
        if (recue.checked && (!date.value || date.value > ajd)) return toast(tr("Indiquez la date de réception, aujourd'hui au plus tard."), true), date.focus();
        const valeurs = valeursCommission(montant.value, { recue: recue.checked, date: date.value });
        if (!valeurs) return toast(tr("Indiquez un montant, 0 s'il n'y a pas de commission."), true), montant.focus();
        // Décochée, la réception s'efface. Montant inchangé sur une commission déjà reçue : le montant reçu (et son éventuel écart) reste tel quel.
        if (!recue.checked && edition && x.recue && !(await confirmer(tr("La réception de cette commission sera effacée (montant reçu et date). Continuer ?"), tr("Effacer la réception"), true))) return;
        if (!recue.checked) Object.assign(valeurs, { commission_recue: null, commission_recue_le: null });
        else if (edition && x.recue && valeurs.commission_prevue === x.montant) delete valeurs.commission_recue;
        try {
          await enregistrerLie("reservations_nets", "reservation_id", r.id, valeurs);
          saisiesRecentes.add(r.id);
          toast(edition ? tr("Commission modifiée.") : tr("Commission enregistrée."));
          rafraichir();
        } catch (err) {
          toast(tr("Commission non enregistrée : {message}", { message: err.message }), true);
        }
      };
      return h(
        "div",
        { class: "taxi-commission" },
        !edition && x.demandeLe ? h("p", { class: "aide" }, tr("Demandée le {date}. Saisissez le montant dès que {nom} répond.", { date: formatDate(x.demandeLe), nom: nomContact(p) })) : null,
        h(
          "form",
          { class: "taxi-commission-form", onsubmit: enregistrer },
          h("label", { class: "taxi-commission-champ" }, h("span", null, tr("Commission")), montant),
          h("label", { class: "case" }, recue, tr("Déjà reçue")),
          champDate,
          edition ? h("button", { class: "secondaire petit", type: "button", onclick: () => rendre(false) }, tr("Annuler")) : null,
          h("button", { class: edition ? "principal petit" : "secondaire petit", type: "submit" }, tr("Enregistrer"))
        )
      );
    };
    const affichage = () =>
      h(
        "span",
        { class: "carte-pied" },
        h("span", { class: "tag" }, x.recue ? (x.recueLe ? tr("Commission reçue le {date} : {montant}", { date: formatDate(x.recueLe), montant: formatMontant(x.montant, devise) }) : tr("Commission reçue : {montant}", { montant: formatMontant(x.montant, devise) })) : commissionDuPartenaire(netDe(r)) ? tr("Commission annoncée par {nom} : {montant}", { nom: nomContact(p), montant: formatMontant(x.montant, devise) }) : tr("Commission annoncée : {montant}", { montant: formatMontant(x.montant, devise) })),
        h("button", { class: "secondaire petit", type: "button", onclick: () => rendre(true) }, tr("Modifier"))
      );
    // `edition` : la commission saisie s'affiche dans son formulaire prérempli.
    const rendre = (edition) => {
      li.replaceChildren(h("div", { class: "carte-lien statique" }, ...entete(), x.saisie && !edition ? affichage() : formulaire(x.saisie && edition)));
      if (edition) li.querySelector("input")?.focus();
    };
    rendre(false);
    return li;
  };
  const groupe = (g) => {
    const p = partenaireDe(g.partenaireId);
    const n = g.aDemander.length;
    return [
      n
        ? h("div", { class: "taxi-commission" }, h("button", { class: "principal petit", type: "button", onclick: () => demander(g, p) }, icone("whatsapp", 16), n > 1 ? tr("Demander les {n} commissions à {nom}", { n, nom: nomContact(p) }) : tr("Demander la commission à {nom}", { nom: nomContact(p) })))
        : null,
      h("ul", { class: "cartes" }, g.courses.map((x) => carte(x, p))),
    ];
  };
  return h("section", null, h("h2", null, tr("Commissions à demander"), h("span", { class: "tag" }, liste.filter((x) => !x.saisie).length)), commissionsParChauffeur(liste).map(groupe));
}
