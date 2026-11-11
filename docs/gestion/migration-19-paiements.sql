-- Gestion : migration 19, paiements simples (la plupart des clients paient le prestataire sur place, qui reverse ensuite une commission).
-- À exécuter une seule fois, AVANT de publier la nouvelle version de l'outil. Ne modifie aucun montant, total ni paiement existant :
-- ajoute deux colonnes avec une valeur neutre et apprend au résumé de dossier à connaître le montant payé sur place.

begin;

-- 1. Règle de commission chiffrée d'un partenaire : { "type": "pourcent_vente" | "pourcent_net" | "fixe_personne" | "fixe_reservation", "valeur": nombre }.
-- Données privées, comme les commissions en texte : la table partenaires_prives n'est lisible qu'avec le droit « nets ».
alter table partenaires_prives add column if not exists commission_regle jsonb;

-- 2. Prix des services payés directement au prestataire, dans le dernier document du dossier (facture, sinon devis).
-- Sert à reconnaître un dossier « tout sur place » (total à régler à zéro, rien à encaisser) sans charger ses documents.
alter table dossiers_resume add column if not exists sur_place numeric(14, 2) not null default 0;

create or replace function montant_sur_place(c jsonb) returns numeric language sql immutable as $$
  select round(coalesce(sum(
    case
      when e->>'unite' ~ '^-?[0-9]+(\.[0-9]+)?$' and e->>'qte' ~ '^-?[0-9]+(\.[0-9]+)?$' then round((e->>'unite')::numeric * (e->>'qte')::numeric, 2)
      when e->>'montant' ~ '^-?[0-9]+(\.[0-9]+)?$' then round((e->>'montant')::numeric, 2)
      else 0
    end
  ), 0), 2)
  from jsonb_array_elements(coalesce(c->'lignes', '[]'::jsonb)) e
  where e->>'paye_sur_place' = 'true' and coalesce(e->>'kind', 'ligne') not in ('remise', 'texte')
$$;

revoke all on function montant_sur_place(jsonb) from public, anon;
grant execute on function montant_sur_place(jsonb) to authenticated;

-- Le résumé tient `sur_place` à jour comme le total (même fonction qu'avant, une colonne de plus).
create or replace function recalculer_dossier(did uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  ent uuid;
  f jsonb;
  v jsonb;
  ve date;
begin
  select entite_id into ent from dossiers where id = did;
  if ent is null then return; end if;
  select contenu into f from documents where dossier_id = did and type = 'facture' order by date_emission desc, created_at desc limit 1;
  select contenu, envoye_le into v, ve from documents where dossier_id = did and type = 'devis' order by date_emission desc, created_at desc limit 1;
  update dossiers set devis_envoye_le = ve, a_facture = (f is not null)
  where id = did and (devis_envoye_le is distinct from ve or a_facture is distinct from (f is not null));
  insert into dossiers_resume (dossier_id, entite_id, total, devise, recu, sur_place)
  values (did, ent, coalesce(total_document(coalesce(f, v)), 0), coalesce(f, v)->>'devise', (select coalesce(sum(montant), 0) from paiements where dossier_id = did), coalesce(montant_sur_place(coalesce(f, v)), 0))
  on conflict (dossier_id) do update set total = excluded.total, devise = excluded.devise, recu = excluded.recu, sur_place = excluded.sur_place;
end
$$;

-- 3. Remplissage : seuls les dossiers dont un document porte déjà une ligne payée sur place ont un montant à calculer (les autres gardent 0).
select recalculer_dossier(d.dossier_id) from (select distinct dossier_id from documents where contenu::text like '%"paye_sur_place"%') d;

commit;
