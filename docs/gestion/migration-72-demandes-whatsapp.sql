-- Gestion : migration 72, demandes du site et conversations WhatsApp reliées (demande de Jérémy, 21.11.2026 : « Oui, relie-les »).
-- Suit la 70 (la 71 est réservée à une autre session ; celle-ci n'en dépend pas).
--
-- But :
--   1. Un dossier créé depuis WhatsApp ou l'Assistant confirme la demande du site « nouvelle » du même numéro (9 derniers chiffres), dans la
--      même entreprise : demande_site_relier(demande, dossier). L'outil propose la demande (une seule : d'office ; plusieurs : Nani coche),
--      la base vérifie tout et pose le lien d'un coup, sous verrou de la ligne.
--   2. Une demande acceptée relie la conversation WhatsApp du même numéro (même organisation) au client et au dossier créés :
--      whatsapp_relier_apres_demande(demande). Jamais une liaison déjà posée (client ou dossier remplis), jamais un contact personnel
--      (reponses = 'jamais') ni un partenaire, un chauffeur, un hôtel ou un apporteur. Une conversation « à trier » se range dans
--      l'entreprise de la demande (Secret ou Taxi seulement : ZTP n'a pas la boîte) ; remise à trier par Nani, elle reste à trier.
--   3. Plus de second dossier pour une demande : une personne ne change plus le statut ni le dossier d'une demande déjà traitée
--      (déclencheur une_fois). Le dossier peut seulement disparaître (dossier supprimé : « on delete set null »).
--   Pas de rapprochement par e-mail : demandes_site n'a pas d'e-mail (la feuille du site ne le demande pas).
--
-- Droits (ceux de l'écran, inchangés) : relier une demande demande de lire les demandes de l'entreprise (lit_demandes_site) et d'y écrire
-- les dossiers, comme « Confirmer » ; relier une conversation demande en plus d'administrer la boîte de l'entreprise (whatsapp_ecrit).
-- Chaque entreprise garde ses éléments : une demande ne se relie qu'à un dossier de SON entreprise, même quand la fiche client est
-- partagée entre Secret et Taxi (migrations 46 et 63) ; la conversation ne reçoit la fiche que si elle est de cette entreprise.
-- Rien ne part au client ni au prestataire.
--
-- À exécuter une seule fois, AVANT de publier la nouvelle version de l'outil (sans elle, l'outil ne relie rien et le dit discrètement).
-- Ne modifie aucune donnée existante. Se rejoue sans effet. Aucune fonction Supabase à redéployer.
-- Retour en arrière : docs/gestion/retour-72-demandes-whatsapp.sql (les demandes déjà reliées restent confirmées, avec leur dossier).
-- Contrôle : docs/gestion/verif-demandes-whatsapp.mjs, puis en lecture :
--   select statut, count(*), count(*) filter (where decision ? 'relie') reliees_depuis_un_dossier from demandes_site group by 1;
--   select d.ref, d.statut, w.id conversation, w.dossier_id = d.dossier_id meme_dossier from demandes_site d
--     join whatsapp_conversations w on cle_telephone(w.telephone) = cle_telephone(d.telephone) where d.statut = 'confirmee' order by d.created_at desc limit 20;

begin;

-- 0. Les migrations dont celle-ci dépend.
do $$
begin
  if to_regclass('public.demandes_site') is null or to_regclass('public.whatsapp_conversations') is null then
    raise exception 'Migrations 30 et 58 absentes : demandes_site ou whatsapp_conversations manque.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'demandes_site' and column_name = 'telephone') then
    raise exception 'Migration 41 absente : la colonne demandes_site.telephone manque.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_conversations' and column_name = 'type_contact') then
    raise exception 'Migration 68 absente : la colonne whatsapp_conversations.type_contact manque.';
  end if;
  if to_regprocedure('public.whatsapp_ecrit(uuid, uuid)') is null then
    raise exception 'Migration 63 absente : la fonction whatsapp_ecrit manque.';
  end if;
end $$;

-- 1. La clé d'un numéro : ses 9 derniers chiffres (« 081 234 5678 » et « +66 81 234 5678 »), comme whatsapp_trouver_client. Vide sous 9 chiffres.
create or replace function cle_telephone(t text) returns text language sql immutable set search_path = public, pg_temp as $$
  select case when length(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g')) >= 9 then right(regexp_replace(t, '[^0-9]', '', 'g'), 9) end
$$;
revoke all on function cle_telephone(text) from public, anon, authenticated;

-- 2. Une demande traitée ne se retraite pas : ni un autre statut, ni un autre dossier (le second dossier n'aurait plus de demande).
--    Sans personne connectée (clé de service, restauration d'une sauvegarde), rien ne change. Un dossier supprimé vide dossier_id : permis.
create or replace function demandes_site_une_fois() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and old.statut <> 'nouvelle'
     and (new.statut is distinct from old.statut or (new.dossier_id is not null and new.dossier_id is distinct from old.dossier_id)) then
    raise exception 'Cette demande a déjà été traitée.' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function demandes_site_une_fois() from public, anon, authenticated;
drop trigger if exists une_fois on demandes_site;
create trigger une_fois before update on demandes_site for each row execute function demandes_site_une_fois();

-- 3. Relier une demande « nouvelle » au dossier créé pour ce client (Assistant, WhatsApp, ou Nani qui coche parmi plusieurs).
--    Le numéro de la demande doit être celui de la fiche du dossier, ou d'une conversation WhatsApp déjà reliée à ce dossier.
--    Rend { relie, motif, demande } ; motif : relie, introuvable, droit, deja_traitee, autre_entreprise, annule, numero.
create or replace function demande_site_relier(p_demande uuid, p_dossier uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d demandes_site;
  x dossiers;
  cle text;
  note jsonb := jsonb_build_object('relie', jsonb_build_object('depuis', 'dossier', 'le', now()));
  ligne demandes_site;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  select * into d from demandes_site where id = p_demande for update;
  -- Une demande qu'on ne lit pas n'existe pas pour la personne.
  if d.id is null or not lit_demandes_site(d.entite_id) then
    return jsonb_build_object('relie', false, 'motif', 'introuvable');
  end if;
  if not a_permission(d.entite_id, 'dossiers.ecrire') then
    return jsonb_build_object('relie', false, 'motif', 'droit');
  end if;
  if d.statut <> 'nouvelle' then
    return jsonb_build_object('relie', false, 'motif', 'deja_traitee', 'dossier_id', d.dossier_id);
  end if;
  select * into x from dossiers where id = p_dossier;
  if x.id is null then
    return jsonb_build_object('relie', false, 'motif', 'introuvable');
  end if;
  -- Chaque entreprise ses éléments : jamais un dossier d'une autre entreprise, même au client d'une fiche partagée.
  if x.entite_id <> d.entite_id then
    return jsonb_build_object('relie', false, 'motif', 'autre_entreprise');
  end if;
  if x.annule then
    return jsonb_build_object('relie', false, 'motif', 'annule');
  end if;
  cle := cle_telephone(d.telephone);
  if cle is null or not (
    exists (select 1 from clients c where c.id = x.client_id and cle_telephone(c.telephone) = cle)
    or exists (select 1 from whatsapp_conversations w where w.dossier_id = x.id and w.organisation_id = organisation_de(x.entite_id) and cle_telephone(w.telephone) = cle)
  ) then
    return jsonb_build_object('relie', false, 'motif', 'numero');
  end if;
  -- La décision garde ce qu'elle avait (rien, pour une demande nouvelle) et note d'où vient le lien. Le déclencheur « figer » note qui et quand.
  update demandes_site
  set statut = 'confirmee', dossier_id = x.id,
    decision = case when length((d.decision || note)::text) <= 4000 then d.decision || note else note end
  where id = d.id
  returning * into ligne;
  return jsonb_build_object('relie', true, 'motif', 'relie', 'demande', to_jsonb(ligne));
end
$$;
revoke all on function demande_site_relier(uuid, uuid) from public, anon;
grant execute on function demande_site_relier(uuid, uuid) to authenticated;

-- 4. Après une demande acceptée : la conversation WhatsApp du même numéro, dans l'organisation de la demande.
--    Rend { relie, motif, conversation } ; motif : relie, deja_fait, introuvable, droit, non_confirmee, sans_boite, numero, droit_whatsapp,
--    aucune, plusieurs, personnel, autre_contact, autre_entreprise, a_trier_par_nani, deja_relie. Le même ordre que liaisonApresDemande
--    (src/gestion/js/demandes-whatsapp-calc.mjs), pour la démonstration.
create or replace function whatsapp_relier_apres_demande(p_demande uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d demandes_site;
  x dossiers;
  w whatsapp_conversations;
  cle text;
  org uuid;
  n integer;
  ent_client uuid;
  ligne whatsapp_conversations;
  rien constant jsonb := jsonb_build_object('relie', false);
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  select * into d from demandes_site where id = p_demande;
  if d.id is null or not lit_demandes_site(d.entite_id) then return rien || jsonb_build_object('motif', 'introuvable'); end if;
  -- Le droit de l'écran « Confirmer ».
  if not a_permission(d.entite_id, 'dossiers.ecrire') then return rien || jsonb_build_object('motif', 'droit'); end if;
  if d.statut <> 'confirmee' or d.dossier_id is null then return rien || jsonb_build_object('motif', 'non_confirmee'); end if;
  select * into x from dossiers where id = d.dossier_id;
  if x.id is null or x.entite_id <> d.entite_id then return rien || jsonb_build_object('motif', 'non_confirmee'); end if;
  -- La boîte est celle de Secret et de Taxi : ZTP n'en a pas.
  if not exists (select 1 from entites where id = d.entite_id and slug in ('secret', 'taxi')) then return rien || jsonb_build_object('motif', 'sans_boite'); end if;
  cle := cle_telephone(d.telephone);
  if cle is null then return rien || jsonb_build_object('motif', 'numero'); end if;
  org := organisation_de(d.entite_id);
  -- Avant de chercher : qui n'administre pas la boîte de cette entreprise n'apprend pas si une conversation existe.
  if not whatsapp_ecrit(d.entite_id, org) then return rien || jsonb_build_object('motif', 'droit_whatsapp'); end if;
  select count(*) into n from whatsapp_conversations where organisation_id = org and cle_telephone(telephone) = cle;
  if n = 0 then return rien || jsonb_build_object('motif', 'aucune'); end if;
  if n > 1 then return rien || jsonb_build_object('motif', 'plusieurs'); end if;
  select * into w from whatsapp_conversations where organisation_id = org and cle_telephone(telephone) = cle for update;
  if w.reponses = 'jamais' then return rien || jsonb_build_object('motif', 'personnel'); end if;
  if w.type_contact is not null and w.type_contact <> 'client' then return rien || jsonb_build_object('motif', 'autre_contact'); end if;
  if w.entite_id is not null and w.entite_id <> d.entite_id then return rien || jsonb_build_object('motif', 'autre_entreprise'); end if;
  if w.entite_id is null and w.entite_source = 'manuel' then return rien || jsonb_build_object('motif', 'a_trier_par_nani'); end if;
  -- Une liaison déjà posée ne s'écrase jamais.
  if w.dossier_id is not null then
    return jsonb_build_object('relie', w.dossier_id = x.id, 'motif', case when w.dossier_id = x.id then 'deja_fait' else 'deja_relie' end);
  end if;
  if w.client_id is not null and w.client_id is distinct from x.client_id then return rien || jsonb_build_object('motif', 'deja_relie'); end if;
  -- La fiche seulement si elle est de l'entreprise de la conversation (whatsapp_reclasser retirerait une fiche partagée d'une autre entreprise).
  select entite_id into ent_client from clients where id = x.client_id;
  update whatsapp_conversations
  set entite_id = coalesce(w.entite_id, d.entite_id),
    client_id = case when w.client_id is null and ent_client = d.entite_id then x.client_id else w.client_id end,
    dossier_id = x.id
  where id = w.id
  returning * into ligne;
  return jsonb_build_object('relie', true, 'motif', 'relie', 'conversation', jsonb_build_object(
    'id', ligne.id, 'entite_id', ligne.entite_id, 'entite_source', ligne.entite_source, 'client_id', ligne.client_id, 'dossier_id', ligne.dossier_id, 'updated_at', ligne.updated_at));
end
$$;
revoke all on function whatsapp_relier_apres_demande(uuid) from public, anon;
grant execute on function whatsapp_relier_apres_demande(uuid) to authenticated;

commit;
