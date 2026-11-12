// Fiche client : ce qui se vérifie sans écran (testé avec node --test).
import { normaliserTelephone } from "./partenaires-calc.mjs";
import { separerNom } from "./demande-calc.mjs";

// Téléphone saisi dans la fiche client. Vide : accepté (le champ est facultatif). Inchangé : accepté tel quel (un ancien numéro sans indicatif ne bloque pas
// l'enregistrement des autres champs). Sinon il faut un numéro international : l'indicatif d'un client n'est jamais deviné (un « 079… » n'est pas un +66).
// Renvoie { ok, valeur, raison } : `valeur` est le numéro normalisé (« +41791234567 »), `raison` : "sans_indicatif" | "trop_court" | "vide".
export function verifierTelephoneClient(saisie, ancien = "") {
  const brut = String(saisie || "").trim();
  if (!brut) return { ok: true, valeur: "", raison: "" };
  if (brut === String(ancien || "").trim()) return { ok: true, valeur: brut, raison: "" };
  const t = normaliserTelephone(brut);
  return t.numero ? { ok: true, valeur: t.numero, raison: "" } : { ok: false, valeur: brut, raison: t.raison };
}

// Numéros d'un client pour les boutons Appeler et WhatsApp : l'appel accepte un numéro local tel quel, WhatsApp exige le format international.
export function numerosClient(telephone) {
  const t = normaliserTelephone(telephone);
  const local = String(telephone || "").replace(/[^\d+]/g, "");
  const appel = t.numero || (local.replace(/\D/g, "").length >= 6 ? local : "");
  return { appel, whatsapp: t.numero ? t.numero.slice(1) : "" };
}

// Nom tapé dans la recherche de client puis repris par « Créer un nouveau client » : le premier mot est le prénom, le reste le nom
// (un seul mot : le nom, on cherche d'abord par le nom). Rien n'est deviné de plus : une particule ou un nom composé se corrige à la main.
export function identiteDepuisSaisie(texte) {
  return separerNom(String(texte || "").replace(/\s+/g, " ").trim());
}

const FORME_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Vérifie un nouveau client avant de l'enregistrer : le nom est obligatoire, le téléphone doit avoir son indicatif (jamais deviné),
// l'e-mail facultatif doit avoir une forme d'adresse. Renvoie { ok, champ, raison, valeurs } ; `valeurs.telephone` est le numéro normalisé.
export function verifierNouveauClient({ nom = "", telephone = "", email = "" }) {
  if (!String(nom).trim()) return { ok: false, champ: "nom", raison: "nom_vide" };
  const tel = verifierTelephoneClient(telephone, "");
  if (!tel.ok) return { ok: false, champ: "telephone", raison: tel.raison };
  const courriel = String(email || "").trim();
  if (courriel && !FORME_EMAIL.test(courriel)) return { ok: false, champ: "email", raison: "email_illisible" };
  return { ok: true, champ: "", raison: "", valeurs: { telephone: tel.valeur, email: courriel } };
}
