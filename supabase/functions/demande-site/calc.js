// Fonction publique « demande-site » : la logique pure (origine admise, lecture et contrôle de la demande, texte de la notification).
// Aucune dépendance : le même fichier sert à la fonction Supabase et aux tests (tests/gestion-demandes-site.test.js).
// Contrat avec le site : docs/gestion/demandes-site.md.

export const TAILLE_MAX = 4096; // octets du corps : une demande en fait moins de 1 500 avec son message
export const LIMITE_APPAREIL = { nombre: 5, minutes: 10 }; // 5 demandes en 10 minutes par appareil (empreinte d'IP)
export const LIMITE_TOTALE = { nombre: 300, minutes: 60 }; // garde-fou par organisation : au-delà, son site est attaqué, pas visité

// Site de l'organisation qui reçoit les demandes : celui d'Anaïs par défaut, un autre client pose SITE_ORIGINES (adresses séparées par des virgules).
export const ORIGINES_DEFAUT = ["https://secrettravelandtour.com", "https://www.secrettravelandtour.com"];
// Pages privées du carnet de ZTP (zwaldtravelplanner.com/carnet/…) : les clients d'Anaïs y réservent une sortie directement. Même organisation
// (Zwald), mais seulement l'entreprise « secret » : une demande venue de ces pages avec une autre marque (« taxi ») est refusée. Ces adresses sont dans
// le code, pas dans SITE_ORIGINES : ce réglage appartient à l'autre client du logiciel, et elles ne comptent que pour l'organisation Zwald.
export const ORGANISATION_ZWALD = "00000000-0000-0000-0000-00000000a000";
export const ORIGINES_CARNET = ["https://zwaldtravelplanner.com", "https://www.zwaldtravelplanner.com"];
export const MARQUES_CARNET = ["secret"];
export const origineCarnet = (origine) => ORIGINES_CARNET.includes(origine);
// Une page du carnet : sur l'origine d'un site de ZTP ET sous le chemin « /carnet/ » (le chemin seul ne suffit pas : une page /carnet/ du site Secret n'en est pas une).
// Seule définition (la fonction, la notification) ; l'outil en garde une copie, CHEMIN_CARNET et ORIGINES_CARNET de src/gestion/js/carnet-produits.mjs,
// que tests/gestion-carnet-produits.test.js tient égales.
export const CHEMIN_CARNET = "/carnet/";
export const estPageCarnet = (url) => {
  try {
    const u = new URL(String(url));
    return ORIGINES_CARNET.includes(u.origin) && u.pathname.startsWith(CHEMIN_CARNET);
  } catch {
    return false;
  }
};
// Les origines admises d'une organisation : les siennes (SITE_ORIGINES ou le site d'Anaïs), plus celles du carnet pour Zwald seulement.
export const originesAdmises = (origines, organisation = ORGANISATION_ZWALD) => (organisation === ORGANISATION_ZWALD ? [...new Set([...origines, ...ORIGINES_CARNET])] : origines);
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const ORIGINE = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:\d{1,5})?$/;

// Lit SITE_ORIGINES : seules les adresses https complètes, sans chemin, sont gardées. Rien de valable donne le site d'Anaïs.
export function lireOrigines(brut) {
  const liste = String(brut || "").split(",").map((x) => x.trim().toLowerCase().replace(/\/+$/, "")).filter((x) => ORIGINE.test(x));
  return liste.length ? [...new Set(liste)] : ORIGINES_DEFAUT;
}

// Origines admises : le site, et la machine de développement pour les essais.
export const origineAdmise = (origine, origines = ORIGINES_DEFAUT) => !!origine && (origines.includes(origine) || LOCAL.test(origine));

// Une marque est le slug d'une entreprise qui publie sur le site (même forme que entites.slug et la contrainte de demandes_site).
// Son existence est vérifiée par la fonction dans la base (entites.publie_site de l'organisation), pas ici.
export const MARQUE = /^[a-z0-9-]{1,40}$/;

// Texte propre : sans caractère de contrôle (le retour à la ligne est gardé là où il est permis), espaces en trop retirés, longueur bornée.
const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g;
function texte(v, max, { lignes = false } = {}) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" && typeof v !== "number") throw erreur("type");
  let s = String(v).replace(CONTROLE, "").replace(/\r\n?/g, "\n");
  s = lignes ? s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim() : s.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > max) throw erreur("trop_long");
  return s;
}
function entier(v, min, max) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw erreur("nombre");
  return n;
}
function erreur(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// Date au format AAAA-MM-JJ, réelle, entre hier et dans 400 jours (heure de Bangkok).
export function dateValide(iso, aujourdhui) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return false;
  const jours = (d - new Date(`${aujourdhui}T00:00:00Z`)) / 86400000;
  return jours >= -1 && jours <= 400;
}

// Numéro WhatsApp du client au format international E.164 (« +41791234567 ») : ce que la feuille envoie, mis au propre.
// Espaces, tirets, points, barres et parenthèses retirés ; « 00 » devant devient « + » ; le « (0) » des numéros écrits « +41 (0)79 … » tombe.
// Un numéro national (commence par 0, ou sans indicatif) n'est accepté qu'avec l'indicatif du pays (`indicatif`, champ « whatsapp_country ») :
// le 0 de tête est alors retiré, sauf pour l'Italie (+39) qui le garde. Sans indicatif, on ne devine pas le pays.
// Ne lève jamais d'erreur : une demande n'est pas perdue pour un numéro mal tapé. Renvoie { telephone, telephone_saisi } :
// le numéro E.164, ou null et ce qui a été saisi (40 caractères au plus) pour qu'Anaïs le voie.
export function telephoneE164(brut, indicatif) {
  if (brut === undefined || brut === null || brut === "" || (typeof brut !== "string" && typeof brut !== "number")) return { telephone: null, telephone_saisi: null };
  const saisi = String(brut).replace(CONTROLE, "").replace(/\s+/g, " ").trim();
  if (!saisi) return { telephone: null, telephone_saisi: null };
  // Coupé par caractère, pas par unité UTF-16 : un émoji coupé en deux rendrait le texte invalide pour la base, et la demande serait perdue.
  const illisible = { telephone: null, telephone_saisi: Array.from(saisi).slice(0, 40).join("") };
  let n = saisi.replace(/^tel:/i, "").replace(/^(\+|00)\s*(\d{1,3})\s*\(0\)/, "$1$2").replace(/[\s.\-()/\u00A0]/g, "");
  if (!/^\+?\d+$/.test(n)) return illisible;
  if (n.startsWith("00")) n = `+${n.slice(2)}`;
  else if (!n.startsWith("+")) {
    const pays = String(indicatif ?? "").replace(/^(\+|00)/, "").trim();
    if (!/^[1-9]\d{0,2}$/.test(pays)) return illisible;
    n = `+${pays}${pays === "39" ? n : n.replace(/^0/, "")}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(n) ? { telephone: n, telephone_saisi: null } : illisible;
}

const champ = (nom, f) => {
  try {
    return f();
  } catch (e) {
    e.champ = nom;
    throw e;
  }
};

// Lit le corps reçu (texte JSON) et renvoie la ligne à écrire, ou lève une erreur avec `code` et `champ`.
// `piege: true` : le champ piège (« website ») est rempli, c'est un robot ; l'appelant répond « ok » sans rien écrire.
// `origines` : les adresses du site de l'organisation (SITE_ORIGINES ou le site d'Anaïs), pas celles du carnet. `origine` : l'origine de la requête.
// Une requête d'une page du carnet de ZTP n'écrit que dans l'entreprise « secret » (MARQUES_CARNET) et doit dire une page « /carnet/… » de sa propre origine ;
// sa page_url n'est jamais comparée aux adresses du site Secret, ni celle d'une requête du site Secret à celles du carnet.
export function lireDemande(corps, { aujourdhui, origines = ORIGINES_DEFAUT, origine = null }) {
  if (typeof corps !== "string" || !corps) throw erreur("vide");
  if (new TextEncoder().encode(corps).length > TAILLE_MAX) throw erreur("trop_gros");
  let d;
  try {
    d = JSON.parse(corps);
  } catch {
    throw erreur("json");
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) throw erreur("json");
  if (d.website) return { piege: true };
  const marque = typeof d.brand === "string" && MARQUE.test(d.brand) ? d.brand : null;
  if (!marque || (origineCarnet(origine) && !MARQUES_CARNET.includes(marque))) throw Object.assign(erreur("marque"), { champ: "brand" });
  const produitId = champ("product_id", () => texte(d.product_id, 60));
  if (!produitId || !/^[a-z0-9-]{1,60}$/.test(produitId)) throw Object.assign(erreur("produit"), { champ: "product_id" });
  const ref = champ("ref", () => texte(d.ref, 24));
  if (ref && !/^[A-Z0-9-]{3,24}$/.test(ref)) throw Object.assign(erreur("format"), { champ: "ref" });
  const date = champ("date", () => texte(d.date, 10));
  if (date && !dateValide(date, aujourdhui)) throw Object.assign(erreur("date"), { champ: "date" });
  const heure = champ("time", () => texte(d.time, 5));
  if (heure && !/^([01]\d|2[0-3]):[0-5]\d$/.test(heure)) throw Object.assign(erreur("format"), { champ: "time" });
  const adultes = champ("adults", () => entier(d.adults, 0, 60));
  const enfants = champ("children", () => entier(d.children, 0, 60));
  const total = d.estimated_total === undefined || d.estimated_total === null || d.estimated_total === "" ? null : Number(d.estimated_total);
  if (total !== null && !(Number.isFinite(total) && total >= 0 && total <= 10000000)) throw Object.assign(erreur("nombre"), { champ: "estimated_total" });
  const devise = champ("currency", () => texte(d.currency, 3)) || "THB";
  if (!/^[A-Z]{3}$/.test(devise)) throw Object.assign(erreur("format"), { champ: "currency" });
  // L'adresse de la page n'est gardée que si elle est sur le site (ou la machine de développement) : on n'enregistre pas un lien choisi par un tiers.
  const page = champ("page_url", () => texte(d.page_url, 300));
  const carnet = origineCarnet(origine);
  // La page est gardée si elle est sur l'origine de la requête (les adresses du site pour une requête sans origine, comme les essais) ; sinon elle est mise de côté.
  const pageUrl = page && pageDuSite(page, carnet ? [origine] : origines) && (!origine || memeOrigine(page, origine)) ? page : null;
  // Depuis le carnet, la page est obligatoire : une page « /carnet/… » de la requête elle-même, sinon refus (400 sur page_url).
  if (carnet && !(pageUrl && estPageCarnet(pageUrl) && new URL(pageUrl).origin === origine)) throw Object.assign(erreur("page"), { champ: "page_url" });
  return {
    marque,
    ref,
    produit_id: produitId,
    produit: champ("product", () => texte(d.product, 120)),
    option_id: champ("option", () => texte(d.option, 80)),
    option_titre: champ("option_label", () => texte(d.option_label, 120)),
    date_service: date,
    heure,
    adultes,
    enfants,
    pickup: champ("pickup", () => texte(d.pickup, 200)),
    nom: champ("name", () => texte(d.name, 120)),
    ...telephoneE164(d.whatsapp, d.whatsapp_country),
    total_estime: total === null ? null : Math.round(total * 100) / 100,
    devise,
    page_url: pageUrl,
    message: champ("message", () => texte(d.message, 2000, { lignes: true })),
  };
}

// Adresse d'une page du site : une origine admise suivie d'un chemin (ou de rien), sans espace.
const memeOrigine = (page, origine) => {
  try {
    return new URL(page).origin === origine;
  } catch {
    return false;
  }
};
function pageDuSite(page, origines) {
  const m = /^(https?:\/\/[^/?#\s]+)([/?#][^\s]*)?$/.exec(page);
  return !!m && origineAdmise(m[1], origines);
}

// Adresse IP du visiteur. D'abord celle que pose Cloudflare (cf-connecting-ip) ou la passerelle (x-real-ip), que le visiteur ne peut pas choisir ;
// x-forwarded-for en dernier recours seulement, car son premier maillon peut être écrit par le client lui-même.
export function adresseIP(entetes) {
  const brut = entetes.get("cf-connecting-ip") || entetes.get("x-real-ip") || (entetes.get("x-forwarded-for") || "").split(",")[0];
  return String(brut || "").trim().slice(0, 64);
}

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// Notification envoyée à l'équipe : la sortie, les personnes, le jour. Jamais le nom ni l'hôtel du client (elle passe par Apple et Google).
// « 4 Islands, 2 adultes, mardi 18 » ; le mois est ajouté quand la date n'est pas dans les 30 prochains jours.
// Le titre nomme l'entreprise qui reçoit la demande (entites.nom), pour qu'une organisation à plusieurs marques sache laquelle.
export function notification(ligne, aujourdhui, entreprise = "") {
  const morceaux = [ligne.produit || ligne.produit_id];
  if (ligne.option_titre) morceaux[0] += ` (${ligne.option_titre})`;
  const personnes = [ligne.adultes ? pluriel(ligne.adultes, "adulte", "adultes") : "", ligne.enfants ? pluriel(ligne.enfants, "enfant", "enfants") : ""].filter(Boolean).join(", ");
  if (personnes) morceaux.push(personnes);
  if (ligne.date_service) {
    const d = new Date(`${ligne.date_service}T00:00:00Z`);
    const ecart = (d - new Date(`${aujourdhui}T00:00:00Z`)) / 86400000;
    const mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"][d.getUTCMonth()];
    morceaux.push(ecart === 0 ? "aujourd'hui" : ecart === 1 ? "demain" : `${JOURS[d.getUTCDay()]} ${d.getUTCDate()}${ecart < 0 || ecart > 30 ? ` ${mois}` : ""}`);
  }
  // Une demande d'une page du carnet de ZTP le dit en tête du texte (la notification va à l'équipe seulement).
  if (estPageCarnet(ligne.page_url)) morceaux.unshift("Carnet ZTP");
  return { titre: entreprise ? `Nouvelle demande ${entreprise}` : "Nouvelle demande du site", corps: morceaux.join(", "), tag: `demande-site-${ligne.marque}` };
}

// Personnes qui reçoivent la notification d'une demande : celles qui lisent les demandes de cette entreprise (même règle que la base,
// lit_demandes_site : voir tous les dossiers, sans l'écran « Nouveau voucher » seul). Un super administrateur les reçoit toutes.
export function destinataires({ entiteId, profils, membres, roles }) {
  const roleDe = new Map(roles.map((r) => [r.id, r]));
  return profils
    .filter((p) => p.actif)
    .filter((p) => {
      if (p.super_admin) return true;
      const m = membres.find((x) => x.user_id === p.user_id && x.entite_id === entiteId);
      const r = m && roleDe.get(m.role_id);
      const perms = (r && r.permissions) || [];
      return !!r && r.portee === "toute" && perms.includes("dossiers.lire") && !perms.includes("vouchers.seul");
    })
    .map((p) => p.user_id);
}

// Réponses : un code court en anglais pour le site (il ne les montre pas), jamais le détail interne.
export const REPONSES = {
  ok: { status: 202, corps: { ok: true } },
  origine: { status: 403, corps: { ok: false, error: "origin" } },
  methode: { status: 405, corps: { ok: false, error: "method" } },
  type: { status: 415, corps: { ok: false, error: "content_type" } },
  trop_gros: { status: 413, corps: { ok: false, error: "too_large" } },
  limite: { status: 429, corps: { ok: false, error: "rate_limited" } },
  captcha: { status: 403, corps: { ok: false, error: "turnstile" } },
  serveur: { status: 500, corps: { ok: false, error: "server" } },
};
export const reponseInvalide = (e) => ({ status: 400, corps: { ok: false, error: "invalid", ...(e.champ ? { field: e.champ } : {}) } });

// Décide où écrire une demande valide : limite par appareil, limite de l'organisation (ses demandes seulement), puis marque.
// entites : celles de l'organisation qui publient sur le site ({ id, nom, slug }). Renvoie { reponse } pour refuser, sinon { entite }.
export function choisirEntite({ marque, entites, appareil = 0, organisation = 0 }) {
  if (appareil >= LIMITE_APPAREIL.nombre || organisation >= LIMITE_TOTALE.nombre) return { reponse: REPONSES.limite };
  const entite = (entites || []).find((e) => e.slug === marque);
  return entite ? { entite } : { reponse: reponseInvalide({ champ: "brand" }) };
}
