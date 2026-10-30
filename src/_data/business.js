// Entité Zwald Travel Planner, source unique du JSON-LD TravelAgency
// (include _includes/schema-business.njk). Un seul endroit à modifier.
//
// googleReviewCount : nombre d'avis de la fiche Google. Tant qu'il vaut null,
// aucun aggregateRating n'est publié (Google exige une note ET un nombre réels).
const site = "https://zwaldtravelplanner.com";

const business = {
  site,
  name: "Zwald Travel Planner",
  legalName: "Zwald Travel Planner Co., Ltd.",
  telephone: "+66958683846",
  telephoneDisplay: "+66 95 868 38 46",
  email: null,
  address: {
    streetAddress: "292 Moo 2",
    addressLocality: "Sala Dan, Koh Lanta",
    addressRegion: "Krabi",
    postalCode: "81150",
    addressCountry: "TH"
  },
  googleMaps: "https://maps.app.goo.gl/F81WUgeET6vPxjNs8",
  googleRating: 5,
  googleReviewCount: 18,
  instagram: "https://www.instagram.com/zwaldtravelplanner/",
  tiktok: "https://www.tiktok.com/@zwaldtravelplanner",
  linkedin: "https://www.linkedin.com/in/anaiszwald/",
  foundingDate: "2023-02",
  facebook: "https://www.facebook.com/people/Zwald-Travel-Planner/61568573411432/",
  founder: {
    name: "Anaïs Zwald",
    givenName: "Anaïs",
    familyName: "Zwald",
    jobTitle: { fr: "Travel planner", en: "Travel planner" },
    alumniOf: "École Hôtelière de Genève",
    nationality: "CH",
    url: { fr: site + "/a-propos/", en: site + "/en/a-propos/" }
  },
  description: {
    fr: "Travel planner suisse installée en Thaïlande depuis plus de 3 ans. Itinéraires 100 % sur mesure pour la Thaïlande et l'Asie du Sud-Est, carnet de voyage digital, assistance WhatsApp 7j/7, aucune commission : le voyageur réserve lui-même.",
    en: "Swiss travel planner based in Thailand for over 3 years. Fully tailor-made itineraries for Thailand and Southeast Asia, a digital travel journal, WhatsApp support 7 days a week and no commission: travellers book everything themselves."
  },
  slogan: { fr: "Vos voyages sur mesure de A à Z", en: "Your tailor-made trips from A to Z" },
  // Formules, prix par jour de voyage organisé (CHF).
  offers: [
    { id: "light", name: { fr: "Formule Light", en: "Light package" }, price: 35, desc: { fr: "Itinéraire sur mesure et sélection des transports, par jour de voyage organisé.", en: "Tailor-made itinerary and transport selection, per day of travel planned." } },
    { id: "solo-duo", name: { fr: "Formule Solo / Duo", en: "Solo / Duo package" }, price: 40, desc: { fr: "Itinéraire sur mesure et carnet de voyage digital, par jour de voyage organisé.", en: "Tailor-made itinerary and digital travel journal, per day of travel planned." } },
    { id: "famille", name: { fr: "Formule Famille", en: "Family package" }, price: 43, desc: { fr: "Itinéraire sur mesure pour les familles, par jour de voyage organisé.", en: "Tailor-made itinerary for families, per day of travel planned." } },
    { id: "region", name: { fr: "Formule par région", en: "Per-region package" }, price: 120, unit: { fr: "par région visitée", en: "per region visited" }, desc: { fr: "Hébergements, activités et bonnes adresses classés par région, sans programme jour par jour, dès 120 CHF par région visitée.", en: "Accommodation, activities and addresses sorted by region, with no day-by-day programme, from 120 CHF per region visited." } }
  ]
};

function jsonLd(lang) {
  const l = lang === "en" ? "en" : "fr";
  const b = business;
  const sameAs = [b.instagram, b.tiktok, b.facebook, b.googleMaps].filter(Boolean);
  const founder = {
    "@type": "Person",
    "@id": site + "/#anais",
    name: b.founder.name,
    givenName: b.founder.givenName,
    familyName: b.founder.familyName,
    jobTitle: b.founder.jobTitle[l],
    url: b.founder.url[l],
    alumniOf: { "@type": "EducationalOrganization", name: b.founder.alumniOf },
    nationality: { "@type": "Country", name: b.founder.nationality },
    knowsLanguage: ["fr", "en"],
    knowsAbout: l === "en" ? ["Thailand", "Southeast Asia", "Tailor-made travel planning", "Koh Lanta"] : ["Thaïlande", "Asie du Sud-Est", "Organisation de voyages sur mesure", "Koh Lanta"],
    sameAs: [b.instagram, b.tiktok, b.linkedin]
  };
  const data = {
    "@context": "https://schema.org",
    "@type": "TravelAgency",
    "@id": site + "/#business",
    name: b.name,
    legalName: b.legalName,
    foundingDate: b.foundingDate,
    slogan: b.slogan[l],
    description: b.description[l],
    url: l === "en" ? site + "/en/" : site + "/",
    image: site + "/images/IMG_6424.jpg",
    logo: site + "/images/logo.png",
    telephone: b.telephone,
    priceRange: "35-120 CHF",
    currenciesAccepted: "CHF, EUR",
    address: { "@type": "PostalAddress", ...b.address },
    areaServed: [
      { "@type": "Country", name: l === "en" ? "Thailand" : "Thaïlande" },
      { "@type": "Country", name: l === "en" ? "Malaysia" : "Malaisie" },
      { "@type": "Country", name: l === "en" ? "Indonesia" : "Indonésie" },
      { "@type": "Country", name: l === "en" ? "Vietnam" : "Vietnam" },
      { "@type": "Place", name: l === "en" ? "Southeast Asia" : "Asie du Sud-Est" }
    ],
    knowsLanguage: ["fr", "en"],
    founder,
    employee: founder,
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: l === "en" ? "Travel planning packages" : "Formules de travel planning",
      itemListElement: b.offers.map((o) => ({
        "@type": "Offer",
        name: o.name[l],
        price: String(o.price),
        priceCurrency: "CHF",
        url: l === "en" ? site + "/en/services/" : site + "/services/",
        itemOffered: { "@type": "Service", name: o.name[l], description: o.desc[l], provider: { "@id": site + "/#business" } },
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: String(o.price),
          priceCurrency: "CHF",
          unitText: o.unit ? o.unit[l] : (l === "en" ? "per day of travel planned" : "par jour de voyage organisé")
        }
      }))
    },
    sameAs
  };
  if (b.googleReviewCount) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: String(b.googleRating),
      bestRating: "5",
      reviewCount: String(b.googleReviewCount)
    };
  }
  return data;
}

module.exports = { ...business, jsonLd: { fr: jsonLd("fr"), en: jsonLd("en") } };
