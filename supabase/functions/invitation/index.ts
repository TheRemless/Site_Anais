// Fonction « invitation » : l'outil l'appelle avec la session de l'administrateur d'une organisation (Administration, lot D du 17.11.2026),
// ou de l'éditeur du logiciel pour créer un client (étape 3 du SaaS). Chaque geste reste dans l'organisation de l'appelant.
// Elle vérifie qui appelle avec la base (est_super_admin(), même règle que les tables), puis seulement alors utilise la clé de service,
// qui ne quitte jamais le serveur, pour créer un compte, rendre un lien de mot de passe ou supprimer un compte.
// Aucun e-mail n'est envoyé : l'outil montre le lien, Anaïs l'envoie elle-même. Voir calc.js pour les règles.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { accesCoherents, dejaInscrit, entreprisesDeLOrganisation, invitationPermise, lireDemande, memeOrganisation, rattachementPermis, suppressionPermise } from "./calc.js";

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
  // Nouveau client : l'éditeur du logiciel seulement. Le compte est créé « en attente de sa propre organisation » (nouvelle_organisation),
  // puis creer_organisation, appelée avec la session de l'éditeur, le rend administrateur de la nouvelle organisation.
  if (lu.action === "creer_client") {
    const { data: estEditeur, error: errEd } = await sb.rpc("est_plateforme");
    if (errEd) return json({ erreur: "base" }, 500);
    if (estEditeur !== true) return json({ erreur: "droit_manquant" }, 403);
    const service = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.auth.admin.generateLink({ type: "invite", email: lu.email, options: { redirectTo: lu.retour, data: { nouvelle_organisation: "true" } } });
    if (error) return json({ erreur: dejaInscrit(error.message) ? "deja_inscrit" : "creation_impossible" }, dejaInscrit(error.message) ? 409 : 500);
    const userId = data.user.id;
    const org = await sb.rpc("creer_organisation", { p_nom: lu.organisation, p_email_admin: lu.email, p_fuseau: lu.fuseau, p_langue: lu.langue });
    if (org.error) {
      // Rien de bancal : sans organisation, le compte qui vient d'être créé est retiré.
      await service.auth.admin.deleteUser(userId).catch(() => null);
      return json({ erreur: "organisation_impossible" }, 500);
    }
    await service.from("profils").update({ nom: lu.nom || null, langue: lu.langue }).eq("user_id", userId);
    await service.from("journal").insert({ entite_id: null, organisation_id: org.data, user_id: qui.user.id, table_name: "organisations", action: "insert", cible: org.data, libelle: lu.organisation, details: {} }).then(() => null, () => null);
    return json({ user_id: userId, organisation_id: org.data, lien: data.properties.action_link });
  }

  const { data: estAdmin, error: errAdmin } = await sb.rpc("est_super_admin");
  if (errAdmin) return json({ erreur: "base" }, 500);
  if (estAdmin !== true) return json({ erreur: "droit_manquant" }, 403);

  // Client de service : seulement après le contrôle ci-dessus.
  const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const noter = (action: string, libelle: string, cible: string) =>
    admin.from("journal").insert({ entite_id: null, organisation_id: organisation, user_id: qui.user.id, table_name: "comptes", action, cible, libelle, details: {} }).then(() => null, () => null);
  // Organisation de l'administrateur (migration 42) : chaque geste reste dans celle-ci.
  const { data: moi, error: errMoi } = await admin.from("profils").select("organisation_id").eq("user_id", qui.user.id).maybeSingle();
  if (errMoi) return json({ erreur: "base" }, 500);
  const organisation = (moi && moi.organisation_id) || null;
  if (!organisation) return json({ erreur: "droit_manquant" }, 403);

  if (lu.action === "inviter") {
    if (lu.acces.length) {
      const [{ data: roles, error }, { data: ents, error: errE }] = await Promise.all([
        admin.from("roles").select("id, entite_id").in("id", lu.acces.map((a) => a.role_id)),
        admin.from("entites").select("id, organisation_id").in("id", lu.acces.map((a) => a.entite_id)),
      ]);
      if (error || errE) return json({ erreur: "base" }, 500);
      if (!accesCoherents(lu.acces, roles || []) || !entreprisesDeLOrganisation(lu.acces, ents || [], organisation)) return json({ erreur: "acces_invalide" }, 400);
    }
    // Adresse déjà inscrite dans une autre organisation (ou dans aucune) : refus avant tout lien. Un nouveau lien remplacerait celui que
    // la personne a reçu de son propre administrateur, et la suite rattacherait son compte à l'organisation de l'appelant.
    const { data: existant, error: errEx } = await admin.from("profils").select("organisation_id").eq("email", lu.email).maybeSingle();
    if (errEx) return json({ erreur: "base" }, 500);
    if (!invitationPermise(organisation, existant)) return json({ erreur: "deja_inscrit" }, 409);
    const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email: lu.email, options: { redirectTo: lu.retour } });
    if (error) return json({ erreur: dejaInscrit(error.message) ? "deja_inscrit" : "creation_impossible" }, dejaInscrit(error.message) ? 409 : 500);
    const userId = data.user.id;
    // Même contrôle sur le compte que Supabase a réellement touché : son lien n'est jamais renvoyé s'il est d'une autre organisation.
    const { data: touche, error: errT } = await admin.from("profils").select("organisation_id").eq("user_id", userId).maybeSingle();
    if (errT) return json({ erreur: "base" }, 500);
    if (!rattachementPermis(organisation, touche)) return json({ erreur: "deja_inscrit" }, 409);
    // Le profil est créé par la base à l'inscription (creer_profil) ; on y met le nom et la langue choisis.
    // Rattachement à l'organisation de l'administrateur, écrit ici avec la clé de service : la base ne croit jamais l'organisation venue
    // de la métadonnée d'un compte (n'importe qui la choisit en s'inscrivant). Sans langue choisie : celle de l'organisation.
    const { data: org } = await admin.from("organisations").select("langue").eq("id", organisation).maybeSingle();
    const profil = await admin.from("profils").upsert({ user_id: userId, email: lu.email, nom: lu.nom || null, organisation_id: organisation, langue: lu.langue || (org && org.langue) || null, actif: true }, { onConflict: "user_id" });
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
    const { data: p, error } = await admin.from("profils").select("email, organisation_id").eq("user_id", lu.userId).maybeSingle();
    if (error) return json({ erreur: "base" }, 500);
    // Un compte d'une autre organisation : même réponse qu'un compte inconnu (sinon, prise de compte par lien de mot de passe).
    if (!p?.email || !memeOrganisation(organisation, p)) return json({ erreur: "personne_inconnue" }, 404);
    const lien = await admin.auth.admin.generateLink({ type: "recovery", email: p.email, options: { redirectTo: lu.retour } });
    if (lien.error) return json({ erreur: "lien_impossible" }, 500);
    await noter("lien_mot_de_passe", p.email, lu.userId);
    return json({ lien: lien.data.properties.action_link });
  }

  // Supprimer un compte.
  const [{ data: cible, error: e1 }, { count, error: e2 }] = await Promise.all([
    admin.from("profils").select("user_id, email, super_admin, actif, organisation_id").eq("user_id", lu.userId).maybeSingle(),
    admin.from("profils").select("user_id", { count: "exact", head: true }).eq("super_admin", true).eq("actif", true).eq("organisation_id", organisation),
  ]);
  if (e1 || e2) return json({ erreur: "base" }, 500);
  const permis = suppressionPermise({ appelant: qui.user.id, cible, superAdminsActifs: count || 0, organisation });
  if (!permis.ok) return json({ erreur: permis.erreur }, 400);
  const { error } = await admin.auth.admin.deleteUser(lu.userId);
  if (error) return json({ erreur: "suppression_impossible" }, 500);
  await noter("delete", cible!.email || "", lu.userId);
  return json({ ok: true });
});
