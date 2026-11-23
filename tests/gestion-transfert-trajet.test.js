// Transfert d'un trajet du catalogue par la route, et une carte de l'Assistant validée une seule fois (signalé par Jérémy le 23.11.2026).
// Cas réel, rendu fictif : un trajet « Minivan + minivan » Lanta → Khao Sok, vendu à la place, recevait un billet de bateau (« Boat Ticket
// Voucher ») et s'imprimait « Private minivan » ; la même carte « dossier » a créé deux dossiers à 3 secondes d'écart (double tap).
// Par le vrai code : la démo (store-local.mjs), un DOM minimal (aides-dom.mjs), la fiche de la réservation, le voucher et l'onglet Assistant.
// Données inventées : aucun client, hôtel ni partenaire réel.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { installerDom } from "./aides-dom.mjs";

const dom = installerDom();
globalThis.location.search = "?demo";
const E = await import("../src/gestion/js/etat.mjs");
await E.init();
const O = await import("../src/gestion/js/operations-calc.mjs");
const C = await import("../src/gestion/js/creation-voucher-calc.mjs");
const { renderVoucher, vouchersDuDossier } = await import("../src/gestion/js/views/voucher.mjs");
const { formulaireReservation } = await import("../src/gestion/js/views/reservations.mjs");
const { executer, refDe } = await import("../supabase/functions/agent/outils.js");
const { tempsSimule } = await import("../supabase/functions/agent/planifier.js");
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

// Les quatre trajets du test : bateau, minivan partagé (le cas réel), minivan privé, mixte bateau puis minivan.
const TRAJETS = {
  bateau: { mode: "Speedboat", de: "Koh Exemple", vers: "Île Exemple" },
  partage: { mode: "Minivan + minivan (departs Ville Exemple at 11:30)", de: "Koh Exemple", vers: "Parc Exemple (Bus Stop)" },
  prive: { mode: "Private minivan", de: "Koh Exemple", vers: "Aéroport Exemple" },
  mixte: { mode: "Speedboat + shared van", de: "Île Exemple", vers: "Ville Exemple" },
};

// ---- Banc de démo : l'entreprise d'excursions, un partenaire, les quatre trajets --------------------------------------------------------
const entite = (slug) => E.etat.brut.entites.find((e) => e.slug === slug);
E.changerEntite(entite("excursions").id, { naviguer: false });
const partenaire = await E.inserer("partenaires", { nom: "Transferts Exemple", contact: {} });
const trajets = {};
for (const [k, t] of Object.entries(TRAJETS)) trajets[k] = await E.inserer("trajets", { partenaire_id: partenaire.id, ...t, depart: "08:00", arrivee: "14:30", prix_adulte: 850, actif: true });
const client = await E.inserer("clients", { civilite: "", prenom: "Client", nom: "Exemple Trajet", adresse: "Resort Exemple", telephone: "+41790002000", email: "", notes: "" });
const dossier = await E.inserer("dossiers", { ref: "EX-TRAJET", client_id: client.id, pays: "", bandeau: "", accepte_le: "2026-11-23", annule: false, notes: "" });
const resa = {};
for (const k of Object.keys(TRAJETS)) {
  const t = trajets[k];
  resa[k] = await E.inserer("reservations", { dossier_id: dossier.id, trajet_id: t.id, partenaire_id: partenaire.id, prestation_id: null, libelle: `${t.mode} transfer: ${t.de} → ${t.vers}, departure 08:00`, date_service: "2026-12-03", heure_pickup: "07:30", lieu_pickup: "Resort Exemple", personnes: { adultes: 1, enfants: 0, bebes: 0 }, statut: "confirme", montant_vente: 850, notes: "", paye_sur_place: false, reference_partenaire: "", details: {} });
}
const voucherDe = (id) => vouchersDuDossier(dossier.id).find((x) => x.reservation.id === id);
const texte = (n) => n.textContent.replace(/\s+/g, " ");
// La ligne « Transfer Type » du voucher : la case cochée.
const typeImprime = (v) => {
  const l = renderVoucher(v).querySelectorAll("p").find((p) => p.textContent.startsWith("Transfer Type"));
  return l ? l.querySelectorAll(".v-case").filter((x) => x.className.includes("cochee")).map((x) => x.textContent.replace("☒", "").trim()) : null;
};

test("mode d'un trajet : bateau, route ou mixte, d'après les modes réels de la base", () => {
  const m = (mode) => O.modeTrajet({ mode });
  for (const x of ["Speedboat", "Express boat", "Ferry", "Ferry + speedboat", "Speedboat + ferry"]) assert.equal(m(x), "bateau", x);
  for (const x of ["Minivan + minivan (departs Krabi Town at 11:30)", "Shared minivan", "Shared minivan, hotel drop-off included", "Minivan + bus (the 32-seat bus leaves Krabi bus terminal at 17:30)", "Minivan + minibus or bus (departs Krabi bus terminal at 10:00)", "Private minivan"]) assert.equal(m(x), "route", x);
  for (const x of ["Speedboat + shared van", "Shared van + speedboat", "Minivan + speedboat (departs Nopparat Thara at 11:20 and 16:00)", "Minivan + minivan or bus + catamaran (departs Donsak Pier at 15:00)", "Minivan + longtail", "Ferry + shared van + speedboat", "Minivan + minibus + ferry (departs Donsak Pier at 14:00)"]) assert.equal(m(x), "mixte", x);
  assert.equal(m(""), "");
  assert.equal(O.modeTrajet(null), "");
});

test("modèle et type d'un trajet : bateau → billet, minivan partagé → transfert « Shared », privé → « Private », mixte → billet", () => {
  const r = (t) => ({ trajet_id: "t1", libelle: `${t.mode} transfer: ${t.de} → ${t.vers}` });
  const t = (k) => ({ id: "t1", ...TRAJETS[k] });
  assert.equal(O.typeVoucherDeduit(r(TRAJETS.bateau), null, null, t("bateau")), "billet");
  assert.equal(O.typeVoucherDeduit(r(TRAJETS.partage), null, null, t("partage")), "transfert");
  assert.equal(O.typeVoucherDeduit(r(TRAJETS.prive), null, null, t("prive")), "transfert");
  assert.equal(O.typeVoucherDeduit(r(TRAJETS.mixte), null, null, t("mixte")), "billet");
  // Trajet inconnu (supprimé de la base, ou appel sans lui) : le billet d'avant, jamais un modèle deviné du libellé.
  assert.equal(O.typeVoucherDeduit(r(TRAJETS.partage), null, null, null), "billet");
  // Le modèle choisi sur la réservation passe toujours avant.
  assert.equal(O.typeVoucher({ ...r(TRAJETS.partage), details: { modele_voucher: "billet" } }, null, null, t("partage")), "billet");
  assert.equal(O.typeTransfert(null, r(TRAJETS.partage), t("partage")), "partage", "un trajet vendu à la place : Shared minivan d'office");
  assert.equal(O.typeTransfert(null, r(TRAJETS.prive), t("prive")), "minivan");
  assert.equal(O.typeTransfert(null, r(TRAJETS.prive), { ...t("prive"), mode: "Private taxi" }), "taxi");
  assert.equal(O.typeTransfert(null, r(TRAJETS.mixte), t("mixte")), "partage");
  // Sans trajet : la règle d'avant (groupe de la prestation et libellé).
  assert.equal(O.typeTransfert({ groupe: "Private Taxi" }, { libelle: "Krabi Airport" }), "taxi");
  assert.equal(O.typeTransfert(null, { libelle: "Shared minivan to Krabi" }), "partage");
  assert.equal(O.typeTransfert(null, { libelle: "Minivan to Krabi" }), "minivan");
  // À la création : le service d'un trajet par la route demande les champs du transfert (dont le type), avec l'automatique « partage ».
  const [sv] = C.servicesCreation([{ id: "l1", kind: "ligne", libelle: r(TRAJETS.partage).libelle, trajet_id: "t1", quantite: 1, prix: 850 }], { trajets: [t("partage")] });
  assert.equal(sv.type, "transfert");
  assert.equal(sv.transfertAuto, "partage");
  assert.ok(C.champsCreation(sv).includes("type_transfert"));
});

test("voucher : chaque trajet reçoit son modèle et son type, sans rien choisir", () => {
  assert.equal(voucherDe(resa.bateau.id).type, "billet");
  assert.equal(voucherDe(resa.mixte.id).type, "billet");
  assert.equal(voucherDe(resa.partage.id).type, "transfert");
  assert.equal(voucherDe(resa.prive.id).type, "transfert");
  assert.match(texte(renderVoucher(voucherDe(resa.partage.id))), /Transfer Voucher/);
  assert.deepEqual(typeImprime(voucherDe(resa.partage.id)), ["Shared Minivan"], "le cas réel : Shared minivan d'office");
  assert.deepEqual(typeImprime(voucherDe(resa.prive.id)), ["Private Minivan"]);
  assert.match(texte(renderVoucher(voucherDe(resa.bateau.id))), /Boat Ticket Voucher/);
});

test("fiche : « Automatique » dit ce qui s'imprime, le choix « Shared minivan » est gardé à l'enregistrement et imprimé", async () => {
  // Un trajet privé où Nani choisit « Shared minivan » à la main (le choix passe avant l'automatique).
  let fini = null;
  const form = formulaireReservation(E.etat.db.reservations.find((r) => r.id === resa.prive.id), (r) => (fini = r));
  dom.document.body.append(form);
  await dom.attendre(10);
  const choix = form.querySelector("#v-transfert");
  assert.ok(choix, "le champ « Type de transfert » est dans la fiche d'un trajet par la route");
  assert.equal(choix.value, "");
  assert.equal(choix.querySelectorAll("option")[0].textContent, "Auto : Private minivan");
  assert.deepEqual(choix.querySelectorAll("option").map((o) => o.value), ["", "taxi", "minivan", "partage"]);
  dom.choisir ? dom.choisir(choix, "partage") : ((choix.value = "partage"), choix.dispatchEvent(new Event("change")));
  form.querySelector("button[type=submit]").click();
  await dom.attendre(40);
  form.remove();
  const r = E.etat.db.reservations.find((x) => x.id === resa.prive.id);
  assert.ok(fini !== null, "la fiche s'est enregistrée");
  assert.equal(r.details.type_transfert, "partage", "le choix est gardé");
  assert.deepEqual(typeImprime(voucherDe(resa.prive.id)), ["Shared Minivan"], "et imprimé");
  // La fiche du trajet partagé : l'automatique le dit.
  const form2 = formulaireReservation(E.etat.db.reservations.find((x) => x.id === resa.partage.id), () => {});
  dom.document.body.append(form2);
  await dom.attendre(10);
  assert.equal(form2.querySelector("#v-transfert").querySelectorAll("option")[0].textContent, "Auto : Shared minivan");
  assert.equal(form2.querySelector("#r-modele").querySelectorAll("option")[0].textContent, "Automatique : Transfer Voucher");
  form2.remove();
});

// ---- Carte « dossier » de l'Assistant : un double tap ne crée qu'un dossier -------------------------------------------------------------
// L'onglet Assistant (views/agent.mjs) tel quel, avec une conversation de test et ses cartes ; la prise d'une carte imite la base
// (migration 120 : une seule prise tant que la carte est proposée). `prises` : les cartes déjà prises « ailleurs » (autre onglet).
async function ongletAvec(liste, { prisesAilleurs = new Set() } = {}) {
  await E.enregistrerReglages({ ...E.reglages(), agent_ia: true });
  const conv = { id: `conv-double-${Date.now()}`, entite_id: E.etat.entiteId, user_id: E.etat.moi.user_id, titre: "Double", apercu: "", dossier_id: null, statut: "ouverte", cree_le: new Date().toISOString(), maj_le: new Date().toISOString() };
  const cartes = liste.map((x, i) => ({ ...x, id: `${conv.id}-carte-${i}`, conversation_id: conv.id, statut: "proposee", cree_le: new Date(Date.now() + i).toISOString() }));
  const st = E.etat.store;
  const noms = ["agentConversations", "agentFil", "agentAttente", "agentCarte", "agentMajConversation", "agentNoterApprentissages", "agentPrendreCarte", "agentRendreCarte"];
  const origines = Object.fromEntries(noms.map((k) => [k, st[k]]));
  const nos = (id) => id === conv.id || cartes.some((x) => x.id === id);
  const prises = new Set(prisesAilleurs);
  const appels = { prendre: 0, rendre: 0 };
  st.agentConversations = async (e) => [...(await origines.agentConversations.call(st, e)), conv];
  st.agentFil = async (id) => (id === conv.id ? { messages: [], cartes: structuredClone(cartes) } : origines.agentFil.call(st, id));
  st.agentAttente = async (e) => [...(await origines.agentAttente.call(st, e)), ...(cartes.some((x) => x.statut === "proposee") ? [{ conversation_id: conv.id }] : [])];
  st.agentCarte = async (id, statut) => {
    if (!nos(id)) return origines.agentCarte.call(st, id, statut);
    const x = cartes.find((y) => y.id === id);
    Object.assign(x, { statut, decide_le: new Date().toISOString() });
    return structuredClone(x);
  };
  st.agentPrendreCarte = async (id) => {
    appels.prendre++;
    const x = cartes.find((y) => y.id === id);
    if (!x || x.statut !== "proposee" || prises.has(id)) return false;
    prises.add(id);
    return true;
  };
  st.agentRendreCarte = async (id) => (appels.rendre++, prises.delete(id));
  st.agentMajConversation = async (id, patch) => (nos(id) ? Object.assign(conv, patch) : origines.agentMajConversation.call(st, id, patch));
  st.agentNoterApprentissages = async (...a) => (nos(a[1]) ? [] : origines.agentNoterApprentissages.call(st, ...a));
  const { vueAgent } = await import("../src/gestion/js/views/agent.mjs");
  const vue = await vueAgent(conv.id);
  dom.document.body.append(vue);
  await dom.attendre(30);
  const carteVue = (i) => vue.querySelector(`[data-carte="${cartes[i].id}"]`);
  const principal = (i) => carteVue(i).querySelector("button.principal");
  const fin = () => (Object.assign(st, origines), vue.remove());
  return { cartes, carteVue, principal, appels, fin };
}
let clients = 0;
async function carteTrajet() {
  const ctx = { charger: async (n) => E.etat.db[n] || [], reglages: E.reglages(), simule: tempsSimule };
  const memo = { prix: new Set(), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes: [] };
  const t = trajets.partage;
  const n = ++clients;
  const r = await executer("proposer_dossier", { titre: "Dossier Koh → Parc", client_nom: `Client Double ${n}`, client_telephone: `+4179000300${n}`, hotel: "Resort Exemple", langue: "en", adultes: 1, enfants: 0, bebes: 0, services: [{ texte: "Minivan to Parc Exemple", ref: refDe("T", t.id), date: "2026-12-04", heure_pickup: "07:30", lieu_pickup: "Resort Exemple", de: t.de, vers: t.vers, adultes: 1, enfants: 0, sieges: 0, sieges_bebe: 0, sans_siege: false, bagages: 1, prix_saisi: "850", vol: "", remarque_voucher: "", note_interne: "" }], apporteur: "" }, ctx, memo);
  assert.ok(r.carte, JSON.stringify(r.contenu || r));
  return { carte: r.carte, nom: `Client Double ${n}` };
}
const dossiersDe = (nom) => E.etat.brut.dossiers.filter((d) => {
  const c = E.etat.brut.clients.find((x) => x.id === d.client_id);
  return c && `${c.prenom} ${c.nom}`.includes(nom.split(" ").pop()) && `${c.prenom} ${c.nom}`.includes("Double");
});

test("carte « dossier » : un double clic sur « Créer le dossier » ne crée qu'un dossier, le bouton attend la fin", async () => {
  const { carte, nom } = await carteTrajet();
  const o = await ongletAvec([carte]);
  try {
    const b = o.principal(0);
    assert.equal(b.textContent, "Créer le dossier");
    b.click();
    assert.equal(b.disabled, true, "désactivé dès le premier clic");
    b.click();
    o.principal(0) && o.principal(0).click();
    await dom.attendre(200);
    assert.equal(dossiersDe(nom).length, 1, "un seul dossier");
    assert.equal(o.cartes[0].statut, "validee");
    assert.equal(o.appels.prendre, 1, "la carte n'est prise qu'une fois dans la base");
    // Le dossier du trajet partagé : un voucher de transfert, « Shared minivan » d'office.
    const [d] = dossiersDe(nom);
    const v = vouchersDuDossier(d.id)[0];
    assert.equal(v.type, "transfert");
    assert.deepEqual(typeImprime(v), ["Shared Minivan"]);
  } finally {
    o.fin();
  }
});

test("carte « dossier » déjà prise ailleurs (autre onglet, autre appareil) : rien n'est créé, le motif est sur la carte", async () => {
  const { carte, nom } = await carteTrajet();
  const o = await ongletAvec([carte], { prisesAilleurs: new Set() });
  try {
    // L'autre onglet prend la carte juste avant ce clic.
    await E.etat.store.agentPrendreCarte(o.cartes[0].id);
    o.principal(0).click();
    await dom.attendre(120);
    assert.equal(dossiersDe(nom).length, 0, "aucun dossier");
    assert.equal(o.cartes[0].statut, "proposee");
    assert.match(o.carteVue(0).textContent, /déjà en cours de validation, ou déjà validée/);
    assert.equal(o.principal(0).disabled, false, "le bouton revient");
  } finally {
    o.fin();
  }
});

test("validation arrêtée (motif) : la carte est rendue à la base et peut être validée de nouveau", async () => {
  const { carte } = await carteTrajet();
  // Un prix sous le net : jamais validé d'un geste (motif), rien n'est créé.
  const o = await ongletAvec([{ ...carte, avertissements: [...(carte.avertissements || []), "prix_sous_net"] }]);
  try {
    o.principal(0).click();
    await dom.attendre(80);
    assert.equal(o.appels.rendre, 1, "la carte est rendue");
    assert.match(o.carteVue(0).textContent, /au niveau du net/);
    o.principal(0).click();
    await dom.attendre(80);
    assert.equal(o.appels.prendre, 2, "et se reprend au clic suivant");
  } finally {
    o.fin();
  }
});

test("magasin de démo : prise de la carte branchée sur la base (migration 120) ; une carte inconnue laisse faire l'écran", async () => {
  const st = E.etat.store;
  assert.equal(await st.agentPrendreCarte("carte-inconnue"), true);
  const src = (await import("node:fs")).readFileSync(new URL("../src/gestion/js/store-local.mjs", import.meta.url), "utf8");
  assert.match(src, /c\.statut !== "proposee" \|\| \(c\.prise_le && maintenant - Date\.parse\(c\.prise_le\) < 2 \* 60 \* 1000\)\) return false;/);
  const sb = (await import("node:fs")).readFileSync(new URL("../src/gestion/js/store-supabase.mjs", import.meta.url), "utf8");
  assert.match(sb, /sb\.rpc\("prendre_agent_carte", \{ p_carte: id \}\)/);
  assert.match(sb, /sb\.rpc\("rendre_agent_carte", \{ p_carte: id \}\)/);
});
