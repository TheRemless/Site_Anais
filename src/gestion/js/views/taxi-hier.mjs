// Taxi, après une course : demander la commission à Mr. Brown, puis la saisir (aucune commission par défaut, décision du 12.11.2026).
// Depuis le 13.11.2026 : toutes les courses des 14 derniers jours sans commission saisie, et un seul message par chauffeur.
// La commission saisie est la « commission prévue » de la réservation : l'écran À encaisser la suit ensuite comme pour Secret.
import { etat, modifier, enregistrerLie, nomClient, partenaireDe, dossiersAnnules, reglages, entiteActive, peut } from "../etat.mjs";
import { h, icone, toast } from "../ui.mjs";
import { aujourdhui, formatMontant, formatDate } from "../calc.mjs";
import { commissionsADemander, commissionsParChauffeur, valeursCommission, varsCommissions } from "../taxi-calc.mjs";
import { variablesMessage } from "../operations-calc.mjs";
import { telWhatsApp } from "../partenaires-calc.mjs";
import { ouvrirMessage } from "./messages.mjs";
import { lienDossier } from "./commun.mjs";
import { tr } from "../i18n.mjs";

const netDe = (r) => etat.db.reservations_nets.find((n) => n.reservation_id === r.id) || null;
const nomContact = (p) => (p && ((p.contact || {}).personne || "").trim()) || (p && p.nom) || tr("le partenaire");

export function sectionCommissionsHier(rafraichir) {
  // La commission vit dans les données privées des réservations : seule une personne qui voit les nets peut la saisir.
  if (!peut("partenaires.nets")) return null;
  const ajd = aujourdhui();
  // Toute course passée sans commission saisie, sur 14 jours : un jour sans ouvrir Gestion ne fait plus perdre la commission.
  const liste = commissionsADemander(etat.db.reservations, ajd, { ecartes: dossiersAnnules(), netDe });
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
    const montant = h("input", { id: `com-${r.id}`, inputmode: "decimal", autocomplete: "off", placeholder: devise, "aria-label": tr("Commission en {devise}", { devise }) });
    const recue = h("input", { id: `com-recue-${r.id}`, type: "checkbox" });
    const enregistrer = async (e) => {
      e.preventDefault();
      const valeurs = valeursCommission(montant.value, { recue: recue.checked, date: ajd });
      if (!valeurs) return toast(tr("Indiquez un montant, 0 s'il n'y a pas de commission."), true), montant.focus();
      try {
        await enregistrerLie("reservations_nets", "reservation_id", r.id, valeurs);
        toast(tr("Commission enregistrée."));
        rafraichir();
      } catch (err) {
        toast(tr("Commission non enregistrée : {message}", { message: err.message }), true);
      }
    };
    return h(
      "li",
      { class: "carte" },
      h(
        "div",
        { class: "carte-lien statique" },
        h("span", { class: "carte-titre" }, lienDossier(nomClient(client), d.id)),
        h("span", { class: "carte-sous" }, [formatDate(r.date_service), r.libelle, r.montant_vente != null ? formatMontant(r.montant_vente, devise) : ""].filter(Boolean).join(" · ")),
        x.saisie
          ? h("span", { class: "carte-pied" }, h("span", { class: "tag" }, x.recue ? tr("Commission reçue : {montant}", { montant: formatMontant(x.montant, devise) }) : tr("Commission annoncée : {montant}", { montant: formatMontant(x.montant, devise) })))
          : h(
              "div",
              { class: "taxi-commission" },
              x.demandeLe ? h("p", { class: "aide" }, tr("Demandée le {date}. Saisissez le montant dès que {nom} répond.", { date: formatDate(x.demandeLe), nom: nomContact(p) })) : null,
              h("form", { class: "taxi-commission-form", onsubmit: enregistrer }, h("label", { class: "taxi-commission-champ" }, h("span", null, tr("Commission")), montant), h("label", { class: "case" }, recue, tr("Déjà reçue")), h("button", { class: "secondaire petit", type: "submit" }, tr("Enregistrer")))
            )
      )
    );
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
