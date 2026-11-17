// Fonction planifiée « rappels ». Façons de l'appeler (heure de Bangkok) :
// - { "type": "auto" } chaque heure par pg_cron : elle envoie le rappel de la veille et celui du lendemain des entreprises dont l'heure réglée
//   (Réglages > rappels, 18 h et 9 h par défaut) est l'heure qu'il est à Bangkok (lot G, 17.11.2026), et avec le passage de la veille le départ
//   de demain de chaque voyage ZTP (migration 31) ;
// - { "type": "veille" } ou { "type": "lendemain" } : envoi forcé, à toute heure, pour toutes les entreprises où ce rappel n'est pas coupé
//   (les crons de 18h et 9h posés avant le lot G, et les essais) ; la veille envoie aussi les départs ZTP de demain ;
// - { "type": "h1" } toutes les 5 minutes : le rappel une heure avant chaque service (Secret, Taxi, migration 31), et
//   { "mode": "h1", "service_id": "…", "force": true } pour forcer celui d'un service.
// Elle lit les réservations avec la clé de service, calcule le texte de chaque personne selon les entreprises qu'elle voit et dans sa langue,
// puis envoie une notification Web Push à chacun de ses appareils abonnés. Les résumés de la veille et du lendemain ne contiennent aucun nom de client.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { dateBangkok, dateCible, entitesLisibles, rappelDuType, heureBangkok, entitesDuRappel, entitesDuDepart, restreindre, TYPES, rappelAvantActif, modeRappel, servicesH1, datesH1, messageH1, destinatairesH1, nomClient, departsDemain, messageDepart, serviceForce } from "./calc.js";

const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });

// Comparaison en temps constant : on compare les empreintes pour que la durée ne révèle pas combien de caractères du secret sont justes.
async function memeSecret(a: string, b: string) {
  const empreinte = async (x: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)));
  const [ha, hb] = await Promise.all([empreinte(a), empreinte(b)]);
  let ecart = 0;
  for (let i = 0; i < ha.length; i++) ecart |= ha[i] ^ hb[i];
  return ecart === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Qui appelle : le cron (RAPPELS_SECRET), la clé de service du projet, ou (seulement pour l'envoi forcé d'un service) une administratrice
// générale connectée. Jamais un appel anonyme.
async function appelant(jeton: string) {
  if (!jeton) return null;
  const secret = Deno.env.get("RAPPELS_SECRET");
  if (secret && (await memeSecret(jeton, secret))) return "cron";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (service && (await memeSecret(jeton, service))) return "service";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${jeton}` } }, auth: { persistSession: false } });
  const { data: qui, error } = await sb.auth.getUser();
  if (error || !qui?.user) return null;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const moi = await db.from("profils").select("super_admin, actif").eq("user_id", qui.user.id).maybeSingle();
  return moi.data && moi.data.super_admin && moi.data.actif ? "admin" : null;
}

Deno.serve(async (req) => {
  const fourni = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const demande = (await req.json().catch(() => null)) || {};
  const qui = await appelant(fourni);
  if (!qui) return json({ erreur: "non autorisé" }, 401);
  // « mode » est accepté comme synonyme de « type » (appel à la main) : { mode: "h1", service_id, force: true }.
  const type = demande.type || demande.mode;
  if (type === "h1" && demande.force) return rappelForce(demande);
  // Une administratrice connectée n'a que l'envoi forcé : les passages planifiés restent au cron et à la clé de service.
  if (qui === "admin") return json({ erreur: "non autorisé" }, 401);
  if (type === "h1") return rappelH1(demande);
  if (type !== "auto" && !TYPES.includes(type)) return json({ erreur: "type inconnu" }, 400);
  // `date`, `heure` et `user_id` ne servent qu'aux essais : sans eux, c'est la date et l'heure de Bangkok et tous les abonnés.
  const aujourdhui = /^\d{4}-\d{2}-\d{2}$/.test(demande.date || "") ? demande.date : dateBangkok();
  const heure = type === "auto" ? (Number.isInteger(demande.heure) && demande.heure >= 0 && demande.heure <= 23 ? demande.heure : heureBangkok()) : null;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

  // Les réglages de chaque entreprise : heures des rappels (valeur.rappels) et rappel du départ (ZTP). Sans lecture possible, l'appel s'arrête et le dit :
  // mieux vaut aucun rappel qu'un rappel à la mauvaise heure.
  const [entites, reglages] = await Promise.all([db.from("entites").select("id, nom"), db.from("reglages").select("entite_id, valeur")]);
  if (entites.error || reglages.error) return json({ erreur: (entites.error || reglages.error)!.message }, 500);
  const valeurs = Object.fromEntries((reglages.data || []).map((r) => [r.entite_id, r.valeur]));
  const parEntite = Object.fromEntries(Object.entries(valeurs).map(([id, v]) => [id, v && typeof v === "object" ? (v as { rappels?: unknown }).rappels : undefined]));
  const ids = (entites.data || []).map((e) => e.id);

  const resultats = [];
  for (const t of type === "auto" ? TYPES : [type]) {
    const retenues = entitesDuRappel(t, heure, ids, parEntite);
    // Le départ de demain (ZTP) part avec le passage de la veille, à l'heure de la veille de l'entreprise (18 h si elle est coupée : il a son propre réglage).
    const departs = t === "veille" ? entitesDuDepart(heure, ids, valeurs) : [];
    if (!retenues.length && !departs.length) continue;
    const cible = dateCible(t, aujourdhui)!;
    // Chaque envoi laisse une ligne de suivi (date, type, envoyés, échecs, erreur) : « le cron a réussi » ne dit que la requête est partie, pas que les
    // rappels ont été envoyés (le 11.11.2026 la requête a expiré après 5 s sans que personne le sache). Les essais ciblés (`user_id`) ne sont pas notés.
    // Une heure où aucune entreprise n'a de rappel ne laisse pas de ligne.
    const debut = Date.now();
    let res = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0 };
    let erreur = "";
    if (retenues.length) {
      try {
        res = await executer(db, t, aujourdhui, cible, demande, retenues, entites.data || []);
      } catch (err) {
        erreur = String((err && err.message) || err).slice(0, 300);
      }
    }
    // À part : une panne du résumé ne prive pas les départs de leur rappel, et inversement.
    if (departs.length) {
      try {
        const dep = await executerDeparts(db, cible, demande, departs);
        res = { abonnements: Math.max(res.abonnements, dep.abonnements), envoyes: res.envoyes + dep.envoyes, retires: res.retires + dep.retires, echecs: res.echecs + dep.echecs };
      } catch (err) {
        erreur = [erreur, `départs : ${String((err && err.message) || err)}`].filter(Boolean).join(" ; ").slice(0, 300);
      }
    }
    if (!demande.user_id) {
      const { error } = await db.from("rappels_suivi").insert({ type: t, cible, ...res, erreur, duree_ms: Date.now() - debut });
      if (error) console.error("suivi des rappels non écrit :", error.message);
    }
    resultats.push({ type: t, cible, ...res, ...(erreur ? { erreur } : {}) });
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
  if (!demande.user_id && (res.envoyes || res.echecs || erreur)) await noterSuiviH1(db, maintenant, res, erreur, debut);
  return json({ type: "h1", ...res, ...(erreur ? { erreur } : {}) }, erreur ? 500 : 200);
}

async function noterSuiviH1(db: ReturnType<typeof createClient>, maintenant: number, res: { abonnements: number; envoyes: number; retires: number; echecs: number }, erreur: string, debut: number) {
  const { abonnements, envoyes, retires, echecs } = res;
  const { error } = await db.from("rappels_suivi").insert({ type: "h1", cible: dateBangkok(new Date(maintenant)), abonnements, envoyes, retires, echecs, erreur, duree_ms: Date.now() - debut });
  if (error) console.error("suivi du rappel h1 non écrit :", error.message);
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
  return envoyerH1(db, aRappeler, dossiers.data || [], { essai: !!demande.user_id, userId: demande.user_id, force: false });
}

// Envoi forcé d'un service : la même notification que le cron (texte, nom du client, destinataires, lien), tout de suite, hors de la fenêtre.
// Le service est marqué comme notifié pour son heure : le cron n'en enverra pas un second.
async function rappelForce(demande: { service_id?: string; maintenant?: string }) {
  if (typeof demande.service_id !== "string" || !UUID.test(demande.service_id)) return json({ erreur: "service_id manquant ou invalide" }, 400);
  const maintenant = demande.maintenant && !Number.isNaN(Date.parse(demande.maintenant)) ? Date.parse(demande.maintenant) : Date.now();
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const debut = Date.now();
  const lue = await db.from("reservations").select("id, entite_id, dossier_id, statut, heure_pickup, date_service, libelle, partenaire_id, lieu_pickup, personnes, details").eq("id", demande.service_id).maybeSingle();
  if (lue.error) return json({ erreur: lue.error.message }, 500);
  if (!lue.data) return json({ erreur: "service_introuvable" }, 404);
  const [dossier, reglages] = await Promise.all([
    db.from("dossiers").select("id, annule, client_id").eq("id", lue.data.dossier_id).maybeSingle(),
    db.from("reglages").select("valeur").eq("entite_id", lue.data.entite_id).maybeSingle(),
  ]);
  if (dossier.error || reglages.error) return json({ erreur: (dossier.error || reglages.error)!.message }, 500);
  const choix = serviceForce(lue.data, maintenant, { dossierAnnule: !!(dossier.data && dossier.data.annule), reglages: reglages.data ? reglages.data.valeur : null });
  if (choix.erreur) return json({ erreur: choix.erreur }, 409);
  let res = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0, services: 0 };
  let erreur = "";
  try {
    res = await envoyerH1(db, [choix.service], dossier.data ? [dossier.data] : [], { essai: false, force: true });
  } catch (err) {
    erreur = String((err && err.message) || err).slice(0, 300);
  }
  await noterSuiviH1(db, maintenant, res, erreur, debut);
  const m = messageH1(choix.service, { client: "" });
  return json({ type: "h1", force: true, service: { id: lue.data.id, libelle: lue.data.libelle, debut: new Date(choix.service.debut).toISOString(), quand: m.titre.split(" : ")[0] }, ...res, ...(erreur ? { erreur } : {}) }, erreur ? 500 : 200);
}

// Lit les destinataires, marque les services (une ligne par service et par heure), puis envoie. Tout est lu AVANT le marquage : une lecture qui
// échoue laisse les services non marqués, rattrapés au passage suivant. Un essai ciblé (userId) ne marque rien ; un envoi forcé marque mais
// envoie même si le service l'était déjà (c'est une demande explicite).
async function envoyerH1(db: ReturnType<typeof createClient>, aRappeler: Array<{ reservation: Record<string, unknown> & { id: string; entite_id: string; dossier_id: string }; debut: number; minutes: number }>, dossiers: Array<{ id: string; client_id: string }>, { essai, userId, force }: { essai: boolean; userId?: string; force: boolean }) {
  const vide = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0, services: 0 };
  let requeteAbos = db.from("abonnements_push").select("id, user_id, endpoint, p256dh, auth");
  if (userId) requeteAbos = requeteAbos.eq("user_id", userId);
  const clientIds = [...new Set(dossiers.map((d) => d.client_id).filter(Boolean))];
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
    const d = dossiers.find((x) => x.id === r.dossier_id);
    return nomClient((clients.data || []).find((c) => c.id === (d && d.client_id)));
  };
  // Marquage : deux exécutions qui se chevauchent ne notifient pas deux fois ; une heure changée donne une autre clé, donc un nouveau rappel.
  let nouveaux = aRappeler;
  if (!essai) {
    const { data: marques, error } = await db.from("rappels_h1_envois").upsert(aRappeler.map((x) => ({ reservation_id: x.reservation.id, debut: new Date(x.debut).toISOString() })), { onConflict: "reservation_id,debut", ignoreDuplicates: true }).select("reservation_id");
    if (error) throw new Error(error.message);
    if (!force) {
      const ids = new Set((marques || []).map((m) => m.reservation_id));
      nouveaux = aRappeler.filter((x) => ids.has(x.reservation.id));
    }
  }
  if (!nouveaux.length) return { ...vide, abonnements: abos.data!.length, services: aRappeler.length };

  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  const ctx = { profils: profils.data!, membres: membres.data!, roles: roles.data! };
  const nomEntite = (id: string) => (entites.data!.find((e) => e.id === id) || { nom: "" }).nom;
  // Le nom de l'entreprise n'est ajouté que pour qui en suit plusieurs (Anaïs : Secret et Taxi).
  const plusieurs = (id: string) => {
    const profil = ctx.profils.find((p) => p.user_id === id);
    const ids = entitesLisibles({ profil, membres: ctx.membres, roles: ctx.roles });
    return ids === null || ids.length > 1;
  };
  let envoyes = 0;
  let retires = 0;
  let echecs = 0;
  const retiresIds = new Set();
  for (const service of nouveaux) {
    for (const destinataire of destinatairesH1(ctx, service.reservation.entite_id)) {
      const charge = JSON.stringify(messageH1(service, { entreprise: plusieurs(destinataire) ? nomEntite(service.reservation.entite_id) : "", client: clientDe(service.reservation) }));
      for (const abo of abos.data!.filter((a) => a.user_id === destinataire && !retiresIds.has(a.id))) {
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

// ---- ZTP : départ du client demain (appelé par le passage de la veille) ----------------------------------------------------------------------
// `actives` : les entreprises ZTP dont le rappel du départ part à ce passage (entitesDuDepart).
async function executerDeparts(db: ReturnType<typeof createClient>, demain: string, demande: { user_id?: string }, actives: string[]) {
  const vide = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0 };
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
