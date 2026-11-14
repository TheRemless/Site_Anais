import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dateBangkok, decaler, entitesLisibles, rappelVeille, rappelLendemain, rappelDuType, dateCible } from "../supabase/functions/rappels/calc.js";
import { cleVapid } from "../src/gestion/js/rappels.mjs";

const nomEntite = (id) => ({ S: "Secret", T: "Taxi" })[id] || "";
const R = [
  { entite_id: "S", dossier_id: "d1", statut: "confirme", heure_pickup: "08:00", date_service: "2026-11-10" },
  { entite_id: "S", dossier_id: "d1", statut: "a_demander", heure_pickup: "", date_service: "2026-11-10" },
  { entite_id: "T", dossier_id: "d2", statut: "demande", heure_pickup: "  ", date_service: "2026-11-10" },
  { entite_id: "T", dossier_id: "d3", statut: "annule", heure_pickup: "", date_service: "2026-11-10" },
  { entite_id: "S", dossier_id: "d4", statut: "confirme", heure_pickup: "09:00", date_service: "2026-11-10" },
  { entite_id: "S", dossier_id: "d5", statut: "confirme", heure_pickup: "07:00", date_service: "2026-11-08" },
  { entite_id: "T", dossier_id: "d6", statut: "confirme", heure_pickup: "07:00", date_service: "2026-11-08" },
  { entite_id: "T", dossier_id: "d6", statut: "confirme", heure_pickup: "15:00", date_service: "2026-11-08" },
];

test("dates : le jour se lit à Bangkok, sept heures après l'heure UTC du serveur", () => {
  assert.equal(dateBangkok(new Date("2026-11-09T11:00:00Z")), "2026-11-09");
  assert.equal(dateBangkok(new Date("2026-11-09T17:30:00Z")), "2026-11-10");
  assert.equal(decaler("2026-11-30", 1), "2026-12-01");
  assert.equal(decaler("2026-03-01", -1), "2026-02-28");
  assert.equal(dateCible("veille", "2026-11-09"), "2026-11-10");
  assert.equal(dateCible("lendemain", "2026-11-09"), "2026-11-08");
  assert.equal(dateCible("autre", "2026-11-09"), null);
});

test("veille : compte les services de demain, signale heure et confirmation manquantes, sans nom de client", () => {
  const m = rappelVeille(R, "2026-11-10", { entiteIds: null, nomEntite });
  assert.equal(m.titre, "4 services demain");
  assert.equal(m.corps, "Secret 3, Taxi 1. 2 sans heure de pickup.");
  assert.equal(m.tag, "veille");
});

test("veille : tout est en ordre, un seul service, une seule entreprise", () => {
  const m = rappelVeille(R, "2026-11-10", { entiteIds: ["S"], ecartes: new Set(["d1"]), nomEntite });
  assert.equal(m.titre, "1 service demain");
  assert.equal(m.corps, "Chaque pickup a une heure.");
});

test("veille : rien à signaler s'il n'y a aucun service, les dossiers annulés et les entreprises non lisibles sont écartés", () => {
  assert.equal(rappelVeille(R, "2026-11-20", { entiteIds: null, nomEntite }), null);
  assert.equal(rappelVeille(R, "2026-11-10", { entiteIds: [], nomEntite }), null);
  assert.equal(rappelVeille(R, "2026-11-10", { entiteIds: ["T"], ecartes: new Set(["d2"]), nomEntite }), null);
});

test("lendemain : compte les clients, pas les services, et ne nomme personne", () => {
  const m = rappelLendemain(R, "2026-11-08", { entiteIds: null, nomEntite });
  assert.equal(m.titre, "2 clients à recontacter");
  assert.equal(m.corps, "Secret 1, Taxi 1. Services d'hier : demandez-leur comment c'était.");
  const seul = rappelLendemain(R, "2026-11-08", { entiteIds: ["T"], nomEntite });
  assert.equal(seul.titre, "1 client à recontacter");
  assert.equal(seul.corps, "Services d'hier : demandez-leur comment c'était.");
  assert.doesNotMatch(JSON.stringify([m, seul]), /d[1-6]\b/);
});

test("rappelDuType : le type choisit la date, un type inconnu ne donne rien", () => {
  assert.equal(rappelDuType("veille", R, "2026-11-09", { entiteIds: null, nomEntite }).tag, "veille");
  assert.equal(rappelDuType("lendemain", R, "2026-11-09", { entiteIds: null, nomEntite }).tag, "lendemain");
  assert.equal(rappelDuType("autre", R, "2026-11-09", { entiteIds: null, nomEntite }), null);
});

test("entreprises lisibles : super admin voit tout, un rôle limité ou inactif ne reçoit rien", () => {
  const roles = [
    { id: "r1", portee: "toute", permissions: ["dossiers.lire"] },
    { id: "r2", portee: "mes_dossiers", permissions: ["dossiers.lire"] },
    { id: "r3", portee: "toute", permissions: ["taches.lire"] },
  ];
  const membres = [
    { user_id: "u", entite_id: "S", role_id: "r1" },
    { user_id: "u", entite_id: "T", role_id: "r2" },
    { user_id: "u", entite_id: "Z", role_id: "r3" },
    { user_id: "autre", entite_id: "Z", role_id: "r1" },
  ];
  assert.deepEqual(entitesLisibles({ profil: { user_id: "u", actif: true, super_admin: false }, membres, roles }), ["S"]);
  assert.equal(entitesLisibles({ profil: { user_id: "u", actif: true, super_admin: true }, membres, roles }), null);
  assert.deepEqual(entitesLisibles({ profil: { user_id: "u", actif: false, super_admin: true }, membres, roles }), []);
  assert.deepEqual(entitesLisibles({ profil: null, membres, roles }), []);
});

test("entreprises lisibles : le rôle « vouchers.seul » (assistante de Taxi) ne reçoit aucun rappel", () => {
  const roles = [
    { id: "admin", portee: "toute", permissions: ["dossiers.lire", "dossiers.ecrire"] },
    { id: "mook", portee: "toute", permissions: ["clients.lire", "dossiers.lire", "dossiers.ecrire", "vouchers.seul", "fiduciaire.preparer"] },
  ];
  const membres = [
    { user_id: "mook", entite_id: "T", role_id: "mook" },
    { user_id: "anais", entite_id: "T", role_id: "admin" },
    { user_id: "anais", entite_id: "S", role_id: "admin" },
  ];
  assert.deepEqual(entitesLisibles({ profil: { user_id: "mook", actif: true, super_admin: false }, membres, roles }), []);
  assert.deepEqual(entitesLisibles({ profil: { user_id: "anais", actif: true, super_admin: false }, membres, roles }), ["T", "S"], "les autres rôles ne changent pas");
});

test("clé VAPID : la clé publique en base64url devient 65 octets, point non compressé", () => {
  const cle = cleVapid("BO9VT10PvJTFqIFkhxArLQ1qbiuwaZHrYeKdCMhakxaxd7OUDkmAMePSqRHhcKykR2-1Gv_4W4BKGcXFWGxEVS8");
  assert.equal(cle.length, 65);
  assert.equal(cle[0], 4);
});

test("service worker : affiche les rappels et ouvre l'outil ; ne garde en cache que la page hors connexion, jamais l'application", () => {
  const sw = fs.readFileSync("src/gestion/sw.js", "utf8");
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  // La liste mise en cache est exactement celle de la page hors connexion : quatre fichiers, aucun écran ni script de l'application.
  const liste = (sw.match(/const FICHIERS = \[([^\]]+)\]/) || [])[1] || "";
  assert.deepEqual([...liste.matchAll(/"([^"]+)"/g)].map((m) => m[1]), ["hors-ligne.html", "hors-ligne.css", "hors-ligne.mjs", "js/feuille-hors-ligne-lecture.mjs"]);
  // Réseau d'abord : le cache ne sert que si la requête échoue ; une navigation réussie n'est jamais stockée.
  assert.match(sw, /fetch\(req\)\.catch/);
  // Seules les réponses de ces quatre fichiers sont écrites dans le cache (mise à jour de la page hors connexion), jamais une page ou un script de l'application.
  assert.equal((sw.match(/\.put\(/g) || []).length, 1);
  assert.match(sw, /FICHIERS\.includes\(req\.url\)\)\s*\{[^}]*c\.put\(req/s);
  // Un seul cache, ouvert sous son nom fixe (à l'installation et pour la mise à jour des quatre fichiers).
  assert.deepEqual([...sw.matchAll(/caches\.open\(([^)]*)\)/g)].map((m) => m[1]), ["CACHE", "CACHE"]);
});

test("page hors connexion : n'importe que le module de lecture, ce que le service worker garde", () => {
  const page = fs.readFileSync("src/gestion/hors-ligne.mjs", "utf8");
  assert.deepEqual([...page.matchAll(/from "([^"]+)"/g)].map((m) => m[1]), ["./js/feuille-hors-ligne-lecture.mjs"]);
  assert.doesNotMatch(page, /innerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(fs.readFileSync("src/gestion/js/feuille-hors-ligne-lecture.mjs", "utf8"), /^import /m);
});
