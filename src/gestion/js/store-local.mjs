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
import { whatsappDemo } from "./demo-whatsapp.mjs";
import { marqueUnifiee, partageReciproque, partageClientsPermisUnifie, doublonsLocaux } from "./espace-unifie-calc.mjs";
import { marqueEntite, lecteurWhatsApp } from "./whatsapp-calc.mjs";

// v13 (lot D, 17.11.2026) : rôle Administrateur calculé (tous_droits), droit « partenaires.prix », historique des réglages.
// /gestion/?demo=agence (19.11.2026) : la démo des prospects, une agence fictive sans rien de Koh Lanta (demo-agence.mjs), gardée à part.
const AGENCE = typeof location !== "undefined" && new URLSearchParams(location.search).get("demo") === "agence";
const CLE = AGENCE ? "gestion-demo-agence-v2" : "gestion-zwald-demo-v13";
const CLE_UTILISATEUR = AGENCE ? "gestion-demo-agence-utilisateur" : "gestion-zwald-demo-utilisateur";
// Tables dont chaque modification pose une nouvelle version (comme le déclencheur tenir_a_jour de la base).
const VERSIONNEES = ["clients", "documents", "reservations", "partenaires", "prestations", "dossiers", "paiements", "taches", "demandes_site", "bandeaux_site", "whatsapp_conversations"];
// Boîte WhatsApp (migrations 58 et 59) : la démo des prospects n'en a pas, comme une agence qui n'a pas relié son numéro.
const TABLES_WHATSAPP_DEMO = ["whatsapp_conversations", "whatsapp_messages", "whatsapp_propositions", "whatsapp_reglages"];
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
    // Conversations de l'agent (migration 52), comme la base : à la personne qui les ouvre.
    data.agent_conversations = data.agent_conversations || [];
    data.agent_messages = data.agent_messages || [];
    data.agent_cartes = data.agent_cartes || [];
    // Pièces jointes (migration 55) : en démonstration, seulement leur nom et leur type (le navigateur ne garde pas les fichiers).
    data.agent_fichiers = data.agent_fichiers || [];
    data.ameliorations = data.ameliorations || [];
    data.temps_trajets = data.temps_trajets || [];
    data.liaisons_ferry = data.liaisons_ferry || [];
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
    // Boîte WhatsApp : posée aussi dans une démo déjà enregistrée dans ce navigateur (créée avant la migration 58).
    // Gardée tout de suite : les identifiants des conversations restent les mêmes d'un rechargement à l'autre (adresse « ?c=… »).
    const sansWhatsApp = !data.whatsapp_conversations;
    if (sansWhatsApp && AGENCE) Object.assign(data, Object.fromEntries(TABLES_WHATSAPP_DEMO.map((t) => [t, []])));
    else if (sansWhatsApp) {
      // Suivi (migrations 61 et 62) : un dossier d'excursions non soldé avec son client.
      const secret = data.entites.find((e) => e.slug === "excursions" || e.slug === "secret");
      const nonSolde = (d) => {
        const total = totalDossier(data.documents.filter((x) => x.dossier_id === d.id));
        return total > 0 && sommePaiements(data.paiements.filter((x) => x.dossier_id === d.id)) < total;
      };
      const dossier = secret ? data.dossiers.find((d) => d.entite_id === secret.id && !d.annule && d.client_id && nonSolde(d)) : null;
      const suivi = dossier ? { dossier, client: data.clients.find((x) => x.id === dossier.client_id) || null, ajd: aujourdhui(), ajouterJours } : null;
      const { taches: tachesWa = [], ...wa } = whatsappDemo({ entites: data.entites, clients: data.clients, dossiers: data.dossiers, uid, organisation: ORG_DEMO, suivi });
      Object.assign(data, wa);
      data.taches = [...(data.taches || []).filter((t) => !String(t.titre || "").startsWith("WhatsApp, ")), ...tachesWa];
    }
    for (const t of TABLES_WHATSAPP_DEMO) data[t] = data[t] || [];
    // Espace unifié Secret et Taxi (migration 63) : fiches partagées dans les deux sens, deux dossiers liés, une fiche en double et une
    // conversation de l'Assistant dans chaque entreprise. Posé une fois, aussi dans une démo déjà enregistrée.
    const sansUnifie = !AGENCE && !data.demo_unifie;
    if (sansUnifie) semerUnifie();
    if (neuve || sansWhatsApp || sansUnifie) sauve();
  };
  // Le partage réciproque Secret et Taxi (migration 63) : posé par la base pour l'organisation de Zwald seulement. La démonstration le pose à la
  // première carte mixte, comme une organisation qui l'a coché dans ses réglages ; l'outil le relit aussitôt.
  function partageReciproqueDemo(a, b) {
    data.partages_clients = data.partages_clients || [];
    let pose = false;
    for (const [s, c] of [[a.id, b.id], [b.id, a.id]]) if (!data.partages_clients.some((p) => p.source_id === s && p.cible_id === c)) (data.partages_clients.push({ source_id: s, cible_id: c, organisation_id: a.organisation_id }), (pose = true));
    return pose;
  }
  function semerUnifie() {
    data.demo_unifie = 1;
    const secret = data.entites.find((e) => e.slug === "excursions" || e.slug === "secret");
    const taxi = data.entites.find((e) => e.slug === "taxi");
    if (!secret || !taxi) return;
    // Deux dossiers liés de la même demande : un dossier d'excursions et une course de Taxi, sur la même fiche.
    const dExc = data.dossiers.find((d) => d.entite_id === secret.id && !d.annule && d.client_id && !d.dossier_lie_id);
    const dTaxi = data.dossiers.find((d) => d.entite_id === taxi.id && !d.annule && !d.dossier_lie_id);
    if (dExc && dTaxi) Object.assign(dTaxi, { client_id: dExc.client_id }), (dTaxi.dossier_lie_id = dExc.id), (dExc.dossier_lie_id = dTaxi.id);
    // Une fiche en double : le même client noté une seconde fois chez Taxi (même téléphone, même nom).
    const autre = data.clients.find((c) => c.entite_id === secret.id && c.telephone && (!dExc || c.id !== dExc.client_id));
    if (autre) data.clients.push({ ...structuredClone(autre), id: uid(), entite_id: taxi.id, created_at: aujourdhui(), notes: "" });
    // Une conversation de l'Assistant chez Taxi, pour la liste des deux entreprises.
    const admin = data.profils.find((p) => p.super_admin);
    data.agent_conversations = data.agent_conversations || [];
    if (admin) data.agent_conversations.push({ id: uid(), entite_id: taxi.id, user_id: admin.user_id, titre: "Transfert aéroport de Krabi", apercu: "Course pour 2 personnes, pickup à calculer.", dossier_id: null, statut: "ouverte", cree_le: new Date(Date.now() - 3600000).toISOString(), maj_le: new Date(Date.now() - 3600000).toISOString(), demo_etat: {} });
  }
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
  // Boîte WhatsApp, comme whatsapp_admin et whatsapp_lit (migration 58) : un administrateur de Secret ou de Taxi lit les conversations de son
  // entreprise ; une conversation à trier se lit par un administrateur de l'une des deux.
  const adminWhatsApp = (entiteId) => {
    const e = data.entites.find((x) => x.id === entiteId);
    return !!e && accessibles().includes(entiteId) && lecteurWhatsApp({ entite: e, superAdmin: false, permissions: permissionsDans(contexte(), entiteId), voitTout: voitTout(contexte(), entiteId) });
  };
  // Migration 63 : la boîte est commune en LECTURE (un administrateur de Secret ou de Taxi lit toutes les conversations de l'organisation) ;
  // les écritures demandent toujours d'administrer l'entreprise de la conversation (whatsapp_ecrit).
  const adminUneDesDeux = () => data.entites.some((e) => e.organisation_id === monOrg() && marqueEntite(e) && adminWhatsApp(e.id));
  const litWhatsApp = (entiteId) => (!entiteId || (data.entites.find((e) => e.id === entiteId) || {}).organisation_id === monOrg()) && adminUneDesDeux();
  const ecritWhatsApp = (entiteId) => (entiteId ? adminWhatsApp(entiteId) : adminUneDesDeux());
  const conversationLue = (id) => data.whatsapp_conversations.find((c) => c.id === id && c.organisation_id === monOrg() && litWhatsApp(c.entite_id)) || null;
  const conversationEcrite = (id) => data.whatsapp_conversations.find((c) => c.id === id && c.organisation_id === monOrg() && ecritWhatsApp(c.entite_id)) || null;
  // Comme whatsapp_reclasser (migration 59) : les non-lus ne remontent jamais, un changement d'entreprise est « manuel » et retire le client et le
  // dossier d'une autre entreprise, puis cherche le client par le numéro dans la nouvelle.
  const garderWhatsApp = (table, ligne, patch) => {
    if (table === "whatsapp_propositions") {
      if (ligne.statut !== "a_faire" || !["traitee", "ignoree"].includes(patch.statut) || !conversationEcrite(ligne.conversation_id) || (ligne.entite_id && !adminWhatsApp(ligne.entite_id))) throw new Error(tr("Modification refusée : la fiche n'existe plus ou vos droits ne la permettent pas."));
      Object.assign(patch, { traitee_le: new Date().toISOString(), traitee_par: utilisateur.user_id, traitee_par_quoi: "outil" });
      return;
    }
    if (table !== "whatsapp_conversations") return;
    if (!conversationEcrite(ligne.id)) throw new Error(tr("Modification refusée : la fiche n'existe plus ou vos droits ne la permettent pas."));
    for (const k of Object.keys(patch)) if (!["entite_id", "client_id", "dossier_id", "non_lus", "reponses", "paiement_signale"].includes(k)) delete patch[k];
    // Signal de paiement (migration 62) : depuis l'outil, seulement remis à vide (« Ignorer »).
    if ("paiement_signale" in patch && patch.paiement_signale !== null) delete patch.paiement_signale;
    // Interrupteur par contact (migration 60) : « auto » ou « jamais », rien d'autre.
    if ("reponses" in patch && !["auto", "jamais"].includes(patch.reponses)) throw new Error(tr("Modification refusée : la fiche n'existe plus ou vos droits ne la permettent pas."));
    if ("non_lus" in patch && !(patch.non_lus <= ligne.non_lus)) patch.non_lus = ligne.non_lus;
    const apres = { ...ligne, ...patch };
    if ("entite_id" in patch && patch.entite_id !== ligne.entite_id) {
      if (apres.entite_id && !adminWhatsApp(apres.entite_id)) throw new Error(tr("Modification refusée : la fiche n'existe plus ou vos droits ne la permettent pas."));
      patch.entite_source = "manuel";
    }
    const client = apres.client_id ? data.clients.find((c) => c.id === apres.client_id && c.entite_id === apres.entite_id) : null;
    if (apres.client_id && !client) patch.client_id = null;
    const dossierOk = apres.dossier_id && data.dossiers.some((d) => d.id === apres.dossier_id && d.entite_id === apres.entite_id && (!client || d.client_id === client.id));
    if (apres.dossier_id && !dossierOk) patch.dossier_id = null;
    // Comme la base (migration 59) : les propositions encore ouvertes, préparées pour une autre entreprise, sont remplacées.
    if (patch.entite_source === "manuel") for (const p of data.whatsapp_propositions) if (p.conversation_id === ligne.id && ["a_faire", "en_cours"].includes(p.statut) && p.entite_id !== apres.entite_id) p.statut = "remplacee";
    if (patch.entite_source === "manuel" && apres.entite_id && !client) {
      const n = (t) => String(t || "").replace(/\D/g, "");
      const tel = n(ligne.telephone);
      const trouve = data.clients.find((c) => c.entite_id === apres.entite_id && n(c.telephone).length >= 9 && (n(c.telephone) === tel || n(c.telephone).slice(-9) === tel.slice(-9)));
      patch.client_id = trouve ? trouve.id : null;
      const d = trouve ? data.dossiers.find((x) => x.client_id === trouve.id && x.entite_id === apres.entite_id && !x.annule) : null;
      patch.dossier_id = patch.dossier_id || (d ? d.id : null);
    }
  };

  const contexte = () => ({ profil: utilisateur, membres: data.membres, roles: data.roles });
  // La carte mixte de la démonstration : seulement quand la personne travaille dans les deux entreprises (comme modeUnifie) et que la demande
  // cite une excursion en bateau et un transfert.
  function carteMixteDemo(entiteId, texte) {
    const ent = data.entites.find((x) => x.id === entiteId);
    const autre = data.entites.find((x) => x.id !== entiteId && marqueUnifiee(x) && marqueUnifiee(x) !== marqueUnifiee(ent));
    if (!marqueUnifiee(ent) || !autre || !["partenaires.lire", "dossiers.ecrire"].every((d) => droit(entiteId, d) && droit(autre.id, d))) return null;
    if (!/(4 islands|four islands|koh rok|phi phi|îles)/i.test(texte) || !/(airport|aéroport|aeroport|transfer|transfert|taxi)/i.test(texte)) return null;
    const secret = marqueUnifiee(ent) === "secret" ? ent : autre;
    const taxi = secret === ent ? autre : ent;
    const exc = data.prestations.find((p) => p.entite_id === secret.id && /4 islands/i.test(p.libelle)) || data.prestations.find((p) => p.entite_id === secret.id);
    const course = data.prestations.find((p) => p.entite_id === taxi.id && /airport/i.test(p.libelle)) || data.prestations.find((p) => p.entite_id === taxi.id);
    if (!exc || !course) return null;
    const j = (n) => ajouterJours(aujourdhui(), n);
    const service = (p, ent2, date, extra = {}) => ({ texte: p ? p.libelle : "", offre: p ? { genre: "prestation", id: p.id } : null, libelle: p ? p.libelle : "", date, heure_pickup: "", lieu_pickup: "Lanta Sand Resort", de: "", vers: "", adultes: 2, enfants: 0, prix: p ? Number(p.prix_vente) * (p.unite === "pp" ? 2 : 1) : null, origine_prix: p ? "catalogue" : "a_fixer", remarque: "", entite_id: ent2 ? ent2.id : null, entreprise: ent2 ? marqueUnifiee(ent2) : "", avertissements: ent2 ? [] : ["entreprise_a_choisir"], ...extra });
    const services = [service(course, taxi, j(2)), service(exc, secret, j(3)), service(null, null, j(4), { texte: "Sunset dinner boat pickup", libelle: "Sunset dinner boat pickup", prix: 1500, origine_prix: "saisi" })];
    if (partageReciproqueDemo(secret, taxi)) setTimeout(() => ecouteurs.forEach((f) => f()), 0);
    return { genre: "dossier", titre: "Séjour de Clara : excursion et transfert", donnees: { client: { nom: "Clara Martin", telephone: "+447700900966", hotel: "Lanta Sand Resort", langue: "en" }, adultes: 2, enfants: 0, bebes: 0, services, entreprises: ["secret", "taxi"] }, avertissements: ["entreprise_a_choisir"] };
  }
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
    // Comme partage_clients_permis (migration 63) : entre Secret et Taxi, le partage réciproque suffit à qui lit tous les clients de la source.
    const ea = data.entites.find((e) => e.id === c.entite_id);
    const eb = data.entites.find((e) => e.id === apres.entite_id);
    const reciproque = !!marqueUnifiee(ea) && !!marqueUnifiee(eb) && marqueUnifiee(ea) !== marqueUnifiee(eb) && partageReciproque(data.partages_clients || [], c.entite_id, apres.entite_id);
    const permis = partageClientsPermisUnifie({ superAdmin: !!utilisateur.super_admin, permissionsSource: permissionsDans(ctx, c.entite_id), permissionsCible: permissionsDans(ctx, apres.entite_id), voitToutSource: voitTout(ctx, c.entite_id), reciproque });
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
      const ligne = { id: uid(), created_at: aujourdhui(), entite_id: r.entite_id, reservation_id: r.id, net_paye: null, paye_le: null, commission_recue: null, commission_recue_le: null, commission_recue_moyen: null, commission_partielle_le: null, commission_ecart_motif: null, commission_ecart_note: null, ...valeurs };
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
    // Boîte WhatsApp. En direct comme le reste de la démo (même liste d'écouteurs, prévenue à chaque écriture d'un autre onglet).
    ecouterWhatsApp(tables, rappel, { surEtat = () => {} } = {}) {
      const arreter = this.ecouter(tables, rappel);
      // Pas de Realtime en démonstration : le « canal » est toujours là, aucun repli ni pastille.
      setTimeout(() => surEtat("abonne"), 0);
      return arreter;
    },
    etatDirect: () => ({ direct: "abonne", whatsapp: "abonne" }),
    async reveillerDirect() {},
    // Relecture ciblée de la boîte WhatsApp, avec les mêmes droits que le chargement complet.
    async chargerWhatsApp() {
      const tout = await this.charger();
      return Object.fromEntries(Object.entries(tout).filter(([k]) => k.startsWith("whatsapp_")));
    },
    async whatsappMessages(conversationId) {
      if (!conversationLue(conversationId)) return [];
      return structuredClone(data.whatsapp_messages.filter((m) => m.conversation_id === conversationId).sort((a, b) => Date.parse(a.envoye_le) - Date.parse(b.envoye_le)));
    },
    // « Préparer une réponse » en démonstration : une proposition « en_cours » tout de suite, puis une réponse fictive après un court délai,
    // annoncées comme le ferait Realtime. Prépare même pour un contact réglé sur « Jamais » ou un message que le tri a écarté, comme la fonction.
    async whatsappPreparer(conversationId, { delai = 1500 } = {}) {
      const c = conversationEcrite(conversationId);
      if (!c) return { erreur: "droit_manquant" };
      const derniers = data.whatsapp_messages.filter((m) => m.conversation_id === c.id).sort((a, b) => Date.parse(a.envoye_le) - Date.parse(b.envoye_le));
      const dernier = derniers[derniers.length - 1];
      if (!dernier || dernier.sens !== "entrant") return { erreur: "rien_a_repondre" };
      const entite = data.entites.find((e) => e.id === c.entite_id) || data.entites.find((e) => marqueEntite(e) === "secret") || null;
      for (const p of data.whatsapp_propositions) if (p.conversation_id === c.id && ["a_faire", "en_cours"].includes(p.statut)) p.statut = "remplacee";
      const p = { id: uid(), cree_le: new Date().toISOString(), conversation_id: c.id, message_id: dernier.id, entite_id: entite ? entite.id : null, statut: "en_cours", texte: null, langue: "en", avertissements: [], entreprise_proposee: c.entite_id ? null : marqueEntite(entite), erreur: null, traitee_le: null, traitee_par: null, traitee_par_quoi: null };
      data.whatsapp_propositions.push(p);
      sauve();
      setTimeout(() => ecouteurs.forEach((f) => f()), 0);
      setTimeout(() => {
        const prenom = String(c.nom || "").split(/\s+/)[0];
        Object.assign(p, { statut: "a_faire", texte: `${prenom ? `Hi ${prenom},` : "Hi,"}\n\nThank you for your message. We will get back to you shortly with the details.` });
        sauve();
        ecouteurs.forEach((f) => f());
      }, delai);
      return { ok: true };
    },
    // Comme doublons_clients_partages (migration 63) : seulement pour qui lit tous les clients de Secret et de Taxi.
    async doublonsClients() {
      const ids = new Set(accessibles());
      const unifiees = data.entites.filter((e) => ids.has(e.id) && e.organisation_id === monOrg() && marqueUnifiee(e));
      if (unifiees.length !== 2 || !unifiees.every((e) => droit(e.id, "clients.lire") && voitTout(contexte(), e.id))) return [];
      return doublonsLocaux(data.clients, unifiees);
    },
    async whatsappConversation(id) {
      const c = conversationLue(id);
      return c ? { id: c.id, entite_id: c.entite_id, client_id: c.client_id, dossier_id: c.dossier_id } : null;
    },
    async whatsappProposition(id) {
      const p = data.whatsapp_propositions.find((x) => x.id === id);
      return p && conversationLue(p.conversation_id) ? { id: p.id, statut: p.statut } : null;
    },
    // Le navigateur de démo ne garde aucun fichier : pas de lien, l'écran le dit.
    async whatsappLienMedia() {
      return null;
    },
    // Rien ne part en démonstration.
    async whatsappEnvoyer() {
      await new Promise((r) => setTimeout(r, 200));
      return { demo: true };
    },
    async whatsappReception(organisationId, actif) {
      const r = data.whatsapp_reglages.find((x) => x.organisation_id === organisationId);
      if (!r || organisationId !== monOrg() || !litWhatsApp(null)) throw new Error(tr("Modification refusée : la fiche n'existe plus ou vos droits ne la permettent pas."));
      Object.assign(r, { reception_active: !!actif, updated_at: new Date().toISOString() });
      sauve();
      return structuredClone(r);
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
    // ---- Agent de l'onglet « Assistant » (migration 52) : en démonstration, un agent simulé (agent-demo.mjs), mêmes événements que la fonction.
    async agentConversations(entiteId) {
      return structuredClone(data.agent_conversations.filter((c) => c.entite_id === entiteId && c.user_id === utilisateur.user_id));
    },
    async agentAttente(entiteId) {
      const miennes = new Set(data.agent_conversations.filter((c) => c.entite_id === entiteId && c.user_id === utilisateur.user_id).map((c) => c.id));
      return data.agent_cartes.filter((c) => miennes.has(c.conversation_id) && c.statut === "proposee").map((c) => ({ conversation_id: c.conversation_id }));
    },
    async agentFil(id) {
      const c = data.agent_conversations.find((x) => x.id === id && x.user_id === utilisateur.user_id);
      if (!c) return null;
      return { messages: structuredClone(data.agent_messages.filter((m) => m.conversation_id === id)), cartes: structuredClone(data.agent_cartes.filter((x) => x.conversation_id === id)) };
    },
    async agentMajConversation(id, patch) {
      const c = data.agent_conversations.find((x) => x.id === id && x.user_id === utilisateur.user_id);
      if (!c) throw new Error("Conversation introuvable");
      for (const k of ["titre", "statut", "dossier_id"]) if (k in patch) c[k] = patch[k];
      sauve();
      return structuredClone(c);
    },
    async agentSupprimerConversation(id) {
      data.agent_conversations = data.agent_conversations.filter((x) => !(x.id === id && x.user_id === utilisateur.user_id));
      data.agent_messages = data.agent_messages.filter((m) => m.conversation_id !== id || data.agent_conversations.some((c) => c.id === id));
      data.agent_cartes = data.agent_cartes.filter((m) => m.conversation_id !== id || data.agent_conversations.some((c) => c.id === id));
      data.agent_fichiers = data.agent_fichiers.filter((m) => m.conversation_id !== id || data.agent_conversations.some((c) => c.id === id));
      sauve();
    },
    async agentConversationsDuDossier(dossierId) {
      return structuredClone(data.agent_conversations.filter((c) => c.dossier_id === dossierId && c.user_id === utilisateur.user_id).sort((a, b) => String(b.maj_le).localeCompare(String(a.maj_le))).slice(0, 10));
    },
    // Apprentissages (migration 54), comme la base : notés par qui utilise l'agent, lus par l'entreprise, supprimés par l'administration.
    async agentNoterApprentissages(entiteId, carteId, lignes) {
      const perms = permissionsDans(contexte(), entiteId);
      if (!perms.includes("partenaires.lire") || !perms.includes("dossiers.ecrire")) return false;
      data.agent_apprentissages = data.agent_apprentissages || [];
      for (const l of lignes) data.agent_apprentissages.push({ id: uid(), entite_id: entiteId, user_id: utilisateur.user_id, carte_id: carteId || null, genre: l.genre, contexte: l.contexte, avant: l.avant, apres: l.apres, cree_le: new Date().toISOString() });
      sauve();
      return true;
    },
    async agentApprentissages(entiteIds) {
      return structuredClone((data.agent_apprentissages || []).filter((l) => entiteIds.includes(l.entite_id)).sort((a, b) => String(b.cree_le).localeCompare(String(a.cree_le))));
    },
    async agentSupprimerApprentissage(id) {
      const l = (data.agent_apprentissages || []).find((x) => x.id === id);
      if (!l) return;
      const perms = permissionsDans(contexte(), l.entite_id);
      if (!perms.includes("reglages.ecrire") || !perms.includes("journal.voir")) throw new Error("Droit insuffisant");
      data.agent_apprentissages = data.agent_apprentissages.filter((x) => x.id !== id);
      sauve();
    },
    // Crédit de l'assistant : en démonstration, la dépense du journal fictif et un plafond gardé dans le navigateur.
    async assistantBudget() {
      const admin = (utilisateur && utilisateur.super_admin) || data.entites.some((e) => {
        const p = permissionsDans(contexte(), e.id);
        return p.includes("reglages.ecrire") && p.includes("journal.voir");
      });
      if (!admin) return null;
      const debut = new Date(Date.parse(`${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 8)}01T00:00:00Z`) - 7 * 3600e3).toISOString();
      const cout = (data.assistant_journal || []).filter((l) => l.cree_le >= debut).reduce((t, l) => t + (Number(l.cout_estime_usd) || 0), 0);
      const b = data.assistant_budget || { plafond: 50, seuil: 80 };
      return { cout_mois: Math.round(cout * 1e6) / 1e6, plafond: b.plafond, seuil: b.seuil, debut, peut_regler: !!(utilisateur && utilisateur.super_admin) };
    },
    async reglerPlafondAssistant(plafond, seuil) {
      data.assistant_budget = { plafond: Number(plafond) || 50, seuil: Number(seuil) || 80 };
      sauve();
    },
    // Une pièce jointe pour l'aperçu : en démonstration, le fichier n'est pas gardé.
    async agentFichier() {
      return null;
    },
    async agentCarte(id, statut) {
      const c = data.agent_cartes.find((x) => x.id === id);
      if (!c || !data.agent_conversations.some((v) => v.id === c.conversation_id && v.user_id === utilisateur.user_id)) throw new Error("Carte introuvable");
      if (c.statut !== statut) (c.statut = statut), (c.decide_le = new Date().toISOString());
      sauve();
      return structuredClone(c);
    },
    // Demandes d'amélioration : en démonstration, la demande reste ici (aucune issue n'est ouverte), statut « envoyée ».
    async ameliorations(entiteId) {
      return structuredClone(data.ameliorations.filter((a) => a.entite_id === entiteId)).sort((a, b) => String(b.cree_le).localeCompare(String(a.cree_le)));
    },
    async demanderAmelioration({ entite_id, carte_id, titre, texte }) {
      if (!permissionsDans(contexte(), entite_id).includes("reglages.ecrire")) return { erreur: "reserve_admin" };
      const { controlerDemande } = await import("./ameliorations-calc.mjs");
      const c = data.agent_cartes.find((x) => x.id === carte_id);
      const conv = c && data.agent_conversations.find((v) => v.id === c.conversation_id && v.user_id === utilisateur.user_id);
      const r = controlerDemande({ permissions: permissionsDans(contexte(), entite_id), carte: c && conv ? { ...c, entite_id: conv.entite_id } : null, entiteId: entite_id, titre, texte, demandesDuJour: 0 });
      if (!r.ok) return { erreur: r.erreur, ...(r.motifs ? { motifs: r.motifs } : {}) };
      const maintenant = new Date().toISOString();
      const a = { id: uid(), entite_id, user_id: utilisateur.user_id, carte_id, conversation_id: c.conversation_id, titre: r.titre, texte: r.texte, statut: "envoyee", issue_url: null, pr_url: null, sensible: false, cree_le: maintenant, maj_le: maintenant };
      data.ameliorations.push(a);
      c.statut = "validee";
      c.decide_le = maintenant;
      sauve();
      return { amelioration: structuredClone(a), carte: structuredClone(c) };
    },
    async tempsTrajets(entiteId) {
      return structuredClone(data.temps_trajets.filter((l) => l.entite_id === entiteId));
    },
    async enregistrerTempsTrajets(entiteId, lignes) {
      const perms = permissionsDans(contexte(), entiteId);
      if (!perms.includes("partenaires.lire") || !perms.includes("dossiers.ecrire")) throw new Error("Droit insuffisant");
      const out = [];
      for (const l of lignes) {
        const maj = { ...l, entite_id: entiteId, maj_le: new Date().toISOString(), maj_par: utilisateur.user_id };
        const avant = data.temps_trajets.find((x) => x.entite_id === entiteId && x.mode === l.mode && x.cle === l.cle);
        if (avant) Object.assign(avant, maj);
        else data.temps_trajets.push({ id: uid(), cree_le: maj.maj_le, ...maj });
        out.push(structuredClone(data.temps_trajets.find((x) => x.entite_id === entiteId && x.mode === l.mode && x.cle === l.cle)));
      }
      sauve();
      return out;
    },
    async supprimerTempsTrajet(id) {
      data.temps_trajets = data.temps_trajets.filter((l) => l.id !== id);
      sauve();
    },
    // La démonstration ne garde aucun itinéraire OpenStreetMap : rien à effacer.
    async oublierItineraires() {},
    async liaisonsFerry(entiteId) {
      return structuredClone(data.liaisons_ferry.filter((l) => l.entite_id === entiteId));
    },
    async enregistrerLiaisonFerry(entiteId, l) {
      const perms = permissionsDans(contexte(), entiteId);
      if (!perms.includes("partenaires.lire") || !perms.includes("dossiers.ecrire")) throw new Error("Droit insuffisant");
      const maj = { ...l, entite_id: entiteId, maj_le: new Date().toISOString() };
      const avant = data.liaisons_ferry.find((x) => x.entite_id === entiteId && x.cote_ile === l.cote_ile);
      if (avant) Object.assign(avant, maj);
      else data.liaisons_ferry.push({ id: uid(), ...maj });
      sauve();
      return structuredClone(data.liaisons_ferry.find((x) => x.entite_id === entiteId && x.cote_ile === l.cote_ile));
    },
    async supprimerLiaisonFerry(id) {
      data.liaisons_ferry = data.liaisons_ferry.filter((l) => l.id !== id);
      sauve();
    },
    async agentEnvoyer(corps, surEvenement) {
      const e = corps.entite_id;
      const regl = data.reglages[e] || {};
      if (!regl.agent_ia) return { erreur: "agent_eteint" };
      const perms = permissionsDans(contexte(), e);
      if (!["partenaires.lire", "dossiers.ecrire"].every((p) => perms.includes(p))) return { erreur: "droit_manquant" };
      let texte = String(corps.texte || "").trim();
      const pieces = Array.isArray(corps.fichiers) ? corps.fichiers : [];
      // « Créer le dossier » ou « Mettre à jour le dossier » depuis l'écran WhatsApp (migration 61), comme la fonction : la conversation est lue
      // avec les droits de la personne, le message est construit depuis l'échange. En démonstration, seulement le texte des messages du client.
      const wc = corps.whatsapp_conversation_id && !corps.conversation_id ? conversationLue(corps.whatsapp_conversation_id) : null;
      const modeWa = corps.whatsapp_mode === "maj" ? "maj" : "creer";
      if (corps.whatsapp_conversation_id && !corps.conversation_id) {
        // Comme la fonction : la conversation doit être rangée dans l'entreprise de l'Assistant. Les pièces cochées (whatsapp_pieces) ne sont
        // pas lues en démonstration.
        if (!wc || wc.entite_id !== e) return { erreur: "whatsapp_introuvable" };
        if (modeWa === "maj" && !data.dossiers.some((d) => d.id === wc.dossier_id)) return { erreur: "dossier_introuvable" };
        const lignes = data.whatsapp_messages.filter((m) => m.conversation_id === wc.id && m.sens === "entrant" && !m.supprime_le && m.texte).sort((a, b) => Date.parse(a.envoye_le) - Date.parse(b.envoye_le)).map((m) => m.texte);
        texte = lignes.join("\n") || "Bonjour";
      }
      if (!texte && !pieces.length) return { erreur: "message_invalide" };
      if (pieces.length > 6) return { erreur: "trop_de_fichiers" };
      if (pieces.some((f) => !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f && f.media_type))) return { erreur: "fichier_type" };
      let conv = corps.conversation_id ? data.agent_conversations.find((c) => c.id === corps.conversation_id && c.user_id === utilisateur.user_id) : null;
      const maintenant = () => new Date(Date.now() + data.agent_messages.length).toISOString();
      if (!conv) {
        const { titreDepuis } = await import("./agent-calc.mjs");
        const titre = wc ? (modeWa === "maj" ? "Mise à jour depuis WhatsApp" : "Dossier depuis WhatsApp") : titreDepuis(texte || (pieces[0] && pieces[0].nom) || "");
        conv = { id: uid(), entite_id: e, user_id: utilisateur.user_id, titre, apercu: "", dossier_id: (wc && modeWa === "maj" ? wc.dossier_id : null) || corps.dossier_id || null, statut: "ouverte", cree_le: maintenant(), maj_le: maintenant(), demo_etat: {}, ...(wc ? { whatsapp_conversation_id: wc.id } : {}) };
        data.agent_conversations.push(conv);
      }
      const message = (role, contenu) => data.agent_messages.push({ id: data.agent_messages.length + 1, conversation_id: conv.id, role, contenu, cree_le: maintenant() });
      surEvenement({ t: "conversation", id: conv.id, titre: conv.titre, dossier_id: conv.dossier_id, ...(conv.whatsapp_conversation_id ? { whatsapp_conversation_id: conv.whatsapp_conversation_id } : {}) });
      const blocs = pieces.map((f) => {
        const ligne = { id: uid(), conversation_id: conv.id, nom: String(f.nom || "").slice(0, 120), media_type: f.media_type, taille: String(f.data || "").length, cree_le: maintenant() };
        data.agent_fichiers.push(ligne);
        return { type: "fichier", id: ligne.id, nom: ligne.nom, media_type: ligne.media_type, taille: ligne.taille };
      });
      message("user", [...blocs, ...(texte ? [{ type: "text", text: texte }] : [])]);
      // Démonstration : les fichiers ne sont pas lus. Une demande d'ajout de partenaire montre la carte d'import, le reste une phrase.
      if (blocs.length) {
        const brochure = /brochure|partenaire|partner|tarif|prix|ajout|catalogue/i.test(texte);
        const phrase = brochure ? "En démonstration, je ne lis pas les fichiers : voici la carte d'import, avec des lignes tirées du catalogue." : "En démonstration, je ne lis pas les pièces jointes. Avec l'assistant en service, je lis la photo ou le PDF comme un message (heure du vol, hôtel, dates).";
        surEvenement({ t: "texte", delta: phrase });
        message("assistant", [{ type: "text", text: phrase }]);
        if (brochure) {
          const carte = { id: uid(), conversation_id: conv.id, statut: "proposee", cree_le: maintenant(), decide_le: null, genre: "brochure", titre: "Brochure jointe", donnees: { fichiers: blocs.map(({ id, nom, media_type }) => ({ id, nom, media_type })), partenaire_lu: "", partenaire_id: null, nouveau: true }, avertissements: [] };
          data.agent_cartes.push(carte);
          surEvenement({ t: "carte", carte: structuredClone(carte) });
        }
        conv.apercu = phrase.slice(0, 200);
        conv.maj_le = maintenant();
        sauve();
        surEvenement({ t: "fin", statut: "ok", cout_usd: 0, modele: "demo" });
        return { ok: true };
      }
      // Espace unifié (migration 63) : une demande qui mêle une excursion et un transfert donne une seule carte, chaque service avec son
      // entreprise (le troisième, hors catalogue, sans entreprise : la personne choisit), comme la fonction en mode unifié.
      const carteMixte = carteMixteDemo(e, texte);
      if (carteMixte) {
        const phrase = "Une seule carte pour les deux entreprises : l'excursion chez Secret, le transfert chez Taxi. Le dîner en bateau n'a pas d'entreprise, choisissez-la sur le service. À la validation, deux dossiers liés sont créés.";
        surEvenement({ t: "texte", delta: phrase });
        message("assistant", [{ type: "text", text: phrase }]);
        const carte = { id: uid(), conversation_id: conv.id, statut: "proposee", cree_le: maintenant(), decide_le: null, ...carteMixte };
        data.agent_cartes.push(carte);
        surEvenement({ t: "carte", carte: structuredClone(carte) });
        conv.apercu = phrase.slice(0, 200);
        conv.maj_le = maintenant();
        sauve();
        surEvenement({ t: "fin", statut: "ok", cout_usd: 0, modele: "demo" });
        return { ok: true };
      }
      const { repondreDemo } = await import("./agent-demo.mjs");
      const entite = data.entites.find((x) => x.id === e) || {};
      const r = await repondreDemo(texte, { aujourdhui: aujourdhui(), etat: conv.demo_etat || {}, entreprise: entite.nom || "", signer: !regl.fonctionnement || regl.fonctionnement === "sur_mesure", lignes: data.temps_trajets.filter((l) => l.entite_id === e), liaisons: data.liaisons_ferry.filter((l) => l.entite_id === e), hotels: data.hotels_lieux.filter((l) => l.entite_id === e) });
      conv.demo_etat = r.etat;
      let dernier = "";
      for (const ev of r.evenements) {
        await new Promise((ok) => setTimeout(ok, ev.t === "etape" ? 500 : 150));
        if (ev.t === "planning") {
          // Comme la fonction : l'appel d'outil et son résultat restent dans l'historique, la frise se relit à la réouverture.
          const outil = uid();
          message("assistant", [{ type: "tool_use", id: outil, name: "planifier_course", input: {} }]);
          message("user", [{ type: "tool_result", tool_use_id: outil, content: JSON.stringify(ev.planning) }]);
        }
        if (ev.t === "texte") {
          message("assistant", [{ type: "text", text: ev.delta }]);
          dernier = ev.delta;
        }
        if (ev.t === "carte") {
          const carte = { id: uid(), conversation_id: conv.id, statut: "proposee", cree_le: maintenant(), decide_le: null, ...ev.carte };
          data.agent_cartes.push(carte);
          ev.carte = structuredClone(carte);
        }
        surEvenement(ev);
      }
      conv.maj_le = maintenant();
      conv.apercu = (dernier || texte).replace(/\s+/g, " ").slice(0, 200);
      sauve();
      surEvenement({ t: "fin", statut: "ok", cout_usd: 0, modele: "simulation" });
      return { ok: true };
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
      const depuisAgent = corps.usage === "brochure" && Array.isArray(corps.fichiers_agent);
      if (depuisAgent ? !(data.reglages[e] || {}).agent_ia : !(data.reglages[e] || {}).assistant_ia) return { erreur: depuisAgent ? "agent_eteint" : "assistant_eteint" };
      // Mêmes droits que la fonction : la base de prix et créer un dossier. « rediger » est refusé comme par la fonction (retiré le 19.11.2026).
      if (!["lire", "itineraire", "situer", "repondre_itineraire", "brochure"].includes(corps.usage)) return { erreur: "usage_inconnu" };
      const perms = permissionsDans(contexte(), e);
      // Brochure : droits de la fonction (créer les tarifs et leurs prix de vente), fichiers contrôlés comme par elle, réponse tirée du catalogue.
      if (corps.usage === "brochure") {
        const b = await import("./brochure-calc.mjs");
        if (b.DROITS_BROCHURE.some((p) => !perms.includes(p))) return { erreur: "droit_manquant" };
        const miennes = new Set(data.agent_conversations.filter((c) => c.entite_id === e && c.user_id === utilisateur.user_id).map((c) => c.id));
        const fichiers = depuisAgent ? corps.fichiers_agent.map((id) => data.agent_fichiers.find((f) => f.id === id && miennes.has(f.conversation_id))) : Array.isArray(corps.fichiers) ? corps.fichiers : [];
        if (!fichiers.length || fichiers.some((f) => !f)) return { erreur: "fichiers_absents" };
        if (fichiers.length > 6) return { erreur: "trop_de_fichiers" };
        if (fichiers.some((f) => !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f && f.media_type))) return { erreur: "fichier_type" };
        const nouveau = depuisAgent && corps.nouveau_partenaire === true && !corps.partenaire_id;
        if (!nouveau && !data.partenaires.some((p) => p.id === corps.partenaire_id && p.entite_id === e)) return { erreur: "partenaire_invalide" };
        return b.simulerBrochure({ partenaireId: nouveau ? null : corps.partenaire_id, prestations: data.prestations.filter((p) => p.entite_id === e), trajets: data.trajets.filter((t) => t.entite_id === e), nouveau });
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
      // Boîte WhatsApp : mêmes règles que la base (whatsapp_lit). Les messages se lisent à l'ouverture d'une conversation.
      out.whatsapp_conversations = data.whatsapp_conversations.filter((c) => c.organisation_id === monOrg() && litWhatsApp(c.entite_id));
      const convs = new Set(out.whatsapp_conversations.map((c) => c.id));
      // Une proposition se lit par les administrateurs de l'entreprise pour laquelle elle a été préparée (migration 59).
      out.whatsapp_propositions = data.whatsapp_propositions.filter((p) => convs.has(p.conversation_id));
      out.whatsapp_reglages = data.whatsapp_reglages.filter((r) => r.organisation_id === monOrg() && litWhatsApp(null));
      out.whatsapp_disponible = !AGENCE;
      out.whatsapp_propositions_disponible = !AGENCE;
      out.whatsapp_tri_disponible = !AGENCE;
      out.whatsapp_suivi_disponible = !AGENCE;
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
      garderWhatsApp(table, ligne, patch);
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
