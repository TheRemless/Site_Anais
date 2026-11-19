#!/usr/bin/env node
// Jeu d'essai de l'assistant IA de Gestion : voir le bloc « fill these in » plus bas. Squelette repris du skill claude-api (build-eval).
// Runner scaffold for the build-eval / hillclimb loop. Copy this into the
// user's repo and fill in loadCases / runCase / gradeCase below - the I/O
// shape, file naming, resume, and CLI surface are already hillclimb-ready
// so adding v2, v3, ... is `--variant v3`, not a refactor.
//
//   node run-eval.mjs --flow .claude/hillclimb/<name> --variant baseline --reps 2
//
// Structural properties this encodes (so you don't have to remember them):
//   - parameterized by --variant / --model / --reps (no hardcoded A/B pair)
//   - rep-aware filenames + resume (traces/<id>_rep<k>.json)
//   - reads _state.json, never writes it (loop state belongs to the orchestrator) - 
//     the ONE exception is --approve-harness recording `harness_sha` (see below)
//   - refuses to run when the harness (this file + _state.json.harness_paths) has
//     changed since the sha a human last approved with --approve-harness, so a
//     round that edits the runner cannot execute unreviewed under a standing
//     session allowlist
//   - pairwise graders judge against frozen baseline/ref/<id>.* on disk
//   - writes rows as cases complete (crash-safe)
//   - jittered exponential backoff on transient 429/overloaded/5xx errors
//   - hard per-case wall-clock ceiling (--timeout-s; stream keepalives don't reset it)
//   - served-model assertion (response model must match --model; documented alias->snapshot
//     shapes tolerated: 'foo-latest'/'foo-0'/'foo' -> 'foo-20250101' / 'foo@20250101' / 'foo-2025-01-01')
//   - failed attempts land in errors.jsonl with a failure class and, when the call
//     completed, the billed model/usage (never in results.jsonl)
//   - row ids, trace filenames, and frozen refs share one path-safe id
//     (original id kept in meta.original_id when sanitization changed it)

import { createHash } from 'node:crypto';
import { closeSync, constants as FS, existsSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every output write refuses symlinks: the flow dir is model-influenced, and a
// prompt-injected round can plant `results.jsonl -> ~/.bashrc` where the next
// unattended run would append. POSIX opens O_NOFOLLOW (a symlink fails with
// ELOOP); Windows - where Node leaves O_NOFOLLOW undefined and Bun defines a
// meaningless value - lstat-refuses first. Symlinked parent dirs are
// refused the same way. Same discipline as the report builders' reads.
const WIN = process.platform === 'win32';
const NOFOLLOW = WIN ? 0 : FS.O_NOFOLLOW;
// A guard that cannot tell must refuse: only "no such entry" reads as absent;
// any other lstat failure (EACCES, ENAMETOOLONG, ...) is rethrown, never "no".
const lstatOrNull = p => { try { return lstatSync(p); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; } };
const isSymlink = p => lstatOrNull(p)?.isSymbolicLink() === true;
// Stderr lines interpolate model-influenced bytes (case ids, error text that
// can echo model output, JSON.parse messages). Strip escape sequences and
// control characters, as build-report-lite.mjs's eprint does, so a planted
// OSC/CSI can't retitle the terminal or forge output lines.
const ESC_SEQ = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]/g;
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;
const termSafe = s => String(s).replace(ESC_SEQ, '').replace(CONTROL, '');
const eprint = (...a) => console.error(...a.map(termSafe));
// The leaf checks above can't see a symlink on an INTERMEDIATE component
// (lstat and open both resolve those silently), so every open is also bound
// to the flow root: main() captures realpathSync(flow) once, and any path
// whose resolved parent leaves it - e.g. `vdir` or the flow dir itself
// replaced by a directory symlink - is refused when the check sees it.
// Residual, all platforms: the check and the open are separate path lookups
// (Node's sync fs has no openat-style call), so a directory swapped for a
// symlink in between is still followed. This stops a planted link, not a
// writer racing the run.
let flowRealRoot = null;
function assertInFlow(dir, what) {
  if (flowRealRoot == null) throw new Error(`refusing to ${what}: flow root not resolved yet`);
  const dirReal = realpathSync(dir);
  if (dirReal !== flowRealRoot && !dirReal.startsWith(flowRealRoot + (WIN ? '\\' : '/')))
    throw new Error(`refusing to ${what}: ${dir} resolves outside the flow directory`);
}
function openNoFollow(p, flags) {
  if (isSymlink(dirname(p))) throw new Error(`refusing to open through symlinked directory: ${dirname(p)}`);
  assertInFlow(dirname(p), 'open');
  if (WIN && isSymlink(p)) throw new Error(`refusing to open through symlink: ${p}`);
  const fd = openSync(p, flags | NOFOLLOW, 0o644);
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error(`refusing to use non-regular file: ${p}`);
    // O_NOFOLLOW and lstat cannot see a hard link: a second name for a file
    // outside the flow dir opens as an ordinary regular file. Nothing the
    // runner creates has more than one link, so refuse any that does.
    if (st.nlink > 1) throw new Error(`refusing to use ${p}: it has a second hard link (another name for the same file); replace it with a plain copy if it is yours`);
  } catch (e) { closeSync(fd); throw e; }
  return fd;
}
// writeFileSync on the fd loops until every byte lands (a bare writeSync is
// one write(2) that may return short on ENOSPC and silently truncate a
// results row or trace).
// Opened without O_TRUNC and truncated only after openNoFollow's checks, so a
// refused file keeps its bytes.
function writeFileNoFollow(p, data) {
  const fd = openNoFollow(p, FS.O_WRONLY | FS.O_CREAT);
  try { ftruncateSync(fd, 0); writeFileSync(fd, data); } finally { closeSync(fd); }
}
// POSIX appends atomically under O_APPEND with no position. On Windows, Bun
// writes an O_APPEND handle at offset 0 unless given a position, so there the
// write starts at the current size and re-issues any short write.
function appendFileNoFollow(p, data) {
  const fd = openNoFollow(p, FS.O_WRONLY | FS.O_CREAT | FS.O_APPEND);
  try {
    if (!WIN) { writeFileSync(fd, data); return; }
    const buf = Buffer.from(data);
    const start = fstatSync(fd).size;
    for (let off = 0; off < buf.length;) {
      const n = writeSync(fd, buf, off, buf.length - off, start + off);
      if (n <= 0) throw new Error(`append to ${p} made no progress`);
      off += n;
    }
  } finally { closeSync(fd); }
}
// Reads of the frozen pairwise refs get the same discipline as writes (same
// open guard): the flow dir is model-influenced, so `baseline/ref/<id> ->
// ~/.ssh/id_rsa` planted after the startup preflight must not be read into
// the judge prompt. lexists probes with lstat so a planted symlink still
// counts as "present" at the freeze guard (never overwritten - or followed).
const lexists = p => lstatOrNull(p) != null;
function readFileNoFollow(p) {
  const fd = openNoFollow(p, FS.O_RDONLY);
  try { return readFileSync(fd, 'utf8'); } finally { closeSync(fd); }
}
// null when the file is absent; any other failure (a planted link included) throws.
function readIfPresent(p) {
  try { return readFileNoFollow(p); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
}
function mkdirNoFollow(dir) {
  if (isSymlink(dir)) throw new Error(`refusing to use symlinked directory: ${dir}`);
  mkdirSync(dir, { recursive: true });
  // Check after creating: mkdirSync(recursive) follows symlinked ancestors,
  // so a dir minted through one resolves outside the flow root and is refused
  // here before any file lands in it.
  assertInFlow(dir, 'create directory');
}
// Frozen pairwise refs may carry an extension; reader and freeze-guard probe
// the same list so a suffixed ref never gets an extensionless shadow.
const REF_EXTS = ['', '.html', '.txt', '.json'];

// --- fill these in ----------------------------------------------------------
// Jeu d'essai de l'assistant IA de Gestion (20.11.2026). Chaque ligne = un cas × un usage (lire, itineraire, repondre_itineraire, rediger,
// trier). Le script appelle Claude avec EXACTEMENT les paramètres que la fonction « assistant » construit (mêmes prompts, schémas, modèle,
// effort, contrôles : calc.js, itineraire.js, trier.js) ; seuls la session, le journal et la lecture de la base sont remplacés par le jeu
// privé et sa copie du catalogue (sans aucun net). Le jeu, le catalogue, la clé et les résultats restent hors du dépôt :
//   EVAL_DIR (défaut ~/Desktop/Gestion-Test/eval-assistant) : cas.json, catalogue/*.json, node_modules/@anthropic-ai/sdk.
//   Clé : ANTHROPIC_API_KEY, sinon le trousseau macOS (service « Eval assistant Gestion »). Jamais dans un fichier.
//   node scripts/eval-assistant/run-eval.mjs --flow "$EVAL_DIR/resultats" --variant baseline [--usages trier,lire] [--cas R01,M02]
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { MODELE, construireCatalogue, promptLecture, SCHEMA_LECTURE, parametresAppel, lireReponse, validerLecture, reglagesAssistant, verifierFaits, promptRedaction, SCHEMA_REDACTION, validerRedaction, langueReponse, USAGES } from '../../supabase/functions/assistant/calc.js';
import { promptItineraire, SCHEMA_ITINERAIRE, validerItineraire, verifierFaitsItineraire, promptReponseItineraire, SCHEMA_REPONSE_ITINERAIRE, validerReponseItineraire } from '../../supabase/functions/assistant/itineraire.js';
// L'usage « trier » n'existe que sur la branche de la porte d'entrée (gardée de côté le 19.11.2026, le tri ira à l'agent conversationnel) :
// sans trier.js, ces lignes sont sautées.
const TRIER = await import('../../supabase/functions/assistant/trier.js').catch(() => null);
import { trajetsEntreEtapes, departsDuTrajet, faitsReponse } from '../../src/gestion/js/itineraire-calc.mjs';
import { offreDepuisBase, faitsPourReponse } from '../../src/gestion/js/assistant-calc.mjs';
import { noterLire, noterItineraire, noterReponse, noterTrier } from './notes.mjs';

const EVAL_DIR = process.env.EVAL_DIR || join(os.homedir(), 'Desktop', 'Gestion-Test', 'eval-assistant');
const ENTITES = { ztp: '00000000-0000-4000-8000-000000000001', secret: '00000000-0000-4000-8000-000000000002', taxi: '00000000-0000-4000-8000-000000000003' };
export const USAGES_EVAL = ['trier', 'lire', 'itineraire', 'repondre_itineraire', 'rediger'];
// « rediger » est retiré de la fonction depuis le 19.11.2026 : ses réglages d'avant (effort medium, 16 000 jetons) servent ici.
const REGLAGE_REDIGER = { effort: 'medium', maxTokens: 16000 };
const optionListe = (nom) => { const i = process.argv.indexOf(nom); if (i < 0) return null; const v = process.argv[i + 1]; process.argv.splice(i, 2); return String(v || '').split(',').map((x) => x.trim()).filter(Boolean); };
const FILTRE_USAGES = optionListe('--usages');
const FILTRE_CAS = optionListe('--cas');
// Vérification du câblage sans appel payant : « oracle » rend la réponse attendue, « vide » une réponse vide (doit donner environ 100 % et 0 %).
const SIMULATION = (optionListe('--simulation') || [])[0] || '';

let donnees = null;
function chargerDonnees() {
  if (donnees) return donnees;
  const lire = (f) => JSON.parse(readFileSync(join(EVAL_DIR, f), 'utf8'));
  const cat = { prestations: lire('catalogue/prestations.json'), trajets: lire('catalogue/trajets.json'), partenaires: lire('catalogue/partenaires.json'), reglages: lire('catalogue/reglages.json') };
  // La base renvoie les montants en texte (numeric) : l'outil les lit en nombres.
  for (const t of cat.trajets) for (const k of ['prix_adulte', 'prix_enfant']) if (t[k] !== null && t[k] !== undefined) t[k] = Number(t[k]);
  for (const p of cat.prestations) if (p.prix_vente !== null && p.prix_vente !== undefined) p.prix_vente = Number(p.prix_vente);
  donnees = { cas: lire('cas.json').cas, ...cat };
  return donnees;
}
// Ce que la fonction lit pour une entreprise, avec la session d'une personne de cette entreprise.
function entreprise(cle) {
  const d = chargerDonnees();
  const id = ENTITES[cle];
  const r = d.reglages.find((x) => x.entite_id === id) || {};
  const de = (l) => l.filter((x) => x.entite_id === id);
  const partenaires = de(d.partenaires);
  return { id, nom: r.nom || '', reglages: { assistant_voix: r.voix || {}, responsable: r.responsable || {}, fonctionnement: r.fonctionnement || null, devise: r.devise || 'THB' }, prestations: de(d.prestations), trajets: de(d.trajets), partenaires, nomPartenaire: (pid) => (partenaires.find((p) => p.id === pid) || {}).nom || '' };
}

/** Return the list of input cases. Each must have a stable `id`. */
async function loadCases() {
  const { cas } = chargerDonnees();
  const out = [];
  for (const c of cas) {
    if (FILTRE_CAS && !FILTRE_CAS.some((f) => c.id.startsWith(f))) continue;
    const usages = [...(TRIER && USAGES.trier ? ['trier'] : []), ...(c.lire ? ['lire'] : []), ...(c.itineraire ? ['itineraire', 'repondre_itineraire'] : []), ...(c.rediger ? ['rediger'] : [])];
    for (const usage of usages) {
      if (FILTRE_USAGES && !FILTRE_USAGES.includes(usage)) continue;
      out.push({ id: `${usage}__${c.id}`, usage, cas: c, prompt: c.message, tags: [usage, c.entreprise, c.source, c.type[0]], meta: { cas: c.id } });
    }
  }
  return out;
}

let client = null;
async function anthropic() {
  if (client) return client;
  let cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) {
    try { cle = execFileSync('security', ['find-generic-password', '-s', 'Eval assistant Gestion', '-w'], { encoding: 'utf8' }).trim(); } catch { /* absente */ }
  }
  if (cle && !/^sk-ant-/.test(cle)) throw Object.assign(new Error('la clé rangée ne ressemble pas à une clé API Anthropic (sk-ant-…) : à refaire dans le trousseau'), { failure_class: 'harness' });
  if (!cle) throw Object.assign(new Error('clé absente : ANTHROPIC_API_KEY ou trousseau « Eval assistant Gestion »'), { failure_class: 'harness' });
  const req = createRequire(join(EVAL_DIR, 'package.json'));
  const { default: Anthropic } = await import(req.resolve('@anthropic-ai/sdk'));
  // Adresse officielle imposée : une variable ANTHROPIC_BASE_URL de l'environnement (proxy d'un outil) ne doit jamais recevoir la clé.
  client = new Anthropic({ apiKey: cle, baseURL: 'https://api.anthropic.com', timeout: 65_000, maxRetries: 0 });
  return client;
}

// Faits envoyés pour rédiger la réponse d'un itinéraire : les étapes attendues (lieux déjà situés), les trajets du catalogue, sans nets
// (comme pour une personne sans le droit « nets » : tous les horaires, sans classement), les noms des compagnies retirés.
function faitsItineraire(c, e) {
  const it = c.itineraire;
  const legs = trajetsEntreEtapes(it.etapes.map((x) => ({ hotel: x.hotel, du: x.du, au: x.au, lieu: x.lieu })));
  const propositions = legs.map((leg) => ({ leg, departs: departsDuTrajet(leg, { trajets: e.trajets, partenaires: e.partenaires, netDe: () => null, nomPartenaire: e.nomPartenaire, adultes: it.adultes, enfants: it.enfants }) }));
  return faitsReponse({ itineraire: { prenom: it.prenom, adultes: it.adultes, enfants: it.enfants, bebes: 0 }, propositions, devise: e.reglages.devise, langue: it.langue === 'fr' ? 'fr' : 'en', compagnies: e.partenaires.map((p) => p.nom) });
}
// Faits pour la rédaction générale (retirée) : chaque service attendu avec la première ligne du catalogue qui correspond, prix de la base.
function faitsRediger(c, e) {
  const services = c.lire.services.map((a) => {
    const motif = (Array.isArray(a.catalogue) ? a.catalogue : []).find((x) => typeof x === 'object');
    const ligne = motif && e.prestations.find((p) => p.actif !== false && !['option', 'frais'].includes(p.famille) && !p.sur_place && !['ch', 'sup'].includes(p.unite) && (!motif.libelle || `${p.libelle_en || ''} ${p.libelle || ''}`.includes(motif.libelle)) && (!motif.groupe || (p.groupe || '').includes(motif.groupe)));
    const adultes = Array.isArray(a.adultes) ? a.adultes[0] : a.adultes;
    const offre = ligne ? offreDepuisBase({ genre: 'prestation', id: ligne.id }, { adultes, enfants: a.enfants }, e) : null;
    return { date: a.date[0], heure: a.heure[0], adultes, enfants: a.enfants, offres: offre ? [offre] : [] };
  });
  return faitsPourReponse({ d: { nom: c.lire.client.nom, bebes: c.lire.client.bebes, hotel: c.lire.client.hotel[0] }, services, entreprise: e.nom, devise: e.reglages.devise });
}

// Les paramètres de l'appel et la façon de contrôler la réponse, construits comme dans index.ts.
function preparer(input, modele) {
  const c = input.cas;
  const e = entreprise(c.entreprise);
  const ra = reglagesAssistant(e.reglages);
  const aujourdhui = c.aujourdhui;
  const message = c.message;
  switch (input.usage) {
    case 'trier':
      return { parametres: parametresAppel('trier', TRIER.promptTrier({ aujourdhui, message, lieu: ra.lieu }), TRIER.SCHEMA_TRIER, modele), valider: (v) => TRIER.validerTrier(v, { message }) };
    case 'lire': {
      const catalogue = construireCatalogue(e);
      return { e, refs: catalogue.refs, parametres: parametresAppel('lire', promptLecture({ entreprise: e.nom, catalogue: catalogue.texte, aujourdhui, message, lieu: ra.lieu, responsable: ra.responsable }), SCHEMA_LECTURE, modele), valider: (v) => validerLecture(v, { refs: catalogue.refs, message, aujourdhui }) };
    }
    case 'itineraire':
      return { parametres: parametresAppel('itineraire', promptItineraire({ aujourdhui, message, lieu: ra.lieu }), SCHEMA_ITINERAIRE, modele), valider: (v) => validerItineraire(v, { message, aujourdhui }) };
    case 'repondre_itineraire': {
      const f = verifierFaitsItineraire(faitsItineraire(c, e));
      if (!f.ok) throw Object.assign(new Error(`faits refusés : ${f.erreur}`), { failure_class: 'harness' });
      return { e, faits: f.faits, parametres: parametresAppel('repondre_itineraire', promptReponseItineraire({ faits: f.faits, voix: ra.voix, entreprise: e.nom }), SCHEMA_REPONSE_ITINERAIRE, modele), valider: (v) => validerReponseItineraire(v, f.faits, { entreprise: e.nom }) };
    }
    case 'rediger': {
      const f = verifierFaits(faitsRediger(c, e));
      if (!f.ok) throw Object.assign(new Error(`faits refusés : ${f.erreur}`), { failure_class: 'harness' });
      const langue = langueReponse(e.reglages, c.lire.client.langue);
      const p = promptRedaction({ faits: f.faits, langue, voix: ra.voix, responsable: ra.responsable, entreprise: e.nom, messageClient: message });
      const parametres = { ...parametresAppel('lire', p, SCHEMA_REDACTION, modele), max_tokens: REGLAGE_REDIGER.maxTokens, output_config: { effort: REGLAGE_REDIGER.effort, format: { type: 'json_schema', schema: SCHEMA_REDACTION } } };
      return { e, faits: f.faits, langue, parametres, valider: (v) => validerRedaction(v, f.faits) };
    }
  }
  throw new Error(`usage inconnu : ${input.usage}`);
}

async function runCase(input, ctx) {
  const modele = ctx.model || MODELE;
  const prep = preparer(input, modele);
  const res = SIMULATION ? simuler(input, prep, SIMULATION, modele) : await (await anthropic()).beta.messages.create(prep.parametres);
  const lu = lireReponse(res);
  const valide = lu.ok ? prep.valider(lu.valeur) : null;
  const sys = prep.parametres.system.map((b) => b.text).join('\n\n');
  // Le catalogue (environ 30 000 jetons chez Secret) n'est pas recopié dans chaque trace : on garde ses premières lignes.
  const sysCourt = sys.length > 6000 ? `${sys.slice(0, 6000)}\n… (${sys.length - 6000} caractères de catalogue coupés)` : sys;
  const texte = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return {
    output: texte,
    brut: lu.ok ? lu.valeur : null,
    lecture: lu,
    valide,
    prep,
    model: res.model, usage: res.usage, stop_reason: res.stop_reason,
    status: res.stop_reason === 'max_tokens' ? 'truncated' : res.stop_reason === 'refusal' ? 'refused' : 'ok',
    transcript: [
      { role: 'system', content: sysCourt },
      { role: 'user', content: typeof prep.parametres.messages[0].content === 'string' ? prep.parametres.messages[0].content : JSON.stringify(prep.parametres.messages[0].content) },
      { role: 'assistant', content: texte },
      { role: 'tool_result', content: `Après les contrôles de la fonction :\n${JSON.stringify(valide, null, 2)}` },
    ],
  };
}


// ---- Simulation (oracle / vide) -----------------------------------------------------------------------------------------------------
const hm = (h) => h;
function oracle(input, prep) {
  const c = input.cas;
  if (input.usage === 'trier') return { types: [c.type[0]], certitude: 'haute', nom: c.nom || '', telephone: '', date_service: c.date_service || '', nouveau: c.changement || { date: '', heure: '', adultes: 0, enfants: 0 }, resume: 'Simulation.' };
  if (input.usage === 'itineraire') {
    const it = c.itineraire;
    return { prenom: it.prenom, langue: it.langue, adultes: it.adultes, enfants: it.enfants, ages_enfants: [], bebes: 0, etapes: it.etapes.map((x) => ({ hotel: x.hotel, lieu_ecrit: x.lieu_ecrit || '', du: x.du, au: x.au })), remarques: '' };
  }
  if (input.usage === 'lire') {
    const l = c.lire;
    const e = prep.e;
    const refDe = (motifs) => {
      for (const m of motifs) {
        if (typeof m !== 'object') continue;
        for (const [ref, o] of prep.refs) {
          const ligne = o.genre === 'trajet' ? e.trajets.find((t) => t.id === o.id) : e.prestations.find((p) => p.id === o.id);
          const libelle = o.genre === 'trajet' ? `${ligne.de} → ${ligne.vers}` : `${ligne.libelle_en || ''} | ${ligne.libelle || ''}`;
          const groupe = o.genre === 'trajet' ? ligne.mode || '' : ligne.groupe || '';
          if ((!m.libelle || libelle.toLowerCase().includes(m.libelle.toLowerCase())) && (!m.groupe || groupe.toLowerCase().includes(m.groupe.toLowerCase()))) return ref;
        }
      }
      return '';
    };
    return {
      nom: l.client.nom, telephone: l.client.telephone, hotel: l.client.hotel[0], langue: l.client.langue, adultes: l.client.adultes, enfants: l.client.enfants, ages_enfants: [], bebes: l.client.bebes,
      services: l.services.map((a) => {
        const hors = a.catalogue[0] === 'hors_catalogue';
        return { texte: 'x', date: a.date[0], heure: a.heure[0], adultes: Array.isArray(a.adultes) ? a.adultes[0] : a.adultes, enfants: a.enfants, de: hors ? 'A' : '', vers: hors ? 'B' : '', prive: true, hors_catalogue: hors, ref: hors ? '' : refDe(a.catalogue), alternatives: [], confiance: 'haute' };
      }),
      remarques: '',
    };
  }
  const f = prep.faits;
  const en = (input.usage === 'rediger' ? prep.langue : f.langue) === 'en';
  const lignes = input.usage === 'rediger'
    ? f.services.map((s) => `→ ${s.libelle}, ${s.date}: ${s.prix === null ? '' : `${s.prix} THB`}`)
    : f.trajets.map((t) => `→ ${t.date}, ${t.de} → ${t.vers}: ${t.horaires.map((h) => h.depart).join(' / ')} ${t.prix_adulte === null ? '' : `${t.prix_adulte} THB`}${f.enfants && t.prix_enfant !== null ? `, ${t.prix_enfant} THB` : ''}`);
  return { message: [en ? 'Hello, thank you for your message.' : 'Bonjour, merci pour votre message.', ...lignes, en ? 'Tell us which times you prefer.' : 'Dites-nous les horaires que vous préférez.'].join('\n'), prix_cites: [], manques: [] };
}
function simuler(input, prep, mode, modele) {
  const vide = { trier: { types: ['autre'], certitude: 'basse', nom: '', telephone: '', date_service: '', nouveau: { date: '', heure: '', adultes: 0, enfants: 0 }, resume: '' }, lire: { nom: '', telephone: '', hotel: '', langue: 'autre', adultes: 0, enfants: 0, ages_enfants: [], bebes: 0, services: [], remarques: '' }, itineraire: { prenom: '', langue: 'autre', adultes: 0, enfants: 0, ages_enfants: [], bebes: 0, etapes: [], remarques: '' }, repondre_itineraire: { message: 'Ok.', prix_cites: [], manques: [] }, rediger: { message: 'Ok.', prix_cites: [], manques: [] } };
  const v = mode === 'oracle' ? oracle(input, prep) : vide[input.usage];
  return { model: modele, stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'text', text: JSON.stringify(v) }] };
}

const MOTS_SIGNATURE = ['Nani', 'Anaïs', 'Anais'];
async function gradeCase(input, run) {
  const c = input.cas;
  if (!run.lecture.ok || !run.valide || run.valide.ok === false) return { grade: { exact: 0, score: 0 }, explanation: { exact: `réponse inutilisable : ${run.lecture.statut || (run.valide && run.valide.statut) || 'invalide'}` } };
  const e = run.prep.e;
  let n;
  if (input.usage === 'trier') n = noterTrier(run.valide.tri, c);
  else if (input.usage === 'lire') n = noterLire(run.valide.proposition, c.lire, { prestations: e.prestations, trajets: e.trajets });
  else if (input.usage === 'itineraire') n = noterItineraire(run.valide.itineraire, c.itineraire);
  else {
    const faits = run.prep.faits;
    const compagnies = e.partenaires.map((p) => p.nom).filter((x) => x && x !== e.nom);
    const sansSignature = c.entreprise !== 'ztp';
    const prix = input.usage === 'rediger' ? faits.services.map((s) => s.prix).filter((x) => x !== null) : faits.trajets.flatMap((t) => [t.prix_adulte, ...(faits.enfants ? [t.prix_enfant] : [])]).filter((x) => x !== null && x !== undefined);
    const heures = input.usage === 'rediger' ? [] : faits.trajets.flatMap((t) => t.horaires.map((h) => h.depart));
    n = noterReponse(run.brut.message, run.valide, { prix, heures, langue: input.usage === 'rediger' ? run.prep.langue : faits.langue, signature_interdite: sansSignature, entreprise: e.nom, compagnies, interdits: sansSignature ? MOTS_SIGNATURE : [] });
  }
  return { grade: n.grade, explanation: { exact: n.rates.length ? `raté : ${n.rates.join(', ')}` : 'tout juste' } };
}

/** Side-channel perf fields beyond the built-ins (latency_s etc.). */
function perfFrom(run) { return {}; }

// --- harness (you usually won't need to touch below this line) --------------

function parseArgs(argv) {
  const a = { flow: '.claude/hillclimb/flow', variant: 'baseline',
              model: MODELE, reps: 1, concurrency: 4, timeoutS: 1800,
              approveHarness: false };
  // A flag at the end of argv would otherwise consume undefined - which for
  // --model equals the default and silently disables the served-model check.
  const val = (i) => { if (argv[i] === undefined) { eprint(`missing value for ${argv[i - 1]}`); usage(); process.exit(2); } return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--flow') a.flow = val(++i);
    else if (k === '--variant') a.variant = val(++i);
    else if (k === '--model') a.model = val(++i);
    else if (k === '--reps') a.reps = +val(++i);
    else if (k === '--concurrency') a.concurrency = +val(++i);
    else if (k === '--timeout-s') a.timeoutS = +val(++i);
    else if (k === '--approve-harness') a.approveHarness = true;
    else if (k === '-h' || k === '--help') { usage(); process.exit(0); }
    else { eprint(`unknown argument: ${k}`); usage(); process.exit(2); }
  }
  if (!/^(baseline|v[1-9]\d*)$/.test(a.variant)) {
    // The report only reads directories named 'baseline' or 'v<N>' - any other
    // name runs to completion but spends the pass into a directory the Summary,
    // trajectory, and budget arithmetic never see.
    eprint(`--variant must be 'baseline' or 'v<N>', got '${a.variant}'`);
    usage(); process.exit(2);
  }
  if (!Number.isFinite(a.timeoutS) || a.timeoutS < 0
      || a.timeoutS * 1000 > 2147483647 // setTimeout clamps >2^31-1 ms to 1 ms - the ceiling would fire instantly
      || !Number.isInteger(a.reps) || a.reps < 1
      || !Number.isInteger(a.concurrency) || a.concurrency < 1) { usage(); process.exit(2); }
  return a;
}
function usage() {
  eprint('usage: node run-eval.mjs --flow DIR --variant ID [--model ID] [--reps N] [--concurrency N] [--timeout-s N (0 = no ceiling)] [--approve-harness]');
}

// Harness integrity gate. The hillclimb loop gets this runner command
// allowlisted for the session and then runs rounds unattended, while the
// per-round change (proposed by an analyzer fed untrusted transcripts) may
// legitimately edit harness code. Without this gate a round that rewrites the
// runner would execute attacker-chosen code on the next unattended run under
// the user's one-time approval. So: sha256 over this file, any lockfile
// beside it or in the directory the runner is invoked from (dependency drift
// is harness drift too; with neither, a note says so), plus
// every path in `_state.json.harness_paths` (relative to the directory the
// runner is invoked from, i.e. the repo root); compare to
// `_state.json.harness_sha`; refuse on absent/mismatch unless a human passes
// --approve-harness, which records the new sha. That write is the one
// sanctioned exception to "never write _state.json".
//
// Scope, stated plainly: this is a change detector, not a security boundary.
// The sha, the path list and this file all live where the loop agent can
// write, so an agent that is already prompt-injected can forge the record or
// pass --approve-harness itself. What it catches is the common case - a
// round's harness edit reaching an unattended run unreviewed - and what
// actually bounds an unattended run is the permission allowlist the user
// grants the runner command (scope it to this exact command line, not a
// prefix). Installed dependencies beyond the lockfile are outside the digest.
function checkHarness(statePath, st, approve) {
  const self = fileURLToPath(import.meta.url);
  const listed = Array.isArray(st.harness_paths) ? st.harness_paths.map(String) : [];
  const lockfiles = [...new Set([dirname(self), process.cwd()].flatMap(d =>
    ['package-lock.json', 'bun.lock', 'bun.lockb', 'yarn.lock', 'pnpm-lock.yaml'].map(f => join(d, f))))]
    .filter(f => existsSync(f));
  const paths = [...new Set([self, ...lockfiles, ...listed.map(p => resolve(p))])].sort();
  const h = createHash('sha256');
  const hashed = [];
  for (const p of paths) {
    let buf;
    try { buf = readFileSync(p); }
    catch (e) {
      if (p === self) throw e;
      eprint(`warning: harness path '${relative(process.cwd(), p)}' not readable (${e?.code || 'error'}) - skipped`);
      continue;
    }
    h.update(relative(process.cwd(), p)).update('\0').update(buf).update('\0');
    hashed.push(relative(process.cwd(), p));
  }
  const sha = h.digest('hex');
  if (st.harness_sha === sha) return;
  // Said only here, where a person is about to approve or is being refused.
  if (!lockfiles.length) eprint('note: no lockfile beside the runner or in the current directory - dependency changes are outside the harness sha');
  if (approve) {
    st.harness_sha = sha;
    writeFileNoFollow(statePath, JSON.stringify(st, null, 2) + '\n');
    eprint(`harness approved: sha256 ${sha.slice(0, 12)} over ${hashed.length} file(s) recorded in ${statePath}`);
    return;
  }
  if (st.harness_sha == null) {
    eprint(`no approved harness sha in ${statePath} (computed ${sha.slice(0, 12)} over: ${hashed.join(', ')}).`);
    eprint('Review the harness, then run once with --approve-harness to record it.');
  } else {
    eprint(`harness changed since last approved run (files: ${hashed.join(', ')}); `
      + `approved ${String(st.harness_sha).slice(0, 12)}, now ${sha.slice(0, 12)}.`);
    eprint('Re-run with --approve-harness after reviewing the diff.');
  }
  process.exit(2);
}

// Transient provider errors (429 / overloaded / 5xx) retry with jittered
// exponential backoff - a zero-delay retry loop multiplies cost invisibly
// under rate limits and can turn one transient 429 into a torn-down batch.
// The attempt count lands in the row's meta (or the errors sidecar) so retry
// churn is visible in the data, not just the bill.
async function withBackoff(fn, retry, deadline = Infinity, tries = 5) {
  for (let attempt = 0; ; attempt++) {
    // Checked before every attempt, not just before sleeps: once the case's
    // ceiling has passed, an abandoned chain must not issue another call
    // (e.g. a judge call after the app call consumed the whole ceiling).
    if (Date.now() >= deadline) {
      const e = new Error('wall-clock ceiling exceeded before attempt');
      e.failure_class = 'timeout';
      throw e;
    }
    try { return await fn(); } catch (e) {
      const status = e?.status ?? e?.response?.status;
      const transient = status === 429 || status === 529 || (status >= 500 && status < 600)
        || /overloaded|rate.?limit/i.test(String(e?.message ?? ''));
      if (!transient || attempt >= tries - 1) throw e;
      const delay = Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random());
      // Never start a retry that would outlive the case's wall-clock ceiling - 
      // otherwise an abandoned chain keeps issuing API calls after the case failed.
      if (Date.now() + delay >= deadline) throw e;
      retry.count++;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Hard per-case wall-clock ceiling, independent of stream liveness - a hung
// SSE stream can emit keepalives forever, defeating inactivity-based timers.
// The underlying call may keep running; the case fails and the slot is freed.
function withTimeout(promise, seconds, label) {
  if (!(seconds > 0)) return promise;
  let timer;
  const ceiling = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`${label}: exceeded ${seconds}s wall-clock ceiling`);
      e.failure_class = 'timeout';
      reject(e);
    }, seconds * 1000);
  });
  return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer));
}

// Case ids appear in file paths AND as the row/file join key the report uses,
// so rows, trace filenames, and frozen refs all carry the same path-safe id.
// When sanitization changes the id, a short content hash keeps distinct ids
// distinct ('case/1' vs 'case_1'); the original rides in meta.original_id.
function pathSafeId(id) {
  const raw = String(id);
  const cleaned = raw.replace(/[^\w.-]/g, '_');
  // Idempotent by construction: anything already path-safe and within the
  // length bound - including this function's own truncated+suffixed output - 
  // passes through unchanged. Long ids (URLs, prompt text as id) truncate to
  // 120 chars plus an 8-hex hash of the full original, so they fail here, not
  // at the trace write after the spend, and distinct ids stay distinct.
  if (cleaned === raw && raw.length <= 129) return raw;
  return `${cleaned.slice(0, 120)}-${createHash('sha256').update(raw).digest('hex').slice(0, 8)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // lstat("link/") follows the final symlink, so a trailing separator on
  // --flow would blind every leaf isSymlink check below - strip it first.
  // Only Windows treats `\` as a separator; on POSIX it is a filename byte, so
  // splitting on it would walk prefixes that are not real path components.
  args.flow = args.flow.replace(WIN ? /(.)[\\/]+$/ : /(.)\/+$/, '$1');
  const flowSegments = args.flow.split(WIN ? /[\\/]/ : '/');
  // A `.`/`..` segment (e.g. a trailing `/.`) makes isSymlink(args.flow) below
  // resolve a different final component than the named dir - following a
  // planted link at the flow root - while join() collapses it and the absolute
  // branch skips the ancestor walk. Refuse dot segments outright
  // (absolute --flow stays supported).
  if (flowSegments.some(seg => seg === '.' || seg === '..')) {
    eprint(`refusing to run: --flow must not contain '.' or '..' segments, got '${args.flow}'`);
    process.exit(2);
  }
  const vdir = join(args.flow, args.variant);
  // Preflight every output path before the first model call: a planted
  // symlink would otherwise fail each case after its (billed) run.
  for (const p of [args.flow, join(args.flow, 'baseline'), vdir, join(vdir, 'traces'),
                   join(vdir, 'results.jsonl'), join(vdir, 'errors.jsonl'),
                   join(vdir, 'progress.txt'), join(args.flow, 'baseline', 'ref'), join(args.flow, '_state.json')])
    if (isSymlink(p)) { eprint(`refusing to run: ${p} is a symlink (the flow dir must hold regular files)`); process.exit(2); }
  // A relative --flow (the documented `.claude/hillclimb/<name>` layout) is
  // also lstat-walked component by component from the cwd: a pre-planted
  // link at an ancestor (`.claude/hillclimb -> elsewhere`) would otherwise
  // relocate the root capture below - the containment anchor itself - to the
  // attacker's target. An absolute --flow is the caller's own trust decision
  // and is not walked (an absolute ancestor link can be legitimate: /tmp on
  // macOS).
  if (!isAbsolute(args.flow)) {
    let walk = '';
    for (const part of flowSegments.filter(Boolean).slice(0, -1)) {
      walk = walk ? join(walk, part) : part;
      if (isSymlink(walk)) { eprint(`refusing to run: ${walk} is a symlink (ancestor of --flow)`); process.exit(2); }
    }
  }
  // Every later open/mkdir is bound to this resolved root (see assertInFlow):
  // create the flow dir when fresh (the preflight above refused a link at it
  // and, for a relative path, at every ancestor), then capture where it
  // really resolves.
  mkdirSync(args.flow, { recursive: true });
  flowRealRoot = realpathSync(args.flow);
  mkdirNoFollow(join(vdir, 'traces'));
  // _state.json is READ-ONLY here. The orchestrator owns it. Absent is fine
  // (a baseline-only run has no loop state yet), but present-and-unparsable
  // must not let the id-space gate below pass vacuously over a corrupt file.
  const statePath = join(args.flow, '_state.json');
  let st = {};
  // Read through the no-follow opener like every other flow-dir file; the
  // parse message is not echoed (it can quote the file's first bytes).
  const stateText = readIfPresent(statePath);
  if (stateText != null) {
    try { st = JSON.parse(stateText) || {}; }
    catch { eprint(`${statePath} exists but is not valid JSON - fix it before spending a pass`); process.exit(2); }
  }
  checkHarness(statePath, st, args.approveHarness);
  const ctx = { ...args, state: st };

  // Resume: which (id, rep) pairs already have a row?
  const resultsPath = join(vdir, 'results.jsonl');
  const done = new Set();
  for (const ln of (readIfPresent(resultsPath) ?? '').split('\n')) {
    if (!ln.trim()) continue;
    try { const r = JSON.parse(ln); done.add(`${r.prompt_id}\0${r.rep}`); } catch {}
  }
  // Rows key on the path-safe id (see pathSafeId), so resume must too.

  const cases = await loadCases();
  // Validate the id space before spending anything: duplicate path-safe ids - 
  // including case-insensitive twins, which macOS/Windows filesystems collapse - 
  // would silently overwrite traces and frozen refs; and a _state.json split id
  // that matches no case would silently shrink the scored denominator.
  const seen = new Map();
  for (const c of cases) {
    const k = pathSafeId(c.id).toLowerCase();
    if (seen.has(k)) {
      eprint(`duplicate case id after sanitization: '${c.id}' collides with '${seen.get(k)}'`);
      process.exit(2);
    }
    seen.set(k, c.id);
  }
  const safeIds = new Set(cases.map(c => pathSafeId(c.id)));
  for (const k of ['train_ids', 'val_ids', 'test_ids'])
    if (st[k] != null && !Array.isArray(st[k])) { eprint(`_state.json ${k} must be a list of ids`); process.exit(2); }
  for (const sid of [...(st.train_ids ?? []), ...(st.val_ids ?? []), ...(st.test_ids ?? [])]) {
    const s = String(sid); // the adapter joins with String() on both sides - numeric ids are fine
    if (safeIds.has(s)) continue; // matches a loaded case - definitionally valid
    if (s !== pathSafeId(s)) {
      // Can never match a row: rows key on path-safe ids. This is the silent
      // shrunken-denominator bug - fail before anything is spent.
      eprint(`_state.json split id '${s}' is not a path-safe id - record split ids exactly as they appear in results.jsonl's prompt_id`);
      process.exit(2);
    }
    // Well-formed but absent is legitimate (a trimmed top-K subset run) - note it, don't fail.
    eprint(`note: split id '${s}' matches no loaded case (expected for a trimmed subset run)`);
  }
  const refDir = join(args.flow, 'baseline', 'ref');
  const tasks = [];
  for (const c of cases) for (let rep = 0; rep < args.reps; rep++) {
    if (done.has(`${pathSafeId(c.id)}\0${rep}`)) continue;
    tasks.push({ c, rep });
  }
  eprint(`[${args.variant}] ${tasks.length} of ${cases.length * args.reps} (id,rep) to run`);

  let i = 0, ok = 0, fail = 0;
  const errorsPath = join(vdir, 'errors.jsonl');
  // A hard crash (power loss, ENOSPC) can leave a torn final line with no
  // trailing newline; the next append would merge two rows into one permanently
  // unparseable line. Isolate any fragment before appending anything.
  for (const p of [resultsPath, errorsPath]) {
    const tail = readIfPresent(p);
    if (tail && !tail.endsWith('\n')) appendFileNoFollow(p, '\n');
  }
  async function worker() {
    while (i < tasks.length) {
      const { c, rep } = tasks[i++];
      const safeId = pathSafeId(c.id);
      const t0 = Date.now();
      let lastRun = null;    // survives into the catch - billed spend on a failed attempt
      let rowWritten = false; // set once the results row lands - the attempt is scored
      const deadline = args.timeoutS > 0 ? t0 + args.timeoutS * 1000 : Infinity;
      const appRetry = { count: 0 }, judgeRetry = { count: 0 };
      try {
        // One ceiling over the whole case - app call, identity check, and grading - 
        // so a hung judge stream can't hold the slot either.
        const { run, g, latency_s } = await withTimeout((async () => {
          let tAttempt = t0;
          const run = await withBackoff(() => { tAttempt = Date.now(); return runCase(c, ctx); },
            appRetry, deadline);
          lastRun = run;
          // latency_s = the final app attempt only; backoff sleeps, failed
          // attempts, and judge time are excluded (retry counts are in meta).
          const latency_s = (Date.now() - tAttempt) / 1000;
          // Serving identity: fail loudly when the response was served by a model
          // other than the one requested. Accept exact match or a documented
          // alias->snapshot resolution - 'foo-latest'/'foo-0'/'foo' served as
          // 'foo-20250101', 'foo@20250101', or 'foo-2025-01-01'. Anything else - 
          // another snapshot of the requested pin, a sibling model, or the bare
          // base id ('foo-latest' served as 'foo', an unversioned echo that can
          // hide snapshot drift across rounds) - fails the attempt. Non-Anthropic
          // id schemes (e.g. Bedrock's 'anthropic.claude-...-v1:0') need their own
          // rule here.
          if (ctx.model && run.model && run.model !== ctx.model) {
            const base = ctx.model.replace(/-latest$|-0$/, '');
            const rest = String(run.model).startsWith(base)
              ? String(run.model).slice(base.length) : null;
            if (!(rest != null && /^[-@](\d{8}|\d{4}-\d{2}-\d{2})$/.test(rest))) {
              const e = new Error(`served model ${run.model} != requested ${ctx.model}`);
              e.failure_class = 'serving_substitution';
              throw e;
            }
          }
          // Frozen pairwise reference (never regenerated): baseline/ref/<id>.*
          let ref = null;
          if (args.variant !== 'baseline') {
            const p = join(refDir, safeId);
            // A planted symlink throws (ELOOP) rather than feeding the judge
            // its target; the case then fails loudly instead of leaking.
            for (const ext of REF_EXTS) {
              try { ref = readFileNoFollow(p + ext); break; }
              catch (e) { if (e?.code !== 'ENOENT') throw e; }
            }
          }
          const g = await withBackoff(() => gradeCase(c, run, ref, ctx), judgeRetry, deadline);
          return { run, g, latency_s };
        })(), args.timeoutS, `${c.id} rep${rep}`);
        const row = {
          prompt_id: safeId, rep, prompt: c.prompt ?? c.input ?? c.id,
          tags: c.tags, attachments: c.attachments,
          meta: safeId !== String(c.id) || appRetry.count || judgeRetry.count
            ? { ...(c.meta ?? {}),
                ...(safeId !== String(c.id) ? { original_id: String(c.id) } : {}),
                ...(appRetry.count ? { retries: appRetry.count } : {}),
                ...(judgeRetry.count ? { judge_retries: judgeRetry.count } : {}) }
            : c.meta,
          model: run.model, usage: run.usage, stop_reason: run.stop_reason,
          // The report keys on `status`, not stop_reason: a clipped answer is
          // counted and shown but kept out of the means. runCase may set
          // run.status to override the max_tokens rule.
          status: run.status ?? (run.stop_reason === 'max_tokens' ? 'truncated' : 'ok'),
          judge_model: g.judge_model ?? run.judge_model,
          judge_usage: g.judge_usage ?? run.judge_usage,
          latency_s, ...perfFrom(run),
          grade: g.grade, explanation: g.explanation,
        };
        appendFileNoFollow(resultsPath, JSON.stringify(row) + '\n');
        rowWritten = true; // past this point the attempt is scored - a later throw (trace write, ref freeze) must not also append an error row
        if (run.transcript)
          writeFileNoFollow(join(vdir, 'traces', `${safeId}_rep${rep}.json`),
            JSON.stringify(run.transcript, null, 2));
        // For pairwise: on the baseline run, freeze the reference output once.
        if (args.variant === 'baseline' && run.output != null
            && !REF_EXTS.some(ext => lexists(join(refDir, safeId) + ext))) {
          mkdirNoFollow(refDir);
          writeFileNoFollow(join(refDir, safeId),
            typeof run.output === 'string' ? run.output : JSON.stringify(run.output));
        }
        ok++;
      } catch (e) {
        fail++;
        if (rowWritten) {
          // The attempt scored; only a post-row write (trace, ref) failed. An error
          // row here would double-count the billed usage under the budget rule.
          eprint(`  [${args.variant}] ${c.id} rep${rep} scored, but a post-row write failed: ${e?.message || e}`);
          continue;
        }
        // Failed attempts are data too - but they must not occupy the (case, rep)
        // slot in results.jsonl, or resume would never re-run them.
        appendFileNoFollow(errorsPath, JSON.stringify({
          prompt_id: safeId, rep,
          ...(safeId !== String(c.id) ? { original_id: String(c.id) } : {}),
          failure_class: e?.failure_class ?? 'error',
          error: String(e?.message || e),
          retries: appRetry.count, judge_retries: judgeRetry.count,
          // Billed-but-failed spend stays countable: when the app call completed
          // before the failure (e.g. a served-model mismatch, a judge-stage
          // ceiling), carry its identity and usage on the error row.
          model: lastRun?.model, usage: lastRun?.usage,
          judge_model: e?.judge_model ?? lastRun?.judge_model,
          judge_usage: e?.judge_usage ?? lastRun?.judge_usage,
          latency_s: (Date.now() - t0) / 1000,
        }) + '\n');
        eprint(`  [${args.variant}] ${c.id} rep${rep} FAILED: ${e?.message || e}`);
      }
    }
  }
  // One progress line every 30s (and to <vdir>/progress.txt) so "how far along
  // is it?" is answerable from the background shell's output or one file read,
  // without the orchestrator parsing results.jsonl mid-write. ETA is a plain
  // rate extrapolation from this pass.
  const t0 = Date.now();
  const progress = () => {
    const done = ok + fail, total = tasks.length;
    const el = (Date.now() - t0) / 1000;
    const eta = done ? Math.round((el / done) * (total - done)) : null;
    const line = `[${args.variant}] ${done}/${total} done (${ok} ok, ${fail} failed), `
      + `${Math.round(el)}s elapsed` + (eta != null ? `, ~${eta}s left` : '');
    eprint(line);
    try { writeFileNoFollow(join(vdir, 'progress.txt'), line + '\n'); } catch {}
  };
  const tick = setInterval(progress, 30_000);
  workersStarted = true;
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));
  clearInterval(tick); progress();
  eprint(`[${args.variant}] done - ${ok} ok, ${fail} failed -> ${resultsPath}`);
  process.exit(fail ? 1 : 0);
}

// Anything main() throws prints as one sanitized line, not a raw stack. Before
// the workers start it is a refusal (a planted link at _state.json or
// results.jsonl, an lstat that fails, an error from loadCases) and exits 2 like
// the preflight refusals. After they start, only a failed errors.jsonl append
// gets here; rows may already be on disk, so say that and exit 1.
let workersStarted = false;
main().catch(e => {
  const m = String(e?.message || e);
  if (workersStarted) { eprint('stopped mid-run (rows already written are kept; re-run to resume): ' + m); process.exit(1); }
  eprint(m.startsWith('refusing to ') ? m : 'refusing to run: ' + m);
  process.exit(2);
});
