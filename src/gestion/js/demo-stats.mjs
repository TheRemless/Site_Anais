// Données de démonstration pour les statistiques : treize mois d'activité FICTIVE pour « Excursions démo » (bahts, avec quelques
// dossiers en euros) et « Agence démo » (francs suisses). Noms, prix et partenaires sont inventés. Le hasard est fixé :
// la démonstration donne les mêmes chiffres à chaque ouverture, ce qui permet de vérifier l'écran et les tests.
// `outils` vient de defauts.mjs (uid, contenu, nouvelleLigne, ajouterJours) : le fichier ne l'importe pas, pour éviter une boucle.

const PRENOMS = ["Emma", "Lucas", "Mia", "Noah", "Zoé", "Liam", "Inès", "Hugo", "Lina", "Tom", "Alba", "Finn", "Nora", "Max", "Elsa", "Jonas", "Clara", "Paul", "Ida", "Leo"];
const NOMS = ["Bernard", "Keller", "Moreau", "Schmid", "Dubois", "Weber", "Laurent", "Fischer", "Roche", "Meier", "Girard", "Huber", "Blanc", "Frei", "Lopez", "Brunner", "Vogel", "Colin", "Berset", "Nguyen"];
const HOTELS = ["Hotel Sunset", "Hotel Palm", "Sea Bungalows", "Resort Klong Dao", "Lagoon Villa", "Old Town Guesthouse"];

// Générateur pseudo-aléatoire fixe (mulberry32).
function hasard(graine) {
  let a = graine;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function enrichirDemoStats(d, { ajd, ajouterJours, uid, contenu, nouvelleLigne }) {
  const j = (n) => ajouterJours(ajd, n);
  const rnd = hasard(20261111);
  const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const choix = (l) => l[Math.floor(rnd() * l.length)];
  const [e1, e2] = d.entites;
  const admin = d.profils[0];
  const assistante = d.profils[1];
  const stagiaire = d.profils[2];

  const client = (e, i) => {
    const c = { id: uid(), created_at: j(-200), entite_id: e.id, civilite: i % 2 ? "Madame" : "Monsieur", prenom: PRENOMS[i % PRENOMS.length], nom: NOMS[(i * 7 + 3) % NOMS.length], adresse: `${choix(HOTELS)}\nKoh Lanta`, telephone: `+00 000 000 ${String(i).padStart(2, "0")}`, email: "", notes: "" };
    d.clients.push(c);
    return c;
  };

  // ---- Excursions démo : partenaires de plus, payés sur place avec commission ----
  const partenaire = (nom, categorie, role, adresse = `${10 + d.partenaires.length} Moo 3, Koh Lanta, Krabi 81150`) => {
    const p = { id: uid(), created_at: j(-90), updated_at: j(-90), entite_id: e2.id, nom, nom_thai: "", categorie, groupe: "mer", role, contact: adresse ? { adresse } : {}, regles: {}, contrat: { statut: "Accord de commission", etat: "ok", fin: j(200) }, notes: "", ordre: d.partenaires.length + 1, actif: true };
    d.partenaires.push(p);
    return p;
  };
  const kayak = partenaire("Kayak mangroves démo", "Activités", "Kayak dans les mangroves, demi-journée");
  const plongee = partenaire("Plongée démo", "Activités", "Baptême et sorties de plongée", "");
  const nomme = (n) => d.partenaires.find((p) => p.nom === n);
  const longtail = nomme("Longtail démo");
  const speed = nomme("Speedboat démo");
  const taxi = nomme("Transferts démo");
  const prest = (p, famille, libelle, prix, unite, extra = {}) => {
    const x = { id: uid(), created_at: j(-90), updated_at: j(-90), entite_id: e2.id, partenaire_id: p.id, famille, groupe: "", libelle, libelle_en: "", details: {}, prix_vente: prix, unite, sur_place: false, ordre: d.prestations.length + 1, actif: true, ...extra };
    d.prestations.push(x);
    return x;
  };
  // Noms de services en anglais, comme chez Secret : ce sont eux qui partent sur les factures et les vouchers.
  const pKayak = prest(kayak, "activite", "Mangrove kayaking, half day", 900, "pp");
  const pPlongee = prest(plongee, "activite", "Discover Scuba Diving", 2800, "pp");
  // Tarif « prix de base pour 1 ou 2 personnes, puis un supplément par personne en plus » (fictif) : base au groupe, supplément à la personne.
  const radeaux = partenaire("Radeaux démo", "Excursions", "Radeaux en bois, programmes privés");
  const pRadeauxBase = prest(radeaux, "excursion", "Programme B: Private fishing demo, Base 1-2 pax", 3500, "grp");
  const pRadeauxSup = prest(radeaux, "excursion", "Programme B: Private fishing demo, Extra person", 1500, "sup");
  pRadeauxBase.groupe = pRadeauxSup.groupe = "Private rafts demo";

  // Catalogue de services : [prestation, prix unitaire, net unitaire, unité, taux de commission si payé sur place, durée avant le service]
  const byLib = (l) => d.prestations.find((p) => p.libelle.startsWith(l));
  const SERVICES = [
    { p: byLib("4 Islands by longtail, full day"), prix: 1200, net: 800, pers: true, poids: 5 },
    { p: byLib("Koh Rok by private longtail"), prix: 6500, net: 5000, pers: false, poids: 2 },
    { p: byLib("Krabi Airport"), prix: 2500, net: 2250, pers: false, poids: 4 },
    { p: byLib("Sunset by longtail"), prix: 700, net: 500, pers: true, poids: 2 },
    { p: byLib("Koh Lanta → Phuket Airport"), prix: 4500, net: 4050, pers: false, poids: 1 },
    { p: pKayak, prix: 900, net: null, pers: true, poids: 3, place: 0.15 },
    { p: pPlongee, prix: 2800, net: null, pers: true, poids: 2, place: 0.2 },
  ];
  const pool = SERVICES.flatMap((s) => Array(s.poids).fill(s));
  const speedTrajet = d.trajets.find((t) => t.vers === "Koh Phi Phi");

  // Poids de saison : haute saison de novembre à avril.
  const poidsMois = { 1: 1.5, 2: 1.5, 3: 1.3, 4: 1, 5: 0.5, 6: 0.4, 7: 0.4, 8: 0.5, 9: 0.5, 10: 0.7, 11: 1.2, 12: 1.6 };
  const jours = [];
  for (let n = 395; n >= 0; n--) {
    const jour = j(-n);
    const copies = Math.round((poidsMois[Number(jour.slice(5, 7))] || 1) * (n < 14 ? 3 : n < 40 ? 1.6 : 1));
    for (let k = 0; k < copies; k++) jours.push(n);
  }
  const clientsE2 = Array.from({ length: 34 }, (_, i) => client(e2, i));

  const dossierDe = (e, c, ref, creeLe, responsable) => {
    const x = { id: uid(), created_at: creeLe, entite_id: e.id, ref, client_id: c.id, pays: "", bandeau: "", date_depart: null, date_retour: null, accepte_le: null, annule: false, notes: "", responsable_id: responsable ? responsable.user_id : admin.user_id };
    d.dossiers.push(x);
    return x;
  };
  const docDe = (e, dossier, type, date, lignes, devise) => {
    const doc = { id: uid(), created_at: date, updated_at: date, entite_id: e.id, dossier_id: dossier.id, type, date_emission: date, envoye_le: null, contenu: { ...contenu("", lignes, "detail"), ...(devise ? { devise } : {}) } };
    d.documents.push(doc);
    return doc;
  };
  const paiement = (e, dossier, date, montant, type, moyen, extra = {}) => d.paiements.push({ id: uid(), created_at: date, entite_id: e.id, dossier_id: dossier.id, date, montant, type, moyen, origine_montant: null, origine_devise: "", note: "", ...extra });

  const nbE2 = 120;
  for (let i = 0; i < nbE2; i++) {
    const age = jours[Math.floor(rnd() * jours.length)];
    const creeLe = j(-age);
    const euro = i % 19 === 7;
    const c = clientsE2[Math.floor(rnd() * clientsE2.length)];
    const nSvc = rnd() < 0.55 ? 1 : rnd() < 0.7 ? 2 : 3;
    const choisis = [];
    while (choisis.length < nSvc) {
      const s = choix(pool);
      if (!choisis.includes(s)) choisis.push(s);
    }
    const pax = entre(1, 5);
    const responsable = choix([admin, admin, assistante, stagiaire]);
    const dossier = dossierDe(e2, c, `EX-${creeLe.slice(0, 4)}-${String(d.dossiers.filter((x) => x.entite_id === e2.id).length + 1).padStart(4, "0")}`, creeLe, responsable);
    dossier.pays = choisis[0].p.famille === "transfert" ? "Transfer" : "Excursion";
    // Comme chez Secret : pas de devis, la facture part à la création du dossier, qui est accepté ce jour-là.
    // Quelques dossiers sont annulés ensuite (le client renonce) : la facture reste, aucun paiement.
    const annule = rnd() < 0.08;
    const lignes = choisis.map((s) => {
      const qte = s.pers ? pax : 1;
      const unite = euro ? Math.round(s.prix / 36) : s.prix;
      return { ...nouvelleLigne("ligne", { libelle: s.p.libelle, unite, qte }), paye_sur_place: !!s.place, _s: s };
    });
    const nettes = lignes.map(({ _s, ...l }) => l);
    dossier.annule = annule;
    const facture = docDe(e2, dossier, "facture", creeLe, nettes, euro ? "EUR" : null);
    dossier.accepte_le = facture.date_emission;
    // Réservations auprès des partenaires.
    const serviceLe = ajouterJours(dossier.accepte_le || creeLe, entre(1, 18));
    lignes.forEach((l, k) => {
      const s = l._s;
      const passe = serviceLe < ajd;
      const vente = Math.round(l.unite * l.qte);
      const r = { id: uid(), created_at: creeLe, updated_at: creeLe, entite_id: e2.id, dossier_id: dossier.id, ligne_id: l.id, prestation_id: s.p.id, trajet_id: null, partenaire_id: s.p.partenaire_id, libelle: l.libelle, date_service: ajouterJours(serviceLe, k % 2), heure_pickup: "08:00", lieu_pickup: choix(HOTELS), personnes: { adultes: s.pers ? pax : entre(1, 4), enfants: s.pers && rnd() < 0.25 ? 1 : 0, bebes: 0 }, statut: dossier.annule ? "annule" : passe ? "confirme" : choix(["confirme", "confirme", "confirme"]), reference_partenaire: "", montant_vente: vente, notes: "", details: {}, cree_par: admin.user_id, paye_sur_place: !!s.place };
      d.reservations.push(r);
      const n = { id: uid(), entite_id: e2.id, reservation_id: r.id, net_prevu: null, net_paye: null, paye_le: null, commission_prevue: null, commission_recue: null, commission_recue_le: null };
      if (s.place) {
        // Commission saisie dans 80 % des cas ; reçue dans 60 % des cas quand le service date de plus de dix jours.
        if (rnd() < 0.9) n.commission_prevue = Math.round(vente * s.place);
        if (n.commission_prevue !== null && ajouterJours(r.date_service, 10) < ajd && rnd() < 0.6) {
          n.commission_recue = n.commission_prevue;
          n.commission_recue_le = ajouterJours(r.date_service, entre(8, 25)) > ajd ? ajd : ajouterJours(r.date_service, entre(8, 25));
        }
      } else if (s.net !== null) {
        n.net_prevu = Math.round((euro ? s.net / 36 : s.net) * (s.pers ? pax : 1));
        if (passe && rnd() < 0.85) (n.net_paye = n.net_prevu), (n.paye_le = ajouterJours(r.date_service, entre(1, 6)) > ajd ? ajd : ajouterJours(r.date_service, entre(1, 6)));
      }
      d.reservations_nets.push(n);
    });
    // Paiements : soldés pour 80 % des factures passées, acompte pour d'autres, rien pour quelques-unes (impayés).
    if (!annule) {
      const total = nettes.filter((l) => !l.paye_sur_place).reduce((s, l) => s + l.unite * l.qte, 0);
      const quand = ajouterJours(serviceLe, -entre(0, 3)) > ajd ? ajd : ajouterJours(serviceLe, -entre(0, 3));
      const t = rnd();
      if (total > 0) {
        if (t < (age > 40 ? 0.93 : 0.78)) paiement(e2, dossier, quand < facture.date_emission ? facture.date_emission : quand, total, "solde", choix(["especes", "virement", "especes"]));
        else if (t < (age > 40 ? 0.97 : 0.88)) paiement(e2, dossier, facture.date_emission, Math.round(total / 2), "acompte", "virement");
      }
    }
  }
  // Un remboursement et un billet de bateau, pour voir les cas limites.
  const dossierTrajet = d.dossiers.filter((x) => x.entite_id === e2.id && x.accepte_le && !x.annule).slice(-3)[0];
  if (dossierTrajet && speedTrajet) {
    d.reservations.push({ id: uid(), created_at: j(-3), updated_at: j(-3), entite_id: e2.id, dossier_id: dossierTrajet.id, ligne_id: "", prestation_id: null, trajet_id: speedTrajet.id, partenaire_id: speed.id, libelle: "Koh Lanta → Koh Phi Phi, speedboat", date_service: j(4), heure_pickup: "10:30", lieu_pickup: "", personnes: { adultes: 2, enfants: 1, bebes: 0 }, statut: "confirme", reference_partenaire: "SB-1", montant_vente: 2700, notes: "", details: {}, cree_par: admin.user_id, paye_sur_place: false });
    d.reservations_nets.push({ id: uid(), entite_id: e2.id, reservation_id: d.reservations[d.reservations.length - 1].id, net_prevu: 2100, net_paye: null, paye_le: null, commission_prevue: null, commission_recue: null, commission_recue_le: null });
  }
  if (dossierTrajet) paiement(e2, dossierTrajet, j(-2), -600, "remboursement", "virement");

  // ---- Agence démo : treize mois de voyages sur mesure en francs suisses ----
  const pays = ["Thaïlande", "Thaïlande", "Thaïlande", "Indonésie", "Vietnam"];
  const clientsE1 = Array.from({ length: 16 }, (_, i) => client(e1, i + 40));
  for (let i = 0; i < 22; i++) {
    const age = 5 + Math.floor((i / 22) * 390) + entre(0, 6);
    const creeLe = j(-age);
    const c = clientsE1[i % clientsE1.length];
    const dossier = dossierDe(e1, c, `${c.prenom[0]}${c.nom[0]}${creeLe.replaceAll("-", "")} ${pays[i % pays.length]}`, creeLe, i % 3 ? admin : assistante);
    dossier.pays = pays[i % pays.length];
    const jours14 = entre(10, 21);
    const lignes = [nouvelleLigne("bloc", { libelle: "Formule complète DUO", intro: "comprenant:", puces: ["itinéraire sur mesure", "carnet de voyage"], unite: 40, qte: jours14 })];
    if (i % 4 === 0) lignes.push(nouvelleLigne("ligne", { libelle: "Hébergements, sélection supplémentaire", montant: 120 }));
    docDe(e1, dossier, "devis", creeLe, lignes);
    const accepte = age > 12 ? i % 5 !== 3 : i % 2 === 0;
    if (accepte) {
      dossier.accepte_le = ajouterJours(creeLe, entre(2, 12)) > ajd ? ajd : ajouterJours(creeLe, entre(2, 12));
      dossier.date_depart = ajouterJours(dossier.accepte_le, entre(30, 120));
      dossier.date_retour = ajouterJours(dossier.date_depart, jours14 - 1);
    } else dossier.annule = age > 45;
    if (dossier.accepte_le && i % 7 === 5) dossier.annule = true;
    if (dossier.accepte_le && !dossier.annule && age > 40) {
      const f = docDe(e1, dossier, "facture", ajouterJours(dossier.accepte_le, 3) > ajd ? ajd : ajouterJours(dossier.accepte_le, 3), lignes);
      const total = lignes.reduce((s, l) => s + (l.unite && l.qte ? l.unite * l.qte : l.montant || 0), 0);
      const t = i % 6;
      if (t < 4) {
        paiement(e1, dossier, ajouterJours(f.date_emission, 2) > ajd ? ajd : ajouterJours(f.date_emission, 2), Math.round(total / 2), "acompte", "virement");
        if (t < 3) paiement(e1, dossier, ajouterJours(f.date_emission, 25) > ajd ? ajd : ajouterJours(f.date_emission, 25), total - Math.round(total / 2), "solde", "virement");
      }
    }
  }
  // ---- Journal d'activité : une trentaine de lignes fictives pour voir l'écran rempli (filtres par sujet et par personne) ----
  const jr = (jours, heure, entite, personne, table, action, libelle, details = {}) =>
    d.journal.push({ id: d.journal.length + 1, created_at: `${j(jours)}T${heure}:00.000Z`, entite_id: entite.id, user_id: personne.user_id, table_name: table, action, cible: "", libelle, details });
  const recents = d.dossiers.filter((x) => x.entite_id === e2.id).slice(-6);
  recents.forEach((x, k) => {
    const qui = [admin, assistante, stagiaire][k % 3];
    jr(-12 + k, "03:10", e2, qui, "dossiers", "insert", x.ref || "");
    jr(-12 + k, "03:25", e2, qui, "documents", "insert", `facture ${x.ref || ""}`);
    jr(-10 + k, "08:40", e2, assistante, "dossiers", "update", x.ref || "", { responsable_id: { avant: null, apres: assistante.user_id } });
    jr(-9 + k, "09:05", e2, admin, "paiements", "insert", `1'200 ${x.ref || ""}`);
  });
  jr(-4, "05:30", e2, admin, "roles", "update", "Éditeur", { permissions: "modifié" });
  jr(-3, "02:15", e2, admin, "membres", "insert", "stagiaire@demo.test");
  jr(-2, "07:00", e2, admin, "reglages", "update", "");
  jr(-1, "06:20", e2, stagiaire, "taches", "insert", "Rappeler le client avant le départ");
  jr(-1, "08:00", e2, assistante, "clients", "update", "Emma Schmid", { telephone: { avant: "+00 000 000 01", apres: "+00 000 000 11" } });
  d.journal.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return d;
}
