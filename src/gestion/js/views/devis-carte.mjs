// Bouton « Calculer le devis » de la carte « Nouveau dossier » de l'Assistant (22.11.2026), la même carte que Nani l'ouvre depuis l'onglet
// Assistant ou depuis une conversation WhatsApp. Le calcul est fait ici, dans le navigateur, par devis-calc.mjs : aucun appel IA, rien
// d'écrit en base, rien d'envoyé. Nani relit la réponse anglaise et la copie ; la copie est bloquée tant qu'un net ou un nom de partenaire
// reste dans le texte (resteBloque, agent-calc.mjs).
import { etat, reglages, nomPartenaire } from "../etat.mjs";
import { h, toast } from "../ui.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { formatMontant } from "../calc.mjs";
import { resteBloque } from "../agent-calc.mjs";
import { devisPossible, calculerDevis, reponseDevis, netsDuDevis, resumeDevis, appliquerDevis, remarquesDuDevis, VEHICULES_MAX, PLACES_SUGGEREES, genreVehicule } from "../devis-calc.mjs";

// Le dernier devis complet calculé sur chaque carte (id de la carte -> resumeDevis), gardé pour l'onglet (sessionStorage) : « Créer le
// dossier » et « Vérifier avant » le reprennent (donneesAvecDevis, appelé par donneesCarte dans agent.mjs). Rien n'est écrit en base.
// Le nombre de véhicules choisi d'un geste sur la carte (id -> { index du service: nombre }) est gardé de la même façon.
const CLE_DEVIS = "gestion-devis-cartes";
const CLE_CHOIX = "gestion-devis-vehicules";
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
export const donneesAvecDevis = (id, donnees) => appliquerDevis(donnees, id ? lire(CLE_DEVIS, id) : null);

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

// D'où vient le nombre de véhicules, dit discrètement sous le service.
function origineVehicules(l) {
  if (l.vehiculesOrigine === "choix") return tr("choisi par vous");
  if (l.vehiculesOrigine === "conversation") return tr("écrit dans la conversation");
  if (l.vehiculesOrigine === "suggestion") {
    const genre = genreVehicule(l.tarif);
    return l.bagages ? tr("suggestion : {n} personnes au plus par minivan, selon les bagages", { n: PLACES_SUGGEREES.minivan }) : tr("suggestion : {n} personnes au plus par {vehicule}", { n: PLACES_SUGGEREES[genre] || "", vehicule: genre === "taxi" ? tr("taxi ou voiture") : genre });
  }
  return tr("1 par défaut");
}

// `donnees` : celles de la carte (entreprises corrigées comprises). Rien si les trois éléments ne sont pas connus. `textes()` : les textes
// de Nani dans le fil (textesDeNani), lus au clic.
export function blocDevis(donnees, { id = null, textes = () => [], client = (donnees && donnees.client) || {} } = {}) {
  if (!devisPossible(donnees)) return null;
  const resultat = h("div", { class: "devis-resultat", "aria-live": "polite" });
  const bouton = h("button", { type: "button", class: "secondaire petit" }, tr("Calculer le devis"));
  const refaire = () => {
    resultat.replaceChildren(...dessiner(donnees, client, refaire, id, textes()));
    bouton.textContent = tr("Recalculer le devis");
  };
  bouton.addEventListener("click", refaire);
  return h("div", { class: "devis-carte" }, bouton, resultat);
}

// Moins un, plus un véhicule : d'un geste, le total et la réponse se refont, et le dossier reprendra ce nombre.
function reglageVehicules(l, id, refaire) {
  const changer = (n) => {
    if (n < 1 || n > VEHICULES_MAX) return;
    noter(CLE_CHOIX, id, { ...(lire(CLE_CHOIX, id) || {}), [l.index]: n });
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

function dessiner(donnees, client, refaire, id, textes) {
  const devise = reglages().devise || "THB";
  const contexte = { prestations: etat.db.prestations || [], trajets: etat.db.trajets || [], partenaires: etat.db.partenaires || [], nomPartenaire };
  const devis = calculerDevis(donnees, contexte, { activeId: etat.entiteId, textes, choix: lire(CLE_CHOIX, id) || {} });
  // Complet : le dossier reprendra ce devis. Incomplet : plus aucun devis gardé pour cette carte.
  noter(CLE_DEVIS, id, resumeDevis(devis));
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
              l.vehicules ? h("span", { class: "devis-ligne-vehicules" }, reglageVehicules(l, id, refaire), h("small", null, ` ${origineVehicules(l)}`)) : null,
              h("small", null, [l.vehicules > 1 && l.unitaire !== null ? `${l.vehicules} × ${formatMontant(l.unitaire, devise)}` : "", tr(ORIGINES[l.origine] || ORIGINES.catalogue)].filter(Boolean).join(", "))
            ),
            h("span", { class: "agent-prix" }, formatMontant(l.total, devise))
          )
        )
      )
    );
  for (const m of devis.manquants)
    out.push(
      h(
        "p",
        { class: "erreur-form", role: "alert" },
        h("strong", null, m.libelle || tr("Service")),
        " : ",
        tr(MOTIFS[m.motif] || MOTIFS.incomplet)
      )
    );
  out.push(...remarques);
  if (!devis.complet) {
    out.push(h("p", { class: "aide" }, tr("Pas de réponse préparée tant qu'un service n'a pas de prix.")));
    return out;
  }
  if (devis.lignes.length > 1) out.push(h("p", null, h("strong", null, tr("Total : {total}", { total: formatMontant(devis.total, devise) }))));
  const zone = h("textarea", { class: "agent-reponse", rows: 10, lang: "en", "aria-label": tr("Réponse au client") });
  zone.value = reponseDevis(devis, { client, devise });
  const alerte = h("p", { class: "erreur-form", role: "alert", hidden: true });
  const copier = h("button", { type: "button", class: "principal" }, tr("Copier la réponse"));
  const bloquants = { montants: netsDuDevis(devis, etat.db), noms };
  const maj = () => {
    const reste = resteBloque(zone.value, bloquants);
    copier.disabled = reste.length > 0;
    alerte.hidden = !reste.length;
    alerte.textContent = reste.length ? tr("À retirer avant de copier : {liste}. Ces chiffres et ces noms ne vont jamais au client.", { liste: reste.join(", ") }) : "";
  };
  zone.addEventListener("input", maj);
  copier.addEventListener("click", async () => {
    if (resteBloque(zone.value, bloquants).length) return maj();
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
