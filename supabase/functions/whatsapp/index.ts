// Fonction publique « whatsapp » : reçoit les événements WhatsApp de Telnyx (coexistence, numéro de Nani pour Secret et VIP Taxi Lanta).
// Appelée par Telnyx sans compte (verify_jwt = false) : la signature Ed25519 de chaque appel est vérifiée avec TELNYX_PUBLIC_KEY.
//   1. signature et horodatage (5 minutes au plus), taille bornée ;
//   2. réception suspendue (Réglages) : 200 sans rien écrire ;
//   3. l'événement brut est écrit une fois (clé = id Telnyx), puis 200 tout de suite (Telnyx attend 2 secondes au plus) ;
//   4. ensuite, hors de la réponse : le message est rangé dans sa conversation et ses médias copiés dans le stockage « whatsapp ».
//      Un traitement qui échoue laisse l'événement « à traiter » ; il est repris au prochain appel de Telnyx et par la reprise.
//   5. Reprise (migration 64) : pg_cron appelle la fonction toutes les 5 minutes avec { "mode": "reprise" } et le jeton de « rappels »
//      (RAPPELS_SECRET ou clé de service) : événements en échec, envois au résultat inconnu passés en échec après 5 minutes.
//   6. Statuts d'envoi (message.sent, message.finalized, message.read) d'un message envoyé depuis Gestion : remis, lu ou échec.
//   7. Messages manquants (migration 100) : webhook du compte WhatsApp (whatsapp.messages) pour rattraper ce que Telnyx n'a pas transmis,
//      ligne visible pour un message que WhatsApp n'a pas transmis, client reconnu par son BSUID, repère « Un message du client semble
//      manquer » sur une réponse de Nani (./manquants.js). Rien de tout cela n'appelle l'IA ni n'envoie de notification.
//   8. Message automatique de nuit (migration 132, ./nuit.ts) : un client qui écrit entre 22:00 et 06:00 (Bangkok) reçoit une fois par nuit le
//      message d'absence de Réglages > WhatsApp, à la place de l'app de Nani en mode avion. La base décide et garantit l'unicité.
// Secrets : TELNYX_PUBLIC_KEY (obligatoire), TELNYX_API_KEY (médias sans lien direct ; facultatif), WHATSAPP_ORGANISATION (Zwald par défaut).
// Doc : docs/gestion/whatsapp.md. Logique pure : ./calc.js (tests/gestion-whatsapp.test.js). Base : migration 58.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { apresMessageClient } from "./reponse.ts";
import { suiviApresMessage } from "./suivi.ts";
import { apprendreDeNani } from "../agent/apprendre-whatsapp.js";
import { pretApresMessage, rattraperPret } from "./pret.ts";
import { messageDeNuit, reprendreNuit } from "./nuit.ts";
import { verifierSignature, lireEnveloppe, interpreter, cheminMedia, sourceMedia, mediaCopie, mediaApresErreur, resteACopier, REPONSES, TAILLE_MAX, MEDIA_MAX } from "./calc.js";
import { interpreterStatut, statutsRemplacables, aReprendre, limiteEnvoi, ESSAIS_MAX, STATUT_FENETRE_MS, ATTENTE } from "./fiabilite.js";
import { interpreterWaba, rattrapageAttend, sembleManquer, citationDatable, repereAutorise, REPERE } from "./manquants.js";
import { BUCKET_SORTANT, cheminsSortants, sansFichierSortant, statutLibereFichier, sortantsAPurger, dimensionsImage } from "../whatsapp-envoi/calc.js";

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

// Comparaison en temps constant (comme « rappels ») : la durée ne révèle pas combien de caractères du jeton sont justes.
async function memeSecret(a: string, b: string) {
  const empreinte = async (x: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)));
  const [ha, hb] = await Promise.all([empreinte(a), empreinte(b)]);
  let ecart = 0;
  for (let i = 0; i < ha.length; i++) ecart |= ha[i] ^ hb[i];
  return ecart === 0;
}
async function appelCron(req: Request) {
  const jeton = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!jeton) return false;
  for (const nom of ["RAPPELS_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const secret = Deno.env.get(nom);
    if (secret && (await memeSecret(jeton, secret))) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return repondre(REPONSES.methode);
  // La reprise (pg_cron « whatsapp-reprise ») : pas de signature Telnyx, le jeton du cron. Un appel sans signature ni bon jeton : 401.
  if (!req.headers.get("telnyx-signature-ed25519") && req.headers.get("authorization")) {
    if (!(await appelCron(req))) return repondre(REPONSES.signature);
    await req.body?.cancel();
    try {
      const bilan = await traiterEnAttente(base(), null);
      return new Response(JSON.stringify({ ok: true, ...bilan }), { status: 200, headers: entetes });
    } catch (err) {
      console.error("reprise :", String((err as Error)?.message || err).slice(0, 200));
      return repondre(REPONSES.serveur);
    }
  }
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
  } catch (err) {
    // Forme inconnue (webhook du compte WhatsApp ?) : les clés du premier niveau seulement, jamais le contenu, pour la reconnaître.
    let cles = "";
    try {
      const j = JSON.parse(new TextDecoder().decode(corps));
      cles = j && typeof j === "object" ? Object.keys(j).slice(0, 10).join(",") : typeof j;
    } catch { /* pas du JSON */ }
    console.warn("enveloppe refusée :", (err as { code?: string })?.code || "invalide", cles.slice(0, 200));
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

// Traite l'événement reçu (aucun pour la reprise), puis jusqu'à 10 autres restés à traiter (25 pour la reprise), du plus ancien au plus
// récent ; purge au plus une fois par heure.
async function traiterEnAttente(db: SupabaseClient, idCourant: string | null) {
  const max = idCourant ? 11 : 25;
  const { data: enAttente, error } = await db.from("whatsapp_evenements").select("id").is("traite_le", null).lt("essais", 5).eq("organisation_id", ORGANISATION).order("recu_le").limit(max);
  if (error) console.error("événements à reprendre illisibles :", error.message);
  const ids = [...(idCourant ? [idCourant] : []), ...((enAttente || []).map((e) => e.id).filter((id) => id !== idCourant))].slice(0, max);
  let traites = 0;
  for (const id of ids) if (await traiterUn(db, id)) traites++;
  // Une préparation arrêtée en route (limite de temps de la fonction) ne reste pas « en préparation » : échec après 3 minutes.
  await db.from("whatsapp_propositions").update({ statut: "echec", erreur: "interrompue" }).eq("statut", "en_cours").lt("cree_le", new Date(Date.now() - 180_000).toISOString()).then(() => {}, () => {});
  // Un envoi depuis Gestion sans réponse sûre de Telnyx depuis 5 minutes : échec visible, Nani vérifie dans WhatsApp (migration 64).
  const { data: expires, error: errE } = await db.from("whatsapp_messages").update({ statut_envoi: "echec", erreur_envoi: "sans_confirmation", statut_le: new Date().toISOString() }).eq("statut_envoi", "envoi").lt("envoye_le", limiteEnvoi()).select("id");
  if (errE) console.error("envois à vérifier :", errE.message);
  // Vouchers envoyés depuis Gestion : leur fichier temporaire ne reste jamais plus d'une heure (à chaque passage, la reprise passe toutes les
  // 5 minutes). Une panne du stockage n'arrête pas le reste du traitement.
  await purgerSortants(db).catch((err) => console.error("purge des vouchers envoyés :", String((err as Error)?.message || err).slice(0, 200)));
  // Reprise seulement : les conversations jamais passées par « Prêt à réserver » (celles d'avant la migration 85), 20 par passage.
  if (!idCourant) await rattraperPret(db, ORGANISATION).catch((err) => console.error("rattrapage prêt à réserver :", String((err as Error)?.message || err).slice(0, 200)));
  // Reprise seulement : les messages de nuit refusés par Telnyx (refus sûr) se retentent, la même nuit, 3 essais en tout (migration 132).
  if (!idCourant) await reprendreNuit(db, ORGANISATION).catch((err) => console.error("message de nuit, reprise :", String((err as Error)?.message || err).slice(0, 200)));
  const r = await reglages(db);
  if (!r.purge_le || Date.now() - new Date(r.purge_le).getTime() > 3600_000) {
    reglagesLus = null;
    await purger(db);
  }
  return { essayes: ids.length, traites, envois_expires: (expires || []).length };
}

// Rend true si l'événement a été traité (rangé, ou classé avec sa raison).
async function traiterUn(db: SupabaseClient, id: string) {
  // Réserve l'événement et compte l'essai tout de suite (migration 64) : un seul traitement à la fois, même si Telnyx l'a envoyé deux fois en
  // même temps ; une réservation de plus de 2 minutes (instance arrêtée en route) se reprend, et cet essai interrompu compte aussi.
  const { data: lignes, error: errR } = await db.rpc("whatsapp_reserver_evenement", { p_id: id });
  if (errR) throw new Error(`réservation : ${errR.message}`);
  const pris = Array.isArray(lignes) ? lignes[0] : lignes;
  if (!pris) return false;
  const fermer = async (champs: Record<string, unknown>) => {
    const { error } = await db.from("whatsapp_evenements").update(champs).eq("id", id);
    if (error) console.error("événement", id, "non clos :", error.message);
  };
  try {
    const d = pris.brut?.data || {};
    const ev = { id: pris.id, type: pris.type, survenu_le: pris.survenu_le, payload: d.payload || {} };
    // Webhook du compte WhatsApp : seulement les messages adressés au numéro de Nani, lu dans les réglages (jamais l'inverse).
    const action = interpreterStatut(ev) || interpreterWaba(ev, { numero: (await reglages(db)).numero }) || interpreter(ev);
    await appliquer(db, action, pris);
    await fermer({ traite_le: new Date().toISOString(), erreur: null });
    return true;
  } catch (err) {
    // Rattrapage par le webhook du compte WhatsApp : message.received a encore 2 minutes pour arriver le premier. Repris plus tard, sans
    // compter cet essai (plusieurs messages en 2 minutes ne doivent pas l'épuiser).
    if (err instanceof Patiente) {
      await fermer({ pris_le: null, erreur: `${ATTENTE}rattrapage`, essais: Math.max(0, (Number(pris.essais) || 1) - 1) });
      return false;
    }
    // Expéditeur sans numéro, ou cible jamais trouvée (message d'origine absent depuis 30 minutes ou après le dernier essai) : classé avec
    // sa raison, sans compter comme une erreur.
    if (err instanceof Classe || (err instanceof CibleAbsente && (!aReprendre(pris.recu_le, Date.now(), err.fenetre) || pris.essais >= ESSAIS_MAX))) {
      await fermer({ traite_le: new Date().toISOString(), erreur: err.message });
      return true;
    }
    // Une cible absente n'est pas une panne : préfixe « attente: », hors du compteur d'erreurs de Réglages.
    const msg = `${err instanceof CibleAbsente ? ATTENTE : ""}${String((err as Error)?.message || err)}`.slice(0, 500);
    console.error("événement", id, ":", msg);
    await fermer({ pris_le: null, erreur: msg });
    return false;
  }
}

// deno-lint-ignore no-explicit-any
async function appliquer(db: SupabaseClient, a: any, pris: { recu_le?: string } = {}) {
  const maintenant = new Date().toISOString();
  // Webhook du compte WhatsApp : un message par action, dans l'ordre.
  // Une action classée (sans id) n'arrête pas les suivantes ; une autre erreur (attente, cible absente, panne) est levée à la fin, l'événement
  // est repris et ce qui est déjà rangé ne l'est pas deux fois.
  if (a.action === "lot") {
    let premiere: unknown = null;
    for (const x of a.actions) {
      try {
        await appliquer(db, x, pris);
      } catch (err) {
        if (!(err instanceof Classe) && !premiere) premiere = err;
      }
    }
    if (premiere) throw premiere;
    return;
  }
  if (a.action === "compte") {
    const { error } = await db.from("whatsapp_reglages").update({ etat_compte: a.etat, etat_le: maintenant }).eq("organisation_id", ORGANISATION);
    if (error) throw new Error(error.message);
    return;
  }
  // Un expéditeur sans numéro (identifiant WhatsApp sans téléphone) : rien à ranger, la raison reste visible sur l'événement brut.
  if (a.action === "ignorer") {
    if (a.raison === "numero") throw new Classe("expediteur_sans_numero");
    return;
  }
  // Statut d'envoi (migration 64) : sur le message sortant qui porte cet id, sans jamais revenir en arrière (remis puis « sent » en retard).
  if (a.action === "statut") {
    const ids = [a.telnyx_id ? `telnyx_id.eq.${filtre(a.telnyx_id)}` : null, a.meta_id ? `meta_id.eq.${filtre(a.meta_id)}` : null].filter(Boolean).join(",");
    const { data: msgs, error } = await db.from("whatsapp_messages").select("id, statut_envoi, medias, meta_id").eq("sens", "sortant").or(ids).limit(5);
    if (error) throw new Error(error.message);
    // Message inconnu : statut arrivé avant que whatsapp-envoi note l'id Telnyx (repris), ou message hors de Gestion.
    if (!msgs || !msgs.length) throw new CibleAbsente("statut_message_inconnu", STATUT_FENETRE_MS);
    const avant = statutsRemplacables(a.statut);
    for (const m of msgs) {
      if (m.statut_envoi !== null && !avant.includes(m.statut_envoi)) continue;
      // Écriture conditionnelle : un autre statut écrit entre-temps n'est pas écrasé.
      const q = db.from("whatsapp_messages").update({ statut_envoi: a.statut, erreur_envoi: a.erreur, statut_le: a.quand || maintenant }).eq("id", m.id);
      const { error: errU } = await (m.statut_envoi === null ? q.is("statut_envoi", null) : q.in("statut_envoi", avant));
      if (errU) throw new Error(errU.message);
    }
    // Un message envoyé depuis Gestion n'a que l'id Telnyx : son wamid (foreign_id du statut) est noté une fois (migration 100), pour qu'une
    // citation par wamid le retrouve. Un wamid déjà pris ailleurs (index unique) n'empêche pas le statut.
    if (a.meta_id) for (const m of msgs) {
      if (m.meta_id) continue;
      const { error: errW } = await db.from("whatsapp_messages").update({ meta_id: a.meta_id }).eq("id", m.id).is("meta_id", null);
      if (errW) console.warn("wamid d'un envoi non noté :", errW.code || "");
    }
    // Voucher envoyé depuis Gestion (whatsapp-envoi/voucher.js) : remis ou lu, Meta a pris l'image ; en échec, elle ne partira plus.
    // Le fichier temporaire du bucket « whatsapp-sortant » est effacé. Un effacement manqué est repris par la purge (une heure au plus).
    if (statutLibereFichier(a.statut)) for (const m of msgs) await effacerSortant(db, m.id, m.medias || []);
    return;
  }
  if (a.action === "modifier" || a.action === "supprimer") {
    const champs = a.action === "modifier" ? { texte: a.texte, modifie_le: a.quand } : { texte: null, supprime_le: a.quand };
    // L'id d'origine est celui de Telnyx s'il le connaît, sinon le wamid de Meta : on cherche les deux, dans la conversation du client.
    // Message d'origine pas encore rangé (en échec, repris plus tard) : l'événement est repris aussi, au lieu d'être clos sans rien toucher.
    const conv = await conversationDe(db, a.telephone, a.bsuid);
    if (!conv) throw new CibleAbsente("original_introuvable");
    const { data: cible, error } = await db.from("whatsapp_messages").update(champs).eq("conversation_id", conv.id).or(`telnyx_id.eq.${filtre(a.original)},meta_id.eq.${filtre(a.original)}`).select("id, medias");
    if (error) throw new Error(error.message);
    if (!cible || !cible.length) throw new CibleAbsente("original_introuvable");
    // Supprimé par le client : ses médias aussi.
    if (a.action === "supprimer") for (const m of cible || []) await effacerMedias(db, m.id, m.medias || []);
    // Un message modifié ou supprimé peut défaire ou créer le signal « Prêt à réserver » (migration 85).
    enFond(pretApresMessage(db, conv.id));
    return;
  }
  // Rattrapage (webhook du compte WhatsApp) : déjà reçu par message.received, rien à faire ; sinon, après 2 minutes, rangé comme un message.
  // Sans wamid, impossible de savoir s'il est déjà là : classé.
  if (a.action === "rattrapage") {
    if (!a.message.meta_id) throw new Classe("rattrapage_sans_id");
    const { data: deja, error: errD } = await db.from("whatsapp_messages").select("id, type").eq("meta_id", a.message.meta_id).limit(1);
    if (errD) throw new Error(errD.message);
    // Une ligne « non transmis » du même wamid ne bloque pas le vrai contenu : whatsapp_ranger la remplace (migration 100).
    if (deja && deja.length && deja[0].type !== "non_transmis") return;
    if (rattrapageAttend(pris.recu_le)) throw new Patiente("rattrapage");
  }
  // Client sans numéro : l'ancienne whatsapp_ranger (migration 100 pas encore passée) exige un numéro. L'événement attend la migration,
  // sans consommer d'essai, au lieu d'échouer cinq fois.
  if (!a.telephone && !(await migration100(db))) throw new Patiente("migration_100");
  // Nouveau message (ou rattrapage, ou ligne « non transmis »).
  const r = await reglages(db);
  // Le numéro de l'entreprise n'est appris que du profil de messagerie (message.received, message.echo), jamais du webhook du compte :
  // whatsapp-envoi l'utilise comme expéditeur.
  if (a.entreprise && !a.waba && a.entreprise !== r.numero) {
    await db.from("whatsapp_reglages").update({ numero: a.entreprise }).eq("organisation_id", ORGANISATION);
    reglagesLus = null;
  }
  // Le BSUID part avec le message (migration 100) : la conversation est retrouvée par lui quand le numéro manque.
  const { data, error } = await db.rpc("whatsapp_ranger", { org: ORGANISATION, tel: a.telephone || null, nom_profil: a.nom, m: { ...a.message, bsuid: a.bsuid || null } });
  if (error) throw new Error(error.message);
  await db.from("whatsapp_reglages").update({ dernier_evenement_le: maintenant }).eq("organisation_id", ORGANISATION);
  // Ligne « Message du client non transmis » : visible dans la conversation et la liste, sans réponse préparée, sans suivi, sans notification.
  if (a.action === "non_transmis") return;
  // Client connu par son seul BSUID : ni tri, ni réponse, ni suivi par l'IA tant que la conversation n'a pas de numéro ou que Nani ne l'a pas
  // typée (un Contact personnel pourrait s'y cacher : dans le doute, pas d'IA).
  if (data?.nouveau && data.message_id && !a.telephone && !(await iaPourBsuid(db, data.conversation_id))) {
    if (a.message.medias.length) await copierMedias(db, data.conversation_id, data.message_id, a.message.medias, r.numero);
    return;
  }
  // Réponse de Nani depuis l'app : un message du client semble-t-il manquer avant elle ? Repère discret, aucune IA, aucune notification.
  // Une réaction n'est pas une réponse : elle ne pose aucun repère.
  if (data?.nouveau && data.message_id && a.message.origine === "app" && a.message.type !== "reaction" && !data.remplace) await reperer(db, data.conversation_id, data.message_id, a.message);
  if (data?.nouveau && data.message_id) {
    // Suivi (migration 62) : signal de paiement, promesse de Nani, résumé. Hors de ce traitement, comme la réponse préparée.
    enFond(suiviApresMessage(db, data.conversation_id, data.message_id));
    // Prêt à réserver (migration 85) : sans IA, refait à chaque message, de Nani comme du client.
    enFond(pretApresMessage(db, data.conversation_id));
    // Un message du client : la réponse se prépare et l'équipe est prévenue, hors de ce traitement (il ne retarde pas les autres événements).
    if (a.message.sens === "entrant") {
      enFond(apresMessageClient(db, data.conversation_id, data.message_id));
      // La nuit (22:00 à 06:00, Bangkok) : le message d'absence, une fois par conversation et par nuit (migration 132, ./nuit.ts).
      enFond(messageDeNuit(db, data.message_id));
    }
    // Nani a répondu depuis l'app : la proposition en attente est traitée (plus de doublon possible).
    else if (a.message.origine === "app") {
      const { error: e } = await db.from("whatsapp_propositions").update({ statut: "traitee", traitee_le: maintenant, traitee_par_quoi: "app" }).eq("conversation_id", data.conversation_id).in("statut", ["a_faire", "en_cours", "envoi"]);
      // Table absente (migration 59 pas encore passée) : rien à marquer.
      if (e && e.code !== "42P01") throw new Error(e.message);
      // Sa réponse écrite autrement que la proposition : l'écart devient un apprentissage de l'Assistant (agent/apprendre-whatsapp.js).
      enFond(apprendreDeNani(db, data.conversation_id, data.message_id));
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

// Événement classé sans rien ranger, avec sa raison (expéditeur sans numéro) : traité, ne compte pas comme une erreur.
class Classe extends Error {}
// Rattrapage trop récent : repris plus tard, l'essai ne compte pas.
class Patiente extends Error {}

// Migration 100 passée (colonne bsuid) : relu à chaque fois tant qu'elle manque, puis gardé.
let colonneBsuid = false;
async function migration100(db: SupabaseClient) {
  if (colonneBsuid) return true;
  const { error } = await db.from("whatsapp_conversations").select("bsuid").limit(1);
  colonneBsuid = !error;
  return colonneBsuid;
}

// Une conversation sans numéro n'a d'IA que si Nani l'a typée. Lecture impossible : pas d'IA.
async function iaPourBsuid(db: SupabaseClient, conversation: string) {
  const { data, error } = await db.from("whatsapp_conversations").select("telephone, type_contact, reponses").eq("id", conversation).maybeSingle();
  if (error || !data || data.reponses === "jamais") return false;
  return !!data.telephone || !!data.type_contact;
}

// Conversation du client : par son numéro, sinon par son BSUID (client sans numéro, migration 100).
async function conversationDe(db: SupabaseClient, telephone: string | null, bsuid: string | null) {
  for (const [col, val] of [["telephone", telephone], ["bsuid", bsuid]] as const) {
    if (!val) continue;
    const { data, error } = await db.from("whatsapp_conversations").select("id").eq("organisation_id", ORGANISATION).eq(col, val).maybeSingle();
    // Colonne bsuid absente (migration 100 pas encore passée) : la recherche par numéro suffit.
    if (error && col === "bsuid" && error.code === "42703") return null;
    if (error) throw new Error(error.message);
    if (data) return data;
  }
  return null;
}

// Repère « Un message du client semble manquer » (migration 100) sur une réponse de Nani depuis l'app : le message d'avant était déjà à elle
// et date de plus de 6 heures, ou elle cite un message que Gestion n'a pas. Le message porte le repère, la conversation sa date (effacée au
// prochain message du client). Une panne ici n'empêche pas le rangement.
// deno-lint-ignore no-explicit-any
async function reperer(db: SupabaseClient, conversation: string, message: string, m: any) {
  try {
    // Jamais pour un partenaire, un apporteur, une fiche partenaire ni un Contact personnel (lecture impossible : rien).
    const { data: conv, error: errV } = await db.from("whatsapp_conversations").select("type_contact, partenaire_id, reponses").eq("id", conversation).maybeSingle();
    if (errV || !repereAutorise(conv)) return;
    // Le message automatique de nuit (migration 132) n'est pas une réponse de Nani : il ne compte pas comme le message d'avant.
    const { data: avant, error } = await db.from("whatsapp_messages").select("sens, envoye_le").eq("conversation_id", conversation).neq("id", message)
      .is("automatique", null).lte("envoye_le", m.envoye_le).order("envoye_le", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    // Seul un id Telnyx cité se date (passé par Telnyx, donc depuis le 20.11.2026) : un wamid cité inconnu ne pose aucun repère.
    let citeInconnu = false;
    if (m.repond_a && citationDatable(m.repond_a)) {
      const id = filtre(m.repond_a);
      const { data: cite, error: errC } = await db.from("whatsapp_messages").select("id").or(`telnyx_id.eq.${id},meta_id.eq.${id}`).limit(1);
      if (errC) throw new Error(errC.message);
      citeInconnu = !cite || !cite.length;
    }
    const raison = sembleManquer({ conv, envoyeLe: m.envoye_le, texte: m.texte || "", precedent: (avant || [])[0] || null, citeInconnu });
    if (!raison) return;
    const { error: e1 } = await db.from("whatsapp_messages").update({ repere: REPERE }).eq("id", message);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await db.rpc("whatsapp_signaler_manque", { p_conversation: conversation, p_quand: m.envoye_le });
    if (e2) throw new Error(e2.message);
  } catch (err) {
    console.error("repère d'un message manquant :", String((err as Error)?.message || err).slice(0, 200));
  }
}
// La cible de l'événement manque encore : repris pendant sa fenêtre (30 minutes, 10 pour un statut), puis classé avec sa raison.
class CibleAbsente extends Error {
  fenetre: number | undefined;
  constructor(message: string, fenetre?: number) {
    super(message);
    this.fenetre = fenetre;
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
        resultat.push(mediaApresErreur(m, { http: rep.status }));
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
      // Largeur et hauteur lues dans l'en-tête (23.11.2026) : Gestion réserve la place de la vignette avant son chargement.
      // Un en-tête mal formé ne met jamais le média en erreur : la photo est gardée, sans dimensions (boîte carrée dans Gestion).
      let dims = null;
      try {
        dims = mime.startsWith("image/") ? dimensionsImage(octets) : null;
      } catch {
        dims = null;
      }
      resultat.push(mediaCopie(m, { statut: "copie", chemin, taille: octets.length, mime, ...(dims || {}) }));
    } catch (err) {
      // Délai dépassé, réseau ou stockage : passager, la source reste pour un nouvel essai.
      resultat.push(mediaApresErreur(m, { erreur: String((err as Error)?.message || err) }));
    }
  }
  const { error } = await db.from("whatsapp_messages").update({ medias: resultat }).eq("id", message);
  if (error) throw new Error(error.message);
  // Un média à reprendre : l'événement reste à traiter (essais + 1) et sera repris, seuls les médias « a_copier » sont recopiés.
  if (resteACopier(resultat)) throw new Error("medias_a_reprendre");
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

// Fichier temporaire d'un voucher envoyé depuis Gestion : effacé du bucket privé, puis le média ne le cite plus. Seul un chemin de la forme
// <organisation>/<horodatage>-<uuid>.<png|jpg|webp> du dossier de cette organisation est effacé (cheminsSortants).
async function effacerSortant(db: SupabaseClient, message: string, medias: Record<string, unknown>[]) {
  const chemins = cheminsSortants(medias, ORGANISATION);
  if (!chemins.length) return;
  const { error } = await db.storage.from(BUCKET_SORTANT).remove(chemins);
  if (error) return console.error("voucher envoyé : fichier non effacé, la purge s'en charge", error.message);
  const { error: errM } = await db.from("whatsapp_messages").update({ medias: sansFichierSortant(medias) }).eq("id", message);
  if (errM) console.error("voucher envoyé : média non mis à jour", errM.message);
}

// Purge des vouchers envoyés (migration 73) : tout fichier de plus d'une heure du dossier de l'organisation, quel que soit son message
// (envoi au résultat inconnu, « Pas parti », statut jamais arrivé). 100 par passage, les plus anciens d'abord. whatsapp-envoi refuse tout
// dépôt pour une autre organisation que WHATSAPP_ORGANISATION : ce seul dossier suffit.
async function purgerSortants(db: SupabaseClient) {
  const stockage = db.storage.from(BUCKET_SORTANT);
  const { data, error } = await stockage.list(ORGANISATION, { limit: 100, sortBy: { column: "created_at", order: "asc" } });
  if (error) throw new Error(error.message);
  const vieux = sortantsAPurger(data || [], ORGANISATION);
  if (!vieux.length) return;
  const { error: errR } = await stockage.remove(vieux);
  if (errR) throw new Error(errR.message);
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
