// Boîte WhatsApp, « Prêt à réserver » (migration 85, 22.11.2026), lancé par index.ts :
//   - après chaque nouveau message (client ou Nani), modifié ou supprimé : la décision est refaite sur les 60 derniers messages ;
//   - à la reprise (pg_cron, toutes les 5 minutes) : 20 conversations jamais calculées (ou sorties de « Contact personnel »), les plus
//     récentes d'abord. Les conversations déjà là avant la migration entrent ainsi dans le filtre sans attendre leur prochain message.
// Aucun appel à l'IA : la règle est dans pret.js (expressions sur le texte). Rien ne part chez Anthropic, ni au client, ni au prestataire.
// Seule la colonne pret_reserver est écrite, et seulement quand la décision change. Ne lève jamais ; chaque échec va dans la console.
// Sans la migration 85, la colonne manque : rien n'est écrit, rien ne casse.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { MESSAGES_LUS, etatPret, pretChange } from "./pret.js";

const absente = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204");
export const RATTRAPAGE_MAX = 20;

export async function pretApresMessage(db: SupabaseClient, conversationId: string) {
  try {
    const { data: conv, error } = await db.from("whatsapp_conversations").select("id, reponses, type_contact, partenaire_id, tri, pret_reserver").eq("id", conversationId).maybeSingle();
    if (error) {
      if (!absente(error)) console.error("whatsapp : prêt à réserver, conversation illisible", error.message);
      return;
    }
    if (!conv) return;
    // Les messages « non transmis » (repérés par la #314) n'ont pas de texte du client : ils ne comptent pas.
    const { data: msgs, error: errM } = await db.from("whatsapp_messages").select("id, sens, type, texte, medias, envoye_le, supprime_le").eq("conversation_id", conversationId).neq("type", "non_transmis").order("envoye_le", { ascending: false }).limit(MESSAGES_LUS);
    if (errM) return console.error("whatsapp : prêt à réserver, messages illisibles", errM.message);
    const decision = etatPret(conv, [...(msgs || [])].reverse());
    if (!pretChange(conv.pret_reserver, decision)) return;
    const { error: errU } = await db.from("whatsapp_conversations").update({ pret_reserver: decision }).eq("id", conversationId);
    if (errU && !absente(errU)) console.error("whatsapp : prêt à réserver non gardé", errU.message);
  } catch (err) {
    console.error("whatsapp : prêt à réserver", String((err as Error)?.message || err).slice(0, 200));
  }
}

// Jamais calculées, ou calculées comme Contact personnel puis remises en « auto » (rien n'avait été lu d'elles).
export const FILTRE_RATTRAPAGE = "pret_reserver.is.null,and(pret_reserver->>motif.eq.exclue,reponses.neq.jamais)";
export async function rattraperPret(db: SupabaseClient, organisation: string) {
  const { data, error } = await db.from("whatsapp_conversations").select("id").eq("organisation_id", organisation).or(FILTRE_RATTRAPAGE).order("dernier_message_le", { ascending: false, nullsFirst: false }).limit(RATTRAPAGE_MAX);
  if (error) {
    if (!absente(error)) console.error("whatsapp : rattrapage prêt à réserver", error.message);
    return 0;
  }
  for (const c of data || []) await pretApresMessage(db, c.id);
  return (data || []).length;
}
