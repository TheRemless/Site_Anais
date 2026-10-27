const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/js/taxi-form.js");

const TODAY = "2026-11-14"; // un samedi

function valid(overrides) {
  return Object.assign(
    {
      name: "Claire Martin",
      phone: "+33 6 12 34 56 78",
      from: "Lanta Sand Resort",
      to: "Krabi Airport",
      date_choice: "tomorrow",
      date_other: "",
      time: "10:30",
      adults: "2",
      children: "1",
      babies: "0",
      child_seat: true,
      baby_seat: false,
      notes: "Flight TG123",
      consent: true,
      bot_field: ""
    },
    overrides
  );
}

test("bangkokToday : 23 h UTC est déjà le lendemain à Koh Lanta", () => {
  assert.equal(F.bangkokToday(new Date("2026-11-14T23:00:00Z")), "2026-11-15");
  assert.equal(F.bangkokToday(new Date("2026-11-14T10:00:00Z")), "2026-11-14");
});

test("addDays : passe le mois et l'année", () => {
  assert.equal(F.addDays("2026-11-14", 1), "2026-11-15");
  assert.equal(F.addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(F.addDays("2026-12-31", 1), "2027-01-01");
});

test("resolveDate : Today, Tomorrow et Other date", () => {
  assert.equal(F.resolveDate("today", "", TODAY), "2026-11-14");
  assert.equal(F.resolveDate("tomorrow", "", TODAY), "2026-11-15");
  assert.equal(F.resolveDate("other", "2026-12-24", TODAY), "2026-12-24");
  assert.equal(F.resolveDate("other", "", TODAY), "");
  assert.equal(F.resolveDate("", "", TODAY), "");
});

test("validate : une demande complète est valide", () => {
  assert.deepEqual(F.validate(valid(), TODAY), {});
});

test("validate : les champs obligatoires vides sont signalés", () => {
  const errors = F.validate(
    valid({ name: " ", phone: "", from: "", to: "", date_choice: "", time: "", adults: "", consent: false }),
    TODAY
  );
  assert.deepEqual(Object.keys(errors).sort(), ["adults", "consent", "date", "from", "name", "phone", "time", "to"]);
});

test("validate : Other date demande une date réelle, d'aujourd'hui ou plus tard", () => {
  assert.match(F.validate(valid({ date_choice: "other", date_other: "" }), TODAY).date, /Choose your date/);
  assert.match(F.validate(valid({ date_choice: "other", date_other: "2026-02-30" }), TODAY).date, /valid date/);
  assert.match(F.validate(valid({ date_choice: "other", date_other: "2026-11-13" }), TODAY).date, /today or a later date/);
  assert.equal(F.validate(valid({ date_choice: "other", date_other: TODAY }), TODAY).date, undefined);
});

test("validate : au moins un adulte, comptes entiers, 20 personnes au plus", () => {
  assert.match(F.validate(valid({ adults: "0" }), TODAY).adults, /at least 1 adult/);
  assert.match(F.validate(valid({ adults: "abc" }), TODAY).adults, /at least 1 adult/);
  assert.match(F.validate(valid({ children: "-1" }), TODAY).adults, /whole numbers/);
  assert.match(F.validate(valid({ babies: "1.5" }), TODAY).adults, /whole numbers/);
  assert.match(F.validate(valid({ adults: "15", children: "4", babies: "2" }), TODAY).adults, /20 passengers/);
  assert.equal(F.validate(valid({ adults: "20", children: "0", babies: "0" }), TODAY).adults, undefined);
});

test("validate : téléphone avec indicatif, espaces et tirets tolérés", () => {
  for (const ok of ["+33 6 12 34 56 78", "+66-95-868-3846", "0958683846", "(+66) 95 868 3846"]) {
    assert.equal(F.validate(valid({ phone: ok }), TODAY).phone, undefined, ok);
  }
  for (const bad of ["123", "abc", "+33 6 12 AB 56 78"]) {
    assert.match(F.validate(valid({ phone: bad }), TODAY).phone, /country code/, bad);
  }
});

test("validate : l'heure doit être au format HH:MM", () => {
  assert.equal(F.validate(valid({ time: "00:00" }), TODAY).time, undefined);
  assert.equal(F.validate(valid({ time: "23:59" }), TODAY).time, undefined);
  assert.match(F.validate(valid({ time: "24:00" }), TODAY).time, /pick-up or flight time/);
  assert.match(F.validate(valid({ time: "9h" }), TODAY).time, /pick-up or flight time/);
});

test("encodeBody : relisible par URLSearchParams, avec le nom du formulaire et la date résolue", () => {
  const params = new URLSearchParams(F.encodeBody(valid({ name: "  Zoë & Co  " }), TODAY));
  assert.equal(params.get("form-name"), "taxi");
  assert.equal(params.get("name"), "Zoë & Co");
  assert.equal(params.get("phone"), "+33 6 12 34 56 78");
  assert.equal(params.get("from"), "Lanta Sand Resort");
  assert.equal(params.get("to"), "Krabi Airport");
  assert.equal(params.get("date"), "2026-11-15");
  assert.equal(params.get("time"), "10:30");
  assert.equal(params.get("bot-field"), "");
});

test("encodeBody : la répartition des passagers est en clair", () => {
  const params = new URLSearchParams(F.encodeBody(valid({ adults: "2", children: "1", babies: "1" }), TODAY));
  assert.equal(params.get("adults"), "2");
  assert.equal(params.get("children"), "1");
  assert.equal(params.get("babies"), "1");
  assert.equal(params.get("passengers"), "2 adults, 1 child, 1 baby");
  const adultsOnly = new URLSearchParams(F.encodeBody(valid({ adults: "1", children: "0", babies: "0" }), TODAY));
  assert.equal(adultsOnly.get("passengers"), "1 adult");
});

test("encodeBody : un siège n'est demandé que s'il y a un enfant ou un bébé", () => {
  const withKids = new URLSearchParams(F.encodeBody(valid({ children: "1", babies: "1", child_seat: true, baby_seat: true }), TODAY));
  assert.equal(withKids.get("child_seat"), "Yes");
  assert.equal(withKids.get("baby_seat"), "Yes");
  // Case restée cochée après avoir remis les compteurs à zéro : ignorée.
  const noKids = new URLSearchParams(F.encodeBody(valid({ children: "0", babies: "0", child_seat: true, baby_seat: true }), TODAY));
  assert.equal(noKids.get("child_seat"), "No");
  assert.equal(noKids.get("baby_seat"), "No");
});

test("encodeBody : consentement en Yes ou No", () => {
  assert.equal(new URLSearchParams(F.encodeBody(valid(), TODAY)).get("consent"), "Yes");
  assert.equal(new URLSearchParams(F.encodeBody(valid({ consent: false }), TODAY)).get("consent"), "No");
});
