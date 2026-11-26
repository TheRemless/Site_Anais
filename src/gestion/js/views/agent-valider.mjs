// Validation des cartes de l'onglet Assistant (sorti de views/agent.mjs, relecture de la PR 332, pour que les tests passent par ce code) :
// la préparation d'une carte « dossier » pour la fiche de création, le chauffeur, le règlement et le lieu d'une carte « reservation »,
// l'enregistrement d'une réservation par la fenêtre habituelle (cachée), et la carte « dossier » de l'espace unifié (deux dossiers liés).
import { etat, reglages, nomPartenaire, modeTaxi, modifier, chargerDossier, supprimer as supprimerLigne, changerEntite, permissionsDe, partageClientsPermis } from "../etat.mjs";
import { modal, toast } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { propositionDepuisCarte, reservationDepuisCarte, chauffeurCarte, payeSurPlaceCarte } from "../agent-calc.mjs";
import { propositionVersDemande, carteAvecLaPage } from "../assistant-calc.mjs";
import { demandeEnregistree } from "../demande-calc.mjs";
import { refDeLaPage } from "../carnet-colle.mjs";
import { aujourdhui } from "../calc.mjs";
import { modeParDefaut } from "../operations-calc.mjs";
import { partenaireDeTaxi, chauffeurRegle } from "../voucher-rapide-calc.mjs";
import { planCreation, creerDossiersLies, lierDossiers } from "../espace-unifie-calc.mjs";

const changerSansNaviguer = (id) => etat.entiteId !== id && changerEntite(id, { naviguer: false });

// `demandes` : les demandes du site que la personne peut lire (la liste de l'écran), pour retrouver celle que la page du carnet a enregistrée pour le message joint à la carte.
export const preparation = (c, demandes = etat.db.demandes_site || []) => {
  const contexte = { prestations: etat.db.prestations, trajets: etat.db.trajets, partenaires: etat.db.partenaires, nomPartenaire, taxi: modeTaxi() };
  return carteAvecLaPage({ texte: "", ...propositionVersDemande(propositionDepuisCarte(c.donnees), contexte) }, (c.donnees || {}).message_page, contexte, { demandes, aujourdhui: aujourdhui(), entiteId: etat.entiteId, taxi: modeTaxi() });
};
// La préparation d'une carte, avec la demande de la page lue en base quand la liste de l'écran ne l'a pas (les droits de la personne s'appliquent : la base ne rend que ce qu'elle peut voir).
export async function preparationComplete(c) {
  const page = (c.donnees || {}).message_page;
  const ref = typeof page === "string" ? refDeLaPage(page) : null;
  let demandes = etat.db.demandes_site || [];
  if (ref && !demandeEnregistree(page, demandes, { entiteId: etat.entiteId }) && etat.store.demandeSiteParRef) {
    const trouvee = await etat.store.demandeSiteParRef(ref, etat.entiteId).catch(() => null);
    if (trouvee) demandes = [...demandes, trouvee];
  }
  return preparation(c, demandes);
}

// Le chauffeur d'une course ajoutée par carte (22.11.2026) : appelé une fois dans l'entreprise du dossier (dansEntreprise, dansFenetre).
export const chauffeurDeLaCarte = (c) => chauffeurCarte((c.donnees || {}).service, { taxi: modeTaxi(), defaut: modeTaxi() ? partenaireDeTaxi(etat.db.partenaires, chauffeurRegle(reglages())) : null, prestations: etat.db.prestations, trajets: etat.db.trajets });
// Le chauffeur et le règlement sur place d'une course ajoutée par carte (relecture de la PR 329 : une course de Taxi se paie au chauffeur).
export const optionsCarte = (c) => {
  const partenaireId = chauffeurDeLaCarte(c);
  const partenaire = partenaireId ? etat.db.partenaires.find((p) => p.id === partenaireId) || null : null;
  return { partenaireId, surPlace: payeSurPlaceCarte({ taxi: modeTaxi(), partenaire, modeDe: modeParDefaut }) };
};

export async function enregistrerReservation(valeurs, message, ancienne = null) {
  const { formulaireReservation } = await import("./reservations.mjs");
  // Une option ajoutée par une carte « modification » (26.11.2026) : les lignes de la facture doivent être lues avant la fenêtre cachée.
  if (Array.isArray(valeurs.options_ajout) && valeurs.options_ajout.length) {
    // Taxi : une course suit sa propre facture, sans options (relecture de la PR 359) : refusé, rien n'est écrit.
    if (modeTaxi()) return { ok: false, motif: tr("Les options ne s'ajoutent pas à une course de Taxi : modifiez le prix de la course.") };
    const r = ancienne || valeurs;
    const liee = !!(r.ligne_id || (r.details && r.details.lignes_ids && r.details.lignes_ids.length));
    if (liee) await chargerDossier(r.dossier_id);
    else {
      // Service sans ligne de facture (ajouté par carte) : l'option va sur la réservation, son prix dans le montant vendu, en une écriture.
      const opts = valeurs.options_ajout.filter((o) => !((r.details && r.details.options) || []).some((x) => x.prestation_id === o.prestation_id));
      const plus = opts.reduce((t, o) => t + (Number(o.prix) || 0), 0);
      if (!opts.length) return { ok: false, motif: tr("Cette option est déjà sur le service.") };
      if (opts.some((o) => o.prix === null || o.prix === undefined)) return { ok: false, motif: tr("Le prix de l'option est à saisir : ouvrez « Vérifier avant ».") };
      await modifier("reservations", r.id, { montant_vente: r.montant_vente === null || r.montant_vente === undefined ? null : Math.round((Number(r.montant_vente) + plus) * 100) / 100, details: { ...(r.details || {}), options: [...((r.details && r.details.options) || []), ...opts.map((o) => ({ prestation_id: o.prestation_id, libelle: o.libelle || "", prix: o.prix ?? null, qte: Math.max(1, Number(o.qte) || 1) }))] } });
      toast(message);
      return { ok: true, reservation: { ...r, id: r.id } };
    }
  }
  return new Promise((fin) => {
    let fini = false;
    let minuterie = null;
    let ferme = () => {};
    const terminer = (r) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      ferme();
      fin(r);
    };
    const form = formulaireReservation(valeurs, (res) => terminer(res ? (toast(message), { ok: true, reservation: { ...res, dossier_id: res.dossier_id || (ancienne && ancienne.dossier_id) || valeurs.dossier_id } }) : { ok: false, motif: tr("Rien n'a été enregistré.") }), { base: ancienne || valeurs });
    ferme = modal(tr("Réservation"), form, { cache: true });
    minuterie = setTimeout(() => terminer({ ok: false, motif: tr("Rien n'a été enregistré : ouvrez « Vérifier avant ».") }), 60_000);
    form.requestSubmit();
    // Les contrôles du formulaire passent avant tout enregistrement : un champ en erreur arrête tout de suite.
    queueMicrotask(() => {
      const refus = form.querySelector('[aria-invalid="true"]');
      if (refus) terminer({ ok: false, motif: tr("À corriger : {champ}.", { champ: ((form.querySelector(`label[for="${refus.id}"]`) || {}).textContent || "").trim() || tr("un champ") }) });
    });
  });
}
// Carte « dossier » de l'espace unifié (migration 63) : un dossier par entreprise, chacun avec sa numérotation et ses règles (Taxi sans
// facture, avec Booking confirmation), la même fiche client (créée dans l'entreprise active, puis utilisée dans l'autre par le partage
// réciproque), et dossier_lie_id des deux côtés. Tout est vérifié AVANT d'écrire : un service sans entreprise, un droit manquant ou une
// fiche qui ne peut pas passer dans l'autre entreprise arrêtent tout, rien n'est créé à moitié.
const MOTIFS_UNIFIE = (libelleEntreprise) => ({
  entreprise_a_choisir: () => tr("Choisissez Secret ou Taxi"),
  droit_dossier: (id) => tr("Votre rôle ne permet pas de créer un dossier chez {nom}. Rien n'a été créé.", { nom: libelleEntreprise(id) }),
  droit_client: (id) => tr("Votre rôle ne permet pas de créer la fiche client chez {nom}. Rien n'a été créé.", { nom: libelleEntreprise(id) }),
  partage: (id) => tr("La fiche client ne peut pas être utilisée chez {nom} : les fiches de Secret et de Taxi ne sont pas partagées pour vous. Rien n'a été créé.", { nom: libelleEntreprise(id) }),
  aucun_service: () => tr("Aucun service à créer."),
});
// `donnees` : la carte avec ses corrections d'un tap et son devis (donneesCarte de l'écran) ; `libelleEntreprise(id)` : « Secret » ou « Taxi ».
export async function validerUnifie(c, { donnees = c.donnees, libelleEntreprise = (id) => id } = {}) {
  const motifs = MOTIFS_UNIFIE(libelleEntreprise);
  const plan = planCreation({ services: donnees.services || [], activeId: etat.entiteId, permissionsDe, nouveauClient: false, partagePermis: (a, b) => partageClientsPermis(a, b) });
  if (!plan.ok) {
    const [code, id] = String(plan.motif).split(":");
    return { ok: false, motif: (motifs[code] || motifs.aucun_service)(id) };
  }
  const origine = etat.entiteId;
  const { ouvrirDemande } = await import("./demande.mjs");
  // Chaque étape se prépare dans son entreprise (catalogue, numérotation, règles), par la fiche habituelle cachée.
  const dans = async (id, fn) => {
    changerSansNaviguer(id);
    try {
      return await fn();
    } finally {
      changerSansNaviguer(origine);
    }
  };
  const sous = (e) => ({ ...c, donnees: { ...donnees, services: e.services } });
  const r = await creerDossiersLies({
    etapes: plan.etapes,
    // Passe à blanc : préparation et contrôles de chaque dossier (prix à fixer, service introuvable, numéro), rien n'est écrit.
    essayer: (e, i) => dans(e.entite_id, async () => ouvrirDemande(null, await preparationComplete(sous(e)), { auto: true, essai: true, clientAVenir: i > 0, titre: c.titre })),
    creer: (e, i, clientId) => dans(e.entite_id, async () => ouvrirDemande(null, await preparationComplete(sous(e)), { auto: true, titre: c.titre, surCree: () => {}, clientId })),
    // Un dossier ne passe pas : ceux déjà créés vont à la corbeille (la suppression habituelle), dans leur entreprise.
    defaire: async (crees) => {
      for (const d of crees) await dans(d.entite_id, () => supprimerLigne("dossiers", d.id));
      return true;
    },
    lier: (a, b) => lierDossiers(a, b, modifier),
  });
  if (!r.ok) {
    const motif = r.motif || tr("Rien n'a été enregistré.");
    if (!r.ecrit) return { ok: false, motif };
    const premier = r.crees[0];
    const pourquoi = motif.replace(/[.\s]+$/, "");
    return {
      ok: false,
      motif: r.defait
        ? tr("Le dossier chez {nom} n'a pas pu être créé ({motif}). Le dossier {ref} déjà créé a été mis à la corbeille : rien n'est gardé, la carte reste à valider.", { nom: libelleEntreprise(plan.etapes[r.etape].entite_id), motif: pourquoi, ref: premier.ref || "" })
        : tr("Le dossier chez {nom} n'a pas pu être créé ({motif}). Le dossier {ref} n'a pas pu être mis à la corbeille : supprimez-le depuis sa fiche avant de valider à nouveau.", { nom: libelleEntreprise(plan.etapes[r.etape].entite_id), motif: pourquoi, ref: premier.ref || "" }),
    };
  }
  const crees = r.crees;
  if (crees.length === 2) {
    if (r.lies) toast(tr("Deux dossiers liés créés : {a} et {b}.", { a: crees[0].ref || "", b: crees[1].ref || "" }));
    else toast(tr("Les deux dossiers sont créés, mais le lien entre eux n'a pas pu être posé : {a} et {b}.", { a: crees[0].ref || "", b: crees[1].ref || "" }), true);
  }
  const ici = crees.find((x) => x.entite_id === origine) || crees[0];
  return { ok: true, dossier: ici, dossiers: crees };
}


// Carte « reservation » validée d'un geste : la fenêtre habituelle, cachée, avec le chauffeur et le règlement de la course.
export const ajouterParCarte = (c, message) => enregistrerReservation(reservationDepuisCarte(c.donnees, optionsCarte(c)), message);
