// « Proposer une excursion » (22.11.2026) : sur la fiche d'un dossier de Taxi ou de Secret, et sur la carte d'une conversation WhatsApp
// reliée à un dossier. Composant à part : la fiche et la carte n'ajoutent qu'un appel à boutonProposerExcursion (les écrans WhatsApp sont
// travaillés par une autre session). Logique dans excursion-proposee-calc.mjs.
// Rien ne part tout seul : Nani coche une ou deux excursions, relit le message, puis le copie, l'ouvre dans WhatsApp (wa.me) ou l'envoie
// dans la conversation du client si le client a écrit il y a moins de 24 h (whatsapp-envoi, avec ses contrôles des nets et des noms).
import { etat, entitesAccessibles, organisationActiveId, reglagesDe, nomClient, permissionsDe } from "../etat.mjs";
import { h, icone, modal, toast } from "../ui.mjs";
import { tr, langueActive } from "../i18n.mjs";
import { aujourdhui } from "../calc.mjs";
import { exempleDe } from "../exemples.mjs";
import { resteBloque } from "../agent-calc.mjs";
import { marqueEntite, lienWhatsApp, fenetre, ERREURS_ENVOI, envoiIncertain, motifRefusEnvoi, codeEnvoi } from "../whatsapp-calc.mjs";
import { conversationDuVoucher, contactVoucher } from "../whatsapp-voucher-calc.mjs";
import { possibilites, choixParDefaut, messageExcursions, estTransfert, sejour, sensTransfert, joursLibres, lieuxExterieurs, reservationsDuDossierLie, voucherEnvoye, familleDe, nomService, prixTexte, nomsInterdits } from "../excursion-proposee-calc.mjs";
import { adminsWhatsApp } from "./voucher-whatsapp.mjs";

// Une ou deux sorties pour un client de Secret ; deux ou trois exemples pour un client de Taxi (question 7 de la PR 310).
const MAX = 2;
const MAX_TAXI = 3;
const entite = (id) => (etat.brut.entites || []).find((e) => e.id === id) || null;
const parMarque = (m) => entitesAccessibles().find((e) => marqueEntite(e) === m) || null;

// Tout ce qu'il faut pour proposer, ou null : le bouton ne s'affiche pas (ZTP, pas de transfert, séjour trop court ou fini, rien au catalogue,
// pas le droit d'écrire dans WhatsApp pour l'entreprise du dossier : jamais Mook, jamais un accès WhatsApp en lecture seule).
export function contexteProposition(dossier) {
  if (!etat.brut || !dossier || dossier.annule) return null;
  const marque = marqueEntite(entite(dossier.entite_id));
  const secret = parMarque("secret");
  if (!marque || !secret) return null;
  if (!adminsWhatsApp().includes(dossier.entite_id)) return null;
  const taxiE = parMarque("taxi");
  const prestations = etat.brut.prestations || [];
  const trajets = etat.brut.trajets || [];
  const reservations = (etat.brut.reservations || []).filter((r) => r.dossier_id === dossier.id && r.statut !== "annule");
  const prestationDe = (r) => (r.prestation_id ? prestations.find((p) => p.id === r.prestation_id) || null : null);
  const trajetDe = (r) => (r.trajet_id ? trajets.find((t) => t.id === r.trajet_id) || null : null);
  const transferts = reservations.filter((r) => estTransfert(r, { prestation: prestationDe(r), taxi: marque === "taxi" }));
  const ile = exempleDe("lieu", organisationActiveId());
  const ajd = aujourdhui();
  // Le sens de chaque transfert (arrivée sur l'île, départ) : un départ seul n'ouvre plus un séjour qui commence ce jour-là.
  // Les lieux hors de l'île : liste connue et zones du catalogue Taxi (« Krabi Airport », « Ao Nang »).
  const zones = taxiE ? prestations.filter((p) => p.entite_id === taxiE.id && p.famille === "transfert").map((p) => p.libelle_en || p.libelle).filter((t) => !/→|->/.test(t || "")) : [];
  const exterieurs = lieuxExterieurs(zones);
  const s = sejour(transferts, { ile, ajd, sens: (r) => sensTransfert(r, { prestation: prestationDe(r), trajet: trajetDe(r), ile, exterieurs }) });
  if (!s) return null;
  // Client de Taxi (décision de Jérémy, question 7 de la PR 310) : seulement une fois le voucher du transfert envoyé au client.
  if (marque === "taxi" && !transferts.some(voucherEnvoye)) return null;
  // Les sorties déjà réservées : celles du dossier et du dossier lié de l'autre entreprise (Secret et Taxi d'une même demande, jamais ZTP).
  const lie = reservationsDuDossierLie(dossier, { dossiers: etat.brut.dossiers || [], reservations: etat.brut.reservations || [], marqueDe: (id) => marqueEntite(entite(id)) });
  const avecLie = [...reservations, ...lie];
  const sorties = avecLie.filter((r) => !estTransfert(r, { prestation: prestationDe(r), taxi: marqueEntite(entite(r.entite_id)) === "taxi" }));
  const libres = joursLibres(s, { ajd, occupes: sorties.map((r) => r.date_service).filter(Boolean) });
  if (!libres.length) return null;
  const enfants = Math.max(0, ...avecLie.map((r) => Number((r.personnes || {}).enfants) || 0));
  const dejaP = avecLie.map(prestationDe).filter((p) => p && p.entite_id === secret.id);
  const deja = { prestations: new Set(dejaP.map((p) => p.id)), familles: new Set(dejaP.filter((p) => p.famille !== "transfert").map(familleDe)) };
  const client = (etat.brut.clients || []).find((c) => c.id === dossier.client_id) || null;
  const noms = nomsInterdits({ partenaires: etat.brut.partenaires, conversations: etat.brut.whatsapp_conversations, client });
  // Les noms de Secret et de Taxi ne sont contrôlables que si leurs fiches partenaires et les conversations sont chargées : sinon la copie
  // et le lien wa.me restent éteints (l'envoi depuis Gestion, contrôlé par le serveur, reste possible).
  const charges = nomsCharges({ secret, taxi: taxiE });
  const liste = possibilites(prestations.filter((p) => p.entite_id === secret.id), { noms, deja, enfants, jours: libres });
  if (!liste.length) return null;
  return { dossier, client, liste, noms, charges, sejour: s, libres, taxi: marque === "taxi", devise: reglagesDe(secret.id).devise || "THB" };
}

// Fiches partenaires de Secret et de Taxi lisibles (partenaires.lire) et conversations WhatsApp chargées.
export function nomsCharges({ secret = null, taxi = null } = {}) {
  if (!etat.brut || !Array.isArray(etat.brut.partenaires) || !Array.isArray(etat.brut.whatsapp_conversations)) return false;
  return !!secret && !!taxi && [secret, taxi].every((e) => permissionsDe(e.id).includes("partenaires.lire"));
}

export function boutonProposerExcursion({ dossier, conversation = null, classe = "secondaire petit" } = {}) {
  const ctx = contexteProposition(dossier);
  if (!ctx) return null;
  return h("button", { class: classe, type: "button", onclick: () => ouvrirProposition(ctx, conversation) }, icone("bateau", 16), tr("Proposer une excursion"));
}

function ouvrirProposition(ctx, conversationDonnee) {
  const { dossier, client, liste, noms, charges, taxi, devise } = ctx;
  const max = taxi ? MAX_TAXI : MAX;
  let choisis = choixParDefaut(liste, max);
  let modifie = false;
  const prenom = (client && (client.prenom || client.nom)) || "";
  const message = () => messageExcursions(liste.filter((x) => choisis.includes(x.prestation.id)), { prenom, devise, taxi });

  const zone = h("textarea", { id: "excursion-message", rows: 14, maxlength: 3000 });
  zone.value = message();
  const refaire = h("button", { class: "lien", type: "button", hidden: true }, tr("Refaire le message d'après le choix"));
  const alerte = h("p", { class: "erreur-form", role: "alert", hidden: true });
  const etatEnvoi = h("div", { class: "partage-etat", role: "status", hidden: true });

  // La conversation du client : celle de la carte WhatsApp si c'est bien celle du client du dossier et que la personne peut y écrire (même
  // règle que l'envoi du voucher : jamais un apporteur, un partenaire ni un contact personnel), sinon celle reliée au dossier.
  const admins = adminsWhatsApp();
  const ecrit = (c) => (c.entite_id ? admins.includes(c.entite_id) : admins.length > 0);
  const donneeOk = conversationDonnee && ecrit(conversationDonnee) && contactVoucher(conversationDonnee, dossier, dossier.entite_id).ok ? conversationDonnee : null;
  const conversation = donneeOk || conversationDuVoucher({ conversations: etat.brut.whatsapp_conversations || [], dossier, admins, entiteVoucher: dossier.entite_id });
  const telephone = (conversation && conversation.telephone) || (client && client.telephone) || "";
  const copier = h("button", { class: "secondaire", type: "button" }, icone("copier", 18), tr("Copier"));
  const ouvrir = h("a", { class: "bouton secondaire", target: "_blank", rel: "noopener" }, icone("whatsapp", 18), tr("Ouvrir dans WhatsApp"));
  const envoyer = conversation ? h("button", { class: "principal", type: "button", disabled: true }, icone("whatsapp", 18), tr("Envoyer dans la conversation")) : null;
  let fenetreOk = false;
  let bloque = false;
  // Le texte refusé par whatsapp-envoi (contenu_interne ou montant_a_confirmer) : ni copie, ni lien, ni envoi tant qu'il n'a pas changé.
  // Le motif est dit en clair (motifRefusEnvoi). Un net (contenu_interne) : refus sec. Un prix de vente qui est aussi le net d'un autre
  // service (montant_a_confirmer) : « Envoyer quand même » pour ce texte-là seulement (relecture de la PR 317).
  let refuse = null;
  let motif = null;
  let confirmation = null;

  // Le texte est relu à chaque frappe : un nom de partenaire ou de contact typé bloque la copie, le lien et l'envoi.
  const maj = () => {
    const texte = zone.value.trim();
    const noms_ = resteBloque(texte, { noms });
    const aRefaire = refuse !== null && texte === refuse;
    alerte.textContent = noms_.length
      ? tr("À retirer du message : {liste}.", { liste: noms_.join(", ") })
      : aRefaire
        ? motif
          ? tr(motif.texte, motif.vars)
          : tr("Le texte contient un net, une commission ou un nom de partenaire : corrigez-le avant de le copier ou de l'envoyer.")
        : !charges
          ? tr("Les fiches partenaires ou les contacts WhatsApp de Secret et de Taxi ne sont pas tous chargés : le texte ne peut pas être contrôlé ici. Copie et lien WhatsApp éteints ; l'envoi dans la conversation reste contrôlé par le serveur.")
          : "";
    alerte.hidden = !alerte.textContent;
    const ok = !!texte && !noms_.length && !aRefaire;
    copier.disabled = !ok || !charges;
    const lien = ok && charges ? lienWhatsApp(telephone, texte) : null;
    if (lien) ouvrir.setAttribute("href", lien);
    else ouvrir.removeAttribute("href");
    ouvrir.classList.toggle("desactive", !lien);
    ouvrir.setAttribute("aria-disabled", String(!lien));
    if (envoyer) envoyer.disabled = bloque || !ok || !fenetreOk;
    refaire.hidden = !modifie;
    if (confirmation) confirmation.hidden = !aRefaire;
  };
  zone.addEventListener("input", () => {
    modifie = zone.value.trim() !== message().trim();
    maj();
  });
  refaire.addEventListener("click", () => {
    zone.value = message();
    modifie = false;
    maj();
  });

  // Trois au plus par famille, dix en tout : la liste reste courte sur un téléphone.
  const parFamille = new Map();
  const montrees = liste.filter((x) => {
    const n = (parFamille.get(x.famille) || 0) + 1;
    parFamille.set(x.famille, n);
    return n <= 3 || choisis.includes(x.prestation.id);
  }).slice(0, 10);
  const cases = montrees.map((x) => {
    const id = `excursion-${x.prestation.id}`;
    const caseX = h("input", { type: "checkbox", id, checked: choisis.includes(x.prestation.id) });
    caseX.addEventListener("change", () => {
      choisis = caseX.checked ? [...choisis, x.prestation.id].slice(-max) : choisis.filter((v) => v !== x.prestation.id);
      for (const autre of listeCases.querySelectorAll("input")) autre.checked = choisis.includes(autre.id.replace("excursion-", ""));
      if (!modifie) zone.value = message();
      maj();
    });
    return h("li", null, h("label", { for: id }, caseX, " ", h("strong", null, nomService(x.prestation, x.page)), h("span", { class: "aide" }, ` · ${prixTexte(x, devise)}`)));
  });
  const listeCases = h("ul", { class: "excursion-choix" }, cases);

  copier.addEventListener("click", async () => {
    if (copier.disabled) return;
    try {
      await navigator.clipboard.writeText(zone.value.trim());
      toast(tr("Message copié."));
    } catch {
      toast(tr("Copie impossible dans ce navigateur."), true);
    }
  });
  ouvrir.addEventListener("click", (e) => {
    if (!ouvrir.getAttribute("href")) e.preventDefault();
  });

  if (envoyer && conversation) {
    etat.store.whatsappMessages(conversation.id).then(
      (messages) => {
        fenetreOk = fenetre(messages || []).ouverte;
        if (!fenetreOk) dire(tr("Le client a écrit il y a plus de 24 h : copiez le message ou ouvrez WhatsApp."));
        maj();
      },
      () => maj()
    );
    // `confirmes` : la liste de « Envoyer quand même », valable pour le texte refusé tel quel ; le serveur la revérifie.
    const partir = async (confirmes = null) => {
      if (confirmes ? zone.value.trim() !== refuse || bloque || !fenetreOk : envoyer.disabled) return;
      envoyer.disabled = true;
      etatEnvoi.hidden = true;
      const texte = zone.value.trim();
      const res = await etat.store.whatsappEnvoyer({ conversation_id: conversation.id, texte, ...(confirmes ? { montants_confirmes: confirmes } : {}) });
      if (res && (res.ok || res.demo)) {
        bloque = true;
        toast(res.demo ? tr("En démo, rien ne part : le message serait envoyé dans la conversation WhatsApp.") : tr("Message envoyé dans la conversation WhatsApp."));
        fermer();
        return;
      }
      const code = (res && res.erreur) || "inconnu";
      // Refus contenu_interne (net, commission ou nom trouvé par le serveur) ou montant_a_confirmer (montant égal à un prix d'achat) : le motif
      // en clair, la copie et le lien s'éteignent aussi jusqu'à ce que le texte change (revue de la PR 310). Le 409 seul se confirme.
      // Les autres refus sûrs ou un résultat incertain éteignent l'envoi.
      motif = motifRefusEnvoi(res, { texte, nombre: (n) => n.toLocaleString(langueActive() === "en" ? "en-GB" : "fr-FR") });
      if (code === "contenu_interne" || code === "montant_a_confirmer") refuse = texte;
      else if (envoiIncertain(code) || ["droit_manquant", "fenetre_fermee"].includes(code)) bloque = true;
      if (motif && motif.confirmer) {
        const liste = motif.confirmer;
        confirmation = h("button", { class: "secondaire", type: "button", onclick: () => partir(liste) }, tr("Envoyer quand même"));
        etatEnvoi.replaceChildren(confirmation);
        etatEnvoi.hidden = false;
      } else if (motif) etatEnvoi.hidden = true;
      else dire(tr(ERREURS_ENVOI[codeEnvoi(code, res && res.a_retirer)] || ERREURS_ENVOI.verifier_whatsapp));
      maj();
    };
    envoyer.addEventListener("click", () => partir());
  }
  function dire(texte) {
    etatEnvoi.replaceChildren(h("p", null, texte));
    etatEnvoi.hidden = false;
  }

  maj();
  const fermer = modal(
    tr("Proposer une excursion"),
    h(
      "div",
      { class: "modal-corps proposer-excursion" },
      h(
        "p",
        { class: "aide" },
        taxi
          ? client
            ? tr("Pour {nom}, client de Taxi. Cochez deux ou trois exemples, relisez le message : rien ne part sans vous.", { nom: nomClient(client) })
            : tr("Client de Taxi. Cochez deux ou trois exemples, relisez le message : rien ne part sans vous.")
          : client
            ? tr("Pour {nom}. Cochez une ou deux excursions, relisez le message : rien ne part sans vous.", { nom: nomClient(client) })
            : tr("Cochez une ou deux excursions, relisez le message : rien ne part sans vous.")
      ),
      listeCases,
      h("div", { class: "champ" }, h("label", { for: "excursion-message" }, tr("Message au client (anglais)")), zone, refaire),
      alerte,
      etatEnvoi,
      h("div", { class: "actions" }, copier, ouvrir, envoyer)
    ),
    { protege: false }
  );
}
