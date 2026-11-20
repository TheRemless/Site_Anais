-- Migration 56 (20.11.2026) : demandes d'amélioration de Gestion depuis l'Assistant.
--
-- 1. ameliorations : une ligne par demande envoyée (autrice, entreprise, titre, texte public, statut, issue et PR GitHub). Écrite seulement par
--    les fonctions « ameliorations » (envoi) et « rappels » (suivi), avec la clé de service ; lue par les administratrices de l'entreprise.
-- 2. agent_cartes : deux genres de plus, « reglage » (changement sans code : voix, texte type, catalogue, réglage) et « amelioration ».
--
-- Statuts : envoyee (issue ouverte, l'Action travaille), pr_prete (PR en brouillon à relire), en_ligne (PR fusionnée, issue fermée),
-- refusee (issue fermée « not planned »), echec (l'Action s'est arrêtée).
--
-- Retour arrière :
--   drop table if exists ameliorations;
--   alter table agent_cartes drop constraint if exists agent_cartes_genre_check;
--   alter table agent_cartes add constraint agent_cartes_genre_check check (genre in ('dossier', 'reservation', 'modification', 'reponse', 'temps'));

begin;

create table if not exists ameliorations (
  id uuid primary key default gen_random_uuid(),
  entite_id uuid not null references entites (id) on delete cascade,
  user_id uuid not null,
  conversation_id uuid references agent_conversations (id) on delete set null,
  carte_id uuid references agent_cartes (id) on delete set null,
  titre text not null check (length(titre) between 1 and 80),
  texte text not null check (length(texte) between 1 and 3000),
  statut text not null default 'envoyee' check (statut in ('envoyee', 'pr_prete', 'en_ligne', 'refusee', 'echec')),
  issue_numero integer,
  issue_url text check (issue_url is null or issue_url like 'https://github.com/%'),
  pr_url text check (pr_url is null or pr_url like 'https://github.com/%'),
  sensible boolean not null default false,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);
create index if not exists ameliorations_entite on ameliorations (entite_id, cree_le desc);
-- Une carte n'envoie qu'une demande (double appui, nouvel essai après une panne).
create unique index if not exists ameliorations_carte on ameliorations (carte_id) where carte_id is not null;
create index if not exists ameliorations_suivies on ameliorations (maj_le) where statut in ('envoyee', 'pr_prete', 'echec');

alter table ameliorations enable row level security;
revoke all on ameliorations from anon, authenticated;
grant select on ameliorations to authenticated;
drop policy if exists "lire les demandes d'amélioration" on ameliorations;
create policy "lire les demandes d'amélioration" on ameliorations for select to authenticated using (a_permission(entite_id, 'reglages.ecrire'));

alter table agent_cartes drop constraint if exists agent_cartes_genre_check;
alter table agent_cartes add constraint agent_cartes_genre_check check (genre in ('dossier', 'reservation', 'modification', 'reponse', 'temps', 'reglage', 'amelioration'));

commit;
