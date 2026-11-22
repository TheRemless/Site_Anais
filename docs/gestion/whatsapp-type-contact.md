# Type du contact WhatsApp compris par le sens de la conversation (migration 110)

Demande de Jérémy du 22.11.2026 : « l'outil ne détecte pas quand c'est un partenaire, fais en sorte qu'il comprenne vraiment le sens des conversations. Le tag chauffeur tu peux l'enlever parce que nos chauffeurs sont des partenaires. Hôtel aussi, on ne parle pas avec les hôtels. »

Pourquoi c'est urgent : avec la #318, un « client probable » reprend le prix écrit par Nani comme prix de vente. Le prix qu'elle écrit à un partenaire est souvent un net.

Ce dépôt est public : les cas ci-dessous sont **reformulés**. Aucun nom, aucun numéro, aucun lieu ni aucune phrase réelle. Les tests (`tests/gestion-whatsapp-type.test.js`) rejouent chaque cas avec des messages inventés sur le même modèle.

## 1. Les vraies conversations (lecture seule, 22.11.2026 à 05:30 UTC)

52 conversations : 46 sans type ni fiche partenaire, 5 typées partenaire, 1 apporteur, aucune chauffeur ni hôtel.

| Groupe | Conversations | Résultat des repères sans IA |
|---|---|---|
| Partenaires posés par Nani | 5 (C3, C4, C5, C11, C19) | C4 et C11 nets ; C3 et C5 un repère ; C19 aucun (il demande un numéro de compte en thaï). Rien ne change pour eux : le type de Nani reste |
| **Partenaires mal classés, lisibles par l'IA** | **2** | C12 (bateau) : repères nets. C39 (opérateur d'excursion) : un repère, mais le tri a déjà dit « partenaire » une fois |
| Partenaire probable réglé « Contact personnel » | 1 (C28, commissions) | Jamais lu : rien ne part à l'IA, aucun repère |
| Clients | 33 | **Aucun repère** sur aucun |
| Personnel (Contact personnel ou cours privés) | 8 | Les 5 « Contact personnel » ne sont pas lus. 3 cours privés non réglés (C21, C22, C29) : aucun repère, le tri les dira « personnel » sans rien poser |
| Messages de Nani seuls (photos, vocal) | 2 (C8, C25) | Aucun repère |

Le compte réel est donc plus faible que prévu : 2 partenaires lisibles mal classés sur 46, et un troisième fermé à l'IA. Avant cette PR, la #318 aurait traité C12 et C39 comme des clients probables.

### Les partenaires (reformulés)

| Cas | Ce qui le montre | Repères |
|---|---|---|
| C12, bateau | Nani demande si son bateau est libre mardi, lui écrit en thaï, il propose un prix pour 10 personnes, Nani parle de ses clients | disponibilité, thaï de Nani, prix du contact, clients de Nani : 7 points, nets |
| C39, opérateur d'excursion | Nani lui écrit que des clients sont intéressés et demande ce qui est inclus | clients de Nani : 2 points. Le tri l'a déjà classé « partenaire » |
| C4, chauffeur (posé) | Nani transfère les demandes (« Customer: … », entre guillemets, le formulaire du site), il donne ses prix, il dépose un client, il parle des clients de Nani | 5 repères, 11 points |
| C11, activité (posé) | Nani parle des clients à la 3e personne, transmet leur numéro, il les a emmenés à une activité | 3 repères, 8 points |

### Faux positifs évités (reformulés)

| Cas | Situation | Pourquoi rien |
|---|---|---|
| C7 | Une cliente écrit sa plainte en thaï | Seul le thaï **de Nani** compte, et seulement une phrase (pas « ค่ะ ») |
| C35 | « we're still waiting for our driver » | Le chauffeur n'est pas un client à la 3e personne |
| C46 | « could you do 2300 baht? » | Un prix avec une question est une négociation de client |
| C1 | « 900 THB there and back? » ; Nani : « let me ask the driver », « all our drivers are busy » | Question ; Nani qui parle du chauffeur à un client ne compte pas |
| C2, C13, C20 | Le formulaire du site (« Guests: 2 adults », « Price on the site: … ») | Le formulaire est celui d'un client ; un intitulé suivi de « : » ne compte pas |
| C45 | « my wife got your quote », « maximum passengers » | Un conjoint n'est pas un client ; « passengers » n'est pas un repère |
| C47 | Confirmation de Nani au client (« Number of passengers: 3 adults ») | Intitulé, pas un client à la 3e personne |
| C9 | Message type de Nani qui parle de « local partners » | « partners » seul ne compte pas |
| C46 | « Sawasdee kha » en lettres latines | Pas du thaï écrit |

Un client ne peut presque pas atteindre des repères nets seul : « I am at the pier » vaut 1 point, son thaï 0, ses questions 0.

## 2. La règle

**Repères sans IA** (`supabase/functions/whatsapp/type-contact.js`, `signauxPartenaire`), sur les 60 derniers messages, refaits après chaque message et à la reprise (`pret.ts`, colonne `type_signaux`) :

| Repère | Qui | Poids |
|---|---|---|
| Nani transfère la demande ou les coordonnées d'un client (« Customer: », « -> », entre guillemets, le formulaire, un numéro étranger) | Nani | 3 |
| Commission ou prix net | les deux | 3 |
| Nani demande une disponibilité (question) | Nani | 2 |
| Le contact donne un prix, sans question | contact | 2 |
| Nani parle de ses clients à la 3e personne | Nani | 2 |
| Le contact parle de clients à la 3e personne | contact | 2 |
| Le contact confirme une prise en charge de clients | contact | 2 |
| Le contact dit qu'il est au port, à l'aéroport, à l'hôtel | contact | 1 |
| Nani écrit une phrase en thaï | Nani | 1 |

**Nets** : 4 points au moins, sur 2 repères différents au moins. Les repères sont des codes et des nombres, jamais un texte.

**Décision du tri** (même appel Haiku qu'avant, aucun de plus) : `type_contact` (client, partenaire, apporteur, personnel, inconnu) et `raison_type` (12 mots, sans nom, sans numéro, sans prix), décidés sur toute la conversation. Haiku reçoit les 8 derniers messages comme avant, plus les 4 premiers de la conversation et la liste des repères (sans texte). Les 5 dernières décisions sont gardées dans `type_avis`.

**Pose automatique** (`typeADeduire`) : le contact n'a ni type, ni source, ni fiche partenaire, n'est pas un Contact personnel, la dernière décision qui dit quelque chose est « partenaire » (« inconnu » ne compte pas) et :
- « partenaire » revient sur au moins 2 décisions, ou
- sur une seule, avec des repères nets.

Avant la migration, le motif « partenaire » du tri compte pour une décision (cas C39).

Le type posé est marqué « déduit » par la base (`type_source = 'deduit'`). Seul « partenaire » se déduit : client reste le défaut, apporteur et personnel se choisissent à la main.

**Nani a toujours le dernier mot.** Un type posé, changé ou retiré par Nani n'est jamais écrasé (`whatsapp_type_source`, migration 110). À l'écran, sous les puces du type : « Partenaire déduit d'après la conversation : <raison>. Ses prix ne sont jamais repris comme prix de vente. » avec « Confirmer ». Une autre puce le change d'un tap.

**Partenaire probable** (`partenaireProbable`) : pas encore de type, et la dernière décision dit « partenaire » ou les repères sont nets. Rien n'est posé, l'écran affiche « Partenaire probable : … Touchez « Partenaire » si c'est juste. » Dès maintenant :
- la réponse préparée suit la consigne partenaire ;
- les montants de la conversation sont des nets possibles ;
- aucun prix n'est repris comme prix de vente.

### Ce que devient C12 et C39 après la mise en service

| Cas | Dès la reprise (sans IA) | Au prochain message du contact (tri) |
|---|---|---|
| C12 | Repères nets : partenaire probable, aucun prix repris | Si le tri dit « partenaire » : posé, marqué déduit |
| C39 | Décision « partenaire » déjà là : probable | Si le tri redit « partenaire » : posé (2 décisions) |

## 3. Chauffeur et hôtel retirés

- Écran : plus de puces « Chauffeur » ni « Hôtel » (`TYPES_CONTACT`).
- IA : `CONSIGNE_PARTENAIRE`, `LIBELLES_CONTACT` et la consigne du tri ne parlent plus que de partenaire (un chauffeur, un bateau, un guide en sont).
- Exclusions devenues « partenaire » : `TYPES_NON_CLIENTS`, `TYPES_EXCLUS` (fonction et écran), `CONTACTS_INTERNES` et `CONTACTS_NOMMES` (Assistant et écran), `CONTACTS_NOMMES` de l'excursion proposée, démo, masquage des noms (un contact typé est toujours une personne).
- Base : la migration convertit toute valeur `chauffeur` ou `hotel` en `partenaire` (0 ligne aujourd'hui, rejouable) et la contrainte n'accepte plus que client, apporteur, partenaire.
- Restent, et c'est voulu : les hôtels des clients (lieu de pickup, `{hotel}` des messages types, champs du voucher) et le chauffeur d'une course Taxi (fiche partenaire de la course).
- Les anciens contrôles PGlite (migrations 68 à 74) gardent « chauffeur » et « hotel » : ils vérifient l'état de la base à leur migration.

## 4. Coordination avec la #318

La #318 (session WhatsApp, `clientConfirme` et `etapeClient` dans `supabase/functions/agent/outils.js`) doit appeler, depuis `../whatsapp/type-contact.js` :
- `partenaireProbable(conv)` : vrai pour un partenaire posé, déduit ou probable. Un tel contact n'est jamais un client probable ;
- `prixDeVentePermis(conv)` : faux pour lui, et pour un Contact personnel.

Pour cela, les lectures de conversations de l'Assistant (`agent/index.ts`) doivent ajouter `type_source, type_avis, type_signaux`, avec le repli habituel si la colonne manque (42703).

Un partenaire **posé** (Nani ou déduit) est déjà écarté par `conversationDeClient`, sur `type_contact`. Cette PR ne touche à `outils.js` que dans deux commentaires.

**Ordre de fusion** : cette PR d'abord, puis la #318 rebasée qui appelle `partenaireProbable`. Si la #318 part avant, un partenaire non typé (C12, C39) reste un client probable jusqu'à cette PR.

## Où est quoi

| Fichier | Rôle |
|---|---|
| `supabase/functions/whatsapp/type-contact.js` | Repères, décision, règle de pose, `partenaireProbable`, `prixDeVentePermis` |
| `supabase/functions/whatsapp/proposer.js` | Consigne du tri (type du contact), lecture de la décision, consigne partenaire |
| `supabase/functions/whatsapp/reponse.ts` | Décision gardée (`type_avis`), type posé ; partenaire probable : réponse en consigne partenaire |
| `supabase/functions/whatsapp/pret.ts` | Repères (`type_signaux`), type posé, reprise des conversations déjà là |
| `docs/gestion/migration-110-whatsapp-type-contact.sql` | Colonnes, conversion, contrainte, `whatsapp_type_source` |
| `docs/gestion/retour-110-whatsapp-type-contact.sql`, `verif-whatsapp-type-contact.mjs` | Retour en arrière, contrôle PGlite |
| `src/gestion/js/whatsapp-type-calc.mjs`, `views/whatsapp-type.mjs` | Écran : « Partenaire déduit », « Confirmer », « Partenaire probable » |
| `src/gestion/js/demo-type-contact.mjs` | Démonstration (un bateau déduit partenaire) |

## Mise en service

1. Migration 110 (après la 105). Elle convertit chauffeur et hôtel, puis pose `type_source = 'nani'` sur les 6 types déjà posés.
2. Redéployer la fonction `whatsapp` (`type-contact.js`, `proposer.js`, `reponse.ts`, `pret.ts`) ; l'Assistant (`agent`) pour `whatsapp-lecture.js` et `apprendre-whatsapp.js` ; `whatsapp-envoi` (il passe par `agent/apporteur.js`, qui lit `CONTACTS_NOMMES`). La reprise calcule les repères des conversations déjà là, 20 toutes les 5 minutes.
3. Le front part avec Netlify à la fusion. Sans la migration, l'écran ne montre pas « Partenaire déduit » et la fonction n'écrit rien de neuf.

Contrôle après la reprise :

```sql
select type_contact, type_source, count(*) as conversations,
       count(*) filter (where (type_signaux->>'nets')::boolean) as reperes_nets,
       count(type_avis) as avec_decisions
from whatsapp_conversations
group by 1, 2
order by 1, 2;
```

Attendu juste après la reprise, sur les messages du 22.11 : `partenaire / nani` 5, `apporteur / nani` 1, aucun `deduit` ; 3 conversations aux repères nets (C4, C11, C12).

Retour en arrière : `docs/gestion/retour-110-whatsapp-type-contact.sql`.
