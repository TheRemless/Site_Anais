-- Gestion : migration 127 (24.11.2026), import de brochure : le texte imprimé de chaque trajet gardé en base.
-- À exécuter une seule fois, APRÈS la migration 124, avant de publier l'outil qui l'utilise. Idempotente. Ne modifie aucune donnée existante.
-- Retour en arrière : retour-127-trajet-imprime.sql (la colonne est retirée, la fonction revient à sa version de la migration 124).
--
-- Revue des PR 346 et 347 (24.11.2026) : un nom de lieu ambigu (« Nakon », « Padang ») ou corrigé à la main ne doit pas perdre ce que la brochure
-- imprimait. trajets.imprime garde la ligne recopiée telle qu'imprimée (lieux, heures avec leur précision, « Lanta - Nakon | VIP Bus/Van | … »).
-- Les nets n'y sont jamais écrits par l'outil quand la personne n'a pas le droit « prix nets » (la fonction « assistant » les retire avant).
-- brochure_ecrire_ligne(op) est la même qu'en migration 124 (droits, une transaction, colonnes autorisées), avec « imprime » à la création
-- d'un trajet.

begin;

alter table trajets add column if not exists imprime text not null default '';

create or replace function brochure_ecrire_ligne(p_op jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  e uuid := nullif(p_op ->> 'entite_id', '')::uuid;
  t text := p_op ->> 'table';
  a text := p_op ->> 'action';
  v jsonb := coalesce(p_op -> 'valeurs', '{}'::jsonb);
  nv jsonb := p_op #> '{nets,valeurs}';
  enf jsonb := p_op -> 'enfant';
  rp prestations;
  rt trajets;
  re prestations;
  np prestations_nets;
  nt trajets_nets;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Connexion requise.'; end if;
  if e is null or t not in ('prestations', 'trajets') or a not in ('creer', 'modifier') then
    raise exception using errcode = '22023', message = 'Ligne de brochure invalide.';
  end if;
  if not (a_permission(e, 'partenaires.ecrire') and a_permission(e, 'partenaires.prix')) then
    raise exception using errcode = '42501', message = 'Importer une brochure demande les droits « Modifier les partenaires » et « Modifier les prix de vente ».';
  end if;
  if jsonb_typeof(nv) = 'object' and not a_permission(e, 'partenaires.nets') then
    raise exception using errcode = '42501', message = 'Un net ne s''écrit qu''avec le droit « Prix nets ». La ligne n''a pas été écrite.';
  end if;

  if t = 'prestations' then
    if a = 'creer' then
      insert into prestations (entite_id, partenaire_id, famille, groupe, libelle, libelle_en, prix_vente, unite, sur_place, actif, ordre, details)
      values (e, (v ->> 'partenaire_id')::uuid, coalesce(v ->> 'famille', 'excursion'), coalesce(v ->> 'groupe', ''), v ->> 'libelle',
              coalesce(v ->> 'libelle_en', ''), (v ->> 'prix_vente')::numeric, coalesce(v ->> 'unite', ''), coalesce((v ->> 'sur_place')::boolean, false),
              coalesce((v ->> 'actif')::boolean, true), coalesce((v ->> 'ordre')::integer, 0), coalesce(v -> 'details', '{}'::jsonb))
      returning * into rp;
    else
      update prestations set
        prix_vente = case when v ? 'prix_vente' then (v ->> 'prix_vente')::numeric else prix_vente end,
        details = case when v ? 'details' then coalesce(v -> 'details', '{}'::jsonb) else details end,
        updated_at = now()
      where id = (p_op ->> 'id')::uuid and entite_id = e
      returning * into rp;
      if rp.id is null then raise exception using errcode = 'P0002', message = 'Ce tarif n''existe plus : rechargez la fiche.'; end if;
    end if;
    -- La ligne enfant séparée d'un ancien tarif : du même partenaire, jamais une autre prestation.
    if jsonb_typeof(enf) = 'object' then
      update prestations set prix_vente = (enf #>> '{valeurs,prix_vente}')::numeric, updated_at = now()
      where id = (enf ->> 'id')::uuid and entite_id = e and partenaire_id is not distinct from rp.partenaire_id and unite = 'ch'
      returning * into re;
      if re.id is null then raise exception using errcode = 'P0002', message = 'La ligne enfant de ce tarif n''existe plus : rechargez la fiche.'; end if;
    end if;
    if jsonb_typeof(nv) = 'object' then
      insert into prestations_nets (entite_id, prestation_id, net, net_enfant, note)
      values (e, rp.id, (nv ->> 'net')::numeric, (nv ->> 'net_enfant')::numeric, coalesce(nv ->> 'note', ''))
      on conflict (prestation_id) do update set net = excluded.net, net_enfant = excluded.net_enfant, note = excluded.note
      returning * into np;
    end if;
    return jsonb_build_object('ligne', to_jsonb(rp), 'enfant', case when re.id is null then null else to_jsonb(re) end, 'nets', case when np.id is null then null else to_jsonb(np) end);
  end if;

  -- Trajets
  if a = 'creer' then
    insert into trajets (entite_id, partenaire_id, numero, de, vers, mode, depart, arrivee, duree, prix_adulte, prix_enfant, bebe, periode, fenetres, actif, imprime)
    values (e, (v ->> 'partenaire_id')::uuid, (v ->> 'numero')::integer, v ->> 'de', v ->> 'vers', coalesce(v ->> 'mode', ''), coalesce(v ->> 'depart', ''),
            coalesce(v ->> 'arrivee', ''), coalesce(v ->> 'duree', ''), (v ->> 'prix_adulte')::numeric, (v ->> 'prix_enfant')::numeric,
            coalesce(v ->> 'bebe', ''), coalesce(v ->> 'periode', ''), coalesce(v -> 'fenetres', '[]'::jsonb), coalesce((v ->> 'actif')::boolean, true),
            left(coalesce(v ->> 'imprime', ''), 400))
    returning * into rt;
  else
    update trajets set
      prix_adulte = case when v ? 'prix_adulte' then (v ->> 'prix_adulte')::numeric else prix_adulte end,
      prix_enfant = case when v ? 'prix_enfant' then (v ->> 'prix_enfant')::numeric else prix_enfant end,
      arrivee = case when v ? 'arrivee' then coalesce(v ->> 'arrivee', '') else arrivee end,
      duree = case when v ? 'duree' then coalesce(v ->> 'duree', '') else duree end
    where id = (p_op ->> 'id')::uuid and entite_id = e
    returning * into rt;
    if rt.id is null then raise exception using errcode = 'P0002', message = 'Ce trajet n''existe plus : rechargez la fiche.'; end if;
  end if;
  if jsonb_typeof(nv) = 'object' then
    insert into trajets_nets (entite_id, trajet_id, net_adulte, net_enfant)
    values (e, rt.id, (nv ->> 'net_adulte')::numeric, (nv ->> 'net_enfant')::numeric)
    on conflict (trajet_id) do update set net_adulte = excluded.net_adulte, net_enfant = excluded.net_enfant
    returning * into nt;
  end if;
  return jsonb_build_object('ligne', to_jsonb(rt), 'enfant', null, 'nets', case when nt.id is null then null else to_jsonb(nt) end);
end
$$;

revoke all on function brochure_ecrire_ligne(jsonb) from public, anon;
grant execute on function brochure_ecrire_ligne(jsonb) to authenticated;

commit;
