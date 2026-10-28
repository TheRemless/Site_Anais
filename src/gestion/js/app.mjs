import { init, etat, recharger } from "./etat.mjs";
import { h, vider, toast } from "./ui.mjs";
import { tableauDeBord } from "./views/dashboard.mjs";
import { listeDossiers, nouveauDossier } from "./views/dossiers.mjs";
import { ficheDossier } from "./views/dossier.mjs";
import { editeur } from "./views/editeur.mjs";
import { listeClients, ficheClient } from "./views/clients.mjs";
import { catalogue } from "./views/catalogue.mjs";
import { vueReglages } from "./views/reglages.mjs";

const NAV = [
  ["#/", "Tableau de bord", "tableau"],
  ["#/dossiers", "Dossiers", "dossiers"],
  ["#/clients", "Clients", "clients"],
  ["#/catalogue", "Catalogue", "catalogue"],
  ["#/reglages", "Réglages", "reglages"],
];

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
          demarrer();
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
  return h("div", { class: "connexion" }, h("img", { src: "assets/logo.png", alt: "", class: "connexion-logo" }), h("h1", null, "Gestion Zwald"), h("p", { class: "sous" }, "Devis, factures et suivi des paiements."), form);
}

function coque() {
  const demo =
    etat.store.mode === "demo"
      ? h(
          "div",
          { class: "bandeau-demo" },
          "Mode démonstration : les clients sont fictifs et les données restent dans ce navigateur.",
          h(
            "button",
            {
              class: "lien",
              type: "button",
              onclick: async () => {
                await etat.store.reinitialiser();
                await recharger();
                window.dispatchEvent(new HashChangeEvent("hashchange"));
                toast("Démo réinitialisée.");
              },
            },
            "Repartir de zéro"
          )
        )
      : null;
  return h(
    "div",
    { class: "coque" },
    h(
      "nav",
      { class: "menu", "aria-label": "Navigation principale" },
      h("a", { class: "marque", href: "#/" }, h("img", { src: "assets/logo.png", alt: "" }), h("span", null, "Gestion Zwald")),
      h("ul", null, NAV.map(([href, libelle, cle]) => h("li", null, h("a", { href, "data-cle": cle }, libelle)))),
      h(
        "div",
        { class: "menu-bas" },
        etat.store.mode === "supabase"
          ? [
              h("span", { class: "compte" }, etat.session.email),
              h(
                "button",
                {
                  class: "lien",
                  type: "button",
                  onclick: async () => {
                    await etat.store.deconnecter();
                    etat.session = null;
                    etat.db = null;
                    demarrer();
                  },
                },
                "Se déconnecter"
              ),
            ]
          : null
      )
    ),
    h("div", { class: "contenu" }, demo, h("main", { id: "principal", tabindex: "-1" }))
  );
}

function afficher() {
  if (!etat.session) {
    vider(racine).append(vueConnexion());
    document.title = "Connexion - Gestion Zwald";
    return;
  }
  if (!racine.querySelector(".coque")) vider(racine).append(coque());
  const hash = location.hash || "#/";
  const trouvee = ROUTES.find(([re]) => re.test(hash));
  if (!trouvee) {
    location.replace("#/");
    return;
  }
  const [re, cle, vue] = trouvee;
  const principal = document.getElementById("principal");
  let noeud;
  try {
    noeud = vue(...hash.match(re).slice(1));
  } catch (err) {
    console.error(err);
    noeud = h("div", { class: "vide" }, h("h1", null, "Cet écran n'a pas pu s'afficher"), h("p", null, err.message), h("a", { href: "#/" }, "Retour au tableau de bord"));
  }
  principal.replaceChildren(noeud);
  principal.className = noeud.dataset && noeud.dataset.large ? "large" : "";
  document.title = `${(noeud.dataset && noeud.dataset.titre) || "Gestion"} - Gestion Zwald`;
  for (const a of document.querySelectorAll(".menu a[data-cle]")) a.toggleAttribute("aria-current", a.dataset.cle === cle);
  if (hash !== derniereVue) window.scrollTo(0, 0);
  derniereVue = hash;
}

function demarrer() {
  afficher();
}

window.addEventListener("hashchange", afficher);

init()
  .then(demarrer)
  .catch((err) => {
    console.error(err);
    vider(racine).append(h("div", { class: "vide" }, h("h1", null, "Connexion à la base impossible"), h("p", null, err.message), h("button", { class: "principal", onclick: () => location.reload() }, "Réessayer")));
  });
