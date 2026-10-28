// Stockage réel : Supabase (Postgres) avec connexion e-mail et mot de passe.
// Les droits sont appliqués par la base (règles RLS), pas par ce fichier.
import { createClient } from "../vendor/supabase.mjs";

const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue"];
const PAGE = 1000;
// Colonne de tri de chaque table (toutes n'ont pas de created_at).
const TRI = { membres: "entite_id", reglages: "entite_id" };

function verifie({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export function creer(config) {
  const sb = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

  async function toutes(table) {
    const lignes = [];
    for (let debut = 0; ; debut += PAGE) {
      const page = verifie(await sb.from(table).select("*").order(TRI[table] || "created_at").range(debut, debut + PAGE - 1));
      lignes.push(...page);
      if (page.length < PAGE) return lignes;
    }
  }

  return {
    mode: "supabase",
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session ? { id: data.session.user.id, email: data.session.user.email } : null;
    },
    async connecter(email, mdp) {
      const { error } = await sb.auth.signInWithPassword({ email, password: mdp });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "E-mail ou mot de passe incorrect." : error.message);
    },
    async deconnecter() {
      await sb.auth.signOut();
    },
    async charger() {
      const out = {};
      for (const t of ["entites", "profils", "roles", "membres", ...TABLES]) out[t] = await toutes(t);
      out.reglages = Object.fromEntries((await toutes("reglages")).map((r) => [r.entite_id, r.valeur]));
      return out;
    },
    async inserer(table, row) {
      return verifie(await sb.from(table).insert(row).select().single());
    },
    async modifier(table, id, patch) {
      return verifie(await sb.from(table).update(patch).eq("id", id).select().single());
    },
    async supprimer(table, id) {
      verifie(await sb.from(table).delete().eq("id", id).select());
    },
    async enregistrerReglages(entiteId, valeur) {
      verifie(await sb.from("reglages").upsert({ entite_id: entiteId, valeur }).select());
    },
    async modifierProfil(userId, patch) {
      verifie(await sb.from("profils").update(patch).eq("user_id", userId).select());
    },
    async donnerAcces(userId, entiteId, roleId) {
      verifie(await sb.from("membres").upsert({ user_id: userId, entite_id: entiteId, role_id: roleId }).select());
    },
    async equipe(entiteId) {
      return verifie(await sb.rpc("equipe_de", { e: entiteId }));
    },
    // Journal d'activité : les plus récentes d'abord, par pages (le journal peut devenir très long).
    async journal({ entiteId, table, userId, avant, limite = 50 }) {
      let q = sb.from("journal").select("*").eq("entite_id", entiteId).order("created_at", { ascending: false }).limit(limite);
      if (table) q = q.eq("table_name", table);
      if (userId) q = q.eq("user_id", userId);
      if (avant) q = q.lt("created_at", avant);
      const lignes = verifie(await q);
      const noms = new Map((await sb.rpc("equipe_de", { e: entiteId })).data?.map((p) => [p.user_id, p.nom || p.email]) || []);
      return lignes.map((l) => ({ ...l, auteur: noms.get(l.user_id) || null }));
    },
    async retirerAcces(userId, entiteId) {
      verifie(await sb.from("membres").delete().eq("user_id", userId).eq("entite_id", entiteId).select());
    },
    async importer(tables) {
      // Ordre imposé par les clés étrangères.
      for (const t of TABLES) {
        const rows = tables[t] || [];
        for (let i = 0; i < rows.length; i += 200) verifie(await sb.from(t).upsert(rows.slice(i, i + 200)).select("id"));
      }
    },
  };
}
