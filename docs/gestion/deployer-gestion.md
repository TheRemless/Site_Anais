# Déployer les fonctions de Gestion (`scripts/deployer-gestion.sh`)

Créé le 20.11.2026 après l'audit dev (B1 et I26). Les fonctions s'importent entre elles : `whatsapp-envoi` embarque `agent/outils.js`, `whatsapp` et `whatsapp-preparer` embarquent tout `agent/`, `agent` embarque une partie d'`assistant/`, `rappels` embarque `ameliorations/`. Déployer une seule fonction à la main laissait les autres sur un vieux code de l'agent. Le 20.11, `whatsapp-preparer` et `whatsapp-envoi` tournaient ainsi sur le code d'avant l'espace unifié.

## Ce que fait le script

1. Il refuse de partir si le dossier n'est pas exactement sur `origin/master` à jour : fichier suivi modifié, branche en retard ou en avance, ou fichier embarqué absent de git.
2. Pour chaque fonction de `supabase/functions/`, il liste ce qu'elle embarque : son `index.ts` et tous les imports relatifs, de proche en proche (`scripts/deployer-gestion-dependances.mjs`), plus `supabase/config.toml` pour `verify_jwt`.
3. Il compare avec le commit de son dernier déploiement noté dans le journal. Une fonction dont un de ces fichiers a changé part, avec la liste des fichiers en cause. Une fonction sans déploiement noté part aussi.
4. Il demande `o`, déploie une fonction à la fois (`supabase functions deploy <nom> --remote=lkxqcmzeidlyssoqmqkh --use-api --yes`) et note chaque réussite tout de suite. Une erreur arrête la suite et dit ce qui n'est pas parti.

Il ne pose, ne lit et n'affiche aucun secret. Les secrets restent ceux du projet (`supabase secrets list`).

## Journal

`~/.gestion/deploiements.tsv` (ou `$GESTION_DEPLOIEMENTS`), une ligne par déploiement réussi : date UTC, fonction, commit, utilisateur de la machine. Il est partagé par tous les worktrees de ce Mac. Le premier passage n'a aucune ligne : toutes les fonctions partent, ce qui remet tout sur le même commit.

Pour savoir ce qui tourne :

```bash
column -t -s $'\t' ~/.gestion/deploiements.tsv | tail -20
```

## Utilisation

Depuis un worktree propre sur `origin/master` (le dossier principal est souvent en HEAD détaché sur autre chose) :

```bash
git -C ~/Desktop/Site_Anais worktree add --detach /tmp/gestion-deploiement origin/master
```

```bash
cd /tmp/gestion-deploiement && scripts/deployer-gestion.sh --essai
```

```bash
cd /tmp/gestion-deploiement && scripts/deployer-gestion.sh
```

Options :

| Option | Effet |
|---|---|
| `--essai` | liste ce qui partirait et pourquoi, rien ne part |
| `--tout` | toutes les fonctions, changées ou non |
| `--oui` | sans question (seulement après le oui de Jérémy) |
| `agent whatsapp` | seulement ces fonctions, si elles ont changé (ou avec `--tout`) |

## Ordre avec les migrations

Le script ne touche pas à la base. Une migration se passe avant le déploiement des fonctions qui en ont besoin (voir la liste de mise en production de chaque PR), puis le script, puis les tâches pg_cron éventuelles.

## Tests

`tests/gestion-deployer.test.js` : imports reconnus, dépendances réelles (le cas B1), garde-fous du script.
