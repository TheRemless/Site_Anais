# 📸 Guide Complet : Images et Formats pour le Site Zwald Travel Planner

Ce guide te montre exactement où et comment ajouter les images sur ton site pour une intégration parfaite.

---

## 🎯 Structure des Dossiers Images

```
src/
  assets/
    images/
      hero/              # Images pour la section héro
      destinations/      # Images pour les destinations
      blog/             # Images pour les articles blog
      gallery/          # Images pour la galerie
      services/         # Images pour les services
```

---

## 📄 PAGES ET PLACEMENTS D'IMAGES

### 1️⃣ ACCUEIL (Home.jsx)

#### HeroSection - Image Principale
- **Emplacement :** Côté droit du hero (zone avec emoji 🇹🇭)
- **Format :** JPG ou PNG
- **Dimensions :** 1200px × 1500px (ratio 4:5)
- **Poids :** Max 300KB
- **Compression :** 85% de qualité
- **Fichier suggéré :** `hero/anaïs-asie-main.jpg`
- **Code à modifier :**
```jsx
<div className="image-box">
  <img src={require('../assets/images/hero/anaïs-asie-main.jpg')} alt="Anaïs en Asie" />
  <p>Photo immersive d'Anaïs en Asie</p>
</div>
```

#### Destinations Carousel
- **Nombre d'images :** 4 (Thaïlande, Bali, Lombok, Indonésie)
- **Format :** JPG ou PNG
- **Dimensions :** 800px × 600px (ratio 4:3)
- **Poids :** Max 150KB par image
- **Placement :** Dans le tableau `DESTINATIONS` de Home.jsx
- **Fichiers suggérés :**
  - `destinations/thailand-landscape.jpg`
  - `destinations/bali-landscape.jpg`
  - `destinations/lombok-landscape.jpg`
  - `destinations/indonesia-landscape.jpg`

---

### 2️⃣ SERVICES (Services.jsx)

#### Images Service Cards
- **Nombre :** 4 (une par service)
- **Format :** PNG avec transparence (ou JPG)
- **Dimensions :** 400px × 300px
- **Poids :** Max 100KB par image
- **Placement :** Icônes des services
- **Fichiers suggérés :**
  - `services/custom-journey.png`
  - `services/consultation.png`
  - `services/experiences.png`
  - `services/groups.png`

---

### 3️⃣ DESTINATIONS (Destinations.jsx)

#### Destination Hero Images
- **Nombre :** 4 (une par destination)
- **Format :** JPG haute qualité
- **Dimensions :** 1200px × 800px (ratio 3:2)
- **Poids :** Max 250KB par image
- **Placement :** Dans `DESTINATIONS` array
- **Fichiers suggérés :**
  - `destinations/thailand-hero.jpg`
  - `destinations/bali-hero.jpg`
  - `destinations/lombok-hero.jpg`
  - `destinations/indonesia-hero.jpg`

#### Carte Interactive
- **Format :** SVG ou PNG
- **Dimensions :** 900px × 400px
- **Poids :** Max 200KB
- **Fichier suggéré :** `destinations/asia-map.svg`
- **Placement :** `.map-placeholder`

---

### 4️⃣ BLOG (Blog.jsx & BlogPost.jsx)

#### Article Blog - Images Thumbnail
- **Nombre :** 6 articles de base
- **Format :** JPG ou PNG
- **Dimensions :** 600px × 400px
- **Poids :** Max 120KB par image
- **Fichiers suggérés :**
  - `blog/bangkok-48h.jpg`
  - `blog/responsible-travel.jpg`
  - `blog/budget-asia.jpg`
  - `blog/secret-beaches.jpg`
  - `blog/asian-cuisine.jpg`
  - `blog/hiking-adventure.jpg`

#### Article Blog - Images dans le contenu
- **Nombre :** 2-3 par article
- **Format :** JPG haute qualité
- **Dimensions :** 800px × 600px (ou 16:9)
- **Poids :** Max 200KB par image
- **Placement :** Dans le contenu HTML de BlogPost.jsx
- **Exemple de code :**
```jsx
<img src={require('../assets/images/blog/bangkok-temple.jpg')} 
     alt="Temple doré à Bangkok" />
```

---

### 5️⃣ GALERIE (Galerie.jsx)

#### Images Galerie - Grid
- **Nombre :** 9+ images
- **Format :** JPG ou PNG
- **Dimensions :** 600px × 600px (carré 1:1) ⭐ IMPORTANT
- **Poids :** Max 150KB par image
- **Ratio :** Carrés parfaits pour le grid
- **Fichiers suggérés :**
  - `gallery/sunset-thailand.jpg`
  - `gallery/bali-temple.jpg`
  - `gallery/lombok-beach.jpg`
  - `gallery/local-market.jpg`
  - `gallery/jungle-trekking.jpg`
  - `gallery/local-food.jpg`
  - `gallery/traditional-boat.jpg`
  - `gallery/local-ritual.jpg`
  - `gallery/mountain-landscape.jpg`

#### Images Galerie - Optimisation
- **Compression :** 80% de qualité
- **Format conseillé :** JPG pour photos, PNG pour graphiques
- **Outil de compression :** TinyPNG, ImageOptim ou Squoosh

---

### 6️⃣ CONTACT (Contact.jsx)

#### Images Contact
- **Nombre :** 0-1 (optionnel)
- **Format :** JPG ou PNG
- **Dimensions :** 400px × 300px
- **Poids :** Max 100KB
- **Placement :** Section contact info (optionnel)

---

## 🎨 OPTIMISATIONS RECOMMANDÉES

### Outils en ligne gratuits :
1. **TinyPNG** (tinypng.com) - Compression sans perte
2. **Squoosh** (squoosh.app) - Conversion et compression
3. **ImageOptim** (imageoptim.com) - Optimisation locale

### Processus d'optimisation :
1. Télécharge ton image haute résolution
2. Redimensionne à la dimension requise
3. Compresse à 75-85% de qualité
4. Vérifie que le poids est < au max recommandé
5. Upload sur le site

---

## 📱 RESPONSIVE - IMAGES MOBILES

Toutes les images s'adapteront automatiquement sur mobile grâce aux CSS responsive. Les dimensions données ci-dessus fonctionnent sur toutes les résolutions.

**Conseil :** Les images carrées (1:1) comme pour la galerie sont les meilleures pour la compatibilité mobile.

---

## 🔄 REMPLACEMENT D'IMAGES

Pour remplacer une image :

1. **Prépare la nouvelle image** (dimensions et format corrects)
2. **Optimise-la** (compression, poids)
3. **Upload dans** `src/assets/images/[dossier]/`
4. **Met à jour le chemin** dans le code si nécessaire

---

## ✨ FORMATS RECOMMANDÉS

### Photos/Paysages :
- **Format :** JPG
- **Qualité :** 80-85%
- **Raison :** Meilleure compression pour photos

### Graphiques/Icônes :
- **Format :** PNG
- **Avec transparence :** Oui si nécessaire
- **Raison :** Meilleure qualité pour éléments graphiques

### Logo/Icônes simples :
- **Format :** SVG
- **Raison :** Scalable et très léger

---

## 📊 CHECKLIST IMAGES COMPLÈTE

### Pour chaque image :
- ☐ Dimensions correctes
- ☐ Format approprié (JPG/PNG/SVG)
- ☐ Poids < au maximum recommandé
- ☐ Qualité acceptable (pas pixelisée)
- ☐ Nommée de manière claire
- ☐ Placée dans le bon dossier
- ☐ Chemin correct dans le code
- ☐ Alt text renseigné (accessibilité)

---

## 🚀 EXEMPLE COMPLET : Ajouter une image

### Étape 1 : Préparer l'image
- Image originale : 3000px × 2250px, 2.5MB
- Redimensionner à 1200px × 900px
- Compresser à 85% de qualité
- Poids final : ~180KB ✓

### Étape 2 : Nommer et placer
- Nom : `bali-rice-terrace.jpg`
- Dossier : `src/assets/images/destinations/`
- Chemin complet : `src/assets/images/destinations/bali-rice-terrace.jpg`

### Étape 3 : Importer dans le code
```jsx
import baliImage from '../assets/images/destinations/bali-rice-terrace.jpg';

<img src={baliImage} alt="Magnifiques rizières en terrasse à Bali" />
```

### Étape 4 : Vérifier dans le navigateur
- Affichage correct ? ✓
- Poids acceptable ? ✓
- Ratio respecté ? ✓

---

## 💡 CONSEILS PRO

1. **Cohérence visuelle :** Toutes tes photos doivent avoir un style similaire (même luminosité, saturation, etc.)

2. **Qualité avant tout :** Mieux vaut 10 photos excellentes que 20 médiocres

3. **Authentique, pas stocké :** Les vraies photos de toi en Asie sont plus authentiques que des photos de stock. C'est TON histoire !

4. **Format carré pour galerie :** C'est plus esthétique et responsif

5. **Tester sur mobile :** Affiche-toi quelques pages sur mobile pour vérifier que tout s'affiche bien

---

## ❓ QUESTIONS FRÉQUENTES

**Q: Je dois redimensionner TOUTES mes photos ?**
R: Oui, pour garder le site rapide et optimisé. Les dimensions données sont idéales.

**Q: JPG ou PNG ?**
R: JPG pour photos/paysages, PNG pour graphiques/logos. JPG = plus léger, PNG = meilleure qualité pour elements graphiques.

**Q: Combien d'images sur le site ?**
R: Minimum 20-30 pour un site riche et attrayant. Idéalement 50+ pour vraiment raconter ton histoire.

**Q: Les images peuvent-être animées (GIF) ?**
R: Techniquement oui, mais c'est lourd. À éviter. Préfère les vidéos courtes.

**Q: Je peux utiliser des images libres de droit ?**
R: Oui, mais privilégie tes VRAIES photos de voyage. C'est beaucoup plus impactant !

---

## 🎬 INTÉGRATION FUTURE

Le site est prêt pour :
- Images dans les articles blog (à ajouter dans le contenu)
- Vidéos YouTube/Vimeo embedded
- Carrousels d'images (si besoin futur)
- Lightbox pour la galerie (déjà intégré !)

---

**📝 Besoin d'aide ?** Contacte-moi et je t'aiderai à optimiser tes images !

**🚀 Prêt à rendre ton site MAGNIFIQUE ?** Ajoute tes photos maintenant et vois la magie opérer ! ✨
