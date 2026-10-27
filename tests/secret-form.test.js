// tests/secret-form.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/js/secret-form.js");

const TODAY = "2026-11-14"; // un samedi

function baseState(overrides) {
  return Object.assign(
    {
      type: "transfer",
      dateChoice: "tomorrow",
      dateOther: "",
      hotel: "Lanta Sand Resort",
      transfer: { from: "Koh Lanta", to: "Krabi Airport", toOther: "", time: "10:30", people: 3, mode: "private" },
      boat: { tour: "4 Islands", adults: 2, children: 1, mode: "join-in" },
      activity: { activity: "Thai cooking class", people: 2 }
    },
    overrides
  );
}

test("bangkokToday : 23 h UTC est déjà le lendemain à Koh Lanta", () => {
  assert.equal(F.bangkokToday(new Date("2026-11-14T23:00:00Z")), "2026-11-15");
  assert.equal(F.bangkokToday(new Date("2026-11-14T10:00:00Z")), "2026-11-14");
});

test("addDays : passage de mois et d'année", () => {
  assert.equal(F.addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(F.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(F.addDays("2028-02-28", 1), "2028-02-29");
});

test("resolveDate : today, tomorrow, other, rien", () => {
  assert.equal(F.resolveDate("today", "", TODAY), "2026-11-14");
  assert.equal(F.resolveDate("tomorrow", "", TODAY), "2026-11-15");
  assert.equal(F.resolveDate("other", "2026-11-24", TODAY), "2026-11-24");
  assert.equal(F.resolveDate("other", "", TODAY), "");
  assert.equal(F.resolveDate("", "", TODAY), "");
});

test("formatDate : libellés relatifs et date complète", () => {
  assert.equal(F.formatDate("2026-11-14", TODAY), "Today (Sat 14 Nov)");
  assert.equal(F.formatDate("2026-11-15", TODAY), "Tomorrow (Sun 15 Nov)");
  assert.equal(F.formatDate("2026-11-24", TODAY), "Tue 24 Nov 2026");
});

test("buildMessage : transfert complet, une info par ligne", () => {
  assert.equal(
    F.buildMessage(baseState(), TODAY),
    [
      "Hi Secret Travel & Tour!",
      "I'd like a price for a transfer.",
      "From: Koh Lanta",
      "To: Krabi Airport",
      "Date: Tomorrow (Sun 15 Nov)",
      "Pickup or flight time: 10:30",
      "People: 3",
      "Private minivan",
      "Hotel or area: Lanta Sand Resort"
    ].join("\n")
  );
});

test("buildMessage : destination « Other » et champs vides omis", () => {
  const s = baseState({ hotel: "  " });
  s.transfer = { from: "Koh Lanta", to: "Other", toOther: "Koh Lipe pier", time: "", people: 1, mode: "shared" };
  assert.equal(
    F.buildMessage(s, TODAY),
    [
      "Hi Secret Travel & Tour!",
      "I'd like a price for a transfer.",
      "From: Koh Lanta",
      "To: Koh Lipe pier",
      "Date: Tomorrow (Sun 15 Nov)",
      "People: 1",
      "Shared minivan"
    ].join("\n")
  );
});

test("buildMessage : excursion en bateau, enfants à 0 omis", () => {
  const s = baseState({ type: "boat", dateChoice: "other", dateOther: "2026-11-24" });
  s.boat = { tour: "Koh Rok & Koh Haa", adults: 2, children: 0, mode: "private" };
  assert.equal(
    F.buildMessage(s, TODAY),
    [
      "Hi Secret Travel & Tour!",
      "I'd like a price for a boat tour: Koh Rok & Koh Haa.",
      "Date: Tue 24 Nov 2026",
      "Adults: 2",
      "Private boat",
      "Hotel or area: Lanta Sand Resort"
    ].join("\n")
  );
});

test("buildMessage : excursion partagée avec enfants", () => {
  const s = baseState({ type: "boat", dateChoice: "today" });
  assert.match(F.buildMessage(s, TODAY), /\nAdults: 2\nChildren: 1\nJoin-in trip\n/);
});

test("buildMessage : activité", () => {
  const s = baseState({ type: "activity", dateChoice: "today", hotel: "Long Beach" });
  assert.equal(
    F.buildMessage(s, TODAY),
    [
      "Hi Secret Travel & Tour!",
      "I'd like a price for an activity: Thai cooking class.",
      "Date: Today (Sat 14 Nov)",
      "People: 2",
      "Hotel or area: Long Beach"
    ].join("\n")
  );
});

test("waUrl : encode les retours à la ligne et les &", () => {
  const url = F.waUrl("Hi Secret Travel & Tour!\nPeople: 2");
  assert.equal(url, "https://wa.me/66958683846?text=Hi%20Secret%20Travel%20%26%20Tour!%0APeople%3A%202");
});

test("validate : formulaire complet sans erreur", () => {
  assert.deepEqual(F.validate(baseState(), TODAY), {});
});

test("validate : date manquante", () => {
  const errors = F.validate(baseState({ dateChoice: "" }), TODAY);
  assert.deepEqual(Object.keys(errors), ["date"]);
});

test("validate : autre date vide ou passée", () => {
  assert.ok(F.validate(baseState({ dateChoice: "other", dateOther: "" }), TODAY).date);
  assert.ok(F.validate(baseState({ dateChoice: "other", dateOther: "2026-11-13" }), TODAY).date);
});

test("validate : service manquant selon le type", () => {
  const t = baseState();
  t.transfer = Object.assign({}, t.transfer, { to: "" });
  assert.ok(F.validate(t, TODAY).to);

  const o = baseState();
  o.transfer = Object.assign({}, o.transfer, { to: "Other", toOther: " " });
  assert.ok(F.validate(o, TODAY).toOther);

  const b = baseState({ type: "boat" });
  b.boat = Object.assign({}, b.boat, { tour: "" });
  assert.ok(F.validate(b, TODAY).tour);

  const a = baseState({ type: "activity" });
  a.activity = Object.assign({}, a.activity, { activity: "" });
  assert.ok(F.validate(a, TODAY).activity);
});

test("restoreDraft : JSON invalide, vide ou version inconnue", () => {
  const now = new Date("2026-11-14T03:00:00Z");
  assert.equal(F.restoreDraft(null, now), null);
  assert.equal(F.restoreDraft("{oops", now), null);
  assert.equal(F.restoreDraft(JSON.stringify({ v: 99, savedAt: now.getTime(), state: baseState() }), now), null);
});

test("restoreDraft : brouillon récent restauré à l'identique", () => {
  const now = new Date("2026-11-14T03:00:00Z");
  const s = baseState({ dateChoice: "other", dateOther: "2026-11-20" });
  assert.deepEqual(F.restoreDraft(F.makeDraft(s, now), now), s);
});

test("restoreDraft : plus de 7 jours, brouillon ignoré", () => {
  const saved = new Date("2026-11-01T03:00:00Z");
  const now = new Date("2026-11-09T03:00:01Z");
  assert.equal(F.restoreDraft(F.makeDraft(baseState(), saved), now), null);
});

test("restoreDraft : une date relative ou passée n'est pas restaurée", () => {
  const saved = new Date("2026-11-14T03:00:00Z");
  const later = new Date("2026-11-16T03:00:00Z");
  const relative = F.restoreDraft(F.makeDraft(baseState({ dateChoice: "tomorrow" }), saved), later);
  assert.equal(relative.dateChoice, "");
  const past = F.restoreDraft(F.makeDraft(baseState({ dateChoice: "other", dateOther: "2026-11-15" }), saved), later);
  assert.equal(past.dateChoice, "");
  assert.equal(past.dateOther, "");
  assert.equal(past.hotel, "Lanta Sand Resort");
});

test("restoreDraft : « tomorrow » gardé si on revient le même jour", () => {
  const saved = new Date("2026-11-14T03:00:00Z");
  const sameDay = new Date("2026-11-14T09:00:00Z");
  assert.equal(F.restoreDraft(F.makeDraft(baseState({ dateChoice: "tomorrow" }), saved), sameDay).dateChoice, "tomorrow");
});
