# Prêt à réserver (écran WhatsApp, migration 85)

Un filtre de l'écran WhatsApp de Gestion. Il montre les conversations où le client est prêt à réserver et où aucun dossier n'est encore créé. La règle vient de la lecture des messages réels, sans aucun appel à l'IA.

## Lecture des messages réels (22.11.2026)

Lecture seule de `whatsapp_messages` et `whatsapp_conversations` : 521 messages, 48 conversations, du 20 au 22.11.2026. Les conversations sont numérotées C1 à C48 dans l'ordre du dernier message, du plus récent au plus ancien. Ce dépôt est public : les situations ci-dessous sont **reformulées**, aucun nom, aucun numéro, aucun lieu ni aucune phrase de client réel. Les mots entre guillemets sont les tournures que la règle reconnaît, pas des citations. Les tests (`tests/gestion-whatsapp-pret.test.js`) rejouent chaque cas avec des messages inventés sur le même modèle.

Le tri existant (`tri.motif`, fonction `whatsapp`) ne regarde que le dernier message. Il ne suffit pas : deux réservations nettes portent le motif « remerciement » parce que le client a fini par un merci. La règle lit donc toute la fin de la conversation (60 messages) et se sert du tri seulement pour exclure (personnel, partenaire, publicité, Contact personnel).

Trois réservations confirmées n'ont aucun dossier relié à leur conversation (toutes trois « à trier », sans fiche client) : C43 n'a pas de dossier du tout, C36 a un dossier du même numéro créé entre le « oui » du client et la confirmation, C41 a des dossiers évoqués ailleurs mais aucun ne correspond au numéro. Les trois apparaissent dans le filtre ; C36 avec « Relier au dossier ».

### Conversations prêtes

| Cas | Situation (reformulée) | Signal retenu | À l'écran |
|---|---|---|---|
| C36 | Demande du site, prix, question sur le paiement, Nani demande si le client réserve, le client répond oui, Nani envoie la confirmation | Nani : confirmation envoyée | Prête, avec « Relier au dossier » : le dossier du même numéro existe, créé deux minutes avant la confirmation |
| C43 | Prix, deux relances, le client accepte, Nani envoie un récapitulatif (nom, date, prise en charge, prix) | Nani : récapitulatif | Prête, carte remplie par le récapitulatif |
| C41 | Le client pose des questions et demande d'attendre, Nani répond que la place est déjà bloquée | Nani : « secured your booking » | Prête, carte vide (rien d'écrit à reprendre) |
| C7 | Prix pour deux véhicules, le client veut réserver, Nani annonce puis envoie la confirmation | Nani : confirmation | Reliée au dossier : hors du filtre |
| C45 | Prix, le client demande d'envoyer le taxi, Nani l'envoie, puis le client annule | Client puis Nani, annulés par le client | Entre puis sort (annulation) |

### Faux positifs évités

| Cas | Situation (reformulée) | Pourquoi ce n'est pas prêt |
|---|---|---|
| C22, C33, C9 | Le client écrit qu'il « would like to book » et demande le prix | Intention avant tout prix : une demande de prix |
| C4, C37, C40 | Prix donné, pas de réponse | Rien du client |
| C14, C17, C28, C42 | Relance de Nani « would you like to book ? » sans réponse | Une question de Nani n'est pas une confirmation |
| C43 (début) | Nani demande si elle doit confirmer le chauffeur | « confirm » dans une question |
| C42 | Le client propose un prix plus bas | Contre-proposition |
| C47 | Le client remercie puis demande moins cher | Question de prix |
| C17, C48, C46 | Le client dit non, a changé de plan, n'en a plus besoin | Refus |
| C35, C14 | Le client va réfléchir, redira | Hésitation |
| C5 | « Ok » de politesse après une information | Pas une réponse à une question de réservation |
| C24 à C30, C32 | Demande d'avis Google après le séjour | Pas une réservation |
| C6, C38, C30 | Rappel « driver is confirmed » d'un service déjà réservé | Rappel |
| C44 | Un client demande si c'est confirmé, sans prix | Une question |
| C13 | Récapitulatif envoyé à un chauffeur | Partenaire (type du contact) |
| C11 | Réservation faite pour une partenaire | Partenaire |
| C34 | « Yes » d'un bateau sur l'itinéraire | Tri « partenaire » |
| C2, C3, C8, C10, C23 | Échanges privés | Contact personnel |
| C1 | Prix discuté avec un bateau non typé, refusé | Aucun accord |

Sur les 48 conversations, la règle donne exactement C36, C41 et C43 (prêtes), C7 (reliée, hors du filtre) et C45 (annulée).

## Règle retenue

Une conversation entre quand son signal le plus récent est l'un de ceux-ci, sans annulation après lui.

**Client**, seulement après un prix donné par Nani :
- accord net : « yes I want to book », « we take it », « book it », « let's go », « please confirm the transfer », « send the taxi », « on prend », « je réserve » ;
- « yes », « ok », « oui » en tête du message, seulement en réponse directe à une question de réservation de Nani (« would you like to book it ? », « let me know if you want to book ») ;
- un nom et une heure (ou un hôtel) donnés après le prix.

Jamais avec un refus, une hésitation, une contre-proposition ou une question de prix dans le même message.

**Nani** :
- « I'll send you the confirmation », « je prépare la confirmation », « I send you the voucher », « this is your confirmation », « please see the attached confirmation », « I have secured your booking », « I will send you the taxi » ;
- un récapitulatif : trois champs ou plus parmi Name, Date, Pick-up, Drop-off, Passengers, Price.

Jamais une question, une demande d'avis, une demande de client recopiée pour un chauffeur (« Transfer request: », « Customer: », « Could you please confirm availability ») ni un rappel.

**Sort** : un dossier relié à la conversation ; Nani qui touche « Retirer » (elle revient seulement sur un signal plus récent, « Remettre dans la liste » tant que la conversation est ouverte) ; une annulation du client après le signal (« cancel », « no longer need », « changed our plans ») ou de Nani (« I have cancelled »).

**Dossier déjà créé mais pas relié** : un dossier non annulé du même client (fiche reliée ou même numéro) créé depuis le prix donné. La conversation reste dans le filtre, la carte dit « Le dossier … existe déjà » et propose « Relier au dossier » à la place de « Créer le dossier ». Une conversation à trier est rangée dans l'entreprise du dossier en même temps (la base, `whatsapp_reclasser`, refuse un lien incohérent). Une conversation rangée dans l'autre entreprise n'est pas déplacée : la ligne d'information reste, le lien se fait depuis l'en-tête.

**Jamais** : Contact personnel, partenaire, chauffeur, hôtel, apporteur, fiche partenaire reliée, tri « personnel », « partenaire » ou « publicite ».

## Où est quoi

| Fichier | Rôle |
|---|---|
| `supabase/functions/whatsapp/pret.js` | La règle, pure, sans réseau ni IA. Rend la décision et la carte pré-remplie |
| `supabase/functions/whatsapp/pret.ts` | Après chaque message (et à la reprise pour les conversations jamais calculées) : écrit `pret_reserver` si la décision change |
| `docs/gestion/migration-85-whatsapp-pret.sql` | Colonnes `pret_reserver` (fonction seulement) et `pret_retire_le` (Nani, daté par la base) |
| `src/gestion/js/whatsapp-pret-calc.mjs` | Entrée et sortie du filtre à l'écran (dossier relié, retrait), dossier à relier |
| `src/gestion/js/views/whatsapp-pret.mjs` | Le filtre, la ligne de la liste, la carte dans la conversation |
| `tests/gestion-whatsapp-pret.test.js` | Les cas ci-dessus, rejoués avec des messages inventés |
| `docs/gestion/verif-whatsapp-pret.mjs` | Contrôle PGlite de la migration (droits, déclencheur, rejeu, retour) |

La carte reprend ce qui est écrit : le dernier récapitulatif de Nani, sinon la demande du site ou du client, puis le prix donné par Nani. Jamais un numéro de téléphone, jamais le prix affiché sur le site. « Créer le dossier » ouvre l'Assistant lié à la conversation, comme le bouton habituel : c'est le seul appel à l'IA, au clic de Nani.

## Mise en service

1. Migration 85 (`docs/gestion/migration-85-whatsapp-pret.sql`).
2. Redéployer la fonction `whatsapp` (`supabase functions deploy whatsapp`). La reprise (pg_cron, toutes les 5 minutes) calcule les conversations déjà là, 20 par passage.
3. Le front part avec Netlify. Sans la migration, l'écran n'affiche pas le filtre.

Contrôle après la reprise :

```sql
select pret_reserver->>'pret' as pret, pret_reserver->>'motif' as motif, count(*)
from whatsapp_conversations
group by 1, 2
order by 1, 2;
```

Retour en arrière : `docs/gestion/retour-85-whatsapp-pret.sql`.
