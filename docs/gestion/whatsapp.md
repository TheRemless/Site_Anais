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
- L'événement brut est écrit une fois dans `whatsapp_evenements` (clé = `data.id`), puis la fonction répond 200 tout de suite. Le rangement du message et la copie des médias se font ensuite. Un traitement raté reste « à traiter » et se reprend à l'appel suivant (5 essais).
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
