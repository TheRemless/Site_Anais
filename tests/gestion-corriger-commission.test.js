// tests/gestion-corriger-commission.test.js : corriger une commission, ou le prix et la commission, depuis À encaisser (23.11.2026, migration 119).
// Jérémy : la commission a dû être baissée après un remboursement partiel au client ; il y aura toujours des cas spéciaux. Motif obligatoire,
// ancien montant gardé, totaux recalculés, déjà reçu jamais réécrit, Mr. Brown ne réécrit pas une commission corrigée.
// La fonction SQL corriger_commission est vérifiée sur Postgres en mémoire par docs/gestion/verif-corriger-commission.mjs (CI).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { correctionCommission, netsCorriges, luCorrection, corrigerLocal, derniereCorrection, texteCorrection, suitePrixDocument, retourEncaisser, RETOUR_MINUTES, MOTIFS_CORRECTION, aRecevoirParPartenaire, recuesParPartenaire, sommeRestes, VALEURS_ANNULATION } from "../src/gestion/js/encaisser-calc.mjs";
import { recalculerCommissions, correctionEnVigueur } from "../src/gestion/js/operations-calc.mjs";
import { commissionDuPartenaire, saisieLocale, coursesLocales } from "../src/gestion/js/courses-partenaire-calc.mjs";
import { valeurJournal } from "../src/gestion/js/journal-calc.mjs";

const AJD = "2026-11-23";
const MAINTENANT = "2026-11-23T09:00:00.000Z";
const resa = (id, dossier, extra = {}) => ({ id, entite_id: "secret", dossier_id: dossier, partenaire_id: "bateau", date_service: "2026-11-20", statut: "confirme", montant_vente: 2000, paye_sur_place: true, libelle: `Service ${id}`, personnes: { adultes: 2, enfants: 0 }, ...extra });
const choix = (extra) => ({ mode: "commission", motif: "remboursement_partiel", ...extra });
const source = (f) => fs.readFileSync(new URL(`../src/gestion/js/${f}`, import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../docs/gestion/migration-119-corriger-commission.sql", import.meta.url), "utf8");

// Une démo minimale : une course de Secret, ses nets, sa facture, et les droits de Nani.
function demo({ nets = { commission_prevue: 400, commission_prevue_auto: 400 }, droits = ["partenaires.nets", "dossiers.ecrire", "documents.ecrire"] } = {}) {
  const r = resa("a", "D1", { ligne_id: "l1" });
  const data = {
    reservations: [r],
    reservations_nets: nets ? [{ id: "n1", entite_id: "secret", reservation_id: "a", ...nets }] : [],
    documents: [{ id: "f1", entite_id: "secret", dossier_id: "D1", type: "facture", updated_at: "v1", envoye_le: null, contenu: { lignes: [{ id: "l1", unite: 2000, qte: 1 }] } }],
  };
  const droit = (e, code) => e === "secret" && droits.includes(code);
  return { data, droit, r };
}
const args = (data, extra) => ({ reservationId: "a", entiteId: "secret", commission: 300, prix: null, motif: "remboursement_partiel", note: null, lu: luCorrection(data.reservations[0], data.reservations_nets[0]), documents: [], ...extra });
const corrigerDemo = (d, extra) => corrigerLocal(d.data, d.droit, args(d.data, extra), { ajd: AJD, maintenant: MAINTENANT });

test("la commission seule : nouvelle commission, ancienne gardée, montant posé noté, la base ne la recalcule plus, le reçu jamais écrit", () => {
  const r = resa("a", "D1");
  const n = { commission_prevue: 400, commission_prevue_auto: 400 };
  const res = correctionCommission(r, n, choix({ commission: 300, note: "  client remboursé de 500  " }));
  assert.equal(res.erreur, null);
  assert.equal(res.prix, null, "le prix ne bouge pas");
  const v = netsCorriges(r, n, res, { motif: "remboursement_partiel", ajd: AJD, maintenant: MAINTENANT });
  assert.deepEqual(v, { commission_prevue: 300, commission_prevue_auto: null, commission_avant_correction: 400, prix_avant_correction: null, commission_apres_correction: 300, commission_corrigee_le: MAINTENANT, commission_corrigee_motif: "remboursement_partiel", commission_corrigee_note: "client remboursé de 500", commission_partenaire: null, commission_partenaire_le: null, commission_recue_le: null, commission_soldee_par_correction: false });
  assert.ok(!("commission_recue" in v), "commission_recue n'est jamais réécrite");
});

test("les refus : montant, prix, motif, note pour « autre », rien qui change, sous le déjà reçu, au-dessus du prix, déjà soldée", () => {
  const r = resa("a", "D1");
  const n = { commission_prevue: 400, commission_recue: 100, commission_partielle_le: "2026-11-21" };
  const e = (c) => correctionCommission(r, n, choix(c)).erreur;
  assert.equal(e({ commission: null }), "commission");
  assert.equal(e({ commission: -5 }), "commission");
  assert.equal(e({ commission: 12.345 }), "commission");
  assert.equal(e({ mode: "prix", prix: 0, commission: 300 }), "prix");
  assert.equal(e({ commission: 300, motif: null }), "motif");
  assert.equal(e({ commission: 300, motif: "rabais" }), "motif", "les motifs d'écart d'encaissement ne servent pas ici");
  assert.equal(e({ commission: 300, motif: "autre", note: "   " }), "note");
  assert.equal(e({ commission: 300, note: "x".repeat(201) }), "note");
  assert.equal(e({ commission: 300, motif: "autre", note: "vu avec le partenaire" }), null);
  assert.equal(e({ commission: 400 }), "inchange");
  assert.equal(e({ commission: 50 }), "sous_recu");
  assert.equal(e({ mode: "prix", prix: 200, commission: 300 }), "au_dessus_prix");
  assert.equal(correctionCommission(r, { ...n, commission_recue_le: "2026-11-22" }, choix({ commission: 300 })).erreur, "reglee");
  assert.deepEqual(MOTIFS_CORRECTION.map(([k]) => k), ["remboursement_partiel", "geste_commercial", "erreur_saisie", "autre"]);
  // Les mêmes motifs, la même limite et la même règle « autre » que la base.
  assert.match(sql, /'remboursement_partiel', 'geste_commercial', 'erreur_saisie', 'autre'/);
  assert.match(sql, /length\(coalesce\(note, ''\)\) > 200/);
});

test("point 1 : une écriture concurrente est refusée (encaissement noté après l'ouverture), rien n'est écrit et le reçu reste", () => {
  const d = demo({ nets: { commission_prevue: 400, commission_recue: 100, commission_partielle_le: "2026-11-21" } });
  const lu = luCorrection(d.data.reservations[0], d.data.reservations_nets[0]);
  // Un versement de 150 noté sur un autre appareil entre l'ouverture et l'enregistrement.
  Object.assign(d.data.reservations_nets[0], { commission_recue: 250, commission_partielle_le: AJD });
  assert.throws(() => corrigerDemo(d, { commission: 100, lu }), /corriger_commission:change/);
  assert.equal(d.data.reservations_nets[0].commission_recue, 250);
  assert.equal(d.data.reservations_nets[0].commission_prevue, 400);
  // Relu, la correction au déjà reçu solde le service sans toucher au montant reçu.
  const ok = corrigerDemo(d, { commission: 250 });
  assert.equal(ok.solde, true);
  assert.equal(d.data.reservations_nets[0].commission_recue, 250);
  assert.equal(d.data.reservations_nets[0].commission_recue_le, AJD);
  // La base fait le même contrôle, ligne verrouillée, et ne réécrit jamais commission_recue.
  assert.match(sql, /select \* into n from reservations_nets where reservation_id = r\.id for update;/);
  assert.match(sql, /n\.commission_recue is distinct from \(p_lu->>'commission_recue'\)::numeric/);
  assert.doesNotMatch(sql.slice(sql.indexOf("update reservations_nets set"), sql.indexOf("where id = n.id")), /commission_recue\s*=/);
});

test("point 1 : sans la lecture de la feuille (nulle, pas un objet, montant manquant), la correction est refusée", () => {
  for (const lu of [null, undefined, [], 400, "x", { commission_prevue: 400, commission_recue: null }, {}]) {
    const d = demo();
    assert.throws(() => corrigerDemo(d, { lu }), /corriger_commission:lecture_manquante/, JSON.stringify(lu));
    assert.equal(d.data.reservations_nets[0].commission_prevue, 400, "rien d'écrit");
  }
  assert.match(sql, /if p_lu is null or jsonb_typeof\(p_lu\) <> 'object' or not \(p_lu \? 'commission_prevue' and p_lu \? 'commission_recue' and p_lu \? 'montant_vente'\) then\s+raise exception 'corriger_commission:lecture_manquante';/);
  assert.ok(sql.indexOf("corriger_commission:lecture_manquante") < sql.indexOf("corriger_commission:change"), "contrôlée avant la comparaison");
});

test("point 1 : droits et entreprise contrôlés (démo et base)", () => {
  assert.throws(() => corrigerDemo(demo({ droits: ["dossiers.ecrire"] })), /corriger_commission:droits/, "sans les nets");
  assert.throws(() => corrigerDemo(demo({ droits: ["partenaires.nets"] })), /corriger_commission:droits/, "sans l'écriture des dossiers");
  assert.throws(() => corrigerDemo(demo(), { entiteId: "taxi" }), /corriger_commission:entite/, "autre entreprise");
  assert.match(sql, /a_permission\(r\.entite_id, 'partenaires\.nets'\) and a_permission\(r\.entite_id, 'dossiers\.ecrire'\)/);
  assert.match(sql, /r\.entite_id <> p_entite then raise exception 'corriger_commission:entite'/);
  assert.match(sql, /revoke all on function corriger_commission\(uuid, uuid, numeric, numeric, text, text, jsonb, jsonb\) from public, anon;/);
});

test("point 2 : prix, commission et facture en une fois ; tout ou rien ; la règle du partenaire ne recalcule pas entre deux écritures", () => {
  const d = demo();
  const doc = d.data.documents[0];
  const suite = suitePrixDocument(doc, d.r, 1800);
  assert.equal(suite.raison, null);
  assert.equal(suite.contenu.lignes[0].unite, 1800);
  // Une facture modifiée entre-temps : refus, ni prix, ni commission, ni facture écrits.
  assert.throws(() => corrigerDemo(d, { prix: 1800, documents: [{ id: "f1", updated_at: "v0", complet: suite.contenu }] }), /corriger_commission:change/);
  assert.equal(d.data.reservations[0].montant_vente, 2000);
  assert.equal(d.data.reservations_nets[0].commission_prevue, 400);
  assert.equal(doc.contenu.lignes[0].unite, 2000);
  // Sans le droit des factures, la facture ne peut pas être passée : refus entier.
  assert.throws(() => corrigerDemo(demo({ droits: ["partenaires.nets", "dossiers.ecrire"] }), { prix: 1800, documents: [{ id: "f1", updated_at: "v1", complet: suite.contenu }] }), /corriger_commission:documents/);
  const res = corrigerDemo(d, { prix: 1800, documents: [{ id: "f1", updated_at: "v1", complet: suite.contenu }] });
  assert.equal(d.data.reservations[0].montant_vente, 1800);
  assert.equal(d.data.reservations_nets[0].commission_prevue, 300);
  assert.equal(d.data.reservations_nets[0].commission_prevue_auto, null, "la migration 32 ne réécrit qu'une commission égale à sa valeur calculée");
  assert.equal(doc.contenu.lignes[0].unite, 1800);
  assert.deepEqual(res.documents, [{ id: "f1", updated_at: MAINTENANT }]);
  // Dans la base : les nets d'abord (auto vidée), puis le prix, puis les documents, dans la même fonction.
  const i = (t) => sql.indexOf(t);
  assert.ok(i("update reservations_nets set") < i("update reservations set montant_vente = p_prix") && i("update reservations set montant_vente = p_prix") < i("update documents set contenu"));
  assert.match(sql, /commission_prevue_auto = null,/);
  // L'écran ne fait plus d'écritures séparées : une seule fonction du store.
  const vue = source("views/encaisser-commissions.mjs");
  assert.match(vue, /etat\.store\.corrigerCommission\(/);
  assert.doesNotMatch(vue, /enregistrerLie\("reservations_nets", "reservation_id", frais\.id|appliquerChangements|modifier\("reservations"/);
});

test("point 3 : la trace suit la commission ; modifiée ailleurs ensuite, l'écran le dit et la règle du partenaire reprend la main", () => {
  const corrigee = { commission_prevue: 300, commission_avant_correction: 400, commission_apres_correction: 300, prix_avant_correction: 2000, commission_corrigee_le: MAINTENANT, commission_corrigee_motif: "remboursement_partiel", commission_corrigee_note: "x" };
  assert.equal(derniereCorrection({ commission_prevue: 300 }), null);
  assert.deepEqual(derniereCorrection(corrigee), { le: "2026-11-23", avant: 400, apres: 300, actuelle: 300, modifieeDepuis: false, prixAvant: 2000, motif: "remboursement_partiel", note: "x" });
  const ensuite = { ...corrigee, commission_prevue: 350 }; // changée dans Taxi du lendemain ou la fiche du service
  assert.equal(derniereCorrection(ensuite).modifieeDepuis, true);
  assert.match(texteCorrection(ensuite, (m) => `THB ${m}`), /400 → THB 300.*modifiée depuis : THB 350/);
  assert.doesNotMatch(texteCorrection(corrigee, String), /modifiée depuis/);
  assert.equal(correctionEnVigueur(corrigee), true);
  assert.equal(correctionEnVigueur(ensuite), false);
  const r = resa("a", "D1");
  const regleDe = () => ({ type: "pourcent_vente", valeur: 20 });
  assert.equal(recalculerCommissions([r], { regleDe, netDe: () => corrigee }).changements.length, 0, "en vigueur : pas de recalcul");
  assert.equal(recalculerCommissions([r], { regleDe, netDe: () => ensuite }).changements.length, 1, "modifiée depuis : la règle reprend la main");
  assert.match(sql, /commission_apres_correction = p_commission,/);
});

test("point 6 : une commission corrigée et déjà reçue n'est pas signalée comme écart à la règle", () => {
  const r = resa("a", "D1");
  const regleDe = () => ({ type: "pourcent_vente", valeur: 20 }); // la règle donne 400
  const recue = { commission_prevue: 300, commission_recue: 300, commission_recue_le: AJD };
  assert.equal(recalculerCommissions([r], { regleDe, netDe: () => recue }).ecartsRecus.length, 1, "sans correction, l'écart reçu est signalé");
  const corrigeeRecue = { ...recue, commission_corrigee_le: MAINTENANT, commission_apres_correction: 300 };
  const t = recalculerCommissions([r], { regleDe, netDe: () => corrigeeRecue });
  assert.equal(t.ecartsRecus.length, 0);
  assert.equal(t.changements.length, 0);
  const src = source("operations-calc.mjs");
  assert.ok(src.indexOf("if (correctionEnVigueur(n))") < src.indexOf("if (n.commission_recue_le) {"), "le test de correction précède la branche « déjà reçue »");
});

test("point 7 : soldée par correction à 0, sans rien de reçu : hors de « Reçues », jamais « reçue 0 » avec Annuler", () => {
  const d = demo({ nets: { commission_prevue: 250 } });
  const res = corrigerDemo(d, { commission: 0 });
  const n = d.data.reservations_nets[0];
  assert.equal(res.solde, true);
  assert.ok(n.commission_recue === null || n.commission_recue === undefined, "aucun montant reçu inventé");
  assert.equal(n.commission_recue_le, AJD);
  assert.equal(n.commission_soldee_par_correction, true);
  const netDe = (x) => d.data.reservations_nets.find((y) => y.reservation_id === x.id);
  assert.equal(aRecevoirParPartenaire(d.data.reservations, netDe, { ajd: AJD }).length, 0, "plus rien à recevoir");
  assert.equal(recuesParPartenaire(d.data.reservations, netDe, { depuis: "2026-11-01" }).length, 0, "pas de ligne « reçue 0 »");
  // Soldée au déjà reçu (versement réel) : la ligne reste, marquée « soldée par correction ».
  const p = demo({ nets: { commission_prevue: 400, commission_recue: 100, commission_partielle_le: "2026-11-21" } });
  corrigerDemo(p, { commission: 100 });
  const rec = recuesParPartenaire(p.data.reservations, (x) => p.data.reservations_nets.find((y) => y.reservation_id === x.id), { depuis: "2026-11-01" });
  assert.equal(rec[0].dossiers[0].recu, 100);
  assert.equal(rec[0].dossiers[0].parCorrection, true);
  assert.match(source("views/encaisser-commissions.mjs"), /d\.parCorrection \? tr\("soldée par correction"\)/);
  assert.equal(VALEURS_ANNULATION.commission_soldee_par_correction, false);
});

test("un dossier en partie encaissé garde ses encaissements, le reste dû suit la nouvelle commission, les totaux restent la somme de la liste", () => {
  const rs = [resa("a", "D1"), resa("b", "D2"), resa("c", "D3")];
  const table = { a: { commission_prevue: 400, commission_recue: 100, commission_partielle_le: "2026-11-21", commission_recue_moyen: "especes" }, b: { commission_prevue: 250 }, c: { commission_prevue: 150 } };
  const netDe = (r) => table[r.id] || null;
  assert.equal(aRecevoirParPartenaire(rs, netDe, { ajd: AJD })[0].reste, 300 + 250 + 150);
  const res = correctionCommission(rs[0], table.a, choix({ commission: 250 }));
  table.a = { ...table.a, ...netsCorriges(rs[0], table.a, res, { motif: "remboursement_partiel", ajd: AJD, maintenant: MAINTENANT }) };
  const apres = aRecevoirParPartenaire(rs, netDe, { ajd: AJD });
  const d1 = apres[0].dossiers.find((d) => d.dossier_id === "D1");
  assert.equal(d1.dejaRecu, 100);
  assert.equal(d1.reste, 150);
  assert.equal(apres[0].reste, sommeRestes(apres[0].dossiers));
  assert.equal(table.a.commission_recue_moyen, "especes");
});

test("point 8 : Mr. Brown ne modifie plus une commission corrigée (démo comme base), même au montant qu'il avait saisi", () => {
  const n = { commission_prevue: 500, commission_partenaire: 500, commission_partenaire_le: "2026-11-22T10:00:00Z" };
  assert.equal(commissionDuPartenaire(n), true);
  const reservation = { id: "t", entite_id: "taxi", dossier_id: "T1", partenaire_id: "vip", date_service: "2026-11-24", statut: "confirme", montant_vente: 1600, paye_sur_place: true, personnes: { adultes: 1 } };
  const jeu = (nets) => ({ reservations: [reservation], reservations_nets: [{ reservation_id: "t", ...nets }], dossiers: [{ id: "T1", entite_id: "taxi", client_id: "c", annule: false }], clients: [{ id: "c", entite_id: "taxi", prenom: "Test", nom: "Client" }], partenaires_acces: [{ user_id: "u", partenaire_id: "vip", entite_id: "taxi" }], partenaires: [{ id: "vip", entite_id: "taxi", nom: "VIP test" }], entites: [{ id: "taxi" }], reglages: { taxi: { fonctionnement: "taxi", devise: "THB" } }, profils: [{ user_id: "u", actif: true }], membres: [] });
  assert.equal(saisieLocale(jeu(n), "u", AJD, "t", 700).commission_prevue, 700, "avant la correction, il peut changer la sienne");
  // Corrigée sans que sa saisie ait été effacée (même montant) : la date de correction suffit à verrouiller.
  const corrigee = { ...n, commission_corrigee_le: MAINTENANT, commission_apres_correction: 500 };
  assert.equal(coursesLocales(jeu(corrigee), "u", AJD)[0].modifiable, false);
  assert.throws(() => saisieLocale(jeu(corrigee), "u", AJD, "t", 700), (e) => e.message !== "Course introuvable.");
  assert.match(sql, /coalesce\(n\.commission_recue, 0\) = 0 and n\.commission_corrigee_le is null/);
  assert.match(sql, /n\.commission_corrigee_le is not null then\s+raise exception 'Commission corrigée par l''équipe/);
});

test("point 4 et 9 : le nom coche la case, « Dossier » ouvre la fiche ; la note de retour est datée, garde la sélection et vaut pour ce dossier seulement", () => {
  const vue = source("views/encaisser-commissions.mjs");
  assert.match(vue, /h\("span", \{ class: "enc-client" \}, nom\)/, "le nom est le texte de la case, pas un lien");
  assert.match(vue, /class: "bouton secondaire petit enc-ouvrir", href: `#\/dossier\/\$\{d\.dossier_id\}`/);
  assert.match(vue, /noterRetour\(d\.dossier_id, coches\)/);
  assert.match(vue, /noterRetour\(null, coches\);\s+rafraichir\(\);/, "après une correction, la sélection et la hauteur restent");
  assert.match(vue, /const coches = new Set\(\(\(retour && retour\.coches\) \|\| \[\]\)\.filter/);
  const t0 = Date.parse(MAINTENANT);
  const note = JSON.stringify({ t: t0, y: 640, coches: ["bateau|D1"], dossierId: "D1" });
  assert.deepEqual(retourEncaisser(note, { maintenant: t0 + 60000 }), { y: 640, coches: ["bateau|D1"], dossierId: "D1" });
  assert.equal(retourEncaisser(note, { maintenant: t0 + (RETOUR_MINUTES + 1) * 60000 }), null, "périmée");
  assert.equal(retourEncaisser(note, { maintenant: t0 + 60000, dossierId: "D2" }), null, "un autre dossier");
  assert.ok(retourEncaisser(note, { maintenant: t0 + 60000, dossierId: "D1" }), "même après un passage par un document du dossier");
  assert.equal(retourEncaisser("pas du json", { maintenant: t0 }), null);
  assert.match(source("views/dossier.mjs"), /retourVersEncaisser\(d\.id\) \? h\("a", \{ class: "retour", href: "#\/encaisser" \}/);
});

test("point 5 : l'aperçu de facture vient d'apercuFacture et dit pourquoi une facture garde l'ancien prix", () => {
  const r = resa("a", "D1", { ligne_id: "l1", details: { lignes_ids: ["l2"] } });
  const deux = { id: "f", type: "facture", contenu: { lignes: [{ id: "l1", unite: 1000, qte: 1 }, { id: "l2", unite: 1000, qte: 1 }] } };
  assert.deepEqual(suitePrixDocument(deux, r, 1800), { contenu: null, raison: "plusieurs_lignes", lignes: 2, qte: null });
  const une = resa("b", "D1", { ligne_id: "m1" });
  const parTrois = { id: "g", type: "facture_locale", contenu: { lignes: [{ id: "m1", unite: 700, qte: 3 }] } };
  // 2 000 ne se divise pas juste par 3 : la ligne prend le total, sans prix unitaire arrondi (23.11.2026, tests/gestion-aligner-facture.test.js).
  const total = suitePrixDocument(parTrois, une, 2000);
  assert.equal(total.raison, null);
  assert.deepEqual([total.contenu.lignes[0].unite, total.contenu.lignes[0].qte, total.contenu.lignes[0].montant], [null, 3, 2000]);
  assert.equal(suitePrixDocument(parTrois, une, 1800).contenu.lignes[0].unite, 600);
  const vue = source("views/encaisser-commissions.mjs");
  assert.match(vue, /apercuFacture\(r, \{ montant_vente: arrondi\(p\) \}\)/);
  assert.match(vue, /a\.suit && a\.envoye\) \{\s+const ok = await confirmer/, "facture envoyée : confirmation avant d'enregistrer");
  assert.match(source("views/suivi-facture.mjs"), /\["facture", "facture_locale", "devis"\]\.includes\(x\.type\)/);
});

test("point 10 : texteCorrection vit dans le calcul, les écrans n'importent plus la vue À encaisser", () => {
  assert.match(source("views/reservations.mjs"), /import \{ texteCorrection \} from "\.\.\/encaisser-calc\.mjs";/);
  for (const f of ["views/reservations.mjs", "views/dossier.mjs"]) assert.doesNotMatch(source(f), /from "\.\/encaisser-commissions\.mjs"/, f);
  assert.equal(valeurJournal("commission_corrigee_motif", "geste_commercial"), "Geste commercial");
  const journal = source("views/journal.mjs");
  for (const k of ["commission_avant_correction", "prix_avant_correction", "commission_apres_correction", "commission_corrigee_le", "commission_corrigee_motif", "commission_corrigee_note", "commission_soldee_par_correction"]) assert.match(journal, new RegExp(`${k}: N_\\(`), `${k} a un nom dans le journal`);
});

test("droits de l'écran : bouton Corriger seulement avec les nets et l'écriture ; le partenaire et Mook ne le voient pas", () => {
  const vue = source("views/encaisser-commissions.mjs");
  assert.match(vue, /const corrige = ecrit && voitNets\(\);/);
  assert.match(vue, /corrige \? h\("button", \{ class: "secondaire petit enc-corriger"/);
  assert.match(source("views/encaisser.mjs"), /const voitCommissions = voitNets\(\) && modeExcursions\(\);/);
  assert.doesNotMatch(source("views/courses-partenaire.mjs"), /Corriger la commission|corrigerCommission/);
});

test("le voucher et les messages au client ne lisent jamais la correction ni la commission", () => {
  for (const f of ["views/voucher.mjs", "views/voucher-secret.mjs", "views/voucher-taxi.mjs", "views/message-client.mjs", "message-voucher-calc.mjs", "textes-voucher.mjs"]) {
    assert.doesNotMatch(source(f), /commission_corrigee|commission_avant_correction|prix_avant_correction|commission_prevue|commission_recue/, f);
  }
});

test("la migration 119 : colonnes, fonction, retour, rejouée en CI", () => {
  for (const c of ["commission_avant_correction", "prix_avant_correction", "commission_apres_correction", "commission_corrigee_le", "commission_corrigee_motif", "commission_corrigee_note", "commission_soldee_par_correction"]) assert.match(sql, new RegExp(`add column if not exists ${c}`));
  assert.match(sql, /create or replace function corriger_commission\(/);
  const retour = fs.readFileSync(new URL("../docs/gestion/retour-119-corriger-commission.sql", import.meta.url), "utf8");
  assert.match(retour, /drop function if exists corriger_commission/);
  assert.match(retour, /create function partenaire_courses\(\)/);
  assert.match(fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"), /verif-corriger-commission/);
  assert.match(source("store-supabase.mjs"), /sb\.rpc\("corriger_commission"/);
  assert.match(source("store-local.mjs"), /corrigerLocal\(data, droit, args/);
});
