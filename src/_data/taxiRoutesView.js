// Données calculées pour les pages /taxi/<route>/ : JSON-LD (sans prix, note, avis,
// téléphone ni e-mail, décisions de Jérémy), FAQ fusionnée et liste des autres trajets.
const taxi = require("./taxi.json");
const data = require("./taxiRoutes.json");

const SITE = "https://zwaldtravelplanner.com";

function jsonLd(route, url) {
  const b = taxi.business;
  const service = {
    "@context": "https://schema.org",
    "@type": "TaxiService",
    name: `${route.from} to ${route.to} private transfer`,
    description: route.metaDescription,
    url,
    serviceType: "Private taxi and minivan transfer",
    areaServed: [route.from, route.to].map((name) => ({ "@type": "Place", name })),
    provider: {
      "@type": "Organization",
      name: b.name,
      url: `${SITE}/taxi/`,
      address: { "@type": "PostalAddress", addressLocality: "Koh Lanta", addressRegion: "Krabi", addressCountry: "TH" },
      sameAs: b.sameAs
    },
    // Aucun tarif validé : l'offre renvoie au formulaire.
    offers: { "@type": "Offer", url: `${SITE}/taxi/#request`, availability: "https://schema.org/InStock" }
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: route.faqAll.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } }))
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: b.name, item: `${SITE}/taxi/` },
      { "@type": "ListItem", position: 2, name: `${route.from} to ${route.to}`, item: url }
    ]
  };
  return [service, faq, crumbs];
}

module.exports = function () {
  const routes = data.routes.map((r) => {
    const url = `${SITE}/taxi/${r.id}/`;
    const faqAll = r.faq.concat(data.common.faq);
    const formHref = `/taxi/?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}#request`;
    const route = { ...r, url, faqAll, formHref, label: `${r.from} to ${r.to}` };
    route.jsonLd = jsonLd(route, url);
    return route;
  });
  const byId = Object.fromEntries(routes.map((r) => [r.id, r]));
  const regions = (data.regions || []).map((g) => ({ ...g, routes: g.routes.map((id) => byId[id]).filter(Boolean) }));
  return { routes, common: data.common, byId, regions, further: data.further };
};
