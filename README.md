# Zwald Travel Planner — site web

Site vitrine de Zwald Travel Planner (zwaldtravelplanner.com), généré avec [Eleventy](https://www.11ty.dev/) (Nunjucks). Pas de framework front-end, pas de bundler — CSS et JS vanilla.

## Stack

- **Générateur** : Eleventy 3, templates Nunjucks (`.njk`)
- **Hébergement** : Netlify — build automatique sur `master`, deploy preview sur chaque pull request
- **Formulaire de contact** : Netlify Forms + une fonction serverless (`netlify/functions/submission-created.js`) qui envoie l'e-mail de confirmation via SMTP (Infomaniak)
- **Tests** : `node --test` (intégré à Node, aucune dépendance de test)

## Structure

```
src/
  *.njk              18 pages françaises (accueil, services, girls-trips, faq…)
  en/                7 pages anglaises, miroirs manuels des pages FR équivalentes
  _includes/         base.njk (squelette partagé), header.njk, footer.njk, newsletter.njk
  _data/             lang.js, i18n.json, nav.js — données du sélecteur de langue et de la nav
  css/               site.css (layout/nav), components.css (composants)
  js/                currency.js, consent.js, site.js, newsletter-consent.js, legal.js
netlify/functions/   submission-created.js — email de confirmation du formulaire de contact
.github/workflows/   ci.yml (tests sur chaque PR), refresh-currency-rates.yml (cron quotidien)
data/                currency-rates.json — maintenu uniquement par la GitHub Action, ne pas éditer à la main
tests/               currency.test.js, i18n.test.js, submission-created.test.js
```

## Développer en local

```bash
npm ci            # installe les dépendances depuis le lockfile
npm run serve     # serveur de dev Eleventy, rechargement automatique
npm run build     # génère le site statique dans _site/
npm test          # lance tous les tests
```

Aucun test visuel automatisé : vérifier les changements d'interface dans un vrai navigateur, en largeur bureau **et** mobile.

## Sélecteur de devise

CHF (référence réelle, jamais convertie dans les CGV ni le formulaire de contact) détectée par défaut, EUR détectée automatiquement pour les visiteurs en zone euro, THB sélectionnable à la main. Taux rafraîchis une fois par jour par `.github/workflows/refresh-currency-rates.yml` (frankfurter.app), lus via jsDelivr — pas de redéploiement Netlify déclenché par ce rafraîchissement (voir `netlify.toml`, clause `ignore`). Tout prix affiché doit porter `class="price-chf" data-chf="MONTANT"`.

## Sélecteur de langue

7 pages ont une version anglaise sous `/en/` (accueil, services, girls-trips, cartes cadeaux, FAQ, contact, à propos). Le reste du site reste français uniquement. Sélecteur manuel dans le header, pas de détection ni de redirection automatique. Libellés partagés (nav, footer, bannière cookies) dans `src/_data/i18n.json`, consommés via le filtre Nunjucks `t`.

## Déploiement

Le site est déjà configuré sur Netlify (build auto sur `master`). Les variables d'environnement (SMTP) et les réglages de domaine se gèrent depuis le tableau de bord Netlify du compte propriétaire, pas depuis ce dépôt.

## Convention de travail

Toujours passer par une branche + pull request, jamais de commit direct sur `master`. Attendre que la CI et la deploy preview Netlify soient vertes avant de merger.
