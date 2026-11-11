// À encaisser : ce que les clients doivent encore à l'agence, et les commissions que les prestataires reversent après les services payés sur place.
// Le geste central est le rapprochement : « Rattana m'a viré 5 400 ce mois-ci » se saisit une fois pour le partenaire et le mois.
import { etat, peut, naviguer, nomPartenaire, nomClient, netReservation, enregistrerLie, dossiersAnnules, resumes, reglages } from "../etat.mjs";
import { h, modal, confirmer, toast, num } from "../ui.mjs";
import { aujourdhui, formatMontant, formatSommes, formatDate } from "../calc.mjs";
import { commissionsARecevoir, repartirReception, nomMoisCourt } from "../operations-calc.mjs";
import { vide, listeAdaptative } from "./commun.mjs";
import { voitNets, prix } from "./partenaires.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

const signe = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + prix(Math.abs(n));

export function vueEncaisser() {
  const voitClients = peut("finances.voir");
  const voitCommissions = voitNets();
  if (!voitClients && !voitCommissions) return h("div", { "data-titre": tr("À encaisser") }, h("div", { class: "entete" }, h("h1", null, tr("À encaisser"))), vide(tr("Accès réservé"), tr("Cet écran demande le droit de voir les montants.")));
  const rafraichir = () => naviguer(location.hash);
  const ecrit = peut("dossiers.ecrire");

  // ---- Les clients ----
  const dus = voitClients ? resumes().filter((r) => (r.statut === "accepte" || r.statut === "acompte") && r.reste > 0).sort((a, b) => (a.dossier.date_depart || "9999").localeCompare(b.dossier.date_depart || "9999") || b.reste - a.reste) : [];
  const devise = reglages().devise;

  // ---- Les commissions ----
  const groupes = voitCommissions ? commissionsARecevoir(etat.db.reservations, netReservation, dossiersAnnules()) : [];
  const aRecevoir = groupes.filter((g) => g.nbARecevoir > 0);
  const recues = groupes.filter((g) => g.nbARecevoir === 0);
  const totalCom = aRecevoir.reduce((s, g) => s + g.reste, 0);
  const lien = (g) => `#/reservations?periode=toutes&partenaire=${g.partenaire_id || ""}`;

  // « J'ai reçu un virement » : le montant réellement reçu, la date, et l'écart avec ce qui était attendu.
  const recevoir = (g) => {
    const attendu = g.reste;
    const montant = h("input", { id: "enc-montant", type: "number", min: "0", step: "any", inputmode: "decimal", value: String(attendu), required: true });
    const date = h("input", { id: "enc-date", type: "date", value: aujourdhui() });
    const ecart = h("p", { class: "ecart-reception", "aria-live": "polite" });
    const majEcart = () => {
      const v = num(montant.value);
      const e = v === null ? 0 : Math.round((v - attendu) * 100) / 100;
      ecart.textContent = e === 0 ? tr("Comme prévu.") : e > 0 ? tr("{ecart} de plus que prévu.", { ecart: prix(e) }) : tr("{ecart} de moins que prévu.", { ecart: prix(-e) });
    };
    montant.addEventListener("input", majEcart);
    majEcart();
    const fermer = modal(
      tr("Virement de {partenaire}", { partenaire: nomPartenaire(g.partenaire_id) || tr("ce partenaire") }),
      h(
        "form",
        {
          class: "modal-corps",
          onsubmit: async (e) => {
            e.preventDefault();
            const v = num(montant.value);
            if (v === null || v < 0) return toast(tr("Saisissez le montant reçu."), true);
            const { repartition } = repartirReception(g.reservations, netReservation, v);
            if (!repartition.length) return toast(tr("Rien à marquer : tout est déjà reçu."));
            try {
              for (const x of repartition) await enregistrerLie("reservations_nets", "reservation_id", x.reservation_id, { commission_recue: x.commission_recue, commission_recue_le: date.value || aujourdhui() });
              fermer();
              toast(tr("Commission notée."));
              rafraichir();
            } catch (err) {
              toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
            }
          },
        },
        h("p", { class: "aide" }, tr("{mois}, {reservations}. Attendu : {attendu}. Le montant se répartit tout seul sur les services.", { mois: nomMoisCourt(g.mois), reservations: pluriel(g.nbARecevoir, N_("{n} service"), N_("{n} services")), attendu: prix(attendu) })),
        h("div", { class: "grille-form compacte" }, h("div", { class: "champ" }, h("label", { for: "enc-montant" }, tr("Montant reçu")), montant), h("div", { class: "champ" }, h("label", { for: "enc-date" }, tr("Reçu le")), date)),
        ecart,
        g.sansCommission ? h("p", { class: "aide" }, tr("{n} service sans commission prévue : la répartition se fait à parts égales.", { n: g.sansCommission })) : null,
        h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
      ),
      { feuille: true }
    );
  };

  // « Reçu comme prévu » : un tap, sans formulaire, quand le virement est exactement le montant attendu.
  const recuCommePrevu = async (g) => {
    if (!(await confirmer(tr("Marquer reçu {montant} de {partenaire} pour {mois} ?", { montant: prix(g.reste), partenaire: nomPartenaire(g.partenaire_id) || tr("ce partenaire"), mois: nomMoisCourt(g.mois) }), tr("Marquer reçu")))) return;
    const { repartition } = repartirReception(g.reservations, netReservation, g.reste);
    for (const x of repartition) await enregistrerLie("reservations_nets", "reservation_id", x.reservation_id, { commission_recue: x.commission_recue, commission_recue_le: aujourdhui() });
    toast(tr("Commission notée."));
    rafraichir();
  };

  const actionsGroupe = (g) =>
    h(
      "span",
      { class: "carte-actions" },
      h("a", { class: "bouton secondaire petit", href: lien(g) }, tr("Voir")),
      ecrit && g.reste > 0 ? h("button", { class: "secondaire petit", type: "button", onclick: () => recevoir(g) }, tr("Autre montant")) : null,
      ecrit && g.reste > 0 ? h("button", { class: "principal petit", type: "button", onclick: () => recuCommePrevu(g) }, tr("Reçu comme prévu")) : null
    );

  const detailServices = (g) =>
    h(
      "details",
      { class: "detail-services" },
      h("summary", null, pluriel(g.nb, N_("{n} service"), N_("{n} services"))),
      h(
        "ul",
        null,
        g.reservations.map((r) => {
          const n = netReservation(r);
          const d = etat.db.dossiers.find((x) => x.id === r.dossier_id);
          const client = d ? nomClient(etat.db.clients.find((c) => c.id === d.client_id)) : "";
          return h("li", null, h("span", null, [client, r.libelle, r.date_service ? formatDate(r.date_service) : ""].filter(Boolean).join(" · ")), h("strong", null, n && n.commission_prevue != null ? prix(n.commission_prevue) : "—"));
        })
      )
    );

  const nom = (g) => nomPartenaire(g.partenaire_id) || tr("Sans partenaire");
  // Deux lignes pour le montant d'une carte : la valeur, puis ce qu'elle représente.
  const pile = (valeur, legende) => h("span", { class: "droite-pile" }, h("strong", null, valeur), h("span", null, legende));
  const colonnesCommissions = (recues) => [
    { cle: "mois", titre: tr("Mois"), rendu: (g) => nomMoisCourt(g.mois), tri: (g) => g.mois, mobile: "sous" },
    { cle: "partenaire", titre: tr("Partenaire"), rendu: (g) => (g.partenaire_id ? h("a", { href: `#/partenaire/${g.partenaire_id}` }, nom(g)) : nom(g)), rendu_mobile: (g) => nom(g), tri: (g) => nom(g).toLowerCase(), mobile: "titre" },
    { cle: "nb", titre: tr("Services"), num: true, tri: (g) => g.nb, rendu: (g) => [String(g.nb), g.sansCommission ? h("span", { class: "tag" }, tr("{n} sans commission", { n: g.sansCommission })) : null], rendu_mobile: (g) => `${tr("services payés sur place {vente}", { vente: prix(g.vente) })}${g.sansCommission ? `, ${tr("{n} sans commission", { n: g.sansCommission })}` : ""}`, mobile: "sous" },
    { cle: "prevue", titre: tr("Prévue"), num: true, rendu: (g) => prix(g.commission_prevue), mobile: false },
    { cle: "recue", titre: tr("Reçue"), num: true, rendu: (g) => [prix(g.commission_recue), g.ecart ? h("span", { class: "tag" }, tr("écart {ecart}", { ecart: signe(g.ecart) })) : null], mobile: false },
    { cle: "reste", titre: tr("Reste"), num: true, tri: (g) => g.reste, rendu: (g) => h("strong", null, prix(g.reste)), rendu_mobile: (g) => (recues ? pile(prix(g.commission_recue), g.ecart ? tr("reçu, écart {ecart}", { ecart: signe(g.ecart) }) : tr("reçu")) : pile(prix(g.reste), tr("à recevoir"))), mobile: "droite" },
    { cle: "detail", titre: tr("Services"), tableau: false, rendu: () => null, rendu_mobile: (g) => detailServices(g), mobile: "pied" },
  ];
  const listeCommissions = (items, recues) => listeAdaptative({ items, colonnes: colonnesCommissions(recues), actions: actionsGroupe, tri: { cle: "mois", decroissant: true } }).noeud;

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
  const rienADire = !dus.length && !groupes.length;

  return h(
    "div",
    { "data-titre": tr("À encaisser"), "data-large": true },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("À encaisser")), h("p", { class: "sous" }, tr("Ce que les clients doivent encore à l'agence, et les commissions que les prestataires reversent après les services payés sur place.")))),
    h(
      "div",
      { class: "chiffres compacts" },
      voitClients ? chiffre(tr("Clients"), formatSommes(dus.map((r) => ({ montant: r.reste, devise: r.devise })), devise), pluriel(dus.length, N_("dossier à régler"), N_("dossiers à régler"))) : null,
      voitCommissions ? chiffre(tr("Commissions"), prix(totalCom), pluriel(aRecevoir.length, N_("partenaire à rapprocher"), N_("partenaires à rapprocher"))) : null
    ),
    rienADire ? vide(tr("Rien à encaisser"), tr("Les clients ont tout payé et aucune commission n'est en attente.")) : null,
    dus.length ? h("section", null, h("h2", null, tr("Les clients doivent")), listeClients()) : null,
    aRecevoir.length
      ? h("section", { class: "commissions-recevoir" }, h("h2", null, tr("Commissions des prestataires")), h("p", { class: "aide" }, tr("Services payés sur place : le prestataire reverse une commission après la prestation. Un virement reçu se saisit une fois pour le partenaire et le mois.")), listeCommissions(aRecevoir, false))
      : null,
    recues.length ? h("details", { class: "commissions-recues" }, h("summary", null, tr("Déjà reçues ({n})", { n: recues.length })), listeCommissions(recues, true)) : null
  );
}
