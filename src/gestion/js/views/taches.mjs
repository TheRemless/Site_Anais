// Tâches et rappels : un écran pour toute l'entreprise, une section dans chaque dossier, un résumé sur le tableau de bord.
import { etat, peut, equipe, modifier, inserer, supprimer, entiteActive, nomClient, dossiersAnnules } from "../etat.mjs";
import { h, champ, modal, toast, confirmer, vider } from "../ui.mjs";
import { aujourdhui, formatDate } from "../calc.mjs";
import { vide, lienDossier } from "./commun.mjs";
import { reportsProposes } from "../feuille-calc.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

const par = (a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999") || a.created_at.localeCompare(b.created_at);

export const tachesDe = (filtre) => etat.db.taches.filter(filtre).sort(par);
// Les tâches d'un dossier annulé n'ont plus à être faites : masquées des listes de travail (Mes tâches, Toute l'équipe, tableau de bord, pastille du menu),
// elles restent sur la fiche du dossier et reviennent si le dossier est rétabli (audit n° 77).
export const tacheActive = (t, annules) => !t.fait && !(t.dossier_id && annules.has(t.dossier_id));
export const mesTaches = () => {
  const annules = dossiersAnnules();
  return tachesDe((t) => tacheActive(t, annules) && t.assignee_id === etat.session.id);
};
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

// Corriger une tâche en place : titre, note, échéance, personne. Réservé au droit « tâches » (la personne à qui elle est confiée peut la cocher et la reporter).
function modifierTache(t) {
  const titre = h("input", { id: "tm-titre", required: true, value: t.titre });
  const description = h("textarea", { id: "tm-desc", rows: 3 });
  description.value = t.description || "";
  const echeance = h("input", { id: "tm-ech", type: "date", value: t.echeance || "" });
  // La personne actuelle est choisie d'emblée : un enregistrement avant le chargement de l'équipe ne la retire pas.
  const sel = h("select", { id: "tm-qui" }, h("option", { value: "" }, tr("Personne")), t.assignee_id ? h("option", { value: t.assignee_id, selected: true }, t.assignee_id === etat.session.id ? tr("Moi") : "…") : null);
  equipe().then((gens) => {
    const choisi = sel.value;
    sel.replaceChildren(h("option", { value: "" }, tr("Personne")), ...gens.map((p) => h("option", { value: p.user_id }, p.user_id === etat.session.id ? tr("Moi") : p.nom || p.email)));
    if (choisi && !gens.some((p) => p.user_id === choisi)) sel.append(h("option", { value: choisi }, "…"));
    sel.value = choisi;
  });
  const form = h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        if (!titre.value.trim()) return titre.focus();
        try {
          await modifier("taches", t.id, { titre: titre.value.trim(), description: description.value.trim(), echeance: echeance.value || null, assignee_id: sel.value || null });
          fermer(true);
          toast(tr("Tâche modifiée."));
          rafraichir();
        } catch (err) {
          toast(tr("Modification impossible : {message}", { message: err.message }), true);
        }
      },
    },
    h("div", { class: "grille-form" }, champ(tr("Tâche"), titre), champ(tr("Pour le"), echeance, tr("Vide : sans échéance.")), champ(tr("Confiée à"), sel)),
    champ(tr("Note"), description),
    h("div", { class: "actions" }, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Annuler")), h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
  );
  const fermer = modal(tr("Modifier la tâche"), form);
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
          avecDossier && dossier ? lienDossier(h("strong", null, t.titre), dossier.id) : h("strong", null, t.titre),
          t.description ? h("span", { class: "tache-meta" }, t.description) : null,
          h("span", { class: "tache-meta" }, t.echeance ? tr("Pour le {date}", { date: formatDate(t.echeance) }) : tr("Sans échéance"), qui, avecDossier && dossier ? [" · ", h("a", { href: `#/dossier/${dossier.id}` }, dossier.ref)] : null)
        ),
        // Les boutons dans leur propre bloc : sur téléphone, ils passent sous le texte au lieu de déborder (trois boutons depuis « Modifier »).
        h("div", { class: "tache-boutons" },
          !t.fait && modifiable ? h("button", { class: "secondaire petit", type: "button", "aria-label": tr("Reporter la tâche « {titre} »", { titre: t.titre }), onclick: () => reporter(t) }, tr("Reporter")) : null,
          peut("taches.ecrire") ? h("button", { class: "secondaire petit", type: "button", "aria-label": tr("Modifier la tâche « {titre} »", { titre: t.titre }), onclick: () => modifierTache(t) }, tr("Modifier")) : null,
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
  const annule = ouvertes.length && dossiersAnnules().has(dossierId);
  return h(
    "section",
    null,
    h("h2", null, tr("Tâches")),
    annule ? h("p", { class: "aide" }, tr("Dossier annulé : ses tâches ne figurent plus dans « Mes tâches » ni dans « Toute l'équipe ». Elles y reviennent si le dossier est rétabli.")) : null,
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
  const annules = dossiersAnnules();
  const tout = {
    mes: tachesDe((t) => tacheActive(t, annules) && t.assignee_id === etat.session.id),
    equipe: tachesDe((t) => tacheActive(t, annules)),
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
