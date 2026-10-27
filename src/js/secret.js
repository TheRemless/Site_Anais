/* Page /secret/ : branchement du formulaire « What do you need? » sur la page.
   Onglets, choix de date, compteurs, brouillon gardé sur le téléphone, panneau du formulaire
   ouvert depuis le catalogue et bouton WhatsApp flottant. La logique pure est dans secret-form.js. */
(function () {
  "use strict";

  var F = window.SECRET_FORM;
  var DRAFT_KEY = "secret-form-v1";
  var SHEET_KEY = "secret-sheet-v1";

  var form = document.getElementById("ask");
  var slot = document.getElementById("ask-slot");
  var sheet = document.getElementById("sheet");
  var sheetBody = document.getElementById("sheet-body");
  var fab = document.getElementById("fab");
  if (!form || !F) return;

  var lastTrigger = null;

  /* Stockage : peut être indisponible (navigation privée, stockage bloqué). */
  function store(area, key, value) {
    try {
      if (value === null) window[area].removeItem(key);
      else window[area].setItem(key, value);
    } catch (e) { /* le formulaire marche sans sauvegarde */ }
  }
  function read(area, key) {
    try { return window[area].getItem(key); } catch (e) { return null; }
  }

  function el(name) { return form.elements[name]; }
  function radio(name) {
    var checked = form.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : "";
  }
  function setRadio(name, value) {
    form.querySelectorAll('input[name="' + name + '"]').forEach(function (input) {
      input.checked = input.value === value;
    });
  }
  function num(name) {
    var n = parseInt(el(name).value, 10);
    return isNaN(n) ? 0 : n;
  }
  function selectValue(name, value) {
    var select = el(name);
    var exists = Array.prototype.some.call(select.options, function (o) { return o.value === value; });
    if (exists) select.value = value;
  }

  function getState() {
    return {
      type: radio("type") || "transfer",
      dateChoice: radio("dateChoice"),
      dateOther: el("dateOther").value,
      hotel: el("hotel").value,
      transfer: {
        from: el("t-from").value,
        to: el("t-to").value,
        toOther: el("t-toOther").value,
        time: el("t-time").value,
        people: num("t-people"),
        mode: radio("t-mode") || "private"
      },
      boat: { tour: el("b-tour").value, adults: num("b-adults"), children: num("b-children"), mode: radio("b-mode") || "private" },
      activity: { activity: el("a-activity").value, people: num("a-people") }
    };
  }

  function setState(s) {
    setRadio("type", s.type);
    setRadio("dateChoice", s.dateChoice);
    el("dateOther").value = s.dateOther || "";
    el("hotel").value = s.hotel || "";
    selectValue("t-from", s.transfer.from);
    selectValue("t-to", s.transfer.to);
    el("t-toOther").value = s.transfer.toOther || "";
    el("t-time").value = s.transfer.time || "";
    el("t-people").value = s.transfer.people;
    setRadio("t-mode", s.transfer.mode);
    selectValue("b-tour", s.boat.tour);
    el("b-adults").value = s.boat.adults;
    el("b-children").value = s.boat.children;
    setRadio("b-mode", s.boat.mode);
    selectValue("a-activity", s.activity.activity);
    el("a-people").value = s.activity.people;
  }

  /* Affiche seulement les champs du type choisi. Les groupes masqués sont aussi désactivés
     pour que le navigateur les ignore. */
  function refresh() {
    var type = radio("type") || "transfer";
    form.querySelectorAll(".group").forEach(function (group) {
      var on = group.getAttribute("data-for") === type;
      group.hidden = !on;
      group.disabled = !on;
    });
    form.querySelector('[data-show-when="other"]').hidden = !(type === "transfer" && el("t-to").value === "Other");
    form.querySelector('[data-show-when="other-date"]').hidden = radio("dateChoice") !== "other";
    el("dateOther").min = F.bangkokToday(new Date());
  }

  function save() {
    store("localStorage", DRAFT_KEY, F.makeDraft(getState(), new Date()));
  }

  /* Erreurs affichées sous chaque champ, focus sur le premier champ fautif. */
  var ERROR_FIELDS = { to: "t-to", toOther: "t-toOther", tour: "b-tour", activity: "a-activity", date: "dateChoice" };
  function clearErrors() {
    form.querySelectorAll(".err").forEach(function (p) { p.hidden = true; p.textContent = ""; });
    form.querySelectorAll("[aria-invalid]").forEach(function (f) { f.removeAttribute("aria-invalid"); });
  }
  function showErrors(errors) {
    clearErrors();
    var first = null;
    Object.keys(errors).forEach(function (key) {
      var p = document.getElementById("err-" + key);
      if (p) {
        p.textContent = errors[key];
        p.hidden = false;
        p.setAttribute("role", "alert");
      }
      var field = key === "date"
        ? (radio("dateChoice") === "other" ? el("dateOther") : form.querySelector('input[name="dateChoice"]'))
        : el(ERROR_FIELDS[key]);
      if (field) {
        if (key !== "date" || field.name === "dateOther") field.setAttribute("aria-invalid", "true");
        if (!first) first = field;
      }
    });
    if (first) first.focus();
  }

  form.addEventListener("input", function () { refresh(); save(); });
  form.addEventListener("change", function () {
    refresh();
    save();
    if (radio("dateChoice") === "other" && document.activeElement && document.activeElement.name === "dateChoice") {
      el("dateOther").focus();
    }
  });

  form.addEventListener("click", function (event) {
    var button = event.target.closest("[data-step]");
    if (!button) return;
    var input = button.parentNode.querySelector("input");
    var next = (parseInt(input.value, 10) || 0) + parseInt(button.getAttribute("data-step"), 10);
    input.value = Math.min(parseInt(input.max, 10), Math.max(parseInt(input.min, 10), next));
    save();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var state = getState();
    var today = F.bangkokToday(new Date());
    var errors = F.validate(state, today);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    clearErrors();
    save();
    // Le brouillon est gardé : si WhatsApp ne s'ouvre pas, rien n'est perdu.
    window.location.href = F.waUrl(F.buildMessage(state, today));
  });

  document.getElementById("clear-form").addEventListener("click", function () {
    form.reset();
    store("localStorage", DRAFT_KEY, null);
    clearErrors();
    refresh();
  });

  /* Panneau : l'unique formulaire de la page est déplacé dans le <dialog>, puis remis à sa place.
     La hauteur de son emplacement est gardée pour que la page ne saute pas. */
  function openSheet(trigger) {
    if (!sheet || typeof sheet.showModal !== "function") return false;
    lastTrigger = trigger || null;
    if (!sheet.open) {
      slot.style.minHeight = slot.offsetHeight + "px";
      sheetBody.appendChild(form);
      sheet.showModal();
    }
    store("sessionStorage", SHEET_KEY, "open");
    if (fab) fab.hidden = true;
    return true;
  }

  function onSheetClosed() {
    slot.appendChild(form);
    slot.style.minHeight = "";
    store("sessionStorage", SHEET_KEY, null);
    updateFab();
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
    lastTrigger = null;
  }

  if (sheet) {
    sheet.addEventListener("close", onSheetClosed);
    document.getElementById("sheet-close").addEventListener("click", function () { sheet.close(); });
    // Un toucher sur le fond assombri (hors du panneau) ferme le panneau.
    sheet.addEventListener("click", function (event) {
      if (event.target !== sheet) return;
      var r = sheet.getBoundingClientRect();
      var inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      if (!inside) sheet.close();
    });
    // Glisser l'en-tête du panneau vers le bas le ferme.
    var head = sheet.querySelector(".sheet-head");
    var startY = null;
    head.addEventListener("touchstart", function (e) { startY = e.touches[0].clientY; }, { passive: true });
    head.addEventListener("touchmove", function (e) {
      if (startY === null) return;
      var dy = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = "translateY(" + dy + "px)";
    }, { passive: true });
    head.addEventListener("touchend", function (e) {
      if (startY === null) return;
      var dy = e.changedTouches[0].clientY - startY;
      startY = null;
      sheet.style.transform = "";
      if (dy > 80) sheet.close();
    });
  }

  /* Liens « Get a price » : présélectionnent le service et ouvrent le panneau.
     Sans <dialog> (très vieux navigateurs), on remonte au formulaire du haut. */
  var TYPE_FIELD = { transfer: "t-to", boat: "b-tour", activity: "a-activity" };
  document.addEventListener("click", function (event) {
    var link = event.target.closest("a.get[data-type]");
    if (!link) return;
    event.preventDefault();
    var type = link.getAttribute("data-type");
    setRadio("type", type);
    selectValue(TYPE_FIELD[type], link.getAttribute("data-value"));
    refresh();
    save();
    clearErrors();
    if (!openSheet(link)) form.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    var firstDate = form.querySelector('input[name="dateChoice"]:checked') || form.querySelector('input[name="dateChoice"]');
    firstDate.focus({ preventScroll: true });
  });

  /* Bouton flottant : seulement une fois le formulaire du haut dépassé, jamais quand le panneau est ouvert. */
  var formAbove = false;
  function updateFab() {
    if (fab) fab.hidden = !formAbove || (sheet && sheet.open);
  }
  if (fab && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      var e = entries[0];
      formAbove = !e.isIntersecting && e.boundingClientRect.top < 0;
      updateFab();
    }).observe(slot);
  }

  /* Restauration : brouillon du téléphone, puis panneau rouvert si la page a été rechargée pendant qu'il était ouvert. */
  var restored = F.restoreDraft(read("localStorage", DRAFT_KEY), new Date());
  if (restored) {
    try { setState(restored); } catch (e) { store("localStorage", DRAFT_KEY, null); }
  }
  refresh();
  if (read("sessionStorage", SHEET_KEY) === "open") openSheet(null);
})();
