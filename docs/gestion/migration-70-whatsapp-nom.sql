-- Gestion : migration 70, le nom d'un contact WhatsApp saisi à la main (demande de Jérémy du 21.11.2026, « Oui faisons le nom à la main »).
-- Suit la 69 (PR 299).
--
-- But : Telnyx n'envoie aucun nom dans message.received (seulement from.phone_number, carrier et line_type) : les 25 conversations de la
-- production ont toutes whatsapp_conversations.nom vide. Nani écrit le nom elle-même dans l'en-tête de la conversation.
--   1. whatsapp_conversations.nom_source : 'manuel' (écrit par une personne dans Gestion), 'whatsapp' (nom de profil rangé par la fonction
--      « whatsapp ») ou vide (pas de nom). Aucune ligne existante n'est modifiée : les noms déjà là gardent nom_source vide, l'écran les lit
--      comme un nom de profil.
--   2. grant update (nom) à authenticated. La politique « ranger une conversation WhatsApp » (migration 63, whatsapp_ecrit) décide qui :
--      un administrateur de l'entreprise de la conversation, ou d'une des deux pour une conversation à trier. En lecture seule (administrateur
--      de l'autre entreprise) et pour Mook : aucune ligne modifiée.
--   3. whatsapp_proteger_classement (migrations 60 et 68) est étendu :
--      - une personne connectée qui écrit le nom (whatsapp_nom_manuel, déclencheur « before update of nom ») : caractères invisibles
--        (U+200B à U+200F, U+202A à U+202E, U+2060 à U+2069, U+FEFF) retirés, espaces et caractères de contrôle nettoyés, 60 caractères au
--        plus, nom_source = 'manuel' dès que « nom » figure dans l'UPDATE, même retapé à l'identique. Un nom vide après nettoyage efface le
--        nom manuel (nom et nom_source vides). nom_source ne s'écrit jamais directement (pas de droit sur la colonne) ;
--      - sans personne connectée (la fonction « whatsapp », clé de service) : un nom manuel ne change jamais, ni le nom ni nom_source. Un nom
--        vide ou de profil peut encore être rempli par whatsapp_ranger si Telnyx en envoie un jour un : nom_source = 'whatsapp'.
--   4. whatsapp_nom_insertion : une conversation créée par la fonction avec un nom de profil reçoit nom_source = 'whatsapp'.
--   Les fonctions de déclencheur ne s'exécutent pas en direct : execute retiré à public, anon et authenticated.
--   5. whatsapp_rechercher (migration 67) trouve aussi une conversation par son nom (mots et préfixes, configuration « simple ») : la
--      recherche de Gestion (palette) la montre avec son dernier message. Même signature, mêmes droits, contact personnel toujours écarté.
-- L'Assistant lit ce nom comme le reste (outils chercher_conversations, lire_conversation, a_faire_whatsapp), sauf pour un contact personnel.
-- C'est une donnée : masquée et neutralisée (crochets, chevrons) avant de partir dans le prompt. Rien sur les nets ni l'argent ici.
--
-- Se rejoue sans effet. Ne modifie aucune donnée existante.
-- Avec la migration, redéployer la fonction « agent » (le nom saisi passe avant le client relié, sa source est dite à l'agent). Sans la
-- migration, l'écran n'affiche pas le crayon et l'agent lit les conversations comme avant.
-- Retour en arrière : docs/gestion/retour-70-whatsapp-nom.sql (les noms saisis restent dans « nom », sans leur source).
-- Contrôle :
--   select coalesce(nom_source, case when nom is null then 'sans nom' else 'profil, sans source' end) source, count(*) from whatsapp_conversations group by 1;
--   select privilege_type from information_schema.column_privileges where table_name = 'whatsapp_conversations' and column_name = 'nom' and grantee = 'authenticated';
-- Contrôle PGlite : docs/gestion/verif-whatsapp-nom.mjs.

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_conversations' and column_name = 'type_contact') then
    raise exception 'Migration 68 absente : la colonne whatsapp_conversations.type_contact manque.';
  end if;
end $$;

-- 1. Source du nom.
alter table whatsapp_conversations add column if not exists nom_source text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_nom_source_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_nom_source_check
      check (nom_source is null or nom_source in ('manuel', 'whatsapp'));
  end if;
end $$;

-- 2. Le nom s'écrit depuis l'outil par qui écrit dans la conversation (politique « ranger une conversation WhatsApp », migration 63).
grant update (nom) on whatsapp_conversations to authenticated;

-- 3. Classement de Nani protégé (migrations 60 et 68), étendu au nom.
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
    -- Migration 70 : un nom saisi à la main ne change jamais ; un nom vide ou de profil se remplit avec le nom de profil reçu.
    if old.nom_source = 'manuel' then
      new.nom := old.nom;
      new.nom_source := old.nom_source;
    elsif new.nom is distinct from old.nom then
      new.nom_source := case when new.nom is null then null else 'whatsapp' end;
    else
      new.nom_source := old.nom_source;
    end if;
  else
    -- Une personne ne réécrit pas la décision du tri (elle vient de la fonction).
    new.tri := old.tri;
    -- Migration 70 : le nom écrit par une personne est traité par whatsapp_nom_manuel (« before update of nom », passé avant celui-ci).
  end if;
  return new;
end
$$;
revoke all on function whatsapp_proteger_classement() from public, anon, authenticated;
drop trigger if exists whatsapp_proteger_classement on whatsapp_conversations;
create trigger whatsapp_proteger_classement before update on whatsapp_conversations for each row execute function whatsapp_proteger_classement();

-- 3 bis. Le nom écrit par une personne connectée : dès que « nom » figure dans l'UPDATE (même valeur), il est nettoyé et devient manuel.
-- Caractères invisibles (catégorie Cf : U+200B à U+200F, U+202A à U+202E, U+2060 à U+2069, U+FEFF) retirés, espaces et caractères de
-- contrôle réduits à une espace, 60 caractères au plus. Vide après nettoyage : plus de nom ni de source. Sans personne connectée (la
-- fonction « whatsapp »), rien ici : whatsapp_proteger_classement garde le nom manuel. Le nom fait passer ce déclencheur avant
-- whatsapp_proteger_classement (ordre alphabétique des déclencheurs BEFORE).
create or replace function whatsapp_nom_manuel() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.nom := nullif(btrim(left(btrim(regexp_replace(regexp_replace(coalesce(new.nom, ''), '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]', '', 'g'), '[[:space:][:cntrl:]]+', ' ', 'g')), 60)), '');
    new.nom_source := case when new.nom is null then null else 'manuel' end;
  end if;
  return new;
end
$$;
revoke all on function whatsapp_nom_manuel() from public, anon, authenticated;
drop trigger if exists whatsapp_nom_manuel on whatsapp_conversations;
create trigger whatsapp_nom_manuel before update of nom on whatsapp_conversations for each row execute function whatsapp_nom_manuel();

-- 4. Une conversation créée avec un nom de profil (whatsapp_ranger) : nom_source = 'whatsapp'. Une source déjà donnée (restauration d'une
-- sauvegarde) est gardée.
create or replace function whatsapp_nom_insertion() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.nom is null then
    new.nom_source := null;
  elsif new.nom_source is null then
    new.nom_source := 'whatsapp';
  end if;
  return new;
end
$$;
revoke all on function whatsapp_nom_insertion() from public, anon, authenticated;
drop trigger if exists whatsapp_nom_insertion on whatsapp_conversations;
create trigger whatsapp_nom_insertion before insert on whatsapp_conversations for each row execute function whatsapp_nom_insertion();

-- 5. Recherche (migration 67) : en plus des messages et du numéro, le nom de la conversation. Même signature et même type rendu.
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
    par_nom as (
      -- Migration 70 : le nom de la conversation (saisi par l'équipe ou de profil), tous les mots ; n conversations au plus, les plus
      -- récentes, et pour chacune son dernier message seulement (lecture bornée), pour l'ouvrir.
      select c.id as conversation_id, m.id as message_id, m.envoye_le, m.texte, m.medias
      from (
        select c0.id from whatsapp_conversations c0
        where requete is not null and c0.nom is not null
          and c0.organisation_id = org and c0.reponses <> 'jamais'
          and to_tsvector('simple'::regconfig, c0.nom) @@ requete
        order by c0.dernier_message_le desc nulls last
        limit n
      ) c
      join lateral (
        select m0.id, m0.envoye_le, m0.texte, m0.medias from whatsapp_messages m0
        where m0.conversation_id = c.id and m0.supprime_le is null and m0.type <> 'reaction'
        order by m0.envoye_le desc
        limit 1
      ) m on true
    ),
    tout as (
      select t.conversation_id, t.message_id, t.envoye_le, t.texte, t.medias from par_mots t
      union
      select t.conversation_id, t.message_id, t.envoye_le, t.texte, t.medias from par_chiffres t
      union
      select t.conversation_id, t.message_id, t.envoye_le, t.texte, t.medias from par_numero t
      union
      select t.conversation_id, t.message_id, t.envoye_le, t.texte, t.medias from par_nom t
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

commit;
