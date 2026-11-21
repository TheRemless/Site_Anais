-- Gestion : migration 72, demandes du site et conversations WhatsApp reliées (demande de Jérémy, 21.11.2026 : « Oui, relie-les »).
-- Suit la 70 (la 71 est réservée à une autre session ; celle-ci n'en dépend pas). Corrigée après la revue de sécurité de la PR 302.
--
-- But :
--   1. Un dossier créé depuis WhatsApp ou l'Assistant confirme la demande du site « nouvelle » du même client, dans la même entreprise :
--      demande_site_relier(demande, dossier). L'outil propose (d'office seulement pour une seule demande dont un service du dossier a la
--      même date ou le même produit ; sinon Nani coche), la base vérifie tout et pose le lien d'un coup, sous verrou de la ligne.
--      Le numéro du client : celui de sa fiche, ou d'une conversation WhatsApp de CLIENT reliée au dossier (jamais un hôtel, un partenaire,
--      un chauffeur, un apporteur, une conversation reliée à une fiche partenaire ni un contact personnel). Deux numéros avec indicatif (+ ou 00) se comparent en entier ; les 9 derniers
--      chiffres seulement quand l'un des deux n'a pas d'indicatif (« 081 234 5678 ») : meme_telephone.
--   2. Un lien posé par erreur se défait dans les 24 heures : demande_site_delier(demande). La demande redevient « nouvelle », sans dossier.
--   3. Une demande acceptée relie la conversation WhatsApp du même numéro (même organisation) au client et au dossier créés :
--      whatsapp_relier_apres_demande(demande). Jamais une liaison déjà posée (client ou dossier remplis), jamais un contact personnel
--      (reponses = 'jamais') ni un partenaire, un chauffeur, un hôtel ou un apporteur. Une conversation « à trier » se range dans
--      l'entreprise de la demande (Secret ou Taxi seulement : ZTP n'a pas la boîte), avec la source « client » (whatsapp_reclasser lit le
--      réglage de transaction gestion.rangement_client) ; remise à trier par Nani, elle reste à trier. La fiche n'est posée que si elle est
--      de l'entreprise de la conversation : si whatsapp_reclasser en trouve une autre par le numéro (fiche partagée), elle est retirée.
--   4. Une demande traitée ne se retraite pas (déclencheur une_fois) : ni un autre statut, ni un autre dossier, ni les clés « relie » et
--      « final » de la décision. Le dossier ne se vide que s'il n'existe plus (dossier supprimé : « on delete set null »). Seule
--      demande_site_delier remet une demande à « nouvelle » ; seule demande_site_relier pose la clé « relie ».
--   Pas de rapprochement par e-mail : demandes_site n'a pas d'e-mail (la feuille du site ne le demande pas).
--
-- Limite connue : la création du dossier (outil) et la confirmation de la demande (base) ne se font pas dans une même transaction. Deux
-- appareils qui créent le dossier du même client à quelques millisecondes d'écart peuvent encore donner deux dossiers : la demande relue
-- juste avant de créer, l'avertissement « Créer quand même ? » et le refus de la base (« doublon possible ») réduisent la fenêtre sans la
-- fermer. Aucune réservation en base : elle demanderait de créer le dossier dans la base, ce que l'outil ne fait pas.
--
-- Droits (ceux de l'écran, inchangés) : relier ou délier une demande demande de lire les demandes de l'entreprise (lit_demandes_site) et
-- d'y écrire les dossiers, comme « Confirmer » ; relier une conversation demande en plus d'administrer la boîte de l'entreprise
-- (whatsapp_ecrit). Un dossier que la personne ne lit pas est « introuvable ». Chaque entreprise garde ses éléments : une demande ne se
-- relie qu'à un dossier de SON entreprise, même quand la fiche client est partagée entre Secret et Taxi (migrations 46 et 63).
-- Rien ne part au client ni au prestataire.
--
-- À exécuter une seule fois, AVANT de publier la nouvelle version de l'outil (sans elle, l'outil ne relie rien et le dit discrètement).
-- Ne modifie aucune donnée existante. Se rejoue sans effet. Aucune fonction Supabase à redéployer.
-- Retour en arrière : docs/gestion/retour-72-demandes-whatsapp.sql (les demandes déjà reliées restent confirmées, avec leur dossier ;
-- whatsapp_reclasser revient à la version de la migration 59).
-- Contrôle : docs/gestion/verif-demandes-whatsapp.mjs, puis en lecture :
--   select statut, count(*), count(*) filter (where decision ? 'relie') reliees_depuis_un_dossier from demandes_site group by 1;
--   select d.ref, d.statut, w.id conversation, w.entite_source, w.dossier_id = d.dossier_id meme_dossier from demandes_site d
--     join whatsapp_conversations w on meme_telephone(w.telephone, d.telephone) where d.statut = 'confirmee' order by d.created_at desc limit 20;

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

-- 1. Même numéro ? Avec indicatif des deux côtés (+ ou 00), tous les chiffres : +33 6 12 34 56 78 n'est pas +66 6 1234 5678.
--    Sans indicatif d'un côté (« 081 234 5678 » noté à la thaïe), les 9 derniers chiffres, comme whatsapp_trouver_client. Moins de 9 : non.
--    Une première version de cette migration avait cle_telephone (9 chiffres seulement) : retirée.
drop function if exists cle_telephone(text);
create or replace function meme_telephone(a text, b text) returns boolean language sql immutable set search_path = public, pg_temp as $$
  with x as (
    select regexp_replace(coalesce(a, ''), '[^0-9]', '', 'g') as na, regexp_replace(coalesce(b, ''), '[^0-9]', '', 'g') as nb,
      btrim(coalesce(a, '')) like '+%' or regexp_replace(coalesce(a, ''), '[[:space:]().-]', '', 'g') like '00%' as ia,
      btrim(coalesce(b, '')) like '+%' or regexp_replace(coalesce(b, ''), '[[:space:]().-]', '', 'g') like '00%' as ib,
      btrim(coalesce(a, '')) like '+%' as pa, btrim(coalesce(b, '')) like '+%' as pb
  )
  select case
    when length(na) < 9 or length(nb) < 9 then false
    when ia and ib then (case when pa then na else substr(na, 3) end) = (case when pb then nb else substr(nb, 3) end)
    else right(na, 9) = right(nb, 9)
  end
  from x
$$;
revoke all on function meme_telephone(text, text) from public, anon, authenticated;

-- 2. Une demande traitée ne se retraite pas. Sans personne connectée (clé de service, restauration d'une sauvegarde), rien ne change.
--    gestion.relier_demande et gestion.delier_demande : posés le temps d'une écriture par demande_site_relier et demande_site_delier
--    (réglages de transaction ; l'outil n'a aucun moyen de les poser, il ne passe que par les fonctions exposées).
create or replace function demandes_site_une_fois() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  par_relier boolean := coalesce(current_setting('gestion.relier_demande', true), '') = old.id::text;
  par_delier boolean := coalesce(current_setting('gestion.delier_demande', true), '') = old.id::text;
begin
  if auth.uid() is null or par_delier then
    return new;
  end if;
  -- La clé « relie » (lien posé depuis un dossier, défaisable 24 heures) ne s'écrit que par demande_site_relier.
  if (new.decision -> 'relie') is distinct from (old.decision -> 'relie') and not par_relier then
    raise exception 'Cette demande a déjà été traitée.' using errcode = '42501';
  end if;
  if old.statut <> 'nouvelle' and (
       new.statut is distinct from old.statut
       -- Le dossier ne se vide que s'il n'existe plus (« on delete set null ») ; il ne change jamais pour un autre.
       or (new.dossier_id is distinct from old.dossier_id and not (new.dossier_id is null and not exists (select 1 from dossiers where id = old.dossier_id)))
       or (new.decision -> 'final') is distinct from (old.decision -> 'final')
     ) then
    raise exception 'Cette demande a déjà été traitée.' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function demandes_site_une_fois() from public, anon, authenticated;
drop trigger if exists une_fois on demandes_site;
create trigger une_fois before update on demandes_site for each row execute function demandes_site_une_fois();

-- 3. whatsapp_reclasser (migration 59) : une conversation rangée par une personne prend la source « manuel », sauf celle que
--    whatsapp_relier_apres_demande range pour le client d'une demande acceptée (réglage gestion.rangement_client = son id) : « client ».
create or replace function whatsapp_reclasser() returns trigger language plpgsql security definer set search_path = public as $$
declare
  trouve record;
begin
  if auth.uid() is not null then
    if new.non_lus > old.non_lus then new.non_lus := old.non_lus; end if;
    if new.entite_id is distinct from old.entite_id then
      new.entite_source := case when coalesce(current_setting('gestion.rangement_client', true), '') = new.id::text then 'client' else 'manuel' end;
    elsif new.entite_source is distinct from old.entite_source and new.entite_source <> 'manuel' then
      new.entite_source := old.entite_source;
    end if;
  end if;
  if new.client_id is not null and (new.entite_id is null or not exists (select 1 from clients where id = new.client_id and entite_id = new.entite_id)) then
    new.client_id := null;
  end if;
  if new.dossier_id is not null and (new.entite_id is null or not exists (select 1 from dossiers where id = new.dossier_id and entite_id = new.entite_id and (new.client_id is null or client_id = new.client_id))) then
    new.dossier_id := null;
  end if;
  -- Changement d'entreprise : la réponse préparée avec les données de l'autre entreprise n'est plus proposée.
  if new.entite_id is distinct from old.entite_id then
    update whatsapp_propositions set statut = 'remplacee'
    where conversation_id = new.id and statut in ('a_faire', 'en_cours') and entite_id is distinct from new.entite_id;
  end if;
  if new.entite_id is distinct from old.entite_id and new.entite_id is not null and new.client_id is null then
    select t.client_id, t.dossier_id into trouve from whatsapp_trouver_client(new.organisation_id, new.telephone) t where t.entite_id = new.entite_id;
    new.client_id := trouve.client_id;
    new.dossier_id := coalesce(new.dossier_id, trouve.dossier_id);
  end if;
  return new;
end
$$;
revoke all on function whatsapp_reclasser() from public, anon;

-- 4. Relier une demande « nouvelle » au dossier créé pour ce client (Assistant, WhatsApp, ou Nani qui coche).
--    Rend { relie, motif, demande } ; motif : relie, introuvable, droit, deja_traitee (avec dossier_id), autre_entreprise, annule, numero.
create or replace function demande_site_relier(p_demande uuid, p_dossier uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d demandes_site;
  x dossiers;
  note jsonb := jsonb_build_object('relie', jsonb_build_object('depuis', 'dossier', 'le', now(), 'dossier_id', p_dossier));
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
  -- Un dossier qu'on ne lit pas n'existe pas non plus (pas d'oracle sur les dossiers des autres entreprises).
  if x.id is null or not a_permission(x.entite_id, 'dossiers.lire') then
    return jsonb_build_object('relie', false, 'motif', 'introuvable');
  end if;
  -- Chaque entreprise ses éléments : jamais un dossier d'une autre entreprise, même au client d'une fiche partagée.
  if x.entite_id <> d.entite_id then
    return jsonb_build_object('relie', false, 'motif', 'autre_entreprise');
  end if;
  if x.annule then
    return jsonb_build_object('relie', false, 'motif', 'annule');
  end if;
  -- Le numéro de la fiche, ou d'une conversation de CLIENT reliée à ce dossier (un hôtel ou un partenaire n'est pas le client).
  if not (
    exists (select 1 from clients c where c.id = x.client_id and meme_telephone(c.telephone, d.telephone))
    or exists (select 1 from whatsapp_conversations w where w.dossier_id = x.id and w.organisation_id = organisation_de(x.entite_id)
               and coalesce(w.type_contact, 'client') = 'client' and w.partenaire_id is null and w.reponses <> 'jamais'
               and meme_telephone(w.telephone, d.telephone))
  ) then
    return jsonb_build_object('relie', false, 'motif', 'numero');
  end if;
  -- La décision garde ce qu'elle avait et note d'où vient le lien (défaisable 24 heures). Le déclencheur « figer » note qui et quand.
  perform set_config('gestion.relier_demande', d.id::text, true);
  update demandes_site
  set statut = 'confirmee', dossier_id = x.id,
    decision = case when length((d.decision || note)::text) <= 4000 then d.decision || note else note end
  where id = d.id
  returning * into ligne;
  perform set_config('gestion.relier_demande', '', true);
  return jsonb_build_object('relie', true, 'motif', 'relie', 'demande', to_jsonb(ligne));
end
$$;
revoke all on function demande_site_relier(uuid, uuid) from public, anon;
grant execute on function demande_site_relier(uuid, uuid) to authenticated;

-- 5. Défaire un lien posé par demande_site_relier, dans les 24 heures : la demande redevient « nouvelle », sans dossier ni traitement.
--    Le dossier reste. La décision garde la trace (« delie »). Rend { delie, motif, demande } ; motif : delie, introuvable, droit,
--    pas_relie (confirmée à l'écran, refusée, classée ou déjà nouvelle), trop_tard.
create or replace function demande_site_delier(p_demande uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d demandes_site;
  ligne demandes_site;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  select * into d from demandes_site where id = p_demande for update;
  if d.id is null or not lit_demandes_site(d.entite_id) then
    return jsonb_build_object('delie', false, 'motif', 'introuvable');
  end if;
  if not a_permission(d.entite_id, 'dossiers.ecrire') then
    return jsonb_build_object('delie', false, 'motif', 'droit');
  end if;
  if d.statut <> 'confirmee' or jsonb_typeof(d.decision -> 'relie') is distinct from 'object' then
    return jsonb_build_object('delie', false, 'motif', 'pas_relie');
  end if;
  if (d.decision -> 'relie' ->> 'le')::timestamptz < now() - interval '24 hours' then
    return jsonb_build_object('delie', false, 'motif', 'trop_tard');
  end if;
  perform set_config('gestion.delier_demande', d.id::text, true);
  update demandes_site
  set statut = 'nouvelle', dossier_id = null,
    decision = (d.decision - 'relie') || jsonb_build_object('delie', jsonb_build_object('le', now(), 'dossier_id', d.dossier_id))
  where id = d.id;
  -- « figer » note qui et quand à chaque changement de statut : une demande de nouveau à traiter n'a pas de traitement.
  update demandes_site set traitee_le = null, traitee_par = null where id = d.id returning * into ligne;
  perform set_config('gestion.delier_demande', '', true);
  return jsonb_build_object('delie', true, 'motif', 'delie', 'demande', to_jsonb(ligne));
end
$$;
revoke all on function demande_site_delier(uuid) from public, anon;
grant execute on function demande_site_delier(uuid) to authenticated;

-- 6. Après une demande acceptée : la conversation WhatsApp du même numéro, dans l'organisation de la demande.
--    Rend { relie, motif, conversation } ; motif : relie, deja_fait, introuvable, droit, non_confirmee, sans_boite, numero, droit_whatsapp,
--    aucune, plusieurs, personnel, autre_contact, autre_entreprise, a_trier_par_nani, deja_relie. Le même ordre que liaisonApresDemande
--    (src/gestion/js/demandes-whatsapp-calc.mjs), pour la démonstration.
create or replace function whatsapp_relier_apres_demande(p_demande uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d demandes_site;
  x dossiers;
  w whatsapp_conversations;
  org uuid;
  n integer;
  ent_client uuid;
  voulu uuid;
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
  if length(regexp_replace(coalesce(d.telephone, ''), '[^0-9]', '', 'g')) < 9 then return rien || jsonb_build_object('motif', 'numero'); end if;
  org := organisation_de(d.entite_id);
  -- Avant de chercher : qui n'administre pas la boîte de cette entreprise n'apprend pas si une conversation existe.
  if not whatsapp_ecrit(d.entite_id, org) then return rien || jsonb_build_object('motif', 'droit_whatsapp'); end if;
  select count(*) into n from whatsapp_conversations where organisation_id = org and meme_telephone(telephone, d.telephone);
  if n = 0 then return rien || jsonb_build_object('motif', 'aucune'); end if;
  if n > 1 then return rien || jsonb_build_object('motif', 'plusieurs'); end if;
  select * into w from whatsapp_conversations where organisation_id = org and meme_telephone(telephone, d.telephone) for update;
  if w.reponses = 'jamais' then return rien || jsonb_build_object('motif', 'personnel'); end if;
  -- Une fiche partenaire reliée (hôtel, apporteur…) dit aussi que ce n'est pas le client, même sans type.
  if (w.type_contact is not null and w.type_contact <> 'client') or w.partenaire_id is not null then return rien || jsonb_build_object('motif', 'autre_contact'); end if;
  if w.entite_id is not null and w.entite_id <> d.entite_id then return rien || jsonb_build_object('motif', 'autre_entreprise'); end if;
  if w.entite_id is null and w.entite_source = 'manuel' then return rien || jsonb_build_object('motif', 'a_trier_par_nani'); end if;
  -- Une liaison déjà posée ne s'écrase jamais.
  if w.dossier_id is not null then
    return jsonb_build_object('relie', w.dossier_id = x.id, 'motif', case when w.dossier_id = x.id then 'deja_fait' else 'deja_relie' end);
  end if;
  if w.client_id is not null and w.client_id is distinct from x.client_id then return rien || jsonb_build_object('motif', 'deja_relie'); end if;
  -- La fiche seulement si elle est de l'entreprise de la conversation (une fiche partagée d'une autre entreprise reste à sa place).
  select entite_id into ent_client from clients where id = x.client_id;
  voulu := case when w.client_id is null and ent_client = d.entite_id then x.client_id else w.client_id end;
  perform set_config('gestion.rangement_client', w.id::text, true);
  update whatsapp_conversations
  set entite_id = coalesce(w.entite_id, d.entite_id), client_id = voulu, dossier_id = x.id
  where id = w.id
  returning * into ligne;
  -- whatsapp_reclasser cherche une fiche par le numéro quand la conversation change d'entreprise sans client : une autre fiche que celle
  -- voulue (fiche partagée d'une autre entreprise, doublon au même numéro) est retirée. L'entreprise ne change plus.
  if ligne.client_id is distinct from voulu then
    update whatsapp_conversations set client_id = voulu where id = w.id returning * into ligne;
  end if;
  perform set_config('gestion.rangement_client', '', true);
  return jsonb_build_object('relie', true, 'motif', 'relie', 'conversation', jsonb_build_object(
    'id', ligne.id, 'entite_id', ligne.entite_id, 'entite_source', ligne.entite_source, 'client_id', ligne.client_id, 'dossier_id', ligne.dossier_id, 'updated_at', ligne.updated_at));
end
$$;
revoke all on function whatsapp_relier_apres_demande(uuid) from public, anon;
grant execute on function whatsapp_relier_apres_demande(uuid) to authenticated;

commit;
