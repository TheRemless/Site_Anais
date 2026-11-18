// Fiches clients partagées entre entreprises d'une même organisation (migration 46, demande de Jérémy du 18.11.2026).
// Une entreprise « source » (ZTP chez Zwald) partage ses fiches avec des entreprises « cibles » (Secret, Taxi) : la cible utilise la fiche
// telle quelle dans ses dossiers, sans copie. Sens unique : la source ne voit jamais les fiches de la cible.
// Seules les fiches passent d'une entreprise à l'autre ; un dossier de la cible au client de la source reste un dossier de la cible.
// Logique pure, testée par node --test. La base garantit les mêmes règles (partage_clients_permis, clients_lies).

const parId = (liste) => new Map((liste || []).map((x) => [x.id, x]));

// Les entreprises dont « cible » reçoit les fiches.
export const sourcesDe = (partages, cibleId) => new Set((partages || []).filter((p) => p.cible_id === cibleId).map((p) => p.source_id));
// Les entreprises avec qui « source » partage ses fiches.
export const ciblesDe = (partages, sourceId) => new Set((partages || []).filter((p) => p.source_id === sourceId).map((p) => p.cible_id));

// Qui choisit une fiche de la source dans la cible : l'administration générale, ou une administratrice (« reglages.ecrire ») des deux
// entreprises qui lit tous les clients de la source. Même règle que partage_clients_permis dans la base. L'assistante : jamais.
export function peutUtiliserPartages({ superAdmin = false, permissionsSource = [], permissionsCible = [] } = {}) {
  if (!permissionsCible.includes("dossiers.ecrire")) return false;
  if (superAdmin) return true;
  return permissionsSource.includes("reglages.ecrire") && permissionsCible.includes("reglages.ecrire") && permissionsSource.includes("clients.lire");
}

// Les fiches d'une entreprise telles que ses écrans les lisent : les siennes, plus celles d'une autre entreprise que ses dossiers utilisent
// (le nom d'un client ZTP sur un dossier Secret). Les fiches partagées pas encore utilisées n'y sont pas : elles ne se comptent pas ici.
export function clientsDeLEntreprise({ clients = [], dossiers = [], entiteId }) {
  const lies = new Set(dossiers.filter((d) => d.entite_id === entiteId).map((d) => d.client_id));
  return clients.filter((c) => c.entite_id === entiteId || lies.has(c.id));
}

// Les fiches des sources que la personne peut choisir dans la cible (recherche, choix du client, collages). Une ligne « nom seul »
// (clients_lies, pour l'assistante) n'est jamais une fiche à choisir.
export function clientsPartages({ clients = [], partages = [], entiteId, permis = () => false }) {
  const sources = [...sourcesDe(partages, entiteId)].filter((s) => permis(s));
  if (!sources.length) return [];
  const ok = new Set(sources);
  return clients.filter((c) => ok.has(c.entite_id) && !c.nom_seul);
}

// Les fiches proposées au choix : celles de l'entreprise d'abord, puis les fiches partagées, sans doublon.
export function clientsProposes(propres = [], partages = []) {
  const vus = new Set();
  return [...propres.filter((c) => !c.nom_seul), ...partages].filter((c) => (vus.has(c.id) ? false : vus.add(c.id)));
}

// Fiche d'une autre entreprise (partagée) dans l'entreprise affichée.
export const clientEtranger = (c, entiteId) => !!c && !!c.entite_id && c.entite_id !== entiteId;

// L'étiquette d'une entreprise sur une fiche partagée : son sigle (« Zwald Travel Planner » -> « ZTP »). Un nom court reste tel quel.
export function sigleEntreprise(nom) {
  const n = String(nom || "").trim();
  if (!n) return "";
  if (n.length <= 5 && !/\s/.test(n)) return n.toUpperCase();
  const mots = n.split(/[\s&·/,-]+/).filter((m) => /^\p{L}/u.test(m));
  const sigle = mots.map((m) => m[0].toUpperCase()).join("").slice(0, 4);
  return sigle.length >= 2 ? sigle : n.slice(0, 4).toUpperCase();
}

// Les noms reçus de clients_lies (un client d'une autre entreprise sur un dossier que la personne voit, sans accès à sa fiche) s'ajoutent
// aux fiches lues, marqués « nom seul ». Une fiche déjà lue en entier n'est jamais remplacée par son nom seul.
export function avecNomsLies(clients = [], lies = []) {
  const deja = new Set(clients.map((c) => c.id));
  return [...clients, ...lies.filter((l) => l && !deja.has(l.id)).map((l) => ({ id: l.id, entite_id: l.entite_id, civilite: l.civilite || "", prenom: l.prenom || "", nom: l.nom || "", telephone: "", email: "", adresse: "", notes: "", nom_seul: true }))];
}

// Sauvegarde d'une entreprise : ses propres fiches seulement. Une fiche de ZTP dans la sauvegarde de Secret, réimportée, serait réécrite
// dans Secret (l'import pose l'entreprise active sur chaque ligne).
export const clientsPourSauvegarde = (clients = [], entiteId) => clients.filter((c) => c.entite_id === entiteId && !c.nom_seul);

// Les dossiers du client dans les autres entreprises, pour sa fiche : référence, entreprise, dates, état, services (intitulé et date).
// Aucun montant : ni total, ni encaissé, ni net, ni commission.
export function dossiersAilleurs({ clientId, entiteId, dossiers = [], reservations = [], entites = [] }) {
  const ent = parId(entites);
  return dossiers
    .filter((d) => d.client_id === clientId && d.entite_id !== entiteId)
    .map((d) => ({
      id: d.id,
      ref: d.ref || "",
      entite_id: d.entite_id,
      entreprise: (ent.get(d.entite_id) || {}).nom || "",
      date_depart: d.date_depart || null,
      date_retour: d.date_retour || null,
      annule: !!d.annule,
      services: reservations
        .filter((r) => r.dossier_id === d.id && r.statut !== "annule")
        .map((r) => ({ libelle: r.libelle || "", date: r.date_service || null, heure: r.heure_pickup || "" }))
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))),
    }))
    .sort((a, b) => String(b.date_depart || b.services[0]?.date || "").localeCompare(String(a.date_depart || a.services[0]?.date || "")) || a.ref.localeCompare(b.ref));
}

// Tous les dossiers d'un client, toutes entreprises lues confondues (une fiche ZTP utilisée par Secret ne se supprime pas).
export const nbDossiersPartout = (clientId, dossiers = []) => dossiers.filter((d) => d.client_id === clientId).length;
