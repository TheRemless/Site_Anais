const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const { buildBodies, handler, isContactSubmission, forwardToBrevo } = require("../netlify/functions/submission-created.js");

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
  assert.equal(isContactSubmission({ form_name: "newsletter-fr" }), false);
  assert.equal(isContactSubmission({ form_name: "newsletter-en" }), false);
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

// Remplace fetch le temps d'un test : enregistre les appels et répond comme Brevo.
async function withFakeFetch(fn, response = { ok: true, status: 200, json: async () => ({ success: true }) }) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (response instanceof Error) throw response;
    return response;
  };
  try { await fn(calls); } finally { globalThis.fetch = real; }
}

test("handler : une inscription newsletter n'envoie aucun e-mail, même avec une adresse valide", async () => {
  await withFakeFetch(async (fetchCalls) => {
    await withFakeSmtp(async (calls) => {
      const res = await handler(eventFor("newsletter-fr", { prenom: "Claire", email: "claire@example.com", lang: "fr" }));
      assert.equal(res.statusCode, 200);
      assert.equal(calls.created, 0);
      assert.equal(calls.sent, 0);
    });
    assert.equal(fetchCalls.length, 1);
    assert.equal(new URLSearchParams(fetchCalls[0].opts.body).get("locale"), "fr");
  });
});

test("handler : une inscription newsletter est transmise au formulaire Brevo, même sans SMTP", async () => {
  const saved = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  try {
    await withFakeFetch(async (calls) => {
      const res = await handler(eventFor("newsletter-en", { prenom: " Claire ", email: "claire@example.com", lang: "en" }));
      assert.equal(res.statusCode, 200);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /^https:\/\/[a-z0-9]+\.sibforms\.com\/serve\//);
      assert.equal(calls[0].opts.method, "POST");
      const body = new URLSearchParams(calls[0].opts.body);
      assert.equal(body.get("EMAIL"), "claire@example.com");
      assert.equal(body.get("FIRSTNAME"), "Claire");
      assert.equal(body.get("locale"), "fr");
      assert.equal(body.get("email_address_check"), "");
    });
  } finally {
    if (saved.user !== undefined) process.env.SMTP_USER = saved.user;
    if (saved.pass !== undefined) process.env.SMTP_PASS = saved.pass;
  }
});

test("handler : newsletter sans e-mail valide, rien n'est transmis", async () => {
  await withFakeFetch(async (calls) => {
    await handler(eventFor("newsletter-fr", { email: "pas-un-email" }));
    await handler(eventFor("newsletter-en", { prenom: "Claire" }));
    assert.equal(calls.length, 0);
  });
});

test("forwardToBrevo : un refus Brevo en HTTP 200 (success false) compte comme un échec", async () => {
  await withFakeFetch(async (calls) => {
    const sent = await forwardToBrevo({ form_name: "newsletter-fr", data: { email: "claire@example.com" } });
    assert.equal(sent, false);
    assert.equal(calls.length, 1);
  }, { ok: true, status: 200, json: async () => ({ success: false, errors: { EMAIL: "x" } }) });
  await withFakeFetch(async () => {
    const sent = await forwardToBrevo({ form_name: "newsletter-fr", data: { email: "claire@example.com" } });
    assert.equal(sent, true);
  });
});

test("handler : une erreur Brevo ne fait jamais échouer la soumission", async () => {
  await withFakeFetch(async (calls) => {
    const res = await handler(eventFor("newsletter-fr", { email: "claire@example.com" }));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
  }, new Error("réseau coupé"));
  await withFakeFetch(async (calls) => {
    const res = await handler(eventFor("newsletter-fr", { email: "claire@example.com" }));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
  }, { ok: false, status: 500, json: async () => { throw new Error("pas du JSON"); } });
});

test("handler : le formulaire contact envoie toujours l'auto-réponse", async () => {
  await withFakeSmtp(async (calls) => {
    const res = await handler(eventFor("contact", { name: "Claire", email: "claire@example.com", lang: "en" }));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.sent, 1);
  });
});
