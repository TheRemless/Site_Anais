-- Gestion : migration 100, messages WhatsApp de clients que Telnyx n'a pas transmis (22.11.2026).
-- Suit la 73. Ne touche ni aux migrations 74 à 99 des autres chantiers, ni à whatsapp_ranger_voucher.
--
-- Constat (journal « Webhook Deliveries » de Telnyx vide sur le créneau) : des messages de clients visibles dans l'app de Nani n'arrivent
-- jamais à la fonction « whatsapp ». Il n'existe pas d'API d'historique : Gestion rattrape ce que Meta envoie encore et signale le reste.
--   1. whatsapp_conversations.bsuid : identifiant WhatsApp du client propre à l'entreprise (« CH.1234… », Meta, avril 2026). Un client sans
--      numéro (nom d'utilisateur WhatsApp) est rangé par lui : le numéro devient facultatif, l'un des deux est obligatoire. Rempli une fois
--      depuis les événements gardés (30 jours) pour les conversations qui n'ont qu'un seul BSUID.
--   2. whatsapp_conversations.manque_le : date de la dernière réponse de Nani avant laquelle un message du client semble manquer (repère de
--      la liste). Effacée au prochain message du client.
--   3. whatsapp_messages.repere = 'semble_manquer' : la réponse de Nani qui porte ce repère (ligne discrète dans la conversation).
--   4. whatsapp_ranger : retrouve la conversation par BSUID quand le numéro manque (et note le numéro quand il arrive) ; remplace la ligne
--      « Message du client non transmis » (type non_transmis) par le vrai message s'il arrive ensuite avec le même wamid ; complète l'id
--      Telnyx d'un message d'abord rattrapé par le webhook du compte ; refuse un message sans numéro ni BSUID (un envoi depuis Gestion vers
--      une conversation sans numéro échoue donc avant tout appel à Telnyx).
--   5. whatsapp_signaler_manque (clé de service seulement) : pose manque_le, sauf si le client a écrit depuis.
-- Aucune IA, aucune notification. Aucun texte de client n'est lu ni écrit par ce fichier.
--
-- À exécuter une seule fois, AVANT de déployer la fonction « whatsapp » de cette PR. Ne modifie aucun message existant. Se rejoue sans effet.
-- Retour en arrière : docs/gestion/retour-100-whatsapp-manquants.sql.
-- Contrôle :
--   select count(*) filter (where bsuid is not null) avec_bsuid, count(*) filter (where telephone is null) sans_numero, count(*) total from whatsapp_conversations;
--   select count(*) from whatsapp_messages where repere = 'semble_manquer' or type = 'non_transmis';
-- Contrôle PGlite : docs/gestion/verif-whatsapp-manquants.mjs.

begin;

-- 1. BSUID et numéro facultatif.
alter table whatsapp_conversations add column if not exists bsuid text;
alter table whatsapp_conversations add column if not exists manque_le timestamptz;
alter table whatsapp_messages add column if not exists repere text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_conversations_bsuid_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_bsuid_check
      check (bsuid is null or bsuid ~ '^[A-Z]{2}(\.ENT)?\.[A-Za-z0-9]{1,128}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_conversations_identifiant_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_identifiant_check check (telephone is not null or bsuid is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_messages_repere_check') then
    alter table whatsapp_messages add constraint whatsapp_messages_repere_check check (repere is null or repere = 'semble_manquer');
  end if;
end
$$;
alter table whatsapp_conversations alter column telephone drop not null;
create unique index if not exists whatsapp_conversations_bsuid on whatsapp_conversations (organisation_id, bsuid) where bsuid is not null;

-- BSUID des conversations existantes, lu dans les événements gardés : seulement quand la conversation n'en a vu qu'un et qu'aucune autre
-- conversation ne l'a.
with vus as (
  select c.id as conv,
    e.brut #>> case when e.type = 'message.echo' then '{data,payload,body,to_user_id}'::text[] else '{data,payload,body,from_user_id}'::text[] end as b
  from whatsapp_evenements e
  join whatsapp_conversations c on c.organisation_id = e.organisation_id and c.telephone = case when e.type = 'message.echo'
      then coalesce(e.brut #>> '{data,payload,to,0,phone_number}', e.brut #>> '{data,payload,to}')
      else e.brut #>> '{data,payload,from,phone_number}' end
  where e.type in ('message.received', 'message.echo')
), seuls as (
  select conv, min(b) as b from vus where b ~ '^[A-Z]{2}(\.ENT)?\.[A-Za-z0-9]{1,128}$' group by conv having count(distinct b) = 1
), sans_doublon as (
  select s.* from seuls s where (select count(*) from seuls t where t.b = s.b) = 1
)
update whatsapp_conversations c set bsuid = s.b
from sans_doublon s
where c.id = s.conv and c.bsuid is null
  and not exists (select 1 from whatsapp_conversations x where x.organisation_id = c.organisation_id and x.bsuid = s.b);

-- 2. Rangement (remplace celui de la migration 64, même signature). m->>'bsuid' : le BSUID du client, s'il est connu.
create or replace function whatsapp_ranger(org uuid, tel text, nom_profil text, m jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  conv uuid;
  msg uuid;
  trouve record;
  deja record;
  ident text := case when m->>'bsuid' ~ '^[A-Z]{2}(\.ENT)?\.[A-Za-z0-9]{1,128}$' then m->>'bsuid' end;
  quand timestamptz := coalesce((m->>'envoye_le')::timestamptz, now());
  statut text := case when m->>'origine' = 'gestion' and m->>'statut_envoi' in ('envoi', 'envoye') then m->>'statut_envoi' end;
begin
  if tel is null and ident is null then
    raise exception 'sans_identifiant' using errcode = '22023';
  end if;
  if tel is not null then
    select id into conv from whatsapp_conversations where organisation_id = org and telephone = tel for update;
  end if;
  if conv is null and ident is not null then
    select id into conv from whatsapp_conversations where organisation_id = org and bsuid = ident for update;
    -- Une conversation rangée sans numéro reçoit son numéro quand il arrive (s'il n'est pas déjà celui d'une autre conversation).
    if conv is not null and tel is not null then
      update whatsapp_conversations set telephone = tel where id = conv and telephone is null
        and not exists (select 1 from whatsapp_conversations x where x.organisation_id = org and x.telephone = tel);
    end if;
  end if;
  if conv is null then
    -- Sans numéro, aucun client à reconnaître : la conversation reste à trier.
    select null::uuid as client_id, null::uuid as entite_id, null::uuid as dossier_id into trouve;
    if tel is not null then
      select * into trouve from whatsapp_trouver_client(org, tel);
    end if;
    insert into whatsapp_conversations (organisation_id, telephone, bsuid, nom, entite_id, entite_source, client_id, dossier_id)
    values (org, tel, ident, nullif(left(nom_profil, 100), ''), trouve.entite_id, case when trouve.entite_id is null then 'auto' else 'client' end, trouve.client_id, trouve.dossier_id)
    on conflict do nothing
    returning id into conv;
    if conv is null then
      select id into conv from whatsapp_conversations where organisation_id = org and ((tel is not null and telephone = tel) or (ident is not null and bsuid = ident))
        order by (tel is not null and telephone = tel) desc limit 1 for update;
    end if;
  elsif ident is not null then
    -- Le BSUID d'une conversation connue par son numéro est noté une fois.
    update whatsapp_conversations set bsuid = ident where id = conv and bsuid is null
      and not exists (select 1 from whatsapp_conversations x where x.organisation_id = org and x.bsuid = ident);
  end if;

  insert into whatsapp_messages (conversation_id, evenement_id, telnyx_id, meta_id, sens, origine, type, texte, medias, envoye_le, repond_a, statut_envoi, statut_le)
  values (conv, nullif(m->>'evenement_id', ''), nullif(m->>'telnyx_id', ''), nullif(m->>'meta_id', ''), m->>'sens', m->>'origine', m->>'type',
    left(m->>'texte', 8000), coalesce(m->'medias', '[]'::jsonb), quand, left(nullif(m->>'repond_a', ''), 200), statut, case when statut is not null then now() end)
  on conflict do nothing
  returning id into msg;

  if msg is null then
    select id, type, telnyx_id into deja from whatsapp_messages
    where (telnyx_id is not null and telnyx_id = m->>'telnyx_id') or (meta_id is not null and meta_id = m->>'meta_id')
      or (evenement_id is not null and evenement_id = m->>'evenement_id') limit 1;
    -- Le vrai message arrive après la ligne « non transmis » (même wamid) : il la remplace, sans compter un non-lu de plus.
    if deja.id is not null and deja.type = 'non_transmis' and coalesce(m->>'type', '') <> 'non_transmis' then
      update whatsapp_messages set type = m->>'type', texte = left(m->>'texte', 8000), medias = coalesce(m->'medias', '[]'::jsonb),
        telnyx_id = coalesce(telnyx_id, case when not exists (select 1 from whatsapp_messages x where x.telnyx_id = m->>'telnyx_id') then nullif(m->>'telnyx_id', '') end),
        repond_a = coalesce(repond_a, left(nullif(m->>'repond_a', ''), 200))
      where id = deja.id;
      return jsonb_build_object('conversation_id', conv, 'message_id', deja.id, 'nouveau', true, 'remplace', true);
    end if;
    -- Message d'abord rattrapé par le webhook du compte (sans id Telnyx) : l'id Telnyx arrive avec message.received.
    if deja.id is not null and deja.telnyx_id is null and nullif(m->>'telnyx_id', '') is not null then
      update whatsapp_messages set telnyx_id = m->>'telnyx_id' where id = deja.id
        and not exists (select 1 from whatsapp_messages x where x.telnyx_id = m->>'telnyx_id');
    end if;
    return jsonb_build_object('conversation_id', conv, 'message_id', deja.id, 'nouveau', false);
  end if;

  update whatsapp_conversations set
    nom = coalesce(nullif(left(nom_profil, 100), ''), whatsapp_conversations.nom),
    dernier_message_le = greatest(coalesce(dernier_message_le, quand), quand),
    dernier_sens = case when dernier_message_le is null or quand >= dernier_message_le then m->>'sens' else dernier_sens end,
    -- Un message du client ajoute un non-lu ; une réponse de Nani (app ou Gestion) remet le compteur à zéro.
    -- Un écho en retard (plus ancien que le dernier message) ne remet pas le compteur à zéro.
    non_lus = case when m->>'sens' = 'entrant' then non_lus + 1 when dernier_message_le is null or quand >= dernier_message_le then 0 else non_lus end,
    -- Le client a écrit après le repère : il n'a plus lieu d'être.
    manque_le = case when m->>'sens' = 'entrant' and quand >= coalesce(manque_le, quand) then null else manque_le end
  where id = conv;
  return jsonb_build_object('conversation_id', conv, 'message_id', msg, 'nouveau', true);
end
$$;

-- 3. Repère de la liste : posé par la fonction « whatsapp », sauf si le client a écrit depuis cette réponse de Nani.
create or replace function whatsapp_signaler_manque(p_conversation uuid, p_quand timestamptz) returns void
language sql security definer set search_path = public as $$
  update whatsapp_conversations c set manque_le = p_quand
  where c.id = p_conversation and (c.manque_le is null or c.manque_le < p_quand)
    and not exists (select 1 from whatsapp_messages w where w.conversation_id = c.id and w.sens = 'entrant' and w.envoye_le > p_quand);
$$;

revoke all on function whatsapp_ranger(uuid, text, text, jsonb), whatsapp_signaler_manque(uuid, timestamptz) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function whatsapp_ranger(uuid, text, text, jsonb), whatsapp_signaler_manque(uuid, timestamptz) to service_role';
  end if;
end $$;

commit;
