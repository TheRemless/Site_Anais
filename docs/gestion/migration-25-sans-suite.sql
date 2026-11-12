-- Gestion : migration 25, devis « sans suite ».
-- À exécuter une seule fois. N'efface ni ne modifie aucune donnée : ajoute deux colonnes vides sur les dossiers.
-- Tant qu'elle n'est pas appliquée, l'outil ne propose pas le bouton « Sans suite » (il détecte l'absence de la colonne).
-- Un devis classé sans suite sort des relances et des devis en attente, sans effacer le dossier. Rouvrir le devis remet les deux colonnes à vide.

begin;

alter table dossiers add column if not exists sans_suite_le date;
alter table dossiers add column if not exists sans_suite_motif text;

commit;
