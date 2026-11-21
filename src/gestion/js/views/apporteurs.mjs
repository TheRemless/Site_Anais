// Apporteurs d'affaires (migration 68) : les morceaux d'écran communs au dossier, à la fiche partenaire et à l'écran WhatsApp. Aucune
// rémunération : personne n'est payé en commission aujourd'hui (Jérémy, 21.11.2026). Le nom de l'apporteur se voit sur le dossier par qui le
// lit. Jamais rien de ceci sur un document client (facture, voucher, Booking confirmation, message).
import { etat, peut, modeExcursions, partenaireDe, nomClient, clientParId, inserer, modifier, permissionsDe } from "../etat.mjs";
import { h, champ, modal, toast } from "../ui.mjs";
import { formatDate } from "../calc.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { CATEGORIE_APPORTEUR, apporteursDe, estApporteur } from "../apporteurs-calc.mjs";

// La migration 68 est passée et l'entreprise est Secret ou Taxi (mode excursions ou taxi). ZTP reste à part.
export const apporteursActifs = () => !!etat.brut && etat.brut.apporteurs_disponible !== false && modeExcursions();

// ---- Dossier --------------------------------------------------------------------------------------------------------------------
// Le choix de l'apporteur dans « Modifier le dossier ». null quand l'entreprise n'a aucune fiche apporteur et que le dossier n'en a pas.
export function champApporteur(d) {
  if (!apporteursActifs()) return null;
  const liste = apporteursDe(etat.db.partenaires, d.entite_id, d.apporteur_id);
  if (!liste.length && !d.apporteur_id) return null;
  // L'apporteur actuel reste une option même quand la personne ne lit pas les partenaires : enregistrer le dossier ne l'efface jamais.
  const actuel = d.apporteur_id && !liste.some((p) => p.id === d.apporteur_id) ? h("option", { value: d.apporteur_id }, tr("Apporteur actuel")) : null;
  const sel = h("select", { id: "m-apporteur" }, h("option", { value: "" }, tr("Personne, le client est venu en direct")), actuel, liste.map((p) => h("option", { value: p.id }, p.nom)));
  sel.value = d.apporteur_id || "";
  return { noeud: champ(tr("Envoyé par (apporteur)"), sel, tr("La travel planner ou l'agence qui a envoyé ce client. N'apparaît sur aucun document du client.")), valeur: () => sel.value || null };
}
// Le patch du dossier : apporteur_id seulement s'il a changé.
export const patchApporteur = (champApp, d) => (champApp && champApp.valeur() !== (d.apporteur_id || null) ? { apporteur_id: champApp.valeur() } : {});

// Le bloc « Envoyé par » du résumé du dossier : le nom de l'apporteur, et un lien vers sa fiche pour qui lit les partenaires.
export function blocResumeApporteur(d) {
  if (!apporteursActifs() || !d.apporteur_id) return null;
  const p = partenaireDe(d.apporteur_id);
  const nom = p ? p.nom : tr("Apporteur");
  return h(
    "div",
    { class: "resume-bloc resume-apporteur" },
    h("p", { class: "resume-libelle" }, tr("Envoyé par")),
    p && peut("partenaires.lire") ? h("a", { class: "resume-titre", href: `#/partenaire/${p.id}` }, nom) : h("p", { class: "resume-titre" }, nom)
  );
}

// ---- Fiche partenaire -----------------------------------------------------------------------------------------------------------
// Le bloc d'une fiche apporteur : les dossiers envoyés. `bloc(titre, ...contenu)` vient de la fiche.
export function blocsFicheApporteur(p, { bloc }) {
  if (!estApporteur(p) || !apporteursActifs()) return [];
  const dossiers = (etat.db.dossiers || []).filter((d) => d.apporteur_id === p.id).sort((a, b) => String(b.date_depart || b.created_at || "").localeCompare(String(a.date_depart || a.created_at || "")));
  const ligneDossier = (d) =>
    h(
      "li",
      null,
      h("a", { href: `#/dossier/${d.id}` }, `${d.ref} · ${nomClient(clientParId(d.client_id))}`),
      d.date_depart ? h("span", { class: "sec" }, ` · ${formatDate(d.date_depart)}`) : null,
      d.annule ? h("span", { class: "tag" }, tr("annulé")) : null
    );
  return [
    bloc(
      N_("Clients envoyés"),
      dossiers.length ? h("p", { class: "aide" }, pluriel(dossiers.length, N_("{n} dossier envoyé par cet apporteur."), N_("{n} dossiers envoyés par cet apporteur."))) : h("p", { class: "vide-court" }, tr("Aucun dossier pour l'instant. L'apporteur se choisit dans « Modifier le dossier ».")),
      dossiers.length ? h("ul", { class: "liste-regles" }, dossiers.slice(0, 30).map(ligneDossier)) : null
    ),
  ];
}

// ---- Écran WhatsApp ---------------------------------------------------------------------------------------------------------------
// La fiche apporteur d'une conversation typée « apporteur » : ouvrir la fiche reliée, ou en créer une, ou relier une fiche existante.
// `ecrit` : la personne écrit dans cette conversation (administratrice de son entreprise). `apres(conversation)` : redessiner.
export function blocApporteurWhatsApp(c, { ecrit, apres }) {
  if (!c.entite_id || etat.brut.apporteurs_disponible === false) return null;
  const perms = permissionsDe(c.entite_id);
  if (!perms.includes("partenaires.lire")) return null;
  const fiche = c.partenaire_id ? (etat.brut.partenaires || []).find((p) => p.id === c.partenaire_id) || null : null;
  const fiches = apporteursDe(etat.brut.partenaires, c.entite_id);
  const relier = async (id) => {
    try {
      const r = await modifier("whatsapp_conversations", c.id, { partenaire_id: id });
      toast(id ? tr("Fiche apporteur reliée.") : tr("Fiche retirée."));
      apres(r);
    } catch (err) {
      toast(err.message, true);
    }
  };
  const creer = async () => {
    try {
      const p = await inserer("partenaires", {
        entite_id: c.entite_id,
        nom: (c.nom || "").trim() || c.telephone,
        nom_thai: "",
        categorie: CATEGORIE_APPORTEUR,
        groupe: "autre",
        role: "",
        contact: { personne: (c.nom || "").trim(), telephones: [{ numero: c.telephone, libelle: "", whatsapp: true }] },
        regles: {},
        contrat: {},
        notes: "",
        actif: true,
        ordre: Math.max(0, ...(etat.brut.partenaires || []).map((x) => x.ordre || 0)) + 1,
      });
      await relier(p.id);
    } catch (err) {
      toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    }
  };
  const choisir = () => {
    const sel = h("select", { id: "wa-apporteur" }, fiches.map((p) => h("option", { value: p.id }, p.nom)));
    let fermer;
    fermer = modal(
      tr("Relier une fiche apporteur"),
      h("div", { class: "modal-corps" }, champ(tr("Fiche apporteur"), sel), h("div", { class: "barre-modal" }, h("button", { class: "principal", type: "button", onclick: () => (fermer(), relier(sel.value)) }, tr("Relier")))),
      { protege: false }
    );
  };
  if (fiche) {
    return h(
      "p",
      { class: "wa-apporteur" },
      tr("Fiche apporteur : "),
      // La fiche est dans l'entreprise de la conversation : on y passe avant de l'ouvrir.
      h("a", { href: `#/partenaire/${fiche.id}?entite=${fiche.entite_id}` }, fiche.nom),
      ecrit ? h("button", { class: "lien", type: "button", onclick: () => relier(null) }, tr("Retirer")) : null
    );
  }
  if (!ecrit) return h("p", { class: "wa-apporteur" }, tr("Aucune fiche apporteur reliée."));
  return h(
    "div",
    { class: "wa-apporteur" },
    perms.includes("partenaires.ecrire") ? h("button", { class: "secondaire petit", type: "button", onclick: creer }, tr("Créer la fiche apporteur")) : null,
    fiches.length ? h("button", { class: "secondaire petit", type: "button", onclick: choisir }, tr("Relier une fiche")) : null
  );
}

