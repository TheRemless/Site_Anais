// Écran WhatsApp, filtre « Prêt à réserver » (migration 85, 22.11.2026) : à part de views/whatsapp.mjs, qui l'appelle à trois endroits
// (le filtre, la ligne de la liste, la carte dans la conversation). Aucun appel à l'IA ici : la carte montre ce que la fonction
// « whatsapp » a relevé dans la conversation. « Créer le dossier » ouvre l'Assistant comme le bouton habituel, au clic de Nani seulement.
// Rien ne part au client ni au prestataire.
import { etat, modifier } from "../etat.mjs";
import { h, toast, icone } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { FILTRE_PRET, pretAReserver, pretRetire, conversationsPretes, lignesCarte, resumeCarte, motifPret, patchRetirer, patchRemettre } from "../whatsapp-pret-calc.mjs";

const contexte = () => ({ dossiers: (etat.brut && etat.brut.dossiers) || [], clients: (etat.brut && etat.brut.clients) || [] });
// Le filtre n'est proposé qu'avec la migration 85 (la colonne est relue par store-supabase.mjs).
export const filtrePretDisponible = () => !!(etat.brut && etat.brut.whatsapp_pret_disponible);
export { FILTRE_PRET };
export const filtrerPretes = (liste) => conversationsPretes(liste, contexte());
export const nombrePretes = (liste) => filtrerPretes(liste).length;

// Sous l'aperçu de la ligne, dans le filtre : la date, le prix donné et le trajet.
export function resumeLignePret(c) {
  const p = pretAReserver(c, contexte());
  if (!p) return null;
  return h("span", { class: "wa-conv-pret" }, icone("dossiers", 14), h("span", null, resumeCarte(p.carte) || tr("Prêt à réserver")));
}

// Dans la conversation : la carte pré-remplie, « Créer le dossier » (si l'Assistant est permis) et « Retirer ». Retirée, une ligne
// « Remettre » reste tant que la conversation est ouverte (un toast s'efface trop vite pour annuler).
// `creerDossier` : la fonction de l'écran qui ouvre l'Assistant lié à la conversation, ou null. `rafraichir` : redessine l'écran.
export function cartePret(c, { lectureSeule = false, creerDossier = null, rafraichir = () => {} } = {}) {
  const ecrire = (patch) => async (e) => {
    e.currentTarget.disabled = true;
    try {
      await modifier("whatsapp_conversations", c.id, patch());
      rafraichir();
    } catch (err) {
      e.target.disabled = false;
      toast(err.message, true);
    }
  };
  if (pretRetire(c, contexte()))
    return lectureSeule
      ? null
      : h(
          "p",
          { class: "wa-tache wa-pret-retire", "data-pas-saisie": "" },
          icone("dossiers", 16),
          h("span", null, tr("Retirée de « Prêt à réserver ». Elle revient si le client confirme de nouveau.")),
          h("button", { class: "lien", type: "button", onclick: ecrire(patchRemettre) }, tr("Remettre dans la liste"))
        );
  const p = pretAReserver(c, contexte());
  if (!p) return null;
  const lignes = lignesCarte(p.carte);
  return h(
    "section",
    { class: "wa-suivi wa-suivi-pret", "aria-label": tr("Prêt à réserver") },
    h("p", null, icone("dossiers", 16), h("strong", null, tr("Prêt à réserver.")), " ", tr(motifPret(p))),
    lignes.length
      ? h("dl", { class: "wa-pret-carte" }, lignes.flatMap((l) => [h("dt", null, tr(l.libelle)), h("dd", null, l.valeur)]))
      : h("p", { class: "aide" }, tr("Rien à reprendre automatiquement : l'Assistant lira l'échange.")),
    lectureSeule
      ? null
      : h(
          "div",
          { class: "wa-suivi-actions", "data-pas-saisie": "" },
          creerDossier ? h("button", { class: "principal petit", type: "button", onclick: () => creerDossier() }, icone("assistant", 16), tr("Créer le dossier")) : null,
          h("button", { class: "lien", type: "button", onclick: ecrire(patchRetirer) }, tr("Retirer"))
        )
  );
}

// Liste vide du filtre.
export const videPret = () => h("p", { class: "aide wa-liste-vide" }, tr("Aucune conversation prête à réserver. Une conversation arrive ici quand le client dit oui après un prix ou quand vous envoyez la confirmation, et repart dès que le dossier est créé."));
