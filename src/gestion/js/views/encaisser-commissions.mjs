// À encaisser, les commissions des partenaires (20.11.2026) : chaque partenaire avec ses dossiers dessous, chacun avec ce qu'il reste à recevoir.
// Anaïs coche les dossiers que le partenaire lui a payés, voit le total coché et encaisse la sélection d'un geste : un enregistrement par dossier,
// avec la date et le moyen. Un montant différent du prévu se règle dans la feuille : le reste viendra plus tard, ou le dossier est soldé avec un motif.
// Le calcul vit dans encaisser-calc.mjs : chaque total affiché est la somme des montants de sa liste.
import { etat, nomPartenaire, nomClient, netReservation, enregistrerLie, dossiersAnnules, reglages, modeTaxi, modifier, chargerDossier } from "../etat.mjs";
import { h, modal, confirmer, toast, num, saisie, erreurChamp, focusPremiereErreur } from "../ui.mjs";
import { aujourdhui, formatDate, ajouterJours, arrondi } from "../calc.mjs";
import { aRecevoirParPartenaire, recuesParPartenaire, sommeRestes, sommeMontants, natureMontant, ecrituresEncaissement, VALEURS_ANNULATION, MOTIFS_ECART, NOTE_ECART_MAX, correctionCommission, derniereCorrection, MOTIFS_CORRECTION, NOTE_CORRECTION_MAX } from "../encaisser-calc.mjs";
import { commissionDuPartenaire } from "../courses-partenaire-calc.mjs";
import { lieeFacture, suivreFacture, appliquerChangements } from "./suivi-facture.mjs";
import { prix, voitNets } from "./partenaires.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

// Un seul encaissement à la fois, même si l'écran est redessiné pendant l'envoi : pas de double clic, pas de double encaissement.
let envoiEnCours = false;
const CLE_MOYEN = "gestion-encaisser-moyen";
const JOURS_RECUES = 90;

const lireMoyen = () => {
  try {
    return localStorage.getItem(CLE_MOYEN) || "";
  } catch {
    return "";
  }
};
const garderMoyen = (v) => {
  try {
    localStorage.setItem(CLE_MOYEN, v);
  } catch {
    // stockage refusé : le moyen sera simplement redemandé
  }
};

const dossierDe = (id) => etat.db.dossiers.find((x) => x.id === id) || null;
const clientDuDossier = (d) => (d ? nomClient(etat.db.clients.find((c) => c.id === d.client_id)) : "");
const nomDe = (id) => nomPartenaire(id) || tr("Sans partenaire");
const libelleMotif = (k) => {
  const m = MOTIFS_ECART.find(([cle]) => cle === k);
  return m ? tr(m[1]) : "";
};

// Les services d'un dossier chez ce partenaire, en une ligne : libellés et dates.
const servicesTexte = (rs) => rs.map((r) => [r.libelle, r.date_service ? formatDate(r.date_service) : ""].filter(Boolean).join(", ")).join(" ; ");

// Ouvrir le dossier depuis la liste : « Retour » de la fiche ramène ici, et la liste se retrouve à la même hauteur (une seule fois).
const CLE_RETOUR = "gestion-encaisser-retour";
const lienVersDossier = (dossierId, contenu, classe = "enc-client") =>
  h("a", { class: classe, href: `#/dossier/${dossierId}?depuis=encaisser`, onclick: () => { try { sessionStorage.setItem(CLE_RETOUR, String(Math.round(window.scrollY))); } catch { /* sans stockage : la liste repart en haut */ } } }, contenu);
const retrouverHauteur = () => {
  let y = null;
  try {
    y = sessionStorage.getItem(CLE_RETOUR);
    sessionStorage.removeItem(CLE_RETOUR);
  } catch {
    return;
  }
  if (y === null) return;
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, Number(y) || 0)));
};
const libelleCorrection = (k) => {
  const m = MOTIFS_CORRECTION.find(([cle]) => cle === k);
  return m ? tr(m[1]) : "";
};
// « corrigée le 22 nov. : 1 000 → 800, remboursement partiel » : la trace visible sur la ligne et dans la fiche du service.
export function texteCorrection(n) {
  const c = derniereCorrection(n);
  if (!c) return "";
  const montants = c.avant === null ? prix(c.apres) : `${prix(c.avant)} → ${prix(c.apres)}`;
  const prixTexte = c.prixAvant !== null ? tr("prix d'avant {prix}", { prix: prix(c.prixAvant) }) : null;
  return [tr("Commission corrigée le {date} : {montants}", { date: formatDate(c.le), montants }), prixTexte, [libelleCorrection(c.motif), c.note].filter(Boolean).join(" : ")].filter(Boolean).join(", ");
}

export function sectionCommissions({ rafraichir, ecrit }) {
  const ajd = aujourdhui();
  const ecartees = dossiersAnnules();
  // Un index des nets par réservation, construit une fois par rendu : les deux listes le parcourent sans recherche linéaire.
  const index = new Map(etat.db.reservations_nets.map((n) => [n.reservation_id, n]));
  const netDe = (r) => index.get(r.id) || null;
  const partenaires = aRecevoirParPartenaire(etat.db.reservations, netDe, { ecartees, ajd });
  // Corriger une commission (ou le prix et la commission) : la personne voit les nets et écrit dans les dossiers. Jamais Mook, jamais le partenaire.
  const corrige = ecrit && voitNets();
  const recues = recuesParPartenaire(etat.db.reservations, netDe, { ecartees, depuis: ajouterJours(ajd, -JOURS_RECUES) });
  const total = sommeRestes(partenaires.flatMap((p) => p.dossiers));
  const moyens = (reglages().listes.moyens || []).filter((m) => !m.archive);
  const nomMoyen = (id) => {
    const m = (reglages().listes.moyens || []).find((x) => x.id === id);
    return m ? tr(m.label) : "";
  };

  // ---- La sélection : une case par dossier, un total par partenaire et en bas de l'écran -------------------------------------------
  const coches = new Set();
  const parCle = new Map(partenaires.flatMap((p) => p.dossiers.map((d) => [d.cle, d])));
  const sousTotaux = new Map();
  const barreTexte = h("p", { class: "enc-barre-texte", "aria-live": "polite" });
  const barreBouton = h("button", { class: "principal", type: "button", onclick: () => ouvrirFeuille([...coches].map((c) => parCle.get(c)).filter(Boolean)) }, tr("Encaisser la sélection"));
  const barre = h("div", { class: "barre-fixe enc-barre", hidden: true }, barreTexte, barreBouton);
  const maj = () => {
    const choisis = [...coches].map((c) => parCle.get(c)).filter(Boolean);
    barre.hidden = !choisis.length;
    barreTexte.textContent = choisis.length ? pluriel(choisis.length, N_("{n} dossier coché, {total}"), N_("{n} dossiers cochés, {total}"), { total: prix(sommeRestes(choisis)) }) : "";
    for (const p of partenaires) {
      const el = sousTotaux.get(p.partenaire_id || "");
      if (!el) continue;
      const siens = p.dossiers.filter((d) => coches.has(d.cle));
      el.textContent = siens.length ? tr("coché : {total}", { total: prix(sommeRestes(siens)) }) : "";
    }
  };

  const ligneDossier = (d) => {
    const dossier = dossierDe(d.dossier_id);
    const sans = d.sansCommission === d.reservations.length;
    const tags = [
      d.aVenir ? h("span", { class: "tag" }, tr("à venir")) : null,
      d.sansCommission ? h("span", { class: "tag" }, sans ? tr("sans commission prévue") : tr("{n} sans commission", { n: d.sansCommission })) : null,
      d.dejaRecu > 0 ? h("span", { class: "tag" }, d.partielLe ? tr("déjà reçu {montant} le {date}", { montant: prix(d.dejaRecu), date: formatDate(d.partielLe) }) : tr("déjà reçu {montant}", { montant: prix(d.dejaRecu) })) : null,
      d.reservations.some((r) => derniereCorrection(netDe(r))) ? h("span", { class: "tag tag-corrigee" }, tr("corrigée")) : null,
    ].filter(Boolean);
    const corrections = d.reservations.map((r) => texteCorrection(netDe(r))).filter(Boolean);
    const texte = h(
      "span",
      { class: "enc-texte" },
      lienVersDossier(d.dossier_id, clientDuDossier(dossier) || (dossier && dossier.ref) || tr("Dossier")),
      h("span", { class: "enc-detail" }, dossier && dossier.ref ? lienVersDossier(d.dossier_id, dossier.ref, "enc-ref") : null, dossier && dossier.ref ? " · " : null, servicesTexte(d.reservations)),
      tags.length ? h("span", { class: "enc-tags" }, tags) : null,
      corrections.length ? h("span", { class: "enc-detail enc-correction" }, corrections.join(" ; ")) : null
    );
    const montant = h("strong", { class: "enc-montant" }, sans ? "—" : prix(d.reste));
    const corriger = corrige ? h("button", { class: "secondaire petit enc-corriger", type: "button", "aria-label": tr("Corriger la commission : {client}", { client: clientDuDossier(dossier) || (dossier && dossier.ref) || "" }), onclick: () => ouvrirCorrection(d) }, tr("Corriger")) : null;
    if (!ecrit) return h("li", { class: "enc-dossier" }, h("div", { class: "enc-case" }, texte, montant));
    const input = h("input", { type: "checkbox", "data-dossier": d.dossier_id });
    input.addEventListener("change", () => {
      if (input.checked) coches.add(d.cle);
      else coches.delete(d.cle);
      maj();
    });
    return h("li", { class: "enc-dossier" }, h("label", { class: "enc-case" }, input, texte, montant), corriger);
  };

  const cartePartenaire = (p) => {
    const dus = p.dossiers.filter((d) => d.coche);
    const sous = h("span", { class: "enc-coche", "aria-live": "polite" });
    sousTotaux.set(p.partenaire_id || "", sous);
    return h(
      "section",
      { class: "enc-partenaire" },
      h(
        "div",
        { class: "enc-tete" },
        h("h3", null, p.partenaire_id ? h("a", { href: `#/partenaire/${p.partenaire_id}` }, nomDe(p.partenaire_id)) : nomDe(p.partenaire_id)),
        h("span", { class: "droite-pile" }, h("strong", null, prix(p.reste)), h("span", null, pluriel(p.dossiers.length, N_("{n} dossier à recevoir"), N_("{n} dossiers à recevoir"))), sous)
      ),
      h("ul", { class: "enc-liste" }, p.dossiers.map(ligneDossier)),
      ecrit && dus.length
        ? h(
            "div",
            { class: "enc-pied" },
            // Les dossiers passés avec une commission prévue : ceux d'un « tout encaisser » au prévu. Les autres se cochent à la main.
            h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrirFeuille(dus) }, dus.length === p.dossiers.length ? tr("Tout encaisser") : pluriel(dus.length, N_("Encaisser {n} dossier passé"), N_("Encaisser {n} dossiers passés"))),
            h("span", { class: "aide" }, tr("soit {total}", { total: prix(sommeRestes(dus)) }))
          )
        : null
    );
  };

  // ---- La feuille d'encaissement : date, moyen, un montant par dossier (le prévu d'avance) -----------------------------------------
  const ouvrirFeuille = (dossiers) => {
    if (!dossiers.length || envoiEnCours) return;
    // La feuille appartient à l'entreprise où elle a été ouverte : rien ne s'écrit si l'entreprise active a changé entre-temps.
    const entite = etat.entiteId;
    const date = saisie(h("input", { id: "enc-date", type: "date", value: ajd, max: ajd, required: true }), "date");
    const memo = lireMoyen();
    const moyen = h("select", { id: "enc-moyen" }, moyens.map((m) => h("option", { value: m.id, selected: m.id === memo }, tr(m.label))));
    const totalTexte = h("p", { class: "enc-total", "aria-live": "polite" });
    const bouton = h("button", { class: "principal", type: "submit" }, tr("Encaisser"));
    const plusieursPartenaires = new Set(dossiers.map((d) => d.partenaire_id || "")).size > 1;
    const blocs = dossiers.map((d, i) => {
      const dossier = dossierDe(d.dossier_id);
      const sans = d.sansCommission === d.reservations.length;
      const id = `enc-m-${i}`;
      const montant = saisie(h("input", { id, type: "number", min: "0", step: "any", inputmode: "decimal", value: sans ? "" : String(d.reste), required: true }), "montant");
      const nom = `enc-suite-${i}`;
      const radio = (valeur, libelle) => {
        const label = h("label", { class: "case" }, h("input", { type: "radio", name: nom, value: valeur }), h("span", null, libelle));
        return { input: label.querySelector("input"), label };
      };
      const plusTard = radio("plus_tard", tr("Le reste viendra plus tard"));
      const solder = radio("solder", tr("Solder le dossier"));
      const resteTexte = h("span", { class: "aide" });
      const choixSuite = h("fieldset", { class: "enc-choix", hidden: true }, h("legend", null, tr("Moins que prévu")), plusTard.label, resteTexte, solder.label);
      const motifs = MOTIFS_ECART.map(([k, l]) => {
        const label = h("label", { class: "case puce" }, h("input", { type: "radio", name: `enc-motif-${i}`, value: k }), h("span", null, tr(l)));
        return { input: label.querySelector("input"), label };
      });
      const note = h("input", { id: `enc-note-${i}`, type: "text", maxlength: String(NOTE_ECART_MAX), autocomplete: "off" });
      const ecartTexte = h("p", { class: "ecart-reception", "aria-live": "polite" });
      const choixMotif = h("fieldset", { class: "enc-motif", hidden: true }, h("legend", null, tr("Motif de l'écart")), h("div", { class: "puces" }, motifs.map((m) => m.label)), h("div", { class: "champ" }, h("label", { for: `enc-note-${i}` }, tr("Note (facultative)")), note));
      const lire = () => {
        const v = num(montant.value);
        const nature = natureMontant(d, v);
        const suite = nature === "moins" ? (plusTard.input.checked ? "plus_tard" : solder.input.checked ? "solder" : null) : "solder";
        const motif = (motifs.find((m) => m.input.checked) || {}).input;
        return { v, nature, suite, motif: motif ? motif.value : null, note: note.value };
      };
      const majBloc = () => {
        const { v, nature, suite } = lire();
        choixSuite.hidden = nature !== "moins";
        if (nature === "moins") resteTexte.textContent = tr("{reste} restent à recevoir sur ce dossier.", { reste: prix(arrondi(d.reste - v)) });
        const ecart = nature === "libre" || nature === "invalide" ? 0 : arrondi(d.dejaRecu + v - d.prevue);
        const avecMotif = suite === "solder" && ecart !== 0;
        choixMotif.hidden = !avecMotif;
        ecartTexte.textContent = avecMotif ? (ecart > 0 ? tr("{ecart} de plus que prévu.", { ecart: prix(ecart) }) : tr("{ecart} de moins que prévu.", { ecart: prix(-ecart) })) : "";
      };
      [montant, plusTard.input, solder.input].forEach((x) => x.addEventListener("input", () => (majBloc(), majTotal())));
      [plusTard.input, solder.input].forEach((x) => x.addEventListener("change", () => (majBloc(), majTotal())));
      const noeud = h(
        "li",
        { class: "enc-feuille-dossier" },
        h("p", { class: "enc-feuille-titre" }, h("strong", null, clientDuDossier(dossier) || (dossier && dossier.ref) || tr("Dossier")), h("span", null, [dossier && dossier.ref, plusieursPartenaires ? nomDe(d.partenaire_id) : null].filter(Boolean).join(" · "))),
        h("p", { class: "aide" }, sans ? tr("Pas de commission prévue : saisissez le montant reçu.") : d.dejaRecu > 0 ? tr("Reste prévu {reste}, déjà reçu {recu}.", { reste: prix(d.reste), recu: prix(d.dejaRecu) }) : tr("Prévu {reste}.", { reste: prix(d.reste) })),
        h("div", { class: "champ" }, h("label", { for: id }, tr("Montant reçu")), montant),
        choixSuite,
        ecartTexte,
        choixMotif
      );
      return { d, montant, lire, majBloc, noeud, champs: { montant, suite: plusTard.input, motif: motifs[0].input } };
    });
    const majTotal = () => {
      const montants = blocs.map((b) => num(b.montant.value));
      const t = sommeMontants(montants);
      totalTexte.textContent = tr("Total encaissé : {total}", { total: prix(t) });
      bouton.textContent = blocs.length > 1 ? tr("Encaisser {n} dossiers", { n: blocs.length }) : tr("Encaisser {total}", { total: prix(t) });
    };
    const erreurs = { montant: tr("Saisissez le montant reçu."), date: tr("Indiquez la date de réception."), suite: tr("Choisissez si le reste viendra plus tard ou si le dossier est soldé."), motif: tr("Choisissez le motif de l'écart.") };
    const fermer = modal(
      dossiers.length > 1 ? tr("Encaisser {n} dossiers", { n: dossiers.length }) : tr("Encaisser la commission"),
      h(
        "form",
        {
          class: "modal-corps enc-feuille",
          novalidate: true,
          onsubmit: async (e) => {
            e.preventDefault();
            if (envoiEnCours) return;
            if (etat.entiteId !== entite) {
              fermer();
              toast(tr("L'entreprise a changé : rien n'a été encaissé. Rouvrez la liste."), true);
              return;
            }
            // Un dossier qui a bougé depuis l'ouverture (versement noté sur un autre appareil, synchronisation) : on n'écrit rien, la liste se relit.
            const frais = new Map(aRecevoirParPartenaire(etat.db.reservations, netReservation, { ecartees: dossiersAnnules(), ajd }).flatMap((p) => p.dossiers.map((d) => [d.cle, d])));
            if (blocs.some((b) => { const f = frais.get(b.d.cle); return !f || f.reste !== b.d.reste || f.dejaRecu !== b.d.dejaRecu || f.reservations.length !== b.d.reservations.length; })) {
              fermer();
              toast(tr("Un dossier a changé depuis l'ouverture : rien n'a été encaissé. Vérifiez la liste."), true);
              rafraichir();
              return;
            }
            // Tout se vérifie avant d'écrire quoi que ce soit : un dossier mal rempli n'en laisse pas d'autres à moitié encaissés.
            const plan = [];
            [date, ...blocs.flatMap((b) => Object.values(b.champs))].forEach((c) => erreurChamp(c, null));
            for (const b of blocs) {
              const l = b.lire();
              const r = ecrituresEncaissement(b.d, netReservation, { montant: l.v, date: date.value, moyen: moyen.value, suite: l.suite, motif: l.motif, note: l.note });
              if (r.erreur) {
                erreurChamp(r.erreur === "date" ? date : b.champs[r.erreur], erreurs[r.erreur]);
                focusPremiereErreur(e.target);
                return;
              }
              plan.push(r);
            }
            envoiEnCours = true;
            bouton.disabled = true;
            bouton.textContent = tr("Enregistrement…");
            garderMoyen(moyen.value);
            let faits = 0;
            try {
              for (const r of plan) {
                let ecrites = 0;
                for (const x of r.ecritures) {
                  // Un service réglé entre-temps (autre appareil, synchronisation) n'est pas encaissé une seconde fois.
                  const n = netReservation({ id: x.reservation_id });
                  if (n && n.commission_recue_le) continue;
                  await enregistrerLie("reservations_nets", "reservation_id", x.reservation_id, x.valeurs);
                  ecrites++;
                }
                if (ecrites) faits++;
              }
              fermer();
              toast(faits ? pluriel(faits, N_("{n} dossier encaissé."), N_("{n} dossiers encaissés.")) : tr("Rien à encaisser : ces dossiers étaient déjà réglés."));
            } catch (err) {
              fermer();
              toast(faits ? `${pluriel(faits, N_("{n} dossier encaissé."), N_("{n} dossiers encaissés."))} ${tr("Arrêt : {message}", { message: err.message })}` : tr("Enregistrement impossible : {message}", { message: err.message }), true);
            } finally {
              envoiEnCours = false;
              rafraichir();
            }
          },
        },
        h("div", { class: "grille-form compacte" }, h("div", { class: "champ" }, h("label", { for: "enc-date" }, tr("Reçu le")), date), h("div", { class: "champ" }, h("label", { for: "enc-moyen" }, tr("Moyen de paiement")), moyen)),
        h("ul", { class: "enc-feuille-liste" }, blocs.map((b) => b.noeud)),
        // Le total et le bouton restent en bas de la feuille, même avec beaucoup de dossiers cochés.
        h("div", { class: "barre-modal enc-feuille-barre" }, totalTexte, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Annuler")), bouton)
      ),
      { feuille: true }
    );
    blocs.forEach((b) => b.majBloc());
    majTotal();
  };

  // ---- Corriger : la commission seule, ou le prix de vente et la commission (23.11.2026, migration 119) ----------------------------------
  // Un service à la fois : un dossier avec plusieurs services chez ce partenaire propose d'abord de choisir lequel. Le motif est obligatoire.
  // Ce qui a déjà été reçu ne bouge pas ; un prix changé passe par le chemin commun de la facture (total montré, confirmation si elle est partie).
  const ouvrirCorrection = (d) => {
    if (envoiEnCours || !d.reservations.length) return;
    const entite = etat.entiteId;
    const dossier = dossierDe(d.dossier_id);
    const taxi = modeTaxi();
    let r = d.reservations[0];
    // Ce qui était lu à l'ouverture : si la ligne change entre-temps (autre appareil, Mr. Brown), rien ne s'écrit.
    const lu = (x) => {
      const n = netReservation(x) || {};
      return JSON.stringify([n.commission_prevue ?? null, n.commission_recue ?? null, n.commission_recue_le ?? null, x.montant_vente ?? null]);
    };
    const ouverture = new Map(d.reservations.map((x) => [x.id, lu(x)]));

    const radio = (nom, valeur, libelle, coche = false) => {
      const label = h("label", { class: "case puce" }, h("input", { type: "radio", name: nom, value: valeur, checked: coche }), h("span", null, libelle));
      return { input: label.querySelector("input"), label };
    };
    const choixService = d.reservations.length > 1 ? d.reservations.map((x, i) => radio("corr-service", x.id, [x.libelle, x.date_service ? formatDate(x.date_service) : ""].filter(Boolean).join(", "), i === 0)) : [];
    const modeCommission = radio("corr-mode", "commission", tr("La commission seule"), true);
    const modePrix = radio("corr-mode", "prix", tr("Le prix et la commission"));
    const prixChamp = saisie(h("input", { id: "corr-prix", type: "number", min: "0", step: "any", inputmode: "decimal" }), "montant");
    const prixAide = h("span", { class: "aide" });
    const blocPrix = h("div", { class: "champ", hidden: true }, h("label", { for: "corr-prix" }, taxi ? tr("Nouveau prix de la course") : tr("Nouveau prix de vente")), prixChamp, prixAide);
    const commission = saisie(h("input", { id: "corr-commission", type: "number", min: "0", step: "any", inputmode: "decimal", required: true }), "montant");
    const commissionAide = h("span", { class: "aide" });
    const recap = h("p", { class: "corr-recap", "aria-live": "polite" });
    const facture = h("p", { class: "bandeau-info corr-facture", hidden: true });
    const motifs = MOTIFS_CORRECTION.map(([k, l]) => radio("corr-motif", k, tr(l)));
    const note = h("input", { id: "corr-note", type: "text", maxlength: String(NOTE_CORRECTION_MAX), autocomplete: "off" });
    const noteLabel = h("label", { for: "corr-note" }, tr("Note (facultative)"));
    const bouton = h("button", { class: "principal", type: "submit" }, tr("Enregistrer la correction"));

    const mode = () => (modePrix.input.checked ? "prix" : "commission");
    const motif = () => (motifs.find((m) => m.input.checked) || {}).input?.value || null;
    const remplir = () => {
      const n = netReservation(r) || {};
      commission.value = n.commission_prevue === null || n.commission_prevue === undefined ? "" : String(Number(n.commission_prevue));
      prixChamp.value = r.montant_vente === null || r.montant_vente === undefined ? "" : String(Number(r.montant_vente));
      const actuelle = n.commission_prevue === null || n.commission_prevue === undefined ? tr("aucune") : prix(Number(n.commission_prevue));
      commissionAide.textContent = commissionDuPartenaire(n) ? tr("Actuelle : {montant}, annoncée par le partenaire.", { montant: actuelle }) : tr("Actuelle : {montant}.", { montant: actuelle });
      prixAide.textContent = tr("Actuel : {montant}.", { montant: r.montant_vente === null || r.montant_vente === undefined ? tr("aucun") : prix(Number(r.montant_vente)) });
    };
    // Le récapitulatif suit la saisie : ancienne et nouvelle commission, ce qui reste à recevoir du partenaire.
    const majRecap = () => {
      blocPrix.hidden = mode() !== "prix";
      noteLabel.textContent = motif() === "autre" ? tr("Note (obligatoire)") : tr("Note (facultative)");
      const n = netReservation(r) || {};
      const avant = n.commission_prevue === null || n.commission_prevue === undefined ? null : Number(n.commission_prevue);
      const c = num(commission.value);
      const recu = Number(n.commission_recue) || 0;
      const phrases = [];
      if (c !== null && c >= 0) {
        if (avant !== null && arrondi(c) !== arrondi(avant)) phrases.push(tr("Commission {avant} → {apres} ({ecart}).", { avant: prix(avant), apres: prix(c), ecart: (c > avant ? "+" : "−") + prix(Math.abs(arrondi(c - avant))) }));
        if (c < recu) phrases.push(tr("Le partenaire a déjà versé {recu} : la commission ne peut pas descendre en dessous.", { recu: prix(recu) }));
        else if (recu > 0) phrases.push(arrondi(c - recu) === 0 ? tr("Déjà reçu {recu} : le service sera soldé.", { recu: prix(recu) }) : tr("Déjà reçu {recu} : il restera {reste} à recevoir.", { recu: prix(recu), reste: prix(arrondi(c - recu)) }));
        else phrases.push(c === 0 ? tr("Plus rien à recevoir : le service sera soldé.") : tr("À recevoir du partenaire : {reste}.", { reste: prix(c) }));
      }
      recap.textContent = phrases.join(" ");
      // Le prix change sur un service déjà facturé : la facture n'est jamais modifiée en silence (Taxi : prix interne, jamais montré).
      const p = num(prixChamp.value);
      const prixChange = mode() === "prix" && p !== null && arrondi(p) !== arrondi(Number(r.montant_vente) || 0);
      const doc = !taxi && prixChange && lieeFacture(r) ? etat.db.documents.find((x) => x.dossier_id === r.dossier_id && x.type === "facture") : null;
      facture.hidden = !doc;
      facture.textContent = !doc ? "" : doc.envoye_le
        ? tr("Ce service est sur la facture envoyée au client le {date}. Le nouveau prix y sera repris : le nouveau total s'affiche avant d'enregistrer, et il faudra renvoyer la facture.", { date: formatDate(doc.envoye_le) })
        : tr("Ce service est sur la facture. Le nouveau prix y sera repris et son nouveau total s'affichera.");
    };
    choixService.forEach((x) => x.input.addEventListener("change", () => { r = d.reservations.find((y) => y.id === x.input.value) || r; remplir(); majRecap(); }));
    [modeCommission.input, modePrix.input, ...motifs.map((m) => m.input)].forEach((x) => x.addEventListener("change", majRecap));
    [commission, prixChamp].forEach((x) => x.addEventListener("input", majRecap));

    const erreurs = {
      commission: tr("Saisissez la nouvelle commission (0 ou plus, deux décimales au plus)."),
      prix: tr("Saisissez le nouveau prix (plus que 0, deux décimales au plus)."),
      sous_recu: tr("Le partenaire a déjà versé plus que ce montant : annulez d'abord la réception dans « Reçues ces derniers jours »."),
      au_dessus_prix: tr("La commission dépasse le prix de vente."),
      inchange: tr("Rien ne change : modifiez la commission ou le prix."),
      motif: tr("Choisissez le motif de la correction."),
      note: tr("Ajoutez une note courte pour « Autre »."),
      reglee: tr("Cette commission est déjà soldée."),
    };
    const champDe = { commission, prix: prixChamp, sous_recu: commission, au_dessus_prix: commission, inchange: commission, motif: motifs[0].input, note, reglee: commission };
    const fermer = modal(
      tr("Corriger la commission"),
      h(
        "form",
        {
          class: "modal-corps enc-feuille corr-feuille",
          novalidate: true,
          onsubmit: async (e) => {
            e.preventDefault();
            if (envoiEnCours) return;
            if (etat.entiteId !== entite) {
              fermer();
              toast(tr("L'entreprise a changé : rien n'a été corrigé. Rouvrez la liste."), true);
              return;
            }
            const frais = etat.db.reservations.find((x) => x.id === r.id);
            if (!frais || lu(frais) !== ouverture.get(r.id)) {
              fermer();
              toast(tr("Ce service a changé depuis l'ouverture : rien n'a été corrigé. Vérifiez la liste."), true);
              rafraichir();
              return;
            }
            Object.values(champDe).forEach((c) => erreurChamp(c, null));
            const res = correctionCommission(frais, netReservation(frais), { mode: mode(), commission: num(commission.value), prix: num(prixChamp.value), motif: motif(), note: note.value }, { ajd, maintenant: new Date().toISOString() });
            if (res.erreur) {
              erreurChamp(champDe[res.erreur], erreurs[res.erreur]);
              focusPremiereErreur(e.target);
              return;
            }
            envoiEnCours = true;
            bouton.disabled = true;
            bouton.textContent = tr("Enregistrement…");
            try {
              let ecartRestant = null;
              if (res.reservation) {
                // Le chemin commun : la facture suit le prix, avec son nouveau total, et une confirmation si elle a déjà été envoyée.
                const valeurs = { ...res.reservation };
                const pareil = { date_service: frais.date_service, personnes: frais.personnes };
                const suivi = await suivreFacture(frais, valeurs, { avant: pareil, apres: pareil, service: { montant_vente: valeurs.montant_vente } });
                if (!suivi) {
                  bouton.disabled = false;
                  bouton.textContent = tr("Enregistrer la correction");
                  return;
                }
                await appliquerChangements(suivi.changements);
                await modifier("reservations", frais.id, valeurs);
                // Seul l'écart de prix concerne cette correction : un écart de date ou de personnes déjà là reste signalé sur la carte du service.
                ecartRestant = (suivi.ecartRestant || []).filter((t) => t.startsWith(tr("Montant vendu")));
              }
              await enregistrerLie("reservations_nets", "reservation_id", frais.id, res.nets);
              fermer();
              const fait = res.solde ? tr("Commission corrigée : {montant}, le service est soldé.", { montant: prix(res.apres) }) : tr("Commission corrigée : {montant}, reste à recevoir {reste}.", { montant: prix(res.apres), reste: prix(res.reste) });
              toast(ecartRestant && ecartRestant.length ? `${fait} ${tr("La facture garde l'ancienne valeur, à corriger dans la facture :")} ${ecartRestant.join(" ; ")}` : fait);
            } catch (err) {
              fermer();
              toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
            } finally {
              envoiEnCours = false;
              rafraichir();
            }
          },
        },
        h("p", { class: "enc-feuille-titre" }, h("strong", null, clientDuDossier(dossier) || (dossier && dossier.ref) || tr("Dossier")), h("span", null, [dossier && dossier.ref, nomDe(d.partenaire_id)].filter(Boolean).join(" · "))),
        choixService.length ? h("fieldset", { class: "enc-motif" }, h("legend", null, tr("Service")), h("div", { class: "puces" }, choixService.map((x) => x.label))) : h("p", { class: "aide" }, servicesTexte(d.reservations)),
        h("fieldset", { class: "enc-motif" }, h("legend", null, tr("Ce qui change")), h("div", { class: "puces" }, modeCommission.label, modePrix.label)),
        blocPrix,
        h("div", { class: "champ" }, h("label", { for: "corr-commission" }, tr("Nouvelle commission")), commission, commissionAide),
        recap,
        facture,
        h("fieldset", { class: "enc-motif" }, h("legend", null, tr("Motif")), h("div", { class: "puces" }, motifs.map((m) => m.label)), h("div", { class: "champ" }, noteLabel, note)),
        h("p", { class: "aide" }, tr("L'ancien montant reste dans le journal et sur la fiche du service. Le voucher et les messages au client ne montrent jamais la commission.")),
        h("div", { class: "barre-modal enc-feuille-barre" }, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Annuler")), bouton)
      ),
      { feuille: true, ferme: () => window.removeEventListener("hashchange", quitter) }
    );
    // Changer d'écran, d'entreprise ou de compte ferme la feuille : elle ne reste pas ouverte sur un autre écran (l'enregistrement le refusait déjà).
    const ecranOuverture = location.hash;
    const quitter = () => {
      if (location.hash !== ecranOuverture || etat.entiteId !== entite) fermer();
    };
    window.addEventListener("hashchange", quitter);
    remplir();
    majRecap();
    // Les factures du dossier ne sont pas chargées sur cet écran : l'avertissement de facture se recalcule une fois qu'elles sont là.
    chargerDossier(d.dossier_id).then(majRecap).catch(() => {});
  };

  // ---- Reçues ces derniers jours : revoir un encaissement, annuler une erreur -----------------------------------------------------
  const annuler = async (d) => {
    const dossier = dossierDe(d.dossier_id);
    const ok = await confirmer(tr("Annuler la réception de {montant} pour {client} ? Le dossier revient dans les commissions à recevoir.", { montant: prix(d.recu), client: clientDuDossier(dossier) || (dossier && dossier.ref) || "" }), tr("Annuler la réception"), true, tr("Garder"));
    if (!ok || envoiEnCours) return;
    envoiEnCours = true;
    try {
      for (const r of d.reservations) await enregistrerLie("reservations_nets", "reservation_id", r.id, VALEURS_ANNULATION);
      toast(tr("Le dossier revient dans les commissions à recevoir."));
    } catch (err) {
      toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    } finally {
      envoiEnCours = false;
      rafraichir();
    }
  };
  const ligneRecue = (d) => {
    const dossier = dossierDe(d.dossier_id);
    const quoi = [
      d.partiel ? tr("versement partiel le {date}", { date: formatDate(d.le) }) : tr("reçue le {date}", { date: formatDate(d.le) }),
      d.moyen ? nomMoyen(d.moyen) : null,
      d.ecart ? tr("écart {ecart}", { ecart: (d.ecart > 0 ? "+" : "−") + prix(Math.abs(d.ecart)) }) : null,
      d.motif ? [libelleMotif(d.motif), d.note].filter(Boolean).join(" : ") : null,
    ].filter(Boolean);
    return h(
      "li",
      { class: "enc-dossier" },
      h(
        "div",
        { class: "enc-case" },
        h("span", { class: "enc-texte" }, lienVersDossier(d.dossier_id, clientDuDossier(dossier) || (dossier && dossier.ref) || tr("Dossier")), h("span", { class: "enc-detail" }, [dossier && dossier.ref, servicesTexte(d.reservations)].filter(Boolean).join(" · ")), h("span", { class: "enc-detail" }, quoi.join(", "))),
        h("strong", { class: "enc-montant" }, prix(d.recu))
      ),
      ecrit ? h("button", { class: "lien", type: "button", onclick: () => annuler(d) }, tr("Annuler")) : null
    );
  };
  const nbRecues = recues.reduce((s, p) => s + p.dossiers.length, 0);

  const noeud = h(
    "div",
    { class: "enc-commissions" },
    partenaires.length
      ? h(
          "section",
          { class: "commissions-recevoir" },
          h("h2", null, tr("Commissions des prestataires")),
          h("p", { class: "aide" }, ecrit ? tr("Cochez les dossiers que le partenaire vous a payés. Le total coché s'affiche sous son nom et un montant différent se corrige avant d'encaisser.") : tr("Ce que chaque partenaire doit encore, dossier par dossier.")),
          partenaires.map(cartePartenaire),
          ecrit ? barre : null
        )
      : null,
    nbRecues
      ? h(
          "details",
          { class: "commissions-recues" },
          h("summary", null, tr("Reçues ces {jours} derniers jours ({n})", { jours: JOURS_RECUES, n: nbRecues })),
          recues.map((p) => h("section", { class: "enc-partenaire" }, h("div", { class: "enc-tete" }, h("h3", null, nomDe(p.partenaire_id))), h("ul", { class: "enc-liste" }, p.dossiers.map(ligneRecue)))),
          ecrit && !modeTaxi() ? h("p", { class: "bandeau-info" }, tr("Si une facture pour la fiduciaire a déjà été créée pour ce service, elle ne s'annule pas d'ici : vérifiez l'écran Fiduciaire.")) : null
        )
      : null
  );
  retrouverHauteur();
  return { noeud, total, nbPartenaires: partenaires.length, rien: !partenaires.length && !nbRecues };
}
