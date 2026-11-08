// Versions précédentes d'un devis ou d'une facture : pour chacune, ce qui changerait par rapport au document actuel et un aperçu,
// avant de décider de restaurer.
import { h, modal } from "../ui.mjs";
import { formatMontant, formatDate, totaux } from "../calc.mjs";
import { comparerDocuments } from "../versions-calc.mjs";
import { tr, N_, localeActive } from "../i18n.mjs";

const dateHeure = (iso) => new Date(iso).toLocaleString(localeActive(), { dateStyle: "medium", timeStyle: "short" });

const CHAMPS = {
  bandeau: N_("Titre dans la bande de couleur"),
  colonnes: N_("Colonnes"),
  pied: N_("Pied de page"),
  variante: N_("Conditions de paiement"),
  langue: N_("Langue"),
  prestataire: N_("Prestataire"),
  tva: N_("Mention de TVA"),
  devise: N_("Devise du document"),
  paiement: N_("Mode de paiement"),
  titre_perso: N_("Titre personnalisé"),
  texte_perso: N_("Texte personnalisé"),
  cgv: N_("Phrase sur les CGV"),
};
const LIGNE = { libelle: N_("texte"), intro: N_("sous-titre"), puces: N_("détails"), unite: N_("prix"), qte: N_("quantité"), montant: N_("montant"), pct: N_("pourcentage"), date_service: N_("date du service") };

const court = (v) => {
  if (v === true) return tr("oui");
  if (v === false) return tr("non");
  const t = Array.isArray(v) ? v.join(" / ") : String(v ?? "").trim();
  if (!t) return tr("vide");
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
};

// Phrase en français pour un changement. `devise` : celle du document actuel.
export function phrase(c, devise) {
  // Chaque montant garde la devise de son document : une version peut être dans une autre devise que l'actuel.
  const mv = (n) => formatMontant(n, c.deviseVersion || devise);
  const ma = (n) => formatMontant(n, c.deviseActuel || devise);
  switch (c.type) {
    case "total": return tr("Total : {version} (actuellement {actuel})", { version: mv(c.version), actuel: ma(c.actuel) });
    case "date_emission": return tr("Date d'émission : {version} (actuellement {actuel})", { version: c.version ? formatDate(c.version) : tr("vide"), actuel: c.actuel ? formatDate(c.actuel) : tr("vide") });
    case "champ": return tr("{nom} : {version} (actuellement {actuel})", { nom: CHAMPS[c.cle] ? tr(CHAMPS[c.cle]) : c.cle, version: court(c.version), actuel: court(c.actuel) });
    case "ligne_retrouvee": return tr("« {nom} » est remise dans le document (elle en a été retirée depuis).", { nom: c.intitule });
    case "ligne_retiree": return tr("« {nom} » est retirée du document (elle a été ajoutée depuis).", { nom: c.intitule });
    case "ligne_modifiee":
      return tr("« {nom} » : {details}", { nom: c.intitule, details: c.champs.map((x) => tr("{champ} {version} (actuellement {actuel})", { champ: tr(LIGNE[x.cle] || x.cle), version: x.cle === "unite" || x.cle === "montant" ? mv(x.version) : x.cle === "date_service" && x.version ? formatDate(x.version) : court(x.version), actuel: x.cle === "unite" || x.cle === "montant" ? ma(x.actuel) : x.cle === "date_service" && x.actuel ? formatDate(x.actuel) : court(x.actuel) })).join(", ") });
    default: return "";
  }
}

// `versions` : lignes de l'historique (archive_le, ligne). `actuel` : { contenu, date_emission }.
// `rendre(version)` renvoie le nœud du document tel qu'il serait ; `restaurer(version, fermer)` fait la restauration.
export function ouvrirVersions({ versions, actuel, devise, rendre, restaurer }) {
  if (!versions.length) {
    modal(tr("Versions de ce document"), h("div", { class: "modal-corps" }, h("p", { class: "aide" }, tr("Une version est gardée avant chaque série de modifications, au plus toutes les cinq minutes, et les trente dernières sont conservées.")), h("p", { class: "vide-court" }, tr("Aucune version gardée pour l'instant. Une version est gardée avant chaque série de modifications."))));
    return;
  }
  const comparaisons = versions.map((v) => comparerDocuments({ contenu: v.ligne.contenu, date_emission: v.ligne.date_emission }, actuel, { defaut: devise }));
  let choisi = 0;
  const liste = h("ul", { class: "versions-liste" });
  const detail = h("div", { class: "version-detail", "aria-live": "polite" });
  const apercu = h("div", { class: "version-apercu", hidden: true });

  function montrerApercu(v) {
    if (!apercu.hidden) return void (apercu.hidden = true);
    const feuille = h("div", { class: "version-feuille" }, rendre(v));
    apercu.replaceChildren(feuille);
    apercu.hidden = false;
    requestAnimationFrame(() => {
      const echelle = Math.min(1, apercu.clientWidth / 794);
      feuille.style.transform = `scale(${echelle})`;
      apercu.style.height = `${feuille.offsetHeight * echelle}px`;
    });
  }

  function dessinerListe() {
    liste.replaceChildren(
      ...versions.map((v, i) => {
        const cmp = comparaisons[i];
        const n = cmp.changements.length;
        return h(
          "li",
          null,
          h(
            "button",
            { type: "button", class: "version-choix", "aria-pressed": String(i === choisi), onclick: () => { choisi = i; apercu.hidden = true; dessinerListe(); dessinerDetail(); } },
            h("strong", null, dateHeure(v.archive_le)),
            h("span", null, formatMontant(totaux(v.ligne.contenu).net, v.ligne.contenu.devise || devise)),
            h("span", { class: "version-nb" }, cmp.identique ? tr("Identique à l'actuel") : n === 1 ? tr("1 différence") : tr("{n} différences", { n }))
          )
        );
      })
    );
  }

  function dessinerDetail() {
    const v = versions[choisi];
    const cmp = comparaisons[choisi];
    apercu.hidden = true;
    detail.replaceChildren(
      h("h3", null, tr("Version du {date}", { date: dateHeure(v.archive_le) })),
      ...(cmp.identique
        ? [h("p", { class: "aide" }, tr("Cette version est identique au document actuel."))]
        : [h("p", { class: "aide" }, tr("Ce qui change si vous restaurez cette version :")), h("ul", { class: "version-diff" }, cmp.changements.map((c) => h("li", { class: `diff-${c.type}` }, phrase(c, devise))))]),
      h("div", { class: "actions gauche" }, h("button", { class: "secondaire", type: "button", onclick: () => montrerApercu(v) }, tr("Voir cette version")), h("button", { class: "principal", type: "button", onclick: () => restaurer(v, fermer) }, tr("Restaurer cette version"))),
      apercu
    );
  }

  dessinerListe();
  dessinerDetail();
  const fermer = modal(tr("Versions de ce document"), h("div", { class: "modal-corps versions" }, h("p", { class: "aide" }, tr("Une version est gardée avant chaque série de modifications, au plus toutes les cinq minutes, et les trente dernières sont conservées.")), h("div", { class: "versions-grille" }, liste, detail)), { large: true });
}
