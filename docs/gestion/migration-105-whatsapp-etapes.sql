-- Gestion : migration 105, étapes des conversations WhatsApp de clients (demande de Jérémy du 22.11.2026). Suit la 85 (« Prêt à réserver »,
-- PR 313) ; ne dépend d'aucune migration de 86 à 104.
--
-- But : la liste WhatsApp se trie selon l'avancée de chaque client (Nouvelle demande, Prix envoyé, À relancer, Prêt à réserver, Réservé,
-- Voucher envoyé, Terminé), par entreprise : Secret et Taxi partagent le numéro, un client peut être « Réservé » chez Taxi et « Prix envoyé »
-- chez Secret. Aucun appel à l'IA. Les étapes se calculent à l'écran (src/gestion/js/whatsapp-etapes-calc.mjs) avec les dossiers, les
-- réservations et les vouchers ; ce que disent les messages est gardé ici.
--   1. whatsapp_conversations.avancee (jsonb) : les faits tirés des messages par la fonction « whatsapp » (supabase/functions/whatsapp/etapes.js),
--      refaits à chaque message : dates du premier et du dernier message du client, de la première demande, du dernier prix donné par
--      entreprise, du « prêt à réserver » et de son entreprise, du dernier voucher envoyé depuis le téléphone, du dernier refus. Des dates et des
--      noms d'entreprise seulement, jamais un texte de message. 2 000 caractères au plus.
--   2. whatsapp_conversations.etape_manuelle (jsonb) : l'étape choisie par Nani, par entreprise : { "secret" | "taxi" | "aucune" :
--      { "etape", "le" } }. Elle l'emporte jusqu'au prochain événement qui fait avancer. « le » est posé par la base (heure du choix), jamais
--      par l'écran. Une clé ou une étape inconnue est refusée. Même politique que le reste du classement (« ranger une conversation
--      WhatsApp », migration 63) : un administrateur de l'entreprise de la conversation, ou d'une des deux pour une conversation à trier.
--   3. whatsapp_etape_outil (déclencheur) : une personne ne réécrit jamais avancee ; la fonction (clé de service) ne touche jamais
--      etape_manuelle. Les fonctions de déclencheur ne s'exécutent pas en direct : execute retiré à public, anon et authenticated.
-- L'Assistant ne lit pas ces colonnes. Rien sur les nets, les commissions ni l'argent ici (un prix est une date, jamais un montant).
--
-- Se rejoue sans effet. Ne modifie aucune donnée existante : les conversations déjà là sont calculées par la reprise de la fonction
-- (pg_cron, 20 toutes les 5 minutes), après le redéploiement de la fonction « whatsapp ». Sans la migration, l'écran garde l'ancienne liste
-- et la fonction n'écrit que pret_reserver.
-- Retour en arrière : docs/gestion/retour-105-whatsapp-etapes.sql.
-- Contrôle :
--   select (avancee->>'client') client, count(*), count(etape_manuelle) manuelles from whatsapp_conversations group by 1;
-- Contrôle PGlite : docs/gestion/verif-whatsapp-etapes.mjs.

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_conversations' and column_name = 'pret_reserver') then
    raise exception 'Migration 85 absente : la colonne whatsapp_conversations.pret_reserver manque.';
  end if;
end $$;

alter table whatsapp_conversations add column if not exists avancee jsonb;
alter table whatsapp_conversations add column if not exists etape_manuelle jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_avancee_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_avancee_check
      check (avancee is null or (jsonb_typeof(avancee) = 'object' and length(avancee::text) <= 2000));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_etape_manuelle_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_etape_manuelle_check
      check (etape_manuelle is null or (jsonb_typeof(etape_manuelle) = 'object' and length(etape_manuelle::text) <= 600));
  end if;
end $$;

-- Depuis l'outil, seulement le choix de l'étape. avancee n'a aucun droit d'écriture pour authenticated.
grant update (etape_manuelle) on whatsapp_conversations to authenticated;

create or replace function whatsapp_etape_outil() returns trigger language plpgsql security definer set search_path = public as $$
declare
  cle text;
  valeur jsonb;
  propre jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    -- La fonction « whatsapp » (clé de service) ne défait jamais un choix de Nani.
    new.etape_manuelle := old.etape_manuelle;
    return new;
  end if;
  -- Une personne ne réécrit pas les faits de la fonction.
  new.avancee := old.avancee;
  if new.etape_manuelle is not distinct from old.etape_manuelle then
    return new;
  end if;
  if new.etape_manuelle is not null then
    if jsonb_typeof(new.etape_manuelle) <> 'object' then
      raise exception 'Étape manuelle illisible.' using errcode = '22023';
    end if;
    for cle, valeur in select * from jsonb_each(new.etape_manuelle) loop
      if cle not in ('secret', 'taxi', 'aucune') or jsonb_typeof(valeur) <> 'object'
        or coalesce(valeur->>'etape', '') not in ('nouvelle', 'prix_envoye', 'a_relancer', 'pret', 'reserve', 'voucher_envoye', 'termine') then
        raise exception 'Étape manuelle inconnue.' using errcode = '22023';
      end if;
      -- L'heure du choix est celle de la base ; un choix inchangé garde son heure.
      propre := propre || jsonb_build_object(cle, jsonb_build_object(
        'etape', valeur->>'etape',
        'le', case when old.etape_manuelle is not null and old.etape_manuelle->cle->>'etape' = valeur->>'etape' then old.etape_manuelle->cle->'le' else to_jsonb(now()) end
      ));
    end loop;
    new.etape_manuelle := nullif(propre, '{}'::jsonb);
  end if;
  return new;
end
$$;
revoke all on function whatsapp_etape_outil() from public, anon, authenticated;
drop trigger if exists whatsapp_etape_outil on whatsapp_conversations;
create trigger whatsapp_etape_outil before update on whatsapp_conversations for each row execute function whatsapp_etape_outil();

commit;
