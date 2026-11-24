-- Gestion : migration 123 (24.11.2026), notifications en thaï pour le partenaire chauffeur (Mr. Brown, VIP Taxi Lanta).
-- À exécuter une seule fois, APRÈS les migrations 115, 116 et 119, et AVANT de déployer la fonction « rappels » qui l'utilise. Idempotente.
-- Ne modifie aucune donnée existante. Retour en arrière : retour-123-notifications-partenaire.sql.
--
-- Trois notifications Web Push, en thaï, pour le compte partenaire (partenaires_acces), sur les seules courses que partenaire_courses() lui montre :
--   1. une course de sa liste créée, ou changée (date, heure de pickup, lieu de pickup, destination, personnes, annulation) : une seule
--      notification par rafale de modifications (empreinte gardée en base, envoyée quand elle n'a plus bougé depuis 10 minutes) ;
--   2. le soir, à l'heure du rappel de la veille de l'entreprise Taxi : ses courses de demain (heure et trajet, sans nom de client) ;
--   3. une heure avant chaque prise en charge, au passage « h1 » de la fonction rappels.
--
-- 1. Une seule règle. La fonction d'envoi lit avec la clé de service, sans auth.uid() : la règle de partenaire_acces_actuel() et de
--    partenaire_courses() passe dans partenaire_acces_de(user) et partenaire_courses_de(user). Les deux fonctions de l'écran ne font plus
--    que les appeler avec auth.uid() : mêmes courses, mêmes colonnes, mêmes droits qu'avant (aucun changement pour l'écran).
--    Les fonctions « _de » ne s'appellent pas par l'API (aucun droit pour anon, authenticated ni service_role) : un compte ne lit jamais
--    les courses d'un autre.
-- 2. partenaire_notif_courses(user) : ses courses d'aujourd'hui et des jours suivants (sous-ensemble de partenaire_courses_de), réduites à
--    la liste blanche des notifications : date, heure, pickup, destination, aller-retour et programme, personnes, nom du client (écrit
--    seulement dans « nouvelle course »), libellé (pour écarter les frais de parc). Jamais un net, une marge, un prix, une commission, une note,
--    une référence de dossier. Réservée à la clé de service.
-- 3. partenaire_notifs_changements() : compare ses courses aux empreintes gardées et rend les notifications à envoyer, en une transaction,
--    la ligne partenaires_acces du compte verrouillée (for update) : deux passages qui se chevauchent ne notifient pas deux fois.
--    Le premier passage d'un compte (ou après une coupure) enregistre ses courses sans rien envoyer : jamais une avalanche à l'activation.
--    Compte désactivé, partenaire désactivé, accès retiré ou aucun téléphone abonné : ses empreintes sont effacées, rien ne part.
-- 4. partenaires_notifs_envois : une ligne par résumé de la veille et par rappel d'une heure avant envoyés (aucun double envoi, même forcé).

begin;

-- ---- 1. La règle commune -------------------------------------------------------------------------------------------------------------

-- L'accès valable d'un compte, ou rien (règle de la migration 115, inchangée). Interne.
create or replace function partenaire_acces_de(p_user uuid) returns table (partenaire_id uuid, entite_id uuid, jour date)
language sql stable security definer set search_path = public as $$
  select a.partenaire_id, pa.entite_id, (now() at time zone coalesce(nullif(o.fuseau, ''), 'Asia/Bangkok'))::date
  from partenaires_acces a
  join profils pr on pr.user_id = a.user_id
  join partenaires pa on pa.id = a.partenaire_id
  join entites e on e.id = pa.entite_id
  join reglages g on g.entite_id = e.id
  left join organisations o on o.id = e.organisation_id
  where p_user is not null and a.user_id = p_user
    and pr.actif and not pr.super_admin and not coalesce((to_jsonb(pr)->>'plateforme')::boolean, false)
    and pr.organisation_id = e.organisation_id
    and e.actif and coalesce(pa.actif, true)
    and g.valeur->>'fonctionnement' = 'taxi'
    and not exists (select 1 from membres m where m.user_id = a.user_id)
  limit 1
$$;
revoke all on function partenaire_acces_de(uuid) from public, anon, authenticated;

create or replace function partenaire_acces_actuel() returns table (partenaire_id uuid, entite_id uuid, jour date)
language sql stable security definer set search_path = public as $$
  select * from partenaire_acces_de(auth.uid())
$$;
revoke all on function partenaire_acces_actuel() from public, anon, authenticated;

-- Les courses d'un compte : exactement la liste de partenaire_courses() de la migration 119. Interne.
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

-- L'écran du partenaire : la même fonction qu'avant, qui appelle la règle commune pour le compte connecté.
create or replace function partenaire_courses() returns table (
  id uuid, date_service date, heure text, pickup text, dropoff text, retour boolean, programme text,
  adultes integer, enfants integer, bebes integer, client text, telephone text, vol text, prix numeric,
  commission numeric, commission_payee numeric, reglee boolean, par_moi boolean, modifiable boolean,
  ref text, reference_partenaire text, libelle text, service text, vehicules numeric, adresse_client text, details jsonb,
  paiement text, a_encaisser numeric
)
language sql stable security definer set search_path = public as $$
  select * from partenaire_courses_de(auth.uid())
$$;
revoke all on function partenaire_courses() from public, anon;
grant execute on function partenaire_courses() to authenticated;

-- ---- 2. Ce qu'une notification peut dire ------------------------------------------------------------------------------------------------
-- Ses courses d'aujourd'hui et des jours suivants, prises dans partenaire_courses_de (jamais ailleurs), réduites à ces colonnes.
-- `jour` : aujourd'hui dans le fuseau de l'organisation ; `entite_id` : l'entreprise Taxi (heure de sa veille, son rappel « h1 »).
create or replace function partenaire_notif_courses(p_user uuid) returns table (
  id uuid, date_service date, heure text, pickup text, dropoff text, retour boolean, programme text,
  adultes integer, enfants integer, bebes integer, client text, libelle text, jour date, entite_id uuid
)
language sql stable security definer set search_path = public as $$
  select c.id, c.date_service, coalesce(c.heure, ''), coalesce(c.pickup, ''), c.dropoff, c.retour, c.programme,
    c.adultes, c.enfants, c.bebes, c.client, coalesce(c.libelle, ''), a.jour, a.entite_id
  from partenaire_acces_de(p_user) a
  cross join lateral partenaire_courses_de(p_user) c
  where c.date_service >= a.jour
  order by c.date_service, c.heure
$$;
revoke all on function partenaire_notif_courses(uuid) from public, anon, authenticated;

-- ---- 3. Empreintes des courses notifiées ------------------------------------------------------------------------------------------------
-- Une ligne par compte partenaire et par course de sa liste. `empreinte_vue` : l'état actuel (ou « annule ») ; `vue_le` : depuis quand il n'a
-- plus bougé ; `empreinte_envoyee` : l'état de la dernière notification (null : jamais notifiée). `apercu` : ce que la notification dit
-- (les colonnes de partenaire_notif_courses, déjà visibles sur son écran), `apercu_envoye` : celui de la dernière notification, pour dire
-- ce qui a changé. Aucune table n'est lisible par l'API : seule la fonction ci-dessous y écrit.
create table if not exists partenaires_notifs_courses (
  user_id uuid not null references partenaires_acces (user_id) on delete cascade,
  reservation_id uuid not null references reservations (id) on delete cascade,
  empreinte_vue text not null,
  vue_le timestamptz not null default now(),
  empreinte_envoyee text,
  apercu jsonb not null default '{}'::jsonb,
  apercu_envoye jsonb,
  primary key (user_id, reservation_id)
);
create index if not exists partenaires_notifs_courses_reservation on partenaires_notifs_courses (reservation_id);
-- Le compte dont les courses sont suivies (première prise des empreintes faite, sans envoi).
create table if not exists partenaires_notifs_etat (
  user_id uuid primary key references partenaires_acces (user_id) on delete cascade,
  initialise_le timestamptz not null default now()
);
-- Résumés de la veille et rappels d'une heure avant déjà envoyés : clé « veille:AAAA-MM-JJ » ou « h1:<course>:<début> ».
create table if not exists partenaires_notifs_envois (
  user_id uuid not null references partenaires_acces (user_id) on delete cascade,
  cle text not null check (length(cle) between 1 and 120),
  envoye_le timestamptz not null default now(),
  primary key (user_id, cle)
);
comment on table partenaires_notifs_courses is 'Notifications du partenaire chauffeur (migration 123) : empreinte de chaque course de sa liste, une notification par rafale de changements.';
comment on table partenaires_notifs_envois is 'Notifications du partenaire chauffeur (migration 123) : résumés de la veille et rappels 1 h avant déjà envoyés.';
alter table partenaires_notifs_courses enable row level security;
alter table partenaires_notifs_etat enable row level security;
alter table partenaires_notifs_envois enable row level security;
revoke all on partenaires_notifs_courses, partenaires_notifs_etat, partenaires_notifs_envois from public, anon, authenticated;

-- L'empreinte d'une course : ce qui fait partir une notification (date, heure, pickup, destination, aller-retour, personnes). Le nom du client,
-- le vol ou les bagages qui changent ne notifient pas.
create or replace function partenaire_notif_empreinte(c jsonb) returns text language sql immutable set search_path = public as $$
  select md5(concat_ws('|', c->>'date_service', lower(trim(c->>'heure')), lower(trim(c->>'pickup')), lower(trim(c->>'dropoff')), c->>'retour',
    lower(trim(c->>'programme')), c->>'adultes', c->>'enfants', c->>'bebes'))
$$;
revoke all on function partenaire_notif_empreinte(jsonb) from public, anon, authenticated;

-- Les notifications de courses à envoyer maintenant, pour chaque compte partenaire valable qui a au moins un téléphone abonné.
-- genre : « nouvelle » (pas encore notifiée, ou rétablie après une annulation), « modifiee », « annulee ». Une course qui change encore
-- attend : elle part quand son empreinte n'a plus bougé depuis `p_delai`. Créée puis annulée dans le délai : rien ne part.
-- Une course qui sort de sa liste sans être annulée (date passée, confiée à une autre fiche, au-delà de 60 jours) est oubliée sans notification.
create or replace function partenaire_notifs_changements(p_delai interval default interval '10 minutes')
returns table (user_id uuid, reservation_id uuid, genre text, apercu jsonb, apercu_avant jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_user uuid;
  v_acces record;
begin
  -- Résumés et rappels de plus de trois jours : plus utiles pour éviter un double envoi.
  delete from partenaires_notifs_envois e where e.envoye_le < now() - interval '3 days';
  for v_user in select a.user_id from partenaires_acces a order by a.user_id for update of a loop
    select * into v_acces from partenaire_acces_de(v_user);
    if v_acces.partenaire_id is null or not exists (select 1 from abonnements_push p where p.user_id = v_user) then
      -- Coupé (compte, partenaire, entreprise) ou aucun téléphone : on oublie tout. Au retour, la première prise ne notifie rien.
      delete from partenaires_notifs_courses x where x.user_id = v_user;
      delete from partenaires_notifs_etat x where x.user_id = v_user;
      continue;
    end if;

    if not exists (select 1 from partenaires_notifs_etat x where x.user_id = v_user) then
      insert into partenaires_notifs_courses (user_id, reservation_id, empreinte_vue, vue_le, empreinte_envoyee, apercu, apercu_envoye)
      select v_user, c.id, partenaire_notif_empreinte(to_jsonb(c)), now(), partenaire_notif_empreinte(to_jsonb(c)), to_jsonb(c), to_jsonb(c)
      from partenaire_notif_courses(v_user) c
      on conflict on constraint partenaires_notifs_courses_pkey do nothing;
      insert into partenaires_notifs_etat (user_id) values (v_user) on conflict on constraint partenaires_notifs_etat_pkey do nothing;
      continue;
    end if;

    -- Les courses suivies qui ne sont plus dans sa liste : annulées (course ou dossier) dans son périmètre et pas encore passées, elles
    -- deviennent « annule » ; sinon elles sont oubliées.
    update partenaires_notifs_courses x set empreinte_vue = 'annule', vue_le = now()
    from reservations r join dossiers d on d.id = r.dossier_id
    where x.user_id = v_user and x.reservation_id = r.id and x.empreinte_vue <> 'annule'
      and r.entite_id = v_acces.entite_id and (r.partenaire_id is null or r.partenaire_id = v_acces.partenaire_id)
      and (r.statut = 'annule' or d.annule) and r.date_service >= v_acces.jour
      and not exists (select 1 from partenaire_notif_courses(v_user) c where c.id = x.reservation_id);
    delete from partenaires_notifs_courses x
    where x.user_id = v_user
      and not exists (select 1 from partenaire_notif_courses(v_user) c where c.id = x.reservation_id)
      and not exists (
        select 1 from reservations r join dossiers d on d.id = r.dossier_id
        where r.id = x.reservation_id and r.entite_id = v_acces.entite_id and (r.partenaire_id is null or r.partenaire_id = v_acces.partenaire_id)
          and (r.statut = 'annule' or d.annule) and r.date_service >= v_acces.jour);

    -- Les courses de sa liste : nouvelles, ou changées depuis le dernier passage (le délai repart).
    insert into partenaires_notifs_courses as x (user_id, reservation_id, empreinte_vue, vue_le, apercu)
    select v_user, c.id, partenaire_notif_empreinte(to_jsonb(c)), now(), to_jsonb(c) from partenaire_notif_courses(v_user) c
    on conflict on constraint partenaires_notifs_courses_pkey do update
      set empreinte_vue = excluded.empreinte_vue, apercu = excluded.apercu,
          vue_le = case when x.empreinte_vue is distinct from excluded.empreinte_vue then now() else x.vue_le end;

    -- Créée puis annulée avant d'être notifiée : rien à dire.
    update partenaires_notifs_courses x set empreinte_envoyee = 'annule', apercu_envoye = x.apercu
    where x.user_id = v_user and x.empreinte_vue = 'annule' and x.empreinte_envoyee is null;

    return query
    with pretes as (
      select x.reservation_id, x.empreinte_vue, x.empreinte_envoyee, x.apercu, x.apercu_envoye from partenaires_notifs_courses x
      where x.user_id = v_user and x.empreinte_vue is distinct from x.empreinte_envoyee and x.vue_le <= now() - p_delai
      for update
    ), marquees as (
      update partenaires_notifs_courses x set empreinte_envoyee = p.empreinte_vue, apercu_envoye = p.apercu
      from pretes p where x.user_id = v_user and x.reservation_id = p.reservation_id
      returning x.reservation_id
    )
    select v_user, p.reservation_id,
      case when p.empreinte_vue = 'annule' then 'annulee' when p.empreinte_envoyee is null or p.empreinte_envoyee = 'annule' then 'nouvelle' else 'modifiee' end,
      p.apercu, p.apercu_envoye
    from pretes p join marquees m on m.reservation_id = p.reservation_id;
  end loop;
end
$$;
revoke all on function partenaire_notifs_changements(interval) from public, anon, authenticated;

-- La clé de service (fonction « rappels ») : les deux fonctions de lecture et les envois déjà faits. Jamais les fonctions « _de » ni les empreintes,
-- qu'elle ne lit que par partenaire_notifs_changements(). Sur Postgres sans Supabase (contrôles), le rôle n'existe pas.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function partenaire_acces_de(uuid), partenaire_courses_de(uuid), partenaire_notif_empreinte(jsonb) from service_role';
    execute 'revoke all on partenaires_notifs_courses, partenaires_notifs_etat from service_role';
    execute 'grant execute on function partenaire_notif_courses(uuid), partenaire_notifs_changements(interval) to service_role';
    execute 'grant select, insert, delete on partenaires_notifs_envois to service_role';
  end if;
end
$$;

commit;
