// Stockage réel : Supabase (Postgres) avec connexion e-mail et mot de passe.
// Les droits sont appliqués par la base (règles RLS), pas par ce fichier.
import { createClient } from "../vendor/supabase.mjs";
import { tr } from "./i18n.mjs";
import { separerNets, fusionnerNets } from "./nets-documents.mjs";
import { CLE_HORS_LIGNE } from "./feuille-hors-ligne-lecture.mjs";
import { lireRetourLien } from "./compte-calc.mjs";
import { avecNomsLies } from "./partage-clients-calc.mjs";
import { estCoupure, delaiReabonnement, doitReabonner } from "./direct-reprise-calc.mjs";
import { FENETRE_MESSAGE, fusionnerFenetre } from "./whatsapp-relie-calc.mjs";

// La copie de la feuille du jour gardée sur ce téléphone ne survit pas à une déconnexion.
const effacerCopieHorsLigne = () => {
  try {
    localStorage.removeItem(CLE_HORS_LIGNE);
  } catch {
    // stockage indisponible : rien à effacer
  }
};

// Ordre d'import imposé par les clés étrangères. Les partenaires passent avant les dossiers : un dossier porte son apporteur (dossiers.apporteur_id,
// migration 68). Les partenaires ne dépendent que de l'entreprise, leurs données privées que d'eux.
const TABLES = ["partenaires", "partenaires_prives", "clients", "dossiers", "documents", "paiements", "catalogue", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets", "taches"];
// Documents et paiements ne se chargent pas à la connexion : ils sont lourds et nombreux. Chaque dossier porte un
// résumé (total, encaissé, devise) tenu à jour par la base, le détail se charge à l'ouverture du dossier.
// Les tables de nets reviennent vides pour qui n'a pas le droit « partenaires.nets » : la base filtre.
const CHARGEES = ["clients", "dossiers", "catalogue", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets"];
const LIMITE_FICHIER = 10 * 1024 * 1024;
const PAGE = 1000;
// Colonne de tri de chaque table (toutes n'ont pas de created_at).
const TRI = { membres: "entite_id", reglages: "entite_id", dossiers_resume: "dossier_id", partenaires_prives: "partenaire_id", prestations_nets: "prestation_id", trajets_nets: "trajet_id", reservations_nets: "reservation_id" };

// Modification refusée : la ligne a été modifiée par quelqu'un d'autre depuis qu'on l'a lue (son `updated_at` a changé).
function conflit() {
  const e = new Error(tr("Cette fiche a été modifiée par quelqu'un d'autre depuis que vous l'avez ouverte."));
  e.conflit = true;
  return e;
}

function verifie({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// Le résumé tenu par la base est fusionné dans le dossier : ses colonnes sont COLONNES_RESUME (sauvegarde.mjs), que la sauvegarde retire avant d'écrire le fichier.
// Les montants à confirmer d'un refus « montant_a_confirmer » de whatsapp-envoi (nombres seulement).
const montantsLus = (lu) => (lu && Array.isArray(lu.a_confirmer) ? lu.a_confirmer.map(Number).filter((x) => Number.isFinite(x) && x > 0) : []);
const fusion = (dossier, r) => (r ? { ...dossier, total: Number(r.total), devise: r.devise, recu: Number(r.recu), sur_place: Number(r.sur_place) || 0 } : dossier);

// Le catalogue (partenaires, tarifs, trajets et leurs nets) pèse l'essentiel de la lecture et ne change presque jamais : à la synchronisation de chaque minute on ne le relit
// que s'il a changé (nombre de lignes, ou dernière modification des tables qui en ont une), ou au plus tard après un quart d'heure (les nets n'ont pas de date de modification).
const CATALOGUE = ["partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets"];
// Seules ces deux tables ont une colonne `updated_at` (vérifié sur la base) : les trajets et les tables de nets ne se comptent que.
const AVEC_DATE = ["partenaires", "prestations"];
const CATALOGUE_AGE_MAX = 15 * 60 * 1000;

// Colonnes lues de l'organisation. Une colonne ajoutée par une migration pas encore passée (42703 dans Postgres, PGRST204 ou « column … does
// not exist » via PostgREST) ne doit pas empêcher de lire les autres.
export const COLONNES_ORGANISATION = "id, nom, fuseau, langue, statut, options, created_at";
export const colonneAbsente = (error, colonne) => !!error && (error.code === "42703" || error.code === "PGRST204" || new RegExp(`column [^ ]*${colonne}[^ ]* does not exist|Could not find the '${colonne}' column`, "i").test(error.message || ""));

export function creer(config, { client, maintenant = () => Date.now() } = {}) {
  // Retour d'un lien d'invitation ou de mot de passe (lot D) : lu AVANT que la bibliothèque n'ouvre la session et n'efface l'adresse.
  // Une erreur (lien expiré) est effacée de l'adresse ici : elle n'est pas un écran de l'outil.
  let retour = typeof location !== "undefined" ? lireRetourLien(location.hash) : { type: null, erreur: null };
  if (retour.erreur && typeof history !== "undefined") history.replaceState(null, "", location.pathname + location.search);
  const sb = client || createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  // Adresse de retour des liens : l'outil lui-même (elle doit figurer dans les « Redirect URLs » de Supabase, voir mise-en-route.md).
  const adresseOutil = () => `${location.origin}${location.pathname}`;

  // Migration 16 : les nets des documents sont dans documents_nets (la table existe pour tout le monde, mais ne renvoie rien sans le droit « nets »).
  // La détection ne garde en mémoire que ce qui est sûr : « la table est là » (vrai) ou « la table n'existe pas » (faux, migration 16 pas appliquée).
  // Une coupure ou une erreur passagère n'est PAS gardée : elle remonte, et la détection est refaite à l'appel suivant. Avant, un échec de la première
  // requête valait « pas de table » pour toute la session, et les nets d'un devis étaient alors écrits dans son contenu, lisible avec le seul droit finances.
  let netsSepares = null;
  const tableAbsente = (e) => e && (e.code === "42P01" || e.code === "PGRST205" || /relation "[^"]*documents_nets" does not exist|Could not find the table ['"]?(public\.)?documents_nets/i.test(e.message || ""));
  const separation = () => {
    if (netsSepares !== null) return Promise.resolve(netsSepares);
    return Promise.resolve(sb.from("documents_nets").select("document_id").limit(1)).then(({ error }) => {
      if (!error) return (netsSepares = true);
      if (tableAbsente(error)) return (netsSepares = false);
      throw new Error(error.message);
    });
  };
  // Documents dont on a lu une ligne de nets : seuls ceux-là peuvent voir leurs nets vidés (lot I, contrôle du 17.11.2026). Qui ne lit pas les nets
  // n'en efface jamais.
  const avecNetsLus = new Set();
  // Nets de documents, par identifiant de document. Sans le droit « nets », la base ne renvoie rien : les lignes restent sans net.
  async function netsDes(ids) {
    const par = {};
    if (!ids.length || !(await separation())) return par;
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await sb.from("documents_nets").select("document_id, nets").in("document_id", ids.slice(i, i + 100));
      // Une erreur ici ne doit pas passer pour « aucun net » : une sauvegarde suivante écraserait les nets avec les seules lignes visibles.
      if (error) throw new Error(error.message);
      for (const n of data || []) (par[n.document_id] = n.nets), avecNetsLus.add(n.document_id);
    }
    return par;
  }
  const avecNets = async (documents) => {
    const par = await netsDes(documents.map((d) => d.id));
    return documents.map((d) => (par[d.id] ? { ...d, contenu: fusionnerNets(d.contenu, par[d.id]) } : d));
  };
  // Écrit un document sans ses nets, puis les nets à part (seulement s'il y en a : qui n'en voit pas n'en écrit pas).
  async function ecrireDocument(ecriture, contenuComplet) {
    if (!contenuComplet) return verifie(await ecriture(contenuComplet));
    const { contenu, nets } = separerNets(contenuComplet);
    // Les nets ne vont JAMAIS dans le contenu : sans la table, un document qui en porte est refusé (un document sans net s'enregistre normalement).
    if (!(await separation())) {
      if (Object.keys(nets).length) throw new Error(tr("Les prix nets ne peuvent pas être enregistrés : la migration 16 de la base n'est pas appliquée."));
      return verifie(await ecriture(contenu));
    }
    const ligne = verifie(await ecriture(contenu));
    // Un net effacé exprès reste effacé, un net que le contenu ne porte pas reste (lot I, revue du lot J). Pour un document lu avec ses nets :
    // une ligne qui a la clé `net` prend sa valeur (vide = effacé), une ligne sans la clé (version restaurée, contenu venu d'ailleurs) garde le
    // net enregistré. Avant, le dernier net effacé revenait au chargement suivant.
    let aEcrire = Object.keys(nets).length ? nets : null;
    if (avecNetsLus.has(ligne.id)) {
      const ancien = (verifie(await sb.from("documents_nets").select("nets").eq("document_id", ligne.id).maybeSingle()) || {}).nets || {};
      aEcrire = {};
      for (const l of contenuComplet.lignes || []) {
        if (!l || !l.id) continue;
        if ("net" in l) { if (nets[l.id] !== undefined) aEcrire[l.id] = nets[l.id]; }
        else if (ancien[l.id] !== undefined && ancien[l.id] !== null) aEcrire[l.id] = ancien[l.id];
      }
    }
    if (aEcrire) {
      verifie(await sb.from("documents_nets").upsert({ document_id: ligne.id, entite_id: ligne.entite_id, nets: aEcrire }).select());
      avecNetsLus.add(ligne.id);
    }
    return { ...ligne, contenu: fusionnerNets(ligne.contenu, aEcrire || nets) };
  }

  // Marqueur du catalogue : une lecture minuscule par table (un comptage, et la dernière modification quand la table en a une).
  async function empreinteCatalogue() {
    const parties = await Promise.all(CATALOGUE.flatMap((t) => [
      sb.from(t).select("id", { count: "exact", head: true }).then(({ count, error }) => { if (error) throw new Error(error.message); return `${t}:${count}`; }),
      ...(AVEC_DATE.includes(t) ? [sb.from(t).select("updated_at").order("updated_at", { ascending: false }).limit(1).then(({ data, error }) => { if (error) throw new Error(error.message); return `${t}@${(data && data[0] && data[0].updated_at) || ""}`; })] : []),
    ]));
    return parties.join("|");
  }
  let empreinte = null;
  let catalogueLuA = 0;
  let catalogueAChange = true;
  let enDeconnexion = false;

  async function toutes(table) {
    const lignes = [];
    for (let debut = 0; ; debut += PAGE) {
      const page = verifie(await sb.from(table).select("*").order(TRI[table] || "created_at").range(debut, debut + PAGE - 1));
      lignes.push(...page);
      if (page.length < PAGE) return lignes;
    }
  }

  // Demandes et bandeau du site (migration 30) : les deux tables manquent tant que la migration n'est pas appliquée. On le dit à l'écran
  // (`site_disponible` faux) au lieu d'échouer : le reste de l'outil se charge comme avant. Les demandes : les 1 000 plus récentes suffisent
  // (quelques-unes par jour), la base filtre déjà par entreprise et par rôle.
  async function lireSite() {
    const lire = async (table, requete) => {
      const { data, error } = await requete;
      if (!error) return data || [];
      if (error.code === "42P01" || error.code === "PGRST205" || new RegExp(`relation "[^"]*${table}" does not exist|Could not find the table`, "i").test(error.message || "")) return null;
      throw new Error(error.message);
    };
    const [demandes, bandeaux] = await Promise.all([
      lire("demandes_site", sb.from("demandes_site").select("*").order("created_at", { ascending: false }).limit(1000)),
      lire("bandeaux_site", sb.from("bandeaux_site").select("*").order("created_at", { ascending: false }).limit(200)),
    ]);
    return { demandes_site: demandes || [], bandeaux_site: bandeaux || [], site_disponible: demandes !== null && bandeaux !== null };
  }

  // Boîte WhatsApp (migrations 58 et 59) : conversations, propositions de l'agent et réglage de réception. La base ne rend rien à qui n'est pas
  // administrateur de Secret ou de Taxi. Tant qu'une migration manque, on le dit à l'écran (`whatsapp_disponible`, `whatsapp_propositions_disponible`)
  // au lieu d'échouer. Les messages se lisent à l'ouverture d'une conversation (whatsappMessages), comme les documents d'un dossier.
  async function lireWhatsApp() {
    const lire = async (table, requete) => {
      const { data, error } = await requete;
      if (!error) return data || [];
      if (error.code === "42P01" || error.code === "PGRST205" || new RegExp(`relation "[^"]*${table}" does not exist|Could not find the table`, "i").test(error.message || "")) return null;
      throw new Error(error.message);
    };
    // Les 1 000 propositions les plus récentes suffisent : seule la plus récente de chaque conversation compte à l'écran.
    // reponses et tri (migration 60) : relues sans ces colonnes tant que la migration n'est pas appliquée.
    const COLONNES = "id, created_at, updated_at, organisation_id, telephone, nom, entite_id, entite_source, client_id, dossier_id, dernier_message_le, dernier_sens, non_lus";
    // resume, resume_le, paiement_signale, promesse_le (migration 62) : relues sans elles tant que la migration n'est pas appliquée.
    const SUIVI = "resume, resume_le, paiement_signale, promesse_le";
    // dernier_texte, dernier_type, attend_depuis (migration 65, aperçu de la liste) : relues sans elles tant que la migration n'est pas appliquée.
    const APERCU = "dernier_texte, dernier_type, attend_depuis";
    // type_contact, partenaire_id (migration 68, contacts typés) : relues sans elles tant que la migration n'est pas appliquée.
    const CONTACTS = "type_contact, partenaire_id";
    let triDisponible = true;
    let suiviDisponible = true;
    let contactsDisponible = true;
    // nom_source (migration 70, nom saisi à la main) : relue sans elle tant que la migration n'est pas appliquée ; l'écran n'offre pas le crayon.
    let nomDisponible = true;
    // pret_reserver, pret_retire_le (migration 85, filtre « Prêt à réserver ») : ajoutées à toutes les lectures ; absentes, on relit sans elles
    // et l'écran n'offre pas le filtre.
    const PRET = "pret_reserver, pret_retire_le";
    let pretDisponible = true;
    // avancee, etape_manuelle (migration 105, étapes des clients) : ajoutées à toutes les lectures ; absentes, on relit sans elles et l'écran
    // garde l'ancienne liste.
    const ETAPES = "avancee, etape_manuelle, ia_coupee";
    let etapesDisponible = true;
    // type_source, type_avis, type_signaux (migration 110, type du contact déduit) : ajoutées à toutes les lectures ; absentes, on relit sans
    // elles et l'écran ne montre pas « Partenaire déduit ».
    const TYPE = "type_source, type_avis, type_signaux";
    let typeDisponible = true;
    // manque_le, bsuid, meme_client_que (migration 100, message du client qui semble manquer, nouveau numéro) : relues sans elles tant que
    // la migration n'est pas appliquée. Gardé d'une lecture à l'autre, comme PRET et ETAPES (relecture de la PR 317) : une colonne absente
    // ne relance pas une lecture en échec à chaque rafraîchissement.
    let manquesDisponible = true;
    const lireConversations = async () => {
      const requete = (colonnes) => sb.from("whatsapp_conversations").select([colonnes, pretDisponible ? PRET : "", pretDisponible && etapesDisponible ? ETAPES : "", typeDisponible ? TYPE : ""].filter(Boolean).join(", ")).order("dernier_message_le", { ascending: false, nullsFirst: false }).limit(500);
      const BASE = `${COLONNES}, reponses, tri, ${SUIVI}, ${APERCU}, ${CONTACTS}, nom_source`;
      const lireBase = () => requete(manquesDisponible ? `${BASE}, manque_le, bsuid, meme_client_que` : BASE);
      let r = await lireBase();
      // Chaque migration récente (85, 100, 105, 110) peut manquer seule : on retire ses colonnes, puis on relit. Sans la 85, pas d'étapes non plus.
      for (let essai = 0; essai < 4 && r.error; essai++) {
        if (typeDisponible && TYPE.split(", ").some((c) => colonneAbsente(r.error, c))) typeDisponible = false;
        else if (pretDisponible && etapesDisponible && ETAPES.split(", ").some((c) => colonneAbsente(r.error, c))) etapesDisponible = false;
        else if (pretDisponible && PRET.split(", ").some((c) => colonneAbsente(r.error, c))) {
          pretDisponible = false;
          etapesDisponible = false;
        } else if (manquesDisponible && ["manque_le", "bsuid", "meme_client_que"].some((c) => colonneAbsente(r.error, c))) manquesDisponible = false;
        else break;
        r = await lireBase();
      }
      if (r.error && colonneAbsente(r.error, "nom_source")) {
        nomDisponible = false;
        r = await requete(`${COLONNES}, reponses, tri, ${SUIVI}, ${APERCU}, ${CONTACTS}`);
      }
      // Une colonne manque : la 68 n'est pas passée (elle suit toutes les autres), on relit comme avant elle.
      if (r.error && [...CONTACTS.split(", "), ...APERCU.split(", "), ...SUIVI.split(", "), "reponses", "tri"].some((c) => colonneAbsente(r.error, c))) {
        contactsDisponible = false;
        nomDisponible = false;
        r = await requete(`${COLONNES}, reponses, tri, ${SUIVI}, ${APERCU}`);
      }
      if (r.error && APERCU.split(", ").some((c) => colonneAbsente(r.error, c))) r = await requete(`${COLONNES}, reponses, tri, ${SUIVI}`);
      if (r.error && SUIVI.split(", ").some((c) => colonneAbsente(r.error, c))) {
        suiviDisponible = false;
        r = await requete(`${COLONNES}, reponses, tri`);
      }
      if (r.error && (colonneAbsente(r.error, "reponses") || colonneAbsente(r.error, "tri"))) {
        triDisponible = false;
        return lire("whatsapp_conversations", requete(COLONNES));
      }
      return lire("whatsapp_conversations", Promise.resolve(r));
    };
    const [conversations, propositions, reglages] = await Promise.all([
      lireConversations(),
      lire("whatsapp_propositions", sb.from("whatsapp_propositions").select("id, cree_le, conversation_id, message_id, entite_id, statut, texte, langue, avertissements, entreprise_proposee, erreur, traitee_le, traitee_par_quoi").order("cree_le", { ascending: false }).limit(1000)),
      // Message de nuit (migration 132) : relu sans ses colonnes tant que la migration n'est pas appliquée.
      (async () => {
        const COLS = "organisation_id, reception_active, numero, etat_compte, etat_le, dernier_evenement_le, updated_at";
        let r = await sb.from("whatsapp_reglages").select(`${COLS}, nuit_active, nuit_texte, nuit_debut, nuit_fin, nuit_modifie_le`);
        if (colonneAbsente(r.error, "nuit_active")) r = await sb.from("whatsapp_reglages").select(COLS);
        return lire("whatsapp_reglages", Promise.resolve(r));
      })(),
    ]);
    return {
      whatsapp_conversations: conversations || [],
      whatsapp_propositions: propositions || [],
      whatsapp_reglages: reglages || [],
      whatsapp_disponible: conversations !== null && reglages !== null,
      whatsapp_propositions_disponible: propositions !== null,
      whatsapp_tri_disponible: conversations !== null && triDisponible,
      whatsapp_suivi_disponible: conversations !== null && suiviDisponible,
      whatsapp_contacts_disponible: conversations !== null && contactsDisponible,
      whatsapp_nom_disponible: conversations !== null && nomDisponible,
      whatsapp_pret_disponible: conversations !== null && pretDisponible,
      whatsapp_etapes_disponible: conversations !== null && pretDisponible && etapesDisponible,
    };
  }

  // L'organisation de la personne connectée (migration 42) : nom, fuseau, langue. Avant la migration la table manque : liste vide, rien ne casse.
  // `libelle_admin` (migration 44) : relu sans cette colonne tant que la base ne l'a pas.
  async function lireOrganisations() {
    let { data, error } = await sb.from("organisations").select(`${COLONNES_ORGANISATION}, libelle_admin`);
    if (error && colonneAbsente(error, "libelle_admin")) ({ data, error } = await sb.from("organisations").select(COLONNES_ORGANISATION));
    if (!error) return data || [];
    if (error.code === "42P01" || error.code === "PGRST205" || /relation "[^"]*organisations" does not exist|Could not find the table/i.test(error.message || "")) return [];
    throw new Error(error.message);
  }

  // Fiches clients partagées (migration 46) : le réglage de l'organisation, et le nom des clients d'une autre entreprise aux dossiers que la
  // personne voit sans lire leur fiche (l'assistante de Secret au client ZTP). Avant la migration : rien, l'outil marche comme avant.
  async function lirePartages() {
    const absente = (e) => e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42883" || /does not exist|Could not find the (table|function)/i.test(e.message || ""));
    const [p, l] = await Promise.all([sb.from("partages_clients").select("source_id, cible_id, organisation_id"), sb.rpc("clients_lies")]);
    if (p.error && !absente(p.error)) throw new Error(p.error.message);
    if (l.error && !absente(l.error)) throw new Error(l.error.message);
    return { partages_clients: p.error ? [] : p.data || [], lies: l.error ? [] : l.data || [] };
  }

  // Fiabilité du direct (20.11.2026) : sur CHANNEL_ERROR, TIMED_OUT ou CLOSED, le canal est retiré, le jeton de session rafraîchi et passé à
  // Realtime, puis le canal refait après 1, 2, 5, 10 puis 30 s (direct-reprise-calc.mjs). Un jeton expiré pendant que l'iPhone dormait est la
  // cause la plus fréquente : sans réabonnement, la page restait sourde jusqu'au prochain rechargement.
  async function rafraichirJeton() {
    try {
      const { data } = await sb.auth.getSession();
      const jeton = data && data.session && data.session.access_token;
      if (jeton && sb.realtime && typeof sb.realtime.setAuth === "function") await sb.realtime.setAuth(jeton);
    } catch (err) {
      console.warn(err);
    }
  }
  // Un jeton renouvelé par la bibliothèque (ou une nouvelle connexion) part aussi vers Realtime. Inscrit une seule fois.
  let jetonSuivi = false;
  function suivreJeton() {
    if (jetonSuivi || !sb.auth || typeof sb.auth.onAuthStateChange !== "function") return;
    jetonSuivi = true;
    sb.auth.onAuthStateChange((evenement, session) => {
      if ((evenement === "TOKEN_REFRESHED" || evenement === "SIGNED_IN") && session && session.access_token && sb.realtime && typeof sb.realtime.setAuth === "function") {
        Promise.resolve(sb.realtime.setAuth(session.access_token)).catch(() => {});
      }
    });
  }
  // Un canal qui se répare seul. `surEtat(etat)` : « connexion », « abonne » ou « coupe ». Renvoie { arreter, verifier, etat }.
  function canalFiable(nom, tables, rappel, surEtat = () => {}) {
    let ch = null;
    let arrete = false;
    let essai = 0;
    let minuteur = null;
    let etatCourant = "connexion";
    const poser = (e) => {
      if (e === etatCourant) return;
      etatCourant = e;
      surEtat(e);
    };
    const creer = () => {
      const moi = sb.channel(nom);
      ch = moi;
      for (const t of tables) moi.on("postgres_changes", { event: "*", schema: "public", table: t }, () => rappel(t));
      moi.subscribe((statut, err) => {
        // Un canal retiré par nous (réabonnement, arrêt) envoie CLOSED : ce n'est plus le canal courant, on l'ignore.
        if (arrete || moi !== ch) return;
        if (statut === "SUBSCRIBED") {
          essai = 0;
          return poser("abonne");
        }
        if (estCoupure(statut)) {
          console.warn(`${nom === "gestion-whatsapp" ? "WhatsApp" : "Gestion"} en direct indisponible (${statut}), nouvel essai dans ${delaiReabonnement(essai) / 1000} s`, err || "");
          poser("coupe");
          planifier();
        }
      });
    };
    const retirer = async () => {
      const vieux = ch;
      ch = null;
      if (vieux) await Promise.resolve(sb.removeChannel(vieux)).catch(() => {});
    };
    const relancer = async () => {
      clearTimeout(minuteur);
      minuteur = null;
      await retirer();
      if (arrete) return;
      await rafraichirJeton();
      if (arrete || ch) return;
      creer();
    };
    function planifier() {
      if (minuteur || arrete) return;
      minuteur = setTimeout(relancer, delaiReabonnement(essai++));
    }
    suivreJeton();
    creer();
    return {
      arreter() {
        arrete = true;
        clearTimeout(minuteur);
        const vieux = ch;
        ch = null;
        if (vieux) sb.removeChannel(vieux);
      },
      // Retour sur l'onglet, réseau revenu, page restaurée : un canal qui n'est pas « joined » est refait tout de suite (jeton rafraîchi).
      async verifier({ forcer = false } = {}) {
        if (arrete) return;
        if (ch && !forcer && !doitReabonner(ch.state)) return void (await rafraichirJeton());
        // Reconnexion forcée : l'état repart de zéro sans rien annoncer, pour que le retour à « abonné » soit signalé (et la boîte relue).
        if (forcer) etatCourant = "reconnexion";
        if (minuteur) clearTimeout(minuteur), (minuteur = null);
        essai = 0;
        await relancer();
      },
      etat: () => etatCourant,
    };
  }

  // En direct (Supabase Realtime, migration 47) : `rappel(table)` à chaque ligne ajoutée, changée ou retirée dans ces tables. La base ne
  // prévient que les personnes qui peuvent lire la ligne (règles RLS) ; l'outil s'en sert seulement pour relire, jamais pour écrire le contenu reçu.
  // Sans la migration, aucun événement n'arrive et la relecture de chaque minute reste. Renvoie de quoi se désabonner.
  let canal = null;
  function ecouter(tables, rappel) {
    if (canal) canal.arreter();
    const moi = canalFiable("gestion-direct", tables, rappel);
    canal = moi;
    return () => {
      moi.arreter();
      if (canal === moi) canal = null;
    };
  }
  // Boîte WhatsApp en direct : un canal à part, pour ne pas toucher à celui des demandes du site. Même règle, seul le nom de la table remonte.
  // `surEtat` : l'état du canal (« connexion », « abonne », « coupe »), pour le repli et la pastille « Direct coupé ».
  let canalWhatsApp = null;
  function ecouterWhatsApp(tables, rappel, { surEtat = () => {} } = {}) {
    if (canalWhatsApp) canalWhatsApp.arreter();
    const moi = canalFiable("gestion-whatsapp", tables, rappel, surEtat);
    canalWhatsApp = moi;
    return () => {
      moi.arreter();
      if (canalWhatsApp === moi) canalWhatsApp = null;
    };
  }

  return {
    mode: "supabase",
    ecouter,
    ecouterWhatsApp,
    // L'état des deux canaux, pour le repli et la pastille « Direct coupé » de l'écran WhatsApp.
    etatDirect: () => ({ direct: canal ? canal.etat() : "ferme", whatsapp: canalWhatsApp ? canalWhatsApp.etat() : "ferme" }),
    // Retour sur l'onglet, réseau revenu, page restaurée : jeton rafraîchi, canaux refaits s'ils ne sont pas « joined ».
    // forcer : après une longue absence, les canaux sont refaits même s'ils se disent « joined » (socket mort au réveil).
    async reveillerDirect({ forcer = false } = {}) {
      await Promise.all([canal ? canal.verifier({ forcer }) : null, canalWhatsApp ? canalWhatsApp.verifier({ forcer }) : null]);
    },
    // Relecture ciblée de la boîte WhatsApp (conversations, propositions, réglage), sans les dossiers ni les clients. Les messages de la
    // conversation ouverte sont relus par l'écran à son redessin (whatsappMessages).
    chargerWhatsApp: () => lireWhatsApp(),
    // Les messages d'une conversation, les 500 plus récents, dans l'ordre d'envoi.
    // statut_envoi, erreur_envoi (migration 64) : relus sans eux tant que la migration n'est pas appliquée.
    // `inclure` (PR B, « aller au message ») : un message plus ancien que les 500 derniers est chargé quand même, avec une fenêtre autour de
    // lui (FENETRE_MESSAGE avant et après), ajoutée aux 500 derniers. Aussi ancien soit-il, il est trouvé.
    async whatsappMessages(conversationId, { inclure = "" } = {}) {
      const base = "id, conversation_id, sens, origine, type, texte, medias, envoye_le, modifie_le, supprime_le";
      // repere (migration 100) : relu sans lui tant que la migration n'est pas appliquée.
      // automatique (migration 132) : relu sans lui tant que la migration n'est pas appliquée.
      let colonnes = `${base}, statut_envoi, erreur_envoi, statut_le, repere, automatique`;
      const requete = (cols) => sb.from("whatsapp_messages").select(cols).eq("conversation_id", conversationId);
      let r = await requete(colonnes).order("envoye_le", { ascending: false }).limit(500);
      if (colonneAbsente(r.error, "automatique")) r = await requete((colonnes = `${base}, statut_envoi, erreur_envoi, statut_le, repere`)).order("envoye_le", { ascending: false }).limit(500);
      if (colonneAbsente(r.error, "repere")) r = await requete((colonnes = `${base}, statut_envoi, erreur_envoi, statut_le`)).order("envoye_le", { ascending: false }).limit(500);
      if (colonneAbsente(r.error, "statut_envoi")) r = await requete((colonnes = base)).order("envoye_le", { ascending: false }).limit(500);
      const lus = verifie(r).reverse();
      if (!inclure || lus.length < 500 || lus.some((m) => m.id === inclure)) return lus;
      const cible = await sb.from("whatsapp_messages").select("envoye_le").eq("id", inclure).eq("conversation_id", conversationId).maybeSingle();
      if (cible.error || !cible.data) return lus;
      const t = cible.data.envoye_le;
      const [avant, apres] = await Promise.all([
        requete(colonnes).lte("envoye_le", t).order("envoye_le", { ascending: false }).limit(FENETRE_MESSAGE + 1),
        requete(colonnes).gt("envoye_le", t).order("envoye_le", { ascending: true }).limit(FENETRE_MESSAGE),
      ]);
      return fusionnerFenetre(lus, [...verifie(avant).reverse(), ...verifie(apres)]);
    },
    // Le dernier message du client d'une conversation (sa date seulement), pour la fenêtre de 24 h du point du soir : une ligne lue au lieu de
    // 500. null s'il n'a jamais écrit ; une erreur de lecture est levée (elle n'est jamais prise pour une fenêtre fermée).
    async whatsappDernierEntrant(conversationId) {
      const r = await sb.from("whatsapp_messages").select("envoye_le").eq("conversation_id", conversationId).eq("sens", "entrant").order("envoye_le", { ascending: false }).limit(1);
      const lus = verifie(r);
      return (lus[0] && lus[0].envoye_le) || null;
    },
    // Recherche plein texte dans les messages (whatsapp_rechercher, migration 67, PR B) pour la recherche de Gestion. La base applique les droits
    // (whatsapp_lit) et écarte les contacts personnels. Sans la migration, ou en cas d'erreur, rien : la recherche marche sans WhatsApp.
    async whatsappRechercher(q, { lim = 20 } = {}) {
      const { data, error } = await sb.rpc("whatsapp_rechercher", { q: String(q || "").slice(0, 100), lim });
      if (error) {
        if (!["PGRST202", "42883"].includes(error.code)) console.warn("whatsapp_rechercher", error.message);
        return [];
      }
      return data || [];
    },
    // Lien court (5 minutes) vers une photo ou un document copié dans le stockage privé « whatsapp ». null si le fichier n'est plus là.
    async whatsappLienMedia(media, { telecharger = false } = {}) {
      if (!media || !media.chemin) return null;
      const { data, error } = await sb.storage.from("whatsapp").createSignedUrl(media.chemin, 300, telecharger ? { download: media.nom || true } : undefined);
      return error || !data ? null : data.signedUrl;
    },
    // Envoi depuis Gestion (fonction « whatsapp-envoi », avec le jeton de la personne). Rend { ok, message_id } ou { erreur }.
    async whatsappEnvoyer(corps) {
      const { data: s } = await sb.auth.getSession();
      const jeton = s && s.session && s.session.access_token;
      if (!jeton) return { erreur: "non_connecte" };
      let rep;
      try {
        // 40 secondes au plus (Telnyx en a 15 côté fonction) : une fonction muette ne laisse pas le bouton éteint sans fin (audit M19).
        // Délai dépassé ou coupure : résultat inconnu, l'écran demande de vérifier dans WhatsApp (le message est déjà rangé « envoi »).
        rep = await fetch(`${config.SUPABASE_URL}/functions/v1/whatsapp-envoi`, { method: "POST", headers: { Authorization: `Bearer ${jeton}`, apikey: config.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify(corps), signal: AbortSignal.timeout(40_000) });
      } catch {
        return { erreur: "hors_ligne" };
      }
      const lu = await rep.json().catch(() => null);
      if (rep.ok && lu && lu.ok) return lu;
      // Sans code lisible (passerelle, coupure), le résultat est inconnu : l'écran demande de vérifier dans WhatsApp.
      // « a_retirer » (contenu_interne) : les montants et les noms que la fonction a trouvés dans le texte. « a_confirmer »
      // (montant_a_confirmer) : les montants égaux au net d'un autre service, que la personne confirme avant de renvoyer.
      return { erreur: (lu && lu.erreur) || "inconnu", a_retirer: lu && Array.isArray(lu.a_retirer) ? lu.a_retirer.map(String) : [], a_confirmer: montantsLus(lu), masque: !!(lu && lu.masque), portee: lu && lu.portee === "autre_service" ? "autre_service" : "catalogue" };
    },
    // Voucher en image dans la conversation du client (fonction « whatsapp-envoi » en multipart, migration 73). L'image part avec la demande :
    // la fonction la dépose elle-même dans le bucket privé après tous les contrôles (aucune écriture de stockage depuis le navigateur).
    // Rend { ok, message_id } ou { erreur, a_retirer }. Délai dépassé ou coupure : résultat inconnu, l'écran dit de vérifier dans WhatsApp.
    async whatsappEnvoyerVoucher({ conversation_id, reservation_id, essai_id, legende = "", numero_confirme = "", montants_confirmes = [], fichier }) {
      const { data: s } = await sb.auth.getSession();
      const jeton = s && s.session && s.session.access_token;
      if (!jeton) return { erreur: "non_connecte" };
      const corps = new FormData();
      corps.append("conversation_id", conversation_id);
      corps.append("reservation_id", reservation_id);
      corps.append("essai_id", essai_id);
      corps.append("legende", legende);
      if (numero_confirme) corps.append("numero_confirme", numero_confirme);
      if (montants_confirmes.length) corps.append("montants_confirmes", montants_confirmes.join(","));
      corps.append("fichier", fichier, fichier.name || "voucher.png");
      let rep;
      try {
        rep = await fetch(`${config.SUPABASE_URL}/functions/v1/whatsapp-envoi`, { method: "POST", headers: { Authorization: `Bearer ${jeton}`, apikey: config.SUPABASE_ANON_KEY }, body: corps, signal: AbortSignal.timeout(60_000) });
      } catch {
        return { erreur: "hors_ligne" };
      }
      const lu = await rep.json().catch(() => null);
      if (rep.ok && lu && lu.ok) return lu;
      return { erreur: (lu && lu.erreur) || "inconnu", a_verifier: !!(lu && lu.a_verifier), a_retirer: lu && Array.isArray(lu.a_retirer) ? lu.a_retirer.map(String) : [], a_confirmer: montantsLus(lu), masque: !!(lu && lu.masque), portee: lu && lu.portee === "autre_service" ? "autre_service" : "catalogue" };
    },
    // « Préparer une réponse » (fonction whatsapp-preparer, migration 60) : 202 { ok } puis la proposition « en_cours » arrive par Realtime.
    async whatsappPreparer(conversationId) {
      const { data: s } = await sb.auth.getSession();
      const jeton = s && s.session && s.session.access_token;
      if (!jeton) return { erreur: "non_connecte" };
      let rep;
      try {
        rep = await fetch(`${config.SUPABASE_URL}/functions/v1/whatsapp-preparer`, { method: "POST", headers: { Authorization: `Bearer ${jeton}`, apikey: config.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ conversation_id: conversationId }) });
      } catch {
        return { erreur: "hors_ligne" };
      }
      const lu = await rep.json().catch(() => null);
      if (rep.ok && lu && lu.ok) return lu;
      return { erreur: (lu && lu.erreur) || "inconnu" };
    },
    // Fiches en double entre Secret et Taxi (migration 63). null tant que la fonction manque.
    async doublonsClients() {
      const { data, error } = await sb.rpc("doublons_clients_partages");
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883" || /does not exist|Could not find the function/i.test(error.message || "")) return null;
        throw new Error(error.message);
      }
      return data || [];
    },
    // Une conversation WhatsApp relue en base (liaison après validation d'un dossier dans l'Assistant). null : introuvable ou illisible.
    // type_contact (migration 68) : la conversation d'un apporteur ne se relie pas au client ; sans la colonne, la lecture d'avant.
    async whatsappConversation(id) {
      const lire = (cols) => sb.from("whatsapp_conversations").select(cols).eq("id", id).maybeSingle();
      let { data, error } = await lire("id, entite_id, client_id, dossier_id, type_contact");
      if (error && colonneAbsente(error, "type_contact")) ({ data, error } = await lire("id, entite_id, client_id, dossier_id"));
      if (error) throw new Error(error.message);
      return data || null;
    },
    // Une ligne d'import de brochure (tarif ou trajet, ligne enfant séparée, nets) en une seule transaction (migration 124). Les droits sont
    // contrôlés par la base : rend { ligne, enfant, nets } tels qu'enregistrés, ou une erreur et rien n'est écrit.
    async brochureEcrire(op) {
      const { data, error } = await sb.rpc("brochure_ecrire_ligne", { p_op: op });
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883" || /Could not find the function/i.test(error.message || "")) throw new Error("migration_124_manquante");
        throw new Error(error.message);
      }
      return data;
    },
    // Demandes du site et WhatsApp reliés (migration 72). La base vérifie tout et rend { relie, motif, demande | conversation } ;
    // null tant que la fonction manque (l'outil ne relie rien et le dit discrètement).
    async demandeSiteRelier(demandeId, dossierId) {
      const { data, error } = await sb.rpc("demande_site_relier", { p_demande: demandeId, p_dossier: dossierId });
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883" || /does not exist|Could not find the function/i.test(error.message || "")) return null;
        throw new Error(error.message);
      }
      return data || null;
    },
    // Défaire un lien posé d'office, dans les 24 heures : { delie, motif, demande }.
    async demandeSiteDelier(demandeId) {
      const { data, error } = await sb.rpc("demande_site_delier", { p_demande: demandeId });
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883" || /does not exist|Could not find the function/i.test(error.message || "")) return null;
        throw new Error(error.message);
      }
      return data || null;
    },
    async whatsappRelierApresDemande(demandeId) {
      const { data, error } = await sb.rpc("whatsapp_relier_apres_demande", { p_demande: demandeId });
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883" || /does not exist|Could not find the function/i.test(error.message || "")) return null;
        throw new Error(error.message);
      }
      return data || null;
    },
    // Une demande du site relue en base juste avant de créer son dossier : l'Assistant ou une autre personne a pu la traiter entre-temps.
    async demandeSite(id) {
      const { data, error } = await sb.from("demandes_site").select("id, statut, dossier_id, updated_at").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    // La demande que la page du carnet a enregistrée pour une référence (« AON-AB12 ») dans l'entreprise du dossier en cours, la plus récente : lue avec les droits de la personne connectée
    // (les règles de la table), null sinon ou sans entreprise. Une demande d'une autre entreprise n'est jamais rendue.
    async demandeSiteParRef(ref, entiteId) {
      if (!ref || !entiteId) return null;
      const { data, error } = await sb.from("demandes_site").select("*").eq("ref", ref).eq("entite_id", entiteId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    // Un envoi au résultat inconnu, vérifié par Nani dans WhatsApp (migration 64) : parti (le message reste, la réponse est soldée) ou pas
    // parti (le message sort du fil, la réponse redevient à faire).
    async whatsappConfirmerEnvoi(conversationId, parti) {
      const { data, error } = await sb.rpc("whatsapp_confirmer_envoi", { p_conversation: conversationId, p_parti: !!parti });
      if (error) throw new Error(/droit_manquant|42501/.test(`${error.code} ${error.message}`) ? tr("Votre rôle ne permet pas d'écrire dans cette conversation.") : error.message);
      return data || { messages: 0, propositions: 0 };
    },
    // Réglages > WhatsApp : événements en erreur, abandonnés, en retard (migration 64). null tant que la fonction manque ou sans le droit.
    async whatsappEtatReception() {
      const { data, error } = await sb.rpc("whatsapp_etat_reception");
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883" || /does not exist|Could not find the function/i.test(error.message || "")) return null;
        throw new Error(error.message);
      }
      return data || null;
    },
    // Remet en file les événements abandonnés après 5 essais. Rend le nombre remis.
    async whatsappRelancerEvenements() {
      const { data, error } = await sb.rpc("whatsapp_relancer_evenements");
      if (error) throw new Error(error.message);
      return Number(data) || 0;
    },
    // Le statut d'une proposition, relu après un refus d'écriture (déjà traitée ailleurs, ou une autre erreur).
    async whatsappProposition(id) {
      const { data, error } = await sb.from("whatsapp_propositions").select("id, statut").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    // L'interrupteur « Recevoir les messages WhatsApp » (Réglages), seule colonne des réglages WhatsApp ouverte à l'outil.
    // Message de nuit (migration 132) : whatsapp_regler_nuit contrôle les droits (administrateur de Secret ou de Taxi) et les valeurs.
    // luLe : nuit_modifie_le tel qu'il a été lu ; changé ailleurs entre-temps, refusé (modifie_ailleurs).
    async whatsappMessageNuit(organisationId, { active, texte, debut, fin, luLe = null }) {
      const { data, error } = await sb.rpc("whatsapp_regler_nuit", { p_org: organisationId, p_active: !!active, p_texte: texte, p_debut: debut, p_fin: fin, p_lu_le: luLe });
      if (error) {
        const m = String(error.message || "");
        if (/droit_manquant/.test(m) || error.code === "42501") throw new Error(tr("Modification refusée : la fiche n'existe plus ou vos droits ne la permettent pas."));
        if (/texte_vide/.test(m)) throw new Error(tr("Le message ne peut pas être vide."));
        if (/texte_trop_long/.test(m)) throw new Error(tr("Le message est trop long pour WhatsApp (4 096 octets au plus)."));
        if (/heures_invalides/.test(m)) throw new Error(tr("L'heure de début et l'heure de fin doivent être différentes."));
        if (/plage_de_jour/.test(m)) throw new Error(tr("La plage doit être la nuit : elle passe minuit, commence à 18:00 ou plus tard, ou finit à 08:00 au plus tard."));
        if (/plage_trop_longue/.test(m)) throw new Error(tr("La plage dure plus de 12 heures : le message partirait aussi le jour. Vérifiez l'heure de début et l'heure de fin."));
        if (/nom_partenaire/.test(m)) throw new Error(tr("Le texte cite un partenaire : retirez son nom, ce message part chez tous les clients."));
        if (/montant_net/.test(m)) throw new Error(tr("Le texte contient un montant égal à un net du catalogue : retirez-le."));
        if (/modifie_ailleurs/.test(m)) throw new Error(tr("Le message de nuit a été changé entre-temps sur un autre appareil. Rechargez la page pour voir la dernière version."));
        throw new Error(m);
      }
      return data || null;
    },
    async whatsappReception(organisationId, actif) {
      const lignes = verifie(await sb.from("whatsapp_reglages").update({ reception_active: !!actif }).eq("organisation_id", organisationId).select());
      if (!lignes.length) throw new Error(tr("Modification refusée : la fiche n'existe plus ou vos droits ne la permettent pas."));
      return lignes[0];
    },
    async session() {
      const { data, error } = await sb.auth.getSession();
      if (!data.session) {
        // Réseau coupé et jeton expiré : on ne sait pas si la session est valide. La copie de la feuille du jour reste, et l'ouverture échoue pour que l'application l'affiche.
        if (error && /fetch|network|retryable/i.test(`${error.name} ${error.message}`)) throw new Error(error.message);
        // Plus de session (jeton refusé, déconnexion depuis un autre appareil, mot de passe changé) : la copie ne doit plus être lisible par personne.
        effacerCopieHorsLigne();
      }
      return data.session ? { id: data.session.user.id, email: data.session.user.email } : null;
    },
    async connecter(email, mdp) {
      enDeconnexion = false;
      const { error } = await sb.auth.signInWithPassword({ email, password: mdp });
      if (error) throw new Error(error.message === "Invalid login credentials" ? tr("E-mail ou mot de passe incorrect.") : error.message);
    },
    // Rappels sur téléphone : l'appareil est lié à la personne connectée (voir migration 17).
    async abonnerRappels({ endpoint, p256dh, auth }) {
      verifie(await sb.rpc("abonner_rappels", { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }));
    },
    async retirerRappels(endpoint) {
      verifie(await sb.from("abonnements_push").delete().eq("endpoint", endpoint).select());
    },
    async rappelsEnregistres(endpoint) {
      const { data } = await sb.from("abonnements_push").select("id").eq("endpoint", endpoint).limit(1);
      return !!(data && data.length);
    },
    // Dernières exécutions des rappels (migration 23). Renvoie null si la table n'existe pas encore ou n'est pas lisible par cette personne.
    async suiviRappels() {
      const { data, error } = await sb.from("rappels_suivi").select("id, cree_le, type, cible, abonnements, envoyes, retires, echecs, erreur, duree_ms").order("cree_le", { ascending: false }).limit(20);
      return error ? null : data;
    },
    // Hôtels situés (migration 48) : lus à la demande par l'écran « Prix et horaires ». null tant que la table manque (avant la migration) :
    // l'écran le dit et fonctionne sans mémoire des hôtels.
    async hotelsLieux(entiteId) {
      const { data, error } = await sb.from("hotels_lieux").select("id, entite_id, cle, nom, lieu, zone, localite, source_url, source_titre, certitude, verifie, maj_le").eq("entite_id", entiteId).limit(5000);
      return error ? null : data || [];
    },
    // Un hôtel situé par la recherche ou corrigé par la personne : une ligne par hôtel et par entreprise, remplacée à chaque correction.
    async enregistrerHotelLieu(entiteId, ligne) {
      const { data, error } = await sb.from("hotels_lieux").upsert({ ...ligne, entite_id: entiteId }, { onConflict: "entite_id,cle" }).select("id, entite_id, cle, nom, lieu, zone, localite, source_url, source_titre, certitude, verifie, maj_le").single();
      if (error) throw new Error(error.message);
      return data;
    },
    // ---- Agent de l'onglet « Assistant » (migration 52, fonction « agent ») ---------------------------------------------------------------
    // Les conversations se lisent et se rangent ici, avec la session de la personne (RLS : seulement les siennes). null avant la migration.
    async agentConversations(entiteId) {
      // whatsapp_conversation_id (migration 61) : relue sans elle tant que la migration n'est pas appliquée.
      const requete = (colonnes) => sb.from("agent_conversations").select(colonnes).eq("entite_id", entiteId).order("maj_le", { ascending: false }).limit(300);
      let { data, error } = await requete("id, entite_id, titre, apercu, dossier_id, statut, cree_le, maj_le, whatsapp_conversation_id");
      if (error && colonneAbsente(error, "whatsapp_conversation_id")) ({ data, error } = await requete("id, entite_id, titre, apercu, dossier_id, statut, cree_le, maj_le"));
      return error ? null : data || [];
    },
    async agentAttente(entiteId) {
      const { data, error } = await sb.from("agent_cartes").select("conversation_id, agent_conversations!inner(entite_id)").eq("statut", "proposee").eq("agent_conversations.entite_id", entiteId).limit(1000);
      return error ? [] : (data || []).map((c) => ({ conversation_id: c.conversation_id }));
    },
    async agentFil(id) {
      const [m, c] = await Promise.all([
        sb.from("agent_messages").select("id, role, contenu, cree_le").eq("conversation_id", id).order("id", { ascending: true }).limit(400),
        sb.from("agent_cartes").select("id, conversation_id, genre, titre, donnees, avertissements, statut, cree_le, decide_le").eq("conversation_id", id).order("cree_le", { ascending: true }),
      ]);
      if (m.error || c.error) throw new Error((m.error || c.error).message);
      return { messages: m.data || [], cartes: c.data || [] };
    },
    async agentMajConversation(id, patch) {
      const valeurs = Object.fromEntries(Object.entries(patch).filter(([k]) => ["titre", "statut", "dossier_id"].includes(k)));
      return verifie(await sb.from("agent_conversations").update(valeurs).eq("id", id).select("id, entite_id, titre, apercu, dossier_id, statut, cree_le, maj_le").single());
    },
    // Une pièce jointe d'une de mes conversations (migration 55), pour l'aperçu : null si elle n'est plus gardée.
    async agentFichier(id) {
      const { data, error } = await sb.from("agent_fichiers").select("id, nom, media_type, data").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    async agentSupprimerConversation(id) {
      verifie(await sb.from("agent_conversations").delete().eq("id", id).select("id"));
    },
    // Migration 120 (INV-2026-046 et 047, 23.11.2026) : la carte se prend dans la base avant d'enregistrer quoi que ce soit. Une seconde
    // validation (double tap, deux onglets, deux appareils) trouve la carte prise ou déjà validée : false, rien n'est créé deux fois.
    // Sans la migration : true, l'écran garde son propre verrou.
    async agentPrendreCarte(id) {
      const { data, error } = await sb.rpc("prendre_agent_carte", { p_carte: id });
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883" || /does not exist|Could not find the function/i.test(error.message || "")) return true;
        throw new Error(error.message);
      }
      return data === true;
    },
    // Une validation arrêtée (motif, erreur) rend la carte : elle peut être validée de nouveau.
    async agentRendreCarte(id) {
      const { error } = await sb.rpc("rendre_agent_carte", { p_carte: id });
      if (error && !(error.code === "PGRST202" || error.code === "42883" || /does not exist|Could not find the function/i.test(error.message || ""))) console.error("rendre_agent_carte", error.message);
    },
    async agentCarte(id, statut) {
      return verifie(await sb.from("agent_cartes").update({ statut }).eq("id", id).select("id, conversation_id, genre, titre, donnees, avertissements, statut, cree_le, decide_le").single());
    },
    // Mes conversations reliées à un dossier (fiche du dossier) : la plus récente d'abord. Vide avant la migration 52.
    async agentConversationsDuDossier(dossierId) {
      const { data, error } = await sb.from("agent_conversations").select("id, titre, maj_le").eq("dossier_id", dossierId).order("maj_le", { ascending: false }).limit(10);
      return error ? [] : data || [];
    },
    // ---- Apprentissages de l'agent (migration 54) ----
    // Les corrections d'une carte validée. Sans la migration, rien n'est noté (false).
    async agentNoterApprentissages(entiteId, carteId, lignes) {
      if (!lignes.length) return true;
      const { error } = await sb.from("agent_apprentissages").insert(lignes.map((l) => ({ entite_id: entiteId, carte_id: carteId || null, genre: l.genre, contexte: l.contexte, avant: l.avant, apres: l.apres, ...(l.interne ? { interne: true } : {}) })));
      return !error;
    },
    // Tableau de l'assistant : les apprentissages des entreprises suivies (null tant que la migration manque).
    async agentApprentissages(entiteIds) {
      const { data, error } = await sb.from("agent_apprentissages").select("id, entite_id, user_id, genre, contexte, avant, apres, cree_le, interne").in("entite_id", entiteIds).order("cree_le", { ascending: false }).limit(500);
      return error ? null : data || [];
    },
    async agentSupprimerApprentissage(id) {
      verifie(await sb.from("agent_apprentissages").delete().eq("id", id).select("id"));
    },
    // Crédit de l'assistant (migration 54) : dépense du mois, plafond et seuil, pour les administratrices ; null pour les autres ou sans la migration.
    async assistantBudget() {
      const { data, error } = await sb.rpc("assistant_budget_etat");
      return error ? null : data || null;
    },
    // Sauvegarde automatique par GitHub (migration 66) : dernier essai, dernière réussite, pour les administratrices ; null pour les autres ou sans la migration.
    async sauvegardeEtat() {
      const { data, error } = await sb.rpc("sauvegarde_etat");
      return error ? null : data || null;
    },
    async reglerPlafondAssistant(plafond, seuil) {
      const { error } = await sb.rpc("regler_plafond_assistant", { plafond, seuil });
      if (error) throw new Error(error.message);
    },
    // Demandes d'amélioration de l'outil (migration 56) : lues par les administratrices de l'entreprise. null tant que la table manque.
    async ameliorations(entiteId) {
      const { data, error } = await sb.from("ameliorations").select("id, entite_id, carte_id, titre, texte, statut, issue_url, pr_url, sensible, cree_le, maj_le").eq("entite_id", entiteId).order("cree_le", { ascending: false }).limit(50);
      return error ? null : data || [];
    },
    // Envoi d'une demande validée (fonction « ameliorations ») : rend { amelioration, carte } ou { erreur, motifs? }.
    async demanderAmelioration(corps) {
      const { data: s } = await sb.auth.getSession();
      const jeton = s && s.session && s.session.access_token;
      if (!jeton) return { erreur: "non_connecte" };
      try {
        const rep = await fetch(`${config.SUPABASE_URL}/functions/v1/ameliorations`, { method: "POST", headers: { Authorization: `Bearer ${jeton}`, apikey: config.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ action: "demander", ...corps }) });
        const r = await rep.json().catch(() => null);
        return rep.ok && r ? r : { erreur: (r && r.erreur) || "indisponible", ...(r && r.motifs ? { motifs: r.motifs } : {}) };
      } catch {
        return { erreur: "hors_ligne" };
      }
    },
    // Table des temps de trajet de référence (migration 52). null tant que la table manque.
    async tempsTrajets(entiteId) {
      const { data, error } = await sb.from("temps_trajets").select("id, entite_id, de, vers, cle, mode, duree_min, ferry, marge_min, source, source_date, a_verifier, origine, maj_le").eq("entite_id", entiteId).order("de").limit(2000);
      return error ? null : data || [];
    },
    // Une ou plusieurs lignes, ajoutées ou remplacées (une par paire et par mode).
    async enregistrerTempsTrajets(entiteId, lignes) {
      const { data, error } = await sb.from("temps_trajets").upsert(lignes.map((l) => ({ ...l, entite_id: entiteId })), { onConflict: "entite_id,mode,cle" }).select("id, entite_id, de, vers, cle, mode, duree_min, ferry, marge_min, source, source_date, a_verifier, origine, maj_le");
      if (error) throw new Error(error.message);
      return data || [];
    },
    async supprimerTempsTrajet(id) {
      verifie(await sb.from("temps_trajets").delete().eq("id", id).select("id"));
    },
    // Lieux et itinéraires trouvés par OpenStreetMap (caches de la fonction « agent ») : effacés pour être recherchés à nouveau.
    async oublierItineraires(entiteId) {
      verifie(await sb.from("trajets_ors").delete().eq("entite_id", entiteId).select("id"));
      verifie(await sb.from("lieux_geo").delete().eq("entite_id", entiteId).select("id"));
    },
    // Liaisons de ferry (migration 52) : une par île desservie.
    async liaisonsFerry(entiteId) {
      const { data, error } = await sb.from("liaisons_ferry").select("id, entite_id, nom, cote_ile, port_ile, port_continent, port_ile_coord, port_continent_coord, duree_min, source, source_date, a_verifier, maj_le").eq("entite_id", entiteId).order("nom");
      return error ? null : data || [];
    },
    async enregistrerLiaisonFerry(entiteId, l) {
      const { data, error } = await sb.from("liaisons_ferry").upsert({ ...l, entite_id: entiteId }, { onConflict: "entite_id,cote_ile" }).select("id, entite_id, nom, cote_ile, port_ile, port_continent, port_ile_coord, port_continent_coord, duree_min, source, source_date, a_verifier, maj_le").single();
      if (error) throw new Error(error.message);
      return data;
    },
    async supprimerLiaisonFerry(id) {
      verifie(await sb.from("liaisons_ferry").delete().eq("id", id).select("id"));
    },
    // Un message à l'agent : la réponse arrive en flux (une ligne JSON par événement), passée à `surEvenement` au fil de l'eau.
    // Rend { ok } ou { erreur } (droit, limite, plafond, indisponible), comme l'assistant.
    async agentEnvoyer(corps, surEvenement) {
      const { data: s } = await sb.auth.getSession();
      const jeton = s && s.session && s.session.access_token;
      if (!jeton) return { erreur: "non_connecte" };
      let rep;
      try {
        rep = await fetch(`${config.SUPABASE_URL}/functions/v1/agent`, { method: "POST", headers: { Authorization: `Bearer ${jeton}`, apikey: config.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify(corps) });
      } catch {
        return { erreur: "hors_ligne" };
      }
      if (!rep.ok || !rep.body) {
        // Le détail sert au message : plafond, dépense et date de reprise quand le plafond du mois est atteint.
        const detail = await rep.json().catch(() => null);
        return { ...(detail && typeof detail === "object" ? detail : {}), erreur: (detail && detail.erreur) || "indisponible" };
      }
      const { lireMorceau } = await import("./agent-calc.mjs");
      const lecteur = rep.body.getReader();
      const dec = new TextDecoder();
      let tampon = "";
      let fini = false;
      // iPhone : passer dans une autre app coupe la connexion et read() lève (« Load failed ») ; c'est une coupure, pas une panne de l'écran
      // (audit I7). La réponse continue côté serveur et se relit à la réouverture.
      // Seule la lecture est protégée : une erreur de l'écran (surEvenement) reste une vraie erreur, visible dans la console.
      for (;;) {
        let lu;
        try {
          lu = await lecteur.read();
        } catch {
          return fini ? { ok: true } : { erreur: "coupure" };
        }
        const { value, done } = lu;
        const r = lireMorceau(tampon, done ? "\n" : dec.decode(value, { stream: true }));
        tampon = r.tampon;
        for (const ev of r.evenements) {
          if (ev.t === "fin") fini = true;
          surEvenement(ev);
        }
        if (done) break;
      }
      return fini ? { ok: true } : { erreur: "coupure" };
    },
    // Assistant IA (fonction « assistant ») : appelé avec la session de la personne, qui vérifie ses droits côté serveur.
    // Renvoie toujours un objet : la réponse, ou { erreur } avec le code rendu par la fonction (droit, limite, indisponible).
    async assistant(corps) {
      const { data, error } = await sb.functions.invoke("assistant", { body: corps });
      if (!error) return data;
      try {
        const detail = error.context && typeof error.context.json === "function" ? await error.context.json() : null;
        if (detail && detail.erreur) return detail;
      } catch {
        /* réponse sans JSON : traitée comme une indisponibilité */
      }
      return { erreur: "indisponible" };
    },
    // Suivi de l'assistant (écran #/assistant) : le journal des entreprises demandées depuis `depuis`, par pages de 1 000 (limite de la base),
    // les retouches (migration 51 ; null tant qu'elle manque) et les noms de l'équipe. Aucune colonne de contenu : il n'y en a pas.
    async assistantSuivi({ entiteIds, depuis }) {
      const tout = async (table, colonnes) => {
        const lignes = [];
        for (let de = 0; de < 50000; de += 1000) {
          const { data, error } = await sb.from(table).select(colonnes).in("entite_id", entiteIds).gte("cree_le", depuis).order("cree_le").order("id").range(de, de + 999);
          if (error) return { error };
          lignes.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        return { data: lignes };
      };
      const [journal, retouches, equipes] = await Promise.all([
        tout("assistant_journal", "cree_le, user_id, entite_id, usage, statut, cout_estime_usd"),
        tout("assistant_retouches", "cree_le, user_id, entite_id, usage, part_modifiee"),
        Promise.all(entiteIds.map((e) => sb.rpc("equipe_de", { e }))),
      ]);
      if (journal.error) throw new Error(journal.error.message);
      const noms = {};
      for (const r of equipes) for (const p of r.data || []) noms[p.user_id] = p.nom || p.email;
      return { lignes: journal.data, retouches: retouches.error ? null : retouches.data, noms };
    },
    // Une réponse rédigée copiée : la part de mots changés (0 à 100), rien d'autre. Sans la migration 51, rien n'est noté et rien ne se voit.
    async noterRetouche({ entiteId, usage, part }) {
      const { error } = await sb.from("assistant_retouches").insert({ entite_id: entiteId, usage, part_modifiee: part });
      return !error;
    },
    // ---- Comptes (lot D, 17.11.2026) ----
    // Ce que le lien ouvert a demandé (« invite » ou « recovery ») ou son erreur ; rendu une seule fois.
    retourLien() {
      const r = retour;
      retour = { type: null, erreur: null };
      return r;
    },
    // Fonction « invitation » (administratrice générale) : inviter, lien de mot de passe, supprimer un compte. Renvoie la réponse, ou { erreur }.
    async invitation(corps) {
      const { data, error } = await sb.functions.invoke("invitation", { body: { ...corps, retour: adresseOutil() } });
      if (!error) return data;
      try {
        const detail = error.context && typeof error.context.json === "function" ? await error.context.json() : null;
        if (detail && detail.erreur) return detail;
      } catch {
        /* réponse sans JSON : fonction absente ou en panne */
      }
      return { erreur: "indisponible" };
    },
    // Mise en route d'un client (éditeur, migration 45) : sa première entreprise, ses rôles et son catalogue d'exemple. Renvoie l'identifiant.
    async installerEntreprise({ organisation, nom, slug, reglages, roles, catalogue }) {
      return verifie(await sb.rpc("installer_entreprise", { p_organisation: organisation, p_nom: nom, p_slug: slug, p_reglages: reglages, p_roles: roles, p_catalogue: catalogue || [] }));
    },
    // Liste des clients de l'éditeur (migration 45) : nom, entreprises, client neuf ou non, adresse de la première administratrice.
    async clientsPlateforme() {
      return verifie(await sb.rpc("clients_plateforme"));
    },
    // « Mot de passe oublié » sur l'écran de connexion : Supabase envoie l'e-mail (son serveur d'envoi doit être réglé, voir mise-en-route.md).
    async motDePasseOublie(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: adresseOutil() });
      if (error) throw new Error(error.message);
    },
    // Nouveau mot de passe de la personne connectée. `actuel` : vérifié d'abord quand on le change depuis le menu du compte
    // (pas après un lien d'invitation ou de mot de passe oublié, où la personne ne le connaît pas).
    async changerMotDePasse(nouveau, actuel = null) {
      if (actuel !== null) {
        const { data } = await sb.auth.getSession();
        const email = data && data.session && data.session.user.email;
        const { error } = await sb.auth.signInWithPassword({ email, password: actuel });
        if (error) throw new Error(tr("Le mot de passe actuel n'est pas le bon."));
      }
      const { error } = await sb.auth.updateUser({ password: nouveau });
      if (error) throw new Error(/different from the old|same/i.test(error.message) ? tr("Le nouveau mot de passe doit être différent de l'ancien.") : error.message);
    },
    // Versions précédentes des réglages (migration 38). null tant que la migration n'est pas appliquée.
    async historiqueReglages(entiteId) {
      const { data, error } = await sb.from("reglages_historique").select("id, valeur, version_du, remplace_le, remplace_par").eq("entite_id", entiteId).order("remplace_le", { ascending: false }).limit(20);
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return null;
        throw new Error(error.message);
      }
      return data;
    },
    // Se déconnecter ferme cet appareil seulement (par défaut la bibliothèque ferme TOUTES les sessions : se déconnecter sur l'ordinateur coupait aussi l'iPhone).
    // La synchronisation a écarté le résultat de la dernière lecture (une écriture a eu lieu pendant la lecture) : le catalogue lu n'est pas installé, on le relira.
    // Vrai de la déconnexion à la prochaine connexion : etat.mjs n'écrit alors plus de copie hors ligne.
    enDeconnexion() {
      return enDeconnexion;
    },
    annulerDerniereLecture() {
      catalogueAChange = true;
    },
    async deconnecter() {
      enDeconnexion = true;
      effacerCopieHorsLigne();
      try {
        verifie(await sb.auth.signOut({ scope: "local" }).then(({ error }) => ({ data: null, error })));
      } finally {
        // Une synchronisation en vol pendant la déconnexion a pu réécrire la copie : on l'efface de nouveau.
        effacerCopieHorsLigne();
      }
    },
    // « Déconnecter tous mes appareils » : un geste à part, pour un téléphone perdu ou un compte utilisé sur un appareil prêté.
    async deconnecterPartout() {
      enDeconnexion = true;
      effacerCopieHorsLigne();
      // signOut ne lève pas d'exception sur une erreur réseau : il renvoie `error`. On la lève, sinon le bouton ferait croire que les appareils sont fermés.
      try {
        verifie(await sb.auth.signOut({ scope: "global" }).then(({ error }) => ({ data: null, error })));
      } finally {
        effacerCopieHorsLigne();
      }
    },
    // `ancien` : la copie en mémoire (synchronisation). Le catalogue qui n'a pas changé en est repris tel quel au lieu d'être relu.
    async charger({ ancien = null } = {}) {
      const out = {};
      const reutilisable = !!ancien && CATALOGUE.every((t) => Array.isArray(ancien[t]));
      let relire = !reutilisable || catalogueAChange || maintenant() - catalogueLuA > CATALOGUE_AGE_MAX;
      let nouvelle = empreinte;
      // Marqueur lu avant le catalogue : un changement survenu pendant la lecture sera vu à la synchronisation suivante.
      // Un marqueur illisible (coupure, droit retiré) ne fait pas échouer la synchronisation : on relit simplement le catalogue.
      // Au premier chargement, tout est relu de toute façon : le marqueur part en même temps que les tables (un aller-retour de moins à
      // l'ouverture, 19.11.2026), toujours lancé avant elles.
      const marqueur = empreinteCatalogue().then((e) => e, () => null);
      const ouverture = !reutilisable;
      if (!ouverture) {
        nouvelle = await marqueur;
        relire = relire || nouvelle === null || nouvelle !== empreinte;
      }
      const tables = ["entites", "profils", "roles", "membres", ...CHARGEES.filter((t) => relire || !CATALOGUE.includes(t))];
      // Toutes les lectures partent ensemble (elles étaient faites l'une après l'autre).
      const [lues, resumeLignes, taches, reglagesLignes, site, organisations, partages, whatsapp] = await Promise.all([
        Promise.all(tables.map((t) => toutes(t))),
        toutes("dossiers_resume"),
        (() => {
          // Les tâches à faire, et celles terminées depuis un mois.
          const depuis = new Date(Date.now() - 30 * 86400000).toISOString();
          return sb.from("taches").select("*").or(`fait.eq.false,fait_le.gte.${depuis}`).order("echeance", { nullsFirst: false }).limit(2000).then(verifie);
        })(),
        toutes("reglages"),
        lireSite(),
        lireOrganisations(),
        lirePartages(),
        lireWhatsApp(),
      ]);
      tables.forEach((t, i) => (out[t] = lues[i]));
      out.organisations = organisations;
      out.partages_clients = partages.partages_clients;
      out.clients = avecNomsLies(out.clients, partages.lies);
      Object.assign(out, site, whatsapp);
      if (ouverture) nouvelle = await marqueur;
      if (!relire) for (const t of CATALOGUE) out[t] = ancien[t];
      else {
        empreinte = nouvelle;
        catalogueLuA = maintenant();
        catalogueAChange = false;
      }
      // Apporteurs d'affaires (migration 68) : la colonne apporteur_id des dossiers dit si la migration est passée. Sans dossier lu, une
      // lecture d'une ligne le vérifie.
      out.apporteurs_disponible = out.dossiers.length ? out.dossiers.some((d) => "apporteur_id" in d) : !(await sb.from("dossiers").select("apporteur_id").limit(1)).error;
      const resumes = new Map(resumeLignes.map((r) => [r.dossier_id, r]));
      out.dossiers = out.dossiers.map((d) => fusion(d, resumes.get(d.id)));
      out.documents = [];
      out.paiements = [];
      out.taches = taches;
      const lignesReglages = reglagesLignes;
      out.reglages = Object.fromEntries(lignesReglages.map((r) => [r.entite_id, r.valeur]));
      // Version de chaque réglage (migration 15) : sert à refuser d'écraser l'enregistrement d'une autre personne.
      out.reglages_maj = Object.fromEntries(lignesReglages.map((r) => [r.entite_id, r.updated_at]));
      return out;
    },
    async inserer(table, row) {
      if (CATALOGUE.includes(table)) catalogueAChange = true;
      if (table === "documents") return ecrireDocument((contenu) => sb.from(table).insert({ ...row, contenu }).select().single(), row.contenu);
      return verifie(await sb.from(table).insert(row).select().single());
    },
    // `avant` : la version (`updated_at`) de la ligne telle que l'outil l'a lue. Si la ligne a changé depuis, rien n'est écrit et l'erreur porte `conflit`.
    async modifier(table, id, patch, avant) {
      if (CATALOGUE.includes(table)) catalogueAChange = true;
      const ecriture = async (contenu) => {
        let q = sb.from(table).update(table === "documents" && contenu !== undefined ? { ...patch, contenu } : patch).eq("id", id);
        if (avant) q = q.eq("updated_at", avant);
        const lignes = verifie(await q.select());
        if (!lignes.length) throw avant ? conflit() : new Error(tr("Modification refusée : la fiche n'existe plus ou vos droits ne la permettent pas."));
        return { data: lignes[0], error: null };
      };
      if (table === "documents" && patch.contenu) return ecrireDocument(ecriture, patch.contenu);
      const ligne = (await ecriture()).data;
      // Un document modifié sans son contenu (date d'envoi, par exemple) revient sans nets : on les remet pour qui peut les lire.
      return table === "documents" ? (await avecNets([ligne]))[0] : ligne;
    },
    async supprimer(table, id) {
      if (CATALOGUE.includes(table)) catalogueAChange = true;
      verifie(await sb.from(table).delete().eq("id", id).select());
    },
    async enregistrerReglages(entiteId, valeur, avant) {
      if (avant) {
        const lignes = verifie(await sb.from("reglages").update({ valeur }).eq("entite_id", entiteId).eq("updated_at", avant).select("updated_at"));
        if (!lignes.length) throw conflit();
        return lignes[0].updated_at;
      }
      const lignes = verifie(await sb.from("reglages").upsert({ entite_id: entiteId, valeur }).select());
      return lignes[0] && lignes[0].updated_at;
    },
    // Factures pour la fiduciaire (migration 28). La liste vaut null tant que la migration n'est pas appliquée : l'écran l'explique.
    async fiduciaireListe() {
      const { data, error } = await sb.from("fiduciaire_factures").select("*").order("numero", { ascending: false }).limit(2000);
      if (error) {
        // Seule l'absence de la table veut dire « migration non appliquée » ; un refus de droit ou une panne reste une erreur.
        if (error.code === "42P01" || error.code === "PGRST205") return null;
        throw new Error(error.message);
      }
      return data;
    },
    // Compte d'un partenaire chauffeur (migration 115) : son accès, ses courses et la saisie de sa commission, par les seules fonctions de la base.
    // Sans la migration (fonction absente), aucun compte n'est partenaire : l'outil se comporte comme avant.
    async partenaireAcces() {
      const { data, error } = await sb.rpc("partenaire_mon_acces");
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") return null;
        throw new Error(error.message);
      }
      return (data && data[0]) || null;
    },
    async partenaireCourses() {
      return verifie(await sb.rpc("partenaire_courses")) || [];
    },
    // Corriger une commission, ou le prix et la commission (migration 119) : une seule transaction dans la base, qui refuse si un montant lu
    // à l'ouverture a changé. Les documents partent sans leurs nets (le prix d'une ligne ne change pas son net, documents_nets reste tel quel).
    async corrigerCommission({ reservationId, entiteId, commission, prix, motif, note, lu, documents = [] }) {
      return verifie(await sb.rpc("corriger_commission", { p_reservation: reservationId, p_entite: entiteId, p_commission: commission, p_prix: prix, p_motif: motif, p_note: note, p_lu: lu, p_documents: documents.map(({ id, updated_at, contenu }) => ({ id, updated_at, contenu })) }));
    },
    async partenaireSaisirCommission(reservationId, montant) {
      return verifie(await sb.rpc("partenaire_saisir_commission", { p_reservation: reservationId, p_montant: montant }));
    },
    async fiduciaireAPreparer() {
      return verifie(await sb.rpc("fiduciaire_a_preparer"));
    },
    // Migration 36 appliquée ? La colonne destinataire_id n'existe qu'avec elle (réglages de l'écran Fiduciaire).
    async fiduciaireMigration36() {
      const { error } = await sb.from("fiduciaire_factures").select("destinataire_id").limit(1);
      return !error;
    },
    async fiduciaireEmettre(reservationId, date = null, attendu = null) {
      return verifie(await sb.rpc("emettre_facture_fiduciaire", { p_res: reservationId, p_date: date, p_attendu: attendu }));
    },
    // `destinataire` (migration 36) : le prestataire dont la facture s'annule, quand le service a changé de prestataire.
    async fiduciaireAnnuler(reservationId, date = null, destinataire = null) {
      return verifie(await sb.rpc("annuler_facture_fiduciaire", { p_res: reservationId, p_date: date, ...(destinataire ? { p_destinataire: destinataire } : {}) }));
    },
    async fiduciaireEnvoyer(ids, date) {
      return verifie(await sb.rpc("marquer_envoyee_fiduciaire", { p_ids: ids, p_date: date }));
    },
    async fiduciaireCalcul(reservationId) {
      return verifie(await sb.rpc("fiduciaire_calcul", { p_res: reservationId }));
    },
    // Langue de l'interface de la personne connectée (migration 13). Sans la migration l'appel échoue : l'outil garde alors la langue dans ce navigateur.
    // « Rappel 1 h avant » de la personne connectée (migration 31).
    async definirRappelH1(actif) {
      verifie(await sb.rpc("definir_rappel_h1", { allume: !!actif }));
    },
    async definirMaLangue(code) {
      verifie(await sb.rpc("definir_ma_langue", { l: code }));
    },
    // Versions précédentes d'un devis ou d'une facture, et dossiers supprimés des 90 derniers jours (migration 15).
    async versionsDocument(docId) {
      return verifie(await sb.from("documents_historique").select("id, archive_le, ligne").eq("document_id", docId).eq("action", "update").order("archive_le", { ascending: false }).limit(30));
    },
    async corbeille(entiteId) {
      return verifie(await sb.from("corbeille").select("id, ligne, supprime_par, supprime_le").eq("entite_id", entiteId).eq("table_name", "dossiers").order("supprime_le", { ascending: false }));
    },
    async restaurerDossier(id) {
      return verifie(await sb.rpc("restaurer_dossier", { p_id: id }));
    },
    // Devis et factures supprimés seuls (sans leur dossier) des 90 derniers jours, et leur restauration avec leurs nets (migration 34).
    async documentsSupprimes(entiteId) {
      return verifie(await sb.rpc("documents_supprimes", { p_entite: entiteId }));
    },
    async restaurerDocument(documentId) {
      return verifie(await sb.rpc("restaurer_document", { p_document: documentId }));
    },
    // Prochain numéro de la séquence annuelle, réservé à l'administratrice (migration 34).
    async lireProchainNumero(entiteId, annee) {
      return verifie(await sb.rpc("lire_prochain_numero", { p_entite: entiteId, p_annee: annee }));
    },
    async fixerProchainNumero(entiteId, annee, prochain) {
      return verifie(await sb.rpc("fixer_prochain_numero", { p_entite: entiteId, p_annee: annee, p_prochain: prochain }));
    },
    // Fusion de deux fiches client en une transaction (migration de fusion) : dossiers déplacés, champs vides remplis, l'autre fiche supprimée.
    // `patch` sert à la démo ; la base calcule elle-même ce qu'elle reprend (même règle que fusionClients).
    async fusionnerClients({ garder, absorbe }) {
      return verifie(await sb.rpc("fusionner_clients", { p_garder: garder, p_absorbe: absorbe }));
    },
    // « Partage ses clients avec » (migration 46), réglé par l'administration générale. La base refuse deux organisations différentes.
    async partagerClients(sourceId, cibleId, actif) {
      if (actif) verifie(await sb.from("partages_clients").upsert({ source_id: sourceId, cible_id: cibleId }, { onConflict: "source_id,cible_id", ignoreDuplicates: true }).select());
      else verifie(await sb.from("partages_clients").delete().eq("source_id", sourceId).eq("cible_id", cibleId).select());
    },
    // Numéro suivant de la séquence annuelle (migration 14). Échoue tant que la migration n'est pas appliquée : l'appelant garde alors son calcul.
    async prochainNumeroRef(entiteId, annee, minimum) {
      return verifie(await sb.rpc("prochain_numero_ref", { p_entite: entiteId, p_annee: annee, p_minimum: minimum }));
    },
    async modifierProfil(userId, patch) {
      verifie(await sb.from("profils").update(patch).eq("user_id", userId).select());
    },
    async donnerAcces(userId, entiteId, roleId) {
      verifie(await sb.from("membres").upsert({ user_id: userId, entite_id: entiteId, role_id: roleId }).select());
    },
    async equipe(entiteId) {
      return verifie(await sb.rpc("equipe_de", { e: entiteId }));
    },
    // Un dossier avec son résumé à jour (après une modification de ses documents ou paiements).
    // La ligne de nets d'une réservation, relue après une écriture : le déclencheur remplir_nets (migration 32) a pu la recalculer.
    // Sans le droit « nets », la base ne renvoie rien.
    async netsReservations(ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += 100) out.push(...(verifie(await sb.from("reservations_nets").select("*").in("reservation_id", ids.slice(i, i + 100))) || []));
      return out;
    },
    async resumeDossier(id) {
      const d = verifie(await sb.from("dossiers").select("*").eq("id", id).maybeSingle());
      if (!d) return null;
      return fusion(d, verifie(await sb.from("dossiers_resume").select("*").eq("dossier_id", id).maybeSingle()));
    },
    async dossierComplet(id) {
      const [dossier, documents, paiements] = await Promise.all([this.resumeDossier(id), sb.from("documents").select("*").eq("dossier_id", id).order("created_at"), sb.from("paiements").select("*").eq("dossier_id", id).order("date")]);
      return { dossier, documents: await avecNets(verifie(documents)), paiements: verifie(paiements) };
    },
    async documentComplet(docId) {
      const doc = verifie(await sb.from("documents").select("dossier_id").eq("id", docId).maybeSingle());
      return doc ? this.dossierComplet(doc.dossier_id) : null;
    },
    async paiementsPeriode({ entiteId, du, au }) {
      return verifie(await sb.from("paiements").select("*").eq("entite_id", entiteId).gte("date", du).lte("date", au).order("date"));
    },
    async tousDocuments(entiteId) {
      const lignes = [];
      for (let debut = 0; ; debut += PAGE) {
        const page = verifie(await sb.from("documents").select("*").eq("entite_id", entiteId).order("created_at").range(debut, debut + PAGE - 1));
        lignes.push(...(await avecNets(page)));
        if (page.length < PAGE) return lignes;
      }
    },
    async tousPaiements(entiteId) {
      const lignes = [];
      for (let debut = 0; ; debut += PAGE) {
        const page = verifie(await sb.from("paiements").select("*").eq("entite_id", entiteId).order("date").range(debut, debut + PAGE - 1));
        lignes.push(...page);
        if (page.length < PAGE) return lignes;
      }
    },
    // Pièces jointes : le fichier va dans le stockage privé, une ligne en garde le nom et le chemin.
    async piecesDossier(dossierId) {
      return verifie(await sb.from("pieces_jointes").select("*").eq("dossier_id", dossierId).order("created_at", { ascending: false }));
    },
    async ajouterPiece({ entiteId, dossierId, fichier }) {
      if (fichier.size > LIMITE_FICHIER) throw new Error(tr("Fichier trop lourd (10 Mo maximum)."));
      const sain = fichier.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
      const chemin = `${entiteId}/${dossierId}/${crypto.randomUUID()}-${sain}`;
      const { error } = await sb.storage.from("pieces").upload(chemin, fichier, { contentType: fichier.type || "application/octet-stream" });
      if (error) throw new Error(error.message);
      try {
        return verifie(await sb.from("pieces_jointes").insert({ entite_id: entiteId, dossier_id: dossierId, nom: fichier.name, type: fichier.type, taille: fichier.size, chemin }).select().single());
      } catch (err) {
        await sb.storage.from("pieces").remove([chemin]);
        throw err;
      }
    },
    async lienPiece(piece) {
      const { data, error } = await sb.storage.from("pieces").createSignedUrl(piece.chemin, 300, { download: piece.nom });
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    async supprimerPiece(piece) {
      // Le fichier d'abord : la règle de suppression du stockage exige que la ligne de la pièce existe encore. Dans l'autre ordre, le
      // fichier restait dans le stockage sans que personne ne puisse plus le retrouver.
      const { error } = await sb.storage.from("pieces").remove([piece.chemin]);
      if (error) throw new Error(error.message);
      verifie(await sb.from("pieces_jointes").delete().eq("id", piece.id).select());
    },
    // Tableau analytique : tous les chiffres sont calculés par la base.
    async analyses({ entiteId, du, au, jour }) {
      return verifie(await sb.rpc("tableau_analytique", { e: entiteId, du, au, jour }));
    },
    // Faits des statistiques détaillées (migration 20) : un appel par section, `parties` limite les collections renvoyées.
    async analyseFaits({ entiteId, debut, fin, jour, parties }) {
      return verifie(await sb.rpc("analyse_faits", { e: entiteId, debut, fin, jour, parties: parties || null }));
    },
    // Journal d'activité : les plus récentes d'abord, par pages (le journal peut devenir très long).
    async journal({ entiteId, table, userId, avant, limite = 50 }) {
      let q = sb.from("journal").select("*").eq("entite_id", entiteId).order("created_at", { ascending: false }).limit(limite);
      if (table) q = q.eq("table_name", table);
      if (userId) q = q.eq("user_id", userId);
      if (avant) q = q.lt("created_at", avant);
      const lignes = verifie(await q);
      const noms = new Map((await sb.rpc("equipe_de", { e: entiteId })).data?.map((p) => [p.user_id, p.nom || p.email]) || []);
      return lignes.map((l) => ({ ...l, auteur: noms.get(l.user_id) || null }));
    },
    async retirerAcces(userId, entiteId) {
      verifie(await sb.from("membres").delete().eq("user_id", userId).eq("entite_id", entiteId).select());
    },
    // Remplacement de la base partenaires : les tâches liées à un partenaire, puis les partenaires (la base supprime
    // en cascade prestations, trajets, nets et données privées ; les réservations gardent leur libellé).
    // Toutes les tâches de l'entreprise, terminées depuis longtemps comprises (la mémoire n'en garde qu'une partie) : pour la sauvegarde.
    async toutesTaches(entiteId) {
      const lignes = [];
      for (let debut = 0; ; debut += PAGE) {
        const page = verifie(await sb.from("taches").select("*").eq("entite_id", entiteId).order("created_at").order("id").range(debut, debut + PAGE - 1));
        lignes.push(...page);
        if (page.length < PAGE) return lignes;
      }
    },
    // Remplacement de la base partenaires APRÈS l'import : on retire seulement ce que le fichier ne contient plus (la base supprime en cascade les nets
    // et remet à vide le lien des réservations). `absents` : { partenaires, prestations, trajets } = listes d'identifiants.
    async supprimerAbsents(entiteId, absents) {
      catalogueAChange = true;
      const par = (liste) => Array.from({ length: Math.ceil(liste.length / 100) }, (_, i) => liste.slice(i * 100, i * 100 + 100));
      for (const lot of par(absents.partenaires)) verifie(await sb.from("taches").delete().eq("entite_id", entiteId).in("partenaire_id", lot).select("id"));
      for (const lot of par(absents.trajets)) verifie(await sb.from("trajets").delete().eq("entite_id", entiteId).in("id", lot).select("id"));
      for (const lot of par(absents.prestations)) verifie(await sb.from("prestations").delete().eq("entite_id", entiteId).in("id", lot).select("id"));
      for (const lot of par(absents.partenaires)) verifie(await sb.from("partenaires").delete().eq("entite_id", entiteId).in("id", lot).select("id"));
    },
    async supprimerPartenaires(entiteId) {
      catalogueAChange = true;
      verifie(await sb.from("taches").delete().eq("entite_id", entiteId).not("partenaire_id", "is", null).select("id"));
      verifie(await sb.from("partenaires").delete().eq("entite_id", entiteId).select("id"));
    },
    async importer(tables) {
      catalogueAChange = true;
      // Avant toute écriture : la table des nets est-elle là si la sauvegarde en porte ? Un refus au milieu laisserait la base à moitié importée.
      const separe = await separation();
      if (!separe && (tables.documents || []).some((d) => Object.keys(separerNets(d.contenu).nets).length)) throw new Error(tr("Les prix nets ne peuvent pas être enregistrés : la migration 16 de la base n'est pas appliquée."));
      // Ordre imposé par les clés étrangères.
      for (const t of TABLES) {
        let rows = tables[t] || [];
        // Une sauvegarde porte les nets dans le contenu des documents : à l'import ils vont dans documents_nets, pas dans le contenu.
        const nets = [];
        if (t === "documents") {
          rows = rows.map((d) => {
            const s = separerNets(d.contenu);
            // Les nets sortent du contenu (jamais écrits dedans) ; le contrôle de la table a déjà eu lieu avant la première écriture.
            if (Object.keys(s.nets).length) nets.push({ document_id: d.id, entite_id: d.entite_id, nets: s.nets });
            return { ...d, contenu: s.contenu };
          });
        }
        for (let i = 0; i < rows.length; i += 200) verifie(await sb.from(t).upsert(rows.slice(i, i + 200)).select("id"));
        for (let i = 0; i < nets.length; i += 200) verifie(await sb.from("documents_nets").upsert(nets.slice(i, i + 200)).select("document_id"));
      }
    },
  };
}
