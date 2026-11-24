// Notifications en thaï du partenaire chauffeur (migration 123) : textes, trois envois, périmètre des champs, et envois des membres inchangés.
// Données fictives uniquement. Les règles de la base (périmètre, annulation, doublons, compte désactivé) : docs/gestion/verif-notifications-partenaire.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { TH_NOTIF, ICONE, dateTh, personnesTh, destinationTh, trajetTh, changements, messageChangement, messageVeillePartenaire, coursesH1, h1Actif, messageH1Partenaire, cleVeille, cleH1, VEILLE_MAX } from "../supabase/functions/rappels/partenaire.js";
import { entitesLisibles, destinatairesH1, rappelVeille, servicesH1, messageH1, instantLocal } from "../supabase/functions/rappels/calc.js";
import * as ecran from "../src/gestion/js/courses-partenaire-calc.mjs";

const SOURCE = fs.readFileSync(new URL("../supabase/functions/rappels/partenaire.js", import.meta.url), "utf8");
const INDEX = fs.readFileSync(new URL("../supabase/functions/rappels/index.ts", import.meta.url), "utf8");
const latin = (v) => v.replace(/\{[a-z]+\}/g, "").match(/[A-Za-zÀ-ÿ]{2,}/);

// Une course telle que la rend partenaire_notif_courses(), plus des champs qui ne doivent jamais sortir (la base ne les rend pas : s'ils
// arrivaient quand même, aucun texte ne les écrit).
const course = (o = {}) => ({
  id: "r1", date_service: "2026-11-25", heure: "09:30", pickup: "Hotel Test A", dropoff: "Airport Test", retour: false, programme: "",
  adultes: 2, enfants: 1, bebes: 0, client: "Test Client", libelle: "Private Taxi test", jour: "2026-11-24", entite_id: "T",
  prix: 1800, commission: 300, ref: "T-001", notes: "note interne test", telephone: "+44 7700 900111", net: 900, ...o,
});
const SECRETS = ["1800", "1,800", "300", "T-001", "note interne", "900111", "900"];
const sansSecret = (m) => {
  const tout = `${m.titre}\n${m.corps}`;
  for (const s of SECRETS) assert.ok(!tout.includes(s), `« ${s} » ne sort pas : ${tout}`);
};

test("textes : tout en thaï, chacun avec sa traduction française en commentaire", () => {
  for (const [cle, v] of Object.entries(TH_NOTIF)) {
    assert.equal(latin(v), null, `${cle} : aucun mot français ou anglais (${v})`);
    const ligne = SOURCE.split("\n").find((l) => l.trimStart().startsWith(`${cle}:`));
    assert.match(ligne, /\/\/ \S/, `${cle} : traduction en commentaire`);
  }
  for (const cle of Object.keys(ecran.TH).filter((k) => k.startsWith("notif_"))) {
    assert.equal(latin(ecran.TH[cle]), null, `écran ${cle} : thaï seulement`);
    const ligne = fs.readFileSync(new URL("../src/gestion/js/courses-partenaire-calc.mjs", import.meta.url), "utf8").split("\n").find((l) => l.trimStart().startsWith(`${cle}:`));
    assert.match(ligne, /\/\/ \S/, `écran ${cle} : traduction en commentaire`);
  }
});

test("dates, personnes et destination s'écrivent comme sur son écran", () => {
  for (const iso of ["2026-11-25", "2026-12-31", "2027-02-28", "", "pas une date"]) assert.equal(dateTh(iso), ecran.dateTh(iso));
  for (const c of [course(), course({ adultes: 0, enfants: 0, bebes: 2 }), course({ adultes: "3" }), course({ retour: true, programme: "Old Town Test" }), course({ dropoff: "  " })]) {
    assert.equal(personnesTh(c), ecran.personnesTh(c));
    assert.equal(destinationTh(c), ecran.destinationTh(c));
  }
  assert.equal(TH_NOTIF.retour, ecran.TH.retour);
});

test("1. nouvelle course : date, heure, trajet, personnes et nom du client (déjà sur son écran), rien d'interne", () => {
  const m = messageChangement({ reservation_id: "r1", genre: "nouvelle", apercu: course() });
  assert.equal(m.titre, `${TH_NOTIF.nouvelle} · ${ecran.dateTh("2026-11-25")} 09:30`);
  assert.equal(m.corps, "Hotel Test A → Airport Test · ผู้ใหญ่ 2 · เด็ก 1 · ลูกค้า Test Client");
  assert.equal(m.tag, "p-course-r1");
  assert.equal(m.url, "/gestion/#/");
  assert.equal(m.icone, ICONE);
  assert.ok(fs.existsSync(new URL(`../src${ICONE}`, import.meta.url)), "l'icône de VIP Taxi Lanta est servie avec l'outil");
  sansSecret(m);
  const sansHeure = messageChangement({ reservation_id: "r1", genre: "nouvelle", apercu: course({ heure: "", pickup: "" }) });
  assert.match(sansHeure.titre, new RegExp(TH_NOTIF.sans_heure));
  assert.match(sansHeure.corps, new RegExp(`^${TH_NOTIF.sans_lieu} → `));
  const allerRetour = messageChangement({ reservation_id: "r1", genre: "nouvelle", apercu: course({ retour: true, programme: "Old Town Test" }) });
  assert.match(allerRetour.corps, /Hotel Test A → ไปแล้วกลับมาจุดรับเดิม · Old Town Test/);
});

test("1. course modifiée : ce qui a changé, le nouvel état, sans nom de client", () => {
  const m = messageChangement({ reservation_id: "r1", genre: "modifiee", apercu: course({ heure: "10:00", pickup: "Hotel Test C", adultes: 3 }), apercu_avant: course() });
  assert.equal(m.titre, `${TH_NOTIF.modifiee} · ${ecran.dateTh("2026-11-25")} 10:00`);
  assert.equal(m.corps, "เปลี่ยน: เวลารับ, จุดรับ, จำนวนคน\nHotel Test C → Airport Test · ผู้ใหญ่ 3 · เด็ก 1");
  assert.ok(!m.corps.includes("Test Client"));
  sansSecret(m);
  assert.deepEqual(changements(course(), course({ date_service: "2026-11-26", dropoff: "Pier Test" })), [TH_NOTIF.c_date, TH_NOTIF.c_dropoff]);
  assert.deepEqual(changements(course(), course({ retour: true })), [TH_NOTIF.c_dropoff]);
  assert.deepEqual(changements(course(), course({ client: "Autre", libelle: "x" })), [], "le nom du client ou le libellé ne comptent pas");
  assert.deepEqual(changements(null, course()), []);
});

test("1. course annulée : ce qu'il avait vu, sans nom de client", () => {
  const m = messageChangement({ reservation_id: "r1", genre: "annulee", apercu: course(), apercu_avant: course() });
  assert.equal(m.titre, `${TH_NOTIF.annulee} · ${ecran.dateTh("2026-11-25")} 09:30`);
  assert.equal(m.corps, "Hotel Test A → Airport Test · ผู้ใหญ่ 2 · เด็ก 1");
  assert.equal(m.tag, "p-course-r1", "remplace la notification précédente de la même course sur le téléphone");
  sansSecret(m);
});

test("1. course qui ne lui est plus confiée : un texte à part, date, heure et trajet, rien sur le pourquoi", () => {
  const m = messageChangement({ reservation_id: "r1", genre: "retiree", apercu: course(), apercu_avant: course() });
  assert.equal(TH_NOTIF.retiree, "งานนี้ไม่ใช่ของคุณแล้ว");
  assert.equal(m.titre, `งานนี้ไม่ใช่ของคุณแล้ว · ${ecran.dateTh("2026-11-25")} 09:30`);
  assert.equal(m.corps, "Hotel Test A → Airport Test · ผู้ใหญ่ 2 · เด็ก 1");
  assert.notEqual(m.titre.split(" · ")[0], TH_NOTIF.annulee);
  assert.ok(!m.corps.includes("Test Client"));
  sansSecret(m);
});

test("service worker : les notifications du partenaire sonnent de nouveau (renotify) et portent l'icône de Taxi, une adresse de l'outil seulement", () => {
  const sw = fs.readFileSync(new URL("../src/gestion/sw.js", import.meta.url), "utf8");
  assert.match(sw, /startsWith\("p-"\)/);
  assert.match(sw, /renotify: true/);
  const regle = /\/\^\\\/gestion\\\/assets\\\/\[\\w\.-\]\+\\\.png\$\//;
  assert.match(sw, regle, "seule une image de /gestion/assets/ est acceptée");
  for (const m of [messageChangement({ reservation_id: "r", genre: "nouvelle", apercu: course() }), messageVeillePartenaire([course()], "2026-11-25"), messageH1Partenaire({ course: course(), minutes: 58 })]) {
    assert.ok(m.tag.startsWith("p-") && m.icone === ICONE);
  }
});

test("2. résumé de la veille : nombre de courses de demain, puis chaque heure et chaque trajet, sans nom de client", () => {
  const liste = [course({ id: "a", heure: "14:00", pickup: "Hotel B" }), course({ id: "b", heure: "07:15" }), course({ id: "c", date_service: "2026-11-26" }), course({ id: "d", date_service: "2026-11-24" })];
  const m = messageVeillePartenaire(liste, "2026-11-25");
  assert.equal(m.titre, "พรุ่งนี้มี 2 งาน");
  assert.equal(m.corps, "07:15 Hotel Test A → Airport Test\n14:00 Hotel B → Airport Test");
  assert.ok(!`${m.titre}${m.corps}`.includes("Test Client"));
  sansSecret(m);
  assert.equal(messageVeillePartenaire([course({ date_service: "2026-11-26" })], "2026-11-25"), null, "aucune course demain : rien n'est envoyé");
  assert.equal(messageVeillePartenaire([], "2026-11-25"), null);
  const beaucoup = messageVeillePartenaire(Array.from({ length: VEILLE_MAX + 3 }, (_, i) => course({ id: `x${i}`, heure: `${String(6 + i).padStart(2, "0")}:00` })), "2026-11-25");
  assert.equal(beaucoup.corps.split("\n").length, VEILLE_MAX + 1);
  assert.match(beaucoup.corps, /และอีก 3 งาน$/);
  assert.equal(cleVeille("2026-11-25"), "veille:2026-11-25");
});

test("3. une heure avant : même fenêtre que les membres, une clé par course et par heure, sans nom de client", () => {
  const fuseau = "Asia/Bangkok";
  const debut = instantLocal(fuseau, 2026, 11, 25, 9, 30);
  const liste = [course(), course({ id: "r2", heure: "15:00" }), course({ id: "r3", heure: "TBC" }), course({ id: "r4", libelle: "Frais de parc test", heure: "09:40" })];
  for (const [minutes, attendu] of [[60, ["r1"]], [55, ["r1"]], [40, ["r1"]], [61, []], [39, []]]) {
    assert.deepEqual(coursesH1(liste, debut - minutes * 60000, { fuseau }).map((x) => x.course.id), attendu, `${minutes} min avant`);
  }
  const [x] = coursesH1(liste, debut - 58 * 60000, { fuseau });
  const m = messageH1Partenaire(x);
  assert.equal(m.titre, `${TH_NOTIF.h1_heure} · 09:30`);
  assert.equal(m.corps, "Hotel Test A → Airport Test · ผู้ใหญ่ 2 · เด็ก 1");
  assert.ok(!m.corps.includes("Test Client"));
  sansSecret(m);
  assert.equal(messageH1Partenaire({ ...x, minutes: 45 }).titre, "อีก 45 นาที รับลูกค้า · 09:30");
  // La même course au passage suivant donne la même clé : marquée une fois, jamais deux envois. Une heure changée en donne une autre.
  assert.equal(cleH1(course(), fuseau), cleH1(course({ client: "Autre" }), fuseau));
  assert.notEqual(cleH1(course(), fuseau), cleH1(course({ heure: "09:45" }), fuseau));
  assert.equal(cleH1(course({ heure: "" }), fuseau), null);
  // Réglages : l'entreprise qui coupe « Rappel 1 h avant », ou le compte qui le coupe dans son profil, n'en reçoit pas.
  assert.equal(h1Actif({ fonctionnement: "taxi" }, { rappel_h1: true }), true);
  assert.equal(h1Actif({ fonctionnement: "taxi", rappels: { h1: false } }, {}), false);
  assert.equal(h1Actif({ fonctionnement: "taxi" }, { rappel_h1: false }), false);
  assert.equal(h1Actif({ fonctionnement: "agence" }, {}), false);
});

test("envois des membres inchangés : le compte partenaire n'y entre jamais et ne change rien aux autres", () => {
  const profils = [
    { user_id: "nani", actif: true, super_admin: false, organisation_id: "O" },
    { user_id: "brown", actif: true, super_admin: false, organisation_id: "O" },
  ];
  const roles = [{ id: "admin", portee: "toute", permissions: [], tous_droits: true }];
  const membres = [{ user_id: "nani", entite_id: "T", role_id: "admin" }];
  const entites = [{ id: "T", organisation_id: "O" }];
  // Le compte partenaire n'a aucune ligne dans membres (migration 115) : aucune entreprise, aucun rappel des membres.
  assert.deepEqual(entitesLisibles({ profil: profils[1], membres, roles, entites }), []);
  assert.deepEqual(destinatairesH1({ profils, membres, roles, entites }, "T"), ["nani"]);
  assert.deepEqual(destinatairesH1({ profils, membres, roles, entites }, "T"), destinatairesH1({ profils: [profils[0]], membres, roles, entites }, "T"));
  // Les textes des membres restent en français, avec le nom du client dans le rappel d'une heure avant (comme avant).
  const services = [{ entite_id: "T", dossier_id: "d1", statut: "confirme", heure_pickup: "09:30", lieu_pickup: "Hotel Test A", date_service: "2026-11-25" }];
  assert.equal(rappelVeille(services, "2026-11-25", { entiteIds: ["T"] }).titre, "1 service demain");
  const [s] = servicesH1([{ ...services[0], id: "r1", libelle: "Private Taxi test", personnes: { adultes: 2 } }], instantLocal("Asia/Bangkok", 2026, 11, 25, 9, 30) - 58 * 60000);
  assert.deepEqual(messageH1(s, { client: "Test Client" }), { titre: "Dans 1 h : Test Client, Private Taxi test", corps: "2 adultes, pickup 09:30, Hotel Test A", tag: "h1-r1", url: "/gestion/#/reservation/r1?entite=T" });
});

test("fonction rappels : le passage du partenaire est à part, après les membres, et ne lit ses courses que par la base", () => {
  // Une panne du passage du partenaire est attrapée : la réponse des membres et leur ligne de suivi ne changent pas.
  assert.match(INDEX, /async function partenairesH1Protege[\s\S]*?try \{\n\s+return await partenairesH1\(db, maintenant, demande\);\n\s+\} catch/);
  // Sa panne se voit : statut 500 (passage h1 et passage de la veille), même quand la lecture des services des membres a échoué avant.
  assert.match(INDEX, /erreur \|\| partenaires\.erreur \? 500 : 200/);
  assert.match(INDEX, /r\.partenaires && r\.partenaires\.erreur\)\) \? 500 : 200/);
  assert.match(INDEX, /console\.error\("rappel h1 :", erreur\);\n\s+const partenaires = await partenairesH1Protege\(db, maintenant, demande\);/);
  assert.match(INDEX, /try \{\n\s+partenaires = await partenairesVeille\(db, retenues, cible, demande\);\n\s+\} catch/);
  const partie = INDEX.slice(INDEX.indexOf("// ---- Partenaire chauffeur (migration 123)"));
  assert.ok(partie.length > 1000);
  assert.doesNotMatch(partie, /from\("reservations"\)|from\("reservations_nets"\)|from\("dossiers"\)|from\("clients"\)/, "aucune lecture directe des courses, des nets ni des clients");
  assert.match(partie, /rpc\("partenaire_notif_courses"/);
  assert.match(partie, /rpc\("partenaire_notifs_changements"\)/);
  // Le code des envois aux membres ne parle pas du partenaire.
  const membres = INDEX.slice(0, INDEX.indexOf("// ---- Partenaire chauffeur (migration 123)"));
  for (const f of ["async function executer(", "async function envoyerH1(", "async function executerDeparts("]) {
    const debut = membres.indexOf(f);
    const corps = membres.slice(debut, membres.indexOf("\n}\n", debut));
    assert.ok(debut > 0 && !/partenaire_notif|partenaires_acces|partenaire\.js/.test(corps), f);
  }
});

test("écran thaï : le bloc des notifications selon la situation du téléphone", () => {
  assert.deepEqual(ecran.blocNotifTh("inactif"), { etat: "inactif", texte: ecran.TH.notif_aide, bouton: ecran.TH.notif_activer });
  assert.deepEqual(ecran.blocNotifTh("actif"), { etat: "actif", texte: ecran.TH.notif_actives, bouton: ecran.TH.notif_couper });
  assert.equal(ecran.blocNotifTh("installer").bouton, null);
  assert.match(ecran.blocNotifTh("installer").texte, /หน้าจอโฮม/);
  assert.equal(ecran.blocNotifTh("refuse").bouton, null);
  assert.equal(ecran.blocNotifTh("indisponible").bouton, null);
  assert.equal(ecran.blocNotifTh(undefined).etat, "inactif");
  const css = fs.readFileSync(new URL("../src/gestion/css/app.css", import.meta.url), "utf8");
  for (const sel of [".cp-notif-bouton", ".cp-notif-lien", ".cp-notif-choix .cp-bouton"]) {
    const regle = css.split("\n").find((l) => l.startsWith(sel + " {"));
    assert.ok(Number((/min-height: (\d+)px/.exec(regle) || [])[1]) >= 44, `${sel} : au moins 44 px`);
  }
  // Couper demande une confirmation en thaï avant d'agir.
  const vue = fs.readFileSync(new URL("../src/gestion/js/views/courses-partenaire.mjs", import.meta.url), "utf8");
  assert.match(vue, /dessinerNotif\(sit, \{ confirmer: true \}\)/);
  assert.match(vue, /onclick: \(\) => agir\(true\) \}, TH\.notif_oui_couper/);
});

test("écran thaï : la vue se lit sans erreur de syntaxe (aucun nom déclaré deux fois)", () => {
  for (const f of ["../src/gestion/js/views/courses-partenaire.mjs", "../src/gestion/sw.js", "../supabase/functions/rappels/partenaire.js"]) {
    execFileSync(process.execPath, ["--check", new URL(f, import.meta.url).pathname], { stdio: "pipe" });
  }
});
