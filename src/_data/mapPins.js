// Les cinq lieux de la carte de l'accueil (FR et EN, include home-map.njk).
// Positions calculées depuis les coordonnées GPS avec la projection de mapThailand.js,
// donc toujours alignées sur le tracé. `tip` vide = aucun conseil affiché, l'épingle
// n'est pas cliquable (les textes viennent d'Anaïs, voir rapport du 1.11.2026).
const map = require("./mapThailand.js");

// Scène bureau en unités SVG : la carte au centre, les photos de part et d'autre.
const STAGE = { w: 1000, h: 800, mapTop: 20, mapHeight: 760 };
const CARD_W = 150;               // largeur d'une photo (unités de scène)
const IMG_H = CARD_W * 5 / 4;     // photo en 4/5

const places = [
  {
    id: "chiang-mai", name: "Chiang Mai", lat: 18.79, lon: 98.98,
    img: "/images/IMG_5227.jpg",
    caption: { fr: "Temple doré de Doi Suthep, Chiang Mai", en: "Golden temple of Doi Suthep, Chiang Mai" },
    tip: { fr: "", en: "" },
    side: "l", card: { x: 110, y: 0 }, offset: null
  },
  {
    id: "kanchanaburi", name: "Kanchanaburi", lat: 14.37, lon: 99.14,
    img: "/images/IMG_9507.jpg",
    caption: { fr: "Cascade d'Erawan, Kanchanaburi", en: "Erawan Falls, Kanchanaburi" },
    tip: { fr: "", en: "" },
    side: "l", card: { x: 20, y: 252 }, offset: null
  },
  {
    id: "bangkok", name: "Bangkok", lat: 13.75, lon: 100.50,
    img: "/images/galerie/bangkok-yaowarat.jpg",
    caption: { fr: "Yaowarat, le quartier chinois de Bangkok", en: "Yaowarat, Bangkok's Chinatown" },
    tip: { fr: "", en: "" },
    side: "r", card: { x: 740, y: 276 }, offset: null
  },
  {
    id: "railay", name: "Railay", lat: 8.01, lon: 98.84,
    img: "/images/galerie/railay-eau-claire.jpg",
    caption: { fr: "Eau transparente au pied d'une falaise, Railay", en: "Clear water at the foot of a cliff, Railay" },
    tip: { fr: "", en: "" },
    side: "l", card: { x: 100, y: 556 }, offset: "w"
  },
  {
    id: "koh-lanta", name: "Koh Lanta", lat: 7.60, lon: 99.05,
    img: "/images/IMG_2016.jpg",
    caption: { fr: "Coucher de soleil sur la plage de Koh Lanta", en: "Sunset on Koh Lanta beach" },
    tip: { fr: "", en: "" },
    side: "r", card: { x: 830, y: 576 }, offset: "e"
  }
];

const k = STAGE.mapHeight / map.height;
const mapW = map.width * k;
const mapLeft = (STAGE.w - mapW) / 2;
const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`;

module.exports = {
  stage: STAGE,
  // Boîte de la carte dans la scène bureau (pourcentages pour le CSS).
  mapBox: { left: pct(mapLeft, STAGE.w), top: pct(STAGE.mapTop, STAGE.h), width: pct(mapW, STAGE.w) },
  cardWidth: pct(CARD_W, STAGE.w),
  pins: places.map((p, i) => {
    const pr = map.project(p.lat, p.lon);
    const sx = mapLeft + pr.x * k;
    const sy = STAGE.mapTop + pr.y * k;
    const edgeX = p.side === "l" ? p.card.x + CARD_W : p.card.x;
    const edgeY = p.card.y + IMG_H / 2;
    return {
      ...p,
      n: i + 1,
      dot: { x: pr.x.toFixed(1), y: pr.y.toFixed(1) },
      pinStyle: `--x:${pr.px.toFixed(2)}%;--y:${pr.py.toFixed(2)}%`,
      cardStyle: `--cx:${pct(p.card.x, STAGE.w)};--cy:${pct(p.card.y, STAGE.h)}`,
      line: { x1: edgeX.toFixed(1), y1: edgeY.toFixed(1), x2: sx.toFixed(1), y2: sy.toFixed(1) }
    };
  })
};
