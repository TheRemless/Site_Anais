/* Page /secret/ : branchement du formulaire « What do you need? » sur la page.
   Onglets, choix de date, compteurs, brouillon gardé sur le téléphone et liens « Get a price »
   qui mènent au formulaire. La logique pure est dans secret-form.js. */
(function () {
  "use strict";

  var F = window.SECRET_FORM;
  var DRAFT_KEY = "secret-form-v1";

  var form = document.getElementById("ask");
  if (!form || !F) return;


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
        time: el("t-time").value,
        adults: num("t-adults"),
        children: num("t-children"),
        babies: num("t-babies"),
        vehicle: radio("t-vehicle") || "minivan",
        childSeat: el("t-childSeat").checked,
        babySeat: el("t-babySeat").checked,
        mode: radio("t-mode") || "private"
      },
      boat: {
        tour: el("b-tour").value,
        adults: num("b-adults"),
        children: num("b-children"),
        babies: num("b-babies"),
        mode: radio("b-mode") || "private"
      },
      activity: { activity: el("a-activity").value, people: num("a-people") }
    };
  }

  function setState(s) {
    setRadio("type", s.type);
    setRadio("dateChoice", s.dateChoice);
    el("dateOther").value = s.dateOther || "";
    el("hotel").value = s.hotel || "";
    el("t-from").value = s.transfer.from || "";
    el("t-to").value = s.transfer.to || "";
    el("t-time").value = s.transfer.time || "";
    el("t-adults").value = s.transfer.adults;
    el("t-children").value = s.transfer.children;
    el("t-babies").value = s.transfer.babies;
    el("t-childSeat").checked = !!s.transfer.childSeat;
    el("t-babySeat").checked = !!s.transfer.babySeat;
    setRadio("t-mode", s.transfer.mode);
    setRadio("t-vehicle", s.transfer.vehicle || "minivan");
    selectValue("b-tour", s.boat.tour);
    el("b-adults").value = s.boat.adults;
    el("b-children").value = s.boat.children;
    el("b-babies").value = s.boat.babies;
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
    // Pour un transfert, le lieu de prise en charge est déjà dans « From ».
    var hotel = document.getElementById("hotel-field");
    hotel.hidden = type === "transfer";
    el("hotel").disabled = type === "transfer";
    // Les sièges enfant et bébé ne concernent que le minivan,
    // et chaque case n'apparaît que s'il y a au moins un enfant ou un bébé.
    form.querySelector('[data-show-when="minivan"]').hidden = radio("t-vehicle") === "speedboat";
    form.querySelector('[data-show-when="children"]').hidden = num("t-children") < 1;
    form.querySelector('[data-show-when="babies"]').hidden = num("t-babies") < 1;
    form.querySelector('[data-show-when="other-date"]').hidden = radio("dateChoice") !== "other";
    el("dateOther").min = F.bangkokToday(new Date());
  }

  function save() {
    store("localStorage", DRAFT_KEY, F.makeDraft(getState(), new Date()));
  }

  /* Erreurs affichées sous chaque champ, focus sur le premier champ fautif. */
  var ERROR_FIELDS = { from: "t-from", to: "t-to", tour: "b-tour", activity: "a-activity", date: "dateChoice" };
  function errorTarget(key) {
    if (key !== "adults") return { id: "err-" + key, field: ERROR_FIELDS[key] };
    return radio("type") === "boat" ? { id: "err-adults-boat", field: "b-adults" } : { id: "err-adults", field: "t-adults" };
  }
  function clearErrors() {
    form.querySelectorAll(".err").forEach(function (p) { p.hidden = true; p.textContent = ""; });
    form.querySelectorAll("[aria-invalid]").forEach(function (f) { f.removeAttribute("aria-invalid"); });
  }
  function showErrors(errors) {
    clearErrors();
    var first = null;
    Object.keys(errors).forEach(function (key) {
      var target = errorTarget(key);
      var p = document.getElementById(target.id);
      if (p) {
        p.textContent = errors[key];
        p.hidden = false;
        p.setAttribute("role", "alert");
      }
      var field = key === "date"
        ? (radio("dateChoice") === "other" ? el("dateOther") : form.querySelector('input[name="dateChoice"]'))
        : el(target.field);
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
    refresh();
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

  /* Liens « Get a price » : présélectionnent le service et descendent jusqu'au formulaire. */
  var TYPE_FIELD = { transfer: "t-to", boat: "b-tour", activity: "a-activity" };
  function preselect(type, value) {
    var field = el(TYPE_FIELD[type]);
    if (field.tagName === "SELECT") selectValue(TYPE_FIELD[type], value);
    else field.value = value;
  }
  document.addEventListener("click", function (event) {
    var link = event.target.closest("a.get[data-type], a[data-open-form]");
    if (!link) return;
    event.preventDefault();
    var type = link.getAttribute("data-type");
    if (type) {
      setRadio("type", type);
      if (link.getAttribute("data-value")) preselect(type, link.getAttribute("data-value"));
    }
    refresh();
    save();
    clearErrors();
    // Saut direct : le défilement animé ne se déclenche pas partout et laissait parfois la page sur place.
    document.getElementById("tell-us").scrollIntoView({ block: "start" });
    var firstDate = form.querySelector('input[name="dateChoice"]:checked') || form.querySelector('input[name="dateChoice"]');
    firstDate.focus({ preventScroll: true });
  });

  /* Restauration du brouillon gardé sur le téléphone. */
  var restored = F.restoreDraft(read("localStorage", DRAFT_KEY), new Date());
  if (restored) {
    try { setState(restored); } catch (e) { store("localStorage", DRAFT_KEY, null); }
  }
  refresh();
})();
