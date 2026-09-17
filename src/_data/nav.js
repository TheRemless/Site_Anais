// Items de nav partagés entre header (desktop + mobile) et footer.
// hrefEn === hrefFr signifie "pas de version anglaise" : le lien reste
// sur la page française même depuis une page anglaise (voir footer.frOnly).
module.exports = [
  { key: "home", hrefFr: "/", hrefEn: "/en/", labelKey: "nav.home" },
  { key: "services", hrefFr: "/services/", hrefEn: "/en/services/", labelKey: "nav.services" },
  { key: "girlstrips", hrefFr: "/girls-trips/", hrefEn: "/en/girls-trips/", labelKey: "nav.girlstrips", tagKey: "nav.girlstripsTag" },
  { key: "apropos", hrefFr: "/a-propos/", hrefEn: "/en/a-propos/", labelKey: "nav.apropos" },
  { key: "galerie", hrefFr: "/galerie/", hrefEn: "/galerie/", labelKey: "nav.galerie" },
  { key: "blog", hrefFr: "/blog/", hrefEn: "/blog/", labelKey: "nav.blog" },
  { key: "faq", hrefFr: "/faq/", hrefEn: "/en/faq/", labelKey: "nav.faq" }
];
