-- Gestion : migration 15, travail protégé. Enregistrer sans écraser les autres, historique des devis et factures, corbeille des dossiers.
-- À exécuter une seule fois sur une base déjà migrée avec migration-14-argent.sql, AVANT de publier la nouvelle version de l'outil.
-- Ne modifie aucune donnée existante : ajoute deux colonnes, des déclencheurs et des tables d'archive (vides au départ).

begin;

alter table clients add column updated_at timestamptz not null default now();
alter table reglages add column updated_at timestamptz not null default now();

-- 1. Version d'une ligne. La base pose `updated_at` à chaque modification (l'outil ne l'envoie plus lui-même) : l'outil s'en sert pour
-- refuser d'écraser ce qu'une autre personne vient d'enregistrer. Jusqu'ici le dernier qui enregistrait écrasait l'autre sans rien dire.
create or replace function tenir_a_jour() returns trigger language plpgsql as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end
$$;
create trigger tenir_a_jour before update on clients for each row execute function tenir_a_jour();
create trigger tenir_a_jour before update on reglages for each row execute function tenir_a_jour();
create trigger tenir_a_jour before update on documents for each row execute function tenir_a_jour();
create trigger tenir_a_jour before update on reservations for each row execute function tenir_a_jour();
create trigger tenir_a_jour before update on partenaires for each row execute function tenir_a_jour();
create trigger tenir_a_jour before update on prestations for each row execute function tenir_a_jour();

-- 2. Historique des versions d'un devis ou d'une facture : une version tous les cinq minutes au plus (l'enregistrement automatique écrit
-- à chaque pause de frappe), les 30 dernières par document. Un document supprimé garde sa dernière version 90 jours.
create table documents_historique (
  id bigint generated always as identity primary key,
  document_id uuid not null,
  entite_id uuid not null,
  dossier_id uuid not null,
  action text not null check (action in ('update', 'delete')),
  ligne jsonb not null,
  archive_le timestamptz not null default now()
);
create index on documents_historique (document_id, archive_le desc);
create index on documents_historique (dossier_id, action, archive_le);
alter table documents_historique enable row level security;
revoke all on documents_historique from anon, authenticated;
grant select on documents_historique to authenticated;
create policy "lire l'historique des documents" on documents_historique for select to authenticated
  using (a_permission(entite_id, 'finances.voir') and a_permission(entite_id, 'documents.ecrire'));

create or replace function archiver_document() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.contenu is not distinct from new.contenu and old.date_emission = new.date_emission and old.envoye_le is not distinct from new.envoye_le then
      return new;
    end if;
    if exists (select 1 from documents_historique h where h.document_id = old.id and h.action = 'update' and h.archive_le > now() - interval '5 minutes') then
      return new;
    end if;
    insert into documents_historique (document_id, entite_id, dossier_id, action, ligne) values (old.id, old.entite_id, old.dossier_id, 'update', to_jsonb(old));
    delete from documents_historique where document_id = old.id and action = 'update'
      and id not in (select h.id from documents_historique h where h.document_id = old.id and h.action = 'update' order by h.archive_le desc, h.id desc limit 30);
    return new;
  end if;
  insert into documents_historique (document_id, entite_id, dossier_id, action, ligne) values (old.id, old.entite_id, old.dossier_id, 'delete', to_jsonb(old));
  delete from documents_historique where action = 'delete' and archive_le < now() - interval '90 days';
  return old;
end
$$;
create trigger archiver_document before update or delete on documents for each row execute function archiver_document();

-- 3. Corbeille des dossiers : un dossier supprimé garde 90 jours son contenu (paiements, réservations, nets, tâches ; ses documents sont dans
-- l'historique ci-dessus). Les fichiers joints ne sont pas conservés. Réservée au droit « supprimer un dossier ».
create table corbeille (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null,
  table_name text not null,
  ligne jsonb not null,
  liees jsonb not null default '{}',
  supprime_par uuid default auth.uid(),
  supprime_le timestamptz not null default now()
);
create index on corbeille (entite_id, supprime_le desc);
alter table corbeille enable row level security;
revoke all on corbeille from anon, authenticated;
grant select on corbeille to authenticated;
create policy "lire la corbeille" on corbeille for select to authenticated using (a_permission(entite_id, 'dossiers.supprimer'));

create or replace function archiver_dossier() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into corbeille (entite_id, table_name, ligne, liees, supprime_par)
  values (old.entite_id, 'dossiers', to_jsonb(old), jsonb_build_object(
    'paiements', coalesce((select jsonb_agg(to_jsonb(p)) from paiements p where p.dossier_id = old.id), '[]'::jsonb),
    'reservations', coalesce((select jsonb_agg(to_jsonb(r)) from reservations r where r.dossier_id = old.id), '[]'::jsonb),
    'reservations_nets', coalesce((select jsonb_agg(to_jsonb(n)) from reservations_nets n join reservations r on r.id = n.reservation_id where r.dossier_id = old.id), '[]'::jsonb),
    'taches', coalesce((select jsonb_agg(to_jsonb(t)) from taches t where t.dossier_id = old.id), '[]'::jsonb)), auth.uid());
  delete from corbeille where supprime_le < now() - interval '90 days';
  return old;
end
$$;
create trigger archiver_dossier before delete on dossiers for each row execute function archiver_dossier();

-- Remet un dossier supprimé avec ses documents, paiements, réservations, nets et tâches. Échoue si son client ou sa référence ont disparu entre-temps.
create or replace function restaurer_dossier(p_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare
  c corbeille;
  did uuid;
begin
  select * into c from corbeille where id = p_id and table_name = 'dossiers';
  if not found then
    raise exception 'Dossier introuvable dans la corbeille';
  end if;
  if not a_permission(c.entite_id, 'dossiers.supprimer') then
    raise exception 'Droit insuffisant pour restaurer un dossier' using errcode = '42501';
  end if;
  did := (c.ligne->>'id')::uuid;
  insert into dossiers select (jsonb_populate_record(null::dossiers, c.ligne)).*;
  insert into documents select (jsonb_populate_record(null::documents, h.ligne)).*
    from (select distinct on (document_id) ligne from documents_historique
          where dossier_id = did and action = 'delete' and archive_le >= c.supprime_le and archive_le < c.supprime_le + interval '1 minute'
          order by document_id, archive_le desc) h;
  insert into paiements select (jsonb_populate_record(null::paiements, e)).* from jsonb_array_elements(c.liees->'paiements') e;
  insert into reservations select (jsonb_populate_record(null::reservations, e)).* from jsonb_array_elements(c.liees->'reservations') e;
  insert into reservations_nets select (jsonb_populate_record(null::reservations_nets, e)).* from jsonb_array_elements(c.liees->'reservations_nets') e;
  insert into taches select (jsonb_populate_record(null::taches, e)).* from jsonb_array_elements(c.liees->'taches') e;
  delete from corbeille where id = p_id;
  return did;
end
$$;
revoke all on function restaurer_dossier(uuid) from public, anon;
grant execute on function restaurer_dossier(uuid) to authenticated;

commit;
