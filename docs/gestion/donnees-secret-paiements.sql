-- Gestion : réglage des partenaires de Secret Travel & Tour (11.11.2026), à la demande de Jérémy.
-- Données seulement, aucune structure : exécutable plusieurs fois avec le même résultat.
--
-- 1. Mode de règlement par défaut : « sur place » pour tous les partenaires de Secret, sauf les deux compagnies de speedboat
--    (Bundhaya et Satun Pakbara) dont les transferts se paient à l'avance : elles restent « chez nous » (aucune valeur).
--    La clé est fusionnée dans `regles` : les autres règles du partenaire (annulation, enfants, check-in…) ne bougent pas.
-- 2. Règle de commission chiffrée (données privées) :
--      « prix de vente moins net » : Longtail, Rattana, ATV, Éléphants, E-GoKart, Noom, Sukho (leur net est en base) ;
--      10 % du prix de vente : VIP Taxi Lanta (marge de 10 % en attendant un accord) ;
--      aucune règle : Mr. Nan Taxi (aucune commission prévue), Bundhaya et Satun (chez nous), Lacha Ru Tour (pas de net en base).

begin;

update partenaires p
set regles = coalesce(p.regles, '{}'::jsonb) || '{"mode_reglement": "sur_place"}'::jsonb
from entites e
where e.id = p.entite_id
  and e.nom = 'Secret Travel & Tour'
  and p.nom not in ('Bundhaya Speed Boat', 'Satun Pakbara Speed Boat Club');

insert into partenaires_prives (entite_id, partenaire_id, commission_regle)
select p.entite_id, p.id, '{"type": "vente_moins_net"}'::jsonb
from partenaires p join entites e on e.id = p.entite_id
where e.nom = 'Secret Travel & Tour'
  and p.nom in ('Lanta Longtail Tour', 'Rattana Island Tour', 'Lanta ATV Adventure', 'Lanta Elephant Sanctuary', 'Lanta E-GoKart', 'Noom Rental', 'Sukho Cuisine Thai Cooking School')
on conflict (partenaire_id) do update set commission_regle = excluded.commission_regle;

insert into partenaires_prives (entite_id, partenaire_id, commission_regle)
select p.entite_id, p.id, '{"type": "pourcent_vente", "valeur": 10}'::jsonb
from partenaires p join entites e on e.id = p.entite_id
where e.nom = 'Secret Travel & Tour' and p.nom = 'VIP Taxi Lanta'
on conflict (partenaire_id) do update set commission_regle = excluded.commission_regle;

commit;
