// Fonction planifiée « rappels ». Façons de l'appeler (heure locale de chaque organisation, organisations.fuseau, Bangkok par défaut) :
// - { "type": "auto" } chaque heure par pg_cron : elle envoie le rappel de la veille et celui du lendemain des entreprises dont l'heure réglée
//   (Réglages > rappels, 18 h et 9 h par défaut) est l'heure qu'il est dans le fuseau de son organisation (lot G, 17.11.2026 ; fuseau : étape 3 du SaaS), et avec le passage de la veille le départ
//   de demain de chaque voyage ZTP (migration 31) ;
// - { "type": "veille" } ou { "type": "lendemain" } : envoi forcé, à toute heure, pour toutes les entreprises où ce rappel n'est pas coupé
//   (les crons de 18h et 9h posés avant le lot G, et les essais) ; la veille envoie aussi les départs ZTP de demain ;
// - { "type": "ameliorations" } toutes les 10 minutes : le suivi des demandes d'amélioration sur GitHub (PR prête, échec, en ligne, refusée),
//   avec une notification à l'administration générale ou à l'autrice (ameliorations/calc.js) ;
// - { "type": "h1" } toutes les 5 minutes : le rappel une heure avant chaque service (Secret, Taxi, migration 31), et
//   { "mode": "h1", "service_id": "…", "force": true } pour forcer celui d'un service ;
// - { "type": "budget" } (fonction « agent », clé de service, et chaque passage « h1 ») : la dépense du mois de l'assistant IA comparée au
//   plafond (migration 54). Au seuil (80 %) puis au plafond, une notification part chez les administratrices, une fois par mois et par
//   niveau ; { "type": "budget", "credit_epuise": true } quand Anthropic refuse faute de crédit (une fois par jour).
// Elle lit les réservations avec la clé de service, calcule le texte de chaque personne selon les entreprises qu'elle voit et dans sa langue,
// puis envoie une notification Web Push à chacun de ses appareils abonnés. Les résumés de la veille et du lendemain ne contiennent aucun nom de client.
// Le partenaire chauffeur (partenaires_acces, migration 123) reçoit les siennes en thaï, à part et après celles des membres (partenaire.js) :
// au passage « h1 », ses courses nouvelles, modifiées ou annulées et le rappel d'une heure avant ; au passage de la veille de l'entreprise Taxi,
// ses courses de demain. Une panne de ce passage ne touche jamais les envois des membres.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { alertesBudget, debutMois, destinatairesBudget, etatBudget, messageBudget, plafondRetenu, tableAbsente } from "../assistant/budget.js";
import { STATUTS_SUIVIS, DEPOT, changement, lireSuivi, notification } from "../ameliorations/calc.js";
import { dateDans, heureDans, fuseauValide, dateCible, entitesLisibles, rappelDuType, entitesDuRappel, entitesDuDepart, restreindre, TYPES, rappelAvantActif, modeRappel, servicesH1, datesH1, messageH1, destinatairesH1, nomClient, departsDemain, messageDepart, serviceForce, avecFamilles } from "./calc.js";
import { messageChangement, messageVeillePartenaire, coursesH1, h1Actif, messageH1Partenaire, cleVeille, cleH1, fonctionAbsente } from "./partenaire.js";

// La famille de la prestation de chaque réservation (une prestation « frais » est un frais de parc, quel que soit son libellé : revue du
// 24.11.2026). Rend une Map id de prestation → famille ; une erreur de lecture rend une Map vide (la règle du libellé reste).
// deno-lint-ignore no-explicit-any
async function famillesDe(db: any, lignes: Array<{ prestation_id?: string | null }>) {
  const ids = [...new Set(lignes.map((r) => r.prestation_id).filter(Boolean))] as string[];
  if (!ids.length) return new Map<string, string>();
  const lu = await db.from("prestations").select("id, famille").in("id", ids);
  return new Map<string, string>(lu.error ? [] : (lu.data || []).map((p: { id: string; famille: string }) => [p.id, p.famille]));
}

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
  // Une administratrice ne force que les services de son organisation (le cron et la clé de service, tous).
  if (type === "h1" && demande.force) return rappelForce(demande, qui === "admin" ? await organisationAppelant(fourni) : null);
  // Une administratrice connectée n'a que l'envoi forcé : les passages planifiés restent au cron et à la clé de service.
  if (qui === "admin") return json({ erreur: "non autorisé" }, 401);
  if (type === "budget") {
    try {
      return json(await verifierBudget({ creditEpuise: demande.credit_epuise === true }));
    } catch (err) {
      return json({ erreur: String((err && err.message) || err).slice(0, 300) }, 500);
    }
  }
  if (type === "h1") {
    // Toutes les 5 minutes : la dépense de l'assistant est aussi regardée (les usages de la fonction « assistant » n'appellent pas l'alerte),
    // en même temps que les rappels, pour ne jamais les retarder.
    const budget = verifierBudget({}).catch((err) => console.error("budget de l'assistant :", String((err && err.message) || err).slice(0, 200)));
    const reponse = await rappelH1(demande);
    await budget;
    return reponse;
  }
  if (type === "ameliorations") return suivreAmeliorations();
  if (type !== "auto" && !TYPES.includes(type)) return json({ erreur: "type inconnu" }, 400);
  // `date`, `heure` et `user_id` ne servent qu'aux essais : sans eux, c'est la date et l'heure locales de chaque organisation et tous les abonnés.
  const dateEssai = /^\d{4}-\d{2}-\d{2}$/.test(demande.date || "") ? demande.date : null;
  const heureEssai = Number.isInteger(demande.heure) && demande.heure >= 0 && demande.heure <= 23 ? demande.heure : null;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

  // Les réglages de chaque entreprise : heures des rappels (valeur.rappels) et rappel du départ (ZTP). Sans lecture possible, l'appel s'arrête et le dit :
  // mieux vaut aucun rappel qu'un rappel à la mauvaise heure. Le fuseau vient de l'organisation (migration 42).
  const [entites, reglages, organisations] = await Promise.all([db.from("entites").select("id, nom, organisation_id"), db.from("reglages").select("entite_id, valeur"), db.from("organisations").select("id, fuseau")]);
  if (entites.error || reglages.error || organisations.error) return json({ erreur: (entites.error || reglages.error || organisations.error)!.message }, 500);
  const valeurs = Object.fromEntries((reglages.data || []).map((r) => [r.entite_id, r.valeur]));
  const parEntite = Object.fromEntries(Object.entries(valeurs).map(([id, v]) => [id, v && typeof v === "object" ? (v as { rappels?: unknown }).rappels : undefined]));
  const fuseauOrg = new Map((organisations.data || []).map((o) => [o.id, fuseauValide(o.fuseau)]));

  // Une passe par organisation : sa date et son heure locales, ses entreprises, sa ligne de suivi. À 11 h UTC, 18 h à Bangkok et midi à Zurich.
  let lu: Promise<Commun> | null = null;
  const commun = () => (lu ||= lireCommun(db, demande));
  const resultats = [];
  const parOrganisation = new Map<string, string[]>();
  for (const e of entites.data || []) parOrganisation.set(e.organisation_id, [...(parOrganisation.get(e.organisation_id) || []), e.id]);
  for (const [org, ids] of parOrganisation) {
    const fuseau = fuseauOrg.get(org) || fuseauValide(null);
    const maintenant = new Date();
    const aujourdhui = dateEssai || dateDans(fuseau, maintenant);
    const heure = type === "auto" ? (heureEssai ?? heureDans(fuseau, maintenant)) : null;
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
          res = await executer(db, t, aujourdhui, cible, demande, retenues, entites.data || [], commun, org);
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
      // Le partenaire chauffeur : ses courses de demain, en thaï, à l'heure de la veille de son entreprise (comptes à part, hors du suivi des membres).
      let partenaires: Record<string, unknown> | null = null;
      if (t === "veille" && retenues.length) {
        try {
          partenaires = await partenairesVeille(db, retenues, cible, demande);
        } catch (err) {
          partenaires = { erreur: String((err && err.message) || err).slice(0, 300) };
          console.error("rappel de la veille du partenaire :", partenaires.erreur);
        }
      }
      if (!demande.user_id) {
        const { error } = await db.from("rappels_suivi").insert({ type: t, cible, ...res, erreur, duree_ms: Date.now() - debut, organisation_id: org });
        if (error) console.error("suivi des rappels non écrit :", error.message);
      }
      resultats.push({ organisation: org, fuseau, heure, type: t, cible, ...res, ...(erreur ? { erreur } : {}), ...(partenaires ? { partenaires } : {}) });
    }
  }
  // Une panne du résumé du partenaire se voit aussi : statut 500 et `partenaires.erreur` dans la ligne du résultat.
  return json({ resultats }, resultats.some((r) => r.erreur || (r.partenaires && r.partenaires.erreur)) ? 500 : 200);
});

// Envoie les rappels d'un type pour une date cible, pour les entreprises `retenues`, et renvoie les comptes. Lève une erreur si la base répond mal : l'appelant la note.
// Abonnements, profils, accès et rôles : lus une seule fois par appel, partagés par toutes les organisations (au lieu d'une lecture complète
// par organisation et par type de rappel).
type Commun = { abos: Array<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>; profils: Array<Record<string, unknown> & { user_id: string; organisation_id: string; langue?: string }>; membres: Array<{ user_id: string; entite_id: string; role_id: string }>; roles: Array<{ id: string; portee: string; permissions: string[] }> };
async function lireCommun(db: ReturnType<typeof createClient>, demande: { user_id?: string }): Promise<Commun> {
  let requeteAbos = db.from("abonnements_push").select("id, user_id, endpoint, p256dh, auth");
  if (demande.user_id) requeteAbos = requeteAbos.eq("user_id", demande.user_id);
  const { data: abos, error: errAbos } = await requeteAbos;
  if (errAbos) throw new Error(errAbos.message);
  if (!abos?.length) return { abos: [], profils: [], membres: [], roles: [] };
  const ids = [...new Set(abos.map((a) => a.user_id))];
  const [profils, membres, roles] = await Promise.all([
    db.from("profils").select("user_id, actif, super_admin, langue, organisation_id").in("user_id", ids),
    db.from("membres").select("user_id, entite_id, role_id").in("user_id", ids),
    db.from("roles").select("*"),
  ]);
  for (const r of [profils, membres, roles]) if (r.error) throw new Error(r.error.message);
  return { abos, profils: profils.data!, membres: membres.data!, roles: roles.data! } as Commun;
}

async function executer(db: ReturnType<typeof createClient>, type: string, aujourdhui: string, cible: string, demande: { user_id?: string }, retenues: string[], entites: { id: string; nom: string; organisation_id: string }[], commun: () => Promise<Commun>, organisation: string) {
  const c = await commun();
  // Seulement les comptes de cette organisation : un autre client ne reçoit jamais ses rappels.
  const abos = c.abos.filter((a) => (c.profils.find((p) => p.user_id === a.user_id) || { organisation_id: null }).organisation_id === organisation);
  if (!abos.length) return { abonnements: 0, envoyes: 0, retires: 0, echecs: 0 };

  const ids = [...new Set(abos.map((a) => a.user_id))];
  const profils = { data: c.profils };
  const membres = { data: c.membres };
  const roles = { data: c.roles };
  // La veille : les services qui partent demain. Le lendemain : ceux qui se sont terminés hier, donc aussi une location prise plus tôt et rendue hier (details.retour_date).
  const reservations = await db.from("reservations").select("entite_id, dossier_id, statut, heure_pickup, lieu_pickup, date_service, libelle, partenaire_id, prestation_id, details").in("entite_id", retenues).or(type === "lendemain" ? `date_service.eq.${cible},details->>retour_date.eq.${cible}` : `date_service.eq.${cible}`).neq("statut", "annule");
  if (reservations.error) throw new Error(reservations.error.message);
  reservations.data = avecFamilles(reservations.data!, await famillesDe(db, reservations.data!));

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
    const lisibles = entitesLisibles({ profil, membres: membres.data!, roles: roles.data!, entites });
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
// Toutes les organisations en une lecture (toutes les 5 minutes), chaque service à l'heure du fuseau de son organisation ;
// l'envoi et la ligne de suivi restent par organisation (seulement celles qui ont un service à rappeler).
async function rappelH1(demande: { maintenant?: string; user_id?: string }) {
  const maintenant = demande.maintenant && !Number.isNaN(Date.parse(demande.maintenant)) ? Date.parse(demande.maintenant) : Date.now();
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const total = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0, services: 0 };
  const erreurs: string[] = [];
  let parOrganisation: Map<string, { fuseau: string; services: ReturnType<typeof servicesH1>; dossiers: Array<{ id: string; client_id: string }> }>;
  try {
    parOrganisation = await servicesH1ParOrganisation(db, maintenant);
  } catch (err) {
    const erreur = String((err && err.message) || err).slice(0, 300);
    // Panne avant de savoir quelle organisation est concernée : pas de ligne de suivi (elle serait chez un client au hasard), le journal de la fonction la garde.
    // Le passage du partenaire chauffeur part quand même (il lit ses courses par ses propres fonctions), puis la réponse dit la panne.
    console.error("rappel h1 :", erreur);
    const partenaires = await partenairesH1Protege(db, maintenant, demande);
    return json({ type: "h1", ...total, erreur, partenaires }, 500);
  }
  for (const [org, { fuseau, services, dossiers }] of parOrganisation) {
    const debut = Date.now();
    let res = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0, services: 0 };
    let erreur = "";
    try {
      res = await envoyerH1(db, services, dossiers, { essai: !!demande.user_id, userId: demande.user_id, force: false });
    } catch (err) {
      erreur = String((err && err.message) || err).slice(0, 300);
    }
    if (!demande.user_id && (res.envoyes || res.echecs || erreur)) await noterSuiviH1(db, maintenant, res, erreur, debut, org, fuseau);
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += res[k];
    if (erreur) erreurs.push(erreur);
  }
  // Le partenaire chauffeur, après les membres et à part : ses courses changées et le rappel d'une heure avant. Sa panne se voit (statut 500,
  // `partenaires.erreur`) sans toucher aux envois ni au suivi des membres.
  const partenaires = await partenairesH1Protege(db, maintenant, demande);
  const erreur = erreurs.join(" ; ").slice(0, 300);
  return json({ type: "h1", ...total, ...(erreur ? { erreur } : {}), partenaires }, erreur || partenaires.erreur ? 500 : 200);
}

async function noterSuiviH1(db: ReturnType<typeof createClient>, maintenant: number, res: { abonnements: number; envoyes: number; retires: number; echecs: number }, erreur: string, debut: number, organisation: string | null, fuseau: string) {
  const { abonnements, envoyes, retires, echecs } = res;
  // Sans organisation connue, aucune ligne : la base la refuse (migration 42) plutôt que de la ranger chez un autre client.
  if (!organisation) return console.error("suivi du rappel h1 sans organisation :", erreur || "aucune erreur");
  const { error } = await db.from("rappels_suivi").insert({ type: "h1", cible: dateDans(fuseau, new Date(maintenant)), abonnements, envoyes, retires, echecs, erreur, duree_ms: Date.now() - debut, organisation_id: organisation });
  if (error) console.error("suivi du rappel h1 non écrit :", error.message);
}

// Services à rappeler maintenant, rangés par organisation. Une seule lecture des entreprises, des réglages et des réservations.
async function servicesH1ParOrganisation(db: ReturnType<typeof createClient>, maintenant: number) {
  const [entites, organisations, reglages] = await Promise.all([db.from("entites").select("id, organisation_id"), db.from("organisations").select("id, fuseau"), db.from("reglages").select("entite_id, valeur")]);
  for (const r of [entites, organisations, reglages]) if (r.error) throw new Error(r.error.message);
  const fuseauOrg = new Map((organisations.data || []).map((o) => [o.id, fuseauValide(o.fuseau)]));
  const orgDe = new Map((entites.data || []).map((e) => [e.id, e.organisation_id]));
  const fuseauDe = (entiteId: string) => fuseauOrg.get(orgDe.get(entiteId) || "") || fuseauValide(null);
  const out = new Map<string, { fuseau: string; services: ReturnType<typeof servicesH1>; dossiers: Array<{ id: string; client_id: string }> }>();
  // Seules les entreprises de services (Secret, Taxi) qui ont le rappel allumé ; ZTP a le sien la veille du départ, pas un par service.
  const actives = [...new Set(reglages.data!.filter((l) => rappelAvantActif(l.valeur) && modeRappel(l.valeur) === "service").map((l) => l.entite_id))];
  if (!actives.length) return out;
  const reservations = await db.from("reservations").select("id, entite_id, dossier_id, statut, heure_pickup, date_service, libelle, partenaire_id, prestation_id, lieu_pickup, personnes, details").in("entite_id", actives).in("date_service", datesH1(maintenant, [...new Set([...fuseauOrg.values()])])).neq("statut", "annule");
  if (reservations.error) throw new Error(reservations.error.message);
  if (!reservations.data!.length) return out;
  reservations.data = avecFamilles(reservations.data!, await famillesDe(db, reservations.data!));
  const dossiersIds = [...new Set(reservations.data!.map((r) => r.dossier_id))];
  const dossiers = await db.from("dossiers").select("id, annule, client_id").in("id", dossiersIds);
  if (dossiers.error) throw new Error(dossiers.error.message);
  const aRappeler = servicesH1(reservations.data!, maintenant, { ecartes: new Set((dossiers.data || []).filter((d) => d.annule).map((d) => d.id)), fuseauDe });
  for (const x of aRappeler) {
    const org = orgDe.get(x.reservation.entite_id) || "";
    if (!out.has(org)) out.set(org, { fuseau: fuseauDe(x.reservation.entite_id), services: [], dossiers: [] });
    const g = out.get(org)!;
    g.services.push(x);
    const d = (dossiers.data || []).find((y) => y.id === x.reservation.dossier_id);
    if (d && !g.dossiers.includes(d)) g.dossiers.push(d);
  }
  return out;
}

// Envoi forcé d'un service : la même notification que le cron (texte, nom du client, destinataires, lien), tout de suite, hors de la fenêtre.
// Le service est marqué comme notifié pour son heure : le cron n'en enverra pas un second.
// Organisation du compte connecté (null si introuvable : l'envoi forcé est alors refusé).
async function organisationAppelant(jeton: string) {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${jeton}` } }, auth: { persistSession: false } });
  const { data: qui } = await sb.auth.getUser();
  if (!qui?.user) return "";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const moi = await db.from("profils").select("organisation_id").eq("user_id", qui.user.id).maybeSingle();
  return (moi.data && moi.data.organisation_id) || "";
}

async function rappelForce(demande: { service_id?: string; maintenant?: string }, organisation: string | null = null) {
  if (typeof demande.service_id !== "string" || !UUID.test(demande.service_id)) return json({ erreur: "service_id manquant ou invalide" }, 400);
  const maintenant = demande.maintenant && !Number.isNaN(Date.parse(demande.maintenant)) ? Date.parse(demande.maintenant) : Date.now();
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const debut = Date.now();
  const lue = await db.from("reservations").select("id, entite_id, dossier_id, statut, heure_pickup, date_service, libelle, partenaire_id, prestation_id, lieu_pickup, personnes, details").eq("id", demande.service_id).maybeSingle();
  if (lue.error) return json({ erreur: lue.error.message }, 500);
  if (!lue.data) return json({ erreur: "service_introuvable" }, 404);
  lue.data = avecFamilles([lue.data], await famillesDe(db, [lue.data]))[0];
  const ent = await db.from("entites").select("organisation_id").eq("id", lue.data.entite_id).maybeSingle();
  if (ent.error) return json({ erreur: ent.error.message }, 500);
  // Même réponse qu'un service absent : une autre organisation n'apprend pas qu'il existe.
  if (organisation !== null && (!organisation || !ent.data || ent.data.organisation_id !== organisation)) return json({ erreur: "service_introuvable" }, 404);
  const orgService = (ent.data && ent.data.organisation_id) || null;
  const org = orgService ? await db.from("organisations").select("fuseau").eq("id", orgService).maybeSingle() : null;
  const fuseau = fuseauValide(org && org.data ? org.data.fuseau : null);
  const [dossier, reglages] = await Promise.all([
    db.from("dossiers").select("id, annule, client_id").eq("id", lue.data.dossier_id).maybeSingle(),
    db.from("reglages").select("valeur").eq("entite_id", lue.data.entite_id).maybeSingle(),
  ]);
  if (dossier.error || reglages.error) return json({ erreur: (dossier.error || reglages.error)!.message }, 500);
  const choix = serviceForce(lue.data, maintenant, { dossierAnnule: !!(dossier.data && dossier.data.annule), reglages: reglages.data ? reglages.data.valeur : null, fuseau });
  if (choix.erreur) return json({ erreur: choix.erreur }, 409);
  let res = { abonnements: 0, envoyes: 0, retires: 0, echecs: 0, services: 0 };
  let erreur = "";
  try {
    res = await envoyerH1(db, [choix.service], dossier.data ? [dossier.data] : [], { essai: false, force: true });
  } catch (err) {
    erreur = String((err && err.message) || err).slice(0, 300);
  }
  await noterSuiviH1(db, maintenant, res, erreur, debut, orgService, fuseau);
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
    db.from("profils").select("user_id, actif, super_admin, rappel_h1, organisation_id"),
    db.from("membres").select("user_id, entite_id, role_id"),
    db.from("roles").select("*"),
    db.from("entites").select("id, nom, organisation_id"),
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
  const ctx = { profils: profils.data!, membres: membres.data!, roles: roles.data!, entites: entites.data! };
  const nomEntite = (id: string) => (entites.data!.find((e) => e.id === id) || { nom: "" }).nom;
  // Le nom de l'entreprise n'est ajouté que pour qui en suit plusieurs (Anaïs : Secret et Taxi).
  const plusieurs = (id: string) => {
    const profil = ctx.profils.find((p) => p.user_id === id);
    const ids = entitesLisibles({ profil, membres: ctx.membres, roles: ctx.roles, entites: ctx.entites });
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
    db.from("profils").select("user_id, actif, super_admin, rappel_h1, organisation_id"),
    db.from("membres").select("user_id, entite_id, role_id"),
    db.from("roles").select("*"),
    db.from("entites").select("id, nom, organisation_id"),
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
  const ctx = { profils: profils.data!, membres: membres.data!, roles: roles.data!, entites: entites.data! };
  const nomEntite = (id: string) => (entites.data!.find((e) => e.id === id) || { nom: "" }).nom;
  let envoyes = 0;
  let retires = 0;
  let echecs = 0;
  const retiresIds = new Set();
  for (const d of nouveaux) {
    for (const userId of destinatairesH1(ctx, d.entite_id)) {
      const ids = entitesLisibles({ profil: ctx.profils.find((p) => p.user_id === userId), membres: ctx.membres, roles: ctx.roles, entites: ctx.entites });
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

// ---- Crédit de l'assistant IA ----------------------------------------------------------------------------------------------------------
// La dépense du mois (toutes entreprises) et le plafond réglé par Jérémy. Chaque alerte pose d'abord sa clé dans assistant_alertes : une clé déjà là
// veut dire « déjà envoyée », rien ne repart. Sans la migration 54, rien n'est fait.
async function verifierBudget({ creditEpuise = false }: { creditEpuise?: boolean }) {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const [budget, mois] = await Promise.all([db.from("assistant_budget").select("plafond_mois_usd, seuil_alerte_pct").maybeSingle(), db.rpc("assistant_cout_depuis", { debut: debutMois() })]);
  if (budget.error) return tableAbsente(budget.error) ? { alertes: [] } : Promise.reject(new Error(budget.error.message));
  if (mois.error) throw new Error(mois.error.message);
  const { plafond, seuil } = plafondRetenu(budget.data, Deno.env.get("AGENT_PLAFOND_MOIS_USD"));
  const etatMois = etatBudget({ cout: Number(mois.data) || 0, plafond, seuil });
  const aEnvoyer = alertesBudget({ cout: etatMois.cout, plafond, seuil, creditEpuise });
  if (!aEnvoyer.length) return { alertes: [], ...etatMois };
  const { data: posees, error } = await db.from("assistant_alertes").upsert(aEnvoyer.map((a) => ({ cle: a.cle })), { onConflict: "cle", ignoreDuplicates: true }).select("cle");
  if (error) throw new Error(error.message);
  const nouvelles = aEnvoyer.filter((a) => (posees || []).some((p) => p.cle === a.cle));
  if (!nouvelles.length) return { alertes: [], ...etatMois };
  const [abos, profils, membres, roles] = await Promise.all([db.from("abonnements_push").select("id, user_id, endpoint, p256dh, auth"), db.from("profils").select("user_id, actif, super_admin, langue"), db.from("membres").select("user_id, entite_id, role_id"), db.from("roles").select("id, permissions, tous_droits")]);
  for (const r of [abos, profils, membres, roles]) if (r.error) throw new Error(r.error.message);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  const ids = destinatairesBudget({ profils: profils.data!, membres: membres.data!, roles: roles.data! });
  let envoyes = 0;
  let echecs = 0;
  for (const a of nouvelles) {
    for (const userId of ids) {
      const profil = profils.data!.find((p) => p.user_id === userId);
      const charge = JSON.stringify({ ...messageBudget(a.niveau, { ...etatMois, langue: profil && profil.langue === "en" ? "en" : "fr" }), url: "/gestion/#/assistant" });
      for (const abo of abos.data!.filter((x) => x.user_id === userId)) {
        try {
          await webpush.sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, charge, { TTL: 24 * 3600 });
          envoyes++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) await db.from("abonnements_push").delete().eq("id", abo.id);
          else echecs++;
        }
      }
    }
  }
  return { alertes: nouvelles.map((a) => a.cle), envoyes, echecs, ...etatMois };
}

// ---- Demandes d'amélioration (20.11.2026) -------------------------------------------------------------------------------------------
// Lit sur GitHub l'issue de chaque demande encore en cours (jeton GITHUB_ISSUES_TOKEN, droits « Issues » seulement : l'issue et ses
// commentaires suffisent, l'Action y écrit le lien de la PR). Un changement est écrit dans la table et notifié.
async function suivreAmeliorations() {
  const jeton = Deno.env.get("GITHUB_ISSUES_TOKEN");
  if (!jeton) return json({ ignore: "GITHUB_ISSUES_TOKEN absent" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const lignes = await db.from("ameliorations").select("id, user_id, titre, statut, issue_numero, issue_url, pr_url, sensible").in("statut", STATUTS_SUIVIS).not("issue_numero", "is", null).order("maj_le", { ascending: true }).limit(30);
  // Avant la migration 56, la table manque : rien à suivre, sans erreur toutes les 10 minutes.
  if (lignes.error) return ["42P01", "PGRST205"].includes(lignes.error.code) ? json({ suivies: 0, note: "table ameliorations absente" }) : json({ erreur: lignes.error.message }, 500);
  if (!(lignes.data || []).length) return json({ suivies: 0 });
  const gh = (chemin: string) =>
    fetch(`https://api.github.com/repos/${DEPOT}${chemin}`, { headers: { Authorization: `Bearer ${jeton}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "gestion-ameliorations" }, signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null), () => null);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  let changees = 0;
  let envoyes = 0;
  for (const l of lignes.data || []) {
    const [issue, commentaires] = await Promise.all([gh(`/issues/${l.issue_numero}`), gh(`/issues/${l.issue_numero}/comments?per_page=100`)]);
    if (!issue) continue;
    const suivi = lireSuivi(issue, Array.isArray(commentaires) ? commentaires : []);
    const ch = changement(l, suivi);
    if (!ch) continue;
    const { error } = await db.from("ameliorations").update({ ...ch.patch, maj_le: new Date().toISOString() }).eq("id", l.id);
    if (error) {
      console.error("ameliorations : suivi non écrit", error.message);
      continue;
    }
    changees++;
    if (!ch.prevenir) continue;
    // Destinataires : l'administration générale (Jérémy) pour relire, ou l'autrice de la demande.
    let ids: string[] = [];
    if (ch.prevenir === "autrice") ids = [l.user_id];
    else {
      const p = await db.from("profils").select("user_id").eq("super_admin", true).eq("actif", true);
      ids = (p.data || []).map((x) => x.user_id);
    }
    if (!ids.length) continue;
    const [abos, profils] = await Promise.all([db.from("abonnements_push").select("id, user_id, endpoint, p256dh, auth").in("user_id", ids), db.from("profils").select("user_id, langue").in("user_id", ids)]);
    for (const abo of abos.data || []) {
      const langue = (profils.data || []).find((p) => p.user_id === abo.user_id)?.langue === "en" ? "en" : "fr";
      const message = notification(ch.patch.statut, { ...l, ...ch.patch }, { langue, tests: suivi!.tests });
      if (!message) continue;
      try {
        await webpush.sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, JSON.stringify(message), { TTL: 24 * 3600 });
        envoyes++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await db.from("abonnements_push").delete().eq("id", abo.id);
      }
    }
  }
  return json({ suivies: (lignes.data || []).length, changees, envoyes });
}

// ---- Partenaire chauffeur (migration 123) : notifications en thaï ------------------------------------------------------------------------
// Jamais de lecture des réservations ici : ses courses viennent de partenaire_notif_courses(user), la règle de son écran (partenaire_courses_de),
// réduite aux colonnes d'une notification. Un compte désactivé ou dont l'accès est retiré n'a plus de course : rien ne part.
// Avant la migration 123 (fonctions absentes), rien n'est fait, sans erreur toutes les 5 minutes.
type Db = ReturnType<typeof createClient>;
// fonctionAbsente (partenaire.js, testée) : seule l'absence d'un objet de la migration 123 vaut « migration absente », toute autre erreur remonte.

// Les comptes partenaires qui ont un téléphone abonné (`user_id` : un essai ciblé), avec leurs abonnements et leur profil.
async function comptesPartenaires(db: Db, demande: { user_id?: string }) {
  let q = db.from("partenaires_acces").select("user_id");
  if (demande.user_id) q = q.eq("user_id", demande.user_id);
  const acces = await q;
  if (acces.error) return fonctionAbsente(acces.error) ? null : Promise.reject(new Error(acces.error.message));
  const ids = [...new Set((acces.data || []).map((a) => a.user_id))];
  if (!ids.length) return { ids: [], abos: [], profils: [] };
  const [abos, profils] = await Promise.all([db.from("abonnements_push").select("id, user_id, endpoint, p256dh, auth").in("user_id", ids), db.from("profils").select("user_id, rappel_h1").in("user_id", ids)]);
  for (const r of [abos, profils]) if (r.error) throw new Error(r.error.message);
  const abonnes = new Set((abos.data || []).map((a) => a.user_id));
  return { ids: ids.filter((id) => abonnes.has(id)), abos: abos.data || [], profils: profils.data || [] };
}

// Ses courses à notifier (aujourd'hui et la suite), ou null si la migration manque.
async function coursesDuPartenaire(db: Db, userId: string) {
  const { data, error } = await db.rpc("partenaire_notif_courses", { p_user: userId });
  if (error) return fonctionAbsente(error) ? null : Promise.reject(new Error(error.message));
  return (data || []) as Array<Record<string, unknown> & { id: string; date_service: string; entite_id: string; heure: string }>;
}

// Une clé posée = déjà envoyé : rend true si elle vient d'être posée (à envoyer). Un essai ciblé ne pose rien.
async function marquer(db: Db, userId: string, cle: string, essai: boolean) {
  if (essai) return true;
  const { data, error } = await db.from("partenaires_notifs_envois").upsert({ user_id: userId, cle }, { onConflict: "user_id,cle", ignoreDuplicates: true }).select("cle");
  if (error) throw new Error(error.message);
  return !!(data && data.length);
}

async function envoyerAuPartenaire(db: Db, abos: Array<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>, userId: string, message: unknown, options: Record<string, unknown>, compte: { envoyes: number; retires: number; echecs: number }) {
  const charge = JSON.stringify(message);
  for (const abo of abos.filter((a) => a.user_id === userId)) {
    try {
      await webpush.sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, charge, options);
      compte.envoyes++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.from("abonnements_push").delete().eq("id", abo.id);
        compte.retires++;
      } else compte.echecs++;
    }
  }
}

// Le passage du partenaire, qui ne lève jamais : sa panne revient dans `erreur` (journal de la fonction, statut 500 de la réponse).
async function partenairesH1Protege(db: Db, maintenant: number, demande: { user_id?: string }): Promise<Record<string, unknown>> {
  try {
    return await partenairesH1(db, maintenant, demande);
  } catch (err) {
    const erreur = String((err && err.message) || err).slice(0, 300);
    console.error("notifications du partenaire :", erreur);
    return { erreur };
  }
}

// Passage « h1 » (toutes les 5 minutes) : 1. ses courses nouvelles, modifiées ou annulées ; 3. le rappel d'une heure avant.
async function partenairesH1(db: Db, maintenant: number, demande: { user_id?: string }) {
  const compte = { comptes: 0, changements: 0, h1: 0, envoyes: 0, retires: 0, echecs: 0 };
  const comptes = await comptesPartenaires(db, demande);
  if (!comptes) return { ...compte, note: "migration 123 absente" };
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  // 1. La base compare ses courses aux empreintes (verrou par compte) et rend ce qui est prêt. Pas pendant un essai ciblé : le passage marque
  // les courses de tous les comptes partenaires.
  // Une panne de cette étape est notée (`erreur`, statut 500) sans priver le rappel d'une heure avant qui suit.
  let erreur = "";
  if (!demande.user_id) {
    try {
      const { data, error } = await db.rpc("partenaire_notifs_changements");
      if (error) {
        if (fonctionAbsente(error)) return { ...compte, note: "migration 123 absente" };
        throw new Error(error.message);
      }
      const prets = (data || []) as Array<{ user_id: string; reservation_id: string; genre: string; apercu: Record<string, unknown>; apercu_avant: Record<string, unknown> | null }>;
      // Les téléphones relus APRÈS le marquage : un appareil abonné pendant le passage reçoit aussi la notification (elle n'est pas renvoyée).
      const abosApres = prets.length ? await db.from("abonnements_push").select("id, user_id, endpoint, p256dh, auth").in("user_id", [...new Set(prets.map((n) => n.user_id))]) : { data: [], error: null };
      if (abosApres.error) throw new Error(abosApres.error.message);
      for (const n of prets) {
        compte.changements++;
        await envoyerAuPartenaire(db, abosApres.data || [], n.user_id, messageChangement(n), { TTL: 12 * 3600, urgency: "high" }, compte);
      }
    } catch (err) {
      erreur = `changements : ${String((err && err.message) || err)}`.slice(0, 300);
      console.error("notifications du partenaire,", erreur);
    }
  }
  const fin = () => (erreur ? { ...compte, erreur } : compte);
  if (!comptes.ids.length) return fin();
  // 3. Une heure avant : réglages de l'entreprise (rappel allumé) et fuseau de son organisation.
  const [reglages, entites, organisations] = await Promise.all([db.from("reglages").select("entite_id, valeur"), db.from("entites").select("id, organisation_id"), db.from("organisations").select("id, fuseau")]);
  for (const r of [reglages, entites, organisations]) if (r.error) throw new Error(r.error.message);
  const valeurDe = new Map((reglages.data || []).map((r) => [r.entite_id, r.valeur]));
  const fuseauDe = (entiteId: string) => {
    const ent = (entites.data || []).find((e) => e.id === entiteId);
    const org = ent ? (organisations.data || []).find((o) => o.id === ent.organisation_id) : null;
    return fuseauValide(org ? org.fuseau : null);
  };
  for (const userId of comptes.ids) {
    compte.comptes++;
    const courses = await coursesDuPartenaire(db, userId);
    if (!courses || !courses.length) continue;
    const entiteId = courses[0].entite_id;
    if (!h1Actif(valeurDe.get(entiteId), comptes.profils.find((p) => p.user_id === userId))) continue;
    const fuseau = fuseauDe(entiteId);
    for (const x of coursesH1(courses, maintenant, { fuseau })) {
      const cle = cleH1(x.course, fuseau);
      if (!cle || !(await marquer(db, userId, cle, !!demande.user_id))) continue;
      compte.h1++;
      // TTL court : un rappel « dans 1 h » qui arrive deux heures plus tard n'a plus de sens.
      await envoyerAuPartenaire(db, comptes.abos, userId, messageH1Partenaire(x), { TTL: 3600, urgency: "high" }, compte);
    }
  }
  return fin();
}

// 2. Passage de la veille d'une organisation (`retenues` : ses entreprises dont la veille part maintenant) : ses courses de `demain`.
async function partenairesVeille(db: Db, retenues: string[], demain: string, demande: { user_id?: string }) {
  const compte = { comptes: 0, resumes: 0, envoyes: 0, retires: 0, echecs: 0 };
  const comptes = await comptesPartenaires(db, demande);
  if (!comptes || !comptes.ids.length) return compte;
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  for (const userId of comptes.ids) {
    const courses = await coursesDuPartenaire(db, userId);
    if (!courses || !courses.length || !retenues.includes(courses[0].entite_id)) continue;
    compte.comptes++;
    const message = messageVeillePartenaire(courses, demain);
    if (!message || !(await marquer(db, userId, cleVeille(demain), !!demande.user_id))) continue;
    compte.resumes++;
    await envoyerAuPartenaire(db, comptes.abos, userId, message, { TTL: 6 * 3600 }, compte);
  }
  return compte;
}
