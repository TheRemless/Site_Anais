# Gestion : base partenaires, devis relié et opérations

Design validé avec Jérémy le 29 octobre 2026. Objectif : qu'Anaïs ait un seul outil, sur téléphone comme sur ordinateur, qui réunisse la facturation existante, la base partenaires de Secret Travel & Tour (aujourd'hui un fichier HTML local) et le travail du quotidien (réservations auprès des partenaires, départs du jour, messages aux clients, argent dû aux partenaires).

Quatre chantiers, chacun une branche, une PR et au besoin une migration SQL numérotée. Ils se livrent dans cet ordre parce que chacun s'appuie sur le précédent.

## 1. La coque, mobile et ordinateur

Tout le reste s'y pose. Elle doit rester reconnaissable (teal, Raleway, mêmes écrans) mais devenir fluide sur téléphone et tirer parti des grands écrans.

### Mobile (moins de 900 px)

- Barre du bas à quatre entrées, avec icône et libellé : Aujourd'hui, Dossiers, Partenaires, Plus. Tant que le module Partenaires n'existe pas, la troisième entrée est Clients. « Plus » ouvre une feuille depuis le bas qui liste les autres écrans (Clients, Tâches, Catalogue, Analyses, Journal, Réglages, Administration), le choix d'entreprise, le compte et la déconnexion. La feuille se ferme par un geste vers le bas, par Échap ou par un appui hors de la feuille.
- Les entrées de la barre reçoivent une pastille pour les tâches en retard et, plus tard, pour les réservations à confirmer.
- En-tête de page collant en haut : titre, bouton de retour quand on est dans une fiche, action principale à droite, loupe qui ouvre la recherche.
- Tableaux à plus de quatre colonnes remplacés par des cartes conçues pour le pouce (ligne principale, ligne secondaire, montant à droite, statut en toutes lettres). Les tableaux à peu de colonnes gardent le repli actuel.
- Zones d'appui d'au moins 44 px, espacement de 8 px entre elles, retour visuel à l'appui sous 100 ms, `min-h-dvh`, zones sûres respectées pour la barre et les toasts.

### Ordinateur (900 px et plus)

- Barre latérale regroupée en sections : Opérations (Aujourd'hui, Tâches), Ventes (Dossiers, Clients, Catalogue), Partenaires (Partenaires, Trajets, Tarifs, Dû aux partenaires, dès que ces écrans existent), Administration (Analyses, Journal, Réglages, Administration). Entreprise active en tête, compte en bas.
- Palette de recherche globale ouverte par `/` ou `Ctrl+K`, et par la loupe. Elle cherche d'un coup clients, dossiers (référence, client, pays), partenaires, prestations et trajets, avec navigation au clavier et regroupement par type. Elle remplace le simple focus du champ « Rechercher » de la liste des dossiers.
- Pages larges quand le contenu s'y prête (`data-large`), aperçu de document collant comme aujourd'hui.

### Direction visuelle

- Palette et typographie existantes conservées (teal `#0b9999` et ses variantes, Raleway). Jetons de couleur sémantiques déjà en place dans `app.css`, à compléter plutôt qu'à remplacer.
- Icônes en traits (famille Lucide, comme les deux icônes existantes de l'éditeur), jamais d'emoji.
- Transitions de 150 à 250 ms sur l'ouverture de la feuille et de la palette, respect de `prefers-reduced-motion`.
- Pas de mode sombre dans ce chantier.

### Fichiers

`src/gestion/js/app.mjs` (menu, coque, raccourcis), `src/gestion/js/ui.mjs` (icônes, feuille, palette), `src/gestion/css/app.css`, et les vues dont la liste passe en cartes (`views/dossiers.mjs`, `views/clients.mjs`, `views/dashboard.mjs` renommé Aujourd'hui). Aucun changement de base.

## 2. Module Partenaires

La base partenaires actuelle passe dans Supabase, par entreprise, modifiable depuis l'outil.

### Tables (migration 9)

- `partenaires` : nom, nom thaï, catégorie, groupe, contact (jsonb : personne, téléphones, Line, e-mail, site, adresse, embarcadère, licence), règles (jsonb : enfants, commissions, check-in, annulation, remarques), contrat (jsonb : début, fin, signé par le partenaire, contresigné), notes, actif.
- `prestations` : partenaire, famille (excursion, bateau, activité, location, transfert, frais), libellé FR et EN, détails (jsonb : programme, bateau, horaires, durée, capacité, inclus, conditions), prix de vente, unité (par personne, par adulte, par enfant, par bateau, par véhicule, par session, par jour, par groupe), tarif enfant (jsonb), payé sur place (frais de parc), ordre, actif.
- `trajets` : compagnie (partenaire), numéro, de, vers, mode, départ, arrivée, durée en minutes, prix adulte, enfant, bébé, période (jsonb : fenêtres de dates), actif.
- `prestations_nets` et `trajets_nets` : les prix nets, dans des tables à part comme `dossiers_resume`, lisibles seulement avec le droit `partenaires.nets`.
- `taches.partenaire_id` (nullable) : les alertes actuelles deviennent des tâches liées à un partenaire.
- Droits : `partenaires.lire` (donné aux trois rôles système), `partenaires.ecrire` (Administrateur et Éditeur), `partenaires.nets` (Administrateur). RLS sur le modèle des tables existantes, `verif-securite.mjs` étendu.

### Écrans

- Partenaires : liste par catégorie, fiche avec contact, règles, contrat, tarifs, trajets, tâches liées, bouton Modifier.
- Tarifs : par famille, avec filtre texte, prix de vente, net et marge pour qui a le droit.
- Trajets : route finder (de, vers, date), horaires, prix par compagnie, meilleur net quand les compagnies diffèrent, fenêtres saisonnières appliquées à la date choisie. Fuseaux horaires pris en compte pour les durées.
- Transferts, locations, annuaire des guichets, règles (enfants, commissions, check-in, frais de parc) : repris des pages actuelles.
- Les échéances de contrat apparaissent dans Aujourd'hui trente jours avant.

### Reprise des données

Un script `docs/gestion/import-partenaires.mjs` lit `data.json` de la source actuelle et produit un fichier JSON privé, importé par Réglages, Sauvegarde, Restaurer ou importer (l'import existant est étendu aux nouvelles tables). Les nets ne passent jamais dans le dépôt. La démo (`store-local.mjs`) reçoit trois partenaires fictifs avec prestations et trajets.

## 3. Le devis relié

Remplace le « Devis rapide » du fichier local.

- Dans l'éditeur et dans la création d'un dossier, un bouton « Ajouter une prestation » ouvre une recherche dans prestations et trajets. La ligne créée reprend le libellé dans la langue du document, le prix de vente comme prix unitaire, la quantité, et garde `prestation_id` (ou `trajet_id`), `net` et `date_service` dans la ligne (le contenu du document est déjà protégé par `finances.voir`).
- Les frais de parc payés sur place se rangent dans un bloc texte « À régler sur place », hors total.
- La fiche du dossier affiche la marge (vente moins nets) pour les rôles qui ont `partenaires.nets`.
- Tests : construction des lignes, marge, langue.

## 4. Opérations

### Table `reservations` (migration 10)

Une par ligne vendue : dossier, prestation ou trajet, partenaire, date du service, heure et lieu de pickup, personnes (jsonb : adultes, enfants, bébés), statut (à demander, demandé, confirmé, annulé), référence du partenaire, net prévu, net payé, payé le, notes. Créées en un clic depuis un devis accepté (une par ligne qui porte une prestation), modifiables ensuite. RLS sur le modèle des dossiers, net lisible avec `partenaires.nets`.

### Écrans

- Aujourd'hui remplace le tableau de bord : départs et pickups du jour et de demain, réservations à confirmer, tâches en retard, contrats qui expirent, acomptes en attente et devis sans réponse (déjà calculés). Chiffres financiers conservés pour qui a le droit.
- Réservations : liste par date, filtres par statut et partenaire, bouton « Copier le message au partenaire » (anglais) et changement de statut.
- Messages types : dans Réglages, une liste de gabarits avec clé, titre, langue (FR, EN, TH) et corps à variables (`{client}`, `{date}`, `{hotel}`, `{heure}`, `{personnes}`, `{prestation}`, `{partenaire}`). Un jeu de départ est fourni (confirmation, rappel de pickup, demande d'avis, météo, message au partenaire). Les textes thaïs doivent être relus par une personne qui lit le thaï avant usage réel. Bouton « Copier le message » sur chaque réservation et chaque dossier, avec choix du gabarit.
- Dû aux partenaires : par partenaire et par mois, net prévu, net payé, reste, case « payé le ». Marge réelle par partenaire et par mois ajoutée dans Analyses (fonction SQL étendue).

## Garde-fous communs

- Tests `node --test` pour chaque logique pure (marges, route finder, gabarits, génération des réservations, cumul des dûs).
- `verif-securite.mjs` couvre les nouvelles tables : un éditeur de Secret ne lit rien de Zwald, un rôle sans `partenaires.nets` ne lit aucun net.
- La démo `/gestion/?demo` couvre chaque écran, c'est là que se fait la vérification dans le navigateur.
- Chaque migration s'exécute dans Supabase avant la publication de la version correspondante, comme documenté dans `mise-en-route.md`, qui sera complété à chaque chantier.
- Le fichier HTML local reste tel quel comme copie hors ligne et n'évolue plus.

## Hors périmètre

Prix publics qui alimentent `/secret/` et `/taxi/`, caisse en bahts, scans de contrats attachés à la fiche partenaire, mode sombre.
