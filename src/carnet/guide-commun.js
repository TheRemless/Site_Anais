// Ce qui est commun à tous les guides du carnet (hors Koh Samui, qui a son propre fichier de données) : la configuration envoyée au navigateur
// et la liste des offres affichables, tirées des données du guide. Un guide écrit ses textes et ses offres, puis `module.exports = construire({ … })`.
//
// Règle de publication : seuls `guide` (le texte), `offres` (affichées) et `carnetConfig` (ce que le navigateur reçoit pour calculer l'estimation)
// partent dans la page. Aucun nom de prestataire, aucune donnée de rémunération, aucun lien vers leurs documents : ces informations restent dans Gestion.
// `reglages` ne part pas tel quel (le script en reçoit une copie réduite).

// Champs d'une offre dont le navigateur a besoin : calcul, contrôle de la feuille, messages. Les textes d'affichage (faits, inclus, programme…) n'y sont pas.
const GARDER = [
  "produit", "titre", "titreMeta", "type", "variantes", "variantesLabel", "adulte", "adulteRegle", "enfant", "bebe", "paliers", "capacite",
  "creneaux", "creneauxLabel", "creneauxLabelEn", "choix", "extras", "lignes", "lignesLabel", "lignesLabelEn", "base", "supplement",
  "jours", "joursTexte", "seuilGroupe", "ageMin", "messageObligatoire", "messageAide", "transfert", "pickupLabel", "notePickup", "parc", "fermeture", "angThong", "gestion"
];

// Plus petit prix ADULTE d'une offre (adulte, ligne sans rôle ou d'adulte, tranche, formule, radeau), jamais un tarif enfant : « dès X » d'un groupe replié
// est ce que paie au moins un adulte. null si le prix est sur demande.
function prixMinimum(o) {
  const prix = [];
  const ajoute = (n) => { if (typeof n === "number" && n > 0) prix.push(n); };
  if (o.type === "surDemande" || o.wa) return null;
  if (o.type === "lignes") (o.lignes || []).filter((l) => !l.role || l.role === "adulte").forEach((l) => ajoute(l.prix));
  else if (o.type === "radeau") ajoute(o.base && o.base.prix);
  else if (o.type === "bateau") { (o.variantes || []).forEach((v) => ajoute(v.prix)); (o.paliers || []).forEach((t) => ajoute(t.prix)); }
  else { ajoute(o.adulte); (o.variantes || []).forEach((v) => ajoute(v.adulte)); }
  return prix.length ? Math.min(...prix) : null;
}

function construire({ guide: guideBrut, reglages, offres }) {
  // Chaque groupe replié porte son « dès » calculé sur ses offres affichées.
  const guide = { ...guideBrut, sections: (guideBrut.sections || []).map((sec) => ({ ...sec, groupes: sec.groupes && sec.groupes.map((g) => {
    if (!g.repliable) return g;
    const min = (g.offres || []).map((id) => offres[id] && prixMinimum(offres[id])).filter((n) => n !== null && n !== undefined);
    return { ...g, des: min.length ? Math.min(...min) : undefined };
  }) })) };
  const visibles = () => Object.entries(offres).filter(([, o]) => !o.isole || reglages.afficherIsoles !== false);
  return {
    guide,
    reglages,
    eleventyComputed: {
      carnetConfig: (data) => {
        const publiques = {};
        for (const [id, o] of visibles()) {
          if (o.wa) continue; // renvoi vers WhatsApp seulement : pas de feuille
          publiques[id] = { id, droits: !!(o.surPlace && o.surPlace.length) };
          for (const k of GARDER) if (o[k] !== undefined) publiques[id][k] = o[k];
        }
        const numero = String((data.business && data.business.telephone) || "").replace(/\D/g, "");
        return {
          whatsapp: numero,
          reglages: {
            ouvrirWhatsApp: reglages.ouvrirWhatsApp,
            delaiMinimalMs: reglages.delaiMinimalMs,
            formatGestion: reglages.formatGestion,
            prefixeRef: reglages.prefixeRef
          },
          offres: publiques
        };
      },
      offres: () => {
        const out = {};
        for (const [id, o] of visibles()) out[id] = { id, ...o };
        return out;
      }
    }
  };
}

module.exports = { construire, GARDER, prixMinimum };
