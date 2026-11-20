// Boîte WhatsApp (phase 2) : quand un client écrit, l'agent de Gestion prépare la réponse que Nani copiera, puis la notification part.
// Appelé par index.ts après la réponse à Telnyx (EdgeRuntime.waitUntil). Clé de service : chaque lecture est limitée à l'entreprise de la
// conversation (entite_id), comme le fait la session de la personne dans la fonction « agent ».
//
// Règles de l'agent reprises telles quelles (agent/prompt.js consignes, agent/outils.js executer et controlerReponse) : prix et heures
// seulement des outils, jamais un net, une commission, une marge ni un nom de prestataire (les outils les retirent), aucune signature chez
// Secret et Taxi, anglais sauf client francophone. Une seule carte possible : proposer_reponse. Ce qui part chez Anthropic : le texte des
// derniers messages, le prénom du client, ce que rendent les outils de lecture. Jamais le numéro de téléphone.
// Budget : compté dans le plafond du mois de l'assistant (assistant_journal, usage « whatsapp »), l'agent doit être allumé (agent_ia).
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { MODELE_DEFAUT, blocApprentissages, consignes, contexteDuJour, ligneJournal, signe } from "../agent/prompt.js";
import { clesHotelPossibles, memoDepuis, motifNom, motifTelephone, prefixeRef, refDe, sansAccents } from "../agent/outils.js";
import { tourner } from "../agent/boucle.js";
import { debutMois, estCreditEpuise, plafondRetenu, tableAbsente } from "../assistant/budget.js";
import { dateBangkok, jourSemaine, lieuCourt, reglagesAssistant } from "../assistant/calc.js";
import { ATTENTE_MS, aRepondre, avertissementsSurs, demandeAgent, demandeTri, destinatairesWhatsapp, langueSure, lireTri, notificationWhatsapp, outilsWhatsapp } from "./proposer.js";

const AUCUN = "00000000-0000-0000-0000-000000000000"; // user_id du journal : aucune personne, la boîte WhatsApp
const MODELE_TRI = "claude-haiku-5-5";

type Conv = { id: string; organisation_id: string; telephone: string; nom: string | null; entite_id: string | null; entite_source: string; client_id: string | null; dossier_id: string | null };

// Point d'entrée : un message entrant vient d'être rangé (nouveau). Attend un peu (le client écrit souvent en plusieurs fois), puis prépare
// la réponse si ce message est toujours le dernier, et prévient l'équipe. Ne lève jamais : une panne laisse la conversation lisible.
export async function apresMessageClient(db: SupabaseClient, conversationId: string, messageId: string) {
  try {
    await new Promise((ok) => setTimeout(ok, ATTENTE_MS));
    const { data: conv } = await db.from("whatsapp_conversations").select("id, organisation_id, telephone, nom, entite_id, entite_source, client_id, dossier_id").eq("id", conversationId).maybeSingle();
    if (!conv) return;
    const { data: msgs } = await db.from("whatsapp_messages").select("id, sens, origine, type, texte, medias, envoye_le, modifie_le, supprime_le").eq("conversation_id", conversationId).order("envoye_le", { ascending: false }).limit(40);
    const messages = [...(msgs || [])].reverse();
    if (!aRepondre(messages, messageId)) return;
    const pret = await preparer(db, conv as Conv, messages, messageId).catch((err) => {
      console.error("whatsapp : réponse non préparée", String(err?.message || err).slice(0, 200));
      return false;
    });
    await prevenir(db, conversationId, pret).catch((err) => console.error("whatsapp : notification", String(err?.message || err).slice(0, 120)));
  } catch (err) {
    console.error("whatsapp : après message", String((err as Error)?.message || err).slice(0, 200));
  }
}

// Rend true si une réponse est prête à copier.
async function preparer(db: SupabaseClient, convIn: Conv, messages: Record<string, any>[], messageId: string) {
  let conv = convIn;
  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return false;
  const anthropic = new Anthropic({ apiKey: cle, timeout: 60_000, maxRetries: 1 });
  const appels: { usage: Record<string, unknown>; modele: string }[] = [];

  // Budget du mois (toute la dépense de l'assistant) : au plafond, pas de proposition, la notification part quand même.
  const [mois, budget] = await Promise.all([db.rpc("assistant_cout_depuis", { debut: debutMois() }), db.from("assistant_budget").select("plafond_mois_usd, seuil_alerte_pct").maybeSingle()]);
  const { plafond } = plafondRetenu(budget.error ? null : budget.data, Deno.env.get("AGENT_PLAFOND_MOIS_USD"));
  if ((Number(mois.data) || 0) >= plafond) return false;

  const { data: entites } = await db.from("entites").select("id, slug, nom").eq("organisation_id", conv.organisation_id).in("slug", ["secret", "taxi"]);
  const parSlug = new Map((entites || []).map((e) => [e.slug, e]));
  let entreprise = (entites || []).find((e) => e.id === conv.entite_id) || null;
  let proposee: string | null = null;

  // À trier : l'agent dit Secret ou Taxi (un appel court), la conversation est rangée « proposé par l'agent » ; Nani corrige d'un tap.
  if (!entreprise) {
    const m = await anthropic.messages.create({ model: MODELE_TRI, max_tokens: 10, messages: [{ role: "user", content: demandeTri(messages) }] });
    appels.push({ usage: m.usage as unknown as Record<string, unknown>, modele: m.model });
    proposee = lireTri(m.content.map((b) => (b.type === "text" ? b.text : "")).join(" "));
    if (proposee && parSlug.get(proposee)) {
      entreprise = parSlug.get(proposee)!;
      const { data } = await db.from("whatsapp_conversations").update({ entite_id: entreprise.id, entite_source: "agent" }).eq("id", conv.id).is("entite_id", null).select("id, organisation_id, telephone, nom, entite_id, entite_source, client_id, dossier_id").maybeSingle();
      if (data) conv = data as Conv;
    }
  }
  // Sans entreprise sûre, la réponse se prépare avec le catalogue de Secret (le plus fréquent) ; la conversation reste à trier.
  const ent = entreprise || parSlug.get("secret");
  if (!ent) return journal(db, null, "sans_entreprise", appels, false);

  const { data: regl } = await db.from("reglages").select("valeur").eq("entite_id", ent.id).maybeSingle();
  const reglages = regl ? regl.valeur : null;
  // L'agent s'allume dans les réglages de l'entreprise : éteint, pas de proposition.
  if (!reglages || reglages.agent_ia !== true) return journal(db, ent.id, "agent_eteint", appels, false);

  // La proposition encore à faire est remplacée ; la nouvelle naît « en_cours » (l'écran affiche « en préparation »).
  await db.from("whatsapp_propositions").update({ statut: "remplacee" }).eq("conversation_id", conv.id).in("statut", ["a_faire", "en_cours"]);
  const { data: prop, error: errProp } = await db.from("whatsapp_propositions").insert({ conversation_id: conv.id, message_id: messageId, entite_id: ent.id, statut: "en_cours", entreprise_proposee: proposee }).select("id").single();
  if (errProp || !prop) throw new Error(`proposition : ${errProp?.message}`);
  const debut = Date.now();
  let statut = "ok";
  let carte: { titre?: string; donnees?: { message?: string; langue?: string }; avertissements?: string[] } | null = null;
  try {
    const ctx = contexteOutils(db, ent.id, reglages);
    const ra = reglagesAssistant(reglages);
    const qui = ra.responsable || "Nani";
    const client = conv.client_id ? (await db.from("clients").select("prenom, nom").eq("id", conv.client_id).eq("entite_id", ent.id).maybeSingle()).data : null;
    const d = conv.dossier_id ? (await db.from("dossiers").select("id, ref").eq("id", conv.dossier_id).eq("entite_id", ent.id).maybeSingle()).data : null;
    const dossier = d ? { ref_courte: refDe("D", d.id), reference: d.ref } : null;
    const prestataires = ((await ctx.charger("partenaires")) as { nom: string }[]).map((p) => String(p.nom || "").trim()).filter((x) => x.length > 2);
    const systeme = consignes({ entreprise: ent.nom, reglages, lieu: ra.lieu, prenomEquipe: qui });
    const aujourdhui = dateBangkok();
    const contexte = contexteDuJour({ aujourdhui, jour: jourSemaine(aujourdhui), lieuCourt: lieuCourt(ra.lieu), dossier });
    const lus = await db.from("agent_apprentissages").select("id, genre, contexte, avant, apres, cree_le").eq("entite_id", ent.id).order("cree_le", { ascending: false }).limit(80);
    const derniersClient = messages.filter((m) => m.sens === "entrant").slice(-3).map((m) => m.texte || "").join(" ");
    const appris = lus.error && !tableAbsente(lus.error) ? "" : blocApprentissages(lus.data || [], { qui, premierMessage: derniersClient });
    const texte = demandeAgent({ messages, nomProfil: conv.nom || "", client, dossier, qui, entreprise: ent.nom });
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
      },
      garderCarte: async (c: typeof carte & { genre: string }) => {
        // Une seule réponse : la première carte « reponse » est gardée, les suivantes refusées.
        if (c.genre !== "reponse" || carte) return null;
        carte = c;
        return { id: prop.id, genre: c.genre, titre: c.titre, donnees: c.donnees, avertissements: c.avertissements || [] };
      },
      envoyer: async () => {},
      appels,
      debut,
    });
    statut = r.statut;
  } catch (err) {
    statut = estCreditEpuise(err) ? "credit_epuise" : err instanceof Anthropic.APIError ? `erreur_api${err.status ? `_${err.status}` : ""}` : "erreur";
    console.error("whatsapp : agent", statut, err instanceof Error ? err.message.slice(0, 200) : "");
  }
  const c = carte as typeof carte;
  const message = c?.donnees?.message ? String(c.donnees.message).slice(0, 4000) : "";
  // Seulement une proposition encore « en_cours » : si Nani a déjà répondu depuis l'app pendant ce temps, elle reste « traitee ».
  await db
    .from("whatsapp_propositions")
    .update(message ? { statut: "a_faire", texte: message, langue: langueSure(c?.donnees?.langue), avertissements: avertissementsSurs(c?.avertissements) } : { statut: "echec", erreur: (statut === "ok" ? "pas_de_reponse" : statut).slice(0, 200) })
    .eq("id", prop.id)
    .eq("statut", "en_cours");
  if (message) {
    // Si Nani a répondu pendant la préparation, la proposition garde son texte pour mémoire.
    await db.from("whatsapp_propositions").update({ texte: message, langue: langueSure(c?.donnees?.langue), avertissements: avertissementsSurs(c?.avertissements) }).eq("id", prop.id).neq("statut", "a_faire");
  }
  return journal(db, ent.id, message ? statut : statut === "ok" ? "pas_de_reponse" : statut, appels, !!message, Date.now() - debut);
}

async function journal(db: SupabaseClient, entiteId: string | null, statut: string, appels: { usage: Record<string, unknown>; modele: string }[], pret: boolean, dureeMs = 0) {
  if (appels.length) {
    const ligne = { ...ligneJournal({ userId: AUCUN, entiteId, statut, appels, dureeMs }), usage: "whatsapp" };
    const { error } = await db.from("assistant_journal").insert(ligne);
    if (error) console.error("whatsapp : journal", error.message);
  }
  return pret;
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

// Les lectures des outils de l'agent, avec la clé de service mais toujours limitées à une entreprise.
// deno-lint-ignore no-explicit-any
function contexteOutils(db: SupabaseClient, entiteId: string, reglages: any) {
  const COLONNES: Record<string, string> = {
    prestations: "id, famille, groupe, libelle, libelle_en, prix_vente, unite, sur_place, actif, partenaire_id",
    trajets: "id, de, vers, mode, depart, arrivee, duree, prix_adulte, prix_enfant, bebe, periode, fenetres, actif, partenaire_id",
    partenaires: "id, nom, actif, regles",
    // Les nets : lus seulement par le contrôle de la réponse (montants internes). Les outils ne les rendent jamais ici : ctx.permissions est
    // vide, donc ni partenaire ni net ni commission ne partent chez Claude (outils.js, voitPartenaires et voitNets).
    prestations_nets: "prestation_id, net, net_enfant",
    trajets_nets: "trajet_id, net_adulte, net_enfant",
    hotels_lieux: "cle, nom, lieu, zone, localite, source_url, certitude, verifie",
    temps_trajets: "de, vers, mode, duree_min, ferry, marge_min, source, source_date, a_verifier",
    liaisons_ferry: "nom, cote_ile, port_ile, port_continent, port_ile_coord, port_continent_coord, duree_min, a_verifier",
    dossiers: "id, ref, client_id, date_depart, date_retour, annule",
    reservations: "id, dossier_id, libelle, date_service, heure_pickup, lieu_pickup, personnes, statut, montant_vente, partenaire_id, paye_sur_place",
  };
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
  const COL_CLIENT = "id, prenom, nom, telephone, entite_id";
  const parRef = async (table: string, ref: string) => {
    const p = prefixeRef(ref);
    if (!p) return [];
    return lire(db.from(table).select(COLONNES[table]).eq("entite_id", entiteId).gte("id", `${p}-0000-0000-0000-000000000000`).lte("id", `${p}-ffff-ffff-ffff-ffffffffffff`).limit(5), table);
  };
  // Clients de cette entreprise seulement (la clé de service ne passe pas par RLS : le filtre est ici).
  const chercherClients = async (recherche: string) => {
    const mots = sansAccents(recherche).trim().split(/\s+/).filter((m: string) => m.length >= 2).slice(0, 5);
    const chiffres = String(recherche || "").replace(/\D/g, "");
    if (!mots.length && chiffres.length < 6) return [[], []];
    // deno-lint-ignore no-explicit-any
    const parNom = (q: any) => mots.reduce((r: any, m: string) => r.or(`prenom.ilike.${motifNom(m)},nom.ilike.${motifNom(m)}`), q);
    const [propres, parTel] = await Promise.all([
      mots.length ? lire(parNom(db.from("clients").select(COL_CLIENT).eq("entite_id", entiteId)).limit(100), "clients") : [],
      chiffres.length >= 6 ? lire(db.from("clients").select(COL_CLIENT).eq("entite_id", entiteId).ilike("telephone", motifTelephone(chiffres)).limit(50), "clients") : [],
    ]);
    const clients = new Map<string, Record<string, any>>();
    for (const c of [...propres, ...parTel]) clients.set(c.id, c);
    const ids = [...clients.keys()].slice(0, 100);
    const dossiers = ids.length ? await lire(db.from("dossiers").select(COLONNES.dossiers).eq("entite_id", entiteId).in("client_id", ids).limit(500), "dossiers") : [];
    return [[...clients.values()], dossiers];
  };
  const dossierPour = async (ref: string) => {
    let dossiers = await parRef("dossiers", ref);
    const t = String(ref || "").trim();
    if (!dossiers.length && t.length >= 2 && t.length <= 30) dossiers = await lire(db.from("dossiers").select(COLONNES.dossiers).eq("entite_id", entiteId).ilike("ref", t.replace(/[\\%_]/g, "\\$&")).limit(5), "dossiers");
    const d = dossiers[0];
    if (!d) return [[], [], []];
    const [clients, reservations] = await Promise.all([
      d.client_id ? lire(db.from("clients").select(COL_CLIENT).eq("id", d.client_id).eq("entite_id", entiteId), "clients") : [],
      lire(db.from("reservations").select(COLONNES.reservations).eq("entite_id", entiteId).eq("dossier_id", d.id).limit(200), "reservations"),
    ]);
    return [dossiers, clients, reservations];
  };
  const hotelsPour = async (lieux: string[]) => {
    const cles = [...new Set(lieux.flatMap((l) => clesHotelPossibles(l)))].slice(0, 100);
    if (!cles.length) return [];
    return lire(db.from("hotels_lieux").select(COLONNES.hotels_lieux).eq("entite_id", entiteId).in("cle", cles), "hotels_lieux");
  };
  // Pas de moteur d'itinéraire ni de recherche web ici : les durées viennent de la table de l'entreprise, sinon l'agent le dit.
  return { historique: [], entreprise: "", fichiers: [], permissions: [], charger, chercherClients, dossierPour, parRef, hotelsPour, reglages, ors: null, simule: null, estimerWeb: null, situerWeb: null, notes: [] as string[], moteur: null, maintenant: () => Date.now() };
}

// Notification aux administrateurs (Web Push existant). Le contenu du message ne part jamais dans la notification.
async function prevenir(db: SupabaseClient, conversationId: string, pret: boolean) {
  if (!Deno.env.get("VAPID_PRIVATE_KEY")) return;
  const { data: conv } = await db.from("whatsapp_conversations").select("id, organisation_id, telephone, nom, entite_id, client_id").eq("id", conversationId).maybeSingle();
  if (!conv) return;
  const { data: entites } = await db.from("entites").select("id, slug, nom").eq("organisation_id", conv.organisation_id).in("slug", ["secret", "taxi"]);
  const ids = conv.entite_id ? [conv.entite_id] : (entites || []).map((e) => e.id);
  const [profils, membres, roles] = await Promise.all([
    db.from("profils").select("user_id, actif, super_admin").eq("organisation_id", conv.organisation_id),
    db.from("membres").select("user_id, entite_id, role_id").in("entite_id", ids),
    db.from("roles").select("id, portee, permissions, tous_droits").in("entite_id", ids),
  ]);
  for (const r of [profils, membres, roles]) if (r.error) throw new Error(r.error.message);
  const qui = destinatairesWhatsapp({ entiteIds: ids, profils: profils.data!, membres: membres.data!, roles: roles.data! });
  if (!qui.length) return;
  const client = conv.client_id ? (await db.from("clients").select("prenom").eq("id", conv.client_id).maybeSingle()).data : null;
  const ent = (entites || []).find((e) => e.id === conv.entite_id);
  const n = notificationWhatsapp({ nom: client?.prenom || conv.nom || "", telephone: conv.telephone, pret, entreprise: ent?.nom || "" });
  const abos = await db.from("abonnements_push").select("id, endpoint, p256dh, auth").in("user_id", qui);
  if (abos.error || !abos.data?.length) return;
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  const charge = JSON.stringify({ ...n, url: `/gestion/#/whatsapp?c=${conv.id}${conv.entite_id ? `&entite=${conv.entite_id}` : ""}` });
  for (const abo of abos.data) {
    try {
      await webpush.sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, charge, { TTL: 6 * 3600 });
    } catch (err) {
      // deno-lint-ignore no-explicit-any
      const code = (err as any)?.statusCode;
      if (code === 404 || code === 410) await db.from("abonnements_push").delete().eq("id", abo.id);
    }
  }
}
