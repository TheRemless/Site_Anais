-- Gestion : migration 115 (22.11.2026), accès d'un partenaire chauffeur à ses courses (Mr. Brown, VIP Taxi Lanta).
-- À exécuter une seule fois, AVANT de publier la version de l'outil qui l'utilise. Idempotente. Ne modifie aucune donnée existante.
-- Retour en arrière : retour-115-acces-partenaire.sql.
--
-- Le partenaire qui fait les courses d'une entreprise en mode taxi voit, en thaï, ses courses à venir (et les courses passées dont la
-- commission reste à payer) : heure, prise en charge, destination, personnes, nom et téléphone du client, vol, prix payé par le client.
-- Il saisit sur chaque course la commission qu'il doit ; l'outil fait le total. Il ne peut rien faire d'autre.
--
-- Le compte n'est membre d'AUCUNE entreprise (pas de ligne dans `membres`, pas de rôle) : toutes les politiques existantes lui ferment
-- toutes les tables (clients, dossiers, réservations, nets, réglages, équipe, journal…). Il ne lit et n'écrit que par trois fonctions :
--   * partenaire_mon_acces()             : son nom de partenaire, l'entreprise et la devise (l'outil choisit l'écran) ;
--   * partenaire_courses()               : ses courses, champ par champ, jamais un net ni un réglage ;
--   * partenaire_saisir_commission(r, m) : la commission prévue d'une de ses courses, tant qu'elle n'est pas payée.
-- Les trois passent par partenaire_acces_actuel(), qui ne rend l'accès que si : le profil est actif, n'est ni administrateur ni éditeur du
-- logiciel, appartient à l'organisation de l'entreprise ; le partenaire est actif ; l'entreprise est active et en mode taxi. Désactiver le compte
-- (Administration, Utilisateurs) ou le partenaire coupe donc l'accès tout de suite.
-- Les courses montrées : celles de l'entreprise Taxi confiées à sa fiche ou sans partenaire (décision de Jérémy, 22.11.2026), ni annulées
-- ni dans un dossier annulé, d'aujourd'hui à 60 jours, plus les passées dont la commission n'est pas payée. Jamais une course confiée à
-- une autre fiche, jamais une autre entreprise.
-- La commission saisie devient la « commission prévue » (reservations_nets.commission_prevue), marquée comme la sienne (commission_partenaire) :
-- la fiche de la course et la carte « Commissions à demander » de Nani disent « annoncée par le partenaire ». Une commission posée par Nani ou
-- l'équipe n'est jamais écrasée. Le journal des nets (migration 37) note chaque saisie avec le compte. Une commission reçue, même en partie,
-- ne se modifie plus. Aucune notification n'est envoyée.
-- L'accès se donne à la main (docs/gestion/acces-partenaire.md) : une ligne dans `partenaires_acces`, posée par Jérémy dans l'éditeur SQL.

begin;

create table if not exists partenaires_acces (
  user_id uuid primary key references profils (user_id) on delete cascade,
  partenaire_id uuid not null references partenaires (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists partenaires_acces_partenaire on partenaires_acces (partenaire_id);
comment on table partenaires_acces is 'Compte d''un partenaire chauffeur (migration 115) : ses courses en thaï et la saisie de sa commission, rien d''autre. Posé à la main dans l''éditeur SQL.';

alter table partenaires_acces enable row level security;
revoke all on partenaires_acces from public, anon, authenticated;
-- Lecture seule depuis l'outil : le compte voit sa propre ligne, l'administration de l'organisation celles de ses entreprises. Aucune écriture par l'API.
grant select on partenaires_acces to authenticated;
drop policy if exists "lire les accès partenaires" on partenaires_acces;
create policy "lire les accès partenaires" on partenaires_acces for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from partenaires p where p.id = partenaires_acces.partenaire_id and admin_de(p.entite_id))
);

-- Garde-fous à la pose de l'accès : un partenaire d'une entreprise en mode taxi, un compte de la même organisation, qui n'a aucun autre accès.
create or replace function verifier_acces_partenaire() returns trigger language plpgsql security definer set search_path = public as $$
declare
  p record;
  pr record;
begin
  select pa.entite_id, e.organisation_id, g.valeur->>'fonctionnement' as fonctionnement into p
  from partenaires pa join entites e on e.id = pa.entite_id left join reglages g on g.entite_id = pa.entite_id
  where pa.id = new.partenaire_id;
  if p.entite_id is null then raise exception 'Partenaire introuvable.'; end if;
  if p.fonctionnement is distinct from 'taxi' then raise exception 'Accès partenaire : seulement pour un partenaire d''une entreprise en mode taxi.'; end if;
  select * into pr from profils where user_id = new.user_id;
  if pr.user_id is null then raise exception 'Compte introuvable : créez d''abord le compte (profil).'; end if;
  if pr.super_admin or coalesce((to_jsonb(pr)->>'plateforme')::boolean, false) then raise exception 'Accès partenaire refusé : ce compte est administrateur.'; end if;
  if pr.organisation_id is distinct from p.organisation_id then raise exception 'Accès partenaire refusé : le compte n''est pas dans l''organisation de cette entreprise.'; end if;
  if exists (select 1 from membres m where m.user_id = new.user_id) then raise exception 'Accès partenaire refusé : ce compte a déjà accès à une entreprise. Retirez d''abord ses accès (Administration, Utilisateurs).'; end if;
  return new;
end
$$;
revoke all on function verifier_acces_partenaire() from public, anon, authenticated;
drop trigger if exists verifier_acces_partenaire on partenaires_acces;
create trigger verifier_acces_partenaire before insert or update on partenaires_acces for each row execute function verifier_acces_partenaire();

-- Et dans l'autre sens : un compte partenaire ne devient pas membre d'une entreprise (il verrait alors tout ce que son rôle ouvre).
create or replace function refuser_membre_partenaire() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from partenaires_acces a where a.user_id = new.user_id) then
    raise exception 'Ce compte est un compte partenaire (ses courses seulement) : il ne peut pas être membre d''une entreprise. Retirez d''abord son accès partenaire.';
  end if;
  return new;
end
$$;
revoke all on function refuser_membre_partenaire() from public, anon, authenticated;
drop trigger if exists refuser_membre_partenaire on membres;
create trigger refuser_membre_partenaire before insert or update on membres for each row execute function refuser_membre_partenaire();

-- L'accès valable du compte connecté, ou rien. Fonction interne : personne ne l'appelle par l'API.
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

-- Ce que l'écran affiche en tête : le partenaire, l'entreprise, la devise. Vide pour tout autre compte.
create or replace function partenaire_mon_acces() returns table (partenaire text, contact text, entreprise text, devise text)
language sql stable security definer set search_path = public as $$
  select pa.nom, coalesce(nullif(trim(pa.contact->>'personne'), ''), pa.nom), e.nom, coalesce(nullif(g.valeur->>'devise', ''), 'THB')
  from partenaire_acces_actuel() a
  join partenaires pa on pa.id = a.partenaire_id
  join entites e on e.id = a.entite_id
  join reglages g on g.entite_id = a.entite_id
$$;

-- La commission saisie par le partenaire (relecture de sécurité, 22.11.2026) : elle reste marquée comme la sienne, jamais confondue avec celle
-- de Nani. `commission_partenaire` garde le montant qu'il a saisi, `commission_partenaire_le` le moment. La commission prévue est « la sienne »
-- tant qu'elle est égale à ce montant ; si Nani ou l'équipe la changent, elle redevient la leur et il ne peut plus y toucher.
alter table reservations_nets add column if not exists commission_partenaire numeric(12, 2);
alter table reservations_nets add column if not exists commission_partenaire_le timestamptz;
alter table reservations_nets drop constraint if exists reservations_nets_commission_partenaire_check;
alter table reservations_nets add constraint reservations_nets_commission_partenaire_check check (commission_partenaire is null or commission_partenaire > 0);
comment on column reservations_nets.commission_partenaire is 'Commission saisie par le partenaire chauffeur (migration 115). Égale à commission_prevue : la commission prévue est la sienne.';

-- Les courses qu'il voit (décisions de Jérémy, 22.11.2026) : celles de l'entreprise Taxi confiées à sa fiche ou sans partenaire (jamais une
-- course confiée à une autre fiche) ; d'aujourd'hui à 60 jours ; et les courses passées tant que leur commission n'est pas payée.
-- Rien d'autre que ces colonnes : ni net, ni note interne, ni référence de dossier.
-- `modifiable` : il peut saisir (rien de payé, et aucune commission posée par quelqu'un d'autre) ; `par_moi` : la commission affichée est la sienne.
drop function if exists partenaire_courses();
create function partenaire_courses() returns table (
  id uuid, date_service date, heure text, pickup text, dropoff text, retour boolean, programme text,
  adultes integer, enfants integer, bebes integer, client text, telephone text, vol text, prix numeric,
  commission numeric, commission_payee numeric, reglee boolean, par_moi boolean, modifiable boolean
)
language sql stable security definer set search_path = public as $$
  select r.id, r.date_service, r.heure_pickup, r.lieu_pickup,
    coalesce(r.details->>'drop_off', ''), coalesce(r.details->>'type_trajet', '') = 'retour_depart', coalesce(r.details->>'programme_trajet', ''),
    coalesce(nombre_json(r.personnes->'adultes'), 0)::integer, coalesce(nombre_json(r.personnes->'enfants'), 0)::integer, coalesce(nombre_json(r.personnes->'bebes'), 0)::integer,
    trim(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, '')), coalesce(c.telephone, ''), coalesce(r.details->>'vol', ''), r.montant_vente,
    n.commission_prevue, n.commission_recue, n.commission_recue_le is not null,
    coalesce(n.commission_prevue = n.commission_partenaire, false),
    n.commission_recue_le is null and coalesce(n.commission_recue, 0) = 0 and (n.commission_prevue is null or coalesce(n.commission_prevue = n.commission_partenaire, false))
  from partenaire_acces_actuel() a
  join reservations r on r.entite_id = a.entite_id and (r.partenaire_id is null or r.partenaire_id = a.partenaire_id)
  join dossiers d on d.id = r.dossier_id and d.entite_id = r.entite_id
  -- Le client peut être une fiche partagée d'une autre entreprise (migration 46) : seuls son nom et son téléphone sortent.
  join clients c on c.id = d.client_id
  left join reservations_nets n on n.reservation_id = r.id
  where r.statut <> 'annule' and not d.annule and r.date_service is not null
    and ((r.date_service >= a.jour and r.date_service <= a.jour + 60)
      or (r.date_service < a.jour and n.commission_recue_le is null
          and (n.commission_prevue is null or n.commission_prevue - coalesce(n.commission_recue, 0) > 0)))
  order by r.date_service, r.heure_pickup, r.created_at
$$;

-- Sa commission sur une course de sa liste (null efface la sienne). Refusée : course hors de sa liste, commission déjà payée (même en partie),
-- commission posée par Nani ou l'équipe (jamais écrasée), montant nul ou négatif, à plus de deux décimales, au-dessus du prix de vente de la
-- course (ou de 10 000 si le prix est vide).
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

revoke all on function partenaire_mon_acces(), partenaire_courses(), partenaire_saisir_commission(uuid, numeric) from public, anon;
grant execute on function partenaire_mon_acces(), partenaire_courses(), partenaire_saisir_commission(uuid, numeric) to authenticated;

commit;
