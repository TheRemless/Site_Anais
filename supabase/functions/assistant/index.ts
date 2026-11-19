// Fonction « assistant » : l'outil l'appelle avec la session de la personne connectée, jamais avec une clé de service.
// Elle vérifie qui appelle et ses droits avec les fonctions de la base (les mêmes que celles des tables), lit seulement ce qu'il faut avec
// cette même session (les règles RLS s'appliquent), appelle Claude avec la clé gardée dans les secrets Supabase et rend un JSON contrôlé.
// Usages : « lire » (message libre du client vers une proposition de dossier) et, depuis le 20.11.2026, la demande de prix et d'horaires
// (« itineraire », « situer », « repondre_itineraire », voir itineraire.js). « rediger » est retiré depuis le 19.11.2026 et refusé.
// Rien n'est écrit dans les dossiers : la personne vérifie et valide dans l'outil. Le journal note l'appel (jetons, coût), jamais son contenu.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  LIMITE_JOUR_DEFAUT,
  LONGUEUR_MAX_MESSAGE,
  SCHEMA_LECTURE,
  construireCatalogue,
  controlerAcces,
  dateBangkok,
  debutJourBangkok,
  ligneJournal,
  lireReponse,
  parametresAppel,
  promptLecture,
  validerLecture,
  reglagesAssistant,
} from "./calc.js";
import {
  MAX_HOTELS,
  SCHEMA_ITINERAIRE,
  SCHEMA_REPONSE_ITINERAIRE,
  lieuxDuCatalogue,
  lireSituer,
  nomPourRecherche,
  parametresSituer,
  promptItineraire,
  promptReponseItineraire,
  promptSituer,
  validerItineraire,
  validerReponseItineraire,
  validerSituer,
  verifierFaitsItineraire,
} from "./itineraire.js";

const USAGES_CONNUS = ["lire", "itineraire", "situer", "repondre_itineraire"];

const ORIGINES = (Deno.env.get("ASSISTANT_ORIGINES") || "https://gestion.zwaldtravelplanner.com").split(",").map((x) => x.trim());

function entetes(req: Request) {
  const origine = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINES.includes(origine) ? origine : ORIGINES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

// Usage cumulé de deux passages (jetons et recherches web), pour un journal et un coût justes.
function additionner(a: Record<string, any> = {}, b: Record<string, any> = {}) {
  const n = (x: unknown) => Number(x) || 0;
  return {
    ...b,
    input_tokens: n(a.input_tokens) + n(b.input_tokens),
    output_tokens: n(a.output_tokens) + n(b.output_tokens),
    cache_read_input_tokens: n(a.cache_read_input_tokens) + n(b.cache_read_input_tokens),
    cache_creation_input_tokens: n(a.cache_creation_input_tokens) + n(b.cache_creation_input_tokens),
    server_tool_use: { web_search_requests: n(a.server_tool_use?.web_search_requests) + n(b.server_tool_use?.web_search_requests) },
  };
}

Deno.serve(async (req) => {
  const h = entetes(req);
  const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: h });
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ erreur: "methode" }, 405);

  const autorisation = req.headers.get("authorization") || "";
  if (!/^Bearer .+/.test(autorisation)) return json({ erreur: "non_connecte" }, 401);
  const demande = await req.json().catch(() => null);
  if (!demande || typeof demande !== "object") return json({ erreur: "demande_invalide" }, 400);
  const { usage, entite_id: entiteId } = demande;
  if (!USAGES_CONNUS.includes(usage)) return json({ erreur: "usage_inconnu" }, 400);
  if (typeof entiteId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entiteId)) return json({ erreur: "entreprise_invalide" }, 400);

  const URL_SB = Deno.env.get("SUPABASE_URL")!;
  // Client « au nom de la personne » : toutes ses lectures passent par les règles RLS, exactement comme dans l'outil.
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
  // Client de service : seulement pour compter et écrire le journal, que personne ne peut modifier depuis l'outil.
  const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: qui, error: errQui } = await sb.auth.getUser();
  if (errQui || !qui?.user) return json({ erreur: "non_connecte" }, 401);
  const userId = qui.user.id;

  const [regl, perms, appels] = await Promise.all([
    sb.from("reglages").select("valeur").eq("entite_id", entiteId).maybeSingle(),
    sb.rpc("permissions_dans", { e: entiteId }),
    admin.from("assistant_journal").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("cree_le", debutJourBangkok()),
  ]);
  if (regl.error || perms.error || appels.error) return json({ erreur: "base" }, 500);
  const reglages = regl.data ? regl.data.valeur : null;
  // Lieu et personne responsable de l'entreprise (migration 44).
  const ra = reglagesAssistant(reglages);
  const limite = Number(Deno.env.get("ASSISTANT_LIMITE_JOUR")) || LIMITE_JOUR_DEFAUT;
  const acces = controlerAcces({ usage, entiteId, permissions: perms.data || [], reglages, appelsDuJour: appels.count || 0, limite });
  if (!acces.ok) return json({ erreur: acces.erreur, ...(acces.manque ? { manque: acces.manque } : {}), ...(acces.limite ? { limite: acces.limite } : {}) }, acces.statut);

  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return json({ erreur: "non_configure" }, 503);
  // Situer plusieurs hôtels enchaîne des recherches web : sans nouvel essai (une recherche refaite se paie deux fois). Deux passages au plus
  // (reprise après « pause_turn ») de 65 secondes chacun restent sous la limite de 150 secondes d'une fonction Supabase : le journal s'écrit toujours.
  const anthropic = new Anthropic({ apiKey: cle, timeout: 65_000, maxRetries: usage === "situer" ? 0 : 1 });

  const aujourdhui = dateBangkok();
  const message = typeof demande.texte === "string" ? demande.texte.trim() : "";
  // Chaque usage prépare son appel (paramètres de l'API) et la façon de lire et contrôler la réponse.
  let parametres: Record<string, unknown>;
  let lire: (m: Anthropic.Beta.BetaMessage) => { ok: boolean; statut?: string; categorie?: string | null; valeur?: unknown; sources?: unknown[] } = lireReponse;
  let valider: (v: unknown, lu?: { sources?: unknown[] }) => Record<string, unknown>;

  if (usage === "lire") {
    if (!message || message.length > LONGUEUR_MAX_MESSAGE) return json({ erreur: "message_invalide" }, 400);
    // Prix de vente et libellés seulement : les tables de nets ne sont jamais lues, même pour une personne qui a le droit « nets ».
    const [ps, ts, pa, en] = await Promise.all([
      sb.from("prestations").select("id, famille, groupe, libelle, libelle_en, unite, sur_place, actif, partenaire_id").eq("entite_id", entiteId),
      sb.from("trajets").select("id, de, vers, mode, depart, periode, actif, partenaire_id").eq("entite_id", entiteId),
      sb.from("partenaires").select("id, nom, actif").eq("entite_id", entiteId),
      sb.from("entites").select("nom").eq("id", entiteId).maybeSingle(),
    ]);
    if (ps.error || ts.error || pa.error) return json({ erreur: "base" }, 500);
    const catalogue = construireCatalogue({ prestations: ps.data || [], trajets: ts.data || [], partenaires: pa.data || [] });
    parametres = parametresAppel(usage, promptLecture({ entreprise: en.data?.nom || "", catalogue: catalogue.texte, aujourdhui, message, lieu: ra.lieu, responsable: ra.responsable }), SCHEMA_LECTURE);
    valider = (v) => validerLecture(v, { refs: catalogue.refs, message, aujourdhui });
  } else if (usage === "itineraire") {
    // Le message seul, sans catalogue : les trajets se cherchent ensuite dans l'outil.
    if (!message || message.length > LONGUEUR_MAX_MESSAGE) return json({ erreur: "message_invalide" }, 400);
    parametres = parametresAppel(usage, promptItineraire({ aujourdhui, message, lieu: ra.lieu }), SCHEMA_ITINERAIRE);
    valider = (v) => validerItineraire(v, { message, aujourdhui });
  } else if (usage === "situer") {
    // Seuls les noms d'hôtels partent, avec les lieux des trajets de l'entreprise (lus ici, avec la session de la personne).
    const hotels = (Array.isArray(demande.hotels) ? demande.hotels : []).map(nomPourRecherche).filter(Boolean).filter((h, i, a) => a.indexOf(h) === i);
    if (!hotels.length || hotels.length > MAX_HOTELS) return json({ erreur: "hotels_invalides" }, 400);
    const [ts, pa] = await Promise.all([sb.from("trajets").select("de, vers, actif, partenaire_id").eq("entite_id", entiteId), sb.from("partenaires").select("id, actif").eq("entite_id", entiteId)]);
    if (ts.error || pa.error) return json({ erreur: "base" }, 500);
    const lieux = lieuxDuCatalogue({ trajets: ts.data || [], partenaires: pa.data || [] });
    if (!lieux.length) return json({ erreur: "catalogue_vide" }, 400);
    parametres = parametresSituer(promptSituer({ hotels, lieux, lieu: ra.lieu }), hotels.length);
    lire = lireSituer;
    valider = (v, lu) => validerSituer(v, { hotels, lieux, sources: (lu && lu.sources) || [] });
  } else {
    // repondre_itineraire : les faits calculés dans l'outil, aux clés fermées (aucun net, aucune compagnie).
    const f = verifierFaitsItineraire(demande.faits);
    if (!f.ok) return json({ erreur: f.erreur, ...(f.cles ? { cles: f.cles } : {}) }, 400);
    const en = await sb.from("entites").select("nom").eq("id", entiteId).maybeSingle();
    parametres = parametresAppel(usage, promptReponseItineraire({ faits: f.faits, voix: ra.voix, responsable: ra.responsable, entreprise: en.data?.nom || "" }), SCHEMA_REPONSE_ITINERAIRE);
    valider = (v) => validerReponseItineraire(v, f.faits);
  }

  const debut = Date.now();
  let reponseClaude: Anthropic.Beta.BetaMessage | null = null;
  let statut = "ok";
  let reponse: Record<string, unknown>;
  let code = 200;
  try {
    reponseClaude = await anthropic.beta.messages.create(parametres as Anthropic.Beta.MessageCreateParamsNonStreaming);
    let lu = lire(reponseClaude);
    // Recherche web arrêtée en route par le serveur (« pause_turn ») : on renvoie la réponse telle quelle, une fois, pour qu'elle reprenne.
    if (!lu.ok && lu.statut === "pause") {
      const p = parametres as { messages: unknown[] };
      const premier = reponseClaude;
      reponseClaude = await anthropic.beta.messages.create({ ...parametres, messages: [...p.messages, { role: "assistant", content: premier.content }] } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      // Les jetons et recherches du premier passage comptent aussi dans le journal.
      reponseClaude = { ...reponseClaude, usage: additionner(premier.usage, reponseClaude.usage) } as Anthropic.Beta.BetaMessage;
      const avant = lu.sources || [];
      lu = lire(reponseClaude);
      lu.sources = [...avant, ...(lu.sources || [])];
    }
    if (!lu.ok) {
      statut = lu.statut || "erreur";
      reponse = { erreur: lu.statut, ...(lu.categorie ? { categorie: lu.categorie } : {}) };
      code = 422;
    } else {
      const v = valider(lu.valeur, lu);
      if (!v.ok) {
        statut = "invalide";
        reponse = { erreur: "invalide" };
        code = 422;
      } else reponse = { ...v, usage, modele: reponseClaude.model };
    }
  } catch (err) {
    // Du plus précis au plus général : une limite d'Anthropic se réessaie plus tard, une clé refusée est à corriger par Jérémy.
    if (err instanceof Anthropic.RateLimitError) {
      statut = "occupe";
      reponse = { erreur: "occupe" };
      code = 429;
    } else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      statut = "cle_refusee";
      reponse = { erreur: "non_configure" };
      code = 503;
    } else if (err instanceof Anthropic.APIError) {
      statut = "erreur_api";
      reponse = { erreur: "indisponible" };
      code = 502;
    } else {
      statut = "erreur";
      reponse = { erreur: "indisponible" };
      code = 502;
    }
    console.error("assistant :", statut, err instanceof Error ? err.message.slice(0, 200) : "");
  }

  const { error: errJournal } = await admin.from("assistant_journal").insert(ligneJournal({ userId, entiteId, usage, statut, message: reponseClaude, dureeMs: Date.now() - debut }));
  if (errJournal) console.error("journal de l'assistant non écrit :", errJournal.message);
  return json(reponse, code);
});
