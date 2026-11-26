// Voucher envoyé en image dans la conversation WhatsApp du client depuis Gestion (21.11.2026, demande de Jérémy, migration 73), avec les
// corrections de la revue de sécurité de la PR 304. La logique de la fonction (supabase/functions/whatsapp-envoi/voucher.js) tourne ici
// avec une base, un stockage et un Telnyx simulés : aucun appel réseau, aucune clé.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { envoyerVoucherImage, viderCacheCoexistence } from "../supabase/functions/whatsapp-envoi/voucher.js";
import * as S from "../supabase/functions/whatsapp-envoi/calc.js";
import * as F from "../src/gestion/js/whatsapp-voucher-calc.mjs";
import { envoiANoter } from "../src/gestion/js/envoi-voucher-calc.mjs";
import { etatMedia, LIBELLES_MEDIA } from "../src/gestion/js/whatsapp-calc.mjs";

const lire = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const ORG = "00000000-0000-0000-0000-00000000a000";
const SECRET = "aaaaaaaa-0000-4000-8000-000000000001";
const TAXI = "aaaaaaaa-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000001";
const R = "bbbbbbbb-0000-4000-8000-000000000001";
const D = "dddddddd-0000-4000-8000-000000000001";
const CL = "eeeeeeee-0000-4000-8000-000000000001";
const M = "ffffffff-0000-4000-8000-000000000001";
const ESSAI = "12121212-0000-4000-8000-000000000001";
const ID_FICHIER = "1234abcd-0000-4000-8000-000000000001";
const MAINTENANT = Date.parse("2026-11-21T08:00:00Z");

// ---- Images de test : en-têtes réels, sans pixel ---------------------------------------------------------------------------------------
const octetsDe = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n) => [(n >>> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >>> 8) & 255];
const le24 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const bloc = (type, donnees = []) => [...be32(donnees.length), ...[...type].map((c) => c.charCodeAt(0)), ...donnees, 0, 0, 0, 0];
const png = (l = 1588, h = 2246, apres = []) => octetsDe([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], bloc("IHDR", [...be32(l), ...be32(h), 8, 6, 0, 0, 0]), bloc("IDAT", [1, 2, 3]), bloc("IEND"), apres);
const jpeg = (l = 1588, h = 2246) => octetsDe([0xff, 0xd8], [0xff, 0xe0, ...be16(16)], "JFIF", [0, 1, 1, 0, 0, 1, 0, 1, 0, 0], [0xff, 0xdb, ...be16(4), 0, 0], [0xff, 0xc0, ...be16(17), 8, ...be16(h), ...be16(l), 3], new Array(9).fill(0), [0xff, 0xd9]);
const webp = (sorte, l = 1588, h = 2246) => {
  const tete = (type, donnees) => octetsDe("RIFF", [0, 0, 0, 0], "WEBP", type, le24(donnees.length), [0], donnees);
  if (sorte === "VP8 ") return tete("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(l), ...le16(h), 0, 0]);
  if (sorte === "VP8L") {
    const b = ((l - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
    return tete("VP8L", [0x2f, b & 255, (b >>> 8) & 255, (b >>> 16) & 255, (b >>> 24) & 255, 0, 0, 0, 0, 0]);
  }
  return tete("VP8X", [0, 0, 0, 0, ...le24(l - 1), ...le24(h - 1), 0, 0]);
};
const PNG = png();

// ---- Monde simulé -------------------------------------------------------------------------------------------------------------------
function monde(o = {}) {
  const w = {
    conv: { id: C, organisation_id: ORG, telephone: "+447700900311", entite_id: SECRET, client_id: CL, dossier_id: D, reponses: "auto", type_contact: "client", partenaire_id: null },
    reservation: { id: R, entite_id: SECRET, dossier_id: D, statut: "confirme" },
    dossier: { id: D, client_id: CL, entite_id: SECRET, annule: false },
    fiche: { telephone: "+44 7700 900311" },
    entite: { id: SECRET, organisation_id: ORG, slug: "secret" },
    peutEcrire: true,
    admin: true,
    dernierEntrant: new Date(MAINTENANT - 10 * 60_000).toISOString(),
    numero: "+447700900100",
    verrou: { message_id: M, nouveau: true },
    coexistence: { status: 200, corps: { data: { phone_number: "+447700900100", coexistence_state: "active", is_on_biz_app: true } } },
    fenetre: { status: 200, corps: { data: { window_active: true, window_expires_at: new Date(MAINTENANT + 3600_000).toISOString() } } },
    envoi: { status: 200, corps: { data: { id: "tx-voucher-1" } } },
    ...o,
  };
  const journal = [];
  const appels = { fetch: [], depots: [], effaces: [], signes: [], rpc: [], maj: [], ordre: [], legendes: [] };
  const resultat = (e) => {
    const f = Object.fromEntries(e.filtres.filter((x) => x[0] === "eq").map((x) => [x[1], x[2]]));
    if (w.lever === e.table) throw new Error("panne réseau");
    if (e.table === "whatsapp_conversations") return { data: f.id === w.conv?.id ? w.conv : null, error: null };
    if (e.table === "reservations") return { data: w.reservation && f.id === w.reservation.id ? w.reservation : null, error: null };
    if (e.table === "dossiers") return { data: w.dossier && f.id === w.dossier.id ? w.dossier : null, error: null };
    if (e.table === "clients") return { data: w.fiche, error: null };
    if (e.table === "entites") return { data: w.entite, error: null };
    if (e.table === "whatsapp_reglages") return { data: { numero: w.numero }, error: null };
    if (e.table === "whatsapp_messages" && e.op === "update") return (appels.maj.push(e.valeurs), { data: [{ id: M }], error: null });
    if (e.table === "whatsapp_messages" && f.sens === "entrant") return w.messagesErreur ? { data: null, error: { message: "x" } } : { data: w.dernierEntrant ? [{ sens: "entrant", envoye_le: w.dernierEntrant }] : [], error: null };
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
        appels.ordre.push(nom);
        if (nom === "whatsapp_peut_ecrire") return { data: w.peutEcrire, error: null };
        if (nom === "whatsapp_admin") return { data: w.admin, error: null };
        if (nom === "whatsapp_ranger_voucher") return { data: w.verrou, error: null };
        if (nom === "whatsapp_ranger") return { data: { message_id: M, nouveau: true }, error: null };
        if (nom === "whatsapp_retirer_envoi") return { data: true, error: null };
        throw new Error(nom);
      },
      storage: {
        from: (bucket) => ({
          upload: async (chemin, octets, opts) => {
            appels.ordre.push("upload");
            if (w.depotLeve) throw new Error("stockage injoignable");
            appels.depots.push({ bucket, chemin, octets, opts });
            return { data: { path: chemin }, error: null };
          },
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
    sb: client(), admin: client(), fetch, cle: "test", webhook: "https://projet.supabase.co/functions/v1/whatsapp", organisation: ORG,
    contenuInterne: async (_a, conv, texte) => {
      appels.legendes.push({ entite_id: conv.entite_id, dossier_id: conv.dossier_id, texte });
      // Comme contenuInterne : un net du service du dossier (1500) bloque, le net d'un autre service (2200) est à confirmer.
      return S.controleEnvoi(texte, { nets: [{ montant: 1500, prestation_id: "p-dossier" }, { montant: 2200, prestation_id: "p-autre" }], servicesEnCours: new Set(["p-dossier"]), ventes: new Set([3000]), prestataires: ["Lazy Day"] });
    },
    uuid: () => ID_FICHIER,
    maintenant: () => w.horloge || MAINTENANT,
    journal: (...x) => journal.push(x.join(" ")),
  };
  const demande = { conversation_id: C, reservation_id: R, essai_id: ESSAI, legende: "Hello Tom,\n\nYour booking is confirmed. See you soon!", numero_confirme: null, octets: PNG, mime: "image/png", nom: "Voucher SEC-1.png" };
  return { w, ctx, appels, demande, journal, envoyer: (d = {}) => envoyerVoucherImage(ctx, { ...demande, ...d }) };
}
const envoisTelnyx = (appels) => appels.fetch.filter((a) => a.url.endsWith("/v2/messages/whatsapp"));

beforeEach(() => viderCacheCoexistence());

// ---- Le chemin qui marche --------------------------------------------------------------------------------------------------------
test("voucher : contrôlé, rangé sous verrou, déposé, URL signée courte, envoyé en image avec sa légende, complété avec l'id Telnyx", async () => {
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
  // Le verrou en base range le message AVANT le dépôt du fichier.
  assert.ok(m.appels.ordre.indexOf("whatsapp_ranger_voucher") < m.appels.ordre.indexOf("upload"));
  const verrou = m.appels.rpc.find((x) => x.nom === "whatsapp_ranger_voucher");
  assert.deepEqual(Object.keys(verrou.args).sort(), ["m", "p_cle", "p_conversation", "p_reservation"]);
  assert.equal(verrou.args.p_cle, `gestion-voucher:${R}:${ESSAI}`, "clé : réservation et identifiant de la confirmation");
  assert.equal(verrou.args.m.texte, m.demande.legende);
  assert.equal(verrou.args.m.medias[0].statut, "voucher");
  assert.equal(verrou.args.m.medias[0].reservation_id, R);
  assert.equal(verrou.args.m.medias[0].chemin, undefined, "jamais un chemin du stockage « whatsapp »");
  // Le fichier : bucket privé, chemin sans rien du client, de la forme que la purge accepte.
  const depot = m.appels.depots[0];
  assert.equal(depot.bucket, "whatsapp-sortant");
  assert.equal(depot.chemin, `${ORG}/${MAINTENANT}-${ID_FICHIER}.png`);
  assert.equal(verrou.args.m.medias[0].chemin_sortant, depot.chemin);
  assert.ok(S.cheminSortantValide(depot.chemin, ORG));
  assert.equal(depot.opts.upsert, false);
  // URL signée de 15 minutes au plus.
  assert.equal(m.appels.signes[0].duree, 900);
  assert.ok(S.URL_SIGNEE_S >= 600 && S.URL_SIGNEE_S <= 900, "entre 10 et 15 minutes");
  // L'envoi.
  const corps = JSON.parse(envoisTelnyx(m.appels)[0].init.body);
  assert.equal(corps.from, "+447700900100");
  assert.equal(corps.to, "+447700900311");
  assert.equal(corps.whatsapp_message.type, "image");
  assert.equal(corps.whatsapp_message.image.caption, m.demande.legende);
  assert.match(corps.whatsapp_message.image.link, /^https:\/\/projet\.supabase\.co\/storage\/v1\/object\/sign\/whatsapp-sortant\/.+\?token=jeton&v=\d+$/, "lien signé, « v » contre le cache de Meta");
  assert.equal(corps.webhook_url, "https://projet.supabase.co/functions/v1/whatsapp");
  assert.equal(envoisTelnyx(m.appels)[0].init.redirect, "error");
  assert.deepEqual(m.appels.maj[0], { telnyx_id: "tx-voucher-1", statut_envoi: "envoye", statut_le: new Date(MAINTENANT).toISOString() });
  // Le fichier reste : Telnyx ne dit pas quand il le télécharge. Il part au statut « remis », « lu » ou « échec », sinon par la purge.
  assert.equal(m.appels.effaces.length, 0);
});

test("voucher : sans légende, l'image part seule", async () => {
  const m = monde();
  assert.equal((await m.envoyer({ legende: "" })).status, 200);
  assert.equal("caption" in JSON.parse(envoisTelnyx(m.appels)[0].init.body).whatsapp_message.image, false);
});

// ---- Point 1 et 2 : verrou -----------------------------------------------------------------------------------------------------------
test("verrou : un envoi précédent au résultat inconnu bloque sans limite de durée, le message dit de vérifier dans WhatsApp", async () => {
  const m = monde({ verrou: { refus: "a_verifier" } });
  const r = await m.envoyer();
  assert.deepEqual([r.status, r.corps.erreur, r.corps.a_verifier], [409, "deja_traitee", true]);
  assert.equal(m.appels.depots.length, 0, "rien de déposé");
  assert.equal(envoisTelnyx(m.appels).length, 0);
  assert.match(F.erreurVoucher("deja_traitee", { aVerifier: true }), /envoi précédent de ce voucher est à vérifier dans WhatsApp/);
  assert.doesNotMatch(F.erreurVoucher("deja_traitee", { aVerifier: true }), /vient de partir/);
  assert.match(F.erreurVoucher("deja_traitee"), /vient de partir/, "parti il y a moins de 2 minutes");
  for (const refus of ["recent", "deja"]) {
    const n = monde({ verrou: { refus } });
    const x = await n.envoyer();
    assert.deepEqual([x.status, x.corps.erreur, x.corps.a_verifier], [409, "deja_traitee", undefined], refus);
    assert.equal(n.appels.depots.length, 0);
  }
  const absent = await monde({ verrou: { refus: "conversation" } }).envoyer();
  assert.equal(absent.corps.erreur, "droit_manquant");
  const rejoue = await monde({ verrou: { message_id: M, nouveau: false } }).envoyer();
  assert.equal(rejoue.corps.erreur, "deja_traitee");
  // L'écran envoie l'identifiant de la confirmation, créé à son ouverture.
  const vue = lire("src/gestion/js/views/voucher-whatsapp.mjs");
  assert.match(vue, /const essai = nouvelEssai\(\);/);
  assert.match(vue, /essai_id: essai,/);
  assert.match(lire("src/gestion/js/store-supabase.mjs"), /corps\.append\("essai_id", essai_id\);/);
  assert.deepEqual(S.lireEnvoiVoucher({ conversation_id: C, reservation_id: R, legende: "" }), { erreur: "demande_invalide" }, "sans identifiant de confirmation, rien");
});

test("verrou : contrôle et rangement d'un seul tenant en base, sous verrou de la conversation (course entre deux demandes)", () => {
  const sql = lire("docs/gestion/migration-73-whatsapp-voucher.sql");
  const f = sql.slice(sql.indexOf("create or replace function whatsapp_ranger_voucher"), sql.indexOf("revoke all on function whatsapp_ranger_voucher"));
  const verrou = f.indexOf("for update");
  assert.ok(verrou > 0, "for update sur la conversation");
  assert.ok(verrou < f.indexOf("'a_verifier'") && verrou < f.indexOf("'recent'") && verrou < f.indexOf("return whatsapp_ranger("), "contrôles et rangement après le verrou");
  assert.match(f, /w\.statut_envoi = 'envoi' or \(w\.statut_envoi = 'echec' and w\.erreur_envoi = 'sans_confirmation'\)/, "envoi incertain, sans limite de durée");
  assert.match(f, /w\.envoye_le >= now\(\) - interval '2 minutes'/);
  assert.match(f, /p_cle !~ \('\^gestion-voucher:' \|\| p_reservation::text \|\| ':\[0-9a-f\]\{8\}/, "clé gestion-voucher:<réservation>:<uuid>");
  assert.match(sql, /revoke all on function whatsapp_ranger_voucher\(uuid, uuid, text, jsonb\) from public, anon, authenticated;/);
  // La course elle-même (deux demandes, la seconde voit la première) est rejouée en base par verif-whatsapp-voucher.mjs.
  const verif = lire("docs/gestion/verif-whatsapp-voucher.mjs");
  assert.match(verif, /course/);
  assert.match(lire("supabase/functions/whatsapp-envoi/voucher.js"), /admin\.rpc\("whatsapp_ranger_voucher"/, "appelée avec la clé de service");
});

// ---- Fenêtre de 24 h -----------------------------------------------------------------------------------------------------------------
test("refus hors fenêtre : vue par la base (dernier message du client il y a plus de 24 h)", async () => {
  const m = monde({ dernierEntrant: new Date(MAINTENANT - 25 * 3600_000).toISOString() });
  const r = await m.envoyer();
  assert.deepEqual([r.status, r.corps.erreur], [409, "fenetre_fermee"]);
  assert.equal(m.appels.depots.length, 0);
  assert.equal(envoisTelnyx(m.appels).length, 0);
  assert.equal((await monde({ dernierEntrant: null }).envoyer()).corps.erreur, "fenetre_fermee", "le client n'a jamais écrit : fermée");
  const erreur = await monde({ messagesErreur: true }).envoyer();
  assert.deepEqual([erreur.status, erreur.corps.erreur], [500, "base"], "une lecture en échec n'est pas une fenêtre fermée (M4)");
});

test("refus hors fenêtre : vue par Telnyx (conversation_window), fin exigée dans le futur, et en cas de doute", async () => {
  for (const fenetre of [
    { status: 200, corps: { data: { window_active: false } } },
    { status: 200, corps: { data: { window_active: true } } },
    { status: 200, corps: { data: { window_active: true, window_expires_at: "bientôt" } } },
    { status: 200, corps: { data: { window_active: true, window_expires_at: new Date(MAINTENANT - 1000).toISOString() } } },
    { status: 200, corps: { data: { window_active: "true", window_expires_at: new Date(MAINTENANT + 1000).toISOString() } } },
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
    assert.equal((await monde({ coexistence }).envoyer()).corps.erreur, "coexistence_inactive", "illisible : refusé");
  }
  assert.match(F.erreurVoucher("coexistence_inactive"), /Envoyez depuis votre téléphone/);
  assert.match(F.erreurVoucher("fenetre_fermee"), /Envoyez depuis votre téléphone/);
  assert.equal(F.voucherIncertain("coexistence_inactive"), false, "rien n'est parti");
});

test("coexistence : gardée 3 minutes au plus, une lecture en échec n'est jamais gardée", async () => {
  const m = monde();
  await m.envoyer();
  m.w.horloge = MAINTENANT + 60_000;
  m.w.fenetre = { status: 200, corps: { data: { window_active: true, window_expires_at: new Date(MAINTENANT + 3600_000).toISOString() } } };
  await m.envoyer({ essai_id: "12121212-0000-4000-8000-000000000002" });
  const lectures = () => m.appels.fetch.filter((a) => /phone_numbers\/%2B447700900100$/.test(a.url)).length;
  assert.equal(lectures(), 1, "relue une fois en une minute");
  m.w.horloge = MAINTENANT + 4 * 60_000;
  m.w.coexistence = { status: 200, corps: { data: { coexistence_state: "disconnected" } } };
  const r = await m.envoyer();
  assert.equal(lectures(), 2, "relue après 3 minutes");
  assert.equal(r.corps.erreur, "coexistence_inactive");
  viderCacheCoexistence();
  const c = monde({ coexistence: "coupure" });
  await c.envoyer();
  c.w.coexistence = { status: 200, corps: { data: { coexistence_state: "active" } } };
  assert.equal((await c.envoyer()).status, 200, "une coupure n'est pas gardée : la demande suivante relit");
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
  const m = monde();
  Object.assign(m.w.conv, { type_contact: null, reponses: "auto", dossier_id: null });
  assert.equal((await m.envoyer()).status, 200, "pas encore typée, réponses automatiques, reliée au client : c'est le client");
  const n = monde();
  Object.assign(n.w.conv, { client_id: null });
  assert.equal((await n.envoyer()).status, 200, "reliée au dossier seulement");
});

// ---- Point 3 : entreprise de la réservation et légende ----------------------------------------------------------------------------
test("légende contrôlée dans l'entreprise de la réservation : conversation de l'autre entreprise refusée, à trier contrôlée sur les deux", async () => {
  const m = monde();
  m.w.conv.entite_id = TAXI;
  const r = await m.envoyer();
  assert.deepEqual([r.status, r.corps.erreur], [403, "conversation_autre_entreprise"]);
  assert.equal(m.appels.legendes.length, 0);
  assert.equal(m.appels.depots.length, 0);
  // À trier : la légende part au contrôle avec entite_id vide, que contenuInterne lit comme Secret et Taxi ensemble.
  const t = monde();
  t.w.conv.entite_id = null;
  assert.equal((await t.envoyer()).status, 200);
  assert.deepEqual(t.appels.legendes.map((x) => x.entite_id), [null]);
  const bloquee = monde();
  bloquee.w.conv.entite_id = null;
  assert.equal((await bloquee.envoyer({ legende: "Our partner Lazy Day picks you up." })).corps.erreur, "contenu_interne");
  const index = lire("supabase/functions/whatsapp-envoi/index.ts");
  const ci = index.slice(index.indexOf("async function contenuInterne"));
  // Revue de la PR 310 : Secret et Taxi ensemble pour une conversation de l'une, de l'autre ou à trier (entitesControlees), fermé si la
  // liste manque.
  assert.match(ci, /\.in\("slug", \["secret", "taxi"\]\);\n  if \(errE\) return ferme;\n  const ids: string\[\] = entitesControlees\(conv, paire \|\| \[\]\);/, "Secret et Taxi, et fermé si la liste manque");
  assert.deepEqual(F.contactVoucher({ entite_id: TAXI, client_id: CL, reponses: "auto", type_contact: "client" }, { id: D, client_id: CL, entite_id: SECRET }), { ok: false, erreur: "conversation_autre_entreprise" });
});

test("le contrôle du contact et du numéro est le même à l'écran et dans la fonction", () => {
  const dossier = { id: D, client_id: CL, entite_id: SECRET };
  const convs = [
    { client_id: CL, dossier_id: D, type_contact: "client", reponses: "auto", entite_id: SECRET },
    { client_id: CL, dossier_id: null, type_contact: null, reponses: "auto", entite_id: null },
    { client_id: null, dossier_id: D, type_contact: null, reponses: "auto", entite_id: SECRET },
    { client_id: CL, dossier_id: D, type_contact: null, reponses: "jamais", entite_id: SECRET },
    { client_id: CL, dossier_id: D, type_contact: "partenaire", reponses: "auto", entite_id: SECRET },
    { client_id: CL, dossier_id: D, type_contact: "apporteur", reponses: "auto", entite_id: SECRET },
    { client_id: "autre", dossier_id: D, type_contact: "client", reponses: "auto", entite_id: SECRET },
    { client_id: null, dossier_id: "autre", type_contact: "client", reponses: "auto", entite_id: SECRET },
    { client_id: CL, dossier_id: D, type_contact: "client", reponses: "auto", entite_id: TAXI },
  ];
  for (const c of convs) for (const ent of [null, SECRET, TAXI]) assert.deepEqual(F.contactVoucher(c, dossier, ent), S.contactVoucher(c, dossier, ent), JSON.stringify([c, ent]));
  assert.deepEqual(F.contactVoucher(convs[0], null), S.contactVoucher(convs[0], null));
  for (const [conv, fiche] of [["+447700900311", "+44 7700 900311"], ["+447700900311", "0044 7700 900311"], ["+447700900311", "07700 900311"], ["+447700900311", ""], ["+447700900311", null], ["+66812345678", "+66 81 234 5679"]]) {
    assert.equal(F.numeroDifferent(conv, fiche), S.numeroDifferent(conv, fiche), `${conv} / ${fiche}`);
  }
});

// ---- Point 6 : téléphone -----------------------------------------------------------------------------------------------------------
test("téléphone : un numéro différent de la fiche client exige numero_confirme égal au numéro de la conversation", async () => {
  assert.equal(S.e164("+44 7700 900311"), "+447700900311");
  assert.equal(S.e164("0044 7700 900311"), "+447700900311");
  assert.equal(S.e164("081 234 5678"), null, "numéro local : pas d'E.164");
  assert.equal(S.numeroDifferent("+447700900311", "+44 7700 900311"), false);
  assert.equal(S.numeroDifferent("+447700900311", ""), false, "sans téléphone sur la fiche : rien à comparer");
  assert.equal(S.numeroDifferent("+447700900311", "07700 900311"), true, "sans indicatif : confirmé par la personne");
  assert.equal(S.numeroDifferent("+447700900311", "+44 7700 900999"), true);
  const m = monde({ fiche: { telephone: "+44 7700 900999" } });
  const r = await m.envoyer();
  assert.deepEqual([r.status, r.corps.erreur], [409, "numero_a_confirmer"]);
  assert.equal(m.appels.fetch.length, 0);
  assert.equal((await monde({ fiche: { telephone: "+44 7700 900999" } }).envoyer({ numero_confirme: "+447700900999" })).corps.erreur, "numero_a_confirmer", "le numéro de la fiche ne vaut pas confirmation");
  assert.equal((await monde({ fiche: { telephone: "+44 7700 900999" } }).envoyer({ numero_confirme: "+447700900311" })).status, 200);
  assert.equal((await monde({ fiche: null }).envoyer()).status, 200, "fiche sans téléphone lisible : rien à comparer");
  assert.equal(S.lireEnvoiVoucher({ conversation_id: C, reservation_id: R, essai_id: ESSAI, numero_confirme: "0812345678" }).numero_confirme, null);
  const vue = lire("src/gestion/js/views/voucher-whatsapp.mjs");
  assert.match(vue, /autreNumero \? numeroAffiche\(c\.telephone\) : numeroMasque\(c\.telephone\)/, "numéro complet quand il diffère");
  assert.match(vue, /numero_confirme: autreNumero && confirmeNumero\.checked \? c\.telephone : ""/);
  assert.match(vue, /\(autreNumero && !confirmeNumero\.checked\)/, "le bouton reste éteint tant que ce n'est pas coché");
});

// ---- Légende -----------------------------------------------------------------------------------------------------------------------
test("légende avec le net d'un autre service (faux blocage du 21.11.2026) : 409 à confirmer, puis envoyée avec la confirmation exacte", async () => {
  const m = monde();
  const r = await m.envoyer({ legende: "Hello Tom, total 2,200 THB." });
  assert.deepEqual([r.status, r.corps], [409, { erreur: "montant_a_confirmer", a_confirmer: [2200], portee: "autre_service" }]);
  assert.equal(m.appels.depots.length, 0, "rien de déposé");
  assert.equal(m.appels.fetch.length, 0, "rien d'envoyé");
  assert.equal((await m.envoyer({ legende: "Hello Tom, total 2,200 THB.", montants_confirmes: [2200, 300] })).status, 409, "une autre liste redemande");
  const ok = await monde().envoyer({ legende: "Hello Tom, total 2,200 THB.", montants_confirmes: [2200] });
  assert.equal(ok.status, 200);
  // Le net d'un service du dossier ne se confirme jamais.
  assert.equal((await monde().envoyer({ legende: "Hello Tom, 1500 THB per adult.", montants_confirmes: [1500] })).status, 422);
  // Le contrôle voit le dossier de la réservation quand la conversation n'en a pas.
  const t = monde();
  t.w.conv.dossier_id = null;
  await t.envoyer();
  assert.deepEqual(t.appels.legendes.map((x) => x.dossier_id), [D]);
});

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
  assert.equal((await monde().envoyer({ legende: "Hello Tom, the tour is 3000 THB, pickup included." })).status, 200, "un prix de vente passe");
  const v = lire("supabase/functions/whatsapp-envoi/voucher.js");
  assert.ok(v.indexOf("ctx.contenuInterne(") < v.indexOf("stockage.upload("));
  assert.ok(v.indexOf("coexistence(ctx, numero)") < v.indexOf("stockage.upload("));
  assert.ok(v.indexOf("fenetreTelnyx(ctx, numero") < v.indexOf("stockage.upload("));
});

test("légende : 1024 octets au plus (limite de Telnyx), comptés en octets", () => {
  const base = { conversation_id: C, reservation_id: R, essai_id: ESSAI };
  assert.equal(S.lireEnvoiVoucher({ ...base, legende: "a".repeat(1024) }).legende.length, 1024);
  assert.deepEqual(S.lireEnvoiVoucher({ ...base, legende: "a".repeat(1025) }), { erreur: "legende_trop_longue" });
  assert.deepEqual(S.lireEnvoiVoucher({ ...base, legende: "é".repeat(513) }), { erreur: "legende_trop_longue" }, "deux octets par lettre accentuée");
  assert.equal(F.legendeValide("é".repeat(512)), true);
  assert.equal(F.legendeValide("é".repeat(513)), false);
  assert.deepEqual(S.lireEnvoiVoucher({ ...base, reservation_id: "x" }), { erreur: "reservation_invalide" });
  assert.deepEqual(S.lireEnvoiVoucher({ ...base, conversation_id: "x" }), { erreur: "conversation_invalide" });
});

// ---- Point 4 : image -----------------------------------------------------------------------------------------------------------------
test("image : type et dimensions lus dans l'en-tête (IHDR, SOF, VP8, VP8L, VP8X), 4096 px au plus, rien après IEND", () => {
  assert.deepEqual(S.imageAcceptee(png()), { ok: true, mime: "image/png", largeur: 1588, hauteur: 2246 });
  assert.deepEqual(S.imageAcceptee(jpeg()), { ok: true, mime: "image/jpeg", largeur: 1588, hauteur: 2246 });
  for (const sorte of ["VP8 ", "VP8L", "VP8X"]) assert.deepEqual(S.imageAcceptee(webp(sorte)), { ok: true, mime: "image/webp", largeur: 1588, hauteur: 2246 }, sorte);
  assert.deepEqual(S.imageAcceptee(png(4096, 4096)).ok, true, "4096 px : accepté");
  assert.deepEqual(S.imageAcceptee(png(4097, 100)), { erreur: "image_trop_grande" });
  assert.deepEqual(S.imageAcceptee(png(100, 5000)), { erreur: "image_trop_grande" });
  assert.deepEqual(S.imageAcceptee(jpeg(5000, 100)), { erreur: "image_trop_grande" });
  assert.deepEqual(S.imageAcceptee(webp("VP8X", 100, 8000)), { erreur: "image_trop_grande" });
  assert.deepEqual(S.imageAcceptee(webp("VP8L", 4100, 100)), { erreur: "image_trop_grande" });
  assert.deepEqual(S.imageAcceptee(png(1588, 2246, [...new TextEncoder().encode("PK fichier caché")])), { erreur: "image_invalide" }, "octets après IEND");
  assert.deepEqual(S.imageAcceptee(png(0, 10)), { erreur: "image_invalide" });
  const sansFin = png().slice(0, -12);
  assert.deepEqual(S.imageAcceptee(sansFin), { erreur: "image_invalide" }, "PNG sans IEND");
  assert.deepEqual(S.imageAcceptee(new TextEncoder().encode("<svg onload=alert(1)>")), { erreur: "image_invalide" });
  assert.deepEqual(S.imageAcceptee(new Uint8Array()), { erreur: "image_invalide" });
  const gros = new Uint8Array(S.IMAGE_MAX_OCTETS + 1);
  gros.set(PNG);
  assert.deepEqual(S.imageAcceptee(gros), { erreur: "image_trop_grosse" });
  assert.match(F.erreurVoucher("image_trop_grande"), /4096 pixels/);
  assert.match(lire("docs/gestion/whatsapp.md"), /Risque accepté[^\n]*l'image n'est pas liée au voucher/);
});

// ---- Point 5 et 9 : session d'abord, corps borné, erreurs avant le rangement ------------------------------------------------------
test("fonction : session vérifiée avant de lire le corps, corps lu en flux (6 Mo au plus), erreur avant le rangement rendue « base » en JSON", async () => {
  const index = lire("supabase/functions/whatsapp-envoi/index.ts");
  const v = index.slice(index.indexOf("async function voucher("), index.indexOf("async function lireBorne("));
  assert.ok(v.indexOf("sb.auth.getUser()") < v.indexOf("lireBorne(req, CORPS_MAX_OCTETS)"), "getUser avant le corps");
  assert.ok(!/req\.formData\(\)/.test(v), "plus de formData() sur la demande brute");
  assert.match(v, /new Response\(brut, \{ headers: \{ "content-type": req\.headers\.get\("content-type"\) \|\| "" \} \}\)\.formData\(\)/);
  assert.match(v, /\} catch \(err\) \{[\s\S]{0,200}return \[\{ erreur: "base" \}, 500\];/);
  assert.match(index, /if \(total > max\) \{\s+await lecteur\.cancel\(\);\s+return null;/);
  assert.equal(S.CORPS_MAX_OCTETS, 6 * 1024 * 1024);
  // Une exception avant le rangement remonte à index.ts (« base ») sans rien ranger ni déposer.
  const m = monde({ lever: "dossiers" });
  await assert.rejects(m.envoyer());
  assert.equal(m.appels.depots.length, 0);
  assert.ok(!m.appels.ordre.includes("whatsapp_ranger_voucher"));
  // Après le rangement, une exception est prise ici : message retiré, rien n'est parti.
  const n = monde({ depotLeve: true });
  const r = await n.envoyer();
  assert.deepEqual([r.status, r.corps.erreur], [500, "base"]);
  assert.ok(n.appels.rpc.some((x) => x.nom === "whatsapp_retirer_envoi"));
  assert.equal(envoisTelnyx(n.appels).length, 0);
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
    assert.ok(!m.appels.rpc.some((x) => x.nom === "whatsapp_retirer_envoi"), "le message reste « envoi » dans le fil, et bloque un nouvel envoi");
  }
  assert.equal(F.voucherIncertain("verifier_whatsapp"), true);
  assert.equal(F.voucherIncertain("hors_ligne"), true, "connexion coupée pendant l'envoi : peut-être parti");
});

test("fichier supprimé : au statut « remis », « lu » ou « échec », par la purge après une heure, seulement des chemins attendus", () => {
  assert.deepEqual(["envoye", "remis", "lu", "echec"].map(S.statutLibereFichier), [false, true, true, true], "« envoyé » ne prouve pas que Meta a pris l'image");
  const bon = `${ORG}/${MAINTENANT}-${ID_FICHIER}.png`;
  const medias = [S.mediaVoucher({ nom: "V.png", taille: 10, mime: "image/png", chemin: bon, reservation_id: R })];
  assert.deepEqual(S.cheminsSortants(medias, ORG), [bon]);
  assert.deepEqual(S.cheminsSortants(S.sansFichierSortant(medias), ORG), []);
  for (const mauvais of [`${ORG}/../whatsapp/x.png`, `${ORG}/1-a.png`, `autre/${MAINTENANT}-${ID_FICHIER}.png`, `${ORG}/${MAINTENANT}-${ID_FICHIER}.svg`, `${ORG}/sous/${MAINTENANT}-${ID_FICHIER}.png`, `bbbbbbbb-0000-4000-8000-00000000a000/${MAINTENANT}-${ID_FICHIER}.png`]) {
    assert.deepEqual(S.cheminsSortants([{ chemin_sortant: mauvais }], ORG), [], mauvais);
  }
  assert.equal(S.sansFichierSortant(medias)[0].statut, "voucher", "le message garde son média, sans fichier");
  const objets = [
    { id: "1", name: `${MAINTENANT - 61 * 60_000}-${ID_FICHIER}.png`, created_at: new Date(MAINTENANT - 61 * 60_000).toISOString() },
    { id: "2", name: `${MAINTENANT - 30 * 60_000}-${ID_FICHIER}.png`, created_at: new Date(MAINTENANT - 30 * 60_000).toISOString() },
    { id: "3", name: `${MAINTENANT - 2 * 3600_000}-${ID_FICHIER}.jpg` },
    { id: "4", name: `${MAINTENANT - 2 * 3600_000}-autre.png` },
    { id: null, name: "dossier" },
  ];
  assert.deepEqual(S.sortantsAPurger(objets, ORG, MAINTENANT), [`${ORG}/${objets[0].name}`, `${ORG}/${objets[2].name}`]);
  const wa = lire("supabase/functions/whatsapp/index.ts");
  assert.match(wa, /if \(statutLibereFichier\(a\.statut\)\) for \(const m of msgs\) await effacerSortant\(db, m\.id, m\.medias \|\| \[\]\);/);
  assert.match(wa, /const chemins = cheminsSortants\(medias, ORGANISATION\);/);
  assert.match(wa, /select\("id, statut_envoi, medias(?:, meta_id)?"\)/);
  assert.match(wa, /await purgerSortants\(db\)\.catch/, "à chaque passage de la reprise (toutes les 5 minutes)");
  assert.ok(wa.indexOf("await purgerSortants(db)") < wa.indexOf("await purger(db)"), "pas seulement une fois par heure");
});

// ---- Point 7 : une seule organisation ------------------------------------------------------------------------------------------------
test("purge : aucun dépôt pour une autre organisation que celle de la fonction « whatsapp »", async () => {
  const m = monde();
  m.ctx.organisation = "99999999-0000-4000-8000-00000000a000";
  const r = await m.envoyer();
  assert.deepEqual([r.status, r.corps.erreur], [503, "non_configure"]);
  assert.equal(m.appels.depots.length, 0);
  const sans = monde();
  sans.ctx.organisation = "";
  assert.equal((await sans.envoyer()).corps.erreur, "non_configure");
  assert.match(lire("supabase/functions/whatsapp-envoi/index.ts"), /organisation: Deno\.env\.get\("WHATSAPP_ORGANISATION"\) \|\| "00000000-0000-0000-0000-00000000a000"/);
  assert.match(lire("supabase/functions/whatsapp/index.ts"), /const ORGANISATION = Deno\.env\.get\("WHATSAPP_ORGANISATION"\) \|\| "00000000-0000-0000-0000-00000000a000";/, "même secret, même défaut des deux côtés");
});

// ---- Droits ------------------------------------------------------------------------------------------------------------------------
test("droits : session et whatsapp_peut_ecrire, réservation lue avec la session, Secret ou Taxi seulement (ni ZTP ni Mook)", async () => {
  const cas = [
    [{ peutEcrire: false }, "lecture seule ou Mook : whatsapp_peut_ecrire"],
    [{ admin: false }, "whatsapp_admin de l'entreprise de la réservation"],
    [{ reservation: null }, "réservation invisible avec la session"],
    [{ dossier: null }, "dossier invisible avec la session"],
    [{ entite: { id: SECRET, organisation_id: ORG, slug: "ztp" } }, "réservation de ZTP"],
    [{ entite: { id: SECRET, organisation_id: "autre", slug: "secret" } }, "autre organisation"],
    [{ conv: null }, "conversation invisible"],
  ];
  for (const [o, pourquoi] of cas) {
    const m = monde(o);
    const r = await m.envoyer();
    assert.deepEqual([r.status, r.corps.erreur], [403, "droit_manquant"], pourquoi);
    assert.equal(m.appels.fetch.length, 0, pourquoi);
    assert.equal(m.appels.depots.length, 0, pourquoi);
  }
  assert.equal((await monde({ reservation: { id: R, entite_id: SECRET, dossier_id: D, statut: "annule" } }).envoyer()).corps.erreur, "reservation_annulee");
  const sansCle = monde();
  sansCle.ctx.cle = "";
  assert.equal((await sansCle.envoyer()).corps.erreur, "non_configure");
  const v = lire("supabase/functions/whatsapp-envoi/voucher.js");
  assert.match(v, /sb\.rpc\("whatsapp_peut_ecrire", \{ p_conversation: conv\.id \}\)/);
  assert.match(v, /sb\.from\("reservations"\)/, "réservation lue avec la session, pas la clé de service");
  assert.match(v, /sb\.from\("clients"\)/, "fiche client lue avec la session");
  assert.match(v, /sb\.rpc\("whatsapp_admin", \{ e: r\.data\.entite_id \}\)/);
});

// ---- Écran -------------------------------------------------------------------------------------------------------------------------
test("écran : le bouton n'existe que pour la conversation du client, dans une entreprise que la personne administre", () => {
  const dossier = { id: D, client_id: CL, entite_id: SECRET };
  const ZTP = "aaaaaaaa-0000-4000-8000-000000000003";
  const conversations = [
    { id: "perso", entite_id: SECRET, client_id: CL, dossier_id: D, reponses: "jamais", type_contact: null, dernier_message_le: "2026-11-21T07:59:00Z" },
    { id: "chauffeur", entite_id: SECRET, client_id: CL, dossier_id: D, reponses: "auto", type_contact: "chauffeur", dernier_message_le: "2026-11-21T07:58:00Z" },
    { id: "client-taxi", entite_id: TAXI, client_id: CL, dossier_id: D, reponses: "auto", type_contact: "client", dernier_message_le: "2026-11-21T07:57:00Z" },
    { id: "client-ancien", entite_id: SECRET, client_id: CL, dossier_id: null, reponses: "auto", type_contact: "client", dernier_message_le: "2026-11-20T07:00:00Z" },
    { id: "client-dossier", entite_id: SECRET, client_id: CL, dossier_id: D, reponses: "auto", type_contact: "client", dernier_message_le: "2026-11-19T07:00:00Z" },
  ];
  assert.equal(F.conversationDuVoucher({ conversations, dossier, admins: [SECRET, TAXI], entiteVoucher: SECRET }).id, "client-dossier", "reliée au dossier d'abord, jamais celle de l'autre entreprise");
  assert.equal(F.conversationDuVoucher({ conversations: conversations.slice(0, 4), dossier, admins: [SECRET, TAXI], entiteVoucher: SECRET }).id, "client-ancien");
  assert.equal(F.conversationDuVoucher({ conversations: conversations.slice(0, 3), dossier, admins: [SECRET, TAXI], entiteVoucher: SECRET }), null, "sinon pas de bouton : l'envoi habituel reste");
  assert.equal(F.conversationDuVoucher({ conversations, dossier, admins: [], entiteVoucher: SECRET }), null, "Mook ou rôle sans réglages : rien");
  assert.equal(F.conversationDuVoucher({ conversations, dossier, admins: [SECRET, TAXI], entiteVoucher: ZTP }), null, "voucher de ZTP : rien");
  assert.equal(F.conversationDuVoucher({ conversations, dossier, admins: [TAXI], entiteVoucher: TAXI }).id, "client-taxi");
  assert.equal(F.conversationDuVoucher({ conversations: conversations.filter((c) => c.entite_id === SECRET), dossier, admins: [TAXI], entiteVoucher: TAXI }), null, "conversation de Secret, voucher de Taxi : rien");
  assert.equal(F.conversationDuVoucher({ conversations: [{ ...conversations[4], entite_id: null }], dossier, admins: [TAXI], entiteVoucher: TAXI }).id, "client-dossier", "à trier : un administrateur de Secret ou de Taxi écrit");
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
  const envoi = lire("src/gestion/js/views/voucher-envoi.mjs");
  assert.match(envoi, /boutonVoucherWhatsApp\(\{ x, conversation, fichier: \(\) => fichier, legende: \(\) => message\.client, noter: \(\) => noter\("client", "gestion"\)(, classe: "principal"(, libelle: tr\("Envoyer dans la conversation"\))?)? \}\)/);
  const carte = lire("src/gestion/js/views/agent-cartes-voucher.mjs");
  assert.match(carte, /conversation: conversationPourVoucher\(x\)/);
  assert.match(carte, /confirmerVoucherWhatsApp\(x, \{ conversation, fichier, legende: messageClientVoucher\(x\), avantNavigation: revenir \}\)/);
  const vue = lire("src/gestion/js/views/voucher-whatsapp.mjs");
  assert.match(vue, /if \(!conversation\) return null;/);
  assert.match(vue, /voucherSeul: permissionsDe\(e\.id\)\.includes\("vouchers\.seul"\)/);
  assert.ok(vue.indexOf("etat.store.whatsappEnvoyerVoucher(") > vue.indexOf("async function partir()"), "l'envoi part seulement du bouton de la confirmation");
  const store = lire("src/gestion/js/store-supabase.mjs");
  const bloc = store.slice(store.indexOf("async whatsappEnvoyerVoucher"), store.indexOf("async whatsappPreparer"));
  assert.doesNotMatch(bloc, /storage/, "aucune écriture de stockage depuis le navigateur");
  assert.match(bloc, /new FormData\(\)/);
});

test("démo : l'envoi est simulé sans réseau, un message image apparaît dans le fil, un envoi incertain bloque", async () => {
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
    const conv = brut.whatsapp_conversations.find((c) => c.dossier_id && F.contactVoucher(c, brut.dossiers.find((d) => d.id === c.dossier_id)).ok);
    assert.ok(conv, "la démo a une conversation de client reliée à son dossier");
    const resa = brut.reservations.find((r) => r.dossier_id === conv.dossier_id);
    assert.ok(resa, "le dossier a un service");
    const fichier = { name: "Booking confirmation.png", size: 1234 };
    const dossier = brut.dossiers.find((d) => d.id === conv.dossier_id);
    const fiche = brut.clients.find((c) => c.id === dossier.client_id);
    const differe = F.numeroDifferent(conv.telephone, fiche && fiche.telephone);
    if (differe) assert.deepEqual(await store.whatsappEnvoyerVoucher({ conversation_id: conv.id, reservation_id: resa.id, legende: "x", fichier }), { erreur: "numero_a_confirmer" });
    const r = await store.whatsappEnvoyerVoucher({ conversation_id: conv.id, reservation_id: resa.id, legende: "Thank you for choosing us.", numero_confirme: conv.telephone, fichier });
    assert.deepEqual(r, { ok: true, demo: true });
    const fil = await store.whatsappMessages(conv.id);
    const dernier = fil[fil.length - 1];
    assert.equal(dernier.type, "image");
    assert.equal(dernier.origine, "gestion");
    assert.equal(dernier.statut_envoi, "envoye");
    assert.equal(dernier.texte, "Thank you for choosing us.");
    assert.equal(dernier.medias[0].statut, "voucher");
    const chauffeur = brut.whatsapp_conversations.find((c) => c.reponses === "jamais");
    assert.ok((await store.whatsappEnvoyerVoucher({ conversation_id: chauffeur.id, reservation_id: resa.id, legende: "", fichier })).erreur);
    const mook = store.utilisateursDemo().find((x) => /vouchers et factures/i.test(x.nom));
    store.changerUtilisateurDemo(mook.id);
    await store.charger();
    assert.deepEqual(await store.whatsappEnvoyerVoucher({ conversation_id: conv.id, reservation_id: resa.id, legende: "", fichier }), { erreur: "droit_manquant" });
  } finally {
    globalThis.fetch = avant;
    delete globalThis.localStorage;
  }
});

test("migration 73 : bucket privé, 5 Mo, aucune politique, garde-fou sans bucket_id ; retour et contrôle PGlite branché en CI", () => {
  const sql = lire("docs/gestion/migration-73-whatsapp-voucher.sql");
  assert.match(sql, /insert into storage\.buckets \(id, name, public\) values \('whatsapp-sortant', 'whatsapp-sortant', false\) on conflict \(id\) do nothing;/);
  assert.match(sql, /update storage\.buckets set public = false, file_size_limit = 5242880 where id = 'whatsapp-sortant';/);
  assert.doesNotMatch(sql, /create policy/i, "aucune politique : seule la clé de service y touche");
  assert.match(sql, /not like '%bucket_id%'[\s\S]{0,200}raise exception 'Politique « % » sur storage\.objects sans bucket_id/);
  const retour = lire("docs/gestion/retour-73-whatsapp-voucher.sql");
  assert.match(retour, /storage\.protect_delete/);
  assert.match(retour, /Storage > whatsapp-sortant > Delete bucket/);
  assert.match(retour, /drop function if exists whatsapp_ranger_voucher\(uuid, uuid, text, jsonb\);/);
  assert.match(lire(".github/workflows/ci.yml"), /verif-whatsapp-voucher/);
  assert.equal(S.BUCKET_SORTANT, "whatsapp-sortant");
});
