# WhatsApp de Nani dans Gestion

Le numéro WhatsApp de Secret Travel & Tour et VIP Taxi Lanta est relié à Telnyx en mode coexistence depuis le 20.11.2026. Il reste dans l'app WhatsApp Business de Nani : elle lit et répond comme avant. Telnyx envoie en plus chaque message à la fonction Supabase `whatsapp`, qui le range dans Gestion.

## Ce qui arrive dans Gestion

| Événement Telnyx | Quand | Où il va |
|---|---|---|
| `message.received` | un client écrit, modifie ou supprime un message | `whatsapp_messages`, sens « entrant » |
| `message.echo` | Nani répond depuis l'app WhatsApp Business | `whatsapp_messages`, sens « sortant », origine « app » |
| `whatsapp.account.update` | compte déconnecté, reconnecté ou retiré | `whatsapp_reglages.etat_compte` |
| `whatsapp.messages` | webhook du compte WhatsApp (WABA), copie de Meta | rattrapage d'un message que le profil n'a pas reçu, ou ligne « non transmis » (migration 100) |

L'historique de 6 mois et les contacts ne sont pas transmis. Telnyx les consomme lui-même et ne les envoie à aucun webhook (doc Telnyx « Coexistence Webhooks », section des événements internes). Aucune API Telnyx ne permet de les relire. Gestion commence donc au premier message reçu après le branchement.

Les messages envoyés depuis l'app restent gratuits. `message.echo` n'arrive que si le numéro est rattaché à un profil de messagerie dont le webhook pointe vers la fonction.

## Fonction `whatsapp`

- Adresse : `https://lkxqcmzeidlyssoqmqkh.supabase.co/functions/v1/whatsapp`, sans JWT (`supabase/config.toml`).
- Chaque appel est vérifié : signature Ed25519 de Telnyx (en-têtes `telnyx-signature-ed25519` et `telnyx-timestamp`, message signé `horodatage|corps brut`), horodatage de moins de 5 minutes, 1 Mo au plus. Sinon 401.
- L'événement brut est écrit une fois dans `whatsapp_evenements` (clé = `data.id`), puis la fonction répond 200 tout de suite. Le rangement du message et la copie des médias se font ensuite. Un traitement raté reste « à traiter » et se reprend à l'appel suivant et toutes les 5 minutes par le cron `whatsapp-reprise` (5 essais, comptés dès la réservation). Voir « Fiabilité » plus bas.
- Médias : copiés dans le stockage privé `whatsapp` dès réception (20 Mo au plus par fichier), parce que les liens expirent. Si Telnyx ne donne qu'un id Meta, la fonction passe par `GET /v2/whatsapp/media/{numéro}/{id}` avec `TELNYX_API_KEY`. La clé ne part jamais vers une autre machine que `*.telnyx.com`.
- Interrupteur : `whatsapp_reglages.reception_active`. Éteint, la fonction répond 200 sans rien écrire.
- Secrets : `TELNYX_PUBLIC_KEY` (obligatoire), `TELNYX_API_KEY` (médias sans lien direct, puis envoi depuis Gestion), `WHATSAPP_ORGANISATION` (Zwald par défaut).

## Droits

- Lecture des conversations, messages et médias : administrateurs de Secret et de VIP Taxi Lanta seulement (droit « reglages.ecrire » sur toute l'entreprise). Une conversation à trier se lit par un administrateur de l'une des deux. Mook ne voit rien.
- Personne n'écrit un message depuis l'outil. Les événements bruts ne se lisent qu'avec la clé de service.
- Client reconnu par son numéro (chiffres seuls, ou les 9 derniers pour un numéro noté « 081 … ») dans Secret ou Taxi : la conversation est rangée dans son entreprise et reliée à son dernier dossier. Sinon elle reste à trier.

## Conservation

| Donnée | Durée |
|---|---|
| Événements bruts | 30 jours |
| Photos, vocaux, documents | 90 jours (le message garde son type et sa légende) |
| Messages et conversations | 365 jours après le dernier message |
| Message supprimé par le client | texte et médias effacés tout de suite |

La purge tourne dans la fonction, au plus une fois par heure. Aucun message ne sert à entraîner un modèle. L'IA ne reçoit jamais de coordonnées bancaires (numéros de compte et IBAN masqués), ni de net ou de commission lus dans les tables de Gestion. Depuis la migration 69, un net ou une commission écrits dans un message par un partenaire, un chauffeur ou un hôtel partent avec le texte de sa conversation.

## Boîte WhatsApp (phase 2, migration 59)

Écran « WhatsApp » de Gestion, visible des administrateurs de Secret et Taxi.

- **Un seul numéro, deux entreprises.** Un client connu par son numéro range la conversation dans son entreprise. Sinon elle reste à trier : l'agent suggère Secret ou Taxi (un appel court à Claude Haiku : une course ou un transfert, c'est Taxi ; une excursion ou un séjour, c'est Secret) sans jamais la ranger lui-même, et Nani décide d'un tap. La réponse est alors préparée avec les données de l'entreprise suggérée et seuls ses administrateurs la voient. Changer d'entreprise remplace la réponse préparée pour l'autre, retire le client et le dossier de l'autre, puis cherche le client par le numéro dans la nouvelle.
- **Réponses sur demande (Jérémy, 20.11.2026, pour économiser les crédits).** L'assistant lit et trie chaque message, mais ne rédige rien tant que Nani ne touche pas « Préparer une réponse » (ou une action comme Créer le dossier). Le réglage « Préparer les réponses WhatsApp automatiquement » (Réglages > Écrans > Assistant IA, `reglages.whatsapp_reponses_auto`, par entreprise) est décoché par défaut ; coché, la préparation décrite ci-dessous repart. Mesuré sur 24 h le 20.11.2026 : environ 0,064 $ par réponse préparée, contre 0,0002 $ pour un tri. Ce qui reste automatique, avec son coût par appel estimé (Claude Haiku 5.5, 0,10 $ et 0,50 $ par million de jetons) : le tri (environ 0,0002 $, mesuré), le résumé de la conversation après une rafale d'au moins 4 messages (60 messages lus au plus, 400 jetons écrits au plus : moins de 0,001 $), la tâche d'une promesse de Nani (seulement si son message ressemble à une promesse : environ 0,0002 $) et le signal de paiement (sans IA, gratuit).
- **Réponse préparée** (au clic de Nani, ou seule si le réglage est coché). 8 secondes après le dernier message du client (il écrit souvent en plusieurs fois), la fonction `whatsapp` lance l'agent de l'onglet Assistant avec ses consignes, ses règles de réponse (PR 280), ses apprentissages et seulement ces outils : catalogue, horaires, durées, planification d'une course, lecture du dossier relié et `proposer_reponse`. L'agent ne cherche jamais un client et ne lit aucun autre dossier que celui relié à la conversation (ou un dossier de son client relié) : un inconnu qui cite une référence ne fait rien lire. Un outil hors de cette liste est refusé même si le modèle l'appelle. Mêmes contrôles que dans l'Assistant : prix et heures seulement des outils, aucune signature chez Secret et Taxi, anglais sauf client francophone. Rien pour une réaction, un emoji seul ou un merci.
- **Garde-fou des chiffres internes (PR 278).** L'agent n'a ici aucun droit : ni partenaire, ni net, ni commission ne lui sont donnés. La fonction compare quand même la réponse aux nets de l'entreprise et aux noms des partenaires ; tant que le texte en contient un, l'écran bloque la copie et l'envoi, et `whatsapp-envoi` refuse (`contenu_interne`).
- **Aucune notification sur le téléphone** (Jérémy, 20.11.2026 : Nani serait débordée). Ni « réponse prête », ni « nouveau message » : le compteur de non-lus de l'écran WhatsApp de Gestion suffit, et l'app WhatsApp de Nani sonne déjà pour chaque message. Les autres notifications de Gestion (rappels, demandes du site, crédit) ne changent pas.
- **Copier puis répondre depuis l'app.** Gros bouton « Copier », lien qui ouvre la conversation dans WhatsApp. Dès que Nani répond depuis l'app (`message.echo`), la proposition passe « traitée ». Une réponse devenue inutile pendant la préparation (le client a réécrit, Nani a déjà répondu) n'est ni proposée ni annoncée.
- **Envoi depuis Gestion** (secondaire) : fonction `whatsapp-envoi`, session de la personne, dans les 24 h qui suivent le dernier message du client (règle de Meta), numéro `active` chez Telnyx et `TELNYX_API_KEY` posée. Verrou contre le double envoi : la proposition passe « envoi » avant l'appel à Telnyx ; un délai dépassé répond `verifier_whatsapp` (le message est peut-être parti) et rien ne repart sans vérification.
- **Coût et limites.** Chaque préparation compte dans le plafond du mois de l'assistant (`assistant_journal`, usage « whatsapp », coût noté à chaque tour). En plus : 15 $ par mois au plus pour la boîte (`WHATSAPP_PLAFOND_MOIS_USD`), 6 réponses par conversation et 80 pour toute la boîte sur 24 h, 75 secondes par préparation. Une lecture du budget impossible ferme la préparation. Agent éteint (`agent_ia`) : pas de réponse.
- **Ce qui part chez Anthropic** : le texte des 30 derniers messages de la conversation (ceux du contact et de Nani), les numéros de téléphone, de compte et les IBAN masqués ; le prénom du client ; le dossier relié (services, dates, heures, prix de vente, prénom) ; ce que rendent le catalogue, les horaires et les durées. Jamais un numéro de téléphone, un nom de famille, ni un net, une commission ou un nom de partenaire lus dans les tables. Depuis la migration 69, la conversation d'un partenaire, d'un chauffeur ou d'un hôtel part comme celle d'un client : ce qu'il écrit (un net, une commission, un nom) peut y figurer. La réponse préparée reste bloquée tant qu'elle contient un net de l'entreprise ou un nom de partenaire. L'API Anthropic n'entraîne pas ses modèles sur ces données.
- **Conservation** : une proposition part avec sa conversation, au plus tard 90 jours après sa création. Une préparation interrompue passe « échec » après 3 minutes.

## Tri des messages et classement protégé (migration 60)

Demande de Jérémy du 20.11.2026 : ne jamais toucher à ce que Nani a classé, et ne pas préparer de réponse à tous les messages.

- **Classement protégé.** La fonction ne change jamais l'entreprise, le client, le dossier ni l'interrupteur d'une conversation déjà posés : le déclencheur `whatsapp_proteger_classement` remet l'ancienne valeur. Une conversation rangée à la main reste rangée. Seule Nani change son classement depuis l'outil. Les étiquettes de l'app WhatsApp Business ne passent pas par Gestion (Meta ne les transmet pas en coexistence) : Gestion ne les lit ni ne les modifie.
- **Interrupteur par contact** (`reponses`) : « Automatiques » (« Sur demande » tant que la préparation automatique est décochée) ou « Jamais pour ce contact », le Contact personnel (ami, famille : ni tri par Claude, ni résumé, ni promesse, ni lecture par l'Assistant, ni « Préparer une réponse » : le bouton est masqué et `whatsapp-preparer` répond `contact_personnel`, revue de sécurité de la PR 299). Depuis la migration 69, un partenaire, un chauffeur ou un hôtel n'est plus mis sur « jamais » par son type.
- **Tri, du moins cher au plus cher.** Une réponse n'est préparée seule que si le réglage automatique est coché et que tout passe :
  1. le contact n'est pas réglé sur « jamais » (Contact personnel) ;
  2. le message n'est pas une réaction, un emoji seul, un « ok », un merci, ni une photo ou un vocal sans texte (aucun appel à Claude) ;
  3. le budget et les limites du jour le permettent ;
  4. Claude Haiku lit les derniers messages et répond en JSON : préparer ou non, motif, entreprise suggérée. Il faut à la fois « oui » et un motif de demande (`demande_client` ou `suivi_reservation`) ; dans le doute, non.

  Jusqu'à la migration 69, le numéro d'une fiche partenaire arrêtait le tri avant Haiku (motif « partenaire »). Ce n'est plus le cas : Haiku lit la conversation d'un partenaire comme celle d'un client et peut encore répondre « partenaire » quand le message n'attend pas de réponse préparée. Le motif reste affiché pour les anciennes lignes.
- **Décision visible.** Le motif est gardé sur la conversation (`tri`) et affiché dans l'écran à côté du bouton, sans ton d'anomalie (« Demande de client », « Message personnel »…). Un bouton « Préparer une réponse » (fonction `whatsapp-preparer`) prépare quand même, dans les mêmes limites, sauf pour un Contact personnel.

## Le ton de Nani (20.11.2026)

Demande de Jérémy : les réponses préparées doivent avoir le ton de Nani, appris de ce qu'elle écrit dans chaque situation (`whatsapp/ton.js`).

- À chaque réponse préparée, l'agent reçoit jusqu'à 8 de ses vraies réponses envoyées depuis l'app, avec le message du client juste avant, dans les conversations de la même entreprise. Les situations proches du message en cours passent d'abord, puis les plus récentes.
- Il reçoit aussi jusqu'à 5 de ses réécritures : la réponse préparée par l'agent, puis ce que Nani a vraiment envoyé à la place (dans les 6 heures, assez différent). Plus elle corrige, plus les réponses se rapprochent des siennes.
- Ces exemples servent au ton, à la longueur, aux formules et aux emoji. Les faits (prix, heures, disponibilités) viennent toujours des outils. Numéros et IBAN masqués ; un exemple qui parle de net, de commission ou de compte bancaire est écarté. Un Contact personnel ne sert jamais d'exemple (revue de sécurité de la PR 299).

## Fiabilité (migration 64, lot 3 des audits du 20.11.2026)

- **Envoi depuis Gestion.** `whatsapp-envoi` range le message avant d'appeler Telnyx (`statut_envoi = 'envoi'`), puis le complète avec l'id Telnyx (`envoye`). Un refus sûr de Telnyx (4xx) retire le message du fil et rend la réponse préparée. Un délai dépassé, une coupure, un 5xx ou une réponse illisible laissent le message dans le fil : après 30 secondes, la carte « Vérifiez dans WhatsApp » propose « C'est parti » (le message reste, la réponse est soldée) ou « Pas parti » (le message sort du fil, la réponse revient). Après 5 minutes sans confirmation, la reprise le passe en échec visible (`erreur_envoi = 'sans_confirmation'`). La confirmation passe par `whatsapp_confirmer_envoi`, réservée à qui peut écrire dans la conversation.
- **Statuts d'envoi.** Telnyx envoie `message.sent`, `message.finalized` (état `delivered`, ou un échec avec `errors[]`) et `message.read` pour un message envoyé par l'API. L'envoi passe `webhook_url` = la fonction `whatsapp` : aucun réglage du portail n'est nécessaire. Le statut s'écrit sur le message par son id Telnyx, sans jamais revenir en arrière (`remis` puis un `sent` en retard ne change rien). L'écran l'affiche à la suite de l'heure : envoyé, remis, lu, ou non remis avec la raison de Meta en clair (24 h dépassées, numéro sans WhatsApp…). Un statut arrivé avant que l'id soit noté est repris 30 minutes, puis classé.
- **Reprise.** Le cron `whatsapp-reprise` (toutes les 5 minutes, posé par `cron-whatsapp-reprise.sql`) appelle la fonction avec `{ "mode": "reprise" }` et le jeton de `rappels`. Elle reprend jusqu'à 25 événements en attente, passe en échec les envois sans confirmation et purge au plus une fois par heure. `whatsapp_reserver_evenement` compte l'essai dès la réservation : une instance tuée en route compte aussi.
- **Modification ou suppression par le client.** Si le message d'origine n'est pas encore rangé (en erreur, repris plus tard), l'événement est repris lui aussi pendant 30 minutes au lieu d'être clos sans rien toucher.
- **Doublon.** Un événement ne range qu'un message (index unique sur `evenement_id`), même sans id Telnyx ni Meta.
- **Réglages > WhatsApp, ligne « Réception ».** `whatsapp_etat_reception()` (administrateurs de Secret ou de Taxi, lecture seule) : messages en erreur (repris toutes les 5 minutes), abandonnés après 5 essais (bouton « Relancer », `whatsapp_relancer_evenements`), en attente depuis plus de 10 minutes (cron arrêté ?), envois à vérifier.
- **Conservation.** Un événement jamais rangé reste 90 jours au lieu de 30, pour pouvoir être relancé.

## L'Assistant lit la boîte (migration 67, 21.11.2026)

Dans l'onglet Assistant de Secret ou de Taxi, l'agent a trois outils de lecture (`agent/whatsapp-lecture.js`), sans aucun appel à l'IA en plus :

| Outil | Ce qu'il rend |
|---|---|
| `chercher_conversations` | 20 conversations au plus : par nom, client ou dossier relié, numéro, période, non-lus, client qui attend ; recherche plein texte dans les messages (`whatsapp_rechercher`, mots et préfixes, configuration « simple ») |
| `lire_conversation` | les messages dans l'ordre (40 par défaut, 200 au plus, 20 000 caractères), « depuis » un jour ou « avant » un jour, le reste compté ; médias décrits par leur type et leur légende |
| `a_faire_whatsapp` | clients qui attendent (durée), promesses de Nani échues, paiements signalés pas encore notés, trajets en ferry ou en speedboat d'un dossier relié pas encore payés, trié par urgence |

- **Droits.** Les outils ne sont proposés et exécutés que pour qui administre l'entreprise active, Secret ou Taxi (`whatsapp_admin`). Tout se lit avec la session de la personne, jamais avec la clé de service. ZTP et Mook ne les voient pas. La préparation automatique des réponses ne les reçoit jamais.
- **Contact personnel.** Un contact réglé « jamais » n'est ni cherché ni lu : rien de lui ne part chez Anthropic. Partenaire, chauffeur, hôtel et apporteur se lisent comme un client depuis la migration 69 (avant, la conversation d'un numéro de fiche partenaire était écartée). Les résultats de ces outils ne repartent pas au message suivant : l'agent relit, sous les règles du moment.
- **Recherche.** Préfixe dès 3 lettres, chiffres cherchés sur les 90 derniers jours, 3 secondes au plus. La base rend le texte entier : l'agent masque d'abord, coupe ensuite.
- **Promesses.** `taches.whatsapp_conversation_id` relie la tâche à sa conversation ; une promesse sans conversation retrouvée n'est jamais envoyée.
- **Citations.** Chaque conversation et chaque message rendu porte son lien `#/whatsapp?c=…&m=…&entite=…`. L'agent cite ses sources avec ces liens, une ligne par point ; l'écran de l'Assistant les rend cliquables.
- **Contenu non fiable.** Le texte des messages est masqué (numéros, comptes, IBAN), neutralisé (crochets, chevrons) et traité comme une donnée. Il n'est jamais une source de prix ni d'heure pour une réponse au client.
- **Ce qui part chez Anthropic** : le nom de profil, le client relié (prénom, nom), la référence du dossier relié, le texte des messages lus et des extraits (un prix écrit par le client, ou un net et une commission écrits par un partenaire, peuvent y figurer), le type et la légende des médias, le titre des promesses échues, le libellé et la date des trajets en bateau, le solde dû. Jamais un numéro de téléphone, un fichier, ni un net, une commission ou une fiche partenaire lus dans les tables. Les pièces jointes ne partent que cochées par la personne (« Créer le dossier »).

## Tous les contacts lus par l'IA (migration 69, 21.11.2026)

Demande de Jérémy : « enlève moi cette règle que les trucs ne sont pas envoyés à l'IA si ce n'est pas un client ».

- **Plus de coupure par type.** Partenaire, chauffeur, hôtel et apporteur se lisent comme un client : outils de l'Assistant (`chercher_conversations`, `lire_conversation`, `a_faire_whatsapp`), tri, résumé et promesse du suivi, « Préparer une réponse », « Demander à l'assistant ».
- **Plus de coupure par numéro.** Le numéro d'une fiche partenaire n'écarte plus une conversation (`numerosPartenaires`, `partenairesDe` et `numerosAExclure` retirés des fonctions). La fonction SQL `whatsapp_partenaires_parmi` (migration 67) ne sert plus : elle reste en base sans appel ; la 69 ne la supprime pas.
- **Le type ne touche plus les réponses.** Taper Partenaire, Chauffeur, Hôtel, Client ou Apporteur dans l'écran WhatsApp écrit seulement `type_contact`. Seule la puce « Personnel » ferme l'IA (`reponses = 'jamais'`, type vide) ; la quitter pour un type la rouvre. Un contact typé que Nani règle « rien envoyé à l'IA » dans le menu « … » le reste.
- **Données.** La migration 69 repasse à « auto » les conversations typées partenaire, chauffeur ou hôtel restées sur « jamais » par l'ancien couplage de l'écran. Un contact sans type (Personnel), un client et un apporteur ne changent pas.
- **Ce qui ne change pas.** Le Contact personnel est respecté partout (tri, suivi, outils de l'agent, `whatsapp_rechercher`, « Demander à l'assistant »). Le contrôle bloquant des réponses (`controlerReponse`, `nom_prestataire`, `montant_interne`, `contenu_interne` de `whatsapp-envoi`) reste : aucun net, aucune commission, aucune marge, aucun nom de partenaire ni d'apporteur ne part vers un client, sauf la réponse à l'apporteur lui-même (PR 298). Numéros, comptes et IBAN restent masqués. Les nets ne se lisent dans les tables qu'avec `partenaires.nets` ; Mook ne voit rien de nouveau ; ZTP reste à part.
- **Ce qui part en plus chez Anthropic** : le texte des conversations des partenaires, chauffeurs et hôtels (masqué), dans les mêmes limites qu'un client. Un net, une commission ou un nom de partenaire écrits dans ces messages peuvent donc partir avec le texte.

### Revue de sécurité de la PR 299

Lire un partenaire ne doit jamais faire passer ce qu'il écrit dans une réponse au client.

| Point | Règle |
|---|---|
| Montants « tapés » | Un bloc `<conversation>` joint n'est jamais compté comme tapé par la personne (`memoDepuis`, `sansConversation`). Seuls son texte et sa `<question>` comptent. |
| Montants d'un partenaire | Les montants d'une conversation partenaire, chauffeur ou hôtel jointe, liée ou lue par un outil (`retenirLecture`, `retenirLectures` pour l'historique) vont dans `memo.internes` : `montant_interne` bloquant, sauf égal à un prix de vente rendu par un outil. Les lectures renvoient le champ `contact` (type du contact). |
| Nets dans l'Assistant | La fonction « agent » lit les nets de l'entreprise (des deux en espace unifié) avec la clé de service (`netsPourControle`, comme la boîte). Ils ne servent qu'au contrôle : jamais dans les consignes, les messages, un résultat d'outil ni le flux vers l'écran. |
| Noms | Le nom d'une conversation typée partenaire, chauffeur, hôtel ou apporteur lue ou jointe est bloqué comme un nom de partenaire. `whatsapp-envoi` et la réponse préparée bloquent les noms de toutes les conversations typées de l'organisation (`nomsContactsTypes`). Chaque nom se compare aussi sans « co, ltd, company, tour, travel » (« Blue Ocean » cite « Blue Ocean Co., Ltd »). L'exemption de la PR 298 reste limitée à la réponse à l'apporteur lui-même. |
| Ton de Nani | Un Contact personnel ne sert jamais d'exemple (`tonDeNani`). |
| « Préparer une réponse » | Refusé pour un Contact personnel (`contact_personnel`, 403), bouton masqué. |
| Réponse à un partenaire | Ni client ni dossier relié, consigne « destinataire partenaire : jamais un prix de vente, un total, un solde ni une marge du client ». Jamais préparée seule, même avec la case cochée : sur demande seulement. |
| Promesses | La tâche d'une promesse faite à un partenaire, un chauffeur ou un hôtel ne garde aucun chiffre dans ce qui est promis (`sansChiffres`). |
| Historique de l'Assistant | Si la conversation WhatsApp liée passe « Contact personnel », l'échange joint plus tôt est retiré au chargement (`retirerConversationsJointes`). |

## Nom du contact saisi à la main (migration 70, 21.11.2026)

Constaté en production : aucune des 25 conversations n'avait de nom. Telnyx n'envoie dans `message.received` que `from.phone_number`, `carrier` et `line_type`. Demande de Jérémy : « Oui faisons le nom à la main ».

- **Écran.** Dans l'en-tête d'une conversation, un tap sur le nom (ou le petit crayon) ouvre un champ sur place ; Entrée ou OK enregistre, Échap ou la croix annule. 60 caractères au plus, espaces nettoyés. Vider le champ efface le nom saisi. En lecture seule (conversation de l'autre entreprise), ni bouton ni crayon. Sans la migration 70, le crayon n'apparaît pas.
- **Ordre du nom, partout** (liste, « À faire », palette, Assistant, citations, outils de l'agent) : le nom saisi à la main, sinon le client relié, sinon le nom de profil WhatsApp, sinon le numéro (l'écran seulement : les outils de l'agent n'envoient jamais le numéro). Une seule fonction : `nomContact` (`agent-whatsapp-lecture.mjs`), reprise par `nomConversation` (`whatsapp-calc.mjs`).
- **Droits.** `grant update (nom)`, sous la politique « ranger une conversation WhatsApp » (migration 63, `whatsapp_ecrit`) : un administrateur de l'entreprise de la conversation, ou d'une des deux pour une conversation à trier. Mook ne voit rien. `nom_source` ne s'écrit jamais depuis l'outil.
- **Protection.** `whatsapp_nom_manuel` met `nom_source = 'manuel'` quand une personne écrit le nom (nettoyé en base) ; `whatsapp_proteger_classement` fait que, sans personne connectée (la fonction « whatsapp »), un nom manuel ne change jamais. Un nom vide ou de profil se remplit encore si Telnyx en envoie un jour un (`nom_source = 'whatsapp'`, aussi à la création par `whatsapp_nom_insertion`).
- **Recherche.** `whatsapp_rechercher` trouve aussi une conversation par son nom (mots et préfixes) et rend son dernier message : la palette la montre. L'outil `chercher_conversations` la trouve par `nom` comme avant. Un contact personnel n'est jamais trouvé.
- **Ce qui part chez Anthropic** : le nom saisi, comme le reste de la conversation, sauf pour un contact personnel. C'est une donnée : masqué (numéros) et neutralisé (crochets, chevrons). Les outils disent `nom_saisi_par_equipe`, « Demander à l'assistant » dit « nom noté par l'équipe ». Pour une réponse préparée, seul le premier mot d'un nom saisi part (« Somchai chauffeur » donne « Somchai »), avec le libellé « nom noté par l'équipe ».

### Revue de sécurité de la PR 300

| Point | Règle |
|---|---|
| Préparation de la boîte | `whatsapp/reponse.ts` lit `nom_source` (`select *`, sans erreur si la colonne manque). Nom manuel : premier mot seulement (`prenomDuContact`, `whatsapp/proposer.js`). Contact personnel : rien, la préparation est refusée (PR 299). |
| Nom d'un contact typé | Le nom manuel d'une conversation typée partenaire, chauffeur, hôtel ou apporteur, ou reliée à une fiche (`partenaire_id`), est bloqué vers un client : Assistant (`memo.prestataires`, champ `fiche_reliee` des lectures, conversation jointe), préparation et `whatsapp-envoi` (`nomsContactsTypes`). Seul l'apporteur à qui l'on répond garde le sien (PR 298). |
| Caractères invisibles | U+200B à U+200F, U+202A à U+202E, U+2060 à U+2069 et U+FEFF retirés en base (`whatsapp_nom_manuel`) et à l'écran (`nettoyerNom`). Un nom vide après nettoyage est effacé. |
| Recherche par nom | `par_nom` : n conversations au plus, les plus récentes, et leur dernier message par `join lateral … limit 1`. |
| Nom retapé | Dès que `nom` figure dans l'UPDATE d'une personne, il devient manuel, même identique (déclencheur « before update of nom »). |
| Fonctions de déclencheur | `execute` retiré à public, anon et authenticated. |

- **Fonctions à redéployer** : `agent`, `whatsapp` et `whatsapp-envoi`. Contrôle : `verif-whatsapp-nom.mjs`. Retour : `retour-70-whatsapp-nom.sql` (les noms saisis restent dans `nom`, sans leur source).

## Voucher envoyé dans la conversation du client (migration 73, 21.11.2026)

Demande de Jérémy : l'image du voucher part par Telnyx dans la conversation WhatsApp du client, depuis Gestion. Nani la voit aussi sur son téléphone (coexistence). L'envoi habituel depuis le téléphone reste.

- **Écran.** « Envoyer dans la conversation WhatsApp » dans la fenêtre d'envoi du voucher et sur la carte voucher de l'Assistant, seulement si la conversation du client existe (`conversationDuVoucher`, `whatsapp-voucher-calc.mjs`) : reliée au dossier ou à son client, de type client ou pas encore typée, jamais un contact personnel ni un prestataire, dans une entreprise que la personne administre. Rien ne part sans la confirmation : nom, numéro masqué en partie, image, message sous l'image modifiable (1024 octets au plus), état de la fenêtre de 24 h.
- **Fonction.** `whatsapp-envoi`, en multipart (`voucher.js`), plutôt qu'une nouvelle fonction : même session, mêmes droits, même `contenuInterne`, même verrou et même résultat incertain que le texte, un seul déploiement. Ordre : conversation et `whatsapp_peut_ecrire`, réservation et dossier lus avec la session, `whatsapp_admin` de l'entreprise de la réservation (ni ZTP ni Mook), contact du client, fenêtre vue par la base, légende contrôlée, coexistence lue chez Telnyx (`coexistence_state`, cache de 3 minutes, seul `active` envoie), fenêtre relue chez Telnyx (`conversation_window`, en cas de doute rien ne part), verrou en base (`whatsapp_ranger_voucher`, voir la revue ci-dessous).
- **Image.** Le navigateur l'envoie avec la demande ; la fonction la dépose dans le bucket privé `whatsapp-sortant` seulement après tous les contrôles (aucune politique de stockage : personne n'y lit ni n'y écrit depuis l'outil). URL signée de 15 minutes avec `?v=` contre le cache de Meta, puis l'appel. Le fichier est effacé tout de suite sur un refus sûr, sinon au statut « remis », « lu » ou « échec » (fonction `whatsapp`), et au plus tard par la purge de la fonction `whatsapp` une heure après le dépôt (à chaque passage de la reprise, toutes les 5 minutes). Pas d'effacement juste après le 200 : Telnyx ne dit pas quand il télécharge le lien.
- **Fil.** Le message est rangé avant l'appel (`whatsapp_ranger`, origine « gestion », type image, légende en texte), avec un média `{ statut: "voucher", chemin_sortant }` affiché « Voucher envoyé depuis Gestion (image non gardée) ». Un résultat inconnu suit le chemin du texte : « C'est parti » ou « Pas parti » après 30 secondes. Un envoi réussi est noté dans le dossier comme un partage.
- **Démo.** Simulé, sans réseau : un message image apparaît dans le fil.

### Revue de sécurité de la PR 304

| Point | Règle |
|---|---|
| Envoi incertain | `whatsapp_ranger_voucher` (migration 73) refuse le voucher d'une réservation tant qu'un envoi précédent dans la conversation est « envoi », ou « echec » avec `sans_confirmation`, sans limite de durée. Seuls « C'est parti » et « Pas parti » lèvent ce verrou. L'écran dit alors « un envoi précédent est à vérifier dans WhatsApp ». |
| Clé du verrou | `gestion-voucher:<réservation>:<id>`, l'id étant créé à l'ouverture de la confirmation. Contrôle et rangement d'un seul tenant, sous `for update` de la conversation : de deux demandes simultanées, la seconde voit le message de la première. Clé de service seulement. |
| Entreprise | La conversation est rangée dans l'entreprise de la réservation, ou à trier. La légende est contrôlée dans cette entreprise, ou dans Secret et Taxi ensemble pour une conversation à trier (fermé si la liste ne se lit pas). |
| Image | Type et dimensions lus dans l'en-tête (IHDR, SOF, VP8, VP8L, VP8X), 4096 px au plus par côté, aucun octet après IEND pour un PNG. |
| Corps | Session vérifiée (`getUser`) avant toute lecture du corps, lu ensuite en flux, 6 Mo au plus. Toute exception avant le rangement rend `base` en JSON. |
| Téléphone | Le numéro de la conversation est comparé à celui de la fiche client en E.164. S'ils diffèrent (ou si la fiche n'a pas d'indicatif), la confirmation montre le numéro complet avec un avertissement et une case à cocher ; la fonction exige `numero_confirme` égal au numéro de la conversation. |
| Organisation | Aucun dépôt pour une autre organisation que `WHATSAPP_ORGANISATION`, la seule que la purge parcourt. |
| Chemins | Seul un chemin `<organisation>/<horodatage>-<uuid>.<png, jpg ou webp>` est jamais effacé. Fenêtre de Telnyx : `window_expires_at` exigé dans le futur. |
| Migration | Une politique de `storage.objects` sans `bucket_id` arrête la migration. Le retour dit de supprimer le bucket depuis le tableau de bord si `storage.protect_delete` refuse. |

- **Risque accepté : l'image n'est pas liée au voucher.** La fonction vérifie que la personne peut envoyer le voucher de cette réservation dans la conversation de ce client, mais pas que l'image reçue est bien ce voucher. Une personne qui a ces droits (administratrice de Secret ou de Taxi) pourrait envoyer une autre image au client par ce bouton. Elle le peut déjà depuis l'app de son téléphone ; la légende reste contrôlée.
- **Fonctions à redéployer** : `whatsapp-envoi` et `whatsapp`. Contrôle : `verif-whatsapp-voucher.mjs`. Retour : `retour-73-whatsapp-voucher.sql`.

## Messages de clients non transmis (migration 100, 22.11.2026)

Constat du 22.11 : des messages de clients visibles dans l'app de Nani n'arrivent jamais à la fonction, sans aucune tentative dans le journal « Webhook Deliveries » de Telnyx. Causes probables selon la doc Meta : erreur 131060 en coexistence (message indisponible, typique du premier message d'un client) qui ne donne qu'un webhook `unsupported` sans texte, ou un appareil compagnon que Meta ne relaie pas (Telnyx : « best-effort conversation visibility, not a complete message archive »). Il n'existe pas d'API d'historique : Gestion récupère ce que Meta envoie encore et signale le reste.

- **Webhook du compte WhatsApp.** Branché le 22.11 vers 02:50 UTC sur la même fonction, événements « Messages » et « Account Updates ». Au 22.11, Telnyx n'y a fait aucune tentative d'envoi (compte affiché « Inactive » dans le portail) : ce canal est prêt mais muet. Telnyx y relaierait les messages sous `whatsapp.messages`, forme non documentée : `manquants.js` cherche l'objet `value` de Meta dans l'enveloppe Telnyx, et `calc.js` (`enveloppeMeta`) accepte aussi le corps Meta relayé tel quel (id `meta-<empreinte du corps>`). Une enveloppe inconnue est refusée (400), avec ses seules clés de premier niveau dans les journaux de la fonction.
  - Seulement pour le numéro de Nani (`whatsapp_reglages.numero`, `metadata.display_phone_number` ou destinataire) : un autre numéro du compte, un numéro inconnu, ou un expéditeur égal au numéro de Nani : rien. Ce canal ne réécrit jamais `whatsapp_reglages.numero`, que `whatsapp-envoi` utilise comme expéditeur.
  - Même wamid déjà reçu par `message.received` : rien. Une ligne « non transmis » du même wamid ne bloque pas : le vrai message la remplace.
  - Message reçu seulement ici : rattrapage, rangé comme un message normal. Il attend 2 minutes que `message.received` arrive le premier (cet essai ne compte pas) : l'id Telnyx sert aux modifications et suppressions. S'il arrive après le rattrapage, `whatsapp_ranger` note son id Telnyx.
  - Modification ou suppression : appliquée comme par `message.received`, jamais rangée comme un nouveau message.
  - Statuts d'envoi : ignorés (déjà reçus par `message.finalized`).
  - Contact du message : celui dont le BSUID ou le numéro est celui de l'expéditeur, ou le seul de la liste s'il ne porte pas un autre numéro.
- **Ligne « non transmis ».** Un `unsupported`, ou l'erreur 131060 ou 131051, par l'un ou l'autre webhook, range une ligne sans texte (type `non_transmis`). L'écran l'écrit : « Message du client non transmis par WhatsApp, {heure}. Ouvre WhatsApp sur le téléphone pour le lire. » Elle compte un non-lu et apparaît dans la liste (« Message non transmis »). Elle n'est lue ni par le tri, ni par la réponse préparée, ni par le suivi, ni par l'Assistant (filtre `type <> 'non_transmis'` à chaque lecture, et pas de texte pour la recherche). Si le vrai message arrive ensuite avec le même wamid, il la remplace.
- **Client sans numéro.** Meta omet le numéro d'un client qui a un nom d'utilisateur et n'a pas écrit depuis 30 jours ; le BSUID (`from_user_id`, `to_user_id` pour un écho, forme `CH.1234…`) est toujours là. La conversation garde son BSUID (`whatsapp_conversations.bsuid`), le numéro devient facultatif, et elle est retrouvée par lui quand le numéro manque.
  - Pas d'IA (ni tri, ni réponse, ni suivi) pour une conversation sans numéro tant que Nani ne l'a pas typée.
  - Son numéro arrive : la conversation sans numéro est rattachée à celle du numéro (`whatsapp_rattacher` : messages, propositions, tâches, conversations de l'Assistant). Un Contact personnel connu par son numéro le reste. Une conversation sans numéro que Nani a réglée « Contact personnel » ne se fond pas dans une conversation ouverte à l'IA : seulement le signal ci-dessous.
  - Même BSUID depuis un autre numéro : le numéro n'est jamais changé. Le nouveau numéro a sa conversation, qui porte `meme_client_que` : « Nouveau numéro pour ce client », avec le lien vers l'ancienne.
  - Un envoi depuis Gestion vers une conversation sans numéro est refusé par `whatsapp_ranger` avant tout appel à Telnyx. Tant que la migration 100 manque, un message sans numéro attend (sans consommer d'essai) au lieu d'être envoyé à l'ancienne `whatsapp_ranger`.
- **Repérage sans webhook.** Sur une réponse de Nani depuis l'app, pour un client seulement (jamais un partenaire, un chauffeur, un hôtel, un apporteur, une fiche partenaire, un Contact personnel ; jamais une réaction) :
  - le message d'avant était déjà à elle, date de plus de 6 heures, et sa réponse ressemble à une réponse (prix, oui ou non, confirmation, disponibilité, heure, « how can I help ») et pas à une relance ni à un message commercial ;
  - ou c'est le premier message connu de la conversation et c'est une vraie réponse (oui ou non, prix, « how can I help ») : le client a écrit avant, Gestion ne l'a pas. Une confirmation envoyée d'office, un remerciement après le séjour, une proposition ou une question à un prestataire ne posent rien ;
  - ou elle cite un id Telnyx (passé par Telnyx, donc depuis le 20.11) que Gestion n'a pas. Un wamid cité ne se date pas : aucun repère. Les envois depuis Gestion reçoivent leur wamid avec leur statut.
  - Repère « Un message du client semble manquer » sur la réponse (`whatsapp_messages.repere`) et sur la carte (`whatsapp_conversations.manque_le`). Un message du client, même arrivé en retard, efface celui de la carte, et celui des réponses de Nani qu'il précède. Aucune IA, aucune notification.
  - Mesure sur les 300 réponses de Nani du 20 au 22.11 (lecture seule) : 3 repères, les 3 pertes réelles connues (une réponse avec un prix après plus de 6 heures, deux premiers messages qui répondent), aucun faux. Les 17 autres conversations ouvertes par Nani (relances, remerciements, propositions, confirmations d'office, questions à des prestataires, médias) n'en ont pas. La première version (6 heures seulement) donnait 6 repères, dont 5 faux, et manquait deux des pertes.
- **Fonction à redéployer** : `whatsapp` (et `agent`, pour le filtre de l'Assistant). Contrôle : `verif-whatsapp-manquants.mjs`. Retour : `retour-100-whatsapp-manquants.sql`.

## Étapes de Jérémy (une seule fois)

### 1. Clé publique de signature

Portail Telnyx, Keys & Credentials, Public Key (`https://portal.telnyx.com/#/api-keys/public-key`). Copier la clé, puis dans le Terminal :

```bash
k="$(pbpaste | tr -d '[:space:]')"; if printf '%s' "$k" | grep -Eq '^[A-Za-z0-9+/]{43}=$'; then supabase secrets set --project-ref lkxqcmzeidlyssoqmqkh --env-file <(printf 'TELNYX_PUBLIC_KEY=%s\n' "$k") && echo "Clé publique posée"; else echo "Refusé : ce n'est pas une clé publique Telnyx (44 caractères finissant par =)"; fi; unset k; printf '' | pbcopy
```

### 2. Clé API (pour les médias sans lien et l'envoi depuis Gestion)

Portail Telnyx, Keys & Credentials, API Keys, créer une clé nommée « Gestion WhatsApp ». Puis :

```bash
read -rs "k?Clé API Telnyx : "; echo; if printf '%s' "$k" | grep -Eq '^KEY[A-Za-z0-9_-]{20,}$'; then supabase secrets set --project-ref lkxqcmzeidlyssoqmqkh --env-file <(printf 'TELNYX_API_KEY=%s\n' "$k") && echo "Clé API posée"; else echo "Refusé : une clé API Telnyx commence par KEY"; fi; unset k
```

### 3. Webhook sur un profil de messagerie (sinon pas de `message.echo`)

Portail Telnyx, Messaging, Messaging Profiles : ouvrir le profil du numéro WhatsApp (ou en créer un « Gestion WhatsApp » et y rattacher le numéro). Dans Inbound, « Send a webhook to the following URL » : coller l'adresse de la fonction, version d'API 2. Enregistrer.

### 4. Webhook sur le compte WhatsApp (WABA)

Portail Telnyx, WhatsApp, le compte de Nani, Settings : même adresse dans Webhook URL. Événements : `account_update` et `messages` (branché le 22.11.2026). Chaque message arrive alors deux fois, une fois par webhook : la fonction ne garde que le premier (même wamid) et range celui que seul le compte a reçu (migration 100).

### 5. Essai

Écrire « test » au numéro de Nani depuis un autre téléphone, puis répondre depuis l'app de Nani. Contrôle (lecture seule) :

```sql
select type, count(*), max(recu_le) from whatsapp_evenements group by 1;
select m.sens, m.origine, m.type, left(m.texte, 40), m.envoye_le from whatsapp_messages m order by m.envoye_le desc limit 10;
```

## État du numéro et fenêtre de 24 heures

Meta n'accepte la synchronisation que dans les 24 heures qui suivent l'inscription en coexistence. Telnyx affiche l'état du numéro : `sync_pending`, `syncing`, `sync_complete` puis `active`. L'envoi par l'API n'est possible qu'en `active`. En `sync_deadline_expired`, le numéro ne passera pas `active` (la doc ne dit pas ce que deviennent alors les webhooks) : déconnecter dans l'app WhatsApp Business (Réglages, Compte, Business Platform, Déconnecter), puis refaire l'inscription en coexistence chez Telnyx, ce qui ouvre une nouvelle fenêtre.
