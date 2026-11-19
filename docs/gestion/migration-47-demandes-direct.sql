-- Gestion : migration 47, demandes du site en direct (demande de Jérémy, 19.11.2026).
-- Une nouvelle demande du site apparaît dans l'outil sans rafraîchir : la table demandes_site entre dans la publication Supabase Realtime.
-- Realtime applique les règles RLS de la table (« lire les demandes du site », migration 30) : chaque personne n'est prévenue que des demandes
-- qu'elle peut lire. L'outil ne se sert de l'événement que pour relire la base avec ses droits, jamais pour en afficher le contenu.
-- Ne modifie aucune donnée. Sans effet sur une base sans Realtime (contrôles PGlite) ou si la table est déjà publiée. Se rejoue sans effet.
-- Retour en arrière : alter publication supabase_realtime drop table public.demandes_site;
-- Contrôle : verif-site.mjs (la migration passe deux fois) et tests/gestion-direct.test.js.

begin;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'demandes_site') then
    alter publication supabase_realtime add table public.demandes_site;
  end if;
end $$;

commit;
