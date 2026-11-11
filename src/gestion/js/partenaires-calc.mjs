// Logique pure du module Partenaires : familles, unités, marges, recherche de trajets.
// Aucune dépendance au navigateur pour pouvoir la tester avec node --test.
import { N_, tr, langueActive } from "./i18n.mjs";

export const FAMILLES = [
  ["excursion", N_("Excursions")],
  ["activite", N_("Activités")],
  ["location", N_("Locations")],
  ["transfert", N_("Transferts")],
  ["frais", N_("Frais de parc")],
  ["autre", N_("Autres")],
];
export const nomFamille = (code) => {
  const f = FAMILLES.find(([c]) => c === code);
  return f ? tr(f[1]) : code;
};

// Unité d'un prix : code court en base, libellé en français et en anglais pour les documents.
export const UNITES = {
  pp: ["par personne", "per person"],
  ad: ["par adulte", "per adult"],
  ch: ["par enfant", "per child"],
  boat: ["par bateau", "per boat"],
  veh: ["par véhicule", "per vehicle"],
  day: ["par jour", "per day"],
  ses: ["par session", "per session"],
  grp: ["par groupe", "per group"],
  sup: ["par personne supplémentaire", "per extra person"],
  "": ["", ""],
};
// Personnes au-delà des deux premières, pour un tarif « prix de base pour 1 ou 2 personnes, puis un supplément par personne en plus ». Les bébés ne comptent pas.
export const PERSONNES_DE_BASE = 2;
export const personnesSupplementaires = ({ adultes = 0, enfants = 0 } = {}) => Math.max(0, (Number(adultes) || 0) + (Number(enfants) || 0) - PERSONNES_DE_BASE);
// Quantité proposée pour un tarif selon son unité : par personne, par adulte, par enfant, par personne supplémentaire (0 possible), sinon une seule.
export const quantiteParDefaut = (unite, p = {}) => {
  const a = Number(p.adultes) || 0;
  const e = Number(p.enfants) || 0;
  if (unite === "sup") return personnesSupplementaires(p);
  return (unite === "pp" ? a + e : unite === "ad" ? a : unite === "ch" ? e : 1) || 1;
};
// « Programme B : Private Fishing & Seafood, Base 1-2 pers » → « programme b » : le nom d'un programme est ce qui précède les deux-points. Les libellés d'un même
// programme n'ont pas toujours la même suite (la base dit « Fresh Seafood Lunch (4 heures) », le supplément seulement « Seafood »).
export const prefixeProgramme = (libelle) => {
  const t = String(libelle || "");
  const i = t.indexOf(":");
  if (i <= 0 || i >= 40) return "";
  // Seulement la convention « Programme A », « Program B » : un autre « xxx : » (« Speedboat transfer: Lanta → Lipe ») ne désigne pas un programme.
  const p = sansAccents(t.slice(0, i)).trim();
  return /^(programme|program)\s+[a-z0-9]{1,3}$/.test(p) ? p : "";
};
// Une ligne de supplément (« par personne supplémentaire ») se reconnaît à son drapeau `supplement`, ou à son unité écrite dans l'intro (l'intro est vidée quand la ligne
// entre dans une facture : le drapeau seul survit).
export const estLigneSupplement = (l) => !!l && (l.supplement === true || /suppl[ée]mentaire|extra person/i.test(l.intro || ""));
export const libelleUnite = (code, en = langueActive() === "en") => (UNITES[code] || UNITES[""])[en ? 1 : 0];

// Devine l'unité d'après un texte de brochure (« Par personne », « Par bateau », « 4 à 6 personnes »).
export function uniteDepuisTexte(texte) {
  const t = sansAccents(texte);
  if (/supplementaire|extra person|additional person/.test(t)) return "sup";
  if (/bateau|boat|privatif/.test(t)) return "boat";
  if (/vehicule|voiture|van|car\b/.test(t)) return "veh";
  if (/jour|day/.test(t)) return "day";
  if (/enfant|child/.test(t)) return "ch";
  if (/adulte|adult/.test(t)) return "ad";
  if (/\d\s*(a|-|–)\s*\d+\s*(personnes|pax)|\d+\s*personnes/.test(t)) return "grp";
  if (/personne|person|pax|public/.test(t)) return "pp";
  return "";
}

export const sansAccents = (s) => (s === null || s === undefined ? "" : String(s)).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Tous les mots saisis doivent apparaître dans le texte (recherche sans accents ni casse).
export function correspond(texte, q) {
  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  if (!mots.length) return true;
  const h = sansAccents(texte);
  return mots.every((m) => h.includes(m));
}

// Marge entre prix de vente et net : montant et pourcentage du prix de vente. Null quand il manque un des deux.
export function marge(vente, net) {
  if (vente === null || vente === undefined || net === null || net === undefined || vente === "" || net === "") return null;
  const v = Number(vente);
  const n = Number(net);
  if (Number.isNaN(v) || Number.isNaN(n)) return null;
  const montant = Math.round((v - n) * 100) / 100;
  return { montant, pct: v ? Math.round(((v - n) / v) * 100) : 0 };
}

// Un trajet sans fenêtre circule toute la période du contrat ; sinon la date doit tomber dans une fenêtre.
export function trajetDisponible(t, dateIso) {
  if (!dateIso) return true;
  const f = Array.isArray(t.fenetres) ? t.fenetres : [];
  if (!f.length) return true;
  return f.some(([debut, fin]) => dateIso >= debut && dateIso <= fin);
}

export const lieux = (trajets) => [...new Set(trajets.flatMap((t) => [t.de, t.vers]))].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr"));

export function filtrerTrajets(trajets, { de = "", vers = "", partenaireId = "", date = "", q = "", nomPartenaire = () => "" } = {}) {
  return trajets
    .filter((t) => t.actif !== false)
    .filter((t) => (!de || t.de === de) && (!vers || t.vers === vers) && (!partenaireId || t.partenaire_id === partenaireId) && trajetDisponible(t, date))
    .filter((t) => correspond([t.de, t.vers, t.mode, t.depart, t.arrivee, t.periode, nomPartenaire(t.partenaire_id)].join(" "), q))
    .sort((a, b) => `${a.de}${a.vers}`.localeCompare(`${b.de}${b.vers}`, "fr") || (a.depart || "").localeCompare(b.depart || ""));
}

// Pour un départ et une arrivée donnés : les trajets au net adulte le plus bas, seulement quand les compagnies
// n'ont pas le même minimum (sinon le repère n'apporte rien). `netDe(t)` renvoie le net adulte ou null.
export function meilleursNets(trajets, netDe) {
  const parCie = new Map();
  for (const t of trajets) {
    const n = netDe(t);
    if (n === null || n === undefined) continue;
    parCie.set(t.partenaire_id, Math.min(parCie.get(t.partenaire_id) ?? Infinity, Number(n)));
  }
  const minima = [...parCie.values()];
  if (minima.length < 2 || new Set(minima).size < 2) return new Set();
  const min = Math.min(...minima);
  return new Set(trajets.filter((t) => Number(netDe(t)) === min).map((t) => t.id));
}

// Résumé par compagnie d'une liste de trajets déjà filtrés : nombre de départs, heures, prix adulte le plus bas.
export function resumeParCompagnie(trajets, netDe) {
  const out = new Map();
  for (const t of trajets) {
    const r = out.get(t.partenaire_id) || { partenaire_id: t.partenaire_id, departs: 0, heures: new Set(), vente: Infinity, net: Infinity };
    r.departs++;
    if (t.depart) r.heures.add(t.depart.slice(0, 5));
    if (t.prix_adulte !== null && t.prix_adulte !== undefined) r.vente = Math.min(r.vente, Number(t.prix_adulte));
    const n = netDe(t);
    if (n !== null && n !== undefined) r.net = Math.min(r.net, Number(n));
    out.set(t.partenaire_id, r);
  }
  return [...out.values()].map((r) => ({ ...r, heures: [...r.heures].sort(), vente: Number.isFinite(r.vente) ? r.vente : null, net: Number.isFinite(r.net) ? r.net : null }));
}

// Contrats qui arrivent à échéance dans `jours` jours (ou déjà passés), pour l'écran Aujourd'hui.
export function contratsAEcheance(partenaires, ajd, jours = 30) {
  const limite = ajouter(ajd, jours);
  return partenaires
    .filter((p) => p.actif !== false && p.contrat && p.contrat.fin && p.contrat.fin <= limite)
    .map((p) => ({ partenaire: p, fin: p.contrat.fin, passe: p.contrat.fin < ajd }))
    .sort((a, b) => a.fin.localeCompare(b.fin));
}

// ---- Libellé pour le client ----------------------------------------------------------------------------------
// Les libellés importés viennent des brochures en français, avec des notes internes (« Base 1-2 pers », thaï entre
// parenthèses, « Adulte » en fin de ligne). Le client reçoit un libellé propre, en anglais, sans ces notes.
const TRADUCTIONS = [
  [/\s*\([^()]*[฀-๿][^()]*\)/g, ""],
  [/\bTour Partagé \(Join\)/gi, "Join tour"],
  [/\bTour Partagé \(Speedboat\)/gi, "Join speedboat tour"],
  [/\bPrivatisation \(Charter\)/gi, "Private charter"],
  [/\bPrivatisation Speedboat\b/gi, "Private speedboat"],
  [/\bPrivé \(Radeau Bois\)/gi, "Private wooden raft"],
  [/\bOption Supplément\b/gi, "Option"],
  [/\bPrivatisation\b/g, "Private"],
  [/\bExcursion d'une journée\b/gi, "Full-day trip"],
  [/\bExcursion d'une demi-journée\b/gi, "Half-day trip"],
  [/\bfrontière malaisienne\b/gi, "Malaysian border"],
  [/\bAssociation des taxis de Saladan\b/gi, "Saladan Taxi Association"],
  [/\bdécouverte de\b/gi, "discovery of"],
  [/\bvan partagé/gi, "shared van"],
  [/\bAéroport de Hat ?yai\b/gi, "Hat Yai Airport"],
  [/\bAéroport de Krabi\b/gi, "Krabi Airport"],
  [/\bAéroport de Trang\b/gi, "Trang Airport"],
  [/\bvisa run\b/gi, "visa run"],
  [/\bExtension Koh Kradan sur tour 4 îles privé/gi, "Koh Kradan extension on the private 4 Islands tour"],
  [/\bAu choix\s*:\s*/gi, ""],
  [/\s+OU\s+/g, " or "],
  [/4 Îles/gi, "4 Islands"],
  [/\bÎles?\b/g, "Islands"],
  [/\bCoucher de soleil & Vin\b/gi, "sunset & wine"],
  [/\bCoucher de soleil\b/gi, "sunset"],
  [/\bLever de soleil dans la mangrove\b/gi, "sunrise in the mangrove"],
  [/\bLever de soleil\b/gi, "sunrise"],
  [/,?\s*Base 1-2 pers\b/gi, ", for 1 to 2 people"],
  [/,?\s*Personne supplémentaire\b/gi, ", extra person"],
  [/,?\s*À partir de (\d+) personnes\b/gi, ", from $1 people"],
  [/\((\d+) heures?\)/gi, "($1 hours)"],
  [/\b(\d+) Heures?\b/gi, "$1 hour"],
  [/\bProgramme\b/g, "Program"],
  [/\bSanctuaire Éléphants\b/gi, "Elephant sanctuary"],
  [/\bQuad Tout-Terrain\b/gi, "ATV"],
  [/\bQuad & Kayak Mangrove\b/gi, "ATV & mangrove kayak"],
  [/\bKarting Électrique\b/gi, "Electric go-kart"],
  [/\(Zone circuit sécurisée\)/gi, "(safe track)"],
  [/\(Forêt & Point de vue panoramique\)/gi, "(forest & viewpoint)"],
  [/\(1 place enfant\/ado\)/gi, "(single seat, child or teen)"],
  [/\(2 places format compact\)/gi, "(compact double seat)"],
  [/\(1 place adulte grand format\)/gi, "(large single seat)"],
  [/\(2 places adulte biplace\)/gi, "(large double seat)"],
  [/\bSculpture sur fruits et légumes\b/gi, "Fruit and vegetable carving"],
  [/\bMarché et déjeuner\b/gi, "Market visit and lunch class"],
  [/\bDîner\b/g, "Dinner class"],
  [/\bConducteur\b/g, "driver"],
  [/\bPassager\b/g, "passenger"],
  [/,?\s*Tout public\b/gi, ""],
  [/\bEnfant \((\d+)-(\d+) ans\)/gi, "child ($1-$2)"],
  [/,?\s*Adulte\b/g, ""],
  [/\bEnfant\b/g, "child"],
  [/\bAéroport de Hatyai\b/gi, "Hat Yai Airport"],
  [/\bAéroport de (\w+)/gi, "$1 Airport"],
  [/\bAéroport et ville de Phuket\b/gi, "Phuket Airport and town"],
  [/\bPakbara pier\b/gi, "Pakbara Pier"],
  [/\bTour de l'île en une journée\b/gi, "Island tour, full day"],
  [/\bvers\b/g, "to"],
  [/\(Phra Ae Nord\)/gi, "(Phra Ae North)"],
  [/\(Centre plage\)/gi, "(beach centre)"],
  [/\b(\d+) places\b/gi, "$1 seats"],
  [/\((\d+)\s*(?:à|-|–)\s*(\d+) personnes\)/gi, "($1 to $2 people)"],
  [/\b(\d+)\s*(?:à|-|–)\s*(\d+) personnes\b/gi, "$1 to $2 people"],
  [/\bpersonnes\b/g, "people"],
  [/\bpersonne\b/g, "person"],
  [/\bMinivan privé\b/gi, "Private minivan"],
  [/\bBerline privée\b/gi, "Private car"],
  [/\bNavette partagée\b/gi, "Shared minivan"],
  [/\bjournée\b/g, "full day"],
  [/\s*[,;]\s*$/g, ""],
  [/\s{2,}/g, " "],
  // En dernier, pour ne pas casser les règles qui contiennent « et ».
  [/(\S)\s+et\s+(\S)/g, "$1 and $2"],
];
export function libelleClient(libelle) {
  let t = String(libelle || "");
  for (const [re, par] of TRADUCTIONS) t = t.replace(re, par);
  return t.trim();
}

// ---- Lignes de devis depuis une prestation ou un trajet ------------------------------------------------------
// La ligne garde la prestation, le partenaire, le net et la date du service : le document reste lisible seul
// (le net n'est visible que par qui lit le document, donc qui a déjà le droit « montants »).
const nouvelId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const texteMontant = (n, devise) => `${Number(n).toLocaleString("fr-CH").replace(/ | |,/g, "'")} ${devise}`;

export function noteSurPlace(x, langue = "", devise = "THB") {
  const d = x.details || {};
  const en = langue === "en";
  const lib = en ? x.libelle_en || x.libelle : x.libelle;
  const enfant = d.enfant !== undefined && d.enfant !== null && d.enfant !== "";
  if (en) return `To be paid on site in cash: ${lib}, ${texteMontant(x.prix_vente, devise)} per adult${enfant ? ` and ${texteMontant(d.enfant, devise)} per child` : ""}. Never included by the operators.`;
  return `À régler sur place, en espèces : ${lib}, ${texteMontant(x.prix_vente, devise)} par adulte${enfant ? ` et ${texteMontant(d.enfant, devise)} par enfant` : ""}. Jamais inclus par les prestataires.`;
}

export function ligneDepuisPrestation(x, net, { langue = "", date = "", qte = 1, devise = "THB", uid = nouvelId } = {}) {
  const en = langue === "en";
  const base = { id: uid(), intro: "", puces: [], unite: null, qte: null, montant: null, pct: null, prestation_id: x.id, partenaire_id: x.partenaire_id || null, date_service: date || null };
  if (x.sur_place) return { ...base, kind: "texte", libelle: noteSurPlace(x, langue, devise), sur_place: true };
  // En anglais : le libellé anglais de la prestation, sinon le libellé nettoyé et traduit pour le client.
  // `par` garde l'unité du tarif (grp, boat, sup…) : l'intro est vidée dans la facture, et un prix de groupe ne se met pas à l'échelle des personnes.
  return { ...base, ...(x.unite === "sup" ? { supplement: true } : {}), ...(["boat", "veh", "day", "ses", "grp"].includes(x.unite) ? { par: x.unite } : {}), kind: "ligne", libelle: en ? x.libelle_en || libelleClient(x.libelle) : x.libelle, intro: x.unite ? `(${libelleUnite(x.unite, en)})` : "", unite: x.prix_vente, qte: x.unite === "sup" ? Math.max(0, Number(qte) || 0) : Number(qte) || 1, net: net && net.net !== null && net.net !== undefined ? Number(net.net) : null };
}

// Prestation hors base : une ligne saisie à la main qui a pourtant sa réservation (donc son voucher), repérée par `libre`.
export function ligneLibre({ libelle, prix, qte = 1, partenaire_id = null, date = "" }, { uid = nouvelId } = {}) {
  return { id: uid(), kind: "ligne", libre: true, libelle: String(libelle).trim(), intro: "", puces: [], unite: Number(prix), qte: Number(qte) || 1, montant: null, pct: null, prestation_id: null, trajet_id: null, partenaire_id: partenaire_id || null, date_service: date || null, net: null };
}

// Un trajet donne une ligne par adulte et, s'il y a des enfants et un prix enfant, une ligne enfant.
// `compagnie` vide : le prestataire n'est pas répété dans le libellé (il figure déjà sur la facture de Secret).
// « Van partagé + speedboat » → « Shared van + speedboat », avec une majuscule au début.
export const modeEn = (mode) => { const m = libelleClient(mode || "Boat"); return m.charAt(0).toUpperCase() + m.slice(1); };
export function lignesDepuisTrajet(t, net, { langue = "", date = "", adultes = 1, enfants = 0, compagnie = "", uid = nouvelId } = {}) {
  const en = langue === "en";
  const titre = en ? `${modeEn(t.mode)} transfer: ${t.de} → ${t.vers}, departure ${t.depart}${compagnie ? ` with ${compagnie}` : ""}` : `${t.mode || "Bateau"} ${t.de} → ${t.vers}, départ ${t.depart}${compagnie ? ` avec ${compagnie}` : ""}`;
  const base = { intro: "", puces: [], montant: null, pct: null, trajet_id: t.id, partenaire_id: t.partenaire_id || null, date_service: date || null };
  const out = [];
  if (Number(adultes) > 0) out.push({ ...base, id: uid(), kind: "ligne", libelle: titre, intro: `(${en ? "per adult" : "par adulte"})`, unite: t.prix_adulte, qte: Number(adultes), net: net && net.net_adulte !== null && net.net_adulte !== undefined ? Number(net.net_adulte) : null });
  if (Number(enfants) > 0 && t.prix_enfant !== null && t.prix_enfant !== undefined) out.push({ ...base, id: uid(), kind: "ligne", libelle: `${titre}, ${en ? "child" : "enfant"}`, intro: `(${en ? "per child" : "par enfant"})`, unite: t.prix_enfant, qte: Number(enfants), net: net && net.net_enfant !== null && net.net_enfant !== undefined ? Number(net.net_enfant) : null });
  return out;
}

// Marge d'un document : son total moins les nets connus des lignes de partenaires.
// `sansNet` compte les lignes à montant dont le net n'est pas connu : la marge affichée est alors un plafond.
export function margeDocument(contenu, totalDocument) {
  const lignes = (contenu && contenu.lignes) || [];
  const brut = (l) => (l.unite !== null && l.unite !== undefined && l.qte !== null && l.qte !== undefined && l.unite !== "" && l.qte !== "" ? Number(l.unite) * Number(l.qte) : l.montant !== null && l.montant !== undefined && l.montant !== "" ? Number(l.montant) : 0);
  let nets = 0;
  let sansNet = 0;
  let avecNet = 0;
  for (const l of lignes) {
    // Une ligne payée sur place au prestataire n'a ni vente ni net chez nous : sa commission se suit dans « Commissions à recevoir ».
    if (l.kind === "texte" || l.kind === "remise" || l.paye_sur_place) continue;
    if (l.net !== null && l.net !== undefined && (l.prestation_id || l.trajet_id)) {
      nets += Number(l.net) * (l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1);
      avecNet++;
    } else if (brut(l) > 0) sansNet++;
  }
  const vente = totalDocument !== undefined ? Number(totalDocument) : lignes.filter((l) => l.kind !== "texte" && l.kind !== "remise" && !l.paye_sur_place).reduce((s, l) => s + brut(l), 0);
  const marge = Math.round((vente - nets) * 100) / 100;
  return { vente, nets: Math.round(nets * 100) / 100, marge, pct: vente ? Math.round((marge / vente) * 100) : 0, avecNet, sansNet };
}

function ajouter(iso, n) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Numéros thaïlandais : « 081-9789025 » devient +66819789025 pour les liens d'appel et WhatsApp.
export function chiffres(numero) {
  const m = String(numero || "").match(/\+?\d[\d\s\-()]{6,}\d/);
  if (!m) return "";
  let d = m[0].replace(/[^\d+]/g, "");
  if (d[0] !== "+" && d[0] === "0") d = `+66${d.slice(1)}`;
  return d;
}

// Numéro WhatsApp d'un partenaire : le premier marqué WhatsApp, sinon le premier numéro.
export function telWhatsApp(p) {
  const t = (p && p.contact && p.contact.telephones) || [];
  const w = t.find((x) => x.whatsapp) || t[0];
  return w ? w.numero : "";
}

// Commissions et mode de paiement d'un partenaire : données privées (migration 16), réservées à qui voit les nets (`prive` est alors renseigné).
// Avant la migration, elles sont encore dans les règles publiques : on les lit de là pour ne rien faire disparaître.
// `autorise` : la personne a le droit de voir les nets (sans lui, rien n'est rendu). Par défaut, `prive` renseigné.
export const commissionsPartenaire = (p, prive, autorise = !!prive) => (!autorise ? [] : prive && Array.isArray(prive.commissions) && prive.commissions.length ? prive.commissions : (p.regles && p.regles.commissions) || []);
export const paiementPartenaire = (p, prive, autorise = !!prive) => (!autorise ? "" : (prive && prive.paiement) || (p.regles && p.regles.paiement) || "");
