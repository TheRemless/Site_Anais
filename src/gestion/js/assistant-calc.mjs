// Assistant IA, côté outil : la logique pure (sans écran) qui transforme ce que la fonction « assistant » renvoie en demande à vérifier,
// et qui prépare les faits envoyés pour rédiger une réponse. Les prix viennent toujours de la base chargée dans l'outil, avec les mêmes
// calculs que la lecture par règles (demande-calc.mjs) : Claude choisit une ligne du catalogue, il ne donne jamais un prix.
import { prixPrestation, prixTrajet, completerEnfant, completerSupplement, separerNom, lireMessage, offresPour } from "./demande-calc.mjs";
import { libelleClient, libelleUnite, proposable } from "./partenaires-calc.mjs";
import { horairesTexte, dureeTexte, fraisDeParc } from "./operations-calc.mjs";
import { sansLien } from "./agent-calc.mjs";

// L'assistant est éteint tant que l'entreprise ne l'a pas allumé dans Réglages (case « Assistant IA »).
export const assistantActif = (regl) => !!(regl && regl.assistant_ia === true);

const paxDe = (s) => ({ adultes: s.adultes || (s.enfants ? 0 : 1), enfants: s.enfants || 0 });

// Une offre de la base, dans la forme de la lecture par règles : titre, détail, prix calculé, tarif enfant et supplément rattachés.
// Un tarif masqué, ou d'un partenaire masqué, ne se propose pas (`partenaires`, audit n° 16).
export function offreDepuisBase(ref, pax, { prestations = [], trajets = [], nomPartenaire = () => "", partenaires = [] } = {}) {
  if (!ref) return null;
  if (ref.genre === "trajet") {
    const t = trajets.find((x) => x.id === ref.id && proposable(x, partenaires));
    if (!t) return null;
    const { total, avertissement } = prixTrajet(t, pax);
    return { genre: "trajet", id: t.id, source: t, titre: `${t.de} → ${t.vers}${t.depart ? `, ${t.depart}` : ""}`, detail: [t.mode, nomPartenaire(t.partenaire_id)].filter(Boolean).join(" · "), total, avertissement, score: 1 };
  }
  const p = prestations.find((x) => x.id === ref.id && proposable(x, partenaires));
  if (!p) return null;
  const offre = { genre: "prestation", id: p.id, source: p, titre: p.libelle_en || libelleClient(p.libelle), detail: [p.groupe, libelleUnite(p.unite, true), nomPartenaire(p.partenaire_id)].filter(Boolean).join(" · "), total: prixPrestation(p, pax), avertissement: p.sur_place ? "sur_place" : "", score: 1 };
  return completerSupplement(completerEnfant(offre, pax, prestations), pax, prestations);
}

// Les offres retenues par l'assistant, recalculées pour les personnes actuelles : une correction du nombre d'adultes refait le prix comme
// dans la lecture par règles.
// Une offre au prix de la carte (prixCarte, Jérémy, 22.11.2026) garde ce prix tant que les personnes sont celles de la carte ; le prix du
// catalogue recalculé reste à côté (totalCatalogue). Le nombre de personnes change : le prix repart du catalogue, avec un avertissement
// (revue de la PR 307).
const memesPersonnes = (a, b) => !!a && !!b && a.adultes === b.adultes && a.enfants === b.enfants;
// Les véhicules du devis (avecVehicules) suivent la même règle que le prix de la carte : gardés pour les mêmes personnes, sinon le prix
// repart du catalogue avec l'avertissement.
export const offresRecalculees = (offres, d, contexte) =>
  (offres || [])
    .map((o) => {
      const base = offreDepuisBase({ genre: o.genre, id: o.id }, paxDe(d), contexte);
      if (!o || !base || (o.prixCarte === undefined && !o.vehicules)) return base;
      if (!memesPersonnes(paxDe(d), o.prixCarte !== undefined ? o.prixCartePax : o.vehiculesPax)) return { ...base, avertissement: "prix_carte_personnes" };
      return avecVehicules(auPrixCarte(base, o.prixCarte, { pax: o.prixCartePax, origine: o.prixOrigine }), o.vehicules || null, o.vehiculesPax);
    })
    .filter(Boolean);
// Le nombre de véhicules calculé par « Calculer le devis » (devis-calc.mjs) pour un tarif au véhicule ou au bateau : le total du catalogue
// est multiplié, la ligne du dossier prend cette quantité (views/demande.mjs). Un prix de la carte (auPrixCarte) reste le total, réparti
// sur les véhicules par lignesAuPrixCarte. `pax` : les personnes du devis.
export function avecVehicules(offre, n, pax = null) {
  const v = Number(n);
  if (!offre || offre.genre !== "prestation" || !offre.source || !["veh", "boat"].includes(offre.source.unite) || !Number.isInteger(v) || v < 2) return offre;
  const total = offre.prixCarte !== undefined || offre.total === null || offre.total === undefined ? offre.total : Math.round(Number(offre.total) * v * 100) / 100;
  // Le prix du catalogue affiché à côté d'un prix de la carte (« Vérifier avant ») compte aussi les véhicules (relecture de la PR 309).
  const totalCatalogue = offre.prixCarte !== undefined && offre.totalCatalogue !== null && offre.totalCatalogue !== undefined ? Math.round(Number(offre.totalCatalogue) * v * 100) / 100 : offre.totalCatalogue;
  return { ...offre, vehicules: v, vehiculesPax: pax, total, ...(totalCatalogue !== undefined ? { totalCatalogue } : {}) };
}
// L'offre au prix de la conversation : total = le prix de la carte, totalCatalogue = le prix du catalogue (affiché s'il diffère).
// `pax` : les personnes de la carte ; `origine` : « saisi » ou « client_non_corrige » (posée sur la réservation, details.prix_origine).
export function auPrixCarte(offre, prix, { pax = null, origine = null } = {}) {
  if (!offre || prix === null || prix === undefined || !(Number(prix) > 0)) return offre;
  return { ...offre, prixCarte: Number(prix), prixCartePax: pax, prixOrigine: origine, totalCatalogue: offre.totalCatalogue ?? offre.total, total: Number(prix) };
}
// Les lignes du catalogue d'une offre au prix de la carte : les prix unitaires sont mis à l'échelle pour que le total soit le prix de la
// carte (nets, partenaires et quantités gardés). Une seule ligne facturable prend tout le prix. Sans ligne facturable (prestation payée
// sur place), rien ne change.
const arrondi2 = (x) => Math.round(x * 100) / 100;
// Une ligne au prix de la carte n'est plus « offerte ».
const payee = ({ offert, ...l }) => l;
export function lignesAuPrixCarte(lignes = [], prix) {
  if (prix === null || prix === undefined || !(Number(prix) > 0)) return lignes;
  const facturables = lignes.filter((l) => l && l.kind === "ligne" && l.unite !== null && l.unite !== undefined && Number(l.qte) > 0);
  if (!facturables.length) return lignes;
  const total = facturables.reduce((t, l) => t + Number(l.unite) * Number(l.qte), 0);
  const dernier = facturables[facturables.length - 1];
  let deja = 0;
  return lignes.map((l) => {
    if (!facturables.includes(l)) return l;
    if (l === dernier) return { ...payee(l), unite: arrondi2((Number(prix) - deja) / Number(l.qte)) };
    const unite = total > 0 ? arrondi2((Number(l.unite) * Number(prix)) / total) : 0;
    deja += unite * Number(l.qte);
    return { ...payee(l), unite };
  });
}

// La proposition de l'assistant (déjà contrôlée par la fonction) en demande à vérifier : `d` a la forme de la lecture libre, `services` celle
// du découpage en services (une phrase, sa date, son heure, ses personnes, ses offres). Une référence qui n'est plus dans la base est ignorée.
export function propositionVersDemande(p, contexte) {
  const c = p.client || {};
  const services = (p.services || []).map((s) => {
    // Les personnes du service si le message les donne, sinon celles du groupe.
    const pax = paxDe(s.adultes || s.enfants ? s : c);
    // Transfert privé hors catalogue (« Lanta Sand → The Scene, Ao Nang ») : pas de ligne de la base, un prix à taper dans l'écran.
    // Carte de l'agent : un prix tapé par la personne (prix_libre) et le lieu de pickup proposé (lieu_pickup) passent à la fiche.
    // La dépose (« vers ») va dans le drop-off du voucher, que le service soit du catalogue ou un transfert libre (23.11.2026 : un service du
    // catalogue venu d'une carte « dossier » perdait sa dépose). Jamais un lien.
    // Le pickup (relecture de la PR 332) : celui de la carte ; pour un transfert libre, sinon son départ ; pour un service du catalogue, le
    // départ lu ne sert qu'en dernier recours (`depart`), après l'hôtel du client et, chez Taxi, le bout du trajet du catalogue.
    const lieu = s.lieu_pickup ? { hotelDepart: s.lieu_pickup } : {};
    const de = sansLien(s.de);
    const depose = sansLien(s.vers);
    const dropoff = { ...(depose ? { dropoff: depose } : {}), ...(de ? { depart: de } : {}) };
    // Le numéro de vol de la carte (21.11.2026) : il rejoint le bloc du voucher du service, modifiable.
    const vol = s.vol ? { vol: s.vol } : {};
    // Les sièges enfant ou bébé de la carte (22.11.2026) : dans le bloc du voucher du service, puis sur la réservation.
    // Avec les sièges bébé, « aucun siège », les bagages et la remarque du voucher (22.11.2026) : `voucherCarte`, posé dans le bloc du voucher.
    const voucherCarte = {
      ...(Number(s.sieges_bebe) > 0 ? { sieges_bebe: Number(s.sieges_bebe) } : {}),
      ...(s.sans_siege === true && !(Number(s.sieges) > 0) && !(Number(s.sieges_bebe) > 0) ? { sans_siege: true } : {}),
      ...(Number(s.bagages) > 0 ? { bagages: String(Number(s.bagages)) } : {}),
      ...(String(s.remarque_voucher || "").trim() ? { remarques: String(s.remarque_voucher).trim() } : {}),
    };
    const sieges = { ...(Number(s.sieges) > 0 ? { sieges: Number(s.sieges) } : {}), ...(Object.keys(voucherCarte).length ? { voucherCarte } : {}), ...(s.sieges_requis === true ? { siegesRequis: true } : {}) };
    if (s.hors_catalogue) return { ...sieges, phrase: s.texte || "", date: s.date || "", heure: s.heure || "", adultes: pax.adultes, enfants: pax.enfants, offres: [], copie: false, inconnu: false, transfertLibre: { de: s.lieu_pickup || de, vers: depose }, prixLibre: s.prix_libre ?? null, prixOrigine: s.prix_libre !== null && s.prix_libre !== undefined ? s.prix_origine || null : null, confiance: s.confiance || "moyenne", ...vol, ...dropoff };
    // La première offre garde le prix de la carte quand il vient de la conversation (prix_carte) ; les autres restent au catalogue.
    // Elle garde aussi les véhicules du devis (s.vehicules, « Calculer le devis ») : le dossier reprend le devis.
    const offres = [s.offre, ...(s.alternatives || [])].map((r, i) => (i === 0 ? avecVehicules(auPrixCarte(offreDepuisBase(r, pax, contexte), s.prix_carte, { pax, origine: s.prix_origine || null }), s.vehicules, pax) : offreDepuisBase(r, pax, contexte))).filter(Boolean);
    return { ...sieges, phrase: s.texte || "", date: s.date || "", heure: s.heure || "", adultes: pax.adultes, enfants: pax.enfants, offres, copie: false, inconnu: !offres.length, confiance: offres.length ? s.confiance : "basse", ...lieu, ...vol, ...dropoff };
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
  // Un trajet lu (départ ou arrivée) sans tarif, et pas en partagé : un transfert privé hors catalogue, comme le rendrait l'assistant.
  const prive = !/\b(shared|join|partag)/i.test(texte);
  // « from Lanta Sand Resort to The Scene in Ao Nang on the 21/11 » : les deux bouts, comme l'assistant les recopie.
  const m = /\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+on\b|[.,!?\n]|$)/i.exec(texte);
  const de = d.de || (m ? m[1].trim() : "");
  const vers = d.vers || (m ? m[2].trim() : "");
  const libre = !offres.length && prive && !!(de || vers);
  return {
    ok: true,
    usage: "lire",
    modele: "simulation",
    proposition: {
      client: { nom: d.nom || "", telephone: d.telephone || "", hotel: d.hotel || "", langue: /\b(bonjour|merci|nous|je)\b/i.test(texte) ? "fr" : "en", adultes: d.adultes || 0, enfants: d.enfants || 0, ages_enfants: d.ages || [], bebes: d.bebes || 0 },
      services: [{ texte: texte.split(/\n|[.!?]\s/).find((l) => offres.length && l.length > 8) || "", date: d.date || "", heure: d.heure || "", adultes: d.adultes || 0, enfants: d.enfants || 0, de, vers, prive, hors_catalogue: libre, offre: ref(offres[0]), alternatives: offres.slice(1, 3).map(ref), confiance: libre ? "moyenne" : offres.length ? confianceDe(offres[0].score || 0) : "basse" }],
      remarques: "Réponse simulée (mode démo) : aucun appel à Claude.",
    },
    avertissements: [],
  };
}

const fmt = (n, devise) => `${Number(n).toLocaleString("en-US")} ${devise}`;

// `signature` : le prénom de la personne responsable (réglages de l'entreprise), sinon le nom de l'entreprise des faits.
export function simulerRedaction(faits, langue, signature = "") {
  const qui = signature || faits.entreprise || "";
  const en = langue === "en";
  const lignes = faits.services.map((s) => `→ ${s.libelle}${s.date ? `, ${s.date}` : ""}${s.heure ? ` ${en ? "at" : "à"} ${s.heure}` : ""}${en ? ":" : " :"} ${s.prix === null ? (en ? "price to confirm" : "prix à confirmer") : fmt(s.prix, faits.devise)}`);
  const total = faits.total !== null && faits.services.length > 1 ? [`Total${en ? ":" : " :"} ${fmt(faits.total, faits.devise)}`] : [];
  const prenom = faits.prenom ? ` ${faits.prenom}` : "";
  const message = en
    ? [`Hello${prenom},`, "", "Thank you for your message 😊", "", ...lignes, ...total, "", "I'll confirm availability with our partner and get back to you. Could you send me your hotel name?", "", `Have a lovely day, ${qui}`].join("\n")
    : [`Bonjour${prenom},`, "", "Merci beaucoup pour votre message 😊", "", ...lignes, ...total, "", "Je vérifie la disponibilité auprès de notre partenaire et je reviens vers vous. Pouvez-vous m'indiquer le nom de votre hôtel ?", "", `Belle journée, ${qui}`].join("\n");
  return { ok: true, usage: "rediger", modele: "simulation", langue: en ? "en" : "fr", message, manques: [en ? "hotel name" : "nom de l'hôtel"], avertissements: [] };
}
