-- Retour en arrière de la migration 120 (une carte de l'Assistant ne se valide qu'une fois). L'écran garde son verrou ; sans les fonctions,
-- il valide comme avant la migration (store-supabase.mjs, agentPrendreCarte rend true).
begin;
drop function if exists prendre_agent_carte(uuid);
drop function if exists rendre_agent_carte(uuid);
alter table agent_cartes drop column if exists prise_le;
commit;
