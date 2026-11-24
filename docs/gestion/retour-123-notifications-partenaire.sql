-- Gestion : retour en arrière de la migration 123 (notifications du partenaire chauffeur).
-- Retire les empreintes, les envois notés et les fonctions de la notification ; rend partenaire_acces_actuel() (migration 115) et
-- partenaire_courses() (migration 119) dans leur forme d'avant. L'écran du partenaire voit exactement les mêmes courses.
-- Redéployer aussi la fonction « rappels » d'avant (sans partenaire.js) : la nouvelle échouerait sur les fonctions absentes, sans gêner les envois
-- aux membres (le passage des partenaires est à part).

begin;

drop function if exists partenaire_notifs_changements(interval);
drop function if exists partenaire_notif_courses(uuid);
drop function if exists partenaire_notif_empreinte(jsonb);
drop table if exists partenaires_notifs_courses;
drop table if exists partenaires_notifs_etat;
drop table if exists partenaires_notifs_envois;

create or replace function partenaire_acces_actuel() returns table (partenaire_id uuid, entite_id uuid, jour date)
language sql stable security definer set search_path = public as $$
  select a.partenaire_id, pa.entite_id, (now() at time zone coalesce(nullif(o.fuseau, ''), 'Asia/Bangkok'))::date
  from partenaires_acces a
  join profils pr on pr.user_id = a.user_id
  join partenaires pa on pa.id = a.partenaire_id
  join entites e on e.id = pa.entite_id
  join reglages g on g.entite_id = e.id
  left join organisations o on o.id = e.organisation_id
  where a.user_id = auth.uid()
    and pr.actif and not pr.super_admin and not coalesce((to_jsonb(pr)->>'plateforme')::boolean, false)
    and pr.organisation_id = e.organisation_id
    and e.actif and coalesce(pa.actif, true)
    and g.valeur->>'fonctionnement' = 'taxi'
    and not exists (select 1 from membres m where m.user_id = a.user_id)
  limit 1
$$;
revoke all on function partenaire_acces_actuel() from public, anon, authenticated;

-- La liste de la migration 119.
drop function if exists partenaire_courses();
create function partenaire_courses() returns table (
  id uuid, date_service date, heure text, pickup text, dropoff text, retour boolean, programme text,
  adultes integer, enfants integer, bebes integer, client text, telephone text, vol text, prix numeric,
  commission numeric, commission_payee numeric, reglee boolean, par_moi boolean, modifiable boolean,
  ref text, reference_partenaire text, libelle text, service text, vehicules numeric, adresse_client text, details jsonb,
  paiement text, a_encaisser numeric
)
language sql stable security definer set search_path = public as $$
  select r.id, r.date_service, r.heure_pickup, r.lieu_pickup,
    coalesce(r.details->>'drop_off', ''), coalesce(r.details->>'type_trajet', '') = 'retour_depart', coalesce(r.details->>'programme_trajet', ''),
    coalesce(nombre_json(r.personnes->'adultes'), 0)::integer, coalesce(nombre_json(r.personnes->'enfants'), 0)::integer, coalesce(nombre_json(r.personnes->'bebes'), 0)::integer,
    trim(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, '')), coalesce(c.telephone, ''), coalesce(r.details->>'vol', ''), r.montant_vente,
    n.commission_prevue, n.commission_recue, n.commission_recue_le is not null,
    coalesce(n.commission_prevue = n.commission_partenaire, false),
    -- Modifiable : rien de payé, aucune commission posée par l'équipe, et aucune correction de Nani (migration 119).
    n.commission_recue_le is null and coalesce(n.commission_recue, 0) = 0 and n.commission_corrigee_le is null
      and (n.commission_prevue is null or coalesce(n.commission_prevue = n.commission_partenaire, false)),
    d.ref,
    -- Sa référence : seulement sur une course qui lui est confiée (jamais celle d'un autre prestataire).
    case when r.partenaire_id = a.partenaire_id then coalesce(r.reference_partenaire, '') else '' end,
    r.libelle, coalesce(p.groupe, ''),
    -- Le nombre de véhicules : sur le seul document qui fait foi (la dernière facture, sinon le dernier devis, comme recalculer_dossier de la
    -- migration 19), jamais la somme du devis et de la facture.
    coalesce((
      select sum(coalesce(nombre_json(l->'qte'), 1))
      from jsonb_array_elements(case when jsonb_typeof(doc.contenu->'lignes') = 'array' then doc.contenu->'lignes' else '[]'::jsonb end) l
      where (l->>'id' = r.ligne_id or coalesce(r.details->'lignes_ids', '[]'::jsonb) ? (l->>'id'))
        and coalesce(nullif(l->>'par', ''), p.unite, '') = 'veh'
    ), 1),
    case when c.entite_id = r.entite_id then split_part(coalesce(c.adresse, ''), E'\n', 1) else '' end,
    -- La zone de prise en charge est gardée comme { zone, grille, depart } (pickup-calc.mjs) : seul le nom de la zone sort, jamais la grille
    -- (tarifs d'un prestataire). Une valeur ni texte ni objet ne sort pas.
    (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
       select e.k, case when e.k <> 'pickup_zone' then e.v
                        when jsonb_typeof(e.v) = 'object' and jsonb_typeof(e.v->'zone') = 'string' then e.v->'zone'
                        when jsonb_typeof(e.v) = 'string' then e.v end as v
       from jsonb_each(coalesce(r.details, '{}'::jsonb)) as e(k, v) where e.k = any (partenaire_champs_details())
     ) x where x.v is not null),
    -- Ce que le chauffeur encaisse (revue de sécurité) : un montant seulement quand il est sûr. Payé sur place : le prix de la course ; tout payé :
    -- rien ; un acompte et une seule course réglée d'avance dans le dossier : le reste dû. Un acompte réparti sur plusieurs courses du dossier
    -- (aller et retour) n'est pas deviné : « acompte_partage », le chauffeur demande le montant à Nani.
    case when r.paye_sur_place then 'sur_place'
         when coalesce(s.total, 0) > 0 and coalesce(s.recu, 0) >= s.total then 'paye'
         when coalesce(s.recu, 0) > 0 and av.n > 1 then 'acompte_partage'
         when coalesce(s.recu, 0) > 0 then 'acompte'
         else 'en_attente' end,
    case when r.paye_sur_place then r.montant_vente
         when coalesce(s.total, 0) > 0 and coalesce(s.recu, 0) >= s.total then 0
         when coalesce(s.recu, 0) > 0 and av.n > 1 then null
         when coalesce(s.recu, 0) > 0 then greatest(s.total - coalesce(s.sur_place, 0) - s.recu, 0)
         else null end
  from partenaire_acces_actuel() a
  join reservations r on r.entite_id = a.entite_id and (r.partenaire_id is null or r.partenaire_id = a.partenaire_id)
  join dossiers d on d.id = r.dossier_id and d.entite_id = r.entite_id
  -- Le client peut être une fiche partagée d'une autre entreprise (migration 46) : seuls son nom et son téléphone sortent.
  join clients c on c.id = d.client_id
  left join prestations p on p.id = r.prestation_id
  left join dossiers_resume s on s.dossier_id = d.id
  -- Le document qui fait foi pour le dossier : la dernière facture, sinon le dernier devis.
  left join lateral (
    select x.contenu from documents x where x.dossier_id = d.id and x.type in ('facture', 'devis')
    order by (x.type = 'facture') desc, x.date_emission desc, x.created_at desc limit 1
  ) doc on true
  -- Les courses du dossier réglées d'avance (ni annulées, ni payées sur place) : l'acompte se partage entre elles.
  cross join lateral (
    select count(*) as n from reservations y where y.dossier_id = d.id and y.statut <> 'annule' and not y.paye_sur_place
  ) av
  left join reservations_nets n on n.reservation_id = r.id
  where r.statut <> 'annule' and not d.annule and r.date_service is not null
    and ((r.date_service >= a.jour and r.date_service <= a.jour + 60)
      or (r.date_service < a.jour and n.commission_recue_le is null
          and (n.commission_prevue is null or n.commission_prevue - coalesce(n.commission_recue, 0) > 0)))
  order by r.date_service, r.heure_pickup, r.created_at
$$;
revoke all on function partenaire_courses() from public, anon;
grant execute on function partenaire_courses() to authenticated;

drop function if exists partenaire_courses_de(uuid);
drop function if exists partenaire_acces_de(uuid);

commit;
