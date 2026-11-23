// Pages de carnet (/carnet/<sujet>-<code>/) : guides réservés aux clients, ouverts depuis le PDF du carnet.
// Non listées, non indexées, hors sitemap et hors llms.txt, sans lien depuis une page publique. Lancer `npm run build` avant (lecture de _site/).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const privees = require("./noms-prives.js");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const srcDir = path.join(root, "src", "carnet");
const pages = fs.readdirSync(srcDir).filter((f) => f.endsWith(".njk")).map((f) => {
  const source = read(path.join("src", "carnet", f));
  const permalink = source.match(/^permalink:\s*(\S+)\s*$/m)[1];
  return { file: f, source, permalink, built: path.join("_site", permalink, "index.html") };
});

// Les contrôles propres à Koh Samui (9 offres, liens des cartes) lisent cette page ; les guides d'Ao Nang et de Koh Lanta ont leur fichier de tests.
const samui = pages.find((p) => /koh-samui/.test(p.file));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("carnet : au moins une page, adresse /carnet/<sujet>-<code de 6 caractères>/", () => {
  assert.ok(pages.length >= 1);
  for (const p of pages) assert.match(p.permalink, /^\/carnet\/[a-z0-9-]+-[a-z0-9]{6}\/$/, p.file);
});

test("carnet : la page construite existe, en noindex, canonical vers elle-même, sans hreflang, JSON-LD ni og:image", () => {
  for (const p of pages) {
    const doc = read(p.built);
    assert.match(doc, /<meta name="robots" content="noindex, nofollow, noarchive">/, p.file);
    assert.match(doc, new RegExp(`<link rel="canonical" href="https://zwaldtravelplanner.com${p.permalink}">`), p.file);
    assert.doesNotMatch(doc, /<link rel="alternate"[^>]*hreflang/, `${p.file} : hreflang (le lien EN du sélecteur de langue de l'en-tête n'en est pas un)`);
    assert.doesNotMatch(doc, /application\/ld\+json/, `${p.file} : JSON-LD (fil d'Ariane compris)`);
    assert.doesNotMatch(doc, /og:image/, `${p.file} : og:image`);
    assert.equal((doc.match(/<h1[ >]/g) || []).length, 1, `${p.file} : un seul h1`);
  }
});

test("carnet : absente de sitemap.xml, de llms.txt et de robots.txt (aucun Disallow qui révélerait l'adresse)", () => {
  const sitemap = read("_site/sitemap.xml");
  const llms = read("src/llms.txt");
  const robots = read("src/robots.txt");
  for (const p of pages) {
    assert.ok(!sitemap.includes(p.permalink), `${p.file} : présente dans sitemap.xml`);
    assert.ok(!llms.includes(p.permalink), `${p.file} : présente dans llms.txt`);
    assert.ok(!robots.includes(p.permalink), `${p.file} : présente dans robots.txt`);
  }
  assert.doesNotMatch(sitemap, /\/carnet\//);
  assert.doesNotMatch(llms, /\/carnet\//);
  assert.doesNotMatch(robots, /carnet/i);
});

test("carnet : netlify.toml pose X-Robots-Tag noindex pour /carnet/*", () => {
  const toml = read("netlify.toml");
  const block = toml.match(/\[\[headers\]\]\s*\n\s*for = "\/carnet\/\*"\s*\n\s*\[headers\.values\]([\s\S]*?)(?=\n\[\[|\n\[|$)/);
  assert.ok(block, "bloc [[headers]] for = \"/carnet/*\" introuvable");
  assert.match(block[1], /X-Robots-Tag = "noindex, nofollow, noarchive"/);
});

test("carnet : aucune page publique ne renvoie vers /carnet/", () => {
  // Les images de la page Services vivent dans /images/carnet/ : ce n'est pas un lien vers une page de carnet.
  const lien = /(?<!\/images)\/carnet\//;
  const publiques = walk(path.join(root, "_site")).filter((f) => {
    const rel = path.relative(path.join(root, "_site"), f);
    return /\.(html|xml|txt)$/.test(rel) && !rel.startsWith("carnet" + path.sep) && !rel.startsWith("gestion" + path.sep);
  });
  assert.ok(publiques.length > 20);
  for (const f of publiques) {
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), lien, path.relative(root, f));
  }
  for (const f of ["src/_data/nav.js", "src/_data/i18n.json", "src/sitemap.njk"]) {
    assert.doesNotMatch(read(f), lien, f);
  }
});

test("carnet : tous les prix sont en THB, aucun .price-chf, aucune note de devise, aucun CHF", () => {
  for (const p of pages) {
    const doc = read(p.built);
    const body = doc.slice(doc.indexOf("<main"), doc.indexOf("</main>"));
    assert.doesNotMatch(doc, /price-chf|currency-note|data-chf|currency-switch|zwald_currency/, `${p.file} : rien de lié à la devise`);
    assert.doesNotMatch(body, /\bCHF\b|€|\bEUR\b/, `${p.file} : seuls les THB sont affichés`);
    assert.match(body, /\d(?:&nbsp;|\u00a0)THB/, `${p.file} : prix en THB`);
  }
  assert.doesNotMatch(read("src/_includes/carnet-guide.njk"), /chf|price-chf|currency-note/i);
  assert.doesNotMatch(read("src/carnet/koh-samui-excursions-bateau.11tydata.js"), /\bchf\b/i);
});

test("carnet : ni « Secret » ni VIP Taxi Lanta dans la page, aucun lien vers /secret/ ou /taxi/", () => {
  for (const p of pages) {
    // Le guide de Koh Lanta lie le site en anglais dans son dernier bloc (voir tests/carnet-aonang-lanta.test.js) : c'est la seule mention admise.
    const doc = read(p.built).replace(/<a class="cg-link" href="https:\/\/secrettravelandtour\.com\/"[^>]*>[\s\S]*?<\/a>/g, p.file.startsWith("koh-lanta") ? "" : "$&");
    assert.doesNotMatch(doc, /secret/i, `${p.file} : le mot « Secret » ne figure pas sur la page`);
    assert.doesNotMatch(doc, /vip taxi|secrettravelandtour/i, `${p.file} : page construite`);
    assert.doesNotMatch(doc, /href="[^"]*\/(secret|taxi)\//i, `${p.file} : lien vers /secret/ ou /taxi/`);
  }
});

// Partenaires, commissions et documents des partenaires : réservés à Gestion, jamais dans une page, un attribut, un commentaire ni un nom de fichier.
const INTERDITS = [/drive\.google|docs\.google/i, /commission/i];
test("carnet : aucun nom de partenaire, aucune commission, aucun lien Google Drive dans ce qui est publié", () => {
  for (const p of pages) {
    const doc = read(p.built);
    for (const re of INTERDITS) assert.doesNotMatch(doc, re, `${p.file} : page construite, ${re}`);
    assert.doesNotMatch(doc, /partenaire/i, `${p.file} : le mot « partenaire »`);
    assert.doesNotMatch(doc, /source_site|url_origine/i, `${p.file} : champs des photos`);
  }
  const js = read("src/js/carnet-booking.js");
  for (const re of INTERDITS) assert.doesNotMatch(js, re, `carnet-booking.js, ${re}`);
  const sources = ["src/_includes/carnet-layout.njk", "src/_includes/carnet-guide.njk", "src/_includes/carnet-booking.njk"]
    .concat(fs.readdirSync(srcDir).map((f) => path.join("src", "carnet", f)));
  for (const f of sources) for (const re of INTERDITS) assert.doesNotMatch(read(f), re, `${f}, ${re}`);
  // Noms de fichiers des images du carnet
  for (const f of fs.readdirSync(path.join(root, "src", "images")).filter((n) => /^carnet-/.test(n))) {
    for (const re of INTERDITS) assert.doesNotMatch(f, re, `image ${f}`);
  }
  const construit = read(samui.built);
  assert.doesNotMatch(construit.slice(construit.indexOf("<main")), /<!--/, "aucun commentaire HTML dans la page (le commentaire d'analyse du gabarit du site est dans le head)");
});

// Les noms eux-mêmes ne sont jamais écrits ici (dépôt public) : ils viennent d'une liste privée, voir tests/noms-prives.js.
test("carnet : aucun nom de la liste privée des prestataires dans la page, le script, les gabarits, les données, les images ni les tests", (t) => {
  const motifs = privees.motifs();
  if (!motifs) { t.skip(privees.message); return; }
  const fichiers = ["src/js/carnet-booking.js", "tests/carnet.test.js", "tests/carnet-booking.test.js", "tests/noms-prives.js"]
    .concat(fs.readdirSync(srcDir).map((f) => path.join("src", "carnet", f)))
    .concat(fs.readdirSync(path.join(root, "src", "_includes")).filter((f) => /^carnet-/.test(f)).map((f) => path.join("src", "_includes", f)))
    .concat(pages.map((p) => p.built), ["_site/js/carnet-booking.js"]);
  assert.ok(fichiers.length >= 10);
  for (const f of fichiers) {
    const texte = read(f);
    for (const re of motifs) assert.ok(!re.test(texte), `${f} : un nom de la liste privée`);
  }
  for (const f of fs.readdirSync(path.join(root, "src", "images")).filter((n) => /^carnet-/.test(n))) {
    const octets = fs.readFileSync(path.join(root, "src", "images", f)).toString("latin1");
    for (const re of motifs) assert.ok(!re.test(f) && !re.test(octets), `image ${f} : un nom de la liste privée (nom de fichier ou métadonnées)`);
  }
  for (const f of ["_site/carnet"]) for (const e of walk(path.join(root, f))) for (const re of motifs) assert.ok(!re.test(fs.readFileSync(e, "latin1")), `${e} : un nom de la liste privée`);
});

test("carnet : seuls les liens sortants prévus (cartes, vidéo) sont dans le guide, avec rel noopener nofollow", () => {
  const permis = new Set(["https://maps.app.goo.gl/XuUoeHM4gZWJhaS4A", "https://maps.app.goo.gl/anvNxGoBe9YG5FhV6", "https://maps.app.goo.gl/BLXLRVwVgemphTn77", "https://youtu.be/-47MiQZv8_4"]);
  for (const p of pages) {
    const main = read(p.built);
    const body = main.slice(main.indexOf("<main"), main.indexOf("</main>"));
    const liens = [...body.matchAll(/<a [^>]*href="(https?:[^"]+)"[^>]*>/g)].filter((m) => !/wa\.me/.test(m[1]));
    if (p !== samui) { assert.deepEqual(liens.map((m) => m[1]), p.file.startsWith("koh-lanta") ? ["https://secrettravelandtour.com/"] : [], `${p.file} : liens sortants`); continue; }
    assert.ok(liens.length >= 4, `${p.file} : cartes et vidéo présentes`);
    for (const m of liens) {
      assert.ok(permis.has(m[1]), `${p.file} : lien sortant inattendu ${m[1]}`);
      assert.match(m[0], /rel="noopener nofollow"/);
    }
    assert.doesNotMatch(body, /iframe/i, "aucune intégration YouTube");
    assert.doesNotMatch(body, /Koh Tan[^<]*<\/p><p class="cg-row-text">[^<]*<\/p><p class="cg-row-lien"/, "Koh Tan reste sans lien de carte");
  }
});

test("carnet : le guide Koh Samui affiche les prix des offres en THB", () => {
  const doc = read(pages.find((p) => p.file === "koh-samui-excursions-bateau.njk").built);
  const prix = ["1’850", "1’300", "1’000", "2’200", "1’700", "4’400", "2’700", "20’000", "3’500", "4’500", "5’500", "6’500", "7’500", "5’000", "8’500", "11’500", "13’500", "1’500"];
  for (const n of prix) assert.ok(doc.includes(`<span class="cg-price">${n}&nbsp;THB</span>`), n);
  assert.ok(doc.includes('<span class="cg-price">700&nbsp;THB</span>'));
  assert.equal((doc.match(/<span class="cg-price">50&nbsp;THB<\/span>/g) || []).length, 2, "50 THB : Koh Madsum et Koh Rap");
  assert.doesNotMatch(doc, /490/, "plus de repère en CHF");
  // Droits d'entrée : à payer sur place, en plus, jamais « inclus » (Ang Thong, petit groupe compris)
  assert.match(doc, /À payer sur place, hors total/);
  assert.equal((doc.match(/Entrée du parc, en plus du prix[\s\u202f]: 300&nbsp;THB par adulte, 150&nbsp;THB par enfant \(de 3 à 14 ans et de moins de 1,40 m\), gratuit avant 3 ans\. À payer sur place, en espèces, au parc/g) || []).length, 4, "règle officielle du parc sur les 4 offres Ang Thong");
  assert.doesNotMatch(doc, /à confirmer avec Anaïs/, "plus aucun point en suspens affiché");
  assert.doesNotMatch(doc, /entrées?[^<]{0,40}(?<!non )inclus/i, "jamais « entrée incluse »");
  assert.doesNotMatch(doc, /130 ?cm/, "la règle du partenaire (130 cm) n'est pas reprise");
  assert.doesNotMatch(doc, /2[’' ]?500/, "le 2 500 THB du guide est abandonné");
  // Fermeture annuelle d'Ang Thong : message général dans le HTML de chacune des 4 offres (le script le précise « jusqu'au 15 décembre 2026 » pendant la fermeture)
  const corps = doc.slice(doc.indexOf("<main"), doc.indexOf("</main>"));
  assert.equal((corps.match(/<p class="cg-note" data-cg-fermeture="">Le parc national est fermé du 1er novembre au 15 décembre\./g) || []).length, 4);
  // Les deux speedboats privés de Pig Island sont affichés
  assert.match(doc, /id="offre-pig-island-speedboat-prive-4h"/);
  assert.match(doc, /id="offre-pig-island-speedboat-prive-5h"/);
});

// Pages privées (privatePage) : l'adresse secrète ne part vers aucun service tiers, aucun bouton flottant, aucun bandeau de cookies.
test("carnet : aucun script ni bandeau Google, aucun bouton WhatsApp flottant ; les pages publiques les gardent", () => {
  const privee = read(samui.built);
  assert.doesNotMatch(privee, /consent\.js|gtag|dataLayer|googletagmanager|G-LPTG5LLGPT|zw-consent|ZW_openConsent|data-ga-id/, "rien de lié à Google ni au consentement");
  assert.doesNotMatch(privee, /wa-fab/, "pas de bouton WhatsApp flottant");
  assert.doesNotMatch(privee, />Cookies</, "pas de lien « Cookies » mort dans le pied de page");
  const scripts = [...privee.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1].replace(/\?.*/, ""));
  assert.deepEqual(scripts.sort(), ["/js/carnet-booking.js", "/js/carnet-nav.js", "/js/site.js"], "seuls les scripts du site et de la feuille : ni consent.js ni currency.js (CDN tiers)");
  for (const f of ["src/js/carnet-booking.js"]) assert.doesNotMatch(read(f), /gtag|dataLayer|ZW_analytics|consent/i, f + " ne dépend ni de Google ni du consentement");
  for (const url of ["index.html", "services/index.html", "temples-coutumes-thailande/index.html", "en/index.html"]) {
    const doc = read(path.join("_site", url));
    assert.match(doc, /\/js\/consent\.js/, url + " garde consent.js");
    assert.match(doc, /function gtag\(\)/, url + " garde l'amorce gtag");
    assert.match(doc, /class="wa-fab"/, url + " garde le bouton WhatsApp flottant");
    assert.match(doc, />Cookies</, url + " garde le lien « Cookies »");
  }
  assert.match(read("src/carnet/carnet.json"), /"privatePage": true/);
  assert.match(read("src/_includes/base.njk"), /not privatePage/);
});

test("carnet : aucun numéro de téléphone en dur dans les gabarits, le script ni les données ; le lien de fin de page vient de business.js", () => {
  const business = require("../src/_data/business.js");
  const digits = String(business.telephone).replace(/\D/g, "");
  for (const f of ["src/_includes/carnet-layout.njk", "src/_includes/carnet-guide.njk", "src/_includes/carnet-booking.njk", "src/js/carnet-booking.js", "src/carnet/koh-samui-excursions-bateau.11tydata.js", "src/carnet/koh-samui-excursions-bateau.njk"]) {
    const source = read(f);
    assert.doesNotMatch(source, /\b\d{9,}\b/, f + " : numéro en dur");
    assert.ok(!source.includes(digits), f + " : le numéro de business.js est écrit en dur");
  }
  assert.match(read("src/_includes/carnet-layout.njk"), /wa\.me\/\{\{ business\.telephone \| replace\('\+', ''\) \}\}/);
  const doc = read(samui.built);
  const fin = doc.slice(doc.indexOf('class="cg-end"'));
  assert.ok(fin.includes(`href="https://wa.me/${digits}?text=`), "le bouton de fin de page pointe sur le numéro de business.js");
});

test("carnet : aucune requête externe, aucun sélecteur de langue ni de devise ; les pages publiques gardent les leurs", () => {
  const page = read(samui.built);
  // Ressources chargées : jamais une adresse externe (analytics, jsdelivr, polices externes, images externes)
  const ressources = [...page.matchAll(/<(?:script|img|source|iframe|video|audio)\b[^>]*\b(?:src|srcset)="([^"]+)"/g)].map((m) => m[1])
    .concat([...page.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g)].filter((m) => !/rel="canonical"/.test(m[0])).map((m) => m[1]));
  assert.ok(ressources.length > 10);
  for (const r of ressources) assert.doesNotMatch(r, /^(?:https?:)?\/\//, `ressource externe : ${r}`);
  assert.doesNotMatch(page, /@import|url\(\s*["']?https?:|fonts\.googleapis|fonts\.gstatic|jsdelivr|googletagmanager|google-analytics/);
  for (const f of ["_site/js/site.js", "_site/js/carnet-booking.js"]) assert.doesNotMatch(read(f), /jsdelivr|googletagmanager|google-analytics|fonts\.googleapis/, f);
  assert.doesNotMatch(read("_site/css/pages.css") + read("_site/css/system.css") + read("_site/css/fonts.css"), /url\(\s*["']?https?:/, "polices et images locales");
  // Seul appel réseau du carnet : l'envoi de la demande, déclenché par le client
  assert.equal((read("src/js/carnet-booking.js").match(/https?:\/\/[a-z0-9.-]+/g) || []).filter((u) => !/wa\.me/.test(u)).length, 1);
  // Sélecteurs de devise et de langue : absents de la page (en-tête et menu mobile), présents sur les pages publiques
  assert.doesNotMatch(page, /currency-switch|lang-switch|lang-current|hreflang/);
  assert.doesNotMatch(page, /<option value="(CHF|EUR|THB)"/);
  assert.match(page, /<ul class="nav-links">/, "le reste de la navigation est gardé");
  assert.match(page, /class="mobile-menu"/);
  for (const url of ["index.html", "services/index.html", "en/index.html"]) {
    const doc = read(path.join("_site", url));
    assert.match(doc, /id="currency-switch"/, url);
    assert.match(doc, /id="currency-switch-mobile"/, url);
    assert.match(doc, /class="lang-switch"/, url);
    assert.match(doc, /class="lang-switch lang-switch-mobile"/, url);
    assert.match(doc, /\/js\/currency\.js/, url + " garde currency.js");
  }
});

test("carnet : le JSON de la feuille est échappé pour une balise script (</script>, <!--, &, U+2028)", () => {
  const { jsonPourScript } = require("../src/carnet/json-script.js");
  const piege = { a: "</script><script>alert(1)</script>", b: "<!-- x -->", c: "A & B > C", d: "ligne\u2028sépar\u2029ateur", e: ["</SCRIPT >", "\"]]>"] };
  const sortie = jsonPourScript(piege);
  assert.doesNotMatch(sortie, /[<>&\u2028\u2029]/, "aucun caractère dangereux");
  assert.match(sortie, /\\u003c\/script\\u003e/);
  assert.deepEqual(JSON.parse(sortie), piege, "JSON.parse relit la valeur d'origine");
  assert.equal(jsonPourScript({ ok: 1 }), '{"ok":1}');
  // Le gabarit passe par cet échappement, la page construite ne contient aucun < dans son JSON
  assert.match(read("src/_includes/carnet-layout.njk"), /\{\{ carnetConfigJson \| safe \}\}/);
  assert.doesNotMatch(read("src/_includes/carnet-layout.njk"), /\| dump/);
  assert.match(read("src/carnet/carnet.11tydata.js"), /jsonPourScript/);
  const doc = read(samui.built);
  const json = doc.match(/<script type="application\/json" id="cg-data">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(json, /[<>&\u2028\u2029]/);
  assert.equal(Object.keys(JSON.parse(json).offres).length, 9);
});
