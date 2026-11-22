// Réservation directe depuis les pages privées du carnet de ZTP (22.11.2026) : la fonction publique accepte l'origine de ZTP (marque « secret » seulement),
// Gestion reconnaît la demande, retrouve le bon tarif de la sortie (palier de groupe compris) et rattache le client à sa fiche ZTP par son numéro.
// Le catalogue de la sortie (donnees-secret-samui.sql) et carnet-produits.mjs s'écrivent avec les mêmes identifiants : ce test les compare.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { origineAdmise, originesAdmises, origineCarnet, estPageCarnet, CHEMIN_CARNET as CHEMIN_FONCTION, lireOrigines, ORIGINES_DEFAUT, ORIGINES_CARNET, ORGANISATION_ZWALD, lireDemande, notification, TAILLE_MAX } from "../supabase/functions/demande-site/calc.js";
import { PRODUITS_CARNET, CHEMIN_CARNET } from "../src/gestion/js/carnet-produits.mjs";
import { PRODUITS_SITE } from "../src/gestion/js/site-produits.mjs";
import { lireMessage, ajusterAgesCarnet, offresDuService, clientsProches, indexClientsParTelephone, clientParTelephone, optionDuSite } from "../src/gestion/js/demande-calc.mjs";
import { estCarnet, titreCarnet, champsCarnet, autresSorties, produitSite, texteDemande, nomProduit, titreOption, optionsProduit, demandeTarifee, changements, reponseConfirmation } from "../src/gestion/js/demandes-site-calc.mjs";
import { typeVoucherDeduit, commissionPrevue, fraisDeParc } from "../src/gestion/js/operations-calc.mjs";

const AJD = "2026-11-22";
const md5uuid = (s) => { const h = createHash("md5").update(s).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

// Prix de vente des sorties (ceux des flyers du partenaire : publics), unité et prix enfant. Le catalogue réel est dans un SQL privé, hors dépôt
// (dépôt public : il nomme les partenaires et leurs commissions) ; ces tests s'en passent avec des partenaires fictifs, et le contrôle du SQL privé,
// plus bas, saute quand le fichier est absent. Clé : « sortie|option|ligne » (carnet-produits.mjs). Valeur : [prix, unité, prix enfant].
const PRIX = {
  "ang-thong-big-boat|with-kayak|Adult": [1850, "pp", 1000], "ang-thong-big-boat|without-kayak|Adult": [1300, "pp", 700], "ang-thong-speedboat-groupe|standard|Adult": [2200, "pp", 1700],
  "ang-thong-petit-groupe-speedboat|standard|Adult": [4400, "pp", 2700], "pig-island-groupe|standard|Adult": [1500, "pp", 1000],
  "ang-thong-speedboat-prive|standard|1 to 9 people": [20000, "boat"], "pig-island-speedboat-prive-4h|standard|1 to 9 people": [11500, "boat"], "pig-island-speedboat-prive-5h|standard|1 to 9 people": [13500, "boat"],
  "pig-island-longtail-prive-4h|standard|1 to 3 people": [3500, "boat"], "pig-island-longtail-prive-4h|standard|4 to 5 people": [4500, "boat"], "pig-island-longtail-prive-4h|standard|6 to 7 people": [5500, "boat"],
  "pig-island-longtail-prive-4h|standard|8 to 10 people": [6500, "boat"], "pig-island-longtail-prive-4h|standard|11 to 13 people": [7500, "boat"],
  "pig-island-longtail-prive-5h|standard|1 to 3 people": [5000, "boat"], "pig-island-longtail-prive-5h|standard|4 to 5 people": [5500, "boat"], "pig-island-longtail-prive-5h|standard|6 to 8 people": [6500, "boat"],
  "pig-island-longtail-prive-5h|standard|9 to 10 people": [7500, "boat"], "pig-island-longtail-prive-5h|standard|11 to 12 people": [8500, "boat"],
};
const PRIX_OPTION = ["option|transfert-hotel|van", [1500, "veh"]];
const TARIFS_CARNET_CLES = PRODUITS_CARNET.flatMap((p) => p.options.flatMap((o) => o.tarifs.map((t) => t.cle)));
// Catalogue fictif : partenaires A et B, mêmes tarifs et mêmes identifiants que le SQL privé.
const prestations = [...Object.entries(PRIX), PRIX_OPTION].map(([cle, [prix, unite, enfant]]) => ({ id: md5uuid(`carnet:${cle}`), partenaire_id: cle.startsWith("ang-thong-petit") ? "p-b" : "p-a", famille: "excursion", groupe: cle.startsWith("option") ? "Option, Koh Samui" : "Koh Samui", libelle: cle, libelle_en: cle, prix_vente: prix, unite, details: enfant !== undefined ? { enfant } : {}, sur_place: false, actif: true }));
const partenaires = [{ id: "p-a", actif: true }, { id: "p-b", actif: true }];
const contexte = { prestations, trajets: [], partenaires, nomPartenaire: () => "" };

const erreurDe = (f) => { try { f(); return null; } catch (e) { return { code: e.code, champ: e.champ }; } };
const corps = (o) => JSON.stringify({ brand: "secret", product_id: "pig-island-longtail-prive-4h", product: "Pig Island and Koh Tan by private longtail, 4 hours", option: "standard", option_label: "Whole boat", date: "2026-12-20", adults: 2, children: 2, pickup: "Hotel Example, Chaweng", name: "Anna Keller", whatsapp: "+41 79 123 45 67", estimated_total: 4500, currency: "THB",
  page_url: "https://zwaldtravelplanner.com/carnet/koh-samui-excursions-bateau-xc8do3/", message: "Booking request: Pig Island and Koh Tan by private longtail, 4 hours – Whole boat\nDate: Sun 20 Dec 2026\nGuests: 2 adults, 2 children (ages 5 and 9)\nPickup: Hotel Example, Chaweng\nName: Anna Keller\nEstimated total: 4,500 THB", ...o });

// ---- La fonction publique -----------------------------------------------------------------------------------------------------------
const ORIGINES = originesAdmises(ORIGINES_DEFAUT);
const lire = (o, origine = "https://zwaldtravelplanner.com") => lireDemande(corps(o), { aujourdhui: AJD, origines: ORIGINES_DEFAUT, origine });

test("demande-site : les pages du carnet de ZTP sont une origine admise, les autres sites non", () => {
  for (const o of ["https://zwaldtravelplanner.com", "https://www.zwaldtravelplanner.com", "https://secrettravelandtour.com", "http://localhost:8080"]) assert.ok(origineAdmise(o, ORIGINES), o);
  for (const o of [null, "", "http://zwaldtravelplanner.com", "https://zwaldtravelplanner.com.evil.example", "https://evil.zwaldtravelplanner.com", "https://zwaldtravelplanner.com:8443", "https://evil.example"]) assert.equal(origineAdmise(o, ORIGINES), false, String(o));
  assert.deepEqual(ORIGINES_CARNET, ["https://zwaldtravelplanner.com", "https://www.zwaldtravelplanner.com"]);
  // Le site Secret d'avant n'a pas changé : lireOrigines et ORIGINES_DEFAUT ne portent pas ZTP.
  assert.deepEqual(lireOrigines(""), ORIGINES_DEFAUT);
  assert.ok(!ORIGINES_DEFAUT.some(origineCarnet));
});

test("demande-site : les origines de ZTP ne comptent que pour l'organisation Zwald, jamais pour le site d'un autre client", () => {
  const autre = ["https://ride.example"];
  assert.deepEqual(originesAdmises(autre, "11111111-1111-1111-1111-111111111111"), autre);
  assert.equal(origineAdmise("https://zwaldtravelplanner.com", originesAdmises(autre, "11111111-1111-1111-1111-111111111111")), false);
  assert.ok(origineAdmise("https://zwaldtravelplanner.com", originesAdmises(autre, ORGANISATION_ZWALD)));
  assert.ok(origineAdmise("https://ride.example", originesAdmises(autre, ORGANISATION_ZWALD)), "le réglage SITE_ORIGINES reste admis");
});

test("demande-site : depuis une page du carnet, seule la marque « secret » est admise", () => {
  const l = lire({});
  assert.equal(l.marque, "secret");
  assert.equal(l.produit_id, "pig-island-longtail-prive-4h");
  assert.equal(l.option_id, "standard");
  assert.equal(l.adultes, 2);
  assert.equal(l.enfants, 2);
  assert.equal(l.pickup, "Hotel Example, Chaweng");
  assert.equal(l.telephone, "+41791234567");
  assert.equal(l.total_estime, 4500);
  assert.equal(l.page_url, "https://zwaldtravelplanner.com/carnet/koh-samui-excursions-bateau-xc8do3/");
  assert.match(l.message, /ages 5 and 9/);
  for (const origine of ["https://zwaldtravelplanner.com", "https://www.zwaldtravelplanner.com"]) {
    assert.deepEqual(erreurDe(() => lire({ brand: "taxi" }, origine)), { code: "marque", champ: "brand" }, `taxi depuis ${origine}`);
    assert.deepEqual(erreurDe(() => lire({ brand: "ride-co" }, origine)), { code: "marque", champ: "brand" }, `autre marque depuis ${origine}`);
  }
  // Le site Secret et la machine de développement gardent leurs marques (taxi compris).
  assert.equal(lire({ brand: "taxi" }, "https://secrettravelandtour.com").marque, "taxi");
  assert.equal(lire({ brand: "taxi" }, "http://localhost:8080").marque, "taxi");
  assert.equal(lire({ brand: "taxi" }, null).marque, "taxi");
});

test("demande-site : depuis une page du carnet, corps trop gros, champ piège et formats sont contrôlés comme ailleurs", () => {
  assert.equal(erreurDe(() => lireDemande("x".repeat(TAILLE_MAX + 1), { aujourdhui: AJD, origines: ORIGINES_DEFAUT, origine: "https://zwaldtravelplanner.com" })).code, "trop_gros");
  assert.equal(erreurDe(() => lire({ message: "x".repeat(TAILLE_MAX) })).code, "trop_gros");
  assert.deepEqual(lire({ website: "http://spam.example" }), { piege: true });
  // Le piège passe avant la marque : un robot ne se voit pas répondre autre chose qu'un « ok ».
  assert.deepEqual(lire({ website: "x", brand: "taxi" }), { piege: true });
  assert.deepEqual(erreurDe(() => lire({ date: "2026-02-30" })), { code: "date", champ: "date" });
  assert.deepEqual(erreurDe(() => lire({ product_id: "../etc" })), { code: "produit", champ: "product_id" });
  // Depuis le site Secret, une page hors du site n'est pas gardée (la demande passe).
  assert.equal(lire({ page_url: "https://evil.example/tours/x/" }, "https://secrettravelandtour.com").page_url, null);
});

test("demande-site : depuis les origines de ZTP, seule une page /carnet/ de la requête et la marque secret sont admises", () => {
  const carnet = "https://zwaldtravelplanner.com/carnet/koh-samui-excursions-bateau-xc8do3/";
  assert.equal(lire({ page_url: `${carnet}?x=1#haut` }).page_url, `${carnet}?x=1#haut`);
  assert.equal(lire({ page_url: "https://www.zwaldtravelplanner.com/carnet/essai-abc123/" }, "https://www.zwaldtravelplanner.com").marque, "secret");
  // Page hors /carnet/ (une page publique de ZTP, le chemin sans barre finale, un chemin qui ressemble), page absente, page d'une autre origine : refus sur page_url.
  for (const page_url of ["https://zwaldtravelplanner.com/secret/", "https://zwaldtravelplanner.com/", "https://zwaldtravelplanner.com/carnet", "https://zwaldtravelplanner.com/carnets/x/", "https://zwaldtravelplanner.com/en/carnet/x/",
    "https://www.zwaldtravelplanner.com/carnet/essai-abc123/", "https://secrettravelandtour.com/carnet/x/", "http://localhost:8080/carnet/x/", "https://evil.example/carnet/x/", "javascript:alert(1)", "/carnet/x/", "", null]) {
    assert.deepEqual(erreurDe(() => lire({ page_url })), { code: "page", champ: "page_url" }, String(page_url));
  }
  assert.deepEqual(erreurDe(() => lireDemande(JSON.stringify({ brand: "secret", product_id: "x" }), { aujourdhui: AJD, origines: ORIGINES_DEFAUT, origine: "https://zwaldtravelplanner.com" })), { code: "page", champ: "page_url" }, "page_url absente");
  // Autre marque, même avec une bonne page : refus sur brand.
  assert.deepEqual(erreurDe(() => lire({ brand: "taxi", page_url: carnet })), { code: "marque", champ: "brand" });
  // Le champ piège passe avant tout : un robot reçoit « ok » sans rien écrire.
  assert.deepEqual(lire({ website: "x", page_url: null, brand: "taxi" }), { piege: true });
  assert.ok(estPageCarnet(carnet) && !estPageCarnet("https://zwaldtravelplanner.com/secret/") && !estPageCarnet(null) && !estPageCarnet("pas une adresse"));
  // Le site Secret et la machine de développement n'ont pas cette exigence.
  assert.equal(lire({ page_url: null }, "https://secrettravelandtour.com").page_url, null);
  assert.equal(lire({ page_url: "http://localhost:8080/carnet/x/" }, "http://localhost:8080").page_url, "http://localhost:8080/carnet/x/");
});

test("demande-site : la page d'une requête est comparée à l'origine de la requête, dans les deux sens", () => {
  const carnet = "https://zwaldtravelplanner.com/carnet/essai-abc123/";
  const secret = "https://secrettravelandtour.com/tours/4-islands/";
  // Une requête du site Secret qui annonce une page du carnet : la demande passe, mais la page n'est pas gardée, donc rien ne la dit « Carnet ZTP ».
  const l = lire({ page_url: carnet }, "https://secrettravelandtour.com");
  assert.equal(l.page_url, null);
  assert.doesNotMatch(notification(l, AJD, "Secret").corps, /Carnet/);
  assert.equal(estCarnet(l), false);
  assert.equal(lire({ page_url: secret }, "https://secrettravelandtour.com").page_url, secret, "sa propre page est gardée");
  assert.equal(lire({ page_url: "https://www.secrettravelandtour.com/tours/x/" }, "https://secrettravelandtour.com").page_url, "https://www.secrettravelandtour.com/tours/x/", "www et sans www restent un même site");
  // Une requête du carnet qui annonce une page du site Secret : refusée.
  assert.deepEqual(erreurDe(() => lire({ page_url: secret })), { code: "page", champ: "page_url" });
  // Même ajustement d'âge : sans page du carnet gardée, la demande n'est pas une demande du carnet.
  assert.equal(demandeTarifee({ ...D, page_url: l.page_url, message: "Booking request: x\nGuests: 1 adult, 1 child (age 12)", produit_id: "ang-thong-big-boat" }).plusGrands, undefined);
});

test("constantes uniques : organisation Zwald et chemin du carnet", () => {
  assert.equal(CHEMIN_CARNET, CHEMIN_FONCTION);
  assert.equal(ORGANISATION_ZWALD, "00000000-0000-0000-0000-00000000a000");
  const index = fs.readFileSync(new URL("../supabase/functions/demande-site/index.ts", import.meta.url), "utf8");
  assert.ok(!index.includes(ORGANISATION_ZWALD), "index.ts prend l'organisation de calc.js");
  assert.match(index, /ORGANISATION_ZWALD/);
  const calc = fs.readFileSync(new URL("../supabase/functions/demande-site/calc.js", import.meta.url), "utf8");
  assert.doesNotMatch(calc.replace(/^\s*\/\/.*$/gm, "").replace(/\/\/ .*$/gm, ""), /\/carnet\/(?!")/, "le chemin n'est écrit qu'une fois dans le code de calc.js");
  const client = fs.readFileSync(new URL("../src/gestion/js/demandes-site-calc.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(client.replace(/\/\/ .*$/gm, ""), /\/carnet\//, "l'outil prend CHEMIN_CARNET de carnet-produits.mjs");
});

test("demande-site : la notification dit Carnet ZTP pour une demande du carnet, sans nom ni hôtel", () => {
  const n = notification(lire({}), AJD, "Secret Travel & Tour");
  assert.equal(n.titre, "Nouvelle demande Secret Travel & Tour");
  assert.match(n.corps, /^Carnet ZTP, Pig Island and Koh Tan by private longtail, 4 hours \(Whole boat\), 2 adultes, 2 enfants, dimanche 20$/);
  assert.ok(!/Anna|Keller|Chaweng|\+41/.test(JSON.stringify(n)));
  assert.doesNotMatch(notification({ ...lire({}), page_url: "https://secrettravelandtour.com/tours/4-islands/" }, AJD, "Secret").corps, /Carnet/);
});

// ---- Le catalogue et ses identifiants -------------------------------------------------------------------------------------------------
const TARIFS_CARNET = PRODUITS_CARNET.flatMap((p) => p.options.flatMap((o) => o.tarifs.map((t) => ({ ...t, produit: p.id }))));

test("carnet-produits : un tarif par ligne, identifiants calculés de la clé, aucun doublon", () => {
  assert.equal(PRODUITS_CARNET.length, 9);
  assert.deepEqual([...TARIFS_CARNET_CLES].sort(), Object.keys(PRIX).sort());
  for (const t of TARIFS_CARNET) assert.equal(t.prestation, md5uuid(`carnet:${t.cle}`), t.cle);
  assert.equal(new Set(TARIFS_CARNET.map((t) => t.prestation)).size, TARIFS_CARNET.length);
  // Les identifiants des sorties ne rencontrent aucune page du site Secret.
  for (const p of PRODUITS_CARNET) assert.ok(!PRODUITS_SITE.some((s) => s.id === p.id), p.id);
  assert.deepEqual(PRODUITS_CARNET.filter((p) => p.enfant).map((p) => [p.id, p.enfant.min, p.enfant.max]), [["ang-thong-big-boat", 4, 11], ["ang-thong-speedboat-groupe", 4, 10], ["ang-thong-petit-groupe-speedboat", 3, 9], ["pig-island-groupe", 4, 10]]);
});

test("carnet-produits : le fichier servi avec l'outil (dépôt public) ne dit ni commission, ni net, ni prix", () => {
  const code = fs.readFileSync(new URL("../src/gestion/js/carnet-produits.mjs", import.meta.url), "utf8").split("\n").filter((l) => !l.startsWith("//")).join("\n");
  assert.doesNotMatch(code, /commission|prix_vente|"prix"|"net"|partenaire"|\d\s?%/i);
});

test("catalogue Koh Samui : commission en pourcentage du prix de vente, droits d'entrée hors prix", () => {
  // La commission se calcule sur le prix de vente de la sortie, jamais sur les droits d'entrée du parc (payés sur place, en plus).
  assert.equal(commissionPrevue({ type: "pourcent_vente", valeur: 12 }, { vente: 4500 }), 540);
  assert.equal(commissionPrevue({ type: "pourcent_vente", valeur: 8 }, { vente: 11500 }), 920);
  // Le texte des frais de parc d'Ang Thong, tel que le client le lit sur son voucher.
  const parc = "Foreign adult: 300 ฿ | Foreign child: 150 ฿ (Thai: 40 ฿ / 20 ฿) | child means 3 to 14 years and under 1.40 m, under 3 free | To be paid in cash on site";
  const f = fraisDeParc({ details: { parc } });
  assert.equal(f.inclus, false);
  assert.match(f.texte, /^Adult 300 THB, child 150 THB .*3 to 14 years and under 1\.40 m, under 3 free.*cash on the day$/);
});

test("catalogue Koh Samui : une sortie excursion donne un voucher de bateau, l'option de transfert n'en a pas", () => {
  const p = (cle) => prestations.find((x) => x.id === md5uuid(`carnet:${cle}`));
  assert.equal(typeVoucherDeduit({ libelle: "x" }, p("ang-thong-big-boat|with-kayak|Adult"), null), "bateau");
  assert.equal(typeVoucherDeduit({ libelle: "x" }, p("pig-island-longtail-prive-4h|standard|4 to 5 people"), null), "bateau");
  assert.equal(typeVoucherDeduit({ libelle: "x" }, { ...p("option|transfert-hotel|van"), libelle: "Option : transfert d'hôtel, par van" }, null), null);
});

// ---- Le SQL privé (hors dépôt) --------------------------------------------------------------------------------------------------------
// donnees-secret-samui.sql et son retour nomment les partenaires et leurs commissions : ils vivent hors du dépôt public (dossier privé de Jérémy,
// ~/Desktop/Site_Anais-import/, ou GESTION_SQL_PRIVE). Ce contrôle les lit de là et saute proprement quand ils sont absents.
const DOSSIER_PRIVE = process.env.GESTION_SQL_PRIVE || path.join(os.homedir(), "Desktop", "Site_Anais-import");
const fichierPrive = (nom) => { try { return fs.readFileSync(path.join(DOSSIER_PRIVE, nom), "utf8"); } catch { return null; } };
const SQL = fichierPrive("donnees-secret-samui.sql");
const RETOUR = fichierPrive("retour-secret-samui.sql");
const sansApostrophes = (x) => x.replace(/''/g, "'");

test("SQL privé du catalogue Koh Samui : mêmes identifiants et mêmes prix que le code, uniquement dans Secret, aucun net", { skip: !SQL || !RETOUR ? "SQL privé absent (GESTION_SQL_PRIVE)" : false }, () => {
  const lignes = [...SQL.matchAll(/^\s+\('((?:[^']|'')*)', md5\('carnet-partenaire:([^']+)'\)::uuid, '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', (\d+), '(\w+)', (\d+), \$j\$(.*)\$j\$::jsonb\),?$/gm)].map((m) => ({ cle: sansApostrophes(m[1]), groupe: sansApostrophes(m[3]), libelle: sansApostrophes(m[4]), libelle_en: sansApostrophes(m[5]), prix: Number(m[6]), unite: m[7], details: JSON.parse(m[9]) }));
  assert.equal(lignes.length, Object.keys(PRIX).length + 1, "les tarifs des sorties plus l'option de transfert d'hôtel");
  for (const [cle, [prix, unite, enfant]] of [...Object.entries(PRIX), PRIX_OPTION]) {
    const l = lignes.find((x) => x.cle === cle);
    assert.ok(l, `${cle} absent du SQL`);
    assert.equal(l.prix, prix, cle);
    assert.equal(l.unite, unite, cle);
    assert.equal(l.details.enfant, enfant, `${cle} : prix enfant`);
  }
  // Petit groupe d'Ang Thong : prix du site du partenaire, entrée du parc en plus (décisions de Jérémy du 22.11.2026), rien « à confirmer ».
  const petit = lignes.find((x) => x.cle === "ang-thong-petit-groupe-speedboat|standard|Adult");
  assert.deepEqual([petit.prix, petit.details.enfant], [4400, 2700]);
  assert.equal(petit.details.a_confirmer, undefined);
  // Toutes les sorties d'Ang Thong disent les droits d'entrée du parc : à payer sur place, en plus, adulte 300, enfant 150.
  for (const l of lignes.filter((x) => x.cle.startsWith("ang-thong"))) {
    assert.match(l.details.parc, /Foreign adult: 300 ฿/, l.cle);
    assert.match(l.details.parc, /Foreign child: 150 ฿/, l.cle);
    assert.match(l.details.parc, /3 to 14 years and under 1\.40 m, under 3 free/, l.cle);
    assert.match(l.details.parc, /cash on site/, l.cle);
  }
  // Un prix de vente ne contient jamais les droits d'entrée : 4 400 et non 4 700 pour le petit groupe, 1 850 et non 2 150 pour le big boat.
  assert.equal(lignes.find((x) => x.cle === "ang-thong-big-boat|with-kayak|Adult").prix, 1850);
  // Les noms des partenaires, lus dans le SQL, ne sortent dans aucun libellé ni aucun détail d'un tarif.
  const noms = [...SQL.matchAll(/\(md5\('carnet-partenaire:[^']+'\)::uuid, '((?:[^']|'')*)'/g)].map((m) => sansApostrophes(m[1]));
  assert.ok(noms.length >= 2);
  for (const l of lignes) for (const n of noms) assert.ok(!`${l.libelle_en} ${l.libelle} ${l.groupe} ${JSON.stringify(l.details)}`.toLowerCase().includes(n.toLowerCase()), `${l.cle} : ${n}`);
  for (const code of PRODUITS_CARNET) for (const n of noms) assert.ok(!JSON.stringify(code).toLowerCase().includes(n.toLowerCase()), `carnet-produits : ${n}`);
  // Chaque partenaire a une règle de commission en pourcentage du prix de vente et le règlement sur place.
  assert.equal((SQL.match(/"type":"pourcent_vente"/g) || []).length, noms.length);
  assert.equal((SQL.match(/"mode_reglement":"sur_place"/g) || []).length, noms.length);
  assert.doesNotMatch(SQL.replace(/^--.*$/gm, ""), /insert into (prestations_nets|reservations|dossiers|clients)/i);
  // Une seule entreprise est nommée, Secret : rien dans ZTP ni dans Taxi.
  assert.deepEqual([...new Set(SQL.match(/00000000-0000-4000-8000-00000000000\d/g))], ["00000000-0000-4000-8000-000000000002"]);
  assert.ok(RETOUR.includes("00000000-0000-4000-8000-000000000002"));
  assert.doesNotMatch(RETOUR, /00000000-0000-4000-8000-00000000000[13]/);
});

// ---- Le bon tarif d'une demande du carnet ---------------------------------------------------------------------------------------------
function demandeCarnet({ produit, option = "standard", titre = "", adultes = 2, ages = [], date = "2026-12-20", nom = "Anna Keller" }) {
  const sortie = PRODUITS_CARNET.find((p) => p.id === produit);
  const opt = sortie.options.find((o) => o.id === option);
  const invites = [`${adultes} adults`, ages.length ? `${ages.length} children (ages ${ages.join(", ")})` : ""].filter(Boolean).join(", ");
  const texte = `Booking request: ${sortie.nom} – ${titre || opt.titre}\nDate: Sun 20 Dec 2026\nGuests: ${invites}\nPickup: Hotel Example, Chaweng\nName: ${nom}`;
  // Comme la fenêtre de création : la demande lue, puis les enfants plus âgés que le barème de la sortie comptés adultes.
  const d = ajusterAgesCarnet({ ...lireMessage(texte, AJD), carnet: { produit, option } });
  return { d, texte };
}
const offres = (cfg) => { const { d, texte } = demandeCarnet(cfg); return offresDuService(d, texte, { phrase: texte, date: d.date, adultes: d.adultes, enfants: d.enfants }, contexte); };
const premiere = (cfg) => offres(cfg)[0];

test("tarif du carnet : l'option cochée donne le tarif, adultes et enfants au prix du partenaire", () => {
  let o = premiere({ produit: "ang-thong-big-boat", option: "with-kayak", adultes: 2, ages: [5, 9] });
  assert.equal(o.id, md5uuid("carnet:ang-thong-big-boat|with-kayak|Adult"));
  assert.equal(o.total, 2 * 1850 + 2 * 1000);
  o = premiere({ produit: "ang-thong-big-boat", option: "without-kayak", adultes: 2, ages: [5, 9] });
  assert.equal(o.total, 2 * 1300 + 2 * 700);
  o = premiere({ produit: "ang-thong-speedboat-groupe", adultes: 2, ages: [6] });
  assert.equal(o.total, 2 * 2200 + 1700);
  o = premiere({ produit: "ang-thong-petit-groupe-speedboat", adultes: 2, ages: [4] });
  assert.equal(o.total, 2 * 4400 + 2700, "prix enfant du petit groupe : 2 700 (prix du site du partenaire)");
  o = premiere({ produit: "pig-island-groupe", adultes: 1, ages: [8] });
  assert.equal(o.total, 1500 + 1000);
  assert.equal(o.avertissement, "");
});

test("tarif du carnet : un bateau privé prend le palier qui contient le groupe", () => {
  const total = (produit, adultes, ages = []) => premiere({ produit, adultes, ages }).total;
  assert.equal(total("pig-island-longtail-prive-4h", 2), 3500);
  assert.equal(total("pig-island-longtail-prive-4h", 2, [5, 9]), 4500, "4 personnes : palier 4 à 5");
  assert.equal(total("pig-island-longtail-prive-4h", 3, [5, 9]), 4500);
  assert.equal(total("pig-island-longtail-prive-4h", 4, [5, 9]), 5500);
  assert.equal(total("pig-island-longtail-prive-4h", 11), 7500);
  assert.equal(total("pig-island-longtail-prive-5h", 8), 6500);
  assert.equal(total("pig-island-longtail-prive-5h", 12), 8500);
  assert.equal(total("ang-thong-speedboat-prive", 9), 20000);
  assert.equal(total("pig-island-speedboat-prive-4h", 3), 11500);
  assert.equal(total("pig-island-speedboat-prive-5h", 3), 13500);
  // Plus de monde que le plus grand palier : la dernière tranche passe devant et l'offre le dit.
  const trop = premiere({ produit: "pig-island-longtail-prive-5h", adultes: 14 });
  assert.equal(trop.total, 8500);
  assert.equal(trop.avertissement, "groupe_hors_tranche");
  // Un enfant de moins de 4 ans ne compte pas dans le groupe (règle du site, gardée).
  assert.equal(total("pig-island-longtail-prive-4h", 3, [2, 9]), 4500, "3 adultes et un enfant de 9 ans font 4 personnes, le bébé de 2 ans ne compte pas");
});

test("tarif du carnet : un enfant plus âgé que le barème de la sortie paie le tarif adulte du partenaire, son âge sous le barème est signalé", () => {
  const prix = (cfg) => premiere(cfg).total;
  // Big boat avec kayak : enfant de 4 à 11 ans. À 12 ans, tarif adulte (1 850), pas 1 000.
  assert.equal(prix({ produit: "ang-thong-big-boat", option: "with-kayak", adultes: 2, ages: [12] }), 3 * 1850);
  assert.equal(prix({ produit: "ang-thong-big-boat", option: "with-kayak", adultes: 2, ages: [11, 14] }), 3 * 1850 + 1000, "14 ans : adulte, 11 ans : enfant");
  // Petit groupe : enfant de 3 à 9 ans, adulte dès 10 ans (4 400), gratuit sous 3 ans.
  assert.equal(prix({ produit: "ang-thong-petit-groupe-speedboat", adultes: 2, ages: [10, 14] }), 4 * 4400, "de 10 à 14 ans : tarif adulte");
  assert.equal(prix({ produit: "ang-thong-petit-groupe-speedboat", adultes: 2, ages: [9, 2] }), 2 * 4400 + 2700, "9 ans : enfant, 2 ans : gratuit");
  // Speedboat en groupe : enfant de 4 à 10 ans, adulte à 11 ans.
  assert.equal(prix({ produit: "ang-thong-speedboat-groupe", adultes: 1, ages: [10, 11] }), 2200 + 1700 + 2200);
  assert.equal(prix({ produit: "pig-island-groupe", adultes: 1, ages: [10, 11] }), 1500 + 1000 + 1500);
  // Ce que dit la fenêtre : combien d'enfants sont comptés adultes, jusqu'à quel âge.
  const { d } = demandeCarnet({ produit: "ang-thong-big-boat", option: "with-kayak", adultes: 1, ages: [12, 5] });
  assert.deepEqual([d.adultes, d.enfants, d.plusGrands, d.plusGrandsMax], [2, 1, 1, 11]);
  assert.deepEqual(d.ages, [12, 5], "les âges restent ceux du client (notes du dossier, voucher)");
  assert.equal(ajusterAgesCarnet(d), d, "se rejoue sans effet");
  // Un bateau privé n'a pas de barème d'âge : le groupe ne change pas.
  const prive = demandeCarnet({ produit: "pig-island-longtail-prive-4h", adultes: 2, ages: [12] }).d;
  assert.deepEqual([prive.adultes, prive.enfants], [2, 1]);
  // Signalement : seul un âge sous le barème (rien n'est publié) est à vérifier ; au-dessus, c'est réglé ; gratuit sous 3 ans pour le petit groupe.
  const avert = (cfg) => premiere(cfg).avertissement;
  assert.equal(avert({ produit: "ang-thong-big-boat", option: "with-kayak", ages: [4, 11] }), "");
  assert.equal(avert({ produit: "ang-thong-big-boat", option: "with-kayak", ages: [12] }), "");
  assert.equal(avert({ produit: "ang-thong-big-boat", option: "with-kayak", ages: [3] }), "age_enfant");
  // Les bébés de moins de 3 ans sont comptés à part par le message : jamais d'alerte « hors barème » pour eux, même sans « gratuit sous » (big boat : 4 à 11).
  assert.equal(avert({ produit: "ang-thong-big-boat", option: "with-kayak", ages: [1] }), "");
  assert.equal(avert({ produit: "ang-thong-big-boat", option: "with-kayak", ages: [0, 2] }), "");
  assert.equal(avert({ produit: "ang-thong-big-boat", option: "with-kayak", ages: [2, 3] }), "age_enfant", "un vrai enfant de 3 ans, lui, est hors barème");
  assert.equal(avert({ produit: "ang-thong-speedboat-groupe", ages: [2] }), "");
  assert.equal(avert({ produit: "pig-island-groupe", ages: [1, 5] }), "");
  assert.equal(premiere({ produit: "ang-thong-big-boat", option: "with-kayak", ages: [3] }).bareme.min, 4);
  assert.equal(avert({ produit: "ang-thong-petit-groupe-speedboat", ages: [3, 9, 10] }), "");
  assert.equal(avert({ produit: "ang-thong-petit-groupe-speedboat", ages: [1] }), "", "moins de 3 ans : gratuit");
  // Le prix ne change pas pour un bébé : il ne compte ni parmi les adultes ni parmi les enfants.
  assert.equal(prix({ produit: "ang-thong-big-boat", option: "with-kayak", adultes: 2, ages: [1] }), 2 * 1850);
  assert.equal(avert({ produit: "pig-island-longtail-prive-4h", ages: [1, 14] }), "", "un bateau privé n'a pas de barème d'âge");
});

test("tarif du carnet : l'option changée dans « Modifier » (titre du message) l'emporte sur l'option envoyée", () => {
  const { d, texte } = demandeCarnet({ produit: "ang-thong-big-boat", option: "with-kayak", titre: "Without kayak", adultes: 2 });
  const o = offresDuService(d, texte, { phrase: texte, date: d.date, adultes: 2, enfants: 0 }, contexte)[0];
  assert.equal(o.id, md5uuid("carnet:ang-thong-big-boat|without-kayak|Adult"));
});

test("tarif du carnet : un message collé sans identifiant retrouve la sortie par son nom, une sortie inconnue ne propose rien de Koh Lanta", () => {
  const sortie = PRODUITS_CARNET.find((p) => p.id === "pig-island-groupe");
  const texte = `Booking request: ${sortie.nom} – ${sortie.options[0].titre}\nDate: Sun 20 Dec 2026\nGuests: 2 adults\nName: Anna`;
  const d = lireMessage(texte, AJD);
  assert.equal(offresDuService(d, texte, { phrase: texte, date: d.date, adultes: 2, enfants: 0 }, contexte)[0].total, 3000);
  const inconnu = lireMessage("Booking request: Une autre sortie – Option\nGuests: 1 adult", AJD);
  inconnu.carnet = { produit: "n-existe-pas", option: "x" };
  assert.ok(!offresDuService(inconnu, "x", { phrase: "x", adultes: 1, enfants: 0 }, contexte).some((o) => o.ligneSite), "aucun tarif du carnet pour une sortie inconnue");
});

// ---- Ce que Gestion montre d'une demande du carnet -------------------------------------------------------------------------------------
const D = { id: "d1", marque: "secret", statut: "nouvelle", ref: null, produit_id: "pig-island-longtail-prive-4h", produit: "Pig Island and Koh Tan by private longtail, 4 hours", option_id: "standard", option_titre: "Whole boat", date_service: "2026-12-20", heure: null, adultes: 2, enfants: 2, pickup: "Hotel Example, Chaweng", nom: "Anna Keller", telephone: "+41791234567", total_estime: 4500, devise: "THB",
  page_url: "https://zwaldtravelplanner.com/carnet/koh-samui-excursions-bateau-xc8do3/", message: lire({}).message, created_at: "2026-11-22T03:00:00Z" };

test("demandes du site : une demande du carnet se reconnaît à sa page, jamais au mot Secret", () => {
  assert.ok(estCarnet(D));
  assert.ok(estCarnet({ page_url: "http://localhost:8080/carnet/essai-abc123/" }));
  assert.equal(estCarnet({ page_url: "https://secrettravelandtour.com/tours/4-islands/" }), false);
  assert.equal(estCarnet({ page_url: null }), false);
  assert.equal(estCarnet({ page_url: "https://zwaldtravelplanner.com/secret/" }), false);
  assert.equal(titreCarnet(D), "Koh Samui Excursions Bateau");
  assert.equal(titreCarnet({ page_url: "https://zwaldtravelplanner.com/carnet/chiang-mai-temples-a1b2c3/" }), "Chiang Mai Temples");
  assert.equal(titreCarnet({ page_url: "https://zwaldtravelplanner.com/carnet/" }), "");
});

test("demandes du site : la fiche d'une demande du carnet porte tous les champs reçus, âges des enfants compris", () => {
  assert.deepEqual(champsCarnet(D), { prestation: "Pig Island and Koh Tan by private longtail, 4 hours – Whole boat", date: "2026-12-20", heure: "", adultes: 2, enfants: 2, ages: [5, 9], hotel: "Hotel Example, Chaweng", nom: "Anna Keller", whatsapp: "+41791234567", total: 4500, devise: "THB" });
  assert.equal(champsCarnet({ ...D, message: "", telephone: null, total_estime: null }).whatsapp, "");
  assert.deepEqual(champsCarnet({ ...D, message: "" }).ages, []);
  assert.equal(nomProduit({ produit: "", produit_id: "pig-island-groupe" }), "Pig Island and Koh Tan by big boat");
  assert.equal(titreOption({ produit_id: "ang-thong-big-boat", option_id: "with-kayak" }), "With kayak");
  assert.deepEqual(optionsProduit("ang-thong-big-boat").map((o) => o.id), ["with-kayak", "without-kayak"]);
});

test("demandes du site : « autre sortie » d'une demande du carnet ne propose que les sorties du même guide", () => {
  const autres = autresSorties(D);
  assert.equal(autres.length, 8);
  assert.ok(autres.every((p) => p.guide === "koh-samui" && p.id !== D.produit_id));
  const site = autresSorties({ ...D, page_url: "https://secrettravelandtour.com/tours/4-islands/", produit_id: "4-islands" });
  assert.ok(site.length > 5 && site.every((p) => PRODUITS_SITE.includes(p)));
  assert.equal(produitSite("pig-island-groupe").guide, "koh-samui");
});

test("demandes du site : le message de la demande se relit tel quel, et la fiche ZTP est retrouvée par le numéro WhatsApp", () => {
  const lu = lireMessage(texteDemande(D), AJD);
  assert.equal(lu.date, "2026-12-20");
  assert.deepEqual([lu.adultes, lu.enfants], [2, 2]);
  assert.deepEqual(lu.ages, [5, 9]);
  assert.equal(lu.hotel, "Hotel Example, Chaweng");
  assert.equal(lu.nom, "Anna Keller");
  assert.equal(lu.prixSite, "4,500 THB");
  // La même personne a déjà une fiche ZTP (numéro écrit autrement) : elle est retenue par le numéro, pas par le nom.
  const clients = [{ id: "c-ztp", prenom: "Anna", nom: "Keller-Meier", telephone: "+41 79 123 45 67", entite_id: "ZTP" }, { id: "c-autre", prenom: "Anna", nom: "Keller", telephone: "+33 6 11 22 33 44" }];
  const trouves = clientsProches({ telephone: D.telephone, nom: "" }, clients);
  assert.deepEqual(trouves.map((x) => [x.client.id, x.raison]), [["c-ztp", "telephone"]]);
  assert.deepEqual(clientsProches({ telephone: D.telephone, nom: D.nom }, clients).map((x) => x.client.id), ["c-ztp", "c-autre"]);
});

// ---- Recherche par identifiant avant le nom ---------------------------------------------------------------------------------------
test("optionDuSite : une demande du carnet cherche par identifiant, jamais parmi les sorties du site Secret qui portent le même nom", () => {
  const sortie = PRODUITS_CARNET.find((p) => p.id === "pig-island-groupe");
  const faux = { id: "pig-island-site", nom: sortie.nom, marque: "secret", section: "islands", options: [{ id: "standard", titre: sortie.options[0].titre, tarifs: [{ ligne: "Adult", prestation: "00000000-0000-4000-8000-0000000000aa", libelle: "x" }] }] };
  PRODUITS_SITE.push(faux);
  try {
    const texte = `Booking request: ${sortie.nom} – ${sortie.options[0].titre}\nDate: Sun 20 Dec 2026\nGuests: 2 adults\nName: Anna`;
    const lu = lireMessage(texte, AJD);
    // Demande du carnet : l'identifiant donne la sortie du carnet, pas le produit du site au même nom.
    assert.equal(optionDuSite({ ...lu, carnet: { produit: "pig-island-groupe", option: "standard" } }).produit, sortie);
    // Identifiant du carnet inconnu : la recherche par le nom reste dans le carnet.
    assert.equal(optionDuSite({ ...lu, carnet: { produit: "n-existe-pas", option: "x" } }).produit, sortie);
    // Sortie du carnet connue mais option qui ne se reconnaît pas : aucun tarif, on ne prend pas un autre produit.
    assert.equal(optionDuSite({ ...lu, option: "Autre", carnet: { produit: "ang-thong-big-boat", option: "inconnue" } }), null);
    // Sans identifiant (message collé), le site Secret passe en premier comme avant.
    assert.equal(optionDuSite(lu).produit, faux);
  } finally {
    PRODUITS_SITE.splice(PRODUITS_SITE.indexOf(faux), 1);
  }
});

// ---- Une seule règle pour tous les chemins --------------------------------------------------------------------------------------------
test("enfant de 12 ans : compté adulte partout, avec le même total (fenêtre de création, changements, réponse de confirmation)", () => {
  const d12 = { ...D, produit_id: "ang-thong-big-boat", produit: "Ang Thong Marine Park by big boat", option_id: "with-kayak", option_titre: "With kayak", adultes: 1, enfants: 1, total_estime: null, message: "Booking request: Ang Thong Marine Park by big boat – With kayak\nDate: Sun 20 Dec 2026\nGuests: 1 adult, 1 child (age 12)\nPickup: Hotel Example\nName: Anna Keller" };
  // Chemin de la fenêtre : le message relu, l'âge réglé, le tarif choisi.
  const { d: lu, texte } = demandeCarnet({ produit: "ang-thong-big-boat", option: "with-kayak", adultes: 1, ages: [12] });
  const offre = offresDuService(lu, texte, { phrase: texte, date: lu.date, adultes: lu.adultes, enfants: lu.enfants }, contexte)[0];
  assert.equal(offre.total, 2 * 1850);
  // Chemin des demandes : la même règle sur la ligne de la table.
  const t = demandeTarifee(d12);
  assert.deepEqual([t.adultes, t.enfants, t.plusGrands], [lu.adultes, lu.enfants, 1]);
  assert.deepEqual([t.adultes, t.enfants], [2, 0]);
  // Le message relu depuis la ligne (texteDemande) donne le même résultat que celui de la fenêtre.
  const relu = ajusterAgesCarnet({ ...lireMessage(texteDemande(d12), AJD), carnet: { produit: d12.produit_id, option: d12.option_id } });
  assert.deepEqual([relu.adultes, relu.enfants], [t.adultes, t.enfants]);
  const total = offresDuService(relu, texteDemande(d12), { phrase: texteDemande(d12), date: relu.date, adultes: relu.adultes, enfants: relu.enfants }, contexte)[0].total;
  assert.equal(total, offre.total);
  // Réponse de confirmation : les personnes créées sont celles de la fenêtre, aucun « Guests » changé à tort (1 adulte et 1 enfant déclarés, 2 adultes facturés).
  const final = { date: "2026-12-20", option_titre: "With kayak", adultes: lu.adultes, enfants: lu.enfants, total: offre.total, devise: "THB" };
  assert.deepEqual(changements({ ...d12, total_estime: 3700 }, final), []);
  assert.doesNotMatch(reponseConfirmation({ ...d12, total_estime: 3700 }, final, { aujourdhui: AJD }), /instead of/);
  assert.match(reponseConfirmation(d12, final, { aujourdhui: AJD }), /2 adults\n/);
  // Une demande qui n'est pas du carnet n'est jamais ajustée.
  assert.deepEqual([demandeTarifee({ ...d12, page_url: "https://secrettravelandtour.com/tours/4-islands/" }).adultes], [1]);
  assert.deepEqual([demandeTarifee({ ...d12, produit_id: "4-islands" }).adultes], [1]);
});

// ---- Liste des demandes -----------------------------------------------------------------------------------------------------------------
test("liste des demandes : les clients sont indexés par numéro une seule fois, pas une fois par carte", () => {
  const clients = [{ id: "c-ztp", telephone: "+41 79 123 45 67" }, { id: "c-bis", telephone: "0041791234567" }, { id: "c-sans" }, { id: "c-court", telephone: "123" }];
  const index = indexClientsParTelephone(clients);
  assert.equal(clientParTelephone(index, "+41791234567").id, "c-ztp", "même numéro écrit autrement, première fiche gardée");
  assert.equal(clientParTelephone(index, "+33611223344"), null);
  assert.equal(clientParTelephone(index, ""), null);
  // Même résultat que clientsProches (la recherche par numéro de la fenêtre de création).
  assert.equal(clientsProches({ telephone: "+41791234567", nom: "" }, clients)[0].client.id, "c-ztp");
  const vue = fs.readFileSync(new URL("../src/gestion/js/views/demandes-site.mjs", import.meta.url), "utf8");
  assert.equal((vue.match(/clientsProposes\(\)/g) || []).length, 1, "clientsProposes() n'est appelé qu'une fois, pour l'index de la liste");
  assert.match(vue, /indexClientsParTelephone\(clientsProposes\(\)\)/);
  assert.doesNotMatch(vue.slice(vue.indexOf("function carte("), vue.indexOf("// ---- Chiffres")), /clientsProposes|clientsProches/, "la carte ne recalcule rien");
});

test("fiche d'une demande du carnet : une date ou un nom manquant se dit comme sur les autres demandes", () => {
  const vue = fs.readFileSync(new URL("../src/gestion/js/views/demandes-site.mjs", import.meta.url), "utf8");
  const fiche = vue.slice(vue.indexOf("function champsDuCarnet("), vue.indexOf("const ficheConnue"));
  assert.match(fiche, /tr\("Date à préciser"\)/);
  assert.match(fiche, /tr\("Nom non donné"\)/);
  assert.equal(champsCarnet({ ...D, date_service: null, nom: null }).date, "");
  assert.equal(champsCarnet({ ...D, date_service: null, nom: null }).nom, "");
});
