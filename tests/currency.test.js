// tests/currency.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { detectCurrency, formatPrice, FALLBACK_RATES } = require("../src/js/currency.js");

test("detectCurrency: France/Belgique/Luxembourg/Allemagne -> EUR", () => {
  assert.equal(detectCurrency("fr-FR"), "EUR");
  assert.equal(detectCurrency("fr-BE"), "EUR");
  assert.equal(detectCurrency("fr-LU"), "EUR");
  assert.equal(detectCurrency("de-DE"), "EUR");
});

test("detectCurrency: Suisse (toutes langues) -> CHF", () => {
  assert.equal(detectCurrency("fr-CH"), "CHF");
  assert.equal(detectCurrency("de-CH"), "CHF");
  assert.equal(detectCurrency("it-CH"), "CHF");
});

test("detectCurrency: US -> USD, GB -> GBP", () => {
  assert.equal(detectCurrency("en-US"), "USD");
  assert.equal(detectCurrency("en-GB"), "GBP");
});

test("detectCurrency: locale inconnue ou sans région -> CHF", () => {
  assert.equal(detectCurrency("th"), "CHF");
  assert.equal(detectCurrency(""), "CHF");
  assert.equal(detectCurrency("ja-JP"), "CHF");
});

test("formatPrice: CHF reste inchangé", () => {
  assert.equal(formatPrice(29, "CHF", { EUR: 1.06, USD: 1.22, GBP: 0.91, THB: 40.6 }), "29 CHF");
});

test("formatPrice: conversion et arrondi à l'unité", () => {
  const rates = { EUR: 1.0583, USD: 1.221, GBP: 0.9074, THB: 40.598 };
  assert.equal(formatPrice(29, "EUR", rates), "31 EUR");
  assert.equal(formatPrice(790, "THB", rates), "32072 THB");
  assert.equal(formatPrice(70, "USD", rates), "85 USD");
});

test("FALLBACK_RATES a les 4 devises non-CHF avec des nombres positifs", () => {
  for (const code of ["EUR", "USD", "GBP", "THB"]) {
    assert.equal(typeof FALLBACK_RATES[code], "number");
    assert.ok(FALLBACK_RATES[code] > 0);
  }
});
