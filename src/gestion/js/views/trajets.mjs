// Trajets : le chercheur de liaisons (départ, arrivée, date, compagnie), les horaires, prix, nets et périodes.
import { etat, peut, naviguer, nomPartenaire, netTrajet, inserer, modifier, supprimer, enregistrerLie } from "../etat.mjs";
import { h, champ, modal, confirmer, toast, icone, num } from "../ui.mjs";
import { filtrerTrajets, lieux, meilleursNets, resumeParCompagnie } from "../partenaires-calc.mjs";
import { vide, cartes } from "./commun.mjs";
import { prix, margeNoeud, voitNets } from "./partenaires.mjs";
import { tr, pluriel, N_ } from "../i18n.mjs";

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
  const resume = h("div", { class: "resume-cies" });
  const corps = h("div");
  const rafraichir = () => naviguer(location.hash);

  function dessiner() {
    const p = new URLSearchParams();
    for (const [k, v] of [["de", de.value], ["vers", vers.value], ["partenaire", cie.value], ["date", date.value], ["q", q.value]]) if (v) p.set(k, v);
    history.replaceState(null, "", `#/trajets${p.toString() ? `?${p}` : ""}`);
    const lignes = filtrerTrajets(etat.db.trajets, { de: de.value, vers: vers.value, partenaireId: cie.value, date: date.value, q: q.value, nomPartenaire });
    resume.replaceChildren();
    corps.replaceChildren();
    if (de.value && vers.value) {
      const r = resumeParCompagnie(lignes, netDe);
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
      corps.append(vide(tr("Aucun départ ne correspond"), etat.db.trajets.length ? tr("Essayez sans date, avec toutes les compagnies ou dans l'autre sens.") : tr("Les trajets des compagnies s'importent depuis Réglages, Sauvegarde, ou se créent ici.")));
      return;
    }
    const meilleurs = de.value && vers.value && nets ? meilleursNets(lignes, netDe) : new Set();
    const detail = (t) => [t.mode ? `${t.mode}. ` : "", t.bebe ? `Bébé : ${t.bebe}. ` : "", t.numero ? `Ligne n°${t.numero}. ` : "", t.periode && t.periode !== "Toute la période du contrat" ? `Période : ${t.periode}.` : ""].join("").trim();
    const modif = (t) => (peut("partenaires.ecrire") ? h("button", { class: "secondaire petit", type: "button", onclick: () => { const fermer = modal(tr("Modifier le trajet"), formulaireTrajet(t, () => (fermer(), rafraichir()))); } }, tr("Modifier")) : null);
    const cieNom = (t) => h("span", { class: "tag cie" }, nomPartenaire(t.partenaire_id).split(" ")[0]);
    corps.append(
      h("p", { class: "aide", "aria-live": "polite" }, pluriel(lignes.length, N_("{n} départ."), N_("{n} départs."))),
      cartes(lignes, (t) => {
        const n = netTrajet(t);
        return h(
          "div",
          { class: "carte-lien statique" },
          h("span", { class: "carte-titre" }, t.de, " ", icone("fleche", 14), " ", t.vers),
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
              null,
              h("td", null, h("a", { href: `#/partenaire/${t.partenaire_id}` }, nomPartenaire(t.partenaire_id))),
              h("td", null, h("strong", null, t.de), " ", icone("fleche", 14), " ", h("strong", null, t.vers), detail(t) ? h("span", { class: "sous-ligne" }, detail(t)) : null),
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
    h("div", { class: "entete" }, h("div", null, h("h1", null, tr("Trajets en bateau")), h("p", { class: "sous" }, tr("{n} départs. Choisissez un départ et une arrivée pour comparer les compagnies.", { n: etat.db.trajets.length }))), peut("partenaires.ecrire") ? h("button", { class: "principal", type: "button", onclick: () => { const fermer = modal(tr("Nouveau trajet"), formulaireTrajet({}, () => (fermer(), rafraichir()))); } }, tr("Nouveau trajet")) : null),
    h("div", { class: "barre-outils chercheur" }, h("div", { class: "champ" }, h("label", { for: "t-de" }, tr("Départ")), de), h("div", { class: "champ inverser" }, inverser), h("div", { class: "champ" }, h("label", { for: "t-vers" }, tr("Arrivée")), vers), h(
      "details",
      { class: "filtres-plus", open: window.matchMedia("(min-width: 720px)").matches || !!(params.get("partenaire") || params.get("date") || params.get("q")) },
      h("summary", null, tr("Compagnie, date, recherche"), icone("chevron", 18)),
      h("div", { class: "chercheur-plus" }, h("div", { class: "champ" }, h("label", { for: "t-cie" }, tr("Compagnie")), cie), h("div", { class: "champ" }, h("label", { for: "t-date" }, tr("Date du voyage")), date), h("div", { class: "champ recherche" }, h("label", { for: "t-q" }, tr("Recherche")), q))
    )
  ),
    resume,
    corps,
    regles.length
      ? h("section", { class: "regles-trajets" }, h("h2", null, tr("À savoir")), h("div", { class: "grille-regles" }, regles.map((p) => h("div", { class: "carte-regle" }, h("h3", null, p.nom), p.regles.checkin ? h("p", null, h("strong", null, tr("Check-in ")), p.regles.checkin.join(" ")) : null, p.regles.annulation ? h("p", null, h("strong", null, tr("Annulation ")), p.regles.annulation) : null))), h("p", { class: "aide" }, h("a", { href: "#/regles" }, tr("Toutes les règles"))))
      : null
  );
}

function formulaireTrajet(t, apres) {
  const nets = voitNets();
  const n = t.id && nets ? netTrajet(t) : null;
  const cie = h("select", { id: "f-cie" }, etat.db.partenaires.filter((p) => p.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => h("option", { value: p.id }, p.nom)));
  cie.value = t.partenaire_id || (cie.firstChild ? cie.firstChild.value : "");
  const de = h("input", { id: "f-de", value: t.de || "", required: true, list: "f-lieux" });
  const vers = h("input", { id: "f-vers", value: t.vers || "", required: true, list: "f-lieux" });
  const lieuxListe = h("datalist", { id: "f-lieux" }, lieux(etat.db.trajets).map((x) => h("option", { value: x })));
  const mode = h("input", { id: "f-mode", value: t.mode || "Speedboat" });
  const depart = h("input", { id: "f-dep", type: "time", value: t.depart || "" });
  const arrivee = h("input", { id: "f-arr", type: "time", value: t.arrivee || "" });
  const duree = h("input", { id: "f-duree", value: t.duree || "", placeholder: "1 h 30" });
  const ad = h("input", { id: "f-ad", type: "number", min: "0", step: "1", value: t.prix_adulte ?? "", inputmode: "numeric" });
  const ch = h("input", { id: "f-ch", type: "number", min: "0", step: "1", value: t.prix_enfant ?? "", inputmode: "numeric" });
  const adn = h("input", { id: "f-adn", type: "number", min: "0", step: "1", value: n && n.net_adulte != null ? n.net_adulte : "", inputmode: "numeric" });
  const chn = h("input", { id: "f-chn", type: "number", min: "0", step: "1", value: n && n.net_enfant != null ? n.net_enfant : "", inputmode: "numeric" });
  const bebe = h("input", { id: "f-bebe", value: t.bebe || "Gratuit" });
  const periode = h("input", { id: "f-per", value: t.periode || "", placeholder: tr("1 nov 2026 → 4 mai 2027") });
  const fenetres = h("textarea", { id: "f-fen", rows: 2, placeholder: tr("2026-11-01 → 2027-05-04, une fenêtre par ligne") });
  fenetres.value = (t.fenetres || []).map((f) => `${f[0]} → ${f[1]}`).join("\n");
  const actif = h("input", { id: "f-actif", type: "checkbox", checked: t.actif !== false });
  return h(
    "form",
    {
      class: "modal-corps",
      onsubmit: async (e) => {
        e.preventDefault();
        const fen = fenetres.value.split("\n").map((l) => l.match(/(\d{4}-\d{2}-\d{2})\D+(\d{4}-\d{2}-\d{2})/)).filter(Boolean).map((m) => [m[1], m[2]]);
        const valeurs = { partenaire_id: cie.value, de: de.value.trim(), vers: vers.value.trim(), mode: mode.value.trim(), depart: depart.value, arrivee: arrivee.value, duree: duree.value.trim(), prix_adulte: num(ad.value), prix_enfant: num(ch.value), bebe: bebe.value.trim(), periode: periode.value.trim() || (fen.length ? "" : tr("Toute la période du contrat")), fenetres: fen, actif: actif.checked };
        try {
          const res = t.id ? await modifier("trajets", t.id, valeurs) : await inserer("trajets", { ...valeurs, numero: Math.max(0, ...etat.db.trajets.map((x) => x.numero || 0)) + 1 });
          if (nets && peut("partenaires.ecrire") && (adn.value !== "" || chn.value !== "" || n)) await enregistrerLie("trajets_nets", "trajet_id", res.id, { net_adulte: num(adn.value), net_enfant: num(chn.value) });
          toast(tr("Trajet enregistré."));
          apres(res);
        } catch (err) {
          toast(tr("Enregistrement impossible : {message}", { message: err.message }), true);
        }
      },
    },
    champ(tr("Compagnie"), cie),
    h("div", { class: "grille-form" }, champ(tr("Départ"), [de, lieuxListe]), champ(tr("Arrivée"), vers), champ(tr("Type"), mode)),
    h("div", { class: "grille-form compacte" }, champ(tr("Heure de départ"), depart), champ(tr("Heure d'arrivée"), arrivee), champ(tr("Durée"), duree)),
    h("div", { class: "grille-form compacte" }, champ(tr("Prix adulte"), ad), champ(tr("Prix enfant"), ch), nets ? champ(tr("Net adulte"), adn) : null, nets ? champ(tr("Net enfant"), chn) : null),
    h("div", { class: "grille-form" }, champ(tr("Bébé"), bebe), champ(tr("Période, en clair"), periode)),
    champ(tr("Fenêtres de circulation"), fenetres, tr("Vide : le trajet circule toute la période du contrat.")),
    h("label", { class: "case", for: "f-actif" }, actif, tr("Trajet proposé")),
    h("div", { class: "actions" }, t.id ? h("button", { class: "danger", type: "button", onclick: async () => { if (await confirmer(tr("Supprimer le trajet {de} → {vers} de {depart} ?", { de: t.de, vers: t.vers, depart: t.depart }), tr("Supprimer"), true)) { await supprimer("trajets", t.id); apres(null); } } }, tr("Supprimer")) : null, h("button", { class: "principal", type: "submit" }, tr("Enregistrer")))
  );
}
