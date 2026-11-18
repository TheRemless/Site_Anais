// Administration : entreprises et accès des utilisateurs. Réservée à l'administratrice générale.
// Lot D (17.11.2026) : inviter une personne, lien de mot de passe, supprimer un compte, langue d'une autre personne, Administrateur calculé.
import { libelleAdmin } from "../noms-calc.mjs";
import { etat, nomRole, descriptionRole, estSuperAdmin, creerEntite, modifierEntite, organisation, modifierOrganisation, definirAcces, modifierProfil, naviguer, inserer, modifier, supprimer, invitation } from "../etat.mjs";
import { DEPENDANCES, completerReglages, PERMISSIONS } from "../defauts.mjs";
import { droitsProposes, droitsDuRole, droitsRetires } from "../droits.mjs";
import { accesChoisis, messageInvitation, messageLien } from "../compte-calc.mjs";
import { h, champ, modal, toast, slug, confirmer, icone, saisie } from "../ui.mjs";
import { vide, plierSections } from "./commun.mjs";
import { tr, N_, LANGUES, pluriel } from "../i18n.mjs";
import { MODELES, MODELE_DEFAUT, DEVISES_PROPOSEES } from "../modeles-metier.mjs";

const PORTEES = [
  ["toute", N_("Tous les dossiers de l'entreprise")],
  ["mes_dossiers", N_("Seulement les dossiers dont la personne est responsable ou qu'elle a créés")],
];

// Fonctionnement d'une entreprise (sur_mesure, excursions, taxi) d'après ses réglages, même quand ce n'est pas l'entreprise ouverte.
const fonctionnementDe = (entite) => completerReglages((etat.brut.reglages || {})[entite.id]).fonctionnement;

// La description du rôle « Éditeur » créé avec l'entreprise parle de devis : chaque entreprise lit la sienne.
const DESCRIPTION_EDITEUR = {
  excursions: N_("Clients, dossiers, factures, vouchers et paiements. Ni réglages ni suppression."),
  taxi: N_("Clients, dossiers et vouchers. Ni réglages ni suppression."),
};
const descriptionAffichee = (entite, r) => (r.systeme && r.nom === "Éditeur" && DESCRIPTION_EDITEUR[fonctionnementDe(entite)] ? tr(DESCRIPTION_EDITEUR[fonctionnementDe(entite)]) : descriptionRole(r));

// Éditeur d'un rôle : nom, portée et une case à cocher par droit, avec leurs dépendances.
// Seuls les droits qui servent dans l'entreprise du rôle sont proposés ; un droit déjà posé et masqué reste dans « choisis » et s'enregistre tel quel.
function roleModal(entite, role, apres) {
  const proposes = droitsProposes(fonctionnementDe(entite));
  const nouveau = !role.id;
  // L'Administrateur a tous les droits, calculés (migration 38) : ses cases sont toutes cochées et ne se décochent pas.
  const verrou = !!role.tous_droits || (role.systeme && role.nom === "Administrateur");
  const nom = h("input", { id: "rl-nom", value: role.nom || "", required: true, disabled: role.systeme });
  const description = h("input", { id: "rl-desc", value: role.description || "" });
  const portee = h("select", { id: "rl-portee", disabled: verrou }, PORTEES.map(([v, l]) => h("option", { value: v }, tr(l))));
  portee.value = role.portee || "toute";
  const choisis = new Set(verrou ? droitsDuRole({ ...role, tous_droits: true }) : role.permissions || []);
  const cases = new Map();
  const majCases = () => cases.forEach((c, code) => (c.checked = choisis.has(code)));
  // Décocher un droit retire aussi ceux qui en dépendent : on le dit tout de suite (audit n° 40, « vouchers.seul » partait en silence).
  const aussiRetires = h("p", { class: "bandeau-info", role: "status", hidden: true });
  const libelleDroit = (code) => tr((PERMISSIONS.find((p) => p.code === code) || { libelle: code }).libelle);
  const basculer = (code, coche) => {
    if (coche) {
      choisis.add(code);
      (DEPENDANCES[code] || []).forEach((d) => choisis.add(d));
      aussiRetires.hidden = true;
    } else {
      choisis.delete(code);
      const partis = [];
      for (const [autre, requis] of Object.entries(DEPENDANCES)) if (requis.includes(code) && choisis.has(autre)) (choisis.delete(autre), partis.push(autre));
      aussiRetires.textContent = partis.length ? tr("Retiré aussi, car il en dépend : {liste}.", { liste: partis.map(libelleDroit).join(", ") }) : "";
      aussiRetires.hidden = !partis.length;
    }
    majCases();
  };
  const groupes = [...new Set(proposes.map((p) => p.groupe))];
  const blocs = groupes.map((g) =>
    h(
      "fieldset",
      null,
      h("legend", null, tr(g)),
      proposes.filter((p) => p.groupe === g).map((p) => {
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
          // Un rôle déjà donné qui perd des droits : la confirmation les nomme, l'écran simple en premier (audit n° 40).
          const retires = nouveau ? [] : droitsRetires(role.permissions, valeurs.permissions);
          if (retires.length) {
            const n = etat.brut.membres.filter((m) => m.role_id === role.id).length;
            const ecranSimple = retires.some((p) => p.code === "vouchers.seul");
            const texte = [
              tr("Le rôle « {nom} » perd : {liste}.", { nom: nomRole(role), liste: retires.map((p) => tr(p.libelle)).join(" ; ") }),
              ecranSimple ? tr("Sans l'écran simple, la personne passe à l'outil complet, en français ou en anglais : elle n'a plus son écran en thaï.") : "",
              n ? pluriel(n, N_("Cela s'applique tout de suite à la personne qui a ce rôle."), N_("Cela s'applique tout de suite aux {n} personnes qui ont ce rôle.")) : "",
            ].filter(Boolean).join(" ");
            if (!(await confirmer(texte, tr("Retirer ces droits"), true))) return;
          }
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
      verrou ? h("p", { class: "aide" }, tr("Tous les droits, calculés : un droit ajouté plus tard à l'outil arrive seul dans ce rôle, sans rien régler.")) : h("p", { class: "aide" }, tr("Chaque case ajoute un droit. Un droit en suppose d'autres : « modifier » coche automatiquement « voir ».")),
      aussiRetires,
      ...blocs,
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), verrou ? null : h("button", { type: "submit", class: "principal" }, tr("Enregistrer le rôle")))
    ),
    { large: true }
  );
}

// Fuseaux proposés pour l'organisation : celui du navigateur en tête, puis la liste du navigateur (ou une liste courte s'il ne la donne pas).
const FUSEAUX_COURTS = ["Asia/Bangkok", "Europe/Zurich", "Europe/Paris", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Singapore", "Asia/Bali", "Australia/Sydney"];
const fuseaux = () => {
  const liste = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : FUSEAUX_COURTS;
  return [...new Set(liste.concat(FUSEAUX_COURTS))].sort();
};

// Organisation (migration 42) : le client du logiciel. Son administrateur règle le nom, le fuseau des rappels et la langue de départ des comptes.
function blocOrganisation(rafraichir) {
  const o = organisation();
  if (!o) return null;
  const nom = h("input", { id: "org-nom", value: o.nom || "", required: true });
  const fuseau = h("select", { id: "org-fuseau" }, ...fuseaux().map((z) => h("option", { value: z }, z)));
  fuseau.value = o.fuseau || "Asia/Bangkok";
  const langue = h("select", { id: "org-langue" }, ...LANGUES.map((l) => h("option", { value: l.code }, l.nom)));
  langue.value = o.langue || "en";
  return h(
    "section",
    null,
    h("h2", null, tr("Organisation")),
    h("p", { class: "aide" }, tr("L'organisation regroupe vos entreprises et votre équipe. Personne en dehors d'elle ne voit vos données.")),
    h(
      "form",
      {
        class: "formulaire",
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await modifierOrganisation({ nom: nom.value.trim(), fuseau: fuseau.value, langue: langue.value });
            toast(tr("Organisation enregistrée."));
            rafraichir();
          } catch (err) {
            toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
          }
        },
      },
      champ(tr("Nom de l'organisation"), nom),
      champ(tr("Fuseau horaire"), fuseau, tr("Les rappels partent à l'heure de ce fuseau, changements d'heure compris.")),
      champ(tr("Langue de départ"), langue, tr("Langue de l'interface pour les nouveaux comptes. Chacun peut ensuite choisir la sienne.")),
      h("div", { class: "actions" }, h("button", { type: "submit", class: "principal" }, tr("Enregistrer")))
    )
  );
}

export function nouvelleEntiteModal(apres) {
  const nom = h("input", { id: "ne-nom", required: true });
  const code = h("input", { id: "ne-slug", required: true, pattern: "[a-z0-9-]+" });
  let manuel = false;
  code.addEventListener("input", () => (manuel = true));
  nom.addEventListener("input", () => !manuel && (code.value = slug(nom.value)));
  // Modèle métier (étape 3 du SaaS) : la façon de travailler et des textes de départ neutres, en anglais. « Réglages vides » : comme avant.
  const choixModele = h("select", { id: "ne-modele" }, ...MODELES.map((m) => h("option", { value: m.id }, tr(m.nom))), h("option", { value: "" }, tr("Réglages vides")));
  // Une organisation en français (Zwald) garde par défaut l'ancien comportement : réglages vides, en français. Les autres partent du modèle.
  choixModele.value = (organisation() || {}).langue === "fr" ? "" : MODELE_DEFAUT;
  const aideModele = h("p", { class: "aide" });
  const decrire = () => (aideModele.textContent = choixModele.value ? tr(MODELES.find((m) => m.id === choixModele.value).description) : tr("Elle démarre sans client ni catalogue, avec des réglages vides à compléter dans l'écran Réglages de cette entreprise."));
  choixModele.addEventListener("change", decrire);
  decrire();
  const devise = h("select", { id: "ne-devise" }, h("option", { value: "" }, tr("Plus tard")), ...DEVISES_PROPOSEES.map((d) => h("option", { value: d }, d)));
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
            await creerEntite(nom.value.trim(), code.value.trim(), { modele: choixModele.value || null, devise: devise.value });
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
      champ(tr("Type d'activité"), choixModele),
      aideModele,
      champ(tr("Devise des documents"), devise),
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

// Un lien d'invitation ou de mot de passe à envoyer soi-même : copier, WhatsApp (la personne choisit le contact) ou e-mail.
// Nouveau client (éditeur du logiciel, pendant l'appel de mise en route) : le compte du futur administrateur et son organisation.
// Le lien rendu s'envoie au client ; il choisit son mot de passe, puis crée sa première entreprise depuis un modèle métier.
export function nouveauClientModal() {
  const organisationNom = h("input", { id: "nc-organisation", required: true, maxlength: 120 });
  const nom = h("input", { id: "nc-nom", maxlength: 120 });
  const email = h("input", { id: "nc-email", type: "email", required: true });
  const fuseau = h("select", { id: "nc-fuseau" }, ...fuseaux().map((z) => h("option", { value: z }, z)));
  try {
    fuseau.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Bangkok";
  } catch {
    fuseau.value = "Asia/Bangkok";
  }
  const langue = h("select", { id: "nc-langue" }, ...LANGUES.map((l) => h("option", { value: l.code }, l.nom)));
  langue.value = "en";
  const erreur = h("p", { class: "erreur", role: "alert" });
  const fermer = modal(
    tr("Nouveau client"),
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (e) => {
          e.preventDefault();
          erreur.textContent = "";
          const r = await invitation({ action: "creer_client", organisation: organisationNom.value.trim(), nom: nom.value.trim(), email: email.value.trim(), fuseau: fuseau.value, langue: langue.value });
          if (r.erreur) return void (erreur.textContent = tr(messageInvitation(r.erreur)));
          fermer();
          lienModal({ titre: tr("Client créé"), intro: tr("Envoyez ce message à {nom}. En ouvrant le lien, la personne choisit son mot de passe, puis crée sa première entreprise.", { nom: nom.value.trim() || email.value.trim() }), lien: r.lien, email: email.value.trim(), nom: nom.value.trim(), langue: langue.value, type: "invite" });
        },
      },
      champ(tr("Nom de l'organisation"), organisationNom),
      champ(tr("Nom de l'administrateur"), nom),
      champ(tr("E-mail de l'administrateur"), email),
      champ(tr("Fuseau horaire"), fuseau),
      champ(tr("Langue de départ"), langue),
      erreur,
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), h("button", { type: "submit", class: "principal" }, tr("Créer le client")))
    )
  );
}

function lienModal({ titre, intro, lien, email, nom, langue, type, erreur }) {
  const message = messageLien({ lien, langue, type, nom });
  const zone = h("textarea", { id: "lien-texte", rows: 7, readonly: true });
  zone.value = message;
  const objet = langue === "en" ? (type === "invite" ? "Your access to Gestion" : "Your Gestion password") : type === "invite" ? "Votre accès à Gestion" : "Votre mot de passe Gestion";
  let fermer;
  fermer = modal(
    titre,
    h(
      "div",
      { class: "modal-corps" },
      erreur ? h("p", { class: "bandeau-info", role: "alert" }, erreur) : null,
      h("p", null, intro),
      champ(tr("Message à envoyer, lien compris"), zone),
      h("p", { class: "aide" }, tr("Le lien ne sert qu'une fois et expire vite (une heure si rien n'a été réglé dans Supabase) : envoyez-le tout de suite. Expiré ? « Gérer l'accès », puis « Lien pour choisir un mot de passe ».")),
      h(
        "div",
        { class: "actions" },
        h("a", { class: "bouton secondaire", href: `mailto:${encodeURIComponent(email || "")}?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(message)}` }, tr("Par e-mail")),
        h("a", { class: "bouton secondaire", href: `https://wa.me/?text=${encodeURIComponent(message)}`, target: "_blank", rel: "noopener" }, icone("whatsapp"), tr("Par WhatsApp")),
        h("button", { class: "principal", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(message); toast(tr("Message copié.")); } catch { zone.select(); toast(tr("Copie impossible dans ce navigateur : sélectionnez le texte à la main."), true); } } }, icone("copier"), tr("Copier")),
        h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Fermer"))
      )
    )
  );
}

// Choix de la langue de l'outil d'une personne : français, anglais, ou celle de son navigateur (vide).
const selectLangue = (id, valeur) => {
  const sel = h("select", { id }, h("option", { value: "" }, tr("Celle de son navigateur")), LANGUES.map((l) => h("option", { value: l.code }, l.nom)));
  sel.value = valeur || "";
  return sel;
};
// Un sélecteur de rôle par entreprise (« Aucun accès » par défaut).
const selectsAcces = (prefixe, profil) =>
  etat.brut.entites.map((e) => {
    const m = profil && etat.brut.membres.find((x) => x.user_id === profil.user_id && x.entite_id === e.id);
    const sel = h("select", { id: `${prefixe}-${e.id}` }, h("option", { value: "" }, tr("Aucun accès")), etat.brut.roles.filter((r) => r.entite_id === e.id).map((r) => h("option", { value: r.id }, nomRole(r))));
    sel.value = m ? m.role_id : "";
    return [e, sel];
  });

// Inviter une personne (audit n° 1) : le compte, son nom, sa langue et ses accès d'un coup, puis un lien à lui envoyer.
function inviterModal(apres) {
  const email = saisie(h("input", { id: "inv-email", type: "email", required: true, autocomplete: "off" }), "email");
  const nom = h("input", { id: "inv-nom", autocomplete: "off" });
  const langue = selectLangue("inv-langue", "");
  const selects = selectsAcces("inv", null);
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const bouton = h("button", { class: "principal", type: "submit" }, tr("Créer le compte et le lien"));
  let fermer;
  fermer = modal(
    tr("Inviter une personne"),
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (e) => {
          e.preventDefault();
          erreur.textContent = "";
          const acces = accesChoisis(selects.map(([en, sel]) => ({ entite_id: en.id, role_id: sel.value })));
          if (!acces.length && !(await confirmer(tr("Aucune entreprise n'est cochée : la personne pourra se connecter mais ne verra rien. Créer le compte quand même ?"), tr("Créer sans accès")))) return;
          bouton.disabled = true;
          try {
            const r = await invitation({ action: "inviter", email: email.value.trim(), nom: nom.value.trim(), langue: langue.value || null, acces });
            if (r.erreur && !r.lien) return void (erreur.textContent = tr(messageInvitation(r.erreur)));
            fermer();
            apres();
            lienModal({ titre: tr("Compte créé"), intro: tr("Envoyez ce message à {nom}. En ouvrant le lien, la personne choisit son mot de passe et arrive dans l'outil.", { nom: nom.value.trim() || email.value.trim() }), lien: r.lien, email: email.value.trim(), nom: nom.value.trim(), langue: langue.value, type: "invite", erreur: r.erreur ? tr(messageInvitation(r.erreur)) : null });
          } finally {
            bouton.disabled = false;
          }
        },
      },
      champ(tr("Adresse e-mail"), email, tr("Elle sert d'identifiant pour se connecter.")),
      champ(tr("Nom affiché"), nom),
      champ(tr("Langue de l'outil"), langue, tr("Français ou anglais. L'écran simple de l'assistante reste en thaï.")),
      h("fieldset", null, h("legend", null, tr("Accès par entreprise")), h("div", { class: "acces-grille" }, selects.map(([e, sel]) => champ(e.actif ? e.nom : tr("{nom} (désactivée)", { nom: e.nom }), sel)))),
      h("p", { class: "aide" }, tr("Rien n'est envoyé par l'outil : il vous donne un lien à transmettre vous-même, par WhatsApp ou par e-mail.")),
      erreur,
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Annuler")), bouton)
    ),
    { large: true }
  );
}

function accesModal(profil, apres) {
  const moi = profil.user_id === etat.session.id;
  const nom = h("input", { id: "ua-nom", value: profil.nom || "" });
  // Langue de l'outil de cette personne (audit n° 87) : l'administratrice la règle, la personne peut encore la changer dans « Mon compte ».
  const langue = selectLangue("ua-langue", profil.langue);
  const actif = h("input", { id: "ua-actif", type: "checkbox", checked: profil.actif, disabled: moi });
  const superAdmin = h("input", { id: "ua-super", type: "checkbox", checked: profil.super_admin, disabled: moi });
  const selects = selectsAcces("ua", profil);
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
            await modifierProfil(profil.user_id, { nom: nom.value.trim() || null, actif: moi ? true : actif.checked, super_admin: moi ? true : superAdmin.checked, ...((langue.value || null) !== (profil.langue || null) ? { langue: langue.value || null } : {}) });
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
      champ(tr("Langue de l'outil"), langue, tr("Français ou anglais. La personne peut la changer ensuite dans « Mon compte ».")),
      h("label", { class: "case", for: "ua-actif" }, actif, tr("Compte actif (décochez pour couper tout accès sans supprimer le compte)")),
      h("label", { class: "case", for: "ua-super" }, superAdmin, tr("{role} : voit toutes les entreprises et gère les accès", { role: tr(libelleAdmin(organisation())) })),
      moi ? h("p", { class: "aide" }, tr("Vous ne pouvez pas modifier votre propre statut.")) : null,
      grille,
      // Mot de passe oublié, invitation expirée : un lien à envoyer soi-même. Supprimer : seulement un autre compte que le sien.
      h(
        "div",
        { class: "actions gauche" },
        h("button", { type: "button", class: "secondaire petit", onclick: async () => {
          const r = await invitation({ action: "lien_mot_de_passe", user_id: profil.user_id });
          if (r.erreur) return toast(tr(messageInvitation(r.erreur)), true);
          lienModal({ titre: tr("Lien pour choisir un mot de passe"), intro: tr("Envoyez ce message à {nom}. Le lien ouvre l'outil et demande un nouveau mot de passe.", { nom: profil.nom || profil.email }), lien: r.lien, email: profil.email, nom: profil.nom || "", langue: profil.langue, type: "recovery" });
        } }, tr("Lien pour choisir un mot de passe")),
        moi ? null : h("button", { type: "button", class: "lien danger-texte", onclick: async () => {
          const dossiers = etat.brut.dossiers.filter((d) => d.responsable_id === profil.user_id).length;
          const texte = tr("Supprimer définitivement le compte de {nom} ? La personne ne pourra plus se connecter et perd tous ses accès. Ses dossiers, factures et paiements restent.", { nom: profil.nom || profil.email }) + (dossiers ? ` ${pluriel(dossiers, N_("Un dossier n'aura plus de responsable."), N_("{n} dossiers n'auront plus de responsable."))}` : "") + ` ${tr("Pour une simple pause, décochez plutôt « Compte actif ».")}`;
          if (!(await confirmer(texte, tr("Supprimer le compte"), true))) return;
          const r = await invitation({ action: "supprimer", user_id: profil.user_id });
          if (r.erreur) return toast(tr(messageInvitation(r.erreur)), true);
          fermer();
          toast(tr("Compte supprimé."));
          apres();
        } }, tr("Supprimer le compte"))
      ),
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
    blocOrganisation(rafraichir),
    h(
      "section",
      null,
      h("div", { class: "entete petit-entete" }, h("h2", null, tr("Entreprises")), h("div", { class: "entete-actions" }, etat.moi && etat.moi.plateforme ? h("button", { class: "secondaire", type: "button", onclick: () => nouveauClientModal() }, tr("Nouveau client")) : null, h("button", { class: "secondaire", type: "button", onclick: () => nouvelleEntiteModal(rafraichir) }, tr("Nouvelle entreprise")))),
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
        const proposes = droitsProposes(fonctionnementDe(e));
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
                  h("td", { "data-label": tr("Rôle") }, h("strong", null, nomRole(r)), r.description ? h("span", { class: "sous-ligne" }, descriptionAffichee(e, r)) : null),
                  h("td", { "data-label": tr("Dossiers visibles") }, r.portee === "toute" ? tr("Tous") : tr("Ses dossiers")),
                  h("td", { "data-label": tr("Droits") }, r.tous_droits ? tr("Tous (calculés)") : tr("{n} sur {n2}", { n: r.permissions.filter((c) => proposes.some((p) => p.code === c)).length, n2: proposes.length })),
                  h("td", { "data-label": tr("Personnes") }, usage(r)),
                  h(
                    "td",
                    { class: "action-cellule" },
                    h("button", { class: "secondaire petit", type: "button", onclick: () => roleModal(e, r, rafraichir) }, tr("Modifier")),
                    h("button", { class: "secondaire petit", type: "button", onclick: () => roleModal(e, { nom: tr("{nom} (copie)", { nom: nomRole(r) }), description: descriptionAffichee(e, r), portee: r.portee, permissions: droitsDuRole(r) }, rafraichir) }, tr("Dupliquer")),
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
      h("div", { class: "entete petit-entete" }, h("h2", null, tr("Utilisateurs")), h("div", { class: "entete-actions" }, h("button", { class: "secondaire", type: "button", onclick: () => inviterModal(rafraichir) }, tr("Inviter une personne")))),
      h("p", { class: "aide" }, tr("« Inviter une personne » crée son compte avec ses accès et vous donne un lien à lui envoyer : elle y choisit son mot de passe. « Gérer l'accès » change ses rôles et sa langue, crée un lien pour un mot de passe oublié, coupe ou supprime le compte.")),
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
