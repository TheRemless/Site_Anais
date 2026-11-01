const i18n = require("./src/_data/i18n.json");

module.exports = async function (eleventyConfig) {
  // Traduction des libellés partagés (header, footer, bannière cookies).
  eleventyConfig.addFilter("t", function (key, lang) {
    const dict = i18n[lang];
    if (!dict || !(key in dict)) {
      throw new Error('i18n : clé manquante "' + key + '" pour la langue "' + lang + '"');
    }
    return dict[key];
  });

  // Images responsives : chaque <img src="/images/..."> du HTML généré est
  // converti en WebP à plusieurs largeurs, avec srcset, width et height.
  // Les fichiers sortent dans /img/ avec un nom haché (cache long côté Netlify).
  // sizes="auto" laisse le navigateur choisir selon la largeur réelle (images lazy) ;
  // les visuels de tête de page portent sizes="100vw" dans les gabarits.
  // Pour exclure une image : <img eleventy:ignore ...>.
  const { eleventyImageTransformPlugin } = await import("@11ty/eleventy-img");
  eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
    formats: ["webp"],
    // Jusqu'à 2880 px pour les écrans Retina en pleine largeur ; "auto" ajoute la largeur
    // d'origine quand la source est plus petite (pas d'agrandissement, pas de perte).
    widths: [480, 800, 1100, 1600, 2200, 2880, "auto"],
    urlPath: "/img/",
    outputDir: "_site/img/",
    htmlOptions: {
      imgAttributes: { decoding: "async", sizes: "auto" },
    },
    sharpWebpOptions: { quality: 72, effort: 5 },
    failOnError: true,
  });

  // Static assets are copied through untouched, keeping the same public URLs.
  eleventyConfig.addPassthroughCopy({
    "src/css": "css",
    "src/js": "js",
    "src/images": "images",
    "src/files": "files",
    "src/gestion": "gestion",
    "src/favicon.ico": "favicon.ico",
    "src/robots.txt": "robots.txt",
    "src/llms.txt": "llms.txt",
    "src/9ff6a41c8598a41b84b47818cb78915e.txt": "9ff6a41c8598a41b84b47818cb78915e.txt",
    "src/site.webmanifest": "site.webmanifest",
    "src/_redirects": "_redirects"
  });

  // L'outil de gestion est une application autonome : ses fichiers ne sont jamais traités comme des gabarits.
  eleventyConfig.ignores.add("src/gestion/**");

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
