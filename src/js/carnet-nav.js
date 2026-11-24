/* Navigation d'un guide du carnet : la carte, la légende et les catégories mènent aux sorties ; le repère de la carte suit la lecture ;
   sur téléphone, une barre fine (la carte en réduction et le nom de la sortie lue) ramène à la carte. Sans JavaScript, tout reste des liens d'ancre. */
(function () {
  "use strict";
  var doc = document;
  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  var page = $(".cg-page");
  if (!page) return;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var wide = window.matchMedia("(min-width: 900px)");

  // Légende : repliée sur téléphone, toujours ouverte sur bureau.
  var legend = $(".cg-legend");
  function syncLegend() { if (legend && wide.matches) legend.setAttribute("open", ""); }
  if (legend) {
    if (!wide.matches) legend.removeAttribute("open");
    if (wide.addEventListener) wide.addEventListener("change", syncLegend);
  }

  function gap() { return wide.matches ? 84 : 140; }
  function open(el) { if (el && el.tagName === "DETAILS") el.open = true; }

  function go(id) {
    var el = doc.getElementById(id);
    if (!el) return;
    open(el);
    var y = el.getBoundingClientRect().top + window.pageYOffset - gap();
    window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
    if (window.history && history.replaceState) history.replaceState(null, "", "#" + id);
    var h = $(".cg-st, .cg-act-n, .cg-chap-h h2, h2", el);
    $$(".is-hit").forEach(function (x) { x.classList.remove("is-hit"); });
    el.classList.add("is-hit");
    setTimeout(function () { if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); } }, reduce ? 0 : 650);
    setTimeout(function () { el.classList.remove("is-hit"); }, 4000);
  }
  doc.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-go]");
    if (!t || !page.contains(t)) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    go(t.getAttribute("data-go"));
  });
  // Lien direct vers une activité repliée : on l'ouvre.
  function fromHash() { var id = decodeURIComponent((location.hash || "").slice(1)); if (id) open(doc.getElementById(id)); }
  window.addEventListener("hashchange", fromHash);
  fromHash();

  // Feuille de réservation : le formulaire défile dans .cg-form-body (le moteur remet seulement le défilement du <dialog> à zéro). À chaque ouverture ou fermeture, on le remet en haut.
  var sheet = doc.getElementById("cg-sheet");
  var body = sheet && $(".cg-form-body", sheet);
  if (sheet && body) {
    var top = function () { body.scrollTop = 0; };
    sheet.addEventListener("close", top);
    if (window.MutationObserver) new MutationObserver(function () { if (sheet.open) top(); }).observe(sheet, { attributes: true, attributeFilter: ["open"] });
  }

  // Repère mobile : fabriqué ici, il n'a de sens qu'avec JavaScript.
  var svg = $(".cg-sv");
  var mapEl = $(".cg-mapcol");
  var loc = null, locT = null, locDot = null;
  if (svg && mapEl && $("#cg-land")) {
    loc = doc.createElement("button");
    loc.type = "button";
    loc.className = "cg-loc";
    loc.setAttribute("aria-label", "Revenir à la carte");
    loc.innerHTML = '<span class="mm" aria-hidden="true"><svg viewBox="' + svg.getAttribute("viewBox") + '" preserveAspectRatio="none"><use href="#cg-land"/></svg><i style="left:50%;top:50%"></i></span><span class="lt"></span><span class="lm">Carte</span>';
    page.insertBefore(loc, page.firstChild);
    locT = $(".lt", loc);
    locDot = $("i", loc);
    loc.addEventListener("click", function () { mapEl.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); });
  }

  // Repère actif : la sortie qui passe sous la ligne de lecture. Un clic sur un repère allume aussi sa ligne de légende.
  var secs = $$("[data-grp]");
  var closeEl = $("#fin");
  var act = null;
  function setActive(k, id) {
    if (k !== act) {
      $$("[data-k]").forEach(function (n) { n.classList.toggle("is-on", !!k && n.getAttribute("data-k") === k); });
      act = k;
    }
    $$(".cg-lg").forEach(function (n) { n.classList.toggle("is-on", !!id && n.getAttribute("data-go") === id); });
  }
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var ref = window.innerHeight * (wide.matches ? 0.42 : 0.5), cur = null;
      for (var i = 0; i < secs.length; i++) { if (secs[i].getBoundingClientRect().top <= ref) cur = secs[i]; else break; }
      if (cur && closeEl && closeEl.getBoundingClientRect().top <= ref) cur = null;
      var k = cur ? cur.getAttribute("data-grp-k") : null;
      setActive(k, cur && cur.id);
      if (loc) {
        var past = mapEl.getBoundingClientRect().bottom < 64 && !!cur;
        loc.classList.toggle("is-on", past);
        if (cur) {
          locT.textContent = cur.getAttribute("data-t") || "";
          var dot = k ? $('.cg-dot[data-k="' + k + '"]') : null;
          if (locDot) {
            locDot.style.display = dot ? "" : "none";
            if (dot) { locDot.style.left = dot.getAttribute("data-x") + "%"; locDot.style.top = dot.getAttribute("data-y") + "%"; }
          }
        }
      }
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();
})();
