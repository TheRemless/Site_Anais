// Sélecteur de prestations et de trajets de partenaires pour l'éditeur de devis.
// La fenêtre reste ouverte pour enchaîner plusieurs ajouts ; chaque ajout renvoie des lignes prêtes pour le document.
import { etat, nomPartenaire, partenaireDe, netPrestation, netTrajet, modeTaxi, modeExcursions, peut } from "../etat.mjs";
import { lignesSurPlace } from "../taxi-calc.mjs";
import { h, champ, modal, toast } from "../ui.mjs";
import { formatMontant, SUR_PLACE } from "../calc.mjs";
import { FAMILLES, nomFamille, libelleUnite, correspond, filtrerTrajets, ligneDepuisPrestation, lignesDepuisTrajet, ligneLibre, quantiteParDefaut, periodeSpecifique, proposable, estPrestationOption, optionsDe, ligneOption } from "../partenaires-calc.mjs";
import { prestataires } from "../apporteurs-calc.mjs";
import { prestationEnfant } from "../demande-calc.mjs";
import { appliquerModeParDefaut, modeParDefaut, MODELES_VOUCHER, SANS_VOUCHER, TITRES_VOUCHER, typeVoucherDeduit } from "../operations-calc.mjs";
import { tr, pluriel, N_ } from "../i18n.mjs";

// `sansCompagnie` : le nom de la compagnie n'est pas répété dans le libellé des trajets (facture de Secret).
// `dossierId` : le dossier auquel on ajoute ; la date et les personnes de son dernier service sont reprises, et le choix des personnes suit.
// `defauts` : { date, adultes, enfants } donnés par l'appelant (une demande collée), qui l'emportent sur le dossier.
export function choisirPrestation({ langue = "", devise = "THB", onAjout, sansCompagnie = false, dossierId = null, defauts = {} }) {
  // Taxi : pas d'horaires de bateaux, l'onglet Trajets n'a rien à montrer.
  const ongletsDispo = [["tarifs", tr("Tarifs")], ...(modeTaxi() ? [] : [["trajets", tr("Trajets")]]), ["libre", tr("Autre prestation")]];
  // Un tarif ou un trajet masqué, ou d'un partenaire masqué, ne se propose pas (audit n° 16).
  // Une option (26.11.2026) ne se vend pas seule : elle se choisit sous son service.
  const proposables = () => etat.db.prestations.filter((x) => proposable(x, etat.db.partenaires) && !estPrestationOption(x));
  const optionsDu = (x) => optionsDe(x.id, etat.db.prestations, etat.db.partenaires);
  let onglet = proposables().length || modeTaxi() ? "tarifs" : "trajets";
  const dernier = dossierId ? etat.db.reservations.filter((r) => r.dossier_id === dossierId).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] : null;
  const ctx = { date: defauts.date || (dernier && dernier.date_service) || "", adultes: defauts.adultes ?? (dernier && dernier.personnes ? dernier.personnes.adultes : 0) ?? 0, enfants: defauts.enfants ?? (dernier && dernier.personnes ? dernier.personnes.enfants : 0) ?? 0 };
  // Quantité proposée selon l'unité du tarif : par personne, par adulte, par enfant, sinon une seule.
  const qteDefaut = (x) => quantiteParDefaut(x.unite, ctx);
  // Les services les plus récemment demandés se retrouvent en tête de liste tant qu'on ne cherche rien.
  const cache = {};
  const recents = (cle) => (cache[cle] ||= [...new Set(etat.db.reservations.filter((r) => r[cle]).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")).map((r) => r[cle]))].slice(0, 5));
  let ajoutes = 0;
  const date = h("input", { id: "cp-date", type: "date", value: ctx.date, onchange: () => dessiner() });
  const q = h("input", { id: "cp-q", type: "search", placeholder: modeTaxi() ? tr("Aéroport, quai, plage…") : tr("Île, excursion, transfert, compagnie…"), autocomplete: "off", oninput: () => dessiner() });
  const liste = h("ul", { class: "choix-liste" });
  const compte = h("p", { class: "aide" });
  const onglets = h("div", { class: "onglets sous-onglets" }, ongletsDispo.map(([code, libelle]) => h("button", { type: "button", "aria-pressed": code === onglet ? "true" : "false", onclick: (e) => { onglet = code; for (const b of onglets.children) b.setAttribute("aria-pressed", b === e.currentTarget ? "true" : "false"); dessiner(); } }, libelle)));
  const sansPrix = (n) => n === null || n === undefined || n === "";
  // Sans prix de vente : la ligne entre au document sans montant ; elle est marquée pour qu'on pense à le saisir (audit n° 21).
  const prix = (n) => (sansPrix(n) ? h("span", { class: "tag attention" }, tr("prix à saisir")) : formatMontant(n, devise));
  const termine = h("button", { class: "principal", type: "button", onclick: () => fermer() }, tr("Terminé"));
  // Un tarif par personne avec des enfants au dossier : les adultes au tarif adulte, les enfants au tarif enfant de la base (une ligne chacun, comme
  // « Coller une demande »). Quantité changée à la main : une seule ligne, comme saisie. Sans tarif enfant, les enfants restent au tarif adulte.
  // Les participants du dossier suivent les lignes d'un tarif (18.11.2026) : le libellé dit « 2 adults, 2 children » plutôt que la quantité facturée.
  // Pas quand la quantité d'un tarif par personne a été changée à la main (on ne sait plus qui elle compte), ni pour une location ou un supplément.
  const avecParticipants = (lignes, x, quantite) => {
    const p = { adultes: Math.max(0, Number(ctx.adultes) || 0), enfants: Math.max(0, Number(ctx.enfants) || 0) };
    // Seulement les unités connues : un tarif sans unité garde la lecture d'avant (sa quantité ne dit pas qui elle compte).
    if (!(p.adultes + p.enfants) || x.sur_place || !["pp", "ad", "ch", "grp", "boat", "veh", "ses"].includes(x.unite)) return lignes;
    if (["pp", "ad", "ch"].includes(x.unite) && quantite !== qteDefaut(x)) return lignes;
    return lignes.map((l) => (l.kind === "ligne" ? { ...l, personnes: p } : l));
  };
  const lignesPrestation = (x, quantite) => avecParticipants(lignesTarif(x, quantite), x, quantite);
  const lignesTarif = (x, quantite) => {
    const adulte = ligneDepuisPrestation(x, netPrestation(x), { langue, date: date.value, qte: quantite, devise });
    const e = ["pp", "ad"].includes(x.unite) && ctx.enfants > 0 && quantite === qteDefaut(x) ? prestationEnfant(x, etat.db.prestations) : null;
    // Tarif par adulte sans prix enfant : les enfants ne sont pas facturés. On le dit, sans bloquer (offert ou gratuit chez le partenaire, c'est possible).
    if (x.unite === "ad" && ctx.enfants > 0 && quantite === qteDefaut(x) && (!e || sansPrix(e.prix_vente)) && !x.sur_place) toast(tr("Tarif par adulte sans prix enfant : les enfants ne sont pas facturés. Ajoutez le prix enfant dans la fiche de la prestation si besoin."), true);
    if (!e || sansPrix(e.prix_vente)) return [adulte];
    const adultes = ligneDepuisPrestation(x, netPrestation(x), { langue, date: date.value, qte: Math.max(1, ctx.adultes), devise });
    const enfant = ligneDepuisPrestation(e, netPrestation(e), { langue, date: date.value, qte: ctx.enfants, devise });
    return [adultes, { ...enfant, libelle: `${adultes.libelle}, ${langue === "en" ? "child" : "enfant"}`, intro: `(${langue === "en" ? "per child" : "par enfant"})` }];
  };
  // Le mode de règlement de l'option : exactement celui de son service (absent s'il est absent).
  const avecModeDe = (l, parent) => {
    const { paye_sur_place: _ancien, ...reste } = l;
    return parent.paye_sur_place === undefined ? reste : { ...reste, paye_sur_place: parent.paye_sur_place };
  };
  const ajoute = (lignes, nom) => {
    // Chaque service prend le mode de règlement habituel de son partenaire (chez nous ou sur place). Une option suit le mode de son service.
    const reglees = modeTaxi() ? lignesSurPlace(lignes) : appliquerModeParDefaut(lignes, partenaireDe);
    const parId = new Map(reglees.map((l) => [l.id, l]));
    onAjout(reglees.map((l) => (l.option_de && parId.has(l.option_de) ? avecModeDe(l, parId.get(l.option_de)) : l)));
    ajoutes++;
    termine.textContent = pluriel(ajoutes, N_("Terminé · {n} ajouté"), N_("Terminé · {n} ajoutés"));
    toast(tr("{nom} ajouté au document.", { nom }));
  };
  const noteBas = h("p", { class: "aide" }, langue === "en" ? tr("Document en anglais : le libellé anglais de la prestation est utilisé quand il existe.") : tr("Le libellé, le prix de vente et l'unité viennent de la base partenaires. Le net reste attaché à la ligne pour calculer la marge."));

  // Onglet « Autre prestation » : un service qui n'est pas dans la base, saisi à la main mais avec sa réservation et son voucher.
  const libelleLibre = h("input", { id: "cp-l-nom", autocomplete: "off" });
  const prixLibre = h("input", { id: "cp-l-prix", type: "number", min: "0", step: "any", inputmode: "decimal" });
  const qteLibre = h("input", { id: "cp-l-qte", type: "number", min: "1", step: "1", value: 1, inputmode: "numeric", oninput: () => (qteLibreTouchee = true) });
  // Prix par groupe ou par personne (Jérémy, 18.11.2026 : un tuk-tuk à 1 200 pour le groupe devenait 4 800 avec la quantité 4).
  // Par groupe, le choix sûr par défaut : quantité 1, le prix saisi est le total. Par personne : la quantité suit les participants, modifiable.
  // Les participants (adultes, enfants) sont gardés sur la ligne : ce sont eux que le libellé, le voucher et la Booking confirmation montrent.
  let qteLibreTouchee = false;
  const choixMode = (valeur, texte, coche) => h("label", { class: "case" }, h("input", { type: "radio", name: "cp-l-mode", value: valeur, checked: coche, onchange: () => majModePrix() }), texte);
  const choixGroupe = choixMode("grp", tr("Prix par groupe"), true);
  const choixPersonne = choixMode("pp", tr("Prix par personne"), false);
  const parPersonne = choixPersonne.querySelector("input");
  const nbLibre = (x) => Math.max(0, Math.floor(Number(x) || 0));
  const majQteLibre = () => {
    if (!qteLibreTouchee) qteLibre.value = Math.max(1, nbLibre(adultesLibre.value) + nbLibre(enfantsLibre.value));
  };
  const adultesLibre = h("input", { id: "cp-l-adultes", type: "number", min: "0", step: "1", inputmode: "numeric", value: ctx.adultes || "", oninput: majQteLibre });
  const enfantsLibre = h("input", { id: "cp-l-enfants", type: "number", min: "0", step: "1", inputmode: "numeric", value: ctx.enfants || "", oninput: majQteLibre });
  const aidePrixLibre = h("p", { class: "aide" });
  const aideNetLibre = h("p", { class: "aide" });
  const champQteLibre = champ(tr("Quantité"), qteLibre, tr("Le nombre de personnes facturées."));
  const majModePrix = () => {
    const pp = parPersonne.checked;
    champQteLibre.hidden = !pp;
    aidePrixLibre.textContent = pp ? tr("Par personne.") : tr("Le prix total pour le groupe.");
    aideNetLibre.textContent = pp ? tr("Par personne, ce que le partenaire facture à l'agence. Vide s'il n'est pas connu.") : tr("Pour le groupe, ce que le partenaire facture à l'agence. Vide s'il n'est pas connu.");
    majQteLibre();
  };
  const partenaireLibre = h("select", { id: "cp-l-part" }, h("option", { value: "" }, tr("Aucun partenaire")), prestataires(etat.db.partenaires).filter((p) => p.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => h("option", { value: p.id }, p.nom)));
  // Lot B (17.11.2026, audit n° 23) : le net, pour que la marge ne compte pas toute la vente, et le modèle de voucher, choisi plutôt que deviné
  // d'après les mots du libellé (« van », « speedboat »). Le net ne part jamais sur la facture : il rejoint la table protégée des nets.
  const avecNetLibre = peut("partenaires.nets");
  const netLibre = h("input", { id: "cp-l-net", type: "number", min: "0", step: "any", inputmode: "decimal" });
  const avecModeleLibre = modeExcursions() && !modeTaxi();
  const modeleLibre = h("select", { id: "cp-l-modele" });
  const majModeleLibre = () => {
    const auto = typeVoucherDeduit({ libelle: libelleLibre.value }, null, partenaireDe(partenaireLibre.value || null));
    const garde = modeleLibre.value;
    modeleLibre.replaceChildren(h("option", { value: "" }, auto ? tr("Automatique : {modele}", { modele: TITRES_VOUCHER[auto] }) : tr("Automatique : pas de voucher")), ...MODELES_VOUCHER.map((m) => h("option", { value: m }, TITRES_VOUCHER[m])), h("option", { value: SANS_VOUCHER }, tr("Pas de voucher")));
    modeleLibre.value = garde;
  };
  majModeleLibre();
  libelleLibre.addEventListener("change", majModeleLibre);
  partenaireLibre.addEventListener("change", majModeleLibre);
  // Payé sur place (INV-2026-035, 18.11.2026 : le voucher disait « Payment Pending » alors que les clients payaient le tuk-tuk en espèces) :
  // la case suit le mode habituel du partenaire choisi et se change à la main. Cochée, le voucher dit « Pay on Arrival ».
  const surPlaceLibre = h("input", { type: "checkbox", id: "cp-l-surplace" });
  const surPlaceDuPartenaire = () => modeParDefaut(partenaireDe(partenaireLibre.value || null)) === SUR_PLACE;
  partenaireLibre.addEventListener("change", () => (surPlaceLibre.checked = surPlaceDuPartenaire()));
  const erreurLibre = h("p", { class: "erreur-form", role: "alert" });
  const formulaireLibre = h(
    "form",
    {
      class: "choix-libre",
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        erreurLibre.textContent = "";
        if (!libelleLibre.value.trim()) return (erreurLibre.textContent = tr("Indiquez le nom de la prestation.")), libelleLibre.focus();
        if (prixLibre.value === "" || !(Number(prixLibre.value) >= 0)) return (erreurLibre.textContent = tr("Indiquez le prix de vente, 0 si la prestation est offerte.")), prixLibre.focus();
        if (avecNetLibre && netLibre.value !== "" && !(Number(netLibre.value) >= 0)) return (erreurLibre.textContent = tr("Le net est un nombre positif, ou vide s'il n'est pas connu.")), netLibre.focus();
        if (parPersonne.checked && !(Number(qteLibre.value) >= 1)) return (erreurLibre.textContent = tr("Indiquez la quantité, au moins 1.")), qteLibre.focus();
        const personnes = { adultes: nbLibre(adultesLibre.value), enfants: nbLibre(enfantsLibre.value) };
        const l = ligneLibre({ libelle: libelleLibre.value, prix: prixLibre.value, qte: qteLibre.value, partenaire_id: partenaireLibre.value, date: date.value, par: parPersonne.checked ? "pp" : "grp", personnes });
        if (avecNetLibre && netLibre.value !== "") l.net = Number(netLibre.value);
        if (avecModeleLibre && modeleLibre.value) l.modele_voucher = modeleLibre.value;
        // Taxi : tout est payé au chauffeur (lignesSurPlace). Ailleurs, la case l'emporte sur le mode du partenaire.
        if (!modeTaxi()) {
          if (surPlaceLibre.checked) l.paye_sur_place = true;
          else if (surPlaceDuPartenaire()) l.paye_sur_place = false;
        }
        ajoute([l], l.libelle);
        libelleLibre.value = "";
        prixLibre.value = "";
        qteLibreTouchee = false;
        majQteLibre();
        netLibre.value = "";
        surPlaceLibre.checked = surPlaceDuPartenaire();
        modeleLibre.value = "";
        majModeleLibre();
        libelleLibre.focus();
      },
    },
    h("p", { class: "aide" }, tr("Pour une prestation qui n'est pas dans la base. Elle va sur la facture avec sa réservation et son voucher. Pour la retrouver à chaque fois, créez-la plutôt dans la fiche du partenaire.")),
    champ(tr("Prestation"), libelleLibre, tr("Le nom tel que le client le lira sur la facture.")),
    h("div", { class: "choix-mode-prix", role: "radiogroup", "aria-label": tr("Prix") }, choixGroupe, choixPersonne),
    h("div", { class: "grille-form compacte" }, champ(tr("Adultes"), adultesLibre), champ(tr("Enfants"), enfantsLibre)),
    h("div", { class: "grille-form compacte" }, h("div", { class: "champ" }, h("label", { for: "cp-l-prix" }, tr("Prix de vente ({devise})", { devise })), prixLibre, aidePrixLibre), champQteLibre),
    champ(tr("Partenaire (facultatif)"), partenaireLibre, tr("Celui qui réalise la prestation, s'il y en a un.")),
    modeTaxi() ? null : h("label", { class: "case" }, surPlaceLibre, tr("Payé sur place par le client, au prestataire ou au chauffeur")),
    avecNetLibre ? h("div", { class: "champ" }, h("label", { for: "cp-l-net" }, tr("Net ({devise})", { devise })), netLibre, aideNetLibre) : null,
    avecModeleLibre ? champ(tr("Modèle de voucher"), modeleLibre, tr("Automatique : deviné d'après le nom. Choisissez-le si la déduction se trompe.")) : null,
    erreurLibre,
    h("div", { class: "actions" }, h("button", { class: "principal", type: "submit" }, tr("Ajouter")))
  );
  majModePrix();
  const qte = (id, valeur, libelle) => h("label", { class: "choix-qte" }, h("span", null, libelle), h("input", { id, type: "number", min: "0", step: "1", value: valeur, inputmode: "numeric" }));

  // Une rangée de tarif : touchée, elle se déplie (quantité, options, « Ajouter ») ; une seule à la fois, l'état gardé en redessinant.
  let deplie = null;
  const choixOptions = new Map(); // prestation → Map(option → { coche, prix })
  const etatOption = (x, o) => {
    if (!choixOptions.has(x.id)) choixOptions.set(x.id, new Map());
    const m = choixOptions.get(x.id);
    if (!m.has(o.id)) m.set(o.id, { coche: false, prix: o.prix_vente === null || o.prix_vente === undefined ? "" : String(o.prix_vente) });
    return m.get(o.id);
  };
  function rangeeTarif(x) {
    const d = x.details || {};
    const options = optionsDu(x);
    const ouvert = deplie === x.id;
    const tete = h(
      "button",
      { class: "choix-tete", type: "button", "aria-expanded": ouvert ? "true" : "false", onclick: () => ((deplie = ouvert ? null : x.id), dessiner()) },
      h("span", { class: "choix-texte" }, h("strong", null, x.libelle), h("span", null, [nomPartenaire(x.partenaire_id), x.groupe, d.horaires || d.capacite || d.duree].filter(Boolean).join(" · ")), options.length ? h("span", { class: "choix-options-nb" }, pluriel(options.length, N_("{n} option"), N_("{n} options"))) : null),
      h("span", { class: "choix-prix" }, h("strong", null, prix(x.prix_vente)), h("span", null, x.sur_place ? tr("à payer sur place") : libelleUnite(x.unite)))
    );
    if (!ouvert) return h("li", { class: "choix" }, tete);
    const champQte = x.sur_place ? null : qte(`cp-q-${x.id}`, qteDefaut(x), tr("Quantité"));
    const blocOptions = options.length
      ? h(
          "fieldset",
          { class: "cp-options" },
          h("legend", null, tr("Options")),
          options.map((o) => {
            const st = etatOption(x, o);
            const coche = h("input", { type: "checkbox", id: `cp-oc-${x.id}-${o.id}`, checked: st.coche, "aria-label": tr("Option {nom}", { nom: o.libelle }), onchange: (e) => (st.coche = e.target.checked) });
            // Un prix changé à la main coche l'option : on ne tape pas un prix pour une option qu'on ne prend pas.
            const prixO = h("input", { class: "cp-option-prix", id: `cp-o-${x.id}-${o.id}`, type: "number", min: "0", step: "any", inputmode: "decimal", value: st.prix, "aria-label": tr("Prix de l'option {nom}", { nom: o.libelle }), oninput: (e) => ((st.prix = e.target.value), (st.coche = true), (coche.checked = true)) });
            return h("label", { class: "cp-option", for: `cp-oc-${x.id}-${o.id}` }, coche, h("span", { class: "cp-option-nom" }, h("strong", null, o.libelle)), h("span", { class: "cp-option-prix-bloc" }, "+", prixO, h("span", null, libelleUnite(o.unite))));
          })
        )
      : null;
    const ajouter = () => {
      const quantite = champQte ? Number(champQte.querySelector("input").value) : 1;
      if (x.unite === "sup" && champQte && !(quantite > 0)) return toast(tr("Aucune personne supplémentaire : rien à ajouter. Indiquez combien de personnes dépassent les deux premières."), true);
      const lignes = lignesPrestation(x, quantite);
      const parent = lignes.find((l) => l.kind === "ligne") || null;
      const choisies = options.filter((o) => etatOption(x, o).coche);
      for (const o of choisies) {
        const v = etatOption(x, o).prix;
        if (v === "" || !(Number(v) >= 0)) return toast(tr("Indiquez le prix de l'option « {nom} », 0 si elle est offerte.", { nom: o.libelle }), true);
      }
      const lignesOptions = parent ? choisies.map((o) => ligneOption(o, parent, netPrestation(o), { langue, unitaire: Number(etatOption(x, o).prix) })) : [];
      ajoute([...lignes, ...lignesOptions], x.sur_place ? tr("Note sur les frais de parc") : choisies.length ? `${x.libelle} + ${choisies.map((o) => o.libelle).join(" + ")}` : x.libelle);
      choixOptions.delete(x.id);
      deplie = null;
      dessiner();
    };
    return h(
      "li",
      { class: "choix deplie" },
      tete,
      h("div", { class: "choix-detail" }, champQte, blocOptions, h("button", { class: "principal", type: "button", onclick: ajouter }, x.sur_place ? tr("Ajouter la note") : tr("Ajouter")))
    );
  }

  function dessiner() {
    liste.replaceChildren();
    const libre = onglet === "libre";
    formulaireLibre.hidden = !libre;
    for (const x of [liste, compte, q.parentNode, noteBas]) if (x) x.hidden = libre;
    if (libre) return;
    if (onglet === "tarifs") {
      // Un service se trouve aussi par le nom de l'une de ses options (« Kradan » trouve le 4 Islands privé).
      const lignes = proposables()
        .filter((x) => correspond(`${x.libelle} ${x.libelle_en} ${x.groupe} ${nomFamille(x.famille)} ${nomPartenaire(x.partenaire_id)} ${optionsDu(x).map((o) => `${o.libelle} ${o.libelle_en}`).join(" ")}`, q.value))
        .sort((a, b) => FAMILLES.findIndex(([c]) => c === a.famille) - FAMILLES.findIndex(([c]) => c === b.famille) || nomPartenaire(a.partenaire_id).localeCompare(nomPartenaire(b.partenaire_id)) || (a.ordre || 0) - (b.ordre || 0));
      compte.textContent = pluriel(lignes.length, N_("{n} tarif."), N_("{n} tarifs."));
      const frequents = q.value.trim() ? [] : recents("prestation_id").map((id) => lignes.find((x) => x.id === id)).filter(Boolean);
      const ordre = frequents.length ? [...frequents, ...lignes.filter((x) => !frequents.includes(x))] : lignes;
      let famille = null;
      for (const x of ordre) {
        const groupe = frequents.includes(x) ? "recent" : x.famille;
        if (groupe !== famille) {
          famille = groupe;
          liste.append(h("li", { class: "choix-groupe" }, groupe === "recent" ? tr("Récemment demandés") : nomFamille(groupe)));
        }
        liste.append(rangeeTarif(x));
      }
    } else {
      const lignes = filtrerTrajets(etat.db.trajets, { date: date.value, q: q.value, nomPartenaire, partenaires: etat.db.partenaires });
      compte.textContent = date.value ? pluriel(lignes.length, N_("{n} départ à cette date."), N_("{n} départs à cette date.")) : pluriel(lignes.length, N_("{n} départ."), N_("{n} départs."));
      const frequentsT = q.value.trim() ? [] : recents("trajet_id").map((id) => lignes.find((t) => t.id === id)).filter(Boolean);
      const ordreT = frequentsT.length ? [...frequentsT, ...lignes.filter((t) => !frequentsT.includes(t))] : lignes;
      if (frequentsT.length) liste.append(h("li", { class: "choix-groupe" }, tr("Récemment demandés")));
      for (const t of ordreT) {
        const ad = qte(`cp-a-${t.id}`, ctx.adultes || 1, tr("Adultes"));
        const ch = qte(`cp-c-${t.id}`, ctx.enfants, tr("Enfants"));
        liste.append(
          h(
            "li",
            { class: "choix" },
            h("div", { class: "choix-texte" }, h("strong", null, `${t.de} → ${t.vers}, ${t.depart}`), h("span", null, [nomPartenaire(t.partenaire_id), t.mode, t.duree, periodeSpecifique(t.periode)].filter(Boolean).join(" · "))),
            h("div", { class: "choix-prix" }, h("strong", null, prix(t.prix_adulte)), h("span", null, t.prix_enfant !== null && t.prix_enfant !== undefined ? tr("enfant {prix}", { prix: prix(t.prix_enfant) }) : tr("par adulte"))),
            h("div", { class: "choix-actions" }, ad, ch, h("button", { class: "principal petit", type: "button", onclick: () => { const nbEnfants = Number(ch.querySelector("input").value) || 0; if (nbEnfants > 0 && (t.prix_enfant === null || t.prix_enfant === undefined)) return toast(tr("Ce trajet n'a pas de tarif enfant : les enfants ne seraient pas facturés. Ajoutez le tarif enfant au partenaire ou mettez-les en adultes."), true); const l = lignesDepuisTrajet(t, netTrajet(t), { langue, date: date.value, adultes: Number(ad.querySelector("input").value) || 0, enfants: Number(ch.querySelector("input").value) || 0, compagnie: sansCompagnie ? "" : nomPartenaire(t.partenaire_id) }); if (!l.length) return toast(tr("Indiquez au moins un adulte ou un enfant."), true); const p = { adultes: Number(ad.querySelector("input").value) || 0, enfants: nbEnfants }; ajoute(l.map((x) => ({ ...x, personnes: p })), `${t.de} → ${t.vers}`); } }, tr("Ajouter")))
          )
        );
      }
    }
    if (!liste.children.length) liste.append(h("li", { class: "choix-vide" }, tr("Rien ne correspond. Essayez un autre mot, une autre date ou l'autre onglet.")));
  }
  dessiner();
  const fermer = modal(
    tr("Prestation d'un partenaire"),
    h(
      "div",
      { class: "modal-corps choix-prestation" },
      // En haut, fixes : la recherche, la date et les onglets. Seule la liste (ou le formulaire « Autre prestation ») défile.
      h("div", { class: "cp-haut" }, h("div", { class: "grille-form" }, h("div", { class: "champ cp-recherche" }, h("label", { for: "cp-q" }, tr("Rechercher")), q), h("div", { class: "champ" }, h("label", { for: "cp-date" }, tr("Date du service (facultatif)")), date)), onglets),
      h("div", { class: "cp-corps" }, formulaireLibre, compte, liste, noteBas),
      h("div", { class: "barre-modal" }, termine)
    ),
    { large: true, plein: true, protege: false }
  );
  // Au doigt, le clavier ne s'ouvre pas tout seul : la liste se parcourt d'abord, la recherche se touche quand on veut.
  if (!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) setTimeout(() => q.focus(), 50);
  return fermer;
}
