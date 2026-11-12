import { etat, resumes, inserer, modifier, nomClient, naviguer, reglages, peut, equipe, modeExcursions, modeTaxi, numeroSuivant } from "../etat.mjs";
import { nouveauDossierExcursions } from "./nouveau-excursions.mjs";
import { ouvrirDemande } from "./demande.mjs";
import { h, champ, vider, toast, erreurChamp } from "../ui.mjs";
import { identiteDepuisSaisie, verifierNouveauClient } from "../client-calc.mjs";
import { formatMontant, formatDate, aujourdhui, nouvelleRef, sequenceRef, refDepuisNumero, periodeTexte, STATUTS } from "../calc.mjs";
import { CONTENU_DEFAUT } from "../defauts.mjs";
import { pastille, vide, voyageTexte, cartes, sousTitreDossier, barreFiltres } from "./commun.mjs";
import { selecteurClient } from "./selecteur-client.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

const ONGLETS = [
  ["cours", N_("En cours"), ["brouillon", "devis_envoye", "accepte", "acompte"]],
  ["soldes", N_("Soldés"), ["solde", "sur_place"]],
  ["annules", N_("Annulés"), ["annule"]],
  ["sans_suite", N_("Sans suite"), ["sans_suite"]],
  ["encaisser", N_("À encaisser"), ["accepte", "acompte"]],
  ["attente", N_("Devis en attente"), ["devis_envoye"]],
  ["tous", N_("Tous"), Object.keys(STATUTS)],
];
// Taxi : tout est payé au chauffeur, chaque dossier serait « soldé ». On range les courses par date plutôt que par paiement.
const finCourse = (r) => r.dossier.date_retour || r.dossier.date_depart || null;
const ONGLETS_TAXI = [
  ["cours", N_("À venir"), (r, ajd) => r.statut !== "annule" && (!finCourse(r) || finCourse(r) >= ajd)],
  ["passees", N_("Passées"), (r, ajd) => r.statut !== "annule" && !!finCourse(r) && finCourse(r) < ajd],
  ["annules", N_("Annulés"), (r) => r.statut === "annule"],
  ["tous", N_("Tous"), () => true],
];
const ongletsActifs = () => (modeTaxi() ? ONGLETS_TAXI : ONGLETS);

const TRIS = [
  ["recents", N_("Plus récents")],
  ["depart", N_("Départ le plus proche")],
  ["reste", N_("Reste à encaisser")],
  ["client", N_("Client (A à Z)")],
];
// Ordre des dossiers : sans date de départ ou sans reste, ils passent après les autres.
const COMPARE = {
  recents: (a, b) => (a.dossier.created_at < b.dossier.created_at ? 1 : -1),
  depart: (a, b) => (a.dossier.date_depart || "9999").localeCompare(b.dossier.date_depart || "9999") || COMPARE.recents(a, b),
  reste: (a, b) => (b.reste > 0 ? b.reste : 0) - (a.reste > 0 ? a.reste : 0) || COMPARE.recents(a, b),
  client: (a, b) => nomClient(a.client).localeCompare(nomClient(b.client)) || COMPARE.recents(a, b),
};

// Valeurs enregistrées en français dans les réglages (civilités, nom du champ « pays ») : on traduit seulement l'affichage.
const _AFFICHAGE = [N_("Madame"), N_("Monsieur"), N_("Mademoiselle"), N_("Pays"), N_("Service"), N_("Trajet")];

const filtre = { onglet: "cours", q: "", tri: "recents" };
const PAGE = 50;
// Dossiers cochés pour une action groupée (changer de responsable).
const selection = new Set();
const sansAccents = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function listeDossiers() {
  selection.clear();
  // Un lien du tableau de bord ouvre directement le bon onglet (#/dossiers?onglet=encaisser).
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  if (ongletsActifs().some(([k]) => k === params.get("onglet"))) { filtre.onglet = params.get("onglet"); filtre.q = ""; }
  if (COMPARE[params.get("tri")]) filtre.tri = params.get("tri");
  const corps = h("div");
  const groupee = peut("dossiers.ecrire");
  const barre = h("div", { class: "barre-selection", hidden: true });
  const majBarre = () => {
    barre.hidden = selection.size === 0;
    if (barre.hidden) return;
    const sel = h("select", { id: "attrib-resp", "aria-label": tr("Nouveau responsable") }, h("option", { value: "" }, tr("Choisir un responsable…")));
    equipe().then((gens) => gens.forEach((p) => sel.append(h("option", { value: p.user_id }, p.nom || p.email))));
    barre.replaceChildren(
      h("strong", null, pluriel(selection.size, N_("{n} dossier sélectionné"), N_("{n} dossiers sélectionnés"))),
      sel,
      h("button", { class: "principal petit", type: "button", onclick: async () => {
        if (!sel.value) return toast(tr("Choisissez d'abord un responsable."), true);
        let n = 0;
        for (const id of [...selection]) { try { await modifier("dossiers", id, { responsable_id: sel.value }); n++; } catch (err) { toast(tr("Un dossier n'a pas pu être modifié : {message}", { message: err.message }), true); } }
        selection.clear();
        toast(tr("Responsable changé pour {dossiers}.", { dossiers: pluriel(n, N_("dossier"), N_("dossiers")) }));
        majBarre();
        dessiner();
      } }, tr("Attribuer")),
      h("button", { class: "lien", type: "button", onclick: () => (selection.clear(), majBarre(), dessiner()) }, tr("Tout désélectionner"))
    );
  };
  let limite = PAGE;
  function dessiner() {
    // Une recherche porte sur tous les dossiers : un dossier soldé ou annulé ne doit pas devenir introuvable parce qu'un autre onglet est ouvert.
    const onglet = ongletsActifs().find(([k]) => k === filtre.onglet) || ongletsActifs()[0];
    const ajd = aujourdhui();
    const garde = (r) => (typeof onglet[2] === "function" ? onglet[2](r, ajd) : onglet[2].includes(r.statut));
    const q = sansAccents(filtre.q);
    const lignes = resumes()
      .filter((r) => (q ? true : garde(r)))
      .filter((r) => !q || sansAccents(`${nomClient(r.client)} ${r.dossier.ref} ${r.dossier.pays}`).includes(q))
      .sort(COMPARE[filtre.tri]);
    vider(corps);
    corps.append(...(q && filtre.onglet !== "tous" ? [h("p", { class: "aide", role: "status" }, tr("La recherche porte sur tous les dossiers, quel que soit l'onglet."))] : []));
    if (!lignes.length) {
      corps.append(
        etat.db.dossiers.length
          ? vide(tr("Aucun dossier ne correspond"), tr("Essayez un autre onglet ou effacez la recherche."))
          : vide(tr("Aucun dossier pour l'instant"), tr("Un dossier regroupe le client, le voyage, le devis, la facture et les paiements."), peut("dossiers.ecrire") ? h("a", { class: "bouton principal", href: "#/dossiers/nouveau" }, tr("Créer le premier dossier")) : null)
      );
      return;
    }
    const cocher = (r) => h("label", { class: "case-zone" }, h("input", { type: "checkbox", "aria-label": tr("Sélectionner {nomClient}", { nomClient: nomClient(r.client) }), checked: selection.has(r.dossier.id), onchange: (e) => { if (e.target.checked) selection.add(r.dossier.id); else selection.delete(r.dossier.id); majBarre(); } }));
    corps.append(
      cartes(lignes.slice(0, limite), (r) => [
        groupee ? cocher(r) : null,
        h(
          "a",
          { class: "carte-lien", href: `#/dossier/${r.dossier.id}` },
          h("span", { class: "carte-titre" }, nomClient(r.client)),
          h("span", { class: "carte-droite" }, h("strong", null, r.total ? formatMontant(r.total, r.devise) : "—"), r.total && r.reste > 0 && r.statut !== "annule" ? h("span", null, tr("reste {montant}", { montant: formatMontant(r.reste, r.devise) })) : null),
          h("span", { class: "carte-sous" }, sousTitreDossier(r.dossier)),
          h("span", { class: "carte-pied" }, pastille(r.statut), r.dossier.date_depart ? h("span", { class: "ref" }, tr("Départ {date}", { date: formatDate(r.dossier.date_depart) })) : null)
        ),
      ]),
      h(
        "table",
        { class: "tableau tableau-dossiers seulement-bureau" },
        h("thead", null, h("tr", null, groupee ? h("th", { class: "case-cellule", scope: "col" }, h("label", { class: "case-zone" }, h("input", { type: "checkbox", "aria-label": tr("Sélectionner les dossiers affichés"), checked: lignes.slice(0, limite).every((r) => selection.has(r.dossier.id)), onchange: (e) => { lignes.slice(0, limite).forEach((r) => (e.target.checked ? selection.add(r.dossier.id) : selection.delete(r.dossier.id))); majBarre(); dessiner(); } }))) : null, [tr("Client"), tr("Intitulé"), tr("Départ"), tr("Statut"), tr("Total"), tr("Reste")].map((t, i) => h("th", { scope: "col", class: i >= 4 ? "num" : null }, t)))),
        h(
          "tbody",
          null,
          lignes.slice(0, limite).map((r) =>
            h(
              "tr",
              null,
              groupee ? h("td", { class: "case-cellule" }, cocher(r)) : null,
              h("td", { "data-label": tr("Client") }, h("a", { href: `#/dossier/${r.dossier.id}` }, nomClient(r.client)), h("span", { class: "ref ref-sous" }, r.dossier.ref)),
              h("td", { "data-label": tr("Intitulé") }, voyageTexte(r.dossier.bandeau, r.dossier.pays)),
              h("td", { "data-label": tr("Départ") }, r.dossier.date_depart ? formatDate(r.dossier.date_depart) : "-"),
              h("td", { "data-label": tr("Statut") }, pastille(r.statut)),
              h("td", { "data-label": tr("Total"), class: "num" }, r.total ? formatMontant(r.total, r.devise) : "-"),
              h("td", { "data-label": tr("Reste"), class: "num" }, r.total ? formatMontant(r.reste, r.devise) : "-")
            )
          )
        )
      )
    );
    if (lignes.length > limite) corps.append(h("p", { class: "plus" }, h("button", { class: "secondaire", type: "button", onclick: () => ((limite += PAGE), dessiner()) }, tr("Afficher plus ({x} restants)", { x: lignes.length - limite }))));
    else if (lignes.length > PAGE) corps.append(h("p", { class: "aide plus" }, tr("{n} dossiers affichés.", { n: lignes.length })));
  }

  // L'adresse suit l'onglet et le tri : un rechargement ou un favori retrouve la même liste.
  const majUrl = () => history.replaceState(null, "", `#/dossiers?onglet=${filtre.onglet}&tri=${filtre.tri}`);
  // Recherche collante, onglets en puces défilantes, tri dans la feuille « Filtrer » (à plat sur ordinateur).
  const filtres = barreFiltres({
    recherche: { valeur: filtre.q, placeholder: tr("Nom du client, référence, pays"), libelle: tr("Rechercher") },
    puces: { options: ongletsActifs().map(([cle, libelle]) => ({ valeur: cle, libelle: tr(libelle) })), valeur: filtre.onglet, libelle: tr("Dossiers") },
    filtres: [{ cle: "tri", libelle: tr("Trier par"), type: "select", neutre: "recents", valeur: filtre.tri, options: TRIS.map(([k, l]) => ({ valeur: k, libelle: tr(l) })) }],
    onchange: (v) => {
      filtre.onglet = v.puces;
      filtre.q = v.recherche;
      filtre.tri = v.tri;
      majUrl();
      limite = PAGE;
      dessiner();
    },
  });
  dessiner();
  majBarre();
  return h(
    "div",
    { "data-titre": tr("Dossiers") },
    h("div", { class: "entete" }, h("h1", null, tr("Dossiers")), peut("dossiers.ecrire") ? h("div", { class: "entete-actions" }, modeExcursions() ? h("button", { class: "secondaire seulement-bureau", type: "button", onclick: ouvrirDemande }, tr("Coller une demande")) : null, h("a", { class: "bouton principal seulement-bureau", href: "#/dossiers/nouveau" }, tr("Nouveau dossier"))) : null),
    filtres.noeud,
    barre,
    corps
  );
}

export function nouveauDossier() {
  if (!peut("dossiers.ecrire")) return vide(tr("Accès réservé"), tr("Votre rôle ne permet pas de créer un dossier."), h("a", { class: "bouton secondaire", href: "#/dossiers" }, tr("Retour aux dossiers")));
  if (modeExcursions()) return nouveauDossierExcursions();
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const regl = reglages();
  const listePays = [...regl.listes.pays, tr("Autre")];
  const libellePays = tr(regl.dossier.libelle_pays || "Pays");
  const selClient = selecteurClient({ valeur: params.get("client") || "", avecNouveau: peut("clients.ecrire"), surChangement: () => majClient() });
  const nvCivilite = h("select", { id: "civ" }, regl.listes.civilites.map((c) => h("option", { value: c }, tr(c))));
  const nvPrenom = h("input", { id: "prenom", autocomplete: "off", oninput: majRef });
  const nvNom = h("input", { id: "nom", autocomplete: "off", oninput: majRef });
  const nvAdresse = h("textarea", { id: "adr", rows: 3, placeholder: tr("Rue et numéro\nCode postal, ville, pays") });
  const nvTel = h("input", { id: "tel", type: "tel", inputmode: "tel", autocomplete: "off", placeholder: "+41 79 123 45 67" });
  const nvEmail = h("input", { id: "email", type: "email", inputmode: "email", autocomplete: "off", autocapitalize: "none", spellcheck: "false" });
  const blocNouveau = h("div", { class: "grille-form" }, champ(tr("Civilité"), nvCivilite), champ(tr("Prénom"), nvPrenom), champ(tr("Nom"), nvNom), champ(tr("Téléphone"), nvTel), champ("E-mail", nvEmail), champ(tr("Adresse"), nvAdresse));

  const pays = h("select", { id: "pays", onchange: majBandeau }, listePays.map((p) => h("option", { value: p }, p === "Autre" ? tr("Autre") : p)));
  const paysLibre = h("input", { id: "pays-libre", oninput: majBandeau });
  const champPaysLibre = champ(tr("{libellePays} (autre)", { libellePays }), paysLibre);
  const typeDoc = h("select", { id: "type-doc" }, h("option", { value: "devis" }, tr("Un devis")), h("option", { value: "facture" }, tr("Directement une facture")));
  const depart = h("input", { id: "depart", type: "date", onchange: majBandeau });
  const retour = h("input", { id: "retour", type: "date", onchange: majBandeau });
  const bandeau = h("input", { id: "bandeau" });
  const ref = h("input", { id: "ref" });
  let bandeauManuel = false;
  let refManuelle = false;
  bandeau.addEventListener("input", () => (bandeauManuel = true));
  ref.addEventListener("input", () => (refManuelle = true));

  const paysChoisi = () => (pays.value === "Autre" ? paysLibre.value.trim() : pays.value);

  function majClient() {
    blocNouveau.hidden = !selClient.nouveau;
    // Le nom tapé dans la recherche est repris (prénom et nom séparés), sans écraser ce qui a déjà été écrit dans ces champs.
    if (selClient.nouveau && !nvPrenom.value && !nvNom.value) {
      const id = identiteDepuisSaisie(selClient.texteSaisi);
      nvPrenom.value = id.prenom;
      nvNom.value = id.nom;
    }
    majRef();
  }
  function majBandeau() {
    champPaysLibre.hidden = pays.value !== "Autre";
    if (!bandeauManuel) {
      const periode = periodeTexte(depart.value, retour.value);
      // Un modèle sans pays ou sans période ne garde pas de séparateur orphelin.
      bandeau.value = regl.dossier.modele_bandeau.replace("{PAYS}", paysChoisi().toUpperCase()).replace("{PERIODE}", periode).replace(/^[\s-]+|[\s-]+$/g, "");
    }
    majRef();
  }
  function majRef() {
    if (refManuelle) return;
    const c = selClient.valeur ? etat.db.clients.find((x) => x.id === selClient.valeur) : selClient.nouveau ? { prenom: nvPrenom.value, nom: nvNom.value } : null;
    const pret = c && (c.prenom || c.nom) && (regl.numerotation.mode === "sequence" || paysChoisi());
    ref.value = pret ? nouvelleRef({ numerotation: regl.numerotation, prenom: c.prenom, nom: c.nom, dateIso: aujourdhui(), pays: paysChoisi(), refsExistantes: etat.db.dossiers.map((d) => d.ref) }) : "";
  }

  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const bouton = h("button", { class: "principal", type: "submit" }, tr("Créer le dossier"));

  async function creer(e) {
    e.preventDefault();
    erreur.textContent = "";
    if (!selClient.valeur && !selClient.nouveau) {
      erreur.textContent = tr("Choisissez un client dans la recherche, ou créez-en un.");
      document.getElementById("client").focus();
      return;
    }
    let coordonnees = { telephone: "", email: "" };
    if (selClient.nouveau) {
      // Le téléphone garde la règle des fiches client : indicatif obligatoire (+41, +33, +66…), jamais deviné.
      erreurChamp(nvTel, "");
      const verif = verifierNouveauClient({ nom: nvNom.value, telephone: nvTel.value, email: nvEmail.value });
      if (!verif.ok) {
        if (verif.champ === "nom") (erreur.textContent = tr("Indiquez le nom du client.")), nvNom.focus();
        else if (verif.champ === "telephone") (erreurChamp(nvTel, verif.raison === "sans_indicatif" ? tr("Ajoutez l'indicatif du pays, par exemple +41, +33 ou +66, à la place du 0 du début.") : tr("Numéro illisible : écrivez-le avec son indicatif, par exemple +41 79 123 45 67.")), nvTel.focus());
        else (erreur.textContent = tr("Cette adresse e-mail est illisible : vérifiez-la."), nvEmail.focus());
        return;
      }
      coordonnees = verif.valeurs;
    }
    if (!ref.value.trim()) {
      erreur.textContent = regl.numerotation.mode === "sequence" ? tr("Indiquez la référence.") : tr("Indiquez la référence et le champ « {champ} ».", { champ: libellePays });
      return;
    }
    if (etat.db.dossiers.some((d) => d.ref === ref.value.trim())) {
      erreur.textContent = tr("Cette référence existe déjà. Modifiez-la.");
      ref.focus();
      return;
    }
    bouton.disabled = true;
    bouton.textContent = tr("Création…");
    try {
      // Référence en séquence non modifiée à la main : le numéro définitif vient de la base, qui ne le redonne jamais.
      if (!refManuelle && regl.numerotation.mode === "sequence") {
        const s = sequenceRef({ numerotation: regl.numerotation, dateIso: aujourdhui(), refsExistantes: etat.db.dossiers.map((x) => x.ref) });
        ref.value = refDepuisNumero(regl.numerotation, s.debut, await numeroSuivant(s.annee, s.dernier));
      }
      let clientId = selClient.valeur;
      if (!clientId) {
        const c = await inserer("clients", { civilite: nvCivilite.value, prenom: nvPrenom.value.trim(), nom: nvNom.value.trim(), adresse: nvAdresse.value.trim(), telephone: coordonnees.telephone, email: coordonnees.email, notes: "" });
        clientId = c.id;
      }
      const d = await inserer("dossiers", {
        ref: ref.value.trim(),
        client_id: clientId,
        pays: paysChoisi(),
        bandeau: bandeau.value.trim(),
        date_depart: depart.value || null,
        date_retour: retour.value || null,
        accepte_le: typeDoc.value === "facture" ? aujourdhui() : null,
        annule: false,
        notes: "",
      });
      const doc = await inserer("documents", {
        dossier_id: d.id,
        type: typeDoc.value,
        date_emission: aujourdhui(),
        envoye_le: null,
        updated_at: new Date().toISOString(),
        contenu: { ...CONTENU_DEFAUT(), bandeau: bandeau.value.trim(), variante: (regl.textes.variantes[0] || {}).id || "", equivalents: { actif: false, eur: regl.taux.eur, thb: regl.taux.thb } },
      });
      naviguer(`#/doc/${doc.id}`);
    } catch (err) {
      erreur.textContent = /duplicate|unique|23505/i.test(err.message) ? tr("Cette référence existe déjà. Modifiez-la.") : err.message;
      bouton.disabled = false;
      bouton.textContent = tr("Créer le dossier");
    }
  }

  majClient();
  majBandeau();

  return h(
    "div",
    { "data-titre": tr("Nouveau dossier") },
    h("div", { class: "entete" }, h("h1", null, tr("Nouveau dossier"))),
    h(
      "form",
      { class: "formulaire", onsubmit: creer },
      h("fieldset", null, h("legend", null, tr("Client")), selClient.noeud, blocNouveau),
      h(
        "fieldset",
        null,
        h("legend", null, tr("Dossier")),
        h("div", { class: "grille-form" }, champ(libellePays, pays), champPaysLibre, champ(tr("Début"), depart), champ(tr("Fin"), retour)),
        champ(tr("Titre affiché sur le document"), bandeau, tr("Se remplit avec le modèle de l'entreprise, le pays et les dates. Modifiable à la main.")),
        champ(tr("Référence"), ref, regl.numerotation.mode === "sequence" ? tr("Numéro suivant de l'année pour cette entreprise.") : tr("Initiales, date du jour et pays.")),
        champ(tr("Premier document"), typeDoc)
      ),
      erreur,
      h("div", { class: "actions" }, h("a", { class: "bouton secondaire", href: "#/dossiers" }, tr("Annuler")), bouton)
    )
  );
}
