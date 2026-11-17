// Compte de la personne connectée et comptes de l'équipe (lot D, 17.11.2026) : la logique pure, sans DOM, testée dans tests/gestion-lot-d-autonomie.test.js.
import { N_ } from "./i18n.mjs";

// Retour d'un lien envoyé par l'outil ou par Supabase : invitation, mot de passe oublié. Le lien ramène sur l'outil avec, après le #,
// « type=invite » ou « type=recovery » (la bibliothèque ouvre alors la session et efface ce morceau), ou une erreur (« error_code=otp_expired »).
// Lu avant que la bibliothèque ne l'efface. Renvoie { type: "invite" | "recovery" | null, erreur: "expire" | "refuse" | null }.
export function lireRetourLien(hash) {
  const brut = String(hash || "").replace(/^#/, "");
  if (!/(^|&)(type|error|error_code)=/.test(brut)) return { type: null, erreur: null };
  const p = new URLSearchParams(brut);
  if (p.get("error") || p.get("error_code")) return { type: null, erreur: /expired/i.test(`${p.get("error_code")} ${p.get("error_description")}`) ? "expire" : "refuse" };
  const type = p.get("type");
  return { type: type === "invite" || type === "recovery" ? type : null, erreur: null };
}

export const LONGUEUR_MIN_MOT_DE_PASSE = 8;
// Contrôle d'un nouveau mot de passe avant l'envoi. Renvoie null si tout va bien, sinon le texte à afficher (à traduire avec tr).
export function erreurMotDePasse(nouveau, confirmation) {
  const n = String(nouveau || "");
  if (n.length < LONGUEUR_MIN_MOT_DE_PASSE) return N_("Au moins 8 caractères.");
  if (/^\s|\s$/.test(n)) return N_("Pas d'espace au début ni à la fin.");
  if (n !== String(confirmation || "")) return N_("Les deux mots de passe ne sont pas identiques.");
  return null;
}

// Réponses de la fonction « invitation » (supabase/functions/invitation) dites en clair.
export const ERREURS_INVITATION = {
  non_connecte: N_("Votre session a expiré : reconnectez-vous, puis recommencez."),
  droit_manquant: N_("Seule l'administratrice générale peut faire ce geste."),
  demande_invalide: N_("La demande est incomplète."),
  action_inconnue: N_("La demande est incomplète."),
  email_invalide: N_("Cette adresse e-mail n'est pas valide."),
  acces_invalide: N_("Un des accès choisis ne correspond pas à son entreprise. Rechargez la page et recommencez."),
  retour_refuse: N_("Cette adresse de l'outil n'est pas autorisée pour les liens. Ouvrez l'outil à son adresse habituelle."),
  deja_inscrit: N_("Cette adresse a déjà un compte. Retrouvez la personne dans la liste et réglez ses accès avec « Gérer l'accès »."),
  personne_invalide: N_("Personne introuvable. Rechargez la page."),
  personne_inconnue: N_("Personne introuvable. Rechargez la page."),
  soi_meme: N_("Vous ne pouvez pas supprimer votre propre compte."),
  derniere_administratrice: N_("C'est la seule administratrice générale : donnez d'abord ce rôle à une autre personne."),
  profil_impossible: N_("Le compte est créé, mais son nom et sa langue n'ont pas pu être enregistrés : réglez-les avec « Gérer l'accès »."),
  acces_impossible: N_("Le compte est créé, mais ses accès n'ont pas pu être enregistrés : réglez-les avec « Gérer l'accès »."),
  organisation_invalide: N_("Donnez un nom à l'organisation du client."),
  organisation_impossible: N_("L'organisation n'a pas pu être créée. Le compte a été retiré : réessayez."),
  indisponible: N_("La fonction d'invitation ne répond pas. Elle n'est peut-être pas encore installée (voir docs/gestion/mise-en-route.md)."),
};
export const messageInvitation = (code) => ERREURS_INVITATION[code] || N_("L'opération n'a pas abouti. Réessayez dans un moment.");

// Accès demandés dans la fenêtre « Inviter une personne » : une entreprise, un rôle. Les entreprises laissées sur « Aucun accès » ne comptent pas.
export const accesChoisis = (choix) => (choix || []).filter((c) => c && c.entite_id && c.role_id).map((c) => ({ entite_id: c.entite_id, role_id: c.role_id }));

// Message prêt à envoyer avec le lien (WhatsApp ou e-mail), dans la langue de la personne invitée.
export function messageLien({ lien, langue, type = "invite", nom = "" }) {
  const en = langue === "en";
  const salut = en ? `Hello${nom ? ` ${nom}` : ""},` : `Bonjour${nom ? ` ${nom}` : ""},`;
  const corps = type === "invite"
    ? en ? "Here is your access to Gestion. Open this link and choose your password:" : "Voici votre accès à Gestion. Ouvrez ce lien et choisissez votre mot de passe :"
    : en ? "Open this link to choose a new password for Gestion:" : "Ouvrez ce lien pour choisir un nouveau mot de passe pour Gestion :";
  const fin = en ? "The link works once and expires soon." : "Le lien ne sert qu'une fois et expire vite.";
  return `${salut}\n\n${corps}\n${lien}\n\n${fin}`;
}
