# Assistant IA de Gestion

Préparé le 12.11.2026. Inactif tant que la case « Assistant IA » n'est pas cochée dans Réglages > Écrans de l'entreprise, et tant que la fonction `assistant` n'est pas déployée avec sa clé.

## Ce qui est livré

| Usage | État | Où |
|---|---|---|
| 1. Lire un message libre de client | Prêt, éteint | Bouton « Lire avec l'assistant » dans Coller une demande |
| 2. Rédiger la réponse au client | Retiré le 19.11.2026 (Anaïs écrit ses réponses, décision de Jérémy) : la fonction refuse l'usage, l'écran n'a plus de bouton, la logique pure reste dans `calc.js` | Rien à l'écran |
| 3. Questions d'Anaïs sur ses données | Conception seulement (plus bas) | Rien dans le code |

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

## Données qui partent chez Anthropic

| Usage | Envoyé | Jamais envoyé |
|---|---|---|
| Lire | Le message collé tel quel (il peut contenir nom, téléphone, hôtel, dates, âges des enfants). Le nom de l'entreprise. Les libellés, groupes, modes, horaires de départ et périodes des prestations et trajets, le nom des prestataires. | Prix nets, commissions, marges, coordonnées bancaires, autres clients, dossiers |
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
