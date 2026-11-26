-- Gestion : migration 131 (26.11.2026), un acompte rattaché à un service. Un paiement peut désigner le service qu'il paie
-- (`paiements.reservation_id`) : l'acompte d'un service payé sur place ne compte que sur SON voucher et pour SON prestataire.
-- À exécuter une seule fois, après la migration 128, avec l'outil du même commit. Idempotente. Ne modifie aucune donnée existante.
-- Retour en arrière : retour-131-acompte-service.sql.
--
-- Avant : un acompte encaissé pour un service payé sur place n'apparaissait nulle part pour le prestataire ; et, quand le dossier avait
-- plusieurs services sur place, rien ne disait lequel il payait.
-- Règles tenues par la base :
--   - `reservation_id` : un service du MÊME dossier (et donc de la même entreprise) ; un service supprimé laisse le paiement non rattaché.
--     La clé est vérifiée en fin de transaction : la restauration d'un dossier remet ses paiements avant ses réservations ;
--   - le résumé du dossier (`dossiers_resume.recu`, ce que doivent les services chez nous) ne compte plus un acompte rattaché à un service
--     payé sur place ; il est recalculé quand un service change de mode de règlement ;
--   - l'écran du chauffeur (partenaire_courses_de) : prix moins l'acompte rattaché à sa course, ou moins l'acompte non rattaché quand
--     c'est la seule course payée sur place du dossier ; plusieurs courses sur place et un acompte non rattaché : « acompte_partage »,
--     le chauffeur demande le montant. Un service annulé ne reçoit rien et ne transmet rien.
begin;

alter table paiements add column if not exists reservation_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'paiements_reservation_fk') then
    alter table paiements add constraint paiements_reservation_fk foreign key (reservation_id) references reservations (id) on delete set null deferrable initially deferred;
  end if;
end
$$;
create index if not exists paiements_reservation_idx on paiements (reservation_id) where reservation_id is not null;

create or replace function controler_paiement_service() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r reservations%rowtype;
begin
  if new.reservation_id is null then return new; end if;
  select * into r from reservations where id = new.reservation_id;
  -- Pas encore là (restauration d'un dossier) : la clé étrangère, vérifiée en fin de transaction, tranche.
  if r.id is null then return new; end if;
  if r.dossier_id <> new.dossier_id or r.entite_id <> new.entite_id then
    raise exception 'Le paiement doit être rattaché à un service de son dossier.' using errcode = '22023';
  end if;
  return new;
end
$$;
revoke all on function controler_paiement_service() from public, anon, authenticated;
drop trigger if exists controler_paiement_service on paiements;
create trigger controler_paiement_service before insert or update of reservation_id, dossier_id on paiements
  for each row execute function controler_paiement_service();

-- Le résumé du dossier : `recu` sans les acomptes rattachés à un service payé sur place (même fonction que la migration 19 sinon).
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
  values (did, ent, coalesce(total_document(coalesce(f, v)), 0), coalesce(f, v)->>'devise',
    (select coalesce(sum(p.montant), 0) from paiements p where p.dossier_id = did
       and not exists (select 1 from reservations z where z.id = p.reservation_id and z.paye_sur_place)),
    coalesce(montant_sur_place(coalesce(f, v)), 0))
  on conflict (dossier_id) do update set total = excluded.total, devise = excluded.devise, recu = excluded.recu, sur_place = excluded.sur_place;
end
$$;

-- Un service qui change de mode de règlement ou de statut : le résumé suit (seulement si un paiement lui est rattaché).
create or replace function recalculer_dossier_paiement_service() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from paiements p where p.reservation_id = new.id) then perform recalculer_dossier(new.dossier_id); end if;
  return new;
end
$$;
revoke all on function recalculer_dossier_paiement_service() from public, anon, authenticated;
drop trigger if exists recalculer_dossier_paiement_service on reservations;
create trigger recalculer_dossier_paiement_service after update of paye_sur_place, statut on reservations
  for each row when (old.paye_sur_place is distinct from new.paye_sur_place or old.statut is distinct from new.statut)
  execute function recalculer_dossier_paiement_service();

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
    -- Ce que le chauffeur encaisse (revue de sécurité, puis migration 131) : un montant seulement quand il est sûr.
    --   Payé sur place : le prix, moins l'acompte rattaché à CETTE course (paiements.reservation_id), ou moins l'acompte non rattaché quand
    --   c'est la seule course payée sur place du dossier ; plusieurs courses sur place et un acompte non rattaché : « acompte_partage ».
    --   Réglée d'avance : comme avant, l'argent non rattaché à une course sur place contre le total des courses réglées d'avance.
    case when r.paye_sur_place and pa.propre > 0 then case when pa.propre >= coalesce(r.montant_vente, 0) and coalesce(r.montant_vente, 0) > 0 then 'paye' else 'acompte' end
         when r.paye_sur_place and pa.libre - coalesce(s.total, 0) > 0 and sp.n = 1 then case when pa.libre - coalesce(s.total, 0) >= coalesce(r.montant_vente, 0) and coalesce(r.montant_vente, 0) > 0 then 'paye' else 'acompte' end
         when r.paye_sur_place and pa.libre - coalesce(s.total, 0) > 0 then 'acompte_partage'
         when r.paye_sur_place then 'sur_place'
         when coalesce(s.total, 0) > 0 and pa.libre >= s.total then 'paye'
         when pa.libre > 0 and av.n > 1 then 'acompte_partage'
         when pa.libre > 0 then 'acompte'
         else 'en_attente' end,
    case when r.paye_sur_place and pa.propre > 0 then greatest(coalesce(r.montant_vente, 0) - pa.propre, 0)
         when r.paye_sur_place and pa.libre - coalesce(s.total, 0) > 0 and sp.n = 1 then greatest(coalesce(r.montant_vente, 0) - (pa.libre - coalesce(s.total, 0)), 0)
         when r.paye_sur_place and pa.libre - coalesce(s.total, 0) > 0 then null
         when r.paye_sur_place then r.montant_vente
         when coalesce(s.total, 0) > 0 and pa.libre >= s.total then 0
         when pa.libre > 0 and av.n > 1 then null
         -- dossiers_resume.total ne compte pas les services payés sur place (total_document) : rien à retirer de plus (avant : - sur_place).
         when pa.libre > 0 then greatest(s.total - pa.libre, 0)
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
  -- Les paiements du dossier (migration 131) : rattachés à CETTE course, et non rattachés à une course payée sur place.
  cross join lateral (
    select coalesce(sum(pm.montant) filter (where pm.reservation_id = r.id), 0) as propre,
      coalesce(sum(pm.montant) filter (where pm.reservation_id is null or not exists (select 1 from reservations z where z.id = pm.reservation_id and z.paye_sur_place)), 0) as libre
    from paiements pm where pm.dossier_id = d.id
  ) pa
  cross join lateral (
    select count(*) as n from reservations y where y.dossier_id = d.id and y.statut <> 'annule' and y.paye_sur_place
  ) sp
  left join reservations_nets n on n.reservation_id = r.id
  where r.statut <> 'annule' and not d.annule and r.date_service is not null
    and ((r.date_service >= a.jour and r.date_service <= a.jour + 60)
      or (r.date_service < a.jour and n.commission_recue_le is null
          and (n.commission_prevue is null or n.commission_prevue - coalesce(n.commission_recue, 0) > 0)))
  order by r.date_service, r.heure_pickup, r.created_at
$$;
revoke all on function partenaire_courses_de(uuid) from public, anon, authenticated;

commit;
