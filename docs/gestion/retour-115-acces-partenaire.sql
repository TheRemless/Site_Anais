-- Retour en arrière de la migration 115 (accès partenaire chauffeur). Les commissions déjà saisies par le partenaire restent dans
-- reservations_nets (ce sont des commissions prévues comme les autres), avec leur marquage ; seul l'accès disparaît. Le compte reste, sans accès à rien.
begin;
drop function if exists partenaire_saisir_commission(uuid, numeric);
drop function if exists partenaire_courses();
drop function if exists partenaire_mon_acces();
drop function if exists partenaire_acces_actuel();
drop trigger if exists refuser_membre_partenaire on membres;
drop function if exists refuser_membre_partenaire();
drop table if exists partenaires_acces;
drop function if exists verifier_acces_partenaire();
-- Migration 116 : sa liste blanche part avec l'accès (partenaire_courses() est déjà retirée ci-dessus).
drop function if exists partenaire_champs_details();
-- Les colonnes du marquage restent (les montants saisis gardent leur trace) ; les retirer à la main si besoin :
-- alter table reservations_nets drop column commission_partenaire, drop column commission_partenaire_le;
commit;
