-- Retour en arrière de la migration 110 (type du contact compris par le sens de la conversation).
-- Les décisions du tri, les repères et la source du type partent ; les types restent. Un type déduit reste « partenaire » : à revoir à la
-- main avant le retour (requête ci-dessous). Les anciennes valeurs « chauffeur » et « hotel » ne reviennent pas (la contrainte les accepte de
-- nouveau, comme la migration 68). Sans les colonnes, la fonction « whatsapp » n'écrit plus que pret_reserver et avancee (erreur de colonne
-- absente ignorée) et l'écran ne montre plus « Partenaire déduit ».
-- Avant (lecture seule) :
--   select id, nom, type_contact from whatsapp_conversations where type_source = 'deduit';
begin;

drop trigger if exists whatsapp_type_source on whatsapp_conversations;
drop function if exists whatsapp_type_source();
revoke update (type_source) on whatsapp_conversations from authenticated;
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_type_source_check;
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_type_avis_check;
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_type_signaux_check;
alter table whatsapp_conversations drop column if exists type_source;
alter table whatsapp_conversations drop column if exists type_avis;
alter table whatsapp_conversations drop column if exists type_signaux;
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_type_contact_check;
alter table whatsapp_conversations add constraint whatsapp_conversations_type_contact_check check (type_contact is null or type_contact in ('client', 'apporteur', 'partenaire', 'chauffeur', 'hotel'));

commit;
