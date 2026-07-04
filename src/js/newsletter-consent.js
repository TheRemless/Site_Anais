/* =========================================================
   ZWALD — consent-gated newsletter widget
   The Brevo/Sendinblue embed sets a third-party cookie as soon as its
   CSS/JS load, so it must only load once the visitor has accepted
   cookies (same choice as Google Analytics, stored in localStorage
   "zw-consent"). Until then, show a small prompt instead of a broken
   unstyled form.
   ========================================================= */
(function () {
  "use strict";
  var KEY = "zw-consent";
  var loaded = false;

  function reveal() {
    var gate = document.getElementById("nl-consent-gate");
    var widget = document.getElementById("sib-form-container");
    if (gate) gate.hidden = true;
    if (widget) widget.hidden = false;
  }

  function loadWidget() {
    if (loaded || !document.getElementById("sib-form-container")) return;
    loaded = true;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://sibforms.com/forms/end-form/build/sib-styles.css";
    document.head.appendChild(link);
    var script = document.createElement("script");
    script.defer = true;
    script.src = "https://sibforms.com/forms/end-form/build/main.js";
    document.body.appendChild(script);
    reveal();
  }

  function checkSaved() {
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    if (saved === "granted") loadWidget();
  }

  window.addEventListener("zw-consent", function (e) {
    if (e.detail && e.detail.granted) loadWidget();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", checkSaved);
  else checkSaved();
})();
