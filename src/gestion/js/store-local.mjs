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
import { donneesDemoAgence, ORG_AGENCE } from "./demo-agence.mjs";
import { avecNomsLies, peutUtiliserPartages } from "./partage-clients-calc.mjs";
import { journalAssistantDemo } from "./demo-assistant.mjs";

// v13 (lot D, 17.11.2026) : rôle Administrateur calculé (tous_droits), droit « partenaires.prix », historique des réglages.
// /gestion/?demo=agence (19.11.2026) : la démo des prospects, une agence fictive sans rien de Koh Lanta (demo-agence.mjs), gardée à part.
const AGENCE = typeof location !== "undefined" && new URLSearchParams(location.search).get("demo") === "agence";
const CLE = AGENCE ? "gestion-demo-agence-v2" : "gestion-zwald-demo-v13";
const CLE_UTILISATEUR = AGENCE ? "gestion-demo-agence-utilisateur" : "gestion-zwald-demo-utilisateur";
// Tables dont chaque modification pose une nouvelle version (comme le déclencheur tenir_a_jour de la base).
const VERSIONNEES = ["clients", "documents", "reservations", "partenaires", "prestations", "dossiers", "paiements", "taches", "demandes_site", "bandeaux_site"];
const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue", "taches", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets", "demandes_site", "bandeaux_site"];
const PARTENAIRES_PUBLIC = ["partenaires", "prestations", "trajets"];
const PARTENAIRES_NETS = ["partenaires_prives", "prestations_nets", "trajets_nets", "reservations_nets"];
const LIMITE_DEMO = 1.5 * 1024 * 1024;
const ORG_DEMO = "demo-organisation";

export function creer() {
  let data;
  let utilisateur;
  const charge = () => {
    try {
      data = JSON.parse(localStorage.getItem(CLE));
    } catch {
      data = null;
    }
    // Une démo neuve est gardée tout de suite : un second onglet de ce navigateur ouvre la même (sinon il en créerait une autre, aux autres identifiants).
    const neuve = !data;
    if (!data) data = AGENCE ? donneesDemoAgence(aujourdhui(), ajouterJours) : donneesDemo(aujourdhui(), ajouterJours);
    // Demandes et bandeau du site : posés aussi dans une démo déjà enregistrée dans ce navigateur (créée avant la migration 30).
    if (!data.demandes_site) data.demandes_site = demandesDemo({ entites: data.entites, ajd: aujourdhui(), ajouterJours, uid });
    if (!data.bandeaux_site) data.bandeaux_site = bandeauxDemo({ entites: data.entites, ajd: aujourdhui(), uid });
    for (const t of TABLES) data[t] = data[t] || [];
    data.fiduciaire_factures = data.fiduciaire_factures || [];
    // Hôtels situés (migration 48), comme la base : une ligne par hôtel et par entreprise.
    data.hotels_lieux = data.hotels_lieux || [];
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
    // Organisations (migration 42) et éditeur du logiciel (migration 45) : posés aussi dans une démo déjà enregistrée dans ce navigateur.
    if (!data.organisations) data.organisations = [{ id: ORG_DEMO, nom: "Organisation démo", fuseau: "Asia/Bangkok", langue: "en", statut: "actif", options: [], created_at: aujourdhui() }];
    for (const e of data.entites) if (!e.organisation_id) e.organisation_id = ORG_DEMO;
    for (const p of data.profils) if (!("organisation_id" in p)) p.organisation_id = ORG_DEMO;
    // L'éditeur a son compte dans l'organisation de démo (comme Jérémy chez Zwald) : elle n'est pas un de ses clients.
    // La démo des prospects n'a pas de compte d'éditeur : elle montre l'outil d'une agence, pas l'écran de Jérémy.
    if (!AGENCE && !data.profils.some((p) => p.plateforme)) data.profils.push({ user_id: uid(), email: "editeur@demo.local", nom: "Éditeur du logiciel", super_admin: false, plateforme: true, actif: true, organisation_id: ORG_DEMO, langue: null });
    for (const p of data.profils) if (p.plateforme && !p.organisation_id) p.organisation_id = ORG_DEMO;
    // Dernière connexion (auth.users.last_sign_in_at) : l'équipe de démo travaille déjà ; un client neuf n'a encore personne de connecté.
    for (const p of data.profils) if (!("connecte_le" in p)) p.connecte_le = p.organisation_id === ORG_DEMO ? aujourdhui() : null;
    // Fiches clients partagées (migration 46) : l'agence (voyages sur mesure) partage ses clients avec les entreprises d'excursions et de taxi
    // de la même organisation, comme ZTP avec Secret et Taxi chez Zwald. Posé aussi dans une démo déjà enregistrée dans ce navigateur.
    if (!data.partages_clients) {
      const f = (e) => ((data.reglages || {})[e.id] || {}).fonctionnement;
      data.partages_clients = data.entites.filter((s) => !["excursions", "taxi"].includes(f(s))).flatMap((s) => data.entites.filter((c) => c.id !== s.id && c.organisation_id === s.organisation_id && ["excursions", "taxi"].includes(f(c))).map((c) => ({ source_id: s.id, cible_id: c.id, organisation_id: s.organisation_id })));
    }
    let choisi = null;
    try {
      choisi = localStorage.getItem(CLE_UTILISATEUR);
    } catch {
      // stockage refusé : on reste sur l'administratrice de démo
    }
    utilisateur = data.profils.find((p) => p.user_id === choisi) || data.profils.find((p) => p.super_admin);
    if (neuve) sauve();
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
  const ecouteurs = new Set();

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
  // Comme la base (migration 42) : l'administrateur ne voit que les entreprises de son organisation, l'éditeur du logiciel aucune.
  const monOrg = () => utilisateur.organisation_id || null;
  const accessibles = () =>
    utilisateur.super_admin
      ? data.entites.filter((e) => monOrg() && e.organisation_id === monOrg()).map((e) => e.id)
      : data.membres.filter((m) => m.user_id === utilisateur.user_id && (data.entites.find((e) => e.id === m.entite_id) || {}).organisation_id === monOrg()).map((m) => m.entite_id);
  // Comme organisation_neuve (migration 45) : active, personne de connecté, aucune fiche client.
  const organisationNeuve = (org) =>
    data.organisations.some((o) => o.id === org && o.statut === "actif") &&
    !data.profils.some((p) => p.organisation_id === org && p.connecte_le) &&
    !data.clients.some((c) => (data.entites.find((e) => e.id === c.entite_id) || {}).organisation_id === org);
  const nomDe = (id) => (data.profils.find((p) => p.user_id === id) || {}).nom || null;

  // Comme controler_client_dossier (migration 46) : un dossier ne prend la fiche d'une autre entreprise que si elle la partage avec la sienne,
  // et seulement pour l'administration qui lit cette fiche. Un dossier déjà relié garde son client.
  const garderClientDossier = (table, avant, apres) => {
    if (table !== "dossiers" || !apres.client_id) return;
    if (avant && avant.client_id === apres.client_id && avant.entite_id === apres.entite_id) return;
    const c = data.clients.find((x) => x.id === apres.client_id);
    if (!c || c.entite_id === apres.entite_id) return;
    if (!(data.partages_clients || []).some((p) => p.source_id === c.entite_id && p.cible_id === apres.entite_id)) throw new Error(tr("Ce client appartient à une autre entreprise qui ne partage pas ses clients avec celle-ci."));
    const ctx = contexte();
    const permis = peutUtiliserPartages({ superAdmin: !!utilisateur.super_admin, permissionsSource: permissionsDans(ctx, c.entite_id), permissionsCible: permissionsDans(ctx, apres.entite_id), voitToutSource: voitTout(ctx, c.entite_id) });
    if (!permis) throw new Error(tr("Seule l'administration utilise les clients d'une autre entreprise."));
  };
  // Comme garder_entite_client (migration 46) : une fiche utilisée par des dossiers ne change pas d'entreprise.
  const garderEntiteClient = (table, avant, apres) => {
    if (table === "clients" && avant && apres.entite_id && apres.entite_id !== avant.entite_id && data.dossiers.some((d) => d.client_id === avant.id)) throw new Error(tr("Ce client a des dossiers : il ne change pas d'entreprise."));
  };

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
      const lienDemo = (type) => `${location.origin}${location.pathname}?demo#demo-${type}-${Math.random().toString(36).slice(2, 10)}`;
      // Nouveau client (éditeur seulement), comme la fonction « invitation » puis creer_organisation : l'organisation et son administrateur.
      if (corps.action === "creer_client") {
        if (!utilisateur.plateforme) return { erreur: "droit_manquant" };
        const email = String(corps.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { erreur: "email_invalide" };
        const nomOrg = String(corps.organisation || "").trim().slice(0, 120);
        if (!nomOrg) return { erreur: "organisation_invalide" };
        if (data.profils.some((p) => (p.email || "").toLowerCase() === email)) return { erreur: "deja_inscrit" };
        const org = { id: uid(), nom: nomOrg, fuseau: corps.fuseau || "Asia/Bangkok", langue: corps.langue === "fr" ? "fr" : "en", statut: "actif", options: [], created_at: new Date().toISOString() };
        data.organisations.push(org);
        const p = { user_id: uid(), email, nom: corps.nom || null, super_admin: true, plateforme: false, actif: true, organisation_id: org.id, langue: org.langue, connecte_le: null, created_at: new Date().toISOString() };
        data.profils.push(p);
        sauve();
        return { user_id: p.user_id, organisation_id: org.id, lien: lienDemo("invitation") };
      }
      // Reprise d'un client créé à moitié (comme client_a_reprendre) : un nouveau lien pour sa première administratrice.
      if (corps.action === "reprendre_client") {
        if (!utilisateur.plateforme) return { erreur: "droit_manquant" };
        if (!organisationNeuve(corps.organisation_id)) return { erreur: "client_en_service" };
        const cible = data.profils.filter((p) => p.organisation_id === corps.organisation_id && p.super_admin && p.actif).sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))[0];
        if (!cible) return { erreur: "personne_inconnue" };
        return { lien: lienDemo("mot-de-passe"), email: cible.email, nom: cible.nom || "", langue: cible.langue || "en", user_id: cible.user_id };
      }
      if (!utilisateur.super_admin) return { erreur: "droit_manquant" };
      if (corps.action === "inviter") {
        const email = String(corps.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { erreur: "email_invalide" };
        if (data.profils.some((p) => (p.email || "").toLowerCase() === email)) return { erreur: "deja_inscrit" };
        const acces = corps.acces || [];
        if (!acces.every((a) => data.roles.some((r) => r.id === a.role_id && r.entite_id === a.entite_id))) return { erreur: "acces_invalide" };
        const p = { user_id: uid(), email, nom: corps.nom || null, super_admin: false, actif: true, langue: corps.langue || null, organisation_id: monOrg() };
        data.profils.push(p);
        for (const a of acces) data.membres.push({ user_id: p.user_id, entite_id: a.entite_id, role_id: a.role_id });
        sauve();
        return { user_id: p.user_id, lien: lienDemo("invitation") };
      }
      const cible = data.profils.find((p) => p.user_id === corps.user_id && p.organisation_id === monOrg());
      if (!cible) return { erreur: "personne_inconnue" };
      if (corps.action === "lien_mot_de_passe") return { lien: lienDemo("mot-de-passe") };
      if (corps.action === "supprimer") {
        if (cible.user_id === utilisateur.user_id) return { erreur: "soi_meme" };
        if (cible.super_admin && data.profils.filter((p) => p.super_admin && p.actif && p.organisation_id === monOrg()).length <= 1) return { erreur: "derniere_administratrice" };
        data.profils = data.profils.filter((p) => p !== cible);
        data.membres = data.membres.filter((m) => m.user_id !== cible.user_id);
        for (const d of data.dossiers) if (d.responsable_id === cible.user_id) d.responsable_id = null;
        sauve();
        return { ok: true };
      }
      return { erreur: "action_inconnue" };
    },
    // Mise en route d'un client (migration 45, installer_entreprise) : mêmes contrôles que la base, données du modèle métier.
    async installerEntreprise({ organisation, nom, slug, reglages, roles, catalogue }) {
      await new Promise((r) => setTimeout(r, 200));
      if (!utilisateur.plateforme) throw new Error(tr("Réservé à l'éditeur du logiciel"));
      if (!data.organisations.some((o) => o.id === organisation)) throw new Error(tr("Organisation inconnue"));
      if (data.entites.some((e) => e.organisation_id === organisation)) throw new Error(tr("Cette organisation a déjà une entreprise : son administrateur règle la suite"));
      if (!organisationNeuve(organisation)) throw new Error(tr("Client déjà en service ou suspendu : son administrateur règle la suite"));
      if (!roles.length || !roles[0].tous_droits || roles.slice(1).some((r) => r.tous_droits)) throw new Error(tr("Rôles invalides"));
      const e = { id: uid(), created_at: aujourdhui(), slug, nom, actif: true, ordre: 1, organisation_id: organisation };
      data.entites.push(e);
      data.reglages[e.id] = structuredClone(reglages);
      // Comme la base : seul l'Administrateur (premier rôle) est un rôle système « tous droits », les autres restent modifiables par le client.
      for (const [i, r] of roles.entries()) data.roles.push({ id: uid(), created_at: aujourdhui(), entite_id: e.id, ...structuredClone(r), systeme: i === 0, tous_droits: i === 0 });
      for (const [i, c] of (catalogue || []).entries()) data.catalogue.push({ id: uid(), created_at: aujourdhui(), entite_id: e.id, ...structuredClone(c), ordre: i + 1, actif: true });
      sauve();
      return e.id;
    },
    // Liste des clients de l'éditeur (comme clients_plateforme, migration 45).
    async clientsPlateforme() {
      if (!utilisateur.plateforme) throw new Error(tr("Réservé à l'éditeur du logiciel"));
      return data.organisations
        .map((o) => ({ ...o, entreprises: data.entites.filter((e) => e.organisation_id === o.id).length, neuve: organisationNeuve(o.id), admin_email: (data.profils.filter((p) => p.organisation_id === o.id && p.super_admin).sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))[0] || {}).email || null }))
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
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
    // En direct, comme Supabase Realtime : une demande simulée ici, ou une écriture de la démo dans un autre onglet de ce navigateur
    // (événement « storage »), prévient l'outil, qui relit (synchroniser) au lieu d'attendre la minute suivante.
    synchronisable: true,
    ecouter(tables, rappel) {
      const prevenir = () => tables.forEach((t) => rappel(t));
      ecouteurs.add(prevenir);
      const autreOnglet = (e) => {
        if (e.key !== CLE) return;
        // Les données de l'autre onglet, sans changer l'utilisatrice de démo choisie ici.
        const ici = utilisateur.user_id;
        charge();
        utilisateur = data.profils.find((p) => p.user_id === ici) || utilisateur;
        prevenir();
      };
      if (typeof window !== "undefined") window.addEventListener("storage", autreOnglet);
      return () => {
        ecouteurs.delete(prevenir);
        if (typeof window !== "undefined") window.removeEventListener("storage", autreOnglet);
      };
    },
    async simulerDemandeSite(entiteId) {
      const e = data.entites.find((x) => x.id === entiteId);
      const modele = demandesDemo({ entites: data.entites, ajd: aujourdhui(), ajouterJours, uid }).find((d) => d.entite_id === entiteId && d.statut === "nouvelle");
      if (!e || !modele) return null;
      const ligne = { ...modele, id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ref: `${modele.ref.split("-")[0]}-${Math.random().toString(36).slice(2, 6).toUpperCase()}` };
      data.demandes_site.push(ligne);
      sauve();
      setTimeout(() => ecouteurs.forEach((f) => f()), 0);
      return structuredClone(ligne);
    },
    // Hôtels situés (migration 48) : mêmes droits que la base. Lire avec la base de prix, ajouter ou corriger avec « dossiers.ecrire » en plus.
    async hotelsLieux(entiteId) {
      if (!permissionsDans(contexte(), entiteId).includes("partenaires.lire")) return [];
      return structuredClone(data.hotels_lieux.filter((l) => l.entite_id === entiteId));
    },
    async enregistrerHotelLieu(entiteId, ligne) {
      const perms = permissionsDans(contexte(), entiteId);
      if (!perms.includes("partenaires.lire") || !perms.includes("dossiers.ecrire")) throw new Error("Droit insuffisant");
      const avant = data.hotels_lieux.find((l) => l.entite_id === entiteId && l.cle === ligne.cle);
      const maj = { ...ligne, entite_id: entiteId, maj_le: new Date().toISOString(), maj_par: utilisateur.user_id };
      if (avant) Object.assign(avant, maj);
      else data.hotels_lieux.push({ id: uid(), cree_le: maj.maj_le, ...maj });
      sauve();
      return structuredClone(data.hotels_lieux.find((l) => l.entite_id === entiteId && l.cle === ligne.cle));
    },
    // Suivi de l'assistant : comme la base, les lignes des entreprises où la personne lit le journal, plus les siennes. Le journal fictif est
    // créé à la première ouverture de l'écran (demo-assistant.mjs).
    async assistantSuivi({ entiteIds, depuis }) {
      if (!data.assistant_journal) {
        // Toutes les entreprises de la démo : chaque utilisateur de démo n'en voit ensuite que ce que ses droits lui montrent.
        const { lignes, retouches } = journalAssistantDemo({ entites: data.entites, profils: data.profils, ajd: aujourdhui() });
        data.assistant_journal = lignes;
        data.assistant_retouches = [...(data.assistant_retouches || []), ...retouches];
        sauve();
      }
      const voit = (l) => entiteIds.includes(l.entite_id) && l.cree_le >= depuis && (l.user_id === utilisateur.user_id || permissionsDans(contexte(), l.entite_id).includes("journal.voir"));
      const noms = {};
      for (const p of data.profils) noms[p.user_id] = p.nom || p.email;
      return { lignes: structuredClone(data.assistant_journal.filter(voit)), retouches: structuredClone((data.assistant_retouches || []).filter(voit)), noms };
    },
    async noterRetouche({ entiteId, usage, part }) {
      if (!Number.isInteger(part) || part < 0 || part > 100) return false;
      (data.assistant_retouches = data.assistant_retouches || []).push({ cree_le: new Date().toISOString(), user_id: utilisateur.user_id, entite_id: entiteId, usage, part_modifiee: part });
      sauve();
      return true;
    },
    // Démonstration : rien ne part chez Anthropic, la réponse est simulée (assistant-calc.mjs pour la lecture, itineraire-calc.mjs pour la demande
    // de prix et d'horaires), dans la forme exacte que renvoie la fonction.
    async assistant(corps) {
      await new Promise((r) => setTimeout(r, 700));
      const e = corps.entite_id;
      if (!(data.reglages[e] || {}).assistant_ia) return { erreur: "assistant_eteint" };
      // Mêmes droits que la fonction : la base de prix et créer un dossier. « rediger » est refusé comme par la fonction (retiré le 19.11.2026).
      if (!["lire", "itineraire", "situer", "repondre_itineraire", "brochure"].includes(corps.usage)) return { erreur: "usage_inconnu" };
      const perms = permissionsDans(contexte(), e);
      // Brochure : droits de la fonction (créer les tarifs et leurs prix de vente), fichiers contrôlés comme par elle, réponse tirée du catalogue.
      if (corps.usage === "brochure") {
        const b = await import("./brochure-calc.mjs");
        if (b.DROITS_BROCHURE.some((p) => !perms.includes(p))) return { erreur: "droit_manquant" };
        const fichiers = Array.isArray(corps.fichiers) ? corps.fichiers : [];
        if (!fichiers.length) return { erreur: "fichiers_absents" };
        if (fichiers.length > 6) return { erreur: "trop_de_fichiers" };
        if (fichiers.some((f) => !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f && f.media_type))) return { erreur: "fichier_type" };
        if (!data.partenaires.some((p) => p.id === corps.partenaire_id && p.entite_id === e)) return { erreur: "partenaire_invalide" };
        return b.simulerBrochure({ partenaireId: corps.partenaire_id, prestations: data.prestations.filter((p) => p.entite_id === e), trajets: data.trajets.filter((t) => t.entite_id === e) });
      }
      const requis = ["partenaires.lire", "dossiers.ecrire"];
      if (requis.some((p) => !perms.includes(p))) return { erreur: "droit_manquant" };
      const trajets = data.trajets.filter((t) => t.entite_id === e);
      if (corps.usage !== "lire") {
        const it = await import("./itineraire-calc.mjs");
        if (corps.usage === "itineraire") return it.simulerItineraire(corps.texte || "", aujourdhui());
        if (corps.usage === "situer") return it.simulerSituer((corps.hotels || []).slice(0, 8), it.lieuxDuCatalogue(trajets, data.partenaires.filter((p) => p.entite_id === e)));
        return it.simulerReponse(corps.faits || { langue: "fr", trajets: [] });
      }
      const { simulerLecture } = await import("./assistant-calc.mjs");
      return simulerLecture(corps.texte || "", { prestations: data.prestations.filter((p) => p.entite_id === e), trajets, nomPartenaire: (id) => (data.partenaires.find((p) => p.id === id) || {}).nom || "" }, aujourdhui());
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
      // Comme clients_lies (migration 46) : le nom seul du client d'une autre entreprise sur un dossier visible dont la fiche n'est pas lisible.
      const lus = new Set(out.clients.map((c) => c.id));
      const lies = data.clients.filter((c) => !lus.has(c.id) && dossiers.some((d) => d.client_id === c.id && d.entite_id !== c.entite_id)).map(({ id, entite_id, civilite, prenom, nom }) => ({ id, entite_id, civilite, prenom, nom }));
      out.clients = avecNomsLies(out.clients, lies);
      out.partages_clients = (data.partages_clients || []).filter((p) => p.organisation_id === monOrg());
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
      // Comme la base après la migration 42 : sa propre organisation, toutes pour l'éditeur du logiciel ; l'administrateur voit les comptes de la sienne.
      out.organisations = utilisateur.plateforme ? data.organisations : data.organisations.filter((o) => o.id === monOrg());
      out.profils = utilisateur.super_admin ? data.profils.filter((p) => p.organisation_id === monOrg()) : data.profils.filter((p) => p.user_id === uidCourant);
      out.membres = utilisateur.super_admin ? data.membres.filter((m) => ids.has(m.entite_id)) : data.membres.filter((m) => m.user_id === uidCourant);
      return structuredClone(out);
    },
    async inserer(table, row) {
      const ligne = { id: uid(), created_at: aujourdhui(), ...row };
      garderPrix(table, null, ligne);
      garderClientDossier(table, null, ligne);
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
      garderClientDossier(table, ligne, { ...ligne, ...patch });
      garderEntiteClient(table, ligne, { ...ligne, ...patch });
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
      // Comme la base (migration 46) : une fiche de la cible se rattache aussi à la fiche de l'entreprise qui partage ses clients avec elle.
      const partage = !!g && !!a && (data.partages_clients || []).some((p) => p.source_id === g.entite_id && p.cible_id === a.entite_id);
      if (!g || !a || g.id === a.id || (g.entite_id !== a.entite_id && !partage)) throw new Error(tr("Fusion impossible : les deux fiches doivent être deux clients différents de la même entreprise."));
      if (!(droit(a.entite_id, "clients.fusionner") || (droit(a.entite_id, "clients.supprimer") && droit(a.entite_id, "dossiers.ecrire")))) throw new Error(tr("Votre rôle ne permet pas de fusionner des clients."));
      if (!voitTout(contexte(), a.entite_id)) throw new Error(tr("Fusion réservée aux rôles qui voient tous les dossiers de l'entreprise."));
      if (g.entite_id !== a.entite_id && !(peutUtiliserPartages({ superAdmin: !!utilisateur.super_admin, permissionsSource: permissionsDans(contexte(), g.entite_id), permissionsCible: permissionsDans(contexte(), a.entite_id), voitToutSource: voitTout(contexte(), g.entite_id) }) && droit(g.entite_id, "clients.ecrire"))) throw new Error(tr("Seule l'administration rattache un client à la fiche d'une autre entreprise."));
      for (const d of data.dossiers.filter((x) => x.client_id === absorbe)) await this.modifier("dossiers", d.id, { client_id: garder });
      if (patch && Object.keys(patch).length) await this.modifier("clients", garder, patch);
      await this.supprimer("clients", absorbe);
      return garder;
    },
    // « Partage ses clients avec » (migration 46) : l'administration générale, deux entreprises de son organisation.
    async partagerClients(sourceId, cibleId, actif) {
      const org = (id) => (data.entites.find((e) => e.id === id) || {}).organisation_id;
      if (!utilisateur.super_admin || !monOrg() || org(sourceId) !== monOrg() || org(cibleId) !== monOrg() || sourceId === cibleId) throw new Error(tr("Réservé à l'administration générale, entre deux entreprises de l'organisation."));
      data.partages_clients = (data.partages_clients || []).filter((p) => !(p.source_id === sourceId && p.cible_id === cibleId));
      if (actif) data.partages_clients.push({ source_id: sourceId, cible_id: cibleId, organisation_id: monOrg() });
      sauve();
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
      const org = (data.entites.find((e) => e.id === entiteId) || {}).organisation_id;
      return data.profils.filter((p) => p.actif && ((p.super_admin && p.organisation_id === org) || ids.has(p.user_id))).map((p) => ({ user_id: p.user_id, nom: p.nom, email: p.email }));
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
    utilisateursDemo: () => data.profils.map((p) => ({ id: p.user_id, nom: p.nom || p.email, super_admin: p.super_admin, plateforme: !!p.plateforme, organisation: (data.organisations.find((o) => o.id === p.organisation_id) || {}).nom || "", client: p.organisation_id !== (AGENCE ? ORG_AGENCE : ORG_DEMO) })),
    utilisateurDemo: () => utilisateur.user_id,
    changerUtilisateurDemo(id) {
      utilisateur = data.profils.find((p) => p.user_id === id) || utilisateur;
      // Se connecter avec ce compte : son client n'est plus « neuf » (comme last_sign_in_at).
      utilisateur.connecte_le = utilisateur.connecte_le || new Date().toISOString();
      sauve();
    },
  };
}
