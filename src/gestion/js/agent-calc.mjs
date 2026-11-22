// Onglet « Assistant » (agent conversationnel, 19.11.2026) : logique pure de l'écran, sans navigateur, testée par tests/gestion-agent-ecran.test.js.
//   - lecture du flux de la fonction « agent » (une ligne JSON par événement) ;
//   - le fil d'une conversation rebâti depuis les messages enregistrés (texte, horaires calculés, cartes) ;
//   - la liste des conversations, rangée comme une messagerie ;
//   - une carte « dossier » vers l'écran « Coller une demande » déjà rempli (la création reste celle de l'outil).

import { reglesReponse } from "./defauts.mjs";
import { siegesLus, siegesTotal, detailsAvecSieges, siegesAChoisir as siegesAChoisirCalc } from "./sieges-calc.mjs";

// L'agent est proposé quand l'entreprise l'a allumé (Réglages), indépendamment de l'assistant de « Coller une demande » ; l'écran vérifie en
// plus que le rôle peut lire les tarifs et écrire des dossiers.
export const agentActif = (regl) => !!(regl && regl.agent_ia === true);

// ---- Flux ------------------------------------------------------------------------------------------------------------------------

// Découpe le flux en événements : `tampon` garde la ligne pas encore finie d'un morceau à l'autre.
export function lireMorceau(tampon, morceau) {
  const lignes = (tampon + morceau).split("\n");
  const reste = lignes.pop();
  const evenements = [];
  for (const l of lignes) {
    if (!l.trim()) continue;
    try {
      evenements.push(JSON.parse(l));
    } catch {
      // ligne illisible : ignorée, le reste du flux continue
    }
  }
  return { tampon: reste, evenements };
}

// ---- Fil d'une conversation -------------------------------------------------------------------------------------------------------

// Les éléments à afficher, dans l'ordre : messages de la personne, textes de l'agent, horaires calculés (résultat de planifier_course),
// cartes. Les cartes se placent par leur date entre les messages. La réflexion et les appels d'outils ne s'affichent pas.
export function filDepuis(messages = [], cartes = []) {
  const items = [];
  const outils = new Map();
  for (const m of messages) {
    const t = Date.parse(m.cree_le) || 0;
    const blocs = Array.isArray(m.contenu) ? m.contenu : [];
    if (m.role === "assistant") {
      for (const b of blocs) {
        if (b.type === "tool_use") outils.set(b.id, b.name);
        if (b.type === "text" && b.text.trim()) items.push({ genre: "agent", texte: b.text.trim(), t });
      }
    } else {
      // Les pièces jointes d'un message (migration 55) : une bulle de vignettes avant son texte.
      const pieces = blocs.filter((b) => b.type === "fichier").map((b) => ({ id: b.id, nom: b.nom || "", media_type: b.media_type || "", taille: Number(b.taille) || 0 }));
      if (pieces.length) items.push({ genre: "pieces", fichiers: pieces, t });
      for (const b of blocs) {
        if (b.type === "text" && b.text.trim()) items.push({ genre: "personne", texte: b.text.trim(), t });
        if (b.type === "tool_result" && outils.get(b.tool_use_id) === "planifier_course" && !b.is_error) {
          try {
            const plan = JSON.parse(typeof b.content === "string" ? b.content : (b.content || []).map((c) => c.text || "").join(""));
            if (plan && plan.ok) items.push({ genre: "planning", planning: plan, t });
          } catch {
            // résultat illisible : rien à montrer
          }
        }
        // Les vouchers trouvés (trouver_vouchers, agent-vouchers.mjs) : les cartes se refont à chaque ouverture, avec les données du moment.
        if (b.type === "tool_result" && outils.get(b.tool_use_id) === "trouver_vouchers" && !b.is_error) {
          try {
            const r = JSON.parse(typeof b.content === "string" ? b.content : (b.content || []).map((c) => c.text || "").join(""));
            if (r && Array.isArray(r.reservations) && r.reservations.length) items.push({ genre: "vouchers", vouchers: r, t });
          } catch {
            // résultat illisible : rien à montrer
          }
        }
      }
    }
  }
  for (const c of cartes) items.push({ genre: "carte", carte: c, t: Date.parse(c.cree_le) || 0 });
  // Tri stable par date : à date égale, l'ordre d'arrivée.
  return items.map((x, i) => ({ ...x, i })).sort((a, b) => a.t - b.t || a.i - b.i);
}

// ---- Liste des conversations ------------------------------------------------------------------------------------------------------

// Ouvertes d'abord, les plus récentes en haut ; celles qui ont une carte en attente sont signalées.
export function listeConversations(conversations = [], { enAttente = new Map(), archives = false } = {}) {
  return conversations
    .filter((c) => (archives ? c.statut === "archivee" : c.statut !== "archivee"))
    .map((c) => ({ ...c, attente: enAttente.get(c.id) || 0 }))
    .sort((a, b) => String(b.maj_le).localeCompare(String(a.maj_le)));
}

// « 14:05 » aujourd'hui, « hier », sinon la date courte. `maintenant` : pour les tests.
export function quand(iso, { maintenant = new Date(), langue = "fr" } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const jour = (x) => new Date(x.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  if (jour(d) === jour(maintenant)) return new Date(d.getTime() + 7 * 3600000).toISOString().slice(11, 16);
  if (jour(new Date(maintenant.getTime() - 86400000)) === jour(d)) return langue === "en" ? "yesterday" : "hier";
  return d.toLocaleDateString(langue === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
}

// ---- Cartes ---------------------------------------------------------------------------------------------------------------------

// Une carte « dossier » dans la forme que lit la fiche de création (views/demande.mjs, par assistant-calc.mjs propositionVersDemande) :
// client, services avec leur ligne de la base, transfert privé hors catalogue à prix libre. Un prix tapé par la personne dans la conversation
// (origine « saisi ») devient le prix du transfert privé ; le lieu de pickup proposé devient celui du service.
// Les sièges enfant ou bébé d'un service de carte : un entier positif, sans plafond silencieux (la fonction refuse au-delà de 10, la fiche
// de création aussi).
// `sieges` : les sièges enfant ; `sieges_bebe` : les sièges bébé ; `sans_siege` : aucun siège (sieges-calc.mjs, 22.11.2026).
export const siegesCarte = (s) => Math.max(0, Math.floor(Number(s && s.sieges) || 0));
export const siegesBebeCarte = (s) => Math.max(0, Math.floor(Number(s && s.sieges_bebe) || 0));
export const siegesDeCarte = (s) => ({ enfant: siegesCarte(s), bebe: siegesBebeCarte(s), aucun: !siegesCarte(s) && !siegesBebeCarte(s) && !!(s && s.sans_siege === true) });
// Les enfants et bébés d'un service de carte : ceux du service, sinon ceux du dossier quand le service ne donne personne ; les bébés du dossier.
const petitsDe = (s, d) => (Number(s.enfants) || (Number(s.adultes) ? 0 : Number(d.enfants) || 0)) + (Number(d.bebes) || 0);
const servicesDeCarte = (carte) => {
  const d = (carte && carte.donnees) || {};
  return carte && carte.genre === "reservation" ? [d.service || {}] : carte && carte.genre === "dossier" ? d.services || [] : [];
};
// Une carte « dossier » ou « reservation » dont un service a plus de sièges que d'enfants et de bébés (relecture de la PR 315) : la carte le
// dit et ne se valide pas d'un geste ; Nani confirme avec « Vérifier avant » (le nombre d'enfants peut être inconnu).
export function siegesAVerifier(carte) {
  const d = (carte && carte.donnees) || {};
  return servicesDeCarte(carte).some((s) => {
    const n = siegesTotal(siegesDeCarte(s));
    return n > 0 && n > petitsDe(s, d);
  });
}
// Un transfert (sieges_requis, posé par la fonction) avec au moins un enfant ou un bébé, sans siège ni « aucun siège » (Jérémy, 22.11.2026) :
// la carte ne se valide pas, ni d'un geste ni par « Vérifier avant » sans que le choix soit fait dans la fiche.
export function siegesAChoisir(carte) {
  const d = (carte && carte.donnees) || {};
  return servicesDeCarte(carte).some((s) => s.sieges_requis === true && siegesAChoisirCalc({ enfants: petitsDe(s, d), sieges: siegesDeCarte(s) }));
}
// Les bagages d'un service de carte, en texte comme `details.bagages` ("" sans bagages).
const bagagesCarte = (s) => (Number(s && s.bagages) > 0 ? String(Math.floor(Number(s.bagages))) : "");
// La note interne d'un service : la nouvelle (note_interne) et l'ancienne remarque d'une carte d'avant le 22.11.2026, qui restait interne.
const noteCarte = (s) => [s && s.note_interne, s && s.remarque].filter((x) => x && String(x).trim()).join(" ");
export function propositionDepuisCarte(donnees = {}) {
  const c = donnees.client || {};
  return {
    client: { nom: c.nom || "", telephone: c.telephone || "", hotel: c.hotel || "", langue: c.langue || "", adultes: donnees.adultes || 0, enfants: donnees.enfants || 0, ages_enfants: [], bebes: donnees.bebes || 0 },
    services: (donnees.services || []).map((s) => ({
      texte: s.texte || s.libelle || "",
      date: s.date || "",
      heure: s.heure_pickup || "",
      adultes: s.adultes || 0,
      enfants: s.enfants || 0,
      // Les sièges par type lus par l'Assistant (22.11.2026) : ils suivent jusqu'à la réservation (details.sieges, sieges_bebe, sans_siege).
      sieges: siegesCarte(s),
      sieges_bebe: siegesBebeCarte(s),
      sans_siege: siegesDeCarte(s).aucun,
      sieges_requis: s.sieges_requis === true,
      // Les bagages et la remarque du voucher (22.11.2026) : sur le voucher (details.bagages, details.remarques), plus dans les notes.
      bagages: bagagesCarte(s),
      remarque_voucher: String(s.remarque_voucher || "").trim(),
      de: s.de || "",
      vers: s.vers || "",
      prive: true,
      hors_catalogue: !s.offre,
      offre: s.offre || null,
      alternatives: [],
      confiance: s.offre ? "haute" : "moyenne",
      // Le prix du client non corrigé par Nani (22.11.2026) aussi, marqué sur la carte.
      prix_libre: !s.offre && ["saisi", "client_non_corrige"].includes(s.origine_prix) && s.prix !== null && s.prix !== undefined ? Number(s.prix) : null,
      // Un service du catalogue dont le prix vient de la conversation (« saisi » ou « client_non_corrige ») garde ce prix à la validation,
      // le prix du catalogue reste affiché à côté (Jérémy, 22.11.2026). Un prix « catalogue » se recalcule comme avant.
      prix_carte: s.offre && ["saisi", "client_non_corrige"].includes(s.origine_prix) && Number(s.prix) > 0 ? Number(s.prix) : null,
      // L'origine du prix, gardée jusqu'à la réservation (details.prix_origine) : un prix du client non corrigé ne lève jamais un net.
      prix_origine: ["saisi", "client_non_corrige"].includes(s.origine_prix) ? s.origine_prix : null,
      // Le nombre de véhicules du devis calculé par Nani (devis-calc.mjs, appliquerDevis) : le dossier reprend le devis.
      vehicules: Number.isInteger(Number(s.vehicules)) && Number(s.vehicules) > 1 ? Number(s.vehicules) : null,
      lieu_pickup: s.lieu_pickup || "",
      // Le numéro de vol lu par l'agent (contrôlé par la fonction) : posé sur la réservation du transfert, modifiable dans la fenêtre.
      vol: s.vol || "",
    })),
    // Les notes du dossier : seulement ce qui est interne (note_interne, ou la remarque d'une ancienne carte).
    remarques: (donnees.services || [])
      .map(noteCarte)
      .filter(Boolean)
      .join(" ")
      .slice(0, 400),
  };
}

// Les `details` d'une réservation depuis un service de carte : rien quand rien n'est dit.
function detailsDeCarte(s) {
  const details = detailsAvecSieges(
    { ...(s.vol ? { vol: s.vol } : {}), ...(bagagesCarte(s) ? { bagages: bagagesCarte(s) } : {}), ...(String(s.remarque_voucher || "").trim() ? { remarques: String(s.remarque_voucher).trim() } : {}), ...(s.origine_prix === "client_non_corrige" ? { prix_origine: "client_non_corrige" } : {}) },
    siegesDeCarte(s),
  );
  return Object.keys(details).length ? { details } : {};
}
// La réservation à ouvrir dans le formulaire de l'outil, depuis une carte « service » (ajout à un dossier).
export function reservationDepuisCarte(donnees = {}) {
  const s = donnees.service || {};
  return {
    dossier_id: donnees.dossier_id,
    libelle: s.libelle || s.texte || "",
    date_service: s.date || "",
    heure_pickup: s.heure_pickup || "",
    lieu_pickup: s.lieu_pickup || "",
    personnes: { adultes: s.adultes || 0, enfants: s.enfants || 0 },
    montant_vente: s.prix ?? null,
    ...(s.offre && s.offre.genre === "trajet" ? { trajet_id: s.offre.id } : {}),
    ...(s.offre && s.offre.genre === "prestation" ? { prestation_id: s.offre.id } : {}),
    // L'origine d'un prix repris du client sans correction de Nani (revue de la PR 307) : relue par le contrôle (dossierPourControle).
    // Tout ce qui sert au client et au chauffeur va sur le voucher (22.11.2026) : vol, sièges par type, bagages, remarque en anglais.
    ...detailsDeCarte(s),
    notes: noteCarte(s),
  };
}

// La réservation existante avec la modification proposée, pour le formulaire de l'outil (la personne enregistre elle-même).
export function reservationModifiee(r, donnees = {}) {
  if (!r) return null;
  const v = donnees.valeur;
  const p = { ...(r.personnes || {}) };
  switch (donnees.champ) {
    case "date":
      return { ...r, date_service: v };
    case "heure_pickup":
      return { ...r, heure_pickup: v };
    case "lieu_pickup":
      return { ...r, lieu_pickup: v };
    case "adultes":
      return { ...r, personnes: { ...p, adultes: Number(v) || 0 } };
    case "enfants":
      return { ...r, personnes: { ...p, enfants: Number(v) || 0 } };
    // Les sièges enfant ou bébé : dans `details.sieges` (0 les retire), ce que le voucher et la Booking confirmation impriment.
    // Sièges bébé et « aucun siège » (22.11.2026) : un siège posé retire « aucun », « aucun » retire les sièges.
    case "sieges":
    case "sieges_bebe":
    case "sans_siege": {
      const avant = siegesLus(r.details || {});
      const n = Math.max(0, Math.floor(Number(v) || 0));
      const s = donnees.champ === "sans_siege" ? { enfant: 0, bebe: 0, aucun: v === "oui" } : { ...avant, aucun: false, ...(donnees.champ === "sieges" ? { enfant: n } : { bebe: n }) };
      return { ...r, details: detailsAvecSieges(r.details || {}, s) };
    }
    case "bagages": {
      const { bagages, ...autres } = r.details || {};
      return { ...r, details: Number(v) > 0 ? { ...autres, bagages: String(Math.floor(Number(v))) } : autres };
    }
    // La remarque du voucher, en anglais : ajoutée à `details.remarques`, que le voucher et la Booking confirmation impriment.
    case "remarque_voucher":
      return { ...r, details: { ...(r.details || {}), remarques: [(r.details || {}).remarques, String(v || "").trim()].filter(Boolean).join("\n") } };
    // Le numéro de vol : dans `details.vol`, ce que le voucher et la Booking confirmation impriment (le reste de `details` est gardé).
    case "vol":
      return { ...r, details: { ...(r.details || {}), vol: String(v || "").trim() } };
    // La note interne (et l'ancienne « remarque » d'une carte d'avant le 22.11.2026) : dans les notes, jamais imprimées.
    case "note_interne":
    case "remarque":
      return { ...r, notes: [r.notes, v].filter(Boolean).join("\n") };
    // Annulation : le formulaire habituel pose ensuite sa question (retirer de la facture, ou garder) si le service est facturé.
    case "annulation":
      return v === "annule" ? { ...r, statut: "annule" } : r;
    default:
      return r;
  }
}

// ---- Planning ---------------------------------------------------------------------------------------------------------------------

// Ce que la frise affiche pour un point : l'heure qui compte (départ au pickup, arrivée ailleurs), et la fourchette.
export function lignesFrise(plan) {
  if (!plan || !plan.ok) return [];
  return plan.etapes.map((e, i) => {
    const premier = i === 0;
    const dernier = i === plan.etapes.length - 1;
    const arrivee = e.arrivee_prevue && e.arrivee_prevue.heure;
    const auPlusTard = e.arrivee_au_plus_tard && e.arrivee_au_plus_tard.heure;
    return {
      lieu: e.lieu,
      heure: premier ? plan.pickup.heure : e.rendez_vous || arrivee || "",
      fourchette: !premier && arrivee && auPlusTard && arrivee !== auPlusTard ? [arrivee, auPlusTard] : null,
      rendezVous: !!e.rendez_vous,
      attente: e.attente_min || 0,
      depart: !premier && !dernier && e.depart ? e.depart.heure : "",
      trajet: dernier ? null : plan.trajets[i],
    };
  });
}

// Titre d'une nouvelle conversation : le début du premier message, sur une ligne (même règle que la fonction, prompt.js).
export const titreDepuis = (t) => {
  const l = String(t || "").replace(/\s+/g, " ").trim();
  return l.length > 60 ? `${l.slice(0, 57).replace(/\s+\S*$/, "")}…` : l || "Nouvelle conversation";
};

// ---- Faire évoluer l'outil (20.11.2026) ---------------------------------------------------------------------------------------------
// Carte « reglage » : l'avant affiché doit être encore la valeur en place, sinon la carte est périmée (quelqu'un l'a changée entre-temps).

const lireChemin = (o, chemin) => chemin.split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), o);
const moduleTexte = (v) => (v === true ? "oui" : v === false ? "non" : "auto");
const ENTIERS = ["conditions.delai_jours", "conditions.relance_jours", "conditions.solde_jours", "conditions.acompte_pct"];
const MODULES = ["modules.partenaires", "modules.reservations", "modules.messages", "modules.catalogue"];
const TEXTES_VOUCHER = ["voucher.merci", "voucher.merci_transfert", "voucher.note_transfert", "assistant_voix.regles_reponse"];

// Les réglages après la carte (voix, texte type, réglage), ou { erreur }. `nouvelId` : l'identifiant d'un nouveau texte type.
export function reglageApplique(reglages, d = {}, { nouvelId = "" } = {}) {
  const r = structuredClone(reglages || {});
  if (d.sujet === "voix") {
    if (!["fr", "en", "lieu"].includes(d.champ)) return { erreur: "inconnu" };
    const voix = { lieu: "", fr: "", en: "", ...(r.assistant_voix || {}) };
    if (String(voix[d.champ] || "") !== String(d.avant || "")) return { erreur: "change" };
    voix[d.champ] = d.valeur;
    return { ok: true, valeur: { ...r, assistant_voix: voix } };
  }
  if (d.sujet === "message") {
    const liste = Array.isArray(r.messages) ? r.messages : [];
    if (d.champ === "nouveau") {
      if (!d.libelle || !d.valeur || !["fr", "en", "th"].includes(d.langue)) return { erreur: "inconnu" };
      return { ok: true, valeur: { ...r, messages: [...liste, { id: nouvelId || `perso-${Date.now().toString(36)}`, pour: "client", titre: d.libelle, langue: d.langue, corps: d.valeur }] } };
    }
    if (!["corps", "titre"].includes(d.champ)) return { erreur: "inconnu" };
    const i = liste.findIndex((m) => String(m.id) === String(d.cle));
    if (i < 0) return { erreur: "introuvable" };
    if (String(liste[i][d.champ] || "") !== String(d.avant || "")) return { erreur: "change" };
    const messages = liste.map((m, j) => (j === i ? { ...m, [d.champ]: d.valeur } : m));
    return { ok: true, valeur: { ...r, messages } };
  }
  if (d.sujet === "reglage") {
    const [groupe, cle] = String(d.champ || "").split(".");
    // Les règles de réponse : leur valeur par défaut (Secret, Taxi) tant qu'elles n'ont jamais été enregistrées, comme les lit l'agent.
    const avant = d.champ === "assistant_voix.regles_reponse" ? reglesReponse(r) : lireChemin(r, d.champ);
    if (MODULES.includes(d.champ)) {
      if (moduleTexte(avant) !== d.avant) return { erreur: "change" };
      const v = { oui: true, non: false, auto: null }[d.valeur];
      if (v === undefined) return { erreur: "inconnu" };
      return { ok: true, valeur: { ...r, modules: { ...(r.modules || {}), [cle]: v } } };
    }
    if (ENTIERS.includes(d.champ) || TEXTES_VOUCHER.includes(d.champ)) {
      if (String(avant ?? "") !== String(d.avant ?? "")) return { erreur: "change" };
      const v = ENTIERS.includes(d.champ) ? Number(d.valeur) : String(d.valeur || "");
      if (ENTIERS.includes(d.champ) && !(Number.isInteger(v) && v >= 0 && v <= (cle === "acompte_pct" ? 100 : 365))) return { erreur: "inconnu" };
      return { ok: true, valeur: { ...r, [groupe]: { ...(r[groupe] || {}), [cle]: v } } };
    }
  }
  return { erreur: "inconnu" };
}

// Carte « reglage » du catalogue : le changement d'un tarif (libellé, libellé anglais, prix de vente, mis en vente), ou { erreur }.
export function prestationModifiee(p, d = {}) {
  if (!p) return { erreur: "introuvable" };
  const avant = d.champ === "actif" ? (p.actif === false ? "non" : "oui") : String(p[d.champ] ?? "");
  if (avant !== String(d.avant ?? "")) return { erreur: "change" };
  if (d.champ === "prix_vente") {
    const n = Number(d.valeur);
    return Number.isFinite(n) && n >= 0 ? { ok: true, patch: { prix_vente: n } } : { erreur: "inconnu" };
  }
  if (d.champ === "actif") return ["oui", "non"].includes(d.valeur) ? { ok: true, patch: { actif: d.valeur === "oui" } } : { erreur: "inconnu" };
  if (["libelle", "libelle_en"].includes(d.champ) && String(d.valeur || "").trim()) return { ok: true, patch: { [d.champ]: String(d.valeur).trim() } };
  return { erreur: "inconnu" };
}

// Demandes d'amélioration : en cours d'abord, puis les plus récentes.
export function listeAmeliorations(lignes = []) {
  const enCours = (l) => (["envoyee", "pr_prete", "echec"].includes(l.statut) ? 0 : 1);
  return [...(lignes || [])].sort((a, b) => enCours(a) - enCours(b) || String(b.cree_le).localeCompare(String(a.cree_le)));
}

// ---- Réponse au client : garde-fou des chiffres internes (20.11.2026) -----------------------------------------------------------------
// L'agent voit les partenaires, les nets et les commissions (décision de Jérémy). La fonction signale dans une réponse au client chaque montant
// égal à un net, une marge ou une commission, et chaque nom de partenaire (avertissements « montant_interne:1200,300 » et
// « nom_prestataire:Lazy Day », outils.js, controlerReponse). L'écran bloque la copie tant que le texte corrigé contient encore l'un d'eux.

// Chiffres de toute écriture (thaïs, pleine largeur, arabes…) ramenés en ASCII : un chiffre décimal Unicode (\p{Nd}) appartient à une
// suite de dix (0 à 9) ; sa valeur est sa place dans cette suite (revue de sécurité de la PR 306).
const CHIFFRE = /\p{Nd}/u;
export function chiffresAscii(t) {
  return String(t || "").replace(/\p{Nd}/gu, (c) => {
    const cp = c.codePointAt(0);
    if (cp >= 48 && cp <= 57) return c;
    let debut = cp;
    while (debut > 0 && cp - debut < 60 && CHIFFRE.test(String.fromCodePoint(debut - 1))) debut--;
    return String((cp - debut) % 10);
  });
}
// « 1.2k », « 1,2k », « 5k » : × 1000.
const enMilliers = (t) => t.replace(/(\d+)(?:[.,](\d{1,2}))?\s?k\b/gi, (_, e, d) => String(Math.round(Number(`${e}.${d || 0}`) * 1000)));
// Séparateurs de milliers entre des groupes de trois chiffres : toute espace (\p{Zs}, dont U+2009 et U+2007), U+200B, virgule, apostrophe
// droite ou typographique, « · », « _ », « ˙ », virgule pleine largeur ou point suivi d'exactement trois chiffres.
export const SEPARATEUR_MILLIERS = /(?:[\p{Zs}​,'’·_˙，]|[.．](?=\d{3}(?!\d)))/u;
const SEP = "(?:[\\p{Zs}\\u200B,'’·_˙，]|[.．](?=\\d{3}(?!\\d)))";
const SEP_G = /[\p{Zs}​,'’·_˙，.．]/gu;
// Deux groupes de chiffres séparés par un signe inconnu (« 1•200 ») : le montant est illisible, il se lit 0 (le contrôle se ferme).
const SIGNE_INCONNU = /(?<!\d)\d{1,3}[^\p{L}\p{N}\p{Zs}\s​,.'’·_˙，．:/\-+()%×*=~#&@$€฿!?;"«»[\]{}<>|\\^`]\d{3}(?!\d)/gu;
const MONTANT = new RegExp(`(?:฿|THB|CHF|EUR|€)?\\s*(\\d{1,3}(?:${SEP}\\d{3})+|\\d{3,})(?:\\s*(?:฿|THB|CHF|EUR|€|baht))?`, "giu");
// Montants d'un texte (« 1,200 », « 1 200 THB », « ฿900 », « ๑,๒๐๐ », « 1.2k ») ; dates, heures et téléphones exclus. Un nombre fait de
// zéros n'est pas un montant ; un montant illisible se lit 0. Même code dans outils.js et agent-calc.mjs (un test les compare).
export function montantsDuTexte(t) {
  const out = [];
  const propre = enMilliers(chiffresAscii(t))
    .replace(/\+?\d[\d\s]{7,}\d/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b(jan|feb|fev|fév|mar|apr|avr|may|mai|jun|juin|jul|juil|aug|aou|aoû|sep|oct|nov|dec|déc)[\p{L}.]*\s+20[2-3]\d\b/giu, " ")
    .replace(/\b\d{1,2}[/.]\d{1,2}[/.]20[2-3]\d\b/g, " ")
    .replace(/\b\d{1,2}[:h.]\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, " ")
    .replace(SIGNE_INCONNU, () => (out.push(0), " "));
  for (const m of propre.matchAll(MONTANT)) {
    const n = Number(m[1].replace(SEP_G, ""));
    if (n > 0) out.push(n);
  }
  return out;
}

// SHA-256 synchrone (empreinte d'un montant interne sans le droit de voir les nets, revue de la PR 306) : même code dans outils.js et
// agent-calc.mjs. Rend l'hexadécimal.
const K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
export function sha256(texte) {
  const o = Array.from(new TextEncoder().encode(String(texte)));
  const l = o.length * 8;
  o.push(0x80);
  while (o.length % 64 !== 56) o.push(0);
  for (let i = 7; i >= 0; i--) o.push(i >= 4 ? 0 : (l >>> (i * 8)) & 0xff);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < o.length; i += 64) {
    const w = [];
    for (let j = 0; j < 16; j++) w[j] = (o[i + 4 * j] << 24) | (o[i + 4 * j + 1] << 16) | (o[i + 4 * j + 2] << 8) | o[i + 4 * j + 3];
    for (let j = 16; j < 64; j++) w[j] = (w[j - 16] + (r(w[j - 15], 7) ^ r(w[j - 15], 18) ^ (w[j - 15] >>> 3)) + w[j - 7] + (r(w[j - 2], 17) ^ r(w[j - 2], 19) ^ (w[j - 2] >>> 10))) | 0;
    let [a, b, c, d, e, f, g, k] = h;
    for (let j = 0; j < 64; j++) {
      const t1 = (k + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K256[j] + w[j]) | 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + k) | 0;
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
// L'empreinte d'un montant : sha-256 du sel et du montant, 16 caractères.
export const empreinteMontant = (sel, montant) => sha256(`${sel}:${Number(montant)}`).slice(0, 16);
const plat = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
// Ce qui bloque une réponse : { montants: [nombres], noms: [textes], ferme }, lu dans les avertissements de la carte. Revue de sécurité de
// la PR 306 : « montant_illisible:0 » (un montant lu à 0) bloque tant qu'il reste ; « controle_impossible » (nets illisibles) bloque
// toujours, la réponse est à refaire.
// Sans le droit de voir les nets, « montant_interne:#sel:empreinte,… » : l'écran calcule l'empreinte des montants du texte (même sel) et
// bloque sans afficher le chiffre (MONTANT_MASQUE à la place).
export const CONTROLE_IMPOSSIBLE = "controle_impossible";
export const MONTANT_MASQUE = "montant_masque";
export function bloquantsReponse(avertissements = []) {
  const montants = new Set();
  const noms = [];
  const empreintes = [];
  let ferme = false;
  for (const a of avertissements || []) {
    const [code, valeur = ""] = String(a).split(/:(.*)/s);
    const masque = code === "montant_interne" && /^#([0-9a-f]{8,32}):([0-9a-f,]+)$/.exec(valeur);
    if (masque) empreintes.push({ sel: masque[1], liste: new Set(masque[2].split(",").filter(Boolean)) });
    else if (code === "montant_interne" || code === "montant_illisible") for (const x of valeur.split(",")) if (x.trim() && Number.isFinite(Number(x))) montants.add(Number(x));
    if (code === "nom_prestataire" && valeur.trim()) noms.push(valeur.trim());
    if (code === CONTROLE_IMPOSSIBLE) ferme = true;
  }
  return { montants: [...montants], noms, ...(ferme ? { ferme } : {}), ...(empreintes.length ? { empreintes } : {}) };
}
// Ce qui reste dans le texte (montants et noms encore présents) ; vide : la copie est permise. Contrôle fermé : CONTROLE_IMPOSSIBLE.
export function resteBloque(texte, { montants = [], noms = [], ferme = false, empreintes = [] } = {}) {
  const vus = new Set(montantsDuTexte(texte));
  const p = ` ${plat(texte)} `;
  const masques = [...vus].some((n) => empreintes.some((e) => e.liste.has(empreinteMontant(e.sel, n)))) ? [MONTANT_MASQUE] : [];
  return [...(ferme ? [CONTROLE_IMPOSSIBLE] : []), ...montants.filter((n) => vus.has(n)).map(String), ...masques, ...noms.filter((n) => plat(n).length >= 3 && p.includes(` ${plat(n)} `))];
}

// ---- Lot 2 des audits du 20.11.2026 (Assistant) ---------------------------------------------------------------------------------------
// Le titre montré d'une conversation : le nom du client dès qu'on le connaît (design n° 9). Un titre tapé par la personne (Renommer) est
// gardé ; seul un titre automatique (début du premier message coupé, anciens titres fixes de WhatsApp, « Nouvelle conversation ») cède la
// place au nom du client du dossier relié, ou à celui de la première carte « dossier ».
const TITRES_FIXES = ["Dossier depuis WhatsApp", "Mise à jour depuis WhatsApp", "Nouvelle conversation", ""];
export const titreAutomatique = (titre) => TITRES_FIXES.includes(String(titre || "").trim()) || /…$/.test(String(titre || "").trim());
export function titreConversation(conv, { client = null, carteClient = "" } = {}) {
  const titre = String((conv && conv.titre) || "").trim();
  if (!titreAutomatique(titre)) return titre;
  const nom = client ? [client.prenom, client.nom].filter(Boolean).join(" ").trim() : "";
  return nom || String(carteClient || "").trim() || titre || "Nouvelle conversation";
}
// Le nom du client donné par la première carte « dossier » d'un fil, pour renommer la conversation.
export function nomDepuisCartes(cartes = []) {
  for (const c of cartes) {
    const nom = c && c.genre === "dossier" && c.donnees && c.donnees.client && c.donnees.client.nom;
    if (nom && String(nom).trim()) return String(nom).trim().slice(0, 120);
  }
  return "";
}
// Recherche dans la liste : titre montré, aperçu et référence du dossier relié, sans accents ni casse. Tous les mots doivent y être.
export function chercherConversations(liste = [], q = "", texteDe = (c) => `${c.titre || ""} ${c.apercu || ""}`) {
  const mots = plat(q).split(/\s+/).filter(Boolean);
  if (!mots.length) return liste;
  return liste.filter((c) => {
    const t = plat(texteDe(c));
    return mots.every((m) => t.includes(m));
  });
}

// Le message de départ d'une conversation ouverte depuis WhatsApp (« Créer le dossier ») : l'échange avec le client, à montrer à gauche dans
// une bulle repliable (design n° 4), jamais comme si Nani l'avait écrit. La fonction « agent » l'écrit entre <conversation> et
// </conversation>, une ligne « [Client 20.11.2026 10:00] texte » par message. Rend null pour un message ordinaire.
// Le résumé qui ouvre la discussion qui remplace une discussion pleine (agent/discussion-pleine.js, relecture de la PR 318) : à part du
// reste du message, pour l'écran. Rend { resume, reste } ; resume vide sans bloc.
export function separerResume(texte = "") {
  const t = String(texte || "");
  const m = /^<resume_discussion>\n([\s\S]*?)\n<\/resume_discussion>\s*/.exec(t);
  return m ? { resume: m[1], reste: t.slice(m[0].length) } : { resume: "", reste: t };
}

export function echangeWhatsApp(texte = "", { depuisWhatsApp = false } = {}) {
  const t = String(texte || "");
  const debut = t.indexOf("<conversation>");
  const fin = t.indexOf("</conversation>");
  if (debut < 0 || fin < debut) {
    // Démonstration (et anciens messages) : le texte des messages du client, une ligne par message.
    if (!depuisWhatsApp) return null;
    return { messages: t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => ({ deClient: true, heure: "", texte: l })) };
  }
  const messages = [];
  for (const ligne of t.slice(debut + 14, fin).split("\n")) {
    const m = /^\[(Client|[^\]\s]+) ([0-9.]+ [0-9:]+)(?:, modifié)?\] (.*)$/.exec(ligne.trim());
    // « Apporteur » (PR D) : les messages d'un apporteur d'affaires sont ceux du contact, comme ceux d'un client.
    if (m) messages.push({ deClient: m[1] === "Client" || m[1] === "Apporteur", heure: m[2], texte: m[3] });
  }
  // « Demander à l'assistant » (PR B) : la question de la personne, entre <question> et </question> avant l'échange. Montrée comme son message.
  const tete = t.slice(0, debut);
  const q = tete.indexOf("<question>");
  const qFin = tete.indexOf("</question>");
  const question = q >= 0 && qFin > q ? tete.slice(q + 10, qFin).trim() : "";
  return question ? { messages, question } : { messages };
}

// Ce qu'une carte « dossier » validée a créé, retrouvé sans la mémoire de la visite (design n° 5) : le dossier relié à la conversation (la
// validation l'y relie), ou celui de la carte, puis son dossier lié dans l'autre entreprise (espace unifié). `dossiers` : ceux que la
// personne voit. Rend { dossier, dossiers } ou null.
// La conversation n'est reliée qu'au premier dossier créé : son dossier ne vaut que pour la première carte « dossier » validée (`cartes` :
// celles du fil), jamais pour une seconde carte d'un autre client.
export function dossiersDeLaCarte(carte, { conv = null, dossiers = [], cartes = [] } = {}) {
  if (!carte || carte.statut !== "validee" || !["dossier", "reservation", "modification"].includes(carte.genre)) return null;
  const d = carte.donnees || {};
  const premiere = cartes.find((x) => x && x.genre === "dossier" && x.statut === "validee");
  const id = d.dossier_id || (carte.genre === "dossier" && conv && (!premiere || premiere.id === carte.id) ? conv.dossier_id : null);
  const dossier = id ? dossiers.find((x) => x.id === id && !x.annule) || null : null;
  if (!dossier) return null;
  const lie = dossier.dossier_lie_id ? dossiers.find((x) => x.id === dossier.dossier_lie_id && !x.annule) || null : null;
  return { dossier, dossiers: lie ? [dossier, lie] : [dossier] };
}
