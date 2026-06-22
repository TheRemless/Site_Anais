# 🚀 Instructions de Configuration - Site Zwald Travel Planner

Bienvenue ! Voici tout ce qu'il faut faire pour que ton site fonctionne correctement.

---

## ✅ ÉTAPE 1 : Vérifier les Dépendances

Assure-toi que tu as installé toutes les librairies nécessaires.

```bash
npm install react-router-dom framer-motion aos
```

Si tu as des erreurs, essaie :
```bash
npm install --legacy-peer-deps
```

---

## 📁 ÉTAPE 2 : Structure des Fichiers

Voici l'architecture complète du site :

```
src/
├── pages/
│   ├── Home.jsx              ✅ Page d'accueil avec sections
│   ├── Services.jsx          ✅ Services et tarifs
│   ├── Destinations.jsx      ✅ Destinations en détail
│   ├── Blog.jsx              ✅ Liste des articles blog
│   ├── BlogPost.jsx          ✅ Articles blog individuels
│   ├── Galerie.jsx           ✅ Galerie avec lightbox
│   ├── Contact.jsx           ✅ Formulaire de contact
│   └── FAQ.jsx               ✅ Questions fréquentes
│
├── components/
│   ├── NavBar.jsx            ✅ Barre de navigation (fixe)
│   ├── HeroSection.jsx       ✅ Section héro immersive
│   └── Footer.jsx            ✅ Pied de page avec liens
│
├── styles/
│   ├── globals.css           ✅ Styles globaux et variables
│   ├── navbar.css            ✅ Styles barre navigation
│   ├── hero-section.css      ✅ Styles section héro
│   ├── home.css              ✅ Styles page d'accueil
│   ├── services.css          ✅ Styles services
│   ├── destinations.css      ✅ Styles destinations
│   ├── blog.css              ✅ Styles blog
│   ├── blog-post.css         ✅ Styles articles
│   ├── galerie.css           ✅ Styles galerie
│   ├── contact-page.css      ✅ Styles contact
│   ├── faq-page.css          ✅ Styles FAQ
│   └── footer-new.css        ✅ Styles pied de page
│
├── assets/
│   └── images/
│       ├── hero/             📸 À remplir
│       ├── destinations/     📸 À remplir
│       ├── blog/             📸 À remplir
│       ├── gallery/          📸 À remplir
│       └── services/         📸 À remplir
│
├── App.jsx                   ✅ Configuration des routes
└── index.jsx                 ✅ Point d'entrée

IMAGE_GUIDE.md               📋 Guide complet images
SETUP_INSTRUCTIONS.md        📋 Ce fichier
```

---

## 🎨 ÉTAPE 3 : Configuration du Style Global

Le fichier `globals.css` contient toutes les variables de couleur. Si tu veux changer les couleurs :

```css
:root {
  --primary: #e85d6b;           /* Couleur principale (rose)  */
  --primary-dark: #d44a5a;      /* Variante foncée */
  --primary-light: #f08c9a;     /* Variante claire */
  --secondary: #4a90e2;         /* Bleu */
  --tertiary: #50c878;          /* Vert */
  --accent: #ffa500;            /* Orange */
  --text-dark: #1a1a1a;         /* Texte sombre */
  --text-gray: #666666;         /* Texte gris */
  --bg-white: #ffffff;          /* Blanc */
}
```

---

## 🚀 ÉTAPE 4 : Lancer le Développement

Pour tester le site en local :

```bash
npm start
```

Ouvre http://localhost:3000 dans ton navigateur. Tu devrais voir la barre de navigation fixe, la page d'accueil avec le héro immersif, et toutes les sections.

---

## 📸 ÉTAPE 5 : Ajouter Tes Images

Suis le guide **IMAGE_GUIDE.md** pour :
1. Créer les dossiers `src/assets/images/[category]/`
2. Préparer et optimiser tes images
3. Les placer dans les bons dossiers
4. Mettre à jour les chemins dans le code

**Exemple :**
```bash
mkdir -p src/assets/images/{hero,destinations,blog,gallery,services}
cp ma-photo.jpg src/assets/images/destinations/bali-hero.jpg
```

---

## 🔧 ÉTAPE 6 : Personnalisation Importante

### 1. Remplacer les informations de contact

Dans `src/components/Footer.jsx` et `src/pages/Contact.jsx` :
- Remplace `contact@zwaldtravelplanner.com` par ton email
- Remplace `+33 ...` par ton vrai numéro
- Remplace les liens WhatsApp/Telegram par les tiens

### 2. Mettre à jour le contenu blog

Dans `src/pages/BlogPost.jsx`, le tableau `BLOG_CONTENT` contient les articles. Tu peux :
- Ajouter de nouveaux articles
- Modifier le contenu HTML
- Ajouter des images

### 3. Personnaliser les destinations

Dans `src/pages/Destinations.jsx`, le tableau `DESTINATIONS` contient :
- Nom de la destination
- Emoji
- Description
- Points clés
- Meilleure période

---

## 🌐 ÉTAPE 7 : Déploiement (Production)

Quand tu es prêt à publier :

```bash
npm run build
```

Cela crée un dossier `build/` avec ton site optimisé prêt pour le déploiement.

**Options de déploiement :**
1. **Vercel** (gratuit) - `vercel deploy`
2. **Netlify** (gratuit) - Drag & drop le dossier `build/`
3. **GitHub Pages** - `npm run build` puis push
4. **Ton propre serveur** - Upload le contenu de `build/`

---

## 🎯 ÉTAPE 8 : Vérification de Qualité

Avant de publier, vérifie :

### Performance
- [ ] Les pages se chargent rapidement (< 3s)
- [ ] Les images sont optimisées
- [ ] Pas d'erreurs dans la console

### Responsive
- [ ] Le site s'affiche bien sur desktop
- [ ] Le site s'affiche bien sur tablette
- [ ] Le site s'affiche bien sur mobile (iPhone/Android)
- [ ] Le menu hamburger fonctionne

### Fonctionnalité
- [ ] Tous les liens de navigation fonctionnent
- [ ] Le formulaire de contact s'envoie
- [ ] La galerie lightbox fonctionne
- [ ] Les animations Framer Motion s'affichent

### SEO (Optionnel mais important)
- [ ] Meta titles et descriptions
- [ ] Alt text sur les images
- [ ] Liens internes optimisés
- [ ] Sitemap.xml

---

## 🐛 DÉPANNAGE

### Problème : "Module not found"
```
Solution : npm install
```

### Problème : Images ne s'affichent pas
```
Solution : Vérifie que le chemin est correct et que les fichiers existent
Exemple correct : import image from '../assets/images/destinations/bali.jpg'
```

### Problème : Le site est lent
```
Solution :
1. Compresse tes images (max 200KB par image)
2. Désactive les animations en développement si trop lentes
3. Utilise des DevTools pour identifier le problème
```

### Problème : Navigation ne fonctionne pas
```
Solution : Vérifie que React Router est bien installé
npm install react-router-dom
```

---

## 📱 RESPONSIVE DESIGN

Le site est conçu mobile-first. Les breakpoints sont :
- **Mobile :** < 768px
- **Tablette :** 768px - 1024px
- **Desktop :** > 1024px

Toutes les sections s'adaptent automatiquement.

---

## ✨ FONCTIONNALITÉS IMPLÉMENTÉES

### ✅ Immersion & Animations
- Parallax scrolling sur le héro
- Particules animées
- Animations Framer Motion
- Scroll-triggered animations (AOS)
- Hover effects interactifs

### ✅ Pages Complètes
- Accueil avec sections variées
- Services avec tarifs
- Destinations détaillées
- Blog avec articles complets
- Galerie interactive avec lightbox
- Formulaire de contact
- FAQ avec accordéon
- Footer riche avec newsletter

### ✅ Navigation
- Barre fixe avec logo
- Menu mobile responsive
- Détection de route active
- Transitions fluides

### ✅ SEO Ready
- Structure HTML sémantique
- Meta tags prêts
- Alt text sur les images
- URLs propres

---

## 🚀 PROCHAINES ÉTAPES

Une fois le site lancé :

1. **Ajoute tes images** (consulte IMAGE_GUIDE.md)
2. **Peaufine le contenu** (textes, descriptions)
3. **Teste sur mobile** (toutes les pages)
4. **Intègre Google Analytics** (suivi des visites)
5. **Configure des emails** (formulaire de contact)
6. **Déploie en production** (Vercel, Netlify, etc.)

---

## 📞 BESOIN D'AIDE ?

Si tu as des questions :
1. Vérifie la console (F12) pour les erreurs
2. Consulte le IMAGE_GUIDE.md pour les images
3. Revois la structure des fichiers ci-dessus
4. Vérifie que toutes les dépendances sont installées

---

## 📚 RESSOURCES UTILES

- **React Documentation :** https://react.dev
- **React Router :** https://reactrouter.com
- **Framer Motion :** https://www.framer.com/motion/
- **AOS (Animate On Scroll) :** https://michalsnik.github.io/aos/
- **Tailwind CSS :** https://tailwindcss.com

---

## 🎉 FÉLICITATIONS !

Tu as maintenant un site web de voyage professionnel, immersif et moderne. C'est le moment de le remplir de tes belles photos et de ton contenu pour vraiment le faire briller ! 

**N'oublie pas :** C'est ton histoire unique qui fera la différence. Sois authentique ! ✨

---

**Dernière vérification :**
- [ ] Dépendances installées
- [ ] Toutes les pages s'affichent
- [ ] Navigation fonctionne
- [ ] Responsive sur mobile
- [ ] Prêt pour ajouter les images

**Bon courage ! 🚀**
