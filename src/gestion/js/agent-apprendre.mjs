// L'agent apprend des corrections (20.11.2026, migration 54). Quand la personne change une proposition de l'agent avant de la valider
// (heure de pickup, libellé, prix de vente, lieu, date, texte de la réponse au client), la différence est gardée par entreprise et relue par
// l'agent comme exemple dans les conversations suivantes (supabase/functions/agent/prompt.js, blocApprentissages).
// Ce qui ne part jamais : un net, une commission, une marge commerciale, une coordonnée bancaire (la correction entière est écartée), ni le nom, le
// téléphone ou l'e-mail d'un client (masqués avant l'écriture). « Marge » seule reste permise : c'est d'abord la marge de sécurité d'un
// pickup, ce que l'agent doit justement apprendre. Logique pure, testée (tests/gestion-agent-apprendre.test.js).
import { partModifiee } from "./assistant-suivi-calc.mjs";

export const MOT_INTERNE = /\b(?:nets?|commissions?|marges? commerciales?|prix d'achat|co[uû]t d'achat|cost price|net price|iban|swift|bic|compte bancaire|bank account|routing)\b/i;

const sansAccents = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const propre = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
const echapper = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Masque ce qui désigne un client : ses noms (ceux de la carte ou du dossier), un e-mail, un numéro de téléphone (7 chiffres ou plus), un lien,
// et le prénom après « Bonjour » ou « Hello ». Le reste du texte (lieux, heures, tournures) est ce qui sert d'exemple.
export function anonymiser(texte, noms = []) {
  let t = String(texte ?? "");
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "{e-mail}");
  t = t.replace(/https?:\/\/\S+/g, "{lien}");
  // Un numéro de 7 chiffres ou plus, sauf une date (20.11.2026, 2026-11-20).
  t = t.replace(/\+?\d[\d ().-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 && !/^\d{1,4}[./-]\d{1,2}[./-]\d{2,4}$/.test(m) ? "{téléphone}" : m));
  const mots = [...new Set(noms.flatMap((n) => String(n || "").split(/\s+/)).map((m) => m.replace(/[^\p{L}'-]/gu, "")).filter((m) => m.length >= 2))].sort((a, b) => b.length - a.length);
  for (const m of mots) t = t.replace(new RegExp(`(^|[^\\p{L}])${echapper(m)}(?=$|[^\\p{L}])`, "giu"), "$1{client}");
  t = t.replace(/\b(Bonjour|Bonsoir|Hello|Hi|Dear|Cher|Chère)\s+(?!\{)([\p{Lu}][\p{L}'-]+)/gu, "$1 {prénom}");
  return t;
}

const memeTexte = (a, b) => sansAccents(propre(a)).toLowerCase() === sansAccents(propre(b)).toLowerCase();
const nombre = (x) => (x === null || x === undefined || x === "" || Number.isNaN(Number(x)) ? null : Number(x));

// Les lignes d'un texte présentes d'un côté seulement : la réponse corrigée se garde par ses phrases changées, pas en entier.
function lignesChangees(avant, apres) {
  const decouper = (t) =>
    String(t || "")
      .split(/\n+|(?<=[.!?])\s+/)
      .map(propre)
      .filter(Boolean);
  const a = decouper(avant);
  const b = decouper(apres);
  const enlevees = a.filter((l) => !b.some((x) => memeTexte(x, l)));
  const ajoutees = b.filter((l) => !a.some((x) => memeTexte(x, l)));
  return { avant: enlevees.join(" / "), apres: ajoutees.join(" / ") };
}

const limiter = (t, n) => {
  const x = propre(t);
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};

function ligne(genre, contexte, avant, apres, noms) {
  const l = { genre, contexte: limiter(anonymiser(contexte, noms), 300), avant: limiter(anonymiser(avant, noms), 1500), apres: limiter(anonymiser(apres, noms), 1500) };
  if (MOT_INTERNE.test(`${l.contexte} ${l.avant} ${l.apres}`)) return null;
  if (memeTexte(l.avant, l.apres)) return null;
  return l;
}

// Le contexte d'un service : son libellé et, s'il y en a, son trajet ou son lieu de pickup.
const contexteService = (s) => [propre(s.libelle || s.texte), s.de && s.vers ? `${propre(s.de)} → ${propre(s.vers)}` : "", s.lieu_pickup ? `pickup ${propre(s.lieu_pickup)}` : ""].filter(Boolean).join(", ");

// Les écarts entre un service proposé (carte) et ce qui a été enregistré (réservation).
// `creation` : vrai pour un dossier créé par l'écran de création, qui écrit lui-même le libellé (titre du catalogue, trajet), le lieu de
// pickup (hôtel du client) et le prix d'une offre du catalogue (recalculé) : un écart n'y serait pas une correction de la personne. Seuls
// l'heure, la date et le prix d'un service hors catalogue (tapé par elle) comptent alors.
function ecartsService(s, r, noms, { creation = false } = {}) {
  if (!s || !r) return [];
  const ctx = contexteService(s);
  const out = [];
  if (s.heure_pickup && r.heure_pickup && s.heure_pickup !== String(r.heure_pickup).slice(0, 5)) out.push(ligne("pickup", ctx, s.heure_pickup, String(r.heure_pickup).slice(0, 5), noms));
  const libelle = propre(s.libelle || s.texte);
  if (!creation && libelle && propre(r.libelle) && !memeTexte(libelle, r.libelle)) out.push(ligne("libelle", s.de && s.vers ? `${propre(s.de)} → ${propre(s.vers)}` : "", libelle, r.libelle, noms));
  const pv = nombre(s.prix);
  const pr = nombre(r.montant_vente);
  if (pv !== null && pr !== null && pv !== pr && !(creation && s.offre)) out.push(ligne("prix", ctx, String(pv), String(pr), noms));
  if (!creation && s.lieu_pickup && r.lieu_pickup && !memeTexte(s.lieu_pickup, r.lieu_pickup)) out.push(ligne("lieu", propre(s.libelle || s.texte), s.lieu_pickup, r.lieu_pickup, noms));
  if (s.date && r.date_service && s.date !== r.date_service) out.push(ligne("date", ctx, s.date, r.date_service, noms));
  return out.filter(Boolean);
}

// Les réservations enregistrées face aux services de la carte : même date d'abord, puis le libellé le plus proche ; chacune ne sert qu'une fois.
export function apparier(services = [], reservations = []) {
  const restantes = [...reservations];
  const mots = (t) => new Set(sansAccents(t).toLowerCase().split(/[^a-z0-9]+/).filter((m) => m.length >= 3));
  return services.map((s) => {
    const m = mots(s.libelle || s.texte);
    const candidates = restantes.filter((r) => !s.date || !r.date_service || r.date_service === s.date);
    let meilleure = null;
    let score = -1;
    for (const r of candidates) {
      const sc = [...mots(r.libelle)].filter((x) => m.has(x)).length;
      if (sc > score) {
        score = sc;
        meilleure = r;
      }
    }
    if (meilleure) restantes.splice(restantes.indexOf(meilleure), 1);
    return meilleure;
  });
}

// Les corrections d'une carte validée. `enregistre` : ce qui a vraiment été enregistré (réservations du dossier créé, réservation ajoutée ou
// modifiée, texte copié). `noms` : les noms du client à masquer (pris aussi dans la carte). Rend une liste, vide si rien n'a changé.
export function correctionsDepuisCarte(carte, enregistre, { noms = [] } = {}) {
  if (!carte || !enregistre) return [];
  const d = carte.donnees || {};
  const masques = [...noms, d.client && d.client.nom].filter(Boolean);
  if (carte.genre === "dossier") {
    const services = d.services || [];
    const reservations = Array.isArray(enregistre.reservations) ? enregistre.reservations : [];
    const paires = apparier(services, reservations);
    return services.flatMap((s, i) => ecartsService(s, paires[i], masques, { creation: true }));
  }
  if (carte.genre === "reservation") return ecartsService(d.service || {}, enregistre.reservation, masques);
  if (carte.genre === "modification") {
    const r = enregistre.reservation;
    if (!r) return [];
    const champ = { heure_pickup: ["pickup", (x) => String(x.heure_pickup || "").slice(0, 5)], lieu_pickup: ["lieu", (x) => x.lieu_pickup], date: ["date", (x) => x.date_service] }[d.champ];
    if (!champ) return [];
    const l = ligne(champ[0], d.libelle || "", d.valeur, champ[1](r) || "", masques);
    return l ? [l] : [];
  }
  if (carte.genre === "reponse") {
    const avant = d.message || "";
    const apres = enregistre.message || "";
    if (!propre(apres) || partModifiee(avant, apres) === 0) return [];
    const ch = lignesChangees(avant, apres);
    if (!ch.avant && !ch.apres) return [];
    const l = ligne("reponse", d.langue === "en" ? "réponse en anglais" : "réponse en français", ch.avant, ch.apres, masques);
    return l ? [l] : [];
  }
  return [];
}

// Le dossier auquel relier la conversation après une validation : celui créé, ou celui de la carte (service ajouté ou modifié).
export function dossierDeLaCarte(carte, { dossierId = null } = {}) {
  if (dossierId) return dossierId;
  const d = (carte && carte.donnees) || {};
  return d.dossier_id || null;
}
