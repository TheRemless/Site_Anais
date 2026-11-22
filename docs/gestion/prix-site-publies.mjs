// Tarifs publiés par le site secrettravelandtour.com (22.11.2026) : la liste blanche de prix_publics_site (migration 117).
// Un tarif est publié quand une ligne de prix du site (un montant affiché) le relie par src/_data/gestion-keys.json, sans « auto »: false.
// Mêmes lignes que scripts/prix-depuis-gestion.mjs du site : options des fiches tours, activities et rental.json (montant > 0), prix de chaque
// point ou prix d'appel des pages taxi, prix d'appel de krabiDayTrip.json. Une option sans prix (« Price on WhatsApp », longtails privés
// retirés le 18.11.2026, PR 51 du site) n'a pas de ligne : son tarif n'est jamais publié, même s'il figure dans cles-options-site.json.
//
//   node docs/gestion/prix-site-publies.mjs ~/Desktop/Secrettravelandtour [origin/main]
// écrit docs/gestion/prix-site-publies.sql (lecture seule du dépôt du site). Le SQL remet la table à la liste exacte ; il s'exécute dans
// l'éditeur SQL de Supabase après le oui de Jérémy, après toute PR du site qui ajoute, relie ou retire une ligne de prix.
// regenerer-produits-site.mjs le relance à chaque régénération.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ORGANISATION = "00000000-0000-0000-0000-00000000a000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// `lire(chemin)` rend le JSON d'un fichier du site (null s'il n'existe pas), `liste(dossier)` les noms des .json d'un dossier.
export function idsPublies({ lire, liste }) {
  const cles = lire("src/_data/gestion-keys.json") || {};
  const lignes = [];
  const P = "src/_data/products";
  const fiches = [...liste(`${P}/tours`).map((n) => `${P}/tours/${n}`), ...liste(`${P}/activities`).map((n) => `${P}/activities/${n}`), `${P}/rental.json`];
  for (const f of fiches) {
    const p = lire(f);
    if (!p) continue;
    for (const o of p.options || []) for (const r of o.prices || []) if (typeof r.amount === "number" && r.amount > 0) lignes.push(`${p.slug}|${o.label}|${r.label}`);
  }
  for (const n of liste(`${P}/taxi`)) {
    const p = lire(`${P}/taxi/${n}`);
    if (!p) continue;
    const pages = p.slug === "southern-thailand" ? (p.routes || []).map((r) => ({ slug: r.id, t: r })) : [{ slug: p.slug, t: p }];
    for (const { slug, t } of pages) {
      if (t.pricePoints && t.pricePoints.length) for (const x of t.pricePoints) lignes.push(`taxi|${slug}|${x.label}`);
      else if (t.priceFrom && t.priceFrom.thb) lignes.push(`taxi|${slug}|from`);
    }
  }
  const day = lire("src/_data/krabiDayTrip.json");
  if (day && day.priceFrom && day.priceFrom.thb) lignes.push(`taxi|${day.slug}|from`);
  const ids = new Set();
  for (const l of lignes) {
    const k = cles[l];
    if (k && k.prestation && k.auto !== false) {
      if (!UUID.test(k.prestation)) throw new Error(`identifiant de tarif invalide pour ${l} : ${k.prestation}`);
      ids.add(k.prestation);
    }
  }
  return [...ids].sort();
}

const liste = (ids) => ids.map((id) => `  ('${id}')`).join(",\n");

// Les lignes à insérer, pour la migration et pour le SQL de mise à jour : seuls les tarifs de Secret et de Taxi de l'organisation.
export function insertionPublies(ids) {
  return `insert into prix_site_publies (prestation_id)
select p.id from prestations p join entites e on e.id = p.entite_id
where e.organisation_id = '${ORGANISATION}' and e.slug in ('secret', 'taxi')
  and p.id in (select v.id::uuid from (values
${liste(ids)}
  ) v (id))
on conflict (prestation_id) do nothing;`;
}

export function sqlPublies(ids, source) {
  return `-- Tarifs publiés par le site secrettravelandtour.com : liste blanche de prix_publics_site (migration 117). Fichier généré par
-- docs/gestion/prix-site-publies.mjs depuis ${source}. Ne pas modifier à la main : relancer le script.
-- À exécuter (éditeur SQL de Supabase) après le oui de Jérémy, quand une PR du site ajoute, relie ou retire une ligne de prix. Aucun prix,
-- aucun net : seulement la liste des identifiants. Rejouable.
begin;
delete from prix_site_publies where prestation_id not in (select v.id::uuid from (values
${liste(ids)}
) v (id));
${insertionPublies(ids)}
select count(*) as tarifs_publies from prix_site_publies;
commit;
`;
}

// Lecture d'une branche du dépôt du site (origin/main par défaut : ce qui est en ligne).
export function lecteurGit(depot, ref = "origin/main") {
  const git = (...a) => execFileSync("git", ["-C", depot, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  return {
    lire: (f) => { try { return JSON.parse(git("show", `${ref}:${f}`)); } catch { return null; } },
    liste: (d) => git("ls-tree", "--name-only", `${ref}:${d}`).split("\n").filter((n) => n.endsWith(".json")).sort()
  };
}

export function ecrirePublies(depot, ref = "origin/main") {
  const ids = idsPublies(lecteurGit(depot, ref));
  const sortie = path.join(path.dirname(fileURLToPath(import.meta.url)), "prix-site-publies.sql");
  writeFileSync(sortie, sqlPublies(ids, `${ref} du dépôt du site`));
  return { ids, sortie };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!process.argv[2]) throw new Error("Donnez le chemin du dépôt du site (Secrettravelandtour).");
  const { ids, sortie } = ecrirePublies(path.resolve(process.argv[2]), process.argv[3] || "origin/main");
  console.log(`${ids.length} tarifs publiés → ${sortie}`);
}
