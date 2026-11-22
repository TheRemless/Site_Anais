// Écran du partenaire chauffeur (22.11.2026, migration 115) : Mr. Brown, qui fait les courses de VIP Taxi Lanta, voit en thaï ses courses
// d'aujourd'hui, de demain et des jours suivants, et saisit sur chacune la commission qu'il doit à Nani. L'outil fait le total.
// Logique pure, sans DOM, testée dans tests/gestion-courses-partenaire.test.js. La base fait foi (partenaire_courses,
// partenaire_saisir_commission) : la démonstration rejoue ici les mêmes règles (coursesLocales, saisieLocale).

import { RETOUR_DEPART } from "./trajet-calc.mjs";

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
};

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
      };
      course.modifiable = !course.reglee && !Number(course.commission_payee || 0) && (course.commission === null || course.par_moi);
      const garde = (r.date_service >= aujourdhui && r.date_service <= limite) || (r.date_service < aujourdhui && !course.reglee && (course.commission === null || resteDu(course) > 0));
      return garde ? course : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date_service.localeCompare(b.date_service) || String(a.heure).localeCompare(String(b.heure)));
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
