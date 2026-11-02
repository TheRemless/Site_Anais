// Déclenchée automatiquement par Netlify après chaque soumission (fonction nommée "submission-created").
// Formulaire de contact : auto-réponse envoyée au prospect.
// Newsletter (newsletter-fr et newsletter-en) : l'inscription est transmise au formulaire Brevo d'Anaïs,
// le même qu'utilisait l'ancien widget, depuis le serveur (aucun cookie Brevo chez le visiteur).
// Un échec ne doit jamais impacter la soumission : on retourne toujours 200.
const nodemailer = require("nodemailer");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Formulaire d'inscription Brevo (liste newsletter d'Anaïs). Adresse publique, c'était l'action de l'ancien widget.
const BREVO_FORM_URL = process.env.BREVO_FORM_URL ||
  "https://771f2f29.sibforms.com/serve/MUIFAH8sqsoFIHIP47ui9d8SyFkd3IQMB4Tdrqk0fK_Ps1YGTHeFdTPDiOPhM1wtRrKYSNT1e4fEf9fCcKa2HZ_v1IDf_mtAN0EhWfsIb1OO9WjCearQPn5wIwkNcEQC1vpJk9UulT9rzADHq9nMfUaAtOjHCADLJNPNgArdS1HFySKH-v1WoxVNajNZGIY6l_--eekrhK_ewIRg";

function firstName(name) {
  return (name || "").trim().split(/\s+/)[0] || "";
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildBodies(name, subject, lang) {
  const prenom = firstName(name);
  const girls = subject === "Girls Trips ✨";

  if (lang === "en") {
    const thanks = prenom ? "Thank you " + prenom + "!" : "Thank you!";
    const thanksHtml = prenom ? "Thank you " + escapeHtml(prenom) + "!" : "Thank you!";
    const girlsReminder =
      "Just a quick reminder: spots are limited and the departure is confirmed from 4 sign-ups — I'll be back in touch soon with all the details.";
    const lines = [
      thanks,
      "",
      "I've received your request" + (subject ? ' about "' + subject + '"' : "") + ".",
      "I'll get back to you personally as soon as possible, usually within 24-48h.",
    ];
    if (girls) lines.push("", girlsReminder);
    lines.push(
      "",
      "Talk soon,",
      "Anaïs",
      "",
      "Zwald Travel Planner — Your Tailor-Made Trips from A to Z",
      "https://zwaldtravelplanner.com",
      "WhatsApp: +66 95 868 38 46",
      "Instagram: https://www.instagram.com/zwaldtravelplanner/"
    );
    const text = lines.join("\n");
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c2b2d;line-height:1.6;max-width:560px">' +
      "<p><strong>" + thanksHtml + "</strong></p>" +
      "<p>I've received your request" + (subject ? " about &ldquo;" + escapeHtml(subject) + "&rdquo;" : "") + ".<br>" +
      "I'll get back to you personally as soon as possible, usually within 24-48h.</p>" +
      (girls ? "<p>" + girlsReminder + "</p>" : "") +
      "<p>Talk soon,<br>Anaïs</p>" +
      '<p style="color:#5b6b6d;font-size:13px;border-top:1px solid #e3ecec;padding-top:12px">' +
      "Zwald Travel Planner — Your Tailor-Made Trips from A to Z<br>" +
      '<a href="https://zwaldtravelplanner.com" style="color:#0a828d">zwaldtravelplanner.com</a> · ' +
      '<a href="https://wa.me/66958683846" style="color:#0a828d">WhatsApp</a> · ' +
      '<a href="https://www.instagram.com/zwaldtravelplanner/" style="color:#0a828d">Instagram</a></p>' +
      "</div>";
    return { text: text, html: html };
  }

  const merci = prenom ? "Merci " + prenom + " !" : "Merci !";
  const merciHtml = prenom ? "Merci " + escapeHtml(prenom) + " !" : "Merci !";
  const rappelGirls =
    "Petit rappel : les places sont limitées et le départ est confirmé dès 4 inscrites — je reviens vite vers toi avec tous les détails.";
  const lines = [
    merci,
    "",
    "J'ai bien reçu ta demande" + (subject ? " concernant « " + subject + " »" : "") + ".",
    "Je te réponds personnellement dans les plus brefs délais, généralement sous 24-48h.",
  ];
  if (girls) lines.push("", rappelGirls);
  lines.push(
    "",
    "À très vite,",
    "Anaïs",
    "",
    "Zwald Travel Planner — Vos voyages sur mesure de A à Z",
    "https://zwaldtravelplanner.com",
    "WhatsApp : +66 95 868 38 46",
    "Instagram : https://www.instagram.com/zwaldtravelplanner/"
  );
  const text = lines.join("\n");
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c2b2d;line-height:1.6;max-width:560px">' +
    "<p><strong>" + merciHtml + "</strong></p>" +
    "<p>J'ai bien reçu ta demande" + (subject ? " concernant «&nbsp;" + escapeHtml(subject) + "&nbsp;»" : "") + ".<br>" +
    "Je te réponds personnellement dans les plus brefs délais, généralement sous 24-48h.</p>" +
    (girls ? "<p>" + rappelGirls + "</p>" : "") +
    "<p>À très vite,<br>Anaïs</p>" +
    '<p style="color:#5b6b6d;font-size:13px;border-top:1px solid #e3ecec;padding-top:12px">' +
    "Zwald Travel Planner — Vos voyages sur mesure de A à Z<br>" +
    '<a href="https://zwaldtravelplanner.com" style="color:#0a828d">zwaldtravelplanner.com</a> · ' +
    '<a href="https://wa.me/66958683846" style="color:#0a828d">WhatsApp</a> · ' +
    '<a href="https://www.instagram.com/zwaldtravelplanner/" style="color:#0a828d">Instagram</a></p>' +
    "</div>";
  return { text: text, html: html };
}

module.exports.buildBodies = buildBodies;

// L'auto-réponse est celle de Zwald : elle ne doit partir que pour le formulaire de contact
// (FR et EN s'appellent tous deux "contact"). Les autres formulaires du site, comme la
// demande de taxi ou l'inscription à la newsletter (formulaires "newsletter-fr" et "newsletter-en"), n'en reçoivent pas.
function isContactSubmission(payload) {
  return Boolean(payload) && payload.form_name === "contact";
}
module.exports.isContactSubmission = isContactSubmission;

function isNewsletterSubmission(payload) {
  return Boolean(payload) && (payload.form_name === "newsletter-fr" || payload.form_name === "newsletter-en");
}
module.exports.isNewsletterSubmission = isNewsletterSubmission;

// Champs attendus par le formulaire Brevo (mêmes noms que l'ancien widget).
function brevoFields(data, formName) {
  const lang = formName === "newsletter-en" || data.lang === "en" ? "en" : "fr";
  return new URLSearchParams({
    EMAIL: (data.email || "").trim(),
    FIRSTNAME: (data.prenom || "").trim().slice(0, 200),
    email_address_check: "",
    locale: lang,
  });
}
module.exports.brevoFields = brevoFields;

async function forwardToBrevo(payload) {
  const data = payload.data || {};
  if (!EMAIL_RE.test((data.email || "").trim())) {
    console.log("Newsletter : e-mail absent ou invalide, rien transmis à Brevo.");
    return false;
  }
  if (data["bot-field"]) {
    console.log("Newsletter : champ anti-robot rempli, rien transmis à Brevo.");
    return false;
  }
  try {
    const res = await fetch(BREVO_FORM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: brevoFields(data, payload.form_name).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("Newsletter : Brevo a répondu HTTP " + res.status + ".");
      return false;
    }
    console.log("Newsletter : inscription (" + payload.form_name + ") transmise à Brevo.");
    return true;
  } catch (e) {
    console.error("Newsletter : échec de l'envoi à Brevo :", e.message);
    return false;
  }
}
module.exports.forwardToBrevo = forwardToBrevo;

exports.handler = async function (event) {
  const ok = { statusCode: 200, body: "" };

  let payload;
  try {
    payload = JSON.parse(event.body).payload;
  } catch (e) {
    console.log("Soumission ignorée : payload illisible.", e.message);
    return ok;
  }
  if (isNewsletterSubmission(payload)) {
    await forwardToBrevo(payload);
    return ok;
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    console.log("Auto-réponse ignorée : SMTP_USER/SMTP_PASS non configurés.");
    return ok;
  }
  if (!isContactSubmission(payload)) {
    console.log("Auto-réponse ignorée : formulaire « " + (payload && payload.form_name) + " ».");
    return ok;
  }
  const data = payload.data || {};

  const to = (data.email || "").trim();
  if (!EMAIL_RE.test(to)) {
    console.log("Auto-réponse ignorée : email absent ou invalide.");
    return ok;
  }
  if (to.toLowerCase() === user.toLowerCase()) {
    console.log("Auto-réponse ignorée : email identique à l'expéditeur (anti-boucle).");
    return ok;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "mail.infomaniak.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user: user, pass: pass },
  });

  const lang = data.lang === "en" ? "en" : "fr";
  const bodies = buildBodies(data.name, data.subject, lang);
  try {
    await transporter.sendMail({
      from: '"Anaïs — Zwald Travel Planner" <' + user + ">",
      to: to,
      subject: lang === "en" ? "I've received your request — Zwald Travel Planner" : "J'ai bien reçu ta demande — Zwald Travel Planner",
      text: bodies.text,
      html: bodies.html,
    });
    console.log("Auto-réponse envoyée à " + to + " (sujet : " + (data.subject || "?") + ").");
  } catch (e) {
    console.error("Échec d'envoi de l'auto-réponse :", e.message);
  }
  return ok;
};
