-- Gestion : migration 54, crédit de l'assistant et apprentissages de l'agent (20.11.2026).
-- 1. assistant_budget : le plafond mensuel de l'assistant (fonctions « assistant » et « agent », toutes entreprises), réglé par l'administratrice
--    générale (Jérémy) dans « Suivi de l'assistant ». 50 $ par défaut pour un crédit API de 200 $, alerte à 80 %. Une seule ligne.
--    Lu par les fonctions (clé de service) et, pour l'écran et le bandeau, par assistant_budget_etat() (administratrices seulement).
-- 2. assistant_alertes : le verrou des alertes envoyées (80 % du mois, plafond du mois, crédit d'Anthropic épuisé du jour) ; une ligne par
--    alerte, posée par la fonction « rappels » avant l'envoi, pour qu'une alerte ne parte qu'une fois. Clé de service seulement.
-- 3. agent_apprentissages : les corrections que la personne apporte à une proposition de l'agent avant de la valider (heure de pickup, libellé,
--    prix de vente, lieu, date, texte de la réponse au client), gardées par entreprise et relues par l'agent comme exemples dans les
--    conversations suivantes. Jamais un net : les cartes n'en contiennent pas et l'outil écarte toute correction qui parle de net, de
--    commission, de marge ou de banque. Le nom, le téléphone et l'e-mail du client sont masqués avant l'écriture (agent-apprendre.mjs).
--    Lire : qui utilise l'agent dans l'entreprise (« dossiers.ecrire » et « partenaires.lire »), et qui lit le journal.
--    Ajouter : la personne elle-même, avec ces deux droits. Supprimer : les administratrices (« reglages.ecrire » et « journal.voir »).
--    Gardés un an, 300 au plus par entreprise (les plus anciens partent).
-- 4. agent_conversations : index sur le dossier relié, pour retrouver depuis la fiche du dossier la conversation qui l'a préparé.
-- Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Retour en arrière :
--   drop table if exists agent_apprentissages; drop function if exists noter_agent_apprentissage(); drop function if exists purger_agent_apprentissages();
--   drop table if exists assistant_alertes; drop function if exists assistant_budget_etat(); drop function if exists regler_plafond_assistant(numeric, smallint);
--   drop table if exists assistant_budget; drop index if exists agent_conversations_dossier;

begin;

-- ---- Plafond du mois -----------------------------------------------------------------------------------------------------------
create table if not exists assistant_budget (
  id boolean primary key default true check (id),
  plafond_mois_usd numeric(8, 2) not null default 50 check (plafond_mois_usd between 1 and 1000),
  seuil_alerte_pct smallint not null default 80 check (seuil_alerte_pct between 50 and 99),
  maj_le timestamptz not null default now(),
  maj_par uuid
);
insert into assistant_budget (id) values (true) on conflict do nothing;
alter table assistant_budget enable row level security;
revoke all on assistant_budget from public, anon, authenticated;

create table if not exists assistant_alertes (
  cle text primary key check (length(cle) between 1 and 40),
  cree_le timestamptz not null default now()
);
alter table assistant_alertes enable row level security;
revoke all on assistant_alertes from public, anon, authenticated;

-- Qui administre quelque part : l'administratrice générale, ou un rôle qui règle et lit le journal dans au moins une entreprise.
-- Rend la dépense du mois (heure de Bangkok, toutes entreprises), le plafond et le seuil ; null pour les autres.
create or replace function assistant_budget_etat() returns json language plpgsql stable security definer set search_path = public as $$
declare
  debut timestamptz := (date_trunc('month', now() at time zone 'Asia/Bangkok')) at time zone 'Asia/Bangkok';
  b assistant_budget;
begin
  if not (est_super_admin() or exists (select 1 from entites e where a_permission(e.id, 'reglages.ecrire') and a_permission(e.id, 'journal.voir'))) then
    return null;
  end if;
  select * into b from assistant_budget where id;
  return json_build_object(
    'cout_mois', (select coalesce(sum(cout_estime_usd), 0) from assistant_journal where cree_le >= debut),
    'plafond', coalesce(b.plafond_mois_usd, 50),
    'seuil', coalesce(b.seuil_alerte_pct, 80),
    'debut', debut,
    'peut_regler', est_super_admin()
  );
end
$$;
revoke all on function assistant_budget_etat() from public, anon;
grant execute on function assistant_budget_etat() to authenticated;

-- Régler le plafond : l'administratrice générale seulement. Le seuil reste celui d'avant s'il n'est pas donné.
create or replace function regler_plafond_assistant(plafond numeric, seuil smallint default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not est_super_admin() then raise exception 'réservé à l''administratrice générale' using errcode = '42501'; end if;
  insert into assistant_budget (id, plafond_mois_usd, seuil_alerte_pct, maj_le, maj_par)
  values (true, plafond, coalesce(seuil, 80), now(), auth.uid())
  on conflict (id) do update set plafond_mois_usd = excluded.plafond_mois_usd, seuil_alerte_pct = coalesce(seuil, assistant_budget.seuil_alerte_pct), maj_le = now(), maj_par = auth.uid();
end
$$;
revoke all on function regler_plafond_assistant(numeric, smallint) from public, anon;
grant execute on function regler_plafond_assistant(numeric, smallint) to authenticated;

-- ---- Apprentissages de l'agent -------------------------------------------------------------------------------------------------
create table if not exists agent_apprentissages (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null references entites (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  carte_id uuid references agent_cartes (id) on delete set null,
  genre text not null check (genre in ('pickup', 'libelle', 'prix', 'lieu', 'date', 'reponse')),
  contexte text not null default '' check (length(contexte) <= 300),
  avant text not null default '' check (length(avant) <= 1500),
  apres text not null default '' check (length(apres) <= 1500),
  cree_le timestamptz not null default now()
);
create index if not exists agent_apprentissages_entite on agent_apprentissages (entite_id, cree_le desc);

-- Date et auteur posés par la base ; une carte reliée doit être d'une conversation de la même entreprise.
create or replace function noter_agent_apprentissage() returns trigger language plpgsql set search_path = public as $$
begin
  new.cree_le := now();
  new.user_id := auth.uid();
  if new.carte_id is not null and not exists (
    select 1 from agent_cartes c join agent_conversations a on a.id = c.conversation_id where c.id = new.carte_id and a.entite_id = new.entite_id
  ) then
    new.carte_id := null;
  end if;
  return new;
end
$$;
drop trigger if exists noter_agent_apprentissage on agent_apprentissages;
create trigger noter_agent_apprentissage before insert on agent_apprentissages for each row execute function noter_agent_apprentissage();

alter table agent_apprentissages enable row level security;
revoke all on agent_apprentissages from anon, authenticated;
grant select, insert, delete on agent_apprentissages to authenticated;

drop policy if exists "lire les apprentissages de l'agent" on agent_apprentissages;
create policy "lire les apprentissages de l'agent" on agent_apprentissages for select to authenticated using (
  (a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire')) or a_permission(entite_id, 'journal.voir')
);
drop policy if exists "noter un apprentissage de l'agent" on agent_apprentissages;
create policy "noter un apprentissage de l'agent" on agent_apprentissages for insert to authenticated with check (
  user_id = auth.uid() and a_permission(entite_id, 'dossiers.ecrire') and a_permission(entite_id, 'partenaires.lire')
);
drop policy if exists "supprimer un apprentissage de l'agent" on agent_apprentissages;
create policy "supprimer un apprentissage de l'agent" on agent_apprentissages for delete to authenticated using (
  a_permission(entite_id, 'reglages.ecrire') and a_permission(entite_id, 'journal.voir')
);

-- Un an au plus, et les 300 plus récents par entreprise.
create or replace function purger_agent_apprentissages() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from agent_apprentissages where cree_le < now() - interval '365 days';
  delete from agent_apprentissages a using (
    select id from (select id, row_number() over (partition by entite_id order by cree_le desc, id) as rang from agent_apprentissages) x where x.rang > 300
  ) v where a.id = v.id;
  return null;
end
$$;
drop trigger if exists purger_agent_apprentissages on agent_apprentissages;
create trigger purger_agent_apprentissages after insert on agent_apprentissages for each statement execute function purger_agent_apprentissages();

-- ---- Conversation reliée à un dossier -----------------------------------------------------------------------------------------
create index if not exists agent_conversations_dossier on agent_conversations (dossier_id) where dossier_id is not null;

commit;
