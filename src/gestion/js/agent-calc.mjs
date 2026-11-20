// Onglet « Assistant » (agent conversationnel, 19.11.2026) : logique pure de l'écran, sans navigateur, testée par tests/gestion-agent-ecran.test.js.
//   - lecture du flux de la fonction « agent » (une ligne JSON par événement) ;
//   - le fil d'une conversation rebâti depuis les messages enregistrés (texte, horaires calculés, cartes) ;
//   - la liste des conversations, rangée comme une messagerie ;
//   - une carte « dossier » vers l'écran « Coller une demande » déjà rempli (la création reste celle de l'outil).

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

// Une carte « dossier » dans la forme que lit « Coller une demande » (celle de la lecture par l'assistant, assistant-calc.mjs,
// propositionVersDemande) : client, services avec leur ligne de la base, transfert privé hors catalogue à prix libre.
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
      de: s.de || "",
      vers: s.vers || "",
      prive: true,
      hors_catalogue: !s.offre,
      offre: s.offre || null,
      alternatives: [],
      confiance: s.offre ? "haute" : "moyenne",
    })),
    remarques: (donnees.services || [])
      .map((s) => s.remarque)
      .filter(Boolean)
      .join(" ")
      .slice(0, 400),
  };
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
    notes: s.remarque || "",
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
    case "remarque":
      return { ...r, notes: [r.notes, v].filter(Boolean).join("\n") };
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
