// Demandes du site et conversations WhatsApp reliées (migration 72, demande de Jérémy du 21.11.2026 : « Oui, relie-les »).
//   * accordAvantDossier : avant de créer un dossier (carte de l'Assistant, « Confirmer » une demande), une demande du même client
//     confirmée depuis moins de 30 jours avec son dossier demande l'accord : « Ce client a déjà le dossier … Créer quand même ? ».
//   * relierDemandesApresDossier : après un dossier validé, la demande du site « nouvelle » du même client dans la même entreprise passe
//     « confirmée » avec ce dossier. D'office seulement pour une seule demande dont un service du dossier a la même date ou le même
//     produit ; sinon une petite fenêtre les montre et Nani coche. Un lien posé d'office s'annule 24 heures (« Annuler ce lien »).
//   * relierConversationApresDemande : après « Confirmer », la conversation WhatsApp du même numéro se relie au client et au dossier, sans
//     jamais écraser une liaison déjà posée ni relier un contact personnel.
//   * avertissementDossier : sur une demande à traiter, « Ce client a déjà un dossier : … » (dossier récent du même numéro).
// La base décide (demande_site_relier, demande_site_delier, whatsapp_relier_apres_demande) ; ici on propose et on dit ce qui s'est passé.
// Un refus ne défait jamais le dossier créé : un message le dit. Rien ne part au client ni au prestataire.
// Limite connue : deux appareils qui créent le dossier du même client à quelques millisecondes d'écart peuvent encore donner deux dossiers
// (pas de réservation en base) ; la relecture, l'accord et le refus « doublon possible » réduisent la fenêtre.
import { etat, permissionsDe, voitToutDans, estSuperAdmin, appliquerLignes, naviguer } from "../etat.mjs";
import { h, modal, toast, icone, confirmer } from "../ui.mjs";
import { tr, localeActive } from "../i18n.mjs";
import { aujourdhui } from "../calc.mjs";
import { demandesPourDossier, choixDemandes, telephonesDuDossier, dossiersRecents, serviceCorrespond, confirmeesRecentes, refusDelier, conversationDeClient } from "../demandes-whatsapp-calc.mjs";
import { titreDemande } from "../demandes-site-calc.mjs";
import { lecteurWhatsApp } from "../whatsapp-calc.mjs";
import { PRODUITS_SITE } from "../site-produits.mjs";
import { PRODUITS_CARNET } from "../carnet-produits.mjs";

const entiteDe = (id) => ((etat.brut && etat.brut.entites) || []).find((e) => e.id === id) || null;
const refDemande = (d) => d.ref || titreDemande(d);
const dossierDe = (id) => ((etat.brut && etat.brut.dossiers) || []).find((x) => x.id === id) || null;
const jourCourt = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(localeActive(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "");
// L'écran des demandes, onglet « Traitées », dans l'entreprise de la demande.
const lienDemandes = (entiteId) => `#/demandes?onglet=traitees${entiteId && entiteId !== etat.entiteId ? `&entite=${entiteId}` : ""}`;
const lienDossier = (dossier) => `#/dossier/${dossier.id}${dossier.entite_id && dossier.entite_id !== etat.entiteId ? `?entite=${dossier.entite_id}` : ""}`;
const lien = (href, texte) => h("a", { href, onclick: (e) => (e.preventDefault(), naviguer(href)) }, texte);

// Qui relie une demande : qui lit les demandes de l'entreprise et y écrit les dossiers (le droit de « Confirmer »).
const relieDemandes = (entiteId) => Array.isArray(etat.brut && etat.brut.demandes_site) && ["dossiers.lire", "dossiers.ecrire"].every((p) => permissionsDe(entiteId).includes(p)) && voitToutDans(entiteId);
// Qui relie une conversation : l'administration de la boîte de cette entreprise (whatsapp_ecrit). Les autres n'ont pas la boîte : rien à dire.
const ecritWhatsApp = (entiteId) => !!etat.brut && etat.brut.whatsapp_disponible === true && lecteurWhatsApp({ entite: entiteDe(entiteId), superAdmin: estSuperAdmin(), permissions: permissionsDe(entiteId), voitTout: voitToutDans(entiteId) });

// La migration 72 manque : dit une seule fois par session.
let absenceDite = false;
function direAbsence() {
  if (absenceDite) return;
  absenceDite = true;
  toast(tr("La liaison entre les demandes du site et WhatsApp n'est pas encore en place (migration 72) : rien n'a été relié."));
}

// ---- 0. Avant de créer un dossier ----------------------------------------------------------------------------------------------------
// `telephones` : ceux du client (fiche de la carte, conversation WhatsApp) ; `entites` : où le dossier va être créé ; `exclure` : la demande
// qu'on confirme. Rend true pour créer : aucune demande confirmée récente, ou Nani a dit « Créer quand même ».
export async function accordSecondDossier({ telephones = [], entites = [], exclure = null } = {}) {
  try {
    const tels = telephones.filter(Boolean);
    if (!tels.length || !Array.isArray(etat.brut && etat.brut.demandes_site)) return true;
    const deja = confirmeesRecentes({ demandes: etat.brut.demandes_site, telephones: tels, entites: entites.filter(Boolean), dossiers: etat.brut.dossiers || [], aujourdhui: aujourdhui(), exclure });
    if (!deja.length) return true;
    const { demande, dossier } = deja[0];
    return await confirmer(tr("Ce client a déjà le dossier {dossier} depuis une demande du site ({ref}). Créer quand même ?", { dossier: dossier.ref || "", ref: refDemande(demande) }), tr("Créer quand même"));
  } catch (err) {
    console.error("demandes du site : avant le dossier", err);
    return true;
  }
}
// La même chose depuis une carte de l'Assistant : numéro de la carte et de la conversation WhatsApp liée, entreprises des services.
export function accordAvantDossier(donnees = {}, { whatsappId = null } = {}) {
  const wa = whatsappId ? ((etat.brut && etat.brut.whatsapp_conversations) || []).find((x) => x.id === whatsappId) : null;
  const telephones = [((donnees || {}).client || {}).telephone, wa && conversationDeClient(wa) ? wa.telephone : null];
  const entites = [...new Set(((donnees || {}).services || []).map((s) => s.entite_id).filter(Boolean))];
  return accordSecondDossier({ telephones, entites: entites.length ? entites : [etat.entiteId] });
}

// ---- 1. Dossier créé : la demande du site ---------------------------------------------------------------------------------------------
const REFUS_DEMANDE = {
  droit: (ref) => tr("Dossier créé. Votre rôle ne permet pas de relier la demande du site {ref}.", { ref }),
};
// « Annuler ce lien » : la demande redevient « nouvelle » (24 heures). Le dossier reste.
async function delier(d, bouton = null) {
  if (bouton) bouton.disabled = true;
  let x;
  try {
    x = await appliquerLignes(async () => {
      const r = await etat.store.demandeSiteDelier(d.id);
      return { resultat: r, lignes: r && r.demande ? { demandes_site: [r.demande] } : {} };
    });
    x = x.resultat;
  } catch (err) {
    if (bouton) bouton.disabled = false;
    return void toast(tr("Le lien n'a pas pu être annulé : {message}", { message: err.message }), true);
  }
  if (!x) return direAbsence();
  if (!x.delie) return void toast(x.motif === "trop_tard" ? tr("Plus de 24 heures : ce lien ne s'annule plus ici.") : tr("Ce lien ne peut pas être annulé."), true);
  toast(tr("Lien annulé : la demande du site {ref} est de nouveau à traiter.", { ref: refDemande(d) }));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
export const boutonDelier = (d) =>
  etat.store.demandeSiteDelier && !refusDelier(d) && relieDemandes(d.entite_id) ? h("button", { class: "secondaire petit", type: "button", onclick: (e) => delier(d, e.currentTarget) }, tr("Annuler ce lien")) : null;

// Relie une demande au dossier. Rend true si c'est fait. `annoncer` : le toast avec le lien et « Annuler ce lien ».
async function relierUne(d, dossier, { annoncer = true } = {}) {
  let x;
  try {
    x = await appliquerLignes(async () => {
      const r = await etat.store.demandeSiteRelier(d.id, dossier.id);
      return { resultat: r, lignes: r && r.demande ? { demandes_site: [r.demande] } : {} };
    });
    x = x.resultat;
  } catch (err) {
    toast(tr("Dossier créé, mais la demande du site {ref} n'a pas pu être reliée : {message}", { ref: refDemande(d), message: err.message }), true);
    return false;
  }
  if (!x) return direAbsence(), false;
  if (!x.relie) {
    // Déjà traitée : un autre dossier existe sans doute pour ce client. Erreur, avec le lien vers ce dossier.
    const autre = x.motif === "deja_traitee" ? dossierDe(x.dossier_id) : null;
    if (x.motif === "deja_traitee")
      toast(h("span", null, tr("Doublon possible : la demande du site {ref} a déjà le dossier {dossier}.", { ref: refDemande(d), dossier: (autre && autre.ref) || "" }), " ", autre ? lien(lienDossier(autre), tr("Ouvrir ce dossier")) : null), true);
    else toast((REFUS_DEMANDE[x.motif] || ((ref) => tr("Dossier créé. La demande du site {ref} n'a pas été reliée.", { ref })))(refDemande(d)));
    return false;
  }
  const reliee = x.demande || { ...d, statut: "confirmee", dossier_id: dossier.id };
  if (annoncer)
    toast(
      h(
        "span",
        { class: "dwa-toast" },
        tr("Demande du site {ref} reliée au dossier {dossier} : elle passe « confirmée ».", { ref: refDemande(d), dossier: dossier.ref || "" }),
        " ",
        h("a", { href: lienDemandes(d.entite_id) }, tr("Voir la demande")),
        " ",
        etat.store.demandeSiteDelier ? h("button", { class: "lien", type: "button", onclick: (e) => delier(reliee, e.currentTarget) }, tr("Annuler ce lien")) : null
      )
    );
  // La demande est acceptée : sa conversation WhatsApp se relie aussi (sans rien écraser), si l'Assistant ne l'a pas déjà fait.
  await relierConversationApresDemande(reliee, { dossier, discret: true });
  return true;
}

// Plusieurs demandes au même numéro, ou une seule sans service qui corresponde : Nani coche celles que ce dossier couvre.
// Rien n'est coché d'avance, rien n'est relié sans elle.
function choisirDemandes(liste, dossier) {
  const cases = liste.map((d) => ({ d, input: h("input", { type: "checkbox", value: d.id }) }));
  let fermer;
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const relier = async (btn) => {
    const choisies = cases.filter((c) => c.input.checked).map((c) => c.d);
    if (!choisies.length) return (erreur.textContent = tr("Cochez au moins une demande, ou touchez « Ne rien relier »."));
    btn.disabled = true;
    let faites = 0;
    for (const d of choisies) if (await relierUne(d, dossier, { annoncer: false })) faites++;
    fermer();
    if (faites) toast(h("span", null, faites === 1 ? tr("1 demande du site reliée au dossier {dossier}.", { dossier: dossier.ref || "" }) : tr("{n} demandes du site reliées au dossier {dossier}.", { n: faites, dossier: dossier.ref || "" }), " ", h("a", { href: lienDemandes(dossier.entite_id) }, tr("Voir les demandes"))));
  };
  fermer = modal(
    tr("Demandes du site de ce client"),
    h(
      "div",
      { class: "modal-corps dwa-choix" },
      h(
        "p",
        { class: "aide" },
        liste.length === 1
          ? tr("Une demande du site vient du même numéro, mais aucun service du dossier {dossier} n'a sa date ni son produit. Cochez-la si ce dossier la couvre : elle passe « confirmée ». Sinon, elle reste à traiter.", { dossier: dossier.ref || "" })
          : tr("{n} demandes du site viennent du même numéro. Cochez celles que le dossier {dossier} couvre : elles passent « confirmée ». Les autres restent à traiter.", { n: liste.length, dossier: dossier.ref || "" })
      ),
      h(
        "ul",
        { class: "dwa-liste" },
        cases.map(({ d, input }) =>
          h("li", null, h("label", { class: "dwa-case" }, input, h("span", null, h("strong", null, refDemande(d)), h("span", { class: "dwa-detail" }, [titreDemande(d), jourCourt(d.date_service), d.heure, d.nom].filter(Boolean).join(" · ")))))
        )
      ),
      erreur,
      h(
        "div",
        { class: "barre-modal" },
        h("button", { class: "principal", type: "button", onclick: (e) => relier(e.currentTarget) }, tr("Relier la sélection")),
        h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Ne rien relier"))
      )
    ),
    { protege: false }
  );
}

// Après un dossier validé (un ou deux dossiers : espace unifié). Ne lève jamais : une panne ici ne gêne pas la validation.
export async function relierDemandesApresDossier(dossiers = []) {
  try {
    if (!etat.store.demandeSiteRelier) return;
    for (const dossier of dossiers.filter((x) => x && x.id)) {
      if (!relieDemandes(dossier.entite_id)) continue;
      const telephones = telephonesDuDossier({ dossier, clients: etat.brut.clients || [], conversations: etat.brut.whatsapp_conversations || [] });
      const liste = demandesPourDossier({ demandes: etat.brut.demandes_site || [], dossier, telephones });
      const reservations = (etat.brut.reservations || []).filter((r) => r.dossier_id === dossier.id);
      const choix = choixDemandes(liste, { correspond: (d) => serviceCorrespond({ demande: d, reservations, produits: [...PRODUITS_SITE, ...PRODUITS_CARNET] }) });
      if (choix === "relier") await relierUne(liste[0], dossier);
      // La fenêtre n'est pas attendue : la carte se valide, Nani coche quand elle veut.
      else if (choix === "choisir") choisirDemandes(liste, dossier);
    }
  } catch (err) {
    console.error("demandes du site : après le dossier", err);
  }
}

// ---- 2. Demande acceptée : la conversation WhatsApp ------------------------------------------------------------------------------------
const MOTIFS_CONVERSATION = {
  droit_whatsapp: () => tr("La conversation WhatsApp n'a pas été reliée : votre rôle ne le permet pas."),
  personnel: () => tr("Contact personnel : sa conversation WhatsApp n'est pas reliée."),
  deja_relie: () => tr("La conversation WhatsApp garde le client et le dossier déjà reliés."),
  plusieurs: () => tr("Plusieurs conversations WhatsApp ont ce numéro : reliez la bonne depuis l'écran WhatsApp."),
  autre_entreprise: () => tr("La conversation WhatsApp de ce numéro est rangée dans l'autre entreprise : elle n'est pas reliée."),
};
// `dossier` : pour le message (référence) ; `discret` : seulement ce qui s'est passé, sans redire un refus attendu.
export async function relierConversationApresDemande(demande, { dossier = null, discret = false } = {}) {
  if (!demande || !etat.store.whatsappRelierApresDemande || !ecritWhatsApp(demande.entite_id)) return null;
  let r;
  try {
    r = await appliquerLignes(async () => {
      const x = await etat.store.whatsappRelierApresDemande(demande.id);
      return { resultat: x, lignes: x && x.conversation ? { whatsapp_conversations: [x.conversation] } : {} };
    });
    r = r.resultat;
  } catch (err) {
    toast(tr("La conversation WhatsApp n'a pas pu être reliée : {message}", { message: err.message }));
    return null;
  }
  if (!r) return direAbsence(), null;
  const ref = (dossier && dossier.ref) || (dossierDe(demande.dossier_id) || {}).ref || "";
  if (r.motif === "relie") toast(tr("Conversation WhatsApp reliée au dossier {ref}.", { ref }));
  else if (MOTIFS_CONVERSATION[r.motif] && !(discret && r.motif === "deja_relie")) toast(MOTIFS_CONVERSATION[r.motif]());
  return r;
}

// ---- 3. Avant « Confirmer » --------------------------------------------------------------------------------------------------------------
export function avertissementDossier(d) {
  if (!d || d.statut !== "nouvelle" || !etat.db) return null;
  const liste = dossiersRecents({ demande: d, dossiers: etat.db.dossiers || [], clients: etat.db.clients || [], reservations: etat.db.reservations || [], conversations: (etat.brut && etat.brut.whatsapp_conversations) || [], aujourdhui: aujourdhui() });
  if (!liste.length) return null;
  const liens = liste.slice(0, 3).flatMap((x, i) => [i ? ", " : "", lien(lienDossier(x), x.ref)]);
  return h("p", { class: "dsite-deja", role: "note" }, icone("dossiers", 16), h("span", null, liste.length === 1 ? tr("Ce client a déjà un dossier :") : tr("Ce client a déjà {n} dossiers récents :", { n: liste.length }), " ", ...liens));
}
