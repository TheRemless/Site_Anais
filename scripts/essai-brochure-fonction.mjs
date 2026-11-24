#!/usr/bin/env node
// Essai de la fonction « assistant », usage « brochure », telle qu'elle est déployée (24.11.2026, après le 400 de la PR 346).
// À lancer par une personne, jamais par une session automatique : l'appel est réel (Opus 5.5, quelques centimes) et compte deux appels dans la
// limite du jour de la personne.
//
// Ce qui part : une image fictive générée ici (aucune vraie brochure), puis, pour la relecture, la brochure fictive de démonstration
// (src/gestion/js/brochure-demo.mjs). Rien n'est écrit en base, sauf les deux lignes du journal de l'assistant.
//
//   GESTION_JWT=<jeton de session> node scripts/essai-brochure-fonction.mjs --entite <uuid> --partenaire <uuid> [--fichier photo.jpg]
//
// GESTION_JWT : le jeton d'accès de la personne connectée à Gestion (navigateur, outils de développement, Application > Local Storage,
// clé « sb-…-auth-token », champ « access_token »). Il expire au bout d'une heure ; il n'est ni affiché ni enregistré par ce script.
// --entite : l'entreprise (avec l'assistant allumé et les droits partenaires.lire, partenaires.ecrire, partenaires.prix).
// --partenaire : un partenaire de cette entreprise (par exemple « Transports démo » ou un partenaire d'essai).
// --fichier : facultatif, une image JPEG ou PNG à envoyer à la place de l'image fictive.
//
// Lecture du résultat : « paramètres acceptés » dès que la fonction ne rend pas detail_api avec un statut 400. Avec l'image fictive (sans
// tarif), la lecture répond normalement « invalide » (aucun tarif ni horaire) : c'est attendu et prouve que la requête passe.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { CONFIG } from "../src/gestion/js/config.mjs";
import { brochureDemoTransport } from "../src/gestion/js/brochure-demo.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, a) => (x.startsWith("--") ? [...acc, [x.slice(2), a[i + 1]]] : acc), []));
const jeton = process.env.GESTION_JWT || "";
const uuid = /^[0-9a-f-]{36}$/i;
if (!jeton || !uuid.test(args.entite || "") || !uuid.test(args.partenaire || "")) {
  console.error("Usage : GESTION_JWT=<jeton> node scripts/essai-brochure-fonction.mjs --entite <uuid> --partenaire <uuid> [--fichier photo.jpg]");
  process.exit(2);
}

// Une image PNG fictive de 320 × 200 pixels (bandes grises), écrite sans dépendance.
function pngFictif() {
  const l = 320;
  const h = 200;
  const crc = (buf) => {
    let c = ~0;
    for (const o of buf) {
      c ^= o;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const bloc = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 0; // niveaux de gris
  const brut = Buffer.alloc((l + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < l; x++) brut[y * (l + 1) + 1 + x] = Math.floor(y / 20) % 2 ? 230 : 250;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc("IHDR", ihdr), bloc("IDAT", deflateSync(brut)), bloc("IEND", Buffer.alloc(0))]);
}

const fichier = args.fichier
  ? { media_type: /\.png$/i.test(args.fichier) ? "image/png" : "image/jpeg", data: readFileSync(args.fichier).toString("base64") }
  : { media_type: "image/png", data: pngFictif().toString("base64") };

async function appeler(corps) {
  const debut = Date.now();
  const r = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${jeton}` },
    body: JSON.stringify({ usage: "brochure", entite_id: args.entite, partenaire_id: args.partenaire, fichiers: [fichier], ...corps }),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { http: r.status, secondes: Math.round((Date.now() - debut) / 100) / 10, json };
}

const resume = (nom, x) => {
  const j = x.json || {};
  const b = j.brochure;
  console.log(`\n== ${nom} : HTTP ${x.http}, ${x.secondes} s`);
  if (j.detail_api) console.log("   erreur de l'API :", JSON.stringify(j.detail_api));
  else if (j.erreur) console.log("   erreur de la fonction :", j.erreur);
  if (b) console.log(`   modèle ${j.modele} ; ${b.tarifs.length} tarif(s), ${b.trajets.length} trajet(s)${j.relecture ? ` ; relecture ${JSON.stringify(j.relecture)}` : ""}`);
  const refuse = j.detail_api && j.detail_api.statut === 400;
  console.log(refuse ? "   => PARAMÈTRES REFUSÉS par l'API (400) : voir le message ci-dessus." : "   => paramètres acceptés par l'API.");
  return !refuse;
};

const lecture = await appeler({ passe: "lecture" });
const okLecture = resume("Lecture", lecture);
// La relecture repart de ce que la lecture a rendu, ou de la brochure fictive si la lecture n'a rien trouvé (image sans tarif).
const extraction = (lecture.json && lecture.json.brochure) || brochureDemoTransport();
const relecture = await appeler({ passe: "relecture", extraction });
const okRelecture = resume("Relecture", relecture);
process.exit(okLecture && okRelecture ? 0 : 1);
