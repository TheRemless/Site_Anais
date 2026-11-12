// Assistant IA : droits et limite, construction des prompts, lecture et contrôle des réponses de Claude (simulées, aucun appel réel),
// faits envoyés pour rédiger, coût estimé, et passage de la proposition à l'écran de la demande.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODELE,
  BETA_REPLI,
  USAGES,
  controlerAcces,
  construireCatalogue,
  promptLecture,
  promptRedaction,
  parametresAppel,
  SCHEMA_LECTURE,
  lireReponse,
  validerLecture,
  verifierFaits,
  validerRedaction,
  montantsDuTexte,
  langueReponse,
  coutEstime,
  ligneJournal,
  debutJourBangkok,
} from "../supabase/functions/assistant/calc.js";
import { propositionVersDemande, faitsPourReponse, simulerLecture, simulerRedaction, assistantActif, offresRecalculees } from "../src/gestion/js/assistant-calc.mjs";

const E = "11111111-1111-4111-8111-111111111111";
const AJD = "2026-11-12";
const PRESTATIONS = [
  { id: "a0000000-0000-4000-8000-000000000001", actif: true, famille: "excursion", libelle: "4 îles en longtail, journée", libelle_en: "4 Islands by longtail", groupe: "Excursions en groupe", prix_vente: 1200, unite: "pp", partenaire_id: "pa1", details: { horaires: "8h30 - 16h30", duree: "Journée complète", parc: "Adulte étranger: 400 ฿ | Enfant: 200 ฿" }, net: 700 },
  { id: "a0000000-0000-4000-8000-000000000002", actif: true, famille: "excursion", libelle: "4 îles en longtail, enfant 3 à 9 ans", libelle_en: "", groupe: "Excursions en groupe", prix_vente: 900, unite: "ch", partenaire_id: "pa1" },
  { id: "a0000000-0000-4000-8000-000000000003", actif: true, famille: "activite", libelle: "Kayak", libelle_en: "Kayaking", groupe: "", prix_vente: 600, unite: "pp", partenaire_id: "pa2" },
  { id: "a0000000-0000-4000-8000-000000000004", actif: true, famille: "frais", libelle: "Frais de parc", libelle_en: "Park fee", groupe: "", prix_vente: 400, unite: "pp", partenaire_id: null },
  { id: "a0000000-0000-4000-8000-000000000005", actif: false, famille: "activite", libelle: "Plongée (archivée)", libelle_en: "", groupe: "", prix_vente: 3000, unite: "pp", partenaire_id: "pa2" },
];
const TRAJETS = [{ id: "b0000000-0000-4000-8000-000000000001", actif: true, de: "Koh Lanta", vers: "Phuket Airport", mode: "Minivan privé", depart: "", duree: "4h", prix_adulte: 4500, prix_enfant: 0, partenaire_id: "pa3", net_adulte: 3000 }];
const PARTENAIRES = [{ id: "pa1", nom: "Rattana" }, { id: "pa2", nom: "Lanta Kayak" }, { id: "pa3", nom: "Mr Brown" }];
const CTX = { prestations: PRESTATIONS, trajets: TRAJETS, nomPartenaire: (id) => (PARTENAIRES.find((p) => p.id === id) || {}).nom || "" };

const ADMIN = ["clients.lire", "clients.ecrire", "dossiers.lire", "dossiers.ecrire", "finances.voir", "partenaires.lire", "partenaires.nets"];
const allume = { assistant_ia: true };

// ---- Droits et limite ---------------------------------------------------------------------------------------------------------------

test("droits : éteint par défaut, droits des tables, limite du jour", () => {
  const base = { usage: "lire", entiteId: E, permissions: ADMIN, reglages: allume, appelsDuJour: 0 };
  assert.deepEqual(controlerAcces(base), { ok: true });
  assert.equal(controlerAcces({ ...base, reglages: {} }).erreur, "assistant_eteint", "sans la case, rien ne part");
  assert.equal(controlerAcces({ ...base, reglages: { assistant_ia: "true" } }).erreur, "assistant_eteint", "seul le vrai booléen allume");
  assert.equal(controlerAcces({ ...base, reglages: null }).erreur, "pas_membre", "pas de ligne de réglages lisible : pas membre");
  const lecteur = controlerAcces({ ...base, permissions: ["dossiers.lire", "partenaires.lire"] });
  assert.equal(lecteur.erreur, "droit_manquant");
  assert.deepEqual(lecteur.manque, ["dossiers.ecrire"], "lire un message sert à créer un dossier");
  assert.equal(controlerAcces({ ...base, usage: "rediger", permissions: ["dossiers.lire", "partenaires.lire"] }).ok, true, "un lecteur peut faire rédiger");
  assert.equal(controlerAcces({ ...base, permissions: ["dossiers.ecrire"] }).manque[0], "partenaires.lire", "sans la base de prix, pas de lecture");
  assert.equal(controlerAcces({ ...base, appelsDuJour: 40 }).statut, 429);
  assert.equal(controlerAcces({ ...base, appelsDuJour: 4, limite: 5 }).ok, true);
  assert.equal(controlerAcces({ ...base, usage: "questions" }).erreur, "usage_inconnu", "l'usage 3 n'existe pas encore");
  assert.equal(controlerAcces({ ...base, entiteId: "ztp" }).erreur, "entreprise_invalide");
});

test("début du jour à Bangkok : minuit heure locale en UTC", () => {
  assert.equal(debutJourBangkok(new Date("2026-11-12T03:00:00Z")), "2026-11-11T17:00:00.000Z");
  assert.equal(debutJourBangkok(new Date("2026-11-12T18:00:00Z")), "2026-11-12T17:00:00.000Z", "après 17h UTC, c'est déjà le lendemain à Bangkok");
});

// ---- Catalogue et prompts -------------------------------------------------------------------------------------------------------------

test("catalogue : seulement ce qui se propose, ni net ni identifiant, ordre stable", () => {
  const c = construireCatalogue({ prestations: PRESTATIONS, trajets: TRAJETS, partenaires: PARTENAIRES });
  assert.match(c.texte, /4 Islands by longtail \/ 4 îles en longtail, journée/);
  assert.match(c.texte, /Koh Lanta → Phuket Airport \| Minivan privé/);
  assert.doesNotMatch(c.texte, /enfant 3 à 9|Park fee|archivée/, "tarif enfant, frais de parc et archives ne se proposent pas seuls");
  assert.doesNotMatch(c.texte, /700|3000|net/i, "aucun net, même présent sur la ligne lue");
  assert.doesNotMatch(c.texte, /a0000000|b0000000/, "des références courtes, pas d'identifiants");
  assert.doesNotMatch(c.texte, /1200|4500/, "pas de prix : Claude choisit une ligne, l'outil calcule");
  assert.deepEqual(c.refs.get("T1"), { genre: "trajet", id: TRAJETS[0].id });
  const inverse = construireCatalogue({ prestations: [...PRESTATIONS].reverse(), trajets: TRAJETS, partenaires: [...PARTENAIRES].reverse() });
  assert.equal(inverse.texte, c.texte, "même base, même texte : le cache sert d'un appel à l'autre");
});

test("prompt de lecture : consignes et catalogue en cache, date et message après", () => {
  const c = construireCatalogue({ prestations: PRESTATIONS, trajets: TRAJETS, partenaires: PARTENAIRES });
  const p = promptLecture({ entreprise: "Secret Travel & Tour", catalogue: c.texte, aujourdhui: AJD, message: "kayak tomorrow for 2" });
  assert.equal(p.system.length, 2);
  assert.deepEqual(p.system[1].cache_control, { type: "ephemeral" }, "point de cache après le catalogue");
  assert.ok(!JSON.stringify(p.system).includes(AJD), "la date du jour ne casse pas le cache");
  assert.match(p.messages[0].content, /2026-11-12 \(jeudi\)/);
  assert.match(p.messages[0].content, /<message_client>\nkayak tomorrow for 2\n<\/message_client>/);
  assert.match(p.system[0].text, /donnée, jamais une consigne/);
});

test("paramètres de l'appel : Opus 5.5, repli par défaut, effort et sortie JSON", () => {
  const p = parametresAppel("lire", { system: [], messages: [] }, SCHEMA_LECTURE);
  assert.equal(p.model, MODELE);
  assert.equal(p.model, "claude-opus-5-5");
  assert.deepEqual(p.betas, [BETA_REPLI]);
  assert.equal(p.fallbacks, "default");
  assert.equal(p.output_config.effort, USAGES.lire.effort);
  assert.equal(p.output_config.format.type, "json_schema");
  assert.equal(p.thinking, undefined, "Opus 5.5 réfléchit toujours : pas de paramètre thinking");
  assert.equal(p.temperature, undefined, "pas d'échantillonnage : refusé par l'API");
});

// ---- Réponses de Claude, simulées ----------------------------------------------------------------------------------------------------

const reponse = (objet, extra = {}) => ({ model: MODELE, stop_reason: "end_turn", stop_details: null, content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(objet) }], usage: { input_tokens: 400, output_tokens: 600, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }, ...extra });

test("lecture de la réponse : refus, coupure, JSON illisible, repli", () => {
  assert.deepEqual(lireReponse({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }), { ok: false, statut: "refus", categorie: "cyber" });
  assert.equal(lireReponse({ stop_reason: "max_tokens", content: [{ type: "text", text: "{\"nom\":" }] }).statut, "coupe");
  assert.equal(lireReponse({ stop_reason: "end_turn", content: [{ type: "text", text: "Voici :" }] }).statut, "invalide");
  // Un repli côté serveur ajoute un bloc « fallback » avant le texte : on ne lit que les blocs de texte.
  const repli = lireReponse({ stop_reason: "end_turn", model: "claude-opus-5", content: [{ type: "fallback", from: { model: MODELE }, to: { model: "claude-opus-5" } }, { type: "text", text: "{\"a\":1}" }] });
  assert.deepEqual(repli, { ok: true, valeur: { a: 1 } });
});

const MESSAGE = "Hi! We are 2 adults and 1 kid (7). Staying at Sunset Resort Klong Dao. We'd like the 4 islands tour on Nov 20 and a taxi to Phuket airport on the 24th at 9am. Thanks, Sophie Martin +33 6 12 34 56 78";
const CLAUDE_LECTURE = {
  nom: "Sophie Martin",
  telephone: "+33 6 12 34 56 78",
  hotel: "Sunset Resort Klong Dao",
  langue: "en",
  adultes: 2,
  enfants: 1,
  ages_enfants: [7],
  bebes: 0,
  services: [
    { texte: "the 4 islands tour on Nov 20", date: "2026-11-20", heure: "", adultes: 2, enfants: 1, ref: "P1", alternatives: ["P2"], confiance: "haute" },
    { texte: "a taxi to Phuket airport on the 24th at 9am", date: "2026-11-24", heure: "09:00", adultes: 2, enfants: 1, ref: "T1", alternatives: [], confiance: "moyenne" },
  ],
  remarques: "",
};

function lireSimule(objet, message = MESSAGE) {
  const c = construireCatalogue({ prestations: PRESTATIONS, trajets: TRAJETS, partenaires: PARTENAIRES });
  const lu = lireReponse(reponse(objet));
  assert.equal(lu.ok, true);
  return validerLecture(lu.valeur, { refs: c.refs, message, aujourdhui: AJD });
}

test("validation : une bonne lecture passe telle quelle, références traduites", () => {
  const c = construireCatalogue({ prestations: PRESTATIONS, trajets: TRAJETS, partenaires: PARTENAIRES });
  const ref = [...c.refs.entries()].find(([, v]) => v.id === PRESTATIONS[0].id)[0];
  const v = lireSimule({ ...CLAUDE_LECTURE, services: [{ ...CLAUDE_LECTURE.services[0], ref }, CLAUDE_LECTURE.services[1]] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.avertissements, []);
  assert.equal(v.proposition.client.nom, "Sophie Martin");
  assert.equal(v.proposition.client.telephone, "+33 6 12 34 56 78");
  assert.deepEqual(v.proposition.services[0].offre, { genre: "prestation", id: PRESTATIONS[0].id });
  assert.deepEqual(v.proposition.services[1].offre, { genre: "trajet", id: TRAJETS[0].id });
  assert.equal(v.proposition.services[1].heure, "09:00");
});

test("validation : rien d'inventé ne passe", () => {
  const v = lireSimule({
    ...CLAUDE_LECTURE,
    nom: "Sophie Dupont",
    telephone: "+66 81 000 0000",
    hotel: "Pimalai Resort",
    adultes: 500,
    ages_enfants: [7, 40, -1],
    services: [
      { ...CLAUDE_LECTURE.services[0], ref: "P99", alternatives: ["P99", "T1", "T1"], date: "2026-02-30", heure: "25:00", confiance: "haute" },
      { ...CLAUDE_LECTURE.services[1], date: "2026-11-01" },
    ],
  });
  assert.equal(v.ok, true);
  const p = v.proposition;
  assert.equal(p.client.nom, "", "nom absent du message");
  assert.equal(p.client.telephone, "", "téléphone absent du message");
  assert.equal(p.client.hotel, "", "hôtel absent du message");
  assert.equal(p.client.adultes, 60, "nombre borné");
  assert.deepEqual(p.client.ages_enfants, [7]);
  assert.equal(p.services[0].offre, null, "référence hors catalogue ignorée");
  assert.equal(p.services[0].confiance, "basse", "sans offre, la confiance tombe");
  assert.deepEqual(p.services[0].alternatives, [{ genre: "trajet", id: TRAJETS[0].id }], "doublons et références inconnues retirés");
  assert.equal(p.services[0].date, "", "30 février refusé");
  assert.equal(p.services[0].heure, "");
  for (const a of ["nom_non_cite", "telephone_non_cite", "hotel_non_cite", "reference_inconnue", "date_illisible", "date_passee"]) assert.ok(v.avertissements.includes(a), a);
  // Claude ajoute l'indicatif à un numéro écrit à la française : c'est bien le numéro du message.
  const indicatif = lireSimule({ ...CLAUDE_LECTURE, telephone: "+33 6 12 34 56 78" }, "Bonjour, kayak demain pour 2. Sophie Martin 06 12 34 56 78");
  assert.equal(indicatif.proposition.client.telephone, "+33 6 12 34 56 78");
  assert.equal(validerLecture({ nom: "x" }, { refs: new Map(), message: "", aujourdhui: AJD }).ok, false, "forme inattendue : invalide");
});

test("proposition vers l'écran de la demande : prix de la base, tarif enfant, alternatives", () => {
  const c = construireCatalogue({ prestations: PRESTATIONS, trajets: TRAJETS, partenaires: PARTENAIRES });
  const ref = [...c.refs.entries()].find(([, v]) => v.id === PRESTATIONS[0].id)[0];
  const v = lireSimule({ ...CLAUDE_LECTURE, services: [{ ...CLAUDE_LECTURE.services[0], ref }, CLAUDE_LECTURE.services[1]] });
  const { d, services } = propositionVersDemande(v.proposition, CTX);
  assert.equal(d.libre, true);
  assert.equal(d.ia, true);
  assert.equal(d.nom, "Sophie Martin");
  assert.equal(d.date, "2026-11-20");
  assert.deepEqual(d.ages, [7]);
  assert.equal(services.length, 2);
  assert.equal(services[0].offres[0].total, 1200 * 2 + 900, "adultes au tarif adulte, enfant au tarif enfant de la base");
  assert.equal(services[0].offres[0].titre, "4 Islands by longtail");
  assert.equal(services[1].offres[0].total, 4500 * 2);
  assert.equal(services[1].heure, "09:00");
  assert.equal(services[1].confiance, "moyenne");
  // Anaïs corrige le nombre de personnes : le prix suit, comme dans la lecture par règles.
  assert.equal(offresRecalculees(services[0].offres, { adultes: 3, enfants: 0 }, CTX)[0].total, 3600);
  // Une ligne retirée de la base entre la lecture et l'affichage : le service reste, à préciser.
  const sans = propositionVersDemande(v.proposition, { ...CTX, trajets: [] });
  assert.equal(sans.services[1].inconnu, true);
  assert.equal(sans.services[1].confiance, "basse");
});

// ---- Rédaction ------------------------------------------------------------------------------------------------------------------------

test("faits pour la réponse : prix de vente seulement, clés permises", () => {
  const { d, services } = propositionVersDemande(
    { client: { nom: "Sophie Martin", adultes: 2, enfants: 1, hotel: "Sunset Resort" }, services: [{ texte: "", date: "2026-11-20", heure: "", adultes: 2, enfants: 1, offre: { genre: "prestation", id: PRESTATIONS[0].id }, alternatives: [], confiance: "haute" }] },
    CTX
  );
  const f = faitsPourReponse({ d, services, entreprise: "Secret Travel & Tour", devise: "THB" });
  assert.equal(f.prenom, "Sophie");
  assert.equal(f.total, 3300);
  assert.equal(f.services[0].horaires, "08:30 - 16:30");
  assert.equal(f.services[0].duree, "Full day");
  assert.match(f.services[0].frais_parc, /Adult 400/);
  assert.doesNotMatch(JSON.stringify(f), /700|net|commission|banque|bank/i, "aucun net ni banque");
  const ok = verifierFaits(f);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(verifierFaits({ ...f, services: [{ ...f.services[0], net: 700 }] }).erreur, "faits_cle_interdite", "une clé « net » est refusée");
  assert.deepEqual(verifierFaits({ ...f, commission: 10 }).cles, ["commission"]);
  assert.equal(verifierFaits({ ...f, services: [] }).ok, false);
});

test("langue de la réponse : Secret et Taxi toujours en anglais, d'après le mode", () => {
  assert.equal(langueReponse({ fonctionnement: "excursions", libelles: { facture: "FACTURE" } }, "fr"), "en", "Secret : anglais même si le libellé de facture est français");
  assert.equal(langueReponse({ fonctionnement: "taxi" }, "fr"), "en");
  assert.equal(langueReponse({ fonctionnement: "sur_mesure", libelles: { facture: "INVOICE" } }, "fr"), "fr", "ZTP : la langue du client");
  assert.equal(langueReponse({ fonctionnement: "sur_mesure" }, "en"), "en");
  assert.equal(langueReponse({}, ""), "fr");
});

test("prompt de rédaction : Taxi signe du nom de l'entreprise, jamais Anaïs", () => {
  const f = verifierFaits({ entreprise: "VIP TAXI LANTA", prenom: "Tom", devise: "THB", total: 1500, services: [{ libelle: "Krabi Airport → Koh Lanta", date: "2026-11-20", adultes: 2, prix: 1500 }] }).faits;
  const p = promptRedaction({ faits: f, langue: "en" });
  assert.match(p.system[0].text, /Have a nice day, VIP TAXI LANTA/);
  assert.doesNotMatch(p.system[0].text, /Anaïs"/);
  const s = promptRedaction({ faits: { ...f, entreprise: "Secret Travel & Tour" }, langue: "en" });
  assert.match(s.system[0].text, /Have a lovely day, Anaïs/, "Secret garde la voix d'Anaïs");
});

test("prompt de rédaction : faits dans le message, voix et exemples en cache", () => {
  const f = verifierFaits({ entreprise: "Secret Travel & Tour", prenom: "Sophie", devise: "THB", total: 3300, services: [{ libelle: "4 Islands by longtail", date: "2026-11-20", adultes: 2, enfants: 1, prix: 3300, a_confirmer: true }] }).faits;
  const p = promptRedaction({ faits: f, langue: "en", exemples: ["Hello {prenom},\n\nYour booking is confirmed"], messageClient: MESSAGE });
  assert.deepEqual(p.system[0].cache_control, { type: "ephemeral" });
  assert.match(p.system[0].text, /Hello Firstname/);
  assert.match(p.system[0].text, /Your booking is confirmed/);
  assert.match(p.messages[0].content, /"prix": 3300/);
  assert.match(p.messages[0].content, /<message_client>/);
  assert.match(p.messages[0].content, /anglais/);
});

test("contrôle du brouillon : un montant ou une heure hors base est signalé", () => {
  const f = verifierFaits({ entreprise: "Secret", prenom: "Sophie", devise: "THB", total: 3300, services: [{ libelle: "4 Islands", date: "2026-11-20", heure: "08:30", prix: 3300, frais_parc: "Adult 400 THB, child 200 THB" }] }).faits;
  const bon = validerRedaction({ message: "Hello Sophie,\n→ 4 Islands, 20 November 2026, pickup 08:30: 3,300 THB\nPark fee: adult 400 THB, child 200 THB, cash.\nCall +66 95 868 38 46", prix_cites: [3300, 400, 200], manques: ["hotel"] }, f);
  assert.equal(bon.ok, true);
  assert.deepEqual(bon.avertissements, [], "prix, frais de parc, année et téléphone acceptés");
  assert.deepEqual(bon.manques, ["hotel"]);
  const faux = validerRedaction({ message: "Hello Sophie, special price 2,900 THB instead of 3,300 THB, pickup 07:45.", prix_cites: [2900, 3300], manques: [] }, f);
  assert.deepEqual(faux.avertissements, ["montant_hors_base:2900", "heure_hors_base:07:45"]);
  assert.equal(validerRedaction({ message: "  " }, f).ok, false);
});

test("montants d'un texte", () => {
  assert.deepEqual(montantsDuTexte("1,200 THB, 1 200 ฿, ฿900, 4500 baht"), [1200, 1200, 900, 4500]);
  assert.deepEqual(montantsDuTexte("on 2026-11-20 at 9:30, 2 adults, room 12, +66 81 234 5678, 20 November 2026, le 3 déc. 2026, 20/11/2026"), []);
  assert.deepEqual(montantsDuTexte("special price 2030 THB"), [2030], "un montant entre 2020 et 2039 reste un montant");
});

// ---- Coût et journal -------------------------------------------------------------------------------------------------------------------

test("coût estimé et journal sans contenu", () => {
  assert.equal(coutEstime({ input_tokens: 1e6 }), 4);
  assert.equal(coutEstime({ output_tokens: 1e6 }), 20);
  assert.equal(coutEstime({ cache_read_input_tokens: 1e6 }), 0.2);
  assert.equal(coutEstime({ cache_creation_input_tokens: 1e6 }), 5);
  assert.equal(coutEstime({ input_tokens: 1e6 }, "claude-opus-5"), 5, "un repli est compté au prix du modèle de secours");
  const m = reponse(CLAUDE_LECTURE);
  const l = ligneJournal({ userId: "u1", entiteId: E, usage: "lire", statut: "ok", message: m, dureeMs: 2345.6 });
  assert.equal(l.cout_estime_usd, (400 * 4 + 600 * 20 + 5000 * 0.2) / 1e6);
  assert.equal(l.duree_ms, 2346);
  assert.doesNotMatch(JSON.stringify(l), /Sophie|Sunset|islands/i, "le journal ne garde aucun contenu");
  assert.equal(ligneJournal({ userId: "u1", entiteId: E, usage: "lire", statut: "erreur", message: null }).cout_estime_usd, 0);
});

// ---- Démonstration ----------------------------------------------------------------------------------------------------------------------

test("démo : réponses simulées dans la forme de la fonction", () => {
  assert.equal(assistantActif({}), false);
  assert.equal(assistantActif({ assistant_ia: true }), true);
  const s = simulerLecture("Hi, kayaking tomorrow for 2 adults please. Anna", CTX, AJD);
  assert.equal(s.ok, true);
  assert.equal(s.modele, "simulation");
  assert.deepEqual(s.proposition.services[0].offre, { genre: "prestation", id: PRESTATIONS[2].id });
  const { services } = propositionVersDemande(s.proposition, CTX);
  assert.equal(services[0].offres[0].total, 1200);
  assert.equal(services[0].date, "2026-11-13");
  const f = faitsPourReponse({ d: { nom: "Anna", bebes: 0 }, services, devise: "THB" });
  const r = simulerRedaction(f, "en");
  assert.match(r.message, /Hello Anna/);
  assert.match(r.message, /1,200 THB/);
  assert.equal(validerRedaction(r, verifierFaits(f).faits).avertissements.length, 0, "la simulation ne cite que des prix de la base");
});
