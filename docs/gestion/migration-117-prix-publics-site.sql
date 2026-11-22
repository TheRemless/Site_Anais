-- Gestion : migration 117 (22.11.2026), les prix de vente de Secret et de Taxi lus par le site secrettravelandtour.com au build.
-- À exécuter une seule fois, APRÈS la migration 116. Idempotente. Ne modifie aucune donnée existante (crée une table d'une ligne, vide).
-- Retour en arrière : docs/gestion/retour-117-prix-publics-site.sql
-- Contrôle : docs/gestion/verif-prix-publics-site.mjs (PGlite, en CI)
-- Tâche planifiée et secret : docs/gestion/cron-prix-site.sql (à lancer après celle-ci, une fois le build hook posé dans Vault).
--
-- But : Jérémy (22.11.2026) veut qu'un prix de vente changé dans Gestion se retrouve tout seul sur le site.
--   1. prix_publics_site(p_ids) : ouverte à la clé publique (anon). Elle rend, pour les seuls identifiants demandés par le site
--      (src/_data/gestion-keys.json), l'identifiant et le prix de vente des tarifs ACTIFS de Secret et de Taxi qui ont un prix.
--      Rien d'autre : ni net (prestations_nets n'est pas lue), ni commission, ni partenaire, ni libellé, ni note, ni unité, ni tarif de ZTP.
--      Sans identifiant, elle ne rend rien : on ne peut pas parcourir le catalogue.
--   2. Un déclencheur sur prestations note « prix du site à revoir » quand un prix de vente, l'état actif ou la liste des tarifs de Secret
--      ou de Taxi change (prix_site_attente, une seule ligne, aucun accès hors des fonctions).
--   3. prix_site_relancer(), appelée par pg_cron toutes les 30 minutes : s'il y a eu un changement, que le dernier date d'au moins
--      10 minutes (un lot de saisies part en un seul build) et que le dernier build demandé date d'au moins 55 minutes, elle appelle le
--      build hook Netlify du site (secret Vault « netlify_build_hook_stt », jamais écrit ici), puis efface la note. Au plus un build par heure.

begin;

create or replace function prix_publics_site(p_ids uuid[]) returns table (prestation uuid, prix_vente numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.prix_vente
  from prestations p
  join entites e on e.id = p.entite_id
  where e.slug in ('secret', 'taxi')
    and p.actif
    and p.prix_vente is not null and p.prix_vente > 0
    -- Au plus 1 000 identifiants par appel (le site en demande environ 120).
    and p.id = any (coalesce(p_ids[1:1000], '{}'::uuid[]))
  order by p.id
$$;
revoke all on function prix_publics_site(uuid[]) from public;
grant execute on function prix_publics_site(uuid[]) to anon, authenticated;

-- La note « prix du site à revoir » : une seule ligne (id = true), lue et écrite par les seules fonctions ci-dessous.
create table if not exists prix_site_attente (
  id boolean primary key default true check (id),
  a_publier boolean not null default false,
  premier_changement timestamptz,
  dernier_changement timestamptz,
  changements integer not null default 0,
  dernier_appel timestamptz,
  derniere_requete bigint,
  dernier_resultat text not null default ''
);
alter table prix_site_attente enable row level security;
revoke all on prix_site_attente from public, anon, authenticated;
insert into prix_site_attente (id) values (true) on conflict (id) do nothing;

create or replace function prix_site_noter() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ent uuid;
begin
  if tg_op = 'UPDATE' and new.prix_vente is not distinct from old.prix_vente and new.actif is not distinct from old.actif and new.entite_id is not distinct from old.entite_id then
    return null;
  end if;
  ent := case when tg_op = 'DELETE' then old.entite_id else new.entite_id end;
  if not exists (select 1 from entites e where e.id in (ent, case when tg_op = 'UPDATE' then old.entite_id end) and e.slug in ('secret', 'taxi')) then
    return null;
  end if;
  begin
    update prix_site_attente
       set a_publier = true,
           premier_changement = case when a_publier then premier_changement else now() end,
           dernier_changement = now(),
           changements = case when a_publier then changements + 1 else 1 end
     where id;
  exception when others then
    -- La note ne doit jamais empêcher Nani d'enregistrer un prix.
    raise warning 'prix_site_noter : %', sqlerrm;
  end;
  return null;
end
$$;
revoke all on function prix_site_noter() from public, anon, authenticated;

drop trigger if exists prix_site_a_revoir on prestations;
create trigger prix_site_a_revoir after insert or update or delete on prestations
  for each row execute function prix_site_noter();

-- Appelée par pg_cron (cron-prix-site.sql). Rend ce qu'elle a fait, en clair, pour cron.job_run_details.
create or replace function prix_site_relancer() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a prix_site_attente;
  hook text;
  req bigint;
  code integer;
begin
  select * into a from prix_site_attente where id for update;
  if not found then return 'rien à publier'; end if;
  -- Réponse de Netlify au dernier appel (pg_net répond en différé) : un refus ou une panne remet la note, le passage suivant réessaie.
  if a.derniere_requete is not null then
    select r.status_code into code from net._http_response r where r.id = a.derniere_requete;
    if found then
      if code is null or code not between 200 and 299 then
        update prix_site_attente set a_publier = true, premier_changement = coalesce(premier_changement, a.dernier_appel),
               dernier_changement = coalesce(dernier_changement, a.dernier_appel), changements = greatest(changements, 1), derniere_requete = null,
               dernier_resultat = 'Netlify a répondu ' || coalesce(code::text, 'sans code') || ' : nouvel essai au prochain passage'
         where id returning * into a;
      else
        update prix_site_attente set derniere_requete = null, dernier_resultat = 'build accepté par Netlify (' || code || ')' where id returning * into a;
      end if;
    end if;
  end if;
  if not a.a_publier then return 'rien à publier'; end if;
  if a.dernier_changement > now() - interval '10 minutes' then return 'changement en cours, attente du lot'; end if;
  if a.dernier_appel is not null and a.dernier_appel > now() - interval '55 minutes' then return 'build demandé il y a moins d''une heure, attente'; end if;
  select s.decrypted_secret into hook from vault.decrypted_secrets s where s.name = 'netlify_build_hook_stt' limit 1;
  if hook is null or hook !~ '^https://api\.netlify\.com/build_hooks/[A-Za-z0-9]+$' then
    update prix_site_attente set dernier_resultat = 'build hook absent ou mal formé dans Vault (netlify_build_hook_stt)' where id;
    return 'build hook absent';
  end if;
  select net.http_post(
    url := hook,
    body := '{}'::jsonb,
    params := jsonb_build_object('trigger_title', 'Prix Gestion (' || a.changements || ' changement' || case when a.changements > 1 then 's' else '' end || ')'),
    timeout_milliseconds := 10000
  ) into req;
  update prix_site_attente
     set a_publier = false, premier_changement = null, changements = 0, dernier_appel = now(), derniere_requete = req,
         dernier_resultat = 'build demandé (requête pg_net ' || req || ')'
   where id;
  return 'build demandé';
end
$$;
revoke all on function prix_site_relancer() from public, anon, authenticated;

commit;
