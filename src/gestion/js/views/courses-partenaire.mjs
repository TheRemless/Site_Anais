// Écran du partenaire chauffeur (22.11.2026, migration 115), en thaï : Mr. Brown voit ses courses de VIP Taxi Lanta, jour par jour, et saisit
// sur chacune la commission qu'il doit à Nani. Le total dû est en tête. Un seul champ par course, gros caractères, prévu pour un téléphone.
// Rien d'autre : ni menu, ni entreprise, ni réglages. Les données viennent des fonctions de la base (store : partenaireCourses,
// partenaireSaisirCommission), jamais des tables. Logique et textes : courses-partenaire-calc.mjs.
import { etat } from "../etat.mjs";
import { h, vider } from "../ui.mjs";
import { aujourdhui } from "../calc.mjs";
import { TH, parJour, totalDu, montantTh, personnesTh, destinationTh, lireMontant, erreurMontant, verrouillee, resteDu, posee_par_equipe, suivreRetour } from "../courses-partenaire-calc.mjs";

const telLien = (t) => `tel:${String(t || "").replace(/[^\d+]/g, "")}`;

export function vueCoursesPartenaire({ acces, demo = null, deconnecter = null }) {
  const devise = acces.devise || "THB";
  let courses = [];
  const totalValeur = h("strong", { class: "cp-total-montant" }, "");
  const liste = h("div", { class: "cp-liste", "aria-live": "polite" }, h("p", { class: "cp-vide" }, TH.chargement));
  const majTotal = () => (totalValeur.textContent = montantTh(totalDu(courses), devise));

  const ligne = (libelle, valeur, extra = {}) => (valeur ? h("div", { class: "cp-ligne" }, h("dt", null, libelle), h("dd", extra, valeur)) : null);

  const carte = (c) => {
    const li = h("li", { class: "cp-course", "data-reservation": c.id });
    const rendre = (message = null, erreur = false) => {
      const bloque = verrouillee(c);
      const champ = h("input", { id: `cp-${c.id}`, class: "cp-champ", inputmode: "decimal", autocomplete: "off", enterkeyhint: "done", value: c.commission === null || c.commission === undefined ? "" : String(Number(c.commission)), disabled: bloque, "aria-describedby": `cp-msg-${c.id}` });
      const bouton = h("button", { class: "principal cp-bouton", type: "submit", disabled: bloque }, TH.enregistrer);
      const msg = h("p", { id: `cp-msg-${c.id}`, class: erreur ? "cp-msg erreur" : "cp-msg", role: erreur ? "alert" : "status" }, message || "");
      const envoyer = async (e) => {
        e.preventDefault();
        const montant = lireMontant(champ.value);
        const err = erreurMontant(c, montant);
        if (err) return rendre(err, true), li.querySelector("input")?.focus();
        bouton.disabled = true;
        bouton.textContent = TH.en_cours;
        try {
          await etat.store.partenaireSaisirCommission(c.id, montant);
          c.commission = montant;
          majTotal();
          c.par_moi = montant !== null;
          rendre(`${TH.enregistre} ✓`);
        } catch (x) {
          const m = String((x && x.message) || "");
          rendre(/payée/.test(m) ? TH.erreur_payee : /équipe/.test(m) ? TH.posee_equipe : /prix/.test(m) ? TH.erreur_trop : /nul/.test(m) ? TH.erreur_zero : /négatif|décimales/.test(m) ? TH.erreur_montant : TH.erreur_reseau, true);
        }
      };
      const payee = c.reglee ? TH.payee : Number(c.commission_payee || 0) ? `${TH.payee_partie} · ${TH.reste} ${montantTh(resteDu(c), devise)}` : posee_par_equipe(c) ? TH.posee_equipe : null;
      vider(li).append(
        h("div", { class: "cp-tete" }, h("span", { class: "cp-heure" }, c.heure || "–"), h("span", { class: "cp-client" }, c.client)),
        h(
          "dl",
          { class: "cp-details" },
          ligne(TH.pickup, c.pickup),
          ligne(TH.dropoff, destinationTh(c)),
          ligne(TH.vol, c.vol, { class: "cp-vol" }),
          ligne(TH.personnes, personnesTh(c)),
          c.telephone ? h("div", { class: "cp-ligne" }, h("dt", null, TH.telephone), h("dd", null, h("a", { href: telLien(c.telephone), class: "cp-tel" }, c.telephone))) : null,
          ligne(TH.prix, montantTh(c.prix, devise), { class: "cp-prix" })
        ),
        h(
          "form",
          { class: "cp-form", onsubmit: envoyer, novalidate: true },
          h("label", { for: `cp-${c.id}`, class: "cp-libelle" }, `${TH.commission} (${devise === "THB" ? "บาท" : devise})`),
          h("div", { class: "cp-saisie" }, champ, bouton),
          payee ? h("p", { class: "cp-payee" }, payee) : null,
          msg
        )
      );
    };
    rendre();
    return li;
  };

  const jour = (b) =>
    h("section", { class: "cp-jour" }, h("h2", { class: "cp-titre-jour" }, b.titre), b.courses.length ? h("ul", { class: "cp-courses" }, b.courses.map(carte)) : h("p", { class: "cp-vide" }, TH.aucune_jour));

  const charger = async () => {
    try {
      courses = await etat.store.partenaireCourses();
    } catch {
      vider(liste).append(h("p", { class: "cp-vide erreur" }, TH.erreur_chargement), h("button", { class: "secondaire cp-bouton", type: "button", onclick: charger }, TH.reessayer));
      return;
    }
    majTotal();
    const { aVenir, passees } = parJour(courses, aujourdhui());
    vider(liste).append(...aVenir.map(jour));
    if (passees.length) liste.append(h("div", { class: "cp-passees" }, h("h2", { class: "cp-titre-bloc" }, TH.passees), passees.map(jour)));
  };

  const racine = h(
    "div",
    { class: "coque-partenaire", lang: "th", "data-titre": TH.titre },
    h(
      "header",
      { class: "cp-barre" },
      h("div", { class: "cp-qui" }, h("strong", null, acces.contact || acces.partenaire), h("span", null, acces.entreprise)),
      deconnecter ? h("button", { class: "secondaire petit", type: "button", onclick: deconnecter }, TH.deconnexion) : null
    ),
    h(
      "main",
      { id: "principal", class: "cp-contenu", tabindex: "-1" },
      demo,
      h("h1", { class: "cp-h1" }, TH.titre),
      h("div", { class: "cp-total" }, h("span", { class: "cp-total-libelle" }, TH.total), totalValeur, h("span", { class: "cp-total-aide" }, TH.total_aide)),
      liste
    )
  );
  // Revenir sur l'application (téléphone déverrouillé, onglet repris) relit ses courses, sauf pendant une saisie. L'écouteur est retiré
  // quand on quitte l'écran (racine.arreter, appelé par app.mjs) : il ne s'accumule pas d'un compte ou d'un affichage à l'autre.
  racine.arreter = suivreRetour(document, () => racine.isConnected && charger(), {
    saisieEnCours: () => !!document.activeElement && document.activeElement.tagName === "INPUT" && racine.contains(document.activeElement),
  });
  charger();
  return racine;
}
