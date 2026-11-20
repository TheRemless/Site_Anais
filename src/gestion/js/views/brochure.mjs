// « Importer une brochure » (20.11.2026), depuis la fiche d'un partenaire : la personne envoie la photo, la capture ou le PDF de la brochure,
// l'assistant en tire les tarifs et les horaires de bateau imprimés, l'écran les montre ligne par ligne à côté du catalogue du partenaire
// (nouveau, prix changé, inchangé, illisible). Rien ne s'écrit avant le clic sur « Enregistrer », et seulement les lignes cochées.
// Réservé à qui peut modifier les prix de vente (l'administratrice l'a toujours) quand l'assistant est allumé. Les nets ne s'affichent et ne
// s'écrivent qu'avec le droit « prix nets », jamais en Taxi.
import { etat, peut, inserer, modifier, enregistrerLie, modeTaxi, modeExcursions, reglages } from "../etat.mjs";
import { h, champ, modal, toast } from "../ui.mjs";
import { formatMontant, aujourdhui } from "../calc.mjs";
import { libelleUnite } from "../partenaires-calc.mjs";
import { assistantActif } from "../assistant-calc.mjs";
import { tr, N_, pluriel, langueActive } from "../i18n.mjs";
import { DROITS_BROCHURE, comparerBrochure, changerCible, compter, planBrochure, ciblesPossibles, phraseAgeEnfant, memePartenaire } from "../brochure-calc.mjs";
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
};
const erreurTexte = (code) => (ERREURS[code] ? tr(ERREURS[code]) : erreurFichier(code) || messageErreur(code));

const AVERTISSEMENTS = {
  prix_non_imprime: N_("« {nom} » : le prix rendu ne figure pas dans le texte imprimé, la ligne est marquée illisible."),
  net_retire: N_("« {nom} » : un net non imprimé a été retiré. Un net n'est jamais déduit."),
  ligne_sans_nom: N_("Une ligne sans nom de programme a été laissée de côté."),
  trajet_sans_lieux: N_("Un horaire sans lieu de départ ou d'arrivée a été laissé de côté."),
  brochure_coupee: N_("La brochure compte plus de lignes qu'une lecture n'en prend : vérifiez la fin, ou envoyez-la en deux fois."),
};
const texteAvertissement = (a) => {
  const i = a.indexOf(":");
  const code = i > 0 ? a.slice(0, i) : a;
  return AVERTISSEMENTS[code] ? tr(AVERTISSEMENTS[code], { nom: i > 0 ? a.slice(i + 1) : "" }) : "";
};

const STATUTS = { nouveau: N_("Nouveau"), prix_change: N_("Prix changé"), inchange: N_("Inchangé"), illisible: N_("Illisible") };
const badge = (statut) => h("span", { class: `brochure-statut ${statut}` }, tr(STATUTS[statut]));
const prix = (n) => (n === null || n === undefined ? "—" : formatMontant(n));

// ---- Écran --------------------------------------------------------------------------------------------------------------------------------

// `apres` rafraîchit la fiche du partenaire quand quelque chose a été enregistré, à la fermeture.
// Depuis une carte de l'onglet Assistant (`depuisAgent`) : les fichiers sont ceux joints à la conversation (identifiants de agent_fichiers),
// relus par la fonction ; la lecture part tout de suite. `p` peut être null : la brochure est celle d'un nouveau partenaire, que l'écran
// fait créer (formulaire habituel, prérempli du nom et des contacts imprimés) avant d'enregistrer les lignes.
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
      etatLecture.textContent = tr("L'assistant lit la brochure. Comptez une minute environ.");
      const r = await etat.store.assistant({ usage: "brochure", entite_id: etat.entiteId, ...corps });
      if (!r || r.erreur || !r.brochure) {
        etatLecture.classList.add("erreur");
        etatLecture.textContent = erreurLecture(r && r.erreur);
        return;
      }
      etatLecture.textContent = "";
      afficher(r);
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
  // créé devient « inchangé », rien ne peut être créé deux fois.
  function afficher(r, { faits = 0, echecs = [] } = {}) {
    const b = r.brochure;
    const partenaireId = partenaire ? partenaire.id : null;
    const comp = comparerBrochure(b, { partenaireId, prestations: etat.db.prestations, trajets: etat.db.trajets });
    const lignes = [...comp.tarifs, ...comp.trajets];
    const cibles = ciblesPossibles(partenaireId, etat.db.prestations).sort((a, c) => a.libelle.localeCompare(c.libelle));
    const erreur = h("div", { class: "erreur-form", role: "alert" });
    const enregistrer = h("button", { class: "principal", type: "button", onclick: () => ecrire() });
    const plan = () =>
      planBrochure(lignes, {
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

    // Une ligne de la brochure : sa case, son statut, ses prix face au catalogue, ce qui a été lu.
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
            unite ? h("span", { class: "sous-ligne" }, unite) : null
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
      const titre =
        l.genre === "trajet"
          ? h("strong", null, `${lu.de} → ${lu.vers}, ${lu.depart || "—"}`, lu.arrivee ? ` (${tr("arrivée {heure}", { heure: lu.arrivee })})` : "")
          : !l.cible && l.statut !== "illisible"
            ? h("input", { class: "brochure-libelle", value: l.libelle, "aria-label": tr("Libellé de la nouvelle prestation"), oninput: (e) => (l.libelle = e.target.value) })
            : h("strong", null, l.cible ? l.cible.libelle : lu.libelle);
      const selecteur =
        l.genre === "prestation" && l.statut !== "illisible"
          ? (() => {
              // Un tarif déjà visé par une autre ligne ne se propose pas : deux lignes ne modifient jamais le même tarif.
              const prises = new Set(comp.tarifs.filter((x) => x !== l && x.cible).map((x) => x.cible.id));
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
        l.statut === "illisible" ? h("p", { class: "brochure-illisible" }, lu.illisible || tr("Ligne illisible."), " ", tr("À saisir à la main dans la fiche.")) : null,
      ];
      const imprime = lu.prix_texte ? h("p", { class: "brochure-imprime" }, tr("Imprimé : « {texte} »", { texte: lu.prix_texte })) : null;
      const net = droitNets && (lu.net_adulte !== null || lu.net_enfant !== null) ? h("p", { class: "brochure-imprime" }, tr("Net imprimé : {adulte} adulte, {enfant} enfant", { adulte: prix(lu.net_adulte), enfant: prix(lu.net_enfant) })) : null;
      const lus =
        l.genre === "prestation"
          ? [[N_("Horaires"), lu.horaires], [N_("Durée"), lu.duree], [N_("Capacité"), lu.capacite], [N_("Bateau"), lu.bateau], [N_("Programme"), lu.programme], [N_("Inclus"), lu.inclus], [N_("Frais de parc"), lu.parc], [N_("Conditions"), [lu.conditions, lu.prix_enfant !== null ? phraseAgeEnfant(lu.age_enfant, langue) : ""].filter(Boolean).join("\n")]]
          : [[N_("Type"), lu.mode], [N_("Durée"), lu.duree], [N_("Période"), lu.periode]];
      const detail = lus.some(([, v]) => v)
        ? h("details", { class: "detail-prestation" }, h("summary", null, tr("Ce que dit la brochure")), lus.filter(([, v]) => v).map(([k, v]) => h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, tr(k)), h("span", { class: "brochure-texte" }, v))))
        : null;
      const noeud = h(
        "li",
        { class: `brochure-ligne ${l.statut}` },
        h("div", { class: "brochure-tete" }, h("label", { class: "case brochure-case", for: id }, coche, h("span", { class: "visuellement-cache" }, tr("Garder cette ligne"))), badge(l.statut), titre),
        h("div", { class: "brochure-corps" }, prixLigne, imprime, net, ...notes, selecteur, detail)
      );
      noeuds.set(l.cle, noeud);
      return noeud;
    };

    async function ecrire() {
      const ops = plan();
      if (!ops.length) return;
      erreur.textContent = "";
      enregistrer.disabled = true;
      enregistrer.setAttribute("aria-busy", "true");
      const echecs = [];
      let faits = 0;
      for (const op of ops) {
        try {
          let id = op.id;
          if (op.action === "creer") id = (await inserer(op.table, op.valeurs)).id;
          else if (op.valeurs) await modifier(op.table, op.id, op.table === "prestations" ? { ...op.valeurs, updated_at: new Date().toISOString() } : op.valeurs);
          if (op.enfant) await modifier("prestations", op.enfant.id, { ...op.enfant.valeurs, updated_at: new Date().toISOString() });
          if (op.nets) await enregistrerLie(op.nets.table, op.nets.cleParent, id, op.nets.valeurs);
          faits++;
          aEcrit();
        } catch (err) {
          echecs.push(`${op.libelle} : ${err.message}`);
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

    const n = compter(lignes);
    const resume = [n.nouveau ? pluriel(n.nouveau, N_("{n} nouvelle"), N_("{n} nouvelles")) : "", n.prix_change ? pluriel(n.prix_change, N_("{n} prix changé"), N_("{n} prix changés")) : "", n.inchange ? pluriel(n.inchange, N_("{n} inchangée"), N_("{n} inchangées")) : "", n.illisible ? pluriel(n.illisible, N_("{n} illisible"), N_("{n} illisibles")) : ""].filter(Boolean).join(", ");
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
      h("p", { class: "brochure-resume" }, pluriel(lignes.length, N_("{n} ligne lue"), N_("{n} lignes lues")), resume ? ` : ${resume}.` : "."),
      h("p", { class: "aide" }, tr("Cochez ce que vous gardez. Les prix de vente suivent la brochure ; les textes déjà remplis au catalogue ne changent pas ; un net n'est écrit que s'il est imprimé.")),
      b.remarques ? h("p", { class: "assistant-remarque" }, b.remarques) : null,
      avertissements.length ? h("ul", { class: "assistant-avertissements" }, avertissements.map((a) => h("li", null, a))) : null,
      section(N_("Tarifs"), comp.tarifs),
      section(N_("Horaires de bateau"), comp.trajets),
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
    h("p", null, tr("Envoyez la photo, la capture ou le PDF de la brochure de {partenaire}. L'assistant relève les tarifs et les horaires imprimés ; vous choisissez ensuite ce qui entre dans le catalogue.", { partenaire: partenaire.nom })),
    h("p", { class: "aide" }, tr("Les fichiers partent chez Anthropic pour être lus, rien d'autre : ni le catalogue, ni les nets de la base. Envoyez la brochure publique, pas une grille de prix nets. Six fichiers au plus.")),
    h("div", { class: "actions gauche brochure-choix" }, choix, boutonChoisir, boutonLire),
    liste,
    etatLecture,
    resultat
  );
}

// Le partenaire d'une brochure qui n'est pas encore au catalogue : son nom, ses contacts imprimés et le formulaire habituel pour le créer,
// déjà rempli. Rien n'est créé sans « Enregistrer » dans ce formulaire.
function nouveauPartenaire(b, cree) {
  const c = b.contacts || {};
  const contact = { personne: c.personne || "", telephones: (c.telephones || []).map((numero) => ({ numero, libelle: "", whatsapp: false })), emails: c.emails || [], line: c.line || "", web: c.web || "", adresse: c.adresse || "" };
  const lus = [[N_("Nom imprimé"), b.partenaire_lu], [N_("Téléphone"), (c.telephones || []).join(", ")], [N_("E-mail"), (c.emails || []).join(", ")], [N_("Site"), c.web], [N_("Line"), c.line], [N_("Adresse"), c.adresse], [N_("Personne"), c.personne]].filter(([, v]) => v);
  const ouvrir = async () => {
    const { formulairePartenaire } = await import("./partenaires.mjs");
    const fermer = modal(tr("Nouveau partenaire"), formulairePartenaire({ nom: b.partenaire_lu || "", contact }, (res) => (fermer(), cree(res))), { large: true });
  };
  return h(
    "section",
    { class: "brochure-section brochure-nouveau" },
    h("h3", null, tr("Nouveau partenaire")),
    lus.length ? lus.map(([k, v]) => h("div", { class: "ligne-info" }, h("span", { class: "ligne-libelle" }, tr(k)), h("span", { class: "brochure-texte" }, v))) : h("p", { class: "aide" }, tr("Aucun nom ni contact imprimé : remplissez-les dans le formulaire.")),
    peut("partenaires.ecrire") ? h("div", { class: "actions gauche" }, h("button", { class: "principal", type: "button", onclick: ouvrir }, tr("Créer le partenaire"))) : h("p", { class: "aide" }, tr("Votre rôle ne permet pas de créer un partenaire."))
  );
}
