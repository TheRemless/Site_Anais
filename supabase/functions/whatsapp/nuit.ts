// Message automatique de nuit (migration 132, demande de Jérémy du 27.11.2026) : Nani met son téléphone en mode avion, le message d'absence de
// l'app WhatsApp Business ne part pas ; la fonction « whatsapp » l'envoie à sa place par Telnyx.
//   1. Un message du client vient d'être rangé : whatsapp_reserver_nuit décide tout en base, en une transaction (heure de Bangkok, contact,
//      réglage, équipe déjà là, une seule fois par conversation et par nuit) et range le message « envoi » AVANT l'appel ; rien à envoyer, rien.
//   2. L'appel à Telnyx (texte libre : le message du client vient d'ouvrir la fenêtre de 24 h), puis whatsapp_nuit_resultat en une transaction.
//   3. La reprise (pg_cron « whatsapp-reprise », toutes les 5 minutes) réserve les messages restés sans réservation (panne passagère ici ou
//      en base) et retente les refus sûrs (whatsapp_reprendre_nuit, 3 essais par ligne, même nuit, 3 envois au plus par passage).
//      Un résultat incertain (délai, 5xx) n'est jamais renvoyé : le message passe « à vérifier » après 5 minutes, comme un envoi de Gestion.
// Migration 132 absente : les fonctions SQL manquent, rien ne part et rien n'échoue.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corpsTelnyx } from "../whatsapp-envoi/calc.js";
import { resultatTelnyx } from "./nuit.js";

type APartir = { id: string; message_id: string; telephone: string; numero: string; texte: string };

const absente = (e: { code?: string } | null) => !!e && ["42883", "PGRST202", "42P01", "42703"].includes(String(e.code || ""));

export async function messageDeNuit(db: SupabaseClient, messageId: string) {
  const cle = Deno.env.get("TELNYX_API_KEY");
  if (!cle) return void console.error("message de nuit : TELNYX_API_KEY absente, rien ne part");
  const { data, error } = await db.rpc("whatsapp_reserver_nuit", { p_message: messageId });
  // Une erreur passagère ici n'est pas perdue : la reprise réserve dans les 5 minutes un message du client resté sans réservation.
  if (error) {
    if (absente(error)) return;
    throw new Error(`message de nuit, réservation (reprise dans les 5 minutes) : ${error.message}`);
  }
  for (const p of (data || []) as APartir[]) await envoyer(db, p, cle);
}

export async function reprendreNuit(db: SupabaseClient, organisation: string) {
  const cle = Deno.env.get("TELNYX_API_KEY");
  if (!cle) {
    console.error("message de nuit : TELNYX_API_KEY absente, reprise sans effet");
    return 0;
  }
  const { data, error } = await db.rpc("whatsapp_reprendre_nuit", { p_org: organisation });
  if (error) {
    if (absente(error)) return 0;
    throw new Error(`message de nuit, reprise : ${error.message}`);
  }
  const lignes = (data || []) as APartir[];
  for (const p of lignes) await envoyer(db, p, cle);
  return lignes.length;
}

async function envoyer(db: SupabaseClient, p: APartir, cle: string) {
  let lu;
  try {
    const rep = await fetch("https://api.telnyx.com/v2/messages/whatsapp", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpsTelnyx({ de: p.numero, vers: p.telephone, texte: p.texte, webhook: `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp` })),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    lu = resultatTelnyx(rep.status, await rep.json().catch(() => null));
  } catch {
    lu = resultatTelnyx(0, null, { exception: true });
  }
  const { error } = await db.rpc("whatsapp_nuit_resultat", { p_id: p.id, p_resultat: lu.resultat, p_telnyx_id: lu.id || null, p_erreur: lu.erreur || null });
  // Sans résultat noté, la ligne reste « reserve » : la reprise la passe « incertain » après 2 minutes, jamais renvoyée.
  if (error) console.error("message de nuit : résultat non noté", lu.resultat, error.message);
  if (lu.resultat !== "envoye") console.warn("message de nuit :", lu.resultat, lu.erreur || "");
}
