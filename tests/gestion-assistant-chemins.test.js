// Tous les chemins qui créent ou modifient une réservation depuis l'Assistant (et la demande du site), par le vrai code (relecture de la
// PR 332). Le 23.11.2026, un service du catalogue validé par une carte « dossier » avait perdu sa dépose (`vers`), que le voucher imprime.
// Chaque test part d'une carte faite par la fonction de l'Assistant (executer), la passe par l'écran réel (views/agent-valider.mjs,
// views/demande.mjs, views/reservations.mjs, views/confirmation.mjs) sur la démo (store-local.mjs, le magasin du mode démo) et un DOM
// minimal (aides-dom.mjs), puis compare champ par champ ce que l'écran a passé à `inserer` et `modifier` avec la carte : drop-off, pickup,
// départ (`de`), heure, vol, sièges par type, bagages, remarque du voucher, personnes, prix, partenaire et paiement sur place.
// Données inventées : aucun client, hôtel ni partenaire réel.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { installerDom } from "./aides-dom.mjs";

const dom = installerDom();
globalThis.location.search = "?demo";
const E = await import("../src/gestion/js/etat.mjs");
await E.init();
const { executer, refDe } = await import("../supabase/functions/agent/outils.js");
const { tempsSimule } = await import("../supabase/functions/agent/planifier.js");
const { reservationDepuisCarte, reservationModifiee, lieuxAVerifier } = await import("../src/gestion/js/agent-calc.mjs");
const V = await import("../src/gestion/js/views/agent-valider.mjs");
const { ouvrirDemande } = await import("../src/gestion/js/views/demande.mjs");
const { ouvrirConfirmation } = await import("../src/gestion/js/views/confirmation.mjs");
const { partenaireDeTaxi, chauffeurRegle } = await import("../src/gestion/js/voucher-rapide-calc.mjs");
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

// ---- Le banc : la démo, ses trois entreprises, et chaque écriture de l'écran ------------------------------------------------------
const entite = (slug) => E.etat.brut.entites.find((e) => e.slug === slug);
const dans = (slug) => E.changerEntite(entite(slug).id, { naviguer: false });
// Chaque appel au magasin : { op, table, id, valeurs } (valeurs : ce que l'écran a passé, tel quel).
const ecrits = [];
for (const op of ["inserer", "modifier"]) {
  const f = E.etat.store[op].bind(E.etat.store);
  E.etat.store[op] = async (table, ...a) => {
    const r = await f(table, ...a);
    ecrits.push(op === "inserer" ? { op, table, id: r.id, valeurs: structuredClone(a[0]) } : { op, table, id: a[0], valeurs: structuredClone(a[1]) });
    return r;
  };
}
// La réservation telle que l'écran l'a écrite : son `inserer`, puis chaque `modifier` par-dessus, dans l'ordre.
function ecrite(id) {
  const liste = ecrits.filter((e) => e.table === "reservations" && e.id === id);
  assert.ok(liste.length && liste[0].op === "inserer", "la réservation est créée par l'écran");
  return liste.reduce((r, e) => ({ ...r, ...e.valeurs, ...(e.valeurs.details ? { details: { ...(r.details || {}), ...e.valeurs.details } } : {}) }), {});
}
const reservationsDu = (dossierId) => E.etat.brut.reservations.filter((r) => r.dossier_id === dossierId).map((r) => ecrite(r.id));

// La fonction de l'Assistant lit le catalogue de l'entreprise active.
const ctx = () => ({ charger: async (n) => E.etat.db[n] || [], reglages: E.reglages(), simule: tempsSimule });
const PRIX = 3000;
const memo = (textes = []) => ({ prix: new Set(), heures: new Set(), tapes: new Set([PRIX]), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes: ["Flight FD3217 tomorrow, 3000 THB, drop at Hotel Plage Exemple https://maps.app.goo.gl/exemple1", ...textes] });
const REMARQUE = "Driver waits in the lobby with a name sign.";

// Le catalogue de chaque entreprise, créé une fois, avec des libellés comme en production (une seule destination, aucun trajet) : un
// transfert « Ao Nang » et une excursion.
const catalogue = {};
async function catalogueDe(slug) {
  if (catalogue[slug]) return catalogue[slug];
  dans(slug);
  const transfert = await E.inserer("prestations", { famille: "transfert", groupe: "Taxi", libelle: "Ao Nang", libelle_en: "Ao Nang", prix_vente: 2500, unite: "veh", actif: true });
  const tour = await E.inserer("prestations", { famille: "excursion", groupe: "Tour", libelle: "Tour Exemple", libelle_en: "Tour Exemple", prix_vente: 1500, unite: "pp", actif: true });
  return (catalogue[slug] = { transfert, tour });
}
// Le service du cas réel du 23.11.2026, rendu fictif : un service du catalogue, une dépose d'hôtel (avec le lien Maps lu), 2 bagages, un prix tapé.
const service = (o = {}) => ({ texte: "Taxi to Ville Exemple", ref: "", date: "2026-12-03", heure_pickup: "09:15", lieu_pickup: "Villa Exemple", de: "Koh Exemple", vers: "Hotel Plage Exemple https://maps.app.goo.gl/exemple1", adultes: 2, enfants: 1, sieges: 1, sieges_bebe: 1, sans_siege: false, bagages: 2, prix_saisi: String(PRIX), vol: "FD3217", remarque_voucher: REMARQUE, note_interne: "", ...o });
let n = 0;
const dossierCarte = (services, o = {}) => ({ titre: "Dossier", client_nom: `Client Exemple ${++n}`, client_telephone: `+4179000${String(1000 + n)}`, hotel: "", langue: "en", adultes: 2, enfants: 1, bebes: 1, services, apporteur: "", ...o });
const carteDe = async (outil, e) => {
  const r = await executer(outil, e, ctx(), memo());
  assert.ok(r.carte, JSON.stringify(r.contenu || r));
  return { id: `carte-${++n}`, ...r.carte, statut: "proposee" };
};
const chauffeur = () => partenaireDeTaxi(E.etat.db.partenaires, chauffeurRegle(E.reglages()));

// Ce que la carte dit du service, dans les clés de la réservation, et la comparaison champ par champ avec ce que l'écran a écrit.
const CLES = ["drop_off", "lieu_pickup", "heure_pickup", "vol", "sieges", "sieges_bebe", "sans_siege", "bagages", "remarques", "adultes", "enfants", "bebes", "montant_vente", "partenaire_id", "paye_sur_place"];
const aplatir = (r) => {
  const d = r.details || {};
  const p = r.personnes || {};
  return { drop_off: d.drop_off, lieu_pickup: r.lieu_pickup, heure_pickup: r.heure_pickup, vol: d.vol, sieges: d.sieges, sieges_bebe: d.sieges_bebe, sans_siege: d.sans_siege, bagages: d.bagages, remarques: d.remarques, adultes: p.adultes, enfants: p.enfants, bebes: p.bebes, montant_vente: r.montant_vente, partenaire_id: r.partenaire_id ?? null, paye_sur_place: r.paye_sur_place };
};
function comparer(r, attendu, quoi) {
  const a = aplatir(r);
  for (const k of Object.keys(attendu)) {
    assert.ok(CLES.includes(k), k);
    assert.deepEqual(a[k], attendu[k], `${quoi} : ${k}`);
  }
  assert.doesNotMatch(JSON.stringify(r.details || {}), /https?:|goo\.gl|maps\.app|www\./, `${quoi} : aucun lien`);
}
const DE_LA_CARTE = { drop_off: "Hotel Plage Exemple", lieu_pickup: "Villa Exemple", heure_pickup: "09:15", vol: "FD3217", sieges: 1, sieges_bebe: 1, bagages: "2", remarques: REMARQUE, adultes: 2, enfants: 1, montant_vente: PRIX };
const sansSieges = ({ sieges, sieges_bebe, ...reste }) => ({ ...reste, sieges: undefined, sieges_bebe: undefined });

// Valider d'un geste une carte « dossier » simple : la fiche de création, cachée (views/agent.mjs, valider).
const validerDossier = (c) => ouvrirDemande(null, V.preparation(c), { auto: true, titre: c.titre, surCree: () => {} });

// ---- 1. Carte « dossier », service du catalogue (Taxi, Secret, ZTP) ---------------------------------------------------------------
for (const [nom, slug] of [["Taxi", "taxi"], ["Secret", "excursions"], ["ZTP", "agence"]]) {
  test(`1. ${nom}, carte « dossier », service du catalogue : chaque champ de la carte arrive sur la réservation écrite`, async () => {
    const { transfert } = await catalogueDe(slug);
    dans(slug);
    const c = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", transfert.id) })]));
    assert.equal(c.donnees.services[0].vers, "Hotel Plage Exemple", "la fonction retire déjà le lien");
    const r = await validerDossier(c);
    assert.equal(r.ok, true, r.motif);
    const [resa] = reservationsDu(r.dossier.id);
    const taxi = slug === "taxi";
    // Les sièges ne vont jamais chez ZTP (ses vouchers n'en impriment pas). Chez Taxi, la course est au chauffeur réglé, payée sur place.
    comparer(resa, { ...(slug === "agence" ? sansSieges(DE_LA_CARTE) : DE_LA_CARTE), bebes: 1, partenaire_id: taxi ? (chauffeur() || {}).id || null : null, ...(taxi ? { paye_sur_place: true } : {}) }, nom);
    assert.equal(resa.prestation_id, transfert.id);
  });
}

// ---- Les lieux : recopiés de la carte, jamais déduits ni vidés (relecture de la PR 332) ----------------------------------------
// Libellés comme en production : une seule destination, aucun trajet. Le pickup et le drop-off viennent de la carte, tels quels ; sans eux,
// la carte le signale et ne se valide pas d'un geste.
const DESTINATIONS = ["Krabi Airport", "Ao Nang", "Pakbara Pier"];
const prestationsProd = {};
async function catalogueProd(slug) {
  dans(slug);
  if (!prestationsProd[slug]) {
    prestationsProd[slug] = {};
    for (const l of DESTINATIONS) prestationsProd[slug][l] = await E.inserer("prestations", { famille: "transfert", groupe: "Private Taxi", libelle: l, libelle_en: l, prix_vente: 2500, unite: "veh", actif: true });
  }
  dans(slug);
  return prestationsProd[slug];
}
// [libellé, pickup de la carte, drop-off de la carte] : arrivée, départ, embarcadère.
const LIEUX = [
  ["Krabi Airport", "Krabi Airport", "Resort Exemple"],
  ["Krabi Airport", "Resort Exemple", "Krabi Airport"],
  ["Ao Nang", "Resort Exemple", "Hotel Plage Exemple"],
  ["Pakbara Pier", "Pakbara Pier", "Resort Exemple"],
];
const AUTRES = { heure_pickup: "09:15", vol: "FD3217", sieges: 1, sieges_bebe: 1, bagages: "2", remarques: REMARQUE, adultes: 2, montant_vente: PRIX };

test("lieux recopiés : carte « dossier » (Taxi, Secret) et carte « reservation », le pickup et le drop-off de la carte tels quels", async () => {
  for (const slug of ["taxi", "excursions"]) {
    const p = await catalogueProd(slug);
    for (const [lib, pickup, dropoff] of LIEUX) {
      const quoi = `${slug}, ${lib}, ${pickup} → ${dropoff}`;
      // L'hôtel du client est connu : il ne remplace jamais un lieu de la carte.
      const c = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", p[lib].id), lieu_pickup: pickup, de: "", vers: dropoff })], { hotel: "Resort Exemple" }));
      assert.deepEqual(c.avertissements || [], [], `${quoi} : aucun lieu à vérifier`);
      const r = await validerDossier(c);
      assert.equal(r.ok, true, `${quoi} : ${r.motif}`);
      comparer(reservationsDu(r.dossier.id)[0], { ...AUTRES, enfants: 1, bebes: 1, lieu_pickup: pickup, drop_off: dropoff, partenaire_id: slug === "taxi" ? (chauffeur() || {}).id || null : null }, `dossier ${quoi}`);
      const client = await E.inserer("clients", { civilite: "", prenom: "Client", nom: `Exemple ${++n}`, adresse: "Resort Exemple", telephone: `+4179001${1000 + n}`, email: "", notes: "" });
      const dossier = await E.inserer("dossiers", { ref: `L-${n}`, client_id: client.id, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
      const c2 = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", dossier.id), service: service({ ref: refDe("P", p[lib].id), enfants: 2, lieu_pickup: pickup, de: "", vers: dropoff }) });
      const r2 = await V.ajouterParCarte(c2, "Service ajouté au dossier.");
      assert.equal(r2.ok, true, `${quoi} : ${r2.motif}`);
      comparer(ecrite(r2.reservation.id), { ...AUTRES, enfants: 2, lieu_pickup: pickup, drop_off: dropoff, partenaire_id: slug === "taxi" ? (chauffeur() || {}).id || null : null }, `reservation ${quoi}`);
    }
  }
});

test("un pickup explicite égal ou proche du drop-off n'est jamais vidé ni remplacé", async () => {
  const p = await catalogueProd("taxi");
  for (const [pickup, dropoff] of [["Resort Exemple", "Resort Exemple"], ["Koh Lanta", "Koh Lanta Pier"], ["Ao Nang Beach", "Ao Nang"]]) {
    const c = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", p["Ao Nang"].id), lieu_pickup: pickup, de: "", vers: dropoff })], { hotel: "Resort Exemple" }));
    comparer(reservationsDu((await validerDossier(c)).dossier.id)[0], { lieu_pickup: pickup, drop_off: dropoff }, `dossier ${pickup} → ${dropoff}`);
    const dossier = await E.inserer("dossiers", { ref: `P-${++n}`, client_id: null, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
    const c2 = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", dossier.id), service: service({ ref: refDe("P", p["Ao Nang"].id), enfants: 2, lieu_pickup: pickup, de: "", vers: dropoff }) });
    comparer(ecrite((await V.ajouterParCarte(c2, "ok")).reservation.id), { lieu_pickup: pickup, drop_off: dropoff }, `reservation ${pickup} → ${dropoff}`);
  }
});

// L'onglet Assistant (views/agent.mjs) tel quel, avec une conversation de test et ses cartes, servies par le magasin de démo comme celles de
// la base ; le statut d'une carte décidée y est noté. Rend { vue, cartes, carteVue, fin }.
let convs = 0;
async function ongletAvec(liste) {
  await E.enregistrerReglages({ ...E.reglages(), agent_ia: true });
  const conv = { id: `conv-lieux-${++convs}`, entite_id: E.etat.entiteId, user_id: E.etat.moi.user_id, titre: "Lieux", apercu: "", dossier_id: null, statut: "ouverte", cree_le: new Date().toISOString(), maj_le: new Date().toISOString() };
  const cartes = liste.map((x, i) => ({ ...x, id: `${conv.id}-carte-${i}`, conversation_id: conv.id, cree_le: new Date(Date.now() + i).toISOString() }));
  const st = E.etat.store;
  const origines = Object.fromEntries(["agentConversations", "agentFil", "agentAttente", "agentCarte", "agentMajConversation", "agentNoterApprentissages"].map((k) => [k, st[k]]));
  const nos = (id) => id === conv.id || cartes.some((x) => x.id === id);
  st.agentConversations = async (e) => [...(await origines.agentConversations.call(st, e)), conv];
  st.agentFil = async (id) => (id === conv.id ? { messages: [], cartes: structuredClone(cartes) } : origines.agentFil.call(st, id));
  st.agentAttente = async (e) => [...(await origines.agentAttente.call(st, e)), ...(cartes.some((x) => x.statut === "proposee") ? [{ conversation_id: conv.id }] : [])];
  st.agentCarte = async (id, statut) => {
    if (!nos(id)) return origines.agentCarte.call(st, id, statut);
    const x = cartes.find((y) => y.id === id);
    Object.assign(x, { statut, decide_le: new Date().toISOString() });
    return structuredClone(x);
  };
  st.agentMajConversation = async (id, patch) => (nos(id) ? Object.assign(conv, patch) : origines.agentMajConversation.call(st, id, patch));
  st.agentNoterApprentissages = async (...a) => (nos(a[1]) ? [] : origines.agentNoterApprentissages.call(st, ...a));
  const { vueAgent } = await import("../src/gestion/js/views/agent.mjs");
  const vue = await vueAgent(conv.id);
  dom.document.body.append(vue);
  await dom.attendre(30);
  // La carte affichée : l'élément qui porte data-carte (relu à chaque fois : la carte se redessine).
  const carteVue = (x) => vue.querySelector(`[data-carte="${cartes[liste.indexOf(x)].id}"]`);
  const principal = (x) => carteVue(x).querySelector("button.principal");
  const champ = (x, cle) => carteVue(x).querySelectorAll("input.agent-lieu-champ").find((e) => e.getAttribute("data-lieu").endsWith(`:${cle}`));
  const fin = () => (Object.assign(st, origines), vue.remove());
  return { vue, cartes, carteVue, principal, champ, fin };
}

test("carte sans pickup ou sans drop-off : la fonction et l'écran le disent, rien n'est deviné, la validation attend le champ rempli", async () => {
  const p = await catalogueProd("taxi");
  // La fonction de l'Assistant : un transfert sans lieu porte l'avertissement (l'Assistant pose la question).
  const sansPickup = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", p["Krabi Airport"].id), lieu_pickup: "", de: "", vers: "Resort Exemple" })], { hotel: "Resort Exemple" }));
  const sansDepose = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", p["Ao Nang"].id), lieu_pickup: "Resort Exemple", de: "", vers: "" })], { hotel: "Resort Exemple" }));
  const complete = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", p["Pakbara Pier"].id), lieu_pickup: "Pakbara Pier", de: "", vers: "Resort Exemple" })], { hotel: "Resort Exemple" }));
  const dossierAjout = await E.inserer("dossiers", { ref: `S-${++n}`, client_id: null, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
  const ajoutSans = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", dossierAjout.id), service: service({ ref: refDe("P", p["Krabi Airport"].id), enfants: 2, lieu_pickup: "", de: "", vers: "" }) });
  assert.ok(sansPickup.avertissements.includes("pickup_a_verifier") && !sansPickup.avertissements.includes("dropoff_a_verifier"));
  assert.ok(sansDepose.avertissements.includes("dropoff_a_verifier") && !sansDepose.avertissements.includes("pickup_a_verifier"));
  assert.ok(ajoutSans.avertissements.includes("pickup_a_verifier") && ajoutSans.avertissements.includes("dropoff_a_verifier"));
  // Rien n'est deviné : la réservation préparée garde les lieux vides (ni l'hôtel, ni le libellé du tarif).
  const vide = reservationDepuisCarte(ajoutSans.donnees, V.optionsCarte(ajoutSans));
  assert.equal(vide.lieu_pickup, "");
  assert.equal((vide.details || {}).drop_off, undefined);
  const o = await ongletAvec([sansPickup, sansDepose, complete, ajoutSans]);
  try {
    assert.match(o.carteVue(sansPickup).textContent, /Pickup à vérifier/);
    assert.match(o.carteVue(sansDepose).textContent, /Drop-off à vérifier/);
    assert.doesNotMatch(o.carteVue(complete).textContent, /à vérifier/);
    // Le champ à remplir, sous le service, seulement pour ce qui manque ; le bouton de la carte attend, « Vérifier avant » reste là.
    assert.ok(o.champ(sansPickup, "lieu_pickup") && !o.champ(sansPickup, "vers"));
    assert.ok(o.champ(sansDepose, "vers") && !o.champ(sansDepose, "lieu_pickup"));
    assert.ok(!o.carteVue(complete).querySelector("input.agent-lieu-champ"));
    assert.equal(o.principal(sansPickup).disabled, true);
    assert.equal(o.principal(sansPickup).textContent, "Créer le dossier");
    assert.ok(dom.boutons("Vérifier avant", o.carteVue(sansPickup)).length, "« Vérifier avant » reste disponible");
    assert.equal(o.principal(ajoutSans).disabled, true);
    assert.equal(o.principal(complete).disabled, false);
    // « Tout valider » avant la saisie : la carte complète crée son dossier, les cartes sans lieu restent à valider, avec le motif, sans rien écrire.
    const avant = ecrits.length;
    dom.boutons("Tout valider").slice(-1)[0].click();
    await dom.attendre(120);
    assert.equal(ecrits.slice(avant).filter((e) => e.op === "inserer" && e.table === "dossiers").length, 1, "seule la carte complète crée un dossier");
    assert.equal(ecrits.slice(avant).filter((e) => e.op === "inserer" && e.table === "reservations").length, 1, "aucune réservation pour les cartes sans lieu");
    assert.match(o.carteVue(sansPickup).textContent, /Pickup ou drop-off à compléter/);
    assert.deepEqual(o.cartes.map((x) => x.statut), ["proposee", "proposee", "validee", "proposee"]);
    // La saisie débloque la carte simple : le lien est retiré, le dossier se crée avec le pickup tapé.
    dom.saisir(o.champ(sansPickup, "lieu_pickup"), "Villa Exemple https://maps.app.goo.gl/exemple3");
    await dom.attendre(5);
    assert.equal(o.principal(sansPickup).disabled, false, "débloquée dès que le champ est rempli");
    assert.equal(dom.document.activeElement && dom.document.activeElement.getAttribute("data-lieu"), o.champ(sansPickup, "lieu_pickup").getAttribute("data-lieu"), "le curseur reste dans le champ");
    const a1 = ecrits.length;
    o.principal(sansPickup).click();
    await dom.attendre(120);
    const r1 = ecrits.slice(a1).find((e) => e.op === "inserer" && e.table === "reservations");
    assert.ok(r1, "réservation créée");
    comparer(ecrite(r1.id), { lieu_pickup: "Villa Exemple", drop_off: "Resort Exemple" }, "carte simple, pickup saisi");
    // La carte « reservation » : les deux champs, puis l'ajout au dossier.
    dom.saisir(o.champ(ajoutSans, "lieu_pickup"), "Krabi Airport");
    assert.equal(o.principal(ajoutSans).disabled, true, "il manque encore le drop-off");
    dom.saisir(o.champ(ajoutSans, "vers"), "Resort Exemple");
    await dom.attendre(5);
    assert.equal(o.principal(ajoutSans).disabled, false);
    const a2 = ecrits.length;
    o.principal(ajoutSans).click();
    await dom.attendre(120);
    const r2 = ecrits.slice(a2).find((e) => e.op === "inserer" && e.table === "reservations");
    assert.ok(r2, "service ajouté");
    comparer(ecrite(r2.id), { lieu_pickup: "Krabi Airport", drop_off: "Resort Exemple", partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "carte reservation, lieux saisis");
    assert.equal(ecrite(r2.id).dossier_id, dossierAjout.id);
  } finally {
    o.fin();
  }
});

test("carte mixte sans drop-off : le champ sur la carte, bloquée avant la saisie, puis les deux dossiers avec la dépose tapée", async () => {
  const cs = await catalogueProd("excursions");
  const ct = await catalogueProd("taxi");
  dans("excursions");
  const s1 = (await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", cs["Krabi Airport"].id), lieu_pickup: "Resort Exemple", vers: "", de: "" })]))).donnees.services[0];
  dans("taxi");
  const base = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", ct["Ao Nang"].id), lieu_pickup: "Villa Exemple", vers: "Hotel Plage Exemple", de: "" })]));
  const donnees = { ...base.donnees, services: [{ ...s1, entite_id: entite("excursions").id, entreprise: "secret" }, { ...base.donnees.services[0], entite_id: entite("taxi").id, entreprise: "taxi" }], entreprises: ["secret", "taxi"] };
  const mixte = { ...base, donnees, avertissements: ["dropoff_a_verifier"] };
  for (const [a, b] of [["excursions", "taxi"], ["taxi", "excursions"]]) await E.etat.store.partagerClients(entite(a).id, entite(b).id, true);
  await E.recharger();
  dans("taxi");
  const o = await ongletAvec([mixte]);
  try {
    assert.match(o.carteVue(mixte).textContent, /Drop-off à vérifier/);
    assert.ok(o.champ(mixte, "vers"), "le champ du drop-off, sous le service de Secret");
    assert.equal(o.principal(mixte).textContent, "Créer les deux dossiers");
    assert.equal(o.principal(mixte).disabled, true, "bloquée avant la saisie");
    const avant = ecrits.length;
    dom.saisir(o.champ(mixte, "vers"), "Marina Exemple");
    await dom.attendre(5);
    assert.equal(o.principal(mixte).disabled, false);
    o.principal(mixte).click();
    await dom.attendre(200);
    const dossiers = ecrits.slice(avant).filter((e) => e.op === "inserer" && e.table === "dossiers");
    assert.equal(dossiers.length, 2, "deux dossiers liés");
    const resas = ecrits.slice(avant).filter((e) => e.op === "inserer" && e.table === "reservations").map((e) => ecrite(e.id));
    const parEntreprise = (slug) => resas.find((r) => r.entite_id === entite(slug).id);
    comparer(parEntreprise("excursions"), { lieu_pickup: "Resort Exemple", drop_off: "Marina Exemple" }, "dossier Secret, dépose tapée");
    comparer(parEntreprise("taxi"), { lieu_pickup: "Villa Exemple", drop_off: "Hotel Plage Exemple" }, "dossier Taxi, lieux de la carte");
  } finally {
    o.fin();
  }
});

test("excursion chez Taxi (aller-retour) : le pickup est exigé, jamais le drop-off ; la fonction et l'écran disent la même chose", async () => {
  dans("taxi");
  const excursion = await E.inserer("prestations", { famille: "excursion", groupe: "Private Taxi", libelle: "Old Town tour", libelle_en: "Old Town tour", prix_vente: 1800, unite: "veh", actif: true });
  const sansDepose = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", excursion.id), texte: "Old Town tour", lieu_pickup: "Resort Exemple", de: "", vers: "", vol: "" })]));
  assert.ok(!(sansDepose.avertissements || []).includes("dropoff_a_verifier"), "fonction : pas de drop-off exigé");
  assert.deepEqual(lieuxAVerifier(sansDepose, { prestations: E.etat.brut.prestations, taxi: true }), [], "écran : rien à remplir");
  const r = await validerDossier(sansDepose);
  assert.equal(r.ok, true, r.motif);
  comparer(reservationsDu(r.dossier.id)[0], { lieu_pickup: "Resort Exemple", drop_off: undefined }, "excursion Taxi");
  const sansPickup = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", excursion.id), texte: "Old Town tour", lieu_pickup: "", de: "", vers: "", vol: "" })]));
  assert.deepEqual((sansPickup.avertissements || []).filter((a) => a.endsWith("_a_verifier")), ["pickup_a_verifier"]);
  assert.deepEqual(lieuxAVerifier(sansPickup, { prestations: E.etat.brut.prestations, taxi: true }), ["pickup_a_verifier"]);
  // Un transfert chez Taxi exige toujours les deux.
  const p = await catalogueProd("taxi");
  const transfert = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", p["Ao Nang"].id), lieu_pickup: "Resort Exemple", de: "", vers: "" })]));
  assert.deepEqual(lieuxAVerifier(transfert, { prestations: E.etat.brut.prestations, taxi: true }), ["dropoff_a_verifier"]);
});

// ---- 2. Carte « dossier », transfert libre ------------------------------------------------------------------------------------
test("2. carte « dossier », transfert hors catalogue : dépose, pickup, prix tapé, chauffeur et le reste arrivent sur la réservation", async () => {
  dans("taxi");
  const c = await carteDe("proposer_dossier", dossierCarte([service({ texte: "Private transfer" })]));
  assert.equal(c.donnees.services[0].offre, null);
  const r = await validerDossier(c);
  assert.equal(r.ok, true, r.motif);
  const [resa] = reservationsDu(r.dossier.id);
  comparer(resa, { ...DE_LA_CARTE, bebes: 1, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "libre");
  assert.match(resa.libelle, /Villa Exemple.*Hotel Plage Exemple/, "le libellé dit les deux bouts");
  // Sans lieu de pickup, un transfert libre garde son départ lu (« de »), comme sur origin/master ; la carte le signale (pickup_a_verifier).
  const c2 = await carteDe("proposer_dossier", dossierCarte([service({ texte: "Private transfer", lieu_pickup: "" })], { hotel: "Resort Exemple" }));
  const r2 = await validerDossier(c2);
  assert.equal(reservationsDu(r2.dossier.id)[0].lieu_pickup, "Koh Exemple");
});

// ---- 3. Carte mixte : deux dossiers liés (espace unifié) -----------------------------------------------------------------------
test("3. carte mixte : validerUnifie crée deux dossiers liés, chacun avec les champs de ses propres services", async () => {
  const cs = await catalogueDe("excursions");
  const ct = await catalogueDe("taxi");
  // La carte de l'espace unifié : chaque service porte son entreprise (celle de son catalogue).
  dans("excursions");
  const s1 = (await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", cs.tour.id), texte: "Tour", date: "2026-12-04", heure_pickup: "08:00", lieu_pickup: "Resort Exemple", vers: "Marina Exemple", vol: "", bagages: 0, sieges: 0, sieges_bebe: 0, prix_saisi: "", enfants: 0 })]))).donnees.services[0];
  dans("taxi");
  const base = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", ct.transfert.id) })]));
  const s2 = base.donnees.services[0];
  const donnees = { ...base.donnees, services: [{ ...s1, entite_id: entite("excursions").id, entreprise: "secret" }, { ...s2, entite_id: entite("taxi").id, entreprise: "taxi" }], entreprises: ["secret", "taxi"] };
  const c = { ...base, donnees };
  // Le partage réciproque des fiches Secret et Taxi (migration 63, posé par la base pour Zwald ; la démo le pose à la première carte mixte).
  for (const [a, b] of [["excursions", "taxi"], ["taxi", "excursions"]]) await E.etat.store.partagerClients(entite(a).id, entite(b).id, true);
  await E.recharger();
  dans("taxi");
  const r = await V.validerUnifie(c, { donnees, libelleEntreprise: (id) => id });
  assert.equal(r.ok, true, r.motif);
  assert.equal(r.dossiers.length, 2);
  const [dS, dT] = ["excursions", "taxi"].map((slug) => r.dossiers.find((d) => d.entite_id === entite(slug).id));
  assert.equal(E.etat.brut.dossiers.find((d) => d.id === dS.id).dossier_lie_id, dT.id, "liés des deux côtés");
  assert.equal(E.etat.brut.dossiers.find((d) => d.id === dT.id).dossier_lie_id, dS.id);
  const [rS] = reservationsDu(dS.id);
  const [rT] = reservationsDu(dT.id);
  // Une excursion sans tarif enfant compte les enfants au tarif adulte (règle de la facture, « enfant_plein_tarif ») : ce service n'en a pas.
  comparer(rS, { drop_off: "Marina Exemple", lieu_pickup: "Resort Exemple", heure_pickup: "08:00", vol: undefined, bagages: undefined, remarques: REMARQUE, adultes: 2, enfants: 0, bebes: 1, montant_vente: s1.prix, partenaire_id: null }, "dossier Secret");
  comparer(rT, { ...DE_LA_CARTE, bebes: 1, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "dossier Taxi");
});

// ---- 4. Carte « reservation » : la fenêtre de réservation, enregistrée telle quelle ------------------------------------------
test("4. carte « reservation » : formulaireReservation par enregistrerReservation, avec le chauffeur, le règlement et le lieu du dossier", async () => {
  const { transfert } = await catalogueDe("taxi");
  dans("taxi");
  const client = await E.inserer("clients", { civilite: "", prenom: "Client", nom: "Exemple R", adresse: "Resort Exemple", telephone: "+41790001999", email: "", notes: "" });
  const dossier = await E.inserer("dossiers", { ref: "T-RES", client_id: client.id, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
  const c = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", dossier.id), service: service({ ref: refDe("P", transfert.id), enfants: 2 }) });
  const r = await V.enregistrerReservation(reservationDepuisCarte(c.donnees, V.optionsCarte(c)), "Service ajouté au dossier.");
  assert.equal(r.ok, true, r.motif);
  // Deux enfants pour un child seat et un baby seat (une carte « reservation » n'a pas les bébés du dossier).
  comparer(ecrite(r.reservation.id), { ...DE_LA_CARTE, enfants: 2, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "ajout");
  assert.equal(ecrite(r.reservation.id).dossier_id, dossier.id);
  // Sans lieu de pickup : rien n'est deviné (ni le lieu du dossier, ni l'hôtel, ni le départ) ; la carte le signale.
  const c2 = await carteDe("proposer_reservation", { titre: "Ajout", dossier: refDe("D", dossier.id), service: service({ ref: refDe("P", transfert.id), lieu_pickup: "", enfants: 2 }) });
  assert.ok(c2.avertissements.includes("pickup_a_verifier"));
  assert.equal(reservationDepuisCarte(c2.donnees, V.optionsCarte(c2)).lieu_pickup, "");
});

// ---- 5. Carte « modification » : chaque champ, par la même fenêtre ---------------------------------------------------------------
test("5. carte « modification » : chaque champ proposé arrive par modifier, le reste ne bouge pas", async () => {
  const { transfert } = await catalogueDe("taxi");
  dans("taxi");
  const dossier = await E.inserer("dossiers", { ref: "T-MOD", client_id: null, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
  const base = await E.inserer("reservations", { dossier_id: dossier.id, prestation_id: transfert.id, libelle: "Ao Nang", date_service: "2026-12-03", heure_pickup: "09:15", lieu_pickup: "Villa Exemple", personnes: { adultes: 2, enfants: 3 }, statut: "confirme", montant_vente: PRIX, paye_sur_place: true, details: { drop_off: "Ancien Hotel Exemple", vol: "FD1000", bagages: "1", remarques: "Old note.", sieges: 1 } });
  const cas = [
    ["drop_off", "Hotel Plage Exemple", (r) => r.details.drop_off, "Hotel Plage Exemple"],
    ["lieu_pickup", "Resort Exemple", (r) => r.lieu_pickup, "Resort Exemple"],
    ["heure_pickup", "10:45", (r) => r.heure_pickup, "10:45"],
    ["date", "2026-12-05", (r) => r.date_service, "2026-12-05"],
    ["vol", "FD3217", (r) => r.details.vol, "FD3217"],
    ["bagages", "3", (r) => r.details.bagages, "3"],
    ["sieges", "2", (r) => r.details.sieges, 2],
    ["sieges_bebe", "1", (r) => r.details.sieges_bebe, 1],
    ["sans_siege", "oui", (r) => r.details.sans_siege, true],
    ["adultes", "3", (r) => r.personnes.adultes, 3],
    ["enfants", "4", (r) => r.personnes.enfants, 4],
    ["remarque_voucher", REMARQUE, (r) => r.details.remarques, `Old note.\n${REMARQUE}`],
  ];
  for (const [champ, valeur, lu, attendu] of cas) {
    const avant = structuredClone(E.etat.brut.reservations.find((x) => x.id === base.id));
    const c = await executer("proposer_modification", { titre: "Modif", reservation: refDe("R", base.id), champ, valeur, raison: "" }, ctx(), memo(["Flight FD3217 now, 3 bags"]));
    assert.ok(c.carte, `${champ} : ${JSON.stringify(c.contenu || c)}`);
    const depuis = ecrits.length;
    const r = await V.enregistrerReservation(reservationModifiee(avant, c.carte.donnees), "Service modifié.", avant);
    assert.equal(r.ok, true, `${champ} : ${r.motif}`);
    const patchs = ecrits.slice(depuis).filter((e) => e.table === "reservations" && e.id === base.id);
    assert.ok(patchs.length, `${champ} : écrit par modifier`);
    const apres = E.etat.brut.reservations.find((x) => x.id === base.id);
    assert.deepEqual(lu(apres), attendu, champ);
    // Le reste ne bouge pas : prix, partenaire, paiement sur place, et les autres champs du voucher.
    assert.equal(apres.montant_vente, PRIX, `${champ} : prix`);
    assert.equal(apres.paye_sur_place, true, `${champ} : paiement sur place`);
    for (const k of ["drop_off", "vol", "bagages"]) if (!(champ === k || (champ === "drop_off" && k === "drop_off"))) assert.equal(apres.details[k], avant.details[k], `${champ} : details.${k}`);
  }
});

// ---- 6. « Vérifier avant » : la fiche affichée, pré-remplie, puis « Créer le dossier » ----------------------------------------
test("6. « Vérifier avant » : la fiche montre chaque champ de la carte, et la créer sans retouche ne perd rien", async () => {
  const { transfert } = await catalogueDe("taxi");
  dans("taxi");
  const c = await carteDe("proposer_dossier", dossierCarte([service({ ref: refDe("P", transfert.id) })]));
  let cree = null;
  const ouverte = await ouvrirDemande(null, V.preparation(c), { titre: c.titre, surCree: ({ dossier }) => (cree = dossier) });
  assert.equal(ouverte.ouverte, true);
  const champ = (suffixe) => dom.document.documentElement.descendants().filter((e) => e.id.endsWith(suffixe)).pop();
  assert.equal(champ("-v-drop").value, "Hotel Plage Exemple");
  assert.equal(champ("-v-lieu").value, "Villa Exemple");
  assert.equal(champ("-v-vol").value, "FD3217");
  assert.equal(champ("-v-bagages").value, "2");
  assert.equal(champ("-v-sieges").value, "1");
  assert.equal(champ("-v-sieges-bebe").value, "1");
  assert.equal(champ("-v-remarques").value, REMARQUE);
  assert.equal(champ("-heure").value, "09:15");
  const [bouton] = dom.boutons("Créer le dossier").slice(-1);
  assert.ok(bouton, "le bouton de création");
  bouton.click();
  await dom.attendre(60);
  assert.ok(cree, "dossier créé");
  comparer(reservationsDu(cree.id)[0], { ...DE_LA_CARTE, bebes: 1, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "Vérifier avant");
});

// ---- 6 bis. « Choisir dans la base » : une ligne du catalogue prise à la main reçoit aussi le chauffeur chez Taxi -------------------
test("6 bis. « Vérifier avant », « Choisir dans la base » chez Taxi : la course prise dans le catalogue va au chauffeur réglé", async () => {
  const t = await catalogueProd("taxi");
  // Les lieux de la carte restent ceux de la carte, la ligne de la base n'y touche pas.
  const c = await carteDe("proposer_dossier", dossierCarte([service({ texte: "Private transfer", lieu_pickup: "Krabi Airport", de: "", vers: "Resort Exemple", prix_saisi: "" })], { hotel: "Resort Exemple" }));
  let cree = null;
  await ouvrirDemande(null, V.preparation(c), { titre: c.titre, surCree: ({ dossier }) => (cree = dossier) });
  dom.boutons("Choisir dans la base").slice(-1)[0].click();
  await dom.attendre(10);
  // La ligne de test, sans partenaire (la démo a aussi un tarif « Krabi Airport », celui de ses chauffeurs).
  const ligne = dom.document.querySelectorAll("li.choix").filter((li) => li.querySelector("strong").textContent === "Krabi Airport" && !li.textContent.includes("Chauffeurs démo")).pop();
  assert.ok(ligne, "le trajet dans la liste du catalogue");
  ligne.querySelector(".choix-actions button").click();
  dom.boutons("Terminé").slice(-1)[0].click();
  await dom.attendre(10);
  dom.boutons("Créer le dossier").slice(-1)[0].click();
  await dom.attendre(60);
  assert.ok(cree, "dossier créé");
  const [resa] = reservationsDu(cree.id);
  assert.equal(resa.prestation_id, t["Krabi Airport"].id);
  comparer(resa, { lieu_pickup: "Krabi Airport", drop_off: "Resort Exemple", partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "choisi dans la base");
  assert.ok(chauffeur(), "la démo de Taxi a un chauffeur réglé");
});

// ---- 7. Demande du site ------------------------------------------------------------------------------------------------------
test("7. demande du site (trajet) : la fiche lit le formulaire, et la réservation créée en garde chaque champ", async () => {
  dans("taxi");
  // Comme en production : le tarif du catalogue est « Krabi Airport » ; le formulaire du site donne le pickup et le drop-off.
  await catalogueProd("taxi");
  const texte = "Transfer request: Krabi Airport to Koh Exemple\nDate: Tue 15 Dec 2026\nPickup time: 14:30\nFlight or ferry: FD3217\nGuests: 2 adults, 1 child (age 5)\nChild seats: 1\nBags: 3\nPickup: Krabi Airport (KBV)\nDrop-off: Hotel Plage Exemple\nName: Client Exemple Site";
  let cree = null;
  ouvrirDemande({ texte, titre: "Demande", telephone: "+41790002000", prixImpose: 2800, surCree: ({ dossier }) => (cree = dossier) });
  await dom.attendre(10);
  // Un libellé d'une seule destination ne se retrouve pas d'office (comme sur origin/master) : Nani prend le tarif dans la base.
  if (dom.boutons("Choisir dans la base").length) {
    dom.boutons("Choisir dans la base").slice(-1)[0].click();
    await dom.attendre(10);
    dom.document.querySelectorAll("li.choix").filter((li) => li.querySelector("strong").textContent === "Krabi Airport" && !li.textContent.includes("Chauffeurs démo")).pop().querySelector(".choix-actions button").click();
    dom.boutons("Terminé").slice(-1)[0].click();
    await dom.attendre(10);
  }
  const [bouton] = dom.boutons("Créer le dossier").slice(-1);
  assert.ok(bouton, "le bouton de création");
  bouton.click();
  await dom.attendre(60);
  assert.ok(cree, "dossier créé");
  const [resa] = reservationsDu(cree.id);
  // Le partenaire : celui de la ligne du catalogue retenue, sinon le chauffeur réglé de Taxi.
  const ligne = E.etat.db.prestations.find((x) => x.id === resa.prestation_id) || {};
  assert.equal(ligne.libelle, "Krabi Airport");
  comparer(resa, { drop_off: "Hotel Plage Exemple", lieu_pickup: "Krabi Airport (KBV)", heure_pickup: "14:30", vol: "FD3217", bagages: "3", sieges: 1, adultes: 2, enfants: 1, montant_vente: 2800, partenaire_id: ligne.partenaire_id || (chauffeur() || {}).id || null, paye_sur_place: true }, "site");
});

// ---- 8. Carte « course » : une confirmation collée, validée d'un geste -----------------------------------------------------------
test("8. carte « course » : ouvrirConfirmation crée la course avec chaque champ de la confirmation", async () => {
  dans("taxi");
  const texte = `VIP TAXI LANTA
Name: Zelie Testeuse
Date: 03/12/2026
Pick-up time: 09:15
Pick-up location: Villa Exemple
Drop-off location: Hotel Plage Exemple
Flight: FD3217
Passengers: 2 adults, 2 children, 2 bags, 1 child seat, 1 baby seat
Price: 3000 THB
Remarks: ${REMARQUE}`;
  const r = await ouvrirConfirmation(texte, { auto: true });
  assert.equal(r.ok, true, r.motif);
  const dossier = r.fait.dossier;
  comparer(reservationsDu(dossier.id)[0], { ...DE_LA_CARTE, enfants: 2, partenaire_id: (chauffeur() || {}).id || null, paye_sur_place: true }, "course");
});

// ---- 9. Message collé chez Taxi : le pickup et le drop-off, recopiés d'une ligne étiquetée ou proposés (relectures des PR 332 et 335) ---
// Avant, lireMessage ne lisait ni le départ ni l'arrivée de « from Krabi Airport to Resort Exemple » ; avec les libellés de production (une
// seule destination), la fiche Taxi laissait le pickup vide (le voucher imprimait l'hôtel du client) et le drop-off vide. Désormais : une
// ligne étiquetée (« Pickup: », « Drop-off: ») se recopie ; le texte libre ne remplit jamais un champ, il se propose sous le champ vide
// (« Lu dans le message : … », bouton « Utiliser ») ; tant qu'un lieu manque, « Pickup à vérifier » ou « Drop-off à vérifier » et pas de
// création. Un lieu tapé par Nani n'est jamais vidé ni remplacé.
const { lireLieuxEtiquetes, lireTrajetsLibres, lireMessage: lireMsg } = await import("../src/gestion/js/demande-calc.mjs");

test("9. lireLieuxEtiquetes : seules Pickup, Pick-up, Drop-off, Dropoff, Prise en charge et Dépose se recopient, sans lien ni piège", () => {
  const cas = [
    ["Transfer request: exemple\nPickup: Hotel A Exemple\nDrop-off: Hotel B Exemple https://maps.app.goo.gl/exemple1", "Hotel A Exemple", "Hotel B Exemple"],
    ["Pick-up location: Krabi Airport (KBV)\nDropoff: Resort Exemple", "Krabi Airport (KBV)", "Resort Exemple"],
    ["Pick-up: Villa Exemple\nDrop-off: Krabi Airport", "Villa Exemple", "Krabi Airport"],
    ["Prise en charge : Resort Exemple\nDépose : Krabi Airport", "Resort Exemple", "Krabi Airport"],
    // La valeur est coupée à la virgule.
    ["Pickup: Resort Exemple, room 12\nDrop-off: Krabi Airport, domestic terminal", "Resort Exemple", "Krabi Airport"],
    // Les pièges de la relecture : rien ne se recopie sans clic.
    ["From: Pakbara Pier\nTo: Villa Exemple", "", ""],
    ["---------- Forwarded message ---------\nFrom: John Smith <john@exemple.test>\nDate: Mon, 23 Nov 2026 at 10:00\nSubject: Taxi\nTo: info@exemple.test", "", ""],
    ["Hi, we land on 15 December.\nFrom: Germany\nThanks\nTo: Nani", "", ""],
    ["Destination: Thailand holiday\nDépart : Villa Exemple", "", ""],
    ["Pickup: john@exemple.test\nDrop-off: info＠exemple.test", "", ""],
    ["Pickup: we will tell you later\nDrop-off: I need to check", "", ""],
    ["Hello, taxi from Krabi Airport to Resort Exemple on 15 December", "", ""],
    ["Pickup: our hotel\nDrop-off: the airport", "", ""],
  ];
  for (const [texte, pickup, dropoff] of cas) assert.deepEqual(lireLieuxEtiquetes(texte), { pickup, dropoff }, texte);
  // Un formulaire du site garde sa lecture exacte (Pickup, Drop-off) : ni sens ni trajet libre à côté.
  const site = lireMsg("Transfer request: Krabi Airport to Koh Exemple\nPickup: Krabi Airport\nDrop-off: Resort Exemple\nName: Client Exemple", "2026-11-23");
  assert.equal(site.sens, undefined);
  assert.equal(site.trajetsLus, undefined);
});

test("9. lireTrajetsLibres : un trajet lu après un mot de course ou en début de phrase, jamais un verbe ni un pronom (cas de la relecture)", () => {
  const cas = [
    ["Hello, we need a taxi from Krabi Airport to Resort Exemple on 15/12, 2 adults", [["Krabi Airport", "Resort Exemple"]]],
    ["Pakbara Pier → Resort Exemple, 3 adults", [["Pakbara Pier", "Resort Exemple"]]],
    ["Need a taxi Krabi Airport to Resort Exemple", [["Krabi Airport", "Resort Exemple"]]],
    ["Taxi de l'aéroport de Krabi à Resort Exemple demain", [["l'aéroport de Krabi", "Resort Exemple"]]],
    ["Hi! We would like to book a ride. From Krabi Airport. To Resort Exemple", [["Krabi Airport", "Resort Exemple"]]],
    ["Pick us up at Villa Exemple at 8:00, drop us at Krabi Airport", [["Villa Exemple", "Krabi Airport"]]],
    ["Taxi from Krabi Airport to Resort Exemple https://maps.app.goo.gl/exemple7 on 15 Dec", [["Krabi Airport", "Resort Exemple"]]],
    ["Taxi from Krabi Airport to Resort Exemple on 3 Dec and from Resort Exemple to Krabi Airport on 10 Dec", [["Krabi Airport", "Resort Exemple"], ["Resort Exemple", "Krabi Airport"]]],
    // La relecture : « Germany and want » n'est pas un pickup ; « you » non plus ; le ferry n'est pas la course ; « go » n'est pas un mot de course.
    ["I'm from Germany and want to go to Ao Nang", []],
    ["I’m from Germany and want to go to Ao Nang", []],
    ["Looking forward to hearing from you. Taxi to Ao Nang on Monday", [["", "Ao Nang"]]],
    ["We go from Koh Exemple to Ao Nang by ferry, then need a taxi to Krabi Airport", [["", "Krabi Airport"]]],
    ["We want to go to the Old Town tomorrow", []],
    // Après un mot de course aussi, un lieu qui contient un verbe ou un pronom est écarté.
    ["Taxi from where we stay to Krabi Airport", [["", "Krabi Airport"]]],
    ["Taxi from Germany and want to Ao Nang", [["", "Ao Nang"]]],
    ["We are from 10 to 12 people, need a van", []],
    ["Taxi from the airport to our hotel please", []],
    ["Can you take us to Ao Nang? We are at Resort Exemple", []],
    // « From: », « To: », « Départ : », « Destination: » : proposés, jamais recopiés ; un en-tête d'e-mail transféré ne propose rien.
    ["From: Pakbara Pier\nTo: Villa Exemple\n2 adults", [["Pakbara Pier", "Villa Exemple"]]],
    ["Départ : Villa Exemple\nDestination : Krabi Airport", [["Villa Exemple", "Krabi Airport"]]],
    ["Destination: Thailand holiday", [["", "Thailand holiday"]]],
    ["---------- Forwarded message ---------\nFrom: John Smith <john@exemple.test>\nDate: Mon, 23 Nov 2026 at 10:00\nSubject: Taxi\nTo: info@exemple.test\n\nHi, we need a taxi on 15 December, 2 adults.", []],
    ["From: Client Exemple\nSent: Monday\nTo: Agence Exemple\nSubject: Taxi\n\nTaxi from Krabi Airport to Resort Exemple please", [["Krabi Airport", "Resort Exemple"]]],
    ["From: John Smith <john＠exemple.test>\nTo: info＠exemple.test", []],
  ];
  for (const [texte, attendu] of cas) assert.deepEqual(lireTrajetsLibres(texte), attendu.map(([pickup, dropoff]) => ({ pickup, dropoff })), texte);
});

// Coller un message dans la fiche, comme une demande à confirmer (views/demande.mjs, lire), et la piloter. `clientId` : un client connu.
let collage = 0;
async function coller(slug, texte, { telephone } = {}) {
  dans(slug);
  let cree = null;
  const avant = new Set(dom.document.querySelectorAll(".modal-corps.demande"));
  ouvrirDemande({ texte, titre: "Message collé", telephone: telephone || `+4179000${3000 + ++collage}`, surCree: ({ dossier }) => (cree = dossier) });
  await dom.attendre(10);
  // La fiche qui vient de s'ouvrir : les fiches des tests précédents restent dans le DOM minimal.
  const racine = dom.document.querySelectorAll(".modal-corps.demande").filter((x) => !avant.has(x)).pop();
  assert.ok(racine, "la fiche s'ouvre");
  const fenetre = () => racine.closest("dialog") || racine.parentElement || racine;
  const parFin = (el, suffixe) => el.descendants().filter((e) => e.id && e.id.endsWith(suffixe));
  const fiche = {
    racine,
    champ: (suffixe) => parFin(racine, suffixe).pop(),
    services: () => racine.querySelectorAll("li.dsv"),
    dansService: (li, suffixe) => parFin(li, suffixe).pop(),
    alertes: () => racine.querySelectorAll(".dsv-alertes").map((x) => x.textContent).join(" "),
    propositions: () => racine.querySelectorAll(".dsv-proposition"),
    erreur: () => (fenetre().querySelectorAll("p.erreur-form").filter((p) => p.textContent).pop() || { textContent: "" }).textContent,
    // Un libellé d'une seule destination ne se retrouve pas toujours d'office : Nani le prend dans la base, comme en production.
    async prendre(libelle, li = null) {
      const dans_ = li || racine;
      if (!dom.boutons("Choisir dans la base", dans_).length || parFin(dans_, "-v-lieu").length) return;
      dom.boutons("Choisir dans la base", dans_).slice(-1)[0].click();
      await dom.attendre(10);
      const choix = dom.document.querySelectorAll("li.choix").filter((x) => x.querySelector("strong").textContent === libelle && !x.textContent.includes("Chauffeurs démo")).pop();
      assert.ok(choix, `le tarif « ${libelle} » dans la base`);
      choix.querySelector(".choix-actions button").click();
      dom.boutons("Terminé").slice(-1)[0].click();
      await dom.attendre(10);
    },
    async creer() {
      dom.boutons("Créer le dossier", fenetre()).slice(-1)[0].click();
      await dom.attendre(60);
      return cree;
    },
  };
  return fiche;
}
const pickupDrop = (f) => ({ pickup: f.champ("-v-lieu").value, dropoff: f.champ("-v-drop").value });
const blocOuvert = (f) => {
  const bloc = f.champ("-v-lieu").closest("details");
  return bloc.open === true || [null, undefined].indexOf(bloc.getAttribute("open")) < 0;
};

// Les cas demandés, en texte libre : [cas, message, tarif de production, pickup proposé, drop-off proposé]
const SENS = [
  ["arrivée aéroport vers hôtel", "Hello! We land on 15 December, flight FD3217. Please a taxi from Krabi Airport to Resort Exemple at 14:30, 2 adults. My name is Client Exemple Arrivee", "Krabi Airport", "Krabi Airport", "Resort Exemple"],
  ["départ hôtel vers aéroport", "Hi, taxi from Resort Exemple to Krabi Airport on 18 December at 9am, 2 adults. My name is Client Exemple Depart", "Krabi Airport", "Resort Exemple", "Krabi Airport"],
  ["embarcadère vers hôtel", "Pakbara Pier → Villa Exemple on 16 December at 11:00, 3 adults. My name is Client Exemple Ponton", "Pakbara Pier", "Pakbara Pier", "Villa Exemple"],
  ["trajet entre deux îles", "Hello, private transfer from Koh Exemple to Koh Autre Exemple on 20 December at 10:00, 4 adults. My name is Client Exemple Iles", "Koh Autre Exemple", "Koh Exemple", "Koh Autre Exemple"],
  ["message avec un lien Maps", "Taxi from Krabi Airport to Hotel Plage Exemple https://maps.app.goo.gl/exemple7 on 15 December at 14:30, 2 adults. My name is Client Exemple Lien", "Krabi Airport", "Krabi Airport", "Hotel Plage Exemple"],
];
for (const [cas, texte, tarif, pickup, dropoff] of SENS) {
  test(`9. Taxi, texte libre (${cas}) : rien de prérempli, la proposition « Utiliser » remplit les deux champs, la réservation les garde`, async () => {
    await catalogueProd("taxi");
    // Le tarif d'une île (une seule destination, comme en production), inventé pour ce cas.
    if (tarif === "Koh Autre Exemple" && !E.etat.db.prestations.some((p) => p.libelle === tarif)) await E.inserer("prestations", { famille: "transfert", groupe: "Private Taxi", libelle: tarif, libelle_en: tarif, prix_vente: 3500, unite: "veh", actif: true });
    const f = await coller("taxi", texte);
    await f.prendre(tarif);
    assert.deepEqual(pickupDrop(f), { pickup: "", dropoff: "" }, "le texte libre ne remplit rien");
    assert.ok(blocOuvert(f), "le bloc du voucher est ouvert");
    assert.match(f.alertes(), /Pickup à vérifier/);
    const [prop] = f.propositions().slice(-1);
    assert.ok(prop, "la proposition sous le champ");
    assert.ok(prop.parentElement.contains(f.champ("-v-lieu")), "sous le champ du pickup, dans le bloc du voucher");
    assert.match(f.alertes(), /utilisez le trajet lu dans le message/);
    assert.equal(prop.querySelector("span").textContent, `Lu dans le message : ${pickup} → ${dropoff}`);
    assert.doesNotMatch(prop.textContent, /https?:|goo\.gl/, "sans lien");
    const avant = ecrits.length;
    assert.equal(await f.creer(), null, "rien n'est créé avant le clic");
    assert.equal(ecrits.length, avant);
    prop.querySelector("button").click();
    await dom.attendre(2);
    assert.deepEqual(pickupDrop(f), { pickup, dropoff }, "le clic remplit les deux champs");
    assert.doesNotMatch(f.alertes(), /à vérifier/);
    assert.equal(f.propositions().length, 0, "la proposition s'en va");
    const cree = await f.creer();
    assert.ok(cree, f.erreur());
    comparer(reservationsDu(cree.id)[0], { lieu_pickup: pickup, drop_off: dropoff }, cas);
  });
}

test("9. Taxi, lignes étiquetées : « Pickup: » et « Drop-off: » se recopient, sans proposition, et la réservation les garde", async () => {
  await catalogueProd("taxi");
  const f = await coller("taxi", "Taxi booking 15 December 14:30, 2 adults\nPickup: Krabi Airport (KBV)\nDrop-off: Resort Exemple https://maps.app.goo.gl/exemple2\nMy name is Client Exemple Etiquettes");
  // La ligne « Pickup: Krabi Airport (KBV) » n'est pas un second service : elle part décochée.
  const [course, ...autres] = f.services();
  assert.ok(autres.every((x) => !x.querySelector('input[type="checkbox"]').checked), "la ligne étiquetée n'est pas une seconde course");
  await f.prendre("Krabi Airport", course);
  assert.deepEqual({ pickup: f.dansService(course, "-v-lieu").value, dropoff: f.dansService(course, "-v-drop").value }, { pickup: "Krabi Airport (KBV)", dropoff: "Resort Exemple" });
  assert.equal(f.propositions().length, 0);
  assert.doesNotMatch(f.alertes(), /à vérifier/);
  const cree = await f.creer();
  assert.ok(cree, f.erreur());
  comparer(reservationsDu(cree.id)[0], { lieu_pickup: "Krabi Airport (KBV)", drop_off: "Resort Exemple" }, "étiquetées");
});

test("9. Taxi, cas de la relecture : « I'm from Germany… », « hearing from you », le ferry, l'Old Town ne proposent jamais un faux lieu", async () => {
  await catalogueProd("taxi");
  const cas = [
    ["Hi, I'm from Germany and want to go to Ao Nang on 15 December at 10:00, 2 adults. We stay at Resort Exemple. My name is Client Exemple G", "Ao Nang", null],
    ["Looking forward to hearing from you. Taxi to Ao Nang on 15 December at 10:00, 2 adults. My name is Client Exemple H", "Ao Nang", "? → Ao Nang"],
    ["We go from Koh Exemple to Ao Nang by ferry, then need a taxi to Krabi Airport on 15 December at 10:00, 2 adults. My name is Client Exemple F", "Krabi Airport", "? → Krabi Airport"],
    ["We want to go to the Old Town on 15 December at 10:00, 2 adults, by taxi. My name is Client Exemple O", "Ao Nang", null],
  ];
  for (const [texte, tarif, proposition] of cas) {
    const transfert = !/Old Town/.test(texte);
    const f = await coller("taxi", texte);
    await f.prendre(tarif);
    assert.deepEqual(pickupDrop(f), { pickup: "", dropoff: "" }, texte);
    assert.match(f.alertes(), /Pickup à vérifier/, texte);
    // L'Old Town peut tomber sur une excursion du catalogue : le pickup seul est alors exigé.
    if (transfert) assert.match(f.alertes(), /Drop-off à vérifier/, texte);
    const props = f.propositions();
    assert.deepEqual(props.map((x) => x.querySelector("span").textContent.replace("Lu dans le message : ", "")), proposition ? [proposition] : [], texte);
    // Le clic ne pose que le bout lu : le pickup reste à vérifier.
    if (props.length) {
      props[0].querySelector("button").click();
      await dom.attendre(2);
      assert.equal(f.champ("-v-lieu").value, "", texte);
      assert.match(f.alertes(), /Pickup à vérifier/, texte);
    }
    assert.equal(await f.creer(), null, texte);
  }
});

test("9. Taxi, e-mail transféré et lignes From/To : rien de prérempli ; l'en-tête ne propose rien, From/To se proposent", async () => {
  await catalogueProd("taxi");
  const f = await coller("taxi", "---------- Forwarded message ---------\nFrom: Client Exemple Mail <client@exemple.test>\nDate: Mon, 23 Nov 2026 at 10:00\nSubject: Taxi Krabi Airport\nTo: agence@exemple.test\n\nHi, we need a taxi on 15 December at 14:30, 2 adults. My name is Client Exemple Mail");
  await f.prendre("Krabi Airport");
  const [course] = f.services().filter((x) => x.querySelector('input[type="checkbox"]').checked);
  assert.deepEqual([f.dansService(course, "-v-lieu").value, f.dansService(course, "-v-drop").value], ["", ""], "aucun lieu tiré de l'en-tête");
  assert.equal(f.propositions().length, 0, "l'en-tête ne propose rien");
  assert.match(f.alertes(), /Pickup à vérifier/);
  const g = await coller("taxi", "Taxi booking 15 December 14:30, 2 adults\nFrom: Krabi Airport\nTo: Resort Exemple\nMy name is Client Exemple FromTo");
  const [course2] = g.services();
  await g.prendre("Krabi Airport", course2);
  assert.deepEqual([g.dansService(course2, "-v-lieu").value, g.dansService(course2, "-v-drop").value], ["", ""], "From/To ne remplissent rien");
  const prop = course2.querySelector(".dsv-proposition");
  assert.ok(prop, "From/To se proposent");
  assert.equal(prop.querySelector("span").textContent, "Lu dans le message : Krabi Airport → Resort Exemple");
  prop.querySelector("button").click();
  await dom.attendre(2);
  assert.deepEqual([g.dansService(course2, "-v-lieu").value, g.dansService(course2, "-v-drop").value], ["Krabi Airport", "Resort Exemple"]);
});

test("9. Taxi, aller-retour en deux services : chaque service reçoit sa proposition, dans l'ordre, rien de prérempli", async () => {
  await catalogueProd("taxi");
  const f = await coller("taxi", "Hello, taxi from Krabi Airport to Resort Exemple on 15 December at 14:30 and taxi from Resort Exemple to Krabi Airport on 20 December at 9:00, 2 adults. My name is Client Exemple AR");
  const li = f.services();
  assert.equal(li.length, 2, "deux services");
  // Un libellé d'une seule destination : Nani prend le tarif dans la base pour chacun.
  for (const x of li) await f.prendre("Krabi Airport", x);
  const textes = li.map((x) => (x.querySelector(".dsv-proposition span") || { textContent: "" }).textContent);
  assert.deepEqual(textes, ["Lu dans le message : Krabi Airport → Resort Exemple", "Lu dans le message : Resort Exemple → Krabi Airport"]);
  assert.deepEqual(li.map((x) => f.dansService(x, "-v-lieu").value), ["", ""]);
  for (const x of li) x.querySelector(".dsv-proposition button").click();
  await dom.attendre(2);
  assert.deepEqual(li.map((x) => [f.dansService(x, "-v-lieu").value, f.dansService(x, "-v-drop").value]), [["Krabi Airport", "Resort Exemple"], ["Resort Exemple", "Krabi Airport"]]);
  // Deux trajets lus pour un seul service : aucune proposition.
  const g = await coller("taxi", "Taxi from Krabi Airport to Resort Exemple on 3 Dec and from Resort Exemple to Krabi Airport, 2 adults. My name is Client Exemple Un");
  await g.prendre("Krabi Airport");
  if (g.services().length === 1) assert.equal(g.propositions().length, 0, "pas de proposition quand le nombre ne colle pas");
});

test("9. Taxi, message sans sens lisible : « Pickup à vérifier » et « Drop-off à vérifier », l'hôtel n'est pas pris, rien n'est créé avant la saisie", async () => {
  await catalogueProd("taxi");
  const f = await coller("taxi", "Hi, we need a taxi to the airport on 18 December at 9am, 2 adults. We stay at Resort Exemple. My name is Client Exemple Sans Sens");
  await f.prendre("Krabi Airport");
  assert.equal(dom.parId("dem-hotel").value, "Resort Exemple", "l'hôtel du client est lu");
  assert.deepEqual(pickupDrop(f), { pickup: "", dropoff: "" }, "ni l'hôtel ni le nom du tarif en pickup ou en drop-off");
  assert.ok(blocOuvert(f));
  assert.match(f.alertes(), /Pickup à vérifier/);
  assert.match(f.alertes(), /Drop-off à vérifier/);
  const avant = ecrits.length;
  assert.equal(await f.creer(), null, "rien n'est créé");
  assert.equal(ecrits.length, avant, "rien n'est écrit");
  assert.match(f.erreur(), /Pickup à vérifier/);
  dom.saisir(f.champ("-v-lieu"), "Resort Exemple, room 12");
  assert.doesNotMatch(f.alertes(), /Pickup à vérifier/);
  assert.match(f.alertes(), /Drop-off à vérifier/);
  assert.equal(await f.creer(), null);
  assert.match(f.erreur(), /Drop-off à vérifier/);
  dom.saisir(f.champ("-v-drop"), "Krabi Airport, domestic terminal");
  assert.doesNotMatch(f.alertes(), /à vérifier/);
  const cree = await f.creer();
  assert.ok(cree, f.erreur());
  comparer(reservationsDu(cree.id)[0], { lieu_pickup: "Resort Exemple, room 12", drop_off: "Krabi Airport, domestic terminal" }, "sans sens");
});

test("9. Taxi : un lieu tapé par Nani n'est jamais vidé ni remplacé, ni par « Utiliser » ni quand le service change d'offre", async () => {
  await catalogueProd("taxi");
  const f = await coller("taxi", "Taxi from Krabi Airport to Resort Exemple on 15 December at 14:30, 2 adults. My name is Client Exemple Garde");
  await f.prendre("Krabi Airport");
  dom.saisir(f.champ("-v-lieu"), "Krabi Airport, arrivals gate 3");
  const [prop] = f.propositions().slice(-1);
  prop.querySelector("button").click();
  await dom.attendre(2);
  assert.deepEqual(pickupDrop(f), { pickup: "Krabi Airport, arrivals gate 3", dropoff: "Resort Exemple" }, "« Utiliser » ne remplit que le champ vide");
  dom.saisir(f.champ("-v-drop"), "Resort Exemple, reception");
  const choix = dom.document.querySelectorAll("select").filter((s) => s.getAttribute("aria-label") === "Service proposé").pop();
  if (choix) for (const o of choix.querySelectorAll("option")) dom.saisir(choix, o.value);
  assert.deepEqual(pickupDrop(f), { pickup: "Krabi Airport, arrivals gate 3", dropoff: "Resort Exemple, reception" });
  const cree = await f.creer();
  assert.ok(cree, f.erreur());
  comparer(reservationsDu(cree.id)[0], { lieu_pickup: "Krabi Airport, arrivals gate 3", drop_off: "Resort Exemple, reception" }, "saisi par Nani");
});

test("9. Taxi, excursion d'un client connu : le pickup est son hôtel (lieuParDefaut, comme sur master), la fiche ne bloque pas", async () => {
  await catalogueProd("taxi");
  const libelle = "Full-day trip, discovery of Koh Exemple";
  if (!E.etat.db.prestations.some((p) => p.libelle === libelle)) await E.inserer("prestations", { famille: "excursion", groupe: "Taxi excursions", libelle, libelle_en: libelle, prix_vente: 2000, unite: "veh", actif: true });
  const telephone = "+41790009001";
  await E.inserer("clients", { civilite: "", prenom: "Client", nom: "Exemple Connu", adresse: "Resort Exemple", telephone, email: "", notes: "" });
  const f = await coller("taxi", "Hi, we want the full-day trip discovery of Koh Exemple on 15 December at 9:00, 2 adults. My name is Client Exemple Connu", { telephone });
  await f.prendre(libelle);
  assert.doesNotMatch(f.alertes(), /à vérifier/, "le client connu n'est pas bloqué");
  const cree = await f.creer();
  assert.ok(cree, f.erreur());
  // Comme sur master : le lieu est l'hôtel du client, écrit ou repris par le voucher (lieuParDefaut).
  assert.ok(["", "Resort Exemple"].includes(reservationsDu(cree.id)[0].lieu_pickup || ""));
  // Un nouveau client sans hôtel : le pickup de l'excursion reste à vérifier.
  const g = await coller("taxi", "Hi, we want the full-day trip discovery of Koh Exemple on 16 December at 9:00, 2 adults. My name is Client Exemple Nouveau");
  await g.prendre(libelle);
  assert.match(g.alertes(), /Pickup à vérifier/);
  assert.doesNotMatch(g.alertes(), /Drop-off à vérifier/);
});

test("9. Secret et ZTP : le même message collé ne change pas (aucun lieu recopié, aucune proposition, aucune alerte de lieu)", async () => {
  for (const slug of ["excursions", "agence"]) {
    await catalogueProd(slug);
    const f = await coller(slug, `Taxi from Krabi Airport to Resort Exemple on 15 December at 14:30, 2 adults\nPickup: Krabi Airport\nMy name is Client Exemple ${slug}`);
    await f.prendre("Krabi Airport");
    assert.equal((f.champ("-v-lieu") || { value: "" }).value, "", slug);
    assert.equal((f.champ("-v-drop") || { value: "" }).value, "", slug);
    assert.equal(f.propositions().length, 0, slug);
    assert.doesNotMatch(f.alertes(), /à vérifier/, slug);
  }
});

test("9. reservationDuService : chez Taxi, l'hôtel lu n'est le pickup que d'une excursion ; Secret et ZTP gardent leur règle", async () => {
  const { reservationDuService } = await import("../src/gestion/js/creation-voucher-calc.mjs");
  const d = { hotel: "Resort Exemple" };
  const offre = (famille) => ({ genre: "prestation", id: "p1", source: { libelle: "Ao Nang", ...(famille ? { famille } : {}) } });
  for (const f of ["", "autre", "transfert"]) assert.equal(reservationDuService({}, offre(f), { d, taxi: true }).lieu, "", `Taxi, famille « ${f} »`);
  assert.equal(reservationDuService({}, offre("excursion"), { d, taxi: true }).lieu, "Resort Exemple", "Taxi, excursion");
  assert.equal(reservationDuService({}, offre(""), { d, taxi: false }).lieu, "Resort Exemple");
  assert.equal(reservationDuService({}, offre("transfert"), { d, taxi: false }).lieu, "");
});
