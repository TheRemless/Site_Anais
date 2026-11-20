-- Gestion : migration 55, pièces jointes de l'agent de l'onglet « Assistant » (20.11.2026).
-- 1. agent_fichiers : les photos, captures et PDF joints à un message. Une ligne par fichier, rattachée à la conversation.
--    Conservation : supprimés avec leur conversation (90 jours sans message, ou « Supprimer »), et au plus tard 30 jours après l'envoi
--    (purger_agent_fichiers, appelée par la fonction « agent » à chaque échange). Le message ne garde que le nom du fichier : passé ce délai,
--    l'agent sait qu'il y avait un fichier et demande de le joindre à nouveau.
--    Droits : ceux de la conversation (agent_ma_conversation, migration 52) : chaque personne ne lit que ses fichiers, dans une entreprise où
--    elle a « dossiers.ecrire ». Jamais modifiés : ajoutés, lus, supprimés.
--    Taille : la fonction refuse plus de 6 fichiers et 10 Mo par message ; la base borne chaque fichier à 14 millions de caractères base64
--    (environ 10 Mo) et chaque conversation à 20 fichiers et 30 Mo (déclencheur limiter_agent_fichiers), même pour un ajout fait sans la fonction.
-- 2. agent_cartes : le genre « brochure » (importer la brochure ou la fiche d'un partenaire jointe à la conversation). Les contraintes sur
--    « genre » en place sont relues (retrouvées par leur définition, quel que soit leur nom) et tous leurs genres sont gardés (une autre
--    migration a pu en ajouter), puis elles sont remplacées par une seule, agent_cartes_genre_check, qui ajoute « brochure ».
-- Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Retour en arrière (seulement si aucune carte « brochure » n'existe) :
--   drop table if exists agent_fichiers; drop function if exists purger_agent_fichiers(integer); drop function if exists limiter_agent_fichiers();
--   puis rejouer le bloc 2 en retirant 'brochure' du tableau (array_remove(genres, 'brochure')).
-- Contrôle :
--   select count(*), pg_size_pretty(sum(taille)::bigint) from agent_fichiers;
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'agent_cartes'::regclass and contype = 'c';

begin;

create table if not exists agent_fichiers (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references agent_conversations (id) on delete cascade,
  nom text not null default '' check (length(nom) <= 120),
  media_type text not null check (media_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  taille integer not null check (taille > 0 and taille <= 14000000),
  data text not null check (length(data) = taille),
  cree_le timestamptz not null default now()
);
create index if not exists agent_fichiers_conversation on agent_fichiers (conversation_id, cree_le);

-- Limites d'une conversation, tenues par la base : 20 fichiers et 30 Mo (41 943 040 caractères base64). Les ajouts d'une même conversation
-- passent l'un après l'autre (verrou sur la conversation).
create or replace function limiter_agent_fichiers() returns trigger language plpgsql set search_path = public as $$
declare
  nombre integer;
  total bigint;
begin
  perform 1 from agent_conversations where id = new.conversation_id for update;
  select count(*), coalesce(sum(taille), 0) into nombre, total from agent_fichiers where conversation_id = new.conversation_id;
  if nombre >= 20 or total + new.taille > 41943040 then
    raise exception 'conversation_pleine' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
drop trigger if exists limiter_agent_fichiers on agent_fichiers;
create trigger limiter_agent_fichiers before insert on agent_fichiers for each row execute function limiter_agent_fichiers();

alter table agent_fichiers enable row level security;
revoke all on agent_fichiers from anon, authenticated;
grant select, insert, delete on agent_fichiers to authenticated;

drop policy if exists "lire mes fichiers" on agent_fichiers;
create policy "lire mes fichiers" on agent_fichiers for select to authenticated using (agent_ma_conversation(conversation_id));
drop policy if exists "ajouter mes fichiers" on agent_fichiers;
create policy "ajouter mes fichiers" on agent_fichiers for insert to authenticated with check (agent_ma_conversation(conversation_id));
drop policy if exists "supprimer mes fichiers" on agent_fichiers;
create policy "supprimer mes fichiers" on agent_fichiers for delete to authenticated using (agent_ma_conversation(conversation_id));

-- Supprime MES fichiers envoyés il y a plus de `jours` jours (30 par défaut, un au moins). Rend le nombre supprimé.
create or replace function purger_agent_fichiers(jours integer default 30) returns integer language sql security invoker set search_path = public as $$
  with s as (
    delete from agent_fichiers f
    using agent_conversations c
    where c.id = f.conversation_id and c.user_id = auth.uid() and f.cree_le < now() - make_interval(days => greatest(jours, 1))
    returning 1
  )
  select count(*)::integer from s;
$$;
revoke all on function purger_agent_fichiers(integer) from public, anon;
grant execute on function purger_agent_fichiers(integer) to authenticated;

do $$
declare
  c record;
  genres text[] := array[]::text[];
begin
  -- Chaque contrainte de vérification qui porte sur « genre » ; sa définition ressemble à :
  -- CHECK ((genre = ANY (ARRAY['dossier'::text, 'reservation'::text, …])))
  for c in
    select conname, pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'public.agent_cartes'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ '\mgenre\M'
  loop
    genres := genres || array(select m[1] from regexp_matches(c.def, '''([a-z_]+)''', 'g') as m);
    execute format('alter table public.agent_cartes drop constraint %I', c.conname);
  end loop;
  genres := array(
    select distinct g from unnest(genres || array['dossier', 'reservation', 'modification', 'reponse', 'temps', 'brochure']) as g order by g
  );
  execute format(
    'alter table public.agent_cartes add constraint agent_cartes_genre_check check (genre in (%s))',
    (select string_agg(quote_literal(g), ', ' order by g) from unnest(genres) as g)
  );
end
$$;

commit;
