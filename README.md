# Zwald Travel Planner — site web

Site vitrine statique (HTML / CSS / JavaScript), sans build ni dépendances.
Multi-pages, optimisé pour le référencement (SEO) et prêt à héberger n'importe où.

## Structure

```
index.html          Accueil
services.html       Services
cours-thai.html     Cours de thaï
a-propos.html       À propos
galerie.html        Galerie
blog.html           Blog
faq.html            FAQ
contact.html        Contact
css/                Styles (site.css = design system, components.css = composants)
js/site.js          Comportements (menu, animations, lightbox, carrousel, formulaire)
images/             Photos + logo
robots.txt          Indexation moteurs de recherche
sitemap.xml         Plan du site pour Google
```

## Tester en local
Double-cliquez sur `index.html` : le site s'ouvre dans le navigateur, sans rien installer.
(Le formulaire de contact n'enverra rien en local — voir plus bas.)

## ⚠️ Avant la mise en ligne — remplacer le domaine
Un domaine provisoire `https://www.zwaldtravelplanner.com` est utilisé dans les balises SEO.
**Remplacez-le par votre vrai domaine** (recherche/remplacement global) dans :
- les 8 fichiers `.html` (balises `canonical`, `og:url`, `og:image`, données structurées)
- `robots.txt`
- `sitemap.xml`

## Déploiement (Netlify recommandé)
1. Poussez le dépôt sur GitHub.
2. Sur Netlify : « Add new site » → « Import from GitHub » → sélectionnez le dépôt.
3. **Build command** : laissez vide. **Publish directory** : `/` (la racine).
4. Déployez. C'est tout — aucun build nécessaire.

(Fonctionne aussi sur Vercel, GitHub Pages, Cloudflare Pages, ou tout hébergement statique.)

## Formulaire de contact (Netlify Forms)
La page contact est déjà câblée pour **Netlify Forms** (attribut `data-netlify` + champ caché).
Une fois le site déployé sur Netlify :
1. Onglet **Forms** du tableau de bord → le formulaire « contact » apparaît avec les messages reçus.
2. **Forms → Form notifications → Add notification → Email notification** : ajoutez l'adresse e-mail
   d'Anaïs pour recevoir chaque demande par mail.
3. Un piège anti-spam (« honeypot ») est déjà en place.

➡️ Sur un autre hébergeur que Netlify, remplacez l'envoi par Formspree ou EmailJS.

## SEO — ce qui est déjà en place
- Une page HTML réelle par section, avec `<title>` et meta description uniques.
- Open Graph + Twitter Cards (aperçu avec image lors d'un partage sur les réseaux / messageries).
- Données structurées JSON-LD `TravelAgency` (nom, logo, photo, réseaux, zone desservie)
  → permet à Google d'associer le **logo** et les infos de l'entreprise.
- `robots.txt` + `sitemap.xml`.
- Favicon et icône Apple (logo).

### Après mise en ligne
- Déclarez le site dans **Google Search Console** et soumettez `sitemap.xml`.
- Vérifiez l'aperçu de partage sur https://www.opengraph.xyz (collez votre URL).
