-- Gestion : migration 85, filtre « Prêt à réserver » de l'écran WhatsApp (22.11.2026). Suit la 68 (contacts typés) ; ne dépend d'aucune
-- migration de 74 à 84.
--
-- But : Nani voit d'un tap les conversations où le client a dit oui (« yes we take it ») ou où elle a envoyé la confirmation, sans dossier
-- encore créé. La règle vient des 48 conversations réelles lues le 22.11.2026 (docs/gestion/whatsapp-pret-a-reserver.md).
--   1. whatsapp_conversations.pret_reserver (jsonb) : la décision de la fonction « whatsapp » (supabase/functions/whatsapp/pret.js), sans
--      IA, refaite à chaque message : { pret, le, depuis, message_id, source, motif, carte, calcule_le }. La carte reprend ce qui est écrit
--      dans la conversation (nom, date, heure, départ, arrivée, personnes, vol, prix donné par Nani), jamais un numéro de téléphone. Elle
--      ne contient pas de texte de message. 2 000 caractères au plus.
--   2. whatsapp_conversations.pret_retire_le (timestamptz) : Nani a enlevé la conversation du filtre. Elle y revient seulement sur un
--      signal plus récent que le retrait. Écrit depuis l'outil, à l'heure de la base (jamais une date choisie par l'écran) ; remis à vide
--      par « Annuler ». La politique « ranger une conversation WhatsApp » (migration 63, whatsapp_ecrit) décide qui : un administrateur de
--      l'entreprise de la conversation, ou d'une des deux pour une conversation à trier. En lecture seule et pour Mook : aucune ligne.
--   3. whatsapp_pret_outil (déclencheur) : une personne connectée ne réécrit jamais pret_reserver ; la fonction (clé de service) ne touche
--      jamais pret_retire_le. Les fonctions de déclencheur ne s'exécutent pas en direct : execute retiré à public, anon et authenticated.
-- 4. whatsapp_reclasser : un client (non typé ou « client », sans fiche partenaire) peut être relié à une fiche et à un dossier de Secret
--    comme de Taxi sans être rangé (relier ne range jamais la conversation d'un client dans une seule entreprise). Jamais ZTP. Depuis l'outil,
--    seulement dans une entreprise que la personne administre.
-- Le dossier relié fait sortir la conversation du filtre à l'écran. Un dossier du même client créé depuis le prix donné mais pas relié la
-- laisse dans le filtre avec « Relier au dossier » (une seule écriture : entite_id, client_id, dossier_id, contrôlés par whatsapp_reclasser).
-- L'Assistant ne lit pas ces colonnes (outils de supabase/functions/agent inchangés). Rien sur les nets, les commissions ni l'argent ici.
--
-- Se rejoue sans effet. Ne modifie aucune donnée existante : les conversations déjà là sont calculées par la reprise de la fonction
-- (pg_cron, 20 toutes les 5 minutes), après le redéploiement de la fonction « whatsapp ». Sans la migration, l'écran n'affiche pas le
-- filtre et la fonction n'écrit rien.
-- Retour en arrière : docs/gestion/retour-85-whatsapp-pret.sql.
-- Contrôle :
--   select pret_reserver->>'pret' pret, pret_reserver->>'motif' motif, count(*) from whatsapp_conversations group by 1, 2 order by 1, 2;
--   select privilege_type from information_schema.column_privileges where table_name = 'whatsapp_conversations' and column_name = 'pret_retire_le' and grantee = 'authenticated';
-- Contrôle PGlite : docs/gestion/verif-whatsapp-pret.mjs.

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_conversations' and column_name = 'type_contact') then
    raise exception 'Migration 68 absente : la colonne whatsapp_conversations.type_contact manque.';
  end if;
end $$;

-- 1 et 2. Colonnes.
alter table whatsapp_conversations add column if not exists pret_reserver jsonb;
alter table whatsapp_conversations add column if not exists pret_retire_le timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_pret_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_pret_check
      check (pret_reserver is null or (jsonb_typeof(pret_reserver) = 'object' and length(pret_reserver::text) <= 2000));
  end if;
end $$;

-- Depuis l'outil, seulement le retrait (pret_retire_le). pret_reserver n'a aucun droit d'écriture pour authenticated.
grant update (pret_retire_le) on whatsapp_conversations to authenticated;

-- 3. Qui écrit quoi (décision et retrait).
create or replace function whatsapp_pret_outil() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    -- Une personne ne réécrit pas la décision de la fonction.
    new.pret_reserver := old.pret_reserver;
    -- Le retrait est daté par la base ; vide, il est annulé.
    if new.pret_retire_le is distinct from old.pret_retire_le then
      new.pret_retire_le := case when new.pret_retire_le is null then null else now() end;
    end if;
  else
    -- La fonction « whatsapp » (clé de service) ne défait jamais un retrait de Nani.
    new.pret_retire_le := old.pret_retire_le;
  end if;
  return new;
end
$$;
revoke all on function whatsapp_pret_outil() from public, anon, authenticated;
drop trigger if exists whatsapp_pret_outil on whatsapp_conversations;
create trigger whatsapp_pret_outil before update on whatsapp_conversations for each row execute function whatsapp_pret_outil();

-- 4. Un client appartient à Secret et à Taxi (relecture du 22.11.2026) : relier un dossier ne range jamais la conversation d'un client
--    dans une seule entreprise. whatsapp_reclasser (dernière version : migration 72) accepte, pour un client, la fiche et le dossier de
--    Secret comme de Taxi, que la conversation soit à trier ou rangée. Le reste est inchangé (non-lus, source du classement, propositions
--    remplacées, recherche du client au changement d'entreprise).
create or replace function whatsapp_reclasser() returns trigger language plpgsql security definer set search_path = public as $$
declare
  trouve record;
  commun boolean;
begin
  if auth.uid() is not null then
    if new.non_lus > old.non_lus then new.non_lus := old.non_lus; end if;
    if new.entite_id is distinct from old.entite_id then
      new.entite_source := case when coalesce(current_setting('gestion.rangement_client', true), '') = new.id::text then 'client' else 'manuel' end;
    elsif new.entite_source is distinct from old.entite_source and new.entite_source <> 'manuel' then
      new.entite_source := old.entite_source;
    end if;
  end if;
  -- Migration 85 : un client (contact non typé ou « client », sans fiche partenaire) appartient à Secret et à Taxi. Sa fiche et son dossier
  -- peuvent être de l'une ou de l'autre, même si la conversation est à trier ou rangée dans l'autre : jamais de ZTP ni d'une autre
  -- organisation. Depuis l'outil, seulement une fiche ou un dossier d'une entreprise que la personne administre (whatsapp_admin), sauf si
  -- le lien ne change pas. Un autre contact garde la règle d'avant : la fiche et le dossier de l'entreprise de la conversation.
  -- Lu par to_jsonb : la fonction reste valable si une colonne de la migration 68 manque (contrôle du retour de la 68).
  commun := coalesce(to_jsonb(new)->>'type_contact', 'client') = 'client' and to_jsonb(new)->>'partenaire_id' is null and (to_jsonb(new)->>'reponses') is distinct from 'jamais';
  if new.client_id is not null and not (
    (new.entite_id is not null and exists (select 1 from clients where id = new.client_id and entite_id = new.entite_id))
    or (commun and exists (
      select 1 from clients k join entites x on x.id = k.entite_id
      where k.id = new.client_id and x.organisation_id = new.organisation_id and x.slug in ('secret', 'taxi')
        and (auth.uid() is null or whatsapp_admin(x.id) or new.client_id is not distinct from old.client_id)
    ))
  ) then
    new.client_id := null;
  end if;
  if new.dossier_id is not null and not (
    (new.entite_id is not null and exists (select 1 from dossiers where id = new.dossier_id and entite_id = new.entite_id and (new.client_id is null or client_id = new.client_id)))
    or (commun and exists (
      select 1 from dossiers d join entites x on x.id = d.entite_id
      where d.id = new.dossier_id and x.organisation_id = new.organisation_id and x.slug in ('secret', 'taxi')
        and (new.client_id is null or d.client_id = new.client_id)
        and (auth.uid() is null or whatsapp_admin(x.id) or new.dossier_id is not distinct from old.dossier_id)
    ))
  ) then
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
