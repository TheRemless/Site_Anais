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
import { MESSAGES_LUS, etatPret, pretChange } from "./pret.js";
import { faitsAvancee } from "./etapes.js";
import { signauxPartenaire, typeADeduire } from "./type-contact.js";

const absente = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204");
export const RATTRAPAGE_MAX = 20;
const COLONNES = "id, reponses, type_contact, partenaire_id, client_id, dossier_id, tri, pret_reserver";
const COLONNES_TYPE = "type_source, type_avis, type_signaux";

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
    const { data: msgs, error: errM } = await db.from("whatsapp_messages").select("id, sens, origine, type, texte, medias, envoye_le, supprime_le, statut_envoi").eq("conversation_id", conversationId).neq("type", "non_transmis").order("envoye_le", { ascending: false }).limit(MESSAGES_LUS);
    if (errM) return console.error("whatsapp : prêt à réserver, messages illisibles", errM.message);
    const messages = [...(msgs || [])].reverse();
    const patch: Record<string, unknown> = {};
    const decision = etatPret(conv, messages);
    if (pretChange(conv.pret_reserver, decision)) patch.pret_reserver = decision;
    if (avecAvancee) {
      const faits = faitsAvancee(conv, messages);
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
