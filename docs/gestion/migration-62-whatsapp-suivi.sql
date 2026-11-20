-- Gestion : migration 62, suivi des conversations WhatsApp (20.11.2026). Suit la 61.
--   resume, resume_le : le résumé de la conversation en trois lignes, en haut de l'échange (Claude Haiku, texte des messages seulement,
--     numéros de compte et IBAN masqués), refait quand de nouveaux messages arrivent.
--   paiement_signale : le client a peut-être envoyé une preuve de paiement (photo, PDF, ou un texte « paid », « transferred », « virement »…)
--     dans une conversation reliée à un dossier. Repéré sans IA : une capture de virement contient un compte, elle ne part jamais chez
--     Anthropic. L'écran propose « Noter un paiement » ; Nani décide.
--   promesse_le : jour de la dernière tâche créée pour une promesse de Nani (« je vous confirme demain ») : une seule par conversation et par jour.
-- Toutes écrites par la fonction « whatsapp » (clé de service). Depuis l'outil, seulement paiement_signale remis à vide (« Ignorer »).
-- Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Retour en arrière : alter table whatsapp_conversations drop column if exists resume, drop column if exists resume_le,
--   drop column if exists paiement_signale, drop column if exists promesse_le;

begin;

alter table whatsapp_conversations add column if not exists resume text;
alter table whatsapp_conversations add column if not exists resume_le timestamptz;
alter table whatsapp_conversations add column if not exists paiement_signale jsonb;
alter table whatsapp_conversations add column if not exists promesse_le date;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_resume_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_resume_check check (resume is null or length(resume) <= 600);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_paiement_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_paiement_check check (paiement_signale is null or (jsonb_typeof(paiement_signale) = 'object' and length(paiement_signale::text) <= 500));
  end if;
end $$;

grant update (paiement_signale) on whatsapp_conversations to authenticated;

-- Depuis l'outil, le signal de paiement ne peut qu'être effacé ; le résumé et la promesse ne bougent pas.
create or replace function whatsapp_suivi_outil() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.paiement_signale is not null and new.paiement_signale is distinct from old.paiement_signale then new.paiement_signale := old.paiement_signale; end if;
    new.resume := old.resume;
    new.resume_le := old.resume_le;
    new.promesse_le := old.promesse_le;
  end if;
  return new;
end
$$;
revoke all on function whatsapp_suivi_outil() from public, anon;
drop trigger if exists whatsapp_suivi_outil on whatsapp_conversations;
create trigger whatsapp_suivi_outil before update on whatsapp_conversations for each row execute function whatsapp_suivi_outil();

commit;
