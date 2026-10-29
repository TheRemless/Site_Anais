// Messages types : la fenêtre « Copier un message » (depuis une réservation ou un dossier) et l'écran qui les gère.
import { reglages, estAdmin, enregistrerReglages } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, icone } from "../ui.mjs";
import { uid, MESSAGES_DEFAUT } from "../defauts.mjs";
import { remplirGabarit } from "../operations-calc.mjs";
import { chiffres } from "./partenaires.mjs";
import { tr } from "../i18n.mjs";

export const LANGUES = [
  ["fr", "Français"],
  ["en", "English"],
  ["th", "ไทย"],
];
export const messagesTypes = () => (reglages().messages || []).filter((m) => m && m.corps);
const nomLangue = (code) => (LANGUES.find(([c]) => c === code) || [code, code])[1];

async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    toast(tr("Message copié."));
  } catch {
    toast(tr("Copie impossible dans ce navigateur : sélectionnez le texte à la main."), true);
  }
}

// `vars` : valeurs des variables ; `cle` : gabarit proposé d'abord ; `telephone` : destinataire WhatsApp.
export function ouvrirMessage({ titre = tr("Copier un message"), vars = {}, cle = "", langue = "fr", telephone = "" }) {
  const tous = messagesTypes();
  if (!tous.length) return toast(tr("Aucun message type. Créez-en dans l'écran Messages."), true);
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
  function remplir() {
    const m = tous.find((x) => x.id === selGabarit.value);
    texte.value = m ? remplirGabarit(m.corps, vars) : "";
  }
  remplirGabarits();
  const numero = chiffres(telephone);
  const fermer = modal(
    titre,
    h(
      "div",
      { class: "modal-corps message-apercu" },
      h("div", { class: "grille-form" }, champ(tr("Langue"), selLangue), champ(tr("Message type"), selGabarit)),
      champ(tr("Texte, modifiable avant la copie"), texte),
      h(
        "div",
        { class: "actions" },
        numero ? h("a", { class: "bouton secondaire", href: "#", onclick: (e) => { e.preventDefault(); window.open(`https://wa.me/${numero.replace("+", "")}?text=${encodeURIComponent(texte.value)}`, "_blank", "noopener"); } }, icone("whatsapp"), tr("Ouvrir dans WhatsApp")) : null,
        h("button", { class: "principal", type: "button", onclick: () => copier(texte.value) }, icone("copier"), tr("Copier"))
      ),
      h("p", { class: "aide" }, tr("Les variables entre accolades sont remplies d'après la réservation ou le dossier. Les textes thaïs sont des propositions à faire relire avant usage."))
    )
  );
  return fermer;
}

// ---- Écran de gestion des messages types -----------------------------------------------------------------
function formulaireMessage(m, apres) {
  const titre = h("input", { id: "m-titre", value: m.titre || "", required: true });
  const cle = h("input", { id: "m-cle", value: m.cle || "", list: "m-cles", placeholder: tr("confirmation, rappel, avis, meteo, partenaire") });
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
        const valeurs = { id: m.id || uid(), titre: titre.value.trim(), cle: cle.value.trim(), langue: langue.value, corps: corps.value.trim() };
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
    h("div", { class: "grille-form" }, champ(tr("Titre"), titre), champ(tr("Usage"), [cle, cles], tr("Le même usage dans plusieurs langues : le bon est proposé selon la langue.")), champ(tr("Langue"), langue)),
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
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Messages types")), h("p", { class: "sous" }, tr("Confirmation, rappel de la veille, demande d'avis, météo, demande au partenaire. À copier depuis une réservation ou un dossier."))), admin ? h("div", { class: "entete-actions" }, h("button", { class: "secondaire", type: "button", onclick: async () => { if (await confirmer(tr("Remettre les messages de départ ? Vos modifications seront perdues."), tr("Remettre"))) { await enregistrerReglages({ ...reglages(), messages: structuredClone(MESSAGES_DEFAUT) }); rafraichir(); } } }, tr("Remettre ceux de départ")), h("button", { class: "principal", type: "button", onclick: () => ouvrir({}) }, tr("Nouveau message"))) : null),
    LANGUES.map(([code, nom]) => {
      const du = tous.filter((m) => m.langue === code);
      if (!du.length) return null;
      return h(
        "section",
        null,
        h("h2", null, nom),
        code === "th" ? h("p", { class: "aide" }, tr("Propositions à faire relire par une personne qui lit le thaï avant usage réel.")) : null,
        h("ul", { class: "cartes" }, du.map((m) => h("li", { class: "carte" }, h("div", { class: "carte-lien statique" }, h("span", { class: "carte-titre" }, m.titre, h("span", { class: "tag" }, m.cle)), h("pre", { class: "message-texte" }, m.corps), h("span", { class: "carte-pied" }, h("span"), h("span", { class: "carte-actions" }, h("button", { class: "secondaire petit", type: "button", onclick: () => copier(m.corps) }, tr("Copier")), admin ? h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrir(m) }, tr("Modifier")) : null))))))
      );
    }),
    !tous.length ? h("p", { class: "vide-court" }, tr("Aucun message type.")) : null,
    h("p", { class: "aide" }, `${tous.length > 1 ? tr("Langues :") : tr("Langue :")} ${[...new Set(tous.map((m) => nomLangue(m.langue)))].join(", ")}. ${admin ? "" : tr("Seuls les administrateurs modifient les messages.")}`)
  );
}
