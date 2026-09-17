/* =========================================================
   ZWALD TRAVEL PLANNER — sélecteur de devise
   Détection, conversion et affichage des prix .price-chf.
   Exporté en CommonJS pour les tests (node --test) ET exposé sur
   window pour la page ; aucun bundler dans ce projet.
   ========================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ZWALD_CURRENCY = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SUPPORTED = ["CHF", "EUR", "USD", "GBP", "THB"];
  var EURO_ZONE_REGIONS = ["FR", "BE", "LU", "DE", "AT", "ES", "IT", "PT", "NL", "IE", "FI", "GR"];

  // Repli si le fichier de taux est injoignable (fetch échoué). Mis à jour
  // à la main de temps en temps — ces valeurs ne servent qu'en dernier
  // recours, les vraies valeurs viennent de data/currency-rates.json.
  var FALLBACK_RATES = { EUR: 1.06, USD: 1.22, GBP: 0.91, THB: 40.6 };

  function detectCurrency(locale) {
    if (!locale || typeof locale !== "string") return "CHF";
    var parts = locale.split("-");
    var region = parts.length > 1 ? parts[1].toUpperCase() : "";
    if (region === "CH") return "CHF";
    if (EURO_ZONE_REGIONS.indexOf(region) !== -1) return "EUR";
    if (region === "US") return "USD";
    if (region === "GB") return "GBP";
    return "CHF";
  }

  function formatPrice(chfAmount, currency, rates) {
    if (currency === "CHF" || !rates || typeof rates[currency] !== "number") {
      return Math.round(chfAmount) + " CHF";
    }
    var converted = Math.round(chfAmount * rates[currency]);
    return converted + " " + currency;
  }

  return {
    SUPPORTED: SUPPORTED,
    FALLBACK_RATES: FALLBACK_RATES,
    detectCurrency: detectCurrency,
    formatPrice: formatPrice
  };
});
