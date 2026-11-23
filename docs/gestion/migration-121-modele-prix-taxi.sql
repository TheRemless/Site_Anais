-- Gestion : migration 121 (23.11.2026), le modèle de réponse de prix de VIP Taxi Lanta reconnu par l'Assistant.
-- À exécuter une seule fois, après le déploiement des fonctions agent et whatsapp de la même PR. Idempotente. Ne touche que l'entité Taxi.
-- Retour en arrière : remettre "cle": null sur ce seul message (requête en bas, en commentaire).
--
-- Le texte type « Price quote (private transfer) » (id perso-mwrcry7e), écrit par Jérémy dans l'écran Messages, n'avait pas d'usage
-- (cle null) : l'Assistant ne pouvait pas le reconnaître. Il reçoit l'usage « prix » (« Réponse de prix (Assistant) » à l'écran), que Nani
-- peut changer ou retirer elle-même. Son texte, son titre et sa langue ne changent pas. Un usage déjà choisi n'est jamais remplacé.
-- À relire avant (lecture seule) :
--   select m from reglages r, jsonb_array_elements(r.valeur -> 'messages') m
--   where r.entite_id = '00000000-0000-4000-8000-000000000003' and m ->> 'id' = 'perso-mwrcry7e';

begin;

update reglages r
set valeur = jsonb_set(r.valeur, '{messages}', (
      select jsonb_agg(case when m ->> 'id' = 'perso-mwrcry7e' and coalesce(m ->> 'cle', '') = ''
                            then m || '{"cle": "prix"}'::jsonb || case when coalesce(m ->> 'pour', '') = '' then '{"pour": "client"}'::jsonb else '{}'::jsonb end
                            else m end order by i)
      from jsonb_array_elements(r.valeur -> 'messages') with ordinality as t(m, i))),
    updated_at = now()
where r.entite_id = '00000000-0000-4000-8000-000000000003'
  and jsonb_typeof(r.valeur -> 'messages') = 'array'
  and exists (select 1 from jsonb_array_elements(r.valeur -> 'messages') m where m ->> 'id' = 'perso-mwrcry7e' and coalesce(m ->> 'cle', '') = '');

commit;

-- Retour en arrière :
-- update reglages r set valeur = jsonb_set(r.valeur, '{messages}', (select jsonb_agg(case when m ->> 'id' = 'perso-mwrcry7e' and m ->> 'cle' = 'prix'
--   then m || '{"cle": null}'::jsonb else m end order by i) from jsonb_array_elements(r.valeur -> 'messages') with ordinality as t(m, i))), updated_at = now()
-- where r.entite_id = '00000000-0000-4000-8000-000000000003';
