-- Gestion : migration 33, droit « partenaires.supprimer » (lot A de l'audit d'autonomie, 17.11.2026).
-- À appliquer après la migration 32.
--
-- Avant : « partenaires.ecrire » suffisait pour supprimer un partenaire, une prestation ou un trajet. Supprimer un partenaire efface en cascade
-- ses tarifs, ses trajets et leurs nets, et vide le partenaire des réservations (vouchers sans opérateur, commissions Taxi sans destinataire).
-- Mook (rôle « Éditeur + factures fiduciaire » dans Secret) pouvait le faire. Décision de Jérémy du 17.11.2026 : elle ne le peut plus.
--
-- Après :
--   * un nouveau droit « partenaires.supprimer », exigé EN PLUS de « partenaires.ecrire » pour supprimer (politique restrictive, combinée en ET
--     avec la politique « modifier les … » existante) ;
--   * il entre dans « tous les droits » (administrateurs généraux) et dans le rôle « Administrateur » de chaque entreprise, et dans aucun autre rôle :
--     l'Éditeur et « Éditeur + factures fiduciaire » gardent la modification et le masquage, plus la suppression ;
--   * l'outil refuse en plus de supprimer un élément qu'un service utilise et propose de le masquer. Ce refus n'est pas posé en base : l'import
--     « Remplacer la base partenaires » (Réglages, Sauvegarde) retire volontairement ce que le fichier ne contient plus, après un avertissement chiffré.
--
-- À exécuter une seule fois, quand on veut, avant ou après la mise en ligne de l'outil : sans elle, l'outil masque déjà le bouton « Supprimer »
-- à qui n'a pas le droit, mais la base laisse encore supprimer avec « partenaires.ecrire ». Ne modifie aucune donnée, sauf les droits des rôles « Administrateur ».

begin;

create or replace function toutes_permissions() returns text[] language sql immutable as $$
  select array['clients.lire', 'clients.ecrire', 'clients.supprimer', 'dossiers.lire', 'dossiers.ecrire', 'dossiers.supprimer', 'documents.ecrire', 'documents.supprimer', 'finances.voir', 'paiements.ecrire', 'taches.ecrire', 'catalogue.ecrire', 'reglages.ecrire', 'exports.faire', 'analytics.voir', 'journal.voir', 'partenaires.lire', 'partenaires.ecrire', 'partenaires.nets', 'partenaires.supprimer', 'fiduciaire.preparer', 'fiduciaire.gerer']::text[]
$$;

update roles set permissions = permissions || array['partenaires.supprimer']
where nom = 'Administrateur' and not ('partenaires.supprimer' = any (permissions));

drop policy if exists "supprimer les partenaires" on partenaires;
drop policy if exists "supprimer les prestations" on prestations;
drop policy if exists "supprimer les trajets" on trajets;
create policy "supprimer les partenaires" on partenaires as restrictive for delete to authenticated using (a_permission(entite_id, 'partenaires.supprimer'));
create policy "supprimer les prestations" on prestations as restrictive for delete to authenticated using (a_permission(entite_id, 'partenaires.supprimer'));
create policy "supprimer les trajets" on trajets as restrictive for delete to authenticated using (a_permission(entite_id, 'partenaires.supprimer'));

commit;
