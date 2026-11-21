-- Retour en arrière de la migration 72 (demandes du site et conversations WhatsApp reliées).
-- Les liens déjà posés restent : une demande reliée à un dossier reste « confirmee » avec son dossier, une conversation reliée garde son
-- client et son dossier (Nani les change depuis l'écran WhatsApp, comme avant). Seules les deux fonctions et le déclencheur partent.
-- Sans le déclencheur une_fois, une personne peut de nouveau changer le statut ou le dossier d'une demande déjà traitée (règle d'avant :
-- seulement la politique « traiter les demandes du site » de la migration 30).
-- Le code doit revenir aussi : sans les fonctions, l'outil ne relie rien et le dit discrètement (« pas encore en place »).
-- Avant (lecture seule) :
--   select statut, count(*), count(*) filter (where decision ? 'relie') reliees_depuis_un_dossier from demandes_site group by 1;
begin;

drop function if exists whatsapp_relier_apres_demande(uuid);
drop function if exists demande_site_relier(uuid, uuid);
drop trigger if exists une_fois on demandes_site;
drop function if exists demandes_site_une_fois();
drop function if exists cle_telephone(text);

commit;
