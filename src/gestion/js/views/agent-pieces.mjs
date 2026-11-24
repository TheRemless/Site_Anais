// Onglet « Assistant » : les pièces jointes (20.11.2026). Joindre une photo, une capture (WhatsApp, billet d'avion, réservation d'hôtel) ou un
// PDF à un message : bouton trombone (sur iPhone, il ouvre la photothèque, l'appareil photo ou Fichiers), glisser-déposer sur ordinateur,
// coller une capture (Cmd+V). Les images sont réduites dans le navigateur avant l'envoi (pieces-jointes.mjs). Aussi : les vignettes d'un
// message déjà envoyé (aperçu à la demande) et la carte « Importer la brochure ».
import { ouvrirVisionneuse } from "../visionneuse.mjs";
import { etat, peut } from "../etat.mjs";
import { h, icone, modal, toast } from "../ui.mjs";
import { tr, pluriel, N_ } from "../i18n.mjs";
import { ACCEPTE, LIMITES, preparer, trierAjout, tropLourd, tailleTexte, erreurFichier } from "../pieces-jointes.mjs";

const estPdf = (type) => type === "application/pdf";

// La zone de saisie : rend { bouton, entree, liste, erreur, attacher(element), coller(champ), fichiers(), prets(), vider() }.
// `change` est appelé quand la liste change (pour activer le bouton d'envoi).
export function piecesSaisie({ change = () => {} } = {}) {
  let joints = []; // { fichier, apercu }
  const entree = h("input", { type: "file", id: "agent-fichiers", accept: ACCEPTE, multiple: true, class: "visuellement-cache" });
  const bouton = h("label", { class: "bouton-icone secondaire agent-joindre", for: "agent-fichiers", title: tr("Joindre une photo ou un PDF"), "aria-label": tr("Joindre une photo, une capture ou un PDF") }, icone("trombone", 20));
  const liste = h("ul", { class: "agent-joints", "aria-label": tr("Pièces jointes") });
  const erreur = h("p", { class: "agent-joints-erreur", role: "alert" });

  const dessiner = () => {
    liste.replaceChildren(
      ...joints.map((j, i) =>
        h(
          "li",
          { class: "agent-joint" },
          j.apercu ? h("img", { src: j.apercu, alt: "", width: 40, height: 40 }) : h("span", { class: "agent-joint-type", "aria-hidden": "true" }, estPdf(j.fichier.type) ? "PDF" : icone("image", 18)),
          h("span", { class: "agent-joint-nom" }, j.fichier.name || tr("Photo"), h("small", null, tailleTexte(j.fichier.size))),
          h("button", { class: "bouton-icone lien", type: "button", "aria-label": tr("Retirer {nom}", { nom: j.fichier.name || tr("Photo") }), onclick: () => retirer(i) }, icone("fermer", 16))
        )
      )
    );
    change();
  };
  const retirer = (i) => {
    const [j] = joints.splice(i, 1);
    if (j && j.apercu) URL.revokeObjectURL(j.apercu);
    erreur.textContent = "";
    dessiner();
  };
  // `bloquer(raison)` : pièces jointes indisponibles (une question WhatsApp en attente part avec l'échange, sans fichier). La raison est dite
  // à la place du trombone et à chaque essai (glisser, coller). bloquer("") les rend.
  let bloque = "";
  const bloquer = (raison = "") => {
    bloque = raison;
    entree.disabled = !!raison;
    bouton.classList.toggle("desactive", !!raison);
    bouton.setAttribute("aria-disabled", raison ? "true" : "false");
    bouton.title = raison || tr("Joindre une photo ou un PDF");
    if (raison && joints.length) vider();
    erreur.textContent = raison;
    erreur.classList.toggle("info", !!raison);
  };
  const ajouter = (fichiers) => {
    if (bloque) return void (erreur.textContent = bloque);
    const { gardes, refus } = trierAjout(joints.map((j) => j.fichier), [...fichiers]);
    for (const f of gardes) joints.push({ fichier: f, apercu: String(f.type).startsWith("image/") ? URL.createObjectURL(f) : "" });
    erreur.textContent = refus ? erreurFichier(refus) : "";
    dessiner();
  };
  entree.addEventListener("change", () => {
    ajouter(entree.files);
    entree.value = "";
  });

  // Glisser-déposer sur la colonne de la conversation : un contour signale la zone pendant le survol.
  const attacher = (zone) => {
    let profondeur = 0;
    const avecFichiers = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes("Files");
    zone.addEventListener("dragenter", (e) => {
      if (!avecFichiers(e)) return;
      e.preventDefault();
      profondeur++;
      zone.classList.add("agent-depot");
    });
    zone.addEventListener("dragover", (e) => {
      if (avecFichiers(e)) e.preventDefault();
    });
    zone.addEventListener("dragleave", () => {
      profondeur = Math.max(0, profondeur - 1);
      if (!profondeur) zone.classList.remove("agent-depot");
    });
    zone.addEventListener("drop", (e) => {
      if (!avecFichiers(e)) return;
      e.preventDefault();
      profondeur = 0;
      zone.classList.remove("agent-depot");
      ajouter(e.dataTransfer.files);
    });
  };
  // Une capture copiée (Cmd+V dans le champ) devient une pièce jointe ; un texte collé reste du texte.
  const coller = (champ) =>
    champ.addEventListener("paste", (e) => {
      const fichiers = [...((e.clipboardData && e.clipboardData.files) || [])];
      if (!fichiers.length) return;
      e.preventDefault();
      // Un nom par défaut garde l'extension de son vrai type (JPEG copié depuis WhatsApp Web, PNG d'une capture).
      const ext = (f) => ({ "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" })[f.type] || "png";
      ajouter(fichiers.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `${tr("capture-{n}", { n: joints.length + i + 1 })}.${ext(f)}`, { type: f.type }))));
    });

  // Les fichiers prêts à partir ({ nom, media_type, data }). Lève une erreur dont le message est le code (fichier_illisible, fichier_trop_lourd…).
  const prets = async () => {
    const p = await Promise.all(joints.map((j) => preparer(j.fichier)));
    if (tropLourd(p)) throw new Error("fichier_trop_lourd");
    return p;
  };
  const vider = () => {
    for (const j of joints) if (j.apercu) URL.revokeObjectURL(j.apercu);
    joints = [];
    erreur.textContent = "";
    dessiner();
  };
  return { bouton, entree, liste, erreur, attacher, coller, ajouter, bloquer, prets, vider, fichiers: () => joints.map((j) => j.fichier), noms: () => joints.map((j) => ({ nom: j.fichier.name || tr("Photo"), media_type: estPdf(j.fichier.type) ? "application/pdf" : "image/jpeg", taille: j.fichier.size })) };
}

// Les vignettes d'un message envoyé : le nom et le type ; un clic ouvre le fichier (relu dans la base, tant qu'il est gardé).
export function bullePieces(fichiers = []) {
  return h(
    "div",
    { class: "agent-bulle de-personne agent-pieces" },
    h(
      "ul",
      { class: "agent-joints envoyes", "aria-label": pluriel(fichiers.length, N_("{n} pièce jointe"), N_("{n} pièces jointes")) },
      fichiers.map((f) =>
        h(
          "li",
          null,
          h(
            "button",
            { class: "agent-joint", type: "button", onclick: () => apercu(f), disabled: !f.id, "aria-label": tr("Ouvrir {nom}", { nom: f.nom || tr("Photo") }) },
            h("span", { class: "agent-joint-type", "aria-hidden": "true" }, estPdf(f.media_type) ? "PDF" : icone("image", 18)),
            h("span", { class: "agent-joint-nom" }, f.nom || tr("Photo"), f.taille ? h("small", null, tailleTexte(Math.round((f.taille * 3) / 4))) : null)
          )
        )
      )
    )
  );
}

async function apercu(f) {
  let ligne = null;
  try {
    ligne = await etat.store.agentFichier(f.id);
  } catch (err) {
    return toast(err.message, true);
  }
  if (!ligne || !ligne.data) return toast(tr("Ce fichier n'est plus gardé : les pièces jointes partent après 30 jours."), true);
  const octets = Uint8Array.from(atob(ligne.data), (c) => c.charCodeAt(0));
  const adresse = URL.createObjectURL(new Blob([octets], { type: ligne.media_type }));
  const liberer = () => setTimeout(() => URL.revokeObjectURL(adresse), 1000);
  // Une photo jointe s'ouvre en grand par-dessus le fil, comme dans WhatsApp (visionneuse.mjs, 23.11.2026).
  if (!estPdf(ligne.media_type)) return void ouvrirVisionneuse({ src: adresse, alt: ligne.nom || tr("Pièce jointe"), ferme: liberer });
  const corps = h("div", { class: "modal-corps" }, h("p", null, ligne.nom), h("a", { class: "bouton principal", href: adresse, target: "_blank", rel: "noopener", download: ligne.nom || "document.pdf" }, tr("Ouvrir le PDF")));
  modal(ligne.nom || tr("Pièce jointe"), corps, { large: true, protege: false, ferme: liberer });
}

// ---- Carte « Importer la brochure » ------------------------------------------------------------------------------------------------

export const droitsImport = () => peut("partenaires.ecrire") && peut("partenaires.prix");

// Le corps de la carte et son action. Le partenaire reconnu par l'agent est présélectionné ; la personne peut en choisir un autre, ou un
// nouveau partenaire. « Lire et comparer » ouvre l'écran d'import de brochure, qui relit les fichiers et n'enregistre que ce qu'elle coche.
export function carteBrochure(c, { valider }) {
  const d = c.donnees || {};
  const partenaires = (etat.db.partenaires || []).filter((p) => p.entite_id === etat.entiteId || !p.entite_id).sort((a, b) => String(a.nom).localeCompare(String(b.nom)));
  const choix = h("select", { id: `agent-brochure-${c.id}` }, h("option", { value: "" }, d.partenaire_lu ? tr("Nouveau partenaire : {nom}", { nom: d.partenaire_lu }) : tr("Nouveau partenaire")), partenaires.map((p) => h("option", { value: p.id }, p.actif === false ? tr("{nom} (masqué)", { nom: p.nom }) : p.nom)));
  choix.value = d.partenaire_id && partenaires.some((p) => p.id === d.partenaire_id) ? d.partenaire_id : "";
  const corps = [
    h("ul", { class: "agent-joints envoyes" }, (d.fichiers || []).map((f) => h("li", null, h("span", { class: "agent-joint" }, h("span", { class: "agent-joint-type", "aria-hidden": "true" }, estPdf(f.media_type) ? "PDF" : icone("image", 18)), h("span", { class: "agent-joint-nom" }, f.nom))))),
    h("label", { for: choix.id }, tr("Partenaire")),
    choix,
    h("p", { class: "aide" }, tr("L'assistant lit puis relit les fichiers, relève les prix et les nets qui y figurent et les compare au catalogue. Vous cochez ce qui entre ; rien n'est écrit avant « Enregistrer »."))
  ];
  if (!droitsImport()) return { corps: [...corps, h("p", { class: "aide" }, tr("Votre rôle ne permet pas de modifier les tarifs."))], action: null };
  return {
    corps,
    action: {
      libelle: tr("Lire et comparer"),
      faire: async () => {
        const p = partenaires.find((x) => x.id === choix.value) || null;
        const { ouvrirImportBrochure } = await import("./brochure.mjs");
        ouvrirImportBrochure(p, valider, { fichiers: d.fichiers || [] });
      },
    },
  };
}
