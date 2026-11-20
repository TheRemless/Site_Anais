-- Migration 53 (20.11.2026) : l'agent de l'onglet « Assistant » situe les lieux et calcule les durées avec Google Maps (décision de Jérémy du
-- 20.11.2026, après le test des 48 lieux de pickup réels : OpenStreetMap n'en situe qu'une vingtaine, et Nominatim comme Photon refusent
-- les serveurs de Supabase). Les caches gardent l'origine « google » : la fonction ne relit ces lignes que 30 jours (conditions de Google).
-- Idempotente, sans perte de donnée. À appliquer après une sauvegarde forcée, avec le oui de Jérémy.

alter table lieux_geo drop constraint if exists lieux_geo_origine_check;
alter table lieux_geo add constraint lieux_geo_origine_check check (origine in ('ors', 'nominatim', 'saisie', 'google'));

alter table trajets_ors drop constraint if exists trajets_ors_moteur_check;
alter table trajets_ors add constraint trajets_ors_moteur_check check (moteur in ('ors', 'osrm', 'google'));

-- Les lignes de Google de plus de 30 jours ne sont jamais relues (la fonction les recalcule et les réécrit) ; celles-ci les effacent.
create or replace function purger_google_agent() returns void language sql security invoker set search_path = public as $$
  delete from lieux_geo where origine = 'google' and maj_le < now() - interval '30 days';
  delete from trajets_ors where moteur = 'google' and maj_le < now() - interval '30 days';
$$;
revoke all on function purger_google_agent() from public, anon;
grant execute on function purger_google_agent() to authenticated;
