/* =========================================================
   ZWALD — Cookie consent + Google Consent Mode v2
   GA (analytics_storage) stays denied until the visitor accepts.
   Choice stored in localStorage("zw-consent") = "granted" | "denied".
   ========================================================= */
(function () {
  "use strict";
  var KEY = "zw-consent";
  function gtagSafe() {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== "function") { window.gtag = function () { window.dataLayer.push(arguments); }; }
    return window.gtag;
  }
  function apply(state) {
    var granted = state === "granted";
    gtagSafe()("consent", "update", {
      analytics_storage: granted ? "granted" : "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    });
    // Let other scripts (e.g. the newsletter widget) react to the visitor's choice
    // instead of loading their own third-party cookies unconditionally.
    window.dispatchEvent(new CustomEvent("zw-consent", { detail: { granted: granted } }));
  }

  var css = ""
    + ".zwc{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:520px;margin:0 auto;"
    + "background:#0C1F1E;color:#E6F4F1;border:1px solid rgba(255,255,255,.12);border-radius:16px;"
    + "padding:22px 24px;box-shadow:0 24px 60px rgba(0,0,0,.35);font-family:'Manrope',system-ui,sans-serif;"
    + "transform:translateY(140%);transition:transform .55s cubic-bezier(.22,1,.36,1);}"
    + ".zwc.show{transform:translateY(0);}"
    + ".zwc-title{font-family:'Manrope',sans-serif;font-size:1rem;font-weight:700;margin:0 0 6px;color:#fff;}"
    + ".zwc p{font-size:.88rem;line-height:1.55;color:rgba(230,244,241,.72);margin:0 0 16px;}"
    + ".zwc p a{color:#24B5A5;text-decoration:underline;}"
    + ".zwc-row{display:flex;gap:10px;flex-wrap:wrap;}"
    + ".zwc-btn{flex:1;min-width:120px;cursor:pointer;border-radius:50px;padding:11px 18px;font:inherit;"
    + "font-size:.88rem;font-weight:600;border:1px solid transparent;transition:transform .3s,background .3s,border-color .3s;}"
    + ".zwc-btn:hover{transform:translateY(-2px);}"
    + ".zwc-accept{background:#0E7A6D;color:#fff;}.zwc-accept:hover{background:#1A9B8C;}"
    + ".zwc-refuse{background:transparent;color:#E6F4F1;border-color:rgba(255,255,255,.3);}"
    + ".zwc-refuse:hover{border-color:#fff;}"
    + "@media(max-width:520px){.zwc{left:12px;right:12px;bottom:12px;padding:20px;}}";

  function injectStyle() {
    var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
  }
  var bannerEl = null;
  function buildBanner() {
    if (bannerEl) return bannerEl;
    var d = document.createElement("div");
    d.className = "zwc"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "Consentement aux cookies");
    d.innerHTML =
      '<div class="zwc-title">🍪 Cookies &amp; confidentialit\u00e9</div>' +
      '<p>J\'utilise des cookies de mesure d\'audience (Google Analytics) pour am\u00e9liorer le site. ' +
      'Tu peux accepter ou refuser. En savoir plus dans la ' +
      '<a href="/politique-confidentialite/">politique de confidentialit\u00e9</a>.</p>' +
      '<div class="zwc-row">' +
        '<button class="zwc-btn zwc-refuse" type="button">Refuser</button>' +
        '<button class="zwc-btn zwc-accept" type="button">Accepter</button>' +
      '</div>';
    document.body.appendChild(d);
    d.querySelector(".zwc-accept").addEventListener("click", function () { choose("granted"); });
    d.querySelector(".zwc-refuse").addEventListener("click", function () { choose("denied"); });
    bannerEl = d;
    return d;
  }
  function show() {
    var d = buildBanner();
    requestAnimationFrame(function () { setTimeout(function () { d.classList.add("show"); }, 60); });
  }
  function hide() { if (bannerEl) bannerEl.classList.remove("show"); }
  function choose(state) {
    try { localStorage.setItem(KEY, state); } catch (e) {}
    apply(state);
    hide();
  }

  // public: reopen from a footer "Cookies" link
  window.ZW_openConsent = function () { show(); };

  function init() {
    injectStyle();
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    if (saved === "granted") { apply("granted"); }
    else if (saved === "denied") { apply("denied"); }
    else { show(); } // no choice yet → ask (GA already defaulted to denied)
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
