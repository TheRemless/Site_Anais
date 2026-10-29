import { h, vider } from "../ui.mjs";
import { STATUTS, sommePaiements, nomFichier } from "../calc.mjs";
import { etat, imprimer } from "../etat.mjs";
import { renderDocument } from "../document.mjs";

// Le statut est toujours écrit en toutes lettres, le point de couleur ne fait que l'accompagner.
export function pastille(code) {
  return h("span", { class: `statut s-${code}` }, h("span", { class: "point", "aria-hidden": "true" }), STATUTS[code]);
}

export function vide(titre, texte, action) {
  return h("div", { class: "vide" }, h("h2", null, titre), h("p", null, texte), action || null);
}

// « HM20261028 Thaïlande · novembre 2026 » : la référence puis l'intitulé, sans répéter le pays que la référence porte déjà.
export function sousTitreDossier(d) {
  const intitule = voyageTexte(d.bandeau, d.pays);
  const pays = (d.pays || "").trim();
  const complement = pays && intitule.toLowerCase().startsWith(pays.toLowerCase()) ? intitule.slice(pays.length).replace(/^\s*-\s*/, "") : intitule;
  return [d.ref, complement].filter(Boolean).join(" · ");
}

// Liste en cartes pour le téléphone, à côté d'un tableau réservé au grand écran (classe `seulement-bureau`).
// `carte` renvoie le contenu d'une carte : au besoin une case à cocher, puis un lien `.carte-lien`.
export function cartes(items, carte) {
  return h("ul", { class: "cartes seulement-mobile" }, items.map((x) => h("li", { class: "carte" }, carte(x))));
}

export function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = h("a", { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Montant reçu affiché sur une facture : valeur figée si le document est envoyé, sinon somme des paiements.
export function montantRecu(doc, paiements) {
  if (doc.type !== "facture") return 0;
  return doc.contenu.montant_recu != null ? Number(doc.contenu.montant_recu) : sommePaiements(paiements);
}

export function feuille(doc) {
  const dossier = etat.db.dossiers.find((d) => d.id === doc.dossier_id);
  const client = etat.db.clients.find((c) => c.id === dossier.client_id);
  const paiements = etat.db.paiements.filter((p) => p.dossier_id === dossier.id);
  return { noeud: renderDocument({ type: doc.type, doc, dossier, client, reglages: etat.db.reglages, recu: montantRecu(doc, paiements) }), dossier, client };
}

export function pdf(doc) {
  const { noeud, dossier, client } = feuille(doc);
  imprimer(noeud, nomFichier(doc.type, doc, dossier, client));
}

// « VOYAGE EN THAÏLANDE - DÉCEMBRE 2026 » devient « Thaïlande - décembre 2026 ».
export function voyageTexte(bandeau, pays) {
  if (!bandeau) return pays || "";
  const t = bandeau.replace(/^VOYAGE (EN|AU)\s+/i, "").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Aperçu A4 réduit à la largeur disponible. `fabrique` renvoie une feuille neuve à chaque appel.
export function apercuA4(fabrique) {
  const echelle = h("div", { class: "apercu-echelle" });
  const cadre = h("div", { class: "apercu-cadre" }, echelle);
  const zone = h("div", { class: "apercu" }, cadre);
  const ajuster = () => {
    const largeur = zone.clientWidth;
    if (!largeur || !echelle.firstChild) return;
    const s = Math.min(1, (largeur - 2) / 794);
    echelle.style.transform = `scale(${s})`;
    cadre.style.height = `${echelle.firstChild.offsetHeight * s}px`;
    cadre.style.width = `${794 * s}px`;
  };
  const redessiner = () => {
    vider(echelle).append(fabrique());
    ajuster();
  };
  new ResizeObserver(() => requestAnimationFrame(ajuster)).observe(zone);
  redessiner();
  return { zone, redessiner };
}
