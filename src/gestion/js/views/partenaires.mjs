// Partenaires : la liste, la fiche d'un partenaire (contact, tarifs, règles, contrat, banque, tâches) et les formulaires.
import { etat, peut, inserer, modifier, supprimer, naviguer, partenaireDe, nomPartenaire, netPrestation, privePartenaire, enregistrerLie, modeTaxi, modeExcursions, moduleActif, exemple, reglages } from "../etat.mjs";
import { assistantActif } from "../assistant-calc.mjs";
import { DROITS_BROCHURE } from "../brochure-calc.mjs";
import { h, champ, modal, confirmer, toast, icone, num } from "../ui.mjs";
import { formatMontant, formatDate, aujourdhui } from "../calc.mjs";
import { TYPES_COMMISSION, SUR_PLACE, CHEZ_NOUS, modeParDefaut } from "../operations-calc.mjs";
import { FAMILLES, surPlacePossible, nomFamille, libelleUnite, marge, correspond, UNITES, chiffres, commissionsPartenaire, paiementPartenaire, utilisations, uniteInitiale, familleInitiale, deplacer, proposable } from "../partenaires-calc.mjs";
import { prestationEnfantSeparee } from "../demande-calc.mjs";
import { heureDeGrille } from "../pickup-calc.mjs";
import { vide, cartes } from "./commun.mjs";
import { listeTaches } from "./taches.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { CATEGORIE_APPORTEUR, estApporteur, prestataires } from "../apporteurs-calc.mjs";
import { apporteursActifs, blocsFicheApporteur } from "./apporteurs.mjs";

// Une fiche apporteur (migration 68) : sa catégorie technique « apporteur » se lit « Apporteur d'affaires ».
const libelleCategorie = (p) => (estApporteur(p) ? tr("Apporteur d'affaires") : p.categorie);
import { ouvrirRecalculCommissions } from "./recalcul-commission.mjs";

export const GROUPES = [
  ["mer", N_("Bateaux et excursions en mer")],
  ["activite", N_("Activités et expériences")],
  ["location", N_("Locations")],
  ["transport", N_("Transferts et taxis")],
  ["autre", N_("Autres")],
];

export const prix = (n) => (n === null || n === undefined || n === "" ? "—" : formatMontant(n));
export const voitNets = () => peut("partenaires.nets");
// Nets et marges des tarifs : jamais en Taxi, où le chauffeur n'est pas payé par l'agence et aucun tarif n'a de net.
// `voitNets` reste le droit seul : il ouvre aussi les commissions de Taxi (À encaisser, Commission calculée).
const voitNetsTarifs = () => voitNets() && !modeTaxi();

// Marge affichée : montant puis pourcentage. Rouge quand nulle ou négative, orange sous 12 %.
export function margeNoeud(vente, net) {
  const m = marge(vente, net);
  if (!m) return h("span", { class: "sec" }, "—");
  return h("span", { class: `marge ${m.montant <= 0 ? "marge-nulle" : m.pct < 12 ? "marge-basse" : ""}` }, prix(m.montant), " ", h("span", { class: "tag" }, `${m.pct} %`));
}

// `chiffres` (numéro en format international) est dans partenaires-calc ; ré-exporté pour les écrans qui l'importent d'ici.
export { chiffres };

async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    toast(tr("Copié."));
  } catch {
    toast(tr("Copie impossible dans ce navigateur."), true);
  }
}

export function telephone(t) {
  const d = chiffres(t.numero, { thaiLocal: true });
  return h(
    "span",
    { class: "tel" },
    d ? h("a", { href: `tel:${d}` }, t.numero) : h("span", null, t.numero),
    t.libelle ? h("span", { class: "tag" }, t.libelle) : null,
    t.line ? h("span", { class: "tag", title: tr("Répond sur LINE") }, "LINE") : null,
    d && t.whatsapp ? h("a", { class: "bouton-icone lien", href: `https://wa.me/${d.replace("+", "")}`, target: "_blank", rel: "noopener", "aria-label": tr("WhatsApp {numero}", { numero: t.numero }), title: tr("WhatsApp") }, icone("whatsapp")) : null,
    h("button", { class: "bouton-icone lien", type: "button", "aria-label": tr("Copier {numero}", { numero: t.numero }), title: tr("Copier"), onclick: () => copier(t.numero) }, icone("copier"))
  );
}

export function etatContrat(p) {
  const c = p.contrat || {};
  const ajd = aujourdhui();
  const fini = c.fin && c.fin < ajd;
  const bientot = c.fin && !fini && c.fin <= ajouterJours(ajd, 30);
  const code = fini ? "fini" : bientot || c.etat === "attention" ? "attention" : "ok";
  const texte = fini ? tr("Contrat terminé le {date}", { date: formatDate(c.fin) }) : bientot ? tr("Expire le {date}", { date: formatDate(c.fin) }) : c.statut || (c.fin ? tr("Jusqu'au {date}", { date: formatDate(c.fin) }) : tr("Sans date de fin"));
  return h("span", { class: `statut etat-${code}` }, h("span", { class: "point", "aria-hidden": "true" }), texte);
}
const ajouterJours = (iso, n) => {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000);
  return d.toISOString().slice(0, 10);
};

// Un bloc de texte multi-lignes, chaque ligne devient un paragraphe.
const paragraphes = (texte) => String(texte || "").split("\n").filter((l) => l.trim()).map((l) => h("p", null, l));
const liste = (items) => (items && items.length ? h("ul", { class: "liste-regles" }, items.map((x) => h("li", null, x))) : null);

// ---- Liste --------------------------------------------------------------------------------------------------
// Un partenaire masqué (inactif) reste dans la liste, en gris, quand on coche « Afficher les masqués » : on le retrouve et on le réactive sans l'URL (audit n° 5).
export function listePartenaires() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const corps = h("div");
  const q = h("input", { id: "rech-partenaires", type: "search", value: params.get("q") || "", placeholder: tr("Nom, catégorie, personne"), oninput: () => dessiner() });
  const nbMasques = etat.db.partenaires.filter((p) => p.actif === false).length;
  const masques = h("input", { id: "voir-masques", type: "checkbox", checked: params.get("masques") === "1", onchange: () => dessiner() });
  const caseMasques = nbMasques ? h("label", { class: "case", for: "voir-masques" }, masques, pluriel(nbMasques, N_("Afficher le partenaire masqué ({n})"), N_("Afficher les partenaires masqués ({n})"))) : null;
  const texteDe = (p) => `${p.nom} ${p.nom_thai} ${p.categorie} ${p.role} ${(p.contact || {}).personne || ""}`;
  function dessiner() {
    const u = new URLSearchParams();
    if (q.value) u.set("q", q.value);
    if (masques.checked) u.set("masques", "1");
    history.replaceState(null, "", `#/partenaires${u.toString() ? `?${u}` : ""}`);
    corps.replaceChildren();
    const tous = etat.db.partenaires.filter((p) => masques.checked || p.actif !== false).sort((a, b) => (a.ordre || 0) - (b.ordre || 0) || a.nom.localeCompare(b.nom));
    const visibles = tous.filter((p) => correspond(texteDe(p), q.value));
    // La recherche ne trouve qu'un partenaire masqué : on le dit, plutôt que « aucun partenaire ».
    const masquesTrouves = masques.checked ? 0 : etat.db.partenaires.filter((p) => p.actif === false && correspond(texteDe(p), q.value)).length;
    if (!visibles.length) {
      corps.append(
        masquesTrouves
          ? vide(pluriel(masquesTrouves, N_("{n} partenaire masqué correspond"), N_("{n} partenaires masqués correspondent")), tr("Cochez « Afficher les partenaires masqués » pour les voir et les réactiver."))
          : tous.length
            ? vide(tr("Aucun partenaire ne correspond"), tr("Essayez une autre recherche."))
            : vide(tr("Aucun partenaire pour l'instant"), tr("Un partenaire regroupe ses contacts, ses tarifs, ses trajets, ses règles et son contrat."), peut("partenaires.ecrire") ? h("button", { class: "principal", type: "button", onclick: () => ouvrirFormulaire({}) }, tr("Ajouter le premier partenaire")) : null)
      );
      return;
    }
    for (const [code, titre] of GROUPES) {
      const du = visibles.filter((p) => (p.groupe || "autre") === code || (!GROUPES.some(([c]) => c === p.groupe) && code === "autre"));
      if (!du.length) continue;
      corps.append(
        h(
          "section",
          null,
          h("h2", null, tr(titre)),
          h(
            "ul",
            { class: "cartes grille" },
            du.map((p) => {
              const n = etat.db.prestations.filter((x) => x.partenaire_id === p.id && x.actif !== false).length;
              const t = etat.db.trajets.filter((x) => x.partenaire_id === p.id && x.actif !== false).length;
              const tel = ((p.contact || {}).telephones || [])[0];
              const masque = p.actif === false;
              return h(
                "li",
                { class: masque ? "carte inactif" : "carte" },
                h(
                  "a",
                  { class: "carte-lien", href: `#/partenaire/${p.id}` },
                  h("span", { class: "carte-titre" }, p.nom, masque ? h("span", { class: "tag" }, tr("masqué")) : null),
                  h("span", { class: "carte-droite" }, tel ? h("span", null, tel.numero) : null),
                  h("span", { class: "carte-sous" }, estApporteur(p) ? [p.role, libelleCategorie(p)].filter(Boolean).join(" · ") : p.role || p.categorie),
                  h("span", { class: "carte-pied" }, modeTaxi() || masque || estApporteur(p) ? h("span") : etatContrat(p), h("span", { class: "ref" }, [n ? pluriel(n, N_("{n} tarif"), N_("{n} tarifs")) : "", t ? pluriel(t, N_("{n} trajet"), N_("{n} trajets")) : ""].filter(Boolean).join(" · ")))
                )
              );
            })
          )
        )
      );
    }
  }
  const ouvrirFormulaire = (p) => {
    const fermer = modal(p.id ? tr("Modifier le partenaire") : tr("Nouveau partenaire"), formulairePartenaire(p, (r) => (fermer(), naviguer(`#/partenaire/${r.id}`))), { large: true });
  };
  dessiner();
  const nbActifs = etat.db.partenaires.filter((p) => p.actif !== false).length;
  // Les tarifs et trajets proposés : ceux d'un partenaire masqué ne comptent plus.
  const nbTarifs = etat.db.prestations.filter((x) => proposable(x, etat.db.partenaires)).length;
  const nbTrajets = etat.db.trajets.filter((t) => proposable(t, etat.db.partenaires)).length;
  return h(
    "div",
    { "data-titre": tr("Partenaires") },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Partenaires")), h("p", { class: "sous" }, [pluriel(nbActifs, N_("{n} partenaire"), N_("{n} partenaires")), pluriel(nbTarifs, N_("{n} tarif"), N_("{n} tarifs")), !moduleActif("trajets") ? "" : pluriel(nbTrajets, N_("{n} trajet"), N_("{n} trajets"))].filter(Boolean).join(", "))), h("div", { class: "entete-actions" }, h("a", { class: "bouton secondaire", href: "#/tarifs" }, tr("Tarifs")), !moduleActif("trajets") ? null : h("a", { class: "bouton secondaire", href: "#/trajets" }, tr("Trajets")), peut("partenaires.ecrire") ? h("button", { class: "principal", type: "button", onclick: () => ouvrirFormulaire({}) }, tr("Nouveau partenaire")) : null)),
    h("div", { class: "barre-outils" }, h("div", { class: "champ recherche" }, h("label", { for: "rech-partenaires" }, tr("Rechercher")), q), caseMasques),
    corps
  );
}

// ---- Fiche --------------------------------------------------------------------------------------------------
export function fichePartenaire(id) {
  const p = partenaireDe(id);
  if (!p) return vide(tr("Partenaire introuvable"), tr("Il a peut-être été supprimé."), h("a", { class: "bouton secondaire", href: "#/partenaires" }, tr("Retour aux partenaires")));
  const c = p.contact || {};
  const r = p.regles || {};
  const ct = p.contrat || {};
  const ecrit = peut("partenaires.ecrire");
  const prive = voitNets() ? privePartenaire(p) : null;
  const prestations = etat.db.prestations.filter((x) => x.partenaire_id === p.id).sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  const trajets = etat.db.trajets.filter((x) => x.partenaire_id === p.id);
  const trajetsActifs = trajets.filter((x) => x.actif !== false);
  const taches = etat.db.taches.filter((t) => t.partenaire_id === p.id && !t.fait);
  const rafraichir = () => naviguer(location.hash);
  const bloc = (titre, ...contenu) => (contenu.flat().some(Boolean) ? h("section", { class: "bloc" }, h("h2", null, tr(titre)), ...contenu) : null);
  const ligne = (libelle, valeur) => (valeur ? h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, tr(libelle)), h("span", null, valeur)) : null);

  const groupes = [...new Set(prestations.map((x) => x.groupe || nomFamille(x.famille)))];
  const tarifs = groupes.map((g) => {
    const lignes = prestations.filter((x) => (x.groupe || nomFamille(x.famille)) === g);
    return h("div", { class: "groupe-tarifs" }, h("h3", null, g), tableauPrestations(lignes, { avecPartenaire: false, apres: rafraichir, ordonnable: ecrit }));
  });

  return h(
    "div",
    { "data-titre": p.nom, "data-large": true },
    h("a", { class: "retour", href: "#/partenaires" }, tr("Partenaires")),
    h(
      "div",
      { class: "entete" },
      h("div", null, h("h1", null, p.nom), h("p", { class: "sous" }, [p.role, libelleCategorie(p)].filter(Boolean).join(" · "), p.nom_thai ? h("span", { class: "sous-ligne", lang: "th" }, p.nom_thai) : null)),
      h("div", { class: "entete-actions" }, modeTaxi() || estApporteur(p) ? null : etatContrat(p), ecrit ? h("button", { class: "secondaire", type: "button", onclick: () => { const fermer = modal(tr("Modifier le partenaire"), formulairePartenaire(p, () => (fermer(), rafraichir())), { large: true }); } }, tr("Modifier")) : null)
    ),
    p.actif === false ? h("div", { class: "bandeau-info" }, tr("Ce partenaire est masqué : ni lui, ni ses tarifs, ni ses trajets ne sont proposés pour les nouvelles saisies. Les services déjà enregistrés, leurs factures et leurs vouchers ne changent pas."), ecrit ? h("div", { class: "actions gauche" }, h("button", { class: "principal petit", type: "button", onclick: () => basculerPartenaire(p, true, rafraichir) }, tr("Réactiver ce partenaire"))) : null) : null,
    h(
      "div",
      { class: "deux-colonnes fiche" },
      h(
        "div",
        null,
        bloc(
          N_("Contact"),
          ligne(N_("Personne"), c.personne),
          (c.telephones || []).length ? h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, tr("Téléphone")), h("span", { class: "tels" }, (c.telephones || []).map(telephone))) : null,
          (c.emails || []).length ? h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, tr("E-mail")), h("span", null, (c.emails || []).map((e, i) => [i ? ", " : "", h("a", { href: `mailto:${e}` }, e)]))) : null,
          ligne(N_("Line"), c.line),
          c.web ? h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, tr("Site")), h("a", { href: /^https?:/.test(c.web) ? c.web : `https://${c.web}`, target: "_blank", rel: "noopener" }, c.web)) : null,
          ligne(N_("Adresse"), c.adresse),
          modeTaxi() ? null : ligne(N_("Embarcadère"), c.embarcadere),
          ligne(N_("Licence"), c.licence),
          (c.guichets || []).length
            ? h("div", { class: "guichets" }, h("h3", null, tr("Guichets et bureaux")), (c.guichets || []).map((g) => h("div", { class: "guichet" }, h("strong", null, g.lieu), g.adresse ? h("span", null, g.adresse) : null, (g.telephones || []).length ? h("span", { class: "tels" }, (g.telephones || []).map((n) => telephone({ numero: n }))) : null, g.line ? h("span", null, tr("Line : {line}", { line: g.line })) : null, g.email ? h("a", { href: `mailto:${g.email}` }, g.email) : null)))
            : null
        ),
        // Un apporteur n'a pas de contrat de partenaire : ses clients envoyés (migration 68) prennent la place.
        ...blocsFicheApporteur(p, { bloc }),
        modeTaxi() || estApporteur(p) ? null : bloc(
          N_("Contrat"),
          ligne(N_("Statut"), ct.statut),
          ligne(N_("Saison"), ct.saison),
          ligne(N_("Validité"), ct.validite),
          ligne(N_("Fin"), ct.fin ? formatDate(ct.fin) : ""),
          (ct.documents || []).length ? h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, tr("Documents")), h("span", null, (ct.documents || []).join(", "))) : null,
          (ct.evenements || []).length ? h("ul", { class: "liste-regles" }, (ct.evenements || []).map((e) => h("li", null, h("strong", null, e.date), ` ${e.libelle}`))) : null
        ),
        // Taxi : l'agence ne paie jamais le chauffeur, ni banque ni mode de paiement à tenir.
        !modeTaxi() && (prive || (ecrit && voitNets()))
          ? bloc(
              N_("Paiement et coordonnées bancaires"),
              h("p", { class: "aide" }, tr("Visible seulement avec le droit « prix nets ». Ne figure jamais sur un document client.")),
              prive && prive.paiement ? paragraphes(prive.paiement) : null,
              prive && prive.banque && Object.keys(prive.banque).length ? h("div", { class: "banque" }, Object.entries(prive.banque).map(([k, v]) => ligne(k.charAt(0).toUpperCase() + k.slice(1), typeof v === "string" ? v : JSON.stringify(v)))) : null,
              ecrit && voitNets() ? h("div", { class: "actions gauche" }, h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal(tr("Paiement et banque"), formulairePrive(p, prive, () => (fermer(), rafraichir()))); } }, prive ? tr("Modifier") : tr("Renseigner"))) : null
            )
          : null
      ),
      h(
        "div",
        null,
        bloc(
          N_("Règles"),
          r.annulation ? h("div", null, h("h3", null, tr("Annulation")), paragraphes(r.annulation)) : null,
          h("div", null, h("h3", null, tr("Règlement par les clients")), h("p", null, modeTaxi() ? tr("Sur place : le client paie le chauffeur. La commission se demande course par course.") : modeParDefaut(p) === SUR_PLACE ? tr("Sur place : le client paie le prestataire, qui reverse une commission.") : tr("Chez nous : le client règle l'agence, qui paie le prestataire."))),
          !modeTaxi() && paiementPartenaire(p, prive, voitNets()) ? h("div", null, h("h3", null, tr("Paiement")), paragraphes(paiementPartenaire(p, prive, voitNets()))) : null,
          r.enfants && r.enfants.length ? h("div", null, h("h3", null, tr("Enfants")), liste(r.enfants)) : null,
          voitNets() && prive && prive.commission_regle && TYPES_COMMISSION[prive.commission_regle.type] ? h("div", null, h("h3", null, tr("Commission calculée")), h("p", null, prive.commission_regle.type === "vente_moins_net" ? tr(TYPES_COMMISSION.vente_moins_net) : `${tr(TYPES_COMMISSION[prive.commission_regle.type])} : ${prive.commission_regle.valeur}`), peut("dossiers.ecrire") ? h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrirRecalculCommissions(p.id, () => naviguer(location.hash)) }, tr("Recalculer sur les réservations existantes")) : null) : null,
          commissionsPartenaire(p, prive, voitNets()).length ? h("div", null, h("h3", null, tr("Commission et marge")), liste(commissionsPartenaire(p, prive, voitNets()))) : null,
          r.checkin && r.checkin.length ? h("div", null, h("h3", null, tr("Check-in")), liste(r.checkin)) : null,
          reglesAgence(p).length ? h("div", null, h("h3", null, tr("Règles de l'agence")), liste(reglesAgence(p))) : null,
          r.points_embarquement && r.points_embarquement.length ? h("div", null, h("h3", null, tr("Points d'embarquement")), h("ul", { class: "liste-regles" }, r.points_embarquement.map((x) => h("li", null, h("strong", null, x.lieu), ` ${x.ou}`)))) : null
        ),
        // Grilles de pickup et points d'embarquement : modifiables ici (audit n° 8). Taxi n'a ni bateau ni grille de pickup.
        (r.pickups || []).length || (ecrit && !modeTaxi())
          ? h(
              "section",
              { class: "bloc" },
              h("h2", null, tr("Prise en charge à l'hôtel")),
              (r.pickups || []).map(tableauPickup),
              (r.pickups || []).length ? null : h("p", { class: "vide-court" }, tr("Aucune grille de pickup. Une grille donne l'heure de pickup de chaque zone pour chaque départ.")),
              ecrit && !modeTaxi() ? h("div", { class: "actions gauche" }, h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal(tr("Pickups et points d'embarquement"), formulaireEmbarquementPickup(p, () => (fermer(), rafraichir())), { large: true }); } }, tr("Modifier les pickups et les points d'embarquement"))) : null
            )
          : null,
        p.notes ? bloc(N_("Notes"), paragraphes(p.notes)) : null,
        trajets.length && moduleActif("trajets") ? bloc(N_("Trajets"), h("p", null, pluriel(trajetsActifs.length, N_("{n} trajet proposé"), N_("{n} trajets proposés")), trajets.length > trajetsActifs.length ? [", ", pluriel(trajets.length - trajetsActifs.length, N_("{n} masqué"), N_("{n} masqués"))] : "", ". ", h("a", { href: `#/trajets?partenaire=${p.id}${trajets.length > trajetsActifs.length ? "&masques=1" : ""}` }, tr("Voir les trajets")))) : null
      )
    ),
    h(
      "section",
      null,
      h(
        "div",
        { class: "entete petit-entete" },
        h("h2", null, tr("Tarifs")),
        // Sans bouton, pas de bloc d'actions (une section repliable sur téléphone cache alors l'en-tête vide).
        (assistantActif(reglages()) && DROITS_BROCHURE.every((d) => peut(d))) || ecrit ? h(
          "span",
          { class: "entete-actions" },
          // Importer une brochure (assistant allumé, droit « Modifier les prix de vente ») : tarifs et horaires lus sur la brochure, à cocher.
          assistantActif(reglages()) && DROITS_BROCHURE.every((d) => peut(d)) ? h("button", { class: "secondaire petit", type: "button", onclick: async () => (await import("./brochure.mjs")).ouvrirImportBrochure(p, rafraichir) }, tr("Importer une brochure")) : null,
          ecrit ? h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrirPrestation({ partenaire_id: p.id }, rafraichir) }, tr("Nouvelle prestation")) : null
        ) : null
      ),
      prestations.length ? tarifs : h("p", { class: "vide-court" }, tr("Aucun tarif enregistré pour ce partenaire."))
    ),
    h(
      "section",
      null,
      h("div", { class: "entete petit-entete" }, h("h2", null, tr("À régler avec ce partenaire")), peut("taches.ecrire") ? h("button", { class: "secondaire petit", type: "button", onclick: () => nouvelleTache(p, rafraichir) }, tr("Nouvelle tâche")) : null),
      taches.length ? listeTaches(taches, { avecDossier: false }) : h("p", { class: "vide-court" }, tr("Rien en attente. Les points à clarifier avec le partenaire s'ajoutent ici comme des tâches."))
    ),
    ecrit || peut("partenaires.supprimer")
      ? h(
          "div",
          { class: "zone-danger" },
          ecrit && p.actif !== false ? h("button", { class: "lien", type: "button", onclick: () => basculerPartenaire(p, false, rafraichir) }, tr("Masquer ce partenaire")) : null,
          peut("partenaires.supprimer") ? h("button", { class: "lien danger-texte", type: "button", onclick: () => supprimerPartenaire(p, prestations, trajets, rafraichir) }, tr("Supprimer ce partenaire")) : null
        )
      : null
  );
}

// Masquer ou réactiver un partenaire : il garde ses tarifs, ses trajets et ses services. Masqué, rien de lui n'est proposé pour une nouvelle saisie.
async function basculerPartenaire(p, actif, apres, { dejaConfirme = false } = {}) {
  if (!actif && !dejaConfirme && !(await confirmer(tr("Masquer « {nom} » ? Ni lui, ni ses tarifs, ni ses trajets ne seront proposés pour les nouvelles saisies. Les services déjà enregistrés, leurs factures et leurs vouchers ne changent pas. Vous pourrez le réactiver depuis la liste, avec « Afficher les partenaires masqués ».", { nom: p.nom }), tr("Masquer")))) return;
  try {
    await modifier("partenaires", p.id, { actif, updated_at: new Date().toISOString() });
    toast(actif ? tr("Partenaire réactivé.") : tr("Partenaire masqué."));
    apres();
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
  }
}

// Supprimer un partenaire : refusé s'il a des services enregistrés (on propose de le masquer), sinon une confirmation qui dit tout ce qui part avec lui (audit n° 14).
async function supprimerPartenaire(p, prestations, trajets, apres) {
  const n = utilisations({ partenaire: p }, etat.db);
  if (n) {
    const masquer = await confirmer(pluriel(n, N_("« {nom} » a {n} service enregistré. Le supprimer retirerait l'opérateur de ce service, de son voucher et des commissions. Masquez-le plutôt : il ne sera plus proposé et ce qui existe ne change pas."), N_("« {nom} » a {n} services enregistrés. Le supprimer retirerait l'opérateur de ces services, de leurs vouchers et des commissions. Masquez-le plutôt : il ne sera plus proposé et ce qui existe ne change pas."), { nom: p.nom }), p.actif === false ? tr("Fermer") : tr("Masquer ce partenaire"));
    if (masquer && p.actif !== false) await basculerPartenaire(p, false, apres, { dejaConfirme: true });
    return;
  }
  const taches = etat.db.taches.filter((t) => t.partenaire_id === p.id).length;
  const message = tr("Supprimer définitivement « {nom} » ? Partent avec lui : {tarifs}, {trajets}, leurs prix nets, ses coordonnées bancaires et ses commissions. {taches} Aucun service n'est enregistré avec lui. Cette suppression ne peut pas être annulée : pour le garder sans le proposer, masquez-le.", { nom: p.nom, tarifs: pluriel(prestations.length, N_("{n} tarif"), N_("{n} tarifs")), trajets: pluriel(trajets.length, N_("{n} trajet"), N_("{n} trajets")), taches: taches ? pluriel(taches, N_("Sa tâche reste, sans partenaire."), N_("Ses {n} tâches restent, sans partenaire.")) : "" });
  if (!(await confirmer(message, tr("Supprimer définitivement"), true))) return;
  try {
    await supprimer("partenaires", p.id);
    toast(tr("Partenaire supprimé."));
    naviguer("#/partenaires");
  } catch (err) {
    toast(tr("Suppression impossible : {message}", { message: err.message }), true);
  }
}

function tableauPickup(t) {
  return h(
    "div",
    { class: "pickup" },
    h("h3", null, t.titre),
    h("div", { class: "defilant" }, h("table", { class: "tableau simple compact" }, h("thead", null, h("tr", null, h("th", { scope: "col" }, tr("Zone")), (t.colonnes || []).map((c) => h("th", { scope: "col", class: "num" }, c)))), h("tbody", null, (t.lignes || []).map((l) => h("tr", null, h("td", null, h("strong", null, l[0])), l.slice(1).map((v) => h("td", { class: "num" }, v)))))))
  );
}

async function nouvelleTache(p, apres) {
  const titre = h("input", { id: "t-titre", required: true, placeholder: tr("Faire confirmer le net haute saison") });
  const echeance = h("input", { id: "t-ech", type: "date" });
  const fermer = modal(
    tr("Nouvelle tâche"),
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (e) => {
          e.preventDefault();
          await inserer("taches", { partenaire_id: p.id, dossier_id: null, titre: titre.value.trim(), description: "", echeance: echeance.value || null, assignee_id: etat.session.id, fait: false, fait_le: null, fait_par: null });
          toast(tr("Tâche ajoutée."));
          fermer();
          apres();
        },
      },
      champ(tr("Titre"), titre),
      champ(tr("Échéance (facultatif)"), echeance),
      h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Ajouter")))
    )
  );
}

// ---- Tableau de prestations (fiche, écran Tarifs) ---------------------------------------------------------------
// Tableau sur grand écran, cartes sur téléphone. Les colonnes net et marge n'existent qu'avec le droit.
// `ordonnable` : flèches pour monter ou descendre un tarif dans son groupe (fiche du partenaire, audit n° 82).
export function tableauPrestations(lignes, { avecPartenaire = true, apres = () => {}, ordonnable = false } = {}) {
  const nets = voitNetsTarifs();
  const ecrit = peut("partenaires.ecrire");
  // Sans prix de vente : marqué « prix à saisir », jamais « — » qui passe pour un prix connu (audit n° 21).
  const vente = (x) => (x.prix_vente === null || x.prix_vente === undefined || x.prix_vente === "" ? h("span", { class: "tag attention" }, tr("prix à saisir")) : prix(x.prix_vente));
  const deplacerTarif = async (x, sens) => {
    try {
      for (const c of deplacer(lignes, x.id, sens)) await modifier("prestations", c.id, { ordre: c.ordre });
      apres();
    } catch (err) {
      toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    }
  };
  const fleches = (x, i) => (ordonnable && ecrit && lignes.length > 1 ? h("span", { class: "ordre-tarif" }, h("button", { class: "bouton-icone secondaire", type: "button", disabled: i === 0, "aria-label": tr("Monter « {libelle} »", { libelle: x.libelle }), title: tr("Monter"), onclick: () => deplacerTarif(x, -1) }, "↑"), h("button", { class: "bouton-icone secondaire", type: "button", disabled: i === lignes.length - 1, "aria-label": tr("Descendre « {libelle} »", { libelle: x.libelle }), title: tr("Descendre"), onclick: () => deplacerTarif(x, 1) }, "↓")) : null);
  const detail = (x) => {
    const d = x.details || {};
    const items = [[N_("Horaires"), d.horaires], [N_("Durée"), d.duree], [N_("Capacité"), d.capacite], [N_("Bateau"), d.bateau], [N_("Pour qui"), d.qui], [N_("Inclus"), d.inclus], [N_("Frais de parc"), d.parc], [N_("Conditions"), d.conditions], [N_("Remarque"), d.note], [N_("Moteur"), d.moteur], [N_("Montant en thaï"), d.montant_thai], [N_("Prix affiché"), d.vente_texte]].filter(([, v]) => v !== undefined && v !== null && v !== "");
    if (d.enfant !== undefined) items.push([N_("Enfant"), prix(d.enfant) + (d.thai_adulte ? tr(" (tarif thaï {adulte} adulte, {enfant} enfant)", { adulte: prix(d.thai_adulte), enfant: prix(d.thai_enfant) }) : "")]);
    if (d.partenaires) items.push([N_("Concerne"), d.partenaires]);
    if (!items.length) return null;
    return h("details", { class: "detail-prestation" }, h("summary", null, tr("Détail")), items.map(([k, v]) => h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, tr(k)), h("span", null, paragraphes(String(v))))));
  };
  const modif = (x) => (ecrit ? h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrirPrestation(x, apres) }, tr("Modifier")) : null);
  const sousTexte = (x) => [x.details && x.details.horaires, x.details && x.details.capacite, x.details && x.details.duree, libelleUnite(x.unite), x.sur_place ? tr("à payer sur place") : ""].filter(Boolean).join(" · ");
  return [
    cartes(lignes, (x, i) => {
      const n = nets ? netPrestation(x) : null;
      return h(
        "div",
        { class: x.actif === false ? "carte-lien statique inactif" : "carte-lien statique" },
        h("span", { class: "carte-titre" }, x.libelle, x.actif === false ? h("span", { class: "tag" }, tr("masqué")) : null),
        h("span", { class: "carte-droite" }, h("strong", null, vente(x)), nets ? h("span", { class: "net" }, n && n.net != null ? tr("net {prix}", { prix: prix(n.net) }) : tr("net n/d")) : null),
        h("span", { class: "carte-sous" }, [avecPartenaire ? nomPartenaire(x.partenaire_id) : "", sousTexte(x)].filter(Boolean).join(" · ")),
        h("span", { class: "carte-pied" }, nets ? margeNoeud(x.prix_vente, n && n.net) : h("span"), h("span", null, fleches(x, i ?? lignes.indexOf(x)), modif(x))),
        detail(x)
      );
    }),
    h(
      "table",
      { class: "tableau seulement-bureau tarifs" },
      h("thead", null, h("tr", null, [avecPartenaire ? N_("Partenaire") : null, N_("Prestation"), N_("Unité"), N_("Vente"), nets ? N_("Net") : null, nets ? N_("Marge") : null, ""].filter((x) => x !== null).map((t, i) => h("th", { scope: "col", class: ["Vente", "Net", "Marge"].includes(t) ? "num" : null }, t ? tr(t) : t)))),
      h(
        "tbody",
        null,
        lignes.map((x, i) => {
          const n = nets ? netPrestation(x) : null;
          return h(
            "tr",
            { class: x.actif === false ? "inactif" : null },
            avecPartenaire ? h("td", null, h("a", { href: `#/partenaire/${x.partenaire_id}` }, nomPartenaire(x.partenaire_id)) || "—") : null,
            h("td", null, h("strong", null, x.libelle), x.actif === false ? h("span", { class: "tag" }, tr("masqué")) : null, h("span", { class: "sous-ligne" }, sousTexte(x)), detail(x)),
            h("td", null, libelleUnite(x.unite)),
            h("td", { class: "num" }, vente(x)),
            nets ? h("td", { class: "num net" }, n && n.net != null ? prix(n.net) : "n/d") : null,
            nets ? h("td", { class: "num" }, margeNoeud(x.prix_vente, n && n.net)) : null,
            h("td", { class: "action-cellule" }, fleches(x, i), modif(x))
          );
        })
      )
    ),
  ];
}

// Les cases de la fiche (migration 43), en phrases : ce que l'outil fait de ce partenaire.
function reglesAgence(p) {
  const out = [];
  if (p.payer_avant_veille) out.push(p.payer_avant_veille_sauf ? tr("À payer avant la veille du départ, sauf départ de {lieux}.", { lieux: p.payer_avant_veille_sauf }) : tr("À payer avant la veille du départ."));
  if (p.checkin_passeport) out.push(tr("Check-in avec passeport : {texte}", { texte: p.checkin_passeport }));
  if (p.tarif_zone) out.push(tr("Tarifs par zone : pickup et drop-off à remplir sur le voucher."));
  if (p.taxi_defaut) out.push(tr("Partenaire taxi par défaut."));
  return out;
}

// ---- Formulaires --------------------------------------------------------------------------------------------
const lignesVers = (texte) => String(texte || "").split("\n").map((l) => l.trim()).filter(Boolean);

// Lignes répétées d'un formulaire (téléphones, points d'embarquement, fenêtres, zones) : un bouton pour en ajouter, une croix par ligne.
// `faire(valeur)` rend { noeud, valeur: () => … } ; `valeurs()` rend les valeurs des lignes restantes, dans l'ordre.
function lignesRepetees(depart, faire, { ajouter = tr("Ajouter une ligne"), vide = {} } = {}) {
  const zone = h("div", { class: "lignes-saisie" });
  const lignes = [];
  const ajouterLigne = (v, focus = false) => {
    const l = faire(v);
    const retirer = h("button", { class: "bouton-icone secondaire", type: "button", "aria-label": tr("Retirer cette ligne"), title: tr("Retirer"), onclick: () => { lignes.splice(lignes.indexOf(l), 1); l.noeud.remove(); } }, icone("fermer"));
    l.noeud.append(retirer);
    lignes.push(l);
    zone.append(l.noeud);
    if (focus) l.noeud.querySelector("input")?.focus();
  };
  depart.forEach((v) => ajouterLigne(v));
  const bouton = h("button", { class: "secondaire petit", type: "button", onclick: () => ajouterLigne(vide, true) }, ajouter);
  return { noeud: h("div", null, zone, bouton), valeurs: () => lignes.map((l) => l.valeur()), ajouter: ajouterLigne };
}

// Un téléphone par ligne : numéro, libellé et une vraie case WhatsApp (audit n° 56 : « | WhatsApp » écrit en libellé laissait la case décochée).
function ligneTelephone(t = {}) {
  const k = Math.random().toString(36).slice(2, 8);
  const numero = h("input", { id: `tel-n-${k}`, type: "tel", value: t.numero || "", placeholder: exemple("telephone_partenaire"), "aria-label": tr("Numéro") });
  const libelle = h("input", { id: `tel-l-${k}`, value: t.libelle || "", placeholder: tr("Réservations, bureau…"), "aria-label": tr("Libellé du numéro") });
  const wa = h("input", { id: `tel-w-${k}`, type: "checkbox", checked: !!t.whatsapp });
  // LINE (24.11.2026) : le numéro répond sur LINE, comme imprimé sur la brochure d'un partenaire thaï.
  const line = h("input", { id: `tel-line-${k}`, type: "checkbox", checked: !!t.line });
  return {
    noeud: h("div", { class: "ligne-saisie tel-ligne" }, numero, libelle, h("label", { class: "case", for: wa.id }, wa, tr("WhatsApp")), h("label", { class: "case", for: line.id }, line, "LINE")),
    valeur: () => ({ numero: numero.value.trim(), libelle: libelle.value.trim(), whatsapp: wa.checked, ...(line.checked ? { line: true } : {}) }),
  };
}

export function formulairePartenaire(p, apres) {
  const c = p.contact || {};
  const r = p.regles || {};
  const ct = p.contrat || {};
  const nom = h("input", { id: "p-nom", value: p.nom || "", required: true });
  const nomThai = h("input", { id: "p-thai", value: p.nom_thai || "", lang: "th" });
  const categorie = h("input", { id: "p-cat", value: p.categorie || "", list: "p-cats", placeholder: tr("Excursions bateaux, Ferries et speedboats…") });
  const cats = h("datalist", { id: "p-cats" }, [...new Set(etat.db.partenaires.map((x) => x.categorie).filter(Boolean))].map((x) => h("option", { value: x })));
  const groupe = h("select", { id: "p-groupe" }, GROUPES.map(([v, l]) => h("option", { value: v }, tr(l))));
  groupe.value = GROUPES.some(([v]) => v === p.groupe) ? p.groupe : "autre";
  const role = h("input", { id: "p-role", value: p.role || "", placeholder: tr("Ce que fait ce partenaire, en une ligne") });
  const personne = h("input", { id: "p-personne", value: c.personne || "" });
  const tels = lignesRepetees((c.telephones || []).length ? c.telephones : [{}], ligneTelephone, { ajouter: tr("Ajouter un numéro") });
  const emails = h("input", { id: "p-emails", value: (c.emails || []).join(", ") });
  const line = h("input", { id: "p-line", value: c.line || "" });
  const web = h("input", { id: "p-web", value: c.web || "" });
  const adresse = h("textarea", { id: "p-adresse", rows: 2 });
  adresse.value = c.adresse || "";
  const embarcadere = h("input", { id: "p-pier", value: c.embarcadere || "" });
  const licence = h("input", { id: "p-licence", value: c.licence || "" });
  const annulation = h("textarea", { id: "p-annul", rows: 2 });
  annulation.value = r.annulation || "";
  const enfants = h("textarea", { id: "p-enfants", rows: 2 });
  enfants.value = (r.enfants || []).join("\n");
  const mode = h("select", { id: "p-mode" }, h("option", { value: CHEZ_NOUS }, tr("Chez nous : le client règle l'agence")), h("option", { value: SUR_PLACE }, tr("Sur place : le client paie le prestataire")));
  mode.value = modeParDefaut(p);
  const checkin = h("textarea", { id: "p-checkin", rows: 2 });
  checkin.value = (r.checkin || []).join("\n");
  // Consigne de check-in imprimée sur le voucher, en anglais (lue par le voucher, lot B) : la règle « Check-in » ci-dessus reste une note interne en français.
  const checkinVoucher = h("textarea", { id: "p-checkin-voucher", rows: 2, lang: "en", placeholder: "Check-in opens 45 minutes before departure." });
  checkinVoucher.value = r.checkin_voucher || "";
  const statut = h("input", { id: "p-statut", value: ct.statut || "", placeholder: tr("Tarifs nets confirmés, contrat à signer…") });
  const saison = h("input", { id: "p-saison", value: ct.saison || "" });
  const validite = h("input", { id: "p-validite", value: ct.validite || "", placeholder: tr("Tarifs valables jusqu'au 30 avril 2027…") });
  const etatC = h("select", { id: "p-etat" }, h("option", { value: "" }, tr("Rien à signaler")), h("option", { value: "attention" }, tr("À surveiller")));
  etatC.value = ct.etat === "attention" ? "attention" : "";
  const fin = h("input", { id: "p-fin", type: "date", value: ct.fin || "" });
  const documents = h("input", { id: "p-docs", value: (ct.documents || []).join(", ") });
  const notes = h("textarea", { id: "p-notes", rows: 3 });
  notes.value = p.notes || "";
  const actif = h("input", { id: "p-actif", type: "checkbox", checked: p.actif !== false });
  // Règles de l'agence avec ce partenaire (migration 43) : des cases sur la fiche, plus aucun nom de compagnie dans le code.
  const avance = h("input", { id: "p-avance", type: "checkbox", checked: !!p.payer_avant_veille });
  const avanceSauf = h("input", { id: "p-avance-sauf", value: p.payer_avant_veille_sauf || "", placeholder: tr("Lieux séparés par des virgules") });
  const checkinPasseport = h("textarea", { id: "p-checkin-passeport", rows: 2, lang: "en", placeholder: "Check-in 90 minutes before departure. Passport of each passenger required." });
  checkinPasseport.value = p.checkin_passeport || "";
  const tarifZone = h("input", { id: "p-tarif-zone", type: "checkbox", checked: !!p.tarif_zone });
  const taxiDefaut = h("input", { id: "p-taxi-defaut", type: "checkbox", checked: !!p.taxi_defaut });
  const taxi = modeTaxi();
  // Apporteur d'affaires (migration 68) : la catégorie « apporteur », Secret et Taxi seulement.
  const apporteur = apporteursActifs() ? h("input", { id: "p-apporteur", type: "checkbox", checked: estApporteur(p), onchange: () => (categorie.disabled = apporteur.checked) }) : null;
  if (apporteur) categorie.disabled = apporteur.checked;
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        erreur.textContent = "";
        const telephones = tels.valeurs().filter((t) => t.numero || t.libelle);
        if (telephones.some((t) => !t.numero)) return (erreur.textContent = tr("Un numéro de téléphone est vide : remplissez-le ou retirez la ligne."));
        const valeurs = {
          nom: nom.value.trim(),
          nom_thai: nomThai.value.trim(),
          categorie: apporteur && apporteur.checked ? CATEGORIE_APPORTEUR : apporteur && estApporteur(p) && categorie.value.trim() === CATEGORIE_APPORTEUR ? "" : categorie.value.trim(),
          groupe: groupe.value,
          role: role.value.trim(),
          contact: { ...c, personne: personne.value.trim(), telephones, emails: emails.value.split(",").map((x) => x.trim()).filter(Boolean), line: line.value.trim(), web: web.value.trim(), adresse: adresse.value.trim(), embarcadere: embarcadere.value.trim(), licence: licence.value.trim() },
          // Taxi : le client paie toujours le chauffeur, le menu n'y est pas montré et le mode enregistré ne change pas (audit n° 55).
          regles: { ...r, mode_reglement: taxi ? r.mode_reglement : mode.value === SUR_PLACE ? SUR_PLACE : undefined, annulation: annulation.value.trim(), enfants: lignesVers(enfants.value), checkin: lignesVers(checkin.value), checkin_voucher: taxi ? r.checkin_voucher || "" : checkinVoucher.value.trim() },
          contrat: { ...ct, statut: statut.value.trim(), saison: saison.value.trim(), validite: validite.value.trim(), etat: etatC.value || undefined, fin: fin.value || null, documents: documents.value.split(",").map((x) => x.trim()).filter(Boolean) },
          notes: notes.value.trim(),
          actif: actif.checked,
          // Champs masqués (Taxi : ni avance ni passeport ; ailleurs : pas de taxi par défaut) : la valeur enregistrée ne change pas.
          payer_avant_veille: taxi ? !!p.payer_avant_veille : avance.checked,
          payer_avant_veille_sauf: taxi ? p.payer_avant_veille_sauf || "" : avanceSauf.value.trim(),
          checkin_passeport: taxi ? p.checkin_passeport || "" : checkinPasseport.value.trim(),
          tarif_zone: tarifZone.checked,
          taxi_defaut: taxi ? taxiDefaut.checked : !!p.taxi_defaut,
        };
        try {
          const res = p.id ? await modifier("partenaires", p.id, { ...valeurs, updated_at: new Date().toISOString() }) : await inserer("partenaires", { ...valeurs, ordre: Math.max(0, ...etat.db.partenaires.map((x) => x.ordre || 0)) + 1 });
          toast(tr("Partenaire enregistré."));
          apres(res);
        } catch (err) {
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    h("div", { class: "grille-form" }, champ(tr("Nom"), nom), champ(tr("Nom en thaï"), nomThai), champ(tr("Catégorie"), [categorie, cats]), champ(tr("Groupe"), groupe)),
    champ(tr("Rôle"), role),
    apporteur ? h("label", { class: "case", for: "p-apporteur" }, apporteur, tr("Apporteur d'affaires : envoie des clients (travel planner, agence)")) : null,
    h("h3", null, tr("Contact")),
    h("div", { class: "grille-form" }, champ(tr("Personne"), personne), champ(tr("E-mails, séparés par des virgules"), emails), champ(tr("Line"), line), champ(tr("Site"), web)),
    h("div", { class: "champ" }, h("p", { class: "etiquette" }, tr("Téléphones")), tels.noeud, h("p", { class: "aide" }, tr("Un numéro par ligne. Cochez WhatsApp pour le bouton WhatsApp de la fiche, LINE si le numéro répond sur LINE."))),
    // Taxi : ni embarcadère, ni check-in, ni contrat. Les champs masqués gardent leur valeur et s'enregistrent tels quels.
    h("div", { class: "grille-form" }, champ(tr("Adresse"), adresse), taxi ? null : champ(tr("Embarcadère ou point de départ"), embarcadere), champ(tr("Licence"), licence)),
    h("h3", null, tr("Règles")),
    taxi ? null : champ(tr("Règlement par les clients"), mode, tr("Les nouveaux services de ce partenaire prennent ce mode. Chaque service peut ensuite être changé d'un tap.")),
    h("div", { class: "grille-form" }, champ(tr("Annulation"), annulation), champ(tr("Enfants, une règle par ligne"), enfants), taxi ? null : champ(tr("Check-in, une règle par ligne"), checkin), taxi ? null : champ(tr("Consigne de check-in sur le voucher (anglais)"), checkinVoucher, tr("Imprimée telle quelle sur le voucher du client. Quelques lignes au plus."))),
    h(
      "div",
      { class: "regles-partenaire" },
      taxi ? null : h("label", { class: "case", for: "p-avance" }, avance, tr("À payer au prestataire avant la veille du départ")),
      taxi ? null : champ(tr("Sauf départ de"), avanceSauf, tr("Pas d'alerte pour un départ de ces lieux. Vide : tous les départs.")),
      taxi ? null : champ(tr("Consigne de check-in avec passeport (anglais)"), checkinPasseport, tr("Pour un trajet vers ou depuis une destination à passeport (Réglages). Vide : la consigne générale de l'immigration.")),
      h("label", { class: "case", for: "p-tarif-zone" }, tarifZone, tr("Tarifs par zone, sans départ fixe")),
      h("p", { class: "aide" }, tr("Le voucher laisse le pickup et le drop-off à remplir pour un tarif sans « A → B ».")),
      taxi ? h("label", { class: "case", for: "p-taxi-defaut" }, taxiDefaut, tr("Partenaire taxi par défaut")) : null,
      taxi ? h("p", { class: "aide" }, tr("Reçoit les courses quand aucun chauffeur n'est choisi dans Réglages > Booking confirmation.")) : null
    ),
    taxi ? null : h("h3", null, tr("Contrat")),
    taxi ? null : h("div", { class: "grille-form" }, champ(tr("Statut"), statut), champ(tr("Saison"), saison), champ(tr("Validité"), validite), champ(tr("État"), etatC, tr("« À surveiller » met le contrat en orange dans la liste.")), champ(tr("Fin du contrat"), fin, tr("Un rappel apparaît dans Aujourd'hui trente jours avant.")), champ(tr("Documents, séparés par des virgules"), documents, tr("Les noms des documents seulement : le fichier lui-même se garde hors de l'outil pour l'instant."))),
    champ(tr("Notes"), notes),
    h("label", { class: "case", for: "p-actif" }, actif, tr("Partenaire proposé pour les nouvelles saisies")),
    h("p", { class: "aide" }, tr("Décoché, le partenaire est masqué : ni lui, ni ses tarifs, ni ses trajets ne sont proposés. Les services déjà enregistrés ne changent pas.")),
    erreur,
    h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
  );
}

// Points d'embarquement et grilles de pickup du partenaire (audit n° 8). Une grille : un titre, ses départs (colonnes) et, pour chaque zone,
// l'heure de pickup à chaque départ. Une case vide ou « - » : pas de pickup. Une heure illisible est refusée, jamais devinée (pickup-calc.mjs).
export function formulaireEmbarquementPickup(p, apres) {
  const r = p.regles || {};
  const k = () => Math.random().toString(36).slice(2, 8);
  const points = lignesRepetees(r.points_embarquement || [], (x = {}) => {
    const i = k();
    const lieu = h("input", { id: `pe-l-${i}`, value: x.lieu || "", placeholder: exemple("lieu"), "aria-label": tr("Lieu") });
    const ou = h("input", { id: `pe-o-${i}`, value: x.ou || "", placeholder: exemple("point_embarquement"), "aria-label": tr("Point d'embarquement") });
    return { noeud: h("div", { class: "ligne-saisie fenetre" }, lieu, ou), valeur: () => ({ lieu: lieu.value.trim(), ou: ou.value.trim() }) };
  }, { ajouter: tr("Ajouter un point d'embarquement") });

  const zoneGrilles = h("div");
  const grilles = [];
  const ajouterGrille = (g = { titre: "", colonnes: [], lignes: [] }) => {
    const i = k();
    const titre = h("input", { id: `pg-t-${i}`, value: g.titre || "", placeholder: exemple("titre_pickup") });
    const colonnes = h("input", { id: `pg-c-${i}`, value: (g.colonnes || []).join(", "), placeholder: tr("Bateau 10h30, Bateau 13h00") });
    let lignes = (g.lignes || []).map((l) => [...l]);
    const zones = h("div", { class: "lignes-saisie" });
    const colonnesDe = () => colonnes.value.split(",").map((x) => x.trim()).filter(Boolean);
    let champsZones = [];
    // Changer les départs redessine les zones en gardant les heures déjà tapées, colonne par colonne.
    const lire = () => (lignes = champsZones.map((z) => [z.nom.value, ...z.heures.map((x) => x.value)]));
    const dessinerZones = () => {
      const cols = colonnesDe();
      zones.replaceChildren();
      champsZones = [];
      zones.style.setProperty("--colonnes", String(Math.max(1, cols.length)));
      lignes.forEach((l, li) => {
        const z = { nom: h("input", { value: l[0] || "", placeholder: exemple("zone"), "aria-label": tr("Zone") }), heures: cols.map((c, ci) => h("input", { value: l[ci + 1] || "", placeholder: "09:40", inputmode: "numeric", "aria-label": tr("Heure de pickup, {zone}, {depart}", { zone: l[0] || tr("zone"), depart: c }) })) };
        champsZones.push(z);
        zones.append(h("div", { class: "ligne-saisie zone" }, z.nom, ...z.heures, h("button", { class: "bouton-icone secondaire", type: "button", "aria-label": tr("Retirer cette zone"), title: tr("Retirer"), onclick: () => { lire(); lignes.splice(li, 1); dessinerZones(); } }, icone("fermer"))));
      });
    };
    colonnes.addEventListener("change", () => (lire(), dessinerZones()));
    dessinerZones();
    const bloc = h(
      "div",
      { class: "editeur-grille" },
      h("div", { class: "entete-grille" }, champ(tr("Titre de la grille"), titre), h("button", { class: "lien danger-texte", type: "button", onclick: () => { grilles.splice(grilles.indexOf(objet), 1); bloc.remove(); } }, tr("Retirer la grille"))),
      champ(tr("Départs, séparés par des virgules"), colonnes, tr("Une colonne par départ. Les heures se tapent ensuite zone par zone.")),
      h("p", { class: "etiquette" }, tr("Zones et heures de pickup")),
      zones,
      h("button", { class: "secondaire petit", type: "button", onclick: () => { lire(); lignes.push([""]); dessinerZones(); zones.lastElementChild?.querySelector("input")?.focus(); } }, tr("Ajouter une zone"))
    );
    const objet = { titre, colonnesDe, lire: () => (lire(), lignes) };
    grilles.push(objet);
    zoneGrilles.append(bloc);
  };
  (r.pickups || []).forEach(ajouterGrille);
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        erreur.textContent = "";
        const points_embarquement = points.valeurs().filter((x) => x.lieu || x.ou);
        const pickups = [];
        for (const g of grilles) {
          const colonnes = g.colonnesDe();
          const lignes = g.lire().filter((l) => String(l[0] || "").trim() || l.slice(1).some((v) => String(v || "").trim()));
          if (!lignes.length && !g.titre.value.trim()) continue;
          if (!colonnes.length) return (erreur.textContent = tr("La grille « {titre} » n'a pas de départ : indiquez au moins un départ.", { titre: g.titre.value.trim() || tr("sans titre") }));
          const propres = [];
          for (const l of lignes) {
            const zone = String(l[0] || "").trim();
            if (!zone) return (erreur.textContent = tr("Une zone sans nom dans la grille « {titre} » : nommez-la ou retirez-la.", { titre: g.titre.value.trim() || tr("sans titre") }));
            const heures = colonnes.map((_, ci) => String(l[ci + 1] || "").trim());
            const mauvaise = heures.find((v) => v && v !== "-" && !heureDeGrille(v));
            if (mauvaise) return (erreur.textContent = tr("« {heure} » n'est pas une heure lisible ({zone}). Écrivez 09:40, ou laissez vide s'il n'y a pas de pickup.", { heure: mauvaise, zone }));
            propres.push([zone, ...heures.map((v) => (v === "-" ? "" : heureDeGrille(v)))]);
          }
          pickups.push({ titre: g.titre.value.trim(), colonnes, lignes: propres });
        }
        try {
          await modifier("partenaires", p.id, { regles: { ...r, points_embarquement, pickups }, updated_at: new Date().toISOString() });
          toast(tr("Pickups et points d'embarquement enregistrés."));
          apres();
        } catch (err) {
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    h("h3", null, tr("Points d'embarquement")),
    h("p", { class: "aide" }, tr("Où le client embarque, lieu par lieu. Le billet de bateau l'imprime quand le départ correspond.")),
    points.noeud,
    h("h3", null, tr("Grilles de pickup")),
    h("p", { class: "aide" }, tr("L'heure de pickup se remplit d'après la zone de l'hôtel et le départ choisi, dans « Coller une demande » et dans la réservation.")),
    zoneGrilles,
    h("button", { class: "secondaire petit", type: "button", onclick: () => ajouterGrille() }, tr("Ajouter une grille")),
    erreur,
    h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
  );
}

// Ouvre la fiche d'une prestation dans une fenêtre ; `apres` rafraîchit l'écran appelant.
export function ouvrirPrestation(x, apres = () => naviguer(location.hash), options = {}) {
  const fermer = modal(x.id ? tr("Modifier la prestation") : options.copie ? tr("Copie de la prestation") : tr("Nouvelle prestation"), formulairePrestation(x, () => (fermer(), apres()), { ...options, rouvrir: (y, o) => (fermer(), apres(), ouvrirPrestation(y, apres, o)) }), { large: true });
}

const AUCUN = "aucun";
const nombreOuNul = (v) => (String(v ?? "").trim() === "" ? null : num(v));

// `options.netsDepart` : les nets à proposer (copie d'une prestation) ; `options.rouvrir(y, o)` : ferme cette fiche et en ouvre une autre (Dupliquer).
export function formulairePrestation(x, apres, options = {}) {
  const d = x.details || {};
  const taxi = modeTaxi();
  const nets = voitNetsTarifs();
  const n = x.id && nets ? netPrestation(x) : nets ? options.netsDepart || null : null;
  // Partenaire obligatoire (audit n° 60) : « Sans partenaire » est un choix explicite (frais de parc, divers), jamais un défaut.
  // Un partenaire masqué reste dans la liste quand c'est le sien (audit n° 17), sinon la prestation perdait son partenaire à l'enregistrement.
  const actuel = partenaireDe(x.partenaire_id);
  const partenaire = h(
    "select",
    { id: "x-part" },
    h("option", { value: "" }, tr("Choisir le partenaire")),
    h("option", { value: AUCUN }, tr("Sans partenaire (frais de parc, divers)")),
    prestataires(etat.db.partenaires).filter((p) => p.actif !== false || p.id === x.partenaire_id).sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => h("option", { value: p.id }, p.actif === false ? tr("{nom} (masqué)", { nom: p.nom }) : p.nom))
  );
  partenaire.value = x.partenaire_id && actuel ? x.partenaire_id : x.id || options.copie ? AUCUN : "";
  const famille = h("select", { id: "x-famille" }, FAMILLES.map(([v, l]) => h("option", { value: v }, tr(l))));
  famille.value = familleInitiale(x, taxi);
  const groupe = h("input", { id: "x-groupe", value: x.groupe || "", list: "x-groupes", placeholder: tr("Excursions en groupe, Minivan privé…") });
  const groupes = h("datalist", { id: "x-groupes" }, [...new Set(etat.db.prestations.map((p) => p.groupe).filter(Boolean))].map((g) => h("option", { value: g })));
  const libelle = h("input", { id: "x-lib", value: x.libelle || "", required: true });
  const libelleEn = h("input", { id: "x-lib-en", value: x.libelle_en || "", placeholder: taxi ? tr("Pour les vouchers") : modeExcursions() ? tr("Pour les factures et les vouchers") : tr("Pour les devis en anglais") });
  const nombre = (id, v) => h("input", { id, type: "number", step: "1", min: "0", value: v ?? "", inputmode: "numeric" });
  const prixVente = nombre("x-prix", x.prix_vente);
  const prixEnfant = nombre("x-prix-enf", d.enfant);
  const unite = h("select", { id: "x-unite" }, Object.keys(UNITES).map((k) => h("option", { value: k }, k ? libelleUnite(k) : tr("sans unité"))));
  // « Sans unité » reste « sans unité » à la réouverture (audit n° 11) ; Taxi : « par véhicule » pour une nouvelle course (audit n° 20).
  unite.value = options.copie ? x.unite || "" : uniteInitiale(x, taxi);
  // Décision 3 de Jérémy (17.11.2026), lot D : sans le droit « prix de vente », les prix se lisent mais ne se changent pas (la base le refuse
  // aussi, migration 38). Une prestation créée ou dupliquée sans ce droit naît sans prix : l'administratrice le mettra.
  const prixFige = !peut("partenaires.prix");
  if (prixFige) {
    for (const c of [prixVente, prixEnfant]) (c.readOnly = true), !x.id && (c.value = "");
    unite.disabled = !!x.id;
  }
  const net = nombre("x-net", n && n.net != null ? n.net : "");
  const netEnfant = nombre("x-net-enf", n && n.net_enfant != null ? n.net_enfant : "");
  const texte = (id, v, attrs = {}) => h("input", { id, value: v || "", ...attrs });
  const zone = (id, v, rows = 2) => { const t = h("textarea", { id, rows }); t.value = v || ""; return t; };
  const horaires = texte("x-horaires", d.horaires);
  const duree = texte("x-duree", d.duree, { placeholder: tr("4 h, journée…") });
  const capacite = texte("x-cap", d.capacite, { placeholder: tr("1 à 6 personnes") });
  const qui = texte("x-qui", d.qui, { placeholder: tr("Dès 6 ans, débutants acceptés…") });
  const bateau = zone("x-bateau", d.bateau);
  const parc = zone("x-parc", d.parc);
  const moteur = texte("x-moteur", d.moteur, { placeholder: tr("125 cc auto") });
  const thaiAdulte = nombre("x-thai-ad", d.thai_adulte);
  const thaiEnfant = nombre("x-thai-enf", d.thai_enfant);
  const montantThai = texte("x-montant-thai", d.montant_thai, { lang: "th" });
  const inclus = zone("x-inclus", d.inclus, 3);
  const conditions = zone("x-cond", d.conditions);
  const note = zone("x-note", d.note);
  const surPlace = h("input", { id: "x-place", type: "checkbox", checked: !!x.sur_place });
  const actif = h("input", { id: "x-actif", type: "checkbox", checked: x.actif !== false });
  // « Sur place » n'existe que pour un frais que le client règle lui-même (droit de parc, entrée) : la prestation devient une note hors total.
  // Un partenaire que les clients paient directement (mode « sur place ») n'en relève pas : ses services restent des services, marqués payés sur place
  // (16.11.2026, deux prestations de Mr Palm cochées par erreur sont devenues des notes « 0 THB per adult » sur la facture).
  const caseSurPlace = taxi ? null : h("label", { class: "case", for: "x-place" }, surPlace, tr("Frais que le client règle lui-même sur place (droit de parc, entrée) : s'ajoute au dossier comme une note, hors total"));
  const avertSurPlace = h("p", { class: "bandeau-info", role: "status" });
  const aidePartenaire = h("p", { class: "aide", role: "status" });
  const aideEnfant = h("p", { class: "aide", role: "status" });
  // Champs propres à une famille : bateau et frais de parc pour une excursion ou une activité, moteur pour une location, tarif thaï pour un frais.
  // Masqués, ils gardent leur valeur et s'enregistrent tels quels.
  const champBateau = champ(tr("Bateau et quai"), bateau, tr("Première ligne : le bateau. Ligne suivante : le quai de départ. Imprimés sur le voucher."));
  const champParc = champ(tr("Frais de parc"), parc, tr("Ce que le client paie sur place, ou « inclus ». Imprimé sur le voucher."));
  const champMoteur = champ(tr("Moteur"), moteur, tr("Imprimé sur le voucher de location."));
  const champsThai = h("div", { class: "grille-form compacte" }, champ(tr("Tarif thaï adulte"), thaiAdulte), champ(tr("Tarif thaï enfant"), thaiEnfant));
  const majSurPlace = () => {
    const frais = surPlacePossible(famille.value);
    if (caseSurPlace) caseSurPlace.hidden = !frais;
    // Une prestation déjà notée « sur place » qui n'est pas un frais : elle redevient un service normal à l'enregistrement.
    avertSurPlace.textContent = !taxi && x.sur_place && !frais ? tr("Cette prestation était notée « frais réglé sur place » : en l'enregistrant, elle redevient un service normal, ajouté au dossier avec son prix.") : "";
    avertSurPlace.hidden = !avertSurPlace.textContent;
    const p = partenaireDe(partenaire.value && partenaire.value !== AUCUN ? partenaire.value : null);
    aidePartenaire.textContent = !taxi && p && modeParDefaut(p) === SUR_PLACE ? tr("Les clients de {partenaire} le paient directement : ses services s'ajoutent normalement au dossier, marqués payés sur place.", { partenaire: p.nom }) : "";
    aidePartenaire.hidden = !aidePartenaire.textContent;
    const f = famille.value;
    champBateau.hidden = taxi || !["excursion", "activite"].includes(f);
    champParc.hidden = taxi || !["excursion", "activite"].includes(f);
    champMoteur.hidden = taxi || f !== "location";
    champsThai.hidden = taxi || f !== "frais";
    // Prix enfant : seulement pour un tarif par personne ou par adulte. Une prestation enfant séparée existante continue de servir tant que le champ est vide.
    const parPersonne = ["pp", "ad"].includes(unite.value);
    prixEnfant.disabled = !parPersonne;
    netEnfant.disabled = !parPersonne;
    const separee = parPersonne && x.id ? prestationEnfantSeparee({ ...x, unite: unite.value, partenaire_id: partenaire.value === AUCUN ? null : partenaire.value, famille: f, groupe: groupe.value.trim(), libelle: libelle.value }, etat.db.prestations) : null;
    aideEnfant.textContent = !parPersonne
      ? tr("Pas de prix enfant pour un tarif {unite}.", { unite: libelleUnite(unite.value) || tr("sans unité") })
      : separee && prixEnfant.value === ""
        ? tr("Le tarif enfant vient aujourd'hui de la prestation « {libelle} ». Remplissez le prix enfant pour le tenir ici.", { libelle: separee.libelle })
        : unite.value === "ad" && prixEnfant.value === ""
          ? tr("Vide : les enfants ne sont pas facturés (tarif par adulte).")
          : prixEnfant.value === ""
            ? tr("Vide : les enfants paient le prix adulte.")
            : tr("Les enfants ont leur ligne à ce prix sur la facture.");
  };
  famille.addEventListener("change", majSurPlace);
  partenaire.addEventListener("change", majSurPlace);
  unite.addEventListener("change", majSurPlace);
  prixEnfant.addEventListener("input", majSurPlace);
  majSurPlace();
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const valeursSaisies = () => {
    // Prix enfant grisé (tarif ni par personne ni par adulte) : il ne s'enregistre pas, plutôt que de rester caché en base.
    const nombres = { enfant: prixEnfant.disabled ? null : nombreOuNul(prixEnfant.value), thai_adulte: nombreOuNul(thaiAdulte.value), thai_enfant: nombreOuNul(thaiEnfant.value) };
    const details = { ...d, horaires: horaires.value.trim(), duree: duree.value.trim(), capacite: capacite.value.trim(), qui: qui.value.trim(), bateau: bateau.value.trim(), parc: parc.value.trim(), moteur: moteur.value.trim(), montant_thai: montantThai.value.trim(), inclus: inclus.value.trim(), conditions: conditions.value.trim(), note: note.value.trim() };
    // Les nombres vides disparaissent des détails (un « 0 » reste : prix enfant gratuit). Les textes vides absents au départ ne s'ajoutent pas.
    for (const [k, v] of Object.entries(nombres)) if (v === null) delete details[k]; else details[k] = v;
    for (const k of ["duree", "qui", "bateau", "parc", "moteur", "montant_thai"]) if (details[k] === "" && !(k in d)) delete details[k];
    return { partenaire_id: partenaire.value === AUCUN ? null : partenaire.value, famille: famille.value, groupe: groupe.value.trim(), libelle: libelle.value.trim(), libelle_en: libelleEn.value.trim(), prix_vente: num(prixVente.value), unite: unite.value, sur_place: surPlacePossible(famille.value) && surPlace.checked, actif: actif.checked, details };
  };
  const ecrit = peut("partenaires.ecrire");
  // Enregistre la fiche ; rend la prestation enregistrée, ou null (erreur dite à la personne).
  const enregistrer = async () => {
    erreur.textContent = "";
    if (!partenaire.value) return (erreur.textContent = tr("Choisissez le partenaire, ou « Sans partenaire » pour un frais de parc ou un divers.")), partenaire.focus(), null;
    const valeurs = valeursSaisies();
    // Sans le droit « prix de vente », les prix repartent exactement comme en base (même un prix enfant que le formulaire aurait retiré) :
    // sinon la base refuserait tout l'enregistrement.
    if (prixFige && x.id) {
      valeurs.prix_vente = x.prix_vente ?? null;
      valeurs.unite = x.unite;
      if (d.enfant === undefined) delete valeurs.details.enfant;
      else valeurs.details.enfant = d.enfant;
    }
    try {
      const res = x.id ? await modifier("prestations", x.id, { ...valeurs, updated_at: new Date().toISOString() }) : await inserer("prestations", { ...valeurs, ordre: Math.max(0, ...etat.db.prestations.map((p) => p.ordre || 0)) + 1 });
      if (nets && ecrit && (net.value !== "" || netEnfant.value !== "" || (x.id && n))) await enregistrerLie("prestations_nets", "prestation_id", res.id, { net: num(net.value), net_enfant: netEnfant.disabled ? null : num(netEnfant.value), note: n ? n.note || "" : "" });
      toast(tr("Prestation enregistrée."));
      return res;
    } catch (err) {
      toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
      return null;
    }
  };
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        const res = await enregistrer();
        if (res) apres(res);
      },
    },
    h("div", { class: "grille-form" }, champ(tr("Partenaire"), partenaire), champ(tr("Famille"), famille), champ(tr("Groupe"), [groupe, groupes])),
    aidePartenaire,
    champ(tr("Libellé"), libelle),
    champ(tr("Libellé en anglais"), libelleEn),
    h("div", { class: "grille-form compacte" }, champ(tr("Prix de vente"), prixVente, prixFige ? tr("Prix, prix enfant et unité : réservés à qui a le droit « Modifier les prix de vente ».") : tr("Vide : « prix à saisir » à chaque client. 0 : offert, la ligne s'imprime « Offert » sur la facture.")), champ(tr("Unité"), unite), champ(tr("Prix enfant"), prixEnfant), nets ? champ(tr("Prix net"), net, tr("Ce que le partenaire facture.")) : null, nets ? champ(tr("Net enfant"), netEnfant, tr("Pris pour la ligne enfant.")) : null),
    aideEnfant,
    h("div", { class: "grille-form" }, champ(tr("Horaires"), horaires), champ(tr("Durée"), duree, tr("Imprimée sur le voucher.")), champ(tr("Capacité"), capacite), champ(tr("Pour qui"), qui)),
    champBateau,
    champParc,
    champMoteur,
    champsThai,
    taxi ? champ(tr("Montant en thaï"), montantThai, tr("Le prix tel que le chauffeur le lit.")) : null,
    champ(tr("Inclus"), inclus),
    champ(tr("Conditions"), conditions),
    champ(tr("Remarque interne"), note),
    // Taxi : pas de frais de parc. La case n'apparaît que pour la famille « Frais de parc ».
    caseSurPlace,
    avertSurPlace,
    h("label", { class: "case", for: "x-actif" }, actif, tr("Proposé pour les nouvelles saisies")),
    h("p", { class: "aide" }, tr("Décoché, la prestation est masquée. Les services déjà saisis, leurs factures et leurs vouchers ne changent pas.")),
    erreur,
    h(
      "div",
      { class: "actions" },
      x.id && peut("partenaires.supprimer") ? h("button", { class: "danger", type: "button", onclick: () => supprimerPrestation(x, apres) }, tr("Supprimer")) : null,
      x.id && ecrit && options.rouvrir ? h("button", { class: "secondaire", type: "button", onclick: async () => {
        // L'original est d'abord enregistré tel qu'il est à l'écran : rien de ce qu'on vient d'y taper ne se perd en ouvrant la copie.
        const copie = { ...valeursSaisies(), libelle: tr("{libelle} (copie)", { libelle: libelle.value.trim() }) };
        const netsCopie = nets ? { net: num(net.value), net_enfant: num(netEnfant.value) } : null;
        if (await enregistrer()) options.rouvrir(copie, { copie: true, netsDepart: netsCopie });
      } }, tr("Dupliquer")) : null,
      h("button", { class: "principal", type: "submit" }, tr("Enregistrer"))
    )
  );
}

// Supprimer une prestation : refusé si des services l'utilisent (on propose de la masquer), sinon une confirmation qui dit ce qui part avec elle (audit n° 15).
async function supprimerPrestation(x, apres) {
  const n = utilisations({ prestation: x }, etat.db);
  if (n) {
    const masquer = await confirmer(pluriel(n, N_("« {libelle} » est utilisée par {n} service. La supprimer retirerait à ce service son type de voucher, ses horaires et ses frais de parc. Masquez-la plutôt : elle ne sera plus proposée et ce qui existe ne change pas."), N_("« {libelle} » est utilisée par {n} services. La supprimer retirerait à ces services leur type de voucher, leurs horaires et leurs frais de parc. Masquez-la plutôt : elle ne sera plus proposée et ce qui existe ne change pas."), { libelle: x.libelle }), x.actif === false ? tr("Fermer") : tr("Masquer la prestation"));
    if (!masquer || x.actif === false) return;
    try {
      await modifier("prestations", x.id, { actif: false, updated_at: new Date().toISOString() });
      toast(tr("Prestation masquée."));
      apres(null);
    } catch (err) {
      toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    }
    return;
  }
  if (!(await confirmer(tr("Supprimer définitivement « {libelle} » et son prix net ? Aucun service ne l'utilise. Cette suppression ne peut pas être annulée.", { libelle: x.libelle }), tr("Supprimer définitivement"), true))) return;
  try {
    await supprimer("prestations", x.id);
    toast(tr("Prestation supprimée."));
    apres(null);
  } catch (err) {
    toast(tr("Suppression impossible : {message}", { message: err.message }), true);
  }
}

function formulairePrive(p, prive, apres) {
  const b = (prive && prive.banque) || {};
  const banque = h("input", { id: "b-banque", value: b.banque || b.bank || "" });
  const compte = h("input", { id: "b-compte", value: b.compte || b.account || "" });
  const titulaire = h("input", { id: "b-titulaire", value: b.titulaire || b.holder || b.name || "" });
  const autre = h("textarea", { id: "b-autre", rows: 2 });
  autre.value = b.autre || "";
  const paiement = h("textarea", { id: "b-paiement", rows: 3 });
  paiement.value = paiementPartenaire(p, prive, true);
  const commissions = h("textarea", { id: "b-commissions", rows: 3 });
  commissions.value = commissionsPartenaire(p, prive, true).join("\n");
  const regle = (prive && prive.commission_regle) || {};
  const typeCommission = h("select", { id: "b-com-type" }, h("option", { value: "" }, tr("Pas de règle chiffrée")), Object.entries(TYPES_COMMISSION).map(([v, l]) => h("option", { value: v }, tr(l))));
  typeCommission.value = TYPES_COMMISSION[regle.type] ? regle.type : "";
  const valeurCommission = h("input", { id: "b-com-valeur", type: "number", min: "0", step: "any", inputmode: "decimal", value: regle.valeur ?? "" });
  // « Prix de vente moins net » se calcule seul : le champ valeur n'a pas lieu d'être.
  const champValeur = champ(tr("Valeur"), valeurCommission);
  const majValeur = () => (champValeur.style.display = typeCommission.value === "vente_moins_net" ? "none" : "");
  typeCommission.addEventListener("change", majValeur);
  majValeur();
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const valeurs = { banque: { banque: banque.value.trim(), compte: compte.value.trim(), titulaire: titulaire.value.trim(), autre: autre.value.trim() }, paiement: paiement.value.trim() };
          try {
            const sansValeur = typeCommission.value === "vente_moins_net";
            const commission_regle = typeCommission.value && (sansValeur || valeurCommission.value !== "") ? (sansValeur ? { type: typeCommission.value } : { type: typeCommission.value, valeur: Number(valeurCommission.value.replace(",", ".")) }) : null;
            await enregistrerLie("partenaires_prives", "partenaire_id", p.id, { ...valeurs, commissions: lignesVers(commissions.value), commission_regle });
          } catch (err) {
            // Sans les migrations 16 et 19, la base ne connaît pas encore les colonnes des commissions : le reste s'enregistre quand même.
            if (!/commission/i.test(err.message)) throw err;
            await enregistrerLie("partenaires_prives", "partenaire_id", p.id, valeurs);
            toast(tr("Les commissions n'ont pas été enregistrées : les migrations 16 et 19 ne sont pas encore appliquées."), true);
          }
          toast(tr("Enregistré."));
          apres();
        } catch (err) {
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    h("div", { class: "grille-form" }, champ(tr("Banque"), banque), champ(tr("Numéro de compte"), compte), champ(tr("Titulaire"), titulaire)),
    champ(tr("Autres indications bancaires"), autre),
    champ(tr("Comment on paie ce partenaire"), paiement),
    champ(tr("Commission et marge, une règle par ligne"), commissions, tr("Réservé aux personnes qui voient les prix nets.")),
    h("div", { class: "grille-form" }, champ(tr("Commission calculée"), typeCommission, tr("Sert à préremplir la commission des services payés sur place. Laisser vide si la règle n'est pas chiffrée.")), champValeur),
    h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
  );
}
