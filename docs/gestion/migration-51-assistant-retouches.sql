-- Gestion : migration 51, qualité des réponses rédigées par l'assistant IA (20.11.2026).
-- Une ligne chaque fois qu'une personne copie une réponse rédigée par l'assistant : l'entreprise, l'usage (« repondre_itineraire » aujourd'hui) et la
-- part des mots changés avant la copie, un entier de 0 (copiée telle quelle) à 100 (réécrite). Calculée dans le navigateur (partModifiee,
-- assistant-suivi-calc.mjs). Jamais le texte du brouillon, du message ni de la réponse : seulement ce nombre.
-- Sert à l'écran « Suivi de l'assistant » (part des réponses copiées sans retouche). Une réponse retouchée ensuite dans WhatsApp n'est pas vue.
-- Écrire : la personne elle-même, pour une entreprise où elle peut utiliser l'assistant (« partenaires.lire » et « dossiers.ecrire »).
-- Lire : ses propres lignes, et celles de l'entreprise pour un rôle qui a le droit « journal » (comme assistant_journal, migration 27).
-- Ni modification ni suppression depuis l'outil. Gardé un an, comme le journal.
-- Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Retour en arrière : drop table if exists assistant_retouches; drop function if exists noter_assistant_retouche(); drop function if exists purger_assistant_retouches();

begin;

create table if not exists assistant_retouches (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  user_id uuid not null default auth.uid(),
  entite_id uuid not null references entites (id) on delete cascade,
  usage text not null check (usage ~ '^[a-z_]{1,40}$'),
  part_modifiee smallint not null check (part_modifiee between 0 and 100)
);
create index if not exists assistant_retouches_entite on assistant_retouches (entite_id, cree_le desc);

-- Date et auteur posés par la base : l'outil ne peut pas les choisir.
create or replace function noter_assistant_retouche() returns trigger language plpgsql set search_path = public as $$
begin
  new.cree_le := now();
  new.user_id := auth.uid();
  return new;
end
$$;
drop trigger if exists noter_assistant_retouche on assistant_retouches;
create trigger noter_assistant_retouche before insert on assistant_retouches for each row execute function noter_assistant_retouche();

alter table assistant_retouches enable row level security;
revoke all on assistant_retouches from anon, authenticated;
grant select, insert on assistant_retouches to authenticated;

drop policy if exists "lire les retouches de l'assistant" on assistant_retouches;
create policy "lire les retouches de l'assistant" on assistant_retouches for select to authenticated using (
  user_id = auth.uid() or a_permission(entite_id, 'journal.voir')
);
drop policy if exists "noter une retouche de l'assistant" on assistant_retouches;
create policy "noter une retouche de l'assistant" on assistant_retouches for insert to authenticated with check (
  user_id = auth.uid() and a_permission(entite_id, 'partenaires.lire') and a_permission(entite_id, 'dossiers.ecrire')
);

create or replace function purger_assistant_retouches() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from assistant_retouches where cree_le < now() - interval '365 days';
  return null;
end
$$;
drop trigger if exists purger_assistant_retouches on assistant_retouches;
create trigger purger_assistant_retouches after insert on assistant_retouches for each statement execute function purger_assistant_retouches();

commit;
