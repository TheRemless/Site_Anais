// Espace unifié Secret et Taxi (migration 63) : « Fiches en double Secret et Taxi ». Les paires qui se ressemblent (même téléphone, ou même
// prénom et nom) viennent de doublons_clients_partages() ; rien n'est fusionné seul. Chaque paire se fusionne d'un bouton, avec le choix de
// la fiche gardée et une confirmation, par la fusion existante (fusionner_clients). Entre deux entreprises, la base réserve la fusion à
// l'administration : le bouton n'est montré qu'à qui peut.
import { etat, entitesAccessibles, permissionsDe, voitToutDans, estSuperAdmin, recharger, nomClient, corbeilleDossiers } from "../etat.mjs";
import { h, toast, modal, confirmer } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { voitDoublons, peutFusionnerEntreprises, LIBELLES_MARQUES } from "../espace-unifie-calc.mjs";
import { fusionClients } from "../dossier-gestes-calc.mjs";

export const doublonsVisibles = () => !!etat.brut && voitDoublons(entitesAccessibles(), permissionsDe, voitToutDans);

function ouvrirFusion(paire, apres) {
  const fiche = (id) => (etat.brut.clients || []).find((c) => c.id === id) || null;
  const a = fiche(paire.fiche_a);
  const b = fiche(paire.fiche_b);
  if (!a || !b) return toast(tr("Une des deux fiches n'est plus lisible : rechargez la page."), true);
  let garder = a.id;
  const choix = (c, marque) => {
    const id = `doublon-garder-${c.id}`;
    return h("label", { class: "case", for: id }, h("input", { type: "radio", name: "doublon-garder", id, checked: c.id === garder, onchange: () => (garder = c.id) }), h("span", null, h("strong", null, nomClient(c)), ` · ${LIBELLES_MARQUES[marque] || marque}`, c.telephone ? ` · ${c.telephone}` : ""));
  };
  let fermer;
  const fusionner = async (bouton) => {
    const garde = garder === a.id ? a : b;
    const absorbe = garder === a.id ? b : a;
    if (!(await confirmer(tr("Fusionner « {absorbe} » dans « {garde} » ? Les dossiers des deux entreprises passent sur la fiche gardée, l'autre fiche disparaît. Cette fusion ne se défait pas.", { absorbe: nomClient(absorbe), garde: nomClient(garde) }), tr("Fusionner"), true))) return;
    bouton.disabled = true;
    try {
      const enCorbeille = (await corbeilleDossiers().catch(() => [])).filter((x) => x.ligne && x.ligne.client_id === absorbe.id);
      if (enCorbeille.length) {
        bouton.disabled = false;
        return toast(tr("L'autre fiche a un dossier dans la corbeille ({refs}) : restaurez-le (Réglages, corbeille) avant la fusion.", { refs: enCorbeille.map((x) => x.ligne.ref).join(", ") }), true);
      }
      await etat.store.fusionnerClients({ garder: garde.id, absorbe: absorbe.id, patch: fusionClients(garde, absorbe) });
      await recharger();
      fermer();
      toast(tr("Fiches fusionnées : {nom} garde tous les dossiers.", { nom: nomClient(garde) }));
      apres();
    } catch (err) {
      bouton.disabled = false;
      toast(tr("Fusion impossible : {message}", { message: err.message }), true);
    }
  };
  fermer = modal(
    tr("Fusionner deux fiches"),
    h(
      "div",
      { class: "modal-corps" },
      h("p", { class: "aide" }, tr("Choisissez la fiche gardée. Le téléphone et l'e-mail de l'autre, s'ils diffèrent, sont gardés dans les notes.")),
      h("fieldset", null, h("legend", null, tr("Fiche gardée")), choix(a, paire.entreprise_a), choix(b, paire.entreprise_b)),
      h("div", { class: "barre-modal" }, h("button", { class: "principal", type: "button", onclick: (e) => fusionner(e.currentTarget) }, tr("Fusionner")))
    ),
    { protege: false }
  );
}

// La section, chargée à l'ouverture. null si la personne ne lit pas les clients des deux entreprises.
export function sectionDoublons() {
  if (!doublonsVisibles()) return null;
  const unifiees = entitesAccessibles().filter((e) => ["secret", "excursions", "taxi"].includes(e.slug));
  const fusion = peutFusionnerEntreprises({ superAdmin: estSuperAdmin(), a: permissionsDe((unifiees[0] || {}).id), b: permissionsDe((unifiees[1] || {}).id) });
  const liste = h("div", { class: "doublons-liste", "aria-live": "polite" }, h("p", { class: "aide" }, tr("Chargement…")));
  const charger = async () => {
    let paires = null;
    try {
      paires = etat.store.doublonsClients ? await etat.store.doublonsClients() : null;
    } catch (err) {
      return liste.replaceChildren(h("p", { class: "erreur-form" }, tr("Liste illisible : {message}", { message: err.message })));
    }
    if (paires === null) return liste.replaceChildren(h("p", { class: "aide" }, tr("La base n'a pas encore les fiches partagées Secret et Taxi (migration 63 à appliquer).")));
    if (!paires.length) return liste.replaceChildren(h("p", { class: "aide" }, tr("Aucune fiche en double.")));
    // replaceChildren écrirait « null » : le texte d'aide n'est ajouté que s'il y a lieu.
    liste.replaceChildren(
      h(
        "ul",
        { class: "doublons" },
        paires.map((p) =>
          h(
            "li",
            null,
            h("span", { class: "doublons-paire" }, h("strong", null, p.nom_a), h("span", { class: "tag" }, LIBELLES_MARQUES[p.entreprise_a] || p.entreprise_a), h("span", { "aria-hidden": "true" }, " / "), h("strong", null, p.nom_b), h("span", { class: "tag" }, LIBELLES_MARQUES[p.entreprise_b] || p.entreprise_b)),
            h("span", { class: "doublons-raison" }, p.raison === "téléphone" ? tr("même téléphone") : tr("même nom")),
            fusion ? h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrirFusion(p, charger) }, tr("Fusionner")) : null
          )
        )
      ),
      ...(fusion ? [] : [h("p", { class: "aide" }, tr("Seule l'administration fusionne deux fiches d'entreprises différentes."))])
    );
  };
  charger();
  return h("fieldset", { "data-pas-saisie": "" }, h("legend", null, tr("Fiches en double Secret et Taxi")), h("p", { class: "aide" }, tr("Même téléphone ou même nom dans Secret et dans Taxi. Rien n'est fusionné sans vous.")), liste);
}
