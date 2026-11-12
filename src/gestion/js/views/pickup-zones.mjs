// Puces de zone de pickup : Anaïs touche la zone de l'hôtel, choisit le départ, et l'heure de pickup du partenaire se remplit d'après sa grille.
// Utilisé dans « Coller une demande » et dans le formulaire de réservation. Le calcul est dans pickup-calc.mjs : aucune heure ne vient d'ailleurs que de la grille.
import { h } from "../ui.mjs";
import { etat } from "../etat.mjs";
import { tr } from "../i18n.mjs";
import { grillesDe, zoneDeCle, heureDeLaGrille, departApresChoix, departDuTrajet, zoneAGarder, cleDeZoneGardee, zoneProposee } from "../pickup-calc.mjs";

// Les réservations qui ont une zone gardée, avec leur hôtel : le lieu de pickup écrit, sinon la première ligne de l'adresse du client (l'hôtel par défaut).
function reservationsAvecZone() {
  const hotelDuClient = (r) => {
    const d = etat.db.dossiers.find((x) => x.id === r.dossier_id);
    const c = d ? etat.db.clients.find((x) => x.id === d.client_id) : null;
    return ((c && c.adresse) || "").split("\n")[0].replace(/,?\s*Room\s+\S+\s*$/i, "").trim();
  };
  return etat.db.reservations.filter((r) => r.details && r.details.pickup_zone).map((r) => ({ ...r, lieu_pickup: r.lieu_pickup || hotelDuClient(r) }));
}

// `partenaire` : () => partenaire ou null. `hotel` : () => texte de l'hôtel. `gardee` : { zone, grille, depart } déjà enregistrée sur la réservation.
// `trajet` : () => { depart, vers } du trajet réservé ou null : son heure de bateau désigne le départ de la grille sans qu'on le choisisse.
// `surChoix({ heure, gardee })` : appelée à chaque choix de la personne (heure vide quand la grille n'en donne pas, gardee null quand la zone est retirée).
// Rend { noeud, rafraichir, valeur, heure }. `rafraichir()` après un changement de partenaire ou d'hôtel ; `valeur()` donne la zone à garder sur la réservation, `heure()` l'heure de la grille pour la zone et le départ choisis.
export function blocZonesPickup({ id, partenaire, hotel = () => "", gardee = null, trajet = () => null, surChoix = () => {} }) {
  let grilles = [];
  let cle = "";
  let depart = "";
  let origine = ""; // « memoire » | « adresse » : zone proposée, pas choisie
  let initiale = gardee;
  const noeud = h("div", { class: "zones-pickup", id });
  noeud.hidden = true;

  // Le départ gardé, le seul de la grille, ou celui que l'heure du bateau du trajet désigne.
  function departPour(zone, courant) {
    const garde = departApresChoix(grilles, zone, courant);
    if (garde) return garde;
    const t = trajet();
    const r = zoneDeCle(grilles, zone);
    return t && r ? departDuTrajet(r.grille, { heure: t.depart, vers: t.vers }) : "";
  }
  const heureActuelle = () => (cle ? heureDeLaGrille(grilles, cle, depart) : "");
  // Une zone seulement proposée (mémoire, adresse) ne se garde pas tant que la personne ne l'a pas confirmée par un choix.
  const valeur = () => (cle && !origine ? zoneAGarder(grilles, cle, depart) : null);

  function choisirZone(nouvelle) {
    // Toucher la zone proposée la confirme ; toucher une zone choisie la retire.
    cle = cle === nouvelle && !origine ? "" : nouvelle;
    origine = "";
    depart = cle ? departPour(cle, depart) : "";
    annoncer();
    dessiner();
  }
  function choisirDepart(v) {
    depart = v;
    origine = "";
    annoncer();
    dessiner();
  }
  const annoncer = () => surChoix({ heure: heureActuelle(), gardee: valeur() });

  function dessiner() {
    noeud.replaceChildren();
    noeud.hidden = !grilles.length;
    if (!grilles.length) return;
    const p = partenaire();
    noeud.append(h("p", { class: "zones-titre" }, tr("Zone de pickup")));
    for (const g of grilles) {
      if (grilles.length > 1) noeud.append(h("p", { class: "zones-grille" }, g.titre));
      noeud.append(
        h("div", { class: "zones-puces", role: "group", "aria-label": g.titre || tr("Zone de pickup") }, g.zones.map((z) => h("button", { type: "button", class: "puce", title: z.libelle, "aria-pressed": z.cle === cle ? "true" : "false", onclick: () => choisirZone(z.cle) }, z.nom)))
      );
    }
    const r = cle ? zoneDeCle(grilles, cle) : null;
    if (r && r.grille.colonnes.length > 1) {
      const sel = h(
        "select",
        { id: id ? `${id}-depart` : undefined, "aria-label": tr("Départ"), onchange: (e) => choisirDepart(e.target.value) },
        h("option", { value: "" }, tr("Choisir le départ")),
        r.grille.colonnes.map((c, i) => h("option", { value: c }, `${c} · ${r.zone.heures[i] || tr("pas de pickup")}`))
      );
      sel.value = depart;
      noeud.append(h("div", { class: "champ" }, h("label", { for: sel.id }, tr("Départ")), sel));
    }
    // Ce que la grille dit, ou ce qu'elle ne dit pas : jamais une heure sans case.
    let texte = "";
    if (r) {
      const heure = heureActuelle();
      if (origine && heure) texte = origine === "memoire" ? tr("Zone retenue d'après une réservation précédente de cet hôtel : touchez-la pour poser l'heure {heure}.", { heure }) : tr("Zone lue dans l'adresse de l'hôtel : touchez-la pour poser l'heure {heure}.", { heure });
      else if (heure) texte = tr("Grille de {partenaire} : {zone}, {depart}, {heure}.", { partenaire: p ? p.nom : "", zone: r.zone.nom, depart: depart, heure });
      else if (depart) texte = tr("La grille n'a pas de pickup pour cette zone et ce départ : l'heure reste à fixer.");
      else if (r.grille.colonnes.length > 1) texte = origine === "memoire" ? tr("Zone retenue d'après une réservation précédente de cet hôtel. Choisissez le départ pour l'heure.") : origine === "adresse" ? tr("Zone lue dans l'adresse de l'hôtel. Choisissez le départ pour l'heure.") : tr("Choisissez le départ pour voir l'heure.");
    }
    if (texte) noeud.append(h("p", { class: "aide", "aria-live": "polite" }, texte));
  }

  // Partenaire ou hôtel changé : les grilles sont relues. La zone déjà choisie reste si ce partenaire la connaît, sinon elle est retrouvée par son nom ; à défaut, la zone
  // d'une réservation précédente du même hôtel ou un nom de zone dans l'adresse est proposé (sélectionné mais sans heure, la personne confirme).
  function rafraichir() {
    // Ce que la personne avait confirmé, lu dans les anciennes grilles avant de les remplacer.
    const avant = valeur();
    if (origine) {
      cle = "";
      depart = "";
      origine = "";
    }
    grilles = grillesDe(partenaire());
    if (cle && !zoneDeCle(grilles, cle)) cle = "";
    if (!cle && (avant || initiale)) {
      cle = cleDeZoneGardee(grilles, avant || initiale);
      if (cle && !depart && (avant || initiale).depart) depart = departApresChoix(grilles, cle, (avant || initiale).depart);
    }
    initiale = null;
    if (!cle) {
      const prop = zoneProposee(hotel(), grilles, reservationsAvecZone());
      if (prop) {
        cle = prop.cle;
        origine = prop.origine;
        depart = departPour(cle, depart);
      }
    }
    if (cle) depart = departPour(cle, depart);
    dessiner();
  }

  rafraichir();
  return { noeud, rafraichir, valeur, heure: heureActuelle };
}
