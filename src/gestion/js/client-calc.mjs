// Fiche client : ce qui se vérifie sans écran (testé avec node --test).
import { normaliserTelephone, nettoyerTelephone } from "./partenaires-calc.mjs";
import { tr } from "./i18n.mjs";
import { separerNom } from "./demande-calc.mjs";
import { separerChambreLigne } from "./operations-calc.mjs";

// Chambre de la fiche client (Secret) : rangée en fin de première ligne de l'adresse (« Baiyok Hotel, Room 6 »), comme à la création d'un dossier,
// pour que les vouchers et la feuille du jour la retrouvent. La fiche la montre dans son propre champ.
export function chambreDeLAdresse(adresse) {
  const lignes = String(adresse || "").split("\n");
  const { hotel, chambre } = separerChambreLigne(lignes[0] || "");
  return { adresse: [hotel, ...lignes.slice(1)].join("\n").trim(), chambre };
}
export function adresseAvecChambre(adresse, chambre) {
  const lignes = String(adresse || "").trim().split("\n");
  const c = String(chambre || "").trim().replace(/^(?:room|chambre|ch\.?)\s*(?:no\.?\s*)?/i, "");
  if (!c) return lignes.join("\n").trim();
  lignes[0] = [lignes[0].trim().replace(/,\s*$/, ""), `Room ${c}`].filter(Boolean).join(", ");
  return lignes.join("\n").trim();
}

// Téléphone saisi dans la fiche client. Vide : accepté (le champ est facultatif). Inchangé : accepté tel quel (un ancien numéro sans indicatif ne bloque pas
// l'enregistrement des autres champs). Sinon il faut un numéro international : l'indicatif d'un client n'est jamais deviné (un « 079… » n'est pas un +66).
// Renvoie { ok, valeur, raison } : `valeur` est le numéro normalisé (« +41791234567 »), `raison` : "sans_indicatif" | "trop_court" | "vide".
export function verifierTelephoneClient(saisie, ancien = "") {
  const brut = String(saisie || "").trim();
  if (!brut) return { ok: true, valeur: "", raison: "" };
  if (brut === String(ancien || "").trim()) return { ok: true, valeur: brut, raison: "" };
  const t = normaliserTelephone(brut);
  if (!t.numero) return { ok: false, valeur: brut, raison: t.raison };
  // Un numéro coupé ne passe jamais (INV-2026-055 : « +1555010 » enregistré pour « +1 (555) 010-4477 (trait d’union insécable) ») : tous les chiffres du champ doivent
  // être dans le numéro lu (deux numéros, ou un caractère qui coupe, sont refusés), et un numéro d'Amérique du Nord (+1) a toujours 11 chiffres.
  const lus = t.numero.replace(/\D/g, "");
  const tous = nettoyerTelephone(brut).replace(/\D/g, "");
  const attendu = tous.startsWith("00") ? tous.slice(2) : tous;
  if (attendu !== lus) return { ok: false, valeur: brut, raison: "illisible" };
  const longueur = LONGUEURS_INDICATIF.find(([ind]) => lus.startsWith(ind));
  if (longueur && !longueur[1].includes(lus.length)) return { ok: false, valeur: brut, raison: "longueur" };
  // Thaïlande : un mobile (06, 08, 09 en local) a toujours 9 chiffres après le 66.
  if (/^66[689]/.test(lus) && lus.length !== 11) return { ok: false, valeur: brut, raison: "longueur" };
  if (lus.length > 15) return { ok: false, valeur: brut, raison: "longueur" };
  return { ok: true, valeur: t.numero, raison: "" };
}

// Longueur complète (indicatif compris) des numéros dont la règle est fixe, parmi les pays des clients : Amérique du Nord, France, Suisse,
// Thaïlande (fixe 8 chiffres ou mobile 9 après le 66), Royaume-Uni (10 chiffres après le 44, quelques anciens fixes à 9).
const LONGUEURS_INDICATIF = [
  ["1", [11]],
  ["33", [11]],
  ["41", [11]],
  ["66", [10, 11]],
  ["44", [11, 12]],
];

// Le message à montrer pour un téléphone refusé par verifierTelephoneClient.
export function messageTelephone(raison) {
  if (raison === "sans_indicatif") return tr("Ajoutez l'indicatif du pays, par exemple +41, +33 ou +66, à la place du 0 du début.");
  if (raison === "longueur") return tr("Ce numéro n'a pas le bon nombre de chiffres pour son pays : vérifiez qu'il est complet.");
  if (raison === "illisible") return tr("Numéro coupé ou en double : laissez un seul numéro, complet, avec son indicatif.");
  return tr("Numéro illisible : écrivez-le avec son indicatif, par exemple +41 79 123 45 67.");
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

// Fusionner deux fiches : le droit « clients.fusionner », ou à défaut ceux qu'il remplace (supprimer un client et modifier les dossiers),
// comme la fonction fusionner_clients de la base. `peut(code)` dit si la personne a ce droit dans l'entreprise.
export const peutFusionnerClients = (peut) => peut("clients.fusionner") || (peut("clients.supprimer") && peut("dossiers.ecrire"));

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
