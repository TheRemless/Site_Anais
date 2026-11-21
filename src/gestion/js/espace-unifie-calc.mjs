// Espace unifié Secret et VIP Taxi Lanta (migration 63, PR 3 : l'écran, 20.11.2026). Nani gère les deux entreprises avec le même numéro :
// l'Assistant propose une seule carte, chaque service porte son entreprise, une demande mixte devient deux dossiers liés. ZTP reste à part.
// Logique pure, testée par tests/gestion-espace-unifie-ecran.test.js.

// Les deux entreprises de l'espace unifié : la base ne connaît que les slugs « secret » et « taxi ». La démonstration appelle Secret
// « excursions ».
const MARQUES = { secret: "secret", excursions: "secret", taxi: "taxi" };
export const marqueUnifiee = (e) => (e && MARQUES[e.slug]) || null;
export const LIBELLES_MARQUES = { secret: "Secret", taxi: "Taxi" };

// Les droits qui allument l'espace unifié dans l'autre entreprise (comme la fonction « agent », unifie.js) : lire les partenaires et écrire
// des dossiers.
export const DROITS_UNIFIE = ["partenaires.lire", "dossiers.ecrire"];
// L'espace unifié de la personne : l'entreprise active (Secret ou Taxi) et l'autre, quand elle y a les droits. null sinon (ZTP, Mook, une
// seule des deux entreprises).
// `agentActif(id)` : l'Assistant est-il allumé dans cette entreprise ? Éteint dans l'autre, l'espace unifié ne s'ouvre pas.
export function espaceUnifie({ entites = [], activeId = null, permissionsDe = () => [], agentActif = () => true } = {}) {
  const active = entites.find((e) => e.id === activeId);
  const m = marqueUnifiee(active);
  if (!m) return null;
  const autre = entites.find((e) => e.id !== activeId && marqueUnifiee(e) && marqueUnifiee(e) !== m);
  if (!autre) return null;
  const ok = (id) => DROITS_UNIFIE.every((d) => permissionsDe(id).includes(d));
  if (!ok(active.id) || !ok(autre.id)) return null;
  if (!agentActif(autre.id)) return null;
  return { active, autre, entites: [active, autre] };
}

// ---- Entreprise de chaque service d'une carte ---------------------------------------------------------------------------------------------
// La carte « dossier » est-elle de l'espace unifié ? La fonction pose `entreprises` sur la carte et `entite_id` sur chaque service.
export const carteUnifiee = (donnees) => !!donnees && (Array.isArray(donnees.entreprises) || (donnees.services || []).some((s) => s && "entite_id" in s));
// Les données de la carte avec les entreprises corrigées par la personne (`corrections` : index du service -> entreprise { id, slug }).
export function avecCorrections(donnees, corrections = {}) {
  if (!donnees) return donnees;
  const services = (donnees.services || []).map((s, i) => {
    const c = corrections[i];
    if (!c) return s;
    return { ...s, entite_id: c.id, entreprise: c.slug, avertissements: (s.avertissements || []).filter((a) => a !== "entreprise_a_choisir") };
  });
  return { ...donnees, services, entreprises: ["secret", "taxi"].filter((m) => services.some((s) => s.entreprise === m)) };
}
// Un service pris dans le catalogue garde l'entreprise de ce catalogue : son badge ne se change pas. Seuls les services hors catalogue se
// corrigent d'un tap.
export const badgeModifiable = (service) => !!service && !service.offre;
// Le badge suivant d'un tap : vide -> la première entreprise, puis l'autre, en boucle.
export function entrepriseSuivante(service, entreprises = []) {
  if (!entreprises.length) return null;
  const i = entreprises.findIndex((e) => e.id === (service && service.entite_id));
  return entreprises[(i + 1) % entreprises.length] || entreprises[0];
}
// Les services par entreprise, dans l'ordre de la carte. `sansEntreprise` : les index des services sans entreprise (validation bloquée).
export function groupesParEntreprise(services = []) {
  const groupes = new Map();
  const sansEntreprise = [];
  services.forEach((s, i) => {
    if (!s || !s.entite_id) return void sansEntreprise.push(i);
    if (!groupes.has(s.entite_id)) groupes.set(s.entite_id, []);
    groupes.get(s.entite_id).push({ ...s, index: i });
  });
  return { groupes, sansEntreprise };
}

// Le plan de création d'une carte « dossier » de l'espace unifié : un dossier par entreprise, l'entreprise active d'abord (la fiche client y
// est créée, puis réutilisée dans l'autre). `motif` : pourquoi rien ne peut être créé, vérifié AVANT toute écriture.
//   « entreprise_a_choisir » : un service sans entreprise ;
//   « droit_dossier:<id> » : pas le droit d'écrire des dossiers dans cette entreprise ;
//   « droit_client:<id> » : il faut créer la fiche et la personne n'a pas « clients.ecrire » dans l'entreprise du premier dossier ;
//   « partage:<id> » : la fiche ne passera pas dans cette entreprise (pas de partage réciproque permis).
export function planCreation({ services = [], activeId, permissionsDe = () => [], nouveauClient = true, partagePermis = () => false } = {}) {
  const { groupes, sansEntreprise } = groupesParEntreprise(services);
  if (sansEntreprise.length) return { ok: false, motif: "entreprise_a_choisir", index: sansEntreprise };
  if (!groupes.size) return { ok: false, motif: "aucun_service" };
  const ordre = [...groupes.keys()].sort((a, b) => (a === activeId ? -1 : b === activeId ? 1 : 0));
  const etapes = ordre.map((id) => ({ entite_id: id, services: groupes.get(id) }));
  for (const e of etapes) if (!permissionsDe(e.entite_id).includes("dossiers.ecrire")) return { ok: false, motif: `droit_dossier:${e.entite_id}` };
  const premier = etapes[0].entite_id;
  if (nouveauClient && !permissionsDe(premier).includes("clients.ecrire")) return { ok: false, motif: `droit_client:${premier}` };
  for (const e of etapes.slice(1)) if (!partagePermis(premier, e.entite_id)) return { ok: false, motif: `partage:${e.entite_id}` };
  return { ok: true, etapes, mixte: etapes.length > 1 };
}

// La création des dossiers d'une carte mixte, sans rien laisser à moitié :
//   1. une passe à blanc par entreprise (`essayer`) : préparation et contrôles de chaque dossier (prix à fixer, service introuvable, numéro),
//      sans rien écrire. Un refus arrête tout, rien n'est créé ;
//   2. la création (`creer`, qui reçoit la fiche du premier dossier) ; si un dossier échoue quand même, les dossiers déjà créés vont à la
//      corbeille (`defaire`) et la carte reste à valider ;
//   3. le lien des deux côtés (`lier`).
// Ne rend jamais ok:true tant que tous les dossiers prévus ne sont pas créés.
export async function creerDossiersLies({ etapes = [], essayer, creer, defaire, lier = async () => true } = {}) {
  if (!etapes.length) return { ok: false, motif: null, etape: -1, ecrit: false };
  for (let i = 0; i < etapes.length; i++) {
    const r = await essayer(etapes[i], i);
    if (!r || !r.ok) return { ok: false, motif: (r && r.motif) || null, etape: i, ecrit: false };
  }
  const crees = [];
  let clientId = "";
  for (let i = 0; i < etapes.length; i++) {
    let r;
    try {
      r = await creer(etapes[i], i, clientId);
    } catch (err) {
      r = { ok: false, motif: err.message };
    }
    if (!r || !r.ok || !r.dossier) {
      let defait = true;
      if (crees.length) {
        try {
          defait = (await defaire(crees)) !== false;
        } catch {
          defait = false;
        }
      }
      return { ok: false, motif: (r && r.motif) || null, etape: i, ecrit: crees.length > 0, defait, crees };
    }
    crees.push(r.dossier);
    clientId = clientId || r.dossier.client_id || "";
  }
  const lies = crees.length === 2 ? await lier(crees[0], crees[1]) : true;
  return { ok: true, crees, lies };
}
// Le lien entre deux dossiers, des deux côtés ou pas du tout : si le second côté échoue, le premier revient à null. true si les deux sont posés.
export async function lierDossiers(a, b, modifier) {
  try {
    await modifier("dossiers", a.id, { dossier_lie_id: b.id });
  } catch {
    return false;
  }
  try {
    await modifier("dossiers", b.id, { dossier_lie_id: a.id });
    return true;
  } catch {
    try {
      await modifier("dossiers", a.id, { dossier_lie_id: null });
    } catch {
      // le premier côté reste posé : la base le contrôle (controler_dossier_lie), il pointe vers un dossier qui existe
    }
    return false;
  }
}
// La carte d'un dossier créé : seulement les services de son entreprise (les apprentissages de chaque entreprise restent chez elle).
export const carteDeLEntreprise = (c, donnees, entiteId) => ({ ...c, donnees: { ...donnees, services: (donnees.services || []).filter((s) => s.entite_id === entiteId) } });

// Une fenêtre (voucher, Booking confirmation, réservation, modification) ouverte dans une autre entreprise : on bascule, on attend ce qu'il
// faut charger, on ouvre, et on revient dans l'entreprise d'origine de façon synchrone quand la fenêtre se ferme (son rappel de fermeture,
// avant toute navigation). Si rien ne s'ouvre (`ouvrir` rend false ou échoue), on revient tout de suite. Aucun minuteur.
export async function ouvrirDansEntreprise({ id, origine, changer, charger = async () => null, ouvrir }) {
  if (!id || id === origine) return ouvrir(await charger(), () => {});
  changer(id);
  let revenu = false;
  const revenir = () => {
    if (revenu) return;
    revenu = true;
    changer(origine);
  };
  let ouvert = false;
  try {
    ouvert = await ouvrir(await charger(), revenir);
    return ouvert;
  } finally {
    if (ouvert === false || ouvert === undefined || ouvert === null) revenir();
  }
}

// WhatsApp commun en lecture : une réponse préparée pour une autre entreprise ne montre un net (montant_interne, montant_egal_net) qu'à qui a
// « partenaires.nets » dans l'entreprise de la réponse, et un nom de partenaire (nom_prestataire) qu'à qui a « partenaires.lire ».
export function avertissementsVisibles(codes = [], permissions = []) {
  const cache = (code) => {
    const cle = String(code || "").split(":")[0];
    // montant_egal_net (21.11.2026) dit aussi qu'un chiffre est un net : même droit.
    if (cle === "montant_interne" || cle === "montant_egal_net") return !permissions.includes("partenaires.nets");
    if (cle === "nom_prestataire") return !permissions.includes("partenaires.lire");
    return false;
  };
  const visibles = codes.filter((c) => !cache(c));
  return { visibles, masques: codes.length - visibles.length };
}

// Partage réciproque Secret et Taxi (migration 63) : les deux lignes de partages_clients, entre deux entreprises de l'espace unifié.
export const partageReciproque = (partages = [], a, b) => partages.some((p) => p.source_id === a && p.cible_id === b) && partages.some((p) => p.source_id === b && p.cible_id === a);
// Qui utilise dans la cible une fiche de la source (migration 63, partage_clients_permis) : l'administration générale, une administratrice des
// deux, ou, avec le partage réciproque Secret et Taxi, qui lit tous les clients de la source et écrit des dossiers dans la cible.
export function partageClientsPermisUnifie({ superAdmin = false, permissionsSource = [], permissionsCible = [], voitToutSource = false, reciproque = false } = {}) {
  if (!permissionsCible.includes("dossiers.ecrire")) return false;
  if (superAdmin) return true;
  const litSource = permissionsSource.includes("clients.lire") && voitToutSource;
  if (permissionsSource.includes("reglages.ecrire") && permissionsCible.includes("reglages.ecrire") && litSource) return true;
  return reciproque && litSource;
}

// ---- Dossiers liés ---------------------------------------------------------------------------------------------------------------------------
// Le dossier lié à afficher sur la fiche : seulement s'il est lisible (dans les dossiers chargés) et d'une autre entreprise.
export function dossierLie(dossier, dossiers = [], entites = []) {
  if (!dossier || !dossier.dossier_lie_id) return null;
  const l = dossiers.find((d) => d.id === dossier.dossier_lie_id);
  if (!l || l.entite_id === dossier.entite_id) return null;
  const e = entites.find((x) => x.id === l.entite_id);
  return { id: l.id, ref: l.ref || "", entite_id: l.entite_id, entreprise: LIBELLES_MARQUES[marqueUnifiee(e)] || (e && e.nom) || "" };
}
// L'ordre des envois après une carte mixte : le voucher de Secret d'abord, puis la Booking confirmation de Taxi.
export function ordreEnvois(dossiers = [], entites = []) {
  const rang = (d) => (marqueUnifiee(entites.find((e) => e.id === d.entite_id)) === "secret" ? 0 : 1);
  return [...dossiers].sort((a, b) => rang(a) - rang(b));
}

// ---- Conversations de l'Assistant des deux entreprises -------------------------------------------------------------------------------------
// Les conversations de l'entreprise active et de l'autre, les plus récentes d'abord, chacune avec son entreprise.
export function conversationsDesDeux(parEntreprise = []) {
  return parEntreprise
    .flatMap(({ entite, conversations }) => (conversations || []).map((c) => ({ ...c, entite_id: c.entite_id || entite.id, entreprise: LIBELLES_MARQUES[marqueUnifiee(entite)] || entite.nom || "" })))
    .sort((a, b) => String(b.maj_le || "").localeCompare(String(a.maj_le || "")));
}

// ---- WhatsApp commun en lecture --------------------------------------------------------------------------------------------------------------
// La personne peut-elle agir sur la conversation (ranger, relier, marquer lu, traiter, envoyer, préparer) ? Administratrice de son entreprise ;
// à trier : de l'une des deux (whatsapp_ecrit, migration 63). `admins` : les ids des entreprises où elle administre la boîte.
export const ecritConversation = (conv, admins = []) => !!conv && (conv.entite_id ? admins.includes(conv.entite_id) : admins.length > 0);

// ---- Doublons Secret et Taxi ------------------------------------------------------------------------------------------------------------------
// Comme doublons_clients_partages (migration 63) : même téléphone (9 derniers chiffres) ou même prénom et nom (sans accents ni casse, 4 lettres
// au moins), entre une fiche de Secret et une de Taxi. La plus ancienne d'abord.
const cleNom = (c) => String(`${c.prenom || ""}${c.nom || ""}`).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const cleTel = (c) => String(c.telephone || "").replace(/\D/g, "").slice(-9);
export function doublonsLocaux(clients = [], entites = []) {
  const unifiees = new Map(entites.filter((e) => marqueUnifiee(e)).map((e) => [e.id, marqueUnifiee(e)]));
  const liste = clients.filter((c) => unifiees.has(c.entite_id) && !c.nom_seul).sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id)));
  const out = [];
  for (let i = 0; i < liste.length; i++)
    for (let j = i + 1; j < liste.length; j++) {
      const a = liste[i];
      const b = liste[j];
      if (a.entite_id === b.entite_id) continue;
      const tel = cleTel(a).length === 9 && cleTel(a) === cleTel(b);
      const nom = cleNom(a).length >= 4 && cleNom(a) === cleNom(b);
      if (!tel && !nom) continue;
      out.push({ fiche_a: a.id, entreprise_a: unifiees.get(a.entite_id), nom_a: `${a.prenom || ""} ${a.nom || ""}`.trim(), fiche_b: b.id, entreprise_b: unifiees.get(b.entite_id), nom_b: `${b.prenom || ""} ${b.nom || ""}`.trim(), raison: tel ? "téléphone" : "nom" });
    }
  return out;
}
// Qui voit la liste des doublons : qui lit tous les clients des deux entreprises. Qui fusionne : l'administration (fusionner_clients entre deux
// entreprises, migration 63).
export const voitDoublons = (entites = [], permissionsDe = () => [], voitTout = () => false) => {
  const u = entites.filter((e) => marqueUnifiee(e));
  return u.length === 2 && u.every((e) => permissionsDe(e.id).includes("clients.lire") && voitTout(e.id));
};
export const peutFusionnerEntreprises = ({ superAdmin = false, a = [], b = [] } = {}) => superAdmin || (a.includes("reglages.ecrire") && b.includes("reglages.ecrire"));
// Exactement les conditions de fusionner_clients (migration 63), pour la fiche gardée choisie :
//   fiche absorbée : « clients.fusionner » (ou « clients.supprimer » et « dossiers.ecrire ») et voit tout ;
//   fiche gardée (autre entreprise) : « clients.ecrire », « clients.lire » et voit tout ; l'administration des deux entreprises ;
//   un partage de clients de l'entreprise gardée vers celle de la fiche absorbée.
// `garder` et `absorbe` : { entite_id, permissions, voitTout }. `partage(source, cible)` : la ligne de partages_clients existe.
export function peutFusionnerPaire({ superAdmin = false, garder, absorbe, partage = () => false } = {}) {
  if (!garder || !absorbe) return false;
  const pa = absorbe.permissions || [];
  const pg = garder.permissions || [];
  if (!(pa.includes("clients.fusionner") || (pa.includes("clients.supprimer") && pa.includes("dossiers.ecrire")))) return false;
  if (!absorbe.voitTout) return false;
  if (garder.entite_id === absorbe.entite_id) return true;
  if (!partage(garder.entite_id, absorbe.entite_id)) return false;
  if (!(superAdmin || (pg.includes("reglages.ecrire") && pa.includes("reglages.ecrire")))) return false;
  return pg.includes("clients.ecrire") && pg.includes("clients.lire") && !!garder.voitTout;
}
