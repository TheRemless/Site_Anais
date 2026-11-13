// Champs du voucher qu'une réservation garde dans `details` (chambre, drop-off, vol, bagages, type de tour, remarques…).
// Les mêmes saisies servent à la fiche d'une réservation (reservations.mjs) et à la création du dossier, service par service
// (nouveau-excursions.mjs, demande.mjs) : un seul endroit pour leurs libellés, exemples et aides.
import { h, champ, saisie } from "../ui.mjs";
import { ajouterJours } from "../calc.mjs";
import { nbJoursLocation, TITRES_VOUCHER } from "../operations-calc.mjs";
import { champsCreation, resumeSaisie } from "../creation-voucher-calc.mjs";
import { tr, pluriel, N_ } from "../i18n.mjs";

// `details` : les valeurs de départ (celles de la réservation, ou ce que la demande collée a déjà lu).
// `prefixe` : début des identifiants des champs (« v » dans la fiche, un par service à la création).
// `dateService` : () => date de départ, pour compter les jours d'une location ; `dateInitiale` donne la date de retour proposée.
// Rend { CHAMPS: { clé: () => champ }, valeurs(), majJours() }. `valeurs()` donne tous les champs, vides compris (une valeur effacée s'efface).
export function champsVoucher({ details: dt = {}, prefixe = "v", dateService = () => "", dateInitiale = "" } = {}) {
  const id = (suffixe) => `${prefixe}-${suffixe}`;
  const texte = (suffixe, valeur, placeholder) => h("input", { id: id(suffixe), value: valeur || "", ...(placeholder ? { placeholder } : {}) });
  const zone = (suffixe, valeur, placeholder) => {
    const t = h("textarea", { id: id(suffixe), rows: 2, ...(placeholder ? { placeholder } : {}) });
    t.value = valeur || "";
    return t;
  };
  const choix = (suffixe, valeur, options) => {
    const s = h("select", { id: id(suffixe) }, options.map(([v, l]) => h("option", { value: v }, l)));
    s.value = valeur || "";
    return s;
  };
  const chambre = texte("chambre", dt.chambre);
  const dropOff = texte("drop", dt.drop_off, tr("Hôtel, embarcadère, aéroport"));
  const vol = texte("vol", dt.vol, tr("FD 3217"));
  const bagages = texte("bagages", dt.bagages, tr("2 valises, 1 sac"));
  const sieges = saisie(h("input", { id: id("sieges"), value: Number(dt.sieges) > 0 ? String(dt.sieges) : "" }), "entier");
  const auto = ["", tr("Automatique d'après la prestation")];
  const typeTour = choix("tour", dt.type_tour, [auto, ["join", tr("Join tour")], ["prive", tr("Private tour")]]);
  const typeTransfert = choix("transfert", dt.type_transfert, [auto, ["taxi", tr("Private taxi")], ["minivan", tr("Private minivan")], ["partage", tr("Shared minivan")]]);
  const parc = choix("parc", dt.parc, [auto, ["inclus", tr("Included")], ["non", tr("Not included")], ["aucun", tr("Ne rien afficher")]]);
  const parcTexte = texte("parc-texte", dt.parc_texte, tr("400 THB per adult, 200 THB per child, cash on the island"));
  const remarques = zone("remarques", dt.remarques, tr("Vu par le client et le prestataire, en anglais"));
  const remarquesPaiement = texte("rem-paiement", dt.remarques_paiement, tr("Deposit 1,000 THB received, balance at the pier"));
  const heureService = texte("heure-service", dt.heure_service, "10:00 - 12:00");
  // Sans date de retour saisie, celle que dit la facture : la date de départ plus les jours loués.
  const retourDate = h("input", { id: id("retour-date"), type: "date", value: dt.retour_date || (dateInitiale && Number(dt.jours) > 0 ? ajouterJours(dateInitiale, Number(dt.jours)) : "") });
  const retourHeure = h("input", { id: id("retour-heure"), type: "time", value: dt.retour_heure || "" });
  const retourLieu = texte("retour-lieu", dt.retour_lieu, tr("Hôtel, aéroport, agence"));
  const equipement = texte("equipement", dt.equipement, tr("2 casques, siège enfant"));
  const conditions = zone("conditions", dt.conditions, tr("Assurance, carburant, conditions du loueur, en anglais"));
  const permis = texte("permis", dt.permis, tr("International driving licence shown"));
  const caution = texte("caution", dt.caution, tr("3,000 THB, returned at drop-off"));
  const embarquement = texte("embarquement", dt.embarquement, tr("Saladan Pier"));
  const checkin = zone("checkin", dt.checkin, tr("Check-in at the pier 45 minutes before departure…"));
  const bateau = texte("bateau", dt.bateau, tr("Longtail, speedboat"));
  const programme = texte("programme", dt.programme, tr("Program A, 10 min session"));

  // Nombre de jours de location, calculé d'après la date de départ et celle de retour.
  const joursLocation = h("p", { class: "aide", "aria-live": "polite" });
  const majJours = () => {
    const n = nbJoursLocation(dateService(), retourDate.value);
    joursLocation.textContent = n ? pluriel(n, N_("jour de location"), N_("jours de location")) : tr("Les jours se calculent d'après les deux dates.");
  };
  retourDate.addEventListener("change", majJours);
  majJours();

  const CHAMPS = {
    chambre: () => champ(tr("Chambre"), chambre, tr("Sinon celle de l'adresse du client.")),
    drop_off: () => champ(tr("Drop-off"), dropOff),
    vol: () => champ(tr("Numéro de vol"), vol),
    bagages: () => champ(tr("Bagages"), bagages),
    sieges: () => champ(tr("Sièges enfant ou bébé"), sieges, tr("Nombre de sièges. Vide si aucun.")),
    type_tour: () => champ(tr("Type de tour"), typeTour),
    type_transfert: () => champ(tr("Type de transfert"), typeTransfert),
    parc: () => champ(tr("Frais de parc"), parc),
    parc_texte: () => champ(tr("Texte des frais de parc"), parcTexte),
    heure_service: () => champ(tr("Horaire de l'activité"), heureService, tr("Imprimé après la date.")),
    retour_date: () => {
      const c = champ(tr("Date de retour"), retourDate);
      c.append(joursLocation);
      return c;
    },
    retour_heure: () => champ(tr("Heure de retour"), retourHeure),
    retour_lieu: () => champ(tr("Lieu de retour"), retourLieu, tr("Sinon le lieu de départ.")),
    equipement: () => champ(tr("Équipement fourni"), equipement),
    conditions: () => champ(tr("Conditions du loueur"), conditions, tr("Imprimées sous le voucher, seulement si renseignées.")),
    permis: () => champ(tr("Permis de conduire"), permis),
    caution: () => champ(tr("Caution"), caution),
    embarquement: () => champ(tr("Embarcadère ou point de check-in"), embarquement, tr("Sinon celui de la compagnie pour le lieu de départ.")),
    checkin: () => champ(tr("Consigne de check-in"), checkin, tr("Sinon celle de la compagnie, en anglais.")),
    bateau: () => champ(tr("Bateau"), bateau, tr("Sinon celui de la prestation.")),
    programme: () => champ(tr("Programme ou option"), programme, tr("Sinon le groupe de la prestation.")),
    remarques: () => champ(tr("Remarques sur le voucher"), remarques),
    remarques_paiement: () => champ(tr("Remarque de paiement"), remarquesPaiement),
  };

  // Les sièges sont un nombre ; ils ne s'ajoutent qu'à une réservation qui en a, ou quand on en saisit (pas de « 0 » partout).
  const nbSieges = () => Math.max(0, Math.floor(Number(String(sieges.value).trim()) || 0));
  const valeurs = () => ({
    chambre: chambre.value.trim(), drop_off: dropOff.value.trim(), vol: vol.value.trim(), bagages: bagages.value.trim(), type_tour: typeTour.value, type_transfert: typeTransfert.value, parc: parc.value, parc_texte: parcTexte.value.trim(), remarques: remarques.value.trim(), remarques_paiement: remarquesPaiement.value.trim(), heure_service: heureService.value.trim(), retour_date: retourDate.value || "", retour_heure: retourHeure.value, retour_lieu: retourLieu.value.trim(), equipement: equipement.value.trim(), conditions: conditions.value.trim(), permis: permis.value.trim(), caution: caution.value.trim(), embarquement: embarquement.value.trim(), checkin: checkin.value.trim(), bateau: bateau.value.trim(), programme: programme.value.trim(),
    ...(nbSieges() > 0 || "sieges" in dt ? { sieges: nbSieges() } : {}),
  });
  return { CHAMPS, valeurs, majJours };
}

// Ordre d'affichage d'un modèle de voucher : les champs courts dans la grille, puis les textes longs (check-in, remarques) en pleine largeur.
// `sauf` : les champs déjà posés ailleurs (la date de retour d'une location se lit à côté de la date de départ).
const LONGS = ["checkin", "remarques", "remarques_paiement"];
export const champsCourts = (cles, sauf = []) => cles.filter((c) => !LONGS.includes(c) && !sauf.includes(c));
export const champsLongs = (cles) => cles.filter((c) => LONGS.includes(c));

// ---- Création d'un dossier : le bloc d'un service ---------------------------------------------------------------------------------------
// Les champs du service (champsCreation), remplis d'après `saisie` ; chaque frappe tient `saisie` à jour, ce qui survit au redessin de l'écran.
// `sauf` : les champs que l'écran pose déjà lui-même (la fenêtre « Coller une demande » a l'heure et les personnes de chaque service).
// `aideLieu` : ce qui sert de lieu de pickup quand il reste vide. `ouvert` : déplié au départ (un repli ou dépli à la main est gardé dans `saisie`).
// `surSaisie(saisie)` : appelée après chaque frappe (le libellé d'une course hors catalogue suit son pickup et son drop-off).
export function blocServiceCreation({ service, saisie: s, taxi = false, prefixe, sauf = [], aideLieu = "", ouvert = true, surSaisie = null }) {
  const cles = champsCreation(service, { taxi }).filter((c) => !sauf.includes(c));
  if (!cles.length) return null;
  const location = service.type === "location";
  const cv = champsVoucher({ details: { ...s.details, ...(s.sieges ? { sieges: s.sieges } : {}) }, prefixe, dateService: () => service.date || "" });
  const heure = h("input", { id: `${prefixe}-heure`, type: "time", value: s.heure || "" });
  const lieu = h("input", { id: `${prefixe}-lieu`, value: s.lieu || "", autocomplete: "off", placeholder: tr("Hôtel, embarcadère, aéroport") });
  const nombre = (suffixe, v) => saisie(h("input", { id: `${prefixe}-${suffixe}`, value: v ? String(v) : "" }), "entier");
  const p = s.personnes || {};
  const bebes = nombre("bebes", s.bebes);
  const adultes = nombre("adultes", p.adultes);
  const enfants = nombre("enfants", p.enfants);
  const propres = {
    heure: () => champ(location ? tr("Heure de départ") : tr("Heure de pickup"), heure),
    lieu: () => champ(location ? tr("Lieu de départ ou de livraison") : tr("Lieu de pickup"), lieu, aideLieu || null),
    bebes: () => champ(tr("Bébés"), bebes),
    adultes: () => champ(tr("Adultes"), adultes),
    enfants: () => champ(tr("Enfants"), enfants),
  };
  const noeud = (c) => (propres[c] || cv.CHAMPS[c])();
  const entier = (x) => Math.max(0, Math.floor(Number(String(x.value).trim()) || 0));
  const lire = () => {
    if (cles.includes("heure")) s.heure = heure.value;
    if (cles.includes("lieu")) s.lieu = lieu.value;
    if (cles.includes("bebes")) s.bebes = entier(bebes);
    if (cles.includes("adultes")) s.personnes = { ...(s.personnes || {}), adultes: entier(adultes), enfants: entier(enfants) };
    const { sieges, ...details } = cv.valeurs();
    // Seuls les champs montrés s'écrivent : ce qu'une demande a lu pour un autre modèle de voucher reste tel quel.
    const montres = new Set(cles);
    s.details = { ...Object.fromEntries(Object.entries(s.details || {}).filter(([k]) => !montres.has(k))), ...Object.fromEntries(Object.entries(details).filter(([k]) => montres.has(k))) };
    if (cles.includes("sieges")) s.sieges = sieges || 0;
    resume.textContent = resumeSaisie(s);
    if (surSaisie) surSaisie(s);
  };
  const titre = taxi ? "Booking confirmation" : TITRES_VOUCHER[service.type] || tr("Réservation");
  // Replié, le bloc dit ce qui est déjà rempli : « 08:30 · Lanta Sand Resort ».
  const resume = h("span", { class: "creation-voucher-resume" }, resumeSaisie(s));
  const bloc = h(
    "details",
    { class: "creation-voucher", ...((s.ouvert ?? ouvert) ? { open: true } : {}), oninput: lire, onchange: lire },
    h("summary", null, titre, resume),
    h("p", { class: "aide" }, taxi ? tr("Ce qui s'imprime sur la Booking confirmation. Modifiable ensuite dans la réservation.") : tr("Ce qui s'imprime sur le voucher. Modifiable ensuite dans la réservation.")),
    h("div", { class: "grille-form compacte" }, champsCourts(cles).map(noeud)),
    champsLongs(cles).map(noeud)
  );
  // Seul le geste de la personne compte (l'événement « toggle » part aussi quand le bloc naît déplié).
  bloc.querySelector("summary").addEventListener("click", () => (s.ouvert = !bloc.open));
  return bloc;
}
