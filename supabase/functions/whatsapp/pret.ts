// Boîte WhatsApp, « Prêt à réserver » (migration 85) et étapes de la conversation (migration 105, 22.11.2026), lancé par index.ts :
//   - après chaque nouveau message (client ou Nani), modifié ou supprimé : la décision et les faits sont refaits sur les 60 derniers messages ;
//   - à la reprise (pg_cron, toutes les 5 minutes) : 20 conversations jamais calculées (ou sorties de « Contact personnel »), les plus
//     récentes d'abord. Les conversations déjà là avant la migration entrent ainsi dans le calcul sans attendre leur prochain message.
// Aucun appel à l'IA : la règle est dans pret.js et etapes.js (expressions sur le texte). Rien ne part chez Anthropic, ni au client, ni au
// prestataire. Seules les colonnes pret_reserver et avancee sont écrites, et seulement quand elles changent. Ne lève jamais ; chaque échec va
// dans la console. Sans la migration 85, rien n'est écrit ; sans la 105, seule pret_reserver l'est.
// Avec la #314 : les messages « non transmis » n'ont pas de texte du client, ils ne sont jamais lus ici.
// Migration 110 : les repères « partenaire » sans IA (type-contact.js) sont refaits au même moment (colonne type_signaux, des codes et des
// nombres, jamais un texte), et le type « partenaire » est déduit si les décisions du tri le disent déjà (reponse.ts, poserTypeDeduit).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { MESSAGES_LUS, etatPret, pretChange, memeNumero } from "./pret.js";
import { faitsAvancee, entrepriseDuMessage } from "./etapes.js";
import { signauxPartenaire, typeADeduire } from "./type-contact.js";
import { avecAutomatique, sansAutomatiques } from "./automatique.js";

const absente = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204");
export const RATTRAPAGE_MAX = 20;
const COLONNES = "id, organisation_id, telephone, reponses, type_contact, partenaire_id, client_id, dossier_id, tri, pret_reserver";
const COLONNES_TYPE = "type_source, type_avis, type_signaux";

// Les services des dossiers du client, chez Secret et Taxi seulement (ZTP jamais) : le dossier relié, ceux de la fiche reliée et ceux des
// fiches du même numéro (comme l'écran, whatsapp-pret-calc.mjs, fichesDuClient), non annulés, chacun avec son entreprise (« secret », « taxi »).
// Un service créé depuis le prix donné retire « prêt à réserver » (relecture du 22.11.2026 : la carte de l'Assistant a ajouté la course à un
// dossier plus ancien que le prix, la confirmation envoyée ensuite refaisait « prêt »). Une lecture en échec rend [] : la décision reste
// celle des messages, comme avant.
// deno-lint-ignore no-explicit-any
export async function reservationsDuClient(db: SupabaseClient, conv: any) {
  try {
    if (!conv || !conv.organisation_id) return [];
    const { data: ents, error: errE } = await db.from("entites").select("id, slug").eq("organisation_id", conv.organisation_id).in("slug", ["secret", "taxi"]);
    if (errE || !ents || !ents.length) return [];
    const ids = ents.map((e: { id: string }) => e.id);
    const slugDe = new Map(ents.map((e: { id: string; slug: string }) => [e.id, e.slug]));
    const fiches = new Set<string>(conv.client_id ? [conv.client_id] : []);
    // Les fiches du même numéro : les deux derniers chiffres filtrent en base (un séparateur ne les coupe pas), memeNumero tranche.
    const fin = String(conv.telephone || "").replace(/\D/g, "").slice(-2);
    if (fin.length === 2) {
      const { data: cl, error: errC } = await db.from("clients").select("id, telephone").in("entite_id", ids).ilike("telephone", `%${fin}`).limit(1000);
      if (!errC) for (const c of cl || []) if (memeNumero(c.telephone, conv.telephone)) fiches.add(c.id);
    }
    const filtres = [conv.dossier_id ? `id.eq.${conv.dossier_id}` : "", ...[...fiches].slice(0, 20).map((id) => `client_id.eq.${id}`)].filter(Boolean).join(",");
    if (!filtres) return [];
    const { data: dossiers, error: errD } = await db.from("dossiers").select("id").in("entite_id", ids).eq("annule", false).or(filtres).limit(50);
    if (errD || !dossiers || !dossiers.length) return [];
    const { data: resas, error: errR } = await db.from("reservations").select("created_at, statut, entite_id").in("dossier_id", dossiers.map((d: { id: string }) => d.id)).in("entite_id", ids).order("created_at", { ascending: false }).limit(50);
    if (errR) return [];
    return (resas || []).map((r: { created_at: string; statut: string; entite_id: string }) => ({ created_at: r.created_at, statut: r.statut, entreprise: slugDe.get(r.entite_id) || null }));
  } catch (err) {
    console.error("whatsapp : services du client illisibles", String((err as Error)?.message || err).slice(0, 200));
    return [];
  }
}

export async function pretApresMessage(db: SupabaseClient, conversationId: string) {
  try {
    const lire = (cols: string) => db.from("whatsapp_conversations").select(cols).eq("id", conversationId).maybeSingle();
    let avecAvancee = true;
    let avecType = true;
    // deno-lint-ignore no-explicit-any
    let r: any = await lire(`${COLONNES}, avancee, ${COLONNES_TYPE}`);
    if (r.error && absente(r.error)) {
      avecType = false;
      r = await lire(`${COLONNES}, avancee`);
    }
    if (r.error && absente(r.error)) {
      avecAvancee = false;
      r = await lire(COLONNES);
    }
    if (r.error) {
      if (!absente(r.error)) console.error("whatsapp : prêt à réserver, conversation illisible", r.error.message);
      return;
    }
    const conv = r.data;
    if (!conv) return;
    // origine et statut_envoi : un voucher envoyé depuis Gestion (média « voucher » rangé par whatsapp-envoi) et son résultat.
    // Sans le message automatique de nuit (migration 132) : il n'annonce rien et ne répond à rien.
    const { data: msgs, error: errM } = await avecAutomatique((cols) => db.from("whatsapp_messages").select(cols).eq("conversation_id", conversationId).neq("type", "non_transmis").order("envoye_le", { ascending: false }).limit(MESSAGES_LUS), "id, sens, origine, type, texte, medias, envoye_le, supprime_le, statut_envoi");
    if (errM) return console.error("whatsapp : prêt à réserver, messages illisibles", errM.message);
    const messages = [...sansAutomatiques(msgs)].reverse();
    const reservations = await reservationsDuClient(db, conv);
    const patch: Record<string, unknown> = {};
    const decision = etatPret(conv, messages, undefined, { reservations, entrepriseDu: (v: unknown[], i: number) => entrepriseDuMessage(v, i, conv) });
    if (pretChange(conv.pret_reserver, decision)) patch.pret_reserver = decision;
    if (avecAvancee) {
      const faits = faitsAvancee(conv, messages, undefined, { reservations });
      if (pretChange(conv.avancee, faits)) patch.avancee = faits;
    }
    let signaux = null;
    if (avecType) {
      signaux = signauxPartenaire(messages, { conv });
      if (pretChange(conv.type_signaux, signaux)) patch.type_signaux = signaux;
    }
    if (Object.keys(patch).length) {
      const { error: errU } = await db.from("whatsapp_conversations").update(patch).eq("id", conversationId);
      if (errU && !absente(errU)) console.error("whatsapp : prêt à réserver non gardé", errU.message);
    }
    // Le type « partenaire » déduit (mêmes gardes que reponse.ts ; la base le marque « déduit » et ne touche jamais un type de Nani).
    if (avecType && typeADeduire({ ...conv, type_signaux: signaux })) {
      const { error: errT } = await db.from("whatsapp_conversations").update({ type_contact: "partenaire" }).eq("id", conversationId).is("type_contact", null).is("type_source", null).is("partenaire_id", null).is("client_id", null).is("dossier_id", null).neq("reponses", "jamais");
      if (errT && !absente(errT)) console.error("whatsapp : type déduit non posé", errT.message);
    }
  } catch (err) {
    console.error("whatsapp : prêt à réserver", String((err as Error)?.message || err).slice(0, 200));
  }
}

// Jamais calculées, ou calculées comme Contact personnel puis remises en « auto » (rien n'avait été lu d'elles).
export const FILTRE_RATTRAPAGE = "pret_reserver.is.null,and(pret_reserver->>motif.eq.exclue,reponses.neq.jamais)";
export const FILTRE_RATTRAPAGE_ETAPES = `${FILTRE_RATTRAPAGE},avancee.is.null,and(avancee->>jamais.eq.true,reponses.neq.jamais)`;
// Migration 110 : aussi les conversations sans repères (les 46 déjà là), ou sorties de « Contact personnel ».
export const FILTRE_RATTRAPAGE_TYPE = `${FILTRE_RATTRAPAGE_ETAPES},and(type_signaux.is.null,reponses.neq.jamais),and(type_signaux->>jamais.eq.true,reponses.neq.jamais)`;
export async function rattraperPret(db: SupabaseClient, organisation: string) {
  const requete = (filtre: string) => db.from("whatsapp_conversations").select("id").eq("organisation_id", organisation).or(filtre).order("dernier_message_le", { ascending: false, nullsFirst: false }).limit(RATTRAPAGE_MAX);
  let { data, error } = await requete(FILTRE_RATTRAPAGE_TYPE);
  // Sans la migration 110, les filtres d'avant ; sans la 105, seulement les conversations sans décision « prêt à réserver ».
  if (error && absente(error)) ({ data, error } = await requete(FILTRE_RATTRAPAGE_ETAPES));
  if (error && absente(error)) ({ data, error } = await requete(FILTRE_RATTRAPAGE));
  if (error) {
    if (!absente(error)) console.error("whatsapp : rattrapage prêt à réserver", error.message);
    return 0;
  }
  for (const c of data || []) await pretApresMessage(db, c.id);
  return (data || []).length;
}
