// Fonction « agent » : l'assistant de l'onglet « Assistant », avec qui on discute et qui s'appuie sur des outils (catalogue, horaires, hôtels,
// temps de route, planning, clients, dossiers) pour planifier et proposer. L'outil l'appelle avec la session de la personne : toutes les
// lectures et écritures passent par les règles RLS, comme dans l'outil. Seul le journal (compte et coût) s'écrit avec la clé de service.
//
// Ce qui part chez Anthropic : les messages de la personne, et ce que les outils rendent (tarifs de vente, horaires, lieux, clients et
// dossiers de l'entreprise). Jamais un net, une marge ni un nom de prestataire : les outils les retirent (outils.js). Rien n'est écrit dans
// les dossiers : les propositions sont des cartes que la personne valide dans l'écran.
//
// Réponse en flux NDJSON (une ligne JSON par événement) : { t: "conversation" | "etape" | "texte" | "planning" | "carte" | "fin" | "erreur" }.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { LIMITE_JOUR_DEFAUT, LONGUEUR_MAX, MODELE_DEFAUT, PLAFOND_MOIS_USD_DEFAUT, consignes, contexteDuJour, controlerAcces, debutValide, historique, ligneJournal, signe, titreDepuis } from "./prompt.js";
import { clesHotelPossibles, memoDepuis, motifNom, motifTelephone, prefixeRef, refDe, sansAccents, tempsSimule } from "./outils.js";
import { tourner } from "./boucle.js";
import { NOMINATIM_BASE, ORGANISATIONS_OSRM, ORS_BASE, ORS_GEOCODE, ORS_ITINERAIRE, OSRM_BASE, USER_AGENT, cheminOsrm, cleItineraire, cleZone, corpsItineraire, delaiAvant, lireGeocode, lireItineraire, lireNominatim, lireOsrm, lirePhoton, parametresGeocode, parametresNominatim, parametresPhoton, PHOTON_BASE, situerLieu, VALIDITE_JOURS } from "./temps.js";
import { lireEstimation, parametresEstimation } from "./estimation.js";
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

// Début du mois à Bangkok, en heure UTC : pour le plafond du mois.
const debutMoisBangkok = () => new Date(Date.parse(`${dateBangkok().slice(0, 8)}01T00:00:00Z`) - 7 * 3600 * 1000).toISOString();

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
  const message = typeof demande.texte === "string" ? demande.texte.trim() : "";
  if (!message || message.length > LONGUEUR_MAX) return json({ erreur: "message_invalide" }, 400);
  const conversationId = demande.conversation_id && UUID.test(demande.conversation_id) ? demande.conversation_id : null;

  const URL_SB = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: autorisation } }, auth: { persistSession: false } });
  const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: qui, error: errQui } = await sb.auth.getUser();
  if (errQui || !qui?.user) return json({ erreur: "non_connecte" }, 401);
  const userId = qui.user.id;

  const [regl, perms, echanges, mois, ent] = await Promise.all([
    sb.from("reglages").select("valeur").eq("entite_id", entiteId).maybeSingle(),
    sb.rpc("permissions_dans", { e: entiteId }),
    admin.from("assistant_journal").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("usage", "agent").gte("cree_le", debutJourBangkok()),
    // Le plafond du mois compte toute la dépense de l'assistant (tous usages, toutes personnes) : il protège le crédit.
    admin.rpc("assistant_cout_depuis", { debut: debutMoisBangkok() }),
    sb.from("entites").select("nom, organisation_id").eq("id", entiteId).maybeSingle(),
  ]);
  if (regl.error || perms.error || echanges.error || mois.error) return json({ erreur: "base" }, 500);
  if (ent.error) console.error("agent : entreprise", ent.error.message);
  const reglages = regl.data ? regl.data.valeur : null;
  const coutDuMois = Number(mois.data) || 0;
  const acces = controlerAcces({
    entiteId,
    permissions: perms.data || [],
    reglages,
    echangesDuJour: echanges.count || 0,
    limiteJour: Number(Deno.env.get("AGENT_LIMITE_JOUR")) || LIMITE_JOUR_DEFAUT,
    coutDuMois,
    plafondMois: Number(Deno.env.get("AGENT_PLAFOND_MOIS_USD")) || PLAFOND_MOIS_USD_DEFAUT,
  });
  if (!acces.ok) return json({ erreur: acces.erreur, ...(acces.manque ? { manque: acces.manque } : {}), ...(acces.limite ? { limite: acces.limite } : {}), ...(acces.plafond ? { plafond: acces.plafond } : {}) }, acces.statut);
  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return json({ erreur: "non_configure" }, 503);

  // La conversation : nouvelle, ou une des miennes (RLS : une conversation d'une autre personne n'est pas lisible).
  let conv: { id: string; titre: string; dossier_id: string | null } | null = null;
  if (conversationId) {
    const c = await sb.from("agent_conversations").select("id, titre, dossier_id, entite_id").eq("id", conversationId).maybeSingle();
    if (c.error) return json({ erreur: "base" }, 500);
    if (!c.data || c.data.entite_id !== entiteId) return json({ erreur: "conversation_introuvable" }, 404);
    conv = c.data;
  } else {
    const dossierId = typeof demande.dossier_id === "string" && UUID.test(demande.dossier_id) ? demande.dossier_id : null;
    const c = await sb.from("agent_conversations").insert({ entite_id: entiteId, titre: titreDepuis(message), dossier_id: dossierId }).select("id, titre, dossier_id").single();
    if (c.error) return json({ erreur: c.error.code === "42P01" ? "migration_manquante" : "base" }, 500);
    conv = c.data;
  }
  const anciens = await sb.from("agent_messages").select("role, contenu").eq("conversation_id", conv!.id).order("id", { ascending: false }).limit(400);
  if (anciens.error) return json({ erreur: "base" }, 500);
  // Conservation : mes conversations sans message depuis 90 jours partent (sans attendre, une erreur ne bloque rien).
  sb.rpc("purger_agent_conversations", { jours: CONSERVATION_JOURS }).then(() => {}, () => {});

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
  const COLONNES: Record<string, string> = {
    prestations: "id, famille, groupe, libelle, libelle_en, prix_vente, unite, sur_place, actif, partenaire_id",
    trajets: "id, de, vers, mode, depart, arrivee, duree, prix_adulte, prix_enfant, bebe, periode, fenetres, actif, partenaire_id",
    partenaires: "id, nom, actif",
    // Les nets : lus ici pour poser le drapeau « recommande », jamais renvoyés. Vides pour qui n'a pas le droit « partenaires.nets ».
    prestations_nets: "prestation_id, net",
    trajets_nets: "trajet_id, net_adulte, net_enfant",
    hotels_lieux: "cle, nom, lieu, zone, localite, source_url, certitude, verifie",
    temps_trajets: "de, vers, mode, duree_min, ferry, marge_min, source, source_date, a_verifier",
    liaisons_ferry: "nom, cote_ile, port_ile, port_continent, port_ile_coord, port_continent_coord, duree_min, a_verifier",
    dossiers: "id, ref, client_id, date_depart, date_retour, annule",
    reservations: "id, dossier_id, libelle, date_service, heure_pickup, lieu_pickup, personnes, statut, montant_vente",
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
    return [dossiers, clients, reservations];
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
  const moteur: "ors" | "osrm" | null = cleOrs ? "ors" : osrmPermis ? "osrm" : null;
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
    const entetes = moteur === "ors" && hote === new URL(orsUrl).host ? { Authorization: cleOrs!, "Content-Type": "application/json" } : { "User-Agent": USER_AGENT, Accept: "application/json" };
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
  // Sans clé ORS : Nominatim, puis Photon quand Nominatim ne rend rien (refus des serveurs de Supabase, lieu introuvable).
  const chercher = async (v: string) => {
    if (moteur === "ors") return lireGeocode(await appel(`${orsUrl}${ORS_GEOCODE}?${parametresGeocode(v)}`, { method: "GET" }));
    return lireNominatim(await appel(`${NOMINATIM_BASE}/search?${parametresNominatim(v)}`)) || lirePhoton(await appel(`${PHOTON_BASE}/api/?${parametresPhoton(v)}`));
  };
  const geo = new Map<string, { lon: number; lat: number; label: string } | null>();
  const situer = async (lieu: string) => {
    const k = cleZone(lieu);
    if (geo.has(k)) return geo.get(k)!;
    let g: { lon: number; lat: number; label: string } | null = null;
    const connu = await sb.from("lieux_geo").select("lon, lat, label").eq("entite_id", entiteId).eq("cle", k).or(`origine.eq.saisie,maj_le.gte."${valideDepuis}"`).maybeSingle();
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
      if (g) await sb.from("lieux_geo").upsert({ entite_id: entiteId, cle: k, nom: lieu.slice(0, 160), lon: g.lon, lat: g.lat, label: g.label, origine: moteur === "ors" ? "ors" : "nominatim", a_verifier: true }, { onConflict: "entite_id,cle" });
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
          const cache = await sb.from("trajets_ors").select("duree_min, distance_km, ferry, moteur").eq("entite_id", entiteId).eq("cle", cle).gte("maj_le", valideDepuis).maybeSingle();
          if (cache.data) return { ...cache.data, de_trouve: a.label, vers_trouve: b.label };
          const r = moteur === "ors" ? lireItineraire(await appel(`${orsUrl}${ORS_ITINERAIRE}`, { method: "POST", body: JSON.stringify(corpsItineraire(a, b)) })) : lireOsrm(await appel(`${OSRM_BASE}${cheminOsrm(a, b)}`));
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
  const systeme = consignes({ entreprise: ent.data?.nom || "", reglages, lieu: ra.lieu, prenomEquipe: ra.responsable });
  const contexte = contexteDuJour({ aujourdhui, jour: jourSemaine(aujourdhui), lieuCourt: lieuCourt(ra.lieu), dossier: dossierRelie });
  const messages = historique(debutValide([...(anciens.data || [])].reverse()));
  const memo = memoDepuis([...messages, { role: "user", content: message }], { signer: signe(reglages), prestataires, entreprise: ent.data?.nom || "", prenoms: [ra.responsable, "Anaïs", "Nani"].filter(Boolean) });
  const ctx = { charger, chercherClients, dossierPour, parRef, hotelsPour, reglages, ors, simule: simules ? tempsSimule : null, estimerWeb, situerWeb, notes, moteur, maintenant: () => Date.now() };
  const modele = Deno.env.get("AGENT_MODELE") || MODELE_DEFAUT;

  const debut = Date.now();
  const flux = new TransformStream<Uint8Array, Uint8Array>();
  const ecrivain = flux.writable.getWriter();
  const enc = new TextEncoder();
  const envoyer = (ev: Record<string, unknown>) => ecrivain.write(enc.encode(`${JSON.stringify(ev)}\n`)).catch(() => {});

  // Ajoute un message à l'historique et à la base (avec la session de la personne). Un échec d'écriture arrête l'échange : sans historique
  // complet, la conversation ne pourrait pas reprendre.
  const garder = async (role: "user" | "assistant", contenu: unknown) => {
    messages.push({ role, content: contenu });
    const { error } = await sb.from("agent_messages").insert({ conversation_id: conv!.id, role, contenu });
    if (error) throw new Error(`message non enregistré : ${error.message}`);
  };

  (async () => {
    let statut = "ok";
    let dernierTexte = "";
    let motifErreur = "";
    try {
      await envoyer({ t: "conversation", id: conv!.id, titre: conv!.titre, dossier_id: conv!.dossier_id });
      await garder("user", [{ type: "text", text: message }]);
      const garderCarte = async (carte: { genre: string; titre: string; donnees: unknown; avertissements?: string[] }) => {
        const c = await sb.from("agent_cartes").insert({ conversation_id: conv!.id, genre: carte.genre, titre: carte.titre, donnees: carte.donnees, avertissements: carte.avertissements || [] }).select("id, genre, titre, donnees, avertissements, statut, cree_le").single();
        return c.error ? null : c.data;
      };
      const r = await tourner({ anthropic, modele, systeme, contexte, messages, ctx, memo, garder, garderCarte, envoyer, appels, debut });
      statut = r.statut;
      dernierTexte = r.dernierTexte;
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) statut = "occupe";
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
      await envoyer({ t: "erreur", erreur: statut === "occupe" ? "occupe" : statut === "cle_refusee" ? "non_configure" : "indisponible", ...(statut.startsWith("erreur") && detail ? { detail } : {}) });
    }
    // Après une panne, l'aperçu de la conversation dit son motif (le prochain échange réussi le remplace).
    await sb.from("agent_conversations").update({ maj_le: new Date().toISOString(), apercu: (motifErreur ? `Erreur : ${motifErreur}` : dernierTexte || message).replace(/\s+/g, " ").slice(0, 200) }).eq("id", conv!.id);
    const ligne = ligneJournal({ userId, entiteId, statut, appels, dureeMs: Date.now() - debut });
    const { error: errJ } = await admin.from("assistant_journal").insert(ligne);
    if (errJ) console.error("journal de l'agent non écrit :", errJ.message);
    await envoyer({ t: "fin", statut, cout_usd: ligne.cout_estime_usd, modele: ligne.modele });
    await ecrivain.close().catch(() => {});
  })();

  return new Response(flux.readable, { headers: { ...entetes(req, "application/x-ndjson; charset=utf-8"), "Cache-Control": "no-store" } });
});
