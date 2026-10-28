# Gestion Zwald : mise en route

L'outil est dans `src/gestion/` et s'ouvre sur `/gestion/`. Tant que `src/gestion/js/config.mjs` est vide, il tourne en mode démonstration (faux clients, données dans le navigateur). Pour passer en réel, il faut une base Supabase. Comptez 15 minutes.

## 1. Créer la base

1. Créer un compte sur supabase.com avec l'adresse de Jérémy ou d'Anaïs.
2. Nouveau projet nommé `gestion-zwald`, région Europe (Frankfurt ou la plus proche). Noter le mot de passe de base de données dans un gestionnaire de mots de passe.
3. Menu **SQL Editor**, nouvelle requête, coller tout le contenu de `docs/gestion/schema.sql`, puis **Run**. Le message « Success » suffit. Ce fichier contient les coordonnées bancaires : ne pas le publier.

## 2. Fermer les inscriptions et créer le compte d'Anaïs

1. Menu **Authentication**, **Sign In / Providers**, désactiver **Allow new users to sign up**. Sans cela, n'importe qui pourrait se créer un compte.
2. Menu **Authentication**, **Users**, **Add user**, **Create new user**. Saisir l'e-mail d'Anaïs et un mot de passe solide, cocher **Auto Confirm User**.

## 3. Relier l'outil

1. Menu **Project Settings**, **API**. Copier le **Project URL** et la clé **anon public**.
2. Les coller dans `src/gestion/js/config.mjs` (ou les transmettre pour que ce soit fait). Ces deux valeurs sont publiques par conception, la sécurité vient de la connexion et des règles de la base.
3. Publier le site comme d'habitude.

## 4. Premier lancement

1. Ouvrir `https://zwaldtravelplanner.com/gestion/` et se connecter.
2. Écran **Réglages** : vérifier l'adresse de l'entreprise (« 290 Moo 2 » vient de son devis le plus récent), les coordonnées bancaires, les taux EUR et THB, puis enregistrer.
3. Écran **Catalogue** : vérifier les prix. Ils ont été déduits de ses anciens devis (par exemple Koh Samui apparaît à 150 et à 200).
4. Facultatif : **Réglages**, **Restaurer ou importer une sauvegarde**, choisir `clients-historique.json` pour reprendre ses 22 clients de l'ancien fichier Canva. Ce fichier est dans `~/Desktop/Site_Anais-import/` et ne doit pas être ajouté au dépôt.

## À savoir

- Un projet Supabase gratuit peut être mis en pause après une semaine sans activité. Il se réactive depuis le tableau de bord Supabase. Se connecter à l'outil au moins une fois par semaine évite le problème.
- **Réglages**, **Télécharger une sauvegarde complète** produit un fichier avec toutes les données. À faire une fois par mois.
- Le PDF se génère par l'impression du navigateur : choisir « Enregistrer au format PDF ». Le nom de fichier est déjà rempli.
- Les anciens dossiers (devis et factures de 2026) restent dans le fichier Canva. Leurs montants sont trop ambigus dans le PDF pour être repris sans risque d'erreur.
