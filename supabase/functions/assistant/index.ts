// Fonction « assistant » : l'outil l'appelle avec la session de la personne connectée, jamais avec une clé de service.
// Elle vérifie qui appelle et ses droits avec les fonctions de la base (les mêmes que celles des tables), lit seulement ce qu'il faut avec
// cette même session (les règles RLS s'appliquent), appelle Claude avec la clé gardée dans les secrets Supabase et rend un JSON contrôlé.
// Un usage : « lire » (message libre du client vers une proposition de dossier). « rediger » est retiré depuis le 19.11.2026 et refusé.
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
  if (usage !== "lire") return json({ erreur: "usage_inconnu" }, 400);
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
  const anthropic = new Anthropic({ apiKey: cle, timeout: 60_000, maxRetries: 1 });

  // Lecture : le prompt, le schéma de la réponse et la validation qui suivra.
  const message = typeof demande.texte === "string" ? demande.texte.trim() : "";
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
  const aujourdhui = dateBangkok();
  const prompt = promptLecture({ entreprise: en.data?.nom || "", catalogue: catalogue.texte, aujourdhui, message, lieu: ra.lieu, responsable: ra.responsable });
  const schema = SCHEMA_LECTURE;
  const valider = (v: unknown) => validerLecture(v, { refs: catalogue.refs, message, aujourdhui });

  const debut = Date.now();
  let reponseClaude: Anthropic.Beta.BetaMessage | null = null;
  let statut = "ok";
  let reponse: Record<string, unknown>;
  let code = 200;
  try {
    reponseClaude = await anthropic.beta.messages.create(parametresAppel(usage, prompt, schema) as Anthropic.Beta.MessageCreateParamsNonStreaming);
    const lu = lireReponse(reponseClaude);
    if (!lu.ok) {
      statut = lu.statut || "erreur";
      reponse = { erreur: lu.statut, ...(lu.categorie ? { categorie: lu.categorie } : {}) };
      code = 422;
    } else {
      const v = valider(lu.valeur);
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
