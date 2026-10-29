-- Gestion : migration 12, détails des réservations pour les vouchers.
-- À exécuter une seule fois sur une base déjà migrée avec migration-11-reservations.sql, AVANT de publier la nouvelle version de l'outil.
-- Ne modifie aucune donnée existante : ajoute une colonne.

begin;

-- Ce qui figure sur le voucher : chambre, drop-off, vol, bagages, type de tour ou de transfert, frais de parc, remarques.
alter table reservations add column details jsonb not null default '{}';

commit;
