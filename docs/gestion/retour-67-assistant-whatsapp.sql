-- Retour en arrière de la migration 67 (l'Assistant lit la boîte WhatsApp). L'agent garde ses outils WhatsApp : sans la fonction, la
-- recherche dans le texte des messages est sautée (nom, numéro, client et dossier se cherchent encore). Aucune donnée n'est touchée.
begin;
drop function if exists whatsapp_rechercher(text, integer);
drop index if exists whatsapp_messages_recherche;
commit;
