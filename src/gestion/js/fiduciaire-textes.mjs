// Textes de l'écran « Factures pour la fiduciaire ». L'écran complet (Anaïs, Jérémy) suit la langue de l'interface (tr).
// L'écran simple (Mook, sans le droit « gérer ») est en thaï. Les textes thaïs sont des propositions à faire relire par une personne qui lit le thaï :
// chaque ligne porte sa traduction française pour la relecture (`fr`).
import { N_ } from "./i18n.mjs";

export const TH = {
  titre: { th: "ใบแจ้งหนี้สำหรับผู้ทำบัญชี", fr: "Factures pour la fiduciaire" },
  intro: { th: "ใบแจ้งหนี้เฉพาะส่วนที่บริษัทได้รับ ไม่ใช่ยอดทั้งหมดที่ลูกค้าจ่าย", fr: "Des factures pour la seule part qui revient à l'agence, pas pour tout ce que le client a payé." },
  a_preparer: { th: "ต้องออกใบแจ้งหนี้", fr: "À préparer" },
  rien: { th: "ตอนนี้ไม่มีอะไรต้องออก", fr: "Rien à préparer pour le moment" },
  creer: { th: "ออกใบแจ้งหนี้", fr: "Créer la facture" },
  creer_tout: { th: "ออกทั้งหมด ({n})", fr: "Tout créer ({n})" },
  a: { th: "ถึง", fr: "À (destinataire)" },
  recu_le: { th: "ได้รับเงินวันที่", fr: "Reçu le" },
  adresse_manque: { th: "ยังไม่มีที่อยู่ของ {nom} กรุณาบอกอานาอิส", fr: "L'adresse de {nom} manque : prévenez Anaïs" },
  sans_prestataire: { th: "บริการนี้ไม่มีผู้ให้บริการ กรุณาบอกอานาอิส", fr: "Ce service n'a pas de prestataire : prévenez Anaïs" },
  emises: { th: "ใบแจ้งหนี้ที่ออกแล้ว", fr: "Factures émises" },
  aucune: { th: "ยังไม่มีใบแจ้งหนี้", fr: "Aucune facture pour le moment" },
  mois: { th: "เดือน", fr: "Mois" },
  tous_mois: { th: "ทุกเดือน", fr: "Tous les mois" },
  envoi: { th: "การส่ง", fr: "Envoi" },
  toutes: { th: "ทั้งหมด", fr: "Toutes" },
  non_envoyees: { th: "ยังไม่ได้ส่ง", fr: "Pas encore envoyées" },
  envoyees: { th: "ส่งแล้ว", fr: "Envoyées" },
  envoyee_le: { th: "ส่งเมื่อ {date}", fr: "Envoyée le {date}" },
  non_envoyee: { th: "ยังไม่ได้ส่ง", fr: "Pas encore envoyée" },
  choisir_non_envoyees: { th: "เลือกใบที่ยังไม่ได้ส่งทั้งหมด", fr: "Choisir toutes celles pas encore envoyées" },
  choisies: { th: "เลือกแล้ว {n} ใบ", fr: "{n} choisie(s)" },
  telecharger: { th: "ดาวน์โหลด PDF", fr: "Télécharger le PDF" },
  partager: { th: "ส่งไฟล์ PDF", fr: "Partager le PDF" },
  marquer: { th: "ทำเครื่องหมายว่าส่งให้ผู้ทำบัญชีแล้ว", fr: "Marquer envoyée à la fiduciaire" },
  date_envoi: { th: "วันที่ส่ง", fr: "Date d'envoi" },
  voir: { th: "ดู", fr: "Voir" },
  avoir: { th: "ใบลดหนี้", fr: "Avoir" },
  pdf_en_cours: { th: "กำลังเตรียมไฟล์ PDF…", fr: "Préparation du PDF…" },
  choisir_une: { th: "เลือกอย่างน้อยหนึ่งใบ", fr: "Choisissez au moins une facture." },
  cree: { th: "ออกใบแจ้งหนี้ {numero} แล้ว", fr: "Facture {numero} créée" },
  confirmer_tout: { th: "ออกใบแจ้งหนี้ {n} ใบ? เลขที่เรียงต่อกัน และใบแจ้งหนี้ที่ออกแล้วลบไม่ได้ ถ้าผิดต้องออกใบลดหนี้", fr: "Créer {n} factures ? Leurs numéros se suivent et une facture émise ne se supprime pas : une erreur se corrige par un avoir." },
  voir_plus: { th: "ดูต่อ ({n})", fr: "Voir la suite ({n})" },
  creees: { th: "ออกใบแจ้งหนี้แล้ว {n} ใบ", fr: "{n} facture(s) créée(s)" },
  marquees: { th: "ทำเครื่องหมายแล้ว {n} ใบ", fr: "{n} facture(s) marquée(s) envoyée(s)" },
  echec: { th: "ไม่สำเร็จ กรุณาบอกอานาอิส: {erreur}", fr: "Échec, prévenez Anaïs : {erreur}" },
  pas_prete: { th: "ส่วนนี้ยังไม่พร้อมใช้งาน กรุณาบอกอานาอิส", fr: "Cette fonction n'est pas encore prête : prévenez Anaïs." },
  fermer: { th: "ปิด", fr: "Fermer" },
};

// Ce qui empêche de facturer un service, pour les responsables (codes de cibleAgence). Mook ne voit jamais cette liste.
export const MANQUE = {
  commission_non_recue: N_("La commission n'est pas encore reçue"),
  date_reception: N_("La date de réception de la commission manque"),
  prix_vente: N_("Le prix de vente du service manque"),
  client_non_solde: N_("Le client n'a pas encore tout payé"),
  prestataire_non_paye: N_("Le prestataire n'est pas encore payé (net payé et date)"),
  marge_nulle: N_("La marge est nulle ou négative"),
};

// Remplace {variable} dans un texte thaï.
export const remplir = (texte, vars = {}) => texte.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
