// Corbeille des devis et factures supprimés seuls (le dossier existe encore) : 90 jours pour les restaurer, avec leurs nets (migration 31).
// Un document parti avec son dossier se restaure avec lui, depuis la corbeille des dossiers.
import { etat, nomClient, naviguer, chargerDossier } from "../etat.mjs";
import { h, toast, confirmer } from "../ui.mjs";
import { formatDate, formatMontant, totaux } from "../calc.mjs";
import { tr, N_ } from "../i18n.mjs";

const NOMS = { devis: N_("Devis"), facture: N_("Facture"), facture_locale: N_("Facture locale") };

export function sectionCorbeilleDocuments() {
  const liste = h("div", null, h("p", { class: "aide" }, tr("Chargement…")));
  const dessiner = async () => {
    let lignes;
    try {
      lignes = await etat.store.documentsSupprimes(etat.entiteId);
    } catch (err) {
      // Sans la migration 31, la fonction n'existe pas encore : on le dit sans bloquer le reste de l'écran.
      liste.replaceChildren(h("p", { class: "aide" }, tr("Corbeille des documents indisponible : {message}", { message: err.message })));
      return;
    }
    if (!lignes.length) return liste.replaceChildren(h("p", { class: "vide-court" }, tr("Aucun devis ni aucune facture supprimé ces 90 derniers jours.")));
    liste.replaceChildren(
      h(
        "ul",
        { class: "cartes" },
        lignes.map((x) => {
          const dossier = etat.db.dossiers.find((d) => d.id === x.dossier_id);
          const client = dossier && etat.db.clients.find((c) => c.id === dossier.client_id);
          const numero = (x.numero || "").trim() || x.ref || "";
          const nom = tr(NOMS[x.type] || NOMS.facture);
          return h(
            "li",
            { class: "carte" },
            h(
              "div",
              { class: "carte-lien statique" },
              h("span", { class: "carte-titre" }, `${nom} ${numero}`.trim()),
              h("span", { class: "carte-droite" }, h("strong", null, x.contenu ? formatMontant(totaux(x.contenu).net, x.devise) : "")),
              h("span", { class: "carte-sous" }, [client ? nomClient(client) : "", tr("émis le {date}", { date: formatDate(x.date_emission) }), x.envoye_le ? tr("envoyé le {date}", { date: formatDate(x.envoye_le) }) : ""].filter(Boolean).join(" · ")),
              h(
                "span",
                { class: "carte-pied" },
                h("span", null, tr("Supprimé le {date}", { date: formatDate(String(x.supprime_le).slice(0, 10)) })),
                h(
                  "span",
                  { class: "carte-actions" },
                  h(
                    "button",
                    {
                      class: "secondaire petit",
                      type: "button",
                      onclick: async () => {
                        if (!(await confirmer(tr("Remettre « {nom} {numero} » dans son dossier ? Les paiements du dossier n'ont pas bougé : vérifiez ensuite le reste à payer.", { nom, numero }), tr("Restaurer")))) return;
                        try {
                          const dossierId = await etat.store.restaurerDocument(x.document_id);
                          await chargerDossier(dossierId);
                          toast(tr("Document restauré."));
                          naviguer(`#/doc/${x.document_id}`);
                        } catch (err) {
                          toast(tr("Restauration impossible : {message}", { message: err.message }), true);
                        }
                      },
                    },
                    tr("Restaurer")
                  )
                )
              )
            )
          );
        })
      )
    );
  };
  dessiner();
  return h("section", null, h("h2", null, tr("Devis et factures supprimés")), h("p", { class: "aide" }, tr("Un devis ou une facture supprimé seul reste ici 90 jours. « Restaurer » le remet dans son dossier, tel qu'il était.")), liste);
}
