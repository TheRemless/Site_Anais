-- Retour en arrière de la migration 119 : la fonction de la migration 115, puis les colonnes et contraintes de la correction.
-- Attention : les colonnes supprimées emportent les motifs et anciens montants des corrections (le journal des nets les garde).

begin;

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

alter table reservations_nets drop constraint if exists reservations_nets_commission_corrigee_check;
alter table reservations_nets drop constraint if exists reservations_nets_commission_corrigee_motif_check;
alter table reservations_nets drop column if exists commission_corrigee_note;
alter table reservations_nets drop column if exists commission_corrigee_motif;
alter table reservations_nets drop column if exists commission_corrigee_le;
alter table reservations_nets drop column if exists prix_avant_correction;
alter table reservations_nets drop column if exists commission_avant_correction;

commit;
