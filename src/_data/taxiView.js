// Données calculées pour la page /taxi/ à partir de taxi.json : liste des infos encore à
// confirmer par VIP Taxi Lanta et affichage du bandeau d'aperçu (jamais en production).
const taxi = require("./taxi.json");

function toConfirm() {
  const items = [];
  const groups = [[taxi.hero], taxi.services, taxi.why, taxi.steps, [taxi.rating], [taxi.payment]];
  for (const group of groups) {
    for (const item of group) {
      if (!item.confirmed) items.push(`${item.title || item.text}: text to confirm`);
    }
  }
  if (!taxi.hero.photo) items.push(`${taxi.hero.title}: vehicle photo`);
  return items;
}

module.exports = function () {
  const pending = toConfirm();
  if (pending.length) {
    console.log(`[taxi] ${pending.length} infos à confirmer sur /taxi/ :\n  - ${pending.join("\n  - ")}`);
  }

  return {
    toConfirm: pending,
    // Netlify fournit CONTEXT=production uniquement pour le site en ligne.
    showDraftBanner: process.env.CONTEXT !== "production" && pending.length > 0
  };
};
