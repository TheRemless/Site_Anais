/* Page /taxi/ (VIP Taxi Lanta) : logique du formulaire « Request a transfer ».
   Calcule la date du jour à l'heure de Koh Lanta, valide la saisie et encode le corps
   envoyé à Netlify Forms. Exporté en CommonJS pour les tests (node --test) et exposé
   sur window pour la page. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TAXI_FORM = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FORM_NAME = "taxi";
  var MAX_PASSENGERS = 20;

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  // « Today » suit l'heure de Koh Lanta, pas celle du téléphone, qui peut être restée à
  // l'heure européenne.
  function bangkokToday(now) {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);
    var get = function (type) {
      return parts.filter(function (p) { return p.type === type; })[0].value;
    };
    return get("year") + "-" + get("month") + "-" + get("day");
  }

  function isRealDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    var p = iso.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }

  function validate(values, today) {
    var v = values || {};
    var errors = {};

    if (!trim(v.name)) errors.name = "Please enter your name.";

    var phone = trim(v.phone).replace(/[\s().-]/g, "");
    if (!/^\+?\d{7,15}$/.test(phone)) {
      errors.phone = "Enter your WhatsApp number with the country code, for example +33 6 12 34 56 78.";
    }

    var date = trim(v.date);
    if (!date) errors.date = "Choose your date of travel.";
    else if (!isRealDate(date)) errors.date = "Enter a valid date.";
    else if (date < today) errors.date = "Choose today or a later date.";

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trim(v.time))) errors.time = "Enter the pick-up or flight time.";

    var n = trim(v.passengers);
    if (!/^\d+$/.test(n) || Number(n) < 1 || Number(n) > MAX_PASSENGERS) {
      errors.passengers = "Enter a number from 1 to " + MAX_PASSENGERS + ".";
    }

    if (!trim(v.from)) errors.from = "Tell us where we pick you up.";
    if (!trim(v.to)) errors.to = "Tell us where you are going.";
    if (!v.consent) errors.consent = "Please tick the box so we can reply on WhatsApp.";

    return errors;
  }

  function encodeBody(values) {
    var v = values || {};
    var params = new URLSearchParams();
    params.set("form-name", FORM_NAME);
    params.set("bot-field", trim(v.bot_field));
    ["name", "phone", "date", "time", "passengers", "from", "to"].forEach(function (key) {
      params.set(key, trim(v[key]));
    });
    params.set("baby_seat", v.baby_seat ? "Yes" : "No");
    params.set("child_seat", v.child_seat ? "Yes" : "No");
    params.set("notes", trim(v.notes));
    params.set("consent", v.consent ? "Yes" : "No");
    return params.toString();
  }

  return {
    bangkokToday: bangkokToday,
    validate: validate,
    encodeBody: encodeBody
  };
});
