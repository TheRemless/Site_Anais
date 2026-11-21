-- Gestion : migration 69, l'IA lit tous les contacts WhatsApp sauf le contact personnel (demande de Jérémy du 21.11.2026). Suit la 68 (PR 298).
-- « enlève moi cette règle que les trucs ne sont pas envoyés à l'IA si ce n'est pas un client parce que ca me bloque pour plusieurs raisons. »
--
-- À lancer AVANT, en lecture seule, pour savoir combien de conversations vont changer :
--   select type_contact, count(*) from whatsapp_conversations where type_contact in ('partenaire','chauffeur','hotel') and reponses = 'jamais' group by 1;
--
-- Ce qui change dans le code (fonctions agent et whatsapp, écran WhatsApp) :
--   1. Partenaire, chauffeur, hôtel et apporteur se lisent comme un client : outils de l'Assistant, tri, suivi, « Préparer une réponse ».
--      Le numéro d'une fiche partenaire n'écarte plus une conversation.
--   2. Taper un type dans l'écran ne met plus les réponses à « jamais ». Seule la puce « Personnel » ferme l'IA (reponses = 'jamais', type vide).
--   3. whatsapp_partenaires_parmi (migration 67) n'est plus appelée par la fonction « agent ». Elle reste en base, sans appel : elle ne rend
--      que des clés de numéros déjà lisibles par la personne. Elle n'est pas supprimée ici.
--
-- Ce que fait ce fichier (les données) : les conversations typées partenaire, chauffeur ou hôtel restées sur « jamais » par l'ancien couplage
-- de l'écran (migration 68 : le tap d'un de ces types mettait « jamais ») repassent à « auto ». Jamais une conversation sans type (contact
-- « Personnel »), ni un client, ni un apporteur. Ne crée ni ne supprime aucune colonne, fonction ni droit.
--
-- Le déclencheur whatsapp_proteger_classement (migrations 60 et 68) remet l'ancienne valeur de `reponses` quand personne n'est connecté
-- (auth.uid() vide), ce qui est le cas de l'éditeur SQL. Il est donc désactivé le temps de la mise à jour, dans la même transaction, puis
-- réactivé. ALTER TABLE est transactionnel : une erreur annule tout et le déclencheur reste actif. Le verrou de la table ne dure que la mise
-- à jour (la fonction « whatsapp » attend quelques millisecondes au plus). Les autres déclencheurs tournent normalement.
--
-- Se rejoue sans effet : la deuxième fois, aucune ligne ne correspond.
-- Retour en arrière : docs/gestion/retour-69-ia-tous-contacts.sql. Il ne peut pas savoir lesquelles étaient « jamais » avant : il ferme
-- toutes les conversations partenaire, chauffeur et hôtel, y compris celles que Nani avait rouvertes elle-même.
-- Contrôle après (doit rendre zéro ligne) :
--   select type_contact, count(*) from whatsapp_conversations where type_contact in ('partenaire','chauffeur','hotel') and reponses = 'jamais' group by 1;
--   select coalesce(type_contact, case when reponses = 'jamais' then 'personnel' end) type, reponses, count(*) from whatsapp_conversations group by 1, 2 order by 1, 2;
-- Contrôle PGlite : docs/gestion/verif-ia-tous-contacts.mjs.

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_conversations' and column_name = 'type_contact') then
    raise exception 'Migration 68 absente : la colonne whatsapp_conversations.type_contact manque.';
  end if;
end $$;

alter table whatsapp_conversations disable trigger whatsapp_proteger_classement;

update whatsapp_conversations
set reponses = 'auto'
where type_contact in ('partenaire', 'chauffeur', 'hotel')
  and reponses = 'jamais';

alter table whatsapp_conversations enable trigger whatsapp_proteger_classement;

-- Trace dans la base : la fonction de la migration 67 reste, sans appel.
do $$
begin
  if to_regprocedure('public.whatsapp_partenaires_parmi(text[])') is not null then
    comment on function whatsapp_partenaires_parmi(text[]) is 'Migration 67. Plus appelée depuis la migration 69 (l''IA lit aussi les partenaires). Gardée en base, sans effet.';
  end if;
end $$;

commit;
