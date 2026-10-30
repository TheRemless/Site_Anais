// État partagé : le magasin de données, la copie en mémoire des tables et l'entreprise active.
// `brut` contient tout ce que la base laisse voir à la personne connectée, `db` seulement l'entreprise active.
import { creerStore } from "./store.mjs";
import { resume, setDevise, setMasquerMontants } from "./calc.mjs";
import { completerReglages, ROLES_SYSTEME } from "./defauts.mjs";
import { permissionsDans, roleDans } from "./droits.mjs";
import { tr, definirLangue, langueStockee, estLangue } from "./i18n.mjs";

const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue", "taches", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets"];
const CLE_ENTITE = "gestion-zwald-entite";

export const etat = { store: null, brut: null, db: null, session: null, moi: null, entiteId: null };

export async function init() {
  // La langue de ce navigateur sert dès l'écran de connexion ; celle du compte la remplace après la connexion.
  const stockee = langueStockee();
  if (stockee) definirLangue(stockee);
  etat.store = await creerStore();
  etat.session = await etat.store.session();
  if (!etat.session) return;
  try {
    await recharger();
  } catch (err) {
    // Jeton expiré ou refusé : on repart de la page de connexion.
    if (!/jwt|token|auth|permission|401/i.test(err.message)) throw err;
    await etat.store.deconnecter();
    etat.session = null;
  }
}

export async function recharger() {
  etat.brut = await etat.store.charger();
  etat.moi = etat.brut.profils.find((p) => p.user_id === etat.session.id) || { user_id: etat.session.id, email: etat.session.email, super_admin: false, actif: true };
  adopterLangue();
  let choisi = null;
  try {
    choisi = localStorage.getItem(CLE_ENTITE);
  } catch {
    // stockage refusé : on prend la première entreprise
  }
  const ids = entitesAccessibles().map((e) => e.id);
  etat.entiteId = ids.includes(choisi) ? choisi : ids[0] || null;
  rebatir();
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
  if (etat.session && etat.moi) await enregistrerLangue(code);
  else connexion.langueChoisie = true;
}

export const entitesAccessibles = () => [...etat.brut.entites].filter((e) => e.actif).sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom));
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

export const paiementsPeriode = (du, au) => (peut("finances.voir") ? etat.store.paiementsPeriode({ entiteId: etat.entiteId, du, au }) : Promise.resolve([]));
export const piecesDossier = (id) => etat.store.piecesDossier(id);
export const lienPiece = (p) => etat.store.lienPiece(p);
export async function ajouterPiece(dossierId, fichier) {
  return etat.store.ajouterPiece({ entiteId: etat.entiteId, dossierId, fichier });
}
export const supprimerPiece = (p) => etat.store.supprimerPiece(p);

export const tousPaiements = () => etat.store.tousPaiements(etat.entiteId);
export const tousDocuments = () => etat.store.tousDocuments(etat.entiteId);

export async function inserer(table, row) {
  const ligne = TABLES.includes(table) ? { entite_id: etat.entiteId, ...row } : row;
  const r = await etat.store.inserer(table, ligne);
  etat.brut[table].push(r);
  rebatir();
  if (table === "documents" || table === "paiements") await actualiserResume(r.dossier_id);
  return r;
}

export async function modifier(table, id, patch) {
  const r = await etat.store.modifier(table, id, patch);
  const i = etat.brut[table].findIndex((x) => x.id === id);
  // Le résumé d'un dossier (total, encaissé) ne fait pas partie de la ligne renvoyée par la modification : on le garde.
  etat.brut[table][i] = table === "dossiers" ? { ...etat.brut[table][i], ...r } : r;
  rebatir();
  if (table === "documents" || table === "paiements") await actualiserResume(r.dossier_id);
  return r;
}

export async function supprimer(table, id) {
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

export async function enregistrerReglages(valeur) {
  await etat.store.enregistrerReglages(etat.entiteId, valeur);
  etat.brut.reglages[etat.entiteId] = valeur;
  rebatir();
}

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

export async function modifierEntite(id, patch) {
  const r = await etat.store.modifier("entites", id, patch);
  const i = etat.brut.entites.findIndex((x) => x.id === id);
  etat.brut.entites[i] = r;
  rebatir();
}

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

export async function modifierProfil(userId, patch) {
  await etat.store.modifierProfil(userId, patch);
  Object.assign(etat.brut.profils.find((p) => p.user_id === userId), patch);
  if (etat.moi && etat.moi.user_id === userId) Object.assign(etat.moi, patch);
}

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
