// L'agent apprend des corrections (20.11.2026, migration 54). Quand la personne change une proposition de l'agent avant de la valider
// (heure de pickup, libellé, prix de vente, lieu, date, texte de la réponse au client), la différence est gardée par entreprise et relue par
// l'agent comme exemple dans les conversations suivantes (supabase/functions/agent/prompt.js, blocApprentissages).
// Ce qui ne part jamais : un net, une commission, une marge commerciale, une coordonnée bancaire (la correction entière est écartée), ni le nom, le
// téléphone ou l'e-mail d'un client (masqués avant l'écriture). « Marge » seule reste permise : c'est d'abord la marge de sécurité d'un
// pickup, ce que l'agent doit justement apprendre. Logique pure, testée (tests/gestion-agent-apprendre.test.js).
// La partie texte (masquage, mots internes, phrases changées, « Pas bien ») est dans agent-apprendre-texte.mjs, copie identique de
// supabase/functions/agent/apprendre.js : la fonction « whatsapp » apprend de la même façon des réponses que Nani écrit autrement.
import { MOT_INTERNE, aMontant, anonymiser, correctionReponse, ligneApprise, memeTexte, propre } from "./agent-apprendre-texte.mjs";

export { MOT_INTERNE, anonymiser };

const sansAccents = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const limiterRemarque = (t) => (t.length > 300 ? `${t.slice(0, 299)}…` : t);
const nombre = (x) => (x === null || x === undefined || x === "" || Number.isNaN(Number(x)) ? null : Number(x));

// Le contexte d'un service : son libellé et, s'il y en a, son trajet ou son lieu de pickup.
const contexteService = (s) => [propre(s.libelle || s.texte), s.de && s.vers ? `${propre(s.de)} → ${propre(s.vers)}` : "", s.lieu_pickup ? `pickup ${propre(s.lieu_pickup)}` : ""].filter(Boolean).join(", ");

// Les écarts entre un service proposé (carte) et ce qui a été enregistré (réservation).
// `creation` : vrai pour un dossier créé par l'écran de création, qui écrit lui-même le libellé (titre du catalogue, trajet), le lieu de
// pickup (hôtel du client) et le prix d'une offre du catalogue (recalculé) : un écart n'y serait pas une correction de la personne. Seuls
// l'heure, la date et le prix d'un service hors catalogue (tapé par elle) comptent alors.
// `prixSaisi` (22.11.2026) : dans « Vérifier avant », la personne a remplacé le prix de l'offre par un prix à elle (prix convenu tapé,
// lignes prises à la main) : l'écran le dit (demande.mjs, prix_saisi) et l'écart compte. Un simple recalcul du catalogue ne compte pas.
// `ligne(genre, contexte, avant, apres)` : fabrique une ligne masquée (noms du client mot par mot, partenaires en entier).
function ecartsService(s, r, ligne, { creation = false, prixSaisi = false } = {}) {
  if (!s || !r) return [];
  const ctx = contexteService(s);
  const out = [];
  if (s.heure_pickup && r.heure_pickup && s.heure_pickup !== String(r.heure_pickup).slice(0, 5)) out.push(ligne("pickup", ctx, s.heure_pickup, String(r.heure_pickup).slice(0, 5)));
  const libelle = propre(s.libelle || s.texte);
  if (!creation && libelle && propre(r.libelle) && !memeTexte(libelle, r.libelle)) out.push(ligne("libelle", s.de && s.vers ? `${propre(s.de)} → ${propre(s.vers)}` : "", libelle, r.libelle));
  const pv = nombre(s.prix);
  const pr = nombre(r.montant_vente);
  if (pv !== null && pr !== null && pv !== pr && !(creation && s.offre && !prixSaisi)) out.push(ligne("prix", ctx, String(pv), String(pr)));
  if (!creation && s.lieu_pickup && r.lieu_pickup && !memeTexte(s.lieu_pickup, r.lieu_pickup)) out.push(ligne("lieu", propre(s.libelle || s.texte), s.lieu_pickup, r.lieu_pickup));
  if (s.date && r.date_service && s.date !== r.date_service) out.push(ligne("date", ctx, s.date, r.date_service));
  return out.filter(Boolean);
}

// Tous les nombres écrits d'un texte (séparateurs de milliers et décimales compris : « 1 200 », « 45.5 »), pour les comparer aux nets.
const nombresDe = (t) =>
  [...String(t || "").matchAll(/\d{1,3}(?:[ ,'’\u00a0\u202f]\d{3})+(?:[.,]\d{1,2}(?!\d))?(?!\d)|\d+(?:[.,]\d+)?/g)]
    .map((m) => {
      const x = m[0];
      const milliers = /^\d{1,3}(?:[ ,'’\u00a0\u202f]\d{3})+/.exec(x);
      return milliers ? Number(milliers[0].replace(/\D/g, "") + (x.length > milliers[0].length ? `.${x.slice(milliers[0].length + 1)}` : "")) : Number(x.replace(",", "."));
    })
    .filter((n) => n > 0);

// La ligne ajoutée aux notes qui est la remarque proposée, retouchée ou non : même texte, sinon celle qui reprend au moins 70 % des mots
// (trois lettres et plus) de la remarque proposée sans être plus de deux fois plus longue (« Vegan » ne garde pas « Vegan, diabète type 1,
// chambre au rez »). null sinon.
export function remarqueGardee(valeur, notesAvant, notesApres) {
  const avant = String(notesAvant || "").split(/\n+/).map(propre).filter(Boolean);
  const ajoutees = String(notesApres || "").split(/\n+/).map(propre).filter((x) => x && !avant.some((a) => memeTexte(a, x)));
  const meme = ajoutees.find((x) => memeTexte(x, valeur));
  if (meme) return meme;
  const mots = (t) => new Set(sansAccents(t).toLowerCase().split(/[^a-z0-9]+/).filter((m) => m.length >= 3));
  const cible = mots(valeur);
  if (!cible.size) return null;
  const part = (x) => [...cible].filter((m) => mots(x).has(m)).length / cible.size;
  const court = (x) => x.length <= 2 * propre(valeur).length + 10;
  return ajoutees.filter((x) => part(x) >= 0.7 && court(x)).sort((a, b) => part(b) - part(a))[0] || null;
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
// modifiée, texte copié). `noms` : les noms du client à masquer mot par mot (pris aussi dans la carte) ; `entiers` : les noms des
// partenaires et des contacts typés, masqués en entier ; `nets` : les nets du dossier (une remarque qui en cite un n'est pas apprise).
// Rend une liste, vide si rien n'a changé.
export function correctionsDepuisCarte(carte, enregistre, { noms = [], entiers = [], nets = new Set() } = {}) {
  if (!carte || !enregistre) return [];
  const d = carte.donnees || {};
  const masques = [...noms, d.client && d.client.nom].filter(Boolean);
  const ligne = (genre, contexte, avant, apres) => ligneApprise(genre, contexte, avant, apres, masques, entiers);
  if (carte.genre === "dossier") {
    const services = d.services || [];
    const reservations = Array.isArray(enregistre.reservations) ? enregistre.reservations : [];
    const paires = apparier(services, reservations);
    // Ce que l'écran de création a fait de chaque service (« Vérifier avant » seulement : rien d'un geste), apparié comme les réservations.
    const ecran = Array.isArray(enregistre.ecran) ? apparier(services, enregistre.ecran.map((f) => ({ ...f, libelle: f.titre || "", date_service: f.date || "" }))) : [];
    return services.flatMap((s, i) => ecartsService(s, paires[i], ligne, { creation: true, prixSaisi: !!(ecran[i] && ecran[i].prix_saisi === true) }));
  }
  if (carte.genre === "reservation") return ecartsService(d.service || {}, enregistre.reservation, ligne);
  if (carte.genre === "modification") {
    const r = enregistre.reservation;
    if (!r) return [];
    // Une remarque (migration 74) : elle s'ajoute aux notes du service. Seule compte la ligne ajoutée qui est la remarque proposée retouchée :
    // même texte, ou au moins 70 % des mots de la remarque proposée (revue de la PR 312). Les autres notes du service, réécrites dans le
    // formulaire, ne partent jamais (notes internes, chambre, santé). Une remarque qui porte un montant, ou un nombre égal à un net du
    // dossier (`nets`), n'est pas apprise. Sans les notes d'avant (`notesAvant`), rien.
    if (d.champ === "remarque") {
      if (typeof enregistre.notesAvant !== "string") return [];
      const gardee = remarqueGardee(d.valeur, enregistre.notesAvant, r.notes);
      if (!gardee || aMontant(gardee) || aMontant(d.valeur) || nombresDe(`${gardee} ${d.valeur}`).some((n) => nets.has(n))) return [];
      const l = ligne("remarque", d.libelle || "", d.valeur, limiterRemarque(gardee));
      return l ? [l] : [];
    }
    const champ = { heure_pickup: ["pickup", (x) => String(x.heure_pickup || "").slice(0, 5)], lieu_pickup: ["lieu", (x) => x.lieu_pickup], date: ["date", (x) => x.date_service] }[d.champ];
    if (!champ) return [];
    const l = ligne(champ[0], d.libelle || "", d.valeur, champ[1](r) || "");
    return l ? [l] : [];
  }
  if (carte.genre === "reponse") {
    const l = correctionReponse(d.message || "", enregistre.message || "", { noms: masques, entiers, contexte: d.langue === "en" ? "réponse en anglais" : "réponse en français" });
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
