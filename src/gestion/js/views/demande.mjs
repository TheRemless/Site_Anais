// « Coller une demande » : le client écrit à Anaïs sur WhatsApp, le message arrive à sa façon ou depuis le formulaire du site. On le colle ici :
// l'outil reconnaît la date, les personnes, l'hôtel, le client et le service cité, cherche le prix dans la base partenaires, et crée le dossier
// d'un tap. Tout ce qui a été reconnu se corrige sur place, et le prix suit.
import { etat, entiteActive, reglages, nomPartenaire, partenaireDe, netPrestation, netTrajet, peut, naviguer, nomClient } from "../etat.mjs";
import { h, modal, toast, champ } from "../ui.mjs";
import { aujourdhui, formatMontant } from "../calc.mjs";
import { lireMessage, offresPour, reponsePrix, notesDemande, separerNom, clientsProches } from "../demande-calc.mjs";
import { lignesDepuisTrajet, ligneDepuisPrestation, chiffres, quantiteParDefaut } from "../partenaires-calc.mjs";
import { lienWhatsApp, appliquerModeParDefaut } from "../operations-calc.mjs";
import { creerDossierExcursions, langueDocuments, refProposee, refExiste, refDefinitive } from "./creation-excursions.mjs";
import { tr, N_ } from "../i18n.mjs";

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
  let d = null;
  let texte = "";
  let offreId = null;
  let clientId = ""; // client existant retenu ; vide pour un nouveau client
  let refuse = new Set(); // clients proposés que la personne a écartés
  let creation = false;

  const zone = h("textarea", { id: "demande-texte", rows: 4, placeholder: "Hi Secret Travel & Tour!\nI'd like a price for a transfer.\nName: …", oninput: () => lire(zone.value) });
  const reconnu = h("div", { class: "demande-reconnu", "aria-live": "polite" });
  // Les champs corrigeables sont posés une fois par message : les redessiner à chaque correction ferait perdre le doigt au champ suivant.
  const champs = h("div", { class: "demande-champs" });
  const dynamique = h("div", { class: "demande-dynamique" });
  const saisies = {};
  const erreur = h("p", { class: "erreur-form", role: "alert" });

  const copier = (t) =>
    navigator.clipboard.writeText(t).then(
      () => toast(tr("Réponse copiée : collez-la dans WhatsApp.")),
      () => toast(tr("La copie a échoué : sélectionnez le texte et copiez-le."), true)
    );

  const offres = () => (d ? offresPour(d, texte, { prestations: etat.db.prestations, trajets: etat.db.trajets, nomPartenaire }) : []);
  const offreChoisie = (liste) => liste.find((o) => `${o.genre}:${o.id}` === offreId) || liste[0] || null;
  const clientsConnus = () => (d ? clientsProches(d, etat.db.clients).filter((x) => !refuse.has(x.client.id)) : []);

  // Un client connu par son téléphone est retenu tout de suite ; par son nom seulement, on le propose.
  function retenirClient() {
    const proches = clientsConnus();
    if (clientId && !proches.some((x) => x.client.id === clientId)) clientId = "";
    if (!clientId && proches[0] && proches[0].raison === "telephone") clientId = proches[0].client.id;
    const c = clientId ? etat.db.clients.find((x) => x.id === clientId) : null;
    if (c && !d.hotel && !d.hotelSaisi) d.hotel = hotelDuClient(c);
  }

  function brouillonDossier(offre) {
    const nom = separerNom(d.nom);
    const c = clientId ? etat.db.clients.find((x) => x.id === clientId) : null;
    // Un trajet du site donne ses deux bouts : la prise en charge va sur la réservation, la dépose dans les champs du voucher.
    const transfert = d.type === "transfer";
    const lieu = transfert ? d.pickup || "" : offre && offre.genre === "prestation" && d.hotel && d.hotel !== hotelDuClient(c) ? d.hotel : "";
    return { prenom: nom.prenom, nom: nom.nom, telephone: d.telephone || "", hotel: d.hotel, client_id: clientId, personnes: { adultes: d.adultes, enfants: d.enfants }, notes: notesDemande(d), lignes: offre ? lignesDe(offre, d, langue, devise) : [], reservation: { heure: d.heure || "", lieu, bebes: d.bebes || 0, dropoff: transfert ? d.dropoff || "" : "", personnes: { adultes: d.adultes, enfants: d.enfants, bebes: d.bebes || 0 }, vol: d.vol || "", bagages: d.bagages || 0 } };
  }

  // Création directe : client, dossier, facture et réservations, sans passer par l'écran « Nouveau dossier ».
  async function creerMaintenant(offre, bouton) {
    erreur.textContent = "";
    const nouveauClient = !clientId;
    if (nouveauClient && !d.nom.trim()) return (erreur.textContent = tr("Indiquez le nom du client.")), document.getElementById("dem-nom").focus();
    if (nouveauClient && !peut("clients.ecrire")) return (erreur.textContent = tr("Votre rôle ne permet pas de créer un client : choisissez un client existant."));
    const b = brouillonDossier(offre);
    const ref = refProposee(regl);
    if (!ref.trim() || refExiste(ref)) return (erreur.textContent = tr("Le numéro de facture n'a pas pu être proposé : créez le dossier depuis « Nouveau dossier »."));
    creation = true;
    bouton.disabled = true;
    bouton.textContent = tr("Création…");
    try {
      const numero = await refDefinitive(ref, ref, regl);
      const dossier = await creerDossierExcursions({ client: clientId ? { id: clientId } : { prenom: b.prenom, nom: b.nom, telephone: b.telephone, hotel: b.hotel, chambre: "" }, lignes: b.lignes, notes: b.notes, ref: numero, reservation: b.reservation });
      garde.ecrire("");
      fermer();
      toast(tr("Dossier {ref} créé.", { ref: dossier.ref }));
      naviguer(`#/dossier/${dossier.id}`);
    } catch (err) {
      erreur.textContent = /duplicate|unique|23505/i.test(err.message) ? tr("Ce numéro existe déjà. Réessayez.") : err.message;
      creation = false;
      bouton.disabled = false;
      dessiner();
    }
  }

  // Ouvre l'écran « Nouveau dossier » déjà rempli, pour vérifier ou compléter avant de créer.
  function verifierAvant(offre) {
    brouillon = brouillonDossier(offre);
    fermer();
    naviguer("#/dossiers/nouveau?demande=1");
  }

  const modifier = (cle, valeur) => {
    d[cle] = valeur;
    if (cle === "hotel") d.hotelSaisi = true;
    maj();
  };
  const entier = (v) => Math.max(0, Math.floor(Number(v) || 0));

  // Champs : posés une fois par message lu.
  function construire() {
    const saisie = (cle, libelle, valeur, surChangement, opts = {}) => {
      const input = h("input", { id: `dem-${cle}`, value: valeur, autocomplete: "off", ...opts, onchange: (e) => surChangement(e.target.value) });
      saisies[cle] = input;
      return champ(libelle, input);
    };
    champs.replaceChildren(
      saisie("nom", tr("Nom du client"), d.nom, (v) => modifier("nom", v.trim())),
      saisie("tel", tr("WhatsApp"), d.telephone || "", (v) => modifier("telephone", v.trim()), { type: "tel", inputmode: "tel", placeholder: "+33 6 00 00 00 00" }),
      saisie("date", tr("Date du service"), d.date || "", (v) => modifier("date", v), { type: "date" }),
      saisie("heure", tr("Heure de pickup"), d.heure || "", (v) => modifier("heure", v), { type: "time" }),
      saisie("ad", tr("Adultes"), String(d.adultes), (v) => modifier("adultes", entier(v)), { type: "number", min: "0", step: "1", inputmode: "numeric" }),
      saisie("enf", tr("Enfants"), String(d.enfants), (v) => modifier("enfants", entier(v)), { type: "number", min: "0", step: "1", inputmode: "numeric" }),
      saisie("hotel", tr("Hôtel"), d.hotel || "", (v) => modifier("hotel", v.trim()), { placeholder: tr("Hotel Sunset, Klong Dao") })
    );
  }

  // Ce qui dépend des champs : client reconnu, offres et prix, boutons.
  function dessiner() {
    dynamique.replaceChildren();
    if (!d) return;
    retenirClient();
    if (saisies.hotel && saisies.hotel.value !== (d.hotel || "")) saisies.hotel.value = d.hotel || "";
    const liste = offres();
    const choisie = offreChoisie(liste);
    const marque = (d.marque || "").toLowerCase();
    const mauvaise = marque && !entiteActive().nom.toLowerCase().includes(marque.split(" ")[0]);
    const sitesLignes = lignesSite(d);
    const proches = clientsConnus();
    const connu = clientId ? etat.db.clients.find((x) => x.id === clientId) : null;
    const propose = !connu ? proches.find((x) => x.raison === "nom") : null;
    const sansQte = d.date && d.adultes + d.enfants > 0;

    dynamique.append(
      ...[
        mauvaise ? h("p", { class: "bandeau-info", role: "status" }, tr("Cette demande est adressée à {marque}. Changez d'entreprise en haut de l'écran pour utiliser sa base de prix.", { marque: d.marque })) : null,
        d.siegeEnfant || d.siegeBebe || d.bebes ? h("p", { class: "aide" }, [d.bebes ? tr("{n} bébé : noté dans le dossier.", { n: d.bebes }) : "", d.siegeEnfant ? tr("Siège enfant demandé.") : "", d.siegeBebe ? tr("Siège bébé demandé.") : ""].filter(Boolean).join(" ")) : null,
        sitesLignes.length ? h("ul", { class: "demande-site" }, sitesLignes.map((l) => h("li", null, l))) : null,
        connu
          ? h("p", { class: "demande-client connu", role: "status" }, h("span", null, tr("Client déjà connu : {nom}", { nom: nomClient(connu) }), connu.telephone ? ` · ${connu.telephone}` : ""), h("button", { class: "lien", type: "button", onclick: () => (refuse.add(connu.id), (clientId = ""), !d.hotelSaisi && d.hotel === hotelDuClient(connu) && (d.hotel = ""), maj()) }, tr("Nouveau client")))
          : propose
            ? h("p", { class: "demande-client", role: "status" }, h("span", null, tr("Un client porte le même nom : {nom}", { nom: nomClient(propose.client) }), propose.client.telephone ? ` · ${propose.client.telephone}` : ""), h("button", { class: "secondaire petit", type: "button", onclick: () => ((clientId = propose.client.id), maj()) }, tr("C'est lui")))
            : d.nom
              ? h("p", { class: "aide" }, tr("Nouveau client : il sera créé avec le dossier."))
              : null,
        liste.length
          ? h(
              "ul",
              { class: "choix-liste demande-offres", role: "radiogroup", "aria-label": tr("Service proposé") },
              liste.map((o) =>
                h(
                  "li",
                  null,
                  h(
                    "button",
                    { class: "demande-offre", type: "button", role: "radio", "aria-checked": o === choisie ? "true" : "false", onclick: () => ((offreId = `${o.genre}:${o.id}`), dessiner()) },
                    h("span", { class: "choix-texte" }, h("strong", null, o.titre), h("span", null, o.detail), o.avertissement && AVERTISSEMENTS[o.avertissement] ? h("span", { class: "demande-attention" }, tr(AVERTISSEMENTS[o.avertissement])) : null),
                    h("span", { class: "choix-prix" }, h("strong", null, o.total === null ? "-" : formatMontant(o.total, devise)))
                  )
                )
              )
            )
          : h("p", { class: "vide-court" }, tr("Rien ne correspond dans la base de prix : le dossier se crée sans service, à compléter ensuite."))
      ].filter(Boolean)
    );

    const ecrit = peut("dossiers.ecrire");
    const tel = chiffres(d.telephone);
    const reponse = choisie ? reponsePrix(d, choisie, { devise, compagnie: choisie.source ? nomPartenaire(choisie.source.partenaire_id) : "" }) : "";
    const bouton = h("button", { class: "principal", type: "button", onclick: (e) => creerMaintenant(choisie, e.currentTarget) }, choisie && choisie.total !== null ? tr("Créer le dossier · {montant}", { montant: formatMontant(choisie.total, devise) }) : tr("Créer le dossier"));
    dynamique.append(
      ...[
        erreur,
        d.date && d.date < aujourdhui() ? h("p", { class: "erreur-form" }, tr("La date du service est passée.")) : null,
        !sansQte && choisie ? h("p", { class: "aide" }, tr("Date ou nombre de personnes manquants : le prix et la facture se complètent dans le dossier.")) : null,
        h(
          "div",
          { class: "barre-modal" },
          ...[
            ecrit ? bouton : null,
            choisie
              ? tel
                ? h("a", { class: "bouton secondaire", href: lienWhatsApp(tel, reponse), target: "_blank", rel: "noopener" }, tr("Répondre au client"))
                : h("button", { class: "secondaire", type: "button", onclick: () => copier(reponse) }, tr("Copier la réponse"))
              : null,
            ecrit ? h("button", { class: "lien", type: "button", onclick: () => verifierAvant(choisie) }, tr("Vérifier avant de créer")) : null,
          ].filter(Boolean)
        ),
      ].filter(Boolean)
    );
  }

  // Relire le texte : tout ce qui avait été corrigé à la main est perdu, c'est un autre message.
  function lire(valeur) {
    texte = valeur;
    garde.ecrire(valeur.trim());
    erreur.textContent = "";
    d = texte.trim() ? lireMessage(texte, aujourdhui()) : null;
    offreId = null;
    clientId = "";
    refuse = new Set();
    reconnu.replaceChildren();
    corps.classList.toggle("lu", !!d);
    if (!texte.trim()) return;
    if (!d) return reconnu.append(h("p", { class: "erreur-form", role: "alert" }, tr("Rien de reconnu dans ce texte. Collez le message du client tel qu'il est arrivé sur WhatsApp.")));
    d.hotelSaisi = false;
    construire();
    reconnu.append(champs, dynamique);
    dessiner();
  }
  // Une correction du formulaire recalcule le prix, sans toucher au texte collé.
  function maj() {
    if (creation) return;
    dessiner();
  }

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
    h("p", { class: "aide demande-aide" }, tr("Collez le message du client, tel qu'il est arrivé sur WhatsApp. La date, les personnes, l'hôtel et le service sont reconnus, et le prix vient de la base.")),
    h("div", { class: "champ demande-message" }, h("label", { for: "demande-texte" }, tr("Message du client")), zone),
    h("div", { class: "actions gauche" }, coller, effacer),
    reconnu
  );
  const fermer = modal(tr("Coller une demande"), corps, { large: true, protege: false });

  // Message gardé d'un passage précédent : repris tel quel.
  const reprise = garde.lire();
  if (reprise) {
    zone.value = reprise;
    lire(reprise);
  }
}

