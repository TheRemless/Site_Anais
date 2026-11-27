-- Retour en arrière de la migration 132 (message automatique de nuit). Redéployer d'abord la fonction « whatsapp » d'avant la PR : l'actuelle
-- appelle whatsapp_reserver_nuit et whatsapp_reprendre_nuit, et sans elles elle n'envoie simplement rien (erreur notée dans les journaux).
-- Les messages automatiques déjà envoyés restent dans les conversations, comme des envois de Gestion ordinaires (la colonne automatique
-- disparaît). whatsapp_apercu, whatsapp_recalculer_dernier et whatsapp_confirmer_envoi reprennent leur version des migrations 65 et 64.
begin;

drop function if exists whatsapp_regler_nuit(uuid, boolean, text, time, time, timestamptz);
drop function if exists whatsapp_regler_nuit(uuid, boolean, text, time, time);
drop function if exists whatsapp_reprendre_nuit(uuid);
drop function if exists whatsapp_nuit_resultat(uuid, text, text, text);
drop function if exists whatsapp_reserver_nuit(uuid);
drop function if exists whatsapp_nuit_motif(uuid, timestamptz);
drop function if exists whatsapp_nuit_cle(timestamptz, time, time);
drop function if exists whatsapp_numero_partenaire(uuid, text);
drop table if exists whatsapp_messages_nuit;

-- Migration 65.
create or replace function whatsapp_apercu(conv uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  dernier record;
  derniere_reponse timestamptz;
  attente timestamptz;
begin
  select coalesce(nullif(trim(texte), ''), (select x->>'legende' from jsonb_array_elements(medias) x where coalesce(x->>'legende', '') <> '' limit 1)) as texte, type, supprime_le
    into dernier from whatsapp_messages
    where conversation_id = conv and type <> 'reaction'
    order by envoye_le desc limit 1;
  select max(envoye_le) into derniere_reponse from whatsapp_messages where conversation_id = conv and sens = 'sortant' and coalesce(statut_envoi, '') <> 'echec';
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

-- Migration 64.
create or replace function whatsapp_recalculer_dernier(p_conversation uuid) returns void language sql security definer set search_path = public as $$
  update whatsapp_conversations c set
    dernier_message_le = d.envoye_le,
    dernier_sens = coalesce(d.sens, c.dernier_sens),
    non_lus = greatest(c.non_lus, d.attente)
  from (select (select envoye_le from whatsapp_messages where conversation_id = p_conversation order by envoye_le desc, recu_le desc limit 1) as envoye_le,
               (select sens from whatsapp_messages where conversation_id = p_conversation order by envoye_le desc, recu_le desc limit 1) as sens,
               (select count(*)::integer from whatsapp_messages e where e.conversation_id = p_conversation and e.sens = 'entrant'
                  and e.envoye_le > coalesce((select max(s.envoye_le) from whatsapp_messages s where s.conversation_id = p_conversation and s.sens = 'sortant'), '-infinity'::timestamptz)) as attente) d
  where c.id = p_conversation
$$;
revoke all on function whatsapp_apercu(uuid), whatsapp_recalculer_dernier(uuid) from public, anon, authenticated;

-- Migration 64.
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
    where conversation_id = p_conversation and origine = 'gestion'
      and (statut_envoi = 'envoi' or (statut_envoi = 'echec' and erreur_envoi = 'sans_confirmation'));
    get diagnostics n_msg = row_count;
    update whatsapp_propositions set statut = 'traitee', traitee_le = now(), traitee_par = auth.uid(), traitee_par_quoi = 'gestion'
    where conversation_id = p_conversation and statut in ('a_faire', 'en_cours', 'envoi');
    get diagnostics n_prop = row_count;
  else
    delete from whatsapp_messages
    where conversation_id = p_conversation and origine = 'gestion'
      and (statut_envoi = 'envoi' or (statut_envoi = 'echec' and erreur_envoi = 'sans_confirmation'));
    get diagnostics n_msg = row_count;
    update whatsapp_propositions set statut = 'a_faire' where conversation_id = p_conversation and statut = 'envoi';
    get diagnostics n_prop = row_count;
    perform whatsapp_recalculer_dernier(p_conversation);
  end if;
  return jsonb_build_object('messages', n_msg, 'propositions', n_prop);
end
$$;

alter table whatsapp_messages drop constraint if exists whatsapp_messages_automatique_check;
alter table whatsapp_messages drop column if exists automatique;
alter table whatsapp_reglages drop constraint if exists whatsapp_reglages_nuit_texte_check;
alter table whatsapp_reglages drop constraint if exists whatsapp_reglages_nuit_heures_check;
alter table whatsapp_reglages drop column if exists nuit_active, drop column if exists nuit_texte, drop column if exists nuit_debut, drop column if exists nuit_fin,
  drop column if exists nuit_modifie_le;
drop function if exists whatsapp_nuit_minutes(time, time);
drop function if exists whatsapp_nuit_plage_valide(time, time);
drop function if exists whatsapp_nuit_texte_defaut();

commit;
