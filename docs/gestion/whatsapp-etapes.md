# Étapes des conversations WhatsApp (migration 105)

Demande de Jérémy du 22.11.2026 : trier les conversations WhatsApp selon l'avancée de la discussion. Fait suite à « Prêt à réserver » (migration 85, PR 313). Aucun appel à l'IA en plus.

Ce dépôt est public : les cas ci-dessous sont **reformulés**. Aucun nom, aucun numéro, aucun lieu ni aucune phrase de client réel. Les tests (`tests/gestion-whatsapp-etapes.test.js`) rejouent chaque cas avec des messages inventés sur le même modèle.

## 1. Plus de tri automatique pour un contact qui n'est pas un client

Une conversation typée chauffeur, partenaire, hôtel ou apporteur, ou reliée à une fiche partenaire, ne passe plus par le tri Haiku : `triSansAppel` (`supabase/functions/whatsapp/proposer.js`) rend le motif « partenaire » sans appel. Le tri sert à reconnaître un client ; un contact non typé y passe encore.

L'Assistant reste ouvert pour ces contacts quand Nani le demande (« Préparer une réponse », « Demander à l'assistant ») : `iaPermise` ne change pas. Seul « Contact personnel » coupe toute IA, comme le 21.11.

## 2. Les étapes

| Étape | Quand |
|---|---|
| Nouvelle demande | Le client a demandé quelque chose (formulaire du site, prix, réservation, disponibilité, ou tri « demande »), aucun prix ni dossier |
| Prix envoyé | Nani a répondu avec un montant ; ou un dossier existe sans accord ni service confirmé (devis) |
| À relancer | Prix envoyé, aucune réponse du client depuis 48 h, aucun dossier |
| Prêt à réserver | Les signaux de la PR 313 |
| Réservé | Dossier du client accepté, ou un service confirmé |
| Voucher envoyé | Voucher noté sur chaque réservation (envoi depuis Gestion ou marqué envoyé), ou confirmation envoyée par Nani depuis son téléphone après la création du dossier |
| Terminé | Tous les services du dossier sont passés |

Un refus ou une annulation du client après le dernier prix arrête l'échange : plus d'étape, jusqu'à un nouveau prix.

**Par entreprise.** Secret et Taxi partagent le numéro : la conversation d'un client appartient aux deux, l'étape suit chaque entreprise. L'entreprise d'un dossier est la sienne. Celle d'un prix se lit dans le message de Nani (mots d'un transfert ou d'une excursion), puis dans le tri déjà calculé, puis dans la demande du client juste avant. Un client peut être « Réservé » chez Taxi et « Prix envoyé » chez Secret : les deux pastilles s'affichent. ZTP reste à part : un dossier ZTP ne compte jamais, et un client qui n'a de dossier que chez ZTP n'a pas d'étape.

**Choix manuel.** Nani peut forcer une étape par entreprise (« Changer l'étape »). Son choix l'emporte jusqu'au prochain événement qui fait avancer : un nouveau prix, une réponse du client, un dossier, un voucher. « Revenir au calcul automatique » efface son choix.

Les motifs du tri (demande_client, remerciement…) restent pour décider de préparer une réponse ; ils ne s'affichent plus.

### Vérification sur les 48 conversations réelles (lecture seule, 22.11.2026)

Messages, dossiers, réservations et vouchers lus le 22.11.2026 à 10:00 (heure de Bangkok).

| Étape | Conversations | Modèles |
|---|---|---|
| Nouvelle demande | 4 | C21 projet de voyage, C19, C44, C1 (cas douteux ci-dessous) |
| Prix envoyé | 10 | C4, C9, C14, C22, C33, C35, C37, C40, C42, C47 |
| À relancer | 0 | Aucun prix n'a encore 48 h sans réponse. Deux jours plus tard sans message, 6 y passent : C4, C9, C22, C33, C37, C40 |
| Prêt à réserver | 2 | C41 (Secret), C43 (Taxi) |
| Réservé | 1 | C38, voucher envoyé pour un des deux services |
| Voucher envoyé | 2 | C7, C36 (confirmation envoyée depuis le téléphone juste après le dossier) |
| Terminé | 4 | C18, C29, C30, C39 |
| Sans étape | 25 | Contacts personnels (C2, C3, C8, C10, C23, C25, C26), partenaires (C11, C12, C13, C31, C34), messages de Nani seuls (C20, C24, C27, C28, C32), refus (C17, C46, C48), annulation (C45), ZTP (C5), échanges privés non typés (C6, C15, C16) |

Chaque conversation de client a une seule étape aujourd'hui ; aucune n'a encore deux entreprises en même temps.

### Corrections faites pendant la vérification

| Cas | Problème trouvé | Correction |
|---|---|---|
| C17, C46, C48 | Le client refuse après le prix, l'étape restait « Prix envoyé » | Un refus ou une annulation après le dernier prix arrête l'échange |
| C16 | Un message privé contenant « disponibles » passait pour une demande | « disponible » en français ne compte plus comme demande |
| C47 | « round trip » en songthaew lu comme une excursion | « round trip » compte pour un transfert ; « trip » seul ne compte plus pour une excursion |
| C5 | Un client de ZTP apparaissait chez Secret (tri « secret ») | Un client qui n'a de dossier que chez ZTP n'a pas d'étape |

### Cas douteux (reformulés)

| Cas | Situation | Résultat | Ce que Nani fait |
|---|---|---|---|
| C1 | Nani demande à un bateau s'il est libre ; le bateau propose un prix | Nouvelle demande : le contact n'est pas typé | Le typer « Partenaire » : il sort des étapes et du tri |
| C19 | Le client demande une sortie qui n'existe pas, Nani répond que ce n'est pas possible | Secret · Nouvelle demande | « Changer l'étape », ou laisser : la demande reste visible |
| C44 | Un message de groupe demande si c'est confirmé pour demain, sans prix | Nouvelle demande, entreprise inconnue | Vérifier ; « Changer l'étape » si c'est une réservation existante |
| C38 | Un voucher sur deux envoyé | Taxi · Réservé | Voucher envoyé quand le second part |

## 3. Un numéro, deux entreprises : effets vérifiés

| Sujet | Effet | Décision |
|---|---|---|
| « À trier » | Disparaît pour les clients : la liste et l'en-tête montrent les étapes à la place de l'entreprise. Le filtre « À trier » ne garde que les contacts qui ne sont pas des clients, et disparaît s'il est vide | Fait |
| Choix de l'entreprise dans l'en-tête | Masqué pour un client. L'entreprise se décide par dossier : « Créer le dossier » demande déjà l'entreprise pour une conversation à trier | Fait |
| Droits | Rien ne change en base. Une conversation de client à trier s'écrit par un administrateur de Secret ou de Taxi (migration 63) : elle appartient bien aux deux. Une conversation déjà rangée (par un dossier) ne s'écrit que par un administrateur de son entreprise. Chez Zwald, Nani administre les deux, donc aucun effet aujourd'hui. Pour une agence où Secret et Taxi auraient des administrateurs différents, il faudrait ouvrir l'écriture d'une conversation de client aux deux (politique `whatsapp_ecrit`) | **À décider par Jérémy**, pas fait |
| `iaPermise` | Inchangé. Conversation à trier : l'IA est permise si l'assistant est allumé dans l'une des deux. Conversation rangée : seulement l'assistant de son entreprise. Si un seul des deux assistants est éteint, une conversation de client à trier part encore chez Anthropic pour le tri. Pour un client commun, la règle prudente serait d'exiger les deux assistants allumés | **À décider par Jérémy**, pas fait (les deux assistants sont allumés chez Zwald) |
| Contrôle d'envoi | La PR 310 contrôle Secret et Taxi ensemble pour une conversation de l'une, de l'autre ou à trier (`whatsapp-envoi`, `entitesControlees`) : cohérent avec un client commun. Aucun changement ici | Rien à faire |
| Réponses préparées | Une proposition reste préparée pour une entreprise et lue par ses seuls administrateurs (migration 59) : chaque entreprise garde ses éléments | Inchangé |
| ZTP | Jamais compté ni affiché dans les étapes | Fait |

## Où est quoi

| Fichier | Rôle |
|---|---|
| `supabase/functions/whatsapp/proposer.js` | `contactNonClient`, plus de tri Haiku pour un contact non client |
| `supabase/functions/whatsapp/etapes.js` | Faits tirés des messages, purs, sans IA : dates, prix par entreprise, prêt, voucher, refus. Jamais un texte |
| `supabase/functions/whatsapp/pret.ts` | Écrit `avancee` avec `pret_reserver` après chaque message et à la reprise ; rien sans la migration 105. `index.ts` et `calc.js` ne changent pas |
| `docs/gestion/migration-105-whatsapp-etapes.sql` | `avancee` (fonction seulement), `etape_manuelle` (Nani, heure posée par la base, clés et étapes contrôlées) |
| `docs/gestion/retour-105-whatsapp-etapes.sql`, `verif-whatsapp-etapes.mjs` | Retour en arrière, contrôle PGlite |
| `src/gestion/js/whatsapp-etapes-calc.mjs` | Les étapes par entreprise, avec les dossiers, les réservations et les vouchers ; choix manuel |
| `src/gestion/js/views/whatsapp-etapes.mjs` | Filtres par étape, pastilles, « Changer l'étape » |
| `src/gestion/js/demo-etapes.mjs` | Démonstration : faits simplifiés et contrôle local du choix manuel |

## Mise en service

1. Migration 85 (PR 313), puis migration 105.
2. Redéployer la fonction `whatsapp` (proposer.js, etapes.js, pret.ts). La reprise calcule les faits des conversations déjà là, 20 toutes les 5 minutes.
3. Le front part avec Netlify à la fusion. Sans la migration 105, l'écran garde la liste d'avant.

Contrôle après la reprise :

```sql
select avancee->>'client' as client, count(*) as conversations, count(etape_manuelle) as manuelles
from whatsapp_conversations
group by 1
order by 1;
```

Retour en arrière : `docs/gestion/retour-105-whatsapp-etapes.sql`.
