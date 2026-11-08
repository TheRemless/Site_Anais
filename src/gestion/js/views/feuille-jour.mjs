// Feuille du jour : les réservations d'une date, par partenaire, à envoyer au chauffeur ou au capitaine (texte WhatsApp en anglais).
import { etat, partenaireDe, nomClient, nomPartenaire, dossiersAnnules } from "../etat.mjs";
import { h, modal, toast } from "../ui.mjs";
import { aujourdhui } from "../calc.mjs";
import { feuilleDuJour, texteFeuille, lienWhatsApp } from "../operations-calc.mjs";
import { chiffres, telWhatsApp } from "../partenaires-calc.mjs";
import { tr } from "../i18n.mjs";

const ajouterJours = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);

export function ouvrirFeuilleDuJour() {
  const date = h("input", { id: "fj-date", type: "date", value: ajouterJours(aujourdhui(), 1), onchange: () => dessiner() });
  const corps = h("div", { class: "feuille-jour" });
  const contexte = {
    client: (r) => {
      const d = etat.db.dossiers.find((x) => x.id === r.dossier_id);
      return d ? etat.db.clients.find((c) => c.id === d.client_id) || null : null;
    },
    partenaire: (id) => nomPartenaire(id),
  };
  async function copier(texte) {
    try {
      await navigator.clipboard.writeText(texte);
      toast(tr("Feuille copiée."));
    } catch {
      toast(tr("La copie a échoué : sélectionnez le texte et copiez-le."), true);
    }
  }
  function dessiner() {
    corps.replaceChildren();
    if (!date.value) return corps.append(h("p", { class: "aide" }, tr("Choisissez une date.")));
    const groupes = feuilleDuJour(etat.db.reservations, date.value, contexte, dossiersAnnules());
    if (!groupes.length) return corps.append(h("p", { class: "vide-court" }, tr("Aucune réservation ce jour-là.")));
    for (const g of groupes) {
      const texte = texteFeuille(g, date.value);
      const p = g.partenaire_id ? partenaireDe(g.partenaire_id) : null;
      const tel = p ? chiffres(telWhatsApp(p)) : "";
      corps.append(
        h(
          "section",
          { class: "feuille-groupe" },
          h("h3", null, g.nom || tr("Sans partenaire")),
          h("pre", { class: "feuille-texte", tabindex: "0" }, texte),
          h(
            "div",
            { class: "actions gauche" },
            h("button", { class: "principal petit", type: "button", onclick: () => copier(texte) }, tr("Copier")),
            tel ? h("a", { class: "bouton secondaire petit", href: lienWhatsApp(tel, texte), target: "_blank", rel: "noopener" }, tr("Ouvrir WhatsApp")) : null
          )
        )
      );
    }
  }
  dessiner();
  modal(tr("Feuille du jour"), h("div", { class: "modal-corps" }, h("div", { class: "champ" }, h("label", { for: "fj-date" }, tr("Date")), date), h("p", { class: "aide" }, tr("Hors réservations annulées. Le texte est en anglais, prêt à coller dans WhatsApp.")), corps), { large: true });
}
