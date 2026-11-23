// Repères d'un guide de carnet : l'entrée qui correspond à la partie à l'écran est marquée (aria-current), et sur téléphone la barre défilante
// ramène cette entrée dans sa fenêtre. Sans JavaScript, les repères restent de simples liens d'ancre. Aucun suivi, aucun appel réseau.
(function () {
  "use strict";
  var nav = document.querySelector(".cg-nav");
  if (!nav || !("IntersectionObserver" in window)) return;
  var links = Array.prototype.slice.call(nav.querySelectorAll("a[data-ids]"));
  var targets = [];
  links.forEach(function (a, index) {
    (a.getAttribute("data-ids") || "").split(/\s+/).forEach(function (id) {
      var el = id && document.getElementById(id);
      if (el) targets.push({ el: el, link: a, index: index });
    });
  });
  if (!targets.length) return;
  var active = null;

  function pick() {
    // L'entrée active est la dernière dont le haut a passé le tiers supérieur de l'écran.
    var line = window.innerHeight * 0.35;
    var best = null;
    targets.forEach(function (t) {
      var r = t.el.getBoundingClientRect();
      if (r.top <= line && r.bottom > 0) best = best && best.index > t.index ? best : t;
    });
    return best ? best.link : null;
  }
  function mark() {
    var next = pick();
    if (next === active) return;
    if (active) active.removeAttribute("aria-current");
    active = next;
    if (active) {
      active.setAttribute("aria-current", "true");
      // Barre horizontale (téléphone) : l'entrée active reste visible dans la barre, sans faire défiler la page.
      var list = nav.querySelector("ul");
      if (list && list.scrollWidth > list.clientWidth + 2) {
        var left = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2;
        list.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    }
  }
  var io = new IntersectionObserver(mark, { rootMargin: "0px 0px -40% 0px", threshold: [0, 1] });
  targets.forEach(function (t) { io.observe(t.el); });
  window.addEventListener("scroll", mark, { passive: true });
  mark();
})();
