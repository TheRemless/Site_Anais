// Boîte WhatsApp de Gestion (écran #/whatsapp, migrations 58 et 59, 20.11.2026) : tri, filtres, badge, lien wa.me, avertissements de l'agent,
// fenêtre de 24 h, démo, droits et branchement dans l'outil (route, menu, direct, réglages, suivi de l'assistant).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as W from "../src/gestion/js/whatsapp-calc.mjs";
import { ecranDeLecture } from "../src/gestion/js/direct-calc.mjs";
import { suiviAssistant, USAGES_SUIVIS, UTILISATEUR_WHATSAPP } from "../src/gestion/js/assistant-suivi-calc.mjs";
import { whatsappDemo } from "../src/gestion/js/demo-whatsapp.mjs";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (f) => fs.readFileSync(path.join(RACINE, "src/gestion/js", f), "utf8");
const SECRET = { id: "s", slug: "secret", nom: "Secret Travel & Tour" };
const TAXI = { id: "t", slug: "taxi", nom: "VIP Taxi Lanta" };
const ZTP = { id: "z", slug: "ztp", nom: "Zwald Travel Planner" };
const marqueDe = (id) => W.marqueEntite([SECRET, TAXI, ZTP].find((e) => e.id === id));
const conv = (id, o = {}) => ({ id, telephone: "+447700900111", nom: null, entite_id: null, non_lus: 0, dernier_message_le: null, dernier_sens: null, created_at: "2026-11-01T00:00:00Z", ...o });

test("entreprises du numéro : Secret (excursions en démo) et Taxi, jamais ZTP", () => {
  assert.equal(W.marqueEntite(SECRET), "secret");
  assert.equal(W.marqueEntite({ slug: "excursions" }), "secret", "la démo appelle Secret « excursions »");
  assert.equal(W.marqueEntite(TAXI), "taxi");
  assert.equal(W.marqueEntite(ZTP), null);
  assert.equal(W.marqueEntite(null), null);
});

test("qui lit la boîte : un administrateur de Secret ou de Taxi qui voit toute l'entreprise, jamais Mook", () => {
  const admin = { permissions: ["reglages.ecrire", "dossiers.lire"], voitTout: true };
  assert.equal(W.lecteurWhatsApp({ entite: TAXI, ...admin }), true);
  assert.equal(W.lecteurWhatsApp({ entite: ZTP, ...admin }), false, "ZTP n'a pas le numéro");
  assert.equal(W.lecteurWhatsApp({ entite: TAXI, permissions: ["reglages.ecrire"], voitTout: false }), false, "portée « mes dossiers »");
  assert.equal(W.lecteurWhatsApp({ entite: TAXI, permissions: ["dossiers.lire", "vouchers.seul"], voitTout: true }), false, "Mook n'a pas les réglages");
  assert.equal(W.lecteurWhatsApp({ entite: TAXI, superAdmin: true, voucherSeul: true }), false, "l'écran « Nouveau voucher » seul n'a jamais la boîte");
  assert.equal(W.lecteurWhatsApp({ entite: SECRET, superAdmin: true }), true);
});

test("liste : la plus récente en haut, une conversation sans message en bas", () => {
  const liste = W.trierConversations([conv("a", { dernier_message_le: "2026-11-20T08:00:00Z" }), conv("neuve", { created_at: "2026-11-20T09:00:00Z" }), conv("b", { dernier_message_le: "2026-11-20T10:00:00Z" }), conv("c", { dernier_message_le: "2026-11-19T10:00:00Z" })]);
  assert.deepEqual(liste.map((c) => c.id), ["b", "a", "c", "neuve"]);
});

test("filtres À trier / Secret / Taxi / Toutes et leurs chiffres", () => {
  const convs = [conv("trier1"), conv("trier2"), conv("s1", { entite_id: "s", non_lus: 2 }), conv("s2", { entite_id: "s" }), conv("t1", { entite_id: "t" })];
  const props = [{ id: "p1", conversation_id: "t1", statut: "a_faire", cree_le: "2026-11-20T10:00:00Z" }, { id: "p2", conversation_id: "s2", statut: "traitee", cree_le: "2026-11-20T10:00:00Z" }];
  assert.deepEqual(W.filtrerConversations(convs, "a_trier", marqueDe).map((c) => c.id), ["trier1", "trier2"]);
  assert.deepEqual(W.filtrerConversations(convs, "secret", marqueDe).map((c) => c.id), ["s1", "s2"]);
  assert.deepEqual(W.filtrerConversations(convs, "taxi", marqueDe).map((c) => c.id), ["t1"]);
  assert.equal(W.filtrerConversations(convs, "toutes", marqueDe).length, 5);
  assert.deepEqual(W.chiffresFiltres(convs, props, marqueDe), { a_trier: 2, secret: 1, taxi: 1, toutes: 2 });
  assert.deepEqual(W.FILTRES.map((f) => f.valeur), ["a_trier", "secret", "taxi", "toutes"]);
  assert.equal(W.filtreDeDepart(convs), "a_trier", "quelque chose à ranger : on commence par là");
  assert.equal(W.filtreDeDepart([conv("s", { entite_id: "s" })]), "toutes");
});

test("badge du menu : conversations avec des non-lus ou une réponse prête, une seule fois chacune", () => {
  const convs = [conv("a", { non_lus: 3 }), conv("b"), conv("c", { non_lus: 1 }), conv("d")];
  const props = [
    { id: "1", conversation_id: "b", statut: "a_faire", cree_le: "2026-11-20T10:00:00Z" },
    { id: "2", conversation_id: "c", statut: "a_faire", cree_le: "2026-11-20T10:00:00Z" },
    // Une réponse plus récente déjà traitée remplace l'ancienne à faire : rien à faire pour « d ».
    { id: "3", conversation_id: "d", statut: "a_faire", cree_le: "2026-11-20T08:00:00Z" },
    { id: "4", conversation_id: "d", statut: "traitee", cree_le: "2026-11-20T09:00:00Z" },
  ];
  assert.equal(W.badgeWhatsApp(convs, props), 3);
  assert.equal(W.badgeWhatsApp([], []), 0);
});

test("proposition courante : la plus récente, jamais une remplacée", () => {
  const props = [
    { id: "vieille", conversation_id: "a", statut: "ignoree", cree_le: "2026-11-19T10:00:00Z" },
    { id: "remplacee", conversation_id: "a", statut: "remplacee", cree_le: "2026-11-20T11:00:00Z" },
    { id: "neuve", conversation_id: "a", statut: "a_faire", cree_le: "2026-11-20T10:00:00Z" },
    { id: "autre", conversation_id: "b", statut: "en_cours", cree_le: "2026-11-20T12:00:00Z" },
  ];
  assert.equal(W.propositionCourante(props, "a").id, "neuve");
  assert.equal(W.propositionCourante(props, "b").id, "autre");
  assert.equal(W.propositionCourante(props, "x"), null);
  assert.equal(W.etatConversation(conv("a"), { statut: "a_faire" }).cle, "prete");
  assert.equal(W.etatConversation(conv("a"), { statut: "en_cours" }).cle, "en_cours");
  assert.equal(W.etatConversation(conv("a"), { statut: "echec" }).cle, "echec");
  assert.equal(W.etatConversation(conv("a", { dernier_sens: "sortant" }), null).cle, "repondu");
  assert.equal(W.etatConversation(conv("a", { dernier_sens: "entrant" }), { statut: "traitee" }).cle, "attend");
});

test("lien wa.me : les chiffres du numéro seulement, rien pour un numéro vide", () => {
  assert.equal(W.lienWhatsApp("+66 81 234 5678"), "https://wa.me/66812345678");
  assert.equal(W.lienWhatsApp("+447700900111"), "https://wa.me/447700900111");
  assert.equal(W.lienWhatsApp(""), null);
  assert.equal(W.lienWhatsApp(null), null);
  assert.equal(W.numeroAffiche("+447700900111"), "+44 7700900111");
});

test("nom affiché : le client relié, sinon le profil WhatsApp, sinon le numéro", () => {
  assert.equal(W.nomConversation(conv("a", { nom: "Tom" }), { prenom: "Thomas", nom: "Lee" }), "Thomas Lee");
  assert.equal(W.nomConversation(conv("a", { nom: "Tom" }), null), "Tom");
  assert.equal(W.nomConversation(conv("a", { nom: "  " }), null), "+44 7700900111");
});

test("avertissements de l'agent : en clair, avec leur valeur, les alertes d'abord", () => {
  const a = W.libelleAvertissement("montant_non_source:1500");
  assert.equal(a.niveau, "alerte");
  assert.deepEqual(a.vars, { valeur: "1500" });
  assert.match(a.texte, /\{valeur\}/);
  assert.deepEqual(W.libelleAvertissement("heure_non_source:08:30").vars, { valeur: "08:30" }, "l'heure garde ses deux-points");
  assert.equal(W.libelleAvertissement("mot_interne:net").vars.valeur, "net");
  assert.equal(W.libelleAvertissement("signature_retiree").niveau, "info");
  for (const code of ["nom_prestataire", "prenom_equipe"]) assert.equal(W.libelleAvertissement(code).niveau, "alerte", code);
  const inconnu = W.libelleAvertissement("nouveau_controle:x");
  assert.equal(inconnu.vars.valeur, "nouveau_controle:x", "un contrôle ajouté plus tard s'affiche sans casser");
  assert.deepEqual(W.avertissements({ avertissements: ["signature_retiree", "heure_non_source:08:30"] }).map((x) => x.cle), ["heure_non_source", "signature_retiree"]);
  assert.deepEqual(W.avertissements(null), []);
  // Les textes respectent les règles de Jérémy : pas de virgule avant « et », pas de tiret d'incise.
  for (const code of ["montant_non_source:1", "heure_non_source:1", "mot_interne:x", "nom_prestataire", "prenom_equipe", "signature_retiree"]) assert.doesNotMatch(W.libelleAvertissement(code).texte, /, et |\s[–—]\s/);
});

test("fenêtre de 24 h : depuis le dernier message du client, pas le dernier de Nani", () => {
  const maintenant = Date.parse("2026-11-20T12:00:00Z");
  const messages = [
    { sens: "entrant", envoye_le: "2026-11-19T11:00:00Z" },
    { sens: "entrant", envoye_le: "2026-11-19T13:00:00Z" },
    { sens: "sortant", envoye_le: "2026-11-20T11:00:00Z" },
  ];
  const f = W.fenetre(messages, maintenant);
  assert.equal(f.ouverte, true);
  assert.equal(f.depuis, "2026-11-19T13:00:00Z");
  assert.equal(f.reste_ms, 60 * 60 * 1000);
  assert.equal(W.fenetre(messages.slice(0, 1), maintenant).ouverte, false, "25 h : fermée");
  assert.equal(W.fenetre([{ sens: "sortant", envoye_le: "2026-11-20T11:00:00Z" }], maintenant).ouverte, false, "aucun message du client : fermée");
  assert.deepEqual(W.envoiPossible({ texte: "Hi", fenetre: f }), { ok: true, raison: null });
  assert.equal(W.envoiPossible({ texte: "  ", fenetre: f }).raison, "vide");
  assert.equal(W.envoiPossible({ texte: "Hi", fenetre: W.fenetre(messages.slice(0, 1), maintenant) }).raison, "fenetre_fermee");
});

test("médias : vignette, fichier, ou pourquoi il manque", () => {
  assert.equal(W.etatMedia({ type: "image", chemin: "o/c/f.jpg", statut: "copie" }), "image");
  assert.equal(W.etatMedia({ type: "document", chemin: "o/c/f.pdf", statut: "copie" }), "document");
  assert.equal(W.etatMedia({ mime: "audio/ogg", chemin: "o/c/f.ogg", statut: "copie" }), "audio");
  assert.equal(W.etatMedia({ type: "image", chemin: null, statut: "efface" }), "expire");
  assert.equal(W.etatMedia({ type: "video", statut: "trop_gros" }), "trop_gros");
  assert.equal(W.etatMedia({ type: "image", statut: "a_copier" }), "attente");
  assert.equal(W.etatMedia({ type: "image", statut: "echec" }), "echec");
  for (const e of ["expire", "trop_gros", "echec", "attente"]) assert.ok(W.LIBELLES_MEDIA[e], e);
  assert.equal(W.libelleType("type_jamais_vu"), W.LIBELLES_TYPE.inconnu);
});

test("messages groupés par jour de Bangkok, dans l'ordre d'envoi", () => {
  const g = W.grouperParJour([{ id: "b", envoye_le: "2026-11-20T18:00:00Z" }, { id: "a", envoye_le: "2026-11-20T16:00:00Z" }, { id: "c", envoye_le: "2026-11-19T10:00:00Z" }]);
  assert.deepEqual(g.map((x) => [x.jour, x.messages.map((m) => m.id)]), [["2026-11-19", ["c"]], ["2026-11-20", ["a"]], ["2026-11-21", ["b"]]]);
  assert.equal(W.heureBangkok("2026-11-20T01:30:00Z"), "08:30");
});

test("erreurs d'envoi : chaque code de whatsapp-envoi a son message, un code inconnu aussi", () => {
  for (const code of ["non_connecte", "droit_manquant", "fenetre_fermee", "non_configure", "numero_inconnu", "telnyx_refuse", "base"]) assert.ok(W.ERREURS_ENVOI[code], code);
  assert.ok(W.erreurEnvoi("jamais_vu"));
});

test("adresse d'une conversation : « #/whatsapp?c=…&entite=… » l'ouvre directement", () => {
  assert.deepEqual(W.lireAdresse("#/whatsapp?c=abc&entite=t"), { conversation: "abc", entite: "t" });
  assert.deepEqual(W.lireAdresse("#/whatsapp"), { conversation: "", entite: "" });
  assert.equal(W.adresseConversation({ id: "abc", entite_id: "t" }), "#/whatsapp?c=abc&entite=t");
  assert.equal(W.adresseConversation({ id: "abc", entite_id: null }), "#/whatsapp?c=abc");
  assert.ok(ecranDeLecture("#/whatsapp") && ecranDeLecture("#/whatsapp?c=abc&entite=t"), "écran de lecture : redessiné en direct");
});

test("état du compte Telnyx en clair", () => {
  assert.equal(W.etatCompte("ACCOUNT_OFFBOARDED").cle, "retire");
  assert.equal(W.etatCompte("ACCOUNT_DISCONNECTED").cle, "deconnecte");
  assert.equal(W.etatCompte("ACCOUNT_RECONNECTED").cle, "connecte");
  assert.equal(W.etatCompte(null).cle, "inconnu");
  assert.deepEqual(W.etatCompte("QUELQUE_CHOSE").vars, { code: "QUELQUE_CHOSE" });
});

test("démo : quatre conversations inventées, des propositions dans plusieurs statuts, numéros de fiction", () => {
  let n = 0;
  const uid = () => `id${++n}`;
  const entites = [{ id: "e2", slug: "excursions" }, { id: "e3", slug: "taxi" }];
  const clients = [{ id: "c1", entite_id: "e3", prenom: "Tom", nom: "Démo" }];
  const dossiers = [{ id: "d1", entite_id: "e3", client_id: "c1", ref: "T-1", annule: false }];
  const d = whatsappDemo({ entites, clients, dossiers, uid, organisation: "org", maintenant: Date.parse("2026-11-20T12:00:00Z") });
  assert.equal(d.whatsapp_conversations.length, 4);
  const connu = d.whatsapp_conversations.find((c) => c.client_id === "c1");
  assert.equal(connu.dossier_id, "d1", "un client connu de Taxi avec son dossier");
  assert.ok(d.whatsapp_conversations.some((c) => !c.entite_id), "un inconnu à trier");
  assert.ok(!d.whatsapp_conversations.some((c) => c.entite_source === "agent"), "l'agent ne range plus une conversation (migration 59)");
  const aTrier = d.whatsapp_conversations.find((c) => !c.entite_id);
  const propAT = d.whatsapp_propositions.find((p) => p.conversation_id === aTrier.id);
  assert.equal(propAT.entite_id, "e2", "la réponse d'une conversation à trier est préparée pour l'entreprise proposée");
  assert.deepEqual([...new Set(d.whatsapp_propositions.map((p) => p.statut))].sort(), ["a_faire", "en_cours", "traitee"]);
  assert.ok(d.whatsapp_propositions.some((p) => p.entreprise_proposee === "secret"));
  assert.ok(d.whatsapp_messages.some((m) => m.origine === "app") && d.whatsapp_messages.some((m) => m.origine === "gestion"));
  for (const c of d.whatsapp_conversations) assert.match(c.telephone, /^\+(447700900|1202555)\d+$/, "plages réservées à la fiction");
  assert.deepEqual(whatsappDemo({ entites: [{ id: "a", slug: "agence" }], uid, organisation: "org" }).whatsapp_conversations, [], "sans Secret ni Taxi, rien");
});

test("démo : droits comme la base, marquer lu, ranger, traiter, rien n'est envoyé", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?wa=${Date.now()}`);
    const store = creer();
    const brut = await store.charger();
    assert.equal(brut.whatsapp_disponible, true);
    assert.equal(brut.whatsapp_conversations.length, 4, "l'administratrice voit tout");
    const nonLue = brut.whatsapp_conversations.find((c) => c.non_lus > 0 && c.entite_id);
    const lue = await store.modifier("whatsapp_conversations", nonLue.id, { non_lus: 0 });
    assert.equal(lue.non_lus, 0);
    const remonte = await store.modifier("whatsapp_conversations", nonLue.id, { non_lus: 9 });
    assert.equal(remonte.non_lus, 0, "le compteur ne remonte jamais depuis l'outil");
    const aTrier = brut.whatsapp_conversations.find((c) => !c.entite_id);
    const secret = brut.entites.find((e) => e.slug === "excursions");
    const rangee = await store.modifier("whatsapp_conversations", aTrier.id, { entite_id: secret.id });
    assert.equal(rangee.entite_source, "manuel");
    const prop = brut.whatsapp_propositions.find((p) => p.statut === "a_faire");
    const traitee = await store.modifier("whatsapp_propositions", prop.id, { statut: "traitee" });
    assert.equal(traitee.traitee_par_quoi, "outil");
    await assert.rejects(store.modifier("whatsapp_propositions", prop.id, { statut: "ignoree" }), "une proposition déjà traitée ne change plus");
    assert.deepEqual(await store.whatsappEnvoyer({ conversation_id: aTrier.id, texte: "Hi" }), { demo: true });
    const messages = await store.whatsappMessages(nonLue.id);
    assert.ok(messages.length >= 2 && messages.every((m, i) => !i || Date.parse(messages[i - 1].envoye_le) <= Date.parse(m.envoye_le)));
    const r = await store.whatsappReception("demo-organisation", false);
    assert.equal(r.reception_active, false);
    // Mook (écran « Nouveau voucher » seul) ne lit rien.
    // Mook (écran « Nouveau voucher » seul) et l'éditrice (sans réglages) ne lisent rien.
    for (const motif of [/vouchers et factures/i, /^Assistante démo$/]) {
      const u = store.utilisateursDemo().find((x) => motif.test(x.nom));
      assert.ok(u, String(motif));
      store.changerUtilisateurDemo(u.id);
      const vu = await store.charger();
      assert.equal(vu.whatsapp_conversations.length, 0, u.nom);
      assert.equal(vu.whatsapp_reglages.length, 0, u.nom);
      assert.deepEqual(await store.whatsappMessages(nonLue.id), [], u.nom);
    }
  } finally {
    delete globalThis.localStorage;
  }
});

test("branchement : route, menu avec badge, direct sur un canal à part, réglages, mode démo", () => {
  const app = source("app.mjs");
  assert.match(app, /\[\/\^#\\\/whatsapp\(\?:\\\?\.\*\)\?\$\/, "whatsapp", vers\(\(\) => import\("\.\/views\/whatsapp\.mjs"\), "vueWhatsApp"\)\]/);
  assert.match(app, /if \(cle === "whatsapp"\) return whatsappVisible\(\);/, "une adresse tapée n'ouvre pas l'écran sans le droit");
  assert.match(app, /href: "#\/whatsapp", libelle: tr\("WhatsApp"\), cle: "whatsapp", icone: "whatsapp", badge: whatsapp/);
  assert.match(app, /etat\.store\.ecouterWhatsApp\(TABLES_WHATSAPP, changementWhatsApp\)/);
  assert.deepEqual(W.TABLES_WHATSAPP, ["whatsapp_conversations", "whatsapp_messages", "whatsapp_propositions"]);
  const sb = source("store-supabase.mjs");
  assert.match(sb, /sb\.channel\("gestion-whatsapp"\)/, "un canal à part, celui des demandes du site ne change pas");
  assert.match(sb, /createSignedUrl\(media\.chemin, 300/, "lien court vers le stockage privé");
  assert.match(sb, /functions\/v1\/whatsapp-envoi/);
  assert.match(sb, /whatsapp_disponible: conversations !== null/, "tolérant à une table absente");
  assert.match(source("views/reglages.mjs"), /blocReglagesWhatsApp\(\)/);
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /navigator\.clipboard\.writeText/);
  assert.match(vue, /En démo, rien n'est envoyé\./);
  assert.match(vue, /modifier\("whatsapp_conversations", c\.id, \{ non_lus: 0 \}\)/, "ouvrir la conversation la marque lue");
  assert.match(vue, /if \(!c \|\| document\.visibilityState !== "visible"\) return false;/, "seulement l'onglet visible");
  assert.match(vue, /document\.addEventListener\("visibilitychange"/, "marquée au retour sur l'onglet");
  assert.doesNotMatch(vue, /[\u{1F300}-\u{1FAFF}]/u, "pas d'emoji dans l'interface");
});

test("suivi de l'assistant : l'usage « whatsapp » et la Boîte WhatsApp au lieu d'une personne inconnue", () => {
  const i = USAGES_SUIVIS.findIndex(([k]) => k === "agent");
  assert.equal(USAGES_SUIVIS[i + 1][0], "whatsapp");
  assert.equal(USAGES_SUIVIS[i + 1][1], "Boîte WhatsApp (réponses préparées)");
  const lignes = [
    { cree_le: "2026-11-20T03:00:00Z", user_id: UTILISATEUR_WHATSAPP, entite_id: "s", usage: "whatsapp", statut: "ok", cout_estime_usd: 0.01 },
    { cree_le: "2026-11-20T03:00:00Z", user_id: UTILISATEUR_WHATSAPP, entite_id: "s", usage: "whatsapp", statut: "erreur_api", cout_estime_usd: 0 },
  ];
  const s = suiviAssistant({ lignes, jour: "2026-11-20", noms: {}, entites: [{ id: "s", nom: "Secret" }] });
  const p = s.personnes.find((x) => x.user_id === UTILISATEUR_WHATSAPP);
  assert.equal(p.nom, "Boîte WhatsApp");
  assert.equal(p.systeme, true);
  assert.equal(s.usages.find((u) => u.usage === "whatsapp").libelle, "Boîte WhatsApp (réponses préparées)");
  if (s.echecs.length) assert.equal(s.echecs[0].personneSysteme, true);
  assert.match(source("views/assistant-suivi.mjs"), /l\.systeme \? tr\(l\.nom\)/);
});

// Garde-fou de la PR 278 dans l'écran WhatsApp : mêmes fonctions que l'onglet Assistant.
import { bloquantsReponse, resteBloque } from "../src/gestion/js/agent-calc.mjs";
import { libelleAvertissement as libelleAv, erreurEnvoi as erreurEnv } from "../src/gestion/js/whatsapp-calc.mjs";
test("whatsapp écran : un montant interne ou un partenaire bloque la copie tant qu'il reste dans le texte", () => {
  const b = bloquantsReponse(["montant_interne:900", "nom_prestataire:Lazy Day", "signature_retiree"]);
  assert.deepEqual(resteBloque("Price 900 THB with Lazy Day", b).sort(), ["900", "Lazy Day"]);
  assert.deepEqual(resteBloque("Price 1,500 THB", b), []);
  assert.equal(libelleAv("montant_interne:900").niveau, "alerte");
  assert.equal(libelleAv("nom_prestataire:Lazy Day").vars.valeur, "Lazy Day");
  assert.match(erreurEnv("contenu_interne"), /net, une commission ou un nom de partenaire/);
  const vue = fs.readFileSync(new URL("../src/gestion/js/views/whatsapp.mjs", import.meta.url), "utf8");
  assert.match(vue, /boutonCopier\.disabled = !zone\.value\.trim\(\) \|\| reste\.length > 0/);
  assert.match(vue, /boutonEnvoyer\.disabled = !ok\.ok \|\| reste\.length > 0/);
});

// ---- Deuxième passe (revue du 20.11.2026, contrat serveur de la migration 59) -----------------------------------------------------------
test("envoi : erreurs du serveur, résultat inconnu sans « réessayez », contenu interne", () => {
  assert.equal(W.erreurEnvoi("contenu_interne"), "Le texte contient un net, une commission ou un nom de partenaire. Retirez-le, rien n'est parti.");
  assert.equal(W.erreurEnvoi("verifier_whatsapp"), "Délai dépassé : le message est peut-être parti. Vérifiez dans WhatsApp avant de réessayer.");
  assert.ok(W.erreurEnvoi("deja_traitee"));
  assert.equal(W.ERREURS_ENVOI.telnyx_injoignable, undefined, "telnyx_injoignable n'existe plus");
  for (const code of ["verifier_whatsapp", "hors_ligne", "inconnu", "jamais_vu", undefined]) {
    assert.equal(W.envoiIncertain(code), true, String(code));
    assert.equal(W.erreurEnvoi(code), W.ERREURS_ENVOI.verifier_whatsapp, String(code));
  }
  for (const code of ["non_connecte", "droit_manquant", "contenu_interne", "fenetre_fermee", "non_configure", "numero_inconnu", "telnyx_refuse", "base", "deja_traitee"]) assert.equal(W.envoiIncertain(code), false, code);
  for (const code of Object.keys(W.ERREURS_ENVOI)) if (W.envoiIncertain(code)) assert.doesNotMatch(W.ERREURS_ENVOI[code], /[Rr]éessayez(?! )|réessayez dans/, code);
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /if \(envoiIncertain\(code\)\) envoisIncertains\.add\(p\.id\);\s+else bouton\.disabled = false;/, "après un résultat inconnu, Envoyer ne se rallume pas");
  assert.match(vue, /boutonEnvoyer\.disabled = !ok\.ok \|\| reste\.length > 0 \|\| incertain;/);
  assert.match(vue, /aRetirer\.set\(p\.id, \(r && r\.a_retirer\) \|\| \[\]\)/, "a_retirer gardé et affiché sous le texte");
  assert.match(source("store-supabase.mjs"), /a_retirer: lu && Array\.isArray\(lu\.a_retirer\)/);
  assert.match(source("store-supabase.mjs"), /erreur: \(lu && lu\.erreur\) \|\| "inconnu"/, "une réponse illisible est un résultat inconnu");
});

test("envoi refusé à l'écran quand la proposition n'est plus la courante", () => {
  const props = [{ id: "vieille", conversation_id: "a", statut: "a_faire", cree_le: "2026-11-20T08:00:00Z" }, { id: "neuve", conversation_id: "a", statut: "a_faire", cree_le: "2026-11-20T09:00:00Z" }];
  assert.equal(W.propositionCourante(props, "a").id, "neuve");
  assert.equal(W.etatConversation(conv("a"), { statut: "envoi" }).cle, "envoi", "statut « envoi » pendant whatsapp-envoi");
  assert.match(source("views/whatsapp.mjs"), /if \(!toujoursCourante\(c, p\)\) return perimee\(\);[\s\S]*await confirmer[\s\S]*if \(!toujoursCourante\(c, p\)\) return perimee\(\);/, "vérifié avant et après la confirmation");
});

test("ligne « fait » seulement pour une proposition au moins aussi récente que le dernier message du client", () => {
  const messages = [{ sens: "entrant", envoye_le: "2026-11-20T10:00:00Z" }, { sens: "sortant", envoye_le: "2026-11-20T10:05:00Z" }];
  assert.equal(W.propositionAJour({ cree_le: "2026-11-20T10:00:01Z" }, messages), true);
  assert.equal(W.propositionAJour({ cree_le: "2026-11-20T10:00:00Z" }, messages), true, "égale : à jour");
  assert.equal(W.propositionAJour({ cree_le: "2026-11-20T09:59:00Z" }, messages), false);
  assert.equal(W.propositionAJour(null, messages), false);
  assert.equal(W.propositionAJour({ cree_le: "2026-11-20T09:00:00Z" }, []), true, "sans message du client, rien à contredire");
  assert.match(source("views/whatsapp.mjs"), /!propositionAJour\(p, messages\)\) return ligneSansReponse\(\);/);
});

test("entreprise proposée par l'agent : entreprise_proposee, sinon l'entreprise de la proposition", () => {
  const entites = [SECRET, TAXI];
  assert.equal(W.entrepriseProposee({ entreprise_proposee: "taxi" }, entites).id, "t");
  assert.equal(W.entrepriseProposee({ entite_id: "s" }, entites).id, "s");
  assert.equal(W.entrepriseProposee(null, entites), null);
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /const proposee = !c\.entite_id \? entrepriseProposee\(prop, choix\) : null;/);
  assert.match(vue, /tr\("préparée pour \{nom\}"/, "réponse préparée pour une autre entreprise : signalé");
  assert.match(vue, /brouillons\.has\(prop\.id\) && prop\.entite_id !== e\.id && !\(await confirmer\(/, "changer d'entreprise avec une réponse modifiée : confirmation");
});

test("texte modifié gardé par proposition entre deux rendus, plus de data-pas-saisie après Copier", () => {
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /zone\.value = brouillons\.has\(p\.id\) \? brouillons\.get\(p\.id\) : p\.texte \|\| "";/);
  assert.match(vue, /if \(zone\.value !== \(p\.texte \|\| ""\)\) brouillons\.set\(p\.id, zone\.value\);/);
  assert.doesNotMatch(vue, /data-pas-saisie", ""\)/, "la zone de réponse n'est jamais sortie du suivi des saisies");
});

test("défilement replacé seulement à l'ouverture ou à un nouveau message, liste gardée", () => {
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /const replacer = !avant \|\| avant\.dataset\.conversation !== ouverte\.id \|\| avant\.dataset\.dernier !== dernier;/);
  assert.match(vue, /if \(!replacer\) return void \(zone && \(zone\.scrollTop = defilMessages\)\);/);
  assert.match(vue, /colonne\.scrollTop = defilListe/);
});

test("Marquer traitée et Ignorer : éteints pendant l'écriture, « déjà traitée » seulement après relecture", () => {
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /boutons\.forEach\(\(b\) => \(b\.disabled = true\)\);/);
  assert.match(vue, /relue = await etat\.store\.whatsappProposition\(p\.id\);/);
  assert.match(vue, /if \(relue && relue\.statut !== "a_faire"\) \{/);
});

test("relier un client : seulement les fiches de l'entreprise de la conversation, et on prévient si la base l'a retiré", () => {
  const vue = source("views/whatsapp.mjs");
  assert.match(vue, /filtre: \(x\) => x\.entite_id === c\.entite_id/);
  assert.match(vue, /\(\(r && r\.client_id\) \|\| null\) !== choisi/);
  assert.match(source("views/selecteur-client.mjs"), /resultats = filtre \? r\.filter\(filtre\)\.slice\(0, 8\) : r;/);
});

test("notification d'une conversation à trier depuis ZTP : passage dans la première entreprise du numéro", () => {
  const app = source("app.mjs");
  assert.match(app, /if \(\/\^#\\\/whatsapp\(\\\?\|\$\)\/\.test\(location\.hash\) && etat\.brut\.whatsapp_disponible === true && !whatsappVisible\(\)\) \{/);
  // Placé avant le contrôle de l'écran de l'entreprise, qui ramènerait sinon à l'accueil.
  assert.ok(app.indexOf("!whatsappVisible()) {") < app.indexOf("if (!ecranDeLEntreprise(cleRoute))"));
});

test("démo : changer d'entreprise remplace les propositions ouvertes d'une autre entreprise, lecture réservée à leur entreprise", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?wa2=${Date.now()}`);
    const store = creer();
    const brut = await store.charger();
    const aTrier = brut.whatsapp_conversations.find((c) => !c.entite_id);
    const prop = brut.whatsapp_propositions.find((p) => p.conversation_id === aTrier.id);
    const taxi = brut.entites.find((e) => e.slug === "taxi");
    assert.notEqual(prop.entite_id, taxi.id);
    await store.modifier("whatsapp_conversations", aTrier.id, { entite_id: taxi.id });
    const apres = await store.charger();
    assert.equal(apres.whatsapp_propositions.find((p) => p.id === prop.id).statut, "remplacee");
    assert.deepEqual(await store.whatsappProposition(prop.id), { id: prop.id, statut: "remplacee" });
  } finally {
    delete globalThis.localStorage;
  }
});

test("suivi de l'assistant : la Boîte WhatsApp n'a pas de limite par personne", () => {
  const lignes = Array.from({ length: 60 }, (_, i) => ({ cree_le: `2026-11-20T0${i % 9}:00:00Z`, user_id: UTILISATEUR_WHATSAPP, entite_id: "s", usage: "whatsapp", statut: "ok", cout_estime_usd: 0.01 }));
  const s = suiviAssistant({ lignes, jour: "2026-11-20", limite: 40 });
  const p = s.personnes.find((x) => x.user_id === UTILISATEUR_WHATSAPP);
  assert.equal(p.aujourdhui, 60);
  assert.equal(p.limiteAtteinte, false);
  assert.equal(p.joursLimite, 0);
  assert.equal(s.limiteAtteinte, 0);
  assert.match(source("views/assistant-suivi.mjs"), /l\.systeme \? String\(l\.aujourdhui\) : `\$\{l\.aujourdhui\} \/ \$\{S\.limite\}`/);
});
