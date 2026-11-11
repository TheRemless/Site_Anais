// Résumé du mois en texte, prêt à coller dans WhatsApp. Logique pure : les faits, la devise et le jour entrent, le texte sort.
import { formatMontant } from "./calc.mjs";
import { tr, moisLong, pluriel, N_ } from "./i18n.mjs";
import { periodeRapide, periodeComparee, comparer, valeur, disponible } from "./stats-calc.mjs";

const signe = (e) => (!e ? "" : e.pct === null ? (e.sens === "nouveau" ? tr("nouveau") : tr("stable")) : e.pct === 0 ? tr("stable") : `${e.pct > 0 ? "+" : ""}${e.pct} %`);

// Le mois en cours jusqu'à `jour`, comparé aux mêmes jours du mois précédent.
export function resumeMois({ faits, jour, devise, entite }) {
  const [du, au] = periodeRapide("mois", jour);
  const cmp = periodeComparee(du, au, "prec");
  const c = { du, au, jour, devise };
  const m = (v) => formatMontant(v, devise);
  const ligne = (libelle, id) => {
    const r = comparer(id, faits, c, cmp);
    const compare = r.ecart ? ` (${signe(r.ecart)}, ${tr("avant : {valeur}", { valeur: m(r.precedent.montant) })})` : "";
    return `${tr(libelle)} : ${m(r.actuel.montant)}${compare}`;
  };
  const lignes = [`*${tr("Résumé de {mois}", { mois: `${moisLong(du)} ${du.slice(0, 4)}` })}* · ${entite}`, tr("Du {du} au {au}", { du: Number(du.slice(8)), au: Number(au.slice(8)) }), ""];
  lignes.push(ligne(N_("Volume vendu"), "vendu"), ligne(N_("Encaissé chez nous"), "encaisse"));
  if (disponible("commission_recue", faits)) {
    const a = valeur("commission_a_recevoir", faits, c);
    lignes.push(`${ligne(N_("Commissions reçues"), "commission_recue")}`, `${tr("Commissions à recevoir")} : ${m(a.montant)}`);
  }
  const ar = valeur("a_encaisser", faits, c);
  const s7 = valeur("a_venir_7", faits, c);
  const dv = valeur("devis_attente", faits, c);
  lignes.push(`${tr("Reste à encaisser")} : ${m(ar.montant)} (${pluriel(ar.nombre, N_("dossier"), N_("dossiers"))})`, `${tr("Services des 7 prochains jours")} : ${s7.nombre} (${m(s7.montant)})`, `${tr("Devis en attente")} : ${dv.nombre} (${m(dv.montant)})`);
  return lignes.join("\n");
}
