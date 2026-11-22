-- Gestion : migration 118 (22.11.2026), sièges enfant ou bébé par type sur l'écran du partenaire chauffeur (Mr. Brown, VIP Taxi Lanta).
-- À exécuter une seule fois, APRÈS la migration 116. Idempotente. Ne modifie aucune donnée.
-- Retour en arrière : retour-118-sieges-par-type.sql (rend la liste de la migration 116).
--
-- Jérémy (22.11.2026) : « Quand il y a au moins un enfant, il faut préciser s'il faut un child ou un baby seat. S'il y a un enfant et qu'il ne
-- faut pas de siège, il faut le mettre aussi. » La réservation garde dans `details` (sieges-calc.mjs) :
--   * sieges : les sièges enfant (l'ancienne clé, déjà lue par le chauffeur) ;
--   * sieges_bebe : les sièges bébé ;
--   * sans_siege : true quand il ne faut aucun siège.
-- Seule la liste blanche des champs que le partenaire lit s'allonge de ces deux clés. partenaire_courses() ne change pas : elle lit déjà la
-- liste par partenaire_champs_details(). Aucun net, aucune note : deux nombres et un booléen.
-- Tenue à l'identique de CHAMPS_COURSE dans courses-partenaire-calc.mjs (verif-courses-partenaire-details.mjs compare les deux listes).
-- Attention : rejouer la migration 116 après celle-ci rend l'ancienne liste ; relancer alors la 118.

begin;

create or replace function partenaire_champs_details() returns text[] language sql immutable set search_path = public as $$
  select array[
    'type_trajet', 'drop_off', 'programme_trajet', 'duree_h', 'vol', 'bagages', 'sieges', 'sieges_bebe', 'sans_siege', 'type_transfert', 'remarques',
    'hotel', 'chambre', 'retour_date', 'retour_heure', 'retour_lieu', 'embarquement', 'pickup_zone'
  ]::text[]
$$;
revoke all on function partenaire_champs_details() from public, anon, authenticated;

commit;
