-- Gestion : migration 14, argent. Numéros de facture qui ne se réutilisent jamais, remboursements, « Facturé » des analyses.
-- À exécuter une seule fois sur une base déjà migrée avec migration-13-langue.sql, AVANT de publier la nouvelle version de l'outil.
-- Ne modifie aucun dossier, document ni paiement existant. Contient seulement des ajouts et le remplacement d'une fonction.

begin;

-- 1. Numéros de la séquence annuelle (ST-2026-0001). Jusqu'ici l'outil prenait « le plus grand numéro visible + 1 » : un dossier
-- supprimé rendait son numéro, et un rôle limité à ses dossiers calculait un mauvais numéro. La base tient maintenant un compteur
-- par entreprise et par année, qui ne redescend jamais. Aucune policy : seule la fonction ci-dessous y accède.
create table compteurs_ref (
  entite_id uuid not null references entites (id) on delete cascade,
  annee int not null,
  derniere int not null default 0,
  constraint compteurs_ref_pkey primary key (entite_id, annee)
);
alter table compteurs_ref enable row level security;
revoke all on compteurs_ref from anon, authenticated;

-- Reprise des numéros déjà donnés (références de la forme « PREFIXE-2026-0003 » ou « 2026-0003 »).
insert into compteurs_ref (entite_id, annee, derniere)
select entite_id, (regexp_match(ref, '(?:^|-)(\d{4})-(\d{1,9})$'))[1]::int, max((regexp_match(ref, '(?:^|-)(\d{4})-(\d{1,9})$'))[2]::int)
from dossiers
where ref ~ '(?:^|-)\d{4}-\d{1,9}$'
group by 1, 2;

-- Donne le numéro suivant. `p_minimum` est le plus grand numéro que la personne voit : le compteur ne redescend jamais en dessous.
create or replace function prochain_numero_ref(p_entite uuid, p_annee int, p_minimum int default 0) returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not a_permission(p_entite, 'dossiers.ecrire') then
    raise exception 'Droit insuffisant pour créer un dossier' using errcode = '42501';
  end if;
  insert into compteurs_ref (entite_id, annee, derniere) values (p_entite, p_annee, greatest(coalesce(p_minimum, 0), 0) + 1)
  on conflict on constraint compteurs_ref_pkey do update set derniere = greatest(compteurs_ref.derniere, coalesce(p_minimum, 0)) + 1
  returning derniere into n;
  return n;
end
$$;
revoke all on function prochain_numero_ref(uuid, int, int) from public, anon;
grant execute on function prochain_numero_ref(uuid, int, int) to authenticated;

-- 2. Remboursements : un paiement négatif (type « remboursement »). Le montant ne peut plus être nul, il peut être négatif.
-- L'encaissé d'un dossier, son reste et les analyses additionnent déjà les montants : un remboursement les fait baisser tout seul.
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'paiements'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%montant > 0%' loop
    execute format('alter table paiements drop constraint %I', c);
  end loop;
end
$$;
alter table paiements add constraint paiements_montant_non_nul check (montant <> 0);

-- 3. « Facturé » des analyses : une facture par dossier (la dernière), sans les dossiers annulés. Avant, les dossiers annulés et les
-- factures en double étaient comptés, et « Facturé » moins « Encaissé » ne retombait pas sur les impayés.
create or replace function tableau_analytique(e uuid, du date, au date, jour date default current_date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  dev text;
  res jsonb;
begin
  if not (a_permission(e, 'analytics.voir') and a_permission(e, 'finances.voir')) then
    raise exception 'Droit insuffisant pour voir les analyses' using errcode = '42501';
  end if;
  select coalesce(valeur->>'devise', '') into dev from reglages where entite_id = e;
  dev := coalesce(dev, '');
  with dos as (
    select d.id, d.client_id, d.pays, d.responsable_id, d.accepte_le, d.annule, d.created_at,
      f.contenu as fc, f.date_emission as f_date, v.contenu as dc, v.date_emission as v_date
    from dossiers d
    left join lateral (select contenu, date_emission from documents x where x.dossier_id = d.id and x.type = 'facture' order by x.date_emission desc, x.created_at desc limit 1) f on true
    left join lateral (select contenu, date_emission from documents x where x.dossier_id = d.id and x.type = 'devis' order by x.date_emission desc, x.created_at desc limit 1) v on true
    where d.entite_id = e
  ), tot as (
    select dos.*, total_document(coalesce(fc, dc)) as total, coalesce(coalesce(fc, dc)->>'devise', dev) as devise,
      coalesce((select sum(p.montant) from paiements p where p.dossier_id = dos.id), 0) as recu,
      coalesce(f_date, accepte_le, v_date) as date_ref
    from dos where coalesce(fc, dc) is not null
  ), retenus as (
    select * from tot where not annule and (accepte_le is not null or fc is not null) and date_ref between du and au
  )
  select jsonb_build_object(
    -- Une facture par dossier (la dernière) et pas de dossier annulé : « Facturé » moins « Encaissé » retombe alors sur les impayés.
    'facture_par_mois', coalesce((select jsonb_agg(x order by x.mois, x.devise) from (
        select to_char(f_date, 'YYYY-MM') as mois, coalesce(fc->>'devise', dev) as devise, round(sum(total_document(fc)), 2) as montant, count(*)::int as nombre
        from dos where fc is not null and not annule and f_date between du and au group by 1, 2) x), '[]'::jsonb),
    'encaisse_par_mois', coalesce((select jsonb_agg(x order by x.mois, x.devise) from (
        select to_char(p.date, 'YYYY-MM') as mois, coalesce(t.devise, dev) as devise, round(sum(p.montant), 2) as montant, count(*)::int as nombre
        from paiements p left join tot t on t.id = p.dossier_id where p.entite_id = e and p.date between du and au group by 1, 2) x), '[]'::jsonb),
    'devis', (select jsonb_build_object(
        'emis', count(*)::int,
        'acceptes', (count(*) filter (where accepte_le is not null))::int,
        'delai_moyen_jours', (select round(avg(accepte_le - v_date), 1) from dos where v_date between du and au and accepte_le is not null and accepte_le >= v_date))
        from dos where v_date between du and au),
    'impayes', coalesce((select jsonb_agg(jsonb_build_object('tranche', x.tranche, 'devise', x.devise, 'montant', x.montant, 'nombre', x.nombre) order by x.ordre, x.devise) from (
        select case when age <= 30 then 1 when age <= 60 then 2 when age <= 90 then 3 else 4 end as ordre,
               case when age <= 30 then '0-30' when age <= 60 then '31-60' when age <= 90 then '61-90' else '90+' end as tranche,
               devise, round(sum(reste), 2) as montant, count(*)::int as nombre
        from (select devise, total - recu as reste, jour - f_date as age from tot where not annule and fc is not null and total - recu > 0) q
        group by 1, 2, 3) x), '[]'::jsonb),
    'top_clients', coalesce((select jsonb_agg(x) from (
        select trim(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, '')) as client, r.devise, round(sum(r.total), 2) as montant, count(*)::int as nombre
        from retenus r join clients c on c.id = r.client_id group by r.client_id, c.prenom, c.nom, r.devise order by sum(r.total) desc, 1 limit 10) x), '[]'::jsonb),
    'par_pays', coalesce((select jsonb_agg(x) from (
        select coalesce(nullif(pays, ''), 'Non renseigné') as pays, devise, round(sum(total), 2) as montant, count(*)::int as nombre
        from retenus group by 1, 2 order by sum(total) desc, 1) x), '[]'::jsonb),
    'par_responsable', coalesce((select jsonb_agg(x) from (
        select coalesce(nullif(trim(coalesce(p.nom, p.email, '')), ''), 'Sans responsable') as responsable, r.devise, round(sum(r.total), 2) as montant, count(*)::int as nombre
        from retenus r left join profils p on p.user_id = r.responsable_id group by 1, 2 order by sum(r.total) desc, 1) x), '[]'::jsonb),
    -- Devis en attente au jour donné : émis, ni acceptés, ni annulés, ni facturés. C'est le chiffre d'affaires possible.
    'pipeline', coalesce((select jsonb_agg(x order by x.devise) from (
        select devise, round(sum(total), 2) as montant, count(*)::int as nombre
        from tot where not annule and accepte_le is null and fc is null and dc is not null and v_date <= jour group by 1) x), '[]'::jsonb),
    'activite', jsonb_build_object('dossiers', (select count(*)::int from retenus), 'clients', (select count(distinct client_id)::int from retenus))
  ) into res;
  return res;
end
$$;

commit;
