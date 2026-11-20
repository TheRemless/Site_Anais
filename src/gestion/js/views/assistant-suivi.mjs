// Suivi de l'assistant IA (#/assistant) : coût du jour et du mois, appels par usage, par personne et par entreprise, échecs, limite du jour,
// tendance sur 30 jours et qualité des réponses rédigées. Réservé aux administratrices (réglages et journal) ; l'administratrice générale voit
// toutes les entreprises. Les chiffres viennent du journal de l'assistant, qui ne garde jamais le message ni la réponse (calculs : assistant-suivi-calc.mjs).
import { etat, entitesAccessibles, permissionsDe } from "../etat.mjs";
import { h, vider, toast, confirmer } from "../ui.mjs";
import { formatDate } from "../calc.mjs";
import { tr, N_, pluriel, localeActive } from "../i18n.mjs";
import { vide } from "./commun.mjs";
import { tuile, graphiqueColonnes, tableauTrie, squelette } from "./analyses-widgets.mjs";
import { suiviAssistant, entreprisesSuivies, debutLecture, jourBangkok, etatCredit, resteDuMois, GENRES_APPRIS } from "../assistant-suivi-calc.mjs";
import { rafraichirBandeauCredit } from "./bandeau-credit.mjs";

// Dollars : deux décimales dès 0,10 $, sinon deux chiffres significatifs (un appel coûte souvent moins d'un centime).
export function dollars(v) {
  const x = Number(v) || 0;
  const options = x === 0 ? { maximumFractionDigits: 0 } : Math.abs(x) >= 0.1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumSignificantDigits: 2, maximumFractionDigits: 4 };
  return tr("{montant} $", { montant: x.toLocaleString(localeActive(), options) });
}
const axe = (v) => (Math.abs(v) < 1e-9 ? "0" : v.toLocaleString(localeActive(), { maximumFractionDigits: v < 0.1 ? 3 : 2 }));
const heureBangkok = (iso) => new Date(Date.parse(iso) + 7 * 3600 * 1000).toISOString().slice(11, 16);
const jourCourt = (iso) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;

const AIDES = {
  jour: [N_("Coût aujourd'hui"), N_("Somme du coût estimé des appels du jour (heure de Bangkok), d'après les jetons notés dans le journal et le prix du modèle qui a répondu. La facture d'Anthropic fait foi.")],
  mois: [N_("Coût du mois"), N_("Somme du coût estimé des appels depuis le 1er du mois. La projection prolonge le coût moyen par jour écoulé jusqu'à la fin du mois, à partir du 3 du mois.")],
  echecs: [N_("Échecs du mois"), N_("Appels qui n'ont rien rendu d'utilisable : refus de Claude, réponse coupée ou rejetée par les contrôles, clé refusée, Anthropic occupé ou en panne. Les demandes arrêtées avant Claude (assistant éteint, droit manquant, limite du jour atteinte) ne sont pas notées dans le journal.")],
  limite: [N_("Limite du jour"), N_("Chaque personne a droit à un nombre fixe d'appels par jour (heure de Bangkok), toutes entreprises confondues. Au-delà, l'assistant refuse et la lecture par règles reste affichée. Cet écran ne compte que les appels des entreprises que vous suivez : pour une personne qui travaille aussi ailleurs, la limite peut être atteinte plus tôt.")],
  credit: [N_("Crédit du mois"), N_("Dépense estimée de tout l'assistant depuis le 1er du mois (heure de Bangkok), toutes entreprises confondues, face au plafond réglé par l'administratrice générale. À partir du seuil, les administratrices reçoivent une notification ; au plafond, l'assistant s'arrête jusqu'au 1er du mois suivant. La facture d'Anthropic fait foi.")],
  qualite: [N_("Réponses sans retouche"), N_("À la copie d'une réponse rédigée par l'assistant, l'outil note la part de mots changés avant la copie, jamais le texte. La tuile donne la part des réponses copiées telles quelles. Une retouche faite ensuite dans WhatsApp n'est pas vue.")],
};

export function vueAssistantSuivi() {
  const suivies = entreprisesSuivies({ entites: entitesAccessibles(), permissionsDe });
  if (!suivies.length) return vide(tr("Accès réservé"), tr("Le suivi de l'assistant est réservé aux administratrices d'une entreprise."), h("a", { class: "bouton secondaire", href: "#/" }, tr("Retour au tableau de bord")));
  const q = new URLSearchParams(location.hash.includes("?") ? location.hash.slice(location.hash.indexOf("?") + 1) : "");
  const entiteId = suivies.some((e) => e.id === q.get("e")) ? q.get("e") : null;
  const corps = h("div", { class: "st-corps", "aria-live": "polite" });
  const choix =
    suivies.length > 1
      ? h("div", { class: "champ st-entreprise" }, h("label", { for: "as-entreprise" }, tr("Entreprise")), h("select", { id: "as-entreprise", onchange: (e) => (location.hash = e.target.value ? `#/assistant?e=${e.target.value}` : "#/assistant") }, h("option", { value: "" }, tr("Toutes les entreprises")), suivies.map((e) => h("option", { value: e.id, selected: e.id === entiteId }, e.nom))))
      : null;

  async function charger() {
    vider(corps).append(squelette({ tuiles: 5, graphique: true }));
    try {
      const jour = jourBangkok(new Date().toISOString());
      const [r, budget, appris] = await Promise.all([
        etat.store.assistantSuivi({ entiteIds: suivies.map((e) => e.id), depuis: debutLecture(jour) }),
        etat.store.assistantBudget ? etat.store.assistantBudget() : null,
        etat.store.agentApprentissages ? etat.store.agentApprentissages(entiteId ? [entiteId] : suivies.map((e) => e.id)) : null,
      ]);
      const S = suiviAssistant({ ...r, jour, entites: suivies, entiteId });
      const plusieurs = suivies.length > 1 && !entiteId;
      vider(corps).append(blocCredit(etatCredit(budget), charger), ...rendre(S, { plusieurs }), blocAppris(appris, { entites: suivies, noms: r.noms || {}, plusieurs, recharger: charger }));
    } catch (err) {
      const manque = /assistant_journal|schema cache|does not exist/i.test(err.message || "");
      vider(corps).append(h("p", { class: "erreur-form", role: "alert" }, manque ? tr("Le journal de l'assistant n'existe pas encore dans la base (migration 27).") : tr("Impossible de lire le journal de l'assistant : {message}", { message: err.message })), h("button", { class: "secondaire", type: "button", onclick: charger }, tr("Réessayer")));
    }
  }
  charger();
  return h(
    "div",
    { class: "st assistant-suivi", "data-titre": tr("Suivi de l'assistant"), "data-large": "1" },
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Suivi de l'assistant")), h("p", { class: "sous" }, tr("Coût, usage et qualité. Le journal ne garde jamais le message ni la réponse."))), h("a", { class: "bouton secondaire petit", href: "#/reglages" }, tr("Réglages"))),
    choix,
    corps
  );
}

function rendre(S, { plusieurs }) {
  const bloc = (titre, ...enfants) => h("section", { class: "st-bloc" }, h("h2", { class: "st-titre" }, titre), ...enfants);
  const echecs = S.duMois.refus + S.duMois.erreurs;
  const Q = S.qualite;
  const tuileLimite = tuile({ libelle: tr("Limite du jour"), valeur: S.limiteAtteinte ? pluriel(S.limiteAtteinte, N_("{n} personne à la limite"), N_("{n} personnes à la limite")) : tr("Non atteinte"), detail: tr("{n} appels par personne", { n: S.limite }), aide: AIDES.limite });
  if (S.limiteAtteinte) tuileLimite.classList.add("as-alerte");
  const tuiles = h(
    "div",
    { class: "st-tuiles" },
    tuile({ libelle: tr("Coût aujourd'hui"), valeur: dollars(S.aujourdhui.cout), detail: pluriel(S.aujourdhui.appels, N_("appel"), N_("appels")), aide: AIDES.jour }),
    tuile({ libelle: tr("Coût du mois"), valeur: dollars(S.duMois.cout), detail: S.projection === null ? pluriel(S.duMois.appels, N_("appel"), N_("appels")) : tr("{appels}, environ {projection} sur le mois", { appels: pluriel(S.duMois.appels, N_("appel"), N_("appels")), projection: dollars(S.projection) }), serie: S.tendance.map((t) => t.cout), aide: AIDES.mois, grande: true }),
    tuile({ libelle: tr("Échecs du mois"), valeur: String(echecs), detail: S.duMois.appels ? tr("{pct} % des appels · {refus} refus de Claude", { pct: Math.round((echecs / S.duMois.appels) * 100), refus: S.duMois.refus }) : tr("aucun appel"), aide: AIDES.echecs }),
    tuileLimite,
    tuile({ libelle: tr("Réponses sans retouche"), valeur: Q.part === null ? "—" : `${Q.part} %`, detail: !Q.disponible ? tr("mesure pas encore en place") : Q.mesurees ? tr("{n} sur {m} réponses copiées", { n: Q.sansRetouche, m: Q.mesurees }) : tr("aucune réponse copiée ce mois-ci"), aide: AIDES.qualite })
  );

  // Tendance : le coût de chaque jour, une seule échelle ; les appels et les échecs se lisent en touchant la colonne.
  const tendance = bloc(
    tr("Coût par jour sur 30 jours"),
    graphiqueColonnes({
      cases: S.tendance.map((t) => ({ cle: t.jour, libelle: formatDate(t.jour), court: jourCourt(t.jour) })),
      series: [{ nom: N_("Coût en dollars"), valeurs: S.tendance.map((t) => t.cout), classe: "s1" }],
      titre: tr("Coût par jour sur 30 jours"),
      etiquettes: false,
      hauteur: 200,
      format: axe,
      lecture: (i) => {
        const t = S.tendance[i];
        return h("p", { class: "st-lecture-texte" }, h("strong", null, formatDate(t.jour)), ` · ${dollars(t.cout)} · ${pluriel(t.appels, N_("appel"), N_("appels"))}`, t.refus + t.erreurs ? ` · ${pluriel(t.refus + t.erreurs, N_("échec"), N_("échecs"))}` : "");
      },
    })
  );

  const somme = (cle, f = String) => (lignes) => f(lignes.reduce((t, l) => t + l[cle], 0));
  const colAppels = { cle: "appels", titre: N_("Appels"), num: true, somme: somme("appels") };
  const colEchecs = { cle: "echecs", titre: N_("Échecs"), num: true, valeur: (l) => l.refus + l.erreurs, rendu: (l) => String(l.refus + l.erreurs), somme: (ls) => String(ls.reduce((t, l) => t + l.refus + l.erreurs, 0)) };
  const colCout = { cle: "cout", titre: N_("Coût"), num: true, rendu: (l) => dollars(l.cout), somme: somme("cout", dollars) };
  const usages = bloc(
    tr("Appels du mois par usage"),
    tableauTrie({ colonnes: [{ cle: "libelle", titre: N_("Usage"), rendu: (l) => tr(l.libelle) }, colAppels, colEchecs, colCout, { cle: "coutMoyen", titre: N_("Coût moyen"), num: true, rendu: (l) => dollars(l.coutMoyen) }], lignes: S.usages, pied: S.usages.length > 1, vide: tr("Aucun appel ce mois-ci."), classe: "as-table" })
  );
  const personnes = bloc(
    tr("Par personne"),
    tableauTrie({
      colonnes: [
        { cle: "nom", titre: N_("Personne"), rendu: (l) => (l.systeme ? tr(l.nom) : l.nom || tr("Personne inconnue")) },
        { cle: "aujourdhui", titre: N_("Aujourd'hui"), num: true, rendu: (l) => h("span", { class: l.limiteAtteinte ? "as-limite" : "" }, l.systeme ? String(l.aujourdhui) : `${l.aujourdhui} / ${S.limite}`, l.limiteAtteinte ? h("span", { class: "as-limite-texte" }, ` ${tr("limite atteinte")}`) : null) },
        { ...colAppels, titre: N_("Appels du mois") },
        { ...colCout, titre: N_("Coût du mois") },
        { cle: "joursLimite", titre: N_("Jours à la limite (30 j)"), num: true },
      ],
      lignes: S.personnes,
      vide: tr("Personne n'a utilisé l'assistant ce mois-ci."),
      classe: "as-table",
    })
  );
  const entreprises = plusieurs
    ? bloc(tr("Par entreprise"), tableauTrie({ colonnes: [{ cle: "nom", titre: N_("Entreprise") }, colAppels, colEchecs, colCout], lignes: S.entreprises, pied: S.entreprises.length > 1, vide: tr("Aucun appel ce mois-ci."), classe: "as-table" }))
    : null;

  const echecsBloc = bloc(
    tr("Appels refusés ou en erreur"),
    S.statuts.length
      ? h("ul", { class: "as-statuts" }, S.statuts.map((x) => h("li", { class: `as-${x.categorie}` }, h("strong", null, String(x.nombre)), ` ${tr(x.libelle)}`)))
      : h("p", { class: "vide-court" }, tr("Aucun échec ce mois-ci.")),
    S.echecs.length
      ? h("details", { class: "st-defs" }, h("summary", null, tr("Les {n} derniers sur 30 jours", { n: S.echecs.length })), h("ul", { class: "as-derniers" }, S.echecs.map((x) => h("li", null, h("span", { class: "as-quand" }, `${formatDate(jourBangkok(x.cree_le))} ${heureBangkok(x.cree_le)}`), ` ${tr(x.libelleStatut)} · ${tr(x.libelleUsage)}`, x.personne ? ` · ${x.personneSysteme ? tr(x.personne) : x.personne}` : "", plusieurs && x.entreprise ? ` · ${x.entreprise}` : ""))))
      : null,
    h("p", { class: "aide" }, tr("Les demandes arrêtées avant Claude (assistant éteint, droit manquant, limite du jour atteinte) ne sont pas notées dans le journal."))
  );

  const qualite = bloc(
    tr("Qualité des réponses rédigées"),
    !Q.disponible
      ? h("p", { class: "aide" }, tr("La mesure démarre avec la mise à jour 51 de la base : à chaque copie d'une réponse rédigée, l'outil notera la part de mots changés, jamais le texte. {n} réponses rédigées ce mois-ci.", { n: Q.redigees }))
      : Q.mesurees
        ? h("div", null, h("p", null, tr("{part} % des réponses copiées telles quelles ({n} sur {m}). En moyenne {moyenne} % des mots changés avant la copie.", { part: Q.part, n: Q.sansRetouche, m: Q.mesurees, moyenne: Q.moyenne })), h("p", { class: "aide" }, tr("{r} réponses rédigées ce mois-ci, {m} copiées depuis l'outil.", { r: Q.redigees, m: Q.mesurees })))
        : h("p", { class: "aide" }, tr("Aucune réponse rédigée copiée ce mois-ci ({n} rédigées).", { n: Q.redigees }))
  );

  return [tuiles, tendance, usages, personnes, entreprises, echecsBloc, qualite];
}

// ---- Crédit du mois (migration 54) -------------------------------------------------------------------------------------------
function blocCredit(C, recharger) {
  if (!C) return h("p", { class: "aide" }, tr("Le plafond du mois s'installe avec la mise à jour 54 de la base."));
  const barre = h("div", { class: "as-credit-barre", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.min(100, C.pct)), "aria-label": tr("Part du plafond dépensée") }, h("span", { style: `width:${Math.min(100, C.pct)}%` }), h("i", { style: `left:${C.seuil}%`, "aria-hidden": "true" }));
  const t = tuile({
    libelle: tr("Crédit du mois"),
    valeur: tr("{cout} sur {plafond}", { cout: dollars(C.cout), plafond: dollars(C.plafond) }),
    detail: C.atteint ? tr("Plafond atteint : l'assistant est arrêté jusqu'au 1er du mois prochain.") : tr("{pct} % du plafond, alerte à {seuil} %, reste {reste}", { pct: C.pct, seuil: C.seuil, reste: dollars(C.reste) }),
    aide: AIDES.credit,
    grande: true,
  });
  if (C.alerte) t.classList.add("as-alerte");
  t.append(barre);
  // Sous le plafond : ce qui reste à dépenser ce mois-ci (0 $ restant et « plafond atteint » au-delà).
  const R = resteDuMois(C);
  t.append(h("p", { class: `as-credit-reste${R.atteint ? " atteint" : ""}` }, tr(R.texte, { reste: dollars(R.reste) }), R.mention ? h("span", { class: "as-credit-mention" }, ` · ${tr(R.mention)}`) : null));
  let reglage = null;
  if (C.peutRegler) {
    const plafond = h("input", { id: "as-plafond", type: "number", min: "1", max: "1000", step: "0.01", inputmode: "decimal", value: String(C.plafond) });
    const seuil = h("input", { id: "as-seuil", type: "number", min: "50", max: "99", step: "1", inputmode: "numeric", value: String(C.seuil) });
    const erreur = h("p", { class: "erreur-form", role: "alert" });
    reglage = h(
      "form",
      {
        class: "as-plafond",
        onsubmit: async (e) => {
          e.preventDefault();
          const p = Number(plafond.value);
          const s = Number(seuil.value);
          if (!(p >= 1 && p <= 1000)) return (erreur.textContent = tr("Le plafond va de 1 à 1 000 $."));
          if (!(Number.isInteger(s) && s >= 50 && s <= 99)) return (erreur.textContent = tr("L'alerte se règle entre 50 et 99 %."));
          try {
            await etat.store.reglerPlafondAssistant(p, s);
            toast(tr("Plafond du mois enregistré."));
            rafraichirBandeauCredit();
            recharger();
          } catch (err) {
            erreur.textContent = err.message;
          }
        },
      },
      h("div", { class: "champ" }, h("label", { for: "as-plafond" }, tr("Plafond du mois ($)")), plafond),
      h("div", { class: "champ" }, h("label", { for: "as-seuil" }, tr("Alerte à (%)")), seuil),
      h("button", { class: "principal", type: "submit" }, tr("Enregistrer")),
      erreur,
      h("p", { class: "aide pleine-largeur" }, tr("Le crédit API se recharge dans la console Anthropic : le plafond protège ce crédit, il ne le remplace pas."))
    );
  }
  return h("section", { class: "st-bloc as-credit" }, h("h2", { class: "st-titre" }, tr("Crédit de l'assistant")), h("div", { class: "st-tuiles" }, t), reglage);
}

// ---- Ce que l'agent a appris (migration 54) ------------------------------------------------------------------------------------
function blocAppris(lignes, { entites, noms, plusieurs, recharger }) {
  const titre = h("h2", { class: "st-titre" }, tr("Ce que l'assistant a appris"));
  if (!Array.isArray(lignes)) return h("section", { class: "st-bloc" }, titre, h("p", { class: "aide" }, tr("Les apprentissages de l'assistant s'installent avec la mise à jour 54 de la base.")));
  const nomEntite = (id) => (entites.find((e) => e.id === id) || {}).nom || "";
  const supprimer = async (l) => {
    if (!(await confirmer(tr("Oublier cette correction ? L'assistant ne s'en servira plus."), tr("Oublier"), true))) return;
    try {
      await etat.store.agentSupprimerApprentissage(l.id);
      toast(tr("Correction oubliée."));
      recharger();
    } catch (err) {
      toast(err.message, true);
    }
  };
  const peutSupprimer = (l) => {
    const p = permissionsDe(l.entite_id) || [];
    return p.includes("reglages.ecrire") && p.includes("journal.voir");
  };
  return h(
    "section",
    { class: "st-bloc as-appris" },
    titre,
    h("p", { class: "aide" }, tr("Quand une proposition de l'assistant est changée avant d'être validée, la correction est gardée pour l'entreprise et relue comme exemple dans les conversations suivantes. Jamais un net ni les coordonnées d'un client : les noms, téléphones et e-mails sont masqués.")),
    lignes.length
      ? h(
          "ul",
          { class: "as-appris-liste" },
          lignes.slice(0, 200).map((l) =>
            h(
              "li",
              null,
              h("div", { class: "as-appris-tete" }, h("strong", null, tr(GENRES_APPRIS[l.genre] || l.genre)), h("span", { class: "as-quand" }, `${formatDate(jourBangkok(l.cree_le))}${noms[l.user_id] ? ` · ${noms[l.user_id]}` : ""}${plusieurs ? ` · ${nomEntite(l.entite_id)}` : ""}`)),
              l.contexte ? h("p", { class: "as-appris-contexte" }, l.contexte) : null,
              h("p", { class: "as-appris-modif" }, h("del", null, l.avant || tr("vide")), " → ", h("ins", null, l.apres || tr("vide"))),
              peutSupprimer(l) ? h("button", { class: "lien danger", type: "button", onclick: () => supprimer(l) }, tr("Oublier")) : null
            )
          )
        )
      : h("p", { class: "vide-court" }, tr("Aucune correction pour l'instant."))
  );
}
