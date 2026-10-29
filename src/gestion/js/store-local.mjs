// Stockage de démonstration : tout reste dans le navigateur (localStorage), rien n'est envoyé.
// Il reproduit les droits de la vraie base : l'utilisateur de démo ne reçoit que ce que son rôle lui montre.
import { aujourdhui, ajouterJours, totalDossier, sommePaiements } from "./calc.mjs";
import { donneesDemo, uid, REGLAGES_NEUTRE } from "./defauts.mjs";
import { permissionsDans, voitTout } from "./droits.mjs";
import { analyserLocal } from "./analyses.mjs";
import { tr } from "./i18n.mjs";

const CLE = "gestion-zwald-demo-v8";
const CLE_UTILISATEUR = "gestion-zwald-demo-utilisateur";
const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue", "taches", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets"];
const PARTENAIRES_PUBLIC = ["partenaires", "prestations", "trajets"];
const PARTENAIRES_NETS = ["partenaires_prives", "prestations_nets", "trajets_nets", "reservations_nets"];
const LIMITE_DEMO = 1.5 * 1024 * 1024;

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
    for (const t of TABLES) data[t] = data[t] || [];
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

  // Résumé d'un dossier, comme le tient la base : seul le droit « montants » donne accès aux chiffres.
  const avecResume = (d, finances) => {
    const docs = data.documents.filter((x) => x.dossier_id === d.id);
    const devis = docs.filter((x) => x.type === "devis").sort((a, b) => (a.date_emission + a.created_at < b.date_emission + b.created_at ? -1 : 1)).pop();
    const base = { ...d, devis_envoye_le: (devis && devis.envoye_le) || null, a_facture: docs.some((x) => x.type === "facture") };
    if (!finances) return base;
    const doc = docs.filter((x) => x.type === "facture").pop() || devis;
    return { ...base, total: totalDossier(docs), devise: (doc && doc.contenu.devise) || null, recu: sommePaiements(data.paiements.filter((p) => p.dossier_id === d.id)) };
  };
  const dossiersVisibles = () => {
    const ctx = contexte();
    const ids = new Set(accessibles());
    const visible = (d) => voitTout(ctx, d.entite_id) || d.responsable_id === utilisateur.user_id || d.cree_par === utilisateur.user_id;
    return data.dossiers.filter((d) => ids.has(d.entite_id) && permissionsDans(ctx, d.entite_id).includes("dossiers.lire") && visible(d));
  };
  const financesDe = (entiteId) => permissionsDans(contexte(), entiteId).includes("finances.voir");

  const contexte = () => ({ profil: utilisateur, membres: data.membres, roles: data.roles });
  const accessibles = () => (utilisateur.super_admin ? data.entites.map((e) => e.id) : data.membres.filter((m) => m.user_id === utilisateur.user_id).map((m) => m.entite_id));
  const nomDe = (id) => (data.profils.find((p) => p.user_id === id) || {}).nom || null;

  // Journal tenu à la main, comme le fait le déclencheur de la vraie base.
  const journaliser = (table, action, ligne, details = {}) => {
    // Les tables de nets ne passent pas par le journal, comme dans la vraie base.
    if (PARTENAIRES_NETS.includes(table)) return;
    const libelle = { dossiers: ligne.ref, clients: [ligne.prenom, ligne.nom].filter(Boolean).join(" "), catalogue: ligne.libelle, roles: ligne.nom, taches: ligne.titre, pieces_jointes: ligne.nom, partenaires: ligne.nom, prestations: ligne.libelle, trajets: `${ligne.de} → ${ligne.vers}`, reservations: ligne.libelle, documents: `${ligne.type || ""} ${(data.dossiers.find((d) => d.id === ligne.dossier_id) || {}).ref || ""}`.trim(), paiements: `${ligne.montant} ${(data.dossiers.find((d) => d.id === ligne.dossier_id) || {}).ref || ""}`.trim() }[table] || "";
    data.journal.unshift({ id: Date.now() + Math.random(), created_at: new Date().toISOString(), entite_id: ligne.entite_id || null, user_id: utilisateur.user_id, table_name: table, action, cible: ligne.id || "", libelle, details });
    data.journal.length = Math.min(data.journal.length, 500);
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
      const ctx = contexte();
      const out = { entites: data.entites.filter((e) => ids.has(e.id)), reglages: {}, roles: data.roles.filter((r) => ids.has(r.entite_id)) };
      for (const id of ids) out.reglages[id] = data.reglages[id];
      const uidCourant = utilisateur.user_id;
      const visible = (d) => voitTout(ctx, d.entite_id) || d.responsable_id === uidCourant || d.cree_par === uidCourant;
      const dossiers = data.dossiers.filter((d) => ids.has(d.entite_id) && permissionsDans(ctx, d.entite_id).includes("dossiers.lire") && visible(d));
      const idsDossiers = new Set(dossiers.map((d) => d.id));
      out.dossiers = dossiers;
      out.clients = data.clients.filter((c) => ids.has(c.entite_id) && permissionsDans(ctx, c.entite_id).includes("clients.lire") && (voitTout(ctx, c.entite_id) || c.cree_par === uidCourant || dossiers.some((d) => d.client_id === c.id)));
      out.dossiers = dossiers.map((d) => avecResume(d, financesDe(d.entite_id)));
      // Comme avec la vraie base, documents et paiements se chargent à l'ouverture d'un dossier.
      out.documents = [];
      out.paiements = [];
      const peutTache = (t) => t.assignee_id === uidCourant || (ids.has(t.entite_id) && (voitTout(ctx, t.entite_id) || t.cree_par === uidCourant) && (!t.dossier_id || idsDossiers.has(t.dossier_id)));
      out.taches = (data.taches || []).filter((t) => ids.has(t.entite_id) && peutTache(t));
      out.catalogue = data.catalogue.filter((c) => ids.has(c.entite_id));
      const droit = (eid, code) => permissionsDans(ctx, eid).includes(code);
      for (const t of PARTENAIRES_PUBLIC) out[t] = data[t].filter((r) => ids.has(r.entite_id) && droit(r.entite_id, "partenaires.lire"));
      for (const t of PARTENAIRES_NETS) out[t] = data[t].filter((r) => ids.has(r.entite_id) && droit(r.entite_id, "partenaires.nets"));
      // Les réservations suivent les dossiers : qui ne voit pas le dossier ne voit pas ses réservations.
      out.reservations = data.reservations.filter((r) => idsDossiers.has(r.dossier_id));
      const idsRes = new Set(out.reservations.map((r) => r.id));
      out.reservations_nets = out.reservations_nets.filter((n) => idsRes.has(n.reservation_id));
      out.profils = utilisateur.super_admin ? data.profils : data.profils.filter((p) => p.user_id === uidCourant);
      out.membres = utilisateur.super_admin ? data.membres : data.membres.filter((m) => m.user_id === uidCourant);
      return structuredClone(out);
    },
    async inserer(table, row) {
      const ligne = { id: uid(), created_at: aujourdhui(), ...row };
      if (table === "dossiers") ligne.responsable_id = ligne.responsable_id || utilisateur.user_id;
      if (TABLES.includes(table) && !["catalogue", "trajets", ...PARTENAIRES_NETS].includes(table)) ligne.cree_par = utilisateur.user_id;
      data[table].push(ligne);
      if (table === "entites") data.reglages[ligne.id] = structuredClone(REGLAGES_NEUTRE);
      journaliser(table, "insert", ligne);
      sauve();
      return structuredClone(ligne);
    },
    async modifier(table, id, patch) {
      const ligne = data[table].find((r) => r.id === id);
      const details = {};
      for (const [k, v] of Object.entries(patch)) {
        if (["updated_at", "modifie_par"].includes(k) || JSON.stringify(ligne[k]) === JSON.stringify(v)) continue;
        const court = (x) => JSON.stringify(x ?? null).length <= 120;
        details[k] = court(ligne[k]) && court(v) ? { avant: ligne[k] ?? null, apres: v } : "modifié";
      }
      Object.assign(ligne, patch);
      if (Object.keys(details).length) journaliser(table, "update", ligne, details);
      sauve();
      return structuredClone(ligne);
    },
    async supprimer(table, id) {
      const ligne = data[table].find((r) => r.id === id);
      data[table] = data[table].filter((r) => r.id !== id);
      if (table === "dossiers") {
        data.documents = data.documents.filter((d) => d.dossier_id !== id);
        data.paiements = data.paiements.filter((p) => p.dossier_id !== id);
      }
      if (ligne) journaliser(table, "delete", ligne);
      sauve();
    },
    async enregistrerReglages(entiteId, valeur) {
      data.reglages[entiteId] = valeur;
      journaliser("reglages", "update", { entite_id: entiteId, id: entiteId });
      sauve();
    },
    async definirMaLangue(code) {
      utilisateur.langue = code;
      sauve();
    },
    async modifierProfil(userId, patch) {
      Object.assign(data.profils.find((p) => p.user_id === userId), patch);
      sauve();
    },
    async donnerAcces(userId, entiteId, roleId) {
      const m = data.membres.find((x) => x.user_id === userId && x.entite_id === entiteId);
      if (m) m.role_id = roleId;
      else data.membres.push({ user_id: userId, entite_id: entiteId, role_id: roleId });
      journaliser("membres", "update", { entite_id: entiteId, id: `${entiteId}:${userId}` }, { role_id: { apres: roleId } });
      data.journal[0].libelle = (data.profils.find((p) => p.user_id === userId) || {}).email || "";
      sauve();
    },
    async retirerAcces(userId, entiteId) {
      data.membres = data.membres.filter((x) => !(x.user_id === userId && x.entite_id === entiteId));
      journaliser("membres", "delete", { entite_id: entiteId, id: `${entiteId}:${userId}` });
      data.journal[0].libelle = (data.profils.find((p) => p.user_id === userId) || {}).email || "";
      sauve();
    },
    // Les collègues d'une entreprise, pour choisir un responsable de dossier.
    async equipe(entiteId) {
      const ids = new Set(data.membres.filter((m) => m.entite_id === entiteId).map((m) => m.user_id));
      return data.profils.filter((p) => p.actif && (p.super_admin || ids.has(p.user_id))).map((p) => ({ user_id: p.user_id, nom: p.nom, email: p.email }));
    },
    // Pièces jointes de démonstration : gardées dans le navigateur, 1,5 Mo au plus par fichier.
    async piecesDossier(dossierId) {
      return structuredClone((data.pieces || []).filter((p) => p.dossier_id === dossierId));
    },
    async ajouterPiece({ entiteId, dossierId, fichier }) {
      if (fichier.size > LIMITE_DEMO) throw new Error(tr("En démonstration, les fichiers sont limités à 1,5 Mo."));
      const contenu = await new Promise((ok, ko) => {
        const l = new FileReader();
        l.onload = () => ok(l.result);
        l.onerror = () => ko(new Error(tr("Lecture du fichier impossible.")));
        l.readAsDataURL(fichier);
      });
      const piece = { id: uid(), created_at: new Date().toISOString(), entite_id: entiteId, dossier_id: dossierId, nom: fichier.name, type: fichier.type, taille: fichier.size, chemin: `${entiteId}/${dossierId}/${uid()}`, cree_par: utilisateur.user_id };
      (data.pieces = data.pieces || []).push(piece);
      (data.fichiers = data.fichiers || {})[piece.chemin] = contenu;
      journaliser("pieces_jointes", "insert", piece);
      sauve();
      return structuredClone(piece);
    },
    async lienPiece(piece) {
      return (data.fichiers || {})[piece.chemin];
    },
    async supprimerPiece(piece) {
      data.pieces = (data.pieces || []).filter((p) => p.id !== piece.id);
      delete (data.fichiers || {})[piece.chemin];
      journaliser("pieces_jointes", "delete", piece);
      sauve();
    },
    async resumeDossier(id) {
      const d = dossiersVisibles().find((x) => x.id === id);
      return d ? structuredClone(avecResume(d, financesDe(d.entite_id))) : null;
    },
    async dossierComplet(id) {
      const dossier = await this.resumeDossier(id);
      if (!dossier) return { dossier: null, documents: [], paiements: [] };
      const f = financesDe(dossier.entite_id);
      return structuredClone({ dossier, documents: f ? data.documents.filter((x) => x.dossier_id === id) : [], paiements: f ? data.paiements.filter((x) => x.dossier_id === id) : [] });
    },
    async documentComplet(docId) {
      const doc = data.documents.find((x) => x.id === docId);
      return doc ? this.dossierComplet(doc.dossier_id) : null;
    },
    async paiementsPeriode({ entiteId, du, au }) {
      if (!financesDe(entiteId)) return [];
      const ids = new Set(dossiersVisibles().map((d) => d.id));
      return structuredClone(data.paiements.filter((p) => p.entite_id === entiteId && ids.has(p.dossier_id) && p.date >= du && p.date <= au));
    },
    async tousDocuments(entiteId) {
      if (!financesDe(entiteId)) return [];
      const ids = new Set(dossiersVisibles().map((x) => x.id));
      return structuredClone(data.documents.filter((x) => x.entite_id === entiteId && ids.has(x.dossier_id)));
    },
    async tousPaiements(entiteId) {
      return this.paiementsPeriode({ entiteId, du: "0000-01-01", au: "9999-12-31" });
    },
    async analyses({ entiteId, du, au, jour }) {
      const p = permissionsDans(contexte(), entiteId);
      if (!(p.includes("analytics.voir") && p.includes("finances.voir"))) throw new Error(tr("Droit insuffisant pour voir les analyses"));
      const de = (t) => data[t].filter((r) => r.entite_id === entiteId);
      return analyserLocal({ dossiers: de("dossiers"), documents: de("documents"), paiements: de("paiements"), clients: de("clients"), profils: data.profils, reglages: data.reglages[entiteId] }, du, au, jour);
    },
    async journal({ entiteId, table, userId, avant, limite = 50 }) {
      if (!permissionsDans(contexte(), entiteId).includes("journal.voir")) return [];
      return structuredClone(
        data.journal
          .filter((l) => l.entite_id === entiteId && (!table || l.table_name === table) && (!userId || l.user_id === userId) && (!avant || l.created_at < avant))
          .slice(0, limite)
          .map((l) => ({ ...l, auteur: nomDe(l.user_id) }))
      );
    },
    async supprimerPartenaires(entiteId) {
      const ids = new Set(data.partenaires.filter((p) => p.entite_id === entiteId).map((p) => p.id));
      data.taches = data.taches.filter((t) => !(t.entite_id === entiteId && t.partenaire_id));
      data.partenaires = data.partenaires.filter((p) => !ids.has(p.id));
      data.partenaires_prives = data.partenaires_prives.filter((x) => !ids.has(x.partenaire_id));
      const prest = new Set(data.prestations.filter((x) => ids.has(x.partenaire_id) || (x.entite_id === entiteId && !x.partenaire_id)).map((x) => x.id));
      data.prestations = data.prestations.filter((x) => !prest.has(x.id));
      data.prestations_nets = data.prestations_nets.filter((x) => !prest.has(x.prestation_id));
      const traj = new Set(data.trajets.filter((x) => ids.has(x.partenaire_id)).map((x) => x.id));
      data.trajets = data.trajets.filter((x) => !traj.has(x.id));
      data.trajets_nets = data.trajets_nets.filter((x) => !traj.has(x.trajet_id));
      for (const r of data.reservations) {
        if (prest.has(r.prestation_id)) r.prestation_id = null;
        if (traj.has(r.trajet_id)) r.trajet_id = null;
        if (ids.has(r.partenaire_id)) r.partenaire_id = null;
      }
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
