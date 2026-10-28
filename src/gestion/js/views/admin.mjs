// Administration : entreprises et accès des utilisateurs. Réservée à l'administratrice générale.
import { etat, estSuperAdmin, creerEntite, modifierEntite, definirAcces, modifierProfil, naviguer } from "../etat.mjs";
import { h, champ, modal, toast, slug } from "../ui.mjs";
import { vide } from "./commun.mjs";

const ROLES = [
  ["", "Aucun accès"],
  ["editeur", "Éditeur : documents, clients, paiements"],
  ["admin", "Administrateur : tout, y compris les réglages"],
];

function nouvelleEntiteModal(apres) {
  const nom = h("input", { id: "ne-nom", required: true });
  const code = h("input", { id: "ne-slug", required: true, pattern: "[a-z0-9-]+" });
  let manuel = false;
  code.addEventListener("input", () => (manuel = true));
  nom.addEventListener("input", () => !manuel && (code.value = slug(nom.value)));
  const fermer = modal(
    "Nouvelle entreprise",
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (e) => {
          e.preventDefault();
          if (etat.brut.entites.some((x) => x.slug === code.value)) return toast("Ce code existe déjà.", true);
          try {
            await creerEntite(nom.value.trim(), code.value.trim());
            fermer();
            toast("Entreprise créée. Complétez ses réglages avant de créer des documents.");
            apres();
          } catch (err) {
            toast(`Création impossible : ${err.message}`, true);
          }
        },
      },
      champ("Nom", nom),
      champ("Code court", code, "Lettres minuscules, chiffres et tirets. Il ne change plus ensuite."),
      h("p", { class: "aide" }, "Elle démarre sans client ni catalogue, avec des réglages vides à compléter dans l'écran Réglages de cette entreprise."),
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, "Annuler"), h("button", { type: "submit", class: "principal" }, "Créer l'entreprise"))
    )
  );
}

function modifierEntiteModal(e, apres) {
  const nom = h("input", { id: "me-nom", value: e.nom, required: true });
  const actif = h("input", { id: "me-actif", type: "checkbox", checked: e.actif });
  const ordre = h("input", { id: "me-ordre", type: "number", value: e.ordre });
  const fermer = modal(
    `Modifier ${e.nom}`,
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (ev) => {
          ev.preventDefault();
          try {
            await modifierEntite(e.id, { nom: nom.value.trim(), actif: actif.checked, ordre: Number(ordre.value) || 0 });
            fermer();
            toast("Entreprise modifiée.");
            apres();
          } catch (err) {
            toast(`Modification impossible : ${err.message}`, true);
          }
        },
      },
      champ("Nom", nom),
      champ("Position dans la liste", ordre),
      h("label", { class: "case", for: "me-actif" }, actif, "Entreprise active (une entreprise désactivée disparaît des listes mais garde ses données)"),
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, "Annuler"), h("button", { type: "submit", class: "principal" }, "Enregistrer"))
    )
  );
}

function accesModal(profil, apres) {
  const moi = profil.user_id === etat.session.id;
  const nom = h("input", { id: "ua-nom", value: profil.nom || "" });
  const actif = h("input", { id: "ua-actif", type: "checkbox", checked: profil.actif, disabled: moi });
  const superAdmin = h("input", { id: "ua-super", type: "checkbox", checked: profil.super_admin, disabled: moi });
  const selects = etat.brut.entites.map((e) => {
    const m = etat.brut.membres.find((x) => x.user_id === profil.user_id && x.entite_id === e.id);
    const sel = h("select", { id: `ua-${e.id}` }, ROLES.map(([v, l]) => h("option", { value: v }, l)));
    sel.value = m ? m.role : "";
    return [e, sel];
  });
  const grille = h("div", { class: "acces-grille" }, selects.map(([e, sel]) => champ(e.nom + (e.actif ? "" : " (désactivée)"), sel)));
  const majSuper = () => (grille.hidden = superAdmin.checked);
  superAdmin.addEventListener("change", majSuper);
  majSuper();
  const fermer = modal(
    profil.email || "Utilisateur",
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (ev) => {
          ev.preventDefault();
          try {
            await modifierProfil(profil.user_id, { nom: nom.value.trim() || null, actif: moi ? true : actif.checked, super_admin: moi ? true : superAdmin.checked });
            for (const [e, sel] of selects) {
              const avant = etat.brut.membres.find((x) => x.user_id === profil.user_id && x.entite_id === e.id);
              if ((avant ? avant.role : "") !== sel.value) await definirAcces(profil.user_id, e.id, sel.value || null);
            }
            fermer();
            toast("Accès enregistrés.");
            apres();
          } catch (err) {
            toast(`Enregistrement impossible : ${err.message}`, true);
          }
        },
      },
      champ("Nom affiché", nom),
      h("label", { class: "case", for: "ua-actif" }, actif, "Compte actif (décochez pour couper tout accès sans supprimer le compte)"),
      h("label", { class: "case", for: "ua-super" }, superAdmin, "Administratrice générale : voit toutes les entreprises et gère les accès"),
      moi ? h("p", { class: "aide" }, "Vous ne pouvez pas modifier votre propre statut.") : null,
      grille,
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, "Annuler"), h("button", { type: "submit", class: "principal" }, "Enregistrer"))
    )
  );
}

export function vueAdmin() {
  if (!estSuperAdmin()) return vide("Accès réservé", "Cet écran est réservé à l'administratrice générale.", h("a", { class: "bouton secondaire", href: "#/" }, "Retour au tableau de bord"));
  const rafraichir = () => naviguer(location.hash);
  const entites = [...etat.brut.entites].sort((a, b) => a.ordre - b.ordre);
  const nbMembres = (id) => etat.brut.membres.filter((m) => m.entite_id === id).length;
  const resumeAcces = (p) => {
    if (p.super_admin) return "Toutes les entreprises, en administratrice";
    const l = etat.brut.membres.filter((m) => m.user_id === p.user_id).map((m) => `${(etat.brut.entites.find((e) => e.id === m.entite_id) || { nom: "?" }).nom} (${m.role === "admin" ? "administrateur" : "éditeur"})`);
    return l.length ? l.join(", ") : "Aucun accès";
  };

  return h(
    "div",
    { "data-titre": "Administration" },
    h("div", { class: "entete" }, h("h1", null, "Administration")),
    h(
      "section",
      null,
      h("div", { class: "entete petit-entete" }, h("h2", null, "Entreprises"), h("button", { class: "secondaire", type: "button", onclick: () => nouvelleEntiteModal(rafraichir) }, "Nouvelle entreprise")),
      h("p", { class: "aide" }, "Chaque entreprise a ses propres clients, dossiers, paiements, catalogue, réglages, logo et devise. Personne ne voit une entreprise sans y avoir accès."),
      h(
        "table",
        { class: "tableau simple" },
        h("thead", null, h("tr", null, ["Entreprise", "Code", "Personnes", "Statut", ""].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, entites.map((e) => h("tr", null, h("td", { "data-label": "Entreprise" }, e.nom), h("td", { "data-label": "Code", class: "ref" }, e.slug), h("td", { "data-label": "Personnes" }, nbMembres(e.id)), h("td", { "data-label": "Statut" }, e.actif ? "Active" : "Désactivée"), h("td", { class: "action-cellule" }, h("button", { class: "secondaire petit", type: "button", onclick: () => modifierEntiteModal(e, rafraichir) }, "Modifier")))))
      )
    ),
    h(
      "section",
      null,
      h("h2", null, "Utilisateurs"),
      h("p", { class: "aide" }, "Pour ajouter une personne, créez d'abord son compte dans Supabase (Authentication, Users, Add user). Elle apparaît ensuite ici et vous lui donnez accès aux entreprises voulues, comme éditeur (documents, clients, paiements) ou comme administrateur (réglages compris)."),
      h(
        "table",
        { class: "tableau simple" },
        h("thead", null, h("tr", null, ["Personne", "Accès", "Statut", ""].map((t) => h("th", { scope: "col" }, t)))),
        h(
          "tbody",
          null,
          etat.brut.profils.map((p) =>
            h(
              "tr",
              null,
              h("td", { "data-label": "Personne" }, h("strong", null, p.nom || p.email), p.nom ? h("span", { class: "sous-ligne" }, p.email) : null),
              h("td", { "data-label": "Accès" }, resumeAcces(p)),
              h("td", { "data-label": "Statut" }, p.actif ? "Actif" : "Désactivé"),
              h("td", { class: "action-cellule" }, h("button", { class: "secondaire petit", type: "button", onclick: () => accesModal(p, rafraichir) }, "Gérer l'accès"))
            )
          )
        )
      )
    )
  );
}
