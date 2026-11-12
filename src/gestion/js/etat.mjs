// État partagé : le magasin de données, la copie en mémoire des tables et l'entreprise active.
// `brut` contient tout ce que la base laisse voir à la personne connectée, `db` seulement l'entreprise active.
import { creerStore } from "./store.mjs";
import { resume, setDevise, setMasquerMontants, aujourdhui } from "./calc.mjs";
import { construireCopie, CLE_HORS_LIGNE } from "./feuille-hors-ligne-calc.mjs";
import { completerReglages, ROLES_SYSTEME } from "./defauts.mjs";
import { permissionsDans, roleDans } from "./droits.mjs";
import { entreprisesVisibles } from "./groupe.mjs";
import { fusionner, appliquerChoix } from "./conflit-calc.mjs";
import { tr, definirLangue, langueStockee, estLangue, pretLangue } from "./i18n.mjs";

const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue", "taches", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets"];
const CLE_ENTITE = "gestion-zwald-entite";

// `documentsOuverts` : documents en cours d'édition. La synchronisation ne leur retire pas leur copie en mémoire, l'éditeur en a besoin.
export const etat = { store: null, brut: null, db: null, session: null, moi: null, entiteId: null, documentsOuverts: new Set() };

export async function init() {
  // La langue de ce navigateur sert dès l'écran de connexion ; celle du compte la remplace après la connexion.
  const stockee = langueStockee();
  if (stockee) definirLangue(stockee);
  etat.store = await creerStore();
  etat.session = await etat.store.session();
  if (!etat.session) return void (await pretLangue());
  try {
    await recharger();
  } catch (err) {
    // Jeton expiré ou refusé : on repart de la page de connexion.
    if (!/jwt|token|auth|permission|401/i.test(err.message)) throw err;
    // Jeton refusé : la déconnexion ne doit pas empêcher d'afficher la page de connexion si le réseau échoue aussi.
    await etat.store.deconnecter().catch(() => {});
    etat.session = null;
  }
}

// Copie de la feuille d'aujourd'hui et de demain (sans montant, net ni commission) gardée sur ce téléphone pour être lue sans réseau (hors-ligne.html). Remplacée à chaque
// chargement et à chaque synchronisation, effacée à la déconnexion (store-supabase.mjs) et jamais lue après 48 h. Le stockage refusé ou plein n'empêche rien.
function copierPourHorsLigne() {
  if (etat.store.mode !== "supabase" || !etat.session || !etat.brut) return;
  try {
    const entites = entitesAccessibles().filter((e) => permissionsDans(contexte(), e.id).includes("dossiers.lire"));
    localStorage.setItem(CLE_HORS_LIGNE, JSON.stringify(construireCopie({ brut: etat.brut, entites, utilisateur: etat.session.id, aujourdhui: aujourdhui() })));
  } catch {
    // stockage refusé ou plein : l'outil fonctionne comme avant
  }
}

export async function recharger() {
  etat.brut = await etat.store.charger();
  etat.moi = etat.brut.profils.find((p) => p.user_id === etat.session.id) || { user_id: etat.session.id, email: etat.session.email, super_admin: false, actif: true };
  adopterLangue();
  await pretLangue();
  let choisi = null;
  try {
    choisi = localStorage.getItem(CLE_ENTITE);
  } catch {
    // stockage refusé : on prend la première entreprise
  }
  const ids = entitesAccessibles().map((e) => e.id);
  etat.entiteId = ids.includes(choisi) ? choisi : ids[0] || null;
  rebatir();
  copierPourHorsLigne();
  signature = signer(etat.brut);
  modificationsVues = modifications;
}

// ---- Synchronisation avec les autres personnes qui travaillent dans l'outil ------------------------------------
// Les données se lisent une fois à la connexion. `synchroniser` les relit en silence et dit si quelqu'un d'autre a changé
// quelque chose, pour que l'écran se mette à jour sans rechargement complet.
let modifications = 0; // nos propres écritures, pour ne pas annoncer comme venant d'ailleurs ce que nous venons de faire
let modificationsVues = 0;
let ecritures = 0;
// Toute écriture passe par là : tant qu'une est en cours, ou si une s'est terminée pendant une lecture, la lecture est écartée.
async function ecrire(fn) {
  modifications++;
  ecritures++;
  try {
    return await fn();
  } finally {
    ecritures--;
    modifications++;
  }
}
let signature = "";
let enCours = false;
// Documents et paiements se chargent à l'ouverture d'un dossier et ne font pas partie de la comparaison. L'ordre des lignes
// ne compte pas (deux lignes à égalité de tri peuvent permuter d'une lecture à l'autre).
const signer = (brut) =>
  JSON.stringify(
    Object.keys(brut)
      .filter((k) => k !== "documents" && k !== "paiements")
      .sort()
      .map((k) => [k, Array.isArray(brut[k]) ? brut[k].map((r) => JSON.stringify(r)).sort() : JSON.stringify(brut[k])])
  );

// Renvoie « inchange », « propre » (seules nos écritures ont changé la base), « modifie » (quelqu'un d'autre a écrit)
// ou « ignore » (démo, lecture déjà en cours, ou écriture de notre part pendant la lecture : on réessaiera).
export async function synchroniser() {
  if (!etat.session || !etat.brut || etat.store.mode !== "supabase" || enCours || ecritures) return "ignore";
  enCours = true;
  try {
    const avant = modifications;
    const neuf = await etat.store.charger({ ancien: etat.brut });
    if (avant !== modifications || ecritures) {
      // Le catalogue lu n'est pas installé : le store doit le relire à la prochaine synchronisation.
      if (etat.store.annulerDerniereLecture) etat.store.annulerDerniereLecture();
      return "ignore";
    }
    const nouvelle = signer(neuf);
    if (nouvelle === signature) return "inchange";
    const miennes = modificationsVues !== modifications;
    signature = nouvelle;
    modificationsVues = modifications;
    // Les dossiers déjà ouverts gardent leurs documents et paiements. Ceux dont le résumé a changé ailleurs les perdent :
    // les calculs préfèrent les copies locales au résumé de la base, elles donneraient des totaux périmés. L'écran qui
    // montre le dossier les relit à son ouverture.
    const anciens = new Map(etat.brut.dossiers.map((d) => [d.id, JSON.stringify(d)]));
    const changes = new Set(neuf.dossiers.filter((d) => anciens.get(d.id) !== JSON.stringify(d)).map((d) => d.id));
    neuf.documents = etat.brut.documents.filter((d) => !changes.has(d.dossier_id) || etat.documentsOuverts.has(d.id));
    neuf.paiements = etat.brut.paiements.filter((p) => !changes.has(p.dossier_id));
    etat.brut = neuf;
    etat.moi = neuf.profils.find((p) => p.user_id === etat.session.id) || etat.moi;
    const ids = entitesAccessibles().map((e) => e.id);
    if (!ids.includes(etat.entiteId)) etat.entiteId = ids[0] || null;
    rebatir();
    copierPourHorsLigne();
    return miennes ? "propre" : "modifie";
  } finally {
    enCours = false;
  }
}

// Langue de l'interface : celle du compte (elle suit la personne d'un appareil à l'autre). Un compte qui n'en a pas encore
// reprend celle de ce navigateur, y compris un choix fait sur l'écran de connexion, et l'enregistre.
export const connexion = { langueChoisie: false };
function adopterLangue() {
  const compte = etat.moi.langue;
  const locale = langueStockee();
  if (estLangue(compte) && !connexion.langueChoisie) return void definirLangue(compte);
  connexion.langueChoisie = false;
  if (locale) {
    definirLangue(locale);
    if (locale !== compte) enregistrerLangue(locale);
  }
}
async function enregistrerLangue(code) {
  etat.moi.langue = code;
  try {
    await etat.store.definirMaLangue(code);
  } catch {
    // migration 13 pas encore appliquée ou hors ligne : la langue reste mémorisée dans ce navigateur
  }
}
export async function choisirLangue(code) {
  if (!definirLangue(code)) return;
  await pretLangue();
  if (etat.session && etat.moi) await enregistrerLangue(code);
  else connexion.langueChoisie = true;
}

export const entitesAccessibles = () => entreprisesVisibles([...etat.brut.entites].filter((e) => e.actif).sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom)), etat.brut.dossiers);
export const entiteActive = () => etat.brut.entites.find((e) => e.id === etat.entiteId) || null;

// Une copie de travail limitée à l'entreprise active : les écrans lisent etat.db sans se soucier des autres.
function rebatir() {
  const e = etat.entiteId;
  const db = {};
  for (const t of TABLES) db[t] = etat.brut[t].filter((r) => r.entite_id === e);
  db.reglages = completerReglages(etat.brut.reglages[e]);
  db.roles = etat.brut.roles.filter((r) => r.entite_id === e);
  etat.db = db;
  setDevise(db.reglages.devise);
  setMasquerMontants(!peut("finances.voir"));
}

export function changerEntite(id) {
  etat.entiteId = id;
  try {
    localStorage.setItem(CLE_ENTITE, id);
  } catch {
    // sans importance
  }
  rebatir();
  // Un dossier ouvert appartient à l'ancienne entreprise : on revient au tableau de bord.
  if (location.hash && location.hash !== "#/") location.hash = "#/";
  else window.dispatchEvent(new HashChangeEvent("hashchange"));
}

// Droits : l'administratrice générale a tous les droits partout, les autres ceux du rôle qu'elles ont dans l'entreprise active.
// L'interface s'en sert pour n'afficher que ce qui est permis, la base refuse de toute façon le reste.
export const estSuperAdmin = () => !!(etat.moi && etat.moi.super_admin && etat.moi.actif);
const contexte = () => ({ profil: etat.moi, membres: etat.brut.membres, roles: etat.brut.roles });
export const permissionsActives = () => permissionsDans(contexte(), etat.entiteId);
export const peut = (code) => !!etat.brut && permissionsActives().includes(code);
// Entreprises dont la personne peut voir les analyses et les montants : c'est le périmètre de la vue d'ensemble.
export const entitesAnalysables = () =>
  entitesAccessibles().filter((e) => {
    const p = permissionsDans(contexte(), e.id);
    return p.includes("analytics.voir") && p.includes("finances.voir");
  });
export function roleActif() {
  if (estSuperAdmin()) return tr("Administratrice générale");
  const r = roleDans(contexte(), etat.entiteId);
  return r ? nomRole(r) : null;
}
// Compatibilité : « administrateur » veut dire pouvoir modifier les réglages.
export const estAdmin = () => peut("reglages.ecrire");

// Les trois rôles créés avec chaque entreprise ont un nom français en base : on les traduit, les rôles de l'utilisatrice restent tels quels.
export const nomRole = (r) => (r.systeme ? tr(r.nom) : r.nom);
export const descriptionRole = (r) => (r.systeme ? tr(r.description) : r.description);

export const reglages = () => etat.db.reglages;

// Chaque entreprise choisit ses écrans (Réglages, Écrans). En automatique, Partenaires apparaît dès qu'il y a un partenaire,
// Réservations et Messages suivent Partenaires, Catalogue est toujours là. Zwald et Secret n'ont donc pas le même menu.
export function moduleActif(nom) {
  const v = ((etat.db && etat.db.reglages.modules) || {})[nom];
  if (v === true || v === false) return v;
  if (nom === "partenaires") return etat.db.partenaires.length > 0 || modeExcursions();
  if (nom === "reservations" || nom === "messages") return moduleActif("partenaires");
  if (nom === "catalogue") return !modeExcursions();
  return true;
}
// Mode excursions (Secret) : pas de devis, facture directe, vouchers. Sinon voyages sur mesure (Zwald).
export const modeExcursions = () => !!etat.db && etat.db.reglages.fonctionnement === "excursions";

// ---- Chargement à la demande ---------------------------------------------------------------------------------
// Documents et paiements ne sont pas chargés avec les listes : on les charge à l'ouverture d'un dossier.
function fusionnerDossier({ dossier, documents, paiements }) {
  if (!dossier) return null;
  const i = etat.brut.dossiers.findIndex((x) => x.id === dossier.id);
  if (i >= 0) etat.brut.dossiers[i] = dossier;
  else etat.brut.dossiers.push(dossier);
  etat.brut.documents = etat.brut.documents.filter((d) => d.dossier_id !== dossier.id).concat(documents);
  etat.brut.paiements = etat.brut.paiements.filter((p) => p.dossier_id !== dossier.id).concat(paiements);
  rebatir();
  return dossier;
}

export async function chargerDossier(id) {
  return fusionnerDossier(await etat.store.dossierComplet(id));
}

// Charge le document et tout son dossier (le devis et la facture se complètent, les paiements comptent dans la facture).
export async function chargerDocument(docId) {
  const r = await etat.store.documentComplet(docId);
  return r ? fusionnerDossier(r) : null;
}

// Après une modification de documents ou de paiements, la base a recalculé le résumé du dossier : on le relit.
async function actualiserResume(dossierId) {
  const d = await etat.store.resumeDossier(dossierId);
  const i = etat.brut.dossiers.findIndex((x) => x.id === dossierId);
  if (d && i >= 0) {
    etat.brut.dossiers[i] = d;
    rebatir();
  }
}

// Prochain numéro de la séquence annuelle des références, attribué par la base (migration 14) : il ne redescend jamais, donc un dossier
// supprimé ne rend pas son numéro, et il tient compte des dossiers que cette personne ne voit pas. `minimum` est le plus grand numéro que
// cette personne voit. Sans la migration, ou hors ligne, on retombe sur le calcul local (minimum + 1).
export async function numeroSuivant(annee, minimum) {
  try {
    const n = await etat.store.prochainNumeroRef(etat.entiteId, annee, minimum);
    return Number.isInteger(n) && n > minimum ? n : minimum + 1;
  } catch {
    return minimum + 1;
  }
}

// Versions précédentes d'un devis ou d'une facture, corbeille des dossiers supprimés (migration 15).
export const versionsDocument = (docId) => etat.store.versionsDocument(docId);
export const corbeilleDossiers = () => etat.store.corbeille(etat.entiteId);
export async function restaurerDossier(id) {
  const dossierId = await etat.store.restaurerDossier(id);
  await recharger();
  return dossierId;
}

export const paiementsPeriode = (du, au) => (peut("finances.voir") ? etat.store.paiementsPeriode({ entiteId: etat.entiteId, du, au }) : Promise.resolve([]));
export const piecesDossier = (id) => etat.store.piecesDossier(id);
export const lienPiece = (p) => etat.store.lienPiece(p);
export async function ajouterPiece(dossierId, fichier) {
  return etat.store.ajouterPiece({ entiteId: etat.entiteId, dossierId, fichier });
}
export const supprimerPiece = (p) => etat.store.supprimerPiece(p);

export const tousPaiements = () => etat.store.tousPaiements(etat.entiteId);
export const tousDocuments = () => etat.store.tousDocuments(etat.entiteId);
export const toutesTaches = () => etat.store.toutesTaches(etat.entiteId);

async function insererBrut(table, row) {
  const ligne = TABLES.includes(table) ? { entite_id: etat.entiteId, ...row } : row;
  const r = await etat.store.inserer(table, ligne);
  etat.brut[table].push(r);
  rebatir();
  if (table === "documents" || table === "paiements") await actualiserResume(r.dossier_id);
  return r;
}
export const inserer = (...a) => ecrire(() => insererBrut(...a));

// `verrou` : refuse d'écraser ce qu'une autre personne a enregistré depuis la lecture de la ligne (erreur avec `conflit`). À réserver aux
// enregistrements qui réécrivent une fiche entière (devis, fiche client) ; sans la migration 15, `updated_at` manque et rien n'est vérifié.
// `version` : la version que la personne a vue en ouvrant la fiche (la synchronisation a pu en apporter une plus récente dans l'état).
async function modifierBrut(table, id, patch, { verrou = false, version = undefined } = {}) {
  const avant = verrou ? (version ?? (etat.brut[table].find((x) => x.id === id) || {}).updated_at) : undefined;
  const r = await etat.store.modifier(table, id, patch, avant);
  // La liste a pu être relue pendant l'attente : on retrouve la ligne après coup.
  const i = etat.brut[table].findIndex((x) => x.id === id);
  // Le résumé d'un dossier (total, encaissé) ne fait pas partie de la ligne renvoyée par la modification : on le garde.
  if (i >= 0) etat.brut[table][i] = table === "dossiers" ? { ...etat.brut[table][i], ...r } : r;
  else etat.brut[table].push(r);
  rebatir();
  if (table === "documents" || table === "paiements") await actualiserResume(r.dossier_id);
  return r;
}
export const modifier = (...a) => ecrire(() => modifierBrut(...a));

// Nom de la personne qui a modifié une ligne en dernier (colonne `modifie_par`), vide si inconnue.
export function nomModificateur(ligne) {
  const p = ligne && ligne.modifie_par ? etat.brut.profils.find((x) => x.user_id === ligne.modifie_par) : null;
  return p ? p.nom || p.email || "" : "";
}

// Enregistre une fiche sans écraser le travail d'une autre personne. `base` : la ligne telle que la personne l'a ouverte ; `valeurs` : ce que son
// formulaire écrit. Si la ligne a changé entre-temps, les deux saisies sont comparées champ par champ (conflit-calc.mjs) : ce que l'autre seul a changé
// reste, ce que la personne seule a changé s'écrit, et seul un champ changé des deux côtés est soumis à `arbitrer({ conflits, courante, par })`, qui
// renvoie « sien », « miens » ou null (renoncer : l'erreur porte `annule`). Sans colonne de version (avant la migration 24), rien n'est vérifié.
export async function modifierProtege(table, id, valeurs, { base, arbitrer }) {
  let patch = valeurs;
  let version = base && base.updated_at;
  let reference = base || {};
  for (let essai = 0; ; essai++) {
    try {
      return await modifier(table, id, patch, { verrou: true, version });
    } catch (err) {
      if (!err.conflit || essai >= 3) throw err;
      const neuf = await etat.store.charger();
      const courante = (neuf[table] || []).find((x) => x.id === id);
      if (!courante) throw err;
      const i = etat.brut[table].findIndex((x) => x.id === id);
      if (i >= 0) etat.brut[table][i] = table === "dossiers" ? { ...etat.brut[table][i], ...courante } : courante;
      rebatir();
      const f = fusionner(reference, patch, courante);
      let ecrire = f.patch;
      if (f.conflits.length) {
        const choix = await arbitrer({ conflits: f.conflits, courante, par: nomModificateur(courante) });
        if (!choix) throw Object.assign(new Error(tr("Enregistrement annulé : la fiche a été modifiée par quelqu'un d'autre.")), { annule: true });
        ecrire = appliquerChoix(f, choix, courante);
      }
      if (!Object.keys(ecrire).length) return courante;
      patch = ecrire;
      version = courante.updated_at;
      reference = courante;
    }
  }
}

async function supprimerBrut(table, id) {
  const avant = etat.brut[table].find((x) => x.id === id);
  await etat.store.supprimer(table, id);
  etat.brut[table] = etat.brut[table].filter((x) => x.id !== id);
  if ((table === "documents" || table === "paiements") && avant) await actualiserResume(avant.dossier_id);
  if (table === "dossiers") {
    etat.brut.documents = etat.brut.documents.filter((d) => d.dossier_id !== id);
    etat.brut.paiements = etat.brut.paiements.filter((p) => p.dossier_id !== id);
  }
  rebatir();
}
export const supprimer = (...a) => ecrire(() => supprimerBrut(...a));

// `versionLue` : la version des réglages au moment où l'écran s'est ouvert. La synchronisation a pu apporter une version plus récente
// entre-temps : c'est bien celle que la personne a vue qui sert de référence, sinon son enregistrement écraserait l'autre sans le dire.
async function enregistrerReglagesBrut(valeur, versionLue) {
  const avant = versionLue ?? (etat.brut.reglages_maj || {})[etat.entiteId];
  const maj = await etat.store.enregistrerReglages(etat.entiteId, valeur, avant);
  etat.brut.reglages[etat.entiteId] = valeur;
  if (maj) (etat.brut.reglages_maj ||= {})[etat.entiteId] = maj;
  rebatir();
}
export const enregistrerReglages = (...a) => ecrire(() => enregistrerReglagesBrut(...a));

// Administration (administrateur général seulement, la base le refuse aux autres)
export async function creerEntite(nom, slug) {
  const ordre = Math.max(0, ...etat.brut.entites.map((e) => e.ordre || 0)) + 1;
  const e = await etat.store.inserer("entites", { nom, slug, actif: true, ordre });
  const base = completerReglages({ emetteur: { nom } });
  await etat.store.enregistrerReglages(e.id, base);
  for (const r of ROLES_SYSTEME) etat.brut.roles.push(await etat.store.inserer("roles", { entite_id: e.id, nom: r.nom, description: r.description, portee: r.portee, permissions: r.permissions, systeme: true }));
  etat.brut.entites.push(e);
  etat.brut.reglages[e.id] = base;
  rebatir();
  return e;
}

async function modifierEntiteBrut(id, patch) {
  const r = await etat.store.modifier("entites", id, patch);
  const i = etat.brut.entites.findIndex((x) => x.id === id);
  etat.brut.entites[i] = r;
  rebatir();
}
export const modifierEntite = (...a) => ecrire(() => modifierEntiteBrut(...a));

export async function definirAcces(userId, entiteId, roleId) {
  if (roleId) {
    await etat.store.donnerAcces(userId, entiteId, roleId);
    const m = etat.brut.membres.find((x) => x.user_id === userId && x.entite_id === entiteId);
    if (m) m.role_id = roleId;
    else etat.brut.membres.push({ user_id: userId, entite_id: entiteId, role_id: roleId });
  } else {
    await etat.store.retirerAcces(userId, entiteId);
    etat.brut.membres = etat.brut.membres.filter((x) => !(x.user_id === userId && x.entite_id === entiteId));
  }
}

async function modifierProfilBrut(userId, patch) {
  await etat.store.modifierProfil(userId, patch);
  Object.assign(etat.brut.profils.find((p) => p.user_id === userId), patch);
  if (etat.moi && etat.moi.user_id === userId) Object.assign(etat.moi, patch);
}
export const modifierProfil = (...a) => ecrire(() => modifierProfilBrut(...a));

export const equipe = () => etat.store.equipe(etat.entiteId);

export const resumes = () => etat.db.dossiers.map((d) => resume(d, etat.db, etat.db.reglages));
export const resumeDossier = (id) => {
  const d = etat.db.dossiers.find((x) => x.id === id);
  return d ? resume(d, etat.db, etat.db.reglages) : null;
};

const sansAccents = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Recherche de clients de l'entreprise active : tous les mots saisis doivent apparaître dans le nom, le téléphone,
// l'e-mail ou l'adresse. Sans saisie, les clients ayant eu un dossier récemment. Asynchrone pour pouvoir passer
// à une recherche côté serveur quand les clients seront trop nombreux pour tenir dans le navigateur.
export async function chercherClients(q, limite = 8) {
  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  if (!mots.length) {
    const dernier = new Map();
    for (const d of etat.db.dossiers) if (!dernier.has(d.client_id) || d.created_at > dernier.get(d.client_id)) dernier.set(d.client_id, d.created_at);
    return [...etat.db.clients].sort((a, b) => (dernier.get(b.id) || "").localeCompare(dernier.get(a.id) || "") || nomClient(a).localeCompare(nomClient(b))).slice(0, limite);
  }
  return etat.db.clients
    .map((c) => {
      const nom = sansAccents(nomClient(c));
      const tout = `${nom} ${sansAccents(`${c.telephone} ${c.email} ${c.adresse}`)}`;
      if (!mots.every((m) => tout.includes(m))) return null;
      return { c, rang: mots.every((m) => nom.startsWith(m) || nom.includes(` ${m}`)) ? 0 : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => a.rang - b.rang || nomClient(a.c).localeCompare(nomClient(b.c)))
    .slice(0, limite)
    .map((x) => x.c);
}

export const nomClient = (c) => (c ? [c.prenom, c.nom].filter(Boolean).join(" ") : tr("Client inconnu"));

export function naviguer(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}

export function imprimer(feuille, nomFichier) {
  const zone = document.createElement("div");
  zone.id = "zone-impression";
  zone.append(feuille.cloneNode(true));
  document.body.append(zone);
  const titre = document.title;
  document.title = nomFichier;
  const fin = () => {
    zone.remove();
    document.title = titre;
    window.removeEventListener("afterprint", fin);
  };
  window.addEventListener("afterprint", fin);
  window.print();
}

// ---- Partenaires ----------------------------------------------------------------------------------------------
// Les nets et les coordonnées bancaires sont dans des tables à part : la base ne les envoie qu'avec le droit
// « partenaires.nets », donc ces listes sont simplement vides pour les autres.
// Identifiants des dossiers annulés : leurs réservations ne comptent plus dans l'agenda, le dû aux partenaires et la feuille du jour.
export const dossiersAnnules = () => new Set(etat.db.dossiers.filter((d) => d.annule).map((d) => d.id));
export const partenaireDe = (id) => (id && etat.db.partenaires.find((p) => p.id === id)) || null;
export const nomPartenaire = (id) => (partenaireDe(id) || {}).nom || "";
export const netPrestation = (p) => etat.db.prestations_nets.find((n) => n.prestation_id === p.id) || null;
export const netTrajet = (t) => etat.db.trajets_nets.find((n) => n.trajet_id === t.id) || null;
export const privePartenaire = (p) => etat.db.partenaires_prives.find((n) => n.partenaire_id === p.id) || null;
export const netReservation = (r) => etat.db.reservations_nets.find((n) => n.reservation_id === r.id) || null;

// Enregistre ou crée la ligne liée d'un élément (net d'une prestation, net d'un trajet, données privées d'un partenaire).
export async function enregistrerLie(table, cle, parentId, valeurs) {
  const existante = etat.db[table].find((r) => r[cle] === parentId);
  return existante ? modifier(table, existante.id, valeurs) : inserer(table, { [cle]: parentId, ...valeurs });
}
