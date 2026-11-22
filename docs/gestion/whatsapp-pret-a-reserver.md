# Prêt à réserver (écran WhatsApp, migration 85)

Un filtre de l'écran WhatsApp de Gestion. Il montre les conversations où le client est prêt à réserver et où aucun dossier n'est encore créé. La règle vient de la lecture des messages réels, sans aucun appel à l'IA.

## Lecture des messages réels (22.11.2026)

Lecture seule de `whatsapp_messages` et `whatsapp_conversations` : 521 messages, 48 conversations, du 20 au 22.11.2026. Les conversations sont numérotées C1 à C48 dans l'ordre du dernier message, du plus récent au plus ancien. Les extraits sont courts. Noms, hôtels et numéros sont retirés : ce dépôt est public.

Le tri existant (`tri.motif`, fonction `whatsapp`) ne regarde que le dernier message. Il ne suffit pas à lui seul : les deux réservations les plus nettes portent le motif « remerciement » parce que le client a fini par « Perfect, many thanks ». Le filtre s'en sert pour exclure (personnel, partenaire, publicité, Contact personnel).

### Conversations prêtes

| Cas | Ce qui se passe | Signal retenu | À l'écran |
|---|---|---|---|
| C36 | Demande du site, prix, question de paiement, « Would you like to book it ? », « Yes », confirmation envoyée | Nani : « Please see the attached confirmation » | Prête. Le dossier a été créé deux minutes avant la confirmation : sort par le dossier du même numéro créé depuis le prix |
| C43 | Prix, deux relances, « Yes we take it! », puis « This is you confirmation: Name, Date, Pick-up… » | Nani : récapitulatif et confirmation | Prête, carte remplie par le récapitulatif (nom, date, heure, départ, arrivée, personnes, prix) |
| C41 | Le client demande des détails (« please don't book or hold seats »), Nani répond « I have already secured your booking » | Nani : « secured your booking » | Prête, carte vide (rien d'écrit à reprendre) |
| C7 | Prix pour deux minivans, « yes I want to book the transfer », « I will send you the confirmation soon », confirmation envoyée | Nani : confirmation | Reliée au dossier : hors du filtre |
| C45 | Prix, « Could you send the taxi to pick us up? », « I will send you the taxi », puis « Is it possible to cancel the trip? » | Client puis Nani, annulés par le client | Entre puis sort (annulation) |

### Faux positifs évités

| Cas | Extrait | Pourquoi ce n'est pas prêt |
|---|---|---|
| C22, C33, C9 | « We would like to book … could you let us know the price » | Intention avant tout prix : une demande de prix |
| C4, C37, C40, C9 | Prix donné, pas de réponse | Rien du client |
| C14, C17, C28, C42 | « would you like to book / confirm ? » sans réponse | Une question de Nani n'est pas une confirmation |
| C43 (début) | « would you like that I confirm the driver ? » | « I confirm » dans une question |
| C42 | « can you do it for 2400 baht? » | Contre-proposition |
| C47 | « Alright, thanks… do you have a cheaper option? » | « Alright » suivi d'une question de prix |
| C17, C48, C46 | « No, but thank you », « We changed our plans », « not need it anymore » | Refus |
| C35, C14 | « I'll think about the price », « I'll let you know » | Hésitation |
| C5 | « Ok merci pour les infos » | « Ok » qui ne répond pas à une question de réservation |
| C24 à C30, C32 | « Thank you again for choosing … review on Google » | Demande d'avis après le séjour |
| C6, C38, C30 | « Your driver is confirmed tomorrow », « everything is confirmed on their side » | Rappel d'un service déjà réservé |
| C44 | « vous confirmez pour demain matin ? » | Une question, sans prix |
| C13 | « New confirmation: Name, Date, Pick-up… » envoyé à un chauffeur | Partenaire (type du contact) |
| C11 | « Ok I book » pour un billet d'avion d'une partenaire | Partenaire |
| C34 | « Yes » d'un bateau sur l'itinéraire | Tri « partenaire » |
| C2, C3, C8, C10, C23 | Échanges privés, « Oui super merci ! » pour un cours | Contact personnel |
| C1 | Prix discuté avec un bateau non typé, « We cannot offer this price » | Aucun accord |

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

**Sort** : un dossier relié à la conversation ; un dossier non annulé du même client (fiche reliée ou même numéro) créé depuis le prix donné ; Nani qui touche « Retirer » (elle revient seulement sur un signal plus récent) ; une annulation du client après le signal (« cancel », « no longer need », « changed our plans ») ou de Nani (« I have cancelled »).

**Jamais** : Contact personnel, partenaire, chauffeur, hôtel, apporteur, fiche partenaire reliée, tri « personnel », « partenaire » ou « publicite ».

## Où est quoi

| Fichier | Rôle |
|---|---|
| `supabase/functions/whatsapp/pret.js` | La règle, pure, sans réseau ni IA. Rend la décision et la carte pré-remplie |
| `supabase/functions/whatsapp/pret.ts` | Après chaque message (et à la reprise pour les conversations jamais calculées) : écrit `pret_reserver` si la décision change |
| `docs/gestion/migration-85-whatsapp-pret.sql` | Colonnes `pret_reserver` (fonction seulement) et `pret_retire_le` (Nani, daté par la base) |
| `src/gestion/js/whatsapp-pret-calc.mjs` | Entrée et sortie du filtre à l'écran (dossier créé, retrait) |
| `src/gestion/js/views/whatsapp-pret.mjs` | Le filtre, la ligne de la liste, la carte dans la conversation |
| `tests/gestion-whatsapp-pret.test.js` | Les cas réels ci-dessus, anonymisés |
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
