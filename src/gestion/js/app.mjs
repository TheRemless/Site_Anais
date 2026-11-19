import { init, etat, choisirLangue, recharger, synchroniser, entitesAccessibles, entiteActive, changerEntite, estAdmin, estSuperAdmin, roleActif, peut, resumes, nomClient, naviguer, nomPartenaire, entitesAnalysables, moduleActif, modeExcursions, modeTaxi, ecranVoucherSeul, travaillerPourVoucher, confirmationPermise, clientsProposes, clientEtranger, etiquetteClient } from "./etat.mjs";
import { MODULES, moduleDeLEcran } from "./modules.mjs";
import { CLE_HORS_LIGNE } from "./feuille-hors-ligne-lecture.mjs";
import { h, vider, toast, modal, icone, saisie, squelette, purgerBrouillons } from "./ui.mjs";
import { libelleStatut, formatMontant, formatDate, aujourdhui } from "./calc.mjs";
import { sousTitreDossier, listeClientsPlateforme } from "./views/commun.mjs";
import { tableauDeBord } from "./views/dashboard.mjs";
import { mesTaches } from "./views/taches.mjs";
import { retirerALaDeconnexion } from "./rappels.mjs";
import { aTraiter } from "./demandes-site-calc.mjs";
import { ecranDeLecture, TABLES_EN_DIRECT, momentDeRecharger, nouvellesDemandes } from "./direct-calc.mjs";
import { tr, N_, pluriel, LANGUES, langueActive } from "./i18n.mjs";
import { reglagesFid } from "./fiduciaire-calc.mjs";

// Chaque écran se charge à sa première visite : le premier affichage n'attend que l'accueil.
const vers = (charge, nom) => async (...args) => (await charge())[nom](...args);
const ROUTES = [
  [/^#\/reservations(?:\?.*)?$/, "reservations", vers(() => import("./views/reservations.mjs"), "vueReservations")],
  [/^#\/reservation\/([\w-]+)(?:\?.*)?$/, "reservation", vers(() => import("./views/reservation-rappel.mjs"), "vueReservation")],
  [/^#\/messages$/, "messages", vers(() => import("./views/messages.mjs"), "vueMessages")],
  [/^#\/fiduciaire$/, "fiduciaire", vers(() => import("./views/fiduciaire.mjs"), "vueFiduciaire")],
  [/^#\/demandes(?:\?.*)?$/, "demandes", vers(() => import("./views/demandes-site.mjs"), "vueDemandesSite")],
  [/^#\/bandeau$/, "bandeau", vers(() => import("./views/bandeau-site.mjs"), "vueBandeauSite")],
  [/^#\/du$/, "du", vers(() => import("./views/du.mjs"), "vueDu")],
  [/^#\/encaisser$/, "encaisser", vers(() => import("./views/encaisser.mjs"), "vueEncaisser")],
  [/^#\/a-verifier$/, "a-verifier", vers(() => import("./views/a-verifier.mjs"), "vueAVerifier")],
  [/^#\/partenaires$/, "partenaires", vers(() => import("./views/partenaires.mjs"), "listePartenaires")],
  [/^#\/partenaire\/([\w-]+)$/, "partenaires", vers(() => import("./views/partenaires.mjs"), "fichePartenaire")],
  [/^#\/tarifs(?:\?.*)?$/, "tarifs", vers(() => import("./views/tarifs.mjs"), "vueTarifs")],
  [/^#\/trajets(?:\?.*)?$/, "trajets", vers(() => import("./views/trajets.mjs"), "vueTrajets")],
  [/^#\/regles$/, "regles", vers(() => import("./views/regles.mjs"), "vueRegles")],
  [/^#?\/?$/, "tableau", tableauDeBord],
  [/^#\/dossiers(?:\?.*)?$/, "dossiers", vers(() => import("./views/dossiers.mjs"), "listeDossiers")],
  [/^#\/dossiers\/nouveau(?:\?.*)?$/, "dossiers", vers(() => import("./views/dossiers.mjs"), "nouveauDossier")],
  [/^#\/dossier\/([\w-]+)(?:\?.*)?$/, "dossiers", vers(() => import("./views/dossier.mjs"), "ficheDossier")],
  [/^#\/doc\/([\w-]+)$/, "dossiers", vers(() => import("./views/editeur.mjs"), "editeur")],
  [/^#\/clients$/, "clients", vers(() => import("./views/clients.mjs"), "listeClients")],
  [/^#\/client\/([\w-]+)$/, "clients", vers(() => import("./views/clients.mjs"), "ficheClient")],
  [/^#\/catalogue$/, "catalogue", vers(() => import("./views/catalogue.mjs"), "catalogue")],
  [/^#\/reglages$/, "reglages", vers(() => import("./views/reglages.mjs"), "vueReglages")],
  [/^#\/admin$/, "admin", vers(() => import("./views/admin.mjs"), "vueAdmin")],
  [/^#\/journal$/, "journal", vers(() => import("./views/journal.mjs"), "vueJournal")],
  [/^#\/analyses(?:\/([a-z]+))?(?:\?.*)?$/, "analyses", vers(() => import("./views/analyses.mjs"), "vueAnalyses")],
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
    bouton,
    // Mot de passe oublié (audit n° 2) : un e-mail de Supabase, ou un lien que l'administratrice crée dans Administration.
    h("button", { class: "lien", type: "button", onclick: async () => (await import("./views/compte.mjs")).ouvrirMotDePasseOublie(email.value.trim()) }, tr("Mot de passe oublié ?"))
  );
  // Lien d'invitation ou de mot de passe expiré, ou déjà utilisé : on le dit au lieu d'un écran de connexion muet.
  const lienPerime = etat.retour.erreur
    ? h("p", { class: "bandeau-info", role: "alert" }, etat.retour.erreur === "expire" ? tr("Ce lien a expiré ou a déjà servi. Demandez-en un nouveau à l'administratrice, ou utilisez « Mot de passe oublié ».") : tr("Ce lien n'a pas pu être utilisé. Demandez-en un nouveau à l'administratrice, ou utilisez « Mot de passe oublié »."))
    : null;
  // Dit une fois : après une connexion puis une déconnexion, l'écran ne parle plus de ce lien.
  etat.retour = { ...etat.retour, erreur: null };
  return h("div", { class: "connexion" }, selecteurLangue(), h("h1", null, tr("Gestion")), h("p", { class: "sous" }, tr("Dossiers, réservations et paiements.")), lienPerime, form);
}

// `ou` : la barre où il s'affiche (« menu », « haut », « simple »). Les deux sélecteurs (barre latérale et barre du haut) sont dans la page
// en même temps : chacun son identifiant, sinon `#entite` désigne celui qui est caché sur téléphone.
function selecteurEntite(ou) {
  const liste = entitesAccessibles();
  if (liste.length < 2) return liste.length ? h("p", { class: "entite-nom" }, liste[0].nom) : null;
  const sel = h("select", { id: `entite-${ou}`, "aria-label": tr("Entreprise"), onchange: async (e) => {
    // Réglages modifiés et pas enregistrés : on demande avant de changer d'entreprise (le formulaire appartient à l'entreprise ouverte).
    if (!(await peutQuitter())) return void (e.target.value = etat.entiteId);
    changerEntite(e.target.value);
  } }, liste.map((e) => h("option", { value: e.id }, e.nom)));
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
    s.utilisateursDemo().map((u) => h("option", { value: u.id }, u.plateforme ? tr("{nom} (aucune donnée de client)", { nom: u.nom }) : u.organisation && u.organisation !== "Organisation démo" ? tr("{nom} ({organisation}, nouveau client)", { nom: u.nom, organisation: u.organisation }) : u.super_admin ? tr("{nom} (voit tout)", { nom: u.nom }) : u.nom))
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

// Le site public (migration 30) : modules « Demandes du site » et « Bandeau du site », dans une entreprise qui publie sur le site
// (entites.publie_site, Secret et Taxi chez Zwald), pour qui voit tous les dossiers.
// Le badge compte les demandes à traiter : elles arrivent avec une notification, le chiffre reste jusqu'à la réponse.
// Règle commune aux deux écrans du site : lire les dossiers et les voir tous (comme la base : lit_demandes_site).
const voitLeSite = () => peut("dossiers.lire") && voitToutActif();
const siteVisible = () => moduleActif("demandes_site") && voitLeSite();
// Le bandeau du site public ne se change qu'avec « Modifier les réglages » (Jérémy, 17.11.2026 : Mook ne change pas les bandeaux ; migration 40).
const bandeauVisible = () => moduleActif("bandeau_site") && voitLeSite() && peut("dossiers.ecrire") && peut("reglages.ecrire");
function voitToutActif() {
  if (estSuperAdmin()) return true;
  const m = etat.brut.membres.find((x) => x.user_id === etat.session.id && x.entite_id === etat.entiteId);
  const r = m && etat.brut.roles.find((x) => x.id === m.role_id);
  return !!r && r.portee === "toute";
}

// Écrans ouverts à la personne connectée, groupés comme dans la barre latérale.
function ecrans() {
  const ajd = aujourdhui();
  const enRetard = mesTaches().filter((t) => t.echeance && t.echeance <= ajd).length;
  const si = (ok, item) => (ok ? [item] : []);
  const demandes = siteVisible() ? aTraiter(etat.db.demandes_site || []).length : 0;
  return [
    { titre: tr("Opérations"), items: [{ href: "#/", libelle: tr("Aujourd'hui"), cle: "tableau", icone: "soleil" }, ...si(moduleActif("reservations"), { href: "#/reservations", libelle: tr("Réservations"), cle: "reservations", icone: "reservations" }), { href: "#/taches", libelle: tr("Tâches"), cle: "taches", icone: "taches", badge: enRetard }, ...si(moduleActif("messages"), { href: "#/messages", libelle: tr("Messages"), cle: "messages", icone: "messages" })] },
    { titre: tr("Site"), items: [...si(siteVisible(), { href: "#/demandes", libelle: tr("Demandes du site"), cle: "demandes", icone: "messages", badge: demandes, badgeLibelle: tr("{badge} à traiter", { badge: demandes }) }), ...si(bandeauVisible(), { href: "#/bandeau", libelle: tr("Bandeau du site"), cle: "bandeau", icone: "alerte" })] },
    { titre: tr("Ventes"), items: [{ href: "#/dossiers", libelle: tr("Dossiers"), cle: "dossiers", icone: "dossiers" }, { href: "#/clients", libelle: tr("Clients"), cle: "clients", icone: "clients" }, ...si((peut("finances.voir") && !modeTaxi()) || (peut("partenaires.nets") && modeExcursions()), { href: "#/encaisser", libelle: tr("À encaisser"), cle: "encaisser", icone: "du" }), ...si(fiduciaireAuMenu(), { href: "#/fiduciaire", libelle: tr("Fiduciaire"), cle: "fiduciaire", icone: "reservations" }), ...si(moduleActif("catalogue"), { href: "#/catalogue", libelle: tr("Catalogue"), cle: "catalogue", icone: "catalogue" })] },
    {
      titre: tr("Partenaires"),
      items: si(peut("partenaires.lire") && moduleActif("partenaires"), null).length
        ? [
            { href: "#/partenaires", libelle: tr("Partenaires"), cle: "partenaires", icone: "partenaires" },
            { href: "#/tarifs", libelle: tr("Tarifs"), cle: "tarifs", icone: "tarifs" },
            // Modules « Trajets et règles » et « Dû aux partenaires » : excursions seulement (Taxi n'a ni horaires de bateaux ni dû, tout se paie au chauffeur).
            ...si(moduleActif("trajets"), { href: "#/trajets", libelle: tr("Trajets"), cle: "trajets", icone: "bateau" }),
            ...si(moduleActif("trajets"), { href: "#/regles", libelle: tr("Règles"), cle: "regles", icone: "regles" }),
            ...si(peut("partenaires.nets") && moduleActif("du"), { href: "#/du", libelle: tr("Dû aux partenaires"), cle: "du", icone: "du" }),
          ]
        : [],
    },
    {
      titre: tr("Administration"),
      items: [
        ...si(peut("analytics.voir") && peut("finances.voir"), { href: "#/analyses", libelle: tr("Statistiques"), cle: "analyses", icone: "analyses" }),
        ...si(entitesAnalysables().length > 1, { href: "#/groupe", libelle: tr("Vue d'ensemble"), cle: "groupe", icone: "groupe" }),
        ...si(peut("partenaires.ecrire") || peut("dossiers.ecrire") || peut("clients.ecrire"), { href: "#/a-verifier", libelle: tr("À vérifier"), cle: "a-verifier", icone: "regles" }),
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

const lienEcran = (e, apres) => h("a", { href: e.href, "data-cle": e.cle, class: "lien-ecran", onclick: apres }, icone(e.icone, 20), h("span", null, e.libelle), e.badge ? h("span", { class: "badge", "aria-label": e.badgeLibelle || tr("{badge} en retard", { badge: e.badge }) }, e.badge) : null);
const sections = (liste, apres) => liste.map((s) => h("div", { class: "menu-section" }, h("p", { class: "menu-section-titre" }, s.titre), h("ul", null, s.items.map((e) => h("li", null, lienEcran(e, apres))))));

async function deconnecter() {
  purgerBrouillons();
  await retirerALaDeconnexion(etat.store);
  await etat.store.deconnecter();
  etat.session = null;
  etat.brut = null;
  etat.db = null;
  afficher();
}

// Le nom en bas du menu ouvre « Mon compte » (langue, mot de passe, appareils), pour tout le monde (audit n° 3).
const ouvrirMonCompte = async (apres) => {
  if (apres) apres();
  (await import("./views/compte.mjs")).ouvrirCompte({ deconnecter: etat.store.mode === "supabase" ? deconnecter : null, apresLangue: afficher });
};
function blocCompte(apres) {
  const nom = etat.moi.nom || etat.session.email;
  const initiales = nom.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join("");
  return h("button", { class: "compte", type: "button", title: tr("Mon compte"), "aria-label": tr("Mon compte : {nom}", { nom }), onclick: () => ouvrirMonCompte(apres) }, h("span", { class: "avatar", "aria-hidden": "true" }, initiales), h("span", { class: "compte-texte" }, h("strong", null, nom), roleActif() ? h("span", null, roleActif()) : null));
}
const outilsCompte = (apres) => [
  // La cloche s'ouvre aussi en démonstration : on y règle son « Rappel 1 h avant » (les notifications, elles, demandent la vraie base).
  // Seulement pour l'administratrice de l'entreprise ouverte : la fonction n'envoie les rappels qu'à elle (Jérémy, 17.11.2026).
  estAdmin() ? h("button", { class: "bouton-icone secondaire", type: "button", onclick: async () => (apres && apres(), (await import("./views/rappels.mjs")).ouvrirRappels()), "aria-label": tr("Rappels"), title: tr("Rappels") }, icone("cloche")) : null,
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
    selecteurEntite("menu"),
    h("button", { class: "recherche-bouton", type: "button", onclick: ouvrirRecherche }, icone("recherche", 18), h("span", null, tr("Rechercher")), h("kbd", null, "/")),
    sections(ecrans()),
    h("div", { class: "menu-bas" }, selecteurLangue(), blocCompte(), h("div", { class: "menu-outils" }, outilsCompte()))
  );
}

// Téléphone : l'entreprise et la recherche en haut, quatre onglets en bas.
function barreHaut() {
  const logo = etat.db.reglages.apparence.logo;
  return h("header", { class: "barre-haut" }, logo ? h("img", { class: "barre-logo", src: logo, alt: "" }) : null, selecteurEntite("haut"), h("button", { class: "bouton-icone lien", type: "button", onclick: ouvrirRecherche, "aria-label": tr("Rechercher") }, icone("recherche", 22)));
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
  fermer = modal(tr("Plus"), h("div", { class: "feuille-menu" }, sections(restants, apres), h("div", { class: "feuille-pied" }, selecteurLangue(apres), blocCompte(apres), h("div", { class: "menu-outils" }, outilsCompte(apres)))), { feuille: true });
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
      choix("dossiers", tr("Nouveau dossier"), modeExcursions() ? tr("Un client, un ou plusieurs services") : tr("Un client, un voyage, un devis"), va("#/dossiers/nouveau")),
      moduleActif("demande_collee") ? choix("messages", tr("Coller une demande"), tr("Un message WhatsApp du client devient un dossier"), async () => (fermer(), (await import("./views/demande.mjs")).ouvrirDemande())) : null,
      // Confirmation de course collée (Jérémy, 18.11.2026) : administratrices seulement, dossier et Booking confirmation d'un bouton.
      confirmationPermise() ? choix("whatsapp", tr("Coller une confirmation"), tr("« New booking confirmation » : le dossier et la Booking confirmation, d'un coup"), async () => (fermer(), (await import("./views/confirmation.mjs")).ouvrirConfirmation())) : null
    ),
    { protege: false }
  );
}

// Assistante de Taxi (droit « vouchers.seul ») : un bandeau avec le logo, le choix d'entreprise (elle garde Secret tel quel) et la
// déconnexion, puis l'écran « Nouveau voucher ». Ni menu, ni onglets, ni recherche, ni bouton « + ».
function coqueSimple() {
  const logo = etat.db.reglages.apparence.logo;
  return h(
    "div",
    { class: "coque-simple" },
    h(
      "header",
      { class: "barre-simple" },
      logo ? h("img", { class: "barre-logo", src: logo, alt: "" }) : null,
      selecteurEntite("simple"),
      // Mon compte (mot de passe, appareils), dans la langue de l'interface de la personne : l'outil n'a pas d'interface en thaï.
      h("button", { class: "bouton-icone secondaire", type: "button", onclick: () => ouvrirMonCompte(), "aria-label": tr("Mon compte"), title: tr("Mon compte") }, icone("clients", 18)),
      etat.store.mode === "supabase" ? h("button", { class: "secondaire petit", type: "button", lang: "th", onclick: deconnecter }, icone("deconnexion", 18), "ออกจากระบบ") : null
    ),
    // Les factures pour la fiduciaire sont aussi son travail (Jérémy, 12.11.2026) : deux onglets, le voucher et les factures.
    // Pas d'onglet dans une entreprise qui n'émet pas de factures pour la fiduciaire (Taxi, 17.11.2026).
    peut("fiduciaire.preparer") && reglagesFid(etat.db.reglages).actif
      ? h("nav", { class: "onglets-simple", lang: "th", "aria-label": "เมนู" }, h("a", { href: "#/", "data-ecran": "voucher" }, "วอยเชอร์"), h("a", { href: "#/fiduciaire", "data-ecran": "fiduciaire" }, "ใบแจ้งหนี้"))
      : null,
    h("div", { class: "contenu-simple" }, etat.store.mode === "demo" ? bandeauDemo() : null, h("main", { id: "principal", tabindex: "-1" }))
  );
}

// Fiduciaire au menu : dans une entreprise qui émet ces factures (Secret) ; dans une autre (Taxi, 17.11.2026), seulement pour qui peut la réactiver.
// Taxi n'émet pas de factures pour la fiduciaire (décision 5) : l'entrée sort du menu tant qu'elle n'y est pas réactivée, ce qui se fait depuis les
// Réglages (onglet « Écrans », contrôle du 17.11.2026, D10).
const fiduciaireAuMenu = () => peut("fiduciaire.preparer") && moduleActif("fiduciaire") && (reglagesFid(etat.db.reglages).actif || (!modeTaxi() && peut("fiduciaire.gerer") && peut("reglages.ecrire")));

// Écrans propres à un module (modules.mjs) : fermés si le module n'existe pas ou est masqué pour cette entreprise.
function ecranDeLEntreprise(cle) {
  if (cle === "demandes") return siteVisible();
  if (cle === "bandeau") return bandeauVisible();
  const m = moduleDeLEcran(cle);
  return !m || moduleActif(m.id);
}

async function afficherVoucherSeul() {
  // Chaque affichage repart de l'entreprise Taxi (logo VIP Taxi Lanta par défaut, 18.11.2026) : un voucher en cours sous le logo de Secret
  // marque l'écran occupé, la relecture automatique ne le redessine pas.
  if (etat.voucherDepuis) travaillerPourVoucher(etat.voucherDepuis);
  const cle = `simple|${etat.entiteId}|${etat.session.id}`;
  const existante = racine.querySelector(".coque-simple");
  if (!existante || existante.dataset.cle !== cle) {
    vider(racine).append(coqueSimple());
    racine.querySelector(".coque-simple").dataset.cle = cle;
  }
  // Deux écrans possibles : le voucher, et les factures pour la fiduciaire avec le droit « fiduciaire.preparer ».
  // Une adresse d'un autre écran (lien, favori) ramène au voucher sans rien ouvrir d'autre.
  const factures = location.hash === "#/fiduciaire" && peut("fiduciaire.preparer") && reglagesFid(etat.db.reglages).actif;
  if (!factures && location.hash && location.hash !== "#/") history.replaceState(null, "", "#/");
  for (const a of racine.querySelectorAll(".onglets-simple a")) a.setAttribute("aria-current", (a.dataset.ecran === "fiduciaire") === factures ? "page" : "false");
  const moi = ++rendu;
  const noeud = factures ? await (await import("./views/fiduciaire.mjs")).vueFiduciaire() : (await import("./views/voucher-rapide.mjs")).vueVoucherRapide();
  if (moi !== rendu) return;
  document.getElementById("principal").replaceChildren(noeud);
  document.title = `${noeud.dataset.titre} - ${entiteActive().nom}`;
  derniereVue = factures ? "#/fiduciaire" : "#/";
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
// « Coller une confirmation » dans la recherche : une fenêtre, pas un écran (pas d'adresse, jamais dans les récents).
const ouvrirConfirmation = async () => (await import("./views/confirmation.mjs")).ouvrirConfirmation();
const actionConfirmation = () => ({ groupe: tr("Actions"), icone: "whatsapp", titre: tr("Coller une confirmation"), detail: tr("Dossier et Booking confirmation d'une confirmation de course"), href: "", action: ouvrirConfirmation });
// Tous les mots saisis doivent apparaître. Sans saisie : les récents, les derniers dossiers et la liste des écrans.
function chercher(q) {
  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  const correspond = (texte) => mots.every((m) => texte.includes(m));
  if (!mots.length) {
    const recents = lireRecents().map((r) => ({ ...r, groupe: tr("Récents") }));
    const dejaVus = new Set(recents.map((r) => r.href));
    const derniers = resumes().sort((a, b) => b.dossier.created_at.localeCompare(a.dossier.created_at)).slice(0, 5).map(resultatDossier).filter((r) => !dejaVus.has(r.href));
    const action = [...(peut("dossiers.ecrire") ? [{ groupe: tr("Actions"), icone: "ajouter", titre: tr("Nouveau dossier"), href: "#/dossiers/nouveau" }] : []), ...(confirmationPermise() ? [actionConfirmation()] : [])];
    return [...recents, ...action, ...derniers, ...tousEcrans().map(resultatEcran)];
  }
  const out = [];
  if (peut("dossiers.ecrire") && mots.every((m) => sansAccents(tr("Nouveau dossier")).includes(m))) out.push({ groupe: tr("Actions"), icone: "ajouter", titre: tr("Nouveau dossier"), href: "#/dossiers/nouveau" });
  if (confirmationPermise() && mots.every((m) => sansAccents(`${tr("Coller une confirmation")} booking taxi`).includes(m))) out.push(actionConfirmation());
  resumes()
    .filter((r) => correspond(sansAccents(`${nomClient(r.client)} ${r.dossier.ref} ${r.dossier.pays} ${r.dossier.bandeau}`)))
    .sort((a, b) => b.dossier.created_at.localeCompare(a.dossier.created_at))
    .slice(0, 6)
    .forEach((r) => out.push(resultatDossier(r)));
  // Les fiches d'ici, puis celles qu'une autre entreprise partage (ZTP dans Secret et Taxi), avec le sigle de leur entreprise.
  clientsProposes()
    .filter((c) => correspond(sansAccents(`${nomClient(c)} ${c.telephone} ${c.email} ${c.adresse}`)))
    .sort((a, b) => Number(clientEtranger(a)) - Number(clientEtranger(b)))
    .slice(0, 6)
    .forEach((c) => out.push({ groupe: tr("Clients"), icone: "clients", titre: nomClient(c), detail: [c.telephone, (c.adresse || "").split("\n").filter(Boolean).pop()].filter(Boolean).join(" · "), droite: etiquetteClient(c), href: `#/client/${c.id}` }));
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
    if (moduleActif("trajets")) for (const t of etat.db.trajets) if (correspond(sansAccents(`${t.de} ${t.vers} ${nomPartenaire(t.partenaire_id)}`))) paires.set(`${t.de}|${t.vers}`, (paires.get(`${t.de}|${t.vers}`) || 0) + 1);
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
    fermer();
    // Une action qui ouvre une fenêtre (« Coller une confirmation ») plutôt qu'un écran.
    if (r.action) return void r.action();
    noterRecent(r);
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
window.matchMedia("(min-width: 720px)").addEventListener("change", (e) => e.matches && document.querySelectorAll("details.filtres-plus").forEach((d) => (d.open = true)));

let rendu = 0;
async function afficher() {
  if (!etat.session) {
    vider(racine).append(vueConnexion());
    document.title = tr("Connexion - Gestion");
    return;
  }
  // Lien d'invitation ou de mot de passe oublié : la session est ouverte, la personne choisit son mot de passe avant tout autre écran.
  if (etat.retour.type) {
    const { vueNouveauMotDePasse } = await import("./views/compte.mjs");
    vider(racine).append(vueNouveauMotDePasse(etat.retour.type, () => ((etat.retour = { type: null, erreur: null }), history.replaceState(null, "", "#/"), afficher())));
    document.title = tr("Mot de passe - Gestion");
    return;
  }
  if (!entiteActive()) {
    vider(racine).append(
      h(
        "div",
        { class: "connexion" },
        selecteurLangue(),
        h("h1", null, etat.moi && etat.moi.super_admin ? tr("Votre première entreprise") : etat.moi && etat.moi.plateforme ? tr("Clients") : tr("Aucun accès pour l'instant")),
        etat.moi && etat.moi.super_admin
          ? h("p", { class: "sous" }, tr("Bienvenue. Créez votre première entreprise pour commencer : choisissez votre type d'activité, vous compléterez ensuite ses réglages."))
          : etat.moi && etat.moi.plateforme
            ? h("p", { class: "sous" }, tr("Compte éditeur : vous créez ici l'organisation d'un nouveau client et son administrateur. Vous ne voyez aucune de leurs données."))
            : h("p", { class: "sous" }, tr("Votre compte ({email}) n'a pas encore accès à une entreprise. Demandez à l'administratrice de vous en donner un.", { email: etat.session.email })),
        // Nouveau client (migration 42) : son administrateur crée sa première entreprise ici ; l'éditeur crée les clients.
        etat.moi && etat.moi.super_admin
          ? h("button", { class: "principal", type: "button", onclick: async () => (await import("./views/admin.mjs")).nouvelleEntiteModal(() => { const e = etat.brut.entites[etat.brut.entites.length - 1]; if (e) changerEntite(e.id); afficher(); }) }, tr("Créer votre première entreprise"))
          : null,
        etat.moi && etat.moi.plateforme ? h("button", { class: "principal", type: "button", onclick: async () => (await import("./views/admin.mjs")).nouveauClientModal(() => afficher()) }, tr("Nouveau client")) : null,
        etat.moi && etat.moi.plateforme ? listeClientsPlateforme({ apres: () => afficher() }) : null,
        etat.store.mode === "demo" ? bandeauDemo() : null,
        etat.store.mode === "supabase" ? h("button", { class: "secondaire", type: "button", onclick: async () => (await etat.store.deconnecter(), (etat.session = null), afficher()) }, tr("Se déconnecter")) : null
      )
    );
    document.title = tr("Aucun accès - Gestion");
    return;
  }
  // Une notification ouvre l'écran dans l'entreprise qu'elle concerne (« ?entite=… ») : on y passe si la personne y a accès.
  const entiteDemandee = new URLSearchParams(location.hash.split("?")[1] || "").get("entite");
  if (entiteDemandee && entiteDemandee !== etat.entiteId && entitesAccessibles().some((e) => e.id === entiteDemandee)) changerEntite(entiteDemandee, { naviguer: false });
  if (ecranVoucherSeul()) return afficherVoucherSeul();
  // Le menu dépend de l'entreprise active, des droits et des modules allumés (Réglages, Écrans) : on le refait quand l'un d'eux change.
  // Ses badges, eux, suivent à chaque affichage (majBadges).
  const cle = `${etat.entiteId}|${roleActif()}|${etat.session.id}|${langueActive()}|${MODULES.filter((m) => moduleActif(m.id)).map((m) => m.id).join(",")}|${fiduciaireAuMenu()}`;
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
  // Une adresse tapée, un favori ou un raccourci n'ouvrent pas un écran que l'entreprise active n'a pas (Jérémy, 12.11.2026).
  if (!ecranDeLEntreprise(cleRoute)) {
    location.replace("#/");
    return;
  }
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
  majBadges();
}

// Badges du menu, des onglets et de « Plus » remis à jour sur place à chaque affichage : une demande du site arrivée à la synchronisation,
// une demande confirmée ou une tâche cochée changent le chiffre sans refaire tout le menu.
function majBadges() {
  const tous = tousEcrans();
  const poser = (lien, n, libelle) => {
    let b = lien.querySelector(".badge");
    if (!n) return void (b && b.remove());
    if (!b) {
      b = h("span", { class: "badge" });
      (lien.querySelector(".onglet-icone") || lien).append(b);
    }
    b.textContent = n;
    if (libelle) b.setAttribute("aria-label", libelle);
  };
  for (const e of tous) for (const a of document.querySelectorAll(`[data-cle="${e.cle}"]`)) poser(a, e.badge || 0, a.classList.contains("lien-ecran") && e.badge ? e.badgeLibelle || tr("{badge} en retard", { badge: e.badge }) : null);
  const onglets = ongletsMobiles();
  const plus = document.querySelector('button[data-cle="plus"]');
  if (plus) poser(plus, tous.filter((e) => !onglets.includes(e.cle)).reduce((n, e) => n + (e.badge || 0), 0), null);
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
      tableau([ligne(["?"], N_("Afficher cette aide")), ligne(["n"], N_("Nouveau dossier")), confirmationPermise() ? ligne(["b"], N_("Coller une confirmation (Booking confirmation)")) : null, ligne(["/"], N_("Rechercher un client, un dossier ou un écran")), ligne([`${mod}+K`], N_("Rechercher (aussi dans un champ)")), ligne(["g", "t"], N_("Aujourd'hui")), ligne(["g", "d"], N_("Dossiers")), ligne(["g", "c"], N_("Clients")), moduleActif("catalogue") ? ligne(["g", "k"], N_("Catalogue")) : null, ligne(["g", "f"], N_("Tâches")), ligne(["g", "v"], N_("Vue d'ensemble des sociétés")), ligne(["g", "r"], N_("Réglages (administrateurs)")), ligne(["g", "a"], N_("Analyses")), ligne(["g", "j"], N_("Journal d'activité")), ligne(["g", "m"], N_("Administration (administratrice générale)")), ligne([tr("Échap")], N_("Fermer une fenêtre"))]),
      // Taxi n'ouvre aucun document à modifier ; Secret n'a que des factures.
      modeTaxi() ? null : h("h3", null, modeExcursions() ? tr("Dans une facture") : tr("Dans un devis ou une facture")),
      modeTaxi() ? null : tableau([ligne([`${mod}+Z`], N_("Annuler la dernière modification")), ligne([`${mod}+${tr("Maj")}+Z`], mac ? N_("Rétablir") : N_("Rétablir (ou Ctrl+Y)")), ligne([`${mod}+S`], N_("Enregistrer tout de suite")), ligne([`${mod}+P`], N_("Télécharger le PDF"))]),
      h("p", { class: "aide" }, tr("Les raccourcis propres au navigateur, comme Ctrl+T, Ctrl+W ou Ctrl+N, ne peuvent pas être pris en charge par un site. Les autres sont désactivés pendant la saisie dans un champ pour ne pas gêner l'écriture."))
    )
  );
}

// Raccourcis simples, actifs seulement quand on n'écrit pas dans un champ et qu'aucune fenêtre n'est ouverte.
let sequence = null;
document.addEventListener("keydown", (e) => {
  if (!etat.session || !etat.db || ecranVoucherSeul()) return;
  const k = e.key.toLowerCase();
  // Ctrl+K (Cmd+K sur Mac) ouvre la recherche partout, même pendant une saisie.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && k === "k" && !document.querySelector(".modal-fond")) return e.preventDefault(), ouvrirRecherche();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.target && e.target.matches && e.target.matches("input, textarea, select, [contenteditable]")) || document.querySelector(".modal-fond")) return;
  if (sequence === "g") {
    sequence = null;
    const cibles = { t: "#/", d: "#/dossiers", c: "#/clients", ...(moduleActif("catalogue") ? { k: "#/catalogue" } : {}), f: "#/taches", ...(estAdmin() ? { r: "#/reglages" } : {}), ...(peut("journal.voir") ? { j: "#/journal" } : {}), ...(peut("analytics.voir") && peut("finances.voir") ? { a: "#/analyses" } : {}), ...(entitesAnalysables().length > 1 ? { v: "#/groupe" } : {}), ...(estSuperAdmin() ? { m: "#/admin" } : {}) };
    if (cibles[k]) (e.preventDefault(), (location.hash = cibles[k]));
    return;
  }
  if (k === "g") {
    sequence = "g";
    setTimeout(() => (sequence = null), 1200);
  } else if (k === "n") (e.preventDefault(), (location.hash = "#/dossiers/nouveau"));
  else if (k === "b" && confirmationPermise()) (e.preventDefault(), ouvrirConfirmation());
  else if (k === "?") (e.preventDefault(), ouvrirAide());
  else if (k === "/") (e.preventDefault(), ouvrirRecherche());
});

// Un écran qui a des modifications non enregistrées pose `etat.garde` (Réglages, audit n° 38). Quitter par le menu, la recherche, un raccourci ou
// le bouton retour demande d'abord ; « Rester » remet l'adresse de l'écran ouvert sans le redessiner.
async function peutQuitter() {
  if (!etat.garde || !etat.garde()) return true;
  const { confirmer } = await import("./ui.mjs");
  const ok = await confirmer(tr("Les réglages modifiés ne sont pas enregistrés. Quitter sans enregistrer ?"), tr("Quitter sans enregistrer"), true, tr("Rester"));
  if (ok) etat.garde = null;
  return ok;
}
let retourEnCours = false;
window.addEventListener("hashchange", async () => {
  if (retourEnCours) return void (retourEnCours = false);
  if (etat.garde && derniereVue && location.hash !== derniereVue && !(await peutQuitter())) {
    retourEnCours = true;
    location.replace(derniereVue);
    return;
  }
  etat.garde = null;
  afficher();
});

// L'outil reste ouvert des journées entières dans un onglet : quand une nouvelle version est publiée, un bandeau
// propose de recharger, sinon l'ancien code tourne jusqu'au prochain rechargement complet.
// Identifiant de la version en ligne : gestion/version.json, écrit au build avec l'empreinte de TOUS les fichiers de l'outil (.eleventy.js).
// Sans ce fichier (prévisualisation locale), l'ETag de app.mjs comme avant. Lu sans cache (Netlify sert /gestion/* en no-cache).
async function empreinteVersion() {
  try {
    const r = await fetch("version.json", { cache: "no-store" });
    if (r.ok) {
      const v = await r.json().catch(() => null);
      if (v && typeof v.version === "string" && v.version) return `v:${v.version}`;
    }
  } catch {
    // réseau absent : rien à comparer cette fois-ci
  }
  try {
    const r = await fetch("js/app.mjs", { method: "HEAD", cache: "no-store" });
    return r.ok ? r.headers.get("etag") || r.headers.get("last-modified") || "" : "";
  } catch {
    return "";
  }
}
let empreinteInitiale = "";
async function versionDisponible() {
  if (!empreinteInitiale) return false;
  const actuelle = await empreinteVersion();
  // Seulement deux empreintes de même nature : un version.json manqué une fois (réseau) ne doit pas faire comparer un ETag à une version.
  return !!actuelle && actuelle.startsWith("v:") === empreinteInitiale.startsWith("v:") && actuelle !== empreinteInitiale;
}
// Une nouvelle version est en ligne : l'outil se recharge tout seul au premier moment sûr (momentDeRecharger, direct-calc.mjs), en gardant
// l'écran et le dossier ouverts (l'adresse et l'entreprise restent). Pendant une saisie, le bandeau « Nouvelle version de Gestion » reste
// et le rechargement attend que la saisie soit enregistrée ou abandonnée. Jamais de perte de saisie.
let versionSignalee = false;
let derniereActivite = Date.now();
let enSaisie = false;
let finSaisie = 0;
for (const ev of ["pointerdown", "keydown", "input", "wheel", "touchstart", "scroll"]) window.addEventListener(ev, () => (derniereActivite = Date.now()), { capture: true, passive: true });
// Pour recharger, plus prudent que pour redessiner : une liste, un bouton radio ou une case changés et pas encore enregistrés comptent aussi
// (le logo et le chauffeur choisis dans « Nouveau voucher », sans texte tapé).
const choixModifies = () => {
  const principal = document.getElementById("principal");
  if (!principal) return false;
  return [...principal.querySelectorAll("select")].some((s) => [...s.options].some((o) => o.selected !== o.defaultSelected)) || [...principal.querySelectorAll("input[type=checkbox], input[type=radio]")].some((c) => c.checked !== c.defaultChecked);
};
function rechargerSiSur({ retour = false } = {}) {
  if (!versionSignalee) return false;
  // Un écran de saisie (nouveau dossier, éditeur de document, réglages) compte comme une saisie tant qu'on y est. Le rechargement attend
  // qu'on le quitte (enregistré ou abandonné).
  const saisie = saisieEnCours() || choixModifies() || !ecranDeLecture(location.hash) || !!(etat.garde && etat.garde());
  // « Juste après une saisie » : les trente secondes qui suivent sa fin, pas pour toute la suite de la journée.
  if (enSaisie && !saisie) finSaisie = Date.now();
  enSaisie = saisie;
  const apresSaisie = !!finSaisie && Date.now() - finSaisie < 30 * 1000;
  const ok = momentDeRecharger({ nouvelle: true, saisie, cache: document.visibilityState === "hidden", retour, inactifMs: Date.now() - derniereActivite, apresSaisie });
  if (ok) location.reload();
  return ok;
}
// Le bouton du bandeau, pour qui ne veut pas attendre : une saisie en cours fait d'abord poser la question.
function signalerVersion({ retour = false } = {}) {
  if (versionSignalee) return;
  versionSignalee = true;
  setInterval(() => rechargerSiSur(), 2000);
  if (rechargerSiSur({ retour })) return;
  const recharger = async () => {
    if (saisieEnCours()) {
      const { confirmer } = await import("./ui.mjs");
      const ok = await confirmer(tr("Une saisie est en cours : elle sera perdue si vous rechargez maintenant. Recharger quand même ?"), tr("Recharger quand même"), true, tr("Plus tard"));
      if (!ok) return;
    }
    location.reload();
  };
  document.body.append(h("div", { class: "bandeau-version", role: "status" }, h("span", null, tr("Nouvelle version de Gestion : rechargez pour l'avoir.")), h("button", { class: "principal petit", type: "button", onclick: recharger }, tr("Recharger"))));
}
// Vérifiée au retour sur l'onglet et toutes les 3 minutes, onglet caché compris.
async function surveillerVersion() {
  const initiale = await empreinteVersion();
  empreinteInitiale = initiale;
  if (!initiale) return;
  // Onglet caché aussi : une nouvelle version s'y installe sans que personne ne la voie arriver.
  const verifier = async (e) => {
    const retour = !!e && e.type === "visibilitychange" && document.visibilityState === "visible";
    if (versionSignalee) return void rechargerSiSur({ retour });
    if (await versionDisponible()) signalerVersion({ retour });
  };
  document.addEventListener("visibilitychange", verifier);
  setInterval(verifier, 3 * 60 * 1000);
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
// La liste des écrans de lecture est dans direct-calc.mjs (Demandes du site y compris, 19.11.2026).
// Une demande du site arrivée se dit comme telle (« Nouvelle demande du site. »), sans le chiffre devant quand il n'y en a qu'une.
const annoncerArrivees = (n) => toast(n > 1 ? tr("{n} nouvelles demandes du site.", { n }) : tr("Nouvelle demande du site."));
// Demandes du site à traiter dans l'entreprise affichée (pour annoncer une arrivée).
const demandesATraiter = () => ({ entite: etat.entiteId, ids: etat.db && siteVisible() ? aTraiter(etat.db.demandes_site || []).map((d) => d.id) : [] });
// Une fenêtre ouverte, un champ en cours de saisie ou une saisie pas encore enregistrée : rien ne doit être redessiné ni déclenché par-dessus.
function saisieEnCours() {
  if (document.querySelector(".modal-fond")) return true;
  // Écran « Nouveau voucher » : aperçu, envoi ou correction en cours (attribut posé par l'écran lui-même).
  if (document.querySelector("#principal [data-occupe]")) return true;
  const actif = document.activeElement;
  if (actif && actif.matches("input, textarea, select, [contenteditable]")) return true;
  const principal = document.getElementById("principal");
  return !!principal && [...principal.querySelectorAll("input, textarea")].some((c) => !["checkbox", "radio", "button", "submit"].includes(c.type) && c.value !== c.defaultValue);
}
function ecranLibre() {
  return ecranDeLecture(location.hash) && !saisieEnCours();
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
  // Hors connexion : annoncé tout de suite par le navigateur (avion, tunnel), sans attendre deux relectures ratées.
  // L'outil n'enregistre rien sans réseau : on le dit, pour qu'une saisie ne soit pas crue sauvée.
  let hors = typeof navigator !== "undefined" && navigator.onLine === false;
  const majPastille = () => {
    pastille.hidden = !hors && echecs < 2;
    if (hors) pastille.textContent = tr("Hors connexion : l'écran montre les données telles qu'elles étaient, et rien ne s'enregistre tant que le réseau n'est pas revenu.");
    else if (echecs >= 2) pastille.textContent = tr("Connexion perdue : les données affichées datent de {duree}. Elles se mettent à jour dès que le réseau revient.", { duree: pluriel(Math.max(1, Math.round((Date.now() - derniereReussite) / 60000)), N_("minute"), N_("minutes")) });
  };
  // `force` : actualisation demandée par la personne (tirer pour actualiser), sans attendre les dix secondes ni la visibilité de l'onglet.
  // Elle renvoie ce qui s'est passé pour que l'écran le dise.
  const actualiser = async (force = false) => {
    if (!force && (document.visibilityState !== "visible" || Date.now() - derniere < 10000)) return null;
    derniere = Date.now();
    let resultat = "ignore";
    let erreur = null;
    const demandesAvant = demandesATraiter();
    try {
      resultat = await synchroniser();
      if (resultat !== "ignore") (echecs = 0), (derniereReussite = Date.now());
      if (resultat === "modifie" || resultat === "propre") aRedessiner = true;
      if (resultat === "modifie") annoncer = true;
    } catch (err) {
      console.warn(err);
      echecs++;
      erreur = err;
    }
    majPastille();
    // Le compteur des demandes du site, des tâches et des retards suit chaque relecture, même quand l'écran ne peut pas être redessiné
    // (une saisie en cours) : avant le 19.11.2026, il fallait rafraîchir la page pour le voir changer.
    if (etat.session && document.querySelector(".coque")) majBadges();
    const arrivees = resultat === "modifie" ? nouvellesDemandes(demandesAvant, demandesATraiter()) : 0;
    if (aRedessiner && etat.session && ecranLibre()) {
      aRedessiner = false;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      // Une demande du site arrivée se dit comme telle ; un autre changement reste « Données mises à jour ».
      if (arrivees) annoncerArrivees(arrivees);
      else if (annoncer && !force) toast(tr("Données mises à jour."));
      annoncer = false;
    } else if (arrivees) annoncerArrivees(arrivees);
    return { resultat, erreur };
  };
  // Un redessin retenu par une saisie (fenêtre ouverte, champ en cours) se fait dès qu'elle est finie, sans attendre la relecture suivante.
  setInterval(() => {
    if (!aRedessiner || !etat.session || !ecranLibre()) return;
    aRedessiner = false;
    annoncer = false;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, 2000);
  // En direct (Supabase Realtime, migration 47) : une ligne ajoutée ou changée dans une table suivie fait relire la base tout de suite, avec les
  // droits de la personne (la base ne prévient que celles qui peuvent lire la ligne, et la relecture passe par les mêmes règles).
  // Plusieurs événements rapprochés ne font qu'une relecture.
  let attente = null;
  const changementDistant = () => {
    clearTimeout(attente);
    attente = setTimeout(() => ((derniere = 0), actualiser(true)), 800);
  };
  if (etat.store.ecouter) {
    try {
      etat.store.ecouter(TABLES_EN_DIRECT, changementDistant);
    } catch (err) {
      // Pas de direct (réseau, migration 47 pas appliquée) : la relecture de chaque minute reste.
      console.warn(err);
    }
  }
  document.addEventListener("visibilitychange", () => actualiser());
  window.addEventListener("online", () => ((hors = false), majPastille(), actualiser()));
  window.addEventListener("offline", () => ((hors = true), majPastille()));
  majPastille();
  setInterval(() => actualiser(), 60 * 1000);
  return actualiser;
}

// Tirer pour actualiser : seulement dans l'application installée sur l'écran d'accueil (Safari y offre ce geste dans l'onglet, pas dans l'application).
// Le module ne se charge que là. Une nouvelle version de l'outil recharge la page ; sinon les données sont relues sans recharger.
const installee = () => window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
function installerTirer(actualiser) {
  if (!installee() || !("ontouchstart" in window)) return;
  import("./tirer.mjs").then(({ installerTirer: installer }) =>
    installer({
      bloque: () => !etat.session || saisieEnCours(),
      actualiser: async () => {
        const [nouvelle, lecture] = await Promise.all([versionDisponible(), actualiser(true)]);
        if (nouvelle) return { rechargement: true };
        return { ...(lecture || { resultat: "ignore" }), demo: etat.store.mode !== "supabase" };
      },
    })
  );
}

init()
  .then(afficher)
  // Repère de mesure : le premier écran est affiché et utilisable (temps d'ouverture, voir docs/gestion/mise-en-route.md).
  .then(() => performance.mark && performance.mark("gestion-pret"))
  // Le service worker (rappels, page hors connexion, fichiers regroupés gardés) s'installe pour tout le monde, après le premier écran.
  // Avant le 19.11.2026, seulement en activant les rappels : les autres rechargeaient tout à chaque ouverture.
  .then(() => { if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {}); })
  .then(surveillerVersion)
  .then(surveillerDonnees)
  .then(installerTirer)
  .catch((err) => {
    console.error(err);
    // Réseau absent et copie de la feuille du jour sur ce téléphone : on l'affiche en lecture seule au lieu de l'écran d'erreur.
    try {
      if (localStorage.getItem(CLE_HORS_LIGNE) && (navigator.onLine === false || /failed to fetch|networkerror|load failed|network/i.test(String(err && err.message)))) return void location.replace("hors-ligne.html");
    } catch {}
    vider(racine).append(h("div", { class: "vide" }, h("h1", null, tr("Connexion à la base impossible")), h("p", null, err.message), h("button", { class: "principal", onclick: () => location.reload() }, tr("Réessayer"))));
  });
