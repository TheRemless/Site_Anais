# Gestion : mise en route et administration

L'outil est dans `src/gestion/` et s'ouvre sur `/gestion/`. Il gère plusieurs entreprises (Zwald Travel Planner, Secret Travel & Tour, VIP Taxi Lanta) et plusieurs utilisateurs. Chaque entreprise a ses propres clients, dossiers, documents, paiements, catalogue, réglages, logo et devise.

`/gestion/?demo` ouvre une démonstration avec de faux clients, sans toucher à la vraie base.

## Qui voit quoi

| Rôle | Voit | Peut faire |
|---|---|---|
| Administratrice générale | Toutes les entreprises | Tout, y compris créer des entreprises et donner des accès (écran Administration) |
| Administrateur d'une entreprise | Cette entreprise | Tout dans cette entreprise, réglages compris (écran Réglages) |
| Éditeur d'une entreprise | Cette entreprise | Clients, dossiers, devis, factures, paiements, catalogue. Pas les réglages (donc pas l'IBAN), pas la suppression d'un dossier |

Ces règles sont appliquées par la base de données elle-même. Un éditeur de Secret et Taxi ne peut rien lire ni écrire chez Zwald, même en contournant l'interface. `docs/gestion/verif-securite.mjs` le vérifie sur un Postgres en mémoire.

## Installation neuve

1. Créer le projet Supabase (région Europe), puis **SQL Editor**, coller `docs/gestion/schema.sql`, **Run**.
2. **Authentication**, **Sign In / Providers** : désactiver **Allow new users to sign up**.
3. **Authentication**, **Users**, **Add user** : créer le compte de l'administratrice (Auto Confirm User). Le tout premier compte devient automatiquement administratrice générale.
4. Renseigner l'URL du projet et la clé `anon public` dans `src/gestion/js/config.mjs`, puis publier.

## Mise à jour d'une base déjà installée (première version)

1. **SQL Editor**, coller `docs/gestion/migration-2-entreprises.sql`, **Run**. Les données existantes deviennent celles de Zwald Travel Planner et les comptes existants deviennent administrateurs généraux.
2. Publier la nouvelle version de l'outil juste après (l'ancienne version ne fonctionne plus avec les nouvelles tables).

## Ajouter une personne (l'assistante par exemple)

1. Dans Supabase : **Authentication**, **Users**, **Add user**, saisir son e-mail et un mot de passe, cocher **Auto Confirm User**.
2. Dans l'outil : **Administration**, **Utilisateurs**, **Gérer l'accès** sur son nom. Choisir **Éditeur** pour Secret Travel & Tour et pour VIP Taxi Lanta, **Aucun accès** pour Zwald Travel Planner.
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

## À savoir

- Un projet Supabase gratuit peut être mis en pause après une semaine sans activité. Il se réactive depuis le tableau de bord Supabase.
- Le PDF se génère par l'impression du navigateur : choisir « Enregistrer au format PDF ». Le nom de fichier est déjà rempli.
- Import de l'historique Zwald (`historique-complet.json`) : choisir l'entreprise **Zwald Travel Planner** dans le menu, puis **Réglages**, **Sauvegarde**, **Restaurer ou importer**. L'import va dans l'entreprise active.
- Le fichier `schema.sql` et la migration contiennent les coordonnées bancaires : ne pas les publier.
