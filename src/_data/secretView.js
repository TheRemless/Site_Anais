// Données calculées pour la page /secret/ à partir de secret.json :
// liste des infos encore à confirmer par l'équipe et affichage du bandeau d'aperçu
// (jamais en production).
const secret = require("./secret.json");

function toConfirm() {
  const items = [];
  for (const t of secret.tours.concat(secret.activities)) {
    if (!t.confirmed) items.push(`${t.name}: description and details`);
    if (!t.photo) items.push(`${t.name}: photo`);
  }
  if (!secret.licence) items.push("TAT licence number");
  if (!secret.contact.googleMaps) items.push("Google Maps link");
  if (!secret.contact.replyHours) items.push("WhatsApp reply hours");
  if (!secret.team.text || !secret.team.photo) items.push("Who we are: text and team photo");
  return items;
}

module.exports = function () {
  const pending = toConfirm();
  if (pending.length) {
    console.log(`[secret] ${pending.length} infos à confirmer sur /secret/ :\n  - ${pending.join("\n  - ")}`);
  }

  return {
    toConfirm: pending,
    // Netlify fournit CONTEXT=production uniquement pour le site en ligne.
    showDraftBanner: process.env.CONTEXT !== "production" && pending.length > 0
  };
};
