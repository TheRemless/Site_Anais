-- Gestion : migration 13, langue de l'interface choisie par chaque personne.
-- À exécuter une seule fois sur une base déjà migrée avec migration-12-vouchers.sql, AVANT de publier la nouvelle version de l'outil.
-- Ne modifie aucune donnée existante : ajoute une colonne (vide au départ, l'outil reste alors en français) et une fonction.

begin;

alter table profils add column langue text check (langue in ('fr', 'en'));

-- Chacun change sa propre langue sans pouvoir modifier le reste de son profil (la table reste réservée à l'administratrice).
create or replace function definir_ma_langue(l text) returns void language sql security definer set search_path = public as $$
  update profils set langue = l where user_id = auth.uid() and l in ('fr', 'en')
$$;
revoke all on function definir_ma_langue(text) from public, anon;
grant execute on function definir_ma_langue(text) to authenticated;

commit;
