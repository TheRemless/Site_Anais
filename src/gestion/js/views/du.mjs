// Dû aux partenaires : par partenaire et par mois, net prévu, net payé, reste et marge. Réservé au droit « prix nets ».
import { etat, peut, naviguer, nomPartenaire, netReservation, enregistrerLie, dossiersAnnules } from "../etat.mjs";
import { h, confirmer, toast } from "../ui.mjs";
import { aujourdhui } from "../calc.mjs";
import { duParPartenaire, nomMoisCourt } from "../operations-calc.mjs";
import { vide, listeAdaptative } from "./commun.mjs";
import { prix, margeNoeud, voitNets } from "./partenaires.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

export function vueDu() {
  if (!voitNets()) return h("div", { "data-titre": tr("Dû aux partenaires") }, h("div", { class: "entete" }, h("h1", null, tr("Dû aux partenaires"))), vide(tr("Accès réservé"), tr("Cet écran demande le droit de voir les prix nets des partenaires.")));
  const lignes = duParPartenaire(etat.db.reservations, netReservation, dossiersAnnules());
  const rafraichir = () => naviguer(location.hash);
  const ecrit = peut("dossiers.ecrire");
  const total = lignes.reduce((s, l) => ({ net_prevu: s.net_prevu + l.net_prevu, net_paye: s.net_paye + l.net_paye, reste: s.reste + l.reste, vente: s.vente + l.vente, venteAvecNet: s.venteAvecNet + l.venteAvecNet }), { net_prevu: 0, net_paye: 0, reste: 0, vente: 0, venteAvecNet: 0 });
  const payer = async (g) => {
    const a = g.reservations.filter((r) => { const n = netReservation(r); return n && n.net_prevu != null && (n.net_paye == null || Number(n.net_paye) < Number(n.net_prevu)); });
    if (!a.length) return toast(tr("Rien à marquer : tout est déjà payé ou sans net."));
    if (!(await confirmer(tr("Marquer payé {montant} à {partenaire} pour {mois} ({reservations}) ?", { montant: prix(g.reste), partenaire: nomPartenaire(g.partenaire_id) || tr("ce partenaire"), mois: nomMoisCourt(g.mois), reservations: pluriel(a.length, N_("réservation"), N_("réservations")) }), tr("Marquer payé")))) return;
    for (const r of a) {
      const n = netReservation(r);
      await enregistrerLie("reservations_nets", "reservation_id", r.id, { net_prevu: n.net_prevu, net_paye: n.net_prevu, paye_le: aujourdhui() });
    }
    toast(tr("Paiement noté."));
    rafraichir();
  };
  const nom = (g) => nomPartenaire(g.partenaire_id) || tr("Sans partenaire");
  const lien = (g) => `#/reservations?periode=toutes&partenaire=${g.partenaire_id || ""}`;
  return h(
    "div",
    { "data-titre": tr("Dû aux partenaires"), "data-large": true },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Dû aux partenaires")), h("p", { class: "sous" }, tr("Ce que les partenaires vont facturer, par mois du service, d'après les réservations. À rapprocher de leurs factures.")))),
    h(
      "div",
      { class: "chiffres compacts" },
      [[tr("Net prévu"), prix(total.net_prevu)], [tr("Déjà payé"), prix(total.net_paye)], [tr("Reste à payer"), prix(total.reste)], [tr("Marge sur les ventes"), prix(total.venteAvecNet - total.net_prevu)]].map(([l, v]) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, l), h("p", { class: "chiffre-valeur" }, v)))
    ),
    !lignes.length
      ? vide(tr("Aucune réservation"), tr("Le dû se calcule d'après les réservations et leur net prévu. Les services payés sur place n'y figurent pas : leurs commissions sont dans « À encaisser »."))
      : listeAdaptative({
          items: lignes,
          colonnes: [
            { cle: "mois", titre: tr("Mois"), rendu: (g) => nomMoisCourt(g.mois), tri: (g) => g.mois, mobile: "sous" },
            { cle: "partenaire", titre: tr("Partenaire"), rendu: (g) => (g.partenaire_id ? h("a", { href: `#/partenaire/${g.partenaire_id}` }, nom(g)) : nom(g)), rendu_mobile: (g) => nom(g), tri: (g) => nom(g).toLowerCase(), mobile: "titre" },
            { cle: "nb", titre: tr("Réservations"), num: true, tri: (g) => g.nb, rendu: (g) => [String(g.nb), g.sansNet ? h("span", { class: "tag" }, tr("{sansNet} sans net", { sansNet: g.sansNet })) : null], rendu_mobile: (g) => tr("{reservations} · net {prevu}, payé {paye}", { reservations: pluriel(g.nb, N_("réservation"), N_("réservations")), prevu: prix(g.net_prevu), paye: prix(g.net_paye) }) + (g.sansNet ? tr(", {n} sans net", { n: g.sansNet }) : ""), mobile: "sous" },
            { cle: "vente", titre: tr("Vendu"), num: true, rendu: (g) => prix(g.vente), mobile: false },
            { cle: "net_prevu", titre: tr("Net prévu"), num: true, rendu: (g) => prix(g.net_prevu), mobile: false },
            { cle: "net_paye", titre: tr("Payé"), num: true, rendu: (g) => prix(g.net_paye), mobile: false },
            { cle: "reste", titre: tr("Reste"), num: true, tri: (g) => g.reste, rendu: (g) => h("strong", null, prix(g.reste)), rendu_mobile: (g) => h("span", { class: "droite-pile" }, h("strong", null, prix(g.reste)), h("span", null, tr("reste à payer"))), mobile: "droite" },
            { cle: "marge", titre: tr("Marge"), num: true, rendu: (g) => margeNoeud(g.venteAvecNet, g.net_prevu), mobile: "pied" },
          ],
          actions: (g) =>
            h(
              "span",
              { class: "carte-actions" },
              h("a", { class: "bouton secondaire petit", href: lien(g) }, tr("Voir")),
              ecrit && g.reste > 0 ? h("button", { class: "principal petit", type: "button", onclick: () => payer(g) }, tr("Marquer payé")) : null
            ),
          tri: { cle: "mois", decroissant: true },
        }).noeud
  );
}
