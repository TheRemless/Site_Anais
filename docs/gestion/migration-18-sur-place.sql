-- Gestion : migration 18, services payés sur place au prestataire.
-- À exécuter une seule fois, AVANT de publier la nouvelle version de l'outil. Ne modifie aucune donnée existante :
-- ajoute trois colonnes de suivi et apprend au calcul du total à ignorer les lignes payées directement au prestataire.

begin;

-- Un service que le client règle directement au prestataire : pas de net à lui verser, c'est lui qui reverse une commission.
alter table reservations add column paye_sur_place boolean not null default false;

-- Commission que le prestataire reverse après la prestation : prévue, reçue, date de réception. Même droit que les nets.
alter table reservations_nets add column commission_prevue numeric(12, 2);
alter table reservations_nets add column commission_recue numeric(12, 2);
alter table reservations_nets add column commission_recue_le date;

-- Total d'un document : une ligne marquée `paye_sur_place` reste sur le document mais n'entre pas dans le total à régler
-- (comme dans l'application). Les remises en pourcentage se calculent sur le total sans ces lignes.
create or replace function total_document(c jsonb) returns numeric language sql immutable as $$
  with l as (
    select coalesce(e->>'kind', 'ligne') as kind,
      case
        when e->>'paye_sur_place' = 'true' then 0
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

commit;
