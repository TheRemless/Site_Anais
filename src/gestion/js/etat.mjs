// État partagé : le magasin de données, la copie en mémoire des tables et l'entreprise active.
// `brut` contient tout ce que la base laisse voir à la personne connectée, `db` seulement l'entreprise active.
import { creerStore } from "./store.mjs";
import { resume, setDevise } from "./calc.mjs";
import { completerReglages } from "./defauts.mjs";

const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue"];
const CLE_ENTITE = "gestion-zwald-entite";

export const etat = { store: null, brut: null, db: null, session: null, moi: null, entiteId: null };

export async function init() {
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

export const entitesAccessibles = () => [...etat.brut.entites].filter((e) => e.actif).sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom));
export const entiteActive = () => etat.brut.entites.find((e) => e.id === etat.entiteId) || null;

// Une copie de travail limitée à l'entreprise active : les écrans lisent etat.db sans se soucier des autres.
function rebatir() {
  const e = etat.entiteId;
  const db = {};
  for (const t of TABLES) db[t] = etat.brut[t].filter((r) => r.entite_id === e);
  db.reglages = completerReglages(etat.brut.reglages[e]);
  etat.db = db;
  setDevise(db.reglages.devise);
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

// Droits : l'administrateur général est administrateur partout, les autres selon leur accès à l'entreprise active.
export const estSuperAdmin = () => !!(etat.moi && etat.moi.super_admin && etat.moi.actif);
export function roleActif() {
  if (estSuperAdmin()) return "admin";
  const m = etat.brut.membres.find((x) => x.user_id === etat.session.id && x.entite_id === etat.entiteId);
  return m && etat.moi.actif ? m.role : null;
}
export const estAdmin = () => roleActif() === "admin";

export const reglages = () => etat.db.reglages;

export async function inserer(table, row) {
  const ligne = TABLES.includes(table) ? { entite_id: etat.entiteId, ...row } : row;
  const r = await etat.store.inserer(table, ligne);
  etat.brut[table].push(r);
  rebatir();
  return r;
}

export async function modifier(table, id, patch) {
  const r = await etat.store.modifier(table, id, patch);
  const i = etat.brut[table].findIndex((x) => x.id === id);
  etat.brut[table][i] = r;
  rebatir();
  return r;
}

export async function supprimer(table, id) {
  await etat.store.supprimer(table, id);
  etat.brut[table] = etat.brut[table].filter((x) => x.id !== id);
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

export async function definirAcces(userId, entiteId, role) {
  if (role) {
    await etat.store.donnerAcces(userId, entiteId, role);
    const m = etat.brut.membres.find((x) => x.user_id === userId && x.entite_id === entiteId);
    if (m) m.role = role;
    else etat.brut.membres.push({ user_id: userId, entite_id: entiteId, role });
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

export const resumes = () => etat.db.dossiers.map((d) => resume(d, etat.db, etat.db.reglages));
export const resumeDossier = (id) => {
  const d = etat.db.dossiers.find((x) => x.id === id);
  return d ? resume(d, etat.db, etat.db.reglages) : null;
};

export const nomClient = (c) => (c ? [c.prenom, c.nom].filter(Boolean).join(" ") : "Client inconnu");

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
