// Logique pure des opérations : réservations auprès des partenaires, messages types, dû aux partenaires.
// Aucune dépendance au navigateur pour pouvoir la tester avec node --test.

export const STATUTS_RESERVATION = { a_demander: "À demander", demande: "Demandée", confirme: "Confirmée", annule: "Annulée" };

const nouvelId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const brut = (l) => (l.unite !== null && l.unite !== undefined && l.unite !== "" && l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.unite) * Number(l.qte) : l.montant !== null && l.montant !== undefined && l.montant !== "" ? Number(l.montant) : null);

// Une réservation par ligne de partenaire du document, sauf celles qui existent déjà (même ligne).
// Le net prévu est renvoyé à part : il va dans la table protégée.
export function reservationsDepuisDocument(doc, { existantes = [], uid = nouvelId } = {}) {
  const deja = new Set(existantes.map((r) => r.ligne_id));
  const out = [];
  for (const l of (doc.contenu && doc.contenu.lignes) || []) {
    if (l.kind === "texte" || l.kind === "remise" || !(l.prestation_id || l.trajet_id) || deja.has(l.id)) continue;
    const qte = l.qte !== null && l.qte !== undefined && l.qte !== "" ? Number(l.qte) : 1;
    const enfant = /enfant|child/i.test(l.intro || "");
    out.push({
      reservation: { id: uid(), dossier_id: doc.dossier_id, ligne_id: l.id, prestation_id: l.prestation_id || null, trajet_id: l.trajet_id || null, partenaire_id: l.partenaire_id || null, libelle: l.libelle, date_service: l.date_service || null, heure_pickup: "", lieu_pickup: "", personnes: enfant ? { adultes: 0, enfants: qte, bebes: 0 } : { adultes: qte, enfants: 0, bebes: 0 }, statut: "a_demander", reference_partenaire: "", montant_vente: brut(l), notes: "" },
      net: l.net !== null && l.net !== undefined ? Math.round(Number(l.net) * qte * 100) / 100 : null,
    });
  }
  return out;
}

// « 2 adultes, 1 enfant », « 2 adults, 1 child », « ผู้ใหญ่ 2 คน เด็ก 1 คน ».
export function personnesTexte(p = {}, langue = "fr") {
  const a = Number(p.adultes) || 0;
  const e = Number(p.enfants) || 0;
  const b = Number(p.bebes) || 0;
  if (langue === "th") return [a ? `ผู้ใหญ่ ${a} คน` : "", e ? `เด็ก ${e} คน` : "", b ? `ทารก ${b} คน` : ""].filter(Boolean).join(" ");
  const en = langue === "en";
  const mot = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
  return [a ? mot(a, en ? "adult" : "adulte", en ? "adults" : "adultes") : "", e ? mot(e, en ? "child" : "enfant", en ? "children" : "enfants") : "", b ? mot(b, en ? "baby" : "bébé", en ? "babies" : "bébés") : ""].filter(Boolean).join(", ");
}

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function dateTexte(iso, langue = "fr") {
  if (!iso) return "";
  const [a, m, j] = iso.slice(0, 10).split("-").map(Number);
  if (langue === "th") return `${j}/${m}/${a}`;
  return langue === "en" ? `${j} ${MOIS_EN[m - 1]} ${a}` : `${j} ${MOIS_FR[m - 1]} ${a}`;
}

// Remplit les {variables} d'un gabarit ; une variable inconnue reste telle quelle, une variable vide disparaît.
export function remplirGabarit(texte, vars = {}) {
  return String(texte || "")
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? (vars[k] === null || vars[k] === undefined ? "" : String(vars[k])) : m))
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// Les variables d'un message à partir d'une réservation ou d'un dossier.
export function variablesMessage({ reservation = {}, client = {}, dossier = {}, partenaire = {}, entreprise = {}, langue = "fr" } = {}) {
  const nomClient = [client.prenom, client.nom].filter(Boolean).join(" ");
  return {
    client: nomClient,
    prenom: client.prenom || nomClient,
    date: dateTexte(reservation.date_service || dossier.date_depart, langue),
    hotel: reservation.lieu_pickup || (client.adresse || "").split("\n")[0] || "",
    heure: reservation.heure_pickup || "",
    a_heure: reservation.heure_pickup ? `${langue === "en" ? " at " : langue === "th" ? " เวลา " : " à "}${reservation.heure_pickup}` : "",
    personnes: personnesTexte(reservation.personnes, langue),
    prestation: reservation.libelle || "",
    partenaire: partenaire.nom || "",
    reference: reservation.reference_partenaire || dossier.ref || "",
    entreprise: entreprise.nom || "",
    telephone: entreprise.telephone || "",
  };
}

// Agenda : aujourd'hui, demain, et ce qui reste à confirmer, hors annulées. Trié par heure de pickup puis libellé.
export function agenda(reservations, ajd) {
  const demain = ajouterJours(ajd, 1);
  const actives = reservations.filter((r) => r.statut !== "annule");
  const tri = (a, b) => (a.date_service || "").localeCompare(b.date_service || "") || (a.heure_pickup || "99").localeCompare(b.heure_pickup || "99") || a.libelle.localeCompare(b.libelle);
  return {
    aujourdhui: actives.filter((r) => r.date_service === ajd).sort(tri),
    demain: actives.filter((r) => r.date_service === demain).sort(tri),
    aConfirmer: actives.filter((r) => r.statut !== "confirme" && (!r.date_service || r.date_service >= ajd)).sort(tri),
    enRetard: actives.filter((r) => r.statut !== "confirme" && r.date_service && r.date_service < ajd).sort(tri),
  };
}

// Dû aux partenaires : par partenaire et par mois du service, hors annulées. `netDe(r)` renvoie la ligne de nets ou null.
export function duParPartenaire(reservations, netDe) {
  const groupes = new Map();
  for (const r of reservations) {
    if (r.statut === "annule") continue;
    const mois = (r.date_service || "").slice(0, 7) || "sans-date";
    const cle = `${r.partenaire_id || ""}|${mois}`;
    const g = groupes.get(cle) || { partenaire_id: r.partenaire_id || null, mois, nb: 0, vente: 0, net_prevu: 0, net_paye: 0, sansNet: 0, reservations: [] };
    const n = netDe(r);
    g.nb++;
    g.vente += Number(r.montant_vente) || 0;
    if (n && n.net_prevu !== null && n.net_prevu !== undefined) g.net_prevu += Number(n.net_prevu);
    else g.sansNet++;
    if (n && n.net_paye !== null && n.net_paye !== undefined) g.net_paye += Number(n.net_paye);
    g.reservations.push(r);
    groupes.set(cle, g);
  }
  return [...groupes.values()]
    .map((g) => ({ ...g, vente: arr(g.vente), net_prevu: arr(g.net_prevu), net_paye: arr(g.net_paye), reste: arr(g.net_prevu - g.net_paye), marge: arr(g.vente - g.net_prevu) }))
    .sort((a, b) => b.mois.localeCompare(a.mois) || (b.reste - a.reste));
}

const arr = (n) => Math.round(n * 100) / 100;
export function ajouterJours(iso, n) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000);
  return d.toISOString().slice(0, 10);
}
export function nomMoisCourt(iso, langue = "fr") {
  if (!iso || iso === "sans-date") return langue === "en" ? "No date" : "Sans date";
  const [a, m] = iso.split("-").map(Number);
  const mois = langue === "en" ? MOIS_EN[m - 1] : MOIS_FR[m - 1];
  return `${mois.charAt(0).toUpperCase() + mois.slice(1)} ${a}`;
}
