-- Gestion : retour en arrière de la migration 124 (import de brochure en une transaction). L'écran d'import ne peut plus enregistrer après.
begin;
drop function if exists brochure_ecrire_ligne(jsonb);
commit;
