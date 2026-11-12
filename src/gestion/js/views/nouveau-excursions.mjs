// Nouveau dossier en mode excursions (Secret Travel & Tour) : le client, ses services pris dans la base partenaires,
// et la facture créée dans la foulée avec une réservation par service. Pas de devis, pas d'acompte.
import { etat, naviguer, reglages, peut, nomPartenaire, nomClient } from "../etat.mjs";
import { h, champ, toast, vider } from "../ui.mjs";
import { formatMontant, formatDate } from "../calc.mjs";
import { descriptionService, personnesTexte } from "../operations-calc.mjs";
import { vide } from "./commun.mjs";
import { selecteurClient } from "./selecteur-client.mjs";
import { choisirPrestation } from "./choix-prestation.mjs";
import { estTaxi } from "../taxi-calc.mjs";
import { creerDossierExcursions, langueDocuments, refProposee as refPropose, refExiste, refDefinitive } from "./creation-excursions.mjs";
import { lireBrouillon, viderBrouillon } from "./demande.mjs";
import { clientsProches } from "../demande-calc.mjs";
import { tr } from "../i18n.mjs";

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
    const x = clientsProches({ nom: [nvPrenom.value, nvNom.value].filter(Boolean).join(" "), telephone: nvTel.value }, etat.db.clients)[0];
    doublon.hidden = !x;
    if (!x) return;
    doublon.replaceChildren(h("span", null, x.raison === "telephone" ? tr("Ce numéro est déjà celui de {nom}.", { nom: nomClient(x.client) }) : tr("Un client porte déjà ce nom : {nom}.", { nom: nomClient(x.client) })), h("button", { class: "secondaire petit", type: "button", onclick: () => selClient.choisirId(x.client.id) }, tr("Utiliser ce client")));
  };
  for (const i of [nvPrenom, nvNom, nvTel]) i.addEventListener("input", chercherDoublon);
  const majClient = () => ((blocNouveau.hidden = !selClient.nouveau), selClient.nouveau ? chercherDoublon() : (doublon.hidden = true));

  // Demande collée : le client, l'hôtel et les services sont déjà remplis, il reste à vérifier et à créer.
  if (demande && !demande.client_id) {
    selClient.nouveauClient();
    nvPrenom.value = demande.prenom;
    nvNom.value = demande.nom;
    nvTel.value = demande.telephone || "";
    nvHotel.value = demande.hotel;
  }
  const lignes = demande ? [...demande.lignes] : [];
  // Le service suivant se fait en général le même jour et pour les mêmes personnes que le précédent.
  const defautsAjout = () => {
    const l = [...lignes].reverse().find((x) => x.date_service);
    return { date: l ? l.date_service : "", ...(demande && demande.personnes ? demande.personnes : {}) };
  };
  const liste = h("div");
  const total = h("p", { class: "total-edition" });
  function dessiner() {
    vider(liste);
    if (!lignes.length) liste.append(h("p", { class: "vide-court" }, tr("Aucun service pour l'instant. Ajoutez une excursion, un transfert ou une activité de la base partenaires.")));
    // La description sur la facture se recalcule (prestation, personnes, date) tant qu'elle n'a pas été corrigée à la main.
    const description = (l) => (l.description_fixe ? l.description : descriptionService({ ...l, libelle: l.titre || l.libelle }, langue));
    lignes.forEach((l, i) =>
      liste.append(
        h(
          "div",
          { class: "carte-ligne" },
          h("div", { class: "carte-ligne-tete" }, h("strong", null, l.kind === "texte" ? tr("Note") : l.titre || l.libelle), h("span", { class: "calc" }, l.kind === "texte" ? "" : formatMontant((Number(l.unite) || 0) * (Number(l.qte) || 0))), h("span", { class: "outils" }, h("button", { class: "lien danger-texte", type: "button", onclick: () => (lignes.splice(i, 1), dessiner()) }, tr("Retirer")))),
          l.kind === "texte"
            ? h("p", { class: "aide" }, l.libelle)
            : [
                h("div", { class: "grille-form compacte" }, champ(tr("Date du service"), h("input", { id: `s${i}-d`, type: "date", value: l.date_service || "", onchange: (e) => ((l.date_service = e.target.value || null), dessiner()) })), champ(tr("Quantité"), h("input", { id: `s${i}-q`, type: "number", min: "1", step: "1", inputmode: "numeric", value: l.qte, onchange: (e) => ((l.qte = Number(e.target.value) || 1), dessiner()) })), champ(tr("Prix ({devise})", { devise: regl.devise }), h("input", { id: `s${i}-p`, type: "number", min: "0", step: "1", inputmode: "numeric", value: l.unite ?? "", onchange: (e) => ((l.unite = e.target.value === "" ? null : Number(e.target.value)), dessiner()) }))),
                champ(taxi ? tr("Libellé de la course") : tr("Description sur la facture"), h("input", { id: `s${i}-desc`, value: description(l), oninput: (e) => ((l.description = e.target.value), (l.description_fixe = true)) }), [l.partenaire_id ? nomPartenaire(l.partenaire_id) : "", "Texte vu par le client, en anglais. Modifiable."].filter(Boolean).join(" · ")),
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
    if (!lignes.some((l) => l.kind !== "texte")) return (erreur.textContent = tr("Ajoutez au moins un service."));
    if (!ref.value.trim()) return (erreur.textContent = taxi ? tr("Indiquez le numéro de réservation.") : tr("Indiquez le numéro de facture."));
    if (refExiste(ref.value)) return (erreur.textContent = tr("Ce numéro existe déjà. Modifiez-le.")), ref.focus();
    bouton.disabled = true;
    bouton.textContent = tr("Création…");
    try {
      ref.value = await refDefinitive(ref.value, refProposee, regl);
      const d = await creerDossierExcursions({ client: selClient.valeur ? { id: selClient.valeur } : { prenom: nvPrenom.value, nom: nvNom.value, telephone: nvTel.value, hotel: nvHotel.value, chambre: nvChambre.value }, lignes, notes: notes.value, ref: ref.value, reservation: demande ? demande.reservation || {} : {}, parService: demande ? demande.parService || null : null });
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
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Nouveau dossier")), h("p", { class: "sous" }, taxi ? tr("Indiquez le client et sa course. La réservation et sa Booking confirmation se créent en même temps.") : tr("Indiquez le client et ses services. La facture et les réservations auprès des partenaires se créent en même temps.")))),
    h(
      "form",
      { class: "formulaire", onsubmit: creer },
      h("fieldset", null, h("legend", null, tr("Client")), selClient.noeud, doublon, blocNouveau),
      h("fieldset", null, h("legend", null, tr("Services")), liste, h("div", { class: "ajouts" }, h("button", { class: "principal petit", type: "button", onclick: () => choisirPrestation({ langue, devise: regl.devise, sansCompagnie: true, defauts: defautsAjout(), onAjout: (nouvelles) => { nouvelles.forEach((l) => lignes.push({ ...l, titre: l.kind === "texte" ? undefined : l.libelle })); dessiner(); } }) }, tr("Ajouter un service"))), total),
      h("fieldset", null, h("legend", null, taxi ? tr("Réservation") : tr("Facture")), h("div", { class: "grille-form" }, champ(tr("Numéro"), ref, tr("Numéro suivant de l'année pour cette entreprise, modifiable.")), champ(tr("Notes internes"), notes))),
      erreur,
      h("div", { class: "actions" }, h("a", { class: "bouton secondaire", href: "#/dossiers" }, tr("Annuler")), bouton)
    )
  );
}

export { personnesTexte, formatDate };
