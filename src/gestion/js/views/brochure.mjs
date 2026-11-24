// « Importer une brochure » (20.11.2026, refait le 24.11.2026), depuis la fiche d'un partenaire ou une carte de l'onglet Assistant : la personne
// envoie la photo, la capture ou le PDF de la brochure, l'assistant en tire les tarifs, les horaires et les trajets, puis relit sa propre lecture
// (seconde passe). L'écran montre chaque ligne à côté du catalogue du partenaire (nouveau, prix changé, inchangé, illisible), avec le texte
// imprimé, le nom de lieu retenu (modifiable) et ce qui demande un regard. Une ligne illisible se complète ici. Rien ne s'écrit avant le clic sur
// « Enregistrer », et seulement les lignes cochées, chacune en une transaction (migration 124).
// Réservé à qui peut modifier les prix de vente (l'administratrice l'a toujours) quand l'assistant est allumé. Les nets ne s'affichent et ne
// s'écrivent qu'avec le droit « prix nets », jamais en Taxi ; la base refuse aussi une ligne qui porte un net sans ce droit.
import { etat, peut, ecrireLigneBrochure, modeTaxi, modeExcursions, reglages } from "../etat.mjs";
import { h, champ, modal, toast } from "../ui.mjs";
import { formatMontant, aujourdhui } from "../calc.mjs";
import { libelleUnite } from "../partenaires-calc.mjs";
import { assistantActif } from "../assistant-calc.mjs";
import { modeTrajet } from "../operations-calc.mjs";
import { tr, N_, pluriel } from "../i18n.mjs";
import { DROITS_BROCHURE, comparerBrochure, changerCible, compter, planBrochure, ciblesPossibles, phraseAgeEnfant, memePartenaire, signauxLigne, completerLigne, fichePartenaireDepuisBrochure } from "../brochure-calc.mjs";
import { GROUPES } from "./partenaires.mjs";
import { messageErreur } from "./assistant-demande.mjs";
import { preparer, tailleTexte, erreurFichier, LIMITES } from "../pieces-jointes.mjs";

export const importBrochureDisponible = () => assistantActif(reglages()) && DROITS_BROCHURE.every((d) => peut(d));

const ERREURS = {
  fichiers_absents: N_("Choisissez d'abord la photo, la capture ou le PDF de la brochure."),
  trop_de_fichiers: N_("Six fichiers au plus par lecture."),
  fichier_type: N_("Ce type de fichier ne se lit pas : envoyez une photo, une capture ou un PDF."),
  fichier_illisible: N_("Un fichier n'a pas pu être ouvert : reprenez la photo ou exportez-la en JPEG."),
  fichier_trop_lourd: N_("Les fichiers dépassent 10 Mo : envoyez moins de pages, ou des captures à la place du PDF."),
  partenaire_invalide: N_("Ce partenaire n'appartient pas à l'entreprise ouverte."),
  invalide: N_("L'assistant n'a trouvé ni tarif ni horaire dans ces fichiers."),
  coupe: N_("La brochure est trop longue pour une seule lecture : envoyez-la en deux fois."),
  trop_long: N_("La lecture a pris trop de temps : envoyez la brochure en deux fois (quelques pages chaque fois)."),
  extraction_invalide: N_("La première lecture n'a pas pu être relue : relancez la lecture."),
  migration_124_manquante: N_("L'enregistrement attend la migration 124 de la base : demandez à l'administratrice de l'appliquer."),
};
const erreurTexte = (code) => (ERREURS[code] ? tr(ERREURS[code]) : erreurFichier(code) || messageErreur(code));

const AVERTISSEMENTS = {
  prix_non_imprime: N_("« {nom} » : le prix rendu ne figure pas dans les chiffres relevés, il est à saisir."),
  net_retire: N_("« {nom} » : un net absent des chiffres relevés a été retiré. Un net n'est jamais déduit."),
  net_superieur: N_("« {nom} » : le net relevé dépasse le prix de vente. La ligne n'est pas cochée d'office."),
  ligne_sans_nom: N_("Une ligne sans nom de programme a été laissée de côté."),
  trajet_sans_lieux: N_("Un horaire sans lieu de départ ou d'arrivée a été laissé de côté."),
  trajet_vide: N_("Une ligne de trajet sans aucune valeur lisible a été laissée de côté."),
  brochure_coupee: N_("La brochure compte plus de lignes qu'une lecture n'en prend : envoyez la fin en une seconde fois."),
};
const texteAvertissement = (a) => {
  const i = a.indexOf(":");
  const code = i > 0 ? a.slice(0, i) : a;
  return AVERTISSEMENTS[code] ? tr(AVERTISSEMENTS[code], { nom: i > 0 ? a.slice(i + 1) : "" }) : "";
};

const STATUTS = { nouveau: N_("Nouveau"), prix_change: N_("Prix changé"), inchange: N_("Inchangé"), illisible: N_("Illisible") };
const badge = (statut) => h("span", { class: `brochure-statut ${statut}` }, tr(STATUTS[statut]));
const prix = (n) => (n === null || n === undefined ? "—" : formatMontant(n));

// Les signaux d'une ligne, en mots courts. « net à saisir » ne se montre qu'à qui voit les nets.
const SIGNAUX = {
  net_a_saisir: N_("Net à saisir"),
  lieu_a_verifier: N_("Lieu à vérifier"),
  confiance_basse: N_("Lecture douteuse"),
  relecture_signale: N_("Signalé à la relecture"),
  net_superieur: N_("Net au-dessus du prix"),
};
const RELECTURE = { corrige: N_("Corrigé à la relecture"), ajoute: N_("Ajouté à la relecture") };

// Le titre de la section des trajets suit leur mode : que des bateaux, « Horaires de bateau » ; sinon « Horaires et trajets ».
export const titreTrajets = (trajets) => (trajets.length && trajets.every((l) => modeTrajet(l.lu) === "bateau") ? N_("Horaires de bateau") : N_("Horaires et trajets"));

// ---- Écran --------------------------------------------------------------------------------------------------------------------------------

// `apres` rafraîchit la fiche du partenaire quand quelque chose a été enregistré, à la fermeture.
// Depuis une carte de l'onglet Assistant (`depuisAgent`) : les fichiers sont ceux joints à la conversation (identifiants de agent_fichiers),
// relus par la fonction ; la lecture part tout de suite. `p` peut être null : la brochure est celle d'un nouveau partenaire, que l'écran
// fait créer (formulaire habituel, prérempli de la fiche imprimée) avant d'enregistrer les lignes.
export function ouvrirImportBrochure(p, apres = () => {}, depuisAgent = null) {
  let ecrit = false;
  const fermer = modal(tr("Importer une brochure"), ecranBrochure(p, { aEcrit: () => (ecrit = true), fini: () => fermer(), depuisAgent }), { large: true, ferme: () => ecrit && apres() });
}

function ecranBrochure(p, { aEcrit, fini, depuisAgent = null }) {
  let partenaire = p;
  // Depuis l'Assistant, « fichiers absents » veut dire qu'ils ne sont plus gardés (30 jours) : le message le dit.
  const erreurLecture = (code) => (depuisAgent && erreurFichier(code)) || erreurTexte(code);
  const fichiers = [];
  const droitNets = peut("partenaires.nets") && !modeTaxi();
  const langue = modeExcursions() ? "en" : "fr";
  const etatLecture = h("p", { class: "assistant-etat", role: "status", "aria-live": "polite" });
  const liste = h("ul", { class: "brochure-fichiers" });
  const resultat = h("div", { class: "brochure-resultat" });
  const choix = h("input", { type: "file", id: "br-fichiers", accept: "image/*,application/pdf", multiple: true, class: "visuellement-cache" });
  const boutonChoisir = h("label", { class: "bouton secondaire", for: "br-fichiers" }, tr("Choisir les fichiers"));
  const boutonLire = h("button", { class: "principal", type: "button", disabled: true, onclick: () => lire() }, tr("Lire la brochure"));

  const dessinerFichiers = () => {
    liste.replaceChildren(
      ...fichiers.map((f, i) =>
        h(
          "li",
          { class: "brochure-fichier" },
          f.apercu ? h("img", { src: f.apercu, alt: "", width: 56, height: 56 }) : h("span", { class: "brochure-pdf", "aria-hidden": "true" }, "PDF"),
          h("span", { class: "brochure-fichier-nom" }, f.fichier.name || tr("Photo"), h("span", { class: "sous-ligne" }, tailleTexte(f.fichier.size))),
          h("button", { class: "lien", type: "button", "aria-label": tr("Retirer {nom}", { nom: f.fichier.name || tr("Photo") }), onclick: () => (f.apercu && URL.revokeObjectURL(f.apercu), fichiers.splice(i, 1), dessinerFichiers()) }, tr("Retirer"))
        )
      )
    );
    boutonLire.disabled = !fichiers.length;
  };
  choix.addEventListener("change", () => {
    let laisses = 0;
    for (const f of choix.files) {
      if (fichiers.length >= LIMITES.fichiers) laisses++;
      else fichiers.push({ fichier: f, apercu: f.type.startsWith("image/") ? URL.createObjectURL(f) : "" });
    }
    etatLecture.classList.remove("erreur");
    etatLecture.textContent = laisses ? tr(ERREURS.trop_de_fichiers) : "";
    choix.value = "";
    dessinerFichiers();
  });

  // Deux appels : la lecture, puis la relecture de contrôle avec la première extraction. Une relecture qui échoue laisse la première lecture,
  // et l'écran le dit.
  async function lire() {
    etatLecture.classList.remove("erreur");
    resultat.replaceChildren();
    boutonLire.disabled = true;
    boutonLire.setAttribute("aria-busy", "true");
    boutonLire.textContent = tr("Lecture…");
    etatLecture.textContent = tr("Préparation des fichiers…");
    try {
      let corps;
      if (depuisAgent) corps = { fichiers_agent: depuisAgent.fichiers.map((f) => f.id), ...(partenaire ? { partenaire_id: partenaire.id } : { nouveau_partenaire: true }) };
      else {
        try {
          corps = { partenaire_id: partenaire.id, fichiers: await Promise.all(fichiers.map((f) => preparer(f.fichier))) };
        } catch (err) {
          throw Object.assign(new Error(err.message), { code: err.message });
        }
      }
      etatLecture.textContent = tr("Lecture de la brochure (1 sur 2). Comptez une à deux minutes.");
      const r = await etat.store.assistant({ usage: "brochure", entite_id: etat.entiteId, passe: "lecture", ...corps });
      if (!r || r.erreur || !r.brochure) {
        etatLecture.classList.add("erreur");
        etatLecture.textContent = erreurLecture(r && r.erreur);
        return;
      }
      etatLecture.textContent = tr("Relecture de contrôle (2 sur 2) : l'assistant relit chaque ligne face à l'image.");
      let finale = r;
      let relue = null;
      try {
        const r2 = await etat.store.assistant({ usage: "brochure", entite_id: etat.entiteId, passe: "relecture", extraction: r.brochure, ...corps });
        if (r2 && !r2.erreur && r2.brochure) {
          finale = { ...r2, avertissements: [...new Set([...(r.avertissements || []), ...(r2.avertissements || [])])] };
          relue = r2.relecture || { corriges: 0, signales: 0, ajoutes: 0 };
        } else relue = { erreur: erreurLecture(r2 && r2.erreur) };
      } catch (err) {
        relue = { erreur: erreurLecture(err && err.code) };
      }
      etatLecture.textContent = "";
      afficher({ ...finale, relue });
    } catch (err) {
      etatLecture.classList.add("erreur");
      etatLecture.textContent = erreurLecture(err && err.code);
    } finally {
      boutonLire.disabled = !fichiers.length && !depuisAgent;
      boutonLire.removeAttribute("aria-busy");
      boutonLire.textContent = tr("Relire la brochure");
    }
  }

  // `echecs` : après un enregistrement en partie refusé, ce qui n'est pas passé. Les lignes sont recomparées au catalogue mis à jour : ce qui a été
  // créé devient « inchangé », rien ne peut être créé deux fois. Ce que la personne a saisi dans une ligne est gardé (`saisies`).
  const saisies = new Map();
  function afficher(r, { faits = 0, echecs = [] } = {}) {
    const b = r.brochure;
    const partenaireId = partenaire ? partenaire.id : null;
    const comp = comparerBrochure(b, { partenaireId, prestations: etat.db.prestations, trajets: etat.db.trajets });
    const ctx = () => ({ partenaireId, prestations: etat.db.prestations, trajets: etat.db.trajets });
    // Les saisies d'avant (échec partiel, partenaire créé entre-temps) sont reportées sur les lignes recomparées.
    for (const groupe of [comp.tarifs, comp.trajets])
      groupe.forEach((l, i) => {
        const s = saisies.get(l.cle);
        if (s) groupe[i] = completerLigne(l, s, { ...ctx(), pris: prisPar(groupe, l) });
      });
    const lignes = () => [...comp.tarifs, ...comp.trajets];
    const cibles = ciblesPossibles(partenaireId, etat.db.prestations).sort((a, c) => a.libelle.localeCompare(c.libelle));
    const erreur = h("div", { class: "erreur-form", role: "alert" });
    const enregistrer = h("button", { class: "principal", type: "button", onclick: () => ecrire() });
    const plan = () =>
      planBrochure(lignes(), {
        partenaireId,
        prestations: etat.db.prestations,
        prestationsNets: droitNets ? etat.db.prestations_nets : [],
        trajetsNets: droitNets ? etat.db.trajets_nets : [],
        droitNets,
        langue,
        aujourdhui: aujourdhui(),
        ordreMax: Math.max(0, ...etat.db.prestations.map((x) => x.ordre || 0)),
        numeroMax: Math.max(0, ...etat.db.trajets.map((x) => x.numero || 0)),
      });
    const majBouton = () => {
      // Nouveau partenaire : les lignes s'enregistrent une fois le partenaire créé.
      if (!partenaire) {
        enregistrer.disabled = true;
        enregistrer.textContent = tr("Créez d'abord le partenaire");
        return;
      }
      const n = plan().length;
      enregistrer.disabled = !n;
      enregistrer.textContent = n ? pluriel(n, N_("Enregistrer {n} ligne"), N_("Enregistrer {n} lignes")) : tr("Rien à enregistrer");
    };

    // Les tarifs ou trajets du catalogue déjà visés par les autres lignes : deux lignes ne modifient jamais le même.
    function prisPar(groupe, l) {
      return new Set(groupe.filter((x) => x !== l && x.cible).map((x) => x.cible.id));
    }
    const groupeDe = (l) => (l.genre === "trajet" ? comp.trajets : comp.tarifs);
    // Une saisie dans une ligne : la ligne est complétée, recomparée et redessinée seule (le reste de l'écran ne bouge pas).
    const appliquer = (l, saisie) => {
      saisies.set(l.cle, { ...(saisies.get(l.cle) || {}), ...saisie });
      const groupe = groupeDe(l);
      const i = groupe.indexOf(l);
      const neuve = completerLigne(l, saisie, { ...ctx(), pris: prisPar(groupe, l) });
      groupe[i] = neuve;
      noeuds.get(l.cle).replaceWith(dessinerLigne(neuve));
      majResume();
      majBouton();
    };

    // Une ligne de la brochure : sa case, son statut, ses prix face au catalogue, ce qui a été lu et ce qui reste à regarder.
    const noeuds = new Map();
    const dessinerLigne = (l) => {
      const id = `br-${l.cle}`;
      const lu = l.lu;
      const ecart = (champ) => l.ecarts.find((e) => e.champ === champ);
      const montant = (champ, valeur) => {
        const e = ecart(champ);
        return e ? h("span", { class: "brochure-ecart" }, h("del", null, prix(e.avant)), " → ", h("ins", null, prix(e.apres))) : h("span", null, prix(valeur));
      };
      const unite = libelleUnite(lu.unite || (l.cible && l.cible.unite) || "");
      const prixLigne = lu.sur_demande
        ? h("p", { class: "brochure-prix" }, tr("Prix sur demande : le tarif reste « prix à saisir »."))
        : h(
            "p",
            { class: "brochure-prix" },
            h("span", null, l.genre === "trajet" ? tr("Adulte") : tr("Prix"), " ", montant("prix_adulte", lu.prix_adulte)),
            lu.prix_enfant !== null || ecart("prix_enfant") ? h("span", null, tr("Enfant"), " ", montant("prix_enfant", lu.prix_enfant), lu.age_enfant ? ` (${lu.age_enfant})` : "") : null,
            unite ? h("span", { class: "sous-ligne" }, unite) : null,
            droitNets && (lu.net_adulte !== null || lu.net_enfant !== null)
              ? h("span", { class: "brochure-net" }, lu.net_source === "manuscrit" ? tr("Net (écrit à la main)") : lu.net_source === "saisi" ? tr("Net (saisi)") : tr("Net"), " ", prix(lu.net_adulte), lu.net_enfant !== null ? ` / ${prix(lu.net_enfant)}` : "")
              : null
          );
      const coche = h("input", {
        type: "checkbox",
        id,
        checked: l.coche,
        disabled: l.statut === "illisible",
        onchange: () => {
          l.coche = coche.checked;
          majBouton();
        },
      });
      const arrivee = lu.arrivee ? (lu.lendemain ? tr("arrivée {heure} le lendemain", { heure: lu.arrivee }) : tr("arrivée {heure}", { heure: lu.arrivee })) : "";
      const titre =
        l.genre === "trajet"
          ? h("strong", null, `${lu.de || "?"} → ${lu.vers || "?"}, ${lu.depart || "—"}`, arrivee ? ` (${arrivee}${lu.duree ? `, ${lu.duree}` : ""})` : "")
          : !l.cible && l.statut !== "illisible"
            ? h("input", { class: "brochure-libelle", value: l.libelle, "aria-label": tr("Libellé de la nouvelle prestation"), oninput: (e) => (l.libelle = e.target.value) })
            : h("strong", null, l.cible ? l.cible.libelle : lu.libelle);
      const signaux = signauxLigne(l).filter((s) => s !== "net_a_saisir" || droitNets);
      const marques = [
        ...signaux.map((s) => h("span", { class: `brochure-signal ${s}` }, tr(SIGNAUX[s]))),
        RELECTURE[lu.relecture] ? h("span", { class: "brochure-signal relecture" }, tr(RELECTURE[lu.relecture])) : null,
        lu.prix_repris ? h("span", { class: "brochure-signal info" }, tr("Prix de la case fusionnée")) : null,
        lu.coupee ? h("span", { class: "brochure-signal info" }, tr("Ligne coupée par la photo")) : null,
      ].filter(Boolean);
      const selecteur =
        l.genre === "prestation" && l.statut !== "illisible"
          ? (() => {
              const prises = prisPar(comp.tarifs, l);
              const s = h("select", { id: `${id}-cible` }, h("option", { value: "" }, tr("Nouvelle prestation")), cibles.filter((c) => !prises.has(c.id)).map((c) => h("option", { value: c.id }, c.actif === false ? tr("{nom} (masqué)", { nom: c.libelle }) : c.libelle)));
              s.value = l.cible ? l.cible.id : "";
              s.addEventListener("change", () => {
                const neuve = changerCible(l, cibles.find((c) => c.id === s.value) || null, etat.db.prestations);
                Object.assign(l, neuve);
                // Les autres sélecteurs perdent ou retrouvent ce tarif : toutes les lignes de tarif sont redessinées.
                for (const x of comp.tarifs) noeuds.get(x.cle).replaceWith(dessinerLigne(x));
                majBouton();
              });
              return champ(tr("Dans le catalogue"), s);
            })()
          : null;
      // Les lieux d'un trajet : le nom retenu, modifiable, avec le texte imprimé à côté.
      const lieux =
        l.genre === "trajet"
          ? h(
              "div",
              { class: "brochure-lieux" },
              ["de", "vers"].map((k) => {
                const n = (l.lieux && l.lieux[k]) || { nom: lu[k], imprime: "" };
                const champLieu = h("input", { id: `${id}-${k}`, value: lu[k] || "", autocomplete: "off", onchange: (e) => appliquer(l, { [k]: e.target.value }) });
                const aide = [n.imprime && n.imprime !== lu[k] ? tr("Imprimé : « {texte} »", { texte: n.imprime }) : "", n.a_verifier ? tr("Nom incertain : vérifiez-le.") : ""].filter(Boolean).join(" ");
                return champ(k === "de" ? tr("Départ") : tr("Arrivée"), champLieu, aide || null);
              })
            )
          : null;
      const notes = [
        l.confiance === "probable" ? h("p", { class: "brochure-note" }, tr("Rapproché de « {libelle} » par les mots du nom : vérifiez que c'est le même programme avant de cocher.", { libelle: l.cible.libelle })) : null,
        l.proche ? h("p", { class: "brochure-note" }, tr("Proche de « {libelle} » : choisissez-le ci-dessous si c'est le même programme.", { libelle: l.proche.libelle })) : null,
        ...l.infos.map((x) =>
          h(
            "p",
            { class: "brochure-note" },
            x.champ === "prix_enfant"
              ? tr("Prix enfant imprimé {prix} : ce tarif n'a pas de prix enfant (unité « {unite} »), il n'est pas repris.", { prix: prix(x.apres), unite: libelleUnite(l.cible.unite) })
              : tr("Unité imprimée « {apres} », au catalogue « {avant} » : l'unité ne change pas ici.", { apres: libelleUnite(x.apres), avant: libelleUnite(x.avant) })
          )
        ),
        lu.relecture_raison ? h("p", { class: "brochure-note" }, lu.relecture_raison) : null,
        lu.raison && lu.raison !== lu.relecture_raison ? h("p", { class: "brochure-note" }, lu.raison) : null,
        signaux.includes("net_a_saisir") && l.statut !== "illisible" ? h("p", { class: "brochure-note" }, lu.net_cache ? tr("Net caché sur la brochure : la ligne s'enregistre sans net, à saisir ensuite.") : tr("Pas de net lisible sur cette ligne : elle s'enregistre sans net.")) : null,
        l.statut === "illisible" ? h("p", { class: "brochure-illisible" }, lu.illisible || tr("Ligne illisible."), " ", tr("Complétez-la ci-dessous pour l'enregistrer.")) : null,
      ];
      const imprime = lu.imprime || lu.prix_texte ? h("p", { class: "brochure-imprime" }, tr("Imprimé : « {texte} »", { texte: lu.imprime || lu.prix_texte })) : null;
      const lus =
        l.genre === "prestation"
          ? [[N_("Horaires"), lu.horaires], [N_("Durée"), lu.duree], [N_("Capacité"), lu.capacite], [N_("Bateau"), lu.bateau], [N_("Programme"), lu.programme], [N_("Inclus"), lu.inclus], [N_("Frais de parc"), lu.parc], [N_("Conditions"), [lu.conditions, lu.prix_enfant !== null ? phraseAgeEnfant(lu.age_enfant, langue) : ""].filter(Boolean).join("\n")]]
          : [[N_("Type"), lu.mode], [N_("Durée"), lu.duree], [N_("Période"), lu.periode], [N_("Note"), lu.note]];
      const detail = lus.some(([, v]) => v)
        ? h("details", { class: "detail-prestation" }, h("summary", null, tr("Ce que dit la brochure")), lus.filter(([, v]) => v).map(([k, v]) => h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, tr(k)), h("span", { class: "brochure-texte" }, v))))
        : null;
      const noeud = h(
        "li",
        { class: `brochure-ligne ${l.statut}` },
        h("div", { class: "brochure-tete" }, h("label", { class: "case brochure-case", for: id }, coche, h("span", { class: "visuellement-cache" }, tr("Garder cette ligne"))), badge(l.statut), titre),
        h("div", { class: "brochure-corps" }, marques.length ? h("p", { class: "brochure-signaux" }, marques) : null, prixLigne, imprime, ...notes, lieux, selecteur, completer(l), detail)
      );
      noeuds.set(l.cle, noeud);
      return noeud;
    };

    // Corriger ou compléter une ligne à la main : prix de vente, prix enfant, net (avec le droit), heures d'un trajet. Ouvert d'office sur une
    // ligne illisible, qui s'enregistre dès que son prix et son trajet sont là.
    const completer = (l) => {
      const id = `br-${l.cle}-c`;
      const lu = l.lu;
      const texteDe = (v) => (v === null || v === undefined ? "" : String(v));
      const nombre = (k, libelle, valeur) => champ(libelle, h("input", { id: `${id}-${k}`, inputmode: "decimal", value: texteDe(valeur), "data-cle": k, "data-lu": texteDe(valeur) }));
      const heure = (k, libelle) => champ(libelle, h("input", { id: `${id}-${k}`, type: "time", value: lu[k] || "", "data-cle": k, "data-lu": lu[k] || "" }));
      const lendemain = h("input", { id: `${id}-lendemain`, type: "checkbox", checked: !!lu.lendemain });
      const champs = [
        nombre("prix_adulte", l.genre === "trajet" ? tr("Prix adulte") : tr("Prix de vente"), lu.prix_adulte),
        nombre("prix_enfant", tr("Prix enfant"), lu.prix_enfant),
        droitNets ? nombre("net_adulte", tr("Net adulte"), lu.net_adulte) : null,
        droitNets ? nombre("net_enfant", tr("Net enfant"), lu.net_enfant) : null,
        l.genre === "trajet" ? heure("depart", tr("Départ")) : null,
        l.genre === "trajet" ? heure("arrivee", tr("Arrivée")) : null,
      ].filter(Boolean);
      const corps = h(
        "div",
        { class: "brochure-completer-corps" },
        h("div", { class: "grille-form" }, champs),
        l.genre === "trajet" ? h("label", { class: "case", for: lendemain.id }, lendemain, tr("Arrivée le lendemain")) : null,
        h(
          "button",
          {
            class: "secondaire",
            type: "button",
            onclick: () => {
              const saisie = {};
              // Seulement ce qui change par rapport à la lecture : appliquer sans rien toucher ne marque rien « saisi à la main ».
              for (const el of corps.querySelectorAll("input[data-cle]")) if (el.value.trim() !== "" && el.value.trim() !== (el.dataset.lu || "")) saisie[el.dataset.cle] = el.value.trim();
              if (l.genre === "trajet" && lendemain.checked !== !!lu.lendemain) saisie.lendemain = lendemain.checked;
              appliquer(l, saisie);
            },
          },
          tr("Appliquer")
        )
      );
      return h("details", { class: "brochure-completer", ...(l.statut === "illisible" ? { open: true } : {}) }, h("summary", null, l.statut === "illisible" ? tr("Compléter la ligne") : tr("Corriger ou compléter")), corps);
    };

    async function ecrire() {
      const ops = plan();
      if (!ops.length) return;
      erreur.textContent = "";
      enregistrer.disabled = true;
      enregistrer.setAttribute("aria-busy", "true");
      const echecs = [];
      let faits = 0;
      // Une ligne, une transaction : la ligne, sa ligne enfant et ses nets passent ensemble ou pas du tout.
      for (const op of ops) {
        try {
          await ecrireLigneBrochure(op);
          faits++;
          aEcrit();
        } catch (err) {
          echecs.push(`${op.libelle} : ${ERREURS[err.message] ? tr(ERREURS[err.message]) : err.message}`);
        }
      }
      enregistrer.removeAttribute("aria-busy");
      if (!echecs.length) {
        toast(pluriel(faits, N_("{n} ligne enregistrée."), N_("{n} lignes enregistrées.")));
        return fini();
      }
      // Échec partiel : ce qui est passé reste, l'écran se refait sur le catalogue à jour et dit ce qui manque. Fermer rafraîchit la fiche.
      afficher(r, { faits, echecs });
    }

    const resume = h("p", { class: "brochure-resume" });
    const majResume = () => {
      const n = compter(lignes());
      const morceaux = [n.nouveau ? pluriel(n.nouveau, N_("{n} nouvelle"), N_("{n} nouvelles")) : "", n.prix_change ? pluriel(n.prix_change, N_("{n} prix changé"), N_("{n} prix changés")) : "", n.inchange ? pluriel(n.inchange, N_("{n} inchangée"), N_("{n} inchangées")) : "", n.illisible ? pluriel(n.illisible, N_("{n} illisible"), N_("{n} illisibles")) : ""].filter(Boolean).join(", ");
      resume.textContent = pluriel(lignes().length, N_("{n} ligne lue"), N_("{n} lignes lues")) + (morceaux ? ` : ${morceaux}.` : ".");
    };
    majResume();
    // Ce que la relecture a fait, en une ligne. Rien à demander à la personne : les lignes corrigées le disent elles-mêmes.
    const rel = r.relue;
    const ligneRelecture = !rel
      ? null
      : rel.erreur
        ? h("p", { class: "assistant-remarque" }, tr("Relecture de contrôle non faite : {raison} Les lignes viennent de la première lecture.", { raison: rel.erreur }))
        : h(
            "p",
            { class: "brochure-relecture" },
            rel.corriges || rel.signales || rel.ajoutes
              ? [tr("Relecture de contrôle faite :"), " ", [rel.corriges ? pluriel(rel.corriges, N_("{n} ligne corrigée"), N_("{n} lignes corrigées")) : "", rel.ajoutes ? pluriel(rel.ajoutes, N_("{n} ligne ajoutée"), N_("{n} lignes ajoutées")) : "", rel.signales ? pluriel(rel.signales, N_("{n} ligne signalée"), N_("{n} lignes signalées")) : ""].filter(Boolean).join(", "), "."]
              : tr("Relecture de contrôle faite : aucune ligne à corriger.")
          );
    const avertissements = [
      ...(r.avertissements || []).map(texteAvertissement),
      partenaire && !memePartenaire(b.partenaire_lu, partenaire.nom) ? tr("La brochure porte le nom « {nom} » : vérifiez que c'est bien celle de {partenaire}.", { nom: b.partenaire_lu, partenaire: partenaire.nom }) : "",
      b.devise && b.devise !== "THB" ? tr("Prix imprimés en {devise} : la base de prix compte en THB, vérifiez avant d'enregistrer.", { devise: b.devise }) : "",
    ].filter(Boolean);
    if (echecs.length) erreur.replaceChildren(h("span", null, pluriel(faits, N_("{n} ligne enregistrée, les autres non :"), N_("{n} lignes enregistrées, les autres non :"))), h("ul", null, echecs.map((e) => h("li", null, e))));
    const section = (titre, ls) => (ls.length ? h("section", { class: "brochure-section" }, h("h3", null, tr(titre)), h("ul", { class: "brochure-lignes" }, ls.map(dessinerLigne))) : null);
    majBouton();
    // replaceChildren écrit « null » pour un enfant absent : on ne garde que les nœuds.
    const enfants = [
      // Créer le partenaire ne valide pas la carte de l'Assistant : seules les lignes enregistrées comptent.
      partenaire ? null : nouveauPartenaire(b, (cree) => ((partenaire = cree), afficher(r))),
      resume,
      ligneRelecture,
      h("p", { class: "aide" }, droitNets ? tr("Cochez ce que vous gardez. Les prix de vente suivent la brochure ; les textes déjà remplis au catalogue ne changent pas ; un net s'écrit s'il figure sur la brochure, imprimé ou écrit à la main, jamais déduit.") : tr("Cochez ce que vous gardez. Les prix de vente suivent la brochure ; les textes déjà remplis au catalogue ne changent pas.")),
      b.remarques ? h("p", { class: "assistant-remarque" }, b.remarques) : null,
      avertissements.length ? h("ul", { class: "assistant-avertissements" }, avertissements.map((a) => h("li", null, a))) : null,
      section(N_("Tarifs"), comp.tarifs),
      section(titreTrajets(comp.trajets), comp.trajets),
      comp.absents.length
        ? h(
            "details",
            { class: "brochure-absents" },
            h("summary", null, pluriel(comp.absents.length, N_("{n} ligne du catalogue absente de la brochure : rien n'y change"), N_("{n} lignes du catalogue absentes de la brochure : rien n'y change"))),
            h("ul", null, comp.absents.map((x) => h("li", null, x.libelle || `${x.de} → ${x.vers}, ${x.depart || "—"}`)))
          )
        : null,
      erreur,
      h("div", { class: "actions brochure-actions" }, enregistrer),
    ];
    resultat.replaceChildren(...enfants.filter(Boolean));
  }

  if (depuisAgent) {
    queueMicrotask(lire);
    return h(
      "div",
      { class: "modal-corps brochure" },
      h("p", null, partenaire ? tr("L'assistant relit les fichiers joints à la conversation et les compare aux tarifs de {partenaire}. Vous choisissez ensuite ce qui entre dans le catalogue.", { partenaire: partenaire.nom }) : tr("L'assistant relit les fichiers joints à la conversation : nouveau partenaire, contacts imprimés, tarifs et horaires. Vous choisissez ensuite ce qui entre dans le catalogue.")),
      h("ul", { class: "brochure-fichiers" }, depuisAgent.fichiers.map((f) => h("li", { class: "brochure-fichier" }, h("span", { class: "brochure-pdf", "aria-hidden": "true" }, f.media_type === "application/pdf" ? "PDF" : tr("Photo")), h("span", { class: "brochure-fichier-nom" }, f.nom)))),
      etatLecture,
      resultat
    );
  }
  return h(
    "div",
    { class: "modal-corps brochure" },
    h("p", null, tr("Envoyez la photo, la capture ou le PDF de la brochure de {partenaire}. L'assistant relève les tarifs, les horaires et les nets qui y figurent, puis relit sa lecture ; vous choisissez ensuite ce qui entre dans le catalogue.", { partenaire: partenaire.nom })),
    h("p", { class: "aide" }, tr("Les fichiers partent chez Anthropic pour être lus, rien d'autre : ni le catalogue, ni les nets de la base. Six fichiers au plus.")),
    h("div", { class: "actions gauche brochure-choix" }, choix, boutonChoisir, boutonLire),
    liste,
    etatLecture,
    resultat
  );
}

// Le partenaire d'une brochure qui n'est pas encore au catalogue : sa fiche imprimée (nom en casse normale, nom thaï, catégorie et groupe
// déduits, lieu de départ, numéros avec libellé, WhatsApp et LINE) et le formulaire habituel pour le créer, déjà rempli. Rien n'est créé sans
// « Enregistrer » dans ce formulaire.
function nouveauPartenaire(b, cree) {
  const fiche = fichePartenaireDepuisBrochure(b, etat.db.partenaires || []);
  const c = fiche.contact;
  const groupe = (GROUPES.find(([v]) => v === fiche.groupe) || [])[1];
  const tels = c.telephones.map((t) => [t.numero, t.libelle ? ` (${t.libelle})` : "", t.whatsapp ? ", WhatsApp" : "", t.line ? ", LINE" : ""].join(""));
  const lus = [
    [N_("Nom"), fiche.nom],
    [N_("Nom imprimé"), b.partenaire_lu !== fiche.nom ? b.partenaire_lu : ""],
    [N_("Nom en thaï"), fiche.nom_thai],
    [N_("Catégorie"), [fiche.categorie, groupe ? tr(groupe) : ""].filter(Boolean).join(" · ")],
    [N_("Point de départ"), c.embarcadere],
    [N_("Téléphone"), tels.join("\n")],
    [N_("E-mail"), (c.emails || []).join(", ")],
    [N_("Site"), c.web],
    [N_("Line"), c.line],
    [N_("Adresse"), c.adresse],
    [N_("Personne"), c.personne],
  ].filter(([, v]) => v);
  const ouvrir = async () => {
    const { formulairePartenaire } = await import("./partenaires.mjs");
    const fermer = modal(tr("Nouveau partenaire"), formulairePartenaire(fiche, (res) => (fermer(), cree(res))), { large: true });
  };
  return h(
    "section",
    { class: "brochure-section brochure-nouveau" },
    h("h3", null, tr("Nouveau partenaire")),
    lus.length ? lus.map(([k, v]) => h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, tr(k)), h("span", { class: "brochure-texte" }, v))) : h("p", { class: "aide" }, tr("Aucun nom ni contact imprimé : remplissez-les dans le formulaire.")),
    peut("partenaires.ecrire") ? h("div", { class: "actions gauche" }, h("button", { class: "principal", type: "button", onclick: ouvrir }, tr("Créer le partenaire"))) : h("p", { class: "aide" }, tr("Votre rôle ne permet pas de créer un partenaire."))
  );
}
