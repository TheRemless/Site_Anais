// Données calculées pour la page /secret/ à partir de secret.json :
// points de la carte des transferts, liste des infos encore à confirmer par l'équipe,
// et affichage du bandeau d'aperçu (jamais en production).
const secret = require("./secret.json");

// Projection simple longitude/latitude vers le repère SVG de la carte (viewBox -30 0 370 400).
// La carte est illustrative : seules les positions relatives comptent.
function project(lat, lng) {
  return { x: Math.round((lng - 98.2) * 210), y: Math.round((9.3 - lat) * 210) };
}

function toConfirm() {
  const items = [];
  for (const r of secret.routes) {
    if (!r.confirmed) items.push(`Transfers to ${r.name}`);
  }
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
  const origin = project(secret.origin.lat, secret.origin.lng);
  const routes = secret.routes.map((r) => {
    const p = project(r.lat, r.lng);
    // Courbe légère, tournée vers l'extérieur, pour que les pointillés ne se superposent pas.
    const bend = p.x > origin.x ? 12 : -12;
    return {
      name: r.name,
      x: p.x,
      y: p.y,
      path: `M${origin.x} ${origin.y} Q${(origin.x + p.x) / 2 + bend} ${(origin.y + p.y) / 2} ${p.x} ${p.y}`,
      labelX: p.x + r.label[0],
      labelY: p.y + r.label[1],
      anchor: r.label[2]
    };
  });

  const pending = toConfirm();
  if (pending.length) {
    console.log(`[secret] ${pending.length} infos à confirmer sur /secret/ :\n  - ${pending.join("\n  - ")}`);
  }

  return {
    map: { origin, routes },
    toConfirm: pending,
    // Netlify fournit CONTEXT=production uniquement pour le site en ligne.
    showDraftBanner: process.env.CONTEXT !== "production" && pending.length > 0
  };
};
