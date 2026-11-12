-- Gestion : migration 29, statistiques : dernier jour d'un service (date_fin).
-- Depuis la PR 183, l'outil compte les étapes d'après le service (commission échue, en retard) sur le retour d'une location
-- (details.retour_date) et non sur la prise. La version locale des statistiques donnait déjà ce jour-là ; analyse_faits ne le donnait pas,
-- l'écran retombait donc sur le jour de la prise en production. Même règle que dateFinService (operations-calc.mjs) :
-- le retour s'il est une date AAAA-MM-JJ postérieure à la prise, sinon le jour du service.
-- Seul ajout à la fonction de la migration 21 : la colonne date_fin des réservations. Portée et droits inchangés.
-- À exécuter une seule fois, après la migration 21. Ne modifie aucune donnée. Idempotente.

begin;

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
        'date_service', to_char(x.date_service, 'YYYY-MM-DD'), 'date_fin', x.date_fin, 'statut', x.statut, 'montant_vente', x.montant_vente, 'paye_sur_place', x.paye_sur_place,
        'adultes', x.adultes, 'enfants', x.enfants, 'bebes', x.bebes,
        'net_prevu', x.net_prevu, 'net_paye', x.net_paye, 'paye_le', to_char(x.paye_le, 'YYYY-MM-DD'),
        'commission_prevue', x.commission_prevue, 'commission_recue', x.commission_recue, 'commission_recue_le', to_char(x.commission_recue_le, 'YYYY-MM-DD')) order by x.id)
      from (
        select r.id, r.dossier_id, t.ref, t.client, t.devise, t.annule, r.libelle, r.partenaire_id, pa.nom as partenaire,
          coalesce(pr.famille, case when r.trajet_id is not null then 'billet' else 'autre' end) as famille,
          r.date_service, r.statut, r.montant_vente, r.paye_sur_place,
          case when r.details->>'retour_date' ~ '^\d{4}-\d{2}-\d{2}$' and (r.details->>'retour_date') collate "C" > to_char(r.date_service, 'YYYY-MM-DD') collate "C"
            then r.details->>'retour_date' else to_char(r.date_service, 'YYYY-MM-DD') end as date_fin,
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

revoke all on function analyse_faits(uuid, date, date, date, text[]) from public, anon;
grant execute on function analyse_faits(uuid, date, date, date, text[]) to authenticated;

commit;
