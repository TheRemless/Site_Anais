// Stockage de démonstration : tout reste dans le navigateur (localStorage), rien n'est envoyé.
// Il reproduit les droits de la vraie base : l'utilisateur de démo ne reçoit que ce que son rôle lui montre.
import { aujourdhui, ajouterJours, totalDossier, sommePaiements, montantSurPlace } from "./calc.mjs";
import { donneesDemo, uid, REGLAGES_NEUTRE } from "./defauts.mjs";
import { permissionsDans, voitTout } from "./droits.mjs";
import { analyserLocal, faitsLocal } from "./analyses.mjs";
import { tr } from "./i18n.mjs";
import { aPreparerLocal, emettreLocal, envoyerLocal, calculLocal, annulerLocal, facturesVisibles } from "./fiduciaire-local.mjs";
import { calculerNets, suiviDeclencheur } from "./nets-base-local.mjs";
import { demandesDemo, bandeauxDemo } from "./demo-site.mjs";

// v13 (lot D, 17.11.2026) : rôle Administrateur calculé (tous_droits), droit « partenaires.prix », historique des réglages.
const CLE = "gestion-zwald-demo-v13";
const CLE_UTILISATEUR = "gestion-zwald-demo-utilisateur";
// Tables dont chaque modification pose une nouvelle version (comme le déclencheur tenir_a_jour de la base).
const VERSIONNEES = ["clients", "documents", "reservations", "partenaires", "prestations", "dossiers", "paiements", "taches", "demandes_site", "bandeaux_site"];
const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue", "taches", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets", "demandes_site", "bandeaux_site"];
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
    // Demandes et bandeau du site : posés aussi dans une démo déjà enregistrée dans ce navigateur (créée avant la migration 30).
    if (!data.demandes_site) data.demandes_site = demandesDemo({ entites: data.entites, ajd: aujourdhui(), ajouterJours, uid });
    if (!data.bandeaux_site) data.bandeaux_site = bandeauxDemo({ entites: data.entites, ajd: aujourdhui(), uid });
    for (const t of TABLES) data[t] = data[t] || [];
    data.fiduciaire_factures = data.fiduciaire_factures || [];
    // Corbeille des documents et compteurs de numéros, comme la base (migration 34). L'acompte figé du dossier existe comme colonne.
    data.corbeille_documents = data.corbeille_documents || [];
    data.compteurs_ref = data.compteurs_ref || {};
    // Historique des réglages (migration 38), comme la base : la version remplacée à chaque enregistrement, 60 au plus par entreprise.
    data.reglages_historique = data.reglages_historique || [];
    for (const d of data.dossiers || []) if (!("acompte_pct" in d)) d.acompte_pct = null;
    // Nets de démo d'avant le calcul par la base (17.11.2026, D2) : ils comptent comme calculés, pour suivre un enfant ajouté ou un tarif changé.
    for (const n of data.reservations_nets) {
      if (!("net_prevu_auto" in n)) n.net_prevu_auto = n.net_prevu ?? null;
      if (!("commission_prevue_auto" in n)) n.commission_prevue_auto = n.commission_prevue ?? null;
    }
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
    return { ...base, total: totalDossier(docs), devise: (doc && doc.contenu.devise) || null, recu: sommePaiements(data.paiements.filter((p) => p.dossier_id === d.id)), sur_place: doc ? montantSurPlace(doc.contenu) : 0 };
  };
  const dossiersVisibles = () => {
    const ctx = contexte();
    const ids = new Set(accessibles());
    const visible = (d) => voitTout(ctx, d.entite_id) || d.responsable_id === utilisateur.user_id || d.cree_par === utilisateur.user_id;
    return data.dossiers.filter((d) => ids.has(d.entite_id) && permissionsDans(ctx, d.entite_id).includes("dossiers.lire") && visible(d));
  };
  const droit = (entiteId, code) => permissionsDans(contexte(), entiteId).includes(code);
  const resumeDe = (d) => avecResume(d, true);
  // Même périmètre que les dossiers : « toute » voit tout, « mes dossiers » les dossiers créés ou dont la personne est responsable.
  const voit = (entiteId, dossierId) => voitTout(contexte(), entiteId) || data.dossiers.some((d) => d.id === dossierId && (d.cree_par === utilisateur.user_id || d.responsable_id === utilisateur.user_id));
  const financesDe = (entiteId) => permissionsDans(contexte(), entiteId).includes("finances.voir");

  const contexte = () => ({ profil: utilisateur, membres: data.membres, roles: data.roles });
  const accessibles = () => (utilisateur.super_admin ? data.entites.map((e) => e.id) : data.membres.filter((m) => m.user_id === utilisateur.user_id).map((m) => m.entite_id));
  const nomDe = (id) => (data.profils.find((p) => p.user_id === id) || {}).nom || null;

  // Comme publie_sur_le_site (migration 40) : un bandeau du site ne s'écrit qu'avec « Modifier les réglages ».
  const garderBandeau = (table, entiteId) => {
    if (table === "bandeaux_site" && !(droit(entiteId, "dossiers.ecrire") && droit(entiteId, "reglages.ecrire"))) throw new Error(tr("Le bandeau du site est réservé aux personnes qui ont le droit « Modifier les réglages de l'entreprise »."));
  };

  // Comme le déclencheur garder_prix_vente (migration 38) : sans le droit « partenaires.prix », un prix de vente ne change pas et un tarif ou un
  // trajet créé naît sans prix.
  const garderPrix = (table, avant, apres) => {
    if (!["prestations", "trajets"].includes(table) || droit(apres.entite_id, "partenaires.prix")) return;
    const n = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
    const enfant = (x) => n(((x && x.details) || {}).enfant);
    const prix = table === "prestations" ? (x) => [n(x.prix_vente), enfant(x), x.unite || ""] : (x) => [n(x.prix_adulte), n(x.prix_enfant)];
    const change = avant ? JSON.stringify(prix(avant)) !== JSON.stringify(prix(apres)) : prix(apres).slice(0, 2).some((v) => v !== null);
    if (change) throw new Error(tr("Le prix de vente est réservé aux personnes qui ont le droit « Modifier les prix de vente ». Laissez le prix tel quel, ou demandez à l'administratrice."));
  };

  // Comme le déclencheur remplir_nets (migration 32) : après l'écriture d'une réservation de Secret, le net et la commission prévus suivent le tarif,
  // les personnes et les lignes de facture, sans jamais écraser une valeur saisie à la main (contrôle du 17.11.2026, D2).
  const remplirNets = (r, avant) => {
    const suivi = suiviDeclencheur(avant, r);
    if (!suivi) return;
    const n = data.reservations_nets.find((x) => x.reservation_id === r.id) || null;
    const excursions = (entiteId) => ((data.reglages || {})[entiteId] || {}).fonctionnement === "excursions";
    const valeurs = calculerNets(r, n, { ...data, excursions }, { suivreNet: suivi.suivreNet });
    if (!valeurs) return;
    if (n) {
      const details = Object.fromEntries(["net_prevu", "commission_prevue"].filter((k) => (n[k] ?? null) !== (valeurs[k] ?? null)).map((k) => [k, { avant: n[k] ?? null, apres: valeurs[k] }]));
      Object.assign(n, valeurs);
      if (Object.keys(details).length) journaliser("reservations_nets", "update", n, details);
    } else {
      const ligne = { id: uid(), created_at: aujourdhui(), entite_id: r.entite_id, reservation_id: r.id, net_paye: null, paye_le: null, commission_recue: null, commission_recue_le: null, ...valeurs };
      data.reservations_nets.push(ligne);
      journaliser("reservations_nets", "insert", ligne, Object.fromEntries(["net_prevu", "commission_prevue"].filter((k) => valeurs[k] !== null).map((k) => [k, { avant: null, apres: valeurs[k] }])));
    }
  };

  // Journal tenu à la main, comme le fait le déclencheur de la vraie base.
  const journaliser = (table, action, ligne, details = {}) => {
    // Les tables de nets ne passent pas par le journal, comme dans la vraie base, sauf les nets et commissions des réservations : ceux-là n'y sont lisibles
    // qu'avec le droit « nets » (migration du lot G, 17.11.2026).
    if (PARTENAIRES_NETS.includes(table) && table !== "reservations_nets") return;
    const libelle = { dossiers: ligne.ref, clients: [ligne.prenom, ligne.nom].filter(Boolean).join(" "), catalogue: ligne.libelle, roles: ligne.nom, taches: ligne.titre, pieces_jointes: ligne.nom, partenaires: ligne.nom, prestations: ligne.libelle, trajets: `${ligne.de} → ${ligne.vers}`, reservations: ligne.libelle, reservations_nets: (data.reservations.find((r) => r.id === ligne.reservation_id) || {}).libelle || "", documents: `${ligne.type || ""} ${(data.dossiers.find((d) => d.id === ligne.dossier_id) || {}).ref || ""}`.trim(), paiements: `${ligne.montant} ${(data.dossiers.find((d) => d.id === ligne.dossier_id) || {}).ref || ""}`.trim() }[table] || "";
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
    async deconnecterPartout() {},
    // ---- Comptes (lot D) : la démo crée et supprime les comptes dans le navigateur ; les liens sont factices, rien n'est envoyé.
    retourLien() {
      return { type: null, erreur: null };
    },
    async invitation(corps) {
      await new Promise((r) => setTimeout(r, 300));
      if (!utilisateur.super_admin) return { erreur: "droit_manquant" };
      const lienDemo = (type) => `${location.origin}${location.pathname}?demo#demo-${type}-${Math.random().toString(36).slice(2, 10)}`;
      if (corps.action === "inviter") {
        const email = String(corps.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { erreur: "email_invalide" };
        if (data.profils.some((p) => (p.email || "").toLowerCase() === email)) return { erreur: "deja_inscrit" };
        const acces = corps.acces || [];
        if (!acces.every((a) => data.roles.some((r) => r.id === a.role_id && r.entite_id === a.entite_id))) return { erreur: "acces_invalide" };
        const p = { user_id: uid(), email, nom: corps.nom || null, super_admin: false, actif: true, langue: corps.langue || null };
        data.profils.push(p);
        for (const a of acces) data.membres.push({ user_id: p.user_id, entite_id: a.entite_id, role_id: a.role_id });
        sauve();
        return { user_id: p.user_id, lien: lienDemo("invitation") };
      }
      const cible = data.profils.find((p) => p.user_id === corps.user_id);
      if (!cible) return { erreur: "personne_inconnue" };
      if (corps.action === "lien_mot_de_passe") return { lien: lienDemo("mot-de-passe") };
      if (corps.action === "supprimer") {
        if (cible.user_id === utilisateur.user_id) return { erreur: "soi_meme" };
        if (cible.super_admin && data.profils.filter((p) => p.super_admin && p.actif).length <= 1) return { erreur: "derniere_administratrice" };
        data.profils = data.profils.filter((p) => p !== cible);
        data.membres = data.membres.filter((m) => m.user_id !== cible.user_id);
        for (const d of data.dossiers) if (d.responsable_id === cible.user_id) d.responsable_id = null;
        sauve();
        return { ok: true };
      }
      return { erreur: "action_inconnue" };
    },
    async motDePasseOublie() {},
    async changerMotDePasse() {
      await new Promise((r) => setTimeout(r, 200));
    },
    async historiqueReglages(entiteId) {
      return structuredClone(data.reglages_historique.filter((x) => x.entite_id === entiteId).slice(0, 20));
    },
    // Factures pour la fiduciaire (migration 28) : mêmes règles que les fonctions de la base, sur les données du navigateur.
    async fiduciaireListe() {
      return structuredClone(facturesVisibles(data, { droit, voit }));
    },
    async fiduciaireMigration36() {
      return true;
    },
    async fiduciaireAPreparer() {
      return structuredClone(aPreparerLocal(data, { droit, resumeDe, voit }));
    },
    async fiduciaireEmettre(reservationId, date = null, attendu = null) {
      const id = emettreLocal(data, { droit, resumeDe, voit, utilisateurId: utilisateur.user_id, aujourdhui: aujourdhui() }, reservationId, date, attendu);
      sauve();
      return id;
    },
    async fiduciaireAnnuler(reservationId, date = null, destinataire = null) {
      const id = annulerLocal(data, { droit, aujourdhui: aujourdhui() }, reservationId, date, destinataire);
      sauve();
      return id;
    },
    async fiduciaireEnvoyer(ids, date) {
      const n = envoyerLocal(data, { droit, utilisateurId: utilisateur.user_id, aujourdhui: aujourdhui() }, ids, date);
      sauve();
      return n;
    },
    async fiduciaireCalcul(reservationId) {
      return calculLocal(data, { droit, resumeDe, voit }, reservationId);
    },
    async suiviRappels() {
      return null;
    },
    // Démonstration : une demande arrive du site, comme l'écrirait la fonction « demande-site ».
    async simulerDemandeSite(entiteId) {
      const e = data.entites.find((x) => x.id === entiteId);
      const modele = demandesDemo({ entites: data.entites, ajd: aujourdhui(), ajouterJours, uid }).find((d) => d.entite_id === entiteId && d.statut === "nouvelle");
      if (!e || !modele) return null;
      const ligne = { ...modele, id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ref: `${modele.ref.split("-")[0]}-${Math.random().toString(36).slice(2, 6).toUpperCase()}` };
      data.demandes_site.push(ligne);
      sauve();
      return structuredClone(ligne);
    },
    // Démonstration : rien ne part chez Anthropic, la réponse est simulée à partir de la lecture par règles (assistant-calc.mjs).
    async assistant(corps) {
      await new Promise((r) => setTimeout(r, 700));
      const { simulerLecture, simulerRedaction } = await import("./assistant-calc.mjs");
      const e = corps.entite_id;
      if (!(data.reglages[e] || {}).assistant_ia) return { erreur: "assistant_eteint" };
      // Mêmes droits que la fonction : la base de prix, et créer un dossier pour « lire » ou le voir pour « rediger ».
      const perms = permissionsDans(contexte(), e);
      const requis = corps.usage === "lire" ? ["partenaires.lire", "dossiers.ecrire"] : ["partenaires.lire", "dossiers.lire"];
      if (requis.some((p) => !perms.includes(p))) return { erreur: "droit_manquant" };
      if (corps.usage === "lire") return simulerLecture(corps.texte || "", { prestations: data.prestations.filter((p) => p.entite_id === e), trajets: data.trajets.filter((t) => t.entite_id === e), nomPartenaire: (id) => (data.partenaires.find((p) => p.id === id) || {}).nom || "" }, aujourdhui());
      if (corps.usage === "rediger") return simulerRedaction(corps.faits, ["excursions", "taxi"].includes((data.reglages[e] || {}).fonctionnement) ? "en" : corps.langue);
      return { erreur: "usage_inconnu" };
    },
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
      // Demandes du site : comme lit_demandes_site (migration 30), un rôle qui voit tous les dossiers, jamais l'écran « Nouveau voucher » seul.
      const litDemandes = (eid) => droit(eid, "dossiers.lire") && voitTout(ctx, eid) && !droit(eid, "vouchers.seul");
      out.demandes_site = data.demandes_site.filter((d) => ids.has(d.entite_id) && litDemandes(d.entite_id));
      out.bandeaux_site = data.bandeaux_site.filter((b) => ids.has(b.entite_id) && droit(b.entite_id, "dossiers.lire"));
      out.site_disponible = true;
      out.profils = utilisateur.super_admin ? data.profils : data.profils.filter((p) => p.user_id === uidCourant);
      out.membres = utilisateur.super_admin ? data.membres : data.membres.filter((m) => m.user_id === uidCourant);
      return structuredClone(out);
    },
    async inserer(table, row) {
      const ligne = { id: uid(), created_at: aujourdhui(), ...row };
      garderPrix(table, null, ligne);
      garderBandeau(table, ligne.entite_id);
      // Comme la base (migration 34) : un document écrit toujours sa devise, un dossier a sa colonne d'acompte figé.
      if (table === "documents" && ligne.contenu && !ligne.contenu.devise) ligne.contenu = { ...ligne.contenu, devise: (data.reglages[ligne.entite_id] || {}).devise || "CHF" };
      if (table === "dossiers" && !("acompte_pct" in ligne)) ligne.acompte_pct = null;
      if (table === "dossiers") ligne.responsable_id = ligne.responsable_id || utilisateur.user_id;
      if (TABLES.includes(table) && !["catalogue", "trajets", ...PARTENAIRES_NETS].includes(table)) ligne.cree_par = utilisateur.user_id;
      // Comme fusionner_nets (migration 32) : une insertion pour une réservation qui a déjà sa ligne de nets la complète, l'identifiant reste.
      if (table === "reservations_nets") {
        const existante = data.reservations_nets.find((x) => x.reservation_id === ligne.reservation_id);
        if (existante) {
          const envoyees = Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== null && v !== undefined && k !== "id"));
          const details = Object.fromEntries(Object.entries(envoyees).filter(([k, v]) => !["entite_id", "reservation_id"].includes(k) && JSON.stringify(existante[k] ?? null) !== JSON.stringify(v)).map(([k, v]) => [k, { avant: existante[k] ?? null, apres: v }]));
          Object.assign(existante, envoyees);
          if (Object.keys(details).length) journaliser(table, "update", existante, details);
          sauve();
          return structuredClone(existante);
        }
      }
      data[table].push(ligne);
      if (table === "reservations") remplirNets(ligne, null);
      if (table === "entites") data.reglages[ligne.id] = structuredClone(REGLAGES_NEUTRE);
      // Comme le déclencheur de la base : la création d'un net ou d'une commission note les valeurs saisies.
      const saisies = table === "reservations_nets" ? Object.fromEntries(Object.entries(ligne).filter(([k, v]) => !["id", "entite_id", "reservation_id", "created_at"].includes(k) && v !== null && v !== undefined && v !== "").map(([k, v]) => [k, { avant: null, apres: v }])) : {};
      journaliser(table, "insert", ligne, saisies);
      sauve();
      return structuredClone(ligne);
    },
    async modifier(table, id, patch, avant) {
      const ligne = data[table].find((r) => r.id === id);
      // Même contrôle que la base : la ligne a changé depuis qu'on l'a lue (autre onglet), rien n'est écrit.
      if (avant && ligne.updated_at && ligne.updated_at !== avant) throw Object.assign(new Error(tr("Cette fiche a été modifiée par quelqu'un d'autre depuis que vous l'avez ouverte.")), { conflit: true });
      patch = { ...patch };
      garderPrix(table, ligne, { ...ligne, ...patch });
      garderBandeau(table, ligne.entite_id);
      delete patch.updated_at;
      if (VERSIONNEES.includes(table)) patch.updated_at = new Date().toISOString();
      // Comme le déclencheur de la migration 30 : un changement de statut note qui et quand.
      if (table === "demandes_site" && patch.statut && patch.statut !== ligne.statut) Object.assign(patch, { traitee_le: new Date().toISOString(), traitee_par: utilisateur.user_id });
      const details = {};
      for (const [k, v] of Object.entries(patch)) {
        if (["updated_at", "modifie_par"].includes(k) || JSON.stringify(ligne[k]) === JSON.stringify(v)) continue;
        const court = (x) => JSON.stringify(x ?? null).length <= 120;
        details[k] = court(ligne[k]) && court(v) ? { avant: ligne[k] ?? null, apres: v } : "modifié";
      }
      const copie = table === "reservations" ? structuredClone(ligne) : null;
      Object.assign(ligne, patch);
      if (Object.keys(details).length) journaliser(table, "update", ligne, details);
      if (copie) remplirNets(ligne, copie);
      sauve();
      return structuredClone(ligne);
    },
    async supprimer(table, id) {
      const ligne = data[table].find((r) => r.id === id);
      if (ligne) garderBandeau(table, ligne.entite_id);
      // Un devis ou une facture supprimé seul reste 90 jours restaurable (comme documents_historique en base).
      if (table === "documents" && ligne) data.corbeille_documents = [{ ligne: structuredClone(ligne), supprime_le: new Date().toISOString() }, ...data.corbeille_documents.filter((x) => x.ligne.id !== id)];
      data[table] = data[table].filter((r) => r.id !== id);
      if (table === "dossiers") {
        data.documents = data.documents.filter((d) => d.dossier_id !== id);
        data.paiements = data.paiements.filter((p) => p.dossier_id !== id);
      }
      if (ligne) journaliser(table, "delete", ligne);
      sauve();
    },
    async enregistrerReglages(entiteId, valeur) {
      const ancienne = data.reglages[entiteId];
      if (ancienne && JSON.stringify(ancienne) !== JSON.stringify(valeur)) {
        data.reglages_historique.unshift({ id: Date.now() + Math.random(), entite_id: entiteId, valeur: structuredClone(ancienne), version_du: (data.reglages_maj || {})[entiteId] || null, remplace_le: new Date().toISOString(), remplace_par: utilisateur.user_id });
        const garder = new Set(data.reglages_historique.filter((x) => x.entite_id === entiteId).slice(0, 60));
        data.reglages_historique = data.reglages_historique.filter((x) => x.entite_id !== entiteId || garder.has(x));
      }
      (data.reglages_maj ||= {})[entiteId] = new Date().toISOString();
      data.reglages[entiteId] = valeur;
      journaliser("reglages", "update", { entite_id: entiteId, id: entiteId });
      sauve();
    },
    // Démo : une seule personne, ni historique ni corbeille.
    async versionsDocument() {
      return [];
    },
    async corbeille() {
      return [];
    },
    async restaurerDossier() {
      throw new Error("Indisponible en mode démonstration.");
    },
    async documentsSupprimes(entiteId) {
      const limite = Date.now() - 90 * 86400000;
      return data.corbeille_documents
        .filter((x) => x.ligne.entite_id === entiteId && Date.parse(x.supprime_le) > limite && data.dossiers.some((d) => d.id === x.ligne.dossier_id) && !data.documents.some((d) => d.id === x.ligne.id))
        .map((x) => ({ document_id: x.ligne.id, dossier_id: x.ligne.dossier_id, ref: (data.dossiers.find((d) => d.id === x.ligne.dossier_id) || {}).ref, type: x.ligne.type, numero: (x.ligne.contenu || {}).numero || null, date_emission: x.ligne.date_emission, envoye_le: x.ligne.envoye_le, devise: (x.ligne.contenu || {}).devise, contenu: x.ligne.contenu, supprime_le: x.supprime_le }));
    },
    async restaurerDocument(documentId) {
      const x = data.corbeille_documents.find((c) => c.ligne.id === documentId);
      if (!x) throw new Error(tr("Document introuvable dans la corbeille (plus de 90 jours, ou déjà restauré)."));
      if (!data.dossiers.some((d) => d.id === x.ligne.dossier_id)) throw new Error(tr("Le dossier de ce document a été supprimé : restaurez d'abord le dossier."));
      data.documents.push(structuredClone(x.ligne));
      data.corbeille_documents = data.corbeille_documents.filter((c) => c !== x);
      journaliser("documents", "insert", x.ligne);
      sauve();
      return x.ligne.dossier_id;
    },
    async lireProchainNumero(entiteId, annee) {
      const pris = Math.max(0, ...data.dossiers.filter((d) => d.entite_id === entiteId).map((d) => Number((String(d.ref || "").match(new RegExp(`(?:^|-)${annee}-(\\d+)$`)) || [])[1]) || 0));
      const compteur = data.compteurs_ref[`${entiteId}:${annee}`] || 0;
      return { prochain: Math.max(pris, compteur) + 1, minimum: pris + 1 };
    },
    async fixerProchainNumero(entiteId, annee, prochain) {
      const { minimum } = await this.lireProchainNumero(entiteId, annee);
      if (!(prochain >= minimum)) throw new Error(tr("Le numéro {pris} est déjà donné cette année : choisissez {minimum} ou plus.", { pris: minimum - 1, minimum }));
      data.compteurs_ref[`${entiteId}:${annee}`] = prochain - 1;
      sauve();
      return prochain;
    },
    // Fusion de deux fiches client, comme la fonction fusionner_clients de la base : les dossiers de l'autre fiche passent sur celle qu'on garde,
    // ses champs vides se remplissent, puis l'autre fiche est supprimée.
    async fusionnerClients({ garder, absorbe, patch }) {
      const g = data.clients.find((c) => c.id === garder);
      const a = data.clients.find((c) => c.id === absorbe);
      if (!g || !a || g.id === a.id || g.entite_id !== a.entite_id) throw new Error(tr("Fusion impossible : les deux fiches doivent être deux clients différents de la même entreprise."));
      if (!(droit(g.entite_id, "clients.fusionner") || (droit(g.entite_id, "clients.supprimer") && droit(g.entite_id, "dossiers.ecrire")))) throw new Error(tr("Votre rôle ne permet pas de fusionner des clients."));
      if (!voitTout(contexte(), g.entite_id)) throw new Error(tr("Fusion réservée aux rôles qui voient tous les dossiers de l'entreprise."));
      for (const d of data.dossiers.filter((x) => x.client_id === absorbe)) await this.modifier("dossiers", d.id, { client_id: garder });
      if (patch && Object.keys(patch).length) await this.modifier("clients", garder, patch);
      await this.supprimer("clients", absorbe);
      return garder;
    },
    // Démo : une seule personne, pas de compteur partagé.
    // Comme la base : le compteur tient compte des dossiers que la personne ne voit pas (rôle « ses dossiers », écran « Nouveau voucher »).
    async prochainNumeroRef(entiteId, annee, minimum) {
      const pris = data.dossiers.filter((d) => d.entite_id === entiteId).map((d) => (String(d.ref || "").match(new RegExp(`${annee}-(\\d+)$`)) || [])[1]).filter(Boolean).map(Number);
      // Le compteur fixé par l'administratrice (saut de numérotation) compte aussi, comme en base.
      const cle = `${entiteId}:${annee}`;
      const n = Math.max(minimum, data.compteurs_ref[cle] || 0, ...pris) + 1;
      data.compteurs_ref[cle] = n;
      sauve();
      return n;
    },
    async definirRappelH1(actif) {
      utilisateur.rappel_h1 = !!actif;
      const p = data.profils.find((x) => x.user_id === utilisateur.user_id);
      if (p) p.rappel_h1 = !!actif;
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
    // La ligne de nets d'une réservation, relue après une écriture (la base, ou ici remplirNets, a pu la recalculer). Rien sans le droit « nets ».
    async netsReservations(ids) {
      const set = new Set(ids);
      return data.reservations_nets.filter((x) => set.has(x.reservation_id) && droit(x.entite_id, "partenaires.nets")).map((x) => structuredClone(x));
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
    async analyseFaits({ entiteId, debut, fin, jour }) {
      const p = permissionsDans(contexte(), entiteId);
      if (!(p.includes("analytics.voir") && p.includes("finances.voir"))) throw new Error(tr("Droit insuffisant pour voir les analyses"));
      const de = (t) => (data[t] || []).filter((r) => r.entite_id === entiteId);
      return faitsLocal({ dossiers: de("dossiers"), documents: de("documents"), paiements: de("paiements"), clients: de("clients"), profils: data.profils, reglages: data.reglages[entiteId], reservations: de("reservations"), reservations_nets: de("reservations_nets"), partenaires: de("partenaires"), prestations: de("prestations") }, { debut, fin, jour, nets: p.includes("partenaires.nets") });
    },
    async journal({ entiteId, table, userId, avant, limite = 50 }) {
      if (!permissionsDans(contexte(), entiteId).includes("journal.voir")) return [];
      const nets = permissionsDans(contexte(), entiteId).includes("partenaires.nets");
      return structuredClone(
        data.journal
          .filter((l) => l.entite_id === entiteId && (!table || l.table_name === table) && (!userId || l.user_id === userId) && (!avant || l.created_at < avant) && (nets || l.table_name !== "reservations_nets"))
          .slice(0, limite)
          .map((l) => ({ ...l, auteur: nomDe(l.user_id) }))
      );
    },
    async toutesTaches(entiteId) {
      return structuredClone(data.taches.filter((t) => t.entite_id === entiteId));
    },
    async supprimerAbsents(entiteId, absents) {
      const p = new Set(absents.partenaires);
      const s = new Set(absents.prestations);
      const t = new Set(absents.trajets);
      data.taches = data.taches.filter((x) => !(x.entite_id === entiteId && p.has(x.partenaire_id)));
      data.trajets = data.trajets.filter((x) => !t.has(x.id));
      data.trajets_nets = data.trajets_nets.filter((x) => !t.has(x.trajet_id));
      data.prestations = data.prestations.filter((x) => !s.has(x.id));
      data.prestations_nets = data.prestations_nets.filter((x) => !s.has(x.prestation_id));
      data.partenaires = data.partenaires.filter((x) => !p.has(x.id));
      data.partenaires_prives = data.partenaires_prives.filter((x) => !p.has(x.partenaire_id));
      for (const r of data.reservations) {
        if (s.has(r.prestation_id)) r.prestation_id = null;
        if (t.has(r.trajet_id)) r.trajet_id = null;
        if (p.has(r.partenaire_id)) r.partenaire_id = null;
      }
      sauve();
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
