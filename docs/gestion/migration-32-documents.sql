-- Gestion : migration 32 (lot C1 de l'autonomie, 17.11.2026), devis et factures. À appliquer après les migrations 30 et 31.
-- 1. Corbeille des documents : un devis ou une facture supprimé seul (sans son dossier) se retrouve 90 jours et se restaure, avec ses nets.
--    `documents_supprimes(entite)` liste ce qui est restaurable, `restaurer_document(id)` le remet. Même droit que pour le supprimer.
-- 2. Prochain numéro de la séquence annuelle (ST-2026-0001) : l'administratrice le lit et le change dans Réglages, sans SQL.
--    Jamais en dessous d'un numéro déjà donné cette année.
-- 3. La devise est toujours écrite dans le document : les anciens documents reçoivent la devise de leur entreprise, et la base l'écrit
--    pour tout nouveau document qui n'en a pas. Changer ensuite la devise de l'entreprise ne relabellise plus les documents existants.
-- 4. Acompte % figé sur le dossier au premier envoi du devis (colonne `acompte_pct`) : changer l'acompte dans Réglages ne fait plus
--    redevenir « paiement attendu » un dossier dont l'acompte est reçu. Les dossiers dont le devis est déjà envoyé reçoivent l'acompte actuel.
-- À exécuter une seule fois, après les migrations 22 (restaurer_lignes) et 30. Idempotente. Ne modifie aucun montant.

begin;

-- 1. Corbeille des documents --------------------------------------------------------------------------------------------------------------

-- Les nets d'un document supprimé (documents_nets, droit « nets ») partent en cascade avec lui : on les garde à part, sans aucun accès direct.
create table if not exists documents_nets_corbeille (
  document_id uuid primary key,
  entite_id uuid not null,
  nets jsonb not null default '{}',
  archive_le timestamptz not null default now()
);
alter table documents_nets_corbeille enable row level security;
revoke all on documents_nets_corbeille from anon, authenticated;

create or replace function archiver_nets_document() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into documents_nets_corbeille (document_id, entite_id, nets)
  select n.document_id, n.entite_id, n.nets from documents_nets n where n.document_id = old.id
  on conflict (document_id) do update set nets = excluded.nets, archive_le = now();
  delete from documents_nets_corbeille where archive_le < now() - interval '90 days';
  return old;
end
$$;
revoke all on function archiver_nets_document() from public, anon, authenticated;
drop trigger if exists archiver_nets_document on documents;
create trigger archiver_nets_document before delete on documents for each row execute function archiver_nets_document();

-- Documents supprimés seuls ces 90 derniers jours, dont le dossier existe encore (un dossier supprimé se restaure par sa propre corbeille)
-- et qui ne sont pas déjà revenus. Sans les nets ni le contenu complet : de quoi les reconnaître.
create or replace function documents_supprimes(p_entite uuid) returns table (document_id uuid, dossier_id uuid, ref text, type text, numero text, date_emission date, envoye_le date, devise text, contenu jsonb, supprime_le timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (a_permission(p_entite, 'documents.supprimer') and a_permission(p_entite, 'finances.voir')) then
    raise exception 'Droit insuffisant pour voir les documents supprimés' using errcode = '42501';
  end if;
  return query
    select distinct on (h.document_id) h.document_id, h.dossier_id, d.ref, h.ligne->>'type', nullif(h.ligne->'contenu'->>'numero', ''), (h.ligne->>'date_emission')::date,
      nullif(h.ligne->>'envoye_le', '')::date, h.ligne->'contenu'->>'devise', h.ligne->'contenu', h.archive_le
    from documents_historique h
    join dossiers d on d.id = h.dossier_id and d.entite_id = p_entite
    where h.entite_id = p_entite and h.action = 'delete' and h.archive_le > now() - interval '90 days'
      and not exists (select 1 from documents x where x.id = h.document_id)
      and (voit_tout(p_entite) or d.responsable_id = auth.uid() or d.cree_par = auth.uid())
    order by h.document_id, h.archive_le desc;
end
$$;
revoke all on function documents_supprimes(uuid) from public, anon;
grant execute on function documents_supprimes(uuid) to authenticated;

create or replace function restaurer_document(p_document uuid) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h documents_historique;
  n documents_nets_corbeille;
begin
  select * into h from documents_historique where document_id = p_document and action = 'delete' and archive_le > now() - interval '90 days' order by archive_le desc limit 1;
  if not found then
    raise exception 'Document introuvable dans la corbeille (plus de 90 jours, ou déjà restauré)';
  end if;
  if not a_permission(h.entite_id, 'documents.supprimer') then
    raise exception 'Droit insuffisant pour restaurer un document' using errcode = '42501';
  end if;
  -- Même portée que la liste : un rôle limité à ses dossiers ne restaure que dans ses dossiers.
  if not (voit_tout(h.entite_id) or exists (select 1 from dossiers d where d.id = h.dossier_id and (d.responsable_id = auth.uid() or d.cree_par = auth.uid()))) then
    raise exception 'Ce document appartient à un dossier que votre rôle ne voit pas' using errcode = '42501';
  end if;
  if exists (select 1 from documents where id = p_document) then
    raise exception 'Ce document est déjà revenu dans son dossier';
  end if;
  if not exists (select 1 from dossiers where id = h.dossier_id) then
    raise exception 'Le dossier de ce document a été supprimé : restaurez d''abord le dossier' using errcode = '23503';
  end if;
  perform restaurer_lignes('documents', jsonb_build_array(h.ligne));
  select * into n from documents_nets_corbeille where document_id = p_document;
  if found then
    insert into documents_nets (document_id, entite_id, nets) values (n.document_id, n.entite_id, n.nets) on conflict (document_id) do update set nets = excluded.nets;
    delete from documents_nets_corbeille where document_id = p_document;
  end if;
  return h.dossier_id;
end
$$;
revoke all on function restaurer_document(uuid) from public, anon;
grant execute on function restaurer_document(uuid) to authenticated;

-- 2. Prochain numéro de la séquence annuelle ----------------------------------------------------------------------------------------------

-- Plus grand numéro déjà donné dans les références de l'entreprise pour l'année (« PREFIXE-2026-0003 » ou « 2026-0003 »), dossiers de la
-- corbeille compris : leur numéro ne doit pas resservir, sinon leur restauration échouerait.
create or replace function plus_grand_numero_ref(p_entite uuid, p_annee int) returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(max((regexp_match(ref, '(?:^|-)(\d{4})-(\d{1,9})$'))[2]::int), 0)
  from (select ref from dossiers where entite_id = p_entite
        union all select ligne->>'ref' from corbeille where entite_id = p_entite and table_name = 'dossiers') x
  where (regexp_match(ref, '(?:^|-)(\d{4})-(\d{1,9})$'))[1]::int = p_annee;
$$;
revoke all on function plus_grand_numero_ref(uuid, int) from public, anon, authenticated;

-- Le numéro que prendra le prochain dossier de l'année, et le plus petit numéro qu'on peut choisir.
create or replace function lire_prochain_numero(p_entite uuid, p_annee int) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  pris int := plus_grand_numero_ref(p_entite, p_annee);
  compteur int := coalesce((select derniere from compteurs_ref where entite_id = p_entite and annee = p_annee), 0);
begin
  if not a_permission(p_entite, 'reglages.ecrire') then
    raise exception 'Droit insuffisant pour voir la numérotation' using errcode = '42501';
  end if;
  return jsonb_build_object('prochain', greatest(pris, compteur) + 1, 'minimum', pris + 1);
end
$$;
revoke all on function lire_prochain_numero(uuid, int) from public, anon;
grant execute on function lire_prochain_numero(uuid, int) to authenticated;

-- Fixe le prochain numéro (saut de numérotation, reprise après un autre logiciel). Refusé sous un numéro déjà donné cette année.
create or replace function fixer_prochain_numero(p_entite uuid, p_annee int, p_prochain int) returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pris int := plus_grand_numero_ref(p_entite, p_annee);
begin
  if not a_permission(p_entite, 'reglages.ecrire') then
    raise exception 'Seule l''administratrice peut changer la numérotation' using errcode = '42501';
  end if;
  if p_annee is null or p_annee < 2000 or p_annee > 2100 or p_prochain is null or p_prochain < 1 or p_prochain > 999999999 then
    raise exception 'Numéro ou année invalide';
  end if;
  if p_prochain <= pris then
    raise exception 'Le numéro % est déjà donné cette année : choisissez % ou plus', pris, pris + 1 using errcode = '23505';
  end if;
  insert into compteurs_ref (entite_id, annee, derniere) values (p_entite, p_annee, p_prochain - 1)
  on conflict on constraint compteurs_ref_pkey do update set derniere = p_prochain - 1;
  insert into journal (entite_id, user_id, table_name, action, cible, libelle, details)
  values (p_entite, auth.uid(), 'reglages', 'update', p_entite::text, 'prochain numéro', jsonb_build_object('prochain_numero', jsonb_build_object('annee', p_annee, 'apres', p_prochain)));
  return p_prochain;
end
$$;
revoke all on function fixer_prochain_numero(uuid, int, int) from public, anon;
grant execute on function fixer_prochain_numero(uuid, int, int) to authenticated;

-- 3. Devise toujours écrite -------------------------------------------------------------------------------------------------------------

create or replace function ecrire_devise_document() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  dev text;
begin
  if coalesce(new.contenu->>'devise', '') = '' then
    select nullif(valeur->>'devise', '') into dev from reglages where entite_id = new.entite_id;
    if dev is not null then new.contenu := jsonb_set(new.contenu, '{devise}', to_jsonb(dev)); end if;
  end if;
  return new;
end
$$;
revoke all on function ecrire_devise_document() from public, anon, authenticated;
drop trigger if exists ecrire_devise_document on documents;
create trigger ecrire_devise_document before insert or update of contenu on documents for each row execute function ecrire_devise_document();

-- Reprise des anciens documents (67 en production le 16.11.2026), une seule fois. Journal, historique des versions, version et auteur de la
-- modification sont suspendus (ce n'est pas une modification de la personne connectée) ; le résumé des dossiers, lui, se recalcule.
alter table documents disable trigger journaliser;
alter table documents disable trigger archiver_document;
alter table documents disable trigger tenir_a_jour;
alter table documents disable trigger noter_modification;
update documents d set contenu = jsonb_set(d.contenu, '{devise}', to_jsonb(r.valeur->>'devise'))
from reglages r
where r.entite_id = d.entite_id and coalesce(d.contenu->>'devise', '') = '' and coalesce(r.valeur->>'devise', '') <> '';
alter table documents enable trigger journaliser;
alter table documents enable trigger archiver_document;
alter table documents enable trigger tenir_a_jour;
alter table documents enable trigger noter_modification;

-- 4. Acompte figé sur le dossier --------------------------------------------------------------------------------------------------------

alter table dossiers add column if not exists acompte_pct numeric(5, 2);
alter table dossiers disable trigger journaliser;
alter table dossiers disable trigger tenir_a_jour;
alter table dossiers disable trigger noter_modification;
update dossiers d set acompte_pct = coalesce(nullif(r.valeur->'conditions'->>'acompte_pct', '')::numeric, 0)
from reglages r
where r.entite_id = d.entite_id and d.acompte_pct is null and d.devis_envoye_le is not null;
alter table dossiers enable trigger journaliser;
alter table dossiers enable trigger tenir_a_jour;
alter table dossiers enable trigger noter_modification;

commit;
