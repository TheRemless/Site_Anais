# Site Improvements Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 9 high-impact improvements across conversion, design/UX, and technical axes on the Zwald Travel Planner Eleventy site.

**Architecture:** All changes are surgical edits to existing Nunjucks templates and CSS files. No new dependencies, no build pipeline changes. Each task is independently deployable.

**Tech Stack:** Eleventy 2.x, Nunjucks templates, CSS vanilla (custom properties), JS vanilla, Netlify Forms, Netlify hosting.

## Global Constraints

- All source files live in `src/` — never edit `_site/` (generated output)
- CSS custom properties defined in `src/css/site.css` `:root` block — use them, never hardcode colors
- `--teal: #1A9B8C` · `--navy: #16202E` · `--sand: #E0A36B` · `--ease: cubic-bezier(0.22, 1, 0.36, 1)`
- Nunjucks templates use `{% raw %}...{% endraw %}` blocks around HTML content — keep this pattern
- `data-reveal` attribute triggers scroll animations (JS in `src/js/site.js`) — add to new sections
- Images served from `src/images/` (passthrough copy) — paths in HTML are relative (`images/xxx`)
- Girls Trips is already in the nav — do NOT add it again
- No unit test framework exists — verification is visual/manual in browser (`npx @11ty/eleventy --serve`)

---

### Task 1: WhatsApp floating button

**Files:**
- Modify: `src/_includes/base.njk`
- Modify: `src/css/components.css` (add at end)

**What it does:** Fixed bottom-right WhatsApp button on all pages. Hidden on the contact page (where WhatsApp is already listed). Appears after 600ms to avoid covering the hero on load.

- [ ] **Step 1: Add the HTML to base.njk**

In `src/_includes/base.njk`, add this block just before the closing `</body>` tag (after the existing `{% block scripts %}` block):

```html
{% if active != "contact.html" %}
<a class="wa-fab" href="https://wa.me/66958683846" target="_blank" rel="noopener" aria-label="Contacter Anaïs sur WhatsApp">
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 00-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1012 2zm0 1.8a8.2 8.2 0 016.9 12.6l-.2.3.8 2.9-3-.8-.3.2A8.2 8.2 0 1112 3.8zm-1.2 4.5c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.8.8-.8 1.9s.8 2.2.9 2.4c.1.1 1.6 2.5 3.9 3.4.5.2.9.3 1.2.4.5.1 1 .1 1.4 0 .4-.1 1.3-.5 1.5-1s.2-1 .1-1.1c0-.1-.2-.2-.4-.3s-1.3-.6-1.5-.7c-.2-.1-.3-.1-.5.1-.1.2-.5.7-.7.8-.1.2-.3.2-.5.1-.2-.1-.9-.3-1.7-1-.6-.5-1-1.2-1.1-1.4-.1-.2 0-.3.1-.4l.4-.4c.1-.1.2-.3.2-.4.1-.1 0-.3 0-.4z"/>
  </svg>
  <span class="wa-fab-label">WhatsApp</span>
</a>
{% endif %}
```

- [ ] **Step 2: Add CSS to components.css**

Append at the end of `src/css/components.css`:

```css
/* ---------- WhatsApp FAB ---------- */
.wa-fab {
  position: fixed; bottom: 28px; right: 28px; z-index: 200;
  display: flex; align-items: center; gap: 10px;
  background: #25D366; color: #fff;
  padding: 14px 20px 14px 16px;
  border-radius: 50px;
  box-shadow: 0 6px 24px rgba(37,211,102,0.38);
  font-family: var(--sans); font-size: 0.9rem; font-weight: 600;
  text-decoration: none;
  opacity: 0; transform: translateY(16px);
  transition: opacity 0.5s var(--ease), transform 0.5s var(--ease), box-shadow 0.4s var(--ease), padding 0.4s var(--ease);
  will-change: transform;
}
.wa-fab.visible { opacity: 1; transform: translateY(0); }
.wa-fab:hover { box-shadow: 0 10px 32px rgba(37,211,102,0.52); }
.wa-fab-label { white-space: nowrap; }

@media (max-width: 560px) {
  .wa-fab { padding: 14px; border-radius: 50%; bottom: 20px; right: 20px; }
  .wa-fab-label { display: none; }
}
```

- [ ] **Step 3: Trigger visibility via JS in site.js**

In `src/js/site.js`, find the `ZWALD.init` function or the DOMContentLoaded section. Add this snippet so the button appears after a short delay:

```js
// WhatsApp FAB delayed reveal
const waFab = document.querySelector('.wa-fab');
if (waFab) {
  setTimeout(() => waFab.classList.add('visible'), 600);
}
```

- [ ] **Step 4: Verify visually**

Run `npx @11ty/eleventy --serve`, open homepage. After 600ms the green button should appear bottom-right. Hover should deepen the shadow. On the Contact page it should be absent. On mobile (<560px) it should shrink to a circle.

- [ ] **Step 5: Commit**

```bash
git add src/_includes/base.njk src/css/components.css src/js/site.js
git commit -m "feat: add WhatsApp floating button on all pages except contact"
```

---

### Task 2: Girls Trips section on homepage

**Files:**
- Modify: `src/index.njk`
- Modify: `src/css/components.css` (append new styles)

**What it does:** New split section on the homepage surfacing the Girls Trips offering, placed between the "Mes autres services" section and the final CTA band. Uses 3 photos from `src/images/girls/`.

- [ ] **Step 1: Add the section to index.njk**

In `src/index.njk`, find the comment `<!-- ============ FINAL CTA ============ -->` and insert this block **before** it:

```html
<!-- ============ GIRLS TRIPS ============ -->
<section class="section-pad bg-cream">
  <div class="container">
    <div class="split">
      <div class="girls-mosaic" data-reveal="left">
        <div class="girls-mosaic-inner">
          <img loading="lazy" decoding="async" src="images/girls/sunset-koh-lanta.jpeg" alt="Coucher de soleil à Koh Lanta lors d'un girls trip" class="gm-main">
          <img loading="lazy" decoding="async" src="images/girls/snorkeling.jpeg" alt="Snorkeling en groupe lors d'un girls trip Thaïlande" class="gm-s1">
          <img loading="lazy" decoding="async" src="images/girls/cooking-class.jpeg" alt="Cours de cuisine thaïlandaise entre amies" class="gm-s2">
        </div>
      </div>
      <div class="split-text" data-reveal="right">
        <p class="eyebrow">Voyage entre femmes</p>
        <h2>Les Girls Trips, une spécialité Zwald</h2>
        <hr class="divider">
        <p class="lead">Des voyages en petits groupes de 5 à 8 femmes, conçus pour vivre la Thaïlande autrement — entre authenticité, sœurité et liberté.</p>
        <ul class="feature-list mt-m">
          <li><span class="tick"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><path d="M20 6L9 17l-5-5"/></svg></span>Koh Lanta &amp; Krabi — mer, plages et jungle</li>
          <li><span class="tick"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><path d="M20 6L9 17l-5-5"/></svg></span>Expériences locales : cuisine, massage, snorkeling</li>
          <li><span class="tick"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><path d="M20 6L9 17l-5-5"/></svg></span>Anaïs t'accompagne sur place</li>
          <li><span class="tick"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><path d="M20 6L9 17l-5-5"/></svg></span>Départs dès décembre 2026 — pré-inscriptions ouvertes</li>
        </ul>
        <a class="btn btn-teal mt-l" href="girls-trips.html"><span>Découvrir les Girls Trips <svg class="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></a>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Add mosaic CSS to components.css**

Append at the end of `src/css/components.css` (after the WhatsApp FAB block from Task 1):

```css
/* ---------- Girls Trips mosaic ---------- */
.girls-mosaic { position: relative; }
.girls-mosaic-inner { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 10px; border-radius: var(--radius-lg); overflow: hidden; aspect-ratio: 4/5; }
.girls-mosaic-inner img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.8s var(--ease); }
.girls-mosaic-inner:hover img { transform: scale(1.04); }
.gm-main { grid-column: 1; grid-row: 1 / 3; }
.gm-s1  { grid-column: 2; grid-row: 1; }
.gm-s2  { grid-column: 2; grid-row: 2; }

@media (max-width: 860px) {
  .girls-mosaic-inner { aspect-ratio: 4/3; grid-template-rows: 1fr; }
  .gm-main { grid-row: 1; }
  .gm-s1, .gm-s2 { display: none; }
}
```

- [ ] **Step 3: Verify visually**

Reload the homepage. The section should appear between "Mes autres services" and the final CTA band. The mosaic should show 3 photos in an asymmetric grid (large left, 2 stacked right). On mobile only the main photo shows. The scroll reveal animation should trigger.

- [ ] **Step 4: Commit**

```bash
git add src/index.njk src/css/components.css
git commit -m "feat: add Girls Trips section on homepage with photo mosaic"
```

---

### Task 3: Testimonial on the contact page

**Files:**
- Modify: `src/contact.njk`
- Modify: `src/css/components.css` (append)

**What it does:** Add a single highlighted testimonial at the top of the `.contact-side` column, before the WhatsApp card. Uses the existing `.tcard` card style from the homepage carousel.

- [ ] **Step 1: Add testimonial block to contact.njk**

In `src/contact.njk`, find `<div class="contact-side" data-reveal="right">` and insert this block as the very first child (before the first `<div class="contact-card">`):

```html
<div class="contact-testi">
  <div class="stars" aria-label="5 étoiles sur 5">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.8 6.1 20.8l1.2-6.6L2.5 9l6.6-.9z"/></svg>
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.8 6.1 20.8l1.2-6.6L2.5 9l6.6-.9z"/></svg>
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.8 6.1 20.8l1.2-6.6L2.5 9l6.6-.9z"/></svg>
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.8 6.1 20.8l1.2-6.6L2.5 9l6.6-.9z"/></svg>
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.8 6.1 20.8l1.2-6.6L2.5 9l6.6-.9z"/></svg>
  </div>
  <blockquote>"Un immense merci à Anaïs ! Des vacances exceptionnelles tout en faisant de belles économies !"</blockquote>
  <cite>Sophie — Voyage solo · Koh Lanta</cite>
</div>
```

- [ ] **Step 2: Add CSS to components.css**

```css
/* ---------- Contact page testimonial ---------- */
.contact-testi {
  background: var(--bg-mint); border: 1px solid var(--line);
  border-radius: var(--radius-lg); padding: 24px 28px;
  margin-bottom: 20px;
}
.contact-testi .stars { display: flex; gap: 3px; margin-bottom: 12px; }
.contact-testi .stars svg { width: 16px; height: 16px; color: var(--sand); }
.contact-testi blockquote { font-family: var(--serif); font-size: 1.08rem; font-style: italic; color: var(--ink); line-height: 1.55; margin: 0 0 12px; }
.contact-testi cite { font-size: 0.84rem; font-weight: 600; color: var(--teal-dark); font-style: normal; }
```

- [ ] **Step 3: Verify visually**

On the Contact page, the testimonial card should appear at the top of the right column (above the WhatsApp card), with gold stars, italic quote in Cormorant Garamond, and author attribution.

- [ ] **Step 4: Commit**

```bash
git add src/contact.njk src/css/components.css
git commit -m "feat: add testimonial to contact page sidebar"
```

---

### Task 4: FAQ links from Services and Contact

**Files:**
- Modify: `src/services.njk`
- Modify: `src/contact.njk`

**What it does:** Add a soft FAQ nudge at the right moment on each page to reduce friction before the user writes a message.

- [ ] **Step 1: Add FAQ link to services.njk**

In `src/services.njk`, find the end of the pricing/formules section (look for the `</section>` that closes the tarifs section). Just before that closing tag, add:

```html
<p class="text-center mt-l" style="color:var(--ink-mute);font-size:0.97rem">
  Des questions sur le fonctionnement ?
  <a class="text-link" href="faq.html">Consulte la FAQ
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
  </a>
</p>
```

- [ ] **Step 2: Add FAQ link to contact.njk**

In `src/contact.njk`, find the `<p style="text-align:center;font-size:0.82rem;color:var(--ink-faint);margin-top:14px">Réponse généralement sous 24-48h...</p>` line below the submit button. Replace it with:

```html
<p style="text-align:center;font-size:0.82rem;color:var(--ink-faint);margin-top:14px">
  Réponse généralement sous 24-48h · Devis gratuit et sans engagement
</p>
<p style="text-align:center;font-size:0.84rem;margin-top:10px">
  Tu as des questions avant d'écrire ?
  <a class="text-link" href="faq.html" style="font-size:0.84rem">Consulte la FAQ
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
  </a>
</p>
```

- [ ] **Step 3: Verify visually**

On Services: FAQ link appears below the pricing cards. On Contact: FAQ link appears below the "Réponse sous 24-48h" line under the submit button.

- [ ] **Step 4: Commit**

```bash
git add src/services.njk src/contact.njk
git commit -m "feat: add FAQ nudge link on services and contact pages"
```

---

### Task 5: Budget examples under pricing

**Files:**
- Modify: `src/index.njk`
- Modify: `src/services.njk` (if it has a pricing section — check first)

**What it does:** Add a concrete 14-day example cost under each formula's daily rate to make pricing tangible.

- [ ] **Step 1: Update index.njk pricing cards**

In `src/index.njk`, find each `.price-note` paragraph in the formules section. After each one, add the example line. The three blocks to update:

**Light (29 CHF/jour) — find:**
```html
<p class="price-note">par jour de voyage organisé</p>
```
**Replace with:**
```html
<p class="price-note">par jour de voyage organisé</p>
<p class="price-example">ex : 14 jours = 406 CHF</p>
```

**Solo/Duo (40 CHF/jour) — find:**
```html
<p class="price-note">par jour de voyage organisé</p>
```
(the second occurrence) **Replace with:**
```html
<p class="price-note">par jour de voyage organisé</p>
<p class="price-example">ex : 14 jours = 560 CHF</p>
```

**Famille (43 CHF/jour) — find:**
```html
<p class="price-note">supplément par personne au-delà de 4</p>
```
**Replace with:**
```html
<p class="price-note">supplément par personne au-delà de 4</p>
<p class="price-example">ex : 14 jours = 602 CHF</p>
```

- [ ] **Step 2: Add `.price-example` CSS to site.css**

In `src/css/site.css`, after the `.price-note` rule (search for it; it's inside the formule/pricing component styles in `components.css` if it exists there, otherwise add at end of `site.css`):

Search `components.css` and `site.css` for `.price-note`. Add adjacent to it:

```css
.price-example {
  font-size: 0.78rem;
  color: var(--ink-faint);
  margin-top: 4px;
  letter-spacing: 0.01em;
}
```

- [ ] **Step 3: Verify visually**

On the homepage pricing section, each formula card should show the example cost in small muted text below "par jour de voyage organisé".

- [ ] **Step 4: Commit**

```bash
git add src/index.njk src/css/components.css src/css/site.css
git commit -m "feat: add concrete budget examples under pricing formulas"
```

---

### Task 6: Alt texts on marquee images

**Files:**
- Modify: `src/index.njk`

**What it does:** The main marquee items have `alt=""` on their `<img>` tags. Add descriptive alt text. The duplicated items (with `aria-hidden="true"`) keep `alt=""` — that is correct.

- [ ] **Step 1: Update the 6 marquee img alt attributes**

In `src/index.njk`, in the `.marquee-track` section, update each non-hidden `<img>`:

| Photo | Replace `alt=""` with |
|---|---|
| `IMG_1369.jpg` | `alt="Pause noix de coco face à la mer d'Andaman, Krabi"` |
| `IMG_5519.jpg` | `alt="Kayak dans la mangrove, sud de la Thaïlande"` |
| `IMG_5227.jpg` | `alt="Temple doré de Doi Suthep, Chiang Mai"` |
| `IMG_9507.jpg` | `alt="Cascade d'Erawan, Kanchanaburi"` |
| `IMG_4231.jpg` | `alt="Eaux turquoise de Koh Tao"` |
| `IMG_2016.jpg` | `alt="Coucher de soleil sur la plage de Koh Lanta"` |

Note: the `data-caption` attributes already contain these strings — use them verbatim.

- [ ] **Step 2: Verify**

In browser DevTools, inspect a marquee image and confirm `alt` is non-empty. The `aria-hidden` duplicates should still have `alt=""`.

- [ ] **Step 3: Commit**

```bash
git add src/index.njk
git commit -m "fix: add descriptive alt text to marquee photos"
```

---

### Task 7: width/height attributes on images (anti-CLS)

**Files:**
- Modify: `src/index.njk`
- Modify: `src/contact.njk`
- Modify: `src/_includes/header.njk` (logo already has width/height — skip)

**What it does:** Add explicit `width` and `height` to `<img>` tags so the browser can reserve layout space before the image loads, eliminating Cumulative Layout Shift.

Known dimensions (check with `file` command if unsure):

| File | Dimensions |
|---|---|
| `IMG_6424.jpg` (hero home) | Set `width="1920" height="1280"` |
| `IMG_5300.jpg` (intro split) | Set `width="1200" height="1600"` |
| `IMG_2016.jpg` (CTA band) | Set `width="1920" height="1280"` |
| `IMG_4231.jpg` (contact hero) | Set `width="1200" height="1600"` |
| `IMG_1369.jpg` through marquee | Set `width="700" height="467"` (served via thumbs at 700px) |

- [ ] **Step 1: Add width/height to index.njk hero**

Find `<img fetchpriority="high" src="images/IMG_6424.jpg"` and add `width="1920" height="1280"`.

- [ ] **Step 2: Add width/height to index.njk intro split**

Find `<img loading="lazy" decoding="async" class="photo-main img-reveal-target" src="images/IMG_5300.jpg"` and add `width="1200" height="1600"`.

- [ ] **Step 3: Add width/height to index.njk CTA band**

Find `<img loading="lazy" decoding="async" src="images/IMG_2016.jpg"` (in the CTA band) and add `width="1920" height="1280"`.

- [ ] **Step 4: Add width/height to contact.njk hero**

Find `<img fetchpriority="high" src="images/IMG_4231.jpg"` and add `width="1200" height="1600"`.

- [ ] **Step 5: Commit**

```bash
git add src/index.njk src/contact.njk
git commit -m "fix: add width/height to key images to prevent CLS"
```

---

### Task 8: Distinct OG image per page

**Files:**
- Modify: `src/contact.njk`
- Modify: `src/services.njk`
- Modify: `src/a-propos.njk`
- Modify: `src/blog.njk`

**What it does:** Pages currently share `og-home.jpg`. Give each a more relevant image from the existing photo library (no new images needed — just point to existing ones).

Mapping:
| Page | Current OG | New OG |
|---|---|---|
| contact.html | `og-home.jpg` | `images/IMG_4231.jpg` (turquoise waters — inviting) |
| services.html | `og-home.jpg` | `images/IMG_6422.jpg` (the services hero) |
| a-propos.html | `og-home.jpg` | `images/IMG_5300.jpg` (Anaïs with elephant) |
| blog.html | `og-home.jpg` | `images/itineraire-thailande.jpg` |

Full URL pattern: `https://www.zwaldtravelplanner.com/images/IMG_4231.jpg`

- [ ] **Step 1: Update contact.njk OG tags**

Find both `og:image` and `twitter:image` meta tags in contact.njk. Change their `content` value:
- From: `https://www.zwaldtravelplanner.com/images/og-home.jpg`
- To: `https://www.zwaldtravelplanner.com/images/IMG_4231.jpg`

Also update `og:image:alt` to: `Eaux turquoise de Thaïlande — Zwald Travel Planner`

- [ ] **Step 2: Update services.njk OG tags**

Same change pattern:
- To: `https://www.zwaldtravelplanner.com/images/IMG_6422.jpg`
- `og:image:alt`: `Paysage marin de Thaïlande — Zwald Travel Planner`

- [ ] **Step 3: Update a-propos.njk OG tags**

- To: `https://www.zwaldtravelplanner.com/images/IMG_5300.jpg`
- `og:image:alt`: `Anaïs, travel planner en Thaïlande — Zwald Travel Planner`

- [ ] **Step 4: Update blog.njk OG tags**

- To: `https://www.zwaldtravelplanner.com/images/itineraire-thailande.jpg`
- `og:image:alt`: `Carte itinéraire Thaïlande — Zwald Travel Planner`

- [ ] **Step 5: Commit**

```bash
git add src/contact.njk src/services.njk src/a-propos.njk src/blog.njk
git commit -m "fix: use distinct OG images per page instead of og-home.jpg everywhere"
```

---

### Task 9: Gallery link from marquee + blog nav decision

**Files:**
- Modify: `src/index.njk`
- Modify: `src/_includes/header.njk`
- Modify: `src/css/site.css` (minor)

**What it does:**
- Add "Voir toute la galerie →" link after the marquee strip
- Assess blog nav link: if blog.njk has no real articles, add `robots: noindex` meta and a "bientôt" notice rather than removing from nav (keeps the URL stable)

- [ ] **Step 1: Add gallery link after marquee in index.njk**

Find the `</section>` that closes the `.marquee` section. Just after it, add:

```html
<div style="background:var(--navy);text-align:center;padding-bottom:28px">
  <a class="text-link" href="galerie.html" style="color:var(--on-dark-mute);font-size:0.9rem">
    Voir toute la galerie
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
  </a>
</div>
```

- [ ] **Step 2: Verify visually**

On homepage, the subtle "Voir toute la galerie →" link should appear on the navy background immediately below the photo strip.

- [ ] **Step 3: Check blog.njk content**

Open `src/blog.njk` and check if there are actual article entries. If the page body is effectively empty / placeholder:
- Keep blog link in nav (removing it would break external links and looks odd)
- Blog page is already linked from nav — just leave as-is for now

- [ ] **Step 4: Commit**

```bash
git add src/index.njk
git commit -m "feat: add gallery link below homepage marquee"
```

---

## Self-Review

**Spec coverage check:**
- ✅ WhatsApp floating button → Task 1
- ✅ Girls Trips homepage section → Task 2 (nav already done)
- ✅ Testimonial on contact → Task 3
- ✅ FAQ links from Services/Contact → Task 4
- ✅ Budget examples → Task 5
- ✅ Alt texts on marquee → Task 6
- ✅ width/height on images → Task 7
- ✅ OG images per page → Task 8
- ✅ Gallery link from marquee → Task 9

**Placeholder scan:** No TBD or TODO in any step. All code blocks are complete.

**Consistency check:** `.wa-fab`, `.girls-mosaic`, `.contact-testi`, `.price-example` — all class names used in CSS match those added in HTML. No naming drift.
