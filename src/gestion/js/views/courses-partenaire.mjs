// Écran du partenaire chauffeur (22.11.2026, migrations 115 et 116), en thaï : Mr. Brown voit ses courses de VIP Taxi Lanta, jour par jour, et saisit
// sur chacune la commission qu'il doit à Nani. Le total dû est en tête. Un seul champ par course, gros caractères, prévu pour un téléphone.
// Rien d'autre : ni menu, ni entreprise, ni réglages. Les données viennent des fonctions de la base (store : partenaireCourses,
// partenaireSaisirCommission), jamais des tables. Logique et textes : courses-partenaire-calc.mjs.
import { etat } from "../etat.mjs";
import { h, vider, icone } from "../ui.mjs";
import { aujourdhui } from "../calc.mjs";
import { situation, activer, desactiver, essai } from "../rappels.mjs";
import { TH, blocNotifTh, blocNotifEnHaut, parJour, totalDu, montantTh, lignesCourse, lireMontant, erreurMontant, verrouillee, resteDu, posee_par_equipe, suivreRetour } from "../courses-partenaire-calc.mjs";

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
      const lignes = lignesCourse(c, devise);
      const payee = c.reglee ? TH.payee : Number(c.commission_payee || 0) ? `${TH.payee_partie} · ${TH.reste} ${montantTh(resteDu(c), devise)}` : posee_par_equipe(c) ? TH.posee_equipe : null;
      vider(li).append(
        h("div", { class: "cp-tete" }, h("span", { class: "cp-heure" }, c.heure || "–"), h("span", { class: "cp-client" }, c.client)),
        // L'essentiel en gros (lieux, vol, personnes, bagages, véhicule, paiement), le téléphone, puis tout le reste de la réservation en dessous,
        // toujours visible (migration 116 : tout ce qu'imprime la Booking confirmation, pour le transmettre au chauffeur).
        h(
          "dl",
          { class: "cp-details" },
          lignes.essentiel.map((x) => ligne(x.libelle, x.valeur, { class: `cp-v-${x.cle}` })),
          c.telephone ? h("div", { class: "cp-ligne" }, h("dt", null, TH.telephone), h("dd", null, h("a", { href: telLien(c.telephone), class: "cp-tel" }, c.telephone))) : null
        ),
        lignes.details.length ? h("dl", { class: "cp-details cp-plus" }, lignes.details.map((x) => ligne(x.libelle, x.valeur, { class: `cp-v-${x.cle}` }))) : null,
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

  // Les notifications de ce téléphone (migration 123) : un bouton pour les activer, l'état « activées », ou ce qui les empêche (iPhone sans l'app
  // sur l'écran d'accueil). Même abonnement que les rappels des membres (rappels.mjs, abonner_rappels) ; les envois en thaï sont faits par la
  // fonction « rappels ». Couper est discret (lien, zone tactile de 44 px) et demande une confirmation en thaï.
  // Démonstration : rien ne s'abonne, l'état est seulement joué à l'écran (pour voir les deux états et la confirmation).
  const notif = h("section", { class: "cp-notif", "aria-live": "polite" });
  const enDemo = () => etat.store.mode !== "supabase";
  let sitDemo = "inactif";
  const relire = async () => (enDemo() ? sitDemo : situation(etat.store));
  // Où se montre le bloc (24.11.2026, Jérémy : « notifications activées » en haut tout le temps, c'est trop) : en haut de l'écran seulement tant
  // qu'il reste quelque chose à faire (pas encore activées, ou iPhone sans l'app sur l'écran d'accueil) ; sinon dans le menu « ตั้งค่า » de la barre.
  let sitCourante = "inactif";
  let menuOuvert = false;
  const enHaut = h("div", { class: "cp-notif-place" });
  const dansMenu = h("div", { class: "cp-menu-notif" });
  const placerNotif = () => {
    if (menuOuvert) dansMenu.append(notif);
    else if (blocNotifEnHaut(sitCourante)) enHaut.append(notif);
    else notif.remove();
  };
  const dessinerNotif = (sit, { message = "", erreur = false, occupe = false, confirmer = false } = {}) => {
    sitCourante = sit;
    const b = blocNotifTh(sit);
    const agir = async (couper) => {
      dessinerNotif(sit, { occupe: true });
      try {
        if (enDemo()) sitDemo = couper ? "inactif" : "actif";
        else if (couper) await desactiver(etat.store);
        else {
          await activer(etat.store);
          await essai({ titre: TH.notif_actives, corps: TH.notif_essai }).catch(() => {});
        }
        dessinerNotif(await relire(), { message: enDemo() ? TH.notif_demo : "" });
      } catch {
        let s2 = sit;
        try {
          s2 = await relire();
        } catch {
          /* on garde l'état affiché */
        }
        dessinerNotif(s2, { message: s2 === "refuse" ? "" : TH.notif_erreur, erreur: s2 !== "refuse" });
      }
    };
    const actif = b.etat === "actif";
    const boutons = !b.bouton
      ? null
      : !actif
        ? h("button", { class: "principal cp-bouton cp-notif-bouton", type: "button", disabled: occupe, onclick: () => agir(false) }, occupe ? TH.notif_en_cours : b.bouton)
        : confirmer
          ? h(
              "div",
              { class: "cp-notif-confirmer", role: "group", "aria-label": TH.notif_confirmer },
              h("p", { class: "cp-notif-question" }, TH.notif_confirmer),
              h(
                "div",
                { class: "cp-notif-choix" },
                h("button", { class: "secondaire cp-bouton", type: "button", onclick: () => agir(true) }, TH.notif_oui_couper),
                h("button", { class: "principal cp-bouton", type: "button", onclick: () => dessinerNotif(sit) }, TH.notif_garder)
              )
            )
          : h("button", { class: "cp-notif-lien", type: "button", disabled: occupe, onclick: () => dessinerNotif(sit, { confirmer: true }) }, b.bouton);
    // append() du DOM écrirait « null » : seuls les blocs présents sont ajoutés.
    vider(notif).append(
      ...[
        h("p", { class: `cp-notif-texte cp-notif-${b.etat}` }, actif ? `${b.texte} ✓` : b.texte),
        boutons,
        message ? h("p", { class: erreur ? "cp-msg erreur" : "cp-msg", role: erreur ? "alert" : "status" }, message) : null,
      ].filter(Boolean)
    );
    placerNotif();
    if (confirmer) notif.querySelector(".cp-notif-choix .principal")?.focus();
  };
  const lireNotif = async () => {
    try {
      dessinerNotif(await relire());
    } catch {
      dessinerNotif("indisponible");
    }
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

  // Le mini menu « ตั้งค่า » (réglages) : les notifications de ce téléphone et la déconnexion. Fermé par un second appui, Échap ou un appui
  // ailleurs ; le focus revient au bouton.
  const boutonMenu = h("button", { class: "cp-menu-bouton", type: "button", "aria-haspopup": "true", "aria-expanded": "false", "aria-controls": "cp-menu" }, icone("reglages", 20), h("span", null, TH.reglages));
  const menu = h(
    "div",
    { class: "cp-menu", id: "cp-menu", hidden: true },
    dansMenu,
    deconnecter ? h("button", { class: "secondaire cp-bouton cp-menu-sortir", type: "button", onclick: deconnecter }, TH.deconnexion) : null
  );
  const surAilleurs = (e) => {
    if (!menu.contains(e.target) && !boutonMenu.contains(e.target)) fermerMenu();
  };
  const surTouche = (e) => {
    if (e.key === "Escape") fermerMenu(true);
  };
  function fermerMenu(rendreFocus = false) {
    if (!menuOuvert) return;
    menuOuvert = false;
    menu.hidden = true;
    boutonMenu.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", surAilleurs, true);
    document.removeEventListener("keydown", surTouche);
    placerNotif();
    if (rendreFocus) boutonMenu.focus();
  }
  const ouvrirMenu = () => {
    menuOuvert = true;
    menu.hidden = false;
    boutonMenu.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", surAilleurs, true);
    document.addEventListener("keydown", surTouche);
    placerNotif();
  };
  boutonMenu.addEventListener("click", () => (menuOuvert ? fermerMenu() : ouvrirMenu()));

  const racine = h(
    "div",
    { class: "coque-partenaire", lang: "th", "data-titre": TH.titre },
    h("header", { class: "cp-barre" }, h("div", { class: "cp-qui" }, h("strong", null, acces.contact || acces.partenaire), h("span", null, acces.entreprise)), boutonMenu, menu),
    h(
      "main",
      { id: "principal", class: "cp-contenu", tabindex: "-1" },
      demo,
      h("h1", { class: "cp-h1" }, TH.titre),
      enHaut,
      h("div", { class: "cp-total" }, h("span", { class: "cp-total-libelle" }, TH.total), totalValeur, h("span", { class: "cp-total-aide" }, TH.total_aide)),
      liste
    )
  );
  // Revenir sur l'application (téléphone déverrouillé, onglet repris) relit ses courses, sauf pendant une saisie. L'écouteur est retiré
  // quand on quitte l'écran (racine.arreter, appelé par app.mjs) : il ne s'accumule pas d'un compte ou d'un affichage à l'autre.
  const arreterRetour = suivreRetour(document, () => racine.isConnected && charger(), {
    saisieEnCours: () => !!document.activeElement && document.activeElement.tagName === "INPUT" && racine.contains(document.activeElement),
  });
  racine.arreter = () => (fermerMenu(), arreterRetour());
  charger();
  lireNotif();
  return racine;
}
