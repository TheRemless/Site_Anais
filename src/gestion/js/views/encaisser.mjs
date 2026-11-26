// À encaisser : ce que les clients doivent encore à l'agence, et les commissions que les prestataires reversent après les services payés sur place.
// Chaque entreprise ne voit que ce qui la concerne : Zwald les clients seulement, Secret les deux, Taxi les commissions seulement (le client paie toujours le chauffeur).
// Les commissions se rapprochent dossier par dossier : Anaïs coche ce que le partenaire a payé et encaisse la sélection (encaisser-commissions.mjs).
import { etat, peut, naviguer, nomClient, resumes, reglages, modeExcursions, modeTaxi } from "../etat.mjs";
import { statutReservation } from "../operations-calc.mjs";
import { h } from "../ui.mjs";
import { formatMontant, formatSommes, formatDate } from "../calc.mjs";
import { vide, listeAdaptative } from "./commun.mjs";
import { voitNets, prix } from "./partenaires.mjs";
import { sectionCommissions } from "./encaisser-commissions.mjs";
import { bandeauRecalcul } from "./recalcul-commission.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

export function vueEncaisser() {
  const voitClients = peut("finances.voir") && !modeTaxi();
  const voitCommissions = voitNets() && modeExcursions();
  if (!voitClients && !voitCommissions) return h("div", { "data-titre": tr("À encaisser") }, h("div", { class: "entete" }, h("h1", null, tr("À encaisser"))), vide(tr("Accès réservé"), tr("Cet écran demande le droit de voir les montants.")));
  const rafraichir = () => naviguer(location.hash);
  const ecrit = peut("dossiers.ecrire");

  // ---- Les clients ----
  const dus = voitClients ? resumes().filter((r) => (r.statut === "accepte" || r.statut === "acompte") && r.reste > 0).sort((a, b) => (a.dossier.date_depart || "9999").localeCompare(b.dossier.date_depart || "9999") || b.reste - a.reste) : [];
  const devise = reglages().devise;
  // Remboursements à traiter (migration 131) : un acompte rattaché à un service annulé ne passe à aucun autre service ; il revient au client.
  const aRembourser = voitClients
    ? (etat.db.reservations || [])
        .filter((x) => statutReservation(x.statut) === "annule")
        .map((x) => ({ r: x, montant: Math.round((etat.db.paiements || []).filter((p) => p.reservation_id === x.id).reduce((t, p) => t + (Number(p.montant) || 0), 0) * 100) / 100, dossier: (etat.db.dossiers || []).find((d) => d.id === x.dossier_id) || null }))
        .filter((x) => x.montant > 0 && x.dossier)
    : [];

  // ---- Les commissions : par partenaire puis par dossier, voir encaisser-commissions.mjs ----
  const commissions = voitCommissions ? sectionCommissions({ rafraichir, ecrit }) : null;
  // Deux lignes pour le montant d'une carte : la valeur, puis ce qu'elle représente.
  const pile = (valeur, legende) => h("span", { class: "droite-pile" }, h("strong", null, valeur), h("span", null, legende));

  const listeClients = () =>
    listeAdaptative({
      items: dus,
      colonnes: [
        { cle: "client", titre: tr("Client"), rendu: (r) => nomClient(r.client), tri: (r) => nomClient(r.client).toLowerCase(), mobile: "titre" },
        { cle: "ref", titre: tr("Référence"), rendu: (r) => r.dossier.ref, tri: (r) => r.dossier.ref, mobile: "sous" },
        { cle: "depart", titre: tr("Départ"), rendu: (r) => (r.dossier.date_depart ? formatDate(r.dossier.date_depart) : "—"), rendu_mobile: (r) => (r.dossier.date_depart ? tr("départ le {date}", { date: formatDate(r.dossier.date_depart) }) : null), tri: (r) => r.dossier.date_depart || "9999", mobile: "sous" },
        { cle: "total", titre: tr("Total"), num: true, rendu: (r) => formatMontant(r.total, r.devise), mobile: false },
        { cle: "recu", titre: tr("Reçu"), num: true, rendu: (r) => formatMontant(r.recu, r.devise), mobile: false },
        { cle: "reste", titre: tr("Reste"), num: true, tri: (r) => r.reste, rendu: (r) => h("strong", null, formatMontant(r.reste, r.devise)), rendu_mobile: (r) => pile(formatMontant(r.reste, r.devise), tr("à régler")), mobile: "droite" },
      ],
      lien: (r) => `#/dossier/${r.dossier.id}`,
      tri: { cle: "depart" },
    }).noeud;

  const chiffre = (libelle, valeur, detail) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, libelle), h("p", { class: "chiffre-valeur" }, valeur), h("p", { class: "chiffre-detail" }, detail || " "));
  const rienADire = !dus.length && !aRembourser.length && (!commissions || commissions.rien);

  return h(
    "div",
    { "data-titre": tr("À encaisser"), "data-large": true },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("À encaisser")), h("p", { class: "sous" }, modeTaxi() ? tr("Les commissions que le chauffeur reverse après les courses : le client le paie toujours directement.") : modeExcursions() ? tr("Ce que les clients doivent encore à l'agence, et les commissions que les prestataires reversent après les services payés sur place.") : tr("Ce que les clients doivent encore à l'agence.")))),
    h(
      "div",
      { class: "chiffres compacts" },
      voitClients ? chiffre(tr("Clients"), formatSommes(dus.map((r) => ({ montant: r.reste, devise: r.devise })), devise), pluriel(dus.length, N_("dossier à régler"), N_("dossiers à régler"))) : null,
      commissions ? chiffre(tr("Commissions"), prix(commissions.total), pluriel(commissions.nbPartenaires, N_("partenaire à rapprocher"), N_("partenaires à rapprocher"))) : null
    ),
    // Toujours là, même sans commission en attente : une règle de partenaire posée ou changée après coup se rattrape d'ici (pas en Taxi, où la commission se saisit à la main).
    voitCommissions && ecrit && !modeTaxi() ? bandeauRecalcul(rafraichir) : null,
    rienADire ? vide(tr("Rien à encaisser"), modeTaxi() ? tr("Aucune commission n'est en attente.") : modeExcursions() ? tr("Les clients ont tout payé et aucune commission n'est en attente.") : tr("Les clients ont tout payé.")) : null,
    dus.length ? h("section", null, h("h2", null, tr("Les clients doivent")), listeClients()) : null,
    aRembourser.length
      ? h("section", null, h("h2", null, tr("Remboursements à traiter")), h("p", { class: "aide" }, tr("Un acompte versé pour un service annulé : à rembourser au client, ou à rattacher à un autre service dans le dossier.")), h("ul", { class: "liste-simple" }, aRembourser.map((x) => h("li", null, h("a", { href: `#/dossier/${x.dossier.id}` }, `${x.dossier.ref} · ${x.r.libelle}`), " · ", h("strong", null, formatMontant(x.montant, devise))))))
      : null,
    commissions ? commissions.noeud : null
  );
}
