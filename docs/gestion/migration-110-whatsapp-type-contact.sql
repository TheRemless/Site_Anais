-- Gestion : migration 110, type du contact WhatsApp compris par le sens de la conversation (demande de Jérémy du 22.11.2026 : « l'outil ne
-- détecte pas quand c'est un partenaire […] Le tag chauffeur tu peux l'enlever parce que nos chauffeurs sont des partenaires. Hôtel aussi, on
-- ne parle pas avec les hôtels. »). Suit la 105 ; ne dépend que de la 68 (type_contact).
--
--   1. Plus de type « chauffeur » ni « hotel » : toute valeur devient « partenaire » (0 ligne au 22.11.2026, rejouable), et la contrainte de
--      type_contact n'accepte plus que client, apporteur, partenaire.
--   2. whatsapp_conversations.type_source : qui a posé le type. « nani » (depuis l'outil, ou un type déjà posé avant cette migration),
--      « deduit » (posé par la fonction « whatsapp »). Un type posé ou retiré par Nani n'est jamais touché par la fonction.
--   3. whatsapp_conversations.type_avis (jsonb) : les 5 dernières décisions « type du contact » du tri Haiku (même appel qu'avant, aucun de
--      plus) : { v, decisions: [{ type, raison, m, le }] }, « m » l'id du message trié. Raison courte, sans numéro. 1 500 caractères au plus.
--      Écrit par la fonction seulement, par whatsapp_ajouter_avis_type (6) : deux tris en même temps ne perdent aucune décision.
--   4. whatsapp_conversations.type_signaux (jsonb) : les repères relevés sans IA sur toute la conversation (supabase/functions/whatsapp/
--      type-contact.js) : des codes et des nombres, jamais un texte. 800 caractères au plus. Écrit par la fonction seulement.
--   5. whatsapp_type_source (déclencheur, après les autres par l'ordre alphabétique) :
--      - la fonction (clé de service) ne pose que « partenaire », sur un contact sans type, sans source, sans fiche partenaire, sans fiche
--        client ni dossier, qui n'est pas un Contact personnel : la base marque alors le type « deduit ». Elle ne change jamais la source.
--        Relecture du 22.11.2026 : une conversation reliée à un client ou à un dossier n'est jamais déduite partenaire (whatsapp_reclasser
--        effacerait le lien client, oublier_apprentissages les apprentissages) ;
--      - une personne qui change le type en devient la source (« nani ») ; elle peut confirmer un type déduit (type_source = 'nani'), jamais
--        poser « deduit » ; elle n'écrit jamais type_avis ni type_signaux.
--      La règle de la fonction (2 décisions « partenaire » venues de 2 messages différents) est dans type-contact.js (typeADeduire).
--   6. whatsapp_ajouter_avis_type(conv, decision) : ajoute une décision du tri à type_avis en une seule mise à jour (verrou de la ligne). Une
--      décision par message (la nouvelle remplace celle du même message), les 5 dernières, heure posée par la base. Jamais pour un Contact
--      personnel. Clé de service seulement.
-- Un contact « partenaire » déduit sort des étapes client, du « Prêt à réserver » et du tri automatique comme un partenaire posé par Nani ;
-- ses prix ne sont jamais repris comme prix de vente. Rien sur les nets, les commissions ni l'argent ici.
--
-- Se rejoue sans effet. Données touchées : les types chauffeur et hôtel (0 ligne aujourd'hui), et type_source = 'nani' sur les types déjà
-- posés (6 lignes au 22.11.2026 : 5 partenaires, 1 apporteur). Les repères des conversations déjà là sont calculés par la reprise de la
-- fonction (pg_cron, 20 toutes les 5 minutes) après son redéploiement.
-- Retour en arrière : docs/gestion/retour-110-whatsapp-type-contact.sql.
-- Contrôle :
--   select type_contact, type_source, count(*) from whatsapp_conversations group by 1, 2 order by 1, 2;
--   select count(*) filter (where (type_signaux->>'nets')::boolean) nets, count(type_avis) avis from whatsapp_conversations;
-- Contrôle PGlite : docs/gestion/verif-whatsapp-type-contact.mjs.

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_conversations' and column_name = 'type_contact') then
    raise exception 'Migration 68 absente : la colonne whatsapp_conversations.type_contact manque.';
  end if;
end $$;

alter table whatsapp_conversations add column if not exists type_source text;
alter table whatsapp_conversations add column if not exists type_avis jsonb;
alter table whatsapp_conversations add column if not exists type_signaux jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_type_source_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_type_source_check check (type_source is null or type_source in ('deduit', 'nani'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_type_avis_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_type_avis_check check (type_avis is null or (jsonb_typeof(type_avis) = 'object' and length(type_avis::text) <= 1500));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_type_signaux_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_type_signaux_check check (type_signaux is null or (jsonb_typeof(type_signaux) = 'object' and length(type_signaux::text) <= 800));
  end if;
end $$;

-- 1. Chauffeur et hôtel deviennent partenaire ; les types déjà posés sont ceux de Nani. La protection du classement (migration 70) garde un type
-- posé quand personne n'est connecté : coupée le temps de ces deux mises à jour, comme la migration 69.
alter table whatsapp_conversations disable trigger whatsapp_proteger_classement;
update whatsapp_conversations set type_contact = 'partenaire' where type_contact in ('chauffeur', 'hotel');
update whatsapp_conversations set type_source = 'nani' where type_contact is not null and type_source is null;
alter table whatsapp_conversations enable trigger whatsapp_proteger_classement;

alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_type_contact_check;
alter table whatsapp_conversations add constraint whatsapp_conversations_type_contact_check check (type_contact is null or type_contact in ('client', 'apporteur', 'partenaire'));

-- 2. Confirmer un type déduit depuis l'outil (même politique que le reste du classement, migration 63).
grant update (type_source) on whatsapp_conversations to authenticated;

-- 5. Qui a posé le type.
create or replace function whatsapp_type_source() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    if old.type_contact is null and new.type_contact is not null then
      if new.type_contact = 'partenaire' and old.type_source is null and old.reponses is distinct from 'jamais' and old.partenaire_id is null and new.partenaire_id is null
         and old.client_id is null and new.client_id is null and old.dossier_id is null and new.dossier_id is null then
        new.type_source := 'deduit';
      else
        new.type_contact := old.type_contact;
        new.type_source := old.type_source;
      end if;
    else
      new.type_source := old.type_source;
    end if;
  else
    new.type_avis := old.type_avis;
    new.type_signaux := old.type_signaux;
    if new.type_contact is distinct from old.type_contact then
      new.type_source := 'nani';
    elsif new.type_source is distinct from old.type_source then
      new.type_source := case when new.type_source = 'nani' and old.type_contact is not null then 'nani' else old.type_source end;
    end if;
  end if;
  return new;
end
$$;
revoke all on function whatsapp_type_source() from public, anon, authenticated;
drop trigger if exists whatsapp_type_source on whatsapp_conversations;
create trigger whatsapp_type_source before update on whatsapp_conversations for each row execute function whatsapp_type_source();

-- 6. Une décision du tri ajoutée sans en perdre une autre.
create or replace function whatsapp_ajouter_avis_type(conv uuid, decision jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d jsonb;
  res jsonb;
begin
  if decision is null or jsonb_typeof(decision) <> 'object' or coalesce(decision->>'type', '') not in ('client', 'partenaire', 'apporteur', 'personnel', 'inconnu') then
    raise exception 'décision de type illisible';
  end if;
  d := jsonb_build_object('type', decision->>'type', 'raison', left(coalesce(decision->>'raison', ''), 120), 'm', decision->'m', 'le', to_jsonb(now()));
  update whatsapp_conversations w
  set type_avis = jsonb_build_object('v', 1, 'decisions', (
    select coalesce(jsonb_agg(x.e order by x.n), '[]'::jsonb)
    from (
      select y.e, y.n from (
        select a.e, a.n from jsonb_array_elements(case when jsonb_typeof(w.type_avis->'decisions') = 'array' then w.type_avis->'decisions' else '[]'::jsonb end) with ordinality a(e, n)
        where d->>'m' is null or a.e->>'m' is distinct from d->>'m'
        union all
        select d, 1000000
      ) y
      order by y.n desc
      limit 5
    ) x
  ))
  where w.id = conv and w.reponses is distinct from 'jamais'
  returning w.type_avis into res;
  return res;
end
$$;
revoke all on function whatsapp_ajouter_avis_type(uuid, jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function whatsapp_ajouter_avis_type(uuid, jsonb) to service_role';
  end if;
end $$;

commit;
