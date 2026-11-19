// Assistant IA dans l'écran « Coller une demande » : le bouton « Lire avec l'assistant » (la rédaction de la réponse est retirée depuis le
// 19.11.2026 : Anaïs écrit ses réponses). Il n'apparaît que si l'entreprise a allumé l'assistant (Réglages) et si le rôle a les droits exigés.
// L'assistant propose, Anaïs vérifie : rien n'est créé ni envoyé sans elle, et la lecture par règles reste affichée quand il ne répond pas.
import { etat, reglages, peut, nomPartenaire } from "../etat.mjs";
import { h } from "../ui.mjs";
import { tr, N_ } from "../i18n.mjs";
import { assistantActif, propositionVersDemande } from "../assistant-calc.mjs";

const ERREURS = {
  assistant_eteint: N_("L'assistant est éteint pour cette entreprise (Réglages)."),
  droit_manquant: N_("Votre rôle ne permet pas d'utiliser l'assistant ici."),
  limite_du_jour: N_("Limite d'appels du jour atteinte."),
  non_configure: N_("L'assistant n'est pas encore activé sur le serveur."),
  occupe: N_("L'assistant est très demandé : réessayez dans une minute."),
  refus: N_("L'assistant n'a pas traité ce message."),
  faits_cle_interdite: N_("Le dossier contient une donnée qui ne peut pas partir à l'assistant."),
  faits_invalides: N_("Aucun trajet à envoyer à l'assistant."),
  hotels_invalides: N_("Aucun nom d'hôtel à chercher (huit au plus à la fois)."),
  catalogue_vide: N_("Aucun trajet dans la base de prix : rien sur quoi situer les hôtels."),
  sans_reponse: N_("La recherche n'a rien donné : choisissez les lieux à la main."),
  pause: N_("La recherche a pris trop de temps : relancez-la."),
  coupe: N_("La réponse de l'assistant était trop longue : relancez-le."),
  message_invalide: N_("Le message est vide ou trop long."),
};
const AVERTISSEMENTS = {
  nom_non_cite: N_("Le nom proposé n'était pas dans le message : il a été retiré."),
  telephone_non_cite: N_("Le téléphone proposé n'était pas dans le message : il a été retiré."),
  hotel_non_cite: N_("L'hôtel proposé n'était pas dans le message : il a été retiré."),
  reference_inconnue: N_("Un service proposé n'existe pas dans la base : choisissez-le à la main."),
  date_illisible: N_("Une date n'a pas pu être lue."),
  date_passee: N_("Une date proposée est déjà passée."),
  dates_inversees: N_("Une étape part avant d'arriver : vérifiez ses dates."),
};
const CONFIANCE = { haute: N_("Sûr"), moyenne: N_("À vérifier"), basse: N_("Supposé") };

export const messageErreur = (code) => tr(ERREURS[code] || N_("L'assistant ne répond pas."));

// Avertissement lisible : les codes simples ont leur phrase, « montant_hors_base:2900 » et « heure_hors_base:07:45 » gardent leur valeur.
export function texteAvertissement(a) {
  if (AVERTISSEMENTS[a]) return tr(AVERTISSEMENTS[a]);
  const [code, valeur] = [a.slice(0, a.indexOf(":")), a.slice(a.indexOf(":") + 1)];
  if (code === "montant_hors_base") return tr("Montant absent de la base : {valeur}. Corrigez-le avant d'envoyer.", { valeur });
  if (code === "heure_hors_base") return tr("Heure absente du dossier : {valeur}. Vérifiez-la avant d'envoyer.", { valeur });
  if (code === "mot_interne") return tr("Le brouillon parle de « {valeur} » : retirez toute raison interne avant d'envoyer.", { valeur });
  return "";
}

// Pastille de confiance d'un service lu par l'assistant (« Sûr », « À vérifier », « Supposé »).
export const badgeConfiance = (c) => (CONFIANCE[c] ? h("span", { class: `assistant-confiance ${c}` }, tr(CONFIANCE[c])) : null);

const listeAvertissements = (liste) => {
  const textes = (liste || []).map(texteAvertissement).filter(Boolean);
  return textes.length ? h("ul", { class: "assistant-avertissements" }, textes.map((t) => h("li", null, t))) : null;
};

export const assistantDisponible = () => assistantActif(reglages()) && peut("partenaires.lire") && peut("dossiers.ecrire");

// « Lire avec l'assistant » : envoie le message collé, rend `{ d, services, avertissements, remarques }` dans la forme de la lecture par règles.
// `texte()` lit la zone de saisie au moment du tap. Renvoie null quand l'assistant n'est pas disponible : l'écran reste celui d'avant.
export function boutonLireIA({ texte, surResultat }) {
  if (!assistantDisponible()) return null;
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
      // Le message a changé pendant la lecture (un autre client collé) : cette réponse ne le concerne plus.
      if (String(texte() || "").trim() !== t) return (ligne.textContent = tr("Le message a changé pendant la lecture : relancez l'assistant."));
      if (!r || r.erreur || !r.proposition) {
        ligne.classList.add("erreur");
        ligne.textContent = `${messageErreur(r && r.erreur)} ${tr("La lecture habituelle reste affichée.")}`;
        return;
      }
      const lu = propositionVersDemande(r.proposition, { prestations: etat.db.prestations, trajets: etat.db.trajets, partenaires: etat.db.partenaires, nomPartenaire });
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
