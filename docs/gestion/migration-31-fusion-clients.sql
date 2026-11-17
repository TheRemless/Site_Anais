-- Gestion : migration 31, fusion de deux fiches client (lot C2 de l'autonomie, 17.11.2026). À appliquer après la migration 30.
-- Le même client saisi deux fois : ses dossiers passent sur la fiche gardée, les champs vides de celle-ci prennent ceux de l'autre,
-- les notes s'ajoutent, puis l'autre fiche est supprimée. Le tout en une transaction, pour ne jamais laisser une fusion à moitié faite.
--
-- Droit : « clients.fusionner » (nouveau), ou à défaut « clients.supprimer » avec « dossiers.ecrire » (les administrateurs actuels
-- peuvent donc fusionner sans toucher aux rôles). La personne doit voir tous les dossiers de l'entreprise : une portée « ses dossiers »
-- déplacerait des dossiers qu'elle ne voit pas.
-- Même règle de reprise des champs que fusionClients (src/gestion/js/dossier-gestes-calc.mjs), utilisée par la démo.
-- Contrôle : docs/gestion/verif-fusion-clients.mjs.

begin;

create or replace function fusionner_clients(p_garder uuid, p_absorbe uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare
  g clients;
  a clients;
  vide constant text := '';
begin
  select * into g from clients where id = p_garder for update;
  select * into a from clients where id = p_absorbe for update;
  if g.id is null or a.id is null or g.id = a.id or g.entite_id <> a.entite_id then
    raise exception 'Fusion impossible : les deux fiches doivent être deux clients différents de la même entreprise';
  end if;
  if not (a_permission(g.entite_id, 'clients.fusionner') or (a_permission(g.entite_id, 'clients.supprimer') and a_permission(g.entite_id, 'dossiers.ecrire'))) then
    raise exception 'Votre rôle ne permet pas de fusionner des clients' using errcode = '42501';
  end if;
  if not voit_tout(g.entite_id) then
    raise exception 'Fusion réservée aux rôles qui voient tous les dossiers de l''entreprise' using errcode = '42501';
  end if;

  update dossiers set client_id = g.id where client_id = a.id;
  -- Un dossier de l'autre fiche resté dans la corbeille pointe désormais vers la fiche gardée : il reste restaurable.
  update corbeille set ligne = jsonb_set(ligne, '{client_id}', to_jsonb(g.id::text))
  where table_name = 'dossiers' and entite_id = g.entite_id and ligne->>'client_id' = a.id::text;

  update clients set
    civilite = case when coalesce(trim(g.civilite), vide) = vide and coalesce(trim(a.civilite), vide) <> vide then a.civilite else g.civilite end,
    prenom = case when coalesce(trim(g.prenom), vide) = vide and coalesce(trim(a.prenom), vide) <> vide then a.prenom else g.prenom end,
    nom = case when coalesce(trim(g.nom), vide) = vide and coalesce(trim(a.nom), vide) <> vide then a.nom else g.nom end,
    telephone = case when coalesce(trim(g.telephone), vide) = vide and coalesce(trim(a.telephone), vide) <> vide then a.telephone else g.telephone end,
    email = case when coalesce(trim(g.email), vide) = vide and coalesce(trim(a.email), vide) <> vide then a.email else g.email end,
    adresse = case when coalesce(trim(g.adresse), vide) = vide and coalesce(trim(a.adresse), vide) <> vide then a.adresse else g.adresse end,
    notes = case
      when coalesce(trim(a.notes), vide) = vide or trim(a.notes) = coalesce(trim(g.notes), vide) then g.notes
      when coalesce(trim(g.notes), vide) = vide then trim(a.notes)
      else trim(g.notes) || E'\n' || trim(a.notes)
    end
  where id = g.id;

  delete from clients where id = a.id;
  return g.id;
end $$;

revoke all on function fusionner_clients(uuid, uuid) from public, anon;
grant execute on function fusionner_clients(uuid, uuid) to authenticated;

commit;
