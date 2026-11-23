// L'Assistant et le WhatsApp d'une page du carnet (23.11.2026), par le vrai code : un client a écrit le récapitulatif français d'Ao Nang, la personne le colle dans la conversation, la fonction
// « agent » (executer) propose la carte « dossier », la fiche de création (views/agent-valider.mjs, views/demande.mjs) la valide sur la démo. Le dossier créé a le même total, les mêmes extras
// (lunch box, une ligne par personne) et les mêmes âges que celui d'une demande collée dans la fenêtre de création. Messages fabriqués par le code de la page (src/js/carnet-booking.js).
// Données inventées : aucun client, hôtel ni partenaire réel, prix fictifs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installerDom } from "./aides-dom.mjs";

installerDom();
globalThis.location.search = "?demo";
const E = await import("../src/gestion/js/etat.mjs");
await E.init();
const { executer } = await import("../supabase/functions/agent/outils.js");
const { tempsSimule } = await import("../supabase/functions/agent/planifier.js");
const V = await import("../src/gestion/js/views/agent-valider.mjs");
const { ouvrirDemande } = await import("../src/gestion/js/views/demande.mjs");
const { lireDuTexte, decouperServices } = await import("../src/gestion/js/demande-calc.mjs");
const { PRODUITS_CARNET } = await import("../src/gestion/js/carnet-produits.mjs");
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

const require = createRequire(import.meta.url);
const B = require("../src/js/carnet-booking.js");
const config = require("../src/carnet/ao-nang-excursions-bateau.11tydata.js").eleventyComputed.carnetConfig({ business: { telephone: "+66958683846" } });

const entite = (slug) => E.etat.brut.entites.find((e) => e.slug === slug);
E.changerEntite(entite("excursions").id, { naviguer: false });
const ctx = () => ({ charger: async (n) => E.etat.db[n] || [], reglages: E.reglages(), simule: tempsSimule });
const memo = (textes) => ({ prix: new Set(), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes });

// Le catalogue de l'entreprise : le tarif du bateau VIP de Hong Islands et la ligne de la lunch box, avec les identifiants du carnet (prix fictifs), et un tour que le modèle pourrait choisir à tort.
const tarif = (id, cle) => PRODUITS_CARNET.find((p) => p.id === id).options[0].tarifs[0].prestation;
const BATEAU = tarif("aonang-vip-hong");
const LUNCH = PRODUITS_CARNET.find((p) => p.id === "aonang-option-lunch-box").options[0].tarifs.find((t) => /VIP/.test(t.ligne)).prestation;
await E.inserer("prestations", { id: BATEAU, famille: "excursion", groupe: "Krabi", libelle: "Ao Nang, Hong Islands, option VIP", libelle_en: "Hong Islands from Ao Nang, VIP option", prix_vente: 4321, unite: "boat", details: { capacite: "1 to 4 people" }, actif: true });
await E.inserer("prestations", { id: LUNCH, famille: "excursion", groupe: "Option", libelle: "Option : lunch box", libelle_en: "Option: lunch box", prix_vente: 61, unite: "pp", details: {}, actif: true });
const tour = await E.inserer("prestations", { famille: "excursion", groupe: "Tour", libelle: "Tour du modèle", libelle_en: "Tour du modèle", prix_vente: 999, unite: "pp", actif: true });

const ecrits = [];
for (const op of ["inserer", "modifier"]) {
  const f = E.etat.store[op].bind(E.etat.store);
  E.etat.store[op] = async (table, ...a) => {
    const r = await f(table, ...a);
    ecrits.push({ op, table, id: op === "inserer" ? r.id : a[0], valeurs: structuredClone(op === "inserer" ? a[0] : a[1]) });
    return r;
  };
}

const offre = config.offres["ao-nang-vip"];
const raw = { variante: "hong-islands", date: "2026-12-22", creneau: "matin", choix: {}, extras: ["lunch-box"], counts: {}, adults: 2, ages: [12], pickup: "Hotel Exemple", transfert: false, name: "Anna Exemple", whatsapp: "+41790001234", message: "" };
const est = B.estimate(offre, raw);
const recap = B.buildRecap(offre, raw, est, "AON-AB12");
const WHATSAPP = `Bonjour Anaïs, voici ma demande de réservation.\n\n${recap}`;

test("le dossier créé depuis la conversation a le total, les extras et les âges de la demande collée", async () => {
  // Le modèle choisit un tour du catalogue, sans extra ni âge : c'est ce que la fonction ne sait pas faire seule.
  const e = { titre: "Dossier Anna", client_nom: "Anna Exemple", client_telephone: "+41790001234", hotel: "", langue: "fr", adultes: 2, enfants: 1, bebes: 0, apporteur: "", services: [{ texte: "Hong Islands VIP", ref: `P-${tour.id.replace(/-/g, "").slice(0, 8)}`, date: "2026-12-22", heure_pickup: "", lieu_pickup: "", de: "", vers: "", adultes: 2, enfants: 1, sieges: 0, sieges_bebe: 0, sans_siege: false, bagages: 0, prix_saisi: "", vol: "", remarque_voucher: "", note_interne: "" }] };
  const r = await executer("proposer_dossier", e, ctx(), memo([WHATSAPP]));
  assert.ok(r.carte, JSON.stringify(r.contenu || r));
  assert.equal(r.carte.donnees.message_page, recap, "la fonction joint le bloc de la page, tel quel");
  const c = { id: "carte-1", ...r.carte, statut: "proposee" };
  // La fenêtre d'une demande collée : le même message, lu par la même fonction.
  const d = lireDuTexte(recap, "2026-11-23", null, { demandes: E.etat.db.demandes_site || [] });
  const [fenetre] = decouperServices(recap, d, { prestations: E.etat.db.prestations, trajets: [], partenaires: E.etat.db.partenaires, nomPartenaire: () => "" }, "2026-11-23");
  assert.equal(fenetre.offres[0].id, BATEAU);
  assert.equal(fenetre.offres[0].total, 4321 + 3 * 61);
  const prep = await V.preparationComplete(c);
  assert.equal(prep.services[0].depuisPage, true);
  assert.equal(prep.d.libre, false, "lue comme une demande de la page, pas comme un message libre");
  assert.deepEqual(prep.services[0].offres.map((o) => [o.id, o.total]), fenetre.offres.map((o) => [o.id, o.total]), "même offre, même total que la fenêtre de création");
  assert.deepEqual(prep.services[0].offres[0].extras.map((x) => [x.ligne, x.qte]), [["Lunch box", 3]], "la lunch box compte les trois personnes");
  assert.deepEqual([prep.d.adultes, prep.d.enfants, prep.d.ages], [d.adultes, d.enfants, d.ages], "mêmes âges");
  // Validée d'un geste : le dossier et sa facture.
  const depuis = ecrits.length;
  const fin = await ouvrirDemande(null, prep, { auto: true, titre: c.titre, surCree: () => {} });
  assert.equal(fin.ok, true, fin.motif);
  const documents = ecrits.slice(depuis).filter((x) => x.table === "documents" && x.op === "inserer");
  const lignes = documents.flatMap((x) => (x.valeurs.contenu || {}).lignes || []);
  const somme = lignes.filter((l) => l.kind !== "texte").reduce((t, l) => t + (Number(l.unite) || 0) * (Number(l.qte) || 0), 0);
  assert.equal(somme, 4321 + 3 * 61, "la facture porte le bateau et trois lunch box");
  assert.deepEqual(lignes.filter((l) => l.prestation_id === LUNCH).map((l) => [l.unite, l.qte]), [[61, 3]]);
  assert.ok(!lignes.some((l) => l.prestation_id === tour.id), "le tour choisi par le modèle n'est pas facturé");
});

test("sans bloc de la page dans la conversation, la carte du modèle est inchangée", async () => {
  const e = { titre: "Dossier", client_nom: "Anna Exemple", client_telephone: "", hotel: "", langue: "fr", adultes: 2, enfants: 0, bebes: 0, apporteur: "", services: [{ texte: "Tour", ref: `P-${tour.id.replace(/-/g, "").slice(0, 8)}`, date: "2026-12-22", heure_pickup: "", lieu_pickup: "", de: "", vers: "", adultes: 2, enfants: 0, sieges: 0, sieges_bebe: 0, sans_siege: false, bagages: 0, prix_saisi: "", vol: "", remarque_voucher: "", note_interne: "" }] };
  const r = await executer("proposer_dossier", e, ctx(), memo(["Bonjour, un tour pour le 22 décembre svp"]));
  assert.ok(r.carte);
  assert.equal(r.carte.donnees.message_page, undefined);
  const prep = await V.preparationComplete({ id: "carte-2", ...r.carte, statut: "proposee" });
  assert.equal(prep.services[0].depuisPage, undefined);
  assert.equal(prep.services[0].offres[0].id, tour.id);
});

test("la demande que la page a enregistrée pour la référence est lue en base quand la liste de l'écran ne l'a pas (droits de la personne), puis la carte est préparée d'après elle", async () => {
  const body = B.buildBody(offre, raw, est, "AON-AB12", recap, "https://zwaldtravelplanner.com/carnet/ao-nang-excursions-bateau-x7k2/", "excursions");
  const ligne = await E.inserer("demandes_site", { entite_id: entite("excursions").id, marque: "secret", statut: "nouvelle", ref: "AON-AB12", produit_id: body.product_id, produit: body.product, option_id: body.option, option_titre: body.option_label, date_service: body.date, adultes: body.adults, enfants: body.children, pickup: body.pickup, nom: body.name, total_estime: body.estimated_total, devise: "THB", page_url: body.page_url, message: body.message, decision: {} });
  const lue = await E.etat.store.demandeSiteParRef("AON-AB12");
  assert.equal(lue.id, ligne.id, "le magasin rend la demande de cette référence");
  assert.equal(await E.etat.store.demandeSiteParRef("AON-ZZZZ"), null);
  // Le titre de la page a changé depuis : le texte collé n'est plus reconnu par son titre, seule la demande enregistrée donne la sortie.
  const renomme = recap.replace(offre.produit, "Un titre que la page n'avait pas");
  const e = { titre: "Dossier", client_nom: "Anna Exemple", client_telephone: "", hotel: "", langue: "fr", adultes: 2, enfants: 1, bebes: 0, apporteur: "", services: [{ texte: "Hong Islands VIP", ref: `P-${tour.id.replace(/-/g, "").slice(0, 8)}`, date: "2026-12-22", heure_pickup: "", lieu_pickup: "", de: "", vers: "", adultes: 2, enfants: 1, sieges: 0, sieges_bebe: 0, sans_siege: false, bagages: 0, prix_saisi: "", vol: "", remarque_voucher: "", note_interne: "" }] };
  const r = await executer("proposer_dossier", e, ctx(), memo([renomme]));
  const c = { id: "carte-3", ...r.carte, statut: "proposee" };
  const liste = E.etat.db.demandes_site;
  E.etat.db.demandes_site = [];
  try {
    assert.equal(V.preparation(c).services[0].depuisPage, undefined, "sans la demande enregistrée, le texte renommé n'est pas reconnu : la carte reste celle du modèle");
    const prep = await V.preparationComplete(c);
    assert.equal(prep.services[0].depuisPage, true);
    assert.equal(prep.services[0].offres[0].id, BATEAU);
    assert.deepEqual(prep.services[0].offres[0].extras.map((x) => [x.ligne, x.qte]), [["Lunch box", 3]]);
  } finally {
    E.etat.db.demandes_site = liste;
  }
});
