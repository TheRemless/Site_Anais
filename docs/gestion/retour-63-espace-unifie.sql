-- Retour en arrière de la migration 63 (espace unifié Secret et Taxi). Les liens entre dossiers sont perdus ; les dossiers restent.
-- Gardés volontairement : la fusion corrigée (plus stricte que celle de la 46) et whatsapp_ecrit / whatsapp_peut_ecrire, appelées par les
-- fonctions « whatsapp-envoi » et « whatsapp-preparer » (whatsapp_ecrit applique déjà la règle d'avant la 63).
begin;
drop trigger if exists controler_dossier_lie on dossiers;
drop function if exists controler_dossier_lie();
alter table dossiers drop column if exists dossier_lie_id;
drop function if exists doublons_clients_partages();
-- Partage Secret <-> Taxi retiré (celui de ZTP vers Secret et Taxi reste). Un dossier déjà relié à une fiche de l'autre entreprise garde son lien.
delete from partages_clients p using entites s, entites c
where s.id = p.source_id and c.id = p.cible_id and s.slug in ('secret', 'taxi') and c.slug in ('secret', 'taxi')
  and p.organisation_id = '00000000-0000-0000-0000-00000000a000';
create or replace function partage_clients_permis(p_source uuid, p_cible uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from partages_clients where source_id = p_source and cible_id = p_cible)
    and organisation_de(p_source) = mon_organisation() and organisation_de(p_cible) = mon_organisation()
    and (est_super_admin() or (a_permission(p_source, 'reglages.ecrire') and a_permission(p_cible, 'reglages.ecrire')))
    and a_permission(p_source, 'clients.lire') and voit_tout(p_source)
    and a_permission(p_cible, 'dossiers.ecrire')
$$;
drop function if exists partage_reciproque(uuid, uuid);
create or replace function whatsapp_lit(e uuid, org uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when e is not null then whatsapp_admin(e) and organisation_de(e) = org
    else exists (select 1 from entites x where x.organisation_id = org and x.slug in ('secret', 'taxi') and whatsapp_admin(x.id))
  end
$$;
drop policy if exists "lire les propositions WhatsApp" on whatsapp_propositions;
create policy "lire les propositions WhatsApp" on whatsapp_propositions for select to authenticated
  using (exists (select 1 from whatsapp_conversations c where c.id = conversation_id and whatsapp_lit(c.entite_id, c.organisation_id)) and (entite_id is null or whatsapp_admin(entite_id)));
drop policy if exists "traiter une proposition WhatsApp" on whatsapp_propositions;
create policy "traiter une proposition WhatsApp" on whatsapp_propositions for update to authenticated
  using (statut in ('a_faire', 'envoi') and (entite_id is null or whatsapp_admin(entite_id)) and exists (select 1 from whatsapp_conversations c where c.id = conversation_id and whatsapp_lit(c.entite_id, c.organisation_id)))
  with check (statut in ('traitee', 'ignoree'));
drop policy if exists "ranger une conversation WhatsApp" on whatsapp_conversations;
create policy "ranger une conversation WhatsApp" on whatsapp_conversations for update to authenticated
  using (whatsapp_lit(entite_id, organisation_id))
  with check (
    (entite_id is null and whatsapp_lit(null, organisation_id)) or (entite_id is not null and whatsapp_admin(entite_id) and organisation_de(entite_id) = organisation_id)
  );
commit;
