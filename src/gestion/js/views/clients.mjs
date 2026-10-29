import { etat, inserer, modifier, supprimer, nomClient, naviguer, resumeDossier, reglages, peut } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, vider } from "../ui.mjs";
import { formatMontant } from "../calc.mjs";
import { pastille, vide, cartes } from "./commun.mjs";
import { tr } from "../i18n.mjs";

const sansAccents = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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
        const c = client.id ? await modifier("clients", client.id, valeurs) : await inserer("clients", valeurs);
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
  const corps = h("div");
  const q = h("input", { id: "rech-clients", type: "search", placeholder: tr("Nom, téléphone, ville"), oninput: () => ((limite = 50), dessiner()) });
  let limite = 50;
  function dessiner() {
    const t = sansAccents(q.value);
    const clients = etat.db.clients.filter((c) => !t || sansAccents(`${nomClient(c)} ${c.telephone} ${c.adresse}`).includes(t)).sort((a, b) => nomClient(a).localeCompare(nomClient(b)));
    vider(corps);
    if (!clients.length) {
      corps.append(vide(etat.db.clients.length ? tr("Aucun client ne correspond") : tr("Aucun client"), etat.db.clients.length ? tr("Essayez une autre recherche.") : tr("Les clients se créent avec leur premier dossier, ou avec le bouton ci-dessus.")));
      return;
    }
    const nbDossiers = (c) => etat.db.dossiers.filter((d) => d.client_id === c.id).length;
    corps.append(
      cartes(clients.slice(0, limite), (c) => {
        const n = nbDossiers(c);
        return h(
          "a",
          { class: "carte-lien", href: `#/client/${c.id}` },
          h("span", { class: "carte-titre" }, nomClient(c)),
          h("span", { class: "carte-droite" }, h("strong", null, n), h("span", null, n > 1 ? "dossiers" : "dossier")),
          h("span", { class: "carte-sous" }, [c.telephone, (c.adresse || "").split("\n").filter(Boolean).pop()].filter(Boolean).join(" · ") || tr("Sans coordonnées"))
        );
      }),
      h(
        "table",
        { class: "tableau seulement-bureau" },
        h("thead", null, h("tr", null, [tr("Client"), tr("Téléphone"), tr("Adresse"), tr("Dossiers")].map((x, i) => h("th", { scope: "col", class: i === 3 ? "num" : null }, x)))),
        h(
          "tbody",
          null,
          clients.slice(0, limite).map((c) =>
            h(
              "tr",
              null,
              h("td", { "data-label": tr("Client") }, h("a", { href: `#/client/${c.id}` }, nomClient(c))),
              h("td", { "data-label": tr("Téléphone") }, c.telephone || "-"),
              h("td", { "data-label": tr("Adresse") }, (c.adresse || "-").split("\n").join(", ")),
              h("td", { class: "num", "data-label": tr("Dossiers") }, nbDossiers(c))
            )
          )
        )
      )
    );
    if (clients.length > limite) corps.append(h("p", { class: "plus" }, h("button", { class: "secondaire", type: "button", onclick: () => ((limite += 50), dessiner()) }, tr("Afficher plus ({x} restants)", { x: clients.length - limite }))));
  }
  dessiner();
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
    h("div", { class: "barre-outils" }, h("div", { class: "champ recherche" }, h("label", { for: "rech-clients" }, tr("Rechercher")), q)),
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
