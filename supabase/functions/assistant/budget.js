// Plafond mensuel de l'assistant IA (20.11.2026) : la dépense du mois, toutes entreprises et tous usages confondus (fonction « assistant » et
// fonction « agent »), comparée au plafond que règle Jérémy (table assistant_budget, migration 54 ; 50 $ par défaut, pour un crédit API de 200 $).
// À 80 % du plafond, une alerte part chez les administrateurs (fonction « rappels », type « budget ») ; à 100 %, l'assistant refuse avec un
// message clair. Logique pure, sans dépendance : utilisée par les fonctions agent, assistant et rappels, et par les tests node.

export const PLAFOND_DEFAUT_USD = 50;
export const SEUIL_DEFAUT_PCT = 80;
export const PLAFOND_MAX_USD = 1000;

const DECALAGE_BANGKOK = 7 * 3600 * 1000;
const jourBangkok = (ms) => new Date(ms + DECALAGE_BANGKOK).toISOString().slice(0, 10);

// Début du mois à Bangkok, en heure UTC (ISO) : la dépense se compte depuis cet instant.
export const debutMois = (maintenant = Date.now()) => new Date(Date.parse(`${jourBangkok(maintenant).slice(0, 8)}01T00:00:00Z`) - DECALAGE_BANGKOK).toISOString();
// Le mois (AAAA-MM) et le jour où l'assistant reprend s'il est arrêté : le 1er du mois suivant, à Bangkok.
export const moisBangkok = (maintenant = Date.now()) => jourBangkok(maintenant).slice(0, 7);
export function reprise(maintenant = Date.now()) {
  const [a, m] = moisBangkok(maintenant).split("-").map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, "0")}-01`;
}

// Le plafond lu en base (ligne de assistant_budget, ou null tant que la migration manque), sinon le secret de la fonction, sinon 50 $.
export function plafondRetenu(ligne, secret) {
  const p = ligne && Number(ligne.plafond_mois_usd);
  const s = Number(secret);
  const plafond = p > 0 ? p : s > 0 ? s : PLAFOND_DEFAUT_USD;
  const seuil = Number(ligne && ligne.seuil_alerte_pct);
  return { plafond: Math.min(plafond, PLAFOND_MAX_USD), seuil: seuil >= 50 && seuil <= 99 ? seuil : SEUIL_DEFAUT_PCT };
}

// Où en est le mois : part dépensée (en %), alerte (seuil passé) et plafond atteint.
export function etatBudget({ cout, plafond, seuil = SEUIL_DEFAUT_PCT }) {
  const c = Math.max(0, Number(cout) || 0);
  const p = Number(plafond) > 0 ? Number(plafond) : PLAFOND_DEFAUT_USD;
  const pct = Math.floor((c / p) * 100);
  return { cout: Math.round(c * 100) / 100, plafond: p, seuil, pct, alerte: pct >= seuil, atteint: c >= p };
}

// Les alertes à envoyer au plus une fois : le seuil du mois, le plafond du mois, et le crédit d'Anthropic épuisé (une fois par jour).
// La clé sert de verrou en base (assistant_alertes) : deux appels en même temps n'envoient qu'une notification. Elle porte le plafond : un
// plafond relevé en cours de mois peut de nouveau prévenir à 80 % du nouveau montant.
export function alertesBudget({ cout, plafond, seuil = SEUIL_DEFAUT_PCT, creditEpuise = false, maintenant = Date.now() }) {
  const e = etatBudget({ cout, plafond, seuil });
  const mois = moisBangkok(maintenant);
  const liste = [];
  if (creditEpuise) liste.push({ cle: `credit:${jourBangkok(maintenant)}`, niveau: "credit" });
  if (e.atteint) liste.push({ cle: `${mois}:100:${e.plafond}`, niveau: "plafond" });
  else if (e.alerte) liste.push({ cle: `${mois}:${seuil}:${e.plafond}`, niveau: "seuil" });
  return liste;
}

const usd = (x, langue) => `${Number(x).toLocaleString(langue === "en" ? "en-US" : "fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

// Le texte de la notification, sans aucun nom de client : seulement des montants.
export function messageBudget(niveau, { cout, plafond, pct, langue = "fr", maintenant = Date.now() }) {
  const en = langue === "en";
  const jour = reprise(maintenant).split("-").reverse().slice(0, 2).join(".");
  if (niveau === "credit")
    return en
      ? { title: "Assistant: Anthropic credit used up", body: "Anthropic refuses the assistant's requests: the API credit is empty. Top it up in the Anthropic console." }
      : { title: "Assistant : crédit Anthropic épuisé", body: "Anthropic refuse les demandes de l'assistant : le crédit API est vide. À recharger dans la console Anthropic." };
  if (niveau === "plafond")
    return en
      ? { title: "Assistant: monthly cap reached", body: `${usd(cout, "en")} spent this month, cap ${usd(plafond, "en")}. The assistant is paused until ${jour}, unless the cap is raised.` }
      : { title: "Assistant : plafond du mois atteint", body: `${usd(cout)} dépensés ce mois-ci pour un plafond de ${usd(plafond)}. L'assistant s'arrête jusqu'au ${jour}, sauf si le plafond est relevé.` };
  return en
    ? { title: `Assistant: ${pct}% of the monthly cap`, body: `${usd(cout, "en")} spent this month out of ${usd(plafond, "en")}. At ${usd(plafond, "en")} the assistant stops until ${jour}.` }
    : { title: `Assistant : ${pct} % du plafond du mois`, body: `${usd(cout)} dépensés ce mois-ci sur ${usd(plafond)}. À ${usd(plafond)}, l'assistant s'arrête jusqu'au ${jour}.` };
}

// Anthropic refuse faute de crédit : erreur de facturation (HTTP 402, type « billing_error »), ou l'ancien 400 « credit balance is too low ».
export function estCreditEpuise(err) {
  if (!err || typeof err !== "object") return false;
  const corps = err.error && typeof err.error === "object" ? err.error : {};
  const type = err.type || (corps.error && corps.error.type) || corps.type || "";
  if (err.status === 402 || type === "billing_error") return true;
  return /credit balance is too low|purchase credits|billing/i.test(String(err.message || ""));
}

// Destinataires de l'alerte : les administratrices générales et, dans chaque entreprise, les rôles qui administrent et lisent le journal.
export function destinatairesBudget({ profils = [], membres = [], roles = [] }) {
  const roleDe = new Map(roles.map((r) => [r.id, r]));
  const admin = (m) => {
    const r = roleDe.get(m.role_id);
    if (!r) return false;
    const p = r.permissions || [];
    return r.tous_droits === true || (p.includes("reglages.ecrire") && p.includes("journal.voir"));
  };
  const ids = new Set();
  for (const p of profils) if (p.actif && p.super_admin) ids.add(p.user_id);
  for (const m of membres) if (admin(m) && profils.some((p) => p.user_id === m.user_id && p.actif)) ids.add(m.user_id);
  return [...ids];
}
