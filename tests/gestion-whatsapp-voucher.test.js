// Voucher envoyé en image dans la conversation WhatsApp du client depuis Gestion (21.11.2026, demande de Jérémy, migration 73).
// La logique de la fonction (supabase/functions/whatsapp-envoi/voucher.js) tourne ici avec une base, un stockage et un Telnyx simulés :
// aucun appel réseau, aucune clé.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { envoyerVoucherImage, viderCacheCoexistence } from "../supabase/functions/whatsapp-envoi/voucher.js";
import * as S from "../supabase/functions/whatsapp-envoi/calc.js";
import { controlerReponse } from "../supabase/functions/agent/outils.js";
import * as F from "../src/gestion/js/whatsapp-voucher-calc.mjs";
import { envoiANoter } from "../src/gestion/js/envoi-voucher-calc.mjs";
import { etatMedia, LIBELLES_MEDIA } from "../src/gestion/js/whatsapp-calc.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const ORG = "00000000-0000-0000-0000-00000000a000";
const SECRET = "aaaaaaaa-0000-4000-8000-000000000001";
const C = "cccccccc-0000-4000-8000-000000000001";
const R = "rrrrrrrr-0000-4000-8000-000000000001".replace(/r/g, "b");
const D = "dddddddd-0000-4000-8000-000000000001";
const CL = "eeeeeeee-0000-4000-8000-000000000001";
const M = "ffffffff-0000-4000-8000-000000000001";
const MAINTENANT = Date.parse("2026-11-21T08:00:00Z");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);

// ---- Monde simulé -------------------------------------------------------------------------------------------------------------------
function monde(o = {}) {
  const w = {
    conv: { id: C, organisation_id: ORG, telephone: "+447700900311", entite_id: SECRET, client_id: CL, dossier_id: D, reponses: "auto", type_contact: "client", partenaire_id: null },
    reservation: { id: R, entite_id: SECRET, dossier_id: D, statut: "confirme" },
    dossier: { id: D, client_id: CL, entite_id: SECRET, annule: false },
    entite: { id: SECRET, organisation_id: ORG, slug: "secret" },
    peutEcrire: true,
    admin: true,
    dernierEntrant: new Date(MAINTENANT - 10 * 60_000).toISOString(),
    numero: "+447700900100",
    recents: [],
    ranger: { message_id: M, nouveau: true },
    coexistence: { status: 200, corps: { data: { phone_number: "+447700900100", coexistence_state: "active", is_on_biz_app: true } } },
    fenetre: { status: 200, corps: { data: { window_active: true, window_expires_at: new Date(MAINTENANT + 3600_000).toISOString() } } },
    envoi: { status: 200, corps: { data: { id: "tx-voucher-1" } } },
    bloque: [],
    ...o,
  };
  const journal = [];
  const appels = { fetch: [], depots: [], effaces: [], signes: [], rpc: [], maj: [] };
  const resultat = (e) => {
    const f = Object.fromEntries(e.filtres.filter((x) => x[0] === "eq").map((x) => [x[1], x[2]]));
    if (e.table === "whatsapp_conversations") return { data: f.id === w.conv?.id ? w.conv : null, error: null };
    if (e.table === "reservations") return w.reservation === "erreur" ? { data: null, error: { message: "x" } } : { data: w.reservation && f.id === w.reservation.id ? w.reservation : null, error: null };
    if (e.table === "dossiers") return { data: w.dossier && f.id === w.dossier.id ? w.dossier : null, error: null };
    if (e.table === "entites") return { data: w.entite, error: null };
    if (e.table === "whatsapp_reglages") return { data: { numero: w.numero }, error: null };
    if (e.table === "whatsapp_messages" && e.op === "update") return (appels.maj.push(e.valeurs), { data: [{ id: M }], error: null });
    if (e.table === "whatsapp_messages" && f.sens === "entrant") return w.messagesErreur ? { data: null, error: { message: "x" } } : { data: w.dernierEntrant ? [{ sens: "entrant", envoye_le: w.dernierEntrant }] : [], error: null };
    if (e.table === "whatsapp_messages" && f.origine === "gestion") return { data: w.recents, error: null };
    throw new Error(`requête inattendue ${e.table}`);
  };
  const client = () => {
    const chaine = (table, op, valeurs) => {
      const e = { table, op, valeurs, filtres: [] };
      const q = {
        select: () => q, order: () => q, limit: () => q,
        eq: (k, v) => (e.filtres.push(["eq", k, v]), q), in: (k, v) => (e.filtres.push(["in", k, v]), q), gte: (k, v) => (e.filtres.push(["gte", k, v]), q),
        maybeSingle: async () => resultat(e),
        then: (ok, ko) => Promise.resolve().then(() => resultat(e)).then(ok, ko),
      };
      return q;
    };
    return {
      from: (t) => ({ select: () => chaine(t, "select"), update: (v) => chaine(t, "update", v) }),
      rpc: async (nom, args) => {
        appels.rpc.push({ nom, args });
        if (nom === "whatsapp_peut_ecrire") return { data: w.peutEcrire, error: null };
        if (nom === "whatsapp_admin") return { data: w.admin, error: null };
        if (nom === "whatsapp_ranger") return { data: w.ranger, error: null };
        if (nom === "whatsapp_retirer_envoi") return { data: true, error: null };
        throw new Error(nom);
      },
      storage: {
        from: (bucket) => ({
          upload: async (chemin, octets, opts) => (appels.depots.push({ bucket, chemin, octets, opts }), { data: { path: chemin }, error: null }),
          remove: async (chemins) => (appels.effaces.push({ bucket, chemins }), { data: [], error: null }),
          createSignedUrl: async (chemin, duree) => (appels.signes.push({ bucket, chemin, duree }), { data: { signedUrl: `https://projet.supabase.co/storage/v1/object/sign/${bucket}/${chemin}?token=jeton` }, error: null }),
        }),
      },
    };
  };
  const fetch = async (url, init = {}) => {
    appels.fetch.push({ url, init, depots: appels.depots.length });
    const rep = (x) => {
      if (x === "coupure") throw new Error("réseau");
      return { status: x.status, json: async () => x.corps };
    };
    if (url.endsWith("/v2/messages/whatsapp")) return rep(w.envoi);
    if (url.includes("/conversation_window")) return rep(w.fenetre);
    if (url.includes("/v2/whatsapp/phone_numbers/")) return rep(w.coexistence);
    throw new Error(url);
  };
  const ctx = {
    sb: client(), admin: client(), fetch, cle: "test", webhook: "https://projet.supabase.co/functions/v1/whatsapp",
    contenuInterne: async (_a, _c, texte) => {
      const c = controlerReponse(texte, { signer: true, internes: new Set([1500]), ventes: new Set([3000]), prestataires: ["Lazy Day"] });
      return (c.avertissements || []).filter((a) => a.startsWith("montant_interne") || a.startsWith("nom_prestataire"));
    },
    uuid: () => "1234abcd-0000-4000-8000-000000000001",
    maintenant: () => w.horloge || MAINTENANT,
    journal: (...x) => journal.push(x.join(" ")),
  };
  const demande = { conversation_id: C, reservation_id: R, legende: "Hello Tom,\n\nYour booking is confirmed. See you soon!", octets: PNG, mime: "image/png", nom: "Voucher SEC-1.png" };
  return { w, ctx, appels, demande, envoyer: (d = {}) => envoyerVoucherImage(ctx, { ...demande, ...d }) };
}
const envoisTelnyx = (appels) => appels.fetch.filter((a) => a.url.endsWith("/v2/messages/whatsapp"));

beforeEach(() => viderCacheCoexistence());

// ---- Le chemin qui marche --------------------------------------------------------------------------------------------------------
test("voucher : contrôlé, déposé, rangé « envoi », URL signée courte, envoyé en image avec sa légende, complété avec l'id Telnyx", async () => {
  const m = monde();
  const r = await m.envoyer();
  assert.equal(r.status, 200);
  assert.deepEqual(r.corps, { ok: true, message_id: M, complet: true });
  // Coexistence et fenêtre lues chez Telnyx AVANT de déposer le fichier.
  const lectures = m.appels.fetch.filter((a) => !a.url.endsWith("/v2/messages/whatsapp"));
  assert.equal(lectures.length, 2);
  assert.ok(lectures.every((a) => a.depots === 0), "rien n'est déposé avant les contrôles chez Telnyx");
  assert.equal(lectures[0].url, "https://api.telnyx.com/v2/whatsapp/phone_numbers/%2B447700900100");
  assert.equal(lectures[1].url, "https://api.telnyx.com/v2/whatsapp/phone_numbers/%2B447700900100/conversation_window?destination_number=%2B447700900311");
  // Le fichier : bucket privé, chemin sans rien du client.
  assert.equal(m.appels.depots.length, 1);
  const depot = m.appels.depots[0];
  assert.equal(depot.bucket, "whatsapp-sortant");
  assert.match(depot.chemin, new RegExp(`^${ORG}/${MAINTENANT}-1234abcd-0000-4000-8000-000000000001\\.png$`));
  assert.equal(depot.opts.upsert, false);
  // Rangé avant l'appel, comme le texte.
  const range = m.appels.rpc.find((x) => x.nom === "whatsapp_ranger");
  assert.equal(range.args.m.type, "image");
  assert.equal(range.args.m.origine, "gestion");
  assert.equal(range.args.m.statut_envoi, "envoi");
  assert.equal(range.args.m.texte, m.demande.legende);
  assert.equal(range.args.m.medias[0].statut, "voucher");
  assert.equal(range.args.m.medias[0].chemin_sortant, depot.chemin);
  assert.equal(range.args.m.medias[0].chemin, undefined, "jamais un chemin du stockage « whatsapp »");
  assert.match(range.args.m.evenement_id, new RegExp(`^gestion-voucher:${R}:`));
  // URL signée de 15 minutes au plus.
  assert.equal(m.appels.signes.length, 1);
  assert.equal(m.appels.signes[0].duree, 900);
  assert.ok(S.URL_SIGNEE_S >= 600 && S.URL_SIGNEE_S <= 900, "entre 10 et 15 minutes");
  // L'envoi.
  const [envoi] = envoisTelnyx(m.appels);
  const corps = JSON.parse(envoi.init.body);
  assert.equal(corps.from, "+447700900100");
  assert.equal(corps.to, "+447700900311");
  assert.equal(corps.whatsapp_message.type, "image");
  assert.equal(corps.whatsapp_message.image.caption, m.demande.legende);
  assert.match(corps.whatsapp_message.image.link, /^https:\/\/projet\.supabase\.co\/storage\/v1\/object\/sign\/whatsapp-sortant\/.+\?token=jeton&v=\d+$/, "lien signé, « v » contre le cache de Meta");
  assert.equal(corps.webhook_url, "https://projet.supabase.co/functions/v1/whatsapp");
  assert.equal(envoi.init.redirect, "error");
  assert.deepEqual(m.appels.maj[0], { telnyx_id: "tx-voucher-1", statut_envoi: "envoye", statut_le: new Date(MAINTENANT).toISOString() });
  // Le fichier reste : Telnyx ne dit pas quand il le télécharge. Il part au statut « remis », « lu » ou « échec », sinon par la purge.
  assert.equal(m.appels.effaces.length, 0);
});

test("voucher : sans légende, l'image part seule", async () => {
  const m = monde();
  const r = await m.envoyer({ legende: "" });
  assert.equal(r.status, 200);
  const corps = JSON.parse(envoisTelnyx(m.appels)[0].init.body);
  assert.equal("caption" in corps.whatsapp_message.image, false);
});

// ---- Fenêtre de 24 h -----------------------------------------------------------------------------------------------------------------
test("refus hors fenêtre : vue par la base (dernier message du client il y a plus de 24 h)", async () => {
  const m = monde({ dernierEntrant: new Date(MAINTENANT - 25 * 3600_000).toISOString() });
  const r = await m.envoyer();
  assert.deepEqual([r.status, r.corps.erreur], [409, "fenetre_fermee"]);
  assert.equal(m.appels.depots.length, 0);
  assert.equal(envoisTelnyx(m.appels).length, 0);
  const sans = await monde({ dernierEntrant: null }).envoyer();
  assert.equal(sans.corps.erreur, "fenetre_fermee", "le client n'a jamais écrit : fermée");
  const erreur = await monde({ messagesErreur: true }).envoyer();
  assert.deepEqual([erreur.status, erreur.corps.erreur], [500, "base"], "une lecture en échec n'est pas une fenêtre fermée (M4)");
});

test("refus hors fenêtre : vue par Telnyx (conversation_window), et en cas de doute", async () => {
  for (const fenetre of [
    { status: 200, corps: { data: { window_active: false } } },
    { status: 200, corps: { data: { window_active: true, window_expires_at: new Date(MAINTENANT - 1000).toISOString() } } },
    { status: 200, corps: { data: { window_active: "true" } } },
    { status: 200, corps: null },
    { status: 404, corps: { errors: [{ code: "10005" }] } },
    { status: 500, corps: null },
    "coupure",
  ]) {
    const m = monde({ fenetre });
    const r = await m.envoyer();
    assert.deepEqual([r.status, r.corps.erreur], [409, "fenetre_fermee"], JSON.stringify(fenetre));
    assert.equal(m.appels.depots.length, 0);
    assert.equal(envoisTelnyx(m.appels).length, 0);
  }
  assert.equal(S.lireFenetreTelnyx(200, { data: { window_active: true } }, MAINTENANT), true, "ouverte sans date de fin donnée");
});

// ---- Coexistence ---------------------------------------------------------------------------------------------------------------------
test("refus si la coexistence n'est pas « active » : message clair, rien de déposé ni d'envoyé", async () => {
  for (const etat of ["pending_onboarding", "sync_pending", "syncing", "sync_complete", "history_declined", "sync_deadline_expired", "offboarded", "disconnected"]) {
    viderCacheCoexistence();
    const m = monde({ coexistence: { status: 200, corps: { data: { coexistence_state: etat } } } });
    const r = await m.envoyer();
    assert.deepEqual([r.status, r.corps.erreur, r.corps.etat], [409, "coexistence_inactive", etat], etat);
    assert.equal(m.appels.depots.length, 0);
    assert.equal(envoisTelnyx(m.appels).length, 0);
  }
  for (const coexistence of [{ status: 200, corps: { data: {} } }, { status: 401, corps: { errors: [] } }, "coupure"]) {
    viderCacheCoexistence();
    const r = await monde({ coexistence }).envoyer();
    assert.equal(r.corps.erreur, "coexistence_inactive", "illisible : refusé");
  }
  assert.match(F.erreurVoucher("coexistence_inactive"), /Envoyez depuis votre téléphone/);
  assert.match(F.erreurVoucher("fenetre_fermee"), /Envoyez depuis votre téléphone/);
  assert.equal(F.voucherIncertain("coexistence_inactive"), false, "rien n'est parti");
});

test("coexistence : gardée 3 minutes au plus, une lecture en échec n'est jamais gardée", async () => {
  const m = monde();
  await m.envoyer();
  m.w.recents = [];
  m.w.horloge = MAINTENANT + 60_000;
  await m.envoyer();
  const lectures = () => m.appels.fetch.filter((a) => /phone_numbers\/%2B447700900100$/.test(a.url)).length;
  assert.equal(lectures(), 1, "relue une fois en une minute");
  m.w.horloge = MAINTENANT + 4 * 60_000;
  m.w.coexistence = { status: 200, corps: { data: { coexistence_state: "disconnected" } } };
  const r = await m.envoyer();
  assert.equal(lectures(), 2, "relue après 3 minutes");
  assert.equal(r.corps.erreur, "coexistence_inactive");
  assert.equal(S.COEXISTENCE_CACHE_MS <= 5 * 60_000, true);
  // Une coupure n'est pas gardée : la demande suivante relit.
  viderCacheCoexistence();
  const c = monde({ coexistence: "coupure" });
  await c.envoyer();
  c.w.coexistence = { status: 200, corps: { data: { coexistence_state: "active" } } };
  assert.equal((await c.envoyer()).status, 200);
});

// ---- Le bon contact ----------------------------------------------------------------------------------------------------------------
test("refus si le contact n'est pas un client ou s'il est personnel, ou s'il n'est pas relié à ce dossier", async () => {
  const cas = [
    [{ type_contact: "partenaire" }, "contact_non_client"],
    [{ type_contact: "chauffeur" }, "contact_non_client"],
    [{ type_contact: "hotel" }, "contact_non_client"],
    [{ type_contact: "apporteur" }, "contact_non_client"],
    [{ type_contact: null, reponses: "jamais" }, "contact_personnel"],
    [{ client_id: "99999999-0000-4000-8000-000000000001", dossier_id: null }, "conversation_autre_dossier"],
    [{ client_id: "99999999-0000-4000-8000-000000000001", dossier_id: D }, "conversation_autre_dossier"],
    [{ client_id: null, dossier_id: null }, "conversation_autre_dossier"],
  ];
  for (const [patch, code] of cas) {
    const m = monde();
    Object.assign(m.w.conv, patch);
    const r = await m.envoyer();
    assert.deepEqual([r.status, r.corps.erreur], [403, code], JSON.stringify(patch));
    assert.equal(m.appels.fetch.length, 0, "rien n'est demandé à Telnyx");
    assert.equal(m.appels.depots.length, 0);
  }
  // Pas encore typée, réponses automatiques, reliée au client : c'est le client.
  const m = monde();
  Object.assign(m.w.conv, { type_contact: null, reponses: "auto", dossier_id: null });
  assert.equal((await m.envoyer()).status, 200);
  // Reliée au dossier seulement (client pas encore relié).
  const n = monde();
  Object.assign(n.w.conv, { client_id: null });
  assert.equal((await n.envoyer()).status, 200);
});

test("le contrôle du contact est le même à l'écran et dans la fonction", () => {
  const dossier = { id: D, client_id: CL };
  const convs = [
    { client_id: CL, dossier_id: D, type_contact: "client", reponses: "auto" },
    { client_id: CL, dossier_id: null, type_contact: null, reponses: "auto" },
    { client_id: null, dossier_id: D, type_contact: null, reponses: "auto" },
    { client_id: CL, dossier_id: D, type_contact: null, reponses: "jamais" },
    { client_id: CL, dossier_id: D, type_contact: "partenaire", reponses: "auto" },
    { client_id: CL, dossier_id: D, type_contact: "apporteur", reponses: "auto" },
    { client_id: "autre", dossier_id: D, type_contact: "client", reponses: "auto" },
    { client_id: null, dossier_id: "autre", type_contact: "client", reponses: "auto" },
    { client_id: CL, dossier_id: D, type_contact: "client", reponses: "jamais" },
  ];
  for (const c of convs) assert.deepEqual(F.contactVoucher(c, dossier), S.contactVoucher(c, dossier), JSON.stringify(c));
  assert.deepEqual(F.contactVoucher(convs[0], null), S.contactVoucher(convs[0], null));
});

// ---- Légende -----------------------------------------------------------------------------------------------------------------------
test("légende bloquée : un net ou un nom de partenaire, rien de déposé ni d'envoyé", async () => {
  for (const legende of ["Hello Tom, the price is 1500 THB per adult.", "Hello Tom, our partner Lazy Day will pick you up."]) {
    const m = monde();
    const r = await m.envoyer({ legende });
    assert.equal(r.status, 422);
    assert.equal(r.corps.erreur, "contenu_interne");
    assert.ok(r.corps.a_retirer.some((a) => /^(montant_interne|nom_prestataire):/.test(a)), legende);
    assert.equal(m.appels.depots.length, 0);
    assert.equal(m.appels.fetch.length, 0);
  }
  const prix = await monde().envoyer({ legende: "Hello Tom, the tour is 3000 THB, pickup included." });
  assert.equal(prix.status, 200, "un prix de vente passe");
  // La fonction se sert du même contrôle que le texte (contenuInterne d'index.ts).
  const index = lire("supabase/functions/whatsapp-envoi/index.ts");
  assert.match(index, /envoyerVoucherImage\(\s*\{ sb, admin, fetch, cle: Deno\.env\.get\("TELNYX_API_KEY"\) \|\| "", webhook: `\$\{URL_SB\}\/functions\/v1\/whatsapp`, contenuInterne,/);
  assert.match(index, /if \(\(req\.headers\.get\("content-type"\) \|\| ""\)\.startsWith\("multipart\/form-data"\)\) return json\(\.\.\.\(await voucher\(req, autorisation\)\)\);/);
  // Le contrôle se fait avant tout dépôt dans le code.
  const v = lire("supabase/functions/whatsapp-envoi/voucher.js");
  assert.ok(v.indexOf("ctx.contenuInterne(") < v.indexOf("stockage.upload("));
  assert.ok(v.indexOf("coexistence(ctx, numero)") < v.indexOf("stockage.upload("));
  assert.ok(v.indexOf("fenetreTelnyx(ctx, numero") < v.indexOf("stockage.upload("));
});

test("légende : 1024 octets au plus (limite de Telnyx), comptés en octets", () => {
  const base = { conversation_id: C, reservation_id: R };
  assert.equal(S.lireEnvoiVoucher({ ...base, legende: "a".repeat(1024) }).legende.length, 1024);
  assert.deepEqual(S.lireEnvoiVoucher({ ...base, legende: "a".repeat(1025) }), { erreur: "legende_trop_longue" });
  assert.deepEqual(S.lireEnvoiVoucher({ ...base, legende: "é".repeat(513) }), { erreur: "legende_trop_longue" }, "deux octets par lettre accentuée");
  assert.equal(F.legendeValide("é".repeat(512)), true);
  assert.equal(F.legendeValide("é".repeat(513)), false);
  assert.deepEqual(S.lireEnvoiVoucher({ ...base, reservation_id: "x" }), { erreur: "reservation_invalide" });
  assert.deepEqual(S.lireEnvoiVoucher({ conversation_id: "x", reservation_id: R }), { erreur: "conversation_invalide" });
});

// ---- Fichier temporaire --------------------------------------------------------------------------------------------------------------
test("fichier supprimé : refus sûr de Telnyx, message retiré et fichier effacé tout de suite", async () => {
  const m = monde({ envoi: { status: 400, corps: { errors: [{ code: "40008" }] } } });
  const r = await m.envoyer();
  assert.deepEqual([r.status, r.corps.erreur, r.corps.code], [502, "telnyx_refuse", "40008"]);
  assert.ok(m.appels.rpc.some((x) => x.nom === "whatsapp_retirer_envoi" && x.args.p_message === M));
  assert.deepEqual(m.appels.effaces, [{ bucket: "whatsapp-sortant", chemins: [m.appels.depots[0].chemin] }]);
});

test("fichier gardé quand le résultat est inconnu : Telnyx peut encore le lire, la purge l'efface après une heure", async () => {
  for (const envoi of ["coupure", { status: 503, corps: null }, { status: 200, corps: { data: {} } }]) {
    const m = monde({ envoi });
    const r = await m.envoyer();
    assert.deepEqual([r.status, r.corps.erreur, r.corps.message_id], [504, "verifier_whatsapp", M], JSON.stringify(envoi));
    assert.equal(m.appels.effaces.length, 0);
    assert.ok(!m.appels.rpc.some((x) => x.nom === "whatsapp_retirer_envoi"), "le message reste « envoi » dans le fil");
  }
  assert.equal(F.voucherIncertain("verifier_whatsapp"), true);
  assert.equal(F.voucherIncertain("hors_ligne"), true, "connexion coupée pendant l'envoi : peut-être parti");
  assert.match(F.erreurVoucher("inconnu"), /Vérifiez dans WhatsApp/);
});

test("fichier supprimé : au statut « remis », « lu » ou « échec » (fonction whatsapp), et par la purge après une heure", () => {
  assert.deepEqual(["envoye", "remis", "lu", "echec"].map(S.statutLibereFichier), [false, true, true, true], "« envoyé » ne prouve pas que Meta a pris l'image");
  const medias = [S.mediaVoucher({ nom: "V.png", taille: 10, mime: "image/png", chemin: `${ORG}/1-a.png`, reservation_id: R })];
  assert.deepEqual(S.cheminsSortants(medias), [`${ORG}/1-a.png`]);
  assert.deepEqual(S.cheminsSortants(S.sansFichierSortant(medias)), []);
  assert.equal(S.sansFichierSortant(medias)[0].statut, "voucher", "le message garde son média, sans fichier");
  const objets = [
    { id: "1", name: `${MAINTENANT - 61 * 60_000}-a.png`, created_at: new Date(MAINTENANT - 61 * 60_000).toISOString() },
    { id: "2", name: `${MAINTENANT - 30 * 60_000}-b.png`, created_at: new Date(MAINTENANT - 30 * 60_000).toISOString() },
    { id: "3", name: `${MAINTENANT - 2 * 3600_000}-c.png` },
    { id: null, name: "dossier" },
  ];
  assert.deepEqual(S.sortantsAPurger(objets, ORG, MAINTENANT), [`${ORG}/${objets[0].name}`, `${ORG}/${objets[2].name}`]);
  const wa = lire("supabase/functions/whatsapp/index.ts");
  assert.match(wa, /if \(statutLibereFichier\(a\.statut\)\) for \(const m of msgs\) await effacerSortant\(db, m\.id, m\.medias \|\| \[\]\);/);
  assert.match(wa, /select\("id, statut_envoi, medias"\)/);
  assert.match(wa, /await purgerSortants\(db\)\.catch/, "à chaque passage de la reprise (toutes les 5 minutes)");
  assert.match(wa, /stockage\.list\(ORGANISATION, \{ limit: 100, sortBy: \{ column: "created_at", order: "asc" \} \}\)/);
  assert.ok(wa.indexOf("await purgerSortants(db)") < wa.indexOf("await purger(db)"), "pas seulement une fois par heure");
});

test("image : PNG, JPEG ou WebP lus dans les octets, 5 Mo au plus", () => {
  assert.deepEqual(S.imageAcceptee(PNG), { ok: true, mime: "image/png" });
  assert.deepEqual(S.imageAcceptee(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])), { ok: true, mime: "image/jpeg" });
  assert.deepEqual(S.imageAcceptee(new Uint8Array([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBP"), 1])), { ok: true, mime: "image/webp" });
  assert.deepEqual(S.imageAcceptee(new TextEncoder().encode("<svg onload=alert(1)>")), { erreur: "image_invalide" });
  assert.deepEqual(S.imageAcceptee(new Uint8Array()), { erreur: "image_invalide" });
  const gros = new Uint8Array(S.IMAGE_MAX_OCTETS + 1);
  gros.set(PNG);
  assert.deepEqual(S.imageAcceptee(gros), { erreur: "image_trop_grosse" });
  assert.equal(S.cheminSortant(ORG, "../../x", "image/png", 5), `${ORG}/5-x.png`, "un id ne sort jamais du dossier");
});

// ---- Double envoi ------------------------------------------------------------------------------------------------------------------
test("pas de double envoi : le même voucher depuis moins de 2 minutes, ou une demande simultanée, ne repart pas", async () => {
  const m = monde({ recents: [{ id: "x", medias: [{ statut: "voucher", reservation_id: R }] }] });
  const r = await m.envoyer();
  assert.deepEqual([r.status, r.corps.erreur], [409, "deja_traitee"]);
  assert.equal(m.appels.depots.length, 0);
  assert.equal(envoisTelnyx(m.appels).length, 0);
  // Un autre voucher du dossier part, lui.
  assert.equal((await monde({ recents: [{ id: "x", medias: [{ statut: "voucher", reservation_id: "autre" }] }] }).envoyer()).status, 200);
  // Demande simultanée : la base n'a rangé qu'un message (clé unique), la seconde efface son fichier et s'arrête.
  const s = monde({ ranger: { message_id: M, nouveau: false } });
  const r2 = await s.envoyer();
  assert.deepEqual([r2.status, r2.corps.erreur], [409, "deja_traitee"]);
  assert.equal(envoisTelnyx(s.appels).length, 0);
  assert.equal(s.appels.effaces.length, 1);
  assert.equal(S.cleVerrouVoucher(R, MAINTENANT), S.cleVerrouVoucher(R, MAINTENANT + 1000));
  assert.match(F.erreurVoucher("deja_traitee"), /vient de partir/);
});

// ---- Droits ------------------------------------------------------------------------------------------------------------------------
test("droits : session et whatsapp_peut_ecrire, réservation lue avec la session, Secret ou Taxi seulement (ni ZTP ni Mook)", async () => {
  const cas = [
    [{ peutEcrire: false }, "droit_manquant", "lecture seule ou Mook : whatsapp_peut_ecrire"],
    [{ admin: false }, "droit_manquant", "whatsapp_admin de l'entreprise de la réservation"],
    [{ reservation: null }, "droit_manquant", "réservation invisible avec la session"],
    [{ dossier: null }, "droit_manquant", "dossier invisible avec la session"],
    [{ entite: { id: SECRET, organisation_id: ORG, slug: "ztp" } }, "droit_manquant", "réservation de ZTP"],
    [{ entite: { id: SECRET, organisation_id: "autre", slug: "secret" } }, "droit_manquant", "autre organisation"],
    [{ conv: null }, "droit_manquant", "conversation invisible"],
  ];
  for (const [o, code, pourquoi] of cas) {
    const m = monde(o);
    const r = await m.envoyer();
    assert.deepEqual([r.status, r.corps.erreur], [403, code], pourquoi);
    assert.equal(m.appels.fetch.length, 0, pourquoi);
    assert.equal(m.appels.depots.length, 0, pourquoi);
  }
  const annulee = await monde({ reservation: { id: R, entite_id: SECRET, dossier_id: D, statut: "annule" } }).envoyer();
  assert.equal(annulee.corps.erreur, "reservation_annulee");
  const sansCle = monde();
  sansCle.ctx.cle = "";
  assert.equal((await sansCle.envoyer()).corps.erreur, "non_configure");
  const v = lire("supabase/functions/whatsapp-envoi/voucher.js");
  assert.match(v, /sb\.rpc\("whatsapp_peut_ecrire", \{ p_conversation: conv\.id \}\)/);
  assert.match(v, /sb\.from\("reservations"\)/, "réservation lue avec la session, pas la clé de service");
  assert.match(v, /sb\.rpc\("whatsapp_admin", \{ e: r\.data\.entite_id \}\)/);
});

// ---- Écran -------------------------------------------------------------------------------------------------------------------------
test("écran : le bouton n'existe que pour la conversation du client, dans une entreprise que la personne administre", () => {
  const dossier = { id: D, client_id: CL };
  const TAXI = "aaaaaaaa-0000-4000-8000-000000000002";
  const ZTP = "aaaaaaaa-0000-4000-8000-000000000003";
  const conversations = [
    { id: "perso", entite_id: SECRET, client_id: CL, dossier_id: D, reponses: "jamais", type_contact: null, dernier_message_le: "2026-11-21T07:59:00Z" },
    { id: "chauffeur", entite_id: SECRET, client_id: CL, dossier_id: D, reponses: "auto", type_contact: "chauffeur", dernier_message_le: "2026-11-21T07:58:00Z" },
    { id: "client-ancien", entite_id: SECRET, client_id: CL, dossier_id: null, reponses: "auto", type_contact: "client", dernier_message_le: "2026-11-20T07:00:00Z" },
    { id: "client-dossier", entite_id: SECRET, client_id: CL, dossier_id: D, reponses: "auto", type_contact: "client", dernier_message_le: "2026-11-19T07:00:00Z" },
  ];
  assert.equal(F.conversationDuVoucher({ conversations, dossier, admins: [SECRET, TAXI], entiteVoucher: SECRET }).id, "client-dossier", "reliée au dossier d'abord");
  assert.equal(F.conversationDuVoucher({ conversations: conversations.slice(0, 3), dossier, admins: [SECRET], entiteVoucher: SECRET }).id, "client-ancien");
  assert.equal(F.conversationDuVoucher({ conversations: conversations.slice(0, 2), dossier, admins: [SECRET], entiteVoucher: SECRET }), null, "sinon pas de bouton : l'envoi habituel reste");
  assert.equal(F.conversationDuVoucher({ conversations, dossier, admins: [], entiteVoucher: SECRET }), null, "Mook ou rôle sans réglages : rien");
  assert.equal(F.conversationDuVoucher({ conversations, dossier, admins: [SECRET, TAXI], entiteVoucher: ZTP }), null, "voucher de ZTP : rien");
  assert.equal(F.conversationDuVoucher({ conversations, dossier, admins: [TAXI], entiteVoucher: TAXI }), null, "conversation de Secret lue seulement par l'administratrice de Taxi : rien");
  assert.equal(F.conversationDuVoucher({ conversations: [{ ...conversations[3], entite_id: null }], dossier, admins: [TAXI], entiteVoucher: TAXI }).id, "client-dossier", "à trier : un administrateur de Secret ou de Taxi écrit");
  assert.equal(F.conversationDuVoucher({ conversations, dossier: null, admins: [SECRET], entiteVoucher: SECRET }), null);
});

test("écran : numéro masqué en partie, envoi noté dans le dossier, média du fil", () => {
  assert.equal(F.numeroMasque("+447700900311"), "+44 ••••••• 311");
  assert.equal(F.numeroMasque("+66812345678"), "+66 •••••• 678");
  assert.equal(F.numeroMasque(""), "");
  assert.ok(!F.numeroMasque("+447700900311").includes("7700900"), "le milieu du numéro n'est pas affiché");
  assert.equal(envoiANoter({ pour: "client", issue: "gestion", envois: {}, date: "2026-11-21" }), "client");
  assert.equal(envoiANoter({ pour: "client", issue: "gestion", envois: { client: "2026-11-21" }, date: "2026-11-21" }), null);
  assert.equal(etatMedia({ type: "image", statut: "voucher", chemin_sortant: "x" }), "voucher_envoye", "jamais la classe « voucher » des pages A4");
  assert.ok(LIBELLES_MEDIA.voucher_envoye);
  // Le bouton est dans la fenêtre d'envoi et sur la carte de l'Assistant ; rien ne part sans la confirmation.
  const envoi = lire("src/gestion/js/views/voucher-envoi.mjs");
  assert.match(envoi, /boutonVoucherWhatsApp\(\{ x, conversation, fichier: \(\) => fichier, legende: \(\) => message\.client, noter: \(\) => noter\("client", "gestion"\) \}\)/);
  const carte = lire("src/gestion/js/views/agent-cartes-voucher.mjs");
  assert.match(carte, /conversation: conversationPourVoucher\(x\)/);
  assert.match(carte, /confirmerVoucherWhatsApp\(x, \{ conversation, fichier, legende: messageClientVoucher\(x\), avantNavigation: revenir \}\)/);
  const vue = lire("src/gestion/js/views/voucher-whatsapp.mjs");
  assert.match(vue, /if \(!conversation\) return null;/);
  assert.match(vue, /numeroMasque\(c\.telephone\)/);
  assert.match(vue, /voucherSeul: permissionsDe\(e\.id\)\.includes\("vouchers\.seul"\)/);
  assert.ok(vue.indexOf("etat.store.whatsappEnvoyerVoucher(") > vue.indexOf("async function partir()"), "l'envoi part seulement du bouton de la confirmation");
  // Aucune écriture de stockage depuis le navigateur : l'image part avec la demande.
  const store = lire("src/gestion/js/store-supabase.mjs");
  const bloc = store.slice(store.indexOf("async whatsappEnvoyerVoucher"), store.indexOf("async whatsappPreparer"));
  assert.doesNotMatch(bloc, /storage/);
  assert.match(bloc, /new FormData\(\)/);
});

test("démo : l'envoi est simulé sans réseau, un message image apparaît dans le fil", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  const avant = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("aucun appel réseau en démo");
  };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?wav=${Date.now()}`);
    const store = creer();
    const brut = await store.charger();
    // Conversation 3 de la démo : client de Secret relié à son dossier (suivi), a écrit il y a 25 minutes.
    const conv = brut.whatsapp_conversations.find((c) => c.dossier_id && F.contactVoucher(c, brut.dossiers.find((d) => d.id === c.dossier_id)).ok);
    assert.ok(conv, "la démo a une conversation de client reliée à son dossier");
    const resa = brut.reservations.find((r) => r.dossier_id === conv.dossier_id);
    assert.ok(resa, "le dossier a un service");
    const fichier = { name: "Booking confirmation.png", size: 1234 };
    const r = await store.whatsappEnvoyerVoucher({ conversation_id: conv.id, reservation_id: resa.id, legende: "Thank you for choosing us.", fichier });
    assert.deepEqual(r, { ok: true, demo: true });
    const fil = await store.whatsappMessages(conv.id);
    const dernier = fil[fil.length - 1];
    assert.equal(dernier.type, "image");
    assert.equal(dernier.origine, "gestion");
    assert.equal(dernier.statut_envoi, "envoye");
    assert.equal(dernier.texte, "Thank you for choosing us.");
    assert.equal(dernier.medias[0].statut, "voucher");
    // Un contact personnel (le chauffeur de la démo) et une conversation fermée sont refusés comme par la fonction.
    const chauffeur = brut.whatsapp_conversations.find((c) => c.reponses === "jamais");
    assert.ok((await store.whatsappEnvoyerVoucher({ conversation_id: chauffeur.id, reservation_id: resa.id, legende: "", fichier })).erreur);
    // Mook ne lit rien et n'envoie rien.
    const mook = store.utilisateursDemo().find((x) => /vouchers et factures/i.test(x.nom));
    store.changerUtilisateurDemo(mook.id);
    await store.charger();
    assert.deepEqual(await store.whatsappEnvoyerVoucher({ conversation_id: conv.id, reservation_id: resa.id, legende: "", fichier }), { erreur: "droit_manquant" });
  } finally {
    globalThis.fetch = avant;
    delete globalThis.localStorage;
  }
});

test("migration 73 : bucket privé, 5 Mo, aucune politique ; contrôle PGlite branché en CI", () => {
  const sql = lire("docs/gestion/migration-73-whatsapp-voucher.sql");
  assert.match(sql, /insert into storage\.buckets \(id, name, public\) values \('whatsapp-sortant', 'whatsapp-sortant', false\) on conflict \(id\) do nothing;/);
  assert.match(sql, /update storage\.buckets set public = false, file_size_limit = 5242880 where id = 'whatsapp-sortant';/);
  assert.doesNotMatch(sql, /create policy/i, "aucune politique : seule la clé de service y touche");
  assert.ok(fs.existsSync(new URL("../docs/gestion/retour-73-whatsapp-voucher.sql", import.meta.url)));
  assert.match(lire(".github/workflows/ci.yml"), /verif-whatsapp-voucher/);
  assert.equal(S.BUCKET_SORTANT, "whatsapp-sortant");
});
