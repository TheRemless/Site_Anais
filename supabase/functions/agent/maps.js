// Liens Google Maps d'une conversation (relecture de Jérémy, 22.11.2026) : Nani envoie souvent la dépose du client par un lien
// court (« https://maps.app.goo.gl/… ») et l'Assistant écrivait « Krabi Town (logement du client, lien Booking) » au lieu de l'établissement.
// Le serveur lit le lien sans clé ni API : un GET sans suivre la redirection sur le lien court rend un `Location` du type
// « https://maps.google.com?q=<nom> <adresse> » ou « …/maps/place/<nom>/@… ». Le nom (la partie avant le numéro et l'adresse) est donné au
// modèle à la place du lien, qui écrit le nom dans le champ du lieu (vers pour une dépose, lieu_pickup ou de pour une prise en charge).
//
// Sécurité : seuls les hôtes de Google sont appelés (pas de SSRF), à chaque saut, toujours en https ; trois sauts au plus, 3 secondes par
// appel, aucun en-tête de la personne, aucun cookie, aucun corps lu. Par échange (sessionMaps) : 6 liens au plus, 8 secondes en tout, un
// cache url → résultat. Un échec ne lève jamais : le lien est marqué « non lu », et la carte avertit.

// L'alternative la plus longue d'abord (« co.th », « com.au » avant « com »), puis rien qui prolonge l'hôte (relecture de la PR 329).
const TLD_GOOGLE = "(?:co\\.[a-z]{2}|com\\.[a-z]{2}|com|[a-z]{2})(?![\\w.-])";
// Un lien Google Maps dans un texte, avec ou sans « https:// » : le lien court de l'application, l'ancien goo.gl/maps, maps.google.*,
// google.*/maps.
const LIEN_MAPS = new RegExp(
  `(?<![\\w.@/-])(?:https?://)?(?:maps\\.app\\.goo\\.gl/[\\w-]+|goo\\.gl/maps/[\\w-]+|maps\\.google\\.${TLD_GOOGLE}(?:/[^\\s<>"'()]*)?|(?:www\\.)?google\\.${TLD_GOOGLE}/maps[^\\s<>"'()]*)(?:\\?[^\\s<>"'()]*)?`,
  "gi",
);
export const LIENS_MAX = 3;
export const LIENS_ECHANGE_MAX = 6;
export const ECHEANCE_MS = 8000;
export const DELAI_MS = 3000;
const SAUTS_MAX = 3;
const NOM_MAX = 80;
const ADRESSE_MAX = 120;

// Toujours en https : « http:// » devient « https:// », un lien sans schéma le reçoit.
export const enHttps = (url) => String(url || "").replace(/^http:\/\//i, "https://").replace(/^(?!https:\/\/)/i, "https://");
// Un hôte de Google pour Maps : seuls ceux-là sont appelés.
export function hoteGoogle(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password || u.port) return false;
  const h = u.hostname.toLowerCase();
  if (h === "maps.app.goo.gl") return true;
  if (h === "goo.gl") return u.pathname.startsWith("/maps/");
  return new RegExp(`^(?:www\\.|maps\\.)?google\\.${TLD_GOOGLE}$`).test(h);
}
const court = (u) => {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h === "maps.app.goo.gl" || h === "goo.gl";
  } catch {
    return false;
  }
};

// Les liens Maps d'un texte, sans doublon, dans l'ordre (la ponctuation finale ne compte pas).
export function liensMaps(texte) {
  const vus = [];
  for (const m of String(texte || "").matchAll(LIEN_MAPS)) {
    const url = m[0].replace(/[.,;:!?…]+$/, "");
    if (hoteGoogle(enHttps(url)) && !vus.includes(url)) vus.push(url);
  }
  return vus;
}

// Un nom ou une adresse lus chez Google reviennent au modèle : seulement des lettres (thaï compris, avec ses voyelles et tons), des chiffres,
// l'espace et « - & . ' / , » (relecture de la PR 329 : « » », « ) » ou « : » auraient pu fermer la note et y glisser une consigne).
const propre = (s, n) => String(s || "").normalize("NFC").replace(/[^\p{L}\p{M}\p{N} \-&.'/,]/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);
// Des coordonnées seules (« 7.53,99.04 ») ne donnent pas d'établissement.
const coordonnees = (s) => /^\s*-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\s*$/.test(s);
// Les repères thaïs d'une adresse : ตำบล (ต.), อำเภอ (อ.), ถนน (ถ.), หมู่, ซอย, จังหวัด.
const REPERE_ADRESSE = /^(?:ต\.|อ\.|ถ\.|จ\.|ตำบล|อำเภอ|ถนน|หมู่|ซอย|จังหวัด|moo|soi|road|rd\.?|tambon|amphoe)$/i;

// « บ้านตัวอย่าง 99 1 ต.ตัวอย่าง เมือง Krabi 81000, Thailand » donne { nom: « บ้านตัวอย่าง », adresse: « 99 1 ต.ตัวอย่าง … Thailand » } ;
// « Resort Exemple, 123 Moo 2, Saladan » donne le nom avant la virgule. Le nom s'arrête au premier mot qui commence par un
// chiffre ou à un repère d'adresse, jamais sur le premier mot (« 7-Eleven »).
export function nomEtAdresse(q) {
  const brut = propre(q, 400);
  if (!brut || coordonnees(brut)) return null;
  const virgule = brut.indexOf(",");
  const tete = virgule >= 0 ? brut.slice(0, virgule) : brut;
  const mots = tete.split(" ");
  let fin = mots.length;
  for (let i = 1; i < mots.length; i++) {
    if (/^\d/.test(mots[i]) || REPERE_ADRESSE.test(mots[i]) || /^(?:ต|อ|ถ|จ)\./.test(mots[i])) {
      fin = i;
      break;
    }
  }
  const nom = propre(mots.slice(0, fin).join(" "), NOM_MAX);
  if (!nom || /^\d+$/.test(nom)) return null;
  const adresse = propre(brut.slice(nom.length).replace(/^[\s,]+/, ""), ADRESSE_MAX);
  return { nom, adresse };
}

// Le lieu dit par une adresse longue de Google Maps : le paramètre q (ou query), sinon /maps/place/<nom>/ ou /maps/search/<nom>/.
export function lieuDepuisUrl(url) {
  if (!hoteGoogle(url)) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const q = u.searchParams.get("q") || u.searchParams.get("query") || "";
  if (q && !/^https?:/i.test(q)) {
    const r = nomEtAdresse(q);
    if (r) return r;
  }
  const m = u.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/);
  if (m) {
    let v = m[1];
    try {
      v = decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      return null;
    }
    return nomEtAdresse(v);
  }
  return null;
}

// Résout un lien : { url, nom, adresse } ou { url, nom: null }. `fetchImpl` : fetch (les tests en donnent un faux). Jamais d'exception.
export async function resoudreLienMaps(url, { fetchImpl = globalThis.fetch, delai = DELAI_MS } = {}) {
  const vide = { url, nom: null };
  try {
    let actuel = enHttps(url);
    for (let saut = 0; saut <= SAUTS_MAX; saut++) {
      if (!hoteGoogle(actuel)) return vide;
      const lu = lieuDepuisUrl(actuel);
      if (lu) return { url, ...lu };
      if (saut === SAUTS_MAX || typeof fetchImpl !== "function") return vide;
      // Seul un lien court se suit : une page longue sans q ni place n'apprend rien de plus.
      if (!court(actuel) && saut === 0) return vide;
      const r = await fetchImpl(actuel, { method: "GET", redirect: "manual", credentials: "omit", headers: { Accept: "text/html" }, signal: AbortSignal.timeout(delai) });
      try {
        await r.body?.cancel?.();
      } catch {
        // rien
      }
      const loc = r.headers && typeof r.headers.get === "function" ? r.headers.get("location") : null;
      if (!loc || r.status < 300 || r.status >= 400) return vide;
      actuel = enHttps(new URL(loc, actuel).toString());
    }
    return vide;
  } catch {
    return vide;
  }
}

// La note posée à la place du lien pour le modèle : le lien lui-même n'est jamais rendu (il ne doit jamais finir dans une carte).
export function noteLieu(r) {
  if (!r || !r.nom) return "(lien Google Maps non lu : demande l'établissement à Nani)";
  return `(lien Google Maps : établissement « ${r.nom} »${r.adresse ? `, adresse « ${r.adresse} »` : ""})`;
}
// Le texte avec ses liens Maps remplacés par leur note. `resolus` : les résultats de resoudreLienMaps.
export function annoterTexte(texte, resolus = []) {
  let t = String(texte || "");
  for (const r of resolus) if (r && r.url) t = t.split(r.url).join(noteLieu(r));
  return t;
}
// Résout les liens d'un texte (LIENS_MAX au plus, en parallèle) : { texte, lieux }. `options.session` (sessionMaps) : plafond, échéance et
// cache de l'échange ; un lien au-delà, ou après l'échéance, est marqué « non lu » sans appel.
export async function annoterLiensMaps(texte, options = {}) {
  const liens = liensMaps(texte).slice(0, LIENS_MAX);
  if (!liens.length) return { texte: String(texte || ""), lieux: [] };
  const session = options.session || null;
  const un = (u) => {
    if (!session) return resoudreLienMaps(u, options);
    if (session.cache.has(u)) return session.cache.get(u);
    const reste = session.echeance - session.maintenant();
    if (session.restants <= 0 || reste <= 0) return Promise.resolve({ url: u, nom: null });
    session.restants--;
    const p = resoudreLienMaps(u, { ...options, delai: Math.min(options.delai || DELAI_MS, reste) });
    session.cache.set(u, p);
    return p;
  };
  const lieux = await Promise.all(liens.map(un));
  return { texte: annoterTexte(texte, lieux), lieux };
}
// La session d'un échange : LIENS_ECHANGE_MAX liens réseau au plus, ECHEANCE_MS en tout, un cache url → résultat (un même lien lu deux fois
// n'est appelé qu'une fois). Rend la fonction (texte) => { texte, lieux }.
export function sessionMaps({ max = LIENS_ECHANGE_MAX, totalMs = ECHEANCE_MS, maintenant = () => Date.now(), ...options } = {}) {
  const session = { cache: new Map(), restants: max, echeance: maintenant() + totalMs, maintenant };
  return (texte) => annoterLiensMaps(texte, { ...options, session });
}

// ---- Garde de la carte ---------------------------------------------------------------------------------------------------------------
// Un lieu de carte qui porte un lien (Maps ou autre) : le lien est remplacé par l'établissement lu, sinon retiré. `lieux` : ceux lus dans
// cet échange. Rend { valeur, lien } ; `lien` : un lien était là.
// Une URL avec schéma, en « www. », ou un domaine suivi d'un chemin (« goo.gl/x », « maps.app.goo.gl/x », « booking.com/hotel », « bit.ly/x »).
const UNE_URL = /(?:\b(?:https?:\/\/|www\.)|(?<![\w@.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?=\/))[^\s<>"']+/gi;
export const contientLien = (t) => new RegExp(UNE_URL.source, "i").test(String(t || ""));
export function lieuSansLien(valeur, lieux = []) {
  const v = String(valeur || "");
  if (!contientLien(v)) return { valeur: v, lien: false };
  let t = v;
  for (const r of lieux) if (r && r.url && r.nom) t = t.split(r.url).join(r.nom);
  t = t.replace(UNE_URL, " ").replace(/\s*[:(]\s*\)?\s*$/, "").replace(/\s+/g, " ").trim();
  return { valeur: t, lien: true };
}
// Une remarque ou une note sans aucun lien.
export const sansLiens = (t) => String(t || "").replace(UNE_URL, " ").replace(/\s+([.,;:!?])/g, "$1").replace(/[:\s]+$/, "").replace(/\s+/g, " ").trim();
