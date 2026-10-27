// Données calculées pour la page /secret/ à partir de secret.json :
// données structurées pour Google (fidèles à la fiche Google Maps), liste des infos
// encore à confirmer par l'équipe et affichage du bandeau d'aperçu (jamais en production).
const secret = require("./secret.json");

function toConfirm() {
  const items = [];
  for (const t of secret.tours.concat(secret.activities)) {
    if (!t.confirmed) items.push(`${t.name}: description and details`);
    if (!t.photo) items.push(`${t.name}: photo`);
  }
  return items;
}

// Uniquement des faits présents sur la fiche Google : pas de prix, pas d'avis, pas de description inventée.
function jsonLd() {
  const b = secret.business;
  return {
    "@context": "https://schema.org",
    "@type": "TravelAgency",
    name: b.name,
    url: "https://zwaldtravelplanner.com/secret/",
    image: "https://zwaldtravelplanner.com/images/secret/og-secret.jpg",
    logo: "https://zwaldtravelplanner.com/images/secret/apple-touch-icon.png",
    telephone: b.phone,
    address: {
      "@type": "PostalAddress",
      streetAddress: b.address.street,
      addressLocality: b.address.locality,
      addressRegion: b.address.region,
      postalCode: b.address.postalCode,
      addressCountry: b.address.country
    },
    geo: { "@type": "GeoCoordinates", latitude: b.geo.lat, longitude: b.geo.lng },
    sameAs: [b.googleMaps],
    parentOrganization: { "@type": "Organization", name: b.operator, url: "https://zwaldtravelplanner.com/" }
  };
}

module.exports = function () {
  const pending = toConfirm();
  if (pending.length) {
    console.log(`[secret] ${pending.length} infos à confirmer sur /secret/ :\n  - ${pending.join("\n  - ")}`);
  }

  return {
    jsonLd: jsonLd(),
    toConfirm: pending,
    // Netlify fournit CONTEXT=production uniquement pour le site en ligne.
    showDraftBanner: process.env.CONTEXT !== "production" && pending.length > 0
  };
};
