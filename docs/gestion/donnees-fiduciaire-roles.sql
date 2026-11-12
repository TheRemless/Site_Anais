-- Droits des factures pour la fiduciaire (12.11.2026). À lancer APRÈS migration-28-fiduciaire.sql, avec l'accord de Jérémy.
-- Idempotent : relancer donne le même résultat. Rien n'est supprimé ; un rôle existant n'est jamais réduit.
--
-- Deux droits (migration 28) :
--   fiduciaire.preparer : voir ce qui revient à l'agence (jamais un net), émettre une facture, la télécharger, la marquer envoyée à la fiduciaire ;
--   fiduciaire.gerer    : en plus, émettre un avoir, retirer la mention « envoyée », revoir le calcul (avec les nets, il faut aussi « partenaires.nets »).
--
-- Périmètre : comme pour les dossiers, un rôle « mes dossiers » ne voit que les services de ses dossiers (créés par la personne ou dont elle est responsable).
-- Limite connue : le montant d'une facture « chez nous » est la marge ; avec le prix de vente de la réservation, qu'un rôle qui voit les dossiers lit déjà,
-- on peut en déduire le net payé au prestataire. Pour l'éviter, ne donner « fiduciaire.preparer » qu'à des rôles qui voient déjà les nets, ou réserver ces factures à « gérer ».
--
-- 1. Administrateur de Secret et de Taxi : les deux droits (les administrateurs généraux les ont déjà avec la migration).
-- 2. Mook (assistante d'Anaïs, profil 15c43035…) : dans Secret, un rôle « Éditeur + factures fiduciaire » = exactement les droits de l'Éditeur plus
--    « fiduciaire.preparer ». Elle n'a ni « partenaires.nets » ni « fiduciaire.gerer ».
-- 3. Dans Taxi : si le rôle « Vouchers seulement » existe (donnees-taxi-vouchers.sql), il reçoit « fiduciaire.preparer » ; sinon Mook, encore Éditeur de Taxi,
--    passe au même rôle « Éditeur + factures fiduciaire » dans Taxi. Les factures de Taxi se préparent depuis l'écran Fiduciaire de Secret.
begin;

update roles set permissions = permissions || array['fiduciaire.preparer', 'fiduciaire.gerer']
where nom = 'Administrateur' and entite_id in ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003')
  and not ('fiduciaire.gerer' = any (permissions));

insert into roles (entite_id, nom, description, portee, permissions, systeme)
select e.id, 'Éditeur + factures fiduciaire', 'Les droits de l''Éditeur, plus la préparation et l''envoi des factures pour la fiduciaire (montants qui reviennent à l''agence, jamais les nets).',
       r.portee, (select array_agg(distinct p) from unnest(r.permissions || array['fiduciaire.preparer']) p), false
from entites e join roles r on r.entite_id = e.id and r.nom = 'Éditeur'
where e.slug in ('secret', 'taxi')
on conflict (entite_id, nom) do update set permissions = excluded.permissions, portee = excluded.portee, description = excluded.description;

-- Mook passe de « Éditeur » à ce rôle, dans Secret et dans Taxi seulement si elle y est encore Éditeur.
update membres m set role_id = n.id
from roles n, roles ancien
where m.user_id = '15c43035-de4b-4263-b3fa-5223b04a2234'
  and ancien.id = m.role_id and ancien.nom = 'Éditeur'
  and n.entite_id = m.entite_id and n.nom = 'Éditeur + factures fiduciaire';

-- Taxi : le rôle « Vouchers seulement », s'il existe, reçoit le droit de préparer (pas de gérer).
update roles set permissions = permissions || array['fiduciaire.preparer']
where nom = 'Vouchers seulement' and entite_id = '00000000-0000-4000-8000-000000000003' and not ('fiduciaire.preparer' = any (permissions));

-- Contrôle : droits fiduciaire de chaque personne dans Secret et Taxi.
select e.nom as entreprise, coalesce(p.nom, p.email) as personne, r.nom as role,
       'fiduciaire.preparer' = any (r.permissions) as preparer, 'fiduciaire.gerer' = any (r.permissions) as gerer, 'partenaires.nets' = any (r.permissions) as nets
from membres m join roles r on r.id = m.role_id join entites e on e.id = m.entite_id join profils p on p.user_id = m.user_id
where e.slug in ('secret', 'taxi')
order by e.nom, personne;

commit;
