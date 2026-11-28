// Fonction « ameliorations » (20.11.2026) : envoie une demande d'amélioration validée dans l'Assistant.
//
// Appelée par l'outil avec la session de la personne : { action: "demander", entite_id, carte_id, titre, texte }.
//   1. la personne est administratrice de l'entreprise (droit reglages.ecrire) ;
//   2. la carte « amelioration » est à elle (RLS), dans cette entreprise, pas encore décidée ;
//   3. moins de AMELIORATIONS_LIMITE_JOUR demandes aujourd'hui (toutes entreprises, 3 par défaut) ;
//   4. le texte, public, ne cite ni client, ni prestataire, ni montant, ni coordonnée (calc.js) ;
//   5. la ligne est écrite dans `ameliorations` (clé de service : la table ne s'écrit que par cette fonction et par « rappels »), puis l'issue
//      est ouverte sur GitHub avec le label qui déclenche l'Action, avec le jeton GITHUB_ISSUES_TOKEN (droits « Issues » seulement, posé par
//      Jérémy) ; la carte passe à « validée ».
// Le suivi (PR prête, en ligne, refusée) est lu sur GitHub par la fonction « rappels » ({ "type": "ameliorations" }, pg_cron).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { DEPOT, LABEL, LIMITE_JOUR_DEFAUT, controlerDemande, corpsIssue, titreIssue } from "./calc.js";
import { envoyerAvecCarte } from "./envoi.js";
import { dateBangkok, debutJourBangkok } from "../assistant/calc.js";

const ORIGINES = (Deno.env.get("ASSISTANT_ORIGINES") || "https://gestion.zwaldtravelplanner.com").split(",").map((x) => x.trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: entetes(req) });
  if (req.method === "OPTIONS") return new Response("ok", { headers: entetes(req) });
  if (req.method !== "POST") return json({ erreur: "methode" }, 405);
  const autorisation = req.headers.get("authorization") || "";
  if (!/^Bearer .+/.test(autorisation)) return json({ erreur: "non_connecte" }, 401);
  const d = await req.json().catch(() => null);
  if (!d || typeof d !== "object" || d.action !== "demander") return json({ erreur: "demande_invalide" }, 400);
  if (typeof d.entite_id !== "string" || !UUID.test(d.entite_id) || typeof d.carte_id !== "string" || !UUID.test(d.carte_id)) return json({ erreur: "demande_invalide" }, 400);
  if (typeof d.titre !== "string" || typeof d.texte !== "string" || d.titre.length > 400 || d.texte.length > 6000) return json({ erreur: "demande_invalide" }, 400);

  const URL_SB = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
  const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: qui, error: errQui } = await sb.auth.getUser();
  if (errQui || !qui?.user) return json({ erreur: "non_connecte" }, 401);

  const [perms, carte, jour, ent, partenaires, reglages, deja] = await Promise.all([
    sb.rpc("permissions_dans", { e: d.entite_id }),
    // Lue avec la session : une carte d'une autre personne n'est pas lisible.
    sb.from("agent_cartes").select("id, conversation_id, genre, statut, donnees, agent_conversations!inner(entite_id)").eq("id", d.carte_id).maybeSingle(),
    admin.from("ameliorations").select("id", { count: "exact", head: true }).gte("cree_le", debutJourBangkok()),
    sb.from("entites").select("nom").eq("id", d.entite_id).maybeSingle(),
    sb.from("partenaires").select("nom").eq("entite_id", d.entite_id).limit(2000),
    sb.from("reglages").select("valeur").eq("entite_id", d.entite_id).maybeSingle(),
    // Une carte n'envoie qu'une demande, même si sa mise à jour a échoué après l'issue ou si l'appui a été doublé.
    admin.from("ameliorations").select("id", { count: "exact", head: true }).eq("carte_id", d.carte_id),
  ]);
  const manquante = (e: { code?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205");
  if (perms.error || carte.error || jour.error || deja.error) return json({ erreur: manquante(jour.error) || manquante(deja.error) ? "migration_manquante" : "base" }, 500);
  if ((deja.count || 0) > 0) return json({ erreur: "deja_decidee" }, 409);
  const c = carte.data ? { ...carte.data, entite_id: (carte.data as any).agent_conversations?.entite_id } : null;
  const controle = controlerDemande({
    permissions: perms.data || [],
    carte: c,
    entiteId: d.entite_id,
    titre: d.titre,
    texte: d.texte,
    demandesDuJour: jour.count || 0,
    limiteJour: Number(Deno.env.get("AMELIORATIONS_LIMITE_JOUR")) || LIMITE_JOUR_DEFAUT,
    // Prestataires de l'entreprise et noms de clients vus dans la conversation (gardés dans la carte, que la personne ne peut pas modifier).
    noms: [...(partenaires.data || []).map((p) => String(p.nom || "").trim()), ...((((carte.data as any)?.donnees?.noms_proteges) || []) as unknown[]).map((n) => String(n || "").trim())].filter((n) => n.length > 2),
  });
  if (!controle.ok) return json({ erreur: controle.erreur, ...(controle.motifs ? { motifs: controle.motifs } : {}), ...(controle.limite ? { limite: controle.limite } : {}) }, controle.statut);
  const jeton = Deno.env.get("GITHUB_ISSUES_TOKEN");
  if (!jeton) return json({ erreur: "non_configure" }, 503);

  const ligne = await admin
    .from("ameliorations")
    .insert({ entite_id: d.entite_id, user_id: qui.user.id, conversation_id: c!.conversation_id, carte_id: c!.id, titre: controle.titre, texte: controle.texte, statut: "envoyee" })
    .select("id, entite_id, titre, texte, statut, issue_numero, issue_url, pr_url, sensible, cree_le, maj_le")
    .single();
  if (ligne.error) return json({ erreur: manquante(ligne.error) ? "migration_manquante" : ligne.error.code === "23505" ? "deja_decidee" : "base" }, ligne.error.code === "23505" ? 409 : 500);

  // La carte est prise avant GitHub et validée après l'issue (envoyerAvecCarte, envoi.js) : jamais d'issue pour une carte décidée ailleurs,
  // jamais de carte validée sans issue.
  const fonctionnement = (reglages.data?.valeur as { fonctionnement?: string } | null)?.fonctionnement || "sur_mesure";
  const COL_AMELIORATION = "id, entite_id, titre, texte, statut, issue_numero, issue_url, pr_url, sensible, cree_le, maj_le";
  const absente = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST202" || e.code === "42883" || /Could not find the function|does not exist/i.test(e.message || ""));
  const r = await envoyerAvecCarte({
    prendre: async () => {
      // `forcer` : la personne a confirmé « Reprendre la carte » après une prise expirée d'une autre personne.
      const p = await sb.rpc("prendre_agent_carte_equipe", { p_carte: c!.id, p_forcer: d.forcer === true });
      if (p.error) return absente(p.error) ? { ok: true } : { ok: false, raison: "erreur" };
      return p.data || { ok: false };
    },
    creerIssue: async () => {
      try {
        const rep = await fetch(`https://api.github.com/repos/${DEPOT}/issues`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jeton}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "gestion-ameliorations", "Content-Type": "application/json" },
          body: JSON.stringify({ title: titreIssue(controle.titre), body: corpsIssue({ id: ligne.data.id, texte: controle.texte, entreprise: ent.data?.nom || "", fonctionnement, date: dateBangkok() }), labels: [LABEL] }),
          signal: AbortSignal.timeout(15_000),
        });
        if (rep.ok) return await rep.json();
        console.error("ameliorations : GitHub", rep.status, (await rep.text()).slice(0, 200));
      } catch (err) {
        console.error("ameliorations : GitHub", err instanceof Error ? err.name : "erreur");
      }
      return null;
    },
    enregistrerIssue: async (issue: { number: number; html_url: string }) => {
      const maj = await admin.from("ameliorations").update({ issue_numero: issue.number, issue_url: issue.html_url, maj_le: new Date().toISOString() }).eq("id", ligne.data.id).select(COL_AMELIORATION).single();
      return maj.data || ligne.data;
    },
    valider: async () => (await sb.from("agent_cartes").update({ statut: "validee" }).eq("id", c!.id).select("id, conversation_id, genre, titre, donnees, avertissements, statut, cree_le, decide_le").single()).data || null,
    rendre: async () => {
      await sb.rpc("rendre_agent_carte", { p_carte: c!.id });
    },
    effacerLigne: async () => {
      await admin.from("ameliorations").delete().eq("id", ligne.data.id);
    },
  });
  if ("erreur" in r) return json({ erreur: r.erreur, ...("par" in r && r.par ? { par: r.par } : {}), ...("depuis" in r && r.depuis ? { depuis: r.depuis } : {}) }, r.statut);
  return json({ amelioration: r.amelioration, carte: r.carte, ...("a_confirmer" in r && r.a_confirmer ? { a_confirmer: true } : {}) });
});
