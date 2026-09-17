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

  function loadRates(callback) {
    var url = "https://cdn.jsdelivr.net/gh/TheRemless/Site_Anais@master/data/currency-rates.json";
    if (typeof fetch !== "function") { callback(FALLBACK_RATES); return; }
    fetch(url, { cache: "no-store" })
      .then(function (res) { if (!res.ok) throw new Error("bad status"); return res.json(); })
      .then(function (data) {
        if (data && data.rates && typeof data.rates.EUR === "number") {
          callback(data.rates);
        } else {
          callback(FALLBACK_RATES);
        }
      })
      .catch(function () { callback(FALLBACK_RATES); });
  }

  function applyCurrency(currency, rates) {
    document.documentElement.setAttribute("data-currency", currency);
    var prices = document.querySelectorAll(".price-chf");
    for (var i = 0; i < prices.length; i++) {
      var chf = parseFloat(prices[i].getAttribute("data-chf"));
      if (!isNaN(chf)) prices[i].textContent = formatPrice(chf, currency, rates);
    }
    var notes = document.querySelectorAll(".price-note");
    for (var j = 0; j < notes.length; j++) {
      notes[j].hidden = (currency === "CHF");
    }
    var selects = document.querySelectorAll("#currency-switch, #currency-switch-mobile");
    for (var k = 0; k < selects.length; k++) { selects[k].value = currency; }
  }

  function init() {
    if (!document.querySelector(".price-chf") && !document.getElementById("currency-switch")) return;
    var stored = null;
    try { stored = localStorage.getItem("zwald_currency"); } catch (e) { /* private mode etc. */ }
    var currency = (stored && SUPPORTED.indexOf(stored) !== -1)
      ? stored
      : detectCurrency(navigator.language || "");

    loadRates(function (rates) {
      applyCurrency(currency, rates);
      var selects = document.querySelectorAll("#currency-switch, #currency-switch-mobile");
      for (var i = 0; i < selects.length; i++) {
        selects[i].addEventListener("change", function (e) {
          var next = e.target.value;
          applyCurrency(next, rates);
          try { localStorage.setItem("zwald_currency", next); } catch (err) { /* ignore */ }
        });
      }
    });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", init);
  }

  return {
    SUPPORTED: SUPPORTED,
    FALLBACK_RATES: FALLBACK_RATES,
    detectCurrency: detectCurrency,
    formatPrice: formatPrice
  };
});
