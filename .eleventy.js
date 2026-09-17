const i18n = require("./src/_data/i18n.json");

module.exports = function (eleventyConfig) {
  // Traduction des libellés partagés (header, footer, bannière cookies).
  eleventyConfig.addFilter("t", function (key, lang) {
    const dict = i18n[lang];
    if (!dict || !(key in dict)) {
      throw new Error('i18n : clé manquante "' + key + '" pour la langue "' + lang + '"');
    }
    return dict[key];
  });

  // Static assets are copied through untouched, keeping the same public URLs.
  eleventyConfig.addPassthroughCopy({
    "src/css": "css",
    "src/js": "js",
    "src/images": "images",
    "src/files": "files",
    "src/favicon.ico": "favicon.ico",
    "src/robots.txt": "robots.txt",
    "src/sitemap.xml": "sitemap.xml",
    "src/site.webmanifest": "site.webmanifest",
    "src/_redirects": "_redirects"
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      output: "_site"
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    templateFormats: ["njk", "html"]
  };
};
