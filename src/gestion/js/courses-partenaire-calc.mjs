// Écran du partenaire chauffeur (22.11.2026, migration 115) : Mr. Brown, qui fait les courses de VIP Taxi Lanta, voit en thaï ses courses
// d'aujourd'hui, de demain et des jours suivants, et saisit sur chacune la commission qu'il doit à Nani. L'outil fait le total.
// Logique pure, sans DOM, testée dans tests/gestion-courses-partenaire.test.js. La base fait foi (partenaire_courses,
// partenaire_saisir_commission) : la démonstration rejoue ici les mêmes règles (coursesLocales, saisieLocale).

import { RETOUR_DEPART } from "./trajet-calc.mjs";
import { separerChambreLigne } from "./operations-calc.mjs";

// La personne à qui la commission est due, nommée comme les Thaïs l'appellent (voir la mémoire « Anaïs = Nani en Thaïlande »).
export const DESTINATAIRE = "Nani";

// Textes de l'écran, en thaï simple et court. Le français en commentaire sert à la relecture par un Thaï (Nani ou Mook).
export const TH = {
  titre: "งานรับส่งลูกค้า", // Les courses (prises en charge de clients)
  total: `ค่าคอมที่ต้องจ่ายให้ ${DESTINATAIRE}`, // Commission à payer à Nani
  total_aide: "รวมทุกงานที่ยังไม่ได้จ่าย", // Total de toutes les courses pas encore payées
  aujourdhui: "วันนี้", // Aujourd'hui
  demain: "พรุ่งนี้", // Demain
  passees: "งานที่ผ่านมา ยังไม่ได้จ่ายค่าคอม", // Courses passées, commission pas encore payée
  aucune: "ยังไม่มีงาน", // Pas encore de course
  aucune_jour: "ไม่มีงาน", // Pas de course
  heure: "เวลารับ", // Heure de prise en charge
  pickup: "จุดรับ", // Lieu de prise en charge
  dropoff: "จุดส่ง", // Destination
  retour: "ไปแล้วกลับมาจุดรับเดิม", // Aller puis retour au lieu de prise en charge
  personnes: "จำนวนคน", // Nombre de personnes
  adultes: "ผู้ใหญ่", // Adultes
  enfants: "เด็ก", // Enfants
  bebes: "ทารก", // Bébés
  client: "ลูกค้า", // Client
  telephone: "โทร", // Téléphone
  vol: "เที่ยวบิน", // Vol
  prix: "ลูกค้าจ่าย", // Le client paie
  commission: `ค่าคอมให้ ${DESTINATAIRE}`, // Commission pour Nani
  enregistrer: "บันทึก", // Enregistrer
  enregistre: "บันทึกแล้ว", // Enregistré
  en_cours: "กำลังบันทึก…", // Enregistrement…
  payee: "จ่ายแล้ว", // Payée
  payee_partie: "จ่ายแล้วบางส่วน", // Payée en partie
  reste: "เหลือ", // Reste
  erreur_montant: "ใส่ตัวเลขเท่านั้น เช่น 300", // Seulement un nombre, par exemple 300
  erreur_trop: "ค่าคอมมากกว่าราคาที่ลูกค้าจ่าย", // La commission est plus élevée que le prix payé par le client
  erreur_payee: "จ่ายแล้ว แก้ไม่ได้", // Déjà payée, ne se modifie plus
  erreur_zero: "ใส่ตัวเลขมากกว่า 0", // Mettre un nombre plus grand que 0
  posee_equipe: `${DESTINATAIRE} ใส่ค่าคอมนี้แล้ว แก้ไม่ได้`, // Nani a déjà mis cette commission, elle ne se modifie pas
  erreur_reseau: "บันทึกไม่ได้ ลองใหม่อีกครั้ง", // Pas enregistré, réessayer
  chargement: "กำลังโหลด…", // Chargement…
  erreur_chargement: "โหลดไม่ได้", // Chargement impossible
  reessayer: "ลองใหม่", // Réessayer
  deconnexion: "ออกจากระบบ", // Se déconnecter
  // Détail de la course (migration 116, 22.11.2026) : tout ce qu'imprime la Booking confirmation, pour le chauffeur.
  vehicule: "รถ", // Véhicule
  cnt_vehicules: "คัน", // (unité : véhicules)
  v_taxi: "แท็กซี่", // Taxi (voiture)
  v_minivan: "รถตู้", // Minivan
  v_partage: "รถตู้รวม", // Minivan partagé
  paiement: "เงินค่ารถ", // Paiement de la course
  p_sur_place: "คนขับเก็บเงินสด {montant}", // Le chauffeur encaisse {montant} en espèces
  p_paye: "ลูกค้าจ่ายแล้ว ไม่ต้องเก็บเงิน", // Le client a déjà payé, rien à encaisser
  p_acompte: "ลูกค้าจ่ายแล้วบางส่วน คนขับเก็บ {montant}", // Le client a payé une partie, le chauffeur encaisse {montant}
  p_acompte_partage: "ลูกค้าจ่ายมัดจำแล้ว ถามยอดที่ต้องเก็บกับ Nani", // Acompte versé, demander à Nani le montant à encaisser
  p_en_attente: "ยังไม่ได้จ่าย ถาม Nani ก่อน", // Pas encore payé, demander à Nani
  hotel: "โรงแรม", // Hôtel
  chambre: "ห้อง", // Chambre
  bagages: "กระเป๋า", // Bagages
  cnt_bagages: "ใบ", // (unité : bagages)
  oui: "มี", // Oui (il y en a)
  sieges: "คาร์ซีทเด็ก", // Sièges enfant
  rendez_vous: "จุดนัดพบ", // Point de rendez-vous
  zone: "โซนรับ", // Zone de prise en charge
  duree: "ใช้เวลา", // Durée
  heures: "ชั่วโมง", // heures
  retour_date: "วันกลับ", // Date du retour
  retour_heure: "เวลากลับ", // Heure du retour
  retour_lieu: "จุดรับขากลับ", // Lieu de prise en charge du retour
  remarques: "หมายเหตุ", // Remarques (celles de la Booking confirmation)
  service: "บริการ", // Service (libellé de la course)
  ref: "เลขที่จอง", // Référence de la réservation
  ref_partenaire: "เลขอ้างอิงของคุณ", // Votre référence
};

// ---- Détail de la course (migration 116) ------------------------------------------------------------------------------------------------
// Les champs de `details` que le partenaire lit (revue de sécurité, 22.11.2026) : ceux qu'imprime la Booking confirmation de Taxi ou que saisit
// le voucher de Mook, plus la liste minimale de Jérémy pour le chauffeur (véhicule, hôtel et chambre, retour, point de rendez-vous, zone).
// Identique à partenaire_champs_details() de la migration 116 (verif-courses-partenaire-details.mjs compare les deux).
export const CHAMPS_COURSE = [
  "type_trajet", "drop_off", "programme_trajet", "duree_h", "vol", "bagages", "sieges", "type_transfert", "remarques",
  "hotel", "chambre", "retour_date", "retour_heure", "retour_lieu", "embarquement", "pickup_zone",
];
// Champs des autres vouchers (excursion, billet, location) ou à risque : aucun document de Taxi ne les imprime, ils ne sortent jamais.
export const CHAMPS_HORS_TAXI = ["remarques_paiement", "caution", "conditions", "type_tour", "bateau", "parc", "parc_texte", "programme", "heure_service", "permis", "equipement", "de", "vers", "depart", "arrivee", "checkin"];
// Ce qui reste interne et ne sort jamais (en plus des nets et des notes, qui ne sont pas dans `details`) : traces de l'outil.
export const CHAMPS_INTERNES = ["lignes_ids", "envois", "voucher_fige", "prix_origine", "commission_demandee_le", "copie_de", "note", "personnes_du_dossier", "avis_demande_le", "pickup_annonce", "modele_voucher", "taxi_independant", "annule_avec_dossier", "jours", "enfant"];
// La zone de prise en charge est gardée comme { zone, grille, depart } (pickup-calc.mjs) : seul le nom de la zone sort, jamais la grille.
export const nomZone = (v) => (v && typeof v === "object" ? (typeof v.zone === "string" ? v.zone : "") : typeof v === "string" ? v : "");
// Le formulaire de Mook (voucher-rapide-calc.mjs, CHAMPS) : la note interne ne sort pas.
export const CHAMPS_MOOK_INTERNES = ["notes"];

const TYPES_VEHICULE = { taxi: TH.v_taxi, minivan: TH.v_minivan, partage: TH.v_partage };
// Le type de véhicule : celui posé sur la course, sinon déduit du libellé de la course, puis du groupe du tarif (règle de typeTransfert,
// operations-calc.mjs, qui lit le libellé en premier pour un minivan).
export function typeVehicule(c = {}) {
  const pose = (c.details || {}).type_transfert;
  if (pose && TYPES_VEHICULE[pose]) return pose;
  const t = `${c.service || ""} ${c.libelle || ""}`;
  if (/partag|shared|navette|join/i.test(t)) return "partage";
  // Le libellé de la course dit le véhicule vendu (« Private minivan: … ») même dans un groupe de tarifs « Private Taxi ».
  if (/minivan|\bvan\b|รถตู้/i.test(c.libelle || "")) return "minivan";
  if (/taxi|berline|voiture|car\b/i.test(t)) return "taxi";
  return "minivan";
}
export const vehiculeTh = (c = {}) => `${TYPES_VEHICULE[typeVehicule(c)]} ${Math.max(1, Number(c.vehicules) || 1)} ${TH.cnt_vehicules}`;

// « 3 ใบ », « มี » pour un oui sans nombre, le texte saisi sinon ; rien quand il n'y a pas de bagages (comme bagagesBooking).
export function bagagesTh(b) {
  const t = String(b ?? "").trim();
  if (!t || /^(0|no|non|none|aucun|-|—)$/i.test(t)) return "";
  if (/^\d+$/.test(t)) return `${Number(t)} ${TH.cnt_bagages}`;
  return /^(oui|yes|y|x|true)$/i.test(t) ? TH.oui : t;
}

// Le paiement, pour le chauffeur : ce qu'il encaisse en espèces, ou rien.
export function paiementTh(c = {}, devise = "THB") {
  const m = montantTh(c.a_encaisser ?? c.prix, devise);
  if (c.paiement === "paye") return TH.p_paye;
  if (c.paiement === "acompte_partage" || (c.paiement === "acompte" && (c.a_encaisser === null || c.a_encaisser === undefined))) return TH.p_acompte_partage;
  if (c.paiement === "acompte") return TH.p_acompte.replace("{montant}", m);
  if (c.paiement === "en_attente") return TH.p_en_attente;
  return TH.p_sur_place.replace("{montant}", m);
}

// Hôtel et chambre : ceux de la course, sinon l'hôtel de la fiche du client (première ligne de son adresse, « Hotel X, Room 12 »).
export function hebergementTh(c = {}) {
  const dt = c.details || {};
  const source = "hotel" in dt ? String(dt.hotel || "") : String(c.adresse_client || "");
  const lu = separerChambreLigne(source);
  return { hotel: lu.hotel, chambre: String(dt.chambre || "").trim() || lu.chambre };
}

const heureOu = (t) => String(t ?? "").trim();

// Les lignes d'une course : l'essentiel (en gros) puis le reste, dans l'ordre de la Booking confirmation. Chaque ligne : { cle, libelle, valeur }.
// Une ligne vide ne s'affiche pas. `cle` sert aux tests (aucun champ de la Booking confirmation ne manque).
export function lignesCourse(c = {}, devise = "THB") {
  const dt = c.details || {};
  const l = (cle, libelle, valeur) => ({ cle, libelle, valeur: valeur === null || valeur === undefined ? "" : String(valeur).trim() });
  const { hotel, chambre } = hebergementTh(c);
  const pers = [personnesTh(c), Number(dt.sieges) > 0 ? `${TH.sieges} ${Number(dt.sieges)}` : ""].filter(Boolean).join(" · ");
  const duree = Number(dt.duree_h) > 0 ? `${Number(dt.duree_h)} ${TH.heures}` : String(dt.duree_h || "").trim();
  const essentiel = [
    l("pickup", TH.pickup, [c.pickup, chambre && !hotel ? `${TH.chambre} ${chambre}` : ""].filter(Boolean).join(" · ")),
    l("dropoff", TH.dropoff, destinationTh(c)),
    c.retour ? l("duree", TH.duree, duree) : null,
    l("vol", TH.vol, c.vol),
    l("personnes", TH.personnes, pers),
    l("bagages", TH.bagages, bagagesTh(dt.bagages)),
    l("vehicule", TH.vehicule, vehiculeTh(c)),
    l("paiement", TH.paiement, paiementTh(c, devise)),
    l("prix", TH.prix, montantTh(c.prix, devise)),
  ];
  const details = [
    l("hotel", TH.hotel, [hotel, chambre ? `${TH.chambre} ${chambre}` : ""].filter(Boolean).join(" · ")),
    l("rendez_vous", TH.rendez_vous, dt.embarquement),
    l("zone", TH.zone, nomZone(dt.pickup_zone)),
    l("retour_date", TH.retour_date, dt.retour_date ? dateTh(dt.retour_date) : ""),
    l("retour_heure", TH.retour_heure, heureOu(dt.retour_heure)),
    l("retour_lieu", TH.retour_lieu, dt.retour_lieu),
    c.retour ? null : l("duree", TH.duree, duree),
    l("remarques", TH.remarques, dt.remarques),
    l("service", TH.service, c.libelle),
    l("ref", TH.ref, c.ref),
    l("ref_partenaire", TH.ref_partenaire, c.reference_partenaire),
  ];
  const garder = (x) => x && x.valeur;
  return { essentiel: essentiel.filter(garder), details: details.filter(garder) };
}

const JOURS_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
const MOIS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const lireDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};
const isoDe = (d) => d.toISOString().slice(0, 10);
export const jourSuivant = (iso, n = 1) => {
  const d = lireDate(iso);
  if (!d) return "";
  d.setUTCDate(d.getUTCDate() + n);
  return isoDe(d);
};
// « พุธ 25 พ.ย. » : le jour de la semaine, le jour et le mois abrégé (sans année : la liste ne montre que des jours proches).
export function dateTh(iso) {
  const d = lireDate(iso);
  return d ? `${JOURS_TH[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS_TH[d.getUTCMonth()]}` : "";
}
// Titre d'un jour : « วันนี้ · พุธ 25 พ.ย. », « พรุ่งนี้ · … », sinon la date seule.
export function titreJour(iso, aujourdhui) {
  const date = dateTh(iso);
  if (iso === aujourdhui) return `${TH.aujourdhui} · ${date}`;
  if (iso === jourSuivant(aujourdhui)) return `${TH.demain} · ${date}`;
  return date;
}

// « 1,800 บาท » en bahts, « 1,800 EUR » sinon. Entiers sans décimales.
export function montantTh(n, devise = "THB") {
  if (n === null || n === undefined || n === "" || !Number.isFinite(Number(n))) return "";
  const v = Math.round(Number(n) * 100) / 100;
  const texte = v.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
  return `${texte} ${!devise || devise === "THB" ? "บาท" : devise}`;
}

// « ผู้ใหญ่ 2 · เด็ก 1 » : les personnes de la course, sans les zéros.
export function personnesTh(c = {}) {
  return [[c.adultes, TH.adultes], [c.enfants, TH.enfants], [c.bebes, TH.bebes]]
    .filter(([n]) => Number(n) > 0)
    .map(([n, l]) => `${l} ${Number(n)}`)
    .join(" · ");
}

// La destination à afficher : la dépose, ou « aller-retour » avec le programme pour un retour au point de départ.
export function destinationTh(c = {}) {
  if (c.retour) return [TH.retour, String(c.programme || "").trim()].filter(Boolean).join(" · ");
  return String(c.dropoff || "").trim();
}

// Le montant tapé : « 300 », « 1,200 », « 1 200 », « 250.50 ». Vide = null (effacer). Autre chose = undefined (refusé).
export function lireMontant(texte) {
  const t = String(texte ?? "").trim().replace(/[\s,'฿]/g, "").replace(/บาท$/, "");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  return Number(t);
}

// Ce qui reste dû sur une course : la commission moins ce qui est déjà reçu, jamais négatif ; rien si elle est réglée ou pas saisie.
export const resteDu = (c) => (c.reglee || c.commission === null || c.commission === undefined ? 0 : Math.max(0, Number(c.commission) - Number(c.commission_payee || 0)));
// Le total que l'écran affiche en tête : la somme de ce qui reste dû sur toutes ses courses, passées et à venir.
export const totalDu = (courses = []) => Math.round(courses.reduce((s, c) => s + resteDu(c), 0) * 100) / 100;
// Plafond de la commission (relecture de sécurité, 22.11.2026) : le prix de vente de la course, 10 000 si le prix est vide.
export const PLAFOND_SANS_PRIX = 10000;
export const plafond = (c) => (c.prix === null || c.prix === undefined || c.prix === "" ? PLAFOND_SANS_PRIX : Number(c.prix));
// Une commission payée, même en partie, ne se modifie plus ; une commission posée par Nani ou l'équipe non plus (la base refuse aussi).
export const posee_par_equipe = (c) => c.commission !== null && c.commission !== undefined && !c.par_moi;
export const verrouillee = (c) => !!c.reglee || Number(c.commission_payee || 0) !== 0 || posee_par_equipe(c) || c.modifiable === false;

// Contrôle avant l'envoi, comme la base : un nombre, pas plus que le prix payé par le client. Rend le texte d'erreur ou null.
export function erreurMontant(c, montant) {
  if (!!c.reglee || Number(c.commission_payee || 0) !== 0) return TH.erreur_payee;
  if (verrouillee(c)) return TH.posee_equipe;
  if (montant === undefined || (montant !== null && !(montant >= 0))) return TH.erreur_montant;
  if (montant === 0) return TH.erreur_zero;
  if (montant !== null && montant > plafond(c)) return TH.erreur_trop;
  return null;
}

// Les jours de la liste : d'abord aujourd'hui et la suite (aujourd'hui et demain toujours présents, même vides), puis les jours passés
// encore à payer, dans un bloc à part. Chaque course reste dans l'ordre de la base (date puis heure).
export function parJour(courses = [], aujourdhui) {
  const groupes = new Map();
  for (const c of courses) {
    if (!groupes.has(c.date_service)) groupes.set(c.date_service, []);
    groupes.get(c.date_service).push(c);
  }
  for (const d of [aujourdhui, jourSuivant(aujourdhui)]) if (!groupes.has(d)) groupes.set(d, []);
  const jours = [...groupes.keys()].sort();
  const bloc = (d) => ({ date: d, titre: titreJour(d, aujourdhui), courses: groupes.get(d) });
  return { aVenir: jours.filter((d) => d >= aujourdhui).map(bloc), passees: jours.filter((d) => d < aujourdhui).map(bloc) };
}

// ---- Démonstration : les mêmes règles que les fonctions de la base -------------------------------------------------------------------
// L'accès du compte, ou null (partenaire_acces_actuel) : compte actif, sans aucun autre accès, partenaire actif d'une entreprise en mode taxi.
export function accesLocal(data, userId) {
  const a = (data.partenaires_acces || []).find((x) => x.user_id === userId);
  if (!a) return null;
  const profil = (data.profils || []).find((p) => p.user_id === userId);
  const p = (data.partenaires || []).find((x) => x.id === a.partenaire_id);
  const e = p && (data.entites || []).find((x) => x.id === p.entite_id);
  const reglages = e && (data.reglages || {})[e.id];
  if (!profil || !profil.actif || profil.super_admin || profil.plateforme || !p || p.actif === false || !e || e.actif === false) return null;
  if (!reglages || reglages.fonctionnement !== "taxi" || (data.membres || []).some((m) => m.user_id === userId)) return null;
  return { partenaire: p, entite: e, devise: reglages.devise || "THB" };
}

// partenaire_courses : les courses de l'entreprise Taxi confiées à sa fiche ou sans partenaire (ni annulées, ni d'un dossier annulé),
// d'aujourd'hui à 60 jours, plus les courses passées tant que leur commission n'est pas payée.
export function coursesLocales(data, userId, aujourdhui) {
  const acces = accesLocal(data, userId);
  if (!acces) return [];
  const limite = jourSuivant(aujourdhui, 60);
  const nets = (id) => (data.reservations_nets || []).find((n) => n.reservation_id === id) || {};
  return (data.reservations || [])
    .filter((r) => r.entite_id === acces.entite.id && (!r.partenaire_id || r.partenaire_id === acces.partenaire.id) && r.statut !== "annule" && r.date_service)
    .map((r) => {
      const d = (data.dossiers || []).find((x) => x.id === r.dossier_id && x.entite_id === r.entite_id);
      const c = d && (data.clients || []).find((x) => x.id === d.client_id);
      if (!d || d.annule || !c) return null;
      const n = nets(r.id);
      const details = r.details || {};
      const p = r.personnes || {};
      const course = {
        id: r.id, date_service: r.date_service, heure: r.heure_pickup || "", pickup: r.lieu_pickup || "", dropoff: details.drop_off || "",
        retour: details.type_trajet === RETOUR_DEPART, programme: details.programme_trajet || "",
        adultes: Number(p.adultes) || 0, enfants: Number(p.enfants) || 0, bebes: Number(p.bebes) || 0,
        client: `${c.prenom || ""} ${c.nom || ""}`.trim(), telephone: c.telephone || "", vol: details.vol || "",
        prix: r.montant_vente ?? null, commission: n.commission_prevue ?? null, commission_payee: n.commission_recue ?? null, reglee: !!n.commission_recue_le,
        par_moi: commissionDuPartenaire(n),
        ...detailLocal(data, r, d, c, acces),
      };
      course.modifiable = !course.reglee && !Number(course.commission_payee || 0) && (course.commission === null || course.par_moi);
      const garde = (r.date_service >= aujourdhui && r.date_service <= limite) || (r.date_service < aujourdhui && !course.reglee && (course.commission === null || resteDu(course) > 0));
      return garde ? course : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date_service.localeCompare(b.date_service) || String(a.heure).localeCompare(String(b.heure)));
}

// Les colonnes de la migration 116, pour la démonstration : mêmes règles que partenaire_courses().
function detailLocal(data, r, d, c, acces) {
  const dt = r.details || {};
  const p = (data.prestations || []).find((x) => x.id === r.prestation_id) || null;
  const idsLignes = new Set([r.ligne_id, ...(dt.lignes_ids || [])].filter(Boolean));
  // Le document qui fait foi : la dernière facture, sinon le dernier devis (comme recalculer_dossier, migration 19).
  const docs = (data.documents || []).filter((x) => x.dossier_id === d.id && (x.type === "facture" || x.type === "devis"));
  const rang = (x) => `${x.type === "facture" ? 1 : 0}|${x.date_emission || ""}|${x.created_at || ""}`;
  const doc = docs.sort((a, b) => rang(b).localeCompare(rang(a)))[0] || null;
  const lignes = (((doc && doc.contenu) || {}).lignes || []).filter((l) => idsLignes.has(l.id) && (l.par || (p && p.unite) || "") === "veh");
  const vehicules = lignes.length ? lignes.reduce((s, l) => s + (l.qte === null || l.qte === undefined || l.qte === "" ? 1 : Number(l.qte)), 0) : 1;
  const recu = (data.paiements || []).filter((x) => x.dossier_id === d.id).reduce((s, x) => s + Number(x.montant || 0), 0);
  const prix = r.montant_vente ?? null;
  // Comme la base : le total du dossier (ses courses actives), la part payée sur place, et les courses réglées d'avance entre qui l'acompte se partage.
  const actives = (data.reservations || []).filter((y) => y.dossier_id === d.id && y.statut !== "annule");
  const total = actives.reduce((s, y) => s + Number(y.montant_vente || 0), 0);
  const surPlace = actives.filter((y) => y.paye_sur_place).reduce((s, y) => s + Number(y.montant_vente || 0), 0);
  const avance = actives.filter((y) => !y.paye_sur_place).length;
  const paiement = r.paye_sur_place ? "sur_place" : total > 0 && recu >= total ? "paye" : recu > 0 && avance > 1 ? "acompte_partage" : recu > 0 ? "acompte" : "en_attente";
  return {
    ref: d.ref || "", reference_partenaire: r.partenaire_id === acces.partenaire.id ? r.reference_partenaire || "" : "",
    libelle: r.libelle || "", service: (p && p.groupe) || "", vehicules,
    adresse_client: c.entite_id === r.entite_id ? String(c.adresse || "").split("\n")[0] : "",
    details: Object.fromEntries(Object.entries(dt).filter(([k]) => CHAMPS_COURSE.includes(k)).map(([k, v]) => [k, k === "pickup_zone" ? nomZone(v) || null : v]).filter(([, v]) => v !== null && v !== undefined)),
    paiement, a_encaisser: paiement === "sur_place" ? prix : paiement === "paye" ? 0 : paiement === "acompte" ? Math.max(0, total - surPlace - recu) : null,
  };
}

// partenaire_saisir_commission : refuse ce que la base refuse, sinon rend les valeurs à écrire dans reservations_nets.
export function saisieLocale(data, userId, aujourdhui, reservationId, montant) {
  const c = coursesLocales(data, userId, aujourdhui).find((x) => x.id === reservationId);
  if (!c) throw new Error("Course introuvable.");
  const erreur = erreurMontant(c, montant);
  if (erreur) throw new Error(erreur);
  return { commission_prevue: montant, commission_partenaire: montant, commission_partenaire_le: montant === null ? null : new Date().toISOString() };
}

// La commission prévue est celle du partenaire tant qu'elle égale le montant qu'il a saisi (migration 115). Sert aussi aux écrans de Nani.
export function commissionDuPartenaire(n) {
  return !!n && n.commission_prevue !== null && n.commission_prevue !== undefined && n.commission_partenaire !== null && n.commission_partenaire !== undefined && Number(n.commission_prevue) === Number(n.commission_partenaire);
}

// Relire les courses quand on revient sur l'application. Rend la fonction qui retire l'écouteur, appelée quand on quitte l'écran.
export function suivreRetour(doc, relire, { saisieEnCours = () => false } = {}) {
  const ecouteur = () => {
    if (doc.visibilityState === "visible" && !saisieEnCours()) relire();
  };
  doc.addEventListener("visibilitychange", ecouteur);
  return () => doc.removeEventListener("visibilitychange", ecouteur);
}
