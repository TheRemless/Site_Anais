-- Gestion : migration 65, aperçu du dernier message dans la liste WhatsApp (lot 2 des audits du 20.11.2026, design n° 2, usage n° 2).
-- Suit la 64 (fiabilité de la boîte, lot 3).
--
-- La liste ne montrait qu'un état (« Le client attend une réponse ») : Nani devait ouvrir chaque conversation pour savoir de quoi il
-- s'agissait. Trois colonnes de whatsapp_conversations, tenues à jour par un déclencheur sur whatsapp_messages (aucune fonction à
-- redéployer, whatsapp_ranger ne change pas) :
--   dernier_texte  : le début du dernier message visible (140 caractères, espaces resserrés), la légende d'une photo sans texte, null
--                    pour un média sans légende ;
--   dernier_type   : son type (text, image, audio, document…), ou « supprime » quand le client l'a supprimé ;
--   attend_depuis  : le premier message du client resté sans réponse (après la dernière réponse de Nani), null s'il n'attend rien.
-- Le déclencheur relit les messages de la conversation à chaque message ajouté, modifié ou effacé : un message modifié ou supprimé par
-- le client change aussi l'aperçu, comme un envoi retiré par whatsapp_retirer_envoi ou whatsapp_confirmer_envoi (migration 64), qui
-- effacent la ligne, ou un envoi passé en échec (statut_envoi), qui ne compte pas comme une réponse. Les conversations existantes sont remplies une fois à la fin.
-- La purge (365 jours) efface la conversation avec ses messages : l'aperçu ne survit pas au message.
--
-- Ne modifie aucune donnée existante en dehors de ces trois colonnes. Se rejoue sans effet.
-- Dépend de la 64 (colonne statut_envoi) : un retour en arrière défait la 65 avant la 64.
-- Retour en arrière : docs/gestion/retour-65-whatsapp-apercu.sql.
-- Contrôle : select dernier_texte, dernier_type, attend_depuis from whatsapp_conversations order by dernier_message_le desc limit 5;

begin;

alter table whatsapp_conversations add column if not exists dernier_texte text;
alter table whatsapp_conversations add column if not exists dernier_type text;
alter table whatsapp_conversations add column if not exists attend_depuis timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_conversations_dernier_texte_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_dernier_texte_check check (dernier_texte is null or length(dernier_texte) <= 140);
  end if;
end
$$;

-- L'aperçu et l'attente d'une conversation, relus depuis ses messages (index whatsapp_messages_conversation).
create or replace function whatsapp_apercu(conv uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  dernier record;
  derniere_reponse timestamptz;
  attente timestamptz;
begin
  select coalesce(nullif(trim(texte), ''), (select x->>'legende' from jsonb_array_elements(medias) x where coalesce(x->>'legende', '') <> '' limit 1)) as texte, type, supprime_le
    into dernier from whatsapp_messages
    where conversation_id = conv and type <> 'reaction'
    order by envoye_le desc limit 1;
  -- Un envoi depuis Gestion en échec (migration 64, statut_envoi) n'est pas une réponse : le client attend toujours.
  select max(envoye_le) into derniere_reponse from whatsapp_messages where conversation_id = conv and sens = 'sortant' and coalesce(statut_envoi, '') <> 'echec';
  select min(envoye_le) into attente from whatsapp_messages
    where conversation_id = conv and sens = 'entrant' and supprime_le is null and type <> 'reaction'
      and envoye_le > coalesce(derniere_reponse, '-infinity'::timestamptz);
  update whatsapp_conversations set
    dernier_texte = case when dernier.supprime_le is not null then null
      else nullif(left(regexp_replace(trim(coalesce(dernier.texte, '')), '\s+', ' ', 'g'), 140), '') end,
    dernier_type = case when dernier.supprime_le is not null then 'supprime' else left(dernier.type, 20) end,
    attend_depuis = attente
  where id = conv
    and (dernier_texte is distinct from (case when dernier.supprime_le is not null then null else nullif(left(regexp_replace(trim(coalesce(dernier.texte, '')), '\s+', ' ', 'g'), 140), '') end)
      or dernier_type is distinct from (case when dernier.supprime_le is not null then 'supprime' else left(dernier.type, 20) end)
      or attend_depuis is distinct from attente);
end
$$;
revoke all on function whatsapp_apercu(uuid) from public, anon, authenticated;

create or replace function whatsapp_apercu_message() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Une ligne effacée (envoi retiré, purge) : la conversation de l'ancienne ligne.
  perform whatsapp_apercu(coalesce(new.conversation_id, old.conversation_id));
  return null;
end
$$;
revoke all on function whatsapp_apercu_message() from public, anon, authenticated;

drop trigger if exists apercu on whatsapp_messages;
create trigger apercu after insert or update of texte, supprime_le, statut_envoi or delete on whatsapp_messages
  for each row execute function whatsapp_apercu_message();

-- Les conversations déjà là.
select whatsapp_apercu(id) from whatsapp_conversations;

commit;
