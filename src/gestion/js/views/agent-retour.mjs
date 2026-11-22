// Bouton « Pas bien » sous chaque réponse de l'Assistant (22.11.2026, migration 74). La personne dit en quelques mots ce qui ne va pas
// (200 caractères au plus) : la raison, un extrait masqué de la réponse et son contexte deviennent un apprentissage « retour » de
// l'entreprise, relu par l'agent aux conversations suivantes (« Nani a jugé cette réponse mauvaise : … », prompt.js).
// Seulement pour qui a le droit d'écrire un apprentissage (« dossiers.ecrire » et « partenaires.lire » dans l'entreprise, comme la base) :
// pas pour Mook. Les noms du client et du contact, téléphones, e-mails, liens et IBAN sont masqués ; une phrase qui parle de net, de
// commission ou de banque ne part pas (agent-apprendre-texte.mjs, ligneRetour).
import { etat, permissionsDe } from "../etat.mjs";
import { h } from "../ui.mjs";
import { tr, N_ } from "../i18n.mjs";
import { ligneRetour, RETOUR_MAX } from "../agent-apprendre-texte.mjs";

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
const note = () => h("p", { class: "aide agent-avis-note", role: "status" }, tr("Noté : l'assistant s'en servira la prochaine fois."));

// `reponse` : le texte jugé ; `contexte` : ce qu'elle était (« réponse au client… » est relu aussi par la boîte WhatsApp) ;
// `sansMontants` : l'extrait perd toute phrase avec un montant (réponse de l'agent à l'équipe) ; `noms()` : les noms à masquer, lus au moment de noter ; `carteId` :
// la carte jugée, s'il y en a une. Rend null sans le droit.
export function boutonPasBien({ entiteId, reponse = "", contexte = "", noms = () => [], carteId = null, sansMontants = false }) {
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
    const form = h(
      "form",
      {
        class: "agent-avis-form",
        onsubmit: async (e) => {
          e.preventDefault();
          erreur.textContent = "";
          const r = ligneRetour({ reponse, raison: champ.value, contexte, noms: noms(), sansMontants });
          if (r.erreur) return void (erreur.textContent = tr(ERREURS[r.erreur]));
          noter.disabled = true;
          const fait = await etat.store.agentNoterApprentissages(entiteId, carteId, [r.ligne]).catch(() => false);
          if (!fait) {
            noter.disabled = false;
            return void (erreur.textContent = tr("Retour non noté : réessayez plus tard."));
          }
          jugees.add(cle);
          zone.replaceChildren(note());
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
