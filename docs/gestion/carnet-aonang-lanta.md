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

Un message collé qui porte la référence d'une page (`Ref: AON-…`, `Réf : SAM-…`, préfixes de `REFS_CARNET` : `SAM` Koh Samui, `AON` Ao Nang, `LAN` Koh Lanta, une seule table, comparée par un test aux `prefixeRef` des pages) se lit comme une demande de cette page, avec les mêmes règles que la fenêtre d'une demande du site : sortie et option, âges des enfants, seuil de groupe, extras (Kradan, lunch box, VIP Set), droit de parc et estimation. Le message doit être le bloc que la page fabrique : il commence par sa ligne de demande (précédée au plus de « Bonjour Anaïs, voici ma demande de réservation. ») et se termine par la référence ; un client qui cite ce message puis écrit autre chose reste un message libre.

Deux mécanismes, dans cet ordre (`lireDuTexte`, `demande-calc.mjs`) :

1. **La demande enregistrée par la page.** La page envoie à Gestion une copie structurée de chaque demande (`demandes_site` : sortie, option, âges, extras, `ref`). Si la référence du texte est celle d'une demande que la personne peut lire (la liste de l'écran, sinon la base par `demandeSiteParRef`, avec les droits de la personne), la demande enregistrée est lue comme celle de la liste « Demandes du site ».
2. **Le texte lui-même** (`carnet-colle.mjs`). Le message anglais `Booking request:` des guides d'Ao Nang et de Koh Lanta se lit par le nom de sa sortie. Le WhatsApp français (`Demande de réservation :`) se lit par son titre français : Koh Samui par `nomPage` (`carnet-produits.mjs`), Ao Nang et Koh Lanta par `carnet-correspondance.mjs`, fichier GÉNÉRÉ par `docs/gestion/regenerer-correspondance-carnet.mjs` à partir des fichiers de données publics des deux pages (`src/carnet/ao-nang-excursions-bateau.11tydata.js`, `src/carnet/koh-lanta-excursions-activites.11tydata.js`) : titre français de chaque offre, sortie et option de Gestion, noms français et anglais des formules, créneaux, choix, options et lignes. Le message est récrit comme la page l'écrit pour Gestion (`buildGestionMessage`). Un test fabrique le récapitulatif de chaque offre avec le code de la page (`src/js/carnet-booking.js`) et vérifie qu'il se récrit exactement comme le message envoyé à Gestion, et qu'un titre français est unique et résolu pour chaque offre ; un autre test échoue si le fichier généré n'est plus celui que le script écrit. À relancer quand une offre ou un libellé d'une de ces pages change.

Sans préfixe de la table, avec un préfixe inconnu, ou avec un titre ou une formule qui ne se reconnaissent par aucun des deux mécanismes, le message reste un message libre : rien n'est deviné. Une demande du site garde son contexte exact (`product_id` et option) : la référence n'y est pas relue.

**Assistant.** La fonction « agent » (`supabase/functions/agent/outils.js`) joint à la carte « dossier » le bloc de la page qu'elle trouve dans l'échange (le message collé, ou le WhatsApp du client lu par l'outil), tel quel, dans `message_page` (un seul bloc, sinon rien : le modèle ne choisit pas entre deux demandes). La fiche de création (`preparationComplete`, `views/agent-valider.mjs`, `carteAvecLaPage`, `assistant-calc.mjs`) lit ce bloc avec la même fonction que la fenêtre de création (`lireDuTexte`) : le service d'excursion de la carte est remplacé par celui de la page, avec les mêmes offres, le même total, les mêmes extras et les mêmes âges ; un transfert ou le service d'une autre entreprise de la carte reste tel quel. Déploiement : la fonction `agent` seule.
