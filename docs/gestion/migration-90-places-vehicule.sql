-- Gestion : migration 90, nombre de personnes au plus par véhicule sur un tarif (bouton « Calculer le devis », 22.11.2026). Suit la 73.
--
-- But : le devis compte les véhicules (11 personnes, 9 places par minivan = 2 minivans). Le catalogue n'avait pas de capacité structurée :
-- les transferts au véhicule n'ont au mieux qu'une remarque libre (une tranche de prix, un billet de ferry) et les excursions un texte
-- « Capacité » (details.capacite) imprimé sur le voucher. Aucun des deux n'est lu pour compter des véhicules : on ne devine pas.
--   prestations.places_vehicule : entier de 1 à 60, vide par défaut. Vide = capacité à renseigner, le devis ne compte pas les véhicules
--   d'un tarif au véhicule ou au bateau et renvoie vers le tarif. Saisi dans la fiche du tarif (Partenaires), avec les mêmes droits que le
--   reste de la fiche (politiques et déclencheurs existants de prestations, journal compris). Ce n'est pas un prix : le verrou des prix de
--   vente (migration 38) ne le regarde pas. Rien sur les nets.
--
-- À exécuter une seule fois, AVANT de déployer l'écran de cette PR (sinon une capacité saisie ne s'enregistre pas). Ne modifie aucune ligne.
-- Se rejoue sans effet.
-- Retour en arrière : docs/gestion/retour-90-places-vehicule.sql.
-- Contrôle :
--   select column_name, data_type, is_nullable from information_schema.columns where table_name = 'prestations' and column_name = 'places_vehicule';
--   select count(*) filter (where places_vehicule is null), count(*) from prestations where unite in ('veh', 'boat') and actif;

begin;

alter table prestations add column if not exists places_vehicule integer;
alter table prestations drop constraint if exists prestations_places_vehicule_check;
alter table prestations add constraint prestations_places_vehicule_check check (places_vehicule is null or places_vehicule between 1 and 60);
comment on column prestations.places_vehicule is 'Personnes au plus par véhicule ou par bateau (devis). Vide : à renseigner.';

commit;
