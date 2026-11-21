// Demandes du site et conversations WhatsApp reliées (migration 72, demande de Jérémy du 21.11.2026 : « Oui, relie-les ») : calculs,
// démonstration (mêmes règles que la base), écran et migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as C from "../src/gestion/js/demandes-whatsapp-calc.mjs";

const source = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const SECRET = "e-secret";
const TAXI = "e-taxi";
const demande = (o = {}) => ({ id: `q${Math.random()}`, entite_id: SECRET, statut: "nouvelle", telephone: "+447700900123", created_at: "2026-11-21T08:00:00Z", dossier_id: null, ...o });

test("numéro : 9 derniers chiffres, notation thaïe comprise ; un numéro trop court ne compte pas", () => {
  assert.equal(C.cleTelephone("+66 81 234 5678"), "812345678");
  assert.equal(C.cleTelephone("081 234 5678"), "812345678");
  assert.ok(C.memeNumero("081-234-5678", "+66812345678"));
  assert.equal(C.cleTelephone("12345"), "");
  assert.ok(!C.memeNumero("", ""), "deux numéros vides ne sont pas le même client");
  assert.ok(!C.memeNumero("+447700900123", "+447700900124"));
});

test("dossier créé : seulement les demandes nouvelles du même numéro, dans la même entreprise", () => {
  const dossier = { id: "d1", entite_id: SECRET, client_id: "c1" };
  const clients = [{ id: "c1", entite_id: SECRET, telephone: "+44 7700 900123" }];
  const tels = C.telephonesDuDossier({ dossier, clients, conversations: [{ dossier_id: "d1", telephone: "+12025550199" }, { dossier_id: "autre", telephone: "+12025550000" }] });
  assert.deepEqual(tels, ["700900123", "025550199"], "la fiche et la conversation reliée à ce dossier, pas les autres");
  const a = demande({ created_at: "2026-11-20T08:00:00Z" });
  const b = demande({ created_at: "2026-11-21T09:00:00Z", telephone: "+12025550199" });
  const demandes = [a, b, demande({ entite_id: TAXI }), demande({ statut: "confirmee" }), demande({ statut: "refusee" }), demande({ telephone: "+33639980002" }), demande({ telephone: null })];
  const liste = C.demandesPourDossier({ demandes, dossier, telephones: tels });
  assert.deepEqual(liste.map((x) => x.id), [b.id, a.id], "la plus récente d'abord, jamais Taxi ni une demande déjà traitée");
  assert.equal(C.choixDemandes(liste), "choisir", "plusieurs : Nani coche");
  assert.equal(C.choixDemandes([a]), "relier", "une seule : reliée d'office");
  assert.equal(C.choixDemandes([]), "aucune");
  assert.deepEqual(C.demandesPourDossier({ demandes, dossier: { ...dossier, annule: true }, telephones: tels }), [], "jamais pour un dossier annulé");
  assert.deepEqual(C.demandesPourDossier({ demandes, dossier: { ...dossier, entite_id: TAXI }, telephones: tels }).map((x) => x.entite_id), [TAXI], "un dossier Taxi ne prend que les demandes de Taxi");
  assert.deepEqual(C.demandesPourDossier({ demandes, dossier, telephones: [] }), [], "sans numéro, rien");
});

test("contrôles de demande_site_relier, dans l'ordre de la base", () => {
  const dossier = { id: "d1", entite_id: SECRET };
  const tel = ["+447700900123"];
  assert.equal(C.refusLienDemande({ demande: demande(), dossier, telephones: tel }), null);
  assert.equal(C.refusLienDemande({ demande: demande(), dossier, telephones: tel, lit: false }), "introuvable");
  assert.equal(C.refusLienDemande({ demande: demande(), dossier, telephones: tel, ecrit: false }), "droit");
  assert.equal(C.refusLienDemande({ demande: demande({ statut: "confirmee", dossier_id: "d0" }), dossier, telephones: tel }), "deja_traitee", "pas de second dossier");
  assert.equal(C.refusLienDemande({ demande: demande(), dossier: { ...dossier, entite_id: TAXI }, telephones: tel }), "autre_entreprise");
  assert.equal(C.refusLienDemande({ demande: demande(), dossier: { ...dossier, annule: true }, telephones: tel }), "annule");
  assert.equal(C.refusLienDemande({ demande: demande(), dossier, telephones: ["+12025550199"] }), "numero");
  assert.equal(C.refusLienDemande({ demande: demande({ telephone: null }), dossier, telephones: tel }), "numero");
});

test("demande acceptée : la conversation se relie sans rien écraser, jamais un contact personnel", () => {
  const d = demande({ statut: "confirmee", dossier_id: "d1" });
  const dossier = { id: "d1", entite_id: SECRET, client_id: "c1" };
  const w = (o = {}) => ({ id: "w1", organisation_id: "org", telephone: "+447700900123", entite_id: null, entite_source: "auto", client_id: null, dossier_id: null, reponses: "auto", type_contact: null, ...o });
  const lier = (o = {}) => C.liaisonApresDemande({ demande: d, dossier, clientEntiteId: SECRET, conversations: [w()], ...o });
  let r = lier();
  assert.equal(r.action, "relier");
  assert.deepEqual(r.patch, { dossier_id: "d1", entite_id: SECRET, client_id: "c1" }, "à trier : rangée dans l'entreprise de la demande, avec client et dossier");
  r = lier({ conversations: [w({ entite_id: SECRET, entite_source: "manuel" })] });
  assert.deepEqual(r.patch, { dossier_id: "d1", client_id: "c1" }, "déjà rangée : l'entreprise ne change pas");
  r = lier({ clientEntiteId: TAXI });
  assert.deepEqual(r.patch, { dossier_id: "d1", entite_id: SECRET }, "fiche partagée d'une autre entreprise : seulement le dossier");
  const motif = (o) => lier(o).motif;
  assert.equal(motif({ demande: { ...d, statut: "nouvelle" } }), "non_confirmee");
  assert.equal(motif({ boite: false }), "sans_boite", "ZTP n'a pas la boîte");
  assert.equal(motif({ demande: { ...d, telephone: "" } }), "numero");
  assert.equal(motif({ ecrit: false }), "droit_whatsapp");
  assert.equal(motif({ ecrit: false, conversations: [] }), "droit_whatsapp", "sans le droit, on n'apprend pas si une conversation existe");
  assert.equal(motif({ conversations: [] }), "aucune");
  assert.equal(motif({ conversations: [w(), w({ id: "w2", telephone: "+337700900123" })] }), "plusieurs", "rien au hasard");
  assert.equal(motif({ conversations: [w({ reponses: "jamais" })] }), "personnel");
  assert.equal(motif({ conversations: [w({ type_contact: "chauffeur" })] }), "autre_contact");
  assert.equal(motif({ conversations: [w({ type_contact: "client" })] }), "relie", "un contact typé client se relie");
  assert.equal(motif({ conversations: [w({ entite_id: TAXI })] }), "autre_entreprise", "une conversation de Taxi ne reçoit pas un dossier Secret");
  assert.equal(motif({ conversations: [w({ entite_source: "manuel" })] }), "a_trier_par_nani");
  assert.equal(motif({ conversations: [w({ entite_id: SECRET, dossier_id: "d0" })] }), "deja_relie", "le dossier relié par Nani reste");
  assert.equal(motif({ conversations: [w({ entite_id: SECRET, client_id: "c0" })] }), "deja_relie", "le client relié par Nani reste");
  assert.equal(motif({ conversations: [w({ entite_id: SECRET, dossier_id: "d1" })] }), "deja_fait");
  const conv = C.conversationsDuNumero({ conversations: [w(), w({ id: "w3", organisation_id: "autre" })], telephone: "0447700900123", organisationId: "org" });
  assert.deepEqual(conv.map((x) => x.id), ["w1"], "seulement l'organisation de la demande");
});

test("avertissement : dossier récent du même numéro (30 jours ou service à venir), non annulé, même entreprise", () => {
  const ajd = "2026-11-21";
  const clients = [{ id: "c1", telephone: "+44 7700 900123" }, { id: "c2", telephone: "+12025550199" }];
  const dossiers = [
    { id: "neuf", entite_id: SECRET, client_id: "c1", created_at: "2026-11-10", ref: "A" },
    { id: "vieux", entite_id: SECRET, client_id: "c1", created_at: "2026-09-01", ref: "B" },
    { id: "vieux-a-venir", entite_id: SECRET, client_id: "c1", created_at: "2026-08-01", ref: "C" },
    { id: "annule", entite_id: SECRET, client_id: "c1", created_at: "2026-11-20", annule: true, ref: "D" },
    { id: "taxi", entite_id: TAXI, client_id: "c1", created_at: "2026-11-20", ref: "E" },
    { id: "par-wa", entite_id: SECRET, client_id: "c2", created_at: "2026-11-19", ref: "F" },
    { id: "depart", entite_id: SECRET, client_id: "c1", created_at: "2026-01-01", date_depart: "2026-12-01", ref: "G" },
  ];
  const reservations = [{ dossier_id: "vieux-a-venir", date_service: "2026-11-25", statut: "confirme" }, { dossier_id: "vieux", date_service: "2026-11-30", statut: "annule" }];
  const conversations = [{ dossier_id: "par-wa", telephone: "+447700900123" }];
  const liste = C.dossiersRecents({ demande: demande(), dossiers, clients, reservations, conversations, aujourdhui: ajd }).map((x) => x.id);
  assert.deepEqual(liste.sort(), ["depart", "neuf", "par-wa", "vieux-a-venir"].sort());
  assert.ok(!liste.includes("vieux"), "un service annulé ne rend pas le dossier récent");
  assert.deepEqual(C.dossiersRecents({ demande: demande({ statut: "confirmee" }), dossiers, clients, aujourdhui: ajd }), [], "seulement avant « Confirmer »");
  assert.deepEqual(C.dossiersRecents({ demande: demande({ telephone: null }), dossiers, clients, aujourdhui: ajd }), []);
  assert.equal(C.RECENT_JOURS, 30);
  assert.deepEqual(C.dossiersRecents({ demande: demande(), dossiers: [{ id: "x", entite_id: SECRET, client_id: "c1", created_at: "2026-10-22" }], clients, aujourdhui: ajd }).length, 1, "30 jours pile");
  assert.deepEqual(C.dossiersRecents({ demande: demande(), dossiers: [{ id: "x", entite_id: SECRET, client_id: "c1", created_at: "2026-10-21" }], clients, aujourdhui: ajd }).length, 0, "31 jours : plus récent");
});

test("démonstration : mêmes règles que la base, Lucia, Sven (deux demandes) et l'avertissement", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  globalThis.location = { origin: "http://localhost", pathname: "/gestion/", search: "?demo", hash: "" };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?dwa=${Date.now()}`);
    const store = creer();
    let d = await store.charger();
    const secret = d.entites.find((e) => ["secret", "excursions"].includes(e.slug));
    const taxi = d.entites.find((e) => e.slug === "taxi");
    const lucia = d.demandes_site.find((x) => x.telephone === "+12025550147" && x.statut === "nouvelle");
    const sven = d.demandes_site.filter((x) => x.telephone === "+447700900733" && x.statut === "nouvelle");
    assert.ok(lucia && lucia.entite_id === secret.id, "une demande Secret au numéro de la conversation de Lucia (à trier)");
    assert.equal(sven.length, 2, "deux demandes Taxi au numéro de Sven");
    const ajd = new Date().toISOString().slice(0, 10);
    const avertie = d.demandes_site.filter((x) => x.statut === "nouvelle" && C.dossiersRecents({ demande: x, dossiers: d.dossiers, clients: d.clients, reservations: d.reservations, conversations: d.whatsapp_conversations, aujourdhui: ajd }).length);
    assert.ok(avertie.length >= 1, "au moins une demande montre « Ce client a déjà un dossier »");

    // Lucia : « Confirmer » crée le dossier, puis la conversation à trier se range chez Secret avec le client et le dossier.
    const cL = await store.inserer("clients", { entite_id: secret.id, prenom: "Lucia", nom: "Rossi", telephone: "+1 202 555 0147" });
    const dL = await store.inserer("dossiers", { entite_id: secret.id, ref: "DWA-1", client_id: cL.id });
    assert.equal((await store.whatsappRelierApresDemande(lucia.id)).motif, "non_confirmee");
    await store.modifier("demandes_site", lucia.id, { statut: "confirmee", dossier_id: dL.id, decision: { final: {} } });
    const r = await store.whatsappRelierApresDemande(lucia.id);
    assert.equal(r.motif, "relie");
    d = await store.charger();
    const wL = d.whatsapp_conversations.find((x) => x.telephone === "+12025550147");
    assert.deepEqual([wL.entite_id, wL.entite_source, wL.client_id, wL.dossier_id], [secret.id, "manuel", cL.id, dL.id]);
    assert.equal((await store.whatsappRelierApresDemande(lucia.id)).motif, "deja_fait");
    const dL2 = await store.inserer("dossiers", { entite_id: secret.id, ref: "DWA-2", client_id: cL.id });
    await assert.rejects(store.modifier("demandes_site", lucia.id, { statut: "confirmee", dossier_id: dL2.id }), /déjà été traitée/, "pas de second dossier");
    assert.equal((await store.demandeSiteRelier(lucia.id, dL2.id)).motif, "deja_traitee");

    // Sven : le dossier créé depuis sa conversation couvre l'une ou les deux demandes ; Nani coche.
    const cS = await store.inserer("clients", { entite_id: taxi.id, prenom: "Sven", nom: "Berg", telephone: "+44 7700 900733" });
    const dS = await store.inserer("dossiers", { entite_id: taxi.id, ref: "DWA-3", client_id: cS.id });
    const dSecret = await store.inserer("dossiers", { entite_id: secret.id, ref: "DWA-4", client_id: cL.id });
    const tels = C.telephonesDuDossier({ dossier: dS, clients: (await store.charger()).clients });
    assert.equal(C.choixDemandes(C.demandesPourDossier({ demandes: d.demandes_site, dossier: dS, telephones: tels })), "choisir");
    assert.equal((await store.demandeSiteRelier(sven[0].id, dSecret.id)).motif, "autre_entreprise", "jamais une demande Taxi vers un dossier Secret");
    let x = await store.demandeSiteRelier(sven[0].id, dS.id);
    assert.equal(x.motif, "relie");
    assert.equal(x.demande.statut, "confirmee");
    assert.ok(x.demande.decision.relie, "la décision note d'où vient le lien");
    assert.equal((await store.demandeSiteRelier(sven[0].id, dS.id)).motif, "deja_traitee");
    assert.equal((await store.demandeSiteRelier(sven[1].id, dS.id)).motif, "relie", "la seconde demande cochée aussi");
    x = await store.whatsappRelierApresDemande(sven[0].id);
    assert.equal(x.motif, "relie", "la conversation de Sven, rangée chez Taxi par Nani, reçoit le client et le dossier");
    assert.equal(x.conversation.dossier_id, dS.id);

    // Contact personnel : jamais relié.
    const q = await store.inserer("demandes_site", { entite_id: taxi.id, marque: "taxi", statut: "nouvelle", produit_id: "x", telephone: "+447700900844", decision: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const cP = await store.inserer("clients", { entite_id: taxi.id, prenom: "Somchai", nom: "P", telephone: "+44 7700 900844" });
    const dP = await store.inserer("dossiers", { entite_id: taxi.id, ref: "DWA-5", client_id: cP.id });
    await store.modifier("demandes_site", q.id, { statut: "confirmee", dossier_id: dP.id });
    assert.equal((await store.whatsappRelierApresDemande(q.id)).motif, "personnel");
    d = await store.charger();
    assert.equal(d.whatsapp_conversations.find((w) => w.telephone === "+447700900844").dossier_id, null);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.location;
  }
});

test("écran : relue avant de créer, conversation reliée après « Confirmer », avertissement, appel délimité dans l'Assistant", () => {
  const ecran = source("src/gestion/js/views/demandes-site.mjs");
  assert.match(ecran, /avantCreer: async \(\) => !\(await dejaTraiteeEnBase\(d\)\)/, "la demande est relue juste avant d'écrire le dossier");
  assert.match(ecran, /if \(dejaTraitee\(d\) \|\| \(await dejaTraiteeEnBase\(d\)\)\)/, "et avant d'ouvrir la fenêtre");
  assert.match(ecran, /if \(confirmee\) await relierConversationApresDemande/, "la conversation se relie seulement si la demande est bien confirmée");
  assert.match(ecran, /avertissementDossier\(d\)/);
  assert.match(source("src/gestion/js/views/demande.mjs"), /depuisSite\.avantCreer && !\(await depuisSite\.avantCreer\(\)/);
  const agent = source("src/gestion/js/views/agent.mjs");
  assert.equal((agent.match(/demandes-whatsapp\.mjs/g) || []).length, 2, "l'Assistant n'a qu'un appel (et son commentaire)");
  assert.match(agent, /relierDemandesApresDossier\(r\.dossiers \|\| \[dossier\]\)/, "les deux dossiers d'une carte mixte");
  assert.doesNotMatch(source("supabase/functions/agent/outils.js"), /demande_site_relier|whatsapp_relier_apres_demande/, "rien dans les outils de l'agent");
  assert.doesNotMatch(source("src/gestion/js/views/demandes-whatsapp.mjs"), /whatsappEnvoyer|wa\.me|fetch\(/, "aucun envoi au client ni au prestataire");
});

test("migration 72 : en-tête, transaction, aucune donnée modifiée, droits ; retour et contrôle PGlite branchés", () => {
  const sql = source("docs/gestion/migration-72-demandes-whatsapp.sql");
  assert.match(sql, /^-- Gestion : migration 72/);
  for (const mot of ["But :", "Retour en arrière : docs\\/gestion\\/retour-72-demandes-whatsapp\\.sql", "Contrôle : docs\\/gestion\\/verif-demandes-whatsapp\\.mjs"]) assert.match(sql, new RegExp(mot));
  assert.match(sql, /\nbegin;\n[\s\S]*\ncommit;\n$/);
  const horsFonctions = sql.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
  assert.doesNotMatch(horsFonctions, /^\s*(update|delete from|insert into) /im, "aucune donnée modifiée hors des fonctions");
  assert.match(sql, /create or replace function demande_site_relier\(p_demande uuid, p_dossier uuid\) returns jsonb\nlanguage plpgsql security definer set search_path = public, pg_temp/);
  assert.match(sql, /create or replace function whatsapp_relier_apres_demande\(p_demande uuid\) returns jsonb\nlanguage plpgsql security definer set search_path = public, pg_temp/);
  assert.match(sql, /revoke all on function demande_site_relier\(uuid, uuid\) from public, anon;\ngrant execute on function demande_site_relier\(uuid, uuid\) to authenticated;/);
  assert.match(sql, /if not whatsapp_ecrit\(d\.entite_id, org\)/, "relier une conversation demande whatsapp_ecrit");
  assert.match(sql, /if w\.reponses = 'jamais' then/, "jamais un contact personnel");
  assert.match(sql, /drop trigger if exists une_fois on demandes_site;\ncreate trigger une_fois/);
  assert.ok(fs.existsSync(new URL("../docs/gestion/retour-72-demandes-whatsapp.sql", import.meta.url)));
  assert.match(source("docs/gestion/retour-72-demandes-whatsapp.sql"), /drop function if exists demande_site_relier\(uuid, uuid\);/);
  assert.ok(fs.existsSync(new URL("../docs/gestion/verif-demandes-whatsapp.mjs", import.meta.url)));
  assert.match(source(".github/workflows/ci.yml"), /verif-whatsapp-nom verif-demandes-whatsapp; do/);
});
