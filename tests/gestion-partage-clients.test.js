// Fiches clients partagées entre entreprises d'une organisation (demande de Jérémy, 18.11.2026 ; migration 46).
// ZTP partage ses fiches avec Secret et Taxi : une seule fiche, sans copie ; sens unique ; l'administration seule s'en sert ;
// l'assistante (Mook) voit seulement le nom du client sur ses dossiers. La base est vérifiée par docs/gestion/verif-partage-clients.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  sourcesDe, peutUtiliserPartages, clientsDeLEntreprise, clientsPartages, clientsProposes, clientEtranger, sigleEntreprise,
  avecNomsLies, clientsPourSauvegarde, dossiersAilleurs,
} from "../src/gestion/js/partage-clients-calc.mjs";
import { hotelEtChambre, lieuParDefaut, controlesVoucher, empreinteVoucher, adresseEstHotel } from "../src/gestion/js/operations-calc.mjs";
import { aVerifier } from "../src/gestion/js/a-verifier-calc.mjs";

const source = (f) => fs.readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");
const PARTAGES = [{ source_id: "ztp", cible_id: "secret" }, { source_id: "ztp", cible_id: "taxi" }];
const CLIENTS = [
  { id: "z1", entite_id: "ztp", prenom: "Alex", nom: "Martin", telephone: "+41 79 000 00 01", adresse: "Rue du Lac 4\n1000 Lausanne" },
  { id: "z2", entite_id: "ztp", prenom: "Kim", nom: "Doe", telephone: "", email: "" },
  { id: "s1", entite_id: "secret", prenom: "Lee", nom: "Wong", telephone: "+66 80 000 0001", adresse: "Baiyok Hotel, Room 6" },
  { id: "t1", entite_id: "taxi", prenom: "", nom: "Brown", telephone: "+66 80 000 0002" },
];
const DOSSIERS = [
  { id: "dz", entite_id: "ztp", client_id: "z1", ref: "AM20261201 TH", date_depart: "2026-12-01", date_retour: "2026-12-20" },
  { id: "ds", entite_id: "secret", client_id: "z1", ref: "ST-2026-0042", date_depart: null },
  { id: "dt", entite_id: "taxi", client_id: "z1", ref: "VT-2026-0007", annule: true },
  { id: "ds2", entite_id: "secret", client_id: "s1", ref: "ST-2026-0043" },
];

test("sens unique : Secret et Taxi reçoivent les fiches de ZTP, ZTP ne reçoit rien", () => {
  assert.deepEqual([...sourcesDe(PARTAGES, "secret")], ["ztp"]);
  assert.deepEqual([...sourcesDe(PARTAGES, "taxi")], ["ztp"]);
  assert.deepEqual([...sourcesDe(PARTAGES, "ztp")], []);
  const tous = () => true;
  assert.deepEqual(clientsPartages({ clients: CLIENTS, partages: PARTAGES, entiteId: "ztp", permis: tous }), [], "ZTP ne trouve jamais une fiche de Secret ou de Taxi");
  assert.deepEqual(clientsPartages({ clients: CLIENTS, partages: PARTAGES, entiteId: "secret", permis: tous }).map((c) => c.id), ["z1", "z2"]);
  assert.deepEqual(clientsPartages({ clients: CLIENTS, partages: PARTAGES, entiteId: "taxi", permis: tous }).map((c) => c.id), ["z1", "z2"], "Taxi ne reçoit pas les fiches de Secret");
});

test("qui s'en sert : l'administration générale, ou une administratrice des deux entreprises ; jamais l'assistante", () => {
  const MOOK_SECRET = ["clients.lire", "clients.ecrire", "dossiers.lire", "dossiers.ecrire", "documents.ecrire", "finances.voir", "partenaires.lire", "fiduciaire.preparer"];
  assert.equal(peutUtiliserPartages({ superAdmin: true, permissionsSource: [], permissionsCible: ["dossiers.ecrire"] }), true);
  assert.equal(peutUtiliserPartages({ superAdmin: false, permissionsSource: [], permissionsCible: MOOK_SECRET }), false, "Mook n'a aucun droit dans ZTP");
  assert.equal(peutUtiliserPartages({ superAdmin: false, permissionsSource: ["clients.lire"], permissionsCible: MOOK_SECRET }), false, "lire ZTP ne suffit pas sans l'administration");
  assert.equal(peutUtiliserPartages({ superAdmin: false, permissionsSource: ["clients.lire", "reglages.ecrire"], permissionsCible: ["dossiers.ecrire", "reglages.ecrire"], voitToutSource: true }), true);
  assert.equal(peutUtiliserPartages({ superAdmin: false, permissionsSource: ["clients.lire", "reglages.ecrire"], permissionsCible: ["dossiers.ecrire", "reglages.ecrire"], voitToutSource: false }), false, "comme la base : une portée « ses dossiers » dans ZTP ne suffit pas");
  assert.equal(peutUtiliserPartages({ superAdmin: true, permissionsSource: [], permissionsCible: ["dossiers.lire"] }), false, "sans créer de dossier dans la cible, rien à choisir");
  const personne = clientsPartages({ clients: CLIENTS, partages: PARTAGES, entiteId: "secret", permis: () => false });
  assert.deepEqual(personne, []);
});

test("les fiches d'une entreprise : les siennes et celles que ses dossiers utilisent ; une fiche partagée non utilisée ne s'y compte pas", () => {
  const secret = clientsDeLEntreprise({ clients: CLIENTS, dossiers: DOSSIERS, entiteId: "secret" });
  assert.deepEqual(secret.map((c) => c.id).sort(), ["s1", "z1"]);
  const ztp = clientsDeLEntreprise({ clients: CLIENTS, dossiers: DOSSIERS, entiteId: "ztp" });
  assert.deepEqual(ztp.map((c) => c.id).sort(), ["z1", "z2"], "ZTP ne lit pas la fiche de Secret, même si un dossier Secret utilise une fiche ZTP");
  assert.equal(clientEtranger(secret.find((c) => c.id === "z1"), "secret"), true);
  assert.equal(clientEtranger(secret.find((c) => c.id === "s1"), "secret"), false);
  const proposes = clientsProposes(secret, clientsPartages({ clients: CLIENTS, partages: PARTAGES, entiteId: "secret", permis: () => true }));
  assert.deepEqual(proposes.map((c) => c.id).sort(), ["s1", "z1", "z2"], "sans doublon");
});

test("l'assistante : le nom seul du client ZTP de son dossier, jamais une fiche à choisir ni à sauvegarder", () => {
  const lus = CLIENTS.filter((c) => c.entite_id === "secret");
  const avec = avecNomsLies(lus, [{ id: "z1", entite_id: "ztp", civilite: null, prenom: "Alex", nom: "Martin" }, { id: "s1", entite_id: "secret", prenom: "X", nom: "Y" }]);
  const z1 = avec.find((c) => c.id === "z1");
  assert.equal(z1.nom_seul, true);
  assert.equal(z1.telephone, "", "ni WhatsApp");
  assert.equal(z1.adresse, "", "ni adresse");
  assert.equal(avec.find((c) => c.id === "s1").nom, "Wong", "une fiche lue en entier n'est pas remplacée par son nom seul");
  assert.deepEqual(clientsProposes(avec, []).map((c) => c.id), ["s1"], "le nom seul n'est jamais proposé au choix");
  assert.deepEqual(clientsPourSauvegarde(avec, "secret").map((c) => c.id), ["s1"]);
});

test("sauvegarde de Secret : ses propres fiches, jamais la fiche ZTP de ses dossiers", () => {
  const db = clientsDeLEntreprise({ clients: CLIENTS, dossiers: DOSSIERS, entiteId: "secret" });
  assert.deepEqual(clientsPourSauvegarde(db, "secret").map((c) => c.id), ["s1"]);
  assert.match(source("views/reglages.mjs"), /sauvegarde\.clients = pourSauvegarde\("clients", clientsPourSauvegarde\(etat\.db\.clients, etat\.entiteId\)\);/);
});

test("fiche ZTP : ses dossiers Secret et Taxi, sans aucun montant", () => {
  const resa = [
    { id: "r1", dossier_id: "ds", libelle: "4 Islands snorkeling", date_service: "2026-12-05", heure_pickup: "08:30", montant_vente: 1800, statut: "confirme" },
    { id: "r2", dossier_id: "ds", libelle: "Annulé", date_service: "2026-12-06", statut: "annule" },
    { id: "r3", dossier_id: "dt", libelle: "Airport transfer", date_service: "2026-12-02", montant_vente: 2500 },
  ];
  const entites = [{ id: "ztp", nom: "Zwald Travel Planner" }, { id: "secret", nom: "Secret Travel & Tour" }, { id: "taxi", nom: "VIP Taxi Lanta" }];
  const ailleurs = dossiersAilleurs({ clientId: "z1", entiteId: "ztp", dossiers: DOSSIERS.map((d) => ({ ...d, total: 9999, recu: 1, sur_place: 3 })), reservations: resa, entites });
  assert.deepEqual(ailleurs.map((x) => x.ref), ["ST-2026-0042", "VT-2026-0007"]);
  assert.equal(ailleurs[0].entreprise, "Secret Travel & Tour");
  assert.deepEqual(ailleurs[0].services.map((s) => s.libelle), ["4 Islands snorkeling"], "un service annulé ne s'affiche pas");
  assert.equal(ailleurs[1].annule, true);
  const texte = JSON.stringify(ailleurs);
  for (const k of ["total", "recu", "sur_place", "montant_vente", "net", "commission", "9999", "1800", "2500"]) assert.ok(!texte.includes(k), `aucun montant (${k})`);
  assert.deepEqual(dossiersAilleurs({ clientId: "z1", entiteId: "secret", dossiers: DOSSIERS.filter((d) => d.entite_id !== "ztp"), reservations: [], entites }).map((x) => x.ref), ["VT-2026-0007"]);
  assert.match(source("views/clients.mjs"), /dossiers\.length \|\| etat\.brut\.dossiers\.some\(\(d\) => d\.client_id === id\)/, "une fiche ZTP utilisée par Secret ne se supprime pas depuis ZTP");
});

test("sigle de l'entreprise : « ZTP », sans nom écrit dans le code", () => {
  assert.equal(sigleEntreprise("Zwald Travel Planner"), "ZTP");
  assert.equal(sigleEntreprise("Secret Travel & Tour"), "STT");
  assert.equal(sigleEntreprise("VIP Taxi Lanta"), "VTL");
  assert.equal(sigleEntreprise("Agence démo"), "AD");
  assert.equal(sigleEntreprise("ztp"), "ZTP");
  assert.equal(sigleEntreprise(""), "");
  for (const f of ["partage-clients-calc.mjs", "views/clients.mjs", "views/admin.mjs", "views/selecteur-client.mjs"]) {
    const code = source(f).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    assert.ok(!/Zwald|Secret Travel|VIP Taxi|"ztp"|'ztp'/.test(code), `${f} : aucun nom d'entreprise en dur`);
  }
});

test("une fiche ZTP a une adresse postale : jamais le lieu de pickup d'un service de Secret", () => {
  const ztp = CLIENTS[0];
  const secret = CLIENTS[2];
  assert.deepEqual(hotelEtChambre(ztp, { entite_id: "secret", lieu_pickup: "" }), { hotel: "", chambre: "" });
  assert.deepEqual(hotelEtChambre(ztp, { entite_id: "secret", lieu_pickup: "Pimalai Resort" }), { hotel: "Pimalai Resort", chambre: "" });
  assert.deepEqual(hotelEtChambre(secret, { entite_id: "secret", lieu_pickup: "" }), { hotel: "Baiyok Hotel", chambre: "6" }, "une fiche de Secret donne toujours son hôtel");
  assert.equal(lieuParDefaut([], ztp, "secret"), "");
  assert.equal(lieuParDefaut([], secret, "secret"), "Baiyok Hotel, Room 6");
  assert.equal(lieuParDefaut([{ lieu_pickup: "Lanta Sand", created_at: "1" }], ztp, "secret"), "Lanta Sand", "le lieu d'un autre service du dossier reste repris");
  const r = { entite_id: "secret", statut: "confirme", date_service: "2026-12-05", heure_pickup: "08:30", lieu_pickup: "" };
  assert.ok(controlesVoucher(r, ztp).includes("sans_lieu"));
  assert.ok(controlesVoucher(r, secret).includes("lieu_adresse_client"));
  assert.equal(adresseEstHotel(ztp, "secret"), false);
  assert.equal(adresseEstHotel(ztp, "ztp"), true);
  assert.equal(adresseEstHotel({ adresse: "x" }, "secret"), true, "une fiche sans entreprise connue garde son adresse (comme avant)");
  assert.match(source("views/clients.mjs"), /"adresse" in changes && !etrangere\) await suivreAdresse/, "corriger l'adresse postale ne touche pas aux lieux de pickup");
});

test("empreinte du voucher : la même pour l'administration et l'assistante, insensible à l'adresse postale ZTP", () => {
  const r = { id: "r1", entite_id: "secret", libelle: "4 Islands", date_service: "2026-12-05", heure_pickup: "08:30", lieu_pickup: "Pimalai" };
  const admin = empreinteVoucher({ reservation: r, client: CLIENTS[0] });
  const mook = empreinteVoucher({ reservation: r, client: avecNomsLies([], [{ id: "z1", entite_id: "ztp", prenom: "Alex", nom: "Martin" }])[0] });
  assert.equal(admin, mook);
  assert.equal(empreinteVoucher({ reservation: r, client: { ...CLIENTS[0], adresse: "Autre rue 1", telephone: "+41 79 111 11 11" } }), admin, "changer l'adresse ou le WhatsApp dans ZTP ne marque pas le voucher à renvoyer");
  assert.notEqual(empreinteVoucher({ reservation: r, client: { ...CLIENTS[0], nom: "Martin-Dupont" } }), admin, "le nom, imprimé, compte toujours");
  const s1 = CLIENTS[2];
  assert.notEqual(empreinteVoucher({ reservation: r, client: s1 }), empreinteVoucher({ reservation: r, client: { ...s1, telephone: "+66 1" } }), "une fiche de Secret garde son empreinte complète");
});

test("À vérifier dans Secret : ni la fiche ZTP de ses dossiers, ni le nom seul de l'assistante", () => {
  const db = { clients: [...clientsDeLEntreprise({ clients: CLIENTS, dossiers: DOSSIERS, entiteId: "secret" }), { id: "z9", entite_id: "ztp", nom: "Seul", nom_seul: true }, { id: "s9", entite_id: "secret", prenom: "Lee", nom: "Wong", telephone: "+66 80 000 0001" }], dossiers: DOSSIERS.filter((d) => d.entite_id === "secret") };
  const ctrl = aVerifier(db, { droits: { clients: true, dossiers: true }, aujourdhui: "2026-11-18", entiteId: "secret" });
  const lignes = (cle) => ((ctrl.find((c) => c.cle === cle) || {}).elements || []).map((l) => l.id);
  assert.deepEqual(lignes("clients_sans_contact"), [], "la fiche ZTP sans e-mail et le nom seul ne sont pas des clients de Secret à compléter");
  assert.equal(lignes("clients_en_double").length, 1, "les doublons de Secret restent signalés");
  const sansEntite = aVerifier(db, { droits: { clients: true }, aujourdhui: "2026-11-18" });
  assert.ok(!((sansEntite.find((c) => c.cle === "clients_sans_contact") || {}).elements || []).some((l) => l.id === "z9"), "un nom seul n'est jamais un client à compléter");
});

test("écrans : recherche, choix du client, collages et demandes proposent les fiches partagées, étiquetées", () => {
  const etat = source("etat.mjs");
  assert.match(etat, /db\.clients = clientsDeLEntreprise\(\{ clients: etat\.brut\.clients \|\| \[\], dossiers: db\.dossiers, entiteId: e \}\);/);
  assert.match(etat, /return clientsProposes\(\)\n\s+\.map/, "la recherche de clients (choix du client) cherche aussi dans les fiches partagées");
  assert.match(source("app.mjs"), /clientsProposes\(\)\n\s+\.filter\(\(c\) => correspond/, "recherche globale");
  assert.match(source("app.mjs"), /droite: etiquetteClient\(c\)/);
  assert.match(source("views/selecteur-client.mjs"), /nomClient\(c\), etiquette\(c\)/);
  // Coller une confirmation (18.11.2026, après cette PR) : une fiche ZTP est choisie d'office sur le même WhatsApp seulement ; au même nom,
  // elle est proposée sans présélection (un homonyme ne reçoit jamais la course d'office). Détail : gestion-coller-confirmation.test.js.
  assert.match(source("views/confirmation.mjs"), /partages: clientsPartages\(id\)/);
  assert.match(source("views/confirmation.mjs"), /candidats\.parNom\.map\(\(c\) => ligneClient\(c, id, false\)\)/);
  assert.match(source("views/demande.mjs"), /clientsProches\(d, clientsProposes\(\)\)/, "demande collée et demandes du site");
  assert.match(source("views/nouveau-excursions.mjs"), /clientsProposes\(\)\)\[0\]/);
  assert.match(source("views/creation-course.mjs"), /!clientEtranger\(c\) && nomARemplacer\(\[c\.prenom, c\.nom\]/, "une confirmation ne réécrit pas le nom d'une fiche ZTP");
});

test("démo : l'administratrice utilise une fiche de l'agence dans Excursions ; l'assistante voit le nom seul et ne peut rien relier", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  globalThis.location = { origin: "http://localhost", pathname: "/gestion/", search: "?demo", hash: "" };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?partage=${Date.now()}`);
    const store = creer();
    const admin = store.utilisateursDemo()[0];
    const mook = store.utilisateursDemo().find((u) => /vouchers et factures/.test(u.nom));
    let d = await store.charger();
    const agence = d.entites.find((e) => e.slug === "agence");
    const excursions = d.entites.find((e) => e.slug === "excursions");
    const taxi = d.entites.find((e) => e.slug === "taxi");
    assert.deepEqual(d.partages_clients.map((p) => `${p.source_id === agence.id ? "agence" : "?"}>${p.cible_id === excursions.id ? "excursions" : p.cible_id === taxi.id ? "taxi" : "?"}`).sort(), ["agence>excursions", "agence>taxi"]);
    const fiche = d.clients.find((c) => c.entite_id === agence.id);
    const dossier = await store.inserer("dossiers", { entite_id: excursions.id, ref: "EX-PARTAGE", client_id: fiche.id, annule: false });
    assert.equal(dossier.entite_id, excursions.id, "le dossier reste un dossier d'Excursions");
    const ficheExcursions = d.clients.find((c) => c.entite_id === excursions.id);
    await assert.rejects(store.inserer("dossiers", { entite_id: agence.id, ref: "AG-INVERSE", client_id: ficheExcursions.id }), /ne partage pas/, "sens unique");

    store.changerUtilisateurDemo(mook.id);
    d = await store.charger();
    assert.ok(!d.clients.some((c) => c.entite_id === agence.id && !c.nom_seul), "l'assistante ne lit aucune fiche de l'agence");
    const lie = d.clients.find((c) => c.id === fiche.id);
    assert.ok(lie && lie.nom_seul && lie.nom === fiche.nom && lie.telephone === "" && lie.adresse === "", "elle a le nom du client de son dossier, rien d'autre");
    assert.ok(d.dossiers.some((x) => x.id === dossier.id), "elle ouvre le dossier");
    await assert.rejects(store.inserer("dossiers", { entite_id: excursions.id, ref: "EX-MOOK", client_id: fiche.id }), /administration/);
    await store.modifier("dossiers", dossier.id, { notes: "Pick-up 9:00", client_id: fiche.id });
    await assert.rejects(store.partagerClients(excursions.id, agence.id, true), /administration générale/);

    store.changerUtilisateurDemo(admin.id);
    const doublon = await store.inserer("clients", { entite_id: excursions.id, prenom: fiche.prenom, nom: fiche.nom, telephone: "" });
    await store.inserer("dossiers", { entite_id: excursions.id, ref: "EX-DOUBLON", client_id: doublon.id });
    await assert.rejects(store.fusionnerClients({ garder: doublon.id, absorbe: fiche.id }), /même entreprise/, "une fiche de l'agence ne disparaît jamais dans Excursions");
    await store.fusionnerClients({ garder: fiche.id, absorbe: doublon.id });
    d = await store.charger();
    assert.ok(!d.clients.some((c) => c.id === doublon.id), "la fiche en double a disparu");
    const repris = d.dossiers.find((x) => x.ref === "EX-DOUBLON");
    assert.equal(repris.client_id, fiche.id);
    assert.equal(repris.entite_id, excursions.id);
    await assert.rejects(store.modifier("clients", fiche.id, { entite_id: excursions.id }), /ne change pas d'entreprise/);
    await store.partagerClients(agence.id, taxi.id, false);
    d = await store.charger();
    assert.equal(d.partages_clients.length, 1);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.location;
  }
});

test("administration : le réglage « partage ses clients avec », réservé à l'administration générale", () => {
  const admin = source("views/admin.mjs");
  assert.match(admin, /entites\.length > 1 \? blocPartageClients\(entites\) : null/);
  assert.match(admin, /export function vueAdmin\(\) \{\n  if \(!estSuperAdmin\(\)\) return vide/);
  assert.match(source("store-supabase.mjs"), /from\("partages_clients"\)\.upsert\(\{ source_id: sourceId, cible_id: cibleId \}/);
});

test("migration 46 : clé sur l'identifiant, déclencheur, nom seul, retour en arrière, contrôle dans la CI", () => {
  const sql = fs.readFileSync(new URL("../docs/gestion/migration-46-partage-clients.sql", import.meta.url), "utf8");
  assert.match(sql, /add constraint dossiers_client_fkey foreign key \(client_id\) references clients \(id\) on delete restrict/);
  assert.match(sql, /create trigger controler_client_dossier before insert or update of client_id, entite_id on dossiers/);
  assert.match(sql, /returns table \(id uuid, entite_id uuid, civilite text, prenom text, nom text\)/, "clients_lies ne rend que le nom");
  assert.match(sql, /revoke all on function clients_lies\(\) from public, anon;/);
  assert.ok(!/drop policy if exists "lire les clients"/.test(sql), "la lecture des fiches ne change pas");
  const retour = fs.readFileSync(new URL("../docs/gestion/retour-46-partage-clients.sql", import.meta.url), "utf8");
  assert.match(retour, /foreign key \(client_id, entite_id\) references clients \(id, entite_id\)/);
  assert.ok(!fs.readdirSync(new URL("../docs/gestion/", import.meta.url)).some((f) => /^migration-\d+-.*retour/.test(f)), "le retour n'est pas pris pour une migration par les contrôles");
  assert.match(fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"), /verif-partage-clients/);
});

test("Modifier le dossier : « Modifier la fiche client » sur place, mêmes droits que la fiche, fiche ZTP signalée (Jérémy, 18.11.2026)", () => {
  const dossier = source("views/dossier.mjs");
  const clients = source("views/clients.mjs");
  // Le bouton suit le client choisi et ouvre la fiche par-dessus la fenêtre du dossier : la saisie du dossier reste.
  assert.match(dossier, /selecteurClient\(\{ id: "m-client", valeur: d\.client_id, surChangement: \(\) => majFiche\(\) \}\)/);
  assert.match(dossier, /ouvrirFicheClientModal\(c, \(maj\) => \{\n\s+ficheModifiee = true;\n\s+selClient\.choisirId\(maj\.id \|\| c\.id\);/);
  assert.match(dossier, /selClient\.noeud,\n\s+blocFiche,/);
  assert.match(dossier, /blocFiche\.hidden = !peutModifierFiche\(c\);/);
  assert.match(dossier, /sigleFiche\.textContent = s \? tr\("fiche \{sigle\}", \{ sigle: s \}\) : "";/, "« fiche ZTP » à côté d'une fiche partagée");
  assert.match(dossier, /\{ ferme: \(\) => ficheModifiee && rafraichir\(\) \}/, "le dossier affiché suit la fiche corrigée, même si on annule la fenêtre du dossier");
  // Mêmes droits que la fiche client ; une fiche ZTP : l'administration qui l'utilise ; jamais le nom seul de l'assistante.
  assert.match(clients, /export const peutModifierFiche = \(c\) => !!c && !c\.nom_seul && \(clientEtranger\(c\) \? partageClientsPermis\(c\.entite_id\) : peut\("clients\.ecrire"\)\);/);
  assert.match(clients, /export function ouvrirFicheClientModal\(client, apres = \(\) => \{\}\) \{\n\s+if \(!peutModifierFiche\(client\)\) return;/);
  assert.match(clients, /formulaireClient\(client, \(c\) => \{\n\s+fermer\(\);\n\s+apres\(c\);/, "le même formulaire que la fiche : nom, prénom, WhatsApp, e-mail, adresse ou hôtel et chambre, notes");
});
