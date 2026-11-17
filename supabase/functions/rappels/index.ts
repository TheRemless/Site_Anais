// Fonction planifiée « rappels ». Deux façons de l'appeler :
// - { "type": "auto" } chaque heure par pg_cron : elle envoie le rappel de la veille et celui du lendemain des entreprises dont l'heure réglée
//   (Réglages > rappels, 18 h et 9 h par défaut, heure de Bangkok) est l'heure qu'il est à Bangkok (17.11.2026) ;
// - { "type": "veille" } ou { "type": "lendemain" } : envoi forcé, à toute heure, pour toutes les entreprises où ce rappel n'est pas coupé
//   (l'ancien cron de 18 h et 9 h, et les essais).
// Elle lit les réservations avec la clé de service, calcule le texte de chaque personne selon les entreprises qu'elle voit et dans sa langue,
// puis envoie une notification Web Push à chacun de ses appareils abonnés. Aucun nom de client ne part dans la notification.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { dateBangkok, dateCible, entitesLisibles, rappelDuType, heureBangkok, entitesDuRappel, restreindre, TYPES } from "./calc.js";

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
  if (demande.type !== "auto" && !TYPES.includes(demande.type)) return json({ erreur: "type inconnu" }, 400);
  // `date`, `heure` et `user_id` ne servent qu'aux essais : sans eux, c'est la date et l'heure de Bangkok et tous les abonnés.
  const aujourdhui = /^\d{4}-\d{2}-\d{2}$/.test(demande.date || "") ? demande.date : dateBangkok();
  const heure = demande.type === "auto" ? (Number.isInteger(demande.heure) && demande.heure >= 0 && demande.heure <= 23 ? demande.heure : heureBangkok()) : null;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

  // Les heures réglées de chaque entreprise (reglages.valeur.rappels). Sans lecture possible, l'appel s'arrête et le dit : mieux vaut aucun rappel qu'un rappel à la mauvaise heure.
  const [entites, reglages] = await Promise.all([db.from("entites").select("id, nom"), db.from("reglages").select("entite_id, rappels:valeur->rappels")]);
  if (entites.error || reglages.error) return json({ erreur: (entites.error || reglages.error)!.message }, 500);
  const parEntite = Object.fromEntries((reglages.data || []).map((r) => [r.entite_id, r.rappels]));
  const ids = (entites.data || []).map((e) => e.id);

  const resultats = [];
  for (const type of demande.type === "auto" ? TYPES : [demande.type]) {
    const retenues = entitesDuRappel(type, heure, ids, parEntite);
    if (!retenues.length) continue;
    const cible = dateCible(type, aujourdhui)!;
    // Chaque envoi laisse une ligne de suivi (date, type, envoyés, échecs, erreur) : « le cron a réussi » ne dit que la requête est partie, pas que les
    // rappels ont été envoyés (le 11.11.2026 la requête a expiré après 5 s sans que personne le sache). Les essais ciblés (`user_id`) ne sont pas notés.
    // Une heure où aucune entreprise n'a de rappel ne laisse pas de ligne.
    const debut = Date.now();
    let res = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0 };
    let erreur = "";
    try {
      res = await executer(db, type, aujourdhui, cible, demande, retenues, entites.data || []);
    } catch (err) {
      erreur = String((err && err.message) || err).slice(0, 300);
    }
    if (!demande.user_id) {
      const { error } = await db.from("rappels_suivi").insert({ type, cible, ...res, erreur, duree_ms: Date.now() - debut });
      if (error) console.error("suivi des rappels non écrit :", error.message);
    }
    resultats.push({ type, cible, ...res, ...(erreur ? { erreur } : {}) });
  }
  return json({ heure, resultats }, resultats.some((r) => r.erreur) ? 500 : 200);
});

// Envoie les rappels d'un type pour une date cible, pour les entreprises `retenues`, et renvoie les comptes. Lève une erreur si la base répond mal : l'appelant la note.
async function executer(db: ReturnType<typeof createClient>, type: string, aujourdhui: string, cible: string, demande: { user_id?: string }, retenues: string[], entites: { id: string; nom: string }[]) {
  let requeteAbos = db.from("abonnements_push").select("id, user_id, endpoint, p256dh, auth");
  if (demande.user_id) requeteAbos = requeteAbos.eq("user_id", demande.user_id);
  const { data: abos, error: errAbos } = await requeteAbos;
  if (errAbos) throw new Error(errAbos.message);
  if (!abos?.length) return { abonnements: 0, envoyes: 0, retires: 0, echecs: 0 };

  const ids = [...new Set(abos.map((a) => a.user_id))];
  const [profils, membres, roles, reservations] = await Promise.all([
    db.from("profils").select("user_id, actif, super_admin, langue").in("user_id", ids),
    db.from("membres").select("user_id, entite_id, role_id").in("user_id", ids),
    db.from("roles").select("id, portee, permissions"),
    // La veille : les services qui partent demain. Le lendemain : ceux qui se sont terminés hier, donc aussi une location prise plus tôt et rendue hier (details.retour_date).
    db.from("reservations").select("entite_id, dossier_id, statut, heure_pickup, lieu_pickup, date_service, libelle, partenaire_id, details").in("entite_id", retenues).or(type === "lendemain" ? `date_service.eq.${cible},details->>retour_date.eq.${cible}` : `date_service.eq.${cible}`).neq("statut", "annule"),
  ]);
  for (const r of [profils, membres, roles, reservations]) if (r.error) throw new Error(r.error.message);

  // Les dossiers des services : annulés à écarter, et l'hôtel du client quand la réservation n'a pas de lieu de pickup (même règle que la feuille du jour).
  const dossiersIds = [...new Set(reservations.data!.map((r) => r.dossier_id))];
  const dossiers = dossiersIds.length ? await db.from("dossiers").select("id, annule, client_id").in("id", dossiersIds) : { data: [], error: null };
  if (dossiers.error) throw new Error(dossiers.error.message);
  const ecartes = new Set((dossiers.data || []).filter((d) => d.annule).map((d) => d.id));
  const clientsIds = [...new Set((dossiers.data || []).map((d) => d.client_id).filter(Boolean))];
  const clients = clientsIds.length ? await db.from("clients").select("id, adresse").in("id", clientsIds) : { data: [], error: null };
  if (clients.error) throw new Error(clients.error.message);
  const adresseDe = new Map((dossiers.data || []).map((d) => [d.id, String(((clients.data || []).find((c) => c.id === d.client_id) || {}).adresse || "").split("\n")[0]]));
  const services = reservations.data!.map((r) => ({ ...r, adresse_client: adresseDe.get(r.dossier_id) || "" }));
  const nomEntite = (id: string) => (entites.find((e) => e.id === id) || { nom: "" }).nom;

  let envoyes = 0;
  let retires = 0;
  let echecs = 0;
  for (const userId of ids) {
    const profil = profils.data!.find((p) => p.user_id === userId);
    if (!profil) continue;
    const lisibles = entitesLisibles({ profil, membres: membres.data!, roles: roles.data! });
    const entiteIds = restreindre(lisibles, retenues);
    const message = rappelDuType(type, services, aujourdhui, { entiteIds, ecartes, nomEntite, langue: profil.langue === "en" ? "en" : "fr" });
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
  return { abonnements: abos.length, envoyes, retires, echecs };
}
