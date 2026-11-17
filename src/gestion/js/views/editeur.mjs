import { etat, modifier, nomClient, reglages, naviguer, peut, chargerDocument, moduleActif, versionsDocument, estAdmin } from "../etat.mjs";
import { h, champ, toast, num, vider, icone, modal, confirmer } from "../ui.mjs";
import { totaux, formatMontant, formatDate, aujourdhui, remiseJours, sommePaiements, montantLigne, montantSurPlace, modeReglement, SUR_PLACE, aMarquerEnvoye } from "../calc.mjs";
import { puceMode } from "./mode-reglement.mjs";
import { nouvelleLigne, modesPaiement, conditionsDocument } from "../defauts.mjs";
import { vide, feuille, pdf, montantRecu } from "./commun.mjs";
import { ouvrirVersions as ouvrirVersionsDocument } from "./versions.mjs";
import { supprimerDocument } from "./document-suppression.mjs";
import { envoyerDocument, sansImpression, refuserSansPrix } from "./document-envoi.mjs";
import { etatEnvoi, patchEnvoi, patchRetraitEnvoi, ecartRecu, reglagesChanges, lignesSansPrix, ligneSansPrix, envoiBloque, numeroDocument, numeroVerrouille, empreinteDocument, bandeauDansLangue, localeEnRetard } from "../documents-calc.mjs";
import { regenererLocale } from "./facture-locale.mjs";
import { choisirPrestation } from "./choix-prestation.mjs";
import { apercuMobile } from "./apercu-mobile.mjs";
import { tr, N_, pluriel, localeActive } from "../i18n.mjs";

const LARGEUR_FEUILLE = 794; // 210 mm à 96 dpi
const MAX_HISTORIQUE = 100;

// L'historique survit au rafraîchissement de l'écran après un « annuler », il est donc gardé ici et non dans la vue.
const historiques = new Map();
const positions = new Map();

export async function editeur(id) {
  await chargerDocument(id);
  return editeurVue(id);
}

function editeurVue(id) {
  const source = etat.db.documents.find((d) => d.id === id);
  if (!source) return vide(tr("Document introuvable"), tr("Il a peut-être été supprimé."), h("a", { class: "bouton secondaire", href: "#/dossiers" }, tr("Retour aux dossiers")));
  const doc = structuredClone(source);
  // La synchronisation avec les autres personnes ne doit pas retirer ce document de la mémoire pendant qu'on l'édite.
  etat.documentsOuverts.add(id);
  window.addEventListener("hashchange", () => etat.documentsOuverts.delete(id), { once: true });
  const dossier = etat.db.dossiers.find((d) => d.id === doc.dossier_id);
  const client = etat.db.clients.find((c) => c.id === dossier.client_id);
  const paiements = etat.db.paiements.filter((p) => p.dossier_id === dossier.id);
  const c = doc.contenu;
  const estFacture = doc.type === "facture";
  const locale = doc.type === "facture_locale";
  const nomDoc = locale ? tr("Facture locale") : estFacture ? tr("Facture") : tr("Devis");
  const regl = reglages();
  const devDoc = () => c.devise || regl.devise;
  // Mise au format actuel des équivalents : à faire avant le premier instantané de l'historique, sinon « Annuler » serait actif dès l'ouverture.
  const eq = c.equivalents || (c.equivalents = { actif: false });
  if (!Array.isArray(eq.lignes)) {
    const ancien = eq.eur !== undefined || eq.thb !== undefined;
    eq.lignes = ancien ? [{ code: "EUR", taux: eq.eur ?? regl.taux.eur }, { code: "THB", taux: eq.thb ?? regl.taux.thb }] : [];
    delete eq.eur;
    delete eq.thb;
  }
  // La devise est toujours écrite dans le document (17.11.2026) : changer celle de l'entreprise ne relabellise plus les anciens documents.
  const deviseAEcrire = !c.devise && !!regl.devise;
  if (deviseAEcrire) c.devise = regl.devise;

  const statut = h("span", { class: "etat-enregistrement", role: "status" }, tr("Enregistré"));
  const avertissementPrix = h("p", { class: "bandeau-alerte", role: "status", hidden: true });
  const avertissementAnglais = h("p", { class: "bandeau-info", role: "status", hidden: true }, tr("Ce document est en anglais, mais les conditions de paiement n'ont pas de version anglaise : elles s'impriment en français. Ajoutez-la dans Réglages, onglet Textes."));
  const cadre = h("div", { class: "apercu-cadre" });
  const echelle = h("div", { class: "apercu-echelle" });
  cadre.append(echelle);
  const zoneApercu = h("div", { class: "apercu" }, cadre);

  // ---- Enregistrement ------------------------------------------------------------------------------------
  // Un seul enregistrement à la fois : si une écriture est en cours, la suivante attend sa fin et la dernière version gagne. Après un échec
  // (réseau instable), nouvel essai automatique. Tant que tout n'est pas enregistré, fermer l'onglet est signalé. Si quelqu'un d'autre a
  // enregistré ce document entre-temps, on s'arrête et on demande, au lieu d'écraser son travail sans rien dire.
  let minuteur = null;
  let enVol = false;
  let aRecommencer = false;
  let nonEnregistre = false;
  let enConflit = false;
  let supprime = false;
  const bandeauConflit = h(
    "div",
    { class: "bandeau-alerte", role: "alert", hidden: true },
    h("p", null, tr("Quelqu'un d'autre a enregistré ce document pendant que vous le modifiiez. Vos dernières modifications ne sont pas enregistrées.")),
    h(
      "div",
      { class: "actions" },
      h("button", { class: "secondaire", type: "button", onclick: async () => (await chargerDocument(id), (nonEnregistre = false), naviguer(location.hash)) }, tr("Voir sa version et abandonner les miennes")),
      h("button", { class: "principal", type: "button", onclick: async () => (await chargerDocument(id), (enConflit = false), (bandeauConflit.hidden = true), ecrire()) }, tr("Garder la mienne et remplacer la sienne"))
    )
  );
  const heureEnregistrement = () => new Date().toLocaleTimeString(localeActive(), { hour: "2-digit", minute: "2-digit" });
  const ecrire = async () => {
    minuteur = null;
    if (enConflit || supprime) return;
    if (enVol) {
      aRecommencer = true;
      return;
    }
    enVol = true;
    try {
      await modifier("documents", id, { contenu: doc.contenu, date_emission: doc.date_emission, envoye_le: doc.envoye_le, updated_at: new Date().toISOString() }, { verrou: true });
      if (!minuteur && !aRecommencer) nonEnregistre = false;
      statut.textContent = tr("Enregistré à {heure}", { heure: heureEnregistrement() });
    } catch (err) {
      if (err.conflit) {
        enConflit = true;
        bandeauConflit.hidden = false;
        statut.textContent = tr("Non enregistré : document modifié par une autre personne");
      } else {
        statut.textContent = tr("Échec de l'enregistrement, nouvel essai dans quelques secondes");
        toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        minuteur = setTimeout(ecrire, 5000);
      }
    } finally {
      enVol = false;
      if (aRecommencer && !enConflit) {
        aRecommencer = false;
        ecrire();
      }
    }
  };
  const sauver = () => {
    // Les autres écrans lisent la copie en mémoire : on la met à jour tout de suite.
    const courant = etat.db.documents.find((d) => d.id === id);
    if (courant) Object.assign(courant, { contenu: structuredClone(doc.contenu), date_emission: doc.date_emission, envoye_le: doc.envoye_le });
    nonEnregistre = true;
    clearTimeout(minuteur);
    minuteur = setTimeout(ecrire, 600);
  };
  const sauverMaintenant = async () => {
    sauver();
    clearTimeout(minuteur);
    await ecrire();
  };
  window.addEventListener("hashchange", () => minuteur && (clearTimeout(minuteur), ecrire()), { once: true });
  window.addEventListener("beforeunload", (e) => {
    if (minuteur || enVol || nonEnregistre) e.preventDefault();
  });

  // ---- Versions précédentes du document ------------------------------------------------------------------
  const dateHeure = (iso) => new Date(iso).toLocaleString(localeActive(), { dateStyle: "medium", timeStyle: "short" });
  async function restaurerVersion(v, fermer) {
    if (!(await confirmer(tr("Remplacer le contenu actuel par la version du {date} ?", { date: dateHeure(v.archive_le) }), tr("Restaurer")))) return;
    fermer();
    try {
      // Ce qui est en attente d'enregistrement part d'abord, puis la version choisie le remplace (sans verrou : c'est voulu).
      if (minuteur) (clearTimeout(minuteur), await ecrire());
      await modifier("documents", id, { contenu: v.ligne.contenu, date_emission: v.ligne.date_emission, updated_at: new Date().toISOString() });
      historiques.delete(id);
      nonEnregistre = false;
      toast(tr("Version restaurée."));
      naviguer(location.hash);
    } catch (err) {
      toast(tr("Restauration impossible : {message}", { message: err.message }), true);
    }
  }
  async function ouvrirVersions() {
    let versions;
    try {
      versions = await versionsDocument(id);
    } catch (err) {
      toast(tr("Historique indisponible : {message}", { message: err.message }), true);
      return;
    }
    ouvrirVersionsDocument({
      versions,
      actuel: { contenu: doc.contenu, date_emission: doc.date_emission },
      devise: doc.contenu.devise || regl.devise,
      rendre: (v) => feuille({ ...doc, contenu: v.ligne.contenu, date_emission: v.ligne.date_emission }).noeud,
      restaurer: restaurerVersion,
      // Une version identique à un envoi se repère : « envoyée au client le … ».
      etiquette: (v) => {
        const e = empreinteDocument({ contenu: v.ligne.contenu, date_emission: v.ligne.date_emission });
        const envoi = (Array.isArray(c.envois) ? c.envois : []).filter((x) => x.empreinte === e).pop();
        return envoi ? tr("Version envoyée au client le {date}", { date: formatDate(envoi.le) }) : "";
      },
      envoiActuel: (() => { const e = etatEnvoi(doc); return e.envoye && !e.modifie && e.envois.length ? tr("Version envoyée au client le {date}", { date: formatDate(e.le) }) : ""; })(),
    });
  }
  const btnVersions = h("button", { class: "secondaire petit", type: "button", onclick: ouvrirVersions }, tr("Versions"));

  // ---- Historique : annuler et rétablir -----------------------------------------------------------------
  const instantanePris = () => JSON.stringify({ contenu: doc.contenu, date_emission: doc.date_emission });
  let hist = historiques.get(id);
  if (!hist || hist.pile[hist.i] !== instantanePris()) {
    hist = { pile: [instantanePris()], i: 0 };
    historiques.set(id, hist);
  }
  const btnAnnuler = h("button", { class: "secondaire petit bouton-icone", type: "button", title: tr("Annuler (Ctrl+Z)"), "aria-label": tr("Annuler la dernière modification"), onclick: () => annuler() }, icone("annuler"));
  const btnRetablir = h("button", { class: "secondaire petit bouton-icone", type: "button", title: tr("Rétablir (Ctrl+Maj+Z ou Ctrl+Y)"), "aria-label": tr("Rétablir la modification annulée"), onclick: () => retablir() }, icone("retablir"));
  const majBoutonsHistorique = () => {
    btnAnnuler.disabled = hist.i === 0 && instantanePris() === hist.pile[0];
    btnRetablir.disabled = hist.i >= hist.pile.length - 1;
  };
  majBoutonsHistorique();
  // Plusieurs frappes d'affilée forment une seule étape.
  let minuteurHistorique = null;
  const instantane = () => {
    clearTimeout(minuteurHistorique);
    const s = instantanePris();
    if (s === hist.pile[hist.i]) return;
    hist.pile.splice(hist.i + 1);
    hist.pile.push(s);
    if (hist.pile.length > MAX_HISTORIQUE) hist.pile.shift();
    hist.i = hist.pile.length - 1;
    majBoutonsHistorique();
  };
  const planifierInstantane = () => {
    clearTimeout(minuteurHistorique);
    minuteurHistorique = setTimeout(instantane, 500);
    majBoutonsHistorique();
  };
  async function appliquerHistorique(message) {
    const s = JSON.parse(hist.pile[hist.i]);
    doc.contenu = s.contenu;
    doc.date_emission = s.date_emission;
    await sauverMaintenant();
    positions.set(id, { form: formulaire.scrollTop, apercu: zoneApercu.scrollTop, y: window.scrollY });
    toast(message);
    naviguer(location.hash);
  }
  async function annuler() {
    instantane();
    if (hist.i === 0) return toast(tr("Rien à annuler."));
    hist.i--;
    await appliquerHistorique(tr("Modification annulée."));
  }
  async function retablir() {
    instantane();
    if (hist.i >= hist.pile.length - 1) return toast(tr("Rien à rétablir."));
    hist.i++;
    await appliquerHistorique(tr("Modification rétablie."));
  }

  // ---- Raccourcis clavier de l'éditeur ----------------------------------------------------------------
  const touche = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) (e.preventDefault(), annuler());
    else if ((k === "z" && e.shiftKey) || k === "y") (e.preventDefault(), retablir());
    else if (k === "s") (e.preventDefault(), sauverMaintenant().then(() => toast(tr("Enregistré."))));
    else if (k === "p") (e.preventDefault(), sansImpression() ? envoyer() : imprimer());
  };
  document.addEventListener("keydown", touche);
  window.addEventListener("hashchange", () => document.removeEventListener("keydown", touche), { once: true });

  const recuActuel = () => montantRecu(doc, paiements);

  function ajusterEchelle() {
    const largeur = zoneApercu.clientWidth;
    if (!largeur) return;
    const s = Math.min(1, (largeur - 2) / LARGEUR_FEUILLE) * (zoneApercu.zoom || 1);
    echelle.style.transform = `scale(${s})`;
    cadre.style.height = `${echelle.firstChild ? echelle.firstChild.offsetHeight * s : 0}px`;
    cadre.style.width = `${LARGEUR_FEUILLE * s}px`;
  }

  function dessinerApercu() {
    vider(echelle).append(feuille(doc).noeud);
    ajusterEchelle();
    // Un document en anglais dont les conditions de paiement n'ont pas de version anglaise les imprimerait en français.
    avertissementAnglais.hidden = !(c.langue === "en" && conditionsDocument(regl, c, true).manqueEn);
  }

  // Bandeau « envoyée le … » : redessiné à chaque modification (défini plus bas, avec les gestes d'envoi).
  let majBandeauEnvoi = () => {};
  const change = () => {
    statut.textContent = tr("Enregistrement…");
    majBandeauEnvoi();
    sauver();
    planifierInstantane();
    dessinerApercu();
    majMontants();
  };

  // ---- Champs généraux --------------------------------------------------------------------------------
  const date = h("input", { id: "d-date", type: "date", value: doc.date_emission, oninput: (e) => ((doc.date_emission = e.target.value), change()) });
  // La période du bandeau (« DU 2 AU 12 DÉCEMBRE 2026 ») suit la langue du document.
  const selLangue = h("select", { id: "d-langue", onchange: (e) => { c.langue = e.target.value; const b = bandeauDansLangue(c.bandeau, dossier, c.langue); if (b !== c.bandeau) (c.bandeau = b), (bandeau.value = b); change(); } }, h("option", { value: "" }, tr("Langue principale")), h("option", { value: "en" }, tr("English")));
  selLangue.value = c.langue === "en" ? "en" : "";
  const modes = modesPaiement(regl);
  const selPaiement = h("select", { id: "d-paiement", onchange: (e) => ((c.paiement = e.target.value), change()) }, modes.map((m) => h("option", { value: m.id }, m.nom)));
  selPaiement.value = modes.some((m) => m.id === (c.paiement || "")) ? c.paiement || "" : "";
  const numeroDoc = h("input", { id: "d-numero", value: c.numero || "", placeholder: dossier.ref, oninput: (e) => ((c.numero = e.target.value), change()) });
  // Le numéro d'un document parti chez le client ne change plus en passant : l'administratrice peut le déverrouiller, après confirmation.
  // Verrou recalculé à chaque envoi ou retrait de la date d'envoi (majVerrouNumero), tant que l'administratrice ne l'a pas levé.
  let numeroDeverrouille = false;
  const numeroBloque = numeroVerrouille([doc]);
  const deverrouillerNumero = h("button", { class: "lien", type: "button", onclick: async () => {
    if (!(await confirmer(tr("Ce document est déjà parti chez le client avec le numéro {numero}. Changer le numéro donne au client deux documents différents pour le même service. Le changer quand même ?", { numero: numeroDocument(doc, dossier) }), tr("Changer le numéro"), true))) return;
    numeroDeverrouille = true;
    majVerrouNumero();
    numeroDoc.focus();
  } }, tr("Changer le numéro"));
  const majVerrouNumero = () => {
    const bloque = numeroVerrouille([doc]) && !numeroDeverrouille;
    numeroDoc.readOnly = bloque;
    deverrouillerNumero.hidden = !bloque || !estAdmin();
    const aide = numeroDoc.parentElement && numeroDoc.parentElement.querySelector(".aide");
    if (aide) aide.textContent = bloque ? tr("Document envoyé : le numéro ne change plus.") : tr("Remplace la référence du dossier sur ce document.");
  };
  majVerrouNumero();
  const prestataire = h("input", { id: "d-prestataire", value: c.prestataire || "", placeholder: tr("Qui réalise le service, si ce n'est pas vous"), oninput: (e) => ((c.prestataire = e.target.value), change()) });
  const bandeau = h("input", { id: "d-bandeau", value: c.bandeau, oninput: (e) => ((c.bandeau = e.target.value), change()) });
  const colonnes = h(
    "select",
    {
      id: "d-col",
      value: c.colonnes,
      onchange: (e) => {
        c.colonnes = e.target.value;
        dessinerLignes();
        change();
      },
    },
    h("option", { value: "total" }, tr("Montant seulement")),
    h("option", { value: "detail" }, tr("Unité, quantité et total"))
  );

  // Devise du document, avec les devises proposées dans les réglages
  const devisesProposees = [...new Set([regl.devise, ...regl.listes.devises, c.devise].filter(Boolean))];
  const deviseSel = h(
    "select",
    {
      id: "d-dev",
      value: devDoc(),
      onchange: (e) => {
        c.devise = e.target.value;
        // Une devise ne peut pas être son propre équivalent.
        eq.lignes = eq.lignes.filter((l) => l.code !== devDoc());
        dessinerLignes();
        if (eq.actif && !eq.lignes.length) return ajouterEquivalent();
        dessinerEquivalents();
        change();
      },
    },
    devisesProposees.map((d) => h("option", { value: d }, d))
  );

  const pied = h("select", { id: "d-pied", value: c.pied, onchange: (e) => ((c.pied = e.target.value), change()) }, h("option", { value: "qr" }, tr("Coordonnées et informations de paiement")), h("option", { value: "email" }, tr("Renvoi vers le message de paiement")));
  const textePerso = h("div");
  const corpsPerso = h("textarea", { id: "d-perso-corps", rows: 9, oninput: (e) => ((c.conditions_corps = e.target.value), change()) });
  const cloturePerso = h("textarea", { id: "d-perso-cloture", rows: 3, oninput: (e) => ((c.conditions_cloture = e.target.value), change()) });
  corpsPerso.value = c.conditions_corps || "";
  cloturePerso.value = c.conditions_cloture || "";
  textePerso.append(champ(tr("Conditions de paiement de ce document"), corpsPerso, tr("Une ligne commençant par « - » devient une puce. **gras**, _italique_.")), champ(tr("Fin de texte"), cloturePerso));
  textePerso.hidden = c.variante !== "perso";
  const variante = h(
    "select",
    {
      id: "d-var",
      value: c.variante || (regl.textes.variantes[0] || {}).id,
      onchange: (e) => {
        if (e.target.value === "perso" && !c.conditions_corps) {
          const base = regl.textes.variantes.find((v) => v.id === c.variante) || regl.textes.variantes[0];
          c.conditions_corps = base.corps;
          c.conditions_cloture = base.cloture;
          corpsPerso.value = c.conditions_corps;
          cloturePerso.value = c.conditions_cloture;
        }
        c.variante = e.target.value;
        textePerso.hidden = c.variante !== "perso";
        change();
      },
    },
    regl.textes.variantes.map((v) => h("option", { value: v.id }, v.nom)),
    h("option", { value: "perso" }, tr("Texte propre à ce document"))
  );
  const cgv = h("input", { id: "d-cgv", type: "checkbox", checked: c.cgv !== false, onchange: (e) => ((c.cgv = e.target.checked), change()) });
  const tva = h("input", { id: "d-tva", type: "checkbox", checked: c.tva, onchange: (e) => ((c.tva = e.target.checked), change()) });
  if (!c.tva) tva.checked = false;

  // Équivalents indicatifs : une ou plusieurs devises, chacune avec son taux
  const tauxParDefaut = (code) => (devDoc() === regl.devise && regl.taux[code.toLowerCase()] ? regl.taux[code.toLowerCase()] : "");
  const eqLignes = h("div", { class: "eq-lignes" });
  const eqBloc = h("div", { class: "eq-bloc" }, eqLignes);
  const dessinerEquivalents = () => {
    const libres = () => devisesProposees.filter((d) => d !== devDoc());
    eqLignes.replaceChildren(
      ...eq.lignes.map((l, i) =>
        h(
          "div",
          { class: "eq-ligne" },
          h("span", { class: "eq-egal" }, `1 ${devDoc()} =`),
          h("input", { type: "number", step: "0.0001", min: "0", value: l.taux ?? "", "aria-label": tr("Taux vers {code}", { code: l.code }), oninput: (e) => ((l.taux = num(e.target.value) ?? ""), change()) }),
          h("select", { "aria-label": tr("Devise équivalente"), onchange: (e) => ((l.code = e.target.value), (l.taux = tauxParDefaut(l.code)), dessinerEquivalents(), change()) }, [...new Set([...libres(), l.code])].map((d) => h("option", { value: d, selected: d === l.code }, d))),
          h("button", { class: "lien danger-texte", type: "button", onclick: () => (eq.lignes.splice(i, 1), dessinerEquivalents(), change()) }, tr("Retirer"))
        )
      ),
      libres().length ? h("button", { class: "secondaire petit", type: "button", onclick: () => ajouterEquivalent() }, tr("Ajouter une devise")) : null
    );
  };
  const ajouterEquivalent = () => {
    const deja = new Set(eq.lignes.map((l) => l.code));
    const code = devisesProposees.find((d) => d !== devDoc() && !deja.has(d)) || devisesProposees.find((d) => d !== devDoc());
    if (!code) return;
    eq.lignes.push({ code, taux: tauxParDefaut(code) });
    dessinerEquivalents();
    change();
  };
  const eqActif = h("input", {
    id: "d-eq",
    type: "checkbox",
    checked: !!eq.actif,
    onchange: (e) => {
      eq.actif = e.target.checked;
      if (eq.actif && !eq.lignes.length) ajouterEquivalent();
      eqBloc.hidden = !eq.actif;
      change();
    },
  });
  if (!eq.actif) eqActif.checked = false;
  eqBloc.hidden = !eq.actif;
  dessinerEquivalents();

  // ---- Montant reçu (facture) --------------------------------------------------------------------------
  let blocRecu = null;
  if (estFacture) {
    const manuel = h("input", { id: "d-recu-manuel", type: "checkbox", checked: c.montant_recu != null });
    if (c.montant_recu == null) manuel.checked = false;
    const valeur = h("input", { id: "d-recu", type: "number", step: "0.01", min: "0", value: c.montant_recu ?? "", disabled: c.montant_recu == null });
    if (c.montant_recu != null) valeur.disabled = false;
    else valeur.disabled = true;
    const info = h("p", { class: "aide" });
    const majInfo = () => (info.textContent = c.montant_recu == null ? tr("Calculé d'après les paiements enregistrés : {montant}.", { montant: formatMontant(sommePaiements(paiements), devDoc()) }) : tr("Valeur saisie à la main."));
    manuel.addEventListener("change", () => {
      if (manuel.checked) {
        c.montant_recu = sommePaiements(paiements);
        valeur.value = c.montant_recu;
        valeur.disabled = false;
      } else {
        c.montant_recu = null;
        valeur.value = "";
        valeur.disabled = true;
      }
      majInfo();
      change();
    });
    valeur.addEventListener("input", () => {
      c.montant_recu = num(valeur.value) ?? 0;
      change();
    });
    majInfo();
    const libelleRecu = h("input", { id: "d-recu-lib", value: c.libelle_recu || "", placeholder: tr("Montant reçu"), oninput: (e) => ((c.libelle_recu = e.target.value.trim() || null), change()) });
    blocRecu = h("fieldset", null, h("legend", null, tr("Montant reçu")), info, h("label", { class: "case", for: "d-recu-manuel" }, manuel, tr("Saisir le montant à la main")), champ(tr("Montant reçu ({devDoc})", { devDoc: devDoc() }), valeur), champ(tr("Intitulé affiché sur la facture"), libelleRecu, tr("Par exemple « Acompte reçu ».")));
  }

  // ---- Lignes ------------------------------------------------------------------------------------------
  const listeLignes = h("div", { class: "lignes-edition" });
  const totalTexte = h("p", { class: "total-edition", "aria-live": "polite" });

  function majMontants() {
    const t = totaux(c, recuActuel());
    const d = devDoc();
    const total = locale ? tr("Total de la facture locale : {montant}", { montant: formatMontant(t.net, d) }) : estFacture ? tr("Total de la facture : {montant}, reste à payer {montant2}", { montant: formatMontant(t.net, d), montant2: formatMontant(t.reste, d) }) : tr("Total du devis : {montant}", { montant: formatMontant(t.net, d) });
    const place = montantSurPlace(c);
    totalTexte.textContent = place > 0 && estFacture ? tr("{texte}, à payer sur place {montant}", { texte: total, montant: formatMontant(place, d) }) : total;
    c.lignes.forEach((l, i) => {
      const el = listeLignes.querySelector(`[data-calc="${l.id}"]`);
      const sansPrix = ligneSansPrix(l);
      if (el) el.textContent = sansPrix ? tr("Prix à saisir") : l.offert ? tr("Offert") : l.paye_sur_place ? tr("{montant}, à payer sur place", { montant: formatMontant(montantLigne(l), d) }) : formatMontant(t.montants[i], d);
      const carte = listeLignes.querySelector(`[data-id="${l.id}"]`);
      if (carte) carte.classList.toggle("ligne-sans-prix", sansPrix);
    });
    // Une ligne sans prix compte 0 dans le total, mais une facture ne part pas tant qu'elle en a une (décision du 17.11.2026).
    const manquants = lignesSansPrix(c);
    avertissementPrix.hidden = !manquants.length;
    avertissementPrix.textContent = !manquants.length ? "" : estFacture || locale ? pluriel(manquants.length, N_("{n} ligne sans prix ({lignes}) : indiquez un prix ou cochez « Offert ». La facture ne peut pas être envoyée avant."), N_("{n} lignes sans prix ({lignes}) : indiquez un prix ou cochez « Offert ». La facture ne peut pas être envoyée avant."), { lignes: manquants.map((l) => (l.libelle || "").trim() || "…").join(", ") }) : pluriel(manquants.length, N_("{n} ligne sans prix ({lignes}) : elle compte 0 dans le total."), N_("{n} lignes sans prix ({lignes}) : elles comptent 0 dans le total."), { lignes: manquants.map((l) => (l.libelle || "").trim() || "…").join(", ") });
  }

  function deplacer(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= c.lignes.length) return;
    [c.lignes[i], c.lignes[j]] = [c.lignes[j], c.lignes[i]];
    dessinerLignes();
    change();
  }

  function editeurLigne(l, i) {
    const detail = c.colonnes === "detail";
    const maj = (champNom, conv = (v) => v) => (e) => ((l[champNom] = conv(e.target.value)), change());
    const libelle = h("input", { id: `l${l.id}-lib`, value: l.libelle, oninput: maj("libelle") });
    const kindTexte = { bloc: tr("Bloc de formule"), ligne: tr("Ligne"), remise: tr("Remise"), texte: tr("Note sous le tableau") }[l.kind];
    const champs = [champ(l.kind === "remise" ? tr("Intitulé de la remise") : l.kind === "texte" ? tr("Texte de la note") : tr("Libellé"), libelle)];
    // Ligne venue d'un partenaire : la date du service se garde avec la ligne, le net s'affiche pour qui a le droit.
    if ((l.prestation_id || l.trajet_id || l.libre) && l.kind !== "texte") {
      champs.push(
        h(
          "div",
          { class: "ligne-partenaire" },
          champ(tr("Date du service"), h("input", { id: `l${l.id}-ds`, type: "date", value: l.date_service || "", onchange: (e) => ((l.date_service = e.target.value || null), change()) })),
          peut("partenaires.nets") && l.net != null ? h("p", { class: "aide" }, tr("Net partenaire : {net}", { net: formatMontant(l.net, devDoc()) + (l.qte ? ` × ${l.qte}` : "") })) : null
        )
      );
    }
    // Le client règle cette ligne directement au prestataire : elle reste sur le document, mais pas dans le total à régler.
    if (l.kind === "ligne" && (l.prestation_id || l.trajet_id || l.libre)) {
      const puce = puceMode({ id: `l${l.id}-mode`, valeur: modeReglement(l), onchange: (v) => ((l.paye_sur_place = v === SUR_PLACE ? true : undefined), change()) });
      champs.push(h("div", { class: "champ champ-mode" }, h("span", { class: "etiquette", id: `l${l.id}-mode-lib` }, tr("Règlement")), puce, h("p", { class: "aide" }, tr("« Sur place » : le prix reste affiché mais n'entre pas dans le total à régler. Le prestataire reverse une commission."))));
    }
    if (l.kind === "bloc") {
      champs.push(champ(tr("Complément après le libellé"), h("input", { id: `l${l.id}-intro`, value: l.intro, placeholder: "comprenant:", oninput: maj("intro") })));
      const puces = h("textarea", { id: `l${l.id}-puces`, rows: 4, oninput: (e) => ((l.puces = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean)), change()) });
      puces.value = (l.puces || []).join("\n");
      champs.push(champ(tr("Détail, une ligne par puce"), puces));
    }
    const montants = [];
    if (l.kind === "remise") {
      const mode = h(
        "select",
        {
          id: `l${l.id}-mode`,
          onchange: (e) => {
            if (e.target.value === "pct") {
              l.pct = l.pct ?? 10;
              l.unite = null;
              l.qte = null;
              l.montant = null;
            } else {
              l.pct = null;
            }
            dessinerLignes();
            change();
          },
        },
        h("option", { value: "montant" }, tr("En {devDoc}", { devDoc: devDoc() })),
        h("option", { value: "pct" }, tr("En pourcentage"))
      );
      mode.value = l.pct != null ? "pct" : "montant";
      montants.push(champ(tr("Type de remise"), mode));
      if (l.pct != null) montants.push(champ(tr("Pourcentage"), h("input", { id: `l${l.id}-pct`, type: "number", step: "0.1", min: "0", value: l.pct, oninput: maj("pct", num) })));
    }
    // Service offert au client (rare) : il compte 0 et s'imprime « Offert » (« Complimentary » en anglais). Un prix vide n'est pas un service offert.
    if (l.kind === "ligne" || l.kind === "bloc") {
      champs.push(h("label", { class: "case", for: `l${l.id}-offert` }, h("input", { id: `l${l.id}-offert`, type: "checkbox", checked: !!l.offert, onchange: (e) => ((l.offert = e.target.checked || undefined), dessinerLignes(), change()) }), tr("Offert au client (compte 0, imprimé « Offert »)")));
    }
    if (l.kind !== "texte" && l.pct == null && !l.offert) {
      if (detail) {
        montants.push(champ(tr("Prix unitaire ({devDoc})", { devDoc: devDoc() }), h("input", { id: `l${l.id}-u`, type: "number", step: "0.01", value: l.unite ?? "", oninput: maj("unite", num) })));
        montants.push(champ(tr("Quantité"), h("input", { id: `l${l.id}-q`, type: "number", step: "1", value: l.qte ?? "", oninput: maj("qte", num) })));
      }
      montants.push(champ(detail ? tr("Total fixe (si pas de quantité)") : l.kind === "bloc" ? tr("Montant (vide si le prix est sur les lignes suivantes)") : tr("Montant ({devDoc})", { devDoc: devDoc() }), h("input", { id: `l${l.id}-m`, type: "number", step: "0.01", value: l.montant ?? "", oninput: maj("montant", num) })));
      montants.push(champ(tr("Texte à la place du montant"), h("input", { id: `l${l.id}-t`, value: l.texte_montant ?? "", placeholder: tr("inclus, offert"), oninput: (e) => ((l.texte_montant = e.target.value.trim() || null), change()) })));
    }
    const presetRemise =
      l.kind === "remise" && detail
        ? h(
            "button",
            {
              class: "secondaire petit",
              type: "button",
              onclick: () => {
                const ref = c.lignes.find((x) => x.kind !== "remise" && x.unite != null && x.qte != null);
                if (!ref) {
                  toast(tr("Ajoutez d'abord une ligne avec prix unitaire et quantité."), true);
                  return;
                }
                l.libelle = "1 jour tous les 14 jours de voyage";
                l.pct = null;
                l.unite = ref.unite;
                l.qte = remiseJours(ref.qte);
                dessinerLignes();
                change();
              },
            },
            tr("Remplir : 1 jour tous les 14 jours")
          )
        : null;
    return h(
      "div",
      { class: "carte-ligne", "data-id": l.id },
      h(
        "div",
        { class: "carte-ligne-tete" },
        h("strong", null, kindTexte),
        h("span", { class: "calc", "data-calc": l.id }),
        h(
          "span",
          { class: "outils" },
          h("button", { class: "lien", type: "button", "aria-label": tr("Monter la ligne {x}", { x: i + 1 }), onclick: () => deplacer(i, -1) }, tr("Monter")),
          h("button", { class: "lien", type: "button", "aria-label": tr("Descendre la ligne {x}", { x: i + 1 }), onclick: () => deplacer(i, 1) }, tr("Descendre")),
          h(
            "button",
            {
              class: "lien danger-texte",
              type: "button",
              "aria-label": tr("Supprimer la ligne {x}", { x: i + 1 }),
              onclick: () => {
                c.lignes.splice(i, 1);
                dessinerLignes();
                change();
              },
            },
            tr("Supprimer")
          )
        )
      ),
      ...champs,
      h("div", { class: "grille-form compacte" }, montants),
      presetRemise
    );
  }

  function dessinerLignes() {
    vider(listeLignes);
    if (!c.lignes.length) listeLignes.append(h("p", { class: "vide-court" }, tr("Aucune ligne. Ajoutez un bloc de formule ou une ligne depuis le catalogue ci-dessous.")));
    c.lignes.forEach((l, i) => listeLignes.append(editeurLigne(l, i)));
    majMontants();
  }

  const ajoute = (l) => {
    c.lignes.push(l);
    dessinerLignes();
    change();
    const carte = listeLignes.querySelector(`[data-id="${l.id}"] input`);
    if (carte) carte.focus();
  };
  const catalogueActif = [...etat.db.catalogue].filter((x) => x.actif).sort((a, b) => a.ordre - b.ordre);
  const depuisCatalogue = h(
    "select",
    {
      id: "d-cat",
      onchange: (e) => {
        const entree = etat.db.catalogue.find((x) => x.id === e.target.value);
        e.target.value = "";
        if (!entree) return;
        const detail = c.colonnes === "detail";
        if (entree.kind === "formule") {
          const prix = entree.prix != null && detail;
          ajoute(nouvelleLigne("bloc", { libelle: entree.libelle, intro: entree.intro, puces: [...entree.puces], unite: prix ? entree.prix : null, qte: prix ? 1 : null, montant: entree.prix != null && !detail ? entree.prix : null }));
        } else {
          ajoute(nouvelleLigne("ligne", { libelle: entree.libelle, montant: entree.prix }));
        }
      },
    },
    h("option", { value: "" }, tr("Ajouter depuis le catalogue…")),
    ["formule", "region", "supplement"].map((k) =>
      h("optgroup", { label: { formule: tr("Formules"), region: tr("Régions et villes"), supplement: tr("Suppléments") }[k] }, catalogueActif.filter((x) => x.kind === k).map((x) => h("option", { value: x.id }, x.prix != null ? `${x.libelle} (${regl.devise} ${x.prix})` : x.libelle)))
    )
  );

  // ---- Actions ------------------------------------------------------------------------------------------
  // « Envoyer » sur tous les appareils : le PDF est fabriqué dans la page, puis WhatsApp ou l'e-mail s'ouvre avec le message.
  // Un document envoyé sans date d'envoi n'est jamais relancé : la fenêtre d'envoi propose de la poser.
  // Reporte sur `c` ce que l'envoi (ou son retrait) change : date, copie figée, traces, devise, montant reçu. Le reste du contenu garde ses
  // objets (lignes, équivalents) : les champs de l'éditeur pointent dessus, les remplacer ferait perdre les modifications suivantes.
  const appliquer = (patch) => {
    if ("envoye_le" in patch) doc.envoye_le = patch.envoye_le;
    for (const k of ["fige", "envois", "devise", "montant_recu"]) {
      if (patch.contenu && k in patch.contenu) c[k] = patch.contenu[k];
      else delete c[k];
    }
  };
  // Marquer le document parti chez le client : date, copie figée de l'émetteur, de la banque, de la devise et de l'acompte, trace de l'envoi.
  async function marquerEnvoi() {
    if (envoiBloque(doc)) return void refuserSansPrix(doc);
    appliquer(patchEnvoi(doc, regl, { date: aujourdhui(), paiements }));
    if (doc.type === "devis" && "acompte_pct" in dossier && dossier.acompte_pct == null) {
      // L'acompte % du dossier se fige au premier envoi du devis (migration du lot C1) : un changement des Réglages ne le change plus.
      try {
        await modifier("dossiers", dossier.id, { acompte_pct: c.fige.acompte_pct });
      } catch (err) {
        toast(tr("Acompte non figé sur le dossier : {message}", { message: err.message }), true);
      }
    }
    majBoutonEnvoi();
    change();
    if (blocRecu) toast(tr("Facture envoyée : le montant reçu est figé."));
  }
  // « Renvoyer » la version corrigée : au besoin, le montant reçu imprimé est d'abord mis à jour d'après les paiements enregistrés.
  async function renvoyer() {
    const ecart = ecartRecu(doc, paiements);
    if (ecart && (await confirmer(tr("La facture envoyée indique {imprime} reçus. Les paiements enregistrés font {paiements}. Mettre {paiements} sur la facture renvoyée ?", { imprime: formatMontant(ecart.imprime, devDoc()), paiements: formatMontant(ecart.paiements, devDoc()) }), tr("Mettre à jour le montant reçu")))) {
      c.montant_recu = ecart.paiements;
      const champRecu = formulaire.querySelector("#d-recu");
      if (champRecu) champRecu.value = ecart.paiements;
      change();
      await sauverMaintenant();
    }
    envoyerDocument({ ...doc, contenu: structuredClone(c) }, { renvoi: true, marquerEnvoye: marquerEnvoi });
  }
  // « Envoyer » sur tous les appareils : le PDF est fabriqué dans la page, puis WhatsApp ou l'e-mail s'ouvre avec le message.
  // Un document envoyé sans date d'envoi n'est jamais relancé : la fenêtre d'envoi propose de la poser. Modifié depuis l'envoi : c'est un renvoi.
  const envoyer = () => (etatEnvoi(doc).modifie ? renvoyer() : envoyerDocument({ ...doc }, { marquerEnvoye: marquerEnvoi }));
  // « Imprimer » (ordinateur seulement) : la fenêtre d'impression du navigateur, pour qui veut le papier ou son propre envoi.
  async function imprimer() {
    pdf({ ...doc });
    if (aMarquerEnvoye(doc) && !envoiBloque(doc) && peut("documents.ecrire") && (await confirmer(doc.type === "devis" ? tr("Ce devis est-il parti chez le client ? Marqué comme envoyé, il apparaît dans « À faire » pour la relance.") : tr("Cette facture est-elle partie chez le client ? Marquée comme envoyée, elle n'apparaît plus comme « pas encore envoyée »."), doc.type === "devis" ? tr("Marquer comme envoyé") : tr("Marquer comme envoyée")))) await marquerEnvoi();
  }
  const boutonEnvoi = h("button", { class: "secondaire", type: "button" });
  function majBoutonEnvoi() {
    boutonEnvoi.textContent = doc.envoye_le ? (estFacture || locale ? tr("Envoyée le {date}", { date: formatDate(doc.envoye_le) }) : tr("Envoyé le {date}", { date: formatDate(doc.envoye_le) })) : estFacture || locale ? tr("Marquer comme envoyée") : tr("Marquer comme envoyé");
    boutonEnvoi.title = doc.envoye_le ? tr("Cliquer pour retirer la date d'envoi") : "";
    majVerrouNumero();
    majBandeauEnvoi();
  }
  boutonEnvoi.addEventListener("click", async () => {
    if (!doc.envoye_le) return marquerEnvoi();
    // Retirer la date d'envoi se confirme : le document redevient « pas encore envoyé » et, s'il n'a été envoyé qu'une fois, perd sa copie figée.
    const message = estFacture ? tr("Retirer la date d'envoi du {date} ? La facture redevient « pas encore envoyée » et son montant reçu suit de nouveau les paiements. À faire seulement si elle n'est pas partie chez le client.", { date: formatDate(doc.envoye_le) }) : tr("Retirer la date d'envoi du {date} ? Le document redevient « pas encore envoyé ». À faire seulement s'il n'est pas parti chez le client.", { date: formatDate(doc.envoye_le) });
    if (!(await confirmer(message, tr("Retirer la date d'envoi"), true))) return;
    appliquer(patchRetraitEnvoi(doc));
    majBoutonEnvoi();
    change();
    toast(tr("Date d'envoi retirée."));
  });

  // Bandeau d'un document envoyé : quand, combien de fois, et s'il a changé depuis (décision du 17.11.2026 : on renvoie la version corrigée).
  const texteEnvoi = h("p");
  const boutonRenvoyer = h("button", { class: "principal petit", type: "button", onclick: () => renvoyer() }, tr("Renvoyer"));
  const noteReglages = h("p", { class: "aide" });
  const bandeauEnvoi = h("div", { class: "bandeau-info bandeau-envoi", role: "status", hidden: true }, texteEnvoi, noteReglages, h("div", { class: "actions gauche" }, boutonRenvoyer));
  majBandeauEnvoi = () => {
    const e = etatEnvoi(doc);
    bandeauEnvoi.hidden = !e.envoye;
    if (!e.envoye) return;
    const renvois = e.envois.slice(1).map((x) => formatDate(x.le));
    const quand = e.envois.length ? (estFacture || locale ? tr("Envoyée le {date}", { date: formatDate(e.envois[0].le) }) : tr("Envoyé le {date}", { date: formatDate(e.envois[0].le) })) : estFacture || locale ? tr("Envoyée le {date}", { date: formatDate(e.le) }) : tr("Envoyé le {date}", { date: formatDate(e.le) });
    texteEnvoi.textContent = [quand, renvois.length ? tr("renvoyée le {dates}", { dates: renvois.join(", ") }) : "", e.modifie ? tr("Modifiée depuis l'envoi du {date} : le client a encore l'ancienne version. Renvoyez-lui la version corrigée.", { date: formatDate(e.le) }) : ""].filter(Boolean).map((x) => x.replace(/\.$/, "")).join(". ") + ".";
    bandeauEnvoi.classList.toggle("bandeau-alerte", e.modifie);
    bandeauEnvoi.classList.toggle("bandeau-info", !e.modifie);
    boutonRenvoyer.hidden = !e.modifie;
    noteReglages.textContent = reglagesChanges(regl, c) ? tr("Les coordonnées de l'entreprise, la banque ou l'acompte ont changé dans les Réglages depuis l'envoi : ce document garde ceux du jour de l'envoi. « Renvoyer » prend ceux d'aujourd'hui.") : "";
    noteReglages.hidden = !noteReglages.textContent;
  };
  majBoutonEnvoi();

  // Facture locale : copie figée de la facture du client. Si la facture a été corrigée depuis, on le dit et on propose de la recréer.
  const factureSource = locale ? etat.db.documents.find((x) => x.id === (c.source || {}).facture_id) : null;
  const bandeauLocale = locale && localeEnRetard(doc, factureSource)
    ? h("div", { class: "bandeau-alerte", role: "status" }, h("p", null, tr("La facture du client a été modifiée depuis la création de cette facture locale : les montants peuvent ne plus correspondre.")), peut("documents.ecrire") ? h("div", { class: "actions gauche" }, h("button", { class: "principal petit", type: "button", onclick: async () => { if (await regenererLocale(doc, factureSource)) naviguer(location.hash); } }, tr("Recréer depuis la facture"))) : null)
    : null;

  dessinerLignes();
  dessinerApercu();
  majBoutonsHistorique();
  if (deviseAEcrire && peut("documents.ecrire")) sauver();
  window.addEventListener("resize", ajusterEchelle);
  window.addEventListener("hashchange", () => window.removeEventListener("resize", ajusterEchelle), { once: true });
  new ResizeObserver(() => requestAnimationFrame(ajusterEchelle)).observe(zoneApercu);

  const formulaire = h(
    "div",
    { class: "editeur-form" },
    h("fieldset", null, h("legend", null, tr("En-tête")), h("div", { class: "grille-form" }, champ(tr("Date d'émission"), date), champ(tr("Colonnes"), colonnes), champ(tr("Devise du document"), deviseSel)), champ(tr("Titre dans la bande de couleur"), bandeau), champ(tr("Prestataire du service (facultatif)"), prestataire), h("div", { class: "grille-form" }, champ(tr("Langue du document"), selLangue), modes.length > 1 ? champ(tr("Informations de paiement"), selPaiement) : null, h("div", null, champ(tr("Numéro affiché (facultatif)"), numeroDoc, numeroBloque ? tr("Document envoyé : le numéro ne change plus.") : tr("Remplace la référence du dossier sur ce document.")), deverrouillerNumero))),
    h("fieldset", null, h("legend", null, tr("Contenu")), listeLignes, h("div", { class: "ajouts" }, moduleActif("catalogue") ? h("button", { class: "secondaire petit", type: "button", onclick: () => ajoute(nouvelleLigne("bloc", { intro: "comprenant:" })) }, tr("Ajouter un bloc de formule")) : null, h("button", { class: "secondaire petit", type: "button", onclick: () => ajoute(nouvelleLigne("ligne")) }, tr("Ajouter une ligne")), h("button", { class: "secondaire petit", type: "button", onclick: () => ajoute(nouvelleLigne("remise")) }, tr("Ajouter une remise")), h("button", { class: "secondaire petit", type: "button", onclick: () => ajoute(nouvelleLigne("texte")) }, tr("Ajouter une note")), peut("partenaires.lire") && moduleActif("partenaires") && (etat.db.prestations.length || etat.db.trajets.length) ? h("button", { class: "principal petit", type: "button", onclick: () => choisirPrestation({ langue: c.langue, devise: devDoc(), onAjout: (lignes) => { lignes.forEach((l) => c.lignes.push(l)); dessinerLignes(); change(); } }) }, tr("Prestation d'un partenaire")) : null), moduleActif("catalogue") ? champ(tr("Catalogue"), depuisCatalogue) : null, totalTexte),
    blocRecu,
    h(
      "fieldset",
      null,
      h("legend", null, tr("Bas de page et mentions")),
      champ(tr("Conditions de paiement"), variante),
      textePerso,
      champ(tr("Pied de page"), pied),
      // Une facture sans lien vers des CGV n'a pas de phrase à afficher (voir document.mjs) : la case n'apparaît pas.
      doc.type !== "devis" && !(regl.conditions.cgv_url || "").trim() && !((regl.libelles || {}).cgv_facture || (regl.libelles_en || {}).cgv_facture || "").trim() ? null : h("label", { class: "case", for: "d-cgv" }, cgv, tr("Afficher la phrase sur les Conditions Générales de Vente")),
      h("label", { class: "case", for: "d-tva" }, tva, tr("Afficher « {tva_mention} »", { tva_mention: regl.conditions.tva_mention })),
      h("label", { class: "case", for: "d-eq" }, eqActif, tr("Afficher l'équivalent dans une ou plusieurs autres devises, à titre indicatif")),
      eqBloc
    ),
    peut("documents.supprimer") ? h("div", { class: "zone-danger" }, h("button", { class: "secondaire danger-texte", type: "button", onclick: async () => { await supprimerDocument(doc, () => { supprime = true; nonEnregistre = false; clearTimeout(minuteur); minuteur = null; naviguer(`#/dossier/${dossier.id}`); }); } }, doc.type === "devis" ? tr("Supprimer ce devis") : tr("Supprimer cette facture"))) : null
  );

  const lectureSeule = !peut("documents.ecrire");
  const corpsEditeur = h("div", { class: "editeur" }, formulaire, zoneApercu);
  const barreEditeur = apercuMobile({ racine: corpsEditeur, zoneApercu, ajuster: ajusterEchelle });
  const racine = h(
    "div",
    { "data-titre": `${nomDoc} ${dossier.ref}`, "data-large": "1", "data-plein": "1" },
    h("a", { class: "retour", href: `#/dossier/${dossier.id}` }, nomClient(client)),
    h(
      "div",
      { class: "entete editeur-entete" },
      h("div", null, h("h1", null, nomDoc), h("p", { class: "sous" }, h("span", { class: "ref" }, dossier.ref), " · ", nomClient(client))),
      h("div", { class: "entete-actions" }, statut, lectureSeule ? null : btnVersions, btnAnnuler, btnRetablir, boutonEnvoi, sansImpression() ? null : h("button", { class: "lien", type: "button", title: tr("Imprimer (Ctrl+P)"), onclick: imprimer }, tr("Imprimer")), h("button", { class: "principal", type: "button", onclick: envoyer }, tr("Envoyer")))
    ),
    h("p", { class: "aide-pdf seulement-bureau" }, tr("« Envoyer » prépare le PDF « {nomDoc} {ref} » et ouvre WhatsApp ou l'e-mail du client avec le message. Raccourcis : Ctrl+Z annuler, Ctrl+Maj+Z rétablir, Ctrl+S enregistrer, Ctrl+P imprimer. Le formulaire et l'aperçu défilent séparément.", { nomDoc, ref: numeroDocument(doc, dossier) })),
    bandeauConflit,
    bandeauEnvoi,
    bandeauLocale,
    avertissementPrix,
    avertissementAnglais,
    lectureSeule ? h("p", { class: "bandeau-info" }, tr("Lecture seule : votre rôle ne permet pas de modifier les devis et factures. Vous pouvez les consulter et télécharger le PDF.")) : null,
    barreEditeur,
    corpsEditeur
  );
  if (lectureSeule) {
    for (const el of formulaire.querySelectorAll("input, select, textarea, button")) el.disabled = true;
    for (const b of [btnAnnuler, btnRetablir, boutonEnvoi, boutonRenvoyer]) b.disabled = true;
  }

  // Après un « annuler », l'écran est reconstruit : on retrouve les positions de défilement.
  const pos = positions.get(id);
  if (pos) {
    positions.delete(id);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        formulaire.scrollTop = pos.form;
        zoneApercu.scrollTop = pos.apercu;
        window.scrollTo(0, pos.y);
      })
    );
  }
  return racine;
}
