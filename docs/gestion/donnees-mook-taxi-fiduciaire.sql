-- VIP Taxi Lanta (12.11.2026) : les factures pour la fiduciaire sont aussi le travail de Mook, l'assistante d'Anaïs (décision de Jérémy).
-- Son rôle de Taxi (« Vouchers seulement », donnees-taxi-vouchers.sql) ne voyait que les dossiers qu'elle avait créés : elle n'aurait préparé
-- les factures que de ses propres courses. Il voit maintenant toutes les courses de Taxi (portée « toute ») et change de nom pour dire ce qu'il fait.
-- Rien d'autre ne change : toujours « vouchers.seul » (l'écran voucher, plus l'onglet des factures), jamais les nets ni « fiduciaire.gerer ».
-- L'écran voucher continue de ne lister que les vouchers qu'elle a créés (voucher-rapide-calc.mjs, filtre sur cree_par).
-- Idempotent. À lancer avec l'accord de Jérémy.
begin;

update roles
set nom = 'Vouchers et factures fiduciaire',
    portee = 'toute',
    description = 'En thaï : l''écran « Nouveau voucher » et les factures pour la fiduciaire de toutes les courses de Taxi (jamais les nets). Ni menu, ni autres écrans.',
    permissions = (select array_agg(distinct p) from unnest(permissions || array['fiduciaire.preparer']) p)
where entite_id = '00000000-0000-4000-8000-000000000003' and nom in ('Vouchers seulement', 'Vouchers et factures fiduciaire');

-- Contrôle : les rôles de Mook dans Secret et Taxi.
select e.nom as entreprise, r.nom as role, r.portee, 'fiduciaire.preparer' = any (r.permissions) as preparer,
       'fiduciaire.gerer' = any (r.permissions) as gerer, 'partenaires.nets' = any (r.permissions) as nets, 'vouchers.seul' = any (r.permissions) as voucher_seul
from membres m join roles r on r.id = m.role_id join entites e on e.id = m.entite_id
where m.user_id = '15c43035-de4b-4263-b3fa-5223b04a2234'
order by e.nom;

commit;
