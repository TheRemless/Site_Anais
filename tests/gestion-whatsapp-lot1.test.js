// Lot 1 des audits du 20.11.2026 (validé par Jérémy) : dev B2, sécurité n° 1 et n° 7, dev I3.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { iaPermise, MOTIFS, triGarde } from "../supabase/functions/whatsapp/proposer.js";
import { mediaApresErreur, erreurPassagere, resteACopier, ESSAIS_MEDIA } from "../supabase/functions/whatsapp/calc.js";
import * as W from "../src/gestion/js/whatsapp-calc.mjs";

const lire = (chemin) => fs.readFileSync(new URL(`../${chemin}`, import.meta.url), "utf8");

test("sécurité n° 1 : rien chez Anthropic, même le tri, si la réception est suspendue, le contact sur Jamais ou l'assistant éteint", () => {
  const S = "secret-id";
  const T = "taxi-id";
  const rangee = { entite_id: S, reponses: "auto" };
  const aTrier = { entite_id: null, reponses: "auto" };
  assert.equal(iaPermise({ receptionActive: true, conv: rangee, agents: { [S]: true, [T]: false } }), true);
  assert.equal(iaPermise({ receptionActive: true, conv: rangee, agents: { [S]: false, [T]: true } }), false, "l'assistant de son entreprise compte, pas l'autre");
  assert.equal(iaPermise({ receptionActive: true, conv: rangee, agents: {} }), false, "réglage absent : fermé");
  assert.equal(iaPermise({ receptionActive: true, conv: aTrier, agents: { [S]: false, [T]: true } }), true, "à trier : une des deux suffit");
  assert.equal(iaPermise({ receptionActive: true, conv: aTrier, agents: { [S]: false, [T]: false } }), false);
  assert.equal(iaPermise({ receptionActive: false, conv: rangee, agents: { [S]: true } }), false, "réception suspendue");
  assert.equal(iaPermise({ receptionActive: undefined, conv: rangee, agents: { [S]: true } }), false, "réception illisible : fermé");
  assert.equal(iaPermise({ receptionActive: true, conv: { ...rangee, reponses: "jamais" }, agents: { [S]: true } }), false, "contact sur Jamais");
  assert.equal(iaPermise({ receptionActive: true, conv: null, agents: { [S]: true } }), false);
  // Le motif est gardé tel quel et a son libellé à l'écran.
  assert.ok(MOTIFS.includes("ia_coupee"));
  assert.equal(triGarde({ preparer: false, motif: "ia_coupee" }).motif, "ia_coupee");
  assert.ok(W.MOTIFS_TRI.ia_coupee);
  // Le contrôle passe avant l'appel du tri, et le suivi (résumé, promesse) le reprend.
  const rep = lire("supabase/functions/whatsapp/reponse.ts");
  const apres = rep.slice(rep.indexOf("export async function apresMessageClient"), rep.indexOf("export async function preparerALaDemande"));
  assert.ok(apres.indexOf("iaOuverte(db, conv)") > 0 && apres.indexOf("iaOuverte(db, conv)") < apres.indexOf("parametresTri("), "contrôle avant le tri");
  const ouverte = rep.slice(rep.indexOf("export async function iaOuverte"), rep.indexOf("// L'entreprise de la conversation (ou celle suggérée"));
  assert.match(ouverte, /whatsapp_reglages/);
  assert.match(ouverte, /if \(recep\.error \|\| ents\.error \|\| !recep\.data\) return false/);
  assert.match(ouverte, /if \(regl\.error\) return false/);
  assert.match(lire("supabase/functions/whatsapp/suivi.ts"), /iaOuverte\(db, conv as any\)/);
});

test("sécurité n° 7 : envoyer et préparer refusent sur toute erreur du contrôle d'écriture", () => {
  for (const f of ["whatsapp-envoi", "whatsapp-preparer"]) {
    const code = lire(`supabase/functions/${f}/index.ts`);
    assert.match(code, /if \(peut\.error \|\| peut\.data !== true\) return json\(\{ erreur: "droit_manquant" \}, 403\);/, f);
    assert.doesNotMatch(code, /PGRST202\|42883/, `${f} : plus de repli qui ouvre`);
  }
});

test("dev I3 : un média en erreur passagère garde sa source et sera repris, échec seulement sur 4xx ou au 3e essai", () => {
  const m = { type: "video", source_url: "https://media.telnyx.com/v", source_id: null, statut: "a_copier" };
  assert.equal(ESSAIS_MEDIA, 3);
  for (const http of [null, 408, 429, 500, 503]) assert.equal(erreurPassagere(http), true, String(http));
  for (const http of [400, 401, 403, 404, 410]) assert.equal(erreurPassagere(http), false, String(http));
  const un = mediaApresErreur(m, { erreur: "signal timed out" });
  assert.equal(un.statut, "a_copier");
  assert.equal(un.essais, 1);
  assert.equal(un.source_url, m.source_url, "la source reste");
  const deux = mediaApresErreur(un, { http: 503 });
  assert.equal(deux.statut, "a_copier");
  assert.equal(deux.essais, 2);
  const trois = mediaApresErreur(deux, { http: 503 });
  assert.equal(trois.statut, "echec");
  assert.equal(trois.essais, 3);
  assert.equal(trois.source_url, undefined, "en échec, la source part");
  const expire = mediaApresErreur(m, { http: 404 });
  assert.equal(expire.statut, "echec");
  assert.equal(expire.erreur, "http_404");
  assert.equal(resteACopier([trois, un]), true);
  assert.equal(resteACopier([trois, expire]), false);
  // La copie lève une erreur tant qu'un média reste à copier : l'événement est repris (essais + 1) et seuls ces médias sont recopiés.
  const idx = lire("supabase/functions/whatsapp/index.ts");
  const copie = idx.slice(idx.indexOf("async function copierMedias"), idx.indexOf("async function avecCle"));
  assert.match(copie, /resultat\.push\(mediaApresErreur\(m, \{ http: rep\.status \}\)\)/);
  assert.match(copie, /if \(resteACopier\(resultat\)\) throw new Error\("medias_a_reprendre"\)/);
  assert.ok(copie.indexOf('update({ medias: resultat })') < copie.indexOf("medias_a_reprendre"), "l'état des médias est écrit avant de lever");
  assert.doesNotMatch(copie, /statut: "echec", erreur: `http_/);
});

test("dev B2 : une réponse retouchée ne fige plus l'écran, pas de « lu » tant qu'un redessin attend, copie contrôlée", () => {
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  assert.match(vue, /\{ class: "wa-prop", "aria-label": tr\("Réponse préparée"\), "data-pas-saisie": "" \}/);
  const copier = vue.slice(vue.indexOf("async function copier("), vue.indexOf("// Marquer traitée ou ignorer"));
  assert.ok(copier.indexOf("toujoursCourante(c, p)") < copier.indexOf("versPressePapiers("), "contrôle avant la copie (lot 2 : presse-papiers avec repli)");
  assert.match(vue, /copier\(c, p, zone, e\.currentTarget\)/);
  const visibilite = vue.slice(vue.indexOf("function suivreVisibilite"), vue.indexOf("// ---- Écran"));
  assert.ok(visibilite.indexOf("if (etat.redessinEnAttente ||") > 0 && visibilite.indexOf("if (etat.redessinEnAttente ||") < visibilite.indexOf("marquerLue("), "pas de lu tant qu'un redessin attend");
  assert.ok(visibilite.indexOf("affiche.dernier !== (c.dernier_message_le || null)") < visibilite.indexOf("marquerLue("), "ni si un message est arrivé depuis le rendu");
  assert.match(vue, /affiche = vue \? \{ id: idOuvert, dernier: vue\.dernier_message_le \|\| null \} : null;/);
  assert.match(vue, /zone\.toggleAttribute\("data-brouillon", brouillons\.has\(p\.id\)\)/);
  const app = lire("src/gestion/js/app.mjs");
  assert.match(app, /const retenir = \(v\) => void \(\(aRedessiner = v\), \(etat\.redessinEnAttente = v\)\);/);
  assert.doesNotMatch(app, /[^t] aRedessiner = (true|false);/, "toute écriture passe par retenir()");
  assert.match(app, /if \(document\.querySelector\("#principal \[data-brouillon\]"\)\) return false;/, "un brouillon empêche le rechargement automatique");
  // Le curseur dans le champ retient toujours le redessin.
  assert.match(app, /function ecranLibre\(\) \{\n\s+return ecranDeLecture\(location\.hash\) && !saisieEnCours\(\) && !document\.querySelector\("\.modal-fond"\) && !curseurDansUnChamp\(\);/);
});
