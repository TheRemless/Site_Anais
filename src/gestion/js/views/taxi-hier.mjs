// Taxi, le lendemain d'une course : demander la commission à Mr. Brown, puis la saisir (aucune commission par défaut, décision du 12.11.2026).
// La commission saisie est la « commission prévue » de la réservation : l'écran À encaisser la suit ensuite comme pour Secret.
import { etat, modifier, enregistrerLie, nomClient, partenaireDe, dossiersAnnules, reglages, entiteActive, peut } from "../etat.mjs";
import { h, icone, toast } from "../ui.mjs";
import { aujourdhui, ajouterJours, formatMontant, formatDate } from "../calc.mjs";
import { commissionsADemander, valeursCommission } from "../taxi-calc.mjs";
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
  const liste = commissionsADemander(etat.db.reservations, ajouterJours(ajd, -1), { ecartes: dossiersAnnules(), netDe });
  if (!liste.length) return null;
  const devise = reglages().devise || "THB";
  const carte = (x) => {
    const r = x.reservation;
    const d = etat.db.dossiers.find((y) => y.id === r.dossier_id) || {};
    const client = etat.db.clients.find((c) => c.id === d.client_id) || {};
    const p = partenaireDe(r.partenaire_id);
    const demander = () =>
      ouvrirMessage({
        titre: tr("Commission à demander à {nom}", { nom: nomContact(p) }),
        pour: "partenaire",
        cle: "commission",
        langue: "th",
        telephone: telWhatsApp(p),
        vars: (langue) => variablesMessage({ reservation: r, client, dossier: d, partenaire: p || {}, entreprise: { nom: reglages().emetteur.nom || entiteActive().nom, devise }, langue }),
        surEnvoi: async () => {
          const actuelle = etat.db.reservations.find((y) => y.id === r.id) || r;
          await modifier("reservations", r.id, { details: { ...(actuelle.details || {}), commission_demandee_le: ajd } });
          rafraichir();
        },
      });
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
        h("span", { class: "carte-sous" }, [r.libelle, r.montant_vente != null ? formatMontant(r.montant_vente, devise) : ""].filter(Boolean).join(" · ")),
        x.saisie
          ? h("span", { class: "carte-pied" }, h("span", { class: "tag" }, x.recue ? tr("Commission reçue : {montant}", { montant: formatMontant(x.montant, devise) }) : tr("Commission annoncée : {montant}", { montant: formatMontant(x.montant, devise) })))
          : h(
              "div",
              { class: "taxi-commission" },
              x.demandeLe ? h("p", { class: "aide" }, tr("Demandée le {date}. Saisissez le montant dès que {nom} répond.", { date: formatDate(x.demandeLe), nom: nomContact(p) })) : h("button", { class: "principal petit", type: "button", onclick: demander }, icone("whatsapp", 16), tr("Demander la commission à {nom}", { nom: nomContact(p) })),
              h("form", { class: "taxi-commission-form", onsubmit: enregistrer }, h("label", { class: "taxi-commission-champ" }, h("span", null, tr("Commission")), montant), h("label", { class: "case" }, recue, tr("Déjà reçue")), h("button", { class: "secondaire petit", type: "submit" }, tr("Enregistrer")))
            )
      )
    );
  };
  return h("section", null, h("h2", null, tr("Hier : commission à demander"), h("span", { class: "tag" }, liste.filter((x) => !x.saisie).length)), h("ul", { class: "cartes" }, liste.map(carte)));
}
