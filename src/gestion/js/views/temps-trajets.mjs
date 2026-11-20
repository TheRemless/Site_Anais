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
import { ROUTES_SITE, LIAISON_LANTA } from "../temps-site.mjs";

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
  let liaisons = (await etat.store.liaisonsFerry(etat.entiteId)) || [];
  let filtre = "";
  let mode = "route";
  const liste = h("div", { class: "temps-liste" });
  const recherche = h("input", { id: "temps-q", type: "search", placeholder: tr("Lieu"), autocomplete: "off", oninput: (e) => ((filtre = e.target.value.trim().toLowerCase()), dessiner()) });

  function dessinerFerries() {
    liste.replaceChildren(
      h("p", { class: "aide" }, tr("Un trajet dont un seul bout est sur l'île passe par sa liaison : route jusqu'au port, ferry (durée fixe, traversée et attente comprises), route depuis le port en face. Les durées entre les ports et les lieux se mettent dans « En voiture ».")),
      liaisons.length
        ? h(
            "ul",
            { class: "temps-lignes" },
            liaisons.map((l) =>
              h(
                "li",
                null,
                h(
                  "button",
                  { type: "button", class: `temps-ligne${l.a_verifier ? " a-verifier" : ""}`, onclick: () => editerLiaison(l), disabled: !ecrit },
                  h("span", { class: "temps-paire" }, h("strong", null, l.nom)),
                  h("span", { class: "temps-duree" }, texteDuree(l.duree_min)),
                  h("span", { class: "temps-details" }, tr("{ile} : {a} ↔ {b}", { ile: l.cote_ile, a: l.port_ile, b: l.port_continent })),
                  l.a_verifier ? h("span", { class: "assistant-confiance moyenne" }, tr("À vérifier")) : null
                )
              )
            )
          )
        : h("p", { class: "aide" }, tr("Aucune liaison de ferry."))
    );
  }

  function editerLiaison(l = null) {
    const n = l || { nom: "", cote_ile: "", port_ile: "", port_continent: "", port_ile_coord: "", port_continent_coord: "", duree_min: 60, source: "", source_date: aujourdhui() };
    const c = (id, v, o = {}) => h("input", { id, value: v ?? "", maxlength: 160, ...o });
    const nom = c("lf-nom", n.nom, { required: true, maxlength: 120 });
    const ile = c("lf-ile", n.cote_ile, { required: true, maxlength: 120 });
    const portIle = c("lf-port-ile", n.port_ile, { required: true });
    const portCont = c("lf-port-cont", n.port_continent, { required: true });
    const coordIle = c("lf-coord-ile", n.port_ile_coord, { maxlength: 60, placeholder: tr("latitude, longitude"), inputmode: "decimal" });
    const coordCont = c("lf-coord-cont", n.port_continent_coord, { maxlength: 60, placeholder: tr("latitude, longitude"), inputmode: "decimal" });
    const duree = h("input", { id: "lf-duree", type: "number", min: 1, max: 600, inputmode: "numeric", value: n.duree_min || 60, required: true });
    const source = c("lf-source", n.source, { maxlength: 200 });
    const erreur = h("p", { class: "erreur-form", role: "alert" });
    const ferme = modal(
      l ? tr("Corriger la liaison de ferry") : tr("Ajouter une liaison de ferry"),
      h(
        "form",
        {
          onsubmit: async (e) => {
            e.preventDefault();
            const d = Math.round(Number(duree.value));
            if (![nom, ile, portIle, portCont].every((x) => x.value.trim()) || !(d >= 1 && d <= 600)) return (erreur.textContent = tr("Indiquez le nom, l'île, les deux ports et la durée du ferry."));
            try {
              const r = await etat.store.enregistrerLiaisonFerry(etat.entiteId, { nom: nom.value.trim(), cote_ile: ile.value.trim(), port_ile: portIle.value.trim(), port_continent: portCont.value.trim(), port_ile_coord: coordIle.value.trim(), port_continent_coord: coordCont.value.trim(), duree_min: d, source: source.value.trim(), source_date: aujourdhui(), a_verifier: false });
              liaisons = [...liaisons.filter((x) => x.id !== r.id && !(l && x.id === l.id)), r];
              ferme();
              toast(tr("Liaison enregistrée."));
              dessinerFerries();
            } catch (err) {
              erreur.textContent = err.message;
            }
          },
        },
        h("div", { class: "grille-form" }, champ(tr("Nom"), nom), champ(tr("Île desservie"), ile), champ(tr("Port sur l'île"), portIle), champ(tr("Port en face"), portCont)),
        h("div", { class: "grille-form" }, champ(tr("Coordonnées du port sur l'île (facultatif)"), coordIle), champ(tr("Coordonnées du port en face (facultatif)"), coordCont)),
        h("div", { class: "grille-form" }, champ(tr("Ferry, attente comprise (minutes)"), duree), champ(tr("Source"), source)),
        h("p", { class: "aide" }, tr("Enregistrer confirme la liaison. Les coordonnées « latitude, longitude » aident OpenStreetMap à trouver le bon port.")),
        erreur,
        h("div", { class: "actions" }, l && supprime ? h("button", { class: "danger", type: "button", onclick: async () => { if (!(await confirmer(tr("Supprimer cette liaison de ferry ?"), tr("Supprimer"), true))) return; await etat.store.supprimerLiaisonFerry(l.id); liaisons = liaisons.filter((x) => x.id !== l.id); ferme(); dessinerFerries(); } }, tr("Supprimer")) : null, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
      ),
      { protege: false }
    );
  }

  function dessiner() {
    if (mode === "ferry") return dessinerFerries();
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
        h("p", { class: "aide" }, tr("Enregistrer confirme la durée. L'assistant s'en sert quand OpenStreetMap ne donne rien ; il prend toujours la marge conseillée.")),
        erreur,
        h("div", { class: "actions" }, l && supprime ? h("button", { class: "danger", type: "button", onclick: async () => { if (!(await confirmer(tr("Supprimer cette durée ?"), tr("Supprimer"), true))) return; await etat.store.supprimerTempsTrajet(l.id); lignes = lignes.filter((x) => x.id !== l.id); ferme(); dessiner(); } }, tr("Supprimer")) : null, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
      ),
      { protege: false }
    );
  }

  // Un lieu mal compris par OpenStreetMap reste en mémoire : l'effacer fait recalculer les lieux et les itinéraires au prochain calcul.
  async function oublier() {
    if (!(await confirmer(tr("Effacer les lieux et les itinéraires déjà trouvés par OpenStreetMap ? Ils seront recherchés à nouveau au prochain calcul. La table n'est pas touchée."), tr("Effacer"), true))) return;
    try {
      await etat.store.oublierItineraires(etat.entiteId);
      toast(tr("Lieux et itinéraires effacés."));
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function preremplir() {
    const lanta = estLanta(organisationActiveId());
    // La liaison de Lanta (organisation de Koh Lanta seulement), si elle n'est pas déjà là.
    const liaison = lanta && !liaisons.some((l) => l.cote_ile === LIAISON_LANTA.cote_ile) ? { ...LIAISON_LANTA, source_date: aujourdhui() } : null;
    const proposees = lignesAPreremplir({ trajets: etat.db.trajets, partenaires: etat.db.partenaires, lanta, existantes: lignes || [], date: aujourdhui() });
    if (!proposees.length && !liaison) return toast(tr("Rien de nouveau à pré-remplir."));
    const parOrigine = (o) => proposees.filter((l) => l.origine === o).length;
    const detail = [["site", N_("depuis les pages taxi du site")], ["bateau", N_("depuis les durées des trajets")], ["zones", N_("depuis les grilles de pickup")]].filter(([o]) => parOrigine(o)).map(([o, t]) => `${parOrigine(o)} ${tr(t)}`).concat(liaison ? [tr("la liaison de ferry de Koh Lanta (Khlong Mak, 1 h)")] : []).join(", ");
    if (!(await confirmer(tr("Ajouter {n} éléments à vérifier ({detail}) ? Aucune ligne existante n'est modifiée.", { n: proposees.length + (liaison ? 1 : 0), detail }), tr("Pré-remplir")))) return;
    try {
      if (liaison) liaisons = [...liaisons, await etat.store.enregistrerLiaisonFerry(etat.entiteId, liaison)];
      const r = proposees.length ? await etat.store.enregistrerTempsTrajets(etat.entiteId, proposees) : [];
      lignes = [...lignes, ...r];
      toast(pluriel(r.length + (liaison ? 1 : 0), N_("{n} élément ajouté, à vérifier."), N_("{n} éléments ajoutés, à vérifier.")));
      dessiner();
    } catch (err) {
      toast(err.message, true);
    }
  }

  const onglets = h(
    "div",
    { class: "onglets-simple temps-modes", role: "tablist" },
    [["route", N_("En voiture")], ["ferry", N_("Ferries")], ["bateau", N_("En bateau")]].map(([m, t]) => h("button", { type: "button", role: "tab", "aria-selected": String(m === mode), onclick: (e) => ((mode = m), onglets.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b === e.currentTarget))), dessiner()) }, tr(t)))
  );
  racine.append(
    h("div", { class: "entete" }, h("h1", null, tr("Temps de trajet")), ecrit ? h("div", { class: "entete-actions" }, h("button", { class: "secondaire", type: "button", onclick: preremplir }, tr("Pré-remplir")),
        supprime ? h("button", { class: "secondaire", type: "button", onclick: oublier }, tr("Oublier les itinéraires calculés")) : null, h("button", { class: "principal", type: "button", onclick: () => (mode === "ferry" ? editerLiaison() : editer()) }, icone("ajouter", 18), tr("Ajouter"))) : null),
    h("p", { class: "aide" }, tr("Les durées de référence de zone à zone. L'assistant prend d'abord OpenStreetMap ; la table sert quand OpenStreetMap ne trouve pas un lieu, ainsi que pour la marge conseillée. Une ligne « à vérifier » n'est confirmée qu'une fois enregistrée par vous.")),
    onglets,
    h("div", { class: "temps-recherche" }, h("label", { for: "temps-q", class: "visuellement-cache" }, tr("Filtrer par lieu")), recherche),
    liste
  );
  dessiner();
  return racine;
}
