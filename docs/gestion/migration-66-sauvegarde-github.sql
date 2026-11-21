-- Gestion : migration 66, sauvegarde automatique de la base par GitHub (21.11.2026).
--
-- Chaque nuit, une GitHub Action du dépôt TheRemless/gestion-sauvegardes se connecte avec le rôle « sauvegarde_gestion », lit toute la base par les
-- trois fonctions ci-dessous, chiffre le résultat (format .gsb, docs/gestion/sauvegarde/) et le range dans ce dépôt. Elle note ensuite son résultat
-- par sauvegarde_noter(). Gestion affiche un bandeau aux administrateurs quand aucune sauvegarde n'a réussi depuis plus de 30 heures.
--
-- Le rôle n'a AUCUN droit direct sur les tables : il ne peut qu'appeler ces quatre fonctions. Il ne peut rien modifier, sauf la ligne de suivi.
-- Son mot de passe n'est pas dans ce fichier (dépôt public) : Jérémy le pose lui-même (docs/gestion/sauvegarde/github.md).
-- Rejouable sans effet. Retour en arrière en bas du fichier.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'sauvegarde_gestion') then
    create role sauvegarde_gestion login noinherit nocreatedb nocreaterole;
  end if;
end $$;
alter role sauvegarde_gestion set statement_timeout = '120s';
grant usage on schema public to sauvegarde_gestion;

-- Suivi de la dernière sauvegarde (une seule ligne).
create table if not exists sauvegarde_suivi (
  id boolean primary key default true check (id),
  dernier_essai timestamptz,
  dernier_succes timestamptz,
  dernier_echec timestamptz,
  lignes integer,
  fichier text check (fichier is null or length(fichier) <= 120),
  message text check (message is null or length(message) <= 300)
);
insert into sauvegarde_suivi (id) values (true) on conflict do nothing;
alter table sauvegarde_suivi enable row level security;
revoke all on sauvegarde_suivi from public, anon, authenticated, sauvegarde_gestion;

-- Tables sauvegardées : les mêmes que la sauvegarde du Mac (sauvegarde-lib.mjs, SQL_TABLES).
create or replace function sauvegarde_tables() returns table (table_schema text, table_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.table_schema::text, t.table_name::text from information_schema.tables t
  where t.table_type = 'BASE TABLE'
    and (t.table_schema = 'public' or (t.table_schema = 'auth' and t.table_name in ('users', 'identities')) or (t.table_schema = 'storage' and t.table_name in ('buckets', 'objects')))
  order by 1, 2
$$;

-- Toutes les lignes d'une table de la liste, en JSON. Une table hors liste est refusée.
create or replace function sauvegarde_table(p_schema text, p_table text) returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r json;
begin
  if not exists (select 1 from sauvegarde_tables() s where s.table_schema = p_schema and s.table_name = p_table) then
    raise exception 'table hors sauvegarde : %.%', p_schema, p_table using errcode = '42501';
  end if;
  execute format('select coalesce(json_agg(x), ''[]''::json) from %I.%I x', p_schema, p_table) into r;
  return r;
end
$$;

-- Le schéma, avec les mêmes requêtes que sauvegarde-lib.mjs (exporter).
create or replace function sauvegarde_schema() returns json
language sql stable security definer set search_path = public, pg_temp as $$
  select json_build_object(
    'colonnes', (select coalesce(json_agg(t), '[]'::json) from (
      select c.table_schema, c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default, c.is_identity
      from information_schema.columns c join sauvegarde_tables() s on s.table_schema = c.table_schema and s.table_name = c.table_name
      order by c.table_schema, c.table_name, c.ordinal_position) t),
    'contraintes', (select coalesce(json_agg(t), '[]'::json) from (
      select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where connamespace = 'public'::regnamespace order by 1, 2) t),
    'index', (select coalesce(json_agg(t), '[]'::json) from (
      select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2) t),
    'fonctions', (select coalesce(json_agg(t), '[]'::json) from (
      select p.proname, pg_get_functiondef(p.oid) as definition from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1) t),
    'declencheurs', (select coalesce(json_agg(t), '[]'::json) from (
      select tgrelid::regclass::text as table_name, tgname, pg_get_triggerdef(oid) as definition from pg_trigger
      where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace) order by 1, 2) t),
    'politiques', (select coalesce(json_agg(t), '[]'::json) from (
      select schemaname, tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies
      where schemaname in ('public', 'storage') order by 1, 2, 3) t)
  )
$$;

-- Résultat d'un passage, écrit par la GitHub Action (succès ou échec).
create or replace function sauvegarde_noter(p_succes boolean, p_lignes integer default null, p_fichier text default null, p_message text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update sauvegarde_suivi set
    dernier_essai = now(),
    dernier_succes = case when p_succes then now() else dernier_succes end,
    dernier_echec = case when p_succes then dernier_echec else now() end,
    lignes = case when p_succes then p_lignes else lignes end,
    fichier = case when p_succes then left(p_fichier, 120) else fichier end,
    message = left(p_message, 300)
  where id;
end
$$;

-- Lecture pour l'outil : les administrateurs seulement (mêmes personnes que le bandeau du crédit de l'assistant, migration 54).
create or replace function sauvegarde_etat() returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s sauvegarde_suivi;
begin
  if not (est_super_admin() or exists (select 1 from entites e where a_permission(e.id, 'reglages.ecrire') and a_permission(e.id, 'journal.voir'))) then
    return null;
  end if;
  select * into s from sauvegarde_suivi where id;
  return json_build_object('dernier_essai', s.dernier_essai, 'dernier_succes', s.dernier_succes, 'dernier_echec', s.dernier_echec, 'lignes', s.lignes, 'message', s.message, 'maintenant', now());
end
$$;

revoke all on function sauvegarde_tables(), sauvegarde_table(text, text), sauvegarde_schema(), sauvegarde_noter(boolean, integer, text, text), sauvegarde_etat() from public, anon, authenticated;
grant execute on function sauvegarde_tables(), sauvegarde_table(text, text), sauvegarde_schema(), sauvegarde_noter(boolean, integer, text, text) to sauvegarde_gestion;
grant execute on function sauvegarde_etat() to authenticated;

commit;

-- Retour en arrière (à exécuter à la main si besoin) :
-- begin;
-- drop function if exists sauvegarde_etat(), sauvegarde_noter(boolean, integer, text, text), sauvegarde_schema(), sauvegarde_table(text, text), sauvegarde_tables();
-- drop table if exists sauvegarde_suivi;
-- revoke usage on schema public from sauvegarde_gestion;
-- drop role if exists sauvegarde_gestion;
-- commit;
