// Agent de Gestion : l'Assistant donne les vouchers (21.11.2026, demande de Jérémy). Un outil de lecture, trouver_vouchers, sans aucun appel
// à l'IA : il retrouve les réservations visées (par client, date, heure ou dossier) ; l'écran en fait une carte « Voucher » par dossier, avec
// l'aperçu en image fabriqué dans le navigateur (voucher-envoi.mjs, imageVoucher) et le bouton d'envoi habituel (envoyerVoucher).
// Logique pure, sans dépendance : le même fichier sert à la fonction « agent » (supabase/functions/agent/vouchers.js), à la démonstration et
// aux cartes de l'écran (src/gestion/js/agent-vouchers.mjs). Un test vérifie que les deux copies sont identiques.
//
// Règles tenues ici, en plus de la base (les lignes arrivent lues avec la session de la personne, sous les règles RLS) :
//   - Secret et Taxi seulement (fonctionnement « excursions » ou « taxi ») : ZTP (« sur_mesure ») n'a pas de voucher, l'outil n'existe pas ;
//   - les droits de l'écran Réservations et du bouton voucher : lire les dossiers. Le droit « vouchers.seul » (Mook dans Taxi, écran voucher
//     thaï à part) ne donne rien ici : ni outil, ni ligne de cette entreprise ;
//   - en espace unifié, une ligne d'une entreprise où la personne n'a pas ces droits est écartée (permises) ;
//   - ce qui repart chez Claude : référence, date, heure, service, prénom et nom du client, dossier, ce qui manque au voucher. Jamais un net,
//     une commission, un prix ni le nom du prestataire (retiré du libellé du service) ;
//   - 20 réservations au plus.

export const NOM_OUTIL_VOUCHERS = "trouver_vouchers";
export const VOUCHERS_MAX = 20;
export const FONCTIONNEMENTS_VOUCHER = ["excursions", "taxi"];

const S = (description) => ({ type: "string", description });
export const OUTIL_VOUCHERS = {
  name: NOM_OUTIL_VOUCHERS,
  description:
    "Retrouve les vouchers (Booking confirmation chez Taxi) des réservations demandées : par client (nom, prénom ou référence), par jour, par heure de pickup ou par dossier. Rend 20 réservations au plus : référence, date, heure, service, client, dossier, et ce qui manque au voucher (a_completer). L'écran montre aussitôt une carte par dossier avec l'aperçu du voucher et le bouton d'envoi : ne recopie pas le voucher, dis en une ou deux lignes ce que tu as trouvé et ce qui manque. Rien ne part sans le clic de la personne.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["client", "date", "heure", "dossier"],
    properties: {
      client: S("Nom, prénom ou référence du client tel que demandé (« Leonie Ahmadi »), ou \"\"."),
      date: S("« aujourdhui », « demain », AAAA-MM-JJ, ou \"\". Pour « la course de 14 h » sans jour, \"\" : l'outil prend aujourd'hui."),
      heure: S("Heure de pickup demandée, HH:MM (« 14:00 »), ou \"\"."),
      dossier: S("Référence D-… ou numéro du dossier (« 2026-0142 »), ou \"\"."),
    },
  },
};

// ---- Droits -------------------------------------------------------------------------------------------------------------------------
// Lire les réservations d'une entreprise comme l'écran Réservations et le bouton voucher : Secret ou Taxi, « dossiers.lire » (que
// « dossiers.ecrire » suppose), jamais avec « vouchers.seul ».
export function vouchersPermis({ fonctionnement = "", permissions = [] } = {}) {
  const p = Array.isArray(permissions) ? permissions : [];
  return FONCTIONNEMENTS_VOUCHER.includes(fonctionnement) && (p.includes("dossiers.lire") || p.includes("dossiers.ecrire")) && !p.includes("vouchers.seul");
}

// ---- Petits outils ------------------------------------------------------------------------------------------------------------------
export const sansAccentsV = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const texte = (x, max = 160) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
export const refCourte = (genre, id) => `${genre}-${String(id || "").replace(/-/g, "").slice(0, 8)}`;
const prefixe = (ref, genres = "RDC") => {
  const m = new RegExp(`^([${genres}])-([0-9a-f]{8})$`, "i").exec(String(ref || "").trim());
  return m ? { genre: m[1].toUpperCase(), p: m[2].toLowerCase() } : null;
};
const commence = (id, p) => String(id || "").replace(/-/g, "").toLowerCase().startsWith(p);
const dateValide = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const decaler = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Le jour demandé : « aujourdhui », « demain », « après-demain », « hier », ou AAAA-MM-JJ. "" si rien, null si illisible.
export function dateVoucher(valeur, aujourdhui) {
  const v = sansAccentsV(valeur).replace(/[^a-z0-9-]+/g, "");
  if (!v) return "";
  if (dateValide(v)) return v;
  if (!dateValide(aujourdhui)) return null;
  const n = { aujourdhui: 0, today: 0, demain: 1, tomorrow: 1, apresdemain: 2, "apres-demain": 2, hier: -1, yesterday: -1 }[v];
  return n === undefined ? null : decaler(aujourdhui, n);
}
// L'heure demandée : « 14:00 », « 14h30 », « 14 h », « 14 ». { heure: "HH:MM" | "", minutes: vrai si les minutes sont données }, null si illisible.
export function heureVoucher(valeur) {
  const v = String(valeur || "").trim();
  if (!v) return { heure: "", minutes: false };
  const m = /^(\d{1,2})\s*(?:[:h.]\s*(\d{2})?)?\s*(?:h)?$/i.exec(v);
  if (!m || Number(m[1]) > 23 || (m[2] && Number(m[2]) > 59)) return null;
  return { heure: `${m[1].padStart(2, "0")}:${m[2] || "00"}`, minutes: !!m[2] };
}
const heureDe = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};

// Les mots d'un nom de client, sans civilité (« Mme Ahmadi » = « Ahmadi »).
const CIVILITES = new Set(["m", "mr", "mrs", "ms", "mme", "mlle", "miss", "monsieur", "madame", "mademoiselle", "famille", "family", "client", "cliente"]);
const motsClient = (t) =>
  sansAccentsV(t)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 2 && !CIVILITES.has(w));

// Les noms des prestataires retirés d'un libellé (« 4 Islands by Satun Speedboat » → « 4 Islands ») : aucun nom de compagnie ne part.
function sansNoms(t, noms) {
  const echappe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (noms || [])
    .filter((n) => typeof n === "string" && n.trim().length > 2)
    .sort((a, b) => b.length - a.length)
    .reduce((acc, n) => acc.replace(new RegExp(echappe(n.trim()), "gi"), " "), String(t || ""))
    .replace(/\s+/g, " ")
    .replace(/^[\s,·+-]+|[\s,·+-]+$/g, "")
    .replace(/\s+(?:by|par|with|avec|chez|from)$/i, "")
    .trim();
}

// Un service sans voucher, comme l'écran (operations-calc.mjs, modeleChoisi et typeVoucherDeduit) : « Pas de voucher » choisi sur la
// réservation, ou, sans modèle choisi, des frais, un supplément ou une option (notés sur le voucher du tour). L'écran refait le contrôle.
function sansVoucher(r, p) {
  const m = r.modele_voucher || (r.details && r.details.modele_voucher) || "";
  if (m === "aucun") return true;
  if (m || r.trajet_id || !p) return false;
  return p.famille === "frais" || p.unite === "sup" || /^option|supplément|supplement|extension|\bextra (?:dive|person)\b/i.test(`${p.groupe || ""} ${p.libelle || ""}`);
}

// Ce qui manque à un voucher, dit à Claude (l'écran refait le contrôle complet, controlesVoucher) : la date, l'heure et le lieu de pickup.
const aCompleter = (r) => [!r.date_service && "date", !heureDe(r.heure_pickup) && "heure_pickup", !texte(r.lieu_pickup, 200) && "lieu_pickup"].filter(Boolean);

// ---- L'outil ------------------------------------------------------------------------------------------------------------------------
// `e` : l'entrée contrôlée (client, date, heure, dossier). Les lignes lues : reservations, dossiers, clients. `aujourdhui` : AAAA-MM-JJ à
// Koh Lanta. `permises` : les entreprises où la personne lit les vouchers (Set d'identifiants), null pour ne pas filtrer (essais).
// `marque(entiteId)` : le champ « entreprise » d'une ligne en espace unifié ({} sinon). `noms` : les noms des prestataires à retirer.
// `prestations` : { id, famille, unite, groupe, libelle } des services, pour écarter ceux qui n'ont pas de voucher.
// Rend { resultat } ; resultat.reservations est ce que l'écran transforme en cartes (groupesVouchers).
export function criteresVouchers(e = {}, aujourdhui = "") {
  const date = dateVoucher(e.date, aujourdhui);
  if (date === null) return { erreur: "date_illisible" };
  const h = heureVoucher(e.heure);
  if (h === null) return { erreur: "heure_illisible" };
  const client = texte(e.client, 120);
  const dossier = texte(e.dossier, 40);
  if (!client && !dossier && !date && !h.heure) return { erreur: "critere_manquant" };
  // « la course de 14 h » sans jour ni client : celle d'aujourd'hui.
  const supposee = !date && !!h.heure && !client && !dossier && dateValide(aujourdhui);
  return { client, dossier, date: supposee ? aujourdhui : date, heure: h.heure, minutes: h.minutes, date_supposee: supposee };
}

export function trouverVouchers(e = {}, { reservations = [], dossiers = [], clients = [], prestations = [], aujourdhui = "", permises = null, marque = () => ({}), noms = [] } = {}) {
  const c = criteresVouchers(e, aujourdhui);
  if (c.erreur) return { resultat: { erreur: c.erreur, ...(c.erreur === "critere_manquant" ? { conseil: "Demande à la personne quel client, quel jour, quelle heure ou quel dossier." } : {}) } };
  const parDossier = new Map((dossiers || []).filter(Boolean).map((d) => [d.id, d]));
  const parClient = new Map((clients || []).filter(Boolean).map((x) => [x.id, x]));
  const parPrestation = new Map((prestations || []).filter(Boolean).map((x) => [x.id, x]));
  const refClient = c.client ? prefixe(c.client) : null;
  const mots = refClient ? [] : motsClient(c.client);
  const refDossier = c.dossier ? prefixe(c.dossier, "D") : null;
  const lisibles = (reservations || []).filter((r) => {
    if (!r || r.statut === "annule" || sansVoucher(r, parPrestation.get(r.prestation_id))) return false;
    if (permises && !permises.has(r.entite_id)) return false;
    const d = parDossier.get(r.dossier_id);
    if (!d || d.annule) return false;
    if (c.date && r.date_service !== c.date) return false;
    if (c.dossier) {
      if (refDossier ? !commence(d.id, refDossier.p) : sansAccentsV(d.ref).trim() !== sansAccentsV(c.dossier).trim()) return false;
    }
    if (c.client) {
      const cl = parClient.get(d.client_id) || {};
      if (refClient) {
        const id = { R: r.id, D: d.id, C: cl.id }[refClient.genre];
        if (!commence(id, refClient.p)) return false;
      } else {
        const t = sansAccentsV([cl.prenom, cl.nom, d.ref].join(" "));
        if (!mots.length || !mots.every((m) => t.includes(m))) return false;
      }
    }
    return true;
  });
  // L'heure : la même heure exacte d'abord ; sinon (ou « 14 h » sans minutes), toute la même heure.
  let trouves = lisibles;
  if (c.heure) {
    const exactes = lisibles.filter((r) => heureDe(r.heure_pickup) === c.heure);
    trouves = exactes.length && c.minutes ? exactes : lisibles.filter((r) => heureDe(r.heure_pickup).slice(0, 2) === c.heure.slice(0, 2));
  }
  trouves = [...trouves].sort(
    (a, b) =>
      String(a.date_service || "9999").localeCompare(String(b.date_service || "9999")) ||
      (heureDe(a.heure_pickup) || "99").localeCompare(heureDe(b.heure_pickup) || "99") ||
      String((parDossier.get(a.dossier_id) || {}).ref || "").localeCompare(String((parDossier.get(b.dossier_id) || {}).ref || "")) ||
      String(a.id).localeCompare(String(b.id))
  );
  const lignes = trouves.slice(0, VOUCHERS_MAX).map((r) => {
    const d = parDossier.get(r.dossier_id);
    const cl = parClient.get(d.client_id) || {};
    const manque = aCompleter(r);
    return {
      reservation: refCourte("R", r.id),
      date: r.date_service || "",
      heure_pickup: heureDe(r.heure_pickup),
      service: sansNoms(texte(r.libelle, 160), noms),
      client: texte([cl.prenom, cl.nom].filter(Boolean).join(" "), 80),
      dossier: refCourte("D", d.id),
      reference: texte(d.ref, 30),
      ...marque(r.entite_id),
      ...(manque.length ? { a_completer: manque } : {}),
    };
  });
  const cartes = new Set(lignes.map((l) => l.dossier)).size;
  return {
    resultat: {
      nombre: trouves.length,
      ...(c.date ? { date: c.date } : {}),
      ...(c.date_supposee ? { date_supposee: "aujourdhui" } : {}),
      ...(c.heure ? { heure: c.heure } : {}),
      reservations: lignes,
      ...(trouves.length > VOUCHERS_MAX ? { tronque: true } : {}),
      ...(lignes.length ? { cartes_affichees: cartes } : { conseil: "Aucune réservation ne correspond (les services annulés, les frais et les options n'ont pas de voucher). Vérifie le nom, le jour ou l'heure avec la personne." }),
    },
    heures: lignes.map((l) => l.heure_pickup).filter(Boolean),
  };
}

// ---- Pour l'écran -------------------------------------------------------------------------------------------------------------------
// Les cartes : une par dossier, dans l'ordre du résultat ; une réservation seule fait une carte à elle seule.
export function groupesVouchers(resultat) {
  const lignes = resultat && Array.isArray(resultat.reservations) ? resultat.reservations : [];
  const groupes = new Map();
  for (const l of lignes) {
    if (!l || typeof l.reservation !== "string" || typeof l.dossier !== "string") continue;
    if (!groupes.has(l.dossier)) groupes.set(l.dossier, { dossier: l.dossier, reference: l.reference || "", client: l.client || "", entreprise: l.entreprise || "", reservations: [] });
    groupes.get(l.dossier).reservations.push(l);
  }
  return [...groupes.values()];
}
// La réservation d'une référence courte R-… parmi les lignes chargées par l'écran ; à préfixe égal (très rare), celle du même jour.
export function reservationDeRef(ref, reservations = [], date = "") {
  const p = prefixe(ref, "R");
  if (!p) return null;
  const memes = (reservations || []).filter((r) => r && commence(r.id, p.p));
  return memes.length > 1 ? memes.find((r) => r.date_service === date) || null : memes[0] || null;
}
