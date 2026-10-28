// Administration : entreprises et accès des utilisateurs. Réservée à l'administratrice générale.
import { etat, estSuperAdmin, creerEntite, modifierEntite, definirAcces, modifierProfil, naviguer, inserer, modifier, supprimer } from "../etat.mjs";
import { PERMISSIONS, DEPENDANCES } from "../defauts.mjs";
import { h, champ, modal, toast, slug, confirmer } from "../ui.mjs";
import { vide } from "./commun.mjs";

const PORTEES = [
  ["toute", "Tous les dossiers de l'entreprise"],
  ["mes_dossiers", "Seulement les dossiers dont la personne est responsable ou qu'elle a créés"],
];

// Éditeur d'un rôle : nom, portée et une case à cocher par droit, avec leurs dépendances.
function roleModal(entite, role, apres) {
  const nouveau = !role.id;
  const verrou = role.systeme && role.nom === "Administrateur";
  const nom = h("input", { id: "rl-nom", value: role.nom || "", required: true, disabled: role.systeme });
  const description = h("input", { id: "rl-desc", value: role.description || "" });
  const portee = h("select", { id: "rl-portee", disabled: verrou }, PORTEES.map(([v, l]) => h("option", { value: v }, l)));
  portee.value = role.portee || "toute";
  const choisis = new Set(role.permissions || []);
  const cases = new Map();
  const majCases = () => cases.forEach((c, code) => (c.checked = choisis.has(code)));
  const basculer = (code, coche) => {
    if (coche) {
      choisis.add(code);
      (DEPENDANCES[code] || []).forEach((d) => choisis.add(d));
    } else {
      choisis.delete(code);
      for (const [autre, requis] of Object.entries(DEPENDANCES)) if (requis.includes(code)) choisis.delete(autre);
    }
    majCases();
  };
  const groupes = [...new Set(PERMISSIONS.map((p) => p.groupe))];
  const blocs = groupes.map((g) =>
    h(
      "fieldset",
      null,
      h("legend", null, g),
      PERMISSIONS.filter((p) => p.groupe === g).map((p) => {
        const c = h("input", { type: "checkbox", id: `perm-${p.code}`, disabled: verrou, onchange: (e) => basculer(p.code, e.target.checked) });
        cases.set(p.code, c);
        return h("div", null, h("label", { class: "case", for: `perm-${p.code}` }, c, p.libelle), p.aide ? h("p", { class: "aide decale" }, p.aide) : null);
      })
    )
  );
  majCases();
  const fermer = modal(
    nouveau ? `Nouveau rôle pour ${entite.nom}` : `Rôle « ${role.nom} »`,
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (e) => {
          e.preventDefault();
          const valeurs = { nom: nom.value.trim(), description: description.value.trim(), portee: portee.value, permissions: [...choisis] };
          if (etat.brut.roles.some((r) => r.entite_id === entite.id && r.id !== role.id && r.nom.toLowerCase() === valeurs.nom.toLowerCase())) return toast("Ce nom de rôle existe déjà.", true);
          try {
            if (nouveau) await inserer("roles", { ...valeurs, entite_id: entite.id, systeme: false });
            else await modifier("roles", role.id, valeurs);
            fermer();
            toast("Rôle enregistré. Il s'applique tout de suite.");
            apres();
          } catch (err) {
            toast(`Enregistrement impossible : ${err.message}`, true);
          }
        },
      },
      champ("Nom du rôle", nom),
      champ("Description", description, "Pour s'y retrouver dans la liste."),
      champ("Dossiers visibles", portee, verrou ? "L'administrateur a tous les droits, ce rôle n'est pas modifiable." : null),
      h("p", { class: "aide" }, "Chaque case ajoute un droit. Un droit en suppose d'autres : « modifier » coche automatiquement « voir »."),
      ...blocs,
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, "Annuler"), verrou ? null : h("button", { type: "submit", class: "principal" }, "Enregistrer le rôle"))
    ),
    { large: true }
  );
}

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
    const sel = h("select", { id: `ua-${e.id}` }, h("option", { value: "" }, "Aucun accès"), etat.brut.roles.filter((r) => r.entite_id === e.id).map((r) => h("option", { value: r.id }, r.nom)));
    sel.value = m ? m.role_id : "";
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
              if ((avant ? avant.role_id : "") !== sel.value) await definirAcces(profil.user_id, e.id, sel.value || null);
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
    const l = etat.brut.membres.filter((m) => m.user_id === p.user_id).map((m) => `${(etat.brut.entites.find((e) => e.id === m.entite_id) || { nom: "?" }).nom} (${(etat.brut.roles.find((r) => r.id === m.role_id) || { nom: "?" }).nom})`);
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
      h("h2", null, "Rôles et droits"),
      h("p", { class: "aide" }, "Un rôle est un ensemble de droits, défini pour chaque entreprise. Vous pouvez en créer autant que nécessaire (comptable, chauffeur, stagiaire…) et décider précisément ce que chacun voit et peut faire. Les droits d'un rôle s'appliquent tout de suite à toutes les personnes qui l'ont."),
      ...entites.map((e) => {
        const roles = etat.brut.roles.filter((r) => r.entite_id === e.id).sort((a, b) => (b.systeme - a.systeme) || a.nom.localeCompare(b.nom));
        const usage = (r) => etat.brut.membres.filter((m) => m.role_id === r.id).length;
        return h(
          "div",
          { class: "bloc-roles" },
          h("div", { class: "entete petit-entete" }, h("h3", null, e.nom), h("button", { class: "secondaire petit", type: "button", onclick: () => roleModal(e, {}, rafraichir) }, "Nouveau rôle")),
          h(
            "table",
            { class: "tableau simple" },
            h("thead", null, h("tr", null, ["Rôle", "Dossiers visibles", "Droits", "Personnes", ""].map((t) => h("th", { scope: "col" }, t)))),
            h(
              "tbody",
              null,
              roles.map((r) =>
                h(
                  "tr",
                  null,
                  h("td", { "data-label": "Rôle" }, h("strong", null, r.nom), r.description ? h("span", { class: "sous-ligne" }, r.description) : null),
                  h("td", { "data-label": "Dossiers visibles" }, r.portee === "toute" ? "Tous" : "Ses dossiers"),
                  h("td", { "data-label": "Droits" }, `${r.permissions.length} sur ${PERMISSIONS.length}`),
                  h("td", { "data-label": "Personnes" }, usage(r)),
                  h(
                    "td",
                    { class: "action-cellule" },
                    h("button", { class: "secondaire petit", type: "button", onclick: () => roleModal(e, r, rafraichir) }, "Modifier"),
                    h("button", { class: "secondaire petit", type: "button", onclick: () => roleModal(e, { nom: `${r.nom} (copie)`, description: r.description, portee: r.portee, permissions: r.permissions }, rafraichir) }, "Dupliquer"),
                    r.systeme || usage(r) ? null : h("button", { class: "lien danger-texte", type: "button", onclick: async () => { if (await confirmer(`Supprimer le rôle « ${r.nom} » ?`, "Supprimer", true)) { await supprimer("roles", r.id); rafraichir(); } } }, "Supprimer")
                  )
                )
              )
            )
          )
        );
      })
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
