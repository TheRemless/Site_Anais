-- Retour en arrière de la migration 74 (apprentissages écrits par la fonction, genres « remarque » et « retour »).
-- Avant : remettre le code d'avant (fonctions « agent », « whatsapp » et « whatsapp-envoi » redéployées depuis master d'avant la PR, outil
-- sans le bouton « Pas bien »), sinon la fonction essaie encore d'écrire et le dit dans ses journaux (rien d'autre ne casse).
-- Les lignes qui n'existaient pas avant sont effacées : celles écrites par la fonction (source « whatsapp », sans auteur) et celles des
-- genres « remarque » et « retour ». Les corrections de l'outil des genres d'avant restent.
-- Avant (lecture seule) :
--   select source, genre, count(*) from agent_apprentissages group by 1, 2;
begin;

delete from agent_apprentissages where user_id is null or genre in ('remarque', 'retour');

drop trigger if exists oublier_apprentissages on whatsapp_conversations;
drop function if exists oublier_apprentissages_conversation();

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

alter table agent_apprentissages drop constraint if exists agent_apprentissages_retour_check;
alter table agent_apprentissages drop constraint if exists agent_apprentissages_auteur_check;
alter table agent_apprentissages drop constraint if exists agent_apprentissages_source_check;
alter table agent_apprentissages drop constraint if exists agent_apprentissages_genre_check;
alter table agent_apprentissages add constraint agent_apprentissages_genre_check check (genre in ('pickup', 'libelle', 'prix', 'lieu', 'date', 'reponse'));
drop index if exists agent_apprentissages_proposition;
alter table agent_apprentissages drop column if exists proposition_id;
alter table agent_apprentissages drop column if exists source;
alter table agent_apprentissages alter column user_id set not null;

commit;
-- Contrôle après :
--   select column_name, is_nullable from information_schema.columns where table_name = 'agent_apprentissages' order by ordinal_position;
