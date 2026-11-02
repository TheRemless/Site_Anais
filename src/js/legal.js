/* =========================================================
   ZWALD TRAVEL PLANNER — legal pages table of contents
   Auto-builds a sticky "Sommaire" ("Contents" on English pages) from the <h2> sections and
   highlights the current section while scrolling. No per-page list to maintain.
   ========================================================= */
(function () {
  "use strict";

  var content = document.querySelector(".legal-content");
  var toc = document.querySelector(".legal-toc");
  if (!content || !toc) return;

  var heads = content.querySelectorAll("h2");
  if (heads.length < 2) return; // not worth a TOC for a single section

  function slug(text, i) {
    var s = text.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s ? "sec-" + s.slice(0, 40) : "sec-" + (i + 1);
  }

  var label = /^en\b/i.test(document.documentElement.lang || "") ? "Contents" : "Sommaire";
  var nav = document.createElement("nav");
  nav.className = "legal-toc-inner";
  nav.setAttribute("aria-label", label);

  var title = document.createElement("p");
  title.className = "legal-toc-title";
  title.textContent = label;
  nav.appendChild(title);

  var ul = document.createElement("ul");
  var links = [];

  heads.forEach(function (h, i) {
    if (!h.id) h.id = slug(h.textContent, i);
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.href = "#" + h.id;
    a.textContent = h.textContent;
    li.appendChild(a);
    ul.appendChild(li);
    links.push({ a: a, h: h });
  });

  nav.appendChild(ul);
  toc.appendChild(nav);

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          links.forEach(function (l) {
            l.a.classList.toggle("active", l.h === e.target);
          });
        }
      });
    }, { rootMargin: "-15% 0px -75% 0px" });
    links.forEach(function (l) { io.observe(l.h); });
  }
})();
