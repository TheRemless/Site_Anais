# Assistant IA de Gestion

Préparé le 12.11.2026. Inactif tant que la case « Assistant IA » n'est pas cochée dans Réglages > Écrans de l'entreprise, et tant que la fonction `assistant` n'est pas déployée avec sa clé.

## Ce qui est livré

| Usage | État | Où |
|---|---|---|
| 1. Lire un message libre de client | Retiré de l'écran le 20.11.2026 : l'onglet Assistant (agent) lit les messages collés. La fonction garde l'usage (jeu d'essai) | Rien à l'écran |
| 2. Rédiger la réponse au client | Retiré le 19.11.2026 (Anaïs écrit ses réponses, décision de Jérémy) : la fonction refuse l'usage, l'écran n'a plus de bouton, la logique pure reste dans `calc.js` | Rien à l'écran |
| 3. Questions d'Anaïs sur ses données | Conception seulement (plus bas) | Rien dans le code |
| 4. Prix et horaires d'un itinéraire (20.11.2026) | Écran retiré le 20.11.2026 : l'onglet Assistant planifie les itinéraires (horaires à la meilleure marge, réponse). La fonction garde les usages, `itineraire-calc.mjs` reste (hôtels connus, jeu d'essai) | Rien à l'écran |
| 5. Importer une brochure de partenaire (20.11.2026) | Prêt, suit la case « Assistant IA » ; journal après la migration 50 | Bouton « Importer une brochure » dans la fiche du partenaire, section Tarifs |

Fichiers : `supabase/functions/assistant/index.ts` (fonction), `supabase/functions/assistant/calc.js` (logique pure, testée), `src/gestion/js/assistant-calc.mjs` et `views/assistant-demande.mjs` (outil), `docs/gestion/migration-27-assistant.sql` (journal), `tests/gestion-assistant.test.js`.

## Comment ça marche

1. L'outil appelle la fonction `assistant` avec la session de la personne connectée. La passerelle Supabase vérifie le jeton.
2. La fonction lit les réglages de l'entreprise et les droits de la personne avec cette même session (`permissions_dans`, la fonction qui protège les tables). Il faut la case allumée, `partenaires.lire` et `dossiers.ecrire`.
3. Limite : 40 appels par personne et par jour (heure de Bangkok), réglable avec le secret `ASSISTANT_LIMITE_JOUR`.
4. Elle lit le catalogue avec la session de la personne (règles RLS appliquées). Les tables de nets ne sont jamais lues.
5. Elle appelle Claude Haiku 5.5 (`claude-haiku-5-5`, depuis le 19.11.2026, avant Claude Opus 5.5) avec le SDK officiel, effort `medium`, une sortie JSON imposée, le cache sur les consignes et le catalogue. Haiku n'a pas de repli côté serveur : un refus laisse la lecture par règles affichée.
6. Elle contrôle la réponse : référence absente du catalogue retirée, nom, téléphone ou hôtel absent du message retiré, date ou heure invalide vidée, montant ou heure du brouillon absent des faits signalé en orange.
7. Elle note l'appel dans `assistant_journal` (personne, entreprise, usage, statut, modèle, jetons, coût estimé). Jamais le message ni la réponse.
8. L'outil affiche la proposition. Les prix sont recalculés dans l'outil depuis la base, comme la lecture par règles. Anaïs corrige, crée le dossier, relit le brouillon. Rien n'est créé ni envoyé sans elle.

Si l'assistant ne répond pas (éteint, limite, refus, panne), la lecture par règles reste affichée.

## Usage 4 : prix et horaires d'un itinéraire

Le client donne ses hôtels et ses dates (« du 21 au 25 Breizh Cape Beach Bungalows, du 25 au 28 Paradise Resort Phi Phi… ») et demande tarifs et horaires. Un seul écran, de haut en bas :

1. **Lire** (`itineraire`) : le message seul part, sans catalogue (environ 0,001 $). Rendu : étapes (hôtel, arrivée, départ, lieu écrit), personnes, langue, prénom. Un hôtel ou un prénom absent du message est retiré, une date impossible vidée. Nani corrige tout à l'écran.
2. **Situer** (`situer`) : pour les hôtels inconnus, Claude Haiku 5.5 avec l'outil serveur `web_search_20250305` (la version que Haiku prend, sans filtrage dynamique), deux recherches par hôtel au plus, résultats orientés Thaïlande (`user_location`). Seuls partent les noms d'hôtels (nettoyés de tout téléphone ou e-mail collé avec) et la liste des lieux des trajets de l'entreprise. Claude rend sa réponse par un outil strict `situer_hotels` (lieu de la liste, zone, localité, adresse de la source, certitude). La fonction n'accepte comme source qu'une adresse sortie des résultats de la recherche : sans elle, rien n'est proposé. Coût : 10 $ les 1 000 recherches plus les jetons, environ 0,01 à 0,02 $ par hôtel. Le résultat est gardé dans `hotels_lieux` (migration 48) : un hôtel ne se cherche qu'une fois ; une correction de Nani est gardée « vérifiée ». Un lieu hors catalogue (« Koh Libong ») se tape à la main.
3. **Trajets** (dans l'outil, aucun appel) : un trajet par changement d'hôtel, le jour de l'arrivée suivante. Les départs viennent de `trajets` (actifs, prestataire non masqué, dans leur fenêtre de circulation). La marge (vente moins net, `trajets_nets`) se calcule dans le navigateur pour le groupe (adultes et enfants) : les horaires de la compagnie à la meilleure marge sont proposés, à marge égale ceux de toutes. Les compagnies écartées restent visibles pour Nani seule. Sans le droit « nets », tous les horaires sont proposés, sans classement.
4. **Rédiger** (`repondre_itineraire`) : la fonction n'accepte que des faits aux clés fermées (date, lieux, mode, durée, horaires, prix de vente adulte et enfant, au catalogue ou non). Jamais un net, une marge ni un nom de compagnie. Langue du client (français pour un francophone, même chez Secret). Voix de l'entreprise (réglages ; à défaut une voix neutre sans formule de fin), vouvoiement. Aucune signature ni prénom ni nom d'entreprise en bas (Secret et Taxi : c'est une conversation WhatsApp, décision de Jérémy du 19.11.2026) ; une signature rendue quand même est retirée et signalée. « Nous ne proposons pas ce trajet, mais je peux me renseigner » pour ce qui manque. Contrôle : un montant ou une heure absents des faits, ou un mot interne (marge, commission, net, partenaire), sont signalés en orange. Environ 0,001 $.
5. **Créer** : Nani coche les horaires choisis par le client, « Créer le dossier avec les horaires choisis » ouvre Coller une demande déjà remplie (un service par trajet, l'hôtel de la veille comme lieu de pickup), puis la création habituelle.

La zone gardée pour un hôtel (« Relax Bay ») sert aussi à proposer la zone de pickup dans Coller une demande, après la mémoire des réservations et l'adresse.

Chaque appel compte dans la limite de 40 par personne et par jour : une demande complète en fait trois.

## Usage 5 : importer une brochure de partenaire

Nani (Secret, Taxi) ou Anaïs (Zwald) reçoit la brochure d'un partenaire. Dans la fiche du partenaire, « Importer une brochure » :

1. **Fichiers** : photos, captures ou PDF, six au plus, 10 Mo en tout. Une photo est réduite dans le navigateur à 2 000 pixels de côté (JPEG) ; un PDF part tel quel (8 Mo au plus).
2. **Lire puis relire** (`brochure`, deux appels depuis le 24.11.2026) : Claude Opus 5.5 (`claude-opus-5-5`, réflexion adaptative par défaut, paramètre `thinking` non envoyé, repli côté serveur `fallbacks: "default"`), sortie JSON imposée, réponse en flux. Schémas sans aucun type union (un nombre absent vaut 0) : la limite de l'API est de 16 par requête et la relecture en avait 16 (correctif du 24.11.2026, test `gestion-brochure-parametres.test.js`). Une erreur de l'API revient à l'écran avec son statut, son type et son message (`detail_api`), le journal note `erreur_api_<statut>` et le modèle appelé. Essai de la fonction déployée, à lancer par une personne : `scripts/essai-brochure-fonction.mjs`. **Lecture** (`passe: "lecture"`, effort `medium`, 64 000 jetons de sortie au plus) : une liste de contrôle explicite (colonnes repérées par leur en-tête dans toutes les langues, dont « เก็บ », « net », « agent », « cost », « ราคาทุน » ; manuscrit ; scotch et caches ; cases fusionnées ; fautes d'impression comme « 12.0 AM » ; arrivée du lendemain ; lignes coupées ; aucun fait inventé). Chaque ligne rend l'imprimé brut (`imprime`, `de_imprime`, `vers_imprime`), la valeur normalisée, le net et sa source (imprimé ou manuscrit, `net_cache` s'il est caché), la confiance et la raison. **Relecture** (`passe: "relecture"`, effort `high`, 32 000 jetons) : Claude relit les mêmes images avec sa première extraction (renvoyée par le navigateur, contrôlée de nouveau) et ne rend que ce qui change : lignes corrigées, lignes signalées (confiance basse), lignes oubliées, fiche corrigée. Seuls partent les fichiers, le lieu de l'entreprise et, à la relecture, la première extraction : ni le catalogue, ni un prix ou un net de la base, ni le nom du partenaire. Chaque passe tient en 135 secondes (secret `ASSISTANT_BROCHURE_DELAI_MS` pour l'allonger sur une offre Supabase payante), sans nouvel essai ; trop long : « envoyez la brochure en deux fois ». Coût estimé 0,15 à 0,95 $ (0,50 $ pour une grille de 27 lignes) la brochure, les deux passes comprises (détail dans la PR), à relire dans `assistant_journal` (deux lignes `brochure` par import).
3. **Contrôle dans la fonction** (`brochure.js`) : Claude recopie les chiffres des prix (`prix_texte`) et des nets (`net_texte`) ; un prix rendu qui n'y figure pas est vidé (« à saisir »), un net qui n'y figure pas est retiré et signalé. Un net s'écrit s'il figure sur le document, imprimé ou écrit à la main ; il n'est jamais déduit. Un net au-dessus du prix de vente est gardé et signalé. Une ligne n'est illisible que si son prix de vente ou son trajet (lieux, heure de départ) ne se lit pas : un net caché la laisse lisible, avec « net à saisir ». Arrivée avant le départ, ou trajet de nuit dit par Claude : `lendemain`, et la durée se calcule (« 22 h ») quand elle n'est pas imprimée. « Sur demande » : aucun prix.
4. **Comparer** (dans l'outil, `brochure-calc.mjs`) : chaque ligne face au catalogue du partenaire. Même libellé ou mêmes mots : le tarif est reconnu (« Inchangé » ou « Prix changé », l'écart affiché « 3 900 → 4 200 ») ; mots proches : rapproché « à vérifier », non coché d'office ; sinon « Nouveau ». Le prix enfant d'un ancien tarif se lit sur sa ligne enfant séparée (comme Lazy Day du 17.11.2026). Les tarifs du catalogue absents de la brochure sont listés, rien n'y change. La personne peut viser un autre tarif ou « Nouvelle prestation ».
5. **Enregistrer** : seulement les lignes cochées, une par une, chacune en une transaction par la fonction `brochure_ecrire_ligne` (migration 124) : la ligne, sa ligne enfant séparée et ses nets passent ensemble ou pas du tout. La base contrôle les droits (`partenaires.ecrire` et `partenaires.prix`, plus `partenaires.nets` pour une ligne qui porte un net : sans lui, la ligne est refusée en entier), les règles RLS et le déclencheur `garder_prix_vente` s'appliquent. Nouveau tarif : prix de vente et prix enfant de la brochure, détails imprimés seulement, une remarque interne « Importé de la brochure le … ». Tarif existant : les prix suivent la brochure, les textes déjà remplis ne changent pas, seuls les champs vides se complètent. Nouveau trajet : lieux au nom usuel, arrivée du lendemain écrite « 06:00 (next day) » comme au catalogue, durée, période et dates. Trajet existant : prix mis à jour, arrivée complétée (ou marquée « next day » si la même heure ne le disait pas). Une ligne illisible ne s'enregistre pas telle quelle : elle se complète dans l'écran (prix, net, heures), puis se coche.
6. **Écran** (`views/brochure.mjs`) : chaque ligne montre l'imprimé, le nom de lieu retenu (catalogue d'abord, puis table d'abréviations : BKK, KL, Hadyai, A/P, Ipho, Phatthalang, Nakon, Padang, Kolok, Khaosan) dans un champ modifiable avec l'imprimé dessous, et ses signaux : « Net à saisir », « Lieu à vérifier » (nom incertain, jamais inventé), « Lecture douteuse », « Signalé, corrigé ou ajouté à la relecture », « Prix de la case fusionnée », « Ligne coupée ». Une ligne à regarder n'est pas cochée d'office. La section des trajets s'appelle « Horaires et trajets » (« Horaires de bateau » pour des bateaux seuls). Un nouveau partenaire se crée avec sa fiche imprimée : nom en casse normale, nom thaï, catégorie et groupe déduits (bus et minivans : « Land transfers and taxis », groupe « transport », ou la catégorie déjà en base), point de départ, libellé de chaque numéro et ses cases WhatsApp et LINE.

Droits : `partenaires.lire`, `partenaires.ecrire` et `partenaires.prix` (l'administratrice les a tous ; le rôle de Mook chez Secret n'a pas le droit prix, il ne voit pas le bouton). Les nets ne s'affichent et ne s'écrivent qu'avec `partenaires.nets`, jamais en Taxi, et seulement s'ils figurent sur le document, imprimés ou écrits à la main : un net n'est jamais déduit, il reste vide sinon. Démonstration : aucun fichier ne part ; un nouveau partenaire ouvre une brochure fictive de transporteur (`brochure-demo.mjs` : nets manuscrits, scotch, lendemain, abréviations, ligne coupée retrouvée à la relecture), un partenaire existant une réponse tirée du catalogue (`simulerBrochure`).

Depuis l'onglet Assistant (20.11.2026) : la brochure jointe à une conversation se lit par la carte « Brochure à importer » (voir `agent-assistant.md`, « Ajouter un partenaire ou des prestations depuis un fichier »). La fonction reçoit alors `fichiers_agent` (identifiants de `agent_fichiers`) au lieu des fichiers : elle les relit avec la session de la personne, vérifie qu'ils viennent d'une conversation de l'entreprise, puis fait les mêmes contrôles. C'est l'onglet Assistant qui doit être allumé (`agent_ia`). Le partenaire peut être nouveau (`nouveau_partenaire: true`, sans `partenaire_id`) : l'écran fait créer le partenaire par le formulaire habituel, prérempli du nom et des contacts imprimés, avant d'enregistrer les lignes. La lecture rend aussi les **contacts imprimés** (`contacts` : téléphones, e-mails, site, Line, adresse, personne), recopiés tels quels, vides sinon ; un numéro sans six chiffres, un e-mail ou un site mal formé sont retirés.

Mise en service de l'import fiable (24.11.2026) : migration 124 (`docs/gestion/migration-124-brochure-ecriture.sql`, contrôle `verif-brochure-ecriture.mjs`) avant la publication de l'outil, puis déploiement des fonctions `assistant` et `agent`. Tests : `tests/gestion-brochure-fiable.test.js`. Mise en service d'origine : migration 50 (`docs/gestion/migration-50-assistant-brochure.sql`, ajoute `brochure` à la contrainte du journal sans retirer `trier` ni les autres usages), puis déploiement de la fonction depuis une branche qui contient tout master. Tests : `tests/gestion-brochure.test.js`, dont les cas réels Lazy Day (Rattana, 3 900 / 2 900) et Maryz (OctopuSea, prix sur demande).

## Suivi de l'assistant : coût, usage et qualité (20.11.2026)

Écran `#/assistant`, ouvert depuis Réglages (bouton en haut, et lien sous la case « Assistant IA »). Réservé aux personnes qui ont dans une entreprise les droits « réglages » et « journal » (les administratrices) ; l'administratrice générale voit toutes les entreprises, avec un choix d'entreprise. Fichiers : `views/assistant-suivi.mjs` (écran), `assistant-suivi-calc.mjs` (calculs, testés dans `tests/gestion-assistant-suivi.test.js`), `demo-assistant.mjs` (journal fictif de la démo).

| Bloc | Source | Règle |
|---|---|---|
| Coût du jour, du mois, projection | `assistant_journal.cout_estime_usd` | Jours de Bangkok. Projection : coût moyen par jour écoulé × jours du mois, dès le 3. La facture d'Anthropic fait foi. |
| Appels par usage, par personne, par entreprise | `assistant_journal` | Mois en cours. Un usage nouveau (`trier`, `brochure`) apparaît seul, sous son code tant qu'il n'a pas de libellé dans `USAGES_SUIVIS`. |
| Échecs | `statut` du journal | « refus » = refus de Claude ; tout autre statut que « ok » = erreur. Les demandes arrêtées avant Claude (éteint, droit, limite) ne sont pas notées. |
| Limite du jour | nombre de lignes du jour par personne | 40 (`LIMITE_JOUR`, égal à `LIMITE_JOUR_DEFAUT`, un test le vérifie). Comptée toutes entreprises confondues, comme la fonction. |
| Tendance 30 jours | `assistant_journal` | Coût par jour ; toucher une colonne donne appels et échecs. |
| Qualité | `assistant_retouches` (migration 51) | Part des réponses rédigées copiées sans retouche, et part moyenne de mots changés. |

**Mesure de qualité (migration 51, `docs/gestion/migration-51-assistant-retouches.sql`).** Le journal ne dit pas si une réponse rédigée a été retouchée. À la première copie d'un brouillon (bouton « Copier » de la réponse d'itinéraire), l'outil calcule dans le navigateur la part de mots changés entre le brouillon et le texte copié (distance d'édition sur les mots, 0 à 100) et n'envoie que ce nombre, avec l'entreprise et l'usage. Jamais le texte. Une retouche faite ensuite dans WhatsApp n'est pas vue. Avant la migration, rien n'est noté et l'écran l'indique.

Pour un nouvel usage qui rédige (brochure…) : l'ajouter à `USAGES_REDIGES` et appeler `etat.store.noterRetouche({ entiteId, usage, part: partModifiee(brouillon, texteCopie) })` à la copie.

## Jeu d'essai (20.11.2026)

Pour mesurer l'assistant avant et après chaque changement, et demain l'agent conversationnel.

- Jeu privé, hors dépôt : `~/Desktop/Gestion-Test/eval-assistant/cas.json`, relecture dans `cas.md`. 56 messages anonymisés : 10 demandes du site réelles, 2 cas transmis par Jérémy, 8 essais des mémoires, 36 écrits d'après eux. Dont 5 cas de planification (arriver à une heure donnée) et 5 conversations à plusieurs messages. Une copie du catalogue sans aucun net est dans `catalogue/`, les résultats dans `resultats/`.
- Script : `scripts/eval-assistant/run-eval.mjs` (squelette du skill claude-api, build-eval). Il appelle Claude avec exactement les paramètres de la fonction (mêmes prompts, schémas, modèle, effort, contrôles). Seuls la session, le journal et la lecture de la base sont remplacés par le jeu et sa copie du catalogue.
- Clé : `ANTHROPIC_API_KEY`, sinon le trousseau macOS (service « Eval assistant Gestion », ajoutée par Jérémy avec `security add-generic-password -s "Eval assistant Gestion" -a anthropic -w`). Jamais dans un fichier.
- Lancer : `node scripts/eval-assistant/run-eval.mjs --flow ~/Desktop/Gestion-Test/eval-assistant/resultats --variant baseline --reps 3`. Options `--usages lire,itineraire` et `--cas R01,M02`. Vérifier le câblage sans dépense : `--simulation oracle` doit donner 100 %, `--simulation vide` presque 0.
- Notation (`notes.mjs`, sans juge IA) : champs exacts pour `lire` et `itineraire` (nom, téléphone, hôtel, dates, heures, personnes, ligne du catalogue, étapes). Pour `repondre_itineraire` et `rediger` : aucun montant ni horaire hors des faits, aucun nom de compagnie ni mot interne, pas de signature chez Secret et Taxi, tous les prix et horaires présents, langue, vouvoiement. Pour le futur agent (`noterAgent`, champ « agent » des cas) : un départ qui arrive à temps, aucun qui arrive trop tard, aucune heure de pickup inventée quand le catalogue ne donne pas la durée, aucun prix de catalogue inapplicable, les questions manquantes posées. `noterTrier` note le type d'un message.
- Coût mesuré : 0,065 $ par passage complet (101 appels sur Claude Haiku 5.5).

### Scores de départ (19.11.2026, 3 passages, 0,19 $)

| Usage | Cas | Exact | Ce qui rate |
|---|---|---|---|
| `lire` | 26 | 91 % (± 6) | Taxi Krabi Airport du catalogue Secret jugé hors catalogue ; message en français lu en anglais ; prénom en signature (« Lea ») laissé vide |
| `itineraire` | 7 | 86 % (± 15) | Dernière étape sans hôtel (« then on Feb 12 we go to Langkawi ») mise en remarque : le trajet vers Langkawi manque |
| `repondre_itineraire` | 7 | 100 % | Rien |
| `rediger` (retiré) | 5 | 47 % (± 25) | Signe « Have a lovely day, Anaïs » : la voix de Secret dans les réglages dit « You write as Anaïs » et finit par une formule signée |
| `trier` (branche à part, non fusionnée) | 56 | 93 % (± 4) | « 3 février » daté 2026 au lieu de 2027 ; nom oublié ; message d'un prestataire lu comme un changement ; trois trajets taxi lus comme un itinéraire |

Les résultats et transcriptions sont dans `~/Desktop/Gestion-Test/eval-assistant/resultats/` (`report.html`).

## Données qui partent chez Anthropic

| Usage | Envoyé | Jamais envoyé |
|---|---|---|
| Lire | Le message collé tel quel (il peut contenir nom, téléphone, hôtel, dates, âges des enfants). Le nom de l'entreprise. Les libellés, groupes, modes, horaires de départ et périodes des prestations et trajets, le nom des prestataires. | Prix nets, commissions, marges, coordonnées bancaires, autres clients, dossiers |
| Itinéraire, lire | Le message collé tel quel. Le lieu de l'entreprise. | Catalogue, prix, nets |
| Itinéraire, situer | Les noms d'hôtels, la liste des lieux des trajets de l'entreprise. Claude les envoie au moteur de recherche d'Anthropic. | Nom du client, téléphone, dates, prix |
| Brochure | Les fichiers de la brochure choisis par la personne (images réduites, PDF). Le lieu de l'entreprise. Une grille de prix nets d'agent envoyée par erreur partirait aussi : l'écran demande la brochure publique. | Catalogue, prix et nets de la base, nom du partenaire, clients |
| Itinéraire, rédiger | Prénom du client, personnes, pour chaque trajet : date, lieux, mode, durée, horaires, prix de vente. La voix de l'entreprise. | Nets, marges, compagnies, nom de famille, téléphone |
| Agent (onglet Assistant, `agent-assistant.md`) | La conversation, les tarifs de vente et horaires, les clients et dossiers cherchés. Avec `partenaires.lire`, le nom des partenaires. Avec `partenaires.nets`, les nets, marges, règles de commission, commissions prévues et reçues : décision de Jérémy du 20.11.2026, pour que l'agent réponde sans qu'on cherche ailleurs. Une réponse au client qui contient l'un d'eux ne peut pas être copiée. | Coordonnées bancaires, autres entreprises ; sans les droits, noms des partenaires, nets et commissions |
| Rédiger (retiré le 19.11.2026, plus rien n'est envoyé) | Le prénom du client, chaque service retenu (libellé, date, heure, personnes, prix de vente, horaires, durée, frais de parc, lieu), le total, le téléphone de l'entreprise, les messages types de l'entreprise, et le message du client s'il a été collé. | Idem, et le nom de famille du client |

Anthropic traite ces données pour répondre. Ses conditions commerciales de l'API excluent par défaut l'entraînement des modèles sur ces données. La durée de conservation et le lieu de traitement ne sont pas vérifiés ici : à relire dans les conditions et la politique de confidentialité d'Anthropic avant l'activation, puis à reporter dans le texte ci-dessous.

### À ajouter aux politiques de confidentialité de Zwald et de Secret

Texte à faire passer par `redaction-fr` (Zwald, en français) et en anglais pour Secret, puis par l'avocat avec les points CGV déjà ouverts :

- Pour préparer une réponse plus vite, le contenu de votre message et les détails de votre demande (services, dates, nombre de personnes, hôtel) peuvent être traités par un prestataire d'intelligence artificielle, Anthropic PBC (États-Unis), agissant pour notre compte.
- Ces données servent uniquement à préparer notre réponse, qui est toujours relue par une personne avant envoi. Elles ne servent pas à entraîner ses modèles et sont effacées par ce prestataire après un délai de N jours (durée à reprendre des conditions d'Anthropic).
- Transfert hors de Suisse, de l'UE et de Thaïlande : clauses contractuelles du prestataire. Base : la réponse à votre demande (mesures précontractuelles).

Clients suisses et européens (nLPD, RGPD) : le registre des traitements doit mentionner ce sous-traitant. Le droit thaïlandais (PDPA) demande aussi d'informer du transfert à l'étranger.

## Coût mesuré

Essais réels du 19.11.2026 (messages fictifs, journal `assistant_journal`), avec Claude Opus 5.5 :

| Appel | Jetons entrée / sortie / cache écrit | Coût |
|---|---|---|
| Lire Secret, à froid | 155 / 314 / 55 831 | 0,286 $ |
| Lire Taxi, à froid | 140 / 228 / 2 756 | 0,019 $ |
| Rédiger (retiré depuis) | 400 à 680 / 570 à 940 / 830 à 1 290 | 0,019 à 0,026 $ |

Le catalogue Secret (327 prestations, 538 trajets) fait environ 56 000 jetons : avec Opus, 10 lectures par jour coûtaient environ 85 $ par mois. D'où le passage à Claude Haiku 5.5 pour lire (0,10 $ par million en entrée, 0,125 $ en écriture de cache, 0,50 $ en sortie, tant que le prompt reste sous 100 000 jetons) : environ 0,01 $ par lecture Secret à froid. Le coût réel se lit dans `assistant_journal` (colonne `cout_estime_usd`).

## Activer l'assistant

1. Jérémy crée une clé sur console.anthropic.com dans l'organisation ZTP (Settings > API Keys), avec une limite de dépense mensuelle (Settings > Limits), 30 $ proposés.
2. Jérémy la donne à Supabase lui-même, sans la coller dans le chat :
   `supabase secrets set ANTHROPIC_API_KEY=… --project-ref lkxqcmzeidlyssoqmqkh`
3. Claude fait une sauvegarde forcée de la base, vérifie la migration 27 en lecture puis l'applique après l'accord de Jérémy.
4. Claude déploie la fonction après l'accord de Jérémy : `npx -y supabase@3.0.0 functions deploy assistant --remote=lkxqcmzeidlyssoqmqkh --use-api --yes`.

Le dossier `supabase/` ne déclenche pas de build Netlify (`scripts/netlify-ignore.sh`, 19.11.2026) : la fonction se déploie à part, une modification de la fonction seule ne coûte pas de minutes de build.

Vérifié le 19.11.2026 avec le skill claude-api : modèle `claude-haiku-5-5` (avant `claude-opus-5-5`), effort `medium` explicite, réflexion adaptative implicite, pas de `fallbacks` (Haiku 5.5 n'a pas de repli côté serveur ; `parametresAppel` le remet pour Opus ou Sonnet si on y revient), SDK `@anthropic-ai/sdk@1.3.0` déjà sur la version d'API `2026-10-21`, aucun paramètre retiré par cette version. Le catalogue envoyé exclut aussi les tarifs d'un partenaire masqué, comme la lecture par règles.
5. Jérémy coche « Assistant IA » dans Réglages > Écrans de Secret (et de Zwald s'il le veut).
6. Premier essai réel sur un vrai message, lecture de la ligne du journal et du coût.

## Usage 3 : questions d'Anaïs sur ses données (conception, non construit)

Exemples : « quels services demain sans heure de pickup ? », « combien de commissions à recevoir de Rattana ? ».

**Principe : Claude ne touche jamais la base.** Il choisit un outil dans une liste fermée, la fonction exécute l'outil avec la session de la personne, puis Claude formule la réponse à partir du résultat.

- Outils en lecture seule, écrits à la main, un par question type : `services_du_jour(date, filtre)`, `commissions_a_recevoir(partenaire)`, `impayes(periode)`, `dossiers_sans_voucher()`, `stats(periode)`. Chacun appelle une requête fixe ou une fonction SQL `security invoker` déjà soumise aux règles RLS. Pas de SQL écrit par Claude.
- Le client Supabase de la fonction est celui de la personne (jeton transmis), jamais la clé de service. Une personne sans le droit `partenaires.nets` n'obtient aucune ligne de `reservations_nets` : l'outil `commissions_a_recevoir` lui répond « droit manquant », Claude ne peut pas contourner.
- La liste des outils proposés à Claude dépend des droits : sans `partenaires.nets`, les outils de nets et de commissions ne sont même pas déclarés ; sans `finances.voir`, ni impayés ni statistiques.
- Résultats réduits avant d'être donnés à Claude : seulement les colonnes utiles à la question (référence de dossier, date, libellé, montant), pas de téléphone ni d'adresse sauf si la question les demande, au plus 50 lignes.
- Boucle d'outils limitée (5 appels par question), `strict: true` sur chaque outil, journal identique aux usages 1 et 2.
- Aucun outil d'écriture. Une action proposée (« ajouter l'heure ») ouvre l'écran de l'outil, Anaïs agit elle-même.
- Données qui partiraient chez Anthropic : les résultats de ces lectures, donc aussi des montants et, pour un rôle qui a le droit, des commissions. Validé par Jérémy le 20.11.2026 pour l'agent (onglet Assistant) : les nets et les commissions y partent pour les personnes qui ont `partenaires.nets`.
