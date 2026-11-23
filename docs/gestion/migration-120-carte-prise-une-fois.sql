-- Gestion : migration 120 (23.11.2026), une carte de l'Assistant ne se valide qu'une fois.
-- À exécuter une seule fois, APRÈS la migration 119 (et la 52). Idempotente. Ne modifie aucune donnée existante.
-- Retour en arrière : retour-120-carte-prise-une-fois.sql.
--
-- INV-2026-046 et INV-2026-047 (23.11.2026, 06:12:52 et 06:12:55 UTC) : la même carte « dossier » de l'Assistant a créé deux dossiers. Le bouton
-- « Créer le dossier » restait actif pendant les quatre secondes d'enregistrement (client, dossier, facture, réservation) et la carte ne
-- passait « validée » qu'à la fin : un second tap a tout refait. L'écran a désormais son verrou ; la base garde la règle pour un second onglet,
-- un second appareil ou un nouvel essai après une coupure.
--
-- 1. agent_cartes.prise_le : l'heure où une validation a pris la carte. Rien d'autre ne change sur la carte (figer_agent_carte, migration 52,
--    garde son contenu ; cette colonne n'en fait pas partie).
-- 2. prendre_agent_carte(p_carte) : prend la carte d'un seul update atomique, seulement si elle est encore « proposee » et qu'aucune validation ne
--    l'a prise depuis moins de 2 minutes. Rend true si c'est cette validation qui l'a prise, false sinon (rien ne doit être créé).
--    Les droits restent ceux de la personne (security invoker, règle « décider de mes cartes » de la migration 52) : seulement ses cartes.
-- 3. rendre_agent_carte(p_carte) : une validation arrêtée (motif, erreur) rend la carte, qui peut être validée de nouveau.
-- Les 2 minutes : une validation interrompue sans rendre la carte (onglet fermé, coupure) la libère d'elle-même ; un enregistrement normal
-- prend moins de 10 secondes.

begin;

alter table agent_cartes add column if not exists prise_le timestamptz;

create or replace function prendre_agent_carte(p_carte uuid) returns boolean language plpgsql security invoker set search_path = public as $$
declare
  n integer;
begin
  update agent_cartes set prise_le = now()
   where id = p_carte and statut = 'proposee' and (prise_le is null or prise_le < now() - interval '2 minutes');
  get diagnostics n = row_count;
  return n = 1;
end
$$;

create or replace function rendre_agent_carte(p_carte uuid) returns void language plpgsql security invoker set search_path = public as $$
begin
  update agent_cartes set prise_le = null where id = p_carte and statut = 'proposee';
end
$$;

revoke all on function prendre_agent_carte(uuid) from public, anon;
revoke all on function rendre_agent_carte(uuid) from public, anon;
grant execute on function prendre_agent_carte(uuid) to authenticated;
grant execute on function rendre_agent_carte(uuid) to authenticated;


commit;
