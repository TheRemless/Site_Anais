/* Page /secret/ (Secret Travel & Tour) : logique du formulaire « What do you need? ».
   Rédige le message WhatsApp, calcule les dates à l'heure de Koh Lanta, valide la saisie
   et lit ou écrit le brouillon gardé sur le téléphone du visiteur.
   Exporté en CommonJS pour les tests (node --test) et exposé sur window pour la page. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SECRET_FORM = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WHATSAPP = "66958683846";
  var DRAFT_VERSION = 2;
  var DRAFT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Les « Today » et « Tomorrow » doivent suivre l'heure de Koh Lanta, pas celle du téléphone,
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

  function resolveDate(choice, other, today) {
    if (choice === "today") return today;
    if (choice === "tomorrow") return addDays(today, 1);
    if (choice === "other") return other || "";
    return "";
  }

  function formatDate(iso, today) {
    var d = toUTC(iso);
    var short = DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
    if (iso === today) return "Today (" + short + ")";
    if (iso === addDays(today, 1)) return "Tomorrow (" + short + ")";
    return short + " " + d.getUTCFullYear();
  }

  function clean(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  // Âges utilisés par l'équipe : bébé jusqu'à 2 ans, enfant de 3 à 11 ans, adulte dès 12 ans.
  function travellers(lines, group) {
    if (group.adults > 0) lines.push("Adults: " + group.adults);
    if (group.children > 0) lines.push("Children (3-11): " + group.children);
    if (group.babies > 0) lines.push("Babies (0-2): " + group.babies);
  }

  function buildMessage(state, today) {
    var lines = ["Hi Secret Travel & Tour!"];
    var date = resolveDate(state.dateChoice, state.dateOther, today);
    var dateLine = date ? "Date: " + formatDate(date, today) : "";

    if (state.type === "transfer") {
      var t = state.transfer;
      lines.push("I'd like a price for a transfer.");
      if (clean(t.from)) lines.push("From: " + clean(t.from));
      if (clean(t.to)) lines.push("To: " + clean(t.to));
      if (dateLine) lines.push(dateLine);
      if (clean(t.time)) lines.push("Pickup or flight time: " + clean(t.time));
      travellers(lines, t);
      if (t.children > 0 && t.childSeat) lines.push("Child seat needed");
      if (t.babies > 0 && t.babySeat) lines.push("Baby seat needed");
      lines.push(t.mode === "shared" ? "Shared minivan" : "Private minivan");
    } else if (state.type === "boat") {
      var b = state.boat;
      lines.push("I'd like a price for a boat tour: " + clean(b.tour) + ".");
      if (dateLine) lines.push(dateLine);
      travellers(lines, b);
      lines.push(b.mode === "join-in" ? "Join-in trip" : "Private boat");
    } else {
      var a = state.activity;
      lines.push("I'd like a price for an activity: " + clean(a.activity) + ".");
      if (dateLine) lines.push(dateLine);
      if (a.people > 0) lines.push("People: " + a.people);
    }

    // Pour un transfert, le lieu de prise en charge est déjà dans « From ».
    if (state.type !== "transfer" && clean(state.hotel)) lines.push("Hotel or accommodation: " + clean(state.hotel));
    return lines.join("\n");
  }

  function waUrl(message) {
    return "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(message);
  }

  function validate(state, today) {
    var errors = {};
    if (state.type === "transfer") {
      if (!clean(state.transfer.from)) errors.from = "Tell us where we pick you up.";
      if (!clean(state.transfer.to)) errors.to = "Tell us where you're going.";
      if (!(state.transfer.adults > 0)) errors.adults = "At least one adult travels.";
    } else if (state.type === "boat") {
      if (!clean(state.boat.tour)) errors.tour = "Choose a boat tour.";
      if (!(state.boat.adults > 0)) errors.adults = "At least one adult joins the tour.";
    } else if (!clean(state.activity.activity)) {
      errors.activity = "Choose an activity.";
    }

    var date = resolveDate(state.dateChoice, state.dateOther, today);
    if (!date) errors.date = "Choose a date.";
    else if (date < today) errors.date = "This date has already passed.";
    return errors;
  }

  function makeDraft(state, now) {
    return JSON.stringify({ v: DRAFT_VERSION, savedAt: now.getTime(), day: bangkokToday(now), state: state });
  }

  function restoreDraft(raw, now) {
    if (!raw) return null;
    var draft;
    try {
      draft = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!draft || draft.v !== DRAFT_VERSION || !draft.state || typeof draft.savedAt !== "number") return null;
    if (now.getTime() - draft.savedAt > DRAFT_MAX_AGE) return null;

    var state = draft.state;
    var today = bangkokToday(now);
    var relative = state.dateChoice === "today" || state.dateChoice === "tomorrow";
    var stale = relative ? draft.day !== today : state.dateChoice === "other" && state.dateOther < today;
    if (stale) {
      state.dateChoice = "";
      state.dateOther = "";
    }
    return state;
  }

  return {
    bangkokToday: bangkokToday,
    addDays: addDays,
    resolveDate: resolveDate,
    formatDate: formatDate,
    buildMessage: buildMessage,
    waUrl: waUrl,
    validate: validate,
    makeDraft: makeDraft,
    restoreDraft: restoreDraft
  };
});
