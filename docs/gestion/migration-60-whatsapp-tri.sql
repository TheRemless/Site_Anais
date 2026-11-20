-- Gestion : migration 60, tri des messages WhatsApp et classement de Nani protégé (demande de Jérémy, 20.11.2026). Suit la 59.
--   1. Le classement de Nani ne bouge plus jamais tout seul. Une conversation rangée (entreprise), reliée (client, dossier) ou réglée
--      (interrupteur ci-dessous) ne peut être changée que depuis l'outil par une personne. La fonction « whatsapp » (clé de service) ne
--      peut plus modifier ces colonnes une fois remplies : le déclencheur whatsapp_proteger_classement remet l'ancienne valeur.
--      Les étiquettes de l'app WhatsApp Business de Nani ne passent pas par Gestion (Meta ne les transmet pas en coexistence) : Gestion ne
--      les lit ni ne les modifie.
--   2. reponses : interrupteur par contact. « auto » (défaut) : la fonction trie chaque message et prépare une réponse seulement pour une
--      vraie demande de client. « jamais » : aucune réponse préparée pour ce contact (ami, famille, partenaire, chauffeur), sauf si Nani
--      touche « Préparer une réponse ».
--   3. tri : la dernière décision du tri (préparer ou non, motif, entreprise suggérée, date), écrite par la fonction, lue par l'écran.
-- Ne modifie aucune donnée existante. Se rejoue sans effet.
-- Retour en arrière :
--   drop trigger if exists whatsapp_proteger_classement on whatsapp_conversations; drop function if exists whatsapp_proteger_classement();
--   alter table whatsapp_conversations drop column if exists reponses, drop column if exists tri;
-- Contrôle :
--   select reponses, tri->>'motif' motif, count(*) from whatsapp_conversations group by 1, 2;

begin;

alter table whatsapp_conversations add column if not exists reponses text not null default 'auto';
alter table whatsapp_conversations add column if not exists tri jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_reponses_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_reponses_check check (reponses in ('auto', 'jamais'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.whatsapp_conversations'::regclass and conname = 'whatsapp_conversations_tri_check') then
    alter table whatsapp_conversations add constraint whatsapp_conversations_tri_check check (jsonb_typeof(tri) = 'object' and length(tri::text) <= 1000);
  end if;
end $$;

-- L'interrupteur se change depuis l'outil par qui lit la conversation (administrateurs de Secret et Taxi, politique de la migration 59).
grant update (reponses) on whatsapp_conversations to authenticated;

-- Le classement de Nani est protégé : sans personne connectée (la fonction), une entreprise, un client, un dossier ou un interrupteur déjà
-- posé ne change pas. Une personne connectée garde les règles de la migration 59 (whatsapp_reclasser, qui passe après celui-ci).
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
  else
    -- Une personne ne réécrit pas la décision du tri (elle vient de la fonction).
    new.tri := old.tri;
  end if;
  return new;
end
$$;
revoke all on function whatsapp_proteger_classement() from public, anon;
drop trigger if exists whatsapp_proteger_classement on whatsapp_conversations;
-- Le nom fait passer ce déclencheur avant whatsapp_reclasser (ordre alphabétique des déclencheurs BEFORE).
create trigger whatsapp_proteger_classement before update on whatsapp_conversations for each row execute function whatsapp_proteger_classement();

commit;
