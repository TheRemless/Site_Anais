// Fonction planifiée « rappels » : appelée par pg_cron à 18h (veille) et 9h (lendemain), heure de Bangkok, et toutes les 5 minutes pour le rappel
// une heure avant chaque service (« h1 », migration 31).
// Elle lit les réservations avec la clé de service, calcule le texte de chaque personne selon les entreprises qu'elle voit,
// puis envoie une notification Web Push à chacun de ses appareils abonnés. Aucun nom de client ne part dans la notification.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { dateBangkok, dateCible, entitesLisibles, rappelDuType, rappelAvantActif, modeRappel, servicesH1, datesH1, messageH1, destinatairesH1, nomClient, departsDemain, messageDepart, messageTest } from "./calc.js";

const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });

// Comparaison en temps constant : on compare les empreintes pour que la durée ne révèle pas combien de caractères du secret sont justes.
async function memeSecret(a: string, b: string) {
  const empreinte = async (x: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)));
  const [ha, hb] = await Promise.all([empreinte(a), empreinte(b)]);
  let ecart = 0;
  for (let i = 0; i < ha.length; i++) ecart |= ha[i] ^ hb[i];
  return ecart === 0;
}

// Le bouton « Envoyer une notification test » appelle la fonction depuis l'outil (navigateur) : seulement pour lui, CORS limité à Gestion.
const ORIGINES = ["https://gestion.zwaldtravelplanner.com", "https://zwaldtravelplanner.com"];
const entetesTest = (req: Request) => {
  const origine = req.headers.get("origin") || "";
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origine);
  return { "Access-Control-Allow-Origin": ORIGINES.includes(origine) || local ? origine : ORIGINES[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin", "Content-Type": "application/json" };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: entetesTest(req) });
  const fourni = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const demande = await req.json().catch(() => ({}));
  // Notification test : le jeton de la personne connectée, qui doit être administratrice générale. Jamais le secret du cron, jamais sans compte.
  if (demande && demande.type === "test") return notificationTest(req, fourni, demande);
  const secret = Deno.env.get("RAPPELS_SECRET");
  if (!secret || !(await memeSecret(fourni, secret))) return json({ erreur: "non autorisé" }, 401);
  const type = demande.type;
  if (type === "h1") return rappelH1(demande);
  if (type !== "veille" && type !== "lendemain") return json({ erreur: "type inconnu" }, 400);
  // `date` et `user_id` ne servent qu'aux essais : sans eux, c'est la date du jour à Bangkok et tous les abonnés.
  const aujourdhui = /^\d{4}-\d{2}-\d{2}$/.test(demande.date || "") ? demande.date : dateBangkok();
  const cible = dateCible(type, aujourdhui)!;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

  // Chaque exécution laisse une ligne de suivi (date, type, envoyés, échecs, erreur) : « le cron a réussi » ne dit que la requête est partie, pas que les
  // rappels ont été envoyés (le 11.11.2026 la requête a expiré après 5 s sans que personne le sache). Les essais ciblés (`user_id`) ne sont pas notés.
  const debut = Date.now();
  let res = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0 };
  let erreur = "";
  try {
    res = await executer(db, type, aujourdhui, cible, demande);
  } catch (err) {
    erreur = String((err && err.message) || err).slice(0, 300);
  }
  // 18h : en plus du résumé, le départ de demain de chaque voyage ZTP (une notification par dossier, une seule fois par date de départ).
  // À part : une panne du résumé ne prive pas les départs de leur rappel, et inversement.
  if (type === "veille") {
    try {
      const dep = await executerDeparts(db, cible, demande);
      res = { abonnements: Math.max(res.abonnements, dep.abonnements), envoyes: res.envoyes + dep.envoyes, retires: res.retires + dep.retires, echecs: res.echecs + dep.echecs };
    } catch (err) {
      erreur = [erreur, `départs : ${String((err && err.message) || err)}`].filter(Boolean).join(" ; ").slice(0, 300);
    }
  }
  if (!demande.user_id) {
    const { error } = await db.from("rappels_suivi").insert({ type, cible, ...res, erreur, duree_ms: Date.now() - debut });
    if (error) console.error("suivi des rappels non écrit :", error.message);
  }
  return json({ type, cible, ...res, ...(erreur ? { erreur } : {}) }, erreur ? 500 : 200);
});

// Envoie les rappels d'un type pour une date cible et renvoie les comptes. Lève une erreur si la base répond mal : l'appelant la note.
async function executer(db: ReturnType<typeof createClient>, type: string, aujourdhui: string, cible: string, demande: { user_id?: string }) {
  let requeteAbos = db.from("abonnements_push").select("id, user_id, endpoint, p256dh, auth");
  if (demande.user_id) requeteAbos = requeteAbos.eq("user_id", demande.user_id);
  const { data: abos, error: errAbos } = await requeteAbos;
  if (errAbos) throw new Error(errAbos.message);
  if (!abos?.length) return { abonnements: 0, envoyes: 0, retires: 0, echecs: 0 };

  const ids = [...new Set(abos.map((a) => a.user_id))];
  const [profils, membres, roles, entites, reservations] = await Promise.all([
    db.from("profils").select("user_id, actif, super_admin").in("user_id", ids),
    db.from("membres").select("user_id, entite_id, role_id").in("user_id", ids),
    db.from("roles").select("id, portee, permissions"),
    db.from("entites").select("id, nom"),
    // 18h : les services qui partent demain. 9h : ceux qui se sont terminés hier, donc aussi une location prise plus tôt et rendue hier (details.retour_date).
    db.from("reservations").select("entite_id, dossier_id, statut, heure_pickup, date_service, libelle, partenaire_id, details").or(type === "lendemain" ? `date_service.eq.${cible},details->>retour_date.eq.${cible}` : `date_service.eq.${cible}`).neq("statut", "annule"),
  ]);
  for (const r of [profils, membres, roles, entites, reservations]) if (r.error) throw new Error(r.error.message);

  const dossiersIds = [...new Set(reservations.data!.map((r) => r.dossier_id))];
  const annules = dossiersIds.length ? await db.from("dossiers").select("id").eq("annule", true).in("id", dossiersIds) : { data: [], error: null };
  if (annules.error) throw new Error(annules.error.message);
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
  return { abonnements: abos.length, envoyes, retires, echecs };
}

// ---- Rappel une heure avant chaque service ----------------------------------------------------------------------------------------------
// `maintenant` (ISO) et `user_id` ne servent qu'aux essais. Une exécution sans service à rappeler ne laisse pas de ligne de suivi (il y en aurait 288 par jour) ;
// un envoi ou une erreur en laisse une, comme les rappels de 18h et 9h.
async function rappelH1(demande: { maintenant?: string; user_id?: string }) {
  const maintenant = demande.maintenant && !Number.isNaN(Date.parse(demande.maintenant)) ? Date.parse(demande.maintenant) : Date.now();
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const debut = Date.now();
  let res = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0, services: 0 };
  let erreur = "";
  try {
    res = await executerH1(db, maintenant, demande);
  } catch (err) {
    erreur = String((err && err.message) || err).slice(0, 300);
  }
  if (!demande.user_id && (res.envoyes || res.echecs || erreur)) {
    const { abonnements, envoyes, retires, echecs } = res;
    const { error } = await db.from("rappels_suivi").insert({ type: "h1", cible: dateBangkok(new Date(maintenant)), abonnements, envoyes, retires, echecs, erreur, duree_ms: Date.now() - debut });
    if (error) console.error("suivi du rappel h1 non écrit :", error.message);
  }
  return json({ type: "h1", ...res, ...(erreur ? { erreur } : {}) }, erreur ? 500 : 200);
}

async function executerH1(db: ReturnType<typeof createClient>, maintenant: number, demande: { user_id?: string }) {
  const vide = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0, services: 0 };
  const [reglages, reservations] = await Promise.all([
    db.from("reglages").select("entite_id, valeur"),
    db.from("reservations").select("id, entite_id, dossier_id, statut, heure_pickup, date_service, libelle, partenaire_id, lieu_pickup, personnes, details").in("date_service", datesH1(maintenant)).neq("statut", "annule"),
  ]);
  for (const r of [reglages, reservations]) if (r.error) throw new Error(r.error.message);
  // Seules les entreprises de services (Secret, Taxi) qui ont le rappel allumé ; ZTP a le sien la veille du départ, pas un par service.
  const actives = new Set(reglages.data!.filter((l) => rappelAvantActif(l.valeur) && modeRappel(l.valeur) === "service").map((l) => l.entite_id));
  const candidates = reservations.data!.filter((r) => actives.has(r.entite_id));
  if (!candidates.length) return vide;
  const dossiersIds = [...new Set(candidates.map((r) => r.dossier_id))];
  const dossiers = await db.from("dossiers").select("id, annule, client_id").in("id", dossiersIds);
  if (dossiers.error) throw new Error(dossiers.error.message);
  const aRappeler = servicesH1(candidates, maintenant, { ecartes: new Set((dossiers.data || []).filter((d) => d.annule).map((d) => d.id)) });
  if (!aRappeler.length) return vide;

  let requeteAbos = db.from("abonnements_push").select("id, user_id, endpoint, p256dh, auth");
  if (demande.user_id) requeteAbos = requeteAbos.eq("user_id", demande.user_id);
  // Tout ce qu'il faut pour envoyer est lu AVANT le marquage : une lecture qui échoue laisse les services non marqués, rattrapés au passage suivant.
  const clientIds = [...new Set((dossiers.data || []).map((d) => d.client_id).filter(Boolean))];
  const [abos, profils, membres, roles, entites, clients] = await Promise.all([
    requeteAbos,
    db.from("profils").select("user_id, actif, super_admin, rappel_h1"),
    db.from("membres").select("user_id, entite_id, role_id"),
    db.from("roles").select("id, portee, permissions"),
    db.from("entites").select("id, nom"),
    db.from("clients").select("id, prenom, nom").in("id", clientIds.length ? clientIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  for (const r of [abos, profils, membres, roles, entites, clients]) if (r.error) throw new Error(r.error.message);
  if (!abos.data!.length) return { ...vide, services: aRappeler.length };
  const clientDe = (r: { dossier_id: string }) => {
    const d = (dossiers.data || []).find((x) => x.id === r.dossier_id);
    return nomClient((clients.data || []).find((c) => c.id === (d && d.client_id)));
  };
  // Marquage avant l'envoi, en une écriture : une ligne par service et par heure de début. Deux exécutions qui se chevauchent ne notifient
  // pas deux fois ; une heure changée donne une autre clé, donc un nouveau rappel. Un essai ciblé (user_id) ne marque rien.
  let nouveaux = aRappeler;
  if (!demande.user_id) {
    const { data: marques, error } = await db.from("rappels_h1_envois").upsert(aRappeler.map((x) => ({ reservation_id: x.reservation.id, debut: new Date(x.debut).toISOString() })), { onConflict: "reservation_id,debut", ignoreDuplicates: true }).select("reservation_id");
    if (error) throw new Error(error.message);
    const ids = new Set((marques || []).map((m) => m.reservation_id));
    nouveaux = aRappeler.filter((x) => ids.has(x.reservation.id));
  }
  if (!nouveaux.length) return { ...vide, abonnements: abos.data!.length, services: aRappeler.length };

  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  const ctx = { profils: profils.data!, membres: membres.data!, roles: roles.data! };
  const nomEntite = (id: string) => (entites.data!.find((e) => e.id === id) || { nom: "" }).nom;
  // Le nom de l'entreprise n'est ajouté que pour qui en suit plusieurs (Anaïs : Secret et Taxi).
  const plusieurs = (userId: string) => {
    const profil = ctx.profils.find((p) => p.user_id === userId);
    const ids = entitesLisibles({ profil, membres: ctx.membres, roles: ctx.roles });
    return ids === null || ids.length > 1;
  };
  let envoyes = 0;
  let retires = 0;
  let echecs = 0;
  const retiresIds = new Set();
  for (const service of nouveaux) {
    for (const userId of destinatairesH1(ctx, service.reservation.entite_id)) {
      const charge = JSON.stringify(messageH1(service, { entreprise: plusieurs(userId) ? nomEntite(service.reservation.entite_id) : "", client: clientDe(service.reservation) }));
      for (const abo of abos.data!.filter((a) => a.user_id === userId && !retiresIds.has(a.id))) {
        try {
          // TTL court : un rappel « dans 1 h » qui arrive deux heures plus tard n'a plus de sens.
          await webpush.sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, charge, { TTL: 3600, urgency: "high" });
          envoyes++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await db.from("abonnements_push").delete().eq("id", abo.id);
            retiresIds.add(abo.id);
            retires++;
          } else echecs++;
        }
      }
    }
  }
  return { abonnements: abos.data!.length, envoyes, retires, echecs, services: nouveaux.length };
}

// ---- ZTP : départ du client demain (appelé par le passage de 18h) ----------------------------------------------------------------------
async function executerDeparts(db: ReturnType<typeof createClient>, demain: string, demande: { user_id?: string }) {
  const vide = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0 };
  const reglages = await db.from("reglages").select("entite_id, valeur");
  if (reglages.error) throw new Error(reglages.error.message);
  const actives = reglages.data!.filter((l) => rappelAvantActif(l.valeur) && modeRappel(l.valeur) === "depart").map((l) => l.entite_id);
  if (!actives.length) return vide;
  const lus = await db.from("dossiers").select("id, entite_id, ref, client_id, bandeau, pays, date_depart, accepte_le, annule, sans_suite_le").in("entite_id", actives).eq("date_depart", demain);
  if (lus.error) throw new Error(lus.error.message);
  const partent = departsDemain(lus.data || [], demain);
  if (!partent.length) return vide;
  let requeteAbos = db.from("abonnements_push").select("id, user_id, endpoint, p256dh, auth");
  if (demande.user_id) requeteAbos = requeteAbos.eq("user_id", demande.user_id);
  const [abos, profils, membres, roles, entites, clients] = await Promise.all([
    requeteAbos,
    db.from("profils").select("user_id, actif, super_admin, rappel_h1"),
    db.from("membres").select("user_id, entite_id, role_id"),
    db.from("roles").select("id, portee, permissions"),
    db.from("entites").select("id, nom"),
    db.from("clients").select("id, prenom, nom").in("id", [...new Set(partent.map((d) => d.client_id))]),
  ]);
  for (const r of [abos, profils, membres, roles, entites, clients]) if (r.error) throw new Error(r.error.message);
  if (!abos.data!.length) return vide;
  // Marquage après les lectures, juste avant l'envoi (même raison que pour le rappel d'une heure avant).
  let nouveaux = partent;
  if (!demande.user_id) {
    const { data: marques, error } = await db.from("rappels_depart_envois").upsert(partent.map((d) => ({ dossier_id: d.id, date_depart: d.date_depart })), { onConflict: "dossier_id,date_depart", ignoreDuplicates: true }).select("dossier_id");
    if (error) throw new Error(error.message);
    const ids = new Set((marques || []).map((m) => m.dossier_id));
    nouveaux = partent.filter((d) => ids.has(d.id));
  }
  if (!nouveaux.length) return vide;
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  const ctx = { profils: profils.data!, membres: membres.data!, roles: roles.data! };
  const nomEntite = (id: string) => (entites.data!.find((e) => e.id === id) || { nom: "" }).nom;
  let envoyes = 0;
  let retires = 0;
  let echecs = 0;
  const retiresIds = new Set();
  for (const d of nouveaux) {
    for (const userId of destinatairesH1(ctx, d.entite_id)) {
      const ids = entitesLisibles({ profil: ctx.profils.find((p) => p.user_id === userId), membres: ctx.membres, roles: ctx.roles });
      const charge = JSON.stringify(messageDepart(d, { client: nomClient(clients.data!.find((c) => c.id === d.client_id)), entreprise: ids === null || ids.length > 1 ? nomEntite(d.entite_id) : "" }));
      for (const abo of abos.data!.filter((a) => a.user_id === userId && !retiresIds.has(a.id))) {
        try {
          await webpush.sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, charge, { TTL: 6 * 3600 });
          envoyes++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await db.from("abonnements_push").delete().eq("id", abo.id);
            retiresIds.add(abo.id);
            retires++;
          } else echecs++;
        }
      }
    }
  }
  return { abonnements: abos.data!.length, envoyes, retires, echecs };
}

// ---- Notification test (bouton des réglages, administratrice générale seulement) -----------------------------------------------------
// Rien n'est lu ni marqué : un message fictif, marqué [TEST], vers les appareils du profil choisi. Renvoie le nombre d'appareils et d'envois,
// ce qui dit aussi si la personne a un abonnement actif.
async function notificationTest(req: Request, jeton: string, demande: { user_id?: string }) {
  const h = entetesTest(req);
  const repondre = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: h });
  if (!jeton) return repondre({ erreur: "non_connecte" }, 401);
  const URL_SB = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${jeton}` } }, auth: { persistSession: false } });
  const { data: qui, error } = await sb.auth.getUser();
  if (error || !qui?.user) return repondre({ erreur: "non_connecte" }, 401);
  const db = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const moi = await db.from("profils").select("super_admin, actif").eq("user_id", qui.user.id).maybeSingle();
  if (moi.error) return repondre({ erreur: "base" }, 500);
  if (!moi.data || !moi.data.super_admin || !moi.data.actif) return repondre({ erreur: "reserve_admin" }, 403);
  const cible = typeof demande.user_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(demande.user_id) ? demande.user_id : qui.user.id;
  const abos = await db.from("abonnements_push").select("id, endpoint, p256dh, auth").eq("user_id", cible);
  if (abos.error) return repondre({ erreur: "base" }, 500);
  if (!abos.data!.length) return repondre({ abonnements: 0, envoyes: 0, echecs: 0, retires: 0 });
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  const charge = JSON.stringify(messageTest());
  let envoyes = 0;
  let echecs = 0;
  let retires = 0;
  for (const abo of abos.data!) {
    try {
      await webpush.sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, charge, { TTL: 600, urgency: "high" });
      envoyes++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.from("abonnements_push").delete().eq("id", abo.id);
        retires++;
      } else echecs++;
    }
  }
  return repondre({ abonnements: abos.data!.length, envoyes, echecs, retires });
}
