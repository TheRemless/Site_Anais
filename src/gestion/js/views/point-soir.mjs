// Point du soir (22.11.2026) : section de l'accueil de 17h à 6h et écran #/soir (menu « Point du soir »). Logique dans point-soir-calc.mjs.
// Chaque entreprise garde ses éléments : l'écran lit l'entreprise ouverte (etat.db), ses vouchers (Booking confirmations chez Taxi), sa
// langue client et son modèle « rappel » (Réglages > Messages). Aucune notification, aucun envoi tout seul : chaque message part d'un
// geste de Nani, par la conversation WhatsApp (whatsapp-envoi, fenêtre de 24 h ouverte, destinataire affiché) ou par un lien wa.me.
// Un client ne reçoit jamais deux rappels : la trace details.pickup_annonce est partagée avec le bouton WhatsApp de « Demain » (dashboard).
import { etat, modifier, nomClient, peut, reglages, dossiersAnnules, moduleActif, modeTaxi, modeExcursions, organisation, entiteActive, partenaireDe } from "../etat.mjs";
import { h, icone, toast, confirmer } from "../ui.mjs";
import { tr, N_, langueActive, pluriel } from "../i18n.mjs";
import { formatDate } from "../calc.mjs";
import { ajouterJours, personnesTexte, langueClient, variablesMessage, notePasseport } from "../operations-calc.mjs";
import { messagesDefautPour } from "../defauts.mjs";
import { dateDans, heureDans, FUSEAU_DEFAUT } from "../rappel-h1-calc.mjs";
import { ERREURS_ENVOI, envoiIncertain, nomConversation, motifRefusEnvoi, codeEnvoi } from "../whatsapp-calc.mjs";
import { numeroMasque, numeroDifferent } from "../whatsapp-voucher-calc.mjs";
import { lienWhatsApp as lienConversation } from "../agent-whatsapp-lecture.mjs";
import { joursDuPoint, pickupsDuPoint, messagePickup, modeleDuPickup, moyenEnvoi, fenetreDepuis, detailsAvecAnnonce, annonceDe, etatAnnonce, envoisAFaire, sansReponse, lieuPickup, pointSoirVisible, nomsInterdits, lienDuTexte } from "../point-soir-calc.mjs";
import { lienDossier } from "./commun.mjs";
import { messagesTypes } from "./messages.mjs";
import { vouchersDuDossier } from "./voucher.mjs";
import { conversationPourVoucher, adminsWhatsApp } from "./voucher-whatsapp.mjs";
import { envoyerVoucher } from "./voucher-envoi.mjs";

const fuseau = () => (organisation() || {}).fuseau || FUSEAU_DEFAUT;
const RAISONS = {
  heure: N_("Heure de pickup à saisir ou illisible : aucun message préparé."),
  lieu: N_("Lieu de pickup à saisir : aucun message préparé."),
  nom_partenaire: N_("Le message contiendrait le nom d'un partenaire : écrivez-le vous-même."),
  modele: N_("Aucun modèle « rappel » pour cette langue dans Messages : aucun message préparé."),
  variables: N_("À compléter sur la réservation avant le message : {liste}."),
  numero: N_("Numéro du client à corriger : il manque l'indicatif du pays (+…)."),
};
const NOMS_VARIABLES = { prestation: N_("le service"), dropoff: N_("la dépose"), date: N_("la date"), prenom: N_("le prénom"), personnes: N_("les personnes"), entreprise: N_("le nom de l'entreprise") };

// La section est-elle à l'accueil maintenant ? De 17h à 6h, à l'heure de l'organisation.
export const pointSoirMaintenant = () => moduleActif("reservations") && pointSoirVisible(heureDans(fuseau()));

const noms = () => nomsInterdits({ partenaires: etat.brut.partenaires, conversations: etat.brut.whatsapp_conversations });
const whatsappEcrit = () => !!etat.brut && etat.brut.whatsapp_disponible === true && adminsWhatsApp().includes(etat.entiteId);
const heureCourte = (iso) => new Date(iso).toLocaleTimeString(langueActive() === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: fuseau() });
const entreprise = () => ({ nom: reglages().emetteur.nom || entiteActive().nom, telephone: reglages().emetteur.telephone || "", lien_avis: (reglages().emetteur.lien_avis || "").trim(), devise: reglages().devise || "" });
const courante = (r) => etat.db.reservations.find((x) => x.id === r.id) || r;

// Une trace qui n'a pas pu être écrite reste connue de cet appareil jusqu'au rechargement : le bouton ne se rallume pas pour autant.
const tracesLocales = new Map();
export const annonceCourante = (r) => annonceDe(courante(r)) || tracesLocales.get(r.id) || null;

// Écrit la trace ; si l'écriture échoue, la garde en « incertain » sur cet appareil. Rend true si elle est en base.
export async function noterAnnonce(r, par) {
  const le = new Date().toISOString();
  if (peut("dossiers.ecrire")) {
    try {
      await modifier("reservations", r.id, { details: detailsAvecAnnonce(courante(r).details, { le, par }) });
      tracesLocales.delete(r.id);
      return true;
    } catch (err) {
      toast(tr("Trace de l'envoi non enregistrée : {message}", { message: err.message }), true);
    }
  }
  tracesLocales.set(r.id, { le, par: par === "lien" ? "lien" : "incertain" });
  return false;
}

const MOTS_ANNONCE = {
  direct: N_("Message envoyé à {heure}"),
  lien: N_("WhatsApp ouvert à {heure}"),
  incertain: N_("Peut-être parti à {heure} : vérifiez dans WhatsApp"),
};
const tagAnnonce = (a) => h("span", { class: `tag tag-annonce${a.par === "incertain" ? " tag-alerte" : ""}` }, tr(MOTS_ANNONCE[a.par] || MOTS_ANNONCE.lien, { heure: heureCourte(a.le) }));

// Avant un nouvel envoi quand une trace existe : jamais deux rappels sans le vouloir.
export async function confirmerNouvelEnvoi(r) {
  const a = annonceCourante(r);
  if (!a) return true;
  const texte = a.par === "incertain" ? tr("Le rappel est peut-être déjà parti à {heure}. Vérifiez dans WhatsApp : l'envoyer quand même ?", { heure: heureCourte(a.le) }) : a.par === "direct" ? tr("Le rappel est déjà parti à {heure}. L'envoyer de nouveau ?", { heure: heureCourte(a.le) }) : tr("WhatsApp a déjà été ouvert pour ce rappel à {heure}. L'envoyer quand même ?", { heure: heureCourte(a.le) });
  return confirmer(texte, tr("Envoyer quand même"));
}

// Les gestes d'un pickup, d'après le moyen d'envoi. `zone` est remplie une fois la fenêtre de 24 h connue.
// `refuse` : un texte refusé par whatsapp-envoi (relecture de la PR 317). Il ne part jamais par le lien wa.me tant qu'il n'a pas changé.
function remplirGestes(zone, { r, texte, conversation, client, fen, refuse = null }) {
  const telephone = (client && client.telephone) || "";
  const moyen = moyenEnvoi({ conversation, fenetre: fen, telephone, texte });
  const a = annonceCourante(r);
  const { bloque } = etatAnnonce(a);
  const enfants = [a ? tagAnnonce(a) : null];
  const refaire = () => remplirGestes(zone, { r, texte, conversation, client, fen, refuse });
  if (!moyen) return zone.replaceChildren(...enfants.filter(Boolean));
  if (!moyen.genre) enfants.push(h("span", { class: "point-soir-signal" }, tr(RAISONS.numero)));
  else if (moyen.genre === "lien") {
    // Le lien reprend le texte tel qu'il est ici. Le texte refusé par le serveur l'éteint, et une zone de texte permet de le modifier :
    // le lien se rallume dès qu'il a changé et qu'aucun nom de partenaire n'y reste (le lien wa.me ne passe par aucun contrôle du serveur).
    const lienRefuse = refuse !== null && texte === refuse;
    const edition = lienRefuse ? h("textarea", { class: "point-soir-edition", rows: 6, "aria-label": tr("Message à modifier avant l'envoi") }) : null;
    const signal = lienRefuse ? h("p", { class: "aide", role: "status" }, tr("Le message refusé ne part pas par WhatsApp : modifiez-le d'abord.")) : null;
    let lienCourant = lienRefuse ? null : moyen.lien;
    const lien = h(
      "a",
      {
        class: `bouton ${a ? "secondaire" : "principal"} petit`,
        target: "_blank",
        rel: "noopener",
        onclick: async (e) => {
          if (!lienCourant) return void e.preventDefault();
          if (!a) return void noterAnnonce(r, "lien").then(refaire);
          e.preventDefault();
          if (!(await confirmerNouvelEnvoi(r))) return;
          window.open(lienCourant, "_blank", "noopener");
          await noterAnnonce(r, "lien");
          refaire();
        },
      },
      icone("whatsapp", 16),
      tr("Ouvrir dans WhatsApp")
    );
    const majLien = () => {
      lienCourant = lienDuTexte({ texte: edition ? edition.value.trim() : texte, telephone, refuse, noms: noms() });
      if (lienCourant) lien.setAttribute("href", lienCourant);
      else lien.removeAttribute("href");
      lien.classList.toggle("desactive", !lienCourant);
      lien.setAttribute("aria-disabled", String(!lienCourant));
    };
    if (edition) {
      edition.value = texte;
      edition.addEventListener("input", majLien);
    }
    majLien();
    enfants.push(signal, edition, lien);
  } else {
    // Le destinataire avant l'envoi, comme le voucher : nom, numéro masqué ; un numéro qui n'est pas celui de la fiche se confirme.
    const fiche = (client && client.telephone) || "";
    const autre = numeroDifferent(conversation.telephone, fiche);
    const caseNumero = autre ? h("input", { type: "checkbox", id: `soir-numero-${r.id}` }) : null;
    const etatEnvoi = h("p", { class: "aide", role: "status", hidden: true });
    // Bouton grisé : la vraie raison dessous, reliée au bouton (audit mobile n° 15). Trace « incertain » : la case cochée ne le rallume pas,
    // seul « Renvoyer quand même » renvoie ; le texte le dit au lieu de faire cocher pour rien (relecture de la PR 361).
    const raison = autre || bloque ? h("p", { class: "aide", id: `soir-raison-${r.id}` }) : null;
    const texteRaison = () =>
      bloque
        ? caseNumero && !caseNumero.checked
          ? tr("Ce bouton reste éteint tant que l'envoi est incertain. Pour renvoyer à ce numéro, cochez la case ci-dessus puis touchez « Renvoyer quand même ».")
          : tr("Ce bouton reste éteint tant que l'envoi est incertain. Pour renvoyer, touchez « Renvoyer quand même ».")
        : caseNumero && !caseNumero.checked
          ? tr("Cochez la case ci-dessus pour envoyer à ce numéro.")
          : "";
    const bouton = h("button", { class: a ? "secondaire petit" : "principal petit", type: "button", disabled: bloque || autre, "aria-describedby": raison ? raison.id : null }, icone("whatsapp", 16), tr("Envoyer sur WhatsApp"));
    // Refus du serveur (décision du 22.11.2026, relecture de la PR 317) : le motif en clair, le message devient modifiable ici et l'envoi se
    // rallume dès qu'il change ; le serveur revérifie le nouveau texte. Un net (contenu_interne) : refus sec. Un prix de vente qui est aussi le
    // net d'un autre service (montant_a_confirmer) : « Envoyer quand même » pour ce texte-là seulement.
    let edition = null;
    let confirmation = null;
    const texteEnvoye = () => (edition ? edition.value.trim() : texte);
    const majBouton = () => {
      bouton.disabled = bloque || (caseNumero && !caseNumero.checked) || !texteEnvoye() || (refuse !== null && texteEnvoye() === refuse);
      if (raison) {
        raison.textContent = texteRaison();
        raison.hidden = !raison.textContent;
      }
      if (confirmation) confirmation.hidden = refuse === null || texteEnvoye() !== refuse;
    };
    if (caseNumero) caseNumero.addEventListener("change", majBouton);
    majBouton();
    // `confirmes` : la liste de « Envoyer quand même », valable pour le texte refusé tel quel.
    const partir = async ({ dejaConfirme = false, confirmes = null } = {}) => {
      if (caseNumero && !caseNumero.checked) return;
      if (confirmes && texteEnvoye() !== refuse) return;
      if (!dejaConfirme && !(await confirmerNouvelEnvoi(r))) return;
      bouton.disabled = true;
      etatEnvoi.hidden = true;
      const envoye = texteEnvoye();
      const res = await etat.store.whatsappEnvoyer({ conversation_id: moyen.conversation_id, texte: envoye, ...(confirmes ? { montants_confirmes: confirmes } : {}) });
      if (res && (res.ok || res.demo)) {
        // Parti : la trace « direct » ; si elle ne s'écrit pas, « incertain » sur cet appareil, et le bouton reste bloqué.
        await noterAnnonce(r, "direct");
        toast(res.demo ? tr("En démo, rien ne part : le message serait envoyé dans la conversation WhatsApp.") : tr("Message envoyé dans la conversation WhatsApp."));
        return refaire();
      }
      const code = (res && res.erreur) || "inconnu";
      // La fenêtre s'est fermée entre-temps : le lien wa.me prend la place du bouton, avec le texte corrigé ici. Un texte encore refusé
      // n'y part pas (relecture de la PR 317).
      if (code === "fenetre_fermee") return remplirGestes(zone, { r, texte: envoye, conversation: null, client: { ...(client || {}), telephone: conversation.telephone || telephone }, fen: null, refuse });
      if (envoiIncertain(code)) {
        // Résultat inconnu : le message est peut-être parti. Trace « incertain » : bouton bloqué, « Renvoyer quand même » se confirme.
        await noterAnnonce(r, "incertain");
        refaire();
        return toast(tr(ERREURS_ENVOI.verifier_whatsapp), true);
      }
      const motif = motifRefusEnvoi(res, { texte: envoye, nombre: (n) => n.toLocaleString(langueActive() === "en" ? "en-GB" : "fr-FR") });
      etatEnvoi.textContent = motif ? tr(motif.texte, motif.vars) : tr(ERREURS_ENVOI[codeEnvoi(code, res && res.a_retirer)] || ERREURS_ENVOI.base);
      etatEnvoi.hidden = false;
      if (code === "contenu_interne" || code === "montant_a_confirmer") {
        refuse = envoye;
        if (!edition) {
          edition = h("textarea", { class: "point-soir-edition", rows: 6, "aria-label": tr("Message à modifier avant l'envoi") });
          edition.value = envoye;
          edition.addEventListener("input", majBouton);
          bouton.before(edition);
        }
        if (confirmation) confirmation.remove();
        confirmation = null;
        if (motif && motif.confirmer) {
          const liste = motif.confirmer;
          confirmation = h("button", { class: "secondaire petit", type: "button", onclick: () => partir({ dejaConfirme: true, confirmes: liste }) }, tr("Envoyer quand même"));
          bouton.after(confirmation);
        }
        majBouton();
        edition.focus();
        return;
      }
      bouton.disabled = code === "droit_manquant";
    };
    bouton.addEventListener("click", () => partir());
    // Trace « incertain » : le bouton reste éteint ; seul ce bouton renvoie, après une confirmation explicite.
    const renvoyer = bloque
      ? h("button", { class: "secondaire petit", type: "button", onclick: async () => { if (caseNumero && !caseNumero.checked) return; if (await confirmerNouvelEnvoi(r)) partir({ dejaConfirme: true }); } }, tr("Renvoyer quand même"))
      : null;
    enfants.push(
      h("p", { class: "point-soir-destinataire" }, tr("À : {nom}", { nom: nomConversation(conversation, client) }), " · ", h("span", null, autre ? conversation.telephone : numeroMasque(conversation.telephone))),
      caseNumero ? h("label", { class: "point-soir-numero", for: caseNumero.id }, caseNumero, " ", tr("Ce numéro est bien celui du client (la fiche indique {fiche})", { fiche: fiche || "—" })) : null,
      bouton,
      raison,
      renvoyer,
      etatEnvoi
    );
  }
  zone.replaceChildren(...enfants.filter(Boolean));
}

function cartePickup(r, { langue, mode, nomsPartenaires, ecrit, demain }) {
  const d = etat.db.dossiers.find((x) => x.id === r.dossier_id) || null;
  const c = (d && etat.db.clients.find((x) => x.id === d.client_id)) || null;
  const lieu = lieuPickup(r, c || {}, mode);
  const partenaire = partenaireDe(r.partenaire_id) || {};
  const vars = variablesMessage({ reservation: r, client: c || {}, dossier: d || {}, partenaire, entreprise: entreprise(), langue });
  const modele = modeleDuPickup({ stockes: messagesTypes(), defauts: messagesDefautPour(reglages()).filter((m) => langue !== "en" || m.langue !== "fr"), langue, mode, jour: r.date_service, demain });
  const m = messagePickup({ reservation: r, client: c || {}, mode, langue, modele, vars, noms: nomsPartenaires });
  // La note du passeport et du check-in d'un trajet vers une destination qui l'exige, comme le rappel de l'accueil (messageClient).
  const trajet = r.trajet_id ? (etat.db.trajets || []).find((t) => t.id === r.trajet_id) : null;
  const suite = m.texte && langue === "en" ? notePasseport({ de: trajet && trajet.de, vers: trajet && trajet.vers, libelle: r.libelle, partenaire, destinations: reglages().destinations_passeport }) : "";
  const texte = m.texte ? `${m.texte}${suite ? `\n\n${suite}` : ""}` : null;
  const detail = [c ? nomClient(c) : "", personnesTexte(r.personnes, langueActive())].filter(Boolean).join(" · ");
  const zone = h("div", { class: "service-pied" });
  const idMessage = `soir-message-${r.id}`;
  const message = texte ? h("p", { class: "point-soir-message replie", id: idMessage, lang: langue }, h("span", { class: "point-soir-texte" }, texte)) : null;
  const deplier = texte
    ? h("button", {
        class: "lien point-soir-deplier seulement-mobile",
        type: "button",
        "aria-expanded": "false",
        "aria-controls": idMessage,
        onclick: () => {
          const ouvert = !message.classList.toggle("replie");
          deplier.setAttribute("aria-expanded", String(ouvert));
          deplier.textContent = ouvert ? tr("Réduire") : tr("Voir tout le message");
        },
      }, tr("Voir tout le message"))
    : null;
  // Un message de deux lignes au plus n'a rien à déplier.
  if (texte) requestAnimationFrame(() => { if (message.isConnected && matchMedia("(max-width: 719px)").matches && message.firstChild.scrollHeight <= message.firstChild.clientHeight + 1) deplier.hidden = true; });
  const raison = m.raison === "variables" ? tr(RAISONS.variables, { liste: (m.manque || []).map((k) => (NOMS_VARIABLES[k] ? tr(NOMS_VARIABLES[k]) : k)).join(", ") }) : tr(RAISONS[m.raison] || RAISONS.heure);
  const carte = h(
    "li",
    { class: "service point-soir-pickup" },
    // « départ » en français, « pickup » en anglais : une clé à part (« départ » seul se traduit « departure »), la précision entre
    // parenthèses ne s'affiche pas (relecture de la PR 361).
    h("div", { class: "service-heure" }, h("strong", null, r.heure_pickup || "—"), r.heure_pickup ? h("span", null, tr("départ (heure de prise en charge)").replace(/ \(.*\)$/, "")) : null),
    h(
      "div",
      { class: "service-corps" },
      h("div", { class: "service-titre" }, lienDossier(r.libelle, d && d.id)),
      r.date_service !== demain ? h("p", { class: "service-detail" }, h("span", { class: "tag tag-alerte" }, tr("Ce matin"))) : null,
      detail ? h("p", { class: "service-detail" }, detail) : null,
      lieu ? h("p", { class: "service-detail" }, lieu) : null,
      // Sur téléphone, les deux premières lignes du message et « Voir tout le message » ; sur ordinateur, le message entier (audit mobile n° 15).
      // Jamais replié sans aperçu : « Envoyer sur WhatsApp » envoie ce texte tel quel, il se lit avant de partir (relecture de la PR 361).
      texte ? message : h("p", { class: "point-soir-signal" }, h("span", { class: "tag tag-alerte" }, r.heure_pickup ? tr("À compléter") : tr("Sans heure de pickup")), " ", raison),
      deplier,
      zone
    )
  );
  if (!texte) {
    zone.remove();
    return carte;
  }
  const conversation = ecrit ? conversationPourVoucher({ reservation: r }) : null;
  if (!conversation) remplirGestes(zone, { r, texte, conversation: null, client: c, fen: null });
  else {
    zone.replaceChildren(h("span", { class: "aide" }, tr("Vérification de la fenêtre de 24 h…")));
    // Une seule ligne lue : le dernier message du client. Une lecture en échec n'est pas une fenêtre ouverte : le lien wa.me reste possible.
    etat.store.whatsappDernierEntrant(conversation.id).then(
      (dernier) => remplirGestes(zone, { r, texte, conversation, client: c, fen: fenetreDepuis(dernier) }),
      () => remplirGestes(zone, { r, texte, conversation, client: c, fen: null })
    );
  }
  return carte;
}

function blocPickups(jours, demain) {
  const ajd = dateDans(fuseau());
  const maintenant = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: fuseau() });
  const liste = pickupsDuPoint(etat.db.reservations, jours, { ecartes: dossiersAnnules(), prestationDe: (id) => etat.db.prestations.find((p) => p.id === id) || null, ajd, minuteMaintenant: Number(maintenant.slice(0, 2)) * 60 + Number(maintenant.slice(3, 5)) });
  const langue = langueClient(reglages());
  const mode = modeTaxi() ? "taxi" : modeExcursions() ? "excursions" : "voyages";
  const options = { langue, mode, nomsPartenaires: noms(), ecrit: whatsappEcrit(), demain };
  const sansHeure = liste.filter((r) => !r.heure_pickup).length;
  return h(
    "div",
    { class: "point-soir-bloc" },
    h("h3", null, tr("Pickups de demain, {date}", { date: formatDate(demain) }), h("span", { class: "tag" }, liste.length), sansHeure ? h("span", { class: "tag tag-alerte" }, pluriel(sansHeure, N_("{n} sans heure"), N_("{n} sans heure"))) : null),
    liste.length ? h("ul", { class: "services" }, liste.map((r) => cartePickup(r, options))) : h("p", { class: "vide-court" }, tr("Aucun pickup demain."))
  );
}

function blocEnvois(jours) {
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
                h("span", { class: "carte-droite" }, h("strong", null, formatDate(r.date_service)), r.heure_pickup ? h("span", null, tr("pickup {heure}", { heure: r.heure_pickup })) : null),
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
  const jours = joursDuPoint(ajd, demain, heureDans(fuseau()));
  const blocs = [moduleActif("reservations") ? blocPickups(jours, demain) : null, moduleActif("reservations") ? blocEnvois([...jours, ajouterJours(demain, 1)]) : null, blocWhatsApp()].filter(Boolean);
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
