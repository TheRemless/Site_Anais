-- Retour en arrière de la migration 73 (bucket privé « whatsapp-sortant » des vouchers envoyés depuis Gestion).
-- Avant : remettre le code d'avant (écran sans le bouton « Envoyer dans la conversation WhatsApp », fonctions « whatsapp-envoi » et
-- « whatsapp » redéployées), sinon l'envoi échoue proprement (« base ») et rien ne part.
-- Les fichiers encore là ont moins d'une heure : les effacer depuis le tableau de bord (Storage > whatsapp-sortant), ou attendre une heure
-- que la purge le fasse. Supabase refuse de supprimer un bucket qui contient encore des fichiers.
-- Les messages déjà rangés dans le fil restent : type « image », légende, média « voucher » sans fichier.
-- Avant (lecture seule) :
--   select count(*) from storage.objects where bucket_id = 'whatsapp-sortant';
begin;

delete from storage.buckets where id = 'whatsapp-sortant' and not exists (select 1 from storage.objects where bucket_id = 'whatsapp-sortant');

commit;
-- Contrôle après (aucune ligne) :
--   select id from storage.buckets where id = 'whatsapp-sortant';
