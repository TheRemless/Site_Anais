# Bandeau du site : contrat entre Gestion et secrettravelandtour.com

Anaïs allume un bandeau d'information depuis Gestion (« Bandeau du site ») : mer agitée, sortie fermée pour la saison, nouveauté, perturbation. Le texte anglais vient d'un modèle, elle ne l'écrit pas. Le site lit les bandeaux en ligne et en affiche **un seul par page**, juste sous l'en-tête.

Rien n'est publié sur le site tant que ce document n'est pas mis en œuvre dans le dépôt `TheRemless/Secrettravelandtour`.

## Adresse

```
GET https://lkxqcmzeidlyssoqmqkh.supabase.co/functions/v1/bandeau-site
```

- Publique, sans clé. `Access-Control-Allow-Origin: *` (aucune donnée privée).
- `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=300` : « Éteindre » dans Gestion se voit sur le site en une minute environ.
- En cas de panne, la fonction répond 200 avec une liste vide : le site n'affiche simplement rien.

## Réponse

```json
{
  "version": 1,
  "generated_at": "2026-11-16T05:00:00.000Z",
  "banners": [
    {
      "id": "9b1c…",
      "brands": ["secret"],
      "type": "season",
      "text": "Sunset dinner raft does not run until 15 January 2027.",
      "link": { "kind": "page", "href": "/tours/sunset-dinner-raft/", "label": "See Sunset dinner raft" },
      "target": { "kind": "products", "products": ["sunset-dinner-raft"] },
      "closable": true,
      "priority": 2,
      "starts_at": "2026-11-15T23:00:00.000Z",
      "ends_at": "2027-01-14T17:00:00.000Z",
      "card_label": "From 15 Jan"
    }
  ]
}
```

| Champ | Valeurs |
|---|---|
| `brands` | `["secret"]`, `["taxi"]` ou `["secret","taxi"]`. `taxi` = les pages VIP Taxi Lanta (`/taxi/…`), `secret` = toutes les autres |
| `type` | `info`, `sea`, `season`, `new`, `urgent` (voir les styles) |
| `text` | anglais, 600 caractères au plus (140 jusqu'à la migration 126 du 24.11.2026), déjà prêt : l'afficher tel quel (texte, jamais HTML). Peut contenir des retours à la ligne (`\n`, deux de suite au plus), à garder à l'écran. Au-delà de 140 caractères ou avec un retour à la ligne, le site le replie (voir « Texte long ») |
| `link` | `null`, `{ "kind": "page", "href": "/chemin/", "label": "…" }` (toujours un chemin du site) ou `{ "kind": "whatsapp", "label": "Ask on WhatsApp", "text": "…" }` (le site construit le lien `wa.me` avec son propre numéro et ce texte ; pour un texte long, `text` ne reprend que sa première ligne, coupée à 140 caractères avec « … ») |
| `target` | `{ "kind": "all" }`, `{ "kind": "sections", "sections": [...] }` ou `{ "kind": "products", "products": [slug...] }` |
| `sections` | `islands` (fiches `tours/`, gabarit `boat`), `activities` (fiches `activities/`), `transfers` (`/transfers/`, `/tours/speedboat/`), `rental` (`/tours/rental/`), `taxi` (fiches `taxi/`, hub `/taxi/`) |
| `closable` | le visiteur peut le fermer (croix) ; fermé = plus affiché pour ce visiteur |
| `priority` | 1 haute, 2 normale, 3 basse |
| `starts_at`, `ends_at` | ISO UTC ; `ends_at` peut être `null`. La fonction ne renvoie que les bandeaux en ligne, mais le site revérifie (la réponse est en cache) |
| `card_label` | étiquette courte (24 caractères au plus) pour la carte des sorties visées, seulement pour `sea` et `season` visant des produits, sinon `null` |

Les bandeaux arrivent déjà triés du plus important au moins important.

## Un seul bandeau par page

Règle de référence (copie exacte de `choisirBandeau` dans `supabase/functions/bandeau-site/calc.js`, testée) :

```js
var ORDER = { urgent: 0, sea: 1, season: 2, new: 3, info: 4 };
function pickBanner(banners, page, now, closed) {
  // page = { brand: "secret" | "taxi", section: "islands" | … | null, product: "4-islands" | null }
  return banners.filter(function (b) {
    var t = b.target, hit = t.kind === "all" ||
      (t.kind === "sections" && page.section && t.sections.indexOf(page.section) > -1) ||
      (t.kind === "products" && page.product && t.products.indexOf(page.product) > -1);
    return b.brands.indexOf(page.brand) > -1 && hit &&
      Date.parse(b.starts_at) <= now && (!b.ends_at || Date.parse(b.ends_at) > now) &&
      !(b.closable && closed.indexOf(b.id) > -1);
  }).sort(function (a, b) {
    return a.priority - b.priority || ORDER[a.type] - ORDER[b.type] ||
      Date.parse(b.starts_at) - Date.parse(a.starts_at) || (a.id < b.id ? -1 : 1);
  })[0] || null;
}
```

La page donne sa marque, sa section et son produit, par exemple sur `<body>` : `data-brand="secret" data-section="islands" data-product="4-islands"`. L'accueil et les hubs n'ont pas de produit. Les fiches produit savent leur section par leur dossier (`src/_data/products/README.md`).

## HTML attendu

Juste après l'en-tête du site, avant le contenu. Un bandeau, jamais plus.

```html
<aside class="site-notice site-notice--sea" role="region" aria-label="Notice" data-notice-id="9b1c…" lang="en">
  <div class="site-notice__inner">
    <svg class="site-notice__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">…</svg>
    <p class="site-notice__text">Rough sea today: island trips are moved to tomorrow. <a class="site-notice__link" href="/tours/4-islands/">See 4 Islands</a></p>
    <button class="site-notice__close" type="button" aria-label="Close this notice">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>
</aside>
```

- `urgent` : `role="alert"` au lieu de `role="region"`.
- Pas de bouton de fermeture si `closable` vaut `false`.
- Icônes (traits de 1,8 px, 24 × 24) : `info` cercle et « i », `sea` trois vagues, `season` calendrier, `new` étoile, `urgent` triangle. Les tracés sont dans `src/gestion/js/views/bandeau-site.mjs` (`ICONES`), à recopier.
- Lien WhatsApp : `https://wa.me/<numéro du site>?text=` + `encodeURIComponent(link.text)`, ouvert dans un nouvel onglet.

## CSS attendu

Couleurs relevées dans `src/css/tokens.css` (Secret) et `src/css/vip-taxi.css` (« Laque et or »). Seul ajout : l'ambre de l'alerte mer côté Secret (`#F7D58B`). Aplats seulement : ni dégradé, ni ombre, ni bordure colorée sur un côté. Tous les couples texte/fond dépassent 4,5:1.

```css
.site-notice { --n-bg: var(--sand); --n-ink: var(--ink); --n-icon: currentColor; --n-rule: var(--line);
  background: var(--n-bg); color: var(--n-ink); border-bottom: 1px solid var(--n-rule); }
.site-notice__inner { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 10px;
  max-width: var(--container); margin: 0 auto; padding: 10px var(--gutter); }
.site-notice__icon { color: var(--n-icon); margin-top: 2px; }
.site-notice__text { margin: 0; font: 600 15px/1.45 var(--sans); }
.site-notice__link { color: inherit; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
.site-notice__close { width: 44px; height: 44px; margin: -12px -12px -12px 0; display: inline-flex; align-items: center; justify-content: center;
  background: none; border: 0; color: inherit; cursor: pointer; }
.site-notice__close:focus-visible, .site-notice__link:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }

/* Secret Travel & Tour */
.site-notice--sea     { --n-bg: #F7D58B; --n-ink: var(--ink);  --n-rule: #E6BC5C; }
.site-notice--season  { --n-bg: var(--on-dark-mute); --n-ink: var(--deep); --n-rule: #9FB8B2; }
.site-notice--new     { --n-bg: var(--sea);   --n-ink: var(--white); --n-rule: var(--sea); }
.site-notice--urgent  { --n-bg: var(--ink);   --n-ink: var(--white); --n-icon: #F7D58B; --n-rule: var(--ink); }

/* VIP Taxi Lanta, à charger avec vip-taxi.css (ses variables : --paper, --lac, --gold…) */
.vip .site-notice__text { font-family: var(--text); font-weight: 500; }
.vip .site-notice--info   { --n-bg: var(--paper-2); --n-ink: var(--ink);  --n-rule: var(--rule); }
.vip .site-notice--sea    { --n-bg: var(--gold);    --n-ink: var(--lac);  --n-rule: var(--gold-line); }
.vip .site-notice--season { --n-bg: var(--bronze);  --n-ink: var(--ivory); --n-rule: var(--bronze); }
.vip .site-notice--new    { --n-bg: var(--white);   --n-ink: var(--lac);  --n-icon: var(--bronze); --n-rule: var(--gold-line); }
.vip .site-notice--urgent { --n-bg: var(--lac);     --n-ink: var(--white); --n-icon: var(--gold); --n-rule: var(--lac); }
```

(`.vip` = la classe ou l'attribut que porte déjà la page VIP Taxi Lanta ; adapter au sélecteur réel.)

Lisible à 375 px : le texte passe à la ligne, le lien suit le texte, la croix reste à droite dans une zone de 44 px. L'aperçu de Gestion montre ce rendu dans les deux marques.

## Texte long (migration 126, 24.11.2026)

Un texte de 140 caractères au plus, sans retour à la ligne, garde exactement le rendu ci-dessus. Au-delà, ou avec un retour à la ligne :

- les longueurs se comptent en **caractères visibles, en points de code** (un emoji = 1, comme `length()` de Postgres) : Gestion, la base et le site comptent de la même façon ;
- le texte est replié sur **deux lignes**, à toutes les largeurs, coupé après un mot entier avec « … » collé au mot (jamais au milieu d'un nombre) ; sur mobile le bandeau ne dépasse jamais deux lignes de texte et une ligne de boutons (90 px environ, contre 130 px pour un texte de 140 caractères en un bloc) ;
- dessous, une ligne avec le bouton **More** (puis **Less**) et le lien, qui reste ainsi visible replié ; le bouton n'apparaît que si le texte dépasse vraiment deux lignes (mesuré à l'affichage, à chaque changement de largeur et quand la police arrive) ;
- `aria-expanded` et `aria-controls` sur le bouton, Entrée et Espace l'ouvrent, Échap referme et rend le focus au bouton, zone de toucher de 44 px ;
- ouvert, le bandeau montre tout le texte (au plus la hauteur de l'écran moins l'en-tête, le texte défile alors dans le bandeau) ; jamais de texte qui défile tout seul, aucune animation ;
- retours à la ligne gardés (`white-space: pre-line`), mots très longs coupés (`overflow-wrap: anywhere`) : aucun défilement horizontal.

```html
<aside class="site-notice site-notice--info site-notice--long" role="region" aria-label="Notice" data-notice-id="9b1c…" lang="en">
  <div class="site-notice__inner">
    <svg class="site-notice__icon" …></svg>
    <div class="site-notice__body">
      <p class="site-notice__text" id="site-notice-text-9b1c…">Christmas week
Transfers run as usual…</p>
      <div class="site-notice__actions">
        <button class="site-notice__more" type="button" aria-expanded="false" aria-controls="site-notice-text-9b1c…">More</button>
        <a class="site-notice__link" href="/tours/">See all trips</a>
      </div>
    </div>
    <button class="site-notice__close" type="button" aria-label="Close this notice">…</button>
  </div>
</aside>
```

```css
.site-notice--long .site-notice__body { min-width: 0; max-width: 80ch; }
.site-notice--long .site-notice__text { white-space: pre-line; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
.site-notice--long.is-open .site-notice__text { display: block; -webkit-line-clamp: none; line-clamp: none; overflow-y: auto; max-height: calc(100dvh - var(--hd, 0px) - 120px); }
.site-notice__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0 24px; margin-top: 4px; }
/* Bouton et lien de la hauteur d'une ligne, zone de toucher de 44 px par ::before. */
.site-notice__more::before, .site-notice__actions .site-notice__link::before { content: ""; position: absolute; top: 50%; left: 50%; width: max(100% + 16px, 44px); height: 44px; transform: translate(-50%, -50%); }
```

**Hauteur réservée.** Le bandeau du haut reste en position fixe sous l'en-tête, mais sa hauteur est mise dans `--notice-h` (ResizeObserver : affichage, dépli, repli, fermeture) et s'ajoute au `padding-top` du corps, à `scroll-padding-top` et aux `scroll-margin-top` et `top` collants : il ne recouvre plus le titre de la page (défaut corrigé aussi pour les textes courts). La hauteur repliée est gardée par contexte de page (`stt-notice-h:<marque>:<section>:<produit>`, avec la largeur) et posée par un petit script dans le `<head>` avant l'affichage : aucun saut dès la deuxième page vue. À la toute première page d'une visite, la hauteur n'est connue qu'à l'arrivée de la réponse.

Une première ligne courte suivie d'un retour à la ligne sert de titre replié (« Christmas week », puis le détail) : pas de champ titre à part.

Mise en ligne : la base (migration 126) d'abord, puis le site qui sait replier, puis Gestion. Tant que le site n'est pas à jour, il coupe tout texte à 140 caractères.

## Script attendu

```js
// Bandeau d'information géré depuis Gestion. Ne bloque rien : en cas d'erreur, pas de bandeau.
(function () {
  var URL = "https://lkxqcmzeidlyssoqmqkh.supabase.co/functions/v1/bandeau-site";
  var KEY = "stt-notice-v1", CLOSED = "stt-notice-closed";
  var page = { brand: document.body.dataset.brand || "secret", section: document.body.dataset.section || null, product: document.body.dataset.product || null };
  var read = function (k, d) { try { return JSON.parse(sessionStorage.getItem(k) || localStorage.getItem(k)) || d; } catch (e) { return d; } };
  var closed = read(CLOSED, []);
  function show(data) {
    var b = pickBanner((data && data.banners) || [], page, Date.now(), closed);
    var old = document.querySelector(".site-notice");
    if (old && (!b || old.dataset.noticeId !== b.id)) old.remove();
    if (!b || old && old.dataset.noticeId === b.id) return;
    // … construire le HTML ci-dessus avec textContent (jamais innerHTML pour b.text, link.label, card_label) et l'insérer après l'en-tête
  }
  show(read(KEY, null));             // copie de la page précédente : affichée tout de suite, sans saut
  fetch(URL, { credentials: "omit" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (!data) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    show(data);
  }).catch(function () {});
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".site-notice__close");
    if (!btn) return;
    var box = btn.closest(".site-notice");
    closed = closed.concat(box.dataset.noticeId).slice(-20);
    try { localStorage.setItem(CLOSED, JSON.stringify(closed)); } catch (e2) {}
    box.remove();
  });
})();
```

Saut de mise en page : à la première page vue, le bandeau arrive après le chargement et pousse le contenu (CLS). La copie de `sessionStorage` l'évite dès la deuxième page. Pour la première, insérer le bandeau au-dessus de l'en-tête plutôt qu'au milieu de la page limite le déplacement ; à mesurer avec Lighthouse mobile, critère du site : CLS < 0,05.

Statistiques : si GA4 est accepté, `notice_view {type}` et `notice_close {type}` suffisent ; jamais le texte.

## Étiquette sur les cartes (facultatif)

Quand un bandeau `sea` ou `season` vise des produits, `card_label` donne un mot court (« Rough sea », « From 15 Jan »). Le site peut le poser sur la carte de ces sorties (accueil, `/tours/`, sorties liées), sans changer le reste de la carte :

```html
<span class="card-notice card-notice--season">From 15 Jan</span>
```

```css
.card-notice { display: inline-block; padding: 2px 8px; border-radius: 999px; font: 600 13px/1.4 var(--sans); }
.card-notice--sea { background: #F7D58B; color: var(--ink); }
.card-notice--season { background: var(--on-dark-mute); color: var(--deep); }
```

Une étiquette par carte au plus ; même règle de choix que le bandeau, avec `page.product` = le slug de la carte. L'étiquette disparaît avec le bandeau (même `ends_at`), elle n'est pas fermable.

## Modèles proposés à Anaïs

Textes exacts (`src/gestion/js/bandeau-calc.mjs`, `MODELES`). Ils ne disent que ce qu'Anaïs choisit d'annoncer, sans promesse ajoutée. `{trip}` vient de la liste des pages produit du site (`src/gestion/js/site-produits.mjs`, régénérée par `node docs/gestion/regenerer-produits-site.mjs ~/Desktop/Secrettravelandtour`).

| Type | Texte | Fin automatique |
|---|---|---|
| sea | Rough sea today: island trips are moved to tomorrow. | fin du jour |
| sea | Rough sea: {trip} does not run on {date}. | fin de {date} |
| sea | Rough sea: {trip} on {date} is moved to {date2}. | fin de {date2} |
| season | {trip} does not run until {date}. | début de {date} |
| season | {trip} runs again from {date}. | fin de {date} |
| season | {trip}: last trip of the season on {date}. | fin de {date} |
| new | New: {trip}. | aucune |
| new | New on {trip}: {option}. | aucune |
| info | {trip} is fully booked on {date}. | fin de {date} |
| info | We answer on WhatsApp from {de} to {a}. | aucune |
| urgent | Bad weather: all boat trips are cancelled today. | fin du jour |
| urgent | Bad weather: all boat trips on {date} are cancelled. | fin de {date} |
| urgent | Transfers may run late today. | fin du jour |
| tous | texte libre en anglais (600 caractères, retours à la ligne permis) | aucune |

Dates : « today », « tomorrow », « Tuesday 18 November » dans la semaine, « 18 November » au-delà, l'année ajoutée si elle change.
