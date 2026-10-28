import { etat, inserer, modifier, supprimer, nomClient, naviguer, resumeDossier, reglages } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, vider } from "../ui.mjs";
import { formatMontant } from "../calc.mjs";
import { pastille, vide } from "./commun.mjs";

const sansAccents = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function formulaireClient(client, apres) {
  const civilites = [...reglages().listes.civilites];
  if (client.civilite && !civilites.includes(client.civilite)) civilites.push(client.civilite);
  const civ = h("select", { id: "c-civ" }, civilites.map((x) => h("option", { value: x }, x)));
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
        toast("Client enregistré.");
        apres(c);
      },
    },
    h("div", { class: "grille-form" }, champ("Civilité", civ), champ("Prénom", prenom), champ("Nom", nom), champ("Téléphone", tel), champ("E-mail", email, "Pour votre usage, il n'apparaît pas sur les documents.")),
    champ("Adresse, telle qu'elle doit apparaître sur le devis", adresse),
    champ("Notes", notes),
    h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, "Enregistrer le client"))
  );
}

export function listeClients() {
  const corps = h("div");
  const q = h("input", { id: "rech-clients", type: "search", placeholder: "Nom, téléphone, ville", oninput: dessiner });
  function dessiner() {
    const t = sansAccents(q.value);
    const clients = etat.db.clients.filter((c) => !t || sansAccents(`${nomClient(c)} ${c.telephone} ${c.adresse}`).includes(t)).sort((a, b) => nomClient(a).localeCompare(nomClient(b)));
    vider(corps);
    if (!clients.length) {
      corps.append(vide(etat.db.clients.length ? "Aucun client ne correspond" : "Aucun client", etat.db.clients.length ? "Essayez une autre recherche." : "Les clients se créent avec leur premier dossier, ou avec le bouton ci-dessus."));
      return;
    }
    corps.append(
      h(
        "table",
        { class: "tableau" },
        h("thead", null, h("tr", null, ["Client", "Téléphone", "Adresse", "Dossiers"].map((x, i) => h("th", { scope: "col", class: i === 3 ? "num" : null }, x)))),
        h(
          "tbody",
          null,
          clients.map((c) =>
            h(
              "tr",
              null,
              h("td", { "data-label": "Client" }, h("a", { href: `#/client/${c.id}` }, nomClient(c))),
              h("td", { "data-label": "Téléphone" }, c.telephone || "-"),
              h("td", { "data-label": "Adresse" }, (c.adresse || "-").split("\n").join(", ")),
              h("td", { class: "num", "data-label": "Dossiers" }, etat.db.dossiers.filter((d) => d.client_id === c.id).length)
            )
          )
        )
      )
    );
  }
  dessiner();
  return h(
    "div",
    { "data-titre": "Clients" },
    h(
      "div",
      { class: "entete" },
      h("h1", null, "Clients"),
      h(
        "button",
        {
          class: "principal",
          type: "button",
          onclick: () => {
            const fermer = modal("Nouveau client", h("div", { class: "modal-corps" }, formulaireClient({}, (c) => (fermer(), naviguer(`#/client/${c.id}`)))));
          },
        },
        "Nouveau client"
      )
    ),
    h("div", { class: "barre-outils" }, h("div", { class: "champ recherche" }, h("label", { for: "rech-clients" }, "Rechercher"), q)),
    corps
  );
}

export function ficheClient(id) {
  const client = etat.db.clients.find((c) => c.id === id);
  if (!client) return vide("Client introuvable", "Il a peut-être été supprimé.", h("a", { class: "bouton secondaire", href: "#/clients" }, "Retour aux clients"));
  const dossiers = etat.db.dossiers.filter((d) => d.client_id === id).map((d) => resumeDossier(d.id));
  return h(
    "div",
    { "data-titre": nomClient(client) },
    h("a", { class: "retour", href: "#/clients" }, "Clients"),
    h("div", { class: "entete" }, h("h1", null, nomClient(client)), h("a", { class: "bouton principal", href: `#/dossiers/nouveau?client=${id}` }, "Nouveau dossier pour ce client")),
    h("section", null, h("h2", null, "Coordonnées"), formulaireClient(client, () => naviguer(location.hash))),
    h(
      "section",
      null,
      h("h2", null, "Dossiers"),
      dossiers.length
        ? h(
            "table",
            { class: "tableau simple" },
            h("thead", null, h("tr", null, ["Référence", "Statut", "Total", "Reste"].map((x, i) => h("th", { scope: "col", class: i > 1 ? "num" : null }, x)))),
            h(
              "tbody",
              null,
              dossiers.map((r) => h("tr", null, h("td", { "data-label": "Référence" }, h("a", { href: `#/dossier/${r.dossier.id}` }, r.dossier.ref)), h("td", { "data-label": "Statut" }, pastille(r.statut)), h("td", { class: "num", "data-label": "Total" }, formatMontant(r.total)), h("td", { class: "num", "data-label": "Reste" }, formatMontant(r.reste))))
            )
          )
        : h("p", { class: "vide-court" }, "Aucun dossier pour ce client.")
    ),
    h(
      "section",
      { class: "zone-danger" },
      h("h2", null, "Supprimer ce client"),
      dossiers.length
        ? h("p", { class: "aide" }, "Impossible tant que le client a des dossiers.")
        : h(
            "button",
            {
              class: "danger",
              type: "button",
              onclick: async () => {
                if (await confirmer(`Supprimer définitivement ${nomClient(client)} ?`, "Supprimer", true)) {
                  await supprimer("clients", id);
                  naviguer("#/clients");
                }
              },
            },
            "Supprimer le client"
          )
    )
  );
}
