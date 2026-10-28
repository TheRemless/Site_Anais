// Données calculées pour la page /taxi/ à partir de taxi.json : données structurées pour
// Google, liste des infos encore à confirmer par VIP Taxi Lanta et affichage du bandeau
// d'aperçu (jamais en production).
const taxi = require("./taxi.json");

function toConfirm() {
  const items = [];
  const groups = [[taxi.hero], [taxi.tours], taxi.services, taxi.why, taxi.steps, taxi.faq, [taxi.rating], [taxi.payment]];
  for (const group of groups) {
    for (const item of group) {
      if (!item.confirmed) items.push(`${item.title || item.q || item.text}: text to confirm`);
    }
  }
  if (!taxi.hero.photo) items.push(`${taxi.hero.title}: vehicle photo`);
  return items;
}

// Uniquement des faits repris du site de VIP Taxi Lanta : pas de note ni d'avis (aucun chiffre
// vérifié), pas de téléphone ni d'e-mail (le formulaire est le canal unique), pas de prix.
function jsonLd() {
  const b = taxi.business;
  return {
    "@context": "https://schema.org",
    "@type": "TaxiService",
    name: b.name,
    alternateName: `${b.name} by ${b.owner}`,
    url: "https://zwaldtravelplanner.com/taxi/",
    image: "https://zwaldtravelplanner.com/images/taxi/og-taxi.jpg",
    logo: "https://zwaldtravelplanner.com/images/taxi/logo.webp",
    description: taxi.hero.lead,
    serviceType: "Private taxi and minivan transfers",
    areaServed: b.areaServed.map((name) => ({ "@type": "Place", name })),
    provider: {
      "@type": "Organization",
      name: b.name,
      address: {
        "@type": "PostalAddress",
        addressLocality: "Koh Lanta",
        addressRegion: "Krabi",
        addressCountry: "TH"
      }
    },
    // Catalogue des services, sans prix : aucun tarif n'a été validé.
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Private taxi and minivan transfers",
      itemListElement: taxi.services.map((s) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: s.title, description: s.text }
      }))
    },
    sameAs: b.sameAs
  };
}

module.exports = function () {
  const pending = toConfirm();
  if (pending.length) {
    console.log(`[taxi] ${pending.length} infos à confirmer sur /taxi/ :\n  - ${pending.join("\n  - ")}`);
  }

  return {
    jsonLd: jsonLd(),
    toConfirm: pending,
    // Netlify fournit CONTEXT=production uniquement pour le site en ligne.
    showDraftBanner: process.env.CONTEXT !== "production" && pending.length > 0
  };
};
