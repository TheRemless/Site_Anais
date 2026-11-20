-- Gestion : migration 58, réception des messages WhatsApp de Nani (numéro de Secret et VIP Taxi Lanta, coexistence Telnyx, 20.11.2026).
-- Le numéro reste dans l'app WhatsApp Business de Nani. Telnyx envoie à la fonction « whatsapp » (sans JWT, signature Ed25519 vérifiée) :
--   * message.received : un client écrit (texte, photo, document, modification, suppression) ;
--   * message.echo : Nani répond depuis l'app (seulement si le numéro est rattaché à un profil de messagerie qui pointe vers la fonction) ;
--   * whatsapp.account.update : le compte est déconnecté, reconnecté ou retiré.
-- L'historique de 6 mois et les contacts ne sont PAS transmis : Telnyx les consomme lui-même et n'offre aucune API pour les relire.
--
-- Tables :
--   1. whatsapp_reglages : une ligne par organisation. L'interrupteur « réception » (Réglages) et l'état du compte vu par Telnyx.
--   2. whatsapp_evenements : chaque événement brut, tel que reçu, une seule fois (clé = id de l'événement Telnyx). Sert à rejouer un
--      traitement manqué. Personne ne le lit depuis l'outil (clé de service seulement).
--   3. whatsapp_conversations : une par numéro de client. Entreprise (Secret, VIP Taxi Lanta, ou à trier), client et dossier rattachés.
--   4. whatsapp_messages : chaque message, entrant (client) ou sortant (app de Nani ou Gestion), avec l'id Meta (wamid) et les médias.
--   5. stockage « whatsapp » (privé) : les photos et documents copiés dès réception, parce que les liens de Telnyx et de Meta expirent.
--
-- Droits : lecture réservée aux administrateurs de Secret et de VIP Taxi Lanta (« reglages.ecrire » et toute l'entreprise). Une conversation
-- à trier se lit par un administrateur de l'une des deux. Personne ne crée ni n'écrit un message depuis l'outil : seule la fonction le fait.
-- Mook et les rôles sans réglages ne voient rien.
--
-- Conservation (purger_whatsapp, appelée par la fonction au plus une fois par heure) :
--   * événements bruts : 30 jours ;
--   * médias : 90 jours (le fichier est effacé du stockage, le message garde son type et sa légende) ;
--   * messages : 365 jours ; une conversation sans message depuis 365 jours est supprimée avec ses messages.
-- Aucun message ne sert à entraîner un modèle. L'IA (phase 2) ne reçoit que le texte des messages, jamais un net, une commission ni une banque.
--
-- À exécuter une seule fois, AVANT de déployer la fonction « whatsapp ». Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Retour en arrière (efface les messages reçus) :
--   drop table if exists whatsapp_messages, whatsapp_conversations, whatsapp_evenements, whatsapp_reglages cascade;
--   drop function if exists whatsapp_admin(uuid), whatsapp_lit(uuid, uuid), whatsapp_lit_chemin(text), whatsapp_ranger(uuid, text, text, jsonb),
--     whatsapp_trouver_client(uuid, text), purger_whatsapp();
--   delete from storage.buckets where id = 'whatsapp';  (après avoir vidé le stockage depuis le tableau de bord)
-- Contrôle :
--   select type, count(*), max(recu_le) from whatsapp_evenements group by 1;
--   select sens, origine, count(*) from whatsapp_messages group by 1, 2;

begin;

-- 1. Réglages par organisation.
create table if not exists whatsapp_reglages (
  organisation_id uuid primary key references organisations (id) on delete cascade,
  reception_active boolean not null default true,
  -- Numéro de l'entreprise (E.164), noté par la fonction au premier message : sert au lien « Ouvrir dans WhatsApp » et à l'envoi par l'API.
  numero text check (numero is null or numero ~ '^\+[1-9][0-9]{6,15}$'),
  -- Dernier état du compte annoncé par Telnyx (ACCOUNT_OFFBOARDED, ACCOUNT_RECONNECTED, PARTNER_REMOVED).
  etat_compte text check (etat_compte is null or etat_compte ~ '^[A-Z_]{1,40}$'),
  etat_le timestamptz,
  dernier_evenement_le timestamptz,
  purge_le timestamptz,
  updated_at timestamptz not null default now()
);
insert into whatsapp_reglages (organisation_id)
select id from organisations where id = '00000000-0000-0000-0000-00000000a000'
on conflict do nothing;

-- 2. Événements bruts : idempotents sur l'id Telnyx (data.id). Bornés en taille ; la fonction refuse plus gros avant d'écrire.
create table if not exists whatsapp_evenements (
  id text primary key check (id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  recu_le timestamptz not null default now(),
  type text not null check (length(type) between 1 and 60),
  survenu_le timestamptz,
  organisation_id uuid references organisations (id) on delete cascade,
  -- Le texte d'un jsonb est un peu plus long que le corps reçu (espaces ajoutés) : marge du double sur la limite de la fonction (1 Mo).
  brut jsonb not null check (length(brut::text) <= 2000000),
  -- Pris par une instance de la fonction (2 minutes au plus) ; traité quand le message est rangé.
  pris_le timestamptz,
  traite_le timestamptz,
  erreur text check (length(erreur) <= 500),
  essais integer not null default 0 check (essais between 0 and 100)
);
create index if not exists whatsapp_evenements_recu on whatsapp_evenements (recu_le);
create index if not exists whatsapp_evenements_a_traiter on whatsapp_evenements (recu_le) where traite_le is null;

-- 3. Conversations : une par numéro de client et par organisation.
create table if not exists whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  telephone text not null check (telephone ~ '^\+[1-9][0-9]{6,15}$'),
  -- Nom du profil WhatsApp, si Telnyx le donne.
  nom text check (length(nom) <= 100),
  -- Secret ou VIP Taxi Lanta ; vide = à trier. source : qui l'a décidé (client connu, agent, personne).
  entite_id uuid references entites (id) on delete set null,
  entite_source text not null default 'auto' check (entite_source in ('auto', 'client', 'agent', 'manuel')),
  client_id uuid references clients (id) on delete set null,
  dossier_id uuid references dossiers (id) on delete set null,
  dernier_message_le timestamptz,
  dernier_sens text check (dernier_sens in ('entrant', 'sortant')),
  non_lus integer not null default 0 check (non_lus >= 0),
  unique (organisation_id, telephone)
);
create index if not exists whatsapp_conversations_recentes on whatsapp_conversations (organisation_id, dernier_message_le desc);
create index if not exists whatsapp_conversations_entite on whatsapp_conversations (entite_id);

-- 4. Messages.
create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references whatsapp_conversations (id) on delete cascade,
  evenement_id text,
  -- Id du message chez Telnyx et chez Meta (wamid) : un message n'entre qu'une fois, même renvoyé par Telnyx.
  telnyx_id text unique check (length(telnyx_id) <= 100),
  meta_id text unique check (length(meta_id) <= 200),
  sens text not null check (sens in ('entrant', 'sortant')),
  -- client : écrit par le client ; app : envoyé par Nani depuis l'app WhatsApp Business ; gestion : envoyé depuis Gestion par l'API.
  origine text not null check (origine in ('client', 'app', 'gestion')),
  type text not null check (type ~ '^[a-z_]{1,30}$'),
  texte text check (length(texte) <= 8000),
  -- [{ type, mime, taille, sha256, legende, nom, chemin, statut: a_copier | copie | echec | efface | trop_gros }]
  medias jsonb not null default '[]'::jsonb check (jsonb_typeof(medias) = 'array' and length(medias::text) <= 20000),
  envoye_le timestamptz not null,
  recu_le timestamptz not null default now(),
  modifie_le timestamptz,
  supprime_le timestamptz,
  repond_a text check (length(repond_a) <= 200)
);
create index if not exists whatsapp_messages_conversation on whatsapp_messages (conversation_id, envoye_le desc);
create index if not exists whatsapp_messages_envoye on whatsapp_messages (envoye_le);

create or replace function whatsapp_tenir_a_jour() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists tenir_a_jour on whatsapp_conversations;
create trigger tenir_a_jour before update on whatsapp_conversations for each row execute function whatsapp_tenir_a_jour();
drop trigger if exists tenir_a_jour on whatsapp_reglages;
create trigger tenir_a_jour before update on whatsapp_reglages for each row execute function whatsapp_tenir_a_jour();

-- Qui lit : un administrateur de Secret ou de VIP Taxi Lanta (réglages et toute l'entreprise).
create or replace function whatsapp_admin(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from entites where id = e and slug in ('secret', 'taxi')) and a_permission(e, 'reglages.ecrire') and voit_tout(e)
$$;
-- Une conversation rangée se lit par un administrateur de son entreprise ; à trier, par un administrateur de Secret ou de Taxi de l'organisation.
create or replace function whatsapp_lit(e uuid, org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when e is not null then whatsapp_admin(e) and organisation_de(e) = org
    else exists (select 1 from entites x where x.organisation_id = org and x.slug in ('secret', 'taxi') and whatsapp_admin(x.id))
  end
$$;
-- Chemin d'un média : <organisation>/<conversation>/<fichier>. Un nom mal formé ne donne jamais accès.
create or replace function whatsapp_lit_chemin(chemin text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from whatsapp_conversations c
    -- Comparaison en texte : aucun cast d'un nom mal formé, donc jamais d'erreur, seulement « non ».
    where c.id::text = split_part(chemin, '/', 2)
      and c.organisation_id::text = split_part(chemin, '/', 1)
      and whatsapp_lit(c.entite_id, c.organisation_id)
  )
$$;
revoke all on function whatsapp_admin(uuid), whatsapp_lit(uuid, uuid), whatsapp_lit_chemin(text) from public, anon;
grant execute on function whatsapp_admin(uuid), whatsapp_lit(uuid, uuid), whatsapp_lit_chemin(text) to authenticated;

alter table whatsapp_reglages enable row level security;
alter table whatsapp_evenements enable row level security;
alter table whatsapp_conversations enable row level security;
alter table whatsapp_messages enable row level security;
revoke all on whatsapp_reglages, whatsapp_evenements, whatsapp_conversations, whatsapp_messages from anon, authenticated;

-- Réglages : lus et l'interrupteur changé par un administrateur de Secret ou de Taxi de l'organisation. Rien d'autre ne s'écrit depuis l'outil.
grant select on whatsapp_reglages to authenticated;
grant update (reception_active) on whatsapp_reglages to authenticated;
drop policy if exists "lire les réglages WhatsApp" on whatsapp_reglages;
create policy "lire les réglages WhatsApp" on whatsapp_reglages for select to authenticated using (whatsapp_lit(null, organisation_id));
drop policy if exists "suspendre la réception WhatsApp" on whatsapp_reglages;
create policy "suspendre la réception WhatsApp" on whatsapp_reglages for update to authenticated
  using (whatsapp_lit(null, organisation_id)) with check (whatsapp_lit(null, organisation_id));

-- Conversations et messages : lecture seule depuis l'outil (la phase 2 ouvrira le classement et le rattachement).
grant select on whatsapp_conversations, whatsapp_messages to authenticated;
drop policy if exists "lire les conversations WhatsApp" on whatsapp_conversations;
create policy "lire les conversations WhatsApp" on whatsapp_conversations for select to authenticated using (whatsapp_lit(entite_id, organisation_id));
drop policy if exists "lire les messages WhatsApp" on whatsapp_messages;
create policy "lire les messages WhatsApp" on whatsapp_messages for select to authenticated
  using (exists (select 1 from whatsapp_conversations c where c.id = conversation_id and whatsapp_lit(c.entite_id, c.organisation_id)));
-- whatsapp_evenements : aucune politique, aucun droit. Seule la clé de service (la fonction) y lit et écrit.

-- Client connu : même numéro (chiffres seuls, ou les 9 derniers chiffres pour un numéro noté à la thaïe « 081 … ») dans Secret ou Taxi.
create or replace function whatsapp_trouver_client(org uuid, tel text) returns table (client_id uuid, entite_id uuid, dossier_id uuid)
language sql stable security definer set search_path = public as $$
  with t as (select regexp_replace(coalesce(tel, ''), '[^0-9]', '', 'g') as n),
  c as (
    select c.id, c.entite_id, c.updated_at from clients c join entites e on e.id = c.entite_id, t
    where e.organisation_id = org and e.slug in ('secret', 'taxi') and c.telephone is not null and length(t.n) >= 8
      and (regexp_replace(c.telephone, '[^0-9]', '', 'g') = t.n
        or (length(regexp_replace(c.telephone, '[^0-9]', '', 'g')) >= 9 and right(regexp_replace(c.telephone, '[^0-9]', '', 'g'), 9) = right(t.n, 9)))
  )
  select c.id, c.entite_id,
    (select d.id from dossiers d where d.client_id = c.id and d.entite_id = c.entite_id and not d.annule order by d.created_at desc limit 1)
  from c order by c.updated_at desc limit 1
$$;

-- Range un message (appelée par la fonction, clé de service) : crée ou met à jour la conversation, puis écrit le message une seule fois.
-- m : { telephone, nom, evenement_id, telnyx_id, meta_id, sens, origine, type, texte, medias, envoye_le, repond_a }
-- Rend { conversation_id, message_id, nouveau } ; nouveau = false si le message était déjà là (événement renvoyé par Telnyx).
create or replace function whatsapp_ranger(org uuid, tel text, nom_profil text, m jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  conv uuid;
  msg uuid;
  trouve record;
  quand timestamptz := coalesce((m->>'envoye_le')::timestamptz, now());
begin
  select id into conv from whatsapp_conversations where organisation_id = org and telephone = tel for update;
  if conv is null then
    select * into trouve from whatsapp_trouver_client(org, tel);
    insert into whatsapp_conversations (organisation_id, telephone, nom, entite_id, entite_source, client_id, dossier_id)
    values (org, tel, nullif(left(nom_profil, 100), ''), trouve.entite_id, case when trouve.entite_id is null then 'auto' else 'client' end, trouve.client_id, trouve.dossier_id)
    on conflict (organisation_id, telephone) do nothing
    returning id into conv;
    if conv is null then
      select id into conv from whatsapp_conversations where organisation_id = org and telephone = tel for update;
    end if;
  end if;

  insert into whatsapp_messages (conversation_id, evenement_id, telnyx_id, meta_id, sens, origine, type, texte, medias, envoye_le, repond_a)
  values (conv, m->>'evenement_id', nullif(m->>'telnyx_id', ''), nullif(m->>'meta_id', ''), m->>'sens', m->>'origine', m->>'type',
    left(m->>'texte', 8000), coalesce(m->'medias', '[]'::jsonb), quand, left(nullif(m->>'repond_a', ''), 200))
  on conflict do nothing
  returning id into msg;

  if msg is null then
    select id into msg from whatsapp_messages
    where (telnyx_id is not null and telnyx_id = m->>'telnyx_id') or (meta_id is not null and meta_id = m->>'meta_id') limit 1;
    return jsonb_build_object('conversation_id', conv, 'message_id', msg, 'nouveau', false);
  end if;

  update whatsapp_conversations set
    nom = coalesce(nullif(left(nom_profil, 100), ''), whatsapp_conversations.nom),
    dernier_message_le = greatest(coalesce(dernier_message_le, quand), quand),
    dernier_sens = case when dernier_message_le is null or quand >= dernier_message_le then m->>'sens' else dernier_sens end,
    -- Un message du client ajoute un non-lu ; une réponse de Nani (app ou Gestion) remet le compteur à zéro.
    -- Un écho en retard (plus ancien que le dernier message) ne remet pas le compteur à zéro.
    non_lus = case when m->>'sens' = 'entrant' then non_lus + 1 when dernier_message_le is null or quand >= dernier_message_le then 0 else non_lus end
  where id = conv;
  return jsonb_build_object('conversation_id', conv, 'message_id', msg, 'nouveau', true);
end
$$;

-- Conservation : événements 30 jours, messages et conversations 365 jours. Rend les chemins des médias de plus de 90 jours à effacer
-- du stockage (la fonction les efface puis marque le média « efface ») ; seulement ceux d'une organisation.
create or replace function purger_whatsapp(org uuid) returns table (message_id uuid, chemins text[]) language plpgsql security definer set search_path = public as $$
begin
  delete from whatsapp_evenements where (organisation_id = org or organisation_id is null) and recu_le < now() - interval '30 days';
  delete from whatsapp_messages w using whatsapp_conversations c
    where c.id = w.conversation_id and c.organisation_id = org and w.envoye_le < now() - interval '365 days';
  delete from whatsapp_conversations where organisation_id = org and coalesce(dernier_message_le, created_at) < now() - interval '365 days';
  update whatsapp_reglages set purge_le = now() where organisation_id = org;
  return query
    select w.id, array(select x->>'chemin' from jsonb_array_elements(w.medias) x where x->>'statut' = 'copie' and x->>'chemin' is not null)
    from whatsapp_messages w join whatsapp_conversations c on c.id = w.conversation_id
    where c.organisation_id = org and w.envoye_le < now() - interval '90 days'
      and exists (select 1 from jsonb_array_elements(w.medias) x where x->>'statut' = 'copie')
    limit 200;
end
$$;

revoke all on function whatsapp_trouver_client(uuid, text), whatsapp_ranger(uuid, text, text, jsonb), purger_whatsapp(uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function whatsapp_trouver_client(uuid, text), whatsapp_ranger(uuid, text, text, jsonb), purger_whatsapp(uuid) to service_role';
  end if;
end $$;

-- 5. Stockage privé des médias, 20 Mo par fichier (photos, vocaux, PDF ; une vidéo plus lourde reste signalée « trop_gros »).
insert into storage.buckets (id, name, public) values ('whatsapp', 'whatsapp', false) on conflict (id) do nothing;
update storage.buckets set public = false, file_size_limit = 20971520 where id = 'whatsapp';
drop policy if exists "lire les médias WhatsApp" on storage.objects;
create policy "lire les médias WhatsApp" on storage.objects for select to authenticated using (bucket_id = 'whatsapp' and whatsapp_lit_chemin(name));
-- Aucune politique d'écriture : seule la fonction (clé de service) dépose ou efface un média.

-- La boîte se met à jour sans rafraîchir (Realtime applique les règles RLS ci-dessus). Sans effet là où Realtime n'existe pas.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_conversations') then
      alter publication supabase_realtime add table public.whatsapp_conversations;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_messages') then
      alter publication supabase_realtime add table public.whatsapp_messages;
    end if;
  end if;
end $$;

commit;
