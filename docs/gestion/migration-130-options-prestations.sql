-- Gestion : migration 130 (26.11.2026), options d'un service. Une prestation peut compléter une ou plusieurs autres du même partenaire
-- (« Koh Kradan extension » du 4 Islands privé, lunch box, transfert d'hôtel) : elle se choisit sous son service et va sur sa réservation.
-- À exécuter une seule fois, après la migration 128, avec l'outil et la fonction « agent » du même commit. Idempotente. Ne modifie aucune donnée :
-- les prestations existantes deviennent des options par un SQL de conversion à part, remis hors du dépôt, après accord.
-- Retour en arrière : retour-130-options-prestations.sql (rend aussi net_reservation_calcule et remplir_nets_reservation de la migration 32).
--
-- Avant : une extension et son service étaient deux prestations à part, donc deux services et deux vouchers.
-- Règles tenues par la base (quel que soit l'écran) :
--   - `option_de` : les prestations que celle-ci complète. Toutes de la même entreprise ET du même partenaire (un seul voucher, un seul
--     prestataire), aucune n'est elle-même une option (pas d'option d'option), jamais elle-même ;
--   - une prestation qui a des options ne devient pas une option ; une note « à payer sur place » (frais de parc) n'est pas une option ;
--   - une prestation supprimée sort des listes `option_de` des autres.
-- Les lignes de facture d'une option portent `option_de` (l'id de la ligne du service) dans le JSON du document : rien à changer en base,
-- le net et la commission prévus d'une réservation se calculent déjà sur toutes ses lignes (net_reservation_calcule, migration 32).
begin;

alter table prestations add column if not exists option_de uuid[] not null default '{}';
create index if not exists prestations_option_de_idx on prestations using gin (option_de);

create or replace function controler_option_prestation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Sans doublon ni valeur vide.
  new.option_de := coalesce((select array_agg(distinct x order by x) from unnest(new.option_de) x where x is not null), '{}');
  if cardinality(new.option_de) = 0 then return new; end if;
  if new.id = any (new.option_de) then
    raise exception 'Une prestation ne peut pas être sa propre option.' using errcode = '22023';
  end if;
  if new.sur_place then
    raise exception 'Une note « à payer sur place » ne peut pas être une option.' using errcode = '22023';
  end if;
  -- Écritures concurrentes (relecture de la PR 359) : les services visés sont verrouillés avant d'être lus, pour qu'un autre écran ne
  -- puisse pas, au même instant, en changer le partenaire, en faire une option ou une note « sur place ». Les contrôles suivants lisent l'état validé.
  perform 1 from prestations p where p.id = any (new.option_de) order by p.id for share;
  if exists (select 1 from unnest(new.option_de) x where not exists (
      select 1 from prestations p where p.id = x and p.entite_id = new.entite_id and p.partenaire_id is not distinct from new.partenaire_id and cardinality(p.option_de) = 0 and not p.sur_place)) then
    raise exception 'Une option complète un service du même partenaire et de la même entreprise, qui n''est pas lui-même une option.' using errcode = '22023';
  end if;
  if exists (select 1 from prestations p where p.id <> new.id and new.id = any (p.option_de)) then
    raise exception 'Cette prestation a déjà des options : elle ne peut pas devenir l''option d''une autre.' using errcode = '22023';
  end if;
  return new;
end
$$;
revoke all on function controler_option_prestation() from public, anon, authenticated;

drop trigger if exists controler_option_prestation on prestations;
create trigger controler_option_prestation before insert or update of option_de, entite_id, partenaire_id, sur_place on prestations
  for each row execute function controler_option_prestation();

-- Un service qui change de partenaire ou d'entreprise garderait des options d'ailleurs : refusé tant qu'il en a.
create or replace function controler_service_avec_options() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.partenaire_id is distinct from old.partenaire_id or new.entite_id is distinct from old.entite_id)
     and exists (select 1 from prestations p where p.id <> new.id and new.id = any (p.option_de) and (p.partenaire_id is distinct from new.partenaire_id or p.entite_id <> new.entite_id)) then
    raise exception 'Ce service a des options d''un autre partenaire : retirez-les ou changez-les d''abord.' using errcode = '22023';
  end if;
  return new;
end
$$;
revoke all on function controler_service_avec_options() from public, anon, authenticated;

drop trigger if exists controler_service_avec_options on prestations;
create trigger controler_service_avec_options before update of partenaire_id, entite_id on prestations
  for each row execute function controler_service_avec_options();

-- Une prestation supprimée sort des listes des autres (même entreprise seulement). Une option qui n'a plus aucun service est masquée :
-- elle ne devient jamais vendable seule.
create or replace function retirer_option_supprimee() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update prestations set option_de = array_remove(option_de, old.id), actif = case when cardinality(array_remove(option_de, old.id)) = 0 then false else actif end
  where entite_id = old.entite_id and old.id = any (option_de);
  return old;
end
$$;

-- Un service qui devient une note « à payer sur place » ne garde pas d'options.
create or replace function controler_service_sur_place() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.sur_place and not old.sur_place and exists (select 1 from prestations p where p.id <> new.id and new.id = any (p.option_de)) then
    raise exception 'Ce service a des options : il ne peut pas devenir une note « à payer sur place ».' using errcode = '22023';
  end if;
  return new;
end
$$;
revoke all on function controler_service_sur_place() from public, anon, authenticated;
drop trigger if exists controler_service_sur_place on prestations;
create trigger controler_service_sur_place before update of sur_place on prestations for each row execute function controler_service_sur_place();

-- Le net prévu d'un service ajouté par carte (sans ligne de facture) compte ses options (details.options : prestation_id, qte), et se
-- recalcule quand elles changent. Mêmes fonctions que la migration 32, avec ces deux ajouts.
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
    -- Les options d'un service sans ligne de facture (service ajouté par carte, migration 130) : leur net compte aussi, pour leur quantité.
    for l in select x from jsonb_array_elements(case when jsonb_typeof(r.details->'options') = 'array' then r.details->'options' else '[]'::jsonb end) x loop
      ln := net_catalogue_ligne(l->>'prestation_id', null, false);
      if ln is not null then net := coalesce(net, 0) + round(ln * coalesce(nombre_json(l->'qte'), 1), 2); else complet := false; end if;
    end loop;
    if not complet then net := null; end if;
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
    and (new.details->'jours') is not distinct from (old.details->'jours') and (new.details->'lignes_ids') is not distinct from (old.details->'lignes_ids')
    and (new.details->'options') is not distinct from (old.details->'options') then
    return null;
  end if;
  -- Le net ne dépend que du tarif, des personnes, des jours et des lignes (et revient avec un service réactivé).
  perform calculer_nets_reservation(new.id, false, tg_op = 'INSERT'
    or new.prestation_id is distinct from old.prestation_id or new.trajet_id is distinct from old.trajet_id
    or new.personnes is distinct from old.personnes or new.ligne_id is distinct from old.ligne_id or new.statut is distinct from old.statut
    or (new.details->'jours') is distinct from (old.details->'jours') or (new.details->'lignes_ids') is distinct from (old.details->'lignes_ids')
    or (new.details->'options') is distinct from (old.details->'options'));
  return null;
end
$$;

-- Une ligne d'option changée sur la facture ou le devis (ajoutée, retirée, autre prestation, autre quantité : un seul plongeur sur deux) :
-- le net prévu des réservations qui portent ces lignes suit, comme pour un changement de la réservation (relecture de la PR 359). Un net tapé
-- à la main reste (calculer_nets_reservation, migration 32 : seul un net encore égal au dernier calcul suit).
create or replace function suivre_nets_options_document() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  avant jsonb := case when jsonb_typeof(old.contenu->'lignes') = 'array' then old.contenu->'lignes' else '[]'::jsonb end;
  apres jsonb := case when jsonb_typeof(new.contenu->'lignes') = 'array' then new.contenu->'lignes' else '[]'::jsonb end;
  ids text[];
  x record;
begin
  ids := array(
    select l->>'id' from jsonb_array_elements(apres) l
    where nullif(l->>'option_de', '') is not null
      and not exists (select 1 from jsonb_array_elements(avant) o where o->>'id' = l->>'id' and o->>'prestation_id' is not distinct from l->>'prestation_id' and o->'qte' is not distinct from l->'qte')
    union
    select o->>'id' from jsonb_array_elements(avant) o
    where nullif(o->>'option_de', '') is not null and not exists (select 1 from jsonb_array_elements(apres) l where l->>'id' = o->>'id'));
  if cardinality(ids) = 0 then return null; end if;
  for x in select r.id from reservations r
           where r.dossier_id = new.dossier_id and r.statut <> 'annule'
             and (r.ligne_id = any (ids) or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(r.details->'lignes_ids') = 'array' then r.details->'lignes_ids' else '[]'::jsonb end) z where z = any (ids)))
           order by r.id loop
    perform calculer_nets_reservation(x.id, false, true);
  end loop;
  return null;
end
$$;
revoke all on function suivre_nets_options_document() from public, anon, authenticated;
drop trigger if exists suivre_nets_options_document on documents;
create trigger suivre_nets_options_document after update of contenu on documents
  for each row when (new.type in ('facture', 'devis')) execute function suivre_nets_options_document();

revoke all on function retirer_option_supprimee() from public, anon, authenticated;

drop trigger if exists retirer_option_supprimee on prestations;
create trigger retirer_option_supprimee after delete on prestations
  for each row execute function retirer_option_supprimee();

commit;
