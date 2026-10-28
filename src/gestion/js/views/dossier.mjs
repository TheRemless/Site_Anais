import { etat, resumeDossier, modifier, inserer, supprimer, nomClient, naviguer, reglages } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, num } from "../ui.mjs";
import { formatChf, formatDate, aujourdhui, acompteDu, echeanceAcompte, totaux, arrondi } from "../calc.mjs";
import { pastille, vide, pdf, voyageTexte } from "./commun.mjs";

const MOYENS = [
  ["virement", "Virement bancaire"],
  ["wise", "Wise"],
  ["paypal", "PayPal"],
  ["twint", "TWINT"],
  ["especes", "Espèces"],
  ["autre", "Autre"],
];

const rafraichir = () => naviguer(location.hash);
const dernier = (docs, type) => docs.filter((d) => d.type === type).sort((a, b) => (a.created_at > b.created_at ? 1 : -1)).pop();

export function ficheDossier(id) {
  const r = resumeDossier(id);
  if (!r) return vide("Dossier introuvable", "Il a peut-être été supprimé.", h("a", { class: "bouton secondaire", href: "#/dossiers" }, "Retour aux dossiers"));
  const { dossier: d, client, paiements } = r;
  const regl = reglages();
  const devis = dernier(r.documents, "devis");
  const facture = dernier(r.documents, "facture");
  const acompte = acompteDu(r.total, regl.conditions.acompte_pct);
  const echeance = echeanceAcompte(d, regl);
  const ajd = aujourdhui();

  // Étapes du dossier : le statut en découle, ces boutons ne font qu'enregistrer des faits.
  const etape = (fait, titre, detail, action) => h("li", { class: fait ? "etape fait" : "etape" }, h("span", { class: "etape-etat" }, fait ? "Fait" : "À faire"), h("div", { class: "etape-texte" }, h("strong", null, titre), detail ? h("span", null, detail) : null), action || null);

  const marquerEnvoye = async () => {
    await modifier("documents", devis.id, { envoye_le: ajd });
    toast("Devis marqué comme envoyé.");
    rafraichir();
  };
  const accepter = () => {
    const date = h("input", { id: "date-accept", type: "date", value: ajd });
    const fermer = modal(
      "Le client a accepté le devis",
      h(
        "form",
        {
          class: "modal-corps",
          onsubmit: async (e) => {
            e.preventDefault();
            await modifier("dossiers", d.id, { accepte_le: date.value });
            fermer();
            toast("Acceptation enregistrée.");
            rafraichir();
          },
        },
        champ("Date d'acceptation", date, `L'acompte est attendu ${regl.conditions.delai_jours} jours plus tard.`),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, "Annuler"), h("button", { type: "submit", class: "principal" }, "Enregistrer"))
      )
    );
  };
  const creerFacture = async () => {
    const base = devis ? structuredClone(devis.contenu) : { bandeau: d.bandeau, colonnes: "total", lignes: [], equivalents: { actif: false }, pied: "qr", variante: "qr", tva: true };
    base.montant_recu = null;
    const f = await inserer("documents", { dossier_id: d.id, type: "facture", date_emission: ajd, envoye_le: null, updated_at: new Date().toISOString(), contenu: base });
    naviguer(`#/doc/${f.id}`);
  };

  const modifierDossier = () => {
    const selClient = h("select", { id: "m-client" }, etat.db.clients.map((c) => h("option", { value: c.id, selected: c.id === d.client_id }, nomClient(c))));
    const pays = h("input", { id: "m-pays", value: d.pays });
    const depart = h("input", { id: "m-depart", type: "date", value: d.date_depart || "" });
    const retour = h("input", { id: "m-retour", type: "date", value: d.date_retour || "" });
    const accepte = h("input", { id: "m-accepte", type: "date", value: d.accepte_le || "" });
    const ref = h("input", { id: "m-ref", value: d.ref });
    const fermer = modal(
      "Modifier le dossier",
      h(
        "form",
        {
          class: "modal-corps",
          onsubmit: async (e) => {
            e.preventDefault();
            if (etat.db.dossiers.some((x) => x.id !== d.id && x.ref === ref.value.trim())) {
              toast("Cette référence existe déjà.", true);
              return;
            }
            await modifier("dossiers", d.id, { client_id: selClient.value, pays: pays.value.trim(), date_depart: depart.value || null, date_retour: retour.value || null, accepte_le: accepte.value || null, ref: ref.value.trim() });
            fermer();
            toast("Dossier modifié.");
            rafraichir();
          },
        },
        champ("Client", selClient),
        h("div", { class: "grille-form" }, champ("Pays", pays), champ("Référence", ref), champ("Départ", depart), champ("Retour", retour), champ("Date d'acceptation du devis", accepte, "Laissez vide si le client n'a pas encore accepté.")),
        h("div", { class: "actions" }, h("button", { type: "button", class: "secondaire", onclick: () => fermer() }, "Annuler"), h("button", { type: "submit", class: "principal" }, "Enregistrer"))
      )
    );
  };

  // Paiements
  const dateP = h("input", { id: "p-date", type: "date", value: ajd, required: true });
  const montantP = h("input", { id: "p-montant", type: "number", step: "0.01", min: "0", required: true, inputmode: "decimal" });
  const manque = r.recu < acompte ? arrondi(acompte - r.recu) : Math.max(0, r.reste);
  if (manque > 0) montantP.value = manque;
  const moyenP = h("select", { id: "p-moyen" }, MOYENS.map(([v, l]) => h("option", { value: v }, l)));
  const origineM = h("input", { id: "p-orig-m", type: "number", step: "0.01", min: "0", inputmode: "decimal" });
  const origineD = h("select", { id: "p-orig-d" }, ["", "EUR", "THB", "USD"].map((v) => h("option", { value: v }, v || "Aucune")));
  const noteP = h("input", { id: "p-note" });
  const formPaiement = h(
    "form",
    {
      class: "formulaire en-ligne",
      id: "form-paiement",
      onsubmit: async (e) => {
        e.preventDefault();
        const montant = num(montantP.value);
        if (!montant || montant <= 0) {
          toast("Indiquez un montant supérieur à zéro.", true);
          return;
        }
        await inserer("paiements", {
          dossier_id: d.id,
          date: dateP.value,
          montant,
          type: r.recu < acompte ? "acompte" : "solde",
          moyen: moyenP.value,
          origine_montant: num(origineM.value),
          origine_devise: origineD.value,
          note: noteP.value.trim(),
        });
        toast("Paiement enregistré.");
        rafraichir();
      },
    },
    h("div", { class: "grille-form" }, champ("Date de réception", dateP), champ("Montant reçu (CHF)", montantP), champ("Moyen de paiement", moyenP), champ("Note", noteP), champ("Montant d'origine, si payé en devise", origineM), champ("Devise d'origine", origineD)),
    h("div", { class: "actions" }, h("button", { type: "submit", class: "principal" }, "Enregistrer le paiement"))
  );

  const nomMoyen = (v) => (MOYENS.find(([k]) => k === v) || [0, v])[1];
  const tableauPaiements = paiements.length
    ? h(
        "table",
        { class: "tableau simple" },
        h("thead", null, h("tr", null, ["Date", "Type", "Moyen", "Note", "Montant", ""].map((t, i) => h("th", { scope: "col", class: i === 4 ? "num" : null }, t)))),
        h(
          "tbody",
          null,
          [...paiements]
            .sort((a, b) => (a.date > b.date ? 1 : -1))
            .map((p) =>
              h(
                "tr",
                null,
                h("td", { "data-label": "Date" }, formatDate(p.date)),
                h("td", { "data-label": "Type" }, p.type === "acompte" ? "Acompte" : p.type === "solde" ? "Solde" : "Autre"),
                h("td", { "data-label": "Moyen" }, nomMoyen(p.moyen)),
                h("td", { "data-label": "Note" }, [p.note, p.origine_montant ? `${p.origine_montant} ${p.origine_devise}` : ""].filter(Boolean).join(", ")),
                h("td", { class: "num", "data-label": "Montant" }, formatChf(p.montant)),
                h(
                  "td",
                  { class: "action-cellule" },
                  h(
                    "button",
                    {
                      class: "lien danger-texte",
                      type: "button",
                      "aria-label": `Supprimer le paiement du ${formatDate(p.date)}`,
                      onclick: async () => {
                        if (await confirmer(`Supprimer le paiement de ${formatChf(p.montant)} du ${formatDate(p.date)} ?`, "Supprimer", true)) {
                          await supprimer("paiements", p.id);
                          rafraichir();
                        }
                      },
                    },
                    "Supprimer"
                  )
                )
              )
            )
        )
      )
    : h("p", { class: "vide-court" }, "Aucun paiement enregistré.");

  const ligneDoc = (doc, libelle) => {
    const t = totaux(doc.contenu, doc.type === "facture" && doc.contenu.montant_recu != null ? doc.contenu.montant_recu : 0);
    return h(
      "tr",
      null,
      h("td", { "data-label": "Document" }, h("a", { href: `#/doc/${doc.id}` }, libelle)),
      h("td", { "data-label": "Émis le" }, formatDate(doc.date_emission)),
      h("td", { "data-label": "Envoyé le" }, doc.envoye_le ? formatDate(doc.envoye_le) : "Pas encore"),
      h("td", { class: "num", "data-label": "Total" }, formatChf(t.net)),
      h("td", { class: "action-cellule" }, h("a", { class: "bouton secondaire petit", href: `#/doc/${doc.id}` }, "Ouvrir"), h("button", { class: "secondaire petit", type: "button", onclick: () => pdf(doc) }, "PDF"))
    );
  };

  const notes = h("textarea", {
    id: "notes",
    rows: 3,
    value: d.notes || "",
    onblur: async (e) => {
      if (e.target.value !== (d.notes || "")) {
        await modifier("dossiers", d.id, { notes: e.target.value });
        toast("Notes enregistrées.");
      }
    },
  });
  notes.value = d.notes || "";

  return h(
    "div",
    { "data-titre": nomClient(client) },
    h("a", { class: "retour", href: "#/dossiers" }, "Dossiers"),
    h(
      "div",
      { class: "entete" },
      h("div", null, h("h1", null, nomClient(client)), h("p", { class: "sous" }, h("span", { class: "ref" }, d.ref), d.bandeau ? ` · ${voyageTexte(d.bandeau, d.pays)}` : "")),
      h("div", { class: "entete-actions" }, pastille(r.statut), h("button", { class: "secondaire", type: "button", onclick: modifierDossier }, "Modifier le dossier"))
    ),
    h(
      "div",
      { class: "chiffres compacts" },
      ...[["Total", formatChf(r.total)], [`Acompte (${regl.conditions.acompte_pct}%)`, formatChf(acompte)], ["Reçu", formatChf(r.recu)], ["Reste à payer", formatChf(r.reste)]].map(([l, v]) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, l), h("p", { class: "chiffre-valeur" }, v)))
    ),
    h(
      "section",
      null,
      h("h2", null, "Avancement"),
      h(
        "ol",
        { class: "etapes" },
        etape(!!devis, "Devis créé", devis ? `Émis le ${formatDate(devis.date_emission)}` : "", devis ? h("a", { class: "bouton secondaire petit", href: `#/doc/${devis.id}` }, "Ouvrir le devis") : null),
        etape(!!(devis && devis.envoye_le), "Devis envoyé au client", devis && devis.envoye_le ? `Le ${formatDate(devis.envoye_le)}` : "Une fois le PDF expédié, notez-le ici pour suivre les relances.", devis && !devis.envoye_le ? h("button", { class: "secondaire petit", type: "button", onclick: marquerEnvoye }, "Marquer comme envoyé") : null),
        etape(!!d.accepte_le, "Devis accepté", d.accepte_le ? `Le ${formatDate(d.accepte_le)}${echeance && r.recu < acompte ? `, acompte attendu avant le ${formatDate(echeance)}` : ""}` : "", !d.accepte_le ? h("button", { class: "secondaire petit", type: "button", onclick: accepter }, "Le client a accepté") : null),
        etape(r.recu >= acompte && acompte > 0, "Acompte reçu", r.recu >= acompte && acompte > 0 ? `${formatChf(r.recu)} reçus` : acompte ? `${formatChf(acompte)} attendus` : "Le total du devis est à zéro.", r.recu < acompte ? h("a", { class: "bouton secondaire petit", href: "#form-paiement", onclick: (e) => { e.preventDefault(); document.getElementById("p-montant").focus(); } }, "Enregistrer un paiement") : null),
        etape(!!facture, "Facture", facture ? `Émise le ${formatDate(facture.date_emission)}${facture.envoye_le ? `, envoyée le ${formatDate(facture.envoye_le)}` : ""}` : "À créer quand le carnet de voyage est prêt, ou dès l'acompte reçu.", facture ? h("a", { class: "bouton secondaire petit", href: `#/doc/${facture.id}` }, "Ouvrir la facture") : h("button", { class: "secondaire petit", type: "button", onclick: creerFacture }, "Créer la facture")),
        etape(r.statut === "solde", "Dossier soldé", r.statut === "solde" ? "Tout est encaissé." : r.total ? `Reste ${formatChf(r.reste)} à encaisser.` : "")
      )
    ),
    h(
      "section",
      null,
      h("h2", null, "Documents"),
      r.documents.length
        ? h(
            "table",
            { class: "tableau simple" },
            h("thead", null, h("tr", null, ["Document", "Émis le", "Envoyé le", "Total", ""].map((t, i) => h("th", { scope: "col", class: i === 3 ? "num" : null }, t)))),
            h("tbody", null, r.documents.filter((x) => x.type === "devis").map((x) => ligneDoc(x, "Devis")), r.documents.filter((x) => x.type === "facture").map((x) => ligneDoc(x, "Facture")))
          )
        : h("p", { class: "vide-court" }, "Aucun document.")
    ),
    h("section", null, h("h2", null, "Paiements reçus"), tableauPaiements, h("h3", null, "Enregistrer un paiement"), formPaiement),
    h("section", null, h("h2", null, "Notes internes"), champ("Visibles seulement ici, jamais sur les documents", notes)),
    h(
      "section",
      { class: "zone-danger" },
      h("h2", null, d.annule ? "Dossier annulé" : "Annuler ou supprimer"),
      h(
        "div",
        { class: "actions gauche" },
        h(
          "button",
          {
            class: "secondaire",
            type: "button",
            onclick: async () => {
              if (d.annule || (await confirmer("Marquer ce dossier comme annulé ? Il sortira des totaux à encaisser mais restera consultable.", "Marquer comme annulé"))) {
                await modifier("dossiers", d.id, { annule: !d.annule });
                rafraichir();
              }
            },
          },
          d.annule ? "Réactiver le dossier" : "Marquer comme annulé"
        ),
        h(
          "button",
          {
            class: "danger",
            type: "button",
            onclick: async () => {
              if (await confirmer("Supprimer définitivement ce dossier avec ses documents et ses paiements ? Cette action est irréversible.", "Supprimer définitivement", true)) {
                await supprimer("dossiers", d.id);
                naviguer("#/dossiers");
                toast("Dossier supprimé.");
              }
            },
          },
          "Supprimer le dossier"
        )
      )
    )
  );
}
