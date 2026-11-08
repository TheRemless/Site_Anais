// Nouveau dossier en mode excursions (Secret Travel & Tour) : le client, ses services pris dans la base partenaires,
// et la facture créée dans la foulée avec une réservation par service. Pas de devis, pas d'acompte.
import { etat, inserer, naviguer, reglages, peut, nomPartenaire, numeroSuivant } from "../etat.mjs";
import { h, champ, toast, vider } from "../ui.mjs";
import { formatMontant, formatDate, aujourdhui, nouvelleRef, sequenceRef, refDepuisNumero } from "../calc.mjs";
import { CONTENU_DEFAUT } from "../defauts.mjs";
import { descriptionService, personnesTexte } from "../operations-calc.mjs";
import { vide } from "./commun.mjs";
import { selecteurClient } from "./selecteur-client.mjs";
import { choisirPrestation } from "./choix-prestation.mjs";
import { creerReservations } from "./reservations.mjs";
import { prendreBrouillon } from "./demande.mjs";
import { tr } from "../i18n.mjs";

export function nouveauDossierExcursions() {
  if (!peut("dossiers.ecrire")) return vide(tr("Accès réservé"), tr("Votre rôle ne permet pas de créer un dossier."), h("a", { class: "bouton secondaire", href: "#/dossiers" }, tr("Retour aux dossiers")));
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const regl = reglages();
  // Les factures de Secret sont en anglais : les libellés anglais des prestations sont pris quand ils existent.
  const langue = /invoice/i.test((regl.libelles && regl.libelles.facture) || "") ? "en" : "";
  const selClient = selecteurClient({ valeur: params.get("client") || "", avecNouveau: peut("clients.ecrire"), surChangement: () => majClient() });
  const nvPrenom = h("input", { id: "prenom", autocomplete: "off" });
  const nvNom = h("input", { id: "nom", autocomplete: "off" });
  const nvTel = h("input", { id: "tel", type: "tel", autocomplete: "off", placeholder: "+33 6 00 00 00 00" });
  const nvHotel = h("input", { id: "hotel", autocomplete: "off", placeholder: tr("Hotel Sunset, Klong Dao") });
  const nvChambre = h("input", { id: "chambre", autocomplete: "off" });
  const blocNouveau = h("div", { class: "grille-form" }, champ(tr("Prénom"), nvPrenom), champ(tr("Nom"), nvNom), champ(tr("WhatsApp"), nvTel), champ(tr("Hôtel"), nvHotel), champ(tr("Chambre"), nvChambre));
  const majClient = () => (blocNouveau.hidden = !selClient.nouveau);

  // Demande collée : le client, l'hôtel et les services sont déjà remplis, il reste à vérifier et à créer.
  const demande = prendreBrouillon();
  if (demande) {
    selClient.nouveauClient();
    nvPrenom.value = demande.prenom;
    nvNom.value = demande.nom;
    nvHotel.value = demande.hotel;
  }
  const lignes = demande ? [...demande.lignes] : [];
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
                h("div", { class: "grille-form compacte" }, champ(tr("Date du service"), h("input", { id: `s${i}-d`, type: "date", value: l.date_service || "", onchange: (e) => ((l.date_service = e.target.value || null), dessiner()) })), champ(tr("Quantité"), h("input", { id: `s${i}-q`, type: "number", min: "1", step: "1", value: l.qte, onchange: (e) => ((l.qte = Number(e.target.value) || 1), dessiner()) })), champ(tr("Prix ({devise})", { devise: regl.devise }), h("input", { id: `s${i}-p`, type: "number", min: "0", step: "1", value: l.unite ?? "", onchange: (e) => ((l.unite = e.target.value === "" ? null : Number(e.target.value)), dessiner()) }))),
                champ(tr("Description sur la facture"), h("input", { id: `s${i}-desc`, value: description(l), oninput: (e) => ((l.description = e.target.value), (l.description_fixe = true)) }), [l.partenaire_id ? nomPartenaire(l.partenaire_id) : "", "Texte vu par le client, en anglais. Modifiable."].filter(Boolean).join(" · ")),
              ]
        )
      )
    );
    const somme = lignes.filter((l) => l.kind !== "texte").reduce((s, l) => s + (Number(l.unite) || 0) * (Number(l.qte) || 0), 0);
    total.textContent = lignes.length ? tr("Total de la facture : {montant}", { montant: formatMontant(somme) }) : "";
  }
  dessiner();

  const ref = h("input", { id: "ref", value: nouvelleRef({ numerotation: regl.numerotation, prenom: "", nom: "", dateIso: aujourdhui(), pays: "", refsExistantes: etat.db.dossiers.map((d) => d.ref) }) || "" });
  const refProposee = ref.value;
  const notes = h("textarea", { id: "notes", rows: 2, placeholder: tr("Vol, allergies, demande particulière") });
  if (demande) notes.value = demande.notes;
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const bouton = h("button", { class: "principal", type: "submit" }, tr("Créer la facture"));

  async function creer(e) {
    e.preventDefault();
    erreur.textContent = "";
    if (!selClient.valeur && !selClient.nouveau) return (erreur.textContent = tr("Choisissez un client, ou créez-en un.")), document.getElementById("client").focus();
    if (selClient.nouveau && !nvNom.value.trim()) return (erreur.textContent = tr("Indiquez le nom du client.")), nvNom.focus();
    if (!lignes.some((l) => l.kind !== "texte")) return (erreur.textContent = tr("Ajoutez au moins un service."));
    if (!ref.value.trim()) return (erreur.textContent = tr("Indiquez le numéro de facture."));
    if (etat.db.dossiers.some((d) => d.ref === ref.value.trim())) return (erreur.textContent = tr("Ce numéro existe déjà. Modifiez-le.")), ref.focus();
    bouton.disabled = true;
    bouton.textContent = tr("Création…");
    try {
      // Numéro de facture non modifié à la main : le numéro définitif vient de la base, qui ne le redonne jamais.
      if (ref.value === refProposee && regl.numerotation.mode === "sequence") {
        const s = sequenceRef({ numerotation: regl.numerotation, dateIso: aujourdhui(), refsExistantes: etat.db.dossiers.map((x) => x.ref) });
        ref.value = refDepuisNumero(regl.numerotation, s.debut, await numeroSuivant(s.annee, s.dernier));
      }
      let clientId = selClient.valeur;
      if (!clientId) {
        const adresse = [nvHotel.value.trim(), nvChambre.value.trim() ? `Room ${nvChambre.value.trim()}` : ""].filter(Boolean).join(", ");
        const c = await inserer("clients", { civilite: "", prenom: nvPrenom.value.trim(), nom: nvNom.value.trim(), adresse, telephone: nvTel.value.trim(), email: "", notes: "" });
        clientId = c.id;
      }
      const dates = lignes.map((l) => l.date_service).filter(Boolean).sort();
      const services = lignes.filter((l) => l.kind !== "texte");
      const partenaires = [...new Set(services.map((l) => nomPartenaire(l.partenaire_id)).filter(Boolean))];
      const d = await inserer("dossiers", { ref: ref.value.trim(), client_id: clientId, pays: "", bandeau: services.map((l) => l.libelle).join(" · ").slice(0, 120), date_depart: dates[0] || null, date_retour: dates.length > 1 ? dates[dates.length - 1] : null, accepte_le: aujourdhui(), annule: false, notes: notes.value.trim() });
      const contenu = { ...CONTENU_DEFAUT(), bandeau: "", colonnes: "total", langue, prestataire: partenaires.join(", "), variante: (regl.textes.variantes[0] || {}).id || "", equivalents: { actif: false }, lignes: lignes.map(({ description, description_fixe, ...l }) => ({ ...l, titre: l.kind === "texte" ? undefined : l.titre, libelle: l.kind === "texte" ? l.libelle : (description_fixe && description.trim()) || descriptionService({ ...l, libelle: l.titre }, langue), intro: "" })) };
      const doc = await inserer("documents", { dossier_id: d.id, type: "facture", date_emission: aujourdhui(), envoye_le: null, updated_at: new Date().toISOString(), contenu });
      await creerReservations(doc);
      naviguer(`#/dossier/${d.id}`);
    } catch (err) {
      erreur.textContent = /duplicate|unique|23505/i.test(err.message) ? tr("Ce numéro existe déjà. Modifiez-le.") : err.message;
      bouton.disabled = false;
      bouton.textContent = tr("Créer la facture");
    }
  }
  majClient();

  return h(
    "div",
    { "data-titre": tr("Nouveau dossier") },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Nouveau dossier")), h("p", { class: "sous" }, tr("Indiquez le client et ses services. La facture et les réservations auprès des partenaires se créent en même temps.")))),
    h(
      "form",
      { class: "formulaire", onsubmit: creer },
      h("fieldset", null, h("legend", null, tr("Client")), selClient.noeud, blocNouveau),
      h("fieldset", null, h("legend", null, tr("Services")), liste, h("div", { class: "ajouts" }, h("button", { class: "principal petit", type: "button", onclick: () => choisirPrestation({ langue, devise: regl.devise, sansCompagnie: true, onAjout: (nouvelles) => { nouvelles.forEach((l) => lignes.push({ ...l, titre: l.kind === "texte" ? undefined : l.libelle })); dessiner(); } }) }, tr("Ajouter un service"))), total),
      h("fieldset", null, h("legend", null, tr("Facture")), h("div", { class: "grille-form" }, champ(tr("Numéro"), ref, tr("Numéro suivant de l'année pour cette entreprise, modifiable.")), champ(tr("Notes internes"), notes))),
      erreur,
      h("div", { class: "actions" }, h("a", { class: "bouton secondaire", href: "#/dossiers" }, tr("Annuler")), bouton)
    )
  );
}

export { personnesTexte, formatDate };
