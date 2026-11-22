-- Retour en arrière de la migration 118 : la liste blanche des champs du partenaire chauffeur redevient celle de la migration 116
-- (sans sieges_bebe ni sans_siege). À lancer AVANT de republier une version de l'outil d'avant la 118. Aucune donnée n'est touchée.
begin;

create or replace function partenaire_champs_details() returns text[] language sql immutable set search_path = public as $$
  select array[
    'type_trajet', 'drop_off', 'programme_trajet', 'duree_h', 'vol', 'bagages', 'sieges', 'type_transfert', 'remarques',
    'hotel', 'chambre', 'retour_date', 'retour_heure', 'retour_lieu', 'embarquement', 'pickup_zone'
  ]::text[]
$$;
revoke all on function partenaire_champs_details() from public, anon, authenticated;

commit;
