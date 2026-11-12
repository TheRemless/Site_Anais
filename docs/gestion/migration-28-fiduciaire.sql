-- Gestion : migration 28, factures pour la fiduciaire (Secret et VIP Taxi Lanta).
-- La fiduciaire ne reçoit que ce qui revient à l'agence : la commission reçue (service payé sur place) ou la marge (service payé chez nous),
-- jamais ce que le client a payé en tout. Une facture par service, adressée à l'entreprise prestataire, émise par Secret Travel & Tour.
--
-- À exécuter une seule fois, AVANT de publier la nouvelle version de l'outil. Ne modifie aucune donnée existante : ajoute deux tables et des fonctions.
-- Tant qu'elle n'est pas appliquée, l'outil ne montre pas l'écran « Fiduciaire » (il détecte l'absence de la table).
--
-- Principes :
--   * le montant est toujours calculé par la base (fonction fiduciaire_cible), jamais envoyé par le navigateur : l'assistante n'a pas le droit « nets » et
--     ne doit pas pouvoir deviner une marge ni une commission en demandant une facture d'un montant à elle ;
--   * le numéro est attribué dans la même transaction que la facture : séries COM (factures) et CN (avoirs), une par année, sans trou ;
--   * une facture émise est figée (déclencheur) : seule la date d'envoi à la fiduciaire se renseigne ; une erreur se corrige par un avoir, puis une nouvelle facture ;
--   * l'émetteur (nom, adresse, licence, compte bancaire) est copié des réglages de Secret le jour de l'émission : changer les réglages plus tard ne réécrit pas le passé ;
--   * deux droits : fiduciaire.preparer (voir, émettre, télécharger, marquer envoyée) et fiduciaire.gerer (avoir, revoir le calcul). Voir donnees-fiduciaire-roles.sql.

begin;

-- Les deux nouveaux droits entrent dans « tous les droits » (administrateurs généraux, rôle Administrateur des nouvelles entreprises).
create or replace function toutes_permissions() returns text[] language sql immutable as $$
  select array['clients.lire', 'clients.ecrire', 'clients.supprimer', 'dossiers.lire', 'dossiers.ecrire', 'dossiers.supprimer', 'documents.ecrire', 'documents.supprimer', 'finances.voir', 'paiements.ecrire', 'taches.ecrire', 'catalogue.ecrire', 'reglages.ecrire', 'exports.faire', 'analytics.voir', 'journal.voir', 'partenaires.lire', 'partenaires.ecrire', 'partenaires.nets', 'fiduciaire.preparer', 'fiduciaire.gerer']::text[]
$$;

create table fiduciaire_factures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Entreprise d'où vient le service (Secret ou Taxi) : c'est elle qui porte les droits. L'émetteur est toujours Secret.
  entite_id uuid not null references entites (id) on delete restrict,
  entite_slug text not null,
  reservation_id uuid,
  type text not null check (type in ('facture', 'avoir')),
  annee integer not null,
  seq integer not null,
  numero text not null unique,
  date_facture date not null,
  -- Positif pour une facture, négatif pour un avoir.
  montant numeric(12, 2) not null check (montant <> 0),
  devise text not null,
  libelle text not null,
  cas text not null check (cas in ('sur_place', 'chez_nous')),
  destinataire jsonb not null,
  emetteur jsonb not null,
  avoir_de uuid references fiduciaire_factures (id),
  avoir_de_numero text,
  envoyee_le date,
  envoyee_par uuid,
  cree_par uuid default auth.uid(),
  unique (type, annee, seq),
  check ((type = 'avoir') = (montant < 0))
);
create index on fiduciaire_factures (reservation_id);
create index on fiduciaire_factures (entite_id, date_facture);

create table fiduciaire_compteurs (
  annee integer not null,
  type text not null check (type in ('facture', 'avoir')),
  dernier integer not null default 0,
  primary key (annee, type)
);

-- Figées : ni suppression, ni modification, sauf la date d'envoi à la fiduciaire.
create or replace function fiduciaire_figer() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Une facture pour la fiduciaire ne se supprime pas : on émet un avoir.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['envoyee_le', 'envoyee_par']) is distinct from (to_jsonb(old) - array['envoyee_le', 'envoyee_par']) then
    raise exception 'Une facture pour la fiduciaire émise ne se modifie pas : on émet un avoir, puis une nouvelle facture.' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger figer before update or delete on fiduciaire_factures for each row execute function fiduciaire_figer();
create or replace function fiduciaire_interdire_vidage() returns trigger language plpgsql as $$
begin
  raise exception 'Les factures pour la fiduciaire ne se vident pas.' using errcode = '42501';
end
$$;
create trigger ne_pas_vider before truncate on fiduciaire_factures for each statement execute function fiduciaire_interdire_vidage();
create trigger journaliser after insert or update on fiduciaire_factures for each row execute function journaliser();

alter table fiduciaire_factures enable row level security;
alter table fiduciaire_compteurs enable row level security;
revoke all on fiduciaire_factures, fiduciaire_compteurs from anon, authenticated;
grant select on fiduciaire_factures to authenticated;
-- Lecture seule pour l'outil ; toute écriture passe par les fonctions ci-dessous.
-- Même périmètre que les dossiers : un rôle limité à « mes dossiers » ne voit que les services de ses dossiers (créés par lui ou dont il est responsable).
create or replace function fiduciaire_voit(p_entite uuid, p_dossier uuid) returns boolean language sql stable security definer set search_path = public as $$
  select voit_tout(p_entite) or exists (select 1 from dossiers d where d.id = p_dossier and (d.cree_par = auth.uid() or d.responsable_id = auth.uid()))
$$;
create policy "lire les factures fiduciaire" on fiduciaire_factures for select to authenticated
  using (a_permission(entite_id, 'fiduciaire.preparer') and fiduciaire_voit(entite_id, (select r.dossier_id from reservations r where r.id = fiduciaire_factures.reservation_id)));

-- Ce qui revient à l'agence sur un service, et ce qui a déjà été facturé. Interne (aucun droit vérifié ici) : jamais appelée par le navigateur.
-- Mêmes règles que cibleAgence() dans src/gestion/js/fiduciaire-calc.mjs ; verif-fiduciaire.mjs compare les deux.
create or replace function fiduciaire_cible(p_res uuid)
returns table (cas text, cible numeric, date_cible date, pret boolean, manque text[], ecart numeric, a_revoir boolean, deja numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  r reservations;
  n reservations_nets;
  reg boolean;
  dpaie date;
  marge numeric;
begin
  select * into r from reservations where id = p_res;
  if not found then return; end if;
  select * into n from reservations_nets where reservation_id = p_res;
  select coalesce(sum(f.montant), 0) into deja from fiduciaire_factures f where f.reservation_id = p_res;
  cas := case when r.paye_sur_place then 'sur_place' else 'chez_nous' end;
  cible := 0;
  date_cible := null;
  pret := false;
  manque := '{}';
  ecart := null;
  if r.paye_sur_place then
    -- Ce que le prestataire a reversé fait foi, même si le service a été annulé ensuite.
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
  elsif r.statut = 'annule' then
    pret := deja > 0;
  else
    if r.montant_vente is null then manque := array_append(manque, 'prix_vente'); end if;
    select (coalesce(rs.total, 0) > 0 and rs.recu >= rs.total), (select max(p.date) from paiements p where p.dossier_id = r.dossier_id)
      into reg, dpaie from dossiers_resume rs where rs.dossier_id = r.dossier_id;
    if not coalesce(reg, false) then manque := array_append(manque, 'client_non_solde'); end if;
    if n.net_paye is null or n.paye_le is null then manque := array_append(manque, 'prestataire_non_paye'); end if;
    if cardinality(manque) = 0 then
      marge := round(r.montant_vente - n.net_paye, 2);
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

create or replace function fiduciaire_initiales(p text) returns text language sql immutable as $$
  select coalesce(upper((regexp_match(trim(coalesce(p, '')), '[[:alpha:]]'))[1]) || '.', '')
$$;

create or replace function fiduciaire_date_en(d date) returns text language sql immutable as $$
  select extract(day from d)::int::text || ' ' || (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[extract(month from d)::int] || ' ' || extract(year from d)::int::text
$$;

-- Libellé de la ligne (mêmes mots que libelleFacture() côté outil) : le service, sa date, le client en initiales, la référence du dossier.
create or replace function fiduciaire_libelle(p_res uuid) returns text language sql stable security definer set search_path = public as $$
  select 'Commission on ' || r.libelle
    || case when r.date_service is not null then ', service of ' || fiduciaire_date_en(r.date_service) else '' end
    || case when fiduciaire_initiales(c.prenom) || fiduciaire_initiales(c.nom) <> '' then ', guest ' || fiduciaire_initiales(c.prenom) || fiduciaire_initiales(c.nom) else '' end
    || case when coalesce(d.ref, '') <> '' then ' (booking ' || d.ref || ')' else '' end
  from reservations r left join dossiers d on d.id = r.dossier_id left join clients c on c.id = d.client_id
  where r.id = p_res
$$;
revoke all on function fiduciaire_libelle(uuid), fiduciaire_initiales(text), fiduciaire_date_en(date) from public, anon, authenticated;

-- Date de départ des factures pour la fiduciaire : réglages de Secret, clé fiduciaire.depuis (« 2026-11-01 »). Sans valeur, aucune limite.
-- Elle évite de produire d'un coup les factures de tout l'historique : un service dont la date de réception est antérieure n'est pas proposé (sauf s'il a déjà été facturé).
create or replace function fiduciaire_depuis() returns date language sql stable security definer set search_path = public as $$
  select nullif(g.valeur->'fiduciaire'->>'depuis', '')::date from reglages g join entites e on e.id = g.entite_id where e.slug = 'secret'
$$;
revoke all on function fiduciaire_depuis() from public, anon, authenticated;

-- Numéro suivant d'une série (COM pour les factures, CN pour les avoirs), par année de la date du document. Interne. Attribué dans la transaction de l'appelant :
-- si l'émission échoue, le compteur revient en arrière et aucun numéro n'est perdu.
create or replace function fiduciaire_prochain_numero(p_genre text, p_jour date, out o_annee integer, out o_seq integer, out o_numero text)
language plpgsql security definer set search_path = public as $$
begin
  o_annee := extract(year from p_jour)::int;
  insert into fiduciaire_compteurs (annee, type, dernier) values (o_annee, p_genre, 0) on conflict do nothing;
  update fiduciaire_compteurs set dernier = dernier + 1 where annee = o_annee and type = p_genre returning dernier into o_seq;
  o_numero := (case when p_genre = 'avoir' then 'CN' else 'COM' end) || '-' || o_annee || '-' || lpad(o_seq::text, 3, '0');
end
$$;
revoke all on function fiduciaire_prochain_numero(text, date) from public, anon, authenticated;

-- Copie de l'émetteur (Secret) le jour de l'émission : seulement ce qu'affiche une facture, rien d'autre des réglages.
create or replace function fiduciaire_emetteur() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  reg jsonb;
begin
  select g.valeur into reg from reglages g join entites e on e.id = g.entite_id where e.slug = 'secret';
  if reg is null or coalesce(reg->'emetteur'->>'nom', '') = '' then raise exception 'Les réglages de Secret (émetteur) sont vides'; end if;
  return jsonb_build_object(
    'devise', coalesce(reg->>'devise', 'THB'),
    'emetteur', jsonb_strip_nulls(jsonb_build_object('nom', reg->'emetteur'->'nom', 'sous_titre', reg->'emetteur'->'sous_titre', 'adresse', reg->'emetteur'->'adresse',
      'telephone', reg->'emetteur'->'telephone', 'licence', reg->'emetteur'->'licence', 'contact', reg->'emetteur'->'contact')),
    'paiement', jsonb_strip_nulls(jsonb_build_object('texte', reg->'paiement'->'texte', 'qr_image', reg->'paiement'->'qr_image', 'qr_pseudo', reg->'paiement'->'qr_pseudo')));
end
$$;
revoke all on function fiduciaire_emetteur() from public, anon, authenticated;

-- Ce qu'il y a à préparer, pour les entreprises où la personne a le droit « fiduciaire.preparer », dans le périmètre de ses dossiers.
-- Aucun net : seulement ce qui revient à l'agence. L'écart avec la commission prévue ne se montre qu'avec le droit « nets ».
-- Les services supprimés mais déjà facturés (total facturé non nul) restent listés, pour les responsables : il faut les annuler par un avoir.
create or replace function fiduciaire_a_preparer()
returns table (reservation_id uuid, entite_id uuid, entite_slug text, libelle text, date_service date, destinataire_nom text, destinataire_adresse text, devise text,
               type text, montant numeric, date_cible date, cas text, ecart numeric, a_revoir boolean, manque text[], deja_facture numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  c record;
begin
  for r in
    select rs.id, rs.entite_id, e.slug, rs.date_service, rs.partenaire_id
    from reservations rs join entites e on e.id = rs.entite_id
    where e.slug in ('secret', 'taxi') and a_permission(rs.entite_id, 'fiduciaire.preparer') and fiduciaire_voit(rs.entite_id, rs.dossier_id)
      and (exists (select 1 from reservations_nets n where n.reservation_id = rs.id and (coalesce(n.commission_recue, 0) > 0 or n.net_paye is not null))
           or exists (select 1 from fiduciaire_factures f where f.reservation_id = rs.id))
    order by rs.date_service nulls last, rs.created_at
  loop
    select * into c from fiduciaire_cible(r.id);
    continue when c.deja = 0 and c.date_cible is not null and fiduciaire_depuis() is not null and c.date_cible < fiduciaire_depuis();
    reservation_id := r.id;
    entite_id := r.entite_id;
    entite_slug := r.slug;
    libelle := fiduciaire_libelle(r.id);
    date_service := r.date_service;
    -- Le destinataire doit appartenir à la même entreprise que le service.
    destinataire_nom := null;
    destinataire_adresse := null;
    select p.nom, coalesce(p.contact->>'adresse', '') into destinataire_nom, destinataire_adresse from partenaires p where p.id = r.partenaire_id and p.entite_id = r.entite_id;
    select coalesce(g.valeur->>'devise', 'THB') into devise from reglages g where g.entite_id = r.entite_id;
    devise := coalesce(devise, 'THB');
    cas := c.cas;
    date_cible := c.date_cible;
    a_revoir := c.a_revoir;
    manque := c.manque;
    deja_facture := c.deja;
    ecart := case when a_permission(r.entite_id, 'partenaires.nets') then c.ecart else null end;
    if c.pret and c.cible - c.deja > 0 then type := 'facture'; montant := round(c.cible - c.deja, 2);
    elsif c.pret and c.cible - c.deja < 0 then type := 'avoir'; montant := round(c.deja - c.cible, 2);
    else type := null; montant := 0;
    end if;
    if type is not null or c.a_revoir then return next; end if;
  end loop;
  -- Services supprimés, encore facturés.
  for r in
    select f.reservation_id as id, f.entite_id, max(f.entite_slug) as slug, sum(f.montant) as deja, (array_agg(f.libelle order by f.created_at desc))[1] as libelle, max(f.devise) as devise,
           (array_agg(f.destinataire order by f.created_at desc))[1] as dest
    from fiduciaire_factures f
    where f.reservation_id is not null and not exists (select 1 from reservations x where x.id = f.reservation_id) and a_permission(f.entite_id, 'fiduciaire.gerer')
    group by f.reservation_id, f.entite_id
    having sum(f.montant) <> 0
  loop
    reservation_id := r.id; entite_id := r.entite_id; entite_slug := r.slug; libelle := r.libelle; date_service := null;
    destinataire_nom := r.dest->>'nom'; destinataire_adresse := r.dest->>'adresse'; devise := r.devise;
    type := null; montant := 0; date_cible := null; cas := 'chez_nous'; ecart := null; a_revoir := true; manque := array['service_supprime']; deja_facture := r.deja;
    return next;
  end loop;
end
$$;
revoke all on function fiduciaire_a_preparer() from public, anon;
grant execute on function fiduciaire_a_preparer() to authenticated;

-- Émet la facture (ou l'avoir) d'un service. Le montant est recalculé ici ; le navigateur ne donne que le service.
-- p_attendu (« facture » ou « avoir », facultatif) est un garde-fou et jamais une source du montant : si la situation a changé depuis l'affichage, rien n'est émis.
-- p_date ne sert qu'à un avoir (date du jour par défaut).
create or replace function emettre_facture_fiduciaire(p_res uuid, p_date date default null, p_attendu text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r reservations;
  e entites;
  c record;
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
  if e.slug not in ('secret', 'taxi') then raise exception 'Les factures pour la fiduciaire ne concernent que Secret et VIP Taxi Lanta'; end if;
  if not (a_permission(r.entite_id, 'fiduciaire.preparer') and fiduciaire_voit(r.entite_id, r.dossier_id)) then raise exception 'Droit insuffisant' using errcode = '42501'; end if;

  select * into c from fiduciaire_cible(p_res);
  if not c.pret then raise exception 'Rien à facturer pour ce service : %', coalesce(nullif(array_to_string(c.manque, ', '), ''), 'à revoir'); end if;
  if c.deja = 0 and fiduciaire_depuis() is not null and c.date_cible < fiduciaire_depuis() then raise exception 'Ce service est antérieur à la date de départ des factures pour la fiduciaire (%)', fiduciaire_depuis(); end if;
  if c.cible - c.deja > 0 then genre := 'facture'; montant := round(c.cible - c.deja, 2);
  elsif c.cible - c.deja < 0 then genre := 'avoir'; montant := -round(c.deja - c.cible, 2);
  else raise exception 'Ce service est déjà facturé pour ce montant';
  end if;
  if p_attendu is not null and p_attendu <> genre then raise exception 'La situation de ce service a changé depuis l''affichage : rechargez l''écran'; end if;
  if genre = 'avoir' and not a_permission(r.entite_id, 'fiduciaire.gerer') then raise exception 'Seuls les responsables émettent un avoir' using errcode = '42501'; end if;

  -- Destinataire : l'entreprise prestataire de la même entreprise que le service, nom et adresse tels qu'en base. Sans adresse, pas de facture.
  select p.nom, coalesce(trim(p.contact->>'adresse'), '') into nom, adresse from partenaires p where p.id = r.partenaire_id and p.entite_id = r.entite_id;
  if nom is null then raise exception 'Ce service n''a pas de prestataire : le destinataire de la facture manque'; end if;
  if adresse = '' then raise exception 'L''adresse de % manque dans sa fiche partenaire', nom; end if;
  dest := jsonb_build_object('nom', nom, 'adresse', adresse);
  emet := fiduciaire_emetteur();

  if genre = 'facture' then
    -- Une facture prend la date de réception, jamais une date à venir (faute de frappe : le numéro porterait la mauvaise année).
    if c.date_cible > current_date then raise exception 'La date de réception (%) est dans le futur : corrigez-la avant de facturer', c.date_cible; end if;
    jour := c.date_cible;
  else
    jour := coalesce(p_date, current_date);
    select * into precedente from fiduciaire_factures where reservation_id = p_res and type = 'facture' order by created_at desc limit 1;
    if jour > current_date or (precedente.id is not null and jour < precedente.date_facture) then raise exception 'La date de l''avoir doit se situer entre la date de la facture et aujourd''hui'; end if;
  end if;

  select * into num from fiduciaire_prochain_numero(genre, jour);
  insert into fiduciaire_factures (entite_id, entite_slug, reservation_id, type, annee, seq, numero, date_facture, montant, devise, libelle, cas, destinataire, emetteur, avoir_de, avoir_de_numero)
  values (r.entite_id, e.slug, p_res, genre, num.o_annee, num.o_seq, num.o_numero, jour, montant, emet->>'devise', fiduciaire_libelle(p_res), c.cas, dest,
          jsonb_build_object('emetteur', emet->'emetteur', 'paiement', emet->'paiement'), precedente.id, precedente.numero)
  returning id into nouveau;
  return nouveau;
end
$$;
revoke all on function emettre_facture_fiduciaire(uuid, date, text) from public, anon;
grant execute on function emettre_facture_fiduciaire(uuid, date, text) to authenticated;

-- Annule par un avoir tout ce qui a été facturé pour un service : le seul recours quand le calcul ne permet plus de dire ce qui revient à l'agence
-- (commission reprise, client remboursé, service supprimé). Réservé à « fiduciaire.gerer ». L'avoir est du montant exact déjà facturé, jamais plus.
create or replace function annuler_facture_fiduciaire(p_res uuid, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  derniere fiduciaire_factures;
  total numeric;
  jour date;
  num record;
  nouveau uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_res::text, 28));
  select * into derniere from fiduciaire_factures where reservation_id = p_res and type = 'facture' order by created_at desc limit 1;
  if derniere.id is null then raise exception 'Aucune facture pour ce service'; end if;
  if not a_permission(derniere.entite_id, 'fiduciaire.gerer') then raise exception 'Seuls les responsables émettent un avoir' using errcode = '42501'; end if;
  select coalesce(sum(montant), 0) into total from fiduciaire_factures where reservation_id = p_res;
  if total <= 0 then raise exception 'Rien à annuler : le total facturé pour ce service est déjà à zéro'; end if;
  jour := coalesce(p_date, current_date);
  if jour > current_date or jour < derniere.date_facture then raise exception 'La date de l''avoir doit se situer entre la date de la facture et aujourd''hui'; end if;
  select * into num from fiduciaire_prochain_numero('avoir', jour);
  insert into fiduciaire_factures (entite_id, entite_slug, reservation_id, type, annee, seq, numero, date_facture, montant, devise, libelle, cas, destinataire, emetteur, avoir_de, avoir_de_numero)
  values (derniere.entite_id, derniere.entite_slug, p_res, 'avoir', num.o_annee, num.o_seq, num.o_numero, jour, -total, derniere.devise, derniere.libelle, derniere.cas, derniere.destinataire, derniere.emetteur, derniere.id, derniere.numero)
  returning id into nouveau;
  return nouveau;
end
$$;
revoke all on function annuler_facture_fiduciaire(uuid, date) from public, anon;
grant execute on function annuler_facture_fiduciaire(uuid, date) to authenticated;

-- « Marquer envoyée à la fiduciaire » avec la date (jamais une date à venir). Une date déjà posée ne se réécrit pas, et une date vide annule la mention : réservé aux responsables.
create or replace function marquer_envoyee_fiduciaire(p_ids uuid[], p_date date) returns integer
language plpgsql security definer set search_path = public as $$
declare
  f fiduciaire_factures;
  n integer := 0;
begin
  if p_date is not null and p_date > current_date then raise exception 'La date d''envoi ne peut pas être dans le futur'; end if;
  for f in select * from fiduciaire_factures where id = any (p_ids) for update loop
    if not a_permission(f.entite_id, 'fiduciaire.preparer') then raise exception 'Droit insuffisant' using errcode = '42501'; end if;
    if (p_date is null or f.envoyee_le is not null) and not a_permission(f.entite_id, 'fiduciaire.gerer') then
      raise exception 'Seuls les responsables retirent ou corrigent la mention d''envoi' using errcode = '42501';
    end if;
    update fiduciaire_factures set envoyee_le = p_date, envoyee_par = case when p_date is null then null else auth.uid() end where id = f.id;
    n := n + 1;
  end loop;
  return n;
end
$$;
revoke all on function marquer_envoyee_fiduciaire(uuid[], date) from public, anon;
grant execute on function marquer_envoyee_fiduciaire(uuid[], date) to authenticated;

-- « Revoir le calcul » : le détail d'un service, nets compris. Réservé à qui a les droits « gérer » et « nets », dans le périmètre de ses dossiers.
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
  return jsonb_build_object('cas', c.cas, 'montant_vente', r.montant_vente, 'net_prevu', n.net_prevu, 'net_paye', n.net_paye, 'paye_le', n.paye_le,
    'commission_prevue', n.commission_prevue, 'commission_recue', n.commission_recue, 'commission_recue_le', n.commission_recue_le,
    'cible', c.cible, 'date', c.date_cible, 'deja_facture', c.deja, 'pret', c.pret, 'manque', c.manque, 'ecart', c.ecart, 'a_revoir', c.a_revoir);
end
$$;
revoke all on function fiduciaire_calcul(uuid) from public, anon;
grant execute on function fiduciaire_calcul(uuid) to authenticated;

commit;
