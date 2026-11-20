// Agent de Gestion : la boucle d'outils d'un échange (un message de la personne). Sans dépendance : le client Anthropic, la base et
// l'écran sont passés en paramètres. Le même code sert à la fonction Supabase (index.ts) et au jeu d'essai (scripts/eval-agent).
import { DUREE_MAX_MS, TOURS_MAX, parametres, texteVisible } from "./prompt.js";
import { executer, outilsPour } from "./outils.js";

// anthropic : le client du SDK (anthropic.beta.messages.stream).
// messages  : l'historique au format de l'API, complété en place (message de la personne déjà ajouté par l'appelant).
// garder(role, contenu) : ajoute un message à l'historique et le garde en base (lève une erreur si la base refuse).
// garderCarte(carte)    : enregistre une proposition et la rend avec son identifiant, ou null.
// envoyer(evenement)    : vers l'écran (texte au fil de l'eau, étape, frise, carte, erreur).
// Rend { statut, dernierTexte } ; les erreurs du SDK remontent à l'appelant, qui les classe.
// outils : facultatif, la liste envoyée à Claude (celle des droits par défaut). Passée, elle borne aussi l'exécution : un outil absent de
// la liste est refusé, même si le modèle l'appelle.
export async function tourner({ anthropic, modele, systeme, appris = "", contexte, messages, ctx, memo, garder, garderCarte, envoyer, appels, debut = Date.now(), maintenant = () => Date.now(), outils }) {
  let statut = "ok";
  let dernierTexte = "";
  for (let tour = 0; tour < TOURS_MAX; tour++) {
    if (maintenant() - debut > DUREE_MAX_MS) {
      await envoyer({ t: "erreur", erreur: "trop_long" });
      return { statut: "trop_long", dernierTexte };
    }
    // La boîte WhatsApp passe sa propre liste (outils) : elle remplace celle des droits.
    const stream = anthropic.beta.messages.stream(parametres({ modele, systeme, appris, contexte, messages, outils: outilsPour((ctx && ctx.permissions) || []), ...(outils ? { outils } : {}) }));
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") await envoyer({ t: "texte", delta: ev.delta.text });
    }
    const reponse = await stream.finalMessage();
    appels.push({ usage: reponse.usage, modele: reponse.model });
    // Le contenu tel quel (blocs de réflexion compris) : il repart à l'identique au tour suivant.
    await garder("assistant", reponse.content);
    const visible = texteVisible(reponse.content);
    if (visible) dernierTexte = visible;
    // Un refus arrive en HTTP 200 : on regarde stop_reason avant le contenu.
    if (reponse.stop_reason === "refusal") {
      await envoyer({ t: "erreur", erreur: "refus" });
      return { statut: "refus", dernierTexte };
    }
    const appelsOutils = reponse.content.filter((b) => b.type === "tool_use");
    if (reponse.stop_reason === "max_tokens") {
      // Un appel d'outil coupé n'est jamais exécuté ; l'historique reste valide avec une réponse d'erreur.
      if (appelsOutils.length) await garder("user", appelsOutils.map((b) => ({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify({ erreur: "coupe" }), is_error: true })));
      await envoyer({ t: "erreur", erreur: "coupe" });
      return { statut: "coupe", dernierTexte };
    }
    if (reponse.stop_reason !== "tool_use" || !appelsOutils.length) break;
    // Les outils d'un même tour s'exécutent ensemble ; leurs résultats repartent dans un seul message.
    const resultats = await Promise.all(
      appelsOutils.map(async (b) => {
        if (outils && !outils.some((o) => o.name === b.name)) return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify({ erreur: "outil_non_permis" }), is_error: true };
        await envoyer({ t: "etape", outil: b.name });
        const r = await executer(b.name, b.input, ctx, memo);
        if (r.panne) console.error("agent : outil", b.name, r.panne);
        if (r.planning) await envoyer({ t: "planning", planning: r.planning });
        if (r.carte) {
          const c = await garderCarte(r.carte);
          if (!c) return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify({ erreur: "carte_non_enregistree" }), is_error: true };
          await envoyer({ t: "carte", carte: c });
        }
        return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify(r.contenu), ...(r.erreur ? { is_error: true } : {}) };
      })
    );
    await garder("user", resultats);
  }
  return { statut, dernierTexte };
}
