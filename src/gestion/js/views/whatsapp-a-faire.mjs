// Vue « À faire » de l'écran WhatsApp (PR B, 21.11.2026) : tout ce qui attend dans la boîte, trié par urgence, sans IA. Le calcul est celui de
// l'outil a_faire_whatsapp de l'Assistant (agent-whatsapp-lecture.mjs), appliqué aux données déjà chargées pour la personne : clients qui
// attendent, promesses de Nani échues, paiements signalés, ferrys non payés, et l'emplacement des nouveaux clients d'un apporteur (PR C).
// Chaque ligne ouvre la conversation au bon message. « Demander à l'assistant de commenter » est le seul appel à l'IA, et seulement au clic.
import { etat, permissionsDe, resumeDossier, changerEntite, naviguer, reglagesDe } from "../etat.mjs";
import { h, icone, toast } from "../ui.mjs";
import { tr, N_, pluriel, localeActive } from "../i18n.mjs";
import { formatMontant } from "../calc.mjs";
import { agentActif } from "../agent-calc.mjs";
import { donneesAFaire, aFaireEcran, detailAFaire, GENRES_A_FAIRE, QUESTION_A_FAIRE_BOITE, CLE_QUESTION_AGENT } from "../whatsapp-relie-calc.mjs";
import { typeContact } from "../apporteurs-calc.mjs";

const jourCourt = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(localeActive(), { day: "numeric", month: "short", timeZone: "UTC" }) : "");

// Ce qui attend, pour les entreprises de la boîte où la personne lit WhatsApp (`entites`). Les montants seulement avec « finances.voir ».
export function aFaireDeLaBoite(entites = []) {
  const donnees = donneesAFaire(etat.brut, {
    entites,
    resumeDe: (d) => (d.entite_id === etat.entiteId ? resumeDossier(d.id) : { total: d.total, recu: d.recu, devise: d.devise }) || {},
    finances: (id) => permissionsDe(id).includes("finances.voir"),
  });
  // Contacts typés (migration 68) : un apporteur qui attend une réponse est « nouveau client envoyé par un apporteur ».
  return aFaireEcran(donnees, { typeContact });
}

// L'Assistant où poser la question : l'entreprise ouverte si l'Assistant y marche, sinon la première de la boîte où il marche.
const assistantDans = (id) => !!id && agentActif(reglagesDe(id)) && ["partenaires.lire", "dossiers.ecrire"].every((d) => permissionsDe(id).includes(d));
function demanderCommentaire(entites) {
  const e = entites.find((x) => x.id === etat.entiteId && assistantDans(x.id)) || entites.find((x) => assistantDans(x.id));
  if (!e) return;
  try {
    sessionStorage.setItem(CLE_QUESTION_AGENT, JSON.stringify({ texte: tr(QUESTION_A_FAIRE_BOITE), entite: e.id, le: Date.now() }));
  } catch {
    return toast(tr("Ce navigateur refuse le stockage de la page : ouvrez l'Assistant et posez la question."), true);
  }
  if (e.id !== etat.entiteId) changerEntite(e.id, { naviguer: false });
  naviguer("#/agent/nouvelle");
}

// L'entreprise comme dans la liste des conversations : son nom, ou « À trier ».
function marqueDe(x, entites) {
  const c = x.conversation ? (etat.brut.whatsapp_conversations || []).find((v) => v.id === x.conversation) : null;
  const e = c && c.entite_id ? entites.find((y) => y.id === c.entite_id) || (etat.brut.entites || []).find((y) => y.id === c.entite_id) : null;
  if (e) return h("span", { class: `wa-marque ${x.entreprise === "secret" || x.entreprise === "taxi" ? x.entreprise : ""}` }, e.nom);
  return x.entreprise === "a_trier" ? h("span", { class: "wa-marque a-trier" }, tr("À trier")) : null;
}
function ligne(x, ouverte, entites) {
  const marque = marqueDe(x, entites);
  const details = detailAFaire(x, { montant: (n, d) => formatMontant(n, d || undefined), jour: jourCourt }).map((d) => (d.brut ? d.texte : tr(d.texte, d.vars || {})));
  return h(
    "li",
    null,
    h(
      "a",
      { href: x.lien, class: `wa-conv wa-afaire${x.niveau === "urgent" ? " urgent" : ""}`, "aria-current": ouverte ? "page" : null },
      h(
        "span",
        { class: "wa-conv-ligne" },
        h("span", { class: "wa-conv-nom" }, h("strong", null, x.nom || tr(GENRES_A_FAIRE[x.genre])), marque),
        x.niveau === "urgent" ? h("span", { class: "wa-attente urgente" }, tr("Urgent")) : null
      ),
      h("span", { class: "wa-afaire-quoi" }, h("strong", null, tr(GENRES_A_FAIRE[x.genre])), details.length ? h("span", null, details.join(", ")) : null),
      x.dernier_message ? h("span", { class: "wa-conv-apercu" }, x.dernier_message) : null
    )
  );
}

// La colonne de la liste quand le filtre « À faire » est choisi. `idOuvert` : la conversation affichée à droite.
export function listeAFaire(r, { entites = [], idOuvert = "" } = {}) {
  const commenter = entites.some((e) => assistantDans(e.id))
    ? h("button", { type: "button", class: "secondaire petit wa-afaire-commenter", onclick: () => demanderCommentaire(entites) }, icone("assistant", 16), tr("Demander à l'assistant de commenter"))
    : null;
  if (!r.nombre) return h("div", { class: "wa-afaire-vide" }, h("p", { class: "aide wa-liste-vide" }, tr("Rien n'attend dans WhatsApp.")));
  return h(
    "div",
    { class: "wa-afaire-bloc" },
    h(
      "div",
      { class: "wa-afaire-tete" },
      h("p", { class: "aide" }, r.urgents ? pluriel(r.urgents, N_("{n} urgent, le plus pressé en haut."), N_("{n} urgents, les plus pressés en haut."), { n: r.urgents }) : tr("Trié par urgence.")),
      commenter
    ),
    h("ul", { class: "wa-conversations" }, r.elements.map((x) => ligne(x, !!idOuvert && x.conversation === idOuvert, entites))),
    r.tronque ? h("p", { class: "aide" }, tr("Les 30 plus urgents seulement.")) : null
  );
}
