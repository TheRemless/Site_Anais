// Administration : entreprises et accès des utilisateurs. Réservée à l'administratrice générale.
import { etat, nomRole, descriptionRole, estSuperAdmin, creerEntite, modifierEntite, definirAcces, modifierProfil, naviguer, inserer, modifier, supprimer } from "../etat.mjs";
import { PERMISSIONS, DEPENDANCES } from "../defauts.mjs";
import { h, champ, modal, toast, slug, confirmer } from "../ui.mjs";
import { vide, plierSections } from "./commun.mjs";
import { tr, N_ } from "../i18n.mjs";

const PORTEES = [
  ["toute", N_("Tous les dossiers de l'entreprise")],
  ["mes_dossiers", N_("Seulement les dossiers dont la personne est responsable ou qu'elle a créés")],
];

// Éditeur d'un rôle : nom, portée et une case à cocher par droit, avec leurs dépendances.
function roleModal(entite, role, apres) {
  const nouveau = !role.id;
  const verrou = role.systeme && role.nom === "Administrateur";
  const nom = h("input", { id: "rl-nom", value: role.nom || "", required: true, disabled: role.systeme });
  const description = h("input", { id: "rl-desc", value: role.description || "" });
  const portee = h("select", { id: "rl-portee", disabled: verrou }, PORTEES.map(([v, l]) => h("option", { value: v }, tr(l))));
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
      h("legend", null, tr(g)),
      PERMISSIONS.filter((p) => p.groupe === g).map((p) => {
        const c = h("input", { type: "checkbox", id: `perm-${p.code}`, disabled: verrou, onchange: (e) => basculer(p.code, e.target.checked) });
        cases.set(p.code, c);
        return h("div", null, h("label", { class: "case", for: `perm-${p.code}` }, c, tr(p.libelle)), p.aide ? h("p", { class: "aide decale" }, tr(p.aide)) : null);
      })
    )
  );
  majCases();
  const fermer = modal(
    nouveau ? tr("Nouveau rôle pour {nom}", { nom: entite.nom }) : tr("Rôle « {nom} »", { nom: role.nom }),
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (e) => {
          e.preventDefault();
          const valeurs = { nom: nom.value.trim(), description: description.value.trim(), portee: portee.value, permissions: [...choisis] };
          if (etat.brut.roles.some((r) => r.entite_id === entite.id && r.id !== role.id && r.nom.toLowerCase() === valeurs.nom.toLowerCase())) return toast(tr("Ce nom de rôle existe déjà."), true);
          try {
            if (nouveau) await inserer("roles", { ...valeurs, entite_id: entite.id, systeme: false });
            else await modifier("roles", role.id, valeurs);
            fermer();
            toast(tr("Rôle enregistré. Il s'applique tout de suite."));
            apres();
          } catch (err) {
            toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
          }
        },
      },
      champ(tr("Nom du rôle"), nom),
      champ(tr("Description"), description, tr("Pour s'y retrouver dans la liste.")),
      champ(tr("Dossiers visibles"), portee, verrou ? tr("L'administrateur a tous les droits, ce rôle n'est pas modifiable.") : null),
      h("p", { class: "aide" }, tr("Chaque case ajoute un droit. Un droit en suppose d'autres : « modifier » coche automatiquement « voir ».")),
      ...blocs,
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), verrou ? null : h("button", { type: "submit", class: "principal" }, tr("Enregistrer le rôle")))
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
    tr("Nouvelle entreprise"),
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (e) => {
          e.preventDefault();
          if (etat.brut.entites.some((x) => x.slug === code.value)) return toast(tr("Ce code existe déjà."), true);
          try {
            await creerEntite(nom.value.trim(), code.value.trim());
            fermer();
            toast(tr("Entreprise créée. Complétez ses réglages avant de créer des documents."));
            apres();
          } catch (err) {
            toast(tr("Création impossible : {message}", { message: err.message }), true);
          }
        },
      },
      champ(tr("Nom"), nom),
      champ(tr("Code court"), code, tr("Lettres minuscules, chiffres et tirets. Il ne change plus ensuite.")),
      h("p", { class: "aide" }, tr("Elle démarre sans client ni catalogue, avec des réglages vides à compléter dans l'écran Réglages de cette entreprise.")),
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), h("button", { type: "submit", class: "principal" }, tr("Créer l'entreprise")))
    )
  );
}

function modifierEntiteModal(e, apres) {
  const nom = h("input", { id: "me-nom", value: e.nom, required: true });
  const actif = h("input", { id: "me-actif", type: "checkbox", checked: e.actif });
  const ordre = h("input", { id: "me-ordre", type: "number", value: e.ordre });
  const fermer = modal(
    tr("Modifier {nom}", { nom: e.nom }),
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (ev) => {
          ev.preventDefault();
          try {
            await modifierEntite(e.id, { nom: nom.value.trim(), actif: actif.checked, ordre: Number(ordre.value) || 0 });
            fermer();
            toast(tr("Entreprise modifiée."));
            apres();
          } catch (err) {
            toast(tr("Modification impossible : {message}", { message: err.message }), true);
          }
        },
      },
      champ(tr("Nom"), nom),
      champ(tr("Position dans la liste"), ordre),
      h("label", { class: "case", for: "me-actif" }, actif, tr("Entreprise active (une entreprise désactivée disparaît des listes mais garde ses données)")),
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), h("button", { type: "submit", class: "principal" }, tr("Enregistrer")))
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
    const sel = h("select", { id: `ua-${e.id}` }, h("option", { value: "" }, tr("Aucun accès")), etat.brut.roles.filter((r) => r.entite_id === e.id).map((r) => h("option", { value: r.id }, nomRole(r))));
    sel.value = m ? m.role_id : "";
    return [e, sel];
  });
  const grille = h("div", { class: "acces-grille" }, selects.map(([e, sel]) => champ(e.actif ? e.nom : tr("{nom} (désactivée)", { nom: e.nom }), sel)));
  const majSuper = () => (grille.hidden = superAdmin.checked);
  superAdmin.addEventListener("change", majSuper);
  majSuper();
  const fermer = modal(
    profil.email || tr("Utilisateur"),
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
            toast(tr("Accès enregistrés."));
            apres();
          } catch (err) {
            toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
          }
        },
      },
      champ(tr("Nom affiché"), nom),
      h("label", { class: "case", for: "ua-actif" }, actif, tr("Compte actif (décochez pour couper tout accès sans supprimer le compte)")),
      h("label", { class: "case", for: "ua-super" }, superAdmin, tr("Administratrice générale : voit toutes les entreprises et gère les accès")),
      moi ? h("p", { class: "aide" }, tr("Vous ne pouvez pas modifier votre propre statut.")) : null,
      grille,
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), h("button", { type: "submit", class: "principal" }, tr("Enregistrer")))
    )
  );
}

export function vueAdmin() {
  if (!estSuperAdmin()) return vide(tr("Accès réservé"), tr("Cet écran est réservé à l'administratrice générale."), h("a", { class: "bouton secondaire", href: "#/" }, tr("Retour au tableau de bord")));
  const rafraichir = () => naviguer(location.hash);
  const entites = [...etat.brut.entites].sort((a, b) => a.ordre - b.ordre);
  const nbMembres = (id) => etat.brut.membres.filter((m) => m.entite_id === id).length;
  const resumeAcces = (p) => {
    if (p.super_admin) return tr("Toutes les entreprises, en administratrice");
    const l = etat.brut.membres.filter((m) => m.user_id === p.user_id).map((m) => `${(etat.brut.entites.find((e) => e.id === m.entite_id) || { nom: "?" }).nom} (${(etat.brut.roles.find((r) => r.id === m.role_id) || { nom: "?" }).nom})`);
    return l.length ? l.join(", ") : tr("Aucun accès");
  };

  const racine = h(
    "div",
    { "data-titre": tr("Administration") },
    h("div", { class: "entete" }, h("h1", null, tr("Administration"))),
    h(
      "section",
      null,
      h("div", { class: "entete petit-entete" }, h("h2", null, tr("Entreprises")), h("button", { class: "secondaire", type: "button", onclick: () => nouvelleEntiteModal(rafraichir) }, tr("Nouvelle entreprise"))),
      h("p", { class: "aide" }, tr("Chaque entreprise a ses propres clients, dossiers, paiements, catalogue, réglages, logo et devise. Personne ne voit une entreprise sans y avoir accès.")),
      h(
        "table",
        { class: "tableau simple" },
        h("thead", null, h("tr", null, [tr("Entreprise"), tr("Code"), tr("Personnes"), tr("Statut"), ""].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, entites.map((e) => h("tr", null, h("td", { "data-label": tr("Entreprise") }, e.nom), h("td", { "data-label": tr("Code"), class: "ref" }, e.slug), h("td", { "data-label": tr("Personnes") }, nbMembres(e.id)), h("td", { "data-label": tr("Statut") }, e.actif ? tr("Active") : tr("Désactivée")), h("td", { class: "action-cellule" }, h("button", { class: "secondaire petit", type: "button", onclick: () => modifierEntiteModal(e, rafraichir) }, tr("Modifier"))))))
      )
    ),
    h(
      "section",
      null,
      h("h2", null, tr("Rôles et droits")),
      h("p", { class: "aide" }, tr("Un rôle est un ensemble de droits, défini pour chaque entreprise. Vous pouvez en créer autant que nécessaire (comptable, chauffeur, stagiaire…) et décider précisément ce que chacun voit et peut faire. Les droits d'un rôle s'appliquent tout de suite à toutes les personnes qui l'ont.")),
      ...entites.map((e) => {
        const roles = etat.brut.roles.filter((r) => r.entite_id === e.id).sort((a, b) => (b.systeme - a.systeme) || a.nom.localeCompare(b.nom));
        const usage = (r) => etat.brut.membres.filter((m) => m.role_id === r.id).length;
        return h(
          "div",
          { class: "bloc-roles" },
          h("div", { class: "entete petit-entete" }, h("h3", null, e.nom), h("button", { class: "secondaire petit", type: "button", onclick: () => roleModal(e, {}, rafraichir) }, tr("Nouveau rôle"))),
          h(
            "table",
            { class: "tableau simple" },
            h("thead", null, h("tr", null, [tr("Rôle"), tr("Dossiers visibles"), tr("Droits"), tr("Personnes"), ""].map((t) => h("th", { scope: "col" }, t)))),
            h(
              "tbody",
              null,
              roles.map((r) =>
                h(
                  "tr",
                  null,
                  h("td", { "data-label": tr("Rôle") }, h("strong", null, nomRole(r)), r.description ? h("span", { class: "sous-ligne" }, descriptionRole(r)) : null),
                  h("td", { "data-label": tr("Dossiers visibles") }, r.portee === "toute" ? tr("Tous") : tr("Ses dossiers")),
                  h("td", { "data-label": tr("Droits") }, tr("{n} sur {n2}", { n: r.permissions.length, n2: PERMISSIONS.length })),
                  h("td", { "data-label": tr("Personnes") }, usage(r)),
                  h(
                    "td",
                    { class: "action-cellule" },
                    h("button", { class: "secondaire petit", type: "button", onclick: () => roleModal(e, r, rafraichir) }, tr("Modifier")),
                    h("button", { class: "secondaire petit", type: "button", onclick: () => roleModal(e, { nom: tr("{nom} (copie)", { nom: nomRole(r) }), description: descriptionRole(r), portee: r.portee, permissions: r.permissions }, rafraichir) }, tr("Dupliquer")),
                    r.systeme || usage(r) ? null : h("button", { class: "lien danger-texte", type: "button", onclick: async () => { if (await confirmer(tr("Supprimer le rôle « {nom} » ?", { nom: nomRole(r) }), tr("Supprimer"), true)) { await supprimer("roles", r.id); rafraichir(); } } }, tr("Supprimer"))
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
      h("h2", null, tr("Utilisateurs")),
      h("p", { class: "aide" }, tr("Pour ajouter une personne, créez d'abord son compte dans Supabase (Authentication, Users, Add user). Elle apparaît ensuite ici et vous lui donnez accès aux entreprises voulues, comme éditeur (documents, clients, paiements) ou comme administrateur (réglages compris).")),
      h(
        "table",
        { class: "tableau simple" },
        h("thead", null, h("tr", null, [tr("Personne"), tr("Accès"), tr("Statut"), ""].map((t) => h("th", { scope: "col" }, t)))),
        h(
          "tbody",
          null,
          etat.brut.profils.map((p) =>
            h(
              "tr",
              null,
              h("td", { "data-label": tr("Personne") }, h("strong", null, p.nom || p.email), p.nom ? h("span", { class: "sous-ligne" }, p.email) : null),
              h("td", { "data-label": tr("Accès") }, resumeAcces(p)),
              h("td", { "data-label": tr("Statut") }, p.actif ? tr("Actif") : tr("Désactivé")),
              h("td", { class: "action-cellule" }, h("button", { class: "secondaire petit", type: "button", onclick: () => accesModal(p, rafraichir) }, tr("Gérer l'accès")))
            )
          )
        )
      )
    )
  );
  // Trois sections longues : repliées sur téléphone, avec le titre comme bouton.
  return plierSections(racine, { cle: "admin", ouverts: new Set([tr("Entreprises")]) });
}
