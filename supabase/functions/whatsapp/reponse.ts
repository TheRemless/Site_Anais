// Boîte WhatsApp (phase 2) : quand un client écrit, l'agent de Gestion prépare la réponse que Nani copiera. Aucune notification.
// Appelé par index.ts après la réponse à Telnyx (EdgeRuntime.waitUntil). Clé de service : chaque lecture est limitée à l'entreprise de la
// conversation (entite_id), comme le fait la session de la personne dans la fonction « agent ».
//
// Règles de l'agent reprises telles quelles (agent/prompt.js consignes, agent/outils.js executer et controlerReponse) : prix et heures
// seulement des outils, jamais un net, une commission, une marge ni un nom de prestataire (les outils les retirent), aucune signature chez
// Secret et Taxi, anglais sauf client francophone. Une seule carte possible : proposer_reponse. Ce qui part chez Anthropic : le texte des
// derniers messages, le prénom du client, ce que rendent les outils de lecture. Jamais le numéro de téléphone.
// Budget : compté dans le plafond du mois de l'assistant (assistant_journal, usage « whatsapp »), l'agent doit être allumé (agent_ia).
// Espace unifié (migration 63, agent/unifie.js) : avec le secret AGENT_UNIFIE=1 et l'agent allumé chez Secret ET chez Taxi, la préparation cherche dans les deux
// catalogues et lit les corrections des deux, toujours limitée à ces deux entreprises et sans aucun droit sur les partenaires ni les nets
// (ctx.permissions et permissionsPar vides). Les dossiers lus restent ceux reliés à la conversation.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { APPRIS_LUS_ACTIVE, APPRIS_LUS_AUTRE, DUREE_MAX_MS, MODELE_DEFAUT, apprentissagesUnifies, ligneJournal, signe } from "../agent/prompt.js";
import { clesHotelPossibles, memoDepuis, montantsSortants, montantsTapes, netsPourControle, dossierPourControle, prefixeRef } from "../agent/outils.js";
import { CONTACTS_INTERNES } from "../agent/whatsapp-lecture.js";
import { tourner } from "../agent/boucle.js";
import { contactApporteur, fichesDuContact, nomsABloquer, nomsContactsTypes } from "../agent/apporteur.js";
import { modeUnifieSansDroits, unifieAllume } from "../agent/unifie.js";
import { debutMois, estCreditEpuise, plafondRetenu, tableAbsente } from "../assistant/budget.js";
import { dateBangkok, reglagesAssistant } from "../assistant/calc.js";
import { blocTon, pairesCorrections, pairesReponses } from "./ton.js";
import { ATTENTE_MS, DUREE_BOITE_MS, LIMITE_BOITE_JOUR, LIMITE_CONVERSATION_JOUR, PLAFOND_WHATSAPP_MOIS_USD, aRepondre, avertissementsSurs, decisionDepuisReponse, elementServices, entrepriseParDefaut, nomAEcrire, parametresTri, langueSure, iaPermise, outilsWhatsapp, preparationAuto, promptPreparation, triGarde, triSansAppel } from "./proposer.js";

const AUCUN = "00000000-0000-0000-0000-000000000000"; // user_id du journal : aucune personne, la boîte WhatsApp
// Le contact est un partenaire, un chauffeur ou un hôtel (migration 68) : réponse sur demande seulement, sans client ni dossier relié.
const versPartenaire = (conv: { type_contact?: string | null }) => CONTACTS_INTERNES.includes(String(conv.type_contact || ""));

type Conv = { id: string; organisation_id: string; telephone: string; nom: string | null; nom_source?: string | null; entite_id: string | null; entite_source: string; client_id: string | null; dossier_id: string | null; reponses?: string; tri?: Record<string, any>; type_contact?: string | null; partenaire_id?: string | null };

// Point d'entrée : un message entrant vient d'être rangé (nouveau). Attend un peu (le client écrit souvent en plusieurs fois), trie le
// dernier message (proposer.js). Sur demande seulement (Jérémy, 20.11.2026, pour économiser les crédits) : l'agent ne rédige rien tant que
// Nani ne touche pas « Préparer une réponse », sauf si l'entreprise a coché « Préparer les réponses WhatsApp automatiquement »
// (reglages.whatsapp_reponses_auto, décoché par défaut). Le tri, lui, tourne toujours (environ 0,0002 $). Ne lève jamais. La décision du tri est
// gardée sur la conversation (colonne tri, migration 60). Aucune notification Web Push (PR 282). Tout tient dans DUREE_BOITE_MS, sous la limite de 150 s d'une fonction Supabase.
export async function apresMessageClient(db: SupabaseClient, conversationId: string, messageId: string) {
  const t0 = Date.now();
  try {
    await new Promise((ok) => setTimeout(ok, ATTENTE_MS));
    const lu = await lireConversation(db, conversationId);
    if (!lu || !aRepondre(lu.messages, messageId)) return;
    const { conv, messages } = lu;
    // Partenaire, chauffeur, hôtel et apporteur sont triés comme un client (migration 69) : seul le Contact personnel coupe l'IA.
    let decision = triSansAppel({ conv, messages });
    // Assistant éteint ou réception suspendue (audit sécurité n° 1) : pas même le tri chez Anthropic.
    if (!decision && !(await iaOuverte(db, conv))) decision = { preparer: false, motif: "ia_coupee" };
    if (!decision && !(await budgetOuvert(db, conv))) decision = { preparer: false, motif: "limite" };
    const cle = Deno.env.get("ANTHROPIC_API_KEY");
    if (!decision && !cle) {
      console.error("whatsapp : ANTHROPIC_API_KEY absente, aucun tri possible");
      decision = { preparer: false, motif: "tri_illisible" };
    }
    const anthropic = cle ? new Anthropic({ apiKey: cle, timeout: 40_000, maxRetries: 0 }) : null;
    const appels: { usage: Record<string, unknown>; modele: string }[] = [];
    const j = journalEnCours(db, appels);
    if (!decision) {
      try {
        // deno-lint-ignore no-explicit-any
        const m = await anthropic!.messages.create(parametresTri(messages, { aTrier: !conv.entite_id }) as any);
        appels.push({ usage: m.usage as unknown as Record<string, unknown>, modele: m.model });
        decision = decisionDepuisReponse(m);
        if (decision.motif === "tri_illisible") console.error("whatsapp : tri illisible", m.stop_reason, (m.usage as { output_tokens?: number })?.output_tokens);
      } catch (err) {
        console.error("whatsapp : tri en panne", err instanceof Error ? err.message.slice(0, 200) : "");
        decision = { preparer: false, motif: "tri_illisible" };
      }
      await j.noter(conv.entite_id, decision.motif === "tri_illisible" ? "tri_illisible" : "tri");
    }
    await garderTri(db, conv.id, decision);
    // Le nom que le client a écrit (champ nom_client du même tri, aucun autre appel à l'IA) : sur la conversation, jamais un nom saisi à la
    // main ni un contact qui n'est pas un client (proposer.js, nomAEcrire ; la base protège aussi le nom manuel, migration 70).
    const nomPropose = (decision as { nom_client?: string }).nom_client || "";
    const interdits = nomPropose && nomAEcrire(conv, nomPropose) ? await nomsInterdits(db, conv) : null;
    const nomEcrit = interdits ? nomAEcrire(conv, nomPropose, interdits) : null;
    if (nomEcrit) await nommerConversation(db, conv, nomEcrit);
    if (!decision.preparer) return;
    // Revue de sécurité de la PR 299 : un partenaire, un chauffeur ou un hôtel n'a jamais de réponse préparée seule, même avec la case
    // cochée. « Préparer une réponse » reste possible, sur demande.
    if (versPartenaire(conv)) return;
    // Réponses sur demande (défaut) : le tri est gardé pour l'écran, rien n'est rédigé.
    if (!(await preparationAutoPermise(db, conv, decision.entreprise || null))) return;
    // Aucune notification sur le téléphone (Jérémy, 20.11.2026 : Nani serait débordée). Le compteur de non-lus de l'écran suffit.
    await preparer(db, conv, messages, messageId, t0, { anthropic: anthropic!, appels, j, suggestion: decision.entreprise || null }).catch((err) => {
      console.error("whatsapp : réponse non préparée", String(err?.message || err).slice(0, 200));
      return false;
    });
  } catch (err) {
    console.error("whatsapp : après message", String((err as Error)?.message || err).slice(0, 200));
  }
}

// « Préparer une réponse » touché par Nani (fonction whatsapp-preparer) : sans tri, dans les limites du budget. Jamais pour un Contact
// personnel (reponses = 'jamais') : son libellé promet « rien envoyé à l'IA » (revue de sécurité de la PR 299), le bouton est masqué et la
// fonction refuse (contact_personnel, 403). Rend un code pour l'écran ; la préparation continue en tâche de fond.
export async function preparerALaDemande(db: SupabaseClient, conversationId: string) {
  const lu = await lireConversation(db, conversationId);
  if (!lu) return { erreur: "droit_manquant" };
  if (lu.conv.reponses === "jamais") return { erreur: "contact_personnel" };
  const dernier = lu.messages.filter((m) => !m.supprime_le).reduce((a: any, m: any) => (!a || String(m.envoye_le) >= String(a.envoye_le) ? m : a), null);
  if (!dernier || dernier.sens !== "entrant") return { erreur: "rien_a_repondre" };
  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return { erreur: "non_configure" };
  if (!(await budgetOuvert(db, lu.conv))) return { erreur: "limite" };
  const suggestion = lu.conv.tri && (lu.conv.tri.entreprise === "secret" || lu.conv.tri.entreprise === "taxi") ? lu.conv.tri.entreprise : null;
  // Une conversation à trier sans entreprise suggérée : avec l'espace unifié (AGENT_UNIFIE), l'agent cherche dans les deux catalogues et
  // choisit l'entreprise de chaque service, on part donc de Secret sans rien ranger (lot 2 du 20.11.2026 : ne plus bloquer sur « à trier »).
  // Sans l'espace unifié, Nani choisit d'abord (on ne prend pas un catalogue au hasard).
  const { data: ents } = await db.from("entites").select("id, slug").eq("organisation_id", lu.conv.organisation_id).in("slug", ["secret", "taxi"]);
  let defaut: string | null = null;
  if (!lu.conv.entite_id && !suggestion && unifieAllume(Deno.env.get("AGENT_UNIFIE") || "")) {
    const { data: regls } = await db.from("reglages").select("entite_id, valeur").in("entite_id", (ents || []).map((e) => e.id));
    const allumees = (ents || []).filter((e) => (regls || []).some((r) => r.entite_id === e.id && r.valeur && r.valeur.agent_ia === true)).map((e) => e.slug);
    defaut = entrepriseParDefaut({ unifie: true, slugs: (ents || []).map((e) => e.slug), allumees });
  }
  const ent = (ents || []).find((e) => e.id === lu.conv.entite_id) || (ents || []).find((e) => e.slug === (suggestion || defaut));
  if (!ent) return { erreur: "a_trier" };
  const { data: regl } = await db.from("reglages").select("valeur").eq("entite_id", ent.id).maybeSingle();
  if (!regl || !regl.valeur || regl.valeur.agent_ia !== true) return { erreur: "agent_eteint" };
  const t0 = Date.now() + ATTENTE_MS; // pas d'attente ici : tout le temps de la boîte va à la préparation
  const anthropic = new Anthropic({ apiKey: cle, timeout: 40_000, maxRetries: 0 });
  const appels: { usage: Record<string, unknown>; modele: string }[] = [];
  const j = journalEnCours(db, appels);
  const tache = preparer(db, lu.conv, lu.messages, dernier.id, t0, { anthropic, appels, j, suggestion, defaut }).catch((err) => {
    console.error("whatsapp : préparation à la demande", String(err?.message || err).slice(0, 200));
    return false;
  });
  return { tache };
}

// Réception et assistant relus à chaque fois (pas de cache) : une lecture impossible ferme. Sert aussi au suivi (suivi.ts).
export async function iaOuverte(db: SupabaseClient, conv: Conv) {
  const [recep, ents] = await Promise.all([
    db.from("whatsapp_reglages").select("reception_active").eq("organisation_id", conv.organisation_id).maybeSingle(),
    db.from("entites").select("id").eq("organisation_id", conv.organisation_id).in("slug", ["secret", "taxi"]),
  ]);
  if (recep.error || ents.error || !recep.data) return false;
  const ids = (ents.data || []).map((e) => e.id);
  const regl = ids.length ? await db.from("reglages").select("entite_id, valeur").in("entite_id", ids) : { data: [], error: null };
  if (regl.error) return false;
  const agents: Record<string, boolean> = {};
  for (const l of regl.data || []) agents[l.entite_id] = !!(l.valeur && l.valeur.agent_ia === true);
  return iaPermise({ receptionActive: recep.data.reception_active === true, conv, agents });
}

// L'entreprise de la conversation (ou celle suggérée par le tri pour une conversation à trier) a coché la préparation automatique.
// Réglages illisibles : sur demande (jamais l'inverse).
async function preparationAutoPermise(db: SupabaseClient, conv: Conv, suggestion: string | null) {
  const { data: ents, error } = await db.from("entites").select("id, slug").eq("organisation_id", conv.organisation_id).in("slug", ["secret", "taxi"]);
  if (error) return false;
  const ent = (ents || []).find((e) => e.id === conv.entite_id) || (!conv.entite_id && suggestion ? (ents || []).find((e) => e.slug === suggestion) : null);
  const lu = ent ? await db.from("reglages").select("valeur").eq("entite_id", ent.id).maybeSingle() : null;
  return !!lu && !lu.error && preparationAuto(lu.data ? lu.data.valeur : null);
}

async function garderTri(db: SupabaseClient, conversationId: string, decision: { preparer: boolean; motif: string; entreprise?: string | null }) {
  // Seule la colonne tri : le déclencheur de la migration 60 garde de toute façon le classement de Nani.
  const { error } = await db.from("whatsapp_conversations").update({ tri: triGarde(decision) }).eq("id", conversationId);
  if (error && error.code !== "42703") console.error("whatsapp : tri non gardé", error.message);
}

// Les noms qu'un client ne peut pas se donner (revue de sécurité de la PR 306) : fiches partenaires et contacts typés de l'organisation,
// prénoms de l'équipe. Une lecture en échec rend null : aucun nom n'est écrit.
async function nomsInterdits(db: SupabaseClient, conv: Conv) {
  const ents = conv.entite_id ? { data: [{ id: conv.entite_id }], error: null } : await db.from("entites").select("id").eq("organisation_id", conv.organisation_id).in("slug", ["secret", "taxi"]);
  if (ents.error) return null;
  const ids = (ents.data || []).map((e: { id: string }) => e.id);
  if (!ids.length) return null;
  const [pa, regl, types] = await Promise.all([db.from("partenaires").select("id, nom").in("entite_id", ids).limit(2000), db.from("reglages").select("valeur").in("entite_id", ids), nomsContactsTypes(db, conv.organisation_id)]);
  if (pa.error || regl.error || types.erreur) return null;
  // deno-lint-ignore no-explicit-any
  const prenoms = ["Nani", "Anaïs", ...(regl.data || []).map((r: any) => reglagesAssistant(r.valeur || {}).responsable || "")].filter(Boolean);
  return { interdits: [...nomsABloquer((pa.data || []) as { id: string; nom: string }[]), ...types.noms], prenoms };
}

// Écrit le nom avec la clé de service : la base pose nom_source = 'whatsapp' et garde un nom manuel (whatsapp_proteger_classement). Le nom lu
// doit être encore le même (un nom saisi par Nani entre-temps n'est pas remplacé) ; la conversation doit être encore celle d'un client.
async function nommerConversation(db: SupabaseClient, conv: Conv, nom: string) {
  const base = db.from("whatsapp_conversations").update({ nom }).eq("id", conv.id).or("nom_source.is.null,nom_source.eq.whatsapp").or("type_contact.is.null,type_contact.eq.client").is("partenaire_id", null).neq("reponses", "jamais");
  const { error } = await (conv.nom ? base.eq("nom", conv.nom) : base.is("nom", null));
  if (error && error.code !== "42703") console.error("whatsapp : nom du client non écrit", error.message);
}

async function lireConversation(db: SupabaseClient, conversationId: string) {
  const { data: conv } = await db.from("whatsapp_conversations").select("*").eq("id", conversationId).maybeSingle();
  if (!conv) return null;
  const { data: msgs } = await db.from("whatsapp_messages").select("id, sens, origine, type, texte, medias, envoye_le, modifie_le, supprime_le").eq("conversation_id", conversationId).order("envoye_le", { ascending: false }).limit(40);
  return { conv: conv as Conv, messages: [...(msgs || [])].reverse() as Record<string, any>[] };
}

// Les limites avant tout appel à Claude. Une lecture impossible ferme le budget (jamais l'inverse).
// Plafond du mois de l'assistant et sous-plafond de la boîte. Une lecture impossible ferme (jamais l'inverse). Sert aussi au suivi (suivi.ts).
export async function plafondsOuverts(db: SupabaseClient) {
  const [mois, budget, wa] = await Promise.all([
    db.rpc("assistant_cout_depuis", { debut: debutMois() }),
    db.from("assistant_budget").select("plafond_mois_usd, seuil_alerte_pct").maybeSingle(),
    db.from("assistant_journal").select("cout_estime_usd").eq("usage", "whatsapp").gte("cree_le", debutMois()).limit(20000),
  ]);
  if (mois.error || wa.error || mois.data === null || mois.data === undefined) return false;
  const { plafond } = plafondRetenu(budget.error ? null : budget.data, Deno.env.get("AGENT_PLAFOND_MOIS_USD"));
  if (Number(mois.data) >= plafond) return false;
  const coutBoite = (wa.data || []).reduce((s, l) => s + (Number(l.cout_estime_usd) || 0), 0);
  return coutBoite < (Number(Deno.env.get("WHATSAPP_PLAFOND_MOIS_USD")) || PLAFOND_WHATSAPP_MOIS_USD);
}

// Les limites avant tout appel à Claude pour une réponse : plafonds, puis réponses du jour par conversation et pour la boîte.
async function budgetOuvert(db: SupabaseClient, conv: Conv) {
  const jour = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [ouverts, parConv, boite] = await Promise.all([
    plafondsOuverts(db),
    db.from("whatsapp_propositions").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).gte("cree_le", jour),
    db.from("whatsapp_propositions").select("id", { count: "exact", head: true }).gte("cree_le", jour),
  ]);
  if (!ouverts || parConv.error || boite.error) return false;
  return (parConv.count || 0) < LIMITE_CONVERSATION_JOUR && (boite.count || 0) < LIMITE_BOITE_JOUR;
}

// Rend true si une réponse est prête à copier (et toujours utile : le client n'a pas réécrit, Nani n'a pas répondu).
// suggestion : l'entreprise proposée par le tri pour une conversation à trier (la conversation, elle, reste à trier).
async function preparer(
  db: SupabaseClient,
  conv: Conv,
  messages: Record<string, any>[],
  messageId: string,
  t0: number,
  { anthropic, appels, j, suggestion, defaut = null }: { anthropic: Anthropic; appels: { usage: Record<string, unknown>; modele: string }[]; j: ReturnType<typeof journalEnCours>; suggestion: string | null; defaut?: string | null },
) {
  const { data: entites } = await db.from("entites").select("id, slug, nom").eq("organisation_id", conv.organisation_id).in("slug", ["secret", "taxi"]);
  const parSlug = new Map((entites || []).map((e) => [e.slug, e]));
  const ent = (entites || []).find((e) => e.id === conv.entite_id) || (suggestion ? parSlug.get(suggestion) : null) || (defaut ? parSlug.get(defaut) : null) || null;
  const proposee = conv.entite_id ? null : suggestion;
  // À trier sans entreprise suggérée : pas de réponse (on ne prend pas le catalogue d'une entreprise au hasard), mais une trace visible.
  if (!ent) return echecVisible(db, conv.id, messageId, null, "a_trier");
  const { data: regl } = await db.from("reglages").select("valeur").eq("entite_id", ent.id).maybeSingle();
  const reglages = regl ? regl.valeur : null;
  // L'agent s'allume dans les réglages de l'entreprise : éteint, pas de proposition.
  if (!reglages || reglages.agent_ia !== true) {
    await j.noter(ent.id, "agent_eteint");
    return echecVisible(db, conv.id, messageId, ent.id, "agent_eteint");
  }

  // Espace unifié : le secret AGENT_UNIFIE=1 ; l'autre entreprise (Secret ou Taxi) seulement si son agent est allumé aussi.
  const interrupteur = Deno.env.get("AGENT_UNIFIE") || "";
  const autre = unifieAllume(interrupteur) ? (entites || []).find((e) => e.id !== ent.id) || null : null;
  const lu = autre ? await db.from("reglages").select("valeur").eq("entite_id", autre.id).maybeSingle() : null;
  const reglagesAutre = lu && !lu.error && lu.data ? lu.data.valeur : null;
  const unifie = autre ? modeUnifieSansDroits({ active: ent, autre, reglagesAutre, interrupteur }) : null;
  const ids = unifie ? unifie.entites.map((e) => e.id) : [ent.id];

  // La proposition encore à faire est remplacée ; la nouvelle naît « en_cours » (l'écran affiche « en préparation »).
  await db.from("whatsapp_propositions").update({ statut: "remplacee" }).eq("conversation_id", conv.id).in("statut", ["a_faire", "en_cours"]);
  const { data: prop, error: errProp } = await db.from("whatsapp_propositions").insert({ conversation_id: conv.id, message_id: messageId, entite_id: ent.id, statut: "en_cours", entreprise_proposee: proposee }).select("id").single();
  if (errProp || !prop) throw new Error(`proposition : ${errProp?.message}`);
  let statut = "ok";
  let carte: { titre?: string; donnees?: { message?: string; langue?: string }; avertissements?: string[] } | null = null;
  // Les références des services rendus par les outils pendant la préparation : gardées sur la proposition pour l'envoi (elementServices).
  let refsVues: string[] = [];
  try {
    // Un partenaire, un chauffeur ou un hôtel (revue de sécurité de la PR 299) : ni client ni dossier relié, donc aucun prix de vente, total
    // ni solde d'un client ne peut être lu pour lui répondre.
    const partenaire = versPartenaire(conv);
    const ctx = contexteOutils(db, ent.id, reglages, conv.entite_id === ent.id && !partenaire ? { clientId: conv.client_id, dossierId: conv.dossier_id } : { clientId: null, dossierId: null }, unifie);
    const client = conv.client_id && conv.entite_id === ent.id && !partenaire ? (await db.from("clients").select("prenom").eq("id", conv.client_id).eq("entite_id", ent.id).maybeSingle()).data : null;
    const dossier = conv.dossier_id && conv.entite_id === ent.id && !partenaire ? (await db.from("dossiers").select("id, ref").eq("id", conv.dossier_id).eq("entite_id", ent.id).maybeSingle()).data : null;
    // Les noms de partenaires bloqués dans la réponse. Le contact est un apporteur (migration 68) : la réponse lui est adressée, ses propres
    // fiches sortent de la liste (agent/apporteur.js) ; tout autre partenaire reste bloqué. Sans les colonnes, conv n'a pas de type : rien ne change.
    const exemptes = contactApporteur(conv) && conv.partenaire_id ? fichesDuContact(conv, ((await db.from("partenaires").select("id, nom, categorie, contact").in("entite_id", ids).eq("categorie", "apporteur").limit(200)).data || []) as Record<string, any>[]) : new Set<string>();
    // Revue de sécurité de la PR 299 : aussi les noms des conversations typées de l'organisation (partenaire, chauffeur, hôtel, apporteur),
    // comme whatsapp-envoi ; l'apporteur à qui l'on répond garde son nom (PR 298).
    const types = await nomsContactsTypes(db, conv.organisation_id, { sauf: contactApporteur(conv) ? conv.id : null });
    if (types.erreur) console.error("whatsapp : noms des contacts typés illisibles");
    const prestataires = [...new Set([...nomsABloquer((await ctx.charger("partenaires")) as { id: string; nom: string }[], exemptes), ...types.noms])];
    // Espace unifié : 60 corrections de l'entreprise active ; de l'autre, seulement les réponses au client (20), marquées de leur entreprise.
    const [lus, lusAutre] = await Promise.all([
      db.from("agent_apprentissages").select("id, genre, contexte, avant, apres, cree_le").eq("entite_id", ent.id).order("cree_le", { ascending: false }).limit(unifie ? APPRIS_LUS_ACTIVE : 80),
      unifie && autre ? db.from("agent_apprentissages").select("id, genre, contexte, avant, apres, cree_le").eq("entite_id", autre.id).eq("genre", "reponse").order("cree_le", { ascending: false }).limit(APPRIS_LUS_AUTRE) : Promise.resolve(null),
    ]);
    const lignesAppris = unifie && autre ? apprentissagesUnifies({ actives: lus.data || [], autres: lusAutre && !lusAutre.error ? lusAutre.data || [] : [], nomActive: ent.nom, nomAutre: autre.nom }) : lus.data || [];
    if (lus.error && !tableAbsente(lus.error)) console.error("whatsapp : apprentissages", lus.error.message);
    // Mêmes consignes, voix, règles de réponse et corrections apprises que l'onglet Assistant (proposer.js, promptPreparation).
    // Chez Secret et Taxi, les exemples perdent leur signature (« VIP Taxi Lanta 🌴 » d'un message type) : l'agent ne la recopie pas.
    const signatures = signe(reglages) ? null : [ent.nom, ...(unifie && autre ? [autre.nom] : [])];
    const ton = await tonDeNani(db, ent.id, conv.id, messages, signatures).catch((err) => {
      console.error("whatsapp : ton de Nani", String(err?.message || err).slice(0, 120));
      return "";
    });
    const unifieConsignes = unifie && autre ? { entreprises: [{ nom: ent.nom, slug: ent.slug, reglages }, { nom: autre.nom, slug: autre.slug, reglages: reglagesAutre }] } : null;
    const { systeme, appris, contexte, texte, ra } = promptPreparation({ entreprise: ent.nom, reglages, apprentissages: lus.error ? [] : lignesAppris, messages, nomProfil: conv.nom || "", nomSource: conv.nom_source || null, client, dossier, aujourdhui: dateBangkok(), ton, unifie: unifieConsignes, contact: partenaire ? conv.type_contact || null : null });
    const historique: Record<string, unknown>[] = [{ role: "user", content: [{ type: "text", text: texte }] }];
    // Le contrôle de la réponse ne compte comme « source » que les prix et heures rendus par les outils : pas les montants écrits par le client.
    const memo = memoDepuis([], { signer: signe(reglages), prestataires, entreprise: ent.nom, entreprises: unifie && autre ? [autre.nom] : [], prenoms: [ra.responsable, "Anaïs", "Nani"].filter(Boolean) });
    // Garde-fou de la PR 278 : un montant égal à un net d'un service de la demande en cours (rendu par un outil, ou du dossier relié à la
    // conversation) et à aucun prix de vente est signalé « montant_interne » et bloque la copie dans l'écran. Le net d'un autre service du
    // catalogue n'est qu'un avertissement (montant_egal_net, faux blocage du 21.11.2026). Les nets restent ici, dans la fonction : ils ne
    // partent jamais chez Claude.
    const lusNets = await netsPourControle(db, ids);
    memo.nets = lusNets.nets;
    memo.controleImpossible = lusNets.erreur;
    // Le dossier relié : ses services (leurs nets bloquent), ses nets, marges et commissions (bloquent aussi).
    const relie = await dossierPourControle(db, dossier ? dossier.id : null, [ent.id]);
    memo.servicesEnCours = relie.services;
    for (const n of relie.internes) memo.internes.add(n);
    // La conversation d'un partenaire, d'un chauffeur ou d'un hôtel : ses montants sont des nets possibles (revue de sécurité de la PR 299).
    if (partenaire) for (const n of montantsTapes(messages.map((m) => String(m.texte || "")))) memo.internes.add(n);
    // Une conversation de client : les montants écrits par Nani (messages sortants, app ou Gestion) sont des prix de vente donnés au client
    // (21.11.2026). Jamais ceux du client, jamais chez un partenaire, un chauffeur, un hôtel ou un apporteur (conversationDeClient).
    for (const n of montantsSortants(messages, conv)) memo.nani.add(n);
    const r = await tourner({
      anthropic,
      modele: Deno.env.get("AGENT_MODELE") || MODELE_DEFAUT,
      systeme,
      appris,
      contexte,
      messages: historique,
      ctx,
      memo,
      outils: outilsWhatsapp({ unifie: !!unifie }),
      garder: async (role: string, contenu: unknown) => {
        historique.push({ role, content: contenu });
        // Le coût est noté à chaque tour : une fonction coupée par la limite de temps garde ce qu'elle a dépensé dans le plafond.
        if (role === "assistant") await j.noter(ent!.id, "en_cours");
      },
      garderCarte: async (c: typeof carte & { genre: string }) => {
        // Une seule réponse : la première carte « reponse » est gardée, les suivantes refusées.
        if (c.genre !== "reponse" || carte) return null;
        carte = c;
        return { id: prop.id, genre: c.genre, titre: c.titre, donnees: c.donnees, avertissements: c.avertissements || [] };
      },
      envoyer: async () => {},
      appels,
      // tourner() s'arrête DUREE_MAX_MS après `debut` : ce départ fictif l'arrête DUREE_BOITE_MS après l'arrivée du message.
      debut: t0 - (DUREE_MAX_MS - DUREE_BOITE_MS),
    });
    statut = r.statut;
    refsVues = [...(memo.refs || [])];
  } catch (err) {
    statut = estCreditEpuise(err) ? "credit_epuise" : err instanceof Anthropic.APIError ? `erreur_api${err.status ? `_${err.status}` : ""}` : "erreur";
    console.error("whatsapp : agent", statut, err instanceof Error ? err.message.slice(0, 200) : "");
  }
  const c = carte as typeof carte;
  const message = c?.donnees?.message ? String(c.donnees.message).slice(0, 4000) : "";
  // Toujours utile ? Le client a pu réécrire (son traitement prépare la suivante) ou Nani répondre depuis l'app pendant la préparation.
  const apres = await lireConversation(db, conv.id);
  const utile = !!apres && aRepondre(apres.messages, messageId);
  const champs = !utile ? { statut: "remplacee" } : message ? { statut: "a_faire", texte: message, langue: langueSure(c?.donnees?.langue), avertissements: [...avertissementsSurs(c?.avertissements), ...[elementServices(refsVues)].filter(Boolean)] } : { statut: "echec", erreur: (statut === "ok" ? "pas_de_reponse" : statut).slice(0, 200) };
  // Seulement une proposition encore « en_cours » : traitée entre-temps (écho de l'app), elle le reste.
  const { data: maj } = await db.from("whatsapp_propositions").update(champs).eq("id", prop.id).eq("statut", "en_cours").select("id");
  await j.noter(ent.id, message ? statut : statut === "ok" ? "pas_de_reponse" : statut);
  return utile && !!message && !!(maj && maj.length);
}

// Le ton de Nani (ton.js) : ses réponses envoyées depuis l'app dans les autres conversations de cette entreprise (les 400 derniers messages de
// ses 60 conversations les plus récentes), et ses réécritures des réponses préparées. Lu avec la clé de service, limité à l'entreprise.
async function tonDeNani(db: SupabaseClient, entiteId: string, conversationId: string, messages: Record<string, any>[], signatures: string[] | null = null) {
  // Revue de sécurité de la PR 299 : un Contact personnel ne sert jamais d'exemple de ton (rien de lui ne part chez Anthropic).
  const { data: convs } = await db.from("whatsapp_conversations").select("id").eq("entite_id", entiteId).neq("reponses", "jamais").order("dernier_message_le", { ascending: false }).limit(60);
  const ids = (convs || []).map((c) => c.id);
  if (!ids.length) return "";
  const [msgs, props] = await Promise.all([
    db.from("whatsapp_messages").select("conversation_id, sens, origine, texte, envoye_le, supprime_le").in("conversation_id", ids).order("envoye_le", { ascending: false }).limit(400),
    db.from("whatsapp_propositions").select("conversation_id, cree_le, texte, statut").in("conversation_id", ids).not("texte", "is", null).order("cree_le", { ascending: false }).limit(60),
  ]);
  const tous = msgs.data || [];
  const texteClient = messages.filter((m) => m.sens === "entrant").slice(-3).map((m) => m.texte || "").join(" ");
  return blocTon({ paires: pairesReponses(tous, { exclure: conversationId }), corrections: pairesCorrections(props.data || [], tous), texteClient, signatures });
}

// Une préparation qui s'arrête avant l'agent laisse toujours une trace : une proposition « echec » avec son motif (l'écran l'explique) et une
// ligne dans les journaux de la fonction. Rend false (rien à copier).
async function echecVisible(db: SupabaseClient, conversationId: string, messageId: string, entiteId: string | null, motif: string) {
  console.warn("whatsapp : pas de réponse préparée,", motif);
  await db.from("whatsapp_propositions").update({ statut: "remplacee" }).eq("conversation_id", conversationId).in("statut", ["a_faire", "en_cours"]);
  const { error } = await db.from("whatsapp_propositions").insert({ conversation_id: conversationId, message_id: messageId, entite_id: entiteId, statut: "echec", erreur: motif });
  if (error) console.error("whatsapp : trace d'échec non écrite", error.message);
  return false;
}

// Le journal de l'assistant pour une préparation : une ligne créée au premier appel, mise à jour à chaque tour (coût à jour même si la
// fonction est arrêtée en route).
export function journalEnCours(db: SupabaseClient, appels: { usage: Record<string, unknown>; modele: string }[]) {
  const t0 = Date.now();
  let id: number | null = null;
  return {
    async noter(entiteId: string | null, statut: string) {
      if (!appels.length) return;
      const ligne = { ...ligneJournal({ userId: AUCUN, entiteId, statut, appels, dureeMs: Date.now() - t0 }), usage: "whatsapp" };
      if (id === null) {
        const { data, error } = await db.from("assistant_journal").insert(ligne).select("id").single();
        if (error) console.error("whatsapp : journal", error.message);
        else id = data.id;
      } else {
        const { error } = await db.from("assistant_journal").update(ligne).eq("id", id);
        if (error) console.error("whatsapp : journal", error.message);
      }
    },
  };
}

// Les lectures des outils de l'agent, avec la clé de service mais toujours limitées à une entreprise (aux deux, Secret et Taxi, en espace
// unifié : seulement le catalogue, les horaires, les durées et les hôtels ; les dossiers restent ceux de l'entreprise de la conversation). Un message de client ne doit jamais
// faire lire les données d'un autre client : aucun dossier sauf celui relié à la conversation (ou un dossier de son client relié), aucune
// recherche de clients, et jamais un numéro de téléphone (le client se lit sans téléphone ni nom de famille).
// deno-lint-ignore no-explicit-any
function contexteOutils(db: SupabaseClient, entiteId: string, reglages: any, { clientId, dossierId }: { clientId: string | null; dossierId: string | null }, unifie: { entites: { id: string; slug: string; nom: string }[]; permissionsPar: Record<string, string[]> } | null = null) {
  const ids = unifie ? unifie.entites.map((e) => e.id) : [entiteId];
  // Seules tables chargées entières : le catalogue, les horaires, les durées et les hôtels. Pas de dossiers, réservations ni clients.
  const COLONNES: Record<string, string> = {
    // entite_id : l'entreprise de chaque ligne (espace unifié), jamais renvoyé tel quel par les outils.
    prestations: "id, famille, groupe, libelle, libelle_en, prix_vente, unite, sur_place, actif, partenaire_id, entite_id",
    trajets: "id, de, vers, mode, depart, arrivee, duree, prix_adulte, prix_enfant, bebe, periode, fenetres, actif, partenaire_id, entite_id",
    partenaires: "id, nom, actif, regles, entite_id",
    // Aucune table de nets : charger les rend vides (aucun drapeau « recommande » tiré d'un net sans droit). Le contrôle de la réponse les
    // lit à part (netsPourControle, agent/outils.js). ctx.permissions est vide : ni partenaire ni net ni commission ne partent chez Claude.
    hotels_lieux: "cle, nom, lieu, zone, localite, source_url, certitude, verifie",
    temps_trajets: "de, vers, mode, duree_min, ferry, marge_min, source, source_date, a_verifier",
    liaisons_ferry: "nom, cote_ile, port_ile, port_continent, port_ile_coord, port_continent_coord, duree_min, a_verifier",
  };
  const COL_DOSSIER = "id, ref, client_id, date_depart, date_retour, annule";
  const COL_RESA = "id, dossier_id, prestation_id, trajet_id, libelle, date_service, heure_pickup, lieu_pickup, personnes, statut, montant_vente, partenaire_id, paye_sur_place";
  // deno-lint-ignore no-explicit-any
  const lire = async (requete: any, table: string) => {
    const { data, error } = await requete;
    if (error) {
      if (error.code === "42P01") return [];
      throw new Error(`${table} : ${error.message}`);
    }
    return (data || []) as Record<string, any>[];
  };
  const cache = new Map<string, Promise<unknown[]>>();
  const charger = (nom: string): Promise<unknown[]> => {
    if (!COLONNES[nom]) return Promise.resolve([]);
    if (!cache.has(nom))
      cache.set(
        nom,
        (async () => {
          const lignes: unknown[] = [];
          for (let de = 0; de < 20000; de += 1000) {
            const page = await lire(db.from(nom).select(COLONNES[nom]).in("entite_id", ids).range(de, de + 999), nom);
            lignes.push(...page);
            if (page.length < 1000) break;
          }
          return lignes;
        })(),
      );
    return cache.get(nom)!;
  };
  // Les dossiers permis : celui relié, sinon ceux du client relié. Lus une fois.
  let permis: Promise<Record<string, any>[]> | null = null;
  const dossiersPermis = () =>
    (permis ??= (async () => {
      if (dossierId) return lire(db.from("dossiers").select(COL_DOSSIER).eq("entite_id", entiteId).eq("id", dossierId), "dossiers");
      if (clientId) return lire(db.from("dossiers").select(COL_DOSSIER).eq("entite_id", entiteId).eq("client_id", clientId).limit(20), "dossiers");
      return [];
    })());
  const parRef = async (table: string, ref: string) => {
    const p = prefixeRef(ref);
    const dossiers = await dossiersPermis();
    if (!p || !dossiers.length) return [];
    if (table === "dossiers") return dossiers.filter((d) => String(d.id).startsWith(p));
    if (table === "reservations") {
      const resas = await lire(db.from("reservations").select(COL_RESA).eq("entite_id", entiteId).in("dossier_id", dossiers.map((d) => d.id)).limit(200), "reservations");
      return resas.filter((r) => String(r.id).startsWith(p));
    }
    return [];
  };
  const dossierPour = async (ref: string) => {
    const dossiers = await dossiersPermis();
    const t = String(ref || "").trim().toLowerCase();
    const p = prefixeRef(ref);
    const d = dossiers.find((x) => (p && String(x.id).startsWith(p)) || String(x.ref || "").toLowerCase() === t);
    if (!d) return [[], [], []];
    const [clients, reservations] = await Promise.all([
      // Ni téléphone ni nom de famille : rien de cela ne part chez Claude.
      d.client_id ? lire(db.from("clients").select("id, prenom, entite_id").eq("id", d.client_id).eq("entite_id", entiteId), "clients") : [],
      lire(db.from("reservations").select(COL_RESA).eq("entite_id", entiteId).eq("dossier_id", d.id).limit(200), "reservations"),
    ]);
    return [[d], clients, reservations];
  };
  const hotelsPour = async (lieux: string[]) => {
    const cles = [...new Set(lieux.flatMap((l) => clesHotelPossibles(l)))].slice(0, 100);
    if (!cles.length) return [];
    return lire(db.from("hotels_lieux").select(COLONNES.hotels_lieux).in("entite_id", ids).in("cle", cles), "hotels_lieux");
  };
  // Pas de moteur d'itinéraire ni de recherche web ici : les durées viennent de la table de l'entreprise, sinon l'agent le dit.
  // chercherClients rend toujours vide (l'outil n'est pas proposé, et refusé par tourner s'il est appelé quand même).
  return { historique: [], entreprise: "", fichiers: [], permissions: [], ...(unifie ? { entites: unifie.entites, permissionsPar: unifie.permissionsPar } : {}), charger, chercherClients: async () => [[], []], dossierPour, parRef, hotelsPour, reglages, ors: null, simule: null, estimerWeb: null, situerWeb: null, notes: [] as string[], moteur: null, maintenant: () => Date.now() };
}
