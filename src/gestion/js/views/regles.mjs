// Règles : tout ce qu'il faut savoir avant de vendre, rassemblé depuis les fiches des partenaires.
import { etat, nomPartenaire } from "../etat.mjs";
import { h } from "../ui.mjs";
import { vide } from "./commun.mjs";
import { prix } from "./partenaires.mjs";

export function vueRegles() {
  const partenaires = etat.db.partenaires.filter((p) => p.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom));
  const frais = etat.db.prestations.filter((x) => x.famille === "frais" && x.actif !== false);
  const avec = (cle) => partenaires.filter((p) => p.regles && p.regles[cle] && (Array.isArray(p.regles[cle]) ? p.regles[cle].length : p.regles[cle]));
  const section = (titre, intro, items, rendu) =>
    items.length
      ? h("section", null, h("h2", null, titre), intro ? h("p", { class: "sous" }, intro) : null, h("div", { class: "grille-regles" }, items.map((p) => h("div", { class: "carte-regle" }, h("h3", null, h("a", { href: `#/partenaire/${p.id}` }, p.nom)), rendu(p)))))
      : null;
  const texte = (v) => (Array.isArray(v) ? v.map((x) => h("p", null, x)) : h("p", null, v));
  if (!partenaires.length) return h("div", { "data-titre": "Règles" }, h("div", { class: "entete" }, h("h1", null, "Règles")), vide("Rien à afficher", "Les règles se remplissent depuis la fiche de chaque partenaire."));
  return h(
    "div",
    { "data-titre": "Règles", "data-large": true },
    h("div", { class: "entete" }, h("div", null, h("h1", null, "Règles des partenaires"), h("p", { class: "sous" }, "Frais de parc, enfants, annulation, commissions et check-in, à relire avant d'envoyer un devis."))),
    frais.length
      ? h(
          "section",
          null,
          h("h2", null, "Frais de parc national"),
          h("p", { class: "sous" }, "Jamais inclus par les prestataires. À écrire sur chaque devis et voucher : à payer en espèces sur place."),
          h("div", { class: "grille-regles" }, frais.map((f) => { const d = f.details || {}; return h("div", { class: "carte-regle" }, h("h3", null, f.libelle), h("p", null, h("strong", null, prix(f.prix_vente)), " par adulte", d.enfant !== undefined ? [", ", h("strong", null, prix(d.enfant)), " par enfant"] : null), d.thai_adulte ? h("p", { class: "aide" }, `Tarif thaï ${prix(d.thai_adulte)} et ${prix(d.thai_enfant)}.`) : null, d.partenaires ? h("p", { class: "aide" }, `Concerne : ${d.partenaires}`) : null, d.note ? h("p", { class: "aide" }, d.note) : null); }))
        )
      : null,
    section("Enfants et bébés", "Tranches d'âge et gratuités selon le partenaire.", avec("enfants"), (p) => texte(p.regles.enfants)),
    section("Annulation", null, avec("annulation"), (p) => texte(p.regles.annulation)),
    section("Commission et marge", null, avec("commissions"), (p) => texte(p.regles.commissions)),
    section("Check-in", null, avec("checkin"), (p) => texte(p.regles.checkin)),
    section("Points d'embarquement", null, avec("points_embarquement"), (p) => h("ul", { class: "liste-regles" }, p.regles.points_embarquement.map((x) => h("li", null, h("strong", null, x.lieu), ` ${x.ou}`)))),
    section("Paiement des partenaires", "Comment chaque partenaire veut être payé.", avec("paiement"), (p) => texte(p.regles.paiement)),
    avec("pickups").length ? h("section", null, h("h2", null, "Prise en charge à l'hôtel"), h("p", { class: "sous" }, "Les heures de pickup sont sur la fiche de chaque compagnie : ", avec("pickups").map((p, i) => [i ? ", " : "", h("a", { href: `#/partenaire/${p.id}` }, nomPartenaire(p.id))]), ".")) : null
  );
}
