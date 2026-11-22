// Point du soir (22.11.2026) : section de l'accueil à partir de 17h et écran #/soir (menu « Point du soir »). Logique dans
// point-soir-calc.mjs. Chaque entreprise garde ses éléments : l'écran lit l'entreprise ouverte (etat.db), ses vouchers (Booking
// confirmations chez Taxi) et sa langue client (anglais pour Secret et Taxi, français pour ZTP). Aucune notification, aucun envoi tout seul :
// chaque message part d'un geste de Nani, par la conversation WhatsApp (whatsapp-envoi, fenêtre de 24 h ouverte) ou par un lien wa.me.
import { etat, modifier, nomClient, peut, reglages, dossiersAnnules, moduleActif, modeTaxi, modeExcursions, organisation } from "../etat.mjs";
import { h, icone, toast, confirmer } from "../ui.mjs";
import { tr, N_, langueActive, pluriel } from "../i18n.mjs";
import { formatDate } from "../calc.mjs";
import { ajouterJours, personnesTexte, langueClient } from "../operations-calc.mjs";
import { dateDans, heureDans, FUSEAU_DEFAUT } from "../rappel-h1-calc.mjs";
import { fenetre, ERREURS_ENVOI, envoiIncertain, nomConversation } from "../whatsapp-calc.mjs";
import { lienWhatsApp as lienConversation } from "../agent-whatsapp-lecture.mjs";
import { pickupsDuJour, messagePickup, moyenEnvoi, fenetreDepuisConversation, detailsAvecAnnonce, annonceDe, envoisAFaire, sansReponse, lieuPickup, pointSoirVisible, nomsInterdits } from "../point-soir-calc.mjs";
import { lienDossier } from "./commun.mjs";
import { vouchersDuDossier } from "./voucher.mjs";
import { conversationPourVoucher, adminsWhatsApp } from "./voucher-whatsapp.mjs";
import { envoyerVoucher } from "./voucher-envoi.mjs";

const fuseau = () => (organisation() || {}).fuseau || FUSEAU_DEFAUT;
const RAISONS = {
  heure: N_("Heure de pickup à compléter : aucun message préparé."),
  lieu: N_("Lieu de pickup à compléter : aucun message préparé."),
  lieu_partenaire: N_("Le lieu de pickup porte le nom d'un partenaire : écrivez le message vous-même."),
};

// La section est-elle à l'accueil maintenant ? À partir de 17h, à l'heure de l'organisation.
export const pointSoirMaintenant = () => moduleActif("reservations") && pointSoirVisible(heureDans(fuseau()));

const noms = () => nomsInterdits({ partenaires: etat.brut.partenaires, conversations: etat.brut.whatsapp_conversations });
const whatsappEcrit = () => !!etat.brut && etat.brut.whatsapp_disponible === true && adminsWhatsApp().includes(etat.entiteId);
// Les messages lus pour la fenêtre de 24 h, gardés une minute : l'accueil se redessine souvent, une conversation n'est pas relue à chaque fois.
const DUREE_CACHE_MS = 60_000;
const cacheMessages = new Map();
function messagesRecents(id) {
  const x = cacheMessages.get(id);
  if (x && Date.now() - x.le < DUREE_CACHE_MS) return x.promesse;
  const promesse = etat.store.whatsappMessages(id);
  cacheMessages.set(id, { le: Date.now(), promesse });
  promesse.catch(() => cacheMessages.delete(id));
  return promesse;
}
const heureCourte = (iso) => new Date(iso).toLocaleTimeString(langueActive() === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: fuseau() });

async function noterAnnonce(r, par) {
  if (!peut("dossiers.ecrire")) return;
  const courante = etat.db.reservations.find((x) => x.id === r.id) || r;
  try {
    await modifier("reservations", r.id, { details: detailsAvecAnnonce(courante.details, { le: new Date().toISOString(), par }) });
  } catch (err) {
    toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
  }
}

const tagAnnonce = (a) => h("span", { class: "tag" }, a.par === "direct" ? tr("Message envoyé à {heure}", { heure: heureCourte(a.le) }) : tr("WhatsApp ouvert à {heure}", { heure: heureCourte(a.le) }));

// Les gestes d'un pickup, d'après le moyen d'envoi. `zone` est remplie une fois la fenêtre de 24 h connue.
function remplirGestes(zone, { r, texte, conversation, telephone, fen }) {
  const moyen = moyenEnvoi({ conversation, fenetre: fen, telephone, texte });
  const annonce = annonceDe(etat.db.reservations.find((x) => x.id === r.id) || r);
  const apres = (par) => {
    const a = { le: new Date().toISOString(), par };
    zone.querySelector(".tag")?.remove();
    zone.prepend(tagAnnonce(a));
  };
  const enfants = [annonce ? tagAnnonce(annonce) : null];
  if (!moyen) enfants.push(h("span", { class: "aide" }, tr("Aucun numéro de téléphone sur la fiche du client.")));
  else if (moyen.genre === "lien") {
    enfants.push(h("a", { class: `bouton ${annonce ? "secondaire" : "principal"} petit`, href: moyen.lien, target: "_blank", rel: "noopener", onclick: () => (noterAnnonce(r, "lien"), apres("lien")) }, icone("whatsapp", 16), tr("Ouvrir dans WhatsApp")));
  } else {
    const etatEnvoi = h("p", { class: "aide", role: "status", hidden: true });
    const bouton = h("button", { class: annonce ? "secondaire petit" : "principal petit", type: "button" }, icone("whatsapp", 16), tr("Envoyer sur WhatsApp"));
    bouton.addEventListener("click", async () => {
      // Déjà parti depuis Gestion : un nouvel envoi se confirme (whatsapp-envoi ne bloque le même texte qu'une minute).
      const deja = annonceDe(etat.db.reservations.find((x) => x.id === r.id) || r);
      if (deja && deja.par === "direct" && !(await confirmer(tr("Ce message est déjà parti à {heure}. L'envoyer de nouveau ?", { heure: heureCourte(deja.le) }), tr("Envoyer de nouveau")))) return;
      bouton.disabled = true;
      etatEnvoi.hidden = true;
      const res = await etat.store.whatsappEnvoyer({ conversation_id: moyen.conversation_id, texte });
      if (res && (res.ok || res.demo)) {
        await noterAnnonce(r, "direct");
        apres("direct");
        bouton.classList.replace("principal", "secondaire");
        bouton.disabled = false;
        toast(res.demo ? tr("En démo, rien ne part : le message serait envoyé dans la conversation WhatsApp.") : tr("Message envoyé dans la conversation WhatsApp."));
        return;
      }
      const code = (res && res.erreur) || "inconnu";
      // La fenêtre s'est fermée entre-temps : le lien wa.me prend la place du bouton.
      if (code === "fenetre_fermee") return remplirGestes(zone, { r, texte, conversation: null, telephone: conversation.telephone || telephone, fen: null });
      etatEnvoi.textContent = tr(ERREURS_ENVOI[code] || ERREURS_ENVOI.verifier_whatsapp);
      etatEnvoi.hidden = false;
      // Résultat inconnu : le message est peut-être parti, le bouton reste éteint (vérifier dans WhatsApp).
      bouton.disabled = envoiIncertain(code) || ["contenu_interne", "montant_a_confirmer", "droit_manquant"].includes(code);
    });
    enfants.push(bouton, etatEnvoi);
  }
  zone.replaceChildren(...enfants.filter(Boolean));
}

function cartePickup(r, { langue, mode, nomsPartenaires, ecrit }) {
  const d = etat.db.dossiers.find((x) => x.id === r.dossier_id) || null;
  const c = (d && etat.db.clients.find((x) => x.id === d.client_id)) || null;
  const lieu = lieuPickup(r, c || {});
  const m = messagePickup({ reservation: r, client: c || {}, langue, mode, noms: nomsPartenaires });
  const detail = [c ? nomClient(c) : "", personnesTexte(r.personnes, langueActive())].filter(Boolean).join(" · ");
  const zone = h("div", { class: "service-pied" });
  const carte = h(
    "li",
    { class: "service point-soir-pickup" },
    h("div", { class: "service-heure" }, h("strong", null, r.heure_pickup || "—"), r.heure_pickup ? h("span", null, tr("pickup")) : null),
    h(
      "div",
      { class: "service-corps" },
      h("div", { class: "service-titre" }, lienDossier(r.libelle, d && d.id)),
      detail ? h("p", { class: "service-detail" }, detail) : null,
      lieu ? h("p", { class: "service-detail" }, lieu) : null,
      m.texte ? h("p", { class: "point-soir-message", lang: langue }, m.texte) : h("p", { class: "point-soir-signal" }, h("span", { class: "tag tag-alerte" }, r.heure_pickup ? tr("À compléter") : tr("Sans heure de pickup")), " ", tr(RAISONS[m.raison] || RAISONS.heure)),
      zone
    )
  );
  if (!m.texte) {
    zone.remove();
    return carte;
  }
  const conversation = ecrit ? conversationPourVoucher({ reservation: r }) : null;
  const telephone = (c && c.telephone) || "";
  const connue = conversation ? fenetreDepuisConversation(conversation) : null;
  if (!conversation || connue) remplirGestes(zone, { r, texte: m.texte, conversation, telephone, fen: connue });
  else {
    zone.replaceChildren(h("span", { class: "aide" }, tr("Vérification de la fenêtre de 24 h…")));
    // La fenêtre se lit dans les messages ; une lecture en échec n'est pas une fenêtre ouverte : le lien wa.me reste possible.
    messagesRecents(conversation.id).then(
      (messages) => remplirGestes(zone, { r, texte: m.texte, conversation, telephone, fen: fenetre(messages || []) }),
      () => remplirGestes(zone, { r, texte: m.texte, conversation, telephone, fen: null })
    );
  }
  return carte;
}

function blocPickups(demain) {
  const liste = pickupsDuJour(etat.db.reservations, demain, { ecartes: dossiersAnnules() });
  const langue = langueClient(reglages());
  const mode = modeTaxi() ? "taxi" : modeExcursions() ? "excursions" : "voyages";
  const options = { langue, mode, nomsPartenaires: noms(), ecrit: whatsappEcrit() };
  const sansHeure = liste.filter((r) => !r.heure_pickup).length;
  return h(
    "div",
    { class: "point-soir-bloc" },
    h("h3", null, tr("Pickups de demain, {date}", { date: formatDate(demain) }), h("span", { class: "tag" }, liste.length), sansHeure ? h("span", { class: "tag tag-alerte" }, pluriel(sansHeure, N_("{n} sans heure"), N_("{n} sans heure"))) : null),
    liste.length ? h("ul", { class: "services" }, liste.map((r) => cartePickup(r, options))) : h("p", { class: "vide-court" }, tr("Aucun pickup demain."))
  );
}

function blocEnvois(demain, apres) {
  const jours = [demain, apres];
  const dossiers = [...new Set(etat.db.reservations.filter((r) => jours.includes(r.date_service)).map((r) => r.dossier_id))];
  const liste = envoisAFaire(dossiers.flatMap((id) => vouchersDuDossier(id)), jours);
  const taxi = modeTaxi();
  const titre = taxi ? tr("Booking confirmations à envoyer") : tr("Vouchers à envoyer");
  return h(
    "div",
    { class: "point-soir-bloc" },
    h("h3", null, titre, h("span", { class: "tag" }, liste.length)),
    liste.length
      ? h(
          "ul",
          { class: "cartes" },
          liste.map((x) => {
            const r = x.reservation;
            const d = etat.db.dossiers.find((y) => y.id === r.dossier_id) || null;
            const c = d && etat.db.clients.find((y) => y.id === d.client_id);
            return h(
              "li",
              { class: "carte" },
              h(
                "div",
                { class: "carte-lien statique" },
                h("span", { class: "carte-titre" }, lienDossier(c ? nomClient(c) : r.libelle, d && d.id)),
                h("span", { class: "carte-droite" }, h("strong", null, r.date_service === demain ? tr("Demain") : tr("Après-demain")), r.heure_pickup ? h("span", null, tr("pickup {heure}", { heure: r.heure_pickup })) : null),
                h("span", { class: "carte-sous" }, r.libelle),
                h("span", { class: "carte-pied" }, x.envoi && x.envoi.modifie ? h("span", { class: "tag tag-alerte" }, tr("modifié depuis l'envoi")) : h("span", { class: "tag" }, tr("pas encore envoyé")), peut("dossiers.lire") ? h("button", { class: "principal petit", type: "button", onclick: () => envoyerVoucher(x) }, x.envoi && x.envoi.le ? tr("Renvoyer") : taxi ? tr("Envoyer la Booking confirmation") : tr("Envoyer le voucher")) : null)
              )
            );
          })
        )
      : h("p", { class: "vide-court" }, taxi ? tr("Toutes les Booking confirmations de demain et après-demain sont parties.") : tr("Tous les vouchers de demain et après-demain sont partis."))
  );
}

function blocWhatsApp() {
  if (!whatsappEcrit()) return null;
  const liste = sansReponse({ conversations: etat.brut.whatsapp_conversations || [], propositions: etat.brut.whatsapp_propositions || [], entiteId: etat.entiteId });
  const client = (c) => (c.client_id ? (etat.brut.clients || []).find((x) => x.id === c.client_id) || null : null);
  return h(
    "div",
    { class: "point-soir-bloc" },
    h("h3", null, tr("WhatsApp sans réponse depuis plus de 12 h"), h("span", { class: "tag" }, liste.length)),
    liste.length
      ? h(
          "ul",
          { class: "cartes" },
          liste.map((x) =>
            h(
              "li",
              { class: "carte" },
              h(
                "a",
                { class: "carte-lien", href: lienConversation({ conversation: x.conversation.id, entite: x.conversation.entite_id }) },
                h("span", { class: "carte-titre" }, nomConversation(x.conversation, client(x.conversation))),
                h("span", { class: "carte-droite" }, h("strong", null, tr("attend depuis {duree}", { duree: x.attente }))),
                x.aTrier ? h("span", { class: "carte-pied" }, h("span", { class: "tag" }, tr("à trier"))) : null
              )
            )
          )
        )
      : h("p", { class: "vide-court" }, tr("Aucun client n'attend depuis plus de 12 h."))
  );
}

// La section, à l'accueil comme sur l'écran #/soir (qui a déjà son titre : `titre: false`).
export function sectionPointSoir({ titre = true } = {}) {
  const ajd = dateDans(fuseau());
  const demain = ajouterJours(ajd, 1);
  const apres = ajouterJours(ajd, 2);
  const blocs = [moduleActif("reservations") ? blocPickups(demain) : null, moduleActif("reservations") ? blocEnvois(demain, apres) : null, blocWhatsApp()].filter(Boolean);
  return h(
    "section",
    { class: "section-jour point-soir", id: "point-soir" },
    titre ? h("h2", null, icone("lune", 20), " ", tr("Point du soir")) : null,
    ...(blocs.length ? blocs : [h("p", { class: "vide-court" }, tr("Rien à préparer ici : cette entreprise ne suit ni réservations ni WhatsApp."))])
  );
}

export async function vuePointSoir() {
  return h(
    "div",
    { "data-titre": tr("Point du soir") },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Point du soir")), h("p", { class: "sous" }, tr("Ce qui part demain et ce qui attend encore. Rien ne part sans vous.")))),
    sectionPointSoir({ titre: false })
  );
}
