// Durées des pages taxi du site (src/_data/taxiRoutes.json, champ « drive ») : approximatives, relevées le 30.10.2026 sur des sites de transport,
// à affiner avec VIP Taxi Lanta. Servent seulement à pré-remplir la table des temps de trajet de l'organisation de Koh Lanta, chaque ligne « à vérifier ».
// tests/gestion-agent-ecran.test.js vérifie que cette liste suit le fichier du site.
export const ROUTES_SITE = [
 {
  "from": "Krabi Airport",
  "to": "Koh Lanta",
  "drive": "about 2 to 3 hours"
 },
 {
  "from": "Phuket Airport",
  "to": "Koh Lanta",
  "drive": "about 4 to 5 hours"
 },
 {
  "from": "Surat Thani Airport",
  "to": "Koh Lanta",
  "drive": "about 4 to 5 hours"
 },
 {
  "from": "Koh Lanta",
  "to": "Krabi Town",
  "drive": "about 3 hours"
 },
 {
  "from": "Koh Lanta",
  "to": "Ao Nang",
  "drive": "about 3 hours"
 },
 {
  "from": "Koh Lanta",
  "to": "Khao Sok",
  "drive": "about 4 to 5 hours"
 },
 {
  "from": "Koh Lanta",
  "to": "Trang",
  "drive": "about 3 hours"
 },
 {
  "from": "Koh Lanta",
  "to": "Khao Lak",
  "drive": "about 4 to 5 hours"
 },
 {
  "from": "Koh Lanta",
  "to": "Donsak Pier",
  "drive": "about 5 hours"
 },
 {
  "from": "Krabi Airport",
  "to": "Ao Nang",
  "drive": "about 45 minutes"
 },
 {
  "from": "Phuket Airport",
  "to": "Khao Lak",
  "drive": "about 1h30 to 2 hours"
 },
 {
  "from": "Krabi",
  "to": "Khao Sok",
  "drive": "about 2 to 3 hours"
 },
 {
  "from": "Phuket",
  "to": "Khao Sok",
  "drive": "about 2 to 3 hours"
 },
 {
  "from": "Surat Thani",
  "to": "Khao Sok",
  "drive": "about 1 to 2 hours"
 },
 {
  "from": "Hat Yai",
  "to": "Koh Lanta",
  "drive": "about 6 hours"
 },
 {
  "from": "Phuket Airport",
  "to": "Ao Nang",
  "drive": "about 3 hours"
 }
];

// La liaison de ferry de Koh Lanta, pré-remplie pour l'organisation de Lanta seulement. Ports et durée donnés par Jérémy le 19.11.2026 :
// ท่าเรือคลองหมาก (Khlong Mak Pier) sur l'île, ท่าเรือกระบี่-เกาะลันตา côté continent, 1 h traversée et attente comprises.
// Coordonnées relevées le 20.11.2026 dans OpenStreetMap : les deux bouts de la ligne de bac pour voitures (way 45897552). Le côté a été
// vérifié avec OSRM : depuis l'hôpital de Krabi, le bout continent s'atteint sans ferry (73 min), le bout île avec (92 min). La recherche par
// nom ne les trouvait pas (« ท่าเรือกระบี่-เกาะลันตา » renvoyait l'embarcadère de Saladan, sur l'île).
export const LIAISON_LANTA = {
  nom: "Ferry de Koh Lanta",
  cote_ile: "Koh Lanta",
  port_ile: "ท่าเรือคลองหมาก (Khlong Mak Pier), Koh Lanta Noi",
  port_continent: "ท่าเรือกระบี่-เกาะลันตา, Krabi",
  port_ile_coord: "7.6823683, 99.0900688",
  port_continent_coord: "7.6930427, 99.0992049",
  duree_min: 60,
  source: "Jérémy, 19.11.2026 : ports Khlong Mak et Krabi-Koh Lanta, 1 h ; coordonnées OpenStreetMap (bac 45897552)",
  a_verifier: false,
};
