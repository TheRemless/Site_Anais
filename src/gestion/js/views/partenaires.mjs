// Partenaires : la liste, la fiche d'un partenaire (contact, tarifs, règles, contrat, banque, tâches) et les formulaires.
import { etat, peut, inserer, modifier, supprimer, naviguer, partenaireDe, nomPartenaire, netPrestation, privePartenaire, enregistrerLie } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, icone, num } from "../ui.mjs";
import { formatMontant, formatDate, aujourdhui } from "../calc.mjs";
import { FAMILLES, nomFamille, libelleUnite, marge, correspond, UNITES } from "../partenaires-calc.mjs";
import { vide, cartes } from "./commun.mjs";
import { listeTaches } from "./taches.mjs";

export const GROUPES = [
  ["mer", "Bateaux et excursions en mer"],
  ["activite", "Activités et expériences"],
  ["location", "Locations"],
  ["transport", "Transferts et taxis"],
  ["autre", "Autres"],
];

export const prix = (n) => (n === null || n === undefined || n === "" ? "—" : formatMontant(n));
export const voitNets = () => peut("partenaires.nets");

// Marge affichée : montant puis pourcentage. Rouge quand nulle ou négative, orange sous 12 %.
export function margeNoeud(vente, net) {
  const m = marge(vente, net);
  if (!m) return h("span", { class: "sec" }, "—");
  return h("span", { class: `marge ${m.montant <= 0 ? "marge-nulle" : m.pct < 12 ? "marge-basse" : ""}` }, prix(m.montant), " ", h("span", { class: "tag" }, `${m.pct} %`));
}

// Numéros thaïlandais : « 081-9789025 » devient +66819789025 pour les liens d'appel et WhatsApp.
export function chiffres(numero) {
  const m = String(numero || "").match(/\+?\d[\d\s\-()]{6,}\d/);
  if (!m) return "";
  let d = m[0].replace(/[^\d+]/g, "");
  if (d[0] !== "+" && d[0] === "0") d = `+66${d.slice(1)}`;
  return d;
}

async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    toast("Copié.");
  } catch {
    toast("Copie impossible dans ce navigateur.", true);
  }
}

export function telephone(t) {
  const d = chiffres(t.numero);
  return h(
    "span",
    { class: "tel" },
    d ? h("a", { href: `tel:${d}` }, t.numero) : h("span", null, t.numero),
    t.libelle ? h("span", { class: "tag" }, t.libelle) : null,
    d && t.whatsapp ? h("a", { class: "bouton-icone lien", href: `https://wa.me/${d.replace("+", "")}`, target: "_blank", rel: "noopener", "aria-label": `WhatsApp ${t.numero}`, title: "WhatsApp" }, icone("whatsapp")) : null,
    h("button", { class: "bouton-icone lien", type: "button", "aria-label": `Copier ${t.numero}`, title: "Copier", onclick: () => copier(t.numero) }, icone("copier"))
  );
}

export function etatContrat(p) {
  const c = p.contrat || {};
  const ajd = aujourdhui();
  const fini = c.fin && c.fin < ajd;
  const bientot = c.fin && !fini && c.fin <= ajouterJours(ajd, 30);
  const code = fini ? "fini" : bientot || c.etat === "attention" ? "attention" : "ok";
  const texte = fini ? `Contrat terminé le ${formatDate(c.fin)}` : bientot ? `Expire le ${formatDate(c.fin)}` : c.statut || (c.fin ? `Jusqu'au ${formatDate(c.fin)}` : "Sans date de fin");
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
export function listePartenaires() {
  const corps = h("div");
  const q = h("input", { id: "rech-partenaires", type: "search", placeholder: "Nom, catégorie, personne", oninput: () => dessiner() });
  function dessiner() {
    corps.replaceChildren();
    const tous = etat.db.partenaires.filter((p) => p.actif !== false).sort((a, b) => (a.ordre || 0) - (b.ordre || 0) || a.nom.localeCompare(b.nom));
    const visibles = tous.filter((p) => correspond(`${p.nom} ${p.nom_thai} ${p.categorie} ${p.role} ${(p.contact || {}).personne || ""}`, q.value));
    if (!visibles.length) {
      corps.append(tous.length ? vide("Aucun partenaire ne correspond", "Essayez une autre recherche.") : vide("Aucun partenaire pour l'instant", "Un partenaire regroupe ses contacts, ses tarifs, ses trajets, ses règles et son contrat.", peut("partenaires.ecrire") ? h("button", { class: "principal", type: "button", onclick: () => ouvrirFormulaire({}) }, "Ajouter le premier partenaire") : null));
      return;
    }
    for (const [code, titre] of GROUPES) {
      const du = visibles.filter((p) => (p.groupe || "autre") === code || (!GROUPES.some(([c]) => c === p.groupe) && code === "autre"));
      if (!du.length) continue;
      corps.append(
        h(
          "section",
          null,
          h("h2", null, titre),
          h(
            "ul",
            { class: "cartes grille" },
            du.map((p) => {
              const n = etat.db.prestations.filter((x) => x.partenaire_id === p.id && x.actif !== false).length;
              const t = etat.db.trajets.filter((x) => x.partenaire_id === p.id).length;
              const tel = ((p.contact || {}).telephones || [])[0];
              return h(
                "li",
                { class: "carte" },
                h(
                  "a",
                  { class: "carte-lien", href: `#/partenaire/${p.id}` },
                  h("span", { class: "carte-titre" }, p.nom),
                  h("span", { class: "carte-droite" }, tel ? h("span", null, tel.numero) : null),
                  h("span", { class: "carte-sous" }, p.role || p.categorie),
                  h("span", { class: "carte-pied" }, etatContrat(p), h("span", { class: "ref" }, [n ? `${n} tarif${n > 1 ? "s" : ""}` : "", t ? `${t} trajet${t > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ")))
                )
              );
            })
          )
        )
      );
    }
  }
  const ouvrirFormulaire = (p) => {
    const fermer = modal(p.id ? "Modifier le partenaire" : "Nouveau partenaire", formulairePartenaire(p, (r) => (fermer(), naviguer(`#/partenaire/${r.id}`))), { large: true });
  };
  dessiner();
  return h(
    "div",
    { "data-titre": "Partenaires" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, "Partenaires"), h("p", { class: "sous" }, `${etat.db.partenaires.filter((p) => p.actif !== false).length} partenaires, ${etat.db.prestations.filter((p) => p.actif !== false).length} tarifs, ${etat.db.trajets.length} trajets`)), h("div", { class: "entete-actions" }, h("a", { class: "bouton secondaire", href: "#/tarifs" }, "Tarifs"), h("a", { class: "bouton secondaire", href: "#/trajets" }, "Trajets"), peut("partenaires.ecrire") ? h("button", { class: "principal", type: "button", onclick: () => ouvrirFormulaire({}) }, "Nouveau partenaire") : null)),
    h("div", { class: "barre-outils" }, h("div", { class: "champ recherche" }, h("label", { for: "rech-partenaires" }, "Rechercher"), q)),
    corps
  );
}

// ---- Fiche --------------------------------------------------------------------------------------------------
export function fichePartenaire(id) {
  const p = partenaireDe(id);
  if (!p) return vide("Partenaire introuvable", "Il a peut-être été supprimé.", h("a", { class: "bouton secondaire", href: "#/partenaires" }, "Retour aux partenaires"));
  const c = p.contact || {};
  const r = p.regles || {};
  const ct = p.contrat || {};
  const ecrit = peut("partenaires.ecrire");
  const prive = voitNets() ? privePartenaire(p) : null;
  const prestations = etat.db.prestations.filter((x) => x.partenaire_id === p.id).sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  const trajets = etat.db.trajets.filter((x) => x.partenaire_id === p.id);
  const taches = etat.db.taches.filter((t) => t.partenaire_id === p.id && !t.fait);
  const rafraichir = () => naviguer(location.hash);
  const bloc = (titre, ...contenu) => (contenu.flat().some(Boolean) ? h("section", { class: "bloc" }, h("h2", null, titre), ...contenu) : null);
  const ligne = (libelle, valeur) => (valeur ? h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, libelle), h("span", null, valeur)) : null);

  const groupes = [...new Set(prestations.map((x) => x.groupe || nomFamille(x.famille)))];
  const tarifs = groupes.map((g) => {
    const lignes = prestations.filter((x) => (x.groupe || nomFamille(x.famille)) === g);
    return h("div", { class: "groupe-tarifs" }, h("h3", null, g), tableauPrestations(lignes, { avecPartenaire: false, apres: rafraichir }));
  });

  return h(
    "div",
    { "data-titre": p.nom, "data-large": true },
    h("a", { class: "retour", href: "#/partenaires" }, "Partenaires"),
    h(
      "div",
      { class: "entete" },
      h("div", null, h("h1", null, p.nom), h("p", { class: "sous" }, [p.role, p.categorie].filter(Boolean).join(" · "), p.nom_thai ? h("span", { class: "sous-ligne", lang: "th" }, p.nom_thai) : null)),
      h("div", { class: "entete-actions" }, etatContrat(p), ecrit ? h("button", { class: "secondaire", type: "button", onclick: () => { const fermer = modal("Modifier le partenaire", formulairePartenaire(p, () => (fermer(), rafraichir())), { large: true }); } }, "Modifier") : null)
    ),
    p.actif === false ? h("div", { class: "bandeau-info" }, "Ce partenaire est marqué comme inactif : il n'apparaît plus dans les listes ni dans les devis.") : null,
    h(
      "div",
      { class: "deux-colonnes fiche" },
      h(
        "div",
        null,
        bloc(
          "Contact",
          ligne("Personne", c.personne),
          (c.telephones || []).length ? h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, "Téléphone"), h("span", { class: "tels" }, (c.telephones || []).map(telephone))) : null,
          (c.emails || []).length ? h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, "E-mail"), h("span", null, (c.emails || []).map((e, i) => [i ? ", " : "", h("a", { href: `mailto:${e}` }, e)]))) : null,
          ligne("Line", c.line),
          c.web ? h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, "Site"), h("a", { href: /^https?:/.test(c.web) ? c.web : `https://${c.web}`, target: "_blank", rel: "noopener" }, c.web)) : null,
          ligne("Adresse", c.adresse),
          ligne("Embarcadère", c.embarcadere),
          ligne("Licence", c.licence),
          (c.guichets || []).length
            ? h("div", { class: "guichets" }, h("h3", null, "Guichets et bureaux"), (c.guichets || []).map((g) => h("div", { class: "guichet" }, h("strong", null, g.lieu), g.adresse ? h("span", null, g.adresse) : null, (g.telephones || []).length ? h("span", { class: "tels" }, (g.telephones || []).map((n) => telephone({ numero: n }))) : null, g.line ? h("span", null, `Line : ${g.line}`) : null, g.email ? h("a", { href: `mailto:${g.email}` }, g.email) : null)))
            : null
        ),
        bloc(
          "Contrat",
          ligne("Statut", ct.statut),
          ligne("Saison", ct.saison),
          ligne("Validité", ct.validite),
          ligne("Fin", ct.fin ? formatDate(ct.fin) : ""),
          (ct.documents || []).length ? h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, "Documents"), h("span", null, (ct.documents || []).join(", "))) : null,
          (ct.evenements || []).length ? h("ul", { class: "liste-regles" }, (ct.evenements || []).map((e) => h("li", null, h("strong", null, e.date), ` ${e.libelle}`))) : null
        ),
        prive || (ecrit && voitNets())
          ? bloc(
              "Paiement et coordonnées bancaires",
              h("p", { class: "aide" }, "Visible seulement avec le droit « prix nets ». Ne figure jamais sur un document client."),
              prive && prive.paiement ? paragraphes(prive.paiement) : null,
              prive && prive.banque && Object.keys(prive.banque).length ? h("div", { class: "banque" }, Object.entries(prive.banque).map(([k, v]) => ligne(k.charAt(0).toUpperCase() + k.slice(1), typeof v === "string" ? v : JSON.stringify(v)))) : null,
              ecrit && voitNets() ? h("div", { class: "actions gauche" }, h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal("Paiement et banque", formulairePrive(p, prive, () => (fermer(), rafraichir()))); } }, prive ? "Modifier" : "Renseigner")) : null
            )
          : null
      ),
      h(
        "div",
        null,
        bloc(
          "Règles",
          r.annulation ? h("div", null, h("h3", null, "Annulation"), paragraphes(r.annulation)) : null,
          r.paiement ? h("div", null, h("h3", null, "Paiement"), paragraphes(r.paiement)) : null,
          r.enfants && r.enfants.length ? h("div", null, h("h3", null, "Enfants"), liste(r.enfants)) : null,
          r.commissions && r.commissions.length ? h("div", null, h("h3", null, "Commission et marge"), liste(r.commissions)) : null,
          r.checkin && r.checkin.length ? h("div", null, h("h3", null, "Check-in"), liste(r.checkin)) : null,
          r.points_embarquement && r.points_embarquement.length ? h("div", null, h("h3", null, "Points d'embarquement"), h("ul", { class: "liste-regles" }, r.points_embarquement.map((x) => h("li", null, h("strong", null, x.lieu), ` ${x.ou}`)))) : null
        ),
        (r.pickups || []).length ? bloc("Prise en charge à l'hôtel", (r.pickups || []).map(tableauPickup)) : null,
        p.notes ? bloc("Notes", paragraphes(p.notes)) : null,
        trajets.length ? bloc("Trajets", h("p", null, `${trajets.length} trajets avec horaires, prix et périodes. `, h("a", { href: `#/trajets?partenaire=${p.id}` }, "Voir les trajets"))) : null
      )
    ),
    h(
      "section",
      null,
      h("div", { class: "entete petit-entete" }, h("h2", null, "Tarifs"), ecrit ? h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal("Nouvelle prestation", formulairePrestation({ partenaire_id: p.id }, () => (fermer(), rafraichir()))); } }, "Nouvelle prestation") : null),
      prestations.length ? tarifs : h("p", { class: "vide-court" }, "Aucun tarif enregistré pour ce partenaire.")
    ),
    h(
      "section",
      null,
      h("div", { class: "entete petit-entete" }, h("h2", null, "À régler avec ce partenaire"), peut("taches.ecrire") ? h("button", { class: "secondaire petit", type: "button", onclick: () => nouvelleTache(p, rafraichir) }, "Nouvelle tâche") : null),
      taches.length ? listeTaches(taches, { avecDossier: false }) : h("p", { class: "vide-court" }, "Rien en attente. Les points à clarifier avec le partenaire s'ajoutent ici comme des tâches.")
    ),
    ecrit ? h("div", { class: "zone-danger" }, h("button", { class: "lien danger-texte", type: "button", onclick: async () => { if (await confirmer(`Supprimer « ${p.nom} » et tous ses tarifs et trajets ? Les devis déjà créés ne changent pas.`, "Supprimer", true)) { await supprimer("partenaires", p.id); toast("Partenaire supprimé."); naviguer("#/partenaires"); } } }, "Supprimer ce partenaire")) : null
  );
}

function tableauPickup(t) {
  return h(
    "div",
    { class: "pickup" },
    h("h3", null, t.titre),
    h("div", { class: "defilant" }, h("table", { class: "tableau simple compact" }, h("thead", null, h("tr", null, h("th", { scope: "col" }, "Zone"), (t.colonnes || []).map((c) => h("th", { scope: "col", class: "num" }, c)))), h("tbody", null, (t.lignes || []).map((l) => h("tr", null, h("td", null, h("strong", null, l[0])), l.slice(1).map((v) => h("td", { class: "num" }, v)))))))
  );
}

async function nouvelleTache(p, apres) {
  const titre = h("input", { id: "t-titre", required: true, placeholder: "Faire confirmer le net haute saison" });
  const echeance = h("input", { id: "t-ech", type: "date" });
  const fermer = modal(
    "Nouvelle tâche",
    h(
      "form",
      {
        class: "modal-corps",
        onsubmit: async (e) => {
          e.preventDefault();
          await inserer("taches", { partenaire_id: p.id, dossier_id: null, titre: titre.value.trim(), description: "", echeance: echeance.value || null, assignee_id: etat.session.id, fait: false, fait_le: null, fait_par: null });
          toast("Tâche ajoutée.");
          fermer();
          apres();
        },
      },
      champ("Titre", titre),
      champ("Échéance (facultatif)", echeance),
      h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, "Ajouter"))
    )
  );
}

// ---- Tableau de prestations (fiche, écran Tarifs) ---------------------------------------------------------------
// Tableau sur grand écran, cartes sur téléphone. Les colonnes net et marge n'existent qu'avec le droit.
export function tableauPrestations(lignes, { avecPartenaire = true, apres = () => {} } = {}) {
  const nets = voitNets();
  const ecrit = peut("partenaires.ecrire");
  const detail = (x) => {
    const d = x.details || {};
    const items = [["Horaires", d.horaires], ["Durée", d.duree], ["Capacité", d.capacite], ["Bateau", d.bateau], ["Pour qui", d.qui], ["Inclus", d.inclus], ["Frais de parc", d.parc], ["Conditions", d.conditions], ["Remarque", d.note], ["Moteur", d.moteur], ["Montant en thaï", d.montant_thai], ["Prix affiché", d.vente_texte]].filter(([, v]) => v !== undefined && v !== null && v !== "");
    if (d.enfant !== undefined) items.push(["Enfant", `${prix(d.enfant)}${d.thai_adulte ? ` (tarif thaï ${prix(d.thai_adulte)} adulte, ${prix(d.thai_enfant)} enfant)` : ""}`]);
    if (d.partenaires) items.push(["Concerne", d.partenaires]);
    if (!items.length) return null;
    return h("details", { class: "detail-prestation" }, h("summary", null, "Détail"), items.map(([k, v]) => h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, k), h("span", null, paragraphes(String(v))))));
  };
  const modif = (x) => (ecrit ? h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal("Modifier la prestation", formulairePrestation(x, () => (fermer(), apres()))); } }, "Modifier") : null);
  const sousTexte = (x) => [x.details && x.details.horaires, x.details && x.details.capacite, x.details && x.details.duree, libelleUnite(x.unite), x.sur_place ? "à payer sur place" : ""].filter(Boolean).join(" · ");
  return [
    cartes(lignes, (x) => {
      const n = nets ? netPrestation(x) : null;
      return h(
        "div",
        { class: "carte-lien statique" },
        h("span", { class: "carte-titre" }, x.libelle, x.actif === false ? h("span", { class: "tag" }, "masqué") : null),
        h("span", { class: "carte-droite" }, h("strong", null, prix(x.prix_vente)), nets ? h("span", { class: "net" }, n && n.net != null ? `net ${prix(n.net)}` : "net n/d") : null),
        h("span", { class: "carte-sous" }, [avecPartenaire ? nomPartenaire(x.partenaire_id) : "", sousTexte(x)].filter(Boolean).join(" · ")),
        h("span", { class: "carte-pied" }, nets ? margeNoeud(x.prix_vente, n && n.net) : h("span"), modif(x)),
        detail(x)
      );
    }),
    h(
      "table",
      { class: "tableau seulement-bureau tarifs" },
      h("thead", null, h("tr", null, [avecPartenaire ? "Partenaire" : null, "Prestation", "Unité", "Vente", nets ? "Net" : null, nets ? "Marge" : null, ""].filter((x) => x !== null).map((t, i) => h("th", { scope: "col", class: ["Vente", "Net", "Marge"].includes(t) ? "num" : null }, t)))),
      h(
        "tbody",
        null,
        lignes.map((x) => {
          const n = nets ? netPrestation(x) : null;
          return h(
            "tr",
            { class: x.actif === false ? "inactif" : null },
            avecPartenaire ? h("td", null, h("a", { href: `#/partenaire/${x.partenaire_id}` }, nomPartenaire(x.partenaire_id)) || "—") : null,
            h("td", null, h("strong", null, x.libelle), x.actif === false ? h("span", { class: "tag" }, "masqué") : null, h("span", { class: "sous-ligne" }, sousTexte(x)), detail(x)),
            h("td", null, libelleUnite(x.unite)),
            h("td", { class: "num" }, prix(x.prix_vente)),
            nets ? h("td", { class: "num net" }, n && n.net != null ? prix(n.net) : "n/d") : null,
            nets ? h("td", { class: "num" }, margeNoeud(x.prix_vente, n && n.net)) : null,
            h("td", { class: "action-cellule" }, modif(x))
          );
        })
      )
    ),
  ];
}

// ---- Formulaires --------------------------------------------------------------------------------------------
const lignesVers = (texte) => String(texte || "").split("\n").map((l) => l.trim()).filter(Boolean);

export function formulairePartenaire(p, apres) {
  const c = p.contact || {};
  const r = p.regles || {};
  const ct = p.contrat || {};
  const nom = h("input", { id: "p-nom", value: p.nom || "", required: true });
  const nomThai = h("input", { id: "p-thai", value: p.nom_thai || "", lang: "th" });
  const categorie = h("input", { id: "p-cat", value: p.categorie || "", list: "p-cats", placeholder: "Excursions bateaux, Ferries et speedboats…" });
  const cats = h("datalist", { id: "p-cats" }, [...new Set(etat.db.partenaires.map((x) => x.categorie).filter(Boolean))].map((x) => h("option", { value: x })));
  const groupe = h("select", { id: "p-groupe" }, GROUPES.map(([v, l]) => h("option", { value: v }, l)));
  groupe.value = GROUPES.some(([v]) => v === p.groupe) ? p.groupe : "autre";
  const role = h("input", { id: "p-role", value: p.role || "", placeholder: "Ce que fait ce partenaire, en une ligne" });
  const personne = h("input", { id: "p-personne", value: c.personne || "" });
  const tels = h("textarea", { id: "p-tels", rows: 3, placeholder: "081-000-0000 | Réservations | whatsapp" });
  tels.value = (c.telephones || []).map((t) => [t.numero, t.libelle || "", t.whatsapp ? "whatsapp" : ""].join(" | ").replace(/( \| )+$/, "")).join("\n");
  const emails = h("input", { id: "p-emails", value: (c.emails || []).join(", ") });
  const line = h("input", { id: "p-line", value: c.line || "" });
  const web = h("input", { id: "p-web", value: c.web || "" });
  const adresse = h("textarea", { id: "p-adresse", rows: 2 });
  adresse.value = c.adresse || "";
  const embarcadere = h("input", { id: "p-pier", value: c.embarcadere || "" });
  const licence = h("input", { id: "p-licence", value: c.licence || "" });
  const annulation = h("textarea", { id: "p-annul", rows: 2 });
  annulation.value = r.annulation || "";
  const paiement = h("textarea", { id: "p-paiement", rows: 2 });
  paiement.value = r.paiement || "";
  const enfants = h("textarea", { id: "p-enfants", rows: 2 });
  enfants.value = (r.enfants || []).join("\n");
  const commissions = h("textarea", { id: "p-comm", rows: 2 });
  commissions.value = (r.commissions || []).join("\n");
  const checkin = h("textarea", { id: "p-checkin", rows: 2 });
  checkin.value = (r.checkin || []).join("\n");
  const statut = h("input", { id: "p-statut", value: ct.statut || "", placeholder: "Tarifs nets confirmés, contrat à signer…" });
  const saison = h("input", { id: "p-saison", value: ct.saison || "" });
  const fin = h("input", { id: "p-fin", type: "date", value: ct.fin || "" });
  const documents = h("input", { id: "p-docs", value: (ct.documents || []).join(", ") });
  const notes = h("textarea", { id: "p-notes", rows: 3 });
  notes.value = p.notes || "";
  const actif = h("input", { id: "p-actif", type: "checkbox", checked: p.actif !== false });
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        const valeurs = {
          nom: nom.value.trim(),
          nom_thai: nomThai.value.trim(),
          categorie: categorie.value.trim(),
          groupe: groupe.value,
          role: role.value.trim(),
          contact: { ...c, personne: personne.value.trim(), telephones: lignesVers(tels.value).map((l) => { const [numero, libelle, wa] = l.split("|").map((x) => x.trim()); return { numero, libelle: libelle || "", whatsapp: /whatsapp|wa/i.test(wa || "") }; }), emails: emails.value.split(",").map((x) => x.trim()).filter(Boolean), line: line.value.trim(), web: web.value.trim(), adresse: adresse.value.trim(), embarcadere: embarcadere.value.trim(), licence: licence.value.trim() },
          regles: { ...r, annulation: annulation.value.trim(), paiement: paiement.value.trim(), enfants: lignesVers(enfants.value), commissions: lignesVers(commissions.value), checkin: lignesVers(checkin.value) },
          contrat: { ...ct, statut: statut.value.trim(), saison: saison.value.trim(), fin: fin.value || null, documents: documents.value.split(",").map((x) => x.trim()).filter(Boolean) },
          notes: notes.value.trim(),
          actif: actif.checked,
        };
        try {
          const res = p.id ? await modifier("partenaires", p.id, { ...valeurs, updated_at: new Date().toISOString() }) : await inserer("partenaires", { ...valeurs, ordre: Math.max(0, ...etat.db.partenaires.map((x) => x.ordre || 0)) + 1 });
          toast("Partenaire enregistré.");
          apres(res);
        } catch (err) {
          toast(`Enregistrement impossible : ${err.message}`, true);
        }
      },
    },
    h("div", { class: "grille-form" }, champ("Nom", nom), champ("Nom en thaï", nomThai), champ("Catégorie", [categorie, cats]), champ("Groupe", groupe)),
    champ("Rôle", role),
    h("h3", null, "Contact"),
    h("div", { class: "grille-form" }, champ("Personne", personne), champ("E-mails, séparés par des virgules", emails), champ("Line", line), champ("Site", web)),
    champ("Téléphones, un par ligne", tels, "Numéro, puis libellé, puis « whatsapp », séparés par des barres verticales."),
    h("div", { class: "grille-form" }, champ("Adresse", adresse), champ("Embarcadère ou point de départ", embarcadere), champ("Licence", licence)),
    h("h3", null, "Règles"),
    h("div", { class: "grille-form" }, champ("Annulation", annulation), champ("Paiement du partenaire", paiement), champ("Enfants, une règle par ligne", enfants), champ("Commission et marge, une règle par ligne", commissions), champ("Check-in, une règle par ligne", checkin)),
    h("h3", null, "Contrat"),
    h("div", { class: "grille-form" }, champ("Statut", statut), champ("Saison", saison), champ("Fin du contrat", fin, "Un rappel apparaît dans Aujourd'hui trente jours avant."), champ("Documents, séparés par des virgules", documents)),
    champ("Notes", notes),
    h("label", { class: "case", for: "p-actif" }, actif, "Partenaire actif"),
    h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, "Enregistrer"))
  );
}

export function formulairePrestation(x, apres) {
  const d = x.details || {};
  const nets = voitNets();
  const n = x.id && nets ? netPrestation(x) : null;
  const partenaire = h("select", { id: "x-part" }, h("option", { value: "" }, "Sans partenaire (frais de parc, divers)"), etat.db.partenaires.filter((p) => p.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => h("option", { value: p.id }, p.nom)));
  partenaire.value = x.partenaire_id || "";
  const famille = h("select", { id: "x-famille" }, FAMILLES.map(([v, l]) => h("option", { value: v }, l)));
  famille.value = x.famille || "excursion";
  const groupe = h("input", { id: "x-groupe", value: x.groupe || "", list: "x-groupes", placeholder: "Excursions en groupe, Minivan privé…" });
  const groupes = h("datalist", { id: "x-groupes" }, [...new Set(etat.db.prestations.map((p) => p.groupe).filter(Boolean))].map((g) => h("option", { value: g })));
  const libelle = h("input", { id: "x-lib", value: x.libelle || "", required: true });
  const libelleEn = h("input", { id: "x-lib-en", value: x.libelle_en || "", placeholder: "Pour les devis en anglais" });
  const prixVente = h("input", { id: "x-prix", type: "number", step: "1", min: "0", value: x.prix_vente ?? "", inputmode: "numeric" });
  const unite = h("select", { id: "x-unite" }, Object.keys(UNITES).map((k) => h("option", { value: k }, k ? libelleUnite(k) : "sans unité")));
  unite.value = x.unite || "pp";
  const net = h("input", { id: "x-net", type: "number", step: "1", min: "0", value: n && n.net != null ? n.net : "", inputmode: "numeric" });
  const netEnfant = h("input", { id: "x-net-enf", type: "number", step: "1", min: "0", value: n && n.net_enfant != null ? n.net_enfant : "", inputmode: "numeric" });
  const horaires = h("input", { id: "x-horaires", value: d.horaires || "" });
  const capacite = h("input", { id: "x-cap", value: d.capacite || "" });
  const inclus = h("textarea", { id: "x-inclus", rows: 3 });
  inclus.value = d.inclus || "";
  const conditions = h("textarea", { id: "x-cond", rows: 2 });
  conditions.value = d.conditions || "";
  const note = h("textarea", { id: "x-note", rows: 2 });
  note.value = d.note || "";
  const surPlace = h("input", { id: "x-place", type: "checkbox", checked: !!x.sur_place });
  const actif = h("input", { id: "x-actif", type: "checkbox", checked: x.actif !== false });
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        const valeurs = { partenaire_id: partenaire.value || null, famille: famille.value, groupe: groupe.value.trim(), libelle: libelle.value.trim(), libelle_en: libelleEn.value.trim(), prix_vente: num(prixVente.value), unite: unite.value, sur_place: surPlace.checked, actif: actif.checked, details: { ...d, horaires: horaires.value.trim(), capacite: capacite.value.trim(), inclus: inclus.value.trim(), conditions: conditions.value.trim(), note: note.value.trim() } };
        try {
          const res = x.id ? await modifier("prestations", x.id, { ...valeurs, updated_at: new Date().toISOString() }) : await inserer("prestations", { ...valeurs, ordre: Math.max(0, ...etat.db.prestations.map((p) => p.ordre || 0)) + 1 });
          if (nets && peut("partenaires.ecrire") && (net.value !== "" || netEnfant.value !== "" || n)) await enregistrerLie("prestations_nets", "prestation_id", res.id, { net: num(net.value), net_enfant: num(netEnfant.value), note: n ? n.note || "" : "" });
          toast("Prestation enregistrée.");
          apres(res);
        } catch (err) {
          toast(`Enregistrement impossible : ${err.message}`, true);
        }
      },
    },
    h("div", { class: "grille-form" }, champ("Partenaire", partenaire), champ("Famille", famille), champ("Groupe", [groupe, groupes])),
    champ("Libellé", libelle),
    champ("Libellé en anglais", libelleEn),
    h("div", { class: "grille-form compacte" }, champ("Prix de vente", prixVente, "Laissez vide quand le prix se négocie à chaque client."), champ("Unité", unite), nets ? champ("Prix net", net, "Ce que le partenaire facture.") : null, nets ? champ("Net enfant", netEnfant) : null),
    h("div", { class: "grille-form" }, champ("Horaires", horaires), champ("Capacité ou pour qui", capacite)),
    champ("Inclus", inclus),
    champ("Conditions", conditions),
    champ("Remarque interne", note),
    h("label", { class: "case", for: "x-place" }, surPlace, "À payer sur place par le client (frais de parc), hors total du devis"),
    h("label", { class: "case", for: "x-actif" }, actif, "Proposé dans les devis et les listes"),
    h("div", { class: "actions" }, x.id && peut("partenaires.ecrire") ? h("button", { class: "danger", type: "button", onclick: async () => { if (await confirmer(`Supprimer « ${x.libelle} » ? Les devis déjà créés ne changent pas.`, "Supprimer", true)) { await supprimer("prestations", x.id); toast("Prestation supprimée."); apres(null); } } }, "Supprimer") : null, h("button", { class: "principal", type: "submit" }, "Enregistrer"))
  );
}

function formulairePrive(p, prive, apres) {
  const b = (prive && prive.banque) || {};
  const banque = h("input", { id: "b-banque", value: b.banque || b.bank || "" });
  const compte = h("input", { id: "b-compte", value: b.compte || b.account || "" });
  const titulaire = h("input", { id: "b-titulaire", value: b.titulaire || b.holder || b.name || "" });
  const autre = h("textarea", { id: "b-autre", rows: 2 });
  autre.value = b.autre || "";
  const paiement = h("textarea", { id: "b-paiement", rows: 3 });
  paiement.value = (prive && prive.paiement) || "";
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await enregistrerLie("partenaires_prives", "partenaire_id", p.id, { banque: { banque: banque.value.trim(), compte: compte.value.trim(), titulaire: titulaire.value.trim(), autre: autre.value.trim() }, paiement: paiement.value.trim() });
          toast("Enregistré.");
          apres();
        } catch (err) {
          toast(`Enregistrement impossible : ${err.message}`, true);
        }
      },
    },
    h("div", { class: "grille-form" }, champ("Banque", banque), champ("Numéro de compte", compte), champ("Titulaire", titulaire)),
    champ("Autres indications bancaires", autre),
    champ("Comment on paie ce partenaire", paiement),
    h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, "Enregistrer"))
  );
}
