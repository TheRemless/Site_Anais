-- Gestion : migration 133 (27.11.2026), l'Assistant en équipe. Demande de Jérémy : « je dois pouvoir voir aussi les conversations qu'Anaïs fait
-- de son côté et je dois pouvoir interagir aussi comme si c'était elle. Des fois je reprends son travail quand elle a besoin. »
-- À exécuter une seule fois, APRÈS les migrations 52, 55, 61, 67 et 120. Idempotente. Ne modifie aucune donnée existante.
-- Retour en arrière : retour-133-assistant-equipe.sql.
--
-- 1. agent_voit_equipe(e) : l'administration de l'entreprise (« reglages.ecrire », super_admin compris par permissions_dans) qui écrit aussi
--    des dossiers voit toutes les conversations de l'Assistant de CETTE entreprise. Les autres rôles ne voient que les leurs, comme avant.
--    Chaque entreprise reste séparée : ZTP, Secret et Taxi ont chacune leur règle (une administratrice de Secret ne lit rien de ZTP).
-- 2. agent_ma_conversation(c) (migration 52) suit la même règle : les messages, les cartes et les pièces jointes (agent_fichiers, migration 55)
--    d'une conversation de l'équipe s'ouvrent à l'administration, sans changer leurs politiques.
-- 3. agent_conversations : quatre politiques au lieu de « mes conversations ». Une conversation reste à sa propriétaire (user_id) même quand
--    une administratrice y écrit. Une nouvelle discussion qui remplace une discussion pleine (agent/discussion-pleine.js) garde la
--    propriétaire de l'ancienne : l'administration peut la créer au nom d'une personne de l'entreprise, personne d'autre.
-- 4. Auteurs réels : agent_messages.auteur_id (qui a envoyé le message, posé par la base), agent_cartes.decide_par (qui a validé ou écarté) et
--    agent_cartes.prise_par (qui a pris la carte). Les lignes d'avant restent sans auteur : l'écran les lit comme écrites par la propriétaire.
-- 5. Une seule réponse à la fois : prendre_agent_conversation(c) prend la conversation (verrou lu en base avec « for update ») avant que la
--    fonction « agent » n'écrive quoi que ce soit ; une seconde demande, de la même personne ou d'une autre, trouve la conversation occupée.
--    rendre_agent_conversation(c, jeton) la rend à la fin. Une prise de plus de 3 minutes se reprend (la fonction s'arrête à 150 s). Les colonnes
--    du verrou ne s'écrivent que par ces deux fonctions ; un message ajouté par une autre personne pendant une réponse est refusé.
-- 6. prendre_agent_carte(c) (migration 120) lit la carte avec « for update » et note qui la prend : deux personnes qui valident la même carte
--    en même temps, une seule la prend.
-- 7. Temps réel : agent_conversations et agent_cartes entrent dans la publication supabase_realtime. Seul le nom de la table remonte à
--    l'écran, qui relit avec sa session (RLS). Les deux écrans d'une même conversation se mettent à jour.
-- Le crédit de l'Assistant reste compté sur l'entreprise (assistant_cout_depuis, migration 52) ; la limite du jour reste celle de la personne
-- qui écrit (fonction « agent »). Les apprentissages gardent leur auteur réel (noter_agent_apprentissage, migration 74).

begin;

-- ---- 1. Qui voit l'équipe -----------------------------------------------------------------------------------------------------------------
create or replace function agent_voit_equipe(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select a_permission(e, 'reglages.ecrire') and a_permission(e, 'dossiers.ecrire');
$$;
revoke all on function agent_voit_equipe(uuid) from public, anon;
grant execute on function agent_voit_equipe(uuid) to authenticated;

-- ---- 2. Une conversation lisible : la mienne, ou celle de l'équipe pour l'administration --------------------------------------------------
create or replace function agent_ma_conversation(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from agent_conversations a
    where a.id = c and a_permission(a.entite_id, 'dossiers.ecrire') and (a.user_id = auth.uid() or agent_voit_equipe(a.entite_id))
  );
$$;
revoke all on function agent_ma_conversation(uuid) from public, anon;
grant execute on function agent_ma_conversation(uuid) to authenticated;

-- ---- 3. Politiques des conversations ---------------------------------------------------------------------------------------------------
alter table agent_conversations add column if not exists reponse_par uuid;
alter table agent_conversations add column if not exists reponse_le timestamptz;
alter table agent_conversations add column if not exists reponse_jeton uuid;
create index if not exists agent_conversations_equipe on agent_conversations (entite_id, maj_le desc);

-- Une personne de l'entreprise (membre actif) ou l'administration générale : la seule propriétaire qu'une administratrice peut donner.
-- Appelée par les politiques avec la session : elle ne répond que pour une entreprise dont la personne connectée est membre (comme equipe_de).
create or replace function agent_membre_de(u uuid, e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select est_membre(e) and exists (select 1 from profils p where p.user_id = u and p.actif and (p.super_admin or exists (select 1 from membres m where m.user_id = u and m.entite_id = e)));
$$;
revoke all on function agent_membre_de(uuid, uuid) from public, anon;
grant execute on function agent_membre_de(uuid, uuid) to authenticated;

-- La conversation est à la personne qui la crée, sauf une discussion qui en remplace une pleine, créée par l'administration au nom de la
-- propriétaire. Son entreprise, sa date de création et sa propriétaire ne changent plus. Le verrou de réponse ne s'écrit que par
-- prendre_agent_conversation et rendre_agent_conversation (réglage local « gestion.agent_verrou »).
create or replace function noter_agent_conversation() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id is null or new.user_id = auth.uid() or auth.uid() is null
       or not (agent_voit_equipe(new.entite_id) and agent_membre_de(new.user_id, new.entite_id)) then
      new.user_id := coalesce(auth.uid(), new.user_id);
    end if;
    new.reponse_par := null;
    new.reponse_le := null;
    new.reponse_jeton := null;
  else
    new.user_id := old.user_id;
    new.entite_id := old.entite_id;
    new.cree_le := old.cree_le;
    if coalesce(current_setting('gestion.agent_verrou', true), '') <> '1' then
      new.reponse_par := old.reponse_par;
      new.reponse_le := old.reponse_le;
      new.reponse_jeton := old.reponse_jeton;
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists noter_agent_conversation on agent_conversations;
create trigger noter_agent_conversation before insert or update on agent_conversations for each row execute function noter_agent_conversation();

drop policy if exists "mes conversations" on agent_conversations;
drop policy if exists "lire les conversations de l'assistant" on agent_conversations;
create policy "lire les conversations de l'assistant" on agent_conversations for select to authenticated
  using (a_permission(entite_id, 'dossiers.ecrire') and (user_id = auth.uid() or agent_voit_equipe(entite_id)));
drop policy if exists "ouvrir une conversation de l'assistant" on agent_conversations;
create policy "ouvrir une conversation de l'assistant" on agent_conversations for insert to authenticated
  with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire')
    and (user_id = auth.uid() or (agent_voit_equipe(entite_id) and agent_membre_de(user_id, entite_id)))
    and (dossier_id is null or exists (select 1 from dossiers d where d.id = dossier_id and d.entite_id = agent_conversations.entite_id)));
drop policy if exists "ranger une conversation de l'assistant" on agent_conversations;
create policy "ranger une conversation de l'assistant" on agent_conversations for update to authenticated
  using (a_permission(entite_id, 'dossiers.ecrire') and (user_id = auth.uid() or agent_voit_equipe(entite_id)))
  with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire')
    and (user_id = auth.uid() or agent_voit_equipe(entite_id))
    and (dossier_id is null or exists (select 1 from dossiers d where d.id = dossier_id and d.entite_id = agent_conversations.entite_id)));
drop policy if exists "supprimer une conversation de l'assistant" on agent_conversations;
create policy "supprimer une conversation de l'assistant" on agent_conversations for delete to authenticated
  using (a_permission(entite_id, 'dossiers.ecrire') and (user_id = auth.uid() or agent_voit_equipe(entite_id)));

-- ---- 4. Auteurs réels -------------------------------------------------------------------------------------------------------------------
alter table agent_messages add column if not exists auteur_id uuid;
alter table agent_cartes add column if not exists decide_par uuid;
alter table agent_cartes add column if not exists prise_par uuid;

-- L'auteur d'un message est la session qui l'écrit (la fonction « agent » écrit avec la session de la personne) ; la clé de service n'en
-- a pas. Pendant qu'une réponse est en cours, seule la personne qui l'a demandée ajoute des messages à la conversation.
create or replace function noter_agent_message() returns trigger language plpgsql set search_path = public as $$
begin
  new.auteur_id := auth.uid();
  if auth.uid() is not null and exists (
    select 1 from agent_conversations a
    where a.id = new.conversation_id and a.reponse_le > now() - interval '3 minutes' and a.reponse_par is distinct from auth.uid()
  ) then
    raise exception 'conversation_occupee' using errcode = '55P03';
  end if;
  return new;
end
$$;
drop trigger if exists noter_agent_message on agent_messages;
create trigger noter_agent_message before insert on agent_messages for each row execute function noter_agent_message();

-- Une carte décidée ne change plus que de sort ; son contenu reste celui que l'agent a proposé. Qui décide est posé par la base.
create or replace function figer_agent_carte() returns trigger language plpgsql set search_path = public as $$
begin
  new.conversation_id := old.conversation_id;
  new.genre := old.genre;
  new.titre := old.titre;
  new.donnees := old.donnees;
  new.avertissements := old.avertissements;
  new.cree_le := old.cree_le;
  new.decide_le := case when new.statut <> old.statut then now() else old.decide_le end;
  new.decide_par := case when new.statut <> old.statut then auth.uid() else old.decide_par end;
  new.prise_par := case when new.prise_le is null then null when new.prise_le is distinct from old.prise_le then auth.uid() else old.prise_par end;
  return new;
end
$$;
drop trigger if exists figer_agent_carte on agent_cartes;
create trigger figer_agent_carte before update on agent_cartes for each row execute function figer_agent_carte();

-- ---- 5. Une seule réponse à la fois --------------------------------------------------------------------------------------------------------
-- Rend { ok: true, jeton } quand cette demande prend la conversation ; { ok: false, raison: 'occupee', par, depuis } si une réponse est en
-- cours depuis moins de 3 minutes ; { ok: false, raison: 'introuvable' } pour une conversation que la personne ne lit pas.
-- Droits de la personne (security invoker) : la ligne se lit et se verrouille sous les politiques de la conversation.
create or replace function prendre_agent_conversation(p_conversation uuid) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  c record;
  j uuid := gen_random_uuid();
begin
  select id, reponse_par, reponse_le into c from agent_conversations where id = p_conversation for update;
  if not found then
    return jsonb_build_object('ok', false, 'raison', 'introuvable');
  end if;
  if c.reponse_le is not null and c.reponse_le > now() - interval '3 minutes' then
    return jsonb_build_object('ok', false, 'raison', 'occupee', 'par', c.reponse_par, 'depuis', c.reponse_le);
  end if;
  perform set_config('gestion.agent_verrou', '1', true);
  update agent_conversations set reponse_par = auth.uid(), reponse_le = now(), reponse_jeton = j where id = p_conversation;
  perform set_config('gestion.agent_verrou', '', true);
  return jsonb_build_object('ok', true, 'jeton', j);
end
$$;

-- Rend la conversation, seulement avec le jeton de la prise (une réponse arrêtée après 3 minutes ne libère pas celle qui l'a reprise).
create or replace function rendre_agent_conversation(p_conversation uuid, p_jeton uuid) returns boolean language plpgsql security invoker set search_path = public as $$
declare
  n integer;
begin
  perform 1 from agent_conversations where id = p_conversation and reponse_jeton = p_jeton for update;
  if not found then
    return false;
  end if;
  perform set_config('gestion.agent_verrou', '1', true);
  update agent_conversations set reponse_par = null, reponse_le = null, reponse_jeton = null where id = p_conversation and reponse_jeton = p_jeton;
  get diagnostics n = row_count;
  perform set_config('gestion.agent_verrou', '', true);
  return n = 1;
end
$$;
revoke all on function prendre_agent_conversation(uuid) from public, anon;
revoke all on function rendre_agent_conversation(uuid, uuid) from public, anon;
grant execute on function prendre_agent_conversation(uuid) to authenticated;
grant execute on function rendre_agent_conversation(uuid, uuid) to authenticated;

-- ---- 6. Une carte prise une fois, lue avec « for update » -----------------------------------------------------------------------------------
create or replace function prendre_agent_carte(p_carte uuid) returns boolean language plpgsql security invoker set search_path = public as $$
declare
  c record;
begin
  select id, statut, prise_le into c from agent_cartes where id = p_carte for update;
  if not found or c.statut <> 'proposee' or (c.prise_le is not null and c.prise_le >= now() - interval '2 minutes') then
    return false;
  end if;
  update agent_cartes set prise_le = now() where id = p_carte;
  return true;
end
$$;
revoke all on function prendre_agent_carte(uuid) from public, anon;
grant execute on function prendre_agent_carte(uuid) to authenticated;

-- ---- 7. Temps réel ------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_conversations') then
      alter publication supabase_realtime add table public.agent_conversations;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_cartes') then
      alter publication supabase_realtime add table public.agent_cartes;
    end if;
  end if;
end
$$;

commit;
