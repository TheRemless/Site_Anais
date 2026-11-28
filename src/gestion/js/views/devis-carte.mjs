// Bouton « Calculer le devis » de la carte « Nouveau dossier » de l'Assistant (22.11.2026), la même carte que Nani l'ouvre depuis l'onglet
// Assistant ou depuis une conversation WhatsApp. Secret et Taxi seulement (pas ZTP). Le calcul est fait ici, dans le navigateur, par
// devis-calc.mjs : aucun appel IA, rien d'écrit en base, rien d'envoyé. Nani relit la réponse anglaise et la copie ; la copie est bloquée
// tant qu'un net ou un nom de partenaire reste dans le texte (resteBloque, agent-calc.mjs), qu'une part du prix n'est pas chiffrée ou qu'un
// prix accepté descend sous le net.
import { etat, reglages, nomPartenaire, modeTaxi, modeExcursions } from "../etat.mjs";
import { h, toast } from "../ui.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { formatMontant } from "../calc.mjs";
import { resteBloque } from "../agent-calc.mjs";
import { devisPossible, calculerDevis, reponseDevis, netsDuDevis, resumeDevis, appliquerDevis, remarquesDuDevis, VEHICULES_MAX, PLACES_SUGGEREES, genreVehicule } from "../devis-calc.mjs";

// Le dernier devis complet calculé sur chaque carte (id de la carte -> resumeDevis), gardé pour l'onglet (sessionStorage) : « Créer le
// dossier » et « Vérifier avant » le reprennent (donneesAvecDevis, appelé par donneesCarte dans agent.mjs) tant que l'échange n'a pas de
// nouveau message (marque), et que la date et les personnes du service n'ont pas changé. Rien n'est écrit en base.
// Les choix faits d'un geste sur la carte (id -> { v: { index: véhicules }, c: { index: prix d'une part manquante } }) sont gardés de même.
const CLE_DEVIS = "gestion-devis-cartes";
const CLE_CHOIX = "gestion-devis-choix";
const memoire = { [CLE_DEVIS]: new Map(), [CLE_CHOIX]: new Map() };
function lire(cle, id) {
  if (memoire[cle].has(id)) return memoire[cle].get(id);
  try {
    const tout = JSON.parse(sessionStorage.getItem(cle) || "{}");
    return tout && tout[id] ? tout[id] : null;
  } catch {
    return null;
  }
}
function noter(cle, id, valeur) {
  if (!id) return;
  memoire[cle].set(id, valeur);
  try {
    const tout = JSON.parse(sessionStorage.getItem(cle) || "{}") || {};
    if (valeur) tout[id] = valeur;
    else delete tout[id];
    sessionStorage.setItem(cle, JSON.stringify(tout));
  } catch {
    // Stockage refusé : la valeur reste en mémoire pour cette page.
  }
}
const choixDe = (id) => lire(CLE_CHOIX, id) || { v: {}, c: {} };
export const donneesAvecDevis = (id, donnees, { marque = "" } = {}) => appliquerDevis(donnees, id ? lire(CLE_DEVIS, id) : null, { marque });

// Pourquoi un service n'a pas été calculé, dit à Nani (écran interne).
const MOTIFS = {
  incomplet: N_("Il manque le trajet, les personnes ou la date."),
  hors_catalogue: N_("Ce trajet n'est pas au catalogue : aucun calcul. Fixez le prix vous-même ou ajoutez le trajet au catalogue."),
  introuvable: N_("Ce tarif n'est plus au catalogue, ou il est masqué : aucun calcul."),
  autre_entreprise: N_("Ce service est d'une autre entreprise : calculez-le depuis son Assistant."),
  sans_prix: N_("Le tarif n'a pas de prix de vente au catalogue : aucun calcul."),
  sur_place: N_("Ce service se paie sur place : aucun prix à annoncer."),
};
const ORIGINES = { catalogue: N_("catalogue"), saisi: N_("donné par vous"), client_non_corrige: N_("prix du client, non corrigé par Nani") };
// Ce que le catalogue ne chiffre pas : la question posée à Nani, le prix saisi étant par unité (enfant ou personne en plus).
const A_COMPLETER = {
  sans_tarif_enfant: N_("Le trajet n'a pas de prix enfant : les {n} enfants ne sont pas comptés."),
  enfant_non_compte: N_("Le tarif n'a pas de prix enfant : les {n} enfants ne sont pas comptés."),
  supplement_a_definir: N_("Le prix de la personne en plus n'est pas au catalogue : {n} personnes ne sont pas comptées."),
};
const UNITE_COMPLEMENT = { sans_tarif_enfant: N_("Prix par enfant"), enfant_non_compte: N_("Prix par enfant"), supplement_a_definir: N_("Prix par personne en plus") };

// D'où vient le nombre de véhicules, dit discrètement sous le service.
// `auteur` : qui a écrit le nombre dans la conversation (migration 133) : { moi } ou { prenom } ; inconnu, le libellé d'avant.
function origineVehicules(l, auteur = null) {
  if (l.vehiculesOrigine === "choix") return tr("choisi par vous");
  if (l.vehiculesOrigine === "conversation" && auteur && auteur.moi) return tr("écrit par vous dans la conversation");
  if (l.vehiculesOrigine === "conversation" && auteur && auteur.prenom) return tr("écrit par {prenom} dans la conversation", { prenom: auteur.prenom });
  if (l.vehiculesOrigine === "conversation") return tr("écrit par Nani dans la conversation");
  if (l.vehiculesOrigine === "suggestion") return l.bagages ? tr("suggestion : {n} personnes au plus par minivan, selon les bagages", { n: PLACES_SUGGEREES.minivan }) : tr("suggestion : {n} personnes au plus par voiture", { n: PLACES_SUGGEREES[genreVehicule(l.tarif)] || "" });
  return tr("1 par défaut : à vous de choisir");
}

// La carte du dossier, Secret ou Taxi. `donnees` : celles de la carte (entreprises corrigées comprises). Rien si les trois éléments ne sont
// pas connus. `textes()` : les textes de Nani dans l'échange en cours (textesDeNani), lus au clic. `marque()` : la marque de l'échange.
// `auteur()` : qui a écrit ces textes ({ moi } ou { prenom }, null si inconnu), lu au clic (migration 133).
export function blocDevis(donnees, { id = null, textes = () => [], marque = () => "", auteur = () => null, client = (donnees && donnees.client) || {} } = {}) {
  if (!(modeTaxi() || modeExcursions()) || !devisPossible(donnees)) return null;
  const resultat = h("div", { class: "devis-resultat", "aria-live": "polite" });
  const bouton = h("button", { type: "button", class: "secondaire petit" }, tr("Calculer le devis"));
  const refaire = () => {
    resultat.replaceChildren(...dessiner(donnees, client, refaire, id, textes(), marque(), auteur()));
    bouton.textContent = tr("Recalculer le devis");
  };
  bouton.addEventListener("click", refaire);
  return h("div", { class: "devis-carte" }, bouton, resultat);
}

// Moins un, plus un véhicule : d'un geste, le total et la réponse se refont, et le dossier reprendra ce nombre.
function reglageVehicules(l, id, refaire) {
  const changer = (n) => {
    if (n < 1 || n > VEHICULES_MAX) return;
    const c = choixDe(id);
    noter(CLE_CHOIX, id, { ...c, v: { ...(c.v || {}), [l.index]: n } });
    refaire();
  };
  return h(
    "span",
    { class: "devis-vehicules" },
    h("button", { type: "button", class: "secondaire petit", "aria-label": tr("Un véhicule de moins"), disabled: l.vehicules <= 1, onclick: () => changer(l.vehicules - 1) }, "−"),
    " ",
    pluriel(l.vehicules, N_("{n} véhicule"), N_("{n} véhicules")),
    " ",
    h("button", { type: "button", class: "secondaire petit", "aria-label": tr("Un véhicule de plus"), disabled: l.vehicules >= VEHICULES_MAX, onclick: () => changer(l.vehicules + 1) }, "+")
  );
}

// Une part sans prix (enfants, personne en plus) : alerte, prix par unité à saisir ou « Gratuit ». La copie reste fermée jusque-là.
function blocACompleter(l, id, refaire, devise) {
  const champ = h("input", { type: "number", min: "0", step: "any", inputmode: "decimal", class: "devis-complement", "aria-label": tr(UNITE_COMPLEMENT[l.aCompleter.motif]), placeholder: tr("{unite} ({devise})", { unite: tr(UNITE_COMPLEMENT[l.aCompleter.motif]), devise }) });
  const poser = (v) => {
    const c = choixDe(id);
    noter(CLE_CHOIX, id, { ...c, c: { ...(c.c || {}), [l.index]: v } });
    refaire();
  };
  return h(
    "div",
    { class: "erreur-form devis-a-completer", role: "alert" },
    h("p", null, h("strong", null, l.libelle), " : ", tr(A_COMPLETER[l.aCompleter.motif], { n: l.aCompleter.qte })),
    h("span", null, champ, " ", h("button", { type: "button", class: "secondaire petit", onclick: () => champ.value.trim() !== "" && Number(champ.value) >= 0 && poser(Number(champ.value)) }, tr("Ajouter au prix")), " ", h("button", { type: "button", class: "secondaire petit", onclick: () => poser(0) }, tr("Gratuit")))
  );
}

function dessiner(donnees, client, refaire, id, textes, marque, auteur = null) {
  const devise = reglages().devise || "THB";
  const contexte = { prestations: etat.db.prestations || [], trajets: etat.db.trajets || [], partenaires: etat.db.partenaires || [], nomPartenaire };
  const choix = choixDe(id);
  const devis = calculerDevis(donnees, contexte, { activeId: etat.entiteId, textes, choix: choix.v || {}, complements: choix.c || {}, nets: { prestations_nets: etat.db.prestations_nets || [] }, taxi: modeTaxi() });
  // Complet et non bloqué : le dossier reprendra ce devis, tant que l'échange n'a pas de nouveau message. Sinon, plus aucun devis gardé.
  noter(CLE_DEVIS, id, resumeDevis(devis, { marque }));
  // Les partenaires de toutes les entreprises chargées (espace unifié Secret et Taxi), pas seulement de l'entreprise active.
  const noms = ((etat.brut && etat.brut.partenaires) || etat.db.partenaires || []).map((p) => p.nom).filter(Boolean);
  const tousNets = [...(etat.db.prestations_nets || []).flatMap((n) => [n.net, n.net_enfant]), ...(etat.db.trajets_nets || []).flatMap((n) => [n.net_adulte, n.net_enfant])].filter((v) => v !== null && v !== undefined && Number(v) > 0).map(Number);
  // La remarque de chaque tarif du devis, à vérifier par Nani (jamais dans la réponse au client).
  const remarques = remarquesDuDevis(devis, { nets: tousNets, noms }).map((r) => h("p", { class: "bandeau-info devis-remarque", role: "note" }, h("strong", null, r.libelle), " : ", r.texte === null ? tr("Remarque du tarif à vérifier dans le catalogue") : tr("Remarque du tarif à vérifier : {remarque}", { remarque: r.texte })));
  const out = [];
  if (devis.lignes.length)
    out.push(
      h(
        "ul",
        { class: "agent-services" },
        devis.lignes.map((l) =>
          h(
            "li",
            null,
            h(
              "span",
              null,
              h("strong", null, l.libelle),
              l.vehicules ? h("span", { class: "devis-ligne-vehicules" }, reglageVehicules(l, id, refaire), h("small", null, ` ${origineVehicules(l, auteur)}`)) : null,
              // Un prix accepté vaut pour tout le service : le nombre de véhicules ne le change pas (il compte pour le dossier et le plancher net).
              l.prixAccepte && l.vehicules ? h("small", { class: "devis-prix-accepte" }, tr("Le prix accepté vaut pour tout le service, quel que soit le nombre de véhicules.")) : null,
              h("small", null, [l.vehicules > 1 && l.unitaire !== null ? `${l.vehicules} × ${formatMontant(l.unitaire, devise)}` : "", l.complement ? (l.complement.prix > 0 ? tr("{n} × {prix} ajoutés", { n: l.complement.qte, prix: formatMontant(l.complement.prix, devise) }) : tr("{n} offerts", { n: l.complement.qte })) : "", tr(ORIGINES[l.origine] || ORIGINES.catalogue)].filter(Boolean).join(", "))
            ),
            h("span", { class: "agent-prix" }, formatMontant(l.total, devise))
          )
        )
      )
    );
  for (const l of devis.lignes) if (l.aCompleter) out.push(blocACompleter(l, id, refaire, devise));
  for (const l of devis.lignes) if (l.sousNet) out.push(h("p", { class: "erreur-form devis-sous-net", role: "alert" }, h("strong", null, l.libelle), " : ", tr("Le prix accepté ne couvre pas le net de tous les véhicules : revoyez le prix ou le nombre de véhicules avant d'envoyer.")));
  for (const m of devis.manquants) out.push(h("p", { class: "erreur-form", role: "alert" }, h("strong", null, m.libelle || tr("Service")), " : ", tr(MOTIFS[m.motif] || MOTIFS.incomplet)));
  out.push(...remarques);
  if (!devis.complet) {
    out.push(h("p", { class: "aide" }, tr("Pas de réponse préparée tant qu'un service n'a pas de prix.")));
    return out;
  }
  if (devis.lignes.length > 1) out.push(h("p", null, h("strong", null, tr("Total : {total}", { total: formatMontant(devis.total, devise) }))));
  // Réponse toujours en anglais : Secret et Taxi n'écrivent au client qu'en anglais.
  const zone = h("textarea", { class: "agent-reponse", rows: 10, lang: "en", "aria-label": tr("Réponse au client") });
  zone.value = reponseDevis(devis, { client, devise });
  const alerte = h("p", { class: "erreur-form", role: "alert", hidden: true });
  const copier = h("button", { type: "button", class: "principal" }, tr("Copier la réponse"));
  const bloquants = { montants: netsDuDevis(devis, etat.db), noms };
  const maj = () => {
    const reste = resteBloque(zone.value, bloquants);
    copier.disabled = devis.bloque || reste.length > 0;
    alerte.hidden = !devis.bloque && !reste.length;
    alerte.textContent = devis.bloque ? tr("Complétez le prix ci-dessus avant de copier la réponse.") : reste.length ? tr("À retirer avant de copier : {liste}. Ces chiffres et ces noms ne vont jamais au client.", { liste: reste.join(", ") }) : "";
  };
  zone.addEventListener("input", maj);
  copier.addEventListener("click", async () => {
    if (devis.bloque || resteBloque(zone.value, bloquants).length) return maj();
    try {
      await navigator.clipboard.writeText(zone.value);
      toast(tr("Réponse copiée : collez-la dans WhatsApp."));
    } catch {
      toast(tr("Copie impossible : sélectionnez le texte et copiez-le."), true);
    }
  });
  maj();
  out.push(zone, alerte, h("p", { class: "aide" }, tr("Relisez avant d'envoyer : rien ne part sans vous.")), h("div", { class: "actions gauche" }, copier));
  return out;
}
