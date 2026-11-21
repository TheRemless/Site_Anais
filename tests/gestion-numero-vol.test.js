// tests/gestion-numero-vol.test.js : le numéro de vol d'un transfert (21.11.2026), de la saisie à l'impression.
// L'Assistant le remplit seulement s'il est écrit (conversation, WhatsApp lu, pièce jointe marquée à vérifier) ; le voucher de transfert de
// Secret et la Booking confirmation l'impriment seulement s'il est rempli, jamais deux fois. Rien ne change pour une excursion ni pour ZTP.
import test from "node:test";
import assert from "node:assert/strict";

// Un DOM minimal : de quoi rendre le voucher et la Booking confirmation (même principe que gestion-retour-depart.test.js).
class Node {}
class Texte extends Node {
  constructor(t) {
    super();
    this.t = t;
  }
  get textContent() {
    return this.t;
  }
}
class El extends Node {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.className = "";
  }
  append(...xs) {
    this.children.push(...xs);
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener() {}
  get textContent() {
    return this.children.map((c) => c.textContent).join("");
  }
  get lignes() {
    return ["p", "h1", "h2"].includes(this.tag) ? [this.textContent] : this.children.flatMap((c) => (c instanceof El ? c.lignes : []));
  }
}
globalThis.Node = Node;
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new Texte(t) };

const { numeroVol, volDansTextes, volSource, executer, memoDepuis, retenirLecture, refDe } = await import("../supabase/functions/agent/outils.js");
const { tempsSimule } = await import("../supabase/functions/agent/planifier.js");
const { consignes } = await import("../supabase/functions/agent/prompt.js");
const { propositionDepuisCarte, reservationDepuisCarte, reservationModifiee } = await import("../src/gestion/js/agent-calc.mjs");
const { propositionVersDemande } = await import("../src/gestion/js/assistant-calc.mjs");
const { lieuxAvecVol, champsBooking, volDejaDans } = await import("../src/gestion/js/taxi-calc.mjs");
const { renderVoucher } = await import("../src/gestion/js/views/voucher.mjs");

// ---- Contrôle du numéro (fonction agent) ---------------------------------------------------------------------------------
test("numéro de vol : forme IATA ou OACI, rendu sans espace en majuscules, sinon vide", () => {
  for (const [v, n] of [["FD3217", "FD3217"], ["fd 3217", "FD3217"], ["TG-225", "TG225"], ["3K 542", "3K542"], ["AFR123", "AFR123"], ["FD3217A", "FD3217A"]]) assert.equal(numeroVol(v), n, v);
  for (const v of ["", "14:30", "3217", "Tigerline", "flight at 8pm", "FD", "FD12345", "Payé 1200 THB"]) assert.equal(numeroVol(v), "", v);
});

test("numéro écrit dans un texte : avec ou sans espace ou tiret, jamais un morceau d'un autre code", () => {
  assert.ok(volDansTextes("FD3217", ["We land with fd 3217 at 14:30"]));
  assert.ok(volDansTextes("FD3217", ["Vol FD-3217 demain"]));
  assert.ok(!volDansTextes("FD3217", ["Vol FD32170"]), "un autre numéro qui commence pareil");
  assert.ok(!volDansTextes("FD321", ["Vol FD3217"]));
  assert.ok(!volDansTextes("FD3217", ["XFD3217"]));
  assert.ok(!volDansTextes("FD3217", ["Notre vol arrive à 14:30"]));
});

test("vol proposé par le modèle : gardé s'il est écrit, marqué à vérifier sur une pièce jointe, vidé s'il est inventé", () => {
  const a = [];
  assert.equal(volSource("fd 3217", {}, { textes: ["We land on FD3217"] }, a), "FD3217");
  assert.deepEqual(a, []);
  const b = [];
  assert.equal(volSource("FD3217", {}, { textes: ["Arrivée à 14:30 à Krabi"] }, b), "");
  assert.deepEqual(b, ["vol_sans_source"]);
  const c = [];
  assert.equal(volSource("FD3217", { fichiers: [{ id: "f", nom: "billet.pdf" }] }, { textes: ["Voici le billet"] }, c), "FD3217");
  assert.deepEqual(c, ["vol_piece_jointe"]);
  const d = [];
  assert.equal(volSource("14:30", {}, { textes: ["14:30"] }, d), "");
  assert.deepEqual(d, ["vol_illisible"]);
  assert.equal(volSource("", {}, {}, []), "", "rien proposé : rien");
  // Un WhatsApp lu donne une source (retenirLecture), comme le message collé.
  const memo = {};
  retenirLecture({ conversation: "x", messages: [{ sens: "entrant", texte: "Hello, our flight is AK 6203" }] }, memo);
  assert.equal(volSource("AK6203", {}, memo, []), "AK6203");
  // memoDepuis garde le texte de la personne et d'un message de client joint.
  const m2 = memoDepuis([{ role: "user", content: [{ type: "text", text: "<conversation>Client : vol TG 225</conversation> Fais le dossier" }] }]);
  assert.equal(volSource("TG225", {}, m2, []), "TG225");
});

// ---- Cartes de l'Assistant -------------------------------------------------------------------------------------------------
const PREST = "a1000000-0000-4000-8000-000000000001";
const TRANSF = "a4000000-0000-4000-8000-000000000004";
const RES = "e1000000-0000-4000-8000-000000000001";
const DOS = "d1000000-0000-4000-8000-000000000001";
const donnees = {
  prestations: [
    { id: PREST, famille: "excursion", groupe: "4 Islands", libelle: "4 Islands long-tail", prix_vente: 1500, unite: "pers", actif: true },
    { id: TRANSF, famille: "transfert", groupe: "Private minivan", libelle: "Krabi Airport → Koh Lanta", prix_vente: 2500, unite: "veh", actif: true },
  ],
  trajets: [],
  dossiers: [{ id: DOS, ref: "2026-0142", client_id: "c", annule: false }],
  reservations: [{ id: RES, dossier_id: DOS, libelle: "Krabi Airport → Koh Lanta", date_service: "2026-11-28", heure_pickup: "14:30", lieu_pickup: "Krabi Airport", personnes: { adultes: 2 }, statut: "confirme", montant_vente: 2500, vol: "FD3210" }],
};
const ctxDe = (extra = {}) => ({ charger: async (nom) => donnees[nom] || [], reglages: {}, simule: tempsSimule, ...extra });
const service = (o = {}) => ({ texte: "Transfert", ref: "", date: "2026-11-28", heure_pickup: "14:30", lieu_pickup: "Krabi Airport", de: "Krabi Airport", vers: "Lanta Sand Resort", adultes: 2, enfants: 0, prix_saisi: "", vol: "", remarque: "", ...o });
const memoAvec = (texte) => ({ prix: new Set(), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), textes: [texte], signer: false, prestataires: [], entreprise: "VIP Taxi Lanta" });

test("carte dossier : le vol écrit passe sur le transfert, l'inventé est vidé avec un avertissement, l'excursion n'en a pas", async () => {
  const memo = memoAvec("Bonjour, 2 personnes, vol FD 3217 le 28, arrivée Krabi, puis 4 îles le 29");
  const r = await executer("proposer_dossier", { titre: "Dossier", client_nom: "Claire", client_telephone: "", hotel: "Lanta Sand Resort", langue: "fr", adultes: 2, enfants: 0, bebes: 0, services: [service({ vol: "FD3217" }), service({ ref: refDe("P", TRANSF), vol: "TG225" }), service({ ref: refDe("P", PREST), texte: "4 îles", vol: "FD3217" })], apporteur: "" }, ctxDe(), memo);
  const s = r.carte.donnees.services;
  assert.equal(s[0].vol, "FD3217", "écrit dans le message : gardé, forme sans espace");
  assert.equal(s[1].vol, "", "jamais écrit : vidé");
  assert.ok(s[1].avertissements.includes("vol_sans_source"));
  assert.ok(r.carte.avertissements.includes("vol_sans_source"), "la carte le montre");
  assert.equal(s[2].vol, "", "une excursion n'a pas de numéro de vol");
  // Sans vol proposé, rien ne change.
  const sans = await executer("proposer_dossier", { titre: "Dossier", client_nom: "", client_telephone: "", hotel: "", langue: "", adultes: 2, enfants: 0, bebes: 0, services: [service()], apporteur: "" }, ctxDe(), memoAvec("Transfert le 28"));
  assert.equal(sans.carte.donnees.services[0].vol, "");
  assert.equal(sans.carte.avertissements, undefined);
});

test("carte d'ajout et de modification : le vol écrit, avec l'ancien numéro ; inventé, pas de carte", async () => {
  const memo = memoAvec("Le client a changé de vol : FD3217");
  const ajout = await executer("proposer_reservation", { titre: "Ajout", dossier: refDe("D", DOS), service: service({ vol: "FD3217" }) }, ctxDe(), memo);
  assert.equal(ajout.carte.donnees.service.vol, "FD3217");
  const modif = await executer("proposer_modification", { titre: "Vol", reservation: refDe("R", RES), champ: "vol", valeur: "FD3217", raison: "Nouveau vol" }, ctxDe(), memo);
  assert.equal(modif.carte.donnees.champ, "vol");
  assert.equal(modif.carte.donnees.avant, "FD3210");
  assert.equal(modif.carte.donnees.valeur, "FD3217");
  const invente = await executer("proposer_modification", { titre: "Vol", reservation: refDe("R", RES), champ: "vol", valeur: "FD9999", raison: "" }, ctxDe(), memo);
  assert.equal(invente.carte, undefined);
  assert.equal(invente.contenu.erreur, "vol_sans_source");
});

test("le prompt dit de remplir le vol écrit, jamais un numéro deviné ni l'heure", () => {
  const c = consignes({ entreprise: "VIP Taxi Lanta", reglages: { fonctionnement: "taxi" } });
  assert.match(c, /champ « vol »/);
  assert.match(c, /Jamais un numéro deviné/);
});

test("écran : la carte porte le vol jusqu'à la fenêtre de création, d'ajout et de modification", () => {
  const p = propositionDepuisCarte({ client: { nom: "Claire" }, adultes: 2, services: [{ texte: "Transfert", offre: null, date: "2026-11-28", heure_pickup: "14:30", de: "Krabi Airport", vers: "Lanta", vol: "FD3217" }, { texte: "4 îles", offre: { genre: "prestation", id: PREST }, date: "2026-11-29" }] });
  assert.equal(p.services[0].vol, "FD3217");
  assert.equal(p.services[1].vol, "");
  const { services } = propositionVersDemande(p, { prestations: donnees.prestations, trajets: [], partenaires: [], nomPartenaire: () => "", taxi: false });
  assert.equal(services[0].vol, "FD3217", "transfert hors catalogue");
  assert.equal(services[1].vol, undefined, "l'excursion n'en reçoit pas");
  assert.deepEqual(reservationDepuisCarte({ dossier_id: DOS, service: { texte: "T", vol: "FD3217" } }).details, { vol: "FD3217" });
  assert.equal(reservationDepuisCarte({ dossier_id: DOS, service: { texte: "T" } }).details, undefined);
  const r = { id: RES, details: { drop_off: "Lanta Sand Resort", vol: "FD3210" }, notes: "interne" };
  const m = reservationModifiee(r, { champ: "vol", valeur: "FD3217" });
  assert.deepEqual(m.details, { drop_off: "Lanta Sand Resort", vol: "FD3217" }, "le reste du voucher est gardé");
  assert.equal(m.notes, "interne", "rien dans les notes internes");
});

// ---- Impression ------------------------------------------------------------------------------------------------------------
const REGL = { emetteur: { nom: "Secret Travel & Tour", adresse: "", telephone: "+66 00" }, apparence: {}, voucher: {}, devise: "THB" };
const course = (extra = {}) => ({ id: "R1", dossier_id: "D1", entite_id: "E", libelle: "Private minivan: Krabi Airport → Koh Lanta", date_service: "2026-11-28", heure_pickup: "14:30", lieu_pickup: "Krabi Airport", personnes: { adultes: 2, enfants: 0, bebes: 0 }, statut: "confirme", montant_vente: 2500, notes: "", details: { drop_off: "Lanta Sand Resort" }, ...extra });
const voucher = (r, regl = REGL, type = "transfert") => renderVoucher({ reservation: r, prestation: null, type, index: 1 }, { reglages: regl, dossier: { ref: "INV-2026-099" }, client: { prenom: "Anna", nom: "Keller" }, resume: { total: 2500, recu: 0 }, trajet: null }).lignes;

test("voucher de transfert Secret : « Flight Number » seulement s'il est rempli, jamais deux fois", () => {
  assert.ok(voucher(course({ details: { drop_off: "Lanta Sand Resort", vol: "FD3217" } })).includes("Flight Number: FD3217"));
  const vide = voucher(course({ notes: "vol à vérifier", libelle: "Airport transfer" }));
  assert.ok(!vide.some((x) => x.startsWith("Flight Number")), "plus de ligne vide parce que le libellé ou une note parle d'aéroport");
  const deja = voucher(course({ lieu_pickup: "Krabi Airport, flight FD 3217", details: { drop_off: "Lanta Sand Resort", vol: "FD3217" } }));
  assert.ok(!deja.some((x) => x.startsWith("Flight Number")), deja.join("\n"));
  assert.ok(deja.includes("Pickup Location: Krabi Airport, flight FD 3217"));
});

test("Booking confirmation Taxi et Secret : le vol rejoint le lieu aéroport, seulement s'il est rempli, sans doublon", () => {
  const apres = (l, cle) => l[l.indexOf(cle) + 1];
  const taxi = voucher(course({ details: { drop_off: "Lanta Sand Resort", vol: "FD3217" } }), { ...REGL, fonctionnement: "taxi" });
  assert.equal(apres(taxi, "PICK UP LOCATION"), "Krabi Airport, flight FD3217");
  const sansVol = voucher(course(), { ...REGL, fonctionnement: "taxi" });
  assert.equal(apres(sansVol, "PICK UP LOCATION"), "Krabi Airport");
  assert.ok(!sansVol.some((x) => /flight/i.test(x)));
  const secret = voucher(course({ paye_sur_place: true, partenaire_id: null, details: { drop_off: "Krabi Airport", vol: "FD3218" }, lieu_pickup: "Lanta Sand Resort" }), { ...REGL, fonctionnement: "excursions" });
  assert.equal(apres(secret, "DROP OFF LOCATION"), "Krabi Airport, flight FD3218");
  // Écrit à la main dans le lieu avec un espace : pas une seconde fois.
  assert.deepEqual(lieuxAvecVol("Krabi Airport, FD 3217", "Lanta Sand Resort", "FD3217"), { pickup: "Krabi Airport, FD 3217", dropoff: "Lanta Sand Resort" });
  assert.deepEqual(lieuxAvecVol("Lanta Sand Resort", "Krabi Airport fd-3217", "FD3217"), { pickup: "Lanta Sand Resort", dropoff: "Krabi Airport fd-3217" });
  assert.ok(volDejaDans("Krabi Airport (FD 3217)", "fd3217"));
  assert.ok(!volDejaDans("Krabi Airport", ""));
  assert.equal(champsBooking({ nom: "A", pickup: "Krabi Airport", dropoff: "Hotel", vol: "" })[2].valeur, "Krabi Airport");
});

test("une excursion ne change pas : pas de ligne de vol", () => {
  const l = voucher(course({ libelle: "4 Islands long-tail", details: { vol: "FD3217" } }), REGL, "bateau");
  assert.ok(!l.some((x) => /Flight|FD3217/.test(x)), l.join("\n"));
});

test("démonstration : le numéro tapé après « vol » ou « flight » est lu, jamais « at 8 »", async () => {
  const { numeroVolTape } = await import("../src/gestion/js/calc.mjs");
  const { lireComplements } = await import("../src/gestion/js/agent-demo.mjs");
  assert.equal(numeroVolTape("vol FD 3217 à 14h"), "FD3217");
  assert.equal(numeroVolTape("Flight TG-225"), "TG225");
  assert.equal(numeroVolTape("flight at 8pm"), "");
  assert.equal(numeroVolTape("vol à 19h30"), "");
  assert.equal(lireComplements("vol FD3217 à 19h30, 2 personnes, 2 valises").numeroVol, "FD3217");
});

test("revue : un numéro plus court n'est pas « déjà écrit » dans un plus long ; un vol lu par lire_dossier est une source", async () => {
  assert.ok(!volDejaDans("Krabi Airport, flight FD3217", "FD321"));
  assert.deepEqual(lieuxAvecVol("Krabi Airport, flight FD3217", "Hotel", "FD321"), { pickup: "Krabi Airport, flight FD3217, flight FD321", dropoff: "Hotel" });
  // lire_dossier rend le vol noté ; une carte peut le reprendre (« même vol »).
  const memo = memoAvec("Ajoute le même vol sur ce service");
  const lu = await executer("lire_dossier", { dossier: refDe("D", DOS) }, ctxDe({ parRef: async (table) => donnees[table] || [] }), memo);
  assert.equal(lu.contenu.services[0].vol, "FD3210");
  const modif = await executer("proposer_modification", { titre: "Vol", reservation: refDe("R", RES), champ: "vol", valeur: "FD3210", raison: "" }, ctxDe(), memo);
  assert.equal(modif.carte.donnees.valeur, "FD3210");
  // Le même vol lu dans l'historique (résultat d'outil enregistré) compte aussi.
  const m2 = memoDepuis([{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "lire_dossier", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ services: [{ vol: "TG225" }] }) }] }]);
  assert.equal(volSource("TG225", {}, m2, []), "TG225");
});
