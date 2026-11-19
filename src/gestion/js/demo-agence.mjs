// Démonstration pour les prospects (/gestion/?demo=agence, Jérémy 19.11.2026) : une agence d'excursions FICTIVE, en dollars et en anglais,
// partie du modèle « Excursions et activités » comme une agence cliente du logiciel. Aucun lieu, marque, partenaire ni prix des entreprises
// d'Anaïs : les lieux sont des noms communs (Main Pier, North Beach, City Airport). La démo d'Anaïs (/gestion/?demo, defauts.mjs) reste
// celle qui sert à tester ses parcours. Le hasard est fixé : mêmes chiffres à chaque ouverture.

import { CONTENU_DEFAUT, nouvelleLigne, REGLES_PARTENAIRE_NEUTRES, ROLES_SYSTEME, uid } from "./defauts.mjs";
import { departModele } from "./modeles-metier.mjs";

export const ORG_AGENCE = "demo-organisation";
export const NOM_AGENCE = "Blue Lagoon Tours";

const PRENOMS = ["Emma", "Lucas", "Mia", "Noah", "Olivia", "Liam", "Sofia", "Hugo", "Lena", "Tom", "Alba", "Finn", "Nora", "Max", "Elsa", "Jonas", "Clara", "Paul", "Ida", "Leo"];
const NOMS = ["Walker", "Keller", "Martin", "Schmidt", "Dubois", "Weber", "Taylor", "Fischer", "Rossi", "Meyer", "Garcia", "Hughes", "Brown", "Novak", "Lopez", "Jensen", "Vogel", "Silva", "Berg", "Nguyen"];
const HOTELS = ["Sunset Hotel, North Beach", "Palm Bungalows, South Beach", "Harbour Inn, Old Town", "Lagoon Villas", "Seaview Resort, North Beach", "Old Town Guesthouse"];

// Générateur pseudo-aléatoire fixe (mulberry32), comme demo-stats.mjs.
function hasard(graine) {
  let a = graine;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function donneesDemoAgence(ajd, ajouterJours) {
  const j = (n) => ajouterJours(ajd, n);
  const rnd = hasard(20261119);
  const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const choix = (l) => l[Math.floor(rnd() * l.length)];

  const organisations = [{ id: ORG_AGENCE, nom: NOM_AGENCE, fuseau: "UTC", langue: "en", statut: "actif", options: [], created_at: j(-400) }];
  const e = { id: uid(), created_at: j(-400), slug: "blue-lagoon-tours", nom: NOM_AGENCE, actif: true, ordre: 1, organisation_id: ORG_AGENCE, publie_site: false };
  const profil = (email, nom, super_admin) => ({ user_id: uid(), email, nom, super_admin, plateforme: false, actif: true, organisation_id: ORG_AGENCE, langue: "en", connecte_le: ajd });
  const owner = profil("owner@demo.local", "Alex (owner)", true);
  const sales = profil("sales@demo.local", "Sam (sales)", false);
  const guide = profil("ops@demo.local", "Jo (operations, no prices)", false);

  // Réglages et rôles d'une agence créée aujourd'hui depuis le modèle, puis complétés comme après l'appel de mise en route.
  const depart = departModele("tour_agency", { nom: NOM_AGENCE, devise: "USD" });
  const reglages = {
    [e.id]: {
      ...depart.reglages,
      emetteur: { ...depart.reglages.emetteur, nom: NOM_AGENCE, adresse: "1 Harbour Road\nOld Town", telephone: "+1 202 555 0100", contact: "Alex\n+1 202 555 0100 (WhatsApp)\nhello@example.com" },
      paiement: { texte: "Bank: Demo Bank\nAccount: 000-000000-0\nHolder: Blue Lagoon Tours" },
      voucher: { ...depart.reglages.voucher, email: "hello@example.com", whatsapp: "+1 202 555 0100" },
      numerotation: { ...depart.reglages.numerotation, prefixe: "BL" },
    },
  };
  const roles = depart.roles.map((r) => ({ id: uid(), created_at: j(-400), entite_id: e.id, ...r, systeme: true }));
  const role = (nom) => roles.find((r) => r.nom === nom).id;
  // Un rôle sans chiffres, pour montrer qu'un guide voit le planning sans les prix.
  const rOps = { id: uid(), created_at: j(-60), entite_id: e.id, nom: "Operations", description: "Sees clients, bookings and today's schedule, never the amounts.", portee: "toute", permissions: ["clients.lire", "dossiers.lire", "partenaires.lire"], systeme: false, tous_droits: false };
  roles.push(rOps);
  const editeur = ROLES_SYSTEME.find((r) => !r.tous_droits && r.permissions.includes("dossiers.ecrire"));
  const membres = [
    { user_id: sales.user_id, entite_id: e.id, role_id: role(editeur.nom) },
    { user_id: guide.user_id, entite_id: e.id, role_id: rOps.id },
  ];

  // ---- Partenaires, tarifs et nets ----
  const partenaires = [];
  const partenaires_prives = [];
  const prestations = [];
  const prestations_nets = [];
  const partenaire = (nom, categorie, groupe, role, extra = {}) => {
    const p = { id: uid(), created_at: j(-300), updated_at: j(-300), entite_id: e.id, nom, nom_thai: "", categorie, groupe, role, contact: {}, regles: {}, contrat: {}, notes: "", ordre: partenaires.length + 1, actif: true, ...REGLES_PARTENAIRE_NEUTRES, ...extra };
    partenaires.push(p);
    return p;
  };
  const prestation = (p, famille, groupe, libelle, prix, unite, net, details = {}, extra = {}) => {
    const x = { id: uid(), created_at: j(-300), updated_at: j(-300), entite_id: e.id, partenaire_id: p ? p.id : null, famille, groupe, libelle, libelle_en: "", details, prix_vente: prix, unite, sur_place: false, ordre: prestations.length + 1, actif: true, ...extra };
    prestations.push(x);
    if (net != null) prestations_nets.push({ id: uid(), entite_id: e.id, prestation_id: x.id, net, net_enfant: null, note: "" });
    return x;
  };
  const bateaux = partenaire("Island Boats (demo)", "Boat trips", "mer", "Island hopping by boat, shared and private", {
    contact: { personne: "Captain Mike", telephones: [{ numero: "+1 202 555 0111", libelle: "Bookings", whatsapp: true }], emails: ["boats@example.com"], embarcadere: "Main Pier", guichets: [] },
    regles: { annulation: "Free cancellation up to 24 hours before departure, then 100%.", enfants: ["Child rate from 3 to 11 years. Under 3 free."] },
    contrat: { statut: "Net rates confirmed", etat: "ok", saison: "Whole year", validite: "Jan – Dec", fin: j(120), documents: ["Island Boats contract.pdf"], evenements: [] },
  });
  partenaires_prives.push({ id: uid(), entite_id: e.id, partenaire_id: bateaux.id, banque: { banque: "Demo Bank", compte: "000-111111-1", titulaire: "Island Boats" }, paiement: "Bank transfer every Friday.", commissions: ["Fixed net per person."] });
  const transferts = partenaire("City Transfers (demo)", "Transfers", "transport", "Private vans to and from the airport", {
    contact: { telephones: [{ numero: "+1 202 555 0122", libelle: "", whatsapp: true }], adresse: "12 Station Street, Old Town" },
    contrat: { statut: "Verbal agreement", etat: "attention", fin: j(-5) },
  });
  partenaires_prives.push({ id: uid(), entite_id: e.id, partenaire_id: transferts.id, banque: {}, paiement: "Cash to the driver's office at the end of the month.", commissions: [] });
  const plongee = partenaire("Reef Divers (demo)", "Activities", "mer", "Scuba diving and snorkelling, paid on site with a commission", {
    contact: { telephones: [{ numero: "+1 202 555 0133", libelle: "", whatsapp: true }], adresse: "Dive Shop, North Beach" },
    contrat: { statut: "Commission agreement", etat: "ok", fin: j(200) },
  });
  const cuisine = partenaire("Cooking School (demo)", "Activities", "terre", "Local cooking classes, morning and evening", { contact: { telephones: [{ numero: "+1 202 555 0144", libelle: "", whatsapp: false }], adresse: "8 Market Lane, Old Town" } });

  const pIles = prestation(bateaux, "excursion", "Shared boat trips", "Island hopping, full day", 65, "pp", 45, { horaires: "08:30 - 16:00", inclus: "Hotel pickup, lunch, snorkelling gear, fruit.", conditions: "Weather permitting." });
  prestation(bateaux, "excursion", "Shared boat trips", "Island hopping, child 3 to 11 years", 45, "ch", 30, {});
  const pPrive = prestation(bateaux, "excursion", "Private boat", "Private boat to Turtle Island, 1 to 8 people", 420, "boat", 320, { capacite: "1 to 8 people", inclus: "Boat, skipper, lunch, snorkelling gear." });
  const pSunset = prestation(bateaux, "activite", "Sunset cruise", "Sunset cruise, 2 hours", 40, "pp", 28, { duree: "17:00 - 19:00" });
  const pAeroport = prestation(transferts, "transfert", "Private van", "City Airport → hotel", 45, "veh", 35, { note: "Up to 8 people, luggage included." });
  const pRetour = prestation(transferts, "transfert", "Private van", "Hotel → City Airport", 45, "veh", 35, {});
  const pPlongee = prestation(plongee, "activite", "Diving", "Discover scuba diving", 110, "pp", null, {}, { sur_place: true });
  const pSnorkel = prestation(plongee, "activite", "Snorkelling", "Reef snorkelling, half day", 35, "pp", null, {}, { sur_place: true });
  const pCuisine = prestation(cuisine, "activite", "Cooking class", "Cooking class with market tour", 50, "pp", 35, { horaires: "09:00 - 13:00" });
  prestation(null, "frais", "Marine park fee", "Turtle Island marine park", 10, "ad", null, { enfant: 5, note: "Paid in cash at the park entrance." }, { sur_place: true });

  // ---- Clients, dossiers, factures, paiements et réservations ----
  const clients = [];
  const dossiers = [];
  const documents = [];
  const paiements = [];
  const reservations = [];
  const reservations_nets = [];
  const civilites = ["Mr", "Mrs", "Ms"];
  const client = (i) => {
    const c = { id: uid(), created_at: j(-380), entite_id: e.id, civilite: civilites[i % 3], prenom: PRENOMS[i % PRENOMS.length], nom: NOMS[(i * 7 + 3) % NOMS.length], adresse: choix(HOTELS), telephone: `+1 202 555 01${String(50 + (i % 50)).padStart(2, "0")}`, email: "", notes: "" };
    clients.push(c);
    return c;
  };
  const tous = Array.from({ length: 36 }, (_, i) => client(i));
  const SERVICES = [
    { p: pIles, pers: true, poids: 5 },
    { p: pPrive, pers: false, poids: 2 },
    { p: pSunset, pers: true, poids: 3, heure: "16:30" },
    { p: pAeroport, pers: false, poids: 3 },
    { p: pRetour, pers: false, poids: 2 },
    { p: pCuisine, pers: true, poids: 2, heure: "08:45" },
    { p: pPlongee, pers: true, poids: 2, place: 0.2, heure: "07:30" },
    { p: pSnorkel, pers: true, poids: 2, place: 0.15 },
  ];
  const netDe = (p) => (prestations_nets.find((n) => n.prestation_id === p.id) || {}).net ?? null;
  const pool = SERVICES.flatMap((s) => Array(s.poids).fill(s));
  const poidsMois = { 1: 1.4, 2: 1.4, 3: 1.2, 4: 1, 5: 0.7, 6: 0.9, 7: 1.3, 8: 1.4, 9: 0.8, 10: 0.7, 11: 0.9, 12: 1.5 };
  const contenu = (lignes) => ({ ...CONTENU_DEFAUT(), colonnes: "detail", lignes, langue: "en" });
  let numero = 0;

  // Un dossier : facture directe à la création (pas de devis), réservations chez les partenaires, paiement selon l'avancement.
  const dossier = (c, creeLe, choisis, { pax = 2, serviceLe, responsable = owner, paye = true, annule = false, pickup = null, heure = "08:00", statut = null } = {}) => {
    numero += 1;
    const d = { id: uid(), created_at: creeLe, entite_id: e.id, ref: `BL-${creeLe.slice(0, 4)}-${String(numero).padStart(4, "0")}`, client_id: c.id, pays: choisis[0].p.famille === "transfert" ? "Transfer" : "Tour", bandeau: "", date_depart: serviceLe, date_retour: null, accepte_le: creeLe, annule, notes: "", responsable_id: responsable.user_id };
    dossiers.push(d);
    const lignes = choisis.map((s) => ({ ...nouvelleLigne("ligne", { libelle: s.p.libelle, unite: s.p.prix_vente, qte: s.pers ? pax : 1 }), paye_sur_place: !!s.place, _s: s }));
    documents.push({ id: uid(), created_at: creeLe, updated_at: creeLe, entite_id: e.id, dossier_id: d.id, type: "facture", date_emission: creeLe, envoye_le: creeLe, contenu: contenu(lignes.map(({ _s, ...l }) => l)) });
    const aPayer = lignes.filter((l) => !l.paye_sur_place).reduce((t, l) => t + l.unite * l.qte, 0);
    if (paye && !annule && aPayer) paiements.push({ id: uid(), created_at: creeLe, entite_id: e.id, dossier_id: d.id, date: ajouterJours(creeLe, entre(0, 3)) > ajd ? ajd : ajouterJours(creeLe, entre(0, 3)), montant: aPayer, type: "solde", moyen: choix(["virement", "paypal", "especes"]), origine_montant: null, origine_devise: "", note: "" });
    lignes.forEach((l, k) => {
      const s = l._s;
      const vente = l.unite * l.qte;
      const date = ajouterJours(serviceLe, k % 2);
      const r = { id: uid(), created_at: creeLe, updated_at: creeLe, entite_id: e.id, dossier_id: d.id, ligne_id: l.id, prestation_id: s.p.id, trajet_id: null, partenaire_id: s.p.partenaire_id, libelle: l.libelle, date_service: date, heure_pickup: s.heure || heure, lieu_pickup: pickup || c.adresse, personnes: { adultes: s.pers ? pax : 2, enfants: 0, bebes: 0 }, statut: statut || (annule ? "annule" : "confirme"), reference_partenaire: "", montant_vente: vente, notes: "", details: {}, cree_par: responsable.user_id, paye_sur_place: !!s.place };
      reservations.push(r);
      const n = { id: uid(), entite_id: e.id, reservation_id: r.id, net_prevu: null, net_paye: null, paye_le: null, commission_prevue: null, commission_recue: null, commission_recue_le: null };
      if (s.place) {
        n.commission_prevue = Math.round(vente * s.place);
        if (ajouterJours(date, 10) < ajd) Object.assign(n, { commission_recue: n.commission_prevue, commission_recue_le: ajouterJours(date, 7) });
      } else {
        const net = netDe(s.p);
        if (net != null) {
          n.net_prevu = net * (s.pers ? pax : 1);
          if (ajouterJours(date, 7) < ajd && !annule) Object.assign(n, { net_paye: n.net_prevu, paye_le: ajouterJours(date, 5) });
        }
      }
      reservations_nets.push(n);
    });
    return d;
  };

  // Treize mois d'historique pour les statistiques (le plus ancien d'abord, pour des numéros dans l'ordre).
  const jours = [];
  for (let n = 395; n >= 4; n--) {
    const jour = j(-n);
    const copies = Math.round((poidsMois[Number(jour.slice(5, 7))] || 1) * 10);
    for (let k = 0; k < copies; k++) jours.push(n);
  }
  const ages = Array.from({ length: 90 }, () => jours[Math.floor(rnd() * jours.length)]).sort((a, b) => b - a);
  for (const age of ages) {
    const choisis = [];
    const nSvc = rnd() < 0.6 ? 1 : 2;
    while (choisis.length < nSvc) {
      const s = choix(pool);
      if (!choisis.includes(s)) choisis.push(s);
    }
    dossier(choix(tous), j(-age), choisis, { pax: entre(1, 5), serviceLe: j(-age + entre(1, 6)), responsable: choix([owner, owner, sales]), annule: rnd() < 0.06 });
  }

  // La semaine en cours : hier, aujourd'hui, demain, avec une facture pas encore payée et une réservation à confirmer.
  const s = (p) => SERVICES.find((x) => x.p === p);
  const d1 = dossier(tous[0], j(-3), [s(pIles), s(pSunset)], { pax: 2, serviceLe: j(0), responsable: sales, pickup: "Sunset Hotel, North Beach" });
  dossier(tous[1], j(-2), [s(pAeroport)], { serviceLe: j(0), pickup: "City Airport, flight BL 214", heure: "14:30" });
  const d3 = dossier(tous[2], j(-1), [s(pPrive)], { serviceLe: j(1), paye: false, pickup: "Lagoon Villas", statut: "demande" });
  dossier(tous[3], j(-1), [s(pPlongee)], { pax: 2, serviceLe: j(1), responsable: sales, heure: "07:30" });
  dossier(tous[4], j(-5), [s(pCuisine)], { pax: 3, serviceLe: j(-1) });
  const d6 = dossier(tous[5], j(0), [s(pRetour)], { serviceLe: j(3), paye: false, heure: "06:00" });

  const tache = (titre, jours, assignee, d, extra = {}) => ({ id: uid(), created_at: j(-2), entite_id: e.id, dossier_id: d ? d.id : null, partenaire_id: null, titre, description: "", echeance: jours === null ? null : j(jours), assignee_id: assignee ? assignee.user_id : null, fait: false, fait_le: null, fait_par: null, cree_par: owner.user_id, ...extra });
  const taches = [
    tache("Confirm tomorrow's private boat with Island Boats", 0, sales, d3),
    tache("Send the payment reminder", 1, owner, d6),
    tache("Check pickup time with the guests", 0, sales, d1),
    tache("Renew the City Transfers agreement", null, null, null, { partenaire_id: transferts.id, description: "The verbal agreement ended last week." }),
  ];

  return {
    organisations,
    entites: [e],
    profils: [owner, sales, guide],
    roles,
    membres,
    reglages,
    clients,
    dossiers,
    documents,
    paiements,
    catalogue: [],
    taches,
    partenaires,
    partenaires_prives,
    prestations,
    prestations_nets,
    trajets: [],
    trajets_nets: [],
    reservations,
    reservations_nets,
    demandes_site: [],
    bandeaux_site: [],
    partages_clients: [],
    pieces: [],
    fichiers: {},
    journal: [],
  };
}
