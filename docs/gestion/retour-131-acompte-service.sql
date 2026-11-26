-- Gestion : retour en arrière de la migration 131. Les paiements ne sont plus rattachés à un service (la colonne est retirée) ; le résumé
-- du dossier et l'écran du chauffeur reprennent leurs fonctions des migrations 19 et 123.
begin;
drop trigger if exists recalculer_dossier_paiement_service on reservations;
drop function if exists recalculer_dossier_paiement_service();
drop trigger if exists controler_paiement_service on paiements;
drop function if exists controler_paiement_service();
alter table paiements drop constraint if exists paiements_reservation_fk;
drop index if exists paiements_reservation_idx;
alter table paiements drop column if exists reservation_id;
create or replace function recalculer_dossier(did uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  ent uuid;
  f jsonb;
  v jsonb;
  ve date;
begin
  select entite_id into ent from dossiers where id = did;
  if ent is null then return; end if;
  select contenu into f from documents where dossier_id = did and type = 'facture' order by date_emission desc, created_at desc limit 1;
  select contenu, envoye_le into v, ve from documents where dossier_id = did and type = 'devis' order by date_emission desc, created_at desc limit 1;
  update dossiers set devis_envoye_le = ve, a_facture = (f is not null)
  where id = did and (devis_envoye_le is distinct from ve or a_facture is distinct from (f is not null));
  insert into dossiers_resume (dossier_id, entite_id, total, devise, recu, sur_place)
  values (did, ent, coalesce(total_document(coalesce(f, v)), 0), coalesce(f, v)->>'devise', (select coalesce(sum(montant), 0) from paiements where dossier_id = did), coalesce(montant_sur_place(coalesce(f, v)), 0))
  on conflict (dossier_id) do update set total = excluded.total, devise = excluded.devise, recu = excluded.recu, sur_place = excluded.sur_place;
end
$$;

create or replace function partenaire_courses_de(p_user uuid) returns table (
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
  from partenaire_acces_de(p_user) a
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
revoke all on function partenaire_courses_de(uuid) from public, anon, authenticated;
select recalculer_dossier(id) from dossiers;
commit;
