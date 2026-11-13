// Écran « Nouveau voucher » de VIP Taxi Lanta (12.11.2026), en thaï, pour l'assistante d'Anaïs : un formulaire, l'aperçu de la
// « Booking confirmation », un bouton qui crée tout (client, dossier, course payée au chauffeur, voucher) et envoie l'image à Anaïs,
// puis la liste de ses derniers vouchers pour corriger une heure ou renvoyer. Le voucher reste en anglais. Logique : voucher-rapide-calc.mjs.
import { etat, inserer, modifier, reglages, chargerDossier } from "../etat.mjs";
import { h, icone } from "../ui.mjs";
import { uid } from "../defauts.mjs";
import { TH, CHAMPS, valeursVides, erreursVoucher, donneesVoucher, ligneVoucher, reservationVoucher, reservationApercu, correctionReservation, valeursDepuis, suggestionsLieux, mesVouchers, dateCourteTh, partenaireDeTaxi } from "../voucher-rapide-calc.mjs";
import { contenuCourse, heureBooking, estTaxi } from "../taxi-calc.mjs";
import { numeroVoucher, nomFichierVoucher, lienWhatsApp } from "../operations-calc.mjs";
import { chiffres } from "../partenaires-calc.mjs";
import { creerDossierExcursions, refProposee, refDefinitive } from "./creation-excursions.mjs";
import { synchroniserDatesDossier } from "./suivi-facture.mjs";
import { vouchersDuDossier } from "./voucher.mjs";
import { imageVoucher } from "./voucher-envoi.mjs";
import { moyen, partager, enregistrer, copierImage } from "./partage.mjs";

// Le partenaire de la course : VIP Taxi Lanta, seul partenaire de l'entreprise (lu avec le droit « voir les partenaires »).
const partenaireTaxi = () => partenaireDeTaxi(etat.db.partenaires);
const telAnais = () => chiffres((reglages().voucher || {}).whatsapp_anais || "").replace("+", "");

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

  // ---- 1. Formulaire ----------------------------------------------------------------------------------------------
  // `cible` : le voucher corrigé ({ reservation, dossier, client }), sinon un nouveau.
  function formulaire(valeurs = valeursVides(), cible = null) {
    occupe(!!cible);
    const champs = {};
    const erreurs = {};
    const lieux = suggestionsLieux(etat.db.prestations, etat.db.reservations);
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

    const form = h(
      "form",
      { class: "vr-form", novalidate: true, onsubmit: (e) => (e.preventDefault(), verifier()) },
      champ("nom", TH.nom, texte({ autocomplete: "off", name: "vr-nom" }), TH.anglais_aide),
      champ("date", TH.date, h("input", { type: "date" })),
      champ("pickup", TH.pickup, texte({ list: "vr-lieux" }), TH.anglais_aide),
      champ("heure", TH.heure, h("input", { type: "time", step: 300 })),
      champ("dropoff", TH.dropoff, texte({ list: "vr-lieux" }), TH.anglais_aide),
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
      const v = Object.fromEntries(CHAMPS.map((c) => [c, champs[c].value]));
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

    racine.replaceChildren(h("h1", null, cible ? TH.titre_modif : TH.titre), form, cible ? null : listeVouchers());
    window.scrollTo(0, 0);
  }

  // ---- 2. Aperçu ------------------------------------------------------------------------------------------------------
  function apercu(valeurs, cible = null) {
    occupe(true);
    const x = donneesVoucher(valeurs);
    const client = { prenom: "", nom: x.nom };
    const r = cible ? { ...cible.reservation, ...correctionReservation(cible.reservation, x) } : reservationApercu(x);
    const image = h("div", { class: "vr-image", "aria-live": "polite" }, h("p", { class: "vr-attente" }, TH.preparation));
    const bouton = h("button", { class: "principal", type: "button", disabled: true }, TH.preparation);
    const etat_ = h("div", { class: "vr-etat", role: "status" });
    let blob = null;
    // Une image ratée (mémoire du téléphone) se refait d'un tap, sans repasser par le formulaire.
    const fabriquer = () => {
      image.replaceChildren(h("p", { class: "vr-attente" }, TH.preparation));
      bouton.disabled = true;
      bouton.textContent = TH.preparation;
      imageVoucher({ reservation: r, prestation: null, type: "transfert", index: 1 }, { client, dossier: {}, resume: null })
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
        envoi(fait, blob, { essayer: true, titre: cible ? TH.modifie : TH.cree });
      } catch (err) {
        console.error(err);
        etat_.replaceChildren(h("p", { class: "vr-erreur" }, `${TH.echec} (${err.message})`));
        bouton.disabled = false;
        bouton.textContent = cible ? TH.enregistrer : TH.creer;
      }
    });
  }

  // Création en une fois : le client (nom seul, sans téléphone), le dossier, le prix interne de la course et sa réservation payée au chauffeur.
  // Le client, puis le dossier, sont gardés par l'aperçu (`essai`) dès qu'ils existent : si la suite échoue, un second tap reprend là.
  async function creer(x, essai) {
    if (!essai.clientId) essai.clientId = (await inserer("clients", { civilite: "", prenom: "", nom: x.nom, adresse: "", telephone: "", email: "", notes: "" })).id;
    else if ((etat.db.clients.find((c) => c.id === essai.clientId) || {}).nom !== x.nom) await modifier("clients", essai.clientId, { prenom: "", nom: x.nom });
    const p = partenaireTaxi();
    if (!essai.dossierId) {
      const propose = refProposee();
      const ref = await refDefinitive(propose, propose);
      essai.dossierId = (await creerDossierExcursions({ client: { id: essai.clientId }, lignes: [ligneVoucher(x, { id: uid(), partenaireId: p ? p.id : null })], ref, parService: null, reservation: reservationVoucher(x), silencieux: true })).id;
    } else if (!voucherDe(essai.dossierId).reservation) {
      // Dossier créé mais réservation refusée au premier essai : on ne pose que la réservation, liée à la ligne du prix interne.
      await chargerDossier(essai.dossierId);
      const doc = etat.db.documents.find((y) => y.dossier_id === essai.dossierId && y.type === "facture");
      const ligne = doc && (doc.contenu.lignes || []).find((l) => l.kind === "ligne");
      const r = reservationApercu(x);
      await inserer("reservations", { dossier_id: essai.dossierId, ligne_id: ligne ? ligne.id : null, prestation_id: null, trajet_id: null, partenaire_id: p ? p.id : null, libelle: r.libelle, date_service: r.date_service, heure_pickup: r.heure_pickup, lieu_pickup: r.lieu_pickup, personnes: r.personnes, statut: "a_demander", reference_partenaire: "", montant_vente: r.montant_vente, notes: "", paye_sur_place: true, details: r.details });
    }
    const v = voucherDe(essai.dossierId);
    // creerReservations n'arrête pas la création quand la réservation échoue : on ne dit pas « créé » à tort.
    if (!v.reservation) throw new Error("reservation");
    return v;
  }

  // Correction : le nom, la course et son prix interne (jamais montré) suivent ce qui a été saisi.
  async function corriger(cible, x) {
    // Les valeurs de la base au moment d'enregistrer, pas celles de la liste : Anaïs a pu changer la course entre-temps.
    const r = etat.db.reservations.find((y) => y.id === cible.reservation.id) || cible.reservation;
    const d = etat.db.dossiers.find((y) => y.id === cible.dossier.id) || cible.dossier;
    const client = etat.db.clients.find((y) => y.id === cible.client.id) || cible.client;
    if ([client.prenom, client.nom].filter(Boolean).join(" ") !== x.nom) await modifier("clients", client.id, { prenom: "", nom: x.nom });
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
    return { ...v, dossier: d, client, nomFichier: nomFichierVoucher(numeroVoucher(d.ref || "", v.index), client.nom || client.prenom || "", { taxi: estTaxi(reglages()) }) };
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
    const envoyer = async () => {
      if (chemin === "natif") {
        const res = await partagerUneFois();
        if (res === "ok") return dire(`✓ ${TH.choisir_anais}`);
        if (res === "annule") return dire(TH.choisir_anais);
        return dire(TH.partage_echec, true);
      }
      if (chemin === "ordinateur") {
        const res = await copierImage(fichier);
        if (!res.ok) return dire(TH.partage_echec, true);
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
      h("h1", null, v.client.nom || ""),
      h("p", { class: "vr-resume" }, [dateCourteTh(v.reservation && v.reservation.date_service), heureBooking(v.reservation && v.reservation.heure_pickup), v.reservation && v.reservation.libelle].filter(Boolean).join(" · ")),
      message,
      h(
        "div",
        { class: "vr-barre vr-barre-envoi" },
        chemin === "telephone_sans_partage" ? null : boutonEnvoyer,
        h("button", { class: chemin === "telephone_sans_partage" ? "principal" : "secondaire", type: "button", onclick: () => enregistrer([fichier]) }, TH.enregistrer_image),
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
      partagerUneFois().then((res) => (res === "ok" ? dire(`✓ ${TH.choisir_anais}`) : res === "annule" || (res.erreur && res.erreur.name === "NotAllowedError") ? null : dire(TH.partage_echec, true)));
    }
  }

  // Renvoyer un voucher déjà créé : l'image se refait (elle suit toute correction), puis le même écran d'envoi.
  function renvoyer(v) {
    occupe(true);
    racine.replaceChildren(h("button", { class: "lien vr-retour", type: "button", onclick: () => formulaire() }, icone("retour", 18), TH.retour), h("p", { class: "vr-attente" }, TH.preparation));
    imageVoucher({ reservation: v.reservation, prestation: null, type: "transfert", index: 1 }, { client: v.client, dossier: v.dossier, resume: null })
      .then((blob) => envoi(voucherDe(v.dossier.id, v.reservation.id), blob))
      .catch((err) => racine.append(h("p", { class: "vr-erreur" }, `${TH.image_echec} (${err.message})`)));
  }

  // ---- 4. Derniers vouchers --------------------------------------------------------------------------------------
  function listeVouchers() {
    const liste = mesVouchers({ reservations: etat.db.reservations, dossiers: etat.db.dossiers, clients: etat.db.clients, moi: etat.session.id });
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
                  v.annule ? h("span", { class: "tag" }, TH.annule) : null
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
