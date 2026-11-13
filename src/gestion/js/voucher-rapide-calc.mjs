// Écran « Nouveau voucher » de VIP Taxi Lanta (12.11.2026) : la logique pure, sans DOM, testée dans tests/gestion-voucher-rapide.test.js.
// L'assistante d'Anaïs (Mook) parle thaï : l'écran est en thaï, le voucher reste en anglais. Elle saisit la course telle qu'elle l'a
// convenue (prise en charge et dépose presque toujours à l'hôtel, donc hors catalogue) et envoie l'image à Anaïs, qui la transmet au client.

// Droit d'interface : la personne qui l'a ne voit, dans une entreprise en mode taxi, que cet écran. Il n'est jamais dans « tous les droits ».
export const DROIT_VOUCHER_SEUL = "vouchers.seul";

// Textes de l'écran, en thaï simple. Le français en commentaire sert à la relecture par Anaïs et Mook.
export const TH = {
  titre: "วอยเชอร์ใหม่", // Nouveau voucher
  titre_modif: "แก้ไขวอยเชอร์", // Modifier le voucher
  nom: "ชื่อลูกค้า", // Nom du client
  date: "วันที่", // Date
  pickup: "จุดรับ", // Lieu de prise en charge
  heure: "เวลารับ", // Heure de prise en charge
  dropoff: "จุดส่ง", // Lieu de dépose
  vol: "เลขเที่ยวบินหรือเรือ", // Numéro de vol ou de bateau
  vol_aide: "ถ้ารับหรือส่งที่สนามบินหรือท่าเรือ เช่น FD3217 ถ้าไม่มี เว้นว่าง", // Si prise en charge ou dépose à l'aéroport ou au port, par exemple FD3217. Sinon, laisser vide
  adultes: "ผู้ใหญ่", // Adultes
  enfants: "เด็ก", // Enfants
  bagages: "กระเป๋า", // Bagages
  bagages_aide: "ตัวเลข เช่น 3", // Un nombre, par exemple 3
  sieges: "คาร์ซีทเด็ก", // Sièges enfant ou bébé
  sieges_aide: "จำนวนคาร์ซีทเด็กหรือเด็กเล็ก ถ้าไม่ต้องการ เว้นว่าง", // Nombre de sièges enfant ou bébé. Laisser vide si aucun
  prix: "ราคารวม (บาท)", // Prix total (bahts)
  prix_aide: "ลูกค้าจ่ายเงินสดให้คนขับ", // Le client paie en espèces au chauffeur
  anglais_aide: "พิมพ์เป็นภาษาอังกฤษ", // Écrire en anglais
  apercu: "ดูตัวอย่าง", // Voir l'aperçu
  modifier: "แก้ไข", // Modifier
  creer: "สร้างและส่งให้ Anaïs", // Créer et envoyer à Anaïs
  enregistrer: "บันทึกและส่งให้ Anaïs", // Enregistrer et envoyer à Anaïs
  envoyer: "ส่งรูปให้ Anaïs", // Envoyer l'image à Anaïs
  enregistrer_image: "บันทึกรูป", // Enregistrer l'image
  ouvrir_chat: "เปิดแชท Anaïs", // Ouvrir la conversation d'Anaïs
  nouveau: "สร้างใบใหม่", // Faire un nouveau voucher
  annuler: "ยกเลิก", // Annuler
  retour: "กลับ", // Retour
  derniers: "วอยเชอร์ล่าสุด", // Derniers vouchers
  aucun: "ยังไม่มีวอยเชอร์", // Pas encore de voucher
  renvoyer: "ส่งอีกครั้ง", // Renvoyer
  annule: "ยกเลิกแล้ว", // Annulé
  creation: "กำลังสร้าง…", // Création…
  preparation: "กำลังทำรูป…", // Préparation de l'image…
  cree: "สร้างวอยเชอร์แล้ว", // Voucher créé
  modifie: "บันทึกแล้ว", // Enregistré
  choisir_anais: "ใน WhatsApp เลือก Anaïs แล้วกดส่ง", // Dans WhatsApp, choisir Anaïs puis envoyer
  partage_impossible: "โทรศัพท์นี้ส่งรูปตรงๆ ไม่ได้ กดบันทึกรูป แล้วส่งใน WhatsApp", // Ce téléphone ne peut pas envoyer l'image directement : enregistrer l'image puis l'envoyer dans WhatsApp
  partage_echec: "ส่งรูปไม่สำเร็จ กดบันทึกรูป แล้วส่งใน WhatsApp", // L'envoi de l'image a échoué : enregistrer l'image puis l'envoyer dans WhatsApp
  image_copiee: "คัดลอกรูปแล้ว วางในแชท Anaïs", // Image copiée, la coller dans la conversation d'Anaïs
  echec: "ไม่สำเร็จ ลองอีกครั้ง", // Échec, réessayer
  image_echec: "ทำรูปไม่สำเร็จ", // L'image n'a pas pu être faite
  reessayer: "ลองทำรูปอีกครั้ง", // Refaire l'image
  deconnexion: "ออกจากระบบ", // Se déconnecter
  // Erreurs, sous le champ concerné
  e_vide: "กรุณากรอกช่องนี้", // Remplir ce champ
  e_thai: "กรุณาพิมพ์เป็นภาษาอังกฤษ ลูกค้าอ่านภาษาไทยไม่ได้", // Écrire en anglais : le client ne lit pas le thaï
  e_date: "กรุณาเลือกวันที่", // Choisir la date
  e_heure: "กรุณาเลือกเวลา", // Choisir l'heure
  e_adultes: "อย่างน้อย 1 คน", // Au moins 1 personne
  e_nombre: "กรุณากรอกเป็นตัวเลข", // Écrire un nombre
  e_prix: "กรุณากรอกราคาเป็นตัวเลข", // Écrire le prix en chiffres
  e_sieges: "คาร์ซีทมากกว่าจำนวนเด็ก", // Plus de sièges que d'enfants
};

// Le voucher est en anglais : un mot en écriture thaïe y serait illisible pour le client.
export const contientThai = (s) => /[฀-๿]/.test(String(s || ""));

// « 2,700 », « 2'700 », « 2 700 » ou « 2700.50 » : le prix tapé, ou null s'il ne se lit pas comme un nombre positif.
export function prixSaisi(texte) {
  const t = String(texte ?? "").trim().replace(/[\s'’]/g, "").replace(/บาท|thb|฿/gi, "");
  if (!t) return null;
  // Une virgule suivie de trois chiffres sépare les milliers ; sinon c'est une virgule décimale.
  const n = Number(/,\d{3}(\D|$)/.test(t) ? t.replace(/,/g, "") : t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const entier = (v) => {
  const t = String(v ?? "").trim();
  if (t === "") return 0;
  return /^\d+$/.test(t) ? Number(t) : NaN;
};

// Valeurs vides d'un nouveau voucher. Deux adultes par défaut : la plupart des courses (prix pour 1 à 2 personnes dans le catalogue).
// Le numéro de vol ou de bateau et les sièges enfant ou bébé (13.11.2026) : ce que le formulaire taxi du site demande au client.
export const valeursVides = () => ({ nom: "", date: "", pickup: "", heure: "", dropoff: "", vol: "", adultes: "2", enfants: "", bagages: "", sieges: "", prix: "" });

// Dans l'ordre de l'écran : la première erreur reçoit le focus.
export const CHAMPS = ["nom", "date", "pickup", "heure", "dropoff", "vol", "adultes", "enfants", "bagages", "sieges", "prix"];

// Contrôle avant l'aperçu : { champ: code d'erreur } (codes de TH, « e_… »). Vide = tout est bon.
export function erreursVoucher(v) {
  const e = {};
  for (const c of ["nom", "pickup", "dropoff"]) {
    const t = String(v[c] || "").trim();
    if (!t) e[c] = "e_vide";
    else if (contientThai(t)) e[c] = "e_thai";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.date || ""))) e.date = "e_date";
  if (!/^\d{1,2}:\d{2}$/.test(String(v.heure || ""))) e.heure = "e_heure";
  const a = entier(v.adultes);
  if (Number.isNaN(a)) e.adultes = "e_nombre";
  else if (a < 1) e.adultes = "e_adultes";
  const enf = entier(v.enfants);
  if (Number.isNaN(enf)) e.enfants = "e_nombre";
  if (contientThai(v.bagages)) e.bagages = "e_thai";
  if (contientThai(v.vol)) e.vol = "e_thai";
  const s = entier(v.sieges);
  if (Number.isNaN(s)) e.sieges = "e_nombre";
  else if (s > 0 && !Number.isNaN(enf) && s > enf) e.sieges = "e_sieges";
  if (prixSaisi(v.prix) === null) e.prix = "e_prix";
  return e;
}

// Ce que la course devient en base. Le nom va tout entier dans « nom » (le voucher affiche prénom et nom bout à bout).
export function donneesVoucher(v) {
  const pickup = String(v.pickup).trim();
  const dropoff = String(v.dropoff).trim();
  return {
    nom: String(v.nom).trim().replace(/\s+/g, " "),
    date: v.date,
    heure: v.heure,
    pickup,
    dropoff,
    libelle: `${pickup} → ${dropoff}`,
    personnes: { adultes: entier(v.adultes) || 0, enfants: entier(v.enfants) || 0, bebes: 0 },
    bagages: String(v.bagages || "").trim(),
    vol: String(v.vol || "").trim().replace(/\s+/g, " "),
    sieges: entier(v.sieges) || 0,
    prix: prixSaisi(v.prix),
  };
}

// Le partenaire d'une course : celui de l'entreprise dont le nom dit « taxi », sinon le premier actif (VIP Taxi Lanta n'en a qu'un).
export function partenaireDeTaxi(partenaires = []) {
  const actifs = partenaires.filter((p) => p.actif !== false);
  return actifs.find((p) => /taxi/i.test(p.nom || "")) || actifs[0] || null;
}

// La ligne du prix interne de la course (jamais montré) : prix pour le véhicule, payé au chauffeur, sans prestation du catalogue.
export const ligneVoucher = (x, { id, partenaireId = null }) => ({ id, kind: "ligne", libre: true, par: "veh", libelle: x.libelle, titre: x.libelle, intro: "", puces: [], unite: x.prix, qte: 1, montant: null, pct: null, date_service: x.date, partenaire_id: partenaireId, paye_sur_place: true });

// Ce qui se pose sur la réservation créée (mêmes champs que « Coller une demande » : heure, lieu, dépose, vol, bagages, sièges, personnes).
export const reservationVoucher = (x) => ({ heure: x.heure, lieu: x.pickup, dropoff: x.dropoff, vol: x.vol, bagages: x.bagages, sieges: x.sieges, personnes: { adultes: x.personnes.adultes, enfants: x.personnes.enfants } });

// Les champs facultatifs de la course dans `details` : posés s'ils sont remplis, retirés s'ils sont vidés.
function detailsFacultatifs(details, x) {
  for (const [cle, val] of [["bagages", x.bagages], ["vol", x.vol], ["sieges", x.sieges]]) {
    if (val) details[cle] = val;
    else delete details[cle];
  }
  return details;
}

// Réservation telle que le voucher la lit, pour l'aperçu avant création (rien n'est encore en base).
export const reservationApercu = (x) => ({ id: "apercu", libelle: x.libelle, date_service: x.date, heure_pickup: x.heure, lieu_pickup: x.pickup, personnes: x.personnes, montant_vente: x.prix, paye_sur_place: true, statut: "a_demander", details: detailsFacultatifs({ drop_off: x.dropoff }, x) });

// Correction d'un voucher déjà créé : les champs de la réservation qui changent (null si rien ne change).
export function correctionReservation(r, x) {
  const details = detailsFacultatifs({ ...(r.details || {}), drop_off: x.dropoff }, x);
  const suite = { libelle: x.libelle, date_service: x.date, heure_pickup: x.heure, lieu_pickup: x.pickup, montant_vente: x.prix, personnes: { ...(r.personnes || {}), adultes: x.personnes.adultes, enfants: x.personnes.enfants }, details };
  const pareil = Object.keys(suite).every((k) => JSON.stringify(r[k] ?? null) === JSON.stringify(suite[k] ?? null));
  return pareil ? null : suite;
}

// Valeurs du formulaire d'après un voucher déjà créé, pour le corriger.
export function valeursDepuis(r, client = {}) {
  const p = r.personnes || {};
  return {
    nom: [client.prenom, client.nom].filter(Boolean).join(" "),
    date: r.date_service || "",
    pickup: r.lieu_pickup || "",
    heure: /^\d{1,2}:\d{2}$/.test(r.heure_pickup || "") ? r.heure_pickup.padStart(5, "0") : "",
    dropoff: (r.details && r.details.drop_off) || "",
    vol: (r.details && r.details.vol) || "",
    adultes: String(p.adultes || 0),
    enfants: p.enfants ? String(p.enfants) : "",
    bagages: (r.details && r.details.bagages) || "",
    sieges: r.details && Number(r.details.sieges) > 0 ? String(r.details.sieges) : "",
    prix: r.montant_vente === null || r.montant_vente === undefined ? "" : String(r.montant_vente),
  };
}

// Lieux proposés en suggestion (jamais imposés) : ceux déjà saisis sur les courses, puis les destinations du catalogue de Taxi
// (« Krabi Airport », « Koh Lanta to Khao Lak » donne « Koh Lanta » et « Khao Lak »). Les excursions à la journée n'en sont pas.
export function suggestionsLieux(prestations = [], reservations = []) {
  const vus = new Map();
  const ajoute = (s) => {
    const t = String(s || "").trim();
    if (!t || contientThai(t) || t.length > 60) return;
    const cle = t.toLowerCase();
    if (!vus.has(cle)) vus.set(cle, t);
  };
  const recentes = [...reservations].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  for (const r of recentes) {
    ajoute(r.lieu_pickup);
    ajoute(r.details && r.details.drop_off);
  }
  for (const p of prestations) {
    if (p.actif === false) continue;
    const l = String(p.libelle_en || p.libelle || "");
    if (/full-day|day trip|visa run|journée/i.test(l)) continue;
    for (const morceau of l.split(/\s+to\s+|\s*→\s*/i)) ajoute(morceau);
  }
  return [...vus.values()];
}

// Derniers vouchers de la personne : les courses des dossiers qu'elle a créés, les plus récentes d'abord.
export function mesVouchers({ reservations = [], dossiers = [], clients = [], moi, limite = 15 }) {
  const siens = new Map(dossiers.filter((d) => d.cree_par === moi).map((d) => [d.id, d]));
  return reservations
    .filter((r) => siens.has(r.dossier_id))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .slice(0, limite)
    .map((r) => {
      const d = siens.get(r.dossier_id);
      return { reservation: r, dossier: d, client: clients.find((c) => c.id === d.client_id) || {}, annule: r.statut === "annule" || !!d.annule };
    });
}

const MOIS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
// « 14 พ.ย. » : le jour et le mois abrégé en thaï, sans année (la liste ne montre que des courses proches).
export function dateCourteTh(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[3])} ${MOIS_TH[Number(m[2]) - 1]}` : "";
}
