// tests/gestion-whatsapp-confort.test.js : lot 2 des audits du 20.11.2026, le confort de Nani dans la boîte WhatsApp et l'Assistant.
// Aperçu et attente dans la liste, lien wa.me prérempli, fiche « faits du client », réponses courtes, conversation à trier qui ne bloque
// plus, Assistant (titre, recherche, échange WhatsApp, suite d'une carte validée), barre du bas.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const racine = path.join(__dirname, "..");
const source = (f) => fs.readFileSync(path.join(racine, f), "utf8");
const W = () => import("../src/gestion/js/whatsapp-calc.mjs");
const F = () => import("../src/gestion/js/whatsapp-faits-calc.mjs");
const A = () => import("../src/gestion/js/agent-calc.mjs");

const msg = (minutes, sens, texte, o = {}) => ({ id: `${sens}${minutes}`, sens, texte, type: "text", envoye_le: new Date(Date.parse("2026-11-20T12:00:00Z") + minutes * 60000).toISOString(), supprime_le: null, ...o });

test("aperçu : le début du dernier message, son type, et le premier message resté sans réponse", async () => {
  const { apercuDepuisMessages, APERCU_MAX } = await W();
  const a = apercuDepuisMessages([msg(0, "entrant", "Hello"), msg(1, "sortant", "Hi!"), msg(5, "entrant", "Do you   have\nplaces for Saturday?"), msg(6, "entrant", null, { type: "image" })]);
  assert.equal(a.dernier_texte, null, "une photo sans légende : pas de texte");
  assert.equal(a.dernier_type, "image");
  assert.equal(a.attend_depuis, msg(5, "entrant").envoye_le, "le premier message après la dernière réponse de Nani");
  const b = apercuDepuisMessages([msg(0, "entrant", "x".repeat(300)), msg(1, "sortant", "ok")]);
  assert.equal(b.attend_depuis, null, "Nani a répondu");
  assert.equal(apercuDepuisMessages([msg(0, "entrant", "Hi"), msg(1, "sortant", "ok", { origine: "gestion", statut_envoi: "echec" })]).attend_depuis, msg(0, "entrant").envoye_le, "un envoi en échec n'est pas une réponse");
  assert.equal(b.dernier_texte, "ok");
  assert.equal(apercuDepuisMessages([msg(0, "entrant", "x".repeat(300))]).dernier_texte.length, APERCU_MAX);
  assert.equal(apercuDepuisMessages([msg(0, "entrant", "Secret", { supprime_le: "2026-11-20T12:05:00Z" })]).dernier_type, "supprime", "message supprimé par le client : rien de son texte");
  assert.equal(apercuDepuisMessages([msg(0, "entrant", "Hi"), msg(1, "entrant", "👍", { type: "reaction" })]).dernier_texte, "Hi", "une réaction ne remplace pas l'aperçu");
  assert.deepEqual(apercuDepuisMessages([]), { dernier_texte: null, dernier_type: null, attend_depuis: null });
  assert.equal(apercuDepuisMessages([msg(0, "entrant", null, { type: "image", medias: [{ type: "image", legende: "This is our hotel" }] })]).dernier_texte, "This is our hotel", "une photo légendée : sa légende");
  assert.match(source("docs/gestion/migration-65-whatsapp-apercu.sql"), /x->>'legende'/, "même règle en base");
});

test("liste : « Vous : » quand c'est Nani, le type pour un média, rien sans la migration 65", async () => {
  const { apercuConversation } = await W();
  assert.deepEqual(apercuConversation({ dernier_texte: "See you", dernier_sens: "sortant" }), { texte: "See you", deNani: true, type: null });
  assert.deepEqual(apercuConversation({ dernier_texte: null, dernier_type: "audio", dernier_sens: "entrant" }), { texte: "", deNani: false, type: "audio" });
  assert.equal(apercuConversation({ dernier_type: "supprime", dernier_sens: "entrant" }).type, "supprime");
  assert.deepEqual(apercuConversation({ dernier_sens: "entrant" }), { texte: "", deNani: false, type: null });
});

test("attente : depuis le premier message sans réponse, en couleur au-delà de 30 min, rien si Nani a répondu ou si le tri dit non", async () => {
  const { attenteClient, dureeCourte } = await W();
  const maintenant = Date.parse("2026-11-20T13:00:00Z");
  const conv = { dernier_sens: "entrant", attend_depuis: "2026-11-20T12:15:00Z", dernier_message_le: "2026-11-20T12:55:00Z" };
  assert.deepEqual(attenteClient(conv, null, maintenant), { minutes: 45, texte: "45 min", urgent: true });
  assert.equal(attenteClient({ ...conv, attend_depuis: null }, null, maintenant).minutes, 5, "sans la migration 65 : le dernier message");
  assert.equal(attenteClient({ ...conv, dernier_sens: "sortant" }, null, maintenant), null);
  assert.equal(attenteClient({ ...conv, tri: { preparer: false, motif: "remerciement", le: "2026-11-20T12:56:00Z" } }, null, maintenant), null, "un merci n'attend rien");
  assert.equal(dureeCourte(4), "4 min");
  assert.equal(dureeCourte(80), "1 h 20");
  assert.equal(dureeCourte(60 * 11 + 5), "11 h");
  assert.equal(dureeCourte(60 * 50), "2 j");
});

test("wa.me : la réponse déjà écrite dans le lien, sans texte s'il est trop long ; plusieurs messages courts", async () => {
  const { lienWhatsApp, morceauxReponse, TEXTE_LIEN_MAX } = await W();
  assert.equal(lienWhatsApp("+66 81 234 5678"), "https://wa.me/66812345678");
  assert.equal(lienWhatsApp("+66 81 234 5678", "Hi Lea!\n\nPickup 08:30 🙏"), `https://wa.me/66812345678?text=${encodeURIComponent("Hi Lea!\n\nPickup 08:30 🙏")}`);
  assert.equal(lienWhatsApp("+66 81 234 5678", "x".repeat(TEXTE_LIEN_MAX + 1)), "https://wa.me/66812345678", "trop long : le texte se colle");
  assert.equal(lienWhatsApp("123"), null);
  assert.deepEqual(morceauxReponse("Hi Lea!\n\n  Pickup at 08:30  \n\n\nSee you"), ["Hi Lea!", "Pickup at 08:30", "See you"]);
  assert.deepEqual(morceauxReponse("One line\nsecond line"), ["One line\nsecond line"], "un retour à la ligne simple ne coupe pas");
});

test("à trier ne bloque plus : l'Assistant s'ouvre dans l'entreprise suggérée, sinon l'entreprise ouverte", async () => {
  const { entreprisePourAssistant } = await W();
  const secret = { id: "s", slug: "secret" };
  const taxi = { id: "t", slug: "taxi" };
  const choix = [secret, taxi];
  assert.equal(entreprisePourAssistant({ conv: { entite_id: "t" }, choix, activeId: "s" }), taxi, "rangée : la sienne");
  assert.equal(entreprisePourAssistant({ conv: { entite_id: null, tri: { entreprise: "taxi" } }, choix, activeId: "s" }), taxi, "le tri suggère Taxi");
  assert.equal(entreprisePourAssistant({ conv: { entite_id: null }, prop: { entreprise_proposee: "secret" }, choix, activeId: "t" }), secret, "la réponse préparée suggère Secret");
  assert.equal(entreprisePourAssistant({ conv: { entite_id: null }, choix, activeId: "t" }), taxi, "rien de suggéré : l'entreprise ouverte");
  assert.equal(entreprisePourAssistant({ conv: { entite_id: null }, choix: [secret], activeId: "x" }), secret);
  assert.equal(entreprisePourAssistant({ conv: { entite_id: null }, choix: [], activeId: "x" }), null, "aucun Assistant allumé : on demande");
  const vue = source("src/gestion/js/views/whatsapp.mjs");
  const vers = vue.slice(vue.indexOf("async function versAssistant"), vue.indexOf("// Le voucher du dossier relié"));
  // Jamais rangée avant l'Assistant ; un client rangé dans l'autre entreprise redevient seulement commun (entite_id vide, 22.11.2026).
  assert.doesNotMatch(vers, /modifier\("whatsapp_conversations", c\.id, \{ entite_id: (?!null)/, "plus de rangement avant l'Assistant");
  assert.doesNotMatch(vue, /Rangez la conversation pour la relier/);
});

test("faits du client : le client au même numéro, le prochain dossier, les faits copiables, jamais de net", async () => {
  const { clientPourFaits, dossierPourFaits, faitsClient, prochainService } = await F();
  const clients = [{ id: "c1", telephone: "+66 81 234 5678", prenom: "Lea" }, { id: "c2", telephone: "0812999999" }];
  assert.equal(clientPourFaits({ client_id: "c2" }, clients).id, "c2", "relié");
  assert.equal(clientPourFaits({ telephone: "66812345678" }, clients).id, "c1", "à trier : retrouvé par les 9 derniers chiffres");
  assert.equal(clientPourFaits({ telephone: "+1 202 555 0147" }, clients), null);
  const dossiers = [
    { id: "passe", client_id: "c1", ref: "S-1", created_at: "2026-10-01" },
    { id: "proche", client_id: "c1", ref: "S-2", created_at: "2026-11-10" },
    { id: "loin", client_id: "c1", ref: "S-3", created_at: "2026-11-01" },
    { id: "annule", client_id: "c1", ref: "S-4", annule: true },
  ];
  const reservations = [
    { id: "r0", dossier_id: "passe", date_service: "2026-10-05", libelle: "Ferry", montant_vente: 600 },
    { id: "r1", dossier_id: "proche", date_service: "2026-11-23", heure_pickup: null, lieu_pickup: "Lanta Sand Resort", libelle: "4 Islands", montant_vente: 3000, net: 2100, prix_net: 2100, partenaire_nom: "Lazy Day", paye_sur_place: false },
    { id: "r2", dossier_id: "proche", date_service: "2026-11-22", heure_pickup: "08:30", lieu_pickup: "Lanta Sand Resort", libelle: "Transfer", montant_vente: 1200, net: 900, paye_sur_place: true },
    { id: "r3", dossier_id: "proche", date_service: "2026-11-24", statut: "annule", montant_vente: 9999 },
    { id: "r4", dossier_id: "loin", date_service: "2026-12-20", montant_vente: 500 },
  ];
  const d = dossierPourFaits({ conv: { client_id: "c1" }, client: clients[0], dossiers, reservations, aujourdhui: "2026-11-20" });
  assert.equal(d.id, "proche", "le prochain à venir");
  assert.equal(dossierPourFaits({ conv: { dossier_id: "loin" }, client: clients[0], dossiers, reservations, aujourdhui: "2026-11-20" }).id, "loin", "le dossier relié d'abord");
  assert.equal(dossierPourFaits({ conv: {}, client: clients[0], dossiers, reservations, aujourdhui: "2027-01-01" }).id, "loin", "tout est passé : le plus récent");
  assert.equal(prochainService(reservations.filter((r) => r.dossier_id === "proche"), "2026-11-20").id, "r2");
  const lignes = faitsClient({ dossier: d, reservations, resume: { total: 4200, reste: 1500, devise: "THB" }, aujourdhui: "2026-11-20", montant: (n, dv) => `${dv} ${n}` });
  const par = Object.fromEntries(lignes.map((l) => [l.cle, l]));
  assert.equal(par.dates.valeur, "2026-11-22 au 2026-11-23", "dates en toutes lettres, sans le service annulé");
  assert.equal(par.hotel.valeur, "Lanta Sand Resort");
  assert.equal(par.pickup.valeur, "2026-11-22, 08:30");
  assert.equal(par.pickup.sousTitre, "Transfer");
  assert.equal(par.pickup.aFixer, false);
  assert.equal(par.total.valeur, "THB 4200");
  assert.equal(par.reste.valeur, "THB 1500");
  assert.equal(par.sur_place.valeur, "THB 1200");
  assert.equal(lignes.filter((l) => l.cle.startsWith("prix-")).length, 2);
  const tout = JSON.stringify(lignes);
  for (const interdit of ["2100", "900", "Lazy Day", "9999"]) assert.ok(!tout.includes(interdit), `jamais « ${interdit} » (net, partenaire, service annulé)`);
  const sansHeure = faitsClient({ dossier: d, reservations: reservations.filter((r) => r.id !== "r2"), aujourdhui: "2026-11-20" });
  assert.equal(sansHeure.find((l) => l.cle === "pickup").aFixer, true, "heure à fixer");
  const taxi = faitsClient({ dossier: d, reservations, resume: { total: 4200, reste: 1500 }, aujourdhui: "2026-11-20", taxi: true });
  assert.ok(!taxi.some((l) => l.cle === "reste"), "Taxi : pas de reste de facture");
  assert.equal(taxi.find((l) => l.cle === "sur_place").libelle, "À payer au chauffeur");
  assert.equal(faitsClient({ dossier: d, reservations, resume: { total: 4200, reste: 0 }, aujourdhui: "2026-11-20" }).find((l) => l.cle === "reste").paye, true);
  assert.deepEqual(faitsClient({ dossier: null }), []);
});

test("faits du client : branchés sous l'en-tête, copiés d'un tap, sans appel à l'IA", () => {
  const vue = source("src/gestion/js/views/whatsapp.mjs");
  const bloc = vue.slice(vue.indexOf("function blocFaits"), vue.indexOf("// ---- Suivi (migrations 61 et 62)"));
  assert.match(bloc, /onclick: \(e\) => copierFait\(e\.currentTarget, valeurDe\(l\)\)/);
  assert.match(bloc, /montant: \(n, d\) => formatMontant\(n, d \|\| undefined\)/, "prix comme partout dans Gestion");
  assert.doesNotMatch(bloc, /store\.(agent|whatsappPreparer)|anthropic/i, "aucun appel à l'IA");
  // Migration 68 : le type du contact se range à côté de l'entreprise.
  assert.match(vue, /h\("div", \{ class: "wa-fil-infos" \}, selecteurEntreprise\(c, prop\)(?:, selecteurType\(c\))?\),\n\s+(?:bandeauFiche\(c\),\n\s+)?blocFaits\(c, prop\),/);
  assert.match(vue, /function menuConversation\(c\)/, "les réglages rares dans le menu « … »");
});

test("réponses courtes : longueur cible et plafond tirés des messages de Nani, plusieurs messages plutôt qu'un pavé", async () => {
  const { longueurNani, consigneLongueur, LONGUEUR_DEFAUT, blocTon } = await import("../supabase/functions/whatsapp/ton.js");
  assert.deepEqual(longueurNani([]), { ...LONGUEUR_DEFAUT, mesures: 0 });
  assert.equal(longueurNani([{ nani: "ok" }, { nani: "Sure" }]).cible, 60, "trop peu de messages : les valeurs du 20.11");
  const paires = [20, 30, 42, 42, 45, 60, 90, 120, 200, 400].map((n) => ({ nani: "x".repeat(n) }));
  const l = longueurNani(paires);
  assert.equal(l.cible, 45, "médiane");
  assert.equal(l.plafond, 120, "80e centile");
  assert.equal(longueurNani(Array.from({ length: 6 }, () => ({ nani: "ok" }))).cible, 30, "bornée en bas");
  assert.ok(longueurNani(Array.from({ length: 6 }, () => ({ nani: "x".repeat(900) }))).plafond <= 220, "bornée en haut");
  const c = consigneLongueur({ cible: 45, plafond: 120 });
  assert.match(c, /environ 45 caractères, jamais plus de 120 par message/);
  assert.match(c, /3 messages courts au plus, séparés par une ligne vide/);
  assert.match(c, /passe avant la voix enregistrée/);
  assert.match(blocTon({ paires }), /environ 45 caractères/);
  const { demandeAgent } = await import("../supabase/functions/whatsapp/proposer.js");
  const t = demandeAgent({ messages: [{ sens: "entrant", texte: "Hi", envoye_le: "2026-11-20T10:00:00Z" }] });
  assert.match(t, /un message par information, trois au plus, séparés par une ligne vide/);
  assert.doesNotMatch(t, /avec un seul message/);
});

test("serveur : préparer et créer le dossier sur une conversation à trier", async () => {
  const { entrepriseParDefaut } = await import("../supabase/functions/whatsapp/proposer.js");
  assert.equal(entrepriseParDefaut({ unifie: true, slugs: ["taxi", "secret"] }), "secret");
  assert.equal(entrepriseParDefaut({ unifie: true, slugs: ["taxi"] }), "taxi");
  assert.equal(entrepriseParDefaut({ unifie: false, slugs: ["secret", "taxi"] }), null, "sans espace unifié : Nani choisit");
  const r = source("supabase/functions/whatsapp/reponse.ts");
  assert.equal(entrepriseParDefaut({ unifie: true, slugs: ["secret", "taxi"], allumees: ["taxi"] }), "taxi", "jamais une entreprise à l'assistant éteint");
  assert.match(r, /defaut = entrepriseParDefaut\(\{ unifie: true, slugs: \(ents \|\| \[\]\)\.map\(\(e\) => e\.slug\), allumees \}\)/);
  // 22.11.2026 : le choix passe par entrepriseReponse (proposer.js), qui garde l'entreprise de départ de l'espace unifié en dernier recours.
  assert.match(r, /const ent = entrepriseReponse\(\{ conv, ents: entites \|\| \[\], suggestion, defaut \}\)/);
  const { entrepriseReponse } = await import("../supabase/functions/whatsapp/proposer.js");
  assert.equal(entrepriseReponse({ conv: { entite_id: null, reponses: "auto" }, ents: [{ id: "S", slug: "secret" }], suggestion: null, defaut: "secret" }).id, "S");
  const { titreWhatsApp } = await import("../supabase/functions/agent/whatsapp.js");
  assert.equal(titreWhatsApp({ nom: "Lea [Moreau]", telephone: "+33600000000" }), "Lea (Moreau)", "le nom du contact, crochets neutralisés");
  assert.equal(titreWhatsApp({ nom: "", telephone: "+33600000000" }), "WhatsApp +33600000000");
  const a = source("supabase/functions/agent/index.ts");
  assert.match(a, /const titre = waId \? titreWhatsApp\(waConv\)/);
  assert.match(a, /wc\.data\.entite_id === null \? await sb\.from\("entites"\)\.select\("slug"\)\.eq\("id", entiteId\)\.maybeSingle\(\) : null/);
  assert.match(a, /\["secret", "taxi"\]\.includes\(ent\.data\.slug\)/, "une conversation à trier n'entre que chez Secret ou Taxi");
});

test("Assistant : titre au nom du client, recherche, échange WhatsApp à gauche, suite d'une carte validée après rechargement", async () => {
  const { titreConversation, titreAutomatique, nomDepuisCartes, chercherConversations, echangeWhatsApp, dossiersDeLaCarte } = await A();
  assert.ok(titreAutomatique("Dossier depuis WhatsApp") && titreAutomatique("Clara Martin, Lanta Sand Resort, 2…") && !titreAutomatique("Séjour de Clara"));
  assert.equal(titreConversation({ titre: "Clara Martin, Lanta Sand Resort, 2…" }, { client: { prenom: "Clara", nom: "Martin" } }), "Clara Martin");
  assert.equal(titreConversation({ titre: "Séjour de Clara" }, { client: { prenom: "Clara", nom: "Martin" } }), "Séjour de Clara", "un titre choisi est gardé");
  assert.equal(titreConversation({ titre: "Dossier depuis WhatsApp" }, { carteClient: "Lea Moreau" }), "Lea Moreau");
  assert.equal(nomDepuisCartes([{ genre: "reponse" }, { genre: "dossier", donnees: { client: { nom: " Lea Moreau " } } }]), "Lea Moreau");
  const liste = [{ id: 1, titre: "Léa Moreau", apercu: "4 Islands" }, { id: 2, titre: "Tom", apercu: "Airport" }];
  assert.deepEqual(chercherConversations(liste, "lea").map((c) => c.id), [1], "sans accents ni casse");
  assert.deepEqual(chercherConversations(liste, "airport tom").map((c) => c.id), [2]);
  assert.equal(chercherConversations(liste, "  ").length, 2);
  const e = echangeWhatsApp("Crée le dossier…\n\n<conversation>\n(messages plus anciens non repris)\n[Client 20.11.2026 10:00] Hi! 4 islands?\n[Nani 20.11.2026 10:02, modifié] Yes 🙏\n</conversation>");
  assert.deepEqual(e.messages, [{ deClient: true, heure: "20.11.2026 10:00", texte: "Hi! 4 islands?" }, { deClient: false, heure: "20.11.2026 10:02", texte: "Yes 🙏" }]);
  assert.equal(echangeWhatsApp("Course samedi à 16:00"), null, "un message ordinaire reste une bulle de Nani");
  assert.equal(echangeWhatsApp("Hello\nWe are 2", { depuisWhatsApp: true }).messages.length, 2, "démonstration : les lignes du client");
  const dossiers = [{ id: "d1", dossier_lie_id: "d2" }, { id: "d2" }, { id: "d3", annule: true }];
  assert.deepEqual(dossiersDeLaCarte({ statut: "validee", genre: "dossier", donnees: {} }, { conv: { dossier_id: "d1" }, dossiers }), { dossier: dossiers[0], dossiers: [dossiers[0], dossiers[1]] }, "le dossier relié et son dossier lié");
  assert.equal(dossiersDeLaCarte({ statut: "validee", genre: "reservation", donnees: { dossier_id: "d2" } }, { dossiers }).dossier.id, "d2");
  assert.equal(dossiersDeLaCarte({ statut: "proposee", genre: "dossier" }, { conv: { dossier_id: "d1" }, dossiers }), null, "pas encore validée");
  const cartes = [{ id: "k1", genre: "dossier", statut: "validee" }, { id: "k2", genre: "dossier", statut: "validee", donnees: {} }];
  assert.equal(dossiersDeLaCarte(cartes[1], { conv: { dossier_id: "d1" }, dossiers, cartes }), null, "une seconde carte dossier ne prend pas le dossier de la première");
  assert.equal(dossiersDeLaCarte(cartes[0], { conv: { dossier_id: "d1" }, dossiers, cartes }).dossier.id, "d1");
  assert.equal(dossiersDeLaCarte({ statut: "validee", genre: "dossier", donnees: { dossier_id: "d3" } }, { dossiers }), null, "dossier annulé");
  const vue = source("src/gestion/js/views/agent.mjs");
  assert.match(vue, /const r = resultats\.get\(c\.id\) \|\| dossiersDeLaCarte\(c, \{ conv, dossiers: etat\.brut\.dossiers \|\| \[\], cartes: fil\.cartes \}\);/);
  assert.match(vue, /async function ouvrir\(id, \{ question = null \} = \{\}\) \{\n\s+depuisWhatsAppEcran = false;/, "la flèche vers WhatsApp seulement pour la conversation qui en vient");
  assert.match(vue, /formatMontant\(Number\(s\.prix\), devise\(\)\)/, "prix au format de Gestion");
  assert.match(vue, /tr\("heure de pickup à fixer"\)/);
  assert.match(vue, /squelette\(3, \{ cartes: false \}\)/, "squelette pendant la lecture du fil");
});

test("barre du bas : WhatsApp a son onglet et son badge pour qui a la boîte, Réservations passe dans Plus", () => {
  const app = source("src/gestion/js/app.mjs");
  assert.match(app, /whatsappVisible\(\)\n\s+\? \["tableau", "whatsapp", agentVisible\(\) \? "agent" : null, "dossiers"/);
  assert.match(app, /const badgePlus = tous\.filter\(\(e\) => !onglets\.includes\(e\.cle\)\)/, "le badge de Plus ne compte plus WhatsApp");
});

test("clavier iPhone, texte de 13 px au moins, un seul mot « assistant »", () => {
  const css = source("src/gestion/css/app.css");
  assert.match(css, /html\.clavier \.agent-saisie, html\.clavier \.wa-prop-actions, html\.clavier \.wa-sans-reponse\.avec-bouton \{ bottom: var\(--clavier\); \}/);
  const petits = css.split("\n").filter((l) => /\.(wa|agent)-/.test(l.split("{")[0])).flatMap((l) => [...l.matchAll(/font-size: (0\.\d+)rem/g)].map((m) => Number(m[1]))).filter((n) => n < 0.8125);
  assert.deepEqual(petits, [], "aucun texte sous 13 px dans la boîte et l'Assistant");
  for (const f of ["src/gestion/js/views/whatsapp.mjs", "src/gestion/js/views/agent.mjs", "src/gestion/js/whatsapp-calc.mjs"]) {
    const textes = [...source(f).matchAll(/(?:tr|N_)\("([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(textes.filter((t) => /\bagent\b|assistante/i.test(t)), [], f);
  }
});

test("migration 65 : aperçu tenu par un déclencheur, rempli pour l'existant, retour en arrière", () => {
  const m = source("docs/gestion/migration-65-whatsapp-apercu.sql");
  assert.match(m, /add column if not exists dernier_texte text/);
  assert.match(m, /add column if not exists attend_depuis timestamptz/);
  assert.match(m, /create trigger apercu after insert or update of texte, supprime_le, statut_envoi or delete on whatsapp_messages/, "un envoi retiré (migration 64) change aussi l'aperçu");
  assert.match(m, /whatsapp_apercu\(coalesce\(new\.conversation_id, old\.conversation_id\)\)/);
  assert.match(m, /^-- Suit la 64/m);
  assert.match(m, /security definer set search_path = public, pg_temp/);
  assert.match(m, /revoke all on function whatsapp_apercu\(uuid\) from public, anon, authenticated;/);
  assert.match(m, /select whatsapp_apercu\(id\) from whatsapp_conversations;/);
  assert.doesNotMatch(m, /function whatsapp_ranger/, "la réception ne change pas");
  const r = source("docs/gestion/retour-65-whatsapp-apercu.sql");
  assert.match(r, /drop column if exists dernier_texte, drop column if exists dernier_type, drop column if exists attend_depuis/);
  const s = source("src/gestion/js/store-supabase.mjs");
  assert.match(s, /if \(r\.error && APERCU\.split\(", "\)\.some\(\(c\) => colonneAbsente\(r\.error, c\)\)\) r = await requete/, "lu sans la migration");
});
