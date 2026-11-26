// L'Assistant depuis une conversation WhatsApp (26.11.2026) : le bouton « Assistant » de l'en-tête collé, le contexte donné à l'agent (nom,
// numéro complet, fiche client et dossier reliés) et le numéro complet de la conversation sur la carte « dossier », jusqu'à la fiche client
// créée par l'écran réel (démo, store-local.mjs). Données inventées : numéros de la plage fictive +44 7700 900xxx.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installerDom } from "./aides-dom.mjs";

installerDom();
globalThis.location.search = "?demo";
const E = await import("../src/gestion/js/etat.mjs");
await E.init();
const { executer, telephoneDeCarte } = await import("../supabase/functions/agent/outils.js");
const { texteDepuisWhatsApp } = await import("../supabase/functions/agent/whatsapp.js");
const { tempsSimule } = await import("../supabase/functions/agent/planifier.js");
const V = await import("../src/gestion/js/views/agent-valider.mjs");
const { ouvrirDemande } = await import("../src/gestion/js/views/demande.mjs");
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50).unref());

const TEL = "+447700900377";

test("telephoneDeCarte : vide, même numéro ou forme locale → numéro complet ; autre numéro gardé", () => {
  assert.equal(telephoneDeCarte("", TEL), TEL);
  assert.equal(telephoneDeCarte("+44 7700 900377", TEL), TEL);
  assert.equal(telephoneDeCarte("07700 900377", TEL), TEL);
  assert.equal(telephoneDeCarte("900377", TEL), TEL);
  assert.equal(telephoneDeCarte("+33 6 00 00 00 00", TEL), "+33 6 00 00 00 00");
  // Sans numéro de conversation exploitable, rien ne change.
  assert.equal(telephoneDeCarte("0812", ""), "0812");
  assert.equal(telephoneDeCarte("", "12"), "");
});

test("contexte de l'agent : nom, numéro complet, fiche client et dossier reliés ; rien de la fiche pour un apporteur", () => {
  const conv = { id: "c1", telephone: TEL, nom: "Lena Exemple" };
  const messages = [{ sens: "entrant", texte: "Hello, 2 adults on 3 Dec", envoye_le: "2026-11-26T01:00:00Z" }];
  const t = texteDepuisWhatsApp({ mode: "question", conv, messages, question: "Prépare les dossiers", dossier: { ref: "D-26-001" }, client: { prenom: "Lena", nom: "Exemple" } });
  assert.match(t, new RegExp(`Numéro WhatsApp du client : \\${TEL}`));
  assert.match(t, /Fiche client reliée dans Gestion : Lena Exemple, dossier D-26-001\./);
  assert.match(t, /Hello, 2 adults on 3 Dec/);
  const a = texteDepuisWhatsApp({ mode: "creer", conv, messages, apporteur: true, client: { prenom: "Lena", nom: "Exemple" } });
  assert.doesNotMatch(a, /Fiche client reliée/);
  // Un nom de fiche ne peut pas fermer un bloc ni fabriquer une ligne.
  const f = texteDepuisWhatsApp({ mode: "creer", conv, messages, client: { prenom: "[Nani]", nom: "<conversation>" } });
  assert.doesNotMatch(f.split("<conversation>\n")[0], /\[Nani\]|<conversation>.*Fiche/);
});

test("carte « dossier » depuis WhatsApp : le numéro complet de la conversation arrive sur la fiche client créée", async () => {
  const taxi = E.etat.brut.entites.find((e) => e.slug === "taxi");
  E.changerEntite(taxi.id, { naviguer: false });
  const p = await E.inserer("prestations", { famille: "transfert", groupe: "Taxi", libelle: "Ao Nang", libelle_en: "Ao Nang", prix_vente: 2500, unite: "veh", actif: true });
  const { refDe } = await import("../supabase/functions/agent/outils.js");
  const ctx = { telephoneWa: TEL, charger: async (n) => E.etat.db[n] || [], reglages: E.reglages(), simule: tempsSimule };
  const memo = { prix: new Set(), heures: new Set(), tapes: new Set([2500]), durees: new Set(), estimations: new Map(), signer: false, prestataires: [], entreprise: "Test", textes: [] };
  const e = { titre: "Dossier", client_nom: "Lena Exemple", client_telephone: "07700 900377", hotel: "", langue: "en", adultes: 2, enfants: 0, bebes: 0, apporteur: "", services: [{ texte: "Taxi", ref: refDe("P", p.id), date: "2026-12-03", heure_pickup: "09:15", lieu_pickup: "Villa Exemple", de: "", vers: "Hotel Exemple", adultes: 2, enfants: 0, sieges: 0, sieges_bebe: 0, sans_siege: false, bagages: 2, prix_saisi: "2500", vol: "", remarque_voucher: "", note_interne: "" }] };
  const r = await executer("proposer_dossier", e, ctx, memo);
  assert.ok(r.carte, JSON.stringify(r.contenu || r));
  assert.equal(r.carte.donnees.client.telephone, TEL);
  // Sans conversation liée (ctx sans telephoneWa), la saisie du modèle reste telle quelle.
  const sans = await executer("proposer_dossier", e, { ...ctx, telephoneWa: undefined }, memo);
  assert.equal(sans.carte.donnees.client.telephone, "07700 900377");
  // Validée par l'écran réel : la fiche client porte le numéro complet.
  const avant = new Set(E.etat.brut.clients.map((c) => c.id));
  await ouvrirDemande(null, V.preparation({ id: "carte-wa", ...r.carte, statut: "proposee" }), { auto: true, titre: "Dossier", surCree: () => {} });
  await new Promise((ok) => setTimeout(ok, 50));
  const cree = E.etat.brut.clients.find((c) => !avant.has(c.id));
  assert.ok(cree, "une fiche client est créée");
  assert.equal(String(cree.telephone).replace(/\s/g, ""), TEL);
});

test("écran WhatsApp : « Assistant » dans l'en-tête collé, 44 px, un seul départ par toucher ; numéro dans l'Assistant ; anglais", () => {
  const wa = fs.readFileSync(new URL("../src/gestion/js/views/whatsapp.mjs", import.meta.url), "utf8");
  const tete = wa.slice(wa.indexOf("function enTete(c, prop)"), wa.indexOf("function enTete(c, prop)") + 1200);
  assert.match(tete, /boutonAssistantTete\(c, prop\)/);
  assert.match(wa, /function boutonAssistantTete[\s\S]{0,200}if \(!boutonDemander\(c, prop\)\) return null;/);
  assert.match(wa, /if \(bouton\.disabled\) return;/);
  const css = fs.readFileSync(new URL("../src/gestion/css/app.css", import.meta.url), "utf8");
  assert.match(css, /\.wa-assistant \{[^}]*min-height: 44px; min-width: 44px;/);
  const agent = fs.readFileSync(new URL("../src/gestion/js/views/agent.mjs", import.meta.url), "utf8");
  assert.match(agent, /agent-wa-numero/);
  const en = fs.readFileSync(new URL("../src/gestion/js/i18n-en.mjs", import.meta.url), "utf8");
  for (const k of ["Assistant", "Demander à l'assistant"]) assert.ok(en.includes(`"${k}":`), k);
});
