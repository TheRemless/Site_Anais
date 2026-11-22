// JSON destiné à un <script type="application/json"> : <, > et & ainsi que U+2028 et U+2029 deviennent des séquences \\uXXXX.
// Une chaîne contenant </script> ou <!-- reste inoffensive, JSON.parse relit exactement la valeur d'origine.
function jsonPourScript(valeur) {
  return JSON.stringify(valeur).replace(/[<>&\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
module.exports = { jsonPourScript };
