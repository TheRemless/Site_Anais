-- Gestion : migration 128 (24.11.2026), frais de parc : un libellé qui EST un frais, pas un libellé qui en parle.
-- À exécuter une seule fois, APRÈS la migration 125, avec la fonction « rappels » et l'outil du même commit. Idempotente. Ne modifie aucune donnée.
-- Retour en arrière : retour-128-frais-parc-libelle.sql (rend la fonction de la migration 125).
--
-- Revue de la PR 347 : le motif de la 125 reconnaissait « entrance fees? » ou « droits d'entrée » n'importe où dans le libellé. Une course Taxi
-- sans partenaire comme « Private taxi: Hotel → Tiger Cave Temple (entrance fee not included) » était prise pour un frais : pas de réservation
-- depuis la facture, pas de rappel, pas de notification au chauffeur.
-- Après : frais_de_parc_libelle(libelle) ne garde que la partie principale (avant une parenthèse ou une flèche) et n'y reconnaît un frais que si
-- elle COMMENCE par le mot-clé (« Frais d'entrée du parc », « National park fees: 4 Islands », « Entrance fee Koh Phi Phi »). Un mot-clé en fin
-- de libellé ne compte pas (« Private taxi to Emerald Pool and entrance fee », « Taxi Hotel - Tiger Cave Temple, entrance fee » : des courses).
-- Un frais nommé autrement (« Koh Rok park fee ») se reconnaît par la famille de sa prestation, « frais », comme avant. Même motif et même
-- découpe que libelleEstFrais de l'outil (operations-calc.mjs) et de la fonction rappels (calc.js) : un test compare les trois.
begin;

create or replace function frais_de_parc_libelle(p_libelle text) returns boolean
language sql immutable set search_path = public as $$
  with m as (select 'frais (de|du) parc|frais d[''’]entr[ée]e|(national )?park (entrance )?fees?|entrance fees?|droits? (d[''’]entr[ée]e|(de|du) parc)'::text as motif),
  q as (select btrim(regexp_replace(coalesce(p_libelle, ''), '(\(|→|->).*$', '')) as principal)
  select q.principal ~* ('^\s*(' || m.motif || ')')
  from m, q
$$;

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
    -- EST un frais (frais_de_parc_libelle, migration 128). Une mention entre parenthèses, après une flèche ou après « incl. », « with »… ne
    -- compte pas : « Private taxi: Hotel → Tiger Cave Temple (entrance fee not included) » reste une course notifiée.
    and coalesce(p.famille, '') <> 'frais'
    and not (r.partenaire_id is null and frais_de_parc_libelle(r.libelle))
  order by c.date_service, c.heure
$$;
revoke all on function partenaire_notif_courses(uuid) from public, anon, authenticated;

commit;
