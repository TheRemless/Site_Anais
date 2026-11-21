-- Retour en arrière de la migration 70 (nom d'un contact WhatsApp saisi à la main).
-- Les noms saisis par Nani restent dans whatsapp_conversations.nom : seule leur source part. Sans elle, ils redeviennent des noms de profil
-- ordinaires (le client relié passe de nouveau devant à l'écran) et la fonction « whatsapp » pourrait les remplacer si Telnyx envoyait un nom
-- de profil, ce qu'il ne fait pas aujourd'hui. Personne ne peut plus écrire le nom depuis l'outil.
-- whatsapp_proteger_classement revient à la version de la migration 68, whatsapp_rechercher à celle de la migration 67 (sans le nom).
-- Le code doit revenir aussi (écran WhatsApp, fonction « agent ») : sans la colonne, l'écran masque le crayon et l'agent relit comme avant.
-- Avant (lecture seule) :
--   select nom_source, count(*) from whatsapp_conversations group by 1;
begin;

drop trigger if exists whatsapp_nom_insertion on whatsapp_conversations;
drop function if exists whatsapp_nom_insertion();
drop trigger if exists whatsapp_nom_manuel on whatsapp_conversations;
drop function if exists whatsapp_nom_manuel();

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

-- whatsapp_rechercher de la migration 67, sans la recherche par nom.
create or replace function whatsapp_rechercher(q text, lim integer default 20)
returns table (conversation_id uuid, message_id uuid, extrait text, envoye_le timestamptz)
language plpgsql stable security invoker
set search_path = public, pg_temp
set statement_timeout = '3s'
as $$
declare
  propre text := left(coalesce(q, ''), 100);
  n integer := least(greatest(coalesce(lim, 20), 1), 50);
  chiffres text := regexp_replace(left(coalesce(q, ''), 100), '[^0-9]', '', 'g');
  org uuid := mon_organisation();
  mots text[];
  requete tsquery;
begin
  -- Un seul contrôle avant tout : la personne lit la boîte de son organisation (whatsapp_lit). Sans personne connectée (clé de service, qui
  -- passe outre la RLS), mon_organisation() est vide : rien. Ensuite, la RLS des migrations 58 et 63 choisit les lignes.
  if org is null or not whatsapp_lit(null, org) then
    return;
  end if;
  -- Les mots, en minuscules, sans les signes de la syntaxe des requêtes ; six au plus. Trois lettres ou plus : en préfixe ; deux : entier.
  select array_agg(m) into mots from (
    select regexp_replace(lower(x), '[&|!():*<>''"\\\s,.;?]+', '', 'g') as m
    from regexp_split_to_table(propre, '\s+') as x
  ) t where length(m) >= 2;
  mots := mots[1:6];
  if cardinality(mots) > 0 then
    requete := to_tsquery('simple', array_to_string(array(select quote_literal(m) || case when length(m) >= 3 then ':*' else '' end from unnest(mots) as m), ' & '));
  end if;
  if requete is null and length(chiffres) < 6 then
    return;
  end if;
  return query
    with par_mots as (
      -- Par l'index plein texte.
      select m.conversation_id, m.id as message_id, m.envoye_le, m.texte, m.medias
      from whatsapp_messages m
      join whatsapp_conversations c on c.id = m.conversation_id
      where requete is not null
        and to_tsvector('simple'::regconfig, coalesce(m.texte, '') || ' ' || coalesce(m.medias->0->>'legende', '')) @@ requete
        and m.supprime_le is null and m.type <> 'reaction'
        and c.organisation_id = org and c.reponses <> 'jamais'
      order by m.envoye_le desc
      limit n
    ),
    par_chiffres as (
      -- Les chiffres d'un message : 90 derniers jours seulement (index whatsapp_messages_envoye), pour que la lecture reste bornée.
      select m.conversation_id, m.id as message_id, m.envoye_le, m.texte, m.medias
      from whatsapp_messages m
      join whatsapp_conversations c on c.id = m.conversation_id
      where length(chiffres) >= 6
        and m.envoye_le > now() - interval '90 days'
        and m.supprime_le is null and m.type <> 'reaction'
        and c.organisation_id = org and c.reponses <> 'jamais'
        and regexp_replace(coalesce(m.texte, ''), '[^0-9]', '', 'g') like '%' || chiffres || '%'
      order by m.envoye_le desc
      limit n
    ),
    par_numero as (
      -- Le numéro du contact : son dernier message, pour ouvrir la conversation.
      select distinct on (c.id) c.id as conversation_id, m.id as message_id, m.envoye_le, m.texte, m.medias
      from whatsapp_conversations c
      join whatsapp_messages m on m.conversation_id = c.id and m.supprime_le is null and m.type <> 'reaction'
      where length(chiffres) >= 6
        and c.organisation_id = org and c.reponses <> 'jamais'
        and right(regexp_replace(c.telephone, '[^0-9]', '', 'g'), least(9, length(chiffres))) = right(chiffres, least(9, length(chiffres)))
      order by c.id, m.envoye_le desc
    ),
    tout as (
      select t.conversation_id, t.message_id, t.envoye_le, t.texte, t.medias from par_mots t
      union
      select t.conversation_id, t.message_id, t.envoye_le, t.texte, t.medias from par_chiffres t
      union
      select t.conversation_id, t.message_id, t.envoye_le, t.texte, t.medias from par_numero t
    )
    -- Le texte entier, sans marqueur : l'agent masque les numéros sur tout le texte avant de couper l'extrait.
    select t.conversation_id, t.message_id,
      left(trim(coalesce(t.texte, '') || ' ' || coalesce(t.medias->0->>'legende', '')), 8000),
      t.envoye_le
    from tout t
    order by t.envoye_le desc
    limit n;
end
$$;
revoke all on function whatsapp_rechercher(text, integer) from public, anon;
grant execute on function whatsapp_rechercher(text, integer) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function whatsapp_rechercher(text, integer) from service_role';
  end if;
end $$;

revoke update (nom) on whatsapp_conversations from authenticated;
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_nom_source_check;
alter table whatsapp_conversations drop column if exists nom_source;

commit;
