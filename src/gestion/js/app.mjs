import { init, etat, recharger, entitesAccessibles, entiteActive, changerEntite, estAdmin, estSuperAdmin, roleActif, peut, resumes, nomClient, naviguer, nomPartenaire, entitesAnalysables, moduleActif } from "./etat.mjs";
import { h, vider, toast, modal, icone } from "./ui.mjs";
import { STATUTS, formatMontant } from "./calc.mjs";
import { sousTitreDossier } from "./views/commun.mjs";
import { tableauDeBord } from "./views/dashboard.mjs";
import { listeDossiers, nouveauDossier } from "./views/dossiers.mjs";
import { ficheDossier } from "./views/dossier.mjs";
import { editeur } from "./views/editeur.mjs";
import { listeClients, ficheClient } from "./views/clients.mjs";
import { catalogue } from "./views/catalogue.mjs";
import { vueReglages } from "./views/reglages.mjs";
import { vueAdmin } from "./views/admin.mjs";
import { vueJournal } from "./views/journal.mjs";
import { vueAnalyses } from "./views/analyses.mjs";
import { vueGroupe } from "./views/groupe.mjs";
import { vueTaches, mesTaches } from "./views/taches.mjs";
import { listePartenaires, fichePartenaire } from "./views/partenaires.mjs";
import { vueTarifs } from "./views/tarifs.mjs";
import { vueTrajets } from "./views/trajets.mjs";
import { vueRegles } from "./views/regles.mjs";
import { vueReservations } from "./views/reservations.mjs";
import { vueMessages } from "./views/messages.mjs";
import { vueDu } from "./views/du.mjs";
import { agenda } from "./operations-calc.mjs";

const ROUTES = [
  [/^#\/reservations(?:\?.*)?$/, "reservations", vueReservations],
  [/^#\/messages$/, "messages", vueMessages],
  [/^#\/du$/, "du", vueDu],
  [/^#\/partenaires$/, "partenaires", listePartenaires],
  [/^#\/partenaire\/([\w-]+)$/, "partenaires", fichePartenaire],
  [/^#\/tarifs(?:\?.*)?$/, "tarifs", vueTarifs],
  [/^#\/trajets(?:\?.*)?$/, "trajets", vueTrajets],
  [/^#\/regles$/, "regles", vueRegles],
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
  [/^#\/journal$/, "journal", vueJournal],
  [/^#\/analyses$/, "analyses", vueAnalyses],
  [/^#\/groupe$/, "groupe", vueGroupe],
  [/^#\/taches$/, "taches", vueTaches],
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

// Écrans ouverts à la personne connectée, groupés comme dans la barre latérale.
function ecrans() {
  const ajd = new Date().toISOString().slice(0, 10);
  const enRetard = mesTaches().filter((t) => t.echeance && t.echeance <= ajd).length;
  const si = (ok, item) => (ok ? [item] : []);
  const ag = agenda(etat.db.reservations, ajd);
  const aConfirmer = ag.enRetard.length + ag.aConfirmer.length;
  return [
    { titre: "Opérations", items: [{ href: "#/", libelle: "Aujourd'hui", cle: "tableau", icone: "soleil" }, ...si(moduleActif("reservations"), { href: "#/reservations", libelle: "Réservations", cle: "reservations", icone: "reservations", badge: aConfirmer }), { href: "#/taches", libelle: "Tâches", cle: "taches", icone: "taches", badge: enRetard }, ...si(moduleActif("messages"), { href: "#/messages", libelle: "Messages", cle: "messages", icone: "messages" })] },
    { titre: "Ventes", items: [{ href: "#/dossiers", libelle: "Dossiers", cle: "dossiers", icone: "dossiers" }, { href: "#/clients", libelle: "Clients", cle: "clients", icone: "clients" }, ...si(moduleActif("catalogue"), { href: "#/catalogue", libelle: "Catalogue", cle: "catalogue", icone: "catalogue" })] },
    {
      titre: "Partenaires",
      items: si(peut("partenaires.lire") && moduleActif("partenaires"), null).length
        ? [
            { href: "#/partenaires", libelle: "Partenaires", cle: "partenaires", icone: "partenaires" },
            { href: "#/tarifs", libelle: "Tarifs", cle: "tarifs", icone: "tarifs" },
            { href: "#/trajets", libelle: "Trajets", cle: "trajets", icone: "bateau" },
            { href: "#/regles", libelle: "Règles", cle: "regles", icone: "regles" },
            ...si(peut("partenaires.nets"), { href: "#/du", libelle: "Dû aux partenaires", cle: "du", icone: "du" }),
          ]
        : [],
    },
    {
      titre: "Administration",
      items: [
        ...si(peut("analytics.voir") && peut("finances.voir"), { href: "#/analyses", libelle: "Analyses", cle: "analyses", icone: "analyses" }),
        ...si(entitesAnalysables().length > 1, { href: "#/groupe", libelle: "Vue d'ensemble", cle: "groupe", icone: "groupe" }),
        ...si(peut("journal.voir"), { href: "#/journal", libelle: "Journal", cle: "journal", icone: "journal" }),
        ...si(estAdmin(), { href: "#/reglages", libelle: "Réglages", cle: "reglages", icone: "reglages" }),
        ...si(estSuperAdmin(), { href: "#/admin", libelle: "Administration", cle: "admin", icone: "admin" }),
      ],
    },
  ].filter((s) => s.items.length);
}
// Les trois écrans qui ont leur onglet sur téléphone, le reste passe par « Plus ». Partenaires prend la place de
// Clients dès que la personne a le droit de les voir.
const ongletsMobiles = () => ["tableau", "dossiers", peut("partenaires.lire") && moduleActif("partenaires") ? "partenaires" : "clients"];
const tousEcrans = () => ecrans().flatMap((s) => s.items);

const lienEcran = (e, apres) => h("a", { href: e.href, "data-cle": e.cle, class: "lien-ecran", onclick: apres }, icone(e.icone, 20), h("span", null, e.libelle), e.badge ? h("span", { class: "badge", "aria-label": `${e.badge} en retard` }, e.badge) : null);
const sections = (liste, apres) => liste.map((s) => h("div", { class: "menu-section" }, h("p", { class: "menu-section-titre" }, s.titre), h("ul", null, s.items.map((e) => h("li", null, lienEcran(e, apres))))));

async function deconnecter() {
  await etat.store.deconnecter();
  etat.session = null;
  etat.brut = null;
  etat.db = null;
  afficher();
}

function blocCompte() {
  const nom = etat.moi.nom || etat.session.email;
  const initiales = nom.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join("");
  return h("div", { class: "compte" }, h("span", { class: "avatar", "aria-hidden": "true" }, initiales), h("span", { class: "compte-texte" }, h("strong", null, nom), roleActif() ? h("span", null, roleActif()) : null));
}
const outilsCompte = (apres) => [
  h("button", { class: "bouton-icone secondaire", type: "button", onclick: () => (apres && apres(), ouvrirAide()), "aria-label": "Raccourcis clavier", title: "Raccourcis clavier (?)" }, icone("clavier")),
  etat.store.mode === "supabase" ? h("button", { class: "bouton-icone secondaire", type: "button", onclick: deconnecter, "aria-label": "Se déconnecter", title: "Se déconnecter" }, icone("deconnexion")) : null,
];

// Ordinateur : barre latérale avec les écrans par section, la recherche et le compte.
function menu() {
  const logo = etat.db.reglages.apparence.logo;
  return h(
    "nav",
    { class: "menu", "aria-label": "Navigation principale" },
    h("a", { class: "marque", href: "#/" }, logo ? h("img", { src: logo, alt: "" }) : null, h("span", null, "Gestion")),
    selecteurEntite(),
    h("button", { class: "recherche-bouton", type: "button", onclick: ouvrirRecherche }, icone("recherche", 18), h("span", null, "Rechercher"), h("kbd", null, "/")),
    sections(ecrans()),
    h("div", { class: "menu-bas" }, blocCompte(), h("div", { class: "menu-outils" }, outilsCompte()))
  );
}

// Téléphone : l'entreprise et la recherche en haut, quatre onglets en bas.
function barreHaut() {
  const logo = etat.db.reglages.apparence.logo;
  return h("header", { class: "barre-haut" }, logo ? h("img", { class: "barre-logo", src: logo, alt: "" }) : null, selecteurEntite(), h("button", { class: "bouton-icone lien", type: "button", onclick: ouvrirRecherche, "aria-label": "Rechercher" }, icone("recherche", 22)));
}

function barreOnglets() {
  const tous = tousEcrans();
  const onglet = (e, contenu) => h("span", { class: "onglet-icone" }, icone(e.icone, 22), contenu);
  const onglets = ongletsMobiles();
  const badgePlus = tous.filter((e) => !onglets.includes(e.cle)).reduce((n, e) => n + (e.badge || 0), 0);
  return h(
    "nav",
    { class: "barre-onglets", "aria-label": "Navigation principale" },
    h(
      "ul",
      null,
      onglets.map((cle) => tous.find((e) => e.cle === cle)).filter(Boolean).map((e) => h("li", null, h("a", { href: e.href, "data-cle": e.cle, class: "onglet" }, onglet(e, e.badge ? h("span", { class: "badge" }, e.badge) : null), h("span", null, e.libelle)))),
      h("li", null, h("button", { type: "button", class: "onglet", "data-cle": "plus", onclick: ouvrirPlus }, onglet({ icone: "plus" }, badgePlus ? h("span", { class: "badge" }, badgePlus) : null), h("span", null, "Plus")))
    )
  );
}

// Feuille « Plus » : les écrans sans onglet, le compte et la déconnexion.
function ouvrirPlus() {
  const onglets = ongletsMobiles();
  const restants = ecrans().map((s) => ({ ...s, items: s.items.filter((e) => !onglets.includes(e.cle)) })).filter((s) => s.items.length);
  let fermer;
  const apres = () => fermer();
  fermer = modal("Plus", h("div", { class: "feuille-menu" }, sections(restants, apres), h("div", { class: "feuille-pied" }, blocCompte(), h("div", { class: "menu-outils" }, outilsCompte(apres)))), { feuille: true });
}

function coque() {
  return h("div", { class: "coque" }, menu(), h("div", { class: "contenu-coque" }, barreHaut(), h("div", { class: "contenu" }, etat.store.mode === "demo" ? bandeauDemo() : null, h("main", { id: "principal", tabindex: "-1" }))), barreOnglets());
}

// ---- Recherche globale ----------------------------------------------------------------------------------------
const sansAccents = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const resultatDossier = (r) => ({ groupe: "Dossiers", icone: "dossiers", titre: nomClient(r.client), detail: sousTitreDossier(r.dossier), droite: STATUTS[r.statut], href: `#/dossier/${r.dossier.id}` });
const resultatEcran = (e) => ({ groupe: "Écrans", icone: e.icone, titre: e.libelle, href: e.href });

// Tous les mots saisis doivent apparaître. Sans saisie : les derniers dossiers et la liste des écrans.
function chercher(q) {
  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  const correspond = (texte) => mots.every((m) => texte.includes(m));
  if (!mots.length) return [...resumes().sort((a, b) => b.dossier.created_at.localeCompare(a.dossier.created_at)).slice(0, 5).map(resultatDossier), ...tousEcrans().map(resultatEcran)];
  const out = [];
  if (peut("dossiers.ecrire") && mots.every((m) => "nouveau dossier".includes(m))) out.push({ groupe: "Actions", icone: "ajouter", titre: "Nouveau dossier", href: "#/dossiers/nouveau" });
  resumes()
    .filter((r) => correspond(sansAccents(`${nomClient(r.client)} ${r.dossier.ref} ${r.dossier.pays} ${r.dossier.bandeau}`)))
    .sort((a, b) => b.dossier.created_at.localeCompare(a.dossier.created_at))
    .slice(0, 6)
    .forEach((r) => out.push(resultatDossier(r)));
  etat.db.clients
    .filter((c) => correspond(sansAccents(`${nomClient(c)} ${c.telephone} ${c.email} ${c.adresse}`)))
    .slice(0, 6)
    .forEach((c) => out.push({ groupe: "Clients", icone: "clients", titre: nomClient(c), detail: [c.telephone, (c.adresse || "").split("\n").filter(Boolean).pop()].filter(Boolean).join(" · "), href: `#/client/${c.id}` }));
  if (peut("partenaires.lire") && moduleActif("partenaires")) {
    etat.db.partenaires
      .filter((p) => p.actif !== false && correspond(sansAccents(`${p.nom} ${p.nom_thai} ${p.categorie} ${p.role}`)))
      .slice(0, 5)
      .forEach((p) => out.push({ groupe: "Partenaires", icone: "partenaires", titre: p.nom, detail: p.role || p.categorie, href: `#/partenaire/${p.id}` }));
    etat.db.prestations
      .filter((x) => x.actif !== false && correspond(sansAccents(`${x.libelle} ${x.groupe} ${nomPartenaire(x.partenaire_id)}`)))
      .slice(0, 6)
      .forEach((x) => out.push({ groupe: "Tarifs", icone: "tarifs", titre: x.libelle, detail: [nomPartenaire(x.partenaire_id), x.groupe].filter(Boolean).join(" · "), droite: x.prix_vente != null ? formatMontant(x.prix_vente) : "", href: `#/tarifs?famille=${x.famille}&q=${encodeURIComponent(x.libelle)}` }));
    const paires = new Map();
    for (const t of etat.db.trajets) if (correspond(sansAccents(`${t.de} ${t.vers} ${nomPartenaire(t.partenaire_id)}`))) paires.set(`${t.de}|${t.vers}`, (paires.get(`${t.de}|${t.vers}`) || 0) + 1);
    [...paires].slice(0, 5).forEach(([k, n]) => {
      const [de, vers] = k.split("|");
      out.push({ groupe: "Trajets", icone: "bateau", titre: `${de} → ${vers}`, detail: `${n} départ${n > 1 ? "s" : ""}`, href: `#/trajets?de=${encodeURIComponent(de)}&vers=${encodeURIComponent(vers)}` });
    });
  }
  tousEcrans().filter((e) => correspond(sansAccents(e.libelle))).forEach((e) => out.push(resultatEcran(e)));
  return out;
}

function ouvrirRecherche() {
  if (document.querySelector(".palette-fond")) return;
  const precedent = document.activeElement;
  const champ = h("input", { id: "palette-champ", type: "search", placeholder: "Client, référence, écran…", autocomplete: "off", "aria-label": "Rechercher", role: "combobox", "aria-expanded": "true", "aria-controls": "palette-liste", "aria-autocomplete": "list" });
  const liste = h("ul", { id: "palette-liste", class: "palette-liste", role: "listbox" });
  let resultats = [];
  let actif = 0;
  const fermer = () => {
    fond.remove();
    document.removeEventListener("keydown", touche);
    if (precedent && precedent.focus) precedent.focus();
  };
  const ouvrir = (r) => {
    if (!r) return;
    fermer();
    naviguer(r.href);
  };
  const touche = (e) => {
    if (e.key === "Escape") (e.preventDefault(), fermer());
  };
  const marquer = () => {
    [...liste.querySelectorAll("[role=option]")].forEach((li, i) => {
      li.setAttribute("aria-selected", i === actif ? "true" : "false");
      if (i === actif) {
        champ.setAttribute("aria-activedescendant", li.id);
        li.scrollIntoView({ block: "nearest" });
      }
    });
  };
  function dessiner() {
    resultats = chercher(champ.value);
    actif = 0;
    vider(liste);
    if (!resultats.length) {
      liste.append(h("li", { class: "palette-vide" }, `Rien pour « ${champ.value.trim()} ». Essayez un nom, une référence de dossier ou le nom d'un écran.`));
      return;
    }
    let groupe = null;
    resultats.forEach((r, i) => {
      if (r.groupe !== groupe) {
        groupe = r.groupe;
        liste.append(h("li", { class: "palette-groupe", role: "presentation" }, groupe));
      }
      liste.append(
        h(
          "li",
          { role: "option", id: `palette-${i}`, "aria-selected": i === actif ? "true" : "false", onmousedown: (e) => e.preventDefault(), onclick: () => ouvrir(r), onmousemove: () => actif !== i && ((actif = i), marquer()) },
          icone(r.icone, 18),
          h("span", { class: "palette-texte" }, h("strong", null, r.titre), r.detail ? h("span", null, r.detail) : null),
          r.droite ? h("span", { class: "palette-droite" }, r.droite) : null
        )
      );
    });
    marquer();
  }
  champ.addEventListener("input", dessiner);
  champ.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!resultats.length) return;
      actif = (actif + (e.key === "ArrowDown" ? 1 : resultats.length - 1)) % resultats.length;
      marquer();
    } else if (e.key === "Enter") (e.preventDefault(), ouvrir(resultats[actif]));
  });
  const fond = h(
    "div",
    { class: "modal-fond palette-fond", onmousedown: (e) => e.target === fond && fermer() },
    h(
      "div",
      { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Recherche" },
      h("div", { class: "palette-champ" }, icone("recherche", 20), champ, h("button", { class: "bouton-icone lien", type: "button", onclick: fermer, "aria-label": "Fermer" }, icone("fermer", 20))),
      liste,
      h("p", { class: "palette-aide" }, h("span", null, h("kbd", null, "↑"), h("kbd", null, "↓"), " choisir"), h("span", null, h("kbd", null, "Entrée"), " ouvrir"), h("span", null, h("kbd", null, "Échap"), " fermer"))
    )
  );
  document.body.append(fond);
  document.addEventListener("keydown", touche);
  dessiner();
  champ.focus();
}

let rendu = 0;
async function afficher() {
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
  const moi = ++rendu;
  let noeud;
  try {
    noeud = await vue(...hash.match(re).slice(1));
    // Une navigation plus récente a pris le relais pendant le chargement : on abandonne celle-ci.
    if (moi !== rendu) return;
  } catch (err) {
    if (moi !== rendu) return;
    console.error(err);
    noeud = h("div", { class: "vide" }, h("h1", null, "Cet écran n'a pas pu s'afficher"), h("p", null, err.message), h("a", { href: "#/" }, "Retour à l'accueil"));
  }
  principal.replaceChildren(noeud);
  principal.className = [noeud.dataset && noeud.dataset.large ? "large" : "", noeud.dataset && noeud.dataset.plein ? "plein" : ""].filter(Boolean).join(" ");
  document.title = `${(noeud.dataset && noeud.dataset.titre) || "Gestion"} - ${entiteActive().nom}`;
  // Les pages à deux volets prennent exactement la hauteur restante de la fenêtre, bandeaux éventuels compris.
  document.documentElement.style.setProperty("--decalage", `${Math.round(principal.getBoundingClientRect().top + window.scrollY + 48)}px`);
  // L'onglet « Plus » est marqué quand l'écran ouvert n'a pas d'onglet à lui.
  for (const a of document.querySelectorAll("nav [data-cle]")) a.toggleAttribute("aria-current", a.dataset.cle === cleRoute || (a.dataset.cle === "plus" && !ongletsMobiles().includes(cleRoute)));
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
      tableau([ligne(["?"], "Afficher cette aide"), ligne(["n"], "Nouveau dossier"), ligne(["/"], "Rechercher un client, un dossier ou un écran"), ligne([`${mod}+K`], "Rechercher (aussi dans un champ)"), ligne(["g", "t"], "Aujourd'hui"), ligne(["g", "d"], "Dossiers"), ligne(["g", "c"], "Clients"), ligne(["g", "k"], "Catalogue"), ligne(["g", "f"], "Tâches"), ligne(["g", "v"], "Vue d'ensemble des sociétés"), ligne(["g", "r"], "Réglages (administrateurs)"), ligne(["g", "a"], "Analyses"), ligne(["g", "j"], "Journal d'activité"), ligne(["g", "m"], "Administration (administratrice générale)"), ligne(["Échap"], "Fermer une fenêtre")]),
      h("h3", null, "Dans un devis ou une facture"),
      tableau([ligne([`${mod}+Z`], "Annuler la dernière modification"), ligne([`${mod}+Maj+Z`, `${mac ? "" : "Ctrl+Y"}`].filter(Boolean).slice(0, 1), `Rétablir${mac ? "" : " (ou Ctrl+Y)"}`), ligne([`${mod}+S`], "Enregistrer tout de suite"), ligne([`${mod}+P`], "Télécharger le PDF")]),
      h("p", { class: "aide" }, "Les raccourcis propres au navigateur, comme Ctrl+T, Ctrl+W ou Ctrl+N, ne peuvent pas être pris en charge par un site. Les autres sont désactivés pendant la saisie dans un champ pour ne pas gêner l'écriture.")
    )
  );
}

// Raccourcis simples, actifs seulement quand on n'écrit pas dans un champ et qu'aucune fenêtre n'est ouverte.
let sequence = null;
document.addEventListener("keydown", (e) => {
  if (!etat.session || !etat.db) return;
  const k = e.key.toLowerCase();
  // Ctrl+K (Cmd+K sur Mac) ouvre la recherche partout, même pendant une saisie.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && k === "k" && !document.querySelector(".modal-fond")) return e.preventDefault(), ouvrirRecherche();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.target && e.target.matches && e.target.matches("input, textarea, select, [contenteditable]")) || document.querySelector(".modal-fond")) return;
  if (sequence === "g") {
    sequence = null;
    const cibles = { t: "#/", d: "#/dossiers", c: "#/clients", k: "#/catalogue", f: "#/taches", ...(estAdmin() ? { r: "#/reglages" } : {}), ...(peut("journal.voir") ? { j: "#/journal" } : {}), ...(peut("analytics.voir") && peut("finances.voir") ? { a: "#/analyses" } : {}), ...(entitesAnalysables().length > 1 ? { v: "#/groupe" } : {}), ...(estSuperAdmin() ? { m: "#/admin" } : {}) };
    if (cibles[k]) (e.preventDefault(), (location.hash = cibles[k]));
    return;
  }
  if (k === "g") {
    sequence = "g";
    setTimeout(() => (sequence = null), 1200);
  } else if (k === "n") (e.preventDefault(), (location.hash = "#/dossiers/nouveau"));
  else if (k === "?") (e.preventDefault(), ouvrirAide());
  else if (k === "/") (e.preventDefault(), ouvrirRecherche());
});

window.addEventListener("hashchange", afficher);

// L'outil reste ouvert des journées entières dans un onglet : quand une nouvelle version est publiée, un bandeau
// propose de recharger, sinon l'ancien code tourne jusqu'au prochain rechargement complet.
async function empreinteVersion() {
  try {
    const r = await fetch("js/app.mjs", { method: "HEAD", cache: "no-store" });
    return r.ok ? r.headers.get("etag") || r.headers.get("last-modified") || "" : "";
  } catch {
    return "";
  }
}
async function surveillerVersion() {
  const initiale = await empreinteVersion();
  if (!initiale) return;
  let signale = false;
  const verifier = async () => {
    if (signale || document.visibilityState !== "visible") return;
    const actuelle = await empreinteVersion();
    if (!actuelle || actuelle === initiale) return;
    signale = true;
    document.body.append(h("div", { class: "bandeau-version", role: "status" }, h("span", null, "Une nouvelle version de l'outil est disponible."), h("button", { class: "principal petit", type: "button", onclick: () => location.reload() }, "Recharger")));
  };
  document.addEventListener("visibilitychange", verifier);
  setInterval(verifier, 10 * 60 * 1000);
}

init()
  .then(afficher)
  .then(surveillerVersion)
  .catch((err) => {
    console.error(err);
    vider(racine).append(h("div", { class: "vide" }, h("h1", null, "Connexion à la base impossible"), h("p", null, err.message), h("button", { class: "principal", onclick: () => location.reload() }, "Réessayer")));
  });
