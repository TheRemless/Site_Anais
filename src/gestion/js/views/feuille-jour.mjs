// Feuille du jour : les services d'une date, par partenaire ou chauffeur, à envoyer en un tap (texte WhatsApp en anglais).
// Les pickups sans heure ou sans hôtel sont signalés avant l'envoi, avec un tap pour les compléter.
import { etat, partenaireDe, nomPartenaire, dossiersAnnules, peut } from "../etat.mjs";
import { h, modal, toast } from "../ui.mjs";
import { aujourdhui } from "../calc.mjs";
import { feuilleDuJour, lienWhatsApp } from "../operations-calc.mjs";
import { alertesFeuille, texteFeuillePartage, joursProposes } from "../feuille-calc.mjs";
import { chiffres, telWhatsApp } from "../partenaires-calc.mjs";
import { changerReservation } from "./prestataire.mjs";
import { tr, pluriel, N_ } from "../i18n.mjs";

const NOMS_MANQUE = { heure: N_("heure"), hotel: N_("hôtel") };

export function ouvrirFeuilleDuJour() {
  const [ajd, demain, apresDemain] = joursProposes(aujourdhui());
  let jour = demain;
  const date = h("input", { id: "fj-date", type: "date", value: jour, onchange: () => choisir(date.value) });
  const puces = h("div", { class: "onglets sous-onglets feuille-jours", role: "group", "aria-label": tr("Jour") });
  const alertes = h("div", { class: "feuille-alertes", "aria-live": "polite" });
  const corps = h("div", { class: "feuille-jour" });
  const contexte = {
    client: (r) => {
      const d = etat.db.dossiers.find((x) => x.id === r.dossier_id);
      return d ? etat.db.clients.find((c) => c.id === d.client_id) || null : null;
    },
    partenaire: (id) => nomPartenaire(id),
  };

  function choisir(valeur) {
    jour = valeur;
    date.value = valeur;
    dessiner();
  }

  async function copier(texte) {
    try {
      await navigator.clipboard.writeText(texte);
      toast(tr("Feuille copiée."));
    } catch {
      toast(tr("La copie a échoué : sélectionnez le texte et copiez-le."), true);
    }
  }

  // Un tap : la conversation du partenaire s'ouvre avec la feuille. Sans numéro, la liste de partage du téléphone, sinon la copie.
  async function envoyer(texte, tel) {
    if (tel) return window.open(lienWhatsApp(tel, texte), "_blank", "noopener");
    if (navigator.share) {
      try {
        return await navigator.share({ text: texte });
      } catch (err) {
        if (err.name === "AbortError") return;
      }
    }
    copier(texte);
  }

  function dessiner() {
    for (const b of puces.children) b.setAttribute("aria-pressed", b.dataset.jour === jour ? "true" : "false");
    corps.replaceChildren();
    alertes.replaceChildren();
    if (!jour) return corps.append(h("p", { class: "aide" }, tr("Choisissez une date.")));
    const groupes = feuilleDuJour(etat.db.reservations, jour, contexte, dossiersAnnules());
    if (!groupes.length) return corps.append(h("p", { class: "vide-court" }, tr("Aucune réservation ce jour-là.")));

    const aCompleter = alertesFeuille(groupes);
    if (aCompleter.length) {
      alertes.append(
        h(
          "div",
          { class: "bandeau-info", role: "status" },
          h("strong", null, pluriel(aCompleter.length, N_("{n} pickup à compléter avant d'envoyer"), N_("{n} pickups à compléter avant d'envoyer"))),
          h("ul", { class: "feuille-manque" }, aCompleter.map((a) =>
            h("li", null,
              h("span", null, `${a.client || a.libelle} : ${a.manque.map((m) => tr(NOMS_MANQUE[m])).join(", ")}`),
              peut("dossiers.ecrire") ? h("button", { class: "secondaire petit", type: "button", onclick: () => { const r = etat.db.reservations.find((x) => x.id === a.id); if (r) changerReservation(r, dessiner); else dessiner(); } }, tr("Compléter")) : null
            )
          ))
        )
      );
    }

    for (const g of groupes) {
      const texte = texteFeuillePartage(g, jour);
      const p = g.partenaire_id ? partenaireDe(g.partenaire_id) : null;
      const tel = p ? chiffres(telWhatsApp(p), { thaiLocal: true }) : "";
      corps.append(
        h(
          "section",
          { class: "feuille-groupe" },
          h("h3", null, g.nom || tr("Sans partenaire")),
          h("pre", { class: "feuille-texte", tabindex: "0" }, texte),
          h(
            "div",
            { class: "actions gauche" },
            h("button", { class: "principal", type: "button", onclick: () => envoyer(texte, tel) }, g.nom ? tr("Envoyer à {nom}", { nom: g.nom }) : tr("Envoyer")),
            h("button", { class: "secondaire", type: "button", onclick: () => copier(texte) }, tr("Copier"))
          )
        )
      );
    }
  }

  for (const [valeur, libelle] of [[ajd, tr("Aujourd'hui")], [demain, tr("Demain")], [apresDemain, tr("Après-demain")]]) puces.append(h("button", { type: "button", "data-jour": valeur, onclick: () => choisir(valeur) }, libelle));
  dessiner();
  modal(tr("Feuille du jour"), h("div", { class: "modal-corps" }, puces, h("div", { class: "champ" }, h("label", { for: "fj-date" }, tr("Autre date")), date), h("p", { class: "aide" }, tr("Hors réservations annulées. Le texte est en anglais, prêt à coller dans WhatsApp.")), alertes, corps), { large: true, protege: false });
}

