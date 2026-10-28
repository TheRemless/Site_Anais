const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/js/taxi-form.js");

const TODAY = "2026-11-14"; // un samedi

function values(overrides) {
  return Object.assign(
    {
      from: "Lanta Sand Resort",
      to: "Krabi Airport",
      date_choice: "tomorrow",
      date_other: "",
      time: "10:30",
      adults: 2,
      children: 1,
      babies: 0,
      child_seat: true,
      baby_seat: false
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

test("formatDate : Today et Tomorrow en toutes lettres, sinon jour et année", () => {
  assert.equal(F.formatDate("2026-11-14", TODAY), "Today (Sat 14 Nov)");
  assert.equal(F.formatDate("2026-11-15", TODAY), "Tomorrow (Sun 15 Nov)");
  assert.equal(F.formatDate("2026-12-24", TODAY), "Thu 24 Dec 2026");
});

test("buildMessage : un transfert complet, une info par ligne", () => {
  assert.equal(
    F.buildMessage(values(), TODAY),
    [
      "Hi VIP Taxi Lanta!",
      "I'd like a price for a transfer.",
      "From: Lanta Sand Resort",
      "To: Krabi Airport",
      "Date: Tomorrow (Sun 15 Nov)",
      "Pickup time: 10:30",
      "Adults: 2",
      "Children (3-11): 1",
      "Child seat needed"
    ].join("\n")
  );
});

test("buildMessage : les champs vides ne figurent pas dans le message", () => {
  const message = F.buildMessage(values({ time: "", children: 0, child_seat: false }), TODAY);
  assert.doesNotMatch(message, /Pickup time/);
  assert.doesNotMatch(message, /Children/);
  assert.doesNotMatch(message, /seat/);
  assert.match(message, /Adults: 2/);
});

test("buildMessage : bébés et siège bébé", () => {
  const message = F.buildMessage(values({ children: 0, child_seat: false, babies: 1, baby_seat: true }), TODAY);
  assert.match(message, /Babies \(0-2\): 1/);
  assert.match(message, /Baby seat needed/);
});

test("buildMessage : un siège coché sans enfant ni bébé est ignoré", () => {
  const message = F.buildMessage(values({ children: 0, babies: 0, child_seat: true, baby_seat: true }), TODAY);
  assert.doesNotMatch(message, /seat/);
});

test("buildMessage : espaces autour des lieux retirés", () => {
  const message = F.buildMessage(values({ from: "  Long Beach  ", to: " Phuket Airport " }), TODAY);
  assert.match(message, /^From: Long Beach$/m);
  assert.match(message, /^To: Phuket Airport$/m);
});

test("waUrl : numéro de WhatsApp d'Anaïs et message encodé", () => {
  const url = F.waUrl("Hi VIP Taxi Lanta!\nFrom: Zoë & Co");
  assert.ok(url.startsWith("https://wa.me/66958683846?text="));
  assert.equal(decodeURIComponent(url.split("?text=")[1]), "Hi VIP Taxi Lanta!\nFrom: Zoë & Co");
  assert.match(url, /%0A/);
});

test("validate : une demande complète est valide", () => {
  assert.deepEqual(F.validate(values(), TODAY), {});
});

test("validate : départ, arrivée, date et un adulte sont obligatoires, l'heure ne l'est pas", () => {
  const errors = F.validate(values({ from: " ", to: "", date_choice: "", adults: 0, time: "" }), TODAY);
  assert.deepEqual(Object.keys(errors).sort(), ["adults", "date", "from", "to"]);
});

test("validate : Other date doit être une vraie date, d'aujourd'hui ou plus tard", () => {
  assert.match(F.validate(values({ date_choice: "other", date_other: "" }), TODAY).date, /Choose a date/);
  assert.match(F.validate(values({ date_choice: "other", date_other: "2026-02-30" }), TODAY).date, /Choose a date/);
  assert.match(F.validate(values({ date_choice: "other", date_other: "2026-11-13" }), TODAY).date, /already passed/);
  assert.equal(F.validate(values({ date_choice: "other", date_other: TODAY }), TODAY).date, undefined);
});

const PLACES = ["Koh Lanta", "Krabi Airport", "Krabi Town", "Phuket Airport", "Surat Thani Airport", "Ao Nang"];

test("filterPlaces : champ vide ou espaces, toute la liste dans l'ordre d'origine", () => {
  assert.deepEqual(F.filterPlaces(PLACES, ""), PLACES);
  assert.deepEqual(F.filterPlaces(PLACES, "   "), PLACES);
  assert.deepEqual(F.filterPlaces(PLACES, undefined), PLACES);
});

test("filterPlaces : correspondance sans tenir compte de la casse, des accents ni de la position", () => {
  assert.deepEqual(F.filterPlaces(PLACES, "krabi"), ["Krabi Airport", "Krabi Town"]);
  assert.deepEqual(F.filterPlaces(PLACES, "AIRPORT"), ["Krabi Airport", "Phuket Airport", "Surat Thani Airport"]);
  assert.deepEqual(F.filterPlaces(PLACES, "thàni"), ["Surat Thani Airport"]);
});

test("filterPlaces : aucun résultat pour un lieu libre (hôtel, adresse)", () => {
  assert.deepEqual(F.filterPlaces(PLACES, "Lanta Sand Resort"), []);
});

test("filterPlaces : un lieu déjà choisi remontre toute la liste", () => {
  assert.deepEqual(F.filterPlaces(PLACES, "Krabi Airport", { showAllOnExact: true }), PLACES);
  assert.deepEqual(F.filterPlaces(PLACES, "krabi airport", { showAllOnExact: true }), PLACES);
  assert.deepEqual(F.filterPlaces(PLACES, "Krabi", { showAllOnExact: true }), ["Krabi Airport", "Krabi Town"]);
});
