// Écran « Nouveau voucher » de VIP Taxi Lanta (12.11.2026), en thaï, pour l'assistante d'Anaïs : un formulaire, l'aperçu de la
// « Booking confirmation », un bouton qui crée tout (client, dossier, course payée au chauffeur, voucher) et envoie l'image à Anaïs,
// puis la liste de ses derniers vouchers pour corriger une heure ou renvoyer. Le voucher reste en anglais. Logique : voucher-rapide-calc.mjs.
// Logo du voucher (18.11.2026) : VIP Taxi Lanta (par défaut, Mr. Brown) ou Secret Travel & Tour (taxi indépendant, sans partenaire). Le dossier,
// la course et le voucher vont dans l'entreprise du logo, avec ses réglages et ses droits (etat.mjs, travaillerPourVoucher).
import { etat, inserer, modifier, reglages, chargerDossier, modeTaxi, travaillerPourVoucher, entitesVoucher, entiteVoucherOrigine, reglagesDe } from "../etat.mjs";
import { h, icone } from "../ui.mjs";
import { uid } from "../defauts.mjs";
import { RETOUR_DEPART } from "../trajet-calc.mjs";
import { TH, CHAMPS, valeursVides, erreursVoucher, donneesVoucher, ligneVoucher, reservationVoucher, reservationApercu, correctionReservation, valeursDepuis, suggestionsLieux, mesVouchers, dateCourteTh, partenaireDeTaxi, chauffeurRegle, clientsRecents } from "../voucher-rapide-calc.mjs";
import { contenuCourse, heureBooking, estBookingConfirmation } from "../taxi-calc.mjs";
import { numeroVoucher, nomFichierVoucher, lienWhatsApp } from "../operations-calc.mjs";
import { chiffres } from "../partenaires-calc.mjs";
import { creerDossierExcursions, refProposee, refDefinitive } from "./creation-excursions.mjs";
import { synchroniserDatesDossier } from "./suivi-facture.mjs";
import { vouchersDuDossier } from "./voucher.mjs";
import { imageVoucher } from "./voucher-envoi.mjs";
import { moyen, partager, enregistrer, copierImage } from "./partage.mjs";
import { noterEnvoi } from "./envois-vouchers.mjs";
import { aujourdhui } from "../calc.mjs";

// Le partenaire de la course : VIP Taxi Lanta, seul partenaire de l'entreprise (lu avec le droit « voir les partenaires »).
// Sous le logo de Secret, aucun : c'est un taxi indépendant (décision de Jérémy, 18.11.2026), jamais un partenaire de Secret deviné par son nom.
const partenaireTaxi = () => (modeTaxi() ? partenaireDeTaxi(etat.db.partenaires, chauffeurRegle(reglages())) : null);
// Le WhatsApp d'Anaïs est réglé dans Taxi : il sert aussi aux vouchers faits sous le logo de Secret.
const telAnais = () => chiffres((reglagesDe(entiteVoucherOrigine()).voucher || {}).whatsapp_anais || "").replace("+", "");
const independant = () => !modeTaxi();

let adresseImage = null;
const urlImage = (blob) => {
  if (adresseImage) URL.revokeObjectURL(adresseImage);
  adresseImage = URL.createObjectURL(blob);
  return adresseImage;
};

export function vueVoucherRapide() {
  const racine = h("div", { class: "vr", lang: "th", "data-titre": TH.titre });
  // Hors du formulaire vierge, l'écran ne doit pas être redessiné par la relecture automatique (app.mjs, saisieEnCours).
  const occupe = (oui) => racine.toggleAttribute("data-occupe", !!oui);
  // L'entreprise Taxi de l'écran et les logos proposés (un seul : pas de choix à l'écran, comme avant).
  const origine = entiteVoucherOrigine();
  const marques = entitesVoucher();
  const choixMarques = marques.length > 1;
  const nomEntite = (id) => ((marques.find((m) => m.id === id) || etat.brut.entites.find((e) => e.id === id)) || {}).nom || "";
  const ligneMarque = (id) => (choixMarques ? h("p", { class: "vr-marque-ligne" }, nomEntite(id)) : null);
  // Le temps d'un geste (noter un envoi) dans l'entreprise d'un voucher, puis retour à celle de l'écran.
  const dansEntite = (id, fn) => {
    const avant = etat.entiteId;
    travaillerPourVoucher(id);
    try {
      return fn();
    } finally {
      travaillerPourVoucher(avant);
    }
  };

  // ---- 1. Formulaire ----------------------------------------------------------------------------------------------
  // `cible` : le voucher corrigé ({ reservation, dossier, client }), sinon un nouveau.
  // `valeurs.entite_id` : l'entreprise du logo choisi (retour depuis l'aperçu) ; un nouveau voucher repart de Taxi. Une correction reste dans
  // l'entreprise du voucher, sans choix.
  function formulaire(valeurs = valeursVides(), cible = null) {
    travaillerPourVoucher(cible ? cible.dossier.entite_id : valeurs.entite_id || origine);
    occupe(!!cible || etat.entiteId !== origine);
    const champs = {};
    const erreurs = {};
    // Lieux déjà saisis : les courses de Taxi et celles des vouchers de la personne sous un autre logo ; le catalogue de Taxi seulement.
    const miens = new Set(etat.brut.dossiers.filter((d) => d.cree_par === etat.session.id).map((d) => d.id));
    const lieux = suggestionsLieux(
      etat.brut.prestations.filter((p) => p.entite_id === origine),
      etat.brut.reservations.filter((r) => r.entite_id === origine || miens.has(r.dossier_id))
    );
    const liste = h("datalist", { id: "vr-lieux" }, lieux.map((l) => h("option", { value: l })));
    const champ = (cle, libelle, input, aide = null, classe = "") => {
      input.id = `vr-${cle}`;
      input.value = valeurs[cle] ?? "";
      input.defaultValue = cible ? input.value : "";
      if (cle === "adultes" && !cible) input.defaultValue = input.value;
      const err = h("p", { class: "vr-erreur", id: `vr-${cle}-erreur`, role: "alert", hidden: true });
      const aideNoeud = aide ? h("p", { class: "vr-aide", id: `vr-${cle}-aide` }, aide) : null;
      input.setAttribute("aria-describedby", [aide ? `vr-${cle}-aide` : "", `vr-${cle}-erreur`].filter(Boolean).join(" "));
      // L'erreur s'efface dès que la personne corrige le champ.
      input.addEventListener("input", () => {
        if (!err.hidden) (err.hidden = true), input.removeAttribute("aria-invalid");
        occupe(true);
      });
      champs[cle] = input;
      erreurs[cle] = err;
      return h("div", { class: `vr-champ ${classe}`.trim() }, h("label", { for: input.id }, libelle), input, aideNoeud, err);
    };
    const texte = (attrs = {}) => h("input", { type: "text", autocomplete: "off", autocapitalize: "words", spellcheck: "false", enterkeyhint: "next", ...attrs });
    const nombre = (attrs = {}) => h("input", { type: "text", inputmode: "numeric", pattern: "[0-9]*", autocomplete: "off", enterkeyhint: "next", ...attrs });

    // Client déjà connu : le même nom vu ces 30 derniers jours (un aller puis son retour) se choisit d'un tap, sans créer de doublon.
    // Le client choisi reste lié tant que le nom n'est pas retouché.
    let clientId = valeurs.client_id || "";
    const connus = h("div", { class: "vr-connus", "aria-live": "polite" });
    const proposer = () => {
      const choisi = clientId && etat.db.clients.find((c) => c.id === clientId);
      if (choisi && [choisi.prenom, choisi.nom].filter(Boolean).join(" ") !== champs.nom.value.trim().replace(/\s+/g, " ")) clientId = "";
      const liste = clientId ? [] : clientsRecents({ nom: champs.nom.value, clients: etat.db.clients, dossiers: etat.db.dossiers, reservations: etat.db.reservations, aujourdhui: aujourdhui() });
      connus.replaceChildren(
        ...liste.map((c) =>
          h(
            "p",
            { class: "vr-connu" },
            h("span", null, `${TH.client_connu} : ${[c.prenom, c.nom].filter(Boolean).join(" ")}${c.telephone ? ` · ${c.telephone}` : ""}`),
            h("button", { class: "secondaire petit", type: "button", onclick: () => {
              clientId = c.id;
              champs.nom.value = [c.prenom, c.nom].filter(Boolean).join(" ");
              if (!champs.telephone.value.trim() && c.telephone) champs.telephone.value = c.telephone;
              proposer();
            } }, TH.utiliser_client)
          )
        )
      );
    };
    // Le logo : deux choix en haut du formulaire, VIP Taxi Lanta coché par défaut. Un client déjà connu appartient à une entreprise :
    // changer de logo le délie et cherche les clients connus de l'autre.
    const choisirMarque = (id) => {
      travaillerPourVoucher(id);
      occupe(etat.entiteId !== origine);
      clientId = "";
      proposer();
    };
    const marque = !choixMarques
      ? null
      : cible
        ? h("p", { class: "vr-marque-fixe" }, `${TH.marque} : `, h("strong", null, nomEntite(etat.entiteId)))
        : h(
            "fieldset",
            { class: "vr-marques", "aria-describedby": "vr-marque-aide" },
            h("legend", null, TH.marque),
            h("div", { class: "vr-marques-choix" }, marques.map((m) => h("label", { class: "vr-marque" }, h("input", { type: "radio", name: "vr-marque", value: m.id, checked: m.id === etat.entiteId, onchange: () => choisirMarque(m.id) }), h("span", { lang: "en" }, m.nom)))),
            h("p", { class: "vr-aide", id: "vr-marque-aide" }, TH.marque_aide)
          );
    const form = h(
      "form",
      { class: "vr-form", novalidate: true, onsubmit: (e) => (e.preventDefault(), verifier()) },
      marque,
      champ("nom", TH.nom, texte({ autocomplete: "off", name: "vr-nom" }), TH.anglais_aide),
      connus,
      champ("telephone", TH.telephone, h("input", { type: "tel", inputmode: "tel", autocomplete: "off", enterkeyhint: "next" }), TH.telephone_aide),
      champ("date", TH.date, h("input", { type: "date" })),
      champ("pickup", TH.pickup, texte({ list: "vr-lieux" }), TH.anglais_aide),
      champ("heure", TH.heure, h("input", { type: "time", step: 300 })),
      // Aller simple ou retour au point de départ (16.11.2026) : le second remplace le drop-off par le programme et la durée.
      champ("trajet", TH.trajet, h("select", null, h("option", { value: "" }, TH.trajet_simple), h("option", { value: RETOUR_DEPART }, TH.trajet_retour)), TH.trajet_aide),
      champ("dropoff", TH.dropoff, texte({ list: "vr-lieux" }), TH.anglais_aide, "vr-si-simple"),
      champ("programme", TH.programme, h("textarea", { rows: 2, autocomplete: "off", autocapitalize: "sentences", spellcheck: "false" }), TH.programme_aide, "vr-si-retour"),
      champ("duree", TH.duree, h("input", { type: "text", inputmode: "decimal", autocomplete: "off", enterkeyhint: "next" }), TH.duree_aide, "vr-court vr-si-retour"),
      champ("vol", TH.vol, texte({ autocapitalize: "characters" }), TH.vol_aide),
      h("div", { class: "vr-trio" }, champ("adultes", TH.adultes, nombre()), champ("enfants", TH.enfants, nombre()), champ("bagages", TH.bagages, texte({ inputmode: "text", autocapitalize: "off" }), TH.bagages_aide)),
      champ("sieges", TH.sieges, nombre(), TH.sieges_aide, "vr-court"),
      champ("prix", TH.prix, h("input", { type: "text", inputmode: "decimal", autocomplete: "off", enterkeyhint: "done" }), TH.prix_aide, "vr-prix"),
      liste,
      h(
        "div",
        { class: "vr-barre" },
        cible ? h("button", { class: "secondaire", type: "button", onclick: () => formulaire() }, TH.annuler) : null,
        h("button", { class: "principal", type: "submit" }, TH.apercu)
      )
    );

    function verifier() {
      const v = { ...Object.fromEntries(CHAMPS.map((c) => [c, champs[c].value])), client_id: clientId, entite_id: etat.entiteId };
      const e = erreursVoucher(v);
      for (const c of CHAMPS) {
        erreurs[c].hidden = !e[c];
        erreurs[c].textContent = e[c] ? TH[e[c]] : "";
        champs[c].toggleAttribute("aria-invalid", !!e[c]);
      }
      const premiere = CHAMPS.find((c) => e[c]);
      if (premiere) return champs[premiere].focus();
      apercu(v, cible);
    }

    champs.nom.addEventListener("input", proposer);
    proposer();
    // Le drop-off ou le programme et la durée, selon le type de trajet ; un champ caché garde ce qui y est écrit.
    const majTrajet = () => {
      const retour = champs.trajet.value === RETOUR_DEPART;
      for (const n of form.querySelectorAll(".vr-si-simple")) n.hidden = retour;
      for (const n of form.querySelectorAll(".vr-si-retour")) n.hidden = !retour;
    };
    champs.trajet.addEventListener("change", majTrajet);
    majTrajet();
    racine.replaceChildren(h("h1", null, cible ? TH.titre_modif : TH.titre), form, cible ? null : listeVouchers());
    window.scrollTo(0, 0);
  }

  // ---- 2. Aperçu ------------------------------------------------------------------------------------------------------
  function apercu(valeurs, cible = null) {
    occupe(true);
    const x = donneesVoucher(valeurs);
    const client = { prenom: "", nom: x.nom };
    const r = cible ? { ...cible.reservation, ...correctionReservation(cible.reservation, x) } : reservationApercu(x, { independant: independant() });
    const image = h("div", { class: "vr-image", "aria-live": "polite" }, h("p", { class: "vr-attente" }, TH.preparation));
    // Le voucher de Secret imprime son numéro (référence du dossier et rang) : une correction montre le sien, un nouveau celui qui est proposé.
    // Le Booking confirmation de Taxi n'en a pas. Après l'enregistrement, l'image envoyée est refaite avec le dossier réel (voir plus bas).
    const vu = cible ? voucherDe(cible.dossier.id, cible.reservation.id) : null;
    const dossierApercu = cible ? cible.dossier : modeTaxi() ? {} : { ref: refProposee() };
    const bouton = h("button", { class: "principal", type: "button", disabled: true }, TH.preparation);
    const etat_ = h("div", { class: "vr-etat", role: "status" });
    let blob = null;
    // Une image ratée (mémoire du téléphone) se refait d'un tap, sans repasser par le formulaire.
    const fabriquer = () => {
      image.replaceChildren(h("p", { class: "vr-attente" }, TH.preparation));
      bouton.disabled = true;
      bouton.textContent = TH.preparation;
      imageVoucher({ reservation: r, prestation: null, type: "transfert", index: (vu && vu.index) || 1, numero: vu && vu.numero }, { client, dossier: dossierApercu, resume: null })
        .then((b) => {
          blob = b;
          image.replaceChildren(h("img", { src: urlImage(b), alt: "Booking confirmation" }));
          bouton.disabled = false;
          bouton.textContent = cible ? TH.enregistrer : TH.creer;
        })
        .catch((err) => {
          image.replaceChildren(h("p", { class: "vr-erreur" }, `${TH.image_echec} (${err.message})`));
          bouton.disabled = false;
          bouton.textContent = TH.reessayer;
        });
    };
    racine.replaceChildren(
      h("button", { class: "lien vr-retour", type: "button", onclick: () => formulaire(valeurs, cible) }, icone("retour", 18), TH.modifier),
      ligneMarque(etat.entiteId),
      h("h1", null, x.nom),
      h("p", { class: "vr-resume" }, [dateCourteTh(x.date), heureBooking(x.heure), x.libelle].filter(Boolean).join(" · ")),
      image,
      etat_,
      h("div", { class: "vr-barre" }, bouton)
    );
    window.scrollTo(0, 0);
    fabriquer();
    // Ce qu'un essai précédent a déjà créé avant d'échouer : le nouvel essai le reprend au lieu de créer des doublons.
    const essai = { clientId: null, dossierId: null };
    bouton.addEventListener("click", async () => {
      if (!blob) return fabriquer();
      bouton.disabled = true;
      bouton.textContent = TH.creation;
      etat_.textContent = "";
      try {
        const fait = cible ? await corriger(cible, x) : await creer(x, essai);
        // La Booking confirmation (Taxi comme Secret) n'imprime pas de numéro : l'image de l'aperçu est celle du voucher enregistré.
        // Un voucher qui imprime son numéro (un autre modèle) se refait avec le dossier réel.
        if (estBookingConfirmation(fait.reservation, fait.type, reglages())) envoi(fait, blob, { essayer: true, titre: cible ? TH.modifie : TH.cree });
        else renvoyer(fait, { essayer: true, titre: cible ? TH.modifie : TH.cree });
      } catch (err) {
        console.error(err);
        etat_.replaceChildren(h("p", { class: "vr-erreur" }, `${TH.echec} (${err.message})`));
        bouton.disabled = false;
        bouton.textContent = cible ? TH.enregistrer : TH.creer;
      }
    });
  }

  // Création en une fois : le client (nom et WhatsApp facultatif, ou un client déjà connu), le dossier, le prix interne de la course et sa réservation payée au chauffeur.
  // Le client, puis le dossier, sont gardés par l'aperçu (`essai`) dès qu'ils existent : si la suite échoue, un second tap reprend là.
  async function creer(x, essai) {
    // Un client déjà connu, choisi d'un tap, sert tel quel ; sinon un nouveau, avec son WhatsApp s'il est donné.
    if (!essai.clientId && x.clientId && etat.db.clients.some((c) => c.id === x.clientId)) essai.clientId = x.clientId;
    if (!essai.clientId) essai.clientId = (await inserer("clients", { civilite: "", prenom: "", nom: x.nom, adresse: "", telephone: x.telephone, email: "", notes: "" })).id;
    else await majClient(essai.clientId, x);
    const p = partenaireTaxi();
    if (!essai.dossierId) {
      const propose = refProposee();
      const ref = await refDefinitive(propose, propose);
      essai.dossierId = (await creerDossierExcursions({ client: { id: essai.clientId }, lignes: [ligneVoucher(x, { id: uid(), partenaireId: p ? p.id : null })], ref, parService: null, reservation: reservationVoucher(x, { independant: independant() }), silencieux: true })).id;
    } else if (!voucherDe(essai.dossierId).reservation) {
      // Dossier créé mais réservation refusée au premier essai : on ne pose que la réservation, liée à la ligne du prix interne.
      await chargerDossier(essai.dossierId);
      const doc = etat.db.documents.find((y) => y.dossier_id === essai.dossierId && y.type === "facture");
      const ligne = doc && (doc.contenu.lignes || []).find((l) => l.kind === "ligne");
      const r = reservationApercu(x, { independant: independant() });
      await inserer("reservations", { dossier_id: essai.dossierId, ligne_id: ligne ? ligne.id : null, prestation_id: null, trajet_id: null, partenaire_id: p ? p.id : null, libelle: r.libelle, date_service: r.date_service, heure_pickup: r.heure_pickup, lieu_pickup: r.lieu_pickup, personnes: r.personnes, statut: r.statut, reference_partenaire: "", montant_vente: r.montant_vente, notes: "", paye_sur_place: true, details: r.details });
    }
    const v = voucherDe(essai.dossierId);
    // creerReservations n'arrête pas la création quand la réservation échoue : on ne dit pas « créé » à tort.
    if (!v.reservation) throw new Error("reservation");
    return v;
  }

  // Le nom et le WhatsApp saisis passent sur la fiche du client ; un WhatsApp laissé vide n'efface pas celui qu'Anaïs a noté.
  async function majClient(id, x) {
    const c = etat.db.clients.find((y) => y.id === id) || {};
    const patch = {
      ...([c.prenom, c.nom].filter(Boolean).join(" ") !== x.nom ? { prenom: "", nom: x.nom } : {}),
      ...(x.telephone && x.telephone !== (c.telephone || "") ? { telephone: x.telephone } : {}),
    };
    if (Object.keys(patch).length) await modifier("clients", id, patch);
  }

  // Correction : le nom, la course et son prix interne (jamais montré) suivent ce qui a été saisi.
  async function corriger(cible, x) {
    // Les valeurs de la base au moment d'enregistrer, pas celles de la liste : Anaïs a pu changer la course entre-temps.
    const r = etat.db.reservations.find((y) => y.id === cible.reservation.id) || cible.reservation;
    const d = etat.db.dossiers.find((y) => y.id === cible.dossier.id) || cible.dossier;
    const client = etat.db.clients.find((y) => y.id === cible.client.id) || cible.client;
    await majClient(client.id, x);
    const suite = correctionReservation(r, x);
    if (suite) {
      await modifier("reservations", r.id, suite);
      await chargerDossier(d.id);
      const neuve = etat.db.reservations.find((y) => y.id === r.id) || { ...r, ...suite };
      const doc = etat.db.documents.find((y) => y.dossier_id === d.id && y.type === "facture");
      const contenu = doc ? contenuCourse(doc.contenu, neuve) : null;
      if (contenu) await modifier("documents", doc.id, { contenu, updated_at: new Date().toISOString() });
      if ((d.bandeau || "") !== x.libelle) await modifier("dossiers", d.id, { bandeau: x.libelle.slice(0, 120) });
      await synchroniserDatesDossier(d.id);
    }
    return voucherDe(d.id, r.id);
  }

  // Le voucher tel que l'outil le numérote (référence du dossier et rang de la course), pour le nom du fichier.
  const voucherDe = (dossierId, reservationId = null) => {
    const d = etat.db.dossiers.find((y) => y.id === dossierId) || {};
    const liste = vouchersDuDossier(dossierId);
    const v = (reservationId && liste.find((y) => y.reservation.id === reservationId)) || liste[liste.length - 1] || { reservation: null, index: 1 };
    const client = etat.db.clients.find((c) => c.id === d.client_id) || {};
    // Sous un autre logo que Taxi, le nom du fichier commence par l'entreprise : Anaïs sait d'un coup d'œil de laquelle il s'agit.
    const fichier = nomFichierVoucher(v.numero || numeroVoucher(d.ref || "", v.index), client.nom || client.prenom || "", { taxi: estBookingConfirmation(v.reservation, v.type, reglages()) });
    const prefixe = d.entite_id && d.entite_id !== origine ? `${nomEntite(d.entite_id).replace(/[\\/:*?"<>|]/g, "").trim()} - ` : "";
    return { ...v, dossier: d, client, entite_id: d.entite_id || null, nomFichier: `${prefixe}${fichier}` };
  };

  // ---- 3. Envoi à Anaïs -------------------------------------------------------------------------------------------
  // `essayer` : juste après le tap de création, la liste de partage s'ouvre d'elle-même si le téléphone l'accepte encore ;
  // sinon (le navigateur exige un tap neuf), le gros bouton « Envoyer l'image à Anaïs » attend.
  function envoi(v, blob, { essayer = false, titre = "" } = {}) {
    occupe(true);
    const fichier = new File([blob], v.nomFichier, { type: "image/png" });
    const chemin = moyen([fichier]);
    const tel = telAnais();
    const message = h("div", { class: "vr-etat", role: "status" });
    const dire = (texte, erreur = false) => message.replaceChildren(h("p", { class: erreur ? "vr-erreur" : "vr-ok" }, texte));
    // Un seul partage à la fois : le partage ouvert tout seul après la création peut encore être en cours quand Mook touche le bouton.
    let enCours = null;
    const partagerUneFois = () => (enCours ||= partager([fichier]).finally(() => (enCours = null)));
    // L'image partie vers Anaïs, qui la transmet au client : l'envoi est noté, la fiche ne reste pas à « 0 sur 1 » (une fois par écran).
    // Sur un téléphone qui ne partage pas, l'image enregistrée est celle que Mook envoie elle-même dans WhatsApp : notée aussi.
    let note = false;
    const noter = () => {
      if (note || !v.reservation) return;
      note = true;
      // Dans l'entreprise du voucher, même si Mook a déjà commencé un nouveau voucher sous l'autre logo.
      dansEntite(v.dossier.entite_id || etat.entiteId, () => noterEnvoi(v.reservation, "client"));
    };
    const envoyer = async () => {
      if (chemin === "natif") {
        const res = await partagerUneFois();
        if (res === "ok") return noter(), dire(`✓ ${TH.choisir_anais}`);
        if (res === "annule") return dire(TH.choisir_anais);
        return dire(TH.partage_echec, true);
      }
      if (chemin === "ordinateur") {
        const res = await copierImage(fichier);
        if (!res.ok) return dire(TH.partage_echec, true);
        noter();
        dire(TH.image_copiee);
        if (tel) {
          const f = window.open(lienWhatsApp(tel, ""), "_blank");
          if (f) f.opener = null;
        }
        return;
      }
      dire(TH.partage_impossible, true);
    };
    const boutonEnvoyer = h("button", { class: "principal", type: "button", onclick: envoyer }, icone("whatsapp", 20), TH.envoyer);
    racine.replaceChildren(
      titre ? h("p", { class: "vr-succes" }, icone("coche", 22), titre) : null,
      ligneMarque(v.dossier.entite_id),
      h("h1", null, v.client.nom || ""),
      h("p", { class: "vr-resume" }, [dateCourteTh(v.reservation && v.reservation.date_service), heureBooking(v.reservation && v.reservation.heure_pickup), v.reservation && v.reservation.libelle].filter(Boolean).join(" · ")),
      message,
      h(
        "div",
        { class: "vr-barre vr-barre-envoi" },
        chemin === "telephone_sans_partage" ? null : boutonEnvoyer,
        h("button", { class: chemin === "telephone_sans_partage" ? "principal" : "secondaire", type: "button", onclick: () => (enregistrer([fichier]), noter()) }, TH.enregistrer_image),
        tel && chemin !== "ordinateur" ? h("a", { class: "bouton secondaire", href: lienWhatsApp(tel, ""), target: "_blank", rel: "noopener" }, TH.ouvrir_chat) : null,
        h("button", { class: "secondaire", type: "button", onclick: () => formulaire() }, TH.nouveau)
      ),
      // Les boutons d'abord : si la liste de partage ne s'est pas ouverte seule, « Envoyer l'image à Anaïs » est sous le pouce, sans défiler.
      h("div", { class: "vr-image" }, h("img", { src: urlImage(blob), alt: "Booking confirmation" }))
    );
    window.scrollTo(0, 0);
    if (chemin === "telephone_sans_partage") dire(TH.partage_impossible, true);
    else if (chemin === "natif") dire(TH.choisir_anais);
    if (essayer && chemin === "natif") {
      // Le tap de création a pu « expirer » pendant l'enregistrement : un refus du navigateur ne dit rien de grave, le bouton reste là.
      partagerUneFois().then((res) => (res === "ok" ? (noter(), dire(`✓ ${TH.choisir_anais}`)) : res === "annule" || (res.erreur && res.erreur.name === "NotAllowedError") ? null : dire(TH.partage_echec, true)));
    }
  }

  // Renvoyer un voucher déjà créé : l'image se refait (elle suit toute correction), puis le même écran d'envoi.
  // Le voucher se refait dans son entreprise, avec ses réglages, son logo et son numéro.
  // Juste après une création (`options.titre`), « créé » s'affiche dès l'attente : une image ratée ne fait pas croire que rien n'a été enregistré,
  // et « Refaire l'image » la refait sans recréer de dossier.
  let tirage = 0;
  function renvoyer(v, options = {}) {
    const entite = v.entite_id || v.dossier.entite_id;
    travaillerPourVoucher(entite);
    occupe(true);
    const moi = ++tirage;
    const retour = h("button", { class: "lien vr-retour", type: "button", onclick: () => (tirage++, formulaire()) }, icone("retour", 18), TH.retour);
    const succes = options.titre ? h("p", { class: "vr-succes" }, icone("coche", 22), options.titre) : null;
    // L'entreprise du voucher n'est plus permise (accès retiré) : jamais une image faite avec les réglages d'une autre.
    if (entite && etat.entiteId !== entite) return racine.replaceChildren(retour, h("p", { class: "vr-erreur" }, TH.image_echec));
    const x = voucherDe(v.dossier.id, v.reservation.id);
    racine.replaceChildren(retour, succes, h("p", { class: "vr-attente" }, TH.preparation));
    imageVoucher({ reservation: x.reservation || v.reservation, prestation: null, type: "transfert", index: x.index || 1, numero: x.numero }, { client: x.client, dossier: x.dossier, resume: null })
      // Mook a pu revenir au formulaire pendant la préparation : l'image arrivée après ne remplace pas ce qu'elle fait.
      .then((blob) => moi === tirage && envoi(x, blob, options))
      .catch((err) => {
        if (moi !== tirage) return;
        racine.replaceChildren(retour, succes, h("p", { class: "vr-erreur" }, `${TH.image_echec} (${err.message})`), h("div", { class: "vr-barre" }, h("button", { class: "principal", type: "button", onclick: () => renvoyer(v, options) }, TH.reessayer)));
      });
  }

  // ---- 4. Derniers vouchers --------------------------------------------------------------------------------------
  function listeVouchers() {
    // Ceux des deux entreprises (Taxi et Secret), chacun avec la sienne.
    const entites = choixMarques ? marques.map((m) => m.id) : [etat.entiteId];
    const liste = mesVouchers({ reservations: etat.brut.reservations, dossiers: etat.brut.dossiers, clients: etat.brut.clients, moi: etat.session.id, entites });
    return h(
      "section",
      { class: "vr-liste", "aria-labelledby": "vr-derniers" },
      h("h2", { id: "vr-derniers" }, TH.derniers),
      liste.length
        ? h(
            "ul",
            null,
            liste.map((v) => {
              const r = v.reservation;
              return h(
                "li",
                { class: v.annule ? "annule" : "" },
                h(
                  "div",
                  { class: "vr-ligne-texte" },
                  h("strong", null, [v.client.prenom, v.client.nom].filter(Boolean).join(" ")),
                  h("span", null, [dateCourteTh(r.date_service), heureBooking(r.heure_pickup)].filter(Boolean).join(" · ")),
                  h("span", { class: "vr-trajet" }, r.libelle || ""),
                  choixMarques || v.annule ? h("span", { class: "vr-tags" }, choixMarques ? h("span", { class: `tag vr-tag-marque${v.entite_id === origine ? "" : " autre"}`, lang: "en" }, nomEntite(v.entite_id)) : null, v.annule ? h("span", { class: "tag" }, TH.annule) : null) : null
                ),
                v.annule
                  ? null
                  : h(
                      "div",
                      { class: "vr-ligne-actions" },
                      h("button", { class: "secondaire", type: "button", onclick: () => formulaire(valeursDepuis(r, v.client), v) }, TH.modifier),
                      h("button", { class: "secondaire", type: "button", onclick: () => renvoyer(v) }, TH.renvoyer)
                    )
              );
            })
          )
        : h("p", { class: "vr-aide" }, TH.aucun)
    );
  }

  formulaire();
  return racine;
}
