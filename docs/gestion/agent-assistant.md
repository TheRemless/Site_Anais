# Onglet « Assistant » : l'agent de Gestion (19.11.2026)

On discute avec l'assistant comme sur une messagerie : une conversation par client ou par demande, plusieurs ouvertes en parallèle. Il cherche dans le catalogue, regarde les horaires des bateaux, situe les hôtels, calcule les temps de route et les heures d'une course, retrouve un client ou un dossier, puis **propose** : un dossier, un service à ajouter, une modification, une réponse au client. Chaque proposition est une carte. « Valider » ouvre l'écran habituel de l'outil déjà rempli (« Coller une demande », formulaire de réservation) : c'est cet écran qui enregistre, après le clic de la personne. La réponse au client se copie ; personne n'écrit au prestataire.

## Ce qui part chez Anthropic, ce qui n'y part jamais

| Part | Ne part jamais |
|---|---|
| Les messages tapés dans la conversation | Un net, une marge, une commission |
| Les tarifs de **vente** et les horaires du catalogue | Le nom d'un prestataire (retiré des modes de transport) |
| Les clients et dossiers que l'agent cherche (nom, téléphone, dates, services, prix de vente) | Une coordonnée bancaire |
| Les noms d'hôtels à situer | Les données d'une autre entreprise (RLS) |

Les nets sont lus par la fonction (avec les droits de la personne) pour poser un seul drapeau, « recommande », sur l'option à la meilleure marge. La marge elle-même ne sort pas de la fonction. Les contrôles sont dans le code (`supabase/functions/agent/outils.js`), pas seulement dans les consignes :

- un prix proposé vient du catalogue (par sa référence) ou d'un montant tapé par la personne dans la conversation ; sinon il reste vide (transfert privé : Nani le fixe) ;
- les heures d'une course sont calculées par `planifier.js`, jamais par le modèle ;
- la réponse au client est contrôlée : signature retirée chez Secret et Taxi, montant ou heure sans source signalés, mot interne, prestataire ou prénom de l'équipe signalés.

## Planifier une course

`planifier_course` reçoit les points dans l'ordre (pickup, arrêts, destination), un rendez-vous (« à l'hôpital à 16:00 »), les attentes et l'heure du vol. Il calcule :

- le pickup **à rebours** : durée de route, plus 30 min d'attente au ferry si le trajet en prend un, plus une marge de 10 % de la durée (10 min au moins, ou la marge conseillée par la table si elle est plus grande), arrondi aux 5 min inférieures ;
- l'heure d'arrivée à chaque point, prévue et au plus tard ;
- si le vol est **tenable** (arrivée à l'aéroport 2 h avant un vol intérieur, 3 h avant un international), **juste** (tenable seulement sans les marges) ou **pas tenable**.

Ces valeurs sont réglables par entreprise (`reglages.agent_planning`) et toujours affichées sous « Hypothèses du calcul ».

### Trajets avec ferry : trois morceaux (règle de Jérémy du 19.11.2026)

Un trajet dont un seul bout est sur l'île d'une liaison de ferry se calcule toujours en trois morceaux, puis la marge :

1. route du départ jusqu'au port de départ du ferry (table, sinon OpenStreetMap) ;
2. ferry : durée fixe de la liaison, traversée et attente comprises, 60 min par défaut, modifiable par Nani (Temps de trajet > Ferries) ;
3. route du port d'arrivée jusqu'au point d'arrivée (table, sinon OpenStreetMap).

Les ports et la liaison sont des données de la table, jamais une supposition du modèle. L'agent montre le détail, par exemple « Jai Tiki → ท่าเรือคลองหมาก : 25 min, ferry : 1 h, ท่าเรือกระบี่-เกาะลันตา → Krabi Nakharin : 1 h 10, marge 20 min », puis le pickup (ici 13:05 pour 16:00). La liaison de Koh Lanta se pré-remplit avec les ports donnés par Jérémy le 19.11.2026 : ท่าเรือคลองหมาก (Khlong Mak Pier) sur Koh Lanta Noi et ท่าเรือกระบี่-เกาะลันตา côté continent, 1 h. Les coordonnées restent vides : OpenStreetMap cherche chaque port par son nom thaï puis latin, et montre ce qu'il a trouvé ; Nani pose les coordonnées si ce n'est pas le bon.

### D'où viennent les durées (décision de Jérémy du 19.11.2026 : pas de Google Maps)

Ordre décidé par Jérémy le 19.11.2026 (« fie-toi plutôt à OpenStreetMap, c'est plus précis ») :

| Ordre | Source | Affiché |
|---|---|---|
| 1 | **openrouteservice** (OpenStreetMap, gratuit), avec la marge conseillée et le ferry de la ligne de la table pour ces zones s'il y en a une ; ce qu'OpenStreetMap a compris de chaque lieu est montré | « OpenStreetMap » |
| 2 | La **table des temps de trajet** (Partenaires > Temps de trajet), ligne confirmée, quand OpenStreetMap ne donne rien (pas de clé, lieu introuvable, quota) | « table des temps » |
| 3 | Une ligne de la table encore **à vérifier** (pré-remplie) | « table, ligne à vérifier » |
| 4 | Rien : l'agent le dit et demande la durée. Quand Nani la donne, il propose une carte « Ajouter à la table » | « durée donnée par vous » |
| 5 | En dernier recours, une **estimation par la recherche web**, avec sa source, marquée comme telle | « estimation trouvée sur le web » |

Une durée n'entre dans le calcul que si elle vient d'une de ces sources : une durée donnée par Nani doit être écrite dans la conversation (« compte 2h30 »), une estimation doit sortir de l'outil d'estimation. Sinon le calcul est refusé.

La table se pré-remplit d'un bouton, chaque ligne « à vérifier » : durées des pages taxi du site (borne haute des fourchettes, organisation de Koh Lanta seulement), durées des trajets du catalogue (onglet « En bateau »), grilles de pickup des partenaires (temps entre le passage du véhicule et le départ du bateau, enregistrement compris, sans nom de partenaire). Aucune ligne existante n'est écrasée.

**openrouteservice** : `https://api.heigit.org/openrouteservice/v2/directions/driving-car/json` et `/pelias/v1/search` (adresses relevées dans le client officiel, 19.11.2026), clé dans l'en-tête `Authorization`. Quota gratuit : 2 000 itinéraires par jour, 40 par minute (FAQ d'ORS). Chaque résultat est gardé en base (`lieux_geo`, `trajets_ors`) et n'est pas recalculé. Seuls partent des noms de lieux et des coordonnées, jamais une donnée de client. **Conditions d'usage commercial et d'attribution : non vérifiées**, la page https://account.heigit.org/info/tos ne se lit qu'avec un navigateur. À lire par Jérémy avant la mise en service.

## Fichiers

| Fichier | Rôle |
|---|---|
| `supabase/functions/agent/index.ts` | Fonction : session de la personne, droits, limites, conversation, flux NDJSON, journal |
| `supabase/functions/agent/boucle.js` | La boucle d'outils d'un échange (aussi utilisée par le jeu d'essai) |
| `supabase/functions/agent/outils.js` | Les 11 outils, leurs contrôles, les cartes |
| `supabase/functions/agent/prompt.js` | Consignes, voix, modèle, coût, accès |
| `supabase/functions/agent/planifier.js` | Calcul des heures, temps simulés de la démo (copie identique : `src/gestion/js/agent-planifier.mjs`) |
| `supabase/functions/agent/temps.js` | Ordre des sources de durée, zones, openrouteservice, pré-remplissage (copie identique : `src/gestion/js/agent-temps.mjs`) |
| `supabase/functions/agent/estimation.js` | Estimation d'une durée par la recherche web (dernier recours) |
| `src/gestion/js/views/temps-trajets.mjs` | Écran de la table des temps de trajet |
| `src/gestion/js/views/agent.mjs`, `agent-calc.mjs`, `agent-demo.mjs` | Écran, logique pure, démonstration |
| `docs/gestion/migration-52-agent-conversations.sql` | Conversations, messages, cartes, RLS, conservation |
| `scripts/eval-agent/` | Jeu d'essai (cas privés dans `~/Desktop/Gestion-Test/eval-assistant/cas-agent.json`) |

## Coût et limites

- Modèle : Claude Opus 5.5, effort `medium`, réflexion adaptative, repli serveur en cas de refus (`AGENT_MODELE` pour changer, par exemple `claude-haiku-5-5`).
- Consignes et outils (environ 4 400 jetons) mis en cache ; l'historique aussi.
- Estimation Opus 5.5 : 0,03 à 0,06 $ par échange, 0,08 à 0,10 $ pour le cas Jai Tiki complet (deux échanges). Haiku 5.5 : environ 40 fois moins.
- Limites : 60 échanges par personne et par jour (`AGENT_LIMITE_JOUR`), plafond du mois pour **toute** la dépense de l'assistant (`AGENT_PLAFOND_MOIS_USD`, 40 $ par défaut).
- Journal : une ligne par échange dans `assistant_journal` (usage `agent`), jetons et coût, jamais le contenu. Le tableau de bord du lot 7 l'affiche sans changement.
- openrouteservice : gratuit. Estimation web : environ 0,01 $ par recherche, plus quelques jetons Haiku, comptés dans le journal de l'échange.

## Conservation

Une conversation sans nouveau message depuis 90 jours est supprimée avec ses messages et ses cartes (`AGENT_CONSERVATION_JOURS`). Les dossiers créés restent.

## Mise en service (chaque étape avec le oui de Jérémy)

1. Sauvegarde forcée, puis migration 52 (SQL Editor).
2. Clé openrouteservice gratuite (compte sur account.heigit.org), posée par Jérémy sans l'afficher. Sans clé, l'agent s'en tient à la table.

   ```bash
   read -s "K?Clé openrouteservice : " && echo && supabase secrets set ORS_API_KEY="$K" --remote=lkxqcmzeidlyssoqmqkh; unset K
   ```

3. Vérifier que la branche contient tout master, puis déployer :

   ```bash
   npx -y supabase@3.0.0 functions deploy agent --remote=lkxqcmzeidlyssoqmqkh --use-api --yes
   ```

4. Fusion de la PR (un seul build Netlify), puis Réglages > Assistant IA > « Onglet Assistant » dans chaque entreprise.
