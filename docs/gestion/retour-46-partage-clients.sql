-- Gestion : retour en arrière de la migration 46 (fiches clients partagées). À n'exécuter que pour revenir à la migration 45.
-- Refuse de s'appliquer tant qu'un dossier pointe vers le client d'une autre entreprise : la clé à deux colonnes d'avant ne l'accepterait pas.
-- Lister ces dossiers (lecture seule) :
--   select e.slug, d.ref, c.prenom, c.nom from dossiers d join clients c on c.id = d.client_id join entites e on e.id = d.entite_id
--   where c.entite_id <> d.entite_id;
-- Pour chacun : recréer la fiche dans l'entreprise du dossier et y rattacher le dossier, ou supprimer le dossier. Puis exécuter ce fichier.
-- Une fiche en double déjà rattachée (fusionner_clients) ne revient pas : la fusion n'est pas réversible.

begin;

do $$
begin
  if exists (select 1 from dossiers d join clients c on c.id = d.client_id where c.entite_id <> d.entite_id) then
    raise exception 'Retour impossible : des dossiers utilisent le client d''une autre entreprise (voir la requête en tête du fichier)';
  end if;
end $$;

drop trigger if exists controler_client_dossier on dossiers;
drop function if exists controler_client_dossier();
drop trigger if exists garder_entite_client on clients;
drop function if exists garder_entite_client();
drop function if exists clients_lies();

alter table dossiers drop constraint if exists dossiers_client_fkey;
alter table dossiers drop constraint if exists dossiers_client_entite_fkey;
alter table dossiers add constraint dossiers_client_entite_fkey foreign key (client_id, entite_id) references clients (id, entite_id) on delete restrict;
drop index if exists dossiers_client;

-- fusionner_clients de la migration 35 (même entreprise seulement).
create or replace function fusionner_clients(p_garder uuid, p_absorbe uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare
  g clients;
  a clients;
  vide constant text := '';
begin
  select * into g from clients where id = p_garder for update;
  select * into a from clients where id = p_absorbe for update;
  if g.id is null or a.id is null or g.id = a.id or g.entite_id <> a.entite_id then
    raise exception 'Fusion impossible : les deux fiches doivent être deux clients différents de la même entreprise';
  end if;
  if not (a_permission(g.entite_id, 'clients.fusionner') or (a_permission(g.entite_id, 'clients.supprimer') and a_permission(g.entite_id, 'dossiers.ecrire'))) then
    raise exception 'Votre rôle ne permet pas de fusionner des clients' using errcode = '42501';
  end if;
  if not voit_tout(g.entite_id) then
    raise exception 'Fusion réservée aux rôles qui voient tous les dossiers de l''entreprise' using errcode = '42501';
  end if;

  update dossiers set client_id = g.id where client_id = a.id;
  update corbeille set ligne = jsonb_set(ligne, '{client_id}', to_jsonb(g.id::text))
  where table_name = 'dossiers' and entite_id = g.entite_id and ligne->>'client_id' = a.id::text;

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

drop function if exists partage_clients_permis(uuid, uuid);
drop table if exists partages_clients;
drop function if exists controler_partage_clients();

commit;
