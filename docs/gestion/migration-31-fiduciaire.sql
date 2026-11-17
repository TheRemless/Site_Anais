-- Gestion : migration 31, factures pour la fiduciaire, lot H de l'audit d'autonomie (17.11.2026).
-- À exécuter une seule fois, après la migration 28. Les fonctions restent compatibles avec l'outil d'avant (mêmes noms, arguments en plus facultatifs).
--
-- Ce qui change :
--   * Taxi sort de la fiduciaire (décision de Jérémy du 17.11.2026). Chaque entreprise a un réglage « actif » (reglages.fiduciaire.actif) ;
--     sans réglage : actif en mode excursions (Secret), inactif en mode taxi. Une entreprise inactive n'émet aucune nouvelle facture ;
--     ce qui a déjà été facturé reste lisible et se corrige par un avoir.
--   * Réglages de la fiduciaire par entreprise, modifiables dans l'écran Fiduciaire : date de départ, préfixes des numéros (COM, CN),
--     titres (INVOICE, CREDIT NOTE), mots du libellé (« Commission on », « Margin on »). Plus aucun code d'entreprise (« secret », « taxi ») dans les fonctions.
--   * Émetteur : l'entreprise du service (son identité, son compte, son QR code), et non plus toujours Secret.
--   * Le QR code est figé à l'émission : il se lit dans reglages.apparence (comme sur les factures des clients) et la migration 28 copiait
--     reglages.paiement.qr_image, qui n'existe pas. Les titres sont figés aussi.
--   * « Déjà facturé » se compte par destinataire (colonne destinataire_id) : quand le prestataire d'un service change, le nouveau reçoit
--     la facture entière et l'ancien apparaît « à revoir » avec l'avoir à émettre (annuler_facture_fiduciaire, argument p_destinataire).
--   * Remise de la facture du client (décision 4) : sa part, au prorata du prix de vente du service, baisse la marge déclarée.
--   * Dossier annulé : traité comme un service annulé, même si ses réservations ne le sont pas.
--   * Numérotation : une série par préfixe et par année (changer de préfixe démarre une nouvelle série).
--
-- Mêmes règles que src/gestion/js/fiduciaire-calc.mjs et fiduciaire-local.mjs ; docs/gestion/verif-fiduciaire.mjs compare les deux.

begin;

-- 1. Destinataire de chaque facture : le partenaire. Les factures existantes le reçoivent quand le nom correspond au prestataire actuel du service.
-- Pas de clé étrangère : la suppression d'un partenaire ne doit pas réécrire une facture figée.
alter table fiduciaire_factures add column if not exists destinataire_id uuid;
create index if not exists fiduciaire_factures_res_dest on fiduciaire_factures (reservation_id, destinataire_id);
alter table fiduciaire_factures disable trigger figer;
update fiduciaire_factures f set destinataire_id = p.id
  from reservations r join partenaires p on p.id = r.partenaire_id and p.entite_id = r.entite_id
  where r.id = f.reservation_id and f.destinataire_id is null and p.nom = f.destinataire->>'nom';
alter table fiduciaire_factures enable trigger figer;

-- 2. Numérotation par préfixe : la colonne type reste pour mémoire, la série se repère au préfixe.
alter table fiduciaire_compteurs add column if not exists prefixe text;
update fiduciaire_compteurs set prefixe = case when type = 'avoir' then 'CN' else 'COM' end where prefixe is null;
alter table fiduciaire_compteurs alter column prefixe set not null;
alter table fiduciaire_compteurs drop constraint if exists fiduciaire_compteurs_pkey;
alter table fiduciaire_compteurs add primary key (prefixe, annee);
-- Le numéro reste unique ; deux séries peuvent avoir le même rang.
alter table fiduciaire_factures drop constraint if exists fiduciaire_factures_type_annee_seq_key;

-- 3. Réglages de la fiduciaire d'une entreprise, avec leurs valeurs par défaut (reglagesFid côté outil).
create or replace function fiduciaire_texte(v text, d text) returns text language sql immutable as $$
  -- Mêmes blancs retirés que trim() côté outil (espaces, tabulations, retours à la ligne).
  select coalesce(nullif(regexp_replace(coalesce(v, ''), '^\s+|\s+$', '', 'g'), ''), d)
$$;
create or replace function fiduciaire_reglages(p_entite uuid) returns jsonb language sql stable security definer set search_path = public as $$
  with g as (select (select valeur from reglages where entite_id = p_entite) as v),
  x as (select coalesce(v->'fiduciaire', '{}'::jsonb) as f, v->>'fonctionnement' as fct from g)
  select jsonb_build_object(
    'actif', case when jsonb_typeof(f->'actif') = 'boolean' then (f->>'actif')::boolean else coalesce(fct = 'excursions', false) end,
    'depuis', case when f->>'depuis' ~ '^\d{4}-\d{2}-\d{2}$' then f->>'depuis' else '' end,
    'prefixe_facture', fiduciaire_texte(f->>'prefixe_facture', 'COM'),
    'prefixe_avoir', fiduciaire_texte(f->>'prefixe_avoir', 'CN'),
    'titre_facture', fiduciaire_texte(f->>'titre_facture', 'INVOICE'),
    'titre_avoir', fiduciaire_texte(f->>'titre_avoir', 'CREDIT NOTE'),
    'ref_facture', fiduciaire_texte(f->>'ref_facture', 'Invoice no.'),
    'ref_avoir', fiduciaire_texte(f->>'ref_avoir', 'Credit note no.'),
    'mot_commission', fiduciaire_texte(f->>'mot_commission', 'Commission on'),
    'mot_marge', fiduciaire_texte(f->>'mot_marge', 'Margin on'))
  from x
$$;
revoke all on function fiduciaire_texte(text, text), fiduciaire_reglages(uuid) from public, anon, authenticated;

-- L'écran Fiduciaire existe pour les entreprises en mode excursions ou taxi (les factures n'y partent que si « actif »).
create or replace function fiduciaire_concernee(p_entite uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select valeur->>'fonctionnement' from reglages where entite_id = p_entite) in ('excursions', 'taxi'), false)
$$;
revoke all on function fiduciaire_concernee(uuid) from public, anon, authenticated;

-- Date de départ d'une entreprise (reglages.fiduciaire.depuis). L'ancienne version sans argument lisait Secret : elle disparaît.
drop function if exists fiduciaire_depuis();
create or replace function fiduciaire_depuis(p_entite uuid) returns date language sql stable security definer set search_path = public as $$
  select nullif(fiduciaire_reglages(p_entite)->>'depuis', '')::date
$$;
revoke all on function fiduciaire_depuis(uuid) from public, anon, authenticated;

-- 4. Part de la remise de la facture du client qui revient à un service (partRemise côté outil). Même calcul que total_document (migration 18) :
-- les remises en pourcentage portent sur le total sans les lignes payées sur place. La facture retenue est la plus récente du dossier qui porte
-- une ligne du service (ligne_id, details.lignes_ids). Utilisable aussi pour une commission en % de la vente.
create or replace function remise_reservation(p_res uuid) returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  r reservations;
  ids text[];
  c jsonb;
  st numeric;
  rem numeric;
begin
  select * into r from reservations where id = p_res;
  if not found or r.montant_vente is null or r.montant_vente <= 0 then return 0; end if;
  ids := array_remove(array[nullif(r.ligne_id, '')] || coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(r.details->'lignes_ids') = 'array' then r.details->'lignes_ids' else '[]'::jsonb end) x), '{}'), null);
  if cardinality(ids) = 0 then return 0; end if;
  select d.contenu into c from documents d
    where d.dossier_id = r.dossier_id and d.type = 'facture'
      and exists (select 1 from jsonb_array_elements(coalesce(d.contenu->'lignes', '[]'::jsonb)) e where e->>'id' = any (ids))
    order by d.date_emission desc nulls last, d.created_at desc limit 1;
  if c is null then return 0; end if;
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
  ), s as (select coalesce(sum(brut) filter (where kind not in ('remise', 'texte')), 0) as st from l)
  select s.st, coalesce((select sum(case when pct is not null then round(s.st * pct / 100, 2) else brut end) from l where kind = 'remise'), 0) into st, rem from s;
  if st <= 0 or rem <= 0 then return 0; end if;
  return least(r.montant_vente, round(r.montant_vente * rem / st, 2));
end
$$;
revoke all on function remise_reservation(uuid) from public, anon, authenticated;

-- 5. Ce qui revient à l'agence sur un service, et ce qui a déjà été facturé AU PRESTATAIRE ACTUEL. Interne.
-- Nouvelles colonnes : remise (part de la remise), dossier_annule, destinataire_id (le prestataire actuel, de la même entreprise).
drop function if exists fiduciaire_cible(uuid);
create function fiduciaire_cible(p_res uuid)
returns table (cas text, cible numeric, date_cible date, pret boolean, manque text[], ecart numeric, a_revoir boolean, deja numeric, remise numeric, dossier_annule boolean, destinataire_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  r reservations;
  n reservations_nets;
  p partenaires;
  reg boolean;
  dpaie date;
  marge numeric;
  vente numeric;
begin
  select * into r from reservations where id = p_res;
  if not found then return; end if;
  select * into n from reservations_nets where reservation_id = p_res;
  select * into p from partenaires where id = r.partenaire_id and entite_id = r.entite_id;
  destinataire_id := p.id;
  select coalesce(sum(f.montant), 0) into deja from fiduciaire_factures f
    where f.reservation_id = p_res and p.id is not null and (f.destinataire_id = p.id or (f.destinataire_id is null and f.destinataire->>'nom' = p.nom));
  select coalesce(d.annule, false) into dossier_annule from dossiers d where d.id = r.dossier_id;
  dossier_annule := coalesce(dossier_annule, false);
  remise := 0;
  cas := case when r.paye_sur_place then 'sur_place' else 'chez_nous' end;
  cible := 0;
  date_cible := null;
  pret := false;
  manque := '{}';
  ecart := null;
  if r.paye_sur_place then
    -- Ce que le prestataire a reversé fait foi, même si le service ou le dossier a été annulé ensuite.
    if coalesce(n.commission_recue, 0) <= 0 then
      manque := array['commission_non_recue'];
    elsif n.commission_recue_le is null then
      manque := array['date_reception'];
    else
      cible := round(n.commission_recue, 2);
      date_cible := n.commission_recue_le;
      pret := true;
      if n.commission_prevue is not null then ecart := round(n.commission_recue - n.commission_prevue, 2); end if;
    end if;
  elsif r.statut = 'annule' or dossier_annule then
    pret := deja > 0;
  else
    remise := remise_reservation(p_res);
    vente := case when r.montant_vente is null then null else round(r.montant_vente - remise, 2) end;
    if vente is null then manque := array_append(manque, 'prix_vente'); end if;
    select (coalesce(rs.total, 0) > 0 and rs.recu >= rs.total), (select max(pa.date) from paiements pa where pa.dossier_id = r.dossier_id)
      into reg, dpaie from dossiers_resume rs where rs.dossier_id = r.dossier_id;
    if not coalesce(reg, false) then manque := array_append(manque, 'client_non_solde'); end if;
    if n.net_paye is null or n.paye_le is null then manque := array_append(manque, 'prestataire_non_paye'); end if;
    if cardinality(manque) = 0 then
      marge := round(vente - n.net_paye, 2);
      if marge <= 0 then
        manque := array['marge_nulle'];
      else
        cible := marge;
        date_cible := greatest(dpaie, n.paye_le);
        pret := true;
      end if;
    end if;
  end if;
  a_revoir := not pret and deja > 0;
  return next;
end
$$;
revoke all on function fiduciaire_cible(uuid) from public, anon, authenticated;

-- 6. Libellé : « Commission on » (commission reçue) ou « Margin on » (marge), mots réglables. Mêmes mots que libelleFacture() côté outil.
create or replace function fiduciaire_libelle(p_res uuid) returns text language sql stable security definer set search_path = public as $$
  select (case when r.paye_sur_place then g->>'mot_commission' else g->>'mot_marge' end) || ' ' || r.libelle
    || case when r.date_service is not null then ', service of ' || fiduciaire_date_en(r.date_service) else '' end
    || case when fiduciaire_initiales(c.prenom) || fiduciaire_initiales(c.nom) <> '' then ', guest ' || fiduciaire_initiales(c.prenom) || fiduciaire_initiales(c.nom) else '' end
    || case when coalesce(d.ref, '') <> '' then ' (booking ' || d.ref || ')' else '' end
  from reservations r cross join lateral (select fiduciaire_reglages(r.entite_id) as g) gg
    left join dossiers d on d.id = r.dossier_id left join clients c on c.id = d.client_id
  where r.id = p_res
$$;
revoke all on function fiduciaire_libelle(uuid) from public, anon, authenticated;

-- 7. Numéro suivant d'une série (préfixe et année de la date du document). Interne, attribué dans la transaction de l'appelant.
drop function if exists fiduciaire_prochain_numero(text, date);
create function fiduciaire_prochain_numero(p_genre text, p_jour date, p_prefixe text, out o_annee integer, out o_seq integer, out o_numero text)
language plpgsql security definer set search_path = public as $$
begin
  o_annee := extract(year from p_jour)::int;
  insert into fiduciaire_compteurs (prefixe, annee, type, dernier) values (p_prefixe, o_annee, p_genre, 0) on conflict do nothing;
  update fiduciaire_compteurs set dernier = dernier + 1 where prefixe = p_prefixe and annee = o_annee returning dernier into o_seq;
  o_numero := p_prefixe || '-' || o_annee || '-' || lpad(o_seq::text, 3, '0');
end
$$;
revoke all on function fiduciaire_prochain_numero(text, date, text) from public, anon, authenticated;

-- 8. Copie de l'émetteur le jour de l'émission : l'entreprise du service, seulement ce qu'affiche une facture.
-- Le QR code vient de reglages.apparence (comme sur les factures des clients) ; la clé est toujours écrite, même vide, pour que la facture reste sans QR
-- si elle a été émise sans. Les titres sont figés aussi.
drop function if exists fiduciaire_emetteur();
create or replace function fiduciaire_emetteur(p_entite uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  reg jsonb;
  g jsonb;
begin
  select valeur into reg from reglages where entite_id = p_entite;
  if reg is null or coalesce(reg->'emetteur'->>'nom', '') = '' then raise exception 'L''identité de l''entreprise (Réglages, émetteur) est vide'; end if;
  g := fiduciaire_reglages(p_entite);
  return jsonb_build_object(
    'devise', coalesce(reg->>'devise', 'THB'),
    'entite_id', p_entite,
    'emetteur', jsonb_strip_nulls(jsonb_build_object('nom', reg->'emetteur'->'nom', 'sous_titre', reg->'emetteur'->'sous_titre', 'adresse', reg->'emetteur'->'adresse',
      'telephone', reg->'emetteur'->'telephone', 'licence', reg->'emetteur'->'licence', 'contact', reg->'emetteur'->'contact')),
    'paiement', jsonb_strip_nulls(jsonb_build_object('nom', reg->'paiement'->'nom'))
      || jsonb_build_object('texte', coalesce(reg->'paiement'->>'texte', ''))
      || jsonb_build_object('qr_image', coalesce(reg->'apparence'->>'qr_image', ''), 'qr_pseudo', coalesce(reg->'apparence'->>'qr_pseudo', '')),
    'titres', jsonb_build_object('facture', g->>'titre_facture', 'avoir', g->>'titre_avoir', 'ref_facture', g->>'ref_facture', 'ref_avoir', g->>'ref_avoir'));
end
$$;
revoke all on function fiduciaire_emetteur(uuid) from public, anon, authenticated;

-- 9. Ce qu'il y a à préparer. Nouvelle colonne destinataire_cle : le prestataire de la ligne (son identifiant, ou « nom:… » pour une ancienne facture).
-- Une entreprise inactive ne propose aucune nouvelle facture. Un ancien prestataire encore facturé apparaît « à revoir » (partenaire_change), pour les responsables.
drop function if exists fiduciaire_a_preparer();
create function fiduciaire_a_preparer()
returns table (reservation_id uuid, entite_id uuid, entite_slug text, libelle text, date_service date, destinataire_cle text, destinataire_nom text, destinataire_adresse text, devise text,
               type text, montant numeric, date_cible date, cas text, ecart numeric, a_revoir boolean, manque text[], deja_facture numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  c record;
  a record;
  actif boolean;
  dep date;
begin
  for r in
    select rs.id, rs.entite_id, e.slug, rs.date_service, rs.partenaire_id
    from reservations rs join entites e on e.id = rs.entite_id
    where fiduciaire_concernee(rs.entite_id) and a_permission(rs.entite_id, 'fiduciaire.preparer') and fiduciaire_voit(rs.entite_id, rs.dossier_id)
      and (exists (select 1 from reservations_nets n where n.reservation_id = rs.id and (coalesce(n.commission_recue, 0) > 0 or n.net_paye is not null))
           or exists (select 1 from fiduciaire_factures f where f.reservation_id = rs.id))
    order by rs.date_service nulls last, rs.created_at
  loop
    select * into c from fiduciaire_cible(r.id);
    actif := (fiduciaire_reglages(r.entite_id)->>'actif')::boolean;
    dep := fiduciaire_depuis(r.entite_id);
    reservation_id := r.id;
    entite_id := r.entite_id;
    entite_slug := r.slug;
    libelle := fiduciaire_libelle(r.id);
    date_service := r.date_service;
    select coalesce(g.valeur->>'devise', 'THB') into devise from reglages g where g.entite_id = r.entite_id;
    devise := coalesce(devise, 'THB');
    cas := c.cas;
    if not (c.deja = 0 and c.date_cible is not null and dep is not null and c.date_cible < dep) then
      -- Le destinataire doit appartenir à la même entreprise que le service.
      destinataire_cle := c.destinataire_id::text;
      destinataire_nom := null;
      destinataire_adresse := null;
      select p.nom, coalesce(p.contact->>'adresse', '') into destinataire_nom, destinataire_adresse from partenaires p where p.id = c.destinataire_id;
      date_cible := c.date_cible;
      a_revoir := c.a_revoir;
      manque := c.manque;
      deja_facture := c.deja;
      ecart := case when a_permission(r.entite_id, 'partenaires.nets') then c.ecart else null end;
      if c.pret and c.cible - c.deja > 0 and actif then type := 'facture'; montant := round(c.cible - c.deja, 2);
      elsif c.pret and c.cible - c.deja < 0 then type := 'avoir'; montant := round(c.deja - c.cible, 2);
      else type := null; montant := 0;
      end if;
      if type is not null or c.a_revoir then return next; end if;
    end if;
    -- Anciens prestataires de ce service encore facturés : à annuler par un avoir.
    if a_permission(r.entite_id, 'fiduciaire.gerer') then
      for a in
        select coalesce(f.destinataire_id::text, 'nom:' || coalesce(f.destinataire->>'nom', '')) as cle, sum(f.montant) as total,
               (array_agg(f.destinataire order by f.created_at desc))[1] as dest
        from fiduciaire_factures f
        where f.reservation_id = r.id
          and not (c.destinataire_id is not null and (f.destinataire_id = c.destinataire_id or (f.destinataire_id is null and f.destinataire->>'nom' = (select p.nom from partenaires p where p.id = c.destinataire_id))))
        group by 1
        having sum(f.montant) <> 0
      loop
        destinataire_cle := a.cle; destinataire_nom := a.dest->>'nom'; destinataire_adresse := a.dest->>'adresse';
        type := null; montant := 0; date_cible := null; ecart := null; a_revoir := true; manque := array['partenaire_change']; deja_facture := a.total;
        return next;
      end loop;
    end if;
  end loop;
  -- Services supprimés, encore facturés : un avoir par destinataire.
  for r in
    select f.reservation_id as id, f.entite_id, max(f.entite_slug) as slug, coalesce(f.destinataire_id::text, 'nom:' || coalesce(f.destinataire->>'nom', '')) as cle, sum(f.montant) as deja,
           (array_agg(f.libelle order by f.created_at desc))[1] as libelle, max(f.devise) as devise, (array_agg(f.destinataire order by f.created_at desc))[1] as dest,
           (array_agg(f.cas order by f.created_at desc))[1] as cas
    from fiduciaire_factures f
    where f.reservation_id is not null and not exists (select 1 from reservations x where x.id = f.reservation_id) and a_permission(f.entite_id, 'fiduciaire.gerer')
    group by f.reservation_id, f.entite_id, 4
    having sum(f.montant) <> 0
  loop
    reservation_id := r.id; entite_id := r.entite_id; entite_slug := r.slug; libelle := r.libelle; date_service := null; destinataire_cle := r.cle;
    destinataire_nom := r.dest->>'nom'; destinataire_adresse := r.dest->>'adresse'; devise := r.devise;
    type := null; montant := 0; date_cible := null; cas := r.cas; ecart := null; a_revoir := true; manque := array['service_supprime']; deja_facture := r.deja;
    return next;
  end loop;
end
$$;
revoke all on function fiduciaire_a_preparer() from public, anon;
grant execute on function fiduciaire_a_preparer() to authenticated;

-- 10. Émet la facture (ou l'avoir) d'un service pour son prestataire actuel. Le montant est recalculé ici ; le navigateur ne donne que le service.
create or replace function emettre_facture_fiduciaire(p_res uuid, p_date date default null, p_attendu text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r reservations;
  e entites;
  c record;
  g jsonb;
  emet jsonb;
  dest jsonb;
  adresse text;
  nom text;
  genre text;
  montant numeric;
  jour date;
  num record;
  precedente fiduciaire_factures;
  nouveau uuid;
begin
  -- Le service est verrouillé : deux clics en même temps ne font pas deux factures.
  perform pg_advisory_xact_lock(hashtextextended(p_res::text, 28));
  select * into r from reservations where id = p_res for update;
  if not found then raise exception 'Service introuvable : s''il est supprimé et déjà facturé, annulez la facture par un avoir'; end if;
  select * into e from entites where id = r.entite_id;
  if not fiduciaire_concernee(r.entite_id) then raise exception 'Les factures pour la fiduciaire ne concernent que les entreprises d''excursions'; end if;
  if not (a_permission(r.entite_id, 'fiduciaire.preparer') and fiduciaire_voit(r.entite_id, r.dossier_id)) then raise exception 'Droit insuffisant' using errcode = '42501'; end if;
  g := fiduciaire_reglages(r.entite_id);

  select * into c from fiduciaire_cible(p_res);
  if not c.pret then raise exception 'Rien à facturer pour ce service : %', coalesce(nullif(array_to_string(c.manque, ', '), ''), 'à revoir'); end if;
  if c.deja = 0 and fiduciaire_depuis(r.entite_id) is not null and c.date_cible < fiduciaire_depuis(r.entite_id) then raise exception 'Ce service est antérieur à la date de départ des factures pour la fiduciaire (%)', fiduciaire_depuis(r.entite_id); end if;
  if c.cible - c.deja > 0 then genre := 'facture'; montant := round(c.cible - c.deja, 2);
  elsif c.cible - c.deja < 0 then genre := 'avoir'; montant := -round(c.deja - c.cible, 2);
  else raise exception 'Ce service est déjà facturé pour ce montant';
  end if;
  if p_attendu is not null and p_attendu <> genre then raise exception 'La situation de ce service a changé depuis l''affichage : rechargez l''écran'; end if;
  if genre = 'facture' and not (g->>'actif')::boolean then raise exception '% n''émet pas de factures pour la fiduciaire (réglage de l''écran Fiduciaire)', e.nom; end if;
  if genre = 'avoir' and not a_permission(r.entite_id, 'fiduciaire.gerer') then raise exception 'Seuls les responsables émettent un avoir' using errcode = '42501'; end if;

  -- Destinataire : le prestataire actuel, de la même entreprise que le service, nom et adresse tels qu'en base. Sans adresse, pas de facture.
  select p.nom, coalesce(trim(p.contact->>'adresse'), '') into nom, adresse from partenaires p where p.id = c.destinataire_id;
  if nom is null then raise exception 'Ce service n''a pas de prestataire : le destinataire de la facture manque'; end if;
  if adresse = '' then raise exception 'L''adresse de % manque dans sa fiche partenaire', nom; end if;
  dest := jsonb_build_object('nom', nom, 'adresse', adresse);
  emet := fiduciaire_emetteur(r.entite_id);

  if genre = 'facture' then
    -- Une facture prend la date de réception, jamais une date à venir (faute de frappe : le numéro porterait la mauvaise année).
    if c.date_cible > current_date then raise exception 'La date de réception (%) est dans le futur : corrigez-la avant de facturer', c.date_cible; end if;
    jour := c.date_cible;
  else
    jour := coalesce(p_date, current_date);
    select * into precedente from fiduciaire_factures f where f.reservation_id = p_res and f.type = 'facture'
      and (f.destinataire_id = c.destinataire_id or (f.destinataire_id is null and f.destinataire->>'nom' = nom)) order by f.created_at desc limit 1;
    if jour > current_date or (precedente.id is not null and jour < precedente.date_facture) then raise exception 'La date de l''avoir doit se situer entre la date de la facture et aujourd''hui'; end if;
  end if;

  select * into num from fiduciaire_prochain_numero(genre, jour, case when genre = 'avoir' then g->>'prefixe_avoir' else g->>'prefixe_facture' end);
  insert into fiduciaire_factures (entite_id, entite_slug, reservation_id, type, annee, seq, numero, date_facture, montant, devise, libelle, cas, destinataire, destinataire_id, emetteur, avoir_de, avoir_de_numero)
  values (r.entite_id, e.slug, p_res, genre, num.o_annee, num.o_seq, num.o_numero, jour, montant, emet->>'devise', fiduciaire_libelle(p_res), c.cas, dest, c.destinataire_id,
          jsonb_build_object('entite_id', emet->'entite_id', 'emetteur', emet->'emetteur', 'paiement', emet->'paiement', 'titres', emet->'titres'), precedente.id, precedente.numero)
  returning id into nouveau;
  return nouveau;
end
$$;
revoke all on function emettre_facture_fiduciaire(uuid, date, text) from public, anon;
grant execute on function emettre_facture_fiduciaire(uuid, date, text) to authenticated;

-- 11. Annule par un avoir tout ce qui a été facturé pour un service à un destinataire (p_destinataire : son identifiant, ou « nom:… »).
-- Sans p_destinataire : le seul destinataire au total non nul ; s'il y en a plusieurs, il faut choisir. Réservé à « fiduciaire.gerer ».
drop function if exists annuler_facture_fiduciaire(uuid, date);
create function annuler_facture_fiduciaire(p_res uuid, p_date date default null, p_destinataire text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cle text;
  n integer;
  derniere fiduciaire_factures;
  total numeric;
  jour date;
  num record;
  nouveau uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_res::text, 28));
  cle := p_destinataire;
  if cle is null then
    select count(*), min(k) into n, cle from (
      select coalesce(f.destinataire_id::text, 'nom:' || coalesce(f.destinataire->>'nom', '')) as k from fiduciaire_factures f where f.reservation_id = p_res group by 1 having sum(f.montant) <> 0) x;
    if n > 1 then raise exception 'Ce service est facturé à plusieurs prestataires : choisissez celui dont la facture s''annule'; end if;
  end if;
  select * into derniere from fiduciaire_factures f where f.reservation_id = p_res and f.type = 'facture'
    and (cle is null or coalesce(f.destinataire_id::text, 'nom:' || coalesce(f.destinataire->>'nom', '')) = cle) order by f.created_at desc limit 1;
  if derniere.id is null then raise exception 'Aucune facture pour ce service'; end if;
  if not a_permission(derniere.entite_id, 'fiduciaire.gerer') then raise exception 'Seuls les responsables émettent un avoir' using errcode = '42501'; end if;
  cle := coalesce(derniere.destinataire_id::text, 'nom:' || coalesce(derniere.destinataire->>'nom', ''));
  select coalesce(sum(f.montant), 0) into total from fiduciaire_factures f where f.reservation_id = p_res and coalesce(f.destinataire_id::text, 'nom:' || coalesce(f.destinataire->>'nom', '')) = cle;
  if total <= 0 then raise exception 'Rien à annuler : le total facturé pour ce service est déjà à zéro'; end if;
  jour := coalesce(p_date, current_date);
  if jour > current_date or jour < derniere.date_facture then raise exception 'La date de l''avoir doit se situer entre la date de la facture et aujourd''hui'; end if;
  select * into num from fiduciaire_prochain_numero('avoir', jour, fiduciaire_reglages(derniere.entite_id)->>'prefixe_avoir');
  insert into fiduciaire_factures (entite_id, entite_slug, reservation_id, type, annee, seq, numero, date_facture, montant, devise, libelle, cas, destinataire, destinataire_id, emetteur, avoir_de, avoir_de_numero)
  values (derniere.entite_id, derniere.entite_slug, p_res, 'avoir', num.o_annee, num.o_seq, num.o_numero, jour, -total, derniere.devise, derniere.libelle, derniere.cas, derniere.destinataire, derniere.destinataire_id, derniere.emetteur, derniere.id, derniere.numero)
  returning id into nouveau;
  return nouveau;
end
$$;
revoke all on function annuler_facture_fiduciaire(uuid, date, text) from public, anon;
grant execute on function annuler_facture_fiduciaire(uuid, date, text) to authenticated;

-- 12. « Revoir le calcul » : en plus, la part de la remise et le dossier annulé.
create or replace function fiduciaire_calcul(p_res uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r reservations;
  n reservations_nets;
  c record;
begin
  select * into r from reservations where id = p_res;
  if not found then return null; end if;
  if not (a_permission(r.entite_id, 'fiduciaire.gerer') and a_permission(r.entite_id, 'partenaires.nets') and fiduciaire_voit(r.entite_id, r.dossier_id)) then raise exception 'Droit insuffisant' using errcode = '42501'; end if;
  select * into n from reservations_nets where reservation_id = p_res;
  select * into c from fiduciaire_cible(p_res);
  return jsonb_build_object('cas', c.cas, 'montant_vente', r.montant_vente, 'remise', coalesce(c.remise, 0), 'dossier_annule', c.dossier_annule, 'net_prevu', n.net_prevu, 'net_paye', n.net_paye, 'paye_le', n.paye_le,
    'commission_prevue', n.commission_prevue, 'commission_recue', n.commission_recue, 'commission_recue_le', n.commission_recue_le,
    'cible', c.cible, 'date', c.date_cible, 'deja_facture', c.deja, 'pret', c.pret, 'manque', c.manque, 'ecart', c.ecart, 'a_revoir', c.a_revoir);
end
$$;
revoke all on function fiduciaire_calcul(uuid) from public, anon;
grant execute on function fiduciaire_calcul(uuid) to authenticated;

commit;
