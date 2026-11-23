-- Gestion : migration 122 (23.11.2026), plus de signature dans la voix de l'Assistant de VIP Taxi Lanta ni dans « Reply to a request ».
-- Jérémy, 19.11.2026 : les messages aux clients de Secret et de Taxi ne portent aucune signature. Idempotente. Ne touche que l'entité Taxi.
--
-- 1. assistant_voix.en perd « , then "Have a nice day, {entreprise}" » et assistant_voix.fr perd « , puis « Belle journée, {entreprise} » ».
--    Le reste de la voix ne change pas (la phrase finit sur l'invitation à répondre ici).
-- 2. Le texte type « Reply to a request » (id reponse-en) perd sa dernière ligne « {entreprise} », qui y faisait office de signature.
-- La migration 44 (historique) n'est pas modifiée : elle n'écrit une voix que là où il n'y en a pas.
-- À relire avant (lecture seule) :
--   select r.valeur #> '{assistant_voix,en}', r.valeur #> '{assistant_voix,fr}',
--          (select m ->> 'corps' from jsonb_array_elements(r.valeur -> 'messages') m where m ->> 'id' = 'reponse-en')
--   from reglages r where r.entite_id = '00000000-0000-4000-8000-000000000003';

begin;

update reglages r
set valeur = jsonb_set(r.valeur, '{assistant_voix}', (r.valeur -> 'assistant_voix')
      || case when r.valeur #>> '{assistant_voix,en}' is not null
              then jsonb_build_object('en', replace(r.valeur #>> '{assistant_voix,en}', ', then "Have a nice day, {entreprise}"', '')) else '{}'::jsonb end
      || case when r.valeur #>> '{assistant_voix,fr}' is not null
              then jsonb_build_object('fr', replace(r.valeur #>> '{assistant_voix,fr}', ', puis « Belle journée, {entreprise} »', '')) else '{}'::jsonb end),
    updated_at = now()
where r.entite_id = '00000000-0000-4000-8000-000000000003'
  and jsonb_typeof(r.valeur -> 'assistant_voix') = 'object'
  and (strpos(coalesce(r.valeur #>> '{assistant_voix,en}', ''), ', then "Have a nice day, {entreprise}"') > 0
       or strpos(coalesce(r.valeur #>> '{assistant_voix,fr}', ''), ', puis « Belle journée, {entreprise} »') > 0);

update reglages r
set valeur = jsonb_set(r.valeur, '{messages}', (
      select jsonb_agg(case when m ->> 'id' = 'reponse-en' and m ->> 'corps' ~ '\n\{entreprise\}\s*$'
                            then jsonb_set(m, '{corps}', to_jsonb(regexp_replace(m ->> 'corps', '\n\{entreprise\}\s*$', '')))
                            else m end order by i)
      from jsonb_array_elements(r.valeur -> 'messages') with ordinality as t(m, i))),
    updated_at = now()
where r.entite_id = '00000000-0000-4000-8000-000000000003'
  and jsonb_typeof(r.valeur -> 'messages') = 'array'
  and exists (select 1 from jsonb_array_elements(r.valeur -> 'messages') m where m ->> 'id' = 'reponse-en' and m ->> 'corps' ~ '\n\{entreprise\}\s*$');

commit;
