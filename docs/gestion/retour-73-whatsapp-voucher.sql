-- Retour en arrière de la migration 73 (bucket privé « whatsapp-sortant » des vouchers envoyés depuis Gestion).
-- Avant : remettre le code d'avant (écran sans le bouton « Envoyer dans la conversation WhatsApp », fonctions « whatsapp-envoi » et
-- « whatsapp » redéployées), sinon l'envoi échoue proprement (« base ») et rien ne part.
-- Les fichiers encore là ont moins d'une heure : les effacer depuis le tableau de bord (Storage > whatsapp-sortant), ou attendre une heure
-- que la purge le fasse. Supabase refuse de supprimer un bucket qui contient encore des fichiers.
-- Si la suppression ci-dessous est refusée par Supabase (déclencheur storage.protect_delete, « direct deletion from storage tables is not
-- allowed »), le fichier le dit (notice) sans rien annuler : supprimer alors le bucket depuis le tableau de bord, Storage > whatsapp-sortant >
-- Delete bucket.
-- Les messages déjà rangés dans le fil restent : type « image », légende, média « voucher » sans fichier.
-- Avant (lecture seule) :
--   select count(*) from storage.objects where bucket_id = 'whatsapp-sortant';
begin;

drop function if exists whatsapp_ranger_voucher(uuid, uuid, text, jsonb);

-- Un refus de Supabase (storage.protect_delete) n'annule pas le reste : le bucket est alors à supprimer depuis le tableau de bord.
do $$
begin
  delete from storage.buckets where id = 'whatsapp-sortant' and not exists (select 1 from storage.objects where bucket_id = 'whatsapp-sortant');
exception when others then
  raise notice 'Bucket whatsapp-sortant non supprimé (%) : le supprimer depuis le tableau de bord, Storage > whatsapp-sortant > Delete bucket.', sqlerrm;
end $$;

commit;
-- Contrôle après (aucune ligne) :
--   select id from storage.buckets where id = 'whatsapp-sortant';
