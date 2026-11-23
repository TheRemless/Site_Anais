-- Gestion : migration 119 (23.11.2026), corriger une commission ou le prix et la commission depuis À encaisser > Commissions.
-- À exécuter une seule fois, APRÈS la migration 118 (et les 115, 116). Idempotente. Ne modifie aucune donnée existante.
-- Retour en arrière : retour-119-corriger-commission.sql.
--
-- Jérémy (23.11.2026) : hier, une commission a dû être baissée parce que le client a obtenu un remboursement partiel. Il y aura toujours des cas
-- spéciaux où il faut monter ou baisser une commission, voire le prix de la prestation.
--
-- 1. Colonnes de reservations_nets (mêmes politiques que les nets : jamais lues par Mook ni par le partenaire) :
--    commission_avant_correction, prix_avant_correction : les montants d'avant la dernière correction ;
--    commission_apres_correction : le montant posé par la correction. Si la commission prévue en diffère, elle a été modifiée depuis ailleurs :
--      l'écran le dit, et la règle du partenaire peut de nouveau la recalculer ;
--    commission_corrigee_le, commission_corrigee_motif, commission_corrigee_note : quand et pourquoi (motif obligatoire, note pour « autre ») ;
--    commission_soldee_par_correction : la correction a soldé le service (nouvelle commission égale au déjà reçu, ou 0 sans rien de reçu).
-- 2. corriger_commission(...) : toute la correction dans une seule transaction. Elle verrouille la ligne, refuse si la commission prévue, la
--    commission reçue ou le prix ont changé depuis l'ouverture de la feuille (un encaissement noté entre-temps n'est jamais écrasé), recontrôle
--    tout (droits, entreprise, montants, motif), écrit les nets puis le prix (le déclencheur de la migration 32 ne recalcule donc pas la commission
--    entre les deux) et les documents du dossier que l'écran lui passe (la facture qui suit le prix). Elle ne réécrit jamais commission_recue.
-- 3. partenaire_saisir_commission et partenaire_courses : Mr. Brown ne modifie plus une commission corrigée, même au montant qu'il avait saisi.
-- Le journal des nets (migration 37) et celui des réservations gardent chaque avant et après.

begin;

alter table reservations_nets add column if not exists commission_avant_correction numeric(12, 2);
alter table reservations_nets add column if not exists prix_avant_correction numeric(12, 2);
alter table reservations_nets add column if not exists commission_apres_correction numeric(12, 2);
alter table reservations_nets add column if not exists commission_corrigee_le timestamptz;
alter table reservations_nets add column if not exists commission_corrigee_motif text;
alter table reservations_nets add column if not exists commission_corrigee_note text;
alter table reservations_nets add column if not exists commission_soldee_par_correction boolean not null default false;

alter table reservations_nets drop constraint if exists reservations_nets_commission_corrigee_motif_check;
alter table reservations_nets add constraint reservations_nets_commission_corrigee_motif_check check (
  commission_corrigee_motif is null or commission_corrigee_motif in ('remboursement_partiel', 'geste_commercial', 'erreur_saisie', 'autre')
);
alter table reservations_nets drop constraint if exists reservations_nets_commission_corrigee_check;
alter table reservations_nets add constraint reservations_nets_commission_corrigee_check check (
  commission_corrigee_le is null
  or (commission_corrigee_motif is not null
      and (commission_corrigee_motif <> 'autre' or length(btrim(coalesce(commission_corrigee_note, ''))) > 0)
      and length(coalesce(commission_corrigee_note, '')) <= 200)
);
comment on column reservations_nets.commission_avant_correction is 'Commission prévue avant la dernière correction (migration 119). Le journal des nets garde toutes les corrections.';
comment on column reservations_nets.prix_avant_correction is 'Prix de vente avant la dernière correction du prix et de la commission (migration 119), vide si seule la commission a changé.';
comment on column reservations_nets.commission_apres_correction is 'Commission posée par la dernière correction (migration 119). Différente de commission_prevue : modifiée depuis.';
comment on column reservations_nets.commission_corrigee_le is 'Moment de la dernière correction de la commission par l''équipe (migration 119). Le partenaire chauffeur ne la modifie plus.';
comment on column reservations_nets.commission_corrigee_motif is 'Motif de la dernière correction : remboursement_partiel, geste_commercial, erreur_saisie, autre (migration 119).';
comment on column reservations_nets.commission_corrigee_note is 'Note courte de la correction, obligatoire pour « autre » (migration 119).';
comment on column reservations_nets.commission_soldee_par_correction is 'Le service a été soldé par une correction, pas par un versement (migration 119).';

-- La correction, en une transaction. `p_prix` vide : la commission seule. `p_lu` : { commission_prevue, commission_recue, montant_vente } tels que
-- la feuille les a lus. `p_documents` : [{ id, updated_at, contenu }], les documents du dossier qui suivent le nouveau prix (contenu sans nets).
-- Les refus portent un code lisible par l'écran : « corriger_commission:<code> ».
create or replace function corriger_commission(
  p_reservation uuid, p_entite uuid, p_commission numeric, p_prix numeric, p_motif text, p_note text, p_lu jsonb, p_documents jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  r reservations%rowtype;
  n reservations_nets%rowtype;
  d jsonb;
  doc documents%rowtype;
  recu numeric;
  prix_final numeric;
  prix_change boolean;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  solde boolean;
  docs_ecrits jsonb := '[]'::jsonb;
begin
  select * into r from reservations where id = p_reservation for update;
  if r.id is null then raise exception 'corriger_commission:introuvable'; end if;
  if p_entite is null or r.entite_id <> p_entite then raise exception 'corriger_commission:entite' using errcode = '42501'; end if;
  if not (a_permission(r.entite_id, 'partenaires.nets') and a_permission(r.entite_id, 'dossiers.ecrire')) then
    raise exception 'corriger_commission:droits' using errcode = '42501';
  end if;
  select * into n from reservations_nets where reservation_id = r.id for update;
  -- Sans la lecture de la feuille (objet avec les trois montants, même vides), rien ne prouve qu'on corrige la ligne vue : refus.
  if p_lu is null or jsonb_typeof(p_lu) <> 'object' or not (p_lu ? 'commission_prevue' and p_lu ? 'commission_recue' and p_lu ? 'montant_vente') then
    raise exception 'corriger_commission:lecture_manquante';
  end if;
  -- Ce que la feuille a lu doit être encore vrai : sinon un encaissement, une saisie ou un prix changé entre-temps serait écrasé.
  if (n.commission_prevue is distinct from (p_lu->>'commission_prevue')::numeric)
     or (n.commission_recue is distinct from (p_lu->>'commission_recue')::numeric)
     or (r.montant_vente is distinct from (p_lu->>'montant_vente')::numeric) then
    raise exception 'corriger_commission:change';
  end if;
  if n.commission_recue_le is not null then raise exception 'corriger_commission:reglee'; end if;
  if p_commission is null or p_commission < 0 or p_commission <> round(p_commission, 2) then raise exception 'corriger_commission:commission'; end if;
  if p_prix is not null and (p_prix <= 0 or p_prix <> round(p_prix, 2)) then raise exception 'corriger_commission:prix'; end if;
  recu := coalesce(n.commission_recue, 0);
  if p_commission < recu then raise exception 'corriger_commission:sous_recu'; end if;
  prix_final := coalesce(p_prix, r.montant_vente);
  if prix_final is not null and p_commission > prix_final then raise exception 'corriger_commission:au_dessus_prix'; end if;
  prix_change := p_prix is not null and p_prix is distinct from r.montant_vente;
  if n.commission_prevue is not distinct from p_commission and not prix_change then raise exception 'corriger_commission:inchange'; end if;
  if p_motif is null or p_motif not in ('remboursement_partiel', 'geste_commercial', 'erreur_saisie', 'autre') then raise exception 'corriger_commission:motif'; end if;
  if p_motif = 'autre' and note is null then raise exception 'corriger_commission:note'; end if;
  if length(coalesce(note, '')) > 200 then raise exception 'corriger_commission:note'; end if;
  if jsonb_typeof(coalesce(p_documents, '[]'::jsonb)) <> 'array' then raise exception 'corriger_commission:documents'; end if;
  if jsonb_array_length(coalesce(p_documents, '[]'::jsonb)) > 0 and (not prix_change or not a_permission(r.entite_id, 'documents.ecrire')) then
    raise exception 'corriger_commission:documents' using errcode = '42501';
  end if;
  solde := p_commission = recu;

  -- 1. Les nets d'abord : commission_prevue_auto vidée, le déclencheur de la migration 32 ne touchera plus cette commission.
  if n.id is null then
    insert into reservations_nets (entite_id, reservation_id) values (r.entite_id, r.id) returning * into n;
  end if;
  update reservations_nets set
    commission_prevue = p_commission,
    commission_prevue_auto = null,
    commission_avant_correction = n.commission_prevue,
    prix_avant_correction = case when prix_change then r.montant_vente end,
    commission_apres_correction = p_commission,
    commission_corrigee_le = now(),
    commission_corrigee_motif = p_motif,
    commission_corrigee_note = note,
    commission_partenaire = null,
    commission_partenaire_le = null,
    commission_recue_le = case when solde then coalesce(n.commission_partielle_le, (now() at time zone 'Asia/Bangkok')::date) end,
    commission_soldee_par_correction = solde
  where id = n.id
  returning * into n;

  -- 2. Le prix de la réservation, puis les documents qui le suivent : tout ou rien.
  if prix_change then
    update reservations set montant_vente = p_prix where id = r.id returning * into r;
  end if;
  for d in select * from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) loop
    select * into doc from documents where id = (d->>'id')::uuid for update;
    if doc.id is null or doc.dossier_id <> r.dossier_id or doc.entite_id <> r.entite_id or doc.type not in ('facture', 'facture_locale', 'devis') then
      raise exception 'corriger_commission:documents' using errcode = '42501';
    end if;
    if doc.updated_at is distinct from (d->>'updated_at')::timestamptz then raise exception 'corriger_commission:change'; end if;
    if jsonb_typeof(d->'contenu') <> 'object' then raise exception 'corriger_commission:documents'; end if;
    update documents set contenu = d->'contenu', updated_at = now() where id = doc.id returning * into doc;
    docs_ecrits := docs_ecrits || jsonb_build_object('id', doc.id, 'updated_at', doc.updated_at);
  end loop;

  return jsonb_build_object('nets', to_jsonb(n), 'reservation', jsonb_build_object('id', r.id, 'montant_vente', r.montant_vente, 'updated_at', to_jsonb(r)->'updated_at'), 'documents', docs_ecrits, 'solde', solde);
end
$$;
revoke all on function corriger_commission(uuid, uuid, numeric, numeric, text, text, jsonb, jsonb) from public, anon;
grant execute on function corriger_commission(uuid, uuid, numeric, numeric, text, text, jsonb, jsonb) to authenticated;

-- La fonction de la migration 115, avec un refus de plus : une commission corrigée par l'équipe.
create or replace function partenaire_saisir_commission(p_reservation uuid, p_montant numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  r reservations%rowtype;
  n reservations_nets%rowtype;
begin
  if not exists (select 1 from partenaire_acces_actuel()) then raise exception 'Accès refusé.' using errcode = '42501'; end if;
  if not exists (select 1 from partenaire_courses() x where x.id = p_reservation) then raise exception 'Course introuvable.' using errcode = '42501'; end if;
  select * into r from reservations where id = p_reservation for update;
  select * into n from reservations_nets where reservation_id = p_reservation for update;
  if n.id is not null and (n.commission_recue_le is not null or coalesce(n.commission_recue, 0) <> 0) then
    raise exception 'Commission déjà payée : elle ne se modifie plus.';
  end if;
  -- Corrigée par Nani ou l'équipe (migration 119) : la correction l'emporte, même si son montant égale celui que le partenaire avait saisi.
  if n.id is not null and n.commission_corrigee_le is not null then
    raise exception 'Commission corrigée par l''équipe : elle ne se modifie pas ici.';
  end if;
  if n.id is not null and n.commission_prevue is not null and n.commission_prevue is distinct from n.commission_partenaire then
    raise exception 'Commission déjà posée par l''équipe : elle ne se modifie pas ici.';
  end if;
  if p_montant is not null then
    if p_montant <= 0 then raise exception 'Montant nul ou négatif.'; end if;
    if p_montant <> round(p_montant, 2) then raise exception 'Montant à deux décimales au plus.'; end if;
    if p_montant > coalesce(r.montant_vente, 10000) then raise exception 'Commission plus élevée que le prix de la course.'; end if;
  end if;
  if n.id is null then
    if p_montant is null then return null; end if;
    insert into reservations_nets (entite_id, reservation_id, commission_prevue, commission_partenaire, commission_partenaire_le) values (r.entite_id, r.id, p_montant, p_montant, now());
  elsif n.commission_prevue is distinct from p_montant or n.commission_partenaire is distinct from p_montant then
    update reservations_nets set commission_prevue = p_montant, commission_partenaire = p_montant, commission_partenaire_le = case when p_montant is null then null else now() end where id = n.id;
  end if;
  return p_montant;
end
$$;
revoke all on function partenaire_saisir_commission(uuid, numeric) from public, anon;
grant execute on function partenaire_saisir_commission(uuid, numeric) to authenticated;

-- La liste de la migration 116, avec une condition de plus pour « modifiable » : aucune correction de Nani.
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

commit;
