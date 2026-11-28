// L'Assistant en équipe (migration 133, demande de Jérémy du 27.11.2026) : l'administration voit les conversations de l'équipe et y écrit
// comme la propriétaire. Logique pure de l'écran, verrou de la fonction « agent », démonstration rôle par rôle. Données fictives.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { voitEquipe, filtreLu, conversationsFiltrees, aMoi, prenomEquipe, proprietaireAffichee, auteurAffiche, reponseEnCours, VERROU_MS } from "../src/gestion/js/agent-equipe-calc.mjs";
import { filDepuis } from "../src/gestion/js/agent-calc.mjs";
import { lirePrise, proprietaireSuite, fonctionAbsente, ligneAuteur, prenomProfil } from "../supabase/functions/agent/equipe.js";
import { textesDeNani, auteursDesTextes } from "../src/gestion/js/devis-calc.mjs";
import { mentionReprise, controlerReponse } from "../supabase/functions/agent/outils.js";
import { bloquantsReponse, resteBloque } from "../src/gestion/js/agent-calc.mjs";
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
  assert.equal(voitEquipe(["reglages.ecrire", "dossiers.ecrire"], false), false, "point 3 : portée « ses dossiers », pas l'équipe (comme whatsapp_admin)");
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
  assert.equal(proprietaireAffichee({ user_id: "x" }, { moi: JEREMY, equipe: EQUIPE, inconnue: "une personne de l'équipe" }), "une personne de l'équipe", "jamais un nom deviné");
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

const vueSrc = () => readFileSync(new URL("../src/gestion/js/views/agent.mjs", import.meta.url), "utf8");
const fonctionSrc = () => readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");

test("point 1 : « Écarter » passe par la base (ecarter_agent_carte), jamais par une mise à jour directe", () => {
  const vue = vueSrc();
  assert.match(vue, /onclick: \(\) => !enValidation\.has\(c\.id\) && ecarter\(c\) \}, tr\("Écarter"\)\)/);
  assert.doesNotMatch(vue, /decider\(c, "ecartee"\)/);
  const sb = readFileSync(new URL("../src/gestion/js/store-supabase.mjs", import.meta.url), "utf8");
  assert.match(sb, /sb\.rpc\("ecarter_agent_carte", \{ p_carte: id \}\)/);
});

test("point 2 : prise nommée, reprise seulement en le sachant, tenue renouvelée, contrôle juste avant d'écrire", () => {
  const vue = vueSrc();
  assert.match(vue, /await confirmer\(tr\("\{qui\} a commencé à valider cette carte/);
  assert.match(vue, /agentPrendreCarteEquipe\(c\.id, \{ forcer: true \}\)/);
  assert.match(vue, /setInterval\(async \(\) => \{\n\s+const r = await etat\.store\.agentControlerCarte\(c\.id\)/, "la prise se renouvelle pendant le travail");
  assert.match(vue, /const arret = await avantCreer\(\);\n\s+if \(arret\) r = \{ ok: false, motif: arret, perdue: true \};/, "un geste : contrôle avant toute écriture");
  for (const f of ["ouvrirDemande(null, await preparationComplete({ ...c, donnees: donneesCarte(c) }), { auto: true, titre: c.titre, surCree: () => {}, whatsappLie: await conversationWaLiee(), avantCreer })", "validerUnifie(c, { donnees: donneesCarte(c), libelleEntreprise, whatsappLie: await conversationWaLiee(), avantCreer })", "ouvrirConfirmation(c.donnees.course.texte || \"\", { auto: true, avantCreer })", "avantCreer: avantFenetre(c)", "avantEnregistrer: avantFenetre(c)"]) assert.ok(vue.includes(f), `contrôle branché : ${f}`);
  assert.match(readFileSync(new URL("../src/gestion/js/views/demande.mjs", import.meta.url), "utf8"), /options\.avantCreer \? await options\.avantCreer\(\)/);
  assert.match(readFileSync(new URL("../src/gestion/js/views/confirmation.mjs", import.meta.url), "utf8"), /const arret = options\.avantCreer \? await options\.avantCreer\(\)/);
  assert.match(readFileSync(new URL("../src/gestion/js/views/reservations.mjs", import.meta.url), "utf8"), /if \(avantEnregistrer\) \{\n\s+const arret = await avantEnregistrer\(\)/);
});

test("démonstration, points 1 et 2 : écarter une carte validée ou tenue ailleurs est refusé ; la reprise d'une prise expirée bloque l'ancienne", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?cartes=${Date.now()}`);
    const store = creer();
    const d = await store.charger();
    const admin = d.profils.find((p) => p.super_admin && p.email === "admin@demo.local");
    const saisie = d.profils.find((p) => p.email === "assistante@demo.local");
    const ent = d.membres.find((m) => m.user_id === saisie.user_id).entite_id;
    await store.enregistrerReglages(ent, { ...d.reglages[ent], agent_ia: true });
    store.changerUtilisateurDemo(saisie.user_id);
    const ev = [];
    await store.agentEnvoyer({ entite_id: ent, texte: "Brochure du partenaire", fichiers: [{ nom: "tarifs.pdf", media_type: "application/pdf", data: "JVBERi0=" }] }, (x) => ev.push(x));
    const carteId = ev.find((x) => x.t === "carte").carte.id;
    store.changerUtilisateurDemo(admin.user_id);
    assert.deepEqual(await store.agentPrendreCarteEquipe(carteId), { ok: true }, "l'administration prend la carte");
    store.changerUtilisateurDemo(saisie.user_id);
    const pris = await store.agentPrendreCarteEquipe(carteId);
    assert.equal(pris.raison, "prise");
    assert.equal(pris.par, admin.user_id, "la saisie sait qui la tient");
    assert.equal((await store.agentEcarterCarte(carteId)).raison, "prise", "S1b : écarter pendant la validation est refusé");
    await store.agentRendreCarte(carteId);
    assert.equal((await store.agentPrendreCarteEquipe(carteId)).raison, "prise", "S1c : la saisie ne rend pas la carte de l'administration");
    await assert.rejects(store.agentCarte(carteId, "ecartee"), /carte_prise/);
    // Prise expirée : la saisie voit qui était dessus, reprend en le sachant ; le contrôle de l'administration refuse ensuite.
    const brut = () => JSON.parse([...stockage.values()].find((v) => v.includes(carteId)));
    const c0 = brut();
    c0.agent_cartes.find((x) => x.id === carteId).prise_le = new Date(Date.now() - 5 * 60000).toISOString();
    stockage.set([...stockage.keys()].find((k) => stockage.get(k).includes(carteId)), JSON.stringify(c0));
    const store2 = creer();
    await store2.charger();
    store2.changerUtilisateurDemo(saisie.user_id);
    const exp = await store2.agentPrendreCarteEquipe(carteId);
    assert.equal(exp.raison, "expiree");
    assert.equal(exp.par, admin.user_id);
    assert.deepEqual(await store2.agentPrendreCarteEquipe(carteId, { forcer: true }), { ok: true });
    store2.changerUtilisateurDemo(admin.user_id);
    const ctl = await store2.agentControlerCarte(carteId);
    assert.equal(ctl.raison, "reprise", "l'administration revient : refusé avant d'écrire");
    assert.equal(ctl.par, saisie.user_id);
    store2.changerUtilisateurDemo(saisie.user_id);
    assert.deepEqual(await store2.agentControlerCarte(carteId), { ok: true });
    await store2.agentCarte(carteId, "validee");
    store2.changerUtilisateurDemo(admin.user_id);
    const ec = await store2.agentEcarterCarte(carteId);
    assert.equal(ec.raison, "decidee", "S1 : une carte validée ne s'écarte pas");
    assert.equal(ec.par, saisie.user_id, "… et on sait qui l'a validée");
    await assert.rejects(store2.agentCarte(carteId, "ecartee"), /carte_decidee/);
  } finally {
    delete globalThis.localStorage;
  }
});

test("point 4 : le verrou est rendu sur toute sortie (filet autour du traitement, finally de l'échange)", () => {
  const src = fonctionSrc();
  assert.match(src, /Deno\.serve\(async \(req\) => \{\n\s+const sortie = \{ liberer: async \(\) => \{\}, nettoyer: async \(\) => \{\} \};\n\s+try \{\n\s+return await traiter\(req, sortie\);\n\s+\} catch \(err\) \{\n(?:\s+\/\/[^\n]*\n)?\s+await sortie\.nettoyer\(\)\.catch\(\(\) => \{\}\);\n\s+await sortie\.liberer\(\)/);
  assert.match(src, /sortie\.liberer = liberer;/);
  assert.match(src, /\} finally \{\n\s+await liberer\(\)\.catch\(\(\) => \{\}\);\n\s+await ecrivain\.close\(\)/);
});

test("point 5 : la discussion pleine est remplacée dans une seule transaction, le verrou passe sur la nouvelle", () => {
  const src = fonctionSrc();
  assert.match(src, /sb\.rpc\("remplacer_agent_conversation", \{ p_ancienne: ancien\.id, p_jeton: verrou\.jeton \}\)/);
  assert.match(src, /verrou = \{ id: rp\.data\.id, jeton: rp\.data\.jeton \};/);
});

test("point 8 : le devis dit qui a écrit le nombre", () => {
  const msgs = [
    { id: 1, role: "user", cree_le: "2026-11-27T08:00:00Z", auteur_id: JEREMY, contenu: [{ type: "text", text: "Voici l'échange\n<conversation>\n[27/11 08:00] Nani : For 11 people we take 2 minivans\n</conversation>" }] },
  ];
  const textes = textesDeNani(msgs);
  assert.ok(textes.length >= 1);
  assert.deepEqual(auteursDesTextes(msgs), [JEREMY]);
  assert.deepEqual(auteursDesTextes([{ ...msgs[0], auteur_id: undefined }]), [null], "un message d'avant : la propriétaire");
  const carte = readFileSync(new URL("../src/gestion/js/views/devis-carte.mjs", import.meta.url), "utf8");
  assert.match(carte, /tr\("écrit par \{prenom\} dans la conversation", \{ prenom: auteur\.prenom \}\)/);
  assert.match(vueSrc(), /auteur: \(\) => auteurDevis\(c\)/);
});

test("point 9 : réponse en cours à l'heure du serveur, prénom ou « une personne de l'équipe », « autre onglet » seulement pour soi", () => {
  assert.deepEqual(reponseEnCours({ reponse_en_cours: true, reponse_par: NANI, reponse_le: "2000-01-01T00:00:00Z" }), { par: NANI }, "la base fait foi, pas l'horloge du poste");
  assert.equal(reponseEnCours({ reponse_en_cours: false, reponse_le: new Date().toISOString() }), null);
  const vue = vueSrc();
  assert.match(vue, /moiAilleurs \? tr\("L'assistant vous répond dans un autre onglet…"\) : tr\("L'assistant répond à \{prenom\}…", \{ prenom: quiEst\(r\.par\) \}\)/);
  assert.match(vue, /const quiEst = \(id\) => \(!id \? tr\("une personne de l'équipe"\)/);
  const sb = readFileSync(new URL("../src/gestion/js/store-supabase.mjs", import.meta.url), "utf8");
  assert.match(sb, /sb\.rpc\("agent_reponses_en_cours", \{ p_entite: entiteId \}\)/);
});

test("point 10 : le canal se ferme en quittant l'Assistant", () => {
  const vue = vueSrc();
  assert.match(vue, /window\.addEventListener\("hashchange", quitter\);/);
  assert.match(vue, /if \(\/\^#\\\/agent\(\\\/\|\$\)\/\.test\(location\.hash\) && racine\.isConnected\) return;/);
  assert.match(vue, /arreterCanal\(\);\n\s+clearTimeout\(minuteurRelecture\);\n\s+window\.removeEventListener\("hashchange", quitter\);/);
});

test("point 11 : la fiche du dossier dit « Conversation de Nani avec l'assistant »", () => {
  const d = readFileSync(new URL("../src/gestion/js/views/dossier.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(d, /Seulement les miennes/);
  assert.match(d, /tr\("Conversation de \{prenom\} avec l'assistant", \{ prenom \}\)/);
  assert.match(readFileSync(new URL("../src/gestion/js/store-supabase.mjs", import.meta.url), "utf8"), /select\("id, titre, maj_le, user_id"\)\.eq\("dossier_id", dossierId\)/);
});

test("point 12 : l'Assistant s'adresse à la personne qui écrit, la voix de l'entreprise reste pour le client", () => {
  assert.equal(prenomProfil({ nom: "Jérémy Test" }), "Jérémy");
  assert.equal(prenomProfil({ email: "nani@test.local" }), "Nani");
  assert.equal(prenomProfil(null), "");
  const l = ligneAuteur({ auteur: "Jérémy", proprietaire: "Nani" });
  assert.match(l, /écrit par Jérémy, qui reprend la conversation de Nani : adresse-toi à Jérémy/);
  assert.match(l, /garde la voix et les modèles de l'entreprise/);
  assert.equal(ligneAuteur({ auteur: "Nani", proprietaire: "Nani" }), "");
  assert.equal(ligneAuteur({ auteur: "", proprietaire: "Nani" }), "", "jamais un prénom deviné");
  assert.match(fonctionSrc(), /\+ \(quiEcrit \? `\\n\$\{quiEcrit\}` : ""\);/, "dans le contexte de l'échange, pas dans les consignes en cache");
});

test("relecture n° 2, A : le contrôle de la carte passe avant chaque écriture (combinée, service, modification, temps)", () => {
  const vue = vueSrc();
  const valider = readFileSync(new URL("../src/gestion/js/views/agent-valider.mjs", import.meta.url), "utf8");
  assert.match(vue, /validerUnifie\(c, \{ donnees: donneesCarte\(c\), libelleEntreprise, whatsappLie: await conversationWaLiee\(\), avantCreer \}\)/);
  assert.match(valider, /creer: \(e, i, clientId\) => dans\(e\.entite_id, async \(\) => ouvrirDemande\(null, await preparationComplete\(sous\(e\)\), \{ auto: true, titre: c\.titre, surCree: \(\) => \{\}, clientId, whatsappLie, \.\.\.\(avantCreer \? \{ avantCreer \} : \{\}\) \}\)\)/, "chaque dossier de la carte combinée revérifie la prise");
  assert.match(vue, /ajouterParCarte\(\{ \.\.\.c, donnees: donneesReservation\(c\) \}, tr\("Service ajouté au dossier\."\), \{ avantEnregistrer: avantCreer \}\)/);
  assert.match(vue, /enregistrerReservation\(reservationModifiee\(ancienne, c\.donnees\), tr\("Service modifié\."\), ancienne, \{ avantEnregistrer: avantCreer \}\)/);
  assert.match(vue, /c\.genre === "temps"\) r = await ajouterTemps\(c, \{ avantCreer \}\)/);
  assert.match(vue, /async function ajouterTemps\(c, \{ avantCreer = null \} = \{\}\) \{\n\s+const d = c\.donnees;\n\s+try \{\n\s+\/\/ [^\n]+\n\s+const arret = avantCreer \? await avantCreer\(\) : null;/);
  assert.match(valider, /const arret = avantEnregistrer \? await avantEnregistrer\(\) : null;\n\s+if \(arret\) return \{ ok: false, motif: arret \};\n\s+await modifier\(/, "l'option ajoutée sans facture revérifie aussi");
});

test("relecture n° 2, B : le changement d'auteur ne sort jamais vers le client", () => {
  const noms = ["Jérémy", "Nani"];
  for (const t of ["Bonjour, Jérémy reprend la conversation de Nani.", "Message écrit par Jérémy.", "Hello, I am taking over this conversation.", "Hi, this is sent on behalf of Nani.", "Bonjour, je vous écris à la place de Nani."]) assert.ok(mentionReprise(t, { noms }), t);
  for (const t of ["Bonjour, à la place du ferry nous proposons un speedboat.", "Pickup at 10:00 at your hotel.", "Votre réservation est confirmée."]) assert.equal(mentionReprise(t, { noms }), "", t);
  const c = controlerReponse("Bonjour, Jérémy reprend la conversation de Nani. Pickup at 10:00.", { signer: true, permisHeures: new Set(["10:00"]), prenoms: noms, reprise: noms });
  const code = c.avertissements.find((a) => a.startsWith("mention_reprise:"));
  assert.ok(code, "signée ou non, la mention est signalée");
  const b = bloquantsReponse(c.avertissements);
  assert.ok(resteBloque(c.message, b).length > 0, "la copie et l'envoi restent bloqués tant qu'elle est là");
  assert.deepEqual(resteBloque("Bonjour, pickup at 10:00.", b), [], "retirée, la réponse se copie");
  const sans = controlerReponse("Hello Jérémy, see you", { signer: false, prenoms: ["Nani", "Jérémy"] });
  assert.ok(sans.avertissements.includes("prenom_equipe"), "le prénom de l'auteur réel est un prénom de l'équipe");
  const f = fonctionSrc();
  assert.match(f, /prenoms: \[\.\.\.new Set\(\[ra\.responsable, "Anaïs", "Nani", \.\.\.prenomsReprise\]\.filter\(Boolean\)\)\]/);
  assert.match(f, /\(memo as Record<string, unknown>\)\.reprise = prenomsReprise;/);
  assert.match(readFileSync(new URL("../supabase/functions/agent/outils.js", import.meta.url), "utf8"), /reprise: memo\.reprise \|\| \[\]/);
});

test("relecture n° 2, mineurs : ancien nom sans reprise forcée, amélioration validée avant GitHub, cartes rendues en quittant, conversation orpheline", () => {
  const sql = readFileSync(new URL("../docs/gestion/migration-133-assistant-equipe.sql", import.meta.url), "utf8");
  assert.match(sql, /return coalesce\(\(prendre_agent_carte_equipe\(p_carte, false\) ->> 'ok'\)::boolean, false\);/);
  const am = readFileSync(new URL("../supabase/functions/ameliorations/index.ts", import.meta.url), "utf8");
  assert.ok(am.indexOf('from("agent_cartes").update({ statut: "validee" })') < am.indexOf("api.github.com"), "la carte passe validée avant de créer l'issue");
  assert.match(am, /if \(decidee\.error\) \{\n\s+await admin\.from\("ameliorations"\)\.delete\(\)/);
  assert.match(vueSrc(), /if \(!faite\(id\)\) etat\.store\.agentRendreCarte\(id\)\.catch\(\(\) => \{\}\);/);
  const f = fonctionSrc();
  assert.match(f, /await sortie\.nettoyer\(\)\.catch\(\(\) => \{\}\);\n\s+await sortie\.liberer\(\)/);
  assert.match(f, /if \(!n\.error && !n\.count\) await sb\.from\("agent_conversations"\)\.delete\(\)\.eq\("id", neuve\);/);
  assert.equal(EN["Cette carte a déjà été validée par {qui} : elle ne s'écarte plus, le dossier existe."], "This card was already approved by {qui}: it can no longer be dismissed, the file exists.");
});
