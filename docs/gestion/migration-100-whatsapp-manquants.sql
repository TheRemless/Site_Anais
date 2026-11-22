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
--   5. whatsapp_signaler_manque (clé de service seulement) : pose manque_le, sauf si le client a écrit depuis. Un message du client, même
--      en retard, efface manque_le, et le repère des réponses de Nani qu'il précède.
--   6. Même BSUID, autre numéro : jamais de changement de numéro, une nouvelle conversation qui porte meme_client_que (« Nouveau numéro pour
--      ce client »). Une conversation sans numéro est rattachée à celle du même client dès que son numéro arrive (whatsapp_rattacher).
-- Aucune IA, aucune notification. Aucun texte de client n'est lu ni écrit par ce fichier.
--
-- À exécuter une seule fois, AVANT de déployer la fonction « whatsapp » de cette PR. Ne modifie aucun message existant. Se rejoue sans effet.
-- Retour en arrière : docs/gestion/retour-100-whatsapp-manquants.sql.
-- Contrôle :
--   select count(*) filter (where bsuid is not null) avec_bsuid, count(*) filter (where telephone is null) sans_numero, count(meme_client_que) nouveau_numero, count(*) total from whatsapp_conversations;
--   select count(*) from whatsapp_messages where repere = 'semble_manquer' or type = 'non_transmis';
-- Contrôle PGlite : docs/gestion/verif-whatsapp-manquants.mjs.

begin;

-- 1. BSUID et numéro facultatif.
alter table whatsapp_conversations add column if not exists bsuid text;
alter table whatsapp_conversations add column if not exists manque_le timestamptz;
-- Même client (même BSUID) écrivant depuis un autre numéro : la conversation de l'ancien numéro. L'écran dit « Nouveau numéro pour ce client ».
alter table whatsapp_conversations add column if not exists meme_client_que uuid references whatsapp_conversations (id) on delete set null;
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
--    Numéro connu : sa conversation. Sinon, par BSUID :
--      - conversation sans numéro : la même, et elle reçoit ce numéro ;
--      - conversation avec un AUTRE numéro : le numéro n'est jamais changé, une nouvelle conversation est ouverte pour ce numéro et
--        porte meme_client_que (l'écran dit « Nouveau numéro pour ce client ») ;
--      - message sans numéro : la conversation du BSUID.
--    Conversation trouvée par son numéro alors qu'une conversation SANS numéro porte ce BSUID (client vu d'abord sans numéro, un Contact
--    personnel par exemple) : elle est rattachée (ses messages et tout ce qui la cite passent à la conversation du numéro, elle disparaît).
--    Avec un autre numéro : seulement le signal meme_client_que.
create or replace function whatsapp_ranger(org uuid, tel text, nom_profil text, m jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  conv uuid;
  autre uuid;
  msg uuid;
  trouve record;
  deja record;
  w record;
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
    select id, telephone into w from whatsapp_conversations where organisation_id = org and bsuid = ident for update;
    if w.id is not null then
      if w.telephone is null or tel is null then
        conv := w.id;
        -- Première fois qu'un numéro arrive pour ce client : noté (ce n'est pas un changement de numéro).
        if tel is not null then
          update whatsapp_conversations set telephone = tel where id = conv and telephone is null
            and not exists (select 1 from whatsapp_conversations x where x.organisation_id = org and x.telephone = tel);
        end if;
      else
        autre := w.id;
      end if;
    end if;
  end if;
  if conv is null then
    -- Sans numéro, aucun client à reconnaître : la conversation reste à trier.
    select null::uuid as client_id, null::uuid as entite_id, null::uuid as dossier_id into trouve;
    if tel is not null then
      select * into trouve from whatsapp_trouver_client(org, tel);
    end if;
    insert into whatsapp_conversations (organisation_id, telephone, bsuid, meme_client_que, nom, entite_id, entite_source, client_id, dossier_id)
    values (org, tel, case when autre is null then ident end, autre, nullif(left(nom_profil, 100), ''), trouve.entite_id,
      case when trouve.entite_id is null then 'auto' else 'client' end, trouve.client_id, trouve.dossier_id)
    on conflict do nothing
    returning id into conv;
    if conv is null then
      select id into conv from whatsapp_conversations where organisation_id = org and ((tel is not null and telephone = tel) or (tel is null and bsuid = ident))
        limit 1 for update;
    end if;
  elsif ident is not null then
    select x.id, x.telephone, x.reponses, (select y.reponses from whatsapp_conversations y where y.id = conv) as reponses_cible
      into w from whatsapp_conversations x where x.organisation_id = org and x.bsuid = ident and x.id <> conv for update;
    if w.id is null then
      -- Le BSUID d'une conversation connue par son numéro est noté une fois.
      update whatsapp_conversations set bsuid = ident where id = conv and bsuid is null;
    elsif w.telephone is null and (w.reponses is distinct from 'jamais' or w.reponses_cible = 'jamais') then
      -- La conversation du numéro garde ses réglages (un Contact personnel le reste). Celle sans numéro réglée « jamais » par Nani ne se
      -- fond pas dans une conversation ouverte à l'IA : seulement le signal ci-dessous (dans le doute, pas d'IA).
      perform whatsapp_rattacher(w.id, conv);
      update whatsapp_conversations set bsuid = ident where id = conv and bsuid is null;
    else
      update whatsapp_conversations set meme_client_que = w.id where id = conv and meme_client_que is null;
    end if;
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
    -- Un message du client, même arrivé en retard : le repère de la liste n'a plus lieu d'être.
    manque_le = case when m->>'sens' = 'entrant' then null else manque_le end
  where id = conv;
  -- Arrivé en retard, il précède les réponses de Nani qui portaient le repère : elles ne le portent plus.
  if m->>'sens' = 'entrant' then
    update whatsapp_messages set repere = null where conversation_id = conv and repere is not null and envoye_le >= quand;
  end if;
  return jsonb_build_object('conversation_id', conv, 'message_id', msg, 'nouveau', true);
end
$$;

-- Rattache une conversation sans numéro (source) à celle du même client (cible) : tout ce qui cite la source (messages, propositions,
-- conversations de l'Assistant, tâches, et toute autre colonne qui la référence) passe à la cible, puis la source disparaît. Clé de service.
create or replace function whatsapp_rattacher(p_source uuid, p_cible uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  src record;
begin
  select * into src from whatsapp_conversations where id = p_source and telephone is null for update;
  if src.id is null or p_source = p_cible then return; end if;
  for r in
    select c.conrelid::regclass as t, a.attname as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.whatsapp_conversations'::regclass and array_length(c.conkey, 1) = 1
  loop
    execute format('update %s set %I = $1 where %I = $2', r.t, r.col, r.col) using p_cible, p_source;
  end loop;
  update whatsapp_conversations set meme_client_que = null where id = p_cible and meme_client_que = p_cible;
  update whatsapp_conversations c set
    nom = coalesce(c.nom, src.nom),
    non_lus = c.non_lus + src.non_lus,
    manque_le = coalesce(c.manque_le, src.manque_le)
  where c.id = p_cible;
  delete from whatsapp_conversations where id = p_source;
  perform whatsapp_recalculer_dernier(p_cible);
  perform whatsapp_apercu(p_cible);
end
$$;

-- 3. Repère de la liste : posé par la fonction « whatsapp », sauf si le client a écrit depuis cette réponse de Nani.
create or replace function whatsapp_signaler_manque(p_conversation uuid, p_quand timestamptz) returns void
language sql security definer set search_path = public as $$
  update whatsapp_conversations c set manque_le = p_quand
  where c.id = p_conversation and (c.manque_le is null or c.manque_le < p_quand)
    and not exists (select 1 from whatsapp_messages w where w.conversation_id = c.id and w.sens = 'entrant' and w.envoye_le > p_quand);
$$;

revoke all on function whatsapp_ranger(uuid, text, text, jsonb), whatsapp_signaler_manque(uuid, timestamptz), whatsapp_rattacher(uuid, uuid) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function whatsapp_ranger(uuid, text, text, jsonb), whatsapp_signaler_manque(uuid, timestamptz), whatsapp_rattacher(uuid, uuid) to service_role';
  end if;
end $$;

commit;
