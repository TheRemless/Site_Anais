-- Gestion : migration 131 (26.11.2026), l'acompte d'un dossier et ses services payés sur place. L'argent reste au DOSSIER (décision de
-- Jérémy) : aucun paiement n'est rattaché à un service. La base répartit le reçu et range le résultat dans le résumé du dossier, que l'outil
-- lit, que le dossier soit ouvert ou non.
-- À exécuter une seule fois, après la migration 128, avec l'outil du même commit. Idempotente. Aucune donnée saisie n'est modifiée : seul le
-- résumé calculé (dossiers_resume) des dossiers qui ont un service payé sur place est recalculé à la fin.
-- Retour en arrière : retour-131-acompte-service.sql.
--
-- Avant : un acompte encaissé pour un service payé sur place n'apparaissait sur aucun voucher ni pour le prestataire.
-- Règle (recalculer_dossier) :
--   1. le reçu net du dossier (paiements moins remboursements) couvre d'abord ce qui est dû chez nous (`total`, services non payés sur place) ;
--   2. le reste s'impute aux services payés sur place non annulés, par date de service puis ordre de création, chacun jusqu'à son prix :
--      `parts` = { "<réservation>": { "verse": …, "reste": … } } ; un même montant n'est jamais compté pour deux services ;
--   3. un service annulé ne reçoit rien ; ce qui dépasse est `a_rembourser` quand le dossier a une annulation (un service annulé ou le
--      dossier annulé), sinon `trop_percu`. Un remboursement saisi baisse le reçu : l'alerte disparaît, aucun reste ne devient négatif ;
--   4. le résumé suit les paiements et les documents (migration 19) et maintenant les services (prix, mode de règlement, statut, date) ;
--   5. deux écritures simultanées sur un même dossier se suivent : le dossier est verrouillé (for update) avant le calcul.
-- L'écran du chauffeur (partenaire_courses_de) lit la part de SA course.
begin;

alter table dossiers_resume add column if not exists parts jsonb not null default '{}'::jsonb;
alter table dossiers_resume add column if not exists a_rembourser numeric not null default 0;
alter table dossiers_resume add column if not exists trop_percu numeric not null default 0;

create or replace function recalculer_dossier(did uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  ent uuid;
  dos_annule boolean;
  f jsonb;
  v jsonb;
  ve date;
  t numeric;
  rc numeric;
  libre numeric;
  pr numeric;
  vs numeric;
  pts jsonb := '{}'::jsonb;
  annulation boolean;
  x record;
begin
  -- Écritures concurrentes : un seul calcul à la fois par dossier ; les lectures suivantes voient ce que l'autre a validé.
  select entite_id, annule into ent, dos_annule from dossiers where id = did for update;
  if ent is null then return; end if;
  select contenu into f from documents where dossier_id = did and type = 'facture' order by date_emission desc, created_at desc limit 1;
  select contenu, envoye_le into v, ve from documents where dossier_id = did and type = 'devis' order by date_emission desc, created_at desc limit 1;
  update dossiers set devis_envoye_le = ve, a_facture = (f is not null)
  where id = did and (devis_envoye_le is distinct from ve or a_facture is distinct from (f is not null));
  t := coalesce(total_document(coalesce(f, v)), 0);
  rc := (select coalesce(sum(montant), 0) from paiements where dossier_id = did);
  libre := greatest(rc - greatest(t, 0), 0);
  for x in select r.id, round(r.montant_vente, 2) as prix from reservations r
           where r.dossier_id = did and r.paye_sur_place and r.statut <> 'annule' and coalesce(r.montant_vente, 0) > 0
           order by r.date_service nulls last, r.created_at, r.id loop
    vs := least(x.prix, libre);
    libre := libre - vs;
    pts := pts || jsonb_build_object(x.id::text, jsonb_build_object('verse', vs, 'reste', x.prix - vs));
  end loop;
  annulation := coalesce(dos_annule, false) or exists (select 1 from reservations r where r.dossier_id = did and r.statut = 'annule');
  insert into dossiers_resume (dossier_id, entite_id, total, devise, recu, sur_place, parts, a_rembourser, trop_percu)
  values (did, ent, t, coalesce(f, v)->>'devise', rc, coalesce(montant_sur_place(coalesce(f, v)), 0), pts,
    case when annulation then libre else 0 end, case when annulation then 0 else libre end)
  on conflict (dossier_id) do update set total = excluded.total, devise = excluded.devise, recu = excluded.recu, sur_place = excluded.sur_place,
    parts = excluded.parts, a_rembourser = excluded.a_rembourser, trop_percu = excluded.trop_percu;
end
$$;

-- Un service qui change de prix, de mode de règlement, de statut, de date ou de dossier (ou qui arrive, ou qui part) : le résumé suit.
create or replace function recalculer_dossier_service() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.dossier_id is not null then perform recalculer_dossier(old.dossier_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and new.dossier_id is not null and (tg_op = 'INSERT' or new.dossier_id is distinct from old.dossier_id) then perform recalculer_dossier(new.dossier_id); end if;
  return null;
end
$$;
revoke all on function recalculer_dossier_service() from public, anon, authenticated;
drop trigger if exists recalculer_dossier_service on reservations;
create trigger recalculer_dossier_service after insert or delete or update of montant_vente, paye_sur_place, statut, date_service, dossier_id on reservations
  for each row execute function recalculer_dossier_service();

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
    --   Payé sur place : le prix, moins la part du reçu imputée à CETTE course (dossiers_resume.parts, recalculer_dossier).
    --   Réglée d'avance : comme avant, le reçu du dossier contre le total des courses réglées d'avance.
    case when r.paye_sur_place and coalesce(nombre_json(s.parts->(r.id::text)->'verse'), 0) > 0
           then case when coalesce(nombre_json(s.parts->(r.id::text)->'reste'), 0) > 0 then 'acompte' else 'paye' end
         when r.paye_sur_place then 'sur_place'
         when coalesce(s.total, 0) > 0 and coalesce(s.recu, 0) >= s.total then 'paye'
         when coalesce(s.recu, 0) > 0 and av.n > 1 then 'acompte_partage'
         when coalesce(s.recu, 0) > 0 then 'acompte'
         else 'en_attente' end,
    case when r.paye_sur_place and coalesce(nombre_json(s.parts->(r.id::text)->'verse'), 0) > 0 then greatest(coalesce(nombre_json(s.parts->(r.id::text)->'reste'), 0), 0)
         when r.paye_sur_place then r.montant_vente
         when coalesce(s.total, 0) > 0 and coalesce(s.recu, 0) >= s.total then 0
         when coalesce(s.recu, 0) > 0 and av.n > 1 then null
         -- dossiers_resume.total ne compte pas les services payés sur place (total_document) : rien à retirer de plus (avant : - sur_place).
         when coalesce(s.recu, 0) > 0 then greatest(s.total - s.recu, 0)
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


-- Les dossiers qui ont un service payé sur place : leur résumé reçoit ses parts.
select recalculer_dossier(x.dossier_id) from (select distinct dossier_id from reservations where paye_sur_place and dossier_id is not null) x;

commit;
