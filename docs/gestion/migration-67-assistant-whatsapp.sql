-- Gestion : migration 67, l'Assistant lit la boîte WhatsApp (PR A, 21.11.2026). Suit la 66.
--
-- L'agent de l'onglet Assistant reçoit trois outils de lecture (supabase/functions/agent/whatsapp-lecture.js) : chercher_conversations,
-- lire_conversation et a_faire_whatsapp. Ils lisent avec la session de la personne : les politiques des migrations 58 et 63 décident
-- (whatsapp_lit : administrateur de Secret ou de Taxi). Cette migration ajoute :
--   1. un index GIN sur le texte des messages et la légende du premier média, configuration « simple » (le français, l'anglais et le thaï
--      se cherchent pareil, sans racine de mot ni mot vide) ;
--   2. whatsapp_rechercher(q, lim) en SECURITY INVOKER : la RLS s'applique. Elle exclut les contacts réglés « jamais » (« Contact
--      personnel : rien envoyé à l'IA », migration 60), les messages supprimés et les réactions. Un mot de 3 lettres ou plus se cherche aussi
--      en préfixe (« lan » trouve « Lanta »), un mot de 2 lettres en entier. Six chiffres ou plus se cherchent dans les chiffres des messages
--      des 90 derniers jours et dans le numéro du contact. q est coupé à 100 caractères, lim borné de 1 à 50, 3 secondes au plus.
--      Rend conversation_id, message_id, le texte ENTIER du message (sans marqueur ni coupe : l'agent le masque d'abord puis le coupe,
--      sinon un numéro coupé passait en clair, revue de sécurité de la PR 295) et la date ;
--   3. whatsapp_partenaires_parmi(tels) : parmi des numéros déjà lisibles par la personne (ceux des conversations), lesquels sont ceux d'une
--      fiche partenaire de l'organisation, sauf une fiche de catégorie « apporteur ». Même comparaison que la boîte (whatsapp/proposer.js,
--      cleNumero et numerosPartenaires : les 9 derniers chiffres). L'agent écarte ces conversations (on y parle de nets et de commissions).
--      Ne rend rien d'autre que ces clés ; réservée à qui lit la boîte (whatsapp_lit) ;
--   4. taches.whatsapp_conversation_id : la conversation d'une tâche née d'une promesse de Nani (whatsapp/suivi.js, tachePromesse).
--      L'Assistant relie la promesse sans deviner et l'écarte si le contact passe en « jamais ». Effacée si la conversation part (purge
--      des 365 jours) ; un dossier restauré depuis la corbeille dont la conversation n'existe plus revient sans le lien ; une personne ne
--      relie une tâche qu'à une conversation qu'elle lit.
-- Aucun appel à l'IA nouveau : la recherche est du SQL.
--
-- Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Avec la migration, redéployer les fonctions « agent », « whatsapp », « whatsapp-envoi » et « whatsapp-preparer » (sans elle, l'agent
-- marche sans la recherche dans le texte des messages et la fonction « whatsapp » écrit les tâches sans le lien).
-- Retour en arrière : docs/gestion/retour-67-assistant-whatsapp.sql.
-- Contrôle : verif-assistant-whatsapp.mjs ;
--   select * from whatsapp_rechercher('ferry', 5);  (connecté en administrateur de Secret ou de Taxi ; vide avec la clé de service)
--   select count(*) filter (where whatsapp_conversation_id is not null) from taches;

begin;

-- 1. Index plein texte. L'expression est celle de whatsapp_rechercher, à l'identique (sinon l'index ne sert pas).
create index if not exists whatsapp_messages_recherche on whatsapp_messages
  using gin (to_tsvector('simple'::regconfig, coalesce(texte, '') || ' ' || coalesce(medias->0->>'legende', '')));

-- 2. Recherche. Le type rendu a changé pendant la revue (texte entier au lieu d'un extrait) : la fonction est recréée.
drop function if exists whatsapp_rechercher(text, integer);
create function whatsapp_rechercher(q text, lim integer default 20)
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

-- 3. Numéros des fiches partenaires parmi ceux des conversations. contact.telephones : une liste (texte, ou objet numero / telephone /
-- valeur) ou un texte coupé aux virgules, points-virgules, barres, retours à la ligne et doubles espaces, comme numerosPartenaires.
create or replace function whatsapp_partenaires_parmi(tels text[]) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  with demandes as (
    select distinct right(regexp_replace(t, '[^0-9]', '', 'g'), 9) as k
    from unnest(coalesce(tels, '{}'::text[])) as t
    where length(regexp_replace(t, '[^0-9]', '', 'g')) >= 8
    limit 500
  ),
  fiches as (
    select p.contact->'telephones' as tel
    from partenaires p join entites e on e.id = p.entite_id
    where e.organisation_id = mon_organisation()
      and lower(translate(coalesce(p.categorie, ''), 'ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇàâäéèêëîïôöùûüç', 'AAAEEEEIIOOUUUCaaaeeeeiioouuuc')) not like '%apporteu%'
  ),
  morceaux as (
    select case jsonb_typeof(x) when 'string' then x #>> '{}' when 'object' then coalesce(nullif(x->>'numero', ''), nullif(x->>'telephone', ''), x->>'valeur', '') else '' end as v
    from fiches f, jsonb_array_elements(case jsonb_typeof(f.tel) when 'array' then f.tel else '[]'::jsonb end) as x
    union all
    select v from fiches f, regexp_split_to_table(case jsonb_typeof(f.tel) when 'string' then f.tel #>> '{}' else '' end, '[,;/\n]|\s{2,}') as v
  ),
  cles as (
    select right(regexp_replace(m[1], '[^0-9]', '', 'g'), 9) as k
    from morceaux, regexp_matches(coalesce(v, ''), '(\+?\d[\d\s.\-()]{6,}\d)', 'g') as m
    where length(regexp_replace(m[1], '[^0-9]', '', 'g')) >= 8
  )
  select coalesce(array_agg(d.k order by d.k), '{}'::text[])
  from demandes d
  where whatsapp_lit(null, mon_organisation()) and d.k in (select k from cles)
$$;
revoke all on function whatsapp_partenaires_parmi(text[]) from public, anon;
grant execute on function whatsapp_partenaires_parmi(text[]) to authenticated;

-- 4. La conversation d'une tâche née d'une promesse.
alter table taches add column if not exists whatsapp_conversation_id uuid references whatsapp_conversations (id) on delete set null;
create index if not exists taches_whatsapp_conversation on taches (whatsapp_conversation_id) where whatsapp_conversation_id is not null;

-- Le lien n'est gardé que vers une conversation qui existe (restauration d'un dossier depuis la corbeille) et, pour une personne
-- connectée, qu'elle lit (whatsapp_lit). Sinon il est effacé, la tâche s'écrit quand même.
create or replace function taches_whatsapp_lien() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.whatsapp_conversation_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.whatsapp_conversation_id is not distinct from old.whatsapp_conversation_id then return new; end if;
  if not exists (
    select 1 from whatsapp_conversations c
    where c.id = new.whatsapp_conversation_id
      and (auth.uid() is null or whatsapp_lit(c.entite_id, c.organisation_id))
  ) then
    new.whatsapp_conversation_id := null;
  end if;
  return new;
end
$$;
revoke all on function taches_whatsapp_lien() from public, anon, authenticated;
drop trigger if exists taches_whatsapp_lien on taches;
create trigger taches_whatsapp_lien before insert or update of whatsapp_conversation_id on taches for each row execute function taches_whatsapp_lien();

commit;
