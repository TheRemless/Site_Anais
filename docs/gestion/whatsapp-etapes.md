# Étapes des conversations WhatsApp (migration 105)

Demande de Jérémy du 22.11.2026 : trier les conversations WhatsApp selon l'avancée de la discussion. Fait suite à « Prêt à réserver » (migration 85, PR 313). Aucun appel à l'IA en plus. Corrigé après la relecture indépendante du 22.11.2026.

Ce dépôt est public : les cas ci-dessous sont **reformulés**. Aucun nom, aucun numéro, aucun lieu ni aucune phrase de client réel. Les tests (`tests/gestion-whatsapp-etapes.test.js`, `tests/gestion-whatsapp-etapes-relecture.test.js`) rejouent chaque cas avec des messages inventés sur le même modèle.

## 1. Plus de tri automatique pour un contact qui n'est pas un client

Une conversation typée chauffeur, partenaire, hôtel ou apporteur, ou reliée à une fiche partenaire, ne passe plus par le tri Haiku : `triSansAppel` (`supabase/functions/whatsapp/proposer.js`) rend le motif `non_client` sans appel. Ce motif n'écarte pas la conversation à l'écran : c'est le type du moment qui décide, et un contact remis en Client est repris tout de suite. Un contact non typé passe encore par le tri.

L'Assistant reste ouvert pour ces contacts quand Nani le demande. Seul « Contact personnel » coupe toute IA d'office, ou la coupure par conversation (section 3).

## 2. Les étapes

| Étape | Quand |
|---|---|
| Nouvelle demande | Le client demande quelque chose (formulaire du site, ou question sur un prix, une réservation, une disponibilité), aucun prix ni dossier, ou une demande plus récente que le dernier prix ou refus |
| Prix envoyé | Nani a répondu avec un montant **en bahts** ; ou un dossier existe sans accord ni service confirmé (devis) |
| À relancer | Prix envoyé, aucune réponse du client depuis 48 h, aucun dossier |
| Prêt à réserver | Les signaux de la PR 313 |
| Réservé | Dossier accepté, ou un service confirmé |
| Voucher envoyé | Chaque service a son voucher (noté sur la réservation, ou envoyé depuis Gestion pour lui), ou un voucher envoyé depuis le téléphone a suivi le dossier. **Un récapitulatif écrit n'est pas un voucher** : il faut l'image rangée par Gestion, ou une image ou un PDF envoyé par Nani avec les mots « voucher » ou « booking confirmation » |
| Terminé | Tous les services du dossier sont passés |

**Par entreprise.** Secret et Taxi partagent le numéro : la conversation d'un client appartient aux deux, l'étape suit chaque entreprise. L'entreprise d'un dossier est la sienne. Celle d'un prix ou d'une demande se lit dans le message (mots d'un transfert ou d'une excursion), puis dans le tri déjà calculé, puis dans la demande du client juste avant. Un client peut être « Réservé » chez Taxi et « Prix envoyé » chez Secret : les deux pastilles s'affichent.

**Le plus récent l'emporte**, entreprise par entreprise :
- un refus ou une annulation du client vise l'échange en cours de cette entreprise seulement (« no thanks for the tour » arrête Secret, pas le transfert) ; « no need for a child seat » n'est pas un refus ;
- une nouvelle demande après un refus repart en « Nouvelle demande » ;
- un client qui revient (arrivée puis transfert retour) : un prix donné après le dossier fait repartir les messages, jusqu'à « Prêt à réserver » ;
- une question posée pendant qu'un dossier de l'autre entreprise est en cours est un suivi, pas une nouvelle demande.

**ZTP ne se mélange jamais.** Un dossier ZTP ne compte jamais. Un prix en CHF, en euros ou en dollars n'est pas un prix de Secret ou de Taxi. Un client qui n'a de dossier que chez ZTP n'a pas de « Nouvelle demande » ici.

**Choix manuel.** Nani force une étape par entreprise (« Changer l'étape »). Son choix l'emporte jusqu'au prochain événement daté de cette entreprise : un prix, une réponse du client, une demande, un refus, un dossier créé ou accepté, un service confirmé, un voucher à l'heure exacte. Rechoisir une étape, même la même, repart de maintenant (l'heure est posée par la base). « Sans entreprise » tombe dès qu'une entreprise a une étape. « Revenir au calcul automatique » efface le choix.

**Toujours visible.** Le filtre « Sans étape » montre les clients sans étape et les contacts qui ne sont pas des clients : une conversation n'est jamais seulement dans « Toutes ».

**Performance.** Clients, dossiers et réservations sont indexés une fois ; l'écran calcule les étapes une fois par rendu. 500 conversations et 2 000 clients, cinq appels par conversation : 12 à 15 ms (`perf.mjs` de la relecture).

### Vérification sur les 48 conversations réelles (lecture seule, 22.11.2026)

Messages, dossiers, réservations et vouchers lus le 22.11.2026 à 10:00 (heure de Bangkok), avec les règles corrigées.

| Étape | Conversations | Modèles |
|---|---|---|
| Nouvelle demande | 4 | C21 projet de voyage, C19, C44, C1 (cas douteux) |
| Prix envoyé | 10 | C4, C9, C14, C22, C33, C35, C37, C40, C42, C47 |
| À relancer | 0 | Deux jours plus tard sans message : 6 (C4, C9, C22, C33, C37, C40) |
| Prêt à réserver | 2 | C41 (Secret), C43 (Taxi) |
| Réservé | 1 | C38, un voucher sur deux |
| Voucher envoyé | 2 | C7, C36 : une image de confirmation envoyée depuis le téléphone juste après le dossier |
| Terminé | 4 | C18, C29, C30, C39 |
| Sans étape | 25 | Contacts personnels, partenaires, messages de Nani seuls, refus (C17, C46, C48), annulation (C45), ZTP (C5), échanges privés non typés |

### Corrections faites pendant les vérifications

| Cas | Problème trouvé | Correction |
|---|---|---|
| C17, C46, C48 | Refus après le prix, l'étape restait « Prix envoyé » | Un refus arrête l'échange de son entreprise |
| C16 | « disponibles » dans un message privé passait pour une demande | « disponible » en français ne compte plus |
| C35 | « je vais réfléchir au prix » passait pour une demande | Une demande est une question ou une formule de demande |
| C47 | « round trip » en songthaew lu comme une excursion | « round trip » compte pour un transfert |
| C5 | Un client ZTP apparaissait chez Secret | Dossier ZTP et prix hors bahts : jamais ici |
| C18 | Une question sur le transfert inclus dans l'excursion devenait « Taxi · Nouvelle demande » | Suivi du dossier en cours de l'autre entreprise |
| C41 | « secured your booking » sans prix pris pour un prix ZTP | Seul un prix hors bahts est ZTP |

### Cas douteux (reformulés)

| Cas | Situation | Résultat | Ce que Nani fait |
|---|---|---|---|
| C1 | Nani demande à un bateau s'il est libre ; le bateau propose un prix | Secret · Nouvelle demande : le contact n'est pas typé | Le typer « Partenaire » : il sort aussitôt |
| C19 | Une sortie qui n'existe pas, Nani répond que ce n'est pas possible | Secret · Nouvelle demande | « Changer l'étape » ou laisser |
| C44 | Un message de groupe demande si c'est confirmé, sans prix | Nouvelle demande, sans entreprise | Vérifier, « Changer l'étape » si besoin |
| C38 | Un voucher sur deux envoyé | Taxi · Réservé | Voucher envoyé quand le second part |

## 3. Un numéro, deux entreprises

| Sujet | Règle |
|---|---|
| Entreprise d'un client | « À trier » disparaît pour les clients ; l'en-tête montre les étapes à la place du choix de l'entreprise. « Créer le dossier » demande **toujours** Secret ou Taxi, la suggestion du tri présélectionnée et modifiable. Relier un dossier ne range jamais la conversation d'un client : « Relier » marche pour un dossier de Secret comme de Taxi (`whatsapp_reclasser`, migration 85, PR 313) |
| Réponses préparées | Le catalogue de l'entreprise de la demande en cours (le tri donne toujours l'entreprise pour un client), pas celui de la conversation (`entrepriseReponse`, proposer.js) |
| `iaPermise` (règle retenue) | Le tri est permis si au moins un des deux assistants (Secret ou Taxi) est allumé, même pour un client rangé. Un contact qui n'est pas un client et qui est rangé : l'assistant de son entreprise. Une réponse n'est préparée que si l'assistant de l'entreprise de la demande est allumé (sinon « assistant éteint ») |
| IA coupée pour une conversation | Nani coupe l'IA d'une conversation précise sans la classer en Contact personnel (menu « … », colonne `ia_coupee`, migration 105) : plus de tri, de résumé, de promesse ni de réponse préparée chez Anthropic ; « Préparer une réponse », « Demander à l'assistant » et « Créer le dossier » disparaissent de l'écran. Les étapes, sans IA, continuent |
| Droits | Rien ne change en base pour l'écriture : une conversation à trier s'écrit par un administrateur de Secret ou de Taxi, une conversation rangée par un administrateur de son entreprise. Relier un dossier demande d'administrer l'entreprise de ce dossier |
| Contrôle d'envoi | La PR 310 contrôle Secret et Taxi ensemble (`whatsapp-envoi`, `entitesControlees`) : cohérent avec un client commun |
| ZTP | Jamais compté, jamais relié, jamais affiché dans les étapes |

**Reste pour la session de l'Assistant** (`supabase/functions/agent`, non touché ici) : ses outils WhatsApp (`whatsapp-lecture.js`, `contactPersonnel`) écartent un Contact personnel mais pas encore une conversation à IA coupée. Il suffit d'y ajouter `|| c.ia_coupee === true` et la colonne aux lectures.

## Intégration avec les autres PR

- **#314 (messages manquants)** : `lireConversations` (store-supabase.mjs) doit garder les colonnes `PRET` (`pret_reserver, pret_retire_le`) et `ETAPES` (`avancee, etape_manuelle, ia_coupee`) dans toutes ses lectures. `pret.ts` lit déjà les messages avec `.neq("type", "non_transmis")`.
- Conflits attendus avec 308, 310, 312 et 314 : réglés à l'intégration.

## Où est quoi

| Fichier | Rôle |
|---|---|
| `supabase/functions/whatsapp/proposer.js` | `contactNonClient` (motif `non_client`), `iaPermise`, `entrepriseReponse` |
| `supabase/functions/whatsapp/reponse.ts` | Entreprise de la demande pour le tri et la réponse préparée ; « IA coupée » refusée à la demande |
| `supabase/functions/whatsapp/etapes.js` | Faits tirés des messages, par entreprise, sans IA ; vouchers à l'heure exacte. Jamais un texte |
| `supabase/functions/whatsapp/pret.ts` | Écrit `avancee` avec `pret_reserver` ; reprise ; `index.ts` et `calc.js` ne changent pas |
| `docs/gestion/migration-105-whatsapp-etapes.sql` | `avancee` (fonction), `etape_manuelle` (Nani, heure posée par la base), `ia_coupee` (Nani) |
| `docs/gestion/retour-105-whatsapp-etapes.sql`, `verif-whatsapp-etapes.mjs` | Retour en arrière, contrôle PGlite |
| `src/gestion/js/whatsapp-etapes-calc.mjs` | Étapes par entreprise, index, choix manuel |
| `src/gestion/js/views/whatsapp-etapes.mjs` | Filtres (dont « Sans étape »), pastilles, « Changer l'étape », « Couper l'IA » |
| `src/gestion/js/demo-etapes.mjs` | Démonstration |

## Mise en service

1. Migration 85 (PR 313), puis migration 105.
2. Redéployer la fonction `whatsapp` (proposer.js, reponse.ts, etapes.js, pret.ts). La reprise calcule les faits des conversations déjà là, 20 toutes les 5 minutes.
3. Le front part avec Netlify à la fusion. Sans la migration 105, l'écran garde la liste d'avant.

Contrôle après la reprise :

```sql
select avancee->>'v' as version, count(*) as conversations, count(etape_manuelle) as manuelles, count(*) filter (where ia_coupee) as ia_coupees
from whatsapp_conversations
group by 1
order by 1;
```

Retour en arrière : `docs/gestion/retour-105-whatsapp-etapes.sql`.
