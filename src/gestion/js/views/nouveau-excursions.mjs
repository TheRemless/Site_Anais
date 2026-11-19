// Nouveau dossier en mode excursions (Secret Travel & Tour) : le client, ses services pris dans la base partenaires,
// et la facture créée dans la foulée avec une réservation par service. Pas de devis, pas d'acompte.
import { etat, naviguer, reglages, peut, nomPartenaire, nomClient, clientsProposes } from "../etat.mjs";
import { h, champ, toast, vider, erreurChamp } from "../ui.mjs";
import { formatMontant, formatDate } from "../calc.mjs";
import { descriptionService, personnesTexte } from "../operations-calc.mjs";
import { vide } from "./commun.mjs";
import { selecteurClient } from "./selecteur-client.mjs";
import { choisirPrestation } from "./choix-prestation.mjs";
import { estTaxi } from "../taxi-calc.mjs";
import { prixVenteFige } from "../partenaires-calc.mjs";
import { creerDossierExcursions, langueDocuments, refProposee as refPropose, refExiste, refDefinitive } from "./creation-excursions.mjs";
import { lireBrouillon, viderBrouillon } from "./demande.mjs";
import { clientsProches } from "../demande-calc.mjs";
import { tr } from "../i18n.mjs";
import { identiteDepuisSaisie, verifierNouveauClient } from "../client-calc.mjs";
import { servicesCreation, saisieDepuisDemande, saisieDuService, parServiceCreation, blocOuvert, libelleCourseSuivi, boutsDuTrajet, trajetIncomplet } from "../creation-voucher-calc.mjs";
import { blocServiceCreation, ERREURS_TRAJET } from "./champs-voucher.mjs";
import { ouvrirCourseLibre } from "./course-libre.mjs";

export function nouveauDossierExcursions() {
  if (!peut("dossiers.ecrire")) return vide(tr("Accès réservé"), tr("Votre rôle ne permet pas de créer un dossier."), h("a", { class: "bouton secondaire", href: "#/dossiers" }, tr("Retour aux dossiers")));
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const regl = reglages();
  const langue = langueDocuments(regl);
  // Taxi : pas de facture, une course payée au chauffeur ; les mots de l'écran le disent.
  const taxi = estTaxi(regl);
  // Une demande collée peut avoir reconnu un client déjà connu.
  const demande = params.get("demande") ? lireBrouillon() : null;
  const selClient = selecteurClient({ valeur: params.get("client") || (demande && demande.client_id) || "", avecNouveau: peut("clients.ecrire"), surChangement: () => majClient() });
  const nvPrenom = h("input", { id: "prenom", autocomplete: "given-name" });
  const nvNom = h("input", { id: "nom", autocomplete: "family-name" });
  const nvTel = h("input", { id: "tel", type: "tel", inputmode: "tel", autocomplete: "off", placeholder: "+33 6 00 00 00 00" });
  const nvHotel = h("input", { id: "hotel", autocomplete: "off", placeholder: tr("Hotel Sunset, Klong Dao") });
  const nvChambre = h("input", { id: "chambre", autocomplete: "off" });
  const blocNouveau = h("div", { class: "grille-form" }, champ(tr("Prénom"), nvPrenom), champ(tr("Nom"), nvNom), champ(tr("WhatsApp"), nvTel), champ(tr("Hôtel"), nvHotel), champ(tr("Chambre"), nvChambre));
  // Un client qui existe déjà (même téléphone ou même nom) : on le propose avant d'en créer un second.
  const doublon = h("p", { class: "demande-client", role: "status", hidden: true });
  const chercherDoublon = () => {
    const x = clientsProches({ nom: [nvPrenom.value, nvNom.value].filter(Boolean).join(" "), telephone: nvTel.value }, clientsProposes())[0];
    doublon.hidden = !x;
    if (!x) return;
    doublon.replaceChildren(h("span", null, x.raison === "telephone" ? tr("Ce numéro est déjà celui de {nom}.", { nom: nomClient(x.client) }) : tr("Un client porte déjà ce nom : {nom}.", { nom: nomClient(x.client) })), h("button", { class: "secondaire petit", type: "button", onclick: () => selClient.choisirId(x.client.id) }, tr("Utiliser ce client")));
  };
  for (const i of [nvPrenom, nvNom, nvTel]) i.addEventListener("input", chercherDoublon);
  const majClient = () => {
    blocNouveau.hidden = !selClient.nouveau;
    if (!selClient.nouveau) return void (doublon.hidden = true);
    // Le nom tapé dans la recherche est repris (prénom et nom séparés), sans écraser ce qui est déjà écrit dans ces champs.
    if (!nvPrenom.value && !nvNom.value && selClient.texteSaisi) {
      const id = identiteDepuisSaisie(selClient.texteSaisi);
      nvPrenom.value = id.prenom;
      nvNom.value = id.nom;
    }
    chercherDoublon();
  };

  // Demande collée : le client, l'hôtel et les services sont déjà remplis, il reste à vérifier et à créer.
  if (demande && !demande.client_id) {
    selClient.nouveauClient();
    nvPrenom.value = demande.prenom;
    nvNom.value = demande.nom;
    nvTel.value = demande.telephone || "";
    nvHotel.value = demande.hotel;
  }
  const lignes = demande ? [...demande.lignes] : [];
  // Ce que chaque service portera sur sa réservation et son voucher (heure, lieu de pickup, drop-off, vol, remarques…), rangé sous une de ses
  // lignes. Une demande collée en a déjà lu une partie : prérempli, et modifiable.
  const saisies = new Map();
  if (demande) for (const e of demande.parService || (demande.reservation ? [{ ...demande.reservation, ligneIds: lignes.map((l) => l.id) }] : [])) if (e.ligneIds && e.ligneIds.length) saisies.set(e.ligneIds[0], saisieDepuisDemande(e));
  const services = () => servicesCreation(lignes, { prestations: etat.db.prestations, partenaires: etat.db.partenaires, trajets: etat.db.trajets });
  // Courses Taxi hors catalogue : leur libellé suit le pickup et le drop-off, tant qu'il n'a pas été réécrit à la main (`description_fixe`).
  // Le service ajouté en dernier reste déplié sur téléphone.
  const coursesLibres = new Set();
  let dernierAjout = null;
  const telephone = () => !!(window.matchMedia && window.matchMedia("(max-width: 719px)").matches);
  const suivreCourse = (sv) => (s) => {
    for (const l of lignes.filter((x) => coursesLibres.has(x.id) && !x.description_fixe && sv.ligneIds.includes(x.id))) {
      const nouveau = libelleCourseSuivi(l, s);
      if (!nouveau) continue;
      l.titre = l.libelle = nouveau;
      const i = lignes.indexOf(l);
      const titre = document.getElementById(`s${i}-titre`);
      if (titre) titre.textContent = nouveau;
      const desc = document.getElementById(`s${i}-desc`);
      if (desc) desc.value = descriptionService({ ...l, libelle: nouveau }, langue);
    }
  };
  // Adultes et enfants du dossier (Secret, contrôle du 17.11.2026, D8) : le prix enfant et le nombre de personnes servent dès l'ajout d'un service,
  // et un service sans tarif enfant ou par véhicule compte les enfants du dossier. Une demande collée les préremplit.
  const pDemande = (demande && demande.personnes) || {};
  const nbAdultes = h("input", { id: "nd-adultes", type: "number", min: "0", step: "1", inputmode: "numeric", value: pDemande.adultes ?? "" });
  const nbEnfants = h("input", { id: "nd-enfants", type: "number", min: "0", step: "1", inputmode: "numeric", value: pDemande.enfants ?? "" });
  const personnesSaisies = () => {
    const a = Math.max(0, Math.floor(Number(nbAdultes.value) || 0));
    const e = Math.max(0, Math.floor(Number(nbEnfants.value) || 0));
    return taxi || !(a + e) ? null : { adultes: a, enfants: e };
  };
  // Le service suivant se fait en général le même jour et pour les mêmes personnes que le précédent.
  const defautsAjout = () => {
    const l = [...lignes].reverse().find((x) => x.date_service);
    return { date: l ? l.date_service : "", ...(demande && demande.personnes ? demande.personnes : {}), ...(personnesSaisies() || {}) };
  };
  // Service hors catalogue à prix de groupe (18.11.2026) : pas de quantité, le prix est le total ; ses participants restent modifiables.
  const parGroupeLibre = (l) => !!l.libre && l.par === "grp";
  // Prix par personne hors catalogue : la quantité suit les participants tant qu'elle était leur nombre.
  const changerParticipants = (l, cle, valeur) => {
    const avant = { adultes: 0, enfants: 0, ...(l.personnes || {}) };
    const apres = { ...avant, [cle]: Math.max(0, Math.floor(Number(valeur) || 0)) };
    if (l.par === "pp" && Number(l.qte) === avant.adultes + avant.enfants && apres.adultes + apres.enfants > 0) l.qte = apres.adultes + apres.enfants;
    if (apres.adultes + apres.enfants) l.personnes = { adultes: apres.adultes, enfants: apres.enfants };
    else delete l.personnes;
    dessiner();
  };
  const liste = h("div");
  const total = h("p", { class: "total-edition" });
  function dessiner() {
    vider(liste);
    if (!lignes.length) liste.append(h("p", { class: "vide-court" }, taxi ? tr("Aucune course pour l'instant. Ajoutez une course du catalogue, ou une course hors catalogue avec son pickup et son drop-off.") : tr("Aucun service pour l'instant. Ajoutez une excursion, un transfert ou une activité de la base partenaires.")));
    // La description sur la facture se recalcule (prestation, personnes, date) tant qu'elle n'a pas été corrigée à la main.
    const description = (l) => (l.description_fixe ? l.description : descriptionService({ ...l, libelle: l.titre || l.libelle }, langue));
    // Le bloc du voucher se pose sous la première ligne du service (une ligne enfant partage celui de sa ligne adulte).
    const tous = services();
    const parLigne = new Map(tous.map((sv) => [sv.cle, sv]));
    const blocVoucher = (l) => {
      const sv = parLigne.get(l.id);
      if (!sv) return null;
      // Taxi : le pickup et le drop-off montrent d'emblée les deux bouts du trajet, ce que la Booking confirmation imprimera.
      const saisie = saisieDuService(saisies, sv);
      if (taxi) boutsDuTrajet(saisie, sv);
      return blocServiceCreation({ service: sv, saisie, taxi, prefixe: `s-${l.id}`, aideLieu: tr("Vide : l'adresse du client."), ouvert: blocOuvert({ telephone: telephone(), nbServices: tous.length, service: sv, dernier: dernierAjout }), surSaisie: suivreCourse(sv) });
    };
    lignes.forEach((l, i) =>
      liste.append(
        h(
          "div",
          { class: "carte-ligne" },
          h("div", { class: "carte-ligne-tete" }, h("strong", { id: `s${i}-titre` }, l.kind === "texte" ? tr("Note") : l.titre || l.libelle), h("span", { class: "calc" }, l.kind === "texte" ? "" : formatMontant((Number(l.unite) || 0) * (Number(l.qte) || 0))), h("span", { class: "outils" }, h("button", { class: "lien danger-texte", type: "button", onclick: () => (lignes.splice(i, 1), dessiner()) }, tr("Retirer")))),
          l.kind === "texte"
            ? h("p", { class: "aide" }, l.libelle)
            : [
                h("div", { class: "grille-form compacte" }, champ(tr("Date du service"), h("input", { id: `s${i}-d`, type: "date", value: l.date_service || "", onchange: (e) => ((l.date_service = e.target.value || null), dessiner()) })), parGroupeLibre(l) ? null : champ(tr("Quantité"), h("input", { id: `s${i}-q`, type: "number", min: "1", step: "1", inputmode: "numeric", value: l.qte, onchange: (e) => ((l.qte = Number(e.target.value) || 1), dessiner()) })), champ(parGroupeLibre(l) ? tr("Prix du groupe ({devise})", { devise: regl.devise }) : tr("Prix ({devise})", { devise: regl.devise }), h("input", { id: `s${i}-p`, type: "number", min: "0", step: "1", inputmode: "numeric", value: l.unite ?? "", disabled: prixVenteFige(l, etat.db, { droitPrix: peut("partenaires.prix") }), title: prixVenteFige(l, etat.db, { droitPrix: peut("partenaires.prix") }) ? tr("Prix du catalogue : votre rôle ne permet pas de le changer.") : null, onchange: (e) => ((l.unite = e.target.value === "" ? null : Number(e.target.value)), dessiner()) }))),
                l.libre && l.par ? h("div", { class: "grille-form compacte" }, champ(tr("Adultes"), h("input", { id: `s${i}-a`, type: "number", min: "0", step: "1", inputmode: "numeric", value: (l.personnes && l.personnes.adultes) || 0, onchange: (e) => changerParticipants(l, "adultes", e.target.value) })), champ(tr("Enfants"), h("input", { id: `s${i}-e`, type: "number", min: "0", step: "1", inputmode: "numeric", value: (l.personnes && l.personnes.enfants) || 0, onchange: (e) => changerParticipants(l, "enfants", e.target.value) }))) : null,
                champ(taxi ? tr("Libellé de la course") : tr("Description sur la facture"), h("input", { id: `s${i}-desc`, value: description(l), oninput: (e) => ((l.description = e.target.value), (l.description_fixe = true)) }), [l.partenaire_id ? nomPartenaire(l.partenaire_id) : "", tr("Texte vu par le client, en anglais. Modifiable.")].filter(Boolean).join(" · ")),
                blocVoucher(l),
              ]
        )
      )
    );
    const somme = lignes.filter((l) => l.kind !== "texte").reduce((s, l) => s + (Number(l.unite) || 0) * (Number(l.qte) || 0), 0);
    total.textContent = !lignes.length ? "" : taxi ? tr("Prix de la course : {montant}, payé au chauffeur", { montant: formatMontant(somme) }) : tr("Total de la facture : {montant}", { montant: formatMontant(somme) });
  }
  dessiner();

  const ref = h("input", { id: "ref", value: refPropose(regl) });
  const refProposee = ref.value;
  // Note interne du dossier (`dossiers.notes`, 19.11.2026) : la même que « Coller une confirmation » et l'écran de Mook, jamais imprimée.
  const notes = h("textarea", { id: "notes", rows: 2, placeholder: tr("Vol, allergies, demande particulière") });
  if (demande) notes.value = demande.notes;
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const libelleCreer = () => (taxi ? tr("Créer la réservation") : tr("Créer la facture"));
  const bouton = h("button", { class: "principal", type: "submit" }, libelleCreer());

  async function creer(e) {
    e.preventDefault();
    erreur.textContent = "";
    if (!selClient.valeur && !selClient.nouveau) return (erreur.textContent = tr("Choisissez un client, ou créez-en un.")), document.getElementById("client").focus();
    if (selClient.nouveau && !nvNom.value.trim()) return (erreur.textContent = tr("Indiquez le nom du client.")), nvNom.focus();
    // Le téléphone garde la règle des fiches client : indicatif obligatoire (+41, +33, +66…), jamais deviné. Sans lui, pas de bouton WhatsApp.
    erreurChamp(nvTel, "");
    if (selClient.nouveau) {
      const verif = verifierNouveauClient({ nom: nvNom.value, telephone: nvTel.value });
      if (!verif.ok && verif.champ === "telephone") return erreurChamp(nvTel, verif.raison === "sans_indicatif" ? tr("Ajoutez l'indicatif du pays, par exemple +41, +33 ou +66, à la place du 0 du début.") : tr("Numéro illisible : écrivez-le avec son indicatif, par exemple +41 79 123 45 67.")), nvTel.focus();
    }
    if (!lignes.some((l) => l.kind !== "texte")) return (erreur.textContent = tr("Ajoutez au moins un service."));
    if (!ref.value.trim()) return (erreur.textContent = taxi ? tr("Indiquez le numéro de réservation.") : tr("Indiquez le numéro de facture."));
    if (refExiste(ref.value)) return (erreur.textContent = tr("Ce numéro existe déjà. Modifiez-le.")), ref.focus();
    // Retour au point de départ sans programme (ou durée illisible) : le service se déplie et le champ prend le focus.
    const incomplet = trajetIncomplet(parServiceCreation(services(), saisies));
    if (incomplet) {
      erreur.textContent = tr(ERREURS_TRAJET[incomplet.code]);
      const cle = incomplet.ligneIds.find((id) => document.getElementById(`s-${id}-${incomplet.champ === "duree_h" ? "duree-h" : "programme-trajet"}`)) || incomplet.ligneIds[0];
      const champ_ = document.getElementById(`s-${cle}-${incomplet.champ === "duree_h" ? "duree-h" : "programme-trajet"}`);
      if (champ_) {
        const bloc = champ_.closest("details");
        if (bloc) bloc.open = true;
        champ_.focus();
      }
      return;
    }
    bouton.disabled = true;
    bouton.textContent = tr("Création…");
    try {
      ref.value = await refDefinitive(ref.value, refProposee, regl);
      const d = await creerDossierExcursions({ client: selClient.valeur ? { id: selClient.valeur } : { prenom: nvPrenom.value, nom: nvNom.value, telephone: nvTel.value, hotel: nvHotel.value, chambre: nvChambre.value }, lignes, notes: notes.value, ref: ref.value, parService: parServiceCreation(services(), saisies), personnes: personnesSaisies() });
      viderBrouillon();
      naviguer(`#/dossier/${d.id}`);
    } catch (err) {
      erreur.textContent = /duplicate|unique|23505/i.test(err.message) ? tr("Ce numéro existe déjà. Modifiez-le.") : err.message;
      bouton.disabled = false;
      bouton.textContent = libelleCreer();
    }
  }
  majClient();

  return h(
    "div",
    { "data-titre": tr("Nouveau dossier") },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Nouveau dossier")), h("p", { class: "sous" }, taxi ? tr("Indiquez le client et sa course. La réservation et sa Booking confirmation se créent en même temps.") : tr("Indiquez le client et ses services. Les services et la facture se créent en même temps.")))),
    h(
      "form",
      { class: "formulaire", onsubmit: creer },
      h("fieldset", null, h("legend", null, tr("Client")), selClient.noeud, doublon, blocNouveau),
      h("fieldset", null, h("legend", null, tr("Services")), taxi ? null : h("div", { class: "grille-form compacte" }, champ(tr("Adultes"), nbAdultes), champ(tr("Enfants"), nbEnfants, tr("Le prix enfant du catalogue sert dès l'ajout d'un service."))), liste, h("div", { class: "ajouts" }, h("button", { class: "principal petit", type: "button", onclick: () => choisirPrestation({ langue, devise: regl.devise, sansCompagnie: true, defauts: defautsAjout(), onAjout: (nouvelles) => { nouvelles.forEach((l) => lignes.push({ ...l, titre: l.kind === "texte" ? undefined : l.libelle })); dernierAjout = (nouvelles.find((l) => l.kind !== "texte") || {}).id || dernierAjout; dessiner(); } }) }, taxi ? tr("Course du catalogue") : tr("Ajouter un service")), taxi ? h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrirCourseLibre({ date: defautsAjout().date, onAjout: ({ ligne, saisie }) => { lignes.push(ligne); saisies.set(ligne.id, saisie); coursesLibres.add(ligne.id); dernierAjout = ligne.id; dessiner(); } }) }, tr("Course hors catalogue")) : null), total),
      h("fieldset", null, h("legend", null, taxi ? tr("Réservation") : tr("Facture")), h("div", { class: "grille-form" }, champ(tr("Numéro"), ref, tr("Numéro suivant de l'année pour cette entreprise, modifiable.")), champ(tr("Note interne du dossier (jamais imprimée)"), notes, taxi ? tr("La remarque imprimée sur la Booking confirmation se saisit avec chaque course.") : tr("La remarque imprimée sur le voucher se saisit avec chaque service.")))),
      erreur,
      h("div", { class: "actions" }, h("a", { class: "bouton secondaire", href: "#/dossiers" }, tr("Annuler")), bouton)
    )
  );
}

export { personnesTexte, formatDate };
