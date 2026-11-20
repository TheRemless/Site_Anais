-- Retour en arrière de la migration 64 (aperçu du dernier message WhatsApp). L'écran relit la liste sans ces colonnes.
begin;
drop trigger if exists apercu on whatsapp_messages;
drop function if exists whatsapp_apercu_message();
drop function if exists whatsapp_apercu(uuid);
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_dernier_texte_check;
alter table whatsapp_conversations drop column if exists dernier_texte, drop column if exists dernier_type, drop column if exists attend_depuis;
commit;
