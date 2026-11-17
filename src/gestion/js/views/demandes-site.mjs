// « Demandes du site » : les demandes de réservation envoyées depuis secrettravelandtour.com (migration 30), une carte par demande.
// Anaïs reçoit une notification, ouvre la carte, et en un geste confirme (le dossier se crée comme avec « Coller une demande »), modifie
// (date, heure, option, prix) puis confirme, ou refuse en proposant autre chose. Chaque fois une réponse anglaise à copier dans la
// conversation WhatsApp du client : le site ne donne pas son numéro, la référence affichée en grand sert à retrouver la conversation.
// Rien ne part au prestataire (règle du 14.11.2026). Secret et Taxi seulement ; chaque entreprise ne voit que ses demandes.
import { etat, modifier, peut, modeExcursions, modeTaxi, entitesAccessibles, changerEntite, naviguer, recharger } from "../etat.mjs";
import { h, modal, toast, champ, puces, confirmer, icone } from "../ui.mjs";
import { aujourdhui, formatMontant } from "../calc.mjs";
import { tr, N_, pluriel, localeActive } from "../i18n.mjs";
import { ouvrirDemande } from "./demande.mjs";
import { copierTexte } from "./partage.mjs";
import { vide } from "./commun.mjs";
import {
  STATUTS_DEMANDE, MOTIFS_REFUS, nomProduit, titreOption, optionsProduit, texteDemande, changements, reponseConfirmation, reponseRefus,
  trierDemandes, aTraiter, chiffresDemandes, cheminPage,
} from "../demandes-site-calc.mjs";
import { PRODUITS_SITE } from "../site-produits.mjs";

let onglet = "a_traiter";
let periode = "30";
const rafraichir = () => window.dispatchEvent(new HashChangeEvent("hashchange"));

// L'écran existe pour Secret et Taxi, pour qui lit tous les dossiers (comme la base : lit_demandes_site).
export const demandesVisibles = () => modeExcursions() && peut("dossiers.lire");

// « mar. 18 nov. » dans la langue de l'interface.
const jourCourt = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(localeActive(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "");
function recue(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return tr("à l'instant");
  if (min < 60) return tr("il y a {n} min", { n: min });
  if (min < 24 * 60) return tr("il y a {n} h", { n: Math.floor(min / 60) });
  const d = new Date(iso);
  return d.toLocaleString(localeActive(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
const personnes = (d) => [d.adultes ? pluriel(d.adultes, N_("adulte"), N_("adultes")) : "", d.enfants ? pluriel(d.enfants, N_("enfant"), N_("enfants")) : ""].filter(Boolean).join(", ");

// ---- Réponse au client ---------------------------------------------------------------------------------------------
// Texte anglais modifiable, un bouton Copier, la référence en grand pour retrouver la conversation. Jamais de lien wa.me : pas de numéro.
function ouvrirReponse(d, texte, { titre, dossierId = null, apresCopie = null } = {}) {
  const zone = h("textarea", { id: "dsite-reponse", rows: 12, lang: "en", spellcheck: "true" }, texte);
  zone.value = texte;
  let fermer;
  const copier = h("button", { class: "principal", type: "button", onclick: async () => {
    await copierTexte(zone.value);
    if (apresCopie) await apresCopie(zone.value);
  } }, icone("copier", 18), tr("Copier"));
  const corps = h(
    "div",
    { class: "modal-corps dsite-reponse" },
    blocReference(d),
    h("p", { class: "aide" }, tr("Ouvrez la conversation WhatsApp de ce client, collez la réponse et envoyez-la. Le texte reste modifiable ici.")),
    champ(tr("Réponse en anglais"), zone),
    h("div", { class: "barre-modal" }, copier, dossierId ? h("button", { class: "secondaire", type: "button", onclick: () => (fermer(), naviguer(`#/dossier/${dossierId}`)) }, tr("Ouvrir le dossier")) : null)
  );
  fermer = modal(titre, corps, { protege: false });
}

// La référence WhatsApp en grand ; sans référence (ancien site), le nom et l'heure d'envoi pour retrouver le message.
function blocReference(d) {
  return d.ref
    ? h("p", { class: "dsite-ref" }, h("span", { class: "dsite-ref-libelle" }, tr("Réf. WhatsApp")), h("strong", null, d.ref))
    : h("p", { class: "dsite-ref sans" }, h("span", { class: "dsite-ref-libelle" }, tr("Sans référence")), h("strong", null, tr("Message de {nom}, {quand}", { nom: d.nom || tr("nom inconnu"), quand: recue(d.created_at) })));
}

// ---- Les trois gestes ----------------------------------------------------------------------------------------------
// Confirmer, ou confirmer avec les changements de « Modifier » : la fenêtre « Coller une demande » s'ouvre avec le message du site
// (et les changements posés dessus), le dossier se crée d'un tap, puis la réponse anglaise est prête à copier.
// Deux personnes peuvent avoir la même demande sous les yeux (téléphone d'Anaïs, ordinateur de Jérémy) : la version lue à l'ouverture
// sert de verrou. Une demande traitée entre-temps n'est pas réécrite, et on dit quel dossier vient d'être créé en double.
function dejaTraitee(d) {
  const actuelle = (etat.brut.demandes_site || []).find((x) => x.id === d.id);
  return actuelle && actuelle.statut !== "nouvelle" ? actuelle : null;
}
function confirmer_(d, modifs = {}) {
  const ref = d.ref || nomProduit(d);
  if (dejaTraitee(d)) return void (toast(tr("Cette demande a déjà été traitée."), true), rafraichir());
  ouvrirDemande({
    titre: Object.keys(modifs).length ? tr("Confirmer {ref} avec les changements", { ref }) : tr("Confirmer {ref}", { ref }),
    texte: texteDemande(d, modifs),
    prixImpose: modifs.prix ?? null,
    surCree: async ({ dossier, services, total }) => {
      const s = services[0] || {};
      // Plusieurs services (liste de sorties) : la réponse les reprend un par un, le total est celui de la facture.
      const final = {
        ...(services.length > 1 ? { services: services.map((x) => ({ titre: x.titre, date: x.date, heure: x.heure, adultes: x.adultes, enfants: x.enfants })) } : {}),
        date: s.date || modifs.date || d.date_service,
        heure: s.heure || modifs.heure || d.heure,
        option_titre: modifs.option_titre || titreOption(d),
        adultes: s.adultes ?? d.adultes,
        enfants: s.enfants ?? d.enfants,
        total: modifs.prix ?? (total > 0 ? total : null),
        devise: (etat.db.reglages && etat.db.reglages.devise) || d.devise || "THB",
      };
      const decision = { changements: changements(d, final), final };
      try {
        await modifier("demandes_site", d.id, { statut: "confirmee", dossier_id: dossier.id, decision }, { verrou: true, version: d.updated_at });
      } catch (err) {
        toast(err.conflit ? tr("Quelqu'un a traité cette demande pendant ce temps : le dossier {ref} est peut-être en double, vérifiez-le.", { ref: dossier.ref }) : tr("Dossier créé, mais la demande n'a pas pu être marquée confirmée : {erreur}", { erreur: err.message }), true);
      }
      rafraichir();
      ouvrirReponse(d, reponseConfirmation(d, final, { aujourdhui: aujourdhui() }), { titre: tr("Réponse de confirmation"), dossierId: dossier.id });
    },
  });
}

// « Modifier » : date, heure, option ou prix, puis la création comme pour « Confirmer ». La réponse dira ce qui a changé.
function ouvrirModifier(d) {
  if (dejaTraitee(d)) return void (toast(tr("Cette demande a déjà été traitée."), true), rafraichir());
  const date = h("input", { type: "date", value: d.date_service || "", min: aujourdhui() });
  const heure = h("input", { type: "time", value: d.heure || "" });
  // Les options de la page produit, plus celle de la demande si son nom a changé depuis sur le site.
  const options = [...optionsProduit(d.produit_id)];
  if (titreOption(d) && !options.some((o) => o.titre === titreOption(d))) options.unshift({ id: d.option_id || "", titre: titreOption(d) });
  const option = options.length ? h("select", null, options.map((o) => h("option", { value: o.titre }, o.titre))) : h("input", { type: "text", value: titreOption(d), lang: "en" });
  option.value = titreOption(d) || (options[0] || {}).titre || "";
  const devise = (etat.db.reglages && etat.db.reglages.devise) || d.devise || "THB";
  const prix = h("input", { type: "number", inputmode: "numeric", min: "0", step: "1", placeholder: d.total_estime ? String(d.total_estime) : "" });
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  let fermer;
  const continuer = () => {
    const modifs = {};
    if (date.value && date.value !== d.date_service) modifs.date = date.value;
    if (heure.value && heure.value !== (d.heure || "")) modifs.heure = heure.value;
    if (option.value.trim() && option.value.trim() !== titreOption(d)) modifs.option_titre = option.value.trim();
    if (prix.value !== "") {
      const n = Number(prix.value);
      if (!(n >= 0)) return (erreur.textContent = tr("Indiquez un prix positif."));
      if (n !== Number(d.total_estime)) modifs.prix = n;
    }
    if (!Object.keys(modifs).length) return (erreur.textContent = tr("Rien n'a changé : utilisez « Confirmer »."));
    fermer();
    confirmer_(d, modifs);
  };
  fermer = modal(
    tr("Modifier {ref}", { ref: d.ref || nomProduit(d) }),
    h(
      "div",
      { class: "modal-corps dsite-modifier" },
      h("p", { class: "aide" }, tr("Changez ce qui ne va pas, puis créez la réservation. La réponse au client dira ce qui a changé.")),
      h("div", { class: "grille-form compacte" }, champ(tr("Date"), date), champ(tr("Heure de pickup"), heure)),
      champ(tr("Option"), option, options.length ? null : tr("Nom de l'option en anglais, tel qu'il apparaîtra dans la réponse.")),
      champ(tr("Prix total ({devise})", { devise }), prix, d.total_estime ? tr("Prix indiqué sur le site : {prix}. Laissez vide pour garder le prix de la base.", { prix: formatMontant(d.total_estime, d.devise || "THB") }) : tr("Laissez vide pour garder le prix de la base.")),
      erreur,
      h("div", { class: "barre-modal" }, h("button", { class: "principal", type: "button", onclick: continuer }, tr("Continuer vers la réservation")))
    ),
    { protege: false }
  );
}

// « Refuser ou proposer autre chose » : un motif, une autre date ou une autre sortie, et la réponse se rédige à mesure.
function ouvrirRefus(d) {
  if (dejaTraitee(d)) return void (toast(tr("Cette demande a déjà été traitée."), true), rafraichir());
  const etatRefus = { motif: "complet", alternative: {} };
  const apercu = h("textarea", { id: "dsite-refus", rows: 9, lang: "en" });
  const majApercu = () => (apercu.value = reponseRefus(d, etatRefus, { aujourdhui: aujourdhui() }));
  const motifs = puces({ libelle: tr("Motif"), valeur: etatRefus.motif, options: Object.entries(MOTIFS_REFUS).map(([valeur, l]) => ({ valeur, libelle: tr(l) })), onchange: (v) => ((etatRefus.motif = v), majApercu()) });
  const autreDate = h("input", { type: "date", min: aujourdhui(), onchange: (e) => ((etatRefus.alternative.date = e.target.value || undefined), majApercu()) });
  const marque = d.marque === "taxi" ? "taxi" : "secret";
  const autres = PRODUITS_SITE.filter((p) => p.marque === marque && p.id !== d.produit_id);
  const autreSortie = h("select", { onchange: (e) => ((etatRefus.alternative.produit_id = e.target.value || undefined), majApercu()) }, h("option", { value: "" }, tr("Aucune")), autres.map((p) => h("option", { value: p.id }, p.nom)));
  majApercu();
  let fermer;
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  let copieRatee = false;
  const marquer = async (copiee) => {
    try {
      await modifier("demandes_site", d.id, { statut: "refusee", decision: { motif: etatRefus.motif, alternative: etatRefus.alternative } }, { verrou: true, version: d.updated_at });
    } catch (err) {
      fermer();
      toast(err.conflit ? tr("Quelqu'un a traité cette demande pendant ce temps.") : err.message, true);
      return rafraichir();
    }
    fermer();
    toast(copiee ? tr("Demande refusée : la réponse est copiée.") : tr("Demande refusée. La réponse reste dans « Revoir la réponse »."));
    rafraichir();
  };
  // Copie refusée par le navigateur : le texte est sélectionné pour une copie à la main, la demande n'est marquée qu'au second appui.
  const copierPuisMarquer = async (btn) => {
    if (copieRatee) return marquer(false);
    try {
      await navigator.clipboard.writeText(apercu.value);
      await marquer(true);
    } catch {
      copieRatee = true;
      apercu.focus();
      apercu.select();
      erreur.textContent = tr("Copie impossible dans ce navigateur : le texte est sélectionné, copiez-le à la main puis touchez le bouton pour marquer la demande refusée.");
      btn.replaceChildren(tr("Marquer refusée"));
    }
  };
  fermer = modal(
    tr("Refuser ou proposer autre chose"),
    h(
      "div",
      { class: "modal-corps dsite-refus" },
      blocReference(d),
      h("fieldset", { class: "dsite-groupe" }, h("legend", null, tr("Motif")), motifs.noeud),
      h("div", { class: "grille-form compacte" }, champ(tr("Proposer une autre date"), autreDate), champ(d.marque === "taxi" ? tr("Proposer un autre trajet") : tr("Proposer une autre sortie"), autreSortie)),
      champ(tr("Réponse en anglais"), apercu),
      erreur,
      h("div", { class: "barre-modal" }, h("button", { class: "principal", type: "button", onclick: (e) => copierPuisMarquer(e.currentTarget) }, icone("copier", 18), tr("Copier et marquer refusée")))
    ),
    { protege: false }
  );
}

async function classer(d) {
  if (!(await confirmer(tr("Classer cette demande sans réponse ? Elle sort de la liste et des chiffres (essai, doublon, message déjà traité ailleurs)."), tr("Classer")))) return;
  await modifier("demandes_site", d.id, { statut: "classee" });
  rafraichir();
}

// Réponse déjà envoyée : on la retrouve, avec la décision gardée.
function revoirReponse(d) {
  const dec = d.decision || {};
  if (d.statut === "confirmee" && dec.final) return ouvrirReponse(d, reponseConfirmation(d, dec.final, { aujourdhui: aujourdhui() }), { titre: tr("Réponse de confirmation"), dossierId: d.dossier_id });
  if (d.statut === "refusee") return ouvrirReponse(d, reponseRefus(d, { motif: dec.motif || "autre", alternative: dec.alternative || {} }, { aujourdhui: aujourdhui() }), { titre: tr("Réponse de refus") });
  return null;
}

// ---- Carte ---------------------------------------------------------------------------------------------------------------
function carte(d) {
  const ecrit = peut("dossiers.ecrire");
  const option = titreOption(d);
  const dossier = d.dossier_id ? etat.db.dossiers.find((x) => x.id === d.dossier_id) : null;
  const quand = [jourCourt(d.date_service), d.heure].filter(Boolean).join(" · ");
  const changes = (d.decision && d.decision.changements) || [];
  return h(
    "li",
    { class: `dsite-carte s-${d.statut}`, "data-id": d.id },
    h("div", { class: "dsite-tete" }, blocReference(d), h("span", { class: "dsite-recue" }, recue(d.created_at))),
    h("h3", { class: "dsite-produit" }, nomProduit(d), option ? h("span", null, option) : null),
    h("p", { class: "dsite-quand" }, [quand || tr("Date à préciser"), personnes(d)].filter(Boolean).join(" · ")),
    h("p", { class: "dsite-client" }, [d.nom, d.pickup].filter(Boolean).join(" · ") || tr("Nom non donné")),
    d.total_estime ? h("p", { class: "dsite-detail" }, tr("Prix indiqué sur le site : {prix}", { prix: formatMontant(d.total_estime, d.devise || "THB") })) : null,
    d.page_url ? h("p", { class: "dsite-detail" }, tr("Page : {page}", { page: cheminPage(d.page_url) })) : null,
    d.statut !== "nouvelle"
      ? h(
          "p",
          { class: "dsite-etat" },
          h("span", { class: `tag dsite-statut s-${d.statut}` }, tr(STATUTS_DEMANDE[d.statut])),
          dossier ? h("a", { href: `#/dossier/${dossier.id}` }, tr("Dossier {ref}", { ref: dossier.ref })) : null,
          changes.length ? h("span", { class: "dsite-detail" }, pluriel(changes.length, N_("changement"), N_("changements"))) : null
        )
      : null,
    d.statut === "nouvelle" && ecrit
      ? h(
          "div",
          { class: "dsite-actions" },
          h("button", { class: "principal", type: "button", onclick: () => confirmer_(d) }, tr("Confirmer")),
          h("button", { class: "secondaire", type: "button", onclick: () => ouvrirModifier(d) }, tr("Modifier")),
          h("button", { class: "secondaire", type: "button", onclick: () => ouvrirRefus(d) }, tr("Refuser")),
          h("button", { class: "lien", type: "button", onclick: () => classer(d) }, tr("Classer"))
        )
      : d.statut === "confirmee" || d.statut === "refusee"
        ? h("div", { class: "dsite-actions" }, h("button", { class: "secondaire petit", type: "button", onclick: () => revoirReponse(d) }, icone("copier", 16), tr("Revoir la réponse")))
        : null
  );
}

// ---- Chiffres -------------------------------------------------------------------------------------------------------------
function blocChiffres(demandes) {
  const depuis = periode === "tout" ? "" : new Date(Date.now() - Number(periode) * 86400000).toISOString().slice(0, 10);
  const c = chiffresDemandes(demandes, { depuis });
  const tuile = (valeur, libelle) => h("div", { class: "chiffre" }, h("p", { class: "chiffre-libelle" }, libelle), h("p", { class: "chiffre-valeur" }, valeur));
  const tableau = (titre, lignes, nomCol) =>
    h(
      "section",
      { class: "dsite-tableau" },
      h("h2", null, titre),
      lignes.length
        ? h(
            "table",
            { class: "tableau simple" },
            h("thead", null, h("tr", null, [nomCol, tr("Reçues"), tr("Confirmées"), tr("Refusées")].map((t, i) => h("th", { scope: "col", class: i ? "num" : "" }, t)))),
            h("tbody", null, lignes.map((l) => h("tr", null, h("td", null, l.nom), h("td", { class: "num" }, l.recues), h("td", { class: "num" }, l.confirmees), h("td", { class: "num" }, l.refusees))))
          )
        : h("p", { class: "vide-court" }, tr("Aucune demande sur cette période."))
    );
  const choixPeriode = puces({ libelle: tr("Période"), valeur: periode, options: [{ valeur: "30", libelle: tr("30 jours") }, { valeur: "90", libelle: tr("90 jours") }, { valeur: "tout", libelle: tr("Depuis le début") }], onchange: (v) => ((periode = v), rafraichir()) });
  return h(
    "div",
    { class: "dsite-chiffres" },
    choixPeriode.noeud,
    h("div", { class: "chiffres compacts" }, tuile(c.recues, tr("Reçues")), tuile(c.confirmees, tr("Confirmées")), tuile(c.refusees, tr("Refusées")), tuile(c.taux === null ? "-" : `${c.taux} %`, tr("Taux de confirmation"))),
    h("p", { class: "aide" }, tr("Le taux compte les demandes confirmées parmi celles qui ont reçu une réponse. Les demandes classées ne comptent pas.")),
    tableau(modeTaxi() ? tr("Par trajet") : tr("Par sortie"), c.parProduit, modeTaxi() ? tr("Trajet") : tr("Sortie")),
    tableau(tr("Par page d'origine"), c.parPage, tr("Page"))
  );
}

// ---- Écran ------------------------------------------------------------------------------------------------------------------
export async function vueDemandesSite() {
  // Une notification ouvre l'écran dans l'entreprise de la demande (« ?entite=… ») : on y passe si on y a accès.
  const cible = new URLSearchParams((location.hash.split("?")[1] || "")).get("entite");
  if (cible && cible !== etat.entiteId && entitesAccessibles().some((e) => e.id === cible)) {
    changerEntite(cible);
    setTimeout(() => (location.hash = "#/demandes"), 0);
  }
  const demandes = etat.db.demandes_site || [];
  const nouvelles = aTraiter(demandes);
  const liste = trierDemandes(onglet === "a_traiter" ? nouvelles : onglet === "traitees" ? demandes.filter((d) => d.statut !== "nouvelle" && d.statut !== "classee") : demandes);
  const choix = puces({
    libelle: tr("Afficher"),
    valeur: onglet,
    options: [{ valeur: "a_traiter", libelle: tr("À traiter"), nombre: nouvelles.length }, { valeur: "traitees", libelle: tr("Traitées") }, { valeur: "toutes", libelle: tr("Toutes") }, { valeur: "chiffres", libelle: tr("Chiffres") }],
    onchange: (v) => ((onglet = v), rafraichir()),
  });
  const simuler =
    etat.store.mode === "demo" && etat.store.simulerDemandeSite
      ? h("button", { class: "secondaire petit", type: "button", onclick: async () => {
          await etat.store.simulerDemandeSite(etat.entiteId);
          await recharger();
          onglet = "a_traiter";
          rafraichir();
          toast(tr("Nouvelle demande du site (démonstration)."));
        } }, tr("Simuler une demande"))
      : null;
  return h(
    "div",
    { "data-titre": tr("Demandes du site"), class: "dsite" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Demandes du site")), h("p", { class: "sous" }, modeTaxi() ? tr("Demandes de transfert envoyées depuis la page VIP Taxi Lanta du site.") : tr("Demandes envoyées depuis secrettravelandtour.com. Le client a aussi écrit sur WhatsApp."))), simuler ? h("div", { class: "entete-actions" }, simuler) : null),
    etat.brut.site_disponible === false ? h("p", { class: "bandeau-info", role: "status" }, tr("La base n'a pas encore les demandes du site (migration 30 à appliquer).")) : null,
    choix.noeud,
    onglet === "chiffres"
      ? blocChiffres(demandes)
      : liste.length
        ? h("ul", { class: "dsite-liste" }, liste.map(carte))
        : vide(onglet === "a_traiter" ? tr("Aucune demande à traiter") : tr("Aucune demande"), onglet === "a_traiter" ? tr("Les demandes envoyées depuis le site arrivent ici, avec une notification sur le téléphone si la cloche est activée.") : tr("Les demandes traitées apparaîtront ici."))
  );
}

// Section de l'accueil « Aujourd'hui » : le nombre de demandes à traiter et la plus récente.
export function sectionDemandesAccueil() {
  if (!demandesVisibles()) return null;
  const nouvelles = trierDemandes(aTraiter(etat.db.demandes_site || []));
  if (!nouvelles.length) return null;
  const d = nouvelles[0];
  return h(
    "section",
    { class: "section-jour dsite-accueil" },
    h("h2", null, tr("Demandes du site"), h("span", { class: "tag badge-tag" }, nouvelles.length)),
    h(
      "a",
      { class: "dsite-accueil-lien", href: "#/demandes" },
      h("span", null, h("strong", null, d.ref || nomProduit(d)), " ", [nomProduit(d), jourCourt(d.date_service), personnes(d)].filter(Boolean).join(" · ")),
      h("span", { class: "dsite-accueil-plus" }, nouvelles.length > 1 ? tr("Voir les {n} demandes", { n: nouvelles.length }) : tr("Traiter la demande"), icone("chevron", 16))
    )
  );
}

