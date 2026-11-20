// À encaisser, les commissions des partenaires (20.11.2026) : chaque partenaire avec ses dossiers dessous, chacun avec ce qu'il reste à recevoir.
// Anaïs coche les dossiers que le partenaire lui a payés, voit le total coché et encaisse la sélection d'un geste : un enregistrement par dossier,
// avec la date et le moyen. Un montant différent du prévu se règle dans la feuille : le reste viendra plus tard, ou le dossier est soldé avec un motif.
// Le calcul vit dans encaisser-calc.mjs : chaque total affiché est la somme des montants de sa liste.
import { etat, nomPartenaire, nomClient, netReservation, enregistrerLie, dossiersAnnules, reglages, modeTaxi } from "../etat.mjs";
import { h, modal, confirmer, toast, num, saisie, erreurChamp, focusPremiereErreur } from "../ui.mjs";
import { aujourdhui, formatDate, ajouterJours, arrondi } from "../calc.mjs";
import { aRecevoirParPartenaire, recuesParPartenaire, sommeRestes, sommeMontants, natureMontant, ecrituresEncaissement, VALEURS_ANNULATION, MOTIFS_ECART, NOTE_ECART_MAX } from "../encaisser-calc.mjs";
import { prix } from "./partenaires.mjs";
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

export function sectionCommissions({ rafraichir, ecrit }) {
  const ajd = aujourdhui();
  const ecartees = dossiersAnnules();
  const partenaires = aRecevoirParPartenaire(etat.db.reservations, netReservation, { ecartees, ajd });
  const recues = recuesParPartenaire(etat.db.reservations, netReservation, { ecartees, depuis: ajouterJours(ajd, -JOURS_RECUES) });
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
    barreTexte.textContent = choisis.length ? tr("{dossiers} cochés : {total}", { dossiers: pluriel(choisis.length, N_("{n} dossier"), N_("{n} dossiers")), total: prix(sommeRestes(choisis)) }) : "";
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
    ].filter(Boolean);
    const texte = h(
      "span",
      { class: "enc-texte" },
      h("span", { class: "enc-client" }, clientDuDossier(dossier) || (dossier && dossier.ref) || tr("Dossier")),
      h("span", { class: "enc-detail" }, [dossier && dossier.ref, servicesTexte(d.reservations)].filter(Boolean).join(" · ")),
      tags.length ? h("span", { class: "enc-tags" }, tags) : null
    );
    const montant = h("strong", { class: "enc-montant" }, sans ? "—" : prix(d.reste));
    if (!ecrit) return h("li", { class: "enc-dossier" }, h("div", { class: "enc-case" }, texte, montant));
    const input = h("input", { type: "checkbox", "data-dossier": d.dossier_id, "aria-label": tr("Encaisser le dossier {ref}", { ref: (dossier && dossier.ref) || "" }) });
    input.addEventListener("change", () => {
      if (input.checked) coches.add(d.cle);
      else coches.delete(d.cle);
      maj();
    });
    return h("li", { class: "enc-dossier" }, h("label", { class: "enc-case" }, input, texte, montant));
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
            h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrirFeuille(dus) }, dus.length === p.dossiers.length ? tr("Tout encaisser") : tr("Encaisser les dossiers passés")),
            h("span", { class: "aide" }, dus.length > 1 ? tr("{n} dossiers passés : {total}", { n: dus.length, total: prix(sommeRestes(dus)) }) : null)
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
                for (const x of r.ecritures) {
                  // Un service réglé entre-temps (autre appareil, synchronisation) n'est pas encaissé une seconde fois.
                  const n = netReservation({ id: x.reservation_id });
                  if (n && n.commission_recue_le) continue;
                  await enregistrerLie("reservations_nets", "reservation_id", x.reservation_id, x.valeurs);
                }
                faits++;
              }
              fermer();
              toast(pluriel(faits, N_("{n} dossier encaissé."), N_("{n} dossiers encaissés.")));
            } catch (err) {
              fermer();
              toast(faits ? tr("{n} dossiers encaissés, puis arrêt : {message}", { n: faits, message: err.message }) : tr("Enregistrement impossible : {message}", { message: err.message }), true);
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
        h("span", { class: "enc-texte" }, h("a", { class: "enc-client", href: `#/dossier/${d.dossier_id}` }, clientDuDossier(dossier) || (dossier && dossier.ref) || tr("Dossier")), h("span", { class: "enc-detail" }, [dossier && dossier.ref, servicesTexte(d.reservations)].filter(Boolean).join(" · ")), h("span", { class: "enc-detail" }, quoi.join(", "))),
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
          h("p", { class: "aide" }, ecrit ? tr("Cochez les dossiers que le partenaire vous a payés : le total coché s'affiche sous son nom. Un montant différent se corrige avant d'encaisser.") : tr("Ce que chaque partenaire doit encore, dossier par dossier.")),
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
  return { noeud, total, nbPartenaires: partenaires.length, rien: !partenaires.length && !nbRecues };
}
