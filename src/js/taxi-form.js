/* Page /taxi/ (VIP Taxi Lanta) : logique du formulaire « Request a transfer ».
   Même principe que le formulaire de transfert de /secret/ : le formulaire rédige un message
   WhatsApp que le visiteur envoie lui-même au numéro de Zwald (Anaïs). Rien n'est envoyé à
   un serveur, il n'y a ni nom ni téléphone à saisir. Champs : From, To, date en trois choix,
   heure, adultes, enfants, bébés, sièges. Pas de choix du transport ni de privé ou partagé :
   ce service est toujours privé.
   Exporté en CommonJS pour les tests (node --test) et exposé sur window pour la page. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TAXI_FORM = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WHATSAPP = "66958683846";
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

  function clean(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  // Date ISO choisie par le visiteur, ou "" tant qu'il n'a rien choisi.
  function resolveDate(choice, other, today) {
    if (choice === "today") return today;
    if (choice === "tomorrow") return addDays(today, 1);
    if (choice === "other") return clean(other);
    return "";
  }

  function formatDate(iso, today) {
    var d = toUTC(iso);
    var short = DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
    if (iso === today) return "Today (" + short + ")";
    if (iso === addDays(today, 1)) return "Tomorrow (" + short + ")";
    return short + " " + d.getUTCFullYear();
  }

  function num(value) {
    var n = Number(value);
    return n > 0 ? Math.floor(n) : 0;
  }

  // Âges utilisés par l'équipe : bébé jusqu'à 2 ans, enfant de 3 à 11 ans, adulte dès 12 ans.
  function buildMessage(v, today) {
    var lines = ["Hi VIP Taxi Lanta!", "I'd like a price for a transfer."];
    if (clean(v.name)) lines.push("Name: " + clean(v.name));
    var date = resolveDate(v.date_choice, v.date_other, today);
    var adults = num(v.adults);
    var children = num(v.children);
    var babies = num(v.babies);

    if (clean(v.from)) lines.push("From: " + clean(v.from));
    if (clean(v.to)) lines.push("To: " + clean(v.to));
    if (date && isRealDate(date)) lines.push("Date: " + formatDate(date, today));
    if (clean(v.time)) lines.push("Pickup time: " + clean(v.time));
    if (adults > 0) lines.push("Adults: " + adults);
    if (children > 0) lines.push("Children (3-11): " + children);
    if (babies > 0) lines.push("Babies (0-2): " + babies);
    // Un siège ne se demande que s'il y a un enfant ou un bébé : une case restée cochée
    // après avoir remis le compteur à zéro est ignorée.
    if (children > 0 && v.child_seat) lines.push("Child seat needed");
    if (babies > 0 && v.baby_seat) lines.push("Baby seat needed");
    return lines.join("\n");
  }

  function waUrl(message) {
    return "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(message);
  }

  function validate(v, today) {
    var errors = {};
    if (!clean(v.from)) errors.from = "Tell us where we pick you up.";
    if (!clean(v.to)) errors.to = "Tell us where you're going.";
    if (!(num(v.adults) > 0)) errors.adults = "At least one adult travels.";

    var date = resolveDate(v.date_choice, v.date_other, today);
    if (!date || !isRealDate(date)) errors.date = "Choose a date.";
    else if (date < today) errors.date = "This date has already passed.";
    if (clean(v.name).length < 2) errors.name = "Tell us your full name.";
    return errors;
  }

  // Minuscules sans accents, pour comparer ce que tape le visiteur aux lieux proposés.
  function fold(text) {
    return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  // Lieux de la liste déroulante qui contiennent la saisie, dans l'ordre d'origine. Champ vide : toute la liste.
  // Avec showAllOnExact, un lieu déjà choisi remontre toute la liste pour pouvoir en changer.
  function filterPlaces(places, query, options) {
    var q = fold(query);
    if (!q) return places.slice();
    if (options && options.showAllOnExact && places.some(function (p) { return fold(p) === q; })) return places.slice();
    return places.filter(function (p) { return fold(p).indexOf(q) !== -1; });
  }

  return {
    bangkokToday: bangkokToday,
    addDays: addDays,
    resolveDate: resolveDate,
    formatDate: formatDate,
    buildMessage: buildMessage,
    waUrl: waUrl,
    validate: validate,
    filterPlaces: filterPlaces
  };
});
