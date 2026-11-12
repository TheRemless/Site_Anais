-- Gestion : migration 23, suivi des rappels sur téléphone.
-- Le 11.11.2026 à 11h UTC, la requête du cron vers la fonction « rappels » a expiré après 5 s (pg_net, délai par défaut) alors que le cron indiquait « succeeded » :
-- ce statut dit seulement que la requête est partie. La fonction écrit maintenant une ligne par exécution (date, type, envoyés, échecs, erreur) dans cette table,
-- et Réglages affiche l'état avec une alerte quand aucun rappel n'a réussi depuis 24 h.
-- Table protégée : seule la fonction (clé de service) écrit ; lisible par l'administratrice générale et par les rôles qui ont le droit « réglages ».
-- Ne contient aucune donnée de client : des comptes et un message d'erreur. À exécuter une seule fois. Idempotente.
-- Le délai de 30 s du cron se règle à part, dans le SQL privé qui contient le secret (jamais dans le dépôt).

begin;

create table if not exists rappels_suivi (
  id bigint generated always as identity primary key,
  cree_le timestamptz not null default now(),
  type text not null check (type in ('veille', 'lendemain')),
  cible date,
  abonnements integer not null default 0,
  envoyes integer not null default 0,
  retires integer not null default 0,
  echecs integer not null default 0,
  erreur text not null default '',
  duree_ms integer
);
create index if not exists rappels_suivi_cree_le on rappels_suivi (cree_le desc);
alter table rappels_suivi enable row level security;
revoke all on rappels_suivi from anon, authenticated;
grant select on rappels_suivi to authenticated;

drop policy if exists "lire le suivi des rappels" on rappels_suivi;
create policy "lire le suivi des rappels" on rappels_suivi for select to authenticated using (
  est_super_admin() or exists (
    select 1 from membres m join roles r on r.id = m.role_id join profils p on p.user_id = m.user_id
    where m.user_id = auth.uid() and p.actif and 'reglages.ecrire' = any (r.permissions))
);

-- On garde les 90 derniers jours : la table ne grossit pas indéfiniment.
create or replace function purger_rappels_suivi() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from rappels_suivi where cree_le < now() - interval '90 days';
  return null;
end
$$;
drop trigger if exists purger_rappels_suivi on rappels_suivi;
create trigger purger_rappels_suivi after insert on rappels_suivi for each statement execute function purger_rappels_suivi();

commit;
