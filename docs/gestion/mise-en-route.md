# Gestion : mise en route et administration

L'outil est dans `src/gestion/` et s'ouvre sur `/gestion/`. Il gère plusieurs entreprises (Zwald Travel Planner, Secret Travel & Tour, VIP Taxi Lanta) et plusieurs utilisateurs. Chaque entreprise a ses propres clients, dossiers, documents, paiements, catalogue, réglages, logo et devise.

`/gestion/?demo` ouvre une démonstration avec de faux clients, sans toucher à la vraie base.

## Qui voit quoi

- **Administratrice générale** : voit toutes les entreprises, a tous les droits partout, gère les entreprises, les rôles et les accès (écran Administration).
- **Rôle dans une entreprise** : chaque personne a un rôle par entreprise, ou aucun accès. Un rôle est un ensemble de droits précis, que l'administratrice crée et modifie librement entreprise par entreprise (écran Administration, « Rôles et droits »). Trois rôles sont créés avec chaque entreprise : Administrateur (tout), Éditeur (clients, dossiers, devis, factures, paiements, catalogue) et Lecteur (consultation).

Les droits disponibles : voir, modifier et supprimer les clients et les dossiers, modifier et supprimer les devis et factures, **voir les montants** (sans ce droit, ni documents ni paiements ne sont lisibles), enregistrer les paiements, modifier le catalogue, modifier les réglages (coordonnées bancaires comprises), exporter, voir le tableau analytique, voir le journal d'activité.

La **portée** d'un rôle peut se limiter aux dossiers dont la personne est responsable ou qu'elle a créés. Chaque dossier a un responsable, modifiable depuis la fiche du dossier.

Ces règles sont appliquées par la base de données elle-même, pas seulement par l'interface. Un éditeur de Secret et Taxi ne peut rien lire ni écrire chez Zwald, même en contournant l'écran. `docs/gestion/verif-securite.mjs` le vérifie sur un Postgres en mémoire (installation neuve et chaîne de migrations).

Le **journal d'activité** (écran Journal, pour les rôles qui ont ce droit) garde la trace de chaque création, modification et suppression, avec la personne et l'heure. Il ne peut être ni modifié ni vidé, et ne recopie jamais le contenu des réglages.

## Tableau analytique

L'écran **Analyses** (rôles qui ont les droits « analyses » et « montants ») montre sur la période choisie : facturé et encaissé par mois en graphique, reste à encaisser, impayés par ancienneté, devis émis et acceptés avec le délai moyen d'acceptation, meilleurs clients, répartition par destination ou service et par responsable. Les montants sont séparés par devise. Les chiffres sont calculés par la base (fonction `tableau_analytique`), donc l'écran reste rapide avec de gros volumes. Ils portent sur toute l'entreprise, même pour un rôle limité à ses dossiers.

## Installation neuve

1. Créer le projet Supabase (région Europe), puis **SQL Editor**, coller `docs/gestion/schema.sql`, **Run**.
2. **Authentication**, **Sign In / Providers** : désactiver **Allow new users to sign up**.
3. **Authentication**, **Users**, **Add user** : créer le compte de l'administratrice (Auto Confirm User). Le tout premier compte devient automatiquement administratrice générale.
4. Renseigner l'URL du projet et la clé `anon public` dans `src/gestion/js/config.mjs`, puis publier.

## Mise à jour d'une base déjà installée

À chaque étape, exécuter le fichier dans **SQL Editor** puis publier la version correspondante de l'outil juste après (l'ancienne version ne fonctionne plus avec les nouvelles tables).
1. De la première version vers plusieurs entreprises : `migration-2-entreprises.sql`.
2. Des rôles fixes vers les rôles personnalisables, le responsable de dossier et le journal : `migration-3-droits.sql`. Les anciens rôles « admin » et « éditeur » deviennent les rôles Administrateur et Éditeur de chaque entreprise.
3. Tableau analytique : `migration-4-analyses.sql` (ajoute seulement des fonctions, ne modifie aucune donnée).

## Ajouter une personne (l'assistante par exemple)

1. Dans Supabase : **Authentication**, **Users**, **Add user**, saisir son e-mail et un mot de passe, cocher **Auto Confirm User**.
2. Dans l'outil : **Administration**, **Utilisateurs**, **Gérer l'accès** sur son nom. Choisir un rôle pour chaque entreprise (par exemple Éditeur pour Secret Travel & Tour et VIP Taxi Lanta), **Aucun accès** pour Zwald Travel Planner.
3. Pour couper l'accès d'une personne sans supprimer son compte, décocher **Compte actif**.

## Réglages d'une entreprise

L'écran **Réglages** (administrateurs) couvre tout ce qui apparaît sur les documents :
- **Entreprise** : nom, adresse, téléphone, bloc de contact du pied de page.
- **Paiement** : devise, informations de paiement, QR code (image à envoyer soi-même), taux indicatifs.
- **Dossiers et listes** : acompte, délais, TVA, lien des conditions générales, numérotation (initiales et pays ou séquence annuelle comme ST-2026-0001), pays ou services proposés, civilités, moyens de paiement.
- **Textes des documents** : tous les intitulés (DEVIS, TOTAL, signature…) avec un bouton pour les remplir en anglais, la phrase sur les conditions générales et les variantes de conditions de paiement (autant que voulu).
- **Apparence** : logo, titre, couleurs. L'aperçu à droite montre un document d'exemple avec les réglages en cours.
- **Sauvegarde** : sauvegarde complète, exports pour Excel, import. Ces fichiers concernent seulement l'entreprise active.

Une entreprise nouvellement créée démarre avec des réglages vides. Le tableau de bord indique ce qu'il manque tant que ce n'est pas rempli.

## Raccourcis clavier

Touche `?` (hors d'un champ de saisie) ouvre la liste. En résumé :
- Partout : `n` nouveau dossier, `/` recherche, `g` puis `t`, `d`, `c`, `k` ou `r` pour aller au tableau de bord, aux dossiers, aux clients, au catalogue ou aux réglages.
- Dans un devis ou une facture : `Ctrl+Z` annuler, `Ctrl+Maj+Z` ou `Ctrl+Y` rétablir, `Ctrl+S` enregistrer, `Ctrl+P` télécharger le PDF (`Cmd` à la place de `Ctrl` sur Mac). L'historique garde les 100 dernières modifications du document ouvert.
- Un site ne peut pas prendre le contrôle des raccourcis réservés au navigateur (`Ctrl+T`, `Ctrl+W`, `Ctrl+N`, `Ctrl+Tab`).

## Devise et équivalents d'un document

Chaque devis ou facture choisit sa devise (liste modifiable dans Réglages) et peut afficher l'équivalent dans une ou plusieurs autres devises, à titre indicatif, avec le taux saisi pour ce document. Les totaux du tableau de bord sont regroupés par devise.

## À savoir

- Un projet Supabase gratuit peut être mis en pause après une semaine sans activité. Il se réactive depuis le tableau de bord Supabase.
- Le PDF se génère par l'impression du navigateur : choisir « Enregistrer au format PDF ». Le nom de fichier est déjà rempli.
- Import de l'historique Zwald (`historique-complet.json`) : choisir l'entreprise **Zwald Travel Planner** dans le menu, puis **Réglages**, **Sauvegarde**, **Restaurer ou importer**. L'import va dans l'entreprise active.
- Le fichier `schema.sql` et la migration contiennent les coordonnées bancaires : ne pas les publier.
