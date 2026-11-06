// Stockage réel : Supabase (Postgres) avec connexion e-mail et mot de passe.
// Les droits sont appliqués par la base (règles RLS), pas par ce fichier.
import { createClient } from "../vendor/supabase.mjs";
import { tr } from "./i18n.mjs";

// Ordre d'import imposé par les clés étrangères.
const TABLES = ["clients", "dossiers", "documents", "paiements", "catalogue", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets", "taches"];
// Documents et paiements ne se chargent pas à la connexion : ils sont lourds et nombreux. Chaque dossier porte un
// résumé (total, encaissé, devise) tenu à jour par la base, le détail se charge à l'ouverture du dossier.
// Les tables de nets reviennent vides pour qui n'a pas le droit « partenaires.nets » : la base filtre.
const CHARGEES = ["clients", "dossiers", "catalogue", "partenaires", "partenaires_prives", "prestations", "prestations_nets", "trajets", "trajets_nets", "reservations", "reservations_nets"];
const LIMITE_FICHIER = 10 * 1024 * 1024;
const PAGE = 1000;
// Colonne de tri de chaque table (toutes n'ont pas de created_at).
const TRI = { membres: "entite_id", reglages: "entite_id", dossiers_resume: "dossier_id", partenaires_prives: "partenaire_id", prestations_nets: "prestation_id", trajets_nets: "trajet_id", reservations_nets: "reservation_id" };

// Modification refusée : la ligne a été modifiée par quelqu'un d'autre depuis qu'on l'a lue (son `updated_at` a changé).
function conflit() {
  const e = new Error(tr("Cette fiche a été modifiée par quelqu'un d'autre depuis que vous l'avez ouverte."));
  e.conflit = true;
  return e;
}

function verifie({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

const fusion = (dossier, r) => (r ? { ...dossier, total: Number(r.total), devise: r.devise, recu: Number(r.recu) } : dossier);

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
      if (error) throw new Error(error.message === "Invalid login credentials" ? tr("E-mail ou mot de passe incorrect.") : error.message);
    },
    async deconnecter() {
      await sb.auth.signOut();
    },
    async charger() {
      const out = {};
      for (const t of ["entites", "profils", "roles", "membres", ...CHARGEES]) out[t] = await toutes(t);
      const resumes = new Map((await toutes("dossiers_resume")).map((r) => [r.dossier_id, r]));
      out.dossiers = out.dossiers.map((d) => fusion(d, resumes.get(d.id)));
      out.documents = [];
      out.paiements = [];
      // Les tâches à faire, et celles terminées depuis un mois.
      const depuis = new Date(Date.now() - 30 * 86400000).toISOString();
      out.taches = verifie(await sb.from("taches").select("*").or(`fait.eq.false,fait_le.gte.${depuis}`).order("echeance", { nullsFirst: false }).limit(2000));
      const lignesReglages = await toutes("reglages");
      out.reglages = Object.fromEntries(lignesReglages.map((r) => [r.entite_id, r.valeur]));
      // Version de chaque réglage (migration 15) : sert à refuser d'écraser l'enregistrement d'une autre personne.
      out.reglages_maj = Object.fromEntries(lignesReglages.map((r) => [r.entite_id, r.updated_at]));
      return out;
    },
    async inserer(table, row) {
      return verifie(await sb.from(table).insert(row).select().single());
    },
    // `avant` : la version (`updated_at`) de la ligne telle que l'outil l'a lue. Si la ligne a changé depuis, rien n'est écrit et l'erreur porte `conflit`.
    async modifier(table, id, patch, avant) {
      let q = sb.from(table).update(patch).eq("id", id);
      if (avant) q = q.eq("updated_at", avant);
      const lignes = verifie(await q.select());
      if (!lignes.length) throw avant ? conflit() : new Error(tr("Modification refusée : la fiche n'existe plus ou vos droits ne la permettent pas."));
      return lignes[0];
    },
    async supprimer(table, id) {
      verifie(await sb.from(table).delete().eq("id", id).select());
    },
    async enregistrerReglages(entiteId, valeur, avant) {
      if (avant) {
        const lignes = verifie(await sb.from("reglages").update({ valeur }).eq("entite_id", entiteId).eq("updated_at", avant).select("updated_at"));
        if (!lignes.length) throw conflit();
        return lignes[0].updated_at;
      }
      const lignes = verifie(await sb.from("reglages").upsert({ entite_id: entiteId, valeur }).select());
      return lignes[0] && lignes[0].updated_at;
    },
    // Langue de l'interface de la personne connectée (migration 13). Sans la migration l'appel échoue : l'outil garde alors la langue dans ce navigateur.
    async definirMaLangue(code) {
      verifie(await sb.rpc("definir_ma_langue", { l: code }));
    },
    // Versions précédentes d'un devis ou d'une facture, et dossiers supprimés des 90 derniers jours (migration 15).
    async versionsDocument(docId) {
      return verifie(await sb.from("documents_historique").select("id, archive_le, ligne").eq("document_id", docId).eq("action", "update").order("archive_le", { ascending: false }).limit(30));
    },
    async corbeille(entiteId) {
      return verifie(await sb.from("corbeille").select("id, ligne, liees, supprime_par, supprime_le").eq("entite_id", entiteId).eq("table_name", "dossiers").order("supprime_le", { ascending: false }));
    },
    async restaurerDossier(id) {
      return verifie(await sb.rpc("restaurer_dossier", { p_id: id }));
    },
    // Numéro suivant de la séquence annuelle (migration 14). Échoue tant que la migration n'est pas appliquée : l'appelant garde alors son calcul.
    async prochainNumeroRef(entiteId, annee, minimum) {
      return verifie(await sb.rpc("prochain_numero_ref", { p_entite: entiteId, p_annee: annee, p_minimum: minimum }));
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
    // Un dossier avec son résumé à jour (après une modification de ses documents ou paiements).
    async resumeDossier(id) {
      const d = verifie(await sb.from("dossiers").select("*").eq("id", id).maybeSingle());
      if (!d) return null;
      return fusion(d, verifie(await sb.from("dossiers_resume").select("*").eq("dossier_id", id).maybeSingle()));
    },
    async dossierComplet(id) {
      const [dossier, documents, paiements] = await Promise.all([this.resumeDossier(id), sb.from("documents").select("*").eq("dossier_id", id).order("created_at"), sb.from("paiements").select("*").eq("dossier_id", id).order("date")]);
      return { dossier, documents: verifie(documents), paiements: verifie(paiements) };
    },
    async documentComplet(docId) {
      const doc = verifie(await sb.from("documents").select("dossier_id").eq("id", docId).maybeSingle());
      return doc ? this.dossierComplet(doc.dossier_id) : null;
    },
    async paiementsPeriode({ entiteId, du, au }) {
      return verifie(await sb.from("paiements").select("*").eq("entite_id", entiteId).gte("date", du).lte("date", au).order("date"));
    },
    async tousDocuments(entiteId) {
      const lignes = [];
      for (let debut = 0; ; debut += PAGE) {
        const page = verifie(await sb.from("documents").select("*").eq("entite_id", entiteId).order("created_at").range(debut, debut + PAGE - 1));
        lignes.push(...page);
        if (page.length < PAGE) return lignes;
      }
    },
    async tousPaiements(entiteId) {
      const lignes = [];
      for (let debut = 0; ; debut += PAGE) {
        const page = verifie(await sb.from("paiements").select("*").eq("entite_id", entiteId).order("date").range(debut, debut + PAGE - 1));
        lignes.push(...page);
        if (page.length < PAGE) return lignes;
      }
    },
    // Pièces jointes : le fichier va dans le stockage privé, une ligne en garde le nom et le chemin.
    async piecesDossier(dossierId) {
      return verifie(await sb.from("pieces_jointes").select("*").eq("dossier_id", dossierId).order("created_at", { ascending: false }));
    },
    async ajouterPiece({ entiteId, dossierId, fichier }) {
      if (fichier.size > LIMITE_FICHIER) throw new Error(tr("Fichier trop lourd (10 Mo maximum)."));
      const sain = fichier.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
      const chemin = `${entiteId}/${dossierId}/${crypto.randomUUID()}-${sain}`;
      const { error } = await sb.storage.from("pieces").upload(chemin, fichier, { contentType: fichier.type || "application/octet-stream" });
      if (error) throw new Error(error.message);
      try {
        return verifie(await sb.from("pieces_jointes").insert({ entite_id: entiteId, dossier_id: dossierId, nom: fichier.name, type: fichier.type, taille: fichier.size, chemin }).select().single());
      } catch (err) {
        await sb.storage.from("pieces").remove([chemin]);
        throw err;
      }
    },
    async lienPiece(piece) {
      const { data, error } = await sb.storage.from("pieces").createSignedUrl(piece.chemin, 300, { download: piece.nom });
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    async supprimerPiece(piece) {
      verifie(await sb.from("pieces_jointes").delete().eq("id", piece.id).select());
      await sb.storage.from("pieces").remove([piece.chemin]);
    },
    // Tableau analytique : tous les chiffres sont calculés par la base.
    async analyses({ entiteId, du, au, jour }) {
      return verifie(await sb.rpc("tableau_analytique", { e: entiteId, du, au, jour }));
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
    // Remplacement de la base partenaires : les tâches liées à un partenaire, puis les partenaires (la base supprime
    // en cascade prestations, trajets, nets et données privées ; les réservations gardent leur libellé).
    async supprimerPartenaires(entiteId) {
      verifie(await sb.from("taches").delete().eq("entite_id", entiteId).not("partenaire_id", "is", null).select("id"));
      verifie(await sb.from("partenaires").delete().eq("entite_id", entiteId).select("id"));
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
