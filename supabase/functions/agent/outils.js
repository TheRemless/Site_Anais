// Agent de Gestion : les outils que Claude peut appeler, et ce qu'ils lui rendent. Logique pure, sans dépendance : les données arrivent par
// `ctx` (lues par la fonction avec la session de la personne, donc sous les règles RLS ; ou des tableaux en mémoire dans les tests).
//
// Règles tenues ici, pas dans le prompt :
//   - jamais un net, une marge, une commission ni un nom de prestataire dans ce qui part chez Claude. Les nets servent seulement à poser le
//     drapeau « recommande » (meilleure marge), calculé ici ;
//   - aucune écriture : les outils « proposer_* » rendent une carte que la personne valide dans l'écran (rien n'est écrit sans son clic) ;
//   - un prix proposé vient du catalogue (par sa référence) ou d'un montant tapé par la personne dans la conversation, jamais du modèle ;
//   - les heures d'une course sont calculées par planifier.js, pas par le modèle.
import { planifierCourse, reglagesPlanning, heureValide, tempsSimule } from "./planifier.js";
import { dureeEntre, clePaire, dureesTapees } from "./temps.js";

// ---- Petits outils de texte -----------------------------------------------------------------------------------------------------------

export const sansAccents = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
export const texte = (x, max = 300) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
const entier = (x, max = 60) => (Number.isInteger(x) && x >= 0 ? Math.min(x, max) : 0);
const nombre = (x) => (x === null || x === undefined || x === "" || Number.isNaN(Number(x)) ? null : Number(x));
const dateValide = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// Même clé souple que itineraire-calc.mjs (cleLieu) : « Koh Phi Phi » = « Phi Phi » ; « Krabi » ≠ « Krabi Airport ».
export const cleLieu = (s) =>
  sansAccents(s)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !["koh", "ko", "island", "isl"].includes(w))
    .join(" ");
export const cleHotel = (s) =>
  sansAccents(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
// Mêmes règles que partenaires-calc.mjs : actif, prestataire non masqué, date dans une fenêtre de circulation.
const proposable = (x, masques) => !!x && x.actif !== false && !masques.has(x.partenaire_id);
const disponible = (t, date) => {
  const f = Array.isArray(t.fenetres) ? t.fenetres : [];
  return !date || !f.length || f.some(([du, au]) => date >= du && date <= au);
};
const masquesDe = (partenaires) => new Set((partenaires || []).filter((p) => p.actif === false).map((p) => p.id));

// Référence courte d'une ligne de la base, que Claude cite à la place de l'identifiant : P- (tarif), T- (trajet), D- (dossier),
// R- (réservation), C- (client). Huit caractères de l'identifiant suffisent dans une entreprise ; la fonction relit l'identifiant complet.
export const refDe = (genre, id) => `${genre}-${String(id || "").replace(/-/g, "").slice(0, 8)}`;
export const trouverRef = (ref, lignes) => {
  const m = /^([A-Z])-([0-9a-f]{8})$/i.exec(String(ref || "").trim());
  if (!m) return null;
  return (lignes || []).find((l) => String(l.id).replace(/-/g, "").toLowerCase().startsWith(m[2].toLowerCase())) || null;
};

// Les noms des prestataires retirés d'un mode (« Satun speedboat » → « speedboat ») : aucun nom de compagnie ne part.
function sansNoms(t, noms) {
  const echappe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return noms.reduce((acc, n) => acc.replace(new RegExp(echappe(n), "gi"), " "), String(t || "")).replace(/\s+/g, " ").replace(/^[\s,·+-]+|[\s,·+-]+$/g, "").trim();
}
const nomsPrestataires = (partenaires) =>
  (partenaires || [])
    .map((p) => String(p.nom || "").trim())
    .filter((n) => n.length > 2)
    .sort((a, b) => b.length - a.length);

// ---- Définitions des outils (format de l'API, strict) ---------------------------------------------------------------------------------
// Tous les champs sont requis (mode strict) : « vide » s'écrit "" ou 0. Les bornes se vérifient dans le code.

const obj = (properties, description) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}) });
const S = (description) => ({ type: "string", description });
const I = (description) => ({ type: "integer", description });
const B = (description) => ({ type: "boolean", description });

const SERVICE = obj({
  texte: S("Le service en quelques mots, tel que demandé (« transfert Lanta → aéroport de Krabi »)."),
  ref: S("La référence du catalogue (P-… ou T-…) rendue par un outil, ou \"\" pour un service hors catalogue."),
  date: S("AAAA-MM-JJ ou \"\"."),
  heure_pickup: S("HH:MM, de préférence celle de planifier_course, ou \"\"."),
  lieu_pickup: S("Hôtel ou point de prise en charge, ou \"\"."),
  de: S("Lieu de départ d'un transfert, ou \"\"."),
  vers: S("Lieu d'arrivée d'un transfert, ou \"\"."),
  adultes: I("0 si inconnu."),
  enfants: I("0 si inconnu."),
  prix_saisi: S("Seulement un montant que la personne a tapé dans la conversation pour ce service (« 3500 »), sinon \"\". Jamais un prix que tu estimes."),
  remarque: S("Ce qu'il faut savoir pour réserver (vol, bagages, attente), ou \"\"."),
});

export const OUTILS = [
  {
    name: "chercher_catalogue",
    description:
      "Cherche dans le catalogue de l'entreprise (excursions, activités, locations, transferts, trajets) par mots-clés. Rend les tarifs de vente avec leur référence, et « recommande » sur l'option à garder quand plusieurs se valent. N'invente jamais un tarif absent de ce résultat.",
    strict: true,
    input_schema: obj({
      recherche: S("Mots-clés en anglais ou en français (« 4 islands », « Phi Phi speedboat », « airport »)."),
      famille: { type: "string", enum: ["tout", "excursion", "activite", "location", "transfert", "trajet", "autre"], description: "Restreint la recherche, « tout » sinon." },
    }),
  },
  {
    name: "horaires_trajet",
    description:
      "Les départs du catalogue entre deux lieux un jour donné (bateaux, ferries, minivans partagés) : heures, durée, prix de vente par adulte et par enfant. « recommande » marque les départs à proposer d'abord. Si rien n'est trouvé, l'outil rend les lieux connus pour corriger l'orthographe.",
    strict: true,
    input_schema: obj({ de: S("Lieu de départ (île, ville, embarcadère)."), vers: S("Lieu d'arrivée."), date: S("AAAA-MM-JJ, ou \"\" si inconnue."), adultes: I("0 si inconnu."), enfants: I("0 si inconnu.") }),
  },
  {
    name: "situer_hotels",
    description:
      "Situe des hôtels (île ou ville, plage ou quartier) : d'abord dans les hôtels déjà connus de l'entreprise, sinon par une recherche web sur le nom seul. Rend la source et la certitude. Un hôtel non tranché reste à demander.",
    strict: true,
    input_schema: obj({ noms: { type: "array", items: { type: "string" }, description: "Noms d'hôtels tels qu'écrits par le client (8 au plus)." } }),
  },
  {
    name: "temps_de_route",
    description:
      "Durée en voiture entre deux lieux : d'abord la table de temps de référence de l'entreprise, sinon openrouteservice (OpenStreetMap), avec le ferry et la marge conseillée. Dit d'où vient la durée et si elle est à vérifier. Pour une course avec horaires, utilise planifier_course.",
    strict: true,
    input_schema: obj({ de: S("Nom de lieu précis, avec l'île ou la ville (« Jai Tiki Retreat, Koh Lanta »)."), vers: S("Idem.") }),
  },
  {
    name: "estimer_temps_web",
    description:
      "Dernier recours, seulement quand temps_de_route ou planifier_course n'ont aucune durée et que la personne ne la connaît pas : cherche une durée de trajet en voiture sur le web, avec sa source. Le résultat est une estimation, à présenter comme telle.",
    strict: true,
    input_schema: obj({ de: S("Lieu de départ."), vers: S("Lieu d'arrivée.") }),
  },
  {
    name: "planifier_course",
    description:
      "Calcule les heures d'une course privée en voiture : pickup à rebours depuis un rendez-vous (route avec trafic, ferry, marge de sécurité), heures d'arrivée à chaque point, et si un vol est tenable. Toujours utiliser cet outil pour donner une heure de pickup : ne calcule jamais une heure toi-même.",
    strict: true,
    input_schema: obj({
      date: S("Date de la course, AAAA-MM-JJ."),
      points: {
        type: "array",
        description: "Les points dans l'ordre : le pickup, puis chaque arrêt, puis la destination finale (deux au moins).",
        items: obj({
          lieu: S("Nom précis avec l'île ou la ville (« Jai Tiki Retreat, Koh Lanta »)."),
          arrivee_voulue: S("HH:MM si le client doit y être à une heure donnée (rendez-vous), sinon \"\". Une seule dans la course."),
          attente_min: I("Minutes d'attente sur place avant de repartir, 0 sinon."),
          duree_vers_suivant_min: I("0 en général : la durée vient de la table. Seulement une durée donnée par la personne dans la conversation, ou rendue par estimer_temps_web."),
          source_duree: { type: "string", enum: ["", "personne", "estimation_web"], description: "D'où vient duree_vers_suivant_min, \"\" si 0." },
        }),
      },
      heure_depart: S("HH:MM si l'heure de pickup est déjà fixée (sans rendez-vous), sinon \"\"."),
      heure_vol: S("HH:MM de décollage si la course finit à l'aéroport et que l'heure est connue, sinon \"\"."),
      vol_international: B("Vrai pour un vol international."),
    }),
  },
  {
    name: "chercher_clients",
    description: "Cherche des clients de l'entreprise par nom, prénom, téléphone ou référence de dossier. Rend leurs dossiers (référence, dates, annulé ou non).",
    strict: true,
    input_schema: obj({ recherche: S("Nom, téléphone ou référence.") }),
  },
  {
    name: "lire_dossier",
    description: "Lit un dossier : client, dates et services réservés (date, heure et lieu de pickup, personnes, statut, prix de vente). Chaque service a une référence R-… pour proposer une modification.",
    strict: true,
    input_schema: obj({ dossier: S("Référence D-… rendue par chercher_clients, ou la référence du dossier (« 2026-0142 »).") }),
  },
  {
    name: "proposer_dossier",
    description:
      "Propose de créer un dossier pour un nouveau client. Affiche une carte que la personne vérifie et valide : rien n'est créé sans son clic. Le prix vient du catalogue par la référence, ou reste vide pour qu'elle le fixe.",
    strict: true,
    input_schema: obj({
      titre: S("Titre court de la carte (« Dossier Mme Martin, 3 transferts »)."),
      client_nom: S("Nom tel qu'écrit par le client, ou \"\"."),
      client_telephone: S("Téléphone tel qu'écrit, ou \"\"."),
      hotel: S("Hôtel du client, ou \"\"."),
      langue: { type: "string", enum: ["fr", "en", ""], description: "Langue du client." },
      adultes: I("0 si inconnu."),
      enfants: I("0 si inconnu."),
      bebes: I("0 si inconnu."),
      services: { type: "array", items: SERVICE, description: "Un service par prestation (un aller-retour fait deux services)." },
    }),
  },
  {
    name: "proposer_reservation",
    description: "Propose d'ajouter un service à un dossier existant (carte à valider).",
    strict: true,
    input_schema: obj({ titre: S("Titre court de la carte."), dossier: S("Référence D-… du dossier."), service: SERVICE }),
  },
  {
    name: "proposer_modification",
    description: "Propose de modifier un service réservé (carte à valider) : sa date, son heure ou son lieu de pickup, ses personnes ou une remarque.",
    strict: true,
    input_schema: obj({
      titre: S("Titre court de la carte."),
      reservation: S("Référence R-… rendue par lire_dossier."),
      champ: { type: "string", enum: ["date", "heure_pickup", "lieu_pickup", "adultes", "enfants", "remarque"] },
      valeur: S("La nouvelle valeur (AAAA-MM-JJ, HH:MM, texte ou nombre)."),
      raison: S("Pourquoi, en une phrase, pour la personne."),
    }),
  },
  {
    name: "proposer_temps_trajet",
    description: "Propose d'ajouter (ou de corriger) une durée dans la table de temps de référence de l'entreprise, après que la personne l'a donnée. Carte à valider.",
    strict: true,
    input_schema: obj({
      titre: S("Titre court de la carte."),
      de: S("Zone ou lieu de départ (« Koh Lanta », « Krabi Town »)."),
      vers: S("Zone ou lieu d'arrivée."),
      duree_min: I("Durée en minutes, telle que donnée par la personne."),
      ferry: B("Vrai si le trajet prend le ferry."),
      marge_min: I("Marge conseillée en minutes, 0 si non donnée."),
      source: S("Qui l'a donnée (« Nani, d'après Mr. Brown »)."),
    }),
  },
  {
    name: "proposer_reponse",
    description:
      "Propose le message à envoyer au client, prêt à copier. La personne le relit, le modifie et l'envoie elle-même. Chaque prix et chaque heure du message doivent venir d'un résultat d'outil ou d'un montant tapé par la personne.",
    strict: true,
    input_schema: obj({ titre: S("Titre court de la carte."), langue: { type: "string", enum: ["fr", "en"] }, message: S("Le message au client, prêt à coller dans WhatsApp.") }),
  },
];
export const NOMS_OUTILS = OUTILS.map((o) => o.name);
export const OUTILS_PROPOSITION = ["proposer_dossier", "proposer_reservation", "proposer_modification", "proposer_reponse", "proposer_temps_trajet"];

// ---- Contrôle des entrées ---------------------------------------------------------------------------------------------------------
// Le mode strict garantit la forme ; on revérifie quand même (types, tailles) avant d'exécuter, comme pour une entrée d'utilisateur.
export function entreeValide(nom, e) {
  const def = OUTILS.find((o) => o.name === nom);
  if (!def || !e || typeof e !== "object" || Array.isArray(e)) return false;
  const verifier = (schema, v) => {
    if (schema.type === "object") return v && typeof v === "object" && !Array.isArray(v) && schema.required.every((k) => k in v && verifier(schema.properties[k], v[k])) && Object.keys(v).every((k) => k in schema.properties);
    if (schema.type === "array") return Array.isArray(v) && v.length <= 12 && v.every((x) => verifier(schema.items, x));
    if (schema.type === "string") return typeof v === "string" && v.length <= 4000 && (!schema.enum || schema.enum.includes(v));
    if (schema.type === "integer") return Number.isInteger(v) && v >= 0 && v <= 10000;
    if (schema.type === "boolean") return typeof v === "boolean";
    return false;
  };
  return verifier(def.input_schema, e);
}

// ---- Catalogue -------------------------------------------------------------------------------------------------------------------

const prestationProposable = (p) => !["option", "frais"].includes(p.famille) && !["ch", "sup"].includes(p.unite);
const correspond = (txt, mots) => mots.every((m) => txt.includes(m));
const motsDe = (q) =>
  sansAccents(q)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !["the", "de", "du", "la", "le", "les", "to", "a", "et", "and", "koh", "ko"].includes(w));

// Le drapeau « recommande » : dans un groupe d'options équivalentes, celle à la meilleure marge (vente moins net), quand au moins deux nets
// sont connus et que les marges diffèrent. La marge elle-même ne sort jamais d'ici.
function recommandes(options, margeDe) {
  const connues = options.map((o) => ({ o, m: margeDe(o) })).filter((x) => x.m !== null);
  if (connues.length < 2) return new Set();
  const top = Math.max(...connues.map((x) => x.m));
  if (connues.every((x) => x.m === top)) return new Set();
  return new Set(connues.filter((x) => x.m === top).map((x) => x.o.id));
}

export async function chercherCatalogue(e, ctx) {
  const [prestations, trajets, partenaires, netsP, netsT] = await Promise.all([ctx.charger("prestations"), ctx.charger("trajets"), ctx.charger("partenaires"), ctx.charger("prestations_nets"), ctx.charger("trajets_nets")]);
  const masques = masquesDe(partenaires);
  const noms = nomsPrestataires(partenaires);
  const mots = motsDe(e.recherche);
  const netP = new Map((netsP || []).map((n) => [n.prestation_id, n]));
  const netT = new Map((netsT || []).map((n) => [n.trajet_id, n]));
  const lignes = [];
  if (e.famille !== "trajet") {
    const ps = (prestations || []).filter((p) => proposable(p, masques) && prestationProposable(p) && (e.famille === "tout" || p.famille === e.famille));
    const trouves = ps.filter((p) => correspond(sansAccents([p.libelle, p.libelle_en, p.groupe, p.famille].join(" ")), mots));
    // Options équivalentes : même groupe (la même excursion chez deux prestataires), sinon même libellé.
    const groupes = new Map();
    for (const p of trouves) {
      const g = sansAccents(p.groupe || p.libelle_en || p.libelle);
      groupes.set(g, [...(groupes.get(g) || []), p]);
    }
    for (const liste of groupes.values()) {
      const reco = recommandes(liste, (p) => {
        const n = netP.get(p.id);
        return n && nombre(n.net) !== null && nombre(p.prix_vente) !== null ? Number(p.prix_vente) - Number(n.net) : null;
      });
      for (const p of liste)
        lignes.push({
          ref: refDe("P", p.id),
          libelle: sansNoms(texte(p.libelle_en || p.libelle, 160), noms),
          ...(p.libelle_en && p.libelle && p.libelle_en !== p.libelle ? { libelle_fr: sansNoms(texte(p.libelle, 160), noms) } : {}),
          groupe: sansNoms(texte(p.groupe, 80), noms),
          famille: p.famille,
          prix_vente: nombre(p.prix_vente),
          unite: texte(p.unite, 20),
          ...(reco.has(p.id) ? { recommande: true } : {}),
        });
    }
  }
  if (e.famille === "tout" || e.famille === "trajet" || e.famille === "transfert") {
    for (const t of (trajets || []).filter((t) => proposable(t, masques) && correspond(sansAccents([t.de, t.vers, t.mode].join(" ")), mots)))
      lignes.push({ ref: refDe("T", t.id), trajet: `${texte(t.de, 80)} → ${texte(t.vers, 80)}`, mode: sansNoms(texte(t.mode, 60), noms), depart: texte(t.depart, 10), arrivee: texte(t.arrivee, 10), duree: texte(t.duree, 30), prix_adulte: nombre(t.prix_adulte), prix_enfant: nombre(t.prix_enfant), periode: texte(t.periode, 60) });
  }
  // Recommandés d'abord, puis par libellé : le même catalogue donne toujours le même résultat.
  lignes.sort((a, b) => (b.recommande ? 1 : 0) - (a.recommande ? 1 : 0) || String(a.libelle || a.trajet).localeCompare(String(b.libelle || b.trajet)));
  const prixVus = lignes.flatMap((l) => [l.prix_vente, l.prix_adulte, l.prix_enfant]).filter((x) => x !== null && x !== undefined);
  return { resultat: { nombre: lignes.length, lignes: lignes.slice(0, 30), ...(lignes.length > 30 ? { tronque: true } : {}), ...(lignes.length ? {} : { conseil: "Aucun tarif ne correspond : essaie d'autres mots, ou dis que ce n'est pas au catalogue." }) }, prix: prixVus };
}

// ---- Horaires des trajets --------------------------------------------------------------------------------------------------------

export async function horairesTrajet(e, ctx) {
  const [trajets, partenaires, netsT] = await Promise.all([ctx.charger("trajets"), ctx.charger("partenaires"), ctx.charger("trajets_nets")]);
  const masques = masquesDe(partenaires);
  const noms = nomsPrestataires(partenaires);
  const de = cleLieu(e.de);
  const vers = cleLieu(e.vers);
  const date = dateValide(e.date) ? e.date : "";
  // Clé souple, sans inclusion : « Krabi » n'est pas « Krabi Airport » (même règle que departsDuTrajet). Sinon, les lieux connus aident à corriger.
  const pareil = (a, b) => a === b;
  const ok = (trajets || []).filter((t) => proposable(t, masques) && pareil(cleLieu(t.de), de) && pareil(cleLieu(t.vers), vers) && disponible(t, date));
  if (!ok.length) {
    const lieux = [...new Set((trajets || []).filter((t) => proposable(t, masques)).flatMap((t) => [texte(t.de, 80), texte(t.vers, 80)]))].sort();
    return { resultat: { trouve: false, date, lieux_connus: lieux.slice(0, 60), conseil: "Aucun départ au catalogue pour ce trajet et cette date. Vérifie l'orthographe avec les lieux connus, sinon dis à la personne que ce trajet n'est pas au catalogue." }, prix: [] };
  }
  const netT = new Map((netsT || []).map((n) => [n.trajet_id, n]));
  const adultes = entier(e.adultes);
  const enfants = entier(e.enfants);
  // Même règle que itineraire-calc.mjs (margeDepart, departsDuTrajet) : la marge du groupe, la meilleure compagnie mise en avant avec tous ses
  // départs ; à marge égale, plusieurs compagnies.
  const marge = (t) => {
    const n = netT.get(t.id);
    const pa = nombre(t.prix_adulte);
    const na = n ? nombre(n.net_adulte) : null;
    if (pa === null || na === null) return null;
    const pe = nombre(t.prix_enfant);
    const ne = n ? nombre(n.net_enfant) : null;
    if (enfants > 0 && pe !== null && ne === null) return null;
    const a = adultes || enfants ? adultes : 1;
    return a * (pa - na) + (enfants > 0 && pe !== null && ne !== null ? enfants * (pe - ne) : 0);
  };
  const parCie = new Map();
  for (const t of ok) {
    const m = marge(t);
    const id = t.partenaire_id || "";
    parCie.set(id, Math.max(parCie.get(id) ?? -Infinity, m ?? -Infinity));
  }
  const connues = [...parCie.entries()].filter(([, m]) => m > -Infinity);
  const top = connues.length ? Math.max(...connues.map(([, m]) => m)) : null;
  const gagnantes = new Set(connues.length > 1 && !connues.every(([, m]) => m === top) ? connues.filter(([, m]) => m === top).map(([id]) => id) : []);
  const departs = ok
    .map((t) => ({ ref: refDe("T", t.id), de: texte(t.de, 80), vers: texte(t.vers, 80), mode: sansNoms(texte(t.mode, 60), noms), depart: texte(t.depart, 5), arrivee: texte(t.arrivee, 5), duree: texte(t.duree, 30), prix_adulte: nombre(t.prix_adulte), prix_enfant: nombre(t.prix_enfant), bebe: texte(t.bebe, 40), ...(gagnantes.has(t.partenaire_id || "") ? { recommande: true } : {}) }))
    .sort((a, b) => (b.recommande ? 1 : 0) - (a.recommande ? 1 : 0) || a.depart.localeCompare(b.depart));
  return { resultat: { trouve: true, date, departs: departs.slice(0, 20) }, prix: departs.flatMap((d) => [d.prix_adulte, d.prix_enfant]).filter((x) => x !== null), heures: departs.flatMap((d) => [d.depart, d.arrivee]).filter(Boolean) };
}

// ---- Hôtels ----------------------------------------------------------------------------------------------------------------------------

export async function situerHotels(e, ctx) {
  const noms = [...new Set((e.noms || []).map((n) => texte(String(n).split("\n")[0], 120)).filter(Boolean))].slice(0, 8);
  if (!noms.length) return { resultat: { erreur: "aucun_nom" } };
  const connus = (await ctx.charger("hotels_lieux")) || [];
  const hotels = [];
  const aChercher = [];
  for (const nom of noms) {
    const l = connus.find((x) => x.cle === cleHotel(nom));
    if (l && (l.lieu || l.verifie)) hotels.push({ nom, lieu: l.lieu, zone: l.zone || "", localite: l.localite || "", certitude: l.verifie ? "verifie" : l.certitude, source: l.source_url ? "table des hôtels" : "" });
    else aChercher.push(nom);
  }
  if (aChercher.length) {
    const trouves = ctx.situerWeb ? await ctx.situerWeb(aChercher) : null;
    for (const nom of aChercher) {
      const r = trouves && trouves.find((x) => cleHotel(x.nom) === cleHotel(nom));
      hotels.push(r ? { nom, lieu: r.lieu || "", zone: r.zone || "", localite: r.localite || "", certitude: r.certitude || "inconnue", source: r.source ? r.source.url : "" } : { nom, lieu: "", zone: "", localite: "", certitude: "inconnue", source: "", note: "Recherche indisponible : demande à la personne où se trouve cet hôtel." });
    }
  }
  return { resultat: { hotels } };
}

// ---- Temps de route et planning --------------------------------------------------------------------------------------------------

// La durée d'un trajet en voiture, dans l'ordre de temps.js : table vérifiée, openrouteservice, table à vérifier, démo. ctx.ors et
// ctx.simule ne sont posés que si la fonction les a (clé ORS, démonstration).
const dureeDe = async (ctx, de, vers) => dureeEntre(de, vers, { lignes: (await ctx.charger("temps_trajets")) || [], hotels: (await ctx.charger("hotels_lieux")) || [], ors: ctx.ors || null, simule: ctx.simule || null });
const cleEstimation = (de, vers) => clePaire(de, vers);

export async function tempsDeRoute(e, ctx) {
  const r = await dureeDe(ctx, texte(e.de, 200), texte(e.vers, 200));
  if (!r) return { resultat: { erreur: "temps_indisponible", conseil: "Aucune durée connue pour ce trajet : dis-le et demande la durée à la personne (elle pourra l'ajouter à la table)." } };
  return { resultat: { de: texte(e.de, 200), vers: texte(e.vers, 200), duree_min: r.duree_min, distance_km: r.distance_km ?? null, ferry: !!r.ferry, marge_conseillee_min: r.marge_min || 0, source: r.source, a_verifier: r.a_verifier, ...(r.de_trouve ? { de_trouve: r.de_trouve, vers_trouve: r.vers_trouve } : {}) } };
}

// Le planning d'une course. Pour chaque trajet : la durée donnée par la personne (si elle l'a tapée dans la conversation) ou une estimation
// web déjà rendue par estimer_temps_web, sinon la durée de la table ou d'ORS. Une durée qui ne vient de nulle part est refusée.
export async function planifier(e, ctx, memo = { durees: new Set(), estimations: new Map() }) {
  if (!dateValide(e.date)) return { resultat: { erreur: "date_manquante", conseil: "Demande la date de la course." } };
  const points = (e.points || []).slice(0, 8).map((p) => ({ lieu: texte(p.lieu, 160), arrivee_voulue: heureValide(p.arrivee_voulue) ? p.arrivee_voulue : "", attente_min: Math.min(entier(p.attente_min, 720), 720), duree: entier(p.duree_vers_suivant_min, 1440), source: p.source_duree || "" }));
  if (points.length < 2) return { resultat: { erreur: "deux_points_au_moins" } };
  if (points.filter((p) => p.arrivee_voulue).length > 1) return { resultat: { erreur: "un_seul_rendez_vous", conseil: "Garde un seul rendez-vous ; les autres heures se calculent." } };
  if (!points.some((p) => p.arrivee_voulue) && heureValide(e.heure_depart)) points[0].depart_voulu = e.heure_depart;
  if (!points.some((p) => p.arrivee_voulue || p.depart_voulu)) return { resultat: { erreur: "heure_manquante", conseil: "Il faut soit l'heure du rendez-vous, soit l'heure de pickup." } };
  const trajets = [];
  const refusees = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const nom = `${p.lieu} → ${points[i + 1].lieu}`;
    if (p.duree && p.source === "personne") {
      if (memo.durees && memo.durees.has(p.duree)) trajets.push({ duree_min: p.duree, ferry: false, source: "personne" });
      else (refusees.push(nom), trajets.push(null));
      continue;
    }
    if (p.duree && p.source === "estimation_web") {
      const est = memo.estimations && memo.estimations.get(cleEstimation(p.lieu, points[i + 1].lieu));
      if (est && est.duree_min === p.duree) trajets.push({ duree_min: p.duree, ferry: !!est.ferry, source: "estimation_web", source_url: est.source_url });
      else (refusees.push(nom), trajets.push(null));
      continue;
    }
    trajets.push(await dureeDe(ctx, p.lieu, points[i + 1].lieu));
  }
  if (refusees.length) return { resultat: { erreur: "duree_sans_source", trajets: refusees, conseil: "Une durée ne compte que si la personne l'a écrite dans la conversation, ou si estimer_temps_web l'a rendue pour ce trajet." } };
  const manque = trajets.findIndex((x) => !x);
  if (manque >= 0) return { resultat: { erreur: "temps_indisponible", trajet: `${points[manque].lieu} → ${points[manque + 1].lieu}`, conseil: "Aucune durée connue pour ce trajet : dis-le simplement et demande la durée à la personne. Quand elle l'a donnée, propose de l'ajouter à la table (proposer_temps_trajet). L'estimation web ne vient qu'en dernier recours." } };
  const plan = planifierCourse({ date: e.date, points, trajets, vol: heureValide(e.heure_vol) ? { heure: e.heure_vol, international: !!e.vol_international } : null, reglages: reglagesPlanning(ctx.reglages) });
  if (!plan.ok) return { resultat: { erreur: plan.erreur } };
  const heures = [plan.pickup.heure, ...plan.etapes.flatMap((x) => [x.arrivee_prevue && x.arrivee_prevue.heure, x.arrivee_au_plus_tard && x.arrivee_au_plus_tard.heure, x.depart && x.depart.heure, x.rendez_vous]), plan.vol && plan.vol.arrivee_limite.heure, plan.vol && plan.vol.heure].filter(Boolean);
  return { resultat: plan, heures, planning: plan };
}

// Dernier recours : une durée trouvée par la recherche web (ctx.estimerWeb, appel séparé avec sources contrôlées), toujours marquée estimation.
export async function estimerTempsWeb(e, ctx, memo) {
  const de = texte(e.de, 160);
  const vers = texte(e.vers, 160);
  const connue = await dureeDe(ctx, de, vers);
  if (connue) return { resultat: { erreur: "duree_deja_connue", duree_min: connue.duree_min, source: connue.source, conseil: "La table ou ORS donnent déjà cette durée : utilise planifier_course." } };
  const r = ctx.estimerWeb ? await ctx.estimerWeb(de, vers) : null;
  if (!r || !(r.duree_min > 0) || !r.source_url) return { resultat: { erreur: "estimation_impossible", conseil: "Aucune source fiable trouvée : demande la durée à la personne." } };
  if (memo && memo.estimations) memo.estimations.set(cleEstimation(de, vers), r);
  return { resultat: { de, vers, duree_min: r.duree_min, ferry: !!r.ferry, estimation: true, source_url: r.source_url, source_titre: r.source_titre || "", explication: r.explication || "", conseil: "C'est une estimation : dis-le à la personne avec sa source, et ne l'utilise dans planifier_course (source_duree « estimation_web ») qu'avec son accord." } };
}

// ---- Clients et dossiers ---------------------------------------------------------------------------------------------------------

export async function chercherClients(e, ctx) {
  const [clients, dossiers] = await Promise.all([ctx.charger("clients"), ctx.charger("dossiers")]);
  const q = sansAccents(e.recherche).trim();
  const chiffres = String(e.recherche || "").replace(/\D/g, "");
  if (q.length < 2) return { resultat: { erreur: "recherche_trop_courte" } };
  const mots = q.split(/\s+/).filter(Boolean);
  const parClient = new Map();
  for (const d of dossiers || []) parClient.set(d.client_id, [...(parClient.get(d.client_id) || []), d]);
  const trouves = (clients || [])
    .filter((c) => {
      const t = sansAccents([c.prenom, c.nom].join(" "));
      const tel = String(c.telephone || "").replace(/\D/g, "");
      const refs = (parClient.get(c.id) || []).map((d) => sansAccents(d.ref)).join(" ");
      return mots.every((m) => t.includes(m) || refs.includes(m)) || (chiffres.length >= 6 && tel.includes(chiffres.slice(-8)));
    })
    .slice(0, 8)
    .map((c) => ({
      client: refDe("C", c.id),
      nom: texte([c.prenom, c.nom].filter(Boolean).join(" "), 80),
      telephone: texte(c.telephone, 30),
      dossiers: (parClient.get(c.id) || [])
        .sort((a, b) => String(b.date_depart || "").localeCompare(String(a.date_depart || "")))
        .slice(0, 5)
        .map((d) => ({ dossier: refDe("D", d.id), reference: texte(d.ref, 30), du: d.date_depart || "", au: d.date_retour || "", annule: !!d.annule })),
    }));
  return { resultat: { nombre: trouves.length, clients: trouves } };
}

export async function lireDossier(e, ctx) {
  const [dossiers, clients, reservations] = await Promise.all([ctx.charger("dossiers"), ctx.charger("clients"), ctx.charger("reservations")]);
  const d = trouverRef(e.dossier, dossiers) || (dossiers || []).find((x) => sansAccents(x.ref) === sansAccents(e.dossier).trim());
  if (!d) return { resultat: { erreur: "dossier_introuvable" } };
  const c = (clients || []).find((x) => x.id === d.client_id);
  const services = (reservations || [])
    .filter((r) => r.dossier_id === d.id)
    .sort((a, b) => String(a.date_service || "").localeCompare(String(b.date_service || "")) || String(a.heure_pickup).localeCompare(String(b.heure_pickup)))
    .slice(0, 30)
    .map((r) => {
      const p = r.personnes || {};
      return { reservation: refDe("R", r.id), libelle: texte(r.libelle, 160), date: r.date_service || "", heure_pickup: texte(r.heure_pickup, 10), lieu_pickup: texte(r.lieu_pickup, 120), adultes: entier(p.adultes), enfants: entier(p.enfants), statut: r.statut, prix_vente: nombre(r.montant_vente) };
    });
  return {
    resultat: { dossier: refDe("D", d.id), reference: texte(d.ref, 30), client: c ? texte([c.prenom, c.nom].filter(Boolean).join(" "), 80) : "", telephone: c ? texte(c.telephone, 30) : "", du: d.date_depart || "", au: d.date_retour || "", annule: !!d.annule, services },
    prix: services.map((s) => s.prix_vente).filter((x) => x !== null),
    heures: services.map((s) => s.heure_pickup).filter(heureValide),
  };
}

// ---- Propositions (cartes) -------------------------------------------------------------------------------------------------------

// Les montants que la personne a tapés dans la conversation : seuls montants admis en plus de ceux des outils.
export function montantsTapes(messagesPersonne = []) {
  const out = new Set();
  // Ni un nombre collé à une lettre ou à un tiret (référence « T2026-0207 »), ni une année seule, ni une durée ou une heure.
  for (const m of messagesPersonne)
    for (const x of String(m || "").matchAll(/(?<![\p{L}\d\-/])(\d{1,3}(?:[ ,']\d{3})+|\d{3,6})(?![\p{L}\d\-/]|\s*(?:km|min|h\b|:))/gu)) {
      const n = Number(x[1].replace(/[ ,']/g, ""));
      if (!/^20[2-3]\d$/.test(x[1])) out.add(n);
    }
  return out;
}

// Un service proposé : le prix vient de la ligne du catalogue (par sa référence) ou d'un montant tapé par la personne ; sinon vide.
async function serviceDepuis(s, ctx, tapes) {
  const [prestations, trajets] = await Promise.all([ctx.charger("prestations"), ctx.charger("trajets")]);
  const ref = texte(s.ref, 12);
  const p = /^P-/i.test(ref) ? trouverRef(ref, prestations) : null;
  const t = /^T-/i.test(ref) ? trouverRef(ref, trajets) : null;
  const adultes = entier(s.adultes);
  const enfants = entier(s.enfants);
  const avert = [];
  if (ref && !p && !t) avert.push("reference_inconnue");
  let prix = null;
  let origine = "a_fixer";
  const saisi = nombre(String(s.prix_saisi || "").replace(/[ ,']/g, ""));
  if (saisi !== null && saisi > 0) {
    if (tapes.has(saisi)) {
      prix = saisi;
      origine = "saisi";
    } else avert.push("prix_non_tape");
  } else if (p && nombre(p.prix_vente) !== null) {
    // Mêmes quantités que l'outil (partenaires-calc.mjs, quantiteParDefaut) : par personne, par adulte, par enfant, sinon une fois.
    const q = p.unite === "pp" ? adultes + enfants : p.unite === "ad" ? adultes : p.unite === "ch" ? enfants : 1;
    prix = Number(p.prix_vente) * (q || 1);
    origine = "catalogue";
  } else if (t && nombre(t.prix_adulte) !== null) {
    prix = Number(t.prix_adulte) * Math.max(1, adultes) + (enfants && nombre(t.prix_enfant) !== null ? Number(t.prix_enfant) * enfants : 0);
    origine = "catalogue";
  }
  const date = dateValide(s.date) ? s.date : "";
  if (s.date && !date) avert.push("date_illisible");
  return {
    texte: texte(s.texte, 160),
    offre: p ? { genre: "prestation", id: p.id } : t ? { genre: "trajet", id: t.id } : null,
    libelle: p ? texte(p.libelle, 160) : t ? `${texte(t.de, 80)} → ${texte(t.vers, 80)}${t.depart ? ` ${texte(t.depart, 5)}` : ""}` : texte(s.texte, 160),
    date,
    heure_pickup: heureValide(s.heure_pickup) ? s.heure_pickup : "",
    lieu_pickup: texte(s.lieu_pickup, 120),
    de: texte(s.de, 120),
    vers: texte(s.vers, 120),
    adultes,
    enfants,
    prix,
    origine_prix: origine,
    remarque: texte(s.remarque, 300),
    avertissements: avert,
  };
}

// Formule de fin signée (même liste que itineraire.js, retirerSignature) : chez Secret et Taxi, la réponse ne signe jamais.
const FIN_SIGNEE = /^(?:(?:belle|bonne|excellente) (?:journée|soirée|fin de journée)|have an? (?:nice|lovely|great|good) (?:day|evening|trip)|best regards|kind regards|cordialement|bien à vous|à bientôt|see you soon)\b/i;
export function retirerSignature(message, { noms = [] } = {}) {
  const lignes = String(message).replace(/\s+$/, "").split("\n");
  const cles = noms.map((n) => cleHotel(n)).filter(Boolean);
  let retire = false;
  while (lignes.length > 1) {
    const l = lignes[lignes.length - 1].trim();
    const c = cleHotel(l);
    const sig = !l || FIN_SIGNEE.test(l) || /^(?:nani|anaïs|anais)\b/i.test(l) || cles.some((n) => c && (c === n || n.includes(c) || c.includes(n)) && c.length <= n.length + 20);
    if (!sig) break;
    if (l) retire = true;
    lignes.pop();
  }
  return { message: lignes.join("\n").trim(), retire };
}

const INTERNE = /\b(marges?|margins?|commissions?|nets?|prix d'achat|net price|cost price)\b/i;
// Montants d'un texte (« 1,200 », « 1 200 THB », « ฿900 ») ; dates, heures et téléphones exclus. Même règle que calc.js (montantsDuTexte).
export function montantsDuTexte(t) {
  const propre = String(t || "")
    .replace(/\+?\d[\d\s]{7,}\d/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b(jan|feb|fev|fév|mar|apr|avr|may|mai|jun|juin|jul|juil|aug|aou|aoû|sep|oct|nov|dec|déc)[\p{L}.]*\s+20[2-3]\d\b/giu, " ")
    .replace(/\b\d{1,2}[/.]\d{1,2}[/.]20[2-3]\d\b/g, " ")
    .replace(/\b\d{1,2}[:h.]\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, " ");
  const out = [];
  for (const m of propre.matchAll(/(?:฿|THB|CHF|EUR|€)?\s*(\d{1,3}(?:[ ,']\d{3})+|\d{3,})(?:\s*(?:฿|THB|CHF|EUR|€|baht))?/gi)) out.push(Number(m[1].replace(/[ ,']/g, "")));
  return out;
}

// Contrôle de la réponse au client : signature retirée chez Secret et Taxi, tout montant ou heure absent des faits signalé, mot interne ou nom
// de prestataire signalé. La carte montre ces avertissements ; la personne décide.
export function controlerReponse(message, { signer = false, permisPrix = new Set(), permisHeures = new Set(), prestataires = [], entreprise = "", prenoms = [] }) {
  let m = texte(message, 4000) ? String(message).trim().slice(0, 4000) : "";
  const avert = [];
  if (!m) return { ok: false };
  if (!signer) {
    const s = retirerSignature(m, { noms: [entreprise] });
    if (s.retire) avert.push("signature_retiree");
    m = s.message;
  }
  const inconnus = [...new Set(montantsDuTexte(m))].filter((n) => !permisPrix.has(n));
  if (inconnus.length) avert.push(`montant_non_source:${inconnus.join(",")}`);
  const heures = [...new Set([...m.matchAll(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g)].map((x) => `${x[1].padStart(2, "0")}:${x[2]}`))].filter((h) => !permisHeures.has(h));
  if (heures.length) avert.push(`heure_non_source:${heures.join(",")}`);
  const interne = INTERNE.exec(m);
  if (interne) avert.push(`mot_interne:${interne[0]}`);
  const cite = prestataires.find((n) => n.length > 2 && sansAccents(m).includes(sansAccents(n)));
  if (cite) avert.push("nom_prestataire");
  // Chez Secret et Taxi, la réponse ne nomme personne de l'équipe (la responsable y écrit sous un autre prénom que dans l'outil).
  if (!signer && prenoms.some((p) => p.length > 1 && new RegExp(`\\b${sansAccents(p)}\\b`).test(sansAccents(m)))) avert.push("prenom_equipe");
  return { ok: true, message: m, avertissements: avert };
}

// Construit la carte d'une proposition. `memo` : ce que la conversation a déjà établi (prix et heures rendus par les outils, montants tapés).
export async function proposer(nom, e, ctx, memo) {
  const tapes = memo.tapes || new Set();
  if (nom === "proposer_dossier") {
    const services = [];
    for (const s of (e.services || []).slice(0, 10)) services.push(await serviceDepuis(s, ctx, tapes));
    if (!services.length) return { erreur: "aucun_service" };
    return { genre: "dossier", titre: texte(e.titre, 120), donnees: { client: { nom: texte(e.client_nom, 80), telephone: texte(e.client_telephone, 30), hotel: texte(e.hotel, 120), langue: e.langue || "" }, adultes: entier(e.adultes), enfants: entier(e.enfants), bebes: entier(e.bebes, 10), services } };
  }
  if (nom === "proposer_reservation") {
    const d = trouverRef(e.dossier, await ctx.charger("dossiers"));
    if (!d) return { erreur: "dossier_introuvable" };
    return { genre: "reservation", titre: texte(e.titre, 120), donnees: { dossier_id: d.id, dossier_ref: texte(d.ref, 30), service: await serviceDepuis(e.service, ctx, tapes) } };
  }
  if (nom === "proposer_modification") {
    const r = trouverRef(e.reservation, await ctx.charger("reservations"));
    if (!r) return { erreur: "reservation_introuvable" };
    const v = texte(e.valeur, 300);
    const ok = { date: dateValide(v), heure_pickup: heureValide(v), lieu_pickup: !!v, adultes: /^\d{1,2}$/.test(v), enfants: /^\d{1,2}$/.test(v), remarque: !!v }[e.champ];
    if (!ok) return { erreur: "valeur_invalide" };
    const avant = { date: r.date_service || "", heure_pickup: r.heure_pickup || "", lieu_pickup: r.lieu_pickup || "", adultes: String((r.personnes || {}).adultes ?? ""), enfants: String((r.personnes || {}).enfants ?? ""), remarque: "" }[e.champ];
    return { genre: "modification", titre: texte(e.titre, 120), donnees: { reservation_id: r.id, dossier_id: r.dossier_id, libelle: texte(r.libelle, 160), champ: e.champ, avant, valeur: v, raison: texte(e.raison, 240) } };
  }
  if (nom === "proposer_temps_trajet") {
    const d = entier(e.duree_min, 1440);
    if (!d || !(memo.durees || new Set()).has(d)) return { erreur: "duree_sans_source" };
    if (!texte(e.de, 120) || !texte(e.vers, 120)) return { erreur: "lieu_manquant" };
    return { genre: "temps", titre: texte(e.titre, 120), donnees: { de: texte(e.de, 120), vers: texte(e.vers, 120), duree_min: d, ferry: !!e.ferry, marge_min: entier(e.marge_min, 240), source: texte(e.source, 200) } };
  }
  if (nom === "proposer_reponse") {
    const c = controlerReponse(e.message, { signer: memo.signer, permisPrix: new Set([...(memo.prix || []), ...tapes]), permisHeures: memo.heures || new Set(), prestataires: memo.prestataires || [], entreprise: memo.entreprise || "", prenoms: memo.prenoms || [] });
    if (!c.ok) return { erreur: "message_vide" };
    return { genre: "reponse", titre: texte(e.titre, 120), donnees: { langue: e.langue, message: c.message }, avertissements: c.avertissements };
  }
  return { erreur: "outil_inconnu" };
}

// ---- Exécution -------------------------------------------------------------------------------------------------------------------

// Exécute un appel d'outil. Rend { contenu (ce qui repart chez Claude, en JSON), carte? (proposition à afficher), memo mis à jour }.
// Une erreur d'outil n'arrête pas la conversation : elle repart chez Claude marquée comme telle.
export async function executer(nom, entree, ctx, memo) {
  if (!NOMS_OUTILS.includes(nom)) return { contenu: { erreur: "outil_inconnu" }, erreur: true };
  if (!entreeValide(nom, entree)) return { contenu: { erreur: "entree_invalide", conseil: "Reprends l'appel avec tous les champs, au bon format." }, erreur: true };
  const ajouter = (r) => {
    for (const p of r.prix || []) memo.prix.add(Number(p));
    for (const h of r.heures || []) memo.heures.add(h);
  };
  try {
    if (OUTILS_PROPOSITION.includes(nom)) {
      const carte = await proposer(nom, entree, ctx, memo);
      if (carte.erreur) return { contenu: { erreur: carte.erreur }, erreur: true };
      // Ce qui repart chez Claude : la carte est affichée, rien n'est fait. Les prix retenus, pour qu'il ne les répète pas faux.
      const prix = carte.genre === "dossier" ? carte.donnees.services.map((s) => ({ service: s.texte, prix: s.prix, origine: s.origine_prix })) : carte.genre === "reservation" ? [{ service: carte.donnees.service.texte, prix: carte.donnees.service.prix, origine: carte.donnees.service.origine_prix }] : undefined;
      return { contenu: { carte_affichee: true, etat: "en attente de validation par la personne", ...(prix ? { prix } : {}), ...(carte.avertissements && carte.avertissements.length ? { avertissements: carte.avertissements } : {}) }, carte };
    }
    const f = { chercher_catalogue: chercherCatalogue, horaires_trajet: horairesTrajet, situer_hotels: situerHotels, temps_de_route: tempsDeRoute, estimer_temps_web: estimerTempsWeb, planifier_course: planifier, chercher_clients: chercherClients, lire_dossier: lireDossier }[nom];
    const r = await f(entree, ctx, memo);
    ajouter(r);
    return { contenu: r.resultat, ...(r.planning ? { planning: r.planning } : {}), erreur: !!(r.resultat && r.resultat.erreur) };
  } catch (err) {
    return { contenu: { erreur: "outil_en_panne" }, erreur: true, panne: err instanceof Error ? err.message.slice(0, 200) : "" };
  }
}

// Ce que la conversation sait déjà : les prix et heures rendus par les outils des échanges précédents (relus depuis les messages enregistrés)
// et les montants tapés par la personne. Sert à contrôler la réponse au client.
export function memoDepuis(messages = [], { signer = false, prestataires = [], entreprise = "", prenoms = [] } = {}) {
  const memo = { prix: new Set(), heures: new Set(), tapes: new Set(), durees: new Set(), estimations: new Map(), signer, prestataires, entreprise, prenoms };
  const parcourir = (v) => {
    if (Array.isArray(v)) return v.forEach(parcourir);
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (["prix_vente", "prix_adulte", "prix_enfant", "prix"].includes(k) && typeof x === "number") memo.prix.add(x);
      else if (typeof x === "string" && heureValide(x)) memo.heures.add(x);
      else if (x && typeof x === "object") parcourir(x);
    }
  };
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") memo.tapes = new Set([...memo.tapes, ...montantsTapes([m.content])]);
    if (m.role === "user" && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === "text") memo.tapes = new Set([...memo.tapes, ...montantsTapes([b.text])]);
        if (b.type === "tool_result") {
          for (const c of Array.isArray(b.content) ? b.content : [{ type: "text", text: String(b.content || "") }]) {
            if (c.type !== "text") continue;
            try {
              parcourir(JSON.parse(c.text));
            } catch {
              /* résultat non JSON : rien à retenir */
            }
          }
        }
      }
    }
  }
  // Les heures tapées par la personne sont admises aussi (« vol à 19:30 »), et ses durées (« compte 2h30 »).
  for (const m of messages) {
    const t = m.role === "user" ? (typeof m.content === "string" ? m.content : (m.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ")) : "";
    for (const x of t.matchAll(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g)) memo.heures.add(`${x[1].padStart(2, "0")}:${x[2]}`);
    for (const d of dureesTapees([t])) memo.durees.add(d);
  }
  // Les estimations web déjà rendues dans la conversation restent utilisables (résultats d'estimer_temps_web).
  const outils = new Map();
  for (const m of messages) for (const b of Array.isArray(m.content) ? m.content : []) {
    if (m.role === "assistant" && b.type === "tool_use") outils.set(b.id, b.name);
    if (m.role === "user" && b.type === "tool_result" && outils.get(b.tool_use_id) === "estimer_temps_web" && !b.is_error) {
      try {
        const r = JSON.parse(typeof b.content === "string" ? b.content : "");
        if (r && r.estimation && r.duree_min > 0) memo.estimations.set(clePaire(r.de, r.vers), { duree_min: r.duree_min, ferry: !!r.ferry, source_url: r.source_url });
      } catch {
        /* résultat illisible */
      }
    }
  }
  return memo;
}

export { tempsSimule };
