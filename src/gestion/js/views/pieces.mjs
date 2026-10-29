// Pièces jointes d'un dossier : fichiers envoyés dans un stockage privé, téléchargés par un lien temporaire.
import { peut, piecesDossier, ajouterPiece, lienPiece, supprimerPiece } from "../etat.mjs";
import { h, toast, confirmer, vider } from "../ui.mjs";
import { formatDate } from "../calc.mjs";
import { tr } from "../i18n.mjs";

const taille = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", tr(","))} ${tr("Mo")}` : `${Math.max(1, Math.round(n / 1024))} ${tr("Ko")}`);

export function sectionPieces(dossier) {
  const liste = h("div");
  const etatCharge = h("p", { class: "aide", "aria-live": "polite" }, tr("Chargement…"));
  const peutEcrire = peut("dossiers.ecrire");

  async function dessiner() {
    let pieces;
    try {
      pieces = await piecesDossier(dossier.id);
    } catch (err) {
      vider(liste).append(h("p", { class: "erreur-form", role: "alert" }, tr("Impossible de lire les pièces jointes : {message}", { message: err.message })));
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
                h("div", null, h("strong", null, p.nom), h("span", { class: "sous-ligne" }, tr("{taille} · ajouté le {date}", { taille: taille(p.taille || 0), date: formatDate(p.created_at) }))),
                h(
                  "span",
                  null,
                  h("button", { class: "secondaire petit", type: "button", onclick: async () => { try { const url = await lienPiece(p); const a = h("a", { href: url, download: p.nom, target: "_blank", rel: "noopener" }); document.body.append(a); a.click(); a.remove(); } catch (err) { toast(tr("Téléchargement impossible : {message}", { message: err.message }), true); } } }, tr("Télécharger")),
                  peutEcrire ? h("button", { class: "lien danger-texte", type: "button", onclick: async () => { if (await confirmer(tr("Supprimer « {nom} » ?", { nom: p.nom }), tr("Supprimer"), true)) { await supprimerPiece(p); dessiner(); } } }, tr("Supprimer")) : null
                )
              )
            )
          )
        : h("p", { class: "vide-court" }, tr("Aucune pièce jointe."))
    );
  }

  const envoi = peutEcrire
    ? h("div", { class: "champ" }, h("label", { for: "piece-fichier" }, tr("Ajouter des fichiers")), h("input", {
        id: "piece-fichier",
        type: "file",
        multiple: true,
        onchange: async (e) => {
          const fichiers = [...e.target.files];
          e.target.value = "";
          for (const f of fichiers) {
            etatCharge.textContent = tr("Envoi de {name}…", { name: f.name });
            try {
              await ajouterPiece(dossier.id, f);
              toast(tr("« {name} » ajouté.", { name: f.name }));
            } catch (err) {
              toast(`${f.name} : ${err.message}`, true);
            }
          }
          etatCharge.textContent = "";
          dessiner();
        },
      }), h("p", { class: "aide" }, tr("10 Mo au plus par fichier. Les fichiers sont privés : seules les personnes qui ont accès au dossier peuvent les télécharger.")))
    : null;
  dessiner().then(() => (etatCharge.textContent = ""));
  return h("section", null, h("h2", null, tr("Pièces jointes")), liste, etatCharge, envoi);
}
