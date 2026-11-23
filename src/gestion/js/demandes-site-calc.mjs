// Demandes du site (migration 30) : la logique pure de la boîte « Demandes du site ».
// Ce que l'écran montre d'une demande, le message à relire par « Coller une demande », les changements décidés par Anaïs,
// les réponses anglaises à copier dans la conversation WhatsApp du client, et les petits chiffres. Rien ne part au prestataire.
import { PRODUITS_SITE } from "./site-produits.mjs";
import { PRODUITS_CARNET, CHEMIN_CARNET, ORIGINES_CARNET, SORTIES_KOH_LANTA, EXTRAS_DU_SITE } from "./carnet-produits.mjs";
import { agesDuMessage, ajusterAgesCarnet, sortieParId, resoudreSortie, nomsDeOption, cleTexte } from "./carnet-ages.mjs";
import { N_ } from "./i18n.mjs";

export const STATUTS_DEMANDE = { nouvelle: N_("À traiter"), confirmee: N_("Confirmée"), refusee: N_("Refusée"), classee: N_("Classée") };
export const MOTIFS_REFUS = { complet: N_("Complet ce jour-là"), mer: N_("Mer trop agitée"), indisponible: N_("Pas possible ce jour-là"), autre: N_("Sans motif") };

export const nomProduit = (d) => d.produit || (sortieParId(d.produit_id) || {}).nom || d.produit_id;
// Ce que le client demande, pour l'écran et les réponses. Une page taxi sert les deux sens : son nom (« Krabi Airport to Koh Lanta ») peut être
// l'inverse du trajet demandé. Le trajet est alors celui du message (« Transfer request: Koh Lanta to Krabi Airport », demande du 18.11.2026).
export function titreDemande(d) {
  const m = d.marque === "taxi" ? /^Transfer request:\s*(.+)$/m.exec(d.message || "") : null;
  return (m && m[1].trim()) || nomProduit(d);
}
// Le message du client tel que le site l'a envoyé (d.message), sans rien y changer : ni les changements d'Anaïs, ni une reconstruction.
// Vide pour une demande dont le message n'a pas été gardé (ancien site).
export const messageClient = (d) => (d && typeof d.message === "string" ? d.message : "");
// Les demandes du site qui ont créé ce dossier, la plus récente en premier (demandes_site.dossier_id).
export const demandesDuDossier = (demandes, dossierId) =>
  dossierId ? (demandes || []).filter((x) => x.dossier_id === dossierId).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))) : [];
export function titreOption(d) {
  if (d.option_titre) return d.option_titre;
  const p = sortieParId(d.produit_id);
  const id = cleTexte(d.option_id);
  const o = p && id ? p.options.find((x) => nomsDeOption(x).includes(id)) : null;
  return o ? o.titre : d.option_id || "";
}
// L'option d'une demande, résolue comme pour le tarif et l'âge (carnet-ages.mjs, resoudreSortie) : { produit, option }, ou null si la sortie ou l'option ne se reconnaît pas.
// `titre` : le titre à résoudre (celui de la demande, ou celui choisi dans « Modifier »).
const optionDeLaDemande = (d, titre = d.option_titre || "", id = d.option_id || "") => resoudreSortie({ carnet: { produit: d.produit_id, option: id }, option: titre });
// Le titre de l'option de la demande, ramené au titre canonique de l'option résolue (« avec kayak » de la page donne « With kayak »), sinon tel que la demande l'écrit.
export const titreCanonique = (d) => {
  const r = optionDeLaDemande(d);
  return r ? r.option.titre : titreOption(d);
};
// Ce titre désigne-t-il la même option que la demande ? Comparé par option RÉSOLUE (identifiant, titre, alias), jamais par le texte : « With kayak » et « avec kayak » sont la même.
export function memeOption(d, titre) {
  const a = optionDeLaDemande(d);
  const b = optionDeLaDemande(d, titre, "");
  if (a && b) return a.option.id === b.option.id;
  return cleTexte(titre) === cleTexte(titreOption(d));
}
// Options proposées pour « Modifier » : celles de la sortie, et l'option de la demande seulement si elle n'est aucune d'elles (un nom qui a changé depuis sur le site). `courante` :
// le titre à montrer comme choix de départ, canonique quand l'option se résout.
export function optionsModifiables(d) {
  const options = [...sortieOptions(d.produit_id)];
  const r = optionDeLaDemande(d);
  if (r) return { options, courante: r.option.titre };
  const brut = titreOption(d);
  if (brut && !options.some((o) => cleTexte(o.titre) === cleTexte(brut))) options.unshift({ id: d.option_id || "", titre: brut });
  return { options, courante: brut || (options[0] || {}).titre || "" };
}
// Le titre à poser dans les changements quand Anaïs choisit `choisi`, ou null si l'option résolue ne change pas (choisir la même option n'est pas un changement).
export const optionModifiee = (d, choisi) => {
  const c = String(choisi || "").trim();
  return c && !memeOption(d, c) ? c : null;
};
// Options d'une sortie (celles du carnet ou de la page produit du site).
const sortieOptions = (id) => (sortieParId(id) || { options: [] }).options;
export const optionsProduit = sortieOptions;

// La demande telle qu'elle vaut maintenant : ce que le client a envoyé, avec les changements décidés par Anaïs par-dessus.
export function demandeEffective(d, modifs = {}) {
  const m = modifs || {};
  return {
    ...d,
    date_service: m.date || d.date_service,
    heure: m.heure || d.heure,
    option_titre: m.option_titre || titreOption(d),
    adultes: m.adultes ?? d.adultes,
    enfants: m.enfants ?? d.enfants,
    total: m.prix ?? null,
  };
}

// ---- Dates et nombres en anglais, comme le site ------------------------------------------------------------
const JOURS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MOIS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const utc = (iso) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
// « Tuesday 18 November » (l'année n'est ajoutée que si elle n'est pas celle d'aujourd'hui).
export function dateAnglaise(iso, aujourdhui = "") {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || "")) return "";
  const d = utc(iso);
  const an = aujourdhui && aujourdhui.slice(0, 4) !== iso.slice(0, 4) ? ` ${d.getUTCFullYear()}` : "";
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}${an}`;
}
// « Wed 4 Nov 2026 » : la ligne « Date: » d'un message du site, celle que lit « Coller une demande ».
export const dateDuSite = (iso) => {
  const d = utc(iso);
  return `${JOURS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
};
export const montantAnglais = (n, devise = "THB") => `${Math.round(Number(n) * 100) / 100 === Math.round(Number(n)) ? Math.round(Number(n)).toLocaleString("en-US") : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
const pl = (n, un, plusieurs) => `${n} ${n === 1 ? un : plusieurs}`;
export const personnesAnglais = (adultes, enfants) => [adultes ? pl(adultes, "adult", "adults") : "", enfants ? pl(enfants, "child", "children") : ""].filter(Boolean).join(", ");
export const prenom = (nom) => String(nom || "").trim().split(/\s+/)[0] || "";

// ---- Le message à relire ------------------------------------------------------------------------------------------
// Le message que le site a envoyé à WhatsApp, avec les changements d'Anaïs posés dessus : « Coller une demande » le lit comme d'habitude
// (même format, mêmes tests), trouve le service dans la base de prix et crée le dossier. Sans message (ancien site), il est reconstruit.
// Une ligne « Clé : valeur » du message, ou undefined (une seule lecture pour les extras, le transfert et les lignes du récapitulatif).
const lireLigne = (message, re) => (re.exec(message || "") || [])[1];
// Les extras que le client a écrits dans la ligne « Extras: » du message (« Add Koh Kradan »). Le transfert depuis l'hôtel n'en fait pas partie : c'est un prix indicatif à confirmer,
// pas un extra acquis (transfertDuMessage).
export const extrasDuMessage = (message) => (lireLigne(message, /^Extras\s*:\s*(.+)$/im) || "").trim();
// Le transfert depuis l'hôtel que le récapitulatif de la page dit « oui » (« oui (1 500 THB par van, indicatif) »), écrit en anglais : « requested (indicative 1 500 THB per van) ».
// Vide quand le client ne l'a pas coché. Jamais dans « Extras: ».
export function transfertDuMessage(message) {
  const v = lireLigne(message, /^Transfert depuis l.hôtel\s*:\s*(oui.*)$/im);
  if (!v) return "";
  const prix = /\((.*)\)/.exec(v);
  const dit = prix ? prix[1].replace(/,\s*indicatif\s*$/i, "").replace(/\bpar\b/gi, "per").trim() : "";
  return dit ? `requested (indicative ${dit})` : "requested";
}
// Les lignes du récapitulatif de la page (en français) qui n'ont pas de champ dans la demande, reportées dans le message refait : « Formula: », « Slot: », « Extras: » (les extras déjà
// écrits à la façon du site), « Hotel transfer: » (quand le client l'a coché), « Park fee: » et « Message: ». Le texte du client est repris tel que la page l'a écrit.
function lignesDuRecapitulatif(message) {
  const lire = (re) => lireLigne(message, re);
  const formule = lire(/^Formule\s*:\s*(.+)$/im);
  const creneau = lire(/^Créneau\s*:\s*(.+)$/im);
  const parc = lire(/^Entrée du parc à payer sur place\s*:\s*(.+)$/im);
  const client = lire(/^Message\s*:\s*(.+)$/im);
  const extras = extrasDuMessage(message);
  const transfert = transfertDuMessage(message);
  return [formule ? `Formula: ${formule.trim()}` : "", creneau ? `Slot: ${creneau.trim()}` : "", extras ? `Extras: ${extras}` : "", transfert ? `Hotel transfer: ${transfert}` : "", parc ? `Park fee: ${parc.trim()}` : "", client ? `Message: ${client.trim()}` : ""].filter(Boolean);
}
// Les extras d'une ligne « Extras: » qui valent pour l'option finale : un extra connu (EXTRAS_DU_SITE) d'une autre option s'en va (« Add Koh Kradan » n'a pas de sens sur le join-in, où
// Kradan est déjà dans la sortie), les autres restent. Rend le texte restant, vide s'il ne reste rien.
export function extrasPourOption(extras, produitId, optionId) {
  const inapplicables = EXTRAS_DU_SITE.filter((x) => !(x.produit === produitId && x.option === optionId)).map((x) => cleTexte(x.ligne));
  return String(extras || "").split(/\s*[;|]\s*|,\s*(?=[A-Z])/).map((x) => x.trim()).filter((x) => x && !inapplicables.some((i) => cleTexte(x).includes(i))).join(", ");
}
// « 2 adults, 2 children (ages 5 and under 1) » : les invités lus dans le message (agesDuMessage), avec leurs âges, tels que le contrat du site les écrit.
function invitesAnglais({ adultes = 0, enfants = 0, bebes = 0, ages = [] }) {
  const enfantsTous = ages.length || enfants + bebes;
  const age = (a) => (a === 0 ? "under 1" : String(a));
  const liste = ages.length ? ` (age${ages.length > 1 ? "s" : ""} ${ages.length > 1 ? `${ages.slice(0, -1).map(age).join(", ")} and ${age(ages[ages.length - 1])}` : age(ages[0])})` : "";
  return [adultes ? `${adultes} adult${adultes > 1 ? "s" : ""}` : "", enfantsTous ? `${enfantsTous} ${enfantsTous > 1 ? "children" : "child"}${liste}` : ""].filter(Boolean).join(", ");
}
export function texteDemande(d, modifs = {}) {
  const e = demandeEffective(d, modifs);
  const transfert = d.marque === "taxi" || /^(Transfer|Shared minivan) request:/m.test(d.message || "");
  // Une demande du carnet dont le message est le récapitulatif de la page (écrit en français, ni « Booking request: » ni « Guests: ») n'est pas relue d'après lui : le message que
  // la fenêtre de création lit est refait des champs de la demande, avec les âges des enfants lus dans « Personnes : » et les lignes du récapitulatif qui n'ont pas de champ
  // (formule, créneau, transfert depuis l'hôtel, entrée du parc, message du client) reportées telles quelles. Un message déjà au format du site est gardé tel quel.
  // Le message du client, lui, reste affiché tel qu'il est.
  const m = modifs || {};
  const carnet = estCarnet(d);
  const refait = carnet && !/^Booking request:/im.test(d.message || "");
  let lignes = refait ? [] : (d.message || "").split("\n").filter((l) => l.trim());
  if (!lignes.length) {
    const option = e.option_titre ? ` – ${e.option_titre}` : "";
    const sortie = carnet ? sortieParId(d.produit_id) : null;
    const produit = sortie ? sortie.nom : nomProduit(d);
    lignes = [transfert ? `Transfer request: ${produit}${option}` : `Booking request: ${produit}${option}`];
    if (d.date_service) lignes.push(`Date: ${dateDuSite(d.date_service)}`);
    if (d.heure) lignes.push(`Pickup time: ${d.heure}`);
    const invites = carnet ? agesDuMessage(d.message) : null;
    const gens = invites ? invitesAnglais(invites) : personnesAnglais(d.adultes || 0, d.enfants || 0);
    if (gens) lignes.push(`Guests: ${gens}`);
    if (d.pickup) lignes.push(`Pickup: ${d.pickup}`);
    if (d.nom) lignes.push(`Name: ${d.nom}`);
    if (d.total_estime) lignes.push(`Estimated total: ${montantAnglais(d.total_estime, d.devise || "THB")}`);
    if (refait) lignes.push(...lignesDuRecapitulatif(d.message));
  }
  // Le prix annoncé sur la page est celui de l'option demandée : quand l'option change, la ligne ne vaut plus (la fenêtre garde alors le prix de la base).
  if (m.option_titre && !memeOption(d, m.option_titre)) {
    lignes = lignes.filter((l) => !/^(Estimated total|Price on the site|Price):/i.test(l));
    // Demande du carnet : l'extension de Kradan n'a de sens que sur la sortie et l'option pour lesquelles elle existe ; le message refait et les notes du dossier n'en gardent que ce qui vaut pour l'option finale.
    const finale = carnet ? resoudreSortie({ carnet: { produit: d.produit_id, option: "" }, option: m.option_titre }) : null;
    if (finale) lignes = lignes.map((l) => { const x = /^Extras\s*:\s*(.*)$/i.exec(l); return x ? `Extras: ${extrasPourOption(x[1], finale.produit.id, finale.option.id)}` : l; }).filter((l) => !/^Extras:\s*$/.test(l));
  }
  // Nouvelle option : la première ligne « … request: Produit – Option » change de fin.
  if (m.option_titre && /^(Booking|Transfer) request:/.test(lignes[0])) {
    const avant = titreOption(d);
    lignes[0] = avant && lignes[0].endsWith(` – ${avant}`) ? `${lignes[0].slice(0, -avant.length)}${m.option_titre}` : `${lignes[0].replace(/ – .*$/, "")} – ${m.option_titre}`;
  }
  const poser = (prefixe, valeur, apres) => {
    const i = lignes.findIndex((l) => l.startsWith(prefixe));
    if (i >= 0) lignes[i] = `${prefixe} ${valeur}`;
    else {
      const j = lignes.findIndex((l) => l.startsWith(apres));
      lignes.splice(j >= 0 ? j + 1 : 1, 0, `${prefixe} ${valeur}`);
    }
  };
  if (m.date) poser("Date:", dateDuSite(m.date), "Booking request:");
  if (m.heure) poser("Pickup time:", m.heure, "Date:");
  if (m.adultes !== undefined || m.enfants !== undefined) poser("Guests:", personnesAnglais(e.adultes || 0, e.enfants || 0), "Date:");
  return lignes.join("\n");
}

// Ce que la confirmation retient de la fenêtre de création : les services réellement créés (`services` : date, heure, personnes, titre, extras de chacun, tels que la fenêtre les rend) et le total
// de la facture, avec les changements décidés dans « Modifier ». Les extras sont ceux des lignes créées : une ligne supprimée dans la fenêtre n'est pas annoncée au client.
export function finalDeConfirmation(d, modifs, { services = [], total = null, devise = "THB" } = {}) {
  const s = services[0] || {};
  return {
    ...(services.length > 1 ? { services: services.map((x) => ({ titre: x.titre, date: x.date, heure: x.heure, adultes: x.adultes, enfants: x.enfants, extras: x.extras || [] })) } : {}),
    date: s.date || (modifs || {}).date || d.date_service,
    heure: s.heure || (modifs || {}).heure || d.heure,
    option_titre: (modifs || {}).option_titre || titreCanonique(d),
    adultes: s.adultes ?? d.adultes,
    enfants: s.enfants ?? d.enfants,
    extras: s.extras || [],
    total: (modifs || {}).prix ?? (total > 0 ? total : null),
    devise,
  };
}

// ---- Changements et réponses ---------------------------------------------------------------------------------------
// Ce qui a changé entre la demande et ce qui a été réservé. `final` : { date, heure, option_titre, adultes, enfants, total, devise }.
// Une heure absente de la demande (une sortie : le site ne la demande pas) n'est pas un changement, c'est une précision.
export function changements(d, final) {
  const out = [];
  const ajoute = (champ, avant, apres) => out.push({ champ, avant, apres });
  // Plusieurs services : chacun a sa date et ses personnes, rien à comparer à une seule ligne de la demande.
  if (final.services && final.services.length > 1) return out;
  if (final.date && d.date_service && final.date !== d.date_service) ajoute("date", d.date_service, final.date);
  if (final.heure && d.heure && final.heure !== d.heure) ajoute("heure", d.heure, final.heure);
  const optAvant = titreCanonique(d);
  if (final.option_titre && optAvant && !memeOption(d, final.option_titre)) ajoute("option", optAvant, final.option_titre);
  // « Avant » : la demande telle que le client l'a envoyée, tarifée avec SON option (un enfant du carnet plus âgé que le barème compte adulte, même règle que la fenêtre de
  // création). « Après » : ce que la fenêtre a créé (final), avec l'option finale.
  const tarifee = demandeTarifee(d);
  const gensAvant = personnesAnglais(tarifee.adultes || 0, tarifee.enfants || 0);
  const gensApres = personnesAnglais(final.adultes || 0, final.enfants || 0);
  if (gensAvant && gensApres && gensAvant !== gensApres) ajoute("personnes", gensAvant, gensApres);
  if (final.total !== null && final.total !== undefined && d.total_estime !== null && d.total_estime !== undefined && Number(final.total) !== Number(d.total_estime)) ajoute("prix", Number(d.total_estime), Number(final.total));
  return out;
}

const LIBELLE_CHANGEMENT = { date: "Date", heure: "Pickup time", option: "Option", personnes: "Guests", prix: "Price" };
function ligneChangement(c, devise, aujourdhui) {
  const v = (x) => (c.champ === "date" ? dateAnglaise(x, aujourdhui) : c.champ === "prix" ? montantAnglais(x, devise) : x);
  return `${LIBELLE_CHANGEMENT[c.champ]}: ${v(c.apres)} instead of ${v(c.avant)}`;
}

// ---- Numéro WhatsApp du client (migration 41) ----------------------------------------------------------------------
// La fonction « demande-site » le garde au format E.164 (« +41791234567 »). Une demande d'avant le 17.11.2026, ou d'une page du site encore
// en cache, n'en a pas : la carte le dit et la réponse se copie comme avant.
export const E164 = /^\+[1-9]\d{7,14}$/;
export const numeroWhatsApp = (d) => (d && typeof d.telephone === "string" && E164.test(d.telephone) ? d.telephone : "");
// Lien qui ouvre la conversation du client avec la réponse déjà écrite. Rien ne part : Anaïs relit et envoie elle-même dans WhatsApp.
export function lienWhatsAppClient(d, texte = "") {
  const numero = numeroWhatsApp(d);
  if (!numero) return "";
  return `https://wa.me/${numero.slice(1)}${texte ? `?text=${encodeURIComponent(texte)}` : ""}`;
}
// Les groupes de chiffres changent d'un pays à l'autre (« +33 6 39 98 00 02 », « +44 7700 900123 ») : on ne montre à part que l'indicatif,
// plutôt que de couper faux.
export function numeroAffiche(e164) {
  const m = /^\+(1|7|2[07]|3[0-469]|4[013-9]|5[1-8]|6[0-6]|8[1246]|9[0-58]|\d{3})(\d+)$/.exec(e164 || "");
  if (!m) return e164 || "";
  return `+${m[1]} ${m[2]}`;
}

// Réponse de confirmation (avec les changements s'il y en a), en anglais, pour la conversation WhatsApp du client :
// « Écrire sur WhatsApp » l'ouvre avec ce texte quand la demande a un numéro, sinon on la copie et la référence aide à retrouver la conversation.
export function reponseConfirmation(d, final, { aujourdhui = "" } = {}) {
  const devise = final.devise || d.devise || "THB";
  const taxi = d.marque === "taxi";
  const ch = changements(d, final);
  const salut = prenom(d.nom) ? `Hi ${prenom(d.nom)},` : "Hi,";
  const quoi = taxi ? "transfer" : "booking";
  const tete = ch.length === 0 ? `Your ${quoi} is confirmed.` : `Your ${quoi} is confirmed with ${ch.length === 1 ? "one change" : "these changes"}:`;
  const titre = [titreDemande(d), final.option_titre || titreCanonique(d)].filter(Boolean).join(" – ");
  const quand = [final.date ? dateAnglaise(final.date, aujourdhui) : "", final.heure ? `pickup ${final.heure}` : ""].filter(Boolean).join(", ");
  const ligneService = (s) => [s.titre, s.date ? dateAnglaise(s.date, aujourdhui) : "", s.heure ? `pickup ${s.heure}` : "", personnesAnglais(s.adultes || 0, s.enfants || 0), s.extras && s.extras.length ? `Extras: ${s.extras.join(", ")}` : ""].filter(Boolean).join(", ");
  const total = final.total !== null && final.total !== undefined && final.total !== "" ? `Total: ${montantAnglais(final.total, devise)}` : "";
  const recap = final.services && final.services.length > 1
    ? [...final.services.map(ligneService), d.pickup ? `Pickup: ${d.pickup}` : "", total].filter(Boolean)
    : [titre, quand, personnesAnglais(final.adultes || 0, final.enfants || 0), d.pickup ? `Pickup: ${d.pickup}` : "", final.extras && final.extras.length ? `Extras: ${final.extras.join(", ")}` : "", total].filter(Boolean);
  // VIP Taxi Lanta : paiement en espèces au chauffeur (fait publié sur le site, site.json « payment »).
  const paiement = taxi ? ["Payment in cash to the driver on the day."] : [];
  return [salut, "", tete, ...ch.map((c) => ligneChangement(c, devise, aujourdhui)), "", ...recap, ...(paiement.length ? ["", ...paiement] : []), ...(d.ref ? ["", `Reference: ${d.ref}`] : [])].join("\n");
}

const PHRASE_MOTIF = {
  complet: "Unfortunately it is fully booked that day.",
  mer: "Unfortunately the sea is too rough for this trip that day.",
  indisponible: "Unfortunately we cannot arrange it that day.",
  autre: "Unfortunately we cannot confirm it this time.",
};
// Refus poli, avec une autre date et/ou une autre sortie si Anaïs en propose une. `alternative` : { date, produit_id }.
export function reponseRefus(d, { motif = "autre", alternative = {} } = {}, { aujourdhui = "" } = {}) {
  const salut = prenom(d.nom) ? `Hi ${prenom(d.nom)},` : "Hi,";
  const quand = d.date_service ? ` on ${dateAnglaise(d.date_service, aujourdhui)}` : "";
  const autre = alternative.produit_id ? (sortieParId(alternative.produit_id) || { nom: alternative.produit_id }).nom : "";
  const autreDate = alternative.date ? dateAnglaise(alternative.date, aujourdhui) : "";
  const offre = autre && autreDate ? `We can offer ${autre} on ${autreDate} instead.` : autre ? `We can offer ${autre} instead.` : autreDate ? `We can offer ${autreDate} instead.` : "";
  return [salut, "", `Thank you for your request for ${titreDemande(d)}${quand}.`, PHRASE_MOTIF[motif] || PHRASE_MOTIF.autre, ...(offre ? [offre, "Would that work for you?"] : ["We hope to see you another time."]), ...(d.ref ? ["", `Reference: ${d.ref}`] : [])].join("\n");
}

// « Il n'a pas écrit » : la demande est arrivée dans Gestion mais pas son message WhatsApp. Un mot poli pour demander si elle tient toujours.
// La demande reste « à traiter » : le client répond, puis Anaïs confirme, modifie ou refuse comme d'habitude.
export function reponseSansMessage(d, { aujourdhui = "" } = {}) {
  const salut = prenom(d.nom) ? `Hi ${prenom(d.nom)},` : "Hi,";
  const quoi = d.marque === "taxi" ? "transfer request" : "booking request";
  const quand = d.date_service ? ` on ${dateAnglaise(d.date_service, aujourdhui)}` : "";
  return [salut, "", `We received your ${quoi} from our website for ${titreDemande(d)}${quand}, but your WhatsApp message didn't reach us.`, "Is it still on? Just reply here and we'll take care of it.", ...(d.ref ? ["", `Reference: ${d.ref}`] : [])].join("\n");
}

// Total réservé imposé (prix convenu dans « Modifier ») : l'écart va sur la première ligne chiffrée, par unité si la division tombe juste,
// sinon cette ligne passe à une quantité de 1 au montant total. Les autres lignes ne bougent pas, le total des lignes vaut toujours `total`.
export function imposerTotal(lignes, total) {
  const chiffrees = lignes.filter((l) => l.kind !== "texte");
  if (!chiffrees.length || total === null || total === undefined || total === "" || !Number.isFinite(Number(total))) return lignes;
  const somme = chiffrees.reduce((s, l) => s + (Number(l.unite) || 0) * (Number(l.qte) || 0), 0);
  const ecart = Math.round((Number(total) - somme) * 100) / 100;
  if (!ecart) return lignes;
  const premiere = chiffrees[0];
  const qte = Number(premiere.qte) || 1;
  const montant = (Number(premiere.unite) || 0) * qte + ecart;
  const parUnite = Math.round((montant / qte) * 100) / 100;
  const juste = Math.round(parUnite * qte * 100) === Math.round(montant * 100);
  return lignes.map((l) => (l !== premiere ? l : juste ? { ...l, unite: parUnite } : { ...l, unite: Math.round(montant * 100) / 100, qte: 1 }));
}

// ---- Demandes venues d'une page privée du carnet de ZTP ----------------------------------------------------------------------
// Une page « /carnet/… » du site de ZTP envoie sa demande à la même fonction que le site Secret (brand « secret » : elle arrive dans Secret).
// On la reconnaît à l'adresse de la page (page_url), jamais à un mot du texte : le client ne voit pas le nom de Secret sur ces pages.
// Une demande est « du carnet » si sa page est sur l'origine d'un site de ZTP ET sous le chemin du carnet : le chemin seul ne suffit pas (une page /carnet/ du site
// Secret n'est pas un carnet). La fonction ne garde d'ailleurs page_url que si elle est sur l'origine de la requête.
export function estCarnet(d) {
  try {
    const u = new URL(d && d.page_url);
    return ORIGINES_CARNET.includes(u.origin) && u.pathname.startsWith(CHEMIN_CARNET);
  } catch {
    return false;
  }
}
// La demande comme Gestion la tarife : un enfant d'une sortie du carnet plus âgé que le barème de la sortie compte adulte (ajusterAgesCarnet). Les adultes, enfants et
// bébés viennent du message (agesDuMessage), comme dans la fenêtre de création, et non du compteur de la table qui compte tous les enfants : une seule source
// pour tous les chemins (fenêtre de création, changements, réponse de confirmation).
export function demandeTarifee(d, titre = titreOption(d)) {
  if (!estCarnet(d) || !sortieParId(d.produit_id)) return d;
  const invites = agesDuMessage(d.message);
  // `titre` : l'option telle qu'elle est tarifée (celle de la demande, ou celle choisie dans « Modifier »), la même résolution que le tarif.
  return ajusterAgesCarnet({ ...d, ...(invites || {}), option: titre, carnet: carnetDeLaDemande(d) });
}
// La sortie et l'option que la fenêtre de création lit dans une demande du carnet (product_id et option), ou null pour une demande qui n'en est pas une.
export const carnetDeLaDemande = (d) => (estCarnet(d) ? { produit: d.produit_id, option: d.option_id || "" } : null);
// Le titre de la page, tiré de son adresse : « /carnet/koh-samui-excursions-bateau/ » donne « Koh Samui Excursions Bateau ». La fonction a déjà retiré le code d'accès.
export function titreCarnet(d) {
  const mots = (cheminPage(d && d.page_url).split("/").filter(Boolean)[1] || "").split("-").filter(Boolean);
  return mots.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join(" ");
}
// Le guide d'une page du carnet, d'après le début du nom de la page (« /carnet/koh-samui-… », « /carnet/ao-nang-… », « /carnet/koh-lanta-… ») : « koh-samui », « aonang », « koh-lanta ».
const GUIDES_PAGES = [[/^koh-samui(-|$)/, "koh-samui"], [/^ao-?nang(-|$)/, "aonang"], [/^koh-lanta(-|$)/, "koh-lanta"]];
export function guideDeLaPage(d) {
  const nom = cheminPage(d && d.page_url).split("/").filter(Boolean)[1] || "";
  const g = GUIDES_PAGES.find(([re]) => re.test(nom));
  return g ? g[1] : null;
}
// Les autres sorties du même guide que celle de la demande (« Proposer une autre sortie » quand on refuse) : celles du site pour une demande du site. Une demande du carnet ne se voit proposer que les sorties de SON guide, jamais celles d'un autre : le guide est celui de la
// sortie (carnet : son guide ; guide de Koh Lanta : SORTIES_KOH_LANTA), à défaut celui de la page. Ni l'un ni l'autre : rien à proposer plutôt qu'une sortie d'un autre guide.
export function autresSorties(d) {
  if (!estCarnet(d)) return PRODUITS_SITE.filter((p) => p.marque === d.marque && p.id !== d.produit_id);
  const ici = PRODUITS_CARNET.find((p) => p.id === d.produit_id);
  const guide = ici ? ici.guide : SORTIES_KOH_LANTA.includes(d.produit_id) ? "koh-lanta" : guideDeLaPage(d);
  if (guide === "koh-lanta") return SORTIES_KOH_LANTA.filter((id) => id !== d.produit_id).map((id) => PRODUITS_SITE.find((p) => p.id === id)).filter((p) => p && p.marque === d.marque);
  return guide ? PRODUITS_CARNET.filter((p) => p.id !== d.produit_id && p.marque === d.marque && p.guide === guide) : [];
}
// Tout ce que la page a envoyé, pour la fiche de la demande : la sortie et son option, la date, les adultes, les enfants avec leurs âges (lus dans
// la ligne « Guests: » du message, la fonction ne garde que leur nombre), l'hôtel (le lieu de prise en charge), le nom, le numéro WhatsApp et le total estimé.
export function champsCarnet(d) {
  const lu = agesDuMessage(d.message);
  const option = titreOption(d);
  return {
    prestation: [nomProduit(d), option].filter(Boolean).join(" – "),
    date: d.date_service || "",
    heure: d.heure || "",
    adultes: d.adultes ?? 0,
    enfants: d.enfants ?? 0,
    ages: lu ? lu.ages : [],
    hotel: d.pickup || "",
    nom: d.nom || "",
    whatsapp: numeroWhatsApp(d),
    extras: extrasDuMessage(d.message),
    transfert: transfertDuMessage(d.message),
    total: d.total_estime ?? null,
    devise: d.devise || "THB",
  };
}

// ---- Liste et chiffres -----------------------------------------------------------------------------------------------
export const aTraiter = (demandes) => demandes.filter((d) => d.statut === "nouvelle");
// Plus récentes d'abord ; les demandes à traiter avant les autres.
export const trierDemandes = (demandes) => [...demandes].sort((a, b) => (b.statut === "nouvelle") - (a.statut === "nouvelle") || String(b.created_at).localeCompare(String(a.created_at)));

// Chemin de la page d'où vient la demande (« /tours/4-islands/ »), sans le domaine ni les paramètres.
export function cheminPage(url) {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "";
  }
}

// Reçues, confirmées, refusées par sortie et par page d'origine, sur une période. Une demande « classée » (essai, doublon) ne compte nulle part.
export function chiffresDemandes(demandes, { depuis = "" } = {}) {
  const liste = demandes.filter((d) => d.statut !== "classee" && (!depuis || String(d.created_at).slice(0, 10) >= depuis));
  const compte = (rs) => ({ recues: rs.length, confirmees: rs.filter((d) => d.statut === "confirmee").length, refusees: rs.filter((d) => d.statut === "refusee").length, a_traiter: rs.filter((d) => d.statut === "nouvelle").length });
  const grouper = (cle, nom) => {
    const groupes = new Map();
    for (const d of liste) {
      const k = cle(d) || "";
      if (!groupes.has(k)) groupes.set(k, []);
      groupes.get(k).push(d);
    }
    return [...groupes].map(([k, rs]) => ({ cle: k, nom: nom(k, rs[0]), ...compte(rs) })).sort((a, b) => b.recues - a.recues || a.nom.localeCompare(b.nom));
  };
  const total = compte(liste);
  const tranchees = total.confirmees + total.refusees;
  return {
    ...total,
    // Taux de confirmation sur les demandes déjà tranchées (celles à traiter n'ont pas encore de réponse).
    taux: tranchees ? Math.round((total.confirmees / tranchees) * 100) : null,
    parProduit: grouper((d) => d.produit_id, (k, d) => nomProduit(d)),
    parPage: grouper((d) => cheminPage(d.page_url), (k) => k || "?"),
  };
}
