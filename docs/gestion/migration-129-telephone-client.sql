-- Gestion : migration 129 (26.11.2026), téléphone d'un client : un numéro international coupé est refusé par la base.
-- À exécuter une seule fois, après la migration 128, avec l'outil du même commit. Idempotente. Ne modifie aucune donnée.
-- Retour en arrière : retour-129-telephone-client.sql.
--
-- « +1 (555) 010-4477 (trait d’union insécable) » copié depuis WhatsApp sur iPhone (trait d'union insécable U+2011) a été lu « +1555010 » par l'outil et
-- enregistré tel quel. L'outil lit maintenant ces caractères et refuse un numéro incomplet ; la base refuse aussi, quel que soit l'écran.
-- Règle, appliquée seulement quand le numéro est écrit ou changé depuis l'application (rôles authenticated et anon) et qu'il commence par « + » :
--   8 à 15 chiffres ; +1 (Amérique du Nord), +33 (France) et +41 (Suisse) : 11 chiffres exactement.
-- Un ancien numéro local (« 079… ») reste accepté, comme dans l'outil. Les fonctions de la base (fusion de fiches, restauration de la
-- corbeille, liaison WhatsApp) ne sont pas bloquées : elles recopient un numéro déjà enregistré.
-- Relevé du 26.11.2026 en lecture seule : deux fiches de Secret n'y répondent pas (7 chiffres), elles restent telles quelles jusqu'à leur correction.
begin;

create or replace function controler_telephone_client() returns trigger
language plpgsql set search_path = public as $$
declare
  t text := btrim(coalesce(new.telephone, ''));
  chiffres text := regexp_replace(t, '\D', '', 'g');
  n integer := length(regexp_replace(t, '\D', '', 'g'));
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'UPDATE' and new.telephone is not distinct from old.telephone then return new; end if;
  if t = '' or left(t, 1) <> '+' then return new; end if;
  if n < 8 or n > 15 or (chiffres like '1%' and n <> 11) or ((chiffres like '33%' or chiffres like '41%') and n <> 11) then
    raise exception 'Téléphone du client incomplet ou trop long (% chiffres) : vérifiez le numéro.', n using errcode = '22023';
  end if;
  return new;
end
$$;

drop trigger if exists controler_telephone_client on clients;
create trigger controler_telephone_client before insert or update of telephone on clients
  for each row execute function controler_telephone_client();

commit;
