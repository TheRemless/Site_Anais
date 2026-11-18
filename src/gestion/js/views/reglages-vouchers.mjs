// Réglages > Vouchers (Secret) ou Booking confirmation (Taxi) : un onglet à part (lot B du 17.11.2026), pour que les autres réglages évoluent
// sans toucher aux vouchers. On y trouve l'en-tête et les textes de fin d'avant, les intitulés imprimés (une clé par ligne, le texte d'aujourd'hui
// en défaut), et pour Taxi la photo du bandeau, le chauffeur des courses et la fenêtre des commissions à demander.
import { h, champ } from "../ui.mjs";
import { etat } from "../etat.mjs";
import { tr, N_, langueActive } from "../i18n.mjs";
import { libelleLicence, responsableDe, voyelle } from "../noms-calc.mjs";
import { GROUPES_VOUCHER, GROUPES_BOOKING, GROUPES_BOOKING_SECRET, textesAEnregistrer, textesVoucher } from "../textes-voucher.mjs";

// Secret (18.11.2026) : sa Booking confirmation des transferts payés au chauffeur reprend le titre et les rubriques de celle de Taxi (sans
// « (all fees included) », que son modèle n'imprime pas) et a ses propres textes.
const groupesBookingSecret = () => [
  { titre: N_("Booking confirmation : titre et rubriques"), cles: GROUPES_BOOKING[0].cles.filter(([k]) => k !== "b_tous_frais") },
  ...GROUPES_BOOKING_SECRET,
];
import { chauffeurAChoisir, partenaireDeTaxi } from "../voucher-rapide-calc.mjs";

// Le champ du WhatsApp qui reçoit les vouchers de l'assistante (clé historique `voucher.whatsapp_anais`), au nom de la personne responsable.
function whatsappResponsable(texte, prenom) {
  const nom = prenom || tr("la personne responsable");
  const libelle = voyelle(nom) ? tr("WhatsApp d'{responsable} (reçoit les vouchers de l'assistante)", { responsable: nom }) : tr("WhatsApp de {responsable} (reçoit les vouchers de l'assistante)", { responsable: nom });
  return texte(libelle, "voucher.whatsapp_anais", { type: "tel", placeholder: "+66 …", aide: tr("Avec l'indicatif. Sur ordinateur, l'image est copiée et cette conversation s'ouvre ; sur téléphone, un bouton ouvre la conversation après l'envoi de l'image. Vide : l'assistante choisit {responsable} dans WhatsApp.", { responsable: nom }) });
}

// « Numéro de licence TAT » : le libellé de licence de l'entreprise (migration 44), « Numéro de licence » sans libellé.
export function numeroLicenceDe(r) {
  const en = langueActive() === "en";
  const l = libelleLicence((r && r.emetteur) || {}, en);
  return tr("Numéro de {licence}", { licence: en ? l : l.charAt(0).toLowerCase() + l.slice(1) });
}
// Le prénom de la personne responsable dans un libellé : « WhatsApp d'Anaïs », « WhatsApp de Mook ».
const responsableReglages = (r) => responsableDe(r, { profils: etat.brut.profils || [], membres: etat.brut.membres || [], roles: etat.brut.roles || [], entiteId: etat.entiteId }).prenom;

// `r` : les réglages en cours de modification. `texte`, `image` : les champs liés à un chemin des réglages (reglages.mjs).
// `marque()` : signale une modification. `choixApercuVoucher` : le menu du modèle montré dans l'aperçu.
export function sectionVouchers({ r, taxi, texte, image, marque, choixApercuVoucher }) {
  r.voucher = r.voucher || {};
  r.voucher.textes = r.voucher.textes || {};

  // Une clé par ligne : l'intitulé d'aujourd'hui sert d'étiquette et de texte grisé ; un champ vide garde ce texte.
  const ligneTexte = ([cle, defaut]) => {
    const id = `vt-${cle}`;
    const el = h("input", { id, placeholder: defaut, autocomplete: "off" });
    el.value = r.voucher.textes[cle] || "";
    // Seul ce qui diffère du texte d'origine se garde : un texte identique continue de suivre le défaut.
    el.addEventListener("input", () => {
      r.voucher.textes = textesAEnregistrer({ ...r.voucher.textes, [cle]: el.value });
      marque();
    });
    return h("div", { class: "champ" }, h("label", { for: id }, defaut), el);
  };
  const blocTextes = (groupes) =>
    h(
      "fieldset",
      null,
      h("legend", null, taxi ? tr("Textes de la Booking confirmation") : tr("Textes du voucher")),
      h("p", { class: "aide" }, tr("Chaque ligne montre le texte imprimé aujourd'hui. Tapez le vôtre pour le remplacer ; un champ vide reprend le texte d'origine. Les vouchers sont en anglais.")),
      groupes.map((g) => h("details", { class: "aide-repli" }, h("summary", null, tr(g.titre)), h("div", { class: "grille-form" }, g.cles.map(ligneTexte))))
    );

  const entete = h(
    "fieldset",
    null,
    h("legend", null, taxi ? tr("Booking confirmation") : tr("Vouchers")),
    h("p", { class: "aide" }, tr("Les vouchers sont en anglais. Un champ vide reprend la valeur de l'onglet Entreprise (nom, sous-titre, adresse, téléphone) ; le logo est celui de l'onglet Apparence. L'aperçu à droite suit vos modifications.")),
    h("div", { class: "grille-form" }, texte(N_("Nom affiché"), "voucher.nom", { placeholder: r.emetteur.nom }), texte(N_("Sous-titre"), "voucher.sous_titre", { placeholder: r.emetteur.sous_titre || "" }), taxi ? null : texte(numeroLicenceDe(r), "voucher.licence", { aide: tr("Son intitulé (« {intitule} ») se change dans « Textes du voucher ».", { intitule: textesVoucher(r)("licence") }) }), texte(N_("WhatsApp affiché"), "voucher.whatsapp", { placeholder: r.emetteur.telephone }), texte(N_("E-mail affiché"), "voucher.email", { type: "email" })),
    texte(N_("Adresse sur une ligne"), "voucher.adresse", { placeholder: (r.emetteur.adresse || "").split("\n").join(", ") }),
    // Taxi : l'assistante envoie les vouchers de l'écran « Nouveau voucher » à Anaïs, qui les transmet au client.
    taxi ? whatsappResponsable(texte, responsableReglages(r)) : null,
    // La Booking confirmation de Taxi a un seul modèle : ni choix de modèle, ni textes de fin (ses textes sont dans le bloc des textes).
    taxi ? null : champ(tr("Modèle de l'aperçu"), choixApercuVoucher),
    taxi ? null : texte(N_("Texte de fin"), "voucher.merci", { multi: true, rows: 2, aide: tr("{entreprise} est remplacé par le nom affiché.") }),
    taxi ? null : texte(N_("Texte de fin des vouchers de transfert"), "voucher.merci_transfert", { multi: true, rows: 2 }),
    taxi ? null : texte(N_("Note des vouchers de transfert"), "voucher.note_transfert", { multi: true, rows: 2 }),
    taxi ? image(N_("Photo du bandeau"), "voucher.bandeau", { maxPx: 1400, aide: tr("En haut de la Booking confirmation. Sans photo, celle du modèle par défaut.") }) : null
  );

  return h("div", null, entete, taxi ? blocCourses({ r, marque }) : null, blocTextes(taxi ? GROUPES_BOOKING : [...GROUPES_VOUCHER, ...groupesBookingSecret()]));
}

// Taxi : à qui vont les courses saisies (et leur commission), et jusqu'où remontent les commissions à demander.
function blocCourses({ r, marque }) {
  r.taxi = r.taxi || {};
  const actifs = etat.db.partenaires.filter((p) => p.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom));
  const deduit = partenaireDeTaxi(etat.db.partenaires, null);
  const alerte = h("p", { class: "ecart-facture", role: "status" });
  const chauffeur = h("select", { id: "taxi-chauffeur" }, h("option", { value: "" }, deduit ? tr("Automatique : {nom}", { nom: deduit.nom }) : tr("Automatique")), actifs.map((p) => h("option", { value: p.id }, p.nom)));
  chauffeur.value = actifs.some((p) => p.id === r.taxi.chauffeur_id) ? r.taxi.chauffeur_id : "";
  const majAlerte = () => {
    alerte.textContent = chauffeurAChoisir(etat.db.partenaires, chauffeur.value || null) ? tr("Plusieurs partenaires actifs : choisissez le chauffeur, sinon les courses vont à « {nom} », deviné d'après son nom.", { nom: deduit ? deduit.nom : "" }) : "";
    alerte.hidden = !alerte.textContent;
  };
  chauffeur.addEventListener("change", () => {
    if (chauffeur.value) r.taxi.chauffeur_id = chauffeur.value;
    else delete r.taxi.chauffeur_id;
    majAlerte();
    marque();
  });
  majAlerte();
  const jours = h("input", { id: "taxi-jours-commission", inputmode: "numeric", autocomplete: "off", placeholder: tr("Toutes"), value: r.taxi.jours_commission ? String(r.taxi.jours_commission) : "" });
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  jours.addEventListener("input", () => {
    const t = jours.value.trim();
    const n = Number(t);
    erreur.textContent = t && !(Number.isInteger(n) && n > 0) ? tr("Un nombre de jours entier, ou vide pour toutes. Tant que ce n'est pas corrigé, la valeur d'avant reste enregistrée.") : "";
    if (!t) delete r.taxi.jours_commission;
    else if (Number.isInteger(n) && n > 0) r.taxi.jours_commission = n;
    marque();
  });
  return h(
    "fieldset",
    null,
    h("legend", null, tr("Courses et commissions")),
    champ(tr("Chauffeur des courses"), chauffeur, tr("Le partenaire qui reçoit les courses saisies par l'assistante, les courses hors catalogue et les demandes collées. Sa commission est demandée chaque jour.")),
    alerte,
    champ(tr("Commissions à demander : jusqu'à combien de jours en arrière"), jours, tr("Vide : toutes les courses passées sans commission saisie restent dans la liste, même anciennes.")),
    erreur
  );
}
