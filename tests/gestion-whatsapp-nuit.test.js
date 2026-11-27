// tests/gestion-whatsapp-nuit.test.js : message automatique de nuit sur le WhatsApp de Nani (migration 132, demande de Jérémy du 27.11.2026).
// La base décide (docs/gestion/verif-whatsapp-message-nuit.mjs le vérifie sur PGlite) ; ici la logique pure, le texte mot pour mot, le
// branchement dans la fonction « whatsapp » et l'écran de réglage.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEXTE_NUIT, DEBUT_NUIT, FIN_NUIT, cleDeNuit, heureBangkok, minutes, resultatTelnyx, lireReglageNuit, reglageNuit } from "../supabase/functions/whatsapp/nuit.js";

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
  "In the meantime, please feel free to send us all the details of your request so we can assist you more efficiently:",
  "",
  "The more details you share, the more accurately we can assist you when we get back to you !",
  "",
  "Thank you for your patience. We look forward to helping you discover Thailand ! \u{1F1F9}\u{1F1ED}🌴",
].join("\n");

test("le texte est celui de Jérémy, mot pour mot, dans le code et dans la migration", () => {
  assert.equal(TEXTE_NUIT, DEMANDE);
  assert.ok(TEXTE_NUIT.includes("we’ll"), "apostrophe typographique");
  assert.equal((TEXTE_NUIT.match(/ !/g) || []).length, 3, "trois espaces avant « ! »");
  const sql = /nuit_texte text not null default \$nuit\$([\s\S]*?)\$nuit\$/.exec(MIGRATION);
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
});

test("réglages lus : valeurs par défaut tant que la migration manque", () => {
  assert.deepEqual(reglageNuit({ reception_active: true }), { disponible: false, active: true, texte: TEXTE_NUIT, debut: "22:00", fin: "06:00" });
  assert.deepEqual(reglageNuit({ nuit_active: false, nuit_texte: "Back at 7", nuit_debut: "21:30:00", nuit_fin: "06:30:00" }), { disponible: true, active: false, texte: "Back at 7", debut: "21:30", fin: "06:30" });
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
  assert.match(MIGRATION, /revoke all on whatsapp_messages_nuit from public, anon, authenticated/);
  assert.match(MIGRATION, /whatsapp_reserver_nuit\(uuid\),\s+whatsapp_nuit_resultat\(uuid, text, text, text\), whatsapp_reprendre_nuit\(uuid\), whatsapp_apercu\(uuid\), whatsapp_recalculer_dernier\(uuid\)\s+from public, anon, authenticated/);
  assert.match(MIGRATION, /grant execute on function whatsapp_regler_nuit\(uuid, boolean, text, time, time\) to authenticated/);
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
