// « Voir le message du client » (Jérémy, 19.11.2026) : après la confirmation, le message envoyé par le formulaire du site restait introuvable.
// Il se relit maintenant depuis chaque carte des Demandes du site et depuis la fiche du dossier créé par la demande, tel quel, en lecture seule.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { messageClient, demandesDuDossier } from "../src/gestion/js/demandes-site-calc.mjs";
import { EN as FR_EN } from "../src/gestion/js/i18n-en.mjs";

const lire = (chemin) => fs.readFileSync(new URL(`../src/gestion/${chemin}`, import.meta.url), "utf8");

// Un message du site (format de booking.js), nom et numéro fictifs.
const MESSAGE = "Transfer request: Koh Lanta to Krabi Airport\nDate: Fri 20 Nov 2026\nPickup time: 18:00\nGuests: 2 adults\nBags: 2\nPickup: Lanta Riviera Beach Resort\nDrop-off: Krabi Airport (KBV)\nPrice on the site: From 2,300 THB per vehicle\nName: Client Essai";

test("messageClient : le message tel qu'envoyé, sans les changements d'Anaïs ni reconstruction", () => {
  const d = { message: MESSAGE, adultes: 3, heure: "19:00", decision: { changements: [{ champ: "heure" }] } };
  assert.equal(messageClient(d), MESSAGE);
  // Ancien site, message non gardé : rien d'inventé.
  assert.equal(messageClient({ message: null, produit: "4 Islands" }), "");
  assert.equal(messageClient({}), "");
  assert.equal(messageClient(null), "");
});

test("demandesDuDossier : les demandes qui ont créé le dossier, la plus récente en premier", () => {
  const demandes = [
    { id: "a", dossier_id: "d1", created_at: "2026-11-18T12:32:30Z" },
    { id: "b", dossier_id: "d2", created_at: "2026-11-18T13:00:00Z" },
    { id: "c", dossier_id: "d1", created_at: "2026-11-19T08:00:00Z" },
    { id: "e", dossier_id: null, created_at: "2026-11-19T09:00:00Z" },
  ];
  assert.deepEqual(demandesDuDossier(demandes, "d1").map((x) => x.id), ["c", "a"]);
  assert.deepEqual(demandesDuDossier(demandes, "d3"), []);
  assert.deepEqual(demandesDuDossier(demandes, null), [], "un dossier sans identifiant ne ramasse pas les demandes sans dossier");
  assert.deepEqual(demandesDuDossier(undefined, "d1"), []);
});

test("carte des Demandes du site : le bouton est sur chaque carte, quel que soit son statut ou le droit d'écrire", () => {
  const vue = lire("js/views/demandes-site.mjs");
  const carte = vue.slice(vue.indexOf("function carte(d"), vue.indexOf("// ---- Chiffres"));
  const i = carte.indexOf("boutonMessageClient(d)");
  assert.ok(i > 0, "bouton absent de la carte");
  // Hors des branches « à traiter et droit d'écrire » et « confirmée ou refusée ».
  assert.ok(i < carte.indexOf('d.statut === "nouvelle" && ecrit'), "le bouton ne dépend ni du statut ni du droit d'écrire");
});

test("fenêtre en lecture seule : le message dans un bloc non modifiable, Copier, la date de réception, le WhatsApp et la page d'origine", () => {
  const m = lire("js/views/message-client.mjs");
  assert.match(m, /h\("pre", \{ class: "dsite-message-texte", lang: "en"/);
  assert.doesNotMatch(m, /textarea|input|modifier\(|inserer\(/, "rien ne se modifie ni ne s'enregistre");
  assert.match(m, /copierTexte\(texte\)/);
  for (const libelle of ["Reçue le", "WhatsApp", "Page d'origine", "Réf. WhatsApp", "Copier", "Fermer", "Voir le message du client", "Message du client"]) {
    assert.ok(m.includes(`tr("${libelle}")`), libelle);
    assert.ok(FR_EN[libelle], `traduction anglaise de « ${libelle} »`);
  }
  assert.match(m, /rel: "noopener"/);
});

test("fiche du dossier : « Demande du site du {date} » et le bouton, seulement avec le module et les demandes chargées (mêmes droits)", () => {
  const v = lire("js/views/dossier.mjs");
  const bloc = v.slice(v.indexOf("function blocDemandesSite(d)"), v.indexOf("function ficheDossierVue"));
  assert.match(bloc, /moduleActif\("demandes_site"\)/);
  assert.match(bloc, /demandesDuDossier\(etat\.db\.demandes_site, d\.id\)/);
  assert.match(bloc, /tr\("Demande du site du \{date\}"/);
  assert.match(bloc, /boutonMessageClient\(x\)/);
  assert.match(v, /blocDemandesSite\(d\),\n\s+resume,/);
  assert.ok(FR_EN["Demande du site du {date}"]);
  // La fiche ne charge pas tout l'écran des demandes.
  assert.doesNotMatch(v, /from "\.\/demandes-site\.mjs"/);
});
