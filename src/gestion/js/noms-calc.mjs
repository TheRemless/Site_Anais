// Noms et marques à l'écran (SaaS, migration 44, 18.11.2026) : aucun nom de personne ni de marque d'un client écrit dans le code.
// Le prénom de la personne responsable, le libellé de licence, la marque des pieds de booking et le libellé du rôle d'administration
// viennent des réglages de l'entreprise (reglages.valeur) ou de l'organisation. Logique pure, testée dans tests/gestion-noms-marques.test.js.

import { N_ } from "./i18n.mjs";

// « d'Anaïs », « de Mook » : l'élision devant une voyelle ou un h muet.
const VOYELLE = /^[aeiouyhàâäéèêëîïôöûüœæ]/i;
export const voyelle = (nom) => VOYELLE.test(String(nom || ""));
export const deNom = (nom) => (VOYELLE.test(String(nom || "")) ? `d'${nom}` : `de ${nom}`);
export const queNom = (nom) => (VOYELLE.test(String(nom || "")) ? `qu'${nom}` : `que ${nom}`);

// Premier mot du nom affiché d'un compte, sinon la partie de l'e-mail avant @ (« anais.z@… » → « Anais.z »).
export function prenomDe(profil) {
  const nom = String((profil && profil.nom) || "").trim();
  if (nom) return nom.split(/\s+/)[0];
  const mail = String((profil && profil.email) || "").split("@")[0].trim();
  return mail ? mail[0].toUpperCase() + mail.slice(1) : "";
}

// Les administrateurs d'une entreprise, dans l'ordre où ils sont arrivés : un rôle « tous les droits » ou qui modifie les réglages.
// `profils`, `membres`, `roles` : ce que la personne connectée peut lire (tout pour l'administration, rien pour l'assistante).
export function administrateursDe({ profils = [], membres = [], roles = [], entiteId = null } = {}) {
  const admin = new Set(roles.filter((r) => r.entite_id === entiteId && (r.tous_droits || (r.permissions || []).includes("reglages.ecrire"))).map((r) => r.id));
  const parId = new Map(profils.filter((p) => p.actif !== false).map((p) => [p.user_id, p]));
  const ordre = (p) => String(p.created_at || "");
  const membresAdmin = membres.filter((m) => m.entite_id === entiteId && admin.has(m.role_id)).map((m) => parId.get(m.user_id)).filter(Boolean);
  const supers = profils.filter((p) => p.actif !== false && p.super_admin);
  const vus = new Set();
  return [...supers, ...membresAdmin].sort((a, b) => ordre(a).localeCompare(ordre(b))).filter((p) => (vus.has(p.user_id) ? false : vus.add(p.user_id)));
}

// La personne responsable de l'entreprise : celle choisie dans Réglages (reglages.responsable), sinon la première administratrice.
// Rend { user_id, prenom, prenom_th } ; prenom vide quand personne n'est connu (l'assistante ne lit pas les profils de l'équipe).
// `prenom_th` : le prénom écrit en thaï pour les écrans de l'assistante thaïe, sinon le prénom tel quel.
export function responsableDe(reglages, donnees = {}) {
  const r = (reglages && reglages.responsable) || {};
  const prenom = String(r.prenom || "").trim();
  if (prenom) return { user_id: r.user_id || null, prenom, prenom_th: String(r.prenom_th || "").trim() || prenom };
  const premier = administrateursDe(donnees)[0];
  const p = premier ? prenomDe(premier) : "";
  return { user_id: premier ? premier.user_id : null, prenom: p, prenom_th: p };
}

// Textes quand personne n'est connu : on parle de « la personne responsable ».
export const RESPONSABLE_INCONNU = { fr: "la personne responsable", th: "ผู้ดูแล" };
// Les variables des textes de l'assistante : {responsable} (« Anaïs ») et {de_responsable} (« d'Anaïs »). Sans prénom connu, « la personne
// responsable » ; `thai` : dans un texte thaï, le mot thaï pour la personne qui gère (ผู้ดูแล).
export const varsResponsable = (resp, { thai = false } = {}) => {
  const p = resp && resp.prenom;
  return { responsable: p || (thai ? RESPONSABLE_INCONNU.th : RESPONSABLE_INCONNU.fr), de_responsable: p ? deNom(p) : `de ${RESPONSABLE_INCONNU.fr}` };
};
export const remplirResponsable = (texte, resp, options) => {
  const v = varsResponsable(resp, options);
  return String(texte ?? "").replace(/\{(responsable|de_responsable)\}/g, (_, k) => v[k]);
};

// Libellé de la licence sur les devis et factures : celui de l'entreprise (emetteur.licence_libelle, en anglais licence_libelle_en),
// sinon « Licence ». Les entreprises d'Anaïs ont « Licence TAT » et « TAT licence » (migration 44).
export function libelleLicence(emetteur, enClient) {
  const e = emetteur || {};
  const fr = String(e.licence_libelle || "").trim() || "Licence";
  return enClient ? String(e.licence_libelle_en || "").trim() || (e.licence_libelle ? fr : "Licence") : fr;
}

// Le texte d'un pied de booking : {ENTREPRISE} devient le nom de l'entreprise du voucher en capitales (comme sur le modèle de Secret).
export const avecMarque = (texte, nomSociete) => String(texte ?? "").replaceAll("{ENTREPRISE}", String(nomSociete || "").trim().toUpperCase());

// Libellé du rôle d'administration de l'organisation (profils.super_admin) : celui de l'organisation (organisations.libelle_admin),
// sinon le libellé neutre. Clé française : la traduction anglaise passe par tr() à l'affichage.
export const LIBELLE_ADMIN_NEUTRE = N_("Administration de l'organisation");
export const libelleAdmin = (org) => String((org && org.libelle_admin) || "").trim() || LIBELLE_ADMIN_NEUTRE;
