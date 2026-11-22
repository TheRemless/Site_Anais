-- Retour en arrière de la migration 105 (étapes des conversations WhatsApp de clients).
-- Les faits de la fonction et les étapes choisies par Nani partent ; aucun message, aucun dossier n'est touché. Sans les colonnes, l'écran
-- revient à l'ancienne liste et la fonction « whatsapp » n'écrit plus que pret_reserver (erreur de colonne absente ignorée).
-- Avant (lecture seule) :
--   select count(avancee) faits, count(etape_manuelle) manuelles from whatsapp_conversations;
begin;

drop trigger if exists whatsapp_etape_outil on whatsapp_conversations;
drop function if exists whatsapp_etape_outil();
revoke update (etape_manuelle, ia_coupee) on whatsapp_conversations from authenticated;
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_etape_manuelle_check;
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_avancee_check;
alter table whatsapp_conversations drop column if exists etape_manuelle;
alter table whatsapp_conversations drop column if exists ia_coupee;
alter table whatsapp_conversations drop column if exists avancee;

commit;
