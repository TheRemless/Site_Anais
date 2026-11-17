-- Gestion : rattrapage de la migration 32. Remplit le net et la commission prévus des réservations existantes de Secret qui n'en ont pas.
-- À exécuter après la migration 32, seulement avec le oui de Jérémy.
--
-- Ne remplit que des valeurs vides, avec les règles du déclencheur (calculer_nets_reservation en mode « vides seulement ») :
--   * une valeur déjà présente (saisie par Anaïs, venue de la facture) ne change jamais ;
--   * un net payé, une commission reçue, un service ou un dossier annulé, Taxi et ZTP : rien ;
--   * une valeur qui ne se calcule pas (pas de tarif, pas de net au catalogue, pas de règle de commission) reste vide.
-- Relançable sans effet de bord : au deuxième passage il n'y a plus de valeur vide calculable, rien ne s'écrit (la colonne renvoie 0).

begin;

select count(*) filter (where calculer_nets_reservation(r.id, true)) as reservations_completees
from reservations r
join reglages g on g.entite_id = r.entite_id and g.valeur->>'fonctionnement' = 'excursions'
where r.statut <> 'annule';

commit;
