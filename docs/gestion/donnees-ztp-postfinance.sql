-- Gestion : ajoute « PostFinance » aux moyens de paiement de Zwald Travel Planner (12.11.2026), à la demande de Jérémy.
-- Réglages seulement : insère le moyen juste après TWINT et ne touche à rien d'autre (ni les autres moyens, ni les paiements déjà saisis).
-- Idempotent : sans effet si PostFinance figure déjà dans la liste. Les autres entreprises gardent leur liste.

begin;

update reglages r
set valeur = jsonb_set(
      r.valeur, '{listes,moyens}',
      (select jsonb_agg(s.m order by s.o)
         from (
           select t.m, t.ord * 2 as o from jsonb_array_elements(r.valeur->'listes'->'moyens') with ordinality as t(m, ord)
           union all
           select '{"id": "postfinance", "label": "PostFinance"}'::jsonb,
                  coalesce((select t2.ord * 2 + 1 from jsonb_array_elements(r.valeur->'listes'->'moyens') with ordinality as t2(m, ord) where t2.m->>'id' = 'twint'), 1000000)
         ) s)
    )
from entites e
where e.id = r.entite_id and e.slug = 'ztp'
  and jsonb_typeof(r.valeur->'listes'->'moyens') = 'array'
  and not exists (select 1 from jsonb_array_elements(r.valeur->'listes'->'moyens') x where x->>'id' = 'postfinance');

commit;
