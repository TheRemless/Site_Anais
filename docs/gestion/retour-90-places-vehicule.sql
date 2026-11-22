-- Retour en arrière de la migration 90 (personnes au plus par véhicule sur un tarif).
-- Les capacités saisies sont perdues. L'écran doit revenir aussi : sans la colonne, le devis répond « capacité à renseigner » partout et
-- une fiche de tarif qui envoie places_vehicule ne s'enregistre plus.
-- Avant (lecture seule) :
--   select count(*) from prestations where places_vehicule is not null;
begin;

alter table prestations drop constraint if exists prestations_places_vehicule_check;
alter table prestations drop column if exists places_vehicule;

commit;
