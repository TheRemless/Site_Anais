-- Gestion : migration 6, tâches et rappels, pièces jointes.
-- À exécuter une seule fois sur une base déjà migrée avec migration-5-echelle.sql, AVANT de publier la nouvelle version de l'outil.
-- Contient les coordonnées de l'entreprise : ce fichier ne doit pas être publié.

begin;

-- Tâches et rappels, liés ou non à un dossier, avec une échéance et une personne responsable.
create table taches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete cascade,
  dossier_id uuid,
  titre text not null,
  description text not null default '',
  echeance date,
  assignee_id uuid references profils (user_id) on delete set null,
  fait boolean not null default false,
  fait_le timestamptz,
  fait_par uuid,
  cree_par uuid default auth.uid(),
  modifie_par uuid,
  foreign key (dossier_id, entite_id) references dossiers (id, entite_id) on delete cascade
);
create index on taches (entite_id, fait, echeance);
create index on taches (assignee_id);
create index on taches (dossier_id);

-- Pièces jointes d'un dossier : le fichier est dans le stockage privé « pieces », cette table garde son nom et son chemin.
create table pieces_jointes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete cascade,
  dossier_id uuid not null,
  nom text not null,
  type text,
  taille bigint,
  chemin text not null unique,
  cree_par uuid default auth.uid(),
  foreign key (dossier_id, entite_id) references dossiers (id, entite_id) on delete cascade
);
create index on pieces_jointes (dossier_id);

-- Les rôles d'origine (Administrateur, Éditeur) reçoivent le nouveau droit sur les tâches. Les rôles personnalisés ne changent pas.
update roles set permissions = array(select distinct unnest(permissions || array['taches.ecrire'])) where systeme and nom in ('Administrateur', 'Éditeur');

-- Qui peut faire quoi, calculé à partir de la connexion en cours (auth.uid()) et de son rôle dans l'entreprise.
create or replace function toutes_permissions() returns text[] language sql immutable as $$
  select array['clients.lire', 'clients.ecrire', 'clients.supprimer', 'dossiers.lire', 'dossiers.ecrire', 'dossiers.supprimer', 'documents.ecrire', 'documents.supprimer', 'finances.voir', 'paiements.ecrire', 'taches.ecrire', 'catalogue.ecrire', 'reglages.ecrire', 'exports.faire', 'analytics.voir', 'journal.voir']::text[]
$$;

create or replace function est_super_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select super_admin and actif from profils where user_id = auth.uid()), false)
$$;

create or replace function permissions_dans(e uuid) returns text[] language sql stable security definer set search_path = public as $$
  select case
    when est_super_admin() then toutes_permissions()
    else coalesce((select r.permissions from membres m join roles r on r.id = m.role_id join profils p on p.user_id = m.user_id where m.user_id = auth.uid() and m.entite_id = e and p.actif), '{}')
  end
$$;

create or replace function a_permission(e uuid, code text) returns boolean language sql stable security definer set search_path = public as $$
  select code = any (permissions_dans(e))
$$;

create or replace function est_membre(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select est_super_admin() or exists (select 1 from membres m join profils p on p.user_id = m.user_id where m.user_id = auth.uid() and m.entite_id = e and p.actif)
$$;

-- Un rôle peut se limiter aux dossiers dont la personne est responsable ou qu'elle a créés.
create or replace function voit_tout(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select est_super_admin() or coalesce((select r.portee = 'toute' from membres m join roles r on r.id = m.role_id join profils p on p.user_id = m.user_id where m.user_id = auth.uid() and m.entite_id = e and p.actif), false)
$$;

-- Les collègues d'une entreprise, pour choisir un responsable de dossier sans ouvrir la table des profils.
create or replace function equipe_de(e uuid) returns table (user_id uuid, nom text, email text) language sql stable security definer set search_path = public as $$
  select p.user_id, p.nom, p.email from profils p
  where p.actif and est_membre(e) and (p.super_admin or exists (select 1 from membres m where m.user_id = p.user_id and m.entite_id = e))
$$;

-- Recalcule le résumé d'un dossier (total du dernier document, devise, encaissé, devis envoyé) après toute
-- modification de ses documents ou de ses paiements.
create or replace function recalculer_dossier(did uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  ent uuid;
  f jsonb;
  v jsonb;
  ve date;
begin
  select entite_id into ent from dossiers where id = did;
  if ent is null then return; end if;
  select contenu into f from documents where dossier_id = did and type = 'facture' order by date_emission desc, created_at desc limit 1;
  select contenu, envoye_le into v, ve from documents where dossier_id = did and type = 'devis' order by date_emission desc, created_at desc limit 1;
  update dossiers set devis_envoye_le = ve, a_facture = (f is not null)
  where id = did and (devis_envoye_le is distinct from ve or a_facture is distinct from (f is not null));
  insert into dossiers_resume (dossier_id, entite_id, total, devise, recu)
  values (did, ent, coalesce(total_document(coalesce(f, v)), 0), coalesce(f, v)->>'devise', (select coalesce(sum(montant), 0) from paiements where dossier_id = did))
  on conflict (dossier_id) do update set total = excluded.total, devise = excluded.devise, recu = excluded.recu;
end
$$;

create or replace function maj_resume() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform recalculer_dossier(old.dossier_id);
  else
    perform recalculer_dossier(new.dossier_id);
    if tg_op = 'UPDATE' and old.dossier_id <> new.dossier_id then perform recalculer_dossier(old.dossier_id); end if;
  end if;
  return null;
end
$$;

create or replace function creer_profil() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Le tout premier compte créé devient administrateur général.
  insert into profils (user_id, email, super_admin) values (new.id, new.email, not exists (select 1 from profils)) on conflict do nothing;
  return new;
end
$$;

create or replace function noter_modification() returns trigger language plpgsql as $$
begin
  -- Le recalcul automatique du résumé d'un dossier n'est pas une modification de la personne connectée.
  if tg_table_name = 'dossiers' and (to_jsonb(new) - array['devis_envoye_le', 'a_facture', 'modifie_par']) = (to_jsonb(old) - array['devis_envoye_le', 'a_facture', 'modifie_par']) then
    return new;
  end if;
  new.modifie_par = auth.uid();
  return new;
end
$$;

-- Journal d'activité : qui a fait quoi. Les valeurs longues (documents, réglages) ne sont pas recopiées.
create or replace function journaliser() returns trigger language plpgsql security definer set search_path = public as $$
declare
  ligne jsonb;
  ancien jsonb;
  champs jsonb := '{}';
  k text;
  libelle text;
  cible text;
begin
  ligne := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  ancien := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  cible := coalesce(ligne->>'id', (ligne->>'entite_id') || coalesce(':' || (ligne->>'user_id'), ''));
  libelle := case tg_table_name
    when 'dossiers' then ligne->>'ref'
    when 'clients' then trim(coalesce(ligne->>'prenom', '') || ' ' || coalesce(ligne->>'nom', ''))
    when 'documents' then (ligne->>'type') || ' ' || coalesce((select ref from dossiers where id = (ligne->>'dossier_id')::uuid), '')
    when 'paiements' then (ligne->>'montant') || ' ' || coalesce((select ref from dossiers where id = (ligne->>'dossier_id')::uuid), '')
    when 'catalogue' then ligne->>'libelle'
    when 'roles' then ligne->>'nom'
    when 'taches' then ligne->>'titre'
    when 'pieces_jointes' then ligne->>'nom'
    when 'membres' then coalesce((select email from profils where user_id = (ligne->>'user_id')::uuid), '')
    else ''
  end;
  if tg_op = 'UPDATE' and tg_table_name <> 'reglages' then
    for k in select jsonb_object_keys(ligne) loop
      continue when k in ('updated_at', 'modifie_par', 'devis_envoye_le', 'a_facture');
      if ligne->k is distinct from ancien->k then
        champs := champs || jsonb_build_object(k, case when length((ligne->k)::text) <= 120 and length((ancien->k)::text) <= 120 then jsonb_build_object('avant', ancien->k, 'apres', ligne->k) else to_jsonb('modifié'::text) end);
      end if;
    end loop;
    if champs = '{}'::jsonb then return null; end if;
  end if;
  insert into journal (entite_id, user_id, table_name, action, cible, libelle, details)
  values ((ligne->>'entite_id')::uuid, auth.uid(), tg_table_name, lower(tg_op), cible, libelle, champs);
  return null;
end
$$;

create trigger journaliser after insert or update or delete on taches for each row execute function journaliser();
create trigger journaliser after insert or update or delete on pieces_jointes for each row execute function journaliser();

-- Les rôles créés après la première migration ne doivent donner aucun droit à la clé publique.
revoke all on all tables in schema public from anon;

alter table taches enable row level security;
alter table pieces_jointes enable row level security;

create policy "lire les tâches" on taches for select to authenticated using (est_membre(entite_id) and (assignee_id = auth.uid() or ((voit_tout(entite_id) or assignee_id = auth.uid() or cree_par = auth.uid()) and (dossier_id is null or exists (select 1 from dossiers d where d.id = taches.dossier_id)))));
create policy "créer des tâches" on taches for insert to authenticated with check (a_permission(entite_id, 'taches.ecrire') and (dossier_id is null or exists (select 1 from dossiers d where d.id = taches.dossier_id)));
create policy "modifier des tâches" on taches for update to authenticated using ((a_permission(entite_id, 'taches.ecrire') and (voit_tout(entite_id) or assignee_id = auth.uid() or cree_par = auth.uid())) or assignee_id = auth.uid()) with check (a_permission(entite_id, 'taches.ecrire') or assignee_id = auth.uid());
create policy "supprimer des tâches" on taches for delete to authenticated using (a_permission(entite_id, 'taches.ecrire') and (voit_tout(entite_id) or assignee_id = auth.uid() or cree_par = auth.uid()));

create policy "lire les pièces jointes" on pieces_jointes for select to authenticated using (a_permission(entite_id, 'dossiers.lire') and exists (select 1 from dossiers d where d.id = pieces_jointes.dossier_id));
create policy "ajouter des pièces jointes" on pieces_jointes for insert to authenticated with check (a_permission(entite_id, 'dossiers.ecrire') and exists (select 1 from dossiers d where d.id = pieces_jointes.dossier_id));
create policy "supprimer des pièces jointes" on pieces_jointes for delete to authenticated using (a_permission(entite_id, 'dossiers.ecrire') and exists (select 1 from dossiers d where d.id = pieces_jointes.dossier_id));

-- Stockage privé des fichiers. Le premier dossier du chemin est l'identifiant de l'entreprise.
insert into storage.buckets (id, name, public) values ('pieces', 'pieces', false) on conflict (id) do nothing;
create policy "lire les fichiers" on storage.objects for select to authenticated using (bucket_id = 'pieces' and exists (select 1 from pieces_jointes p where p.chemin = storage.objects.name));
create policy "ajouter des fichiers" on storage.objects for insert to authenticated with check (bucket_id = 'pieces' and a_permission(((storage.foldername(name))[1])::uuid, 'dossiers.ecrire'));
create policy "supprimer des fichiers" on storage.objects for delete to authenticated using (bucket_id = 'pieces' and exists (select 1 from pieces_jointes p where p.chemin = storage.objects.name and a_permission(p.entite_id, 'dossiers.ecrire')));

commit;
