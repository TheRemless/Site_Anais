-- Retour en arrière de la migration 85 (filtre « Prêt à réserver » de l'écran WhatsApp).
-- Les décisions de la fonction et les retraits de Nani partent ; aucun message, aucun dossier n'est touché. Sans les colonnes, l'écran
-- n'affiche plus le filtre et la fonction « whatsapp » n'écrit plus rien (erreur de colonne absente ignorée).
-- Avant (lecture seule) :
--   select pret_reserver->>'pret' pret, count(*), count(pret_retire_le) retirees from whatsapp_conversations group by 1;
begin;

drop trigger if exists whatsapp_pret_outil on whatsapp_conversations;
drop function if exists whatsapp_pret_outil();
revoke update (pret_retire_le) on whatsapp_conversations from authenticated;
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_pret_check;
alter table whatsapp_conversations drop column if exists pret_retire_le;
alter table whatsapp_conversations drop column if exists pret_reserver;

commit;
