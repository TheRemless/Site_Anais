-- Gestion : migration 132, message automatique de nuit sur le WhatsApp de Nani (demande de Jérémy du 27.11.2026).
-- Nani met son téléphone en mode avion la nuit : le message d'absence de l'app WhatsApp Business ne part pas. La fonction « whatsapp » l'envoie
-- à sa place par Telnyx, à un client ou un inconnu qui écrit entre 22:00 et 06:00 (heure de Bangkok), une seule fois par personne et par nuit.
-- Suit les 129 à 131 (PR 356, 358 et 359) sans en dépendre : ne touche que les tables WhatsApp (migrations 58, 60, 64, 65, 68, 110).
--
--   1. whatsapp_reglages : nuit_active (activé par défaut), nuit_texte (le texte de Jérémy du 27.11.2026, mot pour mot), nuit_debut et nuit_fin
--      (22:00 et 06:00 par défaut, heure de Bangkok). Changés seulement par whatsapp_regler_nuit (7), jamais par une écriture directe.
--   2. whatsapp_messages.automatique : « nuit » pour le message envoyé ainsi. Il est rangé comme un envoi de l'équipe (sens « sortant »,
--      origine « gestion », statut_envoi de la migration 64) et l'écran le marque « Message automatique de nuit ».
--   3. whatsapp_messages_nuit : une ligne par conversation et par nuit (contrainte unique). La nuit a pour clé la date du soir où elle commence :
--      un message à 01:00 le 28 appartient à la nuit du 27. Deux webhooks à la même seconde : un seul insère, l'autre ne fait rien.
--   4. whatsapp_reserver_nuit(message) : en une transaction, contrôle tout (5), réserve la nuit et range le message « envoi » AVANT l'appel à
--      Telnyx. Rend la ligne à envoyer, ou rien. Clé de service seulement.
--   5. Ne part pas : pour un message qui n'est pas un message du client (statut, réaction, ligne « non transmis », message supprimé, message
--      de Nani), pour un Contact personnel (reponses = 'jamais'), un partenaire, un apporteur ou une fiche partenaire (type_contact autre que
--      client, partenaire_id posé, ou numéro d'un contact sans type trouvé dans les fiches partenaires de Secret ou de Taxi), pour une
--      conversation sans numéro, réglage coupé, numéro de l'entreprise inconnu, message de jour, message d'une nuit déjà finie (rattrapage
--      tardif), ou si l'équipe a déjà écrit dans la conversation depuis le début de cette nuit.
--   6. whatsapp_nuit_resultat(ligne, résultat) : note le résultat de Telnyx sur la ligne et sur le message en une transaction.
--      envoye : parti ; echec : refus sûr de Telnyx, repris par le cron (3 essais en tout, la même nuit seulement) ; incertain : délai dépassé
--      ou 5xx, jamais renvoyé (il est peut-être parti), le message passe « à vérifier » après 5 minutes comme tout envoi de Gestion.
--      whatsapp_reprendre_nuit(org) : appelé par la reprise (pg_cron « whatsapp-reprise », toutes les 5 minutes, déjà en place). Une réservation
--      restée « reserve » plus de 2 minutes (instance arrêtée en route) devient « incertain », jamais renvoyée. Un message du client des
--      30 dernières minutes resté sans réservation (panne passagère de la fonction ou de la base) est réservé ici. 3 envois au plus par passage.
--   7. whatsapp_regler_nuit(org, active, texte, debut, fin, lu_le) : Réglages > WhatsApp. Administrateur de Secret ou de Taxi de l'organisation
--      (whatsapp_ecrit, comme les autres écritures WhatsApp), contrôlé ici et non dans l'écran. Refuse un texte qui cite un partenaire ou
--      contient un montant égal à un net du catalogue de Secret ou de Taxi, une plage de plus de 12 heures, et un réglage changé ailleurs
--      depuis sa lecture (nuit_modifie_le).
--   8. whatsapp_apercu (migration 65), whatsapp_recalculer_dernier (migration 64) et whatsapp_confirmer_envoi (migration 64) ignorent le
--      message automatique : au matin, la liste montre toujours le message du client et « Le client attend une réponse » ; « C'est parti » ou
--      « Pas parti » sur un autre envoi ne le touchent pas.
--
-- À exécuter AVANT de déployer la fonction « whatsapp » de cette PR (l'ancienne fonction ignore tout cela). Ne modifie aucune donnée existante.
-- Se rejoue sans effet (le texte et les heures déjà réglés restent).
-- Retour en arrière : docs/gestion/retour-132-whatsapp-message-nuit.sql.
-- Contrôle :
--   select nuit_active, nuit_debut, nuit_fin, left(nuit_texte, 40) from whatsapp_reglages;
--   select nuit, statut, essais, count(*) from whatsapp_messages_nuit group by 1, 2, 3 order by 1 desc;
-- Contrôle PGlite : docs/gestion/verif-whatsapp-message-nuit.mjs.

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_conversations' and column_name = 'type_contact') then
    raise exception 'Migration 68 absente : la colonne whatsapp_conversations.type_contact manque.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_messages' and column_name = 'statut_envoi') then
    raise exception 'Migration 64 absente : la colonne whatsapp_messages.statut_envoi manque.';
  end if;
end $$;

-- Durée d'une plage en minutes (22:00 à 06:00 : 480). Une nuit dure 12 heures au plus (relecture de la PR 364 : 06:00 à 22:00 aurait
-- répondu toute la journée).
create or replace function whatsapp_nuit_minutes(p_debut time, p_fin time) returns integer language sql immutable set search_path = public, pg_temp as $$
  select ((extract(epoch from p_fin)::integer / 60 - extract(epoch from p_debut)::integer / 60) + 1440) % 1440
$$;

-- 1. Réglages.
alter table whatsapp_reglages add column if not exists nuit_active boolean not null default true;
alter table whatsapp_reglages add column if not exists nuit_texte text not null default $nuit$🌴 Hello and thank you for contacting us !

Our team is currently away, but we’ll get back to you as soon as possible around 7:00 AM (Thailand time).

In the meantime, please feel free to send us all the details of your request so we can assist you more efficiently.

The more details you share, the more accurately we can assist you when we get back to you !

Thank you for your patience. We look forward to helping you discover Thailand ! 🇹🇭🌴$nuit$;
alter table whatsapp_reglages add column if not exists nuit_debut time not null default '22:00';
alter table whatsapp_reglages add column if not exists nuit_fin time not null default '06:00';
-- Dernier enregistrement du réglage depuis l'écran : l'enregistrement suivant doit l'avoir lu (deux personnes en même temps).
alter table whatsapp_reglages add column if not exists nuit_modifie_le timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_reglages'::regclass and conname = 'whatsapp_reglages_nuit_texte_check') then
    -- 4 096 octets : la limite de Telnyx pour un texte WhatsApp (whatsapp-envoi/calc.js, TEXTE_MAX_OCTETS).
    alter table whatsapp_reglages add constraint whatsapp_reglages_nuit_texte_check check (length(btrim(nuit_texte)) > 0 and octet_length(nuit_texte) <= 4096);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_reglages'::regclass and conname = 'whatsapp_reglages_nuit_heures_check') then
    alter table whatsapp_reglages add constraint whatsapp_reglages_nuit_heures_check
      check (nuit_debut <> nuit_fin and date_trunc('minute', nuit_debut::interval) = nuit_debut::interval and date_trunc('minute', nuit_fin::interval) = nuit_fin::interval
        and whatsapp_nuit_minutes(nuit_debut, nuit_fin) <= 720);
  end if;
end $$;

-- 2. Le message automatique dans la conversation.
alter table whatsapp_messages add column if not exists automatique text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_messages'::regclass and conname = 'whatsapp_messages_automatique_check') then
    alter table whatsapp_messages add constraint whatsapp_messages_automatique_check check (automatique is null or automatique = 'nuit');
  end if;
end $$;

-- 3. Une nuit par conversation.
create table if not exists whatsapp_messages_nuit (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  conversation_id uuid not null references whatsapp_conversations (id) on delete cascade,
  nuit date not null,
  -- Le message du client qui l'a déclenché, et le message automatique rangé dans la conversation.
  declencheur_id uuid references whatsapp_messages (id) on delete set null,
  message_id uuid references whatsapp_messages (id) on delete set null,
  statut text not null default 'reserve' check (statut in ('reserve', 'envoye', 'echec', 'incertain', 'abandonne')),
  essais integer not null default 1 check (essais between 1 and 10),
  pris_le timestamptz not null default now(),
  envoye_le timestamptz,
  erreur text check (erreur is null or length(erreur) <= 200),
  cree_le timestamptz not null default now(),
  constraint whatsapp_messages_nuit_une_fois unique (conversation_id, nuit)
);
create index if not exists whatsapp_messages_nuit_a_reprendre on whatsapp_messages_nuit (organisation_id, pris_le) where statut in ('reserve', 'echec');
alter table whatsapp_messages_nuit enable row level security;
revoke all on whatsapp_messages_nuit from public, anon, authenticated;

-- Clé de la nuit d'un instant : la date (heure de Bangkok) du soir où la nuit commence, ou null de jour. Une plage qui ne passe pas minuit
-- (01:00 à 05:00) a pour clé la date du jour. Bangkok n'a pas d'heure d'été.
create or replace function whatsapp_nuit_cle(p_quand timestamptz, p_debut time, p_fin time) returns date
language sql stable set search_path = public, pg_temp as $$
  select case
    when p_quand is null or p_debut is null or p_fin is null or p_debut = p_fin then null
    when p_debut > p_fin then case when l::time >= p_debut then l::date when l::time < p_fin then (l::date - 1) end
    else case when l::time >= p_debut and l::time < p_fin then l::date end
  end
  from (select p_quand at time zone 'Asia/Bangkok' as l) x
$$;

-- Le numéro est-il celui d'une fiche partenaire de Secret ou de Taxi de l'organisation (apporteurs compris) ? Même lecture des numéros que
-- whatsapp_partenaires_parmi (migration 67) : contact.telephones en liste (texte, ou objet numero / telephone / valeur) ou en texte coupé ;
-- comparé sur les 9 derniers chiffres. Relecture de la PR 364 : un nouveau numéro d'un partenaire n'a pas encore de type.
create or replace function whatsapp_numero_partenaire(p_org uuid, p_tel text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  with fiches as (
    select p.contact->'telephones' as tel
    from partenaires p join entites e on e.id = p.entite_id
    where e.organisation_id = p_org and e.slug in ('secret', 'taxi')
  ),
  morceaux as (
    select case jsonb_typeof(x) when 'string' then x #>> '{}' when 'object' then coalesce(nullif(x->>'numero', ''), nullif(x->>'telephone', ''), x->>'valeur', '') else '' end as v
    from fiches f, jsonb_array_elements(case jsonb_typeof(f.tel) when 'array' then f.tel else '[]'::jsonb end) as x
    union all
    select v from fiches f, regexp_split_to_table(case jsonb_typeof(f.tel) when 'string' then f.tel #>> '{}' else '' end, '[,;/\n]|\s{2,}') as v
  )
  select length(regexp_replace(coalesce(p_tel, ''), '[^0-9]', '', 'g')) >= 8 and exists (
    select 1 from morceaux, regexp_matches(coalesce(v, ''), '(\+?\d[\d\s.\-()]{6,}\d)', 'g') as m
    where length(regexp_replace(m[1], '[^0-9]', '', 'g')) >= 8
      and right(regexp_replace(m[1], '[^0-9]', '', 'g'), 9) = right(regexp_replace(p_tel, '[^0-9]', '', 'g'), 9)
  )
$$;

-- 5. Pourquoi le message de nuit ne part pas vers cette conversation pour un message reçu à p_quand (null : il peut partir). Rend aussi la clé
--    de la nuit. Relu à la réservation et à chaque reprise.
create or replace function whatsapp_nuit_motif(p_conversation uuid, p_quand timestamptz, out motif text, out nuit date)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c record;
  r record;
begin
  select w.id, w.organisation_id, w.telephone, w.reponses, w.type_contact, w.partenaire_id into c from whatsapp_conversations w where w.id = p_conversation;
  if c.id is null then motif := 'conversation'; return; end if;
  if c.telephone is null then motif := 'sans_numero'; return; end if;
  -- Contact personnel (reponses = 'jamais', migration 60), partenaire ou apporteur (migrations 68 et 110), fiche partenaire.
  if c.reponses = 'jamais' then motif := 'personnel'; return; end if;
  if coalesce(c.type_contact, 'client') <> 'client' or c.partenaire_id is not null then motif := 'pas_client'; return; end if;
  if c.type_contact is null and whatsapp_numero_partenaire(c.organisation_id, c.telephone) then motif := 'pas_client'; return; end if;
  select x.nuit_active, x.nuit_debut, x.nuit_fin, x.numero into r from whatsapp_reglages x where x.organisation_id = c.organisation_id;
  if r.nuit_active is null or not r.nuit_active then motif := 'coupe'; return; end if;
  if r.numero is null then motif := 'numero_inconnu'; return; end if;
  nuit := whatsapp_nuit_cle(p_quand, r.nuit_debut, r.nuit_fin);
  if nuit is null then motif := 'jour'; return; end if;
  -- Le message est de cette nuit, et c'est encore cette nuit : un message de 05:59 rangé à 06:01 n'appelle aucune réponse.
  if nuit is distinct from whatsapp_nuit_cle(now(), r.nuit_debut, r.nuit_fin) then motif := 'nuit_finie'; return; end if;
  -- L'équipe a déjà écrit depuis le début de la nuit (app ou Gestion ; un envoi en échec n'est pas une réponse).
  if exists (select 1 from whatsapp_messages s where s.conversation_id = c.id and s.sens = 'sortant' and s.automatique is null
      and coalesce(s.statut_envoi, '') <> 'echec' and s.envoye_le >= ((nuit + r.nuit_debut) at time zone 'Asia/Bangkok')) then
    motif := 'deja_repondu'; return;
  end if;
end
$$;

-- 4. Réservation : un message du client vient d'être rangé. Tout se décide ici, en une transaction, sous le verrou de la conversation.
create or replace function whatsapp_reserver_nuit(p_message uuid)
returns table (id uuid, message_id uuid, telephone text, numero text, texte text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m record;
  c record;
  r record;
  v record;
  res uuid;
  msg uuid;
begin
  select x.id, x.conversation_id, x.sens, x.origine, x.type, x.envoye_le, x.supprime_le, x.automatique into m from whatsapp_messages x where x.id = p_message;
  if m.id is null or m.sens <> 'entrant' or m.origine <> 'client' or m.type in ('reaction', 'non_transmis') or m.supprime_le is not null or m.automatique is not null then
    return;
  end if;
  -- Le verrou de la conversation range les deux webhooks d'une même seconde l'un après l'autre ; la contrainte unique fait le reste.
  select w.id, w.organisation_id, w.telephone into c from whatsapp_conversations w where w.id = m.conversation_id for update;
  select * into v from whatsapp_nuit_motif(m.conversation_id, m.envoye_le);
  if v.motif is not null then return; end if;
  select x.numero, x.nuit_texte into r from whatsapp_reglages x where x.organisation_id = c.organisation_id;
  insert into whatsapp_messages_nuit (organisation_id, conversation_id, nuit, declencheur_id)
  values (c.organisation_id, c.id, v.nuit, m.id)
  on conflict on constraint whatsapp_messages_nuit_une_fois do nothing
  returning whatsapp_messages_nuit.id into res;
  if res is null then return; end if;
  insert into whatsapp_messages (conversation_id, sens, origine, type, texte, medias, envoye_le, statut_envoi, statut_le, automatique)
  values (c.id, 'sortant', 'gestion', 'text', r.nuit_texte, '[]'::jsonb, now(), 'envoi', now(), 'nuit')
  returning whatsapp_messages.id into msg;
  update whatsapp_messages_nuit n set message_id = msg where n.id = res;
  return query select res, msg, c.telephone, r.numero, r.nuit_texte;
end
$$;

-- 6. Résultat de l'appel à Telnyx, sur la ligne de la nuit et sur le message, en une transaction. Rend false si la ligne n'était plus à envoyer.
create or replace function whatsapp_nuit_resultat(p_id uuid, p_resultat text, p_telnyx_id text default null, p_erreur text default null)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  msg uuid;
begin
  if p_resultat not in ('envoye', 'echec', 'incertain') then raise exception 'resultat_inconnu' using errcode = '22023'; end if;
  update whatsapp_messages_nuit n set
    statut = case when p_resultat = 'echec' and n.essais >= 3 then 'abandonne' else p_resultat end,
    envoye_le = case when p_resultat = 'envoye' then now() end,
    erreur = left(nullif(p_erreur, ''), 200)
  where n.id = p_id and n.statut = 'reserve'
  returning n.message_id into msg;
  if not found then return false; end if;
  if p_resultat = 'envoye' then
    update whatsapp_messages set telnyx_id = left(nullif(p_telnyx_id, ''), 100), statut_envoi = 'envoye', erreur_envoi = null, statut_le = now()
    where id = msg and statut_envoi in ('envoi', 'echec');
  elsif p_resultat = 'echec' then
    update whatsapp_messages set statut_envoi = 'echec', erreur_envoi = left(coalesce(nullif(p_erreur, ''), 'telnyx_refuse'), 200), statut_le = now()
    where id = msg and statut_envoi = 'envoi';
  end if;
  -- incertain : le message reste « envoi » ; la reprise le passe « à vérifier » après 5 minutes (migration 64), Nani regarde dans WhatsApp.
  return true;
end
$$;

-- Reprise (toutes les 5 minutes) : les messages restés sans réservation, puis les refus sûrs, la même nuit seulement et si rien n'a changé
-- (5) ; 3 essais en tout par ligne, 3 envois au plus par passage (15 secondes chacun au plus : la reprise reste courte).
create or replace function whatsapp_reprendre_nuit(p_org uuid)
returns table (id uuid, message_id uuid, telephone text, numero text, texte text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n record;
  v record;
  r record;
  msg uuid;
  envoyes integer := 0;
begin
  -- Une réservation restée « reserve » : l'instance s'est arrêtée avant ou après l'appel, on ne sait pas. Jamais renvoyée.
  update whatsapp_messages_nuit x set statut = 'incertain', erreur = 'interrompu'
  where x.organisation_id = p_org and x.statut = 'reserve' and x.pris_le < now() - interval '2 minutes';
  -- Les lignes de plus de 60 jours ne servent plus.
  delete from whatsapp_messages_nuit x where x.organisation_id = p_org and x.cree_le < now() - interval '60 days';

  -- Rattrapage : un message du client des 30 dernières minutes sans réservation pour sa nuit (la fonction ou la base en panne au moment du
  -- message). whatsapp_reserver_nuit refait tous les contrôles ; la contrainte unique empêche tout doublon avec un envoi en cours.
  for n in
    select distinct on (m.conversation_id) m.id
    from whatsapp_messages m join whatsapp_conversations c on c.id = m.conversation_id
    join whatsapp_reglages g on g.organisation_id = c.organisation_id
    where c.organisation_id = p_org and m.sens = 'entrant' and m.origine = 'client' and m.automatique is null
      and m.recu_le > now() - interval '30 minutes' and g.nuit_active
      and whatsapp_nuit_cle(m.envoye_le, g.nuit_debut, g.nuit_fin) is not null
      and not exists (select 1 from whatsapp_messages_nuit x where x.conversation_id = m.conversation_id
        and x.nuit = whatsapp_nuit_cle(m.envoye_le, g.nuit_debut, g.nuit_fin))
    order by m.conversation_id, m.envoye_le desc
    limit 20
  loop
    exit when envoyes >= 3;
    for v in select * from whatsapp_reserver_nuit(n.id) loop
      id := v.id; message_id := v.message_id; telephone := v.telephone; numero := v.numero; texte := v.texte;
      envoyes := envoyes + 1;
      return next;
    end loop;
  end loop;
  if envoyes >= 3 then return; end if;

  for n in
    select x.id, x.conversation_id, x.message_id, x.nuit, x.essais from whatsapp_messages_nuit x
    where x.organisation_id = p_org and x.statut = 'echec' and x.pris_le < now() - interval '1 minute'
    order by x.pris_le limit 3 - envoyes
    for update of x skip locked
  loop
    -- Mêmes contrôles qu'à la réservation, à l'heure de la reprise (now()) : la nuit doit être celle de la ligne, et pas encore finie.
    select * into v from whatsapp_nuit_motif(n.conversation_id, now());
    if v.motif is not null or v.nuit is distinct from n.nuit then
      update whatsapp_messages_nuit x set statut = 'abandonne', erreur = left(coalesce(v.motif, 'autre_nuit'), 200) where x.id = n.id;
      continue;
    end if;
    select c.telephone, g.numero, g.nuit_texte into r
    from whatsapp_conversations c join whatsapp_reglages g on g.organisation_id = c.organisation_id where c.id = n.conversation_id;
    -- Le message de l'essai précédent (en échec) repart ; retiré entre-temps par « Pas parti », il est rangé de nouveau.
    update whatsapp_messages w set statut_envoi = 'envoi', erreur_envoi = null, envoye_le = now(), statut_le = now()
    where w.id = n.message_id and w.statut_envoi = 'echec' and w.automatique = 'nuit'
    returning w.id into msg;
    if msg is null then
      insert into whatsapp_messages (conversation_id, sens, origine, type, texte, medias, envoye_le, statut_envoi, statut_le, automatique)
      values (n.conversation_id, 'sortant', 'gestion', 'text', r.nuit_texte, '[]'::jsonb, now(), 'envoi', now(), 'nuit')
      returning whatsapp_messages.id into msg;
    end if;
    update whatsapp_messages_nuit x set statut = 'reserve', essais = least(x.essais + 1, 10), pris_le = now(), message_id = msg, erreur = null where x.id = n.id;
    id := n.id; message_id := msg; telephone := r.telephone; numero := r.numero; texte := r.nuit_texte;
    envoyes := envoyes + 1;
    return next;
    msg := null;
  end loop;
end
$$;

-- 7. Réglages > WhatsApp. Rend les réglages enregistrés et leur nouvelle date. p_lu_le : nuit_modifie_le tel que l'écran l'a lu (null avant
--    le premier enregistrement) ; changé depuis, l'enregistrement est refusé (modifie_ailleurs), personne n'écrase l'autre sans le voir.
--    Le texte part chez tous les clients de la nuit : comme pour une réponse (garde-fou de la PR 278), il ne cite aucun partenaire de Secret
--    ou de Taxi (nom entier, ou sans « co, ltd, company, tour, travel ») et ne contient aucun montant égal à un net de leur catalogue. Les
--    heures (7:00, 22h00) ne sont pas des montants.
-- Une signature plus ancienne de whatsapp_regler_nuit (sans p_lu_le), si une version de travail de la 132 a été jouée sur une base de test.
drop function if exists whatsapp_regler_nuit(uuid, boolean, text, time, time);
create or replace function whatsapp_regler_nuit(p_org uuid, p_active boolean, p_texte text, p_debut time, p_fin time, p_lu_le timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ligne record;
  plat text;
begin
  if auth.uid() is null or p_org is null or not whatsapp_ecrit(null, p_org) then
    raise exception 'droit_manquant' using errcode = '42501';
  end if;
  if p_active is null or p_texte is null or length(btrim(p_texte)) = 0 then raise exception 'texte_vide' using errcode = '22023'; end if;
  if octet_length(p_texte) > 4096 then raise exception 'texte_trop_long' using errcode = '22023'; end if;
  if p_debut is null or p_fin is null or p_debut = p_fin or date_trunc('minute', p_debut::interval) <> p_debut::interval or date_trunc('minute', p_fin::interval) <> p_fin::interval then
    raise exception 'heures_invalides' using errcode = '22023';
  end if;
  if whatsapp_nuit_minutes(p_debut, p_fin) > 720 then raise exception 'plage_trop_longue' using errcode = '22023'; end if;
  -- Noms de partenaires : comparés mot à mot, en minuscules, sans ponctuation.
  plat := ' ' || btrim(regexp_replace(lower(p_texte), '[^[:alnum:]]+', ' ', 'g')) || ' ';
  if exists (
    select 1 from partenaires p join entites e on e.id = p.entite_id,
      lateral (select btrim(regexp_replace(lower(p.nom), '[^[:alnum:]]+', ' ', 'g')) as entier) n,
      lateral (select btrim(regexp_replace(regexp_replace(n.entier, '\m(co|ltd|company|tour|tours|travel|travels)\M', ' ', 'g'), '\s+', ' ', 'g')) as court) k
    where e.organisation_id = p_org and e.slug in ('secret', 'taxi')
      and ((length(n.entier) >= 3 and plat like '% ' || n.entier || ' %') or (length(k.court) >= 4 and plat like '% ' || k.court || ' %'))
  ) then
    raise exception 'nom_partenaire' using errcode = '22023';
  end if;
  -- Montants : chaque nombre du texte (séparateurs de milliers retirés), sans les heures.
  if exists (
    with nombres as (
      select regexp_replace(m[1], '[^0-9]', '', 'g')::numeric as v
      from regexp_matches(regexp_replace(p_texte, '\d{1,2}\s*[:h.]\s*\d{2}', ' ', 'gi'), '(\d{1,3}(?:[ ,.]\d{3})+|\d+)', 'g') as m
    ),
    nets as (
      select x.net as v from prestations_nets x join entites e on e.id = x.entite_id where e.organisation_id = p_org and e.slug in ('secret', 'taxi')
      union all select x.net_enfant from prestations_nets x join entites e on e.id = x.entite_id where e.organisation_id = p_org and e.slug in ('secret', 'taxi')
      union all select x.net_adulte from trajets_nets x join entites e on e.id = x.entite_id where e.organisation_id = p_org and e.slug in ('secret', 'taxi')
      union all select x.net_enfant from trajets_nets x join entites e on e.id = x.entite_id where e.organisation_id = p_org and e.slug in ('secret', 'taxi')
    )
    select 1 from nombres n join nets t on t.v = n.v where t.v > 0
  ) then
    raise exception 'montant_net' using errcode = '22023';
  end if;
  update whatsapp_reglages set nuit_active = p_active, nuit_texte = p_texte, nuit_debut = p_debut, nuit_fin = p_fin, nuit_modifie_le = clock_timestamp()
  where organisation_id = p_org and nuit_modifie_le is not distinct from p_lu_le
  returning organisation_id, nuit_active, nuit_texte, nuit_debut, nuit_fin, nuit_modifie_le into ligne;
  if ligne.organisation_id is null then
    if exists (select 1 from whatsapp_reglages where organisation_id = p_org) then raise exception 'modifie_ailleurs' using errcode = '40001'; end if;
    raise exception 'droit_manquant' using errcode = '42501';
  end if;
  return jsonb_build_object('organisation_id', ligne.organisation_id, 'nuit_active', ligne.nuit_active, 'nuit_texte', ligne.nuit_texte,
    'nuit_debut', to_char(ligne.nuit_debut, 'HH24:MI'), 'nuit_fin', to_char(ligne.nuit_fin, 'HH24:MI'), 'nuit_modifie_le', ligne.nuit_modifie_le);
end
$$;

-- 8. Aperçu de la liste (migration 65) : le message automatique n'est ni le dernier message montré ni une réponse.
create or replace function whatsapp_apercu(conv uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  dernier record;
  derniere_reponse timestamptz;
  attente timestamptz;
begin
  select coalesce(nullif(trim(texte), ''), (select x->>'legende' from jsonb_array_elements(medias) x where coalesce(x->>'legende', '') <> '' limit 1)) as texte, type, supprime_le
    into dernier from whatsapp_messages
    where conversation_id = conv and type <> 'reaction' and automatique is null
    order by envoye_le desc limit 1;
  -- Un envoi depuis Gestion en échec (migration 64, statut_envoi) n'est pas une réponse : le client attend toujours. Le message de nuit non plus.
  select max(envoye_le) into derniere_reponse from whatsapp_messages where conversation_id = conv and sens = 'sortant' and coalesce(statut_envoi, '') <> 'echec' and automatique is null;
  select min(envoye_le) into attente from whatsapp_messages
    where conversation_id = conv and sens = 'entrant' and supprime_le is null and type <> 'reaction'
      and envoye_le > coalesce(derniere_reponse, '-infinity'::timestamptz);
  update whatsapp_conversations set
    dernier_texte = case when dernier.supprime_le is not null then null
      else nullif(left(regexp_replace(trim(coalesce(dernier.texte, '')), '\s+', ' ', 'g'), 140), '') end,
    dernier_type = case when dernier.supprime_le is not null then 'supprime' else left(dernier.type, 20) end,
    attend_depuis = attente
  where id = conv
    and (dernier_texte is distinct from (case when dernier.supprime_le is not null then null else nullif(left(regexp_replace(trim(coalesce(dernier.texte, '')), '\s+', ' ', 'g'), 140), '') end)
      or dernier_type is distinct from (case when dernier.supprime_le is not null then 'supprime' else left(dernier.type, 20) end)
      or attend_depuis is distinct from attente);
end
$$;

-- Dernier message recalculé (migration 64, après un envoi retiré) : sans le message de nuit, qui ne fait pas passer la conversation « répondue ».
create or replace function whatsapp_recalculer_dernier(p_conversation uuid) returns void language sql security definer set search_path = public, pg_temp as $$
  update whatsapp_conversations c set
    dernier_message_le = d.envoye_le,
    dernier_sens = coalesce(d.sens, c.dernier_sens),
    non_lus = greatest(c.non_lus, d.attente)
  from (select (select envoye_le from whatsapp_messages where conversation_id = p_conversation and automatique is null order by envoye_le desc, recu_le desc limit 1) as envoye_le,
               (select sens from whatsapp_messages where conversation_id = p_conversation and automatique is null order by envoye_le desc, recu_le desc limit 1) as sens,
               (select count(*)::integer from whatsapp_messages e where e.conversation_id = p_conversation and e.sens = 'entrant'
                  and e.envoye_le > coalesce((select max(s.envoye_le) from whatsapp_messages s where s.conversation_id = p_conversation and s.sens = 'sortant' and s.automatique is null), '-infinity'::timestamptz)) as attente) d
  where c.id = p_conversation
$$;

-- « C'est parti » ou « Pas parti » (migration 64) : jamais le message automatique de nuit (relecture de la PR 364). Sinon « C'est parti »
-- solderait les réponses préparées de la conversation et « Pas parti » le retirerait du fil. Changements : automatique is null, et les
-- réponses préparées ne sont soldées que si un envoi a vraiment été confirmé.
create or replace function whatsapp_confirmer_envoi(p_conversation uuid, p_parti boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n_msg integer;
  n_prop integer;
begin
  if auth.uid() is null or p_parti is null or not whatsapp_peut_ecrire(p_conversation) then
    raise exception 'droit_manquant' using errcode = '42501';
  end if;
  if p_parti then
    update whatsapp_messages set statut_envoi = 'envoye', erreur_envoi = null, statut_le = now()
    where conversation_id = p_conversation and origine = 'gestion' and automatique is null
      and (statut_envoi = 'envoi' or (statut_envoi = 'echec' and erreur_envoi = 'sans_confirmation'));
    get diagnostics n_msg = row_count;
    -- Les réponses préparées ne sont soldées que si un envoi de l'équipe vient d'être confirmé, ou si une réponse est restée « envoi » (sans
    -- message, avant la migration 64). Rien à confirmer : rien n'est soldé.
    n_prop := 0;
    if n_msg > 0 or exists (select 1 from whatsapp_propositions where conversation_id = p_conversation and statut = 'envoi') then
      update whatsapp_propositions set statut = 'traitee', traitee_le = now(), traitee_par = auth.uid(), traitee_par_quoi = 'gestion'
      where conversation_id = p_conversation and statut in ('a_faire', 'en_cours', 'envoi');
      get diagnostics n_prop = row_count;
    end if;
  else
    delete from whatsapp_messages
    where conversation_id = p_conversation and origine = 'gestion' and automatique is null
      and (statut_envoi = 'envoi' or (statut_envoi = 'echec' and erreur_envoi = 'sans_confirmation'));
    get diagnostics n_msg = row_count;
    update whatsapp_propositions set statut = 'a_faire' where conversation_id = p_conversation and statut = 'envoi';
    get diagnostics n_prop = row_count;
    perform whatsapp_recalculer_dernier(p_conversation);
  end if;
  return jsonb_build_object('messages', n_msg, 'propositions', n_prop);
end
$$;

-- Droits.
revoke all on function whatsapp_nuit_minutes(time, time), whatsapp_numero_partenaire(uuid, text) from public, anon, authenticated;
revoke all on function whatsapp_confirmer_envoi(uuid, boolean) from public, anon;
grant execute on function whatsapp_confirmer_envoi(uuid, boolean) to authenticated;
revoke all on function whatsapp_nuit_cle(timestamptz, time, time), whatsapp_nuit_motif(uuid, timestamptz), whatsapp_reserver_nuit(uuid),
  whatsapp_nuit_resultat(uuid, text, text, text), whatsapp_reprendre_nuit(uuid), whatsapp_apercu(uuid), whatsapp_recalculer_dernier(uuid)
  from public, anon, authenticated;
revoke all on function whatsapp_regler_nuit(uuid, boolean, text, time, time, timestamptz) from public, anon;
grant execute on function whatsapp_regler_nuit(uuid, boolean, text, time, time, timestamptz) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function whatsapp_nuit_cle(timestamptz, time, time), whatsapp_nuit_motif(uuid, timestamptz), whatsapp_reserver_nuit(uuid),
      whatsapp_nuit_resultat(uuid, text, text, text), whatsapp_reprendre_nuit(uuid), whatsapp_recalculer_dernier(uuid) to service_role';
    execute 'grant select, insert, update, delete on whatsapp_messages_nuit to service_role';
  end if;
end $$;

commit;
