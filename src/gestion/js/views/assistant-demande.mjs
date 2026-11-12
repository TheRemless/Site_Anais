// Assistant IA dans l'écran « Coller une demande » : deux boutons, « Lire avec l'assistant » et « Rédiger la réponse ».
// Ils n'apparaissent que si l'entreprise a allumé l'assistant (Réglages) et si le rôle a les droits que la fonction exige.
// L'assistant propose, Anaïs vérifie : rien n'est créé ni envoyé sans elle, et la lecture par règles reste affichée quand il ne répond pas.
import { etat, reglages, peut, nomPartenaire, entiteActive } from "../etat.mjs";
import { h, toast } from "../ui.mjs";
import { tr, N_ } from "../i18n.mjs";
import { assistantActif, propositionVersDemande, faitsPourReponse } from "../assistant-calc.mjs";
import { lienWhatsApp } from "../operations-calc.mjs";
import { chiffres } from "../partenaires-calc.mjs";

const ERREURS = {
  assistant_eteint: N_("L'assistant est éteint pour cette entreprise (Réglages)."),
  droit_manquant: N_("Votre rôle ne permet pas d'utiliser l'assistant ici."),
  limite_du_jour: N_("Limite d'appels du jour atteinte."),
  non_configure: N_("L'assistant n'est pas encore activé sur le serveur."),
  occupe: N_("L'assistant est très demandé : réessayez dans une minute."),
  refus: N_("L'assistant n'a pas traité ce message."),
  faits_cle_interdite: N_("Le dossier contient une donnée qui ne peut pas partir à l'assistant."),
};
const AVERTISSEMENTS = {
  nom_non_cite: N_("Le nom proposé n'était pas dans le message : il a été retiré."),
  telephone_non_cite: N_("Le téléphone proposé n'était pas dans le message : il a été retiré."),
  hotel_non_cite: N_("L'hôtel proposé n'était pas dans le message : il a été retiré."),
  reference_inconnue: N_("Un service proposé n'existe pas dans la base : choisissez-le à la main."),
  date_illisible: N_("Une date n'a pas pu être lue."),
  date_passee: N_("Une date proposée est déjà passée."),
};
const CONFIANCE = { haute: N_("Sûr"), moyenne: N_("À vérifier"), basse: N_("Supposé") };

export const messageErreur = (code) => tr(ERREURS[code] || N_("L'assistant ne répond pas."));

// Avertissement lisible : les codes simples ont leur phrase, « montant_hors_base:2900 » et « heure_hors_base:07:45 » gardent leur valeur.
export function texteAvertissement(a) {
  if (AVERTISSEMENTS[a]) return tr(AVERTISSEMENTS[a]);
  const [code, valeur] = [a.slice(0, a.indexOf(":")), a.slice(a.indexOf(":") + 1)];
  if (code === "montant_hors_base") return tr("Montant absent de la base : {valeur}. Corrigez-le avant d'envoyer.", { valeur });
  if (code === "heure_hors_base") return tr("Heure absente du dossier : {valeur}. Vérifiez-la avant d'envoyer.", { valeur });
  return "";
}

// Pastille de confiance d'un service lu par l'assistant (« Sûr », « À vérifier », « Supposé »).
export const badgeConfiance = (c) => (CONFIANCE[c] ? h("span", { class: `assistant-confiance ${c}` }, tr(CONFIANCE[c])) : null);

const listeAvertissements = (liste) => {
  const textes = (liste || []).map(texteAvertissement).filter(Boolean);
  return textes.length ? h("ul", { class: "assistant-avertissements" }, textes.map((t) => h("li", null, t))) : null;
};

export const assistantDisponible = (usage) => assistantActif(reglages()) && peut("partenaires.lire") && peut(usage === "lire" ? "dossiers.ecrire" : "dossiers.lire");

// « Lire avec l'assistant » : envoie le message collé, rend `{ d, services, avertissements, remarques }` dans la forme de la lecture par règles.
// `texte()` lit la zone de saisie au moment du tap. Renvoie null quand l'assistant n'est pas disponible : l'écran reste celui d'avant.
export function boutonLireIA({ texte, surResultat }) {
  if (!assistantDisponible("lire")) return null;
  const ligne = h("div", { class: "assistant-etat", role: "status", "aria-live": "polite" });
  const bouton = h("button", { class: "secondaire assistant-bouton", type: "button", onclick: () => lancer() }, tr("Lire avec l'assistant"));
  async function lancer() {
    const t = String(texte() || "").trim();
    ligne.classList.remove("erreur");
    if (!t) return (ligne.textContent = tr("Collez d'abord le message du client."));
    bouton.disabled = true;
    bouton.setAttribute("aria-busy", "true");
    bouton.textContent = tr("Lecture…");
    ligne.textContent = "";
    try {
      const r = await etat.store.assistant({ usage: "lire", entite_id: etat.entiteId, texte: t });
      if (!r || r.erreur || !r.proposition) {
        ligne.classList.add("erreur");
        ligne.textContent = `${messageErreur(r && r.erreur)} ${tr("La lecture habituelle reste affichée.")}`;
        return;
      }
      const lu = propositionVersDemande(r.proposition, { prestations: etat.db.prestations, trajets: etat.db.trajets, nomPartenaire });
      surResultat({ ...lu, avertissements: r.avertissements || [], remarques: r.proposition.remarques || "" });
      ligne.replaceChildren(...[h("p", null, tr("Lu par l'assistant : vérifiez chaque champ avant de créer.")), r.proposition.remarques ? h("p", { class: "assistant-remarque" }, r.proposition.remarques) : null, listeAvertissements(r.avertissements)].filter(Boolean));
    } catch {
      ligne.classList.add("erreur");
      ligne.textContent = `${messageErreur("")} ${tr("La lecture habituelle reste affichée.")}`;
    } finally {
      bouton.disabled = false;
      bouton.removeAttribute("aria-busy");
      bouton.textContent = tr("Relire avec l'assistant");
    }
  }
  return h("div", { class: "assistant-lire" }, bouton, ligne);
}

// « Rédiger la réponse » : un brouillon dans la voix d'Anaïs, à partir des services retenus et des prix de la base, toujours modifiable.
// `contexte()` rend `{ d, services, texte }` au moment du tap (services avec `choisie` ou leurs offres, la première étant retenue).
export function boutonRedigerIA({ contexte, surTexte }) {
  if (!assistantDisponible("rediger")) return null;
  const regl = reglages();
  const zone = h("div", { class: "assistant-brouillon", "aria-live": "polite" });
  const bouton = h("button", { class: "secondaire assistant-bouton", type: "button", onclick: () => lancer() }, tr("Rédiger la réponse"));
  async function lancer() {
    const { d, services, texte } = contexte();
    const faits = faitsPourReponse({ d, services, entreprise: (entiteActive() || {}).nom || "", devise: regl.devise || "THB", telephone: (regl.emetteur && regl.emetteur.telephone) || "" });
    if (!faits.services.length) return toast(tr("Choisissez d'abord un service de la base."), true);
    bouton.disabled = true;
    bouton.setAttribute("aria-busy", "true");
    bouton.textContent = tr("Rédaction…");
    try {
      const r = await etat.store.assistant({ usage: "rediger", entite_id: etat.entiteId, faits, langue: d.langue || "", texte: texte || "" });
      if (!r || r.erreur || !r.message) return zone.replaceChildren(h("p", { class: "erreur-form", role: "alert" }, `${messageErreur(r && r.erreur)} ${tr("Écrivez la réponse vous-même ou utilisez la réponse type.")}`));
      afficher(r, d);
      if (surTexte) surTexte(r.message, r);
    } catch {
      zone.replaceChildren(h("p", { class: "erreur-form", role: "alert" }, messageErreur("")));
    } finally {
      bouton.disabled = false;
      bouton.removeAttribute("aria-busy");
      bouton.textContent = tr("Rédiger à nouveau");
    }
  }
  function afficher(r, d) {
    const tel = chiffres(d.telephone);
    const champTexte = h("textarea", { id: "assistant-reponse", rows: 9, oninput: () => lien && (lien.href = lienWhatsApp(tel, champTexte.value)) });
    champTexte.value = r.message;
    const lien = tel ? h("a", { class: "bouton secondaire", href: lienWhatsApp(tel, r.message), target: "_blank", rel: "noopener" }, tr("Ouvrir dans WhatsApp")) : null;
    const copier = h("button", { class: "secondaire", type: "button", onclick: () => navigator.clipboard.writeText(champTexte.value).then(() => toast(tr("Réponse copiée : collez-la dans WhatsApp.")), () => toast(tr("La copie a échoué : sélectionnez le texte et copiez-le."), true)) }, tr("Copier"));
    zone.replaceChildren(
      ...[
        h("p", { class: "aide" }, tr("Brouillon de l'assistant : relisez-le et modifiez-le avant de l'envoyer.")),
        listeAvertissements(r.avertissements),
        h("div", { class: "champ" }, h("label", { for: "assistant-reponse" }, tr("Réponse au client")), champTexte),
        r.manques && r.manques.length ? h("p", { class: "aide" }, tr("Reste à demander : {liste}", { liste: r.manques.join(", ") })) : null,
        h("div", { class: "actions gauche" }, ...[lien, copier].filter(Boolean)),
      ].filter(Boolean)
    );
  }
  return h("div", { class: "assistant-rediger" }, bouton, zone);
}
