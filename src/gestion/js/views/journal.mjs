// Journal d'activité : qui a fait quoi et quand dans l'entreprise active.
import { etat, peut, equipe, entiteActive } from "../etat.mjs";
import { h, vider } from "../ui.mjs";
import { vide } from "./commun.mjs";

const OBJETS = { dossiers: "le dossier", clients: "le client", documents: "le document", paiements: "le paiement", catalogue: "l'entrée du catalogue", reglages: "les réglages", roles: "le rôle", membres: "l'accès de" };
const VERBES = { insert: "a créé", update: "a modifié", delete: "a supprimé" };
const CHAMPS = { bandeau: "le titre", accepte_le: "la date d'acceptation", annule: "l'annulation", date_depart: "la date de début", date_retour: "la date de fin", client_id: "le client", responsable_id: "le responsable", notes: "les notes", contenu: "le contenu", date_emission: "la date d'émission", envoye_le: "la date d'envoi", montant: "le montant", date: "la date", moyen: "le moyen de paiement", nom: "le nom", prenom: "le prénom", adresse: "l'adresse", telephone: "le téléphone", email: "l'e-mail", prix: "le prix", libelle: "le libellé", actif: "l'état actif", permissions: "les droits", portee: "la portée", role_id: "le rôle" };

const valeur = (v) => (v === null || v === undefined || v === "" ? "vide" : typeof v === "object" ? JSON.stringify(v) : String(v));

function detail(l) {
  const entrees = Object.entries(l.details || {});
  if (!entrees.length) return null;
  return h(
    "ul",
    { class: "journal-detail" },
    entrees.map(([k, v]) => h("li", null, `${CHAMPS[k] || k}`.replace(/^./, (c) => c.toUpperCase()), v && typeof v === "object" ? `: ${valeur(v.avant)} → ${valeur(v.apres)}` : " modifié"))
  );
}

const TABLES = [["", "Tout"], ["dossiers", "Dossiers"], ["clients", "Clients"], ["documents", "Devis et factures"], ["paiements", "Paiements"], ["catalogue", "Catalogue"], ["reglages", "Réglages"], ["roles", "Rôles"], ["membres", "Accès"]];

export function vueJournal() {
  if (!peut("journal.voir")) return vide("Accès réservé", "Le journal d'activité est réservé aux personnes qui en ont le droit.", h("a", { class: "bouton secondaire", href: "#/" }, "Retour au tableau de bord"));
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
    if (!lignes.length && !derniere) liste.append(h("p", { class: "vide-court" }, "Rien à afficher pour ces filtres."));
    for (const l of lignes) {
      liste.append(
        h(
          "div",
          { class: "journal-ligne" },
          h("time", { datetime: l.created_at }, new Date(l.created_at).toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" })),
          h("div", null, h("p", null, h("strong", null, l.auteur || "Une personne"), ` ${VERBES[l.action] || l.action} ${OBJETS[l.table_name] || l.table_name}`, l.libelle ? h("strong", null, ` ${l.libelle}`) : null), detail(l))
        )
      );
      derniere = l.created_at;
    }
    vider(plus);
    if (lignes.length === 50) plus.append(h("button", { class: "secondaire", type: "button", onclick: () => charger(false) }, "Afficher plus"));
  };

  const selTable = h("select", { id: "jr-table", onchange: (e) => ((filtres.table = e.target.value), charger(true)) }, TABLES.map(([v, l]) => h("option", { value: v }, l)));
  const selPersonne = h("select", { id: "jr-user", onchange: (e) => ((filtres.userId = e.target.value), charger(true)) }, h("option", { value: "" }, "Tout le monde"));
  equipe().then((gens) => gens.forEach((p) => selPersonne.append(h("option", { value: p.user_id }, p.nom || p.email))));
  charger(true);

  return h(
    "div",
    { "data-titre": "Journal d'activité" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, "Journal d'activité"), h("p", { class: "sous" }, entiteActive().nom))),
    h("p", { class: "aide" }, "Le journal garde la trace des créations, modifications et suppressions. Il ne peut être ni modifié ni vidé. Le contenu des réglages (coordonnées bancaires) n'y est jamais recopié."),
    h("div", { class: "barre-outils" }, h("div", { class: "grille-form filtres" }, h("div", { class: "champ" }, h("label", { for: "jr-table" }, "Sujet"), selTable), h("div", { class: "champ" }, h("label", { for: "jr-user" }, "Personne"), selPersonne))),
    liste,
    plus
  );
}
