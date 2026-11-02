/* Newsletter : envoi vers Netlify Forms sans rechargement (form-name newsletter-fr ou newsletter-en,
   lu dans le champ caché). Sans JavaScript, le formulaire part normalement et Netlify renvoie sur
   la page de remerciement de la langue (/newsletter-merci/ ou /en/newsletter-thanks/). */
(function () {
  "use strict";
  var form = document.querySelector("form.nl-form");
  if (!form || !window.fetch) return;
  var success = form.parentNode.querySelector(".nl-success");
  var error = form.querySelector(".nl-error");
  var button = form.querySelector("button[type='submit']");
  var label = button ? button.querySelector("span") : null;
  var idle = label ? label.textContent : "";
  var sending = form.getAttribute("data-sending") || idle;

  function done() {
    if (window.ZWALD_track) window.ZWALD_track("newsletter_signup", {});
    form.hidden = true;
    if (success) { success.classList.add("is-shown"); success.focus(); }
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (error) error.hidden = true;
    if (button) button.disabled = true;
    if (label) label.textContent = sending;
    var body = new URLSearchParams(new FormData(form)).toString();
    fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        done();
      })
      .catch(function () { if (error) error.hidden = false; })
      .finally(function () {
        if (button) button.disabled = false;
        if (label) label.textContent = idle;
      });
  });
})();
