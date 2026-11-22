-- Gestion : migration 74, l'Assistant apprend vraiment de Nani (22.11.2026).
-- Constat du 22.11.2026 : agent_apprentissages avait 0 ligne pour 10 conversations de l'Assistant en 7 jours. Les 11 cartes validées
-- l'avaient été sans changement, et les 16 réponses préparées de WhatsApp ont toutes été traitées depuis l'app du téléphone
-- (traitee_par_quoi = 'app') avec un texte de Nani très différent, que rien ne comparait. Cette migration permet :
--   1. une écriture par la fonction serveur (clé de service) : la correction de Nani dans WhatsApp (supabase/functions/agent/
--      apprendre-whatsapp.js). user_id devient facultatif, une colonne « source » dit d'où vient la ligne (« outil » : l'écran, une personne ;
--      « whatsapp » : la fonction) et proposition_id relie la ligne à la réponse préparée comparée (une seule ligne par réponse préparée,
--      un événement rejoué ne note rien de plus) ;
--   2. deux nouveaux genres : « remarque » (remarque d'une carte « modification » retouchée) et « retour » (bouton « Pas bien » de l'onglet
--      Assistant : la raison de la personne, 200 caractères au plus, avec un extrait masqué de la réponse) ;
--   3. le déclencheur noter_agent_apprentissage tient l'auteur : une session de l'outil (auth.uid() connu) écrit TOUJOURS en son nom, avec
--      source « outil » et sans proposition_id, quoi qu'elle envoie ; sans session, seul un rôle serveur écrit (anon et authenticated sans
--      session sont refusés). Une ligne sans auteur est forcément « whatsapp » (contrainte). Les droits RLS d'écriture ne changent pas :
--      la personne elle-même, avec « dossiers.ecrire » et « partenaires.lire » dans l'entreprise (Mook n'a pas ce second droit).
--   4. une conversation WhatsApp classée ensuite partenaire, chauffeur, hôtel, apporteur, reliée à une fiche partenaire ou passée en
--      Contact personnel (reponses = 'jamais') : les lignes tirées de ses réponses préparées sont effacées (déclencheur
--      oublier_apprentissages_conversation, revue de sécurité) ;
--   5. aucune ligne ne parle de net, de commission ni de banque, même écrite hors de l'outil (déclencheur : « mot_interne »).
-- Rien de nouveau n'est lu par l'outil : mêmes politiques de lecture et de suppression qu'à la migration 54.
-- Ne modifie aucune donnée existante. Se rejoue sans effet.
-- À exécuter AVANT de déployer les fonctions « agent », « whatsapp » et « whatsapp-envoi » de cette PR (sans elle, la fonction n'écrit rien
-- et le dit dans ses journaux, la réponse au client part quand même).
-- Retour en arrière : docs/gestion/retour-74-apprentissages-nani.sql.
-- Contrôle :
--   select source, genre, count(*) from agent_apprentissages group by 1, 2 order by 1, 2;
--   select conname from pg_constraint where conrelid = 'agent_apprentissages'::regclass order by 1;
-- Contrôle PGlite : docs/gestion/verif-agent-apprendre-nani.mjs.

begin;

alter table agent_apprentissages alter column user_id drop not null;
alter table agent_apprentissages add column if not exists source text not null default 'outil';
alter table agent_apprentissages add column if not exists proposition_id uuid references whatsapp_propositions (id) on delete set null;
-- Une ligne au plus par réponse préparée (les valeurs nulles ne se gênent pas).
create unique index if not exists agent_apprentissages_proposition on agent_apprentissages (proposition_id);

alter table agent_apprentissages drop constraint if exists agent_apprentissages_genre_check;
alter table agent_apprentissages add constraint agent_apprentissages_genre_check
  check (genre in ('pickup', 'libelle', 'prix', 'lieu', 'date', 'reponse', 'remarque', 'retour'));
alter table agent_apprentissages drop constraint if exists agent_apprentissages_source_check;
alter table agent_apprentissages add constraint agent_apprentissages_source_check check (source in ('outil', 'whatsapp'));
-- Une ligne de l'outil a toujours son auteur ; une ligne sans auteur vient de la fonction.
alter table agent_apprentissages drop constraint if exists agent_apprentissages_auteur_check;
alter table agent_apprentissages add constraint agent_apprentissages_auteur_check check ((source = 'outil') = (user_id is not null));
-- La raison d'un « Pas bien » : 200 caractères au plus.
alter table agent_apprentissages drop constraint if exists agent_apprentissages_retour_check;
alter table agent_apprentissages add constraint agent_apprentissages_retour_check check (genre <> 'retour' or length(apres) between 1 and 200);

-- Date et auteur posés par la base ; une carte reliée doit être d'une conversation de la même entreprise ; une réponse préparée reliée doit
-- être de la même entreprise (sinon rien n'est relié).
create or replace function noter_agent_apprentissage() returns trigger language plpgsql set search_path = public as $$
begin
  new.cree_le := now();
  if auth.uid() is not null then
    -- Une session de l'outil : toujours en son nom, jamais « whatsapp », jamais reliée à une réponse préparée.
    new.user_id := auth.uid();
    new.source := 'outil';
    new.proposition_id := null;
  elsif current_user in ('anon', 'authenticated') then
    raise exception 'auteur_inconnu' using errcode = '42501';
  else
    -- La fonction serveur (clé de service) : aucune personne derrière la ligne.
    new.user_id := null;
    new.source := 'whatsapp';
    if new.proposition_id is not null and not exists (
      select 1 from whatsapp_propositions p join whatsapp_conversations c on c.id = p.conversation_id
      join entites e on e.id = new.entite_id and e.organisation_id = c.organisation_id
      where p.id = new.proposition_id and (p.entite_id = new.entite_id or (p.entite_id is null and c.entite_id = new.entite_id))
    ) then
      raise exception 'proposition_autre_entreprise' using errcode = '22023';
    end if;
  end if;
  -- Les mêmes mots que l'outil et la fonction (agent/apprendre.js, MOT_INTERNE), pour une ligne écrite par l'API directement.
  if (new.contexte || ' ' || new.avant || ' ' || new.apres) ~* '\m(nets?|commissions?|marges? commerciales?|prix d''achat|co[uû]t d''achat|cost price|iban|swift|compte bancaire|bank account|promptpay|kbank|kasikorn|bangkok bank)\M' then
    raise exception 'mot_interne' using errcode = '22023';
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

-- Une conversation qui n'est plus celle d'un client : ses lignes tirées des réponses préparées sont oubliées.
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
    delete from agent_apprentissages where proposition_id in (select p.id from whatsapp_propositions p where p.conversation_id = new.id);
  end if;
  return null;
end
$$;
revoke all on function oublier_apprentissages_conversation() from public, anon, authenticated;
drop trigger if exists oublier_apprentissages on whatsapp_conversations;
create trigger oublier_apprentissages after update on whatsapp_conversations
  for each row execute function oublier_apprentissages_conversation();

-- Personne ne modifie une ligne (migration 54) : rappel explicite, rien d'autre n'est ouvert.
revoke update on agent_apprentissages from anon, authenticated;

commit;
