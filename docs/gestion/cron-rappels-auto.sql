-- Rappels : passage des deux crons fixes (rappels-veille à 18h, rappels-lendemain à 9h) à un seul cron horaire { "type": "auto" } (lot G, 17.11.2026).
-- À exécuter seulement APRÈS le déploiement de la fonction `rappels` fusionnée : l'ancienne fonction refuse le type « auto » (400).
-- Le job rappels-h1 (toutes les 5 minutes) ne change pas. Aucun secret ici : la commande (URL, en-tête Authorization, délai) est recopiée
-- du job rappels-veille existant, seul le corps change. Avant le passage, les heures réglées dans la cloche ne servent pas : les crons fixes
-- envoient à 18h et 9h à toutes les entreprises où le rappel n'est pas coupé.

-- 1. Lecture (sans le jeton) : les trois jobs actuels.
select jobname, schedule, active, regexp_replace(command, 'Bearer [^"'' ]+', 'Bearer ***', 'g') as commande
from cron.job where jobname like 'rappels%' order by jobname;

-- 2. Le passage, en une transaction : si le corps « veille » n'est pas trouvé, rien ne change.
do $$
declare
  modele text;
  cmd text;
begin
  select command into modele from cron.job where jobname = 'rappels-veille';
  if modele is null then raise exception 'job rappels-veille introuvable : rien n''est changé'; end if;
  if exists (select 1 from cron.job where jobname = 'rappels-auto') then raise exception 'rappels-auto existe déjà : rien n''est changé'; end if;
  cmd := regexp_replace(modele, '"type"\s*:\s*"veille"', '"type": "auto"');
  if cmd = modele then raise exception 'corps {"type": "veille"} introuvable dans rappels-veille : rien n''est changé'; end if;
  -- Chaque heure pile (UTC) ; la fonction lit l'heure de Bangkok et n'envoie qu'aux entreprises réglées sur cette heure (18 h et 9 h par défaut).
  perform cron.schedule('rappels-auto', '0 * * * *', cmd);
  perform cron.unschedule('rappels-veille');
  perform cron.unschedule('rappels-lendemain');
end $$;

-- 3. Contrôle : rappels-auto et rappels-h1, plus de rappels-veille ni de rappels-lendemain.
select jobname, schedule, active, regexp_replace(command, 'Bearer [^"'' ]+', 'Bearer ***', 'g') as commande
from cron.job where jobname like 'rappels%' order by jobname;

-- Retour en arrière (si besoin) : recréer les deux crons fixes depuis rappels-auto, puis le retirer.
-- do $$
-- declare m text;
-- begin
--   select command into m from cron.job where jobname = 'rappels-auto';
--   perform cron.schedule('rappels-veille', '0 11 * * *', regexp_replace(m, '"type"\s*:\s*"auto"', '"type": "veille"'));
--   perform cron.schedule('rappels-lendemain', '0 2 * * *', regexp_replace(m, '"type"\s*:\s*"auto"', '"type": "lendemain"'));
--   perform cron.unschedule('rappels-auto');
-- end $$;
