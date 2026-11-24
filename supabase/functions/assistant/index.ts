// Fonction « assistant » : l'outil l'appelle avec la session de la personne connectée, jamais avec une clé de service.
// Elle vérifie qui appelle et ses droits avec les fonctions de la base (les mêmes que celles des tables), lit seulement ce qu'il faut avec
// cette même session (les règles RLS s'appliquent), appelle Claude avec la clé gardée dans les secrets Supabase et rend un JSON contrôlé.
// Usages : « lire » (message libre du client vers une proposition de dossier) et, depuis le 20.11.2026, la demande de prix et d'horaires
// (« itineraire », « situer », « repondre_itineraire », voir itineraire.js), la lecture d'une brochure de partenaire (« brochure », brochure.js).
// « rediger » est retiré depuis le 19.11.2026 et refusé.
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
  detailErreurApi,
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
import { SCHEMA_BROCHURE, SCHEMA_RELECTURE, controlerAccesBrochure, delaiPasse, demandeCorrection, fusionnerRelecture, lireBrochure, masquerNets, parametresBrochure, promptBrochure, promptRelecture, validerBrochure, verifierExtraction, verifierFichiers } from "./brochure.js";
import { debutMois, estCreditEpuise, plafondRetenu, reprise } from "./budget.js";

const USAGES_CONNUS = ["lire", "itineraire", "situer", "repondre_itineraire", "brochure"];

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

  const [regl, perms, appels, mois, budget] = await Promise.all([
    sb.from("reglages").select("valeur").eq("entite_id", entiteId).maybeSingle(),
    sb.rpc("permissions_dans", { e: entiteId }),
    admin.from("assistant_journal").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("cree_le", debutJourBangkok()),
    // Le plafond du mois (migration 54) vaut aussi ici : toute la dépense de l'assistant compte, cette fonction comme l'agent.
    admin.rpc("assistant_cout_depuis", { debut: debutMois() }),
    admin.from("assistant_budget").select("plafond_mois_usd, seuil_alerte_pct").maybeSingle(),
  ]);
  if (regl.error || perms.error || appels.error) return json({ erreur: "base" }, 500);
  // Sans la fonction de somme (migration 52) ou la table du plafond (migration 54) : pas de plafond ici, comme avant.
  const { plafond } = plafondRetenu(budget.error ? null : budget.data, Deno.env.get("AGENT_PLAFOND_MOIS_USD"));
  const coutDuMois = mois.error ? 0 : Number(mois.data) || 0;
  if (!budget.error && coutDuMois >= plafond) return json({ erreur: "plafond_du_mois", plafond, depense: Math.round(coutDuMois * 100) / 100, reprise: reprise() }, 429);
  const reglages = regl.data ? regl.data.valeur : null;
  // Lieu et personne responsable de l'entreprise (migration 44).
  const ra = reglagesAssistant(reglages);
  const limite = Number(Deno.env.get("ASSISTANT_LIMITE_JOUR")) || LIMITE_JOUR_DEFAUT;
  const controle = usage === "brochure" ? controlerAccesBrochure : controlerAcces;
  // Une brochure jointe à une conversation de l'onglet Assistant se lit depuis ses fichiers gardés (agent_fichiers, migration 55).
  const depuisAgent = usage === "brochure" && Array.isArray(demande.fichiers_agent);
  const acces = controle({ usage, entiteId, permissions: perms.data || [], reglages, appelsDuJour: appels.count || 0, limite, depuisAgent });
  if (!acces.ok) return json({ erreur: acces.erreur, ...(acces.manque ? { manque: acces.manque } : {}), ...(acces.limite ? { limite: acces.limite } : {}) }, acces.statut);

  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return json({ erreur: "non_configure" }, 503);
  // Situer plusieurs hôtels enchaîne des recherches web : sans nouvel essai (une recherche refaite se paie deux fois). Deux passages au plus
  // (reprise après « pause_turn ») de 65 secondes chacun restent sous la limite de 150 secondes d'une fonction Supabase : le journal s'écrit toujours.
  // Une brochure (images, PDF, Claude Opus 5.5) se lit en deux appels de l'outil (« lecture », puis « relecture »), chacun en un seul passage de
  // 135 secondes au plus (ASSISTANT_BROCHURE_DELAI_MS sur une offre payante), sans nouvel essai : la lecture du corps (jusqu'à 13 Mo), les lectures de la base et le journal tiennent dans le reste
  // des 150 secondes. La réponse arrive en flux (marge de sortie de 64 000 jetons).
  // Le « timeout » du client borne l'attente des en-têtes, pas un flux qui continue d'arriver : une passe de brochure s'arrête aussi par un
  // AbortSignal posé sur le flux (24.11.2026, revue des PR 346 et 347). Arrêtée : « trop_long » à l'écran, et le journal s'écrit quand même.
  const delaiBrochure = delaiPasse(Deno.env.get("ASSISTANT_BROCHURE_DELAI_MS"));
  const anthropic = new Anthropic({ apiKey: cle, timeout: usage === "brochure" ? delaiBrochure : 65_000, maxRetries: usage === "situer" || usage === "brochure" ? 0 : 1 });

  const aujourdhui = dateBangkok();
  const message = typeof demande.texte === "string" ? demande.texte.trim() : "";
  // Chaque usage prépare son appel (paramètres de l'API) et la façon de lire et contrôler la réponse.
  let parametres: Record<string, unknown>;
  let lire: (m: Anthropic.Beta.BetaMessage) => { ok: boolean; statut?: string; categorie?: string | null; valeur?: unknown; sources?: unknown[]; raison?: string; manque?: string[] } = lireReponse;
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
  } else if (usage === "brochure") {
    // Les fichiers de la brochure seuls (ni catalogue, ni prix de la base, ni nom du partenaire). Le partenaire doit être un de ceux de
    // l'entreprise, lu avec la session de la personne : chaque entreprise garde ses partenaires.
    // Depuis l'agent : les fichiers sont relus dans la base avec la session de la personne (seulement ceux de ses conversations, règles RLS),
    // et doivent venir d'une conversation de cette entreprise. Le partenaire peut ne pas exister encore (« nouveau partenaire ») : l'écran le
    // crée avant d'enregistrer les lignes.
    let brutes = demande.fichiers;
    if (depuisAgent) {
      const ids = demande.fichiers_agent.filter((x: unknown) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x));
      if (!ids.length || ids.length !== demande.fichiers_agent.length || ids.length > 6) return json({ erreur: "fichiers_absents" }, 400);
      const lus = await sb.from("agent_fichiers").select("id, media_type, data, conversation_id").in("id", ids);
      if (lus.error) return json({ erreur: lus.error.code === "42P01" ? "migration_manquante" : "base" }, 500);
      const convs = [...new Set((lus.data || []).map((x) => x.conversation_id))];
      const cs = convs.length ? await sb.from("agent_conversations").select("id, entite_id").in("id", convs) : { data: [], error: null };
      if (cs.error) return json({ erreur: "base" }, 500);
      if ((lus.data || []).length !== ids.length || (cs.data || []).some((c) => c.entite_id !== entiteId) || (cs.data || []).length !== convs.length) return json({ erreur: "fichiers_absents" }, 400);
      brutes = ids.map((id: string) => (lus.data || []).find((x) => x.id === id));
    }
    const f = verifierFichiers(brutes);
    if (!f.ok) return json({ erreur: f.erreur }, 400);
    const nouveauPartenaire = depuisAgent && demande.nouveau_partenaire === true && !demande.partenaire_id;
    if (!nouveauPartenaire) {
      if (typeof demande.partenaire_id !== "string") return json({ erreur: "partenaire_invalide" }, 400);
      const pa = await sb.from("partenaires").select("id").eq("entite_id", entiteId).eq("id", demande.partenaire_id).maybeSingle();
      if (pa.error || !pa.data) return json({ erreur: "partenaire_invalide" }, 400);
    }
    // Seconde passe (24.11.2026) : la première lecture revient du navigateur, contrôlée comme une réponse de Claude, et Claude relit les mêmes
    // fichiers avec elle. Le journal note un second appel « brochure ».
    // Sans le droit « prix nets », aucun net ne repart vers le navigateur (ni chiffre, ni colonne, ni raison qui en parle).
    // JSON demandé dans la consigne (plus de sortie structurée : grammaire trop grosse), extrait et contrôlé ici.
    lire = (m) => lireBrochure(m, demande.passe === "relecture" ? SCHEMA_RELECTURE : SCHEMA_BROCHURE);
    const voitNets = (perms.data || []).includes("partenaires.nets");
    const sansNets = (r: Record<string, unknown>) => (r && r.ok && !voitNets ? { ...r, brochure: masquerNets(r.brochure) } : r);
    if (demande.passe === "relecture") {
      const premiere = verifierExtraction(demande.extraction);
      if (!premiere.ok) return json({ erreur: "extraction_invalide" }, 400);
      parametres = parametresBrochure(promptRelecture({ fichiers: f.fichiers, aujourdhui, lieu: ra.lieu, brochure: premiere.brochure }), { passe: "relecture" });
      valider = (v) => {
        const fusion = fusionnerRelecture(premiere.brochure, v);
        const r = validerBrochure(fusion.brut);
        return sansNets(r.ok ? { ...r, relecture: fusion.compte } : r);
      };
    } else {
      parametres = parametresBrochure(promptBrochure({ fichiers: f.fichiers, aujourdhui, lieu: ra.lieu }));
      valider = (v) => sansNets(validerBrochure(v));
    }
  } else {
    // repondre_itineraire : les faits calculés dans l'outil, aux clés fermées (aucun net, aucune compagnie).
    const f = verifierFaitsItineraire(demande.faits);
    if (!f.ok) return json({ erreur: f.erreur, ...(f.cles ? { cles: f.cles } : {}) }, 400);
    const en = await sb.from("entites").select("nom").eq("id", entiteId).maybeSingle();
    parametres = parametresAppel(usage, promptReponseItineraire({ faits: f.faits, voix: ra.voix, entreprise: en.data?.nom || "" }), SCHEMA_REPONSE_ITINERAIRE);
    valider = (v) => validerReponseItineraire(v, f.faits, { entreprise: en.data?.nom || "" });
  }

  const debut = Date.now();
  let reponseClaude: Anthropic.Beta.BetaMessage | null = null;
  let statut = "ok";
  let reponse: Record<string, unknown>;
  let code = 200;
  const arret = usage === "brochure" ? new AbortController() : null;
  const minuterie = arret ? setTimeout(() => arret.abort(), delaiBrochure) : null;
  let flux: ReturnType<typeof anthropic.beta.messages.stream> | null = null;
  // Les jetons de la première réponse quand la demande de correction est arrêtée en route : ils comptent aussi dans le journal.
  let usageAvant: Record<string, unknown> | null = null;
  let premierMessage: Anthropic.Beta.BetaMessage | null = null;
  try {
    // Brochure : en flux, la réponse complète attendue à la fin (finalMessage), comme l'agent, arrêtée au bout du délai d'une passe.
    if (usage === "brochure" && arret) {
      flux = anthropic.beta.messages.stream(parametres as unknown as Parameters<typeof anthropic.beta.messages.stream>[0], { signal: arret.signal });
      reponseClaude = await flux.finalMessage();
    } else reponseClaude = await anthropic.beta.messages.create(parametres as Anthropic.Beta.MessageCreateParamsNonStreaming);
    let lu = lire(reponseClaude);
    // Brochure : un JSON illisible (texte complet mais mal formé), une seule demande de correction, sur le même délai (même AbortSignal).
    if (!lu.ok && lu.statut === "json_invalide" && usage === "brochure" && arret && !arret.signal.aborted) {
      const premier = reponseClaude;
      usageAvant = premier.usage as unknown as Record<string, unknown>;
      premierMessage = premier;
      // Pendant la correction, aucune réponse complète : un arrêt au délai passe par le compte partiel ci-dessous (catch).
      reponseClaude = null;
      flux = anthropic.beta.messages.stream(demandeCorrection(parametres as { messages: unknown[] }, premier, lu.raison, lu.manque || []) as unknown as Parameters<typeof anthropic.beta.messages.stream>[0], { signal: arret.signal });
      reponseClaude = await flux.finalMessage();
      reponseClaude = { ...reponseClaude, usage: additionner(premier.usage, reponseClaude.usage) } as Anthropic.Beta.BetaMessage;
      usageAvant = null;
      lu = lire(reponseClaude);
    }
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
    // Un flux arrêté en route : ce qu'il a déjà consommé compte dans le journal (jetons et coût), si le SDK l'a gardé.
    if (flux && !reponseClaude) {
      try {
        const partiel = (flux as unknown as { currentMessage?: Anthropic.Beta.BetaMessage }).currentMessage || null;
        // Correction coupée par le délai : les jetons de la première réponse comptent toujours, plus ceux de la correction s'il y en a.
        if (partiel && usageAvant) reponseClaude = { ...partiel, usage: additionner(usageAvant, partiel.usage) } as Anthropic.Beta.BetaMessage;
        else if (premierMessage && usageAvant) reponseClaude = { ...premierMessage, usage: additionner(usageAvant, {}) } as Anthropic.Beta.BetaMessage;
        else reponseClaude = partiel;
      } catch {
        reponseClaude = null;
      }
    }
    // Du plus précis au plus général : le crédit épuisé est à recharger, une limite d'Anthropic se réessaie plus tard, une clé refusée est à corriger par Jérémy.
    if (arret && arret.signal.aborted) {
      // Délai d'une passe atteint (AbortSignal) : la brochure est trop longue pour une passe, l'écran propose de l'envoyer en deux fois.
      statut = "delai";
      reponse = { erreur: "trop_long" };
      code = 504;
    } else if (estCreditEpuise(err)) {
      statut = "credit_epuise";
      reponse = { erreur: "credit_epuise" };
      code = 503;
    } else if (err instanceof Anthropic.RateLimitError) {
      statut = "occupe";
      reponse = { erreur: "occupe" };
      code = 429;
    } else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      statut = "cle_refusee";
      reponse = { erreur: "non_configure" };
      code = 503;
    } else if (err instanceof Anthropic.APIConnectionTimeoutError) {
      // Une brochure trop longue pour une passe : l'écran propose de l'envoyer en deux fois.
      statut = "delai";
      reponse = { erreur: usage === "brochure" ? "trop_long" : "indisponible" };
      code = 504;
    } else if (err instanceof Anthropic.APIError) {
      // Le statut, le type et le message de l'API reviennent à l'écran (detail_api) et dans le statut du journal : un 400 se lit la prochaine fois.
      const detail = detailErreurApi(err);
      statut = detail && detail.statut ? `erreur_api_${detail.statut}` : "erreur_api";
      reponse = { erreur: "indisponible", ...(detail ? { detail_api: detail } : {}) };
      code = 502;
    } else {
      statut = "erreur";
      reponse = { erreur: "indisponible" };
      code = 502;
    }
    console.error("assistant :", statut, err instanceof Error ? err.message.slice(0, 300) : "");
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }

  const { error: errJournal } = await admin.from("assistant_journal").insert(ligneJournal({ userId, entiteId, usage, statut, message: reponseClaude, modeleDemande: String((parametres as { model?: string }).model || ""), dureeMs: Date.now() - debut }));
  if (errJournal) console.error("journal de l'assistant non écrit :", errJournal.message);
  return json(reponse, code);
});
