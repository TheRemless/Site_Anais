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

  /* ---------- Accordéons (event delegation) : FAQ (.acc-item) et replis mobile (.fold, voir system.css).
     data-accordion-mobile : replié seulement sous 900 px. Sous 900 px le bouton porte aria-expanded et
     aria-controls et le contenu replié est hidden ; au-delà le bouton sort de la tabulation (tabindex -1,
     sans aria-expanded) et le contenu est toujours visible. ---------- */
  function initAccordion() {
    var mobile = window.matchMedia("(max-width: 899px)");
    var desktop = { get matches() { return !mobile.matches; } };
    function setOpen(item, open) {
      item.classList.toggle("open", open);
      var btn = item.querySelector("[aria-expanded]");
      if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
      var body = item.querySelector(".fold-body");
      if (body) body.hidden = !open;
    }
    document.querySelectorAll("[data-accordion]").forEach(function (root) {
      var mobileOnly = root.hasAttribute("data-accordion-mobile");
      root.addEventListener("click", function (e) {
        var head = e.target.closest(".acc-head, .fold-head");
        if (!head || (mobileOnly && desktop.matches)) return;
        var item = head.closest(".acc-item, .fold");
        if (!item) return;
        var open = item.classList.contains("open");
        if (!root.hasAttribute("data-accordion-multi")) {
          root.querySelectorAll(".acc-item.open, .fold.open").forEach(function (i) { if (i !== item) setOpen(i, false); });
        }
        setOpen(item, !open);
      });
      if (mobileOnly) {
        var reflect = function () {
          root.querySelectorAll(".fold").forEach(function (item) {
            var btn = item.querySelector(".fold-btn, .fold-toggle");
            var body = item.querySelector(".fold-body");
            if (!btn || !body) return;
            if (desktop.matches) {
              btn.setAttribute("tabindex", "-1");
              btn.removeAttribute("aria-expanded");
              btn.removeAttribute("aria-controls");
              body.hidden = false;
            } else {
              var open = item.classList.contains("open");
              btn.removeAttribute("tabindex");
              btn.setAttribute("aria-expanded", open ? "true" : "false");
              btn.setAttribute("aria-controls", body.id);
              body.hidden = !open;
            }
          });
        };
        reflect();
        if (mobile.addEventListener) mobile.addEventListener("change", reflect); else if (mobile.addListener) mobile.addListener(reflect);
      }
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
      return { src: t.getAttribute("data-src") || t.querySelector("img").src, cap: t.getAttribute("data-caption") || "" };
    });
    var cur = 0;
    var box = el(
      '<div class="lightbox" role="dialog" aria-modal="true">' +
        '<button class="lb-close" aria-label="Fermer">✕</button>' +
        '<button class="lb-nav lb-prev" aria-label="Précédent">‹</button>' +
        '<figure class="lb-figure"><img alt=""><figcaption></figcaption></figure>' +
        '<button class="lb-nav lb-next" aria-label="Suivant">›</button>' +
      '</div>'
    );
    document.body.appendChild(box);
    var img = box.querySelector("img"), cap = box.querySelector("figcaption");
    function show(k) {
      cur = (k + items.length) % items.length;
      img.classList.remove("loaded");
      img.src = items[cur].src;
      img.onload = function () { img.classList.add("loaded"); };
      cap.textContent = items[cur].cap;
    }
    function open(k) { show(k); box.classList.add("open"); document.body.style.overflow = "hidden"; }
    function close() { box.classList.remove("open"); document.body.style.overflow = ""; }
    triggers.forEach(function (t, k) { t.addEventListener("click", function () { open(k); }); });
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

  /* ---------- Carte de l'accueil : conseil par épingle (bouton seulement si un texte existe) ---------- */
  function initMapTips() {
    var pins = [].slice.call(document.querySelectorAll(".tmap-pin[aria-controls]"));
    if (!pins.length) return;
    var sticky = null;
    function set(pin, open) {
      var tip = document.getElementById(pin.getAttribute("aria-controls"));
      if (!tip) return;
      tip.hidden = !open;
      pin.setAttribute("aria-expanded", open ? "true" : "false");
    }
    function closeAll() { pins.forEach(function (p) { set(p, false); }); sticky = null; }
    pins.forEach(function (pin) {
      pin.addEventListener("click", function () {
        var open = sticky !== pin;
        closeAll();
        if (open) {
          sticky = pin;
          set(pin, true);
          var tip = document.getElementById(pin.getAttribute("aria-controls"));
          var item = tip && tip.closest(".tmap-item");
          if (item && item.scrollIntoView) item.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
        }
      });
      pin.addEventListener("mouseenter", function () { if (!sticky) set(pin, true); });
      pin.addEventListener("mouseleave", function () { if (!sticky) set(pin, false); });
      pin.addEventListener("focus", function () { if (!sticky) set(pin, true); });
      pin.addEventListener("blur", function () { if (!sticky) set(pin, false); });
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && sticky) closeAll(); });
  }

  /* ---------- Carte de l'accueil sur téléphone : rail de photos relié aux pastilles ----------
     Actif seulement sous 900 px et si le rail défile vraiment. Chaque photo a une position de repos
     (centrée si possible, bornée aux deux bouts, d'où scroll-snap-align: center) ; la photo dont la position
     est la plus proche du défilement courant est la principale, sa pastille est mise en évidence.
     Toucher une pastille fait défiler le rail jusqu'à sa photo. Défilement lu au plus une fois par image (rAF). */
  function initMapRail() {
    var tmap = document.querySelector(".tmap");
    var rail = tmap && tmap.querySelector(".tmap-cards");
    if (!rail || !window.matchMedia) return;
    var mq = window.matchMedia("(max-width: 899px)");
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    var items = [].slice.call(rail.querySelectorAll(".tmap-item"));
    var pins = [].slice.call(tmap.querySelectorAll(".tmap-pin"));
    var bar = tmap.querySelector(".tmap-progress");
    var live = false, ticking = false, active = -1, stops = [];

    function measure() {
      var r = rail.getBoundingClientRect(), max = rail.scrollWidth - rail.clientWidth;
      stops = items.map(function (it) {
        var b = it.getBoundingClientRect();
        var x = b.left - r.left + rail.scrollLeft + b.width / 2 - rail.clientWidth / 2;
        return Math.max(0, Math.min(max, Math.round(x)));
      });
      if (bar) bar.style.setProperty("--tmap-vis", (rail.clientWidth / rail.scrollWidth * 100).toFixed(2) + "%");
    }
    function setActive(k) {
      if (k === active) return;
      active = k;
      pins.forEach(function (p, i) { p.classList.toggle("is-active", i === k); });
    }
    function update() {
      ticking = false;
      var x = rail.scrollLeft, best = 0, max = rail.scrollWidth - rail.clientWidth;
      for (var i = 1; i < stops.length; i++) if (Math.abs(stops[i] - x) < Math.abs(stops[best] - x)) best = i;
      setActive(best);
      if (bar) {
        var track = bar.clientWidth, seg = track * rail.clientWidth / rail.scrollWidth;
        bar.style.setProperty("--tmap-shift", (max > 0 ? x / max * (track - seg) : 0).toFixed(1) + "px");
      }
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    function go(i) {
      if (i < 0 || i >= stops.length) return;
      rail.scrollTo({ left: stops[i], behavior: reduce.matches ? "auto" : "smooth" });
    }
    function onPin(e) {
      var i = pins.indexOf(e.currentTarget);
      if (e.type === "keydown") {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
      }
      go(i);
    }
    function enable() {
      live = true;
      tmap.classList.add("is-live");
      rail.setAttribute("tabindex", "0");
      rail.setAttribute("aria-labelledby", "tmap-title");
      pins.forEach(function (p) {
        // Les pastilles avec conseil sont déjà des <button> (initMapTips, qui fait aussi défiler jusqu'à la photo).
        if (p.tagName === "BUTTON") return;
        p.setAttribute("role", "button");
        p.setAttribute("tabindex", "0");
        p.setAttribute("aria-label", (tmap.getAttribute("data-pin-label") || "") + " " + p.textContent.trim() + " " + (p.getAttribute("data-name") || ""));
        p.removeAttribute("aria-hidden");
        p.addEventListener("click", onPin);
        p.addEventListener("keydown", onPin);
      });
      rail.addEventListener("scroll", onScroll, { passive: true });
      measure();
      update();
    }
    function disable() {
      live = false;
      active = -1;
      tmap.classList.remove("is-live");
      rail.removeAttribute("tabindex");
      rail.removeAttribute("aria-labelledby");
      rail.removeEventListener("scroll", onScroll);
      pins.forEach(function (p) {
        p.classList.remove("is-active");
        if (p.tagName === "BUTTON") return;
        p.removeAttribute("role");
        p.removeAttribute("tabindex");
        p.removeAttribute("aria-label");
        p.setAttribute("aria-hidden", "true");
        p.removeEventListener("click", onPin);
        p.removeEventListener("keydown", onPin);
      });
    }
    function check() {
      var want = mq.matches && rail.scrollWidth > rail.clientWidth + 1;
      if (want && !live) enable();
      else if (!want && live) disable();
      else if (live) { measure(); update(); }
    }
    check();
    if (mq.addEventListener) mq.addEventListener("change", check); else if (mq.addListener) mq.addListener(check);
    var rt;
    window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(check, 150); });
  }

  /* ---------- Conversion tracking (GA4 events, consent-aware) ---------- */
  function track(name, params) {
    if (!window.ZW_analyticsOn) return; // pas de consentement : rien n'est envoyé ni mis en attente (consent.js)
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
    else { window.dataLayer = window.dataLayer || []; window.dataLayer.push(Object.assign({ event: name }, params || {})); }
  }
  function initTracking() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest("a");
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (/tally\.so/i.test(href)) track("preinscription_girls_trips", { link_url: href });
      else if (/contact\.html/i.test(href) && a.classList.contains("btn")) track("cta_devis_click", { link_text: (a.textContent || "").trim().slice(0, 60) });
    });
    var contactForm = document.querySelector("form[name='contact'], form[data-netlify]:not(.nl-form)");
    if (contactForm) contactForm.addEventListener("submit", function () { track("generate_lead", { form: "contact" }); });
    // newsletter_signup est envoyé par newsletter.js une fois l'inscription acceptée par Netlify.
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
    initMapTips();
    initMapRail();
    initReviewsRail();
    initTracking();
    initEvents();
    // Footer year
    var y = document.getElementById("footer-year");
    if (y) y.textContent = new Date().getFullYear();
  }


  /* ---------- Avis de l'accueil : la liste n'est focalisable au clavier que lorsqu'elle défile vraiment
     (rail horizontal sous 900 px) ; en grille sur bureau elle n'a pas besoin de tabindex. ---------- */
  function initReviewsRail() {
    var rail = document.querySelector(".reviews");
    if (!rail) return;
    function update() {
      if (rail.scrollWidth > rail.clientWidth) rail.setAttribute("tabindex", "0");
      else rail.removeAttribute("tabindex");
    }
    update();
    var rt;
    window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(update, 150); });
  }

  // Événements GA4 : clics WhatsApp, formulaires, liens vers Secret et Taxi, pré-inscription Girls Trips.
  // Envoyés par track(), donc seulement après consentement (consent.js). whatsapp_click n'est envoyé qu'ici.
  function initEvents() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest("a[href]");
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (href.indexOf("wa.me") !== -1) {
        track("whatsapp_click", { page_path: location.pathname, link_text: (a.textContent || "").trim().slice(0, 60) });
      } else if (href.indexOf("/secret/") === 0 || href.indexOf("/taxi/") === 0) {
        track("cross_brand_click", { page_path: location.pathname, destination: href });
      } else if (href.indexOf("tally.so") !== -1) {
        track("girls_trips_preregister", { page_path: location.pathname });
      } else if (href.indexOf("maps.app.goo.gl") !== -1) {
        track("google_reviews_click", { page_path: location.pathname });
      }
    });
    document.addEventListener("submit", function (e) {
      var f = e.target;
      if (f && f.tagName === "FORM") {
        track("form_submit", { page_path: location.pathname, form_name: f.getAttribute("name") || f.id || "form" });
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
