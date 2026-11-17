-- Gestion : migration 31, le net et la commission prévus d'une réservation sont remplis par la base (lot F, point 12 de l'audit du 16.11.2026).
--
-- Le problème : quand Mook saisit un service dans Secret, son rôle n'a pas « partenaires.nets ». L'interface ne lit ni le net du catalogue ni la règle
-- de commission du partenaire, et ne peut rien écrire dans `reservations_nets`. La réservation restait sans net ni commission prévus : marge, dû aux
-- partenaires et commissions à recevoir incomplets jusqu'à ce qu'Anaïs les reprenne un par un.
--
-- La correction : un déclencheur sur `reservations` (création, et changement de tarif, de trajet, de partenaire, de personnes, de mode de règlement,
-- de prix vendu, de lignes ou de statut) calcule le net et la commission prévus avec les règles de l'interface et les écrit dans `reservations_nets`.
-- Il tourne avec les droits de la base (security definer) : Mook ne lit toujours aucun net, les politiques de lecture ne changent pas.
--
-- Règles de calcul (les mêmes que l'interface, voir operations-calc.mjs et partenaires-calc.mjs) :
--   * Net prévu, réservation née de lignes de facture (ligne_id, details.lignes_ids) : somme, ligne par ligne, du net de la ligne × sa quantité
--     (reservationsDepuisDocument). Le net d'une ligne est celui du document (documents_nets) ou, à défaut, celui du catalogue : la prestation
--     (`prestations_nets.net`, `net_enfant` pour une ligne enfant quand il existe), ou le trajet (`net_adulte`, `net_enfant` pour une ligne enfant).
--     Les nets inconnus ne comptent pas ; sans aucun net connu, le net reste vide.
--   * Net prévu, réservation saisie sans ligne (formulaire « Réservation à la main ») : le net du tarif × la quantité du formulaire (quantiteParDefaut :
--     par personne = adultes + enfants, par adulte = adultes, par enfant = enfants, par personne supplémentaire = personnes au-delà de deux, par jour =
--     jours, sinon 1). Trajet : adultes × net adulte, plus enfants × net enfant quand le trajet a un prix enfant.
--   * Commission prévue : seulement pour un service payé sur place, d'après la règle chiffrée du partenaire (`partenaires_prives.commission_regle`,
--     commissionPrevue) : % de la vente, % du net (seulement si le net de chaque ligne vendue est connu), montant par personne (adultes + enfants),
--     montant par réservation, ou vente moins net (jamais négative). Une donnée manque : rien n'est écrit, on ne devine jamais.
--
-- Ne jamais écraser une saisie à la main : la base garde la dernière valeur qu'elle a calculée (`net_prevu_auto`, `commission_prevue_auto`).
-- Elle ne réécrit le net (ou la commission) que s'il est vide ou encore égal à cette valeur. Toute autre valeur a été saisie par quelqu'un et reste.
-- Ce choix (comparaison plutôt que drapeau posé par l'interface) n'exige rien de l'interface : il marche quel que soit l'écran qui écrit (formulaire,
-- création depuis la facture, restauration, sauvegarde), et les nets d'avant cette migration, dont la valeur auto est vide, comptent comme saisis.
-- Un net payé (net_paye ou paye_le) et une commission reçue (commission_recue ou commission_recue_le) ne bougent plus.
--
-- Périmètre : les entreprises en mode excursions (Secret). Rien pour Taxi : pas de commission par défaut (décision du 12.11.2026, Mr. Brown l'annonce
-- après la course) et pas de fiduciaire (décision 5 du 17.11.2026). ZTP n'a pas de réservations. Rien pour un service ou un dossier annulé.
--
-- L'interface écrit encore elle-même ses nets (une insertion quand elle ne connaît pas de ligne). Une insertion dans `reservations_nets` pour une
-- réservation qui a déjà sa ligne (créée par le déclencheur) la complète au lieu d'échouer sur la clé unique : les valeurs envoyées gagnent, les
-- autres sont gardées.
--
-- À exécuter une seule fois, après la migration 30. Ne modifie aucune donnée existante (le rattrapage est à part : rattrapage-31-nets-base.sql).
-- Idempotente.

begin;

alter table reservations_nets add column if not exists net_prevu_auto numeric(12, 2);
alter table reservations_nets add column if not exists commission_prevue_auto numeric(12, 2);
comment on column reservations_nets.net_prevu_auto is 'Dernier net prévu calculé par la base (migration 31). net_prevu différent : saisi à la main, jamais réécrit.';
comment on column reservations_nets.commission_prevue_auto is 'Dernière commission prévue calculée par la base (migration 31). commission_prevue différente : saisie à la main, jamais réécrite.';

-- Un nombre lu dans du JSON (nombre, ou texte qui en est un), sinon null : `Number(x)` de l'interface, sans les cas exotiques.
create or replace function nombre_json(v jsonb) returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case jsonb_typeof(v)
    when 'number' then (v #>> '{}')::numeric
    when 'string' then case when btrim(v #>> '{}') ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then btrim(v #>> '{}')::numeric end
  end
$$;

-- Commission attendue d'après la règle chiffrée du partenaire, ou null quand la règle ou une donnée manque (commissionPrevue, operations-calc.mjs).
create or replace function commission_calculee(p_regle jsonb, p_vente numeric, p_net numeric, p_adultes numeric, p_enfants numeric) returns numeric
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  t text;
  v numeric;
  c numeric;
  n numeric;
begin
  if p_regle is null or jsonb_typeof(p_regle) <> 'object' then return null; end if;
  t := p_regle->>'type';
  if t is null or t not in ('pourcent_vente', 'pourcent_net', 'fixe_personne', 'fixe_reservation', 'vente_moins_net') then return null; end if;
  if t = 'vente_moins_net' then
    if p_vente is null or p_net is null then return null; end if;
    c := round(p_vente - p_net, 2);
    return case when c >= 0 then c end;
  end if;
  v := nombre_json(p_regle->'valeur');
  if v is null or v < 0 then return null; end if;
  if t = 'pourcent_vente' then return case when p_vente is not null then round(p_vente * v / 100, 2) end; end if;
  if t = 'pourcent_net' then return case when p_net is not null then round(p_net * v / 100, 2) end; end if;
  if t = 'fixe_personne' then
    n := coalesce(p_adultes, 0) + coalesce(p_enfants, 0);
    return case when n > 0 then round(v * n, 2) end;
  end if;
  return round(v, 2);
end
$$;

-- Net du catalogue pour une ligne de document : prestation (net, ou net enfant pour une ligne enfant s'il existe) ou trajet (net adulte ou enfant).
-- Une prestation « sur place » (frais réglés par le client) n'a pas de net chez nous.
create or replace function net_catalogue_ligne(p_prestation text, p_trajet text, p_enfant boolean) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  res numeric;
begin
  if p_trajet ~ uuid_re then
    select case when p_enfant then n.net_enfant else n.net_adulte end into res from trajets_nets n where n.trajet_id = p_trajet::uuid;
    return res;
  end if;
  if p_prestation ~ uuid_re then
    select case when p_enfant then coalesce(n.net_enfant, n.net) else n.net end into res
    from prestations p join prestations_nets n on n.prestation_id = p.id where p.id = p_prestation::uuid and not p.sur_place;
    return res;
  end if;
  return null;
end
$$;

-- Net prévu d'une réservation d'après ses lignes de facture, sinon d'après son tarif. `complet` : le net de chaque ligne vendue est connu
-- (condition d'une commission en % du net ou « vente moins net », comme commissionDuGroupe).
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
  if trouve then return; end if;
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

-- Calcule et écrit le net et la commission prévus d'une réservation. `p_vides_seulement` : ne remplit que les valeurs vides (rattrapage) ;
-- sinon une valeur encore égale au dernier calcul de la base suit aussi le nouveau calcul. Renvoie vrai si une ligne a été écrite.
create or replace function calculer_nets_reservation(p_id uuid, p_vides_seulement boolean default false) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r reservations%rowtype;
  n reservations_nets%rowtype;
  c record;
  regle jsonb;
  net_gere boolean;
  com_gere boolean;
  net_pour_com numeric;
  v_com numeric;
  n_net numeric;
  n_net_auto numeric;
  n_com numeric;
  n_com_auto numeric;
begin
  select * into r from reservations where id = p_id;
  if r.id is null or r.statut = 'annule' then return false; end if;
  if not exists (select 1 from reglages g where g.entite_id = r.entite_id and g.valeur->>'fonctionnement' = 'excursions') then return false; end if;
  if exists (select 1 from dossiers d where d.id = r.dossier_id and d.annule) then return false; end if;
  select * into n from reservations_nets where reservation_id = r.id for update;
  net_gere := n.id is null or (n.net_paye is null and n.paye_le is null and (n.net_prevu is null or (not p_vides_seulement and n.net_prevu = n.net_prevu_auto)));
  com_gere := n.id is null or (n.commission_recue is null and n.commission_recue_le is null and (n.commission_prevue is null or (not p_vides_seulement and n.commission_prevue = n.commission_prevue_auto)));
  if not net_gere and not com_gere then return false; end if;
  select * into c from net_reservation_calcule(r);
  n_net := case when net_gere then c.net else n.net_prevu end;
  n_net_auto := case when net_gere then c.net else n.net_prevu_auto end;
  if com_gere then
    if r.paye_sur_place and r.partenaire_id is not null then
      select pp.commission_regle into regle from partenaires_prives pp where pp.partenaire_id = r.partenaire_id;
      net_pour_com := case when net_gere then (case when c.complet then c.net end) else n.net_prevu end;
      v_com := commission_calculee(regle, r.montant_vente, net_pour_com, coalesce(nombre_json(r.personnes->'adultes'), 0), coalesce(nombre_json(r.personnes->'enfants'), 0));
    end if;
    n_com := v_com;
    n_com_auto := v_com;
  else
    n_com := n.commission_prevue;
    n_com_auto := n.commission_prevue_auto;
  end if;
  -- Rattrapage : une valeur vide reste vide si rien ne se calcule, sans toucher à la valeur auto.
  if p_vides_seulement then
    if n_net is null then n_net_auto := n.net_prevu_auto; end if;
    if n_com is null then n_com_auto := n.commission_prevue_auto; end if;
  end if;
  if n.id is null then
    if n_net is null and n_com is null then return false; end if;
    insert into reservations_nets (entite_id, reservation_id, net_prevu, net_prevu_auto, commission_prevue, commission_prevue_auto)
    values (r.entite_id, r.id, n_net, n_net_auto, n_com, n_com_auto);
    return true;
  end if;
  if (n_net, n_net_auto, n_com, n_com_auto) is not distinct from (n.net_prevu, n.net_prevu_auto, n.commission_prevue, n.commission_prevue_auto) then return false; end if;
  update reservations_nets set net_prevu = n_net, net_prevu_auto = n_net_auto, commission_prevue = n_com, commission_prevue_auto = n_com_auto where id = n.id;
  return true;
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
  perform calculer_nets_reservation(new.id, false);
  return null;
end
$$;

drop trigger if exists remplir_nets on reservations;
create trigger remplir_nets after insert or update on reservations for each row execute function remplir_nets_reservation();

-- Une insertion pour une réservation qui a déjà sa ligne de nets la complète : les valeurs envoyées gagnent, les autres (calculées par la base,
-- saisies ailleurs) sont gardées. Sans cela l'interface, qui ne connaît pas encore la ligne créée par le déclencheur, échouerait sur la clé unique.
-- Les droits ne changent pas : la politique d'écriture de `reservations_nets` s'applique toujours à la ligne insérée.
create or replace function fusionner_nets_reservation() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  existante reservations_nets%rowtype;
begin
  select * into existante from reservations_nets where reservation_id = new.reservation_id and id <> new.id for update;
  if existante.id is null then return new; end if;
  new := jsonb_populate_record(new, to_jsonb(existante) || jsonb_strip_nulls(to_jsonb(new)));
  delete from reservations_nets where id = existante.id;
  return new;
end
$$;

drop trigger if exists fusionner_nets on reservations_nets;
create trigger fusionner_nets before insert on reservations_nets for each row execute function fusionner_nets_reservation();

-- Fonctions internes : personne ne les appelle par l'API (elles liraient les nets sans le droit).
revoke all on function nombre_json(jsonb) from public, anon, authenticated;
revoke all on function commission_calculee(jsonb, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function net_catalogue_ligne(text, text, boolean) from public, anon, authenticated;
revoke all on function net_reservation_calcule(reservations) from public, anon, authenticated;
revoke all on function calculer_nets_reservation(uuid, boolean) from public, anon, authenticated;
revoke all on function remplir_nets_reservation() from public, anon, authenticated;
revoke all on function fusionner_nets_reservation() from public, anon, authenticated;

commit;
