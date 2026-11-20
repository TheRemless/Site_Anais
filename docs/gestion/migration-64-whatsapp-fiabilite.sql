-- Gestion : migration 64, fiabilité de la boîte WhatsApp (lot 3 des audits du 20.11.2026, audit dev I1, I2, I4, I5, I8).
-- Aucun message ne doit se perdre ni rester bloqué :
--   1. whatsapp_messages.statut_envoi : un envoi depuis Gestion est rangé AVANT l'appel à Telnyx (« envoi »), puis complété (« envoye »).
--      Les statuts de Telnyx (message.sent, message.finalized, message.read) le font passer à « remis », « lu » ou « echec ».
--      Un envoi resté « envoi » plus de 5 minutes passe « echec » (erreur_envoi = « sans_confirmation ») : l'écran demande de vérifier.
--   2. Doublon impossible : un même événement Telnyx ne range qu'un message, même sans id Telnyx ni id Meta (index unique sur evenement_id).
--   3. Réservation d'un événement : whatsapp_reserver_evenement compte l'essai au moment où il est pris (une instance tuée en route compte aussi).
--      La reprise passe toutes les 5 minutes (pg_cron « whatsapp-reprise », posé à part : docs/gestion/cron-whatsapp-reprise.sql).
--   4. Réglages > WhatsApp : whatsapp_etat_reception() (administrateurs de Secret ou de Taxi, lecture) compte les événements en erreur et
--      abandonnés ; whatsapp_relancer_evenements() remet les abandonnés en file.
--   5. « C'est parti » ou « Pas parti » sur un envoi au résultat inconnu : whatsapp_confirmer_envoi (qui peut écrire dans la conversation).
--   6. Conservation : un événement jamais traité reste 90 jours (au lieu de 30) pour pouvoir être repris.
--
-- À exécuter une seule fois, AVANT de déployer les fonctions « whatsapp » et « whatsapp-envoi » de ce lot. Ne modifie aucune donnée existante.
-- Se rejoue sans effet. Rejouer la migration 58 après celle-ci remettrait l'ancien whatsapp_ranger et l'ancienne purge : rejouer alors la 64.
-- Retour en arrière :
--   drop index if exists whatsapp_messages_evenement;
--   drop function if exists whatsapp_reserver_evenement(text), whatsapp_etat_reception(), whatsapp_relancer_evenements(),
--     whatsapp_confirmer_envoi(uuid, boolean), whatsapp_retirer_envoi(uuid), whatsapp_recalculer_dernier(uuid);
--   alter table whatsapp_messages drop column if exists statut_envoi, drop column if exists erreur_envoi, drop column if exists statut_le;
--   puis rejouer whatsapp_ranger et purger_whatsapp de la migration 58.
-- Contrôle :
--   select statut_envoi, count(*) from whatsapp_messages group by 1;
--   select count(*) filter (where traite_le is null and erreur is not null) en_erreur, count(*) filter (where traite_le is null and essais >= 5) abandonnes from whatsapp_evenements;

begin;

-- 1. Statut d'envoi d'un message sortant. Vide pour un message du client.
--    envoi : rangé, l'appel à Telnyx est en cours ou son résultat est inconnu ; envoye : accepté par Telnyx ; remis : arrivé sur le téléphone ;
--    lu : lu par le client (s'il a les confirmations de lecture) ; echec : refusé par WhatsApp, ou sans confirmation après 5 minutes.
alter table whatsapp_messages add column if not exists statut_envoi text;
alter table whatsapp_messages add column if not exists erreur_envoi text;
alter table whatsapp_messages add column if not exists statut_le timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_messages_statut_envoi_check') then
    alter table whatsapp_messages add constraint whatsapp_messages_statut_envoi_check
      check (statut_envoi is null or statut_envoi in ('envoi', 'envoye', 'remis', 'lu', 'echec'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_messages_erreur_envoi_check') then
    alter table whatsapp_messages add constraint whatsapp_messages_erreur_envoi_check check (erreur_envoi is null or length(erreur_envoi) <= 200);
  end if;
end $$;
-- Les envois au résultat inconnu, relus par la reprise toutes les 5 minutes.
create index if not exists whatsapp_messages_envoi on whatsapp_messages (envoye_le) where statut_envoi = 'envoi';

-- 2. Un événement ne range qu'un message (audit I8). Aucun doublon en production au 20.11.2026 (contrôlé en lecture).
create unique index if not exists whatsapp_messages_evenement on whatsapp_messages (evenement_id) where evenement_id is not null;

-- whatsapp_ranger de la migration 58, avec le statut d'envoi (seulement pour un message sortant de Gestion) et la relecture d'un message
-- déjà rangé aussi par son événement.
create or replace function whatsapp_ranger(org uuid, tel text, nom_profil text, m jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  conv uuid;
  msg uuid;
  trouve record;
  quand timestamptz := coalesce((m->>'envoye_le')::timestamptz, now());
  statut text := case when m->>'origine' = 'gestion' and m->>'statut_envoi' in ('envoi', 'envoye') then m->>'statut_envoi' end;
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

  insert into whatsapp_messages (conversation_id, evenement_id, telnyx_id, meta_id, sens, origine, type, texte, medias, envoye_le, repond_a, statut_envoi, statut_le)
  values (conv, nullif(m->>'evenement_id', ''), nullif(m->>'telnyx_id', ''), nullif(m->>'meta_id', ''), m->>'sens', m->>'origine', m->>'type',
    left(m->>'texte', 8000), coalesce(m->'medias', '[]'::jsonb), quand, left(nullif(m->>'repond_a', ''), 200), statut, case when statut is not null then now() end)
  on conflict do nothing
  returning id into msg;

  if msg is null then
    select id into msg from whatsapp_messages
    where (telnyx_id is not null and telnyx_id = m->>'telnyx_id') or (meta_id is not null and meta_id = m->>'meta_id')
      or (evenement_id is not null and evenement_id = m->>'evenement_id') limit 1;
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

-- 3. Réserve un événement à traiter et compte l'essai tout de suite (audit I2). Rien si déjà traité, pris depuis moins de 2 minutes par une
--    autre instance, ou abandonné (5 essais). Clé de service seulement.
create or replace function whatsapp_reserver_evenement(p_id text)
returns table (id text, type text, survenu_le timestamptz, brut jsonb, essais integer, recu_le timestamptz)
language sql security definer set search_path = public as $$
  update whatsapp_evenements e set pris_le = now(), essais = least(e.essais + 1, 100)
  where e.id = p_id and e.traite_le is null and e.essais < 5 and (e.pris_le is null or e.pris_le < now() - interval '2 minutes')
  returning e.id, e.type, e.survenu_le, e.brut, e.essais, e.recu_le
$$;

-- Dernier message d'une conversation recalculé (un envoi retiré ne doit pas la laisser « répondue »).
create or replace function whatsapp_recalculer_dernier(p_conversation uuid) returns void language sql security definer set search_path = public as $$
  update whatsapp_conversations c set
    dernier_message_le = d.envoye_le,
    dernier_sens = coalesce(d.sens, c.dernier_sens)
  from (select (select envoye_le from whatsapp_messages where conversation_id = p_conversation order by envoye_le desc, recu_le desc limit 1) as envoye_le,
               (select sens from whatsapp_messages where conversation_id = p_conversation order by envoye_le desc, recu_le desc limit 1) as sens) d
  where c.id = p_conversation
$$;

-- Retire un envoi depuis Gestion qui n'est sûrement pas parti (refus de Telnyx) : le message disparaît du fil. Clé de service seulement.
create or replace function whatsapp_retirer_envoi(p_message uuid) returns boolean language plpgsql security definer set search_path = public as $$
declare conv uuid;
begin
  delete from whatsapp_messages where id = p_message and origine = 'gestion' and statut_envoi = 'envoi' returning conversation_id into conv;
  if conv is null then return false; end if;
  perform whatsapp_recalculer_dernier(conv);
  return true;
end
$$;

-- 4. État de la réception pour Réglages > WhatsApp (audit I2 et I24) : lecture seule, administrateurs de Secret ou de Taxi de l'organisation.
--    en_erreur : événements pas encore rangés après au moins un échec (repris toutes les 5 minutes) ; abandonnes : 5 échecs, plus repris ;
--    en_retard : ni rangés ni en erreur depuis plus de 10 minutes (reprise arrêtée ?) ; envois_a_verifier : envois depuis Gestion sans réponse sûre.
create or replace function whatsapp_etat_reception() returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with orgs as (
    select r.organisation_id from whatsapp_reglages r where whatsapp_lit(null, r.organisation_id)
  )
  select case when not exists (select 1 from orgs) then null else jsonb_build_object(
    'en_erreur', (select count(*) from whatsapp_evenements e where e.organisation_id in (select organisation_id from orgs) and e.traite_le is null and e.erreur is not null and e.essais < 5),
    'abandonnes', (select count(*) from whatsapp_evenements e where e.organisation_id in (select organisation_id from orgs) and e.traite_le is null and e.essais >= 5),
    'en_retard', (select count(*) from whatsapp_evenements e where e.organisation_id in (select organisation_id from orgs) and e.traite_le is null and e.erreur is null and e.recu_le < now() - interval '10 minutes'),
    'plus_ancien', (select min(e.recu_le) from whatsapp_evenements e where e.organisation_id in (select organisation_id from orgs) and e.traite_le is null and (e.erreur is not null or e.recu_le < now() - interval '10 minutes')),
    'derniere_erreur', (select left(e.erreur, 200) from whatsapp_evenements e where e.organisation_id in (select organisation_id from orgs) and e.traite_le is null and e.erreur is not null order by e.recu_le desc limit 1),
    'envois_a_verifier', (select count(*) from whatsapp_messages m join whatsapp_conversations c on c.id = m.conversation_id
      where c.organisation_id in (select organisation_id from orgs) and (m.statut_envoi = 'envoi' or (m.statut_envoi = 'echec' and m.erreur_envoi = 'sans_confirmation')))
  ) end
$$;

-- Remet en file les événements abandonnés (5 échecs) : la reprise les retente au prochain passage. Rend le nombre remis.
create or replace function whatsapp_relancer_evenements() returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update whatsapp_evenements e set essais = 0, pris_le = null
  where e.traite_le is null and e.essais >= 5
    and e.organisation_id in (select r.organisation_id from whatsapp_reglages r where whatsapp_ecrit(null, r.organisation_id));
  get diagnostics n = row_count;
  return n;
end
$$;

-- 5. Un envoi au résultat inconnu (délai dépassé, plus de 30 secondes sans réponse sûre) : Nani a vérifié dans WhatsApp.
--    parti : le message reste, « envoye », et les réponses préparées ouvertes de la conversation sont soldées ;
--    pas parti : le message est retiré du fil et la réponse préparée restée « envoi » redevient à faire (Nani peut la renvoyer).
create or replace function whatsapp_confirmer_envoi(p_conversation uuid, p_parti boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n_msg integer;
  n_prop integer;
begin
  if auth.uid() is null or p_parti is null or not whatsapp_peut_ecrire(p_conversation) then
    raise exception 'droit_manquant' using errcode = '42501';
  end if;
  if p_parti then
    update whatsapp_messages set statut_envoi = 'envoye', erreur_envoi = null, statut_le = now()
    where conversation_id = p_conversation and origine = 'gestion'
      and (statut_envoi = 'envoi' or (statut_envoi = 'echec' and erreur_envoi = 'sans_confirmation'));
    get diagnostics n_msg = row_count;
    update whatsapp_propositions set statut = 'traitee', traitee_le = now(), traitee_par = auth.uid(), traitee_par_quoi = 'gestion'
    where conversation_id = p_conversation and statut in ('a_faire', 'en_cours', 'envoi');
    get diagnostics n_prop = row_count;
  else
    delete from whatsapp_messages
    where conversation_id = p_conversation and origine = 'gestion'
      and (statut_envoi = 'envoi' or (statut_envoi = 'echec' and erreur_envoi = 'sans_confirmation'));
    get diagnostics n_msg = row_count;
    update whatsapp_propositions set statut = 'a_faire' where conversation_id = p_conversation and statut = 'envoi';
    get diagnostics n_prop = row_count;
    perform whatsapp_recalculer_dernier(p_conversation);
  end if;
  return jsonb_build_object('messages', n_msg, 'propositions', n_prop);
end
$$;

-- 6. Conservation (migration 58) : un événement jamais rangé reste 90 jours pour pouvoir être repris ou relancé.
create or replace function purger_whatsapp(org uuid) returns table (message_id uuid, chemins text[]) language plpgsql security definer set search_path = public as $$
begin
  delete from whatsapp_evenements where (organisation_id = org or organisation_id is null)
    and ((traite_le is not null and recu_le < now() - interval '30 days') or recu_le < now() - interval '90 days');
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

-- Droits.
revoke all on function whatsapp_ranger(uuid, text, text, jsonb), whatsapp_reserver_evenement(text), whatsapp_recalculer_dernier(uuid),
  whatsapp_retirer_envoi(uuid), purger_whatsapp(uuid) from public, anon, authenticated;
revoke all on function whatsapp_etat_reception(), whatsapp_relancer_evenements(), whatsapp_confirmer_envoi(uuid, boolean) from public, anon;
grant execute on function whatsapp_etat_reception(), whatsapp_relancer_evenements(), whatsapp_confirmer_envoi(uuid, boolean) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function whatsapp_ranger(uuid, text, text, jsonb), whatsapp_reserver_evenement(text), whatsapp_recalculer_dernier(uuid),
      whatsapp_retirer_envoi(uuid), purger_whatsapp(uuid) to service_role';
  end if;
end $$;

commit;
