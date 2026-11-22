// « Calculer le devis » (22.11.2026) : sur la carte « Nouveau dossier » de l'Assistant (ouverte depuis l'onglet ou depuis WhatsApp), Nani lance
// elle-même le calcul, jamais à la demande. Logique pure, sans écran ni appel IA : véhicules selon la capacité du catalogue, prix de vente,
// total, réponse au client en anglais sans signature que Nani relit et copie.
//
// Règles tenues ici :
//   - le bouton n'existe que si chaque service a son trajet ou son excursion, ses personnes et sa date (devisPossible) ;
//   - seuls des prix de vente : prix_vente d'une prestation, prix_adulte et prix_enfant d'un trajet (les nets vivent dans d'autres tables) ;
//   - un prix déjà accepté dans la conversation passe avant le catalogue : la règle des PR 306 et 307, calculée par la fonction agent
//     (origine_prix « saisi » ou « client_non_corrige ») et reprise telle quelle par propositionDepuisCarte et auPrixCarte ;
//   - un service sans ligne au catalogue (ni prix accepté), une capacité absente ou dépassée, un prix vide : pas de calcul, un motif clair,
//     et aucune réponse préparée tant qu'un service manque (un devis partiel oublierait un service).
import { propositionDepuisCarte, resteBloque } from "./agent-calc.mjs";
import { offreDepuisBase, auPrixCarte } from "./assistant-calc.mjs";
import { libelleClient } from "./partenaires-calc.mjs";
import { dateTexte, personnesTexte } from "./operations-calc.mjs";

// Même contrôle que la fonction agent (outils.js) : un 31 février ne passe pas.
const dateValide = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const entier = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.floor(Number(x)) : 0);
const arrondi2 = (x) => Math.round(x * 100) / 100;

// Les personnes du service, sinon celles de la carte (comme propositionVersDemande). Les bébés ne prennent pas de place payante.
export function personnesDuService(s = {}, donnees = {}) {
  const a = entier(s.adultes);
  const e = entier(s.enfants);
  if (a || e) return { adultes: a, enfants: e };
  return { adultes: entier(donnees.adultes), enfants: entier(donnees.enfants) };
}
const nbPersonnes = (p) => p.adultes + p.enfants;
// Le trajet ou l'excursion est connu : une ligne du catalogue, ou au moins ce que la personne a demandé (départ et arrivée, ou un texte).
const serviceConnu = (s) => !!(s && (s.offre || (s.de && s.vers) || String(s.libelle || s.texte || "").trim()));

// Le bouton n'apparaît que lorsque les trois sont connus pour chaque service : trajet ou excursion, nombre de personnes, date.
export function devisPossible(donnees = {}) {
  const services = (donnees && donnees.services) || [];
  return services.length > 0 && services.every((s) => serviceConnu(s) && nbPersonnes(personnesDuService(s, donnees)) > 0 && dateValide(s.date));
}

// ---- Capacité du catalogue -------------------------------------------------------------------------------------------------------
// Tarifs vendus au véhicule ou au bateau : le nombre de véhicules suit la capacité.
export const PAR_VEHICULE = ["veh", "boat"];
// La capacité vient seulement du champ chiffré « Personnes au plus par véhicule » du tarif (prestations.places_vehicule, migration 90).
// Jamais du texte « Capacité » (details.capacite) ni d'une remarque : chez Taxi, la remarque dit « Price for 1 to 2 guests… ferry crossing
// included up to 4 people », une tranche de prix et un billet de ferry, pas les places du minivan. null : à renseigner, rien ne se devine.
export function capaciteDe(p) {
  const n = p ? Number(p.places_vehicule) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : null;
}

// Le mot du véhicule pour le client, d'après le groupe et le libellé du tarif.
export function motVehicule(p, n = 1) {
  const t = `${(p && p.groupe) || ""} ${(p && p.libelle_en) || ""} ${(p && p.libelle) || ""}`.toLowerCase();
  const mot = /minivan|mini van|minibus|\bvan\b/.test(t) ? "minivan" : /speed ?boat/.test(t) ? "speedboat" : /longtail/.test(t) ? "longtail boat" : /\btaxi\b/.test(t) ? "taxi" : /\bcar\b|sedan|berline|voiture|\bsuv\b/.test(t) ? "car" : p && p.unite === "boat" ? "boat" : "vehicle";
  return n > 1 ? `${mot}s` : mot;
}

// Le libellé du service pour le client, en anglais : celui du catalogue, sinon le trajet demandé. Un transfert dont le libellé ne dit que
// la destination (catalogue Taxi : groupe « Private Taxi », libellé « Krabi Airport ») prend son groupe et le trajet de la carte :
// « Private Taxi: Koh Lanta → Krabi Airport ».
function libelleDuService(base, s) {
  if (base && base.genre === "trajet") {
    const t = base.source;
    const mode = libelleClient(t.mode || "");
    return `${mode ? `${mode}: ` : ""}${t.de} → ${t.vers}${t.depart ? `, ${t.depart}` : ""}`;
  }
  const p = base && base.source;
  if (p && p.famille === "transfert" && p.groupe && !/→|->/.test(base.titre) && !base.titre.toLowerCase().includes(String(p.groupe).toLowerCase())) return `${libelleClient(p.groupe)}: ${s.de && s.vers ? `${s.de} → ${s.vers}` : base.titre}`;
  if (base) return base.titre;
  return s.de && s.vers ? `${s.de} → ${s.vers}` : String(s.libelle || s.texte || "").trim();
}

// ---- Calcul ----------------------------------------------------------------------------------------------------------------------
// `donnees` : celles de la carte « dossier » (avec les entreprises corrigées d'un tap en mode unifié). `contexte` : le catalogue chargé de
// l'entreprise active ({ prestations, trajets, partenaires, nomPartenaire }), comme offreDepuisBase. `activeId` : un service d'une autre
// entreprise (espace unifié) ne se calcule pas ici, son catalogue n'est pas chargé.
//
// Rend { lignes, manquants, total, complet } :
//   ligne : { index, libelle, date, personnes, total, unitaire, vehicules, vehicule, origine ("catalogue" | "saisi" | "client_non_corrige"),
//             avertissement, offre: { genre, id } | null, tarif (la ligne du catalogue, pour le contrôle des nets) } ;
//   manquant : { index, libelle, motif, capacite?, tarif? (id et libellé du tarif à compléter) } ; total : la somme des lignes, null tant qu'un service manque.
export function calculerDevis(donnees = {}, contexte = {}, { activeId = null } = {}) {
  const services = (donnees && donnees.services) || [];
  // Les prix acceptés dans la conversation (PR 306 et 307) : prix_carte d'un service du catalogue, prix_libre d'un service hors catalogue.
  const prop = propositionDepuisCarte(donnees);
  const lignes = [];
  const manquants = [];
  services.forEach((s, index) => {
    const sp = prop.services[index] || {};
    const personnes = personnesDuService(s, donnees);
    const nb = nbPersonnes(personnes);
    const manque = (motif, plus = {}) => manquants.push({ index, libelle: libelleDuService(null, s), motif, ...plus });
    if (!nb || !dateValide(s.date) || !serviceConnu(s)) return manque("incomplet");
    if (activeId && s.entite_id && s.entite_id !== activeId) return manque("autre_entreprise");
    const accepte = (prix) => Number(prix) > 0 && ["saisi", "client_non_corrige"].includes(sp.prix_origine);
    const ligne = (base, total, plus = {}) =>
      lignes.push({ index, libelle: libelleDuService(base, s), date: s.date, personnes, total: arrondi2(total), unitaire: null, vehicules: null, vehicule: "", origine: "catalogue", avertissement: (base && base.avertissement) || "", offre: base ? { genre: base.genre, id: base.id } : null, tarif: base ? base.source : null, ...plus });
    if (!s.offre) {
      // Hors catalogue : seul un prix accepté dans la conversation donne un devis. Sinon rien n'est calculé.
      if (accepte(sp.prix_libre)) return ligne(null, Number(sp.prix_libre), { origine: sp.prix_origine });
      return manque("hors_catalogue");
    }
    const base = offreDepuisBase(s.offre, personnes, contexte);
    // Un prix accepté reste le prix de vente même si la ligne du catalogue a disparu ou est masquée.
    if (!base) return accepte(sp.prix_carte) ? ligne(null, Number(sp.prix_carte), { origine: sp.prix_origine }) : manque("introuvable");
    const p = base.genre === "prestation" ? base.source : null;
    const parVehicule = !!p && PAR_VEHICULE.includes(p.unite);
    const capacite = p ? capaciteDe(p) : null;
    // Les bébés de la carte prennent une place (siège) dans un véhicule : comptés pour la capacité, jamais pour le prix.
    const vehicules = parVehicule && capacite ? Math.ceil((nb + entier(donnees.bebes)) / capacite) : null;
    const vehicule = vehicules ? motVehicule(p, vehicules) : "";
    // Le prix accepté passe avant le catalogue (auPrixCarte, PR 307) : il vaut pour tout le service, quel que soit le nombre de véhicules.
    if (accepte(sp.prix_carte)) {
      const o = auPrixCarte(base, sp.prix_carte, { pax: personnes, origine: sp.prix_origine });
      return ligne(o, o.total, { origine: sp.prix_origine, vehicules, vehicule, avertissement: "" });
    }
    if (base.total === null || base.total === undefined) return manque(p && p.sur_place ? "sur_place" : "sans_prix");
    if (parVehicule) {
      // Sans capacité, la quantité de véhicules n'est pas connue : rien à multiplier. Le tarif est rendu pour que Nani le complète.
      if (!capacite) return manque("capacite_inconnue", { tarif: { id: p.id, libelle: p.libelle } });
      return ligne(base, Number(base.total) * vehicules, { unitaire: Number(base.total), vehicules, vehicule });
    }
    // Un tarif de groupe ou à la personne au-delà de la capacité écrite : la sortie ne prend pas tout le monde, Nani tranche.
    if (capacite && nb > capacite) return manque("capacite_depassee", { capacite });
    return ligne(base, Number(base.total));
  });
  const complet = !manquants.length && lignes.length > 0;
  const total = complet ? arrondi2(lignes.reduce((t, l) => t + l.total, 0)) : null;
  return { lignes, manquants, total, complet };
}

// ---- Réponse au client -----------------------------------------------------------------------------------------------------------
const nombre = (n) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
const prenomDe = (nom) => String(nom || "").trim().split(/\s+/)[0] || "";

// Le texte anglais à relire par Nani : chaque service, sa date, ses personnes, son prix, le total, la question de la réservation. Aucune
// signature, aucun net, aucun nom de partenaire (le contrôle de l'écran bloque la copie s'il en reste). Rien sans devis complet.
export function reponseDevis(devis, { client = {}, devise = "THB" } = {}) {
  if (!devis || !devis.complet) return "";
  const prenom = prenomDe(client && client.nom);
  const out = [`Hello${prenom ? ` ${prenom}` : ""},`, "", devis.lignes.length > 1 ? "Here are the prices for your request:" : "Here is the price for your request:"];
  for (const l of devis.lignes) {
    out.push("", l.libelle, `Date: ${dateTexte(l.date, "en")}`);
    const gens = personnesTexte(l.personnes, "en");
    if (gens) out.push(`People: ${gens}`);
    if (l.vehicules > 1 && l.unitaire !== null) out.push(`Price: ${l.vehicules} ${l.vehicule} × ${devise} ${nombre(l.unitaire)} = ${devise} ${nombre(l.total)}`);
    else out.push(`Price: ${devise} ${nombre(l.total)}${l.vehicules > 1 ? ` for ${l.vehicules} ${l.vehicule}` : ""}`);
  }
  if (devis.lignes.length > 1) out.push("", `Total: ${devise} ${nombre(devis.total)}`);
  out.push("", "Would you like me to book it?");
  return out.join("\n");
}

// Les nets des services du devis (si la personne a le droit de les lire, sinon les tables sont vides) : un montant de la réponse égal à
// l'un d'eux, ou à un net multiplié par le nombre de véhicules, bloque la copie (resteBloque, agent-calc.mjs).
export function netsDuDevis(devis, { prestations_nets = [], trajets_nets = [] } = {}) {
  const out = new Set();
  const ajouter = (x, fois = 1) => {
    const n = Number(x);
    if (x !== null && x !== undefined && n > 0) {
      out.add(n);
      if (fois > 1) out.add(arrondi2(n * fois));
    }
  };
  for (const l of (devis && devis.lignes) || []) {
    if (!l.offre) continue;
    if (l.offre.genre === "prestation") for (const n of prestations_nets.filter((x) => x.prestation_id === l.offre.id)) [n.net, n.net_enfant].forEach((v) => ajouter(v, l.vehicules || 1));
    if (l.offre.genre === "trajet")
      for (const n of trajets_nets.filter((x) => x.trajet_id === l.offre.id)) {
        ajouter(n.net_adulte, l.personnes.adultes);
        ajouter(n.net_enfant, l.personnes.enfants);
      }
  }
  return [...out];
}

// ---- Du devis au dossier (22.11.2026) --------------------------------------------------------------------------------------------
// Le dossier créé depuis la carte ne diffère jamais du devis calculé par Nani : même nombre de véhicules, même total. Le devis complet est
// résumé par service (index, tarif, personnes, véhicules, total). appliquerDevis le pose sur les services de la carte : `vehicules` suit
// jusqu'aux lignes du dossier (assistant-calc.mjs, avecVehicules ; views/demande.mjs, quantité de la ligne). Un service dont le tarif ou les
// personnes ont changé depuis le devis n'est pas touché.
export function resumeDevis(devis) {
  if (!devis || !devis.complet) return null;
  return { lignes: devis.lignes.map((l) => ({ index: l.index, offre: l.offre ? l.offre.id : null, adultes: l.personnes.adultes, enfants: l.personnes.enfants, vehicules: l.vehicules || null, total: l.total })) };
}
export function appliquerDevis(donnees = {}, resume = null) {
  if (!resume || !Array.isArray(resume.lignes) || !donnees || !Array.isArray(donnees.services)) return donnees;
  const services = donnees.services.map((s, i) => {
    const l = resume.lignes.find((x) => x.index === i);
    if (!l || ((s.offre && s.offre.id) || null) !== l.offre) return s;
    const p = personnesDuService(s, donnees);
    if (p.adultes !== l.adultes || p.enfants !== l.enfants) return s;
    return { ...s, prix: l.total, ...(l.vehicules > 1 ? { vehicules: l.vehicules } : {}) };
  });
  return { ...donnees, services };
}

// ---- Remarque du tarif (22.11.2026) ----------------------------------------------------------------------------------------------
// Une surcharge écrite seulement dans la remarque du tarif (« 60 ฿ per person from the 5th ») n'est ni lue ni devinée : la remarque est
// montrée à Nani sous le devis, à vérifier. Si elle cite un partenaire, un montant égal à un net ou un mot de coût (net, commission,
// marge…), seul « à vérifier dans le catalogue » est montré. Rien de tout cela n'entre dans la réponse au client.
const MOT_COUT = /(?<![a-z0-9])(?:nets?|nett|costs?|couts?|coûts?|commissions?|marges?|margins?|b2b|agent rates?|contract rates?|tarifs? agences?|prix agences?|prix d'?achat)(?![a-z0-9])/i;
export function remarquesDuDevis(devis, { nets = [], noms = [] } = {}) {
  const out = [];
  const vus = new Set();
  for (const l of (devis && devis.lignes) || []) {
    const t = l.tarif;
    const note = t && t.details && typeof t.details.note === "string" ? t.details.note.replace(/\s+/g, " ").trim() : "";
    if (!note || vus.has(t.id)) continue;
    vus.add(t.id);
    const interne = MOT_COUT.test(note.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) || resteBloque(note, { montants: nets, noms }).length > 0;
    out.push({ index: l.index, libelle: l.libelle, texte: interne ? null : note });
  }
  return out;
}
