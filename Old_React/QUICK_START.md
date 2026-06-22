# ⚡ QUICK START - Démarrage Rapide

**Copie-colle ces commandes pour démarrer !**

---

## 🚀 30 secondes pour lancer le site

```bash
# 1. Installe les dépendances (à faire une fois)
npm install

# 2. Lance le développement
npm start

# 3. Va à http://localhost:3000 ✅
```

---

## 📁 Structure rapide à connaître

```
src/
  pages/        ← Tes 8 pages
  components/   ← NavBar, HeroSection, Footer
  styles/       ← Tous les CSS
  assets/       ← Mets tes images ici
```

---

## 📸 Ajouter une image (3 étapes)

**1. Prépare l'image**
- Dimensions correctes (voir IMAGE_GUIDE.md)
- Compresse avec TinyPNG ou Squoosh
- Renomme clairement

**2. Place le fichier**
```bash
src/assets/images/hero/my-image.jpg
src/assets/images/destinations/bali.jpg
src/assets/images/blog/article.jpg
src/assets/images/gallery/photo.jpg
```

**3. Importe dans le code**
```jsx
import image from '../assets/images/destination/bali.jpg'
<img src={image} alt="Bali" />
```

---

## 🎨 Changer les couleurs

Dans `src/styles/globals.css` :
```css
:root {
  --primary: #e85d6b;      ← Couleur principale
  --secondary: #4a90e2;    ← Deuxième couleur
  --tertiary: #50c878;     ← Troisième couleur
  --accent: #ffa500;       ← Couleur accent
}
```

---

## ✏️ Modifier le contenu

### Blog
`src/pages/Blog.jsx` - Tableau `BLOG_POSTS`
```jsx
{ id: 1, title: "...", ... }
```

### FAQ
`src/pages/FAQ.jsx` - Tableau `FAQS`
```jsx
{ id: 1, question: "...", answer: "..." }
```

### Services
`src/pages/Services.jsx` - Tableau `SERVICES`
```jsx
{ id: 1, title: "...", features: [...] }
```

### Destinations
`src/pages/Destinations.jsx` - Tableau `DESTINATIONS`
```jsx
{ id: 1, name: "...", highlights: [...] }
```

---

## 📧 Mettre à jour le contact

Cherche et remplace partout :
- `contact@zwaldtravelplanner.com` → Ton email
- `+33 ...` → Ton téléphone
- Links WhatsApp/Facebook → Tes liens

---

## 📱 Tester sur mobile

```bash
# En développement, accède depuis ton téléphone avec :
http://192.168.1.XXX:3000

# Où XXX = IP de ton ordinateur (affichée dans le terminal)
```

---

## 🎬 Animations - Si trop lentes

Dans `src/styles/globals.css` :
```css
/* Réduis duration */
.fadeInUp {
  animation-duration: 0.3s;  /* Au lieu de 0.6s */
}
```

---

## 🔥 Déployer rapidement (Vercel)

```bash
# Installe Vercel CLI
npm install -g vercel

# Deploy
vercel
```

Puis ouvre le lien - c'est live ! 🎉

---

## 🐛 Problèmes courants

| Problème | Solution |
|----------|----------|
| Images ne s'affichent pas | Vérifie le chemin et que le fichier existe |
| Navigation ne marche pas | `npm install react-router-dom` |
| Site lent | Compresse tes images |
| Erreur "Module not found" | `npm install` |
| Animations non fluides | Réduis les durations dans CSS |

---

## 📖 Docs utiles

- **Images** → Ouvre `IMAGE_GUIDE.md`
- **Setup** → Ouvre `SETUP_INSTRUCTIONS.md`
- **Vue d'ensemble** → Ouvre `TRANSFORMATION_SUMMARY.md`

---

## ✅ Checklist avant publication

- [ ] Toutes les pages s'affichent
- [ ] Formulaire de contact fonctionne
- [ ] Images ajoutées et optimisées
- [ ] Contact info à jour
- [ ] Responsive sur mobile (F12)
- [ ] Pas d'erreurs en console (F12)
- [ ] Liens internes fonctionnent
- [ ] Vitesse correcte (< 3s)

---

## 🚀 Commandes clés

```bash
npm start              # Lancer développement
npm run build          # Créer version production
npm install            # Installer dépendances
npm install <package>  # Installer un paquet
npm update             # Mettre à jour tous
git status             # Voir changements
git add .              # Ajouter tous les fichiers
git commit -m "msg"    # Commit
git push               # Push vers repo
```

---

## 🎨 Fichiers à modifier souvent

```
src/pages/Home.jsx          ← Contenu accueil
src/pages/Blog.jsx          ← Articles
src/pages/FAQ.jsx           ← Questions
src/components/Footer.jsx   ← Contact info
src/styles/globals.css      ← Couleurs
src/assets/images/          ← Tes photos
```

---

## 📞 Aide rapide

1. **Consulte IMAGE_GUIDE.md** pour images
2. **Consulte SETUP_INSTRUCTIONS.md** pour config
3. **Cherche "TODO" ou "FIXME"** dans le code
4. **Ouvre la console** (F12) pour erreurs

---

## ⏱️ Timeline recommandée

**Jour 1 :** Setup + test sur mobile
**Jour 2-3 :** Ajoute tes images et contenu
**Jour 4 :** Peaufine design et colors
**Jour 5 :** Deploy et optimisations

---

## 🎉 C'EST TOUT !

Tu as maintenant un site web :
- ✅ Moderne et immersif
- ✅ Responsive et rapide  
- ✅ Prêt pour tes images
- ✅ Facile à modifier
- ✅ Production-ready

**Bon courage ! Ton site va être magnifique ! 🚀✨**

---

**Questions rapides ?**
- Image dimensions → IMAGE_GUIDE.md
- Comment lancer → npm start
- Changer couleurs → globals.css
- Changer texte → src/pages/[Page].jsx

**Besoin d'aide plus ?** Regarde SETUP_INSTRUCTIONS.md
