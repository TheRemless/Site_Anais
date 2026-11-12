-- Gestion : migration 22, la restauration d'un dossier supprimé ne casse plus.
-- 1. restaurer_dossier réinsérait chaque ligne avec jsonb_populate_record : une colonne NOT NULL ajoutée après la suppression (comme `paye_sur_place`,
--    migration 18) valait NULL dans la ligne remise, et la restauration échouait. Les lignes sont maintenant réinsérées colonne par colonne : une colonne
--    absente de la ligne archivée prend sa valeur par défaut.
-- 2. Un client ne peut plus être supprimé tant qu'un dossier de la corbeille lui appartient : sinon la restauration échouait sur la clé du dossier.
-- 3. Restaurer un dossier dont le client a disparu (cas d'avant cette migration) donne un message clair au lieu d'une erreur de clé étrangère.
-- À exécuter une seule fois, après la migration 21. Ne modifie aucune donnée. Idempotente.

begin;

-- Réinsère des lignes archivées (tableau JSON) dans une table, sur les seules colonnes présentes : les autres prennent leur valeur par défaut.
-- Fonction interne, appelée par restaurer_dossier : personne d'autre ne l'appelle.
create or replace function restaurer_lignes(p_table text, p_lignes jsonb) returns void language plpgsql security definer set search_path = public as $$
declare
  cols text;
begin
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then return; end if;
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table and exists (select 1 from jsonb_array_elements(p_lignes) e where e ? c.column_name);
  if cols is null then return; end if;
  execute format('insert into %I (%s) select %s from jsonb_populate_recordset(null::%I, $1)', p_table, cols, cols, p_table) using p_lignes;
end
$$;
revoke all on function restaurer_lignes(text, jsonb) from public, anon, authenticated;

create or replace function restaurer_dossier(p_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare
  c corbeille;
  did uuid;
  cid uuid;
begin
  select * into c from corbeille where id = p_id and table_name = 'dossiers';
  if not found then
    raise exception 'Dossier introuvable dans la corbeille';
  end if;
  if not a_permission(c.entite_id, 'dossiers.supprimer') then
    raise exception 'Droit insuffisant pour restaurer un dossier' using errcode = '42501';
  end if;
  did := (c.ligne->>'id')::uuid;
  cid := nullif(c.ligne->>'client_id', '')::uuid;
  if cid is not null and not exists (select 1 from clients where id = cid) then
    raise exception 'Le client de ce dossier a été supprimé : recréez-le avant de restaurer le dossier' using errcode = '23503';
  end if;
  perform restaurer_lignes('dossiers', jsonb_build_array(c.ligne));
  perform restaurer_lignes('documents', (select jsonb_agg(h.ligne) from (
    select distinct on (document_id) ligne from documents_historique
    where dossier_id = did and action = 'delete' and archive_le >= c.supprime_le and archive_le < c.supprime_le + interval '1 minute'
    order by document_id, archive_le desc) h));
  perform restaurer_lignes('documents_nets', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(coalesce(c.liees->'documents_nets', '[]'::jsonb)) e
    where exists (select 1 from documents d where d.id = (e->>'document_id')::uuid)));
  perform restaurer_lignes('paiements', c.liees->'paiements');
  perform restaurer_lignes('reservations', c.liees->'reservations');
  perform restaurer_lignes('reservations_nets', c.liees->'reservations_nets');
  perform restaurer_lignes('taches', c.liees->'taches');
  delete from corbeille where id = p_id;
  return did;
end
$$;
revoke all on function restaurer_dossier(uuid) from public, anon;
grant execute on function restaurer_dossier(uuid) to authenticated;

-- Un client qui a un dossier dans la corbeille ne se supprime pas.
create or replace function proteger_client_corbeille() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from corbeille where table_name = 'dossiers' and ligne->>'client_id' = old.id::text) then
    raise exception 'Ce client a un dossier dans la corbeille : restaurez ou supprimez définitivement ce dossier avant de supprimer le client' using errcode = '23503';
  end if;
  return old;
end
$$;
drop trigger if exists proteger_client_corbeille on clients;
create trigger proteger_client_corbeille before delete on clients for each row execute function proteger_client_corbeille();

commit;
