// Carte dessinée des guides du carnet : fabriquée au build, sans librairie ni appel réseau.
// Géométrie : contributeurs OpenStreetMap, lignes de côte simplifiées (src/_includes/geo/). Projection équirectangulaire corrigée par cos(latitude).
// Un repère = une cible sur la carte (lon, lat) menant à une ancre de la page. Avec une photo : médaillon rond posé en mer libre et relié à sa cible par un trait.
// Sans photo : un point et son nom. Tailles des étiquettes en unités de conteneur (cqw), pour que la carte reste lisible de 360 à 700 px de large.
const fs = require("node:fs");
const path = require("node:path");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cacheGeo = new Map();

// Fichier de géométrie : soit { cle: { geo: Polygon|MultiPolygon } } (osm-islands.json), soit une FeatureCollection de polygones.
function chargerGeo(nom, dossier) {
  const cle = (dossier || "") + "|" + nom;
  if (cacheGeo.has(cle)) return cacheGeo.get(cle);
  const fichier = path.join(dossier || path.join(__dirname, "..", "_includes", "geo"), nom + ".json");
  const brut = JSON.parse(fs.readFileSync(fichier, "utf8"));
  cacheGeo.set(cle, brut);
  return brut;
}

const anneaux = (g) => (g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((x) => x[0]));

function anneauxDe(geo, cles) {
  if (geo && geo.type === "FeatureCollection") return geo.features.flatMap((f) => anneaux(f.geometry));
  return (cles || Object.keys(geo)).flatMap((k) => {
    if (!geo[k]) throw new Error("carte : île inconnue « " + k + " »");
    return anneaux(geo[k].geo);
  });
}

const TRANS = { n: ["-50%", "-100%"], s: ["-50%", "0px"], e: ["-100%", "-50%"], w: ["0px", "-50%"] };

function construireCarte(carte, geo, options = {}) {
  const F = carte.cadre;
  const k = Math.cos(((F.lat0 + F.lat1) / 2) * Math.PI / 180);
  const W = 1000, H = Math.round((W * (F.lat1 - F.lat0)) / ((F.lon1 - F.lon0) * k));
  const P = (lon, lat) => [((lon - F.lon0) / (F.lon1 - F.lon0)) * W, ((F.lat1 - lat) / (F.lat1 - F.lat0)) * H];
  const pc = (lon, lat) => { const [x, y] = P(lon, lat); return [+(x / W * 100).toFixed(2), +(y / H * 100).toFixed(2)]; };
  const rings = anneauxDe(geo, carte.iles);
  const d = rings.map((r) => r.map((pt, i) => (i ? "L" : "M") + P(pt[0], pt[1]).map((v) => v.toFixed(1)).join(" ")).join("") + "Z").join("");

  // Rive d'une île à une latitude donnée : côté « w » ou « e » (sert à poser un repère exactement sur la côte)
  const rive = (r) => {
    const xs = [];
    for (const anneau of anneauxDe(geo, [r.ile])) {
      for (let i = 0; i < anneau.length - 1; i++) {
        const [a, b] = [anneau[i], anneau[i + 1]];
        if ((a[1] - r.lat) * (b[1] - r.lat) <= 0 && a[1] !== b[1]) xs.push(a[0] + ((r.lat - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    if (!xs.length) throw new Error("carte : la rive de « " + r.ile + " » ne coupe pas la latitude " + r.lat);
    return [r.cote === "w" ? Math.min(...xs) : Math.max(...xs), r.lat];
  };
  const pos = (p) => (Array.isArray(p) ? p : rive(p.rive));

  const sous = options.sous || (() => "");
  const reperes = (carte.reperes || []).map((r) => ({ ...r, at: pos(r.cible) }));
  const points = (carte.points || []).map((p) => ({ ...p, at: pos(p.cible) }));
  const positions = {};
  for (const r of reperes) positions[r.cle] = pc(...r.at);
  for (const p of points) if (!positions[p.cle]) positions[p.cle] = pc(...p.at);

  const trait = (r) => { const a = P(...r.at), c = P(...r.appel); return `<line class="cg-leader" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${c[0].toFixed(1)}" y2="${c[1].toFixed(1)}"/>`; };
  const leaders = reperes.filter((r) => r.photo && r.appel).map(trait).join("");

  const pinHtml = reperes.map((r) => {
    const [dx, dy] = pc(...r.at);
    const lien = `#${r.vers}`;
    if (r.photo && r.appel) {
      const [cx, cy] = pc(...r.appel);
      return `<a class="cg-dot" href="${lien}" data-k="${r.cle}" data-go="${r.vers}" data-x="${dx}" data-y="${dy}" style="left:${dx}%;top:${dy}%" tabindex="-1" aria-hidden="true"></a>`
        + `<a class="cg-call" href="${lien}" data-k="${r.cle}" data-go="${r.vers}" style="left:${cx}%;top:${cy}%"><span class="cg-med"><img src="${esc(r.photo)}" alt="" sizes="104px" loading="eager" decoding="async" style="object-position:${esc(r.position || "50% 50%")}"></span><span class="cg-cl">${esc(r.nom)}<small>${esc(sous(r))}</small></span></a>`;
    }
    const [tx, ty] = TRANS[r.ancre || "e"];
    return `<a class="cg-dot cg-dot--txt" href="${lien}" data-k="${r.cle}" data-go="${r.vers}" data-x="${dx}" data-y="${dy}" style="left:${dx}%;top:${dy}%"><span class="sr-only">${esc(r.nom)}</span></a>`
      + `<span class="cg-geo cg-geo--pin" aria-hidden="true" style="left:${dx}%;top:${dy}%;transform:translate(calc(${tx} + ${r.dx || 0}px),calc(${ty} + ${r.dy || 0}px))">${esc(r.nom)}<small>${esc(sous(r))}</small></span>`;
  }).join("");

  const pointsHtml = points.map((p) => {
    const [x, y] = pc(...p.at);
    return `<a class="cg-dot" href="#${p.vers}" data-k="${p.cle}" data-go="${p.vers}" data-x="${x}" data-y="${y}" style="left:${x}%;top:${y}%" aria-label="${esc(p.aria || p.nom)}"></a>`
      + `<span class="cg-geo" aria-hidden="true" style="left:${x}%;top:${y}%;transform:translate(-100%,-50%);margin-left:-16px">${esc(p.nom)}</span>`;
  }).join("");

  const noms = (carte.noms || []).map((n) => {
    const [x, y] = pc(...pos(n.at));
    const [tx, ty] = TRANS[n.ancre || "n"];
    return `<span class="cg-geo${n.classe ? " " + n.classe : ""}" aria-hidden="true" style="left:${x}%;top:${y}%;transform:translate(calc(${tx} + ${n.dx || 0}px),calc(${ty} + ${n.dy || 0}px))">${esc(n.t)}</span>`;
  }).join("");

  // Échelle : 10 km, largeur en pourcentage de la largeur de la carte (1° de latitude = 110,6 km)
  const km10 = (10 / 110.6 / (F.lat1 - F.lat0)) * H / W * 100;
  const defs = `<svg class="cg-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs><g id="cg-land"><path class="cg-halo" d="${d}"/><path class="cg-isle" d="${d}"/></g></defs></svg>`;
  const html = `<div class="cg-mapwrap" style="--ar:${H};--ratio:${(H / W).toFixed(4)}"><div class="cg-map"><div class="cg-mapbox"><svg class="cg-sv" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(carte.libelle)}"><use href="#cg-land"/>${leaders}</svg>${noms}${pinHtml}${pointsHtml}<span class="cg-north" aria-hidden="true">N</span><span class="cg-scale cg-scale--${esc(carte.echelle || "bas-droite")}" aria-hidden="true"><b style="width:${km10.toFixed(2)}cqw"></b>10 km</span></div><p class="cg-mapfoot"><span>Carte schématique</span><span>Choisissez un repère</span><span class="cg-osm">© contributeurs OpenStreetMap</span></p></div></div>`;
  return { html, defs, positions, ratio: H / W, W, H };
}

module.exports = { construireCarte, chargerGeo, anneauxDe };
