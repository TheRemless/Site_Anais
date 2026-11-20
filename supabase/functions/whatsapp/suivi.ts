// Boîte WhatsApp, suivi (migration 62), lancé en tâche de fond par index.ts après chaque nouveau message :
//   - message du client : signal de paiement (sans IA), puis résumé de la conversation si besoin ;
//   - réponse de Nani depuis l'app : tâche pour une promesse (« je vous confirme demain »), puis résumé si besoin.
// Claude Haiku, sans réflexion, dans les plafonds de l'assistant (journal, usage « whatsapp »). Ne lève jamais ; chaque échec va dans la console.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { dateBangkok } from "../assistant/calc.js";
import { journalEnCours, plafondsOuverts } from "./reponse.ts";
import { lirePromesse, lireResume, parametresPromesse, parametresResume, peutEtrePromesse, resumeAFaire, signalPaiement, tachePromesse } from "./suivi.js";

const absente = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204");

async function lire(db: SupabaseClient, conversationId: string) {
  const { data: conv } = await db.from("whatsapp_conversations").select("*").eq("id", conversationId).maybeSingle();
  if (!conv || !("resume_le" in conv)) return null; // migration 62 absente : rien à faire
  const { data: msgs } = await db.from("whatsapp_messages").select("id, sens, type, texte, medias, envoye_le, supprime_le").eq("conversation_id", conversationId).order("envoye_le", { ascending: false }).limit(60);
  return { conv, messages: [...(msgs || [])].reverse() };
}

export async function suiviApresMessage(db: SupabaseClient, conversationId: string, messageId: string) {
  try {
    const lu = await lire(db, conversationId);
    if (!lu) return;
    const { conv, messages } = lu;
    const message = messages.find((m) => m.id === messageId);
    if (message && message.sens === "entrant") await paiement(db, conv, message);
    const cle = Deno.env.get("ANTHROPIC_API_KEY");
    if (!cle) return;
    const anthropic = new Anthropic({ apiKey: cle, timeout: 30_000, maxRetries: 0 });
    if (message && message.sens === "sortant" && peutEtrePromesse(message.texte)) await promesse(db, anthropic, conv, message);
    if (resumeAFaire(conv, messages)) await resumer(db, anthropic, conv, messages);
  } catch (err) {
    console.error("whatsapp : suivi", String((err as Error)?.message || err).slice(0, 200));
  }
}

async function paiement(db: SupabaseClient, conv: Record<string, any>, message: Record<string, any>) {
  let solde: number | null = null;
  if (conv.dossier_id) {
    const { data } = await db.from("dossiers_resume").select("total, recu").eq("dossier_id", conv.dossier_id).maybeSingle();
    if (data) solde = Number(data.total || 0) - Number(data.recu || 0);
  }
  const s = signalPaiement(conv, message, { solde });
  if (!s) return;
  const { error } = await db.from("whatsapp_conversations").update({ paiement_signale: s }).eq("id", conv.id);
  if (error && !absente(error)) console.error("whatsapp : signal de paiement", error.message);
}

async function promesse(db: SupabaseClient, anthropic: Anthropic, conv: Record<string, any>, message: Record<string, any>) {
  const ajd = dateBangkok();
  // Une tâche par conversation et par jour ; seulement dans une conversation rangée (la tâche appartient à une entreprise).
  if (!conv.entite_id || conv.promesse_le === ajd) return;
  if (!(await plafondsOuverts(db))) return;
  const appels: { usage: Record<string, unknown>; modele: string }[] = [];
  const j = journalEnCours(db, appels);
  // deno-lint-ignore no-explicit-any
  const r = await anthropic.messages.create(parametresPromesse(message.texte, ajd) as any);
  appels.push({ usage: r.usage as unknown as Record<string, unknown>, modele: r.model });
  await j.noter(conv.entite_id, "promesse");
  const p = lirePromesse(r, ajd);
  if (!p) return;
  const client = conv.client_id ? (await db.from("clients").select("prenom").eq("id", conv.client_id).maybeSingle()).data : null;
  const { error } = await db.from("taches").insert(tachePromesse({ conv, quoi: p.quoi, echeance: p.echeance, prenom: client?.prenom || "" }));
  if (error) return console.error("whatsapp : tâche de promesse", error.message);
  await db.from("whatsapp_conversations").update({ promesse_le: ajd }).eq("id", conv.id);
}

async function resumer(db: SupabaseClient, anthropic: Anthropic, conv: Record<string, any>, messages: Record<string, any>[]) {
  if (!(await plafondsOuverts(db))) return;
  const appels: { usage: Record<string, unknown>; modele: string }[] = [];
  const j = journalEnCours(db, appels);
  // deno-lint-ignore no-explicit-any
  const r = await anthropic.messages.create(parametresResume(messages) as any);
  appels.push({ usage: r.usage as unknown as Record<string, unknown>, modele: r.model });
  await j.noter(conv.entite_id, "resume");
  const resume = lireResume(r);
  if (!resume) return console.error("whatsapp : résumé vide", r.stop_reason);
  const { error } = await db.from("whatsapp_conversations").update({ resume, resume_le: new Date().toISOString() }).eq("id", conv.id);
  if (error && !absente(error)) console.error("whatsapp : résumé non gardé", error.message);
}
