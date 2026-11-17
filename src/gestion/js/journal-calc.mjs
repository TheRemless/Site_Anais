// Valeurs du journal d'activité en mots (contrôle du 17.11.2026, D13) : un identifiant de prestation, de partenaire, de trajet, de client ou de
// personne devient son nom, les personnes « 2 adultes, 1 enfant », un vrai/faux « oui » ou « non ». Logique pure, testée avec node --test.
import { personnesTexte, STATUTS_RESERVATION } from "./operations-calc.mjs";
import { tr, N_ } from "./i18n.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `ctx` : { prestations, trajets, partenaires, clients, personnes (Map user_id → nom) }. Un identifiant qui ne se retrouve plus (fiche supprimée)
// est dit « (supprimé) » plutôt qu'affiché brut.
export function valeurJournal(cle, v, ctx = {}) {
  if (v === null || v === undefined || v === "") return tr("vide");
  const chercher = (liste, nom) => {
    const x = (liste || []).find((y) => y.id === v);
    return x ? nom(x) : tr("(supprimé)");
  };
  if (cle === "prestation_id") return chercher(ctx.prestations, (x) => x.libelle || "");
  if (cle === "trajet_id") return chercher(ctx.trajets, (x) => `${x.de} → ${x.vers}${x.depart ? `, ${x.depart}` : ""}`);
  if (cle === "partenaire_id") return chercher(ctx.partenaires, (x) => x.nom || "");
  if (cle === "client_id") return chercher(ctx.clients, (x) => [x.prenom, x.nom].filter(Boolean).join(" "));
  if (["responsable_id", "assignee_id", "fait_par"].includes(cle)) return (ctx.personnes && ctx.personnes.get(v)) || tr("une personne");
  if (cle === "personnes" && typeof v === "object") return personnesTexte(v) || "0";
  if (cle === "statut" && STATUTS_RESERVATION[v]) return tr(STATUTS_RESERVATION[v]);
  if (typeof v === "boolean") return v ? tr("oui") : tr("non");
  if (typeof v === "object" && !Array.isArray(v)) return detailsEnMots(v);
  if (Array.isArray(v)) return v.every((x) => typeof x === "string" && UUID.test(x)) ? tr("{n} fiche(s) liée(s)", { n: v.length }) : JSON.stringify(v);
  // Un identifiant brut dans un champ inconnu ne dit rien à personne.
  if (typeof v === "string" && UUID.test(v)) return tr("(fiche liée)");
  return String(v);
}

// Les détails d'une réservation (champs du voucher, lignes de facture, envois) : chaque champ en mots, les identifiants comptés, jamais recopiés.
const NOMS_DETAILS = { lignes_ids: N_("lignes de facture"), voucher_fige: N_("voucher figé"), envois: N_("envois"), modele_voucher: N_("modèle de voucher"), personnes_du_dossier: N_("personnes du dossier"), jours: N_("jours"), remarques: N_("remarques"), drop_off: N_("drop-off"), vol: N_("vol"), pickup_zone: N_("zone de pickup") };
function detailsEnMots(o) {
  const entrees = Object.entries(o).filter(([, x]) => x !== null && x !== undefined && x !== "");
  if (!entrees.length) return tr("vide");
  const mot = (x) => (Array.isArray(x) ? (x.every((y) => typeof y === "string" && UUID.test(y)) ? String(x.length) : x.join(", ")) : typeof x === "object" ? "…" : typeof x === "boolean" ? (x ? tr("oui") : tr("non")) : UUID.test(String(x)) ? tr("(fiche liée)") : String(x));
  return entrees.map(([k, x]) => `${NOMS_DETAILS[k] ? tr(NOMS_DETAILS[k]) : k} : ${mot(x)}`).join(" ; ");
}
