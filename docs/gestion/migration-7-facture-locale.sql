-- Gestion : migration 7, facture locale (en bahts, pour la comptabilité thaïlandaise).
-- À exécuter une seule fois sur une base déjà migrée avec migration-6-collaboration.sql, AVANT de publier la nouvelle version de l'outil.
-- Contient les coordonnées de l'entreprise : ce fichier ne doit pas être publié.

begin;

-- Un nouveau type de document. Le résumé des dossiers et les analyses ne regardent que « devis » et « facture » : la facture locale n'y compte pas.
alter table documents drop constraint documents_type_check;
alter table documents add constraint documents_type_check check (type in ('devis', 'facture', 'facture_locale'));

commit;
