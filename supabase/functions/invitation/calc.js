// Fonction « invitation » de Gestion : la logique pure (lecture et contrôle de la demande), sans dépendance.
// Le même fichier sert à la fonction Supabase (Deno) et aux tests (node --test).
//
// Trois gestes, réservés à l'administrateur d'une organisation (vérifié côté serveur par est_super_admin() avec la session de la personne),
// et toujours limités aux comptes et aux entreprises de SON organisation (migration 42) :
//   * « inviter » : crée le compte, son nom, sa langue et ses accès, et rend un lien d'invitation à envoyer soi-même (WhatsApp, e-mail) ;
//   * « lien_mot_de_passe » : rend un lien pour choisir un nouveau mot de passe (mot de passe oublié, invitation expirée) ;
//   * « supprimer » : supprime le compte. Ses dossiers restent, sans responsable ; ses accès partent avec lui.
// Un quatrième, « creer_client », est réservé à l'éditeur du logiciel (est_plateforme()) : il crée le compte du futur administrateur d'un client
// et son organisation (creer_organisation), pendant l'appel de mise en route.
// La fonction n'envoie aucun e-mail : elle ne dépend pas du serveur d'envoi de Supabase. Le lien n'est jamais écrit dans le journal.

export const ACTIONS = ["inviter", "lien_mot_de_passe", "supprimer", "creer_client"];
export const LANGUES = ["fr", "en"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

export const estUuid = (v) => typeof v === "string" && UUID.test(v);
export const normaliserEmail = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
export const emailValide = (v) => v.length <= 254 && EMAIL.test(v);

// L'adresse de retour du lien doit être l'outil lui-même : jamais une adresse choisie par la demande hors de la liste.
export function redirectionAutorisee(url, origines) {
  if (typeof url !== "string" || url.length > 500) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (origines || []).includes(u.origin) && !u.username && !u.password;
}

// Lit et contrôle la demande. Renvoie { ok: true, action, ... } ou { ok: false, erreur }.
export function lireDemande(demande, { origines = [] } = {}) {
  if (!demande || typeof demande !== "object") return { ok: false, erreur: "demande_invalide" };
  const { action } = demande;
  if (!ACTIONS.includes(action)) return { ok: false, erreur: "action_inconnue" };
  if (action === "supprimer") {
    if (!estUuid(demande.user_id)) return { ok: false, erreur: "personne_invalide" };
    return { ok: true, action, userId: demande.user_id };
  }
  if (!redirectionAutorisee(demande.retour, origines)) return { ok: false, erreur: "retour_refuse" };
  if (action === "lien_mot_de_passe") {
    if (!estUuid(demande.user_id)) return { ok: false, erreur: "personne_invalide" };
    return { ok: true, action, userId: demande.user_id, retour: demande.retour };
  }
  const email = normaliserEmail(demande.email);
  if (!emailValide(email)) return { ok: false, erreur: "email_invalide" };
  const nom = typeof demande.nom === "string" ? demande.nom.trim().slice(0, 120) : "";
  const langue = LANGUES.includes(demande.langue) ? demande.langue : null;
  if (action === "creer_client") {
    const organisation = typeof demande.organisation === "string" ? demande.organisation.trim().slice(0, 120) : "";
    if (!organisation) return { ok: false, erreur: "organisation_invalide" };
    const fuseau = typeof demande.fuseau === "string" && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(demande.fuseau) && demande.fuseau.length <= 60 ? demande.fuseau : "Asia/Bangkok";
    return { ok: true, action, email, nom, langue: langue || "en", organisation, fuseau, retour: demande.retour };
  }
  const acces = Array.isArray(demande.acces) ? demande.acces : [];
  if (acces.length > 30) return { ok: false, erreur: "acces_invalide" };
  const vus = new Set();
  for (const a of acces) {
    if (!a || !estUuid(a.entite_id) || !estUuid(a.role_id) || vus.has(a.entite_id)) return { ok: false, erreur: "acces_invalide" };
    vus.add(a.entite_id);
  }
  return { ok: true, action, email, nom, langue, acces: acces.map((a) => ({ entite_id: a.entite_id, role_id: a.role_id })), retour: demande.retour };
}

// Chaque rôle demandé appartient bien à l'entreprise demandée (rôles lus en base par la fonction).
export function accesCoherents(acces, roles) {
  return acces.every((a) => (roles || []).some((r) => r.id === a.role_id && r.entite_id === a.entite_id));
}

// Un compte d'une autre organisation est traité comme inconnu : l'administrateur d'un client n'apprend même pas qu'il existe.
export const memeOrganisation = (organisationAppelant, cible) => !!organisationAppelant && !!cible && cible.organisation_id === organisationAppelant;

// Chaque entreprise demandée appartient à l'organisation de l'appelant (entreprises lues en base par la fonction).
export const entreprisesDeLOrganisation = (acces, entites, organisation) => acces.every((a) => (entites || []).some((e) => e.id === a.entite_id && e.organisation_id === organisation));

// Supprimer un compte : jamais le sien, jamais un compte d'une autre organisation, jamais le dernier administrateur actif de l'organisation.
export function suppressionPermise({ appelant, cible, superAdminsActifs, organisation = undefined }) {
  if (!cible) return { ok: false, erreur: "personne_inconnue" };
  if (organisation !== undefined && !memeOrganisation(organisation, cible)) return { ok: false, erreur: "personne_inconnue" };
  if (cible.user_id === appelant) return { ok: false, erreur: "soi_meme" };
  if (cible.super_admin && cible.actif && superAdminsActifs <= 1) return { ok: false, erreur: "derniere_administratrice" };
  return { ok: true };
}

// L'erreur de Supabase quand l'adresse a déjà un compte (le texte varie selon les versions).
export const dejaInscrit = (message) => /already (been )?registered|already exists|email_exists|user_already_exists/i.test(String(message || ""));
