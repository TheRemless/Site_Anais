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
  var DRAFT_VERSION = 1;
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

  function buildMessage(state, today) {
    var lines = ["Hi Secret Travel & Tour!"];
    var date = resolveDate(state.dateChoice, state.dateOther, today);
    var dateLine = date ? "Date: " + formatDate(date, today) : "";

    if (state.type === "transfer") {
      var t = state.transfer;
      var to = t.to === "Other" ? clean(t.toOther) : clean(t.to);
      lines.push("I'd like a price for a transfer.");
      if (clean(t.from)) lines.push("From: " + clean(t.from));
      if (to) lines.push("To: " + to);
      if (dateLine) lines.push(dateLine);
      if (clean(t.time)) lines.push("Pickup or flight time: " + clean(t.time));
      if (t.people > 0) lines.push("People: " + t.people);
      lines.push(t.mode === "shared" ? "Shared minivan" : "Private minivan");
    } else if (state.type === "boat") {
      var b = state.boat;
      lines.push("I'd like a price for a boat tour: " + clean(b.tour) + ".");
      if (dateLine) lines.push(dateLine);
      if (b.adults > 0) lines.push("Adults: " + b.adults);
      if (b.children > 0) lines.push("Children: " + b.children);
      lines.push(b.mode === "join-in" ? "Join-in trip" : "Private boat");
    } else {
      var a = state.activity;
      lines.push("I'd like a price for an activity: " + clean(a.activity) + ".");
      if (dateLine) lines.push(dateLine);
      if (a.people > 0) lines.push("People: " + a.people);
    }

    if (clean(state.hotel)) lines.push("Hotel or area: " + clean(state.hotel));
    return lines.join("\n");
  }

  function waUrl(message) {
    return "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(message);
  }

  function validate(state, today) {
    var errors = {};
    if (state.type === "transfer") {
      if (!clean(state.transfer.to)) errors.to = "Choose where you're going.";
      else if (state.transfer.to === "Other" && !clean(state.transfer.toOther)) {
        errors.toOther = "Tell us where you're going.";
      }
    } else if (state.type === "boat") {
      if (!clean(state.boat.tour)) errors.tour = "Choose a boat tour.";
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
