// Cartes « Voucher » de l'Assistant (21.11.2026, « L'Assistant donne les vouchers ») : ce que rend trouver_vouchers (agent-vouchers.mjs)
// devient une carte par dossier, une ligne par service. Chaque ligne montre l'aperçu du voucher en image, fabriqué ici dans le navigateur
// par le rendu habituel (voucher.mjs, renderVoucher ; voucher-envoi.mjs, imageDuRendu), et porte le bouton d'envoi habituel (envoyerVoucher :
// WhatsApp depuis le téléphone avec le message prêt), avec télécharger et copier à côté. Rien ne part sans un clic, aucun appel à l'IA.
//
// Chaque entreprise garde son modèle : le voucher de Secret, la Booking confirmation de Taxi. Un service de l'autre entreprise (espace unifié)
// se rend dans son entreprise, d'un trait et sans attendre, puis l'écran revient ; l'envoi s'y ouvre par ouvrirDansEntreprise, avec retour
// synchrone à la fermeture de la fenêtre. Mêmes droits que l'écran Réservations et le bouton voucher (vouchersPermis) : Secret ou Taxi,
// lire les dossiers, jamais « vouchers.seul » (l'écran thaï de Mook reste à part). Un voucher pas encore prêt dit ce qui manque.
import { etat, changerEntite, permissionsDe, reglagesDe, entitesAccessibles, nomClient } from "../etat.mjs";
import { h, icone, toast } from "../ui.mjs";
import { tr, langueActive } from "../i18n.mjs";
import { groupesVouchers, reservationDeRef, vouchersPermis } from "../agent-vouchers.mjs";
import { estBookingConfirmation } from "../taxi-calc.mjs";
import { controlesVoucher, nomFichierVoucher, numeroVoucher } from "../operations-calc.mjs";
import { ouvrirDansEntreprise, marqueUnifiee, LIBELLES_MARQUES } from "../espace-unifie-calc.mjs";
import { dansEntreprise, parEntreprise, cleImage } from "../agent-cartes-voucher-calc.mjs";

const modules = () => Promise.all([import("./voucher.mjs"), import("./voucher-envoi.mjs"), import("./partage.mjs")]);
const changerSansNaviguer = (id) => etat.entiteId !== id && changerEntite(id, { naviguer: false });

// Lire ou rendre dans l'entreprise `id`, d'un trait, puis revenir (agent-cartes-voucher-calc.mjs : bascule dans le `try`, voucherDepuis gardé).
const dans = (id, fn) => dansEntreprise(etat, (x) => changerEntite(x, { naviguer: false }), id, fn);

// Les images déjà faites pendant la visite (cleImage : réservation, client, dossier, en-tête et logo) : un fil redessiné ne refait pas le
// travail. Les aperçus en attente gardent leur observateur, relâché quand l'aperçu a quitté la page.
const images = new Map();
const observateurs = new Set();
const relacher = () => {
  for (const o of observateurs) if (!o.cible.isConnected) (o.vue.disconnect(), observateurs.delete(o));
};
// Une image à la fois (html2canvas est lourd sur un téléphone).
let file = Promise.resolve();
const aLaSuite = (fn) => (file = file.then(fn, fn));

const jourCourt = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(langueActive() === "en" ? "en-GB" : "fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "");

// Ce que l'écran relit d'une ligne du résultat, dans son entreprise : la réservation chargée, son dossier, son client, son voucher rendu et
// ce qui manque. Revue de sécurité de la PR 303 : rien du fil (texte écrit par l'agent) ne s'affiche, seulement ces données relues.
function relire(r, { renderVoucher, vouchersDuDossier }) {
  const ent = r.entite_id;
  const d = etat.db.dossiers.find((y) => y.id === r.dossier_id) || null;
  if (!d) return null;
  const client = etat.db.clients.find((c) => c.id === d.client_id) || {};
  const x = vouchersDuDossier(r.dossier_id).find((v) => v.reservation.id === r.id) || null;
  if (!x) return { r, ent, dossier: d, client, sansVoucher: true };
  const booking = estBookingConfirmation(r, x.type, etat.db.reglages);
  return { r, ent, dossier: d, client, booking, cle: cleImage({ reservation: r, client, dossier: d, reglages: etat.db.reglages }), manque: controlesVoucher(r, client, x.type || ""), noeud: renderVoucher(x), nom: nomFichierVoucher(x.numero || numeroVoucher(d.ref || "", x.index), nomClient(client), { taxi: booking }) };
}
// Toutes les lignes d'un résultat : les références retrouvées parmi les réservations chargées, les droits de l'écran contrôlés, puis une
// seule bascule par entreprise. Rend { lus (dans l'ordre du résultat), absents (nombre de lignes qui ne se relisent pas) }.
function relireTout(lignes, voucher) {
  const trouvees = [];
  let absents = 0;
  for (const l of lignes) {
    const r = reservationDeRef(l.reservation, (etat.brut && etat.brut.reservations) || [], l.date);
    if (!r) absents++;
    else if (vouchersPermis({ fonctionnement: reglagesDe(r.entite_id).fonctionnement, permissions: permissionsDe(r.entite_id) }) && !trouvees.some((x) => x.r.id === r.id)) trouvees.push({ r, ent: r.entite_id });
  }
  const lus = new Map();
  for (const { ent, liste } of parEntreprise(trouvees)) dans(ent, () => liste.forEach((x) => lus.set(x.r.id, relire(x.r, voucher))));
  const ordre = trouvees.map((x) => lus.get(x.r.id)).filter(Boolean);
  return { lus: ordre, absents: absents + trouvees.length - ordre.length };
}

// L'écran d'envoi habituel, dans l'entreprise du service ; retour à celle de la conversation quand la fenêtre se ferme.
function envoyer(v) {
  return ouvrirDansEntreprise({
    id: v.ent,
    origine: etat.entiteId,
    changer: changerSansNaviguer,
    charger: modules,
    ouvrir: ([{ vouchersDuDossier }, { envoyerVoucher }], revenir) => {
      const x = vouchersDuDossier(v.r.dossier_id).find((y) => y.reservation.id === v.r.id);
      if (!x) return void toast(tr("Ce dossier n'a pas encore de service à mettre sur un voucher."), true), false;
      envoyerVoucher(x, { avantNavigation: revenir });
      return true;
    },
  });
}

function ligneService(v, { imageDuRendu, AVERTISSEMENTS }, { moyen, enregistrer, copierImage }) {
  const titre = h("p", { class: "agent-voucher-titre" }, h("strong", null, v.r.libelle || ""), h("small", null, [jourCourt(v.r.date_service), v.r.heure_pickup ? tr("pickup {h}", { h: v.r.heure_pickup }) : ""].filter(Boolean).join(", ")));
  if (v.sansVoucher) return h("div", { class: "agent-voucher-service" }, titre, h("p", { class: "aide" }, tr("Pas de voucher")));
  const alt = v.booking ? tr("Booking confirmation") : tr("Voucher");
  const apercu = h("button", { type: "button", class: "agent-voucher-apercu", "aria-label": v.booking ? tr("Envoyer la Booking confirmation") : tr("Envoyer le voucher"), onclick: () => envoyer(v) }, h("span", { class: "aide" }, tr("Préparation de l'image…")));
  const telecharger = h("button", { class: "secondaire", type: "button", disabled: true }, tr("Télécharger l'image"));
  const copier = h("button", { class: "secondaire", type: "button", hidden: true }, tr("Copier l'image"));
  const actions = h(
    "div",
    { class: "actions gauche" },
    h("button", { class: "principal", type: "button", onclick: () => envoyer(v) }, icone("whatsapp", 18), v.booking ? tr("Envoyer la Booking confirmation") : tr("Envoyer le voucher")),
    telecharger,
    copier
  );
  const cle = v.cle;
  const montrer = (blob) => {
    const fichier = new File([blob], v.nom, { type: "image/png" });
    // L'adresse de l'image est rendue dès qu'elle est affichée : l'image reste à l'écran, la mémoire est libérée.
    const url = URL.createObjectURL(blob);
    const img = h("img", { src: url, alt });
    img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
    img.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
    apercu.replaceChildren(img);
    telecharger.disabled = false;
    telecharger.onclick = () => enregistrer([fichier]);
    if (moyen([fichier]) === "ordinateur") {
      copier.hidden = false;
      copier.onclick = async () => toast((await copierImage(fichier)).ok ? tr("Image copiée : collez-la dans WhatsApp.") : tr("Copie impossible : téléchargez l'image."), false);
    }
  };
  const faire = () =>
    aLaSuite(async () => {
      if (!apercu.isConnected) return;
      try {
        const blob = images.get(cle) || (await imageDuRendu(v.noeud));
        images.set(cle, blob);
        montrer(blob);
      } catch (err) {
        apercu.replaceChildren(h("span", { class: "erreur-form", role: "alert" }, tr("L'image n'a pas pu être fabriquée : {message}", { message: err.message })));
      }
    });
  // L'image ne se fait qu'une fois la carte à l'écran (un long fil n'en fabrique pas vingt d'un coup).
  if (images.has(cle)) requestAnimationFrame(() => montrer(images.get(cle)));
  else if (typeof IntersectionObserver === "function") {
    const suivi = { cible: apercu, vue: null };
    suivi.vue = new IntersectionObserver((entrees) => {
      if (!apercu.isConnected) return void (suivi.vue.disconnect(), observateurs.delete(suivi));
      if (!entrees.some((e) => e.isIntersecting)) return;
      suivi.vue.disconnect();
      observateurs.delete(suivi);
      faire();
    });
    observateurs.add(suivi);
    requestAnimationFrame(() => (apercu.isConnected ? suivi.vue.observe(apercu) : (suivi.vue.disconnect(), observateurs.delete(suivi))));
  } else requestAnimationFrame(faire);
  return h(
    "div",
    { class: "agent-voucher-service" },
    titre,
    v.manque.length ? h("ul", { class: "bandeau-info avertissements-voucher", role: "status" }, v.manque.map((c) => h("li", null, tr(AVERTISSEMENTS[c])))) : null,
    apercu,
    actions
  );
}

// Une carte par dossier relu ; son en-tête ne vient que des données relues (client, dossier, entreprise).
function carte(lus, mods) {
  const [, envoi, partage] = mods;
  const { ent, dossier, client } = lus[0];
  const tousBooking = lus.every((v) => v.booking);
  const genre = tousBooking ? tr("Booking confirmation") : lus.length > 1 ? tr("Vouchers") : tr("Voucher");
  const nom = client && (client.prenom || client.nom) ? nomClient(client) : "";
  const entites = entitesAccessibles();
  const entreprise = entites.find((e) => e.id === ent) || null;
  // Espace unifié : le badge Secret ou Taxi, quand la personne voit aussi l'autre entreprise.
  const marque = marqueUnifiee(entreprise);
  const badge = marque && entites.some((e) => e.id !== ent && marqueUnifiee(e) && marqueUnifiee(e) !== marque) ? h("span", { class: `agent-badge-entreprise ${marque}` }, LIBELLES_MARQUES[marque] || entreprise.nom) : null;
  return h(
    "article",
    { class: "agent-carte agent-voucher", "data-vouchers": dossier.id },
    h("header", null, h("span", { class: "agent-carte-genre" }, genre), h("h3", null, [nom, dossier.ref].filter(Boolean).join(" · ")), badge),
    ...lus.map((v) => ligneService(v, envoi, partage)),
    h("p", { class: "agent-suite-liens" }, h("a", { href: `#/dossier/${dossier.id}${ent && ent !== etat.entiteId ? `?entite=${ent}` : ""}` }, tr("Ouvrir le dossier {ref}", { ref: dossier.ref || "" })))
  );
}

// Les cartes d'un résultat de trouver_vouchers. Rend tout de suite un conteneur ; les cartes s'y dessinent dès que le rendu des vouchers est
// chargé. Une ligne que la personne ne peut pas lire ici (droits de l'écran) n'est pas montrée ; une ligne qui ne se relit pas donne un
// message générique, sans aucun champ du résultat. Une carte n'existe que si au moins une ligne se relit.
export function cartesVouchers(resultat) {
  const zone = h("div", { class: "agent-vouchers" });
  relacher();
  const lignes = groupesVouchers(resultat).flatMap((g) => g.reservations);
  if (!lignes.length) return zone;
  modules()
    .then((mods) => {
      const [voucher] = mods;
      const { lus, absents } = relireTout(lignes, voucher);
      const parDossier = new Map();
      for (const v of lus) parDossier.set(v.dossier.id, [...(parDossier.get(v.dossier.id) || []), v]);
      zone.replaceChildren(...[...parDossier.values()].map((l) => carte(l, mods)), absents ? h("p", { class: "aide" }, tr("Un service de ce résultat n'est pas chargé sur cet appareil : rechargez la page pour voir son voucher.")) : null);
    })
    .catch((err) => zone.replaceChildren(h("p", { class: "agent-erreur", role: "alert" }, tr("L'image n'a pas pu être fabriquée : {message}", { message: err.message }))));
  return zone;
}
