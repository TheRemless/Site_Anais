// Écran WhatsApp, filtre « Prêt à réserver » (migration 85, 22.11.2026) : à part de views/whatsapp.mjs, qui l'appelle à trois endroits
// (le filtre, la ligne de la liste, la carte dans la conversation). Aucun appel à l'IA ici : la carte montre ce que la fonction
// « whatsapp » a relevé dans la conversation. « Créer le dossier » ouvre l'Assistant comme le bouton habituel, au clic de Nani seulement.
// Rien ne part au client ni au prestataire.
import { etat, modifier } from "../etat.mjs";
import { h, toast, icone } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { marqueEntite } from "../whatsapp-calc.mjs";
import { FILTRE_PRET, pretAReserver, pretRetire, conversationsPretes, dossierARelier, patchRelier, lignesCarte, resumeCarte, motifPret, patchRetirer, patchRemettre } from "../whatsapp-pret-calc.mjs";

// Seuls les dossiers de Secret et de Taxi comptent (marqueDe) : ZTP ne se mélange jamais.
const marqueDe = (id) => marqueEntite(((etat.brut && etat.brut.entites) || []).find((e) => e.id === id) || null);
const contexte = () => ({ dossiers: (etat.brut && etat.brut.dossiers) || [], clients: (etat.brut && etat.brut.clients) || [], reservations: (etat.brut && etat.brut.reservations) || [], marqueDe });
// Le filtre n'est proposé qu'avec la migration 85 (la colonne est relue par store-supabase.mjs).
export const filtrePretDisponible = () => !!(etat.brut && etat.brut.whatsapp_pret_disponible);
export { FILTRE_PRET };
export const filtrerPretes = (liste) => conversationsPretes(liste, contexte());
export const nombrePretes = (liste) => filtrerPretes(liste).length;

// Sous l'aperçu de la ligne, dans le filtre : la date, le prix donné et le trajet ; d'abord « Dossier … à relier » s'il existe déjà.
export function resumeLignePret(c) {
  const p = pretAReserver(c, contexte());
  if (!p) return null;
  const d = dossierARelier(c, contexte());
  const texte = [d ? tr("Dossier {ref} à relier", { ref: d.ref || "" }) : "", resumeCarte(p.carte)].filter(Boolean).join(" · ");
  return h("span", { class: "wa-conv-pret" }, icone("dossiers", 14), h("span", null, texte || tr("Prêt à réserver")));
}

// Dans la conversation : la carte pré-remplie, « Relier au dossier » si le dossier existe déjà (Secret ou Taxi, même client, créé depuis le
// prix), « Créer le dossier » (si l'Assistant est permis, toujours, même à côté de « Relier »), et « Retirer ». Retirée, une ligne « Remettre dans la liste » reste tant que la
// conversation est ouverte (un toast s'efface trop vite pour annuler).
// `creerDossier` : la fonction de l'écran qui ouvre l'Assistant lié à la conversation, ou null. `peutRelierDans(entiteId)` : la personne
// administre cette entreprise (la base le redemande). `rafraichir` : redessine l'écran.
export function cartePret(c, { lectureSeule = false, creerDossier = null, peutRelierDans = () => false, rafraichir = () => {} } = {}) {
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
  const dossier = dossierARelier(c, contexte());
  const patch = dossier && peutRelierDans(dossier.entite_id) ? patchRelier(c, dossier) : null;
  const relier = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await modifier("whatsapp_conversations", c.id, patch);
      // La base retire un lien incohérent (whatsapp_reclasser) : on le dit au lieu de faire comme si.
      if (!r || r.dossier_id !== dossier.id) toast(tr("Le dossier {ref} n'a pas pu être relié : reliez-le depuis l'en-tête de la conversation.", { ref: dossier.ref || "" }), true);
      else toast(tr("Conversation reliée au dossier {ref}.", { ref: dossier.ref || "" }));
      rafraichir();
    } catch (err) {
      e.target.disabled = false;
      toast(err.message, true);
    }
  };
  return h(
    "section",
    { class: "wa-suivi wa-suivi-pret", "aria-label": tr("Prêt à réserver") },
    h("p", null, icone("dossiers", 16), h("strong", null, tr("Prêt à réserver.")), " ", tr(motifPret(p))),
    lignes.length
      ? h("dl", { class: "wa-pret-carte" }, lignes.flatMap((l) => [h("dt", null, tr(l.libelle)), h("dd", null, l.valeur)]))
      : h("p", { class: "aide" }, tr("Rien à reprendre automatiquement : l'Assistant lira l'échange.")),
    dossier ? h("p", { class: "wa-pret-dossier" }, tr("Le dossier {ref} existe déjà pour ce client, créé après le prix donné. Il n'est pas relié à cette conversation.", { ref: dossier.ref || "" })) : null,
    lectureSeule
      ? null
      : h(
          "div",
          { class: "wa-suivi-actions", "data-pas-saisie": "" },
          patch ? h("button", { class: "principal petit", type: "button", onclick: relier }, icone("dossiers", 16), tr("Relier au dossier {ref}", { ref: dossier.ref || "" })) : null,
          // Un dossier déjà là (peut-être de l'autre entreprise) ne masque jamais « Créer le dossier ».
          creerDossier ? h("button", { class: patch ? "secondaire petit" : "principal petit", type: "button", onclick: () => creerDossier() }, icone("assistant", 16), tr("Créer le dossier")) : null,
          h("button", { class: "lien", type: "button", onclick: ecrire(patchRetirer) }, tr("Retirer"))
        )
  );
}

// Liste vide du filtre.
export const videPret = () => h("p", { class: "aide wa-liste-vide" }, tr("Aucune conversation prête à réserver. Une conversation arrive ici quand le client dit oui après un prix ou quand vous envoyez la confirmation, et repart dès que le dossier est relié."));
