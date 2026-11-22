-- Retour en arrière de la migration 115 (accès partenaire chauffeur). Les commissions déjà saisies par le partenaire restent dans
-- reservations_nets (ce sont des commissions prévues comme les autres) ; seul l'accès disparaît. Le compte reste, sans accès à rien.
begin;
drop function if exists partenaire_saisir_commission(uuid, numeric);
drop function if exists partenaire_courses();
drop function if exists partenaire_mon_acces();
drop function if exists partenaire_acces_actuel();
drop trigger if exists refuser_membre_partenaire on membres;
drop function if exists refuser_membre_partenaire();
drop table if exists partenaires_acces;
drop function if exists verifier_acces_partenaire();
commit;
