// Textes partagés de l'assistant IA : les motifs d'erreur de la fonction (import d'une brochure) et le badge de confiance
// d'un service proposé (fiche de création). Le bouton « Lire avec l'assistant » de « Coller une demande » est retiré le 20.11.2026 : l'onglet
// Assistant lit les messages collés.
import { h } from "../ui.mjs";
import { tr, N_ } from "../i18n.mjs";

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
const CONFIANCE = { haute: N_("Sûr"), moyenne: N_("À vérifier"), basse: N_("Supposé") };

export const messageErreur = (code) => tr(ERREURS[code] || N_("L'assistant ne répond pas."));

// Pastille de confiance d'un service lu par l'assistant (« Sûr », « À vérifier », « Supposé »).
export const badgeConfiance = (c) => (CONFIANCE[c] ? h("span", { class: `assistant-confiance ${c}` }, tr(CONFIANCE[c])) : null);
