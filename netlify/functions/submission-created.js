// Auto-réponse envoyée au prospect après chaque soumission du formulaire de contact.
// Déclenchée automatiquement par Netlify (fonction nommée "submission-created").
// L'échec d'envoi ne doit jamais impacter la soumission : on retourne toujours 200.
const nodemailer = require("nodemailer");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function firstName(name) {
  return (name || "").trim().split(/\s+/)[0] || "";
}

function buildBodies(name, subject) {
  const prenom = firstName(name);
  const merci = prenom ? "Merci " + prenom + " !" : "Merci !";
  const girls = subject === "Girls Trips ✨";
  const rappelGirls =
    "Petit rappel : les places sont limitées et le départ est confirmé dès 5 inscrites — je reviens vite vers toi avec tous les détails.";

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
    "<p><strong>" + merci + "</strong></p>" +
    "<p>J'ai bien reçu ta demande" + (subject ? " concernant «&nbsp;" + subject + "&nbsp;»" : "") + ".<br>" +
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

exports.handler = async function (event) {
  const ok = { statusCode: 200, body: "" };

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    console.log("Auto-réponse ignorée : SMTP_USER/SMTP_PASS non configurés.");
    return ok;
  }

  let data;
  try {
    data = JSON.parse(event.body).payload.data || {};
  } catch (e) {
    console.log("Auto-réponse ignorée : payload illisible.", e.message);
    return ok;
  }

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

  const bodies = buildBodies(data.name, data.subject);
  try {
    await transporter.sendMail({
      from: '"Anaïs — Zwald Travel Planner" <' + user + ">",
      to: to,
      subject: "J'ai bien reçu ta demande — Zwald Travel Planner",
      text: bodies.text,
      html: bodies.html,
    });
    console.log("Auto-réponse envoyée à " + to + " (sujet : " + (data.subject || "?") + ").");
  } catch (e) {
    console.error("Échec d'envoi de l'auto-réponse :", e.message);
  }
  return ok;
};
