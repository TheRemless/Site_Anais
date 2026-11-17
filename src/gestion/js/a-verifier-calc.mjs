// « À vérifier » : les cas qui se règlent mieux au calme que devant un client. Calcul pur (aucune écriture, rien n'est corrigé automatiquement), testé avec node --test.
// `db` : la copie en mémoire de l'entreprise active. `droits` : { partenaires, dossiers, clients, nets } (booleens). `aujourdhui` : AAAA-MM-JJ.
// Renvoie les contrôles qui ont au moins un cas : { cle, droit, aRelire, elements: [{ id, lien, texte, detail }] }. `aRelire` : un doute, pas une erreur certaine.
// `taxi` : l'entreprise est VIP Taxi Lanta (aucune facture montrée, le prix interne suit la course seul : pas de contrôle facture contre réservation,
// ni de net ou de commission : Mr. Brown n'est pas payé par l'agence et sa commission se saisit le lendemain).
// `reglage` : les réglages de l'écran (reglages.a_verifier), voir `reglageAVerifier`.
import { ecartReservation, estFraisDeParc, hotelEtChambre, dateTexte } from "./operations-calc.mjs";

// Les contrôles, dans l'ordre de l'écran. Chacun peut être coupé dans les réglages de l'écran (17.11.2026, audit section 2).
export const CONTROLES = [
  "services_sans_heure", "services_sans_lieu", "services_sans_prix", "services_sans_net", "services_sans_commission",
  "factures_differentes_reservation", "notes_sur_place_hors_frais", "dossiers_sans_responsable", "clients_en_double", "clients_sans_contact",
  "trajets_sans_prix", "prestations_prix_en_texte", "prestations_sur_place_hors_frais", "prestations_a_zero", "prestations_sans_net", "groupes_en_double",
  "partenaires_sans_telephone", "partenaires_sans_whatsapp", "trajets_duree",
];
// Seuils par défaut : ceux d'avant les réglages (20 minutes d'écart de durée, un téléphone d'au moins 6 chiffres, 100 lignes par contrôle) et 7 jours pour
// l'heure et le lieu de pickup (plus loin, ils se fixent souvent la veille).
export const REGLAGE_A_VERIFIER = { ecart_duree_min: 20, chiffres_telephone: 6, lignes_max: 100, horizon_jours: 7, desactives: [] };
const entier = (v, defaut, min, max) => (Number.isInteger(Number(v)) && v !== "" && v !== null && Number(v) >= min && Number(v) <= max ? Number(v) : defaut);
// Les réglages enregistrés, complétés et bornés : une valeur absente ou hors limites reprend le défaut.
export function reglageAVerifier(brut) {
  const r = brut && typeof brut === "object" ? brut : {};
  const d = REGLAGE_A_VERIFIER;
  return {
    ecart_duree_min: entier(r.ecart_duree_min, d.ecart_duree_min, 0, 1440),
    chiffres_telephone: entier(r.chiffres_telephone, d.chiffres_telephone, 1, 20),
    lignes_max: entier(r.lignes_max, d.lignes_max, 10, 1000),
    horizon_jours: entier(r.horizon_jours, d.horizon_jours, 0, 365),
    desactives: Array.isArray(r.desactives) ? r.desactives.filter((c) => CONTROLES.includes(c)) : [],
  };
}
const plusJours = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);


const sansAccents = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const vide = (v) => v === null || v === undefined || v === "" || Number(v) <= 0;

// Heure « 10:30 », « 10h30 », « 10.30 », « 2:30 PM » → minutes depuis minuit, ou null.
export function minutesDepuisHeure(texte) {
  const t = String(texte || "");
  const m = /(\d{1,2})\s*[:h.]\s*(\d{2})?/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (/pm/i.test(t) && h < 12) h += 12;
  if (/am/i.test(t) && h === 12) h = 0;
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

// Durée écrite à la main → minutes, ou null quand on ne la comprend pas ou qu'elle est ambiguë :
// « 3 h », « 1h30 », « 1,5 h », « Environ 3h00 », « 45 min », « 2 heures (1h+1h) » (le total d'abord), « 1h+1h » (somme), mais pas « 1h-1h30 » ni « 3 à 4 heures » (fourchettes).
export function minutesDepuisDuree(texte) {
  const brut = String(texte || "").toLowerCase();
  if (/\d\s*(?:h|min|mn)?\s*(?:-|–|à|to)\s*\d/.test(brut.replace(/\(.*?\)/g, ""))) return null;
  const un = (t) => {
    let m = /(\d+)\s*h(?:eures?|ours?)?\s*(\d{1,2})(?!\d)/.exec(t);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = /(\d+(?:[.,]\d+)?)\s*(?:h|heures?|hours?)(?![a-z])/.exec(t);
    if (m) return Math.round(Number(m[1].replace(",", ".")) * 60);
    m = /(\d+)\s*(?:min|mn)/.exec(t);
    return m ? Number(m[1]) : null;
  };
  const sansParentheses = brut.replace(/\(.*?\)/g, " ");
  const somme = (t) => {
    const parties = t.split("+").map(un);
    return parties.length && parties.every((x) => x !== null) ? parties.reduce((s, x) => s + x, 0) : null;
  };
  return somme(sansParentheses) ?? somme((/\((.*?)\)/.exec(brut) || [])[1] || "");
}

// Écart entre la durée affichée et « arrivée moins départ » (passage de minuit compris), en minutes ; null si une des trois données manque.
export function ecartDuree(trajet) {
  const d = minutesDepuisHeure(trajet.depart);
  const a = minutesDepuisHeure(trajet.arrivee);
  const duree = minutesDepuisDuree(trajet.duree);
  if (d === null || a === null || duree === null) return null;
  const calculee = (a - d + 1440) % 1440;
  return Math.abs(calculee - duree);
}

// Un prix écrit dans le texte d'une prestation (« 1 200 THB », « 1,200 baht ») alors que son prix de vente est vide.
const PRIX_EN_TEXTE = /\d[\d' ,.]*\s*(?:฿|thb|baht|chf|eur|€)/i;
const prixDansTexte = (details) => Object.values(details || {}).some((v) => typeof v === "string" && PRIX_EN_TEXTE.test(v));


// `tr` : la traduction de l'interface (par défaut, le texte tel quel) pour les petites phrases composées ici.
const traduireParDefaut = (texte, vars = {}) => String(texte).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));

export function aVerifier(db, { droits = {}, aujourdhui = "", tr = traduireParDefaut, taxi = false, reglage = null } = {}) {
  const regle = reglageAVerifier(reglage);
  const coupes = new Set(regle.desactives);
  const telephonesDe = (p) => ((p && p.contact && p.contact.telephones) || []).filter((t) => String(t.numero || "").replace(/\D/g, "").length >= regle.chiffres_telephone);
  const sorties = [];
  const ajouter = (cle, droit, aRelire, elements) => !coupes.has(cle) && elements.length && sorties.push({ cle, droit, aRelire, elements });
  const partenaires = db.partenaires || [];
  const nomPartenaire = (id) => (partenaires.find((p) => p.id === id) || {}).nom || "";
  const prestations = (db.prestations || []).filter((x) => x.actif !== false);
  const trajets = (db.trajets || []).filter((x) => x.actif !== false);
  const prest = (x, detail) => ({ id: x.id, lien: `#/tarifs?famille=${x.famille || ""}&q=${encodeURIComponent(x.libelle || "")}`, texte: x.libelle, detail: [nomPartenaire(x.partenaire_id), detail].filter(Boolean).join(" · ") });

  // Catalogue
  ajouter("trajets_sans_prix", "partenaires", false, trajets.filter((t) => vide(t.prix_adulte)).map((t) => ({ id: t.id, lien: `#/trajets?de=${encodeURIComponent(t.de)}&vers=${encodeURIComponent(t.vers)}`, texte: `${t.de} → ${t.vers}${t.depart ? `, ${t.depart}` : ""}`, detail: [nomPartenaire(t.partenaire_id), t.mode].filter(Boolean).join(" · ") })));
  ajouter("prestations_prix_en_texte", "partenaires", true, prestations.filter((x) => !x.sur_place && (x.prix_vente === null || x.prix_vente === undefined) && prixDansTexte(x.details)).map((x) => prest(x, "")));
  // « Sur place » coché sur une prestation qui n'est pas un frais de parc : elle entre dans les dossiers comme une note hors total au lieu d'un service
  // (16.11.2026, deux prestations de Mr Palm). Les prestations archivées comptent aussi : réactivées, elles referaient la même note.
  ajouter("prestations_sur_place_hors_frais", "partenaires", false, (db.prestations || []).filter((x) => x.sur_place && x.famille !== "frais").map((x) => prest(x, tr("famille « {famille} »", { famille: x.famille || "?" }))));
  ajouter("prestations_a_zero", "partenaires", false, prestations.filter((x) => !x.sur_place && x.prix_vente !== null && x.prix_vente !== undefined && Number(x.prix_vente) === 0).map((x) => prest(x, "")));
  if (droits.nets) {
    const nets = new Map((db.prestations_nets || []).map((n) => [n.prestation_id, n]));
    ajouter("prestations_sans_net", "partenaires", false, prestations.filter((x) => !x.sur_place && Number(x.prix_vente) > 0 && (!nets.has(x.id) || nets.get(x.id).net === null || nets.get(x.id).net === undefined)).map((x) => prest(x, "")));
  }
  // Groupes écrits de deux façons chez le même partenaire (majuscules, accents, espaces) : « à relire », ils se fondent peut-être en un seul.
  const groupes = new Map();
  for (const x of prestations) {
    if (!x.groupe) continue;
    const cle = `${x.partenaire_id || ""}|${x.famille}|${sansAccents(x.groupe).replace(/[^a-z0-9]+/g, " ").trim()}`;
    groupes.set(cle, [...(groupes.get(cle) || []), x]);
  }
  const doubles = [...groupes.values()].filter((l) => new Set(l.map((x) => x.groupe)).size > 1);
  ajouter("groupes_en_double", "partenaires", true, doubles.map((l) => ({ id: l[0].id, lien: `#/tarifs?famille=${l[0].famille || ""}&q=${encodeURIComponent(l[0].groupe)}`, texte: [...new Set(l.map((x) => x.groupe))].join(" / "), detail: nomPartenaire(l[0].partenaire_id) })));
  const actifs = partenaires.filter((p) => p.actif !== false);
  const lienP = (p) => ({ id: p.id, lien: `#/partenaire/${p.id}`, texte: p.nom, detail: p.role || p.categorie || "" });
  ajouter("partenaires_sans_telephone", "partenaires", false, actifs.filter((p) => !telephonesDe(p).length).map(lienP));
  ajouter("partenaires_sans_whatsapp", "partenaires", false, actifs.filter((p) => telephonesDe(p).length && !telephonesDe(p).some((t) => t.whatsapp)).map(lienP));
  ajouter("trajets_duree", "partenaires", true, trajets.map((t) => ({ t, e: ecartDuree(t) })).filter((x) => x.e !== null && x.e > regle.ecart_duree_min).map(({ t, e }) => ({ id: t.id, lien: `#/trajets?de=${encodeURIComponent(t.de)}&vers=${encodeURIComponent(t.vers)}`, texte: `${t.de} → ${t.vers}`, detail: `${t.depart || "?"} → ${t.arrivee || "?"}, ${tr("durée écrite « {duree} » (écart {ecart} min)", { duree: t.duree, ecart: e })}` })));

  // Réservations, clients, dossiers
  const annules = new Set((db.dossiers || []).filter((d) => d.annule).map((d) => d.id));
  const clientsParId = new Map((db.clients || []).map((c) => [c.id, c]));
  const clientDuDossier = new Map((db.dossiers || []).map((d) => [d.id, clientsParId.get(d.client_id)]));
  const dossiers = new Map((db.dossiers || []).map((d) => [d.id, d]));
  const nomClient = (c) => (c ? [c.prenom, c.nom].filter(Boolean).join(" ") : "");
  // Services à venir (17.11.2026, audit n° 45) : hors dossiers annulés, services annulés et frais de parc. L'heure et le lieu ne comptent que pour les jours
  // proches (`horizon_jours`), le prix, le net et la commission pour tous. Le lieu est celui de la feuille du jour : le lieu de pickup, sinon l'hôtel du client.
  const limite = aujourdhui ? plusJours(aujourdhui, regle.horizon_jours) : "9999-12-31";
  const aVenir = (db.reservations || []).filter((r) => r.statut !== "annule" && !annules.has(r.dossier_id) && dossiers.has(r.dossier_id) && r.date_service && r.date_service >= aujourdhui && !estFraisDeParc(r));
  const proches = aVenir.filter((r) => r.date_service <= limite);
  const service = (r) => ({ id: r.id, lien: `#/dossier/${r.dossier_id}`, texte: `${dossiers.get(r.dossier_id).ref || ""} · ${r.libelle || ""}`, detail: [dateTexte(r.date_service), nomClient(clientDuDossier.get(r.dossier_id))].filter(Boolean).join(" · ") });
  const parDate = (a, b) => String(a.date_service).localeCompare(String(b.date_service));
  ajouter("services_sans_heure", "dossiers", false, proches.filter((r) => !String(r.heure_pickup || "").trim()).sort(parDate).map(service));
  ajouter("services_sans_lieu", "dossiers", false, proches.filter((r) => !hotelEtChambre(clientDuDossier.get(r.dossier_id) || {}, r).hotel).sort(parDate).map(service));
  // Prix vide, pas à zéro : une prestation offerte vaut 0 (décision du 17.11.2026).
  ajouter("services_sans_prix", "dossiers", false, aVenir.filter((r) => r.montant_vente === null || r.montant_vente === undefined || r.montant_vente === "").sort(parDate).map(service));
  if (droits.nets && !taxi) {
    // Un service payé chez nous attend son net ; payé sur place, la commission que le prestataire reverse. Sans partenaire, ni l'un ni l'autre.
    const netsRes = new Map((db.reservations_nets || []).map((n) => [n.reservation_id, n]));
    const manque = (r, champ) => {
      const n = netsRes.get(r.id);
      return !n || n[champ] === null || n[champ] === undefined || n[champ] === "";
    };
    const avecPartenaire = aVenir.filter((r) => r.partenaire_id).sort(parDate);
    ajouter("services_sans_net", "dossiers", false, avecPartenaire.filter((r) => !r.paye_sur_place && manque(r, "net_prevu")).map(service));
    ajouter("services_sans_commission", "dossiers", false, avecPartenaire.filter((r) => r.paye_sur_place && manque(r, "commission_prevue")).map(service));
  }
  // Clients en double (« à relire ») : même téléphone (les 8 derniers chiffres, l'indicatif peut manquer), même e-mail ou même prénom et nom.
  const clients = db.clients || [];
  const chef = new Map(clients.map((c) => [c.id, c.id]));
  const racine = (id) => (chef.get(id) === id ? id : racine(chef.get(id)));
  const raisons = new Map();
  const vus = new Map();
  for (const c of clients) {
    const chiffresTel = String(c.telephone || "").replace(/\D/g, "");
    const nom = sansAccents([c.prenom, c.nom].join(" ")).replace(/[^a-z0-9]+/g, " ").trim();
    const cles = [
      chiffresTel.length >= Math.max(regle.chiffres_telephone, 8) ? ["telephone", chiffresTel.slice(-8)] : null,
      String(c.email || "").trim() ? ["email", String(c.email).trim().toLowerCase()] : null,
      String(c.prenom || "").trim() && String(c.nom || "").trim() ? ["nom", nom] : null,
    ].filter(Boolean);
    for (const [type, valeur] of cles) {
      const k = `${type}:${valeur}`;
      if (!vus.has(k)) {
        vus.set(k, c.id);
        continue;
      }
      const a = racine(vus.get(k));
      const b = racine(c.id);
      if (a !== b) chef.set(b, a);
      raisons.set(c.id, [...(raisons.get(c.id) || []), type]);
      raisons.set(vus.get(k), [...(raisons.get(vus.get(k)) || []), type]);
    }
  }
  const paquets = new Map();
  for (const c of clients) if (raisons.has(c.id)) paquets.set(racine(c.id), [...(paquets.get(racine(c.id)) || []), c]);
  const NOM_RAISON = { telephone: tr("même téléphone"), email: tr("même e-mail"), nom: tr("même nom") };
  ajouter("clients_en_double", "clients", true, [...paquets.values()].filter((l) => l.length > 1).map((l) => ({ id: l[0].id, lien: `#/client/${l[0].id}`, texte: l.map((c) => nomClient(c) || tr("(sans nom)")).join(" / "), detail: [...new Set(l.flatMap((c) => raisons.get(c.id) || []))].map((x) => NOM_RAISON[x]).join(", ") })));
  ajouter("clients_sans_contact", "clients", false, (db.clients || []).filter((c) => !String(c.telephone || "").replace(/\D/g, "") && !String(c.email || "").trim()).map((c) => ({ id: c.id, lien: `#/client/${c.id}`, texte: nomClient(c) || tr("(sans nom)"), detail: "" })));
  // Factures et devis : les documents de l'entreprise, quand l'écran a pu les charger (`db.documents`).
  const documents = db.documents || [];
  const toutesPrestations = new Map((db.prestations || []).map((x) => [x.id, x]));
  const NOM_DOC = { devis: tr("devis"), facture: tr("facture"), facture_locale: tr("facture locale") };
  // Une note « à régler sur place » laissée par une prestation qui n'est pas un frais : à retirer du document (dans l'éditeur, « Supprimer » sur la ligne).
  const notes = [];
  for (const doc of documents) {
    if (annules.has(doc.dossier_id) || !dossiers.has(doc.dossier_id)) continue;
    for (const l of (doc.contenu && doc.contenu.lignes) || []) {
      const x = l.kind === "texte" && l.sur_place && l.prestation_id ? toutesPrestations.get(l.prestation_id) : null;
      if (x && x.famille !== "frais") notes.push({ id: `${doc.id}:${l.id}`, lien: `#/doc/${doc.id}`, texte: `${dossiers.get(doc.dossier_id).ref || ""} · ${NOM_DOC[doc.type] || doc.type}`, detail: String(l.libelle || "").slice(0, 120) });
    }
  }
  ajouter("notes_sur_place_hors_frais", "dossiers", false, notes);
  // Ligne de facture différente de sa réservation : libellé, partenaire, montant vendu ou paiement (16.11.2026). Le document comparé est celui de la fiche
  // du dossier : la facture, sinon le devis.
  if (!taxi && documents.length) {
    const NOM_CHAMP = { libelle: tr("libellé"), partenaire_id: tr("partenaire"), montant_vente: tr("montant"), paye_sur_place: tr("paiement") };
    const ecarts = [];
    // Le document de référence de chaque dossier, calculé une fois : la facture, sinon le devis.
    const reference = new Map();
    for (const x of documents) {
      const deja = reference.get(x.dossier_id);
      if (x.type === "facture" ? !deja || deja.type !== "facture" : x.type === "devis" && !deja) reference.set(x.dossier_id, x);
    }
    for (const r of db.reservations || []) {
      if (r.statut === "annule" || annules.has(r.dossier_id) || !dossiers.has(r.dossier_id)) continue;
      const doc = reference.get(r.dossier_id);
      const e = doc ? ecartReservation(r, doc) : null;
      const champs = e && !e.retiree ? e.champs.filter((c) => NOM_CHAMP[c.cle]) : [];
      if (champs.length) ecarts.push({ id: r.id, lien: `#/dossier/${r.dossier_id}`, texte: `${dossiers.get(r.dossier_id).ref || ""} · ${r.libelle || ""}`, detail: tr("Différent sur la facture : {champs}", { champs: champs.map((c) => NOM_CHAMP[c.cle]).join(", ") }) });
    }
    ajouter("factures_differentes_reservation", "dossiers", false, ecarts);
  }
  ajouter("dossiers_sans_responsable", "dossiers", false, (db.dossiers || []).filter((d) => !d.responsable_id && !d.annule).map((d) => ({ id: d.id, lien: `#/dossier/${d.id}`, texte: d.ref || tr("(sans référence)"), detail: nomClient((db.clients || []).find((c) => c.id === d.client_id)) })));

  const droitsOk = { partenaires: !!droits.partenaires, dossiers: !!droits.dossiers, clients: !!droits.clients };
  // Dans l'ordre de CONTROLES (celui de l'écran de réglage) : les services à venir d'abord.
  return sorties.filter((s) => droitsOk[s.droit]).sort((a, b) => CONTROLES.indexOf(a.cle) - CONTROLES.indexOf(b.cle));
}
