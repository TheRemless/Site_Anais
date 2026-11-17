-- Gestion : migration 36, équipe et réglages (lot D de l'audit d'autonomie, 17.11.2026).
-- À appliquer après la migration 35. Se rejoue sans erreur ni doublon.
--
-- 1. Rôle « Administrateur » calculé (audit n° 4). Avant : ses droits étaient une liste enregistrée. Chaque nouveau droit demandait du SQL
--    (fiduciaire, partenaires.supprimer, clients.fusionner…) et un oubli laissait Anaïs sans le droit dans une entreprise.
--    Après : une colonne `tous_droits`. Un rôle qui l'a reçoit tous les droits de la base (toutes_permissions()), comme l'administratrice
--    générale. La liste enregistrée ne sert plus pour ce rôle. Seuls les rôles système « Administrateur » la reçoivent, ici et à la création
--    d'une entreprise (l'outil l'écrit).
--
-- 2. Nouveau droit « partenaires.prix » : modifier un prix de vente (décision 3 de Jérémy, 17.11.2026). Avant : « partenaires.ecrire » suffisait
--    pour changer le prix de vente d'une prestation ou d'un trajet. Après : le prix de vente, le prix enfant et l'unité d'une prestation, les prix
--    adulte et enfant d'un trajet ne changent qu'avec ce droit. Une prestation ou un trajet créé sans ce droit naît sans prix. Le reste de la fiche
--    (libellé, horaires, masquer…) se modifie toujours avec « partenaires.ecrire ». Le droit est donné ici à tout rôle qui a déjà
--    « partenaires.ecrire » : personne ne perd rien en appliquant cette migration. Le retrait pour le rôle de Mook est un fichier à part
--    (donnees-mook-secret-prix.sql), à passer ensuite.
--
-- 3. Historique des réglages (audit n° 39) : chaque enregistrement des réglages garde la version remplacée (60 dernières par entreprise).
--    Lisible par qui peut modifier les réglages. « Revenir à cette version » se fait depuis l'outil, en réenregistrant la version choisie.
--
-- Ne modifie aucune donnée, sauf : la colonne `tous_droits` des rôles « Administrateur » et le droit « partenaires.prix » ajouté aux rôles
-- qui ont « partenaires.ecrire ».

begin;

-- 1. Administrateur calculé ------------------------------------------------------------------------------------------------------------
alter table roles add column if not exists tous_droits boolean not null default false;
update roles set tous_droits = true where systeme and nom = 'Administrateur' and not tous_droits;

-- La liste reprend celle de la migration 33 (clients.fusionner, partenaires.supprimer compris) et ajoute partenaires.prix.
create or replace function toutes_permissions() returns text[] language sql immutable as $$
  select array['clients.lire', 'clients.ecrire', 'clients.supprimer', 'clients.fusionner', 'dossiers.lire', 'dossiers.ecrire', 'dossiers.supprimer', 'documents.ecrire', 'documents.supprimer', 'finances.voir', 'paiements.ecrire', 'taches.ecrire', 'catalogue.ecrire', 'reglages.ecrire', 'exports.faire', 'analytics.voir', 'journal.voir', 'partenaires.lire', 'partenaires.ecrire', 'partenaires.prix', 'partenaires.nets', 'partenaires.supprimer', 'fiduciaire.preparer', 'fiduciaire.gerer']::text[]
$$;

create or replace function permissions_dans(e uuid) returns text[] language sql stable security definer set search_path = public as $$
  select case
    when est_super_admin() then toutes_permissions()
    else coalesce((select case when r.tous_droits then toutes_permissions() else r.permissions end from membres m join roles r on r.id = m.role_id join profils p on p.user_id = m.user_id where m.user_id = auth.uid() and m.entite_id = e and p.actif), '{}')
  end
$$;

-- 2. Droit « partenaires.prix » -------------------------------------------------------------------------------------------------------
update roles set permissions = permissions || array['partenaires.prix']
where 'partenaires.ecrire' = any (permissions) and not ('partenaires.prix' = any (permissions));

-- Avant chaque écriture d'une prestation ou d'un trajet faite depuis l'outil (rôle « authenticated ») : sans le droit, les prix restent ce
-- qu'ils étaient. Les écritures de la base elle-même (migrations, SQL Editor, clé de service, fonctions de la base) ne sont pas concernées.
-- Volontairement sans « security definer » : current_user est alors le rôle de qui écrit.
create or replace function garder_prix_vente() returns trigger language plpgsql set search_path = public as $$
declare
  change boolean;
begin
  if current_user not in ('authenticated', 'anon') or a_permission(new.entite_id, 'partenaires.prix') then return new; end if;
  if tg_table_name = 'prestations' then
    if tg_op = 'INSERT' then
      change := new.prix_vente is not null or coalesce(new.details, '{}'::jsonb) ? 'enfant';
    else
      change := new.prix_vente is distinct from old.prix_vente or new.unite is distinct from old.unite
        or coalesce(new.details, '{}'::jsonb) -> 'enfant' is distinct from coalesce(old.details, '{}'::jsonb) -> 'enfant';
    end if;
  else
    if tg_op = 'INSERT' then
      change := new.prix_adulte is not null or new.prix_enfant is not null;
    else
      change := new.prix_adulte is distinct from old.prix_adulte or new.prix_enfant is distinct from old.prix_enfant;
    end if;
  end if;
  if change then
    raise exception using errcode = '42501', message = 'Le prix de vente est réservé aux personnes qui ont le droit « Modifier les prix de vente ». Laissez le prix tel quel, ou demandez à l''administratrice.';
  end if;
  return new;
end
$$;
drop trigger if exists garder_prix_vente on prestations;
drop trigger if exists garder_prix_vente on trajets;
create trigger garder_prix_vente before insert or update on prestations for each row execute function garder_prix_vente();
create trigger garder_prix_vente before insert or update on trajets for each row execute function garder_prix_vente();

-- 3. Historique des réglages ----------------------------------------------------------------------------------------------------------
create table if not exists reglages_historique (
  id bigint generated always as identity primary key,
  entite_id uuid not null references entites (id) on delete cascade,
  valeur jsonb not null,
  version_du timestamptz,
  remplace_le timestamptz not null default now(),
  remplace_par uuid
);
create index if not exists reglages_historique_entite on reglages_historique (entite_id, remplace_le desc);
alter table reglages_historique enable row level security;
drop policy if exists "lire l'historique des réglages" on reglages_historique;
create policy "lire l'historique des réglages" on reglages_historique for select to authenticated using (a_permission(entite_id, 'reglages.ecrire'));
-- Aucune politique d'écriture : seule la base écrit (déclencheur ci-dessous). Personne ne réécrit ni n'efface une version depuis l'outil.
revoke insert, update, delete on reglages_historique from anon, authenticated;

create or replace function archiver_reglages() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.valeur is not distinct from old.valeur then return null; end if;
  insert into reglages_historique (entite_id, valeur, version_du, remplace_par) values (old.entite_id, old.valeur, old.updated_at, auth.uid());
  delete from reglages_historique where entite_id = old.entite_id and id not in (select id from reglages_historique where entite_id = old.entite_id order by remplace_le desc, id desc limit 60);
  return null;
end
$$;
drop trigger if exists archiver_reglages on reglages;
create trigger archiver_reglages after update on reglages for each row execute function archiver_reglages();

commit;
