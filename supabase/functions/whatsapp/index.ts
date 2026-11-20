// Fonction publique « whatsapp » : reçoit les événements WhatsApp de Telnyx (coexistence, numéro de Nani pour Secret et VIP Taxi Lanta).
// Appelée par Telnyx sans compte (verify_jwt = false) : la signature Ed25519 de chaque appel est vérifiée avec TELNYX_PUBLIC_KEY.
//   1. signature et horodatage (5 minutes au plus), taille bornée ;
//   2. réception suspendue (Réglages) : 200 sans rien écrire ;
//   3. l'événement brut est écrit une fois (clé = id Telnyx), puis 200 tout de suite (Telnyx attend 2 secondes au plus) ;
//   4. ensuite, hors de la réponse : le message est rangé dans sa conversation et ses médias copiés dans le stockage « whatsapp ».
//      Un traitement qui échoue laisse l'événement « à traiter » ; il est repris au prochain appel de Telnyx (renvoi ou autre message).
// Secrets : TELNYX_PUBLIC_KEY (obligatoire), TELNYX_API_KEY (médias sans lien direct ; facultatif), WHATSAPP_ORGANISATION (Zwald par défaut).
// Doc : docs/gestion/whatsapp.md. Logique pure : ./calc.js (tests/gestion-whatsapp.test.js). Base : migration 58.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { apresMessageClient } from "./reponse.ts";
import { suiviApresMessage } from "./suivi.ts";
import { verifierSignature, lireEnveloppe, interpreter, cheminMedia, sourceMedia, mediaCopie, REPONSES, TAILLE_MAX, MEDIA_MAX } from "./calc.js";

const ORGANISATION = Deno.env.get("WHATSAPP_ORGANISATION") || "00000000-0000-0000-0000-00000000a000";
const entetes = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const repondre = (r: { status: number; corps: unknown }) => new Response(JSON.stringify(r.corps), { status: r.status, headers: entetes });

const base = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// L'interrupteur est relu au plus toutes les 30 secondes par instance.
let reglagesLus: { quand: number; active: boolean; numero: string | null; purge_le: string | null } | null = null;
async function reglages(db: SupabaseClient) {
  if (reglagesLus && Date.now() - reglagesLus.quand < 30_000) return reglagesLus;
  const { data, error } = await db.from("whatsapp_reglages").select("reception_active, numero, purge_le").eq("organisation_id", ORGANISATION).maybeSingle();
  if (error) throw new Error(error.message);
  // Sans ligne de réglages, la réception est active (la migration crée la ligne de l'organisation).
  reglagesLus = { quand: Date.now(), active: data ? data.reception_active !== false : true, numero: data?.numero ?? null, purge_le: data?.purge_le ?? null };
  return reglagesLus;
}

async function lireCorps(req: Request) {
  const lecteur = req.body?.getReader();
  if (!lecteur) return new Uint8Array();
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
  return tout;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return repondre(REPONSES.methode);
  if (Number(req.headers.get("content-length") || 0) > TAILLE_MAX) return repondre(REPONSES.trop_gros);
  const corps = await lireCorps(req);
  if (corps === null) return repondre(REPONSES.trop_gros);

  const cle = Deno.env.get("TELNYX_PUBLIC_KEY") || "";
  const verif = await verifierSignature({ subtle: crypto.subtle, cle, signature: req.headers.get("telnyx-signature-ed25519"), horodatage: req.headers.get("telnyx-timestamp"), corps });
  if (!verif.ok) {
    // La raison (jamais la clé ni le corps) aide à diagnostiquer un mauvais secret dans les journaux de la fonction.
    console.warn("signature refusée :", verif.raison);
    return repondre(REPONSES.signature);
  }

  let ev;
  try {
    ev = lireEnveloppe(corps);
  } catch {
    return repondre(REPONSES.invalide);
  }

  const db = base();
  try {
    const r = await reglages(db);
    if (!r.active) return repondre(REPONSES.ok);
    const { error } = await db.from("whatsapp_evenements").upsert(
      { id: ev.id, type: ev.type, survenu_le: ev.survenu_le, organisation_id: ORGANISATION, brut: ev.brut },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("événement non gardé :", String((err as Error)?.message || err));
    // 500 : Telnyx renvoie l'événement plus tard.
    return repondre(REPONSES.serveur);
  }

  const suite = traiterEnAttente(db, ev.id).catch((err) => console.error("traitement :", String(err?.message || err)));
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(suite);
  else await suite;
  return repondre(REPONSES.ok);
});

// Traite l'événement reçu, puis jusqu'à 10 autres restés à traiter (panne passée), du plus ancien au plus récent ; purge au plus une fois par heure.
async function traiterEnAttente(db: SupabaseClient, idCourant: string) {
  const { data: enAttente } = await db.from("whatsapp_evenements").select("id").is("traite_le", null).lt("essais", 5).eq("organisation_id", ORGANISATION).order("recu_le").limit(11);
  const ids = [idCourant, ...((enAttente || []).map((e) => e.id).filter((id) => id !== idCourant))].slice(0, 11);
  for (const id of ids) await traiterUn(db, id);
  // Une préparation arrêtée en route (limite de temps de la fonction) ne reste pas « en préparation » : échec après 3 minutes.
  await db.from("whatsapp_propositions").update({ statut: "echec", erreur: "interrompue" }).eq("statut", "en_cours").lt("cree_le", new Date(Date.now() - 180_000).toISOString()).then(() => {}, () => {});
  const r = await reglages(db);
  if (!r.purge_le || Date.now() - new Date(r.purge_le).getTime() > 3600_000) {
    reglagesLus = null;
    await purger(db);
  }
}

async function traiterUn(db: SupabaseClient, id: string) {
  // Réserve l'événement : un seul traitement à la fois, même si Telnyx l'a envoyé deux fois en même temps. Une réservation de plus de
  // 2 minutes (instance arrêtée en route) se reprend.
  const avant = new Date(Date.now() - 120_000).toISOString();
  const { data: pris } = await db.from("whatsapp_evenements").update({ pris_le: new Date().toISOString() }).eq("id", id).is("traite_le", null).or(`pris_le.is.null,pris_le.lt.${avant}`).select("id, type, survenu_le, brut, essais").maybeSingle();
  if (!pris) return;
  try {
    const d = pris.brut?.data || {};
    const action = interpreter({ id: pris.id, type: pris.type, survenu_le: pris.survenu_le, payload: d.payload || {} });
    await appliquer(db, action);
    await db.from("whatsapp_evenements").update({ traite_le: new Date().toISOString(), erreur: null }).eq("id", id);
  } catch (err) {
    if (err instanceof SansNumero) {
      await db.from("whatsapp_evenements").update({ traite_le: new Date().toISOString(), erreur: err.message }).eq("id", id);
      return;
    }
    const msg = String((err as Error)?.message || err).slice(0, 500);
    console.error("événement", id, ":", msg);
    await db.from("whatsapp_evenements").update({ pris_le: null, erreur: msg, essais: Math.min((pris.essais || 0) + 1, 100) }).eq("id", id);
  }
}

// deno-lint-ignore no-explicit-any
async function appliquer(db: SupabaseClient, a: any) {
  const maintenant = new Date().toISOString();
  if (a.action === "compte") {
    const { error } = await db.from("whatsapp_reglages").update({ etat_compte: a.etat, etat_le: maintenant }).eq("organisation_id", ORGANISATION);
    if (error) throw new Error(error.message);
    return;
  }
  // Un expéditeur sans numéro (identifiant WhatsApp sans téléphone) : rien à ranger, la raison reste visible sur l'événement brut.
  if (a.action === "ignorer") {
    if (a.raison === "numero") throw new SansNumero();
    return;
  }
  if (a.action === "modifier" || a.action === "supprimer") {
    const champs = a.action === "modifier" ? { texte: a.texte, modifie_le: a.quand } : { texte: null, supprime_le: a.quand };
    // L'id d'origine est celui de Telnyx s'il le connaît, sinon le wamid de Meta : on cherche les deux, dans la conversation du client.
    const { data: conv } = await db.from("whatsapp_conversations").select("id").eq("organisation_id", ORGANISATION).eq("telephone", a.telephone).maybeSingle();
    if (!conv) return;
    const { data: cible, error } = await db.from("whatsapp_messages").update(champs).eq("conversation_id", conv.id).or(`telnyx_id.eq.${filtre(a.original)},meta_id.eq.${filtre(a.original)}`).select("id, medias");
    if (error) throw new Error(error.message);
    // Supprimé par le client : ses médias aussi.
    if (a.action === "supprimer") for (const m of cible || []) await effacerMedias(db, m.id, m.medias || []);
    return;
  }
  // Nouveau message.
  const r = await reglages(db);
  if (a.entreprise && a.entreprise !== r.numero) {
    await db.from("whatsapp_reglages").update({ numero: a.entreprise }).eq("organisation_id", ORGANISATION);
    reglagesLus = null;
  }
  const { data, error } = await db.rpc("whatsapp_ranger", { org: ORGANISATION, tel: a.telephone, nom_profil: a.nom, m: a.message });
  if (error) throw new Error(error.message);
  await db.from("whatsapp_reglages").update({ dernier_evenement_le: maintenant }).eq("organisation_id", ORGANISATION);
  if (data?.nouveau && data.message_id) {
    // Suivi (migration 62) : signal de paiement, promesse de Nani, résumé. Hors de ce traitement, comme la réponse préparée.
    enFond(suiviApresMessage(db, data.conversation_id, data.message_id));
    // Un message du client : la réponse se prépare et l'équipe est prévenue, hors de ce traitement (il ne retarde pas les autres événements).
    if (a.message.sens === "entrant") enFond(apresMessageClient(db, data.conversation_id, data.message_id));
    // Nani a répondu depuis l'app : la proposition en attente est traitée (plus de doublon possible).
    else if (a.message.origine === "app") {
      const { error: e } = await db.from("whatsapp_propositions").update({ statut: "traitee", traitee_le: maintenant, traitee_par_quoi: "app" }).eq("conversation_id", data.conversation_id).in("statut", ["a_faire", "en_cours", "envoi"]);
      // Table absente (migration 59 pas encore passée) : rien à marquer.
      if (e && e.code !== "42P01") throw new Error(e.message);
    }
  }
  if (!a.message.medias.length || !data?.message_id) return;
  // Nouveau message : ses médias. Déjà rangé (événement rejoué après une panne) : seulement les médias restés « a_copier ».
  let medias = a.message.medias;
  if (!data.nouveau) {
    const { data: deja } = await db.from("whatsapp_messages").select("medias").eq("id", data.message_id).maybeSingle();
    medias = deja?.medias || [];
    // deno-lint-ignore no-explicit-any
    if (!medias.some((m: any) => m.statut === "a_copier")) return;
  }
  await copierMedias(db, data.conversation_id, data.message_id, medias, a.entreprise || r.numero);
}

class SansNumero extends Error {
  constructor() {
    super("expediteur_sans_numero");
  }
}

// Une tâche de fond gardée en vie par le runtime après la réponse à Telnyx.
function enFond(p: Promise<unknown>) {
  const tache = p.catch((err) => console.error("tâche de fond :", String((err as Error)?.message || err).slice(0, 200)));
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(tache);
}

// Valeur sûre dans un filtre PostgREST « or » (les ids Telnyx et Meta n'ont ni virgule ni parenthèse ; on le garantit).
const filtre = (v: string) => String(v).replace(/[^A-Za-z0-9._:=+/-]/g, "");

async function copierMedias(db: SupabaseClient, conversation: string, message: string, medias: Record<string, unknown>[], numero: string | null) {
  const cleApi = Deno.env.get("TELNYX_API_KEY") || "";
  const resultat = [];
  for (let i = 0; i < medias.length; i++) {
    const m = medias[i];
    if (m.statut !== "a_copier") {
      resultat.push(m);
      continue;
    }
    const src = sourceMedia(m, numero);
    if (!src) {
      resultat.push(mediaCopie(m, { statut: "echec" }));
      continue;
    }
    try {
      // L'API Telnyx exige la clé : envoyée d'emblée. Une adresse Telnyx d'un média est d'abord essayée sans (lien déjà signé).
      const api = src.cle && cleApi && src.url.startsWith("https://api.telnyx.com/");
      let rep = api ? await avecCle(src.url, cleApi) : await fetch(src.url, { signal: AbortSignal.timeout(20_000) });
      if (!api && (rep.status === 401 || rep.status === 403) && src.cle && cleApi) {
        await rep.body?.cancel();
        rep = await avecCle(src.url, cleApi);
      }
      if (!rep.ok) {
        await rep.body?.cancel();
        resultat.push(mediaCopie(m, { statut: "echec", erreur: `http_${rep.status}` }));
        continue;
      }
      if (Number(rep.headers.get("content-length") || 0) > MEDIA_MAX) {
        await rep.body?.cancel();
        resultat.push(mediaCopie(m, { statut: "trop_gros" }));
        continue;
      }
      const octets = await lireBorne(rep, MEDIA_MAX);
      if (!octets) {
        resultat.push(mediaCopie(m, { statut: "trop_gros" }));
        continue;
      }
      const mime = String(m.mime || rep.headers.get("content-type") || "application/octet-stream").split(";")[0];
      const chemin = cheminMedia(ORGANISATION, conversation, message, i + 1, mime);
      const { error } = await db.storage.from("whatsapp").upload(chemin, octets, { contentType: mime, upsert: true });
      if (error) throw new Error(error.message);
      resultat.push(mediaCopie(m, { statut: "copie", chemin, taille: octets.length, mime }));
    } catch (err) {
      resultat.push(mediaCopie(m, { statut: "echec", erreur: String((err as Error)?.message || err).slice(0, 80) }));
    }
  }
  const { error } = await db.from("whatsapp_messages").update({ medias: resultat }).eq("id", message);
  if (error) throw new Error(error.message);
}

// Requête avec la clé API : les redirections ne sont pas suivies automatiquement, pour que la clé n'aille jamais ailleurs que chez Telnyx.
// Une redirection (lien de stockage signé) est suivie une fois, sans la clé.
async function avecCle(url: string, cle: string) {
  const rep = await fetch(url, { headers: { Authorization: `Bearer ${cle}` }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  const vers = rep.headers.get("location");
  if (rep.status >= 300 && rep.status < 400 && vers) {
    await rep.body?.cancel();
    const cible = new URL(vers, url);
    if (cible.protocol !== "https:") return new Response(null, { status: 502 });
    return fetch(cible, { signal: AbortSignal.timeout(20_000) });
  }
  return rep;
}

// Lit une réponse sans jamais garder plus de `max` octets en mémoire (un Content-Length peut manquer). null si c'est plus gros.
async function lireBorne(rep: Response, max: number) {
  const lecteur = rep.body?.getReader();
  if (!lecteur) return new Uint8Array();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await lecteur.cancel();
      return null;
    }
    morceaux.push(value);
  }
  const tout = new Uint8Array(total);
  let i = 0;
  for (const x of morceaux) (tout.set(x, i), (i += x.length));
  return tout;
}

async function effacerMedias(db: SupabaseClient, message: string, medias: Record<string, unknown>[]) {
  const chemins = medias.filter((m) => m.statut === "copie" && typeof m.chemin === "string").map((m) => m.chemin as string);
  if (chemins.length) {
    const { error } = await db.storage.from("whatsapp").remove(chemins);
    if (error) throw new Error(error.message);
  }
  if (!medias.length) return;
  await db.from("whatsapp_messages").update({ medias: medias.map((m) => (m.statut === "copie" ? { ...m, statut: "efface", chemin: null } : m)) }).eq("id", message);
}

// Conservation (migration 58) : la base supprime ce qui a passé son délai et rend les médias de plus de 90 jours, effacés ici du stockage.
async function purger(db: SupabaseClient) {
  const { data, error } = await db.rpc("purger_whatsapp", { org: ORGANISATION });
  if (error) throw new Error(error.message);
  // Propositions de plus de 90 jours (migration 59 ; sans elle, rien).
  await db.rpc("purger_whatsapp_propositions", { org: ORGANISATION }).then(() => {}, () => {});
  for (const ligne of data || []) {
    const { data: msg } = await db.from("whatsapp_messages").select("medias").eq("id", ligne.message_id).maybeSingle();
    if (msg) await effacerMedias(db, ligne.message_id, msg.medias || []);
  }
}
