-- Gestion : retour en arrière de la migration 129. Le contrôle du téléphone d'un client par la base est retiré (l'outil garde le sien).
begin;
drop trigger if exists controler_telephone_client on clients;
drop function if exists controler_telephone_client();
commit;
