-- Gestion : migration 21, revue de sécurité du 11.11.2026 : portée des analyses et corbeille sans nets.
-- 1. Les analyses respectent la portée du rôle.
-- Jusqu'ici tableau_analytique (migration 14) et analyse_faits (migration 20) étaient « security definer » et portaient sur TOUTE l'entreprise :
-- un rôle limité à « ses dossiers » mais qui a les droits « analyses » et « montants » recevait les dossiers, paiements et noms de clients de ses collègues.
-- Les deux fonctions appliquent maintenant la même règle que la table des dossiers : tout voir, ou seulement les dossiers dont on est responsable ou créateur.
-- Aucun rôle existant n'est concerné en production le 11.11.2026 (tous sont en portée « toute ») : ni chiffre ni écran ne change aujourd'hui.
-- 2. La corbeille garde, dans `liees`, les nets des réservations et des documents d'un dossier supprimé (migration 16), pour les remettre à la restauration.
-- Elle était lisible avec le seul droit « dossiers.supprimer » : un rôle sans « nets » pouvait donc lire nets et commissions des dossiers supprimés
-- depuis moins de 90 jours. La colonne `liees` n'est plus lisible par l'API ; la restauration (security definer) la lit toujours.
-- À exécuter une seule fois, après la migration 20. Ne modifie aucune donnée. Idempotente.

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

create or replace function analyse_faits(e uuid, debut date, fin date, jour date default current_date, parties text[] default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  dev text;
  nets boolean;
  res jsonb;
begin
  if not (a_permission(e, 'analytics.voir') and a_permission(e, 'finances.voir')) then
    raise exception 'Droit insuffisant pour voir les analyses' using errcode = '42501';
  end if;
  nets := a_permission(e, 'partenaires.nets');
  select coalesce(valeur->>'devise', '') into dev from reglages where entite_id = e;
  dev := coalesce(dev, '');
  with dos as (
    select d.id, d.ref, d.client_id, d.pays, d.responsable_id, d.accepte_le, d.annule, d.date_depart, d.date_retour,
      f.contenu as fc, f.date_emission as f_date, v.contenu as dc, v.date_emission as v_date
    from dossiers d
    left join lateral (select contenu, date_emission from documents x where x.dossier_id = d.id and x.type = 'facture' order by x.date_emission desc, x.created_at desc limit 1) f on true
    left join lateral (select contenu, date_emission from documents x where x.dossier_id = d.id and x.type = 'devis' order by x.date_emission desc, x.created_at desc limit 1) v on true
    where d.entite_id = e and (voit_tout(e) or d.responsable_id = auth.uid() or d.cree_par = auth.uid())
  ), tot as (
    select dos.*,
      coalesce(nullif(coalesce(fc, dc)->>'devise', ''), dev) as devise,
      case when coalesce(fc, dc) is null then 0 else total_document(coalesce(fc, dc)) end as total,
      case when coalesce(fc, dc) is null then 0 else montant_sur_place(coalesce(fc, dc)) end as sur_place,
      coalesce((select sum(p.montant) from paiements p where p.dossier_id = dos.id), 0) as recu,
      trim(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, '')) as client,
      coalesce(nullif(trim(coalesce(pr.nom, '')), ''), nullif(trim(coalesce(pr.email, '')), '')) as responsable
    from dos
    left join clients c on c.id = dos.client_id
    left join profils pr on pr.user_id = dos.responsable_id
  ), depuis as (
    select client_id, min(coalesce(f_date, accepte_le, v_date)) as premier
    from tot where (fc is not null or dc is not null) and not annule and (accepte_le is not null or fc is not null) group by client_id
  ), pertinents as (
    select t.*, d.premier from tot t left join depuis d on d.client_id = t.client_id
    where (fc is not null or dc is not null) and (
      coalesce(f_date, accepte_le, v_date) between debut and fin or v_date between debut and fin or accepte_le between debut and fin or f_date between debut and fin
      or (not annule and fc is not null and round(total - recu, 2) > 0)
      or (not annule and accepte_le is null and fc is null and dc is not null and v_date <= jour)
      or date_depart >= jour)
  )
  select jsonb_build_object(
    'nets', nets,
    'devise_defaut', dev,
    'dossiers', case when parties is null or 'dossiers' = any (parties) then coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'ref', coalesce(ref, ''), 'client_id', client_id, 'client', client, 'pays', nullif(pays, ''), 'responsable', responsable,
        'accepte_le', to_char(accepte_le, 'YYYY-MM-DD'), 'annule', annule, 'date_depart', to_char(date_depart, 'YYYY-MM-DD'), 'date_retour', to_char(date_retour, 'YYYY-MM-DD'),
        'f_date', to_char(f_date, 'YYYY-MM-DD'), 'v_date', to_char(v_date, 'YYYY-MM-DD'), 'devise', devise,
        'total', total, 'sur_place', sur_place, 'recu', recu, 'client_depuis', to_char(premier, 'YYYY-MM-DD')) order by id) from pertinents), '[]'::jsonb) else '[]'::jsonb end,
    'paiements', case when parties is null or 'paiements' = any (parties) then coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'dossier_id', p.dossier_id, 'ref', t.ref, 'client', t.client, 'date', to_char(p.date, 'YYYY-MM-DD'), 'montant', p.montant,
        'moyen', nullif(p.moyen, ''), 'type', nullif(p.type, ''), 'devise', t.devise) order by p.id)
        from paiements p join tot t on t.id = p.dossier_id where p.entite_id = e and p.date between debut and fin), '[]'::jsonb) else '[]'::jsonb end,
    'reservations', case when parties is null or 'reservations' = any (parties) then coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'dossier_id', x.dossier_id, 'ref', x.ref, 'client', x.client, 'devise', x.devise, 'dossier_annule', x.annule,
        'libelle', coalesce(x.libelle, ''), 'partenaire_id', x.partenaire_id, 'partenaire', x.partenaire, 'famille', x.famille,
        'date_service', to_char(x.date_service, 'YYYY-MM-DD'), 'statut', x.statut, 'montant_vente', x.montant_vente, 'paye_sur_place', x.paye_sur_place,
        'adultes', x.adultes, 'enfants', x.enfants, 'bebes', x.bebes,
        'net_prevu', x.net_prevu, 'net_paye', x.net_paye, 'paye_le', to_char(x.paye_le, 'YYYY-MM-DD'),
        'commission_prevue', x.commission_prevue, 'commission_recue', x.commission_recue, 'commission_recue_le', to_char(x.commission_recue_le, 'YYYY-MM-DD')) order by x.id)
      from (
        select r.id, r.dossier_id, t.ref, t.client, t.devise, t.annule, r.libelle, r.partenaire_id, pa.nom as partenaire,
          coalesce(pr.famille, case when r.trajet_id is not null then 'billet' else 'autre' end) as famille,
          r.date_service, r.statut, r.montant_vente, r.paye_sur_place,
          case when r.personnes->>'adultes' ~ '^[0-9]+(\.[0-9]+)?$' then (r.personnes->>'adultes')::numeric else 0 end as adultes,
          case when r.personnes->>'enfants' ~ '^[0-9]+(\.[0-9]+)?$' then (r.personnes->>'enfants')::numeric else 0 end as enfants,
          case when r.personnes->>'bebes' ~ '^[0-9]+(\.[0-9]+)?$' then (r.personnes->>'bebes')::numeric else 0 end as bebes,
          case when nets then n.net_prevu end as net_prevu, case when nets then n.net_paye end as net_paye, case when nets then n.paye_le end as paye_le,
          case when nets then n.commission_prevue end as commission_prevue, case when nets then n.commission_recue end as commission_recue,
          case when nets then n.commission_recue_le end as commission_recue_le
        from reservations r
        join tot t on t.id = r.dossier_id
        left join reservations_nets n on n.reservation_id = r.id
        left join prestations pr on pr.id = r.prestation_id
        left join partenaires pa on pa.id = r.partenaire_id
        where r.entite_id = e
      ) x
      where x.date_service is null or x.date_service between debut and fin or x.date_service >= jour
        or (nets and (x.commission_recue_le between debut and fin or x.paye_le between debut and fin))
        or (nets and x.statut <> 'annule' and not x.annule and x.paye_sur_place and x.commission_recue_le is null and (x.commission_prevue is null or round(x.commission_prevue - coalesce(x.commission_recue, 0), 2) > 0))
        or (nets and x.statut <> 'annule' and not x.annule and not x.paye_sur_place and x.net_prevu is not null and round(x.net_prevu - coalesce(x.net_paye, 0), 2) > 0)
      ), '[]'::jsonb) else '[]'::jsonb end
  ) into res;
  return res;
end
$$;

revoke all on function tableau_analytique(uuid, date, date, date) from public, anon;
grant execute on function tableau_analytique(uuid, date, date, date) to authenticated;
revoke all on function analyse_faits(uuid, date, date, date, text[]) from public, anon;
grant execute on function analyse_faits(uuid, date, date, date, text[]) to authenticated;

revoke select on corbeille from authenticated;
grant select (id, entite_id, table_name, ligne, supprime_par, supprime_le) on corbeille to authenticated;

commit;
