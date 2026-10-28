-- Gestion : migration 3, rôles personnalisables, portée par dossier et journal d'activité.
-- À exécuter une seule fois sur une base déjà migrée avec migration-2-entreprises.sql, AVANT de publier la nouvelle version de l'outil.
-- Contient les coordonnées de l'entreprise : ce fichier ne doit pas être publié.

begin;

-- 1. Rôles : les deux rôles fixes deviennent des rôles modifiables, créés pour chaque entreprise.
create table roles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete cascade,
  nom text not null,
  description text not null default '',
  portee text not null default 'toute' check (portee in ('toute', 'mes_dossiers')),
  permissions text[] not null default '{}',
  systeme boolean not null default false,
  unique (entite_id, nom)
);
insert into roles (entite_id, nom, description, portee, permissions, systeme)
select e.id, v.nom, v.description, v.portee, v.permissions, true
from entites e
cross join (values
  ('Administrateur', 'Tous les droits dans l''entreprise.', 'toute', array['clients.lire', 'clients.ecrire', 'clients.supprimer', 'dossiers.lire', 'dossiers.ecrire', 'dossiers.supprimer', 'documents.ecrire', 'documents.supprimer', 'finances.voir', 'paiements.ecrire', 'catalogue.ecrire', 'reglages.ecrire', 'exports.faire', 'analytics.voir', 'journal.voir']::text[]),
  ('Éditeur', 'Clients, dossiers, devis, factures et paiements. Ni réglages ni suppression.', 'toute', array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'documents.ecrire', 'finances.voir', 'paiements.ecrire', 'catalogue.ecrire']::text[]),
  ('Lecteur', 'Consultation seulement, montants visibles.', 'toute', array['clients.lire', 'dossiers.lire', 'finances.voir', 'analytics.voir']::text[])
) as v (nom, description, portee, permissions);

alter table membres add column role_id uuid references roles (id) on delete restrict;
update membres m set role_id = r.id from roles r where r.entite_id = m.entite_id and r.nom = case m.role when 'admin' then 'Administrateur' else 'Éditeur' end;
alter table membres alter column role_id set not null;
alter table membres drop column role;
create index on roles (entite_id);

-- 2. Responsable de dossier : par défaut la personne qui l'a créé.
alter table dossiers add column responsable_id uuid references profils (user_id) on delete set null default auth.uid();
update dossiers set responsable_id = cree_par where cree_par in (select user_id from profils);
create index on dossiers (responsable_id);

-- 3. Journal d'activité.
create table journal (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  entite_id uuid references entites (id) on delete cascade,
  user_id uuid,
  table_name text not null,
  action text not null,
  cible text,
  libelle text,
  details jsonb not null default '{}'
);
create index on journal (entite_id, created_at desc);

-- 4. Anciennes règles et fonctions remplacées par celles des droits fins.
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
drop function if exists peut_lire(uuid);
drop function if exists peut_ecrire(uuid);
drop function if exists est_admin_de(uuid);
drop function if exists role_dans(uuid);

-- Qui peut faire quoi, calculé à partir de la connexion en cours (auth.uid()) et de son rôle dans l'entreprise.
create or replace function toutes_permissions() returns text[] language sql immutable as $$
  select array['clients.lire', 'clients.ecrire', 'clients.supprimer', 'dossiers.lire', 'dossiers.ecrire', 'dossiers.supprimer', 'documents.ecrire', 'documents.supprimer', 'finances.voir', 'paiements.ecrire', 'catalogue.ecrire', 'reglages.ecrire', 'exports.faire', 'analytics.voir', 'journal.voir']::text[]
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

create trigger journaliser after insert or update or delete on clients for each row execute function journaliser();
create trigger journaliser after insert or update or delete on dossiers for each row execute function journaliser();
create trigger journaliser after insert or update or delete on documents for each row execute function journaliser();
create trigger journaliser after insert or update or delete on paiements for each row execute function journaliser();
create trigger journaliser after insert or update or delete on catalogue for each row execute function journaliser();
create trigger journaliser after insert or update or delete on reglages for each row execute function journaliser();
create trigger journaliser after insert or update or delete on roles for each row execute function journaliser();
create trigger journaliser after insert or update or delete on membres for each row execute function journaliser();

-- Sécurité : le visiteur anonyme n'a accès à rien. Une personne connectée n'accède qu'aux entreprises dont elle est
-- membre, avec les droits de son rôle, et seulement aux dossiers que la portée de son rôle lui montre.
revoke all on all tables in schema public from anon;

alter table entites enable row level security;
alter table profils enable row level security;
alter table roles enable row level security;
alter table membres enable row level security;
alter table reglages enable row level security;
alter table journal enable row level security;
alter table clients enable row level security;
alter table dossiers enable row level security;
alter table documents enable row level security;
alter table paiements enable row level security;
alter table catalogue enable row level security;

create policy "voir ses entreprises" on entites for select to authenticated using (est_membre(id));
create policy "gérer les entreprises" on entites for all to authenticated using (est_super_admin()) with check (est_super_admin());

create policy "voir son profil" on profils for select to authenticated using (user_id = auth.uid() or est_super_admin());
create policy "gérer les profils" on profils for update to authenticated using (est_super_admin()) with check (est_super_admin());

create policy "voir les rôles" on roles for select to authenticated using (est_membre(entite_id));
create policy "gérer les rôles" on roles for all to authenticated using (est_super_admin()) with check (est_super_admin());

create policy "voir ses accès" on membres for select to authenticated using (user_id = auth.uid() or est_super_admin());
create policy "gérer les accès" on membres for all to authenticated using (est_super_admin()) with check (est_super_admin());

create policy "lire les réglages" on reglages for select to authenticated using (est_membre(entite_id));
create policy "modifier les réglages" on reglages for all to authenticated using (a_permission(entite_id, 'reglages.ecrire')) with check (a_permission(entite_id, 'reglages.ecrire'));

create policy "lire le journal" on journal for select to authenticated using (a_permission(entite_id, 'journal.voir'));
revoke insert, update, delete on journal from authenticated;

create policy "lire le catalogue" on catalogue for select to authenticated using (est_membre(entite_id));
create policy "modifier le catalogue" on catalogue for all to authenticated using (a_permission(entite_id, 'catalogue.ecrire')) with check (a_permission(entite_id, 'catalogue.ecrire'));

create policy "lire les dossiers" on dossiers for select to authenticated using (a_permission(entite_id, 'dossiers.lire') and (voit_tout(entite_id) or responsable_id = auth.uid() or cree_par = auth.uid()));
create policy "créer des dossiers" on dossiers for insert to authenticated with check (a_permission(entite_id, 'dossiers.ecrire'));
create policy "modifier des dossiers" on dossiers for update to authenticated using (a_permission(entite_id, 'dossiers.ecrire') and (voit_tout(entite_id) or responsable_id = auth.uid() or cree_par = auth.uid())) with check (a_permission(entite_id, 'dossiers.ecrire'));
create policy "supprimer des dossiers" on dossiers for delete to authenticated using (a_permission(entite_id, 'dossiers.supprimer') and (voit_tout(entite_id) or responsable_id = auth.uid() or cree_par = auth.uid()));

create policy "lire les clients" on clients for select to authenticated using (a_permission(entite_id, 'clients.lire') and (voit_tout(entite_id) or cree_par = auth.uid() or exists (select 1 from dossiers d where d.client_id = clients.id)));
create policy "créer des clients" on clients for insert to authenticated with check (a_permission(entite_id, 'clients.ecrire'));
create policy "modifier des clients" on clients for update to authenticated using (a_permission(entite_id, 'clients.ecrire')) with check (a_permission(entite_id, 'clients.ecrire'));
create policy "supprimer des clients" on clients for delete to authenticated using (a_permission(entite_id, 'clients.supprimer'));

-- Montants : sans le droit « finances », ni devis, ni factures, ni paiements ne sont lisibles.
create policy "lire les documents" on documents for select to authenticated using (a_permission(entite_id, 'finances.voir') and exists (select 1 from dossiers d where d.id = documents.dossier_id));
create policy "créer des documents" on documents for insert to authenticated with check (a_permission(entite_id, 'documents.ecrire') and exists (select 1 from dossiers d where d.id = documents.dossier_id));
create policy "modifier des documents" on documents for update to authenticated using (a_permission(entite_id, 'documents.ecrire') and exists (select 1 from dossiers d where d.id = documents.dossier_id)) with check (a_permission(entite_id, 'documents.ecrire'));
create policy "supprimer des documents" on documents for delete to authenticated using (a_permission(entite_id, 'documents.supprimer') and exists (select 1 from dossiers d where d.id = documents.dossier_id));

create policy "lire les paiements" on paiements for select to authenticated using (a_permission(entite_id, 'finances.voir') and exists (select 1 from dossiers d where d.id = paiements.dossier_id));
create policy "créer des paiements" on paiements for insert to authenticated with check (a_permission(entite_id, 'paiements.ecrire') and exists (select 1 from dossiers d where d.id = paiements.dossier_id));
create policy "modifier des paiements" on paiements for update to authenticated using (a_permission(entite_id, 'paiements.ecrire') and exists (select 1 from dossiers d where d.id = paiements.dossier_id)) with check (a_permission(entite_id, 'paiements.ecrire'));
create policy "supprimer des paiements" on paiements for delete to authenticated using (a_permission(entite_id, 'paiements.ecrire') and exists (select 1 from dossiers d where d.id = paiements.dossier_id));

commit;
