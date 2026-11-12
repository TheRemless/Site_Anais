// Règles : tout ce qu'il faut savoir avant de vendre, rassemblé depuis les fiches des partenaires.
import { etat, nomPartenaire, privePartenaire, peut, modeExcursions, modeTaxi } from "../etat.mjs";
import { commissionsPartenaire, paiementPartenaire } from "../partenaires-calc.mjs";
import { h } from "../ui.mjs";
import { vide } from "./commun.mjs";
import { prix } from "./partenaires.mjs";
import { tr, N_ } from "../i18n.mjs";

export function vueRegles() {
  const partenaires = etat.db.partenaires.filter((p) => p.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom));
  const frais = etat.db.prestations.filter((x) => x.famille === "frais" && x.actif !== false);
  // Commissions et mode de paiement : données privées, vides pour qui n'a pas le droit « nets » (les sections disparaissent alors).
  const avecPrive = (cle) => (peut("partenaires.nets") ? partenaires.filter((p) => (cle === "commissions" ? commissionsPartenaire(p, privePartenaire(p), true).length : !!paiementPartenaire(p, privePartenaire(p), true))) : []);
  const avec = (cle) => partenaires.filter((p) => p.regles && p.regles[cle] && (Array.isArray(p.regles[cle]) ? p.regles[cle].length : p.regles[cle]));
  const section = (titre, intro, items, rendu) =>
    items.length
      ? h("section", null, h("h2", null, tr(titre)), intro ? h("p", { class: "sous" }, tr(intro)) : null, h("div", { class: "grille-regles" }, items.map((p) => h("div", { class: "carte-regle" }, h("h3", null, h("a", { href: `#/partenaire/${p.id}` }, p.nom)), rendu(p)))))
      : null;
  const texte = (v) => (Array.isArray(v) ? v.map((x) => h("p", null, x)) : h("p", null, v));
  if (!partenaires.length) return h("div", { "data-titre": tr("Règles") }, h("div", { class: "entete" }, h("h1", null, tr("Règles"))), vide(tr("Rien à afficher"), tr("Les règles se remplissent depuis la fiche de chaque partenaire.")));
  return h(
    "div",
    { "data-titre": tr("Règles"), "data-large": true },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Règles des partenaires")), h("p", { class: "sous" }, modeExcursions() ? tr("Frais de parc, enfants, annulation, commissions et check-in, à relire avant de réserver.") : tr("Frais de parc, enfants, annulation, commissions et check-in, à relire avant d'envoyer un devis.")))),
    frais.length
      ? h(
          "section",
          null,
          h("h2", null, tr("Frais de parc national")),
          h("p", { class: "sous" }, modeTaxi() ? tr("Jamais inclus par les prestataires. À écrire sur chaque voucher : à payer en espèces sur place.") : modeExcursions() ? tr("Jamais inclus par les prestataires. À écrire sur chaque facture et voucher : à payer en espèces sur place.") : tr("Jamais inclus par les prestataires. À écrire sur chaque devis et voucher : à payer en espèces sur place.")),
          h("div", { class: "grille-regles" }, frais.map((f) => { const d = f.details || {}; return h("div", { class: "carte-regle" }, h("h3", null, f.libelle), h("p", null, h("strong", null, prix(f.prix_vente)), tr(" par adulte"), d.enfant !== undefined ? [", ", h("strong", null, prix(d.enfant)), tr(" par enfant")] : null), d.thai_adulte ? h("p", { class: "aide" }, tr("Tarif thaï {prix} et {prix2}.", { prix: prix(d.thai_adulte), prix2: prix(d.thai_enfant) })) : null, d.partenaires ? h("p", { class: "aide" }, tr("Concerne : {partenaires}", { partenaires: d.partenaires })) : null, d.note ? h("p", { class: "aide" }, d.note) : null); }))
        )
      : null,
    section(N_("Enfants et bébés"), N_("Tranches d'âge et gratuités selon le partenaire."), avec("enfants"), (p) => texte(p.regles.enfants)),
    section(N_("Annulation"), null, avec("annulation"), (p) => texte(p.regles.annulation)),
    section(N_("Commission et marge"), null, avecPrive("commissions"), (p) => texte(commissionsPartenaire(p, privePartenaire(p), true))),
    section(N_("Check-in"), null, avec("checkin"), (p) => texte(p.regles.checkin)),
    section(N_("Points d'embarquement"), null, avec("points_embarquement"), (p) => h("ul", { class: "liste-regles" }, p.regles.points_embarquement.map((x) => h("li", null, h("strong", null, x.lieu), ` ${x.ou}`)))),
    section(N_("Paiement des partenaires"), N_("Comment chaque partenaire veut être payé."), avecPrive("paiement"), (p) => texte(paiementPartenaire(p, privePartenaire(p), true))),
    avec("pickups").length ? h("section", null, h("h2", null, tr("Prise en charge à l'hôtel")), h("p", { class: "sous" }, tr("Les heures de pickup sont sur la fiche de chaque compagnie : "), avec("pickups").map((p, i) => [i ? ", " : "", h("a", { href: `#/partenaire/${p.id}` }, nomPartenaire(p.id))]), ".")) : null
  );
}
