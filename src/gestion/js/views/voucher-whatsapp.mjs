// « Envoyer dans la conversation WhatsApp » (21.11.2026, demande de Jérémy) : l'image du voucher part par Telnyx dans la conversation du
// client, du numéro de l'entreprise. Nani la voit aussi sur son téléphone (coexistence). L'envoi habituel depuis le téléphone reste à côté.
// Le bouton n'existe que si la conversation du client existe (conversationDuVoucher) et rien ne part sans la confirmation : nom, numéro
// masqué en partie, image et message sous l'image. Le serveur refait tous les contrôles (supabase/functions/whatsapp-envoi/voucher.js).
// Utilisé par la fenêtre d'envoi du voucher (voucher-envoi.mjs) et par les cartes de l'Assistant (agent-cartes-voucher.mjs), toujours dans
// l'entreprise de la réservation.
import { etat, entitesAccessibles, estSuperAdmin, permissionsDe, voitToutDans, peut } from "../etat.mjs";
import { h, icone, modal, toast } from "../ui.mjs";
import { tr } from "../i18n.mjs";
import { aujourdhui } from "../calc.mjs";
import { bloquantsReponse } from "../agent-calc.mjs";
import { envoiANoter } from "../envoi-voucher-calc.mjs";
import { lecteurWhatsApp, nomConversation, fenetre, numeroAffiche, montantsAConfirmer, LECTURE_IMPOSSIBLE } from "../whatsapp-calc.mjs";
import { conversationDuVoucher, numeroMasque, numeroDifferent, legendeValide, octets, LEGENDE_MAX_OCTETS, erreurVoucher, voucherIncertain } from "../whatsapp-voucher-calc.mjs";
import { noterEnvoi } from "./envois-vouchers.mjs";
import { vouchersDuDossier } from "./voucher.mjs";

// Les entreprises du numéro que la personne administre (Secret, Taxi). Jamais l'écran thaï des vouchers (vouchers.seul).
export const adminsWhatsApp = () =>
  etat.brut ? entitesAccessibles().filter((e) => lecteurWhatsApp({ entite: e, superAdmin: estSuperAdmin(), permissions: permissionsDe(e.id), voitTout: voitToutDans(e.id), voucherSeul: permissionsDe(e.id).includes("vouchers.seul") })).map((e) => e.id) : [];

// La conversation du client pour ce voucher (entreprise de la réservation ouverte), ou null.
export function conversationPourVoucher(x) {
  if (!x || !x.reservation || !etat.brut || !etat.db) return null;
  const r = x.reservation;
  const dossier = etat.db.dossiers.find((d) => d.id === r.dossier_id) || null;
  return conversationDuVoucher({ conversations: etat.brut.whatsapp_conversations || [], dossier, admins: adminsWhatsApp(), entiteVoucher: r.entite_id || etat.entiteId });
}

const clientDe = (c) => (c && c.client_id ? (etat.brut.clients || []).find((x) => x.id === c.client_id) || null : null);

// Note l'envoi au client dans le dossier (même trace que le partage du téléphone) ; un renvoi du jour d'un voucher modifié fige la nouvelle version.
export async function noterEnvoiClient(r) {
  if (!peut("dossiers.ecrire")) return false;
  const courante = etat.db.reservations.find((z) => z.id === r.id) || r;
  const modifie = !!((vouchersDuDossier(courante.dossier_id).find((v) => v.reservation.id === courante.id) || {}).envoi || {}).modifie;
  const date = aujourdhui();
  const cible = envoiANoter({ pour: "client", issue: "gestion", envois: courante.details && courante.details.envois, date, modifie });
  return cible ? noterEnvoi(courante, cible, date) : false;
}

// Le bouton de la fenêtre d'envoi, une fois l'image prête. `fichier()` rend l'image ; `legende()` le message.
export function boutonVoucherWhatsApp({ x, conversation, fichier, legende, noter = null, classe = "secondaire" }) {
  if (!conversation) return null;
  return h("button", { class: classe, type: "button", onclick: () => fichier() && confirmerVoucherWhatsApp(x, { conversation, fichier: fichier(), legende: legende(), noter }) }, icone("whatsapp", 18), tr("Envoyer dans la conversation WhatsApp"));
}

let adresseImage = null;

// Identifiant de la confirmation ouverte : la clé du verrou en base (gestion-voucher:<réservation>:<id>). Un double clic ou un nouvel essai
// de la même confirmation ne range jamais deux messages.
const nouvelEssai = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));

// La confirmation, puis l'envoi. `noter` : ce que fait l'écran appelant une fois parti (sinon noterEnvoiClient).
export function confirmerVoucherWhatsApp(x, { conversation: c, fichier, legende = "", noter = null, avantNavigation = null }) {
  const r = x.reservation;
  const client = clientDe(c);
  const nom = nomConversation(c, client);
  const essai = nouvelEssai();
  // Le numéro de la conversation n'est pas celui de la fiche client du dossier : numéro complet, avertissement, case à cocher.
  const dossier = etat.db.dossiers.find((d) => d.id === r.dossier_id) || {};
  const fiche = etat.db.clients.find((y) => y.id === dossier.client_id) || null;
  const autreNumero = numeroDifferent(c.telephone, fiche && fiche.telephone);
  const confirmeNumero = autreNumero ? h("input", { type: "checkbox", id: "wa-voucher-numero" }) : null;
  if (adresseImage) URL.revokeObjectURL(adresseImage);
  adresseImage = URL.createObjectURL(fichier);

  const zone = h("textarea", { id: "wa-voucher-legende", rows: 6, maxlength: 2000, "aria-describedby": "wa-voucher-compte" });
  zone.value = String(legende || "").trim();
  const compte = h("p", { class: "aide", id: "wa-voucher-compte" });
  const fen = h("p", { class: "aide", role: "status" }, tr("Vérification de la fenêtre de 24 h…"));
  const etatEnvoi = h("div", { class: "partage-etat", role: "alert", hidden: true });
  const envoyer = h("button", { class: "principal", type: "button", disabled: true }, icone("whatsapp", 18), tr("Envoyer dans la conversation WhatsApp"));
  let fenetreOk = false;
  let bloque = false; // résultat inconnu ou refus définitif : le bouton ne se rallume pas
  const maj = () => {
    const n = octets(zone.value.trim());
    compte.textContent = tr("Longueur : {n} sur {max}", { n, max: LEGENDE_MAX_OCTETS });
    compte.classList.toggle("erreur-form", n > LEGENDE_MAX_OCTETS);
    envoyer.disabled = bloque || !fenetreOk || !legendeValide(zone.value) || (autreNumero && !confirmeNumero.checked);
  };
  zone.addEventListener("input", maj);
  if (confirmeNumero) confirmeNumero.addEventListener("change", maj);
  maj();

  const dire = (texte) => {
    etatEnvoi.replaceChildren(h("p", null, h("strong", null, texte)));
    etatEnvoi.hidden = false;
  };

  // La fenêtre de 24 h, vue depuis les messages : le serveur la revérifie (base et Telnyx), l'écran évite seulement un envoi voué au refus.
  etat.store.whatsappMessages(c.id).then(
    (messages) => {
      const f = fenetre(messages || []);
      fenetreOk = f.ouverte;
      fen.textContent = f.ouverte ? tr("Le client a écrit il y a moins de 24 h : l'image peut partir.") : tr(erreurVoucher("fenetre_fermee"));
      fen.classList.toggle("erreur-form", !f.ouverte);
      maj();
    },
    () => {
      fen.textContent = tr("La conversation n'a pas pu être relue. Réessayez dans un instant.");
      fen.classList.add("erreur-form");
    }
  );

  // `confirmes` : les montants confirmés après un refus « montant_a_confirmer » (net d'un autre service du catalogue), renvoyés tels quels.
  async function partir(confirmes = []) {
    if (envoyer.disabled) return;
    envoyer.disabled = true;
    etatEnvoi.hidden = true;
    const res = await etat.store.whatsappEnvoyerVoucher({ conversation_id: c.id, reservation_id: r.id, essai_id: essai, legende: zone.value.trim(), numero_confirme: autreNumero && confirmeNumero.checked ? c.telephone : "", montants_confirmes: confirmes, fichier });
    if (res && res.ok) {
      bloque = true;
      await (noter ? noter() : noterEnvoiClient(r));
      toast(res.demo ? tr("En démo, rien ne part : l'image apparaît dans le fil de la conversation.") : tr("Voucher envoyé dans la conversation WhatsApp."));
      fermer();
      return;
    }
    const code = (res && res.erreur) || "inconnu";
    if (voucherIncertain(code)) {
      bloque = true;
      maj();
      // Le message est déjà dans le fil (« envoi ») : l'écran WhatsApp propose « C'est parti » ou « Pas parti » après 30 secondes.
      return dire(tr(erreurVoucher(code)));
    }
    if (["fenetre_fermee", "coexistence_inactive", "contact_non_client", "contact_personnel", "conversation_autre_dossier", "conversation_autre_entreprise", "reservation_annulee", "droit_manquant", "deja_traitee", "image_trop_grosse", "image_trop_grande", "image_invalide"].includes(code)) bloque = true;
    const aConfirmer = montantsAConfirmer(res);
    if (aConfirmer.length) {
      // Rien n'est parti : Nani confirme d'un clic, la même légende repart avec cette liste (la fonction la revérifie).
      const encore = h("button", { class: "secondaire", type: "button" }, tr("Envoyer quand même"));
      encore.addEventListener("click", () => partir(aConfirmer));
      etatEnvoi.replaceChildren(h("p", null, h("strong", null, tr("Le montant {liste} est aussi le net d'un autre service du catalogue. Envoyez-le seulement si c'est bien le prix de vente pour ce client.", { liste: aConfirmer.join(", ") }))), encore);
      etatEnvoi.hidden = false;
      return maj();
    }
    if (code === "contenu_interne") {
      const brut = ((res && res.a_retirer) || []).filter((v) => v !== LECTURE_IMPOSSIBLE);
      const b = bloquantsReponse(brut);
      const aRetirer = [...b.montants.map(String), ...b.noms];
      dire(brut.length < ((res && res.a_retirer) || []).length ? tr(erreurVoucher("partenaires_illisibles")) : aRetirer.length ? tr("À retirer du message : {liste}. Rien n'est parti.", { liste: aRetirer.join(", ") }) : tr(erreurVoucher(code)));
    } else dire(tr(erreurVoucher(code, { aVerifier: !!(res && res.a_verifier) })));
    maj();
  }
  envoyer.addEventListener("click", () => partir());

  const fermer = modal(
    tr("Envoyer dans la conversation WhatsApp"),
    h(
      "div",
      { class: "modal-corps envoi-voucher wa-voucher" },
      h("p", { class: "wa-voucher-a" }, h("strong", null, nom), " · ", h("span", { class: "wa-voucher-numero" }, autreNumero ? numeroAffiche(c.telephone) : numeroMasque(c.telephone))),
      autreNumero
        ? h(
            "div",
            { class: "bandeau-info wa-voucher-autre-numero", role: "status" },
            h("p", null, tr("Ce numéro n'est pas celui de la fiche client ({fiche}). Vérifiez que c'est bien la conversation du client.", { fiche: (fiche && fiche.telephone) || "" })),
            h("label", { for: "wa-voucher-numero" }, confirmeNumero, " ", tr("C'est bien le numéro du client"))
          )
        : null,
      h("div", { class: "envoi-apercu" }, h("img", { src: adresseImage, alt: tr("Image du voucher") })),
      h("div", { class: "champ" }, h("label", { for: "wa-voucher-legende" }, tr("Message sous l'image")), zone, compte),
      fen,
      h("p", { class: "aide" }, tr("L'image part du numéro de l'entreprise dans cette conversation seulement. Vous la verrez aussi dans WhatsApp sur votre téléphone.")),
      etatEnvoi,
      h("div", { class: "actions" }, h("button", { class: "secondaire", type: "button", onclick: () => fermer() }, tr("Annuler")), envoyer)
    ),
    { protege: false, ferme: () => avantNavigation && avantNavigation() }
  );
}
