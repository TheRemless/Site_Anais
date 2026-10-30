// Pages /secret/<id>/ : une par excursion ou activité qui a assez de faits confirmés.
// Catalogue (nom, photo, infos courtes) dans secret.json, textes et programmes dans
// secretPagesContent.json (base partenaires du 28.10.2026). Aucun prix nulle part.
const secret = require("./secret.json");
const content = require("./secretPagesContent.json");

const SITE = "https://zwaldtravelplanner.com";

function jsonLd(item, page, url) {
  const b = secret.business;
  const provider = {
    "@type": "TravelAgency",
    name: b.name,
    url: `${SITE}/secret/`,
    telephone: b.phone,
    address: {
      "@type": "PostalAddress",
      streetAddress: b.address.street,
      addressLocality: b.address.locality,
      addressRegion: b.address.region,
      postalCode: b.address.postalCode,
      addressCountry: b.address.country
    }
  };
  const main = {
    "@context": "https://schema.org",
    "@type": page.schemaType,
    name: page.h1 + " " + page.h1em,
    description: page.metaDescription,
    url,
    image: item.photo ? `${SITE}/images/secret/${item.photo}` : undefined,
    provider,
    touristType: page.kind === "boat" ? "Families, couples and groups" : undefined,
    // Lieux visités : uniquement ceux des brochures.
    itinerary: page.schemaType === "TouristTrip"
      ? { "@type": "ItemList", itemListElement: page.places.map((name, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "Place", name } })) }
      : undefined,
    location: page.schemaType !== "TouristTrip" ? { "@type": "Place", name: "Koh Lanta", address: { "@type": "PostalAddress", addressLocality: "Koh Lanta", addressRegion: "Krabi", addressCountry: "TH" } } : undefined,
    // Aucun prix : le tarif est donné sur WhatsApp.
    offers: { "@type": "Offer", url: `${SITE}/secret/#tell-us`, availability: "https://schema.org/InStock", priceCurrency: "THB" }
  };
  Object.keys(main).forEach((k) => main[k] === undefined && delete main[k]);
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } }))
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Secret Travel & Tour", item: `${SITE}/secret/` },
      { "@type": "ListItem", position: 2, name: page.h1 + " " + page.h1em, item: url }
    ]
  };
  return [main, faq, crumbs];
}

module.exports = function () {
  const items = secret.tours.map((t) => ({ ...t, kind: "boat" })).concat(secret.activities.map((a) => ({ ...a, kind: "activity" })));
  const pages = [];
  for (const item of items) {
    const page = content.pages[item.id];
    if (!page || !item.confirmed) continue;
    const url = `${SITE}/secret/${item.id}/`;
    const merged = { ...page, kind: item.kind, id: item.id, name: item.name, info: item.info, photo: item.photo, photoAlt: item.photoAlt, photoPosition: item.photoPosition, url };
    merged.jsonLd = jsonLd(item, merged, url);
    pages.push(merged);
  }
  return { pages, parkFeeNote: content.parkFeeNote, byId: Object.fromEntries(pages.map((p) => [p.id, p])) };
};
