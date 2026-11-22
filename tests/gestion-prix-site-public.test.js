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
