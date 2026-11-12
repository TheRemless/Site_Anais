# Sauvegarde automatique de la base de Gestion (gratuite)

La base Supabase n'a aucune sauvegarde du fournisseur (pas de plan payant). Ce dossier la remplace : une tâche `launchd` sur le Mac de Jérémy exporte chaque jour la base en lecture seule, chiffre le fichier et le range hors du dépôt.

## Ce qui se passe
- **Quand** : toutes les heures et à l'ouverture de session. Le script ne fait quelque chose que si la sauvegarde du jour manque : un Mac éteint ou en veille rattrape dès qu'il se rallume.
- **Comment** : `supabase db query --remote=<projet> --read-only` (transaction en lecture seule, aucune écriture, aucune confirmation demandée). Pas de Docker, pas de `pg_dump`, pas de mot de passe de base.
- **Contenu** : toutes les tables de `public`, les comptes (`auth.users`, `auth.identities`, mots de passe hachés compris), la liste des dossiers de fichiers, et une photo du schéma (fonctions, politiques, déclencheurs). **Les fichiers joints eux-mêmes ne sont pas dans la base** : il y en a 0 aujourd'hui, le journal le signale s'il y en a.
- **Chiffrement** : AES-256-GCM (un fichier modifié est refusé), clé dérivée par scrypt d'une phrase stockée dans le trousseau macOS (service « Sauvegardes Gestion »), jamais dans un fichier du dépôt.
- **Où** : `~/Documents/Sauvegardes Gestion/gestion-AAAA-MM-JJ.gsb` (droits 600) et `journal.log`. Une copie dans iCloud Drive si le dossier existe, et dans chaque dossier listé dans `~/Library/Application Support/Sauvegardes Gestion/copies.txt` (un chemin par ligne : clé USB, autre disque).
- **Rotation** : 30 sauvegardes quotidiennes et 12 mensuelles (la plus ancienne de chaque mois).
- **Alerte** : notification macOS si la sauvegarde du jour échoue (une par jour au plus), ou si la dernière a plus de 2 jours. Chaque exécution laisse une ligne dans `journal.log`.

## Installer
```bash
bash docs/gestion/sauvegarde/installer.sh
```
Crée la phrase de chiffrement dans le trousseau si elle manque. **À faire une fois : copier cette phrase dans un gestionnaire de mots de passe** (`security find-generic-password -s "Sauvegardes Gestion" -a gestion -w`). Sans elle, les sauvegardes sont illisibles si le Mac est perdu.

## Vérifier un fichier
```bash
node ~/Library/Application\ Support/Sauvegardes\ Gestion/bin/restaurer.mjs ~/Documents/Sauvegardes\ Gestion/gestion-2026-11-12.gsb
```
Déchiffre, vérifie le manifeste (nombre de lignes et empreinte de chaque table) et liste le contenu.

## Restaurer après un sinistre
1. Créer un nouveau projet Supabase (ou une base vide).
2. Recréer le schéma : exécuter `docs/gestion/schema.sql` puis, dans l'ordre numérique, les `docs/gestion/migration-N-*.sql` à partir de la 18.
3. Générer le script de données : `node restaurer.mjs <fichier.gsb> --sql restauration.sql`.
4. Exécuter `restauration.sql` sur la nouvelle base (SQL Editor ou `supabase db query --remote=<projet> -f restauration.sql`). **Il vide les tables de la sauvegarde avant de les recharger** : ne le lancer que sur la base à reconstruire. Il coupe les déclencheurs pendant le chargement et remet les séquences.
5. Mettre à jour l'adresse et la clé du projet dans `src/gestion/js/config.mjs` et la politique de sécurité de `netlify.toml` (`connect-src`, `img-src`), les secrets de la fonction `rappels` et le cron. Supprimer `restauration.sql` (données personnelles).

## Preuve
`docs/gestion/verif-sauvegarde-archive.mjs` rejoue ce parcours sur Postgres en mémoire (jamais sur la production) : base d'origine, export, chiffrement, déchiffrement, script SQL, base neuve : mêmes lignes dans les 30 tables, séquences remises. Il tourne dans la CI. Les tests de rotation, d'échec et d'alerte sont dans `tests/gestion-sauvegarde-auto.test.js`.
