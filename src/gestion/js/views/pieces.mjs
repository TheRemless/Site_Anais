// Pièces jointes d'un dossier : fichiers envoyés dans un stockage privé, téléchargés par un lien temporaire.
import { peut, piecesDossier, ajouterPiece, lienPiece, supprimerPiece } from "../etat.mjs";
import { h, toast, confirmer, vider } from "../ui.mjs";
import { formatDate } from "../calc.mjs";

const taille = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

export function sectionPieces(dossier) {
  const liste = h("div");
  const etatCharge = h("p", { class: "aide", "aria-live": "polite" }, "Chargement…");
  const peutEcrire = peut("dossiers.ecrire");

  async function dessiner() {
    let pieces;
    try {
      pieces = await piecesDossier(dossier.id);
    } catch (err) {
      vider(liste).append(h("p", { class: "erreur-form", role: "alert" }, `Impossible de lire les pièces jointes : ${err.message}`));
      return;
    }
    vider(liste).append(
      pieces.length
        ? h(
            "ul",
            { class: "pieces-liste" },
            pieces.map((p) =>
              h(
                "li",
                { class: "piece" },
                h("div", null, h("strong", null, p.nom), h("span", { class: "sous-ligne" }, `${taille(p.taille || 0)} · ajouté le ${formatDate(p.created_at)}`)),
                h(
                  "span",
                  null,
                  h("button", { class: "secondaire petit", type: "button", onclick: async () => { try { const url = await lienPiece(p); const a = h("a", { href: url, download: p.nom, target: "_blank", rel: "noopener" }); document.body.append(a); a.click(); a.remove(); } catch (err) { toast(`Téléchargement impossible : ${err.message}`, true); } } }, "Télécharger"),
                  peutEcrire ? h("button", { class: "lien danger-texte", type: "button", onclick: async () => { if (await confirmer(`Supprimer « ${p.nom} » ?`, "Supprimer", true)) { await supprimerPiece(p); dessiner(); } } }, "Supprimer") : null
                )
              )
            )
          )
        : h("p", { class: "vide-court" }, "Aucune pièce jointe.")
    );
  }

  const envoi = peutEcrire
    ? h("div", { class: "champ" }, h("label", { for: "piece-fichier" }, "Ajouter des fichiers"), h("input", {
        id: "piece-fichier",
        type: "file",
        multiple: true,
        onchange: async (e) => {
          const fichiers = [...e.target.files];
          e.target.value = "";
          for (const f of fichiers) {
            etatCharge.textContent = `Envoi de ${f.name}…`;
            try {
              await ajouterPiece(dossier.id, f);
              toast(`« ${f.name} » ajouté.`);
            } catch (err) {
              toast(`${f.name} : ${err.message}`, true);
            }
          }
          etatCharge.textContent = "";
          dessiner();
        },
      }), h("p", { class: "aide" }, "10 Mo au plus par fichier. Les fichiers sont privés : seules les personnes qui ont accès au dossier peuvent les télécharger."))
    : null;
  dessiner().then(() => (etatCharge.textContent = ""));
  return h("section", null, h("h2", null, "Pièces jointes"), liste, etatCharge, envoi);
}
