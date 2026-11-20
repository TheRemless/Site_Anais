-- Gestion : migration 63, espace unifié Secret et VIP Taxi Lanta pour Nani (demande de Jérémy, 20.11.2026 : « on va partager la base client
-- entre taxi et secret »). Suit la 62.
--
--   1. Fiches clients partagées entre Secret et Taxi, dans les deux sens. Le réglage de la migration 46 (partages_clients) reçoit les deux
--      lignes secret -> taxi et taxi -> secret. Un partage réciproque ENTRE SECRET ET TAXI (et seulement eux) permet à une personne qui lit
--      tous les clients d'une des deux entreprises et écrit des dossiers dans l'autre de relier un dossier à la fiche (Mook comprise, dans ses
--      droits). Le partage à sens unique de ZTP reste réservé à l'administration, comme avant, même si quelqu'un coche un partage réciproque
--      avec ZTP. La lecture d'une fiche ne change pas : il faut toujours « clients.lire » dans l'entreprise de la fiche. Dossiers, factures,
--      vouchers, nets et commissions restent séparés par entreprise.
--   2. Fusion de deux fiches d'entreprises différentes : toujours réservée à l'administration (règle de la migration 46), jamais ouverte
--      par le partage réciproque. Le téléphone et l'e-mail de la fiche absorbée, quand ils diffèrent, sont gardés dans les notes ; la
--      conversation WhatsApp suit la fiche gardée ; la corbeille des deux entreprises est mise à jour.
--   3. Conversations WhatsApp communes EN LECTURE : un administrateur de Secret ou de Taxi lit toutes les conversations de l'organisation (le
--      numéro est commun), leurs messages, médias et réponses préparées. Les écritures (ranger, relier, marquer lu, traiter une réponse,
--      envoyer, préparer) demandent toujours d'être administrateur de l'entreprise de la conversation : whatsapp_ecrit(), la règle d'avant.
--   4. Deux dossiers liés : dossiers.dossier_lie_id relie un dossier Secret et un dossier Taxi nés de la même demande. Seulement entre Secret
--      et Taxi de la même organisation, vers un dossier que la personne voit. Le lien ne donne aucune lecture. Un dossier lié restauré depuis
--      la corbeille garde son lien si le dossier lié existe encore, sinon il revient sans lien.
--   5. doublons_clients_partages() : les paires de fiches Secret et Taxi qui se ressemblent (même téléphone, ou même prénom et nom), pour
--      que Jérémy valide chaque fusion. Lecture seule : rien n'est jamais fusionné tout seul.
--
-- Ne modifie aucune donnée existante, sauf les deux lignes de partages_clients (organisation de Zwald seulement). Se rejoue sans effet.
-- Avec la migration, redéployer les fonctions « whatsapp-envoi » et « whatsapp-preparer » (elles appellent whatsapp_peut_ecrire).
-- Retour en arrière : docs/gestion/retour-63-espace-unifie.sql.
-- Contrôle : verif-espace-unifie.mjs ; select * from doublons_clients_partages();

begin;

-- 1. Partage réciproque Secret et Taxi.
insert into partages_clients (source_id, cible_id, organisation_id)
select s.id, c.id, s.organisation_id
from entites s join entites c on c.organisation_id = s.organisation_id
where s.organisation_id = '00000000-0000-0000-0000-00000000a000' and s.slug in ('secret', 'taxi') and c.slug in ('secret', 'taxi') and s.id <> c.id
on conflict do nothing;

-- Réciproque seulement entre Secret et Taxi de l'organisation de la personne : un partage coché avec ZTP ne l'ouvre jamais.
create or replace function partage_reciproque(p_a uuid, p_b uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select organisation_de(p_a) = mon_organisation() and organisation_de(p_b) = mon_organisation()
    and exists (select 1 from entites where id = p_a and slug in ('secret', 'taxi'))
    and exists (select 1 from entites where id = p_b and slug in ('secret', 'taxi'))
    and exists (select 1 from partages_clients where source_id = p_a and cible_id = p_b)
    and exists (select 1 from partages_clients where source_id = p_b and cible_id = p_a)
$$;
revoke all on function partage_reciproque(uuid, uuid) from public, anon;
grant execute on function partage_reciproque(uuid, uuid) to authenticated;

-- Relier un dossier de « cible » à une fiche de « source » : l'administration (migration 46), ou, pour le partage réciproque Secret et Taxi,
-- toute personne qui lit tous les clients de la source et écrit des dossiers dans la cible.
create or replace function partage_clients_permis(p_source uuid, p_cible uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from partages_clients where source_id = p_source and cible_id = p_cible)
    and organisation_de(p_source) = mon_organisation() and organisation_de(p_cible) = mon_organisation()
    and (est_super_admin() or (a_permission(p_source, 'reglages.ecrire') and a_permission(p_cible, 'reglages.ecrire')) or partage_reciproque(p_source, p_cible))
    and a_permission(p_source, 'clients.lire') and voit_tout(p_source)
    and a_permission(p_cible, 'dossiers.ecrire')
$$;
revoke all on function partage_clients_permis(uuid, uuid) from public, anon;
grant execute on function partage_clients_permis(uuid, uuid) to authenticated;

-- 2. Fusion (migration 46), corrigée : entre deux entreprises, administration seulement ; rien de la fiche absorbée ne se perd ; la
-- conversation WhatsApp et la corbeille des deux entreprises suivent la fiche gardée.
create or replace function fusionner_clients(p_garder uuid, p_absorbe uuid) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g clients;
  a clients;
  vide constant text := '';
  ajout text := '';
begin
  select * into g from clients where id = p_garder for update;
  select * into a from clients where id = p_absorbe for update;
  if g.id is null or a.id is null or g.id = a.id then
    raise exception 'Fusion impossible : les deux fiches doivent être deux clients différents de la même entreprise';
  end if;
  if g.entite_id <> a.entite_id and not exists (select 1 from partages_clients where source_id = g.entite_id and cible_id = a.entite_id) then
    raise exception 'Fusion impossible : les deux fiches doivent être deux clients différents de la même entreprise';
  end if;
  if auth.uid() is not null then
    if not (a_permission(a.entite_id, 'clients.fusionner') or (a_permission(a.entite_id, 'clients.supprimer') and a_permission(a.entite_id, 'dossiers.ecrire'))) then
      raise exception 'Votre rôle ne permet pas de fusionner des clients' using errcode = '42501';
    end if;
    if not voit_tout(a.entite_id) then
      raise exception 'Fusion réservée aux rôles qui voient tous les dossiers de l''entreprise' using errcode = '42501';
    end if;
    -- Entre deux entreprises : l'administration seulement (jamais ouvert par le partage réciproque).
    if g.entite_id <> a.entite_id and not (
      organisation_de(g.entite_id) = mon_organisation() and organisation_de(a.entite_id) = mon_organisation()
      and (est_super_admin() or (a_permission(g.entite_id, 'reglages.ecrire') and a_permission(a.entite_id, 'reglages.ecrire')))
      and a_permission(g.entite_id, 'clients.ecrire') and a_permission(g.entite_id, 'clients.lire') and voit_tout(g.entite_id)
    ) then
      raise exception 'Seule l''administration rattache un client à la fiche d''une autre entreprise' using errcode = '42501';
    end if;
  end if;

  update dossiers set client_id = g.id where client_id = a.id;
  -- Les dossiers de la corbeille, de toutes les entreprises, pointent désormais vers la fiche gardée : ils restent restaurables.
  update corbeille set ligne = jsonb_set(ligne, '{client_id}', to_jsonb(g.id::text))
  where table_name = 'dossiers' and ligne->>'client_id' = a.id::text;
  -- La conversation WhatsApp suit la fiche gardée si elle est de la même entreprise, sinon elle perd seulement son client.
  if to_regclass('public.whatsapp_conversations') is not null then
    execute 'update whatsapp_conversations set client_id = case when entite_id = $1 then $2 else null end where client_id = $3' using g.entite_id, g.id, a.id;
  end if;

  -- Un téléphone ou un e-mail différent n'est jamais perdu : il passe dans les notes de la fiche gardée.
  if coalesce(trim(a.telephone), vide) <> vide and coalesce(trim(g.telephone), vide) <> vide and regexp_replace(a.telephone, '[^0-9]', '', 'g') <> regexp_replace(g.telephone, '[^0-9]', '', 'g') then
    ajout := ajout || E'\nAutre téléphone : ' || trim(a.telephone);
  end if;
  if coalesce(trim(a.email), vide) <> vide and coalesce(trim(g.email), vide) <> vide and lower(trim(a.email)) <> lower(trim(g.email)) then
    ajout := ajout || E'\nAutre e-mail : ' || trim(a.email);
  end if;

  update clients set
    civilite = case when coalesce(trim(g.civilite), vide) = vide and coalesce(trim(a.civilite), vide) <> vide then a.civilite else g.civilite end,
    prenom = case when coalesce(trim(g.prenom), vide) = vide and coalesce(trim(a.prenom), vide) <> vide then a.prenom else g.prenom end,
    nom = case when coalesce(trim(g.nom), vide) = vide and coalesce(trim(a.nom), vide) <> vide then a.nom else g.nom end,
    telephone = case when coalesce(trim(g.telephone), vide) = vide and coalesce(trim(a.telephone), vide) <> vide then a.telephone else g.telephone end,
    email = case when coalesce(trim(g.email), vide) = vide and coalesce(trim(a.email), vide) <> vide then a.email else g.email end,
    adresse = case when coalesce(trim(g.adresse), vide) = vide and coalesce(trim(a.adresse), vide) <> vide then a.adresse else g.adresse end,
    notes = nullif(trim(both E'\n' from concat_ws(E'\n',
      nullif(trim(coalesce(g.notes, vide)), vide),
      case when coalesce(trim(a.notes), vide) = vide or trim(a.notes) = coalesce(trim(g.notes), vide) then null else trim(a.notes) end,
      nullif(trim(both E'\n' from ajout), vide)
    )), vide)
  where id = g.id;

  delete from clients where id = a.id;
  return g.id;
end $$;
revoke all on function fusionner_clients(uuid, uuid) from public, anon;
grant execute on function fusionner_clients(uuid, uuid) to authenticated;

-- 3. WhatsApp commun en lecture ; écritures inchangées (whatsapp_ecrit, la règle d'avant cette migration).
create or replace function whatsapp_lit(e uuid, org uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select (e is null or organisation_de(e) = org)
    and exists (select 1 from entites x where x.organisation_id = org and x.slug in ('secret', 'taxi') and whatsapp_admin(x.id))
$$;
create or replace function whatsapp_ecrit(e uuid, org uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when e is not null then whatsapp_admin(e) and organisation_de(e) = org
    else exists (select 1 from entites x where x.organisation_id = org and x.slug in ('secret', 'taxi') and whatsapp_admin(x.id))
  end
$$;
revoke all on function whatsapp_lit(uuid, uuid), whatsapp_ecrit(uuid, uuid) from public, anon;
grant execute on function whatsapp_lit(uuid, uuid), whatsapp_ecrit(uuid, uuid) to authenticated;
-- Pour les fonctions « whatsapp-envoi » et « whatsapp-preparer » : la personne peut-elle agir sur cette conversation ?
create or replace function whatsapp_peut_ecrire(p_conversation uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from whatsapp_conversations c where c.id = p_conversation and whatsapp_ecrit(c.entite_id, c.organisation_id))
$$;
revoke all on function whatsapp_peut_ecrire(uuid) from public, anon;
grant execute on function whatsapp_peut_ecrire(uuid) to authenticated;

drop policy if exists "ranger une conversation WhatsApp" on whatsapp_conversations;
create policy "ranger une conversation WhatsApp" on whatsapp_conversations for update to authenticated
  using (whatsapp_ecrit(entite_id, organisation_id))
  with check (whatsapp_ecrit(entite_id, organisation_id));

drop policy if exists "lire les propositions WhatsApp" on whatsapp_propositions;
create policy "lire les propositions WhatsApp" on whatsapp_propositions for select to authenticated
  using (exists (select 1 from whatsapp_conversations c where c.id = conversation_id and whatsapp_lit(c.entite_id, c.organisation_id)));
drop policy if exists "traiter une proposition WhatsApp" on whatsapp_propositions;
create policy "traiter une proposition WhatsApp" on whatsapp_propositions for update to authenticated
  using (statut in ('a_faire', 'envoi') and (entite_id is null or whatsapp_admin(entite_id))
    and exists (select 1 from whatsapp_conversations c where c.id = conversation_id and whatsapp_ecrit(c.entite_id, c.organisation_id)))
  with check (statut in ('traitee', 'ignoree'));

-- 4. Dossiers liés.
alter table dossiers add column if not exists dossier_lie_id uuid references dossiers (id) on delete set null;
create index if not exists dossiers_lie on dossiers (dossier_lie_id) where dossier_lie_id is not null;

create or replace function controler_dossier_lie() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l record;
  restauration boolean := false;
begin
  if new.dossier_lie_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.dossier_lie_id is not distinct from old.dossier_lie_id and new.entite_id is not distinct from old.entite_id then return new; end if;
  -- Un dossier remis depuis la corbeille avec le lien qu'il avait.
  if tg_op = 'INSERT' then
    restauration := exists (select 1 from corbeille where table_name = 'dossiers' and ligne->>'id' = new.id::text and ligne->>'dossier_lie_id' = new.dossier_lie_id::text);
  end if;
  select d.id, d.entite_id, d.responsable_id, d.cree_par, e.slug into l from dossiers d join entites e on e.id = d.entite_id where d.id = new.dossier_lie_id;
  if l.id is null or l.id = new.id or l.entite_id = new.entite_id or organisation_de(l.entite_id) is distinct from organisation_de(new.entite_id)
     or l.slug not in ('secret', 'taxi') or not exists (select 1 from entites where id = new.entite_id and slug in ('secret', 'taxi')) then
    if restauration then
      new.dossier_lie_id := null;  -- le dossier lié n'existe plus : le dossier revient sans lien
      return new;
    end if;
    raise exception 'Lien impossible avec ce dossier' using errcode = '42501';
  end if;
  if restauration then return new; end if;
  -- Connecté : la personne voit le dossier lié (règle de « lire les dossiers ») et écrit des dossiers dans son entreprise.
  if auth.uid() is not null and not (
    a_permission(l.entite_id, 'dossiers.lire') and a_permission(l.entite_id, 'dossiers.ecrire')
    -- coalesce : un responsable ou un créateur vide donnerait NULL, et « not NULL » ne refuserait rien.
    and (voit_tout(l.entite_id) or coalesce(l.responsable_id = auth.uid(), false) or coalesce(l.cree_par = auth.uid(), false))
  ) then
    raise exception 'Lien impossible avec ce dossier' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function controler_dossier_lie() from public, anon;
drop trigger if exists controler_dossier_lie on dossiers;
create trigger controler_dossier_lie before insert or update of dossier_lie_id, entite_id on dossiers for each row execute function controler_dossier_lie();

-- 5. Doublons possibles entre Secret et Taxi : même téléphone (9 derniers chiffres) ou même prénom et nom (sans accents ni casse).
-- Réservé à qui lit tous les clients des deux entreprises. Rend les paires, la plus ancienne fiche d'abord.
create or replace function doublons_clients_partages() returns table (fiche_a uuid, entreprise_a text, nom_a text, fiche_b uuid, entreprise_b text, nom_b text, raison text)
language sql stable security definer set search_path = public, pg_temp as $$
  with c as (
    select cl.id, cl.entite_id, e.slug, cl.created_at, trim(coalesce(cl.prenom, '') || ' ' || coalesce(cl.nom, '')) as nom_complet,
      lower(regexp_replace(translate(coalesce(cl.prenom, '') || coalesce(cl.nom, ''), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ', 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'), '[^a-zA-Z]', '', 'g')) as cle_nom,
      right(regexp_replace(coalesce(cl.telephone, ''), '[^0-9]', '', 'g'), 9) as cle_tel
    from clients cl join entites e on e.id = cl.entite_id
    where e.organisation_id = mon_organisation() and e.slug in ('secret', 'taxi')
  )
  select a.id, a.slug, a.nom_complet, b.id, b.slug, b.nom_complet,
    case when length(a.cle_tel) = 9 and a.cle_tel = b.cle_tel then 'téléphone' else 'nom' end
  from c a join c b on a.entite_id <> b.entite_id and (a.created_at, a.id) < (b.created_at, b.id)
    and ((length(a.cle_tel) = 9 and a.cle_tel = b.cle_tel) or (length(a.cle_nom) >= 4 and a.cle_nom = b.cle_nom))
  where (select count(*) = 2 and bool_and(a_permission(x.id, 'clients.lire') and voit_tout(x.id)) from entites x where x.organisation_id = mon_organisation() and x.slug in ('secret', 'taxi'))
  order by 3, 6
$$;
revoke all on function doublons_clients_partages() from public, anon;
grant execute on function doublons_clients_partages() to authenticated;

commit;
