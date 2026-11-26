-- Gestion : retour en arrière de la migration 130. Les options redeviennent des prestations ordinaires (la colonne est retirée).
-- Les lignes de facture déjà rattachées (option_de dans le JSON des documents) restent rattachées à leur réservation.
begin;
drop trigger if exists retirer_option_supprimee on prestations;
drop trigger if exists controler_service_avec_options on prestations;
drop trigger if exists controler_option_prestation on prestations;
drop function if exists retirer_option_supprimee();
drop function if exists controler_service_avec_options();
drop function if exists controler_option_prestation();
drop index if exists prestations_option_de_idx;
alter table prestations drop column if exists option_de;
commit;
