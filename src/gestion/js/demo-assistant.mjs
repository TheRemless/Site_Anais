// Démonstration : un journal de l'assistant fictif sur 35 jours (appels, coûts, quelques échecs, un jour à la limite) et des retouches,
// pour que l'écran « Suivi de l'assistant » montre quelque chose. Tiré d'une suite fixe : la même démo donne les mêmes chiffres.
import { LIMITE_JOUR } from "./assistant-suivi-calc.mjs";

const COUTS = { lire: 0.0025, itineraire: 0.0006, situer: 0.014, repondre_itineraire: 0.0011 };

export function journalAssistantDemo({ entites, profils, ajd }) {
  let graine = 7;
  const hasard = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
  const personnes = profils.filter((p) => p.actif && !p.plateforme).slice(0, 3);
  const lignes = [];
  const retouches = [];
  if (!personnes.length || !entites.length) return { lignes, retouches };
  for (let i = 34; i >= 0; i--) {
    const d = new Date(`${ajd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const jour = d.toISOString().slice(0, 10);
    personnes.forEach((p, k) => {
      const entite = entites[k % entites.length];
      // Une personne atteint la limite une fois, onze jours avant aujourd'hui.
      const nb = i === 11 && k === 0 ? LIMITE_JOUR : Math.floor(hasard() * (k === 0 ? 14 : 7));
      for (let c = 0; c < nb; c++) {
        const tirage = hasard();
        const usage = tirage < 0.55 ? "lire" : tirage < 0.72 ? "itineraire" : tirage < 0.82 ? "situer" : "repondre_itineraire";
        const t = hasard();
        const statut = t < 0.03 ? "refus" : t < 0.07 ? "invalide" : t < 0.08 ? "occupe" : "ok";
        const heure = 8 + Math.floor(hasard() * 11);
        const cree_le = new Date(Date.parse(`${jour}T${String(heure).padStart(2, "0")}:${String(Math.floor(hasard() * 60)).padStart(2, "0")}:00Z`) - 7 * 3600 * 1000).toISOString();
        const cout = statut === "occupe" ? 0 : Math.round(COUTS[usage] * (0.6 + hasard() * 0.9) * 1e6) / 1e6;
        lignes.push({ cree_le, user_id: p.user_id, entite_id: entite.id, usage, statut, modele: "claude-haiku-5-5", cout_estime_usd: cout });
        if (usage === "repondre_itineraire" && statut === "ok" && hasard() < 0.85) {
          const r = hasard();
          retouches.push({ cree_le, user_id: p.user_id, entite_id: entite.id, usage, part_modifiee: r < 0.55 ? 0 : r < 0.85 ? 1 + Math.floor(hasard() * 12) : 15 + Math.floor(hasard() * 50) });
        }
      }
    });
  }
  return { lignes, retouches };
}
