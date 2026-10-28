import { etat, resumes, inserer, nomClient, naviguer, reglages } from "../etat.mjs";
import { h, champ, vider } from "../ui.mjs";
import { formatMontant, aujourdhui, nouvelleRef, periodeTexte, STATUTS } from "../calc.mjs";
import { CONTENU_DEFAUT } from "../defauts.mjs";
import { pastille, vide, voyageTexte } from "./commun.mjs";

const ONGLETS = [
  ["cours", "En cours", ["brouillon", "devis_envoye", "accepte", "acompte"]],
  ["soldes", "Soldés", ["solde"]],
  ["annules", "Annulés", ["annule"]],
  ["tous", "Tous", Object.keys(STATUTS)],
];

const filtre = { onglet: "cours", q: "" };
const sansAccents = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function listeDossiers() {
  const corps = h("div");
  const recherche = h("input", {
    id: "recherche",
    type: "search",
    value: filtre.q,
    placeholder: "Nom du client, référence, pays",
    oninput: (e) => {
      filtre.q = e.target.value;
      dessiner();
    },
  });

  function dessiner() {
    const statuts = ONGLETS.find(([k]) => k === filtre.onglet)[2];
    const q = sansAccents(filtre.q);
    const lignes = resumes()
      .filter((r) => statuts.includes(r.statut))
      .filter((r) => !q || sansAccents(`${nomClient(r.client)} ${r.dossier.ref} ${r.dossier.pays}`).includes(q))
      .sort((a, b) => (a.dossier.created_at < b.dossier.created_at ? 1 : -1));
    vider(corps);
    if (!lignes.length) {
      corps.append(
        etat.db.dossiers.length
          ? vide("Aucun dossier ne correspond", "Essayez un autre onglet ou effacez la recherche.")
          : vide("Aucun dossier pour l'instant", "Un dossier regroupe le client, le voyage, le devis, la facture et les paiements.", h("a", { class: "bouton principal", href: "#/dossiers/nouveau" }, "Créer le premier dossier"))
      );
      return;
    }
    corps.append(
      h(
        "table",
        { class: "tableau" },
        h("thead", null, h("tr", null, ["Client", "Référence", "Intitulé", "Statut", "Total", "Reste"].map((t, i) => h("th", { scope: "col", class: i >= 4 ? "num" : null }, t)))),
        h(
          "tbody",
          null,
          lignes.map((r) =>
            h(
              "tr",
              null,
              h("td", { "data-label": "Client" }, h("a", { href: `#/dossier/${r.dossier.id}` }, nomClient(r.client))),
              h("td", { "data-label": "Référence", class: "ref" }, r.dossier.ref),
              h("td", { "data-label": "Intitulé" }, voyageTexte(r.dossier.bandeau, r.dossier.pays)),
              h("td", { "data-label": "Statut" }, pastille(r.statut)),
              h("td", { "data-label": "Total", class: "num" }, r.total ? formatMontant(r.total, r.devise) : "-"),
              h("td", { "data-label": "Reste", class: "num" }, r.total ? formatMontant(r.reste, r.devise) : "-")
            )
          )
        )
      )
    );
  }

  const onglets = h(
    "div",
    { class: "onglets" },
    ONGLETS.map(([cle, libelle]) =>
      h(
        "button",
        {
          type: "button",
          "aria-pressed": cle === filtre.onglet ? "true" : "false",
          onclick: (e) => {
            filtre.onglet = cle;
            for (const b of onglets.children) b.setAttribute("aria-pressed", b === e.currentTarget ? "true" : "false");
            dessiner();
          },
        },
        libelle
      )
    )
  );
  dessiner();
  return h(
    "div",
    { "data-titre": "Dossiers" },
    h("div", { class: "entete" }, h("h1", null, "Dossiers"), h("a", { class: "bouton principal", href: "#/dossiers/nouveau" }, "Nouveau dossier")),
    h("div", { class: "barre-outils" }, onglets, h("div", { class: "champ recherche" }, h("label", { for: "recherche" }, "Rechercher"), recherche)),
    corps
  );
}

export function nouveauDossier() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const regl = reglages();
  const listePays = [...regl.listes.pays, "Autre"];
  const libellePays = regl.dossier.libelle_pays || "Pays";
  const selClient = h(
    "select",
    { id: "client", onchange: majClient },
    h("option", { value: "" }, "Nouveau client"),
    [...etat.db.clients].sort((a, b) => nomClient(a).localeCompare(nomClient(b))).map((c) => h("option", { value: c.id }, nomClient(c)))
  );
  const nvCivilite = h("select", { id: "civ" }, regl.listes.civilites.map((c) => h("option", { value: c }, c)));
  const nvPrenom = h("input", { id: "prenom", autocomplete: "off", oninput: majRef });
  const nvNom = h("input", { id: "nom", autocomplete: "off", oninput: majRef });
  const nvAdresse = h("textarea", { id: "adr", rows: 3, placeholder: "Rue et numéro\nCode postal, ville, pays" });
  const nvTel = h("input", { id: "tel", type: "tel", autocomplete: "off" });
  const blocNouveau = h("div", { class: "grille-form" }, champ("Civilité", nvCivilite), champ("Prénom", nvPrenom), champ("Nom", nvNom), champ("Téléphone", nvTel), champ("Adresse", nvAdresse));

  const pays = h("select", { id: "pays", onchange: majBandeau }, listePays.map((p) => h("option", { value: p }, p)));
  const paysLibre = h("input", { id: "pays-libre", oninput: majBandeau });
  const champPaysLibre = champ(`${libellePays} (autre)`, paysLibre);
  const typeDoc = h("select", { id: "type-doc" }, h("option", { value: "devis" }, "Un devis"), h("option", { value: "facture" }, "Directement une facture"));
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
    blocNouveau.hidden = selClient.value !== "";
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
    const c = selClient.value ? etat.db.clients.find((x) => x.id === selClient.value) : { prenom: nvPrenom.value, nom: nvNom.value };
    const pret = c && (c.prenom || c.nom) && (regl.numerotation.mode === "sequence" || paysChoisi());
    ref.value = pret ? nouvelleRef({ numerotation: regl.numerotation, prenom: c.prenom, nom: c.nom, dateIso: aujourdhui(), pays: paysChoisi(), refsExistantes: etat.db.dossiers.map((d) => d.ref) }) : "";
  }

  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const bouton = h("button", { class: "principal", type: "submit" }, "Créer le dossier");

  async function creer(e) {
    e.preventDefault();
    erreur.textContent = "";
    if (!selClient.value && !nvNom.value.trim()) {
      erreur.textContent = "Indiquez le nom du client.";
      nvNom.focus();
      return;
    }
    if (!ref.value.trim()) {
      erreur.textContent = `Indiquez la référence${regl.numerotation.mode === "sequence" ? "" : ` et le champ « ${libellePays} »`}.`;
      return;
    }
    if (etat.db.dossiers.some((d) => d.ref === ref.value.trim())) {
      erreur.textContent = "Cette référence existe déjà. Modifiez-la.";
      ref.focus();
      return;
    }
    bouton.disabled = true;
    bouton.textContent = "Création…";
    try {
      let clientId = selClient.value;
      if (!clientId) {
        const c = await inserer("clients", { civilite: nvCivilite.value, prenom: nvPrenom.value.trim(), nom: nvNom.value.trim(), adresse: nvAdresse.value.trim(), telephone: nvTel.value.trim(), email: "", notes: "" });
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
      erreur.textContent = err.message;
      bouton.disabled = false;
      bouton.textContent = "Créer le dossier";
    }
  }

  const preselection = params.get("client");
  if (preselection) selClient.value = preselection;
  majClient();
  majBandeau();

  return h(
    "div",
    { "data-titre": "Nouveau dossier" },
    h("div", { class: "entete" }, h("h1", null, "Nouveau dossier")),
    h(
      "form",
      { class: "formulaire", onsubmit: creer },
      h("fieldset", null, h("legend", null, "Client"), champ("Client", selClient), blocNouveau),
      h(
        "fieldset",
        null,
        h("legend", null, "Dossier"),
        h("div", { class: "grille-form" }, champ(libellePays, pays), champPaysLibre, champ("Début", depart), champ("Fin", retour)),
        champ("Titre affiché sur le document", bandeau, "Se remplit avec le modèle de l'entreprise, le pays et les dates. Modifiable à la main."),
        champ("Référence", ref, regl.numerotation.mode === "sequence" ? "Numéro suivant de l'année pour cette entreprise." : "Initiales, date du jour et pays."),
        champ("Premier document", typeDoc)
      ),
      erreur,
      h("div", { class: "actions" }, h("a", { class: "bouton secondaire", href: "#/dossiers" }, "Annuler"), bouton)
    )
  );
}
