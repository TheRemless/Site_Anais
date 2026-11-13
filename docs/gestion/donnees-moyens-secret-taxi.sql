-- Secret Travel & Tour et VIP Taxi Lanta : moyens de paiement propres à chaque entreprise (audit des parcours du 13.11.2026, point 11).
-- En base le 13.11.2026 (lecture seule) : Secret et Taxi avaient la liste de ZTP, Virement en premier et TWINT proposé.
-- Ce script retire TWINT et PostFinance et met Espèces en tête (choix par défaut d'un nouveau paiement), sans toucher aux noms
-- enregistrés (« Cash », « Bank transfer »…) ni à l'ordre des autres moyens. Aucun paiement de Secret ou Taxi n'utilise TWINT ou
-- PostFinance (relevé du 13.11.2026). ZTP n'est pas touché. Idempotent : le relancer ne change plus rien.
begin;
update reglages r set valeur = jsonb_set(r.valeur, '{listes,moyens}', (
  select coalesce(jsonb_agg(m order by (m->>'id') <> 'especes', o), '[]'::jsonb)
  from jsonb_array_elements(r.valeur->'listes'->'moyens') with ordinality as t(m, o)
  where m->>'id' not in ('twint', 'postfinance')
)), updated_at = now()
from entites e
where e.id = r.entite_id and e.slug in ('secret', 'taxi') and jsonb_typeof(r.valeur->'listes'->'moyens') = 'array';

-- Contrôle : Espèces d'abord, ni TWINT ni PostFinance pour Secret et Taxi ; ZTP inchangé.
select e.slug, (select string_agg(m->>'id', ', ' order by o) from jsonb_array_elements(r.valeur->'listes'->'moyens') with ordinality as t(m, o)) as moyens
from reglages r join entites e on e.id = r.entite_id order by e.ordre;
commit;
