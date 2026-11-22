// Fonction « agent » : l'assistant de l'onglet « Assistant », avec qui on discute et qui s'appuie sur des outils (catalogue, horaires, hôtels,
// temps de route, planning, clients, dossiers) pour planifier et proposer. L'outil l'appelle avec la session de la personne : toutes les
// lectures et écritures passent par les règles RLS, comme dans l'outil. Seul le journal (compte et coût) s'écrit avec la clé de service.
//
// Ce qui part chez Anthropic : les messages de la personne avec leurs pièces jointes (fichiers.js) et ce que les outils rendent (tarifs de vente, horaires, lieux, clients et
// dossiers de l'entreprise). Jamais un net, une marge ni un nom de prestataire : les outils les retirent (outils.js). Rien n'est écrit dans
// les dossiers : les propositions sont des cartes que la personne valide dans l'écran.
//
// Espace unifié Secret et Taxi (unifie.js, migration 63) : quand la conversation est rangée chez Secret ou Taxi et que la personne a aussi
// « partenaires.lire » et « dossiers.ecrire » dans l'autre, le catalogue, les clients et les dossiers se lisent dans les deux entreprises,
// toujours avec sa session (la RLS limite ce qu'elle voit). La conversation reste sous l'entreprise active. ZTP n'y entre jamais.
//
// Boîte WhatsApp (whatsapp-lecture.js, migration 67) : dans l'Assistant de Secret ou de Taxi, pour qui administre cette entreprise
// (whatsapp_admin, lu avec sa session), trois outils de lecture : chercher_conversations, lire_conversation, a_faire_whatsapp. Les
// conversations et les messages se lisent avec `sb` : la RLS de la migration 63 décide, jamais avec la clé de service. Seul un contact réglé
// « jamais » (Contact personnel) n'est ni cherché ni lu. Partenaire et apporteur se lisent comme un client (demande de
// Jérémy du 21.11.2026, migration 69 : plus d'exclusion par type ni par numéro de fiche partenaire). Ce qui part alors chez Anthropic : le
// nom de profil et le client relié (prénom, nom, référence), la référence du dossier relié, le texte des messages lus et des extraits
// trouvés (numéros, comptes et IBAN masqués sur le texte entier, avant toute coupe ; un prix écrit par le client, ou un net et une
// commission écrits par un partenaire, peuvent y figurer), le type et la légende des médias, le titre des promesses échues, le libellé et
// la date des trajets en bateau et le solde dû (prix de vente moins reçu). Jamais un numéro de téléphone, un fichier, ni un net, une
// commission ou une fiche partenaire lus dans les tables. Ces résultats ne repartent pas au message suivant (retirerLecturesWhatsApp).
//
// Apporteur d'affaires (apporteur.js, PR D, migration 68) : quand la conversation de l'Assistant est liée à une conversation WhatsApp dont le
// contact est de type « apporteur », l'agent reçoit une consigne (un dossier par client, au nom du client, jamais d'accord ni de commission)
// et une référence de fiche. Le type, la fiche reliée et la fiche « apporteur » de l'autre entreprise (même numéro) se lisent
// avec la session de la personne, jamais partenaires_prives. Ce qui part en plus chez Anthropic : cette consigne, la référence « A-… » et
// les noms d'entreprise (Secret, Taxi) où la fiche manque ; jamais le nom ni le numéro de la fiche.
//
// Vouchers (vouchers.js, 21.11.2026) : dans Secret ou Taxi, pour qui lit les réservations de l'entreprise active (jamais « vouchers.seul »),
// l'outil trouver_vouchers lit avec `sb` les réservations visées (référence, date, heure, lieu, libellé, statut), leurs dossiers et leurs
// clients. Ce qui part chez Anthropic : la référence, la date, l'heure, le service (sans nom de prestataire), le prénom et le nom du client,
// le dossier et ce qui manque au voucher. Jamais un prix, un net, une commission ni un prestataire. L'image du voucher se fait dans le
// navigateur ; l'envoi demande le clic de la personne.
//
// Réponse en flux NDJSON (une ligne JSON par événement) : { t: "conversation" | "etape" | "texte" | "planning" | "vouchers" | "carte" | "fin" | "erreur" }.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { LIMITE_JOUR_DEFAUT, LONGUEUR_MAX, MODELE_DEFAUT, blocApprentissages, consignes, contexteDuJour, controlerAcces, completerOrphelins, sansReflexionPassee, debutValide, historique, ligneJournal, signe, titreDepuis } from "./prompt.js";
import { lireApprentissages } from "./apprentissages.js";
import { ajouterNoms, choisirLigne, clesHotelPossibles, memoDepuis, motifNom, motifTelephone, netsPourControle, peutTrouverVouchers, prefixeRef, refDe, retenirLectures, sansAccents, dossierPourControle, clientConfirme, clientPourPrixDeNani, clientProbable, prixClientValides, MESSAGES_PRIX_CLIENT, tempsSimule } from "./outils.js";
import { tourner } from "./boucle.js";
import { ENTREPRISES_UNIFIEES, modeUnifie, permissionsOutils, unifieAllume } from "./unifie.js";
import { CONTACTS_INTERNES, CONTACTS_NOMMES, MARQUE_PROMESSE, borneJour, dateBangkok as jourBangkok, retirerConversationsJointes, retirerLecturesWhatsApp, whatsappPermis } from "./whatsapp-lecture.js";
import { NOMINATIM_BASE, ORGANISATIONS_OSRM, ORS_BASE, ORS_GEOCODE, ORS_ITINERAIRE, OSRM_BASE, USER_AGENT, cheminOsrm, cleItineraire, cleZone, corpsItineraire, delaiAvant, lireGeocode, lireItineraire, lireNominatim, lireOsrm, parametresGeocode, parametresNominatim, situerLieu, VALIDITE_JOURS, VALIDITE_GOOGLE_JOURS, GOOGLE_PLACES, GOOGLE_ROUTES, CHAMPS_PLACES, CHAMPS_ROUTES, corpsPlaces, corpsRoutes, lirePlaces, lireRoutes } from "./temps.js";
import { lireEstimation, parametresEstimation } from "./estimation.js";
import { debutMois, estCreditEpuise, etatBudget, plafondRetenu, reprise, tableAbsente } from "../assistant/budget.js";
import { blocApporteur, contactApporteur, infoApporteur, nomsABloquer } from "./apporteur.js";
import { dernierPrixAccepte, discussionPleine, resumeReport } from "./discussion-pleine.js";
import { MESSAGES_MAX as MESSAGES_MAX_WA, MODES_DEMANDE as MODES_WA, QUESTION_MAX as QUESTION_MAX_WA, mediasAJoindre, texteDepuisWhatsApp, titreWhatsApp } from "./whatsapp.js";
import { blocFichier, fichiersRetenus, historiquePourClaude, contenuPourClaude, titreFichiers, verifierPieces } from "./fichiers.js";
import { dateBangkok, debutJourBangkok, jourSemaine, lieuCourt, reglagesAssistant } from "../assistant/calc.js";
import { lieuxDuCatalogue, lireSituer, nomPourRecherche, parametresSituer, promptSituer, validerSituer } from "../assistant/itineraire.js";

const ORIGINES = (Deno.env.get("ASSISTANT_ORIGINES") || "https://gestion.zwaldtravelplanner.com").split(",").map((x) => x.trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Une référence de dossier pour un filtre ilike de PostgREST, qui prend « * » pour « % » (revue de la PR 295) : une référence avec un joker
// (« * », « % », « _ ») ou une barre oblique inverse n'est pas cherchée, la comparaison reste exacte (casse ignorée). 2 à 30 caractères.
const refSansJoker = (v: unknown) => {
  const t = String(v || "").trim();
  return t.length >= 2 && t.length <= 30 && !/[*%_\\,()]/.test(t) ? t : "";
};
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

// Les colonnes lues d'une conversation WhatsApp, de la plus récente migration à la plus ancienne (repli sur l'erreur 42703).
const COLONNES_WA = [
  "id, telephone, nom, entite_id, client_id, dossier_id, reponses, type_contact, partenaire_id, nom_source, tri, avancee",
  "id, telephone, nom, entite_id, client_id, dossier_id, reponses, type_contact, partenaire_id, nom_source",
  "id, telephone, nom, entite_id, client_id, dossier_id, reponses, type_contact, partenaire_id",
  "id, telephone, nom, entite_id, client_id, dossier_id, reponses",
];

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
  const waMode = MODES_WA.includes(demande.whatsapp_mode) ? demande.whatsapp_mode : "creer";
  // Une demande dans une conversation de l'Assistant déjà liée (PR 297, point 4) : l'échange frais est joint, la liaison est contrôlée
  // plus bas (conversation de la personne, liée à cette conversation WhatsApp). Une seule discussion par conversation WhatsApp (règle de
  // Jérémy du 22.11.2026) : créer et mettre à jour le dossier passent aussi dans la conversation déjà liée.
  const waBrut = typeof demande.whatsapp_conversation_id === "string" && UUID.test(demande.whatsapp_conversation_id) ? demande.whatsapp_conversation_id : null;
  const waSuite = !!waBrut && !!demande.conversation_id;
  const waId = waBrut && (!demande.conversation_id || waSuite) ? waBrut : null;
  // « Demander à l'assistant » (PR B) : la question tapée par la personne est obligatoire ; la conversation est jointe comme pour un dossier.
  const waQuestion = waId && waMode === "question" ? message : "";
  if (waId && waMode === "question" && (!waQuestion || waQuestion.length > QUESTION_MAX_WA)) return json({ erreur: "message_invalide" }, 400);
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
  const userId = qui.user.id;

  const [regl, perms, echanges, mois, ent, budget] = await Promise.all([
    sb.from("reglages").select("valeur").eq("entite_id", entiteId).maybeSingle(),
    sb.rpc("permissions_dans", { e: entiteId }),
    admin.from("assistant_journal").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("usage", "agent").gte("cree_le", debutJourBangkok()),
    // Le plafond du mois compte toute la dépense de l'assistant (tous usages, toutes personnes) : il protège le crédit.
    admin.rpc("assistant_cout_depuis", { debut: debutMois() }),
    sb.from("entites").select("nom, organisation_id, slug").eq("id", entiteId).maybeSingle(),
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
  // Espace unifié : l'autre entreprise (Secret ou Taxi) de la même organisation, ses droits et ses réglages, lus avec la session. Éteint
  // sans le secret AGENT_UNIFIE=1 ; une lecture refusée, des droits manquants ou l'agent éteint dans l'autre entreprise laissent
  // l'Assistant tel qu'avant, limité à l'entreprise active.
  let unifie: { entites: { id: string; slug: string; nom: string }[]; permissionsPar: Record<string, string[]> } | null = null;
  let reglagesAutre: Record<string, unknown> | null = null;
  const interrupteur = Deno.env.get("AGENT_UNIFIE") || "";
  if (unifieAllume(interrupteur) && ent.data && ENTREPRISES_UNIFIEES.includes(ent.data.slug) && ent.data.organisation_id) {
    const autres = await sb.from("entites").select("id, slug, nom, organisation_id").eq("organisation_id", ent.data.organisation_id).in("slug", ENTREPRISES_UNIFIEES).neq("id", entiteId);
    const autre = autres.error ? null : (autres.data || []).find((x) => x.slug !== ent.data!.slug) || null;
    if (autre) {
      const [pa, ra] = await Promise.all([sb.rpc("permissions_dans", { e: autre.id }), sb.from("reglages").select("valeur").eq("entite_id", autre.id).maybeSingle()]);
      const valeurAutre = !ra.error && ra.data ? ra.data.valeur : null;
      if (!pa.error) unifie = modeUnifie({ active: { id: entiteId, ...ent.data }, autre, permissions: perms.data || [], permissionsAutre: pa.data || [], reglagesAutre: valeurAutre, interrupteur });
      if (unifie) reglagesAutre = valeurAutre;
    }
  }
  const idsEntites = unifie ? unifie.entites.map((e) => e.id) : [entiteId];
  // Le filtre d'entreprise d'une lecture : les deux entreprises en mode unifié, sinon l'entreprise active comme avant.
  const dans = (q: any, colonne = "entite_id") => (unifie ? q.in(colonne, idsEntites) : q.eq(colonne, entiteId));
  let waDossier: string | null = null;
  let waConv: { nom: string | null; telephone: string } | null = null;
  // La conversation WhatsApp liée (celle de la demande, ou celle d'une conversation de l'Assistant déjà liée), pour l'apporteur (PR D).
  let waLiee: Record<string, any> | null = null;
  // La conversation WhatsApp jointe ou liée telle que la personne la lit, même sans droit d'écrire (revue de sécurité de la PR 299) : son
  // réglage (Contact personnel : l'échange joint plus tôt ne repart plus), son type et son nom (contrôle de la réponse au client).
  let waLue: Record<string, any> | null = null;
  // Les colonnes des migrations 70 (source du nom) et 68 (type du contact, fiche reliée) ; sans elles, la lecture d'avant (le contact n'est
  // pas typé, son nom est lu comme un nom de profil).
  // Puis le tri et les faits des étapes (migration 105) : sans eux, le contact n'est jamais un client probable. Chaque repli garde ce que la
  // migration d'avant a ajouté (relecture de la PR 318 : nom_source n'est jamais perdu avec la migration 105).
  const lireWa = async (id: string) => {
    let r: any = null;
    for (const cols of COLONNES_WA) {
      r = await sb.from("whatsapp_conversations").select(cols).eq("id", id).maybeSingle();
      if (!(r.error && r.error.code === "42703")) break;
    }
    return r;
  };
  // La personne n'administre pas l'entreprise de la conversation (whatsapp_peut_ecrire, migration 63) : la question passe en lecture seule,
  // sans liaison ni carte ; créer ou mettre à jour un dossier est refusé.
  let waEcrit = false;
  if (waId) {
    // Après les contrôles d'accès (agent allumé, droits, limites) : rien n'est lu ni téléchargé pour une demande refusée.
    // Lue avec la session : une conversation WhatsApp que la personne ne peut pas lire n'existe pas pour elle. Elle est rangée dans
    // l'entreprise de l'Assistant, ou encore à trier (lot 2 du 20.11.2026 : on crée le dossier sans ranger d'abord, la conversation se range
    // à la validation). Une conversation à trier n'entre que dans l'Assistant de Secret ou de Taxi, jamais dans celui d'une autre entreprise.
    const wc: any = await lireWa(waId);
    if (wc.error) return json({ erreur: "base" }, 500);
    if (!wc.data) return json({ erreur: "whatsapp_introuvable" }, 404);
    // Contact personnel (migration 60) : rien de lui ne part chez Anthropic, dans aucun mode. Refusé avant de lire un seul message.
    if (wc.data.reponses === "jamais") return json({ erreur: "contact_personnel" }, 403);
    if (waSuite) {
      const lie = await sb.from("agent_conversations").select("id, entite_id, whatsapp_conversation_id, statut").eq("id", demande.conversation_id).maybeSingle();
      if (lie.error) return json({ erreur: "base" }, 500);
      // Une discussion archivée ne se rouvre pas (relecture de la PR 318), comme à l'écran (conversationLiee).
      if (!lie.data || lie.data.entite_id !== entiteId || lie.data.whatsapp_conversation_id !== waId || lie.data.statut === "archivee") return json({ erreur: "conversation_introuvable" }, 404);
    }
    const peut = await sb.rpc("whatsapp_peut_ecrire", { p_conversation: waId });
    if (peut.error) console.error("agent : whatsapp_peut_ecrire", peut.error.message);
    waEcrit = !peut.error && peut.data === true;
    if (!waEcrit && waMode !== "question") return json({ erreur: "whatsapp_lecture_seule" }, 403);
    if (wc.data.entite_id !== entiteId) {
      const ent = wc.data.entite_id === null ? await sb.from("entites").select("slug").eq("id", entiteId).maybeSingle() : null;
      if (!ent || ent.error || !ent.data || !["secret", "taxi"].includes(ent.data.slug)) return json({ erreur: "whatsapp_introuvable" }, 404);
    }
    // Ligne « non transmis » (migration 100) : jamais envoyée à l'Assistant.
    const wm = await sb.from("whatsapp_messages").select("sens, texte, medias, envoye_le, modifie_le, supprime_le").eq("conversation_id", waId).neq("type", "non_transmis").order("envoye_le", { ascending: false }).limit(MESSAGES_MAX_WA);
    if (wm.error) return json({ erreur: "base" }, 500);
    const messagesWa = wm.data || [];
    // Seulement les pièces cochées par la personne dans l'écran (rien par défaut) : une capture de virement ou de compte ne part jamais
    // d'office chez Anthropic. Téléchargées avec la session (politique du stockage « whatsapp ») ; chaque fichier est contrôlé seul.
    const fichiers: { nom: string; media_type: string; data: string }[] = [];
    let ecartes = 0;
    for (const f of mediasAJoindre(messagesWa, { choisis: demande.whatsapp_pieces })) {
      const { data: blob, error } = await sb.storage.from("whatsapp").download(f.chemin);
      if (error || !blob) {
        ecartes++;
        continue;
      }
      const octets = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode(...octets.subarray(i, i + 0x8000));
      const piece = { nom: f.nom, media_type: f.media_type, data: btoa(bin) };
      if (verifierPieces([...fichiers, piece]).ok) fichiers.push(piece);
      else ecartes++;
    }
    const dossierWa = (waMode === "maj" || waMode === "question") && wc.data.dossier_id ? (await sb.from("dossiers").select("id, ref").eq("id", wc.data.dossier_id).eq("entite_id", entiteId).maybeSingle()).data : null;
    if (waMode === "maj" && !dossierWa) return json({ erreur: "dossier_introuvable" }, 404);
    demande.fichiers = fichiers;
    message = texteDepuisWhatsApp({ mode: waMode, conv: wc.data, messages: messagesWa, dossier: dossierWa, joints: fichiers.length, ecartes, max: LONGUEUR_MAX, apporteur: waEcrit && contactApporteur(wc.data), question: waQuestion, lectureSeule: !waEcrit });
    // Dans une conversation existante, les pièces se contrôlent plus bas avec celles qu'elle garde déjà (nombre et taille).
    controle = conversationId ? null : verifierPieces(demande.fichiers);
    waDossier = dossierWa ? dossierWa.id : null;
    waConv = wc.data;
    waLue = wc.data;
    // En lecture seule, aucune carte : l'apporteur ne sert pas.
    if (waEcrit) waLiee = wc.data;
  }

  // La conversation : nouvelle, ou une des miennes (RLS : une conversation d'une autre personne n'est pas lisible).
  let conv: { id: string; titre: string; dossier_id: string | null; cree_le?: string; whatsapp_conversation_id?: string | null } | null = null;
  if (conversationId) {
    // whatsapp_conversation_id : la migration 67 ; sans elle, la lecture d'avant.
    const COL_CONV_AGENT = "id, titre, dossier_id, entite_id, cree_le";
    let c: any = await sb.from("agent_conversations").select(`${COL_CONV_AGENT}, whatsapp_conversation_id`).eq("id", conversationId).maybeSingle();
    if (c.error && c.error.code === "42703") c = await sb.from("agent_conversations").select(COL_CONV_AGENT).eq("id", conversationId).maybeSingle();
    if (c.error) return json({ erreur: "base" }, 500);
    if (!c.data || c.data.entite_id !== entiteId) return json({ erreur: "conversation_introuvable" }, 404);
    conv = c.data;
    // Une conversation déjà liée (message suivant, sans échange joint) : son contact WhatsApp relu avec la session. Illisible : rien.
    // Revue de la PR 298 : jamais quand la demande porte déjà une conversation WhatsApp (lecture seule comprise), et seulement si la personne
    // écrit encore dans cette conversation (whatsapp_peut_ecrire) ; sinon ni consigne apporteur, ni exemption.
    const lieeId = c.data.whatsapp_conversation_id;
    if (!waLiee && !waId && typeof lieeId === "string" && UUID.test(lieeId)) {
      const [w, peutLiee] = await Promise.all([lireWa(lieeId), sb.rpc("whatsapp_peut_ecrire", { p_conversation: lieeId })]);
      if (w.error) console.error("agent : conversation WhatsApp liée", w.error.message);
      if (peutLiee.error) console.error("agent : whatsapp_peut_ecrire (conversation liée)", peutLiee.error.message);
      if (!w.error) waLue = w.data || null;
      if (!w.error && !peutLiee.error && peutLiee.data === true) waLiee = w.data || null;
    }
  } else {
    const dossierId = waDossier || (typeof demande.dossier_id === "string" && UUID.test(demande.dossier_id) ? demande.dossier_id : null);
    const titre = waId ? titreWhatsApp(waConv) : titreDepuis(message || titreFichiers(controle?.fichiers || []));
    // En lecture seule, la conversation de l'Assistant n'est pas liée : rien ne pourrait s'écrire sur la conversation WhatsApp.
    const c = await sb.from("agent_conversations").insert({ entite_id: entiteId, titre, dossier_id: dossierId, ...(waId && waEcrit ? { whatsapp_conversation_id: waId } : {}) }).select("id, titre, dossier_id, cree_le").single();
    if (c.error) return json({ erreur: c.error.code === "42P01" ? "migration_manquante" : "base" }, 500);
    conv = c.data;
  }
  // Une discussion liée qui se remplit (relecture de la PR 318, discussion-pleine.js) : 20 pièces ou 30 Mo, ou un historique qui perdrait son
  // début. Elle est archivée et une nouvelle, liée à la même conversation WhatsApp, la remplace, ouverte par un court résumé (client,
  // dossiers, dernier prix de vente accepté). Seulement quand la personne écrit encore dans cette conversation WhatsApp (waLiee).
  let remplace: string | null = null;
  if (conversationId && conv && conv.whatsapp_conversation_id && waLiee && waLiee.id === conv.whatsapp_conversation_id) {
    const [nb, fx] = await Promise.all([
      sb.from("agent_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id),
      sb.from("agent_fichiers").select("taille").eq("conversation_id", conv.id).limit(100),
    ]);
    const gardes = fx.error ? [] : fx.data || [];
    const plein = nb.error ? "" : discussionPleine({ messages: nb.count || 0, fichiers: { nombre: gardes.length, taille: gardes.reduce((s: number, f: any) => s + (Number(f.taille) || 0), 0) }, nouveaux: Array.isArray(demande.fichiers) ? demande.fichiers : [] });
    if (plein) {
      const idsDossiers = [...new Set([waLiee.dossier_id, conv.dossier_id].filter((x) => typeof x === "string" && UUID.test(x)))];
      const [cl, ds, ct] = await Promise.all([
        waLiee.client_id ? sb.from("clients").select("prenom, nom").eq("id", waLiee.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        idsDossiers.length ? sb.from("dossiers").select("ref").in("id", idsDossiers) : Promise.resolve({ data: [], error: null }),
        sb.from("agent_cartes").select("genre, statut, donnees, cree_le, decide_le").eq("conversation_id", conv.id).eq("statut", "validee").order("cree_le", { ascending: false }).limit(20),
      ]);
      const ancien = conv;
      const arch = await sb.from("agent_conversations").update({ statut: "archivee" }).eq("id", ancien.id);
      if (arch.error) return json({ erreur: "base" }, 500);
      const neuve = await sb.from("agent_conversations").insert({ entite_id: entiteId, titre: ancien.titre, dossier_id: ancien.dossier_id, whatsapp_conversation_id: ancien.whatsapp_conversation_id }).select("id, titre, dossier_id, cree_le").single();
      if (neuve.error) {
        await sb.from("agent_conversations").update({ statut: "ouverte" }).eq("id", ancien.id);
        return json({ erreur: "base" }, 500);
      }
      remplace = ancien.id;
      conv = { ...neuve.data, whatsapp_conversation_id: ancien.whatsapp_conversation_id };
      const resume = resumeReport({ client: cl.error ? null : cl.data, dossiers: ds.error ? [] : ds.data || [], prix: ct.error ? null : dernierPrixAccepte(ct.data || []), raison: plein });
      message = message ? `${resume}\n\n${message}` : resume;
    }
  }
  // Apporteur d'affaires (apporteur.js) : la fiche reliée et, en espace unifié, la fiche « apporteur » de l'autre entreprise, lues avec la
  // session (RLS : celles que la personne voit). Une lecture refusée laisse l'apporteur sans fiche : les dossiers se créent sans apporteur.
  let apporteur: Record<string, any> | null = null;
  if (contactApporteur(waLiee)) {
    const entitesApp = unifie ? unifie.entites : [{ id: entiteId, slug: ent.data?.slug || "", nom: ent.data?.nom || "" }];
    const COL_FICHE = "id, nom, categorie, entite_id, actif, contact";
    const [rel, cand] = await Promise.all([
      waLiee!.partenaire_id ? sb.from("partenaires").select(COL_FICHE).eq("id", waLiee!.partenaire_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      sb.from("partenaires").select(COL_FICHE).eq("categorie", "apporteur").in("entite_id", entitesApp.map((e) => e.id)).limit(200),
    ]);
    if (rel.error) console.error("agent : fiche de l'apporteur", rel.error.message);
    if (cand.error) console.error("agent : fiches apporteur", cand.error.message);
    apporteur = infoApporteur({ conv: waLiee, reliee: rel.error ? null : rel.data, candidats: cand.error ? [] : cand.data || [], entites: entitesApp });
  }
  const anciens = await sb.from("agent_messages").select("role, contenu").eq("conversation_id", conv!.id).order("id", { ascending: false }).limit(400);
  if (anciens.error) return json({ erreur: "base" }, 500);
  // Les pièces jointes de la conversation (migration 55) : leurs métadonnées, puis les données de celles qui partent à cet appel. Sans la
  // table (migration pas encore passée), une conversation sans fichier marche comme avant ; un envoi de fichier est refusé.
  // Un refus après la création d'une nouvelle conversation la retire : pas de conversation vide dans la liste.
  const abandonner = async (corps: Record<string, unknown>, status: number) => {
    if (!conversationId || remplace) await sb.from("agent_conversations").delete().eq("id", conv!.id);
    // La discussion pleine remplacée redevient celle de la conversation WhatsApp : rien n'a été fait dans la nouvelle.
    if (remplace) await sb.from("agent_conversations").update({ statut: "ouverte" }).eq("id", remplace);
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
  // Le droit nets dans l'entreprise d'un dossier : en mode unifié, les droits de la personne dans CETTE entreprise.
  const netsDans = (id: string) => {
    if (!unifie) return droitsNets;
    const p = unifie.permissionsPar[id] || [];
    return p.includes("partenaires.lire") && p.includes("partenaires.nets");
  };
  const NETS_RES_AVANT_57 = "reservation_id, net_prevu, net_paye, paye_le, commission_prevue, commission_recue, commission_recue_le";
  const COLONNES: Record<string, string> = {
    // entite_id : l'entreprise de chaque ligne, pour l'espace unifié (outils.js : entreprise du service, droits de la ligne). Les outils
    // ne le renvoient jamais tel quel.
    prestations: "id, famille, groupe, libelle, libelle_en, prix_vente, unite, sur_place, actif, partenaire_id, entite_id",
    trajets: "id, de, vers, mode, depart, arrivee, duree, prix_adulte, prix_enfant, bebe, periode, fenetres, actif, partenaire_id, entite_id",
    // regles : le mode de règlement du partenaire (« sur place » ou chez nous), lu par les outils, jamais renvoyé tel quel.
    partenaires: "id, nom, actif, regles, entite_id",
    // Les nets et la règle de commission : vides pour qui n'a pas le droit « partenaires.nets » (RLS), et les outils ne les lisent qu'avec ce
    // droit (outils.js, voitNets). Avec lui, ils partent chez Claude (décision de Jérémy du 20.11.2026), jamais vers un client.
    prestations_nets: "prestation_id, net, net_enfant",
    trajets_nets: "trajet_id, net_adulte, net_enfant",
    partenaires_prives: "partenaire_id, commission_regle, commissions",
    hotels_lieux: "cle, nom, lieu, zone, localite, source_url, certitude, verifie, entite_id",
    temps_trajets: "de, vers, mode, duree_min, ferry, marge_min, source, source_date, a_verifier",
    liaisons_ferry: "nom, cote_ile, port_ile, port_continent, port_ile_coord, port_continent_coord, duree_min, a_verifier",
    dossiers: "id, ref, client_id, date_depart, date_retour, annule, entite_id",
    // `vol` : seulement le numéro de vol de la réservation (details->>vol), pas le reste de `details`.
    reservations: "id, dossier_id, prestation_id, trajet_id, libelle, date_service, heure_pickup, lieu_pickup, personnes, statut, montant_vente, partenaire_id, paye_sur_place, entite_id, vol:details->>vol, prix_origine:details->>prix_origine, sieges:details->>sieges",
    // Le net et la commission d'un service (migrations 11, 18 et 57). Sans la migration 57, repli sur les colonnes d'avant (NETS_RES_AVANT_57).
    reservations_nets: "reservation_id, net_prevu, net_paye, paye_le, commission_prevue, commission_recue, commission_recue_le, commission_recue_moyen, commission_partielle_le, commission_ecart_motif, commission_ecart_note",
  };
  const charger = (nom: string): Promise<unknown[]> => {
    // En mode unifié, les deux entreprises (catalogue, partenaires, nets, hôtels, temps de trajet, ferries) : la RLS ne rend que ce que la
    // personne peut lire, les nets seulement avec le droit.
    if (!cache.has(nom)) cache.set(nom, paginer(nom, COLONNES[nom], (q) => dans(q)));
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
  // Les fiches d'une autre entreprise (ZTP en mode unifié, toute autre sinon) : gardées seulement si elles ont un dossier ici.
  const horsEntites = (q: any) => (unifie ? q.not("entite_id", "in", `(${idsEntites.join(",")})`) : q.neq("entite_id", entiteId));
  // Une ligne par sa référence courte (« D-1a2b3c4d ») : les huit premiers caractères de l'identifiant, lus comme un intervalle d'uuid.
  const parRef = async (table: string, ref: string) => {
    const p = prefixeRef(ref);
    if (!p) return [];
    return lire(dans(sb.from(table).select(COLONNES[table])).gte("id", `${p}-0000-0000-0000-000000000000`).lte("id", `${p}-ffff-ffff-ffff-ffffffffffff`).limit(5), table);
  };
  const chercherClients = async (recherche: string) => {
    const mots = sansAccents(recherche).trim().split(/\s+/).filter((m) => m.length >= 2).slice(0, 5);
    const chiffres = String(recherche || "").replace(/\D/g, "");
    if (!mots.length && chiffres.length < 6) return [[], []];
    const parNom = (q: any) => mots.reduce((r, m) => r.or(`prenom.ilike.${motifNom(m)},nom.ilike.${motifNom(m)}`), q);
    const [propres, autres, parTel, parDossier] = await Promise.all([
      mots.length ? lire(parNom(dans(sb.from("clients").select(COL_CLIENT))).limit(100), "clients") : [],
      // Les clients partagés d'une autre entreprise qui ont un dossier ici (jointure sur la clé du partage, migration 46). Sans cette clé,
      // repli : les clients des autres entreprises, gardés plus bas seulement s'ils ont un dossier ici.
      mots.length
        ? lire(parNom(dans(horsEntites(sb.from("clients").select(`${COL_CLIENT}, dossiers!dossiers_client_fkey!inner(entite_id)`)), "dossiers.entite_id")).limit(100), "clients").catch(() =>
            lire(parNom(horsEntites(sb.from("clients").select(COL_CLIENT))).limit(100), "clients")
          )
        : [],
      chiffres.length >= 6 ? lire(sb.from("clients").select(COL_CLIENT).ilike("telephone", motifTelephone(chiffres)).limit(50), "clients") : [],
      mots.length ? lire(dans(sb.from("dossiers").select(COLONNES.dossiers)).or(mots.map((m) => `ref.ilike.${motifNom(m)}`).join(",")).limit(50), "dossiers") : [],
    ]);
    const clients = new Map<string, Record<string, any>>();
    for (const c of [...propres, ...autres, ...parTel]) clients.set(c.id, c);
    const manquants = [...new Set(parDossier.map((d) => d.client_id))].filter((id) => id && !clients.has(id));
    if (manquants.length) for (const c of await lire(sb.from("clients").select(COL_CLIENT).in("id", manquants.slice(0, 50)), "clients")) clients.set(c.id, c);
    const ids = [...clients.keys()].slice(0, 250);
    // Par lots de 100 identifiants : une adresse trop longue serait refusée.
    const dossiers: Record<string, any>[] = [];
    for (let i = 0; i < ids.length; i += 100) dossiers.push(...(await lire(dans(sb.from("dossiers").select(COLONNES.dossiers)).in("client_id", ids.slice(i, i + 100)).limit(500), "dossiers")));
    const ici = new Set(dossiers.map((d) => d.client_id));
    return [[...clients.values()].filter((c) => idsEntites.includes(c.entite_id) || ici.has(c.id)), dossiers];
  };
  // Un dossier par sa référence courte ou son numéro (« 2026-0142 »), avec son client et ses services.
  const dossierPour = async (ref: string) => {
    let dossiers = await parRef("dossiers", ref);
    const t = String(ref || "").trim();
    const sur = refSansJoker(t);
    if (!dossiers.length && sur) dossiers = await lire(dans(sb.from("dossiers").select(COLONNES.dossiers)).ilike("ref", sur).limit(5), "dossiers");
    // Un numéro peut exister dans les deux entreprises (mode unifié) : celle de la conversation d'abord ; s'il en reste plusieurs, l'outil
    // reçoit les candidats seuls et demande lequel (outils.js, plusieurs_dossiers).
    const d = choisirLigne(dossiers, unifie).ligne;
    if (!d) return [dossiers, [], [], []];
    const [clients, reservations] = await Promise.all([
      d.client_id ? lire(sb.from("clients").select(COL_CLIENT).eq("id", d.client_id), "clients") : [],
      lire(sb.from("reservations").select(COLONNES.reservations).eq("entite_id", d.entite_id).eq("dossier_id", d.id).limit(200), "reservations"),
    ]);
    // Les nets et commissions des services : seulement avec le droit « partenaires.nets » dans l'entreprise du dossier (la base les refuse
    // aussi sans lui).
    const ids = reservations.map((r) => r.id);
    let nets: Record<string, any>[] = [];
    if (ids.length && netsDans(d.entite_id)) {
      const q = (colonnes: string) => sb.from("reservations_nets").select(colonnes).eq("entite_id", d.entite_id).in("reservation_id", ids.slice(0, 200));
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
      const lignes = await lire(dans(sb.from("hotels_lieux").select(COLONNES.hotels_lieux)).in("cle", lot), "hotels_lieux");
      // Le même hôtel connu des deux entreprises (mode unifié) : la ligne de l'entreprise active d'abord.
      for (const c of lot) hotelsVus.set(c, lignes.find((h) => h.cle === c && h.entite_id === entiteId) || lignes.find((h) => h.cle === c) || null);
    }
    return cles.map((c) => hotelsVus.get(c)).filter(Boolean) as Record<string, any>[];
  };
  // ---- Vouchers (trouver_vouchers, vouchers.js, 21.11.2026), lus avec la session de la personne -----------------------------------
  // Dans Secret ou Taxi seulement (fonctionnement des réglages), pour qui lit les réservations de l'entreprise active ; outils.js contrôle les
  // droits de chaque entreprise (dossiers.lire, jamais « vouchers.seul »). Les colonnes lues : ni montant, ni partenaire, ni net. Rien n'est
  // écrit ; l'écran fait l'image dans le navigateur et n'envoie rien sans le clic de la personne.
  // Comme l'écran (completerReglages) : sans fonctionnement réglé, « sur_mesure », donc pas de voucher.
  const fonctionnementDe = (r: Record<string, unknown> | null) => (r && typeof r.fonctionnement === "string" ? r.fonctionnement : "sur_mesure");
  const entitesVoucher = [{ id: entiteId, fonctionnement: fonctionnementDe(reglages) }, ...(unifie ? unifie.entites.filter((e) => e.id !== entiteId).map((e) => ({ id: e.id, fonctionnement: fonctionnementDe(reglagesAutre) })) : [])];
  // De `details`, seulement le modèle choisi (« aucun » : pas de voucher) et le lieu de dépose (retiré du service, jamais envoyé).
  const COL_RES_VOUCHER = "id, dossier_id, prestation_id, trajet_id, libelle, date_service, heure_pickup, lieu_pickup, statut, entite_id, modele_voucher:details->>modele_voucher, drop_off:details->>drop_off";
  const COL_DOS_VOUCHER = "id, ref, client_id, annule, entite_id";
  const COL_CLI_VOUCHER = "id, prenom, nom, entite_id";
  // Une ligne par sa référence courte (D-…, R-…, C-…), avec ces colonnes seulement.
  const parRefVoucher = (table: string, ref: string, colonnes: string, filtre: (q: any) => any = (q) => dans(q)) => {
    const p = prefixeRef(ref);
    if (!p) return Promise.resolve([] as Record<string, any>[]);
    return lire(filtre(sb.from(table).select(colonnes)).gte("id", `${p}-0000-0000-0000-000000000000`).lte("id", `${p}-ffff-ffff-ffff-ffffffffffff`).limit(5), table);
  };
  // Par lots de 100 identifiants (une adresse trop longue serait refusée). Une lecture qui atteint sa limite le note (`limite`) : le résultat
  // dit alors « tronque » (revue de sécurité de la PR 303).
  // `lu` : l'état d'une recherche (une par appel d'outil, même quand deux appels tournent ensemble).
  const parLots = async (lu: { limite: boolean }, table: string, colonnes: string, colonne: string, ids: string[], plus: (q: any) => any = (q) => q, max = 500) => {
    const tous = [...new Set(ids.filter(Boolean))];
    if (tous.length > max) lu.limite = true;
    const uniques = tous.slice(0, max);
    const out: Record<string, any>[] = [];
    for (let i = 0; i < uniques.length; i += 100) {
      const lot = await lire(plus(sb.from(table).select(colonnes).in(colonne, uniques.slice(i, i + 100))).limit(1000), table);
      if (lot.length >= 1000) lu.limite = true;
      out.push(...lot);
    }
    return out;
  };
  const vouchers = {
    permis: true,
    entites: entitesVoucher,
    // Les compagnies (non partenaires) des réglages de l'autre entreprise, retirées du service comme celles de l'entreprise active.
    compagniesAutre: unifie && reglagesAutre && Array.isArray(reglagesAutre.compagnies) ? reglagesAutre.compagnies : [],
    // Les candidats d'une recherche ; l'outil refait tout le tri (droits par entreprise, date, heure, mots du nom, annulés).
    candidats: async (c: { client: string; dossier: string; date: string; entites: string[] }) => {
      const ids = (c.entites || []).filter((x) => idsEntites.includes(x));
      const lu = { limite: false };
      if (!ids.length) return { reservations: [], dossiers: [], clients: [] };
      const ici = (q: any, colonne = "entite_id") => q.in(colonne, ids);
      const parDate = (q: any) => (c.date ? q.eq("date_service", c.date) : q);
      let dossiersVises: Record<string, any>[] | null = null;
      let reservations: Record<string, any>[] = [];
      if (c.dossier) {
        let ds = await parRefVoucher("dossiers", c.dossier, COL_DOS_VOUCHER, ici);
        const sur = refSansJoker(c.dossier);
        if (!ds.length && sur) ds = await lire(ici(sb.from("dossiers").select(COL_DOS_VOUCHER)).ilike("ref", sur).limit(5), "dossiers");
        dossiersVises = ds;
      }
      if (c.client && !dossiersVises) {
        const p = /^([RDC])-[0-9a-f]{8}$/i.exec(c.client.trim());
        const genre = p ? p[1].toUpperCase() : "";
        if (genre === "R") reservations = await parRefVoucher("reservations", c.client, COL_RES_VOUCHER, ici);
        else if (genre === "D") dossiersVises = await parRefVoucher("dossiers", c.client, COL_DOS_VOUCHER, ici);
        else if (genre === "C") {
          // Une fiche partagée d'une autre entreprise se lit aussi (la RLS décide) ; ses dossiers, seulement ceux de Secret ou de Taxi.
          const cs = await parRefVoucher("clients", c.client, COL_CLI_VOUCHER, (q) => q);
          dossiersVises = await parLots(lu, "dossiers", COL_DOS_VOUCHER, "client_id", cs.map((x) => x.id), ici);
        } else {
          const [cs, ds] = (await chercherClients(c.client)) as [Record<string, any>[], Record<string, any>[]];
          if (cs.length >= 250 || ds.length >= 500) lu.limite = true;
          dossiersVises = ds.filter((d) => ids.includes(d.entite_id));
        }
      }
      if (dossiersVises) reservations = await parLots(lu, "reservations", COL_RES_VOUCHER, "dossier_id", dossiersVises.map((d) => d.id), (q) => parDate(ici(q)).neq("statut", "annule"), 250);
      else if (!c.client && c.date) {
        reservations = await lire(ici(sb.from("reservations").select(COL_RES_VOUCHER)).eq("date_service", c.date).neq("statut", "annule").order("heure_pickup", { ascending: true }).limit(300), "reservations");
        if (reservations.length >= 300) lu.limite = true;
      }
      const dossiers = await parLots(lu, "dossiers", COL_DOS_VOUCHER, "id", reservations.map((r) => r.dossier_id));
      const clients = await parLots(lu, "clients", COL_CLI_VOUCHER, "id", dossiers.map((d) => d.client_id));
      // La famille des services (frais et options n'ont pas de voucher) ; illisible, l'écran fait le tri seul.
      const prestations = await parLots(lu, "prestations", "id, famille, unite, groupe, libelle, libelle_en", "id", reservations.map((r) => r.prestation_id)).catch(() => []);
      return { reservations, dossiers, clients, prestations, limite: lu.limite };
    },
  };
  // ---- Boîte WhatsApp (PR A, migration 67), lue avec la session de la personne -----------------------------------------------------
  // Permise seulement dans l'Assistant de Secret ou de Taxi et pour qui administre CETTE entreprise (whatsapp_admin de l'entreprise active,
  // migration 58 : « reglages.ecrire » et toute l'entreprise). Une erreur (migration absente, droits) laisse l'Assistant sans ces outils.
  let whatsapp: Record<string, unknown> | null = null;
  const orgWa = ent.data?.organisation_id || null;
  if (ent.data && ENTREPRISES_UNIFIEES.includes(ent.data.slug) && orgWa) {
    const adminWa = await sb.rpc("whatsapp_admin", { e: entiteId });
    if (adminWa.error) console.error("agent : whatsapp_admin", adminWa.error.message);
    if (!adminWa.error && whatsappPermis({ slug: ent.data.slug, admin: adminWa.data === true })) {
      const entitesWa = (await lire(sb.from("entites").select("id, slug").eq("organisation_id", orgWa).in("slug", ENTREPRISES_UNIFIEES), "entites")) as { id: string; slug: string }[];
      const idsWa = entitesWa.map((e) => e.id);
      const COL_CONV = "id, created_at, organisation_id, telephone, nom, entite_id, client_id, dossier_id, dernier_message_le, dernier_sens, non_lus, reponses, tri, paiement_signale, promesse_le";
      // Colonnes des migrations 70 (source du nom), 68 (type du contact) et 65 (aperçu, attente) : sans elles, l'outil lit ce qui existe (le
      // nom se lit comme un nom de profil, le type reste vide, l'attente se lit au sens du dernier message).
      const NIVEAUX_CONV = [`${COL_CONV}, dernier_texte, dernier_type, attend_depuis, type_contact, partenaire_id, nom_source`, `${COL_CONV}, dernier_texte, dernier_type, attend_depuis, type_contact, partenaire_id`, `${COL_CONV}, dernier_texte, dernier_type, attend_depuis`];
      let niveauConv = 0;
      const conversations = async (filtre: (q: any) => any) => {
        const q = (cols: string) => filtre(sb.from("whatsapp_conversations").select(cols).eq("organisation_id", orgWa)).order("dernier_message_le", { ascending: false, nullsFirst: false });
        while (niveauConv < NIVEAUX_CONV.length) {
          const r = await q(NIVEAUX_CONV[niveauConv]);
          if (!r.error) return (r.data || []) as Record<string, any>[];
          if (r.error.code !== "42703") throw new Error(`whatsapp_conversations : ${r.error.message}`);
          niveauConv++;
        }
        return lire(q(COL_CONV), "whatsapp_conversations");
      };
      // Par lots de 100 identifiants (une adresse trop longue serait refusée).
      const parIds = async (table: string, colonnes: string, colonne: string, ids: string[], plus: (q: any) => any = (q) => q) => {
        const uniques = [...new Set(ids.filter(Boolean))].slice(0, 500);
        const out: Record<string, any>[] = [];
        for (let i = 0; i < uniques.length; i += 100) out.push(...(await lire(plus(sb.from(table).select(colonnes).in(colonne, uniques.slice(i, i + 100))).limit(1000), table)));
        return out;
      };
      const autour = async (convs: Record<string, any>[]) => {
        const [clients, dossiers] = await Promise.all([
          parIds("clients", "id, prenom, nom", "id", convs.map((c) => c.client_id)),
          parIds("dossiers", "id, ref, annule, entite_id", "id", convs.map((c) => c.dossier_id)),
        ]);
        return { clients, dossiers, entites: entitesWa };
      };
      const intervalle = (p: string) => [`${p.slice(0, 8)}-0000-0000-0000-000000000000`, `${p.slice(0, 8)}-ffff-ffff-ffff-ffffffffffff`];
      const rechercher = async (q: string, mot: string | null) => {
        const r = await sb.rpc("whatsapp_rechercher", { q, lim: 50 });
        if (r.error) {
          console.error("agent : whatsapp_rechercher", r.error.message);
          return [];
        }
        return ((r.data || []) as Record<string, any>[]).map((t) => (mot ? { ...t, mot } : t));
      };
      whatsapp = {
        permis: true,
        slug: ent.data.slug,
        qui: "Nani",
        // Contacts typés (migration 68) : « nouveau client envoyé par un apporteur » dans a_faire_whatsapp.
        typeContact: (c: Record<string, any>) => (c && typeof c.type_contact === "string" ? c.type_contact : null),
        // Les conversations candidates : la base filtre ce qui est simple (client, dossier, non-lus, période), l'outil refait tout le tri.
        candidats: async (e: Record<string, any>) => {
          const texte = String(e.texte || "").trim().slice(0, 100);
          const mots = sansAccents(texte).split(/\s+/).filter((m) => m.length >= 2).slice(0, 5);
          // Toute la recherche, puis chaque mot seul si elle en a plusieurs (« Tom ferry » : « Tom » dans le nom, « ferry » dans un message).
          const trouves: Record<string, any>[] = texte.length >= 2 ? (await Promise.all([rechercher(texte, null), ...(mots.length > 1 ? mots.map((m) => rechercher(m, m)) : [])])).flat() : [];
          const pc = prefixeRef(e.client);
          const clientId = !pc && UUID.test(String(e.client || "")) ? String(e.client) : "";
          const pd = prefixeRef(e.dossier);
          let dossiersRef: string[] | null = null;
          if (!pd && String(e.dossier || "").trim()) {
            const ref = refSansJoker(e.dossier);
            dossiersRef = ref ? (await lire(sb.from("dossiers").select("id").in("entite_id", idsWa).ilike("ref", ref).limit(20), "dossiers")).map((d) => d.id) : [];
          }
          if (dossiersRef && !dossiersRef.length) return { conversations: [], trouves, ...(await autour([])) };
          const filtres = (q: any) => {
            q = q.neq("reponses", "jamais");
            if (pc) q = q.gte("client_id", intervalle(pc)[0]).lte("client_id", intervalle(pc)[1]);
            if (clientId) q = q.eq("client_id", clientId);
            if (pd) q = q.gte("dossier_id", intervalle(pd)[0]).lte("dossier_id", intervalle(pd)[1]);
            if (dossiersRef) q = q.in("dossier_id", dossiersRef);
            if (e.non_lus) q = q.gt("non_lus", 0);
            if (typeof e.du === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.du)) q = q.gte("dernier_message_le", `${e.du}T00:00:00+07:00`);
            if (typeof e.au === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.au)) q = q.lte("created_at", `${e.au}T23:59:59.999+07:00`);
            return q;
          };
          let convs: Record<string, any>[] = [];
          if (texte.length < 2) convs = await conversations((q) => filtres(q).limit(200));
          else {
            const chiffres = texte.replace(/\D/g, "");
            // Un des mots dans le prénom ou le nom d'un client (l'outil vérifie ensuite que chaque mot est couvert).
            const parNom = mots.length ? await lire(sb.from("clients").select("id").in("entite_id", idsWa).or(mots.map((m) => `prenom.ilike.${motifNom(m)},nom.ilike.${motifNom(m)}`).join(",")).limit(100), "clients") : [];
            const ids = [...new Set(trouves.map((t) => t.conversation_id).filter((x) => UUID.test(String(x))))].slice(0, 100);
            const conds = [
              ...mots.map((m) => `nom.ilike.${motifNom(m)}`),
              ...(chiffres.length >= 6 ? [`telephone.ilike.${motifTelephone(chiffres)}`] : []),
              ...(ids.length ? [`id.in.(${ids.join(",")})`] : []),
              ...(parNom.length ? [`client_id.in.(${parNom.map((c) => c.id).join(",")})`] : []),
            ];
            if (conds.length) convs = await conversations((q) => filtres(q).or(conds.join(",")).limit(200));
          }
          return { conversations: convs, trouves, ...(await autour(convs)) };
        },
        // Une conversation et ses messages. Un contact « jamais » : ses messages ne sont pas même lus.
        // « depuis » : les premiers à partir de ce jour (ordre croissant) ; sinon les derniers, avant « avant » s'il est donné. Les messages
        // restant de part et d'autre sont comptés par la base (count exact).
        conversation: async (id: string, { depuis = "", avant = "", derniers = 40 }: { depuis?: string; avant?: string; derniers?: number } = {}) => {
          if (!UUID.test(String(id || ""))) return { conversation: null };
          const convs = await conversations((q) => q.eq("id", id).limit(1));
          const conv = convs[0] || null;
          if (!conv || conv.reponses === "jamais") return { conversation: conv, messages: [] };
          const n = Math.min(200, Math.max(1, Number(derniers) || 40));
          // Ligne « non transmis » (migration 100) : jamais lue par l'Assistant.
          const base = (cols: string, opts?: any) => sb.from("whatsapp_messages").select(cols, opts).eq("conversation_id", id).is("supprime_le", null).neq("type", "non_transmis");
          let q = base("id, conversation_id, sens, type, texte, medias, envoye_le, modifie_le, supprime_le");
          if (depuis) q = q.gte("envoye_le", borneJour(depuis));
          else if (avant) q = q.lt("envoye_le", borneJour(avant));
          const messages = await lire(q.order("envoye_le", { ascending: !!depuis }).limit(n), "whatsapp_messages");
          let compte: { avant: number; apres: number } | null = null;
          if (messages.length) {
            const dates = messages.map((m) => String(m.envoye_le)).sort();
            const [a, b] = await Promise.all([
              base("id", { count: "exact", head: true }).lt("envoye_le", dates[0]),
              base("id", { count: "exact", head: true }).gt("envoye_le", dates[dates.length - 1]),
            ]);
            if (!a.error && !b.error) compte = { avant: a.count || 0, apres: b.count || 0 };
          }
          return { conversation: conv, messages, ...(compte ? { compte } : {}), ...(await autour([conv])) };
        },
        // Ce qui attend : conversations à suivre, promesses échues, paiements et ferrys des dossiers reliés.
        aFaire: async () => {
          const convs = await conversations((q) => q.limit(300));
          const suivies = convs.filter((c) => c.reponses !== "jamais");
          const dossierIds = suivies.map((c) => c.dossier_id).filter(Boolean);
          // La colonne whatsapp_conversation_id (migration 67) ; sans elle, le rapprochement d'avant.
          const tachesDe = async (cols: string) => sb.from("taches").select(cols).in("entite_id", idsWa).eq("fait", false).eq("description", MARQUE_PROMESSE).lt("echeance", jourBangkok(Date.now())).limit(100);
          const lireTaches = async () => {
            const r = await tachesDe("id, entite_id, dossier_id, titre, description, echeance, fait, created_at, whatsapp_conversation_id");
            if (!r.error) return (r.data || []) as Record<string, any>[];
            if (r.error.code !== "42703") throw new Error(`taches : ${r.error.message}`);
            return lire(tachesDe("id, entite_id, dossier_id, titre, description, echeance, fait, created_at"), "taches");
          };
          const [taches, resumes, paiements, reservations, entour] = await Promise.all([
            lireTaches(),
            parIds("dossiers_resume", "dossier_id, total, recu, devise", "dossier_id", dossierIds),
            parIds("paiements", "dossier_id, created_at", "dossier_id", dossierIds),
            parIds("reservations", "id, dossier_id, libelle, statut, date_service, trajet_id, prestation_id", "dossier_id", dossierIds, (q) => q.neq("statut", "annule")),
            autour(suivies),
          ]);
          const [trajets, prestations] = await Promise.all([
            parIds("trajets", "id, mode", "id", reservations.map((r) => r.trajet_id)),
            parIds("prestations", "id, famille", "id", reservations.map((r) => r.prestation_id)),
          ]);
          return { conversations: convs, taches, resumes, paiements, reservations, trajets, prestations, ...entour };
        },
      };
    }
  }

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
  // Les noms de partenaires bloqués dans une réponse. Tous, y compris l'apporteur, pour une réponse au client. Conversation liée à un
  // apporteur : une réponse marquée « destinataire apporteur » (outils.js, proposer_reponse) lui est adressée, ses propres fiches
  // (apporteur.js) sortent alors de la liste ; tout autre partenaire reste bloqué.
  const partenairesLus = (await charger("partenaires")) as { id: string; nom: string }[];
  const prestataires = nomsABloquer(partenairesLus);
  const prestatairesVersApporteur = apporteur ? nomsABloquer(partenairesLus, new Set((apporteur.fiches as { id: string }[]).map((f) => f.id))) : null;
  // En mode unifié, les droits tenus dans l'une des deux entreprises règlent les consignes (les champs internes, eux, ne sortent que pour
  // les lignes de l'entreprise où la personne a le droit : outils.js).
  const droits: string[] = unifie ? permissionsOutils(unifie) : perms.data || [];
  const entreprisesUnifiees = unifie ? { entreprises: unifie.entites.map((e) => ({ nom: e.nom, slug: e.slug, reglages: e.id === entiteId ? reglages : reglagesAutre })) } : null;
  // Un contact WhatsApp apporteur (PR D) : sa consigne s'ajoute à chaque échange de la conversation liée.
  // trouver_vouchers proposé ou non : les mêmes droits que l'exécution (outils.js, peutTrouverVouchers).
  const avecVouchers = peutTrouverVouchers({ permissions: perms.data || [], ...(unifie ? { entites: unifie.entites, permissionsPar: unifie.permissionsPar } : {}), vouchers });
  const systemeBase = consignes({ entreprise: ent.data?.nom || "", reglages, lieu: ra.lieu, prenomEquipe: ra.responsable, partenaires: droits.includes("partenaires.lire"), nets: droits.includes("partenaires.lire") && droits.includes("partenaires.nets"), unifie: entreprisesUnifiees, vouchers: avecVouchers, whatsapp: !!whatsapp });
  const systeme = systemeBase + blocApporteur(apporteur, { qui: ra.responsable || "l'équipe", unifie: !!unifie });
  const contexte = contexteDuJour({ aujourdhui, jour: jourSemaine(aujourdhui), lieuCourt: lieuCourt(ra.lieu), dossier: dossierRelie });
  // L'historique tel qu'il est gardé (blocs « fichier »), puis tel qu'il part chez Claude (images et documents).
  // Les lectures de la boîte WhatsApp des messages précédents ne repartent pas (whatsapp-lecture.js, retirerLecturesWhatsApp) : l'agent
  // relit avec l'outil, sous les règles du moment (un contact passé en « jamais » n'est plus renvoyé).
  // Revue de sécurité de la PR 299 : la conversation WhatsApp liée est passée « Contact personnel » depuis : l'échange joint plus tôt
  // (bloc <conversation>) est retiré, comme les lectures de la boîte (retirerConversationsJointes).
  const gardesBruts = completerOrphelins(historique(debutValide([...(anciens.data || [])].reverse())));
  const gardes = waLue && waLue.reponses === "jamais" ? retirerConversationsJointes(gardesBruts) : gardesBruts;
  // La réflexion des tours terminés ne repart pas (prompt.js, sansReflexionPassee) : sinon la réécriture ci-dessus casse sa signature (400).
  const messages = sansReflexionPassee(historiquePourClaude(retirerLecturesWhatsApp(gardes), donnees));
  // Les corrections de l'équipe dans cette entreprise, d'avant l'ouverture de la conversation (le bloc reste le même d'un message à l'autre,
  // donc en cache). Sans la migration 54 ou en cas d'erreur : rien, l'agent marche comme avant.
  const premierTexte = (() => {
    const m = (gardes as { role: string; content: unknown }[]).find((x) => x.role === "user" && Array.isArray(x.content) && x.content.some((b: { type: string }) => b.type === "text"));
    return m ? (m.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text || "").join(" ") : message;
  })();
  // En mode unifié : 60 de l'entreprise active ; de l'autre, seulement les réponses au client (20), chaque ligne marquée de son entreprise.
  const autreEnt = unifie ? unifie.entites.find((e) => e.id !== entiteId) || null : null;
  // Les nets du catalogue (lus plus bas aussi pour le contrôle de la réponse) écartent d'abord toute correction dont un montant leur est
  // égal (agent/apprentissages.js, lireApprentissages) : les lignes se lisent avec la session (RLS), les nets avec la clé de service.
  const lusNets = await netsPourControle(admin, idsEntites);
  const lus = await lireApprentissages(sb, { dbNets: admin, active: { id: entiteId, nom: ent.data?.nom || "" }, autre: autreEnt, jusqua: conv!.cree_le || new Date().toISOString(), nets: lusNets, qui: ra.responsable || "" });
  const lignesAppris = lus.lignes;
  // Chez Secret et Taxi, les réponses corrigées perdent leur signature avant de servir d'exemple (prompt.js, blocApprentissages).
  const appris = lus.erreur ? "" : blocApprentissages(lignesAppris, { qui: ra.responsable, premierMessage: premierTexte, signatures: signe(reglages) ? null : [ent.data?.nom || "", ...(unifie ? unifie.entites.map((e) => e.nom) : [])].filter(Boolean) });
  // Le contrôle de la réponse au client (revue de sécurité de la PR 299). Une conversation jointe ou liée de partenaire, de chauffeur ou
  // d'hôtel : ses montants deviennent internes (memoDepuis, conversationInterne). Le texte joint n'est jamais « tapé » par la personne. Celle
  // d'un client : les montants écrits par Nani y sont des prix de vente (conversationClient, 21.11.2026), jamais ceux du client. Un client
  // sans fiche que le tri range parmi les demandes de client compte aussi (clientProbable, 22.11.2026), ses prix marqués à vérifier.
  const typeLu = waLue && typeof waLue.type_contact === "string" ? waLue.type_contact : "";
  // Les entreprises où le dossier peut naître (l'active, les deux en espace unifié) : leurs étapes client comptent (clientProbable).
  const slugsDossier = unifie ? unifie.entites.map((e) => e.slug) : [ent.data?.slug || ""];
  const memo = memoDepuis([...messages, { role: "user", content: message ? [{ type: "text", text: message }] : [] }], { signer: signe(reglages), prestataires, entreprise: ent.data?.nom || "", entreprises: unifie ? unifie.entites.filter((e) => e.id !== entiteId).map((e) => e.nom) : [], prenoms: [ra.responsable, "Anaïs", "Nani"].filter(Boolean), conversationInterne: CONTACTS_INTERNES.includes(typeLu), conversationClient: clientPourPrixDeNani(waLue, slugsDossier), clientProbable: !clientConfirme(waLue) && clientProbable(waLue, slugsDossier), conversationLiee: waLue ? waLue.id : null });
  if (prestatairesVersApporteur) (memo as Record<string, unknown>).prestatairesApporteur = prestatairesVersApporteur;
  // L'apporteur lié : son propre nom reste permis vers lui (PR 298). Tout autre nom lu ou joint est bloqué dans les deux listes.
  (memo as Record<string, unknown>).contactLie = apporteur && waLiee ? waLiee.id : null;
  if (CONTACTS_NOMMES.includes(typeLu) && waLue && waLue.nom) ajouterNoms(memo, [{ conversation: waLue.id, nom: String(waLue.nom) }]);
  // Revue de sécurité de la PR 300 : une conversation reliée à une fiche partenaire sans type nommé (nom saisi par l'équipe, migration 70)
  // garde son nom bloqué vers un client, comme un contact typé.
  if (!CONTACTS_NOMMES.includes(typeLu) && waLue && waLue.partenaire_id && waLue.nom) ajouterNoms(memo, [{ conversation: waLue.id, nom: String(waLue.nom) }]);
  // Les lectures de la boîte des échanges précédents (montants internes et noms lus), avant leur retrait pour Claude.
  retenirLectures(gardes, memo);
  // Le prix du client non corrigé par Nani (revue de la PR 307) : calculé ici, à chaque échange, sur les 60 derniers messages de la
  // conversation WhatsApp liée, lus en base avec la session, dans l'ordre d'envoi. Jamais du bloc joint ni de lire_conversation : une
  // correction faite ensuite dans WhatsApp retire le prix au prochain échange. Une lecture en échec ne valide rien.
  if (waLue && clientConfirme(waLue)) {
    const lusWa = await sb.from("whatsapp_messages").select("id, sens, origine, type, texte, medias, envoye_le, modifie_le, supprime_le").eq("conversation_id", waLue.id).neq("type", "non_transmis").order("envoye_le", { ascending: false }).order("id", { ascending: false }).limit(MESSAGES_PRIX_CLIENT);
    if (!lusWa.error) memo.clientValides = prixClientValides([...(lusWa.data || [])].reverse(), waLue);
  }
  // Les nets du catalogue de l'entreprise (des deux en espace unifié), chacun avec son service, lus avec la clé de service comme la boîte
  // (whatsapp/reponse.ts) : seulement pour le contrôle de la réponse. Ceux des services de la demande en cours (rendus par un outil de la
  // conversation, ou du dossier relié) bloquent (montant_interne) ; ceux des autres services avertissent (montant_egal_net, faux blocage du
  // 21.11.2026). Ils ne vont que dans memo.nets : ni dans les consignes, ni dans les messages, ni dans un résultat d'outil, ni dans le flux
  // vers l'écran (un test le vérifie). Un net égal à un prix de vente rendu par un outil reste permis.
  memo.nets = lusNets.nets;
  // Nets illisibles : la réponse au client ne se copie pas (controle_impossible, outils.js).
  memo.controleImpossible = lusNets.erreur;
  // Le dossier relié : ses services (leurs nets bloquent), ses nets, marges et commissions (bloquent aussi).
  // Le dossier de la conversation de l'Assistant et celui de la conversation WhatsApp liée (revue de sécurité de la PR 306).
  const relie = await dossierPourControle(admin, conv!.dossier_id, idsEntites);
  const relieWa = waLue && waLue.dossier_id && waLue.dossier_id !== conv!.dossier_id ? await dossierPourControle(admin, waLue.dossier_id, idsEntites) : null;
  memo.servicesEnCours = new Set([...relie.services, ...(relieWa?.services ?? [])]);
  for (const n of [...relie.internes, ...(relieWa?.internes ?? [])]) memo.internes.add(n);
  // Ses prix de vente : seuls, avec ceux des services rendus, à lever un montant interne (outils.js, proposer_reponse).
  memo.ventesDossier = [...relie.ventes, ...(relieWa?.ventes ?? [])];
  // Les pièces jointes que l'agent peut citer (proposer_import_brochure) et les droits de la personne (l'import demande « partenaires.ecrire »
  // et « partenaires.prix »).
  // historique, entreprise : pour les cartes « reglage » et « amelioration » (ameliorer.js). L'historique est le tableau que l'échange
  // complète en place : une pièce jointe ou un nom de client vus plus tôt dans la conversation y sont.
  // Espace unifié : entites et permissionsPar (unifie.js). ctx.permissions reste celles de l'entreprise active (import de brochure, réglages).
  const ctx = { historique: messages, entreprise: ent.data?.nom || "", fichiers: fichiersConv.map((f) => ({ id: f.id, nom: f.nom, media_type: f.media_type })), permissions: perms.data || [], ...(unifie ? { entites: unifie.entites, permissionsPar: unifie.permissionsPar } : {}), charger, chercherClients, dossierPour, parRef, hotelsPour, ...(whatsapp ? { whatsapp } : {}), ...(apporteur ? { apporteur } : {}), vouchers, aujourdhui, reglages, ors, simule: simules ? tempsSimule : null, estimerWeb, situerWeb, notes, moteur, maintenant: () => Date.now() };
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
      await envoyer({ t: "conversation", id: conv!.id, titre: conv!.titre, dossier_id: conv!.dossier_id, ...(waId && waEcrit ? { whatsapp_conversation_id: waId } : {}), ...(remplace ? { remplace, whatsapp_conversation_id: conv!.whatsapp_conversation_id } : {}) });
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
