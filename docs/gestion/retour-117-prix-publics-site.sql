-- Retour en arrière de la migration 117 : le site ne lit plus les prix de Gestion (son build garde alors les prix de ses fichiers, sans échouer)
-- et plus aucun build n'est demandé. Le secret Vault « netlify_build_hook_stt » n'est pas touché : le supprimer à part si besoin (voir
-- cron-prix-site.sql). Aucune donnée de Gestion n'est touchée.
begin;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') and exists (select 1 from cron.job where jobname = 'prix-site') then
    perform cron.unschedule('prix-site');
  end if;
end $$;
drop trigger if exists prix_site_a_revoir on prestations;
drop function if exists prix_site_relancer();
drop function if exists prix_site_noter();
drop function if exists prix_publics_site(uuid[]);
drop table if exists prix_site_attente;
drop table if exists prix_site_publies;
commit;
