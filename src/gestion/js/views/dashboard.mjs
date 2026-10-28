import { etat, resumes, nomClient, reglages, estAdmin, entiteActive, peut, paiementsPeriode } from "../etat.mjs";
import { reglagesIncomplets } from "../defauts.mjs";
import { h } from "../ui.mjs";
import { aFaire, aujourdhui, formatMontant, formatSommes, formatDate, acompteDu, joursEntre, nomMois } from "../calc.mjs";
import { pastille } from "./commun.mjs";

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

function phrase(item) {
  const r = item.resume;
  if (item.type === "acompte_retard") {
    const manque = acompteDu(r.total, reglages().conditions.acompte_pct) - r.recu;
    return `Acompte attendu depuis ${pluriel(item.jours, "jour", "jours")} (${formatMontant(manque, r.devise)})`;
  }
  if (item.type === "solde_proche") return `Départ dans ${pluriel(item.jours, "jour", "jours")}, reste ${formatMontant(r.reste, r.devise)} à encaisser`;
  return `Devis envoyé il y a ${pluriel(item.jours, "jour", "jours")}, sans réponse`;
}

export async function tableauDeBord() {
  const ajd = aujourdhui();
  const manque = reglagesIncomplets(reglages());
  const rs = resumes();
  const encaisser = rs.filter((r) => r.statut === "accepte" || r.statut === "acompte");
  const attente = rs.filter((r) => r.statut === "devis_envoye");
  const deviseDe = Object.fromEntries(rs.map((r) => [r.dossier.id, r.devise]));
  const ceMois = await paiementsPeriode(`${ajd.slice(0, 7)}-01`, `${ajd.slice(0, 7)}-31`);
  const taches = aFaire(rs, ajd, reglages());
  const departs = rs
    .filter((r) => r.dossier.date_depart && r.statut !== "annule" && r.dossier.date_depart >= ajd && joursEntre(ajd, r.dossier.date_depart) <= 60)
    .sort((a, b) => (a.dossier.date_depart > b.dossier.date_depart ? 1 : -1));

  const chiffre = (valeur, libelle, detail) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, libelle), h("p", { class: "chiffre-valeur" }, valeur), h("p", { class: "chiffre-detail" }, detail));

  return h(
    "div",
    { "data-titre": "Tableau de bord" },
    manque.length
      ? h("div", { class: "bandeau-info", role: "status" }, `Les réglages de ${entiteActive().nom} ne sont pas terminés : il manque ${manque.join(", ")}. `, estAdmin() ? h("a", { href: "#/reglages" }, "Les compléter") : "Prévenez l'administratrice.")
      : null,
    h("div", { class: "entete" }, h("h1", null, "Tableau de bord"), peut("dossiers.ecrire") ? h("a", { class: "bouton principal", href: "#/dossiers/nouveau" }, "Nouveau dossier") : null),
    peut("finances.voir") ? h(
      "div",
      { class: "chiffres" },
      chiffre(formatSommes(encaisser.map((r) => ({ montant: r.reste, devise: r.devise })), reglages().devise), "Reste à encaisser", pluriel(encaisser.length, "dossier accepté", "dossiers acceptés")),
      chiffre(formatSommes(ceMois.map((p) => ({ montant: p.montant, devise: deviseDe[p.dossier_id] })), reglages().devise), `Encaissé en ${nomMois(ajd)}`, pluriel(ceMois.length, "paiement", "paiements")),
      chiffre(formatSommes(attente.map((r) => ({ montant: r.total, devise: r.devise })), reglages().devise), "Devis en attente de réponse", pluriel(attente.length, "devis envoyé", "devis envoyés"))
    ) : null,
    h("section", null, h("h2", null, "À faire"), taches.length
      ? h(
          "ul",
          { class: "taches" },
          taches.map((t) =>
            h(
              "li",
              null,
              h("div", null, h("a", { class: "tache-nom", href: `#/dossier/${t.resume.dossier.id}` }, nomClient(t.resume.client)), h("span", { class: "ref" }, t.resume.dossier.ref)),
              h("p", null, phrase(t)),
              h("a", { class: "bouton secondaire", href: `#/dossier/${t.resume.dossier.id}` }, "Ouvrir le dossier")
            )
          )
        )
      : h("p", { class: "vide-court" }, "Rien en attente. Les acomptes en retard, devis à relancer et soldes avant départ s'afficheront ici.")),
    h(
      "section",
      null,
      h("h2", null, "Départs dans les 60 prochains jours"),
      departs.length
        ? h(
            "table",
            { class: "tableau simple" },
            h("thead", null, h("tr", null, ["Départ", "Client", "Voyage", "Statut", "Reste à payer"].map((t) => h("th", { scope: "col" }, t)))),
            h(
              "tbody",
              null,
              departs.map((r) =>
                h(
                  "tr",
                  null,
                  h("td", { "data-label": "Départ" }, formatDate(r.dossier.date_depart)),
                  h("td", { "data-label": "Client" }, h("a", { href: `#/dossier/${r.dossier.id}` }, nomClient(r.client))),
                  h("td", { "data-label": "Voyage" }, r.dossier.pays),
                  h("td", { "data-label": "Statut" }, pastille(r.statut)),
                  h("td", { class: "num", "data-label": "Reste à payer" }, formatMontant(r.reste, r.devise))
                )
              )
            )
          )
        : h("p", { class: "vide-court" }, "Aucun départ renseigné dans les 60 prochains jours.")
    )
  );
}
