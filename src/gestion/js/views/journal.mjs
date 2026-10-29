// Journal d'activité : qui a fait quoi et quand dans l'entreprise active.
import { etat, peut, equipe, entiteActive } from "../etat.mjs";
import { h, vider } from "../ui.mjs";
import { vide } from "./commun.mjs";
import { tr, N_, localeActive } from "../i18n.mjs";

const OBJETS = { dossiers: N_("le dossier"), clients: N_("le client"), documents: N_("le document"), paiements: N_("le paiement"), catalogue: N_("l'entrée du catalogue"), reglages: N_("les réglages"), roles: N_("le rôle"), membres: N_("l'accès de"), taches: N_("la tâche"), pieces_jointes: N_("la pièce jointe") };
const VERBES = { insert: N_("a créé"), update: N_("a modifié"), delete: N_("a supprimé") };
const CHAMPS = { bandeau: N_("le titre"), accepte_le: N_("la date d'acceptation"), annule: N_("l'annulation"), date_depart: N_("la date de début"), date_retour: N_("la date de fin"), client_id: N_("le client"), responsable_id: N_("le responsable"), notes: N_("les notes"), contenu: N_("le contenu"), date_emission: N_("la date d'émission"), envoye_le: N_("la date d'envoi"), montant: N_("le montant"), date: N_("la date"), moyen: N_("le moyen de paiement"), nom: N_("le nom"), prenom: N_("le prénom"), adresse: N_("l'adresse"), telephone: N_("le téléphone"), email: N_("l'e-mail"), prix: N_("le prix"), libelle: N_("le libellé"), actif: N_("l'état actif"), permissions: N_("les droits"), portee: N_("la portée"), role_id: N_("le rôle"), titre: N_("le titre"), echeance: N_("l'échéance"), assignee_id: N_("la personne en charge"), fait: N_("l'état de la tâche") };

const valeur = (v, cle) => (v === null || v === undefined || v === "" ? tr("vide") : typeof v === "object" ? JSON.stringify(v) : CHAMPS_PERSONNE.includes(cle) && PERSONNES.has(v) ? PERSONNES.get(v) : String(v));

const PERSONNES = new Map();
const CHAMPS_PERSONNE = ["responsable_id", "assignee_id", "fait_par"];

function detail(l) {
  const entrees = Object.entries(l.details || {});
  if (!entrees.length) return null;
  return h(
    "ul",
    { class: "journal-detail" },
    entrees.map(([k, v]) => h("li", null, `${CHAMPS[k] ? tr(CHAMPS[k]) : k}`.replace(/^./, (c) => c.toUpperCase()), v && typeof v === "object" ? `: ${valeur(v.avant)} → ${valeur(v.apres)}` : tr(" modifié")))
  );
}

const TABLES = [["", N_("Tout")], ["dossiers", N_("Dossiers")], ["clients", N_("Clients")], ["documents", N_("Devis et factures")], ["paiements", N_("Paiements")], ["catalogue", N_("Catalogue")], ["reglages", N_("Réglages")], ["roles", N_("Rôles")], ["membres", N_("Accès")], ["taches", N_("Tâches")], ["pieces_jointes", N_("Pièces jointes")]];

export function vueJournal() {
  if (!peut("journal.voir")) return vide(tr("Accès réservé"), tr("Le journal d'activité est réservé aux personnes qui en ont le droit."), h("a", { class: "bouton secondaire", href: "#/" }, tr("Retour au tableau de bord")));
  const liste = h("div", { class: "journal" });
  const plus = h("p", { class: "plus" });
  const filtres = { table: "", userId: "" };
  let derniere = null;

  const charger = async (reinitialiser) => {
    if (reinitialiser) {
      derniere = null;
      vider(liste);
    }
    const lignes = await etat.store.journal({ entiteId: etat.entiteId, table: filtres.table, userId: filtres.userId, avant: derniere, limite: 50 });
    if (!lignes.length && !derniere) liste.append(h("p", { class: "vide-court" }, tr("Rien à afficher pour ces filtres.")));
    for (const l of lignes) {
      liste.append(
        h(
          "div",
          { class: "journal-ligne" },
          h("time", { datetime: l.created_at }, new Date(l.created_at).toLocaleString(localeActive(), { dateStyle: "short", timeStyle: "short" })),
          h("div", null, h("p", null, h("strong", null, l.auteur || tr("Une personne")), ` ${VERBES[l.action] ? tr(VERBES[l.action]) : l.action} ${OBJETS[l.table_name] ? tr(OBJETS[l.table_name]) : l.table_name}`, l.libelle ? h("strong", null, ` ${l.libelle}`) : null), detail(l))
        )
      );
      derniere = l.created_at;
    }
    vider(plus);
    if (lignes.length === 50) plus.append(h("button", { class: "secondaire", type: "button", onclick: () => charger(false) }, tr("Afficher plus")));
  };

  const selTable = h("select", { id: "jr-table", onchange: (e) => ((filtres.table = e.target.value), charger(true)) }, TABLES.map(([v, l]) => h("option", { value: v }, tr(l))));
  const selPersonne = h("select", { id: "jr-user", onchange: (e) => ((filtres.userId = e.target.value), charger(true)) }, h("option", { value: "" }, tr("Tout le monde")));
  equipe()
    .then((gens) =>
      gens.forEach((p) => {
        PERSONNES.set(p.user_id, p.nom || p.email);
        selPersonne.append(h("option", { value: p.user_id }, p.nom || p.email));
      })
    )
    .finally(() => charger(true));

  return h(
    "div",
    { "data-titre": tr("Journal d'activité") },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Journal d'activité")), h("p", { class: "sous" }, entiteActive().nom))),
    h("p", { class: "aide" }, tr("Le journal garde la trace des créations, modifications et suppressions. Il ne peut être ni modifié ni vidé. Le contenu des réglages (coordonnées bancaires) n'y est jamais recopié.")),
    h("div", { class: "barre-outils" }, h("div", { class: "grille-form filtres" }, h("div", { class: "champ" }, h("label", { for: "jr-table" }, tr("Sujet")), selTable), h("div", { class: "champ" }, h("label", { for: "jr-user" }, tr("Personne")), selPersonne))),
    liste,
    plus
  );
}
