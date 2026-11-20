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
import { memoDepuis, refDe, tempsSimule } from "./outils.js";
import { tourner } from "./boucle.js";
import { NOMINATIM_BASE, ORGANISATIONS_OSRM, ORS_BASE, ORS_GEOCODE, ORS_ITINERAIRE, OSRM_BASE, USER_AGENT, cheminOsrm, clePaire, cleZone, corpsItineraire, delaiAvant, lireGeocode, lireItineraire, lireNominatim, lireOsrm, parametresGeocode, parametresNominatim, variantesLieu } from "./temps.js";
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
    if (!cache.has(nom)) {
      if (nom === "clients") {
        cache.set(
          nom,
          (async () => {
            const propres = (await paginer("clients", "id, prenom, nom, telephone", (q) => q.eq("entite_id", entiteId))) as { id: string }[];
            // Les clients partagés d'une autre entreprise qui ont un dossier ici.
            const ids = new Set(propres.map((c) => c.id));
            const manquants = [...new Set(((await charger("dossiers")) as { client_id: string }[]).map((d) => d.client_id))].filter((id) => id && !ids.has(id));
            for (let i = 0; i < manquants.length; i += 200) propres.push(...((await paginer("clients", "id, prenom, nom, telephone", (q) => q.in("id", manquants.slice(i, i + 200)))) as { id: string }[]));
            return propres;
          })()
        );
      } else cache.set(nom, paginer(nom, COLONNES[nom], (q) => q.eq("entite_id", entiteId)));
    }
    return cache.get(nom)!;
  };

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
  const appel = async (url: string, init: RequestInit = {}) => {
    const hote = new URL(url).host;
    const attente = delaiAvant(derniers, hote, Date.now());
    if (attente) await new Promise((ok) => setTimeout(ok, attente));
    const entetes = moteur === "ors" && hote === new URL(orsUrl).host ? { Authorization: cleOrs!, "Content-Type": "application/json" } : { "User-Agent": USER_AGENT, Accept: "application/json" };
    const rep = await fetch(url, { ...init, headers: { ...entetes, ...(init.headers || {}) }, signal: AbortSignal.timeout(10_000) });
    if (!rep.ok) {
      console.error("agent : itinéraire", hote, rep.status);
      return null;
    }
    return rep.json();
  };
  const chercher = (v: string) => (moteur === "ors" ? appel(`${orsUrl}${ORS_GEOCODE}?${parametresGeocode(v)}`, { method: "GET" }).then(lireGeocode) : appel(`${NOMINATIM_BASE}/search?${parametresNominatim(v)}`).then(lireNominatim));
  const geo = new Map<string, { lon: number; lat: number; label: string } | null>();
  const situer = async (lieu: string) => {
    const k = cleZone(lieu);
    if (geo.has(k)) return geo.get(k)!;
    let g: { lon: number; lat: number; label: string } | null = null;
    const connu = await sb.from("lieux_geo").select("lon, lat, label").eq("entite_id", entiteId).eq("cle", k).maybeSingle();
    if (connu.data) g = { lon: Number(connu.data.lon), lat: Number(connu.data.lat), label: connu.data.label };
    else {
      // Plusieurs écritures du même lieu (nom thaï, nom latin) : la première trouvée par OpenStreetMap.
      for (const v of variantesLieu(lieu, (await charger("hotels_lieux")) as { cle: string; zone: string; lieu: string }[])) {
        g = await chercher(v);
        if (g) break;
      }
      // Trouvé par la plage de l'hôtel (variante) : le libellé le dit, pour que la personne voie que c'est approché.
      if (g) await sb.from("lieux_geo").upsert({ entite_id: entiteId, cle: k, nom: lieu.slice(0, 160), lon: g.lon, lat: g.lat, label: g.label, origine: moteur === "ors" ? "ors" : "nominatim", a_verifier: true }, { onConflict: "entite_id,cle" });
    }
    geo.set(k, g);
    return g;
  };
  const ors = moteur
    ? async (de: string, vers: string, coords: { de?: { lat: number; lon: number }; vers?: { lat: number; lon: number } } | null = null) => {
        try {
          const cle = clePaire(de, vers);
          const cache = await sb.from("trajets_ors").select("duree_min, distance_km, ferry, de_trouve, vers_trouve, moteur").eq("entite_id", entiteId).eq("cle", cle).maybeSingle();
          if (cache.data) return cache.data;
          // Les coordonnées d'un port données dans la table passent avant la recherche ; deux recherches l'une après l'autre (cadence).
          const a = coords && coords.de ? { ...coords.de, label: de } : await situer(de);
          const b = coords && coords.vers ? { ...coords.vers, label: vers } : await situer(vers);
          if (!a || !b) return null;
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
    if (!hotels.length || !lieux.length) return null;
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
  const ctx = { charger, reglages, ors, simule: simules ? tempsSimule : null, estimerWeb, situerWeb, maintenant: () => Date.now() };
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
      console.error("agent :", statut, err instanceof Error ? err.message.slice(0, 200) : "");
      await envoyer({ t: "erreur", erreur: statut === "occupe" ? "occupe" : statut === "cle_refusee" ? "non_configure" : "indisponible" });
    }
    await sb.from("agent_conversations").update({ maj_le: new Date().toISOString(), apercu: (dernierTexte || message).replace(/\s+/g, " ").slice(0, 200) }).eq("id", conv!.id);
    const ligne = ligneJournal({ userId, entiteId, statut, appels, dureeMs: Date.now() - debut });
    const { error: errJ } = await admin.from("assistant_journal").insert(ligne);
    if (errJ) console.error("journal de l'agent non écrit :", errJ.message);
    await envoyer({ t: "fin", statut, cout_usd: ligne.cout_estime_usd, modele: ligne.modele });
    await ecrivain.close().catch(() => {});
  })();

  return new Response(flux.readable, { headers: { ...entetes(req, "application/x-ndjson; charset=utf-8"), "Cache-Control": "no-store" } });
});
