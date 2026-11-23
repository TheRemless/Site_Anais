// Guides du carnet d'Ao Nang et de Koh Lanta : estimations, identifiants envoyés à Gestion, message au format du site des excursions,
// confidentialité de la page construite. Aucun appel réseau : fetch est remplacé par un faux. Lancer `npm run build` avant (lecture de _site/).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const B = require("../src/js/carnet-booking.js");
const privees = require("./noms-prives.js");
const ao = require("../src/carnet/ao-nang-excursions-bateau.11tydata.js");
const la = require("../src/carnet/koh-lanta-excursions-activites.11tydata.js");

const business = { business: { telephone: "+66958683846" } };
const cfgAo = ao.eleventyComputed.carnetConfig(business);
const cfgLa = la.eleventyComputed.carnetConfig(business);
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const PAGE_AO = "_site/carnet/ao-nang-excursions-bateau-6ee244/index.html";
const PAGE_LA = "_site/carnet/koh-lanta-excursions-activites-vfrqfx/index.html";

const NOW = Date.parse("2026-11-23T05:00:00Z");
const BASE = { variante: "", date: "2026-12-22", creneau: "", adults: 2, ages: [], pickup: "Hôtel d’essai", transfert: false, name: "Anna Keller", whatsapp: "+41 79 123 45 67", message: "", website: "", openedAt: NOW - 20000 };
const today = B.bangkokToday(NOW);
const fakeFetch = () => { const calls = []; const f = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true }); }; f.calls = calls; return f; };

// Contrat avec Gestion : docs/gestion/carnet-aonang-lanta.md (identifiants de produit d'Ao Nang, une ligne par niveau et par destination).
const IDS_AONANG = {
  vip: ["aonang-vip-4-islands", "aonang-vip-hong", "aonang-vip-phi-phi"],
  "mini-luxury": ["aonang-mini-luxury-4-islands", "aonang-mini-luxury-hong", "aonang-mini-luxury-phi-phi"],
  luxury: ["aonang-luxury-4-islands", "aonang-luxury-hong", "aonang-luxury-phi-phi"],
  economique: ["aonang-economique-4-islands", "aonang-economique-hong-lagoon", "aonang-economique-hong-autres-iles"],
  prestige: ["aonang-prestige-4-islands", "aonang-prestige-hong", "aonang-prestige-phi-phi"]
};

// ---------- Ao Nang ----------

test("Ao Nang : cinq offres, une formule par destination, identifiants de produit du contrat Gestion, option « standard »", () => {
  const offres = cfgAo.offres;
  assert.deepEqual(Object.keys(offres).sort(), ["ao-nang-economique", "ao-nang-luxe", "ao-nang-luxury", "ao-nang-mini-luxury", "ao-nang-vip"]);
  const vus = [];
  for (const o of Object.values(offres)) {
    for (const v of o.variantes) {
      const g = B.gestionIds(o, { variante: v.id });
      assert.equal(g.option, "standard", v.id);
      assert.match(g.optionTitre, /^(VIP|Mini Luxury|Luxury|Economy|Prestige) option$/);
      assert.match(g.produitNom, /from Ao Nang, (VIP|Mini Luxury|Luxury|Economy|Prestige) option$/);
      vus.push(g.produit);
    }
  }
  assert.deepEqual(vus.sort(), Object.values(IDS_AONANG).flat().sort());
});

test("Ao Nang : prix par bateau de chaque offre et de chaque destination", () => {
  const e = (id, variante, extra = {}) => B.estimate(cfgAo.offres[id], { ...BASE, creneau: id === "ao-nang-economique" || id === "ao-nang-luxe" ? "" : "matin", variante, ...extra });
  assert.equal(e("ao-nang-vip", "4-islands").total, 4100);
  assert.equal(e("ao-nang-vip", "hong-islands").total, 4600);
  assert.equal(e("ao-nang-vip", "phi-phi").total, 9600);
  assert.equal(e("ao-nang-mini-luxury", "4-islands").total, 4600);
  assert.equal(e("ao-nang-mini-luxury", "hong-islands").total, 5400);
  assert.equal(e("ao-nang-mini-luxury", "phi-phi").total, 10600);
  assert.equal(e("ao-nang-luxury", "4-islands").total, 5900);
  assert.equal(e("ao-nang-luxury", "hong-islands").total, 6900);
  assert.equal(e("ao-nang-luxury", "phi-phi").total, 11900);
  assert.equal(e("ao-nang-economique", "4-islands").total, 2900);
  assert.equal(e("ao-nang-economique", "hong-island-lagoon").total, 3200);
  assert.equal(e("ao-nang-economique", "hong-island-islands").total, 3700);
  assert.equal(e("ao-nang-luxe", "hong-islands").total, 8900);
  assert.equal(e("ao-nang-luxe", "4-islands").total, 6900);
  assert.equal(e("ao-nang-luxe", "phi-phi").total, 13900);
  assert.equal(e("ao-nang-vip", "4-islands", { adults: 1 }).total, 4100, "le prix est celui du bateau, quel que soit le nombre de personnes");
  assert.equal(e("ao-nang-vip", "").ok, false, "destination obligatoire");
});

test("Ao Nang : lunch box 80 par personne, « VIP Set » 1 000 par bateau, droits du parc jamais dans le total", () => {
  const vip = (extras, patch = {}) => B.estimate(cfgAo.offres["ao-nang-vip"], { ...BASE, creneau: "matin", variante: "hong-islands", adults: 2, ages: ["6"], extras, ...patch });
  assert.equal(vip(["lunch-box"]).total, 4600 + 3 * 80, "3 personnes, enfant compris");
  const eco = B.estimate(cfgAo.offres["ao-nang-economique"], { ...BASE, variante: "4-islands", extras: ["lunch-box", "vip-set"] });
  assert.equal(eco.total, 2900 + 2 * 80 + 1000);
  const parc = B.parkFee(cfgAo.offres["ao-nang-vip"], { ...BASE, variante: "hong-islands", adults: 2, ages: ["6"] });
  assert.equal(parc.amount, 2 * 300 + 150, "Hong : 300 par adulte, 150 par enfant (barème officiel)");
  assert.equal(parc.approx, true, "la ligne du message dit « about »");
  assert.equal(B.parkFee(cfgAo.offres["ao-nang-vip"], { ...BASE, variante: "4-islands", adults: 2, ages: ["6"] }).amount, 2 * 200 + 100);
  assert.equal(B.parkFee(cfgAo.offres["ao-nang-luxe"], { ...BASE, variante: "phi-phi", adults: 2, ages: ["2"] }).amount, 800, "moins de 3 ans : gratuit");
  assert.equal(B.parkFee(cfgAo.offres["ao-nang-luxe"], { ...BASE, variante: "phi-phi", adults: 2, ages: ["3"] }).amount, 1000, "dès 3 ans : tarif enfant");
});

test("Ao Nang : capacité 4 personnes (VIP, Mini Luxury, Luxury) ou 6, au-delà WhatsApp pour un second bateau", () => {
  const err = (id, adults, variante) => B.validate(cfgAo.offres[id], { ...BASE, creneau: "matin", variante, adults, ages: [] }, today, null);
  assert.deepEqual(err("ao-nang-vip", 4, "4-islands"), {});
  assert.ok(err("ao-nang-vip", 5, "4-islands").pax);
  assert.deepEqual(err("ao-nang-economique", 6, "4-islands"), {});
  assert.ok(err("ao-nang-economique", 7, "4-islands").pax);
  assert.ok(err("ao-nang-luxe", 7, "phi-phi").pax);
});

test("Ao Nang : message envoyé à Gestion au format du site, heure de départ, aucun nom de prestataire", async () => {
  const f = fakeFetch();
  const res = B.submitRequest(cfgAo, "ao-nang-vip", { ...BASE, variante: "hong-islands", creneau: "apres-midi", ages: ["7"], extras: ["lunch-box"], message: "Un anniversaire" }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/ao-nang-excursions-bateau-6ee244/#haut", rand: () => 0 });
  assert.equal(res.ok, true);
  assert.equal(f.calls.length, 1);
  const body = JSON.parse(f.calls[0].opts.body);
  assert.equal(body.brand, "secret");
  assert.equal(body.product_id, "aonang-vip-hong");
  assert.equal(body.product, "Hong Islands from Ao Nang, VIP option");
  assert.equal(body.option, "standard");
  assert.equal(body.option_label, "VIP option");
  assert.equal(body.time, "14:30");
  assert.equal(body.adults, 2);
  assert.equal(body.children, 1);
  assert.equal(body.estimated_total, 4600 + 3 * 80);
  assert.match(body.ref, /^AON-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(body.page_url, "https://zwaldtravelplanner.com/carnet/ao-nang-excursions-bateau-6ee244/");
  const lignes = body.message.split("\n");
  assert.equal(lignes[0], "Booking request: Hong Islands from Ao Nang, VIP option – VIP option");
  assert.ok(lignes.includes("Departure: 2:30pm to sunset"));
  assert.ok(lignes.includes("Date: Tue 22 Dec 2026"));
  assert.ok(lignes.includes("Guests: 2 adults, 1 child (age 7)"));
  assert.ok(lignes.includes("Extras: Lunch box"));
  assert.ok(lignes.includes("Estimated total: 4,840 THB"));
  assert.ok(lignes.some((l) => /^Park fee: about 750 THB$/.test(l)));
  assert.ok(Buffer.byteLength(f.calls[0].opts.body) <= 4096);
  for (const re of privees.motifs() || []) assert.ok(!re.test(f.calls[0].opts.body), "nom de la liste privée dans le corps envoyé");
});

test("Ao Nang : au plus 4 096 octets avec le message, l'hôtel et le nom à leur longueur maximale", () => {
  const f = fakeFetch();
  const long = { ...BASE, variante: "phi-phi", creneau: "matin", ages: ["3", "4"], extras: ["lunch-box"], pickup: "H".repeat(200), name: "Anna " + "K".repeat(115), message: "é".repeat(500) };
  const res = B.submitRequest(cfgAo, "ao-nang-vip", long, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/ao-nang-excursions-bateau-6ee244/", rand: () => 0 });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(Buffer.byteLength(f.calls[0].opts.body) <= 4096, String(Buffer.byteLength(f.calls[0].opts.body)));
});

// ---------- Koh Lanta ----------

const LANTA_PRODUITS = {
  atv: ["track-30-min", "forest-1-hr", "beach-bridge-2-hr", "atv-kayak-2-hr"],
  batik: ["morning-or-afternoon", "kayak-and-painting", "private-course"],
  "go-kart": ["10-minutes", "15-minutes"],
  "elephant-sanctuary": ["programme-a", "programme-b", "programme-c", "programme-d"],
  "mangrove-kayaking": ["mangrove-kayak-half-day"],
  "scuba-diving": ["one-day-experience", "fun-dives", "catamaran-special-trips", "courses", "snorkelling-on-dive-boat", "rentals-and-discounts"],
  kayak: ["sea-cave-island-hopping-1-day", "love-kayak-1-day", "sea-cave-mangrove-half-day"],
  "cooking-class": ["single-chef", "partner-chef", "carving"],
  "4-islands": ["join-in-longtail", "join-in-speedboat", "private-longtail", "private-speedboat"],
  "fishing-trip": ["private-raft"],
  "koh-phi-phi": ["join-in-speedboat", "sunset", "private-longtail", "private-speedboat"],
  "koh-rok-koh-haa": ["join-in-speedboat", "sunset", "private-longtail", "private-speedboat"],
  mangroves: ["longtail-half-day", "longtail-old-town-viewpoint", "fishing-park"],
  "sunrise-raft": ["raft-sunrise"],
  "sunset-dinner-raft": ["raft-sunset-dinner"],
  rental: ["cars-and-pick-ups", "big-bikes", "scooters-and-small-bikes"],
  "speedboat-ferry": [""]
};

test("Koh Lanta : chaque offre envoie un produit et une option du contrat Gestion (identifiants du site des excursions)", () => {
  for (const [id, o] of Object.entries(cfgLa.offres)) {
    const g = B.gestionIds(o, { variante: "", creneau: "" });
    assert.ok(LANTA_PRODUITS[g.produit], `${id} : produit ${g.produit} hors contrat`);
    assert.ok(LANTA_PRODUITS[g.produit].includes(g.option), `${id} : option ${g.option} hors contrat`);
    assert.ok(g.produitNom, id);
  }
  const vus = new Set(Object.values(cfgLa.offres).map((o) => o.gestion.produit + "/" + o.gestion.option));
  for (const [p, opts] of Object.entries(LANTA_PRODUITS)) for (const o of opts) assert.ok(vus.has(p + "/" + o) || p === "shared-minivan", `${p}/${o} sans offre`);
});

test("Koh Lanta : sorties en groupe, adulte, enfant de 4 à 11 ans, gratuit avant 4 ans, plus âgé au tarif adulte", () => {
  const e = (id, adults, ages, patch = {}) => B.estimate(cfgLa.offres[id], { ...BASE, adults, ages, ...patch });
  assert.equal(e("4-islands--join-in-longtail", 2, ["6"]).total, 2 * 1000 + 600);
  assert.equal(e("4-islands--join-in-longtail", 2, ["3"]).total, 2000, "moins de 4 ans : gratuit");
  assert.equal(e("4-islands--join-in-longtail", 2, ["12"]).total, 3000, "12 ans : tarif adulte");
  assert.equal(e("4-islands--join-in-speedboat", 2, ["6"]).total, 2 * 2000 + 1000);
  assert.equal(e("koh-rok-koh-haa--sunset", 2, ["6"], { date: "2026-12-22" }).total, 2 * 2900 + 1900);
  assert.equal(e("koh-phi-phi--join-in-speedboat", 2, ["10"]).total, 2 * 2000 + 1000);
  assert.equal(e("mangroves--longtail-half-day", 2, ["8"], { choix: { slot: "morning" } }).total, 2 * 1000 + 700);
  assert.equal(e("elephant-sanctuary--programme-d", 2, ["8"]).total, 2 * 4500 + 3000);
});

test("Koh Lanta : bateaux privés par palier, supplément Koh Kradan 700 par bateau, droits du parc hors total", () => {
  const e = (id, adults, patch = {}) => B.estimate(cfgLa.offres[id], { ...BASE, adults, ages: [], ...patch });
  assert.equal(e("4-islands--private-longtail", 2).total, 5900);
  assert.equal(e("4-islands--private-longtail", 4).total, 6400);
  assert.equal(e("4-islands--private-longtail", 6).total, 7400);
  assert.equal(e("4-islands--private-longtail", 3, { extras: ["koh-kradan"] }).total, 6400 + 700);
  assert.equal(e("koh-rok-koh-haa--private-longtail", 3).total, 7400);
  assert.equal(e("koh-rok-koh-haa--private-longtail", 5).total, 7900);
  assert.equal(e("koh-rok-koh-haa--private-longtail", 7).total, 8400);
  assert.equal(e("koh-rok-koh-haa--private-longtail", 8).total, 8400);
  assert.equal(e("koh-rok-koh-haa--private-longtail", 9).total, 9400);
  assert.equal(e("koh-rok-koh-haa--private-longtail", 10).total, 9400);
  assert.equal(e("koh-rok-koh-haa--private-longtail", 11).ok, false, "au-delà de 10 personnes : WhatsApp");
  assert.equal(B.parkFee(cfgLa.offres["4-islands--private-longtail"], { ...BASE, adults: 2, ages: ["6"] }).amount, 2 * 200 + 100);
  assert.equal(B.parkFee(cfgLa.offres["koh-phi-phi--join-in-speedboat"], { ...BASE, adults: 2, ages: ["6"] }).amount, 2 * 400 + 200);
  assert.equal(B.parkFee(cfgLa.offres["koh-rok-koh-haa--join-in-speedboat"], { ...BASE, adults: 2, ages: ["3"] }).amount, 800, "moins de 4 ans : gratuit (âge publié pour Koh Rok)");
  assert.equal(B.parkFee(cfgLa.offres["koh-rok-koh-haa--join-in-speedboat"], { ...BASE, adults: 2, ages: ["12"] }).amount, 1200, "dès 12 ans : tarif adulte");
  assert.equal(B.parkFee(cfgLa.offres["atv--track-30-min"], { ...BASE, adults: 2, ages: [] }), null);
});

test("Koh Lanta : radeaux, prix du radeau pour 2 puis supplément par adulte et par enfant de 3 à 9 ans", () => {
  const e = (id, adults, ages) => B.estimate(cfgLa.offres[id], { ...BASE, adults, ages });
  assert.equal(e("fishing-trip--private-raft", 2, []).total, 3900);
  assert.equal(e("fishing-trip--private-raft", 3, ["5"]).total, 3900 + 1800 + 1500);
  assert.equal(e("sunrise-raft--raft-sunrise", 1, []).total, 3500);
  assert.equal(e("sunrise-raft--raft-sunrise", 4, ["9"]).total, 3500 + 2 * 1500 + 1200);
  assert.equal(e("sunset-dinner-raft--raft-sunset-dinner", 2, ["4"]).total, 3900 + 1500);
});

test("Koh Lanta : quad et go-kart au nombre de pilotes, passagers, karts", () => {
  const q = B.estimate(cfgLa.offres["atv--forest-1-hr"], { ...BASE, counts: { "adulte-pilote": 2, "adulte-passager": 1, "enfant-passager": 1 } });
  assert.equal(q.total, 2 * 1800 + 1300 + 1000);
  const k = B.estimate(cfgLa.offres["go-kart--10-minutes"], { ...BASE, counts: { "petit-simple": 1, "grand-double": 2 } });
  assert.equal(k.total, 399 + 2 * 599);
  assert.equal(B.estimate(cfgLa.offres["atv--forest-1-hr"], { ...BASE, counts: {} }).ok, false, "au moins un pilote ou passager");
  const body = JSON.parse((() => { const f = fakeFetch(); B.submitRequest(cfgLa, "atv--forest-1-hr", { ...BASE, counts: { "adulte-pilote": 2, "enfant-passager": 1 } }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 }); return f.calls[0].opts.body; })());
  assert.equal(body.product_id, "atv");
  assert.equal(body.option, "forest-1-hr");
  assert.match(body.message, /Riders and passengers: 2 × Adult rider, 1 × Child passenger/);
});

test("Koh Lanta : cours de cuisine, séance selon le jour de la semaine ; séance de matin ou d'après-midi obligatoire", () => {
  const cuisine = cfgLa.offres["cooking-class--single-chef"];
  const lundi = "2026-12-21";
  const mardi = "2026-12-22";
  const err = (patch) => B.validate(cuisine, { ...BASE, ...patch }, today, null);
  assert.deepEqual(err({ date: lundi, choix: { class: "lunch" } }), {});
  assert.ok(err({ date: mardi, choix: { class: "lunch" } }).date, "le déjeuner n'a pas lieu le mardi");
  assert.deepEqual(err({ date: mardi, choix: { class: "dinner" } }), {});
  assert.ok(err({ date: mardi, choix: {} })["choix-class"], "séance obligatoire");
  assert.equal(B.estimate(cuisine, { ...BASE, date: lundi, choix: { class: "lunch" }, adults: 2, ages: [] }).total, 2 * 1900);
  const mangrove = cfgLa.offres["mangroves--fishing-park"];
  assert.ok(B.validate(mangrove, { ...BASE, choix: { slot: "morning" } }, today, null)["choix-way"], "kayak ou longtail obligatoire");
  assert.deepEqual(B.validate(mangrove, { ...BASE, choix: { slot: "morning", way: "kayak" } }, today, null), {});
});

test("Koh Lanta : Koh Rok fermée de la mi-mai à la mi-octobre, prix sur demande sans total", () => {
  const rok = cfgLa.offres["koh-rok-koh-haa--join-in-speedboat"];
  assert.match(B.validate(rok, { ...BASE, date: "2027-07-10" }, today, null).date, /mi-octobre/);
  assert.deepEqual(B.validate(rok, { ...BASE, date: "2026-12-22" }, today, null), {});
  const sur = B.estimate(cfgLa.offres["4-islands--private-speedboat"], { ...BASE });
  assert.equal(sur.ok, true);
  assert.equal(sur.onRequest, true);
  const f = fakeFetch();
  B.submitRequest(cfgLa, "4-islands--private-speedboat", { ...BASE }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
  const body = JSON.parse(f.calls[0].opts.body);
  assert.equal(body.estimated_total, null);
  assert.match(body.message, /Price: on request/);
  assert.doesNotMatch(body.message, /Estimated total/);
});

test("Koh Lanta : message au format du site, produit et option de Gestion, enfant avec son âge", () => {
  const f = fakeFetch();
  B.submitRequest(cfgLa, "4-islands--join-in-longtail", { ...BASE, ages: ["6", "9"], message: "Merci" }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/koh-lanta-excursions-activites-vfrqfx/#bateau", rand: () => 0 });
  const body = JSON.parse(f.calls[0].opts.body);
  assert.equal(body.product_id, "4-islands");
  assert.equal(body.product, "4 Islands");
  assert.equal(body.option, "join-in-longtail");
  assert.equal(body.option_label, "Join-in longtail");
  assert.equal(body.estimated_total, 2 * 1000 + 600 + 600);
  assert.match(body.ref, /^LAN-/);
  const lignes = body.message.split("\n");
  assert.equal(lignes[0], "Booking request: 4 Islands – Join-in longtail");
  assert.ok(lignes.includes("Guests: 2 adults, 2 children (ages 6 and 9)"));
  assert.ok(lignes.includes("Pickup: Hôtel d’essai"));
  assert.ok(lignes.includes("Estimated total: 3,200 THB"));
  assert.ok(lignes.some((l) => /^Park fee: 600 THB$/.test(l)), body.message);
  assert.doesNotMatch(body.message, /about/);
});

test("Koh Lanta : le supplément Koh Kradan part comme sur le site des excursions (« Extras: Add Koh Kradan »), dans le total", () => {
  const f = fakeFetch();
  B.submitRequest(cfgLa, "4-islands--private-longtail", { ...BASE, adults: 2, extras: ["koh-kradan"] }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
  const body = JSON.parse(f.calls[0].opts.body);
  assert.equal(body.option, "private-longtail");
  assert.equal(body.estimated_total, 5900 + 700);
  const lignes = body.message.split("\n");
  assert.ok(lignes.includes("Extras: Add Koh Kradan"), body.message);
  assert.ok(lignes.includes("Estimated total: 6,600 THB"));
});

test("Koh Lanta : un enfant de moins de 4 ans ne compte pas dans la tranche d'un bateau privé (comme chez Gestion)", () => {
  const e = (id, adults, ages) => B.estimate(cfgLa.offres[id], { ...BASE, adults, ages });
  // 5 adultes + enfants de 3 et 2 ans : le groupe est de 5 personnes, tranche 4 à 6 (Koh Rok) ou 5 à 6 (4 Islands), pas 7 à 8
  assert.equal(e("koh-rok-koh-haa--private-longtail", 5, ["3", "2"]).total, 7900);
  assert.equal(e("4-islands--private-longtail", 5, ["3", "2"]).total, 7400);
  // à 4 ans l'enfant compte
  assert.equal(e("koh-rok-koh-haa--private-longtail", 5, ["4", "4"]).total, 8400, "5 adultes + 2 enfants de 4 ans : 7 personnes");
  assert.equal(e("koh-rok-koh-haa--private-longtail", 5, ["4", "2"]).total, 7900, "5 adultes + 1 enfant de 4 ans : 6 personnes");
  assert.equal(e("4-islands--private-longtail", 5, ["4", "3"]).total, 7400, "5 adultes + enfants de 4 et 3 ans : 6 personnes");
  // la capacité se compte de la même façon : 6 adultes et 2 petits tiennent sur le 4 Islands privé
  assert.deepEqual(B.validate(cfgLa.offres["4-islands--private-longtail"], { ...BASE, adults: 6, ages: ["3", "1"] }, today, null), {});
  assert.ok(B.validate(cfgLa.offres["4-islands--private-longtail"], { ...BASE, adults: 6, ages: ["4"] }, today, null).pax);
  // un âge manquant compte (la feuille le réclame avant l'envoi)
  assert.equal(e("koh-rok-koh-haa--private-longtail", 5, ["", "4"]).total, 8400);
});

test("Koh Lanta : go-kart, le message dit toujours Guests (une place compte pour une personne) et le corps a des adultes", () => {
  const f = fakeFetch();
  B.submitRequest(cfgLa, "go-kart--10-minutes", { ...BASE, counts: { "petit-simple": 2 } }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
  const body = JSON.parse(f.calls[0].opts.body);
  assert.equal(body.adults, 2);
  assert.equal(body.children, 0);
  assert.equal(body.estimated_total, 2 * 399);
  assert.ok(body.message.split("\n").includes("Guests: 2 adults"), body.message);
  assert.match(body.message, /Karts: 2 × Small single seat/);
  // un kart à deux places compte deux places
  const g = fakeFetch();
  B.submitRequest(cfgLa, "go-kart--10-minutes", { ...BASE, counts: { "grand-double": 1, "petit-simple": 1 } }, { fetch: g, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
  assert.ok(JSON.parse(g.calls[0].opts.body).message.split("\n").includes("Guests: 3 adults"));
  // quad : les enfants sont dits aussi
  const h = fakeFetch();
  B.submitRequest(cfgLa, "atv--forest-1-hr", { ...BASE, counts: { "adulte-pilote": 2, "enfant-passager": 1 } }, { fetch: h, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
  assert.ok(JSON.parse(h.calls[0].opts.body).message.split("\n").includes("Guests: 2 adults, 1 child"));
});

test("Koh Lanta : une quantité hors de 0 à 20 (ou pas un nombre entier) est refusée avec un message, jamais ramenée à la limite", () => {
  const quad = cfgLa.offres["atv--forest-1-hr"];
  const err = (counts) => B.validate(quad, { ...BASE, counts }, today, null);
  const cle = "ligne-adulte-pilote";
  assert.match(err({ "adulte-pilote": 99 })[cle], /^Adulte pilote : 20 au plus\. Pour un groupe plus grand, écrivez à Anaïs\.$/);
  assert.match(err({ "adulte-pilote": "21" })[cle], /20 au plus/);
  assert.match(err({ "adulte-pilote": "-1" })[cle], /^Adulte pilote : indiquez un nombre entier de 0 à 20\.$/);
  assert.match(err({ "adulte-pilote": "2.5" })[cle], /^Adulte pilote : indiquez un nombre entier de 0 à 20\.$/);
  assert.match(err({ "adulte-pilote": "2,5" })[cle], /nombre entier de 0 à 20/);
  assert.match(err({ "adulte-pilote": "abc" })[cle], /^Adulte pilote : indiquez un nombre\.$/, "une saisie non numérique est une erreur, pas un zéro");
  assert.match(err({ "adulte-pilote": "?" })[cle], /indiquez un nombre\./, "saisie illisible d'un champ numérique");
  assert.equal(new Set(["-1", "abc", "21"].map((v) => err({ "adulte-pilote": v })[cle])).size, 3, "trois messages distincts");
  assert.deepEqual(Object.keys(err({ "adulte-pilote": 99, "enfant-passager": 30 })).sort(), ["ligne-adulte-pilote", "ligne-enfant-passager"], "une clé par ligne fautive, la ligne correcte n'a pas d'erreur");
  assert.deepEqual(err({ "adulte-pilote": 20 }), {});
  assert.deepEqual(err({ "adulte-pilote": "2", "enfant-passager": "" }), {});
  assert.equal(B.estimate(quad, { ...BASE, counts: { "adulte-pilote": 99 } }).ok, false, "pas d'estimation sur 99 quads");
  const f = fakeFetch();
  const res = B.submitRequest(cfgLa, "atv--forest-1-hr", { ...BASE, counts: { "adulte-pilote": 99 } }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
  assert.equal(res.ok, false);
  assert.equal(f.calls.length, 0, "rien n'est envoyé");
});

test("Koh Lanta : chaque choix, option et ligne a un libellé anglais réel (le message part en anglais)", () => {
  const FRANCAIS = /[àâçéèêëîïôûùüÿœ]/i;
  const NOMS_PROPRES = ["Koh Haa"]; // un nom de lieu s'écrit pareil dans les deux langues
  const verifie = (x, ou) => {
    assert.ok(x.en, `${ou} : champ en manquant`);
    if (!NOMS_PROPRES.includes(x.en)) assert.notEqual(x.en, x.label, `${ou} : en identique au français`);
    assert.doesNotMatch(x.en, FRANCAIS, `${ou} : accent français dans l'anglais`);
    assert.doesNotMatch(x.en, /\b(prise en charge|séance|matin|après-midi|lundi|mardi|dîner|déjeuner)\b/i, `${ou} : mot français`);
  };
  for (const [id, o] of Object.entries(cfgLa.offres)) {
    for (const g of o.choix || []) { verifie(g, `${id} / ${g.id}`); for (const v of g.valeurs) verifie(v, `${id} / ${g.id} / ${v.id}`); }
    for (const x of o.extras || []) verifie(x, `${id} / ${x.id}`);
    for (const l of o.lignes || []) verifie(l, `${id} / ${l.id}`);
    if (o.lignes) assert.ok(o.lignesLabelEn, `${id} : lignesLabelEn`);
  }
  const f = fakeFetch();
  B.submitRequest(cfgLa, "elephant-sanctuary--programme-a", { ...BASE, choix: { session: "0900" } }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
  assert.ok(JSON.parse(f.calls[0].opts.body).message.split("\n").includes("Session: 9am, pickup between 8am and 9am"));
});

test("accessibilité : la note de l'hôtel, les erreurs de choix et de quantités sont reliées à leur champ (aria-describedby)", () => {
  const njk = read("src/_includes/carnet-booking.njk");
  assert.match(njk, /id="cg-pickup-note"/);
  assert.match(njk, /id="cg-pickup"[^>]*aria-describedby="cg-pickup-note cg-err-pickup"/);
  const js = read("src/js/carnet-booking.js");
  assert.match(js, /name: "choix-" \+ g\.id, value: v\.id, "aria-describedby": "cg-err-choix-" \+ g\.id/);
  assert.match(js, /name: "ligne-" \+ l\.id, "aria-describedby": "cg-err-ligne-" \+ l\.id \+ " cg-err-lignes"/);
  assert.match(js, /id: "cg-err-ligne-" \+ l\.id/, "un message par ligne");
});

test("textes : rien de « la moins chère » faux, aucune référence interne, la phrase de haute saison tournée vers l'action", () => {
  const ao = texteVisible(read(PAGE_AO)).replace(/\s+/g, " ");
  assert.doesNotMatch(ao, /l’option la moins chère/);
  assert.match(ao, /Option VIP \(la moins chère des trois niveaux\)/);
  for (const f of [PAGE_AO, PAGE_LA]) {
    const t = texteVisible(read(f)).replace(/\s+/g, " ");
    assert.doesNotMatch(t, /d’où le supplément|pas faite suffisamment|Anaïs le confirme|avec Anaïs\b/, f);
  }
});

test("Koh Lanta : sorties « sunset », le site ne publie ni gratuité ni âge pour un enfant de moins de 4 ans : estimation partielle, jamais « Gratuit »", () => {
  for (const id of ["koh-rok-koh-haa--sunset", "koh-phi-phi--sunset"]) {
    assert.equal(cfgLa.offres[id].bebe, undefined, id);
    const e = B.estimate(cfgLa.offres[id], { ...BASE, adults: 2, ages: ["3", "6"] });
    assert.equal(e.total, 2 * 2900 + 1900, id);
    assert.equal(e.partial, 1, id + " : un enfant sans tarif écrit");
    assert.match(e.notes.join(" "), /moins de 4 ans.*pas de tarif écrit/, id);
    const f = fakeFetch();
    B.submitRequest(cfgLa, id, { ...BASE, adults: 2, ages: ["3"] }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
    assert.match(JSON.parse(f.calls[0].opts.body).message, /Partial estimate: the price of 1 child is to be confirmed/);
  }
  assert.ok(cfgLa.offres["koh-phi-phi--join-in-speedboat"].bebe, "le groupe partagé publie bien « Child under 4 » à 0");
  const doc = read(PAGE_LA);
  const carte = (id) => doc.slice(doc.indexOf(`id="offre-${id}"`), doc.indexOf("</article>", doc.indexOf(`id="offre-${id}"`)));
  assert.doesNotMatch(carte("koh-phi-phi--sunset"), /Gratuit|moins de 4 ans/);
  assert.doesNotMatch(carte("koh-rok-koh-haa--sunset"), /Gratuit|moins de 4 ans/);
  assert.match(carte("koh-phi-phi--join-in-speedboat"), /Enfant de moins de 4 ans.*Gratuit/);
});

test("Koh Lanta : karts, au plus 60 personnes (le serveur refuse davantage) : 31 karts doubles sont refusés avec un message", () => {
  const kart = cfgLa.offres["go-kart--10-minutes"];
  const err = (counts) => B.validate(kart, { ...BASE, counts }, today, null);
  assert.deepEqual(err({ "grand-double": 20, "petit-double": 10 }), {}, "60 places");
  assert.match(err({ "grand-double": 20, "petit-double": 11 }).lignes, /Au-delà de 60 personnes/, "62 places");
  assert.match(err({ "grand-double": 20, "petit-double": 10, "petit-simple": 1 }).lignes, /Au-delà de 60 personnes/, "61 places");
  const f = fakeFetch();
  const res = B.submitRequest(cfgLa, "go-kart--10-minutes", { ...BASE, counts: { "grand-double": 20, "petit-double": 11 } }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
  assert.equal(res.ok, false);
  assert.equal(f.calls.length, 0);
  const g = fakeFetch();
  B.submitRequest(cfgLa, "go-kart--10-minutes", { ...BASE, counts: { "grand-double": 20, "petit-double": 10 } }, { fetch: g, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
  assert.equal(JSON.parse(g.calls[0].opts.body).adults, 60, "jamais plus de 60 envoyés");
});

test("message Gestion : le transfert depuis l'hôtel n'est jamais un extra, une ligne « Hotel transfer: requested (indicative … per van) »", () => {
  const samui = require("../src/carnet/koh-samui-excursions-bateau.11tydata.js").eleventyComputed.carnetConfig(business);
  const offre = samui.offres["pig-island-longtail-prive-4h"];
  assert.ok(offre.transfert, "offre à transfert");
  const raw = { ...BASE, creneau: "matin", transfert: true, ages: [] };
  const msg = B.buildGestionMessage(offre, raw, B.estimate(offre, raw), "SAM-ABCD").split("\n");
  assert.ok(msg.includes("Hotel transfer: requested (indicative 1,500 THB per van)"), msg.join("|"));
  assert.ok(!msg.some((l) => /^Extras:.*transfer/i.test(l)), "jamais dans la ligne Extras");
  const sans = B.buildGestionMessage(offre, { ...raw, transfert: false }, B.estimate(offre, { ...raw, transfert: false }), "SAM-ABCD");
  assert.doesNotMatch(sans, /Hotel transfer/);
});

test("Phi Phi : droits du parc 400 / 200 sans âge ni gratuité affichés, la ligne du message ne présume pas d'âge", () => {
  for (const id of ["koh-phi-phi--join-in-speedboat", "koh-phi-phi--sunset"]) {
    const o = cfgLa.offres[id];
    assert.equal(o.parc.enfantMin, undefined, id);
    const fee = B.parkFee(o, { ...BASE, adults: 2, ages: ["2", "7"] });
    assert.equal(fee.amount, 2 * 400 + 2 * 200, id + " : aucun enfant gratuit présumé");
    assert.equal(fee.approx, true);
    const f = fakeFetch();
    B.submitRequest(cfgLa, id, { ...BASE, adults: 2, ages: ["7"] }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
    assert.ok(JSON.parse(f.calls[0].opts.body).message.split("\n").includes("Park fee: about 1,000 THB"));
  }
  const doc = read(PAGE_LA);
  const carte = doc.slice(doc.indexOf('id="offre-koh-phi-phi--sunset"'), doc.indexOf("</article>", doc.indexOf('id="offre-koh-phi-phi--sunset"')));
  const droits = carte.match(/<p class="cg-droits">Entrée du parc[^<]*<\/p>/)[0];
  assert.match(droits, /400&nbsp;THB par adulte, 200&nbsp;THB par enfant\. Droit d’entrée du parc national, fixé par le parc, à régler sur place en espèces\.<\/p>$/);
  assert.doesNotMatch(droits, /\d ans|gratuit/i);
  // Koh Rok et 4 Islands : le site publie l'âge (4 à 11 ans, gratuit avant 4 ans)
  assert.match(texteVisible(read(PAGE_LA)).replace(/\s+/g, " "), /Entrée du parc, en plus du prix : 400 THB par adulte, 200 THB par enfant \(de 4 à 11 ans\), gratuit avant 4 ans/);
});

test("alt des photos : chaque image des deux pages existe et son texte alternatif ne cite rien d'absent", () => {
  for (const f of [PAGE_AO, PAGE_LA]) {
    const imgs = [...read(f).matchAll(/<img [^>]*alt="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(imgs.length >= 3, f);
  }
  const fruits = [...read(PAGE_AO).matchAll(/<img [^>]*alt="([^"]*fruits[^"]*)"/g)].map((m) => m[1]);
  assert.equal(fruits.length, 1);
  assert.doesNotMatch(fruits[0], /bateau/i, "aucun bateau sur la photo des fruits");
  const src = read("src/carnet/ao-nang-excursions-bateau.11tydata.js") + read("src/carnet/koh-lanta-excursions-activites.11tydata.js") + read("src/carnet/ao-nang-excursions-bateau.njk") + read("src/carnet/koh-lanta-excursions-activites.njk");
  for (const m of src.matchAll(/\/images\/(carnet-[a-z0-9-]+\.jpg)/g)) assert.ok(fs.existsSync(path.join(root, "src", "images", m[1])), m[1] + " : image absente");
});

test("bateau privé à paliers : la phrase sur les enfants de moins de 4 ans est sur la carte et dans l'estimation quand elle joue", () => {
  const phrase = "Les enfants de moins de 4 ans ne comptent pas dans le nombre de personnes du bateau privé.";
  const doc = texteVisible(read(PAGE_LA)).replace(/\s+/g, " ");
  assert.equal((doc.match(new RegExp(phrase.replace(/[.]/g, "\\."), "g")) || []).length, 2, "carte du 4 Islands privé et du Koh Rok privé");
  const e = B.estimate(cfgLa.offres["4-islands--private-longtail"], { ...BASE, adults: 2, ages: ["2", "3", "3"] });
  assert.equal(e.total, 5900, "2 adultes + 3 petits : 2 personnes dans le groupe");
  assert.ok(e.notes.includes(phrase), e.notes.join("|"));
  const plus = B.estimate(cfgLa.offres["4-islands--private-longtail"], { ...BASE, adults: 2, ages: ["5"] });
  assert.ok(!plus.notes.includes(phrase), "aucune mention quand aucun enfant n'est concerné");
  assert.ok(!B.estimate(cfgAo.offres["ao-nang-vip"], { ...BASE, creneau: "matin", variante: "4-islands", adults: 2, ages: ["2"] }).notes.includes(phrase), "pas sur les bateaux sans seuil");
});

test("publication : aucun tableau de notes internes (aConfirmer) ni prix de prestataire dans src/carnet, les gabarits et le script", () => {
  const fichiers = fs.readdirSync(path.join(root, "src", "carnet")).map((f) => path.join("src", "carnet", f))
    .concat(fs.readdirSync(path.join(root, "src", "_includes")).filter((f) => /^carnet-/.test(f)).map((f) => path.join("src", "_includes", f)), ["src/js/carnet-booking.js"]);
  assert.ok(fichiers.length >= 8);
  for (const f of fichiers) {
    const t = read(f);
    assert.doesNotMatch(t, /aConfirmer/, `${f} : tableau ou mot aConfirmer`);
    assert.doesNotMatch(t, /\bPDF d['’]Anaïs|donné[es]? par Jérémy|décision de Jérémy|\(Jérémy,/i, `${f} : arbitrage interne`);
  }
});

test("Park fee : la page écrit la clé exacte « Park fee: » et Gestion la lit (d.parc rempli)", async (t) => {
  const f = fakeFetch();
  B.submitRequest(cfgAo, "ao-nang-vip", { ...BASE, variante: "hong-islands", creneau: "matin", adults: 2, ages: ["7", "9"] }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/ao-nang-excursions-bateau-6ee244/", rand: () => 0 });
  const message = JSON.parse(f.calls[0].opts.body).message;
  assert.ok(message.split("\n").includes("Park fee: about 900 THB"), message); // pas de « paid on site » : Gestion l'ajoute lui-même
  const contrat = contratChemin();
  const calc = contrat && path.join(path.dirname(contrat), "..", "..", "src", "gestion", "js", "demande-calc.mjs");
  if (!calc || !fs.existsSync(calc)) { t.skip("demande-calc.mjs de Gestion absent : lecture de la ligne non vérifiée"); return; }
  const { lireDemande } = await import(calc);
  const d = lireDemande(message, "2026-11-23");
  assert.equal(d.parc, "about 900 THB", "Gestion range la ligne dans d.parc");
  assert.doesNotMatch(message, /Park fee:.*(paid|total)/);
  assert.equal(d.adultes, 2);
  assert.equal(d.enfants, 2);
  const g = fakeFetch();
  B.submitRequest(cfgLa, "koh-rok-koh-haa--join-in-speedboat", { ...BASE, adults: 2, ages: ["6"] }, { fetch: g, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/koh-lanta-excursions-activites-vfrqfx/", rand: () => 0 });
  assert.equal(lireDemande(JSON.parse(g.calls[0].opts.body).message, "2026-11-23").parc, "1,000 THB");
});

test("Ao Nang : Mini Luxury propose la lunch box (le déjeuner n'y est pas compris), Luxury non (repas de midi compris)", () => {
  const mini = cfgAo.offres["ao-nang-mini-luxury"];
  assert.deepEqual(mini.extras.map((x) => [x.id, x.prix, x.unite]), [["lunch-box", 80, "personne"]]);
  assert.equal(B.estimate(mini, { ...BASE, creneau: "matin", variante: "4-islands", adults: 2, ages: ["5"], extras: ["lunch-box"] }).total, 4600 + 3 * 80);
  assert.equal(cfgAo.offres["ao-nang-luxury"].extras, undefined);
  assert.deepEqual(cfgAo.offres["ao-nang-vip"].extras.map((x) => x.id), ["lunch-box"]);
  const luxe = ao.guide.sections[0].groupes; // la page Luxury cite le repas de midi comme compris
  assert.ok(luxe.some((g) => /repas de midi/.test(g.texte)));
  const f = fakeFetch();
  B.submitRequest(cfgAo, "ao-nang-mini-luxury", { ...BASE, creneau: "matin", variante: "4-islands", extras: ["lunch-box"] }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/ao-nang-excursions-bateau-6ee244/", rand: () => 0 });
  assert.ok(JSON.parse(f.calls[0].opts.body).message.split("\n").includes("Extras: Lunch box"));
});

test("Plongée : Scuba Explorer dès 8 ans, Discover Basic Diver dès 10 ans, un enfant plus jeune bloque l'envoi avec « Âge minimum »", () => {
  const o = cfgLa.offres["scuba-diving--one-day-experience"];
  const err = (programme, ages) => B.validate(o, { ...BASE, ages, choix: { programme } }, today, null);
  assert.deepEqual(err("explorer", ["8"]), {});
  assert.equal(err("explorer", ["5"])["age-0"], "Âge minimum : 8 ans (Scuba Explorer).");
  assert.deepEqual(err("basic", ["10"]), {});
  assert.equal(err("basic", ["9"])["age-0"], "Âge minimum : 10 ans (Discover Basic Diver).");
  assert.equal(err("basic", ["12", "7"])["age-1"], "Âge minimum : 10 ans (Discover Basic Diver).");
  assert.equal(err("basic", ["12", "7"])["age-0"], undefined, "seul l'enfant trop jeune est signalé");
  const f = fakeFetch();
  const res = B.submitRequest(cfgLa, "scuba-diving--one-day-experience", { ...BASE, ages: ["5"], choix: { programme: "explorer" } }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
  assert.equal(res.ok, false);
  assert.equal(f.calls.length, 0, "rien n'est envoyé");
  // une offre peut aussi porter un âge minimum propre
  assert.equal(B.validate({ ...o, choix: [], ageMin: 12 }, { ...BASE, ages: ["11"] }, today, null)["age-0"], "Âge minimum : 12 ans.");
});

test("Prix sur demande qui exige un détail : message obligatoire (erreur claire), pas de phrase « Estimation… » sans montant", () => {
  const exigent = ["speedboat-ferry", "rental--cars-and-pick-ups", "rental--big-bikes", "rental--scooters-and-small-bikes", "scuba-diving--catamaran-special-trips", "scuba-diving--courses", "scuba-diving--rentals-and-discounts"];
  for (const id of exigent) {
    const o = cfgLa.offres[id];
    assert.equal(o.type, "surDemande", id);
    assert.equal(o.messageObligatoire, true, id);
    assert.match(B.validate(o, { ...BASE, message: "" }, today, null).message, /^Ce message est obligatoire : .+\.$/, id);
    assert.match(B.validate(o, { ...BASE, message: "   " }, today, null).message, /obligatoire/, id + " : espaces seuls");
    assert.equal(B.validate(o, { ...BASE, message: "Lanta vers Phi Phi, samedi" }, today, null).message, undefined, id);
  }
  assert.equal(B.validate(cfgLa.offres["4-islands--private-speedboat"], { ...BASE, message: "" }, today, null).message, undefined, "les autres offres sur demande gardent un message facultatif");
  const njk = read("src/_includes/carnet-booking.njk");
  assert.match(njk, /data-cg="message-note">\(facultatif\)/);
  assert.match(njk, /data-cg="estimate-foot"/);
  const js = read("src/js/carnet-booking.js");
  assert.match(js, /\$\("estimate-foot"\)\.hidden = !\(est\.ok && !est\.onRequest\)/);
  assert.match(js, /"\(obligatoire\)" : "\(facultatif\)"/);
});

test("titres : chaque groupe replié de Koh Lanta est un h3 et ses offres des h4, aucune suite de h4 sans parent", () => {
  for (const f of [PAGE_AO, PAGE_LA]) {
    const html = read(f);
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    const niveaux = [...main.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    assert.equal(niveaux[0], 1, f);
    niveaux.forEach((n, i) => { if (i) assert.ok(n <= niveaux[i - 1] + 1, `${f} : saut de h${niveaux[i - 1]} à h${n} (titre n°${i})`); });
  }
  const la = read(PAGE_LA);
  assert.equal((la.match(/<summary><h3 class="cg-prod-titre"/g) || []).length, 17, "17 groupes repliés");
  assert.doesNotMatch(la, /<span class="cg-prod-titre"/);
});

test("« dès » d'un groupe replié = le plus petit prix ADULTE (ou par bateau) de ses offres, jamais un tarif enfant", () => {
  const { prixMinimum } = require("../src/carnet/guide-commun.js");
  const offres = la.eleventyComputed.offres();
  const html = texteVisible(read(PAGE_LA)).replace(/\s+/g, " ");
  const attendu = { "Les 4 Islands": 1000, "Koh Rok et Koh Haa": 2000, "Koh Phi Phi": 2000, "La mangrove": 1000, "Pêche sur un radeau privé": 3900, "Radeau au lever du soleil": 3500, "Radeau et dîner au coucher du soleil": 3900,
    "Quad (ATV)": 900, "Sanctuaire d’éléphants": 1800, "Cours de cuisine thaïe": 1650, "Peinture sur batik": 1500, "Go-kart électrique": 399, "Kayak": 1000, "Plongée": 1800 };
  const vus = [];
  for (const sec of la.guide.sections) for (const g of sec.groupes || []) {
    if (!g.repliable) continue;
    const prix = g.offres.map((id) => prixMinimum(offres[id])).filter((x) => x !== null);
    if (!prix.length) { assert.ok(!new RegExp(g.titre + " dès").test(html), `${g.titre} : aucun « dès » sans prix`); continue; }
    const mini = Math.min(...prix);
    assert.equal(g.des, mini, `${g.titre} : des = minimum des offres`);
    assert.equal(g.des, attendu[g.titre], `${g.titre} : valeur attendue`);
    assert.ok(html.includes(`${g.titre} dès ${String(mini).replace(/\B(?=(\d{3})+(?!\d))/g, "’")} THB`), `${g.titre} : « dès ${mini} » affiché`);
    vus.push(g.titre);
    // aucun adulte ne paie moins : ni le tarif adulte, ni une ligne de pilote ou de passager adulte, ni une tranche, ni une formule
    for (const id of g.offres) {
      const o = offres[id];
      const adultes = [o.adulte, ...(o.lignes || []).filter((l) => !l.role || l.role === "adulte").map((l) => l.prix), ...(o.paliers || []).map((t) => t.prix), ...(o.variantes || []).map((v) => v.prix), o.base && o.base.prix].filter((n) => typeof n === "number" && n > 0);
      for (const n of adultes) assert.ok(n >= g.des, `${id} : ${n} < dès ${g.des}`);
    }
  }
  assert.deepEqual(vus.sort(), Object.keys(attendu).sort());
  // les tarifs enfant (600 au 4 Islands, 700 en mangrove, 600 en quad) ne sont jamais le « dès »
  assert.ok(!html.includes("Les 4 Islands dès 600"));
  assert.ok(!html.includes("Quad (ATV) dès 600"));
});

test("offres sur demande d'un parc : les droits d'entrée sont dits comme sur les offres voisines (mêmes montants, mêmes âges), jamais dans un total", () => {
  const regle = (id) => cfgLa.offres[id].parc;
  assert.deepEqual(regle("4-islands--private-speedboat"), regle("4-islands--private-longtail"));
  assert.deepEqual(regle("koh-rok-koh-haa--private-speedboat"), regle("koh-rok-koh-haa--private-longtail"));
  assert.deepEqual(regle("koh-phi-phi--private-longtail"), regle("koh-phi-phi--join-in-speedboat"));
  assert.deepEqual(regle("koh-phi-phi--private-speedboat"), regle("koh-phi-phi--sunset"));
  const doc = read(PAGE_LA);
  const carte = (id) => texteVisible(doc.slice(doc.indexOf(`id="offre-${id}"`), doc.indexOf("</article>", doc.indexOf(`id="offre-${id}"`)))).replace(/\s+/g, " ");
  for (const id of ["4-islands--private-speedboat", "koh-rok-koh-haa--private-speedboat", "koh-phi-phi--private-longtail", "koh-phi-phi--private-speedboat"]) {
    assert.match(carte(id), /Entrée du parc, en plus du prix : /, id);
    assert.match(carte(id), /Prix sur demande/, id);
  }
  assert.match(carte("4-islands--private-speedboat"), /200 THB par adulte, 100 THB par enfant \(de 4 à 11 ans\), gratuit avant 4 ans/);
  assert.match(carte("koh-phi-phi--private-speedboat"), /400 THB par adulte, 200 THB par enfant\. Droit d’entrée du parc national, fixé par le parc, à régler sur place en espèces\./);
  assert.doesNotMatch(carte("koh-phi-phi--private-speedboat"), /\d ans|gratuit/, "aucun âge présumé pour Phi Phi");
  const f = fakeFetch();
  B.submitRequest(cfgLa, "4-islands--private-speedboat", { ...BASE, adults: 2, ages: ["6"] }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/x-abc123/", rand: () => 0 });
  const body = JSON.parse(f.calls[0].opts.body);
  assert.equal(body.estimated_total, null, "aucun total");
  assert.ok(body.message.split("\n").includes("Park fee: 500 THB"), body.message);
});

test("quantités : modifier une ligne n'efface que son propre message (source), le message de la ligne fautive reste", () => {
  const js = read("src/js/carnet-booking.js");
  assert.match(js, /var ligne = target && target\.getAttribute \? target\.getAttribute\("data-cg-ligne"\) : null;/);
  assert.match(js, /\["cg-err-ligne-" \+ ligne, "cg-err-lignes"\]/);
  assert.match(js, /\} else if \(field\) Array\.prototype\.forEach\.call\(field\.querySelectorAll\("\.cg-err"\)/);
  assert.match(js, /i\.validity && i\.validity\.badInput \? "\?" : i\.value/);
});

test("droits du parc : phrase vendeur unique, plus aucun « à confirmer » sur les droits, Hong enfant 150, la ligne du message ne change pas", () => {
  const SENTENCE = "Droit d’entrée du parc national, fixé par le parc, à régler sur place en espèces.";
  for (const f of [PAGE_AO, PAGE_LA]) {
    const t = texteVisible(read(f)).replace(/\s+/g, " ");
    assert.ok(t.includes(SENTENCE), f);
    assert.doesNotMatch(t, /montants? à confirmer|à confirmer au moment de la réservation|tarif étranger/i, f);
    const droits = [...read(f).matchAll(/<p class="cg-droits">(Entrée du parc[^<]*)<\/p>/g)].map((m) => m[1]);
    assert.ok(droits.length >= 5, f);
    for (const d of droits) assert.match(d, /Droit d’entrée du parc national, fixé par le parc, à régler sur place en espèces\.$/, f);
  }
  const ao = texteVisible(read(PAGE_AO)).replace(/\s+/g, " ");
  assert.match(ao, /Hong Islands, 300 THB par adulte et 150 THB par enfant/);
  assert.match(ao, /4 Islands, 200 THB par adulte et 100 THB par enfant/);
  assert.match(ao, /Phi Phi Islands, 400 THB par adulte et 200 THB par enfant/);
  assert.match(ao, /enfant de 3 à 14 ans, gratuit avant 3 ans/);
  // tout enfant de Hong : 150, dans toutes les formules qui y vont
  for (const o of Object.values(cfgAo.offres)) for (const v of o.variantes) if (/hong/.test(v.id)) { assert.deepEqual([v.parc.adulte, v.parc.enfant], [300, 150], v.id); assert.equal(v.parc.fixe, true); }
  // l'estimation de la feuille n'a plus la mention, la ligne du message garde « about N THB »
  const js = read("src/js/carnet-booking.js");
  assert.doesNotMatch(js, /Montants à confirmer/);
  assert.match(js, /Droit d" \+ APOS \+ "entrée du parc national, fixé par le parc, à régler sur place en espèces, hors estimation : /);
  const f = fakeFetch();
  B.submitRequest(cfgAo, "ao-nang-luxe", { ...BASE, variante: "hong-islands", adults: 2, ages: ["5"] }, { fetch: f, now: NOW, pageUrl: "https://zwaldtravelplanner.com/carnet/ao-nang-excursions-bateau-6ee244/", rand: () => 0 });
  assert.ok(JSON.parse(f.calls[0].opts.body).message.split("\n").includes("Park fee: about 750 THB"));
});

// ---------- Pages construites ----------

const texteVisible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");

test("pages : noindex, sans analytique ni cookie, aucun lien depuis une page publique, absentes du sitemap", () => {
  for (const f of [PAGE_AO, PAGE_LA]) {
    const doc = read(f);
    assert.match(doc, /<meta name="robots" content="noindex, nofollow, noarchive">/, f);
    assert.doesNotMatch(doc, /googletagmanager|gtag\(|consent\.js|currency\.js|cookie/i, f);
    assert.doesNotMatch(doc, /application\/ld\+json|hreflang/, f);
    const permalink = f.replace("_site", "").replace("index.html", "");
    assert.ok(!read("_site/sitemap.xml").includes(permalink), f);
    assert.ok(!read("src/llms.txt").includes(permalink), f);
    assert.match(read("netlify.toml"), /\/carnet\/\*/);
  }
  const publics = [].concat(...["index.html", "services/index.html", "blog/index.html", "faq/index.html"].map((p) => { try { return [read("_site/" + p)]; } catch (e) { return []; } }));
  for (const doc of publics) assert.doesNotMatch(doc, /ao-nang-excursions-bateau-6ee244|koh-lanta-excursions-activites-vfrqfx/);
});

test("pages : aucun nom de prestataire, aucune commission, aucun tarif préférentiel, dans la page, les données et les sources", () => {
  const motifs = privees.motifs();
  // Les noms viennent de la liste privée (jamais écrits ici : le dépôt est public) ; ces motifs couvrent le reste.
  const generiques = /commission|net partenaire|tarif préférentiel|préférentiel/i;
  const fichiers = [PAGE_AO, PAGE_LA, "src/carnet/ao-nang-excursions-bateau.11tydata.js", "src/carnet/ao-nang-excursions-bateau.njk", "src/carnet/koh-lanta-excursions-activites.11tydata.js", "src/carnet/koh-lanta-excursions-activites.njk", "src/carnet/guide-commun.js", "src/js/carnet-booking.js"];
  for (const f of fichiers) {
    const t = read(f);
    assert.doesNotMatch(t, generiques, f);
    for (const re of motifs || []) assert.ok(!re.test(t), `${f} : nom de la liste privée`);
  }
  if (!motifs) console.log(privees.message);
});

test("pages : Ao Nang ne dit pas « Secret » ; Koh Lanta ne cite que l'adresse du site, en lien sûr, une fois, en anglais", () => {
  const ao = texteVisible(read(PAGE_AO));
  assert.doesNotMatch(ao, /secret/i);
  const html = read(PAGE_LA);
  const corps = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  const liens = [...corps.matchAll(/<a [^>]*href="(https?:[^"]+)"[^>]*>/g)].filter((m) => !/wa\.me/.test(m[1]));
  assert.equal(liens.length, 1, "un seul lien sortant");
  assert.equal(liens[0][1], "https://secrettravelandtour.com/");
  assert.match(liens[0][0], /target="_blank" rel="noopener noreferrer"/);
  const la = texteVisible(html).replace(/\s+/g, " ");
  assert.doesNotMatch(la, /secret travel/i);
  assert.equal((la.match(/secret/gi) || []).length, 1, "une seule mention : l'adresse du site");
  assert.match(la, /secrettravelandtour\.com : s’ouvre dans un nouvel onglet \(le site est en anglais\)\./);
  assert.doesNotMatch(la, /moins cher|meilleur prix|prix réduit|remise|préférentiel/i);
});

test("pages : la phrase de haute saison est près des prix, les droits du parc sont à part", () => {
  const phrase = "Réservez suffisamment à l’avance : en haute saison, les prix peuvent varier selon les demandes.";
  for (const f of [PAGE_AO, PAGE_LA]) {
    const t = texteVisible(read(f)).replace(/\s+/g, " ");
    assert.ok(t.includes(phrase), f);
  }
  const ao = texteVisible(read(PAGE_AO)).replace(/\s+/g, " ");
  assert.match(ao, /transfert aller-retour est compris pour les hôtels du centre d’Ao Nang/i);
  assert.match(ao, /plusieurs bateaux/i);
  assert.match(ao, /Le droit d’entrée du parc national est fixé par le parc : il se règle sur place en espèces et n’est jamais dans le prix\./);
});

test("pages : JSON de configuration échappé, aucune requête externe, une seule adresse de fonction", () => {
  for (const f of [PAGE_AO, PAGE_LA]) {
    const doc = read(f);
    const m = doc.match(/<script type="application\/json" id="cg-data">([\s\S]*?)<\/script>/);
    assert.ok(m, f);
    assert.ok(!m[1].includes("<"), "pas de < dans le JSON");
    JSON.parse(m[1]);
    assert.doesNotMatch(doc, /<script[^>]+src="https?:\/\//, f);
    assert.doesNotMatch(doc, /<link[^>]+href="https?:\/\/(?!zwaldtravelplanner\.com)/, f);
  }
});

// ---------- Contrat avec Gestion : docs/gestion/carnet-aonang-lanta.md ----------
// Lu dans le dépôt une fois la branche de Gestion fusionnée, ou à l'adresse donnée par GESTION_CONTRAT_CARNET (le fichier de l'autre branche) ; sauté sinon.
const contratChemin = () => [process.env.GESTION_CONTRAT_CARNET, path.join(root, "docs", "gestion", "carnet-aonang-lanta.md")].filter(Boolean).find((f) => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } });

function lireContrat(texte) {
  const ao = {}; // produit -> options
  const lanta = {}; // produit -> options
  const horsMapping = [];
  let partie = "";
  for (const ligne of texte.split("\n")) {
    if (/^## Ao Nang/.test(ligne)) partie = "ao";
    else if (/^## Koh Lanta/.test(ligne)) partie = "lanta";
    else if (/^## /.test(ligne)) partie = "";
    if (partie === "lanta" && /^Pas dans le mapping/.test(ligne)) horsMapping.push(...[...ligne.split(":")[1].split(".")[0].matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]));
    if (!/^\| `/.test(ligne)) continue;
    const cols = ligne.split("|").map((c) => c.trim());
    const produit = (cols[1].match(/`([^`]+)`/) || [])[1];
    if (produit === "product_id") continue; // ligne d'en-tête
    if (partie === "ao") {
      const option = (cols[3].match(/`([^`]+)`/) || [])[1];
      if (!/^aonang-option-/.test(produit)) (ao[produit] = ao[produit] || []).push(option);
    } else if (partie === "lanta") {
      lanta[produit] = [...cols[2].matchAll(/`([^`]*)`/g)].map((m) => m[1]);
    }
  }
  return { ao, lanta, horsMapping };
}

test("contrat Gestion : produits et options de la page d'Ao Nang et de Koh Lanta identiques à ceux de docs/gestion/carnet-aonang-lanta.md", (t) => {
  const f = contratChemin();
  if (!f) { t.skip("docs/gestion/carnet-aonang-lanta.md absent (branche de Gestion non fusionnée, GESTION_CONTRAT_CARNET non défini)"); return; }
  const c = lireContrat(fs.readFileSync(f, "utf8"));
  assert.ok(Object.keys(c.ao).length >= 15 && Object.keys(c.lanta).length >= 15, "tableaux lus");
  // Ao Nang : un produit par niveau et par destination, option « standard »
  const monAo = {};
  for (const o of Object.values(cfgAo.offres)) for (const v of o.variantes) { const g = B.gestionIds(o, { variante: v.id }); (monAo[g.produit] = monAo[g.produit] || []).push(g.option); }
  assert.deepEqual(monAo, c.ao, "Ao Nang : mêmes produits et mêmes options des deux côtés");
  // Koh Lanta : mêmes produits et mêmes options, hors ce que le contrat dit absent du mapping
  const monLa = {};
  for (const o of Object.values(cfgLa.offres)) { const g = B.gestionIds(o, { variante: "", creneau: "" }); (monLa[g.produit] = monLa[g.produit] || new Set()).add(g.option); }
  const sien = Object.fromEntries(Object.entries(monLa).map(([k, v]) => [k, [...v].filter(Boolean).sort()])); // speedboat-ferry : produit sans option
  const leur = Object.fromEntries(Object.entries(c.lanta).filter(([k]) => !c.horsMapping.includes(k)).map(([k, v]) => [k, [...v].sort()]));
  assert.deepEqual(sien, leur, "Koh Lanta : mêmes produits et mêmes options des deux côtés");
  // Le transfert depuis l'hôtel n'est jamais un extra : le contrat le dit, la page l'écrit en ligne à part.
  assert.match(fs.readFileSync(f, "utf8"), /ligne `Hotel transfer:`/);
  const samui = require("../src/carnet/koh-samui-excursions-bateau.11tydata.js").eleventyComputed.carnetConfig(business).offres["pig-island-longtail-prive-4h"];
  const brut = { ...BASE, creneau: "matin", transfert: true, ages: [] };
  assert.ok(B.buildGestionMessage(samui, brut, B.estimate(samui, brut), "SAM-ABCD").split("\n").some((l) => /^Hotel transfer: /.test(l)));
  for (const k of c.horsMapping) assert.ok(!(k in sien), `${k} : absent du mapping de Gestion, la page ne doit pas l'envoyer`);
});
