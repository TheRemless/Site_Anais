// « Proposer une excursion » (22.11.2026) : sur la fiche d'un dossier de Taxi ou de Secret, et sur la carte d'une conversation WhatsApp
// reliée à un dossier. Composant à part : la fiche et la carte n'ajoutent qu'un appel à boutonProposerExcursion (les écrans WhatsApp sont
// travaillés par une autre session). Logique dans excursion-proposee-calc.mjs.
// Rien ne part tout seul : Nani coche une ou deux excursions, relit le message, puis le copie, l'ouvre dans WhatsApp (wa.me) ou l'envoie
// dans la conversation du client si le client a écrit il y a moins de 24 h (whatsapp-envoi, avec ses contrôles des nets et des noms).
import { etat, entitesAccessibles, organisationActiveId, reglagesDe, nomClient } from "../etat.mjs";
import { h, icone, modal, toast } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { aujourdhui } from "../calc.mjs";
import { exempleDe } from "../exemples.mjs";
import { resteBloque } from "../agent-calc.mjs";
import { marqueEntite, lienWhatsApp, fenetre, ERREURS_ENVOI, envoiIncertain, aConfirmerEnvoi } from "../whatsapp-calc.mjs";
import { conversationDuVoucher, contactVoucher } from "../whatsapp-voucher-calc.mjs";
import { possibilites, choixParDefaut, messageExcursions, estTransfert, sejour, sensTransfert, joursLibres, reservationsDuDossierLie, familleDe, nomService, prixTexte, nomsInterdits } from "../excursion-proposee-calc.mjs";
import { adminsWhatsApp } from "./voucher-whatsapp.mjs";

const MAX = 2;
const entite = (id) => (etat.brut.entites || []).find((e) => e.id === id) || null;
const secretAccessible = () => entitesAccessibles().find((e) => marqueEntite(e) === "secret") || null;

// Tout ce qu'il faut pour proposer, ou null : le bouton ne s'affiche pas (ZTP, pas de transfert, séjour trop court ou fini, rien au catalogue).
export function contexteProposition(dossier) {
  if (!etat.brut || !dossier || dossier.annule) return null;
  const marque = marqueEntite(entite(dossier.entite_id));
  const secret = secretAccessible();
  if (!marque || !secret) return null;
  const prestations = etat.brut.prestations || [];
  const trajets = etat.brut.trajets || [];
  const reservations = (etat.brut.reservations || []).filter((r) => r.dossier_id === dossier.id && r.statut !== "annule");
  const prestationDe = (r) => (r.prestation_id ? prestations.find((p) => p.id === r.prestation_id) || null : null);
  const trajetDe = (r) => (r.trajet_id ? trajets.find((t) => t.id === r.trajet_id) || null : null);
  const transferts = reservations.filter((r) => estTransfert(r, { prestation: prestationDe(r), taxi: marque === "taxi" }));
  const ile = exempleDe("lieu", organisationActiveId());
  const ajd = aujourdhui();
  // Le sens de chaque transfert (arrivée sur l'île, départ) : un départ seul n'ouvre plus un séjour qui commence ce jour-là.
  const s = sejour(transferts, { ile, ajd, sens: (r) => sensTransfert(r, { prestation: prestationDe(r), trajet: trajetDe(r), ile }) });
  if (!s) return null;
  // Les sorties déjà réservées : celles du dossier et du dossier lié de l'autre entreprise (Secret et Taxi d'une même demande, jamais ZTP).
  const lie = reservationsDuDossierLie(dossier, { dossiers: etat.brut.dossiers || [], reservations: etat.brut.reservations || [], marqueDe: (id) => marqueEntite(entite(id)) });
  const avecLie = [...reservations, ...lie];
  const sorties = avecLie.filter((r) => !estTransfert(r, { prestation: prestationDe(r), taxi: marqueEntite(entite(r.entite_id)) === "taxi" }));
  const libres = joursLibres(s, { ajd, occupes: sorties.map((r) => r.date_service).filter(Boolean) });
  if (!libres.length) return null;
  const enfants = Math.max(0, ...avecLie.map((r) => Number((r.personnes || {}).enfants) || 0));
  const dejaP = avecLie.map(prestationDe).filter((p) => p && p.entite_id === secret.id);
  const deja = { prestations: new Set(dejaP.map((p) => p.id)), familles: new Set(dejaP.filter((p) => p.famille !== "transfert").map(familleDe)) };
  const noms = nomsInterdits({ partenaires: etat.brut.partenaires, conversations: etat.brut.whatsapp_conversations });
  const liste = possibilites(prestations.filter((p) => p.entite_id === secret.id), { noms, deja, enfants, jours: libres });
  if (!liste.length) return null;
  const client = (etat.brut.clients || []).find((c) => c.id === dossier.client_id) || null;
  return { dossier, client, liste, noms, sejour: s, libres, taxi: marque === "taxi", devise: reglagesDe(secret.id).devise || "THB" };
}

export function boutonProposerExcursion({ dossier, conversation = null, classe = "secondaire petit" } = {}) {
  const ctx = contexteProposition(dossier);
  if (!ctx) return null;
  return h("button", { class: classe, type: "button", onclick: () => ouvrirProposition(ctx, conversation) }, icone("bateau", 16), tr("Proposer une excursion"));
}

function ouvrirProposition(ctx, conversationDonnee) {
  const { dossier, client, liste, noms, taxi, devise } = ctx;
  let choisis = choixParDefaut(liste, MAX);
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

  // Le texte est relu à chaque frappe : un nom de partenaire ou de contact typé bloque la copie, le lien et l'envoi.
  const maj = () => {
    const texte = zone.value.trim();
    const noms_ = resteBloque(texte, { noms });
    alerte.hidden = !noms_.length;
    alerte.textContent = noms_.length ? tr("À retirer du message : {liste}.", { liste: noms_.join(", ") }) : "";
    const ok = !!texte && !noms_.length;
    copier.disabled = !ok;
    const lien = ok ? lienWhatsApp(telephone, texte) : null;
    if (lien) ouvrir.setAttribute("href", lien);
    else ouvrir.removeAttribute("href");
    ouvrir.classList.toggle("desactive", !lien);
    ouvrir.setAttribute("aria-disabled", String(!lien));
    if (envoyer) envoyer.disabled = bloque || !ok || !fenetreOk;
    refaire.hidden = !modifie;
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
      choisis = caseX.checked ? [...choisis, x.prestation.id].slice(-MAX) : choisis.filter((v) => v !== x.prestation.id);
      for (const autre of listeCases.querySelectorAll("input")) autre.checked = choisis.includes(autre.id.replace("excursion-", ""));
      if (!modifie) zone.value = message();
      maj();
    });
    return h("li", null, h("label", { for: id }, caseX, " ", h("strong", null, nomService(x.prestation, x.page)), h("span", { class: "aide" }, ` · ${prixTexte(x, devise)}`)));
  });
  const listeCases = h("ul", { class: "excursion-choix" }, cases);

  copier.addEventListener("click", async () => {
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
    const partir = async (confirmes = []) => {
      if (envoyer.disabled) return;
      envoyer.disabled = true;
      etatEnvoi.hidden = true;
      const texte = zone.value.trim();
      const res = await etat.store.whatsappEnvoyer({ conversation_id: conversation.id, texte, montants_confirmes: confirmes });
      if (res && (res.ok || res.demo)) {
        bloque = true;
        toast(res.demo ? tr("En démo, rien ne part : le message serait envoyé dans la conversation WhatsApp.") : tr("Message envoyé dans la conversation WhatsApp."));
        fermer();
        return;
      }
      const code = (res && res.erreur) || "inconnu";
      const question = aConfirmerEnvoi(res, texte);
      if (question) {
        // Un prix de vente égal au net d'un autre service : Nani confirme d'un clic, la même liste repart et la fonction la revérifie.
        const encore = h("button", { class: "secondaire", type: "button" }, tr("Envoyer quand même"));
        encore.addEventListener("click", () => partir(question.renvoi));
        etatEnvoi.replaceChildren(h("p", null, h("strong", null, tr(question.texte, question.vars))), encore);
        etatEnvoi.hidden = false;
        return maj();
      }
      if (envoiIncertain(code) || ["contenu_interne", "droit_manquant", "fenetre_fermee"].includes(code)) bloque = true;
      dire(tr(ERREURS_ENVOI[code] || ERREURS_ENVOI.verifier_whatsapp));
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
      h("p", { class: "aide" }, client ? tr("Pour {nom}. Cochez une ou deux excursions, relisez le message : rien ne part sans vous.", { nom: nomClient(client) }) : tr("Cochez une ou deux excursions, relisez le message : rien ne part sans vous.")),
      listeCases,
      h("div", { class: "champ" }, h("label", { for: "excursion-message" }, tr("Message au client (anglais)")), zone, refaire),
      alerte,
      etatEnvoi,
      h("div", { class: "actions" }, copier, ouvrir, envoyer)
    ),
    { protege: false }
  );
}
