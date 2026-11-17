-- Gestion : migration 42, plusieurs organisations (préparation du logiciel pour d'autres clients).
-- Une organisation est un client du logiciel. Elle regroupe ses entreprises (entites) et ses comptes (profils).
-- La base actuelle devient l'organisation « Zwald Travel Planner » (ZTP, Secret, Taxi) : rien ne change pour ses comptes.
--
-- Ce que la migration change :
--   * « administratrice générale » (profils.super_admin) veut dire désormais « administrateur de son organisation » : elle ne voit plus que les entreprises de son organisation ;
--   * profils.plateforme : le compte de l'éditeur du logiciel, qui crée les organisations (creer_organisation). Il ne donne accès à aucune donnée ;
--   * le tout premier compte créé ne devient plus administrateur automatiquement ;
--   * un compte ne peut être membre que des entreprises de son organisation ;
--   * numérotation des factures pour la fiduciaire séparée par organisation ;
--   * entreprises qui publient sur un site : réglage de l'entreprise (publie_site), plus des noms écrits dans le code ;
--   * suivi des rappels rangé par organisation.
-- À exécuter une seule fois, après les migrations précédentes. Idempotente.

begin;

-- 1. Organisations.
create table if not exists organisations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nom text not null check (length(nom) between 1 and 120),
  fuseau text not null default 'Asia/Bangkok' check (length(fuseau) between 1 and 60),
  langue text not null default 'en' check (langue in ('fr', 'en')),
  statut text not null default 'actif' check (statut in ('essai', 'actif', 'suspendu')),
  -- Options payantes activées : 'whatsapp', 'assistant'. Les rappels sont toujours inclus.
  options text[] not null default '{}' check (options <@ array['whatsapp', 'assistant'])
);
alter table organisations enable row level security;
revoke all on organisations from anon, authenticated;

insert into organisations (id, nom, fuseau, langue, options)
values ('00000000-0000-0000-0000-00000000a000', 'Zwald Travel Planner', 'Asia/Bangkok', 'fr', array['whatsapp', 'assistant'])
on conflict (id) do nothing;

-- 2. Rattachement des entreprises et des comptes.
alter table entites add column if not exists organisation_id uuid references organisations (id) on delete restrict;
update entites set organisation_id = '00000000-0000-0000-0000-00000000a000' where organisation_id is null;
alter table entites alter column organisation_id set not null;
alter table entites drop constraint if exists entites_slug_key;
create unique index if not exists entites_organisation_slug on entites (organisation_id, slug);
create index if not exists entites_organisation on entites (organisation_id);
-- Les entreprises qui reçoivent les demandes et publient les bandeaux d'un site public.
alter table entites add column if not exists publie_site boolean not null default false;
update entites set publie_site = true where organisation_id = '00000000-0000-0000-0000-00000000a000' and slug in ('secret', 'taxi') and not publie_site;

alter table profils add column if not exists organisation_id uuid references organisations (id) on delete restrict;
alter table profils add column if not exists plateforme boolean not null default false;
update profils set organisation_id = '00000000-0000-0000-0000-00000000a000' where organisation_id is null;
create index if not exists profils_organisation on profils (organisation_id);

-- 3. Droits, calculés dans l'organisation de la personne connectée.
create or replace function mon_organisation() returns uuid language sql stable security definer set search_path = public as $$
  select organisation_id from profils where user_id = auth.uid() and actif
$$;
create or replace function organisation_de(e uuid) returns uuid language sql stable security definer set search_path = public as $$
  select organisation_id from entites where id = e
$$;
create or replace function est_plateforme() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select plateforme and actif from profils where user_id = auth.uid()), false)
$$;
-- Administrateur de son organisation (le nom de la fonction est gardé : l'outil et les politiques l'appellent déjà).
create or replace function est_super_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select super_admin and actif and organisation_id is not null from profils where user_id = auth.uid()), false)
$$;
create or replace function admin_de(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select est_super_admin() and exists (select 1 from entites where id = e and organisation_id = mon_organisation())
$$;
revoke all on function mon_organisation(), organisation_de(uuid), est_plateforme(), admin_de(uuid) from public, anon;
grant execute on function mon_organisation(), organisation_de(uuid), est_plateforme(), admin_de(uuid) to authenticated;

-- Un accès (membres) ne vaut que dans une entreprise de l'organisation du compte : une ligne restée d'une autre organisation n'ouvre rien.
create or replace function permissions_dans(e uuid) returns text[] language sql stable security definer set search_path = public as $$
  select case
    when admin_de(e) then toutes_permissions()
    -- Rôle « tous droits » (Administrateur calculé, migration 38) : toutes les permissions, même celles ajoutées après sa création.
    else coalesce((select case when r.tous_droits then toutes_permissions() else r.permissions end from membres m join roles r on r.id = m.role_id join profils p on p.user_id = m.user_id where m.user_id = auth.uid() and m.entite_id = e and p.actif and p.organisation_id = organisation_de(e)), '{}')
  end
$$;

create or replace function est_membre(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select admin_de(e) or exists (select 1 from membres m join profils p on p.user_id = m.user_id where m.user_id = auth.uid() and m.entite_id = e and p.actif and p.organisation_id = organisation_de(e))
$$;

create or replace function voit_tout(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select admin_de(e) or coalesce((select r.portee = 'toute' from membres m join roles r on r.id = m.role_id join profils p on p.user_id = m.user_id where m.user_id = auth.uid() and m.entite_id = e and p.actif and p.organisation_id = organisation_de(e)), false)
$$;

create or replace function equipe_de(e uuid) returns table (user_id uuid, nom text, email text) language sql stable security definer set search_path = public as $$
  select p.user_id, p.nom, p.email from profils p
  where p.actif and est_membre(e)
    and ((p.super_admin and p.organisation_id = organisation_de(e)) or exists (select 1 from membres m where m.user_id = p.user_id and m.entite_id = e))
$$;

-- Un nouveau compte n'a aucun droit. Son organisation :
--   * celle de la métadonnée d'application organisation_id (raw_app_meta_data, que seule la clé de service écrit). La métadonnée
--     « utilisateur » (raw_user_meta_data) n'est jamais crue pour l'organisation : n'importe qui la choisit en s'inscrivant avec la clé publique ;
--   * aucune si l'invitation annonce une nouvelle organisation (nouvelle_organisation), créée ensuite par creer_organisation ;
--   * sinon, tant qu'il n'existe qu'une organisation, celle-ci : un compte ajouté à la main dans Supabase apparaît dans « Utilisateurs », comme avant.
-- La fonction « invitation » (clé de service) rattache elle-même l'invité à l'organisation de l'administrateur, juste après sa création.
create or replace function creer_profil() returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(to_jsonb(new)->'raw_user_meta_data', '{}'::jsonb);
  app jsonb := coalesce(to_jsonb(new)->'raw_app_meta_data', '{}'::jsonb);
  org uuid;
begin
  if app->>'organisation_id' ~ '^[0-9a-f-]{36}$' then
    select id into org from organisations where id = (app->>'organisation_id')::uuid;
  elsif coalesce(meta->>'nouvelle_organisation', '') <> 'true' and (select count(*) from organisations) = 1 then
    select id into org from organisations;
  end if;
  -- Langue de départ du compte : celle de l'organisation (Réglages > Administration). Chacun la change ensuite pour lui.
  insert into profils (user_id, email, super_admin, organisation_id, langue)
  values (new.id, new.email, false, org, (select langue from organisations where id = org)) on conflict do nothing;
  return new;
end
$$;

-- 4. Garde-fous sur les profils et les accès.
-- Seuls l'éditeur, le SQL sans connexion et le déclencheur des accès (controler_membre, profondeur 2) changent l'organisation d'un compte ou le statut d'éditeur.
-- Pas de drapeau de session : n'importe quel compte pourrait le poser lui-même avec set_config.
create or replace function proteger_profil() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Sans connexion (éditeur SQL de Supabase, clé de service), éditeur, ou mise à jour faite par un autre déclencheur : autorisé.
  -- Un compte déjà rattaché ne change jamais d'organisation, même avec la clé de service ou par un déclencheur : seul l'éditeur connecté
  -- le peut. Une fonction serveur trompée (invitation d'une adresse d'un autre client) ne déplace donc pas un compte (revue de sécurité, 17.11.2026).
  -- Un compte sans organisation reçoit la sienne (creer_organisation, controler_membre, invitation).
  if old.organisation_id is not null and new.organisation_id is distinct from old.organisation_id and not est_plateforme() then
    raise exception 'Organisation d''un compte non modifiable' using errcode = '42501';
  end if;
  if auth.uid() is null or est_plateforme() or pg_trigger_depth() > 1 then
    if new.plateforme is distinct from old.plateforme and auth.uid() is not null and not est_plateforme() then raise exception 'Statut d''éditeur non modifiable' using errcode = '42501'; end if;
    return new;
  end if;
  if new.plateforme is distinct from old.plateforme then raise exception 'Statut d''éditeur non modifiable' using errcode = '42501'; end if;
  if new.organisation_id is distinct from old.organisation_id then raise exception 'Organisation d''un compte non modifiable' using errcode = '42501'; end if;
  return new;
end
$$;
drop trigger if exists proteger_profil on profils;
create trigger proteger_profil before update on profils for each row execute function proteger_profil();

-- Un accès lie un compte à une entreprise de sa propre organisation. Un compte sans organisation est rattaché à celle de l'entreprise.
create or replace function controler_membre() returns trigger language plpgsql security definer set search_path = public as $$
declare
  org_compte uuid;
  org_entite uuid;
begin
  select organisation_id into org_compte from profils where user_id = new.user_id;
  org_entite := organisation_de(new.entite_id);
  if org_compte is null then
    -- Un compte invité pour une nouvelle organisation attend creer_organisation : personne d'autre ne le prend.
    if exists (select 1 from auth.users u where u.id = new.user_id and coalesce(to_jsonb(u)->'raw_user_meta_data'->>'nouvelle_organisation', '') = 'true') then
      raise exception 'Ce compte attend la création de sa propre organisation' using errcode = '42501';
    end if;
    update profils set organisation_id = org_entite where user_id = new.user_id;
  elsif org_compte <> org_entite then
    raise exception 'Ce compte appartient à une autre organisation' using errcode = '42501';
  end if;
  if not exists (select 1 from roles where id = new.role_id and entite_id = new.entite_id) then
    raise exception 'Ce rôle appartient à une autre entreprise' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists controler_membre on membres;
create trigger controler_membre before insert or update on membres for each row execute function controler_membre();

-- Nouvelle entreprise : dans l'organisation de la personne qui la crée.
alter table entites alter column organisation_id set default mon_organisation();

drop policy if exists "gérer les entreprises" on entites;
create policy "gérer les entreprises" on entites for all to authenticated
  using (est_super_admin() and organisation_id = mon_organisation())
  with check (est_super_admin() and organisation_id = mon_organisation());

drop policy if exists "voir son profil" on profils;
create policy "voir son profil" on profils for select to authenticated
  using (user_id = auth.uid() or (est_super_admin() and organisation_id = mon_organisation()));
drop policy if exists "gérer les profils" on profils;
create policy "gérer les profils" on profils for update to authenticated
  using (est_super_admin() and organisation_id = mon_organisation())
  with check (est_super_admin() and organisation_id = mon_organisation());

drop policy if exists "gérer les rôles" on roles;
create policy "gérer les rôles" on roles for all to authenticated using (admin_de(entite_id)) with check (admin_de(entite_id));

drop policy if exists "voir ses accès" on membres;
create policy "voir ses accès" on membres for select to authenticated using (user_id = auth.uid() or admin_de(entite_id));
drop policy if exists "gérer les accès" on membres;
create policy "gérer les accès" on membres for all to authenticated using (admin_de(entite_id)) with check (admin_de(entite_id));

-- L'organisation : ses membres la lisent, son administrateur règle le fuseau et la langue. Le statut et les options restent à l'éditeur.
grant select on organisations to authenticated;
grant update (nom, fuseau, langue) on organisations to authenticated;
drop policy if exists "voir son organisation" on organisations;
create policy "voir son organisation" on organisations for select to authenticated using (id = mon_organisation() or est_plateforme());
drop policy if exists "régler son organisation" on organisations;
create policy "régler son organisation" on organisations for update to authenticated
  using (est_super_admin() and id = mon_organisation())
  with check (est_super_admin() and id = mon_organisation());

-- 5. Création d'une organisation par l'éditeur, pendant l'appel de mise en route.
-- Le futur administrateur a déjà créé son compte (lien d'invitation) : il devient administrateur de la nouvelle organisation.
create or replace function creer_organisation(p_nom text, p_email_admin text, p_fuseau text default 'Asia/Bangkok', p_langue text default 'en')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid;
  compte profils;
begin
  if not est_plateforme() then raise exception 'Réservé à l''éditeur du logiciel' using errcode = '42501'; end if;
  select * into compte from profils where lower(email) = lower(trim(p_email_admin));
  if not found then raise exception 'Aucun compte avec cette adresse : la personne doit d''abord créer son compte'; end if;
  if compte.organisation_id is not null then raise exception 'Ce compte appartient déjà à une organisation'; end if;
  insert into organisations (nom, fuseau, langue) values (trim(p_nom), coalesce(p_fuseau, 'Asia/Bangkok'), coalesce(p_langue, 'en')) returning id into org;
  update profils set organisation_id = org, super_admin = true where user_id = compte.user_id;
  return org;
end
$$;
revoke all on function creer_organisation(text, text, text, text) from public, anon;
grant execute on function creer_organisation(text, text, text, text) to authenticated;

-- 6. Fiduciaire : une série de numéros par organisation. Depuis la migration 36, l'émetteur, la date de départ et les préfixes sont déjà
-- des réglages de chaque entreprise (fiduciaire_reglages). Il restait la série (préfixe, année) commune à toute la base : deux organisations
-- avec le préfixe COM se seraient partagé les numéros. La série devient (organisation, préfixe, année), le numéro unique dans l'organisation.
alter table fiduciaire_compteurs add column if not exists organisation_id uuid references organisations (id) on delete cascade;
update fiduciaire_compteurs set organisation_id = '00000000-0000-0000-0000-00000000a000' where organisation_id is null;
alter table fiduciaire_compteurs alter column organisation_id set not null;
alter table fiduciaire_compteurs drop constraint if exists fiduciaire_compteurs_pkey;
alter table fiduciaire_compteurs add primary key (organisation_id, prefixe, annee);

alter table fiduciaire_factures add column if not exists organisation_id uuid references organisations (id) on delete restrict;
alter table fiduciaire_factures disable trigger figer;
update fiduciaire_factures f set organisation_id = e.organisation_id from entites e where e.id = f.entite_id and f.organisation_id is null;
alter table fiduciaire_factures enable trigger figer;
alter table fiduciaire_factures alter column organisation_id set not null;
alter table fiduciaire_factures drop constraint if exists fiduciaire_factures_numero_key;
create unique index if not exists fiduciaire_factures_org_numero on fiduciaire_factures (organisation_id, numero);

create or replace function fiduciaire_organisation() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.organisation_id := organisation_de(new.entite_id);
  return new;
end
$$;
drop trigger if exists fiduciaire_organisation on fiduciaire_factures;
create trigger fiduciaire_organisation before insert on fiduciaire_factures for each row execute function fiduciaire_organisation();

-- Même signature que la migration 36 (appelée par emettre_facture_fiduciaire et annuler_facture_fiduciaire, qui ont déjà vérifié
-- que la personne écrit dans l'entreprise du service, donc dans son organisation).
create or replace function fiduciaire_prochain_numero(p_genre text, p_jour date, p_prefixe text, out o_annee integer, out o_seq integer, out o_numero text)
language plpgsql security definer set search_path = public as $$
declare
  org uuid := mon_organisation();
begin
  if org is null then raise exception 'Compte sans organisation' using errcode = '42501'; end if;
  o_annee := extract(year from p_jour)::int;
  insert into fiduciaire_compteurs (organisation_id, prefixe, annee, type, dernier) values (org, p_prefixe, o_annee, p_genre, 0) on conflict do nothing;
  update fiduciaire_compteurs set dernier = dernier + 1 where organisation_id = org and prefixe = p_prefixe and annee = o_annee returning dernier into o_seq;
  o_numero := p_prefixe || '-' || o_annee || '-' || lpad(o_seq::text, 3, '0');
end
$$;
revoke all on function fiduciaire_prochain_numero(text, date, text) from public, anon, authenticated;

-- 7. Site public : n'importe quelle entreprise marquée publie_site, plus seulement « secret » et « taxi ».
alter table demandes_site drop constraint if exists demandes_site_marque_check;
alter table demandes_site add constraint demandes_site_marque_check check (marque ~ '^[a-z0-9-]{1,40}$');
alter table bandeaux_site drop constraint if exists bandeaux_site_marques_check;
alter table bandeaux_site add constraint bandeaux_site_marques_check
  check (cardinality(marques) between 1 and 5 and array_to_string(marques, ',') ~ '^[a-z0-9-]{1,40}(,[a-z0-9-]{1,40})*$');

-- Une marque est le slug d'une entreprise de la même organisation qui publie sur un site.
create or replace function controler_marques_site() returns trigger language plpgsql security definer set search_path = public as $$
declare
  org uuid := organisation_de(new.entite_id);
  ms text[];
begin
  select array(select jsonb_array_elements_text(coalesce(to_jsonb(new)->'marques', jsonb_build_array(to_jsonb(new)->>'marque')))) into ms;
  if exists (select 1 from unnest(ms) x where not exists (select 1 from entites e where e.organisation_id = org and e.slug = x and e.publie_site)) then
    raise exception 'Marque inconnue pour ce site' using errcode = '23514';
  end if;
  return new;
end
$$;
drop trigger if exists controler_marques_site on demandes_site;
create trigger controler_marques_site before insert or update of marque, entite_id on demandes_site for each row execute function controler_marques_site();
drop trigger if exists controler_marques_site on bandeaux_site;
create trigger controler_marques_site before insert or update of marques, entite_id on bandeaux_site for each row execute function controler_marques_site();

create or replace function publie_sur_le_site(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from entites where id = e and publie_site) and lit_demandes_site(e)
    and a_permission(e, 'dossiers.ecrire') and a_permission(e, 'reglages.ecrire')
$$;

-- 8. Suivi des rappels par organisation. Les lignes anciennes, sans organisation, restent à Zwald.
alter table rappels_suivi add column if not exists organisation_id uuid references organisations (id) on delete cascade;
update rappels_suivi set organisation_id = '00000000-0000-0000-0000-00000000a000' where organisation_id is null;
-- La fonction « rappels » écrit l'organisation de chaque passage : pas de valeur par défaut, une ligne sans organisation est refusée
-- au lieu d'être rangée chez Zwald (elle montrerait les envois d'un autre client).
alter table rappels_suivi alter column organisation_id drop default;
alter table rappels_suivi alter column organisation_id set not null;
create index if not exists rappels_suivi_organisation on rappels_suivi (organisation_id, cree_le desc);
drop policy if exists "lire le suivi des rappels" on rappels_suivi;
create policy "lire le suivi des rappels" on rappels_suivi for select to authenticated using (
  organisation_id = mon_organisation() and (est_super_admin() or exists (
    select 1 from membres m join roles r on r.id = m.role_id join profils p on p.user_id = m.user_id
    where m.user_id = auth.uid() and p.actif and 'reglages.ecrire' = any (r.permissions)))
);

-- 9. Journal des comptes (invitations, liens de mot de passe, suppressions, organisations créées) : ces lignes n'ont pas d'entreprise.
-- Elles portent l'organisation, et seul son administrateur les lit (avant : toute administratrice générale, donc toutes les organisations).
alter table journal add column if not exists organisation_id uuid references organisations (id) on delete cascade;
update journal set organisation_id = '00000000-0000-0000-0000-00000000a000' where entite_id is null and organisation_id is null;
drop policy if exists "lire le journal" on journal;
create policy "lire le journal" on journal for select to authenticated using (
  (entite_id is not null and a_permission(entite_id, 'journal.voir') and (table_name <> 'reservations_nets' or a_permission(entite_id, 'partenaires.nets')))
  or (entite_id is null and organisation_id = mon_organisation() and est_super_admin())
);

commit;
