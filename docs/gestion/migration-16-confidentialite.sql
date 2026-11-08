-- Gestion : migration 16, confidentialité. Prix nets hors des devis, commissions hors des fiches lisibles, fonctions fermées au public.
-- À exécuter une seule fois sur une base déjà migrée avec migration-15-travail-protege.sql, AVANT de publier la nouvelle version de l'outil.
-- Déplace des données (nets des documents, commissions et mode de paiement des partenaires) sans en perdre : elles passent dans des tables
-- réservées au droit « nets ». Ne modifie aucun montant, total ni paiement.

begin;

-- 1. Les prix nets ne sont plus recopiés dans le contenu des devis et factures. Ils étaient lisibles avec le seul droit « finances » (par l'API),
-- alors que l'outil ne les montre qu'avec le droit « nets ». Ils vont dans une table à part, liée au document, lisible avec « nets » seulement.
create table documents_nets (
  document_id uuid primary key references documents (id) on delete cascade,
  entite_id uuid not null,
  nets jsonb not null default '{}'
);
alter table documents_nets enable row level security;
revoke all on documents_nets from anon, authenticated;
grant select, insert, update, delete on documents_nets to authenticated;
create policy "lire les nets des documents" on documents_nets for select to authenticated
  using (a_permission(entite_id, 'partenaires.nets') and a_permission(entite_id, 'finances.voir'));
create policy "modifier les nets des documents" on documents_nets for all to authenticated
  using (a_permission(entite_id, 'partenaires.nets') and a_permission(entite_id, 'documents.ecrire'))
  with check (a_permission(entite_id, 'partenaires.nets') and a_permission(entite_id, 'documents.ecrire')
    and exists (select 1 from documents d where d.id = documents_nets.document_id and d.entite_id = documents_nets.entite_id));

-- 2. Commissions, texte des nets et mode de paiement des partenaires : ils étaient dans des colonnes lisibles avec « partenaires.lire ».
alter table partenaires_prives add column commissions jsonb not null default '[]';
alter table prestations_nets add column details jsonb not null default '{}';

-- 3. Les fonctions de la base ne sont plus appelables avec la clé publique (sans connexion).
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- 4. Fichiers joints : 10 Mo au plus, côté base aussi (la limite n'existait que dans le navigateur).
update storage.buckets set file_size_limit = 10485760 where id = 'pieces';

-- La corbeille garde aussi les nets des documents d'un dossier supprimé, et la restauration les remet.
create or replace function archiver_dossier() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into corbeille (entite_id, table_name, ligne, liees, supprime_par)
  values (old.entite_id, 'dossiers', to_jsonb(old), jsonb_build_object(
    'paiements', coalesce((select jsonb_agg(to_jsonb(p)) from paiements p where p.dossier_id = old.id), '[]'::jsonb),
    'reservations', coalesce((select jsonb_agg(to_jsonb(r)) from reservations r where r.dossier_id = old.id), '[]'::jsonb),
    'reservations_nets', coalesce((select jsonb_agg(to_jsonb(n)) from reservations_nets n join reservations r on r.id = n.reservation_id where r.dossier_id = old.id), '[]'::jsonb),
    'documents_nets', coalesce((select jsonb_agg(to_jsonb(n)) from documents_nets n join documents d on d.id = n.document_id where d.dossier_id = old.id), '[]'::jsonb),
    'taches', coalesce((select jsonb_agg(to_jsonb(t)) from taches t where t.dossier_id = old.id), '[]'::jsonb)), auth.uid());
  delete from corbeille where supprime_le < now() - interval '90 days';
  return old;
end
$$;

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
  insert into documents_nets select (jsonb_populate_record(null::documents_nets, e)).* from jsonb_array_elements(coalesce(c.liees->'documents_nets', '[]'::jsonb)) e
    where exists (select 1 from documents d where d.id = (e->>'document_id')::uuid);
  insert into paiements select (jsonb_populate_record(null::paiements, e)).* from jsonb_array_elements(c.liees->'paiements') e;
  insert into reservations select (jsonb_populate_record(null::reservations, e)).* from jsonb_array_elements(c.liees->'reservations') e;
  insert into reservations_nets select (jsonb_populate_record(null::reservations_nets, e)).* from jsonb_array_elements(c.liees->'reservations_nets') e;
  insert into taches select (jsonb_populate_record(null::taches, e)).* from jsonb_array_elements(c.liees->'taches') e;
  delete from corbeille where id = p_id;
  return did;
end
$$;

-- Reprise des données existantes ------------------------------------------------------------------------------------------------------
-- Nets des documents : on les range dans documents_nets (une entrée par ligne), puis on les retire du contenu. Les déclencheurs du document
-- (journal, historique, résumé) sont suspendus pendant ce rangement : il ne s'agit pas d'une modification de la personne connectée.
insert into documents_nets (document_id, entite_id, nets)
select d.id, d.entite_id, jsonb_object_agg(l->>'id', l->'net')
from documents d cross join lateral jsonb_array_elements(coalesce(d.contenu->'lignes', '[]'::jsonb)) l
where l ? 'id' and jsonb_typeof(l->'net') = 'number'
group by d.id, d.entite_id;

alter table documents disable trigger user;
update documents set contenu = jsonb_set(contenu, '{lignes}', (select coalesce(jsonb_agg(l - 'net'), '[]'::jsonb) from jsonb_array_elements(contenu->'lignes') l))
where jsonb_typeof(contenu->'lignes') = 'array' and exists (select 1 from jsonb_array_elements(contenu->'lignes') l where l ? 'net');
alter table documents enable trigger user;

-- Les anciennes versions déjà archivées portent aussi les nets : on les retire.
update documents_historique set ligne = jsonb_set(ligne, '{contenu,lignes}', (select coalesce(jsonb_agg(l - 'net'), '[]'::jsonb) from jsonb_array_elements(ligne->'contenu'->'lignes') l))
where jsonb_typeof(ligne->'contenu'->'lignes') = 'array' and exists (select 1 from jsonb_array_elements(ligne->'contenu'->'lignes') l where l ? 'net');

-- Commissions et mode de paiement des partenaires : de `regles` vers partenaires_prives.
insert into partenaires_prives (entite_id, partenaire_id, commissions)
select entite_id, id, regles->'commissions' from partenaires
where jsonb_typeof(regles->'commissions') = 'array' and jsonb_array_length(regles->'commissions') > 0
on conflict (partenaire_id) do update set commissions = excluded.commissions;

insert into partenaires_prives (entite_id, partenaire_id, paiement)
select entite_id, id, case when jsonb_typeof(regles->'paiement') = 'array' then (select string_agg(x, E'\n') from jsonb_array_elements_text(regles->'paiement') x) else regles->>'paiement' end
from partenaires where coalesce(regles->>'paiement', '') <> ''
on conflict (partenaire_id) do update set paiement = case when partenaires_prives.paiement = '' then excluded.paiement else partenaires_prives.paiement end;

update partenaires set regles = regles - 'commissions' - 'paiement' where regles ?| array['commissions', 'paiement'];

-- Texte des nets, commission et ancien prix des prestations : de `details` vers prestations_nets.details.
insert into prestations_nets (entite_id, prestation_id, details)
select entite_id, id, (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(details) kv(k, v) where k in ('net_texte', 'commission', 'ancien_prix'))
from prestations where details ?| array['net_texte', 'commission', 'ancien_prix']
on conflict (prestation_id) do update set details = prestations_nets.details || excluded.details;

update prestations set details = details - 'net_texte' - 'commission' - 'ancien_prix' where details ?| array['net_texte', 'commission', 'ancien_prix'];

commit;
