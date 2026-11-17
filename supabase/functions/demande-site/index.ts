// Fonction publique « demande-site » : reçoit la copie d'une demande de réservation envoyée depuis la feuille du site secrettravelandtour.com,
// l'écrit dans demandes_site (Secret ou VIP Taxi Lanta) et prévient l'équipe de l'entreprise par une notification sur téléphone.
// Le site l'appelle sans attendre la réponse, juste avant d'ouvrir WhatsApp : une panne ici n'empêche jamais la demande d'arriver sur WhatsApp.
// Contrat et réponses : docs/gestion/demandes-site.md. Logique pure : ./calc.js (testée par tests/gestion-demandes-site.test.js).
//
// Protections : origine du site seulement (CORS), méthode POST, taille et formats contrôlés, champ piège pour les robots, limite par appareil
// (empreinte salée de l'IP, jamais l'IP elle-même) et limite par organisation, vérification Cloudflare Turnstile prête à allumer (TURNSTILE_SECRET).
// Secrets : DEMANDES_SEL (sel de l'empreinte d'IP), VAPID_* (déjà posés pour les rappels). Facultatifs : TURNSTILE_SECRET, TURNSTILE_OBLIGATOIRE=1.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { origineAdmise, lireOrigines, lireDemande, adresseIP, notification, destinataires, REPONSES, reponseInvalide, choisirEntite, TAILLE_MAX, LIMITE_APPAREIL, LIMITE_TOTALE } from "./calc.js";
import { dateDans, fuseauValide } from "../rappels/calc.js";

// Organisation propriétaire du site qui appelle cette fonction (Zwald par défaut). Une marque est le slug d'une de ses entreprises qui publient sur le site.
const ORGANISATION = Deno.env.get("SITE_ORGANISATION") || "00000000-0000-0000-0000-00000000a000";
// Adresses de ce site (CORS et page d'où vient la demande). Sans réglage : secrettravelandtour.com.
const ORIGINES = lireOrigines(Deno.env.get("SITE_ORIGINES"));
const admise = (origine: string | null) => origineAdmise(origine, ORIGINES);

// Fuseau de cette organisation (organisations.fuseau) : « aujourd'hui » d'une demande est celui du client, pas celui de Bangkok.
// Lu une fois par instance ; une lecture impossible donne Bangkok et sera retentée à l'appel suivant.
let fuseauLu: string | null = null;
async function fuseauDuSite() {
  if (fuseauLu) return fuseauLu;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await db.from("organisations").select("fuseau").eq("id", ORGANISATION).maybeSingle();
  if (error) return fuseauValide(null);
  return (fuseauLu = fuseauValide(data && data.fuseau));
}

function entetesCors(origine: string | null) {
  const h: Record<string, string> = { "Content-Type": "application/json", Vary: "Origin", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (origine && admise(origine)) {
    h["Access-Control-Allow-Origin"] = origine;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}
const repondre = (r: { status: number; corps: unknown }, origine: string | null) => new Response(JSON.stringify(r.corps), { status: r.status, headers: entetesCors(origine) });

async function empreinte(ip: string) {
  const sel = Deno.env.get("DEMANDES_SEL") || "";
  const octets = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${sel}|${ip}`)));
  return Array.from(octets.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Cloudflare Turnstile : vérifié si une clé secrète est posée. Sans jeton, la demande passe tant que TURNSTILE_OBLIGATOIRE ne vaut pas 1.
async function turnstileOk(jeton: unknown, ip: string) {
  const secret = Deno.env.get("TURNSTILE_SECRET");
  if (!secret) return true;
  if (typeof jeton !== "string" || !jeton) return Deno.env.get("TURNSTILE_OBLIGATOIRE") !== "1";
  try {
    const corps = new FormData();
    corps.append("secret", secret);
    corps.append("response", jeton.slice(0, 2048));
    if (ip) corps.append("remoteip", ip);
    const rep = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: corps, signal: AbortSignal.timeout(4000) });
    const res = await rep.json();
    return res.success === true;
  } catch {
    // Cloudflare injoignable : on ne perd pas une vraie demande pour autant, sauf si la vérification est obligatoire.
    return Deno.env.get("TURNSTILE_OBLIGATOIRE") !== "1";
  }
}

// Lit le corps sans jamais dépasser la taille admise (un en-tête Content-Length peut manquer ou mentir).
async function lireCorps(req: Request) {
  const lecteur = req.body?.getReader();
  if (!lecteur) return "";
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.length;
    if (total > TAILLE_MAX) {
      await lecteur.cancel();
      return null;
    }
    morceaux.push(value);
  }
  const tout = new Uint8Array(total);
  let i = 0;
  for (const m of morceaux) (tout.set(m, i), (i += m.length));
  return new TextDecoder().decode(tout);
}

Deno.serve(async (req) => {
  const origine = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: admise(origine) ? 204 : 403, headers: entetesCors(origine) });
  if (req.method !== "POST") return repondre(REPONSES.methode, origine);
  // Un navigateur envoie toujours l'origine sur un POST d'une autre adresse : sans elle, ou d'ailleurs, on refuse.
  if (!admise(origine)) return repondre(REPONSES.origine, origine);
  const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  // text/plain : le site l'envoie ainsi pour éviter la requête de contrôle CORS (un envoi « keepalive » doit rester simple).
  if (type !== "application/json" && type !== "text/plain") return repondre(REPONSES.type, origine);
  if (Number(req.headers.get("content-length") || 0) > TAILLE_MAX) return repondre(REPONSES.trop_gros, origine);
  const corps = await lireCorps(req);
  if (corps === null) return repondre(REPONSES.trop_gros, origine);

  const aujourdhui = dateDans(await fuseauDuSite());
  let ligne;
  try {
    ligne = lireDemande(corps, { aujourdhui, origines: ORIGINES });
  } catch (e) {
    return repondre(e.code === "trop_gros" ? REPONSES.trop_gros : reponseInvalide(e), origine);
  }
  // Robot : on répond comme pour une vraie demande, sans rien écrire, pour ne pas lui apprendre le piège.
  if (ligne.piege) return repondre(REPONSES.ok, origine);

  const ip = adresseIP(req.headers);
  let jeton: unknown = null;
  try {
    jeton = JSON.parse(corps).turnstile_token;
  } catch {
    /* déjà lu plus haut */
  }
  if (!(await turnstileOk(jeton, ip))) return repondre(REPONSES.captcha, origine);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    // Sans adresse IP connue, pas de limite par appareil (tous les visiteurs partageraient la même) : seule la limite de l'organisation s'applique.
    const ipEmpreinte = ip ? await empreinte(ip) : null;
    const depuis = (min: number) => new Date(Date.now() - min * 60000).toISOString();
    const [appareil, entites] = await Promise.all([
      ipEmpreinte ? db.from("demandes_site").select("id", { count: "exact", head: true }).eq("ip_empreinte", ipEmpreinte).gte("created_at", depuis(LIMITE_APPAREIL.minutes)) : Promise.resolve({ count: 0, error: null }),
      // Entreprises de cette organisation qui publient sur le site : la marque reçue doit être le slug de l'une d'elles.
      db.from("entites").select("id, nom, slug").eq("organisation_id", ORGANISATION).eq("publie_site", true),
    ]);
    for (const r of [appareil, entites]) if (r.error) throw new Error(r.error.message);
    const ids = (entites.data || []).map((e) => e.id);
    // Garde-fou par organisation : seules ses demandes comptent, la rafale reçue par le site d'un autre client ne bloque pas celui-ci.
    const toutes = ids.length ? await db.from("demandes_site").select("id", { count: "exact", head: true }).in("entite_id", ids).gte("created_at", depuis(LIMITE_TOTALE.minutes)) : { count: 0, error: null };
    if (toutes.error) throw new Error(toutes.error.message);
    // Limites, puis marque inconnue ou d'une autre organisation (la base la refuserait aussi, controler_marques_site) : rien n'est écrit.
    const { reponse, entite } = choisirEntite({ marque: ligne.marque, entites: entites.data, appareil: appareil.count || 0, organisation: toutes.count || 0 });
    if (reponse) return repondre(reponse, origine);

    const { data: ecrite, error } = await db.from("demandes_site").insert({ ...ligne, entite_id: entite.id, ip_empreinte: ipEmpreinte }).select("id, entite_id").single();
    if (error) throw new Error(error.message);

    // La notification part après la réponse : le site n'attend pas Apple ni Google.
    const envoi = prevenir(db, ecrite, ligne, aujourdhui, entite.nom).catch((err) => console.error("notification non envoyée :", String(err?.message || err)));
    // deno-lint-ignore no-explicit-any
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(envoi);
    else await envoi;
    return repondre(REPONSES.ok, origine);
  } catch (err) {
    console.error("demande non écrite :", String(err?.message || err));
    return repondre(REPONSES.serveur, origine);
  }
});

// Envoie la notification aux appareils abonnés des personnes qui lisent les demandes de l'entreprise.
async function prevenir(db: ReturnType<typeof createClient>, ecrite: { id: string; entite_id: string }, ligne: Record<string, unknown>, aujourdhui: string, entreprise: string) {
  const [profils, membres, roles] = await Promise.all([
    // Seulement les comptes de l'organisation : un administrateur d'une autre organisation ne reçoit rien.
    db.from("profils").select("user_id, actif, super_admin").eq("organisation_id", ORGANISATION),
    db.from("membres").select("user_id, entite_id, role_id").eq("entite_id", ecrite.entite_id),
    db.from("roles").select("id, portee, permissions").eq("entite_id", ecrite.entite_id),
  ]);
  for (const r of [profils, membres, roles]) if (r.error) throw new Error(r.error.message);
  const ids = destinataires({ entiteId: ecrite.entite_id, profils: profils.data!, membres: membres.data!, roles: roles.data! });
  if (!ids.length) return;
  const abos = await db.from("abonnements_push").select("id, endpoint, p256dh, auth").in("user_id", ids);
  if (abos.error) throw new Error(abos.error.message);
  if (!abos.data?.length) return;
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  // L'adresse ouvre la boîte dans la bonne entreprise (l'outil change d'entreprise s'il le faut).
  const charge = JSON.stringify({ ...notification(ligne, aujourdhui, entreprise), url: `/gestion/#/demandes?entite=${ecrite.entite_id}` });
  for (const abo of abos.data) {
    try {
      await webpush.sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, charge, { TTL: 12 * 3600 });
    } catch (err) {
      // 404 et 410 : l'appareil s'est désabonné, on retire l'abonnement (même règle que les rappels).
      // deno-lint-ignore no-explicit-any
      const code = (err as any)?.statusCode;
      if (code === 404 || code === 410) await db.from("abonnements_push").delete().eq("id", abo.id);
    }
  }
}
