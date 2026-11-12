# Assistant IA de Gestion

Préparé le 12.11.2026. Inactif tant que la case « Assistant IA » n'est pas cochée dans Réglages > Écrans de l'entreprise, et tant que la fonction `assistant` n'est pas déployée avec sa clé.

## Ce qui est livré

| Usage | État | Où |
|---|---|---|
| 1. Lire un message libre de client | Prêt, éteint | Bouton « Lire avec l'assistant » dans Coller une demande |
| 2. Rédiger la réponse au client | Prêt, éteint | Bouton « Rédiger la réponse » sous le service retenu |
| 3. Questions d'Anaïs sur ses données | Conception seulement (plus bas) | Rien dans le code |

Fichiers : `supabase/functions/assistant/index.ts` (fonction), `supabase/functions/assistant/calc.js` (logique pure, testée), `src/gestion/js/assistant-calc.mjs` et `views/assistant-demande.mjs` (outil), `docs/gestion/migration-26-assistant.sql` (journal), `tests/gestion-assistant.test.js`.

## Comment ça marche

1. L'outil appelle la fonction `assistant` avec la session de la personne connectée. La passerelle Supabase vérifie le jeton.
2. La fonction lit les réglages de l'entreprise et les droits de la personne avec cette même session (`permissions_dans`, la fonction qui protège les tables). Il faut la case allumée, `partenaires.lire`, et `dossiers.ecrire` pour lire un message ou `dossiers.lire` pour rédiger.
3. Limite : 40 appels par personne et par jour (heure de Bangkok), réglable avec le secret `ASSISTANT_LIMITE_JOUR`.
4. Elle lit le catalogue avec la session de la personne (règles RLS appliquées). Les tables de nets ne sont jamais lues.
5. Elle appelle Claude Opus 5.5 (`claude-opus-5-5`) avec le SDK officiel, une sortie JSON imposée, le repli `fallbacks: "default"` en cas de refus, le cache sur les consignes et le catalogue.
6. Elle contrôle la réponse : référence absente du catalogue retirée, nom, téléphone ou hôtel absent du message retiré, date ou heure invalide vidée, montant ou heure du brouillon absent des faits signalé en orange.
7. Elle note l'appel dans `assistant_journal` (personne, entreprise, usage, statut, modèle, jetons, coût estimé). Jamais le message ni la réponse.
8. L'outil affiche la proposition. Les prix sont recalculés dans l'outil depuis la base, comme la lecture par règles. Anaïs corrige, crée le dossier, relit le brouillon. Rien n'est créé ni envoyé sans elle.

Si l'assistant ne répond pas (éteint, limite, refus, panne), la lecture par règles reste affichée.

## Données qui partent chez Anthropic

| Usage | Envoyé | Jamais envoyé |
|---|---|---|
| Lire | Le message collé tel quel (il peut contenir nom, téléphone, hôtel, dates, âges des enfants). Le nom de l'entreprise. Les libellés, groupes, modes, horaires de départ et périodes des prestations et trajets, le nom des prestataires. | Prix nets, commissions, marges, coordonnées bancaires, autres clients, dossiers |
| Rédiger | Le prénom du client, chaque service retenu (libellé, date, heure, personnes, prix de vente, horaires, durée, frais de parc, lieu), le total, le téléphone de l'entreprise, les messages types de l'entreprise, et le message du client s'il a été collé. | Idem, et le nom de famille du client |

Anthropic traite ces données pour répondre. Ses conditions commerciales de l'API excluent par défaut l'entraînement des modèles sur ces données. La durée de conservation et le lieu de traitement ne sont pas vérifiés ici : à relire dans les conditions et la politique de confidentialité d'Anthropic avant l'activation, puis à reporter dans le texte ci-dessous.

### À ajouter aux politiques de confidentialité de Zwald et de Secret

Texte à faire passer par `redaction-fr` (Zwald, en français) et en anglais pour Secret, puis par l'avocat avec les points CGV déjà ouverts :

- Pour préparer une réponse plus vite, le contenu de votre message et les détails de votre demande (services, dates, nombre de personnes, hôtel) peuvent être traités par un prestataire d'intelligence artificielle, Anthropic PBC (États-Unis), agissant pour notre compte.
- Ces données servent uniquement à préparer notre réponse, qui est toujours relue par une personne avant envoi. Elles ne servent pas à entraîner ses modèles et sont effacées par ce prestataire après un délai de N jours (durée à reprendre des conditions d'Anthropic).
- Transfert hors de Suisse, de l'UE et de Thaïlande : clauses contractuelles du prestataire. Base : la réponse à votre demande (mesures précontractuelles).

Clients suisses et européens (nLPD, RGPD) : le registre des traitements doit mentionner ce sous-traitant. Le droit thaïlandais (PDPA) demande aussi d'informer du transfert à l'étranger.

## Coût estimé

Prix du skill claude-api (relevé du 03.11.2026), Claude Opus 5.5 : 4 $ par million de jetons en entrée, 20 $ en sortie, 0,20 $ en lecture de cache, 5 $ en écriture de cache.

Hypothèse non vérifiée sur la vraie base (la lecture de production n'était pas autorisée) : environ 150 prestations et 120 trajets proposables pour Secret, soit 7 000 à 8 000 jetons de catalogue et de consignes.

| Appel | Entrée | Sortie (réflexion comprise) | Coût |
|---|---|---|---|
| Lire un message, cache froid | 8 000 en écriture de cache, 300 de message | environ 900 | environ 0,06 $ |
| Lire un message, cache chaud (moins de 5 minutes après le précédent) | 8 000 en lecture de cache, 300 | environ 900 | environ 0,02 $ |
| Rédiger une réponse | environ 2 000 | environ 1 300 | environ 0,035 $ |

Pour 10 messages lus et 10 réponses rédigées par jour : environ 1 $ par jour, 25 à 30 $ par mois. Le coût réel se lit dans `assistant_journal` (colonne `cout_estime_usd`).

## Activer l'assistant

1. Jérémy crée une clé sur console.anthropic.com (Settings > API Keys), avec une limite de dépense mensuelle (Settings > Limits), par exemple 50 $.
2. Jérémy la donne à Supabase lui-même, sans la coller dans le chat :
   `supabase secrets set ANTHROPIC_API_KEY=… --project-ref lkxqcmzeidlyssoqmqkh`
3. Claude vérifie la migration 26 en lecture puis l'applique après l'accord de Jérémy.
4. Claude déploie la fonction après l'accord de Jérémy : `supabase functions deploy assistant --project-ref lkxqcmzeidlyssoqmqkh`.
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
