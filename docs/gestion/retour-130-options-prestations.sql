-- Gestion : retour en arrière de la migration 130. Les options redeviennent des prestations ordinaires (la colonne est retirée).
-- Les lignes de facture déjà rattachées (option_de dans le JSON des documents) restent rattachées à leur réservation.
begin;
drop trigger if exists suivre_nets_options_document on documents;
drop function if exists suivre_nets_options_document();
drop trigger if exists controler_service_sur_place on prestations;
drop function if exists controler_service_sur_place();
drop trigger if exists retirer_option_supprimee on prestations;
drop trigger if exists controler_service_avec_options on prestations;
drop trigger if exists controler_option_prestation on prestations;
drop function if exists retirer_option_supprimee();
drop function if exists controler_service_avec_options();
drop function if exists controler_option_prestation();
drop index if exists prestations_option_de_idx;
alter table prestations drop column if exists option_de;
create or replace function net_reservation_calcule(r reservations, out net numeric, out complet boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ids text[];
  doc_contenu jsonb;
  doc_nets jsonb;
  l jsonb;
  q numeric;
  brut numeric;
  ln numeric;
  enfant boolean;
  trouve boolean := false;
  a numeric := coalesce(nombre_json(r.personnes->'adultes'), 0);
  e numeric := coalesce(nombre_json(r.personnes->'enfants'), 0);
  p prestations%rowtype;
  pn prestations_nets%rowtype;
  t trajets%rowtype;
  tn trajets_nets%rowtype;
begin
  net := null;
  complet := true;
  -- 1. Les lignes de facture (ou du devis) qui ont donné la réservation.
  ids := array(select distinct x from unnest(array[nullif(r.ligne_id, '')] || array(select jsonb_array_elements_text(case when jsonb_typeof(r.details->'lignes_ids') = 'array' then r.details->'lignes_ids' else '[]'::jsonb end))) x where x is not null);
  if cardinality(ids) > 0 then
    select d.contenu, coalesce(dn.nets, '{}'::jsonb) into doc_contenu, doc_nets
    from documents d left join documents_nets dn on dn.document_id = d.id
    where d.dossier_id = r.dossier_id and d.type in ('facture', 'devis') and jsonb_typeof(d.contenu->'lignes') = 'array'
      and exists (select 1 from jsonb_array_elements(d.contenu->'lignes') x where x->>'id' = any (ids))
    order by (d.type = 'facture') desc, d.updated_at desc
    limit 1;
    if doc_contenu is not null then
      for l in select x from jsonb_array_elements(doc_contenu->'lignes') x where x->>'id' = any (ids) and coalesce(x->>'kind', 'ligne') not in ('texte', 'remise') loop
        trouve := true;
        q := coalesce(nombre_json(l->'qte'), 1);
        brut := case when nombre_json(l->'unite') is not null and nombre_json(l->'qte') is not null then nombre_json(l->'unite') * nombre_json(l->'qte') else nombre_json(l->'montant') end;
        enfant := coalesce(l->>'intro', '') ~* '(enfant|child)' or coalesce(nullif(l->>'titre', ''), l->>'libelle', '') ~* ',\s*(child|enfant)\M';
        ln := coalesce(nombre_json(doc_nets->(l->>'id')), net_catalogue_ligne(l->>'prestation_id', l->>'trajet_id', enfant));
        if ln is not null then
          net := coalesce(net, 0) + round(ln * q, 2);
        elsif coalesce(brut, 0) > 0 then
          complet := false;
        end if;
      end loop;
    end if;
  end if;
  if trouve then
    if not complet then net := null; end if;
    return;
  end if;
  -- 2. Sans ligne trouvée : le tarif de la réservation et ses personnes.
  if r.trajet_id is not null then
    select * into t from trajets where id = r.trajet_id;
    select * into tn from trajets_nets where trajet_id = r.trajet_id;
    if a > 0 then
      if tn.net_adulte is not null then net := round(tn.net_adulte * a, 2); else complet := false; end if;
    end if;
    if e > 0 and t.prix_enfant is not null then
      if tn.net_enfant is not null then net := coalesce(net, 0) + round(tn.net_enfant * e, 2); else complet := false; end if;
    end if;
    if not complet then net := null; end if;
    return;
  end if;
  if r.prestation_id is not null then
    select * into p from prestations where id = r.prestation_id;
    if p.id is null or p.sur_place then complet := false; return; end if;
    select * into pn from prestations_nets where prestation_id = p.id;
    q := case
      when p.unite = 'day' then greatest(1, coalesce(nullif(nombre_json(r.details->'jours'), 0), 1))
      when p.unite = 'sup' then greatest(0, a + e - 2)
      else coalesce(nullif(case p.unite when 'pp' then a + e when 'ad' then a when 'ch' then e else 1 end, 0), 1)
    end;
    if pn.net is not null then net := round(pn.net * q, 2); else complet := false; end if;
    return;
  end if;
  -- Service hors catalogue : aucun net connu.
  complet := false;
end
$$;

create or replace function remplir_nets_reservation() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE'
    and new.prestation_id is not distinct from old.prestation_id and new.trajet_id is not distinct from old.trajet_id
    and new.partenaire_id is not distinct from old.partenaire_id and new.personnes is not distinct from old.personnes
    and new.paye_sur_place is not distinct from old.paye_sur_place and new.montant_vente is not distinct from old.montant_vente
    and new.ligne_id is not distinct from old.ligne_id and new.statut is not distinct from old.statut
    and (new.details->'jours') is not distinct from (old.details->'jours') and (new.details->'lignes_ids') is not distinct from (old.details->'lignes_ids') then
    return null;
  end if;
  -- Le net ne dépend que du tarif, des personnes, des jours et des lignes (et revient avec un service réactivé).
  perform calculer_nets_reservation(new.id, false, tg_op = 'INSERT'
    or new.prestation_id is distinct from old.prestation_id or new.trajet_id is distinct from old.trajet_id
    or new.personnes is distinct from old.personnes or new.ligne_id is distinct from old.ligne_id or new.statut is distinct from old.statut
    or (new.details->'jours') is distinct from (old.details->'jours') or (new.details->'lignes_ids') is distinct from (old.details->'lignes_ids'));
  return null;
end
$$;
commit;
