// Fonction planifiée « rappels » : appelée par pg_cron à 18h (veille) et 9h (lendemain), heure de Bangkok.
// Elle lit les réservations avec la clé de service, calcule le texte de chaque personne selon les entreprises qu'elle voit,
// puis envoie une notification Web Push à chacun de ses appareils abonnés. Aucun nom de client ne part dans la notification.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { dateBangkok, dateCible, entitesLisibles, rappelDuType } from "./calc.js";

const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });

// Comparaison en temps constant : on compare les empreintes pour que la durée ne révèle pas combien de caractères du secret sont justes.
async function memeSecret(a: string, b: string) {
  const empreinte = async (x: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)));
  const [ha, hb] = await Promise.all([empreinte(a), empreinte(b)]);
  let ecart = 0;
  for (let i = 0; i < ha.length; i++) ecart |= ha[i] ^ hb[i];
  return ecart === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("RAPPELS_SECRET");
  const fourni = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!secret || !(await memeSecret(fourni, secret))) return json({ erreur: "non autorisé" }, 401);

  const demande = await req.json().catch(() => ({}));
  const type = demande.type;
  if (type !== "veille" && type !== "lendemain") return json({ erreur: "type inconnu" }, 400);
  // `date` et `user_id` ne servent qu'aux essais : sans eux, c'est la date du jour à Bangkok et tous les abonnés.
  const aujourdhui = /^\d{4}-\d{2}-\d{2}$/.test(demande.date || "") ? demande.date : dateBangkok();
  const cible = dateCible(type, aujourdhui)!;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

  let requeteAbos = db.from("abonnements_push").select("id, user_id, endpoint, p256dh, auth");
  if (demande.user_id) requeteAbos = requeteAbos.eq("user_id", demande.user_id);
  const { data: abos, error: errAbos } = await requeteAbos;
  if (errAbos) return json({ erreur: errAbos.message }, 500);
  if (!abos?.length) return json({ type, cible, abonnements: 0, envoyes: 0 });

  const ids = [...new Set(abos.map((a) => a.user_id))];
  const [profils, membres, roles, entites, reservations] = await Promise.all([
    db.from("profils").select("user_id, actif, super_admin").in("user_id", ids),
    db.from("membres").select("user_id, entite_id, role_id").in("user_id", ids),
    db.from("roles").select("id, portee, permissions"),
    db.from("entites").select("id, nom"),
    db.from("reservations").select("entite_id, dossier_id, statut, heure_pickup, date_service").eq("date_service", cible).neq("statut", "annule"),
  ]);
  for (const r of [profils, membres, roles, entites, reservations]) if (r.error) return json({ erreur: r.error.message }, 500);

  const dossiersIds = [...new Set(reservations.data!.map((r) => r.dossier_id))];
  const annules = dossiersIds.length ? await db.from("dossiers").select("id").eq("annule", true).in("id", dossiersIds) : { data: [], error: null };
  if (annules.error) return json({ erreur: annules.error.message }, 500);
  const ecartes = new Set((annules.data || []).map((d) => d.id));
  const nomEntite = (id: string) => (entites.data!.find((e) => e.id === id) || { nom: "" }).nom;

  let envoyes = 0;
  let retires = 0;
  let echecs = 0;
  for (const userId of ids) {
    const profil = profils.data!.find((p) => p.user_id === userId);
    if (!profil) continue;
    const entiteIds = entitesLisibles({ profil, membres: membres.data!, roles: roles.data! });
    const message = rappelDuType(type, reservations.data!, aujourdhui, { entiteIds, ecartes, nomEntite });
    if (!message) continue;
    const charge = JSON.stringify({ ...message, url: "/gestion/#/" });
    for (const abo of abos.filter((a) => a.user_id === userId)) {
      try {
        await webpush.sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, charge, { TTL: 6 * 3600 });
        envoyes++;
      } catch (err) {
        // 404 et 410 : l'appareil s'est désabonné ou l'app a été supprimée, on retire l'abonnement.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.from("abonnements_push").delete().eq("id", abo.id);
          retires++;
        } else echecs++;
      }
    }
  }
  return json({ type, cible, abonnements: abos.length, envoyes, retires, echecs });
});
