-- Gestion : migration 46, fiches clients partagées entre entreprises d'une même organisation (demande de Jérémy, 18.11.2026).
-- Un client de l'agence de voyages qui a besoin d'un transfert ou d'une excursion n'est plus recréé dans chaque entreprise : la fiche
-- de l'entreprise qui partage (ZTP chez Zwald) est utilisée telle quelle dans les dossiers des entreprises qui la reçoivent (Secret, Taxi).
-- Une seule fiche, sans copie : un changement fait d'un côté se voit de l'autre.
--
-- Règles :
--   * le partage est un réglage de l'organisation (partages_clients : « source partage ses clients avec cible »), écrit par son
--     administration générale. Deux entreprises d'organisations différentes ne partagent jamais rien ;
--   * sens unique : la cible utilise les fiches de la source, jamais l'inverse ;
--   * seules les fiches clients passent d'une entreprise à l'autre. Un dossier de la cible au client de la source reste un dossier de la cible ;
--   * seule l'administration (administration générale, ou administratrice des deux entreprises) relie un dossier à une fiche d'une autre
--     entreprise, et seulement si elle lit cette fiche (droit « clients.lire » sur tous les clients de la source) ;
--   * la lecture des fiches ne change pas : « lire les clients » demande toujours le droit dans l'entreprise de la fiche. Un compte sans
--     accès à la source (l'assistante de Secret et de Taxi) ne lit aucune fiche de la source, même au client d'un dossier qu'elle voit.
--     Elle reçoit seulement la civilité, le prénom et le nom de ces clients (clients_lies), pour le voucher.
--
-- Ce que la migration change :
--   1. table partages_clients, lue par l'organisation, écrite par son administration générale ;
--   2. la clé dossiers -> clients ne demande plus la même entreprise : un déclencheur la remplace (même entreprise, ou partage permis) ;
--   3. une fiche utilisée par des dossiers ne change plus d'entreprise (la clé à deux colonnes l'empêchait) ;
--   4. clients_lies() : nom des clients d'une autre entreprise aux dossiers que la personne voit ;
--   5. fusionner_clients rattache aussi une fiche en double de la cible à la fiche de la source (doublons d'avant le partage) ;
--   6. Zwald : ZTP partage ses clients avec Secret et Taxi.
-- Dépend des migrations 35 et 42. Idempotente. Retour en arrière : retour-46-partage-clients.sql. Contrôle : verif-partage-clients.mjs.

begin;

-- 1. Le réglage.
create table if not exists partages_clients (
  source_id uuid not null references entites (id) on delete cascade,
  cible_id uuid not null references entites (id) on delete cascade,
  organisation_id uuid not null references organisations (id) on delete cascade,
  cree_le timestamptz not null default now(),
  cree_par uuid default auth.uid(),
  primary key (source_id, cible_id),
  check (source_id <> cible_id)
);
create index if not exists partages_clients_cible on partages_clients (cible_id);
alter table partages_clients enable row level security;

-- Les deux entreprises sont de la même organisation, qui est celle de la ligne (la valeur envoyée n'est jamais crue).
create or replace function controler_partage_clients() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if organisation_de(new.source_id) is distinct from organisation_de(new.cible_id) then
    raise exception 'Partage impossible : les deux entreprises doivent être de la même organisation' using errcode = '42501';
  end if;
  new.organisation_id := organisation_de(new.source_id);
  return new;
end
$$;
drop trigger if exists controler_partage_clients on partages_clients;
create trigger controler_partage_clients before insert or update on partages_clients for each row execute function controler_partage_clients();

revoke all on partages_clients from anon, authenticated;
grant select, insert, delete on partages_clients to authenticated;
drop policy if exists "voir les partages" on partages_clients;
create policy "voir les partages" on partages_clients for select to authenticated using (organisation_id = mon_organisation());
drop policy if exists "créer un partage" on partages_clients;
create policy "créer un partage" on partages_clients for insert to authenticated
  with check (est_super_admin() and organisation_de(source_id) = mon_organisation() and organisation_de(cible_id) = mon_organisation());
drop policy if exists "retirer un partage" on partages_clients;
create policy "retirer un partage" on partages_clients for delete to authenticated using (est_super_admin() and organisation_id = mon_organisation());

-- La personne connectée peut-elle relier un dossier de « cible » à une fiche de « source » ?
create or replace function partage_clients_permis(p_source uuid, p_cible uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from partages_clients where source_id = p_source and cible_id = p_cible)
    and organisation_de(p_source) = mon_organisation() and organisation_de(p_cible) = mon_organisation()
    and (est_super_admin() or (a_permission(p_source, 'reglages.ecrire') and a_permission(p_cible, 'reglages.ecrire')))
    and a_permission(p_source, 'clients.lire') and voit_tout(p_source)
    and a_permission(p_cible, 'dossiers.ecrire')
$$;
revoke all on function partage_clients_permis(uuid, uuid) from public, anon;
grant execute on function partage_clients_permis(uuid, uuid) to authenticated;

-- 2. La clé du client d'un dossier : une fiche existante (on delete restrict, comme avant), de la même entreprise ou d'une entreprise qui
-- la partage. Les anciens noms de la clé à deux colonnes : dossiers_client_entite_fkey (migration 2), dossiers_client_id_entite_id_fkey (schema.sql).
alter table dossiers drop constraint if exists dossiers_client_entite_fkey;
alter table dossiers drop constraint if exists dossiers_client_id_entite_id_fkey;
alter table dossiers drop constraint if exists dossiers_client_fkey;
alter table dossiers add constraint dossiers_client_fkey foreign key (client_id) references clients (id) on delete restrict;
create index if not exists dossiers_client on dossiers (client_id);

create or replace function controler_client_dossier() returns trigger language plpgsql security definer set search_path = public as $$
declare
  ec uuid;
begin
  select entite_id into ec from clients where id = new.client_id;
  if ec is null or ec = new.entite_id then return new; end if;  -- client absent : la clé étrangère répond
  -- Un dossier déjà relié à ce client garde son lien (l'assistante modifie le dossier sans voir la fiche ; partage retiré depuis).
  if tg_op = 'UPDATE' and new.client_id = old.client_id and new.entite_id = old.entite_id then return new; end if;
  if not exists (select 1 from partages_clients where source_id = ec and cible_id = new.entite_id) then
    raise exception 'Ce client appartient à une autre entreprise qui ne partage pas ses clients avec celle-ci' using errcode = '42501';
  end if;
  -- Sans connexion (éditeur SQL de Supabase, clé de service) : le partage suffit. Connecté : l'administration seulement.
  if auth.uid() is not null and not partage_clients_permis(ec, new.entite_id) then
    raise exception 'Seule l''administration utilise les clients d''une autre entreprise' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists controler_client_dossier on dossiers;
create trigger controler_client_dossier before insert or update of client_id, entite_id on dossiers for each row execute function controler_client_dossier();

-- 3. Une fiche utilisée par des dossiers ne change pas d'entreprise (la clé à deux colonnes le refusait déjà). Sans cette garde, un import de
-- sauvegarde qui réécrit entite_id déplacerait la fiche de la source dans la cible.
create or replace function garder_entite_client() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.entite_id is distinct from old.entite_id and exists (select 1 from dossiers where client_id = old.id) then
    raise exception 'Ce client a des dossiers : il ne change pas d''entreprise' using errcode = '23503';
  end if;
  return new;
end
$$;
drop trigger if exists garder_entite_client on clients;
create trigger garder_entite_client before update of entite_id on clients for each row execute function garder_entite_client();

-- 4. Le nom des clients d'une autre entreprise, pour les dossiers que la personne voit (même règle que « lire les dossiers »).
-- Rien d'autre de la fiche : ni téléphone, ni e-mail, ni adresse, ni notes.
create or replace function clients_lies() returns table (id uuid, entite_id uuid, civilite text, prenom text, nom text)
language sql stable security definer set search_path = public as $$
  select distinct c.id, c.entite_id, c.civilite, c.prenom, c.nom
  from dossiers d join clients c on c.id = d.client_id
  where c.entite_id <> d.entite_id
    and organisation_de(d.entite_id) = mon_organisation()
    and a_permission(d.entite_id, 'dossiers.lire')
    and (voit_tout(d.entite_id) or d.responsable_id = auth.uid() or d.cree_par = auth.uid())
$$;
revoke all on function clients_lies() from public, anon;
grant execute on function clients_lies() to authenticated;

-- 5. Fusion : comme la migration 35 dans une entreprise. En plus, une fiche de la cible (« absorbe ») se rattache à la fiche de la source
-- (« garder ») : ses dossiers restent dans la cible et pointent vers la fiche de la source, les champs vides de celle-ci se remplissent,
-- la fiche en double disparaît. Jamais l'inverse : une fiche de la source ne disparaît pas dans la cible.
-- Connecté : droit de fusion et vue sur tous les dossiers dans la cible, partage permis (administration). Sans connexion (éditeur SQL,
-- rattachement des doublons validés par Jérémy) : le partage suffit.
create or replace function fusionner_clients(p_garder uuid, p_absorbe uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare
  g clients;
  a clients;
  vide constant text := '';
begin
  select * into g from clients where id = p_garder for update;
  select * into a from clients where id = p_absorbe for update;
  if g.id is null or a.id is null or g.id = a.id then
    raise exception 'Fusion impossible : les deux fiches doivent être deux clients différents de la même entreprise';
  end if;
  if g.entite_id <> a.entite_id and not exists (select 1 from partages_clients where source_id = g.entite_id and cible_id = a.entite_id) then
    raise exception 'Fusion impossible : les deux fiches doivent être deux clients différents de la même entreprise';
  end if;
  if auth.uid() is not null then
    if not (a_permission(a.entite_id, 'clients.fusionner') or (a_permission(a.entite_id, 'clients.supprimer') and a_permission(a.entite_id, 'dossiers.ecrire'))) then
      raise exception 'Votre rôle ne permet pas de fusionner des clients' using errcode = '42501';
    end if;
    if not voit_tout(a.entite_id) then
      raise exception 'Fusion réservée aux rôles qui voient tous les dossiers de l''entreprise' using errcode = '42501';
    end if;
    if g.entite_id <> a.entite_id and not (partage_clients_permis(g.entite_id, a.entite_id) and a_permission(g.entite_id, 'clients.ecrire')) then
      raise exception 'Seule l''administration rattache un client à la fiche d''une autre entreprise' using errcode = '42501';
    end if;
  end if;

  update dossiers set client_id = g.id where client_id = a.id;
  -- Un dossier de l'autre fiche resté dans la corbeille pointe désormais vers la fiche gardée : il reste restaurable.
  update corbeille set ligne = jsonb_set(ligne, '{client_id}', to_jsonb(g.id::text))
  where table_name = 'dossiers' and entite_id = a.entite_id and ligne->>'client_id' = a.id::text;

  update clients set
    civilite = case when coalesce(trim(g.civilite), vide) = vide and coalesce(trim(a.civilite), vide) <> vide then a.civilite else g.civilite end,
    prenom = case when coalesce(trim(g.prenom), vide) = vide and coalesce(trim(a.prenom), vide) <> vide then a.prenom else g.prenom end,
    nom = case when coalesce(trim(g.nom), vide) = vide and coalesce(trim(a.nom), vide) <> vide then a.nom else g.nom end,
    telephone = case when coalesce(trim(g.telephone), vide) = vide and coalesce(trim(a.telephone), vide) <> vide then a.telephone else g.telephone end,
    email = case when coalesce(trim(g.email), vide) = vide and coalesce(trim(a.email), vide) <> vide then a.email else g.email end,
    adresse = case when coalesce(trim(g.adresse), vide) = vide and coalesce(trim(a.adresse), vide) <> vide then a.adresse else g.adresse end,
    notes = case
      when coalesce(trim(a.notes), vide) = vide or trim(a.notes) = coalesce(trim(g.notes), vide) then g.notes
      when coalesce(trim(g.notes), vide) = vide then trim(a.notes)
      else trim(g.notes) || E'\n' || trim(a.notes)
    end
  where id = g.id;

  delete from clients where id = a.id;
  return g.id;
end $$;
revoke all on function fusionner_clients(uuid, uuid) from public, anon;
grant execute on function fusionner_clients(uuid, uuid) to authenticated;

-- 6. Zwald : ZTP partage ses clients avec Secret et Taxi. Seulement sur la base d'Anaïs (organisation …a000) ; ailleurs, rien.
insert into partages_clients (source_id, cible_id, organisation_id)
select s.id, c.id, s.organisation_id
from entites s join entites c on c.organisation_id = s.organisation_id
where s.organisation_id = '00000000-0000-0000-0000-00000000a000' and s.slug = 'ztp' and c.slug in ('secret', 'taxi')
on conflict do nothing;

commit;
