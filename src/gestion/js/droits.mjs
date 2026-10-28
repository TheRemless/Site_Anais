// Droits d'une personne dans une entreprise, calculés comme le fait la base (fonctions permissions_dans et voit_tout).
// La base reste l'autorité : ce fichier sert à adapter l'interface et à simuler les droits en démonstration.
import { TOUTES_PERMISSIONS } from "./defauts.mjs";

const actif = (p) => !!(p && p.actif);

export function roleDans({ profil, membres, roles }, entiteId) {
  if (!actif(profil)) return null;
  const m = membres.find((x) => x.user_id === profil.user_id && x.entite_id === entiteId);
  return (m && roles.find((r) => r.id === m.role_id)) || null;
}

export function permissionsDans(ctx, entiteId) {
  if (actif(ctx.profil) && ctx.profil.super_admin) return TOUTES_PERMISSIONS;
  const r = roleDans(ctx, entiteId);
  return r ? r.permissions : [];
}

export function voitTout(ctx, entiteId) {
  if (actif(ctx.profil) && ctx.profil.super_admin) return true;
  const r = roleDans(ctx, entiteId);
  return !!r && r.portee === "toute";
}
