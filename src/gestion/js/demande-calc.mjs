// Demande d'un client reçue par WhatsApp : lecture du message que rédigent les formulaires des sites Secret et Taxi, propositions de prix
// d'après la base partenaires, et réponse prête à envoyer. Logique pure, testée avec node --test.
// Rien n'est inventé : un prix vient d'une ligne de la base, et sans correspondance on propose seulement de chercher à la main.
import { sansAccents, trajetDisponible, libelleUnite, libelleClient } from "./partenaires-calc.mjs";
import { dateTexte, personnesTexte } from "./operations-calc.mjs";

const MOIS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (a, m, j) => `${a}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
const jourPlus = (isoDate, n) => new Date(Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);

// « Fri 12 Dec 2026 », « Tomorrow (Fri 12 Dec) », « Today (Mon 9 Nov) » : la date ISO, l'année manquante étant la prochaine occurrence.
export function lireDate(texte, aujourdhui) {
  const m = /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(20\d\d))?/i.exec(String(texte || ""));
  if (!m) return "";
  const mois = MOIS.indexOf(m[2].toLowerCase()) + 1;
  const jour = Number(m[1]);
  let annee = m[3] ? Number(m[3]) : Number(aujourdhui.slice(0, 4));
  let resultat = iso(annee, mois, jour);
  if (!m[3] && resultat < jourPlus(aujourdhui, -7)) resultat = iso(++annee, mois, jour);
  const d = new Date(`${resultat}T00:00:00Z`);
  return d.getUTCMonth() + 1 === mois && d.getUTCDate() === jour ? resultat : "";
}

const entier = (v) => (Number(v) > 0 ? Math.floor(Number(v)) : 0);

// Lit le message d'un formulaire. Renvoie null si le texte ne ressemble à aucune demande.
export function lireDemande(texte, aujourdhui) {
  const lignes = String(texte || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lignes.length) return null;
  const d = { marque: "", type: "", nom: "", prestation: "", de: "", vers: "", date: "", dateTexte: "", heure: "", adultes: 0, enfants: 0, bebes: 0, vehicule: "", mode: "", siegeEnfant: false, siegeBebe: false, hotel: "" };
  for (const l of lignes) {
    let m;
    if ((m = /^hi\s+(.+?)\s*!?$/i.exec(l))) d.marque = m[1].replace(/!$/, "").trim();
    else if (/price for a transfer/i.test(l)) d.type = "transfer";
    else if ((m = /boat tour:\s*(.+?)\.?$/i.exec(l))) (d.type = "boat"), (d.prestation = m[1].trim());
    else if ((m = /an activity:\s*(.+?)\.?$/i.exec(l))) (d.type = "activity"), (d.prestation = m[1].trim());
    else if ((m = /^name:\s*(.*)$/i.exec(l))) d.nom = m[1].trim();
    else if ((m = /^from:\s*(.*)$/i.exec(l))) d.de = m[1].trim();
    else if ((m = /^to:\s*(.*)$/i.exec(l))) d.vers = m[1].trim();
    else if ((m = /^date:\s*(.*)$/i.exec(l))) (d.dateTexte = m[1].trim()), (d.date = lireDate(m[1], aujourdhui));
    else if ((m = /^pickup time:\s*(.*)$/i.exec(l))) d.heure = m[1].trim();
    else if ((m = /^adults:\s*(\d+)/i.exec(l))) d.adultes = entier(m[1]);
    else if ((m = /^children[^:]*:\s*(\d+)/i.exec(l))) d.enfants = entier(m[1]);
    else if ((m = /^babies[^:]*:\s*(\d+)/i.exec(l))) d.bebes = entier(m[1]);
    else if ((m = /^people:\s*(\d+)/i.exec(l))) d.adultes = entier(m[1]);
    else if ((m = /^hotel[^:]*:\s*(.*)$/i.exec(l))) d.hotel = m[1].trim();
    else if (/child seat needed/i.test(l)) d.siegeEnfant = true;
    else if (/baby seat needed/i.test(l)) d.siegeBebe = true;
    else if (/join-in/i.test(l)) d.mode = "join";
    else if (/^(shared|private)\b/i.test(l)) {
      d.mode = /^shared/i.test(l) ? "shared" : "private";
      d.vehicule = /speedboat/i.test(l) ? "speedboat" : /minivan/i.test(l) ? "minivan" : "";
    } else if (/^private boat/i.test(l)) d.mode = "private";
  }
  return d.type || d.de || d.vers || d.prestation ? d : null;
}

// ---- Propositions de prix --------------------------------------------------------------------------------------------
const MOTS_VIDES = new Set(["the", "a", "an", "and", "to", "from", "of", "with", "in", "at", "de", "du", "la", "le", "les", "et", "en", "tour", "trip", "airport", "pier"]);
// Passage de l'anglais du formulaire au français de la base, pour les mots qui reviennent le plus.
const SYNONYMES = { islands: "iles", island: "ile", boat: "bateau", sunset: "coucher", mangroves: "mangrove", diving: "plongee", scuba: "plongee", cooking: "cuisine", elephant: "elephant", rental: "location", scooter: "scooter" };
const mots = (texte) =>
  sansAccents(texte)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((m) => m && !MOTS_VIDES.has(m))
    .map((m) => SYNONYMES[m] || m);
const recouvrement = (cherche, texte) => {
  const a = mots(cherche);
  if (!a.length) return 0;
  const t = new Set(mots(texte));
  return a.filter((m) => t.has(m) || [...t].some((x) => x.length > 3 && m.length > 3 && (x.startsWith(m) || m.startsWith(x)))).length / a.length;
};

// Prix total d'une prestation selon son unité. Les bébés ne comptent pas. `null` : prix à définir ou à payer sur place.
export function prixPrestation(p, { adultes, enfants }) {
  if (p.sur_place || p.prix_vente === null || p.prix_vente === undefined) return null;
  const prix = Number(p.prix_vente);
  switch (p.unite) {
    case "pp": return prix * (adultes + enfants);
    case "ad": return prix * adultes;
    case "ch": return prix * enfants;
    default: return prix; // par bateau, véhicule, groupe, session, jour : un seul prix
  }
}

export function prixTrajet(t, { adultes, enfants }) {
  const adulte = Number(t.prix_adulte);
  if (t.prix_adulte === null || t.prix_adulte === undefined || Number.isNaN(adulte)) return { total: null, avertissement: "prix_a_definir" };
  const enfantPrix = t.prix_enfant === null || t.prix_enfant === undefined ? null : Number(t.prix_enfant);
  if (enfants > 0 && enfantPrix === null) return { total: adulte * adultes, avertissement: "sans_tarif_enfant" };
  return { total: adulte * adultes + (enfantPrix || 0) * enfants, avertissement: "" };
}

// Offres de la base qui correspondent à la demande, la plus proche en premier. Au plus six.
// `nomPartenaire(id)` renvoie le nom du partenaire.
export function proposerOffres(d, { prestations = [], trajets = [], nomPartenaire = () => "" } = {}) {
  const pax = { adultes: d.adultes || (d.enfants ? 0 : 1), enfants: d.enfants };
  const offres = [];
  if (d.type === "transfer" || (d.de && d.vers)) {
    for (const t of trajets) {
      if (t.actif === false || (d.date && !trajetDisponible(t, d.date))) continue;
      const direct = Math.min(recouvrement(d.de, t.de), recouvrement(d.vers, t.vers));
      const inverse = Math.min(recouvrement(d.de, t.vers), recouvrement(d.vers, t.de));
      let score = Math.max(direct, inverse);
      if (score < 0.5) continue;
      if (inverse > direct) score -= 0.1;
      const mode = sansAccents(t.mode);
      if (d.vehicule === "speedboat") score += /speed|bateau|boat|ferry/.test(mode) ? 0.3 : -0.6;
      if (d.vehicule === "minivan") score += /van|minibus|voiture|car|taxi/.test(mode) ? 0.3 : -0.6;
      // Le véhicule demandé écarte les autres : un minivan ne se propose pas en speedboat.
      if (score < 0.5) continue;
      if (d.mode === "shared" && /partag|shared/.test(mode)) score += 0.1;
      if (d.mode === "private" && /priv/.test(mode)) score += 0.1;
      const { total, avertissement } = prixTrajet(t, pax);
      offres.push({ genre: "trajet", id: t.id, source: t, titre: `${t.de} → ${t.vers}${t.depart ? `, ${t.depart}` : ""}`, detail: [t.mode, nomPartenaire(t.partenaire_id)].filter(Boolean).join(" · "), total, avertissement, score });
    }
    for (const p of prestations) {
      if (p.actif === false || p.famille !== "transfert") continue;
      const texte = `${p.libelle} ${p.libelle_en || ""} ${p.groupe || ""}`;
      const score = Math.min(recouvrement(d.de, texte), recouvrement(d.vers, texte));
      if (score < 0.5) continue;
      offres.push({ genre: "prestation", id: p.id, source: p, titre: p.libelle_en || libelleClient(p.libelle), detail: [libelleUnite(p.unite, true), nomPartenaire(p.partenaire_id)].filter(Boolean).join(" · "), total: prixPrestation(p, pax), avertissement: p.sur_place ? "sur_place" : "", score });
    }
  } else if (d.prestation) {
    for (const p of prestations) {
      if (p.actif === false) continue;
      const texte = `${p.libelle} ${p.libelle_en || ""} ${p.groupe || ""}`;
      let score = recouvrement(d.prestation, texte);
      if (score < 0.5) continue;
      const groupe = sansAccents(p.groupe || p.libelle);
      if (d.mode === "join") score += /join|collectif|partag/.test(groupe) ? 0.2 : -0.1;
      if (d.mode === "private") score += /priv/.test(groupe) ? 0.2 : -0.1;
      offres.push({ genre: "prestation", id: p.id, source: p, titre: p.libelle_en || libelleClient(p.libelle), detail: [p.groupe, libelleUnite(p.unite, true), nomPartenaire(p.partenaire_id)].filter(Boolean).join(" · "), total: prixPrestation(p, pax), avertissement: p.sur_place ? "sur_place" : "", score });
    }
  }
  return offres.sort((a, b) => b.score - a.score || (a.total ?? Infinity) - (b.total ?? Infinity)).slice(0, 6);
}

// ---- Réponse au client ---------------------------------------------------------------------------------------------
const prenomDe = (nom) => (nom || "").trim().split(/\s+/)[0] || "";
const nombre = (n) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

// Texte anglais à envoyer au client : ce qui a été demandé, le prix de la base, et la question de la réservation. Rien d'autre.
export function reponsePrix(d, offre, { devise = "THB" } = {}) {
  const prenom = prenomDe(d.nom);
  const lignes = [`Hello${prenom ? ` ${prenom}` : ""},`, ""];
  lignes.push(offre.titre);
  if (d.date) lignes.push(`Date: ${dateTexte(d.date, "en")}`);
  if (d.heure) lignes.push(`Pickup time: ${d.heure}`);
  const gens = personnesTexte({ adultes: d.adultes, enfants: d.enfants, bebes: d.bebes }, "en");
  if (gens) lignes.push(`People: ${gens}`);
  if (offre.total !== null && offre.total !== undefined) lignes.push(`Price: ${devise} ${nombre(offre.total)}`);
  lignes.push("", "Would you like me to book it?");
  return lignes.join("\n");
}

// Notes internes d'un dossier créé depuis une demande : ce que le client a demandé et qui n'a pas de champ à lui.
export function notesDemande(d) {
  return [d.heure ? `Pickup time: ${d.heure}` : "", d.siegeEnfant ? "Child seat needed" : "", d.siegeBebe ? "Baby seat needed" : "", d.bebes ? `Babies (0-2): ${d.bebes}` : ""].filter(Boolean).join(". ");
}

// Prénom et nom d'un nom saisi sur le site (« Anna Keller ») : le premier mot est le prénom, le reste le nom.
export function separerNom(nom) {
  const m = (nom || "").trim().split(/\s+/).filter(Boolean);
  return m.length <= 1 ? { prenom: "", nom: m[0] || "" } : { prenom: m[0], nom: m.slice(1).join(" ") };
}
