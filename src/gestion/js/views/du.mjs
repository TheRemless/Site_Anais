// Dû aux partenaires : par partenaire et par mois, net prévu, net payé, reste et marge. Réservé au droit « prix nets ».
import { etat, peut, naviguer, nomPartenaire, netReservation, enregistrerLie } from "../etat.mjs";
import { h, confirmer, toast } from "../ui.mjs";
import { aujourdhui } from "../calc.mjs";
import { duParPartenaire, nomMoisCourt } from "../operations-calc.mjs";
import { vide, cartes } from "./commun.mjs";
import { prix, margeNoeud, voitNets } from "./partenaires.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

export function vueDu() {
  if (!voitNets()) return h("div", { "data-titre": tr("Dû aux partenaires") }, h("div", { class: "entete" }, h("h1", null, tr("Dû aux partenaires"))), vide(tr("Accès réservé"), tr("Cet écran demande le droit de voir les prix nets des partenaires.")));
  const lignes = duParPartenaire(etat.db.reservations, netReservation);
  const rafraichir = () => naviguer(location.hash);
  const ecrit = peut("dossiers.ecrire");
  const total = lignes.reduce((s, l) => ({ net_prevu: s.net_prevu + l.net_prevu, net_paye: s.net_paye + l.net_paye, reste: s.reste + l.reste, vente: s.vente + l.vente }), { net_prevu: 0, net_paye: 0, reste: 0, vente: 0 });
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
  const lien = (g) => `#/reservations?periode=toutes&partenaire=${g.partenaire_id || ""}`;
  return h(
    "div",
    { "data-titre": tr("Dû aux partenaires"), "data-large": true },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Dû aux partenaires")), h("p", { class: "sous" }, tr("Ce que les partenaires vont facturer, par mois du service, d'après les réservations. À rapprocher de leurs factures.")))),
    h(
      "div",
      { class: "chiffres compacts" },
      [[tr("Net prévu"), prix(total.net_prevu)], [tr("Déjà payé"), prix(total.net_paye)], [tr("Reste à payer"), prix(total.reste)], [tr("Marge sur les ventes"), prix(total.vente - total.net_prevu)]].map(([l, v]) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, l), h("p", { class: "chiffre-valeur" }, v)))
    ),
    !lignes.length
      ? vide(tr("Aucune réservation"), tr("Le dû se calcule d'après les réservations et leur net prévu."))
      : [
          cartes(lignes, (g) =>
            h(
              "div",
              { class: "carte-lien statique" },
              h("span", { class: "carte-titre" }, nomPartenaire(g.partenaire_id) || tr("Sans partenaire")),
              h("span", { class: "carte-droite" }, h("strong", null, prix(g.reste)), h("span", null, tr("reste à payer"))),
              h("span", { class: "carte-sous" }, tr("{mois} · {reservations} · net {prevu}, payé {paye}", { mois: nomMoisCourt(g.mois), reservations: pluriel(g.nb, N_("réservation"), N_("réservations")), prevu: prix(g.net_prevu), paye: prix(g.net_paye) }) + (g.sansNet ? tr(", {n} sans net", { n: g.sansNet }) : "")),
              h("span", { class: "carte-pied" }, margeNoeud(g.vente, g.net_prevu), h("span", { class: "carte-actions" }, h("a", { class: "bouton secondaire petit", href: lien(g) }, tr("Voir")), ecrit && g.reste > 0 ? h("button", { class: "principal petit", type: "button", onclick: () => payer(g) }, tr("Marquer payé")) : null))
            )
          ),
          h(
            "table",
            { class: "tableau seulement-bureau" },
            h("thead", null, h("tr", null, [tr("Mois"), tr("Partenaire"), tr("Réservations"), tr("Vendu"), tr("Net prévu"), tr("Payé"), tr("Reste"), tr("Marge"), ""].map((t, i) => h("th", { scope: "col", class: i >= 2 && i <= 7 ? "num" : null }, t)))),
            h(
              "tbody",
              null,
              lignes.map((g) =>
                h(
                  "tr",
                  null,
                  h("td", null, nomMoisCourt(g.mois)),
                  h("td", null, g.partenaire_id ? h("a", { href: `#/partenaire/${g.partenaire_id}` }, nomPartenaire(g.partenaire_id)) : tr("Sans partenaire")),
                  h("td", { class: "num" }, g.nb, g.sansNet ? h("span", { class: "tag" }, tr("{sansNet} sans net", { sansNet: g.sansNet })) : null),
                  h("td", { class: "num" }, prix(g.vente)),
                  h("td", { class: "num" }, prix(g.net_prevu)),
                  h("td", { class: "num" }, prix(g.net_paye)),
                  h("td", { class: "num" }, h("strong", null, prix(g.reste))),
                  h("td", { class: "num" }, margeNoeud(g.vente, g.net_prevu)),
                  h("td", { class: "action-cellule" }, h("a", { class: "bouton secondaire petit", href: lien(g) }, tr("Voir")), ecrit && g.reste > 0 ? h("button", { class: "principal petit", type: "button", onclick: () => payer(g) }, tr("Marquer payé")) : null)
                )
              )
            )
          ),
        ]
  );
}
