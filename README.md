# Zwald Travel Planner - Site Web

Bienvenue ! Ceci est ton site web construit avec **React + Vite**, un framework moderne et performant.

## 📁 Structure du projet

```
src/
├── components/          # Tous les composants React
│   ├── NavBar.jsx      # Barre de navigation
│   ├── Hero.jsx        # Section d'accueil
│   ├── About.jsx       # À propos
│   ├── Process.jsx     # Processus en 6 étapes
│   ├── Services.jsx    # Formules de services
│   ├── Testimonials.jsx # Témoignages
│   ├── FAQ.jsx         # Questions fréquentes
│   ├── Contact.jsx     # Formulaire de contact
│   └── Footer.jsx      # Pied de page
├── styles/             # Tous les fichiers CSS
│   ├── globals.css     # Styles globaux (variables, boutons, etc.)
│   ├── navbar.css      # Styles NavBar
│   ├── hero.css        # Styles Hero
│   ├── about.css       # Styles About
│   ├── process.css     # Styles Process
│   ├── services.css    # Styles Services
│   ├── testimonials.css # Styles Testimonials
│   ├── faq.css         # Styles FAQ
│   ├── contact.css     # Styles Contact
│   └── footer.css      # Styles Footer
├── data.js             # Toutes les données (services, témoignages, FAQ, etc.)
├── App.jsx             # Composant principal
└── main.jsx            # Point d'entrée
```

## 🚀 Démarrer le projet

### 1. Installation des dépendances

```bash
npm install
```

### 2. Lancer le serveur de développement

```bash
npm run dev
```

Le site s'ouvrira automatiquement sur `http://localhost:5173`

### 3. Construire pour la production

```bash
npm run build
```

Cela créera un dossier `dist/` prêt à être déployé.

## ✏️ Modifier le contenu

**Toutes les données** (services, témoignages, FAQ, statistiques) sont dans `src/data.js`.
Tu peux modifier directement ce fichier pour mettre à jour le contenu.

**Modifier les textes** : Ouvre le fichier du composant correspondant et change le texte.

**Modifier les styles** : Les fichiers CSS sont organisés par section. Cherche le fichier CSS correspondant et ajuste les couleurs/dimensions.

## 🎨 Personnalisation

### Couleurs principales

Ouvre `src/styles/globals.css` et modifie les variables CSS au début du fichier :

```css
:root {
  --primary: #1a7a6e;        /* Couleur teal principale */
  --accent: #d4af37;         /* Couleur or (boutons, accents) */
  --text-dark: #1a1a1a;      /* Couleur du texte */
  /* ... autres variables ... */
}
```

### Fonts

Tu peux changer la police dans `src/styles/globals.css` :

```css
body {
  font-family: 'Ta police ici', sans-serif;
}
```

## 🖼️ Ajouter des images

1. Crée un dossier `public/images/` dans la racine du projet
2. Mets tes images dedans
3. Dans les composants, utilise :

```jsx
<img src="/images/ton-image.jpg" alt="Description" />
```

## 📱 Responsive

Le site est **100% responsive** et fonctionne parfaitement sur mobile, tablette et desktop. Les breakpoints sont gérés dans les fichiers CSS (voir les `@media` queries).

## 🌐 Déployer le site

### Option 1 : Netlify (recommandé, gratuit)

1. Pousse ton code sur GitHub
2. Va sur [netlify.com](https://netlify.com)
3. Connecte ton repo GitHub
4. Netlify construira et déploiera automatiquement

### Option 2 : Vercel (gratuit)

1. Pousse ton code sur GitHub
2. Va sur [vercel.com](https://vercel.com)
3. Importe ton repo
4. Vercel déploiera automatiquement

### Option 3 : Hébergeur classique (OVH, 1&1, Infomaniak, etc.)

1. Lance `npm run build`
2. Télécharge le contenu du dossier `dist/` via FTP
3. Mets-le à la racine de ton hébergement

## 🆘 Besoin d'aide ?

- **Le site ne démarre pas** : Vérifie que Node.js est installé (`node -v`)
- **Les styles ne s'affichent pas** : Vérifie que tu as bien lancé `npm install`
- **Images qui ne s'affichent pas** : Vérifie le chemin de l'image dans le dossier `public/`

## ✨ Prochaines étapes

- [ ] Ajouter de vraies photos d'Anaïs
- [ ] Intégrer un formulaire de contact qui envoie des emails
- [ ] Ajouter des articles de blog (nouvelle section)
- [ ] Optimiser le SEO (ajouter des meta tags, sitemap, robots.txt)
- [ ] Configurer un domaine personnalisé

Bon courage ! 🚀
