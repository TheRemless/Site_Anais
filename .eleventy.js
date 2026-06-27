module.exports = function (eleventyConfig) {
  // Static assets are copied through untouched, keeping the same public URLs.
  eleventyConfig.addPassthroughCopy({
    "src/css": "css",
    "src/js": "js",
    "src/images": "images",
    "src/favicon.ico": "favicon.ico",
    "src/robots.txt": "robots.txt",
    "src/sitemap.xml": "sitemap.xml",
    "src/site.webmanifest": "site.webmanifest"
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
