-- Gestion : migration 63, espace unifié Secret et VIP Taxi Lanta pour Nani (demande de Jérémy, 20.11.2026 : « on va partager la base client
-- entre taxi et secret »). Suit la 62.
--
--   1. Fiches clients partagées entre Secret et Taxi, dans les deux sens. Le réglage de la migration 46 (partages_clients) reçoit les deux
--      lignes secret -> taxi et taxi -> secret. Un partage réciproque est un partage complet : une personne qui lit tous les clients d'une
--      des deux entreprises et écrit des dossiers dans l'autre peut relier un dossier à la fiche (Mook comprise, dans ses droits). Le partage
--      à sens unique de ZTP reste réservé à l'administration, comme avant. La lecture d'une fiche ne change pas : il faut toujours le droit
--      « clients.lire » dans l'entreprise de la fiche. Dossiers, factures, vouchers, nets et commissions restent séparés par entreprise.
--   2. Conversations WhatsApp communes : un administrateur de Secret ou de Taxi lit toutes les conversations de l'organisation (le numéro
--      est commun), leurs messages, médias et réponses préparées, quel que soit leur classement. Les écritures (ranger, relier, marquer lu)
--      gardent les règles des migrations 59 et 60 : le classement de Nani reste protégé.
--   3. Deux dossiers liés : dossiers.dossier_lie_id relie un dossier Secret et un dossier Taxi nés de la même demande. Même organisation,
--      autre entreprise ; chaque dossier garde sa numérotation, sa facture et ses droits. Le lien se pose et se retire des deux côtés.
--   4. doublons_clients_partages() : les paires de fiches Secret et Taxi qui se ressemblent (même téléphone, ou même prénom et nom), pour
--      que Jérémy valide chaque fusion. Lecture seule : rien n'est jamais fusionné tout seul (fusionner_clients, migration 46, au cas par cas).
--
-- Ne modifie aucune donnée existante, sauf les deux lignes de partages_clients (organisation de Zwald seulement). Se rejoue sans effet.
-- Retour en arrière : docs/gestion/retour-63-espace-unifie.sql.
-- Contrôle : verif-espace-unifie.mjs ; select * from doublons_clients_partages();

begin;

-- 1. Partage réciproque Secret et Taxi.
insert into partages_clients (source_id, cible_id, organisation_id)
select s.id, c.id, s.organisation_id
from entites s join entites c on c.organisation_id = s.organisation_id
where s.organisation_id = '00000000-0000-0000-0000-00000000a000' and s.slug in ('secret', 'taxi') and c.slug in ('secret', 'taxi') and s.id <> c.id
on conflict do nothing;

create or replace function partage_reciproque(p_a uuid, p_b uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from partages_clients where source_id = p_a and cible_id = p_b)
    and exists (select 1 from partages_clients where source_id = p_b and cible_id = p_a)
$$;
revoke all on function partage_reciproque(uuid, uuid) from public, anon;
grant execute on function partage_reciproque(uuid, uuid) to authenticated;

-- Relier un dossier de « cible » à une fiche de « source » : l'administration (migration 46), ou, pour un partage réciproque, toute
-- personne qui lit tous les clients de la source et écrit des dossiers dans la cible.
create or replace function partage_clients_permis(p_source uuid, p_cible uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from partages_clients where source_id = p_source and cible_id = p_cible)
    and organisation_de(p_source) = mon_organisation() and organisation_de(p_cible) = mon_organisation()
    and (est_super_admin() or (a_permission(p_source, 'reglages.ecrire') and a_permission(p_cible, 'reglages.ecrire')) or partage_reciproque(p_source, p_cible))
    and a_permission(p_source, 'clients.lire') and voit_tout(p_source)
    and a_permission(p_cible, 'dossiers.ecrire')
$$;
revoke all on function partage_clients_permis(uuid, uuid) from public, anon;
grant execute on function partage_clients_permis(uuid, uuid) to authenticated;

-- 2. WhatsApp commun aux administrateurs de Secret et de Taxi de l'organisation.
create or replace function whatsapp_lit(e uuid, org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select (e is null or organisation_de(e) = org)
    and exists (select 1 from entites x where x.organisation_id = org and x.slug in ('secret', 'taxi') and whatsapp_admin(x.id))
$$;
revoke all on function whatsapp_lit(uuid, uuid) from public, anon;
grant execute on function whatsapp_lit(uuid, uuid) to authenticated;

-- Les écritures ne s'élargissent pas : ranger, relier ou marquer lu une conversation demande d'être administrateur de son entreprise
-- actuelle (ou d'une des deux si elle est à trier), comme avant cette migration.
drop policy if exists "ranger une conversation WhatsApp" on whatsapp_conversations;
create policy "ranger une conversation WhatsApp" on whatsapp_conversations for update to authenticated
  using ((entite_id is null and whatsapp_lit(null, organisation_id)) or (entite_id is not null and whatsapp_admin(entite_id) and organisation_de(entite_id) = organisation_id))
  with check (
    (entite_id is null and whatsapp_lit(null, organisation_id)) or (entite_id is not null and whatsapp_admin(entite_id) and organisation_de(entite_id) = organisation_id)
  );

drop policy if exists "lire les propositions WhatsApp" on whatsapp_propositions;
create policy "lire les propositions WhatsApp" on whatsapp_propositions for select to authenticated
  using (exists (select 1 from whatsapp_conversations c where c.id = conversation_id and whatsapp_lit(c.entite_id, c.organisation_id)));
drop policy if exists "traiter une proposition WhatsApp" on whatsapp_propositions;
create policy "traiter une proposition WhatsApp" on whatsapp_propositions for update to authenticated
  using (statut in ('a_faire', 'envoi') and exists (select 1 from whatsapp_conversations c where c.id = conversation_id and whatsapp_lit(c.entite_id, c.organisation_id)))
  with check (statut in ('traitee', 'ignoree'));

-- 3. Dossiers liés.
alter table dossiers add column if not exists dossier_lie_id uuid references dossiers (id) on delete set null;
create index if not exists dossiers_lie on dossiers (dossier_lie_id) where dossier_lie_id is not null;

create or replace function controler_dossier_lie() returns trigger language plpgsql security definer set search_path = public as $$
declare
  l record;
begin
  if new.dossier_lie_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.dossier_lie_id is not distinct from old.dossier_lie_id then return new; end if;
  select id, entite_id into l from dossiers where id = new.dossier_lie_id;
  if l.id is null or l.id = new.id or l.entite_id = new.entite_id or organisation_de(l.entite_id) is distinct from organisation_de(new.entite_id) then
    raise exception 'Lien impossible : le dossier lié doit être un autre dossier, d''une autre entreprise de la même organisation' using errcode = '42501';
  end if;
  -- Connecté : la personne lit le dossier lié (dans ses droits) et écrit dans les deux entreprises.
  if auth.uid() is not null and not (a_permission(l.entite_id, 'dossiers.lire') and a_permission(l.entite_id, 'dossiers.ecrire')) then
    raise exception 'Lien impossible : vous n''avez pas accès au dossier lié' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function controler_dossier_lie() from public, anon;
drop trigger if exists controler_dossier_lie on dossiers;
create trigger controler_dossier_lie before insert or update of dossier_lie_id on dossiers for each row execute function controler_dossier_lie();

-- 4. Doublons possibles entre Secret et Taxi : même téléphone (9 derniers chiffres) ou même prénom et nom (sans accents ni casse).
-- Réservé à qui lit tous les clients des deux entreprises (administration). Rend les paires, la plus ancienne fiche d'abord.
create or replace function doublons_clients_partages() returns table (fiche_a uuid, entreprise_a text, nom_a text, fiche_b uuid, entreprise_b text, nom_b text, raison text)
language sql stable security definer set search_path = public as $$
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
  where (select bool_and(a_permission(x.id, 'clients.lire') and voit_tout(x.id)) from entites x where x.organisation_id = mon_organisation() and x.slug in ('secret', 'taxi'))
  order by 3, 6
$$;
revoke all on function doublons_clients_partages() from public, anon;
grant execute on function doublons_clients_partages() to authenticated;

commit;
