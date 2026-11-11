// Tâches et rappels : un écran pour toute l'entreprise, une section dans chaque dossier, un résumé sur le tableau de bord.
import { etat, peut, equipe, modifier, inserer, supprimer, entiteActive, nomClient } from "../etat.mjs";
import { h, champ, modal, toast, confirmer, vider } from "../ui.mjs";
import { aujourdhui, formatDate } from "../calc.mjs";
import { vide } from "./commun.mjs";
import { reportsProposes } from "../feuille-calc.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

const par = (a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999") || a.created_at.localeCompare(b.created_at);

export const tachesDe = (filtre) => etat.db.taches.filter(filtre).sort(par);
export const mesTaches = () => tachesDe((t) => !t.fait && t.assignee_id === etat.session.id);
export const classe = (t, ajd) => (t.fait ? "" : t.echeance && t.echeance < ajd ? "retard" : t.echeance === ajd ? "jour" : "");

const ajouterJours = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
const rafraichir = () => window.dispatchEvent(new HashChangeEvent("hashchange"));

// Reporter une tâche : demain, dans 2 jours, lundi, dans une semaine. Un choix, c'est fait.
function reporter(t) {
  const r = reportsProposes(aujourdhui());
  const choix = [[tr("Demain"), r.demain], [tr("Dans 2 jours"), r.deuxJours], [tr("Lundi"), r.lundi], [tr("Dans une semaine"), r.semaine]];
  const fermer = modal(
    tr("Reporter « {titre} »", { titre: t.titre }),
    h("div", { class: "modal-corps reporter" }, choix.map(([libelle, jour]) => h("button", { class: "secondaire", type: "button", onclick: async () => {
      fermer();
      try {
        await modifier("taches", t.id, { echeance: jour });
        toast(tr("Reportée au {date}.", { date: formatDate(jour) }));
        rafraichir();
      } catch (err) {
        toast(tr("Modification impossible : {message}", { message: err.message }), true);
      }
    } }, h("span", null, libelle), h("span", { class: "aide" }, formatDate(jour))))),
    { protege: false }
  );
}

async function noms() {
  return new Map((await equipe()).map((p) => [p.user_id, p.nom || p.email]));
}

// Liste de tâches avec case à cocher. `avecDossier` affiche le dossier lié (inutile dans la fiche du dossier).
export function listeTaches(taches, { avecDossier = true } = {}) {
  const ajd = aujourdhui();
  const ul = h("ul", { class: "taches-liste" });
  const spans = new Map();
  for (const t of taches) {
    const dossier = t.dossier_id ? etat.db.dossiers.find((d) => d.id === t.dossier_id) : null;
    const moi = t.assignee_id === etat.session.id;
    const modifiable = moi || peut("taches.ecrire");
    const qui = h("span", null);
    spans.set(t, qui);
    ul.append(
      h(
        "li",
        { class: `tache ${t.fait ? "faite" : ""} ${classe(t, ajd)}` },
        h("label", { class: "case-tache" },
          h("input", {
            type: "checkbox",
            checked: t.fait,
            disabled: !modifiable,
            "aria-label": t.fait ? tr("Marquer « {titre} » comme à faire", { titre: t.titre }) : tr("Marquer « {titre} » comme faite", { titre: t.titre }),
            onchange: async (e) => {
              try {
                await modifier("taches", t.id, { fait: e.target.checked, fait_le: e.target.checked ? new Date().toISOString() : null, fait_par: e.target.checked ? etat.session.id : null });
                window.dispatchEvent(new HashChangeEvent("hashchange"));
              } catch (err) {
                toast(tr("Modification impossible : {message}", { message: err.message }), true);
                e.target.checked = t.fait;
              }
            },
          })
        ),
        h(
          "div",
          { class: "tache-texte" },
          h("strong", null, t.titre),
          h("span", { class: "tache-meta" }, t.echeance ? tr("Pour le {date}", { date: formatDate(t.echeance) }) : tr("Sans échéance"), qui, avecDossier && dossier ? [" · ", h("a", { href: `#/dossier/${dossier.id}` }, dossier.ref)] : null)
        ),
        !t.fait && modifiable ? h("button", { class: "secondaire petit", type: "button", "aria-label": tr("Reporter la tâche « {titre} »", { titre: t.titre }), onclick: () => reporter(t) }, tr("Reporter")) : null,
        peut("taches.ecrire")
          ? h(
              "button",
              {
                class: "lien danger-texte",
                type: "button",
                "aria-label": tr("Supprimer la tâche « {titre} »", { titre: t.titre }),
                onclick: async () => {
                  if (await confirmer(tr("Supprimer la tâche « {titre} » ?", { titre: t.titre }), tr("Supprimer"), true)) {
                    await supprimer("taches", t.id);
                    window.dispatchEvent(new HashChangeEvent("hashchange"));
                  }
                },
              },
              tr("Supprimer")
            )
          : null
      )
    );
  }
  noms().then((m) => spans.forEach((el, t) => (el.textContent = t.assignee_id && m.get(t.assignee_id) ? ` · ${m.get(t.assignee_id)}` : "")));
  return ul;
}

// Formulaire d'ajout. `dossierId` lie la tâche à un dossier, sinon elle est libre.
export function formulaireTache(dossierId = null) {
  if (!peut("taches.ecrire")) return null;
  const titre = h("input", { id: `t-titre-${dossierId || "libre"}`, required: true, placeholder: tr("Par exemple : rappeler le client") });
  const echeance = h("input", { id: `t-ech-${dossierId || "libre"}`, type: "date" });
  const sel = h("select", { id: `t-qui-${dossierId || "libre"}` }, h("option", { value: etat.session.id }, tr("Moi")));
  equipe().then((gens) => {
    sel.replaceChildren(h("option", { value: "" }, tr("Personne")), ...gens.map((p) => h("option", { value: p.user_id }, p.user_id === etat.session.id ? tr("Moi") : p.nom || p.email)));
    sel.value = etat.session.id;
  });
  return h(
    "form",
    {
      class: "formulaire en-ligne tache-form",
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await inserer("taches", { dossier_id: dossierId, titre: titre.value.trim(), description: "", echeance: echeance.value || null, assignee_id: sel.value || null, fait: false });
          toast(tr("Tâche ajoutée."));
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        } catch (err) {
          toast(tr("Ajout impossible : {message}", { message: err.message }), true);
        }
      },
    },
    h("div", { class: "grille-form" }, champ(tr("Nouvelle tâche"), titre), champ(tr("Pour le"), echeance), champ(tr("Confiée à"), sel)),
    h("div", { class: "actions" }, h("button", { class: "secondaire", type: "submit" }, tr("Ajouter la tâche")))
  );
}

// « Me le rappeler » depuis un dossier : une tâche pour moi, à la date choisie, nommée d'après le client.
function rappelsRapides(dossierId) {
  if (!peut("taches.ecrire")) return null;
  const d = etat.db.dossiers.find((x) => x.id === dossierId);
  const c = d ? etat.db.clients.find((x) => x.id === d.client_id) : null;
  const titre = tr("Relancer {nom}", { nom: c ? nomClient(c) : d ? d.ref : "" });
  let encours = false; // un second tap pendant l'enregistrement ne crée pas une seconde tâche
  const creer = async (jours) => {
    if (encours) return;
    encours = true;
    try {
      const jour = ajouterJours(aujourdhui(), jours);
      await inserer("taches", { dossier_id: dossierId, titre, description: "", echeance: jour, assignee_id: etat.session.id, fait: false });
      toast(tr("Rappel pour le {date}.", { date: formatDate(jour) }));
      rafraichir();
    } catch (err) {
      toast(tr("Ajout impossible : {message}", { message: err.message }), true);
      encours = false;
    }
  };
  return h("div", { class: "rappels-rapides" }, h("span", { class: "aide" }, tr("Me le rappeler")), [[tr("Demain"), 1], [tr("Dans 2 jours"), 2], [tr("Dans une semaine"), 7]].map(([libelle, n]) => h("button", { class: "secondaire petit", type: "button", onclick: () => creer(n) }, libelle)));
}

export function sectionTachesDossier(dossierId) {
  const taches = tachesDe((t) => t.dossier_id === dossierId);
  const ouvertes = taches.filter((t) => !t.fait);
  const faites = taches.filter((t) => t.fait);
  return h(
    "section",
    null,
    h("h2", null, tr("Tâches")),
    rappelsRapides(dossierId),
    ouvertes.length ? listeTaches(ouvertes, { avecDossier: false }) : h("p", { class: "vide-court" }, tr("Aucune tâche en cours pour ce dossier.")),
    faites.length ? h("details", null, h("summary", null, pluriel(faites.length, N_("{n} tâche terminée"), N_("{n} tâches terminées"))), listeTaches(faites, { avecDossier: false })) : null,
    formulaireTache(dossierId)
  );
}

const FILTRES = [["mes", N_("Mes tâches")], ["equipe", N_("Toute l'équipe")], ["faites", N_("Terminées")]];
let filtreCourant = "mes";

export function vueTaches() {
  const ajd = aujourdhui();
  const tout = {
    mes: tachesDe((t) => !t.fait && t.assignee_id === etat.session.id),
    equipe: tachesDe((t) => !t.fait),
    faites: etat.db.taches.filter((t) => t.fait).sort((a, b) => (b.fait_le || "").localeCompare(a.fait_le || "")),
  };
  const groupes = [
    [tr("En retard"), (t) => t.echeance && t.echeance < ajd],
    [tr("Aujourd'hui"), (t) => t.echeance === ajd],
    [tr("À venir"), (t) => t.echeance && t.echeance > ajd],
    [tr("Sans échéance"), (t) => !t.echeance],
  ];
  const corps = h("div");
  const dessiner = () => {
    vider(corps);
    const liste = tout[filtreCourant];
    if (!liste.length) return corps.append(vide(filtreCourant === "faites" ? tr("Aucune tâche terminée récemment") : tr("Rien à faire"), filtreCourant === "mes" ? tr("Aucune tâche ne vous est confiée pour l'instant.") : tr("Aucune tâche dans cette liste.")));
    if (filtreCourant === "faites") return corps.append(listeTaches(liste));
    for (const [titre, test] of groupes) {
      const l = liste.filter(test);
      if (l.length) corps.append(h("section", null, h("h2", null, `${titre} (${l.length})`), listeTaches(l)));
    }
  };
  const onglets = h("div", { class: "onglets" }, FILTRES.map(([k, l]) => h("button", { type: "button", "aria-pressed": k === filtreCourant ? "true" : "false", onclick: (e) => { filtreCourant = k; for (const b of onglets.children) b.setAttribute("aria-pressed", b === e.currentTarget ? "true" : "false"); dessiner(); } }, tr(l))));
  dessiner();
  return h("div", { "data-titre": tr("Tâches") }, h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Tâches")), h("p", { class: "sous" }, entiteActive().nom))), formulaireTache(null), h("div", { class: "barre-outils" }, onglets), corps);
}
