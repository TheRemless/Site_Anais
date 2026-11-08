// « Coller une demande » : le client écrit à Anaïs depuis le formulaire du site, le message arrive sur WhatsApp. On le colle ici :
// l'outil le lit, cherche le prix dans la base partenaires, prépare la réponse à envoyer, et crée le dossier déjà rempli quand le client dit oui.
import { etat, entiteActive, reglages, nomPartenaire, netPrestation, netTrajet, peut, naviguer } from "../etat.mjs";
import { h, modal, toast } from "../ui.mjs";
import { aujourdhui, formatMontant } from "../calc.mjs";
import { lireDemande, proposerOffres, reponsePrix, notesDemande, separerNom } from "../demande-calc.mjs";
import { lignesDepuisTrajet, ligneDepuisPrestation } from "../partenaires-calc.mjs";
import { personnesTexte, dateTexte } from "../operations-calc.mjs";
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
};

// Quantité d'une prestation selon son unité (les bébés ne comptent pas).
const quantite = (p, d) => (p.unite === "pp" ? d.adultes + d.enfants : p.unite === "ad" ? d.adultes : p.unite === "ch" ? d.enfants : 1) || 1;

function lignesDe(offre, d, langue, devise) {
  if (offre.genre === "trajet") return lignesDepuisTrajet(offre.source, netTrajet(offre.source), { langue, date: d.date, adultes: d.adultes || (d.enfants ? 0 : 1), enfants: d.enfants, compagnie: "" });
  return [ligneDepuisPrestation(offre.source, netPrestation(offre.source), { langue, date: d.date, qte: quantite(offre.source, d), devise })];
}

export function ouvrirDemande() {
  const regl = reglages();
  const devise = regl.devise || "THB";
  // Les documents de Secret sont en anglais : les libellés anglais des prestations sont pris quand ils existent.
  const langue = /invoice/i.test((regl.libelles && regl.libelles.facture) || "") ? "en" : "";
  const zone = h("textarea", { id: "demande-texte", rows: 7, placeholder: "Hi Secret Travel & Tour!\nI'd like a price for a transfer.\nName: …", oninput: () => lire() });
  const resultat = h("div", { class: "demande-resultat", "aria-live": "polite" });

  function copier(texte) {
    return navigator.clipboard.writeText(texte).then(
      () => toast(tr("Réponse copiée : collez-la dans WhatsApp.")),
      () => toast(tr("La copie a échoué : sélectionnez le texte et copiez-le."), true)
    );
  }

  function creer(d, offre) {
    const nom = separerNom(d.nom);
    brouillon = {
      prenom: nom.prenom,
      nom: nom.nom,
      hotel: d.hotel,
      notes: notesDemande(d),
      lignes: offre ? lignesDe(offre, d, langue, devise) : [],
    };
    fermer();
    naviguer("#/dossiers/nouveau?demande=1");
  }

  function lire() {
    resultat.replaceChildren();
    const d = lireDemande(zone.value, aujourdhui());
    if (!zone.value.trim()) return;
    if (!d) return resultat.append(h("p", { class: "erreur-form", role: "alert" }, tr("Ce texte ne ressemble pas à une demande du site. Collez le message tel qu'il est arrivé sur WhatsApp.")));
    const marque = (d.marque || "").toLowerCase();
    const mauvaise = marque && !entiteActive().nom.toLowerCase().includes(marque.split(" ")[0]);
    const offres = proposerOffres(d, { prestations: etat.db.prestations, trajets: etat.db.trajets, nomPartenaire });
    const quoi = d.type === "transfer" || (d.de && d.vers) ? `${d.de || "?"} → ${d.vers || "?"}` : d.prestation;
    const recap = [d.nom, quoi, d.date ? dateTexte(d.date, "fr") : d.dateTexte, d.heure, personnesTexte({ adultes: d.adultes, enfants: d.enfants, bebes: d.bebes }), d.hotel].filter(Boolean).join(" · ");
    resultat.append(
      ...[
      mauvaise ? h("p", { class: "bandeau-info", role: "status" }, tr("Cette demande est adressée à {marque}. Changez d'entreprise en haut de l'écran pour utiliser sa base de prix.", { marque: d.marque })) : null,
      h("p", { class: "demande-recap" }, h("strong", null, recap)),
      d.siegeEnfant || d.siegeBebe ? h("p", { class: "aide" }, [d.siegeEnfant ? tr("Siège enfant demandé.") : "", d.siegeBebe ? tr("Siège bébé demandé.") : ""].filter(Boolean).join(" ")) : null,
      offres.length
        ? h(
            "ul",
            { class: "choix-liste" },
            offres.map((o) =>
              h(
                "li",
                { class: "choix" },
                h("div", { class: "choix-texte" }, h("strong", null, o.titre), h("span", null, o.detail), o.avertissement && AVERTISSEMENTS[o.avertissement] ? h("span", { class: "demande-attention" }, tr(AVERTISSEMENTS[o.avertissement])) : null),
                h("div", { class: "choix-prix" }, h("strong", null, o.total === null ? "-" : formatMontant(o.total, devise))),
                h(
                  "div",
                  { class: "choix-actions" },
                  h("button", { class: "secondaire petit", type: "button", onclick: () => copier(reponsePrix(d, o, { devise })) }, tr("Copier la réponse")),
                  peut("dossiers.ecrire") ? h("button", { class: "principal petit", type: "button", onclick: () => creer(d, o) }, tr("Créer le dossier")) : null
                )
              )
            )
          )
        : h("p", { class: "vide-court" }, tr("Rien ne correspond dans la base de prix : cherchez à la main dans les tarifs ou les trajets."), peut("dossiers.ecrire") ? h("span", null, " ", h("button", { class: "lien", type: "button", onclick: () => creer(d, null) }, tr("Créer le dossier sans service"))) : null)
      ].filter(Boolean)
    );
  }

  const coller = h("button", { class: "secondaire", type: "button", onclick: async () => {
    try {
      zone.value = await navigator.clipboard.readText();
      lire();
    } catch {
      toast(tr("Le navigateur ne permet pas de coller d'un geste : collez dans le cadre avec un appui long."), true);
    }
  } }, tr("Coller"));
  const fermer = modal(tr("Coller une demande"), h("div", { class: "modal-corps demande" }, h("p", { class: "aide" }, tr("Collez le message que le client a envoyé depuis le formulaire du site. L'outil cherche le prix dans la base et prépare la réponse.")), h("div", { class: "champ" }, h("label", { for: "demande-texte" }, tr("Message du client")), zone), h("div", { class: "actions gauche" }, coller), resultat), { large: true });
}
