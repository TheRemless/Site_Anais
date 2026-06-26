# Design doc — Sprint améliorations Zwald Travel Planner
Date : 2026-06-26

## Contexte

Site Eleventy/Netlify pour Anaïs Zwald, travel planner francophone en Thaïlande.
Audit multi-axes (conversion, design/UX, technique) → 10 améliorations priorisées par ROI.

## Périmètre

Pas de refonte. Améliorations chirurgicales sur les fichiers existants.

---

## 1. Bouton WhatsApp flottant

**Fichiers :** `base.njk`, `site.css` ou `components.css`

- Bouton rond fixe bas-droite sur toutes les pages
- Icône WhatsApp SVG, couleur `#25D366`, ombre légère
- `href="https://wa.me/66958683846"`, `target="_blank" rel="noopener"`
- `aria-label="Contacter Anaïs sur WhatsApp"`
- Transition : scale au hover, apparition après 2s de scroll (évite de masquer le hero)
- Masqué sur la page Contact (inutile si on est déjà sur la page contact)

---

## 2. Section Girls Trips sur la homepage + nav

**Fichiers :** `index.njk`, `header.njk`, `components.css`

### Homepage
- Nouvelle section entre "Mes autres services" et le CTA final
- Layout split : galerie de 3 photos (dossier `/images/girls/`) à gauche, texte à droite
- Eyebrow : "Voyage entre amies"
- H2 : "Les Girls Trips, une spécialité Zwald"
- Body : présentation du concept (groupe de copines, ambiance, ce qu'Anaïs organise)
- CTA : "Découvrir les Girls Trips →" vers `girls-trips.html`

### Nav
- Ajouter "Girls Trips" dans les liens desktop et le menu mobile
- Position : après "Services" dans la liste

---

## 3. Témoignage avant le formulaire de contact

**Fichier :** `contact.njk`

- Ajouter 1 bloc témoignage dans la colonne `.contact-side`, en première position
- Reprendre le style `.tcard` existant (carousel de la homepage)
- Choisir le témoignage le plus pertinent (ex : Sophie, voyage solo)
- Étoiles + citation courte + nom/destination

---

## 4. Lien FAQ depuis Services et Contact

**Fichiers :** `services.njk`, `contact.njk`

- Sur Services : bloc texte discret sous la section tarifs → "Des questions sur le fonctionnement ? [Consulte la FAQ →]"
- Sur Contact : ligne sous le formulaire (au-dessus du bouton submit) → "Tu as des questions avant d'écrire ? [Consulte la FAQ →]"
- Style `.text-link` existant

---

## 5. Exemple de budget sous les prix

**Fichier :** `index.njk` (section formules) et `services.njk`

- Sous chaque `.price-note`, ajouter une ligne exemple :
  - Light 29 CHF → "ex : 14 jours = 406 CHF"
  - Solo/Duo 40 CHF → "ex : 14 jours = 560 CHF"
  - Famille 43 CHF → "ex : 14 jours = 602 CHF"
- Style : `font-size: 0.82rem; color: var(--ink-faint);`

---

## 6. Alt texts sur les images du marquee

**Fichier :** `index.njk`

- Les `<img>` dans `.marquee-item` ont `alt=""` (vide)
- Ajouter des alt texts descriptifs pour chaque image (déjà présents dans `data-caption`)
- Les duplicats (`aria-hidden="true"`) gardent `alt=""` — correct

---

## 7. width/height sur les images (anti-CLS)

**Fichiers :** tous les `.njk` avec des `<img>`

- Ajouter `width` et `height` sur toutes les images dont on connaît les dimensions
- En priorité : images above-the-fold (hero, intro split)
- Les images `object-fit: cover` dans des conteneurs CSS n'ont pas besoin d'aspect-ratio JS

---

## 8. OG images distinctes par page

**Fichiers :** tous les `.njk` avec meta OG

- Contact, Services, À propos, Girls Trips partagent `og-home.jpg`
- Court terme : créer `og-default.jpg` (plus générique que og-home) et l'utiliser sur les pages sans image dédiée
- Long terme : photo spécifique par page si disponible

---

## 9. Blog dans la nav

**Fichier :** `header.njk`

- Si le blog n'a pas encore de contenu publié : retirer "Blog" de la nav desktop et mobile
- Ré-ajouter quand au moins 2 articles existent
- Alternative : garder le lien mais rediriger vers une page "Bientôt disponible" avec inscription email

---

## 10. Lien galerie depuis le marquee

**Fichier :** `index.njk`

- Ajouter un lien "Voir toute la galerie →" juste après la section `.marquee`
- Style `.text-link`, centré, couleur adaptée au fond navy du marquee

---

## Ordre d'implémentation suggéré

1. WhatsApp flottant (rapide, fort impact)
2. Section + nav Girls Trips (plus gros dev)
3. Témoignage page Contact
4. Liens FAQ
5. Exemples budget
6. Alt texts marquee
7. width/height images
8. OG images
9. Blog nav
10. Lien galerie
