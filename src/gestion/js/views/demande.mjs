// « Coller une demande » : le client écrit à Anaïs sur WhatsApp, le message arrive à sa façon ou depuis le formulaire du site. On le colle ici :
// l'outil reconnaît la date, les personnes, l'hôtel, le client et le service cité, cherche le prix dans la base partenaires, et crée le dossier
// d'un tap. Tout ce qui a été reconnu se corrige sur place, et le prix suit.
import { etat, entiteActive, reglages, modeExcursions, nomPartenaire, partenaireDe, netPrestation, netTrajet, peut, naviguer, nomClient, entitesAccessibles, changerEntite } from "../etat.mjs";
import { demandeDeTaxi, entrepriseTaxi } from "../taxi-calc.mjs";
import { h, modal, toast, champ } from "../ui.mjs";
import { aujourdhui, formatMontant } from "../calc.mjs";
import { lireMessage, offresDuService, decouperServices, varsReponse, langueReponse, notesDemande, separerNom, clientsProches } from "../demande-calc.mjs";
import { lignesDepuisTrajet, ligneDepuisPrestation, chiffres, quantiteParDefaut } from "../partenaires-calc.mjs";
import { appliquerModeParDefaut } from "../operations-calc.mjs";
import { ouvrirMessage } from "./messages.mjs";
import { choisirPrestation } from "./choix-prestation.mjs";
import { blocZonesPickup } from "./pickup-zones.mjs";
import { heureAPoser } from "../pickup-calc.mjs";
import { creerDossierExcursions, langueDocuments, refProposee, refExiste, refDefinitive } from "./creation-excursions.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { boutonLireIA, boutonRedigerIA, badgeConfiance } from "./assistant-demande.mjs";
import { offresRecalculees } from "../assistant-calc.mjs";

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
  supplement_a_definir: N_("Prix de la personne supplémentaire à définir dans la base : le prix ne compte que la base."),
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
const hotelDuClient = (c) => ((c && c.adresse) || "").split("\n")[0].replace(/,?\s*Room\s+\S+\s*$/i, "").trim();

// Ce que le formulaire du site a dit en plus du prix à calculer : option, lieux, vol, âges, prix annoncé. Lu, jamais deviné.
function lignesSite(d) {
  if (!d.site) return [];
  return [
    d.option ? tr("Option demandée : {option}", { option: d.option }) : "",
    d.pickup && d.type === "transfer" ? tr("Prise en charge : {lieu}", { lieu: d.pickup }) : "",
    d.dropoff ? tr("Dépose : {lieu}", { lieu: d.dropoff }) : "",
    d.vol ? tr("Vol ou bateau : {vol}", { vol: d.vol }) : "",
    d.ages && d.ages.length ? tr("Âges des enfants : {ages}", { ages: d.ages.map((a) => (a === 0 ? tr("moins de 1 an") : a)).join(", ") }) : "",
    d.prixSite ? tr("Prix indiqué sur le site : {prix}", { prix: d.prixSite }) : "",
    d.sorties && d.sorties.length ? tr("Liste de {n} sorties : seule la première est préparée, les autres sont dans les notes du dossier.", { n: d.sorties.length + 1 }) : "",
    d.type === "location" ? tr("Location : vérifiez la durée et le nombre de véhicules sur la facture.") : "",
  ].filter(Boolean);
}

export function ouvrirDemande() {
  const regl = reglages();
  const devise = regl.devise || "THB";
  const langue = langueDocuments(regl);
  const contexte = () => ({ prestations: etat.db.prestations, trajets: etat.db.trajets, nomPartenaire });
  let d = null;
  let texte = "";
  let clientId = ""; // client existant retenu ; vide pour un nouveau client
  let refuse = new Set(); // clients proposés que la personne a écartés
  let creation = false;
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
  const clientsConnus = () => (d ? clientsProches(d, etat.db.clients).filter((x) => !refuse.has(x.client.id)) : []);

  // ---- Les services --------------------------------------------------------------------------------------------------------------
  // Un service lu par l'assistant garde les lignes de la base qu'il a choisies, recalculées pour ses personnes.
  const offresDe = (sv) => (sv.lignesCustom ? [] : sv.offresIA ? offresRecalculees(sv.offresIA, sv, contexte()) : offresDuService(d, texte, sv, contexte()));
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
    const c = clientId ? etat.db.clients.find((x) => x.id === clientId) : null;
    const siteTransfert = d.type === "transfer";
    const lieu = siteTransfert ? d.pickup || "" : offre && !estTransfert(offre) && d.hotel && d.hotel !== hotelDuClient(c) ? d.hotel : "";
    // Une zone de pickup choisie veut dire un pickup à l'hôtel : le lieu est l'hôtel, ce qui permet de retrouver la zone au prochain séjour.
    const lieuFinal = lieu || (sv.zonePickup && d.hotel ? d.hotel : "");
    return { heure: sv.heure || "", lieu: lieuFinal, bebes: d.bebes || 0, personnes: { adultes: sv.adultes, enfants: sv.enfants }, dropoff: siteTransfert ? d.dropoff || "" : "", vol: siteTransfert ? d.vol || "" : "", bagages: siteTransfert ? d.bagages || 0 : 0, zonePickup: sv.zonePickup || null };
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
    if (sv.lignesCustom) n.titre.append(h("strong", null, offre.titre), h("button", { class: "lien", type: "button", onclick: () => choisirDansBase(sv) }, tr("Ajouter une ligne")));
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
    // Le partenaire a changé (autre offre choisie) : ses zones de pickup remplacent les précédentes.
    const pid = partenaireDeOffre(sv, offre);
    if (sv.zones && pid !== sv.partenaireId) {
      sv.partenaireId = pid;
      sv.zones.rafraichir();
    }
  }

  function construireService(sv) {
    const noeuds = { titre: h("div", { class: "dsv-titre" }), prix: h("strong", { class: "dsv-prix" }), alertes: h("p", { class: "dsv-alertes" }) };
    sv.noeuds = noeuds;
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
      sv.zones.noeud
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

  // Service que la base ne propose pas tel quel : la fenêtre des tarifs reprend sa date et ses personnes, chaque ajout devient une ligne du service.
  function choisirDansBase(sv) {
    choisirPrestation({ langue, devise, sansCompagnie: true, dossierId: null, defauts: { date: sv.date, adultes: sv.adultes, enfants: sv.enfants }, onAjout: (lignes) => {
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
    const { total, complet } = totalGeneral();
    const n = coches().length;
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
    const c = clientId ? etat.db.clients.find((x) => x.id === clientId) : null;
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
    const connu = clientId ? etat.db.clients.find((x) => x.id === clientId) : null;
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
      vars: (l) => varsReponse({ d, services: coches().map((sv) => ({ ...sv, offre: etatDe(sv).offre, bebes: d.bebes })), devise, langue: l === "fr" && !modeExcursions() ? "fr" : "en", entreprise, nomPartenaire }),
    });
  }

  // ---- Création --------------------------------------------------------------------------------------------------------------------
  function preparer() {
    const nom = separerNom(d.nom);
    const lignes = [];
    const parService = [];
    for (const sv of coches()) {
      const { offre } = etatDe(sv);
      const ls = lignesDuService(sv, offre);
      if (!ls.length) return { manque: sv };
      lignes.push(...ls);
      parService.push({ ligneIds: ls.map((l) => l.id), ...reservationDe(sv, offre) });
    }
    const plusieurs = parService.length > 1;
    return { prenom: nom.prenom, nom: nom.nom, telephone: d.telephone || "", hotel: d.hotel, client_id: clientId, personnes: { adultes: d.adultes, enfants: d.enfants }, notes: [notesDemande(plusieurs ? { ...d, heure: "" } : d), d.remarquesIA].filter(Boolean).join("\n"), lignes, parService, reservation: parService[0] || {} };
  }

  // Création directe : client, dossier, facture et une réservation par service, sans passer par l'écran « Nouveau dossier ».
  async function creerMaintenant(btn) {
    erreur.textContent = "";
    const nouveauClient = !clientId;
    if (nouveauClient && !d.nom.trim()) return (erreur.textContent = tr("Indiquez le nom du client.")), document.getElementById("dem-nom").focus();
    if (nouveauClient && !peut("clients.ecrire")) return (erreur.textContent = tr("Votre rôle ne permet pas de créer un client : choisissez un client existant."));
    const b = preparer();
    if (b.manque) return (erreur.textContent = tr("Choisissez le service de « {phrase} » ou décochez cette ligne.", { phrase: b.manque.phrase.slice(0, 60) }));
    const ref = refProposee(regl);
    if (!ref.trim() || refExiste(ref)) return (erreur.textContent = tr("Le numéro de facture n'a pas pu être proposé : créez le dossier depuis « Nouveau dossier »."));
    creation = true;
    btn.disabled = true;
    btn.textContent = tr("Création…");
    try {
      const numero = await refDefinitive(ref, ref, regl);
      const dossier = await creerDossierExcursions({ client: clientId ? { id: clientId } : { prenom: b.prenom, nom: b.nom, telephone: b.telephone, hotel: b.hotel, chambre: "" }, lignes: b.lignes, notes: b.notes, ref: numero, reservation: b.reservation, parService: b.parService });
      garde.ecrire("");
      fermer();
      toast(tr("Dossier {ref} créé.", { ref: dossier.ref }));
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
    if (b.manque) return (erreur.textContent = tr("Choisissez le service de « {phrase} » ou décochez cette ligne.", { phrase: b.manque.phrase.slice(0, 60) }));
    brouillon = b;
    fermer();
    naviguer("#/dossiers/nouveau?demande=1");
  }

  const modifier = (cle, valeur) => {
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
      saisie("hotel", tr("Hôtel"), d.hotel || "", (v) => modifier("hotel", v.trim()), { placeholder: tr("Hotel Sunset, Klong Dao") })
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
        mauvaise ? h("p", { class: "bandeau-info", role: "status" }, tr("Cette demande est adressée à {marque}. Changez d'entreprise en haut de l'écran pour utiliser sa base de prix.", { marque: d.marque })) : null,
        d.siegeEnfant || d.siegeBebe || d.bebes ? h("p", { class: "aide" }, [d.bebes ? tr("{n} bébé : noté dans le dossier.", { n: d.bebes }) : "", d.siegeEnfant ? tr("Siège enfant demandé.") : "", d.siegeBebe ? tr("Siège bébé demandé.") : ""].filter(Boolean).join(" ")) : null,
        sitesLignes.length ? h("ul", { class: "demande-site" }, sitesLignes.map((l) => h("li", null, l))) : null,
        clientBloc,
        h("h3", { class: "services-titre" }, tr("Services trouvés")),
        listeBloc,
        h("button", { class: "secondaire petit", type: "button", onclick: () => { const sv = nouveauService({ phrase: tr("Service ajouté") }); choisirDansBase(sv); } }, tr("Ajouter un service")),
        totalBloc,
        redigerIA,
        erreur,
        h("div", { class: "barre-modal" }, ...[ecrit ? bouton : null, reponse, ecrit ? h("button", { class: "lien", type: "button", onclick: () => verifierAvant() }, tr("Vérifier avant de créer")) : null].filter(Boolean)),
      ].filter(Boolean)
    );
  }

  // Relire le texte : tout ce qui avait été corrigé à la main est perdu, c'est un autre message.
  function lire(valeur) {
    texte = valeur;
    garde.ecrire(valeur.trim());
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
    if (redigerIA) redigerIA.vider();
    listeBloc.replaceChildren();
    reconnu.replaceChildren();
  }

  // Une lecture (par règles ou par l'assistant IA) et ses services : tout ce qui avait été corrigé à la main repart de zéro.
  // Un service lu par l'assistant porte `offresIA` (les lignes de la base qu'il a choisies) et `confiance`.
  function appliquer(d2, trouves) {
    erreur.textContent = "";
    d = { ...d2, hotelSaisi: false };
    vider();
    corps.classList.add("lu");
    construire();
    poserLesBoutons();
    // Demande de transfert du site VIP Taxi Lanta collée dans une autre entreprise : on propose d'y passer, le message est repris là-bas.
    const taxi = demandeDeTaxi(texte, d) ? entrepriseTaxi(entitesAccessibles(), (id) => etat.brut.reglages[id], etat.entiteId) : null;
    if (taxi && peut("dossiers.ecrire")) reconnu.append(h("div", { class: "bandeau-info demande-bascule", role: "status" }, h("p", null, tr("Demande de transfert du site de {nom} : le dossier se crée dans {nom}.", { nom: taxi.nom })), h("button", { class: "principal petit", type: "button", onclick: () => basculer(taxi) }, tr("Passer à {nom}", { nom: taxi.nom }))));
    reconnu.append(champs, dynamique);
    // Rien de reconnu comme service : une ligne « à préciser » plutôt que le silence.
    if (!trouves.length) nouveauService({ phrase: texte.trim().replace(/\s+/g, " ").slice(0, 140), date: d.date || "", heure: d.heure || "" });
    for (const t of trouves) nouveauService({ phrase: t.phrase, date: t.date, heure: t.heure, adultes: t.adultes, enfants: t.enfants, copie: !!t.copie, ...(t.offresIA ? { offresIA: t.offresIA, confiance: t.confiance } : {}) });
    dessinerClient();
    majTotal();
  }

  // Lecture par l'assistant IA (si l'entreprise l'a allumé) : ses services remplacent ceux des règles, tout reste corrigeable avant de créer.
  const lireIA = boutonLireIA({ texte: () => zone.value, surResultat: (lu) => appliquer(lu.d, lu.services.map((t) => ({ ...t, offresIA: t.offres.map((o) => ({ genre: o.genre, id: o.id })) }))) });
  // Brouillon de réponse : un seul bloc par fenêtre, replacé à chaque lecture, pour qu'une correction de champ ne le perde pas.
  const redigerIA = boutonRedigerIA({ contexte: () => ({ d, services: coches().map((sv) => ({ date: sv.date, heure: sv.heure, adultes: sv.adultes, enfants: sv.enfants, choisie: etatDe(sv).offre })), texte }) });

  const coller = h("button", { class: "secondaire", type: "button", onclick: async () => {
    try {
      zone.value = await navigator.clipboard.readText();
      lire(zone.value);
    } catch {
      toast(tr("Le navigateur ne permet pas de coller d'un geste : collez dans le cadre avec un appui long."), true);
    }
  } }, tr("Coller"));
  const effacer = h("button", { class: "lien", type: "button", onclick: () => ((zone.value = ""), lire(""), zone.focus()) }, tr("Effacer"));

  const corps = h("div", { class: "modal-corps demande" });
  corps.append(
    h("p", { class: "aide demande-aide" }, tr("Collez le message du client, tel qu'il est arrivé sur WhatsApp. Chaque service cité est reconnu avec sa date, ses personnes et son prix, et le prix vient de la base.")),
    h("div", { class: "champ demande-message" }, h("label", { for: "demande-texte" }, tr("Message du client")), zone),
    h("div", { class: "actions gauche" }, coller, effacer),
    ...(lireIA ? [lireIA] : []),
    reconnu
  );
  const fermer = modal(tr("Coller une demande"), corps, { large: true, protege: false });
  // Le message reste dans le brouillon de l'appareil : la fenêtre rouverte dans l'autre entreprise le relit.
  function basculer(cible) {
    garde.ecrire(texte.trim());
    fermer();
    changerEntite(cible.id);
    setTimeout(() => ouvrirDemande(), 300);
  }

  // Message gardé d'un passage précédent : repris tel quel.
  const reprise = garde.lire();
  if (reprise) {
    zone.value = reprise;
    lire(reprise);
  }
}
