const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const { buildBodies, handler, isContactSubmission } = require("../netlify/functions/submission-created.js");

test("buildBodies : gabarit français par défaut", () => {
  const { text } = buildBodies("Claire", "Girls Trips ✨", "fr");
  assert.match(text, /^Merci Claire !/);
  assert.match(text, /Petit rappel/);
});

test("buildBodies : gabarit anglais", () => {
  const { text } = buildBodies("Claire", "Girls Trips ✨", "en");
  assert.match(text, /^Thank you Claire!/);
  assert.match(text, /Just a quick reminder/);
});

test("buildBodies : sujet hors Girls Trips, pas de rappel, dans les deux langues", () => {
  const fr = buildBodies("Marc", "Demande de devis", "fr");
  const en = buildBodies("Marc", "Custom-made trip", "en");
  assert.doesNotMatch(fr.text, /Petit rappel/);
  assert.doesNotMatch(en.text, /Just a quick reminder/);
});

test("buildBodies : nom et sujet échappés dans le HTML, pas dans le texte brut", () => {
  const { text, html } = buildBodies("<b>Marc</b>", "Devis & co", "fr");
  assert.match(text, /^Merci <b>Marc<\/b> !/);
  assert.match(html, /&lt;b&gt;Marc&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<strong><b>/);
  assert.match(html, /Devis &amp; co/);
});

function eventFor(formName, data) {
  return { body: JSON.stringify({ payload: { form_name: formName, data: data } }) };
}

// Remplace nodemailer.createTransport et les variables SMTP le temps d'un test.
async function withFakeSmtp(run) {
  const saved = {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    create: nodemailer.createTransport
  };
  const calls = { created: 0, sent: 0 };
  process.env.SMTP_USER = "anais@example.test";
  process.env.SMTP_PASS = "secret";
  nodemailer.createTransport = function () {
    calls.created++;
    return { sendMail: async function () { calls.sent++; } };
  };
  try {
    await run(calls);
  } finally {
    nodemailer.createTransport = saved.create;
    if (saved.user === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = saved.user;
    if (saved.pass === undefined) delete process.env.SMTP_PASS; else process.env.SMTP_PASS = saved.pass;
  }
}

test("isContactSubmission : seul le formulaire contact déclenche l'auto-réponse", () => {
  assert.equal(isContactSubmission({ form_name: "contact" }), true);
  assert.equal(isContactSubmission({ form_name: "taxi" }), false);
  assert.equal(isContactSubmission({}), false);
  assert.equal(isContactSubmission(undefined), false);
});

test("handler : une demande du formulaire taxi n'envoie aucun e-mail, même avec une adresse valide", async () => {
  await withFakeSmtp(async (calls) => {
    const res = await handler(eventFor("taxi", { name: "Marc", email: "marc@example.com" }));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.created, 0);
    assert.equal(calls.sent, 0);
  });
});

test("handler : le formulaire contact envoie toujours l'auto-réponse", async () => {
  await withFakeSmtp(async (calls) => {
    const res = await handler(eventFor("contact", { name: "Claire", email: "claire@example.com", lang: "en" }));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.sent, 1);
  });
});
