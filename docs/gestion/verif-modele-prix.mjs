// Vérifie les migrations 121 (modèle de réponse de prix de Taxi) et 122 (Taxi sans signature) sur un Postgres en mémoire, avec des données
// inventées : seule l'entité Taxi change, seul le message perso-mwrcry7e reçoit l'usage « prix », un usage déjà choisi est gardé, la voix
// perd sa formule signée et rien d'autre, « Reply to a request » perd sa dernière ligne {entreprise}, et les deux se rejouent sans rien
// écrire. Puis l'Assistant lit les réglages obtenus : le modèle de Taxi entre dans ses consignes, jamais dans celles de Secret.
//   mkdir -p /tmp/verif && cd /tmp/verif && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/docs/gestion/verif-modele-prix.mjs . && GESTION_SQL=<repo>/docs/gestion/ GESTION_SRC=file://<repo>/src/gestion/js/ node verif-modele-prix.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
const W = process.env.GESTION_SQL || "./";
const SRC = process.env.GESTION_SRC || new URL("../../src/gestion/js/", import.meta.url).href;
const AGENT = new URL("../../../supabase/functions/agent/", SRC).href;
const { modelesPrix, consignesModelesPrix } = await import(AGENT + "modele-prix.js");
const { consignes, voixPour } = await import(AGENT + "prompt.js");
let echecs = 0;
const ok = (c, msg) => { if (!c) { echecs++; console.log("  ECHEC:", msg); } else console.log("  ok:", msg); };

const TAXI = "00000000-0000-4000-8000-000000000003";
const SECRET = "00000000-0000-4000-8000-000000000002";
const ZTP = "00000000-0000-4000-8000-000000000001";
const MODELE = { id: "perso-mwrcry7e", pour: "client", cle: null, titre: "Price quote (private transfer)", langue: "en", corps: "Hello,\n\nThe private transfer is {total}, all fees included.\nPayment in cash to the driver.\n\nShall I book it? 🙏🏼" };
const REPONSE = { id: "reponse-en", pour: "client", cle: "reponse", titre: "Reply to a request", langue: "en", corps: "{bonjour}\n\nThank you for your message. Here is what we can offer:\n\n{services}\n\nTotal: {total}\n\nWould you like me to book it?\n{entreprise}" };
const VOIX_EN = 'You write for {entreprise}, a private taxi service.\nWhen something is missing, ask for it simply. End with a short line inviting them to reply here, then "Have a nice day, {entreprise}".';
const VOIX_FR = "Tu écris pour {entreprise}, un service de taxi privé.\nQuand une information manque, elle la demande simplement. Elle termine par « N'hésitez pas à me répondre directement ici », puis « Belle journée, {entreprise} ».";
const reglagesTaxi = { fonctionnement: "taxi", assistant_voix: { lieu: "Koh Lanta", en: VOIX_EN, fr: VOIX_FR }, messages: [{ id: "taxi-avis-en", pour: "client", cle: "avis", titre: "Review", langue: "en", corps: "Thanks!" }, REPONSE, MODELE] };
// Secret a un message au même id, sans usage : il n'est pas touché. ZTP garde sa signature.
const reglagesSecret = { fonctionnement: "excursions", assistant_voix: { en: VOIX_EN, fr: VOIX_FR }, messages: [{ ...MODELE, titre: "Autre texte de Secret" }, REPONSE] };
const reglagesZtp = { fonctionnement: "sur_mesure", assistant_voix: { en: VOIX_EN, fr: VOIX_FR }, messages: [REPONSE] };

const db = new PGlite();
await db.exec("create table reglages (entite_id uuid primary key, valeur jsonb not null, updated_at timestamptz not null default now());");
const poser = async (id, v) => db.query("insert into reglages (entite_id, valeur, updated_at) values ($1, $2, '2026-11-01') on conflict (entite_id) do update set valeur = excluded.valeur, updated_at = excluded.updated_at", [id, JSON.stringify(v)]);
for (const [id, v] of [[TAXI, reglagesTaxi], [SECRET, reglagesSecret], [ZTP, reglagesZtp]]) await poser(id, v);
const lire = async (id) => (await db.query("select valeur, updated_at::text u from reglages where entite_id = $1", [id])).rows[0];
const M121 = fs.readFileSync(W + "migration-121-modele-prix-taxi.sql", "utf8");
const M122 = fs.readFileSync(W + "migration-122-taxi-sans-signature.sql", "utf8");

console.log("== Migration 121 ==");
const secretAvant = await lire(SECRET);
const ztpAvant = await lire(ZTP);
await db.exec(M121);
let t = await lire(TAXI);
const m = t.valeur.messages.find((x) => x.id === "perso-mwrcry7e");
ok(m.cle === "prix" && m.corps === MODELE.corps && m.titre === MODELE.titre && m.langue === "en" && m.pour === "client", "Taxi : le modèle reçoit l'usage « prix », texte, titre et langue gardés");
ok(t.valeur.messages.map((x) => x.id).join() === "taxi-avis-en,reponse-en,perso-mwrcry7e", "Taxi : les messages gardent leur ordre");
ok(t.valeur.messages.find((x) => x.id === "taxi-avis-en").cle === "avis", "Taxi : les autres usages ne changent pas");
ok(JSON.stringify(await lire(SECRET)) === JSON.stringify(secretAvant) && JSON.stringify(await lire(ZTP)) === JSON.stringify(ztpAvant), "Secret et ZTP : rien ne change (même id chez Secret)");
let u = t.u;
await db.exec(M121);
ok((await lire(TAXI)).u === u, "121 rejouée : aucune ligne réécrite");
// Un usage déjà choisi par Nani n'est pas remplacé.
await poser(TAXI, { ...reglagesTaxi, messages: [{ ...MODELE, cle: "reponse" }] });
await db.exec(M121);
ok((await lire(TAXI)).valeur.messages[0].cle === "reponse", "un usage déjà choisi est gardé");
// Sans le message (ou sans messages), rien.
await poser(TAXI, { ...reglagesTaxi, messages: undefined });
await db.exec(M121);
ok((await lire(TAXI)).u.startsWith("2026-11-01"), "sans messages : rien n'est écrit");
await poser(TAXI, reglagesTaxi);
await db.exec(M121);

console.log("== Migration 122 ==");
await db.exec(M122);
t = await lire(TAXI);
const v = t.valeur.assistant_voix;
ok(v.en === 'You write for {entreprise}, a private taxi service.\nWhen something is missing, ask for it simply. End with a short line inviting them to reply here.', "voix anglaise : la formule signée est retirée, le reste est gardé");
ok(v.fr === "Tu écris pour {entreprise}, un service de taxi privé.\nQuand une information manque, elle la demande simplement. Elle termine par « N'hésitez pas à me répondre directement ici ».", "voix française : la formule signée est retirée, le reste est gardé");
ok(v.lieu === "Koh Lanta", "voix : le lieu est gardé");
const rep = t.valeur.messages.find((x) => x.id === "reponse-en");
ok(rep.corps === "{bonjour}\n\nThank you for your message. Here is what we can offer:\n\n{services}\n\nTotal: {total}\n\nWould you like me to book it?", "« Reply to a request » : la dernière ligne {entreprise} est retirée");
ok(t.valeur.messages.find((x) => x.id === "perso-mwrcry7e").cle === "prix", "le modèle de prix garde son usage");
ok(JSON.stringify(await lire(SECRET)) === JSON.stringify(secretAvant) && JSON.stringify(await lire(ZTP)) === JSON.stringify(ztpAvant), "Secret et ZTP : rien ne change");
u = t.u;
await db.exec(M122);
ok((await lire(TAXI)).u === u, "122 rejouée : aucune ligne réécrite");
// Une voix sans formule signée (écrite par Nani) : rien n'est écrit.
await poser(TAXI, { ...reglagesTaxi, assistant_voix: { en: "Short and warm.", fr: "" }, messages: [] });
await db.exec(M122);
ok((await lire(TAXI)).u.startsWith("2026-11-01"), "voix déjà sans signature : rien n'est écrit");
await poser(TAXI, reglagesTaxi);
await db.exec(M121);
await db.exec(M122);

console.log("== L'Assistant lit les réglages obtenus ==");
const rt = (await lire(TAXI)).valeur;
const rs = (await lire(SECRET)).valeur;
ok(modelesPrix(rt).length === 1 && modelesPrix(rt)[0].id === "perso-mwrcry7e", "Taxi : un modèle de prix");
ok(modelesPrix(rs).length === 0, "Secret : aucun modèle de prix (le message au même id n'a pas d'usage)");
const cT = consignes({ entreprise: "Taxi Démo", reglages: rt, prenomEquipe: "Nani" });
const cS = consignes({ entreprise: "Secret Démo", reglages: rs, prenomEquipe: "Nani" });
ok(cT.includes("perso-mwrcry7e") && cT.includes("The private transfer is {total}"), "Taxi : le modèle entre dans les consignes");
ok(!cS.includes("perso-mwrcry7e") && !cS.includes("The private transfer is {total}") && consignesModelesPrix(rs) === "", "Secret : jamais le modèle de Taxi");
ok(!/Have a nice day, Taxi Démo|Belle journée, Taxi Démo/.test(cT) && !/Have a nice day|Belle journée/.test(JSON.stringify(voixPour(rt, "Taxi Démo", "Nani"))), "Taxi : plus de formule signée dans la voix");

console.log(echecs ? `\n${echecs} échec(s)` : "\nTout est bon.");
process.exit(echecs ? 1 : 0);
