-- Gestion : migration 52, conversations de l'agent (onglet « Assistant », 19.11.2026).
-- 1. agent_conversations : une conversation par client ou par demande, plusieurs ouvertes en parallèle, reliable à un dossier.
-- 2. agent_messages : l'historique tel qu'il part chez Claude (texte, appels d'outils et leurs résultats, blocs de réflexion), dans l'ordre.
--    Jamais un net : les outils n'en rendent pas (supabase/functions/agent/outils.js).
-- 3. agent_cartes : les propositions de l'agent (dossier, service, modification, réponse au client) et leur sort (proposée, validée, écartée).
--    Une carte n'écrit rien : « Valider » ouvre l'écran habituel de l'outil, déjà rempli, et c'est lui qui enregistre.
-- Droits : chaque personne ne voit que ses conversations, dans une entreprise où elle a « dossiers.ecrire » (règles RLS). La fonction
-- « agent » lit et écrit avec la session de la personne : les mêmes règles s'appliquent.
-- Conservation : une conversation sans nouveau message depuis 90 jours est supprimée avec ses messages et ses cartes (fonction
-- purger_agent_conversations, appelée par la fonction « agent » à chaque échange ; les dossiers créés restent, bien sûr).
-- 4. temps_trajets : la table de temps de trajet de référence de chaque entreprise (décision de Jérémy du 19.11.2026, pas de Google Maps) :
--    de zone à zone, durée en minutes, ferry ou non, marge conseillée, source et date, « à vérifier » tant que Nani ou Mr. Brown ne l'ont pas
--    confirmée. Pré-remplie depuis l'écran (pages taxi du site, durées des trajets, grilles de pickup), chaque ligne marquée à vérifier.
--    Lire : « partenaires.lire ». Ajouter ou corriger : « dossiers.ecrire » et « partenaires.lire ». Supprimer : « partenaires.ecrire ».
-- 5. lieux_geo et trajets_ors : ce qu'openrouteservice (ou, pour l'organisation de Koh Lanta, Nominatim et OSRM) a trouvé (coordonnées d'un lieu, durée entre deux lieux), gardé pour ne pas le
--    recalculer (quota gratuit). Aucune donnée de client : un nom de lieu, des coordonnées, une durée. Mêmes droits que temps_trajets.
-- 6. liaisons_ferry : règle de Jérémy du 19.11.2026, un trajet qui passe par un ferry se calcule en trois morceaux (route jusqu'au port,
--    ferry à durée fixe, route depuis le port d'arrivée). Chaque liaison dit quelle île elle dessert, ses deux ports (et leurs coordonnées si
--    on les connaît) et la durée du ferry, traversée et attente comprises (60 min par défaut), modifiable par Nani. Mêmes droits que temps_trajets.
-- 7. Journal de l'assistant : la colonne « usage » accepte « agent » (et les usages des lots 1 et 5, trier et brochure, pour ne pas les
--    perdre si cette migration passe après les leurs).
-- Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Retour en arrière :
--   drop table if exists liaisons_ferry; drop table if exists temps_trajets; drop table if exists lieux_geo; drop table if exists trajets_ors; drop function if exists noter_temps_trajet();
--   drop table if exists agent_cartes; drop table if exists agent_messages; drop table if exists agent_conversations;
--   drop function if exists purger_agent_conversations(integer); drop function if exists noter_agent_conversation();
--   drop function if exists agent_ma_conversation(uuid); drop function if exists figer_agent_carte(); drop function if exists assistant_cout_depuis(timestamptz);
--   alter table assistant_journal drop constraint if exists assistant_journal_usage_check;
--   alter table assistant_journal add constraint assistant_journal_usage_check check (usage in ('lire', 'rediger', 'itineraire', 'situer', 'repondre_itineraire', 'trier', 'brochure'));

begin;

create table if not exists agent_conversations (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null references entites (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  titre text not null default '' check (length(titre) <= 120),
  apercu text not null default '' check (length(apercu) <= 200),
  dossier_id uuid references dossiers (id) on delete set null,
  statut text not null default 'ouverte' check (statut in ('ouverte', 'archivee')),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists agent_conversations_personne on agent_conversations (user_id, entite_id, maj_le desc);

create table if not exists agent_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references agent_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  contenu jsonb not null,
  cree_le timestamptz not null default now()
);
create index if not exists agent_messages_conversation on agent_messages (conversation_id, id);

create table if not exists agent_cartes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references agent_conversations (id) on delete cascade,
  genre text not null check (genre in ('dossier', 'reservation', 'modification', 'reponse', 'temps')),
  titre text not null default '' check (length(titre) <= 120),
  donnees jsonb not null default '{}',
  avertissements jsonb not null default '[]',
  statut text not null default 'proposee' check (statut in ('proposee', 'validee', 'ecartee')),
  cree_le timestamptz not null default now(),
  decide_le timestamptz
);
create index if not exists agent_cartes_conversation on agent_cartes (conversation_id, cree_le);

-- La conversation est à la personne qui la crée ; son entreprise et sa date de création ne changent plus.
create or replace function noter_agent_conversation() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
  else
    new.user_id := old.user_id;
    new.entite_id := old.entite_id;
    new.cree_le := old.cree_le;
  end if;
  return new;
end
$$;
drop trigger if exists noter_agent_conversation on agent_conversations;
create trigger noter_agent_conversation before insert or update on agent_conversations for each row execute function noter_agent_conversation();

-- Ma conversation : à moi, dans une entreprise où j'ai encore le droit d'écrire des dossiers.
create or replace function agent_ma_conversation(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from agent_conversations a where a.id = c and a.user_id = auth.uid() and a_permission(a.entite_id, 'dossiers.ecrire'));
$$;
revoke all on function agent_ma_conversation(uuid) from public, anon;
grant execute on function agent_ma_conversation(uuid) to authenticated;

alter table agent_conversations enable row level security;
alter table agent_messages enable row level security;
alter table agent_cartes enable row level security;
revoke all on agent_conversations, agent_messages, agent_cartes from anon, authenticated;
grant select, insert, update, delete on agent_conversations to authenticated;
grant select, insert on agent_messages to authenticated;
grant select, insert, update on agent_cartes to authenticated;
grant usage on sequence agent_messages_id_seq to authenticated;

drop policy if exists "mes conversations" on agent_conversations;
create policy "mes conversations" on agent_conversations for all to authenticated
  using (user_id = auth.uid() and a_permission(entite_id, 'dossiers.ecrire'))
  with check (user_id = auth.uid() and a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire')
    -- Un dossier relié doit être de la même entreprise.
    and (dossier_id is null or exists (select 1 from dossiers d where d.id = dossier_id and d.entite_id = agent_conversations.entite_id)));

-- Messages : lus et ajoutés dans mes conversations, jamais modifiés (l'historique repart tel quel chez Claude).
drop policy if exists "lire mes messages" on agent_messages;
create policy "lire mes messages" on agent_messages for select to authenticated using (agent_ma_conversation(conversation_id));
drop policy if exists "ajouter mes messages" on agent_messages;
create policy "ajouter mes messages" on agent_messages for insert to authenticated with check (agent_ma_conversation(conversation_id));

-- Cartes : ajoutées par la fonction (avec ma session), et leur sort décidé par moi.
drop policy if exists "lire mes cartes" on agent_cartes;
create policy "lire mes cartes" on agent_cartes for select to authenticated using (agent_ma_conversation(conversation_id));
drop policy if exists "ajouter mes cartes" on agent_cartes;
create policy "ajouter mes cartes" on agent_cartes for insert to authenticated with check (agent_ma_conversation(conversation_id) and statut = 'proposee');
drop policy if exists "décider de mes cartes" on agent_cartes;
create policy "décider de mes cartes" on agent_cartes for update to authenticated using (agent_ma_conversation(conversation_id)) with check (agent_ma_conversation(conversation_id));

-- Une carte décidée ne change plus que de sort ; son contenu reste celui que l'agent a proposé.
create or replace function figer_agent_carte() returns trigger language plpgsql set search_path = public as $$
begin
  new.conversation_id := old.conversation_id;
  new.genre := old.genre;
  new.titre := old.titre;
  new.donnees := old.donnees;
  new.avertissements := old.avertissements;
  new.cree_le := old.cree_le;
  new.decide_le := case when new.statut <> old.statut then now() else old.decide_le end;
  return new;
end
$$;
drop trigger if exists figer_agent_carte on agent_cartes;
create trigger figer_agent_carte before update on agent_cartes for each row execute function figer_agent_carte();

-- Conservation : supprime MES conversations sans message depuis `jours` jours (90 par défaut). Rend le nombre supprimé.
create or replace function purger_agent_conversations(jours integer default 90) returns integer language sql security invoker set search_path = public as $$
  with s as (delete from agent_conversations where user_id = auth.uid() and maj_le < now() - make_interval(days => greatest(jours, 7)) returning 1)
  select count(*)::integer from s;
$$;
revoke all on function purger_agent_conversations(integer) from public, anon;
grant execute on function purger_agent_conversations(integer) to authenticated;

-- ---- Temps de trajet de référence ----------------------------------------------------------------------------------------------
create table if not exists temps_trajets (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null references entites (id) on delete cascade,
  de text not null check (length(de) between 1 and 120),
  vers text not null check (length(vers) between 1 and 120),
  -- Clé de la paire, la même dans les deux sens (temps.js, clePaire) : une ligne Koh Lanta ↔ Krabi Airport sert à l'aller et au retour.
  cle text not null check (length(cle) between 1 and 250),
  mode text not null default 'route' check (mode in ('route', 'bateau')),
  duree_min integer not null check (duree_min between 1 and 1440),
  ferry boolean not null default false,
  marge_min integer not null default 0 check (marge_min between 0 and 240),
  source text not null default '' check (length(source) <= 200),
  source_date date,
  a_verifier boolean not null default true,
  origine text not null default 'saisie' check (origine in ('saisie', 'site', 'bateau', 'zones', 'agent')),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  maj_par uuid default auth.uid(),
  unique (entite_id, mode, cle)
);
create index if not exists temps_trajets_entite on temps_trajets (entite_id);

create table if not exists lieux_geo (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null references entites (id) on delete cascade,
  cle text not null check (length(cle) between 1 and 160),
  nom text not null check (length(nom) between 1 and 160),
  lon double precision not null check (lon between -180 and 180),
  lat double precision not null check (lat between -90 and 90),
  label text not null default '' check (length(label) <= 200),
  origine text not null default 'ors' check (origine in ('ors', 'nominatim', 'saisie')),
  a_verifier boolean not null default true,
  maj_le timestamptz not null default now(),
  maj_par uuid default auth.uid(),
  unique (entite_id, cle)
);

create table if not exists trajets_ors (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null references entites (id) on delete cascade,
  cle text not null check (length(cle) between 1 and 250),
  duree_min integer not null check (duree_min between 1 and 1440),
  distance_km numeric(8, 1),
  ferry boolean not null default false,
  de_trouve text not null default '' check (length(de_trouve) <= 200),
  vers_trouve text not null default '' check (length(vers_trouve) <= 200),
  -- Le serveur qui a calculé l'itinéraire : openrouteservice (clé) ou OSRM public (organisation de Koh Lanta, décision du 20.11.2026).
  moteur text not null default 'ors' check (moteur in ('ors', 'osrm')),
  maj_le timestamptz not null default now(),
  unique (entite_id, cle)
);

create table if not exists liaisons_ferry (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null references entites (id) on delete cascade,
  nom text not null check (length(nom) between 1 and 120),
  -- La zone desservie côté île (« Koh Lanta ») : un trajet dont un seul bout est sur cette île passe par cette liaison.
  cote_ile text not null check (length(cote_ile) between 1 and 120),
  port_ile text not null check (length(port_ile) between 1 and 160),
  port_continent text not null check (length(port_continent) between 1 and 160),
  -- Coordonnées « latitude, longitude » des ports, facultatives : sans elles, openrouteservice cherche le port par son nom.
  port_ile_coord text not null default '' check (length(port_ile_coord) <= 60),
  port_continent_coord text not null default '' check (length(port_continent_coord) <= 60),
  duree_min integer not null default 60 check (duree_min between 1 and 600),
  source text not null default '' check (length(source) <= 200),
  source_date date,
  a_verifier boolean not null default true,
  maj_le timestamptz not null default now(),
  maj_par uuid default auth.uid(),
  unique (entite_id, cote_ile)
);

-- Date et auteur de la dernière modification, posés par la base ; l'entreprise d'une ligne ne change pas.
create or replace function noter_temps_trajet() returns trigger language plpgsql set search_path = public as $$
begin
  new.maj_le := now();
  if tg_table_name <> 'trajets_ors' then new.maj_par := auth.uid(); end if;
  if tg_op = 'UPDATE' then new.entite_id := old.entite_id; end if;
  return new;
end
$$;
drop trigger if exists noter_temps_trajet on temps_trajets;
create trigger noter_temps_trajet before insert or update on temps_trajets for each row execute function noter_temps_trajet();
drop trigger if exists noter_temps_trajet on liaisons_ferry;
create trigger noter_temps_trajet before insert or update on liaisons_ferry for each row execute function noter_temps_trajet();
drop trigger if exists noter_temps_trajet on lieux_geo;
create trigger noter_temps_trajet before insert or update on lieux_geo for each row execute function noter_temps_trajet();
drop trigger if exists noter_temps_trajet on trajets_ors;
create trigger noter_temps_trajet before insert or update on trajets_ors for each row execute function noter_temps_trajet();

alter table temps_trajets enable row level security;
alter table liaisons_ferry enable row level security;
alter table lieux_geo enable row level security;
alter table trajets_ors enable row level security;
revoke all on temps_trajets, liaisons_ferry, lieux_geo, trajets_ors from anon, authenticated;
grant select, insert, update, delete on temps_trajets, liaisons_ferry, lieux_geo, trajets_ors to authenticated;

drop policy if exists "lire les liaisons de ferry" on liaisons_ferry;
create policy "lire les liaisons de ferry" on liaisons_ferry for select to authenticated using (a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "ajouter une liaison de ferry" on liaisons_ferry;
create policy "ajouter une liaison de ferry" on liaisons_ferry for insert to authenticated with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "corriger une liaison de ferry" on liaisons_ferry;
create policy "corriger une liaison de ferry" on liaisons_ferry for update to authenticated using (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire')) with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "supprimer une liaison de ferry" on liaisons_ferry;
create policy "supprimer une liaison de ferry" on liaisons_ferry for delete to authenticated using (a_permission(entite_id, 'partenaires.ecrire'));

drop policy if exists "lire les temps de trajet" on temps_trajets;
create policy "lire les temps de trajet" on temps_trajets for select to authenticated using (a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "ajouter un temps de trajet" on temps_trajets;
create policy "ajouter un temps de trajet" on temps_trajets for insert to authenticated with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "corriger un temps de trajet" on temps_trajets;
create policy "corriger un temps de trajet" on temps_trajets for update to authenticated using (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire')) with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "supprimer un temps de trajet" on temps_trajets;
create policy "supprimer un temps de trajet" on temps_trajets for delete to authenticated using (a_permission(entite_id, 'partenaires.ecrire'));

drop policy if exists "lire les lieux situés" on lieux_geo;
create policy "lire les lieux situés" on lieux_geo for select to authenticated using (a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "ajouter un lieu situé" on lieux_geo;
create policy "ajouter un lieu situé" on lieux_geo for insert to authenticated with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "corriger un lieu situé" on lieux_geo;
create policy "corriger un lieu situé" on lieux_geo for update to authenticated using (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire')) with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "supprimer un lieu situé" on lieux_geo;
create policy "supprimer un lieu situé" on lieux_geo for delete to authenticated using (a_permission(entite_id, 'partenaires.ecrire'));

drop policy if exists "lire les trajets ORS" on trajets_ors;
create policy "lire les trajets ORS" on trajets_ors for select to authenticated using (a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "ajouter un trajet ORS" on trajets_ors;
create policy "ajouter un trajet ORS" on trajets_ors for insert to authenticated with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "corriger un trajet ORS" on trajets_ors;
create policy "corriger un trajet ORS" on trajets_ors for update to authenticated using (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire')) with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "supprimer un trajet ORS" on trajets_ors;
create policy "supprimer un trajet ORS" on trajets_ors for delete to authenticated using (a_permission(entite_id, 'partenaires.ecrire'));

-- Dépense de l'assistant depuis une date (plafond du mois de la fonction « agent ») : la somme se fait dans la base, sans limite de lignes.
-- Pour la fonction seulement (clé de service), comme le journal.
create or replace function assistant_cout_depuis(debut timestamptz) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cout_estime_usd), 0) from assistant_journal where cree_le >= debut;
$$;
-- La clé de service garde le droit d'exécuter que Supabase lui donne par défaut ; personne d'autre ne l'a.
revoke all on function assistant_cout_depuis(timestamptz) from public, anon, authenticated;

-- Le journal de l'assistant accepte l'agent (contrainte de la migration 27, élargie par la 48).
alter table assistant_journal drop constraint if exists assistant_journal_usage_check;
alter table assistant_journal add constraint assistant_journal_usage_check check (usage in ('lire', 'rediger', 'itineraire', 'situer', 'repondre_itineraire', 'trier', 'brochure', 'agent'));

commit;
