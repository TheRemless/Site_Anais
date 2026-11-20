// Agent de Gestion : faire évoluer l'outil sur demande (20.11.2026). Logique pure, sans dépendance (fonction « agent » et tests node).
//
// Deux niveaux :
//   - sans code : la voix de l'assistant, les textes types, le catalogue (libellé, prix de vente, actif) et quelques réglages. L'agent lit
//     l'existant (lire_reglages, chercher_catalogue) et propose une carte « reglage » que l'administratrice applique d'un clic ;
//   - avec du code : l'agent reformule la demande avec la personne, puis propose une carte « amelioration ». Validée, elle part dans la table
//     `ameliorations` et devient une issue GitHub que l'Action implémente dans une PR (fonction « ameliorations », docs/gestion/ameliorations.md).
//
// Règles tenues ici : seules les administratrices (droit reglages.ecrire ; catalogue.ecrire pour le catalogue) reçoivent une carte ; un prix
// vient d'un montant tapé par la personne ; aucune coordonnée de paiement n'est lue ; une demande de code ne part pas d'une conversation qui
// contient une pièce jointe ; son texte (public) ne cite ni client, ni prestataire, ni montant.
import { controlerTexte, texteDemande, TITRE_MAX, TEXTE_MAX } from "../ameliorations/calc.js";
import { entrepriseActive } from "./unifie.js";

const texte = (x, max = 300) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
// Un texte long (voix, message type) garde ses retours à la ligne.
const bloc = (x, max) => (typeof x === "string" ? x.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, max) : "");
const obj = (properties, description) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}) });
const S = (description) => ({ type: "string", description });

// Réglages qu'une carte peut changer, avec leur forme. Tout le reste (paiement, émetteur, numérotation, apparence, droits) passe par l'écran.
export const REGLAGES_PERMIS = {
  "conditions.delai_jours": { nom: "Délai de paiement (jours)", type: "entier", max: 365 },
  "conditions.relance_jours": { nom: "Relance d'un devis (jours)", type: "entier", max: 365 },
  "conditions.solde_jours": { nom: "Solde avant le départ (jours)", type: "entier", max: 365 },
  "conditions.acompte_pct": { nom: "Acompte (%)", type: "entier", max: 100 },
  "modules.partenaires": { nom: "Écran Partenaires", type: "module" },
  "modules.reservations": { nom: "Écran Réservations", type: "module" },
  "modules.messages": { nom: "Écran Messages", type: "module" },
  "modules.catalogue": { nom: "Écran Catalogue", type: "module" },
  "voucher.merci": { nom: "Remerciement du voucher", type: "texte", max: 600 },
  "voucher.merci_transfert": { nom: "Remerciement du voucher de transfert", type: "texte", max: 600 },
  "voucher.note_transfert": { nom: "Note du voucher de transfert", type: "texte", max: 600 },
  "assistant_voix.regles_reponse": { nom: "Règles de réponse au client", type: "texte", max: 2000 },
};

// Règles de réponse au client (20.11.2026), une par ligne, modifiables par entreprise dans Réglages ou par une carte « reglage ». Tant que
// l'entreprise ne les a jamais enregistrées, Secret et Taxi ont la règle de paiement d'avance des bateaux, demandée par Jérémy le 20.11.2026 ;
// un texte vide enregistré veut dire « aucune règle ». Même texte que defauts.mjs (REGLE_BATEAUX), vérifié par les tests.
export const CHEMIN_REGLES = "assistant_voix.regles_reponse";
export const REGLE_BATEAUX = "Trajet en ferry ou en speedboat d'un lieu à un autre (pas une excursion à la journée) : dis que la réservation n'est confirmée qu'après paiement et que le paiement se fait à l'avance, par Wise, par virement international ou en cash à notre office. Ajoute que nous envoyons les détails de paiement. Jamais de coordonnées bancaires, de lien Wise ni d'adresse de l'office : tu ne les as pas, ne les invente pas.";
export function reglesReponse(reglages) {
  const v = reglages && reglages.assistant_voix ? reglages.assistant_voix.regles_reponse : undefined;
  if (typeof v === "string") return v.trim();
  return reglages && ["excursions", "taxi"].includes(reglages.fonctionnement) ? REGLE_BATEAUX : "";
}
const valeurReglage = (r, chemin) => (chemin === CHEMIN_REGLES ? reglesReponse(r) : lire(r, chemin));
const VOIX = { fr: "Voix de l'assistant en français", en: "Voix de l'assistant en anglais", lieu: "Lieu de l'entreprise" };
const CHAMPS_CATALOGUE = { libelle: "Libellé", libelle_en: "Libellé en anglais", prix_vente: "Prix de vente", actif: "Proposé à la vente" };

const lire = (o, chemin) => chemin.split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), o);
const moduleTexte = (v) => (v === true ? "oui" : v === false ? "non" : "auto");

// ---- Définitions des outils -------------------------------------------------------------------------------------------------------

export const OUTILS_AMELIORER = [
  {
    name: "lire_reglages",
    description:
      "Lit ce qui se règle sans code dans l'outil : la voix de l'assistant, les textes types (messages), les conditions, les écrans affichés, les textes des vouchers et les règles de réponse au client. À appeler avant de proposer un réglage. Le catalogue se lit avec chercher_catalogue.",
    input_schema: obj({ sujet: { type: "string", enum: ["tout", "voix", "messages", "reglages"], description: "Ce qu'il faut lire." } }),
  },
  {
    name: "proposer_reglage",
    description:
      "Propose un changement qui se fait sans code : voix de l'assistant, texte type (nouveau ou modifié), libellé, prix de vente ou mise en vente d'un tarif du catalogue, ou un réglage de la liste rendue par lire_reglages. Affiche une carte avec l'avant et l'après, que l'administratrice applique d'un clic.",
    input_schema: obj({
      titre: S("Titre court de la carte."),
      sujet: { type: "string", enum: ["voix", "message", "catalogue", "reglage"] },
      champ: S("voix : fr, en ou lieu. message : corps ou titre. catalogue : libelle, libelle_en, prix_vente ou actif. reglage : la clé rendue par lire_reglages (« conditions.delai_jours »)."),
      cle: S("message : l'identifiant rendu par lire_reglages, ou \"\" pour un nouveau texte type. catalogue : la référence P-… rendue par chercher_catalogue. Sinon \"\"."),
      valeur: S("La nouvelle valeur entière (le texte complet d'un message ou d'une voix ; un nombre ; oui, non ou auto pour un écran ; oui ou non pour actif)."),
      libelle: S("Nouveau texte type : son titre. Sinon \"\"."),
      langue: { type: "string", enum: ["fr", "en", "th", ""], description: "Nouveau texte type : sa langue. Sinon \"\"." },
      raison: S("Pourquoi, en une phrase, d'après la personne."),
    }),
  },
  {
    name: "proposer_amelioration",
    description:
      "Propose de demander une amélioration de l'outil qui demande du code (un champ, un bouton, un écran, un calcul). Seulement quand la demande est claire et que la personne a confirmé ton résumé. Affiche une carte « Demander cette amélioration » que l'administratrice relit, corrige et envoie. Le texte sera public : rien d'un client, d'un prestataire ni aucun montant.",
    input_schema: obj({
      titre: S("Titre court de l'amélioration, comme un titre de tâche (« Champ numéro de vol dans un transfert »). 80 caractères au plus."),
      besoin: S("Ce que la personne veut et pourquoi, en une ou deux phrases, avec ses mots."),
      ecran: S("Où dans l'outil (« fiche d'une réservation, mode taxi »), ou \"\"."),
      changements: { type: "array", items: S("Un point de ce qui changera, vu par la personne."), description: "Ce qui changera, un point par ligne, tel que résumé et confirmé avec la personne." },
      portee: { type: "string", enum: ["cette_entreprise", "toutes"], description: "Pour cette entreprise seulement, ou pour toutes." },
    }),
  },
];
export const NOMS_AMELIORER = OUTILS_AMELIORER.map((o) => o.name);
export const PROPOSITIONS_AMELIORER = ["proposer_reglage", "proposer_amelioration"];

// ---- Lecture des réglages -----------------------------------------------------------------------------------------------------------

// Ce qui part chez Claude : des textes de l'entreprise et des nombres de jours, jamais une coordonnée de paiement, un émetteur ou une clé.
export function lireReglages({ sujet = "tout" } = {}, ctx = {}) {
  const r = ctx.reglages || {};
  const v = r.assistant_voix || {};
  const out = {};
  if (sujet === "tout" || sujet === "voix") out.voix = { fr: v.fr || "(voix par défaut)", en: v.en || "(voix par défaut)", lieu: v.lieu || "" };
  if (sujet === "tout" || sujet === "messages")
    out.messages = (Array.isArray(r.messages) ? r.messages : [])
      .filter((m) => m && m.pour !== "partenaire")
      .slice(0, 60)
      .map((m) => ({ id: String(m.id || ""), titre: texte(m.titre, 120), langue: m.langue || "", corps: bloc(m.corps, 1200) }));
  if (sujet === "tout" || sujet === "reglages") out.reglages = Object.fromEntries(Object.entries(REGLAGES_PERMIS).map(([k, d]) => [k, { libelle: d.nom, valeur: d.type === "module" ? moduleTexte(lire(r, k)) : (valeurReglage(r, k) ?? "") }]));
  return { resultat: { ...out, note: "Le catalogue (libellés, prix de vente, mise en vente) se lit avec chercher_catalogue ; les références P-… servent à proposer_reglage." } };
}

// ---- Cartes ---------------------------------------------------------------------------------------------------------------------------

const refuse = (erreur, conseil) => ({ erreur, ...(conseil ? { conseil } : {}) });

// Carte « reglage ». `ctx.permissions` : les droits de la personne dans l'entreprise ; `memo.tapes` : les montants qu'elle a tapés.
export async function proposerReglage(e, ctx, memo = {}) {
  const perms = ctx.permissions || [];
  const r = ctx.reglages || {};
  const base = { titre: texte(e.titre, 120), raison: texte(e.raison, 240) };
  if (e.sujet === "catalogue") {
    if (!perms.includes("catalogue.ecrire")) return refuse("reserve_admin", "Seule une personne qui peut modifier le catalogue peut changer un tarif : dis-le simplement.");
    const nom = CHAMPS_CATALOGUE[e.champ];
    if (!nom) return refuse("champ_inconnu", "Champs possibles : libelle, libelle_en, prix_vente, actif.");
    const p = /^P-([0-9a-f]{8})$/i.exec(String(e.cle || "").trim());
    const ligne = p && ((await ctx.charger("prestations")) || []).find((x) => String(x.id).replace(/-/g, "").toLowerCase().startsWith(p[1].toLowerCase()));
    if (!ligne) return refuse("tarif_introuvable", "Cherche d'abord le tarif avec chercher_catalogue et reprends sa référence P-….");
    // Espace unifié : le catalogue chargé couvre les deux entreprises, mais catalogue.ecrire n'est vérifié que dans l'entreprise active.
    // Un tarif de l'autre entreprise se change depuis une conversation de celle-ci.
    const active = entrepriseActive(ctx);
    if (active && ligne.entite_id !== active.id) return refuse("autre_entreprise", "Ce tarif est dans l'autre entreprise : dis à la personne de le changer depuis une conversation de cette entreprise.");
    let valeur = texte(e.valeur, 160);
    if (e.champ === "prix_vente") {
      const n = Number(valeur.replace(/[\s,']/g, ""));
      if (!Number.isFinite(n) || n < 0) return refuse("valeur_invalide");
      if (!(memo.tapes || new Set()).has(n)) return refuse("prix_non_tape", "Un nouveau prix vient seulement d'un montant tapé par la personne : demande-le-lui.");
      valeur = String(n);
    } else if (e.champ === "actif") {
      if (!["oui", "non"].includes(valeur)) return refuse("valeur_invalide", "actif : oui ou non.");
    } else if (!valeur) return refuse("valeur_invalide");
    const avant = e.champ === "actif" ? (ligne.actif === false ? "non" : "oui") : String(ligne[e.champ] ?? "");
    if (avant === valeur) return refuse("rien_ne_change");
    return { genre: "reglage", ...base, donnees: { sujet: "catalogue", champ: e.champ, cible_id: ligne.id, nom: `${nom} de « ${texte(ligne.libelle, 80)} »`, avant, valeur, raison: base.raison } };
  }
  if (!perms.includes("reglages.ecrire")) return refuse("reserve_admin", "Seule une administratrice peut changer les réglages : dis-le simplement.");
  if (e.sujet === "voix") {
    if (!VOIX[e.champ]) return refuse("champ_inconnu", "Champs possibles : fr, en, lieu.");
    const valeur = e.champ === "lieu" ? texte(e.valeur, 120) : bloc(e.valeur, 3000);
    if (!valeur) return refuse("valeur_invalide");
    const avant = String((r.assistant_voix || {})[e.champ] || "");
    if (avant === valeur) return refuse("rien_ne_change");
    return { genre: "reglage", ...base, donnees: { sujet: "voix", champ: e.champ, nom: VOIX[e.champ], avant, valeur, raison: base.raison } };
  }
  if (e.sujet === "message") {
    const messages = Array.isArray(r.messages) ? r.messages : [];
    const cle = texte(e.cle, 80);
    if (!cle) {
      // Nouveau texte type, pour le client. Secret écrit à ses clients en anglais seulement.
      const libelle = texte(e.libelle, 80);
      const corps = bloc(e.valeur, 4000);
      if (!libelle || !corps) return refuse("valeur_invalide", "Un nouveau texte type a un titre (libelle) et un texte (valeur).");
      if (!["fr", "en", "th"].includes(e.langue)) return refuse("langue_manquante");
      if (r.fonctionnement === "excursions" && e.langue === "fr") return refuse("anglais_seulement", "Cette entreprise écrit à ses clients en anglais seulement.");
      return { genre: "reglage", ...base, donnees: { sujet: "message", champ: "nouveau", nom: `Nouveau texte type « ${libelle} »`, avant: "", valeur: corps, libelle, langue: e.langue, raison: base.raison } };
    }
    const m = messages.find((x) => String(x.id) === cle);
    if (!m) return refuse("message_introuvable", "Lis les textes types avec lire_reglages et reprends l'identifiant.");
    if (!["corps", "titre"].includes(e.champ)) return refuse("champ_inconnu", "Champs possibles : corps, titre.");
    const valeur = e.champ === "titre" ? texte(e.valeur, 80) : bloc(e.valeur, 4000);
    const avant = String(m[e.champ] || "");
    if (!valeur) return refuse("valeur_invalide");
    if (avant === valeur) return refuse("rien_ne_change");
    return { genre: "reglage", ...base, donnees: { sujet: "message", champ: e.champ, cle, nom: `${e.champ === "titre" ? "Titre" : "Texte"} du message « ${texte(m.titre, 80)} »`, avant, valeur, raison: base.raison } };
  }
  if (e.sujet === "reglage") {
    const d = REGLAGES_PERMIS[e.champ];
    if (!d) return refuse("champ_inconnu", "Ce réglage ne se change pas par une carte : propose plutôt une amélioration, ou indique l'écran Réglages.");
    let valeur = d.type === "texte" ? bloc(e.valeur, d.max) : texte(e.valeur, 20).toLowerCase();
    if (d.type === "entier") {
      if (!/^\d{1,3}$/.test(valeur) || Number(valeur) > d.max) return refuse("valeur_invalide", `Un nombre entier de 0 à ${d.max}.`);
      valeur = String(Number(valeur));
    }
    if (d.type === "module" && !["oui", "non", "auto"].includes(valeur)) return refuse("valeur_invalide", "oui, non ou auto.");
    if (!valeur && d.type === "texte" && e.champ !== CHEMIN_REGLES) return refuse("valeur_invalide");
    const brut = valeurReglage(r, e.champ);
    const avant = d.type === "module" ? moduleTexte(brut) : String(brut ?? "");
    if (avant === valeur) return refuse("rien_ne_change");
    return { genre: "reglage", ...base, donnees: { sujet: "reglage", champ: e.champ, nom: d.nom, avant, valeur, raison: base.raison } };
  }
  return refuse("sujet_inconnu");
}

// Une pièce jointe (photo, PDF) dans la conversation : la demande d'amélioration ne part pas d'ici (elle ne doit venir que des mots de
// la personne, jamais d'un document).
export function aUnePieceJointe(messages = []) {
  // « fichier » : la forme gardée en base (fichiers.js) ; image et document : la forme envoyée à Claude.
  return (messages || []).some((m) => m && m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b && ["image", "document", "fichier"].includes(b.type)));
}

// Les noms de clients que les outils ont rendus dans la conversation (chercher_clients, lire_dossier) : ils ne doivent pas partir dans une issue.
export function nomsVus(messages = []) {
  const noms = new Set();
  const parcourir = (v) => {
    if (Array.isArray(v)) return v.forEach(parcourir);
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (["prenom", "nom", "client", "client_nom"].includes(k) && typeof x === "string") for (const mot of x.split(/\s+/)) if (mot.length > 2) noms.add(mot);
      if (k === "nom_complet" && typeof x === "string") noms.add(x);
      else if (x && typeof x === "object") parcourir(x);
    }
  };
  for (const m of messages || []) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== "tool_result") continue;
      const contenus = Array.isArray(b.content) ? b.content.filter((c) => c.type === "text").map((c) => c.text) : [String(b.content || "")];
      for (const t of contenus) {
        try {
          parcourir(JSON.parse(t));
        } catch {
          /* résultat non JSON */
        }
      }
    }
  }
  return [...noms];
}

// Carte « amelioration ». ctx.permissions, ctx.historique (messages de la conversation), ctx.entreprise, ctx.reglages, ctx.charger.
export async function proposerAmelioration(e, ctx) {
  if (!(ctx.permissions || []).includes("reglages.ecrire")) return refuse("reserve_admin", "Seule une administratrice peut demander une amélioration de l'outil : dis-le simplement, elle peut en parler à son administratrice.");
  if ((ctx.fichiers || []).length || aUnePieceJointe(ctx.historique)) return refuse("piece_jointe", "Cette conversation contient une pièce jointe : propose d'ouvrir une nouvelle conversation et d'y décrire l'amélioration avec ses mots.");
  const titre = texte(e.titre, TITRE_MAX);
  const changements = (Array.isArray(e.changements) ? e.changements : []).map((c) => texte(c, 300)).filter(Boolean);
  if (!titre || !texte(e.besoin, 600) || !changements.length) return refuse("demande_incomplete", "Il faut un titre, le besoin et au moins un point de ce qui changera, confirmés avec la personne.");
  const r = ctx.reglages || {};
  const corps = texteDemande({ besoin: e.besoin, ecran: e.ecran, changements, portee: e.portee, entreprise: ctx.entreprise || "", fonctionnement: r.fonctionnement || "sur_mesure" });
  if (corps.length > TEXTE_MAX) return refuse("texte_trop_long", "Résume en moins de points.");
  const prestataires = ((await ctx.charger("partenaires")) || []).map((p) => String(p.nom || "").trim()).filter((n) => n.length > 2);
  const c = controlerTexte(`${titre}\n${corps}`, { noms: [...prestataires, ...nomsVus(ctx.historique)] });
  if (!c.ok)
    return refuse("texte_refuse", `Le texte sera public sur GitHub : retire ce qui pose problème (${c.erreurs.join(", ")}). Décris l'outil, jamais un client, un prestataire, un montant, un numéro ou un lien.`);
  // Les noms de clients vus dans la conversation restent dans la carte (base privée, RLS) : la fonction « ameliorations » les refuse encore
  // dans le texte que la personne a pu corriger avant l'envoi.
  return { genre: "amelioration", titre, donnees: { titre, texte: corps, portee: e.portee === "toutes" ? "toutes" : "cette_entreprise", noms_proteges: nomsVus(ctx.historique).slice(0, 200) }, avertissements: c.avertissements };
}
