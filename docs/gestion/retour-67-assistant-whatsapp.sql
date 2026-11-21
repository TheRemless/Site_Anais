-- Retour en arrière de la migration 67 (l'Assistant lit la boîte WhatsApp). L'agent garde ses outils WhatsApp : sans la fonction, la
-- recherche dans le texte des messages est sautée (nom, numéro, client et dossier se cherchent encore). Les tâches de promesse perdent leur
-- lien vers la conversation (l'Assistant les rapproche comme avant ; la fonction « whatsapp » les écrit sans lui). Aucune autre donnée
-- n'est touchée.
begin;
drop function if exists whatsapp_rechercher(text, integer);
drop function if exists whatsapp_partenaires_parmi(text[]);
drop index if exists whatsapp_messages_recherche;
drop trigger if exists taches_whatsapp_lien on taches;
drop function if exists taches_whatsapp_lien();
drop index if exists taches_whatsapp_conversation;
alter table taches drop column if exists whatsapp_conversation_id;
-- La règle de la migration 61 : la conversation WhatsApp rangée dans l'entreprise de la conversation de l'Assistant.
create or replace function agent_whatsapp_lisible() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.whatsapp_conversation_id is not null and (tg_op = 'INSERT' or new.whatsapp_conversation_id is distinct from old.whatsapp_conversation_id) then
    if auth.uid() is not null and not exists (select 1 from whatsapp_conversations c where c.id = new.whatsapp_conversation_id and c.entite_id = new.entite_id and whatsapp_lit(c.entite_id, c.organisation_id)) then
      raise exception 'Conversation WhatsApp introuvable.' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
commit;
