// Stockage de démonstration : tout reste dans le navigateur (localStorage), rien n'est envoyé.
// Il reproduit les droits de la vraie base : l'utilisateur de démo ne reçoit que les entreprises dont il est membre.
import { aujourdhui, ajouterJours } from "./calc.mjs";
import { donneesDemo, uid, REGLAGES_NEUTRE } from "./defauts.mjs";

const CLE = "gestion-zwald-demo-v2";
const CLE_UTILISATEUR = "gestion-zwald-demo-utilisateur";
const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue"];

export function creer() {
  let data;
  let utilisateur;
  const charge = () => {
    try {
      data = JSON.parse(localStorage.getItem(CLE));
    } catch {
      data = null;
    }
    if (!data) data = donneesDemo(aujourdhui(), ajouterJours);
    let choisi = null;
    try {
      choisi = localStorage.getItem(CLE_UTILISATEUR);
    } catch {
      // stockage refusé : on reste sur l'administratrice de démo
    }
    utilisateur = data.profils.find((p) => p.user_id === choisi) || data.profils.find((p) => p.super_admin);
  };
  const sauve = () => {
    try {
      localStorage.setItem(CLE, JSON.stringify(data));
      localStorage.setItem(CLE_UTILISATEUR, utilisateur.user_id);
    } catch {
      // stockage refusé (navigation privée) : la démo reste utilisable jusqu'au rechargement
    }
  };
  charge();

  const accessibles = () => {
    if (utilisateur.super_admin) return data.entites.map((e) => e.id);
    return data.membres.filter((m) => m.user_id === utilisateur.user_id).map((m) => m.entite_id);
  };

  return {
    mode: "demo",
    async session() {
      return { id: utilisateur.user_id, email: utilisateur.email };
    },
    async connecter() {},
    async deconnecter() {},
    async charger() {
      const ids = new Set(accessibles());
      const out = { entites: data.entites.filter((e) => ids.has(e.id)), reglages: {} };
      for (const t of TABLES) out[t] = data[t].filter((r) => ids.has(r.entite_id));
      for (const id of ids) out.reglages[id] = data.reglages[id];
      out.profils = utilisateur.super_admin ? data.profils : data.profils.filter((p) => p.user_id === utilisateur.user_id);
      out.membres = utilisateur.super_admin ? data.membres : data.membres.filter((m) => m.user_id === utilisateur.user_id);
      return structuredClone(out);
    },
    async inserer(table, row) {
      const ligne = { id: uid(), created_at: aujourdhui(), ...row };
      data[table].push(ligne);
      if (table === "entites") data.reglages[ligne.id] = structuredClone(REGLAGES_NEUTRE);
      sauve();
      return structuredClone(ligne);
    },
    async modifier(table, id, patch) {
      const ligne = data[table].find((r) => r.id === id);
      Object.assign(ligne, patch);
      sauve();
      return structuredClone(ligne);
    },
    async supprimer(table, id) {
      data[table] = data[table].filter((r) => r.id !== id);
      if (table === "dossiers") {
        data.documents = data.documents.filter((d) => d.dossier_id !== id);
        data.paiements = data.paiements.filter((p) => p.dossier_id !== id);
      }
      sauve();
    },
    async enregistrerReglages(entiteId, valeur) {
      data.reglages[entiteId] = valeur;
      sauve();
    },
    async modifierProfil(userId, patch) {
      Object.assign(data.profils.find((p) => p.user_id === userId), patch);
      sauve();
    },
    async donnerAcces(userId, entiteId, role) {
      const m = data.membres.find((x) => x.user_id === userId && x.entite_id === entiteId);
      if (m) m.role = role;
      else data.membres.push({ user_id: userId, entite_id: entiteId, role });
      sauve();
    },
    async retirerAcces(userId, entiteId) {
      data.membres = data.membres.filter((x) => !(x.user_id === userId && x.entite_id === entiteId));
      sauve();
    },
    async importer(tables) {
      for (const t of TABLES) {
        for (const row of tables[t] || []) {
          const i = data[t].findIndex((r) => r.id === row.id);
          if (i >= 0) data[t][i] = row;
          else data[t].push(row);
        }
      }
      sauve();
    },
    // Propre à la démonstration
    async reinitialiser() {
      localStorage.removeItem(CLE);
      charge();
      sauve();
    },
    utilisateursDemo: () => data.profils.map((p) => ({ id: p.user_id, nom: p.nom, super_admin: p.super_admin })),
    utilisateurDemo: () => utilisateur.user_id,
    changerUtilisateurDemo(id) {
      utilisateur = data.profils.find((p) => p.user_id === id) || utilisateur;
      sauve();
    },
  };
}
