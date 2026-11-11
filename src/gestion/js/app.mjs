import { init, etat, choisirLangue, recharger, synchroniser, entitesAccessibles, entiteActive, changerEntite, estAdmin, estSuperAdmin, roleActif, peut, resumes, nomClient, naviguer, nomPartenaire, entitesAnalysables, moduleActif, dossiersAnnules, modeExcursions } from "./etat.mjs";
import { h, vider, toast, modal, icone, saisie, squelette } from "./ui.mjs";
import { libelleStatut, formatMontant, aujourdhui } from "./calc.mjs";
import { sousTitreDossier } from "./views/commun.mjs";
import { tableauDeBord } from "./views/dashboard.mjs";
import { mesTaches } from "./views/taches.mjs";
import { agenda } from "./operations-calc.mjs";
import { retirerALaDeconnexion } from "./rappels.mjs";
import { tr, N_, pluriel, LANGUES, langueActive } from "./i18n.mjs";

// Chaque écran se charge à sa première visite : le premier affichage n'attend que l'accueil.
const vers = (charge, nom) => async (...args) => (await charge())[nom](...args);
const ROUTES = [
  [/^#\/reservations(?:\?.*)?$/, "reservations", vers(() => import("./views/reservations.mjs"), "vueReservations")],
  [/^#\/messages$/, "messages", vers(() => import("./views/messages.mjs"), "vueMessages")],
  [/^#\/du$/, "du", vers(() => import("./views/du.mjs"), "vueDu")],
  [/^#\/encaisser$/, "encaisser", vers(() => import("./views/encaisser.mjs"), "vueEncaisser")],
  [/^#\/partenaires$/, "partenaires", vers(() => import("./views/partenaires.mjs"), "listePartenaires")],
  [/^#\/partenaire\/([\w-]+)$/, "partenaires", vers(() => import("./views/partenaires.mjs"), "fichePartenaire")],
  [/^#\/tarifs(?:\?.*)?$/, "tarifs", vers(() => import("./views/tarifs.mjs"), "vueTarifs")],
  [/^#\/trajets(?:\?.*)?$/, "trajets", vers(() => import("./views/trajets.mjs"), "vueTrajets")],
  [/^#\/regles$/, "regles", vers(() => import("./views/regles.mjs"), "vueRegles")],
  [/^#?\/?$/, "tableau", tableauDeBord],
  [/^#\/dossiers(?:\?.*)?$/, "dossiers", vers(() => import("./views/dossiers.mjs"), "listeDossiers")],
  [/^#\/dossiers\/nouveau(?:\?.*)?$/, "dossiers", vers(() => import("./views/dossiers.mjs"), "nouveauDossier")],
  [/^#\/dossier\/([\w-]+)$/, "dossiers", vers(() => import("./views/dossier.mjs"), "ficheDossier")],
  [/^#\/doc\/([\w-]+)$/, "dossiers", vers(() => import("./views/editeur.mjs"), "editeur")],
  [/^#\/clients$/, "clients", vers(() => import("./views/clients.mjs"), "listeClients")],
  [/^#\/client\/([\w-]+)$/, "clients", vers(() => import("./views/clients.mjs"), "ficheClient")],
  [/^#\/catalogue$/, "catalogue", vers(() => import("./views/catalogue.mjs"), "catalogue")],
  [/^#\/reglages$/, "reglages", vers(() => import("./views/reglages.mjs"), "vueReglages")],
  [/^#\/admin$/, "admin", vers(() => import("./views/admin.mjs"), "vueAdmin")],
  [/^#\/journal$/, "journal", vers(() => import("./views/journal.mjs"), "vueJournal")],
  [/^#\/analyses$/, "analyses", vers(() => import("./views/analyses.mjs"), "vueAnalyses")],
  [/^#\/groupe$/, "groupe", vers(() => import("./views/groupe.mjs"), "vueGroupe")],
  [/^#\/taches$/, "taches", vers(() => import("./views/taches.mjs"), "vueTaches")],
  [/^#\/composants$/, "composants", vers(() => import("./views/composants.mjs"), "vueComposants")],
];

const racine = document.getElementById("app");
let derniereVue = null;

// Choix de la langue de l'interface : français ou anglais, retenu pour le compte (voir choisirLangue).
function selecteurLangue(apres) {
  return h(
    "div",
    { class: "langues", role: "group", "aria-label": "Langue / Language" },
    LANGUES.map((l) =>
      h(
        "button",
        {
          type: "button",
          lang: l.code,
          class: "langue",
          "aria-pressed": l.code === langueActive() ? "true" : "false",
          onclick: async () => {
            if (l.code === langueActive()) return;
            if (apres) apres();
            await choisirLangue(l.code);
            afficher();
          },
        },
        l.nom
      )
    )
  );
}

function vueConnexion() {
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const bouton = h("button", { class: "principal", type: "submit" }, tr("Se connecter"));
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
        bouton.textContent = tr("Connexion…");
        try {
          await etat.store.connecter(email.value.trim(), mdp.value);
          etat.session = await etat.store.session();
          await recharger();
          afficher();
        } catch (err) {
          erreur.textContent = err.message;
          bouton.disabled = false;
          bouton.textContent = tr("Se connecter");
        }
      },
    },
    h("div", { class: "champ" }, h("label", { for: "email" }, tr("Adresse e-mail")), email),
    h("div", { class: "champ" }, h("label", { for: "mdp" }, tr("Mot de passe")), mdp),
    erreur,
    bouton
  );
  return h("div", { class: "connexion" }, selecteurLangue(), h("h1", null, tr("Gestion")), h("p", { class: "sous" }, tr("Devis, factures et suivi des paiements.")), form);
}

function selecteurEntite() {
  const liste = entitesAccessibles();
  if (liste.length < 2) return liste.length ? h("p", { class: "entite-nom" }, liste[0].nom) : null;
  const sel = h("select", { id: "entite", "aria-label": tr("Entreprise"), onchange: (e) => changerEntite(e.target.value) }, liste.map((e) => h("option", { value: e.id }, e.nom)));
  sel.value = etat.entiteId;
  return h("div", { class: "entite-choix" }, sel);
}

function bandeauDemo() {
  const s = etat.store;
  const sel = h(
    "select",
    {
      id: "demo-utilisateur",
      "aria-label": tr("Se connecter en tant que"),
      onchange: async (e) => {
        s.changerUtilisateurDemo(e.target.value);
        etat.session = await s.session();
        await recharger();
        location.hash = "#/";
        afficher();
      },
    },
    s.utilisateursDemo().map((u) => h("option", { value: u.id }, u.super_admin ? tr("{nom} (voit tout)", { nom: u.nom }) : u.nom))
  );
  sel.value = s.utilisateurDemo();
  return h(
    "div",
    { class: "bandeau-demo" },
    h("span", null, tr("Mode démonstration : clients fictifs, données dans ce navigateur.")),
    h("label", { class: "demo-choix" }, tr("Utilisateur : "), sel),
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
          toast(tr("Démo réinitialisée."));
        },
      },
      tr("Repartir de zéro")
    )
  );
}

// Écrans ouverts à la personne connectée, groupés comme dans la barre latérale.
function ecrans() {
  const ajd = aujourdhui();
  const enRetard = mesTaches().filter((t) => t.echeance && t.echeance <= ajd).length;
  const si = (ok, item) => (ok ? [item] : []);
  const ag = agenda(etat.db.reservations, ajd, dossiersAnnules());
  const aConfirmer = ag.enRetard.length + ag.aConfirmer.length;
  return [
    { titre: tr("Opérations"), items: [{ href: "#/", libelle: tr("Aujourd'hui"), cle: "tableau", icone: "soleil" }, ...si(moduleActif("reservations"), { href: "#/reservations", libelle: tr("Réservations"), cle: "reservations", icone: "reservations", badge: aConfirmer }), { href: "#/taches", libelle: tr("Tâches"), cle: "taches", icone: "taches", badge: enRetard }, ...si(moduleActif("messages"), { href: "#/messages", libelle: tr("Messages"), cle: "messages", icone: "messages" })] },
    { titre: tr("Ventes"), items: [{ href: "#/dossiers", libelle: tr("Dossiers"), cle: "dossiers", icone: "dossiers" }, { href: "#/clients", libelle: tr("Clients"), cle: "clients", icone: "clients" }, ...si(peut("finances.voir") || peut("partenaires.nets"), { href: "#/encaisser", libelle: tr("À encaisser"), cle: "encaisser", icone: "du" }), ...si(moduleActif("catalogue"), { href: "#/catalogue", libelle: tr("Catalogue"), cle: "catalogue", icone: "catalogue" })] },
    {
      titre: tr("Partenaires"),
      items: si(peut("partenaires.lire") && moduleActif("partenaires"), null).length
        ? [
            { href: "#/partenaires", libelle: tr("Partenaires"), cle: "partenaires", icone: "partenaires" },
            { href: "#/tarifs", libelle: tr("Tarifs"), cle: "tarifs", icone: "tarifs" },
            { href: "#/trajets", libelle: tr("Trajets"), cle: "trajets", icone: "bateau" },
            { href: "#/regles", libelle: tr("Règles"), cle: "regles", icone: "regles" },
            ...si(peut("partenaires.nets"), { href: "#/du", libelle: tr("Dû aux partenaires"), cle: "du", icone: "du" }),
          ]
        : [],
    },
    {
      titre: tr("Administration"),
      items: [
        ...si(peut("analytics.voir") && peut("finances.voir"), { href: "#/analyses", libelle: tr("Analyses"), cle: "analyses", icone: "analyses" }),
        ...si(entitesAnalysables().length > 1, { href: "#/groupe", libelle: tr("Vue d'ensemble"), cle: "groupe", icone: "groupe" }),
        ...si(peut("journal.voir"), { href: "#/journal", libelle: tr("Journal"), cle: "journal", icone: "journal" }),
        ...si(estAdmin(), { href: "#/reglages", libelle: tr("Réglages"), cle: "reglages", icone: "reglages" }),
        ...si(estSuperAdmin(), { href: "#/admin", libelle: tr("Administration"), cle: "admin", icone: "admin" }),
      ],
    },
  ].filter((s) => s.items.length);
}
// Les écrans qui ont leur onglet sur téléphone (cinq au plus, « Plus » compris) : ce qu'Anaïs ouvre chaque jour. Le reste passe par « Plus ».
const ongletsMobiles = () => ["tableau", "dossiers", moduleActif("reservations") ? "reservations" : null, "clients"].filter(Boolean);
const tousEcrans = () => ecrans().flatMap((s) => s.items);

const lienEcran = (e, apres) => h("a", { href: e.href, "data-cle": e.cle, class: "lien-ecran", onclick: apres }, icone(e.icone, 20), h("span", null, e.libelle), e.badge ? h("span", { class: "badge", "aria-label": tr("{badge} en retard", { badge: e.badge }) }, e.badge) : null);
const sections = (liste, apres) => liste.map((s) => h("div", { class: "menu-section" }, h("p", { class: "menu-section-titre" }, s.titre), h("ul", null, s.items.map((e) => h("li", null, lienEcran(e, apres))))));

async function deconnecter() {
  await retirerALaDeconnexion(etat.store);
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
  etat.store.mode === "supabase" ? h("button", { class: "bouton-icone secondaire", type: "button", onclick: async () => (apres && apres(), (await import("./views/rappels.mjs")).ouvrirRappels()), "aria-label": tr("Rappels sur ce téléphone"), title: tr("Rappels sur ce téléphone") }, icone("cloche")) : null,
  h("button", { class: "bouton-icone secondaire", type: "button", onclick: () => (apres && apres(), ouvrirAide()), "aria-label": tr("Raccourcis clavier"), title: tr("Raccourcis clavier (?)") }, icone("clavier")),
  etat.store.mode === "supabase" ? h("button", { class: "bouton-icone secondaire", type: "button", onclick: deconnecter, "aria-label": tr("Se déconnecter"), title: tr("Se déconnecter") }, icone("deconnexion")) : null,
];

// Ordinateur : barre latérale avec les écrans par section, la recherche et le compte.
function menu() {
  const logo = etat.db.reglages.apparence.logo;
  return h(
    "nav",
    { class: "menu", "aria-label": tr("Navigation principale") },
    h("a", { class: "marque", href: "#/" }, logo ? h("img", { src: logo, alt: "" }) : null, h("span", null, tr("Gestion"))),
    selecteurEntite(),
    h("button", { class: "recherche-bouton", type: "button", onclick: ouvrirRecherche }, icone("recherche", 18), h("span", null, tr("Rechercher")), h("kbd", null, "/")),
    sections(ecrans()),
    h("div", { class: "menu-bas" }, selecteurLangue(), blocCompte(), h("div", { class: "menu-outils" }, outilsCompte()))
  );
}

// Téléphone : l'entreprise et la recherche en haut, quatre onglets en bas.
function barreHaut() {
  const logo = etat.db.reglages.apparence.logo;
  return h("header", { class: "barre-haut" }, logo ? h("img", { class: "barre-logo", src: logo, alt: "" }) : null, selecteurEntite(), h("button", { class: "bouton-icone lien", type: "button", onclick: ouvrirRecherche, "aria-label": tr("Rechercher") }, icone("recherche", 22)));
}

function barreOnglets() {
  const tous = tousEcrans();
  const onglet = (e, contenu) => h("span", { class: "onglet-icone" }, icone(e.icone, 22), contenu);
  const onglets = ongletsMobiles();
  const badgePlus = tous.filter((e) => !onglets.includes(e.cle)).reduce((n, e) => n + (e.badge || 0), 0);
  return h(
    "nav",
    { class: "barre-onglets", "aria-label": tr("Navigation principale") },
    h(
      "ul",
      null,
      onglets.map((cle) => tous.find((e) => e.cle === cle)).filter(Boolean).map((e) => h("li", null, h("a", { href: e.href, "data-cle": e.cle, class: "onglet" }, onglet(e, e.badge ? h("span", { class: "badge" }, e.badge) : null), h("span", null, e.libelle)))),
      h("li", null, h("button", { type: "button", class: "onglet", "data-cle": "plus", onclick: ouvrirPlus }, onglet({ icone: "plus" }, badgePlus ? h("span", { class: "badge" }, badgePlus) : null), h("span", null, tr("Plus"))))
    )
  );
}

// Feuille « Plus » : les écrans sans onglet, le compte et la déconnexion.
function ouvrirPlus() {
  const onglets = ongletsMobiles();
  const restants = ecrans().map((s) => ({ ...s, items: s.items.filter((e) => !onglets.includes(e.cle)) })).filter((s) => s.items.length);
  let fermer;
  const apres = () => fermer();
  fermer = modal(tr("Plus"), h("div", { class: "feuille-menu" }, sections(restants, apres), h("div", { class: "feuille-pied" }, selecteurLangue(apres), blocCompte(), h("div", { class: "menu-outils" }, outilsCompte(apres)))), { feuille: true });
}

// Bouton « + » flottant sur les écrans de liste : un geste pour créer. La création elle-même vit dans les écrans de saisie.
// Seulement sur les listes et l'accueil, pas sur une fiche ni un éditeur : adresses exactes.
const ECRANS_AVEC_PLUS = /^#?\/?$|^#\/(dossiers|clients|reservations)(\?.*)?$/;
function boutonPlus() {
  if (!peut("dossiers.ecrire")) return null;
  return h("button", { class: "bouton-plus", type: "button", "aria-label": tr("Nouveau"), title: tr("Nouveau"), onclick: ouvrirNouveau }, icone("ajouter", 26));
}
function ouvrirNouveau() {
  let fermer;
  const va = (hash) => () => (fermer(), naviguer(hash));
  const choix = (ic, titre, detail, onclick) => h("button", { type: "button", class: "choix-nouveau", onclick }, icone(ic, 22), h("span", null, h("strong", null, titre), h("span", null, detail)));
  fermer = modal(
    tr("Nouveau"),
    h(
      "div",
      { class: "modal-corps" },
      choix("dossiers", tr("Nouveau dossier"), tr("Un client, un voyage, un devis"), va("#/dossiers/nouveau")),
      modeExcursions() ? choix("messages", tr("Coller une demande"), tr("Un message WhatsApp du client devient un dossier"), async () => (fermer(), (await import("./views/demande.mjs")).ouvrirDemande())) : null
    ),
    { protege: false }
  );
}

function coque() {
  return h("div", { class: "coque" }, menu(), h("div", { class: "contenu-coque" }, barreHaut(), h("div", { class: "contenu" }, etat.store.mode === "demo" ? bandeauDemo() : null, h("main", { id: "principal", tabindex: "-1" }))), barreOnglets(), boutonPlus());
}

// ---- Recherche globale ----------------------------------------------------------------------------------------
const sansAccents = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const resultatDossier = (r) => ({ groupe: tr("Dossiers"), icone: "dossiers", titre: nomClient(r.client), detail: sousTitreDossier(r.dossier), droite: libelleStatut(r.statut), href: `#/dossier/${r.dossier.id}` });
const resultatEcran = (e) => ({ groupe: tr("Écrans"), icone: e.icone, titre: e.libelle, href: e.href });

// Les cinq derniers résultats ouverts, gardés dans ce navigateur : au téléphone, rouvrir le dossier de la veille se fait sans taper.
const CLE_RECENTS = "gestion-recherches-recentes";
function lireRecents() {
  try {
    const v = JSON.parse(localStorage.getItem(CLE_RECENTS) || "[]");
    return Array.isArray(v) ? v.filter((r) => r && typeof r.href === "string" && typeof r.titre === "string") : [];
  } catch {
    return [];
  }
}
function noterRecent(r) {
  if (!r.href.startsWith("#/dossier/") && !r.href.startsWith("#/client/") && !r.href.startsWith("#/partenaire/")) return;
  const garde = { groupe: r.groupe, icone: r.icone, titre: r.titre, detail: r.detail || "", href: r.href };
  try {
    localStorage.setItem(CLE_RECENTS, JSON.stringify([garde, ...lireRecents().filter((x) => x.href !== r.href)].slice(0, 5)));
  } catch {
    // stockage refusé : pas de récents
  }
}
// Tous les mots saisis doivent apparaître. Sans saisie : les récents, les derniers dossiers et la liste des écrans.
function chercher(q) {
  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  const correspond = (texte) => mots.every((m) => texte.includes(m));
  if (!mots.length) {
    const recents = lireRecents().map((r) => ({ ...r, groupe: tr("Récents") }));
    const dejaVus = new Set(recents.map((r) => r.href));
    const derniers = resumes().sort((a, b) => b.dossier.created_at.localeCompare(a.dossier.created_at)).slice(0, 5).map(resultatDossier).filter((r) => !dejaVus.has(r.href));
    const action = peut("dossiers.ecrire") ? [{ groupe: tr("Actions"), icone: "ajouter", titre: tr("Nouveau dossier"), href: "#/dossiers/nouveau" }] : [];
    return [...recents, ...action, ...derniers, ...tousEcrans().map(resultatEcran)];
  }
  const out = [];
  if (peut("dossiers.ecrire") && mots.every((m) => sansAccents(tr("Nouveau dossier")).includes(m))) out.push({ groupe: tr("Actions"), icone: "ajouter", titre: tr("Nouveau dossier"), href: "#/dossiers/nouveau" });
  resumes()
    .filter((r) => correspond(sansAccents(`${nomClient(r.client)} ${r.dossier.ref} ${r.dossier.pays} ${r.dossier.bandeau}`)))
    .sort((a, b) => b.dossier.created_at.localeCompare(a.dossier.created_at))
    .slice(0, 6)
    .forEach((r) => out.push(resultatDossier(r)));
  etat.db.clients
    .filter((c) => correspond(sansAccents(`${nomClient(c)} ${c.telephone} ${c.email} ${c.adresse}`)))
    .slice(0, 6)
    .forEach((c) => out.push({ groupe: tr("Clients"), icone: "clients", titre: nomClient(c), detail: [c.telephone, (c.adresse || "").split("\n").filter(Boolean).pop()].filter(Boolean).join(" · "), href: `#/client/${c.id}` }));
  if (peut("partenaires.lire") && moduleActif("partenaires")) {
    etat.db.partenaires
      .filter((p) => p.actif !== false && correspond(sansAccents(`${p.nom} ${p.nom_thai} ${p.categorie} ${p.role}`)))
      .slice(0, 5)
      .forEach((p) => out.push({ groupe: tr("Partenaires"), icone: "partenaires", titre: p.nom, detail: p.role || p.categorie, href: `#/partenaire/${p.id}` }));
    etat.db.prestations
      .filter((x) => x.actif !== false && correspond(sansAccents(`${x.libelle} ${x.groupe} ${nomPartenaire(x.partenaire_id)}`)))
      .slice(0, 6)
      .forEach((x) => out.push({ groupe: tr("Tarifs"), icone: "tarifs", titre: x.libelle, detail: [nomPartenaire(x.partenaire_id), x.groupe].filter(Boolean).join(" · "), droite: x.prix_vente != null ? formatMontant(x.prix_vente) : "", href: `#/tarifs?famille=${x.famille}&q=${encodeURIComponent(x.libelle)}` }));
    const paires = new Map();
    for (const t of etat.db.trajets) if (correspond(sansAccents(`${t.de} ${t.vers} ${nomPartenaire(t.partenaire_id)}`))) paires.set(`${t.de}|${t.vers}`, (paires.get(`${t.de}|${t.vers}`) || 0) + 1);
    [...paires].slice(0, 5).forEach(([k, n]) => {
      const [de, vers] = k.split("|");
      out.push({ groupe: tr("Trajets"), icone: "bateau", titre: `${de} → ${vers}`, detail: pluriel(n, N_("départ"), N_("départs")), href: `#/trajets?de=${encodeURIComponent(de)}&vers=${encodeURIComponent(vers)}` });
    });
  }
  tousEcrans().filter((e) => correspond(sansAccents(e.libelle))).forEach((e) => out.push(resultatEcran(e)));
  return out;
}

function ouvrirRecherche() {
  if (document.querySelector(".palette-fond")) return;
  const precedent = document.activeElement;
  const champ = saisie(h("input", { id: "palette-champ", type: "search", placeholder: tr("Client, référence, écran…"), "aria-label": tr("Rechercher"), role: "combobox", "aria-expanded": "true", "aria-controls": "palette-liste", "aria-autocomplete": "list" }), "recherche");
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
    noterRecent(r);
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
      liste.append(h("li", { class: "palette-vide" }, tr("Rien pour « {trim} ». Essayez un nom, une référence de dossier ou le nom d'un écran.", { trim: champ.value.trim() })));
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
      { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": tr("Recherche") },
      h("div", { class: "palette-champ" }, icone("recherche", 20), champ, h("button", { class: "bouton-icone lien", type: "button", onclick: fermer, "aria-label": tr("Fermer") }, icone("fermer", 20))),
      liste,
      h("p", { class: "palette-aide" }, h("span", null, h("kbd", null, "↑"), h("kbd", null, "↓"), " choisir"), h("span", null, h("kbd", null, tr("Entrée")), " ouvrir"), h("span", null, h("kbd", null, tr("Échap")), " fermer"))
    )
  );
  document.body.append(fond);
  document.addEventListener("keydown", touche);
  dessiner();
  champ.focus();
}

// Défilement : un retour (bouton Retour, geste du bord) retrouve la page là où on l'avait laissée, un lien neuf commence en haut.
// Chaque entrée de l'historique porte un numéro dans history.state : sans numéro c'est une navigation neuve, avec un numéro c'est un retour ou un avance.
const positions = new Map();
let compteurHistorique = 0;
const rs = history.replaceState.bind(history);
// Les écrans de liste réécrivent l'adresse avec replaceState(null, …) pour garder leurs filtres : on conserve le numéro d'entrée.
history.replaceState = (etatNeuf, titre, url) => rs(etatNeuf ?? history.state, titre, url);
function restaurerDefilement(hash) {
  const changeDePage = hash !== derniereVue;
  const numero = history.state && history.state.gestionEntree;
  if (derniereVue !== null && changeDePage) positions.set(derniereVue, defilementAvant);
  if (!changeDePage) return;
  if (numero) {
    const y = positions.get(hash) ?? 0;
    // Le contenu des écrans est déjà là : un seul passage au prochain affichage suffit, deux pour les mises en page tardives.
    requestAnimationFrame(() => (window.scrollTo(0, y), requestAnimationFrame(() => window.scrollTo(0, y))));
  } else {
    rs({ ...(history.state || {}), gestionEntree: ++compteurHistorique }, "");
    window.scrollTo(0, 0);
  }
}
// La position se lit au moment où l'adresse change, avant que l'écran suivant ne remplace le contenu (ce qui ferait glisser la page).
let defilementAvant = 0;
window.addEventListener("hashchange", () => (defilementAvant = window.scrollY));

// Rotation d'une tablette ou fenêtre élargie : dès 720 px les titres des blocs repliables ne se cliquent plus, tout doit donc s'ouvrir.
window.matchMedia("(min-width: 720px)").addEventListener("change", (e) => e.matches && document.querySelectorAll("details.repli, details.filtres-plus").forEach((d) => (d.open = true)));

let rendu = 0;
async function afficher() {
  if (!etat.session) {
    vider(racine).append(vueConnexion());
    document.title = tr("Connexion - Gestion");
    return;
  }
  if (!entiteActive()) {
    vider(racine).append(
      h(
        "div",
        { class: "connexion" },
        selecteurLangue(),
        h("h1", null, tr("Aucun accès pour l'instant")),
        h("p", { class: "sous" }, tr("Votre compte ({email}) n'a pas encore accès à une entreprise. Demandez à l'administratrice de vous en donner un.", { email: etat.session.email })),
        etat.store.mode === "demo" ? bandeauDemo() : null,
        etat.store.mode === "supabase" ? h("button", { class: "secondaire", type: "button", onclick: async () => (await etat.store.deconnecter(), (etat.session = null), afficher()) }, tr("Se déconnecter")) : null
      )
    );
    document.title = tr("Aucun accès - Gestion");
    return;
  }
  // Le menu dépend de l'entreprise active et des droits : on le refait quand l'un des deux change.
  const cle = `${etat.entiteId}|${roleActif()}|${etat.session.id}|${langueActive()}`;
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
  document.documentElement.classList.remove("a-barre-action");
  const moi = ++rendu;
  let noeud;
  // Une première visite d'un écran télécharge son code : au-delà de 150 ms, un squelette tient la place plutôt qu'un écran figé.
  const attente = hash !== derniereVue ? setTimeout(() => moi === rendu && principal.replaceChildren(squelette(4)), 150) : null;
  try {
    noeud = await vue(...hash.match(re).slice(1));
    // Une navigation plus récente a pris le relais pendant le chargement : on abandonne celle-ci.
    if (moi !== rendu) return;
  } catch (err) {
    if (moi !== rendu) return;
    console.error(err);
    noeud = h("div", { class: "vide" }, h("h1", null, tr("Cet écran n'a pas pu s'afficher")), h("p", null, err.message), h("a", { href: "#/" }, tr("Retour à l'accueil")));
  } finally {
    clearTimeout(attente);
  }
  principal.replaceChildren(noeud);
  principal.className = [noeud.dataset && noeud.dataset.large ? "large" : "", noeud.dataset && noeud.dataset.plein ? "plein" : ""].filter(Boolean).join(" ");
  document.title = `${(noeud.dataset && noeud.dataset.titre) || tr("Gestion")} - ${entiteActive().nom}`;
  // Les pages à deux volets prennent exactement la hauteur restante de la fenêtre, bandeaux éventuels compris.
  document.documentElement.style.setProperty("--decalage", `${Math.round(principal.getBoundingClientRect().top + window.scrollY + 48)}px`);
  // L'onglet « Plus » est marqué quand l'écran ouvert n'a pas d'onglet à lui.
  for (const a of document.querySelectorAll("nav [data-cle]")) a.toggleAttribute("aria-current", a.dataset.cle === cleRoute || (a.dataset.cle === "plus" && !ongletsMobiles().includes(cleRoute)));
  document.querySelector(".coque").classList.toggle("avec-plus", ECRANS_AVEC_PLUS.test(hash) && !!document.querySelector(".bouton-plus"));
  restaurerDefilement(hash);
  derniereVue = hash;
}

function ouvrirAide() {
  const ligne = (touches, texte) => h("tr", null, h("td", null, ...touches.flatMap((t, i) => (i ? [tr(" puis "), h("kbd", null, t)] : [h("kbd", null, t)]))), h("td", null, tr(texte)));
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? tr("Cmd") : tr("Ctrl");
  const tableau = (lignes) => h("table", { class: "tableau simple raccourcis" }, h("tbody", null, lignes));
  modal(
    tr("Raccourcis clavier"),
    h(
      "div",
      { class: "modal-corps" },
      h("h3", null, tr("Partout, hors d'un champ de saisie")),
      tableau([ligne(["?"], N_("Afficher cette aide")), ligne(["n"], N_("Nouveau dossier")), ligne(["/"], N_("Rechercher un client, un dossier ou un écran")), ligne([`${mod}+K`], N_("Rechercher (aussi dans un champ)")), ligne(["g", "t"], N_("Aujourd'hui")), ligne(["g", "d"], N_("Dossiers")), ligne(["g", "c"], N_("Clients")), ligne(["g", "k"], N_("Catalogue")), ligne(["g", "f"], N_("Tâches")), ligne(["g", "v"], N_("Vue d'ensemble des sociétés")), ligne(["g", "r"], N_("Réglages (administrateurs)")), ligne(["g", "a"], N_("Analyses")), ligne(["g", "j"], N_("Journal d'activité")), ligne(["g", "m"], N_("Administration (administratrice générale)")), ligne([tr("Échap")], N_("Fermer une fenêtre"))]),
      h("h3", null, tr("Dans un devis ou une facture")),
      tableau([ligne([`${mod}+Z`], N_("Annuler la dernière modification")), ligne([`${mod}+${tr("Maj")}+Z`], mac ? N_("Rétablir") : N_("Rétablir (ou Ctrl+Y)")), ligne([`${mod}+S`], N_("Enregistrer tout de suite")), ligne([`${mod}+P`], N_("Télécharger le PDF"))]),
      h("p", { class: "aide" }, tr("Les raccourcis propres au navigateur, comme Ctrl+T, Ctrl+W ou Ctrl+N, ne peuvent pas être pris en charge par un site. Les autres sont désactivés pendant la saisie dans un champ pour ne pas gêner l'écriture."))
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
    document.body.append(h("div", { class: "bandeau-version", role: "status" }, h("span", null, tr("Une nouvelle version de l'outil est disponible.")), h("button", { class: "principal petit", type: "button", onclick: () => location.reload() }, tr("Recharger"))));
  };
  document.addEventListener("visibilitychange", verifier);
  setInterval(verifier, 10 * 60 * 1000);
}

// Une erreur que personne n'a rattrapée (une action sans message d'erreur prévu) ne passe plus sous silence : un message apparaît, au lieu
// d'un bouton qui ne fait rien. Les alertes sans importance des navigateurs sont ignorées.
let derniereErreur = { message: "", quand: 0 };
function signalerErreur(message) {
  if (!message || /ResizeObserver|^Script error\.?$|AbortError/i.test(message)) return;
  if (message === derniereErreur.message && Date.now() - derniereErreur.quand < 5000) return;
  derniereErreur = { message, quand: Date.now() };
  console.error(message);
  toast(tr("Une erreur est survenue : {message}", { message }), true);
}
window.addEventListener("unhandledrejection", (e) => signalerErreur((e.reason && e.reason.message) || String(e.reason || "")));
window.addEventListener("error", (e) => signalerErreur(e.message));

// Ce que fait une autre personne (un dossier créé, un paiement noté) apparaît sans recharger : l'outil relit la base en silence
// au retour sur l'onglet puis chaque minute. L'écran n'est redessiné que s'il n'y a rien à perdre : pas de fenêtre ouverte,
// pas de champ en cours de saisie, pas d'éditeur de document. Dans les autres cas les données sont déjà à jour pour l'écran suivant.
const ECRANS_DE_LECTURE = /^#?\/?$|^#\/(dossiers|clients|taches|reservations|du|partenaires|trajets|tarifs|catalogue|analyses|groupe|journal)(\?.*)?$|^#\/(dossier|client|partenaire)\/[\w-]+$/;
function ecranLibre() {
  if (!ECRANS_DE_LECTURE.test(location.hash || "#/")) return false;
  if (document.querySelector(".modal-fond")) return false;
  const actif = document.activeElement;
  if (actif && actif.matches("input, textarea, select, [contenteditable]")) return false;
  const principal = document.getElementById("principal");
  return ![...principal.querySelectorAll("input, textarea")].some((c) => !["checkbox", "radio", "button", "submit"].includes(c.type) && c.value !== c.defaultValue);
}
function surveillerDonnees() {
  let derniere = 0;
  let derniereReussite = Date.now();
  let echecs = 0;
  let aRedessiner = false;
  let annoncer = false;
  // Pastille visible quand la relecture échoue deux fois de suite (réseau coupé, session expirée) : sans elle, l'écran vieillit sans rien dire.
  const pastille = h("div", { class: "etat-synchro", role: "status", hidden: true });
  document.body.append(pastille);
  const majPastille = () => {
    pastille.hidden = echecs < 2;
    if (echecs >= 2) pastille.textContent = tr("Connexion perdue : les données affichées datent de {duree}. Elles se mettent à jour dès que le réseau revient.", { duree: pluriel(Math.max(1, Math.round((Date.now() - derniereReussite) / 60000)), N_("minute"), N_("minutes")) });
  };
  const actualiser = async () => {
    if (document.visibilityState !== "visible" || Date.now() - derniere < 10000) return;
    derniere = Date.now();
    try {
      const r = await synchroniser();
      if (r !== "ignore") (echecs = 0), (derniereReussite = Date.now());
      if (r === "modifie" || r === "propre") aRedessiner = true;
      if (r === "modifie") annoncer = true;
    } catch (err) {
      console.warn(err);
      echecs++;
    }
    majPastille();
    if (aRedessiner && etat.session && ecranLibre()) {
      aRedessiner = false;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      if (annoncer) toast(tr("Données mises à jour."));
      annoncer = false;
    }
  };
  document.addEventListener("visibilitychange", actualiser);
  window.addEventListener("online", actualiser);
  setInterval(actualiser, 60 * 1000);
}

init()
  .then(afficher)
  .then(surveillerVersion)
  .then(surveillerDonnees)
  .catch((err) => {
    console.error(err);
    vider(racine).append(h("div", { class: "vide" }, h("h1", null, tr("Connexion à la base impossible")), h("p", null, err.message), h("button", { class: "principal", onclick: () => location.reload() }, tr("Réessayer"))));
  });
