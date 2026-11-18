// Migration 43 : chaque règle de partenaire écrite d'après un nom (Bundhaya, Satun, Saladan, « taxi », Langkawi) est devenue une donnée.
// Ce test garde le code d'avant (recopié tel quel de master au 18.11.2026) et prouve, règle par règle, que les partenaires d'Anaïs tels que
// la migration les laisse donnent exactement le même résultat qu'avant. Puis qu'un nom seul ne déclenche plus rien.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { consigneCheckin, consigneCheckinFiche, notePasseport, alerteAvantVeille, estTarifZone, destinationPasseport } from "../src/gestion/js/operations-calc.mjs";
import { partenaireDeTaxi } from "../src/gestion/js/voucher-rapide-calc.mjs";
import { varsReponse, reponsePrix } from "../src/gestion/js/demande-calc.mjs";
import { aPrevoir } from "../src/gestion/js/rappel-h1-calc.mjs";
import { libelleClient, reglerCompagnies } from "../src/gestion/js/partenaires-calc.mjs";
import { ajouterJours } from "../src/gestion/js/calc.mjs";
import { DESTINATION_PASSEPORT_DEMO, COMPAGNIES_DEMO, REGLES_PARTENAIRE_NEUTRES, donneesDemo, completerReglages } from "../src/gestion/js/defauts.mjs";
import { BUNDHAYA, SATUN, NAN, VIP, RATTANA, SANS_REGLE, PARTENAIRES, DESTINATIONS, COMPAGNIES } from "./fixtures/regles-partenaires-anais.mjs";

// ---- Le code d'avant, recopié de master (operations-calc.mjs, voucher-rapide-calc.mjs, demande-calc.mjs, views/voucher.mjs) ----------
const sansAccentsMin = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const avant = {
  consigneCheckin(nomCompagnie, trajet = {}) {
    const c = sansAccentsMin(nomCompagnie);
    const langkawi = /langkawi/i.test(`${trajet.de || ""} ${trajet.vers || ""}`);
    if (langkawi) return c.includes("bundhaya") ? "Check-in 90 minutes before departure, counter closes 45 minutes before. Passport of each passenger required (immigration), kept by the captain during the crossing." : "Check-in 90 minutes before departure for immigration formalities. Passport of each passenger required.";
    if (c.includes("bundhaya")) return "Check-in at the pier 45 minutes before departure, counter closes 15 minutes before. Please bring this voucher and your passport or ID.";
    if (c.includes("satun")) return "Please present this voucher at the counter 30 minutes before departure, counter closes 20 minutes before. Passport or ID required.";
    return "Please arrive at the pier 30 minutes before departure with this voucher and your passport or ID.";
  },
  consigneCheckinFiche(partenaire, trajet = {}) {
    const fiche = String((partenaire && partenaire.regles && partenaire.regles.checkin_voucher) || "").trim();
    if (fiche && !/langkawi/i.test(`${trajet.de || ""} ${trajet.vers || ""}`)) return fiche;
    return avant.consigneCheckin((partenaire && partenaire.nom) || "", trajet);
  },
  notePasseport({ de = "", vers = "", libelle = "", compagnie = "" } = {}) {
    const lieux = `${de} ${vers} ${libelle}`;
    if (!/langkawi|malaysia|malaisie/i.test(lieux)) return "";
    const trajet = /langkawi/i.test(`${de} ${vers}`) ? { de, vers } : { de: "Langkawi", vers: "" };
    return `Travelling to or from Langkawi (Malaysia): please bring your passport, valid for at least six months. ${avant.consigneCheckin(compagnie, trajet)}`;
  },
  noteFr(note) {
    return note ? `${"Trajet vers ou depuis Langkawi (Malaisie) : prévoyez votre passeport, valable au moins six mois."} ${note.split(/months\.\s*/)[1] || ""}`.trim() : "";
  },
  alerteAvantVeille(r, { partenaire = "", trajet = null, paye = false } = {}) {
    if (!r || r.statut === "annule" || r.paye_sur_place || !r.date_service || paye || !/bundhaya/i.test(partenaire || "")) return null;
    const depart = trajet ? trajet.de : String(r.libelle || "").split(/→|->/).length > 1 ? String(r.libelle).split(/→|->/)[0] : "";
    if (!String(depart || "").trim() || /lanta/i.test(depart)) return null;
    const d = new Date(`${r.date_service}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return { avant: d.toISOString().slice(0, 10), date_service: r.date_service };
  },
  partenaireDeTaxi(partenaires = [], choisiId = null) {
    const actifs = partenaires.filter((p) => p.actif !== false);
    const choisi = choisiId ? actifs.find((p) => p.id === choisiId) : null;
    return choisi || actifs.find((p) => /taxi/i.test(p.nom || "")) || actifs[0] || null;
  },
  tarifZone: (p) => !!p && /saladan/i.test(p.groupe || "") && !(p.libelle || "").includes("→"),
};

// Trajets réels de la base (fixture des données de Secret et Taxi) et lignes typiques, y compris les cas limites.
const jeu = JSON.parse(readFileSync(new URL("./fixtures/donnees-secret-taxi-avant-apres.json", import.meta.url), "utf8"));
const TRAJETS = [
  ...new Map(jeu.trajets.map((t) => [`${t[5]}|${t[6]}`, { de: t[5], vers: t[6] }])).values(),
  { de: "Koh Lipe", vers: "Langkawi" }, { de: "Langkawi", vers: "Koh Lipe" }, { de: "Pakbara", vers: "Langkawi" }, { de: "Koh Lanta", vers: "Langkawi" },
  { de: "Koh Lanta", vers: "Koh Lipe" }, { de: "Koh Lanta", vers: "Krabi Airport" }, { de: "", vers: "" }, {},
];
const LIBELLES = ["", "Speedboat to Langkawi", "Ferry to Malaysia", "Bateau vers la Malaisie", "Koh Lanta → Koh Lipe", "Pakbara → Langkawi", "Pakbara -> Koh Lipe", "Billet", "4 Islands by longtail"];
assert.ok(TRAJETS.length > 20, "la fixture donne les lignes réelles");

test("règle 1, consigne de check-in du billet (Bundhaya 45 min, Satun 30 min) : même texte qu'avant pour chaque partenaire et chaque ligne", () => {
  for (const p of PARTENAIRES)
    for (const t of TRAJETS) {
      // Avant : la fiche n'avait pas encore de consigne (la migration ne l'écrit que sur une fiche vide).
      const ficheAvant = { ...p, regles: {} };
      assert.equal(consigneCheckinFiche(p, t, DESTINATIONS), avant.consigneCheckinFiche(ficheAvant, t), `${p.nom}, ${t.de} → ${t.vers}`);
      assert.equal(consigneCheckin(p, { passeport: !!destinationPasseport(DESTINATIONS, [t.de, t.vers]) }), avant.consigneCheckin(p.nom, t), `${p.nom}, ${t.de} → ${t.vers} (rappel H-1)`);
    }
});

test("règle 2, destination à passeport (Langkawi, Malaisie) et consigne passeport de Bundhaya : même note qu'avant, en anglais et en français", () => {
  let notes = 0;
  for (const p of PARTENAIRES)
    for (const t of TRAJETS)
      for (const libelle of LIBELLES) {
        const a = avant.notePasseport({ ...t, libelle, compagnie: p.nom });
        if (a) notes++;
        assert.equal(notePasseport({ ...t, libelle, partenaire: p, destinations: DESTINATIONS }), a, `${p.nom}, ${t.de} → ${t.vers}, « ${libelle} »`);
        assert.equal(notePasseport({ ...t, libelle, partenaire: p, destinations: DESTINATIONS, langue: "fr" }), avant.noteFr(a), `${p.nom}, ${t.de} → ${t.vers}, « ${libelle} », en français`);
      }
  assert.ok(notes > 100, "la comparaison couvre de vraies notes, pas seulement des vides");
});

test("règle 2 (suite) : la réponse à une demande et le rappel H-1 gardent la note d'avant", () => {
  const d = { nom: "Anna Keller", date: "2026-12-10", adultes: 2, enfants: 0, bebes: 0 };
  const offre = { titre: "Koh Lipe → Langkawi, 10:30", total: 3600, source: { de: "Koh Lipe", vers: "Langkawi", partenaire_id: "bund" } };
  const note = avant.notePasseport({ de: "Koh Lipe", vers: "Langkawi", libelle: offre.titre, compagnie: BUNDHAYA.nom });
  assert.ok(reponsePrix(d, offre, { partenaire: BUNDHAYA, destinations: DESTINATIONS }).includes(`\n\n${note}\n\nWould you like me to book it?`));
  const partenaireDe = (id) => PARTENAIRES.find((p) => p.id === id) || null;
  const services = [{ offre, date: "2026-12-10", adultes: 2, enfants: 0 }];
  assert.ok(varsReponse({ d, services, langue: "en", partenaireDe, destinations: DESTINATIONS }).services.endsWith(`\n  ${note}`));
  assert.ok(varsReponse({ d, services, langue: "fr", partenaireDe, destinations: DESTINATIONS }).services.endsWith(`\n  ${avant.noteFr(note)}`));
  const r = { libelle: "Koh Lanta → Langkawi", statut: "confirme", details: {} };
  assert.deepEqual(aPrevoir(r, { partenaire: SATUN, trajet: { de: "Koh Lanta", vers: "Langkawi" }, destinations: DESTINATIONS }), [avant.notePasseport({ de: "Koh Lanta", vers: "Langkawi", libelle: r.libelle, compagnie: SATUN.nom })]);
  const billet = { libelle: "Koh Lanta → Koh Lipe", statut: "confirme", trajet_id: "t1", details: {} };
  assert.deepEqual(aPrevoir(billet, { partenaire: BUNDHAYA, trajet: { de: "Koh Lanta", vers: "Koh Lipe" }, destinations: DESTINATIONS }), [avant.consigneCheckin(BUNDHAYA.nom, { de: "Koh Lanta", vers: "Koh Lipe" })]);
});

test("règle 3, à payer avant la veille (Bundhaya, sauf départ de Lanta) : même alerte qu'avant", () => {
  const dates = ["2026-12-10", "2027-01-01", "2026-03-01"];
  for (const p of PARTENAIRES)
    for (const t of [...TRAJETS, null])
      for (const libelle of LIBELLES)
        for (const date_service of [...dates, null])
          for (const extra of [{}, { paye_sur_place: true }, { statut: "annule" }])
            for (const paye of [false, true]) {
              const r = { statut: "confirme", paye_sur_place: false, date_service, libelle, ...extra };
              assert.deepEqual(alerteAvantVeille(r, { partenaire: p, trajet: t, paye }), avant.alerteAvantVeille(r, { partenaire: p.nom, trajet: t, paye }), `${p.nom}, ${JSON.stringify(t)}, « ${libelle} »`);
            }
  assert.deepEqual(alerteAvantVeille({ statut: "confirme", date_service: "2026-12-10", libelle: "" }, { partenaire: BUNDHAYA, trajet: { de: "Pakbara" } }), { avant: "2026-12-09", date_service: "2026-12-10" });
});

test("règle 4, tarifs par zone (taxis de Saladan) : même pickup à remplir qu'avant pour chaque tarif réel", () => {
  const parId = { e5ea98b9: NAN };
  let zones = 0;
  for (const x of jeu.prestations)
    for (const cote of ["avant", "apres"]) {
      const p = { ...x[cote], partenaire_id: x.p };
      const a = avant.tarifZone(p);
      if (a) zones++;
      assert.equal(estTarifZone(p, parId[x.p] || SANS_REGLE), a, `${p.groupe} / ${p.libelle}`);
    }
  assert.equal(zones, 22, "les 11 tarifs de Saladan, avant et après traduction");
});

test("règle 5, partenaire taxi par défaut (nom contenant « taxi ») : même chauffeur qu'avant", () => {
  const listes = [PARTENAIRES, [RATTANA, VIP], [RATTANA, SANS_REGLE], [{ ...VIP, actif: false }, NAN], [SATUN], [], [BUNDHAYA, NAN, VIP]];
  for (const l of listes)
    for (const choisi of [null, "vip", "nan", "rattana", "inconnu"]) assert.equal(partenaireDeTaxi(l, choisi), avant.partenaireDeTaxi(l, choisi), `${l.map((p) => p.nom).join(", ")} / ${choisi}`);
});

test("règle 6, traduction des libellés : même résultat qu'avant sur les 940 libellés réels, compagnies tirées des partenaires et des réglages", () => {
  // Instantané produit avec le partenaires-calc.mjs de master (18.11.2026) : texte → libellé client d'avant.
  const avantTrad = JSON.parse(readFileSync(new URL("./fixtures/libelles-client-avant.json", import.meta.url), "utf8"));
  reglerCompagnies([...PARTENAIRES.map((p) => p.nom), ...COMPAGNIES]);
  try {
    const textes = Object.keys(avantTrad);
    assert.ok(textes.length >= 900);
    for (const t of textes) assert.equal(libelleClient(t), avantTrad[t], t);
    // Ce que la règle générale de la première version traduisait à tort : rien ne change.
    assert.equal(libelleClient("Prix PAR PERSONNE"), "Prix, per person", "comme avant");
    assert.equal(libelleClient("Koh Lanta → Phuket par Koh Phi Phi"), "Koh Lanta → Phuket par Koh Phi Phi");
    assert.equal(libelleClient("Payé par Anaïs"), "Payé par Anaïs");
    assert.equal(libelleClient("par Tigerline"), "par Tigerline", "une compagnie inconnue de l'entreprise reste telle quelle");
    assert.equal(libelleClient("Billet par Bundhaya Speed Boat"), "Billet by Bundhaya Speed Boat", "un partenaire de l'entreprise");
    // Association des taxis : tout le lieu, pas un seul mot.
    assert.equal(libelleClient("Association des taxis de Koh Lanta"), "Koh Lanta Taxi Association");
    assert.equal(libelleClient("Association des taxis de Koh Lanta (zone A)"), "Koh Lanta Taxi Association (zone A)");
    assert.equal(libelleClient("Association des taxis de Saladan, 2 personnes"), "Saladan Taxi Association, 2 people");
  } finally {
    reglerCompagnies([]);
  }
  assert.equal(libelleClient("par Lomprayah"), "par Lomprayah", "sans partenaire ni réglage, aucun nom de compagnie n'est connu");
  assert.equal(libelleClient("Transfert par ferry"), "Transfert by ferry");
});

test("un nom seul ne déclenche plus rien : les règles viennent de la fiche et des réglages", () => {
  const nu = (nom) => ({ nom, regles: {}, ...REGLES_PARTENAIRE_NEUTRES });
  assert.equal(alerteAvantVeille({ statut: "confirme", date_service: "2026-12-10", libelle: "Pakbara → Langkawi" }, { partenaire: nu("Bundhaya Speed Boat") }), null);
  assert.equal(consigneCheckin(nu("Bundhaya Speed Boat")), "Please arrive at the pier 30 minutes before departure with this voucher and your passport or ID.");
  assert.equal(notePasseport({ de: "Koh Lipe", vers: "Langkawi", partenaire: BUNDHAYA }), "", "sans destination à passeport dans les réglages, pas de note");
  assert.equal(partenaireDeTaxi([nu("A"), nu("City Taxi")]).nom, "A", "le premier actif, plus celui dont le nom dit taxi");
  assert.equal(estTarifZone({ groupe: "Taxis de Saladan", libelle: "Klong Nin" }, nu("Mr. Nan Taxi")), false);
  // Une autre agence règle ses propres destinations et ses propres partenaires.
  const bali = [{ lieux: "Nusa Penida, Lombok", note_en: "Bring your ID." }];
  assert.equal(notePasseport({ de: "Sanur", vers: "Nusa Penida", partenaire: { checkin_passeport: "Be there 1 hour before." }, destinations: bali }), "Bring your ID. Be there 1 hour before.");
  assert.equal(alerteAvantVeille({ statut: "confirme", date_service: "2026-12-10", libelle: "" }, { partenaire: { payer_avant_veille: true, payer_avant_veille_sauf: "Sanur, Ubud" }, trajet: { de: "Ubud centre" } }), null);
});

test("nouvelle entreprise : aucune destination à passeport ; démonstration : la même règle que la base d'Anaïs, et des partenaires sans règle", () => {
  assert.deepEqual(completerReglages({}).destinations_passeport, []);
  assert.deepEqual(completerReglages({}).compagnies, []);
  assert.deepEqual(DESTINATION_PASSEPORT_DEMO, DESTINATIONS[0], "la démo a la règle écrite par la migration 43");
  assert.deepEqual(COMPAGNIES_DEMO, COMPAGNIES);
  const demo = donneesDemo("2026-11-18", ajouterJours);
  for (const r of Object.values(demo.reglages)) {
    assert.deepEqual(r.destinations_passeport, DESTINATIONS);
    assert.deepEqual(r.compagnies, COMPAGNIES);
  }
  for (const p of demo.partenaires) for (const [k, v] of Object.entries(REGLES_PARTENAIRE_NEUTRES)) assert.equal(p[k], v, `${p.nom}.${k}`);
  // Avant, aucun partenaire de démonstration n'était concerné par une règle de nom : rien ne change.
  for (const p of demo.partenaires) assert.ok(!/bundhaya|satun|taxi/i.test(p.nom) && !/saladan/i.test(p.groupe), p.nom);
});

test("la migration 43 écrit les mêmes textes que la fixture (une seule source)", () => {
  const sql = readFileSync(new URL("../docs/gestion/migration-43-regles-partenaires.sql", import.meta.url), "utf8");
  for (const t of [BUNDHAYA.checkin_passeport, BUNDHAYA.regles.checkin_voucher, SATUN.regles.checkin_voucher, DESTINATIONS[0].note_en, DESTINATIONS[0].note_fr]) assert.ok(sql.includes(`'${t}'`), t);
  assert.match(sql, /payer_avant_veille = true, payer_avant_veille_sauf = 'Lanta'/);
  assert.match(sql, /'lieux', jsonb_build_array\('Langkawi'\)/);
  assert.match(sql, /'mentions', jsonb_build_array\('Malaysia', 'Malaisie'\)/);
  assert.match(sql, /'compagnies', jsonb_build_array\('Lomprayah', 'Seatran'\)/);
});

test("import de partenaires (sauvegarde ou import-partenaires.mjs) : un fichier sans les règles n'efface pas celles de la base", async () => {
  const { fusionnerPartenairesImport } = await import("../src/gestion/js/sauvegarde.mjs");
  const { convertir } = await import("../docs/gestion/import-partenaires.mjs");
  // Un fichier produit par import-partenaires.mjs : regles sans checkin_voucher, aucune case.
  const fichier = convertir({ partners: [{ name: "Bundhaya Speed Boat", cancel: "No refund." }, { name: "Nouveau Ferry" }] }, "ent-secret");
  const [bund, nouveau] = fichier.partenaires;
  assert.equal("checkin_voucher" in bund.regles, false);
  assert.equal("payer_avant_veille" in bund, false);
  const enBase = { ...BUNDHAYA, id: bund.id, regles: { ...BUNDHAYA.regles, points_embarquement: [{ lieu: "Koh Lanta", ou: "Saladan Pier" }] } };
  const [b, n] = fusionnerPartenairesImport(fichier.partenaires, [enBase]);
  assert.equal(b.regles.checkin_voucher, BUNDHAYA.regles.checkin_voucher, "la consigne écrite par la migration reste");
  assert.equal(b.regles.annulation, "No refund.", "ce que le fichier dit l'emporte");
  assert.deepEqual(b.regles.points_embarquement, enBase.regles.points_embarquement);
  for (const k of Object.keys(REGLES_PARTENAIRE_NEUTRES)) assert.equal(b[k], BUNDHAYA[k], `case ${k} gardée`);
  for (const [k, v] of Object.entries(REGLES_PARTENAIRE_NEUTRES)) assert.equal(n[k], v, `nouveau partenaire : ${k} par défaut (jamais vide pour la base)`);
  assert.equal(n.nom, "Nouveau Ferry");
  // Une sauvegarde récente porte les cases : elles l'emportent.
  const [s] = fusionnerPartenairesImport([{ ...enBase, payer_avant_veille: false, regles: { checkin_voucher: "" } }], [enBase]);
  assert.equal(s.payer_avant_veille, false);
  assert.equal(s.regles.checkin_voucher, "", "une consigne vidée volontairement reste vide");
});
