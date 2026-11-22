// Bouton « Pas bien » sous chaque réponse de l'Assistant (22.11.2026, migration 74). La personne dit en quelques mots ce qui ne va pas
// (200 caractères au plus) : la raison, un extrait masqué de la réponse et son contexte deviennent un apprentissage « retour » de
// l'entreprise, relu par l'agent aux conversations suivantes (« Nani a jugé cette réponse mauvaise : … », prompt.js).
// Seulement pour qui a le droit d'écrire un apprentissage (« dossiers.ecrire » et « partenaires.lire » dans l'entreprise, comme la base) :
// pas pour Mook. Les noms du client et du contact, téléphones, e-mails, liens et IBAN sont masqués ; une phrase qui parle de net, de
// commission ou de banque ne part pas (agent-apprendre-texte.mjs, ligneRetour).
import { etat, permissionsDe } from "../etat.mjs";
import { h } from "../ui.mjs";
import { tr, N_ } from "../i18n.mjs";
import { anonymiser, ligneRetour, propre, rangerMontants, RETOUR_MAX } from "../agent-apprendre-texte.mjs";
import { formatMontant } from "../calc.mjs";

export const peutJugerReponse = (entiteId) => {
  const p = (entiteId && permissionsDe(entiteId)) || [];
  return p.includes("dossiers.ecrire") && p.includes("partenaires.lire");
};

const ERREURS = {
  vide: N_("Dites en quelques mots ce qui ne va pas."),
  longue: N_("200 caractères au plus."),
  interne: N_("La raison ne peut pas parler de net, de commission ni de banque : l'assistant la relira."),
};

// Les réponses déjà jugées pendant cette visite : le fil se redessine souvent, le bouton ne revient pas.
const jugees = new Set();
const cleDe = (entiteId, carteId, reponse) => `${entiteId}:${carteId || ""}:${String(reponse || "").slice(0, 300)}`;
const note = (interne = false) => h("p", { class: "aide agent-avis-note", role: "status" }, interne ? tr("Noté comme interne : visible dans le suivi, jamais relu par l'assistant.") : tr("Noté : l'assistant s'en servira la prochaine fois."));

// `reponse` : le texte jugé ; `contexte` : ce qu'elle était (« réponse au client… » est relu aussi par la boîte WhatsApp) ; `masques()` :
// { noms, entiers }, les noms du client (mot par mot) et des partenaires (en entier), lus au moment de noter ; `prix()` : { ventes, nets },
// les prix de vente connus et les nets connus (null sans le droit de voir les nets) ; `sansMontants` : l'extrait perd toute phrase avec un
// montant (réponse de l'agent à l'équipe) ; `carteId` : la carte jugée, s'il y en a une. Rend null sans le droit.
// Les montants de la raison, au moment du clic (demande de Jérémy, 22.11.2026) : un prix de vente connu reste ; un net connu devient
// {montant} (aussi s'il est en même temps un prix de vente) ; un montant connu nulle part fait poser la question « Ce montant est : » dans
// la même petite zone, « prix pour le client » (la raison reste) ou « prix d'achat (interne) » (ligne interne, montants masqués, jamais
// dans un prompt).
export function boutonPasBien({ entiteId, reponse = "", contexte = "", masques = () => ({ noms: [], entiers: [] }), prix = () => ({ ventes: new Set(), nets: null }), carteId = null, sansMontants = false }) {
  if (!peutJugerReponse(entiteId)) return null;
  const cle = cleDe(entiteId, carteId, reponse);
  const zone = h("div", { class: "agent-avis" });
  if (jugees.has(cle)) return (zone.append(note()), zone);
  const bouton = h("button", { class: "lien agent-avis-bouton", type: "button", onclick: () => ouvrir() }, tr("Pas bien"));
  zone.append(bouton);
  function ouvrir() {
    const champ = h("input", { type: "text", class: "agent-avis-raison", maxlength: RETOUR_MAX, autocomplete: "off", enterkeyhint: "send", placeholder: tr("Ce qui ne va pas, en quelques mots"), "aria-label": tr("Ce qui ne va pas dans cette réponse") });
    const erreur = h("p", { class: "erreur", role: "alert" });
    const noter = h("button", { class: "secondaire petit", type: "submit" }, tr("Noter"));
    const enregistrer = async (raison, { masquer, interne }, retour) => {
      const m = masques() || {};
      const r = ligneRetour({ reponse, raison, contexte, noms: m.noms || [], entiers: m.entiers || [], sansMontants, masquer, interne });
      if (r.erreur) return void retour(tr(ERREURS[r.erreur]));
      const fait = await etat.store.agentNoterApprentissages(entiteId, carteId, [r.ligne]).catch(() => false);
      if (!fait) return void retour(tr("Retour non noté : réessayez plus tard."));
      jugees.add(cle);
      zone.replaceChildren(note(!!interne));
    };
    const form = h(
      "form",
      {
        class: "agent-avis-form",
        onsubmit: async (e) => {
          e.preventDefault();
          erreur.textContent = "";
          // Resserrée d'abord (« 1  200 » devient « 1 200 ») : le rangement voit le texte que la ligne gardera.
          const raison = propre(champ.value);
          const m = masques() || {};
          // Les erreurs simples d'abord (vide, trop longue, net ou banque), avant toute question.
          const essai = ligneRetour({ reponse: "", raison, contexte: "", noms: m.noms || [], entiers: m.entiers || [] });
          if (essai.erreur) return void (erreur.textContent = tr(ERREURS[essai.erreur]));
          const rang = rangerMontants(anonymiser(raison, m.noms || [], m.entiers || []), prix() || {});
          noter.disabled = true;
          const retour = (msg) => {
            noter.disabled = false;
            zone.replaceChildren(form);
            erreur.textContent = msg;
          };
          if (!rang.inconnus.length) return enregistrer(raison, { masquer: rang.nets, interne: false }, retour);
          zone.replaceChildren(question(rang.inconnus, (interne) => enregistrer(raison, { masquer: rang.nets, interne }, retour), () => retour("")));
        },
      },
      champ,
      noter,
      h("button", { class: "lien", type: "button", onclick: () => zone.replaceChildren(bouton) }, tr("Annuler")),
      erreur
    );
    zone.replaceChildren(form);
    champ.focus();
  }
  return zone;
}

// La question sur un montant connu nulle part, dans la zone du bouton.
function question(montants, choisir, annuler) {
  // Un seul choix : le premier clic désactive les trois boutons (jamais deux lignes, une publique et une interne, pour la même raison).
  const tous = () => boutons;
  const une = (fn) => () => {
    if (tous().some((b) => b.disabled)) return;
    for (const b of tous()) b.disabled = true;
    fn();
  };
  const boutons = [
    h("button", { class: "secondaire petit", type: "button", onclick: une(() => choisir(false)) }, tr("prix pour le client")),
    h("button", { class: "secondaire petit", type: "button", onclick: une(() => choisir(true)) }, tr("prix d'achat (interne)")),
    h("button", { class: "lien", type: "button", onclick: une(annuler) }, tr("Annuler")),
  ];
  return h(
    "div",
    { class: "agent-avis-question", role: "group", "aria-label": tr("Ce montant est :") },
    h("p", null, montants.length > 1 ? tr("Ces montants sont : {liste}", { liste: montants.map((m) => formatMontant(m)).join(", ") }) : tr("Ce montant est : {liste}", { liste: formatMontant(montants[0]) })),
    h("div", { class: "agent-avis-choix" }, ...boutons)
  );
}
