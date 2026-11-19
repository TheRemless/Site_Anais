// « Prix et horaires d'un itinéraire » (20.11.2026) : le client donne ses hôtels et ses dates et demande les tarifs et horaires de ses trajets.
// Un seul écran, de haut en bas, sans quitter l'outil :
//   1. Anaïs colle le message, l'assistant en tire les étapes (hôtel, dates, personnes) ; elle corrige.
//   2. Chaque hôtel est placé sur un lieu du catalogue : déjà connu (table des hôtels situés), écrit par le client, ou cherché sur le web
//      (le nom de l'hôtel seulement). La source est toujours montrée ; une correction d'Anaïs est gardée pour la prochaine fois.
//   3. Les trajets entre les étapes et leurs départs viennent du catalogue. La marge se calcule ici, avec les nets qu'elle a le droit de lire :
//      les horaires de la meilleure marge sont proposés, les autres compagnies restent visibles pour elle seule.
//   4. L'assistant rédige la réponse depuis ces faits (prix de vente et horaires, jamais un net ni une compagnie). Anaïs la relit et la copie.
//   5. Le client choisit : un geste ouvre « Coller une demande » avec les trajets retenus, prête à créer le dossier.
import { etat, reglages, nomPartenaire, netTrajet, peut, chargerHotelsLieux, hotelsLieux, tableHotelsDisponible, enregistrerHotelLieu } from "../etat.mjs";
import { h, modal, toast, champ } from "../ui.mjs";
import { formatMontant, aujourdhui } from "../calc.mjs";
import { tr, N_, pluriel, langueActive } from "../i18n.mjs";
import { lieuxDuCatalogue, trajetsEntreEtapes, departsDuTrajet, faitsReponse, servicesDepuisChoix, hotelsAChercher, completerEtape, ligneHotel, cleLieu, cleHotel, choixValables } from "../itineraire-calc.mjs";
import { messageErreur, texteAvertissement } from "./assistant-demande.mjs";

const CERTITUDE = { sure: N_("Sûr"), probable: N_("Probable"), inconnue: N_("Non tranché") };
const CLASSE = { sure: "haute", probable: "moyenne", inconnue: "basse" };

const dateLisible = (iso) => {
  if (!iso) return tr("Date à préciser");
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString(langueActive() === "en" ? "en-GB" : "fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};
const hm = (s) => String(s || "").slice(0, 5);

export function ouvrirItineraire(texteInitial = "") {
  const regl = reglages();
  const devise = regl.devise || "THB";
  const voitNets = peut("partenaires.nets");
  const ecrit = peut("dossiers.ecrire");
  const lieux = () => lieuxDuCatalogue(etat.db.trajets, etat.db.partenaires);

  let itineraire = null; // ce que l'assistant a lu : prénom, langue, personnes, remarques
  let etapes = []; // { hotel, du, au, lieu, zone, localite, source, certitude, explication, verifie, origine }
  let choix = {}; // index du trajet → id du départ retenu ("" : ne pas réserver)
  let langue = "en";
  const cherches = new Set(); // hôtels déjà cherchés pendant cet écran : pas de seconde recherche payée par mégarde
  const aChercher = () => hotelsAChercher(etapes, hotelsLieux()).filter((n) => !cherches.has(n));

  const zone = h("textarea", { id: "itineraire-texte", rows: 5, placeholder: tr("Collez le message du client avec ses hôtels et ses dates.") });
  zone.value = texteInitial || "";
  const etatLecture = h("div", { class: "assistant-etat", role: "status", "aria-live": "polite" });
  const blocEtapes = h("section", { class: "iti-section", "aria-labelledby": "iti-etapes-titre", hidden: true });
  const blocTrajets = h("section", { class: "iti-section", "aria-labelledby": "iti-trajets-titre", hidden: true });
  const blocReponse = h("section", { class: "iti-section", "aria-labelledby": "iti-reponse-titre", hidden: true });
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  // Après la réponse : quand le client a choisi ses horaires (cochés plus haut), le dossier se prépare d'un geste.
  const blocCreer = h("section", { class: "iti-section", hidden: true }, h("p", { class: "aide" }, tr("Le client a choisi : cochez ses horaires dans « Trajets et horaires », puis préparez le dossier.")), erreur, ecrit ? h("div", { class: "actions gauche" }, h("button", { class: "principal", type: "button", onclick: () => creer() }, tr("Créer le dossier avec les horaires choisis"))) : null);

  // ---- 1. Lire le message ---------------------------------------------------------------------------------------------------------
  const boutonLire = h("button", { class: "principal assistant-bouton", type: "button", onclick: () => lire() }, tr("Lire l'itinéraire"));
  async function lire() {
    const t = zone.value.trim();
    etatLecture.classList.remove("erreur");
    if (!t) return (etatLecture.textContent = tr("Collez d'abord le message du client."));
    boutonLire.disabled = true;
    boutonLire.setAttribute("aria-busy", "true");
    boutonLire.textContent = tr("Lecture…");
    etatLecture.textContent = "";
    try {
      const [r, lignes] = await Promise.all([etat.store.assistant({ usage: "itineraire", entite_id: etat.entiteId, texte: t }), chargerHotelsLieux()]);
      if (zone.value.trim() !== t) return (etatLecture.textContent = tr("Le message a changé pendant la lecture : relancez la lecture."));
      if (!r || r.erreur || !r.itineraire) {
        etatLecture.classList.add("erreur");
        etatLecture.textContent = messageErreur(r && r.erreur);
        return;
      }
      itineraire = r.itineraire;
      langue = itineraire.langue === "fr" ? "fr" : "en";
      etapes = itineraire.etapes.map((e) => completerEtape(e, { lignes, lieux: lieux() }));
      choix = {};
      const avert = (r.avertissements || []).map(texteAvertissement).filter(Boolean);
      etatLecture.replaceChildren(
        ...[
          h("p", null, etapes.length ? tr("Lu par l'assistant : vérifiez les étapes avant de chercher les trajets.") : tr("Aucune étape lue : ajoutez les hôtels à la main.")),
          itineraire.remarques ? h("p", { class: "assistant-remarque" }, itineraire.remarques) : null,
          avert.length ? h("ul", { class: "assistant-avertissements" }, avert.map((a) => h("li", null, a))) : null,
        ].filter(Boolean)
      );
      if (!etapes.length) etapes = [completerEtape({}), completerEtape({})];
      dessinerEtapes();
      dessinerTrajets();
      dessinerReponse();
    } catch {
      etatLecture.classList.add("erreur");
      etatLecture.textContent = messageErreur("");
    } finally {
      boutonLire.disabled = false;
      boutonLire.removeAttribute("aria-busy");
      boutonLire.textContent = tr("Relire l'itinéraire");
    }
  }

  // ---- 2. Les étapes et leurs lieux ------------------------------------------------------------------------------------------------
  const etatSituer = h("div", { class: "assistant-etat", role: "status", "aria-live": "polite" });
  function dessinerEtapes() {
    blocEtapes.hidden = false;
    const n = aChercher().length;
    const personnes = (cle, libelle) =>
      champ(libelle, h("input", { id: `iti-${cle}`, type: "number", min: "0", step: "1", inputmode: "numeric", value: String(itineraire[cle] || 0), onchange: (e) => ((itineraire[cle] = Math.max(0, Math.floor(Number(e.target.value) || 0))), dessinerTrajets()) }));
    blocEtapes.replaceChildren(
      ...[
      h("h3", { id: "iti-etapes-titre" }, tr("Étapes du voyage")),
      h("div", { class: "iti-personnes" }, personnes("adultes", tr("Adultes")), personnes("enfants", tr("Enfants")), itineraire.bebes ? h("p", { class: "aide" }, tr("{n} bébé : noté dans le dossier.", { n: itineraire.bebes })) : null),
      h("datalist", { id: "iti-lieux" }, lieux().map((l) => h("option", { value: l }))),
      h("ol", { class: "iti-etapes" }, etapes.map((e, i) => carteEtape(e, i))),
      h(
        "div",
        { class: "actions gauche" },
        h("button", { class: "secondaire petit", type: "button", onclick: () => (etapes.push(completerEtape({})), dessinerEtapes(), dessinerTrajets()) }, tr("Ajouter une étape")),
        n ? h("button", { class: "principal petit", type: "button", onclick: (ev) => situer(ev.currentTarget) }, pluriel(n, N_("Situer {n} hôtel sur le web"), N_("Situer {n} hôtels sur le web"))) : null
      ),
      etatSituer,
      tableHotelsDisponible() ? null : h("p", { class: "aide" }, tr("Les hôtels situés ne sont pas encore gardés (migration 48) : la recherche se refait à chaque fois.")),
      ].filter(Boolean)
    );
  }

  function carteEtape(e, i) {
    const maj = (cle, v) => {
      e[cle] = v;
      dessinerTrajets();
    };
    // Un lieu du catalogue (proposé), ou un autre lieu écrit à la main (« Koh Libong ») : le trajet sera alors « pas au catalogue ».
    const sel = h("input", { id: `iti-lieu-${i}`, list: "iti-lieux", value: e.lieu || "", autocomplete: "off", placeholder: tr("Lieu à choisir"), onchange: (ev) => corrigerLieu(e, ev.target.value.replace(/\s+/g, " ").trim()) });
    return h(
      "li",
      { class: "iti-etape" },
      h(
        "div",
        { class: "iti-etape-champs" },
        champ(tr("Hôtel"), h("input", { id: `iti-hotel-${i}`, value: e.hotel, autocomplete: "off", onchange: (ev) => ((e.hotel = ev.target.value.trim()), Object.assign(e, { lieu: "", source: null, certitude: "", origine: "", verifie: false, explication: "" }), dessinerEtapes(), dessinerTrajets()) })),
        champ(tr("Arrivée"), h("input", { id: `iti-du-${i}`, type: "date", value: e.du, onchange: (ev) => maj("du", ev.target.value) })),
        champ(tr("Départ"), h("input", { id: `iti-au-${i}`, type: "date", value: e.au, onchange: (ev) => maj("au", ev.target.value) })),
        champ(tr("Lieu"), sel)
      ),
      origineLieu(e),
      h("button", { class: "lien", type: "button", "aria-label": tr("Retirer l'étape {n}", { n: i + 1 }), onclick: () => (etapes.splice(i, 1), dessinerEtapes(), dessinerTrajets()) }, tr("Retirer"))
    );
  }

  // D'où vient le lieu : la table (vérifié ou non), le message du client, la recherche web (avec sa source), ou rien encore.
  function origineLieu(e) {
    const source = e.source && e.source.url ? h("a", { href: e.source.url, target: "_blank", rel: "noopener noreferrer" }, e.source.titre || e.source.url) : null;
    const pastille = e.certitude && CERTITUDE[e.certitude] ? h("span", { class: `assistant-confiance ${CLASSE[e.certitude]}` }, tr(CERTITUDE[e.certitude])) : null;
    const zoneTexte = [e.localite && e.localite !== e.lieu ? e.localite : "", e.zone].filter(Boolean).join(", ");
    let texte;
    if (e.origine === "main") texte = tr("Lieu choisi par vous, gardé pour la prochaine fois.");
    else if (e.origine === "table") texte = e.verifie ? tr("Hôtel déjà situé et vérifié.") : tr("Hôtel déjà situé par une recherche précédente.");
    else if (e.origine === "message") texte = tr("Lieu écrit par le client.");
    else if (e.origine === "recherche") texte = e.lieu ? tr("Situé par une recherche web : vérifiez la source.") : tr("La recherche ne tranche pas : choisissez le lieu.");
    else texte = e.hotel ? tr("Lieu à choisir, ou à chercher sur le web.") : tr("Indiquez l'hôtel ou le lieu.");
    const hors = e.lieu && !lieux().some((l) => cleLieu(l) === cleLieu(e.lieu)) ? ` ${tr("Hors catalogue : aucun trajet proposé depuis ou vers ce lieu.")}` : "";
    return h("p", { class: "iti-origine" }, pastille, " ", texte, hors, zoneTexte ? ` ${tr("Zone : {zone}.", { zone: zoneTexte })}` : "", e.explication ? ` ${e.explication}` : "", source ? h("span", null, " ", tr("Source :"), " ", source) : null);
  }

  // Anaïs choisit le lieu : il est gardé (vérifié) pour cet hôtel, sauf sans hôtel ou sans droit d'écrire.
  async function corrigerLieu(e, saisi) {
    // Écrit à la main mais présent au catalogue (« lanta ») : la forme du catalogue est gardée.
    const lieu = lieux().find((l) => cleLieu(l) === cleLieu(saisi)) || saisi;
    Object.assign(e, { lieu, origine: lieu ? "main" : "", verifie: !!lieu, certitude: lieu ? "sure" : e.certitude });
    dessinerEtapes();
    dessinerTrajets();
    // Les étapes sont redessinées : le curseur passe au champ suivant, comme la touche Tab l'aurait fait.
    const i = etapes.indexOf(e);
    const suivant = document.getElementById(`iti-hotel-${i + 1}`);
    if (suivant) suivant.focus();
    if (!lieu || !e.hotel || !ecrit || !tableHotelsDisponible()) return;
    try {
      await enregistrerHotelLieu(ligneHotel({ nom: e.hotel, lieu, zone: e.zone, localite: e.localite, source: e.source, certitude: "sure", verifie: true }));
    } catch (err) {
      toast(tr("Le lieu n'a pas pu être gardé : {erreur}", { erreur: err.message }), true);
    }
  }

  async function situer(btn) {
    const hotels = aChercher();
    if (!hotels.length) return;
    hotels.forEach((n) => cherches.add(n));
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    etatSituer.classList.remove("erreur");
    etatSituer.textContent = tr("Recherche sur le web, environ une minute…");
    try {
      const r = await etat.store.assistant({ usage: "situer", entite_id: etat.entiteId, hotels });
      if (!r || r.erreur || !Array.isArray(r.hotels)) {
        // Rien n'a été trouvé ni payé pour ces hôtels (limite, panne) : la recherche reste proposée.
        hotels.forEach((n) => cherches.delete(n));
        etatSituer.classList.add("erreur");
        etatSituer.textContent = messageErreur(r && r.erreur);
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        return;
      }
      for (const res of r.hotels) {
        // Situé hors des lieux du catalogue (« Koh Libong »), avec une source : ce lieu est retenu, le trajet sera « pas au catalogue ».
        const lieu = res.lieu || (res.certitude !== "inconnue" ? res.localite : "");
        // Comparés par clé : la fonction rend le nom nettoyé (espaces, téléphone collé), l'étape garde le nom tapé.
        for (const e of etapes.filter((x) => cleHotel(x.hotel) === cleHotel(res.nom) && !x.lieu)) Object.assign(e, { lieu, zone: res.zone, localite: res.localite, source: res.source, certitude: res.certitude, explication: res.explication, verifie: false, origine: "recherche" });
      }
      // Gardés tels quels, même non tranchés : un hôtel ne se recherche pas à chaque demande ; Anaïs peut relancer ou choisir. En une fois.
      if (ecrit && tableHotelsDisponible())
        await Promise.all(
          r.hotels.map((res) => enregistrerHotelLieu(ligneHotel({ nom: res.nom, lieu: res.lieu || (res.certitude !== "inconnue" ? res.localite : ""), zone: res.zone, localite: res.localite, source: res.source, certitude: res.certitude, verifie: false })).catch(() => null))
        );
      const nonTranches = r.hotels.filter((x) => !x.lieu).length;
      etatSituer.textContent = nonTranches ? pluriel(nonTranches, N_("{n} hôtel reste à situer : choisissez son lieu."), N_("{n} hôtels restent à situer : choisissez leur lieu.")) : tr("Hôtels situés : vérifiez les sources.");
      dessinerEtapes();
      dessinerTrajets();
    } catch {
      hotels.forEach((n) => cherches.delete(n));
      etatSituer.classList.add("erreur");
      etatSituer.textContent = messageErreur("");
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  }

  // ---- 3. Trajets et départs -------------------------------------------------------------------------------------------------------
  const propositions = () => {
    const legs = trajetsEntreEtapes(etapes);
    return legs.map((leg) => ({ leg, departs: departsDuTrajet(leg, { trajets: etat.db.trajets, partenaires: etat.db.partenaires, netDe: netTrajet, nomPartenaire, adultes: itineraire.adultes || 0, enfants: itineraire.enfants || 0 }) }));
  };

  function dessinerTrajets() {
    if (!itineraire) return;
    const props = propositions();
    blocTrajets.hidden = !props.length;
    // Un choix devenu caché (autre compagnie devenue la meilleure, lieu ou date changé, étape retirée) est oublié : rien ne se crée sans être vu.
    choix = choixValables(choix, props);
    blocTrajets.replaceChildren(
      ...[
      h("h3", { id: "iti-trajets-titre" }, tr("Trajets et horaires")),
      voitNets ? null : h("p", { class: "aide" }, tr("Votre rôle ne voit pas les nets : tous les horaires sont proposés, sans classement par marge.")),
      h("ol", { class: "iti-trajets" }, props.map(carteTrajet)),
      ].filter(Boolean)
    );
  }

  function carteTrajet({ leg, departs }) {
    const titre = h("p", { class: "iti-trajet-titre" }, h("strong", null, dateLisible(leg.date)), " · ", `${leg.de || tr("lieu à choisir")} → ${leg.vers || tr("lieu à choisir")}`);
    const notes = [];
    if (leg.ecartDates) notes.push(tr("Les dates des deux hôtels ne se suivent pas : vérifiez le jour du trajet avec le client."));
    if (leg.memeLieu) return h("li", { class: "iti-trajet" }, titre, h("p", { class: "aide" }, tr("Même lieu : pas de trajet en bateau. Un transfert d'hôtel à hôtel se prépare à la main.")));
    if (leg.incomplet) return h("li", { class: "iti-trajet" }, titre, h("p", { class: "demande-attention" }, tr("Choisissez le lieu des deux hôtels pour voir les départs.")));
    if (!departs.retenus.length) return h("li", { class: "iti-trajet" }, titre, ...notes.map((n) => h("p", { class: "demande-attention" }, n)), h("p", { class: "aide" }, tr("Pas au catalogue : la réponse dira que vous pouvez vous renseigner.")));
    const nom = `iti-depart-${leg.index}`;
    const option = (c) => {
      const t = c.trajet;
      const prix = [t.prix_adulte !== null && t.prix_adulte !== undefined ? tr("{prix} par adulte", { prix: formatMontant(t.prix_adulte, devise) }) : "", t.prix_enfant !== null && t.prix_enfant !== undefined ? tr("{prix} par enfant", { prix: formatMontant(t.prix_enfant, devise) }) : ""].filter(Boolean).join(", ");
      return h("label", { class: "case iti-depart" }, h("input", { type: "radio", name: nom, value: t.id, checked: choix[leg.index] === t.id, onchange: () => (choix[leg.index] = t.id) }), h("span", null, h("strong", null, `${hm(t.depart) || "?"}${t.arrivee ? ` → ${hm(t.arrivee)}` : ""}`), ` · ${[t.mode, t.duree].filter(Boolean).join(", ")}`, prix ? ` · ${prix}` : ""));
    };
    const aucun = h("label", { class: "case iti-depart" }, h("input", { type: "radio", name: nom, value: "", checked: !choix[leg.index], onchange: () => delete choix[leg.index] }), h("span", null, tr("Pas encore choisi par le client")));
    // Pour Anaïs seule : la compagnie et la marge de la proposition, puis les compagnies écartées. Rien de tout cela ne part dans la réponse.
    const cies = [...new Set(departs.retenus.map((c) => nomPartenaire(c.trajet.partenaire_id)).filter(Boolean))].join(", ");
    const m = departs.meilleure;
    const interne = departs.sansMarge
      ? tr("Nets inconnus : tous les horaires sont proposés.")
      : m
        ? tr("Proposé : {cies}, meilleure marge ({adulte} par adulte{enfant}).", { cies, adulte: formatMontant(m.adulte, devise), enfant: m.enfant !== null ? tr(", {m} par enfant", { m: formatMontant(m.enfant, devise) }) : "" })
        : "";
    const autres = departs.autres.length
      ? h(
          "details",
          { class: "iti-autres" },
          h("summary", null, pluriel(departs.autres.length, N_("{n} autre compagnie écartée"), N_("{n} autres compagnies écartées"))),
          h(
            "ul",
            null,
            departs.autres.map((a) => h("li", null, `${a.nom || tr("Sans prestataire")} · ${a.departs.map((c) => hm(c.trajet.depart)).join(", ")} · ${a.meilleure ? tr("marge {m} par adulte", { m: formatMontant(a.meilleure.adulte, devise) }) : tr("net inconnu")}`))
          )
        )
      : null;
    return h("li", { class: "iti-trajet" }, titre, ...notes.map((n) => h("p", { class: "demande-attention" }, n)), h("fieldset", { class: "iti-departs", "aria-label": tr("Horaire retenu") }, departs.retenus.map(option), aucun), interne ? h("p", { class: "iti-interne" }, interne) : null, autres);
  }

  // ---- 4. La réponse au client ------------------------------------------------------------------------------------------------------
  const sortie = h("textarea", { id: "iti-reponse", rows: 12, "aria-label": tr("Réponse au client") });
  const etatReponse = h("div", { class: "assistant-etat", role: "status", "aria-live": "polite" });
  function dessinerReponse() {
    blocReponse.hidden = false;
    blocCreer.hidden = !ecrit;
    const sel = h("select", { id: "iti-langue", onchange: (e) => (langue = e.target.value) }, h("option", { value: "fr" }, tr("Français")), h("option", { value: "en" }, tr("Anglais")));
    sel.value = langue;
    const bouton = h("button", { class: "principal assistant-bouton", type: "button", onclick: (e) => rediger(e.currentTarget) }, tr("Rédiger la réponse"));
    const copier = h("button", { class: "secondaire", type: "button", onclick: async () => {
      try {
        await navigator.clipboard.writeText(sortie.value);
        toast(tr("Réponse copiée."));
      } catch {
        sortie.select();
        toast(tr("Copie refusée par le navigateur : sélectionnez le texte et copiez-le."), true);
      }
    } }, tr("Copier"));
    blocReponse.replaceChildren(h("h3", { id: "iti-reponse-titre" }, tr("Réponse au client")), h("div", { class: "iti-langue" }, champ(tr("Langue de la réponse"), sel), bouton), etatReponse, sortie, h("div", { class: "actions gauche" }, copier));
    sortie.hidden = !sortie.value;
    copier.hidden = !sortie.value;
  }

  async function rediger(btn) {
    const props = propositions();
    if (props.some(({ leg }) => leg.incomplet)) {
      etatReponse.classList.add("erreur");
      etatReponse.textContent = tr("Choisissez d'abord le lieu de chaque hôtel.");
      return;
    }
    const faits = faitsReponse({ itineraire, propositions: props, devise, langue, compagnies: etat.db.partenaires.map((p) => p.nom) });
    if (!faits.trajets.length) {
      etatReponse.classList.add("erreur");
      etatReponse.textContent = tr("Aucun trajet à proposer : vérifiez les étapes.");
      return;
    }
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.textContent = tr("Rédaction…");
    etatReponse.classList.remove("erreur");
    etatReponse.textContent = "";
    try {
      const r = await etat.store.assistant({ usage: "repondre_itineraire", entite_id: etat.entiteId, faits });
      if (!r || r.erreur || !r.message) {
        etatReponse.classList.add("erreur");
        etatReponse.textContent = messageErreur(r && r.erreur);
        return;
      }
      sortie.value = r.message;
      const avert = (r.avertissements || []).map(texteAvertissement).filter(Boolean);
      dessinerReponse();
      etatReponse.replaceChildren(
        ...[
          h("p", null, tr("Brouillon de l'assistant : relisez-le avant de l'envoyer.")),
          avert.length ? h("ul", { class: "assistant-avertissements" }, avert.map((a) => h("li", null, a))) : null,
          r.manques && r.manques.length ? h("p", { class: "assistant-remarque" }, tr("À demander au client : {liste}", { liste: r.manques.join(", ") })) : null,
        ].filter(Boolean)
      );
    } catch {
      etatReponse.classList.add("erreur");
      etatReponse.textContent = messageErreur("");
    } finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.textContent = tr("Rédiger à nouveau");
    }
  }

  // ---- 5. Créer le dossier ----------------------------------------------------------------------------------------------------------
  async function creer() {
    erreur.textContent = "";
    const legs = trajetsEntreEtapes(etapes);
    choix = choixValables(choix, propositions());
    if (!Object.keys(choix).length) return (erreur.textContent = tr("Choisissez l'horaire d'au moins un trajet, celui que le client a retenu."));
    const prep = servicesDepuisChoix({ itineraire, legs, choix });
    fermer();
    (await import("./demande.mjs")).ouvrirDemande(null, { texte: zone.value, ...prep });
  }

  const corps = h(
    "div",
    { class: "modal-corps demande itineraire" },
    h("p", { class: "aide" }, tr("Pour un client qui donne ses hôtels et ses dates : l'assistant lit les étapes, situe les hôtels, les trajets et leurs prix viennent de la base.")),
    h("div", { class: "champ demande-message" }, h("label", { for: "itineraire-texte" }, tr("Message du client")), zone),
    h("div", { class: "assistant-lire" }, boutonLire, etatLecture),
    blocEtapes,
    blocTrajets,
    blocReponse,
    blocCreer
  );
  const fermer = modal(tr("Prix et horaires d'un itinéraire"), corps, { large: true, protege: false });
  chargerHotelsLieux();
  if (zone.value.trim()) lire();
}
