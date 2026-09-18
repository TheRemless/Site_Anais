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

  var SUPPORTED = ["CHF", "EUR", "THB"];
  var EURO_ZONE_REGIONS = ["FR", "BE", "LU", "DE", "AT", "ES", "IT", "PT", "NL", "IE", "FI", "GR"];

  // Repli si le fichier de taux est injoignable (fetch échoué). Mis à jour
  // à la main de temps en temps — ces valeurs ne servent qu'en dernier
  // recours, les vraies valeurs viennent de data/currency-rates.json.
  var FALLBACK_RATES = { EUR: 1.06, THB: 40.6 };

  function detectCurrency(locale) {
    if (!locale || typeof locale !== "string") return "CHF";
    var parts = locale.split("-");
    var region = parts.length > 1 ? parts[1].toUpperCase() : "";
    if (region === "CH") return "CHF";
    if (EURO_ZONE_REGIONS.indexOf(region) !== -1) return "EUR";
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
    fetch(url)
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
    var notes = document.querySelectorAll(".currency-note");
    for (var j = 0; j < notes.length; j++) {
      notes[j].hidden = (currency === "CHF");
    }
    var selects = document.querySelectorAll("#currency-switch, #currency-switch-mobile");
    for (var k = 0; k < selects.length; k++) { selects[k].value = currency; }

    var pills = document.querySelectorAll(".currency-pill");
    for (var p = 0; p < pills.length; p++) {
      var isCur = pills[p].getAttribute("data-currency") === currency;
      pills[p].classList.toggle("active", isCur);
      pills[p].setAttribute("aria-pressed", isCur ? "true" : "false");
    }
  }

  function init() {
    if (!document.querySelector(".price-chf") && !document.querySelector(".currency-pill") && !document.getElementById("currency-switch")) return;
    var stored = null;
    try { stored = localStorage.getItem("zwald_currency"); } catch (e) { /* private mode etc. */ }
    var currency = (stored && SUPPORTED.indexOf(stored) !== -1)
      ? stored
      : detectCurrency(navigator.language || "");

    // Taux actifs, partagés par le rendu initial (fallback) et le change
    // listener : mis à jour en place quand loadRates() reçoit les vrais taux,
    // pour que le listener utilise toujours les meilleurs taux connus.
    var activeRates = FALLBACK_RATES;

    // Rendu immédiat avec les taux de repli : jamais de flash CHF, l'état
    // de repos est toujours correct (ou au pire approximatif via fallback).
    applyCurrency(currency, activeRates);

    var selects = document.querySelectorAll("#currency-switch, #currency-switch-mobile");
    for (var i = 0; i < selects.length; i++) {
      selects[i].addEventListener("change", function (e) {
        currency = e.target.value;
        applyCurrency(currency, activeRates);
        try { localStorage.setItem("zwald_currency", currency); } catch (err) { /* ignore */ }
      });
    }

    var pills = document.querySelectorAll(".currency-pill");
    for (var j = 0; j < pills.length; j++) {
      pills[j].addEventListener("click", function (e) {
        var code = e.currentTarget.getAttribute("data-currency");
        if (code && SUPPORTED.indexOf(code) !== -1) {
          currency = code;
          applyCurrency(currency, activeRates);
          try { localStorage.setItem("zwald_currency", currency); } catch (err) { /* ignore */ }
        }
      });
    }

    loadRates(function (rates) {
      activeRates = rates;
      // Re-applique avec la devise sélectionnée actuellement (l'utilisateur
      // a pu la changer pendant que le fetch était en cours), pas forcément
      // celle lue au chargement.
      applyCurrency(currency, activeRates);
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
