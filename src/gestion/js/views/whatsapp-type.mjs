// Écran WhatsApp, type du contact déduit (migration 110, 22.11.2026) : sous les puces du type, une ligne dit pourquoi l'outil pense que c'est un
// partenaire. Type déduit : « Confirmer » le rend à Nani ; une autre puce le change (la base le marque alors comme le sien). Partenaire
// probable (rien de posé) : la ligne le dit, Nani tape « Partenaire » si c'est juste. Règle : whatsapp-type-calc.mjs.
import { modifier } from "../etat.mjs";
import { h, toast } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { partenaireDeduit, partenaireSuggere, raisonPartenaire, patchConfirmerType } from "../whatsapp-type-calc.mjs";

const texteRaison = (c) => {
  const r = raisonPartenaire(c);
  if (!r) return "";
  return r.texte || r.cles.map((k) => tr(k)).join(" ; ");
};

export function noteTypeDeduit(c, { ecrit = false, apres = () => {} } = {}) {
  if (!c || c.reponses === "jamais") return null;
  const raison = texteRaison(c);
  if (partenaireDeduit(c)) {
    const confirmer = async () => {
      try {
        await modifier("whatsapp_conversations", c.id, patchConfirmerType());
        toast(tr("Partenaire confirmé."));
        apres();
      } catch (err) {
        toast(err.message, true);
      }
    };
    return h(
      "p",
      { class: "wa-note wa-type-deduit" },
      h("span", { class: "wa-deduit" }, tr("Partenaire déduit")),
      " ",
      raison ? tr("d'après la conversation : {raison}.", { raison }) : tr("d'après la conversation."),
      " ",
      tr("Ses prix ne sont jamais repris comme prix de vente."),
      ecrit ? h("button", { type: "button", class: "lien", onclick: confirmer }, tr("Confirmer")) : null
    );
  }
  if (partenaireSuggere(c)) {
    return h("p", { class: "wa-note wa-type-suggere" }, tr("Partenaire probable"), raison ? ` : ${raison}.` : ".", " ", ecrit ? tr("Touchez « Partenaire » si c'est juste.") : "");
  }
  return null;
}
