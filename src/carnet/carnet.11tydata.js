// Données communes aux pages de /carnet/ : le JSON de la feuille, échappé pour une balise <script> (voir json-script.js).
const { jsonPourScript } = require("./json-script.js");
module.exports = {
  eleventyComputed: {
    carnetConfigJson: (data) => (data.carnetConfig ? jsonPourScript(data.carnetConfig) : undefined)
  }
};
