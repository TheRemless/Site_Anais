-- Gestion : migration 74, l'Assistant apprend vraiment de Nani (22.11.2026).
-- Constat du 22.11.2026 : agent_apprentissages avait 0 ligne pour 10 conversations de l'Assistant en 7 jours. Les 11 cartes validées
-- l'avaient été sans changement, et les 16 réponses préparées de WhatsApp ont toutes été traitées depuis l'app du téléphone
-- (traitee_par_quoi = 'app') avec un texte de Nani très différent, que rien ne comparait. Cette migration permet :
--   1. une écriture par la fonction serveur (clé de service) : la réponse réellement envoyée dans WhatsApp, comparée à la réponse préparée
--      (supabase/functions/agent/apprendre-whatsapp.js). Une colonne « source » dit d'où vient la ligne (« outil » : l'écran, une personne ;
--      « whatsapp » : la fonction). whatsapp_conversation_id relie la ligne à sa conversation (effacée avec elle) et proposition_id à la
--      réponse préparée comparée (une seule ligne par réponse préparée : un événement rejoué ne note rien de plus ; la purge des
--      propositions à 90 jours ne détache pas la ligne de sa conversation) ;
--   2. l'auteur : une session de l'outil (auth.uid() connu) écrit TOUJOURS en son nom, avec source « outil », sans conversation ni réponse
--      préparée reliées, quoi qu'elle envoie. Sans session, seul un rôle serveur écrit (anon et authenticated sans session sont refusés) :
--      une réponse envoyée depuis Gestion garde la personne qui l'a envoyée (user_id passé par « whatsapp-envoi », un profil de la même
--      organisation), une réponse depuis l'app du téléphone n'a pas d'auteur connu (user_id nul). Les droits RLS d'écriture ne changent pas :
--      la personne elle-même, avec « dossiers.ecrire » et « partenaires.lire » dans l'entreprise (Mook n'a pas ce second droit) ;
--   3. deux nouveaux genres : « remarque » (remarque d'une carte « modification » retouchée) et « retour » (bouton « Pas bien » de l'onglet
--      Assistant : la raison de la personne, 200 caractères au plus, avec un extrait masqué de la réponse). Les montants de la raison sont
--      rangés à l'écran au moment du clic : un prix de vente connu reste, un net connu devient {montant}, un montant inconnu fait poser la
--      question « prix pour le client » ou « prix d'achat (interne) » ;
--   3 bis. une ligne « interne » (colonne interne) : visible dans « Suivi de l'assistant » avec ses montants masqués, elle n'entre JAMAIS
--      dans un prompt. La base masque elle-même chacun de ses nombres ({montant}), quoi que le navigateur envoie. Les fonctions ne lisent
--      plus que la vue agent_apprentissages_pour_ia (security_invoker, sans les lignes internes) ;
--   4. une conversation WhatsApp classée ensuite partenaire, chauffeur, hôtel, apporteur, reliée à une fiche partenaire ou passée en
--      Contact personnel (reponses = 'jamais') : ses lignes sont effacées (déclencheur oublier_apprentissages_conversation) ; une
--      conversation supprimée emporte les siennes (on delete cascade) ;
--   5. aucune ligne ne parle de net, de commission ni de banque, même écrite hors de l'outil (déclencheur : « mot_interne »).
-- Rien de nouveau n'est lu par l'outil : mêmes politiques de lecture et de suppression qu'à la migration 54.
-- Ne modifie aucune donnée existante, sauf une ligne « whatsapp » sans conversation (aucune en production : la table était vide).
-- Se rejoue sans effet.
-- À exécuter AVANT de déployer les fonctions « agent », « whatsapp » et « whatsapp-envoi » de cette PR (sans elle, la fonction n'écrit rien
-- et le dit dans ses journaux, la réponse au client part quand même ; l'Assistant relit alors sans apprentissage).
-- Retour en arrière : docs/gestion/retour-74-apprentissages-nani.sql.
-- Contrôle :
--   select source, genre, count(*) from agent_apprentissages group by 1, 2 order by 1, 2;
--   select conname from pg_constraint where conrelid = 'agent_apprentissages'::regclass order by 1;
--   select count(*) from agent_apprentissages_pour_ia;  -- les lignes non internes seulement
-- Contrôle PGlite : docs/gestion/verif-agent-apprendre-nani.mjs.

begin;

alter table agent_apprentissages alter column user_id drop not null;
alter table agent_apprentissages add column if not exists source text not null default 'outil';
alter table agent_apprentissages add column if not exists proposition_id uuid references whatsapp_propositions (id) on delete set null;
alter table agent_apprentissages add column if not exists whatsapp_conversation_id uuid references whatsapp_conversations (id) on delete cascade;
alter table agent_apprentissages add column if not exists interne boolean not null default false;
-- Une ligne au plus par réponse préparée (les valeurs nulles ne se gênent pas).
create unique index if not exists agent_apprentissages_proposition on agent_apprentissages (proposition_id);
create index if not exists agent_apprentissages_conversation on agent_apprentissages (whatsapp_conversation_id) where whatsapp_conversation_id is not null;

-- Une ligne « whatsapp » sans conversation (version antérieure de cette migration) ne reste pas.
delete from agent_apprentissages where source = 'whatsapp' and whatsapp_conversation_id is null;

alter table agent_apprentissages drop constraint if exists agent_apprentissages_genre_check;
alter table agent_apprentissages add constraint agent_apprentissages_genre_check
  check (genre in ('pickup', 'libelle', 'prix', 'lieu', 'date', 'reponse', 'remarque', 'retour'));
alter table agent_apprentissages drop constraint if exists agent_apprentissages_source_check;
alter table agent_apprentissages add constraint agent_apprentissages_source_check check (source in ('outil', 'whatsapp'));
-- Une ligne de l'outil a toujours son auteur et rien de WhatsApp ; une ligne de la fonction a toujours sa conversation.
alter table agent_apprentissages drop constraint if exists agent_apprentissages_auteur_check;
alter table agent_apprentissages add constraint agent_apprentissages_auteur_check check (
  (source = 'outil' and user_id is not null and whatsapp_conversation_id is null and proposition_id is null)
  or (source = 'whatsapp' and whatsapp_conversation_id is not null)
);
-- La raison d'un « Pas bien » : 200 caractères au plus.
alter table agent_apprentissages drop constraint if exists agent_apprentissages_retour_check;
alter table agent_apprentissages add constraint agent_apprentissages_retour_check check (genre <> 'retour' or length(apres) between 1 and 200);

-- Date et auteur posés par la base ; une carte reliée doit être d'une conversation de la même entreprise ; une conversation et une réponse
-- préparée reliées doivent être de la même organisation et de la même entreprise.
create or replace function noter_agent_apprentissage() returns trigger language plpgsql set search_path = public as $$
declare
  org uuid;
  conv jsonb;
begin
  new.cree_le := now();
  if auth.uid() is not null then
    -- Une session de l'outil : toujours en son nom, jamais « whatsapp », jamais reliée à une conversation ni à une réponse préparée.
    new.user_id := auth.uid();
    new.source := 'outil';
    new.proposition_id := null;
    new.whatsapp_conversation_id := null;
  elsif current_user in ('anon', 'authenticated') then
    raise exception 'auteur_inconnu' using errcode = '42501';
  else
    -- La fonction serveur (clé de service).
    new.source := 'whatsapp';
    select e.organisation_id into org from entites e where e.id = new.entite_id;
    if new.whatsapp_conversation_id is null then
      raise exception 'conversation_requise' using errcode = '22023';
    end if;
    if not exists (select 1 from whatsapp_conversations c where c.id = new.whatsapp_conversation_id and c.organisation_id = org
                   and (c.entite_id is null or c.entite_id = new.entite_id)) then
      raise exception 'conversation_autre_entreprise' using errcode = '22023';
    end if;
    -- Encore une conversation de client au moment d'écrire (une course avec un reclassement ne laisse rien) : ni partenaire, chauffeur,
    -- hôtel ou apporteur, ni fiche partenaire reliée, ni Contact personnel. Colonnes lues par leur nom (to_jsonb), comme l'oubli.
    select to_jsonb(c) into conv from whatsapp_conversations c where c.id = new.whatsapp_conversation_id;
    if not ((conv->>'type_contact' is null or conv->>'type_contact' = 'client') and conv->>'partenaire_id' is null and conv->>'reponses' is distinct from 'jamais') then
      raise exception 'conversation_pas_client' using errcode = '22023';
    end if;
    if new.proposition_id is not null and not exists (
      select 1 from whatsapp_propositions p
      where p.id = new.proposition_id and p.conversation_id = new.whatsapp_conversation_id and (p.entite_id is null or p.entite_id = new.entite_id)
    ) then
      raise exception 'proposition_autre_entreprise' using errcode = '22023';
    end if;
    -- L'auteur d'un envoi depuis Gestion : un profil de la même organisation (ou l'administratrice générale). Depuis l'app : aucun.
    if new.user_id is not null and not exists (
      select 1 from profils pr where pr.user_id = new.user_id and (pr.organisation_id = org or pr.super_admin)
    ) then
      raise exception 'auteur_autre_organisation' using errcode = '22023';
    end if;
  end if;
  -- Les mêmes mots que l'outil et la fonction (agent/apprendre.js, MOT_INTERNE), pour une ligne écrite par l'API directement.
  if (new.contexte || ' ' || new.avant || ' ' || new.apres) ~* '\m(nets?|commissions?|marges? commerciales?|prix d''achat|co[uû]t d''achat|cost price|iban|swift|compte bancaire|bank account|promptpay|kbank|kasikorn|bangkok bank)\M' then
    raise exception 'mot_interne' using errcode = '22023';
  end if;
  -- Une ligne interne (« prix d'achat » à la question du « Pas bien ») : chacun de ses nombres devient {montant}, quoi que le navigateur ait
  -- envoyé. Elle ne sort jamais de « Suivi de l'assistant » (vue agent_apprentissages_pour_ia).
  if new.interne then
    new.contexte := regexp_replace(new.contexte, '\d+([ ,.''’]\d+)*(\s?k\M)?', '{montant}', 'g');
    new.avant := regexp_replace(new.avant, '\d+([ ,.''’]\d+)*(\s?k\M)?', '{montant}', 'g');
    new.apres := regexp_replace(new.apres, '\d+([ ,.''’]\d+)*(\s?k\M)?', '{montant}', 'g');
  end if;
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

-- Une conversation qui n'est plus celle d'un client : ses lignes sont oubliées (par la conversation, pas par la réponse préparée, purgée
-- à 90 jours).
create or replace function oublier_apprentissages_conversation() returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
begin
  -- Les colonnes se lisent par leur nom dans la ligne (to_jsonb) et le déclencheur n'en cite aucune : un retour en arrière d'une migration
  -- plus ancienne (retour-68) peut encore retirer type_contact et partenaire_id sans rien casser. Le classement seul compte.
  if (o->>'type_contact', o->>'partenaire_id', o->>'reponses') is not distinct from (n->>'type_contact', n->>'partenaire_id', n->>'reponses') then
    return null;
  end if;
  if not ((n->>'type_contact' is null or n->>'type_contact' = 'client') and n->>'partenaire_id' is null and n->>'reponses' is distinct from 'jamais') then
    delete from agent_apprentissages where whatsapp_conversation_id = new.id;
  end if;
  return null;
end
$$;
revoke all on function oublier_apprentissages_conversation() from public, anon, authenticated;
drop trigger if exists oublier_apprentissages on whatsapp_conversations;
create trigger oublier_apprentissages after update on whatsapp_conversations
  for each row execute function oublier_apprentissages_conversation();

-- Un an au plus, et les 300 plus récentes par entreprise (migration 54), comptées à part pour les lignes internes : beaucoup de « prix
-- d'achat » ne repoussent pas les corrections utiles.
create or replace function purger_agent_apprentissages() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from agent_apprentissages where cree_le < now() - interval '365 days';
  delete from agent_apprentissages a using (
    select id from (select id, row_number() over (partition by entite_id, interne order by cree_le desc, id) as rang from agent_apprentissages) x where x.rang > 300
  ) v where a.id = v.id;
  return null;
end
$$;

-- Ce que les fonctions lisent pour un prompt (agent/apprentissages.js, lireApprentissages) : jamais une ligne interne. security_invoker :
-- sous la session de la personne, la RLS de la table s'applique (Mook ne lit rien) ; la clé de service lit toutes les lignes non internes.
drop view if exists agent_apprentissages_pour_ia;
create view agent_apprentissages_pour_ia with (security_invoker = true) as
  select id, entite_id, user_id, carte_id, genre, contexte, avant, apres, cree_le, source, proposition_id, whatsapp_conversation_id
  from agent_apprentissages where not interne;
revoke all on agent_apprentissages_pour_ia from public, anon, authenticated;
grant select on agent_apprentissages_pour_ia to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select on agent_apprentissages_pour_ia to service_role';
  end if;
end $$;

-- Personne ne modifie une ligne (migration 54) : rappel explicite, rien d'autre n'est ouvert.
revoke update on agent_apprentissages from anon, authenticated;

commit;
