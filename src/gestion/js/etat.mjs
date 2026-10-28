// État partagé : le magasin de données et une copie en mémoire des tables.
import { creerStore } from "./store.mjs";
import { resume } from "./calc.mjs";

export const etat = { store: null, db: null, session: null };

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
  etat.db = await etat.store.charger();
}

export const reglages = () => etat.db.reglages;

export async function inserer(table, row) {
  const r = await etat.store.inserer(table, row);
  etat.db[table].push(r);
  return r;
}

export async function modifier(table, id, patch) {
  const r = await etat.store.modifier(table, id, patch);
  const i = etat.db[table].findIndex((x) => x.id === id);
  etat.db[table][i] = r;
  return r;
}

export async function supprimer(table, id) {
  await etat.store.supprimer(table, id);
  etat.db[table] = etat.db[table].filter((x) => x.id !== id);
  if (table === "dossiers") {
    etat.db.documents = etat.db.documents.filter((d) => d.dossier_id !== id);
    etat.db.paiements = etat.db.paiements.filter((p) => p.dossier_id !== id);
  }
}

export async function enregistrerReglages(r) {
  await etat.store.enregistrerReglages(r);
  etat.db.reglages = r;
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
