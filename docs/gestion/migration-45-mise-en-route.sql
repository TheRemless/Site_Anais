-- Gestion : migration 45, mise en route d'un client du logiciel (18.11.2026).
-- Pendant l'appel de mise en route, l'éditeur (profils.plateforme) crée l'organisation et son administrateur (fonction « invitation »,
-- action creer_client, qui appelle creer_organisation), puis installe sa première entreprise prête à servir : installer_entreprise.
--
-- Les données de départ (réglages, messages types, moyens de paiement, rôles, catalogue d'exemple) viennent d'un modèle métier
-- (src/gestion/js/modeles-metier.mjs, departModele) : la même source sert à la démo et à la base. Elles sont en anglais, sans rien
-- de Zwald Travel Planner. La base ne fait que contrôler et écrire.
--
-- Garde-fous :
--   * réservé à l'éditeur ;
--   * seulement dans une organisation qui n'a encore aucune entreprise : l'éditeur n'écrit jamais chez un client déjà en service,
--     ni chez Zwald ;
--   * rôles limités aux permissions connues, catalogue limité à 100 lignes, réglages limités à 200 ko.
-- Après la mise en route, l'éditeur ne voit toujours aucune donnée du client (les politiques des tables ne changent pas).
-- À exécuter une seule fois, après la migration 42. Idempotente.

begin;

create or replace function installer_entreprise(
  p_organisation uuid,
  p_nom text,
  p_slug text,
  p_reglages jsonb,
  p_roles jsonb,
  p_catalogue jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  e uuid;
  r jsonb;
  c jsonb;
  i integer := 0;
begin
  if not est_plateforme() then raise exception 'Réservé à l''éditeur du logiciel' using errcode = '42501'; end if;
  -- Verrou sur l'organisation : deux installations lancées en même temps (double clic, deux onglets) passent l'une après l'autre.
  perform 1 from organisations where id = p_organisation for update;
  if not found then raise exception 'Organisation inconnue' using errcode = '22023'; end if;
  if exists (select 1 from entites where organisation_id = p_organisation) then
    raise exception 'Cette organisation a déjà une entreprise : son administrateur règle la suite' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_nom, ''))) not between 1 and 120 then raise exception 'Nom d''entreprise invalide' using errcode = '22023'; end if;
  if coalesce(p_slug, '') !~ '^[a-z0-9-]{1,40}$' then raise exception 'Code court invalide' using errcode = '22023'; end if;
  if jsonb_typeof(p_reglages) is distinct from 'object' or octet_length(p_reglages::text) > 200000 then raise exception 'Réglages invalides' using errcode = '22023'; end if;
  if jsonb_typeof(p_roles) is distinct from 'array' or jsonb_array_length(p_roles) not between 1 and 10 then raise exception 'Rôles invalides' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_catalogue, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_catalogue, '[]'::jsonb)) > 100 then raise exception 'Catalogue invalide' using errcode = '22023'; end if;
  -- Le premier rôle est l'Administrateur « tous droits » : l'administrateur du client a déjà tout par son organisation, ce rôle sert à ses collègues.
  if not coalesce((p_roles->0->>'tous_droits')::boolean, false) then raise exception 'Le premier rôle doit être l''Administrateur' using errcode = '22023'; end if;

  insert into entites (nom, slug, actif, ordre, organisation_id) values (trim(p_nom), p_slug, true, 1, p_organisation) returning id into e;
  insert into reglages (entite_id, valeur) values (e, p_reglages);

  for r in select * from jsonb_array_elements(p_roles) loop
    if length(coalesce(r->>'nom', '')) not between 1 and 80
      or coalesce(r->>'portee', '') not in ('toute', 'mes_dossiers')
      or jsonb_typeof(r->'permissions') is distinct from 'array'
      or not (array(select jsonb_array_elements_text(r->'permissions')) <@ toutes_permissions()) then
      raise exception 'Rôle invalide : %', coalesce(r->>'nom', '?') using errcode = '22023';
    end if;
    insert into roles (entite_id, nom, description, portee, permissions, systeme, tous_droits)
    values (e, r->>'nom', left(coalesce(r->>'description', ''), 300), r->>'portee', array(select jsonb_array_elements_text(r->'permissions')), true, coalesce((r->>'tous_droits')::boolean, false));
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p_catalogue, '[]'::jsonb)) loop
    i := i + 1;
    if coalesce(c->>'kind', '') not in ('formule', 'region', 'supplement') or length(coalesce(c->>'libelle', '')) not between 1 and 200 then
      raise exception 'Ligne de catalogue invalide' using errcode = '22023';
    end if;
    insert into catalogue (entite_id, kind, libelle, intro, puces, prix, ordre)
    values (e, c->>'kind', c->>'libelle', left(coalesce(c->>'intro', ''), 300),
      case when jsonb_typeof(c->'puces') = 'array' then c->'puces' else '[]'::jsonb end,
      nullif(c->>'prix', '')::numeric, i);
  end loop;

  insert into journal (entite_id, organisation_id, user_id, table_name, action, cible, libelle, details)
  values (null, p_organisation, auth.uid(), 'organisations', 'installer', e::text, trim(p_nom), jsonb_build_object('fonctionnement', p_reglages->>'fonctionnement', 'devise', p_reglages->>'devise'));
  return e;
end
$$;
revoke all on function installer_entreprise(uuid, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function installer_entreprise(uuid, text, text, jsonb, jsonb, jsonb) to authenticated;

commit;
