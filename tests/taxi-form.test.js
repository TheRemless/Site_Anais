const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/js/taxi-form.js");

const TODAY = "2026-11-14";

function valid(overrides) {
  return Object.assign(
    {
      name: "Claire Martin",
      phone: "+33 6 12 34 56 78",
      date: "2026-11-15",
      time: "10:30",
      passengers: "3",
      from: "Lanta Sand Resort",
      to: "Krabi Airport",
      baby_seat: false,
      child_seat: true,
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

test("validate : une demande complète est valide", () => {
  assert.deepEqual(F.validate(valid(), TODAY), {});
});

test("validate : les champs obligatoires vides sont signalés", () => {
  const errors = F.validate(
    valid({ name: " ", phone: "", date: "", time: "", passengers: "", from: "", to: "", consent: false }),
    TODAY
  );
  assert.deepEqual(Object.keys(errors).sort(), ["consent", "date", "from", "name", "passengers", "phone", "time", "to"]);
});

test("validate : la date du jour est acceptée, une date passée refusée", () => {
  assert.equal(F.validate(valid({ date: TODAY }), TODAY).date, undefined);
  assert.match(F.validate(valid({ date: "2026-11-13" }), TODAY).date, /today or a later date/);
});

test("validate : une date impossible est refusée", () => {
  assert.match(F.validate(valid({ date: "2026-02-30" }), TODAY).date, /valid date/);
  assert.match(F.validate(valid({ date: "tomorrow" }), TODAY).date, /valid date/);
});

test("validate : passagers de 1 à 20, entiers seulement", () => {
  for (const ok of ["1", "20"]) assert.equal(F.validate(valid({ passengers: ok }), TODAY).passengers, undefined);
  for (const bad of ["0", "21", "2.5", "abc", "-1"]) {
    assert.match(F.validate(valid({ passengers: bad }), TODAY).passengers, /from 1 to 20/, bad);
  }
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

test("encodeBody : relisible par URLSearchParams, avec le nom du formulaire", () => {
  const params = new URLSearchParams(F.encodeBody(valid({ name: "  Zoë & Co  " })));
  assert.equal(params.get("form-name"), "taxi");
  assert.equal(params.get("name"), "Zoë & Co");
  assert.equal(params.get("phone"), "+33 6 12 34 56 78");
  assert.equal(params.get("from"), "Lanta Sand Resort");
  assert.equal(params.get("bot-field"), "");
});

test("encodeBody : sièges et consentement en Yes ou No", () => {
  const params = new URLSearchParams(F.encodeBody(valid({ baby_seat: true, child_seat: false })));
  assert.equal(params.get("baby_seat"), "Yes");
  assert.equal(params.get("child_seat"), "No");
  assert.equal(params.get("consent"), "Yes");
});
