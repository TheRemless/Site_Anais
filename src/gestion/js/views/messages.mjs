// Messages types : la fenêtre « Copier un message » (depuis une réservation ou un dossier) et l'écran qui les gère.
import { reglages, estAdmin, enregistrerReglages } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, icone } from "../ui.mjs";
import { uid, MESSAGES_DEFAUT } from "../defauts.mjs";
import { remplirGabarit, destinataireMessage, gabaritsPropose, gabaritsManquants } from "../operations-calc.mjs";
import { chiffres } from "./partenaires.mjs";
import { sansAccents } from "../partenaires-calc.mjs";
import { barreFiltres, plierSections } from "./commun.mjs";
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
const NOMS_VARIABLES = { client: N_("nom du client"), prenom: N_("prénom"), date: N_("date"), hotel: N_("hôtel"), heure: N_("heure de pickup"), personnes: N_("personnes"), prestation: N_("service"), partenaire: N_("partenaire"), reference: N_("référence"), lien_avis: N_("lien d'avis Google"), entreprise: N_("entreprise") };
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
// `suite` : paragraphe ajouté en fin de texte. `surEnvoi` : appelée quand le message part (WhatsApp ouvert) ou est copié, par exemple pour passer une réservation à « Demandée ».
export function ouvrirMessage({ titre = tr("Copier un message"), vars = {}, cle = "", langue = "fr", telephone = "", pour = "client", surEnvoi = null, suite = "" }) {
  // Les modèles de la base ; l'usage demandé (« relance »…) y manque-t-il, son modèle par défaut est proposé, jamais le premier modèle venu.
  const tous = gabaritsPropose(messagesTypes(), MESSAGES_DEFAUT, { pour, langue, cle }).liste;
  if (!tous.length) return toast(pour === "partenaire" ? tr("Aucun message type pour les partenaires. Créez-en dans l'écran Messages.") : tr("Aucun message type pour les clients. Créez-en dans l'écran Messages."), true);
  const texte = h("textarea", { id: "msg-texte", rows: 11 });
  // La langue choisie la dernière fois pour ce numéro est reprise : Anaïs ne la rechoisit pas à chaque message au même client.
  const empreinte = (t) => [...t].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7).toString(36); // le numéro lui-même ne s'écrit pas dans le stockage
  // Numéro d'un partenaire thaï : le format local (081…) prend +66 ; celui d'un client, jamais deviné.
  const normalise = (t) => chiffres(t, { thaiLocal: pour === "partenaire" });
  const cleLangue = normalise(telephone) ? `gestion-langue-msg:${empreinte(normalise(telephone))}` : "";
  const memoire = { lire: () => { try { return cleLangue ? localStorage.getItem(cleLangue) || "" : ""; } catch { return ""; } }, ecrire: (v) => { try { if (cleLangue) localStorage.setItem(cleLangue, v); } catch { /* stockage refusé : tant pis */ } } };
  const selLangue = h("select", { id: "msg-langue", onchange: () => (memoire.ecrire(selLangue.value), remplirGabarits()) }, LANGUES.filter(([c]) => tous.some((m) => m.langue === c)).map(([c, l]) => h("option", { value: c }, l)));
  const souvenir = memoire.lire();
  selLangue.value = tous.some((m) => m.langue === souvenir) ? souvenir : tous.some((m) => m.langue === langue) ? langue : selLangue.firstChild.value;
  const selGabarit = h("select", { id: "msg-gabarit", onchange: () => remplir() });
  function remplirGabarits() {
    const prefere = tous.find((m) => m.langue === selLangue.value && m.cle === cle);
    // Aucun modèle pour cet usage dans cette langue : le choix reste vide, le texte aussi, plutôt que de proposer un message qui n'a rien à voir.
    selGabarit.replaceChildren(...(cle && !prefere ? [h("option", { value: "" }, tr("Choisir un message"))] : []), ...tous.filter((m) => m.langue === selLangue.value).map((m) => h("option", { value: m.id }, m.defaut ? tr("{titre} (modèle par défaut)", { titre: m.titre }) : m.titre)));
    selGabarit.value = prefere ? prefere.id : cle ? "" : selGabarit.value;
    remplir();
  }
  // Ce que le gabarit réclame et que la réservation ne donne pas (heure, hôtel…) : dit avant l'envoi plutôt que découvert par le client.
  const manque = h("p", { class: "bandeau-info", role: "status", hidden: true });
  const aucun = h("p", { class: "bandeau-info", role: "status", hidden: true }, tr("Aucun message « {usage} » dans cette langue : choisissez-en un, ou créez-le dans l'écran Messages.", { usage: cle }));
  function remplir() {
    const m = tous.find((x) => x.id === selGabarit.value);
    // `suite` : un paragraphe ajouté après le modèle, quel que soit le modèle choisi (la note du passeport pour Langkawi, par exemple).
    texte.value = m ? `${remplirGabarit(m.corps, vars)}${suite ? `\n\n${suite}` : ""}` : "";
    aucun.hidden = !!m || !cle;
    const vides = m ? [...new Set([...m.corps.matchAll(/\{(\w+)\}/g)].map((x) => x[1]))].filter((k) => k in vars && !String(vars[k] ?? "").trim() && !["a_heure", "telephone"].includes(k)) : [];
    manque.hidden = !vides.length;
    manque.textContent = vides.length ? tr("À compléter dans le texte : {liste}.", { liste: vides.map((k) => NOMS_VARIABLES[k] ? tr(NOMS_VARIABLES[k]) : k).join(", ") }) : "";
  }
  remplirGabarits();
  const numero = normalise(telephone);
  const fermer = modal(
    titre,
    h(
      "div",
      { class: "modal-corps message-apercu" },
      h("div", { class: "grille-form" }, champ(tr("Langue"), selLangue), champ(tr("Message type"), selGabarit)),
      aucun,
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
    champ(tr("Texte"), corps, tr("Variables : {client} {prenom} {date} {hotel} {heure} {a_heure} {personnes} {prestation} {partenaire} {reference} {entreprise} {telephone} {lien_avis}")),
    h("div", { class: "actions" }, m.id ? h("button", { class: "danger", type: "button", onclick: async () => { if (await confirmer(tr("Supprimer « {titre} » ?", { titre: m.titre }), tr("Supprimer"), true)) { await enregistrerReglages({ ...reglages(), messages: messagesTypes().filter((x) => x.id !== m.id) }); apres(); } } }, tr("Supprimer")) : null, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
  );
}

export function vueMessages() {
  const admin = estAdmin();
  const rafraichir = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
  const ouvrir = (m) => { const fermer = modal(m.id ? tr("Modifier le message") : tr("Nouveau message type"), formulaireMessage(m, () => (fermer(), rafraichir())), { large: true }); };
  const tous = messagesTypes();
  // Les modèles par défaut dont l'usage manque (une relance, une annulation…). Une entreprise dont les documents sont en anglais n'y gagne pas de français.
  const enAnglais = /invoice/i.test((reglages().libelles && reglages().libelles.facture) || "");
  const manquants = admin ? gabaritsManquants(tous, MESSAGES_DEFAUT).filter((m) => !enAnglais || m.langue !== "fr") : [];
  const ajouterManquants = async () => {
    if (!(await confirmer(tr("Ajouter {n} modèles qui manquent ? Les modèles que vous avez modifiés ne sont pas touchés.", { n: manquants.length }), tr("Ajouter")))) return;
    try {
      await enregistrerReglages({ ...reglages(), messages: [...messagesTypes(), ...manquants.map((m) => ({ ...m, id: uid() }))] });
      toast(tr("Modèles ajoutés."));
      rafraichir();
    } catch (err) {
      toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    }
  };
  // Trente modèles ne se lisent pas d'une traite sur téléphone : une recherche, des puces (client, partenaire) et des sections repliées.
  const filtre = { recherche: "", pour: "tous" };
  const zone = h("div", { class: "messages-zone" });
  const correspond = (m) => !filtre.recherche.trim() || sansAccents(`${m.titre} ${m.cle} ${m.corps}`).includes(sansAccents(filtre.recherche.trim()));
  const sections = () =>
    DESTINATAIRES.filter(([pour]) => filtre.pour === "tous" || filtre.pour === pour).flatMap(([pour, nomPour]) => LANGUES.map(([code, nom]) => {
      const du = tous.filter((m) => destinataireMessage(m) === pour && m.langue === code && correspond(m));
      if (!du.length) return null;
      return h(
        "section",
        null,
        h("h2", null, tr("{pour}, {langue}", { pour: tr(nomPour), langue: { fr: tr("en français"), en: tr("en anglais"), th: tr("en thaï") }[code] || nom })),
        code === "th" ? h("p", { class: "aide" }, tr("Propositions à faire relire par une personne qui lit le thaï avant usage réel.")) : null,
        h("ul", { class: "cartes" }, du.map((m) => h("li", { class: "carte" }, h("div", { class: "carte-lien statique" }, h("span", { class: "carte-titre" }, m.titre, h("span", { class: "tag" }, m.cle)), h("pre", { class: "message-texte" }, m.corps), h("span", { class: "carte-pied" }, h("span"), h("span", { class: "carte-actions" }, h("button", { class: "secondaire petit", type: "button", onclick: () => copier(m.corps) }, tr("Copier")), admin ? h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrir(m) }, tr("Modifier")) : null))))))
      );
    }));

  function dessiner() {
    // Conteneur neuf à chaque fois : les écouteurs posés par plierSections partent avec lui au lieu de s'empiler sur la même zone.
    const frais = h("div");
    const contenu = sections().filter(Boolean);
    frais.append(...contenu, ...(contenu.length || !tous.length ? [] : [h("p", { class: "vide-court" }, tr("Aucun message ne correspond."))]));
    // Pendant une recherche tout s'ouvre : un résultat caché derrière un titre replié ne sert à rien.
    const cherche = filtre.recherche.trim();
    plierSections(frais, { cle: cherche ? `messages|${cherche}` : "messages", ouverts: cherche ? new Set([...frais.querySelectorAll(":scope > section > h2")].map((t) => t.textContent)) : new Set() });
    zone.replaceChildren(frais);
  }
  let minuteur = null;
  const barre = barreFiltres({ recherche: { placeholder: tr("Titre, usage ou texte"), libelle: tr("Chercher un message") }, puces: { libelle: tr("Destinataire"), valeur: "tous", options: [{ valeur: "tous", libelle: tr("Tous") }, ...DESTINATAIRES.map(([valeur, libelle]) => ({ valeur, libelle: tr(libelle) }))] }, onchange: (v) => { filtre.recherche = v.recherche; filtre.pour = v.puces; clearTimeout(minuteur); minuteur = setTimeout(dessiner, 200); } });
  dessiner();
  return h(
    "div",
    { "data-titre": tr("Messages") },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Messages types")), h("p", { class: "sous" }, tr("Au client : confirmation, rappel de la veille, avis, météo. Au partenaire : demande, relance, modification, annulation. À copier depuis une réservation."))), admin ? h("div", { class: "entete-actions" }, manquants.length ? h("button", { class: "secondaire", type: "button", onclick: ajouterManquants }, tr("Ajouter les modèles manquants")) : null, h("button", { class: "secondaire", type: "button", onclick: async () => { if (await confirmer(tr("Remettre les messages de départ ? Vos modifications seront perdues."), tr("Remettre"))) { await enregistrerReglages({ ...reglages(), messages: structuredClone(MESSAGES_DEFAUT) }); rafraichir(); } } }, tr("Remettre ceux de départ")), h("button", { class: "principal", type: "button", onclick: () => ouvrir({}) }, tr("Nouveau message"))) : null),
    tous.length > 4 ? barre.noeud : null,
    zone,
    !tous.length ? h("p", { class: "vide-court" }, tr("Aucun message type.")) : null,
    h("p", { class: "aide" }, `${tous.length > 1 ? tr("Langues :") : tr("Langue :")} ${[...new Set(tous.map((m) => nomLangue(m.langue)))].join(", ")}. ${admin ? "" : tr("Seuls les administrateurs modifient les messages.")}`)
  );
}
