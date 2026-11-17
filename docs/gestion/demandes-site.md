# Demandes du site : contrat entre secrettravelandtour.com et Gestion

Une demande envoyée depuis la feuille de réservation du site (`src/js/booking.js` du dépôt `TheRemless/Secrettravelandtour`) continue d'ouvrir WhatsApp comme aujourd'hui. **En plus**, juste avant d'ouvrir WhatsApp, le site envoie une copie de la demande à Gestion. Elle arrive dans « Demandes du site » de l'entreprise (Secret ou VIP Taxi Lanta) et Anaïs reçoit une notification.

Règle absolue : **cet envoi ne doit jamais empêcher ni retarder l'ouverture de WhatsApp.** Il part sans attendre de réponse, toute erreur est avalée.

## Adresse

```
POST https://lkxqcmzeidlyssoqmqkh.supabase.co/functions/v1/demande-site
```

- Pas de clé, pas de jeton : la fonction est publique (`verify_jwt = false`) et se protège elle-même.
- Origines admises : `https://secrettravelandtour.com`, `https://www.secrettravelandtour.com`, `http://localhost:<port>` et `http://127.0.0.1:<port>` pour les essais. Tout autre site reçoit 403.
- Autre client du logiciel : le secret `SITE_ORGANISATION` donne son organisation et `SITE_ORIGINES` ses adresses (https, séparées par des virgules). Sans `SITE_ORIGINES`, ce sont celles de secrettravelandtour.com.
- En-tête `Content-Type: text/plain;charset=UTF-8` (le corps reste du JSON). C'est voulu : une requête « simple » n'a pas de requête de contrôle CORS, ce qui rend l'envoi `keepalive` fiable sur iPhone. `application/json` est aussi accepté.
- 4 096 octets au plus.

## Corps (JSON)

Uniquement ce que la feuille sait déjà. Aucun champ nouveau à demander au visiteur (pas de téléphone, pas d'e-mail).

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
| `brand` | oui | slug d'une entreprise de l'organisation qui publie sur le site (`"secret"` ou `"taxi"` chez Zwald), sinon 400 `invalid` sur `brand` | `"taxi"` pour les pages VIP Taxi Lanta (`/taxi/…`), `"secret"` partout ailleurs, minivan partagé de `/transfers/` compris |
| `product_id` | oui | `[a-z0-9-]`, 60 caractères au plus | `config.productId` |
| `product` | non | 120 caractères | `config.product` |
| `option` | non | 80 caractères | `state.option` (ou `state.route` pour le speedboat) |
| `option_label` | non | 120 caractères | `findOption(config, state.option).title` |
| `date` | non | `AAAA-MM-JJ`, entre hier et dans 400 jours | `resolveDate(state.dateChoice, state.dateOther, state.today)` ; location : `state.dateFrom` |
| `time` | non | `HH:MM` 24 h | `state.time` (heure de pickup taxi), sinon absent |
| `adults` | non | entier 0 à 60 | `state.adults` |
| `children` | non | entier 0 à 60 | `state.childAges.length` |
| `pickup` | non | 200 caractères | `state.pickup` ou `state.pickupAt` |
| `name` | non | 100 caractères | `state.name` |
| `estimated_total` | non | nombre 0 à 10 000 000 | `trackInfo(config, state).value` (absent s'il n'y a pas de prix) |
| `currency` | non | 3 lettres, `THB` par défaut | `"THB"` |
| `ref` | non | `[A-Z0-9-]`, 3 à 24 caractères | la référence ajoutée au message WhatsApp (voir plus bas) |
| `page_url` | non | adresse du site | `location.href` (une adresse hors du site est ignorée) |
| `message` | non | 2 000 caractères | le texte exact envoyé à WhatsApp (`message` après `buildMessage`) |
| `website` | non | doit rester vide | champ piège caché de la feuille (voir plus bas) |
| `turnstile_token` | non | texte | jeton Cloudflare Turnstile, quand Jérémy l'aura allumé |

Gestion se sert surtout de `message` : c'est le texte que « Coller une demande » sait déjà lire (mêmes tests, `tests/fixtures/messages-site.json`). Les autres champs servent à la carte, à la notification et aux chiffres. Un champ inconnu est ignoré.

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
| 429 | `{"ok":false,"error":"rate_limited"}` | plus de 5 demandes en 10 minutes depuis le même appareil, ou plus de 300 en une heure sur tout le site |
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

Le nom, l'hôtel et le message du client sont gardés dans la base de Gestion, lisibles seulement par les rôles qui voient tous les dossiers de l'entreprise. L'adresse IP n'est jamais gardée (seulement une empreinte salée pour la limite de cadence). La politique de confidentialité du site (`/privacy/`) doit dire que la demande est aussi enregistrée dans l'outil de réservation de l'agence : à mettre à jour en même temps que `booking.js`.

## Essai

```bash
curl -i -X POST https://lkxqcmzeidlyssoqmqkh.supabase.co/functions/v1/demande-site \
  -H "Origin: http://localhost:8080" -H "Content-Type: text/plain;charset=UTF-8" \
  --data '{"brand":"secret","product_id":"4-islands","product":"4 Islands","date":"2026-12-01","adults":2,"name":"Test","ref":"TEST-0001"}'
```

Puis « Classer » la demande d'essai dans Gestion (elle sort des chiffres).
