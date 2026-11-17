-- Gestion : migration 41, le numéro WhatsApp du client dans les demandes du site (17.11.2026).
-- Jérémy : des visiteurs remplissent la feuille du site mais leur message WhatsApp n'arrive jamais (4 demandes le 17.11, 2 sans message).
-- La feuille demandera désormais le numéro WhatsApp et le nom complet (prénom et nom). Gestion garde le numéro avec la demande : Anaïs écrit
-- elle-même au client depuis la boîte (« Écrire sur WhatsApp » ouvre sa conversation avec la réponse prête), rien ne part tout seul.
--
-- À exécuter une seule fois, AVANT de redéployer la fonction « demande-site » (qui écrit ces colonnes) et AVANT que le site envoie le champ.
-- Ne dépend que de la migration 30. Ne modifie aucune donnée existante. Se rejoue sans erreur.
--
--   * telephone : le numéro au format international E.164 (« + » puis 8 à 15 chiffres, sans espace), mis en forme par la fonction.
--   * telephone_saisi : ce que le visiteur a tapé, gardé seulement quand la fonction n'a pas pu en tirer un numéro E.164 (indicatif
--     manquant, chiffres en trop) ; la demande n'est jamais perdue pour un numéro mal tapé, Anaïs voit ce qui a été saisi.
--   * nom : reçoit maintenant le nom complet, la limite passe de 100 à 120 caractères.
-- Les règles de la migration 30 s'appliquent sans rien changer : ces colonnes ne sont lues que par les rôles qui voient tous les dossiers
-- de l'entreprise (lit_demandes_site), personne ne les modifie (le déclencheur « figer » compare toute la ligne, et l'outil ne peut écrire que
-- statut, dossier_id et decision), et le journal ne note que le traitement (le numéro n'y entre jamais).

begin;

alter table demandes_site add column if not exists telephone text;
alter table demandes_site add column if not exists telephone_saisi text;
alter table demandes_site drop constraint if exists demandes_site_telephone_check;
alter table demandes_site add constraint demandes_site_telephone_check check (telephone is null or telephone ~ '^\+[1-9][0-9]{7,14}$');
alter table demandes_site drop constraint if exists demandes_site_telephone_saisi_check;
alter table demandes_site add constraint demandes_site_telephone_saisi_check check (telephone_saisi is null or (telephone is null and length(telephone_saisi) between 1 and 40));
alter table demandes_site drop constraint if exists demandes_site_nom_check;
alter table demandes_site add constraint demandes_site_nom_check check (length(nom) <= 120);

commit;
