-- Gestion : migration 48, hôtels situés et nouveaux usages de l'assistant (demande de prix et d'horaires, 20.11.2026).
-- 1. Table hotels_lieux : pour chaque entreprise, un hôtel cité par un client et le lieu du catalogue où il se trouve (« Koh Lanta », « Koh Phi Phi »),
--    sa plage ou son quartier, la source de la recherche web et si une personne l'a vérifié. Un hôtel ne se cherche qu'une fois ; la zone sert
--    aussi à proposer la zone de pickup. Chaque entreprise garde ses lignes (les lieux sont ceux de ses trajets).
--    Lire : droit « partenaires.lire ». Ajouter ou corriger : « dossiers.ecrire » (la personne qui prépare la réponse). Supprimer : « partenaires.ecrire ».
--    Aucune donnée de client : un nom d'hôtel, un lieu, une adresse de page web.
-- 2. Journal de l'assistant : la colonne « usage » accepte les trois nouveaux usages (itineraire, situer, repondre_itineraire). Sans cela, leurs
--    appels ne seraient pas notés, donc ni comptés dans la limite du jour ni dans le coût.
-- Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Retour en arrière :
--   drop table if exists hotels_lieux; drop function if exists noter_hotel_lieu();
--   alter table assistant_journal drop constraint if exists assistant_journal_usage_check;
--   alter table assistant_journal add constraint assistant_journal_usage_check check (usage in ('lire', 'rediger'));
-- Contrôle : verif-hotels-lieux.mjs.

begin;

create table if not exists hotels_lieux (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null references entites (id) on delete cascade,
  cle text not null check (length(cle) between 1 and 120),
  nom text not null check (length(nom) between 1 and 120),
  lieu text not null default '' check (length(lieu) <= 80),
  zone text not null default '' check (length(zone) <= 80),
  localite text not null default '' check (length(localite) <= 80),
  source_url text not null default '' check (length(source_url) <= 500),
  source_titre text not null default '' check (length(source_titre) <= 160),
  certitude text not null default 'inconnue' check (certitude in ('sure', 'probable', 'inconnue')),
  verifie boolean not null default false,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  maj_par uuid default auth.uid(),
  unique (entite_id, cle)
);
create index if not exists hotels_lieux_entite on hotels_lieux (entite_id);

-- Date et auteur de la dernière modification, posés par la base (l'outil ne peut pas les choisir).
create or replace function noter_hotel_lieu() returns trigger language plpgsql set search_path = public as $$
begin
  new.maj_le := now();
  new.maj_par := auth.uid();
  if tg_op = 'UPDATE' then
    new.entite_id := old.entite_id;
    new.cree_le := old.cree_le;
  end if;
  return new;
end
$$;
drop trigger if exists noter_hotel_lieu on hotels_lieux;
create trigger noter_hotel_lieu before insert or update on hotels_lieux for each row execute function noter_hotel_lieu();

alter table hotels_lieux enable row level security;
revoke all on hotels_lieux from anon, authenticated;
grant select, insert, update, delete on hotels_lieux to authenticated;

drop policy if exists "lire les hôtels situés" on hotels_lieux;
create policy "lire les hôtels situés" on hotels_lieux for select to authenticated using (a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "ajouter un hôtel situé" on hotels_lieux;
create policy "ajouter un hôtel situé" on hotels_lieux for insert to authenticated with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "corriger un hôtel situé" on hotels_lieux;
create policy "corriger un hôtel situé" on hotels_lieux for update to authenticated using (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire')) with check (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire'));
drop policy if exists "supprimer un hôtel situé" on hotels_lieux;
create policy "supprimer un hôtel situé" on hotels_lieux for delete to authenticated using (a_permission(entite_id, 'partenaires.ecrire'));

-- Le journal de l'assistant accepte les nouveaux usages (contrainte créée par la migration 27 sous son nom par défaut).
alter table assistant_journal drop constraint if exists assistant_journal_usage_check;
alter table assistant_journal add constraint assistant_journal_usage_check check (usage in ('lire', 'rediger', 'itineraire', 'situer', 'repondre_itineraire'));

commit;
