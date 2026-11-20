// Boîte WhatsApp (phase 2) : quand un client écrit, l'agent de Gestion prépare la réponse que Nani copiera. Aucune notification.
// Appelé par index.ts après la réponse à Telnyx (EdgeRuntime.waitUntil). Clé de service : chaque lecture est limitée à l'entreprise de la
// conversation (entite_id), comme le fait la session de la personne dans la fonction « agent ».
//
// Règles de l'agent reprises telles quelles (agent/prompt.js consignes, agent/outils.js executer et controlerReponse) : prix et heures
// seulement des outils, jamais un net, une commission, une marge ni un nom de prestataire (les outils les retirent), aucune signature chez
// Secret et Taxi, anglais sauf client francophone. Une seule carte possible : proposer_reponse. Ce qui part chez Anthropic : le texte des
// derniers messages, le prénom du client, ce que rendent les outils de lecture. Jamais le numéro de téléphone.
// Budget : compté dans le plafond du mois de l'assistant (assistant_journal, usage « whatsapp »), l'agent doit être allumé (agent_ia).
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { DUREE_MAX_MS, MODELE_DEFAUT, ligneJournal, signe } from "../agent/prompt.js";
import { clesHotelPossibles, memoDepuis, prefixeRef } from "../agent/outils.js";
import { tourner } from "../agent/boucle.js";
import { debutMois, estCreditEpuise, plafondRetenu, tableAbsente } from "../assistant/budget.js";
import { dateBangkok } from "../assistant/calc.js";
import { ATTENTE_MS, DUREE_BOITE_MS, LIMITE_BOITE_JOUR, LIMITE_CONVERSATION_JOUR, PLAFOND_WHATSAPP_MOIS_USD, aRepondre, avertissementsSurs, demandeAgent, demandeTri, langueSure, lireTri, outilsWhatsapp, promptPreparation } from "./proposer.js";

const AUCUN = "00000000-0000-0000-0000-000000000000"; // user_id du journal : aucune personne, la boîte WhatsApp
const MODELE_TRI = "claude-haiku-5-5";

type Conv = { id: string; organisation_id: string; telephone: string; nom: string | null; entite_id: string | null; entite_source: string; client_id: string | null; dossier_id: string | null };

// Point d'entrée : un message entrant vient d'être rangé (nouveau). Attend un peu (le client écrit souvent en plusieurs fois), puis prépare
// la réponse si ce message est toujours le dernier. Aucune notification Web Push. Ne lève jamais : une panne laisse la conversation lisible.
// Tout tient dans DUREE_BOITE_MS (attente comprise), sous la limite de 150 s d'une fonction Supabase.
export async function apresMessageClient(db: SupabaseClient, conversationId: string, messageId: string) {
  const t0 = Date.now();
  try {
    await new Promise((ok) => setTimeout(ok, ATTENTE_MS));
    const lu = await lireConversation(db, conversationId);
    if (!lu || !aRepondre(lu.messages, messageId)) return;
    // Aucune notification sur le téléphone (Jérémy, 20.11.2026 : Nani serait débordée). Le compteur de non-lus de l'écran suffit ; l'app
    // WhatsApp de Nani sonne déjà pour chaque message.
    await preparer(db, lu.conv, lu.messages, messageId, t0).catch((err) => {
      console.error("whatsapp : réponse non préparée", String(err?.message || err).slice(0, 200));
      return false;
    });
  } catch (err) {
    console.error("whatsapp : après message", String((err as Error)?.message || err).slice(0, 200));
  }
}

async function lireConversation(db: SupabaseClient, conversationId: string) {
  const { data: conv } = await db.from("whatsapp_conversations").select("id, organisation_id, telephone, nom, entite_id, entite_source, client_id, dossier_id").eq("id", conversationId).maybeSingle();
  if (!conv) return null;
  const { data: msgs } = await db.from("whatsapp_messages").select("id, sens, origine, type, texte, medias, envoye_le, modifie_le, supprime_le").eq("conversation_id", conversationId).order("envoye_le", { ascending: false }).limit(40);
  return { conv: conv as Conv, messages: [...(msgs || [])].reverse() as Record<string, any>[] };
}

// Les limites avant tout appel à Claude. Une lecture impossible ferme le budget (jamais l'inverse).
async function budgetOuvert(db: SupabaseClient, conv: Conv) {
  const jour = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [mois, budget, wa, parConv, boite] = await Promise.all([
    db.rpc("assistant_cout_depuis", { debut: debutMois() }),
    db.from("assistant_budget").select("plafond_mois_usd, seuil_alerte_pct").maybeSingle(),
    db.from("assistant_journal").select("cout_estime_usd").eq("usage", "whatsapp").gte("cree_le", debutMois()).limit(20000),
    db.from("whatsapp_propositions").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id).gte("cree_le", jour),
    db.from("whatsapp_propositions").select("id", { count: "exact", head: true }).gte("cree_le", jour),
  ]);
  if (mois.error || wa.error || parConv.error || boite.error || mois.data === null || mois.data === undefined) return false;
  const { plafond } = plafondRetenu(budget.error ? null : budget.data, Deno.env.get("AGENT_PLAFOND_MOIS_USD"));
  if (Number(mois.data) >= plafond) return false;
  const coutBoite = (wa.data || []).reduce((s, l) => s + (Number(l.cout_estime_usd) || 0), 0);
  if (coutBoite >= (Number(Deno.env.get("WHATSAPP_PLAFOND_MOIS_USD")) || PLAFOND_WHATSAPP_MOIS_USD)) return false;
  return (parConv.count || 0) < LIMITE_CONVERSATION_JOUR && (boite.count || 0) < LIMITE_BOITE_JOUR;
}

// Rend true si une réponse est prête à copier (et toujours utile : le client n'a pas réécrit, Nani n'a pas répondu).
async function preparer(db: SupabaseClient, conv: Conv, messages: Record<string, any>[], messageId: string, t0: number) {
  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return false;
  if (!(await budgetOuvert(db, conv))) return false;
  const anthropic = new Anthropic({ apiKey: cle, timeout: 40_000, maxRetries: 0 });
  const appels: { usage: Record<string, unknown>; modele: string }[] = [];
  const j = journalEnCours(db, appels);

  const { data: entites } = await db.from("entites").select("id, slug, nom").eq("organisation_id", conv.organisation_id).in("slug", ["secret", "taxi"]);
  const parSlug = new Map((entites || []).map((e) => [e.slug, e]));
  let ent = (entites || []).find((e) => e.id === conv.entite_id) || null;
  let proposee: string | null = null;
  // À trier : l'agent suggère Secret ou Taxi (un appel court) ; la conversation reste à trier, Nani décide d'un tap. La réponse se prépare
  // avec les données de l'entreprise suggérée et seuls ses administrateurs la lisent (migration 59). Sans suggestion, pas de réponse.
  if (!ent) {
    const m = await anthropic.messages.create({ model: MODELE_TRI, max_tokens: 10, messages: [{ role: "user", content: demandeTri(messages) }] });
    appels.push({ usage: m.usage as unknown as Record<string, unknown>, modele: m.model });
    await j.noter(null, "tri");
    proposee = lireTri(m.content.map((b) => (b.type === "text" ? b.text : "")).join(" "));
    ent = (proposee && parSlug.get(proposee)) || null;
    if (!ent) return false;
  }

  const { data: regl } = await db.from("reglages").select("valeur").eq("entite_id", ent.id).maybeSingle();
  const reglages = regl ? regl.valeur : null;
  // L'agent s'allume dans les réglages de l'entreprise : éteint, pas de proposition.
  if (!reglages || reglages.agent_ia !== true) {
    await j.noter(ent.id, "agent_eteint");
    return false;
  }

  // La proposition encore à faire est remplacée ; la nouvelle naît « en_cours » (l'écran affiche « en préparation »).
  await db.from("whatsapp_propositions").update({ statut: "remplacee" }).eq("conversation_id", conv.id).in("statut", ["a_faire", "en_cours"]);
  const { data: prop, error: errProp } = await db.from("whatsapp_propositions").insert({ conversation_id: conv.id, message_id: messageId, entite_id: ent.id, statut: "en_cours", entreprise_proposee: proposee }).select("id").single();
  if (errProp || !prop) throw new Error(`proposition : ${errProp?.message}`);
  let statut = "ok";
  let carte: { titre?: string; donnees?: { message?: string; langue?: string }; avertissements?: string[] } | null = null;
  try {
    const ctx = contexteOutils(db, ent.id, reglages, conv.entite_id === ent.id ? { clientId: conv.client_id, dossierId: conv.dossier_id } : { clientId: null, dossierId: null });
    const client = conv.client_id && conv.entite_id === ent.id ? (await db.from("clients").select("prenom").eq("id", conv.client_id).eq("entite_id", ent.id).maybeSingle()).data : null;
    const dossier = conv.dossier_id && conv.entite_id === ent.id ? (await db.from("dossiers").select("id, ref").eq("id", conv.dossier_id).eq("entite_id", ent.id).maybeSingle()).data : null;
    const prestataires = ((await ctx.charger("partenaires")) as { nom: string }[]).map((p) => String(p.nom || "").trim()).filter((x) => x.length > 2);
    const lus = await db.from("agent_apprentissages").select("id, genre, contexte, avant, apres, cree_le").eq("entite_id", ent.id).order("cree_le", { ascending: false }).limit(80);
    if (lus.error && !tableAbsente(lus.error)) console.error("whatsapp : apprentissages", lus.error.message);
    // Mêmes consignes, voix, règles de réponse et corrections apprises que l'onglet Assistant (proposer.js, promptPreparation).
    const { systeme, appris, contexte, texte, ra } = promptPreparation({ entreprise: ent.nom, reglages, apprentissages: lus.error ? [] : lus.data || [], messages, nomProfil: conv.nom || "", client, dossier, aujourdhui: dateBangkok() });
    const historique: Record<string, unknown>[] = [{ role: "user", content: [{ type: "text", text: texte }] }];
    // Le contrôle de la réponse ne compte comme « source » que les prix et heures rendus par les outils : pas les montants écrits par le client.
    const memo = memoDepuis([], { signer: signe(reglages), prestataires, entreprise: ent.nom, prenoms: [ra.responsable, "Anaïs", "Nani"].filter(Boolean) });
    // Garde-fou de la PR 278 : un montant égal à un net de l'entreprise (et à aucun prix de vente) est signalé « montant_interne » et bloque
    // la copie dans l'écran. Les nets restent ici, dans la fonction : ils ne partent jamais chez Claude.
    memo.internes = await netsDe(ctx);
    const r = await tourner({
      anthropic,
      modele: Deno.env.get("AGENT_MODELE") || MODELE_DEFAUT,
      systeme,
      appris,
      contexte,
      messages: historique,
      ctx,
      memo,
      outils: outilsWhatsapp(),
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
  } catch (err) {
    statut = estCreditEpuise(err) ? "credit_epuise" : err instanceof Anthropic.APIError ? `erreur_api${err.status ? `_${err.status}` : ""}` : "erreur";
    console.error("whatsapp : agent", statut, err instanceof Error ? err.message.slice(0, 200) : "");
  }
  const c = carte as typeof carte;
  const message = c?.donnees?.message ? String(c.donnees.message).slice(0, 4000) : "";
  // Toujours utile ? Le client a pu réécrire (son traitement prépare la suivante) ou Nani répondre depuis l'app pendant la préparation.
  const apres = await lireConversation(db, conv.id);
  const utile = !!apres && aRepondre(apres.messages, messageId);
  const champs = !utile ? { statut: "remplacee" } : message ? { statut: "a_faire", texte: message, langue: langueSure(c?.donnees?.langue), avertissements: avertissementsSurs(c?.avertissements) } : { statut: "echec", erreur: (statut === "ok" ? "pas_de_reponse" : statut).slice(0, 200) };
  // Seulement une proposition encore « en_cours » : traitée entre-temps (écho de l'app), elle le reste.
  const { data: maj } = await db.from("whatsapp_propositions").update(champs).eq("id", prop.id).eq("statut", "en_cours").select("id");
  await j.noter(ent.id, message ? statut : statut === "ok" ? "pas_de_reponse" : statut);
  return utile && !!message && !!(maj && maj.length);
}

// Le journal de l'assistant pour une préparation : une ligne créée au premier appel, mise à jour à chaque tour (coût à jour même si la
// fonction est arrêtée en route).
function journalEnCours(db: SupabaseClient, appels: { usage: Record<string, unknown>; modele: string }[]) {
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

// Les nets de l'entreprise (prestations et trajets), en nombres : seulement pour repérer un montant interne dans la réponse.
// deno-lint-ignore no-explicit-any
async function netsDe(ctx: any) {
  const [p, t] = await Promise.all([ctx.charger("prestations_nets"), ctx.charger("trajets_nets")]);
  const s = new Set<number>();
  // deno-lint-ignore no-explicit-any
  for (const n of [...(p as any[]), ...(t as any[])]) for (const v of [n.net, n.net_enfant, n.net_adulte]) if (v !== null && v !== undefined && Number(v) > 0) s.add(Number(v));
  return s;
}

// Les lectures des outils de l'agent, avec la clé de service mais toujours limitées à une entreprise. Un message de client ne doit jamais
// faire lire les données d'un autre client : aucun dossier sauf celui relié à la conversation (ou un dossier de son client relié), aucune
// recherche de clients, et jamais un numéro de téléphone (le client se lit sans téléphone ni nom de famille).
// deno-lint-ignore no-explicit-any
function contexteOutils(db: SupabaseClient, entiteId: string, reglages: any, { clientId, dossierId }: { clientId: string | null; dossierId: string | null }) {
  // Seules tables chargées entières : le catalogue, les horaires, les durées et les hôtels. Pas de dossiers, réservations ni clients.
  const COLONNES: Record<string, string> = {
    prestations: "id, famille, groupe, libelle, libelle_en, prix_vente, unite, sur_place, actif, partenaire_id",
    trajets: "id, de, vers, mode, depart, arrivee, duree, prix_adulte, prix_enfant, bebe, periode, fenetres, actif, partenaire_id",
    partenaires: "id, nom, actif, regles",
    // Les nets : lus seulement par le contrôle de la réponse (netsDe). Les outils ne les rendent jamais ici : ctx.permissions est vide,
    // donc ni partenaire ni net ni commission ne partent chez Claude (outils.js, voitPartenaires et voitNets).
    prestations_nets: "prestation_id, net, net_enfant",
    trajets_nets: "trajet_id, net_adulte, net_enfant",
    hotels_lieux: "cle, nom, lieu, zone, localite, source_url, certitude, verifie",
    temps_trajets: "de, vers, mode, duree_min, ferry, marge_min, source, source_date, a_verifier",
    liaisons_ferry: "nom, cote_ile, port_ile, port_continent, port_ile_coord, port_continent_coord, duree_min, a_verifier",
  };
  const COL_DOSSIER = "id, ref, client_id, date_depart, date_retour, annule";
  const COL_RESA = "id, dossier_id, libelle, date_service, heure_pickup, lieu_pickup, personnes, statut, montant_vente, partenaire_id, paye_sur_place";
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
            const page = await lire(db.from(nom).select(COLONNES[nom]).eq("entite_id", entiteId).range(de, de + 999), nom);
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
    return lire(db.from("hotels_lieux").select(COLONNES.hotels_lieux).eq("entite_id", entiteId).in("cle", cles), "hotels_lieux");
  };
  // Pas de moteur d'itinéraire ni de recherche web ici : les durées viennent de la table de l'entreprise, sinon l'agent le dit.
  // chercherClients rend toujours vide (l'outil n'est pas proposé, et refusé par tourner s'il est appelé quand même).
  return { historique: [], entreprise: "", fichiers: [], permissions: [], charger, chercherClients: async () => [[], []], dossierPour, parRef, hotelsPour, reglages, ors: null, simule: null, estimerWeb: null, situerWeb: null, notes: [] as string[], moteur: null, maintenant: () => Date.now() };
}
