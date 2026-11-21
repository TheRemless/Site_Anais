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
commit;
