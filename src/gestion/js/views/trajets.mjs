// Trajets : le chercheur de liaisons (départ, arrivée, date, compagnie), les horaires, prix, nets et périodes.
import { etat, peut, naviguer, nomPartenaire, partenaireDe, netTrajet, inserer, modifier, supprimer, enregistrerLie } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, icone, num } from "../ui.mjs";
import { filtrerTrajets, lieux, meilleursNets, resumeParCompagnie, periodeSpecifique, PERIODE_TOUTE, lireFenetres, utilisations, proposable } from "../partenaires-calc.mjs";
import { vide, cartes } from "./commun.mjs";
import { prix, margeNoeud, voitNets } from "./partenaires.mjs";
import { tr, pluriel, N_ } from "../i18n.mjs";
import { lireArrivee, arriveeTexte } from "../brochure-calc.mjs";

export function vueTrajets() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const places = lieux(etat.db.trajets);
  const compagnies = [...new Set(etat.db.trajets.map((t) => t.partenaire_id))].map((id) => ({ id, nom: nomPartenaire(id) || tr("Sans compagnie") })).sort((a, b) => a.nom.localeCompare(b.nom));
  const nets = voitNets();
  const netDe = (t) => { const n = netTrajet(t); return n ? n.net_adulte : null; };
  const sel = (id, libelle, vide_, options, valeur) => { const s = h("select", { id, onchange: () => dessiner() }, h("option", { value: "" }, vide_), options); s.value = valeur || ""; return s; };
  const de = sel("t-de", tr("Départ"), tr("Tous les départs"), places.map((x) => h("option", { value: x }, x)), params.get("de"));
  const vers = sel("t-vers", tr("Arrivée"), tr("Toutes les arrivées"), places.map((x) => h("option", { value: x }, x)), params.get("vers"));
  const cie = sel("t-cie", tr("Compagnie"), tr("Toutes les compagnies"), compagnies.map((c) => h("option", { value: c.id }, c.nom)), params.get("partenaire"));
  const date = h("input", { id: "t-date", type: "date", value: params.get("date") || "", onchange: () => dessiner() });
  const q = h("input", { id: "t-q", type: "search", value: params.get("q") || "", placeholder: tr("Horaire, île, type de bateau"), oninput: () => dessiner() });
  // Les trajets masqués (ou d'un partenaire masqué) se retrouvent en gris avec la case, pour les modifier ou les réactiver (audit n° 6).
  const masque = (t) => !proposable(t, etat.db.partenaires);
  const nbMasques = etat.db.trajets.filter(masque).length;
  const masques = h("input", { id: "t-masques", type: "checkbox", checked: params.get("masques") === "1", onchange: () => dessiner() });
  const caseMasques = nbMasques ? h("label", { class: "case", for: "t-masques" }, masques, pluriel(nbMasques, N_("Afficher le trajet masqué ({n})"), N_("Afficher les trajets masqués ({n})"))) : null;
  const resume = h("div", { class: "resume-cies" });
  const corps = h("div");
  const rafraichir = () => naviguer(location.hash);

  function dessiner() {
    const p = new URLSearchParams();
    for (const [k, v] of [["de", de.value], ["vers", vers.value], ["partenaire", cie.value], ["date", date.value], ["q", q.value], ["masques", masques.checked ? "1" : ""]]) if (v) p.set(k, v);
    history.replaceState(null, "", `#/trajets${p.toString() ? `?${p}` : ""}`);
    const lignes = filtrerTrajets(etat.db.trajets, { de: de.value, vers: vers.value, partenaireId: cie.value, date: date.value, q: q.value, nomPartenaire, partenaires: etat.db.partenaires, avecInactifs: masques.checked });
    const actifs = lignes.filter((t) => !masque(t));
    resume.replaceChildren();
    corps.replaceChildren();
    if (de.value && vers.value) {
      const r = resumeParCompagnie(actifs, netDe);
      resume.append(
        ...compagnies
          .filter((c) => !cie.value || c.id === cie.value)
          .map((c) => {
            const x = r.find((y) => y.partenaire_id === c.id);
            return h("div", { class: "chiffre carte-cie" }, h("p", { class: "chiffre-libelle" }, c.nom), x ? [h("p", { class: "chiffre-valeur" }, pluriel(x.departs, N_("départ"), N_("départs"))), h("p", { class: "chiffre-detail" }, x.heures.join(", ")), h("p", { class: "chiffre-detail" }, tr("Adulte dès {prix}", { prix: prix(x.vente) }), nets && x.net !== null ? h("span", { class: "net" }, tr(" · net {prix}", { prix: prix(x.net) })) : null)] : h("p", { class: "chiffre-detail" }, date.value ? tr("Aucun départ à cette date.") : tr("Aucun départ sur ce trajet.")));
          })
      );
    }
    if (!lignes.length) {
      const caches = masques.checked ? 0 : filtrerTrajets(etat.db.trajets, { de: de.value, vers: vers.value, partenaireId: cie.value, date: date.value, q: q.value, nomPartenaire, avecInactifs: true }).filter(masque).length;
      corps.append(caches ? vide(pluriel(caches, N_("{n} trajet masqué correspond"), N_("{n} trajets masqués correspondent")), tr("Cochez « Afficher les trajets masqués » pour les voir et les réactiver.")) : vide(tr("Aucun départ ne correspond"), etat.db.trajets.length ? tr("Essayez sans date, avec toutes les compagnies ou dans l'autre sens.") : tr("Les trajets des compagnies s'importent depuis Réglages, Sauvegarde, ou se créent ici.")));
      return;
    }
    const meilleurs = de.value && vers.value && nets ? meilleursNets(actifs, netDe) : new Set();
    const tagMasque = (t) => (masque(t) ? h("span", { class: "tag" }, t.actif === false ? tr("masqué") : tr("partenaire masqué")) : null);
    const detail = (t) => [t.mode ? `${t.mode}. ` : "", t.bebe ? `Bébé : ${t.bebe}. ` : "", t.numero ? `Ligne n°${t.numero}. ` : "", periodeSpecifique(t.periode) ? `Période : ${t.periode}.` : ""].join("").trim();
    const modif = (t) => (peut("partenaires.ecrire") ? h("button", { class: "secondaire petit", type: "button", onclick: () => ouvrirTrajet(t, rafraichir) }, tr("Modifier")) : null);
    const cieNom = (t) => h("span", { class: "tag cie" }, nomPartenaire(t.partenaire_id).split(" ")[0]);
    corps.append(
      h("p", { class: "aide", "aria-live": "polite" }, pluriel(actifs.length, N_("{n} départ."), N_("{n} départs.")), lignes.length > actifs.length ? [" ", pluriel(lignes.length - actifs.length, N_("{n} masqué, en gris."), N_("{n} masqués, en gris."))] : null),
      cartes(lignes, (t) => {
        const n = netTrajet(t);
        return h(
          "div",
          { class: masque(t) ? "carte-lien statique inactif" : "carte-lien statique" },
          h("span", { class: "carte-titre" }, t.de, " ", icone("fleche", 14), " ", t.vers, tagMasque(t)),
          h("span", { class: "carte-droite" }, h("strong", null, prix(t.prix_adulte)), nets ? h("span", { class: "net" }, n && n.net_adulte != null ? tr("net {prix}", { prix: prix(n.net_adulte) }) : tr("net n/d")) : h("span", null, t.prix_enfant != null ? tr("enfant {prix}", { prix: prix(t.prix_enfant) }) : "")),
          h("span", { class: "carte-sous" }, `${t.depart} → ${t.arrivee}${t.duree ? ` · ${t.duree}` : ""}${t.mode ? ` · ${t.mode}` : ""}`),
          h("span", { class: "carte-pied" }, h("span", null, cieNom(t), meilleurs.has(t.id) ? h("span", { class: "tag meilleur" }, tr("meilleur net")) : null, t.fenetres && t.fenetres.length ? h("span", { class: "tag" }, t.periode) : null), modif(t))
        );
      }),
      h(
        "table",
        { class: "tableau seulement-bureau trajets" },
        h("thead", null, h("tr", null, [N_("Compagnie"), N_("Trajet"), N_("Départ"), N_("Arrivée"), N_("Durée"), N_("Adulte"), nets ? N_("Net") : null, nets ? N_("Marge") : null, N_("Enfant"), nets ? N_("Net enfant") : null, N_("Période"), ""].filter((x) => x !== null).map((x) => h("th", { scope: "col", class: ["Adulte", "Net", "Marge", "Enfant", "Net enfant"].includes(x) ? "num" : null }, x ? tr(x) : x)))),
        h(
          "tbody",
          null,
          lignes.map((t) => {
            const n = netTrajet(t);
            return h(
              "tr",
              { class: masque(t) ? "inactif" : null },
              h("td", null, h("a", { href: `#/partenaire/${t.partenaire_id}` }, nomPartenaire(t.partenaire_id))),
              h("td", null, h("strong", null, t.de), " ", icone("fleche", 14), " ", h("strong", null, t.vers), tagMasque(t), detail(t) ? h("span", { class: "sous-ligne" }, detail(t)) : null),
              h("td", { class: "num" }, t.depart),
              h("td", { class: "num sec" }, t.arrivee),
              h("td", { class: "sec" }, t.duree),
              h("td", { class: "num" }, prix(t.prix_adulte)),
              nets ? h("td", { class: "num net" }, n && n.net_adulte != null ? prix(n.net_adulte) : "n/d", meilleurs.has(t.id) ? h("span", { class: "tag meilleur" }, tr("meilleur net")) : null) : null,
              nets ? h("td", { class: "num" }, margeNoeud(t.prix_adulte, n && n.net_adulte)) : null,
              h("td", { class: "num" }, prix(t.prix_enfant)),
              nets ? h("td", { class: "num net" }, n && n.net_enfant != null ? prix(n.net_enfant) : "n/d") : null,
              h("td", { class: "sec" }, t.periode || tr("Toute la période")),
              h("td", { class: "action-cellule" }, modif(t))
            );
          })
        )
      )
    );
  }
  const inverser = h("button", { class: "bouton-icone secondaire", type: "button", "aria-label": tr("Inverser départ et arrivée"), title: tr("Inverser"), onclick: () => { const a = de.value; de.value = vers.value; vers.value = a; dessiner(); } }, icone("inverser"));
  dessiner();
  const regles = etat.db.partenaires.filter((p) => etat.db.trajets.some((t) => t.partenaire_id === p.id) && p.regles && (p.regles.checkin || p.regles.annulation));
  return h(
    "div",
    { "data-titre": tr("Trajets"), "data-large": true },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Trajets en bateau")), h("p", { class: "sous" }, tr("{n} départs. Choisissez un départ et une arrivée pour comparer les compagnies.", { n: etat.db.trajets.filter((t) => !masque(t)).length }))), peut("partenaires.ecrire") ? h("button", { class: "principal", type: "button", onclick: () => ouvrirTrajet({ partenaire_id: cie.value || null }, rafraichir) }, tr("Nouveau trajet")) : null),
    h("div", { class: "barre-outils chercheur" }, h("div", { class: "champ" }, h("label", { for: "t-de" }, tr("Départ")), de), h("div", { class: "champ inverser" }, inverser), h("div", { class: "champ" }, h("label", { for: "t-vers" }, tr("Arrivée")), vers), h(
      "details",
      { class: "filtres-plus", open: window.matchMedia("(min-width: 720px)").matches || !!(params.get("partenaire") || params.get("date") || params.get("q") || params.get("masques")) },
      h("summary", null, tr("Compagnie, date, recherche"), icone("chevron", 18)),
      h("div", { class: "chercheur-plus" }, h("div", { class: "champ" }, h("label", { for: "t-cie" }, tr("Compagnie")), cie), h("div", { class: "champ" }, h("label", { for: "t-date" }, tr("Date du voyage")), date), h("div", { class: "champ recherche" }, h("label", { for: "t-q" }, tr("Recherche")), q), caseMasques)
    )
  ),
    resume,
    corps,
    regles.length
      ? h("section", { class: "regles-trajets" }, h("h2", null, tr("À savoir")), h("div", { class: "grille-regles" }, regles.map((p) => h("div", { class: "carte-regle" }, h("h3", null, p.nom), p.regles.checkin ? h("p", null, h("strong", null, tr("Check-in ")), p.regles.checkin.join(" ")) : null, p.regles.annulation ? h("p", null, h("strong", null, tr("Annulation ")), p.regles.annulation) : null))), h("p", { class: "aide" }, h("a", { href: "#/regles" }, tr("Toutes les règles"))))
      : null
  );
}

// Ouvre un trajet dans une fenêtre ; `apres` rafraîchit l'écran.
function ouvrirTrajet(t, apres, options = {}) {
  const fermer = modal(t.id ? tr("Modifier le trajet") : options.copie ? tr("Copie du trajet") : tr("Nouveau trajet"), formulaireTrajet(t, () => (fermer(), apres()), { ...options, rouvrir: (y, o) => (fermer(), apres(), ouvrirTrajet(y, apres, o)) }), { large: true });
}

// Fenêtres de circulation : deux champs date par ligne (audit n° 47 : une ligne de texte mal tapée était ignorée sans message).
function lignesFenetres(depart) {
  const zone = h("div", { class: "lignes-saisie" });
  const lignes = [];
  const ajouter = (f = [], focus = false) => {
    const k = Math.random().toString(36).slice(2, 8);
    const du = h("input", { id: `fen-du-${k}`, type: "date", value: f[0] || "", "aria-label": tr("Du") });
    const au = h("input", { id: `fen-au-${k}`, type: "date", value: f[1] || "", "aria-label": tr("Au") });
    const l = { valeur: () => [du.value, au.value] };
    l.noeud = h("div", { class: "ligne-saisie fenetre" }, du, au, h("button", { class: "bouton-icone secondaire", type: "button", "aria-label": tr("Retirer cette fenêtre"), title: tr("Retirer"), onclick: () => { lignes.splice(lignes.indexOf(l), 1); l.noeud.remove(); } }, icone("fermer")));
    lignes.push(l);
    zone.append(l.noeud);
    if (focus) du.focus();
  };
  depart.forEach((f) => ajouter(f));
  return { noeud: h("div", null, zone, h("button", { class: "secondaire petit", type: "button", onclick: () => ajouter([], true) }, tr("Ajouter une fenêtre"))), valeurs: () => lignes.map((l) => l.valeur()) };
}

function formulaireTrajet(t, apres, options = {}) {
  const nets = voitNets();
  const n = t.id && nets ? netTrajet(t) : nets ? options.netsDepart || null : null;
  // Compagnie obligatoire, sans défaut (audit n° 60) ; une compagnie masquée reste dans la liste quand c'est la sienne (audit n° 17).
  const cie = h("select", { id: "f-cie" }, h("option", { value: "" }, tr("Choisir la compagnie")), etat.db.partenaires.filter((p) => p.actif !== false || p.id === t.partenaire_id).sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => h("option", { value: p.id }, p.actif === false ? tr("{nom} (masqué)", { nom: p.nom }) : p.nom)));
  cie.value = t.partenaire_id && partenaireDe(t.partenaire_id) ? t.partenaire_id : "";
  const de = h("input", { id: "f-de", value: t.de || "", required: true, list: "f-lieux" });
  const vers = h("input", { id: "f-vers", value: t.vers || "", required: true, list: "f-lieux" });
  const lieuxListe = h("datalist", { id: "f-lieux" }, lieux(etat.db.trajets).map((x) => h("option", { value: x })));
  const modes = h("datalist", { id: "f-modes" }, [...new Set(etat.db.trajets.map((x) => x.mode).filter(Boolean))].map((x) => h("option", { value: x })));
  const mode = h("input", { id: "f-mode", value: t.mode || "", list: "f-modes", placeholder: tr("Speedboat, ferry, minivan…") });
  // Un départ avec sa précision imprimée (« 07:00 (Malaysia time) », import de brochure) : l'heure dans le champ, la précision gardée et rappelée.
  const dep = /^(\d{2}:\d{2})\s*(.*)$/.exec(t.depart || "") || ["", t.depart || "", ""];
  const depart = h("input", { id: "f-dep", type: "time", value: dep[1] });
  const precisionDepart = dep[2].trim();
  const departSaisi = () => (depart.value ? [depart.value, precisionDepart].filter(Boolean).join(" ") : "");
  // Une arrivée du lendemain s'écrit « 06:00 (next day) » (import de brochure, 24.11.2026) : l'heure va dans le champ, le lendemain dans sa case.
  // Une arrivée écrite autrement (texte libre d'un ancien trajet) reste telle quelle tant que l'heure n'est pas changée.
  const arr = lireArrivee(t.arrivee);
  const arrivee = h("input", { id: "f-arr", type: "time", value: arr.heure });
  const lendemain = h("input", { id: "f-arr-lendemain", type: "checkbox", checked: arr.lendemain });
  // Le texte libre n'est gardé que tant que la personne n'a touché ni l'heure ni la case.
  let arriveeTouchee = false;
  for (const c of [arrivee, lendemain]) c.addEventListener("input", () => (arriveeTouchee = true));
  const arriveeSaisie = () => (arrivee.value ? arriveeTexte(arrivee.value, lendemain.checked) : arriveeTouchee ? "" : arr.autre);
  const duree = h("input", { id: "f-duree", value: t.duree || "", placeholder: "1 h 30" });
  const nombre = (id, v) => h("input", { id, type: "number", min: "0", step: "1", value: v ?? "", inputmode: "numeric" });
  const ad = nombre("f-ad", t.prix_adulte);
  const ch = nombre("f-ch", t.prix_enfant);
  // Décision 3 (lot D) : sans le droit « prix de vente », les prix du trajet ne se changent pas ; un trajet créé ou dupliqué naît sans prix.
  const prixFige = !peut("partenaires.prix");
  if (prixFige) for (const c of [ad, ch]) (c.readOnly = true), !t.id && (c.value = "");
  const adn = nombre("f-adn", n && n.net_adulte != null ? n.net_adulte : "");
  const chn = nombre("f-chn", n && n.net_enfant != null ? n.net_enfant : "");
  const bebe = h("input", { id: "f-bebe", value: t.bebe || "", placeholder: tr("Gratuit") });
  const periode = h("input", { id: "f-per", value: periodeSpecifique(t.periode), placeholder: tr("1 nov 2026 → 4 mai 2027") });
  const fenetres = lignesFenetres(t.fenetres || []);
  const actif = h("input", { id: "f-actif", type: "checkbox", checked: t.actif !== false });
  const erreur = h("p", { class: "erreur-form", role: "alert" });
  const ecrit = peut("partenaires.ecrire");
  const valeursSaisies = (fen) => ({ partenaire_id: cie.value, de: de.value.trim(), vers: vers.value.trim(), mode: mode.value.trim(), depart: departSaisi(), arrivee: arriveeSaisie(), duree: duree.value.trim(), prix_adulte: num(ad.value), prix_enfant: num(ch.value), bebe: bebe.value.trim(), periode: periode.value.trim() || (fen.length ? "" : PERIODE_TOUTE[1]), fenetres: fen, actif: actif.checked });
  const messageFenetre = (lu) => ({ incomplete: tr("Fenêtre n° {n} : indiquez la date de début et la date de fin, ou retirez la ligne.", { n: lu.ligne + 1 }), ordre: tr("Fenêtre n° {n} : la date de fin est avant la date de début.", { n: lu.ligne + 1 }), date: tr("Fenêtre n° {n} : date illisible.", { n: lu.ligne + 1 }) })[lu.erreur];
  // Enregistre le trajet ; rend le trajet enregistré, ou null (erreur dite à la personne).
  const enregistrer = async () => {
    erreur.textContent = "";
    if (!cie.value) return (erreur.textContent = tr("Choisissez la compagnie du trajet.")), cie.focus(), null;
    const lu = lireFenetres(fenetres.valeurs());
    if (lu.erreur) return (erreur.textContent = messageFenetre(lu)), null;
    try {
      const res = t.id ? await modifier("trajets", t.id, { ...valeursSaisies(lu.fenetres), ...(prixFige ? { prix_adulte: t.prix_adulte ?? null, prix_enfant: t.prix_enfant ?? null } : {}) }) : await inserer("trajets", { ...valeursSaisies(lu.fenetres), numero: Math.max(0, ...etat.db.trajets.map((x) => x.numero || 0)) + 1 });
      if (nets && ecrit && (adn.value !== "" || chn.value !== "" || (t.id && n))) await enregistrerLie("trajets_nets", "trajet_id", res.id, { net_adulte: num(adn.value), net_enfant: num(chn.value) });
      toast(tr("Trajet enregistré."));
      return res;
    } catch (err) {
      toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
      return null;
    }
  };
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        const res = await enregistrer();
        if (res) apres(res);
      },
    },
    champ(tr("Compagnie"), cie),
    h("div", { class: "grille-form" }, champ(tr("Départ"), [de, lieuxListe]), champ(tr("Arrivée"), vers), champ(tr("Type"), [mode, modes])),
    h("div", { class: "grille-form compacte" }, champ(tr("Heure de départ"), depart, precisionDepart ? tr("Heure imprimée : {precision}", { precision: precisionDepart }) : null), champ(tr("Heure d'arrivée"), [arrivee, h("label", { class: "case", for: lendemain.id }, lendemain, tr("Le lendemain"))]), champ(tr("Durée"), duree)),
    // Ce que la brochure imprimait pour ce trajet (import de brochure, migration 127) : lieux et heures tels qu'imprimés, en lecture seule.
    t.imprime ? h("p", { class: "aide" }, tr("Imprimé sur la brochure : « {texte} »", { texte: t.imprime })) : null,
    h("div", { class: "grille-form compacte" }, champ(tr("Prix adulte"), ad, prixFige ? tr("Réservé à qui a le droit « Modifier les prix de vente ».") : null), champ(tr("Prix enfant"), ch), nets ? champ(tr("Net adulte"), adn) : null, nets ? champ(tr("Net enfant"), chn) : null),
    h("div", { class: "grille-form" }, champ(tr("Bébé"), bebe), champ(tr("Période, en clair"), periode, tr("Vide : « toute la période du contrat » quand il n'y a pas de fenêtre."))),
    h("div", { class: "champ" }, h("p", { class: "etiquette" }, tr("Fenêtres de circulation")), fenetres.noeud, h("p", { class: "aide" }, tr("Du … au …, une ligne par période. Aucune fenêtre : le trajet circule toute l'année."))),
    h("label", { class: "case", for: "f-actif" }, actif, tr("Proposé pour les nouvelles saisies")),
    h("p", { class: "aide" }, tr("Décoché, le trajet est masqué. Les services déjà saisis, leurs factures et leurs vouchers ne changent pas.")),
    erreur,
    h(
      "div",
      { class: "actions" },
      t.id && peut("partenaires.supprimer") ? h("button", { class: "danger", type: "button", onclick: () => supprimerTrajet(t, apres) }, tr("Supprimer")) : null,
      // Dupliquer : le même trajet à une autre heure, sans tout retaper (audit n° 82). Les heures sont vidées, le reste est repris.
      t.id && ecrit && options.rouvrir
        ? h("button", { class: "secondaire", type: "button", onclick: async () => {
            // L'original est d'abord enregistré tel qu'il est à l'écran : rien de ce qu'on vient d'y taper ne se perd en ouvrant la copie.
            const copie = { ...valeursSaisies(lireFenetres(fenetres.valeurs()).fenetres), depart: "", arrivee: "" };
            const netsCopie = nets ? { net_adulte: num(adn.value), net_enfant: num(chn.value) } : null;
            if (await enregistrer()) options.rouvrir(copie, { copie: true, netsDepart: netsCopie });
          } }, tr("Dupliquer"))
        : null,
      h("button", { class: "principal", type: "submit" }, tr("Enregistrer"))
    )
  );
}

// Supprimer un trajet : refusé s'il est utilisé (on propose de le masquer), sinon une confirmation qui le dit (audit n° 15).
async function supprimerTrajet(t, apres) {
  const n = utilisations({ trajet: t }, etat.db);
  if (n) {
    const masquer = await confirmer(pluriel(n, N_("Ce trajet est utilisé par {n} service. Le supprimer retirerait à ce service ses horaires et son billet. Masquez-le plutôt : il ne sera plus proposé et ce qui existe ne change pas."), N_("Ce trajet est utilisé par {n} services. Le supprimer retirerait à ces services leurs horaires et leur billet. Masquez-le plutôt : il ne sera plus proposé et ce qui existe ne change pas.")), t.actif === false ? tr("Fermer") : tr("Masquer le trajet"));
    if (!masquer || t.actif === false) return;
    try {
      await modifier("trajets", t.id, { actif: false });
      toast(tr("Trajet masqué."));
      apres(null);
    } catch (err) {
      toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
    }
    return;
  }
  if (!(await confirmer(tr("Supprimer définitivement le trajet {de} → {vers} de {depart} et ses prix nets ? Aucun service ne l'utilise. Cette suppression ne peut pas être annulée.", { de: t.de, vers: t.vers, depart: t.depart || "—" }), tr("Supprimer définitivement"), true))) return;
  try {
    await supprimer("trajets", t.id);
    toast(tr("Trajet supprimé."));
    apres(null);
  } catch (err) {
    toast(tr("Suppression impossible : {message}", { message: err.message }), true);
  }
}
