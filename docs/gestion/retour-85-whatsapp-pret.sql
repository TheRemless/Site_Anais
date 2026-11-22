-- Retour en arrière de la migration 85 (filtre « Prêt à réserver » de l'écran WhatsApp).
-- Les décisions de la fonction et les retraits de Nani partent ; aucun message, aucun dossier n'est touché. Sans les colonnes, l'écran
-- n'affiche plus le filtre et la fonction « whatsapp » n'écrit plus rien (erreur de colonne absente ignorée).
-- whatsapp_reclasser revient à la version de la migration 72 : une conversation de client reliée à un dossier de l'autre entreprise garde
-- son lien tant qu'on n'y touche pas ; la prochaine écriture le retire.
-- Appliquer retour-105-whatsapp-etapes.sql d'abord : la migration 105 dépend des colonnes de la 85. La garde ci-dessous refuse de
-- s'exécuter tant que les colonnes de la 105 existent (rien n'est touché, la transaction est annulée).
-- Avant (lecture seule) :
--   select pret_reserver->>'pret' pret, count(*), count(pret_retire_le) retirees from whatsapp_conversations group by 1;
begin;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_conversations' and column_name in ('avancee', 'etape_manuelle', 'ia_coupee')) then
    raise exception 'retour-85 refusé : appliquer retour-105-whatsapp-etapes.sql d''abord (colonnes de la migration 105 encore présentes)';
  end if;
end $$;

-- whatsapp_reclasser de la migration 72 (une conversation se relie seulement à la fiche et au dossier de son entreprise).
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

drop trigger if exists whatsapp_pret_outil on whatsapp_conversations;
drop function if exists whatsapp_pret_outil();
revoke update (pret_retire_le) on whatsapp_conversations from authenticated;
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_pret_check;
alter table whatsapp_conversations drop column if exists pret_retire_le;
alter table whatsapp_conversations drop column if exists pret_reserver;

commit;
