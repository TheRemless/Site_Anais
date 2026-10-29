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
4. Passage à l'échelle : `migration-5-echelle.sql` (résumé de chaque dossier tenu à jour par la base, recalculé pour les dossiers existants). À exécuter avant de publier la version correspondante de l'outil.
5. Tâches et pièces jointes : `migration-6-collaboration.sql` (deux tables, un espace de stockage privé `pieces`, le droit « Gérer les tâches » ajouté aux rôles Administrateur et Éditeur). Supabase Storage doit être disponible, ce qui est le cas par défaut.
6. Facture locale : `migration-7-facture-locale.sql` (autorise le type de document « facture_locale », ne modifie aucune donnée).
7. Impayés comptés depuis la date de la facture : `migration-8-impayes.sql` (remplace seulement la fonction du tableau analytique, ne modifie aucune donnée).
8. Base partenaires : `migration-9-partenaires.sql` (six tables, trois droits donnés aux rôles de départ, ne modifie aucune donnée existante).
10. Réservations : `migration-11-reservations.sql` (deux tables, ne modifie aucune donnée existante).

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

## Tâches, pièces jointes et attribution en lot

- **Tâches** : menu *Tâches*, ou section *Tâches* d'un dossier. Une tâche a un titre, une échéance facultative et une personne en charge. Elle peut être liée à un dossier ou non. Chacun voit les tâches qui lui sont confiées (la case suffit pour les terminer, même sans le droit « Gérer les tâches »). Les tâches de l'équipe et la création sont réservées aux rôles qui ont ce droit. Les tâches du jour et en retard apparaissent sur le tableau de bord.
- **Pièces jointes** : dans la fiche d'un dossier (10 Mo par fichier). Les fichiers sont privés, les liens de téléchargement expirent après 5 minutes. Ils suivent les droits du dossier : qui ne voit pas le dossier ne voit pas ses fichiers. Supprimer un dossier laisse ses fichiers dans le stockage (ils ne sont plus accessibles depuis l'outil) : on peut les retirer depuis le tableau de bord Supabase, rubrique Storage.
- **Attribution en lot** : dans la liste des dossiers, cocher plusieurs lignes puis choisir le nouveau responsable. Chaque changement est inscrit au journal.

## Facture locale (bahts) en plus de la facture client

Dans un dossier qui a une facture, le bouton **Créer la facture locale** (section Documents) copie la facture dans une autre devise, par exemple en bahts pour la comptabilité thaïlandaise. On choisit la devise, le taux (pré-rempli d'après Réglages, modifiable), les informations de paiement à afficher en pied de page et le numéro affiché. Tout reste modifiable ensuite, ligne par ligne.

- La facture locale ne compte ni dans le total du dossier, ni dans les paiements, ni dans les statistiques : les paiements se saisissent sur la facture du client.
- Les informations de paiement se gèrent dans **Réglages, Paiement** : les informations principales, puis « Autres informations de paiement » (nom, texte, QR code facultatif). Chaque devis ou facture choisit les siennes dans son en-tête.
- Le texte des conditions de paiement se choisit par document (liste « Conditions de paiement » des réglages). Prévoir une variante adaptée à la facture locale.
- Le titre « Facture locale » est un libellé réglable (Réglages, Textes des documents). S'il est vide, le titre est celui de la facture.

## Documents en anglais

Chaque devis ou facture a un champ **Langue du document** dans son en-tête. En anglais, les titres et textes fixes (INVOICE, TOTAL, Billed to…) viennent de **Réglages, Textes des documents** en choisissant « Textes des documents en anglais » dans la liste de langue. Les conditions de paiement ont une version anglaise facultative dans chaque variante (sinon le texte habituel est repris), de même que la mention de TVA. Lors de la création d'une facture locale, l'anglais est proposé par défaut.

Les textes saisis dans le document lui-même (intitulés des lignes, descriptions, titre dans la bande de couleur) ne sont pas traduits automatiquement : ils sont copiés tels quels et se modifient dans l'éditeur.

## Partenaires, tarifs et trajets

Le menu **Partenaires** (droit « Voir les partenaires ») réunit ce que l'agence sait de ses prestataires : fiche de contact avec les numéros cliquables (appel, WhatsApp, copie), règles (annulation, enfants, commissions, check-in, points d'embarquement, heures de pickup), contrat avec sa date de fin, tarifs et trajets. Les écrans **Tarifs** (par famille : excursions, activités, locations, transferts, frais de parc), **Trajets** (départ, arrivée, date du voyage, compagnie, avec les fenêtres saisonnières) et **Règles** (tout ce qu'il faut relire avant un devis) lisent les mêmes données. La recherche globale les trouve aussi.

- **Prix nets, marges et coordonnées bancaires** des partenaires demandent le droit « Voir les prix nets ». Ils sont dans des tables à part (`prestations_nets`, `trajets_nets`, `partenaires_prives`) que la base ne renvoie pas aux autres rôles, et qui ne passent jamais par le journal d'activité. Par défaut, seul le rôle Administrateur l'a.
- **Modifier** (droit « Modifier les partenaires ») : la fiche, les prestations et les trajets se changent depuis l'outil. Les heures de pickup, les guichets et les points d'embarquement importés ne se modifient pas encore depuis l'écran.
- Les **tâches** peuvent être liées à un partenaire (section « À régler avec ce partenaire » de sa fiche). Les contrats qui se terminent dans les trente jours apparaissent dans Aujourd'hui.
- **Reprise de la base partenaires de Secret Travel & Tour** : `node docs/gestion/import-partenaires.mjs <data.json> <entite_id> > partenaires-import.json` produit un fichier à importer dans l'entreprise Secret par Réglages, Sauvegarde, Restaurer ou importer. Le fichier contient les nets et les banques des partenaires : il ne se publie pas et ne se garde pas dans le dépôt. L'identifiant de l'entreprise Secret est `00000000-0000-4000-8000-000000000002` sur une installation faite avec `schema.sql`.
- La sauvegarde complète d'une entreprise comprend désormais ses partenaires (nets compris si la personne a le droit de les lire).

### Devis et factures reliés aux partenaires

Dans l'éditeur d'un devis ou d'une facture, le bouton **Prestation d'un partenaire** ouvre la base : un onglet Tarifs (par famille, avec quantité) et un onglet Trajets (avec la date du voyage, les adultes et les enfants). La ligne créée reprend le libellé (en anglais si le document l'est et si la prestation a un libellé anglais), le prix de vente comme prix unitaire et l'unité entre parenthèses. Les frais de parc payés sur place deviennent une note sous le tableau, hors total. Chaque ligne garde la prestation ou le trajet, le partenaire, le net et la **date du service** (modifiable sur la ligne) : c'est ce qui servira aux réservations. Sur la fiche du dossier, les rôles qui voient les nets lisent la **marge** (total du document qui fait foi moins les nets connus), avec le nombre de lignes dont le net n'est pas connu.

## Opérations : réservations, Aujourd'hui, messages, dû aux partenaires

- **Réservations** : une par ligne de partenaire vendue. Dans la fiche d'un dossier, « Créer les réservations depuis le devis » en fait une par ligne (date du service, personnes, montant vendu, net prévu pour qui voit les nets). Chaque réservation a un statut (à demander, demandée, confirmée, annulée), une heure et un lieu de pickup, la référence donnée par le partenaire et des notes. Elles suivent les droits du dossier : qui ne voit pas le dossier ne voit pas ses réservations. L'écran **Réservations** les montre jour par jour avec période, statut, partenaire et recherche.
- **Aujourd'hui** ajoute les départs et pickups du jour et de demain, puis ce qui reste à confirmer auprès des partenaires. La pastille du menu Réservations compte ces dernières.
- **Messages types** (écran Messages) : confirmation, rappel de la veille, demande d'avis, météo et demande au partenaire, en français, anglais et thaï. Les administrateurs les modifient, tout le monde les utilise. Depuis une réservation, « Partenaire » prépare la demande en anglais (bouton WhatsApp vers son numéro) et « Client » la confirmation ou le rappel. Les variables entre accolades sont remplies d'après la réservation, le client, le dossier et l'entreprise. Les textes thaïs sont des propositions à faire relire par une personne qui lit le thaï.
- **Dû aux partenaires** (droit « prix nets ») : par partenaire et par mois du service, net prévu, net payé, reste et marge sur les ventes, avec « Marquer payé » qui note la date du jour sur toutes les réservations du mois. Le net prévu et le net payé sont dans `reservations_nets`, jamais dans le journal.

## Impayés par ancienneté

Le tableau des analyses ne compte que les dossiers qui ont une facture, et l'ancienneté part toujours de la date d'émission de la facture. Un devis, même accepté, n'entre pas dans les impayés tant qu'il n'est pas facturé.

## Volumes et performances

À la connexion, l'outil charge seulement les clients, les dossiers (avec leur total, leur encaissé et leur devise) et le catalogue. Les devis, factures et paiements, qui sont les données les plus lourdes, ne se chargent qu'à l'ouverture d'un dossier. Le résumé de chaque dossier est tenu à jour par la base (déclencheurs sur les documents et les paiements), jamais calculé dans le navigateur. Le tableau analytique, l'encaissé du mois et les exports lisent aussi directement la base.

Ordre de grandeur : confortable jusqu'à quelques dizaines de milliers de dossiers et de clients. Au-delà, il faudra passer les listes en pagination côté base (la recherche de client y est déjà préparée). Le résumé suit le droit « voir les montants » : sans ce droit, les totaux d'un dossier ne sont pas lisibles.

## À savoir

- Un projet Supabase gratuit peut être mis en pause après une semaine sans activité. Il se réactive depuis le tableau de bord Supabase.
- Le PDF se génère par l'impression du navigateur : choisir « Enregistrer au format PDF ». Le nom de fichier est déjà rempli.
- Import de l'historique Zwald (`historique-complet.json`) : choisir l'entreprise **Zwald Travel Planner** dans le menu, puis **Réglages**, **Sauvegarde**, **Restaurer ou importer**. L'import va dans l'entreprise active.
- Le fichier `schema.sql` et la migration contiennent les coordonnées bancaires : ne pas les publier.
