/* =========================================================
   ZWALD TRAVEL PLANNER — site behaviour
   Nav + footer are hardcoded in each page's HTML (best for SEO);
   this file only wires up behaviour and animations.
   ========================================================= */
(function () {
  "use strict";

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  /* ---------- Swipe utility ---------- */
  function addSwipe(target, onLeft, onRight) {
    var startX;
    target.style.touchAction = "pan-y";
    target.addEventListener("pointerdown", function (e) {
      startX = e.clientX;
    });
    target.addEventListener("pointerup", function (e) {
      if (startX === undefined) return;
      var dx = e.clientX - startX;
      startX = undefined;
      if (Math.abs(dx) < 50) return;
      if (dx < 0) onLeft(); else onRight();
    });
  }

  /* ---------- Nav (mobile toggle + scroll state) ---------- */
  function attachNav() {
    var nav = document.querySelector(".nav");
    if (!nav) return;
    var toggle = nav.querySelector(".nav-toggle");
    var menu = document.querySelector(".mobile-menu");
    if (toggle) {
      toggle.addEventListener("click", function () {
        var open = document.body.classList.toggle("nav-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        document.body.style.overflow = open ? "hidden" : "";
      });
    }
    if (menu) {
      menu.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", function () {
          document.body.classList.remove("nav-open");
          document.body.style.overflow = "";
        });
      });
    }
    function onScroll() {
      if (window.scrollY > 30) nav.classList.add("scrolled");
      else nav.classList.remove("scrolled");
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- Scroll reveal ---------- */
  function initReveal() {
    var items = document.querySelectorAll("[data-reveal], .img-reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach(function (i) { i.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    items.forEach(function (i) { io.observe(i); });
  }

  /* ---------- Parallax ---------- */
  function initParallax() {
    var nodes = [].slice.call(document.querySelectorAll("[data-parallax]"));
    if (!nodes.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var ticking = false;
    function update() {
      var vh = window.innerHeight;
      nodes.forEach(function (n) {
        var speed = parseFloat(n.getAttribute("data-parallax")) || 0.2;
        var r = n.getBoundingClientRect();
        var center = r.top + r.height / 2;
        var offset = (center - vh / 2) * speed * -1;
        n.style.transform = "translate3d(0," + offset.toFixed(1) + "px,0)";
      });
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  /* ---------- Magnetic buttons ---------- */
  function initMagnetic() {
    if (window.matchMedia("(hover: none)").matches) return;
    document.querySelectorAll("[data-magnetic]").forEach(function (b) {
      b.addEventListener("mousemove", function (e) {
        var r = b.getBoundingClientRect();
        var x = e.clientX - r.left - r.width / 2;
        var y = e.clientY - r.top - r.height / 2;
        b.style.transform = "translate(" + x * 0.25 + "px," + y * 0.3 + "px)";
      });
      b.addEventListener("mouseleave", function () { b.style.transform = ""; });
    });
  }

  /* ---------- Counters ---------- */
  function initCounters() {
    var nodes = document.querySelectorAll("[data-count]");
    if (!nodes.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var node = e.target;
        io.unobserve(node);
        var target = parseFloat(node.getAttribute("data-count"));
        var suffix = node.getAttribute("data-suffix") || "";
        var prefix = node.getAttribute("data-prefix") || "";
        var dur = 1500, start = null;
        function step(ts) {
          if (!start) start = ts;
          var p = Math.min((ts - start) / dur, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          var val = target % 1 === 0 ? Math.round(target * eased) : (target * eased).toFixed(1);
          node.textContent = prefix + val + suffix;
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    }, { threshold: 0.5 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ---------- FAQ accordion (event delegation) ---------- */
  function initAccordion() {
    document.querySelectorAll("[data-accordion]").forEach(function (root) {
      /* Les en-têtes se comportent comme des boutons : clavier et lecteurs d'écran */
      function sync() {
        root.querySelectorAll(".acc-item").forEach(function (i) {
          var h = i.querySelector(".acc-head");
          if (h) h.setAttribute("aria-expanded", i.classList.contains("open") ? "true" : "false");
        });
      }
      root.querySelectorAll(".acc-head").forEach(function (h) {
        h.setAttribute("role", "button");
        h.setAttribute("tabindex", "0");
      });
      sync();
      root.addEventListener("click", function (e) {
        var head = e.target.closest(".acc-head");
        if (!head) return;
        var item = head.parentElement;
        var open = item.classList.contains("open");
        if (!root.hasAttribute("data-accordion-multi")) {
          root.querySelectorAll(".acc-item.open").forEach(function (i) { if (i !== item) i.classList.remove("open"); });
        }
        item.classList.toggle("open", !open);
        sync();
      });
      root.addEventListener("keydown", function (e) {
        var head = e.target.closest(".acc-head");
        if (!head || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        head.click();
      });
    });
  }

  /* ---------- Photo marquee — JS RAF loop + drag/swipe ---------- */
  function initMarquee() {
    document.querySelectorAll(".marquee").forEach(function (marquee) {
      var track = marquee.querySelector(".marquee-track");
      if (!track) return;

      /* Hand off to JS — kill CSS animation */
      track.style.animation = "none";

      var AUTO_SPEED = 1.2;   /* px per frame (~72px/s at 60fps) */
      var halfW = track.scrollWidth / 2;
      var x = 0;
      var vel = -AUTO_SPEED;
      var dragging = false;
      var hovered = false;
      var prevX = 0;
      var dragVel = 0;
      var dragDist = 0;       /* total distance dragged — blocks accidental clicks */

      /* Pause auto-scroll on hover (desktop) */
      marquee.addEventListener("mouseenter", function () { hovered = true; });
      marquee.addEventListener("mouseleave", function () { hovered = false; });

      /* Main animation loop */
      function tick() {
        if (!dragging && !hovered) {
          /* Ease vel toward AUTO_SPEED (absorbs drag momentum smoothly) */
          vel += (-AUTO_SPEED - vel) * 0.06;
          x += vel;
          /* Seamless loop */
          if (x <= -halfW) x += halfW;
          if (x > 0) x -= halfW;
          track.style.transform = "translateX(" + x + "px)";
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);

      /* Drag / swipe */
      marquee.addEventListener("pointerdown", function (e) {
        dragging = true;
        prevX = e.clientX;
        dragVel = 0;
        dragDist = 0;
        marquee.setPointerCapture(e.pointerId);
      });

      marquee.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        e.preventDefault();
        var dx = e.clientX - prevX;
        dragVel = dx;
        dragDist += Math.abs(dx);
        x += dx;
        if (x <= -halfW) x += halfW;
        if (x > 0) x -= halfW;
        track.style.transform = "translateX(" + x + "px)";
        prevX = e.clientX;
      }, { passive: false });

      function endDrag() {
        if (!dragging) return;
        dragging = false;
        vel = dragVel; /* hand off momentum to auto-loop */
      }
      marquee.addEventListener("pointerup", endDrag);
      marquee.addEventListener("pointercancel", function () {
        dragging = false;
        vel = -AUTO_SPEED;
      });

      /* Block lightbox opening if user was dragging, not tapping */
      marquee.addEventListener("click", function (e) {
        if (dragDist > 8) e.stopImmediatePropagation();
      }, true);
    });
  }

  /* ---------- Carousel (testimonials) ---------- */
  function initCarousel() {
    document.querySelectorAll("[data-carousel]").forEach(function (root) {
      var viewport = root.querySelector(".carousel-viewport");
      var slides = [].slice.call(root.querySelector(".carousel-track").children);
      var prev = root.querySelector("[data-prev]");
      var next = root.querySelector("[data-next]");
      var dotsWrap = root.querySelector(".carousel-dots");
      var i = 0, n = slides.length, timer;
      var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      var dots = slides.map(function (_, idx) {
        var d = el('<button class="carousel-dot" aria-label="Avis ' + (idx + 1) + '"></button>');
        d.addEventListener("click", function () { go(idx); rest(); });
        dotsWrap.appendChild(d);
        return d;
      });

      function go(idx) {
        i = (idx + n) % n;
        viewport.scrollTo({ left: i * viewport.clientWidth, behavior: still ? "auto" : "smooth" });
        dots.forEach(function (d, k) { d.classList.toggle("active", k === i); });
      }
      function rest() { clearInterval(timer); if (!still) timer = setInterval(function () { go(i + 1); }, 6500); }

      /* Sync dots when user swipes natively */
      viewport.addEventListener("scroll", function () {
        var snapped = Math.round(viewport.scrollLeft / viewport.clientWidth);
        if (snapped !== i && snapped >= 0 && snapped < n) {
          i = snapped;
          dots.forEach(function (d, k) { d.classList.toggle("active", k === i); });
          rest();
        }
      }, { passive: true });

      /* Trackpad/desktop horizontal scroll — body overflow-x:hidden blocks native wheel deltaX */
      viewport.addEventListener("wheel", function (e) {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          e.preventDefault();
          viewport.scrollLeft += e.deltaX;
        }
      }, { passive: false });

      if (prev) prev.addEventListener("click", function () { go(i - 1); rest(); });
      if (next) next.addEventListener("click", function () { go(i + 1); rest(); });
      go(0); rest();
    });
  }

  /* ---------- Lightbox ---------- */
  function initLightbox() {
    var triggers = [].slice.call(document.querySelectorAll("[data-lightbox]"));
    if (!triggers.length) return;
    var items = triggers.map(function (t) {
      var im = t.querySelector("img");
      return { src: t.getAttribute("data-src") || im.src, cap: t.getAttribute("data-caption") || "", alt: im ? im.alt : "" };
    });
    var en = /^en/i.test(document.documentElement.lang || "");
    var L = en ? { close: "Close", prev: "Previous", next: "Next", open: "Enlarge: " } : { close: "Fermer", prev: "Précédent", next: "Suivant", open: "Agrandir : " };
    var opener = null;
    var cur = 0;
    var box = el(
      '<div class="lightbox" role="dialog" aria-modal="true">' +
        '<button class="lb-close" aria-label="' + L.close + '">✕</button>' +
        '<button class="lb-nav lb-prev" aria-label="' + L.prev + '">‹</button>' +
        '<figure class="lb-figure"><img alt=""><figcaption></figcaption></figure>' +
        '<button class="lb-nav lb-next" aria-label="' + L.next + '">›</button>' +
      '</div>'
    );
    document.body.appendChild(box);
    var img = box.querySelector("img"), cap = box.querySelector("figcaption");
    function show(k) {
      cur = (k + items.length) % items.length;
      img.classList.remove("loaded");
      img.src = items[cur].src;
      img.alt = items[cur].alt;
      img.onload = function () { img.classList.add("loaded"); };
      cap.textContent = items[cur].cap;
    }
    function open(k) { opener = document.activeElement; show(k); box.classList.add("open"); document.body.style.overflow = "hidden"; box.querySelector(".lb-close").focus(); }
    function close() { box.classList.remove("open"); document.body.style.overflow = ""; if (opener && opener.focus) opener.focus(); }
    triggers.forEach(function (t, k) {
      t.addEventListener("click", function () { open(k); });
      if (t.tagName !== "A" && t.tagName !== "BUTTON") {
        t.setAttribute("role", "button"); t.setAttribute("tabindex", "0");
        if (items[k].alt) t.setAttribute("aria-label", L.open + items[k].alt);
        t.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(k); } });
      }
    });
    box.querySelector(".lb-close").addEventListener("click", close);
    box.querySelector(".lb-prev").addEventListener("click", function () { show(cur - 1); });
    box.querySelector(".lb-next").addEventListener("click", function () { show(cur + 1); });
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    addSwipe(box.querySelector(".lb-figure") || box, function () { show(cur + 1); }, function () { show(cur - 1); });
    document.addEventListener("keydown", function (e) {
      if (!box.classList.contains("open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") show(cur - 1);
      if (e.key === "ArrowRight") show(cur + 1);
    });
  }

  /* ---------- Conversion tracking (GA4 events, consent-aware) ---------- */
  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
    else { window.dataLayer = window.dataLayer || []; window.dataLayer.push(Object.assign({ event: name }, params || {})); }
  }
  function initTracking() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest("a");
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (/wa\.me|whatsapp/i.test(href)) track("whatsapp_click", { link_url: href });
      else if (/tally\.so/i.test(href)) track("preinscription_girls_trips", { link_url: href });
      else if (/contact\.html/i.test(href) && a.classList.contains("btn")) track("cta_devis_click", { link_text: (a.textContent || "").trim().slice(0, 60) });
    });
    var contactForm = document.querySelector("form[name='contact'], form[data-netlify]");
    if (contactForm) contactForm.addEventListener("submit", function () { track("generate_lead", { form: "contact" }); });
    var nlForm = document.querySelector("form.nl-form, form[data-newsletter]");
    if (nlForm) nlForm.addEventListener("submit", function () { track("newsletter_signup", {}); });
  }
  window.ZWALD_track = track;

  var _started = false;
  function start() {
    if (_started) return;
    _started = true;
    attachNav();
    // WhatsApp FAB delayed reveal
    var waFab = document.querySelector('.wa-fab');
    if (waFab) {
      setTimeout(function () { waFab.classList.add('visible'); }, 600);
    }
    // Hero entrance: drop the .pre state shortly after load so transitions play.
    // setTimeout (not rAF) so it fires even if the tab is backgrounded/throttled — content must never stay hidden.
    var hero = document.querySelector(".hero.pre");
    if (hero) { setTimeout(function () { hero.classList.remove("pre"); }, 80); }
    initReveal();
    initParallax();
    initMagnetic();
    initCounters();
    initAccordion();
    initCarousel();
    initMarquee();
    initLightbox();
    initTracking();
    initEvents();
    // Footer year
    var y = document.getElementById("footer-year");
    if (y) y.textContent = new Date().getFullYear();
  }


  // Événements GA4 : clics WhatsApp, formulaires, liens vers Secret et Taxi, pré-inscription Girls Trips.
  // gtag() existe toujours (consent mode) ; sans consentement, les événements restent sans cookie.
  function initEvents() {
    if (typeof window.gtag !== "function") return;
    document.addEventListener("click", function (e) {
      var a = e.target.closest("a[href]");
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (href.indexOf("wa.me") !== -1) {
        window.gtag("event", "whatsapp_click", { page_path: location.pathname, link_text: (a.textContent || "").trim().slice(0, 60) });
      } else if (href.indexOf("/secret/") === 0 || href.indexOf("/taxi/") === 0) {
        window.gtag("event", "cross_brand_click", { page_path: location.pathname, destination: href });
      } else if (href.indexOf("tally.so") !== -1) {
        window.gtag("event", "girls_trips_preregister", { page_path: location.pathname });
      } else if (href.indexOf("maps.app.goo.gl") !== -1) {
        window.gtag("event", "google_reviews_click", { page_path: location.pathname });
      }
    });
    document.addEventListener("submit", function (e) {
      var f = e.target;
      if (f && f.tagName === "FORM") {
        window.gtag("event", "form_submit", { page_path: location.pathname, form_name: f.getAttribute("name") || f.id || "form" });
      }
    });
  }

  // Backwards-compatible: pages call ZWALD.init(); options are now ignored. Idempotent.
  window.ZWALD = { init: start };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
