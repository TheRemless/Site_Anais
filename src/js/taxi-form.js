/* Page /taxi/ (VIP Taxi Lanta) : logique du formulaire « Request a transfer ».
   Mêmes champs que le formulaire de transfert de /secret/ (From, To, date en trois choix,
   heure, adultes, enfants, bébés, sièges), sans le choix du transport ni privé ou partagé :
   ce service est toujours privé et en voiture ou minivan. Calcule les dates à l'heure de
   Koh Lanta, valide la saisie et encode le corps envoyé à Netlify Forms.
   Exporté en CommonJS pour les tests (node --test) et exposé sur window pour la page. */
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

  // « Today » et « Tomorrow » suivent l'heure de Koh Lanta, pas celle du téléphone,
  // qui peut être restée à l'heure européenne.
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

  function toUTC(iso) {
    var p = iso.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  }

  function addDays(iso, n) {
    var d = toUTC(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function isRealDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    var p = iso.split("-").map(Number);
    var d = toUTC(iso);
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }

  // Date ISO choisie par le visiteur, ou "" tant qu'il n'a rien choisi.
  function resolveDate(choice, other, today) {
    if (choice === "today") return today;
    if (choice === "tomorrow") return addDays(today, 1);
    if (choice === "other") return trim(other);
    return "";
  }

  function count(value) {
    var s = trim(value);
    return /^\d+$/.test(s) ? Number(s) : NaN;
  }

  function validate(values, today) {
    var v = values || {};
    var errors = {};

    if (!trim(v.name)) errors.name = "Please enter your name.";

    var phone = trim(v.phone).replace(/[\s().-]/g, "");
    if (!/^\+?\d{7,15}$/.test(phone)) {
      errors.phone = "Enter your WhatsApp number with the country code, for example +33 6 12 34 56 78.";
    }

    if (!trim(v.from)) errors.from = "Tell us where we pick you up.";
    if (!trim(v.to)) errors.to = "Tell us where you are going.";

    var date = resolveDate(v.date_choice, v.date_other, today);
    if (!date) errors.date = "Choose your date of travel.";
    else if (!isRealDate(date)) errors.date = "Enter a valid date.";
    else if (date < today) errors.date = "Choose today or a later date.";

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trim(v.time))) errors.time = "Enter the pick-up or flight time.";

    // Une seule erreur pour les trois compteurs, affichée sous la rangée.
    var adults = count(v.adults);
    var children = trim(v.children) === "" ? 0 : count(v.children);
    var babies = trim(v.babies) === "" ? 0 : count(v.babies);
    if (isNaN(children) || isNaN(babies)) {
      errors.adults = "Use whole numbers for children and babies.";
    } else if (isNaN(adults) || adults < 1) {
      errors.adults = "We need at least 1 adult (12 or older).";
    } else if (adults + children + babies > MAX_PASSENGERS) {
      errors.adults = "We can take up to " + MAX_PASSENGERS + " passengers in total.";
    }

    if (!v.consent) errors.consent = "Please tick the box so we can reply on WhatsApp.";

    return errors;
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function summary(adults, children, babies) {
    var parts = [plural(adults, "adult", "adults")];
    if (children) parts.push(plural(children, "child", "children"));
    if (babies) parts.push(plural(babies, "baby", "babies"));
    return parts.join(", ");
  }

  function encodeBody(values, today) {
    var v = values || {};
    var adults = count(v.adults) || 0;
    var children = count(v.children) || 0;
    var babies = count(v.babies) || 0;
    var params = new URLSearchParams();
    params.set("form-name", FORM_NAME);
    params.set("bot-field", trim(v.bot_field));
    params.set("name", trim(v.name));
    params.set("phone", trim(v.phone));
    params.set("from", trim(v.from));
    params.set("to", trim(v.to));
    params.set("date", resolveDate(v.date_choice, v.date_other, today));
    params.set("time", trim(v.time));
    params.set("adults", String(adults));
    params.set("children", String(children));
    params.set("babies", String(babies));
    params.set("passengers", summary(adults, children, babies));
    // Un siège ne se demande que s'il y a un enfant ou un bébé : une case restée cochée
    // après avoir remis le compteur à zéro est ignorée.
    params.set("child_seat", children > 0 && v.child_seat ? "Yes" : "No");
    params.set("baby_seat", babies > 0 && v.baby_seat ? "Yes" : "No");
    params.set("notes", trim(v.notes));
    params.set("consent", v.consent ? "Yes" : "No");
    return params.toString();
  }

  return {
    bangkokToday: bangkokToday,
    addDays: addDays,
    resolveDate: resolveDate,
    validate: validate,
    encodeBody: encodeBody
  };
});
