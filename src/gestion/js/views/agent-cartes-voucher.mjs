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

const modules = () => Promise.all([import("./voucher.mjs"), import("./voucher-envoi.mjs"), import("./partage.mjs")]);
const changerSansNaviguer = (id) => etat.entiteId !== id && changerEntite(id, { naviguer: false });

// Lire ou rendre dans l'entreprise `id`, d'un trait (rien d'asynchrone dedans), puis revenir.
function dans(id, fn) {
  const origine = etat.entiteId;
  if (!id || id === origine) return fn();
  changerEntite(id, { naviguer: false });
  try {
    return fn();
  } finally {
    if (etat.entiteId !== origine) changerEntite(origine, { naviguer: false });
  }
}

// Les images déjà faites pendant la visite, par réservation et version : un fil redessiné ne refait pas le travail.
const images = new Map();
// Une image à la fois (html2canvas est lourd sur un téléphone).
let file = Promise.resolve();
const aLaSuite = (fn) => (file = file.then(fn, fn));

const jourCourt = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(langueActive() === "en" ? "en-GB" : "fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "");

// Ce que l'écran sait d'une ligne du résultat : la réservation chargée, son voucher rendu dans son entreprise, ce qui manque.
function lireLigne(l, { renderVoucher, vouchersDuDossier }) {
  const r = reservationDeRef(l.reservation, (etat.brut && etat.brut.reservations) || [], l.date);
  if (!r) return { ligne: l, absent: true };
  const ent = r.entite_id;
  if (!vouchersPermis({ fonctionnement: reglagesDe(ent).fonctionnement, permissions: permissionsDe(ent) })) return null;
  return dans(ent, () => {
    const d = etat.db.dossiers.find((y) => y.id === r.dossier_id) || {};
    const client = etat.db.clients.find((c) => c.id === d.client_id) || {};
    const x = vouchersDuDossier(r.dossier_id).find((v) => v.reservation.id === r.id) || null;
    if (!x) return { ligne: l, r, ent, dossier: d, client, sansVoucher: true };
    const booking = estBookingConfirmation(r, x.type, etat.db.reglages);
    return { ligne: l, r, ent, dossier: d, client, booking, manque: controlesVoucher(r, client, x.type || ""), noeud: renderVoucher(x), nom: nomFichierVoucher(x.numero || numeroVoucher(d.ref || "", x.index), nomClient(client), { taxi: booking }) };
  });
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
  const l = v.ligne;
  const titre = h("p", { class: "agent-voucher-titre" }, h("strong", null, (v.r && v.r.libelle) || l.service), h("small", null, [jourCourt(l.date), l.heure_pickup ? tr("pickup {h}", { h: l.heure_pickup }) : ""].filter(Boolean).join(", ")));
  if (v.absent) return h("div", { class: "agent-voucher-service" }, titre, h("p", { class: "aide" }, tr("Ce service n'est pas encore chargé sur cet appareil : rechargez la page pour voir son voucher.")));
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
  const cle = `${v.r.id}|${v.r.updated_at || ""}|${(v.r.details && v.r.details.voucher_fige && v.r.details.voucher_fige.empreinte) || ""}`;
  const montrer = (blob) => {
    const fichier = new File([blob], v.nom, { type: "image/png" });
    apercu.replaceChildren(h("img", { src: URL.createObjectURL(blob), alt }));
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
    const vue = new IntersectionObserver((entrees) => {
      if (!entrees.some((e) => e.isIntersecting)) return;
      vue.disconnect();
      faire();
    });
    requestAnimationFrame(() => vue.observe(apercu));
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

function carte(g, lus, mods) {
  const [, envoi, partage] = mods;
  const premier = lus.find((v) => v.r) || null;
  const ent = premier ? premier.ent : null;
  const tousBooking = lus.length > 0 && lus.every((v) => v.booking);
  const genre = tousBooking ? tr("Booking confirmation") : lus.length > 1 ? tr("Vouchers") : tr("Voucher");
  const nom = premier && premier.client && (premier.client.prenom || premier.client.nom) ? nomClient(premier.client) : g.client;
  const reference = (premier && premier.dossier && premier.dossier.ref) || g.reference;
  const entreprise = ent ? entitesAccessibles().find((e) => e.id === ent) : null;
  // Espace unifié : le badge Secret ou Taxi de la carte.
  const badge = g.entreprise && entreprise ? h("span", { class: `agent-badge-entreprise ${marqueUnifiee(entreprise) || ""}` }, LIBELLES_MARQUES[marqueUnifiee(entreprise)] || entreprise.nom) : null;
  const dossierId = premier && premier.r ? premier.r.dossier_id : null;
  return h(
    "article",
    { class: "agent-carte agent-voucher", "data-vouchers": g.dossier },
    h("header", null, h("span", { class: "agent-carte-genre" }, genre), h("h3", null, [nom, reference].filter(Boolean).join(" · ")), badge),
    ...lus.map((v) => ligneService(v, envoi, partage)),
    dossierId ? h("p", { class: "agent-suite-liens" }, h("a", { href: `#/dossier/${dossierId}${ent && ent !== etat.entiteId ? `?entite=${ent}` : ""}` }, tr("Ouvrir le dossier {ref}", { ref: reference || "" }))) : null
  );
}

// Les cartes d'un résultat de trouver_vouchers. Rend tout de suite un conteneur ; les cartes s'y dessinent dès que le rendu des vouchers est
// chargé. Une ligne que la personne ne peut pas lire ici (droits de l'écran) n'est pas montrée.
export function cartesVouchers(resultat) {
  const zone = h("div", { class: "agent-vouchers" });
  const groupes = groupesVouchers(resultat);
  if (!groupes.length) return zone;
  modules()
    .then((mods) => {
      const [voucher] = mods;
      const cartes = groupes
        .map((g) => ({ g, lus: g.reservations.map((l) => lireLigne(l, voucher)).filter(Boolean) }))
        .filter((x) => x.lus.length)
        .map(({ g, lus }) => carte(g, lus, mods));
      zone.replaceChildren(...cartes);
    })
    .catch((err) => zone.replaceChildren(h("p", { class: "agent-erreur", role: "alert" }, tr("L'image n'a pas pu être fabriquée : {message}", { message: err.message }))));
  return zone;
}
