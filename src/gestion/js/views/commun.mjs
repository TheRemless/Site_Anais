import { h } from "../ui.mjs";
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
