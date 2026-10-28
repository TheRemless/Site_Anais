// Stockage de démonstration : tout reste dans le navigateur (localStorage), rien n'est envoyé.
import { aujourdhui, ajouterJours } from "./calc.mjs";
import { donneesDemo, uid } from "./defauts.mjs";

const CLE = "gestion-zwald-demo-v1";
const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue"];

export function creer() {
  let data;
  const charge = () => {
    try {
      data = JSON.parse(localStorage.getItem(CLE));
    } catch {
      data = null;
    }
    if (!data) data = donneesDemo(aujourdhui(), ajouterJours);
  };
  const sauve = () => {
    try {
      localStorage.setItem(CLE, JSON.stringify(data));
    } catch {
      // stockage refusé (navigation privée) : la démo reste utilisable jusqu'au rechargement
    }
  };
  charge();

  return {
    mode: "demo",
    async session() {
      return { email: "démo" };
    },
    async connecter() {},
    async deconnecter() {},
    async charger() {
      return structuredClone(data);
    },
    async inserer(table, row) {
      const ligne = { id: uid(), created_at: aujourdhui(), ...row };
      data[table].push(ligne);
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
    async enregistrerReglages(reglages) {
      data.reglages = reglages;
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
      if (tables.reglages) data.reglages = tables.reglages;
      sauve();
    },
    async reinitialiser() {
      localStorage.removeItem(CLE);
      charge();
      sauve();
    },
  };
}
