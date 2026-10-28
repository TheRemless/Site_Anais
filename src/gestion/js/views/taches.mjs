// Tâches et rappels : un écran pour toute l'entreprise, une section dans chaque dossier, un résumé sur le tableau de bord.
import { etat, peut, equipe, modifier, inserer, supprimer, entiteActive } from "../etat.mjs";
import { h, champ, toast, confirmer, vider } from "../ui.mjs";
import { aujourdhui, formatDate } from "../calc.mjs";
import { vide } from "./commun.mjs";

const par = (a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999") || a.created_at.localeCompare(b.created_at);

export const tachesDe = (filtre) => etat.db.taches.filter(filtre).sort(par);
export const mesTaches = () => tachesDe((t) => !t.fait && t.assignee_id === etat.session.id);
export const classe = (t, ajd) => (t.fait ? "" : t.echeance && t.echeance < ajd ? "retard" : t.echeance === ajd ? "jour" : "");

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
        h("input", {
          type: "checkbox",
          checked: t.fait,
          disabled: !modifiable,
          "aria-label": `Marquer « ${t.titre} » comme ${t.fait ? "à faire" : "faite"}`,
          onchange: async (e) => {
            try {
              await modifier("taches", t.id, { fait: e.target.checked, fait_le: e.target.checked ? new Date().toISOString() : null, fait_par: e.target.checked ? etat.session.id : null });
              window.dispatchEvent(new HashChangeEvent("hashchange"));
            } catch (err) {
              toast(`Modification impossible : ${err.message}`, true);
              e.target.checked = t.fait;
            }
          },
        }),
        h(
          "div",
          { class: "tache-texte" },
          h("strong", null, t.titre),
          h("span", { class: "tache-meta" }, t.echeance ? `Pour le ${formatDate(t.echeance)}` : "Sans échéance", qui, avecDossier && dossier ? [" · ", h("a", { href: `#/dossier/${dossier.id}` }, dossier.ref)] : null)
        ),
        peut("taches.ecrire")
          ? h(
              "button",
              {
                class: "lien danger-texte",
                type: "button",
                "aria-label": `Supprimer la tâche « ${t.titre} »`,
                onclick: async () => {
                  if (await confirmer(`Supprimer la tâche « ${t.titre} » ?`, "Supprimer", true)) {
                    await supprimer("taches", t.id);
                    window.dispatchEvent(new HashChangeEvent("hashchange"));
                  }
                },
              },
              "Supprimer"
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
  const titre = h("input", { id: `t-titre-${dossierId || "libre"}`, required: true, placeholder: "Par exemple : rappeler le client" });
  const echeance = h("input", { id: `t-ech-${dossierId || "libre"}`, type: "date" });
  const sel = h("select", { id: `t-qui-${dossierId || "libre"}` }, h("option", { value: etat.session.id }, "Moi"));
  equipe().then((gens) => {
    sel.replaceChildren(h("option", { value: "" }, "Personne"), ...gens.map((p) => h("option", { value: p.user_id }, p.user_id === etat.session.id ? "Moi" : p.nom || p.email)));
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
          toast("Tâche ajoutée.");
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        } catch (err) {
          toast(`Ajout impossible : ${err.message}`, true);
        }
      },
    },
    h("div", { class: "grille-form" }, champ("Nouvelle tâche", titre), champ("Pour le", echeance), champ("Confiée à", sel)),
    h("div", { class: "actions" }, h("button", { class: "secondaire", type: "submit" }, "Ajouter la tâche"))
  );
}

export function sectionTachesDossier(dossierId) {
  const taches = tachesDe((t) => t.dossier_id === dossierId);
  const ouvertes = taches.filter((t) => !t.fait);
  const faites = taches.filter((t) => t.fait);
  return h(
    "section",
    null,
    h("h2", null, "Tâches"),
    ouvertes.length ? listeTaches(ouvertes, { avecDossier: false }) : h("p", { class: "vide-court" }, "Aucune tâche en cours pour ce dossier."),
    faites.length ? h("details", null, h("summary", null, `${faites.length} tâche${faites.length > 1 ? "s" : ""} terminée${faites.length > 1 ? "s" : ""}`), listeTaches(faites, { avecDossier: false })) : null,
    formulaireTache(dossierId)
  );
}

const FILTRES = [["mes", "Mes tâches"], ["equipe", "Toute l'équipe"], ["faites", "Terminées"]];
let filtreCourant = "mes";

export function vueTaches() {
  const ajd = aujourdhui();
  const tout = {
    mes: tachesDe((t) => !t.fait && t.assignee_id === etat.session.id),
    equipe: tachesDe((t) => !t.fait),
    faites: etat.db.taches.filter((t) => t.fait).sort((a, b) => (b.fait_le || "").localeCompare(a.fait_le || "")),
  };
  const groupes = [
    ["En retard", (t) => t.echeance && t.echeance < ajd],
    ["Aujourd'hui", (t) => t.echeance === ajd],
    ["À venir", (t) => t.echeance && t.echeance > ajd],
    ["Sans échéance", (t) => !t.echeance],
  ];
  const corps = h("div");
  const dessiner = () => {
    vider(corps);
    const liste = tout[filtreCourant];
    if (!liste.length) return corps.append(vide(filtreCourant === "faites" ? "Aucune tâche terminée récemment" : "Rien à faire", filtreCourant === "mes" ? "Aucune tâche ne vous est confiée pour l'instant." : "Aucune tâche dans cette liste."));
    if (filtreCourant === "faites") return corps.append(listeTaches(liste));
    for (const [titre, test] of groupes) {
      const l = liste.filter(test);
      if (l.length) corps.append(h("section", null, h("h2", null, `${titre} (${l.length})`), listeTaches(l)));
    }
  };
  const onglets = h("div", { class: "onglets" }, FILTRES.map(([k, l]) => h("button", { type: "button", "aria-pressed": k === filtreCourant ? "true" : "false", onclick: (e) => { filtreCourant = k; for (const b of onglets.children) b.setAttribute("aria-pressed", b === e.currentTarget ? "true" : "false"); dessiner(); } }, l)));
  dessiner();
  return h("div", { "data-titre": "Tâches" }, h("div", { class: "entete" }, h("div", null, h("h1", null, "Tâches"), h("p", { class: "sous" }, entiteActive().nom))), formulaireTache(null), h("div", { class: "barre-outils" }, onglets), corps);
}
