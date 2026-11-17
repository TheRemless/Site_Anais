-- Gestion : migration 37, un écart soldé n'est plus de l'encaissé dans les analyses par société (Jérémy, 17.11.2026).
--
-- Un paiement de type « Écart soldé (frais, change) » (`paiements.type = 'ecart'`, lot C2) solde un petit reste sans que l'argent arrive chez nous
-- (frais Wise, change). Il comptait dans « Encaissé » de la vue par société (`tableau_analytique`, colonne `encaisse_par_mois`). Il en sort et se
-- compte à part dans `ecart_par_mois`. Le reste à payer d'un dossier (`recu`, impayés) le compte toujours : le dossier reste soldé.
-- Les statistiques détaillées (`analyse_faits`) renvoient déjà le type de chaque paiement : le tri s'y fait dans l'interface (stats-calc.mjs).
-- Miroir JavaScript : analyserLocal (src/gestion/js/analyses.mjs), comparé par docs/gestion/verif-analyses.mjs.
--
-- À exécuter une seule fois, après la migration 21. Ne modifie aucune donnée. Idempotente. Les droits de la fonction ne changent pas.

begin;

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
    where d.entite_id = e and (voit_tout(e) or d.responsable_id = auth.uid() or d.cree_par = auth.uid())
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
        from paiements p left join tot t on t.id = p.dossier_id where p.entite_id = e and p.date between du and au and coalesce(p.type, '') <> 'ecart' group by 1, 2) x), '[]'::jsonb),
    -- Écarts soldés (frais Wise, change) : le dossier est soldé, l'argent n'est pas arrivé chez nous. À part, jamais dans l'encaissé.
    'ecart_par_mois', coalesce((select jsonb_agg(x order by x.mois, x.devise) from (
        select to_char(p.date, 'YYYY-MM') as mois, coalesce(t.devise, dev) as devise, round(sum(p.montant), 2) as montant, count(*)::int as nombre
        from paiements p left join tot t on t.id = p.dossier_id where p.entite_id = e and p.date between du and au and p.type = 'ecart' group by 1, 2) x), '[]'::jsonb),
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
