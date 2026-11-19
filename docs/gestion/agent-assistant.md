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

- le pickup **à rebours** : temps de route Google Maps (trafic prévu à l'heure du trajet), plus 30 min d'attente au ferry si la route en prend un, plus une marge de 10 % du temps de route (10 min au moins), arrondi aux 5 min inférieures ;
- l'heure d'arrivée à chaque point, prévue et au plus tard ;
- si le vol est **tenable** (arrivée à l'aéroport 2 h avant un vol intérieur, 3 h avant un international), **juste** (tenable seulement sans les marges) ou **pas tenable**.

Ces valeurs sont réglables par entreprise (`reglages.agent_planning` : `marge_pct`, `marge_min`, `ferry_attente_min`, `avance_vol_domestique_min`, `avance_vol_international_min`, `arrondi_min`) et toujours affichées sous « Hypothèses du calcul ».

Sans clé Google, l'agent n'invente aucune durée : il la demande. En démonstration, des temps simulés sont marqués « Temps simulés ».

## Fichiers

| Fichier | Rôle |
|---|---|
| `supabase/functions/agent/index.ts` | Fonction : session de la personne, droits, limites, conversation, flux NDJSON, journal |
| `supabase/functions/agent/boucle.js` | La boucle d'outils d'un échange (aussi utilisée par le jeu d'essai) |
| `supabase/functions/agent/outils.js` | Les 11 outils, leurs contrôles, les cartes |
| `supabase/functions/agent/prompt.js` | Consignes, voix, modèle, coût, accès |
| `supabase/functions/agent/planifier.js` | Calcul des heures, Google Routes, temps simulés (copie identique : `src/gestion/js/agent-planifier.mjs`) |
| `src/gestion/js/views/agent.mjs`, `agent-calc.mjs`, `agent-demo.mjs` | Écran, logique pure, démonstration |
| `docs/gestion/migration-52-agent-conversations.sql` | Conversations, messages, cartes, RLS, conservation |
| `scripts/eval-agent/` | Jeu d'essai (cas privés dans `~/Desktop/Gestion-Test/eval-assistant/cas-agent.json`) |

## Coût et limites

- Modèle : Claude Opus 5.5, effort `medium`, réflexion adaptative, repli serveur en cas de refus (`AGENT_MODELE` pour changer, par exemple `claude-haiku-5-5`).
- Consignes et outils (environ 4 400 jetons) mis en cache ; l'historique aussi.
- Estimation Opus 5.5 : 0,03 à 0,06 $ par échange, 0,08 à 0,10 $ pour le cas Jai Tiki complet (deux échanges). Haiku 5.5 : environ 40 fois moins.
- Limites : 60 échanges par personne et par jour (`AGENT_LIMITE_JOUR`), plafond du mois pour **toute** la dépense de l'assistant (`AGENT_PLAFOND_MOIS_USD`, 40 $ par défaut).
- Journal : une ligne par échange dans `assistant_journal` (usage `agent`), jetons et coût, jamais le contenu. Le tableau de bord du lot 7 l'affiche sans changement.
- Google Routes : environ 10 $ les 1 000 requêtes (deux requêtes par trajet calculé à rebours), à plafonner dans la console Google.

## Conservation

Une conversation sans nouveau message depuis 90 jours est supprimée avec ses messages et ses cartes (`AGENT_CONSERVATION_JOURS`). Les dossiers créés restent.

## Mise en service (chaque étape avec le oui de Jérémy)

1. Sauvegarde forcée, puis migration 52 (SQL Editor).
2. Clé Google Maps (Routes API seulement, limite de dépense posée dans Google Cloud), saisie sans l'afficher :

   ```bash
   read -s CLE && supabase secrets set GOOGLE_MAPS_API_KEY="$CLE" --project-ref lkxqcmzeidlyssoqmqkh; unset CLE
   ```

3. Vérifier que la branche contient tout master, puis déployer :

   ```bash
   npx -y supabase@3.0.0 functions deploy agent --remote=lkxqcmzeidlyssoqmqkh --use-api --yes
   ```

4. Fusion de la PR (un seul build Netlify), puis Réglages > Assistant IA > « Onglet Assistant » dans chaque entreprise.
