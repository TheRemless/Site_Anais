-- Gestion : migration 11, réservations auprès des partenaires.
-- À exécuter une seule fois sur une base déjà migrée avec migration-10-partenaires.sql, AVANT de publier la nouvelle version de l'outil.
-- Ne modifie aucune donnée existante : ajoute deux tables. Les messages types vivent dans les réglages, sans changement de structure.

begin;

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
    when 'reservations' then ligne->>'libelle'
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

-- Réservations auprès des partenaires : une par ligne de partenaire vendue. Elles suivent les droits du dossier.
-- Le net prévu et le net payé sont dans une table à part, lisible avec le droit « partenaires.nets ».
create table reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entite_id uuid not null references entites (id) on delete cascade,
  dossier_id uuid not null,
  ligne_id text not null default '',
  prestation_id uuid references prestations (id) on delete set null,
  trajet_id uuid references trajets (id) on delete set null,
  partenaire_id uuid references partenaires (id) on delete set null,
  libelle text not null,
  date_service date,
  heure_pickup text not null default '',
  lieu_pickup text not null default '',
  personnes jsonb not null default '{}',
  statut text not null default 'a_demander' check (statut in ('a_demander', 'demande', 'confirme', 'annule')),
  reference_partenaire text not null default '',
  montant_vente numeric(12, 2),
  notes text not null default '',
  cree_par uuid default auth.uid(),
  modifie_par uuid,
  unique (id, entite_id),
  foreign key (dossier_id, entite_id) references dossiers (id, entite_id) on delete cascade
);
create table reservations_nets (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null,
  reservation_id uuid not null unique,
  net_prevu numeric(12, 2),
  net_paye numeric(12, 2),
  paye_le date,
  foreign key (reservation_id, entite_id) references reservations (id, entite_id) on delete cascade
);
create index on reservations (entite_id);
create index on reservations (dossier_id);
create index on reservations (partenaire_id);
create index on reservations (entite_id, date_service);

create trigger noter_modification before update on reservations for each row execute function noter_modification();
create trigger journaliser after insert or update or delete on reservations for each row execute function journaliser();

alter table reservations enable row level security;
alter table reservations_nets enable row level security;
revoke all on reservations, reservations_nets from anon;

create policy "lire les réservations" on reservations for select to authenticated using (a_permission(entite_id, 'dossiers.lire') and exists (select 1 from dossiers d where d.id = reservations.dossier_id));
create policy "créer des réservations" on reservations for insert to authenticated with check (a_permission(entite_id, 'dossiers.ecrire') and exists (select 1 from dossiers d where d.id = reservations.dossier_id));
create policy "modifier des réservations" on reservations for update to authenticated using (a_permission(entite_id, 'dossiers.ecrire') and exists (select 1 from dossiers d where d.id = reservations.dossier_id)) with check (a_permission(entite_id, 'dossiers.ecrire'));
create policy "supprimer des réservations" on reservations for delete to authenticated using (a_permission(entite_id, 'dossiers.ecrire') and exists (select 1 from dossiers d where d.id = reservations.dossier_id));
create policy "lire les nets des réservations" on reservations_nets for select to authenticated using (a_permission(entite_id, 'partenaires.nets') and exists (select 1 from reservations r where r.id = reservations_nets.reservation_id));
create policy "modifier les nets des réservations" on reservations_nets for all to authenticated using (a_permission(entite_id, 'partenaires.nets') and a_permission(entite_id, 'dossiers.ecrire') and exists (select 1 from reservations r where r.id = reservations_nets.reservation_id)) with check (a_permission(entite_id, 'partenaires.nets') and a_permission(entite_id, 'dossiers.ecrire'));

commit;
