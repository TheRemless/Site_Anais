-- Gestion : migration 24, journal de l'assistant IA.
-- Une ligne par appel de la fonction « assistant » qui est allé jusqu'à Claude : date, personne, entreprise, usage (lire ou rediger), statut,
-- modèle qui a servi, jetons et coût estimé. Jamais le message du client ni la réponse. Sert aussi à la limite d'appels par personne et par jour.
-- Table protégée : seule la fonction (clé de service) écrit. Chacun lit ses propres lignes ; les rôles qui ont le droit « journal » lisent celles
-- de leur entreprise. À exécuter une seule fois. Idempotente.

begin;

create table if not exists assistant_journal (
  id bigint generated always as identity primary key,
  cree_le timestamptz not null default now(),
  user_id uuid not null,
  entite_id uuid references entites (id) on delete cascade,
  usage text not null check (usage in ('lire', 'rediger')),
  statut text not null,
  modele text not null default '',
  jetons_entree integer not null default 0,
  jetons_sortie integer not null default 0,
  jetons_cache_lus integer not null default 0,
  jetons_cache_ecrits integer not null default 0,
  cout_estime_usd numeric(10, 6) not null default 0,
  duree_ms integer
);
create index if not exists assistant_journal_personne_jour on assistant_journal (user_id, cree_le desc);
create index if not exists assistant_journal_entite on assistant_journal (entite_id, cree_le desc);
alter table assistant_journal enable row level security;
revoke all on assistant_journal from anon, authenticated;
grant select on assistant_journal to authenticated;

drop policy if exists "lire le journal de l'assistant" on assistant_journal;
create policy "lire le journal de l'assistant" on assistant_journal for select to authenticated using (
  user_id = auth.uid() or a_permission(entite_id, 'journal.voir')
);

-- On garde un an : de quoi suivre le coût mois par mois sans que la table grossisse indéfiniment.
create or replace function purger_assistant_journal() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from assistant_journal where cree_le < now() - interval '365 days';
  return null;
end
$$;
drop trigger if exists purger_assistant_journal on assistant_journal;
create trigger purger_assistant_journal after insert on assistant_journal for each statement execute function purger_assistant_journal();

commit;
