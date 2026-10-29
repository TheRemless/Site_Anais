// Réservations auprès des partenaires : liste, formulaire, section d'un dossier, messages.
import { etat, peut, inserer, modifier, supprimer, naviguer, nomClient, nomPartenaire, partenaireDe, netReservation, enregistrerLie, reglages, entiteActive } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, num } from "../ui.mjs";
import { formatMontant, formatDate, aujourdhui } from "../calc.mjs";
import { STATUTS_RESERVATION, reservationsDepuisDocument, variablesMessage, personnesTexte, dateTexte } from "../operations-calc.mjs";
import { vide } from "./commun.mjs";
import { ouvrirMessage } from "./messages.mjs";
import { prix, voitNets } from "./partenaires.mjs";

export const pastilleReservation = (code) => h("span", { class: `statut r-${code}` }, h("span", { class: "point", "aria-hidden": "true" }), STATUTS_RESERVATION[code] || code);
const dossierDe = (r) => etat.db.dossiers.find((d) => d.id === r.dossier_id) || null;
const clientDe = (r) => { const d = dossierDe(r); return d ? etat.db.clients.find((c) => c.id === d.client_id) || null : null; };
const entreprise = () => ({ nom: reglages().emetteur.nom || entiteActive().nom, telephone: reglages().emetteur.telephone || "" });
const telWhatsApp = (p) => { const t = ((p && p.contact && p.contact.telephones) || []); const w = t.find((x) => x.whatsapp) || t[0]; return w ? w.numero : ""; };

export function messagePartenaire(r) {
  const p = partenaireDe(r.partenaire_id);
  const langue = "en";
  ouvrirMessage({ titre: p ? `Message à ${p.nom}` : "Message au partenaire", cle: "partenaire", langue, telephone: telWhatsApp(p), vars: variablesMessage({ reservation: r, client: clientDe(r) || {}, dossier: dossierDe(r) || {}, partenaire: p || {}, entreprise: entreprise(), langue }) });
}
export function messageClient(r, cle = "confirmation") {
  const c = clientDe(r) || {};
  const langue = reglages().libelles === undefined ? "fr" : "fr";
  ouvrirMessage({ titre: `Message à ${nomClient(c)}`, cle, langue, telephone: c.telephone || "", vars: variablesMessage({ reservation: r, client: c, dossier: dossierDe(r) || {}, partenaire: partenaireDe(r.partenaire_id) || {}, entreprise: entreprise(), langue }) });
}

export function carteReservation(r, { avecDossier = true, apres = () => {} } = {}) {
  const c = clientDe(r);
  const d = dossierDe(r);
  const n = voitNets() ? netReservation(r) : null;
  const ecrit = peut("dossiers.ecrire");
  return h(
    "div",
    { class: "carte-lien statique" },
    h("span", { class: "carte-titre" }, r.libelle),
    h("span", { class: "carte-droite" }, h("strong", null, r.date_service ? formatDate(r.date_service) : "Date à fixer"), r.heure_pickup ? h("span", null, `pickup ${r.heure_pickup}`) : null),
    h("span", { class: "carte-sous" }, [avecDossier && c ? nomClient(c) : "", nomPartenaire(r.partenaire_id), personnesTexte(r.personnes), r.lieu_pickup].filter(Boolean).join(" · ")),
    r.notes ? h("span", { class: "carte-sous" }, r.notes) : null,
    h(
      "span",
      { class: "carte-pied" },
      h("span", null, pastilleReservation(r.statut), r.reference_partenaire ? h("span", { class: "tag" }, r.reference_partenaire) : null, n && n.net_prevu != null ? h("span", { class: "tag" }, `net ${prix(n.net_prevu)}${n.net_paye != null ? ", payé" : ""}`) : null, avecDossier && d ? h("a", { class: "tag", href: `#/dossier/${d.id}` }, d.ref) : null),
      h("span", { class: "carte-actions" }, r.partenaire_id ? h("button", { class: "secondaire petit", type: "button", onclick: () => messagePartenaire(r) }, "Partenaire") : null, c ? h("button", { class: "secondaire petit", type: "button", onclick: () => messageClient(r, r.date_service === aujourdhui() ? "rappel" : "confirmation") }, "Client") : null, ecrit ? h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal("Réservation", formulaireReservation(r, () => (fermer(), apres()))); } }, "Modifier") : null)
    )
  );
}

export const listeReservations = (rs, opts) => h("ul", { class: "cartes" }, rs.map((r) => h("li", { class: "carte" }, carteReservation(r, opts))));

export function formulaireReservation(r, apres) {
  const nets = voitNets() && peut("dossiers.ecrire");
  const n = r.id && nets ? netReservation(r) : null;
  const p = r.personnes || {};
  const libelle = h("input", { id: "r-lib", value: r.libelle || "", required: true });
  const partenaire = h("select", { id: "r-part" }, h("option", { value: "" }, "Sans partenaire"), etat.db.partenaires.filter((x) => x.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom)).map((x) => h("option", { value: x.id }, x.nom)));
  partenaire.value = r.partenaire_id || "";
  const date = h("input", { id: "r-date", type: "date", value: r.date_service || "" });
  const heure = h("input", { id: "r-heure", type: "time", value: r.heure_pickup || "" });
  const lieu = h("input", { id: "r-lieu", value: r.lieu_pickup || "", placeholder: "Hôtel, chambre, vol" });
  const adultes = h("input", { id: "r-ad", type: "number", min: "0", step: "1", value: p.adultes ?? 1, inputmode: "numeric" });
  const enfants = h("input", { id: "r-enf", type: "number", min: "0", step: "1", value: p.enfants ?? 0, inputmode: "numeric" });
  const bebes = h("input", { id: "r-beb", type: "number", min: "0", step: "1", value: p.bebes ?? 0, inputmode: "numeric" });
  const statut = h("select", { id: "r-statut" }, Object.entries(STATUTS_RESERVATION).map(([v, l]) => h("option", { value: v }, l)));
  statut.value = r.statut || "a_demander";
  const reference = h("input", { id: "r-ref", value: r.reference_partenaire || "", placeholder: "Numéro donné par le partenaire" });
  const vente = h("input", { id: "r-vente", type: "number", min: "0", step: "1", value: r.montant_vente ?? "", inputmode: "numeric" });
  const netPrevu = h("input", { id: "r-net", type: "number", min: "0", step: "1", value: n && n.net_prevu != null ? n.net_prevu : "", inputmode: "numeric" });
  const netPaye = h("input", { id: "r-paye", type: "number", min: "0", step: "1", value: n && n.net_paye != null ? n.net_paye : "", inputmode: "numeric" });
  const payeLe = h("input", { id: "r-paye-le", type: "date", value: (n && n.paye_le) || "" });
  const notes = h("textarea", { id: "r-notes", rows: 2 });
  notes.value = r.notes || "";
  // Ce qui figure sur le voucher et que la réservation seule ne dit pas.
  const dt = r.details || {};
  const chambre = h("input", { id: "v-chambre", value: dt.chambre || "" });
  const dropOff = h("input", { id: "v-drop", value: dt.drop_off || "", placeholder: "Hôtel, embarcadère, aéroport" });
  const vol = h("input", { id: "v-vol", value: dt.vol || "", placeholder: "FD 3217" });
  const bagages = h("input", { id: "v-bagages", value: dt.bagages || "", placeholder: "2 valises, 1 sac" });
  const typeTour = h("select", { id: "v-tour" }, h("option", { value: "" }, "Automatique d'après la prestation"), h("option", { value: "join" }, "Join tour"), h("option", { value: "prive" }, "Private tour"));
  typeTour.value = dt.type_tour || "";
  const typeTransfert = h("select", { id: "v-transfert" }, h("option", { value: "" }, "Automatique d'après la prestation"), h("option", { value: "taxi" }, "Private taxi"), h("option", { value: "minivan" }, "Private minivan"), h("option", { value: "partage" }, "Shared minivan"));
  typeTransfert.value = dt.type_transfert || "";
  const parc = h("select", { id: "v-parc" }, h("option", { value: "" }, "Automatique d'après la prestation"), h("option", { value: "inclus" }, "Included"), h("option", { value: "non" }, "Not included"), h("option", { value: "aucun" }, "Ne rien afficher"));
  parc.value = dt.parc || "";
  const parcTexte = h("input", { id: "v-parc-texte", value: dt.parc_texte || "", placeholder: "400 THB per adult, 200 THB per child, cash on the island" });
  const remarques = h("textarea", { id: "v-remarques", rows: 2, placeholder: "Vu par le client et le prestataire, en anglais" });
  remarques.value = dt.remarques || "";
  const remarquesPaiement = h("input", { id: "v-rem-paiement", value: dt.remarques_paiement || "", placeholder: "Deposit 1,000 THB received, balance at the pier" });
  const details = () => ({ ...dt, chambre: chambre.value.trim(), drop_off: dropOff.value.trim(), vol: vol.value.trim(), bagages: bagages.value.trim(), type_tour: typeTour.value, type_transfert: typeTransfert.value, parc: parc.value, parc_texte: parcTexte.value.trim(), remarques: remarques.value.trim(), remarques_paiement: remarquesPaiement.value.trim() });
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        const valeurs = { libelle: libelle.value.trim(), partenaire_id: partenaire.value || null, date_service: date.value || null, heure_pickup: heure.value, lieu_pickup: lieu.value.trim(), personnes: { adultes: num(adultes.value) || 0, enfants: num(enfants.value) || 0, bebes: num(bebes.value) || 0 }, statut: statut.value, reference_partenaire: reference.value.trim(), montant_vente: num(vente.value), notes: notes.value.trim(), details: details() };
        try {
          const res = r.id ? await modifier("reservations", r.id, { ...valeurs, updated_at: new Date().toISOString() }) : await inserer("reservations", { dossier_id: r.dossier_id, ligne_id: r.ligne_id || "", prestation_id: r.prestation_id || null, trajet_id: r.trajet_id || null, ...valeurs });
          if (res && res.id && res.details === undefined) res.details = valeurs.details;
          if (nets && (netPrevu.value !== "" || netPaye.value !== "" || payeLe.value || n)) await enregistrerLie("reservations_nets", "reservation_id", res.id, { net_prevu: num(netPrevu.value), net_paye: num(netPaye.value), paye_le: payeLe.value || null });
          toast("Réservation enregistrée.");
          apres(res);
        } catch (err) {
          toast(`Enregistrement impossible : ${err.message}`, true);
        }
      },
    },
    champ("Prestation", libelle),
    h("div", { class: "grille-form" }, champ("Partenaire", partenaire), champ("Statut", statut), champ("Référence du partenaire", reference)),
    h("div", { class: "grille-form compacte" }, champ("Date du service", date), champ("Heure de pickup", heure), champ("Lieu de pickup", lieu)),
    h("div", { class: "grille-form compacte" }, champ("Adultes", adultes), champ("Enfants", enfants), champ("Bébés", bebes), peut("finances.voir") ? champ("Vendu au client", vente) : null),
    nets ? h("div", { class: "grille-form compacte" }, champ("Net prévu", netPrevu, "Ce que le partenaire facturera."), champ("Net payé", netPaye), champ("Payé le", payeLe)) : null,
    champ("Notes internes", notes, "Jamais sur le voucher."),
    h(
      "fieldset",
      null,
      h("legend", null, "Voucher"),
      h("p", { class: "aide" }, "Ce qui s'imprime sur le voucher en plus de la réservation. En automatique, le type de tour, le type de transfert et les frais de parc sont déduits de la prestation."),
      h("div", { class: "grille-form" }, champ("Chambre", chambre, "Sinon celle de l'adresse du client."), champ("Drop-off (transfert)", dropOff), champ("Vol (transfert)", vol), champ("Bagages (transfert)", bagages)),
      h("div", { class: "grille-form" }, champ("Type de tour (bateau)", typeTour), champ("Type de transfert", typeTransfert), champ("Frais de parc (bateau)", parc), champ("Texte des frais de parc", parcTexte)),
      champ("Remarques sur le voucher", remarques),
      champ("Remarque de paiement", remarquesPaiement)
    ),
    h("div", { class: "actions" }, r.id && peut("dossiers.ecrire") ? h("button", { class: "danger", type: "button", onclick: async () => { if (await confirmer(`Supprimer la réservation « ${r.libelle} » ?`, "Supprimer", true)) { await supprimer("reservations", r.id); apres(null); } } }, "Supprimer") : null, h("button", { class: "principal", type: "submit" }, "Enregistrer"))
  );
}

// Crée une réservation par ligne de partenaire du document qui n'en a pas encore.
export async function creerReservations(doc) {
  const existantes = etat.db.reservations.filter((r) => r.dossier_id === doc.dossier_id);
  const nouvelles = reservationsDepuisDocument(doc, { existantes });
  if (!nouvelles.length) return toast("Toutes les lignes de partenaires ont déjà leur réservation.");
  let n = 0;
  for (const { reservation, net } of nouvelles) {
    try {
      const { id, ...sansId } = reservation;
      const res = await inserer("reservations", sansId);
      if (net !== null && voitNets() && peut("dossiers.ecrire")) await enregistrerLie("reservations_nets", "reservation_id", res.id, { net_prevu: net, net_paye: null, paye_le: null });
      n++;
    } catch (err) {
      toast(`Une réservation n'a pas pu être créée : ${err.message}`, true);
    }
  }
  toast(`${n} réservation${n > 1 ? "s" : ""} créée${n > 1 ? "s" : ""}, à demander aux partenaires.`);
}

export function sectionReservationsDossier(d, doc) {
  const rs = etat.db.reservations.filter((r) => r.dossier_id === d.id).sort((a, b) => (a.date_service || "9999").localeCompare(b.date_service || "9999"));
  const ecrit = peut("dossiers.ecrire");
  const rafraichir = () => naviguer(location.hash);
  const manquantes = doc ? reservationsDepuisDocument(doc, { existantes: rs }).length : 0;
  return h(
    "section",
    null,
    h(
      "div",
      { class: "entete petit-entete" },
      h("h2", null, "Réservations auprès des partenaires"),
      ecrit
        ? h("div", { class: "entete-actions" }, manquantes ? h("button", { class: "principal petit", type: "button", onclick: async () => (await creerReservations(doc), rafraichir()) }, `Créer ${manquantes} réservation${manquantes > 1 ? "s" : ""} depuis ${doc.type === "devis" ? "le devis" : "la facture"}`) : null, h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal("Nouvelle réservation", formulaireReservation({ dossier_id: d.id, date_service: d.date_depart || "" }, () => (fermer(), rafraichir()))); } }, "Nouvelle réservation"))
        : null
    ),
    rs.length ? listeReservations(rs, { avecDossier: false, apres: rafraichir }) : h("p", { class: "vide-court" }, doc && manquantes ? "Les lignes de partenaires du document peuvent devenir des réservations en un clic." : "Aucune réservation. Elles se créent depuis les lignes de partenaires du devis, ou à la main.")
  );
}

// ---- Écran Réservations -------------------------------------------------------------------------------------
export function vueReservations() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const ajd = aujourdhui();
  const periode = h("select", { id: "f-periode", onchange: () => dessiner() }, h("option", { value: "avenir" }, "À venir et sans date"), h("option", { value: "passees" }, "Passées"), h("option", { value: "toutes" }, "Toutes"));
  periode.value = params.get("periode") || "avenir";
  const statut = h("select", { id: "f-statut", onchange: () => dessiner() }, h("option", { value: "" }, "Tous les statuts"), h("option", { value: "ouvertes" }, "À demander ou demandées"), Object.entries(STATUTS_RESERVATION).map(([v, l]) => h("option", { value: v }, l)));
  statut.value = params.get("statut") || "";
  const partenaire = h("select", { id: "f-part", onchange: () => dessiner() }, h("option", { value: "" }, "Tous les partenaires"), etat.db.partenaires.filter((p) => etat.db.reservations.some((r) => r.partenaire_id === p.id)).sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => h("option", { value: p.id }, p.nom)));
  partenaire.value = params.get("partenaire") || "";
  const q = h("input", { id: "f-q", type: "search", placeholder: "Client, prestation, hôtel, référence", oninput: () => dessiner() });
  const corps = h("div");
  const rafraichir = () => naviguer(location.hash);
  const sans = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function dessiner() {
    const p = new URLSearchParams();
    for (const [k, v] of [["periode", periode.value], ["statut", statut.value], ["partenaire", partenaire.value]]) if (v && !(k === "periode" && v === "avenir")) p.set(k, v);
    history.replaceState(null, "", `#/reservations${p.toString() ? `?${p}` : ""}`);
    const mots = sans(q.value).split(/\s+/).filter(Boolean);
    const rs = etat.db.reservations
      .filter((r) => (periode.value === "toutes" ? true : periode.value === "passees" ? r.date_service && r.date_service < ajd : !r.date_service || r.date_service >= ajd))
      .filter((r) => (!statut.value ? true : statut.value === "ouvertes" ? r.statut === "a_demander" || r.statut === "demande" : r.statut === statut.value))
      .filter((r) => !partenaire.value || r.partenaire_id === partenaire.value)
      .filter((r) => { const c = clientDe(r); const t = sans(`${r.libelle} ${c ? nomClient(c) : ""} ${r.lieu_pickup} ${r.reference_partenaire} ${nomPartenaire(r.partenaire_id)}`); return mots.every((m) => t.includes(m)); })
      .sort((a, b) => (periode.value === "passees" ? -1 : 1) * ((a.date_service || "9999").localeCompare(b.date_service || "9999") || (a.heure_pickup || "99").localeCompare(b.heure_pickup || "99")));
    corps.replaceChildren();
    if (!rs.length) return corps.append(vide("Aucune réservation ne correspond", etat.db.reservations.length ? "Changez la période, le statut ou le partenaire." : "Les réservations se créent depuis la fiche d'un dossier, à partir des lignes de partenaires du devis."));
    const jours = [...new Set(rs.map((r) => r.date_service || ""))];
    for (const jour of jours) {
      const du = rs.filter((r) => (r.date_service || "") === jour);
      const titre = jour === "" ? "Sans date" : jour === ajd ? `Aujourd'hui, ${dateTexte(jour)}` : jour === ajouter(ajd, 1) ? `Demain, ${dateTexte(jour)}` : dateTexte(jour);
      corps.append(h("section", { class: "jour" }, h("h2", { class: "jour-titre" }, titre, h("span", { class: "tag" }, du.length)), listeReservations(du, { apres: rafraichir })));
    }
  }
  dessiner();
  return h(
    "div",
    { "data-titre": "Réservations" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, "Réservations"), h("p", { class: "sous" }, "Ce qui est à demander, demandé ou confirmé auprès des partenaires, jour par jour.")), h("div", { class: "entete-actions" }, h("a", { class: "bouton secondaire", href: "#/messages" }, "Messages types"))),
    h("div", { class: "barre-outils chercheur" }, h("div", { class: "champ" }, h("label", { for: "f-periode" }, "Période"), periode), h("div", { class: "champ" }, h("label", { for: "f-statut" }, "Statut"), statut), h("div", { class: "champ" }, h("label", { for: "f-part" }, "Partenaire"), partenaire), h("div", { class: "champ recherche" }, h("label", { for: "f-q" }, "Rechercher"), q)),
    corps
  );
}

const ajouter = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
export { formatMontant };
