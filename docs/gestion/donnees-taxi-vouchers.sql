-- VIP Taxi Lanta (12.11.2026) : l'assistante d'Anaïs (Mook) n'a, dans Taxi, que l'écran « Nouveau voucher » en thaï.
-- Idempotent : relancer donne le même résultat. Rien n'est supprimé. Ses droits dans Secret ne changent pas.
-- Le rôle ne voit que les dossiers créés par la personne (portée « mes_dossiers ») : ni les autres courses, ni leurs prix,
-- ni nets, ni commissions (pas de « partenaires.nets »), ni réglages. « vouchers.seul » réduit l'interface à l'écran unique.
begin;

-- 1. Le rôle, dans Taxi. Il se modifie ensuite dans Administration, Rôles.
insert into roles (entite_id, nom, description, portee, permissions, systeme)
values (
  '00000000-0000-4000-8000-000000000003',
  'Vouchers seulement',
  'L''écran « Nouveau voucher » en thaï, rien d''autre. Ne voit que les dossiers qu''elle a créés.',
  'mes_dossiers',
  array['clients.lire', 'clients.ecrire', 'dossiers.lire', 'dossiers.ecrire', 'documents.ecrire', 'finances.voir', 'partenaires.lire', 'vouchers.seul'],
  false
)
on conflict (entite_id, nom) do update set description = excluded.description, portee = excluded.portee, permissions = excluded.permissions;

-- 2. Mook (profil 15c43035…) passe d'Éditeur à ce rôle dans Taxi seulement.
update membres set role_id = (select id from roles where entite_id = '00000000-0000-4000-8000-000000000003' and nom = 'Vouchers seulement')
where user_id = '15c43035-de4b-4263-b3fa-5223b04a2234' and entite_id = '00000000-0000-4000-8000-000000000003';

-- Contrôle : ses rôles dans les deux entreprises.
select e.nom as entreprise, r.nom as role, r.portee, r.permissions
from membres m join roles r on r.id = m.role_id join entites e on e.id = m.entite_id
where m.user_id = '15c43035-de4b-4263-b3fa-5223b04a2234'
order by e.nom;
commit;
