import { etat, inserer, modifier, supprimer, nomClient, naviguer, resumeDossier, reglages, peut } from "../etat.mjs";
import { h, champ, modal, confirmer, toast } from "../ui.mjs";
import { formatMontant } from "../calc.mjs";
import { pastille, vide, listeAdaptative, barreFiltres } from "./commun.mjs";
import { correspond } from "../mobile-calc.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

function formulaireClient(client, apres) {
  const civilites = [...reglages().listes.civilites];
  if (client.civilite && !civilites.includes(client.civilite)) civilites.push(client.civilite);
  const civ = h("select", { id: "c-civ" }, civilites.map((x) => h("option", { value: x }, tr(x))));
  civ.value = client.civilite || civilites[0] || "";
  const prenom = h("input", { id: "c-prenom", value: client.prenom || "" });
  const nom = h("input", { id: "c-nom", value: client.nom || "", required: true });
  const tel = h("input", { id: "c-tel", type: "tel", value: client.telephone || "" });
  const email = h("input", { id: "c-email", type: "email", value: client.email || "" });
  const adresse = h("textarea", { id: "c-adr", rows: 3 });
  adresse.value = client.adresse || "";
  const notes = h("textarea", { id: "c-notes", rows: 2 });
  notes.value = client.notes || "";
  return h(
    "form",
    {
      class: "formulaire",
      onsubmit: async (e) => {
        e.preventDefault();
        const valeurs = { civilite: civ.value, prenom: prenom.value.trim(), nom: nom.value.trim(), telephone: tel.value.trim(), email: email.value.trim(), adresse: adresse.value.trim(), notes: notes.value.trim() };
        // Seuls les champs changés partent : un autre champ modifié entre-temps par quelqu'un d'autre n'est pas écrasé.
        const changes = client.id ? Object.fromEntries(Object.entries(valeurs).filter(([k, v]) => (client[k] || "") !== v)) : valeurs;
        const c = client.id ? (Object.keys(changes).length ? await modifier("clients", client.id, changes) : client) : await inserer("clients", valeurs);
        toast(tr("Client enregistré."));
        apres(c);
      },
    },
    h("div", { class: "grille-form" }, champ(tr("Civilité"), civ), champ(tr("Prénom"), prenom), champ(tr("Nom"), nom), champ(tr("Téléphone"), tel), champ("E-mail", email, tr("Pour votre usage, il n'apparaît pas sur les documents."))),
    champ(tr("Adresse, telle qu'elle doit apparaître sur le devis"), adresse),
    champ(tr("Notes"), notes),
    peut("clients.ecrire") ? h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Enregistrer le client"))) : h("p", { class: "aide" }, tr("Lecture seule : votre rôle ne permet pas de modifier les clients."))
  );
}

export function listeClients() {
  const nbDossiers = (c) => etat.db.dossiers.filter((d) => d.client_id === c.id).length;
  const ligne = (c) => ({ c, nom: nomClient(c), n: nbDossiers(c), ville: (c.adresse || "").split("\n").filter(Boolean).pop() || "" });
  const lignes = () => etat.db.clients.map(ligne).sort((a, b) => a.nom.localeCompare(b.nom));
  const filtrer = (tout, requete) => tout.filter((x) => correspond(`${x.nom} ${x.c.telephone} ${x.c.adresse}`, requete));
  const liste = listeAdaptative({
    items: lignes(),
    colonnes: [
      { cle: "nom", titre: tr("Client"), tri: (x) => x.nom, mobile: "titre" },
      { cle: "tel", titre: tr("Téléphone"), rendu: (x) => x.c.telephone || null, mobile: "sous" },
      { cle: "adresse", titre: tr("Adresse"), rendu: (x) => (x.c.adresse || "").split("\n").join(", ") || null, rendu_mobile: (x) => x.ville || null, mobile: "sous" },
      { cle: "n", titre: tr("Dossiers"), num: true, tri: (x) => x.n, mobile: "droite", rendu: (x) => pluriel(x.n, N_("dossier"), N_("dossiers")) },
    ],
    lien: (x) => `#/client/${x.c.id}`,
    tri: { cle: "nom" },
    vide: vide(etat.db.clients.length ? tr("Aucun client ne correspond") : tr("Aucun client"), etat.db.clients.length ? tr("Essayez une autre recherche.") : tr("Les clients se créent avec leur premier dossier, ou avec le bouton ci-dessus.")),
  });
  const filtres = barreFiltres({ recherche: { placeholder: tr("Nom, téléphone, ville"), libelle: tr("Rechercher") }, onchange: (v) => liste.mettre(filtrer(lignes(), v.recherche)) });
  const corps = liste.noeud;
  return h(
    "div",
    { "data-titre": tr("Clients") },
    h(
      "div",
      { class: "entete" },
      h("h1", null, tr("Clients")),
      !peut("clients.ecrire") ? null : h(
        "button",
        {
          class: "principal",
          type: "button",
          onclick: () => {
            const fermer = modal(tr("Nouveau client"), h("div", { class: "modal-corps" }, formulaireClient({}, (c) => (fermer(), naviguer(`#/client/${c.id}`)))));
          },
        },
        tr("Nouveau client")
      )
    ),
    filtres.noeud,
    corps
  );
}

export function ficheClient(id) {
  const client = etat.db.clients.find((c) => c.id === id);
  if (!client) return vide(tr("Client introuvable"), tr("Il a peut-être été supprimé."), h("a", { class: "bouton secondaire", href: "#/clients" }, tr("Retour aux clients")));
  const dossiers = etat.db.dossiers.filter((d) => d.client_id === id).map((d) => resumeDossier(d.id));
  return h(
    "div",
    { "data-titre": nomClient(client) },
    h("a", { class: "retour", href: "#/clients" }, tr("Clients")),
    h("div", { class: "entete" }, h("h1", null, nomClient(client)), peut("dossiers.ecrire") ? h("a", { class: "bouton principal", href: `#/dossiers/nouveau?client=${id}` }, tr("Nouveau dossier pour ce client")) : null),
    h("section", null, h("h2", null, tr("Coordonnées")), formulaireClient(client, () => naviguer(location.hash))),
    h(
      "section",
      null,
      h("h2", null, tr("Dossiers")),
      dossiers.length
        ? h(
            "table",
            { class: "tableau simple" },
            h("thead", null, h("tr", null, [tr("Référence"), tr("Statut"), tr("Total"), tr("Reste")].map((x, i) => h("th", { scope: "col", class: i > 1 ? "num" : null }, x)))),
            h(
              "tbody",
              null,
              dossiers.map((r) => h("tr", null, h("td", { "data-label": tr("Référence") }, h("a", { href: `#/dossier/${r.dossier.id}` }, r.dossier.ref)), h("td", { "data-label": tr("Statut") }, pastille(r.statut)), h("td", { class: "num", "data-label": tr("Total") }, formatMontant(r.total, r.devise)), h("td", { class: "num", "data-label": tr("Reste") }, formatMontant(r.reste, r.devise))))
            )
          )
        : h("p", { class: "vide-court" }, tr("Aucun dossier pour ce client."))
    ),
    !peut("clients.supprimer") ? null : h(
      "section",
      { class: "zone-danger" },
      h("h2", null, tr("Supprimer ce client")),
      dossiers.length
        ? h("p", { class: "aide" }, tr("Impossible tant que le client a des dossiers."))
        : h(
            "button",
            {
              class: "danger",
              type: "button",
              onclick: async () => {
                if (await confirmer(tr("Supprimer définitivement {nomClient} ?", { nomClient: nomClient(client) }), tr("Supprimer"), true)) {
                  await supprimer("clients", id);
                  naviguer("#/clients");
                }
              },
            },
            tr("Supprimer le client")
          )
    )
  );
}
