import { init, etat, recharger, entitesAccessibles, entiteActive, changerEntite, estAdmin, estSuperAdmin, roleActif } from "./etat.mjs";
import { h, vider, toast, modal } from "./ui.mjs";
import { tableauDeBord } from "./views/dashboard.mjs";
import { listeDossiers, nouveauDossier } from "./views/dossiers.mjs";
import { ficheDossier } from "./views/dossier.mjs";
import { editeur } from "./views/editeur.mjs";
import { listeClients, ficheClient } from "./views/clients.mjs";
import { catalogue } from "./views/catalogue.mjs";
import { vueReglages } from "./views/reglages.mjs";
import { vueAdmin } from "./views/admin.mjs";

const ROUTES = [
  [/^#?\/?$/, "tableau", tableauDeBord],
  [/^#\/dossiers$/, "dossiers", listeDossiers],
  [/^#\/dossiers\/nouveau(?:\?.*)?$/, "dossiers", nouveauDossier],
  [/^#\/dossier\/([\w-]+)$/, "dossiers", ficheDossier],
  [/^#\/doc\/([\w-]+)$/, "dossiers", editeur],
  [/^#\/clients$/, "clients", listeClients],
  [/^#\/client\/([\w-]+)$/, "clients", ficheClient],
  [/^#\/catalogue$/, "catalogue", catalogue],
  [/^#\/reglages$/, "reglages", vueReglages],
  [/^#\/admin$/, "admin", vueAdmin],
];

const racine = document.getElementById("app");
let derniereVue = null;

function vueConnexion() {
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const bouton = h("button", { class: "principal", type: "submit" }, "Se connecter");
  const email = h("input", { id: "email", type: "email", required: true, autocomplete: "username" });
  const mdp = h("input", { id: "mdp", type: "password", required: true, autocomplete: "current-password" });
  const form = h(
    "form",
    {
      class: "connexion-form",
      onsubmit: async (e) => {
        e.preventDefault();
        erreur.textContent = "";
        bouton.disabled = true;
        bouton.textContent = "Connexion…";
        try {
          await etat.store.connecter(email.value.trim(), mdp.value);
          etat.session = await etat.store.session();
          await recharger();
          afficher();
        } catch (err) {
          erreur.textContent = err.message;
          bouton.disabled = false;
          bouton.textContent = "Se connecter";
        }
      },
    },
    h("div", { class: "champ" }, h("label", { for: "email" }, "Adresse e-mail"), email),
    h("div", { class: "champ" }, h("label", { for: "mdp" }, "Mot de passe"), mdp),
    erreur,
    bouton
  );
  return h("div", { class: "connexion" }, h("h1", null, "Gestion"), h("p", { class: "sous" }, "Devis, factures et suivi des paiements."), form);
}

function selecteurEntite() {
  const liste = entitesAccessibles();
  if (liste.length < 2) return liste.length ? h("p", { class: "entite-nom" }, liste[0].nom) : null;
  const sel = h("select", { id: "entite", "aria-label": "Entreprise", onchange: (e) => changerEntite(e.target.value) }, liste.map((e) => h("option", { value: e.id }, e.nom)));
  sel.value = etat.entiteId;
  return h("div", { class: "entite-choix" }, sel);
}

function bandeauDemo() {
  const s = etat.store;
  const sel = h(
    "select",
    {
      id: "demo-utilisateur",
      "aria-label": "Se connecter en tant que",
      onchange: async (e) => {
        s.changerUtilisateurDemo(e.target.value);
        etat.session = await s.session();
        await recharger();
        location.hash = "#/";
        afficher();
      },
    },
    s.utilisateursDemo().map((u) => h("option", { value: u.id }, `${u.nom}${u.super_admin ? " (voit tout)" : ""}`))
  );
  sel.value = s.utilisateurDemo();
  return h(
    "div",
    { class: "bandeau-demo" },
    h("span", null, "Mode démonstration : clients fictifs, données dans ce navigateur."),
    h("label", { class: "demo-choix" }, "Utilisateur : ", sel),
    h(
      "button",
      {
        class: "lien",
        type: "button",
        onclick: async () => {
          await s.reinitialiser();
          etat.session = await s.session();
          await recharger();
          location.hash = "#/";
          afficher();
          toast("Démo réinitialisée.");
        },
      },
      "Repartir de zéro"
    )
  );
}

function menu() {
  const elements = [
    ["#/", "Tableau de bord", "tableau"],
    ["#/dossiers", "Dossiers", "dossiers"],
    ["#/clients", "Clients", "clients"],
    ["#/catalogue", "Catalogue", "catalogue"],
    ...(estAdmin() ? [["#/reglages", "Réglages", "reglages"]] : []),
  ];
  const logo = etat.db.reglages.apparence.logo;
  return h(
    "nav",
    { class: "menu", "aria-label": "Navigation principale" },
    h("a", { class: "marque", href: "#/" }, logo ? h("img", { src: logo, alt: "" }) : null, h("span", null, "Gestion")),
    selecteurEntite(),
    h("ul", null, elements.map(([href, libelle, cle]) => h("li", null, h("a", { href, "data-cle": cle }, libelle)))),
    h(
      "div",
      { class: "menu-bas" },
      estSuperAdmin() ? h("a", { class: "lien-admin", href: "#/admin", "data-cle": "admin" }, "Administration") : null,
      h("button", { class: "lien", type: "button", onclick: ouvrirAide, title: "Raccourcis clavier (?)" }, "Raccourcis clavier"),
      h("span", { class: "compte" }, etat.moi.nom || etat.session.email, roleActif() ? ` · ${roleActif() === "admin" ? "administrateur" : "éditeur"}` : ""),
      etat.store.mode === "supabase"
        ? h(
            "button",
            {
              class: "lien",
              type: "button",
              onclick: async () => {
                await etat.store.deconnecter();
                etat.session = null;
                etat.brut = null;
                etat.db = null;
                afficher();
              },
            },
            "Se déconnecter"
          )
        : null
    )
  );
}

// Sur téléphone le menu est en bas de l'écran : le choix d'entreprise passe en haut de la page.
function barreMobile() {
  return h("div", { class: "entite-mobile" }, selecteurEntite(), estSuperAdmin() ? h("a", { href: "#/admin" }, "Administration") : null);
}

function coque() {
  return h("div", { class: "coque" }, menu(), h("div", { class: "contenu" }, etat.store.mode === "demo" ? bandeauDemo() : null, barreMobile(), h("main", { id: "principal", tabindex: "-1" })));
}

function afficher() {
  if (!etat.session) {
    vider(racine).append(vueConnexion());
    document.title = "Connexion - Gestion";
    return;
  }
  if (!entiteActive()) {
    vider(racine).append(
      h(
        "div",
        { class: "connexion" },
        h("h1", null, "Aucun accès pour l'instant"),
        h("p", { class: "sous" }, `Votre compte (${etat.session.email}) n'a pas encore accès à une entreprise. Demandez à l'administratrice de vous en donner un.`),
        etat.store.mode === "demo" ? bandeauDemo() : null,
        etat.store.mode === "supabase" ? h("button", { class: "secondaire", type: "button", onclick: async () => (await etat.store.deconnecter(), (etat.session = null), afficher()) }, "Se déconnecter") : null
      )
    );
    document.title = "Aucun accès - Gestion";
    return;
  }
  // Le menu dépend de l'entreprise active et des droits : on le refait quand l'un des deux change.
  const cle = `${etat.entiteId}|${roleActif()}|${etat.session.id}`;
  const existante = racine.querySelector(".coque");
  if (!existante || existante.dataset.cle !== cle) {
    vider(racine).append(coque());
    racine.querySelector(".coque").dataset.cle = cle;
  }
  const hash = location.hash || "#/";
  const trouvee = ROUTES.find(([re]) => re.test(hash));
  if (!trouvee) {
    location.replace("#/");
    return;
  }
  const [re, cleRoute, vue] = trouvee;
  const principal = document.getElementById("principal");
  let noeud;
  try {
    noeud = vue(...hash.match(re).slice(1));
  } catch (err) {
    console.error(err);
    noeud = h("div", { class: "vide" }, h("h1", null, "Cet écran n'a pas pu s'afficher"), h("p", null, err.message), h("a", { href: "#/" }, "Retour au tableau de bord"));
  }
  principal.replaceChildren(noeud);
  principal.className = [noeud.dataset && noeud.dataset.large ? "large" : "", noeud.dataset && noeud.dataset.plein ? "plein" : ""].filter(Boolean).join(" ");
  document.title = `${(noeud.dataset && noeud.dataset.titre) || "Gestion"} - ${entiteActive().nom}`;
  // Les pages à deux volets prennent exactement la hauteur restante de la fenêtre, bandeaux éventuels compris.
  document.documentElement.style.setProperty("--decalage", `${Math.round(principal.getBoundingClientRect().top + window.scrollY + 48)}px`);
  for (const a of document.querySelectorAll(".menu a[data-cle]")) a.toggleAttribute("aria-current", a.dataset.cle === cleRoute);
  if (hash !== derniereVue) window.scrollTo(0, 0);
  derniereVue = hash;
}

function ouvrirAide() {
  const ligne = (touches, texte) => h("tr", null, h("td", null, ...touches.flatMap((t, i) => (i ? [" puis ", h("kbd", null, t)] : [h("kbd", null, t)]))), h("td", null, texte));
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? "Cmd" : "Ctrl";
  const tableau = (lignes) => h("table", { class: "tableau simple raccourcis" }, h("tbody", null, lignes));
  modal(
    "Raccourcis clavier",
    h(
      "div",
      { class: "modal-corps" },
      h("h3", null, "Partout, hors d'un champ de saisie"),
      tableau([ligne(["?"], "Afficher cette aide"), ligne(["n"], "Nouveau dossier"), ligne(["/"], "Aller à la recherche"), ligne(["g", "t"], "Tableau de bord"), ligne(["g", "d"], "Dossiers"), ligne(["g", "c"], "Clients"), ligne(["g", "k"], "Catalogue"), ligne(["g", "r"], "Réglages (administrateurs)"), ligne(["Échap"], "Fermer une fenêtre")]),
      h("h3", null, "Dans un devis ou une facture"),
      tableau([ligne([`${mod}+Z`], "Annuler la dernière modification"), ligne([`${mod}+Maj+Z`, `${mac ? "" : "Ctrl+Y"}`].filter(Boolean).slice(0, 1), `Rétablir${mac ? "" : " (ou Ctrl+Y)"}`), ligne([`${mod}+S`], "Enregistrer tout de suite"), ligne([`${mod}+P`], "Télécharger le PDF")]),
      h("p", { class: "aide" }, "Les raccourcis propres au navigateur, comme Ctrl+T, Ctrl+W ou Ctrl+N, ne peuvent pas être pris en charge par un site. Les autres sont désactivés pendant la saisie dans un champ pour ne pas gêner l'écriture.")
    )
  );
}

// Raccourcis simples, actifs seulement quand on n'écrit pas dans un champ et qu'aucune fenêtre n'est ouverte.
let sequence = null;
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || !etat.session || !etat.db) return;
  if (e.target.matches("input, textarea, select, [contenteditable]") || document.querySelector(".modal-fond")) return;
  const k = e.key.toLowerCase();
  if (sequence === "g") {
    sequence = null;
    const cibles = { t: "#/", d: "#/dossiers", c: "#/clients", k: "#/catalogue", ...(estAdmin() ? { r: "#/reglages" } : {}), ...(estSuperAdmin() ? { a: "#/admin" } : {}) };
    if (cibles[k]) (e.preventDefault(), (location.hash = cibles[k]));
    return;
  }
  if (k === "g") {
    sequence = "g";
    setTimeout(() => (sequence = null), 1200);
  } else if (k === "n") (e.preventDefault(), (location.hash = "#/dossiers/nouveau"));
  else if (k === "?") (e.preventDefault(), ouvrirAide());
  else if (k === "/") {
    const champ = document.getElementById("recherche") || document.getElementById("rech-clients");
    if (champ) (e.preventDefault(), champ.focus());
  }
});

window.addEventListener("hashchange", afficher);

init()
  .then(afficher)
  .catch((err) => {
    console.error(err);
    vider(racine).append(h("div", { class: "vide" }, h("h1", null, "Connexion à la base impossible"), h("p", null, err.message), h("button", { class: "principal", onclick: () => location.reload() }, "Réessayer")));
  });
