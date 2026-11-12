// Assistant IA, côté outil : la logique pure (sans écran) qui transforme ce que la fonction « assistant » renvoie en demande à vérifier,
// et qui prépare les faits envoyés pour rédiger une réponse. Les prix viennent toujours de la base chargée dans l'outil, avec les mêmes
// calculs que la lecture par règles (demande-calc.mjs) : Claude choisit une ligne du catalogue, il ne donne jamais un prix.
import { prixPrestation, prixTrajet, completerEnfant, completerSupplement, separerNom, lireMessage, offresPour } from "./demande-calc.mjs";
import { libelleClient, libelleUnite } from "./partenaires-calc.mjs";
import { horairesTexte, dureeTexte, fraisDeParc } from "./operations-calc.mjs";

// L'assistant est éteint tant que l'entreprise ne l'a pas allumé dans Réglages (case « Assistant IA »).
export const assistantActif = (regl) => !!(regl && regl.assistant_ia === true);

const paxDe = (s) => ({ adultes: s.adultes || (s.enfants ? 0 : 1), enfants: s.enfants || 0 });

// Une offre de la base, dans la forme de la lecture par règles : titre, détail, prix calculé, tarif enfant et supplément rattachés.
export function offreDepuisBase(ref, pax, { prestations = [], trajets = [], nomPartenaire = () => "" } = {}) {
  if (!ref) return null;
  if (ref.genre === "trajet") {
    const t = trajets.find((x) => x.id === ref.id && x.actif !== false);
    if (!t) return null;
    const { total, avertissement } = prixTrajet(t, pax);
    return { genre: "trajet", id: t.id, source: t, titre: `${t.de} → ${t.vers}${t.depart ? `, ${t.depart}` : ""}`, detail: [t.mode, nomPartenaire(t.partenaire_id)].filter(Boolean).join(" · "), total, avertissement, score: 1 };
  }
  const p = prestations.find((x) => x.id === ref.id && x.actif !== false);
  if (!p) return null;
  const offre = { genre: "prestation", id: p.id, source: p, titre: p.libelle_en || libelleClient(p.libelle), detail: [p.groupe, libelleUnite(p.unite, true), nomPartenaire(p.partenaire_id)].filter(Boolean).join(" · "), total: prixPrestation(p, pax), avertissement: p.sur_place ? "sur_place" : "", score: 1 };
  return completerSupplement(completerEnfant(offre, pax, prestations), pax, prestations);
}

// Les offres retenues par l'assistant, recalculées pour les personnes actuelles : une correction du nombre d'adultes refait le prix comme
// dans la lecture par règles.
export const offresRecalculees = (offres, d, contexte) => (offres || []).map((o) => offreDepuisBase({ genre: o.genre, id: o.id }, paxDe(d), contexte)).filter(Boolean);

// La proposition de l'assistant (déjà contrôlée par la fonction) en demande à vérifier : `d` a la forme de la lecture libre, `services` celle
// du découpage en services (une phrase, sa date, son heure, ses personnes, ses offres). Une référence qui n'est plus dans la base est ignorée.
export function propositionVersDemande(p, contexte) {
  const c = p.client || {};
  const services = (p.services || []).map((s) => {
    // Les personnes du service si le message les donne, sinon celles du groupe.
    const pax = paxDe(s.adultes || s.enfants ? s : c);
    const offres = [s.offre, ...(s.alternatives || [])].map((r) => offreDepuisBase(r, pax, contexte)).filter(Boolean);
    return { phrase: s.texte || "", date: s.date || "", heure: s.heure || "", adultes: pax.adultes, enfants: pax.enfants, offres, copie: false, inconnu: !offres.length, confiance: offres.length ? s.confiance : "basse" };
  });
  const premier = services[0] || {};
  const d = {
    libre: true,
    ia: true,
    marque: "",
    type: "",
    nom: c.nom || "",
    prestation: "",
    de: "",
    vers: "",
    date: premier.date || "",
    dateTexte: "",
    heure: premier.heure || "",
    adultes: c.adultes || premier.adultes || 0,
    enfants: c.enfants || 0,
    bebes: c.bebes || 0,
    ages: c.ages_enfants || [],
    vehicule: "",
    mode: "",
    siegeEnfant: false,
    siegeBebe: false,
    hotel: c.hotel || "",
    telephone: c.telephone || "",
    langue: c.langue || "",
    remarquesIA: p.remarques || "",
  };
  return { d, services };
}

// Faits envoyés pour rédiger une réponse : le prénom, chaque service avec l'offre retenue et son prix de vente, les horaires et frais de la base.
// Uniquement ces champs (la fonction refuse toute autre clé) : aucun net, aucune commission, aucune coordonnée bancaire.
export function faitsPourReponse({ d, services, entreprise = "", devise = "THB", telephone = "" }) {
  const lignes = services
    .map((s) => ({ s, o: s.choisie || (s.offres || [])[0] || null }))
    .filter(({ o }) => o)
    .map(({ s, o }) => {
      const src = o.source || {};
      const det = src.details || {};
      const parc = o.genre === "prestation" ? fraisDeParc(src).texte : "";
      return {
        libelle: o.titre,
        date: s.date || "",
        heure: s.heure || "",
        adultes: s.adultes || 0,
        enfants: s.enfants || 0,
        bebes: d.bebes || 0,
        prix: o.total === null || o.total === undefined ? null : Number(o.total),
        a_payer_sur_place: o.avertissement === "sur_place",
        horaires: o.genre === "trajet" ? src.depart || "" : horairesTexte(det.horaires),
        duree: o.genre === "trajet" ? src.duree || "" : dureeTexte(det.duree),
        frais_parc: parc,
        lieu: o.genre === "trajet" ? `${src.de} → ${src.vers}` : d.hotel || "",
        a_confirmer: true,
      };
    });
  const avecPrix = lignes.filter((l) => l.prix !== null);
  return { entreprise, prenom: separerNom(d.nom).prenom || d.nom || "", devise, total: avecPrix.length ? avecPrix.reduce((a, l) => a + l.prix, 0) : null, telephone_entreprise: telephone, services: lignes };
}

// ---- Démonstration ----------------------------------------------------------------------------------------------------------------------
// En mode démo, rien ne part chez Anthropic : la réponse est simulée à partir de la lecture par règles, dans la forme exacte que renvoie la
// fonction, pour montrer l'écran et le parcours.

const confianceDe = (score) => (score >= 0.75 ? "haute" : score >= 0.5 ? "moyenne" : "basse");

export function simulerLecture(texte, contexte, aujourdhui) {
  const d = lireMessage(texte, aujourdhui);
  if (!d) return { erreur: "invalide" };
  const offres = offresPour(d, texte, contexte);
  const ref = (o) => (o ? { genre: o.genre, id: o.id } : null);
  return {
    ok: true,
    usage: "lire",
    modele: "simulation",
    proposition: {
      client: { nom: d.nom || "", telephone: d.telephone || "", hotel: d.hotel || "", langue: /\b(bonjour|merci|nous|je)\b/i.test(texte) ? "fr" : "en", adultes: d.adultes || 0, enfants: d.enfants || 0, ages_enfants: d.ages || [], bebes: d.bebes || 0 },
      services: [{ texte: texte.split(/\n|[.!?]\s/).find((l) => offres.length && l.length > 8) || "", date: d.date || "", heure: d.heure || "", adultes: d.adultes || 0, enfants: d.enfants || 0, offre: ref(offres[0]), alternatives: offres.slice(1, 3).map(ref), confiance: offres.length ? confianceDe(offres[0].score || 0) : "basse" }],
      remarques: "Réponse simulée (mode démo) : aucun appel à Claude.",
    },
    avertissements: [],
  };
}

const fmt = (n, devise) => `${Number(n).toLocaleString("en-US")} ${devise}`;

export function simulerRedaction(faits, langue) {
  const en = langue === "en";
  const lignes = faits.services.map((s) => `→ ${s.libelle}${s.date ? `, ${s.date}` : ""}${s.heure ? ` ${en ? "at" : "à"} ${s.heure}` : ""}${en ? ":" : " :"} ${s.prix === null ? (en ? "price to confirm" : "prix à confirmer") : fmt(s.prix, faits.devise)}`);
  const total = faits.total !== null && faits.services.length > 1 ? [`Total${en ? ":" : " :"} ${fmt(faits.total, faits.devise)}`] : [];
  const prenom = faits.prenom ? ` ${faits.prenom}` : "";
  const message = en
    ? [`Hello${prenom},`, "", "Thank you for your message 😊", "", ...lignes, ...total, "", "I'll confirm availability with our partner and get back to you. Could you send me your hotel name?", "", "Have a lovely day, Anaïs"].join("\n")
    : [`Bonjour${prenom},`, "", "Merci beaucoup pour votre message 😊", "", ...lignes, ...total, "", "Je vérifie la disponibilité auprès de notre partenaire et je reviens vers vous. Pouvez-vous m'indiquer le nom de votre hôtel ?", "", "Belle journée, Anaïs"].join("\n");
  return { ok: true, usage: "rediger", modele: "simulation", langue: en ? "en" : "fr", message, manques: [en ? "hotel name" : "nom de l'hôtel"], avertissements: [] };
}
