// Prix de vente lus par le site secrettravelandtour.com au build (migration 117, 22.11.2026) : la fonction publique ne rend que l'identifiant
// et le prix de vente, le build hook ne vit que dans Vault, le contrôle PGlite tourne en CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("migration 117 : en-tête, transaction, fonction publique limitée à l'identifiant et au prix de vente", () => {
  const sql = source("docs/gestion/migration-117-prix-publics-site.sql");
  assert.match(sql, /^-- Gestion : migration 117/);
  for (const mot of ["But :", "Retour en arrière : docs\\/gestion\\/retour-117-prix-publics-site\\.sql", "Contrôle : docs\\/gestion\\/verif-prix-publics-site\\.mjs"]) assert.match(sql, new RegExp(mot));
  assert.match(sql, /\nbegin;\n[\s\S]*\ncommit;\n$/);
  const horsFonctions = sql.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
  assert.doesNotMatch(horsFonctions, /^\s*(update|delete from) /im, "aucune donnée existante modifiée");
  assert.match(sql, /create or replace function prix_publics_site\(p_ids uuid\[\]\) returns table \(prestation uuid, prix_vente numeric\)\nlanguage sql stable security definer set search_path = public, pg_temp/);
  assert.match(sql, /revoke all on function prix_publics_site\(uuid\[\]\) from public;\ngrant execute on function prix_publics_site\(uuid\[\]\) to anon, authenticated;/);
  const corps = sql.match(/function prix_publics_site[\s\S]*?\$\$([\s\S]*?)\$\$/)[1];
  assert.match(corps, /e\.slug in \('secret', 'taxi'\)/);
  assert.match(corps, /join prix_site_publies w on w\.prestation_id = p\.id/, "liste blanche des tarifs publiés");
  assert.match(corps, /e\.organisation_id = '00000000-0000-0000-0000-00000000a000'/, "organisation de Jérémy");
  const noter = sql.match(/function prix_site_noter[\s\S]*?\$\$([\s\S]*?)\$\$/)[1];
  assert.match(noter, /from prix_site_publies w where w\.prestation_id = /, "le déclencheur ne compte que les tarifs publiés");
  assert.match(noter, /e\.organisation_id = '00000000-0000-0000-0000-00000000a000'/);
  assert.ok(sql.indexOf("create table if not exists prix_site_publies") < sql.indexOf("create or replace function prix_publics_site"));
  assert.match(sql, /revoke all on prix_site_publies from public, anon, authenticated;/);
  assert.match(corps, /and p\.actif/);
  assert.doesNotMatch(corps, /nets|commission|partenaire|libelle|note|details|unite/i, "rien d'autre que le prix de vente");
  for (const f of ["prix_site_noter", "prix_site_relancer"]) assert.match(sql, new RegExp(`revoke all on function ${f}\\(\\) from public, anon, authenticated;`));
  assert.match(sql, /revoke all on prix_site_attente from public, anon, authenticated;/);
  assert.match(sql, /vault\.decrypted_secrets s where s\.name = 'netlify_build_hook_stt'/);
});

test("le build hook n'est écrit nulle part dans le dépôt ; retour, cron et contrôle PGlite branchés", () => {
  for (const f of ["docs/gestion/migration-117-prix-publics-site.sql", "docs/gestion/cron-prix-site.sql", "docs/gestion/retour-117-prix-publics-site.sql"]) assert.doesNotMatch(source(f), /build_hooks\/[A-Za-z0-9]{6,}/, f);
  assert.match(source("docs/gestion/cron-prix-site.sql"), /select cron\.schedule\('prix-site', '11,41 \* \* \* \*', 'select prix_site_relancer\(\)'\);/);
  const retour = source("docs/gestion/retour-117-prix-publics-site.sql");
  for (const x of ["drop function if exists prix_publics_site(uuid[]);", "drop function if exists prix_site_relancer();", "drop trigger if exists prix_site_a_revoir on prestations;", "drop table if exists prix_site_attente;", "cron.unschedule('prix-site')"]) assert.ok(retour.includes(x), x);
  assert.ok(fs.existsSync(new URL("../docs/gestion/verif-prix-publics-site.mjs", import.meta.url)));
  assert.match(source(".github/workflows/ci.yml"), /for f in [^\n]* verif-prix-publics-site; do/);
});

test("liste blanche : seuls les tarifs d'une ligne de prix affichée, sans auto: false ; la migration et prix-site-publies.sql d'accord", async () => {
  const { idsPublies, sqlPublies } = await import("../docs/gestion/prix-site-publies.mjs");
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const fichiers = {
    "src/_data/gestion-keys.json": {
      "t|Join-in|Adult": { prestation: id(1) }, "t|Join-in|Child": { prestation: id(2) }, "t|Private longtail|1 to 2 people": { prestation: id(3) },
      "t|Join-in|Per person": { prestation: id(4), auto: false }, "t|Join-in|Remise": { prestation: null, note: "x" },
      "taxi|a-b|from": { prestation: id(5) }, "taxi|c-d|Pier": { prestation: id(6) }, "taxi|krabi-day-trip|from": { prestation: id(7) }, "taxi|e-f|from": { prestation: id(8) }
    },
    "src/_data/products/tours/t.json": { slug: "t", options: [{ label: "Join-in", prices: [{ label: "Adult", amount: 1000 }, { label: "Child", amount: 600 }, { label: "Per person", amount: 900 }, { label: "Under 4", amount: 0 }] }, { label: "Private longtail", priceOnRequest: true }] },
    "src/_data/products/rental.json": { slug: "rental", options: [] },
    "src/_data/products/taxi/a-b.json": { slug: "a-b", priceFrom: { thb: 2300 } },
    "src/_data/products/taxi/southern-thailand.json": { slug: "southern-thailand", routes: [{ id: "c-d", pricePoints: [{ label: "Pier", thb: 700 }] }, { id: "e-f", priceOnRequest: true }] },
    "src/_data/krabiDayTrip.json": { slug: "krabi-day-trip", priceFrom: { thb: 3500 } }
  };
  const lecteur = { lire: (f) => fichiers[f] || null, liste: (d) => Object.keys(fichiers).filter((f) => f.startsWith(d + "/")).map((f) => f.slice(d.length + 1)) };
  assert.deepEqual(idsPublies(lecteur), [id(1), id(2), id(5), id(6), id(7)], "ni l'option privée sans prix, ni auto: false, ni une page taxi sans prix");
  const sql = sqlPublies([id(1)], "test");
  assert.match(sql, /^-- Tarifs publiés/);
  assert.match(sql, /\nbegin;\ndelete from prix_site_publies where prestation_id not in/);
  assert.match(sql, /where e\.organisation_id = '00000000-0000-0000-0000-00000000a000' and e\.slug in \('secret', 'taxi'\)/);
  const ids = (t) => [...new Set(t.match(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/g))].filter((x) => !x.includes("00000000a000")).sort();
  const enBase = ids(source("docs/gestion/migration-117-prix-publics-site.sql"));
  assert.ok(enBase.length > 100);
  assert.deepEqual(ids(source("docs/gestion/prix-site-publies.sql")), enBase);
  const prives = Object.entries(JSON.parse(source("docs/gestion/cles-options-site.json"))).filter(([k]) => /private/i.test(k)).flatMap(([, v]) => v.map((x) => `'${x.prestation}'`));
  assert.ok(prives.length > 0 && prives.every((x) => !enBase.includes(x)), "les longtails privés (sans prix sur le site) ne sont jamais publiés");
  assert.match(source("docs/gestion/regenerer-produits-site.mjs"), /ecrirePublies\(depot, ref\)/, "la régénération réécrit la liste");
});
