-- Retour en arrière de la migration 72 (demandes du site et conversations WhatsApp reliées).
-- Les liens déjà posés restent : une demande reliée à un dossier reste « confirmee » avec son dossier, une conversation reliée garde son
-- client, son dossier et sa source (Nani les change depuis l'écran WhatsApp, comme avant). Les fonctions et le déclencheur partent,
-- whatsapp_reclasser revient à la version de la migration 59 (toute conversation rangée par une personne : source « manuel »).
-- Sans le déclencheur une_fois, une personne peut de nouveau changer le statut ou le dossier d'une demande déjà traitée (règle d'avant :
-- seulement la politique « traiter les demandes du site » de la migration 30).
-- Le code doit revenir aussi : sans les fonctions, l'outil ne relie rien et le dit discrètement (« pas encore en place »).
-- Avant (lecture seule) :
--   select statut, count(*), count(*) filter (where decision ? 'relie') reliees_depuis_un_dossier from demandes_site group by 1;
begin;

drop function if exists whatsapp_relier_apres_demande(uuid);
drop function if exists demande_site_delier(uuid);
drop function if exists demande_site_relier(uuid, uuid);
drop trigger if exists une_fois on demandes_site;
drop function if exists demandes_site_une_fois();
drop function if exists meme_telephone(text, text);
drop function if exists cle_telephone(text);

-- whatsapp_reclasser de la migration 59, tel quel.
create or replace function whatsapp_reclasser() returns trigger language plpgsql security definer set search_path = public as $$
declare
  trouve record;
begin
  if auth.uid() is not null then
    if new.non_lus > old.non_lus then new.non_lus := old.non_lus; end if;
    if new.entite_id is distinct from old.entite_id then new.entite_source := 'manuel'; end if;
    if new.entite_source not in ('manuel') and new.entite_source is distinct from old.entite_source then new.entite_source := old.entite_source; end if;
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

commit;
