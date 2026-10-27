/* Page /taxi/ : branche le formulaire « Request a transfer » au DOM.
   Choix rapides de la date, compteurs, sièges affichés selon les enfants et bébés,
   validation à la perte du focus et à l'envoi, envoi par fetch vers Netlify Forms et
   message de confirmation à la place du formulaire. La logique pure est dans taxi-form.js. */
(function () {
  "use strict";

  var F = window.TAXI_FORM;
  var form = document.getElementById("taxi-form");
  if (!F || !form) return;

  var done = document.getElementById("done");
  var status = document.getElementById("form-status");
  var send = document.getElementById("send");
  var dateOther = document.getElementById("date-other");
  var KEYS = ["name", "phone", "from", "to", "date", "time", "adults", "consent"];
  var MAX_PEOPLE = 20;

  function el(name) {
    return form.querySelector('[name="' + name + '"]');
  }

  function today() {
    return F.bangkokToday(new Date());
  }

  function dateChoice() {
    var checked = form.querySelector('[name="date_choice"]:checked');
    return checked ? checked.value : "";
  }

  function read() {
    return {
      name: el("name").value,
      phone: el("phone").value,
      from: el("from").value,
      to: el("to").value,
      date_choice: dateChoice(),
      date_other: el("date_other").value,
      time: el("time").value,
      adults: el("adults").value,
      children: el("children").value,
      babies: el("babies").value,
      child_seat: el("child_seat").checked,
      baby_seat: el("baby_seat").checked,
      notes: el("notes").value,
      consent: el("consent").checked,
      bot_field: el("bot-field").value
    };
  }

  // Le champ qui reçoit le focus et l'attribut aria-invalid pour chaque clé d'erreur.
  function target(key) {
    if (key === "date") return dateChoice() === "other" ? el("date_other") : form.querySelector('[name="date_choice"]');
    return el(key);
  }

  function showError(key, message) {
    var box = document.getElementById("e-" + key);
    var input = target(key);
    if (message) {
      box.textContent = message;
      box.hidden = false;
      if (key !== "date" || dateChoice() === "other") input.setAttribute("aria-invalid", "true");
    } else {
      box.textContent = "";
      box.hidden = true;
      input.removeAttribute("aria-invalid");
    }
  }

  function validateKey(key) {
    showError(key, F.validate(read(), today())[key]);
  }

  function setStatus(message, bad) {
    status.textContent = message;
    status.className = bad ? "status bad" : "status";
  }

  // « Other date » ouvre le calendrier natif, limité à aujourd'hui et après (heure de Koh Lanta).
  el("date_other").min = today();
  function syncDate() {
    dateOther.hidden = dateChoice() !== "other";
  }

  // Un siège ne se propose que s'il y a un enfant ou un bébé.
  function syncSeats() {
    document.getElementById("seat-child").hidden = !(Number(el("children").value) > 0);
    document.getElementById("seat-baby").hidden = !(Number(el("babies").value) > 0);
  }

  function clamp(input, value) {
    var min = Number(input.min) || 0;
    return Math.max(min, Math.min(MAX_PEOPLE, value));
  }

  Array.prototype.forEach.call(form.querySelectorAll("[data-step]"), function (button) {
    button.addEventListener("click", function () {
      var input = el(button.getAttribute("data-for"));
      var current = parseInt(input.value, 10);
      input.value = clamp(input, (isNaN(current) ? 0 : current) + Number(button.getAttribute("data-step")));
      syncSeats();
      if (document.getElementById("e-adults").hidden === false) validateKey("adults");
    });
  });

  ["adults", "children", "babies"].forEach(function (name) {
    el(name).addEventListener("input", function () {
      syncSeats();
      if (document.getElementById("e-adults").hidden === false) validateKey("adults");
    });
    el(name).addEventListener("blur", function () {
      validateKey("adults");
    });
  });

  Array.prototype.forEach.call(form.querySelectorAll('[name="date_choice"]'), function (radio) {
    radio.addEventListener("change", function () {
      syncDate();
      validateKey("date");
    });
  });
  el("date_other").addEventListener("blur", function () { validateKey("date"); });
  el("date_other").addEventListener("change", function () { validateKey("date"); });

  ["name", "phone", "from", "to", "time"].forEach(function (key) {
    el(key).addEventListener("blur", function () { validateKey(key); });
    // Une fois l'erreur affichée, elle disparaît dès que la saisie devient valide.
    el(key).addEventListener("input", function () {
      if (el(key).getAttribute("aria-invalid") === "true") validateKey(key);
    });
  });
  el("consent").addEventListener("change", function () { validateKey("consent"); });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var values = read();
    var errors = F.validate(values, today());
    KEYS.forEach(function (key) { showError(key, errors[key]); });

    var firstBad = KEYS.filter(function (key) { return errors[key]; })[0];
    if (firstBad) {
      setStatus("Please check the highlighted fields.", true);
      target(firstBad).focus();
      return;
    }

    send.disabled = true;
    setStatus("Sending your request…", false);

    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: F.encodeBody(values, today())
    })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        form.hidden = true;
        done.hidden = false;
        done.focus();
      })
      .catch(function () {
        setStatus("We could not send your request. Please check your connection and try again.", true);
        send.disabled = false;
      });
  });

  syncDate();
  syncSeats();
})();
