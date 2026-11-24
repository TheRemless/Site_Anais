-- Gestion : retour en arrière de la migration 128. partenaire_notif_courses reprend sa version de la migration 125 ; la fonction
-- frais_de_parc_libelle est retirée.
begin;

create or replace function partenaire_notif_courses(p_user uuid) returns table (
  id uuid, date_service date, heure text, pickup text, dropoff text, retour boolean, programme text,
  adultes integer, enfants integer, bebes integer, client text, libelle text, jour date, entite_id uuid
)
language sql stable security definer set search_path = public as $$
  select c.id, c.date_service, coalesce(c.heure, ''), coalesce(c.pickup, ''), c.dropoff, c.retour, c.programme,
    c.adultes, c.enfants, c.bebes, c.client, coalesce(c.libelle, ''), a.jour, a.entite_id
  from partenaire_acces_de(p_user) a
  cross join lateral partenaire_courses_de(p_user) c
  join reservations r on r.id = c.id
  left join prestations p on p.id = r.prestation_id
  where c.date_service >= a.jour
    -- Frais de parc (une somme payée sur l'île, pas une course) : une prestation de la famille « frais », ou, sans partenaire, un libellé qui
    -- CONTIENT un frais (« Koh Rok park fee », « Frais d'entrée du parc », « Park entrance fee »). Même règle que estFraisDeParc des membres
    -- (FRAIS_PARC, operations-calc.mjs et rappels/calc.js, un test compare les trois). Une course qui nomme seulement un parc
    -- (« Hotel → Mu Ko Lanta National Park ») reste une course (relecture du 24.11.2026).
    and coalesce(p.famille, '') <> 'frais'
    and not (r.partenaire_id is null and coalesce(r.libelle, '') ~* 'frais (de|du) parc|frais d[''’]entr[ée]e|park (entrance )?fees?|entrance fees?|droits? (d[''’]entr[ée]e|(de|du) parc)')
  order by c.date_service, c.heure
$$;
revoke all on function partenaire_notif_courses(uuid) from public, anon, authenticated;

drop function if exists frais_de_parc_libelle(text);

commit;
