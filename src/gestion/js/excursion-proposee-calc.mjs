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
import { nomsInterdits as nomsCommuns, nomCourt } from "./noms-interdits-calc.mjs";

// ---- Familles ------------------------------------------------------------------------------------------------------------------------
// Une famille par grande sorte d'excursion, chacune avec son modèle. L'ordre est celui de la proposition : les îles d'abord.
export const FAMILLES_EXCURSION = ["iles", "elephants", "cuisine", "radeau", "quad", "plongee", "kayak", "autre"];

// La page du site d'une prestation (son identifiant y est relié par docs/gestion/regenerer-produits-site.mjs) : la source la plus sûre.
const PAGE_DE = (() => {
  const m = new Map();
  for (const p of PRODUITS_SITE) if (p.marque === "secret") for (const o of p.options || []) for (const t of o.tarifs || []) if (t.prestation) m.set(t.prestation, { ...p, option: o.titre || "", optionId: o.id });
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
// Les âges du prix enfant, lus seulement dans la ligne enfant elle-même (« …, child (4-11) ») : un prix enfant tiré du champ « Prix enfant »
// de la prestation adulte (enfant_de) n'a pas d'âges, et un nombre du libellé adulte (« 1 hr 30 min to 2 hours ») n'en est pas un.
// Sans âges sûrs : « per child ».
export const agesDe = (x) => {
  if (!x || x.enfant_de) return "";
  const t = String(x.libelle_en || x.libelle || "");
  const m = /\b(?:child(?:ren)?|kids?|enfants?)\b[^0-9]{0,12}(\d{1,2})\s*(?:-|to|à)\s*(\d{1,2})/i.exec(t);
  return m ? `${m[1]} to ${m[2]}` : "";
};

// ---- Radeaux privés (réponse de Jérémy à la question 3 de la PR 310) --------------------------------------------------------------------
// Un radeau se vend pour le radeau (1 ou 2 personnes), puis par personne en plus, puis par enfant : trois lignes de la même option du site.
// Seule la première ligne (le radeau) se propose ; les deux autres donnent leurs prix, lus dans le catalogue par leur identifiant. Sans page
// du site reliée, pas de radeau (on ne sait pas lire ses lignes).
export const PAGES_RADEAU = ["sunrise-raft", "sunset-dinner-raft", "fishing-trip"];
export function radeauDe(p, prestations = []) {
  const page = pageDe(p);
  if (!page || !PAGES_RADEAU.includes(page.id)) return null;
  const option = (page.options || []).find((o) => o.id === page.optionId);
  const tarifs = (option && option.tarifs) || [];
  if (!tarifs.length || tarifs[0].prestation !== p.id) return null;
  const ligne = (re) => {
    const t = tarifs.find((x) => re.test(x.ligne || ""));
    const q = t ? (prestations || []).find((y) => y.id === t.prestation) : null;
    return q && q.actif !== false && Number(q.prix_vente) > 0 ? q : null;
  };
  return { extra: ligne(/extra/i), enfant: ligne(/^child/i) };
}
const radeauProposable = (p, prestations, { noms = [] } = {}) =>
  !!p && p.actif !== false && ["excursion", "activite"].includes(p.famille) && Number(p.prix_vente) > 0 && !p.sur_place && !resteBloque(`${p.libelle_en || ""} ${p.libelle || ""}`, { noms }).length && !!radeauDe(p, prestations);

// Une ou deux propositions, de familles différentes, dans l'ordre FAMILLES_EXCURSION puis l'ordre du catalogue. `deja` : les prestations
// et familles déjà réservées pour ce client (une famille déjà prise n'est pas reproposée). Rend toutes les possibilités triées : l'écran
// coche les `max` premières de familles différentes, Nani change le choix.
// `enfants` : le nombre d'enfants du groupe (0 : pas de prix enfant dans le message, et la plongée reste possible ; sinon pas de plongée,
// les âges ne sont pas connus). `jours` : les jours libres du séjour (joursLibres) ; une sortie de saison (Koh Rok, d'octobre à avril,
// registre du 28.10.2026) n'est proposée que si l'un d'eux tombe dans sa saison. Sans `jours`, la saison n'est pas vérifiée.
export function possibilites(prestations = [], { noms = [], deja = { prestations: new Set(), familles: new Set() }, enfants = 0, jours = null } = {}) {
  const rang = (f) => FAMILLES_EXCURSION.indexOf(f);
  return (prestations || [])
    .filter((p) => (proposable(p, { noms }) || radeauProposable(p, prestations, { noms })) && !deja.prestations.has(p.id))
    // Quad : les lignes enfant (conducteur, passager) partagent le même nom avant la virgule, le prix enfant pourrait être le mauvais ;
    // le modèle dit déjà les âges.
    .map((p) => ({ prestation: p, famille: familleDe(p), page: pageDe(p), radeau: radeauDe(p, prestations) }))
    .filter((x) => !(enfants > 0 && x.famille === "plongee"))
    .filter((x) => !jours || enSaison(x, jours))
    .map((x) => ({ ...x, enfant: x.famille === "quad" || !(enfants > 0) ? null : x.radeau ? x.radeau.enfant : ligneEnfant(x.prestation, prestations) }))
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
// « Ko Lanta », « Koh Lanta », « Koh-Lanta » : une seule forme.
const lieuPlat = (t) => ` ${sansAccents(t).replace(/[^a-z0-9]+/g, " ").replace(/\bko\b/g, "koh").trim()} `;
// Ce qui n'est jamais sur l'île : un aéroport, un quai, une gare, et les villes du continent et autres îles connues des trajets de Taxi et de
// Secret (registre : grille de VIP Taxi Lanta, horaires des speedboats). Les zones du catalogue Taxi s'y ajoutent (lieuxExterieurs).
const POINT_EXTERIEUR = /\b(airport|aeroport|pier|jetty|jetee|port|station|bus|terminal)\b/;
export const LIEUX_CONTINENT = [
  "krabi", "ao nang", "railay", "phuket", "patong", "kata", "karon", "khao lak", "khao sok", "cheow lan", "surat thani", "donsak", "pak bara",
  "pakbara", "trang", "hat yai", "hatyai", "bangkok", "hua hin", "satun", "koh phi phi", "phi phi", "koh lipe", "lipe", "koh yao", "langkawi",
  "koh mook", "koh ngai", "koh kradan", "koh samui", "koh phangan", "koh tao",
];
// Les lieux hors de l'île : la liste ci-dessus et le nom de chaque zone du catalogue Taxi (« Krabi Airport », « Phuket Airport and town »),
// sans les mots qui ne désignent pas un lieu.
export function lieuxExterieurs(zones = []) {
  const vides = new Set(["airport", "and", "the", "town", "pier", "private", "taxi", "minivan", "transfer", "from", "to", "station", "airport and town"]);
  const extra = (zones || []).flatMap((z) => sansAccents(z).replace(/\([^)]*\)/g, " ").split(/[,/]|\band\b/).map((x) => x.replace(/[^a-z0-9]+/g, " ").replace(/\b(airport|town|pier|station|private|taxi|minivan|transfer)\b/g, " ").replace(/\s+/g, " ").trim()));
  return [...new Set([...LIEUX_CONTINENT, ...extra.filter((x) => x.length > 2 && !vides.has(x))])];
}
// Un lieu sur l'île : il nomme l'île, ou il n'est ni un aéroport, ni un quai, ni un lieu connu hors de l'île (un hôtel, une plage, Saladan).
// Vide : on ne sait pas (null).
export function surIle(t, { ile = "", exterieurs = LIEUX_CONTINENT } = {}) {
  const x = lieuPlat(t);
  if (!x.trim()) return null;
  const nom = lieuPlat(ile).trim();
  if (nom && x.includes(` ${nom} `)) return true;
  if (POINT_EXTERIEUR.test(x)) return false;
  return !(exterieurs || []).some((l) => x.includes(` ${lieuPlat(l).trim()} `));
}
// Le sens d'un transfert : « arrivee » (vers l'île), « depart » (depuis l'île) ou null (trajet sans l'île, course sur l'île, journée,
// aller-retour). Un trajet du catalogue ou un libellé « A → B » (aussi « A -> B », « A to B », « A vers B ») donnent les deux bouts. Une course
// de zone (« Krabi Airport » chez Taxi : l'île et la zone) se lit par le lieu de prise en charge : sur l'île (l'hôtel), c'est un départ ;
// ailleurs (la zone, un aéroport), une arrivée ; sans lieu de prise en charge, le lieu de dépose décide. Une zone sur l'île est une course
// locale. `ile` : le nom de l'île de l'organisation (exempleDe("lieu")), `exterieurs` : lieuxExterieurs(zones du catalogue Taxi).
export function sensTransfert(r, { prestation = null, trajet = null, ile = "", exterieurs = LIEUX_CONTINENT } = {}) {
  if (!r) return null;
  const o = { ile, exterieurs };
  const libelle = (prestation && (prestation.libelle_en || prestation.libelle)) || r.libelle || "";
  const dt = r.details || {};
  if (/\b(day trip|round trip)\b/i.test(`${libelle} ${r.libelle || ""}`) || dt.type_trajet === "retour_depart") return null;
  // Le libellé de la réservation (saisie rapide : « Krabi Airport → Hotel Sunset ») passe avant celui du tarif de zone.
  const coupe = (t) => String(t || "").replace(/^[^:→]*:\s*/, "").split(/\s*(?:→|->|\bto\b|\bvers\b)\s*/i).map((x) => x.trim()).filter(Boolean);
  const bouts = trajet ? [trajet.de || "", trajet.vers || ""] : coupe(r.libelle).length === 2 ? coupe(r.libelle) : coupe(libelle);
  const sens = (de, vers) => {
    const a = surIle(de, o);
    const b = surIle(vers, o);
    if (b === true && a === false) return "arrivee";
    if (a === true && b === false) return "depart";
    return null;
  };
  if (bouts.length === 2) return sens(bouts[0], bouts[1]);
  const zone = bouts[0] || libelle;
  if (surIle(zone, o) !== false) return null;
  const pickup = r.lieu_pickup || "";
  const dropoff = dt.drop_off || "";
  const p = surIle(pickup, o);
  if (p === true) return "depart";
  if (p === false) return "arrivee";
  const d = surIle(dropoff, o);
  if (d === true) return "arrivee";
  if (d === false) return "depart";
  return null;
}

// Le séjour du client sur l'île d'après ses transferts. Sans `sens`, au moins un transfert doit nommer l'île (`ile`, « Koh Lanta » pour l'organisation
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
  // Sans le sens, un transfert doit nommer l'île. Avec le sens (sensTransfert), c'est lui qui dit l'île : « Krabi Airport → Hotel Sunset »
  // est une arrivée sans écrire « Koh Lanta » (revue de la PR 310).
  if (nom && !sens && !liste.some((r) => texteTransfert(r).toLowerCase().includes(nom))) return null;
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
  // Un séjour qui a une arrivée d'abord (en cours, sinon le prochain), puis un départ seul.
  const avecArrivee = valables.filter((x) => x.arrivee);
  return avecArrivee.find((x) => !ajd || x.arrivee <= ajd) || avecArrivee[0] || valables[0] || null;
}

// Les services du dossier lié de l'autre entreprise (même demande), pour les sorties déjà réservées et leurs jours. Lu seulement si ce
// dossier est lui aussi chez Secret ou chez Taxi : ces deux-là partagent leurs clients, ZTP garde les siens et son dossier n'est jamais lu.
// `marqueDe(entiteId)` : « secret », « taxi » ou null (marqueEntite de whatsapp-calc.mjs).
export function reservationsDuDossierLie(dossier, { dossiers = [], reservations = [], marqueDe = () => null } = {}) {
  if (!dossier || !dossier.dossier_lie_id) return [];
  const lie = (dossiers || []).find((d) => d.id === dossier.dossier_lie_id);
  if (!lie || lie.annule || !["secret", "taxi"].includes(marqueDe(lie.entite_id))) return [];
  return (reservations || []).filter((r) => r.dossier_id === lie.id && r.statut !== "annule");
}

// Les jours libres du séjour : du lendemain de l'arrivée (au plus tôt demain) à la veille du départ, ou jusqu'à 14 jours après l'arrivée
// quand le départ n'est pas connu. Un jour où une sortie est déjà réservée (`occupes`) n'est pas libre.
export function joursLibres(s, { ajd, occupes = [] } = {}) {
  if (!s || !ajd) return [];
  const pris = new Set(occupes || []);
  const demain = plusJours(ajd, 1);
  // Le jour d'arrivée n'est jamais libre. Départ seul : au plus 14 jours avant le départ.
  const lendemain = s.arrivee ? plusJours(s.arrivee, 1) : s.depart ? plusJours(s.depart, -JOURS_SANS_DEPART) : demain;
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
  },
  // Client de Taxi (décision de Jérémy, question 7 de la PR 310) : une question, sans pousser une sortie précise, puis deux ou trois exemples
  // du catalogue de Secret (nom et prix de vente) et la page des sorties. Texte donné par Jérémy le 22.11.2026 : le message part juste après
  // le voucher, donc ni « Hello » ni prénom, et pas de signature.
  taxi: {
    intro: "By the way, do you have any day trips or boat tours planned during your stay? We organise those too. A few ideas:",
    lien: "All our tours: {tours}",
    fin: "If one of them interests you, send me the day and the number of people and I'll check availability 😊",
  },
  familles: {
    iles: "Hotel transfer, lunch and snorkelling gear are included. The national park fee is paid in cash on the island.",
    elephants: "There is no riding at this sanctuary. You walk with the elephants, feed them and join them for their bath. Bring clothes that can get dirty, a towel and flip-flops.",
    // Jours et heures : cours avec marché et déjeuner, registre (réponse de Jérémy à la question 4 de la PR 310).
    cuisine: "You cook four dishes and make your own curry paste. Classes run on Monday, Wednesday and Saturday, from 9am to 2pm. Hotel transfer both ways is included, and you take home the recipe book and a certificate.",
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
  // Radeau : « 3,500 THB for 1 or 2 people, 1,800 THB for each extra person, 1,500 THB per child aged 3 to 9 » (lignes du site).
  if (x.radeau) {
    const morceaux = [`${montant(p.prix_vente, devise)} for 1 or 2 people`];
    if (x.radeau.extra) morceaux.push(`${montant(x.radeau.extra.prix_vente, devise)} for each extra person`);
    if (x.enfant) morceaux.push(`${montant(x.enfant.prix_vente, devise)} per child${agesDe(x.enfant) ? ` aged ${agesDe(x.enfant)}` : ""}`);
    return morceaux.join(", ");
  }
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

// La phrase de la famille, seulement pour un produit relié à une page du site de cette famille, et dont l'option est celle que la phrase
// décrit (revue de la PR 310 : une famille devinée d'après le libellé, « Dinner class, Single Chef » en cuisine, ou le programme D des
// éléphants, absent du registre, ne reçoit aucune phrase : le service, le prix et le lien seulement).
export const OPTIONS_SANS_PHRASE = { "elephant-sanctuary": ["programme-d"] };
export function phraseDe(x) {
  if (!x || !x.page || FAMILLE_DE_PAGE[x.page.id] !== x.famille) return "";
  if ((OPTIONS_SANS_PHRASE[x.page.id] || []).includes(x.page.optionId)) return "";
  return MODELES.familles[x.famille] || "";
}

// Le message complet. `choisis` : les possibilités retenues (une ou deux). `taxi` : le dossier est chez Taxi.
// Le voucher (ou la Booking confirmation) d'une réservation noté envoyé au client (details.envois.client, comme etatEnvoisVouchers).
export const voucherEnvoye = (r) => !!(r && r.details && r.details.envois && r.details.envois.client);
export const PAGE_TOURS = `${SITE_SECRET}/tours/`;
// Client de Taxi : la question, une ligne par exemple (« - 4 Islands: Join-in longtail, 1,000 THB per person »), la page des sorties et la
// fin, une ligne chacune, sans ligne vide (texte de Jérémy). Pas de prénom.
export function messageTaxi(choisis = [], { devise = "THB" } = {}) {
  if (!choisis.length) return "";
  const m = MODELES.taxi;
  const exemples = choisis.map((x) => `- ${nomService(x.prestation, x.page)}: ${prixTexte(x, devise)}`);
  return [m.intro, ...exemples, m.lien.replace("{tours}", PAGE_TOURS), m.fin].join("\n");
}
export function messageExcursions(choisis = [], { prenom = "", devise = "THB", taxi = false } = {}) {
  if (!choisis.length) return "";
  if (taxi) return messageTaxi(choisis, { devise });
  const cle = choisis.length > 1 ? "deux" : "un";
  const tete = MODELES.intro[cle].replace("Hello {prenom},", prenom ? `Hello ${prenom},` : "Hello,");
  const blocs = choisis.map((x) => [`*${nomService(x.prestation, x.page)}*`, prixTexte(x, devise), phraseDe(x), lienPage(x)].filter(Boolean).join("\n"));
  return [tete, ...blocs, MODELES.fin[choisis.length > 1 ? "deux" : "un"]].join("\n\n");
}

// Les noms qui ne partent jamais vers un client : fiches partenaires (plus de deux lettres, comme nomsABloquer de la fonction agent) et
// conversations WhatsApp nommées (partenaire, apporteur) ou reliées à une fiche partenaire, comme nomsContactsTypes de
// whatsapp-envoi. Jamais un contact « personnel » ni un client, ni le nom du client à qui l'on écrit (`client` : sa fiche). Chaque nom vient
// aussi sans « co, ltd, company, the, tour, tours, travel, koh, lanta » quand il garde quatre lettres, comme partenairesCites du serveur
// (« Blue Ocean Co., Ltd » bloque « Blue Ocean »). Le lien wa.me et la copie ne passent par aucun contrôle du serveur : l'écran les vérifie.
export const CONTACTS_NOMMES = ["partenaire", "apporteur"];
// Fonction commune avec le point du soir (noms-interdits-calc.mjs) ; ici avec les noms courts et la fiche du client.
export { nomCourt };
const contactNomme = (c) => CONTACTS_NOMMES.includes(c.type_contact) || (c.partenaire_id && c.type_contact !== "client" && c.type_contact !== "personnel");
export const nomsInterdits = ({ partenaires = [], conversations = [], client = null } = {}) => nomsCommuns({ partenaires, conversations, client, contactInterdit: contactNomme, nomsCourts: true });
