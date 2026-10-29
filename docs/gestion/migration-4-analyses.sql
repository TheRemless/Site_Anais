-- Gestion : migration 4, tableau analytique calculé par la base.
-- À exécuter une seule fois sur une base déjà migrée avec migration-3-droits.sql. Ne modifie aucune donnée.
-- Contient les coordonnées de l'entreprise : ce fichier ne doit pas être publié.

begin;

-- Total net d'un document, calculé comme l'application (lignes, remises en pourcentage ou en montant).
create or replace function total_document(c jsonb) returns numeric language sql immutable as $$
  with l as (
    select coalesce(e->>'kind', 'ligne') as kind,
      case
        when e->>'unite' ~ '^-?[0-9]+(\.[0-9]+)?$' and e->>'qte' ~ '^-?[0-9]+(\.[0-9]+)?$' then round((e->>'unite')::numeric * (e->>'qte')::numeric, 2)
        when e->>'montant' ~ '^-?[0-9]+(\.[0-9]+)?$' then round((e->>'montant')::numeric, 2)
        else 0
      end as brut,
      case when e->>'pct' ~ '^-?[0-9]+(\.[0-9]+)?$' then (e->>'pct')::numeric end as pct
    from jsonb_array_elements(coalesce(c->'lignes', '[]'::jsonb)) e
  ), s as (
    select coalesce(sum(brut) filter (where kind not in ('remise', 'texte')), 0) as st from l
  )
  select round(s.st - coalesce((select sum(case when pct is not null then round(s.st * pct / 100, 2) else brut end) from l where kind = 'remise'), 0), 2) from s
$$;

-- Tableau analytique d'une entreprise sur une période. Calculé dans la base pour rester rapide avec de gros volumes.
-- Réservé aux rôles qui ont les droits « analyses » et « montants ». Les chiffres portent sur toute l'entreprise,
-- même pour un rôle limité à ses dossiers.
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
    'facture_par_mois', coalesce((select jsonb_agg(x order by x.mois, x.devise) from (
        select to_char(xd.date_emission, 'YYYY-MM') as mois, coalesce(xd.contenu->>'devise', dev) as devise, round(sum(total_document(xd.contenu)), 2) as montant, count(*)::int as nombre
        from documents xd where xd.entite_id = e and xd.type = 'facture' and xd.date_emission between du and au group by 1, 2) x), '[]'::jsonb),
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
