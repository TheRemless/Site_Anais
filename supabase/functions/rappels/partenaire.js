// Notifications du partenaire chauffeur (Mr. Brown, VIP Taxi Lanta, migration 123), en thaï. Logique pure : la fonction « rappels » et les tests.
// Trois notifications, sur les seules courses de partenaire_notif_courses() (la règle de son écran, partenaire_courses_de en base) :
//   1. une course nouvelle, modifiée, annulée ou qui ne lui est plus confiée (rendue par partenaire_notifs_changements(), qui regroupe une
//      rafale de changements) ;
//   2. le soir, à l'heure de la veille de l'entreprise Taxi, ses courses de demain : heure et trajet, sans nom de client ;
//   3. une heure avant chaque prise en charge, au passage « h1 » (même fenêtre que les rappels des membres).
// Aucun net, prix, commission, note ni référence n'arrive ici : la base ne les rend pas. Le nom du client n'est écrit que dans « nouvelle course »
// (il est sur son écran). Aucun mot français ou anglais dans les textes : seuls les lieux restent tels qu'ils sont saisis.
// Les dates et les personnes s'écrivent comme sur son écran (src/gestion/js/courses-partenaire-calc.mjs, que la fonction ne peut pas importer) :
// un test vérifie que les deux écritures sont identiques.
import { FENETRE_H1, debutService, servicesH1, rappelAvantActif, modeRappel } from "./calc.js";

// Textes des notifications. Le français en commentaire sert à la relecture par Nani ou Mook.
export const TH_NOTIF = {
  nouvelle: "งานใหม่", // Nouvelle course
  modifiee: "งานมีการเปลี่ยนแปลง", // Course modifiée
  annulee: "ยกเลิกงานแล้ว", // Course annulée
  retiree: "งานนี้ไม่ใช่ของคุณแล้ว", // Cette course ne vous est plus confiée
  sans_date: "งานนี้ยังไม่กำหนดวันใหม่", // La nouvelle date de cette course n'est pas encore fixée (elle sort de l'écran en attendant)
  sans_date_avant: "เดิม", // Avant : (suivi de la date et de l'heure d'origine)
  change: "เปลี่ยน:", // Changé : (suivi de ce qui a changé, séparé par des virgules)
  c_date: "วันที่", // la date
  c_heure: "เวลารับ", // l'heure de prise en charge
  c_pickup: "จุดรับ", // le lieu de prise en charge
  c_dropoff: "จุดส่ง", // la destination
  c_personnes: "จำนวนคน", // le nombre de personnes
  sans_heure: "ยังไม่มีเวลารับ", // Pas encore d'heure de prise en charge
  sans_lieu: "ยังไม่มีจุดรับ", // Pas encore de lieu de prise en charge
  retour: "ไปแล้วกลับมาจุดรับเดิม", // Aller puis retour au lieu de prise en charge (comme sur l'écran)
  client: "ลูกค้า", // Client
  adultes: "ผู้ใหญ่", // Adultes
  enfants: "เด็ก", // Enfants
  bebes: "ทารก", // Bébés
  veille_titre: "พรุ่งนี้มี {n} งาน", // Demain : {n} courses
  veille_plus: "และอีก {n} งาน", // et {n} autres courses
  h1_heure: "อีก 1 ชั่วโมง รับลูกค้า", // Dans 1 h : prise en charge du client
  h1_minutes: "อีก {m} นาที รับลูกค้า", // Dans {m} min : prise en charge du client
};

const JOURS_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
const MOIS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
// « พุธ 25 พ.ย. » (identique à dateTh de l'écran).
export function dateTh(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${JOURS_TH[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS_TH[d.getUTCMonth()]}`;
}
// « ผู้ใหญ่ 2 · เด็ก 1 » (identique à personnesTh de l'écran).
export function personnesTh(c = {}) {
  return [[c.adultes, TH_NOTIF.adultes], [c.enfants, TH_NOTIF.enfants], [c.bebes, TH_NOTIF.bebes]]
    .filter(([n]) => Number(n) > 0)
    .map(([n, l]) => `${l} ${Number(n)}`)
    .join(" · ");
}
// La destination (identique à destinationTh de l'écran) : la dépose, ou « aller-retour » avec le programme.
export function destinationTh(c = {}) {
  if (c.retour) return [TH_NOTIF.retour, String(c.programme || "").trim()].filter(Boolean).join(" · ");
  return String(c.dropoff || "").trim();
}

const texte = (v) => String(v ?? "").trim();
// « Hotel A → Krabi Airport », avec « ยังไม่มีจุดรับ » quand le lieu manque.
export function trajetTh(c = {}) {
  return [texte(c.pickup) || TH_NOTIF.sans_lieu, destinationTh(c)].filter(Boolean).join(" → ");
}
const heureTh = (c) => texte(c.heure) || TH_NOTIF.sans_heure;
const quand = (c) => [dateTh(c.date_service), heureTh(c)].filter(Boolean).join(" ");
const URL_ECRAN = "/gestion/#/";
// L'icône de VIP Taxi Lanta (copie de celle du site /taxi/, images/taxi/apple-touch-icon.png, 180 px), servie avec l'outil : il reconnaît
// d'un coup d'œil d'où vient la notification.
export const ICONE = "/gestion/assets/vip-taxi-180.png";
const avecIcone = (m) => ({ ...m, icone: ICONE });

// Ce qui a changé entre la dernière notification et maintenant : les libellés, dans l'ordre de la course.
export function changements(avant = {}, apres = {}) {
  if (!avant || typeof avant !== "object") return [];
  const diff = (k) => texte(avant[k]).toLowerCase() !== texte(apres[k]).toLowerCase();
  const out = [];
  if (diff("date_service")) out.push(TH_NOTIF.c_date);
  if (diff("heure")) out.push(TH_NOTIF.c_heure);
  if (diff("pickup")) out.push(TH_NOTIF.c_pickup);
  if (diff("dropoff") || !!avant.retour !== !!apres.retour || diff("programme")) out.push(TH_NOTIF.c_dropoff);
  if (["adultes", "enfants", "bebes"].some((k) => Number(avant[k] || 0) !== Number(apres[k] || 0))) out.push(TH_NOTIF.c_personnes);
  return out;
}

// 1. Une course nouvelle, modifiée ou annulée. `n` : une ligne de partenaire_notifs_changements() { reservation_id, genre, apercu, apercu_avant }.
export function messageChangement(n) {
  const c = (n && n.apercu) || {};
  const id = (n && n.reservation_id) || c.id || "";
  const base = [trajetTh(c), personnesTh(c)].filter(Boolean).join(" · ");
  // Même tag pour toute la vie de la course : la dernière notification remplace la précédente sur le téléphone. Le service worker la fait
  // sonner de nouveau (renotify, tags « p- ») : une annulation n'arrive jamais en silence.
  const tag = `p-course-${id}`;
  if (n.genre === "annulee") return avecIcone({ titre: `${TH_NOTIF.annulee} · ${quand(c)}`, corps: base, tag, url: URL_ECRAN });
  // Sortie de sa liste sans annulation (autre fiche, autre entreprise, supprimée) : ce qu'il avait vu, rien sur le pourquoi.
  if (n.genre === "retiree") return avecIcone({ titre: `${TH_NOTIF.retiree} · ${quand(c)}`, corps: base, tag, url: URL_ECRAN });
  // Date effacée : la course quitte son écran tant qu'elle n'a pas de nouvelle date. On rappelle celle qu'il avait vue.
  if (n.genre === "sans_date") return avecIcone({ titre: `${TH_NOTIF.sans_date} · ${TH_NOTIF.sans_date_avant} ${quand(c)}`, corps: base, tag, url: URL_ECRAN });
  if (n.genre === "modifiee") {
    const quoi = changements(n.apercu_avant, c);
    return avecIcone({ titre: `${TH_NOTIF.modifiee} · ${quand(c)}`, corps: [quoi.length ? `${TH_NOTIF.change} ${quoi.join(", ")}` : "", base].filter(Boolean).join("\n"), tag, url: URL_ECRAN });
  }
  // Nouvelle course : le nom du client y est, comme sur son écran.
  const client = texte(c.client) ? `${TH_NOTIF.client} ${texte(c.client)}` : "";
  return avecIcone({ titre: `${TH_NOTIF.nouvelle} · ${quand(c)}`, corps: [base, client].filter(Boolean).join(" · "), tag, url: URL_ECRAN });
}

// 2. Le soir : ses courses de demain, heure et trajet, sans nom de client. null s'il n'en a aucune (rien n'est envoyé).
export const VEILLE_MAX = 8;
export function messageVeillePartenaire(courses = [], demain) {
  const liste = courses.filter((c) => c.date_service === demain).sort((a, b) => texte(a.heure).localeCompare(texte(b.heure)));
  if (!liste.length) return null;
  const lignes = liste.slice(0, VEILLE_MAX).map((c) => `${heureTh(c)} ${trajetTh(c)}`);
  if (liste.length > VEILLE_MAX) lignes.push(TH_NOTIF.veille_plus.replace("{n}", String(liste.length - VEILLE_MAX)));
  return avecIcone({ titre: TH_NOTIF.veille_titre.replace("{n}", String(liste.length)), corps: lignes.join("\n"), tag: "p-veille", url: URL_ECRAN });
}

// 3. Une heure avant : ses courses dont la prise en charge tombe dans la fenêtre du passage « h1 » (40 à 60 minutes), dans le fuseau de
// l'organisation. Même lecture de l'heure que les rappels des membres (heureService) ; les frais de parc sont écartés de la même façon.
export function coursesH1(courses = [], maintenant, { fuseau, fenetre = FENETRE_H1 } = {}) {
  // Les frais de parc sont déjà écartés par la base (partenaire_notif_courses : famille « frais » et FRAIS_PARC) : la liste n'est pas refiltrée
  // ici (un partenaire fictif neutralise estFraisDeParc), la base reste la seule à décider.
  const resas = courses.map((c) => ({ id: c.id, entite_id: c.entite_id, dossier_id: null, statut: "confirme", heure_pickup: c.heure, date_service: c.date_service, libelle: c.libelle, partenaire_id: "partenaire", details: {}, course: c }));
  return servicesH1(resas, maintenant, { fenetre, fuseauDe: () => fuseau }).map((x) => ({ ...x, course: x.reservation.course }));
}
// Le rappel n'existe que si l'entreprise l'a (Réglages, « Rappel 1 h avant ») et si le compte ne l'a pas coupé (profils.rappel_h1).
export const h1Actif = (reglagesEntreprise, profil) => rappelAvantActif(reglagesEntreprise) && modeRappel(reglagesEntreprise) === "service" && !(profil && profil.rappel_h1 === false);

export function messageH1Partenaire({ course: c, minutes }) {
  const debut = minutes >= 55 && minutes <= 60 ? TH_NOTIF.h1_heure : TH_NOTIF.h1_minutes.replace("{m}", String(Math.max(0, minutes)));
  return avecIcone({ titre: `${debut} · ${heureTh(c)}`, corps: [trajetTh(c), personnesTh(c)].filter(Boolean).join(" · "), tag: `p-h1-${c.id}`, url: URL_ECRAN });
}

// Clés des envois déjà faits (partenaires_notifs_envois) : un résumé par soir, un rappel par course et par heure de début.
export const cleVeille = (demain) => `veille:${demain}`;
export const cleH1 = (c, fuseau) => {
  const d = debutService({ heure_pickup: c.heure, date_service: c.date_service }, fuseau);
  return d === null ? null : `h1:${c.id}:${new Date(d).toISOString()}`;
};

// Avant la migration 123, la fonction ne fait rien sans erreur. Seule l'absence d'un objet de la 123 (ou de partenaires_acces) compte comme
// « migration absente » : toute autre erreur, même « column … does not exist » à l'intérieur d'une fonction présente (un retour 119 rejoué),
// remonte et se voit (statut 500).
const OBJETS_123 = /partenaire_notif_courses|partenaire_notifs_changements|partenaires_notifs_envois|partenaires_acces/;
export const fonctionAbsente = (e) => !!e && ["PGRST202", "PGRST205", "42883", "42P01"].includes(e.code || "") && OBJETS_123.test(e.message || "");
