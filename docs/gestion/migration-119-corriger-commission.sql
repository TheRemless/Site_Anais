-- Gestion : migration 119 (23.11.2026), corriger une commission ou le prix et la commission depuis À encaisser > Commissions.
-- À exécuter une seule fois, APRÈS la migration 118 (et la 115). Idempotente. Ne modifie aucune donnée existante.
-- Retour en arrière : retour-119-corriger-commission.sql.
--
-- Jérémy (23.11.2026) : hier, une commission a dû être baissée parce que le client a obtenu un remboursement partiel. Il y aura toujours des cas
-- spéciaux où il faut monter ou baisser une commission, voire le prix de la prestation. L'écran écrit la nouvelle commission prévue (et le prix
-- de vente sur la réservation, par le chemin habituel qui fait suivre la facture). Cette migration garde la trace de la correction :
--   * commission_avant_correction, prix_avant_correction : les montants d'avant la dernière correction (le journal des nets, migration 37,
--     garde aussi chaque avant et après, une ligne par correction) ;
--   * commission_corrigee_le, commission_corrigee_motif, commission_corrigee_note : quand et pourquoi. Motif obligatoire, note obligatoire
--     pour « autre » ;
--   * partenaire_saisir_commission refuse une commission corrigée : la correction de Nani l'emporte et Mr. Brown ne l'écrase pas, même quand
--     le montant corrigé égale celui qu'il avait saisi (l'écran efface aussi sa saisie, commission_partenaire).
-- Le déclencheur de la migration 32 ne réécrit pas la commission corrigée : l'écran vide commission_prevue_auto, et la base ne réécrit qu'une
-- commission égale à sa dernière valeur calculée.
-- Les colonnes vivent dans reservations_nets : mêmes politiques (droit « partenaires.nets »), jamais lues par Mook ni par le partenaire.

begin;

alter table reservations_nets add column if not exists commission_avant_correction numeric(12, 2);
alter table reservations_nets add column if not exists prix_avant_correction numeric(12, 2);
alter table reservations_nets add column if not exists commission_corrigee_le timestamptz;
alter table reservations_nets add column if not exists commission_corrigee_motif text;
alter table reservations_nets add column if not exists commission_corrigee_note text;

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
comment on column reservations_nets.commission_corrigee_le is 'Moment de la dernière correction de la commission par l''équipe (migration 119). Le partenaire chauffeur ne la modifie plus.';
comment on column reservations_nets.commission_corrigee_motif is 'Motif de la dernière correction : remboursement_partiel, geste_commercial, erreur_saisie, autre (migration 119).';
comment on column reservations_nets.commission_corrigee_note is 'Note courte de la correction, obligatoire pour « autre » (migration 119).';

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

commit;
