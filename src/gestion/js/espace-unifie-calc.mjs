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
export function espaceUnifie({ entites = [], activeId = null, permissionsDe = () => [] } = {}) {
  const active = entites.find((e) => e.id === activeId);
  const m = marqueUnifiee(active);
  if (!m) return null;
  const autre = entites.find((e) => e.id !== activeId && marqueUnifiee(e) && marqueUnifiee(e) !== m);
  if (!autre) return null;
  const ok = (id) => DROITS_UNIFIE.every((d) => permissionsDe(id).includes(d));
  if (!ok(active.id) || !ok(autre.id)) return null;
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
