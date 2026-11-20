-- Gestion : migration 61, dossier depuis une conversation WhatsApp (20.11.2026). Suit la 60.
-- agent_conversations.whatsapp_conversation_id : la conversation de l'Assistant ouverte par « Créer le dossier » ou « Mettre à jour le
-- dossier » dans l'écran WhatsApp. Après validation du dossier, l'outil relie la conversation WhatsApp au client et au dossier créés.
-- La conversation WhatsApp doit être lisible par la personne (whatsapp_lit) : une conversation de l'Assistant ne pointe jamais vers une
-- conversation WhatsApp qu'elle ne voit pas. Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Retour en arrière : alter table agent_conversations drop column if exists whatsapp_conversation_id;

begin;

alter table agent_conversations add column if not exists whatsapp_conversation_id uuid references whatsapp_conversations (id) on delete set null;
create index if not exists agent_conversations_whatsapp on agent_conversations (whatsapp_conversation_id) where whatsapp_conversation_id is not null;

create or replace function agent_whatsapp_lisible() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.whatsapp_conversation_id is not null and (tg_op = 'INSERT' or new.whatsapp_conversation_id is distinct from old.whatsapp_conversation_id) then
    -- Lisible par la personne et rangée dans la même entreprise que la conversation de l'Assistant.
    if auth.uid() is not null and not exists (select 1 from whatsapp_conversations c where c.id = new.whatsapp_conversation_id and c.entite_id = new.entite_id and whatsapp_lit(c.entite_id, c.organisation_id)) then
      raise exception 'Conversation WhatsApp introuvable.' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function agent_whatsapp_lisible() from public, anon;
drop trigger if exists agent_whatsapp_lisible on agent_conversations;
create trigger agent_whatsapp_lisible before insert or update on agent_conversations for each row execute function agent_whatsapp_lisible();

commit;
