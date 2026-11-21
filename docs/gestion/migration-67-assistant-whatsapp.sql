-- Gestion : migration 67, l'Assistant lit la boîte WhatsApp (PR A, 21.11.2026). Suit la 66.
--
-- L'agent de l'onglet Assistant reçoit trois outils de lecture (supabase/functions/agent/whatsapp-lecture.js) : chercher_conversations,
-- lire_conversation et a_faire_whatsapp. Ils lisent avec la session de la personne : les politiques des migrations 58 et 63 décident
-- (whatsapp_lit : administrateur de Secret ou de Taxi). Cette migration ajoute seulement la recherche plein texte :
--   1. un index GIN sur le texte des messages et la légende du premier média, configuration « simple » (le français, l'anglais et le thaï
--      se cherchent pareil, sans racine de mot ni mot vide) ;
--   2. whatsapp_rechercher(q, lim) en SECURITY INVOKER : la RLS s'applique, la fonction redit whatsapp_lit, exclut les contacts réglés
--      « jamais » (« Contact personnel : rien envoyé à l'IA », migration 60), les messages supprimés et les réactions. Chaque mot se cherche
--      aussi en préfixe (« lan » trouve « Lanta »). Six chiffres ou plus se cherchent aussi dans les chiffres du message et dans le numéro
--      du contact (« 081 234 5678 » trouve « +66812345678 »). q est coupé à 100 caractères, lim borné de 1 à 50. Rend conversation_id,
--      message_id, un extrait (ts_headline, mots trouvés entre « et ») et la date. Le texte est masqué par l'agent avant de partir chez
--      Anthropic (numéros, comptes, IBAN).
-- Aucun appel à l'IA nouveau : la recherche est du SQL.
--
-- Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Avec la migration, redéployer la fonction « agent » (sans elle, l'agent marche sans la recherche dans le texte des messages).
-- Retour en arrière : docs/gestion/retour-67-assistant-whatsapp.sql.
-- Contrôle : verif-assistant-whatsapp.mjs ;
--   select * from whatsapp_rechercher('ferry', 5);  (connecté en administrateur de Secret ou de Taxi ; vide avec la clé de service)

begin;

-- 1. Index plein texte. L'expression est celle de whatsapp_rechercher, à l'identique (sinon l'index ne sert pas).
create index if not exists whatsapp_messages_recherche on whatsapp_messages
  using gin (to_tsvector('simple'::regconfig, coalesce(texte, '') || ' ' || coalesce(medias->0->>'legende', '')));

-- 2. Recherche.
create or replace function whatsapp_rechercher(q text, lim integer default 20)
returns table (conversation_id uuid, message_id uuid, extrait text, envoye_le timestamptz)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  propre text := left(coalesce(q, ''), 100);
  n integer := least(greatest(coalesce(lim, 20), 1), 50);
  chiffres text := regexp_replace(left(coalesce(q, ''), 100), '[^0-9]', '', 'g');
  mots text[];
  requete tsquery;
begin
  -- Les mots, en minuscules, sans les signes de la syntaxe des requêtes ; six au plus, chacun en préfixe.
  select array_agg(m) into mots from (
    select regexp_replace(lower(x), '[&|!():*<>''"\\\s,.;?]+', '', 'g') as m
    from regexp_split_to_table(propre, '\s+') as x
  ) t where length(m) >= 2;
  mots := mots[1:6];
  if cardinality(mots) > 0 then
    requete := to_tsquery('simple', array_to_string(array(select quote_literal(m) || ':*' from unnest(mots) as m), ' & '));
  end if;
  if requete is null and length(chiffres) < 6 then
    return;
  end if;
  return query
    with trouves as (
      select m.conversation_id, m.id as message_id, m.envoye_le,
        coalesce(m.texte, '') || ' ' || coalesce(m.medias->0->>'legende', '') as document
      from whatsapp_messages m
      join whatsapp_conversations c on c.id = m.conversation_id
      where m.supprime_le is null and m.type <> 'reaction'
        and c.reponses <> 'jamais'
        and whatsapp_lit(c.entite_id, c.organisation_id)
        and (
          (requete is not null and to_tsvector('simple'::regconfig, coalesce(m.texte, '') || ' ' || coalesce(m.medias->0->>'legende', '')) @@ requete)
          or (length(chiffres) >= 6 and regexp_replace(coalesce(m.texte, ''), '[^0-9]', '', 'g') like '%' || chiffres || '%')
        )
      order by m.envoye_le desc
      limit n
    ),
    -- Le numéro du contact : son dernier message, pour ouvrir la conversation.
    par_numero as (
      select distinct on (c.id) c.id as conversation_id, m.id as message_id, m.envoye_le,
        coalesce(m.texte, '') || ' ' || coalesce(m.medias->0->>'legende', '') as document
      from whatsapp_conversations c
      join whatsapp_messages m on m.conversation_id = c.id and m.supprime_le is null and m.type <> 'reaction'
      where length(chiffres) >= 6
        and c.reponses <> 'jamais'
        and whatsapp_lit(c.entite_id, c.organisation_id)
        and right(regexp_replace(c.telephone, '[^0-9]', '', 'g'), least(9, length(chiffres))) = right(chiffres, least(9, length(chiffres)))
      order by c.id, m.envoye_le desc
    ),
    tout as (
      select * from trouves
      union
      select * from par_numero
    )
    select t.conversation_id, t.message_id,
      case when requete is not null and to_tsvector('simple'::regconfig, t.document) @@ requete
        then ts_headline('simple', t.document, requete, 'MaxWords=24, MinWords=8, MaxFragments=1, StartSel=«, StopSel=»')
        else left(regexp_replace(trim(t.document), '\s+', ' ', 'g'), 160) end,
      t.envoye_le
    from tout t
    order by t.envoye_le desc
    limit n;
end
$$;
revoke all on function whatsapp_rechercher(text, integer) from public, anon;
grant execute on function whatsapp_rechercher(text, integer) to authenticated;

commit;
