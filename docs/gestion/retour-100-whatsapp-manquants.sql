-- Retour en arrière de la migration 100 (messages WhatsApp manquants, BSUID, repère).
-- Avant : redéployer la fonction « whatsapp » d'avant la PR, sinon elle appelle whatsapp_signaler_manque et écrit la colonne repere.
-- Une conversation rangée sans numéro (BSUID seul) empêche de remettre le numéro obligatoire : ce fichier s'arrête alors et la nomme.
-- Avant (lecture seule) :
--   select id, bsuid, nom from whatsapp_conversations where telephone is null;
-- Les lignes « Message du client non transmis » (type non_transmis) restent dans les conversations : l'écran d'avant les montre comme
-- « Message que Gestion ne sait pas afficher », avec leur texte.
begin;

do $$
declare n integer;
begin
  select count(*) into n from whatsapp_conversations where telephone is null;
  if n > 0 then
    raise exception '% conversation(s) sans numéro (BSUID seul) : les supprimer ou leur donner un numéro avant ce retour.', n;
  end if;
end $$;

drop function if exists whatsapp_signaler_manque(uuid, timestamptz);

-- whatsapp_ranger de la migration 64 (lu en production le 22.11.2026).
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
    non_lus = case when m->>'sens' = 'entrant' then non_lus + 1 when dernier_message_le is null or quand >= dernier_message_le then 0 else non_lus end
  where id = conv;
  return jsonb_build_object('conversation_id', conv, 'message_id', msg, 'nouveau', true);
end
$$;
revoke all on function whatsapp_ranger(uuid, text, text, jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function whatsapp_ranger(uuid, text, text, jsonb) to service_role';
  end if;
end $$;

drop index if exists whatsapp_conversations_bsuid;
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_identifiant_check;
alter table whatsapp_conversations alter column telephone set not null;
alter table whatsapp_conversations drop column if exists bsuid, drop column if exists manque_le;
alter table whatsapp_messages drop column if exists repere;

commit;
-- Contrôle après (aucune ligne) :
--   select column_name from information_schema.columns where table_name in ('whatsapp_conversations', 'whatsapp_messages') and column_name in ('bsuid', 'manque_le', 'repere');
