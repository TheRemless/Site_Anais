-- Retour en arrière de la migration 69 (l'IA lit tous les contacts WhatsApp sauf le contact personnel).
-- La 69 n'a pas gardé la liste des conversations qu'elle a rouvertes : ce retour ne peut pas savoir lesquelles étaient « jamais ». Il ferme
-- donc TOUTES les conversations typées partenaire, chauffeur ou hôtel, y compris celles que Nani avait rouvertes elle-même (menu « … ») ou
-- typées après la 69. Un contact sans type (Personnel), un client et un apporteur ne changent pas.
-- Le code doit revenir aussi (fonctions agent et whatsapp, écran WhatsApp de la PR d'avant), sinon un partenaire rouvert par Nani reste lu.
-- Avant (lecture seule) :
--   select type_contact, reponses, count(*) from whatsapp_conversations where type_contact in ('partenaire','chauffeur','hotel') group by 1, 2;
-- Même contournement du déclencheur whatsapp_proteger_classement que la 69, dans la transaction.
begin;

alter table whatsapp_conversations disable trigger whatsapp_proteger_classement;

update whatsapp_conversations
set reponses = 'jamais'
where type_contact in ('partenaire', 'chauffeur', 'hotel')
  and reponses <> 'jamais';

alter table whatsapp_conversations enable trigger whatsapp_proteger_classement;

do $$
begin
  if to_regprocedure('public.whatsapp_partenaires_parmi(text[])') is not null then
    comment on function whatsapp_partenaires_parmi(text[]) is null;
  end if;
end $$;

commit;
