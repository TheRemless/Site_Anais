// Temps de trajet de référence (19.11.2026, décision de Jérémy : pas de Google Maps). De zone à zone : durée, ferry, marge conseillée, source
// et date. Nani la complète avec Mr. Brown ; l'agent de l'onglet « Assistant » s'en sert d'abord pour calculer les heures de pickup.
// Une ligne pré-remplie (pages taxi du site, durées des trajets, grilles de pickup) reste « à vérifier » tant qu'on ne l'a pas confirmée.
import { etat, peut, organisationActiveId } from "../etat.mjs";
import { h, modal, toast, confirmer, champ, icone } from "../ui.mjs";
import { tr, N_, pluriel, langueActive } from "../i18n.mjs";
import { aujourdhui } from "../calc.mjs";
import { clePaire, lignesDuSite, lignesDesBateaux, lignesDesZones, lignesNouvelles } from "../agent-temps.mjs";
import { texteDuree } from "../agent-planifier.mjs";
import { grillesDe } from "../pickup-calc.mjs";
import { estLanta } from "../exemples.mjs";
import { ROUTES_SITE } from "../temps-site.mjs";

const ORIGINES = { saisie: N_("saisie"), site: N_("page taxi du site"), bateau: N_("catalogue des trajets"), zones: N_("grille de pickup"), agent: N_("conversation avec l'assistant") };

// Les lignes à proposer au pré-remplissage, à partir de ce que l'entreprise a déjà : jamais une ligne de la table écrasée.
export function lignesAPreremplir({ trajets = [], partenaires = [], lanta = false, existantes = [], date = "" }) {
  const zones = [];
  for (const p of partenaires) {
    if (p.actif === false) continue;
    const grilles = grillesDe(p);
    if (!grilles.length) continue;
    // Le lieu de départ des bateaux de ce partenaire, le plus fréquent de ses trajets ; sans trajet, « Embarcadère » seul.
    const compte = new Map();
    for (const t of trajets) if (t.partenaire_id === p.id && t.actif !== false) compte.set(t.de, (compte.get(t.de) || 0) + 1);
    const depart = [...compte.entries()].sort((a, b) => b[1] - a[1])[0];
    zones.push(...lignesDesZones(grilles, depart ? depart[0] : "", date));
  }
  return lignesNouvelles([...(lanta ? lignesDuSite(ROUTES_SITE) : []), ...lignesDesBateaux(trajets, date), ...zones], existantes);
}

export async function vueTempsTrajets() {
  const racine = h("div", { class: "temps", "data-titre": tr("Temps de trajet") });
  const ecrit = peut("dossiers.ecrire") && peut("partenaires.lire");
  const supprime = peut("partenaires.ecrire");
  let lignes = await etat.store.tempsTrajets(etat.entiteId);
  let filtre = "";
  let mode = "route";
  const liste = h("div", { class: "temps-liste" });
  const recherche = h("input", { id: "temps-q", type: "search", placeholder: tr("Lieu"), autocomplete: "off", oninput: (e) => ((filtre = e.target.value.trim().toLowerCase()), dessiner()) });

  function dessiner() {
    if (lignes === null) return liste.replaceChildren(h("p", { class: "aide" }, tr("La table des temps de trajet n'est pas encore installée dans la base.")));
    const visibles = lignes.filter((l) => (l.mode || "route") === mode && (!filtre || `${l.de} ${l.vers}`.toLowerCase().includes(filtre))).sort((a, b) => Number(b.a_verifier) - Number(a.a_verifier) || a.de.localeCompare(b.de) || a.vers.localeCompare(b.vers));
    const aVerifier = visibles.filter((l) => l.a_verifier).length;
    liste.replaceChildren(
      h("p", { class: "aide" }, visibles.length ? pluriel(aVerifier, N_("{n} ligne à vérifier"), N_("{n} lignes à vérifier")) : tr("Aucune durée. Ajoutez celles que vous connaissez, ou pré-remplissez la table avec les durées déjà connues.")),
      h(
        "ul",
        { class: "temps-lignes" },
        visibles.map((l) =>
          h(
            "li",
            null,
            h(
              "button",
              { type: "button", class: `temps-ligne${l.a_verifier ? " a-verifier" : ""}`, onclick: () => editer(l), disabled: !ecrit },
              h("span", { class: "temps-paire" }, h("strong", null, l.de), " ", icone("inverser", 14), " ", h("strong", null, l.vers)),
              h("span", { class: "temps-duree" }, texteDuree(l.duree_min)),
              h("span", { class: "temps-details" }, [l.ferry ? tr("ferry") : "", l.marge_min ? tr("marge {m} min", { m: l.marge_min }) : "", l.source || tr(ORIGINES[l.origine] || N_("saisie")), l.source_date ? new Date(`${l.source_date}T12:00:00Z`).toLocaleDateString(langueActive() === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : ""].filter(Boolean).join(", ")),
              l.a_verifier ? h("span", { class: "assistant-confiance moyenne" }, tr("À vérifier")) : null
            )
          )
        )
      )
    );
  }

  function editer(l = null) {
    const n = l || { de: "", vers: "", mode, duree_min: "", ferry: false, marge_min: 0, source: "", source_date: aujourdhui(), a_verifier: false };
    const de = h("input", { id: "tt-de", value: n.de, required: true, maxlength: 120 });
    const vers = h("input", { id: "tt-vers", value: n.vers, required: true, maxlength: 120 });
    const duree = h("input", { id: "tt-duree", type: "number", min: 1, max: 1440, inputmode: "numeric", value: n.duree_min, required: true });
    const marge = h("input", { id: "tt-marge", type: "number", min: 0, max: 240, inputmode: "numeric", value: n.marge_min || 0 });
    const ferry = h("input", { id: "tt-ferry", type: "checkbox", checked: !!n.ferry });
    const source = h("input", { id: "tt-source", value: n.source || "", maxlength: 200, placeholder: tr("Par exemple : le chauffeur, 19.11") });
    const date = h("input", { id: "tt-date", type: "date", value: n.source_date || aujourdhui() });
    // Enregistrer, c'est confirmer : la ligne n'est plus « à vérifier ».
    const erreur = h("p", { class: "erreur-form", role: "alert" });
    const ferme = modal(
      l ? tr("Corriger la durée") : tr("Ajouter une durée"),
      h(
        "form",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            const d = Math.round(Number(duree.value));
            if (!de.value.trim() || !vers.value.trim() || !(d >= 1 && d <= 1440)) return (erreur.textContent = tr("Indiquez les deux lieux et une durée en minutes."));
            const ligne = { de: de.value.trim(), vers: vers.value.trim(), cle: clePaire(de.value, vers.value), mode: n.mode || mode, duree_min: d, ferry: ferry.checked, marge_min: Math.max(0, Math.round(Number(marge.value) || 0)), source: source.value.trim(), source_date: date.value || null, a_verifier: false, origine: l ? l.origine || "saisie" : "saisie" };
            try {
              // La paire a changé : l'ancienne ligne part, la nouvelle la remplace.
              if (l && l.cle !== ligne.cle && supprime) await etat.store.supprimerTempsTrajet(l.id);
              const [r] = await etat.store.enregistrerTempsTrajets(etat.entiteId, [ligne]);
              lignes = [...lignes.filter((x) => x.id !== r.id && !(l && x.id === l.id && l.cle !== ligne.cle && supprime)), r];
              ferme();
              toast(tr("Durée enregistrée."));
              dessiner();
            } catch (err) {
              erreur.textContent = err.message;
            }
          },
        },
        h("div", { class: "grille-form" }, champ(tr("De"), de), champ(tr("Vers"), vers), champ(tr("Durée (minutes)"), duree), champ(tr("Marge conseillée (minutes)"), marge)),
        h("label", { class: "case", for: "tt-ferry" }, ferry, tr("Le trajet prend le ferry")),
        h("div", { class: "grille-form" }, champ(tr("Source"), source), champ(tr("Date"), date)),
        h("p", { class: "aide" }, tr("Enregistrer confirme la durée : elle passe avant toute autre source pour l'assistant.")),
        erreur,
        h("div", { class: "actions" }, l && supprime ? h("button", { class: "danger", type: "button", onclick: async () => { if (!(await confirmer(tr("Supprimer cette durée ?"), tr("Supprimer"), true))) return; await etat.store.supprimerTempsTrajet(l.id); lignes = lignes.filter((x) => x.id !== l.id); ferme(); dessiner(); } }, tr("Supprimer")) : null, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
      ),
      { protege: false }
    );
  }

  async function preremplir() {
    const proposees = lignesAPreremplir({ trajets: etat.db.trajets, partenaires: etat.db.partenaires, lanta: estLanta(organisationActiveId()), existantes: lignes || [], date: aujourdhui() });
    if (!proposees.length) return toast(tr("Rien de nouveau à pré-remplir."));
    const parOrigine = (o) => proposees.filter((l) => l.origine === o).length;
    const detail = [["site", N_("depuis les pages taxi du site")], ["bateau", N_("depuis les durées des trajets")], ["zones", N_("depuis les grilles de pickup")]].filter(([o]) => parOrigine(o)).map(([o, t]) => `${parOrigine(o)} ${tr(t)}`).join(", ");
    if (!(await confirmer(tr("Ajouter {n} durées à vérifier ({detail}) ? Aucune ligne existante n'est modifiée.", { n: proposees.length, detail }), tr("Pré-remplir")))) return;
    try {
      const r = await etat.store.enregistrerTempsTrajets(etat.entiteId, proposees);
      lignes = [...lignes, ...r];
      toast(pluriel(r.length, N_("{n} durée ajoutée, à vérifier."), N_("{n} durées ajoutées, à vérifier.")));
      dessiner();
    } catch (err) {
      toast(err.message, true);
    }
  }

  const onglets = h(
    "div",
    { class: "onglets-simple temps-modes", role: "tablist" },
    [["route", N_("En voiture")], ["bateau", N_("En bateau")]].map(([m, t]) => h("button", { type: "button", role: "tab", "aria-selected": String(m === mode), onclick: (e) => ((mode = m), onglets.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b === e.currentTarget))), dessiner()) }, tr(t)))
  );
  racine.append(
    h("div", { class: "entete" }, h("h1", null, tr("Temps de trajet")), ecrit ? h("div", { class: "entete-actions" }, h("button", { class: "secondaire", type: "button", onclick: preremplir }, tr("Pré-remplir")), h("button", { class: "principal", type: "button", onclick: () => editer() }, icone("ajouter", 18), tr("Ajouter"))) : null),
    h("p", { class: "aide" }, tr("Les durées de référence de zone à zone. L'assistant s'en sert d'abord pour calculer les heures de pickup, avant OpenStreetMap. Une ligne « à vérifier » n'est confirmée qu'une fois enregistrée par vous.")),
    onglets,
    h("div", { class: "temps-recherche" }, h("label", { for: "temps-q", class: "visuellement-cache" }, tr("Filtrer par lieu")), recherche),
    liste
  );
  dessiner();
  return racine;
}
