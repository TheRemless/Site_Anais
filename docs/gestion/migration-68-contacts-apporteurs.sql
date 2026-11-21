-- Gestion : migration 68, contacts WhatsApp typés et apporteurs d'affaires (décisions de Jérémy du 21.11.2026). Suit la 67 (PR 295).
-- Le cas de départ : une travel planner envoie des clients à Nani sur WhatsApp pour qu'elle leur réserve des activités, sans aucun accord.
--   1. whatsapp_conversations.type_contact : client, apporteur (travel planner, agence), partenaire, chauffeur, hotel. Vide = pas encore typé.
--      « Personnel » n'est PAS une valeur de type_contact : c'est reponses = 'jamais' sans type (migration 60, « rien envoyé à l'IA »).
--      Le type ne rouvre jamais l'IA tout seul : un type peut exister avec reponses = 'jamais' (un chauffeur, un partenaire ou un hôtel parlent
--      de nets et de commissions). C'est l'écran qui couple les deux au tap : client et apporteur mettent « auto » ; partenaire, chauffeur et
--      hôtel mettent « jamais » ; personnel met « jamais » et vide le type. Nani change toujours le réglage des réponses à part.
--      La fonction « whatsapp » lit déjà reponses : rien à changer pour elle.
--   2. whatsapp_conversations.partenaire_id : la fiche partenaire de la personne qui écrit (l'apporteur, un partenaire, un hôtel), pour que
--      l'assistant la reconnaisse. Une fiche d'une autre entreprise est refusée ; un changement d'entreprise retire le lien (comme le client).
--   3. La fonction « whatsapp » (clé de service) ne change jamais un type posé, un contact personnel ni une fiche reliée :
--      whatsapp_proteger_classement (migration 60) est étendu. Elle peut encore remplir un type ou une fiche encore vides.
--   4. dossiers.apporteur_id : l'apporteur qui a envoyé le client. Une fiche de la même entreprise, de catégorie « apporteur », dans une
--      entreprise de Secret ou de Taxi (jamais ZTP). Modifiable par qui écrit le dossier. Une fiche supprimée laisse le dossier sans apporteur ;
--      un dossier remis depuis la corbeille dont la fiche n'est plus valable revient sans apporteur (repéré comme controler_dossier_lie, 63).
--   Pas de rémunération des apporteurs : personne n'est payé en commission aujourd'hui (Jérémy, 21.11.2026). Rien sur les nets ni l'argent ici.
-- Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Retour en arrière : docs/gestion/retour-68-contacts-apporteurs.sql
-- Contrôle :
--   select coalesce(type_contact, case when reponses = 'jamais' then 'personnel' end) type, count(*), count(partenaire_id) relies from whatsapp_conversations group by 1;
--   select p.nom, count(d.id) dossiers from partenaires p left join dossiers d on d.apporteur_id = p.id where p.categorie = 'apporteur' group by 1;

begin;

-- 1 et 2. Type du contact et fiche reliée.
alter table whatsapp_conversations add column if not exists type_contact text;
alter table whatsapp_conversations add column if not exists partenaire_id uuid references partenaires (id) on delete set null;
create index if not exists whatsapp_conversations_partenaire on whatsapp_conversations (partenaire_id) where partenaire_id is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_type_contact_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_type_contact_check
      check (type_contact is null or type_contact in ('client', 'apporteur', 'partenaire', 'chauffeur', 'hotel'));
  end if;
end $$;

-- Une première version de cette migration liait le type à reponses = 'auto' : la contrainte disparaît si elle avait été posée.
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_personnel_check;

-- Le type et la fiche se changent depuis l'outil par qui écrit dans la conversation (politique « ranger une conversation WhatsApp », migration 63).
grant update (type_contact, partenaire_id) on whatsapp_conversations to authenticated;

-- 3. Classement de Nani protégé (migration 60), étendu au type et à la fiche reliée. Sans personne connectée (la fonction), un type posé,
-- un contact personnel ou une fiche reliée ne change pas.
create or replace function whatsapp_proteger_classement() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    if old.entite_id is not null and new.entite_id is distinct from old.entite_id then
      new.entite_id := old.entite_id;
      new.entite_source := old.entite_source;
    end if;
    if old.entite_source = 'manuel' then
      new.entite_id := old.entite_id;
      new.entite_source := old.entite_source;
    end if;
    if old.client_id is not null and new.client_id is distinct from old.client_id then new.client_id := old.client_id; end if;
    if old.dossier_id is not null and new.dossier_id is distinct from old.dossier_id then new.dossier_id := old.dossier_id; end if;
    new.reponses := old.reponses;
    -- Migration 68 : un type posé par Nani, ou un contact personnel, reste ; une fiche reliée aussi.
    if old.type_contact is not null or old.reponses = 'jamais' then new.type_contact := old.type_contact; end if;
    if old.partenaire_id is not null and new.partenaire_id is distinct from old.partenaire_id then new.partenaire_id := old.partenaire_id; end if;
  else
    -- Une personne ne réécrit pas la décision du tri (elle vient de la fonction).
    new.tri := old.tri;
  end if;
  return new;
end
$$;
revoke all on function whatsapp_proteger_classement() from public, anon;
drop trigger if exists whatsapp_proteger_classement on whatsapp_conversations;
create trigger whatsapp_proteger_classement before update on whatsapp_conversations for each row execute function whatsapp_proteger_classement();

-- Fiche reliée dans l'entreprise de la conversation. Le type ne touche jamais aux réponses : typer un contact ne le rouvre pas à l'IA.
-- Le nom fait passer ce déclencheur après whatsapp_proteger_classement, whatsapp_reclasser et whatsapp_suivi_outil (ordre alphabétique des
-- déclencheurs BEFORE) : il voit l'entreprise finale.
create or replace function whatsapp_type_coherent() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.partenaire_id is not null
     and (new.entite_id is null or not exists (select 1 from partenaires p where p.id = new.partenaire_id and p.entite_id = new.entite_id)) then
    if tg_op = 'INSERT' or new.partenaire_id is distinct from old.partenaire_id then
      raise exception 'Fiche partenaire introuvable dans l''entreprise de la conversation.' using errcode = '42501';
    end if;
    new.partenaire_id := null;     -- la conversation a changé d'entreprise : la fiche de l'autre n'est plus reliée
  end if;
  return new;
end
$$;
revoke all on function whatsapp_type_coherent() from public, anon;
drop trigger if exists whatsapp_type_coherent on whatsapp_conversations;
create trigger whatsapp_type_coherent before insert or update on whatsapp_conversations for each row execute function whatsapp_type_coherent();

-- 4. Apporteur d'un dossier.
alter table dossiers add column if not exists apporteur_id uuid references partenaires (id) on delete set null;
create index if not exists dossiers_apporteur on dossiers (apporteur_id) where apporteur_id is not null;

-- Seulement une fiche « apporteur » de la même entreprise, chez Secret ou Taxi (slug, ou une entreprise d'excursions ou de taxi d'une autre
-- organisation). Un dossier remis depuis la corbeille (restaurer_dossier, repéré comme dans controler_dossier_lie) dont la fiche n'est plus
-- valable revient sans apporteur au lieu d'échouer.
create or replace function controler_apporteur_dossier() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  restauration boolean := false;
begin
  if new.apporteur_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.apporteur_id is not distinct from old.apporteur_id and new.entite_id is not distinct from old.entite_id then return new; end if;
  if tg_op = 'INSERT' then
    restauration := exists (select 1 from corbeille where table_name = 'dossiers' and ligne->>'id' = new.id::text and ligne->>'apporteur_id' = new.apporteur_id::text);
  end if;
  select x.id, x.entite_id, x.categorie into p from partenaires x where x.id = new.apporteur_id;
  if p.id is null or p.entite_id <> new.entite_id or p.categorie <> 'apporteur'
     or not exists (select 1 from entites e left join reglages r on r.entite_id = e.id
                    where e.id = new.entite_id and (e.slug in ('secret', 'taxi') or r.valeur->>'fonctionnement' in ('excursions', 'taxi'))) then
    if restauration then
      new.apporteur_id := null;  -- la fiche n'existe plus ou n'est plus un apporteur : le dossier revient sans apporteur
      return new;
    end if;
    raise exception 'Apporteur introuvable dans cette entreprise.' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function controler_apporteur_dossier() from public, anon;
drop trigger if exists controler_apporteur_dossier on dossiers;
create trigger controler_apporteur_dossier before insert or update of apporteur_id, entite_id on dossiers for each row execute function controler_apporteur_dossier();

commit;
