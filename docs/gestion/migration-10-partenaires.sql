-- Gestion : migration 10, base partenaires (partenaires, prestations, trajets, prix nets à part).
-- À exécuter une seule fois sur une base déjà migrée avec migration-9-groupe.sql, AVANT de publier la nouvelle version de l'outil.
-- Ne modifie aucune donnée existante : ajoute des tables, trois droits et les donne aux rôles de départ.

begin;

create or replace function toutes_permissions() returns text[] language sql immutable as $$
  select array['clients.lire', 'clients.ecrire', 'clients.supprimer', 'dossiers.lire', 'dossiers.ecrire', 'dossiers.supprimer', 'documents.ecrire', 'documents.supprimer', 'finances.voir', 'paiements.ecrire', 'taches.ecrire', 'catalogue.ecrire', 'reglages.ecrire', 'exports.faire', 'analytics.voir', 'journal.voir', 'partenaires.lire', 'partenaires.ecrire', 'partenaires.nets']::text[]
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
    when 'partenaires' then ligne->>'nom'
    when 'prestations' then ligne->>'libelle'
    when 'trajets' then (ligne->>'de') || ' → ' || (ligne->>'vers')
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

-- Partenaires de l'entreprise (prestataires), leurs prestations tarifées et les trajets des compagnies de bateaux.
-- Les prix nets et les coordonnées bancaires sont dans des tables à part, lisibles seulement avec le droit « partenaires.nets ».
create table partenaires (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete cascade,
  nom text not null,
  nom_thai text not null default '',
  categorie text not null default '',
  groupe text not null default '',
  role text not null default '',
  contact jsonb not null default '{}',
  regles jsonb not null default '{}',
  contrat jsonb not null default '{}',
  notes text not null default '',
  ordre integer not null default 0,
  actif boolean not null default true,
  cree_par uuid default auth.uid(),
  modifie_par uuid,
  unique (id, entite_id)
);
create table partenaires_prives (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null,
  partenaire_id uuid not null unique,
  banque jsonb not null default '{}',
  paiement text not null default '',
  foreign key (partenaire_id, entite_id) references partenaires (id, entite_id) on delete cascade
);
create table prestations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete cascade,
  partenaire_id uuid,
  famille text not null check (famille in ('excursion', 'activite', 'location', 'transfert', 'frais', 'autre')),
  groupe text not null default '',
  libelle text not null,
  libelle_en text not null default '',
  details jsonb not null default '{}',
  prix_vente numeric(12, 2),
  unite text not null default '',
  sur_place boolean not null default false,
  ordre integer not null default 0,
  actif boolean not null default true,
  cree_par uuid default auth.uid(),
  modifie_par uuid,
  unique (id, entite_id),
  foreign key (partenaire_id, entite_id) references partenaires (id, entite_id) on delete cascade
);
create table prestations_nets (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null,
  prestation_id uuid not null unique,
  net numeric(12, 2),
  net_enfant numeric(12, 2),
  note text not null default '',
  foreign key (prestation_id, entite_id) references prestations (id, entite_id) on delete cascade
);
create table trajets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete cascade,
  partenaire_id uuid,
  numero integer,
  de text not null,
  vers text not null,
  mode text not null default '',
  depart text not null default '',
  arrivee text not null default '',
  duree text not null default '',
  prix_adulte numeric(12, 2),
  prix_enfant numeric(12, 2),
  bebe text not null default '',
  periode text not null default '',
  fenetres jsonb not null default '[]',
  actif boolean not null default true,
  unique (id, entite_id),
  foreign key (partenaire_id, entite_id) references partenaires (id, entite_id) on delete cascade
);
create table trajets_nets (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null,
  trajet_id uuid not null unique,
  net_adulte numeric(12, 2),
  net_enfant numeric(12, 2),
  foreign key (trajet_id, entite_id) references trajets (id, entite_id) on delete cascade
);
-- Une tâche peut être liée à un partenaire (point à régler avec lui) plutôt qu'à un dossier.
alter table taches add column partenaire_id uuid references partenaires (id) on delete set null;
create index on partenaires (entite_id);
create index on prestations (entite_id);
create index on prestations (partenaire_id);
create index on trajets (entite_id);
create index on trajets (de, vers);
create index on taches (partenaire_id);

create trigger noter_modification before update on partenaires for each row execute function noter_modification();
create trigger noter_modification before update on prestations for each row execute function noter_modification();
-- Les tables de nets ne passent pas par le journal : il recopierait les prix nets, lisibles alors sans le droit.
create trigger journaliser after insert or update or delete on partenaires for each row execute function journaliser();
create trigger journaliser after insert or update or delete on prestations for each row execute function journaliser();
create trigger journaliser after insert or update or delete on trajets for each row execute function journaliser();

alter table partenaires enable row level security;
alter table partenaires_prives enable row level security;
alter table prestations enable row level security;
alter table prestations_nets enable row level security;
alter table trajets enable row level security;
alter table trajets_nets enable row level security;
revoke all on partenaires, partenaires_prives, prestations, prestations_nets, trajets, trajets_nets from anon;

create policy "lire les partenaires" on partenaires for select to authenticated using (a_permission(entite_id, 'partenaires.lire'));
create policy "modifier les partenaires" on partenaires for all to authenticated using (a_permission(entite_id, 'partenaires.ecrire')) with check (a_permission(entite_id, 'partenaires.ecrire'));
create policy "lire les prestations" on prestations for select to authenticated using (a_permission(entite_id, 'partenaires.lire'));
create policy "modifier les prestations" on prestations for all to authenticated using (a_permission(entite_id, 'partenaires.ecrire')) with check (a_permission(entite_id, 'partenaires.ecrire'));
create policy "lire les trajets" on trajets for select to authenticated using (a_permission(entite_id, 'partenaires.lire'));
create policy "modifier les trajets" on trajets for all to authenticated using (a_permission(entite_id, 'partenaires.ecrire')) with check (a_permission(entite_id, 'partenaires.ecrire'));
create policy "lire les nets des prestations" on prestations_nets for select to authenticated using (a_permission(entite_id, 'partenaires.nets'));
create policy "modifier les nets des prestations" on prestations_nets for all to authenticated using (a_permission(entite_id, 'partenaires.nets') and a_permission(entite_id, 'partenaires.ecrire')) with check (a_permission(entite_id, 'partenaires.nets') and a_permission(entite_id, 'partenaires.ecrire'));
create policy "lire les nets des trajets" on trajets_nets for select to authenticated using (a_permission(entite_id, 'partenaires.nets'));
create policy "modifier les nets des trajets" on trajets_nets for all to authenticated using (a_permission(entite_id, 'partenaires.nets') and a_permission(entite_id, 'partenaires.ecrire')) with check (a_permission(entite_id, 'partenaires.nets') and a_permission(entite_id, 'partenaires.ecrire'));
create policy "lire les données privées des partenaires" on partenaires_prives for select to authenticated using (a_permission(entite_id, 'partenaires.nets'));
create policy "modifier les données privées des partenaires" on partenaires_prives for all to authenticated using (a_permission(entite_id, 'partenaires.nets') and a_permission(entite_id, 'partenaires.ecrire')) with check (a_permission(entite_id, 'partenaires.nets') and a_permission(entite_id, 'partenaires.ecrire'));

-- Droits : tout le monde lit les partenaires, Administrateur et Éditeur les modifient, seul Administrateur voit les nets.
update roles set permissions = permissions || array['partenaires.lire'] where systeme and not ('partenaires.lire' = any (permissions));
update roles set permissions = permissions || array['partenaires.ecrire'] where systeme and nom in ('Administrateur', 'Éditeur') and not ('partenaires.ecrire' = any (permissions));
update roles set permissions = permissions || array['partenaires.nets'] where systeme and nom = 'Administrateur' and not ('partenaires.nets' = any (permissions));

commit;
