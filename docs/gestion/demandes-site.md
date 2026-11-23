# Demandes du site : contrat entre secrettravelandtour.com et Gestion

Une demande envoyée depuis la feuille de réservation du site (`src/js/booking.js` du dépôt `TheRemless/Secrettravelandtour`) continue d'ouvrir WhatsApp comme aujourd'hui. **En plus**, juste avant d'ouvrir WhatsApp, le site envoie une copie de la demande à Gestion. Elle arrive dans « Demandes du site » de l'entreprise (Secret ou VIP Taxi Lanta) et Anaïs reçoit une notification.

Règle absolue : **cet envoi ne doit jamais empêcher ni retarder l'ouverture de WhatsApp.** Il part sans attendre de réponse, toute erreur est avalée.

## Adresse

```
POST https://lkxqcmzeidlyssoqmqkh.supabase.co/functions/v1/demande-site
```

- Pas de clé, pas de jeton : la fonction est publique (`verify_jwt = false`) et se protège elle-même.
- Origines admises : `https://secrettravelandtour.com`, `https://www.secrettravelandtour.com`, `https://zwaldtravelplanner.com` et `https://www.zwaldtravelplanner.com` (pages privées du carnet, voir « Pages du carnet de ZTP »), `http://localhost:<port>` et `http://127.0.0.1:<port>` pour les essais. Tout autre site reçoit 403. Les deux adresses de ZTP sont écrites dans le code de la fonction (`ORIGINES_CARNET`, `calc.js`) et ne comptent que pour l'organisation Zwald : elles ne passent pas par `SITE_ORIGINES`.
- Autre client du logiciel : le secret `SITE_ORGANISATION` donne son organisation et `SITE_ORIGINES` ses adresses (https, séparées par des virgules). Sans `SITE_ORIGINES`, ce sont celles de secrettravelandtour.com.
- En-tête `Content-Type: text/plain;charset=UTF-8` (le corps reste du JSON). C'est voulu : une requête « simple » n'a pas de requête de contrôle CORS, ce qui rend l'envoi `keepalive` fiable sur iPhone. `application/json` est aussi accepté.
- 4 096 octets au plus.

## Corps (JSON)

Ce que la feuille sait déjà, plus le numéro WhatsApp du visiteur (depuis le 17.11.2026, voir « Numéro WhatsApp et nom complet »). Pas d'e-mail.

```json
{
  "brand": "secret",
  "product_id": "4-islands",
  "product": "4 Islands",
  "option": "join-in-longtail",
  "option_label": "Join-in longtail",
  "date": "2026-11-18",
  "time": "14:30",
  "adults": 2,
  "children": 1,
  "pickup": "Lanta Sand Resort (Klong Dao)",
  "name": "Anna Keller",
  "whatsapp": "+41 79 123 45 67",
  "estimated_total": 3000,
  "currency": "THB",
  "ref": "FOUR-7K3Q",
  "page_url": "https://secrettravelandtour.com/tours/4-islands/",
  "message": "Booking request: 4 Islands – Join-in longtail\nDate: Wed 18 Nov 2026\n…",
  "website": "",
  "turnstile_token": ""
}
```

| Champ | Obligatoire | Format | D'où il vient dans `booking.js` |
|---|---|---|---|
| `brand` | oui | slug d'une entreprise de l'organisation qui publie sur le site (`"secret"` ou `"taxi"` chez Zwald), sinon 400 `invalid` sur `brand`. Depuis une page du carnet de ZTP : `"secret"` seulement (`"taxi"` y reçoit aussi 400 sur `brand`) | `"taxi"` pour les pages VIP Taxi Lanta (`/taxi/…`), `"secret"` partout ailleurs, minivan partagé de `/transfers/` compris |
| `product_id` | oui | `[a-z0-9-]`, 60 caractères au plus | `config.productId` |
| `product` | non | 120 caractères | `config.product` |
| `option` | non | 80 caractères | `state.option` (ou `state.route` pour le speedboat) |
| `option_label` | non | 120 caractères | `findOption(config, state.option).title` |
| `date` | non | `AAAA-MM-JJ`, entre hier et dans 400 jours | `resolveDate(state.dateChoice, state.dateOther, state.today)` ; location : `state.dateFrom` |
| `time` | non | `HH:MM` 24 h | `state.time` (heure de pickup taxi), sinon absent |
| `adults` | non | entier 0 à 60 | `state.adults` |
| `children` | non | entier 0 à 60 | `state.childAges.length` |
| `pickup` | non | 200 caractères | `state.pickup` ou `state.pickupAt` |
| `name` | non | 120 caractères, prénom et nom | `state.name` (nom complet, voir plus bas) |
| `whatsapp` | non pour la fonction, obligatoire dans la feuille | numéro international, voir plus bas | le nouveau champ « WhatsApp number » de la feuille |
| `whatsapp_country` | non | indicatif du pays, 1 à 3 chiffres (`"41"`, `"+41"` accepté) | seulement si la feuille a un choix du pays séparé du numéro |
| `estimated_total` | non | nombre 0 à 10 000 000 | `trackInfo(config, state).value` (absent s'il n'y a pas de prix) |
| `currency` | non | 3 lettres, `THB` par défaut | `"THB"` |
| `ref` | non | `[A-Z0-9-]`, 3 à 24 caractères | la référence ajoutée au message WhatsApp (voir plus bas) |
| `page_url` | non | adresse du site | `location.href` (une adresse hors du site est ignorée) |
| `message` | non | 2 000 caractères | le texte exact envoyé à WhatsApp (`message` après `buildMessage`) |
| `website` | non | doit rester vide | champ piège caché de la feuille (voir plus bas) |
| `turnstile_token` | non | texte | jeton Cloudflare Turnstile, quand Jérémy l'aura allumé |

Gestion se sert surtout de `message` : c'est le texte que la fiche de création (ancien « Coller une demande ») sait déjà lire (mêmes tests, `tests/fixtures/messages-site.json`). Les autres champs servent à la carte, à la notification et aux chiffres. Un champ inconnu est ignoré.

## Pages du carnet de ZTP (22.11.2026)

Les pages privées `https://zwaldtravelplanner.com/carnet/<sujet>-<code>/` (guides que les clients d'Anaïs ouvrent depuis leur carnet) laissent le client réserver une sortie directement. La demande arrive dans « Demandes du site » de **Secret** (`brand: "secret"`, jamais `"taxi"`), avec la source « Carnet ZTP » reconnue à `page_url` (chemin `/carnet/…`). Ces pages ne nomment ni ne lient jamais Secret ni VIP Taxi Lanta : le mot Secret ne figure dans aucun texte destiné au client. Après l'envoi, la page ouvre WhatsApp avec le message prérempli, comme le site Secret ; la copie vers Gestion ne doit jamais l'empêcher ni le retarder (même appel `sendCopy`, même règle).

Nani valide d'abord la demande avec le partenaire, en dehors de l'outil. La demande reste « à traiter » tant qu'elle n'a pas créé le dossier (bouton « Créer le dossier »), aucun message ni aucune étape ne part vers le prestataire.

### Corps envoyé par une page du carnet

```json
{
  "brand": "secret",
  "product_id": "pig-island-longtail-prive-4h",
  "product": "Pig Island and Koh Tan by private longtail, 4 hours",
  "option": "standard",
  "option_label": "Whole boat",
  "date": "2026-12-20",
  "adults": 2,
  "children": 2,
  "pickup": "Hotel Example, Chaweng",
  "name": "Anna Keller",
  "whatsapp": "+41 79 123 45 67",
  "estimated_total": 4500,
  "currency": "THB",
  "page_url": "https://zwaldtravelplanner.com/carnet/koh-samui-excursions-bateau-<code>/",
  "message": "Booking request: Pig Island and Koh Tan by private longtail, 4 hours – Whole boat\nDate: Sun 20 Dec 2026\nGuests: 2 adults, 2 children (ages 5 and 9)\nPickup: Hotel Example, Chaweng\nName: Anna Keller\nEstimated total: 4,500 THB",
  "website": ""
}
```

- Le code d'accès de la page : la page envoie son adresse complète, la fonction retire le code avant d'écrire (`…/carnet/<guide>-<code>/` devient `…/carnet/<guide>/`, ni requête ni ancre), aussi dans le `message` : la base, les fiches, les notifications et les messages ne contiennent jamais l'adresse qui ouvre la page privée.
- Contrôles propres à ces origines (la fonction les fait elle-même) : `page_url` est obligatoire, doit être une page `/carnet/…` de l'origine même de la requête (`zwaldtravelplanner.com` ou `www.`, pas l'autre ni le site Secret), sinon 400 sur `page_url` ; `brand` doit être `"secret"`, sinon 400 sur `brand`. Pour toute origine, `page_url` n'est gardée que si elle est sur l'origine de la requête (www et sans www sont un même site) (sinon la demande passe sans page). Une demande n'est « du carnet » (étiquette « Carnet ZTP », notification, tarif de la sortie du carnet, bouton « Créer le dossier ») que si sa page est sur `zwaldtravelplanner.com` ou `www.` ET sous `/carnet/` : une page `/carnet/…` du site Secret n'en est pas une.
- `ref` : `SAM-` suivi de 4 caractères (même forme que les autres, `[A-Z0-9-]{3,24}`). Aucun préfixe n'est à déclarer : Gestion ne lit pas la référence, il la montre en grand pour retrouver la conversation WhatsApp, et relie un message WhatsApp à une demande par le numéro de téléphone (migration 72), jamais par la référence. Il n'y a donc pas de dédoublonnage par `ref` : un second envoi crée une seconde demande, à classer.
- `product_id` : l'identifiant d'une sortie de `src/gestion/js/carnet-produits.mjs` (`id`). `option` : l'identifiant de l'option cochée (`options[].id`), `option_label` son titre (`options[].titre`). Une sortie à une seule option envoie `standard`.
- Gestion retrouve le tarif par `product_id` et l'option, puis par le nombre de personnes pour un bateau privé (tranche « 1 to 3 people »…). Un enfant de moins de 4 ans ne compte pas dans le groupe.
- `message` suit le format du site Secret : première ligne `Booking request: <product> – <option_label>`, puis `Date:`, `Guests:` (avec les âges : `2 adults, 2 children (ages 5 and 9)`), `Pickup:` (l'hôtel), `Name:`, `Estimated total:`. La fonction ne garde pas les âges des enfants : ils se lisent dans ce message.
- Le total estimé est en THB et **sans les droits d'entrée** (à payer sur place, dits dans la fiche de la sortie).
- Chaque sortie dit l'âge d'un enfant selon son partenaire : un âge hors barème n'est pas refusé, Gestion le signale au moment de créer le dossier.
- Essai : `curl -X POST … -H "Origin: https://zwaldtravelplanner.com"` crée une vraie demande dans Secret : ne le faire que contre une base d'essai, puis « Classer » la demande.

### Guides d'Ao Nang et de Koh Lanta (23.11.2026)

Deux guides de plus, même contrat : les identifiants à envoyer (sorties d'Ao Nang `aonang-…`, options `aonang-option-lunch-box` et `aonang-option-vip-set`, sorties du site Secret pour Koh Lanta) et les barèmes d'âge sont dans `carnet-aonang-lanta.md`. Pour Koh Lanta, `product_id` et `option` sont ceux du site Secret : une demande venue d'une page du carnet les résout comme une demande du site, par identifiant, jamais par le nom.

## Numéro WhatsApp et nom complet (17.11.2026)

Des visiteurs remplissent la feuille mais leur message WhatsApp n'arrive jamais. La feuille demande donc le numéro WhatsApp et le nom complet : Anaïs peut écrire au client depuis Gestion même quand son message manque.

### Ce que le site envoie

- `name` : prénom et nom dans un seul texte, `"Anna Keller"`. 120 caractères au plus (`maxlength="120"` sur le champ). Au-delà, toute la demande est refusée (400, `field: "name"`).
- `whatsapp` : le numéro **au format international**, de préférence déjà en E.164 (`"+41791234567"`). La fonction accepte aussi les espaces, tirets, points, parenthèses, le `00` devant (`"0041 79 123 45 67"`) et le `(0)` des numéros écrits `"+41 (0)79 123 45 67"`.
- `whatsapp_country` : seulement si la feuille a un menu du pays à côté d'un numéro national. La fonction retire alors le 0 de tête (sauf pour l'Italie, `39`) et met l'indicatif devant : `whatsapp: "079 123 45 67"` avec `whatsapp_country: "41"` donne `+41791234567`.

Exemples ramenés à `+41791234567` : `"+41 79 123 45 67"`, `"0041-79-123-45-67"`, `"+41 (0)79 123 45 67"`, `"079 123 45 67"` avec `"41"`. Un numéro national sans indicatif (`"079 123 45 67"` seul) n'est pas deviné.

### Ce que fait la fonction

- Numéro lisible : gardé en E.164 dans `demandes_site.telephone` (`+`, puis 8 à 15 chiffres).
- Numéro illisible (indicatif manquant, lettres, trop court ou trop long) : la demande est **quand même écrite**, sans numéro, et ce que le visiteur a tapé est gardé à part (40 caractères au plus). Gestion affiche « Numéro à vérifier : … ».
- Pas de numéro (page du site encore en cache, ancienne feuille) : la demande passe comme avant. Gestion affiche « Pas de numéro WhatsApp ».
- Le numéro n'est écrit nulle part ailleurs que dans la table : ni dans les journaux de la fonction, ni dans la notification (elle passe par Apple et Google), ni dans le journal de Gestion.

**Pourquoi la fonction ne refuse jamais une demande pour le numéro.** La copie vers Gestion sert justement de filet quand le message WhatsApp n'arrive pas. Le site ne lit pas la réponse de la fonction : un refus ne ferait rien voir au visiteur, il ferait seulement perdre la demande une seconde fois. Le champ est donc **obligatoire dans la feuille** (`required`, vérifié avant l'ouverture de WhatsApp) et **facultatif dans la fonction**. Une date limite ou un numéro de version de la feuille ne changerait rien pour le visiteur et ferait perdre les demandes des pages en cache.

### Ordre de mise en production

1. Migration 41 dans Supabase.
2. Fonction `demande-site` redéployée.
3. Seulement ensuite, la nouvelle feuille sur le site.

L'ancienne fonction ignore un champ qu'elle ne connaît pas, elle ne le refuse pas (voir `lireDemande`) : une nouvelle feuille publiée trop tôt ne casserait rien, mais les numéros envoyés avant l'étape 2 seraient perdus.

### Feuille : champ conseillé

```html
<label for="bk-whatsapp">WhatsApp number</label>
<input id="bk-whatsapp" name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" required maxlength="24"
       placeholder="+41 79 123 45 67">
<p class="hint">With country code, the number you use on WhatsApp.</p>
```

Avant d'ouvrir WhatsApp, la feuille vérifie qu'il commence par `+` ou `00` et compte 8 à 15 chiffres (`value.replace(/\D/g, "").length`), sinon elle affiche « Add your country code, e.g. +41 ». Pas d'attribut `pattern` : avec les caractères `( ) -` il n'est pas lu de la même façon par tous les navigateurs.

Le numéro ne va pas dans le message WhatsApp : il vient déjà du téléphone du visiteur.

## Réponses

Le site n'a rien à en faire : il ne les lit pas. Elles servent aux essais.

| Statut | Corps | Quand |
|---|---|---|
| 202 | `{"ok":true}` | demande écrite (ou champ piège rempli : rien n'est écrit, la réponse est la même) |
| 400 | `{"ok":false,"error":"invalid","field":"date"}` | un champ est faux (`field` dit lequel) |
| 403 | `{"ok":false,"error":"origin"}` | origine absente ou hors du site |
| 403 | `{"ok":false,"error":"turnstile"}` | jeton Turnstile refusé (seulement une fois Turnstile allumé) |
| 405 | `{"ok":false,"error":"method"}` | autre chose que POST |
| 413 | `{"ok":false,"error":"too_large"}` | plus de 4 096 octets |
| 415 | `{"ok":false,"error":"content_type"}` | ni `text/plain` ni `application/json` |
| 429 | `{"ok":false,"error":"rate_limited"}` | plus de 5 demandes en 10 minutes depuis le même appareil, ou plus de 300 en une heure pour les entreprises de l’organisation (le site d’un autre client ne compte pas) |
| 500 | `{"ok":false,"error":"server"}` | panne de la base |

## Appel depuis `booking.js`

À placer dans le gestionnaire `submit` de la feuille, **après** `message = buildMessage(config, state)` et **avant** `window.open(url, "_blank")`. L'appel ne consomme pas le geste du visiteur : `window.open` reste autorisé juste après.

```js
// Copie de la demande pour Gestion (outil d'Anaïs). Envoyée sans attendre, avant d'ouvrir WhatsApp.
// Elle ne doit JAMAIS empêcher WhatsApp de s'ouvrir : tout est dans un try, l'erreur est avalée.
var GESTION_DEMANDE = "https://lkxqcmzeidlyssoqmqkh.supabase.co/functions/v1/demande-site";
function sendCopy(config, state, message, ref) {
  try {
    var option = findOption(config, state.option);
    var info = trackInfo(config, state);
    var honeypot = form.querySelector('[name="website"]');
    var body = JSON.stringify({
      brand: /VIP Taxi/i.test(config.brand || "") ? "taxi" : "secret",
      product_id: config.productId || "",
      product: config.product || "",
      option: state.option || state.route || "",
      option_label: option ? option.title : "",
      date: config.variant === "rental" ? state.dateFrom || "" : resolveDate(state.dateChoice, state.dateOther, state.today) || "",
      time: /^\d{2}:\d{2}$/.test(clean(state.time)) ? clean(state.time) : "",
      adults: state.adults || 0,
      children: (state.childAges || []).length,
      pickup: clean(state.pickup || state.pickupAt || ""),
      name: clean(state.name),
      whatsapp: clean(state.whatsapp || ""),
      estimated_total: typeof info.value === "number" ? info.value : null,
      currency: "THB",
      ref: ref || "",
      page_url: location.href.split("#")[0],
      message: message,
      website: honeypot ? honeypot.value : ""
    });
    if (window.fetch) {
      fetch(GESTION_DEMANDE, { method: "POST", body: body, keepalive: true, mode: "cors", credentials: "omit", headers: { "Content-Type": "text/plain;charset=UTF-8" } }).catch(function () {});
    } else if (navigator.sendBeacon) {
      navigator.sendBeacon(GESTION_DEMANDE, new Blob([body], { type: "text/plain;charset=UTF-8" }));
    }
  } catch (e) { /* jamais bloquant */ }
}
```

Dans le `submit` :

```js
message = buildMessage(config, state);
var ref = makeRef(config);          // voir « Référence » ci-dessous
message += "\nRef: " + ref;         // seulement si Jérémy valide la ligne Ref (voir plus bas)
sendCopy(config, state, message, ref);
var url = waUrl(message, config.whatsapp);
// … puis window.open(url, "_blank") comme aujourd'hui
```

## Référence WhatsApp : décision à prendre par Jérémy

La boîte de Gestion affiche la référence en grand pour qu'Anaïs retrouve la bonne conversation WhatsApp (le site ne donne pas le numéro du client). **Aujourd'hui le message du site ne contient aucune référence** : Jérémy l'a retirée le 10.11.2026 (« ni référence ni page »), alors que `refPrefix` existe toujours dans les fiches produit.

Deux possibilités :

1. **Remettre une ligne `Ref:` à la fin du message** (recommandé). Exemple : `Ref: FOUR-7K3Q`. Préfixe = `refPrefix` du produit (`FOUR`, `DIVE`, `ROK`…), `STT` quand le produit n'en a pas, `VIP` pour les trajets de VIP Taxi Lanta ; puis 4 caractères tirés au hasard dans `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sans O, 0, I, 1 qui se confondent).

   ```js
   function makeRef(config) {
     var abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = "";
     var n = new Uint32Array(4);
     (window.crypto || window.msCrypto).getRandomValues(n);
     for (var i = 0; i < 4; i++) s += abc[n[i] % abc.length];
     var prefix = config.refPrefix || (/VIP Taxi/i.test(config.brand || "") ? "VIP" : "STT");
     return prefix + "-" + s;
   }
   ```

   Gestion ignore déjà la ligne `Ref:` quand on colle le message (elle n'est lue par aucune règle de `demande-calc.mjs`).

2. **Pas de référence.** Envoyer `ref` vide. Gestion affiche alors « Sans référence : message de Anna Keller, il y a 12 min » : Anaïs retrouve la conversation par le nom et l'heure.

## Champ piège

Ajouter dans la feuille un champ invisible pour un humain, que les robots remplissent :

```html
<div class="hp" aria-hidden="true">
  <label for="bk-website">Website</label>
  <input id="bk-website" name="website" type="text" tabindex="-1" autocomplete="off">
</div>
```

```css
.hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
```

Ne pas utiliser `display: none` (certains robots l'ignorent). Le champ ne passe pas dans le message WhatsApp.

## Cloudflare Turnstile (plus tard)

Prêt côté Gestion, éteint tant que Jérémy n'a pas donné de clé :

1. Jérémy crée un widget Turnstile pour `secrettravelandtour.com` (mode « Invisible » ou « Managed ») et obtient une clé de site et une clé secrète.
2. Clé secrète posée dans Supabase : `supabase secrets set TURNSTILE_SECRET=… --project-ref lkxqcmzeidlyssoqmqkh`. Dès ce moment, un jeton envoyé est vérifié ; une demande **sans** jeton passe encore.
3. Le site charge le widget (`https://challenges.cloudflare.com/turnstile/v0/api.js`) et envoie `turnstile_token`.
4. Quand tout marche, `supabase secrets set TURNSTILE_OBLIGATOIRE=1` rend le jeton obligatoire.

Le widget ne doit pas retarder WhatsApp : si le jeton n'est pas prêt au moment de l'envoi, envoyer sans jeton (tant que `TURNSTILE_OBLIGATOIRE` n'est pas à 1).

## Données personnelles

Le nom, le numéro WhatsApp, l'hôtel et le message du client sont gardés dans la base de Gestion, lisibles seulement par les rôles qui voient tous les dossiers de l'entreprise. L'adresse IP n'est jamais gardée (seulement une empreinte salée pour la limite de cadence). La politique de confidentialité du site (`/privacy/`) doit dire que la demande est aussi enregistrée dans l'outil de réservation de l'agence : à mettre à jour en même temps que `booking.js`.

## Essai

```bash
curl -i -X POST https://lkxqcmzeidlyssoqmqkh.supabase.co/functions/v1/demande-site \
  -H "Origin: http://localhost:8080" -H "Content-Type: text/plain;charset=UTF-8" \
  --data '{"brand":"secret","product_id":"4-islands","product":"4 Islands","date":"2026-12-01","adults":2,"name":"Test Essai","whatsapp":"+66 81 234 5678","ref":"TEST-0001"}'
```

Puis « Classer » la demande d'essai dans Gestion (elle sort des chiffres).
