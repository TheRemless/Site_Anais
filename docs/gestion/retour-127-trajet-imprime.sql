-- Gestion : retour en arrière de la migration 127. La colonne trajets.imprime est retirée (son contenu est perdu) ; rejouer ensuite
-- migration-124-brochure-ecriture.sql pour remettre brochure_ecrire_ligne dans sa version sans « imprime ».
begin;
alter table trajets drop column if exists imprime;
commit;
