-- Gestion : les trois lignes « Personne supplémentaire » de Lacha Ru Tour (programmes A, B et C) passent à l'unité « par personne supplémentaire » (code `sup`).
-- Avant : unité « par adulte », donc 3 adultes donnaient 3 × 1 500 au lieu de 1 × 1 500. Après : la quantité proposée est le nombre de personnes au-delà des deux premières.
-- Données seulement, aucun prix, net, libellé ni autre ligne touchés. Idempotente : relancée, elle ne change plus rien.
-- À appliquer APRÈS l'écriture des lignes Lacha Ru par la session E et après l'accord explicite de Jérémy.

begin;

update prestations p
set unite = 'sup'
from partenaires pa
where pa.id = p.partenaire_id
  and pa.nom = 'Lacha Ru Tour'
  and p.libelle like '%Personne supplémentaire%'
  and p.unite <> 'sup';

commit;
