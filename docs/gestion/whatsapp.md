# WhatsApp de Nani dans Gestion

Le numéro WhatsApp de Secret Travel & Tour et VIP Taxi Lanta est relié à Telnyx en mode coexistence depuis le 20.11.2026. Il reste dans l'app WhatsApp Business de Nani : elle lit et répond comme avant. Telnyx envoie en plus chaque message à la fonction Supabase `whatsapp`, qui le range dans Gestion.

## Ce qui arrive dans Gestion

| Événement Telnyx | Quand | Où il va |
|---|---|---|
| `message.received` | un client écrit, modifie ou supprime un message | `whatsapp_messages`, sens « entrant » |
| `message.echo` | Nani répond depuis l'app WhatsApp Business | `whatsapp_messages`, sens « sortant », origine « app » |
| `whatsapp.account.update` | compte déconnecté, reconnecté ou retiré | `whatsapp_reglages.etat_compte` |

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

La purge tourne dans la fonction, au plus une fois par heure. Aucun message ne sert à entraîner un modèle. L'IA ne reçoit jamais de net, de commission ni de coordonnées bancaires.

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
- **Ce qui part chez Anthropic** : le texte des 30 derniers messages de la conversation (ceux du client et de Nani), les numéros de téléphone, de compte et les IBAN masqués ; le prénom du client ; le dossier relié (services, dates, heures, prix de vente, prénom) ; ce que rendent le catalogue, les horaires et les durées. Jamais un numéro de téléphone, un nom de famille, un net, une commission ni un nom de partenaire. L'API Anthropic n'entraîne pas ses modèles sur ces données.
- **Conservation** : une proposition part avec sa conversation, au plus tard 90 jours après sa création. Une préparation interrompue passe « échec » après 3 minutes.

## Tri des messages et classement protégé (migration 60)

Demande de Jérémy du 20.11.2026 : ne jamais toucher à ce que Nani a classé, et ne pas préparer de réponse à tous les messages.

- **Classement protégé.** La fonction ne change jamais l'entreprise, le client, le dossier ni l'interrupteur d'une conversation déjà posés : le déclencheur `whatsapp_proteger_classement` remet l'ancienne valeur. Une conversation rangée à la main reste rangée. Seule Nani change son classement depuis l'outil. Les étiquettes de l'app WhatsApp Business ne passent pas par Gestion (Meta ne les transmet pas en coexistence) : Gestion ne les lit ni ne les modifie.
- **Interrupteur par contact** (`reponses`) : « Automatiques » (« Sur demande » tant que la préparation automatique est décochée) ou « Jamais pour ce contact » (ami, famille, partenaire, chauffeur : ni tri par Claude, ni résumé, ni promesse ; Nani peut toujours demander une réponse).
- **Tri, du moins cher au plus cher.** Une réponse n'est préparée seule que si le réglage automatique est coché et que tout passe :
  1. le contact n'est pas réglé sur « jamais » ;
  2. le message n'est pas une réaction, un emoji seul, un « ok », un merci, ni une photo ou un vocal sans texte (aucun appel à Claude) ;
  3. le numéro n'est pas celui d'une fiche partenaire (téléphones du contact) ;
  4. le budget et les limites du jour le permettent ;
  5. Claude Haiku lit les derniers messages et répond en JSON : préparer ou non, motif, entreprise suggérée. Il faut à la fois « oui » et un motif de demande (`demande_client` ou `suivi_reservation`) ; dans le doute, non.
- **Décision visible.** Le motif est gardé sur la conversation (`tri`) et affiché dans l'écran à côté du bouton, sans ton d'anomalie (« Demande de client », « Message personnel »…). Un bouton « Préparer une réponse » (fonction `whatsapp-preparer`) prépare quand même, dans les mêmes limites.

## Le ton de Nani (20.11.2026)

Demande de Jérémy : les réponses préparées doivent avoir le ton de Nani, appris de ce qu'elle écrit dans chaque situation (`whatsapp/ton.js`).

- À chaque réponse préparée, l'agent reçoit jusqu'à 8 de ses vraies réponses envoyées depuis l'app, avec le message du client juste avant, dans les conversations de la même entreprise. Les situations proches du message en cours passent d'abord, puis les plus récentes.
- Il reçoit aussi jusqu'à 5 de ses réécritures : la réponse préparée par l'agent, puis ce que Nani a vraiment envoyé à la place (dans les 6 heures, assez différent). Plus elle corrige, plus les réponses se rapprochent des siennes.
- Ces exemples servent au ton, à la longueur, aux formules et aux emoji. Les faits (prix, heures, disponibilités) viennent toujours des outils. Numéros et IBAN masqués ; un exemple qui parle de net, de commission ou de compte bancaire est écarté.

## Fiabilité (migration 64, lot 3 des audits du 20.11.2026)

- **Envoi depuis Gestion.** `whatsapp-envoi` range le message avant d'appeler Telnyx (`statut_envoi = 'envoi'`), puis le complète avec l'id Telnyx (`envoye`). Un refus sûr de Telnyx (4xx) retire le message du fil et rend la réponse préparée. Un délai dépassé, une coupure, un 5xx ou une réponse illisible laissent le message dans le fil : après 30 secondes, la carte « Vérifiez dans WhatsApp » propose « C'est parti » (le message reste, la réponse est soldée) ou « Pas parti » (le message sort du fil, la réponse revient). Après 5 minutes sans confirmation, la reprise le passe en échec visible (`erreur_envoi = 'sans_confirmation'`). La confirmation passe par `whatsapp_confirmer_envoi`, réservée à qui peut écrire dans la conversation.
- **Statuts d'envoi.** Telnyx envoie `message.sent`, `message.finalized` (état `delivered`, ou un échec avec `errors[]`) et `message.read` pour un message envoyé par l'API. L'envoi passe `webhook_url` = la fonction `whatsapp` : aucun réglage du portail n'est nécessaire. Le statut s'écrit sur le message par son id Telnyx, sans jamais revenir en arrière (`remis` puis un `sent` en retard ne change rien). L'écran l'affiche à la suite de l'heure : envoyé, remis, lu, ou non remis avec la raison de Meta en clair (24 h dépassées, numéro sans WhatsApp…). Un statut arrivé avant que l'id soit noté est repris 30 minutes, puis classé.
- **Reprise.** Le cron `whatsapp-reprise` (toutes les 5 minutes, posé par `cron-whatsapp-reprise.sql`) appelle la fonction avec `{ "mode": "reprise" }` et le jeton de `rappels`. Elle reprend jusqu'à 25 événements en attente, passe en échec les envois sans confirmation et purge au plus une fois par heure. `whatsapp_reserver_evenement` compte l'essai dès la réservation : une instance tuée en route compte aussi.
- **Modification ou suppression par le client.** Si le message d'origine n'est pas encore rangé (en erreur, repris plus tard), l'événement est repris lui aussi pendant 30 minutes au lieu d'être clos sans rien toucher.
- **Doublon.** Un événement ne range qu'un message (index unique sur `evenement_id`), même sans id Telnyx ni Meta.
- **Réglages > WhatsApp, ligne « Réception ».** `whatsapp_etat_reception()` (administrateurs de Secret ou de Taxi, lecture seule) : messages en erreur (repris toutes les 5 minutes), abandonnés après 5 essais (bouton « Relancer », `whatsapp_relancer_evenements`), en attente depuis plus de 10 minutes (cron arrêté ?), envois à vérifier.
- **Conservation.** Un événement jamais rangé reste 90 jours au lieu de 30, pour pouvoir être relancé.

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

Portail Telnyx, WhatsApp, le compte de Nani, Settings : même adresse dans Webhook URL. Événements : cocher `account_update` seulement. Ne pas cocher `messages`, sinon chaque message arrive deux fois.

### 5. Essai

Écrire « test » au numéro de Nani depuis un autre téléphone, puis répondre depuis l'app de Nani. Contrôle (lecture seule) :

```sql
select type, count(*), max(recu_le) from whatsapp_evenements group by 1;
select m.sens, m.origine, m.type, left(m.texte, 40), m.envoye_le from whatsapp_messages m order by m.envoye_le desc limit 10;
```

## État du numéro et fenêtre de 24 heures

Meta n'accepte la synchronisation que dans les 24 heures qui suivent l'inscription en coexistence. Telnyx affiche l'état du numéro : `sync_pending`, `syncing`, `sync_complete` puis `active`. L'envoi par l'API n'est possible qu'en `active`. En `sync_deadline_expired`, le numéro ne passera pas `active` (la doc ne dit pas ce que deviennent alors les webhooks) : déconnecter dans l'app WhatsApp Business (Réglages, Compte, Business Platform, Déconnecter), puis refaire l'inscription en coexistence chez Telnyx, ce qui ouvre une nouvelle fenêtre.
