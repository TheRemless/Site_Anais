-- Gestion : migration 130 (26.11.2026), options d'un service. Une prestation peut compléter une ou plusieurs autres du même partenaire
-- (« Koh Kradan extension » du 4 Islands privé, lunch box, transfert d'hôtel) : elle se choisit sous son service et va sur sa réservation.
-- À exécuter une seule fois, après la migration 128, avec l'outil et la fonction « agent » du même commit. Idempotente. Ne modifie aucune donnée :
-- les prestations existantes deviennent des options par un fichier à part (donnees-options-catalogue.sql), après accord.
-- Retour en arrière : retour-130-options-prestations.sql.
--
-- INV-2026-055 : le 4 Islands privé et son extension Koh Kradan étaient deux prestations à part ; l'Assistant a créé deux services et deux
-- vouchers, refaits à la main en un seul.
-- Règles tenues par la base (quel que soit l'écran) :
--   - `option_de` : les prestations que celle-ci complète. Toutes de la même entreprise ET du même partenaire (un seul voucher, un seul
--     prestataire), aucune n'est elle-même une option (pas d'option d'option), jamais elle-même ;
--   - une prestation qui a des options ne devient pas une option ; une note « à payer sur place » (frais de parc) n'est pas une option ;
--   - une prestation supprimée sort des listes `option_de` des autres.
-- Les lignes de facture d'une option portent `option_de` (l'id de la ligne du service) dans le JSON du document : rien à changer en base,
-- le net et la commission prévus d'une réservation se calculent déjà sur toutes ses lignes (net_reservation_calcule, migration 32).
begin;

alter table prestations add column if not exists option_de uuid[] not null default '{}';
create index if not exists prestations_option_de_idx on prestations using gin (option_de);

create or replace function controler_option_prestation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Sans doublon ni valeur vide.
  new.option_de := coalesce((select array_agg(distinct x order by x) from unnest(new.option_de) x where x is not null), '{}');
  if cardinality(new.option_de) = 0 then return new; end if;
  if new.id = any (new.option_de) then
    raise exception 'Une prestation ne peut pas être sa propre option.' using errcode = '22023';
  end if;
  if new.sur_place then
    raise exception 'Une note « à payer sur place » ne peut pas être une option.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.option_de) x where not exists (
      select 1 from prestations p where p.id = x and p.entite_id = new.entite_id and p.partenaire_id is not distinct from new.partenaire_id and cardinality(p.option_de) = 0)) then
    raise exception 'Une option complète un service du même partenaire et de la même entreprise, qui n''est pas lui-même une option.' using errcode = '22023';
  end if;
  if exists (select 1 from prestations p where p.id <> new.id and new.id = any (p.option_de)) then
    raise exception 'Cette prestation a déjà des options : elle ne peut pas devenir l''option d''une autre.' using errcode = '22023';
  end if;
  return new;
end
$$;
revoke all on function controler_option_prestation() from public, anon, authenticated;

drop trigger if exists controler_option_prestation on prestations;
create trigger controler_option_prestation before insert or update of option_de, entite_id, partenaire_id, sur_place on prestations
  for each row execute function controler_option_prestation();

-- Un service qui change de partenaire ou d'entreprise garderait des options d'ailleurs : refusé tant qu'il en a.
create or replace function controler_service_avec_options() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.partenaire_id is distinct from old.partenaire_id or new.entite_id is distinct from old.entite_id)
     and exists (select 1 from prestations p where p.id <> new.id and new.id = any (p.option_de) and (p.partenaire_id is distinct from new.partenaire_id or p.entite_id <> new.entite_id)) then
    raise exception 'Ce service a des options d''un autre partenaire : retirez-les ou changez-les d''abord.' using errcode = '22023';
  end if;
  return new;
end
$$;
revoke all on function controler_service_avec_options() from public, anon, authenticated;

drop trigger if exists controler_service_avec_options on prestations;
create trigger controler_service_avec_options before update of partenaire_id, entite_id on prestations
  for each row execute function controler_service_avec_options();

-- Une prestation supprimée sort des listes des autres (même entreprise seulement).
create or replace function retirer_option_supprimee() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update prestations set option_de = array_remove(option_de, old.id) where entite_id = old.entite_id and old.id = any (option_de);
  return old;
end
$$;
revoke all on function retirer_option_supprimee() from public, anon, authenticated;

drop trigger if exists retirer_option_supprimee on prestations;
create trigger retirer_option_supprimee after delete on prestations
  for each row execute function retirer_option_supprimee();

commit;
