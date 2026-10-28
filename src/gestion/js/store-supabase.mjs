// Stockage réel : Supabase (Postgres) avec connexion e-mail et mot de passe.
import { createClient } from "../vendor/supabase.mjs";
import { REGLAGES_DEFAUT } from "./defauts.mjs";

const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue"];
const PAGE = 1000;

function verifie({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export function creer(config) {
  const sb = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

  async function toutes(table) {
    const lignes = [];
    for (let debut = 0; ; debut += PAGE) {
      const page = verifie(await sb.from(table).select("*").order("created_at").range(debut, debut + PAGE - 1));
      lignes.push(...page);
      if (page.length < PAGE) return lignes;
    }
  }

  return {
    mode: "supabase",
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session ? { email: data.session.user.email } : null;
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
      for (const t of TABLES) out[t] = await toutes(t);
      const r = verifie(await sb.from("reglages").select("valeur").eq("cle", "principal").maybeSingle());
      out.reglages = r ? r.valeur : REGLAGES_DEFAUT;
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
    async enregistrerReglages(reglages) {
      verifie(await sb.from("reglages").upsert({ cle: "principal", valeur: reglages }).select());
    },
    async importer(tables) {
      // Ordre imposé par les clés étrangères.
      for (const t of TABLES) {
        const rows = tables[t] || [];
        for (let i = 0; i < rows.length; i += 200) verifie(await sb.from(t).upsert(rows.slice(i, i + 200)).select("id"));
      }
      if (tables.reglages) await this.enregistrerReglages(tables.reglages);
    },
  };
}
