// Messages types : la fenêtre « Copier un message » (depuis une réservation ou un dossier) et l'écran qui les gère.
import { reglages, estAdmin, enregistrerReglages } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, icone } from "../ui.mjs";
import { uid, MESSAGES_DEFAUT } from "../defauts.mjs";
import { remplirGabarit, destinataireMessage } from "../operations-calc.mjs";
import { chiffres } from "./partenaires.mjs";
import { tr, N_ } from "../i18n.mjs";

export const LANGUES = [
  ["fr", "Français"],
  ["en", "English"],
  ["th", "ไทย"],
];
export const messagesTypes = () => (reglages().messages || []).filter((m) => m && m.corps);
export const DESTINATAIRES = [
  ["client", N_("Au client")],
  ["partenaire", N_("Au partenaire")],
];
// Noms lisibles des variables, pour dire ce qui manque.
const NOMS_VARIABLES = { client: N_("nom du client"), prenom: N_("prénom"), date: N_("date"), hotel: N_("hôtel"), heure: N_("heure de pickup"), personnes: N_("personnes"), prestation: N_("service"), partenaire: N_("partenaire"), reference: N_("référence"), entreprise: N_("entreprise") };
const nomLangue = (code) => (LANGUES.find(([c]) => c === code) || [code, code])[1];

async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    toast(tr("Message copié."));
  } catch {
    toast(tr("Copie impossible dans ce navigateur : sélectionnez le texte à la main."), true);
  }
}

// `vars` : valeurs des variables ; `cle` : gabarit proposé d'abord ; `telephone` : destinataire WhatsApp ;
// `pour` : « client » ou « partenaire », seuls les messages de ce destinataire sont proposés.
// `surEnvoi` : appelée quand le message part (WhatsApp ouvert) ou est copié, par exemple pour passer une réservation à « Demandée ».
export function ouvrirMessage({ titre = tr("Copier un message"), vars = {}, cle = "", langue = "fr", telephone = "", pour = "client", surEnvoi = null }) {
  const tous = messagesTypes().filter((m) => destinataireMessage(m) === pour);
  if (!tous.length) return toast(pour === "partenaire" ? tr("Aucun message type pour les partenaires. Créez-en dans l'écran Messages.") : tr("Aucun message type pour les clients. Créez-en dans l'écran Messages."), true);
  const texte = h("textarea", { id: "msg-texte", rows: 11 });
  const selLangue = h("select", { id: "msg-langue", onchange: () => remplirGabarits() }, LANGUES.filter(([c]) => tous.some((m) => m.langue === c)).map(([c, l]) => h("option", { value: c }, l)));
  selLangue.value = tous.some((m) => m.langue === langue) ? langue : selLangue.firstChild.value;
  const selGabarit = h("select", { id: "msg-gabarit", onchange: () => remplir() });
  function remplirGabarits() {
    selGabarit.replaceChildren(...tous.filter((m) => m.langue === selLangue.value).map((m) => h("option", { value: m.id }, m.titre)));
    const prefere = tous.find((m) => m.langue === selLangue.value && m.cle === cle);
    if (prefere) selGabarit.value = prefere.id;
    remplir();
  }
  // Ce que le gabarit réclame et que la réservation ne donne pas (heure, hôtel…) : dit avant l'envoi plutôt que découvert par le client.
  const manque = h("p", { class: "bandeau-info", role: "status", hidden: true });
  function remplir() {
    const m = tous.find((x) => x.id === selGabarit.value);
    texte.value = m ? remplirGabarit(m.corps, vars) : "";
    const vides = m ? [...new Set([...m.corps.matchAll(/\{(\w+)\}/g)].map((x) => x[1]))].filter((k) => k in vars && !String(vars[k] ?? "").trim() && !["a_heure", "telephone"].includes(k)) : [];
    manque.hidden = !vides.length;
    manque.textContent = vides.length ? tr("À compléter dans le texte : {liste}.", { liste: vides.map((k) => NOMS_VARIABLES[k] ? tr(NOMS_VARIABLES[k]) : k).join(", ") }) : "";
  }
  remplirGabarits();
  const numero = chiffres(telephone);
  const fermer = modal(
    titre,
    h(
      "div",
      { class: "modal-corps message-apercu" },
      h("div", { class: "grille-form" }, champ(tr("Langue"), selLangue), champ(tr("Message type"), selGabarit)),
      manque,
      champ(tr("Texte, modifiable avant l'envoi"), texte),
      h(
        "div",
        { class: "actions" },
        numero ? h("a", { class: "bouton principal", href: "#", onclick: (e) => { e.preventDefault(); window.open(`https://wa.me/${numero.replace("+", "")}?text=${encodeURIComponent(texte.value)}`, "_blank", "noopener"); if (surEnvoi) surEnvoi(); } }, icone("whatsapp"), tr("Ouvrir dans WhatsApp")) : null,
        h("button", { class: numero ? "secondaire" : "principal", type: "button", onclick: () => (copier(texte.value), surEnvoi && surEnvoi()) }, icone("copier"), tr("Copier"))
      ),
      h("p", { class: "aide" }, tr("Les variables entre accolades sont remplies d'après la réservation ou le dossier. Les textes thaïs sont des propositions à faire relire avant usage."))
    )
  );
  return fermer;
}

// ---- Écran de gestion des messages types -----------------------------------------------------------------
function formulaireMessage(m, apres) {
  const titre = h("input", { id: "m-titre", value: m.titre || "", required: true });
  const pour = h("select", { id: "m-pour" }, DESTINATAIRES.map(([c, l]) => h("option", { value: c }, tr(l))));
  pour.value = destinataireMessage(m);
  const cle = h("input", { id: "m-cle", value: m.cle || "", list: "m-cles", placeholder: tr("confirmation, rappel, avis, meteo, partenaire, relance, modification, annulation") });
  const cles = h("datalist", { id: "m-cles" }, [...new Set(messagesTypes().map((x) => x.cle).filter(Boolean))].map((c) => h("option", { value: c })));
  const langue = h("select", { id: "m-langue" }, LANGUES.map(([c, l]) => h("option", { value: c }, l)));
  langue.value = m.langue || "fr";
  const corps = h("textarea", { id: "m-corps", rows: 10, required: true });
  corps.value = m.corps || "";
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        const liste = messagesTypes().map((x) => ({ ...x }));
        const valeurs = { id: m.id || uid(), pour: pour.value, titre: titre.value.trim(), cle: cle.value.trim(), langue: langue.value, corps: corps.value.trim() };
        const i = liste.findIndex((x) => x.id === valeurs.id);
        if (i >= 0) liste[i] = valeurs;
        else liste.push(valeurs);
        try {
          await enregistrerReglages({ ...reglages(), messages: liste });
          toast(tr("Message enregistré."));
          apres();
        } catch (err) {
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    h("div", { class: "grille-form" }, champ(tr("Destinataire"), pour, tr("Proposé depuis le bouton Client ou le bouton Partenaire d'une réservation.")), champ(tr("Titre"), titre), champ(tr("Usage"), [cle, cles], tr("Le même usage dans plusieurs langues : le bon est proposé selon la langue.")), champ(tr("Langue"), langue)),
    champ(tr("Texte"), corps, tr("Variables : {client} {prenom} {date} {hotel} {heure} {a_heure} {personnes} {prestation} {partenaire} {reference} {entreprise} {telephone}")),
    h("div", { class: "actions" }, m.id ? h("button", { class: "danger", type: "button", onclick: async () => { if (await confirmer(tr("Supprimer « {titre} » ?", { titre: m.titre }), tr("Supprimer"), true)) { await enregistrerReglages({ ...reglages(), messages: messagesTypes().filter((x) => x.id !== m.id) }); apres(); } } }, tr("Supprimer")) : null, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
  );
}

export function vueMessages() {
  const admin = estAdmin();
  const rafraichir = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
  const ouvrir = (m) => { const fermer = modal(m.id ? tr("Modifier le message") : tr("Nouveau message type"), formulaireMessage(m, () => (fermer(), rafraichir())), { large: true }); };
  const tous = messagesTypes();
  return h(
    "div",
    { "data-titre": tr("Messages") },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Messages types")), h("p", { class: "sous" }, tr("Au client : confirmation, rappel de la veille, avis, météo. Au partenaire : demande, relance, modification, annulation. À copier depuis une réservation."))), admin ? h("div", { class: "entete-actions" }, h("button", { class: "secondaire", type: "button", onclick: async () => { if (await confirmer(tr("Remettre les messages de départ ? Vos modifications seront perdues."), tr("Remettre"))) { await enregistrerReglages({ ...reglages(), messages: structuredClone(MESSAGES_DEFAUT) }); rafraichir(); } } }, tr("Remettre ceux de départ")), h("button", { class: "principal", type: "button", onclick: () => ouvrir({}) }, tr("Nouveau message"))) : null),
    DESTINATAIRES.flatMap(([pour, nomPour]) => LANGUES.map(([code, nom]) => {
      const du = tous.filter((m) => destinataireMessage(m) === pour && m.langue === code);
      if (!du.length) return null;
      return h(
        "section",
        null,
        h("h2", null, tr("{pour}, {langue}", { pour: tr(nomPour), langue: { fr: tr("en français"), en: tr("en anglais"), th: tr("en thaï") }[code] || nom })),
        code === "th" ? h("p", { class: "aide" }, tr("Propositions à faire relire par une personne qui lit le thaï avant usage réel.")) : null,
        h("ul", { class: "cartes" }, du.map((m) => h("li", { class: "carte" }, h("div", { class: "carte-lien statique" }, h("span", { class: "carte-titre" }, m.titre, h("span", { class: "tag" }, m.cle)), h("pre", { class: "message-texte" }, m.corps), h("span", { class: "carte-pied" }, h("span"), h("span", { class: "carte-actions" }, h("button", { class: "secondaire petit", type: "button", onclick: () => copier(m.corps) }, tr("Copier")), admin ? h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrir(m) }, tr("Modifier")) : null))))))
      );
    })),
    !tous.length ? h("p", { class: "vide-court" }, tr("Aucun message type.")) : null,
    h("p", { class: "aide" }, `${tous.length > 1 ? tr("Langues :") : tr("Langue :")} ${[...new Set(tous.map((m) => nomLangue(m.langue)))].join(", ")}. ${admin ? "" : tr("Seuls les administrateurs modifient les messages.")}`)
  );
}
