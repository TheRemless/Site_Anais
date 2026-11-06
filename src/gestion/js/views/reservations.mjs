// Réservations auprès des partenaires : liste, formulaire, section d'un dossier, messages.
import { etat, peut, inserer, modifier, supprimer, naviguer, nomClient, nomPartenaire, partenaireDe, netReservation, enregistrerLie, reglages, entiteActive, modeExcursions } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, num } from "../ui.mjs";
import { formatMontant, formatDate, aujourdhui } from "../calc.mjs";
import { STATUTS_RESERVATION, reservationsDepuisDocument, variablesMessage, personnesTexte, dateTexte, typeVoucher, CHAMPS_VOUCHER, TITRES_VOUCHER, datesDepuisReservations, descriptionService, cleMessageClient } from "../operations-calc.mjs";
import { choisirPrestation } from "./choix-prestation.mjs";
import { CONTENU_DEFAUT } from "../defauts.mjs";
import { vide } from "./commun.mjs";
import { ouvrirMessage } from "./messages.mjs";
import { prix, voitNets } from "./partenaires.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";

export const pastilleReservation = (code) => h("span", { class: `statut r-${code}` }, h("span", { class: "point", "aria-hidden": "true" }), (STATUTS_RESERVATION[code] ? tr(STATUTS_RESERVATION[code]) : code));
const dossierDe = (r) => etat.db.dossiers.find((d) => d.id === r.dossier_id) || null;
const clientDe = (r) => { const d = dossierDe(r); return d ? etat.db.clients.find((c) => c.id === d.client_id) || null : null; };
const entreprise = () => ({ nom: reglages().emetteur.nom || entiteActive().nom, telephone: reglages().emetteur.telephone || "" });
const telWhatsApp = (p) => { const t = ((p && p.contact && p.contact.telephones) || []); const w = t.find((x) => x.whatsapp) || t[0]; return w ? w.numero : ""; };

export function messagePartenaire(r) {
  const p = partenaireDe(r.partenaire_id);
  const langue = "en";
  ouvrirMessage({ titre: p ? tr("Message à {nom}", { nom: p.nom }) : tr("Message au partenaire"), pour: "partenaire", cle: "partenaire", langue, telephone: telWhatsApp(p), vars: variablesMessage({ reservation: r, client: clientDe(r) || {}, dossier: dossierDe(r) || {}, partenaire: p || {}, entreprise: entreprise(), langue }) });
}
export function messageClient(r, cle = "confirmation") {
  const c = clientDe(r) || {};
  // Les clients de Secret reçoivent leurs documents en anglais : le message est proposé en anglais aussi.
  const langue = /invoice/i.test((reglages().libelles && reglages().libelles.facture) || "") ? "en" : "fr";
  ouvrirMessage({ titre: tr("Message à {nomClient}", { nomClient: nomClient(c) }), pour: "client", cle, langue, telephone: c.telephone || "", vars: variablesMessage({ reservation: r, client: c, dossier: dossierDe(r) || {}, partenaire: partenaireDe(r.partenaire_id) || {}, entreprise: entreprise(), langue }) });
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
    h("span", { class: "carte-droite" }, h("strong", null, r.date_service ? formatDate(r.date_service) : tr("Date à fixer")), r.heure_pickup ? h("span", null, tr("pickup {heure_pickup}", { heure_pickup: r.heure_pickup })) : null),
    h("span", { class: "carte-sous" }, [avecDossier && c ? nomClient(c) : "", nomPartenaire(r.partenaire_id), personnesTexte(r.personnes), r.lieu_pickup].filter(Boolean).join(" · ")),
    r.notes ? h("span", { class: "carte-sous" }, r.notes) : null,
    h(
      "span",
      { class: "carte-pied" },
      h("span", null, pastilleReservation(r.statut), r.reference_partenaire ? h("span", { class: "tag" }, r.reference_partenaire) : null, n && n.net_prevu != null ? h("span", { class: "tag" }, n.net_paye != null ? tr("net {prix}, payé", { prix: prix(n.net_prevu) }) : tr("net {prix}", { prix: prix(n.net_prevu) })) : null, avecDossier && d ? h("a", { class: "tag", href: `#/dossier/${d.id}` }, d.ref) : null),
      h("span", { class: "carte-actions" }, r.partenaire_id ? h("button", { class: "secondaire petit", type: "button", onclick: () => messagePartenaire(r) }, tr("Partenaire")) : null, c ? h("button", { class: "secondaire petit", type: "button", onclick: () => messageClient(r, cleMessageClient(r.date_service, aujourdhui())) }, tr("Client")) : null, ecrit ? h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal(tr("Réservation"), formulaireReservation(r, () => (fermer(), apres()))); } }, tr("Modifier")) : null)
    )
  );
}

export const listeReservations = (rs, opts) => h("ul", { class: "cartes" }, rs.map((r) => h("li", { class: "carte" }, carteReservation(r, opts))));

export function formulaireReservation(r, apres) {
  const nets = voitNets() && peut("dossiers.ecrire");
  const n = r.id && nets ? netReservation(r) : null;
  const p = r.personnes || {};
  const libelle = h("input", { id: "r-lib", value: r.libelle || "", required: true });
  const partenaire = h("select", { id: "r-part" }, h("option", { value: "" }, tr("Sans partenaire")), etat.db.partenaires.filter((x) => x.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom)).map((x) => h("option", { value: x.id }, x.nom)));
  partenaire.value = r.partenaire_id || "";
  const date = h("input", { id: "r-date", type: "date", value: r.date_service || "" });
  const heure = h("input", { id: "r-heure", type: "time", value: r.heure_pickup || "" });
  const lieu = h("input", { id: "r-lieu", value: r.lieu_pickup || "", placeholder: tr("Hôtel, chambre, vol") });
  const adultes = h("input", { id: "r-ad", type: "number", min: "0", step: "1", value: p.adultes ?? 1, inputmode: "numeric" });
  const enfants = h("input", { id: "r-enf", type: "number", min: "0", step: "1", value: p.enfants ?? 0, inputmode: "numeric" });
  const bebes = h("input", { id: "r-beb", type: "number", min: "0", step: "1", value: p.bebes ?? 0, inputmode: "numeric" });
  const statut = h("select", { id: "r-statut" }, Object.entries(STATUTS_RESERVATION).map(([v, l]) => h("option", { value: v }, tr(l))));
  statut.value = r.statut || "a_demander";
  const reference = h("input", { id: "r-ref", value: r.reference_partenaire || "", placeholder: tr("Numéro donné par le partenaire") });
  const vente = h("input", { id: "r-vente", type: "number", min: "0", step: "1", value: r.montant_vente ?? "", inputmode: "numeric" });
  const netPrevu = h("input", { id: "r-net", type: "number", min: "0", step: "1", value: n && n.net_prevu != null ? n.net_prevu : "", inputmode: "numeric" });
  const netPaye = h("input", { id: "r-paye", type: "number", min: "0", step: "1", value: n && n.net_paye != null ? n.net_paye : "", inputmode: "numeric" });
  const payeLe = h("input", { id: "r-paye-le", type: "date", value: (n && n.paye_le) || "" });
  const notes = h("textarea", { id: "r-notes", rows: 2 });
  notes.value = r.notes || "";
  // Ce qui figure sur le voucher et que la réservation seule ne dit pas.
  const dt = r.details || {};
  const chambre = h("input", { id: "v-chambre", value: dt.chambre || "" });
  const dropOff = h("input", { id: "v-drop", value: dt.drop_off || "", placeholder: tr("Hôtel, embarcadère, aéroport") });
  const vol = h("input", { id: "v-vol", value: dt.vol || "", placeholder: tr("FD 3217") });
  const bagages = h("input", { id: "v-bagages", value: dt.bagages || "", placeholder: tr("2 valises, 1 sac") });
  const typeTour = h("select", { id: "v-tour" }, h("option", { value: "" }, tr("Automatique d'après la prestation")), h("option", { value: "join" }, tr("Join tour")), h("option", { value: "prive" }, tr("Private tour")));
  typeTour.value = dt.type_tour || "";
  const typeTransfert = h("select", { id: "v-transfert" }, h("option", { value: "" }, tr("Automatique d'après la prestation")), h("option", { value: "taxi" }, tr("Private taxi")), h("option", { value: "minivan" }, tr("Private minivan")), h("option", { value: "partage" }, tr("Shared minivan")));
  typeTransfert.value = dt.type_transfert || "";
  const parc = h("select", { id: "v-parc" }, h("option", { value: "" }, tr("Automatique d'après la prestation")), h("option", { value: "inclus" }, tr("Included")), h("option", { value: "non" }, tr("Not included")), h("option", { value: "aucun" }, tr("Ne rien afficher")));
  parc.value = dt.parc || "";
  const parcTexte = h("input", { id: "v-parc-texte", value: dt.parc_texte || "", placeholder: tr("400 THB per adult, 200 THB per child, cash on the island") });
  const remarques = h("textarea", { id: "v-remarques", rows: 2, placeholder: tr("Vu par le client et le prestataire, en anglais") });
  remarques.value = dt.remarques || "";
  const remarquesPaiement = h("input", { id: "v-rem-paiement", value: dt.remarques_paiement || "", placeholder: tr("Deposit 1,000 THB received, balance at the pier") });
  const heureService = h("input", { id: "v-heure-service", value: dt.heure_service || "", placeholder: "10:00 - 12:00" });
  const retourDate = h("input", { id: "v-retour-date", type: "date", value: dt.retour_date || "" });
  const retourHeure = h("input", { id: "v-retour-heure", type: "time", value: dt.retour_heure || "" });
  const permis = h("input", { id: "v-permis", value: dt.permis || "", placeholder: tr("International driving licence shown") });
  const caution = h("input", { id: "v-caution", value: dt.caution || "", placeholder: tr("3,000 THB, returned at drop-off") });
  const embarquement = h("input", { id: "v-embarquement", value: dt.embarquement || "", placeholder: tr("Saladan Pier") });
  const checkin = h("textarea", { id: "v-checkin", rows: 2, placeholder: tr("Check-in at the pier 45 minutes before departure…") });
  checkin.value = dt.checkin || "";
  const bateau = h("input", { id: "v-bateau", value: dt.bateau || "", placeholder: tr("Longtail, speedboat") });
  const programme = h("input", { id: "v-programme", value: dt.programme || "", placeholder: tr("Program A, 10 min session") });
  const details = () => ({ ...dt, chambre: chambre.value.trim(), drop_off: dropOff.value.trim(), vol: vol.value.trim(), bagages: bagages.value.trim(), type_tour: typeTour.value, type_transfert: typeTransfert.value, parc: parc.value, parc_texte: parcTexte.value.trim(), remarques: remarques.value.trim(), remarques_paiement: remarquesPaiement.value.trim(), heure_service: heureService.value.trim(), retour_date: retourDate.value || "", retour_heure: retourHeure.value, permis: permis.value.trim(), caution: caution.value.trim(), embarquement: embarquement.value.trim(), checkin: checkin.value.trim(), bateau: bateau.value.trim(), programme: programme.value.trim() });
  // Le bloc Voucher ne montre que les champs du modèle de cette prestation.
  const prestation = r.prestation_id ? etat.db.prestations.find((p) => p.id === r.prestation_id) || null : null;
  const type = typeVoucher(r, prestation, partenaireDe(r.partenaire_id));
  const CHAMPS = {
    chambre: () => champ(tr("Chambre"), chambre, tr("Sinon celle de l'adresse du client.")),
    drop_off: () => champ(tr("Drop-off"), dropOff),
    vol: () => champ(tr("Numéro de vol"), vol),
    bagages: () => champ(tr("Bagages"), bagages),
    type_tour: () => champ(tr("Type de tour"), typeTour),
    type_transfert: () => champ(tr("Type de transfert"), typeTransfert),
    parc: () => champ(tr("Frais de parc"), parc),
    parc_texte: () => champ(tr("Texte des frais de parc"), parcTexte),
    heure_service: () => champ(tr("Horaire de l'activité"), heureService, tr("Imprimé après la date.")),
    retour_date: () => champ(tr("Date de retour"), retourDate),
    retour_heure: () => champ(tr("Heure de retour"), retourHeure),
    permis: () => champ(tr("Permis de conduire"), permis),
    caution: () => champ(tr("Caution"), caution),
    embarquement: () => champ(tr("Embarcadère ou point de check-in"), embarquement, tr("Sinon celui de la compagnie pour le lieu de départ.")),
    checkin: () => champ(tr("Consigne de check-in"), checkin, tr("Sinon celle de la compagnie, en anglais.")),
    bateau: () => champ(tr("Bateau"), bateau, tr("Sinon celui de la prestation.")),
    programme: () => champ(tr("Programme ou option"), programme, tr("Sinon le groupe de la prestation.")),
    remarques: () => champ(tr("Remarques sur le voucher"), remarques),
    remarques_paiement: () => champ(tr("Remarque de paiement"), remarquesPaiement),
  };
  const blocVoucher = type
    ? h("fieldset", null, h("legend", null, TITRES_VOUCHER[type]), h("p", { class: "aide" }, tr("Ce qui s'imprime sur ce voucher en plus de la réservation. En automatique, le type et les frais de parc sont déduits de la prestation.")), h("div", { class: "grille-form" }, (CHAMPS_VOUCHER[type] || []).filter((c) => !["remarques", "remarques_paiement", "checkin"].includes(c)).map((c) => CHAMPS[c]())), (CHAMPS_VOUCHER[type] || []).filter((c) => ["checkin", "remarques", "remarques_paiement"].includes(c)).map((c) => CHAMPS[c]()))
    : null;
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
          toast(tr("Réservation enregistrée."));
          apres(res);
        } catch (err) {
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    champ(tr("Prestation"), libelle),
    h("div", { class: "grille-form" }, champ(tr("Partenaire"), partenaire), champ(tr("Statut"), statut), champ(tr("Référence du partenaire"), reference)),
    h("div", { class: "grille-form compacte" }, champ(tr("Date du service"), date), champ(tr("Heure de pickup"), heure), champ(tr("Lieu de pickup"), lieu)),
    h("div", { class: "grille-form compacte" }, champ(tr("Adultes"), adultes), champ(tr("Enfants"), enfants), champ(tr("Bébés"), bebes), peut("finances.voir") ? champ(tr("Vendu au client"), vente) : null),
    nets ? h("div", { class: "grille-form compacte" }, champ(tr("Net prévu"), netPrevu, tr("Ce que le partenaire facturera.")), champ(tr("Net payé"), netPaye), champ(tr("Payé le"), payeLe)) : null,
    champ(tr("Notes internes"), notes, tr("Jamais sur le voucher.")),
    blocVoucher,
    h("div", { class: "actions" }, r.id && peut("dossiers.ecrire") ? h("button", { class: "danger", type: "button", onclick: async () => { if (await confirmer(tr("Supprimer la réservation « {libelle} » ?", { libelle: r.libelle }), tr("Supprimer"), true)) { await supprimer("reservations", r.id); await synchroniserDatesDossier(r.dossier_id); apres(null); } } }, tr("Supprimer")) : null, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
  );
}

// Crée une réservation par ligne de partenaire du document qui n'en a pas encore.
export async function creerReservations(doc) {
  const existantes = etat.db.reservations.filter((r) => r.dossier_id === doc.dossier_id);
  const nouvelles = reservationsDepuisDocument(doc, { existantes });
  if (!nouvelles.length) return toast(tr("Toutes les lignes de partenaires ont déjà leur réservation."));
  let n = 0;
  for (const { reservation, net } of nouvelles) {
    try {
      const { id, ...sansId } = reservation;
      const res = await inserer("reservations", sansId);
      if (net !== null && voitNets() && peut("dossiers.ecrire")) await enregistrerLie("reservations_nets", "reservation_id", res.id, { net_prevu: net, net_paye: null, paye_le: null });
      n++;
    } catch (err) {
      toast(tr("Une réservation n'a pas pu être créée : {message}", { message: err.message }), true);
    }
  }
  await synchroniserDatesDossier(doc.dossier_id);
  toast(pluriel(n, N_("{n} réservation créée, à demander aux partenaires."), N_("{n} réservations créées, à demander aux partenaires.")));
}

// En mode excursions, les dates du dossier sont celles de ses réservations : première et dernière date de service.
export async function synchroniserDatesDossier(dossierId) {
  if (!modeExcursions()) return;
  const d = etat.db.dossiers.find((x) => x.id === dossierId);
  if (!d) return;
  const dates = datesDepuisReservations(etat.db.reservations.filter((r) => r.dossier_id === dossierId));
  if (dates.date_depart !== (d.date_depart || null) || dates.date_retour !== (d.date_retour || null)) await modifier("dossiers", dossierId, dates);
}

// Ajouter des services à un dossier existant : les lignes vont dans la facture (créée si besoin), puis chacune a sa réservation.
export function ajouterServices(d, doc, apres) {
  const regl = reglages();
  const langue = /invoice/i.test((regl.libelles && regl.libelles.facture) || "") ? "en" : "";
  let cibleId = doc ? doc.id : null;
  // La fenêtre reste ouverte pour enchaîner les ajouts : un à la fois, chacun sur la version courante de la facture.
  let file = Promise.resolve();
  async function ajouter(nouvelles) {
    try {
      const lignes = nouvelles.map((l) => ({ ...l, titre: l.kind === "texte" ? undefined : l.libelle, libelle: l.kind === "texte" ? l.libelle : descriptionService(l, langue), intro: "" }));
      let cible = cibleId ? etat.db.documents.find((x) => x.id === cibleId) : null;
      if (!cible) {
        cible = await inserer("documents", { dossier_id: d.id, type: "facture", date_emission: aujourdhui(), envoye_le: null, updated_at: new Date().toISOString(), contenu: { ...CONTENU_DEFAUT(), colonnes: "total", langue, variante: (regl.textes.variantes[0] || {}).id || "", equivalents: { actif: false }, lignes: [] } });
        cibleId = cible.id;
      }
      const contenu = structuredClone(cible.contenu);
      contenu.lignes = [...(contenu.lignes || []), ...lignes];
      const partenaires = [...new Set(contenu.lignes.map((l) => nomPartenaire(l.partenaire_id)).filter(Boolean))];
      if (partenaires.length) contenu.prestataire = partenaires.join(", ");
      const maj = await modifier("documents", cible.id, { contenu, updated_at: new Date().toISOString() });
      await creerReservations(maj);
      apres();
    } catch (err) {
      toast(tr("Ajout impossible : {message}", { message: err.message }), true);
    }
  }
  choisirPrestation({ langue, devise: regl.devise, sansCompagnie: true, onAjout: (nouvelles) => (file = file.then(() => ajouter(nouvelles))) });
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
      h("h2", null, tr("Réservations auprès des partenaires")),
      ecrit
        ? h("div", { class: "entete-actions" }, manquantes ? h("button", { class: "principal petit", type: "button", onclick: async () => (await creerReservations(doc), rafraichir()) }, (doc.type === "devis" ? pluriel(manquantes, N_("Créer {n} réservation depuis le devis"), N_("Créer {n} réservations depuis le devis")) : pluriel(manquantes, N_("Créer {n} réservation depuis la facture"), N_("Créer {n} réservations depuis la facture")))) : null, modeExcursions() ? h("button", { class: "principal petit", type: "button", onclick: () => ajouterServices(d, doc, rafraichir) }, tr("Ajouter un service")) : null, h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal(tr("Nouvelle réservation"), formulaireReservation({ dossier_id: d.id, date_service: d.date_depart || "" }, () => (fermer(), rafraichir()))); } }, modeExcursions() ? tr("Réservation à la main") : tr("Nouvelle réservation")))
        : null
    ),
    rs.length ? listeReservations(rs, { avecDossier: false, apres: rafraichir }) : h("p", { class: "vide-court" }, doc && manquantes ? tr("Les lignes de partenaires du document peuvent devenir des réservations en un clic.") : modeExcursions() ? tr("Aucune réservation. « Ajouter un service » met la prestation sur la facture et crée sa réservation.") : tr("Aucune réservation. Elles se créent depuis les lignes de partenaires du devis, ou à la main."))
  );
}

// ---- Écran Réservations -------------------------------------------------------------------------------------
export function vueReservations() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const ajd = aujourdhui();
  const periode = h("select", { id: "f-periode", onchange: () => dessiner() }, h("option", { value: "avenir" }, tr("À venir et sans date")), h("option", { value: "passees" }, tr("Passées")), h("option", { value: "toutes" }, tr("Toutes")));
  periode.value = params.get("periode") || "avenir";
  const statut = h("select", { id: "f-statut", onchange: () => dessiner() }, h("option", { value: "" }, tr("Tous les statuts")), h("option", { value: "ouvertes" }, tr("À demander ou demandées")), Object.entries(STATUTS_RESERVATION).map(([v, l]) => h("option", { value: v }, tr(l))));
  statut.value = params.get("statut") || "";
  const partenaire = h("select", { id: "f-part", onchange: () => dessiner() }, h("option", { value: "" }, tr("Tous les partenaires")), etat.db.partenaires.filter((p) => etat.db.reservations.some((r) => r.partenaire_id === p.id)).sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => h("option", { value: p.id }, p.nom)));
  partenaire.value = params.get("partenaire") || "";
  const q = h("input", { id: "f-q", type: "search", placeholder: tr("Client, prestation, hôtel, référence"), oninput: () => dessiner() });
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
    if (!rs.length) return corps.append(vide(tr("Aucune réservation ne correspond"), etat.db.reservations.length ? tr("Changez la période, le statut ou le partenaire.") : tr("Les réservations se créent depuis la fiche d'un dossier, à partir des lignes de partenaires du devis.")));
    const jours = [...new Set(rs.map((r) => r.date_service || ""))];
    for (const jour of jours) {
      const du = rs.filter((r) => (r.date_service || "") === jour);
      const titre = jour === "" ? tr("Sans date") : jour === ajd ? tr("Aujourd'hui, {dateTexte}", { dateTexte: dateTexte(jour) }) : jour === ajouter(ajd, 1) ? tr("Demain, {dateTexte}", { dateTexte: dateTexte(jour) }) : dateTexte(jour);
      corps.append(h("section", { class: "jour" }, h("h2", { class: "jour-titre" }, titre, h("span", { class: "tag" }, du.length)), listeReservations(du, { apres: rafraichir })));
    }
  }
  dessiner();
  return h(
    "div",
    { "data-titre": tr("Réservations") },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Réservations")), h("p", { class: "sous" }, tr("Ce qui est à demander, demandé ou confirmé auprès des partenaires, jour par jour."))), h("div", { class: "entete-actions" }, h("a", { class: "bouton secondaire", href: "#/messages" }, tr("Messages types")))),
    h("div", { class: "barre-outils chercheur" }, h("div", { class: "champ" }, h("label", { for: "f-periode" }, tr("Période")), periode), h("div", { class: "champ" }, h("label", { for: "f-statut" }, tr("Statut")), statut), h("div", { class: "champ" }, h("label", { for: "f-part" }, tr("Partenaire")), partenaire), h("div", { class: "champ recherche" }, h("label", { for: "f-q" }, tr("Rechercher")), q)),
    corps
  );
}

const ajouter = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
export { formatMontant };
