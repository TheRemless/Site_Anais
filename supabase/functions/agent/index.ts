// Fonction « agent » : l'assistant de l'onglet « Assistant », avec qui on discute et qui s'appuie sur des outils (catalogue, horaires, hôtels,
// temps de route, planning, clients, dossiers) pour planifier et proposer. L'outil l'appelle avec la session de la personne : toutes les
// lectures et écritures passent par les règles RLS, comme dans l'outil. Seul le journal (compte et coût) s'écrit avec la clé de service.
//
// Ce qui part chez Anthropic : les messages de la personne avec leurs pièces jointes (fichiers.js) et ce que les outils rendent (tarifs de vente, horaires, lieux, clients et
// dossiers de l'entreprise). Jamais un net, une marge ni un nom de prestataire : les outils les retirent (outils.js). Rien n'est écrit dans
// les dossiers : les propositions sont des cartes que la personne valide dans l'écran.
//
// Réponse en flux NDJSON (une ligne JSON par événement) : { t: "conversation" | "etape" | "texte" | "planning" | "carte" | "fin" | "erreur" }.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { LIMITE_JOUR_DEFAUT, LONGUEUR_MAX, MODELE_DEFAUT, blocApprentissages, consignes, contexteDuJour, controlerAcces, debutValide, historique, ligneJournal, signe, titreDepuis } from "./prompt.js";
import { clesHotelPossibles, memoDepuis, motifNom, motifTelephone, prefixeRef, refDe, sansAccents, tempsSimule } from "./outils.js";
import { tourner } from "./boucle.js";
import { NOMINATIM_BASE, ORGANISATIONS_OSRM, ORS_BASE, ORS_GEOCODE, ORS_ITINERAIRE, OSRM_BASE, USER_AGENT, cheminOsrm, cleItineraire, cleZone, corpsItineraire, delaiAvant, lireGeocode, lireItineraire, lireNominatim, lireOsrm, parametresGeocode, parametresNominatim, situerLieu, VALIDITE_JOURS, VALIDITE_GOOGLE_JOURS, GOOGLE_PLACES, GOOGLE_ROUTES, CHAMPS_PLACES, CHAMPS_ROUTES, corpsPlaces, corpsRoutes, lirePlaces, lireRoutes } from "./temps.js";
import { lireEstimation, parametresEstimation } from "./estimation.js";
import { debutMois, estCreditEpuise, etatBudget, plafondRetenu, reprise, tableAbsente } from "../assistant/budget.js";
import { MESSAGES_MAX as MESSAGES_MAX_WA, MODES as MODES_WA, mediasAJoindre, texteDepuisWhatsApp } from "./whatsapp.js";
import { blocFichier, fichiersRetenus, historiquePourClaude, contenuPourClaude, titreFichiers, verifierPieces } from "./fichiers.js";
import { dateBangkok, debutJourBangkok, jourSemaine, lieuCourt, reglagesAssistant } from "../assistant/calc.js";
import { lieuxDuCatalogue, lireSituer, nomPourRecherche, parametresSituer, promptSituer, validerSituer } from "../assistant/itineraire.js";

const ORIGINES = (Deno.env.get("ASSISTANT_ORIGINES") || "https://gestion.zwaldtravelplanner.com").split(",").map((x) => x.trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONSERVATION_JOURS = Number(Deno.env.get("AGENT_CONSERVATION_JOURS")) || 90;

function entetes(req: Request, type = "application/json") {
  const origine = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINES.includes(origine) ? origine : ORIGINES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    "Content-Type": type,
  };
}

// Le seuil d'alerte ou le plafond du mois passé, ou le crédit d'Anthropic épuisé : la fonction « rappels » prévient les administratrices
// (notification, une fois par alerte). Appelée avec la clé de service ; une panne ne gêne pas l'échange.
// Lancée en tâche de fond : la réponse n'attend pas, et le runtime garde la fonction en vie jusqu'à la fin de l'appel (EdgeRuntime.waitUntil).
function alerterEnFond(corps: Record<string, unknown>) {
  const tache = alerterBudget(corps);
  try {
    (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(tache);
  } catch {
    // Hors de Supabase (essais) : la promesse suit son cours.
  }
  return tache;
}
async function alerterBudget(corps: Record<string, unknown>) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/rappels`, { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "budget", ...corps }), signal: AbortSignal.timeout(8000) });
  } catch (err) {
    console.error("agent : alerte du budget", err instanceof Error ? err.message.slice(0, 120) : "");
  }
}

Deno.serve(async (req) => {
  const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: entetes(req) });
  if (req.method === "OPTIONS") return new Response("ok", { headers: entetes(req) });
  if (req.method !== "POST") return json({ erreur: "methode" }, 405);
  const autorisation = req.headers.get("authorization") || "";
  if (!/^Bearer .+/.test(autorisation)) return json({ erreur: "non_connecte" }, 401);
  const demande = await req.json().catch(() => null);
  if (!demande || typeof demande !== "object") return json({ erreur: "demande_invalide" }, 400);
  const entiteId = demande.entite_id;
  if (typeof entiteId !== "string" || !UUID.test(entiteId)) return json({ erreur: "entreprise_invalide" }, 400);
  let message = typeof demande.texte === "string" ? demande.texte.trim() : "";
  // « Créer le dossier » ou « Mettre à jour le dossier » depuis l'écran WhatsApp (agent/whatsapp.js) : le message et les pièces jointes sont
  // construits ici, plus bas, depuis la conversation WhatsApp lue avec la session de la personne.
  const waId = typeof demande.whatsapp_conversation_id === "string" && UUID.test(demande.whatsapp_conversation_id) && !demande.conversation_id ? demande.whatsapp_conversation_id : null;
  const waMode = MODES_WA.includes(demande.whatsapp_mode) ? demande.whatsapp_mode : "creer";
  // Un message peut n'être que des pièces jointes (photos, captures, PDF). Contrôlées une seule fois : ici pour une nouvelle conversation
  // (rien n'est encore gardé), plus bas avec ce que garde déjà une conversation existante.
  const avecFichiers = Array.isArray(demande.fichiers) && demande.fichiers.length > 0;
  if (((!message && !avecFichiers) || message.length > LONGUEUR_MAX) && !waId) return json({ erreur: "message_invalide" }, 400);
  const conversationId = demande.conversation_id && UUID.test(demande.conversation_id) ? demande.conversation_id : null;
  let controle = conversationId ? null : verifierPieces(demande.fichiers);
  if (controle && !controle.ok) return json({ erreur: controle.erreur }, 400);

  const URL_SB = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
  const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: qui, error: errQui } = await sb.auth.getUser();
  if (errQui || !qui?.user) return json({ erreur: "non_connecte" }, 401);
  let waDossier: string | null = null;
  if (waId) {
    // Lue avec la session : une conversation WhatsApp que la personne ne peut pas lire n'existe pas pour elle.
    const wc = await sb.from("whatsapp_conversations").select("id, telephone, nom, entite_id, dossier_id").eq("id", waId).maybeSingle();
    if (wc.error) return json({ erreur: "base" }, 500);
    if (!wc.data || (wc.data.entite_id && wc.data.entite_id !== entiteId)) return json({ erreur: "whatsapp_introuvable" }, 404);
    const wm = await sb.from("whatsapp_messages").select("sens, texte, medias, envoye_le, modifie_le, supprime_le").eq("conversation_id", waId).order("envoye_le", { ascending: false }).limit(MESSAGES_MAX_WA);
    if (wm.error) return json({ erreur: "base" }, 500);
    const messagesWa = wm.data || [];
    // Les photos et PDF copiés, téléchargés avec la session (politique du stockage « whatsapp ») ; un fichier illisible est sauté.
    const fichiers: { nom: string; media_type: string; data: string }[] = [];
    for (const f of mediasAJoindre(messagesWa)) {
      const { data: blob, error } = await sb.storage.from("whatsapp").download(f.chemin);
      if (error || !blob) continue;
      const octets = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode(...octets.subarray(i, i + 0x8000));
      fichiers.push({ nom: f.nom, media_type: f.media_type, data: btoa(bin) });
    }
    const dossierWa = waMode === "maj" && wc.data.dossier_id ? (await sb.from("dossiers").select("id, ref").eq("id", wc.data.dossier_id).maybeSingle()).data : null;
    if (waMode === "maj" && !dossierWa) return json({ erreur: "dossier_introuvable" }, 404);
    const verif = verifierPieces(fichiers);
    demande.fichiers = verif.ok ? fichiers : [];
    message = texteDepuisWhatsApp({ mode: waMode, conv: wc.data, messages: messagesWa, dossier: dossierWa, joints: demande.fichiers.length }).slice(0, LONGUEUR_MAX);
    controle = verifierPieces(demande.fichiers);
    waDossier = dossierWa ? dossierWa.id : null;
  }
  const userId = qui.user.id;

  const [regl, perms, echanges, mois, ent, budget] = await Promise.all([
    sb.from("reglages").select("valeur").eq("entite_id", entiteId).maybeSingle(),
    sb.rpc("permissions_dans", { e: entiteId }),
    admin.from("assistant_journal").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("usage", "agent").gte("cree_le", debutJourBangkok()),
    // Le plafond du mois compte toute la dépense de l'assistant (tous usages, toutes personnes) : il protège le crédit.
    admin.rpc("assistant_cout_depuis", { debut: debutMois() }),
    sb.from("entites").select("nom, organisation_id").eq("id", entiteId).maybeSingle(),
    // Le plafond réglé par Jérémy (migration 54) ; sans la table, le secret AGENT_PLAFOND_MOIS_USD, sinon 50 $.
    admin.from("assistant_budget").select("plafond_mois_usd, seuil_alerte_pct").maybeSingle(),
  ]);
  if (regl.error || perms.error || echanges.error || mois.error) return json({ erreur: "base" }, 500);
  if (ent.error) console.error("agent : entreprise", ent.error.message);
  const reglages = regl.data ? regl.data.valeur : null;
  const coutDuMois = Number(mois.data) || 0;
  if (budget.error && !tableAbsente(budget.error)) console.error("agent : plafond", budget.error.message);
  const { plafond, seuil } = plafondRetenu(budget.error ? null : budget.data, Deno.env.get("AGENT_PLAFOND_MOIS_USD"));
  const acces = controlerAcces({
    entiteId,
    permissions: perms.data || [],
    reglages,
    echangesDuJour: echanges.count || 0,
    limiteJour: Number(Deno.env.get("AGENT_LIMITE_JOUR")) || LIMITE_JOUR_DEFAUT,
    coutDuMois,
    plafondMois: plafond,
  });
  if (!acces.ok) {
    // Plafond atteint : l'alerte part (une seule fois par mois) si aucun échange ne l'a encore envoyée.
    if (acces.erreur === "plafond_du_mois") alerterEnFond({});
    return json({ erreur: acces.erreur, ...(acces.manque ? { manque: acces.manque } : {}), ...(acces.limite ? { limite: acces.limite } : {}), ...(acces.plafond ? { plafond: acces.plafond, depense: acces.depense, reprise: reprise() } : {}) }, acces.statut);
  }
  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return json({ erreur: "non_configure" }, 503);

  // La conversation : nouvelle, ou une des miennes (RLS : une conversation d'une autre personne n'est pas lisible).
  let conv: { id: string; titre: string; dossier_id: string | null; cree_le?: string } | null = null;
  if (conversationId) {
    const c = await sb.from("agent_conversations").select("id, titre, dossier_id, entite_id, cree_le").eq("id", conversationId).maybeSingle();
    if (c.error) return json({ erreur: "base" }, 500);
    if (!c.data || c.data.entite_id !== entiteId) return json({ erreur: "conversation_introuvable" }, 404);
    conv = c.data;
  } else {
    const dossierId = waDossier || (typeof demande.dossier_id === "string" && UUID.test(demande.dossier_id) ? demande.dossier_id : null);
    const titre = waId ? (waMode === "maj" ? "Mise à jour depuis WhatsApp" : "Dossier depuis WhatsApp") : titreDepuis(message || titreFichiers(controle?.fichiers || []));
    const c = await sb.from("agent_conversations").insert({ entite_id: entiteId, titre, dossier_id: dossierId, ...(waId ? { whatsapp_conversation_id: waId } : {}) }).select("id, titre, dossier_id, cree_le").single();
    if (c.error) return json({ erreur: c.error.code === "42P01" ? "migration_manquante" : "base" }, 500);
    conv = c.data;
  }
  const anciens = await sb.from("agent_messages").select("role, contenu").eq("conversation_id", conv!.id).order("id", { ascending: false }).limit(400);
  if (anciens.error) return json({ erreur: "base" }, 500);
  // Les pièces jointes de la conversation (migration 55) : leurs métadonnées, puis les données de celles qui partent à cet appel. Sans la
  // table (migration pas encore passée), une conversation sans fichier marche comme avant ; un envoi de fichier est refusé.
  // Un refus après la création d'une nouvelle conversation la retire : pas de conversation vide dans la liste.
  const abandonner = async (corps: Record<string, unknown>, status: number) => {
    if (!conversationId) await sb.from("agent_conversations").delete().eq("id", conv!.id);
    return json(corps, status);
  };
  const meta = await sb.from("agent_fichiers").select("id, nom, media_type, taille, cree_le").eq("conversation_id", conv!.id).order("cree_le", { ascending: true }).limit(100);
  if (meta.error && (avecFichiers || meta.error.code !== "42P01")) return abandonner({ erreur: meta.error.code === "42P01" ? "migration_manquante" : "base" }, 500);
  const fichiersConv: { id: string; nom: string; media_type: string; taille: number; cree_le?: string }[] = meta.data || [];
  if (!controle) controle = verifierPieces(demande.fichiers, { nombre: fichiersConv.length, taille: fichiersConv.reduce((s, f) => s + (Number(f.taille) || 0), 0) });
  if (!controle.ok) return abandonner({ erreur: controle.erreur }, 400);
  const recus = (controle.fichiers || []) as { nom: string; media_type: string; data: string; taille: number }[];
  let blocsNouveaux: Record<string, unknown>[] = [];
  let nouveaux: { id: string; conversation_id: string; nom: string; media_type: string; taille: number; data: string }[] = [];
  if (recus.length) {
    // Identifiants posés ici : chaque fichier reçu garde le sien sans dépendre de l'ordre des lignes rendues par la base.
    nouveaux = recus.map((f) => ({ id: crypto.randomUUID(), conversation_id: conv!.id, nom: f.nom, media_type: f.media_type, taille: f.taille, data: f.data }));
    const ins = await sb.from("agent_fichiers").insert(nouveaux).select("id, cree_le");
    // La base tient aussi les limites de la conversation (migration 55) : son refus se dit comme celui de la fonction.
    if (ins.error && /conversation_pleine/.test(ins.error.message)) return abandonner({ erreur: "conversation_pleine" }, 400);
    if (ins.error || !ins.data || ins.data.length !== nouveaux.length) return abandonner({ erreur: "base" }, 500);
    fichiersConv.push(...nouveaux.map(({ data: _d, ...m }) => m));
    blocsNouveaux = nouveaux.map(blocFichier);
  }
  const retenus = fichiersRetenus(fichiersConv);
  const donnees = new Map<string, { media_type: string; data: string }>();
  for (const f of nouveaux) if (retenus.has(f.id)) donnees.set(f.id, { media_type: f.media_type, data: f.data });
  const aLire = [...retenus].filter((id) => !donnees.has(id));
  if (aLire.length) {
    const d = await sb.from("agent_fichiers").select("id, media_type, data").in("id", aLire);
    if (d.error) return json({ erreur: "base" }, 500);
    for (const f of d.data || []) donnees.set(f.id, { media_type: f.media_type, data: f.data });
  }
  // Conservation : mes conversations sans message depuis 90 jours partent (sans attendre, une erreur ne bloque rien).
  sb.rpc("purger_agent_conversations", { jours: CONSERVATION_JOURS }).then(() => {}, () => {});
  sb.rpc("purger_google_agent").then(() => {}, () => {});
  sb.rpc("purger_agent_fichiers", { jours: 30 }).then(() => {}, () => {});

  // ---- Données lues à la demande des outils, une fois par échange, avec la session de la personne -----------------------------------
  const cache = new Map<string, Promise<unknown[]>>();
  const paginer = async (table: string, colonnes: string, filtre: (q: any) => any) => {
    const lignes: unknown[] = [];
    for (let de = 0; de < 20000; de += 1000) {
      const { data, error } = await filtre(sb.from(table).select(colonnes)).range(de, de + 999);
      if (error) return error.code === "42P01" ? [] : Promise.reject(new Error(`${table} : ${error.message}`));
      lignes.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return lignes;
  };
  const droitsNets = (perms.data || []).includes("partenaires.lire") && (perms.data || []).includes("partenaires.nets");
  const NETS_RES_AVANT_57 = "reservation_id, net_prevu, net_paye, paye_le, commission_prevue, commission_recue, commission_recue_le";
  const COLONNES: Record<string, string> = {
    prestations: "id, famille, groupe, libelle, libelle_en, prix_vente, unite, sur_place, actif, partenaire_id",
    trajets: "id, de, vers, mode, depart, arrivee, duree, prix_adulte, prix_enfant, bebe, periode, fenetres, actif, partenaire_id",
    // regles : le mode de règlement du partenaire (« sur place » ou chez nous), lu par les outils, jamais renvoyé tel quel.
    partenaires: "id, nom, actif, regles",
    // Les nets et la règle de commission : vides pour qui n'a pas le droit « partenaires.nets » (RLS), et les outils ne les lisent qu'avec ce
    // droit (outils.js, voitNets). Avec lui, ils partent chez Claude (décision de Jérémy du 20.11.2026), jamais vers un client.
    prestations_nets: "prestation_id, net, net_enfant",
    trajets_nets: "trajet_id, net_adulte, net_enfant",
    partenaires_prives: "partenaire_id, commission_regle, commissions",
    hotels_lieux: "cle, nom, lieu, zone, localite, source_url, certitude, verifie",
    temps_trajets: "de, vers, mode, duree_min, ferry, marge_min, source, source_date, a_verifier",
    liaisons_ferry: "nom, cote_ile, port_ile, port_continent, port_ile_coord, port_continent_coord, duree_min, a_verifier",
    dossiers: "id, ref, client_id, date_depart, date_retour, annule",
    reservations: "id, dossier_id, libelle, date_service, heure_pickup, lieu_pickup, personnes, statut, montant_vente, partenaire_id, paye_sur_place",
    // Le net et la commission d'un service (migrations 11, 18 et 57). Sans la migration 57, repli sur les colonnes d'avant (NETS_RES_AVANT_57).
    reservations_nets: "reservation_id, net_prevu, net_paye, paye_le, commission_prevue, commission_recue, commission_recue_le, commission_recue_moyen, commission_partielle_le, commission_ecart_motif, commission_ecart_note",
  };
  const charger = (nom: string): Promise<unknown[]> => {
    if (!cache.has(nom)) cache.set(nom, paginer(nom, COLONNES[nom], (q) => q.eq("entite_id", entiteId)));
    return cache.get(nom)!;
  };
  const lire = async (requete: any, table: string) => {
    const { data, error } = await requete;
    if (error) throw new Error(`${table} : ${error.message}`);
    return (data || []) as Record<string, any>[];
  };

  // Clients, dossiers, réservations, hôtels : cherchés dans la base (quelques lignes), jamais chargés entiers (20.11.2026, pensé pour des
  // milliers de dossiers). Les outils refont le tri fin (accents, mots, téléphone) sur ces candidats.
  const COL_CLIENT = "id, prenom, nom, telephone, entite_id";
  // Une ligne par sa référence courte (« D-1a2b3c4d ») : les huit premiers caractères de l'identifiant, lus comme un intervalle d'uuid.
  const parRef = async (table: string, ref: string) => {
    const p = prefixeRef(ref);
    if (!p) return [];
    return lire(sb.from(table).select(COLONNES[table]).eq("entite_id", entiteId).gte("id", `${p}-0000-0000-0000-000000000000`).lte("id", `${p}-ffff-ffff-ffff-ffffffffffff`).limit(5), table);
  };
  const chercherClients = async (recherche: string) => {
    const mots = sansAccents(recherche).trim().split(/\s+/).filter((m) => m.length >= 2).slice(0, 5);
    const chiffres = String(recherche || "").replace(/\D/g, "");
    if (!mots.length && chiffres.length < 6) return [[], []];
    const parNom = (q: any) => mots.reduce((r, m) => r.or(`prenom.ilike.${motifNom(m)},nom.ilike.${motifNom(m)}`), q);
    const [propres, autres, parTel, parDossier] = await Promise.all([
      mots.length ? lire(parNom(sb.from("clients").select(COL_CLIENT).eq("entite_id", entiteId)).limit(100), "clients") : [],
      // Les clients partagés d'une autre entreprise qui ont un dossier ici (jointure sur la clé du partage, migration 46). Sans cette clé,
      // repli : les clients des autres entreprises, gardés plus bas seulement s'ils ont un dossier ici.
      mots.length
        ? lire(parNom(sb.from("clients").select(`${COL_CLIENT}, dossiers!dossiers_client_fkey!inner(entite_id)`).neq("entite_id", entiteId).eq("dossiers.entite_id", entiteId)).limit(100), "clients").catch(() =>
            lire(parNom(sb.from("clients").select(COL_CLIENT).neq("entite_id", entiteId)).limit(100), "clients")
          )
        : [],
      chiffres.length >= 6 ? lire(sb.from("clients").select(COL_CLIENT).ilike("telephone", motifTelephone(chiffres)).limit(50), "clients") : [],
      mots.length ? lire(sb.from("dossiers").select(COLONNES.dossiers).eq("entite_id", entiteId).or(mots.map((m) => `ref.ilike.${motifNom(m)}`).join(",")).limit(50), "dossiers") : [],
    ]);
    const clients = new Map<string, Record<string, any>>();
    for (const c of [...propres, ...autres, ...parTel]) clients.set(c.id, c);
    const manquants = [...new Set(parDossier.map((d) => d.client_id))].filter((id) => id && !clients.has(id));
    if (manquants.length) for (const c of await lire(sb.from("clients").select(COL_CLIENT).in("id", manquants.slice(0, 50)), "clients")) clients.set(c.id, c);
    const ids = [...clients.keys()].slice(0, 250);
    // Par lots de 100 identifiants : une adresse trop longue serait refusée.
    const dossiers: Record<string, any>[] = [];
    for (let i = 0; i < ids.length; i += 100) dossiers.push(...(await lire(sb.from("dossiers").select(COLONNES.dossiers).eq("entite_id", entiteId).in("client_id", ids.slice(i, i + 100)).limit(500), "dossiers")));
    const ici = new Set(dossiers.map((d) => d.client_id));
    return [[...clients.values()].filter((c) => c.entite_id === entiteId || ici.has(c.id)), dossiers];
  };
  // Un dossier par sa référence courte ou son numéro (« 2026-0142 »), avec son client et ses services.
  const dossierPour = async (ref: string) => {
    let dossiers = await parRef("dossiers", ref);
    const t = String(ref || "").trim();
    if (!dossiers.length && t.length >= 2 && t.length <= 30) dossiers = await lire(sb.from("dossiers").select(COLONNES.dossiers).eq("entite_id", entiteId).ilike("ref", t.replace(/[\\%_]/g, "\\$&")).limit(5), "dossiers");
    const d = dossiers[0];
    if (!d) return [[], [], []];
    const [clients, reservations] = await Promise.all([
      d.client_id ? lire(sb.from("clients").select(COL_CLIENT).eq("id", d.client_id), "clients") : [],
      lire(sb.from("reservations").select(COLONNES.reservations).eq("entite_id", entiteId).eq("dossier_id", d.id).limit(200), "reservations"),
    ]);
    // Les nets et commissions des services : seulement avec le droit « partenaires.nets » (la base les refuse aussi sans lui).
    const ids = reservations.map((r) => r.id);
    let nets: Record<string, any>[] = [];
    if (ids.length && droitsNets) {
      const q = (colonnes: string) => sb.from("reservations_nets").select(colonnes).eq("entite_id", entiteId).in("reservation_id", ids.slice(0, 200));
      const r = await q(COLONNES.reservations_nets);
      // 42703 : colonne absente (migration 57 pas encore passée) : les colonnes d'avant suffisent.
      nets = r.error && r.error.code === "42703" ? await lire(q(NETS_RES_AVANT_57), "reservations_nets") : await lire(r, "reservations_nets");
    }
    return [dossiers, clients, reservations, nets];
  };
  // Les hôtels connus dont le nom figure dans ces lieux (clés possibles, lues par la table), gardés pour l'échange.
  const hotelsVus = new Map<string, Record<string, any> | null>();
  const hotelsPour = async (lieux: string[]) => {
    const cles = [...new Set(lieux.flatMap((l) => clesHotelPossibles(l)))];
    const aLire = cles.filter((c) => !hotelsVus.has(c));
    for (let i = 0; i < aLire.length; i += 100) {
      const lot = aLire.slice(i, i + 100);
      const lignes = await lire(sb.from("hotels_lieux").select(COLONNES.hotels_lieux).eq("entite_id", entiteId).in("cle", lot), "hotels_lieux");
      for (const c of lot) hotelsVus.set(c, lignes.find((h) => h.cle === c) || null);
    }
    return cles.map((c) => hotelsVus.get(c)).filter(Boolean) as Record<string, any>[];
  };
  // Lieux et itinéraires calculés plus vieux que six mois : relus comme absents, donc recalculés (et réécrits par-dessus).
  const valideDepuis = new Date(Date.now() - VALIDITE_JOURS * 86_400_000).toISOString();
  // Ce qui vient de Google ne se garde que 30 jours (conditions de Google Maps Platform).
  const valideGoogle = new Date(Date.now() - VALIDITE_GOOGLE_JOURS * 86_400_000).toISOString();
  const lieuValide = `origine.eq.saisie,and(origine.eq.google,maj_le.gte."${valideGoogle}"),and(origine.in.(ors,nominatim),maj_le.gte."${valideDepuis}")`;
  const trajetValide = `and(moteur.eq.google,maj_le.gte."${valideGoogle}"),and(moteur.in.(ors,osrm),maj_le.gte."${valideDepuis}")`;

  const anthropic = new Anthropic({ apiKey: cle, timeout: 60_000, maxRetries: 1 });
  const appels: { usage: Record<string, unknown>; modele: string }[] = [];

  // Durées de route : OpenStreetMap d'abord (Jérémy, 19.11.2026), par openrouteservice si la clé ORS_API_KEY est posée, sinon, pour
  // l'organisation de Koh Lanta seulement, par le serveur public OSRM et Nominatim (Jérémy, 20.11.2026 ; AGENT_OSRM=0 le coupe). Résultats
  // gardés en base (lieux_geo, trajets_ors), une requête par seconde au plus par serveur. Puis la table de l'entreprise (lue par les outils).
  // Rien d'un client ne part : seulement le nom d'un lieu (recherche) ou des coordonnées (itinéraire). Temps simulés si AGENT_TRAJETS_SIMULES=1.
  const cleOrs = Deno.env.get("ORS_API_KEY");
  const simules = Deno.env.get("AGENT_TRAJETS_SIMULES") === "1";
  const orsUrl = Deno.env.get("ORS_URL") || ORS_BASE;
  const osrmPermis = ORGANISATIONS_OSRM.includes(ent.data?.organisation_id || "") && Deno.env.get("AGENT_OSRM") !== "0";
  // Google Maps passe devant dès que sa clé est posée (Jérémy, 20.11.2026) : OpenStreetMap ne situe qu'un hôtel sur deux et refuse Supabase.
  const cleGoogle = Deno.env.get("GOOGLE_MAPS_API_KEY");
  const moteur: "google" | "ors" | "osrm" | null = cleGoogle ? "google" : cleOrs ? "ors" : osrmPermis ? "osrm" : null;
  const hoteGoogle = (h: string) => h === "places.googleapis.com" || h === "routes.googleapis.com";
  const derniers = new Map<string, number>();
  // Les pannes des serveurs d'OpenStreetMap (serveur et code, rien d'un client) : rendues avec l'erreur de l'outil, gardées dans l'historique.
  const notes: string[] = [];
  // Un serveur qui nous a refusés (403, 429) n'est plus appelé pendant l'échange.
  const refuses = new Set<string>();
  const appel = async (url: string, init: RequestInit = {}) => {
    const hote = new URL(url).host;
    if (refuses.has(hote)) return null;
    const attente = delaiAvant(derniers, hote, Date.now());
    if (attente) await new Promise((ok) => setTimeout(ok, attente));
    const entetes = hoteGoogle(hote) && cleGoogle ? { "X-Goog-Api-Key": cleGoogle, "Content-Type": "application/json" } : moteur === "ors" && hote === new URL(orsUrl).host ? { Authorization: cleOrs!, "Content-Type": "application/json" } : { "User-Agent": USER_AGENT, Accept: "application/json" };
    try {
      const rep = await fetch(url, { ...init, headers: { ...entetes, ...(init.headers || {}) }, signal: AbortSignal.timeout(10_000) });
      if (!rep.ok) {
        notes.push(`${hote} ${rep.status}`);
        if (rep.status === 403 || rep.status === 429) refuses.add(hote);
        console.error("agent : itinéraire", hote, rep.status);
        return null;
      }
      return await rep.json();
    } catch (err) {
      notes.push(`${hote} ${err instanceof Error ? err.name : "erreur"}`);
      return null;
    }
  };
  // Google Places si sa clé est posée, sinon openrouteservice, sinon Nominatim.
  // Chaque écriture essayée (nom, plage de l'hôtel) se lit d'abord dans les lieux connus de l'entreprise : Nominatim et Photon refusent les
  // serveurs de Supabase (403, 20.11.2026), les lieux habituels (plages, ports, aéroports, hôpitaux) sont relevés depuis un poste et posés
  // en base (scripts/lieux-geo).
  const chercher = async (v: string) => {
    const k = cleZone(v);
    if (k) {
      const connu = await sb.from("lieux_geo").select("lon, lat, label").eq("entite_id", entiteId).eq("cle", k).or(lieuValide).maybeSingle();
      if (connu.data) return { lon: Number(connu.data.lon), lat: Number(connu.data.lat), label: connu.data.label };
    }
    if (moteur === "google") return lirePlaces(await appel(GOOGLE_PLACES, { method: "POST", headers: { "X-Goog-FieldMask": CHAMPS_PLACES }, body: JSON.stringify(corpsPlaces(v)) }), v);
    if (moteur === "ors") return lireGeocode(await appel(`${orsUrl}${ORS_GEOCODE}?${parametresGeocode(v)}`, { method: "GET" }));
    // Photon n'est plus appelé : refusé à Supabase et faux une fois sur trois sur les lieux réels (20.11.2026).
    return lireNominatim(await appel(`${NOMINATIM_BASE}/search?${parametresNominatim(v)}`));
  };
  const geo = new Map<string, { lon: number; lat: number; label: string } | null>();
  const situer = async (lieu: string) => {
    const k = cleZone(lieu);
    if (geo.has(k)) return geo.get(k)!;
    let g: { lon: number; lat: number; label: string } | null = null;
    const connu = await sb.from("lieux_geo").select("lon, lat, label").eq("entite_id", entiteId).eq("cle", k).or(lieuValide).maybeSingle();
    if (connu.data) g = { lon: Number(connu.data.lon), lat: Number(connu.data.lat), label: connu.data.label };
    else {
      // Plusieurs écritures du même lieu (nom thaï, nom latin), puis, pour un hôtel absent d'OpenStreetMap, sa plage trouvée par le web.
      g = await situerLieu(lieu, {
        chercher,
        hotels: (await hotelsPour([lieu])) as { cle: string; zone: string; lieu: string }[],
        situerHotel: async (nom: string) => {
          const r = await situerWeb([nom]);
          return r && r[0] ? r[0] : null;
        },
      });
      if (g) await sb.from("lieux_geo").upsert({ entite_id: entiteId, cle: k, nom: lieu.slice(0, 160), lon: g.lon, lat: g.lat, label: g.label, origine: moteur === "google" ? "google" : moteur === "ors" ? "ors" : "nominatim", a_verifier: true }, { onConflict: "entite_id,cle" });
    }
    geo.set(k, g);
    return g;
  };
  const ors = moteur
    ? async (de: string, vers: string, coords: { de?: { lat: number; lon: number }; vers?: { lat: number; lon: number } } | null = null) => {
        try {
          // Les coordonnées d'un port données dans la table passent avant la recherche ; deux recherches l'une après l'autre (cadence).
          const a = coords && coords.de ? { ...coords.de, label: de } : await situer(de);
          const b = coords && coords.vers ? { ...coords.vers, label: vers } : await situer(vers);
          if (!a || !b) return null;
          // Gardé par position, dans le sens du trajet ; les libellés rendus sont ceux de cette demande.
          const cle = cleItineraire(a, b);
          const cache = await sb.from("trajets_ors").select("duree_min, distance_km, ferry, moteur").eq("entite_id", entiteId).eq("cle", cle).or(trajetValide).maybeSingle();
          if (cache.data) return { ...cache.data, de_trouve: a.label, vers_trouve: b.label };
          const r = moteur === "google" ? lireRoutes(await appel(GOOGLE_ROUTES, { method: "POST", headers: { "X-Goog-FieldMask": CHAMPS_ROUTES }, body: JSON.stringify(corpsRoutes(a, b)) })) : moteur === "ors" ? lireItineraire(await appel(`${orsUrl}${ORS_ITINERAIRE}`, { method: "POST", body: JSON.stringify(corpsItineraire(a, b)) })) : lireOsrm(await appel(`${OSRM_BASE}${cheminOsrm(a, b)}`));
          if (!r) return null;
          const ligne = { ...r, de_trouve: a.label, vers_trouve: b.label, moteur };
          await sb.from("trajets_ors").upsert({ entite_id: entiteId, cle, ...ligne }, { onConflict: "entite_id,cle" });
          return ligne;
        } catch (err) {
          console.error("agent : itinéraire", err instanceof Error ? err.message.slice(0, 120) : "");
          return null;
        }
      }
    : null;

  // Dernier recours : une durée trouvée par la recherche web (Haiku, sources contrôlées), toujours marquée estimation.
  const estimerWeb = async (de: string, vers: string) => {
    const p = parametresEstimation(de, vers);
    const m = await anthropic.beta.messages.create(p as Anthropic.Beta.MessageCreateParamsNonStreaming);
    appels.push({ usage: m.usage as unknown as Record<string, unknown>, modele: m.model });
    return lireEstimation(m);
  };

  // Situer des hôtels inconnus : l'usage « situer » de l'assistant (Haiku, recherche web, sources contrôlées), puis gardés dans hotels_lieux.
  const situerWeb = async (noms: string[]) => {
    const hotels = noms.map(nomPourRecherche).filter(Boolean);
    const [trajets, partenaires] = await Promise.all([charger("trajets"), charger("partenaires")]);
    const lieux = lieuxDuCatalogue({ trajets, partenaires });
    // Sans trajet au catalogue (Taxi), la recherche rend quand même la plage et la localité de l'hôtel.
    if (!hotels.length) return null;
    const ra = reglagesAssistant(reglages);
    const p = parametresSituer(promptSituer({ hotels, lieux, lieu: ra.lieu }), hotels.length);
    let m = await anthropic.beta.messages.create(p as Anthropic.Beta.MessageCreateParamsNonStreaming);
    appels.push({ usage: m.usage as unknown as Record<string, unknown>, modele: m.model });
    let lu = lireSituer(m);
    if (!lu.ok && lu.statut === "pause") {
      const avant = lu.sources || [];
      m = await anthropic.beta.messages.create({ ...p, messages: [...(p.messages as unknown[]), { role: "assistant", content: m.content }] } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      appels.push({ usage: m.usage as unknown as Record<string, unknown>, modele: m.model });
      lu = lireSituer(m);
      lu.sources = [...avant, ...(lu.sources || [])];
    }
    if (!lu.ok) return null;
    const v = validerSituer(lu.valeur, { hotels, lieux, sources: lu.sources || [] });
    for (const h of v.hotels) {
      if (!h.source) continue;
      const cle = h.nom.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      await sb.from("hotels_lieux").upsert({ entite_id: entiteId, cle, nom: h.nom.slice(0, 120), lieu: h.lieu, zone: h.zone, localite: h.localite, source_url: h.source.url.slice(0, 500), source_titre: (h.source.titre || "").slice(0, 160), certitude: h.certitude, verifie: false }, { onConflict: "entite_id,cle" });
    }
    return v.hotels;
  };

  const ra = reglagesAssistant(reglages);
  const aujourdhui = dateBangkok();
  let dossierRelie = null;
  if (conv!.dossier_id) {
    const d = await sb.from("dossiers").select("id, ref").eq("id", conv!.dossier_id).maybeSingle();
    if (d.data) dossierRelie = { ref_courte: refDe("D", d.data.id), reference: d.data.ref };
  }
  const prestataires = ((await charger("partenaires")) as { nom: string }[]).map((p) => String(p.nom || "").trim()).filter((x) => x.length > 2);
  const droits: string[] = perms.data || [];
  const systeme = consignes({ entreprise: ent.data?.nom || "", reglages, lieu: ra.lieu, prenomEquipe: ra.responsable, partenaires: droits.includes("partenaires.lire"), nets: droits.includes("partenaires.lire") && droits.includes("partenaires.nets") });
  const contexte = contexteDuJour({ aujourdhui, jour: jourSemaine(aujourdhui), lieuCourt: lieuCourt(ra.lieu), dossier: dossierRelie });
  // L'historique tel qu'il est gardé (blocs « fichier »), puis tel qu'il part chez Claude (images et documents).
  const gardes = historique(debutValide([...(anciens.data || [])].reverse()));
  const messages = historiquePourClaude(gardes, donnees);
  // Les corrections de l'équipe dans cette entreprise, d'avant l'ouverture de la conversation (le bloc reste le même d'un message à l'autre,
  // donc en cache). Sans la migration 54 ou en cas d'erreur : rien, l'agent marche comme avant.
  const premierTexte = (() => {
    const m = (gardes as { role: string; content: unknown }[]).find((x) => x.role === "user" && Array.isArray(x.content) && x.content.some((b: { type: string }) => b.type === "text"));
    return m ? (m.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text || "").join(" ") : message;
  })();
  const lus = await sb.from("agent_apprentissages").select("id, genre, contexte, avant, apres, cree_le").eq("entite_id", entiteId).lte("cree_le", conv!.cree_le || new Date().toISOString()).order("cree_le", { ascending: false }).limit(80);
  if (lus.error && !tableAbsente(lus.error)) console.error("agent : apprentissages", lus.error.message);
  const appris = lus.error ? "" : blocApprentissages(lus.data || [], { qui: ra.responsable, premierMessage: premierTexte });
  const memo = memoDepuis([...messages, { role: "user", content: message ? [{ type: "text", text: message }] : [] }], { signer: signe(reglages), prestataires, entreprise: ent.data?.nom || "", prenoms: [ra.responsable, "Anaïs", "Nani"].filter(Boolean) });
  // Les pièces jointes que l'agent peut citer (proposer_import_brochure) et les droits de la personne (l'import demande « partenaires.ecrire »
  // et « partenaires.prix »).
  // historique, entreprise : pour les cartes « reglage » et « amelioration » (ameliorer.js). L'historique est le tableau que l'échange
  // complète en place : une pièce jointe ou un nom de client vus plus tôt dans la conversation y sont.
  const ctx = { historique: messages, entreprise: ent.data?.nom || "", fichiers: fichiersConv.map((f) => ({ id: f.id, nom: f.nom, media_type: f.media_type })), permissions: perms.data || [], charger, chercherClients, dossierPour, parRef, hotelsPour, reglages, ors, simule: simules ? tempsSimule : null, estimerWeb, situerWeb, notes, moteur, maintenant: () => Date.now() };
  const modele = Deno.env.get("AGENT_MODELE") || MODELE_DEFAUT;

  const debut = Date.now();
  const flux = new TransformStream<Uint8Array, Uint8Array>();
  const ecrivain = flux.writable.getWriter();
  const enc = new TextEncoder();
  const envoyer = (ev: Record<string, unknown>) => ecrivain.write(enc.encode(`${JSON.stringify(ev)}\n`)).catch(() => {});

  // Ajoute un message à l'historique et à la base (avec la session de la personne). Un échec d'écriture arrête l'échange : sans historique
  // complet, la conversation ne pourrait pas reprendre.
  // `pourClaude` : ce qui part à l'appel quand il diffère de ce qui est gardé (les blocs « fichier » deviennent des images et des documents).
  const garder = async (role: "user" | "assistant", contenu: unknown, pourClaude: unknown = contenu) => {
    messages.push({ role, content: pourClaude });
    const { error } = await sb.from("agent_messages").insert({ conversation_id: conv!.id, role, contenu });
    if (error) throw new Error(`message non enregistré : ${error.message}`);
  };

  (async () => {
    let statut = "ok";
    let dernierTexte = "";
    let motifErreur = "";
    try {
      await envoyer({ t: "conversation", id: conv!.id, titre: conv!.titre, dossier_id: conv!.dossier_id, ...(waId ? { whatsapp_conversation_id: waId } : {}) });
      const contenuPersonne = [...blocsNouveaux, ...(message ? [{ type: "text", text: message }] : [])];
      await garder("user", contenuPersonne, contenuPourClaude(contenuPersonne, donnees));
      const garderCarte = async (carte: { genre: string; titre: string; donnees: unknown; avertissements?: string[] }) => {
        const c = await sb.from("agent_cartes").insert({ conversation_id: conv!.id, genre: carte.genre, titre: carte.titre, donnees: carte.donnees, avertissements: carte.avertissements || [] }).select("id, genre, titre, donnees, avertissements, statut, cree_le").single();
        return c.error ? null : c.data;
      };
      const r = await tourner({ anthropic, modele, systeme, appris, contexte, messages, ctx, memo, garder, garderCarte, envoyer, appels, debut });
      statut = r.statut;
      dernierTexte = r.dernierTexte;
    } catch (err) {
      // Crédit d'Anthropic épuisé (HTTP 402, « billing_error ») : un message clair à l'écran et une alerte aux administratrices.
      if (estCreditEpuise(err)) statut = "credit_epuise";
      else if (err instanceof Anthropic.RateLimitError) statut = "occupe";
      else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) statut = "cle_refusee";
      else if (err instanceof Anthropic.APIError) statut = "erreur_api";
      else statut = "erreur";
      // Le motif d'un refus d'Anthropic (« tools.3.input_schema: … ») : aucune donnée de client, seulement la forme de la requête. Il va à
      // l'écran et au journal (statut « erreur_api_400 »), pour qu'une panne se diagnostique sans lire les journaux de la fonction.
      const code = err instanceof Anthropic.APIError && err.status ? `_${err.status}` : "";
      if (statut === "erreur_api") statut = `erreur_api${code}`;
      const detail = err instanceof Error ? err.message.replace(/\s+/g, " ").slice(0, 300) : "";
      console.error("agent :", statut, detail);
      if (statut.startsWith("erreur")) motifErreur = detail;
      await envoyer({ t: "erreur", erreur: statut === "credit_epuise" ? "credit_epuise" : statut === "occupe" ? "occupe" : statut === "cle_refusee" ? "non_configure" : "indisponible", ...(statut.startsWith("erreur") && detail ? { detail } : {}) });
    }
    // Après une panne, l'aperçu de la conversation dit son motif (le prochain échange réussi le remplace).
    await sb.from("agent_conversations").update({ maj_le: new Date().toISOString(), apercu: (motifErreur ? `Erreur : ${motifErreur}` : dernierTexte || message).replace(/\s+/g, " ").slice(0, 200) }).eq("id", conv!.id);
    const ligne = ligneJournal({ userId, entiteId, statut, appels, dureeMs: Date.now() - debut });
    const { error: errJ } = await admin.from("assistant_journal").insert(ligne);
    if (errJ) console.error("journal de l'agent non écrit :", errJ.message);
    // Seuil d'alerte passé avec cet échange (ou crédit épuisé) : la fonction « rappels » prévient, une fois par alerte, en tâche de fond.
    if (statut === "credit_epuise" || etatBudget({ cout: coutDuMois + (Number(ligne.cout_estime_usd) || 0), plafond, seuil }).alerte) alerterEnFond(statut === "credit_epuise" ? { credit_epuise: true } : {});
    await envoyer({ t: "fin", statut, cout_usd: ligne.cout_estime_usd, modele: ligne.modele });
    await ecrivain.close().catch(() => {});
  })();

  return new Response(flux.readable, { headers: { ...entetes(req, "application/x-ndjson; charset=utf-8"), "Cache-Control": "no-store" } });
});
