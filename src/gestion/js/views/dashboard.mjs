import { etat, modifier, resumes, netReservation, nomClient, nomPartenaire, reglages, estAdmin, entiteActive, peut, paiementsPeriode, moduleActif, dossiersAnnules, modeExcursions, modeTaxi } from "../etat.mjs";
import { reglagesIncomplets } from "../defauts.mjs";
import { ouvrirDemande } from "./demande.mjs";
import { sectionCommissionsHier } from "./taxi-hier.mjs";
import { h, icone } from "../ui.mjs";
import { aFaire, aujourdhui, formatMontant, formatSommes, formatDate, acompteDu, joursEntre, nomMois, finDuMois } from "../calc.mjs";
import { pastille, cartes, voyageTexte, lienDossier } from "./commun.mjs";
import { mesTaches, listeTaches } from "./taches.mjs";
import { contratsAEcheance, chiffres as numeroDe } from "../partenaires-calc.mjs";
import { agenda, personnesTexte, cleMessageReservation, avisParClient } from "../operations-calc.mjs";
import { listeReservations, pastilleReservation, messageClient } from "./reservations.mjs";
import { tr, N_, pluriel, dateLongue } from "../i18n.mjs";
import { ouvrirSansSuite, baseDistante } from "./sans-suite.mjs";
import { disponible as sansSuiteDisponible } from "../sans-suite-calc.mjs";


function phrase(item) {
  const r = item.resume;
  if (item.type === "acompte_retard") {
    const manque = acompteDu(r.total, reglages().conditions.acompte_pct) - r.recu;
    return tr("Acompte attendu depuis {jours} ({montant})", { jours: pluriel(item.jours, N_("jour"), N_("jours")), montant: formatMontant(manque, r.devise) });
  }
  if (item.type === "trop_percu") return tr("Trop-perçu de {montant} à rembourser", { montant: formatMontant(r.recu - r.total, r.devise) });
  if (item.type === "solde_du") return tr("Carnet envoyé le {date}, solde de {montant} à encaisser", { date: formatDate(r.dossier.carnet_envoye_le), montant: formatMontant(r.reste, r.devise) });
  if (item.type === "solde_proche") return tr("Départ dans {jours}, reste {montant} à encaisser", { jours: pluriel(item.jours, N_("jour"), N_("jours")), montant: formatMontant(r.reste, r.devise) });
  return tr("Devis envoyé il y a {jours}, sans réponse", { jours: pluriel(item.jours, N_("jour"), N_("jours")) });
}


// Un service du jour : l'heure de pickup en grand, ce qu'il faut savoir, et d'un geste appeler ou écrire au client.
function carteService(r) {
  const d = etat.db.dossiers.find((x) => x.id === r.dossier_id);
  const c = d && etat.db.clients.find((x) => x.id === d.client_id);
  const tel = c ? numeroDe(c.telephone) : "";
  const wa = tel.replace(/\D/g, "");
  const detail = [c ? nomClient(c) : "", nomPartenaire(r.partenaire_id), personnesTexte(r.personnes)].filter(Boolean).join(" · ");
  return h(
    "li",
    { class: "service" },
    h("div", { class: "service-heure" }, h("strong", null, r.heure_pickup || "—"), r.heure_pickup ? h("span", null, tr("pickup")) : null),
    h(
      "div",
      { class: "service-corps" },
      h("div", { class: "service-titre" }, lienDossier(r.libelle, d && d.id)),
      detail ? h("p", { class: "service-detail" }, detail) : null,
      r.lieu_pickup ? h("p", { class: "service-detail" }, r.lieu_pickup) : null,
      h(
        "div",
        { class: "service-pied" },
        r.statut === "annule" ? pastilleReservation("annule") : null,
        tel ? h("a", { class: "bouton secondaire petit", href: `tel:${tel}`, "aria-label": tr("Appeler {nom}", { nom: nomClient(c) }) }, icone("telephone", 16), tr("Appeler")) : null,
        // Le message prêt d'après la date du service (rappel la veille, confirmation le jour, avis après) : jamais une conversation vide à rédiger.
        wa ? h("button", { class: "secondaire petit", type: "button", onclick: () => messageClient(r, cleMessageReservation(r, aujourdhui())), "aria-label": tr("WhatsApp à {nom}", { nom: nomClient(c) }) }, icone("whatsapp", 16), tr("WhatsApp")) : null
      )
    )
  );
}
const listeServices = (rs) => h("ul", { class: "services" }, rs.map(carteService));

export async function tableauDeBord() {
  const ajd = aujourdhui();
  const manque = reglagesIncomplets(reglages());
  const rs = resumes();
  const encaisser = rs.filter((r) => r.statut === "accepte" || r.statut === "acompte");
  const attente = rs.filter((r) => r.statut === "devis_envoye");
  const deviseDe = Object.fromEntries(rs.map((r) => [r.dossier.id, r.devise]));
  const ceMois = await paiementsPeriode(`${ajd.slice(0, 7)}-01`, finDuMois(ajd));
  const taches = aFaire(rs, ajd, reglages());
  const contrats = peut("partenaires.lire") && moduleActif("partenaires") ? contratsAEcheance(etat.db.partenaires, ajd) : [];
  const ag = agenda(etat.db.reservations, ajd, dossiersAnnules(), { netDe: netReservation });
  const rafraichir = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
  // Hier : une demande d'avis par client, même avec plusieurs services. « Demander l'avis » ouvre le message prêt et, une fois parti, note la date sur ses services.
  const clientIdDe = (r) => (etat.db.dossiers.find((x) => x.id === r.dossier_id) || {}).client_id || null;
  const marquerAvis = async (g) => {
    for (const x of g.reservations) await modifier("reservations", x.id, { details: { ...(x.details || {}), avis_demande_le: ajd } });
    rafraichir();
  };
  const sectionAvis = (titre, rs) => {
    const demandes = avisParClient(rs, clientIdDe);
    return h(
      "section",
      null,
      h("h2", null, titre, h("span", { class: "tag" }, demandes.length)),
      h("ul", { class: "cartes" }, demandes.map((g) => {
        const client = etat.db.clients.find((c) => c.id === g.clientId);
        return h("li", { class: "carte" }, h("div", { class: "carte-lien statique" },
          h("span", { class: "carte-titre" }, lienDossier(client ? nomClient(client) : tr("Client inconnu"), g.premiere.dossier_id)),
          h("span", { class: "carte-sous" }, g.reservations.map((x) => x.libelle).join(" · ")),
          h("span", { class: "carte-pied" }, g.demandeLe ? h("span", { class: "tag" }, tr("Avis demandé le {date}", { date: formatDate(g.demandeLe) })) : h("button", { class: "principal petit", type: "button", onclick: () => messageClient(g.premiere, "avis", { surEnvoi: () => marquerAvis(g) }) }, icone("whatsapp", 16), tr("Demander l'avis")))
        ));
      }))
    );
  };
  const sectionAgenda = (titre, rs, videTexte) => h("section", null, h("h2", null, titre, h("span", { class: "tag" }, rs.length)), rs.length ? listeReservations(rs, { apres: rafraichir }) : h("p", { class: "vide-court" }, videTexte));
  const departs = rs
    .filter((r) => r.dossier.date_depart && r.statut !== "annule" && r.dossier.date_depart >= ajd && joursEntre(ajd, r.dossier.date_depart) <= 60)
    .sort((a, b) => (a.dossier.date_depart > b.dossier.date_depart ? 1 : -1));

  const chiffre = (valeur, libelle, detail, lien = null) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, lien ? h("a", { class: "chiffre-lien", href: lien }, libelle) : libelle), h("p", { class: "chiffre-valeur" }, valeur), h("p", { class: "chiffre-detail" }, detail));

  return h(
    "div",
    { "data-titre": tr("Aujourd'hui") },
    manque.length
      ? h("div", { class: "bandeau-info", role: "status" }, tr("Les réglages de {nom} ne sont pas terminés : il manque {liste}. ", { nom: entiteActive().nom, liste: manque.join(", ") }), estAdmin() ? h("a", { href: "#/reglages" }, tr("Les compléter")) : tr("Prévenez l'administratrice."))
      : null,
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Aujourd'hui")), h("p", { class: "sous" }, dateLongue())), peut("dossiers.ecrire") ? h("div", { class: "entete-actions" }, modeExcursions() ? h("button", { class: "secondaire seulement-bureau", type: "button", onclick: ouvrirDemande }, tr("Coller une demande")) : null, h("a", { class: "bouton principal seulement-bureau", href: "#/dossiers/nouveau" }, tr("Nouveau dossier"))) : null),
    moduleActif("reservations") ? h("section", { class: "section-jour" }, h("h2", null, tr("Départs et pickups aujourd'hui"), h("span", { class: "tag" }, ag.aujourdhui.length)), ag.aujourdhui.length ? listeServices(ag.aujourdhui) : h("p", { class: "vide-court" }, tr("Aucun service aujourd'hui."))) : null,
    // Les locations commencées et pas encore rendues : une ligne chacune, avec la date de retour sur la carte.
    moduleActif("reservations") && ag.enCours.length ? h("section", { class: "section-jour" }, h("h2", null, tr("Locations en cours"), h("span", { class: "tag" }, ag.enCours.length)), listeReservations(ag.enCours, { apres: rafraichir })) : null,
    moduleActif("reservations") && ag.demain.length ? h("section", { class: "section-jour" }, h("h2", null, tr("Demain"), h("span", { class: "tag" }, ag.demain.length)), listeServices(ag.demain)) : null,
    // Taxi : rien ne s'encaisse chez Anaïs (le client paie le chauffeur), ces chiffres resteraient à zéro.
    peut("finances.voir") && !modeTaxi() ? h(
      "div",
      { class: "chiffres rail" },
      chiffre(formatSommes(encaisser.map((r) => ({ montant: r.reste, devise: r.devise })), reglages().devise), tr("Reste à encaisser"), modeExcursions() ? pluriel(encaisser.length, N_("dossier à régler"), N_("dossiers à régler")) : pluriel(encaisser.length, N_("dossier accepté"), N_("dossiers acceptés")), "#/dossiers?onglet=encaisser&tri=reste"),
      chiffre(formatSommes(ceMois.map((p) => ({ montant: p.montant, devise: deviseDe[p.dossier_id] })), reglages().devise), tr("Encaissé en {mois}", { mois: nomMois(ajd) }), pluriel(ceMois.length, N_("paiement"), N_("paiements"))),
      modeExcursions() ? null : chiffre(formatSommes(attente.map((r) => ({ montant: r.total, devise: r.devise })), reglages().devise), tr("Devis en attente de réponse"), pluriel(attente.length, N_("devis envoyé"), N_("devis envoyés")), "#/dossiers?onglet=attente")
    ) : null,
    moduleActif("reservations") && ag.hier.length ? sectionAvis(tr("Hier : à recontacter pour avoir leur avis"), ag.hier) : null,
    // Taxi : la commission de chaque course d'hier se demande à Mr. Brown puis se saisit (aucune par défaut).
    modeTaxi() && moduleActif("reservations") ? sectionCommissionsHier(rafraichir) : null,
    mesTaches().length
      ? h("section", null, h("h2", null, tr("Mes tâches")), listeTaches(mesTaches().slice(0, 6)), mesTaches().length > 6 ? h("p", { class: "plus" }, h("a", { href: "#/taches" }, tr("Voir les {n} tâches", { n: mesTaches().length }))) : h("p", { class: "plus" }, h("a", { href: "#/taches" }, tr("Toutes les tâches"))))
      : null,
    // Secret et Taxi n'ont ni acompte, ni devis à relancer, ni solde avant départ : la section n'apparaît que si elle a des tâches.
    taches.length || !modeExcursions() ? h("section", null, h("h2", null, tr("À faire")), taches.length
      ? h(
          "ul",
          { class: "taches" },
          taches.map((t) =>
            h(
              "li",
              null,
              h("div", null, h("a", { class: "tache-nom", href: `#/dossier/${t.resume.dossier.id}` }, nomClient(t.resume.client)), h("span", { class: "ref" }, t.resume.dossier.ref)),
              h("p", null, phrase(t)),
              h(
                "div",
                { class: "tache-actions" },
                h("a", { class: "bouton secondaire", href: `#/dossier/${t.resume.dossier.id}` }, tr("Ouvrir le dossier")),
                // Un devis resté sans réponse se classe d'un tap, avec son motif : il sort des relances.
                t.type === "devis_relance" && peut("dossiers.ecrire") && sansSuiteDisponible(t.resume.dossier, baseDistante()) ? h("button", { class: "secondaire", type: "button", onclick: () => ouvrirSansSuite(t.resume.dossier, rafraichir) }, tr("Sans suite")) : null
              )
            )
          )
        )
      : h("p", { class: "vide-court" }, tr("Rien en attente. Les acomptes en retard, devis à relancer et soldes avant départ s'afficheront ici."))) : null,
    contrats.length
      ? h(
          "section",
          null,
          h("h2", null, tr("Contrats de partenaires à renouveler")),
          h("ul", { class: "taches" }, contrats.map((c) => h("li", null, h("div", null, h("a", { class: "tache-nom", href: `#/partenaire/${c.partenaire.id}` }, c.partenaire.nom)), h("p", null, c.passe ? tr("Contrat terminé le {date}", { date: formatDate(c.fin) }) : tr("Contrat jusqu'au {date}, à renouveler", { date: formatDate(c.fin) })), h("a", { class: "bouton secondaire", href: `#/partenaire/${c.partenaire.id}` }, tr("Ouvrir la fiche")))))
        )
      : null,
    // Les départs de voyage (date de départ, voyage, reste à payer) n'existent que pour les voyages sur mesure.
    modeExcursions() ? null : h(
      "section",
      null,
      h("h2", null, tr("Départs dans les 60 prochains jours")),
      departs.length
        ? cartes(departs, (r) =>
            h(
              "a",
              { class: "carte-lien", href: `#/dossier/${r.dossier.id}` },
              h("span", { class: "carte-titre" }, nomClient(r.client)),
              h("span", { class: "carte-droite" }, h("strong", null, formatDate(r.dossier.date_depart)), r.reste > 0 ? h("span", null, tr("reste {montant}", { montant: formatMontant(r.reste, r.devise) })) : null),
              h("span", { class: "carte-sous" }, voyageTexte(r.dossier.bandeau, r.dossier.pays)),
              h("span", { class: "carte-pied" }, pastille(r.statut))
            )
          )
        : null,
      departs.length
        ? h(
            "table",
            { class: "tableau simple seulement-bureau" },
            h("thead", null, h("tr", null, [tr("Départ"), tr("Client"), tr("Voyage"), tr("Statut"), tr("Reste à payer")].map((t) => h("th", { scope: "col" }, t)))),
            h(
              "tbody",
              null,
              departs.map((r) =>
                h(
                  "tr",
                  null,
                  h("td", { "data-label": tr("Départ") }, formatDate(r.dossier.date_depart)),
                  h("td", { "data-label": tr("Client") }, h("a", { href: `#/dossier/${r.dossier.id}` }, nomClient(r.client))),
                  h("td", { "data-label": tr("Voyage") }, voyageTexte(r.dossier.bandeau, r.dossier.pays)),
                  h("td", { "data-label": tr("Statut") }, pastille(r.statut)),
                  h("td", { class: "num", "data-label": tr("Reste à payer") }, formatMontant(r.reste, r.devise))
                )
              )
            )
          )
        : h("p", { class: "vide-court" }, tr("Aucun départ renseigné dans les 60 prochains jours."))
    )
  );
}
