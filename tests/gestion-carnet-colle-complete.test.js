// Le WhatsApp FRANÇAIS des guides d'Ao Nang et de Koh Lanta, collé à la main ou lu par l'Assistant, se lit comme celui de Koh Samui (23.11.2026).
// Les messages ne sont pas écrits à la main : ils sont fabriqués par le code de la page (src/js/carnet-booking.js, buildRecap, buildGestionMessage, buildBody)
// pour chaque offre des deux guides, tirées de leurs fichiers de données (src/carnet/*.11tydata.js). Prix fictifs : seuls les mécanismes se vérifient ici.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { PRODUITS_CARNET, SORTIES_KOH_LANTA, REFS_CARNET } from "../src/gestion/js/carnet-produits.mjs";
import { PRODUITS_SITE } from "../src/gestion/js/site-produits.mjs";
import { CORRESPONDANCE_CARNET } from "../src/gestion/js/carnet-correspondance.mjs";
import { carnetDuMessage, offreDeLaPage, refDeLaPage } from "../src/gestion/js/carnet-colle.mjs";
import { lireMessage, lireDuTexte, demandeEnregistree, decouperServices } from "../src/gestion/js/demande-calc.mjs";
import { carteAvecLaPage } from "../src/gestion/js/assistant-calc.mjs";
import { cleTexte } from "../src/gestion/js/carnet-ages.mjs";
import { fichierGenere } from "../docs/gestion/regenerer-correspondance-carnet.mjs";

const require = createRequire(import.meta.url);
const B = require("../src/js/carnet-booking.js");
const lireFichier = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const AJD = "2026-11-23";
const ZTP = "https://zwaldtravelplanner.com/carnet/";
const GUIDES = [
  { guide: "aonang", fichier: "ao-nang-excursions-bateau", prefixe: "AON", page: "ao-nang-excursions-bateau-x7k2" },
  { guide: "koh-lanta", fichier: "koh-lanta-excursions-activites", prefixe: "LAN", page: "koh-lanta-excursions-activites-x7k2" },
];
const configDe = (fichier) => require(`../src/carnet/${fichier}.11tydata.js`).eleventyComputed.carnetConfig({ business: { telephone: "+66958683846" } });
const ACCUEIL = "Bonjour Anaïs, voici ma demande de réservation.\n\n";

// Les états de la feuille de réservation d'une offre : chaque formule, chaque créneau, chaque valeur de chaque choix, sans option puis avec toutes, avec et sans enfants (dont un
// de 12 ans et un bébé), un message du client qui contient « : » et des virgules. Pour une offre à lignes (quad, karts), une ligne puis toutes.
function etatsDe(o) {
  const variantes = o.variantes && o.variantes.length ? o.variantes.map((v) => v.id) : [""];
  const creneaux = (o.creneaux || []).length ? o.creneaux.map((c) => c.id) : [""];
  const choix = (o.choix || []).length ? o.choix.map((g) => g.valeurs.map((v) => [g.id, v.id])) : [[]];
  const combinaisons = choix.reduce((acc, valeurs) => acc.flatMap((x) => valeurs.map((v) => [...x, v])), [[]]);
  const etats = [];
  for (const variante of variantes) for (const creneau of creneaux) for (const c of combinaisons) {
    for (const extras of [[], (o.extras || []).map((x) => x.id)]) {
      for (const [adults, ages] of [[2, []], [2, [12, 1]], [1, [5]]]) {
        const counts = Object.fromEntries((o.lignes || []).map((l, i) => [l.id, extras.length || ages.length ? i + 1 : i === 0 ? 2 : 0]));
        etats.push({ variante, date: "2026-12-22", creneau, choix: Object.fromEntries(c), extras, counts, adults, ages, pickup: "Hotel Example", transfert: false, name: "Anna Keller", whatsapp: "+41791234567", message: ages.length ? "allergie : arachides, svp" : "" });
      }
    }
  }
  return etats;
}
// Le récapitulatif français et le message anglais que la page fabrique pour cet état, et le corps qu'elle envoie à Gestion.
function messagesDe(o, raw, prefixe, guide) {
  const est = B.estimate(o, raw);
  const ref = `${prefixe}-AB12`;
  const recap = B.buildRecap(o, raw, est, ref);
  const anglais = B.buildGestionMessage(o, raw, est, ref);
  const corps = B.buildBody(o, raw, est, ref, recap, `${ZTP}${guide.page}/`, "excursions");
  return { recap, anglais, corps, ref };
}

test("correspondance : chaque offre à feuille des deux guides a un titre français unique et une sortie de Gestion reconnue, et le fichier est celui que le script génère", () => {
  assert.equal(fichierGenere(), lireFichier("src/gestion/js/carnet-correspondance.mjs"), "relancer node docs/gestion/regenerer-correspondance-carnet.mjs");
  for (const g of GUIDES) {
    const config = configDe(g.fichier);
    const offres = Object.values(config.offres);
    const decrites = CORRESPONDANCE_CARNET.filter((x) => x.guide === g.guide);
    assert.equal(decrites.length, offres.length, `${g.guide} : toutes les offres à feuille sont décrites`);
    const titres = decrites.map((x) => cleTexte(x.titre));
    assert.equal(new Set(titres).size, titres.length, `${g.guide} : deux offres ne portent pas le même titre français`);
    for (const o of offres) {
      const d = decrites.find((x) => x.id === o.id);
      assert.ok(d, `${g.guide} ${o.id} : décrite`);
      assert.equal(d.titre, o.produit);
      const ids = d.variantes ? d.variantes : [d.gestion];
      const etiquettes = d.variantes ? d.variantes.map((v) => cleTexte(v.label)) : [];
      assert.equal(new Set(etiquettes).size, etiquettes.length, `${o.id} : deux formules ne portent pas le même libellé`);
      for (const x of ids) {
        assert.ok(x && x.produit && x.produitNom, `${o.id} : sortie de Gestion`);
        const sortie = PRODUITS_CARNET.find((p) => p.id === x.produit) || (SORTIES_KOH_LANTA.includes(x.produit) ? PRODUITS_SITE.find((p) => p.id === x.produit) : null);
        assert.ok(sortie, `${o.id} : la sortie « ${x.produit} » existe dans Gestion`);
        // Une sortie sans option au catalogue (renvoi vers WhatsApp : speedboat et ferry) n'a pas d'option à retrouver.
        assert.ok(!x.option ? !sortie.options.length : sortie.options.some((op) => op.id === x.option), `${o.id} : l'option « ${x.option} » de « ${x.produit} » existe`);
        // La résolution par le titre français exact rend cette sortie et cette option.
        const lignes = ["Demande de réservation : " + o.produit, ...(d.variantes ? [`${d.variantesLabel} : ${x.label}`] : [])];
        const r = offreDeLaPage(g.guide, o.produit, lignes);
        assert.ok(r && r.ids.produit === x.produit && (r.ids.option || "") === (x.option || ""), `${o.id} ${x.label || ""} : titre français résolu`);
      }
    }
  }
  assert.equal(CORRESPONDANCE_CARNET.filter((x) => x.guide === "aonang").length, 5);
  assert.equal(CORRESPONDANCE_CARNET.filter((x) => x.guide === "koh-lanta").length, 48);
  assert.equal(offreDeLaPage("aonang", "Une offre qui n'existe pas", []), null);
  assert.equal(offreDeLaPage("aonang", "Ao Nang, long tail boat privé, option VIP", ["x", "Destination : Ailleurs"]), null, "formule inconnue : rien n'est deviné");
});

test("le WhatsApp français de chaque offre d'Ao Nang et de Koh Lanta, fabriqué par la page, se récrit exactement comme le message anglais que la page envoie à Gestion", () => {
  let etats = 0;
  for (const g of GUIDES) {
    for (const o of Object.values(configDe(g.fichier).offres)) {
      for (const raw of etatsDe(o)) {
        const { recap, anglais, corps, ref } = messagesDe(o, raw, g.prefixe, g);
        for (const texte of [ACCUEIL + recap, recap]) {
          const r = carnetDuMessage(texte);
          assert.ok(r, `${o.id} ${JSON.stringify(raw.variante)} : reconnu\n${recap}`);
          assert.equal(r.texte, anglais, `${o.id} : même message que celui de la page\n${recap}`);
          assert.deepEqual(r.carnet, { produit: corps.product_id, option: corps.option }, `${o.id} : même sortie et même option que le corps envoyé`);
          assert.equal(r.guide, g.guide);
          assert.equal(refDeLaPage(texte), ref);
        }
        etats++;
      }
    }
  }
  assert.ok(etats > 150, `${etats} états contrôlés`);
});

// ---- Un catalogue de test : un tarif fictif par ligne de chaque sortie d'Ao Nang et de Koh Lanta ---------------------------------------
const md5uuid = (s) => { const h = createHash("md5").update(s).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const sortiesLanta = SORTIES_KOH_LANTA.map((id) => PRODUITS_SITE.find((p) => p.id === id));
const prestations = [];
const prixDe = new Map();
for (const p of [...PRODUITS_CARNET.filter((x) => x.guide === "aonang"), ...sortiesLanta]) {
  for (const o of p.options) for (const [i, t] of (o.tarifs || []).entries()) {
    if (prixDe.has(t.prestation)) continue;
    const prix = 1000 + 37 * (prixDe.size % 50) + (i + 1) * 10;
    prixDe.set(t.prestation, prix);
    prestations.push({ id: t.prestation, partenaire_id: "p1", famille: "excursion", groupe: p.id, libelle: t.libelle || t.ligne, libelle_en: t.libelle || t.ligne, prix_vente: prix, unite: /Adult|adult|Lunch|Per person/.test(t.ligne) ? "pp" : /^Child|child/.test(t.ligne) ? "ch" : "boat", details: {}, actif: true });
  }
}
const contexte = { prestations, trajets: [], partenaires: [{ id: "p1", actif: true }], nomPartenaire: () => "" };
const LUNCH_VIP_ID = PRODUITS_CARNET.find((p) => p.id === "aonang-option-lunch-box").options[0].tarifs.find((t) => /VIP/.test(t.ligne)).prestation;
const LUNCH_ECO_ID = PRODUITS_CARNET.find((p) => p.id === "aonang-option-lunch-box").options[0].tarifs.find((t) => /Economy/.test(t.ligne)).prestation;
const VIP_SET_ID = PRODUITS_CARNET.find((p) => p.id === "aonang-option-vip-set").options[0].tarifs[0].prestation;
const LUNCH_BOX_ID = (o, produit) => (/economique/.test(produit) ? LUNCH_ECO_ID : LUNCH_VIP_ID);
const resume = (d, services) => ({
  carnet: d.carnet, adultes: d.adultes, enfants: d.enfants, bebes: d.bebes, ages: d.ages, agesDeclares: d.agesDeclares, plusGrands: d.plusGrands, extras: d.extras, parc: d.parc, date: d.date, hotel: d.hotel, nom: d.nom, remarque: d.remarque,
  offres: services.map((s) => (s.offres || []).slice(0, 2).map((o) => ({ id: o.id, total: o.total, extras: (o.extras || []).map((x) => [x.ligne, x.qte]), manquants: o.extrasManquants || null, avertissement: o.avertissement || "" }))),
});

test("WhatsApp français collé : même sortie, même option, mêmes âges, même seuil de groupe, mêmes extras et même prix que le message anglais de la page, pour toutes les offres", () => {
  let verifies = 0;
  const fenetre = (texte) => { const d = lireDuTexte(texte, AJD, null); return d ? resume(d, decouperServices(texte, d, contexte, AJD)) : null; };
  for (const g of GUIDES) {
    for (const o of Object.values(configDe(g.fichier).offres)) {
      for (const raw of etatsDe(o)) {
        const { recap, anglais } = messagesDe(o, raw, g.prefixe, g);
        const fr = fenetre(ACCUEIL + recap);
        const en = fenetre(anglais);
        assert.ok(fr && en, o.id);
        assert.deepEqual(fr, en, `${o.id} : le français donne la même lecture que l'anglais\n${recap}`);
        assert.ok(fr.carnet && fr.carnet.produit, o.id);
        // Ao Nang : le bon bateau (le tarif unique de la sortie) au bon prix, avec ses extras par personne ou par bateau.
        if (g.guide === "aonang") {
          const tarifBateau = PRODUITS_CARNET.find((p) => p.id === fr.carnet.produit).options[0].tarifs[0].prestation;
          assert.equal(fr.offres[0][0].id, tarifBateau, `${o.id} : le bon bateau`);
          const extras = fr.offres[0][0].extras.reduce((t, [ligne, qte]) => t + qte * (ligne === "Lunch box" ? prixDe.get(LUNCH_BOX_ID(o, fr.carnet.produit)) : prixDe.get(VIP_SET_ID)), 0);
          assert.equal(fr.offres[0][0].total, prixDe.get(tarifBateau) + extras, `${o.id} : le bon prix`);
        }
        verifies++;
      }
    }
  }
  assert.ok(verifies > 150, `${verifies} messages`);
});

test("Ao Nang collé en français : lunch box, VIP Set et enfant de 12 ans, le prix du bateau plus les extras comme la fenêtre d'une demande du site", () => {
  const g = GUIDES[0];
  const o = configDe(g.fichier).offres["ao-nang-vip"];
  const raw = { variante: "hong-islands", date: "2026-12-22", creneau: "matin", choix: {}, extras: ["lunch-box"], counts: {}, adults: 2, ages: [12], pickup: "Hotel Example", transfert: false, name: "Anna Keller", whatsapp: "+41791234567", message: "" };
  const { recap } = messagesDe(o, raw, g.prefixe, g);
  const d = lireDuTexte(ACCUEIL + recap, AJD, null);
  assert.deepEqual(d.carnet, { produit: "aonang-vip-hong", option: "standard" });
  const [s] = decouperServices(ACCUEIL + recap, d, contexte, AJD);
  const sans = decouperServices(ACCUEIL + recap, lireDuTexte(ACCUEIL + recap.replace(/^Options : .*\n/m, ""), AJD, null), contexte, AJD)[0].offres[0];
  assert.equal(s.offres[0].total - sans.total, 3 * prixDe.get(s.offres[0].extras[0].source.id), "trois lunch box (2 adultes + 1 enfant)");
  assert.deepEqual(s.offres[0].extras.map((x) => [x.ligne, x.qte]), [["Lunch box", 3]]);
  assert.equal(s.offres[0].id, PRODUITS_CARNET.find((p) => p.id === "aonang-vip-hong").options[0].tarifs[0].prestation);
});

test("Koh Lanta collé en français : Kradan sur le longtail privé, enfant de 12 ans compté adulte, quad par ligne", () => {
  const g = GUIDES[1];
  const config = configDe(g.fichier);
  const o = config.offres["4-islands--private-longtail"];
  const raw = { variante: "", date: "2026-12-22", creneau: "", choix: {}, extras: ["koh-kradan"], counts: {}, adults: 2, ages: [12], pickup: "Hotel Example", transfert: false, name: "Anna Keller", whatsapp: "+41791234567", message: "" };
  const { recap } = messagesDe(o, raw, g.prefixe, g);
  const d = lireDuTexte(ACCUEIL + recap, AJD, null);
  assert.deepEqual(d.carnet, { produit: "4-islands", option: "private-longtail" });
  assert.equal(d.extras, "Add Koh Kradan");
  const [s] = decouperServices(ACCUEIL + recap, d, contexte, AJD);
  assert.ok(s.offres[0].extrasManquants || s.offres[0].extras, "l'extra est tarifé ou signalé, jamais perdu");
  // Quad : « 2 × Adulte pilote, 1 × Enfant passager » donne 2 adultes et 1 enfant, et la ligne de prix citée.
  const quad = config.offres["atv--track-30-min"];
  const rawQuad = { ...raw, extras: [], ages: [], adults: 0, counts: { "adulte-pilote": 2, "enfant-passager": 1 } };
  const m = messagesDe(quad, rawQuad, g.prefixe, g);
  const dq = lireDuTexte(ACCUEIL + m.recap, AJD, null);
  assert.deepEqual([dq.carnet, dq.adultes, dq.enfants], [{ produit: "atv", option: "track-30-min" }, 2, 1]);
});

test("mécanisme (a) : la demande enregistrée par la page pour la même référence est reprise ; sans elle, (b) lit le français ; un titre inconnu sans demande enregistrée reste libre", () => {
  const g = GUIDES[0];
  const o = configDe(g.fichier).offres["ao-nang-economique"];
  const raw = { variante: "hong-island-lagoon", date: "2026-12-22", creneau: "", choix: {}, extras: ["lunch-box", "vip-set"], counts: {}, adults: 2, ages: [12, 5], pickup: "Hotel Example", transfert: false, name: "Anna Keller", whatsapp: "+41791234567", message: "" };
  const { recap, corps } = messagesDe(o, raw, g.prefixe, g);
  // La ligne que la table demandes_site garde pour cette demande (le corps envoyé par la page, tel quel).
  const ligne = { id: "d1", marque: "secret", ref: corps.ref, produit_id: corps.product_id, produit: corps.product, option_id: corps.option, option_titre: corps.option_label, date_service: corps.date, heure: null, adultes: corps.adults, enfants: corps.children, pickup: corps.pickup, nom: corps.name, total_estime: corps.estimated_total, devise: "THB", page_url: corps.page_url, message: corps.message, created_at: "2026-11-23T05:00:00Z" };
  const texte = ACCUEIL + recap;
  assert.equal(demandeEnregistree(texte, [ligne]).id, "d1");
  assert.equal(demandeEnregistree(texte, [{ ...ligne, ref: "AON-ZZZZ" }]), null);
  assert.equal(demandeEnregistree(texte, [{ ...ligne, page_url: "https://exemple.org/x" }]), null, "une demande qui n'est pas d'une page du carnet n'est pas reprise");
  const parLigne = lireDuTexte(texte, AJD, null, { demandes: [ligne] });
  const parTexte = lireDuTexte(texte, AJD, null);
  const lecture = (d) => resume(d, decouperServices(texte, d, contexte, AJD));
  assert.deepEqual(lecture(parLigne), lecture(parTexte), "les deux mécanismes donnent la même lecture");
  // Le titre de la page a changé depuis (le texte collé n'est plus reconnu par son titre) : la demande enregistrée suffit.
  const renomme = texte.replace(o.produit, "Un titre que la page n'avait pas");
  assert.equal(lireDuTexte(renomme, AJD, null).carnet, undefined, "sans demande enregistrée : message libre");
  assert.deepEqual(lireDuTexte(renomme, AJD, null, { demandes: [ligne] }).carnet, { produit: corps.product_id, option: corps.option });
  // Une demande du site du carnet garde son contexte exact, jamais la ligne trouvée par la référence.
  assert.equal(lireDuTexte(texte, AJD, { carnet: { produit: "aonang-vip-hong", option: "standard" } }, { demandes: [ligne] }).carnet.produit, "aonang-vip-hong");
  assert.deepEqual(REFS_CARNET, { SAM: "koh-samui", AON: "aonang", LAN: "koh-lanta" });
});

test("l'Assistant : la fonction « agent » joint le bloc de la page à la carte, la fiche le lit comme un message collé, même total, mêmes extras, mêmes âges", async () => {
  const { messageDeLaPage, blocsDeLaPage } = await import("../supabase/functions/agent/outils.js");
  const g = GUIDES[0];
  const o = configDe(g.fichier).offres["ao-nang-vip"];
  const raw = { variante: "hong-islands", date: "2026-12-22", creneau: "matin", choix: {}, extras: ["lunch-box"], counts: {}, adults: 2, ages: [12], pickup: "Hotel Example", transfert: false, name: "Anna Keller", whatsapp: "+41791234567", message: "" };
  const { recap } = messagesDe(o, raw, g.prefixe, g);
  const bloc = recap;
  // Côté fonction : le bloc est repéré dans le message collé comme dans celui d'un client lu dans WhatsApp, tel quel ; deux demandes différentes dans l'échange : rien.
  assert.equal(messageDeLaPage([ACCUEIL + recap]), bloc);
  assert.equal(messageDeLaPage(["Bonjour", `Voici :\n${recap}\nMerci`]), bloc);
  assert.equal(messageDeLaPage(["Salut, tarif taxi ?"]), "");
  assert.equal(messageDeLaPage([recap, recap.replace("AON-AB12", "AON-ZZ99")]), "", "deux références : le modèle ne choisit pas");
  assert.equal(messageDeLaPage([recap, ACCUEIL + recap]), bloc, "le même bloc dit deux fois reste un seul bloc");
  assert.equal(blocsDeLaPage([recap]).length, 1);
  // Côté fiche : la carte du modèle (un service du catalogue choisi par lui, sans extra) et le bloc de la page.
  const modele = { texte: "Hong VIP", date: "2026-12-22", heure: "", adultes: 2, enfants: 1, offres: [{ genre: "prestation", id: "x", titre: "Hong VIP, choisi par le modèle", total: 1, source: { famille: "excursion" } }], inconnu: false };
  const prep = { texte: "", d: { libre: true, ia: true, nom: "Anna Keller", telephone: "+41791234567", hotel: "", langue: "en", adultes: 2, enfants: 1, bebes: 0, remarquesIA: "" }, services: [modele] };
  const avec = carteAvecLaPage(prep, bloc, contexte, { aujourdhui: AJD });
  const fenetre = decouperServices(bloc, lireDuTexte(bloc, AJD, null), contexte, AJD)[0];
  assert.equal(avec.d.libre, false);
  assert.equal(avec.services.length, 1);
  assert.equal(avec.services[0].depuisPage, true);
  assert.deepEqual(avec.services[0].offres.map((x) => [x.id, x.total, (x.extras || []).map((e) => [e.ligne, e.qte])]), fenetre.offres.map((x) => [x.id, x.total, (x.extras || []).map((e) => [e.ligne, e.qte])]), "mêmes offres, même total, mêmes extras que la fenêtre de création");
  assert.deepEqual([avec.d.carnet, avec.d.adultes, avec.d.enfants, avec.d.plusGrands, avec.d.extras], [{ produit: "aonang-vip-hong", option: "standard" }, 2, 1, undefined, "Lunch box"]);
  assert.equal(avec.texte, bloc);
  assert.equal(avec.d.nom, "Anna Keller");
  // Rien de reconnu, ou le service d'une autre entreprise : la carte reste comme elle était.
  assert.equal(carteAvecLaPage(prep, "", contexte, { aujourdhui: AJD }), prep);
  assert.equal(carteAvecLaPage(prep, bloc.replace("AON-AB12", "XYZ-AB12"), contexte, { aujourdhui: AJD }), prep);
  const taxi = { ...prep, services: [{ ...modele, offres: [{ ...modele.offres[0], source: { famille: "transfert" } }] }] };
  assert.equal(carteAvecLaPage(taxi, bloc, contexte, { aujourdhui: AJD }), taxi, "un transfert n'est jamais remplacé par une excursion");
  const deux = carteAvecLaPage({ ...prep, services: [{ ...modele, offres: [{ ...modele.offres[0], source: { famille: "transfert" } }] }, modele] }, bloc, contexte, { aujourdhui: AJD });
  assert.deepEqual(deux.services.map((s) => !!s.depuisPage), [false, true], "seul le service d'excursion est remplacé");
  assert.equal(md5uuid("x").length, 36);
});

test("branchements : la fiche de création lit un texte avec la demande enregistrée, l'Assistant passe par preparationComplete, les deux magasins savent chercher une référence", () => {
  const vue = lireFichier("src/gestion/js/views/demande.mjs");
  assert.match(vue, /lireDuTexte\(texte, aujourdhui\(\), depuisSite, \{ demandes: demandesLues\(\) \}\)/);
  assert.match(vue, /etat\.store\.demandeSiteParRef\(ref\)/);
  assert.match(vue, /s\.depuisPage \? s : \{ \.\.\.s, offresIA: s\.offres \}/);
  const valider = lireFichier("src/gestion/js/views/agent-valider.mjs");
  assert.match(valider, /carteAvecLaPage\(/);
  assert.match(valider, /export async function preparationComplete/);
  assert.doesNotMatch(lireFichier("src/gestion/js/views/agent.mjs"), /ouvrirDemande\(null, preparation\(/);
  assert.match(lireFichier("src/gestion/js/store-supabase.mjs"), /async demandeSiteParRef\(ref\)/);
  assert.match(lireFichier("src/gestion/js/store-local.mjs"), /async demandeSiteParRef\(ref\)/);
  assert.match(lireFichier("supabase/functions/agent/outils.js"), /message_page: messageDeLaPage\(/);
});

test("plus aucune limite dite dans la doc : ni titre français non reconnu pour Ao Nang et Koh Lanta, ni Assistant hors détection, ni tarifs « provisoires »", () => {
  for (const f of ["docs/gestion/carnet-aonang-lanta.md", "docs/gestion/demandes-site.md", "src/gestion/js/carnet-colle.mjs", "src/gestion/js/carnet-produits.mjs", "src/gestion/js/assistant-calc.mjs"]) {
    const t = lireFichier(f);
    assert.doesNotMatch(t, /provisoire|ne passe pas par cette détection|n'est pas reconnu : son nom|à décider|ne sait pas qu'il vient du carnet/i, f);
  }
  assert.match(lireFichier("docs/gestion/carnet-aonang-lanta.md"), /regenerer-correspondance-carnet\.mjs/);
});
