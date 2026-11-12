// Feuille du jour lisible sans réseau : affiche, en lecture seule, la copie gardée sur ce téléphone (aujourd'hui et demain, sans aucun montant). Page autonome : elle n'importe
// que feuille-hors-ligne-lecture.mjs, car c'est la seule autre chose que le service worker garde pour le hors connexion. Aucun HTML construit à la main : tout est du texte.
import { CLE_HORS_LIGNE, lireCopie } from "./js/feuille-hors-ligne-lecture.mjs";

const en = /^en/i.test(navigator.language || "");
const T = en
  ? { titre: "Gestion, offline", bandeau: "No connection. This is a read-only copy saved on {date}, with no prices or amounts.", aucune: "No copy is available on this phone. Reconnect to load today's sheet.", ancienne: "The saved copy is too old to be shown. Reconnect to refresh it.", reessayer: "Try again", aujourdhui: "Today", demain: "Tomorrow", vide: "Nothing planned this day.", chambre: "room", rien: "No services.", appeler: "Call", pers: "{a} adult(s), {e} child(ren)" }
  : { titre: "Gestion, hors connexion", bandeau: "Pas de réseau. Copie en lecture seule enregistrée le {date}, sans aucun prix ni montant.", aucune: "Aucune copie sur ce téléphone. Reconnectez-vous pour charger la feuille du jour.", ancienne: "La copie enregistrée est trop ancienne pour être affichée. Reconnectez-vous pour la renouveler.", reessayer: "Réessayer", aujourdhui: "Aujourd'hui", demain: "Demain", vide: "Rien de prévu ce jour-là.", chambre: "chambre", rien: "Aucun service.", appeler: "Appeler", pers: "{a} adulte(s), {e} enfant(s)" };

const el = (nom, attrs = {}, ...enfants) => {
  const n = document.createElement(nom);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "onclick") n.addEventListener("click", v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const e of enfants.flat()) if (e !== null && e !== undefined && e !== false) n.append(e.nodeType ? e : document.createTextNode(String(e)));
  return n;
};
const telLien = (numero, texte) => {
  const brut = String(numero || "").replace(/[^\d+]/g, "");
  return brut.replace(/\D/g, "").length >= 6 ? el("a", { href: `tel:${brut}`, "aria-label": `${T.appeler} ${texte || numero}` }, texte || numero) : null;
};
const dateLongue = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(en ? "en-GB" : "fr-FR", { weekday: "long", day: "numeric", month: "long" });

const jourLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// « Aujourd'hui » et « Demain » seulement si la date est vraiment celle d'aujourd'hui ou de demain (une copie de la veille ne ment pas).
const etiquetteJour = (iso) => (iso === jourLocal() ? `${T.aujourdhui} · ` : iso === jourLocal(new Date(Date.now() + 86400000)) ? `${T.demain} · ` : "");
const racine = document.getElementById("app");
let brut = null;
try {
  brut = localStorage.getItem(CLE_HORS_LIGNE);
} catch {
  brut = null;
}
const lue = brut ? lireCopie(brut) : { ok: false, raison: "aucune" };
const reessayer = el("button", { type: "button", onclick: () => location.replace("./") }, T.reessayer);

if (!lue.ok) {
  // Une copie trop ancienne ou illisible n'est pas gardée.
  if (brut && lue.raison !== "aucune") {
    try {
      localStorage.removeItem(CLE_HORS_LIGNE);
    } catch {}
  }
  racine.append(el("h1", {}, T.titre), el("p", { class: "bandeau", role: "status" }, lue.raison === "trop_ancienne" ? T.ancienne : T.aucune), reessayer);
} else {
  const copie = lue.copie;
  const quand = new Date(copie.enregistre_le).toLocaleString(en ? "en-GB" : "fr-FR", { dateStyle: "short", timeStyle: "short" });
  let entreprise = 0;
  let jour = 0;
  const dessiner = () => {
    const e = copie.entreprises[entreprise];
    const j = e && e.jours[jour];
    // replaceChildren écrit « null » et « [object …] » pour un null ou un tableau : on aplatit et on retire les vides.
    racine.replaceChildren(
      ...[
      el("h1", {}, T.titre),
      el("p", { class: "bandeau", role: "status" }, T.bandeau.replace("{date}", quand)),
      copie.entreprises.length > 1 ? el("div", { class: "choix", role: "group" }, copie.entreprises.map((x, i) => el("button", { type: "button", "aria-pressed": String(i === entreprise), onclick: () => ((entreprise = i), dessiner()) }, x.nom))) : null,
      e ? el("div", { class: "choix", role: "group" }, e.jours.map((x, i) => el("button", { type: "button", "aria-pressed": String(i === jour), onclick: () => ((jour = i), dessiner()) }, `${etiquetteJour(x.date)}${dateLongue(x.date)}`))) : null,
      !j || !j.groupes.length
        ? el("p", { class: "aide" }, T.vide)
        : j.groupes.map((g) =>
            el(
              "section",
              {},
              el("h2", {}, g.nom || "—", " ", telLien(g.telephone, g.telephone)),
              el("p", { class: "aide" }, T.pers.replace("{a}", g.adultes).replace("{e}", g.enfants)),
              el("ul", {}, g.lignes.map((l) =>
                el("li", {},
                  el("p", {}, el("span", { class: "heure" }, l.heure || "—"), " · ", l.libelle),
                  el("p", {}, l.client, " ", telLien(l.telephone, l.telephone)),
                  el("p", { class: "aide" }, [l.hotel, l.chambre ? `${T.chambre} ${l.chambre}` : ""].filter(Boolean).join(", ")),
                  el("p", { class: "aide" }, T.pers.replace("{a}", l.adultes).replace("{e}", l.enfants), l.reference ? ` · ${l.reference}` : "")
                )
              ))
            )
          ),
      reessayer,
      ].flat().filter(Boolean)
    );
  };
  dessiner();
}
