-- Gestion : migration 26, « Carnet envoyé ».
-- À exécuter une seule fois. N'efface ni ne modifie aucune donnée : ajoute une colonne vide sur les dossiers.
-- Les conditions disent que le solde est à verser à la réception du carnet de voyage. Un bouton sur la fiche dossier note la date d'envoi du carnet :
-- le solde devient dû à cette date (il passe dans « À faire »). Sans date, l'ancienne règle reste (solde relevé 30 jours avant le départ).
-- Tant que cette migration n'est pas appliquée, l'outil ne propose pas le bouton (il détecte l'absence de la colonne).

begin;

alter table dossiers add column if not exists carnet_envoye_le date;

commit;
