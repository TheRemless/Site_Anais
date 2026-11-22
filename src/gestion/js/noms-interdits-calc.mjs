// Noms qui ne partent jamais vers un client, partagés par le point du soir (PR 308) et « Proposer une excursion » (PR 310). Une seule
// fonction depuis la branche d'intégration du 22.11.2026 ; chaque écran garde sa règle par ses options (comportement inchangé).
//  - fiches partenaires : plus de deux lettres, comme nomsABloquer de la fonction agent ;
//  - conversations WhatsApp retenues par `contactInterdit` (règle de l'écran) ;
//  - `client` (sa fiche) : son propre nom n'est jamais retiré du message qu'on lui écrit ;
//  - `nomsCourts` : chaque nom vient aussi sans « co, ltd, company, the, tour, tours, travel, koh, lanta » quand il garde quatre lettres,
//    comme partenairesCites du serveur (« Blue Ocean Co., Ltd » bloque « Blue Ocean »).
// Le lien wa.me et la copie ne passent par aucun contrôle du serveur : l'écran les vérifie.
export const sansAccents = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const MOTS_SOCIETE = new Set(["co", "ltd", "company", "the", "tour", "tours", "travel", "koh", "lanta"]);
export const nomCourt = (n) => sansAccents(n).replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !MOTS_SOCIETE.has(w)).join(" ");

export function nomsInterdits({ partenaires = [], conversations = [], client = null, contactInterdit = () => false, nomsCourts = false } = {}) {
  const brut = [...(partenaires || []).map((p) => p && p.nom), ...(conversations || []).filter((c) => c && contactInterdit(c)).map((c) => c.nom)]
    .map((n) => String(n || "").trim())
    .filter((n) => n.length > 2);
  const siens = new Set([client && client.prenom, client && client.nom, client && [client.prenom, client.nom].filter(Boolean).join(" ")].map((n) => sansAccents(n).trim()).filter(Boolean));
  const out = [];
  for (const n of brut) {
    if (siens.has(sansAccents(n).trim())) continue;
    out.push(n);
    if (!nomsCourts) continue;
    const c = nomCourt(n);
    if (c.length >= 4 && c !== sansAccents(n).replace(/[^a-z0-9]+/g, " ").trim() && !siens.has(c)) out.push(c);
  }
  return [...new Set(out)];
}
