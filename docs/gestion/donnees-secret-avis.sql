-- Gestion : lien d'avis Google de Secret Travel & Tour et message « avis » en anglais (12.11.2026), à la demande de Jérémy.
-- Données seulement : exécutable plusieurs fois avec le même résultat. Ne change que `emetteur.lien_avis` et le texte du message anglais « avis »
-- (la phrase d'origine est remplacée par une phrase qui porte la variable {lien_avis}). Un message déjà modifié à la main, ou déjà à jour, n'est pas touché.

begin;

update reglages r
set valeur = jsonb_set(
      jsonb_set(r.valeur, '{emetteur,lien_avis}', to_jsonb('https://g.page/r/CQ-RKycvZ7OCEAI/review'::text), true),
      '{messages}',
      (select jsonb_agg(
                case when m->>'id' = 'avis-en' and position('{lien_avis}' in m->>'corps') = 0
                     then jsonb_set(m, '{corps}', to_jsonb(replace(m->>'corps', 'A short online review would help us a lot, thank you in advance!', E'A short Google review would help us a lot:\n{lien_avis}\nThank you in advance!')))
                     else m end
                order by ord)
         from jsonb_array_elements(r.valeur->'messages') with ordinality as t(m, ord))
    ),
    updated_at = now()
from entites e
where e.id = r.entite_id and e.nom = 'Secret Travel & Tour' and jsonb_typeof(r.valeur->'messages') = 'array';

commit;
