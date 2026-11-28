-- Retour en arrière de la migration 133 (l'Assistant en équipe) : chaque personne ne voit de nouveau que ses conversations (règles de la
-- migration 52), la carte se prend comme avec la migration 120. Les colonnes d'auteur et de verrou sont retirées ; aucune conversation, aucun
-- message ni aucune carte n'est supprimé. L'écran et la fonction « agent » marchent sans elles (lecture d'avant, pas de verrou).
begin;

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_conversations') then
    alter publication supabase_realtime drop table public.agent_conversations;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_cartes') then
    alter publication supabase_realtime drop table public.agent_cartes;
  end if;
end
$$;

drop policy if exists "lire les conversations de l'assistant" on agent_conversations;
drop policy if exists "ouvrir une conversation de l'assistant" on agent_conversations;
drop policy if exists "ranger une conversation de l'assistant" on agent_conversations;
drop policy if exists "supprimer une conversation de l'assistant" on agent_conversations;
drop policy if exists "mes conversations" on agent_conversations;
create policy "mes conversations" on agent_conversations for all to authenticated
  using (user_id = auth.uid() and a_permission(entite_id, 'dossiers.ecrire'))
  with check (user_id = auth.uid() and a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire')
    and (dossier_id is null or exists (select 1 from dossiers d where d.id = dossier_id and d.entite_id = agent_conversations.entite_id)));

-- Les fonctions de la migration 52, telles qu'elles étaient.
create or replace function agent_ma_conversation(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from agent_conversations a where a.id = c and a.user_id = auth.uid() and a_permission(a.entite_id, 'dossiers.ecrire'));
$$;

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

-- La fonction de la migration 120, telle qu'elle était.
create or replace function prendre_agent_carte(p_carte uuid) returns boolean language plpgsql security invoker set search_path = public as $$
declare
  n integer;
begin
  update agent_cartes set prise_le = now()
   where id = p_carte and statut = 'proposee' and (prise_le is null or prise_le < now() - interval '2 minutes');
  get diagnostics n = row_count;
  return n = 1;
end
$$;

create or replace function rendre_agent_carte(p_carte uuid) returns void language plpgsql security invoker set search_path = public as $$
begin
  update agent_cartes set prise_le = null where id = p_carte and statut = 'proposee';
end
$$;

drop trigger if exists agent_conversation_libre on agent_fichiers;
drop trigger if exists agent_conversation_libre on agent_cartes;
drop function if exists agent_conversation_libre();
drop function if exists prendre_agent_carte_equipe(uuid, boolean);
drop function if exists controler_agent_carte(uuid);
drop function if exists ecarter_agent_carte(uuid);
drop function if exists remplacer_agent_conversation(uuid, uuid);
drop function if exists agent_reponses_en_cours(uuid);
drop trigger if exists noter_agent_message on agent_messages;
drop function if exists noter_agent_message();
drop function if exists prendre_agent_conversation(uuid);
drop function if exists rendre_agent_conversation(uuid, uuid);
drop function if exists agent_voit_equipe(uuid);
drop function if exists agent_membre_de(uuid, uuid);
drop index if exists agent_conversations_equipe;
alter table agent_conversations drop column if exists reponse_par, drop column if exists reponse_le, drop column if exists reponse_jeton;
alter table agent_messages drop column if exists auteur_id;
alter table agent_cartes drop column if exists decide_par, drop column if exists prise_par;

commit;
