// « Coller une demande » : le client écrit à Anaïs sur WhatsApp, le message arrive à sa façon ou depuis le formulaire du site. On le colle ici :
// l'outil reconnaît la date, les personnes, l'hôtel, le client et le service cité, cherche le prix dans la base partenaires, et crée le dossier
// d'un tap. Tout ce qui a été reconnu se corrige sur place, et le prix suit.
import { etat, exemple, entiteActive, reglages, modeExcursions, modeTaxi, nomPartenaire, partenaireDe, netPrestation, netTrajet, peut, naviguer, nomClient, entitesAccessibles, changerEntite, confirmationPermise, clientParId, clientsProposes } from "../etat.mjs";
import { demandeDeTaxi, entrepriseTaxi } from "../taxi-calc.mjs";
import { h, modal, toast, champ } from "../ui.mjs";
import { aujourdhui, formatMontant } from "../calc.mjs";
import { lireMessage, offresDuService, decouperServices, varsReponse, langueReponse, notesDemande, separerNom, clientsProches } from "../demande-calc.mjs";
import { lignesDepuisTrajet, ligneDepuisPrestation, chiffres, quantiteParDefaut } from "../partenaires-calc.mjs";
import { appliquerModeParDefaut, adresseEstHotel } from "../operations-calc.mjs";
import { ouvrirMessage } from "./messages.mjs";
import { choisirPrestation } from "./choix-prestation.mjs";
import { blocZonesPickup } from "./pickup-zones.mjs";
import { heureAPoser } from "../pickup-calc.mjs";
import { creerDossierExcursions, langueDocuments, refProposee, refExiste, refDefinitive } from "./creation-excursions.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { servicesCreation, saisieVide, nonVides, boutsDuTrajet, trajetIncomplet, ligneRetourDepart, ligneTransfertPrive } from "../creation-voucher-calc.mjs";
import { blocServiceCreation, ERREURS_TRAJET } from "./champs-voucher.mjs";
import { boutonLireIA, badgeConfiance } from "./assistant-demande.mjs";
import { offresRecalculees } from "../assistant-calc.mjs";
import { RETOUR_DEPART, dureeFrancais } from "../trajet-calc.mjs";
import { partenaireDeTaxi, chauffeurRegle } from "../voucher-rapide-calc.mjs";
import { imposerTotal } from "../demandes-site-calc.mjs";
import { ressembleAConfirmation } from "../confirmation-calc.mjs";

// Brouillon passé à l'écran « Nouveau dossier » : lu une seule fois.
let brouillon = null;
// Il reste en mémoire tant que le dossier n'est pas créé : l'écran peut se redessiner (synchronisation) sans perdre la demande.
export const lireBrouillon = () => brouillon;
export const viderBrouillon = () => {
  brouillon = null;
};

const AVERTISSEMENTS = {
  sans_tarif_enfant: N_("Pas de tarif enfant pour ce trajet : le prix ne compte que les adultes."),
  prix_a_definir: N_("Prix à définir dans la base."),
  sur_place: N_("À payer sur place."),
  enfant_plein_tarif: N_("Pas de tarif enfant : les enfants sont comptés au tarif adulte."),
  enfant_non_compte: N_("Tarif par adulte sans prix enfant : les enfants ne sont pas comptés."),
  supplement_a_definir: N_("Prix de la personne supplémentaire à définir dans la base : le prix ne compte que la base."),
  groupe_hors_tranche: N_("Le groupe ne tient dans aucune tranche de ce tarif : prix à vérifier avec le prestataire."),
};

// Le message collé est gardé sur l'appareil jusqu'à la création du dossier : un appel ou un changement d'écran ne le perd pas.
const CLE_BROUILLON = "gestion-brouillon-demande";
// Au-delà de douze heures il est abandonné : « demain » ne doit pas être relu à une autre date.
const DUREE_BROUILLON = 12 * 3600 * 1000;
const garde = {
  lire: () => {
    try {
      const b = JSON.parse(localStorage.getItem(CLE_BROUILLON) || "null");
      return b && typeof b.texte === "string" && Date.now() - b.le < DUREE_BROUILLON ? b.texte : "";
    } catch {
      return "";
    }
  },
  ecrire: (texte) => {
    try {
      if (texte) localStorage.setItem(CLE_BROUILLON, JSON.stringify({ texte, le: Date.now() }));
      else localStorage.removeItem(CLE_BROUILLON);
    } catch {
      /* stockage refusé : la saisie reste dans la page */
    }
  },
};

// Quantité d'une prestation selon son unité (les bébés ne comptent pas).
const quantite = (p, d) => quantiteParDefaut(p.unite, d);

// Chaque service prend le mode de règlement habituel de son partenaire (chez nous ou sur place).
function lignesDe(offre, d, langue, devise) {
  return appliquerModeParDefaut(lignesBrutes(offre, d, langue, devise), partenaireDe);
}

function lignesBrutes(offre, d, langue, devise) {
  if (offre.genre === "trajet") return lignesDepuisTrajet(offre.source, netTrajet(offre.source), { langue, date: d.date, adultes: d.adultes || (d.enfants ? 0 : 1), enfants: d.enfants, compagnie: "" });
  const adulte = ligneDepuisPrestation(offre.source, netPrestation(offre.source), { langue, date: d.date, qte: offre.enfant ? d.adultes || 1 : quantite(offre.source, d), devise });
  // Prix de base pour 1 ou 2 personnes, puis une ligne de supplément par personne en plus (aucune ligne à une ou deux personnes).
  const supplement = offre.supplement ? [ligneDepuisPrestation(offre.supplement.source, netPrestation(offre.supplement.source), { langue, date: d.date, qte: offre.supplement.qte, devise })] : [];
  if (!offre.enfant) return [adulte, ...supplement];
  // Une ligne par adulte et une ligne enfant au même nom : elles donnent une seule réservation, comme pour un trajet.
  const en = langue === "en";
  const e = ligneDepuisPrestation(offre.enfant, netPrestation(offre.enfant), { langue, date: d.date, qte: d.enfants, devise });
  return [adulte, { ...e, libelle: `${adulte.libelle}, ${en ? "child" : "enfant"}`, intro: `(${en ? "per child" : "par enfant"})` }, ...supplement];
}

// L'hôtel du client connu : la première ligne de son adresse (« Hotel Sunset, Room 12 » → « Hotel Sunset »).
// L'hôtel noté sur la fiche. Une fiche partagée par une autre entreprise (ZTP) porte une adresse postale : pas d'hôtel.
const hotelDuClient = (c) => (c && !adresseEstHotel(c, etat.entiteId) ? "" : ((c && c.adresse) || "").split("\n")[0].replace(/,?\s*Room\s+\S+\s*$/i, "").trim());

// Ce que le formulaire du site a dit en plus du prix à calculer : option, lieux, vol, âges, prix annoncé. Lu, jamais deviné.
function lignesSite(d) {
  if (!d.site) return [];
  return [
    d.option ? tr("Option demandée : {option}", { option: d.option }) : "",
    d.pickup && d.type === "transfer" ? tr("Prise en charge : {lieu}", { lieu: d.pickup }) : "",
    d.dropoff ? tr("Dépose : {lieu}", { lieu: d.dropoff }) : "",
    // Retour au point de départ (formulaire taxi du site) : le programme et la durée tels que le client les a écrits.
    d.retourDepart ? tr("Retour au point de départ : {programme}", { programme: d.retourDepart.programme || tr("programme à demander") }) : "",
    d.retourDepart && d.dureeTexte ? tr("Durée indiquée : {duree}", { duree: d.dureeTexte }) : "",
    d.vol ? tr("Vol ou bateau : {vol}", { vol: d.vol }) : "",
    d.ages && d.ages.length ? tr("Âges des enfants : {ages}", { ages: d.ages.map((a) => (a === 0 ? tr("moins de 1 an") : a)).join(", ") }) : "",
    d.prixSite ? tr("Prix indiqué sur le site : {prix}", { prix: d.prixSite }) : "",
    d.sorties && d.sorties.length ? tr("Liste de {n} sorties : seule la première est préparée, les autres sont dans les notes du dossier.", { n: d.sorties.length + 1 }) : "",
    d.type === "location" ? tr("Location : vérifiez la durée et le nombre de véhicules sur la facture.") : "",
  ].filter(Boolean);
}

// `depuisSite` (boîte « Demandes du site ») : { texte, titre, telephone, prixImpose, surCree }. Le message vient de la demande, pas du presse-papiers ni du brouillon
// de l'appareil ; « Vérifier avant de créer », la réponse et le passage à une autre entreprise sont retirés (la demande appartient à son entreprise,
// la réponse au client se prépare après la création) ; une fois le dossier créé, `surCree({ dossier, services, total })` prend la suite.
export function ouvrirDemande(depuisSite = null) {
  // Branchée directement sur un bouton (`onclick: ouvrirDemande`), la fonction reçoit l'événement du clic : ce n'est pas une demande du site.
  if (!depuisSite || typeof depuisSite.texte !== "string") depuisSite = null;
  const regl = reglages();
  const devise = regl.devise || "THB";
  const langue = langueDocuments(regl);
  // `taxi` : chez VIP Taxi Lanta, toute demande est une course en voiture (un « wait for us » suffit à lire un retour au point de départ).
  const contexte = () => ({ prestations: etat.db.prestations, trajets: etat.db.trajets, partenaires: etat.db.partenaires, nomPartenaire, taxi: modeTaxi() });
  let d = null;
  let texte = "";
  let clientId = ""; // client existant retenu ; vide pour un nouveau client
  let refuse = new Set(); // clients proposés que la personne a écartés
  let creation = false;
  const prixImpose = depuisSite && depuisSite.prixImpose !== null && depuisSite.prixImpose !== undefined && depuisSite.prixImpose !== "" ? Number(depuisSite.prixImpose) : null;
  let services = []; // un par service cité dans le message : { id, coche, phrase, date, heure, adultes, enfants, offreId, lignesCustom, copie, noeuds }
  let compteur = 0;

  const zone = h("textarea", { id: "demande-texte", rows: 4, placeholder: `Hi ${(entiteActive() || {}).nom || "there"}!\nI'd like a price for a transfer.\nName: …`, oninput: () => lire(zone.value) });
  const reconnu = h("div", { class: "demande-reconnu", "aria-live": "polite" });
  // Les champs corrigeables sont posés une fois par message : les redessiner à chaque correction ferait perdre le doigt au champ suivant.
  const champs = h("div", { class: "demande-champs" });
  const clientBloc = h("div", { class: "demande-client-bloc" });
  const listeBloc = h("ul", { class: "services-liste", "aria-label": tr("Services trouvés") });
  const totalBloc = h("p", { class: "services-total", "aria-live": "polite" });
  const dynamique = h("div", { class: "demande-dynamique" });
  const saisies = {};
  const erreur = h("p", { class: "erreur-form", role: "alert" });

  const clefOffre = (o) => `${o.genre}:${o.id}`;
  const entier = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const clientsConnus = () => (d ? clientsProches(d, clientsProposes()).filter((x) => !refuse.has(x.client.id)) : []);

  // ---- Les services --------------------------------------------------------------------------------------------------------------
  // Un service lu par l'assistant garde les lignes de la base qu'il a choisies, recalculées pour ses personnes.
  // Retour au point de départ : aucune grille, le prix se saisit à la main sur le service (décision de Jérémy, 16.11.2026).
  const offresDe = (sv) => (sv.lignesCustom || sv.retourDepart || sv.transfertLibre ? [] : sv.offresIA ? offresRecalculees(sv.offresIA, sv, contexte()) : offresDuService(d, texte, sv, contexte()));
  const choisie = (sv, offres) => offres.find((o) => clefOffre(o) === sv.offreId) || offres[0] || null;
  const sommeCustom = (sv) => sv.lignesCustom.filter((l) => l.kind !== "texte").reduce((t, l) => t + (Number(l.unite) || 0) * (Number(l.qte) || 0), 0);
  // Ce que le service donne : son offre choisie, ou les lignes prises à la main dans la base.
  function etatDe(sv) {
    if (sv.lignesCustom) return { offre: { genre: "prestation", id: sv.id, titre: sv.lignesCustom.filter((l) => l.kind !== "texte").map((l) => l.libelle).join(" + ") || tr("Service choisi"), total: sommeCustom(sv), source: { libelle: sv.lignesCustom.map((l) => l.libelle).join(" + ") } }, offres: [] };
    const offres = offresDe(sv);
    return { offre: choisie(sv, offres), offres };
  }
  // Lignes prises à la main : la date corrigée sur la ligne du service passe aux lignes (elle date la réservation), sauf si le service n'a pas de date.
  const lignesDuService = (sv, offre) => (sv.lignesCustom ? sv.lignesCustom.map((l) => ({ ...l, titre: l.kind === "texte" ? undefined : l.libelle, ...(l.kind !== "texte" && sv.date ? { date_service: sv.date } : {}) })) : offre ? lignesDe(offre, { date: sv.date, adultes: sv.adultes, enfants: sv.enfants }, langue, devise) : []);
  // Le partenaire du service : celui de l'offre, ou de la première ligne prise dans la base. Sa grille de pickup donne les zones.
  const partenaireDeOffre = (sv, offre) => (sv.lignesCustom ? (sv.lignesCustom.find((l) => l.partenaire_id) || {}).partenaire_id : offre && offre.source && offre.source.partenaire_id) || "";
  const partenaireDuService = (sv) => partenaireDeOffre(sv, sv.lignesCustom ? null : etatDe(sv).offre);
  const estTransfert = (offre) => d.type === "transfer" || (offre && (offre.genre === "trajet" || (offre.source && offre.source.famille === "transfert")));

  // Réservation de ce service : heure, lieu de prise en charge, dépose, vol, bagages. Un trajet du site donne ses deux bouts.
  function reservationDe(sv, offre) {
    const c = clientId ? clientParId(clientId) : null;
    const siteTransfert = d.type === "transfer";
    const lieu = siteTransfert ? d.pickup || "" : offre && !estTransfert(offre) && d.hotel && d.hotel !== hotelDuClient(c) ? d.hotel : "";
    // Une zone de pickup choisie veut dire un pickup à l'hôtel : le lieu est l'hôtel, ce qui permet de retrouver la zone au prochain séjour.
    const lieuFinal = lieu || (sv.zonePickup && d.hotel ? d.hotel : "");
    // Les champs du voucher remplis dans la fenêtre l'emportent ; un lieu laissé vide reste celui de la demande.
    const v = sv.saisie || saisieVide();
    return { heure: sv.heure || "", lieu: (v.lieu || "").trim() || lieuFinal, bebes: v.bebes, personnes: { adultes: sv.adultes, enfants: sv.enfants }, sieges: v.sieges, details: nonVides(v.details), zonePickup: sv.zonePickup || null };
  }

  const coches = () => services.filter((sv) => sv.coche);
  function totalGeneral() {
    let total = 0;
    let complet = true;
    for (const sv of coches()) {
      const { offre } = etatDe(sv);
      if (offre && offre.total !== null && offre.total !== undefined) total += offre.total;
      else complet = false;
    }
    return { total, complet };
  }

  function majService(sv) {
    const { offre, offres } = etatDe(sv);
    const n = sv.noeuds;
    n.titre.replaceChildren();
    // Retour au point de départ à prix tapé : le titre garde le champ du prix (les lignes prises dans la base, elles, ont le cas général).
    if (sv.retourDepart && (!sv.lignesCustom || sv.ligneRetour)) n.titre.append(h("strong", null, tr("Retour au point de départ")), h("span", { class: "dsv-detail" }, texteRetour(sv)), prixRetour(sv), h("button", { class: "lien", type: "button", onclick: () => choisirDansBase(sv) }, tr("Choisir dans la base")));
    // Transfert privé hors catalogue lu par l'assistant : départ et arrivée déjà posés, le prix convenu se tape ici.
    else if (sv.transfertLibre && (!sv.lignesCustom || sv.ligneLibre)) n.titre.append(h("strong", null, tr("Transfert privé hors catalogue")), h("span", { class: "dsv-detail" }, texteLibre(sv)), prixLibre(sv), h("button", { class: "lien", type: "button", onclick: () => choisirDansBase(sv) }, tr("Choisir dans la base")));
    else if (sv.lignesCustom) n.titre.append(h("strong", null, offre.titre), h("button", { class: "lien", type: "button", onclick: () => choisirDansBase(sv) }, tr("Ajouter une ligne")));
    else if (!offres.length) n.titre.append(h("strong", { class: "a-preciser" }, tr("À préciser")), h("span", { class: "dsv-phrase" }, `« ${sv.phrase.length > 90 ? `${sv.phrase.slice(0, 90)}…` : sv.phrase} »`), h("button", { class: "secondaire petit", type: "button", onclick: () => choisirDansBase(sv) }, tr("Choisir dans la base")));
    else if (offres.length === 1) n.titre.append(h("strong", null, offres[0].titre), h("span", { class: "dsv-detail" }, offres[0].detail));
    else {
      const sel = h("select", { "aria-label": tr("Service proposé"), onchange: (e) => ((sv.offreId = e.target.value), majService(sv), majTotal()) }, offres.map((o) => h("option", { value: clefOffre(o) }, `${o.titre} · ${o.total === null ? "-" : formatMontant(o.total, devise)}`)));
      sel.value = offre ? clefOffre(offre) : "";
      n.titre.append(sel, offre ? h("span", { class: "dsv-detail" }, offre.detail) : null);
    }
    if (sv.confiance) n.titre.append(badgeConfiance(sv.confiance));
    n.prix.textContent = offre && offre.total !== null && offre.total !== undefined ? formatMontant(offre.total, devise) : "-";
    const alertes = [];
    if (!sv.date) alertes.push(tr("Date à préciser."));
    else if (sv.date < aujourdhui()) alertes.push(tr("La date du service est passée."));
    if (sv.adultes + sv.enfants === 0) alertes.push(tr("Nombre de personnes à préciser."));
    if (offre && offre.avertissement && AVERTISSEMENTS[offre.avertissement]) alertes.push(tr(AVERTISSEMENTS[offre.avertissement]));
    if (sv.copie) alertes.push(tr("Même service, autre date."));
    n.alertes.replaceChildren(...alertes.map((a) => h("span", { class: "demande-attention" }, a)));
    n.alertes.hidden = !alertes.length;
    n.li.classList.toggle("decoche", !sv.coche);
    // Le bloc du voucher suit le modèle du service choisi (billet de bateau, excursion, transfert…) ; la saisie, elle, est gardée.
    const service = servicesCreation(lignesDuService(sv, offre), { prestations: etat.db.prestations, partenaires: etat.db.partenaires, trajets: etat.db.trajets })[0] || null;
    const cle = service ? `${service.type}|${service.personnes.adultes + service.personnes.enfants > 0}|${service.pickup}|${service.dropoff}` : "";
    if (cle !== sv.cleVoucher) {
      sv.cleVoucher = cle;
      // Taxi : sans lieu donné par la demande, le pickup et le drop-off montrent les deux bouts du trajet choisi.
      if (service && modeTaxi()) boutsDuTrajet(sv.saisie, service, { lieu: !(d.type === "transfer" && d.pickup) });
      n.voucher.replaceChildren(...(service ? [blocServiceCreation({ service, saisie: sv.saisie, taxi: modeTaxi(), prefixe: `svc${sv.id}-v`, sauf: ["heure", "adultes", "enfants"], aideLieu: tr("Vide : celui de la demande, ou l'hôtel."), ouvert: false, surSaisie: (s) => {
        // Repassé en aller simple : ce n'est plus un retour au départ, les offres de la base et le cas général reviennent.
        if (sv.retourDepart && (s.details || {}).type_trajet !== RETOUR_DEPART) return quitterRetour(sv);
        // Le prix tapé suit le lieu et le programme (libellé de la ligne) ; le titre du service redit le programme lu.
        majLigneRetour(sv);
        if (sv.retourDepart) majTitreRetour(sv);
        // Transfert hors catalogue : le libellé suit le pickup et le drop-off corrigés dans le bloc du voucher.
        if (sv.transfertLibre) (majLigneLibre(sv), majTitreLibre(sv));
      } })].filter(Boolean) : []));
    }
    // Le partenaire a changé (autre offre choisie) : ses zones de pickup remplacent les précédentes.
    const pid = partenaireDeOffre(sv, offre);
    if (sv.zones && pid !== sv.partenaireId) {
      sv.partenaireId = pid;
      sv.zones.rafraichir();
    }
  }

  function construireService(sv) {
    const noeuds = { titre: h("div", { class: "dsv-titre" }), prix: h("strong", { class: "dsv-prix" }), alertes: h("p", { class: "dsv-alertes" }), voucher: h("div", { class: "dsv-voucher" }) };
    sv.noeuds = noeuds;
    // Ce que la demande dit déjà pour le voucher (un trajet du site donne la dépose, le vol, les bagages et les sièges), modifiable dans la fenêtre.
    const site = d.type === "transfer";
    sv.saisie = { ...saisieVide(), bebes: d.bebes || 0, sieges: site ? Number(d.sieges) || 0 : 0, details: site ? nonVides({ drop_off: d.dropoff || "", vol: d.vol || "", bagages: d.bagages ? String(d.bagages) : "" }) : {} };
    // Retour au point de départ lu dans le message : le type, le programme et la durée sont déjà posés ; le lieu de pickup est celui de la demande (ou l'hôtel).
    if (sv.transfertLibre) {
      sv.saisie.lieu = sv.transfertLibre.de || d.hotel || "";
      sv.saisie.details = { ...nonVides({ ...sv.saisie.details, drop_off: sv.transfertLibre.vers || "" }) };
      sv.saisie.ouvert = true;
    }
    if (sv.retourDepart) {
      sv.saisie.details = { ...nonVides({ ...sv.saisie.details, drop_off: "" }), type_trajet: RETOUR_DEPART, ...nonVides({ programme_trajet: sv.retourDepart.programme || "", duree_h: sv.retourDepart.duree || "" }) };
      sv.saisie.lieu = (site && d.pickup) || d.hotel || "";
      sv.saisie.ouvert = true;
    }
    const champ4 = (cle, libelle, valeur, opts = {}) => {
      const input = h("input", { id: `svc${sv.id}-${cle}`, value: valeur, autocomplete: "off", ...opts, onchange: (e) => ((sv[cle] = opts.type === "number" ? entier(e.target.value) : e.target.value), majService(sv), majTotal()) });
      return champ(libelle, input);
    };
    sv.partenaireId = partenaireDuService(sv);
    // Zone de l'hôtel : choisir la zone et le départ remplit l'heure de pickup d'après la grille du partenaire, sans écraser une heure déjà écrite.
    sv.zones = blocZonesPickup({
      id: `svc${sv.id}-zones`,
      partenaire: () => partenaireDe(partenaireDuService(sv)),
      hotel: () => (d && d.hotel) || "",
      trajet: () => {
        const { offre } = etatDe(sv);
        return offre && offre.genre === "trajet" ? offre.source : null;
      },
      surChoix: ({ heure, gardee }) => {
        sv.zonePickup = gardee;
        // L'heure du message qui est celle du bateau n'est pas l'heure de pickup : la grille la remplace.
        const { offre } = etatDe(sv);
        const heureBateau = offre && offre.genre === "trajet" && offre.source.depart ? offre.source.depart.slice(0, 5) : "";
        const nouvelle = heureAPoser({ actuelle: sv.heure === heureBateau ? "" : sv.heure, derniereGrille: sv.heureGrille, nouvelle: heure });
        if (nouvelle !== null) {
          sv.heure = nouvelle;
          sv.heureGrille = nouvelle;
          const input = document.getElementById(`svc${sv.id}-heure`);
          if (input) input.value = nouvelle;
        }
        majService(sv);
      },
    });
    const coche = h("input", { type: "checkbox", checked: sv.coche, "aria-label": tr("Créer ce service"), onchange: (e) => ((sv.coche = e.target.checked), majService(sv), majTotal()) });
    noeuds.li = h(
      "li",
      { class: "dsv" },
      h("div", { class: "dsv-tete" }, h("label", { class: "case-tache" }, coche), noeuds.titre, noeuds.prix),
      noeuds.alertes,
      h("div", { class: "dsv-champs" }, champ4("date", tr("Date du service"), sv.date || "", { type: "date" }), champ4("heure", tr("Heure de pickup"), sv.heure || "", { type: "time" }), champ4("adultes", tr("Adultes"), String(sv.adultes), { type: "number", min: "0", step: "1", inputmode: "numeric" }), champ4("enfants", tr("Enfants"), String(sv.enfants), { type: "number", min: "0", step: "1", inputmode: "numeric" })),
      sv.zones.noeud,
      noeuds.voucher
    );
    majService(sv);
    return noeuds.li;
  }

  function nouveauService(base) {
    const sv = { id: ++compteur, coche: true, phrase: "", date: "", heure: "", adultes: d ? d.adultes : 0, enfants: d ? d.enfants : 0, offreId: null, lignesCustom: null, copie: false, noeuds: null, ...base };
    services.push(sv);
    listeBloc.append(construireService(sv));
    return sv;
  }

  // Retour au point de départ : le prix convenu, tapé ici, devient la ligne du service (« Round trip from Lanta Sand Resort: Old Town tour »).
  // Le libellé suit le lieu et le programme saisis dans le bloc du voucher ; chez Taxi, la course est celle du chauffeur de l'entreprise.
  function prixRetour(sv) {
    const input = h("input", { id: `svc${sv.id}-prix`, type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: tr("Prix ({devise})", { devise }), "aria-label": tr("Prix convenu ({devise})", { devise }), value: sv.prixRetour ?? "", onchange: (e) => {
      const v = e.target.value.trim();
      sv.prixRetour = v === "" ? null : Number(v);
      majLigneRetour(sv);
      majService(sv);
      majTotal();
    } });
    return input;
  }
  // Transfert privé hors catalogue : « Lanta Sand Resort → The Scene, Ao Nang · Hors catalogue : indiquez le prix convenu. »
  const deVersLibre = (sv) => ({ de: ((sv.saisie && sv.saisie.lieu) || sv.transfertLibre.de || "").trim(), vers: (((sv.saisie && sv.saisie.details) || {}).drop_off || sv.transfertLibre.vers || "").trim() });
  const texteLibre = (sv) => {
    const { de, vers } = deVersLibre(sv);
    return [`${de || tr("Départ à préciser")} → ${vers || tr("Arrivée à préciser")}`, tr("Hors catalogue : indiquez le prix convenu.")].join(" · ");
  };
  const majTitreLibre = (sv) => {
    const n = sv.noeuds && sv.noeuds.titre && sv.noeuds.titre.querySelector(".dsv-detail");
    if (n && sv.transfertLibre && (!sv.lignesCustom || sv.ligneLibre)) n.textContent = texteLibre(sv);
  };
  function prixLibre(sv) {
    return h("input", { id: `svc${sv.id}-prix`, type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: tr("Prix ({devise})", { devise }), "aria-label": tr("Prix convenu ({devise})", { devise }), value: sv.prixLibre ?? "", onchange: (e) => {
      const v = e.target.value.trim();
      sv.prixLibre = v === "" ? null : Number(v);
      majLigneLibre(sv);
      majService(sv);
      majTotal();
    } });
  }
  function majLigneLibre(sv) {
    if (!sv.transfertLibre || (sv.lignesCustom && !sv.ligneLibre)) return;
    if (sv.prixLibre === null || sv.prixLibre === undefined || !(sv.prixLibre >= 0)) {
      if (sv.ligneLibre) sv.lignesCustom = null;
      sv.ligneLibre = null;
      return;
    }
    const p = modeTaxi() ? partenaireDeTaxi(etat.db.partenaires, chauffeurRegle(reglages())) : null;
    sv.ligneLibre = ligneTransfertPrive({ ...deVersLibre(sv), prix: sv.prixLibre, date: sv.date, partenaireId: p ? p.id : null }, sv.ligneLibre);
    sv.lignesCustom = [sv.ligneLibre];
  }

  // « « Old Town, the driver waits » · environ 3 h · Aucune grille… » : ce que le service porte déjà, sous son titre.
  const texteRetour = (sv) => {
    const dt = (sv.saisie && sv.saisie.details) || {};
    return [dt.programme_trajet ? `« ${dt.programme_trajet} »` : tr("Programme à préciser dans le bloc du voucher."), dureeFrancais(dt.duree_h), tr("Aucune grille : indiquez le prix convenu pour ce programme.")].filter(Boolean).join(" · ");
  };
  function quitterRetour(sv) {
    sv.retourDepart = null;
    if (sv.ligneRetour) sv.lignesCustom = null;
    sv.ligneRetour = null;
    sv.prixRetour = null;
    // Le bloc du voucher se refait sur la nouvelle offre (après l'événement en cours) ; la saisie (lieu, drop-off, aller simple) est gardée.
    setTimeout(() => (majService(sv), majTotal()));
  }
  const majTitreRetour = (sv) => {
    const n = sv.noeuds && sv.noeuds.titre && sv.noeuds.titre.querySelector(".dsv-detail");
    if (n) n.textContent = texteRetour(sv);
  };
  function majLigneRetour(sv) {
    if (!sv.retourDepart) return;
    if (sv.prixRetour === null || sv.prixRetour === undefined || !(sv.prixRetour >= 0)) {
      if (sv.ligneRetour) sv.lignesCustom = null;
      sv.ligneRetour = null;
      return;
    }
    const p = modeTaxi() ? partenaireDeTaxi(etat.db.partenaires, chauffeurRegle(reglages())) : null;
    const dt = (sv.saisie && sv.saisie.details) || {};
    sv.ligneRetour = ligneRetourDepart({ lieu: (sv.saisie && sv.saisie.lieu) || (d && (d.pickup || d.hotel)) || "", programme: dt.programme_trajet || "", prix: sv.prixRetour, date: sv.date, partenaireId: p ? p.id : null }, sv.ligneRetour);
    const l = sv.ligneRetour;
    sv.lignesCustom = [l];
  }

  // Service que la base ne propose pas tel quel : la fenêtre des tarifs reprend sa date et ses personnes, chaque ajout devient une ligne du service.
  function choisirDansBase(sv) {
    choisirPrestation({ langue, devise, sansCompagnie: true, dossierId: null, defauts: { date: sv.date, adultes: sv.adultes, enfants: sv.enfants }, onAjout: (lignes) => {
      // Une ligne prise dans la base remplace le prix tapé d'un retour au point de départ ou d'un transfert hors catalogue.
      if (sv.ligneRetour) (sv.lignesCustom = null), (sv.ligneRetour = null), (sv.prixRetour = null);
      if (sv.ligneLibre) (sv.lignesCustom = null), (sv.ligneLibre = null), (sv.prixLibre = null);
      sv.lignesCustom = [...(sv.lignesCustom || []), ...lignes];
      const premiere = lignes.find((l) => l.date_service);
      if (!sv.date && premiere) {
        sv.date = premiere.date_service;
        const input = document.getElementById(`svc${sv.id}-date`);
        if (input) input.value = sv.date;
      }
      majService(sv);
      majTotal();
    } });
  }

  function majTotal() {
    const n = coches().length;
    // Prix convenu dans « Modifier » : c'est lui que la facture prendra (un seul service).
    const { total, complet } = prixImpose !== null && n === 1 ? { total: prixImpose, complet: true } : totalGeneral();
    totalBloc.textContent = n ? (complet ? tr("Total : {montant}", { montant: formatMontant(total, devise) }) : tr("Total : prix à confirmer pour au moins un service")) : tr("Aucun service coché.");
    if (bouton) {
      bouton.textContent = n ? (complet ? tr("Créer le dossier · {n} · {montant}", { n: pluriel(n, N_("{n} service"), N_("{n} services")), montant: formatMontant(total, devise) }) : tr("Créer le dossier · {n}", { n: pluriel(n, N_("{n} service"), N_("{n} services")) })) : tr("Créer le dossier sans service");
      reponse.disabled = !n;
    }
  }

  // ---- Client, champs et message de réponse --------------------------------------------------------------------------------------
  function retenirClient() {
    const proches = clientsConnus();
    if (clientId && !proches.some((x) => x.client.id === clientId)) clientId = "";
    if (!clientId && proches[0] && proches[0].raison === "telephone") clientId = proches[0].client.id;
    const c = clientId ? clientParId(clientId) : null;
    if (c && !d.hotel && !d.hotelSaisi) d.hotel = hotelDuClient(c);
  }

  function dessinerClient() {
    clientBloc.replaceChildren();
    if (!d) return;
    retenirClient();
    // L'hôtel a pu changer (corrigé, ou repris de la fiche du client) : les zones proposées pour cet hôtel suivent.
    for (const sv of services) if (sv.zones) sv.zones.rafraichir();
    if (saisies.hotel && saisies.hotel.value !== (d.hotel || "")) saisies.hotel.value = d.hotel || "";
    const proches = clientsConnus();
    const connu = clientId ? clientParId(clientId) : null;
    const propose = !connu ? proches.find((x) => x.raison === "nom") : null;
    clientBloc.append(
      ...[
        connu
          ? h("p", { class: "demande-client connu", role: "status" }, h("span", null, tr("Client déjà connu : {nom}", { nom: nomClient(connu) }), connu.telephone ? ` · ${connu.telephone}` : ""), h("button", { class: "lien", type: "button", onclick: () => (refuse.add(connu.id), (clientId = ""), !d.hotelSaisi && d.hotel === hotelDuClient(connu) && (d.hotel = ""), dessinerClient()) }, tr("Nouveau client")))
          : propose
            ? h("p", { class: "demande-client", role: "status" }, h("span", null, tr("Un client porte le même nom : {nom}", { nom: nomClient(propose.client) }), propose.client.telephone ? ` · ${propose.client.telephone}` : ""), h("button", { class: "secondaire petit", type: "button", onclick: () => ((clientId = propose.client.id), dessinerClient()) }, tr("C'est lui")))
            : d.nom
              ? h("p", { class: "aide" }, tr("Nouveau client : il sera créé avec le dossier."))
              : null,
      ].filter(Boolean)
    );
  }

  // Un seul message de réponse, avec chaque service, SA date, son prix et le total, dans la langue du client. Aperçu et corrections avant l'envoi.
  function repondre() {
    const emetteur = regl.emetteur || {};
    const entreprise = { nom: emetteur.nom || entiteActive().nom, telephone: emetteur.telephone || "" };
    ouvrirMessage({
      titre: tr("Réponse à {nom}", { nom: d.nom || tr("la personne") }),
      pour: "client",
      cle: "reponse",
      // Secret et Taxi répondent toujours en anglais, avec les libellés anglais des services.
      langue: langueReponse(texte, modeExcursions()),
      telephone: d.telephone || "",
      vars: (l) => varsReponse({ d, services: coches().map((sv) => ({ ...sv, offre: etatDe(sv).offre, bebes: d.bebes })), devise, langue: l === "fr" && !modeExcursions() ? "fr" : "en", entreprise, partenaireDe, destinations: reglages().destinations_passeport }),
    });
  }

  // ---- Création --------------------------------------------------------------------------------------------------------------------
  function preparer() {
    const nom = separerNom(d.nom);
    const lignes = [];
    const parService = [];
    for (const sv of coches()) {
      majLigneRetour(sv);
      const { offre } = etatDe(sv);
      const ls = lignesDuService(sv, offre);
      if (!ls.length) return { manque: sv };
      lignes.push(...ls);
      parService.push({ ligneIds: ls.map((l) => l.id), ...reservationDe(sv, offre) });
    }
    // Retour au point de départ sans programme : on ne crée pas, le champ est montré.
    const incomplet = trajetIncomplet(parService);
    if (incomplet) return { incomplet: coches()[incomplet.index], code: incomplet.code, champ: incomplet.champ };
    const plusieurs = parService.length > 1;
    // Prix convenu dans « Modifier » (un seul service) : la facture prend ce total, l'écart va sur la première ligne.
    const finales = prixImpose !== null && !plusieurs ? imposerTotal(lignes, prixImpose) : lignes;
    return { prenom: nom.prenom, nom: nom.nom, telephone: d.telephone || "", hotel: d.hotel, client_id: clientId, personnes: { adultes: d.adultes, enfants: d.enfants }, notes: [notesDemande(plusieurs ? { ...d, heure: "" } : d), d.remarquesIA].filter(Boolean).join("\n"), lignes: finales, parService, reservation: parService[0] || {} };
  }

  // Un retour au point de départ sans programme (ou à durée illisible) : le bloc du service se déplie et le champ prend le focus.
  function montrerIncomplet(b) {
    erreur.textContent = tr(ERREURS_TRAJET[b.code]);
    const sv = b.incomplet;
    const champ_ = document.getElementById(`svc${sv.id}-v-${b.champ === "duree_h" ? "duree-h" : "programme-trajet"}`);
    if (!champ_) return;
    const bloc = champ_.closest("details");
    if (bloc) bloc.open = true;
    champ_.focus();
  }

  // Création directe : client, dossier, facture et une réservation par service, sans passer par l'écran « Nouveau dossier ».
  async function creerMaintenant(btn) {
    erreur.textContent = "";
    const nouveauClient = !clientId;
    if (nouveauClient && !d.nom.trim()) return (erreur.textContent = tr("Indiquez le nom du client.")), document.getElementById("dem-nom").focus();
    if (nouveauClient && !peut("clients.ecrire")) return (erreur.textContent = tr("Votre rôle ne permet pas de créer un client : choisissez un client existant."));
    const b = preparer();
    if (b.manque && b.manque.retourDepart) return (erreur.textContent = tr("Indiquez le prix convenu du retour au point de départ, ou décochez cette ligne.")), (document.getElementById(`svc${b.manque.id}-prix`) || {}).focus?.();
    if (b.manque && b.manque.transfertLibre) return (erreur.textContent = tr("Indiquez le prix du transfert privé, ou décochez cette ligne.")), (document.getElementById(`svc${b.manque.id}-prix`) || {}).focus?.();
    if (b.manque) return (erreur.textContent = tr("Choisissez le service de « {phrase} » ou décochez cette ligne.", { phrase: b.manque.phrase.slice(0, 60) }));
    if (b.incomplet) return montrerIncomplet(b);
    const ref = refProposee(regl);
    if (!ref.trim() || refExiste(ref)) return (erreur.textContent = tr("Le numéro de facture n'a pas pu être proposé : créez le dossier depuis « Nouveau dossier »."));
    creation = true;
    btn.disabled = true;
    btn.textContent = tr("Création…");
    try {
      const numero = await refDefinitive(ref, ref, regl);
      const dossier = await creerDossierExcursions({ client: clientId ? { id: clientId } : { prenom: b.prenom, nom: b.nom, telephone: b.telephone, hotel: b.hotel, chambre: "" }, lignes: b.lignes, notes: b.notes, ref: numero, reservation: b.reservation, parService: b.parService });
      if (!depuisSite) garde.ecrire("");
      const finals = coches().map((sv) => ({ date: sv.date, heure: sv.heure, adultes: sv.adultes, enfants: sv.enfants, titre: (etatDe(sv).offre || {}).titre || "", total: (etatDe(sv).offre || {}).total ?? null }));
      const somme = b.lignes.filter((l) => l.kind !== "texte").reduce((t, l) => t + (Number(l.unite) || 0) * (Number(l.qte) || 0), 0);
      fermer();
      toast(tr("Dossier {ref} créé.", { ref: dossier.ref }));
      if (depuisSite && depuisSite.surCree) return void depuisSite.surCree({ dossier, services: finals, total: Math.round(somme * 100) / 100 });
      naviguer(`#/dossier/${dossier.id}`);
    } catch (err) {
      erreur.textContent = /duplicate|unique|23505/i.test(err.message) ? tr("Ce numéro existe déjà. Réessayez.") : err.message;
      creation = false;
      btn.disabled = false;
      majTotal();
    }
  }

  // Ouvre l'écran « Nouveau dossier » déjà rempli, pour vérifier ou compléter avant de créer.
  function verifierAvant() {
    const b = preparer();
    if (b.manque && b.manque.retourDepart) return (erreur.textContent = tr("Indiquez le prix convenu du retour au point de départ, ou décochez cette ligne.")), (document.getElementById(`svc${b.manque.id}-prix`) || {}).focus?.();
    if (b.manque && b.manque.transfertLibre) return (erreur.textContent = tr("Indiquez le prix du transfert privé, ou décochez cette ligne.")), (document.getElementById(`svc${b.manque.id}-prix`) || {}).focus?.();
    if (b.manque) return (erreur.textContent = tr("Choisissez le service de « {phrase} » ou décochez cette ligne.", { phrase: b.manque.phrase.slice(0, 60) }));
    if (b.incomplet) return montrerIncomplet(b);
    brouillon = b;
    fermer();
    naviguer("#/dossiers/nouveau?demande=1");
  }

  const modifier = (cle, valeur) => {
    // Un retour au point de départ a pris l'hôtel lu comme lieu de pickup : corrigé ici, il suit (sauf un lieu réécrit dans le bloc du voucher).
    if (cle === "hotel")
      for (const sv of services.filter((x) => x.retourDepart && x.saisie && (x.saisie.lieu || "") === (d.hotel || ""))) {
        sv.saisie.lieu = valeur;
        const input = document.getElementById(`svc${sv.id}-v-lieu`);
        if (input) input.value = valeur;
        majLigneRetour(sv);
      }
    d[cle] = valeur;
    if (cle === "hotel") d.hotelSaisi = true;
    dessinerClient();
  };

  // Champs du client : posés une fois par message lu. La date, l'heure et les personnes sont dans chaque service.
  function construire() {
    const saisie = (cle, libelle, valeur, surChangement, opts = {}) => {
      const input = h("input", { id: `dem-${cle}`, value: valeur, autocomplete: "off", ...opts, onchange: (e) => surChangement(e.target.value) });
      saisies[cle] = input;
      return champ(libelle, input);
    };
    champs.replaceChildren(
      saisie("nom", tr("Nom du client"), d.nom, (v) => modifier("nom", v.trim())),
      saisie("tel", tr("WhatsApp"), d.telephone || "", (v) => modifier("telephone", v.trim()), { type: "tel", inputmode: "tel", placeholder: "+33 6 00 00 00 00" }),
      saisie("hotel", tr("Hôtel"), d.hotel || "", (v) => modifier("hotel", v.trim()), { placeholder: exemple("hotel") })
    );
  }

  let bouton = null;
  const reponse = h("button", { class: "secondaire", type: "button", onclick: () => repondre() }, tr("Répondre au client"));

  function poserLesBoutons() {
    const ecrit = peut("dossiers.ecrire");
    bouton = h("button", { class: "principal", type: "button", onclick: (e) => creerMaintenant(e.currentTarget) });
    const marque = (d.marque || "").toLowerCase();
    const mauvaise = marque && !entiteActive().nom.toLowerCase().includes(marque.split(" ")[0]);
    const sitesLignes = lignesSite(d);
    dynamique.replaceChildren(
      ...[
        mauvaise && !depuisSite ? h("p", { class: "bandeau-info", role: "status" }, tr("Cette demande est adressée à {marque}. Changez d'entreprise en haut de l'écran pour utiliser sa base de prix.", { marque: d.marque })) : null,
        prixImpose !== null ? h("p", { class: "bandeau-info", role: "status" }, coches().length > 1 ? tr("Prix convenu : {prix}. Plusieurs services : ajustez la facture dans le dossier.", { prix: formatMontant(prixImpose, devise) }) : tr("Prix convenu : {prix}. La facture prendra ce total.", { prix: formatMontant(prixImpose, devise) })) : null,
        d.siegeEnfant || d.siegeBebe || d.bebes ? h("p", { class: "aide" }, [d.bebes ? tr("{n} bébé : noté dans le dossier.", { n: d.bebes }) : "", d.siegeEnfant ? tr("Siège enfant demandé.") : "", d.siegeBebe ? tr("Siège bébé demandé.") : ""].filter(Boolean).join(" ")) : null,
        sitesLignes.length ? h("ul", { class: "demande-site" }, sitesLignes.map((l) => h("li", null, l))) : null,
        clientBloc,
        h("h3", { class: "services-titre" }, tr("Services trouvés")),
        listeBloc,
        h("button", { class: "secondaire petit", type: "button", onclick: () => { const sv = nouveauService({ phrase: tr("Service ajouté") }); choisirDansBase(sv); } }, tr("Ajouter un service")),
        totalBloc,
        erreur,
        h("div", { class: "barre-modal" }, ...[ecrit ? bouton : null, depuisSite ? null : reponse, ecrit && !depuisSite ? h("button", { class: "lien", type: "button", onclick: () => verifierAvant() }, tr("Vérifier avant de créer")) : null].filter(Boolean)),
      ].filter(Boolean)
    );
  }

  // Relire le texte : tout ce qui avait été corrigé à la main est perdu, c'est un autre message.
  function lire(valeur) {
    texte = valeur;
    majVersConfirmation();
    if (!depuisSite) garde.ecrire(valeur.trim());
    erreur.textContent = "";
    const lu = texte.trim() ? lireMessage(texte, aujourdhui()) : null;
    if (lu) return appliquer(lu, decouperServices(texte, lu, contexte(), aujourdhui()));
    d = null;
    vider();
    corps.classList.remove("lu");
    if (texte.trim()) reconnu.append(h("p", { class: "erreur-form", role: "alert" }, tr("Rien de reconnu dans ce texte. Collez le message du client tel qu'il est arrivé sur WhatsApp.")));
  }

  function vider() {
    clientId = "";
    refuse = new Set();
    services = [];
    listeBloc.replaceChildren();
    reconnu.replaceChildren();
  }

  // Une lecture (par règles ou par l'assistant IA) et ses services : tout ce qui avait été corrigé à la main repart de zéro.
  // Un service lu par l'assistant porte `offresIA` (les lignes de la base qu'il a choisies) et `confiance`.
  function appliquer(d2, trouves) {
    erreur.textContent = "";
    d = { ...d2, hotelSaisi: false };
    // Demande du site : le numéro WhatsApp donné dans la feuille (migration 41) n'est pas dans le message, il va dans la fiche du client
    // (et retrouve un client déjà connu par son numéro). Lecture par règles comme par l'assistant.
    if (depuisSite && depuisSite.telephone && !d.telephone) d.telephone = depuisSite.telephone;
    vider();
    corps.classList.add("lu");
    construire();
    poserLesBoutons();
    // Demande de transfert du site VIP Taxi Lanta collée dans une autre entreprise : on propose d'y passer, le message est repris là-bas.
    const taxi = !depuisSite && demandeDeTaxi(texte, d) ? entrepriseTaxi(entitesAccessibles(), (id) => etat.brut.reglages[id], etat.entiteId) : null;
    if (taxi && peut("dossiers.ecrire")) reconnu.append(h("div", { class: "bandeau-info demande-bascule", role: "status" }, h("p", null, tr("Demande de transfert du site de {nom} : le dossier se crée dans {nom}.", { nom: taxi.nom })), h("button", { class: "principal petit", type: "button", onclick: () => basculer(taxi) }, tr("Passer à {nom}", { nom: taxi.nom }))));
    reconnu.append(champs, dynamique);
    // Rien de reconnu comme service : une ligne « à préciser » plutôt que le silence.
    if (!trouves.length) nouveauService({ phrase: texte.trim().replace(/\s+/g, " ").slice(0, 140), date: d.date || "", heure: d.heure || "" });
    for (const t of trouves) nouveauService({ phrase: t.phrase, date: t.date, heure: t.heure, adultes: t.adultes, enfants: t.enfants, vehicule: t.vehicule || "", mode: t.mode || "", copie: !!t.copie, retourDepart: t.retourDepart || null, transfertLibre: t.transfertLibre || null, ...(t.offresIA ? { offresIA: t.offresIA, confiance: t.confiance } : {}) });
    dessinerClient();
    majTotal();
  }

  // Lecture par l'assistant IA (si l'entreprise l'a allumé) : ses services remplacent ceux des règles, tout reste corrigeable avant de créer.
  const lireIA = boutonLireIA({ texte: () => zone.value, surResultat: (lu) => appliquer(lu.d, lu.services.map((t) => ({ ...t, offresIA: t.offres.map((o) => ({ genre: o.genre, id: o.id })) }))) });

  const coller = h("button", { class: "secondaire", type: "button", onclick: async () => {
    try {
      zone.value = await navigator.clipboard.readText();
      lire(zone.value);
    } catch {
      toast(tr("Le navigateur ne permet pas de coller d'un geste : collez dans le cadre avec un appui long."), true);
    }
  } }, tr("Coller"));
  const effacer = h("button", { class: "lien", type: "button", onclick: () => ((zone.value = ""), lire(""), zone.focus()) }, tr("Effacer"));

  // Filet (18.11.2026) : une confirmation de course collée ici (« New booking confirmation », VIP TAXI LANTA…, Name:, Pick-up…) relève de
  // « Coller une confirmation ». On le dit et on propose d'y passer avec le même texte ; rien n'est créé d'office, la lecture ici continue.
  const versConfirmation = h("div", { class: "demande-vers-confirmation", role: "status" });
  function majVersConfirmation() {
    const oui = !depuisSite && confirmationPermise() && ressembleAConfirmation(texte, { aujourdhui: aujourdhui() });
    versConfirmation.replaceChildren(
      ...(oui
        ? [
            h(
              "div",
              { class: "bandeau-info" },
              h("p", null, tr("Ce texte ressemble à une confirmation de course : « Coller une confirmation » en fait le dossier et la Booking confirmation.")),
              h("button", { class: "principal", type: "button", onclick: async () => {
                const t = texte;
                garde.ecrire("");
                fermer();
                (await import("./confirmation.mjs")).ouvrirConfirmation(t);
              } }, tr("Ouvrir « Coller une confirmation » avec ce texte"))
            ),
          ]
        : [])
    );
  }
  const corps = h("div", { class: "modal-corps demande" });
  corps.append(
    h("p", { class: "aide demande-aide" }, tr("Collez le message du client, tel qu'il est arrivé sur WhatsApp. Chaque service cité est reconnu avec sa date, ses personnes et son prix, et le prix vient de la base.")),
    h("div", { class: "champ demande-message" }, h("label", { for: "demande-texte" }, tr("Message du client")), zone),
    ...(depuisSite ? [] : [h("div", { class: "actions gauche" }, coller, effacer)]),
    ...(lireIA ? [lireIA] : []),
    versConfirmation,
    reconnu
  );
  const fermer = modal(depuisSite ? depuisSite.titre : tr("Coller une demande"), corps, { large: true, protege: false });
  // Le message reste dans le brouillon de l'appareil : la fenêtre rouverte dans l'autre entreprise le relit.
  function basculer(cible) {
    garde.ecrire(texte.trim());
    fermer();
    changerEntite(cible.id);
    setTimeout(() => ouvrirDemande(), 300);
  }

  // Demande du site : son message, jamais le brouillon de l'appareil. Sinon, message gardé d'un passage précédent, repris tel quel.
  const reprise = depuisSite ? depuisSite.texte : garde.lire();
  if (reprise) {
    zone.value = reprise;
    lire(reprise);
  }
}
