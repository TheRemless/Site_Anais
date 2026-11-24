-- Gestion : migration 125 (24.11.2026), bandeau du site jusqu'à 600 caractères (Jérémy : 140 ne suffisent pas).
-- À exécuter une seule fois, APRÈS la migration 30 (table bandeaux_site), et AVANT de publier la version de Gestion qui écrit des
-- textes de plus de 140 caractères. Le site secrettravelandtour.com doit déjà savoir replier un texte long (« More », PR du site) :
-- ordre de mise en ligne : cette migration, puis le site, puis Gestion. Idempotente. Ne modifie aucune donnée existante.
--
-- 1. bandeaux_site.texte : de 1 à 600 caractères (avant : 140). Les retours à la ligne sont permis ; le site les garde.
-- 2. bandeaux_site.valeurs : 2500 caractères au plus (avant : 1000). Le texte libre y est copié (valeurs.texte) avec les autres choix
--    du modèle ; en JSON, un retour à la ligne ou un guillemet compte double, 600 caractères peuvent donc en prendre 1200.
-- Les deux contraintes gardent leur nom d'origine (contraintes de colonne de la migration 30).
--
-- À lire avant (lecture seule) : les contraintes en place et le plus long texte enregistré.
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'bandeaux_site'::regclass and conname in ('bandeaux_site_texte_check', 'bandeaux_site_valeurs_check');
--   select max(length(texte)) as texte_max, max(length(valeurs::text)) as valeurs_max from bandeaux_site;
--
-- Retour en arrière (seulement si aucun texte ne dépasse 140 caractères ni aucune valeur 1000) :
--   alter table bandeaux_site drop constraint bandeaux_site_texte_check,
--     add constraint bandeaux_site_texte_check check (length(texte) between 1 and 140);
--   alter table bandeaux_site drop constraint bandeaux_site_valeurs_check,
--     add constraint bandeaux_site_valeurs_check check (jsonb_typeof(valeurs) = 'object' and length(valeurs::text) <= 1000);

begin;

alter table bandeaux_site drop constraint if exists bandeaux_site_texte_check;
alter table bandeaux_site add constraint bandeaux_site_texte_check check (length(texte) between 1 and 600);

alter table bandeaux_site drop constraint if exists bandeaux_site_valeurs_check;
alter table bandeaux_site add constraint bandeaux_site_valeurs_check check (jsonb_typeof(valeurs) = 'object' and length(valeurs::text) <= 2500);

commit;
