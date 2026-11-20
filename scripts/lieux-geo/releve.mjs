#!/usr/bin/env node
// Relevé des lieux habituels (plages de Koh Lanta, ports, aéroports, hôpitaux, Krabi) pour l'agent de l'onglet « Assistant ».
// Nominatim et Photon refusent les serveurs de Supabase (403, 20.11.2026) : les coordonnées se relèvent depuis un poste, sur Nominatim
// (une requête par seconde, outil identifié), puis se posent en base (lieux_geo, origine « saisie », à vérifier) pour chaque entreprise.
//
//   node scripts/lieux-geo/releve.mjs > lieux.sql     relève, contrôle (dans la région, nom reconnu) et écrit le SQL ; le tableau sort sur stderr
//
// Rien d'un client : seulement des noms de lieux publics. Un lieu introuvable ou hors de la région est écarté et signalé.
import { NOMINATIM_BASE, USER_AGENT, cleZone, lireNominatim, motsLieu, parametresNominatim } from "../../supabase/functions/agent/temps.js";
import { ORGANISATIONS_OSRM } from "../../supabase/functions/agent/temps.js";

// [nom gardé, recherches Nominatim essayées dans l'ordre, autres écritures qui mènent au même point]
const LIEUX = [
  ["Saladan Pier", ["Saladan Pier", "Sala Dan Pier"], ["Saladan", "Sala Dan", "Saladan Village", "Saladan, Koh Lanta", "Lanta Pier"]],
  ["Kaw Kwang Beach", ["Kaw Kwang Beach", "Ko Kwang Beach"], ["Kaw Kwang", "Ko Kwang Beach"]],
  ["Klong Dao Beach", ["Khlong Dao Beach", "Klong Dao Beach", "Khlong Dao"], ["Klong Dao", "Khlong Dao", "Klong Dao, Koh Lanta"]],
  ["Long Beach (Phra Ae)", ["Phra Ae Beach", "Long Beach Ko Lanta"], ["Long Beach", "Phra Ae", "Phra Ae Beach", "Pra Ae", "Long Beach, Koh Lanta"]],
  ["Klong Khong Beach", ["Khlong Khong Beach"], ["Klong Khong", "Khlong Khong", "Klong Khong, Koh Lanta"]],
  ["Klong Nin Beach", ["Klong Nin beach", "Khlong Nin Beach"], ["Klong Nin", "Khlong Nin", "Klong Nin, Koh Lanta"]],
  ["Kantiang Bay", ["Kantiang Bay", "Ao Kantiang", "Kan Tiang Beach"], ["Kantiang", "Ao Kantiang", "Kantiang Bay, Koh Lanta"]],
  ["Klong Jak Beach", ["Khlong Chak Beach", "Klong Jak Beach"], ["Klong Jak", "Khlong Chak", "Klong Jak, Koh Lanta"]],
  ["Bamboo Bay (Mai Pai)", ["Bamboo Bay Ko Lanta", "Mai Phai Beach Ko Lanta", "Ao Mai Phai Ko Lanta", "Mai Phai Beach"], ["Bamboo Bay", "Mai Pai", "Mai Phai"]],
  ["Ba Kan Tiang Beach", ["Ba Kan Tiang Beach", "Bakantiang Beach"], ["Ba Kan Tiang", "Bakantiang"]],
  ["Lanta Old Town", ["Ko Lanta Old Town", "Lanta Old Town Pier", "Ban Si Raya"], ["Old Town", "Old Town, Koh Lanta", "Si Raya"]],
  ["Koh Lanta Hospital", ["Ko Lanta Hospital"], ["Lanta Hospital"]],
  ["Krabi International Airport", ["Krabi International Airport"], ["Krabi Airport", "Krabi International Airport, Krabi", "aéroport de Krabi"]],
  ["Krabi Town", ["Krabi Walking Street", "Wat Kaew Korawaram", "Chao Fa Pier", "Krabi Town Pier"], ["Krabi Town", "Krabi", "Krabi city", "Krabi Town, Krabi"]],
  ["Krabi Nakharin International Hospital", ["Krabi Nakharin International Hospital"], ["Krabi Nakharin Hospital", "Krabi Nakharin", "Krabi Nakharin International Hospital, Krabi Town"]],
  ["Krabi Hospital", ["Krabi Hospital"], ["Krabi Hospital, Krabi Town", "hôpital de Krabi"]],
  ["Ao Nang Beach", ["Ao Nang Beach", "Ao Nang Landmark"], ["Ao Nang", "Aonang", "Ao Nang, Krabi"]],
  ["Klong Muang Beach", ["Khlong Muang Beach", "Klong Muang Beach"], ["Klong Muang", "Khlong Muang"]],
  ["Tubkaek Beach", ["Tup Kaek Beach", "Tubkaek Beach"], ["Tubkaek", "Tub Kaek", "Tup Kaek"]],
  ["Noppharat Thara Pier", ["Nopparat Thara Pier", "Noppharat Thara Pier"], ["Nopparat Thara Pier", "Ao Nang Pier"]],
  ["Khlong Chilat Pier", ["Khlong Chilat Pier", "Klong Jilad Pier"], ["Klong Jilad Pier", "Klong Jilad", "Khlong Jilad Pier"]],
  ["Krabi Bus Terminal", ["Krabi Bus Terminal"], ["Krabi bus station"]],
  ["Phuket International Airport", ["Phuket International Airport"], ["Phuket Airport", "aéroport de Phuket"]],
  ["Trang Airport", ["Trang Airport"], ["Trang International Airport", "aéroport de Trang"]],
];
// Une commune, un district ou une province n'est pas un point de prise en charge : son centre peut être à des kilomètres.
const ZONES_ADMIN = new Set(["province", "state", "county", "district", "municipality", "city", "town", "subdistrict", "suburb", "quarter", "village", "hamlet", "administrative"]);
const REGION = { latMin: 6.5, latMax: 8.5, lonMin: 98.1, lonMax: 99.9 };
// Koh Lanta Yai : un lieu de l'île (avant « Krabi International Airport » dans la liste) doit tomber dans ce cadre.
const LANTA = { latMin: 7.42, latMax: 7.70, lonMin: 98.98, lonMax: 99.13 };
const DE_LANTA = new Set(LIEUX.slice(0, LIEUX.findIndex(([n]) => n === "Krabi International Airport")).map(([n]) => n));
const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function relever() {
  const trouves = [];
  for (const [nom, recherches, autres] of LIEUX) {
    let vu = null;
    for (const q of recherches) {
      await attendre(1100);
      const rep = await fetch(`${NOMINATIM_BASE}/search?${parametresNominatim(q)}&accept-language=en`, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
      const brut = rep.ok ? await rep.json() : null;
      const r = Array.isArray(brut) ? brut[0] : null;
      const g = lireNominatim(brut);
      const cadre = DE_LANTA.has(nom) ? LANTA : REGION;
      const dans = g && g.lat >= cadre.latMin && g.lat <= cadre.latMax && g.lon >= cadre.lonMin && g.lon <= cadre.lonMax;
      const nomReconnu = g && motsLieu(q).some((w) => w.length >= 4 && motsLieu(g.label).includes(w));
      const admin = r && (r.category === "boundary" || ZONES_ADMIN.has(r.addresstype));
      vu = { q, g, r, ok: !!(dans && nomReconnu && !admin) };
      if (vu.ok) break;
    }
    const { q, g, r, ok } = vu;
    console.error(`${ok ? "ok " : "NON"} ${nom.padEnd(38)} ${g ? `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}  [${r.category}/${r.type}/${r.addresstype}] ${g.label.slice(0, 80)}` : "introuvable"}`);
    if (ok) trouves.push({ nom, g, cles: [...new Set([nom, ...recherches, ...autres].map(cleZone).filter(Boolean))] });
  }
  return trouves;
}

const trouves = await relever();
const lignes = [];
for (const t of trouves) for (const cle of t.cles) lignes.push(`(${sql(cle)}, ${sql(t.nom)}, ${t.g.lon}, ${t.g.lat}, ${sql(`${t.g.label.slice(0, 160)} (relevé OpenStreetMap)`)})`);
console.log(`-- Lieux habituels relevés sur Nominatim le ${new Date().toISOString().slice(0, 10)} (scripts/lieux-geo/releve.mjs) : ${trouves.length} lieux, ${lignes.length} écritures.
-- Pour chaque entreprise de l'organisation de Koh Lanta. Une clé déjà posée à la main (saisie) n'est pas écrasée.
insert into lieux_geo (entite_id, cle, nom, lon, lat, label, origine, a_verifier)
select e.id, v.cle, v.nom, v.lon, v.lat, v.label, 'saisie', true
from entites e cross join (values
${lignes.join(",\n")}
) as v(cle, nom, lon, lat, label)
where e.organisation_id = ${sql(ORGANISATIONS_OSRM[0])}
on conflict (entite_id, cle) do update set nom = excluded.nom, lon = excluded.lon, lat = excluded.lat, label = excluded.label, origine = 'saisie', a_verifier = true
where lieux_geo.origine <> 'saisie';`);
