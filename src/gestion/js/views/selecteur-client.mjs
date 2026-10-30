// Choix d'un client par recherche : on tape quelques lettres, on choisit dans une courte liste.
// Reste utilisable avec des milliers de clients, contrairement à une liste déroulante complète.
import { chercherClients, nomClient, etat } from "../etat.mjs";
import { h } from "../ui.mjs";
import { tr, pluriel, N_ } from "../i18n.mjs";

const resume = (c) => [(c.adresse || "").split("\n").pop(), c.telephone].filter(Boolean).join(" · ");

// Renvoie { noeud, valeur, nouveau } : `valeur` est l'identifiant du client choisi, `nouveau` vaut true si
// la personne a demandé à créer un client.
export function selecteurClient({ id = "client", libelle = tr("Client"), valeur = "", avecNouveau = false, surChangement = () => {} } = {}) {
  let choisi = valeur ? etat.db.clients.find((c) => c.id === valeur) || null : null;
  let nouveau = false;
  let resultats = [];
  let actif = -1;
  let sequence = 0;
  let minuteur = null;

  const saisie = h("input", { id, type: "text", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": `${id}-liste`, autocomplete: "off", placeholder: tr("Nom, téléphone, ville…") });
  const liste = h("ul", { id: `${id}-liste`, role: "listbox", class: "combo-liste", "aria-label": tr("Clients trouvés"), hidden: true });
  const etatLigne = h("p", { class: "aide", "aria-live": "polite" });
  const puce = h("div", { class: "combo-choisi" });

  const fermer = () => {
    liste.hidden = true;
    saisie.setAttribute("aria-expanded", "false");
    saisie.removeAttribute("aria-activedescendant");
    actif = -1;
  };

  const dessiner = (texte) => {
    const options = resultats.map((c, i) => h("li", { id: `${id}-o${i}`, role: "option", "aria-selected": i === actif ? "true" : "false", onmousedown: (e) => (e.preventDefault(), choisir(c)) }, h("strong", null, nomClient(c)), resume(c) ? h("span", { class: "sous-ligne" }, resume(c)) : null));
    const creer = avecNouveau ? h("li", { id: `${id}-nouveau`, role: "option", class: "combo-creer", "aria-selected": actif === resultats.length ? "true" : "false", onmousedown: (e) => (e.preventDefault(), creerNouveau()) }, texte.trim() ? tr("Créer un nouveau client « {trim} »", { trim: texte.trim() }) : tr("Créer un nouveau client")) : null;
    liste.replaceChildren(...options, creer);
    if (!options.length && !creer) liste.replaceChildren(h("li", { class: "combo-vide", role: "presentation" }, tr("Aucun client trouvé.")));
    liste.hidden = false;
    saisie.setAttribute("aria-expanded", "true");
    etatLigne.textContent = texte.trim() ? pluriel(resultats.length, N_("{n} client trouvé."), N_("{n} clients trouvés.")) : tr("Clients récents. Tapez pour chercher parmi tous les clients.");
  };

  const total = () => resultats.length + (avecNouveau ? 1 : 0);
  const marquerActif = () => {
    for (const li of liste.querySelectorAll('[role="option"]')) li.setAttribute("aria-selected", "false");
    const li = liste.querySelectorAll('[role="option"]')[actif];
    if (li) {
      li.setAttribute("aria-selected", "true");
      li.scrollIntoView({ block: "nearest" });
      saisie.setAttribute("aria-activedescendant", li.id);
    }
  };

  const chercher = async () => {
    const q = saisie.value;
    const mien = ++sequence;
    const r = await chercherClients(q, 8);
    if (mien !== sequence) return; // une recherche plus récente a pris le relais
    resultats = r;
    actif = q.trim() && r.length ? 0 : -1;
    dessiner(q);
    marquerActif();
  };

  const majPuce = () => {
    puce.replaceChildren(
      choisi
        ? h("p", null, h("strong", null, nomClient(choisi)), resume(choisi) ? h("span", { class: "sous-ligne" }, resume(choisi)) : null)
        : nouveau
          ? h("p", null, h("strong", null, tr("Nouveau client")), h("span", { class: "sous-ligne" }, tr("Renseignez ses coordonnées ci-dessous.")))
          : null,
      choisi || nouveau ? h("button", { class: "lien", type: "button", onclick: () => effacer() }, tr("Changer")) : null
    );
    puce.hidden = !(choisi || nouveau);
    saisie.hidden = !!(choisi || nouveau);
    etatLigne.hidden = !!(choisi || nouveau);
  };

  function choisir(c) {
    choisi = c;
    nouveau = false;
    fermer();
    majPuce();
    surChangement();
  }
  function creerNouveau() {
    choisi = null;
    nouveau = true;
    fermer();
    majPuce();
    surChangement();
  }
  function effacer() {
    choisi = null;
    nouveau = false;
    saisie.value = "";
    majPuce();
    surChangement();
    saisie.focus();
  }

  saisie.addEventListener("input", () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(chercher, 120);
  });
  saisie.addEventListener("focus", chercher);
  saisie.addEventListener("blur", () => setTimeout(fermer, 120));
  saisie.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (liste.hidden) return chercher();
      const n = total();
      if (!n) return;
      actif = e.key === "ArrowDown" ? (actif + 1) % n : (actif - 1 + n) % n;
      marquerActif();
    } else if (e.key === "Enter" && !liste.hidden && actif >= 0) {
      e.preventDefault();
      if (actif < resultats.length) choisir(resultats[actif]);
      else creerNouveau();
    } else if (e.key === "Escape" && !liste.hidden) {
      e.stopPropagation();
      fermer();
    }
  });

  const noeud = h("div", { class: "champ combo" }, h("label", { for: id }, libelle), puce, saisie, liste, etatLigne);
  majPuce();
  return {
    noeud,
    get valeur() {
      return choisi ? choisi.id : "";
    },
    get nouveau() {
      return nouveau;
    },
  };
}
