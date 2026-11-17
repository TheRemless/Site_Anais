// Compte de la personne connectée (lot D, 17.11.2026, audit n° 2 et 3) : ouvert à tous, quel que soit le rôle (avant, il était dans Réglages,
// réservé à qui modifie les réglages). Langue, mot de passe, déconnexion de tous les appareils. Et les deux écrans sans menu : choisir son mot de
// passe après un lien d'invitation ou de mot de passe oublié, et « Mot de passe oublié » depuis la connexion.
import { etat, choisirLangue, roleActif } from "../etat.mjs";
import { h, champ, modal, toast, confirmer, saisie } from "../ui.mjs";
import { erreurMotDePasse } from "../compte-calc.mjs";
import { tr, LANGUES, langueActive } from "../i18n.mjs";

const reel = () => etat.store.mode === "supabase";

// Deux champs (nouveau et confirmation), plus l'actuel quand on le change depuis le menu. `apres` reçoit le nouveau mot de passe enregistré.
function formulaireMotDePasse({ demanderActuel, libelle, apres }) {
  const actuel = demanderActuel ? h("input", { id: "mdp-actuel", type: "password", required: true, autocomplete: "current-password" }) : null;
  const nouveau = h("input", { id: "mdp-nouveau", type: "password", required: true, autocomplete: "new-password", minlength: 8 });
  const confirmation = h("input", { id: "mdp-confirmation", type: "password", required: true, autocomplete: "new-password" });
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const bouton = h("button", { class: "principal", type: "submit" }, libelle);
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        const probleme = erreurMotDePasse(nouveau.value, confirmation.value);
        erreur.textContent = probleme ? tr(probleme) : "";
        if (probleme) return;
        bouton.disabled = true;
        try {
          await etat.store.changerMotDePasse(nouveau.value, actuel ? actuel.value : null);
          apres();
        } catch (err) {
          erreur.textContent = err.message;
        } finally {
          bouton.disabled = false;
        }
      },
    },
    actuel ? champ(tr("Mot de passe actuel"), actuel) : null,
    champ(tr("Nouveau mot de passe"), nouveau, tr("Au moins 8 caractères.")),
    champ(tr("Le même, une seconde fois"), confirmation),
    erreur,
    h("div", { class: "actions" }, bouton)
  );
}

export function ouvrirChangerMotDePasse() {
  let fermer;
  fermer = modal(tr("Changer mon mot de passe"), formulaireMotDePasse({ demanderActuel: true, libelle: tr("Enregistrer le mot de passe"), apres: () => (fermer(), toast(tr("Mot de passe changé. Vos autres appareils restent connectés : « Déconnecter tous mes appareils » les ferme."))) }));
}

async function deconnecterPartout() {
  if (!(await confirmer(tr("Tous vos appareils seront déconnectés, celui-ci compris. Il faudra se reconnecter avec l'e-mail et le mot de passe."), tr("Déconnecter partout"), true))) return;
  try {
    await etat.store.deconnecterPartout();
    location.reload();
  } catch (err) {
    toast(tr("Déconnexion impossible : {message}", { message: err.message }), true);
  }
}

// Menu du compte : le même pour Anaïs, Mook et toute l'équipe. `deconnecter` : la déconnexion de cet appareil (app.mjs).
export function ouvrirCompte({ deconnecter, apresLangue } = {}) {
  let fermer;
  const nom = etat.moi.nom || etat.session.email;
  const langues = h(
    "div",
    { class: "langues", role: "group", "aria-label": tr("Langue de l'outil") },
    LANGUES.map((l) =>
      h("button", { type: "button", lang: l.code, class: "langue", "aria-pressed": l.code === langueActive() ? "true" : "false", onclick: async () => { if (l.code === langueActive()) return; fermer(); await choisirLangue(l.code); if (apresLangue) apresLangue(); } }, l.nom)
    )
  );
  fermer = modal(
    tr("Mon compte"),
    h(
      "div",
      { class: "modal-corps compte-menu" },
      h("p", null, h("strong", null, nom), h("br"), h("span", { class: "aide" }, [etat.session.email !== nom ? etat.session.email : "", roleActif()].filter(Boolean).join(" · "))),
      h("h3", null, tr("Langue de l'outil")),
      langues,
      h("p", { class: "aide" }, tr("Elle suit votre compte sur tous vos appareils. Les documents et les messages aux clients gardent leur propre langue.")),
      reel() ? h("h3", null, tr("Mot de passe")) : null,
      reel() ? h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: () => (fermer(), ouvrirChangerMotDePasse()) }, tr("Changer mon mot de passe"))) : null,
      reel() ? h("h3", null, tr("Appareils")) : null,
      reel() ? h("p", { class: "aide" }, tr("« Se déconnecter » ne ferme que l'appareil que vous utilisez : l'iPhone reste connecté quand vous quittez l'ordinateur. Pour fermer vos sessions partout, utilisez le bouton ci-dessous.")) : null,
      reel()
        ? h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: () => (fermer(), deconnecterPartout()) }, tr("Déconnecter tous mes appareils")), deconnecter ? h("button", { class: "secondaire", type: "button", onclick: () => (fermer(), deconnecter()) }, tr("Se déconnecter")) : null)
        : h("p", { class: "aide" }, tr("En démonstration, le mot de passe et les appareils ne se gèrent pas.")),
      h("h3", null, tr("Téléphone perdu ou volé")),
      h(
        "ol",
        { class: "aide" },
        h("li", null, tr("Sur un autre appareil, ouvrez « Mon compte » (votre nom, en bas du menu), puis « Déconnecter tous mes appareils ». Un appareil déjà ouvert peut encore servir jusqu'à une heure.")),
        h("li", null, tr("Pour couper l'accès tout de suite, l'administratrice générale décoche « Compte actif » pour cette personne dans Administration.")),
        h("li", null, tr("Changez ensuite le mot de passe (« Changer mon mot de passe », ou un lien envoyé par l'administratrice), puis faites réactiver le compte."))
      )
    )
  );
}

// Après un lien d'invitation ou de mot de passe oublié : la session est ouverte, il reste à choisir le mot de passe. Écran sans menu.
export function vueNouveauMotDePasse(type, apres) {
  const titre = type === "invite" ? tr("Bienvenue : choisissez votre mot de passe") : tr("Choisissez un nouveau mot de passe");
  return h(
    "div",
    { class: "connexion" },
    h("h1", null, titre),
    h("p", { class: "sous" }, etat.session.email),
    formulaireMotDePasse({ demanderActuel: false, libelle: tr("Enregistrer et ouvrir l'outil"), apres: () => (toast(tr("Mot de passe enregistré.")), apres()) })
  );
}

// « Mot de passe oublié » depuis l'écran de connexion. Supabase envoie l'e-mail ; sans réponse, l'administratrice peut créer un lien.
export function ouvrirMotDePasseOublie(emailSaisi) {
  let fermer;
  const email = saisie(h("input", { id: "oubli-email", type: "email", required: true, autocomplete: "username", value: emailSaisi || "" }), "email");
  const info = h("p", { class: "aide", role: "status" });
  const bouton = h("button", { class: "principal", type: "submit" }, tr("Recevoir le lien"));
  fermer = modal(
    tr("Mot de passe oublié"),
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (e) => {
          e.preventDefault();
          bouton.disabled = true;
          try {
            await etat.store.motDePasseOublie(email.value.trim());
            info.textContent = tr("Si un compte existe pour cette adresse, un e-mail vient de partir avec un lien pour choisir un nouveau mot de passe. Regardez aussi dans les indésirables.");
          } catch (err) {
            info.textContent = tr("L'e-mail n'a pas pu partir : {message}", { message: err.message });
          } finally {
            bouton.disabled = false;
          }
        },
      },
      champ(tr("Adresse e-mail"), email),
      info,
      h("p", { class: "aide" }, tr("Rien reçu ? Demandez à l'administratrice un lien : Administration, « Gérer l'accès », « Lien pour choisir un mot de passe ». Elle vous l'envoie par WhatsApp.")),
      h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, tr("Fermer")), bouton)
    )
  );
}
