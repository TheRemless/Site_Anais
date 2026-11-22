// Lecture des apprentissages de l'agent pour un prompt (22.11.2026) : onglet Assistant (agent/index.ts) et réponses préparées de WhatsApp
// (whatsapp/reponse.ts), un seul appel chacun. Les lignes viennent de l'écran (corrections de cartes, « Pas bien ») et de la fonction
// « whatsapp » (réponse préparée puis écrite autrement par Nani, apprendre-whatsapp.js).
//
// Garde-fou des montants (point D) : une ligne dont un montant est égal à un net de l'entreprise (nets du catalogue et des partenaires,
// prestations_nets et trajets_nets, même lecture que le contrôle des réponses : netsPourControle) est écartée ici, à la lecture, pour couvrir
// aussi les lignes écrites par le navigateur. Nets illisibles : toute ligne qui contient un montant est écartée (on ferme, jamais l'inverse).
// Les nets restent dans la fonction : ils ne partent jamais chez Claude. Les apprentissages ne vont que dans le prompt (prompt.js,
// blocApprentissages) ; ils ne servent jamais à entraîner un modèle.
import { montantsDuTexte, netsPourControle } from "./outils.js";
import { APPRIS_LUS_ACTIVE, APPRIS_LUS_AUTRE, apprentissagesUnifies } from "./prompt.js";
import { tableAbsente } from "../assistant/budget.js";

export const COLONNES_APPRIS = "id, genre, contexte, avant, apres, cree_le";
// Ce qui sert à une réponse au client (boîte WhatsApp, revue de sécurité) : jamais une remarque de service (notes internes) ni un « Pas bien »
// sur une réponse de l'agent à l'équipe (qui peut parler de nets ou de marges) ; seulement un « Pas bien » sur une réponse au client.
export const GENRES_POUR_CLIENT = ["reponse", "pickup", "lieu", "date", "libelle", "prix", "retour"];
export const RETOUR_REPONSE_CLIENT = "réponse au client";
export const pourUnClient = (l) => !!l && GENRES_POUR_CLIENT.includes(l.genre) && (l.genre !== "retour" || String(l.contexte || "").startsWith(RETOUR_REPONSE_CLIENT));

// Les montants d'une ligne d'apprentissage (contexte, avant, après), champ par champ et morceau par morceau (« … / … ») : collés, deux
// nombres se liraient comme un téléphone et disparaîtraient. En plus de la lecture du contrôle (montantsDuTexte), tout nombre de 100 ou
// plus écrit en chiffres, séparateurs de milliers compris : le filtre préfère écarter une ligne de trop.
export function montantsDe(l) {
  const out = [];
  for (const champ of [l && l.contexte, l && l.avant, l && l.apres])
    for (const morceau of String(champ || "").split(/\s+\/\s+|\n+/)) {
      out.push(...montantsDuTexte(morceau));
      for (const m of morceau.matchAll(/\d{1,3}(?:[ ,.'’\u00a0\u202f]\d{3})+(?!\d)|\d+/g)) {
        const n = Number(m[0].replace(/\D/g, ""));
        if (n >= 100) out.push(n);
      }
    }
  return out;
}

// Les lignes sans aucun montant égal à un net. `nets` : la liste rendue par netsPourControle ({ montant, … }) ou un ensemble de nombres.
// `erreur` : nets illisibles, une ligne qui contient un montant (même illisible, lu 0) est écartée.
export function sansNets(lignes = [], { nets = [], erreur = false } = {}) {
  const valeurs = new Set([...(nets instanceof Set ? nets : (nets || []).map((n) => (n && typeof n === "object" ? n.montant : n)))].map(Number).filter((n) => n > 0));
  return (lignes || []).filter((l) => {
    const m = montantsDe(l);
    if (erreur) return m.length === 0;
    return !m.some((n) => n === 0 || valeurs.has(n));
  });
}

// Lit et filtre. `db` : le client qui lit les lignes (la session de la personne dans l'Assistant, sous RLS ; la clé de service dans la boîte
// WhatsApp). `dbNets` : le client à la clé de service qui lit les nets (le même que `db` dans la boîte). `active` et `autre` : { id, nom }
// (autre : l'autre entreprise de l'espace unifié, ou null). `jusqua` : seulement les lignes d'avant cette date (ouverture de la
// conversation de l'Assistant). `limite` : lignes lues de l'entreprise active sans l'espace unifié. `nets` : déjà lus par l'appelant
// ({ nets, erreur } de netsPourControle), sinon lus ici. `pourClient` : la boîte WhatsApp, seulement les lignes utiles à une réponse au
// client (pourUnClient).
// Rend { lignes, erreur } : erreur vraie si la lecture a échoué (table absente comprise : rien, l'agent marche comme avant).
export async function lireApprentissages(db, { dbNets = db, active, autre = null, jusqua = null, limite = 80, nets = null, pourClient = false } = {}) {
  if (!db || !active || !active.id) return { lignes: [], erreur: true };
  const avant = (q) => (jusqua ? q.lte("cree_le", jusqua) : q);
  const [lus, lusAutre, lusNets] = await Promise.all([
    avant(db.from("agent_apprentissages").select(COLONNES_APPRIS).eq("entite_id", active.id)).order("cree_le", { ascending: false }).limit(autre ? APPRIS_LUS_ACTIVE : limite),
    autre ? avant(db.from("agent_apprentissages").select(COLONNES_APPRIS).eq("entite_id", autre.id).eq("genre", "reponse")).order("cree_le", { ascending: false }).limit(APPRIS_LUS_AUTRE) : Promise.resolve(null),
    nets ? Promise.resolve(nets) : netsPourControle(dbNets, [active.id, ...(autre ? [autre.id] : [])]),
  ]);
  if (lus.error) {
    if (!tableAbsente(lus.error)) console.error("agent : apprentissages", lus.error.message);
    return { lignes: [], erreur: true };
  }
  const filtre = { nets: (lusNets && lusNets.nets) || [], erreur: !lusNets || !!lusNets.erreur };
  const actives = sansNets((lus.data || []).filter((l) => !pourClient || pourUnClient(l)), filtre);
  const autres = lusAutre && !lusAutre.error ? sansNets(lusAutre.data || [], filtre) : [];
  return { lignes: autre ? apprentissagesUnifies({ actives, autres, nomActive: active.nom || "", nomAutre: autre.nom || "" }) : actives, erreur: false };
}
