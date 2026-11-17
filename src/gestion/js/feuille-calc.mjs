// Feuille du jour : les lignes d'une date, ce qui manque encore et le texte à copier. Testé avec node --test.
import { dateTexte, personnesTexte, feuilleDuJour, hotelEtChambre, estFraisDeParc, dateFinService } from "./operations-calc.mjs";
import { libelleClient } from "./partenaires-calc.mjs";
import { estRetourDepart } from "./trajet-calc.mjs";

const joursEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// Ce que le chauffeur lit en plus de l'hôtel, en anglais : le drop-off et le vol d'un transfert (un retour au point de départ a déjà son programme),
// « Return » le jour où une location se rend, « Ongoing rental, day 2 of 4 » les jours entre la prise et le retour (17.11.2026, audit n° 29).
// Le jour de la prise d'une location, la date de retour.
function precisionPickup(r) {
  const dt = (r && r.details) || {};
  const fin = r ? dateFinService(r) : null;
  return [
    !estRetourDepart(r) && String(dt.drop_off || "").trim() ? `Drop-off: ${libelleClient(String(dt.drop_off).trim())}` : "",
    String(dt.vol || "").trim() ? `Flight ${String(dt.vol).trim()}` : "",
    fin && fin > r.date_service ? `Return ${dateTexte(fin, "en")}${String(dt.retour_heure || "").trim() ? ` ${String(dt.retour_heure).trim()}` : ""}` : "",
  ].filter(Boolean).join(" · ");
}

// La feuille d'une date. Les pickups du jour viennent de `feuilleDuJour` (operations-calc.mjs), qui ne lit que la date de service ; s'y ajoutent les locations
// de plusieurs jours, d'après leur date de retour (`details.retour_date`, champ des seules locations) :
// - le jour du retour, une ligne « retour » à l'heure et au lieu de retour (sinon le lieu de prise) ;
// - chaque jour entre la prise et le retour, une ligne « en cours », sans heure, pour que la location ne disparaisse pas de la feuille.
// Chaque ligne a `sorte` (« pickup », « retour », « en_cours ») et `precision`. Les personnes de l'en-tête ne comptent que les pickups.
export function feuilleJour(reservations, date, contexte, ecartees = new Set()) {
  const parId = new Map((reservations || []).map((r) => [r.id, r]));
  const groupes = feuilleDuJour(reservations || [], date, contexte, ecartees).map((g) => ({ ...g, lignes: g.lignes.map((l) => ({ ...l, sorte: "pickup", precision: precisionPickup(parId.get(l.id)) })) }));
  const groupeDe = (r) => {
    const cle = r.partenaire_id || null;
    let g = groupes.find((x) => (x.partenaire_id || null) === cle);
    if (!g) groupes.push((g = { partenaire_id: cle, nom: (cle && contexte.partenaire(cle)) || "", lignes: [], adultes: 0, enfants: 0 }));
    return g;
  };
  for (const r of reservations || []) {
    if (!r.date_service || r.statut === "annule" || ecartees.has(r.dossier_id) || estFraisDeParc(r)) continue;
    const fin = dateFinService(r);
    if (!(fin > r.date_service) || !(date > r.date_service) || date > fin) continue;
    const retour = date === fin;
    const dt = r.details || {};
    const c = contexte.client(r) || {};
    const lieu = retour && String(dt.retour_lieu || "").trim() ? { hotel: String(dt.retour_lieu).trim(), chambre: "" } : retour ? hotelEtChambre(c, r) : { hotel: "", chambre: "" };
    const total = joursEntre(r.date_service, fin) + 1;
    groupeDe(r).lignes.push({
      id: r.id,
      sorte: retour ? "retour" : "en_cours",
      heure: retour ? String(dt.retour_heure || "") : "",
      client: [c.prenom, c.nom].filter(Boolean).join(" "),
      telephone: c.telephone || "",
      hotel: lieu.hotel,
      chambre: lieu.chambre,
      personnes: r.personnes || {},
      libelle: r.libelle,
      reference: r.reference_partenaire || "",
      statut: r.statut,
      trajet: "",
      precision: retour ? "Return" : `Ongoing rental, day ${joursEntre(r.date_service, date) + 1} of ${total}, return ${dateTexte(fin, "en")}`,
    });
  }
  const ordre = (l) => (l.sorte === "en_cours" ? "~" : l.heure || "99");
  return groupes
    .filter((g) => g.lignes.length)
    .map((g) => ({ ...g, lignes: g.lignes.sort((a, b) => ordre(a).localeCompare(ordre(b)) || a.client.localeCompare(b.client)) }))
    .sort((a, b) => (a.nom || "~").localeCompare(b.nom || "~"));
}

// Les pickups d'une feuille (groupes de `feuilleJour`) sans heure ou sans hôtel : le chauffeur ne peut pas les faire.
// Renvoie [{ id, libelle, client, manque: ["heure", "hotel"] }], dans l'ordre de la feuille. Le retour et les jours d'une location ne sont pas des pickups.
export function alertesFeuille(groupes) {
  const out = [];
  for (const g of groupes) {
    for (const l of g.lignes) {
      if (l.sorte && l.sorte !== "pickup") continue;
      const manque = [];
      if (!String(l.heure || "").trim()) manque.push("heure");
      if (!String(l.hotel || "").trim()) manque.push("hotel");
      if (manque.length) out.push({ id: l.id, libelle: l.libelle, client: l.client, manque });
    }
  }
  return out;
}

// Texte WhatsApp d'un groupe, en anglais. Une heure ou un lieu inconnu est écrit « time TBC » ou « pickup TBC » plutôt que laissé vide,
// pour que le chauffeur sache qu'il manque quelque chose et ne le devine pas.
// Un groupe sans pickup ce jour-là (seulement des retours ou des locations en cours) n'annonce pas « 0 passengers ».
export function texteFeuillePartage(groupe, date) {
  const pickups = groupe.lignes.some((l) => !l.sorte || l.sorte === "pickup");
  const tete = `${groupe.nom ? `${groupe.nom}: ` : ""}${dateTexte(date, "en")}${pickups ? `, ${personnesTexte({ adultes: groupe.adultes, enfants: groupe.enfants }, "en") || "0 passengers"}` : ""}`;
  const lignes = groupe.lignes.map((l) =>
    [
      l.sorte === "en_cours" ? "" : l.heure || "time TBC",
      l.sorte === "retour" ? "RETURN" : "",
      libelleClient(l.libelle),
      l.client,
      l.telephone,
      l.sorte === "en_cours" ? "" : [l.hotel, l.chambre ? `room ${l.chambre}` : ""].filter(Boolean).join(", ") || (l.sorte === "retour" ? "place TBC" : "pickup TBC"),
      // Retour au point de départ : le programme et la durée, pour que le chauffeur sache ce qui est prévu (16.11.2026).
      l.trajet,
      l.sorte === "retour" ? "" : l.precision,
      personnesTexte(l.personnes, "en"),
    ]
      .filter(Boolean)
      .join(" · ")
  );
  return [tete, ...lignes].join("\n");
}

// Les trois jours proposés en un tap : aujourd'hui, demain, après-demain.
export const joursProposes = (ajd) => [0, 1, 2].map((n) => new Date(Date.UTC(+ajd.slice(0, 4), +ajd.slice(5, 7) - 1, +ajd.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10));

const plus = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
// Dates proposées pour reporter une tâche : demain, dans 2 jours, le prochain lundi (jamais aujourd'hui), dans une semaine.
export function reportsProposes(ajd) {
  const jourSemaine = new Date(`${ajd}T00:00:00Z`).getUTCDay();
  return { demain: plus(ajd, 1), deuxJours: plus(ajd, 2), lundi: plus(ajd, (8 - jourSemaine) % 7 || 7), semaine: plus(ajd, 7) };
}
