-- Gestion : migration 73, voucher envoyé en image dans la conversation WhatsApp du client depuis Gestion (demande de Jérémy, 21.11.2026).
-- Suit la 72 (demandes du site et WhatsApp, PR 302), sans toucher à ses fonctions ni à whatsapp_reclasser. Ne dépend que du stockage.
--
-- Le navigateur fabrique l'image du voucher (imageVoucher) et l'envoie à la fonction « whatsapp-envoi », qui contrôle tout (droits,
-- conversation du client, fenêtre de 24 h, légende, coexistence) AVANT de la déposer ici avec la clé de service. Puis la fonction crée une
-- URL signée de 15 minutes, l'envoie à Telnyx, et le fichier est effacé quand Telnyx annonce « remis », « lu » ou « échec » (fonction
-- « whatsapp »), ou au plus tard par la purge de la fonction « whatsapp » une heure après le dépôt.
--
-- Ce fichier crée seulement le bucket privé « whatsapp-sortant » :
--   * privé (public = false) : aucune adresse publique, seulement des URL signées faites par la fonction ;
--   * 5 Mo par fichier, PNG, JPEG ou WebP (limites de Meta) ;
--   * AUCUNE politique sur storage.objects pour ce bucket : personne ne lit, n'écrit ni ne supprime depuis l'outil, Mook et ZTP compris.
--     Seule la clé de service (la fonction) y dépose et y efface. Toute politique qui citerait ce bucket est retirée.
-- Pas de colonne, pas de fonction : le message rangé dans le fil (whatsapp_ranger, migrations 58 et 64) garde type « image », la légende
-- et un média { statut: "voucher", chemin_sortant } ; chemin_sortant est vidé quand le fichier part.
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

commit;
