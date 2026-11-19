# Assistant IA de Gestion

Préparé le 12.11.2026. Inactif tant que la case « Assistant IA » n'est pas cochée dans Réglages > Écrans de l'entreprise, et tant que la fonction `assistant` n'est pas déployée avec sa clé.

## Ce qui est livré

| Usage | État | Où |
|---|---|---|
| 1. Lire un message libre de client | Prêt, éteint | Bouton « Lire avec l'assistant » dans Coller une demande |
| 2. Rédiger la réponse au client | Retiré le 19.11.2026 (Anaïs écrit ses réponses, décision de Jérémy) : la fonction refuse l'usage, l'écran n'a plus de bouton, la logique pure reste dans `calc.js` | Rien à l'écran |
| 3. Questions d'Anaïs sur ses données | Conception seulement (plus bas) | Rien dans le code |
| 4. Prix et horaires d'un itinéraire (20.11.2026) | Prêt, suit la case « Assistant IA » ; mémoire des hôtels après la migration 48 | Bouton « Prix et horaires d'un itinéraire » dans Coller une demande |
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
2. **Lire** (`brochure`) : Claude Opus 5.5 (`claude-opus-5-5`, effort `medium`, repli côté serveur `fallbacks: "default"`), sortie JSON imposée. Seuls partent les fichiers et le lieu de l'entreprise : ni le catalogue, ni un prix de la base, ni un net, ni le nom du partenaire. Rendu : par programme le libellé, le prix de vente adulte et enfant, l'âge enfant, l'unité, les horaires, le déroulé, les inclus, les conditions, les frais de parc, le bateau, la capacité ; par départ régulier de bateau le trajet, les heures, la période et ses dates, les prix. Un passage de 110 secondes au plus, sans nouvel essai. Opus plutôt que Haiku : lire des chiffres sur une photo doit être juste et l'usage est rare. Coût estimé 0,05 à 0,15 $ la brochure (une image fait jusqu'à 4 800 jetons), à relire dans `assistant_journal`.
3. **Contrôle dans la fonction** (`brochure.js`) : Claude recopie les mots imprimés des prix (« Adult: 3,900.- Child (4-11 yrs old): 2,900.- ») ; un prix rendu qui n'y figure pas fait passer la ligne en « illisible », ses prix vidés. Un net n'est gardé que s'il est imprimé comme tel (« net », « agent rate ») et recopié ; sinon il est retiré et signalé. « Sur demande » : aucun prix. Une heure de départ invalide rend le trajet illisible. Une ligne que Claude dit illisible le reste.
4. **Comparer** (dans l'outil, `brochure-calc.mjs`) : chaque ligne face au catalogue du partenaire. Même libellé ou mêmes mots : le tarif est reconnu (« Inchangé » ou « Prix changé », l'écart affiché « 3 900 → 4 200 ») ; mots proches : rapproché « à vérifier », non coché d'office ; sinon « Nouveau ». Le prix enfant d'un ancien tarif se lit sur sa ligne enfant séparée (comme Lazy Day du 17.11.2026). Les tarifs du catalogue absents de la brochure sont listés, rien n'y change. La personne peut viser un autre tarif ou « Nouvelle prestation ».
5. **Enregistrer** : seulement les lignes cochées, avec la session de la personne (règles RLS et déclencheur `garder_prix_vente`). Nouveau tarif : prix de vente et prix enfant de la brochure, détails imprimés seulement (le déroulé et les inclus en puces dans « Inclus », l'âge enfant dans « Conditions »), une remarque interne « Importé de la brochure le … (prix imprimé : « … ») ». Tarif existant : les prix suivent la brochure (règle de Jérémy), les textes déjà remplis ne changent pas, seuls les champs vides se complètent, la remarque interne garde la trace. L'unité d'un tarif existant ne change pas ici. Nouveau départ de bateau : créé avec sa période et ses dates (fenêtre de circulation). Une ligne illisible ne s'enregistre jamais : elle se saisit à la main.

Droits : `partenaires.lire`, `partenaires.ecrire` et `partenaires.prix` (l'administratrice les a tous ; le rôle de Mook chez Secret n'a pas le droit prix, il ne voit pas le bouton). Les nets ne s'affichent et ne s'écrivent qu'avec `partenaires.nets`, jamais en Taxi et seulement s'ils sont imprimés : un net n'est jamais déduit, il reste vide sinon. Démonstration : la réponse est simulée depuis le catalogue (`simulerBrochure`), aucun fichier ne part.

Mise en service : migration 50 (`docs/gestion/migration-50-assistant-brochure.sql`, ajoute `brochure` à la contrainte du journal sans retirer `trier` ni les autres usages), puis déploiement de la fonction depuis une branche qui contient tout master. Tests : `tests/gestion-brochure.test.js`, dont les cas réels Lazy Day (Rattana, 3 900 / 2 900) et Maryz (OctopuSea, prix sur demande).

## Données qui partent chez Anthropic

| Usage | Envoyé | Jamais envoyé |
|---|---|---|
| Lire | Le message collé tel quel (il peut contenir nom, téléphone, hôtel, dates, âges des enfants). Le nom de l'entreprise. Les libellés, groupes, modes, horaires de départ et périodes des prestations et trajets, le nom des prestataires. | Prix nets, commissions, marges, coordonnées bancaires, autres clients, dossiers |
| Itinéraire, lire | Le message collé tel quel. Le lieu de l'entreprise. | Catalogue, prix, nets |
| Itinéraire, situer | Les noms d'hôtels, la liste des lieux des trajets de l'entreprise. Claude les envoie au moteur de recherche d'Anthropic. | Nom du client, téléphone, dates, prix |
| Brochure | Les fichiers de la brochure choisis par la personne (images réduites, PDF). Le lieu de l'entreprise. Une grille de prix nets d'agent envoyée par erreur partirait aussi : l'écran demande la brochure publique. | Catalogue, prix et nets de la base, nom du partenaire, clients |
| Itinéraire, rédiger | Prénom du client, personnes, pour chaque trajet : date, lieux, mode, durée, horaires, prix de vente. La voix de l'entreprise. | Nets, marges, compagnies, nom de famille, téléphone |
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
- Données qui partiraient chez Anthropic : les résultats de ces lectures, donc aussi des montants et, pour un rôle qui a le droit, des commissions. C'est le point à valider par Jérémy avant de construire.
