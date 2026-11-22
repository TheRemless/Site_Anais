// « Proposer une excursion » (22.11.2026, demande de Jérémy) : un client a un transfert (Taxi ou Secret) et reste plusieurs jours sur
// l'île ; la fiche du dossier et la carte WhatsApp proposent une ou deux excursions de Secret, prises dans son catalogue. Rien ne part
// tout seul : Nani choisit, relit le message, puis le copie, l'ouvre dans WhatsApp ou l'envoie dans la conversation.
// Règles tenues ici :
//   - prix de vente seulement (prestations.prix_vente) : les nets ne sont jamais lus ;
//   - aucun nom de partenaire : un service dont le libellé en contient un n'est pas proposé, et l'écran revérifie le texte ;
//   - les faits des modèles viennent du registre de faits de Secret (redaction-fr, zwald-secret-taxi.md) ; le service, le prix et le lien
//     viennent du catalogue ou de la page du site qui lui correspond (site-produits.mjs) ;
//   - pas de signature (fiche de voix, 19.11.2026) ; anglais seulement, Secret n'écrit qu'en anglais à ses clients.
// Logique pure, testée par tests/gestion-excursion-proposee.test.js. L'écran est views/proposer-excursion.mjs.
import { PRODUITS_SITE } from "./site-produits.mjs";
import { resteBloque } from "./agent-calc.mjs";
import { libelleClient } from "./partenaires-calc.mjs";
import { prestationEnfant } from "./demande-calc.mjs";

// ---- Familles ------------------------------------------------------------------------------------------------------------------------
// Une famille par grande sorte d'excursion, chacune avec son modèle. L'ordre est celui de la proposition : les îles d'abord.
export const FAMILLES_EXCURSION = ["iles", "elephants", "cuisine", "radeau", "quad", "plongee", "kayak", "autre"];

// La page du site d'une prestation (son identifiant y est relié par docs/gestion/regenerer-produits-site.mjs) : la source la plus sûre.
const PAGE_DE = (() => {
  const m = new Map();
  for (const p of PRODUITS_SITE) if (p.marque === "secret") for (const o of p.options || []) for (const t of o.tarifs || []) if (t.prestation) m.set(t.prestation, { ...p, option: o.titre || "" });
  return m;
})();
const FAMILLE_DE_PAGE = {
  "4-islands": "iles",
  "koh-phi-phi": "iles",
  "koh-rok-koh-haa": "iles",
  "elephant-sanctuary": "elephants",
  "cooking-class": "cuisine",
  "sunrise-raft": "radeau",
  "sunset-dinner-raft": "radeau",
  "fishing-trip": "radeau",
  atv: "quad",
  "scuba-diving": "plongee",
  kayak: "kayak",
  "mangrove-kayaking": "kayak",
  mangroves: "kayak",
  batik: "autre",
  "go-kart": "autre",
};
export const SITE_SECRET = "https://secrettravelandtour.com";

// Sans page du site (démonstration, prestation ajoutée depuis), la famille se lit dans le libellé.
const MOTS = [
  ["elephants", /elephant|éléphant/i],
  ["cuisine", /cooking|cuisine|chef/i],
  ["radeau", /\braft|radeau|fishing|p[eê]che/i],
  ["quad", /\batv\b|quad/i],
  ["plongee", /div(e|ing)|plong/i],
  ["kayak", /kayak|mangrove/i],
  ["iles", /island|\bkoh\b|\bîles?\b|phi phi|longtail|speedboat/i],
];
export function familleDe(p) {
  const page = p && PAGE_DE.get(p.id);
  if (page) return FAMILLE_DE_PAGE[page.id] || "autre";
  const t = `${(p && p.libelle_en) || ""} ${(p && p.libelle) || ""}`;
  return (MOTS.find(([, re]) => re.test(t)) || ["autre"])[0];
}
export const pageDe = (p) => (p && PAGE_DE.get(p.id)) || null;

// ---- Ce qui peut se proposer --------------------------------------------------------------------------------------------------------
// Une sortie qu'un client réserve seul, avec un prix de vente par personne ou par adulte. Pas les lignes enfant, supplément, groupe ou
// bateau privé (les bateaux privés n'affichent plus de prix en haute saison, registre du 18.11.2026), ni les locations, cours de
// plusieurs jours, sculpture de fruits, plongées pour plongeurs certifiés. Seule la journée « Basic Diver » représente la plongée.
const EXCLUS = /child|enfant|passenger|passager|extra|suppl|private|priv[ée]|charter|rental|location|nanny|refresher|specialty|computer|gopro|carving|sculpture|\bfee\b|frais/i;
export function proposable(p, { noms = [] } = {}) {
  if (!p || p.actif === false || !["excursion", "activite"].includes(p.famille)) return false;
  if (!["pp", "ad"].includes(p.unite) || !(Number(p.prix_vente) > 0) || p.sur_place) return false;
  const t = `${p.libelle_en || ""} ${p.libelle || ""}`;
  if (EXCLUS.test(t) || resteBloque(t, { noms }).length) return false;
  if (familleDe(p) === "plongee" && !/basic diver|discover/i.test(t)) return false;
  return true;
}

// Le prix enfant d'une sortie : celui du devis (demande-calc.mjs, prestationEnfant) : le champ « Prix enfant » de la prestation, sinon la
// prestation enfant séparée au même nom avant la virgule.
export const ligneEnfant = (p, prestations = []) => {
  const e = prestationEnfant(p, prestations);
  return e && Number(e.prix_vente) > 0 ? e : null;
};
const agesDe = (x) => {
  const m = /(\d{1,2})\s*(?:-|to|à)\s*(\d{1,2})/i.exec(String((x && (x.libelle_en || x.libelle)) || ""));
  return m ? `${m[1]} to ${m[2]}` : "";
};

// Une ou deux propositions, de familles différentes, dans l'ordre FAMILLES_EXCURSION puis l'ordre du catalogue. `deja` : les prestations
// et familles déjà réservées pour ce client (une famille déjà prise n'est pas reproposée). Rend toutes les possibilités triées : l'écran
// coche les `max` premières de familles différentes, Nani change le choix.
// `enfants` : le nombre d'enfants du groupe (0 : pas de prix enfant dans le message, et la plongée reste possible ; sinon pas de plongée,
// les âges ne sont pas connus). `jours` : les jours libres du séjour (joursLibres) ; une sortie de saison (Koh Rok, d'octobre à avril,
// registre du 28.10.2026) n'est proposée que si l'un d'eux tombe dans sa saison. Sans `jours`, la saison n'est pas vérifiée.
export function possibilites(prestations = [], { noms = [], deja = { prestations: new Set(), familles: new Set() }, enfants = 0, jours = null } = {}) {
  const rang = (f) => FAMILLES_EXCURSION.indexOf(f);
  return (prestations || [])
    .filter((p) => proposable(p, { noms }) && !deja.prestations.has(p.id))
    // Quad : les lignes enfant (conducteur, passager) partagent le même nom avant la virgule, le prix enfant pourrait être le mauvais ;
    // le modèle dit déjà les âges.
    .map((p) => ({ prestation: p, famille: familleDe(p), page: pageDe(p) }))
    .filter((x) => !(enfants > 0 && x.famille === "plongee"))
    .filter((x) => !jours || enSaison(x, jours))
    .map((x) => ({ ...x, enfant: x.famille === "quad" || !(enfants > 0) ? null : ligneEnfant(x.prestation, prestations) }))
    .filter((x) => !deja.familles.has(x.famille))
    .sort((a, b) => rang(a.famille) - rang(b.famille) || (a.prestation.ordre || 0) - (b.prestation.ordre || 0) || Number(a.prestation.prix_vente) - Number(b.prestation.prix_vente))
    // Un même nom affiché (karting de deux tailles, cours en duo saisi deux fois) ne se propose qu'une fois : le premier du catalogue.
    .filter((x, i, tous) => tous.findIndex((y) => nomService(y.prestation, y.page) === nomService(x.prestation, x.page)) === i);
}
// Saisons des sorties qui ne partent pas toute l'année (mois de 1 à 12). Koh Rok et Koh Haa : d'octobre à avril (registre de Secret).
export const SAISONS = [{ page: "koh-rok-koh-haa", libelle: /koh\s*rok/i, mois: [10, 11, 12, 1, 2, 3, 4] }];
export function enSaison(x, jours = []) {
  const p = x.prestation || {};
  const t = `${p.libelle_en || ""} ${p.libelle || ""}`;
  const s = SAISONS.find((z) => (x.page && x.page.id === z.page) || z.libelle.test(t));
  return !s || (jours || []).some((j) => s.mois.includes(Number(String(j).slice(5, 7))));
}

export function choixParDefaut(liste = [], max = 2) {
  const vues = new Set();
  const choix = [];
  for (const x of liste) {
    if (choix.length >= max) break;
    if (vues.has(x.famille)) continue;
    vues.add(x.famille);
    choix.push(x.prestation.id);
  }
  return choix;
}

// ---- Séjour ----------------------------------------------------------------------------------------------------------------------------
// Un transfert : un trajet du catalogue, une prestation de la famille « transfert », ou toute réservation d'une entreprise en mode taxi.
export const estTransfert = (r, { prestation = null, taxi = false } = {}) => !!r && r.statut !== "annule" && (taxi || !!r.trajet_id || (prestation && prestation.famille === "transfert"));
// Le sens d'un transfert : « arrivee » (vers l'île), « depart » (depuis l'île) ou null (trajet sans l'île, journée, aller-retour).
// Un trajet du catalogue ou un libellé « A → B » (ou « A to B ») donnent les deux bouts ; l'île est celle de l'organisation (`ile`).
// Une course de zone (« Krabi Airport » chez Taxi : l'île et la zone) se lit par le lieu de prise en charge : à la zone, à un aéroport ou à
// une jetée, c'est une arrivée ; ailleurs (l'hôtel), un départ ; sans lieu de prise en charge, le lieu de dépose décide.
const sansAccents = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const POINT_EXTERIEUR = /\b(airport|aeroport|pier|jetee|station|bus|terminal)\b/;
export function sensTransfert(r, { prestation = null, trajet = null, ile = "" } = {}) {
  if (!r) return null;
  const nom = sansAccents(ile).trim();
  const surIle = (t) => !!nom && sansAccents(t).includes(nom);
  const libelle = (prestation && (prestation.libelle_en || prestation.libelle)) || r.libelle || "";
  const dt = r.details || {};
  if (/\b(day trip|round trip)\b/i.test(`${libelle} ${r.libelle || ""}`) || dt.type_trajet === "retour_depart") return null;
  let bouts = trajet ? [trajet.de || "", trajet.vers || ""] : libelle.replace(/^[^:→]*:\s*/, "").split(/\s*(?:→|->|\bto\b)\s*/i).map((x) => x.trim()).filter(Boolean);
  if (bouts.length === 2) {
    const [de, vers] = bouts;
    if (surIle(vers) && !surIle(de)) return "arrivee";
    if (surIle(de) && !surIle(vers)) return "depart";
    return null;
  }
  const pickup = r.lieu_pickup || "";
  const dropoff = dt.drop_off || "";
  const zone = sansAccents(libelle).split(/[^a-z0-9]+/).filter((m) => m.length > 2 && !["airport", "and", "the", "town", "pier"].includes(m));
  const exterieur = (t) => !!t && (POINT_EXTERIEUR.test(sansAccents(t)) || zone.some((m) => sansAccents(t).split(/[^a-z0-9]+/).includes(m)));
  if (surIle(pickup)) return "depart";
  if (exterieur(pickup)) return "arrivee";
  if (pickup.trim()) return "depart";
  if (exterieur(dropoff)) return "depart";
  if (surIle(dropoff)) return "arrivee";
  return null;
}

// Le séjour du client sur l'île d'après ses transferts. Au moins un transfert doit nommer l'île (`ile`, « Koh Lanta » pour l'organisation
// d'Anaïs : exempleDe("lieu")). L'arrivée est le premier transfert vers l'île, le départ le premier transfert depuis l'île après elle ;
// un départ sans arrivée connue (le client est déjà sur l'île) ouvre un séjour au début inconnu (`arrivee` null). `sens(r)` : le sens de
// chaque transfert (sensTransfert) ; sans lui, le premier transfert est l'arrivée et le dernier le départ (règle d'avant, gardée pour les
// appels qui n'ont ni prestation ni trajet). Un départ à moins de deux nuits de l'arrivée n'est pas un séjour. Sans départ connu, le
// séjour reste ouvert (`nuits` null) : la proposition est permise jusqu'à 14 jours après l'arrivée. `ajd` : un séjour fini ne propose plus
// rien. Rend { arrivee, depart, nuits } ou null.
const jours = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const plusJours = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const texteTransfert = (r) => [r.libelle, r.lieu_pickup, (r.details || {}).drop_off].filter(Boolean).join(" ");
export const JOURS_SANS_DEPART = 14;
export function sejour(transferts = [], { ile = "", ajd = "", sens = null } = {}) {
  const liste = (transferts || []).filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date_service || "")).sort((a, b) => a.date_service.localeCompare(b.date_service));
  if (!liste.length) return null;
  const nom = String(ile || "").trim().toLowerCase();
  if (nom && !liste.some((r) => texteTransfert(r).toLowerCase().includes(nom))) return null;
  const sejours = [];
  if (sens) {
    // Chaque arrivée et le premier départ après elle ; un départ sans arrivée avant lui.
    let ouvert = null;
    for (const r of liste) {
      const s = sens(r);
      if (s === "arrivee") {
        if (ouvert) sejours.push(ouvert);
        ouvert = { arrivee: r.date_service, depart: null };
      } else if (s === "depart") {
        if (ouvert) {
          sejours.push({ ...ouvert, depart: r.date_service > ouvert.arrivee ? r.date_service : null, court: r.date_service <= ouvert.arrivee });
          ouvert = null;
        } else sejours.push({ arrivee: null, depart: r.date_service });
      }
    }
    if (ouvert) sejours.push(ouvert);
  } else {
    const arrivee = liste[0].date_service;
    const dernier = liste[liste.length - 1].date_service;
    sejours.push({ arrivee, depart: dernier > arrivee ? dernier : null });
  }
  const valables = sejours
    .filter((x) => !x.court)
    .map((x) => ({ arrivee: x.arrivee, depart: x.depart, nuits: x.arrivee && x.depart ? jours(x.arrivee, x.depart) : null }))
    .filter((x) => x.nuits === null || x.nuits >= 2)
    .filter((x) => !(ajd && x.depart && x.depart <= ajd))
    // Sans départ connu, une arrivée de plus de deux semaines ne dit plus rien du séjour.
    .filter((x) => !(ajd && !x.depart && x.arrivee && jours(x.arrivee, ajd) > JOURS_SANS_DEPART));
  // Le séjour en cours d'abord, sinon le prochain.
  return valables.find((x) => !ajd || !x.arrivee || x.arrivee <= ajd) || valables[0] || null;
}

// Les jours libres du séjour : du lendemain de l'arrivée (au plus tôt demain) à la veille du départ, ou jusqu'à 14 jours après l'arrivée
// quand le départ n'est pas connu. Un jour où une sortie est déjà réservée (`occupes`) n'est pas libre.
export function joursLibres(s, { ajd, occupes = [] } = {}) {
  if (!s || !ajd) return [];
  const pris = new Set(occupes || []);
  const demain = plusJours(ajd, 1);
  const lendemain = s.arrivee ? plusJours(s.arrivee, 1) : demain;
  const premier = lendemain > demain ? lendemain : demain;
  const dernier = s.depart ? plusJours(s.depart, -1) : s.arrivee ? plusJours(s.arrivee, JOURS_SANS_DEPART) : plusJours(ajd, JOURS_SANS_DEPART);
  const out = [];
  for (let j = premier; j <= dernier && out.length < 90; j = plusJours(j, 1)) if (!pris.has(j)) out.push(j);
  return out;
}

// ---- Message ---------------------------------------------------------------------------------------------------------------------------
// Modèles validés par Jérémy dans la PR (humanizer, puis fiche de voix et registre de faits de Secret). Une famille sans fait sûr dans le
// registre n'a pas de phrase : seulement le service, son prix et sa page.
export const MODELES = {
  intro: {
    un: "Hello {prenom}, since you're staying a few days, here is an idea for a day out.",
    deux: "Hello {prenom}, since you're staying a few days, here are two ideas for a day out.",
    // Client de Taxi : Secret se présente d'abord, avec son site (registre, 10.11.2026 : toujours un lien quand on les nomme).
    taxi_un: "Hello {prenom}, we also organise day trips and activities through Secret Travel & Tour ({site}). Since you're staying a few days, here is an idea.",
    taxi_deux: "Hello {prenom}, we also organise day trips and activities through Secret Travel & Tour ({site}). Since you're staying a few days, here are two ideas.",
  },
  familles: {
    iles: "Hotel transfer, lunch and snorkelling gear are included. The national park fee is paid in cash on the island.",
    elephants: "There is no riding at this sanctuary. You walk with the elephants, feed them and join them for their bath. Bring clothes that can get dirty, a towel and flip-flops.",
    cuisine: "You cook four dishes and make your own curry paste. Hotel transfer both ways is included, and you take home the recipe book and a certificate.",
    radeau: "It's a private wooden raft, just for your group.",
    quad: "A guide, the gear and hotel transfer are included, with fruit and drinks. Children can ride as passengers from age 4 and drive from age 6, with the guide.",
    plongee: "You dive with an instructor, two students each, from age 10. Breakfast, lunch, hotel transfer and the gear are included. The national park fee is extra.",
    kayak: "",
    autre: "",
  },
  fin: {
    un: "If it tempts you, tell me which day and how many people, and I'll check availability 😊",
    deux: "If one of them tempts you, tell me which day and how many people, and I'll check availability 😊",
  },
};

const montant = (n, devise) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(n))} ${devise}`;
// « 1,200 THB per person » ; avec la ligne enfant : « 2,000 THB per adult, 1,000 THB per child aged 4 to 11 ».
export function prixTexte(x, devise = "THB") {
  const p = x.prestation;
  // Quad : le prix du conducteur (le passager a sa ligne à part, jamais proposée seule).
  const unite = /\bdriver\b/i.test(`${p.libelle_en || ""} ${p.libelle || ""}`) ? "per driver" : p.unite === "ad" || x.enfant ? "per adult" : "per person";
  const enfant = x.enfant ? `, ${montant(x.enfant.prix_vente, devise)} per child${agesDe(x.enfant) ? ` aged ${agesDe(x.enfant)}` : ""}` : "";
  return `${montant(p.prix_vente, devise)} ${unite}${enfant}`;
}
// Le nom du service : celui de sa page du site et de son option (« Elephant sanctuary: Programme A, … » plutôt que « Program A »), sinon
// le libellé anglais du catalogue.
export function nomService(p, page = pageDe(p)) {
  if (page && page.nom) return page.option ? `${page.nom}: ${page.option}` : page.nom;
  return String((p && (p.libelle_en || libelleClient(p.libelle || ""))) || "").trim();
}
export const lienPage = (x) => (x && x.page && x.page.url ? `${SITE_SECRET}${x.page.url}` : "");

// Le message complet. `choisis` : les possibilités retenues (une ou deux). `taxi` : le dossier est chez Taxi.
export function messageExcursions(choisis = [], { prenom = "", devise = "THB", taxi = false } = {}) {
  if (!choisis.length) return "";
  const cle = `${taxi ? "taxi_" : ""}${choisis.length > 1 ? "deux" : "un"}`;
  const tete = MODELES.intro[cle].replace("Hello {prenom},", prenom ? `Hello ${prenom},` : "Hello,").replace("{site}", SITE_SECRET.replace(/^https:\/\//, ""));
  const blocs = choisis.map((x) => [`*${nomService(x.prestation, x.page)}*`, prixTexte(x, devise), MODELES.familles[x.famille] || "", lienPage(x)].filter(Boolean).join("\n"));
  return [tete, ...blocs, MODELES.fin[choisis.length > 1 ? "deux" : "un"]].join("\n\n");
}

// Les noms qui ne partent jamais vers un client : fiches partenaires (plus de deux lettres, comme nomsABloquer de la fonction agent) et
// conversations WhatsApp typées autrement que « client » ou reliées à une fiche partenaire (comme nomsContactsTypes de whatsapp-envoi).
// Le lien wa.me et la copie ne passent par aucun contrôle du serveur : l'écran les vérifie lui-même.
export function nomsInterdits({ partenaires = [], conversations = [] } = {}) {
  const noms = [
    ...(partenaires || []).map((p) => p && p.nom),
    ...(conversations || []).filter((c) => c && ((c.type_contact && c.type_contact !== "client") || c.partenaire_id)).map((c) => c.nom),
  ];
  return [...new Set(noms.map((n) => String(n || "").trim()).filter((n) => n.length > 2))];
}
