// Contacts WhatsApp typés et apporteurs d'affaires (migration 68, décisions de Jérémy du 21.11.2026 ; aucune rémunération : personne n'est
// payé en commission aujourd'hui). La base est vérifiée par docs/gestion/verif-contacts-apporteurs.mjs ; ici la logique pure, la démo (qui
// refuse comme la base), l'IA du tri et l'absence de l'apporteur sur les documents du client.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const A = await import("../src/gestion/js/apporteurs-calc.mjs");
test("type du contact : le type ne touche plus les réponses, seul « Personnel » ferme l'IA (migration 69)", () => {
  assert.equal(A.typeContact({ reponses: "jamais", type_contact: null }), "personnel");
  assert.equal(A.typeContact({ reponses: "jamais", type_contact: "chauffeur" }), "chauffeur", "un type existe avec « jamais »");
  assert.equal(A.typeContact({ reponses: "auto", type_contact: "apporteur" }), "apporteur");
  assert.equal(A.typeContact({ reponses: "auto", type_contact: null }), null);
  assert.equal(A.typeContact({ reponses: "auto", type_contact: "ami" }), null, "une valeur inconnue ne s'affiche pas");
  // Tout type stocké : seulement type_contact, jamais `reponses` (l'IA lit partenaire, chauffeur, hôtel et apporteur comme un client).
  const ouvert = { reponses: "auto", type_contact: null };
  for (const t of ["client", "apporteur", "partenaire", "chauffeur", "hotel"]) {
    assert.deepEqual(A.patchType(t), { type_contact: t }, t);
    assert.deepEqual(A.patchType(t, ouvert), { type_contact: t }, `${t} sur un contact ouvert`);
    assert.deepEqual(A.patchType(t, { reponses: "auto", type_contact: "client" }), { type_contact: t }, `${t} depuis un autre type`);
    assert.equal(A.toastType(t, ouvert), "Contact noté : l'assistant peut lire", t);
  }
  // Personnel : rien envoyé à l'IA, pas de type. Le quitter pour un type rouvre (c'est cette puce qui avait fermé).
  assert.deepEqual(A.patchType("personnel"), { reponses: "jamais", type_contact: null });
  assert.deepEqual(A.patchType("personnel", { reponses: "auto", type_contact: "partenaire" }), { reponses: "jamais", type_contact: null });
  assert.equal(A.toastType("personnel", ouvert), "Contact noté : rien envoyé à l'IA");
  const personnel = { reponses: "jamais", type_contact: null };
  assert.deepEqual(A.patchType("partenaire", personnel), { type_contact: "partenaire", reponses: "auto" });
  assert.equal(A.toastType("chauffeur", personnel), "Contact noté : l'assistant peut lire");
  // Un contact typé que Nani a réglé « rien envoyé à l'IA » dans le menu « … » : retyper ne le rouvre pas, le toast le dit.
  const fermeTyped = { reponses: "jamais", type_contact: "hotel" };
  assert.deepEqual(A.patchType("partenaire", fermeTyped), { type_contact: "partenaire" });
  assert.equal(A.toastType("partenaire", fermeTyped), "Contact noté : rien envoyé à l'IA");
  assert.throws(() => A.patchType("ami"));
  // L'écran passe la conversation à patchType et au toast.
  const vue = source("src/gestion/js/views/whatsapp.mjs");
  assert.match(vue, /modifier\("whatsapp_conversations", c\.id, patchType\(t, c\)\)/);
  assert.match(vue, /toast\(tr\(toastType\(t, c\)\)\)/);
  assert.deepEqual(A.TYPES_CONTACT.map(([k]) => k), ["client", "apporteur", "partenaire", "chauffeur", "hotel", "personnel"]);
  const sql = source("docs/gestion/migration-68-contacts-apporteurs.sql");
  assert.doesNotMatch(sql, /add constraint whatsapp_conversations_personnel_check/, "aucune contrainte ne lie le type aux réponses");
  assert.doesNotMatch(sql.slice(sql.indexOf("create or replace function whatsapp_type_coherent")), /new\.reponses :=/, "le déclencheur ne rouvre jamais l'IA");
});

test("aucune fiche ne coupe l'IA : ni un apporteur ni un prestataire (migration 69)", async () => {
  const P = await import("../supabase/functions/whatsapp/proposer.js");
  assert.equal(P.numerosPartenaires, undefined, "plus de liste de numéros à écarter");
  const question = [{ type: "text", texte: "Two clients for a snorkelling day on Friday?", envoye_le: "2026-11-21T08:00:00Z" }];
  // 22.11.2026 : plus de tri automatique pour un contact typé non client (l'Assistant reste à la demande) ; un contact non typé est trié.
  for (const type_contact of ["apporteur", "partenaire"]) assert.equal(P.triSansAppel({ conv: { reponses: "auto", telephone: "+447700900611", type_contact }, messages: question }).motif, "non_client", `${type_contact} : pas de tri automatique`);
  assert.equal(P.triSansAppel({ conv: { reponses: "auto", telephone: "+447700900611", type_contact: null }, messages: question }), null, "non typé : le tri par Haiku a lieu");
  // Plus aucune lecture des fiches partenaires pour le tri ni pour le suivi.
  assert.doesNotMatch(source("supabase/functions/whatsapp/reponse.ts"), /partenairesDe|from\("partenaires"\)\.select\("contact, categorie"\)/);
  assert.doesNotMatch(source("supabase/functions/whatsapp/suivi.ts"), /partenairesDe/);
});

test("fiches apporteur hors des listes de prestataires et du chauffeur Taxi", async () => {
  const V = await import("../src/gestion/js/voucher-rapide-calc.mjs");
  const brown = { id: "b", nom: "Mr. Brown", actif: true, categorie: "Transferts" };
  const jade = { id: "j", nom: "Jade", actif: true, categorie: "apporteur" };
  assert.equal(V.partenaireDeTaxi([jade, brown], null).id, "b", "l'apporteur n'est jamais le chauffeur");
  assert.equal(V.partenaireDeTaxi([jade, brown], "j").id, "b", "même choisi");
  assert.equal(V.chauffeurAChoisir([jade, brown], null), false, "pas d'alerte « Plusieurs partenaires actifs » à cause d'un apporteur");
  assert.deepEqual(A.prestataires([jade, brown]).map((p) => p.id), ["b"]);
  for (const f of ["views/reservations.mjs", "views/choix-prestation.mjs", "views/reglages-vouchers.mjs", "views/partenaires.mjs"]) assert.match(source(`src/gestion/js/${f}`), /prestataires\(etat\.db\.partenaires\)/, f);
});

test("journal : l'apporteur d'un dossier s'affiche par le nom de sa fiche", async () => {
  const { valeurJournal } = await import("../src/gestion/js/journal-calc.mjs");
  assert.equal(valeurJournal("apporteur_id", "p1", { partenaires: [{ id: "p1", nom: "Jade" }] }), "Jade");
  assert.equal(valeurJournal("apporteur_id", "p2", { partenaires: [] }), "(supprimé)");
});

test("statistiques : clients envoyés par apporteur, nombres et chiffre d'affaires", () => {
  const rows = [
    { id: "d1", dossier_id: "d1", montant: 3000, src: { client_id: "c1" } },
    { id: "d2", dossier_id: "d2", montant: 1500, src: { client_id: "c2" } },
    { id: "d3", dossier_id: "d3", montant: 900, src: { client_id: "c2" } },
    { id: "d4", dossier_id: "d4", montant: 700, src: { client_id: "c3" } },
  ];
  const de = new Map([["d1", "jade"], ["d2", "jade"], ["d3", "jade"]]);
  const r = A.parApporteur(rows, (id) => de.get(id));
  assert.deepEqual(r.groupes, [{ id: "jade", dossiers: 3, clients: 2, montant: 5400 }]);
  assert.deepEqual(r.sans, { dossiers: 1, montant: 700 });
  // Sans le droit « nets », la colonne d'argent n'existe pas.
  const vue = source("src/gestion/js/views/analyses-sections.mjs");
  assert.match(vue, /\.\.\.\(A\.argent \? \[\{ cle: "montant", titre: N_\("Chiffre d'affaires"\)/);
  assert.match(source("src/gestion/js/views/analyses.mjs"), /argent: peut\("partenaires\.nets"\)/);
});

test("migration 68 : en-tête, droits, classement protégé étendu, contrôle et restauration du dossier, aucune rémunération", () => {
  const sql = source("docs/gestion/migration-68-contacts-apporteurs.sql");
  assert.match(sql, /Suit la 67 \(PR 295\)/);
  assert.match(sql, /Ne modifie aucune donnée existante\. Se rejoue sans effet\./);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /grant update \(type_contact, partenaire_id\) on whatsapp_conversations to authenticated;/);
  assert.match(sql, /if old\.type_contact is not null or old\.reponses = 'jamais' then new\.type_contact := old\.type_contact; end if;/);
  assert.match(sql, /create trigger controler_apporteur_dossier before insert or update of apporteur_id, entite_id on dossiers/);
  assert.match(sql, /p\.entite_id <> new\.entite_id or p\.categorie <> 'apporteur'/);
  assert.match(sql, /restauration := exists \(select 1 from corbeille where table_name = 'dossiers' and ligne->>'id' = new\.id::text and ligne->>'apporteur_id' = new\.apporteur_id::text\)/);
  assert.doesNotMatch(sql, /remuneration|apporteurs_reverse/, "ni rémunération ni commission reversée");
  assert.ok(fs.existsSync(new URL("../docs/gestion/retour-68-contacts-apporteurs.sql", import.meta.url)));
  assert.match(source(".github/workflows/ci.yml"), /verif-contacts-apporteurs/);
});

test("import d'une sauvegarde : partenaires avant dossiers (apporteur_id), sans casser les autres clés", () => {
  const sb = source("src/gestion/js/store-supabase.mjs");
  const ordre = JSON.parse(sb.match(/const TABLES = (\[[^\]]+\]);/)[1]);
  const avant = (a, b) => ordre.indexOf(a) < ordre.indexOf(b);
  assert.ok(avant("partenaires", "dossiers") && avant("partenaires_prives", "dossiers"), "apporteur_id");
  assert.ok(avant("partenaires", "partenaires_prives") && avant("clients", "dossiers") && avant("dossiers", "documents") && avant("dossiers", "reservations") && avant("partenaires", "prestations") && avant("prestations", "reservations") && avant("trajets", "reservations") && ordre.at(-1) === "taches");
});

test("jamais d'apporteur sur un document du client (facture, voucher, Booking confirmation, message)", () => {
  const gabarits = ["document.mjs", "textes-voucher.mjs", "confirmation.mjs", "confirmation-calc.mjs", "views/voucher.mjs", "views/voucher-secret.mjs", "views/voucher-taxi.mjs", "views/voucher-envoi.mjs", "views/document-envoi.mjs", "views/message-client.mjs", "views/messages.mjs", "views/confirmation.mjs", "views/fiduciaire-pdf.mjs", "pdf-simple.mjs", "envoi-voucher-calc.mjs", "fiduciaire-textes.mjs"];
  for (const f of gabarits) {
    const chemin = `src/gestion/js/${f}`;
    if (!fs.existsSync(new URL(`../${chemin}`, import.meta.url))) continue;
    assert.doesNotMatch(source(chemin), /apporteur|remuneration/i, f);
  }
});

test("démo : Jade, travel planner de Secret, sans rémunération, deux dossiers et sa conversation typée", async () => {
  const stockage = new Map();
  globalThis.localStorage = { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) };
  globalThis.location = { origin: "http://localhost", pathname: "/gestion/", search: "?demo", hash: "" };
  try {
    const { creer } = await import(`../src/gestion/js/store-local.mjs?apporteurs=${Date.now()}`);
    const store = creer();
    let d = await store.charger();
    assert.equal(d.apporteurs_disponible, true);
    assert.equal(d.whatsapp_contacts_disponible, true);
    const secret = d.entites.find((e) => e.slug === "excursions");
    const taxi = d.entites.find((e) => e.slug === "taxi");
    const jade = d.partenaires.find((p) => p.nom === "Jade" && p.entite_id === secret.id);
    assert.ok(jade && A.estApporteur(jade) && jade.role === "Travel planner");
    assert.equal(d.partenaires_prives.find((x) => x.partenaire_id === jade.id), undefined, "aucune donnée privée");
    const envoyes = d.dossiers.filter((x) => x.apporteur_id === jade.id);
    assert.equal(envoyes.length, 2, "deux dossiers envoyés par Jade");
    const conv = d.whatsapp_conversations.find((c) => c.partenaire_id === jade.id);
    assert.ok(conv && A.typeContact(conv) === "apporteur" && conv.reponses === "auto" && conv.entite_id === secret.id);

    // Migration 69 : typer « chauffeur » ne ferme plus l'IA. Le réglage des réponses se change à part, le type reste ; retyper ne le touche pas.
    let c = await store.modifier("whatsapp_conversations", conv.id, A.patchType("chauffeur", conv));
    assert.deepEqual([c.type_contact, c.reponses], ["chauffeur", "auto"]);
    c = await store.modifier("whatsapp_conversations", conv.id, { reponses: "jamais" });
    assert.equal(c.type_contact, "chauffeur");
    c = await store.modifier("whatsapp_conversations", conv.id, A.patchType("apporteur", c));
    assert.deepEqual([c.type_contact, c.reponses], ["apporteur", "jamais"], "un contact réglé « rien envoyé à l'IA » le reste");
    c = await store.modifier("whatsapp_conversations", conv.id, A.patchType("personnel", c));
    assert.deepEqual([c.type_contact, c.reponses], [null, "jamais"]);
    c = await store.modifier("whatsapp_conversations", conv.id, A.patchType("apporteur", c));
    assert.deepEqual([c.type_contact, c.reponses], ["apporteur", "auto"], "quitter « Personnel » rouvre");
    await assert.rejects(store.modifier("whatsapp_conversations", conv.id, { type_contact: "ami" }));
    // Une fiche de Taxi ne se relie pas à une conversation de Secret.
    const fTaxi = await store.inserer("partenaires", { entite_id: taxi.id, nom: "Jade", categorie: "apporteur", contact: {}, regles: {}, contrat: {}, actif: true });
    await assert.rejects(store.modifier("whatsapp_conversations", conv.id, { partenaire_id: fTaxi.id }), /introuvable/);

    // Un apporteur d'une autre entreprise est refusé sur un dossier ; un partenaire qui n'est pas apporteur aussi.
    await assert.rejects(store.modifier("dossiers", envoyes[0].id, { apporteur_id: fTaxi.id }), /Apporteur introuvable/);
    const bateau = d.partenaires.find((p) => p.entite_id === secret.id && !A.estApporteur(p));
    await assert.rejects(store.modifier("dossiers", envoyes[0].id, { apporteur_id: bateau.id }), /Apporteur introuvable/);

    // Supprimer la fiche : les dossiers et la conversation la perdent.
    await store.supprimer("partenaires", jade.id);
    d = await store.charger();
    assert.equal(d.dossiers.filter((x) => x.apporteur_id === jade.id).length, 0);
    assert.equal(d.whatsapp_conversations.find((x) => x.id === conv.id).partenaire_id, null);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.location;
  }
});

test("écrans : type d'un tap dans WhatsApp, apporteur sur le dossier sans l'effacer, aucune rémunération affichée", async () => {
  const wa = source("src/gestion/js/views/whatsapp.mjs");
  assert.match(wa, /h\("div", \{ class: "wa-fil-infos" \}, selecteurEntreprise\(c, prop\), selecteurType\(c\)\)/);
  const dossier = source("src/gestion/js/views/dossier.mjs");
  assert.match(dossier, /\.\.\.patchApporteur\(apporteur, d\)/);
  assert.match(dossier, /blocResumeApporteur\(d\)/);
  assert.doesNotMatch(source("src/gestion/js/views/du.mjs"), /apporteur/i, "plus de liste « À reverser »");
  for (const f of ["views/apporteurs.mjs", "apporteurs-calc.mjs", "store-local.mjs", "store-supabase.mjs"]) assert.doesNotMatch(source(`src/gestion/js/${f}`), /remuneration|apporteurs_reverse|reverser/i, f);
  // Enregistrer le dossier n'envoie apporteur_id que s'il a changé : une personne qui ne voit pas les partenaires ne l'efface pas.
  const { patchApporteur } = await import("../src/gestion/js/views/apporteurs.mjs").catch(() => ({}));
  if (patchApporteur) {
    assert.deepEqual(patchApporteur({ valeur: () => "p1" }, { apporteur_id: "p1" }), {});
    assert.deepEqual(patchApporteur({ valeur: () => null }, { apporteur_id: "p1" }), { apporteur_id: null });
    assert.deepEqual(patchApporteur(null, { apporteur_id: "p1" }), {});
  } else assert.match(source("src/gestion/js/views/apporteurs.mjs"), /champApp\.valeur\(\) !== \(d\.apporteur_id \|\| null\)/);
  assert.match(source("src/gestion/js/views/apporteurs.mjs"), /tr\("Apporteur actuel"\)/);
  const sb = source("src/gestion/js/store-supabase.mjs");
  assert.match(sb, /const CONTACTS = "type_contact, partenaire_id";/);
  assert.match(sb, /whatsapp_contacts_disponible: conversations !== null && contactsDisponible/);
});
