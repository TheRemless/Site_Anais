-- Retour en arrière de la migration 68 (contacts WhatsApp typés et apporteurs d'affaires). Les types, les fiches reliées, les apporteurs des
-- dossiers sont perdus ; les fiches « apporteur » restent des partenaires. Le contact personnel (reponses = 'jamais') reste.
-- whatsapp_proteger_classement revient à la version de la migration 60. L'écran relit les conversations sans ces colonnes.
begin;
drop trigger if exists controler_apporteur_dossier on dossiers;
drop function if exists controler_apporteur_dossier();
drop index if exists dossiers_apporteur;
alter table dossiers drop column if exists apporteur_id;

drop trigger if exists whatsapp_type_coherent on whatsapp_conversations;
drop function if exists whatsapp_type_coherent();
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
    new.tri := old.tri;
  end if;
  return new;
end
$$;
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_type_contact_check;
drop index if exists whatsapp_conversations_partenaire;
alter table whatsapp_conversations drop column if exists partenaire_id, drop column if exists type_contact;
commit;
