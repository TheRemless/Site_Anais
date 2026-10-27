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
      transfer: { from: "Lanta Sand Resort", to: "Krabi Airport", time: "10:30", adults: 2, children: 1, babies: 0, childSeat: true, babySeat: false, mode: "private" },
      boat: { tour: "4 Islands", adults: 2, children: 1, babies: 0, mode: "join-in" },
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

test("buildMessage : transfert complet, une info par ligne, sans hôtel", () => {
  assert.equal(
    F.buildMessage(baseState(), TODAY),
    [
      "Hi Secret Travel & Tour!",
      "I'd like a price for a transfer.",
      "From: Lanta Sand Resort",
      "To: Krabi Airport",
      "Date: Tomorrow (Sun 15 Nov)",
      "Pickup or flight time: 10:30",
      "Adults: 2",
      "Children (3-11): 1",
      "Child seat needed",
      "Private minivan"
    ].join("\n")
  );
});

test("buildMessage : transfert avec bébé et siège bébé, champs vides omis", () => {
  const s = baseState();
  s.transfer = { from: " Ao Nang ", to: "Koh Lanta", time: "", adults: 1, children: 0, babies: 1, childSeat: true, babySeat: true, mode: "shared" };
  assert.equal(
    F.buildMessage(s, TODAY),
    [
      "Hi Secret Travel & Tour!",
      "I'd like a price for a transfer.",
      "From: Ao Nang",
      "To: Koh Lanta",
      "Date: Tomorrow (Sun 15 Nov)",
      "Adults: 1",
      "Babies (0-2): 1",
      "Baby seat needed",
      "Shared minivan"
    ].join("\n")
  );
});

test("buildMessage : excursion en bateau, enfants à 0 omis", () => {
  const s = baseState({ type: "boat", dateChoice: "other", dateOther: "2026-11-24" });
  s.boat = { tour: "Koh Rok & Koh Haa", adults: 2, children: 0, babies: 0, mode: "private" };
  assert.equal(
    F.buildMessage(s, TODAY),
    [
      "Hi Secret Travel & Tour!",
      "I'd like a price for a boat tour: Koh Rok & Koh Haa.",
      "Date: Tue 24 Nov 2026",
      "Adults: 2",
      "Private boat",
      "Hotel or accommodation: Lanta Sand Resort"
    ].join("\n")
  );
});

test("buildMessage : excursion partagée avec enfants et bébé", () => {
  const s = baseState({ type: "boat", dateChoice: "today" });
  s.boat.babies = 1;
  assert.match(F.buildMessage(s, TODAY), /\nAdults: 2\nChildren \(3-11\): 1\nBabies \(0-2\): 1\nJoin-in trip\nHotel or accommodation: Lanta Sand Resort$/);
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
      "Hotel or accommodation: Long Beach"
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

test("validate : au moins un adulte", () => {
  const t = baseState();
  t.transfer = Object.assign({}, t.transfer, { adults: 0 });
  assert.ok(F.validate(t, TODAY).adults);
  const b = baseState({ type: "boat" });
  b.boat = Object.assign({}, b.boat, { adults: 0 });
  assert.ok(F.validate(b, TODAY).adults);
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
  t.transfer = Object.assign({}, t.transfer, { to: " " });
  assert.ok(F.validate(t, TODAY).to);

  const f = baseState();
  f.transfer = Object.assign({}, f.transfer, { from: "" });
  assert.ok(F.validate(f, TODAY).from);

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
