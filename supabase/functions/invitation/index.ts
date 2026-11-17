// Fonction « invitation » : l'outil l'appelle avec la session de l'administratrice générale (Administration, lot D du 17.11.2026).
// Elle vérifie qui appelle avec la base (est_super_admin(), même règle que les tables), puis seulement alors utilise la clé de service,
// qui ne quitte jamais le serveur, pour créer un compte, rendre un lien de mot de passe ou supprimer un compte.
// Aucun e-mail n'est envoyé : l'outil montre le lien, Anaïs l'envoie elle-même. Voir calc.js pour les règles.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { accesCoherents, dejaInscrit, lireDemande, suppressionPermise } from "./calc.js";

const ORIGINES = (Deno.env.get("INVITATION_ORIGINES") || "https://gestion.zwaldtravelplanner.com").split(",").map((x) => x.trim()).filter(Boolean);

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
  const lu = lireDemande(await req.json().catch(() => null), { origines: ORIGINES });
  if (!lu.ok) return json({ erreur: lu.erreur }, 400);

  const URL_SB = Deno.env.get("SUPABASE_URL")!;
  // Client « au nom de la personne » : sert seulement à savoir qui appelle et si elle est administratrice générale.
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
  const { data: qui, error: errQui } = await sb.auth.getUser();
  if (errQui || !qui?.user) return json({ erreur: "non_connecte" }, 401);
  const { data: estAdmin, error: errAdmin } = await sb.rpc("est_super_admin");
  if (errAdmin) return json({ erreur: "base" }, 500);
  if (estAdmin !== true) return json({ erreur: "droit_manquant" }, 403);

  // Client de service : seulement après le contrôle ci-dessus.
  const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const noter = (action: string, libelle: string, cible: string) =>
    admin.from("journal").insert({ entite_id: null, user_id: qui.user.id, table_name: "comptes", action, cible, libelle, details: {} }).then(() => null, () => null);

  if (lu.action === "inviter") {
    if (lu.acces.length) {
      const { data: roles, error } = await admin.from("roles").select("id, entite_id").in("id", lu.acces.map((a) => a.role_id));
      if (error) return json({ erreur: "base" }, 500);
      if (!accesCoherents(lu.acces, roles || [])) return json({ erreur: "acces_invalide" }, 400);
    }
    const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email: lu.email, options: { redirectTo: lu.retour } });
    if (error) return json({ erreur: dejaInscrit(error.message) ? "deja_inscrit" : "creation_impossible" }, dejaInscrit(error.message) ? 409 : 500);
    const userId = data.user.id;
    // Le profil est créé par la base à l'inscription (creer_profil) ; on y met le nom et la langue choisis.
    const profil = await admin.from("profils").upsert({ user_id: userId, email: lu.email, nom: lu.nom || null, langue: lu.langue, actif: true }, { onConflict: "user_id" });
    if (profil.error) return json({ erreur: "profil_impossible", user_id: userId, lien: data.properties.action_link }, 500);
    if (lu.acces.length) {
      const m = await admin.from("membres").upsert(lu.acces.map((a) => ({ user_id: userId, entite_id: a.entite_id, role_id: a.role_id })), { onConflict: "user_id,entite_id" });
      // Le compte existe déjà : l'outil le dit et propose de régler les accès à la main plutôt que de tout perdre.
      if (m.error) return json({ erreur: "acces_impossible", user_id: userId, lien: data.properties.action_link }, 500);
    }
    await noter("invite", lu.email, userId);
    return json({ user_id: userId, lien: data.properties.action_link });
  }

  if (lu.action === "lien_mot_de_passe") {
    const { data: p, error } = await admin.from("profils").select("email").eq("user_id", lu.userId).maybeSingle();
    if (error) return json({ erreur: "base" }, 500);
    if (!p?.email) return json({ erreur: "personne_inconnue" }, 404);
    const lien = await admin.auth.admin.generateLink({ type: "recovery", email: p.email, options: { redirectTo: lu.retour } });
    if (lien.error) return json({ erreur: "lien_impossible" }, 500);
    await noter("lien_mot_de_passe", p.email, lu.userId);
    return json({ lien: lien.data.properties.action_link });
  }

  // Supprimer un compte.
  const [{ data: cible, error: e1 }, { count, error: e2 }] = await Promise.all([
    admin.from("profils").select("user_id, email, super_admin, actif").eq("user_id", lu.userId).maybeSingle(),
    admin.from("profils").select("user_id", { count: "exact", head: true }).eq("super_admin", true).eq("actif", true),
  ]);
  if (e1 || e2) return json({ erreur: "base" }, 500);
  const permis = suppressionPermise({ appelant: qui.user.id, cible, superAdminsActifs: count || 0 });
  if (!permis.ok) return json({ erreur: permis.erreur }, 400);
  const { error } = await admin.auth.admin.deleteUser(lu.userId);
  if (error) return json({ erreur: "suppression_impossible" }, 500);
  await noter("delete", cible!.email || "", lu.userId);
  return json({ ok: true });
});
