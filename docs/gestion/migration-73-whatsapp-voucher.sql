-- Gestion : migration 73, voucher envoyé en image dans la conversation WhatsApp du client depuis Gestion (demande de Jérémy, 21.11.2026).
-- Suit la 72 (demandes du site et WhatsApp, PR 302), sans toucher à ses fonctions ni à whatsapp_reclasser. Ne dépend que du stockage.
--
-- Le navigateur fabrique l'image du voucher (imageVoucher) et l'envoie à la fonction « whatsapp-envoi », qui contrôle tout (droits,
-- conversation du client, fenêtre de 24 h, légende, coexistence) AVANT de la déposer ici avec la clé de service. Puis la fonction crée une
-- URL signée de 15 minutes, l'envoie à Telnyx, et le fichier est effacé quand Telnyx annonce « remis », « lu » ou « échec » (fonction
-- « whatsapp »), ou au plus tard par la purge de la fonction « whatsapp » une heure après le dépôt.
--
-- Ce fichier crée le bucket privé « whatsapp-sortant » et le verrou du voucher en base :
--   * privé (public = false) : aucune adresse publique, seulement des URL signées faites par la fonction ;
--   * 5 Mo par fichier, PNG, JPEG ou WebP (limites de Meta) ;
--   * AUCUNE politique sur storage.objects pour ce bucket : personne ne lit, n'écrit ni ne supprime depuis l'outil, Mook et ZTP compris.
--     Seule la clé de service (la fonction) y dépose et y efface. Toute politique qui citerait ce bucket est retirée.
--   * une politique de storage.objects qui ne cite aucun bucket_id (elle vaudrait pour tous les buckets, celui-ci compris) arrête la
--     migration : à corriger avant de la rejouer ;
--   * whatsapp_ranger_voucher (clé de service seulement, revue de sécurité de la PR 304) : sous verrou de la conversation (for update),
--     refuse le voucher d'une réservation s'il a déjà un envoi au résultat inconnu dans cette conversation (« envoi », ou « echec » avec
--     « sans_confirmation » : seuls « C'est parti » et « Pas parti » lèvent ce verrou, sans limite de durée), s'il est parti depuis moins de
--     2 minutes, ou si la même confirmation est rejouée (clé gestion-voucher:<réservation>:<id de la confirmation>) ; sinon il le range
--     (whatsapp_ranger, origine « gestion », type « image », statut « envoi »). Deux demandes simultanées : la seconde attend la première et
--     voit son message.
-- Pas de colonne : le message rangé dans le fil garde type « image », la légende et un média { statut: "voucher", chemin_sortant,
-- reservation_id } ; chemin_sortant est vidé quand le fichier part.
--
-- À exécuter une seule fois, AVANT de déployer les fonctions « whatsapp-envoi » et « whatsapp » de cette PR. Ne modifie aucune donnée
-- existante. Se rejoue sans effet.
-- Retour en arrière : docs/gestion/retour-73-whatsapp-voucher.sql.
-- Contrôle :
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'whatsapp-sortant';
--   select policyname from pg_policies where schemaname = 'storage' and (qual like '%whatsapp-sortant%' or with_check like '%whatsapp-sortant%');  -- aucune ligne
--   select count(*), min(created_at) from storage.objects where bucket_id = 'whatsapp-sortant';  -- quelques fichiers de moins d'une heure au plus
-- Contrôle PGlite : docs/gestion/verif-whatsapp-voucher.mjs.

begin;

insert into storage.buckets (id, name, public) values ('whatsapp-sortant', 'whatsapp-sortant', false) on conflict (id) do nothing;
update storage.buckets set public = false, file_size_limit = 5242880 where id = 'whatsapp-sortant';
-- Types acceptés, là où la colonne existe (Supabase ; absente du Postgres de contrôle).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $q$update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'] where id = 'whatsapp-sortant'$q$;
  end if;
end $$;

-- Une politique sans bucket_id vaudrait aussi pour ce bucket : la migration s'arrête et la nomme.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and coalesce(qual, '') not like '%bucket_id%' and coalesce(with_check, '') not like '%bucket_id%'
  loop
    raise exception 'Politique « % » sur storage.objects sans bucket_id : elle ouvrirait whatsapp-sortant. À corriger avant cette migration.', p.policyname;
  end loop;
end $$;

-- Aucune politique pour ce bucket : une politique ajoutée à la main par erreur est retirée.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%whatsapp-sortant%' or coalesce(with_check, '') like '%whatsapp-sortant%')
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- Verrou du voucher, contrôle et rangement d'un seul tenant. p_cle : gestion-voucher:<réservation>:<id de la confirmation>.
-- m : le message préparé par la fonction (texte, medias avec reservation_id). Rend le résultat de whatsapp_ranger, ou { refus }.
create or replace function whatsapp_ranger_voucher(p_conversation uuid, p_reservation uuid, p_cle text, m jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c record;
  ref jsonb := jsonb_build_array(jsonb_build_object('reservation_id', p_reservation::text));
begin
  if p_cle is null or p_cle !~ ('^gestion-voucher:' || p_reservation::text || ':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'cle_invalide' using errcode = '22023';
  end if;
  if m is null or jsonb_typeof(m->'medias') is distinct from 'array' or not (m->'medias' @> ref) then
    raise exception 'medias_invalides' using errcode = '22023';
  end if;
  -- Une demande à la fois par conversation : la seconde attend ici et voit le message de la première.
  select id, organisation_id, telephone into c from whatsapp_conversations where id = p_conversation for update;
  if not found then return jsonb_build_object('refus', 'conversation'); end if;
  if exists (select 1 from whatsapp_messages where evenement_id = p_cle) then return jsonb_build_object('refus', 'deja'); end if;
  if exists (select 1 from whatsapp_messages w where w.conversation_id = c.id and w.origine = 'gestion' and w.type = 'image' and w.medias @> ref
      and (w.statut_envoi = 'envoi' or (w.statut_envoi = 'echec' and w.erreur_envoi = 'sans_confirmation'))) then
    return jsonb_build_object('refus', 'a_verifier');
  end if;
  if exists (select 1 from whatsapp_messages w where w.conversation_id = c.id and w.origine = 'gestion' and w.type = 'image' and w.medias @> ref
      and w.envoye_le >= now() - interval '2 minutes') then
    return jsonb_build_object('refus', 'recent');
  end if;
  return whatsapp_ranger(c.organisation_id, c.telephone, null, m || jsonb_build_object('evenement_id', p_cle, 'sens', 'sortant', 'origine', 'gestion',
    'type', 'image', 'statut_envoi', 'envoi', 'envoye_le', now(), 'telnyx_id', null, 'meta_id', null));
end
$$;
revoke all on function whatsapp_ranger_voucher(uuid, uuid, text, jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function whatsapp_ranger_voucher(uuid, uuid, text, jsonb) to service_role';
  end if;
end $$;

commit;
