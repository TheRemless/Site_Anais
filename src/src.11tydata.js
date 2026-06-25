// Keep the original flat ".html" URLs (e.g. /services.html) instead of
// Eleventy's default /services/ directory style, so existing links,
// canonicals and the sitemap stay valid.
module.exports = {
  permalink: (data) => `${data.page.filePathStem}.html`
};
