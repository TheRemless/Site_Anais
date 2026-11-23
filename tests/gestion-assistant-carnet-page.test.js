// L'Assistant et le WhatsApp d'une page du carnet (23.11.2026), par le vrai code : un client a écrit le récapitulatif français d'Ao Nang, la personne le colle dans la conversation, la fonction
// « agent » (executer) propose la carte « dossier », la fiche de création (views/agent-valider.mjs, views/demande.mjs) la valide sur la démo. Le dossier créé a le même total, les mêmes extras
// (lunch box, une ligne par personne) et les mêmes âges que celui d'une demande collée dans la fenêtre de création. Messages fabriqués par le code de la page (src/js/carnet-booking.js).
// Données inventées : aucun client, hôtel ni partenaire réel, prix fictifs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installerDom } from "./aides-dom.mjs";

const dom = installerDom();
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
  // Le modèle choisit le bon bateau du catalogue, sans extra ni âge réglé : c'est ce que la fonction ne sait pas faire seule.
  const e = { titre: "Dossier Anna", client_nom: "Anna Exemple", client_telephone: "+41790001234", hotel: "", langue: "fr", adultes: 2, enfants: 1, bebes: 0, apporteur: "", services: [{ texte: "Hong Islands VIP", ref: `P-${BATEAU.replace(/-/g, "").slice(0, 8)}`, date: "2026-12-22", heure_pickup: "", lieu_pickup: "", de: "", vers: "", adultes: 2, enfants: 1, sieges: 0, sieges_bebe: 0, sans_siege: false, bagages: 0, prix_saisi: "", vol: "", remarque_voucher: "", note_interne: "" }] };
  const r = await executer("proposer_dossier", e, ctx(), memo([WHATSAPP]));
  assert.ok(r.carte, JSON.stringify(r.contenu || r));
  assert.equal(r.carte.donnees.message_page, recap.replace(/[\u00a0\u202f]/g, " "), "la fonction joint le bloc de la page, espaces insécables normalisés comme les autres champs de la carte");
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
  assert.ok(!lignes.some((l) => l.prestation_id === tour.id), "le tour du catalogue n'est pas facturé");
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
  const lue = await E.etat.store.demandeSiteParRef("AON-AB12", entite("excursions").id);
  assert.equal(lue.id, ligne.id, "le magasin rend la demande de cette référence");
  assert.equal(await E.etat.store.demandeSiteParRef("AON-ZZZZ", entite("excursions").id), null);
  assert.equal(await E.etat.store.demandeSiteParRef("AON-AB12", entite("taxi").id), null, "la demande d'une autre entreprise n'est jamais rendue");
  assert.equal(await E.etat.store.demandeSiteParRef("AON-AB12", ""), null, "sans entreprise, rien");
  // Le titre de la page a changé depuis : le texte collé n'est plus reconnu par son titre, seule la demande enregistrée donne la sortie.
  const renomme = recap.replace(offre.produit, "Un titre que la page n'avait pas");
  const e = { titre: "Dossier", client_nom: "Anna Exemple", client_telephone: "", hotel: "", langue: "fr", adultes: 2, enfants: 1, bebes: 0, apporteur: "", services: [{ texte: "Hong Islands VIP", ref: `P-${BATEAU.replace(/-/g, "").slice(0, 8)}`, date: "2026-12-22", heure_pickup: "", lieu_pickup: "", de: "", vers: "", adultes: 2, enfants: 1, sieges: 0, sieges_bebe: 0, sans_siege: false, bagages: 0, prix_saisi: "", vol: "", remarque_voucher: "", note_interne: "" }] };
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

// ---- Relecture de la PR 341 : la fenêtre de création et l'Assistant, de bout en bout --------------------------------------------------------
const ligneDeLaPage = async (autres = {}) => {
  const body = B.buildBody(offre, raw, est, "AON-AB12", recap, "https://zwaldtravelplanner.com/carnet/ao-nang-excursions-bateau-x7k2/", "excursions");
  return { entite_id: entite("excursions").id, marque: "secret", statut: "nouvelle", ref: "AON-AB12", produit_id: body.product_id, produit: body.product, option_id: body.option, option_titre: body.option_label, date_service: body.date, adultes: body.adults, enfants: body.children, pickup: body.pickup, nom: body.name, total_estime: body.estimated_total, devise: "THB", page_url: body.page_url, message: body.message, decision: {}, created_at: "2026-11-23T05:00:00Z", ...autres };
};
const renomme = recap.replace(offre.produit, "Un titre que la page n'avait pas");
const carteDuModele = (ref) => ({ titre: "Dossier", client_nom: "Anna Exemple", client_telephone: "", hotel: "", langue: "fr", adultes: 2, enfants: 1, bebes: 0, apporteur: "", services: [{ texte: "Hong Islands VIP", ref, date: "2026-12-22", heure_pickup: "", lieu_pickup: "", de: "", vers: "", adultes: 2, enfants: 1, sieges: 0, sieges_bebe: 0, sans_siege: false, bagages: 0, prix_saisi: "", vol: "", remarque_voucher: "", note_interne: "" }] });
const refDuBateau = `P-${BATEAU.replace(/-/g, "").slice(0, 8)}`;

test("fonction « agent » : le client a écrit après, ou la référence n'est pas celle d'un guide : aucun bloc joint, la carte du modèle est celle d'avant", async () => {
  const { memoDepuis } = await import("../supabase/functions/agent/outils.js");
  const sans = async (textes, extra = {}) => {
    const m = { ...memo(textes), ...extra };
    const r = await executer("proposer_dossier", carteDuModele(refDuBateau), ctx(), m);
    assert.ok(r.carte);
    return r.carte;
  };
  for (const texte of [`${recap}\nfinalement 4 personnes et vendredi`, `Salut\n${recap}`, recap.replace("AON-AB12", "SEC-AB12"), recap.replace("AON-AB12", "AB12")]) {
    const carte = await sans([texte]);
    assert.equal(carte.donnees.message_page, undefined, texte.slice(-30));
    const prep = V.preparation({ id: "c", ...carte, statut: "proposee" }, []);
    assert.equal(prep.services[0].depuisPage, undefined, "la carte du modèle n'est pas touchée");
    assert.equal(prep.services[0].avertissementPage, undefined);
  }
  // Les messages du client lus dans WhatsApp (texte brut de la base, memoDepuis) : le bloc seul, ou suivi d'un message du client.
  const carte1 = await sans([], { textesPage: [recap] });
  assert.equal(carte1.donnees.message_page, recap.replace(/[\u00a0\u202f]/g, " "));
  const carte2 = await sans([], { textesPage: [recap, "finalement 4 personnes et vendredi"] });
  assert.equal(carte2.donnees.message_page, undefined, "un message du client après le bloc : rien n'est joint");
  assert.equal(memoDepuis([], { textesPage: [recap] }).textesPage[0], recap, "memoDepuis garde les textes de la conversation");
  // Le texte joint est nettoyé comme les autres champs : un lien du client est retiré de sa ligne, le reste est intact.
  const avecLien = recap.replace("Réf : AON-AB12", "Message : voir https://exemple.org/x?a=1\nRéf : AON-AB12");
  const carte3 = await sans([avecLien]);
  assert.ok(carte3.donnees.message_page && !/https?:/.test(carte3.donnees.message_page), "aucun lien dans le texte joint");
  assert.match(carte3.donnees.message_page, /^Destination : Hong Islands$/m);
});

test("carte à deux excursions validée d'un geste : la seconde, celle de la page, est remplacée, la première reste, la page n'est pas doublée", async () => {
  const phi = await E.inserer("prestations", { id: tarif("aonang-vip-phi-phi"), famille: "excursion", groupe: "Krabi", libelle: "Ao Nang, Phi Phi, option VIP", libelle_en: "Phi Phi Islands from Ao Nang, VIP option", prix_vente: 9999, unite: "boat", details: { capacite: "1 to 4 people" }, actif: true });
  const e = carteDuModele(`P-${phi.id.replace(/-/g, "").slice(0, 8)}`);
  e.services = [{ ...e.services[0], texte: "Phi Phi VIP", date: "2026-12-20" }, { ...carteDuModele(refDuBateau).services[0] }];
  const r = await executer("proposer_dossier", e, ctx(), memo([WHATSAPP]));
  assert.ok(r.carte, JSON.stringify(r.contenu || r));
  const c = { id: "carte-4", ...r.carte, statut: "proposee" };
  const prep = await V.preparationComplete(c);
  assert.deepEqual(prep.services.map((s) => s.depuisPage === true), [false, true]);
  const depuis = ecrits.length;
  const fin = await ouvrirDemande(null, prep, { auto: true, titre: c.titre, surCree: () => {} });
  assert.equal(fin.ok, true, fin.motif);
  const lignes = ecrits.slice(depuis).filter((x) => x.table === "documents" && x.op === "inserer").flatMap((x) => (x.valeurs.contenu || {}).lignes || []);
  assert.equal(lignes.filter((l) => l.prestation_id === phi.id).length, 1, "la première excursion est facturée une fois");
  assert.equal(lignes.filter((l) => l.prestation_id === BATEAU).length, 1, "le bateau de la page une fois");
  assert.deepEqual(lignes.filter((l) => l.prestation_id === LUNCH).map((l) => l.qte), [3]);
});

test("l'étape Taxi d'une carte n'est jamais touchée par la page, un transfert sans offre non plus", async () => {
  E.changerEntite(entite("taxi").id, { naviguer: false });
  try {
    const carte = { id: "carte-5", genre: "dossier", titre: "Dossier", statut: "proposee", donnees: { client: { nom: "Anna Exemple", telephone: "", hotel: "", langue: "fr" }, adultes: 2, enfants: 1, bebes: 0, services: [{ texte: "Taxi", date: "2026-12-22", heure_pickup: "10:00", lieu_pickup: "Krabi Airport", de: "Krabi Airport", vers: "Ao Nang", adultes: 2, enfants: 1, offre: null, origine_prix: "saisi", prix: 2500 }], message_page: recap } };
    const prep = V.preparation(carte, []);
    assert.deepEqual(prep.services.map((s) => [s.depuisPage, s.avertissementPage]), [[undefined, undefined]], "dans une étape Taxi : ni remplacement ni avertissement");
    assert.notEqual(prep.d.carnet && prep.d.carnet.produit, "aonang-vip-hong");
  } finally {
    E.changerEntite(entite("excursions").id, { naviguer: false });
  }
  // Étape Secret : le transfert sans offre n'est pas remplacé, la fiche le dit.
  const secret = { id: "carte-6", genre: "dossier", titre: "Dossier", statut: "proposee", donnees: { client: { nom: "Anna Exemple", telephone: "", hotel: "", langue: "fr" }, adultes: 2, enfants: 1, bebes: 0, services: [{ texte: "Taxi", date: "2026-12-22", heure_pickup: "10:00", lieu_pickup: "Krabi Airport", de: "Krabi Airport", vers: "Ao Nang", adultes: 2, enfants: 1, offre: null, origine_prix: "saisi", prix: 2500 }], message_page: recap } };
  const prepSecret = V.preparation(secret, []);
  assert.equal(prepSecret.services[0].depuisPage, undefined);
  assert.equal(prepSecret.services[0].avertissementPage, "page_non_rattachee");
});

test("la référence d'un autre client, ou une demande modifiée : la carte garde le service du modèle, rien d'un autre client n'arrive dans le dossier", async () => {
  const autre = await ligneDeLaPage({ nom: "Un autre client", date_service: "2027-01-10", adultes: 4, enfants: 0, ref: "AON-AB12" });
  const e = carteDuModele(refDuBateau);
  const r = await executer("proposer_dossier", e, ctx(), memo([renomme]));
  const c = { id: "carte-7", ...r.carte, statut: "proposee" };
  const prep = V.preparation(c, [autre]);
  assert.equal(prep.services[0].depuisPage, undefined, "la demande enregistrée ne concorde pas : ignorée, le titre renommé n'est pas reconnu");
  assert.equal(prep.services[0].avertissementPage, "page_non_rattachee");
  assert.notEqual(prep.d.nom, "Un autre client");
  assert.notEqual(prep.d.hotel, autre.pickup);
  // Client modifié : le texte dit 3 adultes, la demande enregistrée 2 + 1 : ignorée aussi.
  const modifie = renomme.replace("2 adultes", "3 adultes");
  const r2 = await executer("proposer_dossier", e, ctx(), memo([modifie]));
  const prep2 = V.preparation({ id: "c8", ...r2.carte, statut: "proposee" }, [await ligneDeLaPage()]);
  assert.equal(prep2.services[0].depuisPage, undefined);
  // Concordance : la demande enregistrée identifie la sortie, le nom et l'hôtel restent ceux du texte.
  const prep3 = V.preparation(c, [await ligneDeLaPage({ nom: "Nom de la base", pickup: "Hôtel de la base" })]);
  assert.equal(prep3.services[0].depuisPage, true);
  assert.equal(prep3.d.nom, "Anna Exemple");
  assert.equal(prep3.d.hotel, "Hotel Exemple", "le pickup du texte, pas celui de la base");
});

// La fenêtre « Créer le dossier » d'une demande collée (depuisSite), avec une base dont la réponse arrive quand le test le décide.
async function fenetreAvecBase() {
  const liste = E.etat.db.demandes_site;
  E.etat.db.demandes_site = [];
  let repondre;
  const attente = new Promise((r) => (repondre = r));
  const original = E.etat.store.demandeSiteParRef;
  E.etat.store.demandeSiteParRef = () => attente;
  let cree = null;
  ouvrirDemande({ texte: renomme, titre: "Demande collée", telephone: "", surCree: ({ dossier }) => (cree = dossier) });
  await dom.attendre(10);
  return { repondre, cree: () => cree, nom: () => dom.document.documentElement.descendants().filter((e) => e.id === "dem-nom").pop(), fin: () => { E.etat.db.demandes_site = liste; E.etat.store.demandeSiteParRef = original; } };
}
const lignesCreees = (depuis) => ecrits.slice(depuis).filter((x) => x.table === "documents" && x.op === "inserer").flatMap((x) => (x.valeurs.contenu || {}).lignes || []);

test("course : une réponse tardive de la base n'écrase jamais une saisie (fiche touchée, autre texte lu), et la fiche non touchée reçoit l'identification", async () => {
  const row = await ligneDeLaPage();
  // 1. La personne a corrigé le nom avant la réponse : la fiche n'est pas refaite, la saisie reste.
  let f = await fenetreAvecBase();
  const nomAvant = f.nom();
  assert.ok(nomAvant, "la fiche est ouverte sur une lecture libre");
  dom.saisir(nomAvant, "Nom corrigé à la main");
  f.repondre(row);
  await dom.attendre(30);
  assert.equal(f.nom(), nomAvant, "la fiche n'a pas été refaite");
  assert.equal(f.nom().value, "Nom corrigé à la main");
  f.fin();
  // 2. Un autre texte est lu pendant la recherche : la réponse tardive est ignorée.
  f = await fenetreAvecBase();
  const zone = dom.document.documentElement.descendants().filter((e) => e.id === "demande-texte").pop();
  dom.saisir(zone, `${renomme}\nMerci`);
  await dom.attendre(10);
  const nomApres = f.nom();
  f.repondre(row);
  await dom.attendre(30);
  assert.equal(f.nom(), nomApres, "un texte lu depuis : la réponse n'a rien refait");
  f.fin();
  // 3. Rien n'a été touché : la réponse identifie la sortie, la fiche est refaite avec elle.
  f = await fenetreAvecBase();
  const avant = f.nom();
  f.repondre(row);
  await dom.attendre(30);
  assert.notEqual(f.nom(), avant, "la fiche est refaite avec la sortie identifiée");
  f.fin();
});

test("course : « Créer le dossier » est bloqué pendant la recherche, et ne crée qu'après la réponse, d'après la sortie identifiée", async () => {
  const row = await ligneDeLaPage();
  const f = await fenetreAvecBase();
  const depuis = ecrits.length;
  const [bouton] = dom.boutons("Créer le dossier").slice(-1);
  assert.ok(bouton, "le bouton de création");
  assert.equal(bouton.disabled, true, "désactivé le temps de la recherche");
  bouton.click();
  await dom.attendre(20);
  assert.equal(f.cree(), null, "rien n'est créé tant que la recherche n'a pas répondu");
  assert.ok(!dom.document.documentElement.descendants().some((e) => (e.className || "").includes("erreur-form") && /Choisissez le service/.test(e.textContent || "")), "aucune création d'après la lecture libre n'a été tentée");
  f.repondre(row);
  await dom.attendre(60);
  const [apres] = dom.boutons("Créer le dossier").slice(-1);
  assert.equal(apres.disabled, false, "réactivé à la réponse");
  apres.click();
  await dom.attendre(120);
  const erreurs = dom.document.documentElement.descendants().filter((e) => (e.className || "").includes("erreur-form") && e.textContent).map((e) => e.textContent);
  assert.ok(f.cree(), `le dossier est créé après la réponse (${erreurs.join(" / ")})`);
  const lignes = lignesCreees(depuis);
  assert.equal(lignes.filter((l) => l.prestation_id === BATEAU).length, 1, "d'après la sortie identifiée");
  assert.deepEqual(lignes.filter((l) => l.prestation_id === LUNCH).map((l) => l.qte), [3]);
  f.fin();
});
