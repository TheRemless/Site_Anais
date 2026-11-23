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

function construire({ guide: guideBrut, reglages, offres }) {
  // Les sorties à photo alternent : photo à gauche, puis à droite ; une sortie « grande » (photo pleine largeur de colonne) coupe le rythme.
  const guide = { ...guideBrut, sections: (guideBrut.sections || []).map((sec) => {
    let n = 0;
    return { ...sec, groupes: sec.groupes && sec.groupes.map((g) => {
      if (!g.photo || g.grand) return g;
      n += 1;
      return { ...g, cote: n % 2 === 1 ? "gauche" : "droite" };
    }) };
  }) };
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
        // Dans une même sortie, la phrase des droits du parc, celle de la saison et les faits identiques ne sont écrits qu'une fois : sous la première formule qui les porte.
        for (const sec of guide.sections || []) for (const g of sec.groupes || []) {
          let vu = "", vuF = "";
          const faitsVus = new Set();
          for (const id of g.offres || []) {
            const o = out[id];
            if (!o) continue;
            // Un fait déjà dit sous une formule de la même sortie n'est pas redit sous les suivantes.
            if (o.faits) o.faits = o.faits.filter((f) => { if (faitsVus.has(f)) return false; faitsVus.add(f); return true; });
            if (o.parc) { const cle = JSON.stringify(o.parc); if (cle === vu) o.parcRepete = true; else vu = cle; }
            if (o.fermeture) { const cle = JSON.stringify(o.fermeture); if (cle === vuF) o.fermetureRepete = true; else vuF = cle; }
          }
        }
        return out;
      }
    }
  };
}

module.exports = { construire, GARDER };
