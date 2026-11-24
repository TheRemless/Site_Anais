// Carte dessinée des guides du carnet (src/carnet/carte.js, carnet.11tydata.js) : repères, ancres, photos. Valeurs fictives pour la logique,
// pages construites pour le contrôle des liens. Lancer `npm run build` avant (lecture de _site/).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { construireCarte } = require("../src/carnet/carte.js");
const donnees = require("../src/carnet/carnet.11tydata.js").eleventyComputed;

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// Géométrie fictive : deux carrés dans le cadre
const geo = {
  alpha: { geo: { type: "Polygon", coordinates: [[[10.1, 20.1], [10.3, 20.1], [10.3, 20.3], [10.1, 20.3], [10.1, 20.1]]] } },
  beta: { geo: { type: "Polygon", coordinates: [[[10.6, 20.6], [10.8, 20.6], [10.8, 20.8], [10.6, 20.8], [10.6, 20.6]]] } }
};
const cadre = { lon0: 10, lon1: 11, lat0: 20, lat1: 21 };

test("carte : un repère à photo devient un médaillon relié à sa cible, un repère sans photo un point et un nom", () => {
  const c = construireCarte({
    geo: "fictif", cadre, iles: ["alpha", "beta"], libelle: "Carte fictive",
    reperes: [
      { cle: "a", vers: "sortie-a", nom: "Sortie A", cible: [10.2, 20.2], appel: [10.4, 20.4], photo: "/images/fictif-a.jpg" },
      { cle: "b", vers: "sortie-b", nom: "Sortie B", cible: [10.7, 20.7], ancre: "e" }
    ]
  }, geo, { sous: (r) => "sous " + r.cle });
  assert.equal((c.html.match(/class="cg-call"/g) || []).length, 1, "un seul médaillon");
  assert.equal((c.html.match(/class="cg-med"/g) || []).length, 1, "le repère sans photo n'a pas de médaillon");
  assert.equal((c.html.match(/<line class="cg-leader"/g) || []).length, 1, "un trait seulement, pour le médaillon");
  assert.match(c.html, /href="#sortie-a"/);
  assert.match(c.html, /href="#sortie-b"/);
  assert.match(c.html, /sous a/);
  assert.match(c.html, /sous b/);
  assert.deepEqual(Object.keys(c.positions).sort(), ["a", "b"]);
  assert.match(c.defs, /id="cg-land"/);
  assert.equal((c.defs.match(/M/g) || []).length >= 2, true, "les deux îles sont dessinées");
});

test("carte : les positions sont en pourcentages du cadre", () => {
  const c = construireCarte({ geo: "fictif", cadre, iles: ["alpha"], libelle: "x", reperes: [{ cle: "a", vers: "s", nom: "A", cible: [10.5, 20.5] }] }, geo);
  assert.deepEqual(c.positions.a, [50, 50]);
});

test("carte : la rive d'une île se calcule sur sa géométrie, une latitude hors de l'île est refusée", () => {
  const base = { geo: "fictif", cadre, iles: ["alpha"], libelle: "x" };
  const ok = construireCarte({ ...base, reperes: [{ cle: "a", vers: "s", nom: "A", cible: { rive: { ile: "alpha", cote: "e", lat: 20.2 } } }] }, geo);
  assert.deepEqual(ok.positions.a, [30, 80]);
  assert.throws(() => construireCarte({ ...base, reperes: [{ cle: "a", vers: "s", nom: "A", cible: { rive: { ile: "alpha", cote: "e", lat: 20.9 } } }] }, geo), /ne coupe pas/);
  assert.throws(() => construireCarte({ ...base, iles: ["inconnue"], reperes: [] }, geo), /île inconnue/);
});

test("carte : un repère qui mène à une ancre absente du guide fait échouer le build", () => {
  const data = {
    ouverture: { carte: { geo: "carnet-samui", cadre: { lon0: 99.58, lon1: 100.14, lat0: 9.27, lat1: 9.86 }, libelle: "x", reperes: [{ cle: "x", vers: "n-existe-pas", nom: "X", cible: [99.9, 9.5] }] } },
    guide: { sections: [{ id: "s1", titre: "S1", groupes: [{ id: "g1", titre: "G1", offres: [] }] }] },
    offres: {}
  };
  assert.throws(() => donnees.carteGuide(data), /ancre absente/);
  data.ouverture.carte.reperes[0].vers = "g1";
  assert.match(donnees.carteGuide(data).html, /href="#g1"/);
});

test("carte : la légende liste chaque groupe avec son prix de départ (prix fictifs)", () => {
  const offres = { a: { id: "a", type: "personne", adulte: 1500 }, b: { id: "b", type: "personne", adulte: 900 }, c: { id: "c", wa: true } };
  const data = {
    ouverture: { legende: [{ section: "s1", titre: "Colonne" }] },
    guide: { sections: [{ id: "s1", titre: "S1", groupes: [{ id: "g1", titre: "G1", offres: ["a", "b"] }, { id: "g2", titre: "G2", offres: ["c"] }] }] },
    offres
  };
  const l = donnees.legendeGuide(data);
  assert.equal(l.length, 1);
  assert.deepEqual(l[0].lignes.map((x) => [x.id, x.des]), [["g1", "dès 900 THB"], ["g2", "Sur demande"]]);
});

// ---------- pages construites ----------
const pages = fs.readdirSync(path.join(root, "src", "carnet")).filter((f) => f.endsWith(".njk")).map((f) => {
  const permalink = read(path.join("src", "carnet", f)).match(/^permalink:\s*(\S+)\s*$/m)[1];
  return { file: f, html: read(path.join("_site", permalink, "index.html")) };
});

test("carnet : chaque repère de la carte, chaque ligne de la légende et chaque catégorie mène à une ancre qui existe dans la page", () => {
  assert.equal(pages.length, 3);
  for (const p of pages) {
    const ids = new Set([...p.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const liens = [...p.html.matchAll(/<a [^>]*class="(?:cg-dot|cg-call|cg-lg|cg-dot cg-dot--txt)"[^>]*>/g), ...p.html.matchAll(/<nav class="cg-cats"[^>]*>([\s\S]*?)<\/nav>/g)];
    assert.ok(liens.length > 3, p.file + " : liens trouvés");
    const cibles = [...p.html.matchAll(/data-go="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(cibles.length > 5, p.file + " : data-go");
    for (const c of cibles) assert.ok(ids.has(c), `${p.file} : l'ancre #${c} n'existe pas`);
    const href = [...p.html.matchAll(/<a [^>]*(?:cg-dot|cg-call|cg-lg)[^>]*href="#([^"]+)"/g)].map((m) => m[1]).concat([...p.html.matchAll(/<a [^>]*href="#([^"]+)"[^>]*(?:cg-dot|cg-call|cg-lg)/g)].map((m) => m[1]));
    for (const c of href) assert.ok(ids.has(c), `${p.file} : href #${c}`);
  }
});

test("carnet : un repère à photo mène à une sortie qui a sa photo, une sortie sans photo n'a pas de médaillon", () => {
  const cas = [
    ["koh-lanta-excursions-activites.11tydata.js", true],
    ["koh-samui-excursions-bateau.11tydata.js", true],
    ["ao-nang-excursions-bateau.11tydata.js", false]
  ];
  for (const [f, avecPhotos] of cas) {
    const d = require("../src/carnet/" + f);
    const o = d.ouverture;
    const photos = new Set(Object.keys(o.photos || {}));
    const section = Object.fromEntries(d.guide.sections.map((s) => [s.id, s]));
    for (const r of o.carte.reperes) {
      const sec = section[r.vers];
      // la cible d'un médaillon est un groupe ou une section qui porte une photo (un groupe d'une section, ou la galerie de la section)
      const porte = photos.has(r.vers) || (sec && ((sec.groupes || []).some((g) => photos.has(g.id)) || (sec.photos || []).length > 0));
      if (r.photo) assert.ok(porte, `${f} : le repère « ${r.cle} » a un médaillon mais sa sortie n'a pas de photo`);
      if (!r.photo) assert.ok(!r.appel, `${f} : le repère « ${r.cle} » n'a pas de photo, donc pas de médaillon posé en mer`);
    }
    if (!avecPhotos) assert.ok(o.carte.reperes.every((r) => !r.photo), f + " : aucune photo de repère");
  }
  // une photo de repère doit exister dans src/images
  for (const f of ["koh-lanta-excursions-activites.11tydata.js", "koh-samui-excursions-bateau.11tydata.js"]) {
    for (const r of require("../src/carnet/" + f).ouverture.carte.reperes) if (r.photo) assert.ok(fs.existsSync(path.join(root, "src", r.photo)), r.photo);
  }
});

test("carnet : aucune image ni lien cassé dans les pages (src de /images ou /img qui existe, alt non vide sur les photos de contenu)", () => {
  for (const p of pages) {
    for (const m of p.html.matchAll(/<img [^>]*>/g)) {
      const tag = m[0];
      const src = (tag.match(/\ssrc="([^"]+)"/) || [])[1];
      if (!src || !src.startsWith("/")) continue;
      assert.ok(fs.existsSync(path.join(root, "_site", src)), `${p.file} : ${src} absente du site construit`);
    }
    // les médaillons de la carte sont décoratifs (le lien porte le nom), toute autre photo a un vrai alt
    const sansAlt = [...p.html.matchAll(/<img [^>]*>/g)].map((m) => m[0]).filter((t) => !/\salt="[^"]+"/.test(t) && !/class="cg-med"/.test(t) && !/\salt=""/.test(t));
    assert.equal(sansAlt.length, 0, `${p.file} : image sans alt`);
  }
});

test("carnet : la police Dancing Script est auto-hébergée, déclarée avec font-display swap et préchargée sur les pages du carnet seulement", () => {
  const fonts = read("src/css/fonts.css");
  assert.match(fonts, /font-family: 'Dancing Script';[\s\S]*?font-weight: 400 700;[\s\S]*?font-display: swap;[\s\S]*?dancing-script-400-700-normal-latin\.woff2/);
  assert.ok(fs.existsSync(path.join(root, "src/css/fonts/dancing-script-400-700-normal-latin.woff2")));
  assert.match(fonts, /Monsieur La Doulaise/, "Monsieur La Doulaise reste déclarée (utilisée ailleurs)");
  for (const p of pages) assert.match(p.html, /rel="preload" as="font" type="font\/woff2" href="\/css\/fonts\/dancing-script-400-700-normal-latin\.woff2"/, p.file);
  assert.doesNotMatch(read("src/_includes/base.njk"), /dancing/i, "pas de préchargement sur les autres pages");
  assert.match(read("src/css/carnet.css"), /--cg-script: "Dancing Script"/);
});

test("carnet : OpenStreetMap est cité sous chaque carte, les données de la carte viennent des fichiers de géométrie du dépôt", () => {
  for (const p of pages) assert.match(p.html, /© contributeurs OpenStreetMap/, p.file);
  for (const f of ["osm-islands", "carnet-samui", "carnet-aonang"]) assert.ok(fs.existsSync(path.join(root, "src/_includes/geo", f + ".json")), f);
});
