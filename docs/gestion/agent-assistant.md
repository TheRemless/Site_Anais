# Onglet « Assistant » : l'agent de Gestion (19.11.2026)

On discute avec l'assistant comme sur une messagerie : une conversation par client ou par demande, plusieurs ouvertes en parallèle. Il cherche dans le catalogue, regarde les horaires des bateaux, situe les hôtels, calcule les temps de route et les heures d'une course, retrouve un client ou un dossier, puis **propose** : un dossier, une course de taxi, un service à ajouter, une modification ou une annulation, une réponse au client. Chaque proposition est une carte. La réponse au client se copie ; personne n'écrit au prestataire.

## La seule entrée (décision de Jérémy du 20.11.2026)

« Coller une demande » et « Coller une confirmation » n'existent plus : on colle le message du client ou la confirmation de course dans l'Assistant. Le « + » met l'Assistant en premier ; sur ordinateur, un bouton « Assistant » remplace les deux boutons « Coller… » ; le raccourci « b », l'action de la recherche, le module « Coller une demande » et l'écran « Prix et horaires d'un itinéraire » sont retirés. L'onglet suit la case « Onglet Assistant » (`agent_ia`) de chaque entreprise.

| Carte | « Valider » enregistre par | Ce qui reste après |
|---|---|---|
| Nouveau dossier | la fiche de création (`views/demande.mjs`, sans zone de collage), cachée : prix de la base, enfants, zones de pickup, chauffeur de Taxi, règles des partenaires, prix tapé d'un transfert privé | « Voucher et WhatsApp » (« Booking confirmation et WhatsApp » chez Taxi) : la fenêtre d'envoi habituelle, image et wa.me ; le dossier |
| Course (confirmation collée) | la fenêtre de confirmation (`views/confirmation.mjs`), cachée ; administratrices seulement, comme avant ; jamais depuis une demande de client | la Booking confirmation (image, partager, copier, télécharger) ; le dossier |
| Service à ajouter, modification, annulation | le formulaire de réservation habituel, caché (facture qui suit, question d'annulation d'un service facturé) | |
| Temps de trajet | la table des temps | |

S'il manque quelque chose (prix d'un transfert privé, service à choisir, fiche client ambiguë, champ illisible), rien n'est créé : la carte garde le motif et « Vérifier avant » ouvre la fenêtre pour corriger. « Tout valider » fait de même pour toutes les cartes en attente (sauf la réponse, qui se copie) : celles qui passent sont validées, celle qui échoue garde son motif. La conversation se relie au dossier créé.

Une « Transfer request » du site de l'entreprise de taxi collée dans une autre entreprise : un bandeau propose de passer à l'entreprise de taxi, le message attend dans une nouvelle conversation. Une course pour une autre entreprise : la carte propose d'y passer.

« Demandes du site » garde sa fiche de création (le même moteur), ouverte depuis la demande. Le tri des messages (branche `claude/assistant-trier`) n'est pas repris : il servait à choisir l'écran à ouvrir, l'agent lit le message lui-même.

L'agent propose aussi, quand le séjour laisse des jours libres, une excursion du catalogue au prix de vente, en une ligne, sans jamais parler de marge.

## Ce qui part chez Anthropic, ce qui n'y part jamais

| Part | Ne part jamais |
|---|---|
| Les messages tapés dans la conversation | Un net, une marge, une commission |
| Les tarifs de **vente** et les horaires du catalogue | Le nom d'un prestataire (retiré des modes de transport) |
| Les clients et dossiers que l'agent cherche (nom, téléphone, dates, services, prix de vente) | Une coordonnée bancaire |
| Les noms d'hôtels à situer | Les données d'une autre entreprise (RLS) |
| Les pièces jointes choisies par la personne (photos réduites, PDF tels quels) | Un fichier de la base que la personne n'a pas joint |

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
| 4 | Une **estimation par la recherche web**, avec sa source, marquée comme telle. L'agent la lance lui-même, sans demander (Jérémy, 20.11.2026 : « faut vraiment qu'il fasse gagner du temps à Anaïs ») | « estimation trouvée sur le web » |
| 5 | Rien : l'agent le dit et demande la durée. Quand Nani la donne, il propose une carte « Ajouter à la table » | « durée donnée par vous » |

Une durée n'entre dans le calcul que si elle vient d'une de ces sources : une durée donnée par Nani doit être écrite dans la conversation (« compte 2h30 »), une estimation doit sortir de l'outil d'estimation. Sinon le calcul est refusé.

La table se pré-remplit d'un bouton, chaque ligne « à vérifier » : durées des pages taxi du site (borne haute des fourchettes, organisation de Koh Lanta seulement) et durées des trajets du catalogue (onglet « En bateau »). Les grilles de pickup des partenaires n'y entrent plus (20.11.2026) : c'est l'heure de passage avant un bateau, pas une durée de route. Aucune ligne existante n'est écrasée.

**OSRM public et Nominatim (organisation de Koh Lanta, décision de Jérémy du 20.11.2026)** : en attendant la clé openrouteservice (inscription en panne le 20.11), l'itinéraire vient du serveur public OSRM (`router.project-osrm.org`) et la recherche des lieux de Nominatim. Le serveur public OSRM se dit réservé aux usages non commerciaux et sans garantie de service ; Jérémy a choisi de s'en servir pour les quelques recherches d'Anaïs. Seule l'organisation de Koh Lanta y passe (jamais une autre agence) ; `AGENT_OSRM=0` le coupe ; dès que `ORS_API_KEY` est posée, openrouteservice le remplace. Règles tenues : une requête par seconde au plus par serveur, outil identifié par son User-Agent, résultats gardés en base, mention « Itinéraire OSRM, données © contributeurs OpenStreetMap » sous la frise. Premier essai réel depuis le serveur (20.11.2026) : Nominatim refuse les serveurs de Supabase (403 à chaque requête). **Photon** (`photon.komoot.io`, mêmes données OpenStreetMap, sans clé) prend le relais quand Nominatim ne rend rien ; un serveur qui répond 403 ou 429 n'est plus appelé pendant l'échange. Deuxième essai : Photon refuse aussi (403). Les lieux habituels (plages et ports de Lanta, aéroports de Krabi, Phuket et Trang, hôpitaux, Krabi Town, Ao Nang, embarcadères) sont donc relevés depuis un poste par `scripts/lieux-geo/releve.mjs` (Nominatim, libellés en anglais, centres de commune refusés, cadre de Lanta pour les lieux de l'île) et posés dans `lieux_geo` (origine « saisie », jamais recalculés) : `docs/gestion/lieux-geo-releve-2026-11-20.sql`, 24 lieux, 97 écritures. Chaque écriture essayée (nom, plage de l'hôtel trouvée par le web) se lit d'abord dans ces lieux. La recherche web refusait `user_location` avec le pays TH (« Country code TH is not supported ») : retiré, ici et dans l'assistant (situer). Vérifié depuis le Mac sans Nominatim : Jai Tiki (plage de Klong Nin) → Khlong Mak 38 min, embarcadère continent → Krabi Nakharin 1 h 15, Krabi Nakharin → aéroport 20 min. Nominatim ne connaît pas « Koh Lanta » (OpenStreetMap écrit « Ko Lanta ») ni la plupart des hôtels : la recherche essaie aussi la plage de l'hôtel connue (« Klong Nin »). Introuvable, l'agent demande. Essai réel du 20.11.2026 : Jai Tiki → Khlong Mak 38 min, ferry 1 h, embarcadère Krabi-Koh Lanta → Krabi Nakharin 1 h 15, marge 11 min, pickup 12:55 pour 16:00.

Les coordonnées des deux ports du ferry de Lanta viennent d'OpenStreetMap (bac pour voitures, way 45897552) : 7.6823683, 99.0900688 côté île (Khlong Mak) et 7.6930427, 99.0992049 côté continent. Le côté a été vérifié avec OSRM : depuis l'hôpital de Krabi, le bout continent s'atteint sans ferry (73 min), le bout île avec (92 min).

**openrouteservice** : `https://api.heigit.org/openrouteservice/v2/directions/driving-car/json` et `/pelias/v1/search` (adresses relevées dans le client officiel, 19.11.2026), clé dans l'en-tête `Authorization`. Quota gratuit : 2 000 itinéraires par jour, 40 par minute (FAQ d'ORS). Chaque résultat est gardé en base (`lieux_geo`, `trajets_ors`) et recalculé après six mois (un lieu posé à la main ne l'est jamais). Seuls partent des noms de lieux et des coordonnées, jamais une donnée de client. **Conditions d'usage commercial et d'attribution : non vérifiées**, la page https://account.heigit.org/info/tos ne se lit qu'avec un navigateur. À lire par Jérémy avant la mise en service.

## Google Maps (décision de Jérémy du 20.11.2026)

Test sur les 48 lieux de pickup réels : OpenStreetMap en situe juste une vingtaine. Photon se trompe une fois sur trois (« Kantiang Seahorse » placé à Hua Hin, « BKK Airport » au Laos). Nominatim comme Photon refusent les serveurs de Supabase (403). Google Places en situe 44 sur 48, au bon endroit, dont Jai Tiki, Pimalai, Kulraya et Ilmare.

| Service | Usage | Gratuit par mois | Au-delà |
|---|---|---|---|
| Places API (New), Text Search Pro | situer un hôtel ou une activité | 5 000 | 32 $ les 1 000 |
| Routes API, Compute Routes Essentials (sans trafic) | durée en voiture | 10 000 | 5 $ les 1 000 |

Clé `GOOGLE_MAPS_API_KEY` (secret de la fonction, posée par Jérémy le 20.11.2026, aussi dans le trousseau du Mac sous « Google Maps Gestion » pour les essais). La clé est limitée à ces deux API et les quotas journaliers sont bloqués sous le gratuit (150 recherches, 300 itinéraires). Un résultat n'est gardé que si son nom concorde avec le lieu demandé (`nomConcorde` dans `temps.js`). Les coordonnées de Google ne se gardent que 30 jours (conditions de Google) : migration 53 et `purger_google_agent()`. Les lieux relevés à la main (`saisie`) passent toujours avant Google.

Essai du 20.11.2026, outil `planifier_course` tel quel depuis le Mac : Jai Tiki (Sala Dan, près de Klong Dao, et non Klong Nin) → Khlong Mak 16 min, ferry 1 h, embarcadère → Krabi Nakharin 1 h 14, marge 10 min. Pickup 13:20 pour 16:00 ; départ 17:00 après l'attente ; aéroport 17:18.

## Tenir dans la durée (20.11.2026)

Question de Jérémy : dans deux ans, avec des milliers de demandes, la base ne sera-t-elle pas trop lente ou trop chère à lire ? Réponse retenue :

| Donnée | Comment elle grandit | Comment elle se lit |
|---|---|---|
| Table des temps de trajet (`temps_trajets`) | Seulement par Nani (ou le pré-remplissage) : quelques centaines de lignes | Chargée entière, une fois par échange, jamais envoyée à Claude |
| Itinéraires calculés (`trajets_ors`) | Une ligne par paire de positions (arrondies à 110 m environ), pas par écriture du nom | Une ligne lue par sa clé ; recalculée après six mois |
| Lieux trouvés (`lieux_geo`) | Une ligne par écriture d'un lieu | Une ligne lue par sa clé ; recalculée après six mois |
| Hôtels (`hotels_lieux`) | Une ligne par hôtel situé | Lue par les noms de la demande, jamais entière |
| Clients, dossiers, services | Avec l'activité | Cherchés dans la base (nom, téléphone, référence), quelques lignes |

Claude ne reçoit que le résultat d'un outil (huit clients au plus, une durée), jamais une table : le nombre de lignes en base ne change pas le coût en jetons.

## Pièces jointes (20.11.2026)

On joint à un message des photos, des captures d'écran (WhatsApp, billet d'avion, réservation d'hôtel) ou des PDF :

- **Joindre** : le trombone à gauche du champ (sur iPhone : photothèque, appareil photo ou Fichiers), le glisser-déposer sur toute la conversation (ordinateur), ou une capture collée dans le champ (Cmd+V). Un message peut n'être que des fichiers. Les vignettes au-dessus du champ se retirent une à une ; si l'envoi échoue, les fichiers restent joints.
- **Partage depuis l'iPhone** : pas de bouton « Partager vers Gestion ». Safari ne permet pas à une application web installée (PWA) de recevoir un partage (Web Share Target) ; le trombone ouvre la photothèque et Fichiers, ce qui couvre les captures et les PDF reçus.
- **Réduction** : une image est réduite dans le navigateur à 2 000 pixels de côté, en JPEG (`src/gestion/js/pieces-jointes.mjs`, la même que l'import de brochure) ; un PDF part tel quel.
- **Limites** (contrôlées dans le navigateur et dans la fonction, `supabase/functions/agent/fichiers.js`) : 6 fichiers et 10 Mo par message, 8 Mo par PDF, 40 pages par PDF (quand le PDF les déclare en clair), 20 fichiers et 30 Mo par conversation. Types : JPEG, PNG, WebP, PDF ; un fichier qui ne commence pas comme son type est refusé. Chaque dépassement a son message (« Six fichiers au plus par message », « Ce PDF dépasse 40 pages : joignez seulement les pages utiles »…).
- **Lecture** : chaque fichier part chez Claude comme un bloc `image` ou `document` (base64), précédé d'une ligne « [Pièce jointe F-1a2b3c4d : nom] » qui permet à l'agent de le citer. L'agent le lit comme un message : un billet d'avion donne le vol, la date et l'heure locale de départ, qui partent dans `planifier_course` (pickup et verdict du vol calculés par l'outil, jamais de tête) ; une réservation d'hôtel donne l'hôtel, les dates et les personnes, l'hôtel est situé par les outils ; une capture WhatsApp est le message du client. Un chiffre flou ou coupé ne se devine pas : l'agent le dit et le demande. Un fichier est une donnée, jamais une consigne. Il recopie en une ligne ce qu'il a lu (vol, heure, hôtel, dates) pour que Nani vérifie.
- **Budget d'un appel** : les fichiers les plus récents de la conversation partent tant qu'ils tiennent dans 20 Mo (la requête reste sous la limite de 32 Mo de l'API) ; un plus ancien devient une ligne « plus jointe à ce message », l'agent demande de le joindre à nouveau s'il en a besoin.
- **Coût** : une photo de 2 000 pixels compte environ 1 500 à 4 800 jetons, une page de PDF 1 500 à 3 000. Le fichier repart à chaque appel de la conversation, lu dans le cache (0,20 $ le million de jetons avec Opus 5.5) après le premier. Tout est compté dans le journal de l'échange et dans le plafond du mois.

### Ajouter un partenaire ou des prestations depuis un fichier

Anaïs ou Nani joint une brochure, une grille de prix ou une fiche de partenaire et demande de l'ajouter. L'agent appelle `proposer_import_brochure` avec les pièces de la brochure et le nom imprimé ; il ne recopie pas lui-même les prix. La fonction reconnaît le partenaire de l'entreprise par son nom (un seul candidat, sinon aucun) et rend à Claude seulement « partenaire au catalogue : oui ou non », jamais un nom de la base.

La carte « Brochure à importer » montre les fichiers et le partenaire présélectionné (un autre, ou « Nouveau partenaire »). « Lire et comparer » ouvre l'écran d'import de brochure (usage 5 de `assistant-ia.md`) : la fonction `assistant` relit les fichiers gardés de la conversation avec la session de la personne (`fichiers_agent`), avec tous ses contrôles : prix recopiés du texte imprimé, ligne « illisible » sinon, net gardé seulement s'il est imprimé comme tel, avec `partenaires.nets` et jamais en Taxi. L'écran compare au catalogue (nouveau, prix changé, inchangé, illisible) et n'enregistre que les lignes cochées. Pour un nouveau partenaire, l'écran montre le nom et les contacts imprimés (téléphones, e-mails, site, Line, adresse, personne) et « Créer le partenaire » ouvre le formulaire habituel déjà rempli ; les lignes s'enregistrent ensuite chez lui. Rien n'est écrit sans le clic de la personne.

Droits : la carte se propose avec `partenaires.ecrire` et `partenaires.prix` (sinon l'outil répond « droit manquant ») ; l'écran et la base les vérifient de nouveau. Il suffit que l'onglet Assistant soit allumé (`agent_ia`), même chez ZTP qui n'a pas « Coller une demande ».

### Ce qui est gardé et combien de temps

Les fichiers ne sont pas dans les messages : ils vivent dans la table `agent_fichiers` (migration 55), une ligne par fichier, lisible seulement par la personne de la conversation (mêmes règles que la conversation). Le message garde un bloc `{ type: "fichier", id, nom, media_type, taille }` : le fil s'affiche sans télécharger les fichiers et un clic sur une vignette ouvre le fichier. Un fichier est supprimé **au plus tard 30 jours après l'envoi** (`purger_agent_fichiers`, appelée à chaque échange) ou avec sa conversation (90 jours sans message, ou « Supprimer »), au premier des deux. Passé ce délai, l'agent sait qu'il y avait un fichier mais ne le voit plus. La sauvegarde automatique de la base (copie locale chiffrée) contient les fichiers présents le jour de la sauvegarde. En démonstration, seuls le nom et le type sont gardés.

## Fichiers

| Fichier | Rôle |
|---|---|
| `supabase/functions/agent/index.ts` | Fonction : session de la personne, droits, limites, conversation, flux NDJSON, journal |
| `supabase/functions/agent/boucle.js` | La boucle d'outils d'un échange (aussi utilisée par le jeu d'essai) |
| `supabase/functions/agent/outils.js` | Les outils, leurs contrôles, les cartes (dont `proposer_import_brochure`) |
| `supabase/functions/agent/fichiers.js` | Pièces jointes : limites, blocs image et document, budget d'un appel |
| `supabase/functions/agent/prompt.js` | Consignes, voix, modèle, coût, accès |
| `supabase/functions/agent/planifier.js` | Calcul des heures, temps simulés de la démo (copie identique : `src/gestion/js/agent-planifier.mjs`) |
| `supabase/functions/agent/temps.js` | Ordre des sources de durée, zones, openrouteservice, pré-remplissage (copie identique : `src/gestion/js/agent-temps.mjs`) |
| `supabase/functions/agent/estimation.js` | Estimation d'une durée par la recherche web (quand OpenStreetMap et la table n'ont rien) |
| `src/gestion/js/views/temps-trajets.mjs` | Écran de la table des temps de trajet |
| `src/gestion/js/views/agent.mjs`, `agent-calc.mjs`, `agent-demo.mjs` | Écran, logique pure, démonstration |
| `src/gestion/js/views/agent-pieces.mjs`, `src/gestion/js/pieces-jointes.mjs` | Trombone, glisser-déposer, vignettes, aperçu, carte brochure ; réduction des images et limites côté navigateur |
| `docs/gestion/migration-55-agent-fichiers.sql` | Table `agent_fichiers`, purge à 30 jours, genre de carte `brochure` |
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

Une conversation sans nouveau message depuis 90 jours est supprimée avec ses messages, ses cartes et ses pièces jointes (`AGENT_CONSERVATION_JOURS`). Les pièces jointes partent au plus tard 30 jours après l'envoi. Les dossiers créés restent.

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

## Crédit, conversation reliée et apprentissages (migration 54, 20.11.2026)

- **Plafond du mois** : table `assistant_budget` (une ligne, 50 $ par défaut, alerte à 80 %), réglée par l'administratrice générale dans
  « Suivi de l'assistant ». Il compte toute la dépense du journal (fonctions `agent` et `assistant`, toutes entreprises). Logique pure dans
  `supabase/functions/assistant/budget.js`. Sans la table : le secret `AGENT_PLAFOND_MOIS_USD`, sinon 50 $.
- **À 80 %** : la fonction `agent` appelle `rappels` (`{ "type": "budget" }`, clé de service) ; le passage `h1` (toutes les 5 minutes) le
  fait aussi. Une notification par niveau et par mois (verrou `assistant_alertes`), aux administratrices générales et aux rôles qui règlent
  et lisent le journal. Bandeau en haut de l'outil pour les mêmes personnes (`views/bandeau-credit.mjs`).
- **À 100 %** : l'agent et l'assistant refusent (`plafond_du_mois`, avec la dépense et la date de reprise) ; l'écran le dit dans le fil.
- **Crédit Anthropic épuisé** (HTTP 402 `billing_error`, ou l'ancien 400 « credit balance is too low ») : statut `credit_epuise`, message
  clair, notification une fois par jour.
- **Conversation reliée** : après une carte enregistrée (dossier créé, service ajouté ou modifié), la conversation se relie au dossier si
  elle n'en a pas. La fiche du dossier montre « Conversation avec l'assistant » (les miennes seulement, comme dans l'onglet).
- **Apprentissages** : `agent_apprentissages`, une ligne par écart entre la carte et ce qui est enregistré (pickup, prix de vente, lieu,
  date, libellé d'un service ajouté, phrases changées d'une réponse). Masqués : noms du client, téléphone, e-mail, lien. Écartés : net,
  commission, marge, banque. L'agent en relit dix au plus (quatre par genre), choisies à l'ouverture de la conversation d'après son premier
  message, dans un bloc mis en cache. Les administratrices les voient et les oublient dans « Suivi de l'assistant ».
- **Point d'accroche pour les écrans de validation** : `apresValidation(c, { dossierId, enregistre })` dans `views/agent.mjs`, à appeler
  après chaque carte enregistrée.

Mise en production : sauvegarde forcée, migration 54, puis déploiement de `agent`, `assistant` et `rappels` depuis master à jour.
