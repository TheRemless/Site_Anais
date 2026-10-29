// Convertit la base partenaires de Secret Travel & Tour (data.json du tableau de bord local) en un fichier
// d'import pour Gestion (Réglages, Sauvegarde, Restaurer ou importer, dans l'entreprise Secret).
//   node docs/gestion/import-partenaires.mjs <data.json> <entite_id> > partenaires-import.json
// Le fichier produit contient les prix nets et les coordonnées bancaires des partenaires : il ne se publie pas.
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { uniteDepuisTexte } from "../../src/gestion/js/partenaires-calc.mjs";

const MOIS = { jan: 1, janv: 1, fev: 2, fév: 2, mar: 3, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, aou: 8, aoû: 8, août: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, déc: 12 };
// « 21 avr 2026 » ou « Juin 2027 » en date ISO (dernier jour du mois quand le jour manque).
export function dateIso(texte) {
  const m = String(texte || "").trim().match(/^(?:(\d{1,2})\s+)?([a-zéû]+)\.?\s+(\d{4})$/i);
  if (!m) return null;
  const mois = MOIS[m[2].toLowerCase()];
  if (!mois) return null;
  const jour = m[1] ? Number(m[1]) : new Date(Date.UTC(Number(m[3]), mois, 0)).getUTCDate();
  return `${m[3]}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

const nombre = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const texte = (v) => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v));

export function convertir(D, entiteId, uid = randomUUID, maintenant = new Date().toISOString()) {
  const out = { version: 2, entreprise: "secret", exporte_le: maintenant, partenaires: [], partenaires_prives: [], prestations: [], prestations_nets: [], trajets: [], trajets_nets: [], taches: [] };
  const base = () => ({ id: uid(), created_at: maintenant, entite_id: entiteId });
  const parId = {};
  const parNom = (nom) => {
    const n = String(nom || "").toLowerCase();
    return out.partenaires.find((p) => p.nom.toLowerCase() === n || n.startsWith(p.nom.toLowerCase().split(" ")[0]) || p.nom.toLowerCase().startsWith(n.split(" ")[0])) || null;
  };
  const champP = (liste, p, champ = "p") => liste.filter((x) => parNom(x[champ]) && parNom(x[champ]).id === p.id);

  // ---- Partenaires ----
  let ordre = 0;
  for (const p of D.partners) {
    const row = {
      ...base(),
      nom: p.name,
      nom_thai: texte(p.thai),
      categorie: texte(p.cat),
      groupe: texte(p.grp),
      role: texte(p.role),
      contact: {
        personne: texte(p.person),
        telephones: (p.phones || []).map((t) => ({ numero: t.n, libelle: t.l || "", whatsapp: !!t.wa })),
        line: texte(p.line),
        emails: Array.isArray(p.email) ? p.email : p.email ? [p.email] : [],
        web: texte(p.web),
        adresse: texte(p.address),
        embarcadere: texte(p.pier),
        licence: texte(p.licence),
        guichets: [],
      },
      regles: { annulation: texte(p.cancel), paiement: texte(p.payment) },
      contrat: { statut: texte(p.status), etat: p.statusKind === "ok" ? "ok" : "attention", saison: texte(p.season), validite: texte(p.validity), fin: null, documents: p.docs || [], evenements: [] },
      notes: (p.notes || []).join("\n"),
      ordre: ++ordre,
      actif: true,
    };
    const fin = (p.validity || "").split(/–|-|→/).pop();
    row.contrat.fin = dateIso(fin.trim().replace(/^(\w+)\s(\d{4})$/, "$1 $2"));
    out.partenaires.push(row);
    parId[p.id] = row;
    if (p.bank || p.payment) out.partenaires_prives.push({ ...base(), partenaire_id: row.id, banque: p.bank || {}, paiement: texte(p.payment) });
    for (const t of p.todo || []) out.taches.push({ ...base(), partenaire_id: row.id, dossier_id: null, titre: t, description: `À régler avec ${p.name}.`, echeance: null, assignee_id: null, fait: false, fait_le: null, fait_par: null });
  }
  // Guichets, règles enfants, commissions, check-in et points d'embarquement sur la fiche du partenaire concerné.
  for (const o of D.offices || []) {
    const p = parNom(o.co);
    if (p) p.contact.guichets.push({ lieu: o.place, adresse: texte(o.addr), telephones: o.ph || [], line: texte(o.line), email: texte(o.email) });
  }
  for (const p of out.partenaires) {
    const enf = champP(D.children || [], p);
    if (enf.length) p.regles.enfants = enf.map((c) => [c.child, c.inf, c.other].filter(Boolean).join(". "));
    const com = champP(D.commissions || [], p);
    if (com.length) p.regles.commissions = com.map((c) => [c.rule, c.note].filter(Boolean).join(" "));
    const chk = (D.checkins || []).filter((c) => parNom(c.p.replace(/\s*\(.*\)/, "")) && parNom(c.p.replace(/\s*\(.*\)/, "")).id === p.id);
    if (chk.length) p.regles.checkin = chk.map((c) => `${c.p.includes("(") ? c.p.replace(/^.*\((.*)\)$/, "$1") + " : " : ""}${c.t} ${c.extra || ""}`.trim());
  }
  const com = (D.commissions || []).find((c) => /bateau/i.test(c.p));
  if (com) for (const p of out.partenaires) if (/bateaux/i.test(p.categorie)) (p.regles.commissions = p.regles.commissions || []).push([com.rule, com.note].filter(Boolean).join(" "));
  const bund = parNom("Bundhaya");
  const satun = parNom("Satun Pakbara");
  if (bund && D.checkpoints) bund.regles.points_embarquement = (D.checkpoints.bundhaya || []).map(([lieu, ou]) => ({ lieu, ou }));
  if (satun && D.checkpoints) satun.regles.points_embarquement = (D.checkpoints.satun || []).map(([lieu, ou]) => ({ lieu, ou }));
  if (bund && D.pickups_bundhaya) bund.regles.pickups = [{ titre: "Pickup à Lanta", colonnes: ["Lanta vers Lipe 10h30", "Lanta vers Lipe 12h30", "Phi Phi et Phuket 10h00", "Phi Phi et Phuket 13h00", "Phi Phi et Phuket 15h30", "Ao Nang 09h00", "Ao Nang 13h30"], lignes: D.pickups_bundhaya.map((z) => [`${z.zone} (${z.thai})`, ...z.t.map(heure24)]) }];
  if (satun && D.satun) {
    const col = ["Bateau 10h30", "Bateau 15h00", "Bateau 09h00", "Bateau 13h00", "Bateau 14h30"];
    satun.regles.pickups = [
      { titre: "Pickup à Lanta, zone A", colonnes: col, lignes: D.satun.pickA || [] },
      { titre: "Pickup à Lanta, zone B", colonnes: col, lignes: D.satun.pickB || [] },
      { titre: "Pickup à Phuket", colonnes: ["Bateau 08h30", "Bateau 11h00", "Bateau 12h30"], lignes: D.satun.phpick || [] },
    ];
  }
  for (const [date, libelle, genre] of D.timeline || []) {
    const cible = out.partenaires.filter((p) => new RegExp(p.nom.split(" ")[0], "i").test(libelle));
    for (const p of cible) p.contrat.evenements.push({ date, libelle, genre });
  }

  // ---- Prestations ----
  const prestation = (p, famille, groupe, libelle, prix, unite, details, net, extra = {}) => {
    const row = { ...base(), partenaire_id: p ? p.id : null, famille, groupe: texte(groupe), libelle: texte(libelle), libelle_en: "", details, prix_vente: nombre(prix), unite, sur_place: false, ordre: out.prestations.length + 1, actif: true, ...extra };
    out.prestations.push(row);
    if (net !== null && net !== undefined && net !== "") out.prestations_nets.push({ ...base(), prestation_id: row.id, net: nombre(net), net_enfant: null, note: "" });
    return row;
  };
  for (const x of D.excursions || []) {
    const p = parNom(x.partner);
    prestation(p, "excursion", titreSection(x.section), x.prog, x.sale, uniteDepuisTexte(x.pax), { formule: x.formule, bateau: x.boat, capacite: x.pax, horaires: x.time, inclus: x.incl, parc: x.park, conditions: x.cond, net_texte: x.netTxt || "" }, x.net);
  }
  for (const a of D.activities || []) {
    const p = parId[a.pid] || parNom(a.partner);
    prestation(p, "activite", a.theme, `${a.formule}${a.who ? `, ${a.who}` : ""}`, a.sale, uniteDepuisTexte(a.who), { qui: a.who, duree: a.dur, inclus: a.incl, conditions: a.cond }, a.net);
  }
  const sukho = parNom("Sukho");
  if (sukho && D.cooking) {
    (D.cooking.offers || []).forEach((o, i) => prestation(sukho, "activite", "Cours de cuisine", o.name, o.price, uniteDepuisTexte(o.who), { qui: o.who, horaires: o.hours, note: o.note, ...(i === 0 ? { intro: D.cooking.intro, menus: D.cooking.menus || [] } : {}) }, o.net));
  }
  const noom = parNom("Noom");
  for (const r of D.rentals || []) prestation(noom, "location", r.cat, r.name, r.price, "day", { moteur: r.cc, ancien_prix: r.old, commission: r.comm, lie: !!r.tie }, r.net);
  const nan = parNom("Mr. Nan");
  for (const t of D.taxis || []) prestation(nan, "transfert", "Taxis de Saladan", t.to.startsWith("ONE DAY") ? "Tour de l'île en une journée" : t.to, t.price, t.to.startsWith("ONE DAY") ? "veh" : "pp", { note: t.to.startsWith("ONE DAY") ? "Forfait pour jusqu'à 6 personnes (songthaew privatisé)." : t.note }, null);
  const vip = parNom("VIP Taxi");
  if (vip && D.vip) {
    for (const r of D.vip.routes || []) prestation(vip, r.kind === "excursion" ? "excursion" : "transfert", r.kind === "excursion" ? "Excursions en taxi" : "Private Taxi", r.route, r.sale, "veh", { montant_thai: r.thai, note: (D.vip.notes || []).join(" ") }, r.net);
    for (const r of D.vip.other || []) prestation(vip, "transfert", "Autres trajets cités", r.route, nombre(r.sale), "veh", { vente_texte: texte(r.sale), note: r.note }, r.net);
    vip.regles.commissions = [`Marge de ${D.vip.margin}% appliquée en attendant un accord (le net est le prix de vente moins ${D.vip.margin}%).`];
  }
  if (satun && D.satun) {
    for (const [a, b, v, n] of D.satun.van || []) prestation(satun, "transfert", "Minivan privé (1 à 9 personnes)", `${a} → ${b}`, v, "veh", {}, n);
    for (const [a, b, v, n] of D.satun.car || []) prestation(satun, "transfert", "Berline privée (1 à 3 personnes)", `${a} → ${b}`, v, "veh", {}, n);
    for (const [lieu, n] of D.satun.ph_to || []) prestation(satun, "transfert", "Phuket vers Rassada Pier", `${lieu} → Rassada Pier`, null, "veh", { note: "Le contrat ne donne que le tarif agence." }, n);
    for (const [lieu, n] of D.satun.ph_from || []) prestation(satun, "transfert", "Rassada Pier vers Phuket", `Rassada Pier → ${lieu}`, null, "veh", { note: "Le contrat ne donne que le tarif agence." }, n);
    for (const [a, b, h] of D.satun.join || []) prestation(satun, "transfert", "Navette partagée Hatyai", `${a} → ${b}`, 280, "pp", { horaires: h }, 250);
  }
  for (const f of D.parkFees || []) prestation(null, "frais", "Frais de parc national", f.site, f.ad, "ad", { enfant: f.ch, thai_adulte: f.tad, thai_enfant: f.tch, partenaires: f.partners, note: "À payer en espèces au garde sur l'île, jamais inclus par les prestataires." }, null, { sur_place: true });

  // ---- Trajets ----
  for (const r of D.routes || []) {
    const p = r.co === "B" ? bund : satun;
    const row = { ...base(), partenaire_id: p ? p.id : null, numero: r.no, de: r.frm, vers: r.to, mode: r.mode, depart: r.dep, arrivee: r.arr, duree: r.dur, prix_adulte: nombre(r.ad), prix_enfant: nombre(r.ch), bebe: texte(r.inf), periode: texte(r.per), fenetres: r.win || [], actif: true };
    out.trajets.push(row);
    if (nombre(r.adn) !== null || nombre(r.chn) !== null) out.trajets_nets.push({ ...base(), trajet_id: row.id, net_adulte: nombre(r.adn), net_enfant: nombre(r.chn) });
  }

  // ---- Alertes : des tâches liées au premier partenaire concerné ----
  const NIVEAU = { critique: "Critique", important: "Important", verifier: "À vérifier", info: "Info" };
  for (const a of D.alerts || []) {
    const p = parId[(a.pids || [])[0]];
    out.taches.push({ ...base(), partenaire_id: p ? p.id : null, dossier_id: null, titre: `${NIVEAU[a.level] ? `[${NIVEAU[a.level]}] ` : ""}${a.title}`, description: [a.text, a.action ? `À faire : ${a.action}` : "", a.src ? `Source : ${a.src}` : ""].filter(Boolean).join("\n\n"), echeance: null, assignee_id: null, fait: false, fait_le: null, fait_par: null });
  }
  return out;
}

function titreSection(s) {
  const t = String(s || "").replace(/^[^,]+,\s*/, "").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function heure24(s) {
  const m = String(s).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
  if (!m) return s;
  let h = Number(m[1]);
  if (m[3] === "PM" && h < 12) h += 12;
  if (m[3] === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [fichier, entiteId] = process.argv.slice(2);
  if (!fichier || !entiteId) {
    console.error("Usage : node import-partenaires.mjs <data.json> <entite_id> > partenaires-import.json");
    process.exit(1);
  }
  const D = JSON.parse(fs.readFileSync(fichier, "utf8"));
  process.stdout.write(JSON.stringify(convertir(D, entiteId), null, 1));
}
