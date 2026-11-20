-- Gestion : migration 57 (20.11.2026), encaisser les commissions des partenaires dossier par dossier.
-- À exécuter une seule fois, AVANT de publier la version de l'outil qui l'utilise. Idempotente. Ne modifie aucune donnée existante.
--
-- Jusqu'ici une commission reçue ne gardait que son montant et sa date de réception (qui vaut « réglée »). L'écran « À encaisser » note maintenant :
-- 1. le moyen de paiement du partenaire (même liste que les paiements des clients : virement, espèces, Wise…) ;
-- 2. un versement partiel : le partenaire paie une partie, le reste reste à recevoir. Le montant reçu s'additionne dans `commission_recue`,
--    `commission_recue_le` reste vide (la commission n'est pas réglée) et `commission_partielle_le` garde la date du dernier versement ;
-- 3. le motif d'un écart quand un dossier est soldé avec un montant différent du prévu (rabais au client, vendu plus cher, autre) et une note libre.
-- Les colonnes sont dans `reservations_nets` : mêmes droits que les nets (lecture avec « partenaires.nets », écriture avec « partenaires.nets »
-- et « dossiers.ecrire »), même journal (migration 37, qui note toutes les colonnes), même corbeille et même sauvegarde (toutes les colonnes).

begin;

alter table reservations_nets add column if not exists commission_recue_moyen text;
alter table reservations_nets add column if not exists commission_partielle_le date;
alter table reservations_nets add column if not exists commission_ecart_motif text;
alter table reservations_nets add column if not exists commission_ecart_note text;

alter table reservations_nets drop constraint if exists reservations_nets_commission_ecart_motif_check;
alter table reservations_nets add constraint reservations_nets_commission_ecart_motif_check
  check (commission_ecart_motif is null or commission_ecart_motif in ('rabais', 'plus_cher', 'autre'));
alter table reservations_nets drop constraint if exists reservations_nets_commission_ecart_note_check;
alter table reservations_nets add constraint reservations_nets_commission_ecart_note_check
  check (commission_ecart_note is null or char_length(commission_ecart_note) <= 300);

commit;
