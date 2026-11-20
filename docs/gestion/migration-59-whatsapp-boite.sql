-- Gestion : migration 59, boîte WhatsApp dans Gestion (phase 2, 20.11.2026). Suit la migration 58 (réception).
--   1. whatsapp_propositions : la réponse préparée par l'agent quand un client écrit. Nani la copie, l'ajuste et l'envoie depuis l'app
--      WhatsApp ; dès que sa réponse revient (message.echo), la proposition passe « traitee ». Elle peut aussi l'envoyer depuis Gestion
--      (fonction « whatsapp-envoi ») ou l'ignorer. Un nouveau message du client remplace la proposition encore à faire.
--      Le tri de l'agent ne range jamais une conversation : il note l'entreprise suggérée (entreprise_proposee) et prépare la réponse
--      avec les données de celle-ci. Cette proposition ne se lit que par les administrateurs de cette entreprise.
--   2. Classement et rattachement : un administrateur de Secret ou de Taxi range une conversation dans l'une des deux entreprises (un tap),
--      la relie à un client ou un dossier de cette entreprise et la marque lue. Rien d'autre ne change depuis l'outil.
--      Changer d'entreprise retire le client et le dossier d'une autre entreprise, puis cherche le client par le numéro dans la nouvelle.
--   3. Journal de l'assistant : l'usage « whatsapp » (coût des propositions, compté dans le plafond du mois).
--
-- Ce qui part chez Anthropic pour une proposition : les derniers messages de la conversation (texte seulement, numéros masqués), le prénom du client, le
-- dossier relié (services, dates, heures, prix de vente) et ce que rendent les outils de lecture de l'agent (catalogue, horaires, durées).
-- Jamais un net, une commission, une marge, un nom de prestataire ni une coordonnée bancaire. Les données ne servent pas à entraîner un modèle
-- (API Anthropic, conditions commerciales).
--
-- Conservation : une proposition part avec sa conversation (365 jours, migration 58) et au plus tard 90 jours après sa création.
-- À exécuter une seule fois, AVANT de déployer la nouvelle fonction « whatsapp » et « whatsapp-envoi ». Ne modifie aucune donnée existante.
-- Se rejoue sans effet.
-- Retour en arrière :
--   drop table if exists whatsapp_propositions; drop trigger if exists whatsapp_reclasser on whatsapp_conversations;
--   drop function if exists whatsapp_reclasser(); revoke update on whatsapp_conversations from authenticated;
--   puis rejouer la contrainte du journal sans 'whatsapp'.
-- Contrôle :
--   select statut, count(*) from whatsapp_propositions group by 1;

begin;

-- 1. Propositions.
create table if not exists whatsapp_propositions (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  conversation_id uuid not null references whatsapp_conversations (id) on delete cascade,
  -- Le dernier message du client pris en compte.
  message_id uuid references whatsapp_messages (id) on delete set null,
  entite_id uuid references entites (id) on delete set null,
  -- envoi : réservée par « whatsapp-envoi » le temps de l'envoi (un double tap n'envoie pas deux fois).
  statut text not null default 'a_faire' check (statut in ('en_cours', 'a_faire', 'envoi', 'traitee', 'remplacee', 'ignoree', 'echec')),
  texte text check (length(texte) <= 4000),
  langue text check (langue is null or langue ~ '^[a-z]{2}$'),
  -- Contrôles de l'agent (montant ou heure sans source, mot interne, signature retirée) : la carte les montre, Nani décide.
  avertissements text[] not null default '{}' check (cardinality(avertissements) <= 20),
  -- Entreprise proposée par l'agent pour une conversation à trier.
  entreprise_proposee text check (entreprise_proposee in ('secret', 'taxi')),
  erreur text check (length(erreur) <= 200),
  traitee_le timestamptz,
  traitee_par uuid,
  -- Comment elle a été traitée : réponse de Nani depuis l'app (écho), envoi depuis Gestion, ou à la main dans l'outil.
  traitee_par_quoi text check (traitee_par_quoi in ('app', 'gestion', 'outil'))
);
create index if not exists whatsapp_propositions_conversation on whatsapp_propositions (conversation_id, cree_le desc);
create index if not exists whatsapp_propositions_a_faire on whatsapp_propositions (conversation_id) where statut = 'a_faire';

alter table whatsapp_propositions enable row level security;
revoke all on whatsapp_propositions from anon, authenticated;
grant select on whatsapp_propositions to authenticated;
grant update (statut) on whatsapp_propositions to authenticated;
drop policy if exists "lire les propositions WhatsApp" on whatsapp_propositions;
create policy "lire les propositions WhatsApp" on whatsapp_propositions for select to authenticated
  using (exists (select 1 from whatsapp_conversations c where c.id = conversation_id and whatsapp_lit(c.entite_id, c.organisation_id))
    -- Une proposition préparée avec les données d'une entreprise ne se lit que par ses administrateurs (chaque entreprise ses éléments).
    and (entite_id is null or whatsapp_admin(entite_id)));
-- Depuis l'outil : seulement « traitee » (copiée et envoyée à la main) ou « ignoree », et seulement une proposition encore à faire ou
-- restée « envoi » après un délai dépassé (Nani a vérifié dans WhatsApp).
drop policy if exists "traiter une proposition WhatsApp" on whatsapp_propositions;
create policy "traiter une proposition WhatsApp" on whatsapp_propositions for update to authenticated
  using (statut in ('a_faire', 'envoi') and (entite_id is null or whatsapp_admin(entite_id))
    and exists (select 1 from whatsapp_conversations c where c.id = conversation_id and whatsapp_lit(c.entite_id, c.organisation_id)))
  with check (statut in ('traitee', 'ignoree'));

create or replace function whatsapp_proposition_traitee() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut is distinct from old.statut and new.statut in ('traitee', 'ignoree') then
    new.traitee_le := coalesce(new.traitee_le, now());
    new.traitee_par := coalesce(new.traitee_par, auth.uid());
    if auth.uid() is not null and new.traitee_par_quoi is null then
      new.traitee_par_quoi := 'outil';
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists traitee on whatsapp_propositions;
create trigger traitee before update on whatsapp_propositions for each row execute function whatsapp_proposition_traitee();

-- 2. Classement, rattachement, lu. Les colonnes ouvertes à l'outil ; le reste (numéro, dates, organisation) ne bouge pas.
grant update (entite_id, entite_source, client_id, dossier_id, non_lus) on whatsapp_conversations to authenticated;
drop policy if exists "ranger une conversation WhatsApp" on whatsapp_conversations;
create policy "ranger une conversation WhatsApp" on whatsapp_conversations for update to authenticated
  using (whatsapp_lit(entite_id, organisation_id))
  with check (
    (entite_id is null and whatsapp_lit(null, organisation_id)) or (entite_id is not null and whatsapp_admin(entite_id) and organisation_de(entite_id) = organisation_id)
  );

-- Le client et le dossier restent dans l'entreprise de la conversation : sinon retirés ; à un changement d'entreprise, le client est
-- cherché par le numéro dans la nouvelle. Le compteur des non-lus ne remonte jamais depuis l'outil.
create or replace function whatsapp_reclasser() returns trigger language plpgsql security definer set search_path = public as $$
declare
  trouve record;
begin
  if auth.uid() is not null then
    if new.non_lus > old.non_lus then new.non_lus := old.non_lus; end if;
    if new.entite_id is distinct from old.entite_id then new.entite_source := 'manuel'; end if;
    if new.entite_source not in ('manuel') and new.entite_source is distinct from old.entite_source then new.entite_source := old.entite_source; end if;
  end if;
  if new.client_id is not null and (new.entite_id is null or not exists (select 1 from clients where id = new.client_id and entite_id = new.entite_id)) then
    new.client_id := null;
  end if;
  if new.dossier_id is not null and (new.entite_id is null or not exists (select 1 from dossiers where id = new.dossier_id and entite_id = new.entite_id and (new.client_id is null or client_id = new.client_id))) then
    new.dossier_id := null;
  end if;
  -- Changement d'entreprise : la réponse préparée avec les données de l'autre entreprise n'est plus proposée.
  if new.entite_id is distinct from old.entite_id then
    update whatsapp_propositions set statut = 'remplacee'
    where conversation_id = new.id and statut in ('a_faire', 'en_cours') and entite_id is distinct from new.entite_id;
  end if;
  if new.entite_id is distinct from old.entite_id and new.entite_id is not null and new.client_id is null then
    select t.client_id, t.dossier_id into trouve from whatsapp_trouver_client(new.organisation_id, new.telephone) t where t.entite_id = new.entite_id;
    new.client_id := trouve.client_id;
    new.dossier_id := coalesce(new.dossier_id, trouve.dossier_id);
  end if;
  return new;
end
$$;
drop trigger if exists whatsapp_reclasser on whatsapp_conversations;
create trigger whatsapp_reclasser before update on whatsapp_conversations for each row execute function whatsapp_reclasser();

-- Client cherché dans une seule entreprise (whatsapp_trouver_client prend le plus récent de Secret et Taxi).
create or replace function whatsapp_trouver_client(org uuid, tel text) returns table (client_id uuid, entite_id uuid, dossier_id uuid)
language sql stable security definer set search_path = public as $$
  with t as (select regexp_replace(coalesce(tel, ''), '[^0-9]', '', 'g') as n),
  c as (
    select c.id, c.entite_id, c.updated_at from clients c join entites e on e.id = c.entite_id, t
    where e.organisation_id = org and e.slug in ('secret', 'taxi') and c.telephone is not null and length(t.n) >= 8
      and (regexp_replace(c.telephone, '[^0-9]', '', 'g') = t.n
        or (length(regexp_replace(c.telephone, '[^0-9]', '', 'g')) >= 9 and right(regexp_replace(c.telephone, '[^0-9]', '', 'g'), 9) = right(t.n, 9)))
  ),
  -- Le plus récent de chaque entreprise : la fonction appelante choisit l'entreprise.
  r as (select distinct on (c.entite_id) c.id, c.entite_id from c order by c.entite_id, c.updated_at desc)
  select r.id, r.entite_id,
    (select d.id from dossiers d where d.client_id = r.id and d.entite_id = r.entite_id and not d.annule order by d.created_at desc limit 1)
  from r join clients x on x.id = r.id order by x.updated_at desc
$$;
revoke all on function whatsapp_trouver_client(uuid, text) from public, anon, authenticated;
revoke all on function whatsapp_reclasser(), whatsapp_proposition_traitee() from public, anon;

-- La première conversation d'un numéro prend le client le plus récent (première ligne) : whatsapp_ranger de la migration 58 lit
-- « select * into trouve from whatsapp_trouver_client(...) », qui garde la première ligne rendue. Rien à changer.

-- Conservation des propositions : 90 jours au plus (appelée par la fonction avec purger_whatsapp).
create or replace function purger_whatsapp_propositions(org uuid) returns integer language sql security definer set search_path = public as $$
  with s as (
    delete from whatsapp_propositions p using whatsapp_conversations c
    where c.id = p.conversation_id and c.organisation_id = org and p.cree_le < now() - interval '90 days'
    returning 1
  )
  select count(*)::integer from s;
$$;
revoke all on function purger_whatsapp_propositions(uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function purger_whatsapp_propositions(uuid), whatsapp_trouver_client(uuid, text) to service_role';
  end if;
end $$;

-- 3. Journal de l'assistant : l'usage « whatsapp » s'ajoute aux usages en place (relus, quel que soit le nom de la contrainte).
do $$
declare
  c record;
  usages text[] := array[]::text[];
begin
  for c in
    select conname, pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'public.assistant_journal'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ '\musage\M'
  loop
    usages := usages || array(select m[1] from regexp_matches(c.def, '''([a-z_]+)''', 'g') as m);
    execute format('alter table public.assistant_journal drop constraint %I', c.conname);
  end loop;
  usages := array(select distinct u from unnest(usages || array['lire', 'rediger', 'agent', 'whatsapp']) as u order by u);
  execute format('alter table public.assistant_journal add constraint assistant_journal_usage_check check (usage in (%s))',
    (select string_agg(quote_literal(u), ', ' order by u) from unnest(usages) as u));
end
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_propositions') then
    alter publication supabase_realtime add table public.whatsapp_propositions;
  end if;
end $$;

commit;
