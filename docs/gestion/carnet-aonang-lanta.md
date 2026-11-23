# Guides du carnet d'Ao Nang et de Koh Lanta : ce que les pages envoient à Gestion

Contrat entre les pages privées du carnet (`/carnet/…` sur le site de ZTP) et l'outil Gestion, pour les guides **Excursions en bateau depuis Ao Nang** et **depuis Koh Lanta**. Même fonction publique que le guide de Koh Samui (`demande-site`, voir `demandes-site.md`), même format de message. Les pages ne nomment aucun prestataire : le catalogue de Gestion lui-même est privé, hors dépôt.

Règles communes : `brand` est `secret` (la demande arrive dans Secret), `page_url` est l'adresse de la page, `product_id` et `option` sont ceux des tableaux ci-dessous, `option_label` est le titre de l'option. Le message commence par `Booking request: <nom> – <titre de l'option>` et dit les invités sur la ligne `Guests: 2 adults, 2 children (ages 5 and 9)`. Les droits d'entrée de parc sont payés sur place, en plus : ils ne sont jamais dans `estimated_total`. Un second bateau ou un second groupe n'est pas calculé : Nani le précise dans la conversation WhatsApp et l'assistant met le dossier à jour.

## Ao Nang

Vocabulaire visible sur la page : « Option VIP », « Mini Luxury », « Luxury », une option plus économique (« Economy ») et une option encore plus luxueuse (« Prestige »). Sans nom de prestataire.

Chaque sortie est un bateau privé, au prix du bateau, quel que soit le nombre de personnes jusqu'au maximum de la ligne. Au-delà, la fenêtre de création le signale.

| `product_id` | `product` | `option` | `option_label` | Personnes |
|---|---|---|---|---|
| `aonang-vip-4-islands` | 4 Islands from Ao Nang, VIP option | `standard` | `VIP option` | 1 to 4 people |
| `aonang-vip-hong` | Hong Islands from Ao Nang, VIP option | `standard` | `VIP option` | 1 to 4 people |
| `aonang-vip-phi-phi` | Phi Phi Islands from Ao Nang, VIP option | `standard` | `VIP option` | 1 to 4 people |
| `aonang-mini-luxury-4-islands` | 4 Islands from Ao Nang, Mini Luxury option | `standard` | `Mini Luxury option` | 1 to 4 people |
| `aonang-mini-luxury-hong` | Hong Islands from Ao Nang, Mini Luxury option | `standard` | `Mini Luxury option` | 1 to 4 people |
| `aonang-mini-luxury-phi-phi` | Phi Phi Islands from Ao Nang, Mini Luxury option | `standard` | `Mini Luxury option` | 1 to 4 people |
| `aonang-luxury-4-islands` | 4 Islands from Ao Nang, Luxury option | `standard` | `Luxury option` | 1 to 4 people |
| `aonang-luxury-hong` | Hong Islands from Ao Nang, Luxury option | `standard` | `Luxury option` | 1 to 4 people |
| `aonang-luxury-phi-phi` | Phi Phi Islands from Ao Nang, Luxury option | `standard` | `Luxury option` | 1 to 4 people |
| `aonang-economique-4-islands` | 4 Islands from Ao Nang, Economy option | `standard` | `Economy option` | 1 to 6 people |
| `aonang-economique-hong-lagoon` | Hong Island and Lagoon from Ao Nang, Economy option | `standard` | `Economy option` | 1 to 6 people |
| `aonang-economique-hong-autres-iles` | Hong Island and other islands (Koh Pak Bia, Koh Lao Lading) from Ao Nang, Economy option | `standard` | `Economy option` | 1 to 6 people |
| `aonang-prestige-hong` | Hong Islands from Ao Nang, Prestige option | `standard` | `Prestige option` | 1 to 6 people |
| `aonang-prestige-4-islands` | 4 Islands from Ao Nang, Prestige option | `standard` | `Prestige option` | 1 to 6 people |
| `aonang-prestige-phi-phi` | Phi Phi Islands from Ao Nang, Prestige option | `standard` | `Prestige option` | 1 to 6 people |

Options à cocher sur une sortie (envoyées dans la ligne `Extras:` du message ; Anaïs ajoute le service au dossier) :

| `product_id` | `product` | `option` | Lignes |
|---|---|---|---|
| `aonang-option-lunch-box` | Lunch box | `standard` | Per person, VIP, Mini Luxury or Luxury boat ; Per person, Economy boat |
| `aonang-option-vip-set` | VIP Set | `standard` | Per boat |

## Koh Lanta

Le guide envoie les identifiants du **site Secret** (`product_id` = identifiant de la page produit, `option` = identifiant de l'option, `option_label` = son titre sur le site). Gestion les résout comme une demande du site (`site-produits.mjs`, `cles-options-site.json`), avec l'âge des enfants jugé d'après l'âge déclaré par la ligne enfant de l'option (« Child, 4 to 11 »). Une option sans ligne enfant (bateau privé), ou dont les lignes enfant ne disent pas le même âge (quad : conducteur et passager), n'a pas de barème : rien n'est ajusté ni inventé. Un bateau privé prend le palier qui contient le nombre de personnes : 4 Islands privé 1 à 2, 3 à 4, 5 à 6 personnes ; Koh Rok privé 1 à 3, 4 à 6, 7 à 8, 9 à 10 personnes.

| `product_id` | Options (barème d'âge des enfants quand l'option le dit) |
|---|---|
| `4-islands` | `join-in-longtail` (4 à 11 ans), `join-in-speedboat` (4 à 11 ans), `private-longtail`, `private-speedboat` |
| `koh-rok-koh-haa` | `join-in-speedboat` (4 à 11 ans), `sunset` (4 à 11 ans), `private-longtail`, `private-speedboat` |
| `koh-phi-phi` | `join-in-speedboat` (4 à 11 ans), `sunset` (4 à 11 ans), `private-longtail`, `private-speedboat` |
| `mangroves` | `longtail-half-day` (4 à 11 ans), `longtail-old-town-viewpoint` (4 à 11 ans), `fishing-park` (4 à 11 ans) |
| `fishing-trip` | `private-raft` (3 à 9 ans) |
| `sunrise-raft` | `raft-sunrise` (3 à 9 ans) |
| `sunset-dinner-raft` | `raft-sunset-dinner` (3 à 9 ans) |
| `atv` | `track-30-min`, `forest-1-hr`, `beach-bridge-2-hr`, `atv-kayak-2-hr` |
| `batik` | `morning-or-afternoon` (3 à 10 ans), `kayak-and-painting` (3 à 10 ans), `private-course` |
| `cooking-class` | `single-chef`, `partner-chef`, `carving` |
| `elephant-sanctuary` | `programme-a` (4 à 10 ans), `programme-b` (4 à 10 ans), `programme-c` (4 à 10 ans), `programme-d` (4 à 10 ans) |
| `go-kart` | `10-minutes`, `15-minutes` |
| `kayak` | `sea-cave-island-hopping-1-day` (4 à 11 ans), `love-kayak-1-day` (4 à 11 ans), `sea-cave-mangrove-half-day` (4 à 11 ans) |
| `mangrove-kayaking` | `mangrove-kayak-half-day` (4 à 11 ans) |
| `scuba-diving` | `one-day-experience`, `fun-dives`, `catamaran-special-trips`, `courses`, `snorkelling-on-dive-boat` (5 à 11 ans), `rentals-and-discounts` |
| `rental` | `cars-and-pick-ups`, `big-bikes`, `scooters-and-small-bikes` |
| `speedboat-ferry` |  |

Extension de Koh Kradan sur le **4 Islands privé** (`4-islands`, option `private-longtail`) : la page l'envoie dans la ligne `Extras: Add Koh Kradan` du message (libellé exact du site). Pour une **demande du carnet** seulement, Gestion ajoute alors la ligne de l'extension au dossier et à son total, une seule fois et au prix d'un bateau (jamais par personne). Le site Secret ordinaire n'est pas concerné : il écrit l'extension à sa façon (`Koh Kradan: Add Koh Kradan to the day`, ou `Extras: Add Koh Kradan, per boat` dans la refonte v4) et Gestion n'y ajoute rien, Anaïs la saisit à la main. L'extension ne s'applique pas aux autres options (le join-in a déjà Kradan dans la sortie) ni aux autres sorties : « Modifier » vers une telle option la retire aussi du message refait et des notes. Dans une liste de sorties, ce sont les extras de la première sortie, celle qui est préparée ; ceux des autres restent dans la ligne `Other trips` des notes, et les extras d'en-tête ou de pied de la liste (après une ligne vide) restent dans les notes sans être comptés. Un extra demandé qui ne peut créer aucune ligne (option non reconnue, offre qui n'est pas celle d'une option du site, tarif absent) est signalé par la fenêtre de création. La réponse de confirmation n'annonce que les extras dont la ligne a réellement été créée. Le transfert depuis l'hôtel du récapitulatif de la page n'est jamais un extra : il va dans une ligne `Hotel transfer:` (prix indicatif). Tant que le tarif n'est pas en base, la fenêtre de création le dit et l'extra s'ajoute à la main.

Nom de la page : le début de son nom dit son guide (`koh-samui-…`, `ao-nang-…`, `koh-lanta-…` dans `/carnet/<guide>-<code>/`). Gestion s'en sert pour « Proposer une autre sortie » quand l'identifiant d'une sortie est inconnu : il ne propose alors que les sorties de ce guide.

Pas dans le mapping du site (Gestion ne trouve aucun tarif tout seul, la fenêtre de création propose « Choisir dans la base ») : `koh-talabeng-koh-bubu`, `island-day-tour`. Les options sans barème (quad, kart, cours de cuisine, location, bateaux privés) ne contrôlent pas l'âge des enfants.

## Extras tarifés d'Ao Nang : lunch box et VIP Set

La page d'Ao Nang écrit les extras cochés dans la ligne `Extras:` de son message (libellés `en` de `src/carnet/ao-nang-excursions-bateau.11tydata.js`) : `Lunch box` et `VIP Set`. Gestion les tarife comme l'extension de Kradan (`EXTRAS_DU_SITE`, `carnet-produits.mjs`), avec les lignes de tarif déjà en base (identifiant de tarif du carnet, md5 de la clé) :

| Extra | Sorties où il est possible | Ligne de tarif (clé) | Prix |
|---|---|---|---|
| `Lunch box` | options VIP et Mini Luxury (3 destinations chacune) | `aonang-option-lunch-box\|standard\|Per person, VIP, Mini Luxury or Luxury boat` | par personne |
| `Lunch box` | option économique (3 sorties) | `aonang-option-lunch-box\|standard\|Per person, Economy boat` | par personne |
| `VIP Set` | option économique (3 sorties) | `aonang-option-vip-set\|standard\|Per boat` | par bateau |

La lunch box compte une quantité égale à toutes les personnes, adultes, enfants et bébés, au moins une (comme l'estimation de la page ; une seule ligne de cette quantité) ; le VIP Set vaut une fois par bateau. Un extra impossible pour la sortie (VIP Set hors de l'économique, lunch box sur Luxury qui l'inclut et sur Prestige qui n'en propose pas) n'est jamais ajouté : l'offre le signale (`extrasManquants`, affiché par la fenêtre de création) et « Modifier » le retire du message refait. Exemple de contrôle : Hong Islands VIP, 2 adultes et 1 enfant, `Extras: Lunch box` = prix du bateau + 3 lunch box. La ligne du VIP Set côté partenaire se complète par un SQL privé de correctif (hors dépôt).

## Message collé et Assistant

**Le bloc de la page.** Un message est celui d'une page du carnet quand il commence par sa ligne de demande (« Booking request: », « Demande de réservation : », précédée au plus de « Bonjour Anaïs, voici ma demande de réservation. ») et finit par sa référence (`Ref: AON-AB12`, `Réf : SAM-AB12`) dont le préfixe est dans `REFS_CARNET` (`SAM` Koh Samui, `AON` Ao Nang, `LAN` Koh Lanta). Une seule règle pour la fonction et pour Gestion : `supabase/functions/agent/page-carnet.js` (embarqué par les fonctions), dont `src/gestion/js/page-carnet.mjs` est une copie identique (un test échoue sinon : `cp supabase/functions/agent/page-carnet.js src/gestion/js/page-carnet.mjs`). Un client qui écrit avant ou après le bloc, ou qui le cite, écrit un message libre ; une référence d'un autre site (« SEC-… ») n'est pas celle d'un guide.

**Fenêtre « Créer le dossier » (`lireDuTexte`, `demande-calc.mjs`).** Un texte collé se lit TOUJOURS d'après son propre contenu : sortie par le titre de l'offre, puis personnes, âges, seuil de groupe, date, pickup, extras, droit de parc, estimation et nom du texte, avec les mêmes règles qu'une demande du site.
- Koh Samui : par `nomPage` (`carnet-produits.mjs`). Ao Nang et Koh Lanta : par `carnet-correspondance.mjs`, fichier GÉNÉRÉ par `docs/gestion/regenerer-correspondance-carnet.mjs` à partir des fichiers de données publics des pages (`src/carnet/ao-nang-excursions-bateau.11tydata.js`, `src/carnet/koh-lanta-excursions-activites.11tydata.js`) : titre français de chaque offre, sortie et option de Gestion, noms français et anglais des formules, créneaux, choix, options et lignes. Le message est récrit comme la page l'écrit pour Gestion (`buildGestionMessage`). Un test fabrique le récapitulatif de chaque offre avec le code de la page (`src/js/carnet-booking.js`), vérifie qu'il se récrit exactement comme le message envoyé à Gestion et qu'un titre français est unique et résolu ; un autre échoue si le fichier généré n'est plus celui que le script écrit. À relancer quand une offre ou un libellé d'une de ces pages change.
- La demande que la page a enregistrée pour la même référence (`demandes_site`, la liste de l'écran, sinon la base par `demandeSiteParRef`, de l'entreprise du dossier en cours et avec les droits de la personne) ne sert QU'À identifier la sortie et l'option quand le titre ne suffit pas (titre renommé depuis). Elle n'est retenue que si le texte et elle disent la même date ET le même nombre de personnes ; sinon elle est ignorée (client qui a modifié son message, référence d'un autre client ou tapée par erreur). Nom, téléphone, âges, pickup, extras et prix viennent toujours du texte.
- Une réponse tardive de la base ne refait jamais la fiche si elle a été touchée entre-temps ou si un autre texte a été lu ; « Créer le dossier » est bloqué le temps de la recherche.
- Sans préfixe de la table, avec un préfixe inconnu, ou avec un titre qu'aucun mécanisme ne reconnaît, le message reste libre : rien n'est deviné. Une demande du site garde son contexte exact (`product_id` et option).

**Assistant.** La fonction « agent » (`supabase/functions/agent/outils.js`) joint à la carte « dossier » le bloc de la page (`message_page`) : celui d'un message collé par la personne, ou du dernier message du client dans l'échange WhatsApp joint (un message du client après le bloc annule la jonction, le client a peut-être changé sa demande). Un seul bloc (une seule référence), sinon rien. Le texte est nettoyé comme les autres champs de la carte (espaces normalisés, lien retiré de la ligne qui en porte un). La fiche de création (`preparationComplete`, `views/agent-valider.mjs`, `carteAvecLaPage`, `assistant-calc.mjs`) lit ce bloc avec la même fonction que la fenêtre (`lireDuTexte`) et ne remplace QUE le service de la carte qui désigne la même sortie (tarif choisi par le modèle parmi ceux de la sortie, ou même titre, à la même date s'il y en a plusieurs) : même offre, même total, mêmes extras, mêmes âges. Sans correspondance sûre (deux services identiques, un transfert, une autre sortie), rien n'est remplacé et la fiche le dit. Jamais dans l'étape d'une entreprise de taxi. Déploiement : `agent`, `whatsapp` et `whatsapp-envoi` (le même `outils.js`).
