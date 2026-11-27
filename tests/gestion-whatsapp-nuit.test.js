// tests/gestion-whatsapp-nuit.test.js : message automatique de nuit sur le WhatsApp de Nani (migration 132, demande de Jérémy du 27.11.2026).
// La base décide (docs/gestion/verif-whatsapp-message-nuit.mjs le vérifie sur PGlite) ; ici la logique pure, le texte mot pour mot, le
// branchement dans la fonction « whatsapp » et l'écran de réglage.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEXTE_NUIT, DEBUT_NUIT, FIN_NUIT, cleDeNuit, heureBangkok, minutes, resultatTelnyx, lireReglageNuit, reglageNuit } from "../supabase/functions/whatsapp/nuit.js";
import { avecAutomatique, sansAutomatiques, estAutomatique } from "../supabase/functions/whatsapp/automatique.js";
import { aRepondre } from "../supabase/functions/whatsapp/proposer.js";
import { resumeAFaire } from "../supabase/functions/whatsapp/suivi.js";
import { montantsClientValides } from "../supabase/functions/agent/outils.js";
import { texteDepuisWhatsApp } from "../supabase/functions/agent/whatsapp.js";
import { lireConversation as lireConversationAgent } from "../supabase/functions/agent/whatsapp-lecture.js";
import { apercuDepuisMessages } from "../src/gestion/js/whatsapp-calc.mjs";
import { envoiEnDoute, statutEnvoi } from "../src/gestion/js/whatsapp-fiabilite-calc.mjs";

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const lire = (f) => fs.readFileSync(path.join(RACINE, f), "utf8");
const MIGRATION = lire("docs/gestion/migration-132-whatsapp-message-nuit.sql");
const RETOUR = lire("docs/gestion/retour-132-whatsapp-message-nuit.sql");

// Le texte de la demande du 27.11.2026, recopié ici une troisième fois : aucune des deux copies du code ne peut dériver sans que ce test le voie.
const DEMANDE = [
  "🌴 Hello and thank you for contacting us !",
  "",
  "Our team is currently away, but we’ll get back to you as soon as possible around 7:00 AM (Thailand time).",
  "",
  "In the meantime, please feel free to send us all the details of your request so we can assist you more efficiently.",
  "",
  "The more details you share, the more accurately we can assist you when we get back to you !",
  "",
  "Thank you for your patience. We look forward to helping you discover Thailand ! \u{1F1F9}\u{1F1ED}🌴",
].join("\n");

test("le texte est celui de Jérémy, mot pour mot, dans le code et dans la migration", () => {
  assert.equal(TEXTE_NUIT, DEMANDE);
  assert.ok(TEXTE_NUIT.includes("we’ll"), "apostrophe typographique");
  assert.equal((TEXTE_NUIT.match(/ !/g) || []).length, 3, "trois espaces avant « ! »");
  // Correction de Jérémy du 27.11.2026 : un point, pas un deux-points, après « efficiently ».
  assert.ok(TEXTE_NUIT.includes("assist you more efficiently.\n") && !TEXTE_NUIT.includes("efficiently:"));
  const sql = /function whatsapp_nuit_texte_defaut\(\) returns text[^$]*\$\$\n  select \$nuit\$([\s\S]*?)\$nuit\$::text/.exec(MIGRATION);
  assert.match(MIGRATION, /nuit_texte text not null default whatsapp_nuit_texte_defaut\(\);/);
  assert.ok(sql, "défaut du texte dans la migration");
  assert.equal(sql[1], DEMANDE);
  assert.equal(DEBUT_NUIT, "22:00");
  assert.equal(FIN_NUIT, "06:00");
  assert.match(MIGRATION, /nuit_debut time not null default '22:00'/);
  assert.match(MIGRATION, /nuit_fin time not null default '06:00'/);
  assert.match(MIGRATION, /nuit_active boolean not null default true/);
});

test("l'écran utilise une copie exacte de la logique de la fonction", () => {
  assert.equal(lire("src/gestion/js/whatsapp-nuit-calc.mjs"), lire("supabase/functions/whatsapp/nuit.js"));
});

test("heure de Bangkok : bornes 21:59, 22:00, 05:59, 06:00 et clé de nuit", () => {
  const b = (iso) => cleDeNuit(new Date(iso));
  assert.equal(b("2026-11-27T21:59:00+07:00"), null);
  assert.equal(b("2026-11-27T21:59:59+07:00"), null);
  assert.equal(b("2026-11-27T22:00:00+07:00"), "2026-11-27");
  assert.equal(b("2026-11-27T23:59:00+07:00"), "2026-11-27");
  assert.equal(b("2026-11-28T00:00:00+07:00"), "2026-11-27", "minuit appartient à la nuit d'avant");
  assert.equal(b("2026-11-28T01:00:00+07:00"), "2026-11-27", "01:00 le 28 : nuit du 27");
  assert.equal(b("2026-11-28T05:59:00+07:00"), "2026-11-27");
  assert.equal(b("2026-11-28T05:59:59+07:00"), "2026-11-27");
  assert.equal(b("2026-11-28T06:00:00+07:00"), null);
  assert.equal(b("2026-11-28T12:00:00+07:00"), null, "aucune réponse en journée");
  assert.equal(b("2026-11-28T18:30:00+07:00"), null);
});

test("heure de Bangkok : fuseau, passage de mois et d'année, plages réglées autrement", () => {
  assert.equal(cleDeNuit("2026-11-27T15:00:00Z"), "2026-11-27", "15:00 UTC = 22:00 à Bangkok");
  assert.equal(cleDeNuit("2026-11-27T14:59:00Z"), null);
  assert.equal(cleDeNuit("2026-11-27T22:30:00Z"), "2026-11-27", "22:30 UTC = 05:30 le 28 à Bangkok");
  assert.equal(cleDeNuit("2026-11-27T23:00:00Z"), null, "23:00 UTC = 06:00 à Bangkok");
  assert.equal(cleDeNuit("2026-12-01T02:00:00+07:00"), "2026-11-30");
  assert.equal(cleDeNuit("2027-01-01T03:00:00+07:00"), "2026-12-31");
  assert.equal(cleDeNuit("2028-03-01T03:00:00+07:00"), "2028-02-29", "année bissextile");
  assert.equal(cleDeNuit("2026-11-27T21:30:00+07:00", "21:30", "06:30"), "2026-11-27");
  assert.equal(cleDeNuit("2026-11-28T06:29:00+07:00", "21:30", "06:30"), "2026-11-27");
  assert.equal(cleDeNuit("2026-11-28T06:30:00+07:00", "21:30", "06:30"), null);
  assert.equal(cleDeNuit("2026-11-28T03:00:00+07:00", "01:00", "05:00"), "2026-11-28", "plage sans minuit : la date du jour");
  assert.equal(cleDeNuit("2026-11-28T00:30:00+07:00", "01:00", "05:00"), null);
  assert.equal(cleDeNuit("2026-11-28T03:00:00+07:00", "22:00", "22:00"), null, "début égal à la fin : jamais");
  assert.equal(cleDeNuit("pas une date"), null);
  assert.equal(cleDeNuit("2026-11-28T03:00:00+07:00", "25:00", "06:00"), null);
  assert.deepEqual(heureBangkok("2026-11-27T17:05:00Z"), { date: "2026-11-28", minutes: 5 });
  assert.equal(minutes("22:00"), 1320);
  assert.equal(minutes("22:00:00"), 1320);
  assert.equal(minutes("06:00"), 360);
  assert.equal(minutes("24:00"), null);
});

test("la migration et le code suivent la même règle de nuit", () => {
  assert.match(MIGRATION, /p_quand at time zone 'Asia\/Bangkok'/);
  assert.match(MIGRATION, /when l::time >= p_debut then l::date when l::time < p_fin then \(l::date - 1\)/);
  // Message de la nuit, et encore cette nuit : un message de 05:59 rangé à 06:01 n'appelle aucune réponse.
  assert.match(MIGRATION, /nuit is distinct from whatsapp_nuit_cle\(now\(\), r\.nuit_debut, r\.nuit_fin\) then motif := 'nuit_finie'/);
});

test("réponse de Telnyx : parti, refus sûr (repris), incertain (jamais renvoyé)", () => {
  assert.deepEqual(resultatTelnyx(200, { data: { id: "tx-1" } }), { resultat: "envoye", id: "tx-1" });
  assert.equal(resultatTelnyx(200, {}).resultat, "incertain", "2xx illisible : peut-être parti");
  assert.equal(resultatTelnyx(500, null).resultat, "incertain");
  assert.equal(resultatTelnyx(503, null).resultat, "incertain");
  assert.equal(resultatTelnyx(0, null, { exception: true }).resultat, "incertain", "délai dépassé");
  const refus = resultatTelnyx(422, { errors: [{ code: "40008", detail: "secret" }] });
  assert.deepEqual(refus, { resultat: "echec", erreur: "telnyx_refuse 40008" });
  assert.equal(resultatTelnyx(429, null).resultat, "echec");
  assert.equal(resultatTelnyx(400, { errors: [{ code: "<script>" }] }).erreur, "telnyx_refuse script", "code nettoyé");
});

test("formulaire de réglage : contrôles avant l'envoi au serveur", () => {
  assert.deepEqual(lireReglageNuit({ active: true, texte: "Hi !", debut: "22:00", fin: "06:00" }), { ok: true, valeurs: { active: true, texte: "Hi !", debut: "22:00", fin: "06:00" } });
  assert.equal(lireReglageNuit({ active: false, texte: "Hi", debut: "22:00", fin: "06:00" }).valeurs.active, false, "réglage coupé");
  assert.equal(lireReglageNuit({ texte: "a\r\nb", debut: "22:00", fin: "06:00" }).valeurs.texte, "a\nb");
  assert.equal(lireReglageNuit({ texte: "   ", debut: "22:00", fin: "06:00" }).erreur, "Le message ne peut pas être vide.");
  assert.equal(lireReglageNuit({ texte: "é".repeat(2049), debut: "22:00", fin: "06:00" }).erreur, "Le message est trop long pour WhatsApp (4 096 octets au plus).");
  assert.ok(lireReglageNuit({ texte: TEXTE_NUIT, debut: "22:00", fin: "06:00" }).ok, "le texte d'origine tient dans la limite");
  assert.equal(lireReglageNuit({ texte: "Hi", debut: "", fin: "06:00" }).erreur, "Indiquez les heures au format 22:00.");
  assert.equal(lireReglageNuit({ texte: "Hi", debut: "22:00", fin: "22:00" }).erreur, "L'heure de début et l'heure de fin doivent être différentes.");
  // Relecture de la PR 364 (M1) : 12 heures au plus, sinon le message partirait le jour.
  const trop = "La plage dure plus de 12 heures : le message partirait aussi le jour. Vérifiez l'heure de début et l'heure de fin.";
  assert.equal(lireReglageNuit({ texte: "Hi", debut: "06:00", fin: "22:00" }).erreur, trop);
  assert.equal(lireReglageNuit({ texte: "Hi", debut: "18:00", fin: "07:00" }).erreur, trop);
  assert.ok(lireReglageNuit({ texte: "Hi", debut: "18:00", fin: "06:00" }).ok, "12 heures pile");
  assert.ok(lireReglageNuit({ texte: "Hi", debut: "01:00", fin: "05:00" }).ok);
  assert.match(MIGRATION, /whatsapp_nuit_minutes\(p_debut, p_fin\) > 720 then raise exception 'plage_trop_longue'/);
  assert.match(MIGRATION, /check \(whatsapp_nuit_plage_valide\(nuit_debut, nuit_fin\)\) not valid;/);
  // Relecture n° 2 : la nuit, pas seulement 12 heures (08:00 à 20:00 refusé), même règle à l'écran et en base.
  const nuitPlage = "La plage doit être la nuit : le début et la fin entre 18:00 et 08:00.";
  assert.equal(lireReglageNuit({ texte: "Hi", debut: "08:00", fin: "20:00" }).erreur, nuitPlage);
  assert.equal(lireReglageNuit({ texte: "Hi", debut: "12:00", fin: "17:00" }).erreur, nuitPlage);
  // Relecture n° 3 : chaque borne la nuit.
  for (const [d, f] of [["12:00", "00:00"], ["13:00", "01:00"], ["23:00", "11:00"], ["08:30", "18:00"]]) assert.equal(lireReglageNuit({ texte: "Hi", debut: d, fin: f }).erreur, nuitPlage, `${d} à ${f}`);
  for (const [d, f] of [["22:00", "06:00"], ["20:00", "08:00"], ["01:00", "05:00"], ["06:00", "08:00"], ["19:00", "23:30"], ["18:00", "06:00"]]) assert.ok(lireReglageNuit({ texte: "Hi", debut: d, fin: f }).ok, `${d} à ${f}`);
  assert.match(MIGRATION, /and \(p_debut >= time '18:00' or p_debut < time '08:00'\) and \(p_fin >= time '18:00' or p_fin <= time '08:00'\)/);
  // Fonctions pures de la contrainte ouvertes à tous les rôles qui écrivent les réglages (relecture n° 3, coupure d'urgence).
  assert.match(MIGRATION, /grant execute on function whatsapp_nuit_minutes\(time, time\), whatsapp_nuit_plage_valide\(time, time\), whatsapp_nuit_texte_defaut\(\) to public;/);
  assert.doesNotMatch(MIGRATION, /revoke all on function [^;]*whatsapp_nuit_plage_valide/);
  // NOT VALID dans la transaction, VALIDATE après le commit.
  const apres = MIGRATION.slice(MIGRATION.lastIndexOf("commit;"));
  for (const c of ["whatsapp_reglages_nuit_texte_check", "whatsapp_reglages_nuit_heures_check", "whatsapp_messages_automatique_check"]) {
    assert.match(MIGRATION, new RegExp(`add constraint ${c} check \\([^\\n]*\\) not valid;`), c);
    assert.match(apres, new RegExp(`validate constraint ${c};`), c);
  }
  // Contraintes recréées à chaque passage.
  assert.match(MIGRATION, /alter table whatsapp_reglages drop constraint if exists whatsapp_reglages_nuit_heures_check;\nalter table whatsapp_reglages add constraint/);
});

test("réglages lus : valeurs par défaut tant que la migration manque", () => {
  assert.deepEqual(reglageNuit({ reception_active: true }), { disponible: false, active: true, texte: TEXTE_NUIT, debut: "22:00", fin: "06:00", modifieLe: null });
  assert.deepEqual(reglageNuit({ nuit_active: false, nuit_texte: "Back at 7", nuit_debut: "21:30:00", nuit_fin: "06:30:00", nuit_modifie_le: "2026-11-27T10:00:00Z" }), { disponible: true, active: false, texte: "Back at 7", debut: "21:30", fin: "06:30", modifieLe: "2026-11-27T10:00:00Z" });
});

test("base : une seule fois par conversation et par nuit, réservée avant l'appel, en une transaction", () => {
  assert.match(MIGRATION, /constraint whatsapp_messages_nuit_une_fois unique \(conversation_id, nuit\)/);
  assert.match(MIGRATION, /from whatsapp_conversations w where w\.id = m\.conversation_id for update;/, "verrou de la conversation");
  assert.match(MIGRATION, /on conflict on constraint whatsapp_messages_nuit_une_fois do nothing/);
  // Le message est rangé « envoi » dans la même fonction que la réservation, donc la même transaction.
  const reserver = MIGRATION.slice(MIGRATION.indexOf("create or replace function whatsapp_reserver_nuit"), MIGRATION.indexOf("create or replace function whatsapp_nuit_resultat"));
  assert.match(reserver, /security definer/);
  assert.match(reserver, /insert into whatsapp_messages_nuit/);
  assert.match(reserver, /'sortant', 'gestion', 'text', r\.nuit_texte, '\[\]'::jsonb, now\(\), 'envoi', now\(\), 'nuit'/);
  assert.match(reserver, /m\.sens <> 'entrant' or m\.origine <> 'client' or m\.type in \('reaction', 'non_transmis'\)/);
  // Le résultat de Telnyx s'écrit sur la ligne et sur le message dans une seule fonction.
  const resultat = MIGRATION.slice(MIGRATION.indexOf("create or replace function whatsapp_nuit_resultat"), MIGRATION.indexOf("create or replace function whatsapp_reprendre_nuit"));
  assert.match(resultat, /update whatsapp_messages_nuit n set/);
  assert.match(resultat, /update whatsapp_messages set telnyx_id/);
  assert.match(resultat, /n\.statut = 'reserve'/, "un résultat ne s'écrit qu'une fois");
  // Reprise : jamais une réservation au résultat inconnu.
  const reprise = MIGRATION.slice(MIGRATION.indexOf("create or replace function whatsapp_reprendre_nuit"), MIGRATION.indexOf("create or replace function whatsapp_regler_nuit"));
  assert.match(reprise, /set statut = 'incertain', erreur = 'interrompu'/);
  assert.match(reprise, /x\.statut = 'echec'/);
  assert.doesNotMatch(reprise, /statut in \('reserve', 'incertain'\)/);
  assert.match(reprise, /for update of x skip locked/);
});

test("base : contacts exclus, réglage coupé, équipe déjà là", () => {
  const motif = MIGRATION.slice(MIGRATION.indexOf("create or replace function whatsapp_nuit_motif"), MIGRATION.indexOf("create or replace function whatsapp_reserver_nuit"));
  assert.match(motif, /c\.reponses = 'jamais' then motif := 'personnel'/);
  assert.match(motif, /coalesce\(c\.type_contact, 'client'\) <> 'client' or c\.partenaire_id is not null then motif := 'pas_client'/);
  assert.match(motif, /not r\.nuit_active then motif := 'coupe'/);
  assert.match(motif, /s\.sens = 'sortant' and s\.automatique is null/);
  assert.match(motif, /s\.envoye_le >= \(\(nuit \+ r\.nuit_debut\) at time zone 'Asia\/Bangkok'\)/);
});

test("droits : réglage contrôlé côté serveur, fonctions d'envoi fermées à l'outil", () => {
  const regler = MIGRATION.slice(MIGRATION.indexOf("create or replace function whatsapp_regler_nuit"), MIGRATION.indexOf("-- 8. Aperçu"));
  assert.match(regler, /auth\.uid\(\) is null or p_org is null or not whatsapp_ecrit\(null, p_org\)/);
  assert.match(regler, /octet_length\(p_texte\) > 4096/);
  // Relecture de la PR 364 : noms de partenaires et nets refusés (I3), lecture dépassée refusée (M2).
  assert.match(regler, /raise exception 'nom_partenaire'/);
  assert.match(regler, /from prestations_nets x/);
  assert.match(regler, /from trajets_nets x/);
  assert.match(regler, /raise exception 'montant_net'/);
  assert.match(regler, /nuit_modifie_le is not distinct from p_lu_le/);
  assert.match(regler, /raise exception 'modifie_ailleurs'/);
  assert.match(MIGRATION, /revoke all on whatsapp_messages_nuit from public, anon, authenticated/);
  assert.match(MIGRATION, /whatsapp_reserver_nuit\(uuid\),\s+whatsapp_nuit_resultat\(uuid, text, text, text\), whatsapp_reprendre_nuit\(uuid\), whatsapp_apercu\(uuid\), whatsapp_recalculer_dernier\(uuid\)\s+from public, anon, authenticated/);
  assert.match(MIGRATION, /grant execute on function whatsapp_regler_nuit\(uuid, boolean, text, time, time, timestamptz\) to authenticated/);
  // Aucune écriture directe : la colonne n'est pas ouverte à l'outil (seul reception_active l'est, migration 58).
  assert.doesNotMatch(MIGRATION, /grant update \(nuit_/);
});

test("au matin la conversation attend toujours Nani : aperçu et recalcul ignorent le message automatique", () => {
  assert.match(MIGRATION, /sens = 'sortant' and coalesce\(statut_envoi, ''\) <> 'echec' and automatique is null/);
  assert.match(MIGRATION, /where conversation_id = conv and type <> 'reaction' and automatique is null/);
  assert.match(RETOUR, /drop table if exists whatsapp_messages_nuit/);
  assert.match(RETOUR, /drop column if exists automatique/);
  assert.match(RETOUR, /create or replace function whatsapp_apercu\(conv uuid\)/);
});

test("fonction « whatsapp » : déclenché seulement par un nouveau message du client, repris par le cron", () => {
  const index = lire("supabase/functions/whatsapp/index.ts");
  assert.match(index, /import \{ messageDeNuit, reprendreNuit \} from "\.\/nuit\.ts";/);
  // Dans la branche d'un nouveau message (data.nouveau) du client (sens entrant) : un doublon d'événement ne rejoue rien.
  const bloc = index.slice(index.indexOf("if (data?.nouveau && data.message_id) {\n    // Suivi"), index.indexOf("if (!a.message.medias.length || !data?.message_id) return;"));
  assert.match(bloc, /if \(a\.message\.sens === "entrant"\) \{\n\s+enFond\(apresMessageClient[^\n]+\n[^\n]+\n\s+enFond\(messageDeNuit\(db, data\.message_id\)\);/);
  assert.equal((index.match(/messageDeNuit\(/g) || []).length, 1);
  assert.match(index, /if \(!idCourant\) await reprendreNuit\(db, ORGANISATION\)/);
  // Le repère « message manquant » ne prend pas le message automatique pour une réponse de Nani.
  assert.match(index, /\.is\("automatique", null\)\.lte\("envoye_le", m\.envoye_le\)/);
  const nuit = lire("supabase/functions/whatsapp/nuit.ts");
  assert.match(nuit, /db\.rpc\("whatsapp_reserver_nuit"/);
  assert.match(nuit, /db\.rpc\("whatsapp_nuit_resultat"/);
  assert.match(nuit, /for \(const p of \(data \|\| \[\]\) as APartir\[\]\) await envoyer/, "rien n'est envoyé sans réservation rendue par la base");
  assert.ok(nuit.indexOf('db.rpc("whatsapp_reserver_nuit"') < nuit.indexOf("api.telnyx.com"), "réservé avant l'appel");
  assert.doesNotMatch(nuit, /\+66\d{6,}/, "aucun numéro réel");
});

test("écran : réglage, traductions anglaises, cibles de 44 px, marque sur la bulle", async () => {
  const vue = lire("src/gestion/js/views/whatsapp-reglages.mjs");
  assert.match(vue, /blocMessageNuit\(r\)/);
  assert.match(vue, /type: "time"/);
  assert.match(vue, /h\("label", \{ class: "case", for: "wa-nuit-active" \}/, "case à cocher dans un libellé de 44 px");
  assert.match(vue, /h\("button", \{ class: "principal", type: "button" \}/);
  const css = lire("src/gestion/css/app.css");
  assert.match(css, /button, \.bouton \{[^}]*min-height: 44px/);
  assert.match(css, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), select, textarea \{[^}]*min-height: 44px/);
  assert.match(css, /\.case \{[^}]*min-height: 44px/);
  const { EN } = await import("../src/gestion/js/i18n-en.mjs");
  for (const fr of ["Message de nuit", "Répondre automatiquement la nuit", "Texte envoyé", "Enregistrer le message de nuit", "Reprendre le texte d'origine", "Message automatique de nuit", "Indiquez les heures au format 22:00."]) assert.ok(EN[fr], fr);
  const bulle = lire("src/gestion/js/views/whatsapp.mjs");
  assert.match(bulle, /m\.automatique === "nuit"/);
  const store = lire("src/gestion/js/store-supabase.mjs");
  assert.match(store, /sb\.rpc\("whatsapp_regler_nuit"/);
  assert.match(store, /colonneAbsente\(r\.error, "nuit_active"\)/);
  assert.match(store, /colonneAbsente\(r\.error, "automatique"\)/);
});

// ---- Relecture de la PR 364, point B1 : le message de nuit ne coupe jamais l'Assistant ------------------------------------------------
const nuit = [
  { id: "c1", sens: "entrant", origine: "client", type: "text", texte: "Hello, a taxi tomorrow?", envoye_le: "2026-11-27T16:10:00Z" },
  { id: "a1", sens: "sortant", origine: "gestion", type: "text", texte: TEXTE_NUIT, envoye_le: "2026-11-27T16:10:20Z", statut_envoi: "envoye", automatique: "nuit" },
];

test("B1 : un seul message du client la nuit, puis le message automatique : aRepondre reste vrai", () => {
  assert.equal(aRepondre(nuit, "c1"), true, "tri et réponse préparée continuent");
  assert.equal(aRepondre(sansAutomatiques(nuit), "c1"), true);
  // Sans la colonne (avant la migration), un vrai envoi de Gestion reste une réponse.
  assert.equal(aRepondre([nuit[0], { ...nuit[1], automatique: undefined }], "c1"), false);
  assert.deepEqual(sansAutomatiques(nuit).map((m) => m.id), ["c1"]);
  assert.equal(estAutomatique(nuit[1]), true);
  assert.equal(estAutomatique(nuit[0]), false);
});

test("B1 : le bouton « Préparer une réponse » reste affiché au matin", () => {
  const vue = lire("src/gestion/js/views/whatsapp.mjs");
  // carteProposition (et ligneSansReponse qu'elle appelle) décide sur le dernier message : elle reçoit la liste sans le message de nuit.
  assert.match(vue, /carteProposition\(c, prop, messages\.filter\(\(m\) => !m\.automatique\)\)/);
  assert.equal((vue.match(/carteProposition\(c, prop, /g) || []).length, 1);
  const decisifs = nuit.filter((m) => !m.automatique);
  assert.equal(decisifs[decisifs.length - 1].sens, "entrant", "condition du bouton : le dernier message décisif est du client");
  // L'aperçu de la liste attend toujours, comme whatsapp_apercu en base.
  const ap = apercuDepuisMessages(nuit);
  assert.equal(ap.attend_depuis, "2026-11-27T16:10:00Z");
  assert.equal(ap.dernier_texte, "Hello, a taxi tomorrow?");
});

test("B1 : préparation à la demande, résumé, Prêt à réserver et ton de Nani lisent sans le message de nuit", async () => {
  const reponse = lire("supabase/functions/whatsapp/reponse.ts");
  // lireConversation sert au tri automatique (apresMessageClient) et à « Préparer une réponse » (preparerALaDemande, rien_a_repondre).
  assert.match(reponse, /return \{ conv: conv as Conv, messages: \[\.\.\.sansAutomatiques\(msgs\)\]\.reverse\(\)/);
  assert.match(reponse, /const tous = sansAutomatiques\(msgs\.data\);/);
  assert.match(reponse, /return error \? null : \(sansAutomatiques\(data\) as Record/);
  assert.match(lire("supabase/functions/whatsapp/suivi.ts"), /messages: \[\.\.\.sansAutomatiques\(msgs\)\]\.reverse\(\)/);
  assert.match(lire("supabase/functions/whatsapp/pret.ts"), /const messages = \[\.\.\.sansAutomatiques\(msgs\)\]\.reverse\(\);/);
  // Le résumé ne prend pas le message de nuit pour le dernier message.
  const longue = [...["a", "b", "c", "d"].map((id, i) => ({ id, sens: "entrant", texte: `m${i}`, envoye_le: `2026-11-27T16:0${i}:00Z` })), { ...nuit[1], id: "a2" }];
  assert.equal(resumeAFaire({}, longue, "d"), true);
  // Repli : la colonne manque (migration 132 pas encore appliquée), la lecture se refait sans elle.
  const appels = [];
  const r = await avecAutomatique(async (cols) => (appels.push(cols), cols.includes("automatique") ? { data: null, error: { code: "42703", message: 'column whatsapp_messages.automatique does not exist' } } : { data: [{ id: 1 }], error: null }), "id, sens");
  assert.deepEqual(appels, ["id, sens, automatique", "id, sens"]);
  assert.deepEqual(r.data, [{ id: 1 }]);
  const r2 = await avecAutomatique(async () => ({ data: null, error: { code: "57014", message: "timeout" } }), "id");
  assert.equal(r2.error.code, "57014", "une autre erreur n'est pas cachée");
});

test("B1 : l'Assistant voit le message de nuit marqué comme tel, jamais comme une réponse de Nani", () => {
  const index = lire("supabase/functions/agent/index.ts");
  assert.equal((index.match(/avecAutomatique\(/g) || []).length, 3, "les trois lectures de la boîte par l'Assistant");
  const bloc = texteDepuisWhatsApp({ mode: "creer", conv: { id: "x", telephone: "+447700900111" }, messages: nuit, qui: "Nani" });
  assert.match(bloc, /\[Message automatique de nuit, pas une réponse de Nani /);
  assert.doesNotMatch(bloc, /\[Nani [^\]]*\] 🌴/);
  const conv = { id: "11111111-1111-4111-8111-111111111111", reponses: "auto" };
  const lu = lireConversationAgent({ conversation: conv.id }, { conversation: conv, messages: nuit.map((m, i) => ({ ...m, id: `2222222${i}-2222-4222-8222-222222222222`, conversation_id: conv.id })) });
  const auteurs = (lu.messages || []).map((m) => m.de);
  assert.ok(auteurs.includes("message automatique de nuit") && !auteurs.includes("Nani"), JSON.stringify(auteurs));
  assert.equal(lire("src/gestion/js/agent-whatsapp-lecture.mjs"), lire("supabase/functions/agent/whatsapp-lecture.js"));
  // Le prix du client n'est jamais « validé par Nani » par le message de nuit.
  const prix = [{ sens: "entrant", texte: "So 1500 THB ok?", envoye_le: "2026-11-27T16:00:00Z" }, { sens: "sortant", origine: "gestion", automatique: "nuit", type: "text", texte: "Thank you, ok !", envoye_le: "2026-11-27T16:00:10Z", medias: [] }];
  assert.equal(montantsClientValides(prix).size, 0);
});

test("I1 : « Vérifiez dans WhatsApp » ne s'affiche jamais pour le message de nuit", () => {
  const vieux = new Date(Date.now() - 10 * 60_000).toISOString();
  const auto = { ...nuit[1], envoye_le: vieux, statut_envoi: "echec", erreur_envoi: "sans_confirmation" };
  assert.equal(envoiEnDoute([nuit[0], auto]), null, "pas de carte « C'est parti / Pas parti »");
  assert.equal(statutEnvoi(auto).libelle, "pas de confirmation", "la bulle dit seulement le statut");
  assert.ok(envoiEnDoute([nuit[0], { ...auto, automatique: null }]), "un envoi ordinaire garde la carte");
  const conf = MIGRATION.slice(MIGRATION.indexOf("create or replace function whatsapp_confirmer_envoi"), MIGRATION.indexOf("-- Droits."));
  assert.equal((conf.match(/origine = 'gestion' and automatique is null/g) || []).length, 2);
  assert.match(conf, /if n_msg > 0 or exists \(select 1 from whatsapp_propositions where conversation_id = p_conversation and statut = 'envoi'\) then/, "rien de confirmé : aucune réponse préparée soldée");
  assert.match(RETOUR, /create or replace function whatsapp_confirmer_envoi/);
});

test("I2, M5 à M8 : fiche partenaire, rattrapage par le cron, reprise courte, search_path", () => {
  assert.match(MIGRATION, /if c\.type_contact is null and whatsapp_numero_partenaire\(c\.organisation_id, c\.telephone\) then motif := 'pas_client'/);
  assert.match(MIGRATION, /e\.organisation_id = p_org and e\.slug in \('secret', 'taxi'\)/);
  const reprise = MIGRATION.slice(MIGRATION.indexOf("create or replace function whatsapp_reprendre_nuit"), MIGRATION.indexOf("create or replace function whatsapp_regler_nuit"));
  assert.match(reprise, /m\.recu_le > now\(\) - interval '30 minutes'/);
  assert.match(reprise, /from whatsapp_reserver_nuit\(n\.id\)/);
  assert.match(reprise, /exit when envoyes >= 3;/);
  assert.match(reprise, /limit 3 - envoyes/);
  assert.match(reprise, /à l'heure de la reprise \(now\(\)\)/);
  assert.match(MIGRATION, /function whatsapp_recalculer_dernier\(p_conversation uuid\) returns void language sql security definer set search_path = public, pg_temp/);
  const nuitTs = lire("supabase/functions/whatsapp/nuit.ts");
  assert.equal((nuitTs.match(/console\.error\("message de nuit : TELNYX_API_KEY absente/g) || []).length, 2);
  assert.match(lire("src/gestion/js/store-local.mjs"), /!ecritWhatsApp\(null\)\) throw new Error/);
  assert.match(lire("src/gestion/js/views/whatsapp-reglages.mjs"), /lu\.valeurs\.luLe = reglageNuit\(r\)\.modifieLe/);
  assert.match(lire("src/gestion/js/store-supabase.mjs"), /p_lu_le: luLe/);
});

test("relecture n° 2 : contrôle du texte (noms, nets) seulement quand il compte, tous les séparateurs", () => {
  const regler = MIGRATION.slice(MIGRATION.indexOf("create or replace function whatsapp_regler_nuit"), MIGRATION.indexOf("-- 8. Aperçu"));
  assert.match(regler, /controler := p_active and \(p_texte is distinct from ancien or ancien_actif is distinct from true\);/);
  assert.match(regler, /if controler then/);
  assert.match(regler, /if controler and exists \(/);
  // Forme courte : 2 mots au moins ; aucune suite de mots du texte par défaut.
  assert.match(regler, /k\.court like '% %' and defaut not like '% ' \|\| k\.court \|\| ' %'/);
  assert.match(regler, /length\(n\.entier\) >= 4 and defaut not like '% ' \|\| n\.entier \|\| ' %'/);
  // Heures : deux chiffres sans un troisième ; séparateurs ' et ’ et espaces insécables.
  assert.match(regler, /\\d\{2\}\(\?!\[0-9\]\)/);
  assert.match(regler, /\[ ,\.''’\\u00a0\\u202f\]/);
});

test("relecture n° 2 : rattrapage sur un vrai message, du plus ancien au plus récent", () => {
  const reprise = MIGRATION.slice(MIGRATION.indexOf("create or replace function whatsapp_reprendre_nuit"), MIGRATION.indexOf("create or replace function whatsapp_regler_nuit"));
  assert.match(reprise, /m\.type not in \('reaction', 'non_transmis'\) and m\.supprime_le is null/);
  assert.match(reprise, /order by m\.conversation_id, m\.recu_le desc\n    \) d\n    order by d\.recu_le asc/);
});

test("relecture n° 2 : apprendre de Nani ignore le message de nuit", async () => {
  const { propositionAComparer } = await import("../supabase/functions/agent/apprendre-whatsapp.js");
  const p = { id: "p1", cree_le: "2026-11-27T16:05:00Z", statut: "a_faire", texte: "Hello! A taxi to the pier is 800 THB." };
  const client = { id: "c1", sens: "entrant", origine: "client", type: "text", texte: "Taxi?", envoye_le: "2026-11-27T16:00:00Z" };
  const auto = { id: "a1", sens: "sortant", origine: "gestion", type: "text", texte: TEXTE_NUIT, envoye_le: "2026-11-27T16:06:00Z", automatique: "nuit" };
  const nani = { id: "n1", sens: "sortant", origine: "app", type: "text", texte: "Hi! The taxi to the pier is 800 THB.", envoye_le: "2026-11-27T16:50:00Z" };
  assert.equal(propositionAComparer({ propositions: [p], messages: [client, auto, nani], message: nani })?.id, "p1", "le message de nuit entre les deux ne coupe pas l'apprentissage");
  assert.equal(propositionAComparer({ propositions: [p], messages: [client, auto], message: auto }), null, "le message de nuit n'est jamais appris");
  assert.match(lire("supabase/functions/agent/apprendre-whatsapp.js"), /const \{ data: recents, error: errL \} = await avecAutomatique\(/);
});
