/* Page /taxi/ : branche le formulaire « Request a transfer » au DOM.
   Validation à la perte du focus et à l'envoi, envoi par fetch vers Netlify Forms,
   message de confirmation à la place du formulaire. La logique pure est dans taxi-form.js. */
(function () {
  "use strict";

  var F = window.TAXI_FORM;
  var form = document.getElementById("taxi-form");
  if (!F || !form) return;

  var done = document.getElementById("done");
  var status = document.getElementById("form-status");
  var send = document.getElementById("send");
  var KEYS = ["name", "phone", "date", "time", "passengers", "from", "to", "consent"];

  function el(key) {
    return form.querySelector('[name="' + key + '"]');
  }

  function today() {
    return F.bangkokToday(new Date());
  }

  function read() {
    return {
      name: el("name").value,
      phone: el("phone").value,
      date: el("date").value,
      time: el("time").value,
      passengers: el("passengers").value,
      from: el("from").value,
      to: el("to").value,
      baby_seat: el("baby_seat").checked,
      child_seat: el("child_seat").checked,
      notes: el("notes").value,
      consent: el("consent").checked,
      bot_field: el("bot-field").value
    };
  }

  function showError(key, message) {
    var box = document.getElementById("e-" + key);
    var input = el(key);
    if (message) {
      box.textContent = message;
      box.hidden = false;
      input.setAttribute("aria-invalid", "true");
    } else {
      box.textContent = "";
      box.hidden = true;
      input.removeAttribute("aria-invalid");
    }
  }

  function setStatus(message, bad) {
    status.textContent = message;
    status.className = bad ? "status bad" : "status";
  }

  // Une date passée ne doit pas pouvoir être choisie dans le calendrier natif.
  el("date").min = today();

  KEYS.forEach(function (key) {
    var input = el(key);
    var check = function () {
      showError(key, F.validate(read(), today())[key]);
    };
    input.addEventListener(input.type === "checkbox" ? "change" : "blur", check);
    // Une fois l'erreur affichée, elle disparaît dès que la saisie devient valide.
    input.addEventListener("input", function () {
      if (input.getAttribute("aria-invalid") === "true") check();
    });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var values = read();
    var errors = F.validate(values, today());
    KEYS.forEach(function (key) { showError(key, errors[key]); });

    var firstBad = KEYS.filter(function (key) { return errors[key]; })[0];
    if (firstBad) {
      setStatus("Please check the highlighted fields.", true);
      el(firstBad).focus();
      return;
    }

    send.disabled = true;
    setStatus("Sending your request…", false);

    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: F.encodeBody(values)
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
})();
