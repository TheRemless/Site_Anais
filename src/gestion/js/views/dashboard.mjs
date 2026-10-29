import { etat, resumes, nomClient, reglages, estAdmin, entiteActive, peut, paiementsPeriode, moduleActif } from "../etat.mjs";
import { reglagesIncomplets } from "../defauts.mjs";
import { h } from "../ui.mjs";
import { aFaire, aujourdhui, formatMontant, formatSommes, formatDate, acompteDu, joursEntre, nomMois } from "../calc.mjs";
import { pastille, cartes, voyageTexte } from "./commun.mjs";
import { mesTaches, listeTaches } from "./taches.mjs";
import { contratsAEcheance } from "../partenaires-calc.mjs";
import { agenda } from "../operations-calc.mjs";
import { listeReservations } from "./reservations.mjs";

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// « Mercredi 29 octobre », pour le sous-titre de l'écran Aujourd'hui.
function dateLongue(d = new Date()) {
  const t = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

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
  const contrats = peut("partenaires.lire") && moduleActif("partenaires") ? contratsAEcheance(etat.db.partenaires, ajd) : [];
  const ag = agenda(etat.db.reservations, ajd);
  const aConfirmer = [...ag.enRetard, ...ag.aConfirmer];
  const rafraichir = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
  const sectionAgenda = (titre, rs, videTexte) => h("section", null, h("h2", null, titre, h("span", { class: "tag" }, rs.length)), rs.length ? listeReservations(rs, { apres: rafraichir }) : h("p", { class: "vide-court" }, videTexte));
  const departs = rs
    .filter((r) => r.dossier.date_depart && r.statut !== "annule" && r.dossier.date_depart >= ajd && joursEntre(ajd, r.dossier.date_depart) <= 60)
    .sort((a, b) => (a.dossier.date_depart > b.dossier.date_depart ? 1 : -1));

  const chiffre = (valeur, libelle, detail) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, libelle), h("p", { class: "chiffre-valeur" }, valeur), h("p", { class: "chiffre-detail" }, detail));

  return h(
    "div",
    { "data-titre": "Aujourd'hui" },
    manque.length
      ? h("div", { class: "bandeau-info", role: "status" }, `Les réglages de ${entiteActive().nom} ne sont pas terminés : il manque ${manque.join(", ")}. `, estAdmin() ? h("a", { href: "#/reglages" }, "Les compléter") : "Prévenez l'administratrice.")
      : null,
    h("div", { class: "entete" }, h("div", null, h("h1", null, "Aujourd'hui"), h("p", { class: "sous" }, dateLongue())), peut("dossiers.ecrire") ? h("a", { class: "bouton principal", href: "#/dossiers/nouveau" }, "Nouveau dossier") : null),
    peut("finances.voir") ? h(
      "div",
      { class: "chiffres" },
      chiffre(formatSommes(encaisser.map((r) => ({ montant: r.reste, devise: r.devise })), reglages().devise), "Reste à encaisser", pluriel(encaisser.length, "dossier accepté", "dossiers acceptés")),
      chiffre(formatSommes(ceMois.map((p) => ({ montant: p.montant, devise: deviseDe[p.dossier_id] })), reglages().devise), `Encaissé en ${nomMois(ajd)}`, pluriel(ceMois.length, "paiement", "paiements")),
      chiffre(formatSommes(attente.map((r) => ({ montant: r.total, devise: r.devise })), reglages().devise), "Devis en attente de réponse", pluriel(attente.length, "devis envoyé", "devis envoyés"))
    ) : null,
    moduleActif("reservations") ? sectionAgenda("Départs et pickups aujourd'hui", ag.aujourdhui, "Aucun service aujourd'hui.") : null,
    moduleActif("reservations") && ag.demain.length ? sectionAgenda("Demain", ag.demain, "") : null,
    moduleActif("reservations") && aConfirmer.length
      ? h("section", null, h("h2", null, "À confirmer auprès des partenaires", h("span", { class: "tag" }, aConfirmer.length)), listeReservations(aConfirmer.slice(0, 6), { apres: rafraichir }), aConfirmer.length > 6 ? h("p", { class: "plus" }, h("a", { href: "#/reservations?statut=ouvertes" }, `Voir les ${aConfirmer.length} réservations à confirmer`)) : null)
      : null,
    mesTaches().length
      ? h("section", null, h("h2", null, "Mes tâches"), listeTaches(mesTaches().slice(0, 6)), mesTaches().length > 6 ? h("p", { class: "plus" }, h("a", { href: "#/taches" }, `Voir les ${mesTaches().length} tâches`)) : h("p", { class: "plus" }, h("a", { href: "#/taches" }, "Toutes les tâches")))
      : null,
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
    contrats.length
      ? h(
          "section",
          null,
          h("h2", null, "Contrats de partenaires à renouveler"),
          h("ul", { class: "taches" }, contrats.map((c) => h("li", null, h("div", null, h("a", { class: "tache-nom", href: `#/partenaire/${c.partenaire.id}` }, c.partenaire.nom)), h("p", null, c.passe ? `Contrat terminé le ${formatDate(c.fin)}` : `Contrat jusqu'au ${formatDate(c.fin)}, à renouveler`), h("a", { class: "bouton secondaire", href: `#/partenaire/${c.partenaire.id}` }, "Ouvrir la fiche"))))
        )
      : null,
    h(
      "section",
      null,
      h("h2", null, "Départs dans les 60 prochains jours"),
      departs.length
        ? cartes(departs, (r) =>
            h(
              "a",
              { class: "carte-lien", href: `#/dossier/${r.dossier.id}` },
              h("span", { class: "carte-titre" }, nomClient(r.client)),
              h("span", { class: "carte-droite" }, h("strong", null, formatDate(r.dossier.date_depart)), r.reste > 0 ? h("span", null, `reste ${formatMontant(r.reste, r.devise)}`) : null),
              h("span", { class: "carte-sous" }, voyageTexte(r.dossier.bandeau, r.dossier.pays)),
              h("span", { class: "carte-pied" }, pastille(r.statut))
            )
          )
        : null,
      departs.length
        ? h(
            "table",
            { class: "tableau simple seulement-bureau" },
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
