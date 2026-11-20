-- WhatsApp : reprise des événements en échec toutes les 5 minutes (lot 3, audit dev I2, 20.11.2026).
-- Avant : un événement en échec n'était repris qu'au webhook suivant (un autre message d'un client). La nuit, il pouvait attendre des heures.
-- À exécuter APRÈS la migration 64 et le déploiement de la fonction « whatsapp » de ce lot (l'ancienne répond 401 à cet appel, sans dégât).
-- Aucun secret ici : la commande (URL du projet, en-tête Authorization, délai) est recopiée du job rappels-h1 existant. Seuls l'adresse de la
-- fonction et le corps changent. La fonction « whatsapp » accepte le même jeton que « rappels » (RAPPELS_SECRET ou clé de service).

-- 1. Lecture (sans le jeton) : les jobs actuels.
select jobname, schedule, active, regexp_replace(command, 'Bearer [^"'' ]+', 'Bearer ***', 'g') as commande
from cron.job order by jobname;

-- 2. Le job, en une transaction : si l'adresse ou le corps de rappels-h1 ne sont pas trouvés, rien ne change.
do $$
declare
  modele text;
  cmd text;
begin
  select command into modele from cron.job where jobname = 'rappels-h1';
  if modele is null then raise exception 'job rappels-h1 introuvable : rien n''est changé'; end if;
  if exists (select 1 from cron.job where jobname = 'whatsapp-reprise') then raise exception 'whatsapp-reprise existe déjà : rien n''est changé'; end if;
  cmd := regexp_replace(modele, '/functions/v1/rappels([''"])', '/functions/v1/whatsapp\1');
  if cmd = modele then raise exception 'adresse /functions/v1/rappels introuvable dans rappels-h1 : rien n''est changé'; end if;
  modele := cmd;
  cmd := regexp_replace(modele, '"type"\s*:\s*"h1"', '"mode": "reprise"');
  if cmd = modele then raise exception 'corps {"type": "h1"} introuvable dans rappels-h1 : rien n''est changé'; end if;
  -- Décalé de 2 minutes sur rappels-h1 (2, 7, 12…) pour ne pas tomber en même temps.
  perform cron.schedule('whatsapp-reprise', '2-59/5 * * * *', cmd);
end $$;

-- 3. Contrôle : whatsapp-reprise vers /functions/v1/whatsapp avec {"mode": "reprise"}, puis le résultat des derniers passages.
select jobname, schedule, active, regexp_replace(command, 'Bearer [^"'' ]+', 'Bearer ***', 'g') as commande
from cron.job where jobname = 'whatsapp-reprise';
-- Après 10 minutes (status_code 200 attendu, corps { "ok": true, ... }) :
-- select r.status_code, left(r.content, 200), r.created from net._http_response r order by r.created desc limit 5;

-- Retour en arrière :
-- select cron.unschedule('whatsapp-reprise');
