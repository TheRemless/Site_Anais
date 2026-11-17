// Tarifs : toutes les prestations des partenaires par famille, avec recherche, prix de vente, net et marge.
import { etat, peut, naviguer, nomPartenaire, partenaireDe, modeTaxi } from "../etat.mjs";
import { h } from "../ui.mjs";
import { FAMILLES, nomFamille, correspond, familleInitiale } from "../partenaires-calc.mjs";
import { vide } from "./commun.mjs";
import { tableauPrestations, ouvrirPrestation, voitNets } from "./partenaires.mjs";
import { tr, pluriel, N_ } from "../i18n.mjs";

export function vueTarifs() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const presentes = FAMILLES.filter(([code]) => etat.db.prestations.some((p) => p.famille === code));
  // Taxi : on ouvre sur les transferts, la famille des courses (audit n° 20).
  const parDefaut = presentes.some(([c]) => c === familleInitiale({}, modeTaxi())) ? familleInitiale({}, modeTaxi()) : (presentes[0] || [familleInitiale({}, modeTaxi())])[0];
  let famille = presentes.some(([c]) => c === params.get("famille")) ? params.get("famille") : parDefaut;
  const q = h("input", { id: "rech-tarifs", type: "search", value: params.get("q") || "", placeholder: tr("Prestation, partenaire, île, horaire"), oninput: () => dessiner() });
  // Les partenaires masqués restent dans le filtre, marqués : leurs tarifs se retrouvent et se réactivent (audit n° 5).
  const partenaire = h("select", { id: "filtre-part", onchange: () => dessiner() }, h("option", { value: "" }, tr("Tous les partenaires")), [...etat.db.partenaires].sort((a, b) => (a.actif === false) - (b.actif === false) || a.nom.localeCompare(b.nom)).map((p) => h("option", { value: p.id }, p.actif === false ? tr("{nom} (masqué)", { nom: p.nom }) : p.nom)));
  partenaire.value = params.get("partenaire") || "";
  const corps = h("div");
  const onglets = h("div", { class: "onglets sous-onglets" }, presentes.map(([code, libelle]) => h("button", { type: "button", "aria-pressed": code === famille ? "true" : "false", onclick: (e) => { famille = code; for (const b of onglets.children) b.setAttribute("aria-pressed", b === e.currentTarget ? "true" : "false"); dessiner(); } }, tr(libelle))));
  const rafraichir = () => naviguer(location.hash);

  function dessiner() {
    const p = new URLSearchParams({ famille, ...(q.value ? { q: q.value } : {}), ...(partenaire.value ? { partenaire: partenaire.value } : {}) });
    history.replaceState(null, "", `#/tarifs?${p}`);
    corps.replaceChildren();
    const lignes = etat.db.prestations
      .filter((x) => x.famille === famille && (!partenaire.value || x.partenaire_id === partenaire.value))
      .filter((x) => correspond(`${x.libelle} ${x.libelle_en} ${x.groupe} ${nomPartenaire(x.partenaire_id)} ${JSON.stringify(x.details || {})}`, q.value))
      .sort((a, b) => nomPartenaire(a.partenaire_id).localeCompare(nomPartenaire(b.partenaire_id)) || (a.groupe || "").localeCompare(b.groupe || "") || (a.ordre || 0) - (b.ordre || 0));
    if (!lignes.length) {
      corps.append(vide(tr("Aucun tarif ne correspond"), etat.db.prestations.length ? tr("Essayez une autre famille, un autre partenaire ou effacez la recherche.") : tr("Les tarifs se créent depuis la fiche d'un partenaire ou avec le bouton ci-dessus.")));
      return;
    }
    // Un bloc par partenaire puis par groupe, pour retrouver la logique des brochures.
    const parPartenaire = [...new Set(lignes.map((x) => x.partenaire_id || ""))];
    for (const pid of parPartenaire) {
      const du = lignes.filter((x) => (x.partenaire_id || "") === pid);
      const groupes = [...new Set(du.map((x) => x.groupe || nomFamille(x.famille)))];
      corps.append(
        h(
          "section",
          { class: "bloc-tarifs" },
          h("h2", null, pid ? h("a", { href: `#/partenaire/${pid}` }, nomPartenaire(pid)) : tr("Sans partenaire"), pid && (partenaireDe(pid) || {}).actif === false ? h("span", { class: "tag" }, tr("partenaire masqué")) : null),
          groupes.map((g) => h("div", { class: "groupe-tarifs" }, groupes.length > 1 || g !== nomFamille(famille) ? h("h3", null, g) : null, tableauPrestations(du.filter((x) => (x.groupe || nomFamille(x.famille)) === g), { avecPartenaire: false, apres: rafraichir })))
        )
      );
    }
    corps.append(h("p", { class: "aide" }, pluriel(lignes.length, N_("{n} tarif."), N_("{n} tarifs.")), voitNets() || modeTaxi() ? "" : tr(" Les prix nets et les marges demandent le droit « prix nets ».")));
  }
  dessiner();
  return h(
    "div",
    { "data-titre": tr("Tarifs"), "data-large": true },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Tarifs des partenaires")), h("p", { class: "sous" }, modeTaxi() ? tr("Prix de vente de toutes les courses, famille par famille.") : tr("Prix de vente, nets et marges de toutes les prestations, famille par famille."))), peut("partenaires.ecrire") ? h("button", { class: "principal", type: "button", onclick: () => ouvrirPrestation({ famille, partenaire_id: partenaire.value || null }, rafraichir) }, tr("Nouvelle prestation")) : null),
    onglets,
    h("div", { class: "barre-outils" }, h("div", { class: "champ recherche" }, h("label", { for: "rech-tarifs" }, tr("Rechercher")), q), h("div", { class: "champ" }, h("label", { for: "filtre-part" }, tr("Partenaire")), partenaire)),
    corps
  );
}
