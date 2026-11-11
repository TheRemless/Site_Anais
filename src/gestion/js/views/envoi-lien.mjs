// Envoi par lien : le chemin qui marche dans tous les navigateurs, sur téléphone comme sur ordinateur. Le fichier (image du voucher, PDF d'un devis
// ou d'une facture) est déposé dans un stockage privé, le message WhatsApp contient une adresse signée qui expire, et le message dit vrai : il ne prétend
// jamais joindre un fichier. Un lien se révoque d'un tap (le fichier est supprimé) et les fichiers expirés sont retirés du stockage.
import { etat, peut } from "../etat.mjs";
import { h, confirmer, toast } from "../ui.mjs";
import { formatDate } from "../calc.mjs";
import { lienWhatsApp } from "../operations-calc.mjs";
import { DUREE_JOURS, messageLien } from "../liens-calc.mjs";
import { copierTexte } from "./partage.mjs";
import { tr } from "../i18n.mjs";

// Les fichiers des liens expirés partent une fois par ouverture de l'outil, à la première fenêtre d'envoi : pas de tâche planifiée à entretenir.
let nettoye = false;
async function nettoyerUneFois() {
  if (nettoye || !etat.store || !etat.store.nettoyerLiensEnvoi) return;
  nettoye = true;
  try {
    await etat.store.nettoyerLiensEnvoi(etat.entiteId);
  } catch {
    /* le nettoyage est sans conséquence pour la personne : il se retentera à la prochaine ouverture */
  }
}

// `genre` : « voucher », « devis » ou « facture » (texte du message) ; `kind` : « voucher » ou « document » (base) ; `droit` : droit requis.
// `elements()` : [{ fichier, objetId }], vide tant que les fichiers se préparent. `ids()` : identifiants des objets concernés (pour lister leurs liens).
// Renvoie null sans le droit : le bouton n'apparaît pas.
export function envoiParLien({ zone, genre, kind, droit, dossierId, langue, prenom, telephone, elements, ids, libelle, principal = true, surEnvoi = null, libelleEnCours = tr("Création du lien…") }) {
  if (!peut(droit)) return null;
  const bouton = h("button", { class: principal ? "principal" : "secondaire", type: "button" }, libelle);
  const liste = h("details", { class: "liens-existants", hidden: true });

  async function majListe() {
    try {
      const mien = new Set(ids());
      const liens = (await etat.store.liensEnvoi({ dossierId, genre: kind })).filter((l) => mien.has(l.objet_id));
      liste.hidden = !liens.length;
      liste.replaceChildren(
        h("summary", null, tr("Liens déjà envoyés ({n})", { n: liens.length })),
        h("ul", { class: "liens-liste" }, liens.map((l) => h("li", null, h("span", null, tr("Créé le {date}, valable jusqu'au {fin}", { date: formatDate(l.created_at.slice(0, 10)), fin: formatDate(l.expire_le.slice(0, 10)) })), h("span", { class: "actions gauche" },
          h("button", { class: "secondaire petit", type: "button", onclick: async () => {
            try {
              await copierTexte(await etat.store.lienSigneEnvoi(l));
            } catch (err) {
              toast(tr("Le lien n'a pas pu être relu : {message}", { message: err.message }), true);
            }
          } }, tr("Copier le lien")),
          h("button", { class: "secondaire petit danger-texte", type: "button", onclick: () => revoquer([l]) }, tr("Révoquer"))))))
      );
    } catch {
      liste.hidden = true;
    }
  }

  async function revoquer(liens) {
    if (!(await confirmer(tr("Révoquer ce lien ? Le fichier est supprimé : le client ne pourra plus l'ouvrir."), tr("Révoquer"), true))) return;
    try {
      for (const l of liens) await etat.store.revoquerLienEnvoi(l);
      zone.succes({ titre: tr("Lien révoqué : le client ne peut plus ouvrir le fichier.") });
      majListe();
    } catch (err) {
      zone.echec({ titre: tr("Le lien n'a pas pu être révoqué."), erreur: err });
    }
  }

  function afficher(liens) {
    const expire = liens[0].expire_le;
    const message = messageLien({ genre, langue, prenom, liens: liens.map((l) => ({ nom: l.nom, url: l.url })), expire });
    const texte = h("textarea", { class: "lien-message", readonly: true, rows: 6, "aria-label": tr("Message avec le lien") });
    texte.value = message;
    zone.succes({
      titre: tr("Lien créé, valable jusqu'au {date}.", { date: formatDate(expire.slice(0, 10)) }),
      etapes: [
        tr("Le message contient le lien : le client l'ouvre pour voir et enregistrer son document."),
        ...(etat.store.mode === "demo" ? [tr("Démonstration : ce lien est factice, rien n'a été envoyé.")] : []),
        texte,
      ],
      boutons: [
        h("a", { class: "bouton principal", href: lienWhatsApp(telephone, message), target: "_blank", rel: "noopener", onclick: () => surEnvoi && surEnvoi() }, tr("Ouvrir WhatsApp avec le lien")),
        h("button", { class: "secondaire", type: "button", onclick: () => (copierTexte(message), surEnvoi && surEnvoi()) }, tr("Copier le message avec le lien")),
        h("button", { class: "secondaire danger-texte", type: "button", onclick: () => revoquer(liens) }, tr("Révoquer le lien")),
      ],
    });
  }

  bouton.addEventListener("click", async () => {
    const items = elements();
    if (!items || !items.length) return;
    zone.effacer();
    bouton.disabled = true;
    bouton.textContent = libelleEnCours;
    const crees = [];
    try {
      for (const it of items) crees.push(await etat.store.creerLienEnvoi({ entiteId: etat.entiteId, dossierId, genre: kind, objetId: it.objetId, fichier: it.fichier, jours: DUREE_JOURS }));
      afficher(crees);
      majListe();
    } catch (err) {
      // Un envoi à moitié fait ne laisse pas de lien actif que personne n'a reçu.
      for (const l of crees) await etat.store.revoquerLienEnvoi(l).catch(() => {});
      zone.echec({ titre: tr("Le lien n'a pas pu être créé : vérifiez la connexion et réessayez."), erreur: err, boutons: [h("button", { class: "principal", type: "button", onclick: () => bouton.click() }, tr("Réessayer"))] });
    } finally {
      bouton.disabled = false;
      bouton.textContent = libelle;
    }
  });

  nettoyerUneFois();
  majListe();
  return { bouton, liste, majListe };
}
