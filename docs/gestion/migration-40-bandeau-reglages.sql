-- Gestion : migration 40, le bandeau du site public ne se change qu'avec le droit « Modifier les réglages de l'entreprise » (reglages.ecrire).
-- Décision de Jérémy du 17.11.2026 : Mook ne change pas les bandeaux. Avant (migration 30) : tout rôle qui écrit les dossiers et voit toute
-- l'entreprise (Secret ou Taxi) créait, modifiait, éteignait ou supprimait un bandeau, donc aussi le rôle de Mook dans Secret.
-- Après : il faut en plus « reglages.ecrire ». Le rôle Administrateur l'a (rôle de départ « Tous les droits », puis tous_droits de la migration 38),
-- l'Éditeur et le rôle de Mook ne l'ont pas. La lecture des bandeaux ne change pas (droit « dossiers.lire »). Le site public (fonction
-- bandeau-site, clé de service) n'est pas concerné.
-- Ne dépend que de la migration 30. Ne modifie aucune donnée. Se rejoue sans erreur.
--
-- À lire avant (lecture seule) : les rôles de Secret et Taxi qui perdent le geste (ils écrivent les dossiers sans « reglages.ecrire »).
--   select e.slug, r.nom, (select count(*) from membres m where m.role_id = r.id) as personnes
--   from roles r join entites e on e.id = r.entite_id
--   where e.slug in ('secret', 'taxi') and 'dossiers.ecrire' = any (r.permissions) and not ('reglages.ecrire' = any (r.permissions))
--     and not coalesce((to_jsonb(r) ->> 'tous_droits')::boolean, false);

begin;

create or replace function publie_sur_le_site(e uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from entites where id = e and slug in ('secret', 'taxi')) and lit_demandes_site(e)
    and a_permission(e, 'dossiers.ecrire') and a_permission(e, 'reglages.ecrire')
$$;
revoke all on function publie_sur_le_site(uuid) from public, anon;
grant execute on function publie_sur_le_site(uuid) to authenticated;

commit;
