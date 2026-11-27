// L'Assistant en équipe (migration 133, demande de Jérémy du 27.11.2026) : l'administration voit les conversations de l'équipe et y écrit
// comme la propriétaire. Logique pure de l'écran, verrou de la fonction « agent », démonstration rôle par rôle. Données fictives.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { voitEquipe, filtreLu, conversationsFiltrees, aMoi, prenomEquipe, proprietaireAffichee, auteurAffiche, reponseEnCours, VERROU_MS } from "../src/gestion/js/agent-equipe-calc.mjs";
import { filDepuis } from "../src/gestion/js/agent-calc.mjs";
import { lirePrise, proprietaireSuite, fonctionAbsente } from "../supabase/functions/agent/equipe.js";
import { EN } from "../src/gestion/js/i18n-en.mjs";

const NANI = "11111111-1111-4111-8111-111111111111";
const JEREMY = "22222222-2222-4222-8222-222222222222";
const MOOK = "33333333-3333-4333-8333-333333333333";
const EQUIPE = [
  { user_id: NANI, nom: "Nani Test", email: "nani@test.local" },
  { user_id: JEREMY, nom: "Jérémy Test", email: "jeremy@test.local" },
  { user_id: MOOK, nom: "", email: "mook@test.local" },
];

test("qui voit l'équipe : réglages et dossiers dans l'entreprise, rien d'autre", () => {
  assert.equal(voitEquipe(["reglages.ecrire", "dossiers.ecrire", "partenaires.lire"]), true);
  assert.equal(voitEquipe(["dossiers.ecrire", "partenaires.lire"]), false, "la saisie ne voit que les siennes");
  assert.equal(voitEquipe(["reglages.ecrire"]), false, "sans dossiers.ecrire, pas d'Assistant");
  assert.equal(voitEquipe(null), false);
});

test("filtre « Les miennes / Toute l'équipe » : les miennes par défaut, l'équipe seulement pour l'administration", () => {
  assert.equal(filtreLu(null), "miennes");
  assert.equal(filtreLu("equipe"), "equipe");
  assert.equal(filtreLu("<script>"), "miennes");
  const convs = [{ id: "a", user_id: NANI }, { id: "b", user_id: JEREMY }, { id: "c" }];
  assert.deepEqual(conversationsFiltrees(convs, { moi: JEREMY, filtre: "miennes", equipe: true }).map((c) => c.id), ["b", "c"], "une ligne sans propriétaire (base d'avant) est comptée comme mienne");
  assert.deepEqual(conversationsFiltrees(convs, { moi: JEREMY, filtre: "equipe", equipe: true }).map((c) => c.id), ["a", "b", "c"]);
  assert.deepEqual(conversationsFiltrees(convs, { moi: MOOK, filtre: "equipe", equipe: false }).map((c) => c.id), ["c"], "sans le droit, « equipe » ne montre rien de plus");
  assert.equal(aMoi({ user_id: NANI }, JEREMY), false);
});

test("prénoms : la propriétaire sur la liste, l'auteur réel sous un message, jamais un nom deviné", () => {
  assert.equal(prenomEquipe(EQUIPE, NANI), "Nani");
  assert.equal(prenomEquipe(EQUIPE, MOOK), "Mook", "sans nom, la partie de l'e-mail");
  assert.equal(prenomEquipe(EQUIPE, "inconnu"), "");
  assert.equal(proprietaireAffichee({ user_id: NANI }, { moi: JEREMY, equipe: EQUIPE }), "Nani");
  assert.equal(proprietaireAffichee({ user_id: JEREMY }, { moi: JEREMY, equipe: EQUIPE }), "", "mes conversations ne portent pas de prénom");
  assert.equal(proprietaireAffichee({ user_id: "x" }, { moi: JEREMY, equipe: EQUIPE }), "?");
  const conv = { user_id: NANI };
  assert.equal(auteurAffiche(NANI, conv, { moi: JEREMY, equipe: EQUIPE }), "", "le message de la propriétaire ne porte rien");
  assert.equal(auteurAffiche(null, conv, { moi: JEREMY, equipe: EQUIPE }), "", "un message d'avant la migration est celui de la propriétaire");
  assert.deepEqual(auteurAffiche(JEREMY, conv, { moi: JEREMY, equipe: EQUIPE }), { moi: true, prenom: "" }, "« écrit par vous » pour Jérémy");
  assert.deepEqual(auteurAffiche(JEREMY, conv, { moi: NANI, equipe: EQUIPE }), { moi: false, prenom: "Jérémy" }, "« écrit par Jérémy » pour Nani");
});

test("le fil garde l'auteur réel de chaque message de personne", () => {
  const items = filDepuis([
    { id: 1, role: "user", contenu: [{ type: "text", text: "Bonjour" }], cree_le: "2026-11-27T08:00:00Z", auteur_id: NANI },
    { id: 2, role: "assistant", contenu: [{ type: "text", text: "Bonjour Nani" }], cree_le: "2026-11-27T08:00:01Z", auteur_id: NANI },
    { id: 3, role: "user", contenu: [{ type: "fichier", id: "f", nom: "billet.pdf", media_type: "application/pdf" }, { type: "text", text: "Je reprends" }], cree_le: "2026-11-27T09:00:00Z", auteur_id: JEREMY },
    { id: 4, role: "user", contenu: [{ type: "text", text: "Ancien message" }], cree_le: "2026-11-27T07:00:00Z" },
  ]);
  const personnes = items.filter((i) => i.genre === "personne");
  assert.deepEqual(personnes.map((i) => [i.texte, i.auteur]), [["Ancien message", null], ["Bonjour", NANI], ["Je reprends", JEREMY]]);
  assert.equal(items.find((i) => i.genre === "pieces").auteur, JEREMY);
});

test("réponse en cours : moins de 3 minutes, par qui", () => {
  const t0 = Date.parse("2026-11-27T10:00:00Z");
  assert.deepEqual(reponseEnCours({ reponse_le: "2026-11-27T10:00:00Z", reponse_par: NANI }, { maintenant: t0 + 60_000 }), { par: NANI });
  assert.equal(reponseEnCours({ reponse_le: "2026-11-27T10:00:00Z", reponse_par: NANI }, { maintenant: t0 + VERROU_MS + 1 }), null, "une prise de plus de 3 minutes est libérée par la base");
  assert.equal(reponseEnCours({ reponse_le: null }), null);
  assert.equal(reponseEnCours(null), null);
});

test("fonction agent : la prise de la conversation lue une fois", () => {
  const J = "44444444-4444-4444-8444-444444444444";
  assert.deepEqual(lirePrise({ data: { ok: true, jeton: J } }), { jeton: J });
  assert.deepEqual(lirePrise({ data: { ok: false, raison: "occupee", par: NANI } }), { refus: { corps: { erreur: "conversation_occupee", par: NANI }, status: 409 } });
  assert.deepEqual(lirePrise({ data: { ok: false, raison: "occupee", par: "<x>" } }), { refus: { corps: { erreur: "conversation_occupee" }, status: 409 } }, "jamais autre chose qu'un identifiant");
  assert.deepEqual(lirePrise({ data: { ok: false, raison: "introuvable" } }), { refus: { corps: { erreur: "conversation_introuvable" }, status: 404 } });
  assert.deepEqual(lirePrise({ error: { code: "PGRST202", message: "Could not find the function" } }), { libre: true }, "sans la migration 133 : comme avant");
  assert.deepEqual(lirePrise({ error: { code: "57014", message: "timeout" } }), { refus: { corps: { erreur: "base" }, status: 500 } });
  assert.deepEqual(lirePrise({ data: { ok: true, jeton: "pas-un-jeton" } }), { refus: { corps: { erreur: "base" }, status: 500 } });
  assert.equal(fonctionAbsente({ code: "42883" }), true);
  assert.deepEqual(proprietaireSuite({ user_id: NANI }, JEREMY), { user_id: NANI }, "la suite d'une discussion pleine reste à Nani");
  assert.deepEqual(proprietaireSuite({ user_id: NANI }, NANI), {});
  assert.deepEqual(proprietaireSuite({}, JEREMY), {});
});

test("fonction agent : la conversation est prise avant toute écriture et rendue à chaque sortie", () => {
  const src = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
  const prise = src.indexOf('sb.rpc("prendre_agent_conversation"');
  assert.ok(prise > 0, "la prise existe");
  const apres = src.slice(prise);
  // Aucune écriture de la conversation existante avant la prise : l'archivage d'une discussion pleine, les pièces, les messages viennent après.
  for (const ecriture of ['update({ statut: "archivee" })', 'from("agent_fichiers").insert', 'from("agent_messages").insert']) assert.ok(src.indexOf(ecriture) > prise, `${ecriture} après la prise`);
  // Après la prise, chaque refus rend la conversation : plus aucun « return json( » hors de repondre() et du refus de la prise.
  const corpsRepondre = apres.indexOf("const repondre = async");
  const reste = apres.slice(apres.indexOf("// Une discussion liée qui se remplit"));
  assert.ok(corpsRepondre > 0);
  assert.doesNotMatch(reste.slice(0, reste.indexOf("Deno.serve") > 0 ? reste.indexOf("Deno.serve") : undefined), /return json\(/, "chaque refus passe par repondre()");
  assert.match(src, /apercu: [^\n]+\n\s+\/\/ La conversation est rendue[^\n]*\n\s+await liberer\(\);/, "rendue à la fin de l'échange, réussi ou en panne");
  assert.match(src, /COL_CONV_AGENT = "id, titre, dossier_id, entite_id, cree_le, user_id"/, "la propriétaire est lue");
  assert.match(src, /\.\.\.proprietaireSuite\(ancien, userId\)/, "la suite d'une discussion pleine garde la propriétaire");
});

test("textes anglais de l'Assistant en équipe", () => {
  const vue = readFileSync(new URL("../src/gestion/js/views/agent.mjs", import.meta.url), "utf8");
  for (const k of ["Les miennes", "Toute l'équipe", "écrit par vous", "écrit par {prenom}", "par {prenom}", "Conversation de {prenom}", "L'assistant répond à {prenom}…", "Aucune conversation dans l'équipe."]) {
    assert.ok(vue.includes(`"${k}"`), `${k} est dans l'écran`);
    assert.ok(EN[k], `${k} a sa traduction`);
  }
  assert.ok(!/\bher\b|\bhis\b/.test(Object.values(EN).filter((v, i, a) => a.indexOf(v) === i && /written|place|answering/.test(v)).join(" ")), "aucun genre supposé en anglais");
});

test("écran : filtre de 44 px gardé au retour, abonnement en direct arrêté en quittant", () => {
  const vue = readFileSync(new URL("../src/gestion/js/views/agent.mjs", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/gestion/css/app.css", import.meta.url), "utf8");
  assert.match(css, /\.agent-filtre-bouton \{ min-height: 44px;/);
  assert.match(vue, /localStorage\.setItem\(CLE_FILTRE_EQUIPE, f\)/);
  assert.match(vue, /if \(arretDirectAgent\) \(arretDirectAgent\(\), \(arretDirectAgent = null\)\);/);
  assert.match(vue, /etat\.store\.ecouterAgent\(\(\) => planifierRelecture\(\)\)/);
  assert.match(vue, /if \(enCours \|\| enValidation\.size \|\| document\.querySelector/, "jamais de relecture pendant un échange ou une validation");
  // Les prénoms se lisent pour tout le monde : la saisie voit « écrit par Jérémy » dans sa propre conversation (vérifié à 390 px).
  assert.match(vue, /const lireEquipe = \(id\) => \(etat\.store\.equipe \? etat\.store\.equipe\(id\)/);
});

test("démonstration : l'administration voit et reprend la conversation de la saisie, la saisie ne voit pas celles des autres", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?equipe=${Date.now()}`);
    const store = creer();
    const d = await store.charger();
    const admin = d.profils.find((p) => p.super_admin && p.email === "admin@demo.local");
    const saisie = d.profils.find((p) => p.email === "assistante@demo.local");
    const ent = d.membres.find((m) => m.user_id === saisie.user_id).entite_id;
    await store.enregistrerReglages(ent, { ...d.reglages[ent], agent_ia: true });

    store.changerUtilisateurDemo(saisie.user_id);
    const ev = [];
    assert.deepEqual(await store.agentEnvoyer({ entite_id: ent, texte: "Bonjour, une demande de test", conversation_id: null }, (x) => ev.push(x)), { ok: true });
    const convId = ev.find((x) => x.t === "conversation").id;
    const fil1 = await store.agentFil(convId);
    assert.equal(fil1.messages[0].auteur_id, saisie.user_id);

    store.changerUtilisateurDemo(admin.user_id);
    const vues = await store.agentConversations(ent);
    const vue = vues.find((c) => c.id === convId);
    assert.ok(vue && vue.user_id === saisie.user_id, "l'administration voit la conversation de la saisie");
    assert.deepEqual(await store.agentEnvoyer({ entite_id: ent, texte: "Je reprends la demande", conversation_id: convId }, () => {}), { ok: true });
    const fil2 = await store.agentFil(convId);
    const derniere = fil2.messages.filter((m) => m.role === "user").pop();
    assert.equal(derniere.auteur_id, admin.user_id, "le message garde son auteur réel");
    assert.equal((await store.agentConversations(ent)).find((c) => c.id === convId).user_id, saisie.user_id, "la conversation reste à la saisie");
    const propre = (await store.agentConversations(ent)).find((c) => c.id === convId);
    assert.ok(!propre.reponse_le, "la conversation est rendue à la fin de la réponse");

    // Une réponse en cours : une seconde demande au même moment trouve la conversation occupée, rien n'est écrit, puis tout est rendu.
    const avant = (await store.agentFil(convId)).messages.length;
    const premiere = store.agentEnvoyer({ entite_id: ent, texte: "Première demande", conversation_id: convId }, () => {});
    const seconde = await store.agentEnvoyer({ entite_id: ent, texte: "Seconde demande", conversation_id: convId }, () => {});
    assert.equal(seconde.erreur, "conversation_occupee");
    assert.equal(seconde.par, admin.user_id, "par qui");
    assert.deepEqual(await premiere, { ok: true });
    const textes = (await store.agentFil(convId)).messages.slice(avant).flatMap((m) => (m.contenu || []).filter((b) => b.type === "text").map((b) => b.text));
    assert.ok(textes.includes("Première demande") && !textes.includes("Seconde demande"), "une seule réponse");
    store.changerUtilisateurDemo(saisie.user_id);
    assert.equal((await store.agentConversations(ent)).some((x) => x.user_id === admin.user_id), false, "la saisie ne voit pas les conversations de l'administration");
  } finally {
    delete globalThis.localStorage;
  }
});
