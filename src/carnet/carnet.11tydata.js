// Données communes aux pages de /carnet/ : le JSON de la feuille, échappé pour une balise <script> (voir json-script.js),
// et ce que l'ouverture des guides tire de leurs données : la carte, la légende « Toutes les sorties » et le repère (ancre) de chaque élément.
const { jsonPourScript } = require("./json-script.js");
const { construireCarte, chargerGeo } = require("./carte.js");
const { desGroupe, thb } = require("./guide-commun.js");

// Cibles de la carte et de la légende : chaque repère mène à une ancre qui doit exister dans la page.
// Un groupe « isole » que le guide masque (reglages.afficherSpeedboatsPigIsland) n'existe pas dans la page : ni ancre, ni ligne de légende.
const affiche = (g, data) => !(g.isole && data.reglages && data.reglages.afficherSpeedboatsPigIsland === false);
function ancresDuGuide(guide, data) {
  const ids = new Set();
  for (const s of guide.sections || []) {
    ids.add(s.id);
    for (const g of s.groupes || []) if (affiche(g, data)) ids.add(g.id);
  }
  return ids;
}

// Eleventy appelle d'abord chaque fonction `eleventyComputed` avec un faux objet de données pour repérer les variables lues : on lit donc guide, offres et
// ouverture en tête, puis on s'arrête là tant que `guide.sections` n'est pas un vrai tableau.
const prete = (data) => data.ouverture !== undefined && Array.isArray(data.guide && data.guide.sections) && data.offres && typeof data.offres === "object";

module.exports = {
  eleventyComputed: {
    carnetConfigJson: (data) => (data.carnetConfig ? jsonPourScript(data.carnetConfig) : undefined),

    // { html, defs, positions } ou null : une carte dessinée à partir de la configuration `ouverture.carte` du guide.
    carteGuide: (data) => {
      const o = data.ouverture;
      if (!prete(data) || !o || !o.carte) return null;
      const ancres = ancresDuGuide(data.guide, data);
      const sections = Object.fromEntries((data.guide.sections || []).map((s) => [s.id, s]));
      const groupes = Object.fromEntries((data.guide.sections || []).flatMap((s) => (s.groupes || []).map((g) => [g.id, g])));
      const sous = (r) => {
        if (!ancres.has(r.vers)) throw new Error("carte : le repère « " + r.cle + " » mène à une ancre absente : " + r.vers);
        if (r.sous && r.sous.destination) {
          const prix = Object.values(data.offres).flatMap((o) => (o.variantes || []).filter((v) => v.id === r.sous.destination || String(v.id).startsWith(r.sous.destination + "-")).map((v) => v.prix).filter((n) => typeof n === "number"));
          return prix.length ? "dès " + thb(Math.min(...prix)) : "";
        }
        if (r.sous && r.sous.compte && sections[r.vers]) return (sections[r.vers].groupes || []).length + " " + r.sous.compte;
        if (groupes[r.vers]) return desGroupe(groupes[r.vers], data.offres).texte;
        if (sections[r.vers]) return desGroupe({ offres: (sections[r.vers].groupes || []).flatMap((g) => g.offres) }, data.offres).texte;
        return "";
      };
      for (const p of o.carte.points || []) if (!ancres.has(p.vers)) throw new Error("carte : le point « " + p.cle + " » mène à une ancre absente : " + p.vers);
      return construireCarte(o.carte, chargerGeo(o.carte.geo), { sous });
    },

    // Légende : une colonne par entrée de `ouverture.legende`, une ligne par groupe avec son « dès X THB ».
    legendeGuide: (data) => {
      const o = data.ouverture;
      if (!prete(data) || !o || !o.legende) return null;
      const sections = Object.fromEntries((data.guide.sections || []).map((s) => [s.id, s]));
      return o.legende.map((col) => {
        const s = sections[col.section];
        if (!s) throw new Error("légende : section inconnue « " + col.section + " »");
        return { titre: col.titre || s.titre, lignes: (s.groupes || []).filter((g) => affiche(g, data)).map((g) => ({ id: g.id, titre: g.titre, des: desGroupe(g, data.offres).texte })) };
      });
    },

    // « dès X THB » de chaque groupe, par identifiant : légende, carte et lignes d'activités disent la même chose.
    desGroupes: (data) => {
      const out = {};
      if (!prete(data)) return out;
      for (const sec of (data.guide && data.guide.sections) || []) for (const g of sec.groupes || []) out[g.id] = desGroupe(g, data.offres).texte;
      return out;
    },

    // Clé du repère de la carte pour un élément de la page (groupe ou section) : sert à suivre le défilement. Un groupe hérite de sa section.
    reperesGuide: (data) => {
      const o = data.ouverture;
      const out = {};
      if (!prete(data) || !o || !o.carte) return out;
      // Plusieurs repères différents vers la même ancre (les destinations d'Ao Nang) : aucun n'est « la sortie lue », on n'en allume pas.
      const cle = {}, vus = {};
      for (const r of [...(o.carte.reperes || []), ...(o.carte.points || [])]) { (vus[r.vers] = vus[r.vers] || new Set()).add(r.cle); if (!cle[r.vers]) cle[r.vers] = r.cle; }
      for (const v of Object.keys(vus)) if (vus[v].size > 1) delete cle[v];
      for (const s of data.guide.sections || []) {
        if (cle[s.id]) out[s.id] = cle[s.id];
        for (const g of s.groupes || []) if (cle[g.id] || cle[s.id]) out[g.id] = cle[g.id] || cle[s.id];
      }
      return out;
    }
  }
};
