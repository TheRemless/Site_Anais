-- Prix du site : la tâche qui relance le build de secrettravelandtour.com après un changement de prix dans Gestion (22.11.2026).
-- À lancer APRÈS la migration 117, une fois le build hook posé dans Vault (étape 1). Aucun secret dans ce fichier ni dans la commande du job.
--
-- 1. Le build hook (le seul secret, posé par Jérémy, jamais copié ailleurs) :
--    a. Netlify, site steady-capybara-eb28c9 : Project configuration → Build & deploy → Continuous deployment → Build hooks → Add build hook,
--       nom « Prix Gestion », branche main. Netlify affiche une adresse https://api.netlify.com/build_hooks/<identifiant>.
--    b. Supabase, projet gestion-zwald : Project Settings → Vault (ou Integrations → Vault) → Add new secret, nom exact
--       netlify_build_hook_stt, valeur = l'adresse du build hook. Ou, dans l'éditeur SQL, en remplaçant <identifiant> :
--         select vault.create_secret('https://api.netlify.com/build_hooks/<identifiant>', 'netlify_build_hook_stt', 'Build hook Netlify de secrettravelandtour.com (prix Gestion)');
--    Pour le changer plus tard : supprimer le build hook dans Netlify, en créer un autre, puis
--         select vault.update_secret((select id from vault.secrets where name = 'netlify_build_hook_stt'), 'https://api.netlify.com/build_hooks/<nouvel identifiant>');

-- 2. Lecture : le secret est là (sans afficher sa valeur), la note des prix, les jobs actuels.
select name, created_at, updated_at from vault.secrets where name = 'netlify_build_hook_stt';
select a_publier, premier_changement, dernier_changement, changements, dernier_appel, dernier_resultat from prix_site_attente;
select jobname, schedule, active from cron.job order by jobname;

-- 3. Le job : toutes les 30 minutes (à 11 et 41), décalé des autres jobs. Il ne fait rien sans changement de prix ; au plus un build par heure.
select cron.schedule('prix-site', '11,41 * * * *', 'select prix_site_relancer()');

-- 4. Contrôle après un changement de prix (attendre le passage suivant de plus de 10 minutes) :
-- select status, return_message, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'prix-site') order by start_time desc limit 5;
-- select dernier_appel, dernier_resultat from prix_site_attente;
-- Dans Netlify, le déploiement porte le titre « Prix Gestion (n changements) ».

-- Retour en arrière : select cron.unschedule('prix-site');
-- Le secret, s'il faut le retirer aussi : delete from vault.secrets where name = 'netlify_build_hook_stt'; puis supprimer le build hook dans Netlify.
