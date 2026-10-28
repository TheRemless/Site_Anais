/* Page /taxi/ : branche le formulaire « Request a transfer » au DOM.
   Choix rapides de la date, compteurs, sièges affichés selon les enfants et bébés, validation,
   puis ouverture de WhatsApp avec le message prêt. La logique pure est dans taxi-form.js. */
(function () {
  "use strict";

  var F = window.TAXI_FORM;
  var form = document.getElementById("taxi-form");
  if (!F || !form) return;

  var dateOther = document.getElementById("date-other");
  var KEYS = ["from", "to", "date", "adults"];
  var MAX_PEOPLE = 60;

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
      from: el("from").value,
      to: el("to").value,
      date_choice: dateChoice(),
      date_other: el("date_other").value,
      time: el("time").value,
      adults: el("adults").value,
      children: el("children").value,
      babies: el("babies").value,
      child_seat: el("child_seat").checked,
      baby_seat: el("baby_seat").checked
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

  function afterCountChange() {
    syncSeats();
    if (document.getElementById("e-adults").hidden === false) validateKey("adults");
  }

  Array.prototype.forEach.call(form.querySelectorAll("[data-step]"), function (button) {
    button.addEventListener("click", function () {
      var input = el(button.getAttribute("data-for"));
      var current = parseInt(input.value, 10);
      input.value = clamp(input, (isNaN(current) ? 0 : current) + Number(button.getAttribute("data-step")));
      afterCountChange();
    });
  });

  ["adults", "children", "babies"].forEach(function (name) {
    el(name).addEventListener("input", afterCountChange);
    el(name).addEventListener("blur", function () { validateKey("adults"); });
  });

  Array.prototype.forEach.call(form.querySelectorAll('[name="date_choice"]'), function (radio) {
    radio.addEventListener("change", function () {
      syncDate();
      validateKey("date");
    });
  });
  el("date_other").addEventListener("blur", function () { validateKey("date"); });
  el("date_other").addEventListener("change", function () { validateKey("date"); });

  ["from", "to"].forEach(function (key) {
    el(key).addEventListener("blur", function () { validateKey(key); });
    // Une fois l'erreur affichée, elle disparaît dès que la saisie devient valide.
    el(key).addEventListener("input", function () {
      if (el(key).getAttribute("aria-invalid") === "true") validateKey(key);
    });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var values = read();
    var errors = F.validate(values, today());
    KEYS.forEach(function (key) { showError(key, errors[key]); });

    var firstBad = KEYS.filter(function (key) { return errors[key]; })[0];
    if (firstBad) {
      target(firstBad).focus();
      return;
    }
    window.location.href = F.waUrl(F.buildMessage(values, today()));
  });

  // From et To : liste déroulante des lieux populaires. Elle s'ouvre au clic ou au focus, se réduit pendant la saisie
  // et laisse écrire n'importe quel lieu (hôtel, adresse). Pattern ARIA « combobox avec listbox ».
  function setupCombo(input) {
    var pop = input.parentNode.querySelector(".combo-pop");
    var items = Array.prototype.slice.call(pop.querySelectorAll("li"));
    var places = items.map(function (li) { return li.textContent; });
    var active = -1;

    function shown() {
      return items.filter(function (li) { return !li.hidden; });
    }

    function setActive(index) {
      var list = shown();
      items.forEach(function (li) { li.classList.remove("is-active"); li.removeAttribute("aria-selected"); });
      active = index;
      if (index < 0 || !list[index]) {
        active = -1;
        input.removeAttribute("aria-activedescendant");
        return;
      }
      list[index].classList.add("is-active");
      list[index].setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", list[index].id);
      list[index].scrollIntoView({ block: "nearest" });
    }

    function close() {
      pop.hidden = true;
      input.setAttribute("aria-expanded", "false");
      setActive(-1);
    }

    // exact : un lieu déjà choisi remontre toute la liste. Aucun résultat (lieu libre) : la liste se ferme.
    function open(exact) {
      var matches = F.filterPlaces(places, input.value, { showAllOnExact: exact });
      items.forEach(function (li) { li.hidden = matches.indexOf(li.textContent) === -1; });
      if (!matches.length) {
        close();
        return;
      }
      pop.hidden = false;
      input.setAttribute("aria-expanded", "true");
      setActive(-1);
    }

    function choose(li) {
      input.value = li.textContent;
      // Le champ est maintenant rempli : l'erreur éventuelle disparaît comme à la saisie.
      // L'événement rouvre la liste filtrée, donc la fermeture vient après.
      input.dispatchEvent(new Event("input", { bubbles: true }));
      close();
    }

    function reveal() {
      // Sur téléphone, le clavier cache le bas de l'écran : on remonte le champ pour voir la liste.
      if (window.innerWidth < 768) input.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    input.addEventListener("focus", function () { open(true); reveal(); });
    input.addEventListener("click", function () { if (pop.hidden) open(true); });
    input.addEventListener("input", function () { open(false); });
    input.addEventListener("blur", close);

    input.addEventListener("keydown", function (event) {
      var list = shown();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (pop.hidden) open(true);
        else setActive(active + 1 >= list.length ? 0 : active + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!pop.hidden) setActive(active <= 0 ? list.length - 1 : active - 1);
      } else if (event.key === "Enter" && !pop.hidden && active >= 0) {
        event.preventDefault();
        choose(list[active]);
      } else if (event.key === "Escape" && !pop.hidden) {
        event.preventDefault();
        close();
      }
    });

    // mousedown plutôt que click : le champ garde le focus, donc la liste ne se ferme pas avant le choix.
    pop.addEventListener("mousedown", function (event) {
      event.preventDefault();
      var li = event.target.closest ? event.target.closest("li") : null;
      if (li) choose(li);
    });
  }

  ["from", "to"].forEach(function (key) { setupCombo(el(key)); });

  syncDate();
  syncSeats();
})();
