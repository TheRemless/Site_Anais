#!/usr/bin/env node
// Jeu d'essai de l'agent (onglet « Assistant ») : chaque cas est une conversation jouée avec le vrai code de la fonction (boucle d'outils,
// outils, consignes), sur le catalogue privé sans nets du jeu d'essai (~/Desktop/Gestion-Test/eval-assistant). Rien n'est écrit en base.
//
//   node scripts/eval-agent/run.mjs --mode oracle          câblage vérifié sans dépense (réponses scriptées, doit faire 100 %)
//   node scripts/eval-agent/run.mjs --mode vide            un modèle qui ne fait rien (doit faire peu : la notation mord)
//   node scripts/eval-agent/run.mjs --mode reel [--modele claude-haiku-5-5] [--cas A01,P04] [--plafond 2]
//
// Mode réel : clé ANTHROPIC_API_KEY, sinon le trousseau macOS (service « Eval assistant Gestion », comme le jeu du lot 1). Jamais dans un fichier.
// Le coût de chaque cas est affiché ; le passage s'arrête au plafond (2 $ par défaut). Résultats dans <dossier>/resultats/agent-<date>.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { tourner } from "../../supabase/functions/agent/boucle.js";
import { consignes, contexteDuJour, coutEchange, signe, MODELE_DEFAUT } from "../../supabase/functions/agent/prompt.js";
import { memoDepuis, tempsSimule } from "../../supabase/functions/agent/outils.js";
import { noterTour, noterCasLot1 } from "./notes.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, t) => (a.startsWith("--") ? [...acc, [a.slice(2), t[i + 1] && !t[i + 1].startsWith("--") ? t[i + 1] : true]] : acc), []));
const MODE = args.mode || "oracle";
const MODELE = args.modele || MODELE_DEFAUT;
const DOSSIER = args.dossier || join(homedir(), "Desktop/Gestion-Test/eval-assistant");
const PLAFOND = Number(args.plafond) || 2;
const FILTRE = args.cas ? String(args.cas).split(",") : null;

const lire = (f) => JSON.parse(readFileSync(join(DOSSIER, f), "utf8"));
const catalogue = { partenaires: lire("catalogue/partenaires.json"), prestations: lire("catalogue/prestations.json"), trajets: lire("catalogue/trajets.json"), reglages: lire("catalogue/reglages.json") };
const ENTITE = { ztp: "00000000-0000-4000-8000-000000000001", secret: "00000000-0000-4000-8000-000000000002", taxi: "00000000-0000-4000-8000-000000000003" };
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

// Les cas : ceux de l'agent (cas-agent.json), puis les cas « agent » du jeu du lot 1 (une demande de client collée, un tour).
const cas = [
  ...lire("cas-agent.json").cas,
  ...lire("cas.json")
    .cas.filter((c) => c.agent)
    .map((c) => ({ id: c.id, entreprise: c.entreprise, aujourdhui: c.aujourdhui, routes: "aucune", lot1: c.agent, tours: [`Le client écrit : « ${c.message || (c.conversation || []).map((m) => `${m.de === "client" ? "Client" : "Nous"} : ${m.texte}`).join(" / ")} »`] })),
].filter((c) => !FILTRE || FILTRE.some((f) => c.id.startsWith(f)));

// ---- Clients ---------------------------------------------------------------------------------------------------------------------

// Un faux flux au format du SDK : un message rendu d'un coup, son texte aussi en événements.
const fauxFlux = (message) => ({
  async *[Symbol.asyncIterator]() {
    for (const b of message.content) if (b.type === "text") yield { type: "content_block_delta", delta: { type: "text_delta", text: b.text } };
  },
  finalMessage: async () => message,
});
const message = (content, stop) => ({ content, stop_reason: stop, model: "simulation", usage: { input_tokens: 0, output_tokens: 0 } });

// Oracle : rejoue le script du cas (un appel d'outil ou un texte par appel), {pickup} et {arrivee_1} pris dans le dernier planning.
function clientOracle(script, etat) {
  let i = 0;
  const remplir = (x) => JSON.parse(JSON.stringify(x).replace(/\{(pickup|arrivee_1)\}/g, (_, k) => (k === "pickup" ? etat.plan?.pickup.heure : etat.plan?.etapes[1].arrivee_prevue?.heure) || ""));
  return {
    beta: {
      messages: {
        stream: () => {
          const pas = script[i++];
          if (!pas) return fauxFlux(message([{ type: "text", text: "" }], "end_turn"));
          if (pas.texte !== undefined) return fauxFlux(message([{ type: "text", text: remplir(pas.texte) }], "end_turn"));
          return fauxFlux(message([{ type: "tool_use", id: `o${i}`, name: pas.name, input: remplir(pas.input) }], "tool_use"));
        },
      },
    },
  };
}
const clientVide = { beta: { messages: { stream: () => fauxFlux(message([{ type: "text", text: "D'accord." }], "end_turn")) } } };

function clientReel() {
  let cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) {
    try {
      cle = execFileSync("security", ["find-generic-password", "-s", "Eval assistant Gestion", "-w"], { encoding: "utf8" }).trim();
    } catch {
      /* pas de clé dans le trousseau */
    }
  }
  if (!cle) throw new Error("clé absente : ANTHROPIC_API_KEY ou trousseau « Eval assistant Gestion »");
  const req = createRequire(join(DOSSIER, "package.json"));
  const { default: Anthropic } = req("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: cle, timeout: 90_000, maxRetries: 2 });
}

// ---- Un cas -----------------------------------------------------------------------------------------------------------------------

async function jouer(c, client) {
  const e = ENTITE[c.entreprise];
  const regl = catalogue.reglages.find((r) => r.entite_id === e) || {};
  const reglages = { fonctionnement: regl.fonctionnement || "sur_mesure", assistant_voix: regl.voix || {}, agent_ia: true };
  const donnees = {
    partenaires: catalogue.partenaires.filter((p) => p.entite_id === e),
    prestations: catalogue.prestations.filter((p) => p.entite_id === e),
    trajets: catalogue.trajets.filter((t) => t.entite_id === e),
    prestations_nets: [],
    trajets_nets: [],
    hotels_lieux: c.hotels_lieux || [],
    temps_trajets: c.temps_trajets || [],
    clients: [],
    dossiers: [],
    reservations: [],
    ...(c.fixtures || {}),
  };
  const prestataires = donnees.partenaires.map((p) => p.nom).filter((n) => n && n.length > 2);
  const prenoms = [regl.responsable && regl.responsable.prenom, "Anaïs", "Nani"].filter(Boolean);
  // Ni ORS ni recherche web dans le jeu d'essai : la table du cas, et les temps de démo si le cas le demande.
  const ctx = { charger: async (n) => donnees[n] || [], reglages, ors: null, simule: c.routes === "simule" ? tempsSimule : null, estimerWeb: null, situerWeb: null, maintenant: () => Date.parse(`${c.aujourdhui}T03:00:00Z`) };
  const systeme = consignes({ entreprise: regl.nom || "", reglages, lieu: "Koh Lanta (Thaïlande)", prenomEquipe: regl.responsable ? regl.responsable.prenom : "" });
  const contexte = contexteDuJour({ aujourdhui: c.aujourdhui, jour: JOURS[new Date(`${c.aujourdhui}T12:00:00Z`).getUTCDay()], lieuCourt: "Koh Lanta" });
  const messages = [];
  const appels = [];
  const etat = { plan: null };
  const tours = [];
  for (let k = 0; k < c.tours.length; k++) {
    const texte = c.tours[k];
    messages.push({ role: "user", content: [{ type: "text", text: texte }] });
    const memo = memoDepuis(messages, { signer: signe(reglages), prestataires, entreprise: regl.nom || "", prenoms });
    const t = { outils: [], textes: "", cartes: [], plannings: [], tapes: c.tours.slice(0, k + 1).join("\n") };
    const avant = messages.length;
    const cl = MODE === "reel" ? client : MODE === "vide" ? clientVide : clientOracle((c.oracle || [])[k] || [], etat);
    const r = await tourner({
      anthropic: cl,
      modele: MODELE,
      systeme,
      contexte,
      messages,
      ctx,
      memo,
      garder: async (role, contenu) => messages.push({ role, content: contenu }),
      garderCarte: async (carte) => ({ id: `k${t.cartes.length}`, statut: "proposee", ...carte }),
      envoyer: async (ev) => {
        if (ev.t === "carte") t.cartes.push(ev.carte);
        if (ev.t === "planning") (t.plannings.push(ev.planning), (etat.plan = ev.planning));
      },
      appels,
      maintenant: () => Date.now(),
    });
    for (const m of messages.slice(avant)) for (const b of m.role === "assistant" ? m.content : []) {
      if (b.type === "tool_use") t.outils.push(b.name);
      if (b.type === "text") t.textes += `${b.text}\n`;
    }
    const note = c.lot1 ? noterCasLot1(c.lot1, t, memo) : noterTour((c.attentes || [])[k] || {}, t, memo, { prestataires, prenoms });
    tours.push({ statut: r.statut, outils: t.outils, cartes: t.cartes.map((x) => x.genre), ...note, texte: t.textes.slice(0, 1500), reponses: t.cartes.filter((x) => x.genre === "reponse").map((x) => x.donnees.message) });
  }
  const cout = coutEchange(appels);
  return { id: c.id, score: tours.reduce((s, x) => s + x.score, 0) / tours.length, cout_usd: Math.round(cout * 10000) / 10000, appels: appels.length, tours };
}

// ---- Passage ------------------------------------------------------------------------------------------------------------------------

const client = MODE === "reel" ? clientReel() : null;
const resultats = [];
let depense = 0;
for (const c of cas) {
  if (MODE === "oracle" && !c.oracle) continue;
  if (depense >= PLAFOND) {
    console.log(`Plafond de ${PLAFOND} $ atteint : arrêt avant ${c.id}.`);
    break;
  }
  try {
    const r = await jouer(c, client);
    depense += r.cout_usd;
    resultats.push(r);
    const rates = r.tours.flatMap((t, i) => Object.entries(t.verifs).filter(([, ok]) => !ok).map(([k]) => `${i + 1}:${k}`));
    console.log(`${r.score === 1 ? "✔" : "✖"} ${r.id}  ${(r.score * 100).toFixed(0)} %  ${r.cout_usd} $${rates.length ? `  raté : ${rates.join(", ")}` : ""}`);
  } catch (err) {
    console.log(`! ${c.id}  erreur : ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    resultats.push({ id: c.id, score: 0, erreur: String(err && err.message).slice(0, 200) });
  }
}
const moyenne = resultats.length ? resultats.reduce((s, r) => s + r.score, 0) / resultats.length : 0;
// Deux familles de vérifications : la compétence (outils, questions, verdict, cartes proposées) et les garde-fous (rien d'inventé, pas de
// signature ni de prestataire). Un modèle qui ne fait rien passe les garde-fous sans mérite : la compétence est le vrai score.
const GARDE = /^(heures_sourcees|aucun_montant|montants_sources|sans_remise|reponse_sans|dossier_sans_prix|aucun_depart)/;
const familles = { competence: [0, 0], garde_fous: [0, 0] };
for (const r of resultats) for (const t of r.tours || []) for (const [k, ok] of Object.entries(t.verifs)) {
  const f = familles[GARDE.test(k) ? "garde_fous" : "competence"];
  f[0] += ok ? 1 : 0;
  f[1] += 1;
}
const pct = ([a, b]) => (b ? `${((a / b) * 100).toFixed(1)} % (${a}/${b})` : "sans objet");
console.log(`\nMode ${MODE}${MODE === "reel" ? `, ${MODELE}` : ""} : ${resultats.length} cas, score moyen ${(moyenne * 100).toFixed(1)} %, compétence ${pct(familles.competence)}, garde-fous ${pct(familles.garde_fous)}, dépense ${depense.toFixed(4)} $ (${resultats.length ? (depense / resultats.length).toFixed(4) : 0} $ par cas).`);
if (MODE === "reel") {
  const dir = join(DOSSIER, "resultats");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const f = join(dir, `agent-${MODELE}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`);
  writeFileSync(f, JSON.stringify({ modele: MODELE, moyenne, depense, resultats }, null, 1));
  console.log(`Résultats : ${f}`);
}
